'use strict';
// Real browser regression for the add-to-do dialog; no school accounts or user data.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Core = require('../Resources/core.js');
const optional = { skip: !process.env.PLAYWRIGHT_MODULE };
async function selectTime(page, time) {
  await page.locator('#task-time-custom').setChecked(Boolean(time));
  if (!time) return;
  const [hour, minute] = time.split(':');
  await page.locator('#task-hour-wheel').press('Home');
  await page.locator('#task-hour-wheel').pressSequentially(hour);
  await page.locator('#task-minute-wheel').press('Home');
  await page.locator('#task-minute-wheel').pressSequentially(minute);
  assert.equal(await page.locator('#task-due-time').inputValue(), time);
}

test('rewritten form previews typed deadlines, supports shortcuts, and preserves drafts on invalid submission', optional, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../Resources/index.html')).href + '#overview');
    await page.locator('[data-action="add-task"]').first().click();
    assert.equal(await page.locator('#task-due-date').getAttribute('type'), 'text');
    await page.locator('#task-form button[type="submit"]').click();
    assert.match(await page.locator('#task-form-error').innerText(), /填写要做/);
    await page.locator('#task-title').fill('整理班级公众号');
    await selectTime(page, '11:30');
    await page.locator('[data-action="task-date-shortcut"][data-value="today"]').click();
    assert.match(await page.locator('#task-deadline-preview').innerText(), /11:30.*北京时间/);
    assert.equal(await page.locator('#task-due-time').inputValue(), '11:30');
    await page.locator('[data-action="task-date-shortcut"][data-value="tomorrow"]').click();
    assert.equal(await page.locator('#task-due-date').inputValue(), Core.today(new Date(Date.now() + 86400000), 'Asia/Shanghai'));
    await page.locator('[data-action="task-date-shortcut"][data-value="none"]').click();
    assert.equal(await page.locator('#task-due-date').inputValue(), '');
    assert.equal(await page.locator('#task-due-time').inputValue(), '');
    await page.locator('#task-due-date').fill('2026-02-30');
    await page.locator('#task-form button[type="submit"]').click();
    assert.match(await page.locator('#task-form-error').innerText(), /真实日期/);
    assert.equal(await page.locator('#task-title').inputValue(), '整理班级公众号');
    assert.equal(await page.locator('#task-due-date').inputValue(), '2026-02-30');
    await page.locator('#task-due-date').fill('2030/9/29');
    await selectTime(page, '11:30');
    assert.match(await page.locator('#task-deadline-preview').innerText(), /2030-09-29 11:30/);
    const imeBlocked = await page.locator('#task-title').evaluate(node => !node.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', isComposing: true, bubbles: true, cancelable: true})));
    assert.equal(imeBlocked, true);
    if (process.env.TASK_FORM_SCREENSHOT) await page.screenshot({ path: process.env.TASK_FORM_SCREENSHOT });
    await page.locator('#task-form button[type="submit"]').click();
    await page.locator('#task-form').evaluate(node => node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('campusdesk.browser.v1')));
    assert.equal(saved.manualTasks.length, 1, 'double submission must not create another task');
    assert.equal(saved.manualTasks[0].dueAt, '2030-09-29T03:30:00.000Z');
  } finally { await browser.close(); }
});

