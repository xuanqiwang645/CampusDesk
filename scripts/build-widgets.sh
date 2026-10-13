#!/bin/bash
set -euo pipefail
umask 022
campus_widget_root="$(cd "$(dirname "$0")/.." && pwd)"
campus_widget_app="${1:?Usage: build-widgets.sh /absolute/path/to/CampusDesk.app}"
campus_widget_identity="${CAMPUSDESK_SIGN_IDENTITY:?Use the same persistent signing identity as the host app}"
if [[ "$campus_widget_app" != /* || ! -f "$campus_widget_app/Contents/Info.plist" ]]; then
  echo 'Widget host must be an existing app bundle at an absolute path.' >&2
  exit 2
fi
campus_widget_bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$campus_widget_app/Contents/Info.plist")"
if [[ "$campus_widget_bundle_id" != 'local.campusdesk.mac.themeedition' ]]; then
  echo 'CampusDesk widgets are available only for Theme Edition.' >&2
  exit 2
fi
campus_widget_arch="$(uname -m)"
case "$campus_widget_arch" in arm64|x86_64) ;; *) exit 2;; esac
campus_widget_output="$campus_widget_app/Contents/PlugIns/CampusDeskWidgets.appex"
mkdir -p "$campus_widget_output/Contents/MacOS" "$campus_widget_output/Contents/Resources"
/usr/bin/xcrun swiftc -swift-version 5 -Osize -j 1 -parse-as-library -application-extension \
  -target "$campus_widget_arch-apple-macosx14.0" -framework Foundation -framework SwiftUI -framework WidgetKit \
  -Xlinker -e -Xlinker _NSExtensionMain \
  "$campus_widget_root/Widgets/WidgetSnapshot.swift" "$campus_widget_root/Widgets/CampusDeskWidgets.swift" \
  -o "$campus_widget_output/Contents/MacOS/CampusDeskWidgets"
# WidgetKit's Swift @main is invoked by NSExtensionMain after the extension
# runtime is initialized. Entering Swift main directly crashes at bootstrap,
# even though PlugInKit registration and offline SwiftUI previews succeed.
/bin/cp "$campus_widget_root/Widgets/Info.plist" "$campus_widget_output/Contents/Info.plist"
for campus_widget_key in CFBundleShortVersionString CFBundleVersion; do
  campus_widget_value="$(/usr/libexec/PlistBuddy -c "Print :$campus_widget_key" "$campus_widget_app/Contents/Info.plist")"
  /usr/libexec/PlistBuddy -c "Set :$campus_widget_key $campus_widget_value" "$campus_widget_output/Contents/Info.plist"
done
/usr/bin/codesign --force --timestamp=none --sign "$campus_widget_identity" \
  --entitlements "$campus_widget_root/Widgets/Widget.entitlements" "$campus_widget_output"
/usr/bin/codesign --verify --strict "$campus_widget_output"
echo "Widget extension built: $campus_widget_output"
