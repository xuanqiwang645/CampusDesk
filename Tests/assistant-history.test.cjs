'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
global.CampusDeskThemeEdition = true;
const Core = require('../Resources/core.js');
delete global.CampusDeskThemeEdition;

function conversation(overrides = {}) {
  return Object.assign({ id: 'conversation-one', title: 'Chemistry follow-up',
    createdAt: '2026-10-15T12:00:00.000Z', updatedAt: '2026-10-15T12:01:00.000Z', draft: '  a draft\n',
    messages: [
      { role: 'user', content: 'Explain the first step.', contextKey: 'deepseek|tasks', createdAt: '2026-10-15T12:00:00.000Z' },
      { role: 'assistant', content: '  First step:\n  keep indentation.', display: '  First step:\n  keep indentation.\nDeepSeek',
        contextKey: 'deepseek|tasks', providerUsed: 'deepseek', createdAt: '2026-10-15T12:01:00.000Z' }
    ] }, overrides);
}
function stateWith(row = conversation()) {
  const state = Core.emptyState();
  state.assistantConversations = [row];
  state.assistantActiveConversationId = row.id;
  return state;
}

test('old Theme v1 state migrates to an empty local conversation library', () => {
  const legacy = Core.emptyState();
  delete legacy.assistantConversations;
  delete legacy.assistantActiveConversationId;
  const restored = Core.validateState(JSON.stringify(legacy));
  assert.deepEqual(restored.assistantConversations, []);
  assert.equal(restored.assistantActiveConversationId, '');
  assert.deepEqual(Core.validateAssistantConversations(undefined), []);
});

test('restart and backup round trips retain messages, draft, active conversation and follow-up additions', () => {
  let restored = Core.validateState(JSON.stringify(stateWith()));
  restored.assistantConversations[0].messages.push({ role: 'user', content: 'Why does the next step follow?', contextKey: 'deepseek|tasks' });
  restored.assistantConversations[0].updatedAt = '2026-10-15T12:02:00.000Z';
  const exported = Core.exportBackup(restored);
  const imported = Core.importBackup(JSON.stringify(exported)).state;
  assert.equal(imported.assistantActiveConversationId, 'conversation-one');
  assert.equal(imported.assistantConversations[0].messages.length, 3);
  assert.equal(imported.assistantConversations[0].messages[2].content, 'Why does the next step follow?');
  assert.equal(imported.assistantConversations[0].draft, '  a draft\n');
  assert.equal(imported.assistantConversations[0].messages[1].content, '  First step:\n  keep indentation.');
  imported.assistantConversations[0].messages[0].content = 'Changed copy';
  assert.equal(restored.assistantConversations[0].messages[0].content, 'Explain the first step.');
});

test('history saves only schema fields and never promotes request context or credentials into archives', () => {
  const row = conversation({ apiKey: 'synthetic-secret', model: 'do-not-save', schoolContext: { grades: [] },
    provider: 'hybrid', contextCategories: ['tasks', 'grades'] });
  row.messages[0].rawContext = { tasks: [] };
  row.messages[1].apiKey = 'synthetic-secret';
  const [clean] = Core.validateAssistantConversations([row]);
  assert.equal(clean.apiKey, undefined);
  assert.equal(clean.model, undefined);
  assert.equal(clean.schoolContext, undefined);
  assert.equal(clean.messages[0].rawContext, undefined);
  assert.equal(clean.messages[1].apiKey, undefined);
  assert.equal(clean.provider, 'hybrid');
  assert.deepEqual(clean.contextCategories, ['tasks', 'grades']);
  assert.equal(Core.validateAssistantConversations([conversation()])[0].provider, undefined);
  assert.equal(Core.validateAssistantConversations([conversation()])[0].contextCategories, undefined);
});

