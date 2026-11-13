#!/bin/bash
set -euo pipefail
campus_root="$(cd "$(dirname "$0")/.." && pwd)"
campus_output="${CAMPUSDESK_PATCH_OUTPUT:-$campus_root/build/releases/v2.0.1-Patch1}"
campus_payload="${CAMPUSDESK_PATCH_APP:-$campus_root/build/v2.0.1-Theme/CampusDesk Theme Edition.app}"
campus_test="$(mktemp -d /private/tmp/CampusDesk-patch-test-runner.XXXXXX)"
shopt -s nullglob
campus_archives=("$campus_output"/*-Update-Patch1-macOS-arm64.zip)
[[ ${#campus_archives[@]} == 1 ]]
/usr/bin/ditto -x -k "${campus_archives[0]}" "$campus_test/unpacked"
campus_updater="$campus_test/unpacked/CampusDesk 更新补丁.app"
/usr/bin/codesign --verify --deep --strict "$campus_updater"
mkdir -p "$campus_test/inputs"
python3 - "$campus_updater/Contents/Resources" "$campus_test/inputs" <<'PYTEST'
import json,shutil,sys
from pathlib import Path
resources=Path(sys.argv[1]);output=Path(sys.argv[2]);catalog=json.loads((resources/'PatchCatalog.json').read_text());manifest=next(x for x in catalog['variants'] if x['bundleID']=='local.campusdesk.mac.themeedition');(output/'PatchManifest.json').write_text(json.dumps(manifest));shutil.copyfile(resources/'Payload-Theme.zip',output/'Payload.zip')
PYTEST
/usr/bin/xcrun swiftc -swift-version 5 -O -j 1 -target arm64-apple-macosx12.0 -framework Security -framework CryptoKit \
  "$campus_root/Updater/PatchEngine.swift" "$campus_root/Tests/patch-installer-smoke.swift" -o "$campus_test/patch-tests"
campus_arguments=("$campus_test/inputs" "$campus_payload")
if [[ -n "${CAMPUSDESK_PATCH_OLD_APP:-}" ]]; then campus_arguments+=("$CAMPUSDESK_PATCH_OLD_APP"); fi
"$campus_test/patch-tests" "${campus_arguments[@]}"
echo "测试产物：$campus_test"
