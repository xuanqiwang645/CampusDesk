#!/bin/bash
# Shared by build, install, and packaging. Never infer a variant from filenames.
campus_info_plist="${CAMPUSDESK_INFO_PLIST:-$campus_root/Info.plist}"
campus_bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$campus_info_plist")"
case "$campus_bundle_id" in
  local.campusdesk.mac.themeedition) campus_app_name='CampusDesk Theme Edition'; campus_data_name='CampusDesk-local-campusdesk-mac-themeedition' ;;
  local.campusdesk.mac) campus_app_name='CampusDesk'; campus_data_name='CampusDesk' ;;
  *) echo "拒绝构建未知应用标识：$campus_bundle_id" >&2; exit 2 ;;
esac
campus_app_file="$campus_app_name.app"
