'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../Resources/core.js');
const Auto = require('../Resources/teams-auto.js');
const Teams = require('../Resources/teams.js');
const Graph = require('../Resources/graph.js');
const Agenda = require('../Resources/agenda.js');
const url = 'https://teams.microsoft.com/v2/';
const now = '2026-11-12T08:00:00Z', later = '2026-11-12T09:00:00Z';
const scope = { type: 'channel', id: 'synthetic-channel', label: 'Synthetic class > HOMEWORK', accountId: 'synthetic-account' };
function capture(records, stamp = now, changes = {}) { return Auto.normalizeRecords(records, { ...scope, ...changes }, url, stamp, 'Synthetic'); }
function state(records = [{ nativeID: 'read', text: 'Read chapter one.\nDeadline: 2026-11-13 17:00' }]) {
  const value = Core.mergeSnapshot(Core.emptyState(), capture(records));
  value.settings.teamsAnalysisEnabled = true;
  return value;
}
function analyze(value, tasks, extra = {}, index = 0) {
  const input = Core.getTeamsAnalysisInputs(value)[index];
  return Core.applyTeamsAnalysisResults(value, { model: Core.teamsAnalysisModel(value), results: [{ id: input.id, fingerprint: input.fingerprint,
    status: 'ready', classification: tasks.length ? 'actionable' : 'notice', summary: 'Synthetic summary', tasks, analyzedAt: now, ...extra }] });
}
const homework = { category: 'homework', title: 'Read chapter one', summary: 'Read the assigned chapter.', evidence: 'Read chapter one.', deadlineText: 'Deadline: 2026-11-13 17:00' };

test('analysis and scheduled review are opt-in, migrate older saves and validate their enums and bounds', () => {
  const value = Core.emptyState();
  assert.equal(value.settings.teamsAnalysisEnabled, false);
  assert.equal(value.settings.taskReviewEnabled, false);
  assert.equal(value.settings.taskReviewIntervalHours, 2);
  assert.equal(value.settings.taskReviewEnabledAt, null);
  delete value.settings.teamsAnalysisEnabled; delete value.teamsAnalysis; delete value.teamsAnalysisOverrides; delete value.taskReview;
  const restored = Core.validateState(value);
  assert.deepEqual(restored.teamsAnalysis, {}); assert.deepEqual(restored.teamsAnalysisOverrides, {});
  assert.deepEqual(restored.taskReview, { lastAttemptAt: null, lastCompletedAt: null, summary: '', recommendations: [], error: '' });
  for (const [key, bad] of [['teamsAnalysisEnabled', 'true'], ['taskReviewEnabled', 1], ['taskReviewIntervalHours', 0], ['taskReviewIntervalHours', 11], ['taskReviewIntervalHours', 1.5], ['taskReviewEnabledAt', '2026-11-12T10:00:00']]) {
    const invalid = Core.emptyState(); invalid.settings[key] = bad; assert.throws(() => Core.validateState(invalid));
  }
  value.manualTasks = [{ id: 'local', title: 'Join club', category: 'activity' }];
  assert.equal(Core.validateState(value).manualTasks[0].category, 'activity');
  value.manualTasks[0].category = 'notice'; assert.throws(() => Core.validateState(value), /分类/);
});

