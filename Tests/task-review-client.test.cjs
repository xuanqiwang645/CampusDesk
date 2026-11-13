'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const Core = require('../Resources/core.js');
function harness(count = 4, hours = 2) {
  let instant = Date.parse('2026-11-12T10:00:00Z'), sequence = 0, allowed = true;
  let state = { settings: { taskReviewEnabled: true, taskReviewIntervalHours: hours, taskReviewEnabledAt: new Date(instant).toISOString(), aiModel: 'deepseek-flash' }, taskReview: {},
    tasks: Array.from({ length: count }, (_, i) => ({ id: 'task:' + i, title: 'Task ' + i, category: i % 2 ? 'activity' : 'homework', dueAt: '2026-11-13T12:00:00Z', completed: false })) };
  const timers = new Map(), sent = [];
  const ctx = { CampusCore: { teamsAnalysisModel: state => state.settings.aiModel, getTasks: state => state.tasks,
    taskReviewInputFingerprint: Core.taskReviewInputFingerprint }, setTimeout, clearTimeout };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, '../Resources/task-review-client.js'), 'utf8'), ctx);
  const client = ctx.CampusTaskReviewClient.create({ getState: () => state, onState: next => { state = next; },
    send: (action, payload) => { sent.push({ action, ...payload }); return true; }, now: () => instant, canRun: () => allowed,
    setTimeout: (fn, ms) => { const id = ++sequence; timers.set(id, { at: instant + ms, fn }); return id; }, clearTimeout: id => timers.delete(id) });
  function tick(ms = 0) {
    instant += ms; let count = 0;
    while (Array.from(timers.values()).some(timer => timer.at <= instant)) {
      assert.ok(++count < 100, 'no retry loop');
      const [id, timer] = Array.from(timers).filter(([, timer]) => timer.at <= instant).sort((a, b) => a[1].at - b[1].at)[0];
      timers.delete(id); timer.fn();
    }
  }
  function periodic(ms) { tick(ms); client.receive({ type: 'taskReviewTick' }); tick(); }
  const requests = () => sent.filter(item => item.action === 'taskReviewAnalyze');
  function success(request = requests().at(-1), recommendations = request.items.slice(0, 3).map(item => ({ id: item.id, reason: 'This task is due soon.' }))) {
    client.receive({ type: 'taskReviewResult', requestId: request.requestId, model: request.model, success: true, result: { summary: 'Start with these tasks.', recommendations } });
  }
  function fail(code) { client.receive({ type: 'taskReviewResult', requestId: requests().at(-1).requestId, success: false, errorCode: code }); }
  return { client, sent, tick, periodic, requests, success, fail, get state() { return state; }, setState: next => { state = next; }, allow: next => { allowed = next; } };
}
test('Periodic task review waits for selected interval, then saves suggestions and notifies once', () => {
  for (const hours of [1, 2, 10]) {
    const h = harness(4, hours); h.client.reconcile(); h.tick(); assert.equal(h.requests().length, 0);
    h.periodic(hours * 3600000 - 1); assert.equal(h.requests().length, 0);
    h.periodic(1); assert.equal(h.requests().length, 1); h.success(); h.tick();
    assert.equal(h.state.taskReview.recommendations.length, 3); assert.equal(h.sent.filter(x => x.action === 'taskReviewNotify').length, 1);
    h.success(); h.periodic(60000); assert.equal(h.sent.filter(x => x.action === 'taskReviewNotify').length, 1);
    assert.ok(h.state.tasks.every(task => !task.completed), 'AI cannot mark tasks complete');
  }
});
test('Periodic review uses unfinished homework and activities and does no API work for an empty list', () => {
  const h = harness(); h.setState({ ...h.state, tasks: h.state.tasks.map((task, i) => ({ ...task, completed: i < 2 })) });
  h.client.runNow(); h.tick(); assert.equal(h.requests()[0].items.length, 2);
  assert.deepEqual(Array.from(new Set(h.requests()[0].items.map(x => x.category))), ['homework', 'activity']); h.success();
  h.setState({ ...h.state, tasks: h.state.tasks.map(task => ({ ...task, completed: true })) }); h.periodic(7200000);
  assert.equal(h.requests().length, 1); assert.equal(h.state.taskReview.recommendations.length, 0);
});
test('Periodic review remains disabled by default and cancels immediately when switched off', () => {
  const h = harness(); h.setState({ ...h.state, settings: { ...h.state.settings, taskReviewEnabled: false } });
  h.client.runNow(); h.periodic(36000000); assert.equal(h.requests().length, 0);
  h.setState({ ...h.state, settings: { ...h.state.settings, taskReviewEnabled: true } }); h.client.runNow(); h.tick();
  h.setState({ ...h.state, settings: { ...h.state.settings, taskReviewEnabled: false } }); h.client.reconcile(); h.tick(); h.success();
  assert.equal(h.sent.filter(x => x.action === 'taskReviewCancel').length, 1); assert.equal(h.sent.filter(x => x.action === 'taskReviewNotify').length, 0);
});
test('Periodic review drops suggestions if tasks were completed or changed during the request', () => {
  const h = harness(); h.client.runNow(); h.tick();
  h.setState({ ...h.state, tasks: h.state.tasks.map((task, i) => ({ ...task, completed: i === 0 })) }); h.success();
  assert.equal(h.sent.filter(x => x.action === 'taskReviewNotify').length, 0); assert.equal(h.client.getStatus().errorCode, 'stale');
});
test('Periodic review never accepts fabricated IDs, duplicate recommendations or long reasons', () => {
  for (const bad of [[{ id: 'unknown', reason: 'Do this' }], [{ id: 'task:0', reason: 'Do this' }, { id: 'task:0', reason: 'Again' }], [{ id: 'task:0', reason: 'x'.repeat(301) }]]) {
    const h = harness(); h.client.runNow(); h.tick(); h.success(undefined, bad);
    assert.equal(h.sent.filter(x => x.action === 'taskReviewNotify').length, 0); assert.ok(h.state.taskReview.error);
  }
});
test('Periodic review considers all tasks across batches before one final recommendation', () => {
  const h = harness(250); h.client.runNow(); h.tick(); let guard = 0; const considered = new Set();
  while (h.client.getStatus().running) {
    assert.ok(++guard < 10); const request = h.requests().at(-1);
    for (const item of request.items) considered.add(item.id);
    assert.ok(request.items.length <= 100); h.success();
  }
  assert.equal(considered.size, 250); assert.equal(h.requests().length, 4);
  const notification = h.sent.find(x => x.action === 'taskReviewNotify');
  assert.ok(notification.taskIDs.every(id => h.requests().at(-1).items.some(item => item.id === id)), 'notification ticket belongs to final round');
});
test('Periodic review defers during chat, limits failures and never emits catch-up notification bursts', () => {
  const h = harness(); h.allow(false); h.periodic(7200000); assert.equal(h.requests().length, 0);
  h.allow(true); h.client.reconcile(); h.tick(); assert.equal(h.requests().length, 1); h.fail('busy');
  h.tick(29999); assert.equal(h.requests().length, 1); h.tick(1); h.fail('network'); h.tick(30000); h.fail('network');
  assert.equal(h.requests().length, 3); assert.equal(h.sent.filter(x => x.action === 'taskReviewNotify').length, 0);
  h.periodic(24 * 3600000); assert.equal(h.requests().length, 4); h.success(); h.tick(); assert.equal(h.requests().length, 4);
});
test('Periodic review preserves the interval across restart and manual run does not double-dispatch', () => {
  const h = harness(); h.client.runNow(); h.tick(); h.client.runNow(); h.tick(); assert.equal(h.requests().length, 1);
  h.success(); h.client.reset(); h.client.reconcile(); h.tick(); assert.equal(h.requests().length, 1);
  h.periodic(7200000); assert.equal(h.requests().length, 2);
});

