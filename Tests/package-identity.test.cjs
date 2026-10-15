'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
test('build and installer derive an exact, distinct app and data directory for each edition', { skip: process.platform !== 'darwin' }, () => {
  for (const [plist, app, data] of [
    ['Info.plist', 'CampusDesk.app', 'CampusDesk'],
    ['Info-ThemeEdition.plist', 'CampusDesk Theme Edition.app', 'CampusDesk-local-campusdesk-mac-themeedition']
  ]) {
    const output = execFileSync('/bin/bash', ['-c', 'campus_root="$1"; source "$campus_root/scripts/app-identity.sh"; printf "%s\\n%s\\n" "$campus_app_file" "$campus_data_name"', 'test', root], { env: { ...process.env, CAMPUSDESK_INFO_PLIST: path.join(root, plist) }, encoding: 'utf8' });
    assert.deepEqual(output.trim().split('\n'), [app, data]);
  }
  const installer = fs.readFileSync(path.join(root, 'Install.command'), 'utf8');
  assert.doesNotMatch(installer, /pgrep -x CampusDesk/);
  assert.match(installer, /bundleIdentifier/);
  assert.match(installer, /campus_existing_id/);
  assert.match(installer, /campus_data_name/);
});
test('package script creates portable hashes and never silently overwrites existing artifacts', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/package-macos.sh'), 'utf8');
  assert.match(source, /cd "\$campus_output"[\s\S]*shasum -a 256 "\$campus_base\.dmg" "\$campus_base\.zip" > SHA256SUMS\.txt/);
  assert.match(source, /产物已存在，未覆盖/);
  assert.match(source, /keepParent "\$campus_app"/);
});
test('Theme release metadata agrees across the host, widget and browser fallback', () => {
  const field = (file, key) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    return new RegExp('<key>' + key + '</key>\\s*<string>([^<]+)</string>').exec(source)?.[1];
  };
  const version = field('Info-ThemeEdition.plist', 'CFBundleShortVersionString');
  const name = field('Info-ThemeEdition.plist', 'CampusDeskReleaseName');
  const build = field('Info-ThemeEdition.plist', 'CFBundleVersion');
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.ok(name);
  assert.match(build, /^\d+$/);
  for (const key of ['CFBundleShortVersionString', 'CFBundleVersion']) {
    assert.equal(field('Widgets/Info.plist', key), field('Info-ThemeEdition.plist', key));
  }
  assert.equal(field('Info-ThemeEdition.plist', 'CFBundleGetInfoString'), 'CampusDesk Theme Edition v' + version + ' ' + name);
  const dashboard = fs.readFileSync(path.join(root, 'Resources/dashboard.js'), 'utf8');
  assert.ok(dashboard.includes("version: themeEdition ? '" + version + "'"));
  assert.ok(dashboard.includes("name: themeEdition ? '" + name + "'"));
});