test('source fingerprints match SHA-256, combine post and task content, and survive recapture without truncating text', () => {
  let value = state([{ nativeID: 'one', title: '化学 🧪', text: 'Read chapter one.', instructions: 'Write observations.', postedAt: now,
    attachments: [{ id: 'file', title: 'lab.txt', url: 'https://synthetic.sharepoint.com/lab.txt' }] }]);
  const page = Object.values(value.snapshots.teams)[0];
  page.posts[0].attachments[0].text = '附录😀\n' + 'x'.repeat(50000);
  page.posts[0].attachments[0].extractionStatus = 'read';
  const input = Core.getTeamsAnalysisInputs(value)[0];
  assert.equal(Core.getTeamsAnalysisInputs(value).length, 1);
  assert.match(input.text, /Read chapter one/); assert.match(input.text, /Write observations/); assert.ok(input.text.includes('x'.repeat(50000)));
  const canonical = Object.fromEntries(['id', 'accountId', 'title', 'channel', 'publishedAt', 'text', 'sourceIncomplete', 'officialAssignment', 'attachments'].map(key => [key, input[key]]));
  const hash = text => crypto.createHash('sha256').update(text).digest('hex');
  assert.equal(input.fingerprint, hash(JSON.stringify([1, 'deepseek-flash', canonical])));
  assert.equal(input.sourceFingerprint, hash(JSON.stringify([1, canonical])));
  assert.strictEqual(Core.getTeamsAnalysisInputs(value), Core.getTeamsAnalysisInputs(value), 'unchanged snapshots reuse their index');
  const recaptured = Core.validateState(value); Object.values(recaptured.snapshots.teams)[0].capturedAt = later;
  for (const row of Object.values(recaptured.snapshots.teams)[0].posts) { row.capturedAt = later; for (const file of row.attachments) file.checkedAt = later; }
  assert.equal(Core.getTeamsAnalysisInputs(recaptured)[0].fingerprint, input.fingerprint);
  const context = { URL, URLSearchParams }; vm.createContext(context); vm.runInContext(fs.readFileSync(require.resolve('../Resources/core.js'), 'utf8'), context);
  context.fixture = JSON.stringify(value);
  assert.equal(vm.runInContext('CampusCore.getTeamsAnalysisInputs(JSON.parse(fixture))[0].fingerprint', context), input.fingerprint, 'native-style runtime needs no TextEncoder or crypto API');
});

test('grades and feedback are included with their assignment and standalone information remains analyzable', () => {
  let value = state(); const snapshot = capture([], later);
  snapshot.feedback = [{ id: 'feedback', assignmentId: 'assignment', text: 'Revise the explanation.', url }];
  snapshot.grades = [{ id: 'grade', assignmentId: 'assignment', title: 'Experiment', score: 0, maxScore: 20, url }];
  snapshot.tasks = [{ id: 'assignment', title: 'Experiment', requirements: 'Explain the reaction.', officialAssignment: true, url }];
  value = Core.mergeSnapshot(value, snapshot);
  const input = Core.getTeamsAnalysisInputs(value).find(row => row.id === 'teams:assignment');
  assert.match(input.text, /Revise the explanation/); assert.match(input.text, /score：0/); assert.match(input.text, /maxScore：20/);
  assert.equal(Core.getTeamsAnalysisInputs(value).filter(row => row.id === 'teams:assignment').length, 1);
});

test('pending, failed, notice and uncertain records never become tasks or widget items', () => {
  const original = state();
  assert.equal(Core.getTasks(original).length, 0);
  for (const extra of [{ classification: 'notice' }, { classification: 'uncertain' }, { status: 'failed', error: 'network' }]) {
    const value = analyze(original, [], extra);
    assert.equal(Core.getTasks(value).length, 0);
    assert.equal(Agenda.widgetSnapshot(value, now).items.filter(row => row.kind === 'task').length, 0);
  }
  assert.equal(Core.getTeamsAnalysisSummary(original).pending, 1);
});

test('verified analysis produces homework and activities while retaining source evidence and completed IDs', () => {
  const original = state([{ nativeID: 'read', text: 'Read chapter one.\nJoin the science fair.\nDeadline: 2026-11-13 17:00' }]);
  const sourceID = Core.getTeamsAnalysisInputs(original)[0].id;
  original.taskChecks[sourceID] = true;
  const activity = { category: 'activity', title: 'Join fair', evidence: 'Join the science fair.', deadlineText: '' };
  const value = analyze(original, [homework, activity]);
  assert.strictEqual(value.snapshots, original.snapshots, 'analysis does not clone or mutate raw snapshots');
  assert.equal(original.teamsAnalysis[sourceID], undefined);
  const rows = Core.getTasks(value);
  assert.equal(rows.find(row => row.category === 'homework').completed, true);
  assert.equal(rows.find(row => row.category === 'homework').id, sourceID);
  assert.equal(rows.find(row => row.category === 'homework').dueAt, '2026-11-13T09:00:00.000Z');
  assert.equal(rows.find(row => row.category === 'activity').dueAt, null, 'do not copy an unrelated inferred deadline onto another action');
  assert.ok(rows.every(row => row.analysisSourceId === sourceID && row.sourceURL === url && row.url === url));
  const repeated = analyze(value, [activity, homework]);
  assert.deepEqual(Core.getTasks(repeated).map(row => [row.title, row.id, row.completed]).sort(), rows.map(row => [row.title, row.id, row.completed]).sort());
  const restored = Core.importBackup(JSON.stringify(Core.exportBackup(value))).state;
  assert.deepEqual(Core.getTasks(restored), rows);
  const summary = Core.getTeamsAnalysisSummary(value); assert.equal(summary.ready, 1); assert.equal(summary.homework, 1); assert.equal(summary.activity, 1);
});