test('Manual review exposes pending priority while busy and clears it on dispatch, disable and reset', () => {
  const h = harness(); h.allow(false); h.client.runNow(); h.tick();
  assert.equal(h.client.getStatus().pending, true); assert.equal(h.requests().length, 0);
  h.allow(true); h.client.reconcile(); h.tick(); assert.equal(h.requests().length, 1);
  assert.equal(h.client.getStatus().pending, false); h.success();
  h.allow(false); h.client.runNow(); h.tick(); h.client.reset(); assert.equal(h.client.getStatus().pending, false);
  h.client.runNow(); h.tick(); h.setState({ ...h.state, settings: { ...h.state.settings, taskReviewEnabled: false } });
  h.client.reconcile(); h.tick(); assert.equal(h.client.getStatus().pending, false);
});

test('A retry stops before sending tasks that were completed during its waiting period', () => {
  const h = harness(); h.client.runNow(); h.tick(); h.fail('network');
  h.setState({ ...h.state, tasks: h.state.tasks.map((task, i) => ({ ...task, completed: i === 0 })) });
  h.tick(30000);
  assert.equal(h.requests().length, 1, 'completed work must not enter a later API retry');
  assert.equal(h.client.getStatus().errorCode, 'stale');
  assert.equal(h.sent.filter(x => x.action === 'taskReviewNotify').length, 0);
});

