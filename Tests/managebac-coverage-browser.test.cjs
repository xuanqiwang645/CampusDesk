'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { launchChromium } = require('./launch-chromium.cjs');
const Core = require('../Resources/core.js');
const MB = require('../Resources/managebac.js');
const home = 'https://example-school.managebac.cn';
const courseURL = id => home + '/student/classes/' + id + '/core_tasks';

test('nine discovered courses stay visible through partial grades, sync and reload without changing personal records', { skip: !process.env.PLAYWRIGHT_MODULE }, async () => {
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const directory = Array.from({ length: 9 }, (_, i) => ({ url: courseURL(7000 + i), title: 'Synthetic course ' + (i + 1) }));
    let state = Core.emptyState();
    state.manualTasks = [{ id: 'personal', title: 'Personal task', course: 'Personal', status: 'open', createdAt: '2026-11-01T00:00:00Z' }];
    state.taskChecks = { personal: true };
    Core.configureSchools({ managebac: home + '/', seiue: '' });
    const listing = MB.fromProjection({ url: home + '/student/home', courseDirectory: directory, links: directory }, '2026-11-13T01:00:00Z');
    state = Core.mergeSnapshot(state, listing);
    const grade = i => MB.fromProjection({ url: courseURL(7000 + i), heading: directory[i].title,
      recognized: true, term: 'First Semester (current)', overallRows: [{ label: 'Overall', value: '90%' }], links: [] }, '2026-11-13T01:01:00Z');
    for (let i = 0; i < 5; i++) state = Core.mergeSnapshot(state, grade(i));
    // Node's shared Core fixture runs without the Theme Edition bootstrap and
    // omits theme-only settings during merge validation. Set them after merging
    // so a setup modal cannot intentionally suspend the background repaint.
    Object.assign(state.settings, { setupWizardCompleted: true, setupWizardIntroVersion: '2.0.0', taskReviewEnabled: false });
    await page.addInitScript(({ state, home }) => {
      window.CampusDeskThemeEdition = true; window.fetch = undefined;
      window.CampusDeskAppVersion = { version: '2.0.0', name: 'Tarantula' };
      localStorage.setItem('campusdesk.school-config.v1', JSON.stringify({ managebac: home + '/', seiue: '' }));
      if (!localStorage.getItem('campusdesk.browser.v1')) localStorage.setItem('campusdesk.browser.v1', JSON.stringify(state));
    }, { state, home });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../Resources/index.html')).href + '#grades');
    await page.locator('.grade-table:has(.course-name)').waitFor();
    assert.equal(await page.locator('#setup-wizard-dialog').evaluate(dialog => dialog.open), false);
    const table = page.locator('.grade-table:has(.course-name)');
    assert.equal(await table.locator('tbody tr').count(), 9);
    assert.match(await table.locator('..').locator('..').innerText(), /已发现 9 门 · 5 门计入 GPA/);
    assert.match(await table.locator('..').locator('..').innerText(), /4 门课程尚未读取到总评/);
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('campusdesk.browser.v1')));
    for (let i = 5; i < 9; i++) await page.evaluate(snapshot => CampusDesk.receive({ type: 'snapshot', snapshot }), grade(i));
    await page.waitForFunction(() => document.getElementById('content').textContent.includes('已发现 9 门 · 9 门计入 GPA'));
    assert.equal(await table.locator('tbody tr').count(), 9);
    assert.match(await table.locator('..').locator('..').innerText(), /已发现 9 门 · 9 门计入 GPA/);
    await page.reload(); await page.locator('.grade-table:has(.course-name)').waitFor();
    assert.equal(await page.locator('.grade-table:has(.course-name) tbody tr').count(), 9);
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('campusdesk.browser.v1')));
    assert.deepEqual(after.manualTasks, before.manualTasks);
    assert.deepEqual(after.taskChecks, before.taskChecks);
    assert.equal(after.settings.taskReviewEnabled, false);
    const english = { ...after, settings: { ...after.settings, language: 'en-US' } };
    await page.evaluate(state => CampusDesk.receive({ type: 'state', state }), english);
    await page.waitForFunction(() => document.getElementById('content').textContent.includes('9 courses found · 9 in GPA'));
    assert.match(await page.locator('.grade-table:has(.course-name)').locator('..').locator('..').innerText(), /9 courses found · 9 in GPA/);
  } finally { await browser.close(); }
});
