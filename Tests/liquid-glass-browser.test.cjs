'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('Liquid Glass renders beneath the selected opaque color theme and its transparent base fallback', { skip: !process.env.PLAYWRIGHT_MODULE || !process.env.CAMPUSDESK_TEST_URL }, async () => {
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
      const cardBackground = card && getComputedStyle(card).backgroundColor;
      const colorTheme = document.documentElement.dataset.colorTheme;
      const colorProbe = document.createElement('span');
      colorProbe.style.backgroundColor = getComputedStyle(card).getPropertyValue('--card');
      document.body.append(colorProbe);
      const themeBackground = getComputedStyle(colorProbe).backgroundColor;
      colorProbe.remove();
      // Color presets intentionally supply opaque cards. Without a color preset,
      // the base glass CSS still exposes the compositor; do not change product CSS.
      document.documentElement.removeAttribute('data-color-theme');
      const baseBackground = getComputedStyle(card).backgroundColor;
      document.documentElement.dataset.colorTheme = colorTheme;
      return {
        canvasVisible: !canvas.hidden && getComputedStyle(canvas).display !== 'none',
        canvasPixels: [canvas.width, canvas.height],
        webgl2: Boolean(gl),
        canvasPointerEvents: getComputedStyle(canvas).pointerEvents,
        cardBackground, themeBackground, baseBackground, colorTheme,
        cardZ: card && getComputedStyle(card).zIndex,
        headingText: document.querySelector('h1')?.textContent || '',
        domCanvasCount: document.querySelectorAll('#liquid-glass-canvas').length
      };
    });
    assert.equal(result.canvasVisible, true);
    assert.equal(result.webgl2, true);
    assert.ok(result.canvasPixels[0] >= 1400 && result.canvasPixels[1] >= 900);
    assert.equal(result.canvasPointerEvents, 'none');
    assert.equal(result.colorTheme, 'sage');
    assert.equal(result.cardBackground, result.themeBackground, 'the selected color preset intentionally overrides base glass transparency');
    assert.match(result.baseBackground, /rgba\([^)]*, 0\)|transparent/);
    assert.ok(result.headingText.length > 0, 'Content remains ordinary selectable DOM text');
    assert.equal(result.domCanvasCount, 1);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: process.env.LIQUID_GLASS_SCREENSHOT || '/tmp/campusdesk-liquid-glass.png', fullPage: false });
  } finally {
    await browser.close();
  }
});

test('real WebGL drawing pauses for hidden windows and low-power mode, then resumes on demand', { skip: !process.env.PLAYWRIGHT_MODULE || !process.env.CAMPUSDESK_TEST_URL }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless:true, executablePath:process.env.CHROME_EXECUTABLE || undefined });
  try {
    const page = await browser.newPage({viewport:{width:1400,height:900},deviceScaleFactor:2});
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      window.glassTestDraws=0;
      // Keep the renderer's actual RAF/timers intact, but make the unrelated
      // once-per-second dashboard clock deterministic. A clock DOM mutation
      // legitimately requests a static redraw, so exercise it explicitly below.
      const interval=window.setInterval.bind(window);
      window.setInterval=(callback,delay,...args)=>{
        if (Number(delay)===1000) { window.glassTestClockTick=()=>callback(...args); return -1; }
        return interval(callback,delay,...args);
      };
      for (const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']) {
        const original=WebGL2RenderingContext.prototype[name];
        if (!original) continue;
        WebGL2RenderingContext.prototype[name]=function(...args) {
          if (this.canvas.id==='liquid-glass-canvas') window.glassTestDraws++;
          return original.apply(this,args);
        };
      }
    });
    await page.goto(process.env.CAMPUSDESK_TEST_URL.split('#')[0]+'#settings',{waitUntil:'networkidle'});
    await page.waitForFunction(()=>glassTestDraws>0 && typeof CampusGlassInvalidate==='function');
    const draws=()=>page.evaluate(()=>glassTestDraws);
    const assertPaused=async label=>{
      await page.waitForTimeout(120);
      const before=await draws();
      await page.waitForTimeout(350);
      assert.equal(await draws(),before,label);
    };
    let before=await draws();
    await page.waitForFunction(before=>glassTestDraws>before,before);
    await page.evaluate(()=>CampusDesk.receive({type:'windowVisibility',visible:false}));
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.windowVisible),'false');
    await assertPaused('native windowVisibility=false stops actual GPU draw calls');
    await page.evaluate(()=>{CampusGlassInvalidate();window.dispatchEvent(new Event('resize'));});
    await assertPaused('invalidating a hidden window must not restart the render loop');
    before=await draws();
    await page.evaluate(()=>CampusDesk.receive({type:'windowVisibility',visible:true}));
    await page.waitForFunction(before=>glassTestDraws>before,before);

    // Exercise the browser visibility event separately from the native message.
    // Overriding the page signal avoids hiding or modifying the user's real app.
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
    await assertPaused('document.hidden independently suspends rendering');
    before=await draws();
    await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForFunction(before=>glassTestDraws>before,before);

    await page.locator('#graphics-mode').selectOption('low-power');
    await page.waitForFunction(()=>document.documentElement.dataset.graphicsMode==='low-power');
    await assertPaused('low-power mode does not schedule a continuous animation loop');
    assert.deepEqual(await page.evaluate(()=>{const c=document.getElementById('liquid-glass-canvas');return [c.width,c.height];}),[1400,900],'low-power rendering limits pixel ratio to 1');
    before=await draws();
    await page.evaluate(()=>CampusGlassInvalidate());
    await page.waitForFunction(before=>glassTestDraws>before,before);
    await assertPaused('one requested static redraw does not leave a running loop');
    await page.evaluate(()=>glassTestClockTick());
    await assertPaused('unchanged dashboard clock text does not request full-screen GPU work');

    before=await draws();
    await page.locator('#graphics-mode').dispatchEvent('pointerdown');
    await page.locator('#graphics-mode').selectOption('auto');
    await page.waitForFunction(before=>glassTestDraws>before,before);
    before=await draws();
    await page.waitForFunction(before=>glassTestDraws>before,before);
    assert.deepEqual(await page.evaluate(()=>{const c=document.getElementById('liquid-glass-canvas');return [c.width,c.height];}),[1750,1125],'automatic rendering caps pixel ratio at 1.25');
    await page.waitForTimeout(2700);
    await assertPaused('automatic mode also stops drawing when the user is idle');
    await page.locator('#seiue-url').focus();
    await page.locator('#seiue-url').press('a');
    await assertPaused('typing in a field does not restart the background animation');
    before=await draws();
    await page.locator('#graphics-mode').dispatchEvent('pointerdown');
    await page.waitForFunction(before=>glassTestDraws>before,before);
    await page.emulateMedia({reducedMotion:'reduce'});
    // An already queued automatic frame may run before Chromium dispatches
    // the media-query change. Wait for the reduced-motion frame itself.
    await page.waitForFunction(()=>matchMedia('(prefers-reduced-motion: reduce)').matches && document.getElementById('liquid-glass-canvas').width===1400);
    await assertPaused('the reduced-motion preference also uses static drawing');
    before=await draws();
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.waitForFunction(before=>glassTestDraws>before,before);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});
