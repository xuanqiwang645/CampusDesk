'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../Resources/core.js');

test('new appearance settings preserve the existing manual sage default', () => {
  const state = Core.emptyState();
  assert.equal(state.settings.appearanceMode, 'manual');
  assert.equal(state.settings.colorTheme, 'sage');
  assert.equal(state.settings.dayColorTheme, 'sage');
  assert.equal(Core.effectiveColorTheme(state.settings, true), 'sage');
  assert.deepEqual(Core.validateState(state), state);
});

test('legacy themes migrate without changing their appearance or input data', () => {
  for (const theme of [undefined, 'sage', 'ocean', 'ember', 'midnight']) {
    const legacy = Core.emptyState();
    delete legacy.settings.appearanceMode;
    delete legacy.settings.dayColorTheme;
    if (theme === undefined) delete legacy.settings.colorTheme;
    else legacy.settings.colorTheme = theme;
    const original = structuredClone(legacy);
    const migrated = Core.validateState(legacy);
    assert.equal(migrated.settings.appearanceMode, 'manual');
    assert.equal(migrated.settings.colorTheme, theme || 'sage');
    assert.equal(migrated.settings.dayColorTheme, theme && theme !== 'midnight' ? theme : 'sage');
    assert.equal(Core.effectiveColorTheme(migrated.settings, true), theme || 'sage');
    assert.deepEqual(legacy, original);
  }
});

test('system appearance resolves day and night without mutating either saved theme', () => {
  for (const dayColorTheme of ['sage', 'ocean', 'ember']) {
    const settings = Object.freeze({ appearanceMode: 'system', colorTheme: 'ember', dayColorTheme });
    const original = { ...settings };
    for (const systemDark of [false, true, false, true, false]) {
      assert.equal(Core.effectiveColorTheme(settings, systemDark), systemDark ? 'midnight' : dayColorTheme);
    }
    assert.deepEqual(settings, original);
  }
});

test('manual appearance is independent of system mode and saved daytime preference', () => {
  for (const colorTheme of ['sage', 'ocean', 'ember', 'midnight']) {
    const settings = { appearanceMode: 'manual', colorTheme, dayColorTheme: 'ocean' };
    assert.equal(Core.effectiveColorTheme(settings, false), colorTheme);
    assert.equal(Core.effectiveColorTheme(settings, true), colorTheme);
  }
});

test('appearance preferences survive backup export and import after system changes', () => {
  const state = Core.emptyState();
  Object.assign(state.settings, { appearanceMode: 'system', colorTheme: 'midnight', dayColorTheme: 'ocean' });
  Core.effectiveColorTheme(state.settings, false);
  Core.effectiveColorTheme(state.settings, true);
  const restored = Core.importBackup(JSON.stringify(Core.exportBackup(state))).state;
  assert.equal(restored.settings.appearanceMode, 'system');
  assert.equal(restored.settings.colorTheme, 'midnight');
  assert.equal(restored.settings.dayColorTheme, 'ocean');
  assert.equal(Core.effectiveColorTheme(restored.settings, false), 'ocean');
  assert.equal(Core.effectiveColorTheme(restored.settings, true), 'midnight');
  const legacy = Core.emptyState();
  Object.assign(legacy.settings, { colorTheme: 'ember' });
  delete legacy.settings.appearanceMode;
  delete legacy.settings.dayColorTheme;
  assert.equal(Core.importBackup(legacy, { allowLegacy: true }).state.settings.dayColorTheme, 'ember');
});

test('invalid appearance enums reject direct state and backup import or export', () => {
  const cases = [
    ['appearanceMode', ['auto', 'dark', '', null, false, 1, [], {}], /外观切换方式无效/],
    ['dayColorTheme', ['midnight', 'unknown', '', null, false, 1, [], {}], /日间主题配色无效/],
    ['colorTheme', ['system', 'unknown', '', null, false, 1, [], {}], /主题配色无效/]
  ];
  for (const [key, invalidValues, error] of cases) for (const value of invalidValues) {
    const state = Core.emptyState();
    state.settings[key] = value;
    assert.throws(() => Core.validateState(state), error);
    assert.throws(() => Core.exportBackup(state), error);
    assert.throws(() => Core.importBackup({ app: 'CampusDesk', edition: 'standard', schemaVersion: 1, data: state }), error);
  }
});

test('theme resolution handles unnormalized settings with safe defaults', () => {
  for (const settings of [undefined, null, false, 'midnight', [], {}]) {
    assert.equal(Core.effectiveColorTheme(settings, true), 'sage');
  }
  assert.equal(Core.effectiveColorTheme({ colorTheme: 'ocean' }, true), 'ocean');
  assert.equal(Core.effectiveColorTheme({ appearanceMode: 'invalid', colorTheme: 'midnight' }, false), 'midnight');
  assert.equal(Core.effectiveColorTheme({ appearanceMode: 'system', colorTheme: 'ember' }, false), 'ember');
  assert.equal(Core.effectiveColorTheme({ appearanceMode: 'system', colorTheme: 'midnight', dayColorTheme: 'midnight' }, false), 'sage');
  assert.equal(Core.effectiveColorTheme({ appearanceMode: 'system' }, true), 'midnight');
  assert.equal(Core.effectiveColorTheme({ appearanceMode: 'system' }, 'true'), 'sage');
});
