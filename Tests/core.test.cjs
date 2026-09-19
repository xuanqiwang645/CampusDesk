'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../Resources/core.js');

function seiue(overrides = {}) {
  return Object.assign({ source: 'seiue', url: 'https://yly.seiue.com/timetable', title: '课表',
    capturedAt: '2026-09-18T00:00:00Z', loginRequired: false, warnings: [], schedule: [
      { id: 'math', date: '2026-09-18', start: '08:00', end: '08:40', title: '数学', room: '201', teacher: '李老师', isSelfStudy: false },
      { id: 'free', date: '2026-09-18', start: '08:50', end: '09:30', title: '', room: '', teacher: '', isSelfStudy: true }
    ] }, overrides);
}
function managebac(overrides = {}) {
  return Object.assign({ source: 'managebac', url: 'https://school.managebac.cn/student/academics', title: 'Academics',
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
  state = Core.mergeSnapshot(state, managebac({ url: 'https://school.managebac.cn/new-term', capturedAt: '2027-02-01T00:00:00Z',
    courses: [{ id: 'english', name: 'English', percentage: 80, term: 'Second Semester', isCurrentTerm: true, isCourseGrade: true }] }));
  assert.deepEqual(Core.getCourses(state).map(c => c.name), ['English']);
  assert.equal(Core.estimateGPA(Core.getCourses(state)).value, 3);
});

test('failed parsing and expired login retain useful data and mark it stale', () => {
  const original = Core.mergeSnapshot(Core.emptyState(), managebac());
  const failed = Core.mergeSnapshot(original, managebac({ capturedAt: '2026-09-18T01:00:00Z', loginRequired: true, courses: [], warnings: ['需要重新登录'] }));
  assert.equal(Core.getCourses(failed)[0].percentage, 90);
  assert.equal(failed.snapshots.managebac['https://school.managebac.cn/student/academics'].capturedAt, '2026-09-18T00:00:00.000Z');
  assert.equal(original.snapshots.managebac['https://school.managebac.cn/student/academics'].loginRequired, false);
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
  state = Core.mergeSnapshot(state, managebac({ url: 'https://school.managebac.cn/class/math', capturedAt: '2026-09-18T00:30:00Z',
    courses: [{ id: 'math', name: 'Math', percentage: 75, term: 'First Semester (current)', isCurrentTerm: true, isCourseGrade: true }] }));
  assert.equal(Core.getCourses(state).length, 1);
  assert.equal(Core.getCourses(state)[0].percentage, 75);
  state = Core.mergeSnapshot(state, seiue());
  state = Core.mergeSnapshot(state, seiue({ url: 'https://yly.seiue.com/timetable?new=1', capturedAt: '2026-09-18T00:30:00Z',
    schedule: [{ id: 'replaced', date: '2026-09-18', start: '08:00', end: '08:40', title: '英语', isSelfStudy: false }] }));
  assert.equal(Core.getSchedule(state, '2026-09-18').length, 2);
  assert.equal(Core.getSchedule(state, '2026-09-18')[0].title, '英语');
});

test('tasks dedupe by ID and semantic identity without discarding pending status', () => {
  const task = { id: 'task-1', title: 'Vocabulary quiz', course: 'English', dueAt: null, dueLabel: 'Sep 19 · 8 PM', status: 'pending' };
  let state = Core.mergeSnapshot(Core.emptyState(), managebac({ tasks: [task] }));
  state = Core.mergeSnapshot(state, managebac({ url: 'https://school.managebac.cn/tasks', capturedAt: '2026-09-18T00:01:00Z', courses: [], tasks: [task, Object.assign({}, task, { id: 'different' })] }));
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
  state = Core.mergeSnapshot(state, seiue({ url: 'https://yly.seiue.com/timetable?week=current', capturedAt: '2026-09-18T00:30:00Z',
    schedule: [], calendarDates: ['2026-09-18'] }));
  assert.equal(Core.getSchedule(state, '2026-09-18').length, 0);
  assert.equal(Core.getSourceStatus(state, 'seiue', '2026-09-18T00:31:00Z').failed, false);
  assert.equal(Core.getSourceStatus(state, 'seiue', '2026-09-18T00:31:00Z').stale, false);
  const restored = Core.validateState(JSON.stringify(state));
  assert.deepEqual(restored.snapshots.seiue['https://yly.seiue.com/timetable?week=current'].calendarDates, ['2026-09-18']);
  state = Core.mergeSnapshot(state, seiue({ capturedAt: '2026-09-18T00:45:00Z', schedule: [], calendarDates: ['2026-09-21'] }));
  assert.equal(Core.getSchedule(state, '2026-09-21').length, 0);
  assert.equal(state.snapshots.seiue['https://yly.seiue.com/timetable'].schedule.length, 0);
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
  for (const value of ['javascript:alert(1)', 'http://yly.seiue.com/', 'https://seiue.com.evil.test/', 'https://user:pass@yly.seiue.com/', 'https://school.managebac.cn:8443/']) assert.equal(Core.safeURL(value), '');
  assert.equal(Core.safeURL('https://yly.seiue.com/'), 'https://yly.seiue.com/');
  assert.equal(Core.safeURL('https://school.managebac.cn/'), 'https://school.managebac.cn/');
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
