#!/bin/bash
# Reuse byte-identical helper code across ordinary app/resource updates. macOS
# partitions locally signed Keychain clients by code hash, not just certificate.
set -euo pipefail
umask 077
campus_root="$(cd "$(dirname "$0")/.." && pwd)"
campus_identity="${CAMPUSDESK_SIGN_IDENTITY:?A signing identity is required}"
campus_output="${1:?A helper destination is required}"
campus_arch="$(uname -m)"
campus_sources=("$campus_root/Sources/KeychainAccess.swift" "$campus_root/Sources/AssistantCredentialIdentity.swift" "$campus_root/NativeHelpers/CampusDeskCredentials.swift")
campus_source_hash="$(/usr/bin/shasum -a 256 "${campus_sources[@]}" "$campus_root/scripts/build-credential-helper.sh" | /usr/bin/awk '{print $1}' | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}')"
campus_cache="$HOME/Library/Application Support/CampusDesk Build Support/credentials/$campus_arch/$campus_identity/$campus_source_hash"
campus_requirement="identifier \"local.campusdesk.mac.credentials\" and certificate leaf = H\"$campus_identity\""
if [[ ! -f "$campus_cache/CampusDeskCredentials" ]]; then
  campus_helper_tmp="$(mktemp -d /private/tmp/CampusDesk-credential-build.XXXXXX)"
  trap '/bin/rm -f "$campus_helper_tmp/CampusDeskCredentials"; /bin/rmdir "$campus_helper_tmp"' EXIT
  /usr/bin/xcrun swiftc -swift-version 5 -Osize -j 1 -module-name CampusDeskCredentials \
    -target "$campus_arch-apple-macosx12.0" \
    "${campus_sources[@]}" -o "$campus_helper_tmp/CampusDeskCredentials"
  /usr/bin/codesign --force --options runtime --timestamp=none --sign "$campus_identity" \
    --identifier local.campusdesk.mac.credentials "$campus_helper_tmp/CampusDeskCredentials"
  /usr/bin/codesign --verify --strict -R "=$campus_requirement" "$campus_helper_tmp/CampusDeskCredentials"
  /bin/mkdir -p "$campus_cache"
  /usr/bin/ditto --noextattr --norsrc "$campus_helper_tmp/CampusDeskCredentials" "$campus_cache/CampusDeskCredentials"
  /bin/chmod 500 "$campus_cache/CampusDeskCredentials"
fi
# Never silently replace a damaged or differently signed helper.
/usr/bin/codesign --verify --strict -R "=$campus_requirement" "$campus_cache/CampusDeskCredentials"
/bin/mkdir -p "$(dirname "$campus_output")"
/usr/bin/ditto --noextattr --norsrc "$campus_cache/CampusDeskCredentials" "$campus_output"
/bin/chmod 755 "$campus_output"
