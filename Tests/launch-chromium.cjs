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

const mediaSessions = new WeakMap();
async function setMediaPreferences(page, overrides = {}) {
  // Visual fixtures choose their accessibility state explicitly. macOS runners
  // may inherit Reduce Transparency or Increase Contrast from the runner image.
  // Keep using real browser media queries, including tests of the reduced states.
  let session = mediaSessions.get(page);
  if (!session) {
    session = await page.context().newCDPSession(page);
    mediaSessions.set(page, session);
  }
  const preferences = {
    'prefers-reduced-transparency': 'no-preference',
    'prefers-contrast': 'no-preference',
    'prefers-reduced-motion': 'no-preference',
    'forced-colors': 'none',
    ...overrides
  };
  await session.send('Emulation.setEmulatedMedia', {
    features: Object.entries(preferences).map(([name, value]) => ({ name, value }))
  });
}

module.exports = { launchChromium, setMediaPreferences };
