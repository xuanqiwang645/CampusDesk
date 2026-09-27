#!/bin/bash
# A persistent certificate authenticates the app to its stable Keychain helper.
# No API keys are read, no system trust settings are changed, and the private
# signing key stays in the user's Keychain (non-exportable, codesign access only).
set -euo pipefail
umask 077
campus_scripts="$(cd "$(dirname "$0")" && pwd)"
campus_identity_name='CampusDesk Local Development'
campus_keychain="${CAMPUSDESK_SIGNING_KEYCHAIN:-$(/usr/bin/security default-keychain -d user | /usr/bin/sed -e 's/^[[:space:]]*"//' -e 's/"[[:space:]]*$//')}"
if [[ ! -f "$campus_keychain" ]]; then
  echo '无法访问用户钥匙串，已停止签名。' >&2
  exit 1
fi
campus_find_identity() {
  /usr/bin/security find-identity -p codesigning "$campus_keychain" |
    /usr/bin/awk -v label="\"$campus_identity_name\"" 'index($0,label) && length($2)==40 { print $2; exit }'
}
campus_identity="$(campus_find_identity)"
if [[ -z "$campus_identity" ]]; then
  if /usr/bin/security find-certificate -c "$campus_identity_name" "$campus_keychain" >/dev/null 2>&1; then
    echo '已有 CampusDesk 签名证书，但私钥暂不可用。请解锁钥匙串后重试；不会生成新的身份。' >&2
    exit 1
  fi
  campus_signing_tmp="$(mktemp -d /private/tmp/CampusDesk-signing.XXXXXX)"
  trap '/bin/rm -f "$campus_signing_tmp/signing.key" "$campus_signing_tmp/signing.rsa" "$campus_signing_tmp/signing.crt"; /bin/rmdir "$campus_signing_tmp"' EXIT
  /usr/bin/openssl req -x509 -newkey rsa:3072 -nodes -days 3650 \
    -config "$campus_scripts/local-signing.cnf" \
    -keyout "$campus_signing_tmp/signing.key" -out "$campus_signing_tmp/signing.crt" 2>/dev/null
  # macOS's OpenSSL importer expects PKCS#1, while req may output PKCS#8.
  /usr/bin/openssl rsa -in "$campus_signing_tmp/signing.key" -out "$campus_signing_tmp/signing.rsa" 2>/dev/null
  /usr/bin/security import "$campus_signing_tmp/signing.rsa" -k "$campus_keychain" -t priv -f openssl -x -T /usr/bin/codesign >&2
  /usr/bin/security import "$campus_signing_tmp/signing.crt" -k "$campus_keychain" -t cert -f pemseq >&2
  campus_identity="$(campus_find_identity)"
fi
if [[ ! "$campus_identity" =~ ^[[:xdigit:]]{40}$ ]]; then
  echo '未能获得稳定的 CampusDesk 签名身份，已停止构建。' >&2
  exit 1
fi
printf '%s\n' "$campus_identity"
