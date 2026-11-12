'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
function fixture(text = 'Please submit the chemistry report.', id = 'teams:one') {
  return { id, fingerprint: 'a'.repeat(64), accountId: 'synthetic', title: 'Chemistry', channel: 'Homework', text, sourceIncomplete: false };
}
function harness(inputs = [fixture()]) {
  let state = { settings: { teamsAnalysisEnabled: true, aiModel: 'deepseek-flash' }, inputs, teamsAnalysis: {} };
  let time = 1000000, canRun = true, sequence = 0;
  const timers = new Map(), sent = [], writes = [], statuses = [];
  const core = {
    teamsAnalysisModel: state => state.settings.aiModel,
    getTeamsAnalysisInputs: state => state.inputs,
    getTeamsAnalysisRecord: (state, id) => state.teamsAnalysis[id]?.fingerprint === state.inputs.find(input => input.id === id)?.fingerprint ? state.teamsAnalysis[id] : undefined,
    getTeamsAnalysisSummary: state => ({ pending: state.inputs.filter(input => !core.getTeamsAnalysisRecord(state, input.id)).length }),
    applyTeamsAnalysisResults: (state, data) => {
      const cache = { ...state.teamsAnalysis };
      for (const result of data.results) if (state.inputs.some(input => input.id === result.id && input.fingerprint === result.fingerprint) && data.model === state.settings.aiModel) cache[result.id] = { ...result, model: data.model };
      return { ...state, teamsAnalysis: cache };
    }
  };
  const ctx = { CampusCore: core, console, setTimeout, clearTimeout };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, '../Resources/teams-analysis-client.js'), 'utf8'), ctx);
  const client = ctx.CampusTeamsAnalysisClient.create({ getState: () => state,
    onState: next => { state = next; writes.push(next); }, send: (action, data) => { sent.push({ action, ...data }); return true; },
    canRun: () => canRun, onStatus: status => statuses.push(status), now: () => time,
    setTimeout: (fn, ms) => { const id = ++sequence; timers.set(id, { fn, at: time + ms }); return id; }, clearTimeout: id => timers.delete(id)
  });
  function tick(ms = 0) {
    time += ms; let count = 0;
    while (Array.from(timers.values()).some(timer => timer.at <= time)) {
      assert.ok(++count < 100, 'scheduler must yield, not spin');
      const entry = Array.from(timers).filter(([, timer]) => timer.at <= time).sort((a, b) => a[1].at - b[1].at)[0];
      timers.delete(entry[0]); entry[1].fn();
    }
  }
  function success(request = sent.filter(x => x.action === 'teamsAnalyze').at(-1), transform = x => x) {
    client.receive({ type: 'teamsAnalysisResult', requestId: request.requestId, phase: request.phase, model: request.model, success: true,
      results: request.items.map(item => transform({ id: item.id, fingerprint: item.fingerprint, summary: 'Course information', classification: 'notice', tasks: [] })) });
  }
  function fail(code, extra = {}) {
    const request = sent.filter(x => x.action === 'teamsAnalyze').at(-1);
    client.receive({ type: 'teamsAnalysisResult', requestId: request.requestId, success: false, errorCode: code, ...extra });
  }
  return { client, sent, writes, statuses, tick, success, fail, get state() { return state; }, setState: value => { state = value; },
    setCanRun: value => { canRun = value; }, requests: () => sent.filter(x => x.action === 'teamsAnalyze') };
}
test('Teams classifier sends each captured message once and reuses persisted results', () => {
  const h = harness(Array.from({ length: 12 }, (_, i) => fixture('Information ' + i, 'teams:' + i)));
  h.client.reconcile(); h.tick(); assert.equal(h.requests().length, 1); assert.equal(h.requests()[0].items.length, 8);
  h.client.reconcile(); h.tick(); assert.equal(h.requests().length, 1, 'one batch in flight');
  h.success(); h.tick(); assert.equal(h.requests().length, 2); assert.equal(h.requests()[1].items.length, 4);
  h.success(); h.tick(); h.client.reconcile(); h.tick(); assert.equal(h.requests().length, 2);
  assert.equal(Object.keys(h.state.teamsAnalysis).length, 12);
});
test('Teams classifier reads all long attachment text before publishing one final classification', () => {
  const text = 'start:' + '😀'.repeat(51000) + ':important final page';
  const h = harness([fixture(text)]); h.client.reconcile(); h.tick();
  const chunks = []; let guard = 0;
  while (h.requests().at(-1).phase === 'summarize') {
    assert.ok(++guard < 20);
    const request = h.requests().at(-1); chunks.push(...request.items.map(x => x.text));
    assert.ok(request.items.reduce((n, x) => n + x.text.length, 0) <= 48000);
    assert.ok(request.items.every(x => x.text.length <= 20000 && !/[\uD800-\uDBFF]$/.test(x.text)));
    h.success(); assert.equal(h.writes.length, 0, 'partial summaries cannot generate tasks'); h.tick();
  }
  assert.ok(chunks.join('') === text, 'every original character must be processed, in order');
  assert.equal(h.requests().at(-1).phase, 'classify'); h.success(); h.tick();
  assert.equal(h.state.teamsAnalysis['teams:one'].status, 'ready'); assert.equal(h.writes.length, 1);
});
test('Teams classifier hierarchically reduces large summaries without publishing intermediate tasks', () => {
  const h = harness([fixture('x'.repeat(1000000))]); h.client.reconcile(); h.tick();
  let count = 0, sawReduction = false;
  while (h.requests().at(-1).phase === 'summarize') {
    assert.ok(++count < 80);
    const request = h.requests().at(-1);
    if (request.items.some(item => item.text.includes('分段分析'))) sawReduction = true;
    h.success(request, result => ({ ...result, summary: 's'.repeat(1200) }));
    assert.equal(h.writes.length, 0); h.tick();
  }
  assert.ok(sawReduction); h.success(); h.tick(); assert.equal(h.writes.length, 1);
});
test('Teams classifier discards stale edits and never accepts a late cancelled response', () => {
  const h = harness(); h.client.reconcile(); h.tick(); const old = h.requests()[0];
  h.setState({ ...h.state, inputs: [{ ...h.state.inputs[0], fingerprint: 'b'.repeat(64), text: 'No homework today.' }] });
  h.success(old); h.tick(); assert.equal(h.writes.length, 0); assert.equal(h.requests().length, 2);
  h.success(old); assert.equal(h.writes.length, 0); h.success(); h.tick();
  assert.equal(h.state.teamsAnalysis['teams:one'].fingerprint, 'b'.repeat(64));
});
test('Teams classifier gates cloud uploads on explicit enablement and pauses for user chat', () => {
  const h = harness(); h.setState({ ...h.state, settings: { ...h.state.settings, teamsAnalysisEnabled: false } });
  h.client.reconcile(); h.tick(); assert.equal(h.requests().length, 0);
  h.setState({ ...h.state, settings: { ...h.state.settings, teamsAnalysisEnabled: true } }); h.setCanRun(false);
  h.client.reconcile(); h.tick(); assert.equal(h.requests().length, 0);
  h.setCanRun(true); h.client.reconcile(); h.tick(); assert.equal(h.requests().length, 1);
  h.setState({ ...h.state, settings: { ...h.state.settings, teamsAnalysisEnabled: false } });
  h.client.reconcile(); h.tick(); assert.ok(h.sent.some(x => x.action === 'teamsAnalysisCancel'));
  h.success(); assert.equal(h.writes.length, 0); assert.equal(h.client.getStatus().running, false);
});
test('Teams classifier rejects incomplete, duplicated, or fabricated IDs and isolates the failed batch', () => {
  for (const invalid of ['missing', 'duplicate', 'fabricated', 'fingerprint', 'schema']) {
    const h = harness([fixture('first', 'teams:1'), fixture('second', 'teams:2')]); h.client.reconcile(); h.tick();
    const request = h.requests()[0], results = request.items.map(item => ({ id: item.id, fingerprint: item.fingerprint, summary: '', classification: 'notice', tasks: [] }));
    if (invalid === 'missing') results.pop();
    if (invalid === 'duplicate') results[1].id = results[0].id;
    if (invalid === 'fabricated') results[0].id = 'invented';
    if (invalid === 'fingerprint') results[0].fingerprint = 'z'.repeat(64);
    if (invalid === 'schema') results[0].classification = 'homework';
    h.client.receive({ type: 'teamsAnalysisResult', requestId: request.requestId, phase: request.phase, model: request.model, success: true, results });
    h.tick(); assert.equal(h.requests().length, 2); assert.equal(h.requests()[1].items.length, 1);
    assert.equal(h.writes.length, 0, 'invalid batch cannot create any saved tasks');
    h.fail('badResponse'); h.tick(); h.success(); h.tick();
    assert.equal(h.client.getStatus().blocked, false);
    assert.equal(h.state.teamsAnalysis['teams:1'].status, 'failed');
    assert.equal(h.state.teamsAnalysis['teams:2'].status, 'ready');
    assert.ok(Object.values(h.state.teamsAnalysis).every(x => x.tasks.length === 0));
  }
});
test('Teams classifier pauses after three consecutive malformed single-message results', () => {
  const h = harness(Array.from({ length: 10 }, (_, i) => fixture('information', 'teams:' + i)));
  h.client.reconcile(); h.tick(); h.fail('badResponse'); h.tick();
  for (let i = 0; i < 3; i++) { assert.equal(h.requests().at(-1).items.length, 1); h.fail('badResponse'); h.tick(); }
  assert.equal(h.client.getStatus().blocked, true); assert.equal(h.requests().length, 4);
  assert.equal(Object.keys(h.state.teamsAnalysis).length, 3);
});
test('Teams classifier rate-limit retries are delayed and bounded, then explicit retry resumes', () => {
  const h = harness(); h.client.reconcile(); h.tick();
  h.fail('rateLimited', { retryAfterSeconds: 60 }); h.tick(59999); assert.equal(h.requests().length, 1);
  h.tick(1); assert.equal(h.requests().length, 2); h.fail('network'); h.tick(30000);
  assert.equal(h.requests().length, 3); h.fail('network'); h.tick(1000000);
  assert.equal(h.requests().length, 3); assert.equal(h.client.getStatus().blocked, true);
  h.client.retry(); h.tick(); assert.equal(h.requests().length, 4); h.success(); h.tick();
  assert.equal(h.state.teamsAnalysis['teams:one'].status, 'ready');
});
test('Teams classifier missing credentials stops the whole queue without heuristic tasks', () => {
  const h = harness(Array.from({ length: 20 }, (_, i) => fixture('information', 'teams:' + i)));
  h.client.reconcile(); h.tick(); h.fail('missingKey'); h.tick(1000000);
  assert.equal(h.requests().length, 1); assert.equal(h.client.getStatus().errorCode, 'missingKey');
  assert.equal(Object.keys(h.state.teamsAnalysis).length, 8); assert.ok(h.state.inputs.length > Object.keys(h.state.teamsAnalysis).length);
});
test('Teams classifier cancels on account/model changes and resets safely', () => {
  const h = harness(); h.client.reconcile(); h.tick();
  h.setState({ ...h.state, settings: { ...h.state.settings, aiModel: 'deepseek-pro' }, inputs: [{ ...h.state.inputs[0], fingerprint: 'b'.repeat(64), accountId: 'other' }] });
  h.client.reconcile(); h.tick(); assert.equal(h.requests().length, 2); assert.equal(h.requests()[1].model, 'deepseek-pro');
  h.client.reset(); h.success(); h.tick(); assert.equal(h.writes.length, 0);
});
