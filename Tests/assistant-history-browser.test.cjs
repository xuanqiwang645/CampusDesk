'use strict';
// Persistent synthetic native state only: no real keys, school data, or model calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Core = require('../Resources/core.js');
const optional = { skip: !process.env.PLAYWRIGHT_MODULE };
const fixtureStorage = 'campusdesk.synthetic-assistant-history.v1';
const secretSentinel = 'SYNTHETIC_API_SECRET_NEVER_INCLUDE';

function initialState() {
  const state = Core.emptyState();
  Object.assign(state.settings, { setupWizardCompleted: true, setupWizardIntroVersion: '1.1.0', aiProvider: 'deepseek', aiModel: 'deepseek-flash', aiContextCategories: [] });
  return state;
}

async function fixture(run, initial = initialState()) {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
    const errors = [], remoteAttempts = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:\/\//, route => { remoteAttempts.push(route.request().url()); return route.abort(); });
    await page.addInitScript(({ initial, storage, secret }) => {
      window.CampusDeskThemeEdition = true;
      window.CampusDeskAppVersion = { version: '1.1.0', name: 'Super Orion' };
      window.fetch = undefined;
      window.bridgeMessages = [];
      if (!localStorage.getItem(storage)) localStorage.setItem(storage, JSON.stringify(initial));
      window.webkit = { messageHandlers: { campus: { postMessage(message) {
        bridgeMessages.push(structuredClone(message));
        if (message.action === 'saveState') localStorage.setItem(storage, JSON.stringify(message.state));
        if (message.action === 'ready') queueMicrotask(() => {
          CampusDesk.receive({ type: 'state', state: JSON.parse(localStorage.getItem(storage)) });
          // A malformed extra field must never become request context or saved state.
          CampusDesk.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'stored', apiKey: secret });
        });
        if (message.action === 'assistantListModels') queueMicrotask(() => CampusDesk.receive({ type: 'assistantModels', provider: message.provider, requestId: message.requestId, models: message.provider === 'deepseek' ? ['deepseek-flash'] : ['synthetic-local:1b'] }));
      } } } };
    }, { initial, storage: fixtureStorage, secret: secretSentinel });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../Resources/index.html')).href + '#assistant');
    await page.locator('#assistant-question').waitFor();
    await run(page);
    assert.deepEqual(errors, [], 'no uncaught browser errors');
    assert.deepEqual(remoteAttempts, [], 'the fixture never requests a real model or school service');
  } finally { await browser.close(); }
}

async function savedState(page) {
  return page.evaluate(storage => JSON.parse(localStorage.getItem(storage)), fixtureStorage);
}

async function sendAndReply(page, question, answer) {
  const before = await page.evaluate(() => bridgeMessages.filter(row => row.action === 'assistantRequest').length);
  await page.locator('#assistant-question').fill(question);
  await page.locator('#assistant-send').click();
  await page.waitForFunction(count => bridgeMessages.filter(row => row.action === 'assistantRequest').length === count, before + 1);
  const request = await page.evaluate(() => bridgeMessages.filter(row => row.action === 'assistantRequest').at(-1));
  await page.evaluate(({ requestId, answer }) => CampusDesk.receive({ type: 'assistantResponse', requestId, answer, providerUsed: 'deepseek' }), { requestId: request.requestId, answer });
  await page.waitForFunction(answer => document.getElementById('assistant-chat-log').textContent.includes(answer), answer);
  await page.waitForFunction(({ storage, answer }) => {
    const state = JSON.parse(localStorage.getItem(storage));
    return state.assistantConversations.some(row => row.messages.some(message => message.content === answer));
  }, { storage: fixtureStorage, answer });
  return request;
}

async function openHistory(page) {
  if (!await page.locator('#assistant-history-panel').isVisible()) await page.locator('#assistant-history-button').click();
  await page.locator('#assistant-history-search').waitFor();
}

async function loadEarlierMessages(page, expected) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const before = await page.locator('#assistant-chat-log .assistant-message').count();
    if (before === expected) return;
    await page.locator('[data-action="assistant-load-earlier"]').click();
    await page.waitForFunction(before => document.querySelectorAll('#assistant-chat-log .assistant-message').length > before, before, { timeout: 5000 });
  }
  assert.equal(await page.locator('#assistant-chat-log .assistant-message').count(), expected);
}

