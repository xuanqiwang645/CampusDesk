'use strict';
// Synthetic, isolated Chromium checks: no school login or student data is read.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const optional = { skip: !process.env.PLAYWRIGHT_MODULE };

async function fixture(run) {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.webkit = { messageHandlers: { campus: { postMessage() {} } } };
      window.__idle = [];
      window.requestIdleCallback = callback => { window.__idle.push(callback); return window.__idle.length; };
      window.__translationCopies = 0;
      const assign = Object.assign;
      Object.assign = function (target, ...sources) {
        if (sources.some(source => source && Object.hasOwn(source, '我的校园') && Object.hasOwn(source, '尚未同步'))) window.__translationCopies++;
        return assign(target, ...sources);
      };
    });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../Resources/index.html')).href + '#ec');
    await page.locator('#ec-search').waitFor();
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

async function seedNotices(page, prefix = 'Synthetic', language = 'zh-CN') {
  await page.evaluate(({ prefix, language }) => {
    const state = CampusCore.emptyState();
    state.settings.language = language;
    state.settings.graphicsMode = 'low-power';
    const url = 'https://teams.microsoft.com/v2/#/channels/synthetic';
    state.snapshots.teams[url] = {
      source: 'teams', url, capturedAt: new Date().toISOString(), coverage: 'visible', warnings: [],
      posts: Array.from({ length: 30 }, (_, index) => ({
        id: 'synthetic-' + index, title: prefix + ' EC ' + index,
        text: 'Synthetic roster body ' + index, kind: 'ec', date: '2026-10-08T01:00:00Z',
        attachments: [{ title: 'Synthetic roster.txt', text: index === 29 ? 'Needle <同步数据> & 原文' : 'Synthetic attachment ' + index }]
      }))
    };
    window.__idle = [];
    CampusDesk.receive({ type: 'state', state });
  }, { prefix, language });
}

const idleStep = page => page.evaluate(() => {
  const callback = window.__idle.shift();
  if (callback) callback({ timeRemaining: () => 50 });
  return Boolean(callback);
});

async function finishIdle(page) {
  let slices = 0;
  while (await idleStep(page)) assert.ok(++slices < 30, 'bounded index work must complete');
  return slices;
}

test('typing while EC search is indexing continues the existing slices and uses the latest query', optional, async () => fixture(async page => {
  await seedNotices(page);
  await page.locator('#ec-search').fill('Need');
  await idleStep(page);
  assert.match(await page.locator('#ec-result-count').textContent(), /6 \/ 30/);
  await page.locator('#ec-search').fill('Needle');
  assert.match(await page.locator('#ec-result-count').textContent(), /6 \/ 30/, 'typing must not reset completed index work');
  await idleStep(page);
  assert.match(await page.locator('#ec-result-count').textContent(), /12 \/ 30/);
  assert.equal(await finishIdle(page), 3, '30 notices need five six-notice slices even when the query changes');
  assert.match(await page.locator('#ec-results').innerText(), /Synthetic EC 29/);
  assert.doesNotMatch(await page.locator('#ec-results').innerText(), /Synthetic EC 28/);
  assert.equal(await page.locator('#ec-search').inputValue(), 'Needle');
  assert.equal(await page.locator('#ec-search').evaluate(node => node === document.activeElement), true);
}));

test('a new snapshot invalidates pending EC index work and never publishes stale search results', optional, async () => fixture(async page => {
  await seedNotices(page, 'Old');
  await page.locator('#ec-search').fill('Needle');
  await idleStep(page);
  await page.evaluate(() => { window.__oldIdle = window.__idle.slice(); });
  await seedNotices(page, 'New');
  await page.evaluate(() => {
    for (const callback of window.__oldIdle) callback({ timeRemaining: () => 50 });
  });
  assert.match(await page.locator('#ec-result-count').textContent(), /0 \/ 30/, 'the old callback cannot advance or overwrite the new index');
  assert.equal(await finishIdle(page), 5);
  assert.match(await page.locator('#ec-results').innerText(), /New EC 29/);
  assert.doesNotMatch(await page.locator('#ec-results').innerText(), /Old EC/);
}));

