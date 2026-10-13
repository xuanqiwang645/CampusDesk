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
