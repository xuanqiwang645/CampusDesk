# Local DeepSeek credentials and app updates

The Theme Edition stores API keys only in the macOS Keychain. The renderer sees status, never the saved key. Ordinary sends and status checks are noninteractive.

Local/self-signed apps are assigned a Keychain partition based on their code hash. Reusing a certificate alone does **not** preserve secret access when the main executable or sealed resources change. The real-Keychain regression test reproduced this failure.

`Contents/Helpers/CampusDeskCredentials` therefore owns new credentials. `build.sh` reuses a byte-identical, hardened helper from the per-user `CampusDesk Build Support` cache. The helper source, architecture and signing certificate identify the cache entry. Main-app updates do not rebuild or re-sign it. The app and helper verify each other's certificate, signing identifiers and bundle placement before exchanging native-only pipe messages. Arbitrary services/accounts and other applications are rejected. No ACL is opened to all apps and no certificate trust settings are changed.

Legacy keys require the explicit **Restore key access** action. macOS may ask the user to authorize the old item once. The authorized key is copied to a fresh helper-owned item before the active-account pointer changes; failure/cancellation preserves the original. API-key re-entry is not required for an accessible legacy item. Updating the helper itself or changing the signing certificate can require a new authorization; never silently claim otherwise.

Build normally with `build.sh`; do not ad-hoc re-sign the installation or use `codesign --deep --force` on the finished bundle. Preserve the local signing identity and helper cache. This local signature is not Developer ID notarization or a public-distribution identity.

Tests:

- `node --test Tests/dashboard.test.cjs`: saved-key UI, explicit recovery, draft preservation, no automatic resends.
- `test-native.sh`: synthetic Keychain storage/recovery checks; no real secrets.
- `bash scripts/test-signing-continuity.sh`: opt-in integration test, creates one random synthetic Keychain item, validates unauthorized-caller rejection and updated-app/relaunch reads, then removes that test item. It never reads a user's API key or contacts a model.
