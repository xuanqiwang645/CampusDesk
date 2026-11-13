'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Core = require('../Resources/core.js'), Agenda = require('../Resources/agenda.js');
const now = '2032-04-20T08:00:00Z', url = 'https://teams.microsoft.com/v2/';
const obligation = 'All registered students must attend the workshop.';
const date = '2032-04-21 13:00';
function fixture(body = obligation + '\nWorkshop time: ' + date, ids = ['one']) {
  const state = Core.mergeSnapshot(Core.emptyState(), { source: 'teams', url, accountId: 'synthetic-account', capturedAt: now,
    posts: ids.map((id, i) => ({ id, title: 'Workshop notice', text: i ? body.replace(/\n/g, '\n\n') + '\nImage' : body,
      date: now, channel: i ? 'School > Workshop' : 'Workshop', url,
      attachments: i ? [{ id: 'image', title: 'Image', url: '', extractionStatus: 'unread' }] : [] })) });
  state.settings.teamsAnalysisEnabled = true; return state;
}
function activity(extra = {}) { return { category: 'activity', title: 'Attend workshop', summary: '', evidence: obligation,
  participationEvidence: obligation, deadlineText: date, ...extra }; }
function apply(state, actions = [activity()]) {
  return Core.applyTeamsAnalysisResults(state, { model: Core.teamsAnalysisModel(state), results: Core.getTeamsAnalysisInputs(state).map((input, i) => ({
    id: input.id, fingerprint: input.fingerprint, status: 'ready', classification: 'actionable', summary: 'Workshop information', analyzedAt: now,
    tasks: actions.map(action => ({ ...action, title: i ? '参加工作坊' : action.title })) })) });
}

test('old activities leave tasks, reminders and widget projection without deleting cached source or history', () => {
  const oldDate = '2025-03-20 13:00';
  const state = apply(fixture(obligation + '\nWorkshop time: ' + oldDate), [activity({ deadlineText: oldDate })]);
  const saved = JSON.stringify(state);
  assert.equal(Core.getTasks(state, now).length, 0);
  assert.equal(Agenda.widgetSnapshot(state, now).items.filter(row => row.kind === 'task').length, 0);
  assert.equal(Core.getTeamsAnalysisRecord(state, 'one', now).restrictionReason, 'pastActivity');
  assert.equal(JSON.stringify(state), saved);
  assert.equal(Object.values(state.teamsAnalysis)[0].tasks.length, 1);
  assert.equal(Object.values(state.snapshots.teams)[0].posts.length, 1);
});
test('unknown years, missing dates, missing commitments and optional invitations cannot create activity to-dos', () => {
  for (const [body, task] of [
    [obligation + '\nApril 21 13:00', activity({ deadlineText: 'April 21 13:00' })],
    [obligation, activity({ deadlineText: '' })],
    [obligation + '\n' + date, activity({ participationEvidence: '' })],
    ['Everyone is welcome to attend.\n' + date, activity({ evidence: 'Everyone is welcome to attend.', participationEvidence: 'Everyone is welcome to attend.' })],
    ['Workshop notice.\n' + date, activity({ evidence: 'Workshop notice.' })]
  ]) {
    const state = apply(fixture(body), [task]);
    assert.equal(Core.getTasks(state, now).length, 0);
    assert.equal(Core.getTeamsAnalysisRecord(state, 'one', now).classification, 'uncertain');
  }
});
test('future required activities remain, expire after their Beijing calendar day, and manual corrections remain authoritative', () => {
  let state = apply(fixture());
  assert.equal(Core.getTasks(state, now).length, 1);
  assert.equal(Core.getTasks(state, '2032-04-21T15:59:00Z').length, 1, 'do not assume an event ended at its start');
  assert.equal(Core.getTasks(state, '2032-04-21T16:00:00Z').length, 0);
  state = Core.setTeamsAnalysisOverride(state, 'one', 'activity');
  assert.equal(Core.getTasks(state, '2032-04-22T08:00:00Z').length, 1, 'explicit user classification is retained');
});
test('mixed messages retain overdue homework while rejecting an old activity', () => {
  const oldDate = '2025-03-20 13:00', body = obligation + '\n' + oldDate + '\nSubmit the report.\nDeadline: 2032-04-19 17:00';
  const state = apply(fixture(body), [activity({ deadlineText: oldDate }), {
    category: 'homework', title: 'Report', evidence: 'Submit the report.', deadlineText: '2032-04-19 17:00'
  }]);
  const tasks = Core.getTasks(state, now);
  assert.equal(tasks.length, 1); assert.equal(tasks[0].category, 'homework'); assert.equal(tasks[0].completed, false);
});
test('identical cross-capture activities deduplicate independently of translated titles and keep all completion IDs', () => {
  let state = apply(fixture(undefined, ['one', 'two']));
  const ids = Object.values(state.teamsAnalysis).flatMap(row => row.tasks.map(task => task.id));
  const task = Core.getTasks(state, now)[0];
  assert.equal(Core.getTasks(state, now).length, 1); assert.equal(task.duplicateTaskIds.length, 2);
  state.taskChecks[ids[1]] = true;
  assert.equal(Core.getTasks(state, now)[0].completed, true, 'old completed duplicate is honored');
  state = Core.setTaskCompleted(state, task.id, false);
  assert.ok(ids.every(id => state.taskChecks[id] === false), 'one user action reopens both aliases');
  state = Core.setTaskCompleted(state, task.id, true);
  assert.ok(ids.every(id => state.taskChecks[id] === true));
  assert.equal(Object.values(state.teamsAnalysis).length, 2);
});
test('different event dates do not merge and a manual date correction does not merge with the unedited event', () => {
  let state = apply(fixture(undefined, ['one', 'two']));
  state.settings.teamsDueOverrides['teams:two'] = '2033-04-21T05:00:00.000Z';
  assert.equal(Core.getTasks(state, now).length, 2);
});