test('history persists two separate conversations, searches full answers, and resumes the selected chat after restart', optional, async () => fixture(async page => {
  await sendAndReply(page, 'ALPHA_FIRST_QUESTION', 'ALPHA_ANSWER_WITH_SEARCHABLE_NEEDLE');
  const alpha = (await savedState(page)).assistantActiveConversationId;
  assert.ok(alpha);
  await page.locator('#assistant-question').fill('ALPHA_UNSENT_DRAFT');
  await page.locator('#assistant-clear').click();
  assert.equal(await page.locator('#assistant-question').inputValue(), '', 'a new chat starts with its own empty draft');
  assert.doesNotMatch(await page.locator('#assistant-chat-log').innerText(), /ALPHA_FIRST_QUESTION/);
  await sendAndReply(page, 'BETA_PRIVATE_QUESTION', 'BETA_PRIVATE_ANSWER');
  const beta = (await savedState(page)).assistantActiveConversationId;
  assert.notEqual(alpha, beta);
  await page.locator('#assistant-question').fill('BETA_PRIVATE_DRAFT');
  await openHistory(page);
  assert.equal(await page.locator('[data-action="assistant-open-conversation"]').count(), 2);
  await page.locator('#assistant-history-search').fill('SEARCHABLE_NEEDLE');
  assert.equal(await page.locator('[data-action="assistant-open-conversation"]').count(), 1, 'search includes answer text beyond the conversation title');
  assert.equal(await page.locator('[data-action="assistant-open-conversation"]').first().getAttribute('data-id'), alpha);
  await page.locator('[data-action="assistant-open-conversation"]').first().click();
  assert.match(await page.locator('#assistant-chat-log').innerText(), /ALPHA_FIRST_QUESTION/);
  assert.doesNotMatch(await page.locator('#assistant-chat-log').innerText(), /BETA_PRIVATE/);
  assert.equal(await page.locator('#assistant-question').inputValue(), 'ALPHA_UNSENT_DRAFT', 'switching back restores this conversation’s draft');
  await page.reload();
  await page.waitForFunction(() => document.getElementById('assistant-chat-log')?.textContent.includes('ALPHA_ANSWER_WITH_SEARCHABLE_NEEDLE'));
  assert.equal(await page.locator('#assistant-question').inputValue(), 'ALPHA_UNSENT_DRAFT', 'the active conversation and draft survive app restart');
  const request = await sendAndReply(page, 'ALPHA_FOLLOW_UP_AFTER_RESTART', 'ALPHA_SECOND_ANSWER');
  const requestText = JSON.stringify(request.messages);
  assert.match(requestText, /ALPHA_FIRST_QUESTION/);
  assert.match(requestText, /ALPHA_ANSWER_WITH_SEARCHABLE_NEEDLE/);
  assert.match(requestText, /ALPHA_FOLLOW_UP_AFTER_RESTART/);
  assert.doesNotMatch(requestText, /BETA_PRIVATE/);
  assert.doesNotMatch(JSON.stringify(request), new RegExp(secretSentinel));
  const state = await savedState(page);
  assert.equal(state.assistantConversations.find(row => row.id === alpha).messages.filter(row => row.role === 'user').length, 2);
  assert.equal(state.assistantConversations.find(row => row.id === beta).messages.filter(row => row.role === 'user').length, 1);
  assert.equal(state.assistantConversations.find(row => row.id === beta).draft, 'BETA_PRIVATE_DRAFT');
  assert.doesNotMatch(JSON.stringify(state), new RegExp(secretSentinel), 'key-shaped native status extras are not persisted');
  await openHistory(page);
  await page.locator('#assistant-history-search').fill('');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-action="assistant-delete-conversation"][data-id="' + beta + '"]').click();
  assert.equal((await savedState(page)).assistantConversations.length, 1);
  assert.equal((await savedState(page)).assistantActiveConversationId, alpha, 'deleting another chat leaves the active chat intact');
  await page.locator('[data-action="assistant-undo-delete"]').click();
  assert.equal((await savedState(page)).assistantConversations.length, 2);
  assert.equal((await savedState(page)).assistantConversations.find(row => row.id === beta).draft, 'BETA_PRIVATE_DRAFT', 'undo restores the removed conversation and draft');
}));