test('A paused multi-batch review does not dispatch outdated remaining work', () => {
  const h = harness(150); h.client.runNow(); h.tick(); h.allow(false); h.success();
  h.setState({ ...h.state, tasks: h.state.tasks.map((task, i) => ({ ...task, title: i === 120 ? 'Revised instructions' : task.title })) });
  h.allow(true); h.client.reconcile(); h.tick();
  assert.equal(h.requests().length, 1);
  assert.equal(h.client.getStatus().errorCode, 'stale');
});

test('Provider cooldown longer than five minutes is respected without consuming retries early', () => {
  const h = harness(); h.client.runNow(); h.tick();
  h.client.receive({ type: 'taskReviewResult', requestId: h.requests()[0].requestId, success: false, errorCode: 'rateLimited', retryAfterSeconds: 1800 });
  h.periodic(300000); assert.equal(h.requests().length, 1);
  h.periodic(1499999); assert.equal(h.requests().length, 1);
  h.periodic(1); assert.equal(h.requests().length, 2);
  h.success(); assert.equal(h.sent.filter(x => x.action === 'taskReviewNotify').length, 1);
});

test('A review resumed after a long offline wait starts its next interval after completion', () => {
  const h = harness(4, 1); h.client.runNow(); h.tick(); h.fail('network'); h.allow(false);
  h.tick(2 * 3600000); h.allow(true); h.client.reconcile(); h.tick(); h.success();
  h.periodic(0); assert.equal(h.requests().length, 2, 'completion must not immediately trigger a second review');
  h.periodic(3600000 - 1); assert.equal(h.requests().length, 2);
  h.periodic(1); assert.equal(h.requests().length, 3);
});

test('Saved reviews carry a fingerprint of their complete input and survive task reordering', () => {
  const h = harness(); h.client.runNow(); h.tick();
  h.setState({ ...h.state, tasks: h.state.tasks.slice().reverse() }); h.success();
  assert.equal(h.sent.filter(x => x.action === 'taskReviewNotify').length, 1);
  assert.equal(h.state.taskReview.inputFingerprint, Core.taskReviewInputFingerprint(h.state.tasks, h.state.settings.aiModel));
  assert.match(h.state.taskReview.inputFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(h.state.taskReview.inputFingerprint.includes('Task'), false, 'report adds only an opaque digest, not task contents');
});

test('Saved priorities become stale after task edits, completion or model changes without deleting their history', () => {
  const original = Core.emptyState();
  original.manualTasks = [{ id: 'local-essay', title: 'Write essay', dueAt: '2026-11-14T12:00:00Z', course: 'English' }];
  const tasks = Core.getTasks(original);
  original.taskReview = { lastAttemptAt: '2026-11-12T10:00:00Z', lastCompletedAt: '2026-11-12T10:01:00Z',
    summary: 'Do the upcoming essay.', recommendations: [{ id: tasks[0].id, reason: 'The deadline is approaching.' }], error: '',
    inputFingerprint: Core.taskReviewInputFingerprint(tasks, Core.teamsAnalysisModel(original)) };
  const baseline = Core.validateState(original), savedReport = JSON.stringify(baseline.taskReview);
  assert.equal(Core.taskReviewIsCurrent(baseline), true);
  for (const change of [
    state => { state.manualTasks[0].dueAt = '2026-12-31T12:00:00Z'; },
    state => { state.manualTasks[0].title = 'Different assignment'; },
    state => { state.taskChecks[tasks[0].id] = true; },
    state => { state.settings.aiModel = 'deepseek-reasoner'; }
  ]) {
    const state = structuredClone(baseline); change(state);
    assert.equal(Core.taskReviewIsCurrent(state), false);
    assert.equal(JSON.stringify(state.taskReview), savedReport, 'stale history is retained for backup, not erased');
  }
  baseline.settings.taskReviewPanelCollapsed = true;
  assert.equal(Core.taskReviewIsCurrent(baseline), true, 'folding does not alter reviewed task inputs');
});

test('Historical reports without fingerprints remain readable but are not treated as current advice', () => {
  const state = Core.emptyState();
  state.taskReview = { lastAttemptAt: '2026-11-12T10:00:00Z', lastCompletedAt: '2026-11-12T10:01:00Z',
    summary: 'Legacy review', recommendations: [{ id: 'legacy-task', reason: 'Legacy reason' }], error: '' };
  const restored = Core.validateState(state);
  assert.equal(restored.taskReview.summary, 'Legacy review');
  assert.equal(restored.taskReview.recommendations[0].reason, 'Legacy reason');
  assert.equal(Date.parse(restored.taskReview.lastCompletedAt), Date.parse(state.taskReview.lastCompletedAt));
  assert.equal(restored.taskReview.inputFingerprint, '');
  assert.equal(Core.taskReviewIsCurrent(restored), false);
  assert.throws(() => Core.validateState({ ...state, taskReview: { ...state.taskReview, inputFingerprint: 'not-a-valid-digest' } }));
});