test('invented evidence, deadlines and filename-only guesses remain uncertain; model dates and links are ignored', () => {
  const original = state();
  for (const task of [{ ...homework, evidence: 'Finish a different exercise.' }, { ...homework, deadlineText: 'Deadline: 2099-01-01 17:00' }, { ...homework, category: 'not-supported' }]) {
    const value = analyze(original, [task]); assert.equal(Core.getTasks(value).length, 0);
    assert.equal(Core.getTeamsAnalysisRecord(value, Core.getTeamsAnalysisInputs(value)[0].id).classification, 'uncertain');
  }
  const noDeadline = state([{ nativeID: 'read', text: 'Read chapter one.' }]);
  const accepted = analyze(noDeadline, [{ ...homework, deadlineText: '', dueAt: '2099-01-01T00:00:00Z', url: 'https://attacker.invalid/' }]);
  assert.equal(Core.getTasks(accepted)[0].dueAt, null); assert.equal(Core.getTasks(accepted)[0].url, url);
  const filesOnly = state([{ nativeID: 'file', attachments: [{ title: 'Submit homework tomorrow.pdf' }] }]);
  assert.equal(Core.getTeamsAnalysisInputs(filesOnly)[0].sourceIncomplete, true);
  assert.equal(Core.getTasks(analyze(filesOnly, [{ category: 'homework', title: 'Submit homework', evidence: 'Submit homework tomorrow.pdf' }])).length, 0);
  const forged = Core.exportBackup(analyze(original, [homework]));
  Object.values(forged.data.teamsAnalysis)[0].tasks[0].evidence = 'A forged quotation';
  assert.equal(Core.getTasks(Core.importBackup(forged).state).length, 0, 'backup metadata cannot bypass live evidence validation');
});

test('source edits, account changes and model changes reject delayed analysis and preserve raw originals', () => {
  const original = state(), input = Core.getTeamsAnalysisInputs(original)[0];
  const payload = { model: Core.teamsAnalysisModel(original), results: [{ id: input.id, fingerprint: input.fingerprint, classification: 'actionable', tasks: [homework] }] };
  const analyzed = Core.applyTeamsAnalysisResults(original, payload);
  const edited = Core.mergeSnapshot(analyzed, capture([{ nativeID: 'read', text: 'No homework this week.' }], later));
  assert.equal(Core.getTasks(edited).length, 0); assert.equal(Core.getTeamsAnalysisRecord(edited, input.id), undefined);
  assert.strictEqual(Core.applyTeamsAnalysisResults(edited, payload), edited);
  const changedModel = { ...analyzed, settings: { ...analyzed.settings, aiModel: 'deepseek-v4-pro' } };
  assert.equal(Core.getTasks(changedModel).length, 0); assert.strictEqual(Core.applyTeamsAnalysisResults(changedModel, payload), changedModel);
  const switched = Core.mergeSnapshot(analyzed, capture([{ nativeID: 'read', text: 'Account B message.' }], later, { accountId: 'account-B' }));
  assert.deepEqual(switched.teamsAnalysis, {}); assert.strictEqual(Core.applyTeamsAnalysisResults(switched, payload), switched);
  assert.equal(Core.getTeamsPosts(edited)[0].text, 'No homework this week.');
});

