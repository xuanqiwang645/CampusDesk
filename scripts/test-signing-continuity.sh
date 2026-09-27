#!/bin/bash
# Opt-in real-Keychain test; creates and then removes only one synthetic item.
set -euo pipefail
campus_root="$(cd "$(dirname "$0")/.." && pwd)"
campus_identity="${CAMPUSDESK_SIGN_IDENTITY:-$(bash "$campus_root/scripts/local-signing-identity.sh")}"
campus_fixture_dir="$(mktemp -d /private/tmp/CampusDesk-signing-test.XXXXXX)"
campus_fixture_account="$(/usr/bin/uuidgen)"
campus_fixture_app="$campus_fixture_dir/Test.app"
campus_runner="$campus_fixture_app/Contents/MacOS/runner"
campus_helper="$campus_fixture_app/Contents/Helpers/CampusDeskCredentials"
campus_fixture_created=false
campus_fixture_cleanup() {
  if [[ "$campus_fixture_created" == true ]]; then
    /usr/bin/ditto --noextattr --norsrc "$campus_fixture_dir/first" "$campus_runner-original"
    /bin/mv -f "$campus_runner-original" "$campus_runner"
    /usr/bin/codesign --force --timestamp=none --sign "$campus_identity" "$campus_fixture_app"
    "$campus_runner" delete "$campus_fixture_account" || return 1
  fi
  /bin/rm -f "$campus_fixture_dir/first" "$campus_fixture_dir/second" "$campus_fixture_dir/rejected" "$campus_runner" "$campus_helper" "$campus_fixture_app/Contents/Info.plist" "$campus_fixture_app/Contents/_CodeSignature/CodeResources"
  /bin/rmdir "$campus_fixture_app/Contents/MacOS" "$campus_fixture_app/Contents/Helpers" "$campus_fixture_app/Contents/_CodeSignature" "$campus_fixture_app/Contents" "$campus_fixture_app" "$campus_fixture_dir"
}
trap 'campus_fixture_exit=$?; campus_fixture_cleanup || campus_fixture_exit=1; exit "$campus_fixture_exit"' EXIT
if ! /usr/bin/xcrun --find swiftc >/dev/null 2>&1; then
  export DEVELOPER_DIR=/Library/Developer/CommandLineTools
fi
/bin/mkdir -p "$campus_fixture_app/Contents/MacOS" "$campus_fixture_app/Contents/Helpers" "$campus_fixture_app/Contents/_CodeSignature"
/bin/cp "$campus_root/Tests/SigningFixtureInfo.plist" "$campus_fixture_app/Contents/Info.plist"
/usr/bin/xcrun swiftc -swift-version 5 -Osize -module-name CampusDeskCredentials -target "$(uname -m)-apple-macosx12.0" -D CREDENTIAL_TEST_FIXTURE \
  "$campus_root/Sources/KeychainAccess.swift" "$campus_root/Sources/AssistantCredentialIdentity.swift" \
  "$campus_root/NativeHelpers/CampusDeskCredentials.swift" -o "$campus_helper"
/usr/bin/codesign --force --options runtime --timestamp=none --sign "$campus_identity" \
  --identifier local.campusdesk.mac.credentials "$campus_helper"
for campus_variant in first second; do
  campus_flags=(-D SECOND_BUILD)
  if [[ "$campus_variant" == first ]]; then campus_flags=(-D FIRST_BUILD); fi
  /usr/bin/xcrun swiftc -swift-version 5 -O -D CREDENTIAL_TEST_FIXTURE "${campus_flags[@]}" \
    "$campus_root/Sources/AssistantCredentialIdentity.swift" "$campus_root/Sources/AssistantCredentialBridge.swift" \
    "$campus_root/Tests/signing-continuity-smoke.swift" -o "$campus_fixture_dir/$campus_variant"
  /usr/bin/codesign --force --timestamp=none --sign "$campus_identity" \
    --identifier local.campusdesk.tests.signing-continuity "$campus_fixture_dir/$campus_variant"
done
if /usr/bin/cmp -s "$campus_fixture_dir/first" "$campus_fixture_dir/second"; then
  echo 'FAIL: fixture builds must differ' >&2; exit 1
fi
# A different app signed by the same certificate still cannot use the helper.
/usr/bin/ditto --noextattr --norsrc "$campus_fixture_dir/first" "$campus_fixture_dir/rejected"
/usr/bin/codesign --force --timestamp=none --sign "$campus_identity" \
  --identifier local.campusdesk.tests.wrong-caller "$campus_fixture_dir/rejected"
/usr/bin/ditto --noextattr --norsrc "$campus_fixture_dir/rejected" "$campus_runner"
/usr/bin/codesign --force --timestamp=none --sign "$campus_identity" --identifier local.campusdesk.tests.wrong-caller "$campus_fixture_app"
if "$campus_runner" create "$campus_fixture_account"; then campus_fixture_created=true; echo 'FAIL: unauthorized caller accepted' >&2; exit 1; fi
echo 'PASS: helper rejected a differently identified caller'
/bin/mv "$campus_runner" "$campus_fixture_dir/rejected"
/usr/bin/ditto --noextattr --norsrc "$campus_fixture_dir/first" "$campus_runner"
/usr/bin/codesign --force --timestamp=none --sign "$campus_identity" "$campus_fixture_app"
"$campus_runner" create "$campus_fixture_account"
campus_fixture_created=true
/bin/mv "$campus_fixture_dir/second" "$campus_runner"
/usr/bin/codesign --force --timestamp=none --sign "$campus_identity" "$campus_fixture_app"
"$campus_runner" read "$campus_fixture_account"
"$campus_runner" read "$campus_fixture_account"
echo 'PASS: updated app and relaunch silently reuse the saved key through the unchanged helper'
