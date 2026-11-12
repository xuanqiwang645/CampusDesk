'use strict';
const { launchChromium } = require('./launch-chromium.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const Core = require('../Resources/core.js');

test('automatic appearance follows live system colors without replacing active inputs or saving a dark preference', { skip: !process.env.PLAYWRIGHT_MODULE }, async () => {
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 1220, height: 850 }, colorScheme: 'light' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const state = Core.emptyState();
    Object.assign(state.settings, { dashboardTheme: 'board', appearanceMode: 'system', colorTheme: 'ocean', dayColorTheme: 'ocean' });
    await page.addInitScript(state => {
      if (!localStorage.getItem('campusdesk.browser.v1')) localStorage.setItem('campusdesk.browser.v1', JSON.stringify(state));
    }, state);
    await page.goto(pathToFileURL(path.resolve(__dirname, '../Resources/index.html')).href + '#settings');
    await page.waitForFunction(() => document.documentElement.dataset.colorTheme === 'ocean');
    assert.equal(await page.locator('#appearance-mode').inputValue(), 'system');
    assert.equal(await page.locator('#appearance-settings [data-action="color-theme"]').count(), 3);
    const output = process.env.APPEARANCE_PREVIEW_DIR;
    if (output) { fs.mkdirSync(output, { recursive: true }); await page.locator('#appearance-settings').screenshot({ path: path.join(output, 'light.png') }); }
    await page.locator('#settings-easter-egg-password').fill('unfinished');
    await page.locator('#settings-easter-egg-password').evaluate(el => { window.appearanceInput = el; el.focus(); });
    const stored = await page.evaluate(() => localStorage.getItem('campusdesk.browser.v1'));
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.documentElement.dataset.colorTheme === 'midnight');
    assert.equal(await page.evaluate(() => document.activeElement === window.appearanceInput && document.getElementById('settings-easter-egg-password') === window.appearanceInput), true);
    assert.equal(await page.locator('#settings-easter-egg-password').inputValue(), 'unfinished');
    assert.equal(await page.evaluate(() => localStorage.getItem('campusdesk.browser.v1')), stored);
    assert.equal(await page.locator('html').evaluate(el => getComputedStyle(el).colorScheme), 'dark');
    assert.match(await page.locator('#appearance-status').textContent(), /深色/);
    if (output) await page.locator('#appearance-settings').screenshot({ path: path.join(output, 'dark.png') });
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.colorTheme === 'midnight');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => document.documentElement.dataset.colorTheme === 'ocean');
    await page.locator('#appearance-mode').selectOption('manual');
    await page.emulateMedia({ colorScheme: 'dark' });
    assert.equal(await page.locator('html').getAttribute('data-color-theme'), 'ocean');
    await page.locator('[data-action="color-theme"][data-theme="midnight"]').click();
    await page.emulateMedia({ colorScheme: 'light' });
    assert.equal(await page.locator('html').getAttribute('data-color-theme'), 'midnight');
    await page.locator('#appearance-mode').selectOption('system');
    await page.waitForFunction(() => document.documentElement.dataset.colorTheme === 'ocean');
    for (const width of [900, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.locator('#appearance-settings').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
      assert.ok(layout.scroll <= layout.width + 1, 'appearance controls fit at ' + width);
      if (output && width === 390) await page.locator('#appearance-settings').screenshot({ path: path.join(output, 'narrow.png') });
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
