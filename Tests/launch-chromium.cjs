'use strict';
const path = require('node:path');

function launchChromium() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const requested = process.env.CHROME_EXECUTABLE;
  // Launching the macOS desktop app with --headless still moves its Dock tile.
  // Use Playwright's standalone shell, including when an old setup names Chrome.app.
  const useOverride = requested && (process.platform !== 'darwin' ||
    ['chrome-headless-shell', 'headless_shell'].includes(path.basename(requested)));
  return chromium.launch({ headless: true, executablePath: useOverride ? requested : undefined });
}

module.exports = { launchChromium };
