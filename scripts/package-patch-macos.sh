#!/bin/bash
# A signed offline updater with identity-preserving payloads for both editions.
set -euo pipefail
umask 077
campus_root="$(cd "$(dirname "$0")/.." && pwd)"
campus_theme="${CAMPUSDESK_PATCH_APP:-$campus_root/build/Build101/CampusDesk Theme Edition.app}"
campus_classic="${CAMPUSDESK_PATCH_CLASSIC_APP:-$campus_root/build/Build101-Classic/CampusDesk.app}"
campus_output="${CAMPUSDESK_PATCH_OUTPUT:-$campus_root/build/releases/v2.0.0-Patch1}"
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || { echo '此补丁需要 Apple Silicon Mac。' >&2; exit 2; }
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$campus_theme/Contents/Info.plist")" == local.campusdesk.mac.themeedition ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$campus_classic/Contents/Info.plist")" == local.campusdesk.mac ]]
for campus_app in "$campus_theme" "$campus_classic"; do /usr/bin/codesign --verify --deep --strict "$campus_app"; done
campus_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$campus_theme/Contents/Info.plist")"
campus_build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$campus_theme/Contents/Info.plist")"
campus_base="CampusDesk-v$campus_version-Tarantula-build$campus_build-Update-Patch1-macOS-arm64"
mkdir -p "$campus_output"
campus_output="$(cd "$campus_output" && pwd)"
for campus_name in "$campus_base.dmg" "$campus_base.zip" PATCH-SHA256SUMS.txt; do
  if [[ -e "$campus_output/$campus_name" ]]; then echo "产物已存在，未覆盖：$campus_output/$campus_name" >&2; exit 3; fi
done
campus_stage="$(mktemp -d /private/tmp/CampusDesk-patch-package.XXXXXX)"
campus_app="$campus_stage/volume/CampusDesk 更新补丁.app"
mkdir -p "$campus_app/Contents/MacOS" "$campus_app/Contents/Resources" "$campus_app/Contents/Helpers"
campus_identity="${CAMPUSDESK_SIGN_IDENTITY:-$(bash "$campus_root/scripts/local-signing-identity.sh")}"
[[ "$campus_identity" != '-' ]] || { echo '补丁需要持久签名身份。' >&2; exit 2; }
/usr/bin/xcrun swiftc -swift-version 5 -Osize -j 1 -target arm64-apple-macosx12.0 -framework Security -framework CryptoKit \
  "$campus_root/Updater/PatchEngine.swift" "$campus_root/Updater/ManifestTool.swift" -o "$campus_stage/manifest-tool"
/usr/bin/ditto --noextattr --norsrc -c -k --keepParent "$campus_theme" "$campus_app/Contents/Resources/Payload-Theme.zip"
/usr/bin/ditto --noextattr --norsrc -c -k --keepParent "$campus_classic" "$campus_app/Contents/Resources/Payload-Classic.zip"
"$campus_stage/manifest-tool" "$campus_theme" "$campus_app/Contents/Resources/Payload-Theme.zip" "$campus_stage/Theme.json"
"$campus_stage/manifest-tool" "$campus_classic" "$campus_app/Contents/Resources/Payload-Classic.zip" "$campus_stage/Classic.json"
"$campus_stage/manifest-tool" --catalog "$campus_stage/Theme.json" "$campus_stage/Classic.json" "$campus_app/Contents/Resources/PatchCatalog.json"
/usr/bin/xcrun swiftc -swift-version 5 -Osize -j 1 -target arm64-apple-macosx12.0 -framework Security -framework CryptoKit \
  "$campus_root/Updater/PatchEngine.swift" "$campus_root/Updater/PatchCleanup.swift" "$campus_root/Updater/CleanupWorker.swift" \
  -o "$campus_app/Contents/Helpers/CampusDeskPatchCleanup"
/usr/bin/codesign --force --timestamp=none --sign "$campus_identity" --identifier local.campusdesk.patch.cleanup "$campus_app/Contents/Helpers/CampusDeskPatchCleanup"
/usr/bin/xcrun swiftc -swift-version 5 -Osize -j 1 -target arm64-apple-macosx12.0 -framework AppKit -framework Security -framework CryptoKit \
  "$campus_root/Updater/PatchEngine.swift" "$campus_root/Updater/PatchCleanup.swift" "$campus_root/Updater/PatchApp.swift" \
  -o "$campus_app/Contents/MacOS/CampusDeskPatch"
cp "$campus_root/Updater/Info.plist" "$campus_app/Contents/Info.plist"
/usr/bin/ditto "$campus_theme/Contents/Resources/AppIcon-ThemeEdition.icns" "$campus_app/Contents/Resources/CampusDesk.icns"
/usr/libexec/PlistBuddy -c 'Add :CFBundleIconFile string CampusDesk' "$campus_app/Contents/Info.plist"
/usr/bin/find "$campus_app" -type d -exec /bin/chmod 755 {} +
/usr/bin/find "$campus_app" -type f -exec /bin/chmod 644 {} +
/bin/chmod 755 "$campus_app/Contents/MacOS/CampusDeskPatch" "$campus_app/Contents/Helpers/CampusDeskPatchCleanup"
/usr/bin/xattr -cr "$campus_app"
/usr/bin/codesign --force --timestamp=none --sign "$campus_identity" "$campus_app"
/usr/bin/codesign --verify --deep --strict "$campus_app"
cp "$campus_root/Updater/使用说明.txt" "$campus_stage/volume/使用说明.txt"
chmod 755 "$campus_stage/volume"
/usr/bin/ditto --noextattr --norsrc -c -k --keepParent "$campus_app" "$campus_output/$campus_base.zip"
/usr/bin/unzip -tq "$campus_output/$campus_base.zip"
/usr/bin/hdiutil create -quiet -volname 'CampusDesk Tarantula 更新补丁' -srcfolder "$campus_stage/volume" -format UDZO "$campus_output/$campus_base.dmg"
(cd "$campus_output"; /usr/bin/shasum -a 256 "$campus_base.dmg" "$campus_base.zip" > PATCH-SHA256SUMS.txt; /usr/bin/shasum -a 256 -c PATCH-SHA256SUMS.txt)
echo "补丁产物：$campus_output"
echo "更新器：$campus_app"