test('cached homework labels cannot admit attendance, administrative notices or expired binder preparation', () => {
  for (const [quote, deadline, expected] of [
    ['Attend all three screenings for extra credit.', '', 'nonAcademicHomework'],
    ['Check your course registration for errors.', '', 'nonAcademicHomework'],
    ['Bring your binder with required contents.', 'tomorrow', 'pastPreparation']
  ]) {
    const original = fixture(quote + '\n' + deadline);
    const post = Object.values(original.snapshots.teams)[0].posts[0]; post.date = '2023-09-05T08:00:00Z';
    const state = apply(original, [{ category: 'homework', title: quote, evidence: quote, deadlineText: deadline }]);
    assert.equal(Core.getTasks(state, now).length, 0);
    assert.equal(Core.getTeamsAnalysisRecord(state, 'one', now).restrictionReason, expected);
    assert.equal(Object.values(state.teamsAnalysis)[0].tasks.length, 1);
  }
});
test('tomorrow is anchored to publication, not capture or analysis time; no fake clock is invented', () => {
  const quote = 'Bring your textbook tomorrow.', state = apply(fixture(quote), [{ category: 'homework', title: 'Bring textbook', evidence: quote, deadlineText: 'tomorrow' }]);
  const tasks = Core.getTasks(state, now);
  assert.equal(tasks.length, 1); assert.equal(tasks[0].dueAt, null);
  assert.match(tasks[0].dueLabel, /2032-04-21/);
  assert.equal(Core.getTasks(state, '2032-04-22T08:00:00Z').length, 0);
});
test('only fresh verified posts can admit undated academic work; unresolved and stale relative deadlines wait for review', () => {
  const quote = 'Read chapter two.';
  const fresh = apply(fixture(quote), [{ category: 'homework', title: 'Read chapter two', evidence: quote, deadlineText: '' }]);
  assert.equal(Core.getTasks(fresh, now).length, 1);
  assert.equal(Core.getTasks(fresh, '2032-05-20T08:00:00Z').length, 0);
  const relative = apply(fixture(quote + '\nTomorrow 17:00'), [{ category: 'homework', title: 'Read chapter two', evidence: quote, deadlineText: 'Tomorrow 17:00' }]);
  assert.equal(Core.getTasks(relative, now)[0].dueAt, '2032-04-21T09:00:00.000Z');
  assert.equal(Core.getTasks(relative, '2032-05-20T08:00:00Z').length, 0);
  const old = fixture(quote); Object.values(old.snapshots.teams)[0].posts[0].date = '';
  assert.equal(Core.getTasks(apply(old, [{ category: 'homework', title: 'Read chapter two', evidence: quote, deadlineText: '' }]), now).length, 0);
});
test('explicit absolute overdue assignments survive even from old posts; cancellation never becomes a new task', () => {
  const quote = 'Submit the report.', body = quote + '\n2031-04-19 17:00';
  const original = fixture(body); Object.values(original.snapshots.teams)[0].posts[0].date = '2031-04-18T08:00:00Z';
  const state = apply(original, [{ category: 'homework', title: 'Report', evidence: quote, deadlineText: '2031-04-19 17:00' }]);
  assert.equal(Core.getTasks(state, now).length, 1);
  const negative = 'Do not submit the report.';
  assert.equal(Core.getTasks(apply(fixture(negative), [{ category: 'homework', title: 'Report', evidence: negative, deadlineText: '' }]), now).length, 0);
});
test('duplicate current academic tasks merge while preserving the two original records', () => {
  const quote = 'Submit the lab report.', body = quote + '\nDeadline: 2032-04-21 17:00\n' + 'Use the supplied synthetic worksheet and show the calculations clearly.';
  const state = apply(fixture(body, ['one', 'two']), [{ category: 'homework', title: 'Lab report', evidence: quote, deadlineText: '2032-04-21 17:00' }]);
  const tasks = Core.getTasks(state, now);
  assert.equal(tasks.length, 1); assert.equal(tasks[0].duplicateTaskIds.length, 2);
  assert.equal(Object.keys(state.teamsAnalysis).length, 2);
});
test('requesting reanalysis preserves raw identities and completion records through backup restore', () => {
  let state = apply(fixture('Read chapter one.\n2032-04-21 17:00'), [{ category: 'homework', title: 'Read', evidence: 'Read chapter one.', deadlineText: '2032-04-21 17:00' }]);
  const row = Object.values(state.teamsAnalysis)[0]; state.taskChecks[row.tasks[0].id] = true; row.retryRequested = true;
  assert.equal(Core.getTasks(state, now).length, 0);
  state = Core.importBackup(Core.exportBackup(state)).state;
  assert.equal(Object.values(state.teamsAnalysis)[0].retryRequested, true);
  state = apply(state, [{ category: 'homework', title: 'Reading', evidence: 'Read chapter one.', deadlineText: '2032-04-21 17:00' }]);
  assert.equal(Core.getTasks(state, now)[0].completed, true);
});