test('invalid history shape, duplicate identifiers, dangling active ids and unsafe keys are rejected', () => {
  for (const id of ['', 'contains space', '../escape', 'x'.repeat(101), 'constructor']) {
    assert.throws(() => Core.validateAssistantConversations([conversation({ id })]), /ID/);
  }
  assert.throws(() => Core.validateAssistantConversations([conversation(), conversation()]), /重复/);
  assert.throws(() => Core.validateAssistantConversations(null), /数量或格式/);
  assert.throws(() => Core.validateAssistantConversations({}), /数量或格式/);
  assert.throws(() => Core.validateState(JSON.stringify(Object.assign(stateWith(), { assistantActiveConversationId: 'missing' }))), /不存在/);
  const polluted = JSON.parse(JSON.stringify([conversation()]).replace('"title":', '"__proto__":{},"title":'));
  assert.throws(() => Core.validateAssistantConversations(polluted), /不安全/);
  const customPrototype = Object.create({ inherited: true });
  Object.assign(customPrototype, conversation());
  assert.throws(() => Core.validateAssistantConversations([customPrototype]), /不安全/);
  for (const messages of [[{ role: 'system', content: 'unsafe' }], [{ role: 'user', content: 1 }], [{ role: 'assistant', content: '', failed: 'yes' }], [{ role: 'assistant', content: '', providerUsed: 'unknown' }]]) {
    assert.throws(() => Core.validateAssistantConversations([conversation({ messages })]));
  }
});

test('history timestamps require valid dates and explicit zones; failed partial replies survive restart', () => {
  for (const timestamp of ['', 'not-a-date', '2026-02-30T08:00:00Z', '2026-10-15T25:00:00Z', '2026-10-15T08:00:00', '2026-10-15T08:00:00+15:00']) {
    assert.throws(() => Core.validateAssistantConversations([conversation({ createdAt: timestamp })]));
  }
  assert.throws(() => Core.validateAssistantConversations([conversation({ updatedAt: '2026-10-14T12:00:00Z' })]), /早于/);
  assert.throws(() => Core.validateAssistantConversations([conversation({ messages: [{ role: 'assistant', content: '', createdAt: 'tomorrow' }] })]));
  const row = conversation({ messages: [{ role: 'assistant', content: 'Partial answer', display: 'Partial answer\nConnection failed', failed: true,
    providerUsed: 'ollama', contextKey: 'ollama|tasks', createdAt: '2026-10-15T20:01:00+08:00' }] });
  const restored = Core.validateState(JSON.stringify(stateWith(row))).assistantConversations[0].messages[0];
  assert.equal(restored.failed, true);
  assert.equal(restored.createdAt, '2026-10-15T12:01:00.000Z');
});

test('history field and count limits reject overflow without truncating previous data', () => {
  const valid = conversation();
  assert.equal(Core.validateAssistantConversations(Array.from({ length: 200 }, (_, index) => conversation({ id: 'conversation-' + index }))).length, 200);
  assert.throws(() => Core.validateAssistantConversations(Array.from({ length: 201 }, (_, index) => conversation({ id: 'conversation-' + index }))));
  assert.equal(Core.validateAssistantConversations([conversation({ messages: Array.from({ length: 500 }, () => ({ role: 'user', content: 'hi' })) })])[0].messages.length, 500);
  assert.throws(() => Core.validateAssistantConversations([conversation({ messages: Array.from({ length: 501 }, () => ({ role: 'user', content: 'hi' })) })]));
  for (const overrides of [{ title: 'x'.repeat(161) }, { draft: 'x'.repeat(6001) }, { provider: 'auto' }, { contextCategories: ['tasks', 'tasks'] }, { contextCategories: ['private'] }]) {
    assert.throws(() => Core.validateAssistantConversations([conversation(overrides)]));
  }
  for (const message of [{ role: 'user', content: 'x'.repeat(6001) }, { role: 'assistant', content: 'x'.repeat(100001) },
    { role: 'assistant', content: '', display: 'x'.repeat(102001) }, { role: 'user', content: '', contextKey: 'x'.repeat(1001) }]) {
    assert.throws(() => Core.validateAssistantConversations([conversation({ messages: [message] })]));
  }
  const maxDisplay = stateWith(conversation({ messages: [{ role: 'assistant', content: 'x'.repeat(100000), display: 'x'.repeat(102000) }] }));
  assert.equal(Core.validateState(JSON.stringify(maxDisplay)).assistantConversations[0].messages[0].display.length, 102000);
  assert.deepEqual(valid, conversation(), 'Validation never mutates a pre-existing conversation');
});

