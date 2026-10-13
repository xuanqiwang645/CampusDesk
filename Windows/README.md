# CampusDesk Windows port — development only

This directory is **not a complete Windows release**. Do not distribute it as a
functional equivalent of the macOS app. The macOS `.app` and its ZIP cannot be
renamed or recompiled into a Windows executable because the host uses Cocoa,
WebKit, Apple Events, Keychain, PDFKit, Vision, and macOS notifications.

Implemented here:

- An isolated Electron dashboard with a narrow native bridge. Remote school
  pages have no preload, Node integration, or access to dashboard storage.
- Per-user, validated school URLs; persistent browser sign-in; exact-origin
  Seiue/ManageBac page extraction; bounded read-only ManageBac traversal.
- Atomic local state/config saves, backup import/export, and ICS calendar import.
- Edge/Chrome isolated-profile CDP transport and a worker-thread bridge to the
  existing Teams discovery/API runners; manual page capture and following.
- Delegated Microsoft Graph login with encrypted local token cache, bounded
  pagination, account-scoped checkpoints and storage-failure handling.
- Local PDF/image OCR and Office text extraction; scheduled Windows toast
  implementation and tray countdown. These paths still need Windows acceptance.
- A combined x64/ARM64 NSIS installer. Compilation is not runtime acceptance.

Not yet equivalent to macOS:

- RTF extraction is explicitly unsupported; spreadsheet extraction reports
  partial coverage (values, not formatting/formula recalculation).
- Teams/EC, Graph, OCR, notifications, installation and real-account coverage
  have not passed Windows runtime acceptance. Manual capture currently targets
  the application's selected Teams tab, not necessarily the foreground tab.
- No Windows code-signing certificate has been configured. Build log lines
  mentioning signing do not establish an Authenticode signature.

Release gate: implement and test every missing item, then validate in Windows 11
with signed-in school accounts. A launchable dashboard is **not** acceptance.

## ManageBac-packer 0.5.1 reference audit

The user-provided [0.5.1 release](https://github.com/zhyunran/ManageBac-packer/releases/tag/0.5.1)
is a useful MIT-licensed Windows reference, especially for per-user installation,
Edge DevTools communication, school-page parsing, and rate-limited refresh. Its
published executable is a separate product, not a CampusDesk Windows build.

Do not import this tag wholesale. The tagged source references
`app/teams_crawl.py`, `app/teams_scroll.py`, `app/teams_guard.py`,
`app/ec_fetch.py`, and `app/sp_download.py` from `widget.py`/`build.spec`, but
none of those files is in the tag. `app/teams_reader.py` calls
`browser.open_login_window(TEAMS_URL)` and a CDP `list_targets`/`evaluate`
interface, while the included `app/browser.py` exposes a zero-argument
Playwright login function and the included `app/cdp.py` exposes `targets`/`eval`.
The tag therefore cannot establish that the release's full-channel Teams or EC
behavior is reproducible from the published source. The executable has not
been run or account-tested here.

The reference also writes ManageBac credentials to `credentials.json` and a
Seiue access token to `schedule_token.json`. CampusDesk must continue using
interactive browser sign-in and must not copy these storage paths or persist
plain account secrets. Any adapted source must retain its MIT attribution.

The next acceptance steps are: exercise Teams and EC with verified account-scoped
coverage, attachment download and PDF/OCR parity, Graph where school authorization
allows it, scheduled notifications, and installer restart/uninstall behavior in
Windows. Keep the release blocked until those checks pass.

## Build and current evidence

From the repository root, run `npm ci`, then `npm run build:windows` on a Windows
build host. Both Windows canvas optional packages must be present for a combined
x64/ARM64 build. Cross-build hosts may need to fetch their pinned npm tarballs
because npm skips optional packages for other operating systems.

`Windows/ocr-data/eng.traineddata.gz` and `chi_sim.traineddata.gz` must be provided
before packaging. The local build uses Tesseract's 4.0.0_fast models from
https://tessdata.projectnaptha.com/4.0.0_fast/ (Apache-2.0; upstream
https://github.com/tesseract-ocr/tessdata_fast). Do not include account data in
the package. Build outputs and OCR model downloads are ignored by Git.

2026-09-24 local check: 321 automated tests, 317 passed, 4 skipped; combined
NSIS compilation succeeded. Packaged Windows canvas binaries and OCR models
were inspected. No real-account Windows acceptance has been completed, and a
macOS canvas/OCR smoke test was blocked by native-library signature policy.
