#!/bin/bash
# Synthetic local fixtures only: no account, browser, or application data.
set -euo pipefail
campus_root="$(cd "$(dirname "$0")" && pwd)"
if [[ "$(uname -s)" != Darwin ]]; then
  echo '原生测试需要 macOS 和 Apple Command Line Tools。'
  exit 1
fi
if ! /usr/bin/xcrun --find swiftc >/dev/null 2>&1; then
  if [[ -x /Library/Developer/CommandLineTools/usr/bin/swiftc ]] && DEVELOPER_DIR=/Library/Developer/CommandLineTools /usr/bin/xcrun --find swiftc >/dev/null 2>&1; then
    export DEVELOPER_DIR=/Library/Developer/CommandLineTools
  else
    echo '请先配置可用的 Apple Command Line Tools。'
    exit 2
  fi
fi
campus_tests="$(mktemp -d /private/tmp/CampusDesk-tests.XXXXXX)"
campus_arch="$(uname -m)"
/usr/bin/xcrun swiftc -swift-version 5 -O -target "$campus_arch-apple-macosx12.0" \
  -framework Cocoa -framework PDFKit -framework Vision \
  "$campus_root/Sources/TeamsAttachments.swift" "$campus_root/Tests/attachments-smoke.swift" \
  -o "$campus_tests/attachments-smoke"
"$campus_tests/attachments-smoke"
/usr/bin/xcrun swiftc -swift-version 5 -O -target "$campus_arch-apple-macosx12.0" \
  "$campus_root/Sources/TeamsAutoEvents.swift" "$campus_root/Tests/teams-auto-stream-smoke.swift" \
  -o "$campus_tests/teams-auto-stream-smoke"
"$campus_tests/teams-auto-stream-smoke"
/usr/bin/xcrun swiftc -swift-version 5 -O -target "$campus_arch-apple-macosx12.0" \
  "$campus_root/Sources/SchoolConfig.swift" "$campus_root/Tests/school-config-smoke.swift" \
  -o "$campus_tests/school-config-smoke"
"$campus_tests/school-config-smoke"
echo "测试产物：$campus_tests"