test('long saved conversations keep all displayed messages and resume with only the bounded current-chat request context', optional, async () => {
  const state = initialState(), contextKey = JSON.stringify(['deepseek', false, []]);
  const messages = Array.from({ length: 180 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: (index % 2 ? 'SAVED_ANSWER_' : 'SAVED_QUESTION_') + String(Math.floor(index / 2)).padStart(3, '0'), contextKey }));
  state.assistantConversations = [{ id: 'long-saved-chat', title: 'Large saved synthetic conversation', createdAt: '2026-10-15T01:00:00Z', updatedAt: '2026-10-15T01:00:00Z', draft: '', messages, provider: 'deepseek', contextCategories: [] }];
  state.assistantActiveConversationId = 'long-saved-chat';
  await fixture(async page => {
    assert.ok(await page.locator('#assistant-chat-log .assistant-message').count() <= 40, 'long histories initially mount a compact recent window');
    await loadEarlierMessages(page, 180);
    const transcript = await page.locator('#assistant-chat-log').innerText();
    assert.match(transcript, /SAVED_QUESTION_000/);
    assert.match(transcript, /SAVED_ANSWER_089/);
    assert.equal(await page.locator('#assistant-chat-log .assistant-message').count(), 180);
    const request = await sendAndReply(page, 'APPEND_TO_LARGE_SAVED_CHAT', 'LARGE_CHAT_NEW_ANSWER');
    assert.match(JSON.stringify(request.messages), /SAVED_ANSWER_089/);
    assert.doesNotMatch(JSON.stringify(request.messages), /SAVED_QUESTION_000/);
    assert.ok(request.messages.length <= 10, 'model context retains only the supported recent successful turns');
    assert.equal((await savedState(page)).assistantConversations[0].messages.length, 182, 'request trimming never discards displayed or persisted history');
    await page.reload();
    await page.waitForFunction(() => document.getElementById('assistant-chat-log')?.textContent.includes('LARGE_CHAT_NEW_ANSWER'));
    await loadEarlierMessages(page, 182);
    assert.equal(await page.locator('#assistant-chat-log .assistant-message').count(), 182);
  }, state);
});

test('history titles and bodies remain plain text and fit narrow screens while the editor remains usable', optional, async () => {
  const state = initialState(), contextKey = JSON.stringify(['deepseek', false, []]);
  state.assistantConversations = Array.from({ length: 15 }, (_, index) => ({ id: 'safe-chat-' + index, title: '<img src=x onerror=alert(1)> ' + 'LongTitle'.repeat(12), createdAt: '2026-10-15T01:00:00Z', updatedAt: '2026-10-15T01:00:00Z', draft: '', messages: [{ role: 'user', content: 'UnbrokenSearchableText'.repeat(80), contextKey }, { role: 'assistant', content: '<script>window.syntheticAttack=true</script>', contextKey }], provider: 'deepseek', contextCategories: [] }));
  state.assistantActiveConversationId = 'safe-chat-0';
  await fixture(async page => {
    await openHistory(page);
    assert.match(await page.locator('#assistant-history-results').innerText(), /<img src=x onerror=alert\(1\)>/);
    assert.equal(await page.locator('#assistant-history-results img, #assistant-history-results script').count(), 0);
    assert.equal(await page.evaluate(() => window.syntheticAttack), undefined);
    await page.locator('#assistant-history-search').fill('UnbrokenSearchableText');
    assert.equal(await page.locator('[data-action="assistant-open-conversation"]').count(), 15);
    for (const width of [1280, 760, 390]) {
      await page.setViewportSize({ width, height: 1100 });
      assert.equal(await page.evaluate(() => {
        const results = document.getElementById('assistant-history-results');
        return document.documentElement.scrollWidth <= innerWidth + 1 && results.scrollWidth <= results.clientWidth + 1;
      }), true, 'history fits viewport at ' + width);
    }
    await page.locator('#assistant-question').fill('Draft while history is open');
    assert.equal(await page.locator('#assistant-question').inputValue(), 'Draft while history is open');
    assert.equal(await page.locator('#assistant-send').isEnabled(), true);
    assert.equal(await page.locator('dialog[open]').count(), 0, 'history browsing is inline and does not block the composer');
  }, state);
});
