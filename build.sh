#!/bin/bash
set -euo pipefail
campus_root="$(cd "$(dirname "$0")" && pwd)"
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo 'CampusDesk 需要在 Mac 上编译（macOS 12 或更新版本）。'
  exit 1
fi
campus_major="$(sw_vers -productVersion | cut -d . -f 1)"
if [[ "$campus_major" -lt 12 ]]; then
  echo '请使用 macOS 12 或更新版本。'
  exit 1
fi
if ! /usr/bin/xcrun --find swiftc >/dev/null 2>&1; then
  echo '需要 Apple Command Line Tools。安装完成后重新运行 Install.command。'
  /usr/bin/xcode-select --install || true
  exit 2
fi
campus_arch="$(uname -m)"
case "$campus_arch" in arm64|x86_64) ;; *) echo "暂不支持此芯片架构：$campus_arch"; exit 1;; esac
campus_build="$campus_root/build/CampusDesk.app"
mkdir -p "$campus_build/Contents/MacOS" "$campus_build/Contents/Resources"
/usr/bin/xcrun swiftc -swift-version 5 -O -target "$campus_arch-apple-macosx12.0" \
  -framework Cocoa -framework WebKit \
  "$campus_root/Sources/main.swift" -o "$campus_build/Contents/MacOS/CampusDesk"
/usr/bin/ditto "$campus_root/Resources" "$campus_build/Contents/Resources"
/bin/cp "$campus_root/Info.plist" "$campus_build/Contents/Info.plist"
/usr/bin/xattr -cr "$campus_build"
/usr/bin/xattr -d com.apple.FinderInfo "$campus_build" 2>/dev/null || true
/usr/bin/xattr -d "com.apple.fileprovider.fpfs#P" "$campus_build" 2>/dev/null || true
/usr/bin/codesign --force --deep --sign - "$campus_build"
/usr/bin/codesign --verify --deep --strict "$campus_build"
echo "编译完成：$campus_build"