test('manual correction is source-scoped, remains across model changes and does not lose completion', () => {
  const original = state(), input = Core.getTeamsAnalysisInputs(original)[0]; original.taskChecks[input.id] = true;
  let value = Core.setTeamsAnalysisOverride(original, input.id, 'activity');
  assert.equal(Core.getTasks(value)[0].category, 'activity'); assert.equal(Core.getTasks(value)[0].completed, true);
  assert.equal(Core.getTeamsAnalysisRecord(value, input.id).manualOverride.category, 'activity');
  assert.equal(Core.getTeamsAnalysisSummary(value).pending, 1, 'manual correction is not an AI completion');
  assert.equal(Core.getTeamsAnalysisSummary(value).ready, 0);
  value = { ...value, settings: { ...value.settings, aiModel: 'deepseek-v4-pro' } };
  assert.equal(Core.getTasks(value).length, 1);
  const edited = Core.mergeSnapshot(value, capture([{ nativeID: 'read', text: 'Changed meaning.' }], later));
  assert.equal(Core.getTasks(edited).length, 0);
  assert.equal(Core.getTeamsAnalysisRecord(edited, Core.getTeamsAnalysisInputs(edited)[0].id), undefined);
  assert.equal(Core.getTasks(Core.setTeamsAnalysisOverride(value, input.id, 'notice')).length, 0);
  assert.equal(Core.getTasks(Core.setTeamsAnalysisOverride(value, input.id, 'automatic')).length, 0);
  assert.equal(value.taskChecks[input.id], true);
});

test('disabling analysis retains official assignments but cannot revive heuristic notification tasks', () => {
  const snapshot = capture([{ nativeID: 'notice', text: 'No homework this week.' }, { nativeID: 'official', assignmentCard: true, title: 'Formal assignment', instructions: 'Read the source.' }]);
  let value = Core.mergeSnapshot(Core.emptyState(), snapshot);
  assert.deepEqual(Core.getTasks(value).map(row => row.title), ['Formal assignment']);
  value.settings.teamsAnalysisEnabled = true; assert.equal(Core.getTasks(value).length, 0);
  value.settings.teamsAnalysisEnabled = false; assert.deepEqual(Core.getTasks(value).map(row => row.title), ['Formal assignment']);
  const legacy = Core.validateState(value);
  for (const page of Object.values(legacy.snapshots.teams)) for (const row of [...page.posts, ...page.tasks]) delete row.officialAssignment;
  assert.equal(Core.getTasks(legacy).length, 0, 'old keyword tasks with corresponding posts are not formal assignments');
  const graph = Graph.normalizeBatch({ kind: 'assignment', capturedAt: now, class: { id: 'class' }, assignment: { id: 'assignment', displayName: 'Graph assignment', instructions: { content: 'Read this.' } } });
  assert.equal(graph.snapshots[0].tasks[0].officialAssignment, true);
  assert.equal(Core.getTasks(Core.mergeSnapshot(Core.emptyState(), graph.snapshots[0])).length, 1);
});

test('an unrelated manual correction cannot hide official assignments when analysis is disabled', () => {
  let value = Core.mergeSnapshot(Core.emptyState(), capture([
    { nativeID: 'notice', text: 'Attend the science fair.' },
    { nativeID: 'official', assignmentCard: true, title: 'Formal assignment', instructions: 'Read the source.' }
  ]));
  const inputs = Core.getTeamsAnalysisInputs(value), notice = inputs.find(row => !row.officialAssignment), official = inputs.find(row => row.officialAssignment);
  value.taskChecks[official.id] = true;
  value = Core.setTeamsAnalysisOverride(value, notice.id, 'activity');
  assert.deepEqual(Core.getTasks(value).map(row => row.category).sort(), ['activity', 'homework']);
  assert.equal(Core.getTasks(value).find(row => row.id === official.id).completed, true);
  const hidden = Core.setTeamsAnalysisOverride(value, official.id, 'notice');
  assert.equal(Core.getTasks(hidden).some(row => row.id === official.id), false);
  const restored = Core.setTeamsAnalysisOverride(hidden, official.id, 'automatic');
  assert.equal(Core.getTasks(restored).find(row => row.id === official.id).completed, true);
  assert.equal(Agenda.widgetSnapshot(restored, now).items.filter(row => row.kind === 'task').length, 1, 'completed official work stays out of widgets');
});

