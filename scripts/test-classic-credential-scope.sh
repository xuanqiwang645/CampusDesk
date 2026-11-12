#!/bin/bash
set -euo pipefail
campus_root="$(cd "$(dirname "$0")/.." && pwd)"
campus_payload="${CAMPUSDESK_PATCH_CLASSIC_APP:-$campus_root/build/Build101-Classic/CampusDesk.app}"
campus_identity="${CAMPUSDESK_SIGN_IDENTITY:-$(bash "$campus_root/scripts/local-signing-identity.sh")}"
campus_test="$(mktemp -d /private/tmp/CampusDesk-classic-key-probe.XXXXXX)"
/usr/bin/xcrun swiftc -swift-version 5 -O -j 1 -target arm64-apple-macosx12.0 -framework Security -framework CryptoKit \
 "$campus_root/Sources/AssistantCredentialIdentity.swift" "$campus_root/Sources/AssistantCredentialBridge.swift" \
 "$campus_root/Tests/classic-credential-scope-smoke.swift" -o "$campus_test/Probe"
for campus_id in local.campusdesk.mac local.campusdesk.mac.themeedition; do
 campus_app="$campus_test/$campus_id.app"
 mkdir -p "$campus_app/Contents/MacOS" "$campus_app/Contents/Helpers"
 /usr/bin/ditto "$campus_test/Probe" "$campus_app/Contents/MacOS/Probe"
 /usr/bin/ditto "$campus_payload/Contents/Helpers/CampusDeskCredentials" "$campus_app/Contents/Helpers/CampusDeskCredentials"
 python3 - "$campus_app/Contents/Info.plist" "$campus_id" <<'PYINFO'
import sys,plistlib
from pathlib import Path
Path(sys.argv[1]).write_bytes(plistlib.dumps({'CFBundleIdentifier':sys.argv[2],'CFBundleExecutable':'Probe','CFBundlePackageType':'APPL','CFBundleVersion':'1'}))
PYINFO
 /usr/bin/codesign --force --timestamp=none --sign "$campus_identity" "$campus_app"
 if [[ "$campus_id" == local.campusdesk.mac ]]; then "$campus_app/Contents/MacOS/Probe"; else "$campus_app/Contents/MacOS/Probe" --expect-rejection; fi
done
echo "测试产物：$campus_test"
