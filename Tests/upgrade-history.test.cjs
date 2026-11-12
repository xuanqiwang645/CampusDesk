'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.resolve(__dirname, '..');
test('upgrading a pre-marker profile cannot execute historical login or cookie reset code', () => {
  const source = fs.readFileSync(path.join(root, 'Sources/main.swift'), 'utf8');
  const migration = source.slice(source.indexOf('func prepareThemeEditionFreshSetup()'), source.indexOf('func applicationShouldTerminateAfterLastWindowClosed'));
  assert.ok(migration.length > 0);
  assert.doesNotMatch(migration, /signOut\(|deleteDeepSeekKey\(|removeData\(|removeItem\(|setupWizardCompleted.*false/);
});
test('all released legacy state models retain coursework and completed marks in the v2 reader', () => {
  const current = { CampusDeskThemeEdition: true, URL, Intl, console }; current.globalThis = current;
  vm.createContext(current); vm.runInContext(fs.readFileSync(path.join(root, 'Resources/core.js'), 'utf8'), current);
  const tags = execFileSync('git', ['tag', '--list'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  let count = 0;
  for (const tag of tags) {
    const source = execFileSync('git', ['show', tag + ':Resources/core.js'], { cwd: root, encoding: 'utf8' });
    const context = { URL, Intl, console }; context.globalThis = context; vm.createContext(context); vm.runInContext(source, context);
    const old = JSON.parse(JSON.stringify(context.CampusCore.emptyState()));
    old.manualTasks = [{ id: 'legacy-task', title: 'Preserve my coursework', status: 'open', dueAt: null, course: 'Original course' }];
    old.taskChecks = { 'legacy-task': true };
    current.legacyStateJSON = JSON.stringify(old);
    const migrated = vm.runInContext('CampusCore.validateState(JSON.parse(legacyStateJSON))', current);
    assert.equal(migrated.manualTasks[0].title, 'Preserve my coursework', tag);
    assert.equal(migrated.taskChecks['legacy-task'], true, tag);
    assert.equal(migrated.settings.taskReviewPanelCollapsed, false, tag);
    count++;
  }
  assert.ok(count >= 15, 'cover the public source tags rather than only the newest fixture');
});
