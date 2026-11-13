'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { launchChromium, setMediaPreferences } = require('./launch-chromium.cjs');

test('an idle glass frame adopts a new palette and defers hidden changes until visible', { skip: !process.env.PLAYWRIGHT_MODULE }, async () => {
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 850 }, colorScheme: 'light' });
    await setMediaPreferences(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.glassPaletteProbe = { draws: 0, uniforms: {}, pixel: [] };
      const locations = new WeakMap();
      const prototype = WebGL2RenderingContext.prototype;
      const locate = prototype.getUniformLocation;
      prototype.getUniformLocation = function(program, name) {
        const result = locate.call(this, program, name);
        if (result) locations.set(result, name);
        return result;
      };
      const uniform = prototype.uniform3f;
      prototype.uniform3f = function(location, x, y, z) {
        if (this.canvas.id === 'liquid-glass-canvas') glassPaletteProbe.uniforms[locations.get(location)] = [x, y, z];
        return uniform.call(this, location, x, y, z);
      };
      const draw = prototype.drawElements;
      prototype.drawElements = function(...args) {
        const result = draw.apply(this, args);
        if (this.canvas.id === 'liquid-glass-canvas') {
          glassPaletteProbe.draws++;
          // Read the actual composed screen before the drawing buffer is cleared.
          if (!this.getParameter(this.FRAMEBUFFER_BINDING)) {
            const pixel = new Uint8Array(4);
            this.readPixels(this.drawingBufferWidth / 2 | 0, this.drawingBufferHeight / 2 | 0, 1, 1, this.RGBA, this.UNSIGNED_BYTE, pixel);
            glassPaletteProbe.pixel = [...pixel];
          }
        }
        return result;
      };
    });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../Resources/index.html')).href + '#settings');
    await page.waitForFunction(() => glassPaletteProbe.draws > 0);
    await page.evaluate(() => document.documentElement.dataset.graphicsMode = 'low-power');
    await page.waitForTimeout(200);
    const snapshot = () => page.evaluate(() => JSON.parse(JSON.stringify(glassPaletteProbe)));
    const sage = await snapshot();
    await page.waitForTimeout(200);
    assert.equal((await snapshot()).draws, sage.draws, 'low-power frame is idle before an attribute-only change');
    await page.evaluate(() => document.documentElement.dataset.colorTheme = 'midnight');
    await page.waitForFunction(before => glassPaletteProbe.draws > before, sage.draws);
    const dark = await snapshot();
    assert.deepEqual(dark.uniforms.uBaseLow, [17 / 255, 26 / 255, 32 / 255]);
    assert.deepEqual(dark.uniforms.uTint, [41 / 255, 65 / 255, 57 / 255]);
    assert.ok(dark.pixel[0] < sage.pixel[0] / 2 && dark.pixel[1] < sage.pixel[1] / 2, 'the composed dark pixel is substantially darker');
    await page.waitForTimeout(200);
    assert.equal((await snapshot()).draws, dark.draws, 'palette changes do not restart continuous rendering');
    await page.evaluate(() => {
      document.documentElement.dataset.windowVisible = 'false';
      document.documentElement.dataset.colorTheme = 'ocean';
    });
    await page.waitForTimeout(200);
    assert.equal((await snapshot()).draws, dark.draws, 'hidden palette changes do not draw');
    await page.evaluate(() => document.documentElement.dataset.windowVisible = 'true');
    await page.waitForFunction(before => glassPaletteProbe.draws > before, dark.draws);
    const light = await snapshot();
    assert.deepEqual(light.uniforms.uBaseLow, [238 / 255, 245 / 255, 251 / 255]);
    assert.ok(light.pixel[0] > dark.pixel[0] * 2, 'resuming displays the latest light palette');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
