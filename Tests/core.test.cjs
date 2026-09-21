'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../Resources/core.js');
// Synthetic school hosts are explicitly enabled only for this test process.
Core.configureSchools({ seiue: 'https://example-school.seiue.com/', managebac: 'https://example-school.managebac.cn/' });

function seiue(overrides = {}) {
  return Object.assign({ source: 'seiue', url: 'https://example-school.seiue.com/timetable', title: '课表',
    capturedAt: '2026-09-18T00:00:00Z', loginRequired: false, warnings: [], schedule: [
      { id: 'math', date: '2026-09-18', start: '08:00', end: '08:40', title: '数学', room: '201', teacher: '李老师', isSelfStudy: false },
      { id: 'free', date: '2026-09-18', start: '08:50', end: '09:30', title: '', room: '', teacher: '', isSelfStudy: true }
    ] }, overrides);
}
function managebac(overrides = {}) {
  return Object.assign({ source: 'managebac', url: 'https://example-school.managebac.cn/student/academics', title: 'Academics',
    capturedAt: '2026-09-18T00:00:00Z', loginRequired: false, warnings: [],
    courses: [{ id: 'math', name: 'Math', percentage: 90, term: 'First Semester (current)', isCurrentTerm: true, isCourseGrade: true }],
    tasks: [], feedback: [], officialGPA: null }, overrides);
}

test('Beijing day changes at 16:00 UTC and midnight uses 00:00', () => {
  assert.equal(Core.today('2026-09-18T15:59:00Z'), '2026-09-18');
  assert.equal(Core.today('2026-09-18T16:00:00Z'), '2026-09-19');
  assert.equal(Core.clock('2026-09-18T16:00:00Z'), '00:00');
  assert.equal(Core.today('2026-09-18T16:00:00Z', 'America/Los_Angeles'), '2026-09-18');
});

test('dashboard theme keeps old exports on classic and accepts only explicit panel choices', () => {
  const empty = Core.emptyState();
  assert.equal(empty.settings.dashboardTheme, 'classic');
  const legacy = JSON.parse(JSON.stringify(empty)); delete legacy.settings.dashboardTheme;
  assert.equal(Core.validateState(legacy).settings.dashboardTheme, 'classic');
  const board = Core.emptyState(); board.settings.dashboardTheme = 'board';
  assert.equal(Core.validateState(board).settings.dashboardTheme, 'board');
  const invalid = Core.emptyState(); invalid.settings.dashboardTheme = 'neon';
  assert.throws(() => Core.validateState(invalid), /面板样式/);
});

test('schedule never relabels yesterday as today; class interval excludes exact end', () => {
  const state = Core.mergeSnapshot(Core.emptyState(), seiue());
  assert.equal(Core.getSchedule(state, '2026-09-19').length, 0);
  assert.equal(Core.getNextClass(state, '2026-09-18T00:20:00Z').current.title, '数学');
  assert.equal(Core.getNextClass(state, '2026-09-18T00:40:00Z').current, null);
  assert.equal(Core.getNextClass(state, '2026-09-18T00:40:00Z').next.title, '自习课');
  assert.deepEqual(Core.getNextClass(state, '2026-09-19T00:20:00Z'), { current: null, next: null });
  state.settings.selfStudy = false;
  assert.equal(Core.getSchedule(state, '2026-09-18').length, 1);
});

test('zero is a real grade; null, empty text, NaN and missing grades are excluded', () => {
  const result = Core.estimateGPA([{ percentage: 0 }, { percentage: 100 }, { percentage: null }, {}, { percentage: '' }, { percentage: NaN }]);
  assert.equal(result.value, 2);
  assert.equal(result.count, 2);
  assert.equal(result.excluded, 4);
  assert.equal(Core.estimateGPA([{ percentage: null }]).value, null);
});

