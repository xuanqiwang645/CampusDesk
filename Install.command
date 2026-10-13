#!/bin/bash
set -euo pipefail
umask 077
campus_root="$(cd "$(dirname "$0")" && pwd)"
source "$campus_root/scripts/app-identity.sh"
trap 'campus_result=$?; if [[ $campus_result -ne 0 ]]; then echo; echo "安装未完成。请保留上方错误信息，以便定位问题。"; fi; echo; read -r -p "按回车关闭此窗口…" campus_answer || true' EXIT
echo 'CampusDesk · 安装到当前用户的应用程序文件夹'
echo '只使用 Mac 内置框架，无需 npm、Python、付费开发者账号或管理员密码。'
campus_dest="$HOME/Applications/$campus_app_file"
campus_is_running() {
  /usr/bin/osascript -l JavaScript -e 'ObjC.import("AppKit"); function run(argv) { const apps=$.NSWorkspace.sharedWorkspace.runningApplications; for(let i=0;i<apps.count;i++){ const id=apps.objectAtIndex(i).bundleIdentifier; if(id && ObjC.unwrap(id)===argv[0]) return "running"; } return "stopped"; }' "$campus_bundle_id"
}
if [[ "$(campus_is_running)" == running ]]; then
  echo "请先退出 $campus_app_name，再重新运行安装器。另一版本无需退出。"
  exit 3
fi
# Build outside cloud-synced folders to avoid FinderInfo invalidating signing.
campus_build_dir="$(mktemp -d /private/tmp/CampusDesk-build.XXXXXX)"
CAMPUSDESK_BUILD_DIR="$campus_build_dir" /bin/bash "$campus_root/build.sh"
mkdir -p "$HOME/Applications"
campus_stage="$(mktemp -d "$HOME/Applications/.CampusDesk-install.XXXXXX")"
/usr/bin/ditto --noextattr --norsrc "$campus_build_dir/$campus_app_file" "$campus_stage/$campus_app_file"
/usr/bin/codesign --verify --deep --strict "$campus_stage/$campus_app_file"
if [[ "$(campus_is_running)" == running ]]; then
  echo '编译期间 CampusDesk 已启动。请退出后重试；现有应用与数据尚未更改。'
  exit 3
fi
campus_backup_root="$HOME/Library/Application Support/$campus_data_name Backups"
mkdir -p "$campus_backup_root"
campus_backup="$(mktemp -d "$campus_backup_root/$(date +%Y%m%d-%H%M%S).XXXXXX")"
campus_data="$HOME/Library/Application Support/$campus_data_name"
if [[ -d "$campus_data" ]]; then
  /usr/bin/ditto "$campus_data" "$campus_backup/Data"
fi
if [[ -e "$campus_dest" || -L "$campus_dest" ]]; then
  campus_existing_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$campus_dest/Contents/Info.plist")"
  if [[ "$campus_existing_id" != "$campus_bundle_id" || -L "$campus_dest" ]]; then
    echo "安装位置不是预期的 $campus_app_name，未替换。"; exit 4
  fi
  /bin/mv "$campus_dest" "$campus_backup/$campus_app_file"
fi
if ! /bin/mv "$campus_stage/$campus_app_file" "$campus_dest"; then
  if [[ -e "$campus_backup/$campus_app_file" ]]; then
    /bin/mv "$campus_backup/$campus_app_file" "$campus_dest"
  fi
  echo '替换失败，旧版应用已尝试恢复；请核对上方错误。'
  exit 4
fi
# Remove only the now-empty staging directory; keep build output and backups.
/bin/rmdir "$campus_stage"
echo "旧版本与数据备份（如原来存在）：$campus_backup"
echo '安装完成。应用将自动打开。'
/usr/bin/open "$campus_dest"
