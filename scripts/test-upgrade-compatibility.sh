#!/bin/bash
set -euo pipefail
campus_root="$(cd "$(dirname "$0")/.." && pwd)"
campus_output="${CAMPUSDESK_PATCH_OUTPUT:-$campus_root/build/releases/v2.0.2-Patch1}"
campus_test="$(mktemp -d /private/tmp/CampusDesk-legacy-test-runner.XXXXXX)"
shopt -s nullglob
campus_archives=("$campus_output"/*-Update-Patch1-macOS-arm64.zip)
[[ ${#campus_archives[@]} == 1 ]]
/usr/bin/ditto -x -k "${campus_archives[0]}" "$campus_test/unpacked"
campus_resources="$campus_test/unpacked/CampusDesk 更新补丁.app/Contents/Resources"
/usr/bin/xcrun swiftc -swift-version 5 -O -j 1 -target arm64-apple-macosx12.0 -framework Security -framework CryptoKit \
  "$campus_root/Updater/PatchEngine.swift" "$campus_root/Sources/UpgradeCompatibility.swift" "$campus_root/Sources/SchoolConfig.swift" \
  "$campus_root/Tests/upgrade-compatibility-smoke.swift" -o "$campus_test/legacy-tests"
"$campus_test/legacy-tests" "$campus_resources"
echo "测试产物：$campus_test"
