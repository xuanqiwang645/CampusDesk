# Large deadline widget host regression

Regression: with a future deadline less than 24 hours away, the compact dynamic
timer used horizontal `fixedSize`. The complete large widget archived and loaded
successfully but rendered no foreground content in the macOS desktop host.
Removing only that modifier restored the full view and live countdown. Ordinary
SwiftUI ImageRenderer fixtures did not reproduce this host behavior.

## Required host check

1. Use a local synthetic account/fixture with four incomplete tasks, including one
   deadline within 24 hours. Never commit a real agenda or alter school records.
2. Display `CampusDesk.Deadlines` in `systemLarge` on the desktop.
3. After the installed extension has produced its new timeline, capture actual
   desktop pixels. Verify header, four titles, deadlines, countdown, bars and footer.
4. Capture again after at least ten seconds: the countdown must decrease while
   the other task rows remain visible. Repeat after the app's widget refresh action.
5. Click the widget and verify navigation to Tasks. Check light/dark appearance,
   a missing snapshot, and expired snapshot using isolated fixtures.

## Local controlled comparison, 2026-10-21

- Build83: minimal text and four real titles visible in the same desktop instance.
- Build84: original view with plain item identity instead of enumerated identity
  remained blank after timeline acceptance.
- Build85: original view without row Links remained blank after timeline acceptance.
- Build86: original view with only the timer horizontal fixedSize removed displayed
  all four rows and a decreasing countdown in actual desktop captures.

These observations isolate the trigger in the view code; the framework's internal
layout/serialization failure is not observable from the successful archive logs.
Screen captures and private agenda data are retained locally, not in this repo.
