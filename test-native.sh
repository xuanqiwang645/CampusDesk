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
  "$campus_root/Sources/NativeWorkQueue.swift" "$campus_root/Tests/native-work-queue-smoke.swift" \
  -o "$campus_tests/native-work-queue-smoke"
"$campus_tests/native-work-queue-smoke"
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
/usr/bin/xcrun swiftc -swift-version 5 -O -target "$campus_arch-apple-macosx12.0" \
  -framework JavaScriptCore \
  "$campus_root/Sources/SecurityValidation.swift" "$campus_root/Sources/StateValidation.swift" \
  "$campus_root/Tests/state-validation-smoke.swift" -o "$campus_tests/state-validation-smoke"
"$campus_tests/state-validation-smoke" "$campus_root"
/usr/bin/xcrun swiftc -swift-version 5 -O -target "$campus_arch-apple-macosx12.0" \
  -framework JavaScriptCore \
  "$campus_root/Sources/SecurityValidation.swift" "$campus_root/Sources/StateValidation.swift" \
  "$campus_root/Sources/AgendaSnapshot.swift" "$campus_root/Sources/AgendaPublication.swift" "$campus_root/Tests/agenda-native-smoke.swift" \
  -o "$campus_tests/agenda-native-smoke"
"$campus_tests/agenda-native-smoke" "$campus_root"
/usr/bin/xcrun swiftc -swift-version 5 -O -target "$campus_arch-apple-macosx12.0" \
  "$campus_root/Widgets/WidgetSnapshot.swift" "$campus_root/Tests/widget-snapshot-smoke.swift" \
  -o "$campus_tests/widget-snapshot-smoke"
"$campus_tests/widget-snapshot-smoke"
/usr/bin/xcrun swiftc -swift-version 5 -O -target "$campus_arch-apple-macosx12.0" \
  -framework Cocoa -framework AuthenticationServices -framework CryptoKit -framework Security \
  "$campus_root/Sources/KeychainAccess.swift" "$campus_root/Sources/GraphAuth.swift" "$campus_root/Sources/TeamsGraph.swift" \
  "$campus_root/Tests/graph-token-error-smoke.swift" -o "$campus_tests/graph-token-error-smoke"
"$campus_tests/graph-token-error-smoke"
/usr/bin/xcrun swiftc -swift-version 5 -O -target "$campus_arch-apple-macosx12.0" \
  "$campus_root/Sources/KeychainAccess.swift" "$campus_root/Sources/SecurityValidation.swift" \
  "$campus_root/Sources/AssistantCredentialIdentity.swift" "$campus_root/Sources/AssistantCredentialBridge.swift" \
  "$campus_root/Sources/AssistantKeyStore.swift" "$campus_root/Sources/AssistantAI.swift" \
  "$campus_root/Sources/AssistantTransport.swift" "$campus_root/Sources/AssistantModels.swift" \
  "$campus_root/Tests/assistant-keychain-smoke.swift" \
  -o "$campus_tests/assistant-keychain-smoke"
"$campus_tests/assistant-keychain-smoke"
/usr/bin/xcrun swiftc -swift-version 5 -O -target "$campus_arch-apple-macosx12.0" \
  "$campus_root/Sources/AssistantTransport.swift" "$campus_root/Sources/AssistantModels.swift" "$campus_root/Tests/assistant-models-smoke.swift" \
  -o "$campus_tests/assistant-models-smoke"
"$campus_tests/assistant-models-smoke"
/usr/bin/xcrun swiftc -swift-version 5 -O -target "$campus_arch-apple-macosx12.0" \
  "$campus_root/Sources/KeychainAccess.swift" "$campus_root/Sources/SecurityValidation.swift" \
  "$campus_root/Sources/AssistantCredentialIdentity.swift" "$campus_root/Sources/AssistantCredentialBridge.swift" \
  "$campus_root/Sources/AssistantKeyStore.swift" "$campus_root/Sources/AssistantAI.swift" \
  "$campus_root/Sources/AssistantTransport.swift" "$campus_root/Sources/AssistantModels.swift" \
  "$campus_root/Tests/assistant-stream-smoke.swift" -o "$campus_tests/assistant-stream-smoke"
"$campus_tests/assistant-stream-smoke"
/usr/bin/xcrun swiftc -swift-version 5 -O -target "$campus_arch-apple-macosx12.0" \
  "$campus_root/Sources/AssistantSetupGuide.swift" "$campus_root/Tests/assistant-setup-smoke.swift" \
  -o "$campus_tests/assistant-setup-smoke"
"$campus_tests/assistant-setup-smoke"
echo "测试产物：$campus_tests"
