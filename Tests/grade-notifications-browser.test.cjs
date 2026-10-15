'use strict';
// Real browser coverage with synthetic grades; never reads school accounts.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Core = require('../Resources/core.js');
const optional = { skip: !process.env.PLAYWRIGHT_MODULE };
const school = 'https://example-school.managebac.cn/';
const courseURL = school + 'student/classes/7001/core_tasks';
const launch = () => require(process.env.PLAYWRIGHT_MODULE).chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
function snapshot(score, percentage, timestamp) {
  return { source: 'managebac', url: courseURL, title: 'Synthetic Physics', capturedAt: timestamp, gradesCaptured: true, warnings: [], feedback: [], tasks: [], courses: [{ id: '7001', name: 'Synthetic Physics', percentage, term: 'Term 1 (current)', isCurrentTerm: true, isCourseGrade: true, url: courseURL }], grades: [{ id: '9001', assignmentId: '9001', title: '<img src=x onerror=alert(1)> Lab report', course: 'Synthetic Physics', courseId: '7001', term: 'Term 1 (current)', score, maxScore: 100, percentage: score, gradeLabel: '', url: courseURL + '/9001' }] };
}
async function seed(page, initial) {
  await page.addInitScript(({ initial, school }) => {
    window.CampusDeskThemeEdition = true; window.CampusDeskAppVersion = { version: '1.1.0', name: 'Super Orion' };
    window.fetch = undefined;
    localStorage.setItem('campusdesk.school-config.v1', JSON.stringify({ managebac: school, seiue: 'https://example-school.seiue.com/' }));
    if (!localStorage.getItem('campusdesk.browser.v1')) localStorage.setItem('campusdesk.browser.v1', JSON.stringify(initial));
  }, { initial, school });
  await page.goto(pathToFileURL(path.resolve(__dirname, '../Resources/index.html')).href + '#assistant');
  await page.locator('#assistant-question').waitFor();
}
test('grade notification drawer persists unread state, contains untrusted text, supports keyboard/outside close and keeps drafts during live sync', optional, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const initial = Core.emptyState(); Object.assign(initial.settings, { setupWizardCompleted: true, setupWizardIntroVersion: '1.1.0', aiProvider: 'ollama' });
    await seed(page, initial);
    await page.locator('#grade-notifications-button').click();
    assert.match(await page.locator('#grade-notifications-content').innerText(), /首次读取某门课程的已有成绩只建立基线/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#grade-notifications-dialog').evaluate(node => node.open), false);
    assert.equal(await page.locator('#grade-notifications-button').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'grade-notifications-button');
    await page.evaluate(snapshot => CampusDesk.receive({ type: 'snapshot', snapshot }), snapshot(80, 86, '2026-10-15T01:00:00Z'));
    assert.equal(await page.locator('.grade-notification-count').count(), 0, 'first capture is a quiet baseline');
    await page.locator('#assistant-question').fill('保留输入中的草稿 draft');
    await page.evaluate(() => { window.savedDraftNode = document.getElementById('assistant-question'); savedDraftNode.setSelectionRange(2, 4); });
    await page.evaluate(snapshot => CampusDesk.receive({ type: 'snapshot', snapshot }), snapshot(90, 88, '2026-10-15T01:01:00Z'));
    assert.equal(await page.locator('.grade-notification-count').innerText(), '1');
    assert.deepEqual(await page.evaluate(() => ({ same: savedDraftNode === document.getElementById('assistant-question'), focused: document.activeElement === savedDraftNode, value: savedDraftNode.value, start: savedDraftNode.selectionStart, end: savedDraftNode.selectionEnd })), { same: true, focused: true, value: '保留输入中的草稿 draft', start: 2, end: 4 });
    await page.locator('#grade-notifications-button').click();
    const dialog = page.locator('#grade-notifications-dialog');
    assert.match(await dialog.innerText(), /<img src=x onerror=alert\(1\)> Lab report/);
    assert.equal(await dialog.locator('img').count(), 0);
    assert.match(await dialog.innerText(), /本次同步的同期变化/);
    assert.match(await dialog.innerText(), /86% → 88%/);
    assert.match(await dialog.innerText(), /不代表这份作业的单独贡献/);
    const readButton = dialog.locator('[data-action="grade-notification-read"]').first();
    await readButton.focus();
    const focusedID = await page.evaluate(() => document.activeElement.id);
    await page.evaluate(snapshot => CampusDesk.receive({ type: 'snapshot', snapshot }), snapshot(95, 90, '2026-10-15T01:02:00Z'));
    assert.equal(await page.locator('.grade-notification-count').innerText(), '2');
    assert.equal(await page.evaluate(() => document.activeElement.id), focusedID, 'incoming notification does not steal focus');
    assert.equal(await page.evaluate(() => savedDraftNode === document.getElementById('assistant-question')), true);
    assert.equal(await page.locator('#assistant-question').inputValue(), '保留输入中的草稿 draft');
    await page.locator('#grade-notifications-dialog').screenshot({ path: '/private/tmp/campusdesk-grade-notifications.png' });
    await page.locator('[data-action="grade-notification-read"]').first().click();
    assert.equal(await page.locator('.grade-notification-count').innerText(), '1');
    await page.locator('#grade-notifications-read-all').click();
    assert.equal(await page.locator('.grade-notification-count').count(), 0);
    const read = await page.evaluate(() => JSON.parse(localStorage.getItem('campusdesk.browser.v1')).gradeUpdateRead);
    assert.equal(Object.values(read).filter(Boolean).length, 2);
    await page.locator('#grade-notifications-unread').click();
    assert.match(await dialog.innerText(), /全部看完了/);
    await page.keyboard.press('Escape');
    await page.reload(); await page.locator('#assistant-question').waitFor();
    assert.equal(await page.locator('.grade-notification-count').count(), 0, 'read state survives restart');
    await page.locator('#grade-notifications-button').click();
    await page.mouse.click(300, 400);
    assert.equal(await dialog.evaluate(node => node.open), false, 'outside click closes the drawer');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
test('grade notifications handle unknown impacts and zero marks in English without horizontal overflow at 390px, 760px and 1280px', optional, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const initial = Core.emptyState(); Object.assign(initial.settings, { language: 'en-US', setupWizardCompleted: true, setupWizardIntroVersion: '1.1.0', aiProvider: 'ollama' });
    initial.gradeUpdates = [{ id: 'zero', source: 'managebac', kind: 'new', title: 'A very long synthetic assignment ' + 'long-title-'.repeat(30), course: 'Synthetic Physics', courseId: '7001', term: 'Term 1', url: courseURL + '/9001', capturedAt: '2026-10-15T01:00:00Z', before: null, after: { score: 0, maxScore: 10, percentage: 0, gradeLabel: '' }, impact: { comparable: false } }];
    await seed(page, initial); await page.locator('#grade-notifications-button').click();
    const text = await page.locator('#grade-notifications-content').innerText();
    assert.match(text, /0 \/ 10 · 0%/); assert.match(text, /cannot yet be quantified/); assert.doesNotMatch(text, /[\u3400-\u9fff]/);
    for (const width of [1280, 760, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => { const dialog = document.getElementById('grade-notifications-dialog'), list = document.getElementById('grade-notifications-list'); return document.documentElement.scrollWidth <= innerWidth + 1 && dialog.getBoundingClientRect().right <= innerWidth && list.scrollWidth <= list.clientWidth + 1; }), true, 'no horizontal overflow at ' + width);
    }
    await page.keyboard.press('Escape');
    const toolbar = await page.locator('.toolbar').boundingBox(); assert.ok(toolbar.x + toolbar.width <= 391, 'toolbar remains in the narrow window');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
