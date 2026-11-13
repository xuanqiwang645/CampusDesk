'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { launchChromium } = require('./launch-chromium.cjs');
const optional = { skip: !process.env.PLAYWRIGHT_MODULE };

test('plugin controls preserve sharp foreground text and route bounded geometry to the native host', optional, async () => {
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.CampusDeskThemeEdition = true; window.CampusDeskPluginHost = true; window.CampusDeskOpenAI = true;
      window.bridgeMessages = [];
      window.glass = { id: 'campusdesk.liquid-glass', name: 'Liquid Glass', version: '1.0.0', apiVersion: 1, capabilities: ['presentation.surfaces'], supported: true, active: true, settings: { enabled: true, transparency: 20, radius: 24, style: 'regular' } };
      window.webkit = { messageHandlers: { campus: { postMessage(message) {
        bridgeMessages.push(structuredClone(message));
        if (message.action === 'plugin' && ['status', 'configure'].includes(message.operation)) queueMicrotask(() => {
          if (message.operation === 'configure') { Object.assign(glass.settings, message.settings); glass.active = glass.settings.enabled; }
          CampusDeskPlugins.receive({ apiVersion: 1, plugins: [glass] });
        });
      } } } };
    });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../Resources/index.html')).href + '#settings');
    await page.evaluate(() => {
      const state = CampusCore.emptyState(); Object.assign(state.settings, { setupWizardCompleted: true, setupWizardIntroVersion: '', aiProvider: 'openai' });
      CampusDesk.receive({ type: 'state', state });
    });
    await page.locator('#campus-plugin-settings').waitFor();
    await page.locator('[data-plugin-preset="50"]').click();
    assert.equal(await page.locator('[data-plugin-setting="transparency"]').inputValue(), '50');
    const layers = await page.locator('#assistant-settings h2').evaluate(element => ({ opacity: getComputedStyle(element).opacity, filter: getComputedStyle(element).filter }));
    assert.deepEqual(layers, { opacity: '1', filter: 'none' });
    const layout = await page.evaluate(() => bridgeMessages.filter(row => row.action === 'plugin' && row.operation === 'layout').at(-1));
    assert.ok(layout && layout.surfaces.length <= 48 && layout.viewport.width === 1440);
    await page.locator('[data-plugin-setting="enabled"]').uncheck();
    assert.equal(await page.locator('html').evaluate(element => element.classList.contains('native-liquid-glass')), false);
    await page.selectOption('#assistant-provider', 'openai');
    await page.locator('#assistant-openai-key').fill('synthetic-fixture-key');
    await page.locator('[data-action="openai-save-key"]').click();
    assert.equal(await page.locator('#assistant-openai-key').inputValue(), '');
    const saved = await page.evaluate(() => bridgeMessages.find(row => row.action === 'assistantSaveOpenAIKey'));
    assert.equal(saved.key, 'synthetic-fixture-key');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
