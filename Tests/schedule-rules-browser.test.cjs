'use strict';
// Synthetic schedule layout checks; never load a school account or real data.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Core = require('../Resources/core.js');

test('holiday help and adjustment fields never overlap across widths, languages and dashboard styles', { skip: !process.env.PLAYWRIGHT_MODULE }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../Resources/index.html')).href + '#schedule');
    for (const language of ['zh-CN', 'en-US']) for (const dashboardTheme of ['classic', 'board']) {
      const state = Core.emptyState();
      Object.assign(state.settings, { language, dashboardTheme });
      await page.evaluate(state => CampusDesk.receive({ type: 'state', state }), state);
      for (const width of [1440, 1000, 760, 580, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        const layout = await page.locator('.schedule-rules-card').evaluate(card => {
          const rect = el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
          const fields = card.querySelector(':scope > .custom-schedule-grid'), help = card.querySelector(':scope > .custom-schedule-note');
          const controls = [...card.querySelectorAll('input, select, button')].map(el => ({ ...rect(el), kind: el.tagName, parent: rect(el.closest('label') || el.parentElement) }));
          return { fields: rect(fields), help: rect(help), form: rect(card.querySelector('#schedule-override-form')), card: rect(card),
            controls, scrollWidth: card.scrollWidth, clientWidth: card.clientWidth };
        });
        const context = `${language}/${dashboardTheme}/${width}: ${JSON.stringify(layout)}`;
        assert.ok(layout.help.top - layout.fields.bottom >= 12, 'help needs clear space below date inputs: ' + context);
        assert.ok(layout.form.top - layout.help.bottom >= 12, 'adjustment labels must not touch help: ' + context);
        assert.ok(layout.scrollWidth <= layout.clientWidth + 1, 'card must not overflow horizontally: ' + context);
        for (const control of layout.controls) {
          assert.ok(control.bottom - control.top >= 44, 'controls need a consistent accessible height: ' + context);
          if (control.kind !== 'BUTTON') assert.equal(control.bottom - control.top, 44, 'inputs and selects must align');
          assert.ok(control.left >= layout.card.left && control.right <= layout.card.right, 'controls must stay in the card: ' + context);
          assert.ok(control.left >= control.parent.left - 1 && control.right <= control.parent.right + 1, 'controls must stay in their field: ' + context);
        }
      }
    }
    await page.setViewportSize({ width: 1280, height: 1000 });
    const state = Core.emptyState();
    await page.evaluate(state => CampusDesk.receive({ type: 'state', state }), state);
    await page.locator('#holiday-date').fill('2026-10-01');
    await page.locator('[data-action="add-holiday"]').click();
    assert.equal(await page.locator('.schedule-rule-chip').count(), 1);
    const gaps = await page.locator('.schedule-rules-card').evaluate(card => {
      const grid = card.querySelector(':scope > .custom-schedule-grid').getBoundingClientRect();
      const chips = card.querySelector('.schedule-rule-chips').getBoundingClientRect();
      const form = card.querySelector('form').getBoundingClientRect();
      return [chips.top - grid.bottom, form.top - chips.bottom];
    });
    assert.ok(gaps.every(gap => gap >= 12), 'holiday chips need the same section spacing');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[data-action="remove-holiday"]').click();
    assert.equal(await page.locator('.schedule-rules-card > .custom-schedule-note').count(), 1);
    await page.locator('.schedule-rules-card').screenshot({ path: '/tmp/campusdesk-schedule-rules-fixed.png' });
    await page.setViewportSize({ width: 760, height: 1000 });
    await page.locator('.schedule-rules-card').screenshot({ path: '/tmp/campusdesk-schedule-rules-narrow.png' });
    await page.setViewportSize({ width: 1280, height: 1000 });
    assert.equal(await page.locator('#holiday-date').evaluate(el => el.labels.length), 1, 'holiday input has a dedicated accessible label');
    assert.equal(await page.locator('[data-action="add-holiday"]').evaluate(el => el.closest('label')), null, 'button is not nested inside a date input label');
    await page.locator('#override-date').fill('2026-10-02');
    await page.locator('#override-action').focus();
    assert.equal(await page.locator('#override-action').evaluate(el => document.activeElement === el), true);
    await page.locator('#override-target-period').selectOption('P1');
    await page.locator('#override-period').selectOption('P2');
    await page.locator('#override-title').fill('Synthetic lab');
    await page.locator('#override-room').fill('Test room');
    await page.locator('#override-start').fill('09:00');
    await page.locator('#override-end').fill('09:45');
    await page.locator('#schedule-override-form [type="submit"]').click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('campusdesk.browser.v1')));
    assert.deepEqual(saved.settings.scheduleHolidays, []);
    assert.equal(saved.settings.scheduleOverrides.length, 1);
    const change = saved.settings.scheduleOverrides[0];
    assert.deepEqual({ ...change, id: 'ignored' }, { id: 'ignored', date: '2026-10-02', action: 'replace', targetPeriod: 'P1', period: 'P2', title: 'Synthetic lab', room: 'Test room', start: '09:00', end: '09:45' });
    assert.equal(saved.settings.customLessons.length, 0, 'a temporary change must not create weekly lessons');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
