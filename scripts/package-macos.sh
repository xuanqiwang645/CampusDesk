#!/bin/bash
set -euo pipefail
umask 077
campus_root="$(cd "$(dirname "$0")/.." && pwd)"
source "$campus_root/scripts/app-identity.sh"
campus_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$campus_info_plist")"
campus_build_number="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$campus_info_plist")"
campus_output="${CAMPUSDESK_PACKAGE_DIR:-$(mktemp -d /private/tmp/CampusDesk-package.XXXXXX)}"
mkdir -p "$campus_output"
campus_output="$(cd "$campus_output" && pwd)"
campus_build_dir="${CAMPUSDESK_BUILD_DIR:-$(mktemp -d /private/tmp/CampusDesk-release-build.XXXXXX)}"
if [[ "${CAMPUSDESK_SKIP_BUILD:-0}" != 1 ]]; then
  CAMPUSDESK_BUILD_DIR="$campus_build_dir" CAMPUSDESK_INFO_PLIST="$campus_info_plist" bash "$campus_root/build.sh"
fi
campus_app="$campus_build_dir/$campus_app_file"
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$campus_app/Contents/Info.plist")" == "$campus_bundle_id" ]]
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$campus_app/Contents/Info.plist")" == "$campus_build_number" ]]
/usr/bin/codesign --verify --deep --strict "$campus_app"
campus_base="${campus_app_name// /-}-v$campus_version-build$campus_build_number-macOS-$(uname -m)"
for campus_file in "$campus_base.zip" "$campus_base.dmg" SHA256SUMS.txt; do
  if [[ -e "$campus_output/$campus_file" ]]; then echo "产物已存在，未覆盖：$campus_output/$campus_file" >&2; exit 3; fi
done
campus_stage="$(mktemp -d /private/tmp/CampusDesk-dmg.XXXXXX)"
chmod 755 "$campus_stage"
/usr/bin/ditto --noextattr --norsrc "$campus_app" "$campus_stage/$campus_app_file"
ln -s /Applications "$campus_stage/Applications"
/usr/bin/ditto --noextattr --norsrc -c -k --keepParent "$campus_app" "$campus_output/$campus_base.zip"
/usr/bin/unzip -tq "$campus_output/$campus_base.zip"
/usr/bin/hdiutil create -quiet -volname "$campus_app_name" -srcfolder "$campus_stage" -format UDZO "$campus_output/$campus_base.dmg"
cd "$campus_output"
/usr/bin/shasum -a 256 "$campus_base.dmg" "$campus_base.zip" > SHA256SUMS.txt
/usr/bin/shasum -a 256 -c SHA256SUMS.txt
echo "安装包：$campus_output"