test('English page renders reuse translation tables and retain escaped school text', optional, async t => fixture(async page => {
  await seedNotices(page, 'School <同步数据> & 原文', 'en-US');
  const result = await page.evaluate(() => {
    window.__translationCopies = 0;
    const start = performance.now();
    for (let index = 0; index < 8; index++) {
      document.querySelector('#nav [data-page="teams"]').click();
      document.querySelector('#nav [data-page="ec"]').click();
    }
    return { copies: window.__translationCopies, milliseconds: performance.now() - start };
  });
  t.diagnostic('16 synthetic English page renders: ' + result.milliseconds.toFixed(1) + ' ms, dictionary copies: ' + result.copies);
  assert.equal(result.copies, 0, 'fixed dictionaries should not be copied for every rendered text fragment');
  assert.match(await page.locator('#ec-results').innerText(), /School <同步数据> & 原文 EC 29/);
  assert.equal(await page.locator('#sync-label').innerText(), 'Sync data');
  assert.equal(await page.locator('#ec-results script').count(), 0);
}));

test('real GPA hover coalesces pointer bursts and cancels pending work on leave, hide and page cleanup', optional, async () => fixture(async page => {
  await page.evaluate(() => {
    const state = CampusCore.emptyState();
    state.settings.graphicsMode = 'low-power';
    state.gradeHistory = [3.2, 3.5, 3.4, 3.7].map((value, index) => ({
      value, method: CampusCore.GPA_BANDED_METHOD, linearValue: value, date: '2026-10-0' + (index + 1),
      capturedAt: '2026-10-0' + (index + 1) + 'T08:00:00Z', count: 7
    }));
    CampusDesk.receive({ type: 'state', state });
    document.querySelector('#nav [data-page="grades"]').click();
  });
  await finishIdle(page);
  await page.waitForFunction(() => document.querySelector('#gpa-kline-chart canvas'));
  await page.locator('#gpa-kline-chart').scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const result = await page.evaluate(() => {
    const container = document.getElementById('gpa-kline-chart');
    const chart = klinecharts.init(container);
    const layer = container.querySelector('.gpa-kline-hover');
    const badge = layer.querySelector('span');
    const bars = chart.getDataList();
    const first = chart.convertToPixel({ timestamp: bars[1].timestamp, value: bars[1].close }, { paneId: 'candle_pane' });
    const last = chart.convertToPixel({ timestamp: bars[2].timestamp, value: bars[2].close }, { paneId: 'candle_pane' });
    const rect = container.getBoundingClientRect(), pane = chart.getSize('candle_pane', 'main');
    const originalRAF = window.requestAnimationFrame, originalCancel = window.cancelAnimationFrame;
    const frames = new Map();
    let sequence = 0, layoutReads = 0;
    const originalRect = container.getBoundingClientRect.bind(container);
    container.getBoundingClientRect = () => { layoutReads++; return originalRect(); };
    window.requestAnimationFrame = callback => { frames.set(++sequence, callback); return sequence; };
    window.cancelAnimationFrame = id => frames.delete(id);
    const move = fraction => container.dispatchEvent(new MouseEvent('mousemove', {
      clientX: rect.left + pane.left + first.x + (last.x - first.x) * fraction,
      clientY: rect.top + 40
    }));
    const flush = () => { const batch = [...frames.values()]; frames.clear(); for (const callback of batch) callback(performance.now()); };
    try {
      for (let index = 0; index < 20; index++) move(index / 40);
      const beforeFrame = { pending: frames.size, reads: layoutReads };
      flush();
      const afterFrame = { pending: frames.size, reads: layoutReads, hidden: layer.hidden, text: badge.textContent };
      const expectedText = 'GPA · ' + (bars[1].close + (bars[2].close - bars[1].close) * 19 / 40).toFixed(2);
      layoutReads = 0;
      move(0.25);
      const lateLeave = [...frames.values()][0];
      container.dispatchEvent(new MouseEvent('mouseleave'));
      if (lateLeave) lateLeave(performance.now());
      const leave = { pending: frames.size, reads: layoutReads, hidden: layer.hidden };
      move(0.5);
      const lateHidden = [...frames.values()][0];
      CampusDesk.receive({ type: 'windowVisibility', visible: false });
      if (lateHidden) lateHidden(performance.now());
      const hidden = { pending: frames.size, reads: layoutReads, hidden: layer.hidden };
      CampusDesk.receive({ type: 'windowVisibility', visible: true });
      move(0.75);
      const lateCleanup = [...frames.values()][0];
      document.querySelector('#nav [data-page="tasks"]').click();
      if (lateCleanup) lateCleanup(performance.now());
      const cleanup = { pending: frames.size, reads: layoutReads, attached: layer.isConnected, hidden: layer.hidden };
      return { beforeFrame, afterFrame, expectedText, leave, hidden, cleanup };
    } finally {
      window.requestAnimationFrame = originalRAF;
      window.cancelAnimationFrame = originalCancel;
      container.getBoundingClientRect = originalRect;
    }
  });
  assert.deepEqual(result.beforeFrame, { pending: 1, reads: 0 }, 'twenty pointer events schedule one paint without synchronous layout');
  assert.deepEqual(result.afterFrame, { pending: 0, reads: 1, hidden: false, text: result.expectedText }, 'the one paint uses the latest pointer position');
  assert.deepEqual(result.leave, { pending: 0, reads: 0, hidden: true });
  assert.deepEqual(result.hidden, { pending: 0, reads: 0, hidden: true });
  assert.deepEqual(result.cleanup, { pending: 0, reads: 0, attached: false, hidden: true });
}));