test('time wheels support keys and boundaries without accidental submission, and persist Beijing deadline', optional, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(state => localStorage.setItem('campusdesk.browser.v1', JSON.stringify(state)), Core.emptyState());
    await page.goto(pathToFileURL(path.resolve(__dirname, '../Resources/index.html')).href + '#tasks');
    await page.evaluate(() => { const wizard = document.getElementById('setup-wizard-dialog'); if (wizard.open) wizard.close(); });
    await page.locator('[data-action="add-task"]').first().click();
    assert.equal(await page.locator('#task-dialog').evaluate(node => node.open), true);
    assert.equal(await page.locator('#task-due-time').getAttribute('type'), 'hidden');
    assert.equal(await page.locator('#task-hour-wheel [role="option"]').count(), 24);
    assert.equal(await page.locator('#task-minute-wheel [role="option"]').count(), 60);
    await page.locator('#task-title').fill('Prepare notes');
    await page.locator('#task-due-date').fill('2026-09-28');
    await selectTime(page, '00:00');
    await page.locator('#task-hour-wheel').press('ArrowUp');
    await page.locator('#task-minute-wheel').press('ArrowUp');
    assert.equal(await page.locator('#task-due-time').inputValue(), '00:00');
    await page.locator('#task-hour-wheel').press('End');
    await page.locator('#task-minute-wheel').press('End');
    await page.locator('#task-minute-wheel').press('ArrowDown');
    assert.equal(await page.locator('#task-due-time').inputValue(), '23:59');
    await page.locator('#task-minute-wheel').press('Enter');
    assert.equal(await page.locator('#task-dialog').evaluate(node => node.open), true);
    await selectTime(page, '18:30');
    await page.locator('#task-form button[type="submit"]').click();
    assert.equal(await page.locator('#task-dialog').evaluate(node => node.open), false);
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem('campusdesk.browser.v1')));
    assert.equal(state.manualTasks.length, 1);
    assert.equal(state.manualTasks[0].dueAt, '2026-09-28T10:30:00.000Z');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('personal tasks retain optional deadlines across reload and stay above Teams in the left overview column', optional, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const seed = Core.emptyState();
    seed.settings.dashboardTheme = 'board';
    seed.snapshots.teams = {'https://teams.microsoft.com/v2/': {source: 'teams', url: 'https://teams.microsoft.com/v2/', title: 'Test', capturedAt: '2026-09-29T00:00:00Z', coverage: 'visible', warnings: [], tasks: [{id: 'teams-task', title: 'Team task', course: 'Science', status: 'open', dueAt: null}], posts: []}};
    Core.validateState(seed);
    await page.addInitScript(state => {
      if (!localStorage.getItem('campusdesk.browser.v1')) localStorage.setItem('campusdesk.browser.v1', JSON.stringify(state));
    }, seed);
    await page.goto(pathToFileURL(path.resolve(__dirname, '../Resources/index.html')).href + '#overview');
    await page.locator('.board-task-column-left').waitFor();
    async function add(title, day = '', time = '') {
      await page.locator('[data-action="add-task"]').first().click();
      assert.equal(await page.locator('#task-due-date').inputValue(), '');
      assert.equal(await page.locator('#task-due-time').inputValue(), '');
      await page.locator('#task-title').fill(title);
      await page.locator('#task-due-date').fill(day);
      await selectTime(page, time);
      await page.locator('#task-form button[type="submit"]').click();
    }
    await add('Exact deadline', '', '18:30');
    assert.equal(await page.locator('#task-dialog').evaluate(node => node.open), true);
    assert.match(await page.locator('#task-form-error').innerText(), /同时选择截止日期/);
    await page.locator('#task-due-date').fill('2030-09-30');
    await page.locator('#task-form button[type="submit"]').click();
    await add('Date only', '2030-10-01');
    await add('No deadline');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('campusdesk.browser.v1')));
    assert.deepEqual(saved.manualTasks.map(task => task.dueAt), ['2030-09-30T10:30:00.000Z', '2030-10-01T15:59:00.000Z', null]);
    // The native disk validator runs this same schema before storing/reloading.
    const validated = Core.validateState(saved);
    await page.evaluate(state => localStorage.setItem('campusdesk.browser.v1', JSON.stringify(state)), validated);
    await page.reload();
    const left = page.locator('.board-task-column-left');
    await left.waitFor();
    assert.deepEqual(await left.locator(':scope > section').evaluateAll(nodes => nodes.map(node => node.dataset.domKey)), ['source-manual', 'source-teams']);
    const exact = page.locator('.board-task-card').filter({hasText: 'Exact deadline'});
    assert.match(await exact.locator('.board-due').innerText(), /18:30/);
    assert.ok(Number(await exact.getAttribute('data-due-ms')) > 0);
    assert.ok(parseFloat(await exact.locator('[data-todo-progress]').evaluate(node => node.style.width)) > 0);
    assert.notEqual(await exact.locator('.board-due span').evaluate(node => getComputedStyle(node).whiteSpace), 'nowrap');
    assert.doesNotMatch(await exact.innerText(), /待核对/);
    await exact.locator('h3 button').click();
    assert.equal(await page.locator('#manual-due-date').inputValue(), '2030-09-30');
    assert.equal(await page.locator('#manual-due-time').inputValue(), '18:30');
    await page.locator('#manual-due-date').fill('2020-01-01');
    await page.locator('#manual-due-time').fill('09:05');
    await page.locator('[data-action="save-manual-task-due"]').click();
    await page.locator('[data-action="close-detail"]').click();
    await page.reload();
    await exact.waitFor();
    assert.match(await exact.locator('.board-due').innerText(), /09:05/);
    assert.match(await exact.locator('.todo-urgency').innerText(), /逾期/);
    assert.equal(await exact.locator('[data-todo-progress]').evaluate(node => node.style.width), '100%');
    assert.match(await page.locator('.board-task-card').filter({hasText: 'No deadline'}).innerText(), /设置截止时间/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('mouse scrolling and clicking select the centre value, with no stale save while scrolling', optional, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../Resources/index.html')).href + '#overview');
    await page.locator('[data-action="add-task"]').first().click();
    await page.locator('#task-title').fill('Wheel deadline');
    await page.locator('#task-due-date').fill('2030-09-29');
    await selectTime(page, '09:30');
    const topBefore = await page.locator('#task-dialog').evaluate(node => node.scrollTop);
    await page.locator('#task-minute-wheel').hover();
    await page.mouse.wheel(0, 80);
    await page.waitForFunction(() => {
      const wheel = document.getElementById('task-minute-wheel');
      return wheel.scrollTop > 1200 && Math.abs(wheel.scrollTop / 40 - Math.round(wheel.scrollTop / 40)) < .01
        && document.getElementById('task-due-time').value !== '09:30';
    });
    const afterWheel = await page.locator('#task-due-time').inputValue();
    assert.match(afterWheel, /^09:/);
    assert.equal(await page.locator('#task-dialog').evaluate(node => node.scrollTop), topBefore);
    const value = Number(afterWheel.slice(3));
    await page.locator('#task-minute-' + (value - 1)).click();
    assert.equal(await page.locator('#task-due-time').inputValue(), '09:' + String(value - 1).padStart(2, '0'));
    // Dispatch submit before the queued scroll event, as an immediate save can do.
    await page.evaluate(() => {
      document.getElementById('task-minute-wheel').scrollTop = 42 * 40;
      document.getElementById('task-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('campusdesk.browser.v1')));
    assert.equal(saved.manualTasks[0].dueAt, '2030-09-29T01:42:00.000Z');
    await page.locator('[data-action="add-task"]').first().click();
    assert.equal(await page.locator('#task-due-time').inputValue(), '');
    assert.equal(await page.locator('#task-due-date').inputValue(), '');
    assert.equal(await page.locator('#task-time-custom').isChecked(), false);
    await page.locator('#task-title').fill('Default time');
    await page.locator('#task-due-date').fill('2030-09-30');
    await selectTime(page, '00:00');
    await page.locator('#task-time-custom').uncheck();
    assert.match(await page.locator('#task-deadline-preview').innerText(), /2030-09-30 23:59/);
    await page.locator('#task-form button[type="submit"]').click();
    const next = await page.evaluate(() => JSON.parse(localStorage.getItem('campusdesk.browser.v1')));
    assert.equal(next.manualTasks[1].dueAt, '2030-09-30T15:59:00.000Z');
  } finally { await browser.close(); }
});

test('wheel layout stays inside a narrow viewport and footer remains reachable', optional, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../Resources/index.html')).href + '#overview');
    await page.locator('[data-action="add-task"]').first().click();
    await page.locator('#task-title').fill('Narrow layout');
    await page.locator('[data-action="task-date-shortcut"][data-value="today"]').click();
    await selectTime(page, '18:05');
    const dimensions = await page.locator('#task-dialog').evaluate(node => ({ width: node.clientWidth, content: node.scrollWidth }));
    assert.ok(dimensions.content <= dimensions.width + 1, 'no horizontal clipping');
    await page.locator('#task-form button[type="submit"]').click();
    assert.equal(await page.locator('#task-dialog').evaluate(node => node.open), false);
  } finally { await browser.close(); }
});
