'use strict';
// Real pointer/focus ordering with a synthetic native bridge; no API or school access.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const optional = { skip: !process.env.PLAYWRIGHT_MODULE };

async function fixture(run, patchDOM = true) {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.CampusDeskThemeEdition = true;
      window.CampusDeskAppVersion = { version: '1.1.0', name: 'Super Orion' };
      window.bridgeMessages = [];
      window.webkit = { messageHandlers: { campus: { postMessage(message) { bridgeMessages.push(structuredClone(message)); } } } };
    });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../Resources/index.html')).href + '#assistant');
    await page.evaluate(patchDOM => {
      if (!patchDOM) window.CampusDOM = undefined;
      const state = CampusCore.emptyState();
      Object.assign(state.settings, { setupWizardCompleted: true, setupWizardIntroVersion: '1.1.0', aiProvider: 'deepseek', aiContextCategories: [] });
      CampusDesk.receive({ type: 'state', state });
      CampusDesk.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'stored' });
      const request = bridgeMessages.filter(message => message.action === 'assistantListModels' && message.provider === 'deepseek').at(-1);
      CampusDesk.receive({ type: 'assistantModels', provider: 'deepseek', requestId: request.requestId, models: ['deepseek-flash'] });
    }, patchDOM);
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

async function holdSend(page, question, unfocusedButton) {
  await page.locator('#assistant-question').fill(question);
  await page.evaluate(unfocusedButton => {
    CampusDesk.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'stored' });
    window.heldSend = document.getElementById('assistant-send');
    if (unfocusedButton) heldSend.addEventListener('mousedown', event => {
      event.preventDefault(); document.getElementById('assistant-question').blur();
    }, { once: true });
  }, unfocusedButton);
  const button = await page.locator('#assistant-send').boundingBox();
  await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
  await page.mouse.down();
  // Let the old focusout 0 ms task run before mouseup/click, then inject a sync repaint.
  await page.evaluate(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    CampusDesk.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'stored' });
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  assert.equal(await page.evaluate(() => heldSend.isConnected && heldSend === document.getElementById('assistant-send')), true, 'the pressed button must survive blur timers and sync updates');
  if (unfocusedButton) assert.equal(await page.evaluate(() => document.activeElement === document.body), true, 'exercise WebKit-style null relatedTarget and an unfocused button');
}

for (const patchDOM of [true, false]) test('one real pointer click sends both the first question and a follow-up after deferred sync' + (patchDOM ? '' : ' without DOM patching'), optional, async () => fixture(async page => {
  for (const [turn, question] of ['FIRST_QUESTION', 'FOLLOW_UP_QUESTION'].entries()) {
    await holdSend(page, question, turn === 1);
    assert.equal(await page.evaluate(() => bridgeMessages.filter(message => message.action === 'assistantRequest').length), turn);
    await page.mouse.up();
    await page.waitForFunction(count => bridgeMessages.filter(message => message.action === 'assistantRequest').length === count, turn + 1);
    const request = await page.evaluate(() => bridgeMessages.filter(message => message.action === 'assistantRequest').at(-1));
    assert.match(request.messages.at(-1).content, new RegExp(question));
    if (turn) assert.match(JSON.stringify(request.messages), /FIRST_ANSWER/);
    await page.evaluate(({ requestId, answer }) => CampusDesk.receive({ type: 'assistantResponse', requestId, answer, providerUsed: 'deepseek' }), { requestId: request.requestId, answer: turn ? 'FOLLOW_UP_ANSWER' : 'FIRST_ANSWER' });
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
  }
  assert.equal(await page.evaluate(() => bridgeMessages.filter(message => message.action === 'assistantRequest').length), 2);
  assert.match(await page.locator('#assistant-chat-log').innerText(), /FOLLOW_UP_ANSWER/);
}, patchDOM));

test('pointer cancellation and window blur release the render guard and leave later sends usable', optional, async () => fixture(async page => {
  for (const cleanup of ['pointercancel', 'blur']) {
    await holdSend(page, 'Cancelled gesture ' + cleanup, true);
    await page.evaluate(cleanup => {
      if (cleanup === 'blur') window.dispatchEvent(new Event('blur'));
      else document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
    }, cleanup);
    assert.equal(await page.evaluate(() => heldSend.isConnected), false, 'a cancelled gesture must release the deferred repaint');
    await page.mouse.up();
    await page.locator('#assistant-question').fill('Send after ' + cleanup);
    await page.locator('#assistant-send').click();
    const request = await page.evaluate(() => bridgeMessages.filter(message => message.action === 'assistantRequest').at(-1));
    assert.match(request.messages.at(-1).content, new RegExp('Send after ' + cleanup));
    await page.evaluate(requestId => CampusDesk.receive({ type: 'assistantResponse', requestId, answer: 'RECOVERED', providerUsed: 'deepseek' }), request.requestId);
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
  }
}, false));