test('history budget counts UTF-8 bytes, accepts exactly 8 MiB, and rejects one additional byte', () => {
  const rows = [conversation({ draft: '', messages: Array.from({ length: 84 }, () => ({ role: 'assistant', content: '', contextKey: '' })) })];
  const limit = 8 * 1024 * 1024;
  let remaining = limit - Buffer.byteLength(JSON.stringify(rows));
  for (const message of rows[0].messages) {
    const length = Math.min(remaining, 100000);
    message.content = 'x'.repeat(length); remaining -= length;
  }
  assert.equal(remaining, 0);
  assert.equal(Buffer.byteLength(JSON.stringify(rows)), limit);
  assert.equal(Core.validateAssistantConversations(rows)[0].messages.length, 84);
  rows[0].messages.at(-1).content += 'x';
  assert.throws(() => Core.validateAssistantConversations(rows), /8 MB/);
  const unicode = [conversation({ messages: Array.from({ length: 30 }, () => ({ role: 'assistant', content: '学'.repeat(100000) })) })];
  assert.ok(JSON.stringify(unicode).length < limit);
  assert.throws(() => Core.validateAssistantConversations(unicode), /8 MB/);
});

test('standard-edition state keeps the pre-existing separation from Theme assistant features', () => {
  const context = vm.createContext({ URL, TextEncoder });
  vm.runInContext(fs.readFileSync(require.resolve('../Resources/core.js'), 'utf8'), context);
  const state = context.CampusCore.validateState(JSON.stringify(stateWith()));
  assert.equal(state.assistantConversations, undefined);
  assert.equal(state.assistantActiveConversationId, undefined);
  assert.equal(context.CampusCore.emptyState().assistantConversations, undefined);
});

test('capacity preflight reserves exact UTF-8 JSON bytes without changing archive validation', () => {
  const limit = 8 * 1024 * 1024, rows = [conversation()];
  const bytes = Buffer.byteLength(JSON.stringify(rows));
  assert.equal(Core.assistantHistoryHasCapacity(rows), true);
  assert.equal(Core.assistantHistoryHasCapacity(rows, limit - bytes), true);
  assert.equal(Core.assistantHistoryHasCapacity(rows, limit - bytes + 1), false);
  assert.equal(Core.assistantHistoryHasCapacity(rows, 1250000), true);
  assert.equal(Core.assistantHistoryHasCapacity([], limit - 2), true);
  assert.equal(Core.assistantHistoryHasCapacity([], limit - 1), false);
  for (const reserve of [-1, 0.5, NaN, Infinity, '1', null, Number.MAX_SAFE_INTEGER + 1, limit + 1]) {
    assert.equal(Core.assistantHistoryHasCapacity(rows, reserve), false);
  }
  const unicode = ['学😀\n'];
  assert.equal(Core.assistantHistoryHasCapacity(unicode, limit - Buffer.byteLength(JSON.stringify(unicode))), true);
  assert.equal(Core.assistantHistoryHasCapacity(unicode, limit - Buffer.byteLength(JSON.stringify(unicode)) + 1), false);
  const circular = []; circular.push(circular);
  assert.equal(Core.assistantHistoryHasCapacity(circular), false);
  assert.equal(Core.assistantHistoryHasCapacity(undefined), false);
  assert.equal(Core.assistantHistoryHasCapacity([{ role: 'system', content: 'bytes only' }]), true);
  assert.throws(() => Core.validateAssistantConversations([{ role: 'system', content: 'bytes only' }]));
});
