#!/bin/bash
set -euo pipefail
umask 077
campus_root="$(cd "$(dirname "$0")" && pwd)"
trap 'campus_result=$?; if [[ $campus_result -ne 0 ]]; then echo; echo "安装未完成。请保留上方错误信息，以便定位问题。"; fi; echo; read -r -p "按回车关闭此窗口…" campus_answer || true' EXIT
echo 'CampusDesk · 安装到当前用户的应用程序文件夹'
echo '只使用 Mac 内置框架，无需 npm、Python、付费开发者账号或管理员密码。'
campus_dest="$HOME/Applications/CampusDesk.app"
if /usr/bin/pgrep -x CampusDesk >/dev/null 2>&1; then
  echo '请先从菜单栏退出正在运行的 CampusDesk，再重新运行安装器。'
  exit 3
fi
# Build outside cloud-synced folders to avoid FinderInfo invalidating signing.
campus_build_dir="$(mktemp -d /private/tmp/CampusDesk-build.XXXXXX)"
CAMPUSDESK_BUILD_DIR="$campus_build_dir" /bin/bash "$campus_root/build.sh"
mkdir -p "$HOME/Applications"
campus_stage="$(mktemp -d "$HOME/Applications/.CampusDesk-install.XXXXXX")"
/usr/bin/ditto --noextattr --norsrc "$campus_build_dir/CampusDesk.app" "$campus_stage/CampusDesk.app"
/usr/bin/codesign --verify --deep --strict "$campus_stage/CampusDesk.app"
if /usr/bin/pgrep -x CampusDesk >/dev/null 2>&1; then
  echo '编译期间 CampusDesk 已启动。请退出后重试；现有应用与数据尚未更改。'
  exit 3
fi
campus_backup_root="$HOME/Library/Application Support/CampusDesk Backups"
mkdir -p "$campus_backup_root"
campus_backup="$(mktemp -d "$campus_backup_root/$(date +%Y%m%d-%H%M%S).XXXXXX")"
campus_data="$HOME/Library/Application Support/CampusDesk"
if [[ -d "$campus_data" ]]; then
  /usr/bin/ditto "$campus_data" "$campus_backup/Data"
fi
if [[ -e "$campus_dest" || -L "$campus_dest" ]]; then
  /bin/mv "$campus_dest" "$campus_backup/CampusDesk.app"
fi
if ! /bin/mv "$campus_stage/CampusDesk.app" "$campus_dest"; then
  if [[ -e "$campus_backup/CampusDesk.app" || -L "$campus_backup/CampusDesk.app" ]]; then
    /bin/mv "$campus_backup/CampusDesk.app" "$campus_dest"
  fi
  echo '替换失败，旧版应用已尝试恢复；请核对上方错误。'
  exit 4
fi
# Remove only the now-empty staging directory; keep build output and backups.
/bin/rmdir "$campus_stage"
echo "旧版本与数据备份（如原来存在）：$campus_backup"
echo '安装完成。应用将自动打开。'
/usr/bin/open "$campus_dest"
