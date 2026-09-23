'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('Liquid Glass renders Background → Glass with sharp DOM Content', { skip: !process.env.PLAYWRIGHT_MODULE || !process.env.CAMPUSDESK_TEST_URL }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.CAMPUSDESK_TEST_URL, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.documentElement.classList.contains('webgl-liquid-glass'));
    const result = await page.evaluate(() => {
      const canvas = document.getElementById('liquid-glass-canvas');
      const card = document.querySelector('.card');
      const gl = canvas.getContext('webgl2');
      return {
        canvasVisible: !canvas.hidden && getComputedStyle(canvas).display !== 'none',
        canvasPixels: [canvas.width, canvas.height],
        webgl2: Boolean(gl),
        canvasPointerEvents: getComputedStyle(canvas).pointerEvents,
        cardBackground: card && getComputedStyle(card).backgroundColor,
        cardZ: card && getComputedStyle(card).zIndex,
        headingText: document.querySelector('h1')?.textContent || '',
        domCanvasCount: document.querySelectorAll('#liquid-glass-canvas').length
      };
    });
    assert.equal(result.canvasVisible, true);
    assert.equal(result.webgl2, true);
    assert.ok(result.canvasPixels[0] >= 1400 && result.canvasPixels[1] >= 900);
    assert.equal(result.canvasPointerEvents, 'none');
    assert.match(result.cardBackground, /rgba\([^)]*, 0\)|transparent/);
    assert.ok(result.headingText.length > 0, 'Content remains ordinary selectable DOM text');
    assert.equal(result.domCanvasCount, 1);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: process.env.LIQUID_GLASS_SCREENSHOT || '/tmp/campusdesk-liquid-glass.png', fullPage: false });
  } finally {
    await browser.close();
  }
});