test('GPA bands include each exact boundary and exclude assignment grades', () => {
  assert.deepEqual([0, 59.99, 60, 69.99, 70, 79.99, 80, 89.99, 90, 100].map(Core.gradePoints), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  const result = Core.estimateGPA([{ percentage: 90 }, { percentage: 60 }, { percentage: 0, isCourseGrade: false }]);
  assert.equal(result.value, 2.5);
  assert.equal(result.count, 2);
});

test('historical terms and unconfirmed grades do not enter current GPA', () => {
  let state = Core.mergeSnapshot(Core.emptyState(), managebac({ courses: [
    { id: 'history', name: 'History', percentage: 0, term: 'Old Term', isCurrentTerm: false, isCourseGrade: true },
    { id: 'math', name: 'Math', percentage: 90, term: 'First Semester', isCurrentTerm: true, isCourseGrade: true },
    { id: 'other', name: 'Other', percentage: 10, term: 'First Semester' }
  ] }));
  assert.equal(Core.estimateGPA(Core.getCourses(state)).value, 4);
  assert.equal(Core.estimateGPA(Core.getCourses(state)).count, 1);
  state = Core.mergeSnapshot(state, managebac({ url: 'https://example-school.managebac.cn/new-term', capturedAt: '2027-02-01T00:00:00Z',
    courses: [{ id: 'english', name: 'English', percentage: 80, term: 'Second Semester', isCurrentTerm: true, isCourseGrade: true }] }));
  assert.deepEqual(Core.getCourses(state).map(c => c.name), ['English']);
  assert.equal(Core.estimateGPA(Core.getCourses(state)).value, 3);
});

test('failed parsing and expired login retain useful data and mark it stale', () => {
  const original = Core.mergeSnapshot(Core.emptyState(), managebac());
  const failed = Core.mergeSnapshot(original, managebac({ capturedAt: '2026-09-18T01:00:00Z', loginRequired: true, courses: [], warnings: ['需要重新登录'] }));
  assert.equal(Core.getCourses(failed)[0].percentage, 90);
  assert.equal(failed.snapshots.managebac['https://example-school.managebac.cn/student/academics'].capturedAt, '2026-09-18T00:00:00.000Z');
  assert.equal(original.snapshots.managebac['https://example-school.managebac.cn/student/academics'].loginRequired, false);
  const status = Core.getSourceStatus(failed, 'managebac', '2026-09-18T01:01:00Z');
  assert.equal(status.loginRequired, true);
  assert.equal(status.stale, true);
  assert.equal(status.failed, true);
  assert.deepEqual(status.warnings, ['需要重新登录']);
  const unreadable = Core.mergeSnapshot(failed, managebac({ capturedAt: '2026-09-18T02:00:00Z', courses: [], parseError: true }));
  assert.equal(Core.getCourses(unreadable)[0].percentage, 90);
  assert.equal(unreadable.gradeHistory.length, 1);
});

test('latest per-course and per-slot records win across multiple pages', () => {
  let state = Core.mergeSnapshot(Core.emptyState(), managebac());
  state = Core.mergeSnapshot(state, managebac({ url: 'https://example-school.managebac.cn/class/math', capturedAt: '2026-09-18T00:30:00Z',
    courses: [{ id: 'math', name: 'Math', percentage: 75, term: 'First Semester (current)', isCurrentTerm: true, isCourseGrade: true }] }));
  assert.equal(Core.getCourses(state).length, 1);
  assert.equal(Core.getCourses(state)[0].percentage, 75);
  state = Core.mergeSnapshot(state, seiue());
  state = Core.mergeSnapshot(state, seiue({ url: 'https://example-school.seiue.com/timetable?new=1', capturedAt: '2026-09-18T00:30:00Z',
    schedule: [{ id: 'replaced', date: '2026-09-18', start: '08:00', end: '08:40', title: '英语', isSelfStudy: false }] }));
  assert.equal(Core.getSchedule(state, '2026-09-18').length, 2);
  assert.equal(Core.getSchedule(state, '2026-09-18')[0].title, '英语');
});

test('tasks dedupe by ID and semantic identity without discarding pending status', () => {
  const task = { id: 'task-1', title: 'Vocabulary quiz', course: 'English', dueAt: null, dueLabel: 'Sep 19 · 8 PM', status: 'pending' };
  let state = Core.mergeSnapshot(Core.emptyState(), managebac({ tasks: [task] }));
  state = Core.mergeSnapshot(state, managebac({ url: 'https://example-school.managebac.cn/tasks', capturedAt: '2026-09-18T00:01:00Z', courses: [], tasks: [task, Object.assign({}, task, { id: 'different' })] }));
  assert.equal(Core.getTasks(state).length, 1);
  assert.equal(Core.getTasks(state)[0].completed, false);
  state.taskChecks['task-1'] = true;
  assert.equal(Core.getTasks(state)[0].completed, true);
  state.taskChecks['task-1'] = false;
  assert.equal(Core.getTasks(state)[0].completed, false);
});

test('GPA history adds only eligible course changes; official remains separate', () => {
  let state = Core.mergeSnapshot(Core.emptyState(), managebac());
  state = Core.mergeSnapshot(state, managebac({ capturedAt: '2026-09-18T00:15:00Z' }));
  assert.equal(state.gradeHistory.length, 1);
  state = Core.mergeSnapshot(state, managebac({ capturedAt: '2026-09-18T00:30:00Z',
    courses: [{ id: 'math', name: 'Math', percentage: 91, term: 'First Semester (current)', isCurrentTerm: true, isCourseGrade: true }],
    officialGPA: { value: 4.3, scale: 5, label: 'Weighted GPA' } }));
  assert.equal(state.gradeHistory.length, 1);
  assert.equal(state.gradeHistory[0].capturedAt, '2026-09-18T00:30:00.000Z');
  assert.equal(Core.estimateGPA(Core.getCourses(state)).value, 4);
  assert.equal(Core.getOfficialGPA(state).value, 4.3);
  assert.equal(Core.getOfficialGPA(state).scale, 5);
  const unknown = Core.mergeSnapshot(Core.emptyState(), managebac({ courses: [{ id: 'x', name: 'Unknown term', percentage: 95 }] }));
  assert.equal(unknown.gradeHistory.length, 0);
});

test('verified empty calendar clears old lessons even when another cached URL had data', () => {
  let state = Core.mergeSnapshot(Core.emptyState(), seiue());
  state = Core.mergeSnapshot(state, seiue({ url: 'https://example-school.seiue.com/timetable?week=current', capturedAt: '2026-09-18T00:30:00Z',
    schedule: [], calendarDates: ['2026-09-18'] }));
  assert.equal(Core.getSchedule(state, '2026-09-18').length, 0);
  assert.equal(Core.getSourceStatus(state, 'seiue', '2026-09-18T00:31:00Z').failed, false);
  assert.equal(Core.getSourceStatus(state, 'seiue', '2026-09-18T00:31:00Z').stale, false);
  const restored = Core.validateState(JSON.stringify(state));
  assert.deepEqual(restored.snapshots.seiue['https://example-school.seiue.com/timetable?week=current'].calendarDates, ['2026-09-18']);
  state = Core.mergeSnapshot(state, seiue({ capturedAt: '2026-09-18T00:45:00Z', schedule: [], calendarDates: ['2026-09-21'] }));
  assert.equal(Core.getSchedule(state, '2026-09-21').length, 0);
  assert.equal(state.snapshots.seiue['https://example-school.seiue.com/timetable'].schedule.length, 0);
});

test('late arrival cannot overwrite a newer snapshot; GPA history has one value per Beijing day and term', () => {
  let state = Core.mergeSnapshot(Core.emptyState(), managebac());
  state = Core.mergeSnapshot(state, managebac({ capturedAt: '2026-09-17T23:59:00Z', courses: [] }));
  assert.equal(Core.getCourses(state)[0].percentage, 90);
  state = Core.mergeSnapshot(state, managebac({ capturedAt: '2026-09-18T01:00:00Z',
    courses: [{ id: 'math', name: 'Math', percentage: 80, term: 'First Semester (current)', isCurrentTerm: true, isCourseGrade: true }] }));
  assert.equal(state.gradeHistory.length, 1);
  assert.equal(state.gradeHistory[0].value, 3);
  state = Core.mergeSnapshot(state, managebac({ capturedAt: '2026-09-18T16:00:00Z',
    courses: [{ id: 'math', name: 'Math', percentage: 70, term: 'First Semester (current)', isCurrentTerm: true, isCourseGrade: true }] }));
  assert.equal(state.gradeHistory.length, 2);
  assert.deepEqual(state.gradeHistory.map(h => h.date), ['2026-09-18', '2026-09-19']);
});

test('imports reject malformed content, invalid ranges and dangerous prototype keys', () => {
  assert.throws(() => Core.validateState('{oops'));
  assert.throws(() => Core.validateState({ version: 99 }));
  const malformed = Core.emptyState();
  malformed.manualTasks = [{ id: 'x', title: 'Bad date', dueAt: 'not a date' }];
  assert.throws(() => Core.validateState(malformed));
  const tooLong = Core.emptyState();
  tooLong.manualTasks = [{ id: 'x', title: 'x'.repeat(501) }];
  assert.throws(() => Core.validateState(tooLong));
  const polluted = JSON.stringify(Core.emptyState()).replace('"taskChecks":{}', '"taskChecks":{"__proto__":{"polluted":true}}');
  assert.throws(() => Core.validateState(polluted), /不安全/);
  assert.equal({}.polluted, undefined);
  const customProto = Core.emptyState();
  customProto.settings = Object.create({ timezone: 'Asia/Shanghai' });
  assert.throws(() => Core.validateState(customProto), /不安全/);
  assert.throws(() => Core.mergeSnapshot(Core.emptyState(), managebac({ courses: [{ id: 'x', name: 'Math', percentage: 101 }] })));
  assert.throws(() => Core.mergeSnapshot(Core.emptyState(), seiue({ schedule: [{ date: '2026-02-30', start: '08:00', end: '08:40', title: 'Math' }] })));
});

test('URLs cannot navigate to non-school hosts, scripts, plaintext or embedded credentials', () => {
  for (const value of ['javascript:alert(1)', 'http://example-school.seiue.com/', 'https://seiue.com.evil.test/', 'https://user:pass@example-school.seiue.com/', 'https://example-school.managebac.cn:8443/']) assert.equal(Core.safeURL(value), '');
  assert.equal(Core.safeURL('https://example-school.seiue.com/'), 'https://example-school.seiue.com/');
  assert.equal(Core.safeURL('https://example-school.managebac.cn/'), 'https://example-school.managebac.cn/');
  assert.equal(Core.safeURL('https://school.managebac.com/', 'seiue'), '');
});

test('export/import round trip preserves data but returns an independent object', () => {
  let state = Core.mergeSnapshot(Core.emptyState(), seiue());
  state = Core.mergeSnapshot(state, managebac());
  state.manualTasks.push({ id: 'manual-one', title: 'Bring notebook', course: '个人待办', dueAt: null, dueLabel: '', status: 'open', createdAt: '2026-09-18T00:00:00Z', url: '' });
  const restored = Core.validateState(JSON.stringify(state));
  assert.equal(Core.getTasks(restored)[0].title, 'Bring notebook');
  restored.settings.selfStudy = false;
  assert.equal(state.settings.selfStudy, true);
  assert.equal(restored.gradeHistory[0].value, 4);
});

function teams(overrides = {}) {
  return Object.assign({ source: 'teams', url: 'https://teams.microsoft.com/v2/', title: 'English',
    capturedAt: '2026-09-18T00:00:00Z', loginRequired: false, parseError: false, coverage: 'visible', warnings: [],
    tasks: [{ id: 'essay', title: 'Essay', course: 'English', dueAt: null, dueLabel: 'Friday',
      requirements: 'Use two examples.\nBring a printed copy.', status: 'open', url: 'https://teams.microsoft.com/l/message/english/essay',
      attachments: [{ title: 'Rubric.docx', url: 'https://school.sharepoint.com/sites/English/Rubric.docx' }] }],
    posts: [{ id: 'ec-one', title: 'English corner', text: 'Group A\nStudent Example', author: 'Teacher Example', channel: 'English',
      date: '2026-09-18', kind: 'ec', url: 'https://teams.microsoft.com/l/message/english/ec', attachments: [] }] }, overrides);
}

test('legacy v1 imports add Teams defaults while retaining personal data and grade history', () => {
  const legacy = Core.mergeSnapshot(Core.mergeSnapshot(Core.emptyState(), seiue()), managebac());
  delete legacy.snapshots.teams;
  for (const field of ['teamsPages', 'teamsNotifications', 'teamsBrowser', 'teamsBrowserAutomation', 'reminderMinutes', 'teamsDueOverrides']) delete legacy.settings[field];
  legacy.taskChecks.essay = true;
  legacy.feedbackRead.comment = true;
  const migrated = Core.validateState(JSON.stringify(legacy));
  assert.equal(migrated.version, 1);
  assert.deepEqual(migrated.settings.teamsPages, []);
  assert.equal(migrated.settings.teamsNotifications, false);
  assert.equal(migrated.settings.teamsBrowser, 'chrome');
  assert.equal(migrated.settings.teamsBrowserAutomation, false);
  assert.equal(migrated.settings.reminderMinutes, 30);
  assert.deepEqual(migrated.settings.teamsDueOverrides, {});
  assert.deepEqual(migrated.snapshots.teams, {});
  assert.deepEqual(migrated.gradeHistory, legacy.gradeHistory);
  assert.equal(migrated.taskChecks.essay, true);
  assert.equal(migrated.feedbackRead.comment, true);
  assert.equal(Core.getSchedule(migrated, '2026-09-18').length, 2);
});

test('v0.2 Teams settings migrate browser automation to opt-out without changing existing messages or preferences', () => {
  const original = Core.mergeSnapshot(Core.emptyState(), teams());
  delete original.settings.teamsBrowser;
  delete original.settings.teamsBrowserAutomation;
  original.settings.teamsNotifications = true;
  original.settings.teamsPages = [{ id: 'english', label: 'English channel', url: 'https://teams.microsoft.com/v2/', kind: 'ec' }];
  original.settings.teamsDueOverrides['teams:essay'] = '2026-09-19T12:00:00.000Z';
  original.taskChecks['teams:essay'] = true;
  const migrated = Core.validateState(JSON.stringify(original));
  assert.equal(migrated.settings.teamsBrowser, 'chrome');
  assert.equal(migrated.settings.teamsBrowserAutomation, false);
  assert.equal(migrated.settings.teamsNotifications, true);
  assert.deepEqual(migrated.settings.teamsPages, original.settings.teamsPages);
  assert.deepEqual(migrated.settings.teamsDueOverrides, original.settings.teamsDueOverrides);
  assert.deepEqual(migrated.snapshots.teams, original.snapshots.teams);
  assert.deepEqual(migrated.taskChecks, original.taskChecks);
});

test('Teams browser automation settings require an exact supported browser and a real boolean', () => {
  for (const browser of ['chrome', 'edge']) {
    const state = Core.emptyState();
    state.settings.teamsBrowser = browser;
    state.settings.teamsBrowserAutomation = true;
    const restored = Core.validateState(JSON.stringify(state));
    assert.equal(restored.settings.teamsBrowser, browser);
    assert.equal(restored.settings.teamsBrowserAutomation, true);
  }
  for (const browser of ['safari', 'Chrome', ' chrome ', '', null, true, 1, {}, []]) {
    const state = Core.emptyState(); state.settings.teamsBrowser = browser;
    assert.throws(() => Core.validateState(state), /浏览器/);
  }
  for (const consent of ['true', 'false', 0, 1, null, {}, []]) {
    const state = Core.emptyState(); state.settings.teamsBrowserAutomation = consent;
    assert.throws(() => Core.validateState(state), /布尔/);
  }
});

test('Teams URLs reject lookalike hosts and auth data; attachment hosts do not become source navigation hosts', () => {
  assert.equal(Core.safeURL('https://teams.cloud.microsoft/v2/', 'teams'), 'https://teams.cloud.microsoft/v2/');
  assert.equal(Core.safeURL('https://teams.microsoft.com/l/message/a/b?tenantId=abc&context=%7B%7D', 'teams'), 'https://teams.microsoft.com/l/message/a/b?tenantId=abc&context=%7B%7D');
  for (const url of ['https://evil.teams.microsoft.com/', 'https://teams.microsoft.com.evil.test/', 'https://school.sharepoint.com/',
    'http://teams.microsoft.com/', 'https://user:secret@teams.microsoft.com/', 'https://teams.microsoft.com:8443/',
    'https://teams.microsoft.com/?access_token=secret', 'https://teams.microsoft.com/#/callback?id_token=secret',
    'https://teams.microsoft.com/?%63ode=secret']) assert.equal(Core.safeURL(url, 'teams'), '', url);
  assert.equal(Core.safeURL('https://school.sharepoint.com/'), '');
  assert.equal(Core.safeAttachmentURL('https://school.sharepoint.com/:w:/r/Rubric.docx'), 'https://school.sharepoint.com/:w:/r/Rubric.docx');
  assert.equal(Core.safeAttachmentURL('https://onedrive.live.com/?id=example'), 'https://onedrive.live.com/?id=example');
  for (const url of ['https://sharepoint.com.evil.test/file', 'https://school.sharepoint.com/?access_token=secret', 'https://example.com/file',
    'http://school.sharepoint.com/file', 'https://evilonedrive.com/file', 'https://onedrive.com/file', 'https://school.onedrive.com/file',
    'https://sharepoint.com/file', 'https://sharepoint.cn/file', 'javascript:alert(1)']) assert.equal(Core.safeAttachmentURL(url), '', url);
});

test('Teams page settings validate limits, kinds, IDs, and signed date overrides', () => {
  const state = Core.emptyState();
  state.settings.teamsPages = [{ id: 'ec', label: 'EC 名单', url: 'https://teams.microsoft.com/l/channel/123/English', kind: 'ec' }];
  state.settings.teamsNotifications = true;
  state.settings.teamsDueOverrides['teams:essay'] = '2026-09-19T20:00:00+08:00';
  const restored = Core.validateState(state);
  assert.equal(restored.settings.teamsPages[0].kind, 'ec');
  assert.equal(restored.settings.teamsDueOverrides['teams:essay'], '2026-09-19T12:00:00.000Z');
  const badKind = structuredClone(state); badKind.settings.teamsPages[0].kind = 'all';
  assert.throws(() => Core.validateState(badKind));
  const tooMany = structuredClone(state); tooMany.settings.teamsPages = Array.from({ length: 21 }, (_, n) => ({ ...state.settings.teamsPages[0], id: String(n) }));
  assert.throws(() => Core.validateState(tooMany));
  for (const due of ['2026-09-19T20:00:00', '2026-02-30T20:00:00Z', '2026-09-19T20:00:00+15:00']) {
    const badDue = structuredClone(state); badDue.settings.teamsDueOverrides['teams:essay'] = due;
    assert.throws(() => Core.validateState(badDue), due);
  }
});

test('Teams and ManageBac task IDs remain separate with full requirements, attachments, and local checks', () => {
  let state = Core.mergeSnapshot(Core.emptyState(), managebac({ tasks: [{ id: 'essay', title: 'Essay', course: 'English' }] }));
  state = Core.mergeSnapshot(state, teams());
  state.taskChecks['teams:essay'] = true;
  let tasks = Core.getTasks(state);
  assert.equal(tasks.length, 2);
  assert.equal(tasks.find(t => t.source === 'managebac').completed, false);
  const task = tasks.find(t => t.source === 'teams');
  assert.equal(task.id, 'teams:essay');
  assert.equal(task.completed, true);
  assert.equal(task.requirements, 'Use two examples.\nBring a printed copy.');
  assert.equal(task.attachments[0].title, 'Rubric.docx');
  assert.equal(task.dueAt, null);
  state.settings.teamsDueOverrides['teams:essay'] = '2026-09-19T12:00:00.000Z';
  tasks = Core.getTasks(Core.validateState(state));
  assert.equal(tasks.find(t => t.source === 'teams').dueAt, '2026-09-19T12:00:00.000Z');
  assert.equal(tasks.find(t => t.source === 'teams').originalDueAt, null);
  assert.equal(tasks.find(t => t.source === 'teams').dueOverride, true);
});

test('Teams normalization preserves existing namespaces and rejects ambiguous deadline parsing', () => {
  const input = teams(); input.tasks[0].id = 'teams:essay'; input.tasks[0].dueAt = '2026-09-19T20:00:00+08:00';
  const state = Core.mergeSnapshot(Core.emptyState(), input);
  assert.equal(Core.getTasks(state)[0].id, 'teams:essay');
  assert.equal(Core.getTasks(state)[0].dueAt, '2026-09-19T12:00:00.000Z');
  input.tasks[0].dueAt = '2026-09-19T20:00:00';
  assert.throws(() => Core.mergeSnapshot(Core.emptyState(), input), /时区/);
});

test('partial Teams pages retain unseen posts and latest edits with original observation times', () => {
  let state = Core.mergeSnapshot(Core.emptyState(), teams());
  state = Core.mergeSnapshot(state, teams({ capturedAt: '2026-09-18T00:15:00Z',
    tasks: [{ id: 'essay', title: 'Revised Essay', requirements: 'Use three examples.' }],
    posts: [{ id: 'announcement', title: 'Trip', text: 'Bring water', kind: 'general' }] }));
  assert.equal(Core.getTasks(state)[0].title, 'Revised Essay');
  assert.equal(Core.getTeamsPosts(state).length, 2);
  const ec = Core.getTeamsEC(state);
  assert.equal(ec.length, 1);
  assert.equal(ec[0].text, 'Group A\nStudent Example');
  assert.equal(ec[0].capturedAt, '2026-09-18T00:00:00.000Z');
  assert.equal(ec[0].source, 'teams');
  assert.equal(Core.getTeamsPosts(state, 'general')[0].title, 'Trip');
  state = Core.mergeSnapshot(state, teams({ capturedAt: '2026-09-18T00:20:00Z', tasks: [], posts: [], success: true }));
  assert.equal(Core.getTeamsPosts(state).length, 2);
  assert.equal(Core.getTasks(state).length, 1);
  assert.equal(Core.getSourceStatus(state, 'teams', '2026-09-18T00:21:00Z').failed, false);
  assert.equal(Core.validateState(JSON.stringify(state)).snapshots.teams['https://teams.microsoft.com/v2/'].coverage, 'visible');
});

test('Teams cache is bounded at 500 records per kind and retains the newest observed rows', () => {
  let state = Core.mergeSnapshot(Core.emptyState(), teams({ tasks: [], posts: Array.from({ length: 500 }, (_, n) => ({ id: 'post-' + n, text: 'Post ' + n })) }));
  state = Core.mergeSnapshot(state, teams({ capturedAt: '2026-09-18T00:15:00Z', tasks: [], posts: [{ id: 'new', text: 'Newest' }] }));
  const posts = Core.getTeamsPosts(state);
  assert.equal(posts.length, 500);
  assert.equal(posts[0].text, 'Newest');
  assert.equal(posts.some(p => p.id === 'teams:post-499'), false);
});

test('Teams login/parser failures preserve old data; delayed success cannot roll back the latest attempt', () => {
  let state = Core.mergeSnapshot(Core.emptyState(), teams());
  state = Core.mergeSnapshot(state, teams({ capturedAt: '2026-09-18T01:00:00Z', loginRequired: true, tasks: [], posts: [], warnings: ['重新登录 Teams'] }));
  assert.equal(Core.getTasks(state).length, 1);
  assert.equal(Core.getTeamsEC(state).length, 1);
  const status = Core.getSourceStatus(state, 'teams', '2026-09-18T01:01:00Z');
  assert.equal(status.failed, true);
  assert.equal(status.loginRequired, true);
  assert.equal(status.lastCapturedAt, '2026-09-18T00:00:00.000Z');
  const late = Core.mergeSnapshot(state, teams({ capturedAt: '2026-09-18T00:30:00Z', tasks: [], posts: [] }));
  assert.equal(Core.getSourceStatus(late, 'teams', '2026-09-18T01:01:00Z').loginRequired, true);
  state = Core.mergeSnapshot(state, teams({ capturedAt: '2026-09-18T01:15:00Z', tasks: [], posts: [], parseError: true }));
  assert.equal(Core.getTeamsEC(state)[0].text, 'Group A\nStudent Example');
  assert.equal(Core.getSourceStatus(state, 'teams', '2026-09-18T01:16:00Z').failed, true);
});

test('cached copies from another Teams URL cannot supersede a newer actual observation', () => {
  let state = Core.mergeSnapshot(Core.emptyState(), teams());
  state = Core.mergeSnapshot(state, teams({ url: 'https://teams.microsoft.com/v2/other', capturedAt: '2026-09-18T00:10:00Z',
    tasks: [{ id: 'essay', title: 'Updated Essay' }], posts: [{ id: 'ec-one', kind: 'ec', text: 'Updated roster' }] }));
  state = Core.mergeSnapshot(state, teams({ capturedAt: '2026-09-18T00:20:00Z', tasks: [], posts: [] }));
  assert.equal(Core.getTasks(state)[0].title, 'Updated Essay');
  assert.equal(Core.getTeamsEC(state)[0].text, 'Updated roster');
});

test('EC publications sort by confirmed publication time even when an old roster is recaptured later', () => {
  let state = Core.mergeSnapshot(Core.emptyState(), teams({ tasks: [], posts: [
    { id: 'old-roster', title: 'Prior EC roster', text: 'Old group', kind: 'ec', date: '2026-09-15T09:00:00+08:00' },
    { id: 'new-roster', title: 'Current EC roster', text: 'New group', kind: 'ec', date: '2026-09-18T17:18:00+08:00' }
  ] }));
  state = Core.mergeSnapshot(state, teams({ capturedAt: '2026-09-19T00:00:00Z', tasks: [], posts: [
    { id: 'old-roster', title: 'Prior EC roster', text: 'Old group re-opened', kind: 'ec', date: '2026-09-15T09:00:00+08:00' }
  ] }));
  const posts = Core.getTeamsEC(state);
  assert.deepEqual(posts.map(p => p.id), ['teams:new-roster', 'teams:old-roster']);
  assert.equal(posts[0].publishedAt, '2026-09-18T09:18:00.000Z');
  assert.equal(posts[1].capturedAt, '2026-09-19T00:00:00.000Z');
  assert.equal(posts[1].text, 'Old group re-opened');
});

test('EC local-only timestamps and tomorrow remain original unknown dates after export/import', () => {
  let state = Core.mergeSnapshot(Core.emptyState(), teams({ tasks: [], posts: [
    { id: 'short', title: 'EC list', text: 'Roster PDF', kind: 'ec', date: null, dateLabel: '9/15' },
    { id: 'clock', title: 'EC announcement', text: 'Come tomorrow after lunch.', kind: 'ec', date: null, dateLabel: '5:18 PM' },
    { id: 'known', title: 'EC reference', text: 'Dated reference', kind: 'ec', date: '2026-09-16T09:00:00+08:00' }
  ] }));
  state = Core.validateState(JSON.stringify(state));
  const posts = Core.getTeamsEC(state);
  assert.equal(posts[0].id, 'teams:known');
  assert.equal(posts.find(p => p.id === 'teams:short').dateLabel, '9/15');
  assert.equal(posts.find(p => p.id === 'teams:clock').dateLabel, '5:18 PM');
  assert.equal(posts.find(p => p.id === 'teams:clock').text, 'Come tomorrow after lunch.');
  for (const post of posts.filter(p => p.id !== 'teams:known')) {
    assert.equal(post.publishedAt, null);
    assert.equal(post.date, '');
  }
  assert.equal(Core.getTasks(state).length, 0);
});

test('a partial Teams recapture without full timestamp retains a previously confirmed publication date', () => {
  let state = Core.mergeSnapshot(Core.emptyState(), teams({ tasks: [], posts: [
    { id: 'ec-one', text: 'EC original', kind: 'ec', date: '2026-09-15T09:00:00+08:00' }
  ] }));
  state = Core.mergeSnapshot(state, teams({ capturedAt: '2026-09-19T00:00:00Z', tasks: [], posts: [
    { id: 'ec-one', text: 'EC original', kind: 'ec', date: null, dateLabel: '9/15' }
  ] }));
  const post = Core.getTeamsEC(state)[0];
  assert.equal(post.publishedAt, '2026-09-15T01:00:00.000Z');
  assert.equal(post.dateLabel, '9/15');
  state = Core.mergeSnapshot(state, teams({ url: 'https://teams.microsoft.com/v2/other', capturedAt: '2026-09-19T00:15:00Z', tasks: [], posts: [
    { id: 'ec-one', text: 'EC edited text', kind: 'ec', date: null, dateLabel: '9/15' }
  ] }));
  const fromOtherView = Core.getTeamsEC(state)[0];
  assert.equal(fromOtherView.text, 'EC edited text');
  assert.equal(fromOtherView.publishedAt, '2026-09-15T01:00:00.000Z');
  assert.equal(state.snapshots.teams['https://teams.microsoft.com/v2/other'].posts[0].date, '');
});

test('clock tracks exact seconds across start/end boundaries and never makes arrival/departure a break', () => {
  const state = Core.mergeSnapshot(Core.emptyState(), seiue());
  const cases = [
    ['2026-09-17T23:59:59Z', 'before', 1], ['2026-09-18T00:00:00Z', 'class', 2400],
    ['2026-09-18T00:39:59Z', 'class', 1], ['2026-09-18T00:40:00Z', 'break', 600],
    ['2026-09-18T00:49:59Z', 'break', 1], ['2026-09-18T00:50:00Z', 'class', 2400],
    ['2026-09-18T01:30:00Z', 'after', 0], ['2026-09-18T16:00:00Z', 'empty', 0]
  ];
  for (const [now, phase, seconds] of cases) {
    const value = Core.getClassClock(state, now);
    assert.equal(value.phase, phase, now);
    assert.equal(value.remainingSeconds, seconds, now);
  }
  assert.equal(Core.getClassClock(state, '2026-09-18T00:45:07Z').remainingLabel, '04:53');
  assert.equal(Core.getClassClock(state, '2026-09-17T22:30:00Z').remainingLabel, '1:30:00');
  assert.equal(Core.getClassClock(state, '2026-09-18T00:49:59.900Z').remainingSeconds, 1);
});

test('clock uses Beijing date and includes self-study even when hidden in the schedule list', () => {
  const state = Core.mergeSnapshot(Core.emptyState(), seiue());
  state.settings.selfStudy = false;
  state.settings.timezone = 'America/Los_Angeles';
  assert.equal(Core.getSchedule(state, '2026-09-18').length, 1);
  const value = Core.getClassClock(state, '2026-09-18T00:55:17Z');
  assert.equal(value.phase, 'class');
  assert.equal(value.current.title, '自习课');
  assert.equal(value.remainingSeconds, 2083);
  assert.equal(Core.getClassClock(state, '2026-09-19T00:55:17Z').phase, 'empty');
});

test('clock handles overlapping and adjacent lessons without artificial breaks', () => {
  const state = Core.mergeSnapshot(Core.emptyState(), seiue({ schedule: [
    { date: '2026-09-18', title: 'Long lab', start: '08:00', end: '09:00' },
    { date: '2026-09-18', title: 'Small group', start: '08:30', end: '08:40' },
    { date: '2026-09-18', title: 'Next lab', start: '09:00', end: '09:40' }
  ] }));
  assert.equal(Core.getClassClock(state, '2026-09-18T00:40:00Z').phase, 'class');
  assert.equal(Core.getClassClock(state, '2026-09-18T00:40:00Z').current.title, 'Long lab');
  assert.equal(Core.getClassClock(state, '2026-09-18T01:00:00Z').current.title, 'Next lab');
  assert.equal(Core.getClassClock(state, '2026-09-18T01:40:00Z').phase, 'after');
});

test('lunch heuristic requires an internal gap of at least 45 minutes containing noon', () => {
  function withGap(end, start) {
    return Core.mergeSnapshot(Core.emptyState(), seiue({ schedule: [
      { date: '2026-09-18', title: 'Morning', start: '08:00', end },
      { date: '2026-09-18', title: 'Afternoon', start, end: '15:00' }
    ] }));
  }
  assert.equal(Core.getClassClock(withGap('11:30', '13:00'), '2026-09-18T04:00:00Z').phase, 'lunch');
  assert.equal(Core.getClassClock(withGap('11:45', '12:30'), '2026-09-18T04:00:00Z').phase, 'lunch');
  assert.equal(Core.getClassClock(withGap('11:50', '12:10'), '2026-09-18T04:00:00Z').phase, 'break');
  assert.equal(Core.getClassClock(withGap('10:30', '11:30'), '2026-09-18T03:00:00Z').phase, 'break');
});

test('clock marks stale school data and verified empty days without reusing yesterday', () => {
  let state = Core.mergeSnapshot(Core.emptyState(), seiue());
  assert.equal(Core.getClassClock(state, '2026-09-18T00:20:00Z').stale, false);
  assert.equal(Core.getClassClock(state, '2026-09-18T00:31:00Z').stale, true);
  state = Core.mergeSnapshot(state, seiue({ capturedAt: '2026-09-18T00:40:00Z', loginRequired: true, schedule: [] }));
  assert.equal(Core.getClassClock(state, '2026-09-18T00:41:00Z').stale, true);
  state = Core.mergeSnapshot(state, seiue({ capturedAt: '2026-09-19T00:00:00Z', schedule: [], calendarDates: ['2026-09-19'] }));
  const value = Core.getClassClock(state, '2026-09-19T00:10:00Z');
  assert.equal(value.phase, 'empty');
  assert.equal(value.stale, false);
});

test('25 MiB state limit counts UTF-8 bytes for Chinese and supplementary characters, including fallback', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../Resources/core.js'), 'utf8');
  const context = vm.createContext({ URL, URLSearchParams, Intl, TextEncoder: undefined });
  vm.runInContext(source, context);
  vm.runInContext("CampusCore.configureSchools({seiue:'https://example-school.seiue.com/',managebac:'https://example-school.managebac.cn/'})", context);
  const makeState = (count) => {
    const state = Core.emptyState();
    const url = 'https://teams.microsoft.com/l/channel/byte-boundary/General';
    state.snapshots.teams[url] = { source: 'teams', url, title: 'Fixture byte boundary', capturedAt: '2026-09-19T15:00:00Z',
      warnings: [], coverage: 'graph', posts: Array.from({ length: count }, (_, i) => ({ id: 'teams:graph:fixture:' + i, title: 'Fixture',
        text: '中'.repeat(29998) + '😀', kind: 'general', url })) };
    return state;
  };
  const below = makeState(280), above = makeState(295), aboveJSON = JSON.stringify(above);
  assert(aboveJSON.length < 25 * 1024 * 1024);
  assert(Buffer.byteLength(aboveJSON, 'utf8') > 25 * 1024 * 1024);
  assert.equal(Object.values(Core.validateState(below).snapshots.teams)[0].posts.length, 280);
  assert.throws(() => Core.validateState(above), /超过 25 MB/);
  assert.throws(() => Core.validateState(aboveJSON), /超过 25 MB/);
  assert.throws(() => context.CampusCore.validateState(aboveJSON), /超过 25 MB/);
  assert.equal(Object.values(context.CampusCore.validateState(JSON.stringify(below)).snapshots.teams)[0].posts.length, 280);
  const incoming = Object.values(makeState(15).snapshots.teams)[0];
  incoming.capturedAt = '2026-09-19T16:00:00Z';
  incoming.posts.forEach((post, i) => { post.id = 'teams:graph:fixture:new:' + i; });
  assert.throws(() => Core.mergeSnapshot(below, incoming), /超过 25 MB/);
  assert.equal(Object.values(below.snapshots.teams)[0].posts.length, 280);
});
