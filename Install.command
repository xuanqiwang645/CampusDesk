#!/bin/bash
set -euo pipefail
campus_root="$(cd "$(dirname "$0")" && pwd)"
trap 'campus_result=$?; if [[ $campus_result -ne 0 ]]; then echo; echo "安装未完成。请保留上方错误信息，以便定位问题。"; fi; echo; read -r -p "按回车关闭此窗口…" campus_answer || true' EXIT
echo 'CampusDesk · 安装到当前用户的应用程序文件夹'
echo '只使用 Mac 内置框架，无需 npm、Python、付费开发者账号或管理员密码。'
/bin/bash "$campus_root/build.sh"
campus_dest="$HOME/Applications/CampusDesk.app"
mkdir -p "$HOME/Applications"
if /usr/bin/pgrep -x CampusDesk >/dev/null 2>&1; then
  echo '请先从菜单栏退出正在运行的 CampusDesk，再重新运行安装器。'
  exit 3
fi
if [[ -e "$campus_dest" ]]; then
  campus_backup="$HOME/Applications/CampusDesk-previous-$(date +%Y%m%d-%H%M%S).app"
  mv "$campus_dest" "$campus_backup"
  echo "旧版本已保留：$campus_backup"
fi
/usr/bin/ditto "$campus_root/build/CampusDesk.app" "$campus_dest"
echo '安装完成。应用将自动打开。'
/usr/bin/open "$campus_dest"