test('native import temporarily blocks old-state controls and restores interaction after failure and success', optional, async () => fixture(async page => {
  page.on('dialog', dialog => dialog.accept());
  await page.evaluate(() => {
    window.__bridgeMessages = [];
    webkit.messageHandlers.campus.postMessage = message => __bridgeMessages.push(JSON.parse(JSON.stringify(message)));
    window.__originalState = CampusCore.emptyState();
    __originalState.manualTasks.push({ id: 'original', title: 'Synthetic original task', dueAt: null, status: 'open' });
    window.__importState = CampusCore.emptyState();
    __importState.manualTasks.push({ id: 'imported', title: 'Synthetic imported task', dueAt: null, status: 'open' });
    CampusDesk.receive({ type: 'state', state: __originalState, stateGeneration: 0 });
    document.querySelector('#nav [data-page="tasks"]').click();
  });
  for (const [generation, success] of [[0, false], [1, true]]) {
    await page.evaluate(generation => CampusDesk.receive({ type: 'import', state: __importState, validated: true, stateGeneration: generation }), generation);
    assert.equal(await page.locator('#app-shell').evaluate(node => node.inert), true);
    assert.equal(await page.locator('#task-dialog').evaluate(node => node.inert), true);
    await page.evaluate(({ generation, success }) => {
      const request = __bridgeMessages.filter(message => message.action === 'saveState' && message.imported).at(-1);
      CampusDesk.receive({ type: 'importResult', requestId: request.importRequestId, success, state: success ? __importState : __originalState, stateGeneration: generation + 1 });
    }, { generation, success });
    assert.equal(await page.locator('#app-shell').evaluate(node => node.inert), false);
    assert.equal(await page.locator('#task-dialog').evaluate(node => node.inert), false);
    assert.equal(await page.evaluate(() => __bridgeMessages.filter(message => message.action === 'importResultApplied').at(-1).stateGeneration), generation + 1);
    await page.locator('[data-action="add-task"]').first().click();
    await page.locator('#task-title').fill('Draft retained after ' + (success ? 'success' : 'failure'));
    await page.locator('#task-dialog [data-action="close-task"]').first().click();
  }
  assert.match(await page.locator('#content').innerText(), /Synthetic imported task/);
  assert.doesNotMatch(await page.locator('#content').innerText(), /Synthetic original task/);
}));
