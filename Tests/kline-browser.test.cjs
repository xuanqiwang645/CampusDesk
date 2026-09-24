'use strict';
// Optional real-canvas regression suite. No school accounts or live data used.
// PLAYWRIGHT_MODULE=/path/to/playwright CHROME_EXECUTABLE=/path/to/chrome node --test Tests/kline-browser.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Core = require('../Resources/core.js');

test('GPA chart stays readable under repeated zoom, pan, aggregation and refresh', { skip: !process.env.PLAYWRIGHT_MODULE }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const state = Core.emptyState();
    state.gradeHistory = [3.67, 3.33, 3.71, 3.71].map((value, i) => ({ value, linearValue: [3.52, 3.49, 3.73, 3.74][i], date: '2026-09-' + (18 + i), capturedAt: `2026-09-${18 + i}T08:00:00Z`, count: 7, scale: 4 }));
    await page.addInitScript(state => localStorage.setItem('campusdesk.browser.v1', JSON.stringify(state)), state);
    await page.goto(pathToFileURL(path.resolve(__dirname, '../Resources/index.html')).href + '#grades');
    const plot = page.locator('#gpa-kline-chart');
    await plot.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('#gpa-kline-chart canvas'));
    await page.waitForFunction(() => document.querySelector('#gpa-kline-linear-chart canvas'));
    assert.match(await page.locator('.gpa-kline-card').nth(0).textContent(), /分档 GPA K 线/);
    assert.match(await page.locator('.gpa-kline-card').nth(1).textContent(), /线性折算 GPA K 线/);
    const inspectLinear = () => page.evaluate(() => {
      const chart = klinecharts.init('gpa-kline-linear-chart');
      return { id: chart.id, count: chart.getDataList().length, closes: chart.getDataList().map(row => row.close), spacing: chart.getBarSpace().bar };
    });
    assert.deepEqual((await inspectLinear()).closes, [3.52, 3.49, 3.73, 3.74]);
    const inspect = () => page.evaluate(() => {
      const chart = klinecharts.init('gpa-kline-chart');
      const data = chart.getDataList();
      return { id: chart.id, spacing: chart.getBarSpace().bar, count: data.length, range: chart.getVisibleRange(),
        points: data.map(bar => chart.convertToPixel({ timestamp: bar.timestamp, value: bar.high })),
        tooltip: chart.getStyles().indicator.tooltip.showRule,
        verticalCrosshair: chart.getStyles().crosshair.vertical.show,
        verticalLine: chart.getStyles().crosshair.vertical.line.show,
        verticalDateLabel: chart.getStyles().crosshair.vertical.text.show };
    });
    let initial = await inspect();
    assert.equal(initial.count, 4);
    assert.ok(initial.spacing >= 48);
    assert.equal(initial.tooltip, 'none');
    assert.equal(initial.verticalCrosshair, true, 'cursor keeps its vertical guide');
    assert.equal(initial.verticalLine, true, 'vertical guide line is visible');
    assert.equal(initial.verticalDateLabel, false, 'time-axis/date label stays hidden');
    // Ordinary trackpad diagonals and mouse drags MUST NOT change bar width.
    const box = await plot.boundingBox();
    const snapTarget = await page.evaluate(() => {
      const chart = klinecharts.init('gpa-kline-chart'), bar = chart.getDataList()[1];
      const point = chart.convertToPixel({ timestamp: bar.timestamp, value: bar.close }, { paneId: 'candle_pane' });
      const rect = document.querySelector('#gpa-kline-chart').getBoundingClientRect();
      return { x: rect.left + point.x, y: rect.top + point.y, close: bar.close };
    });
    await page.mouse.move(snapTarget.x, snapTarget.y - 18);
    await page.waitForFunction(() => { const badge = document.getElementById('gpa-kline-snap-value'); return badge && !badge.hidden; });
    assert.equal(await page.locator('#gpa-kline-snap-value').textContent(), 'GPA · ' + snapTarget.close.toFixed(2));
    const hover = async (fraction = 0.27, first = 1) => {
      await plot.scrollIntoViewIfNeeded();
      const target = await page.evaluate(({ fraction, first }) => {
        const chart = klinecharts.init('gpa-kline-chart'), bars = chart.getDataList();
        const a = bars[first], b = bars[Math.min(first + 1, bars.length - 1)];
        const p = chart.convertToPixel({ timestamp: a.timestamp, value: a.close });
        const q = chart.convertToPixel({ timestamp: b.timestamp, value: b.close });
        const rect = document.querySelector('#gpa-kline-chart').getBoundingClientRect();
        const pane = chart.getSize('candle_pane', 'main');
        return { x: rect.x + pane.left + p.x + (q.x - p.x) * fraction, y: rect.y + 40,
          snapX: p.x + (q.x - p.x) * fraction, snapY: p.y + (q.y - p.y) * fraction,
          value: a.close + (b.close - a.close) * fraction };
      }, { fraction, first });
      await page.mouse.move(target.x, target.y);
      await page.waitForFunction(() => !document.querySelector('#gpa-kline-chart .gpa-kline-hover').hidden);
      const actual = await page.locator('#gpa-kline-chart .gpa-kline-hover').evaluate(el => ({
        x: parseFloat(el.style.getPropertyValue('--snap-x')), y: parseFloat(el.style.getPropertyValue('--snap-y')),
        text: el.querySelector('span').textContent,
        vertical: getComputedStyle(el.querySelector('.gpa-hover-vertical')).borderLeftWidth,
        horizontal: getComputedStyle(el.querySelector('.gpa-hover-horizontal')).borderTopWidth
      }));
      assert.ok(Math.abs(actual.x - target.snapX) < 1, 'vertical guide follows continuous x, not a date');
      assert.ok(Math.abs(actual.y - target.snapY) < 1, 'horizontal guide intersects the close polyline');
      assert.equal(actual.text, 'GPA · ' + target.value.toFixed(2));
      assert.equal(actual.vertical, '1px');
      assert.equal(actual.horizontal, '1px');
      assert.equal(await page.locator('#gpa-kline-chart .gpa-kline-hover').count(), 1);
    };
    await hover();
    await plot.screenshot({ path: '/tmp/campusdesk-kline-hover.png' });
    for (const target of [{ x: box.x + 10, y: box.y + 40 }, { x: box.x + box.width / 2, y: box.y + box.height - 50 }, { x: box.x - 10, y: box.y + 40 }]) {
      await page.mouse.move(target.x, target.y);
      assert.equal(await page.locator('#gpa-kline-snap-value').isVisible(), false, 'empty dates, other panes and mouse leave hide hover');
    }
    await page.mouse.move(box.x + box.width / 2, box.y + 100);
    for (const [dx, dy] of [[80, 20], [20, 80], [-80, -20], [-20, -80], [0, 100]]) {
      await page.mouse.wheel(dx, dy);
      assert.equal((await inspect()).spacing, initial.spacing, 'diagonal/vertical trackpad movement is not zoom');
    }
    await plot.scrollIntoViewIfNeeded();
    const dragBox = await plot.boundingBox();
    for (const y of [dragBox.y + 100, dragBox.y + dragBox.height - 12]) {
      await page.mouse.move(dragBox.x + 180, y);
      await page.mouse.down();
      await page.mouse.move(dragBox.x + 400, y, { steps: 15 });
      await page.mouse.up();
      assert.equal((await inspect()).spacing, initial.spacing, 'plot and time-axis dragging must preserve width');
    }
    // Only explicit controls change the scale, within readable bounds.
    for (const step of ['-1', '1']) {
      for (let i = 0; i < 20; i++) await page.locator('#gpa-kline-tools [data-action="gpa-kline-zoom"][data-step="' + step + '"]').click();
      await page.waitForTimeout(100);
      const view = await inspect();
      assert.ok(view.spacing >= 48 && view.spacing <= 120, JSON.stringify(view));
      assert.equal(view.spacing, step === '-1' ? 48 : 120);
      assert.equal(view.count, 4, 'zoom must not duplicate historical data');
      for (let i = 1; i < view.points.length; i++) assert.ok(view.points[i].x - view.points[i - 1].x >= 47.9, '38px labels need separate slots');
    }
    // Extreme panning cannot hide every real record.
    for (const distance of [-100000, 100000]) {
      await page.evaluate(distance => klinecharts.init('gpa-kline-chart').scrollByDistance(distance), distance);
      const view = await inspect();
      assert.equal(view.range.to - view.range.from, 4);
      assert.equal(view.count, 4);
    }
    await page.evaluate(() => klinecharts.init('gpa-kline-chart').scrollToRealTime());
    const beforeRefresh = await inspect();
    await page.evaluate(state => {
      for (let i = 0; i < 3; i++) CampusDesk.receive({ type: 'state', state });
    }, state);
    await page.waitForTimeout(100);
    const afterRefresh = await inspect();
    assert.equal(afterRefresh.id, beforeRefresh.id, 'unchanged snapshots must retain the chart instance');
    assert.equal(afterRefresh.spacing, beforeRefresh.spacing);
    assert.deepEqual(afterRefresh.range, beforeRefresh.range);
    assert.equal((await inspectLinear()).count, 4, 'linear history remains independent after refresh');
    await hover();
    // Real slider change: a 30-day bucket leaves one valid record; 1h restores four.
    for (const [value, count] of [['10', 1], ['0', 4]]) {
      await page.locator('#gpa-kline-interval').evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); }, value);
      await page.waitForTimeout(100);
      assert.equal((await inspect()).count, count);
      assert.equal((await inspectLinear()).count, count, 'shared interval updates both methods');
      await hover(0, 0);
    }
    await plot.screenshot({ path: process.env.KLINE_SCREENSHOT || '/tmp/campusdesk-kline-regression.png' });
    await page.setViewportSize({ width: 760, height: 1000 });
    await page.waitForTimeout(100);
    assert.equal((await inspect()).count, 4);
    assert.ok((await inspect()).spacing >= 48);
    // Many real periods remain pan-able; no fabricated filler candles.
    state.gradeHistory = Array.from({ length: 120 }, (_, i) => {
      const capturedAt = new Date(Date.UTC(2026, 8, 1) + i * 4 * 3600000).toISOString();
      return { capturedAt, date: capturedAt.slice(0, 10), value: 3 + (i % 20) / 20, linearValue: 2.9 + (i % 20) / 20, count: 7, scale: 4 };
    });
    await page.evaluate(state => CampusDesk.receive({ type: 'state', state }), state);
    await page.waitForFunction(() => klinecharts.init('gpa-kline-linear-chart').getDataList().length === 120);
    assert.equal((await inspect()).count, 120);
    assert.equal((await inspectLinear()).count, 120);
    assert.ok((await inspect()).spacing >= 48);
    for (const distance of [-100000, 100000]) {
      await page.evaluate(distance => klinecharts.init('gpa-kline-chart').scrollByDistance(distance), distance);
      assert.equal((await inspect()).count, 120);
      const view = await inspect();
      assert.ok(view.range.to - view.range.from >= 4);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