test('analysis evidence normalizes whitespace while ambiguous dates stay unresolved', () => {
  const value = state([{ nativeID: 'read', text: 'Read\n chapter one.\nDeadline: Friday 17:00' }]);
  const analyzed = analyze(value, [{ ...homework, deadlineText: 'Deadline: Friday 17:00' }]);
  assert.equal(Core.getTasks(analyzed).length, 1);
  assert.equal(Core.getTasks(analyzed)[0].dueAt, null);
  assert.equal(Core.getTeamsAnalysisInputs(analyzed)[0].publishedAt, null);
  const invalid = structuredClone(analyzed), row = Object.values(invalid.teamsAnalysis)[0];
  row.tasks[0].category = 'notice'; assert.throws(() => Core.validateState(invalid), /分类/);
});

test('visible reclassification retracts its old inferred task while retaining the original post', () => {
  const projection = text => ({ url, channel: 'General', messages: [{ nativeID: 'same', channelID: 'same', text }] });
  let value = Core.mergeSnapshot(Core.emptyState(), Teams.fromProjection(projection('Homework: read the source.'), now));
  value = Core.mergeSnapshot(value, Teams.fromProjection(projection('Posted in error. Disregard this message.'), later));
  assert.equal(Object.values(value.snapshots.teams)[0].tasks.length, 0);
  assert.equal(Core.getTeamsPosts(value).length, 1);
});

test('attachment versions invalidate analysis, never carry old text into a changed file, and newest extracted duplicate wins', () => {
  let value = state([{ nativeID: 'file', text: 'Read the attachment.', attachments: [{ id: 'f', title: 'Reading.pdf' }] }]);
  const page = Object.values(value.snapshots.teams)[0];
  for (const row of [page.posts[0], page.tasks[0]]) Object.assign(row.attachments[0], { text: 'Old assignment.', versionKey: 'v1:11111111', extractionStatus: 'read', capturedAt: now });
  const first = Core.getTeamsAnalysisInputs(value)[0];
  const next = Core.validateState(value), newer = Object.values(next.snapshots.teams)[0];
  Object.assign(newer.tasks[0].attachments[0], { text: 'New assignment.', versionKey: 'v1:22222222', capturedAt: later });
  const second = Core.getTeamsAnalysisInputs(next)[0];
  assert.notEqual(second.fingerprint, first.fingerprint); assert.match(second.text, /New assignment/); assert.doesNotMatch(second.text, /Old assignment/);
  const changed = capture([{ nativeID: 'file', text: 'Read the attachment.', attachments: [{ id: 'f', title: 'Reading.pdf' }] }], later);
  for (const row of [...changed.posts, ...changed.tasks]) row.attachments[0].versionKey = 'v1:33333333';
  value = Core.mergeSnapshot(value, changed);
  assert.equal(Core.getTeamsAnalysisInputs(value)[0].attachments[0].text, '');
  assert.equal(Core.getTeamsAnalysisInputs(value)[0].sourceIncomplete, true);
});

test('scheduled review state round-trips and account reset clears prior suggestions', () => {
  const value = state();
  Object.assign(value.settings, { taskReviewEnabled: true, taskReviewIntervalHours: 10, taskReviewEnabledAt: now });
  value.taskReview = { lastAttemptAt: now, lastCompletedAt: later, summary: 'Review the next task.', recommendations: [{ id: 'manual-example', reason: 'An explicit upcoming deadline.' }], error: '' };
  const restored = Core.importBackup(JSON.stringify(Core.exportBackup(value))).state;
  assert.equal(restored.settings.taskReviewIntervalHours, 10); assert.equal(restored.taskReview.recommendations[0].id, 'manual-example');
  assert.deepEqual(Core.resetTeamsData(restored).taskReview, Core.emptyState().taskReview);
  for (const review of [{ ...value.taskReview, summary: 'x'.repeat(1201) }, { ...value.taskReview, recommendations: Array(4).fill({ id: 'x', reason: 'r' }) }, { ...value.taskReview, lastCompletedAt: '2026-11-12T10:00:00' }]) {
    assert.throws(() => Core.validateState({ ...value, taskReview: review }));
  }
});
