'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
global.CampusDeskThemeEdition = true;
const Core = require('../Resources/core.js');
const Agenda = require('../Resources/agenda.js');
const optional = { skip: !process.env.PLAYWRIGHT_MODULE };
function fixtureState() {
  let state = Core.emptyState();
  Object.assign(state.settings, { setupWizardCompleted: true, setupWizardIntroVersion: '1.1.0', dashboardTheme: 'board' });
  state.manualTasks = [{ id: 'midnight-due', title: 'Midnight deadline', dueAt: '2030-01-31T16:15:00.000Z', status: 'open', course: 'Personal' }];
  state = Agenda.upsertPersonalEvent(state, { title: 'Overnight observation', startDate: '2030-01-31', endDate: '2030-02-01', allDay: false, startTime: '23:30', endTime: '00:30' });
  return Core.validateState(state);
}
async function fixture(run, native = false) {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ state, native }) => {
      // Seed only the isolated browser's first load. Re-seeding on reload would
      // erase the event just saved and invalidate the persistence regression.
      if (!localStorage.getItem('campusdesk.browser.v1')) localStorage.setItem('campusdesk.browser.v1', JSON.stringify(state));
      window.CampusDeskThemeEdition = true;
      if (native) { window.testMessages = []; window.webkit = { messageHandlers: { campus: { postMessage: message => window.testMessages.push(message) } } }; }
    }, { state: fixtureState(), native });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../Resources/index.html')).href + '#calendar');
    if (native) await page.evaluate(state => CampusDesk.receive({ type: 'state', state }), fixtureState());
    await page.locator('.agenda-month-grid').waitFor();
    await page.evaluate(() => CampusDesk.receive({ type: 'navigate', page: 'calendar', date: '2030-01-31' }));
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}
test('calendar follows Beijing midnight, cross-month personal events, source filters and safe date navigation', optional, async () => fixture(async page => {
  assert.equal(await page.locator('.agenda-month-grid .agenda-day').count(), 42);
  assert.equal(await page.locator('.agenda-day-list').getByText('Overnight observation').count(), 1);
  assert.equal(await page.locator('.agenda-day-list').getByText('Midnight deadline').count(), 0);
  await page.locator('[data-action="agenda-day"][data-date="2030-02-01"]').click();
  assert.match(await page.locator('#agenda-month-title').innerText(), /2030.*2/);
  assert.equal(await page.locator('.agenda-day-list').getByText('Midnight deadline').count(), 1);
  assert.equal(await page.locator('.agenda-day-list').getByText('Overnight observation').count(), 1);
  assert.match(await page.locator('.agenda-day-list').innerText(), /00:00.*00:30/);
  await page.locator('[data-action="agenda-filter"][data-kind="task"]').click();
  assert.equal(await page.locator('.agenda-day-list').getByText('Midnight deadline').count(), 0);
  await page.locator('[data-action="agenda-month"][data-step="-1"]').click();
  assert.equal(await page.locator('.agenda-day.selected').getAttribute('data-date'), '2030-01-01');
  await page.evaluate(() => CampusDesk.receive({ type: 'navigate', page: 'calendar', date: '2030-02-31' }));
  assert.equal(await page.locator('.agenda-day.selected').getAttribute('data-date'), '2030-01-01');
}));
test('personal calendar create, invalid date protection, edit and deletion survive reload', optional, async () => fixture(async page => {
  await page.locator('.agenda-heading-actions [data-action="agenda-add"]').click();
  await page.locator('#agenda-title').fill('Lab meeting');
  await page.locator('#agenda-start-date').fill('2030-02-31');
  await page.locator('#agenda-event-form button[type="submit"]').click();
  assert.equal(await page.locator('#agenda-event-dialog').evaluate(node => node.open), true);
  assert.match(await page.locator('#agenda-form-error').innerText(), /YYYY-MM-DD/);
  await page.locator('#agenda-start-date').fill('2030-02-01');
  await page.locator('#agenda-end-date').fill('2030-02-01');
  await page.locator('#agenda-all-day').uncheck();
  await page.locator('#agenda-start-time').fill('18:07');
  await page.locator('#agenda-end-time').fill('19:15');
  await page.locator('#agenda-location').fill('Room 101');
  // A sync during editing must preserve the live form and its draft.
  await page.evaluate(state => CampusDesk.receive({ type: 'state', state }), fixtureState());
  assert.equal(await page.locator('#agenda-title').inputValue(), 'Lab meeting');
  await page.locator('#agenda-event-form button[type="submit"]').click();
  assert.equal(await page.locator('#agenda-event-dialog').evaluate(node => node.open), false);
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('campusdesk.browser.v1')));
  assert.equal(saved.personalEvents.find(row => row.title === 'Lab meeting').startTime, '18:07');
  await page.reload();
  await page.locator('.agenda-month-grid').waitFor();
  await page.evaluate(() => CampusDesk.receive({ type: 'navigate', page: 'calendar', date: '2030-02-01' }));
  await page.locator('.agenda-day-list').getByRole('button', { name: /Lab meeting/ }).click();
  await page.locator('#agenda-title').fill('Edited lab meeting');
  await page.locator('#agenda-all-day').check();
  await page.locator('#agenda-event-form button[type="submit"]').click();
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem('campusdesk.browser.v1')));
  assert.equal(saved.personalEvents.find(row => row.title === 'Edited lab meeting').allDay, true);
  await page.locator('.agenda-day-list').getByRole('button', { name: /Edited lab meeting/ }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-action="agenda-delete"]').click();
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem('campusdesk.browser.v1')));
  assert.equal(saved.personalEvents.some(row => row.title === 'Edited lab meeting'), false);
  assert.equal(saved.manualTasks[0].id, 'midnight-due');
}));
test('calendar fits narrow screens and widget refresh reports native status without inventing success', optional, async () => fixture(async page => {
  await page.evaluate(() => CampusDesk.receive({ type: 'widgetsStatus', supported: true, updatedAt: '2030-01-31T04:00:00Z', busy: false }));
  await page.locator('[data-action="agenda-refresh-widgets"]').waitFor();
  await page.locator('[data-action="agenda-refresh-widgets"]').click();
  assert.equal(await page.locator('[data-action="agenda-refresh-widgets"]').isDisabled(), true);
  assert.equal(await page.evaluate(() => testMessages.filter(message => message.action === 'refreshWidgets').length), 1);
  await page.evaluate(() => CampusDesk.receive({ type: 'widgetsStatus', supported: true, busy: false, error: '无法写入小组件摘要' }));
  await page.locator('.agenda-widget-error').waitFor();
  assert.match(await page.locator('.agenda-widget-error').innerText(), /无法写入/);
  for (const width of [1440, 1024, 760, 390]) {
    await page.setViewportSize({ width, height: 1050 });
    const sizes = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, width: innerWidth, grid: document.querySelector('.agenda-month-grid').getBoundingClientRect().right }));
    assert.ok(sizes.page <= sizes.width + 1, JSON.stringify(sizes));
    assert.ok(sizes.grid <= sizes.width + 1, JSON.stringify(sizes));
  }
  if (process.env.AGENDA_SCREENSHOT) {
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.screenshot({ path: process.env.AGENDA_SCREENSHOT, fullPage: true });
  }
}, true));
