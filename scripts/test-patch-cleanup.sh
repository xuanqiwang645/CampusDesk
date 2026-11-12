#!/bin/bash
set -euo pipefail
campus_root="$(cd "$(dirname "$0")/.." && pwd)"
campus_output="${CAMPUSDESK_PATCH_OUTPUT:-$campus_root/build/releases/v2.0.0-Patch1}"
campus_payload="${CAMPUSDESK_PATCH_APP:-$campus_root/build/Build101/CampusDesk Theme Edition.app}"
campus_test="$(mktemp -d /private/tmp/CampusDesk-cleanup-test-runner.XXXXXX)"
shopt -s nullglob
campus_archives=("$campus_output"/*-Update-Patch1-macOS-arm64.zip)
[[ ${#campus_archives[@]} == 1 ]]
/usr/bin/ditto -x -k "${campus_archives[0]}" "$campus_test/unpacked"
campus_updater="$campus_test/unpacked/CampusDesk 更新补丁.app"
/usr/bin/xcrun swiftc -swift-version 5 -O -j 1 -target arm64-apple-macosx12.0 -framework Security -framework CryptoKit \
  "$campus_root/Updater/PatchEngine.swift" "$campus_root/Updater/PatchCleanup.swift" "$campus_root/Tests/patch-cleanup-smoke.swift" -o "$campus_test/cleanup-tests"
"$campus_test/cleanup-tests" "$campus_updater" "$campus_payload"
echo "测试产物：$campus_test"
