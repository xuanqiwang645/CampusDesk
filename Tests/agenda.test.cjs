'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Core = require('../Resources/core.js');
const Agenda = require('../Resources/agenda.js');
Core.configureSchools({ seiue: 'https://example-school.seiue.com/', managebac: 'https://example-school.managebac.cn/' });
const now = '2026-10-10T03:00:00Z';
const event = overrides => Object.assign({ title: 'Study meeting', startDate: '2026-10-10', allDay: false, startTime: '18:00', endTime: '19:00' }, overrides);
const task = (id, dueAt, extra) => Object.assign({ id, title: id, course: '', dueAt, status: 'open', createdAt: now }, extra);
const range = (state, start = '2026-10-10', end = start) => Agenda.buildRange(state, { start, end });
function calendar(state, lines) {
  state.schoolCalendar = Core.parseSchoolCalendarICS(['BEGIN:VCALENDAR', ...lines, 'END:VCALENDAR'].join('\r\n'), 'test.ics', 'Asia/Shanghai');
  return Core.validateState(state);
}

test('personal event CRUD survives validation, source sync, and backup round-trip without mutating input', () => {
  const original = Core.emptyState();
  const added = Agenda.upsertPersonalEvent(original, event({ location: 'Library', notes: 'Bring notes' }), { now });
  assert.equal(original.personalEvents.length, 0);
  assert.equal(added.personalEvents.length, 1);
  const item = added.personalEvents[0], id = item.id;
  assert.equal(item.createdAt, now.replace('Z', '.000Z'));
  const updated = Agenda.upsertPersonalEvent(added, { ...item, title: 'Updated study meeting' }, { now: '2026-10-11T00:00:00Z' });
  assert.equal(updated.personalEvents.length, 1);
  assert.equal(updated.personalEvents[0].id, id);
  assert.equal(updated.personalEvents[0].createdAt, item.createdAt);
  assert.notEqual(updated.personalEvents[0].updatedAt, item.updatedAt);
  assert.equal(added.personalEvents[0].title, 'Study meeting');
  const synced = Core.mergeSnapshot(updated, { source: 'managebac', url: 'https://example-school.managebac.cn/student/academics', capturedAt: now, courses: [], tasks: [], feedback: [] });
  const restored = Core.importBackup(JSON.stringify(Core.exportBackup(synced))).state;
  assert.deepEqual(restored.personalEvents, updated.personalEvents);
  assert.equal(Agenda.removePersonalEvent(restored, id).personalEvents.length, 0);
  assert.equal(restored.personalEvents.length, 1);
  delete original.personalEvents;
  assert.deepEqual(Core.validateState(original).personalEvents, [], 'older states migrate without losing other data');
});

test('invalid event dates, times, ranges, IDs and oversized content cannot enter saved state', () => {
  for (const invalid of [{ title: ' ' }, { startDate: '2026-02-30' }, { startTime: '25:00' }, { endTime: '17:00' },
    { endDate: '2026-10-09' }, { endDate: '2028-10-10' }, { endDate: '2026-10-11', endTime: '' },
    { notes: 'x'.repeat(4001) }, { allDay: 'yes' }, { id: '__proto__' }]) {
    assert.throws(() => Agenda.upsertPersonalEvent(Core.emptyState(), event(invalid), { now }), undefined, JSON.stringify(invalid).slice(0, 80));
  }
  const state = Agenda.upsertPersonalEvent(Core.emptyState(), event(), { now });
  state.personalEvents.push(state.personalEvents[0]);
  assert.throws(() => Core.validateState(state), /ID 重复/);
  const a = Agenda.normalizePersonalEvent(event(), { now }), b = Agenda.normalizePersonalEvent(event(), { now });
  assert.notEqual(a.id, b.id, 'separate identical user events remain separately editable');
});

test('Beijing dates, overnight events and inclusive all-day end dates are independent of host timezone', () => {
  assert.equal(Agenda.today('2026-10-09T15:59:59Z'), '2026-10-09');
  assert.equal(Agenda.today('2026-10-09T16:00:00Z'), '2026-10-10');
  let state = Agenda.upsertPersonalEvent(Core.emptyState(), event({ startTime: '23:30', endDate: '2026-10-11', endTime: '01:00' }), { now });
  state = Agenda.upsertPersonalEvent(state, event({ title: 'Trip', allDay: true, endDate: '2026-10-12' }), { now });
  const rows = range(state, '2026-10-10', '2026-10-13');
  const timed = rows.filter(item => !item.allDay), allDay = rows.filter(item => item.allDay);
  assert.deepEqual(timed.map(item => [item.date, item.startAt, item.endAt]), [
    ['2026-10-10', '2026-10-10T15:30:00.000Z', '2026-10-10T16:00:00.000Z'],
    ['2026-10-11', '2026-10-10T16:00:00.000Z', '2026-10-10T17:00:00.000Z']
  ]);
  assert.deepEqual(allDay.map(item => item.date), ['2026-10-10', '2026-10-11', '2026-10-12']);
  assert.equal(allDay[2].endAt, '2026-10-12T16:00:00.000Z');
  assert.equal(new Set(rows.map(item => item.id)).size, rows.length);
  assert.equal(new Set(timed.map(item => item.eventId)).size, 1);
  assert.deepEqual(range(state, '2026-10-10', '2026-10-13'), rows, 'IDs are deterministic on each render');
});

test('midnight end is exclusive and a start-only personal event remains a single moment', () => {
  let state = Agenda.upsertPersonalEvent(Core.emptyState(), event({ startTime: '23:00', endDate: '2026-10-11', endTime: '00:00' }), { now });
  state = Agenda.upsertPersonalEvent(state, event({ title: 'Call', endTime: '' }), { now });
  assert.equal(range(state, '2026-10-11').length, 0);
  assert.equal(range(state).find(item => item.title === 'Call').endAt, null);
});

test('calendar combines source tasks without inventing unresolved deadlines, and preserves completion', () => {
  const state = Core.emptyState();
  state.manualTasks = [task('personal', '2026-10-09T16:00:00Z'), task('no-date', null)];
  state.taskChecks.personal = true;
  state.snapshots.managebac.test = { capturedAt: now, tasks: [task('mb', '2026-10-10T10:00:00Z'), task('ambiguous', null, { dueLabel: 'Jan 17 9:15 AM' })] };
  state.snapshots.teams.test = { capturedAt: now, tasks: [task('teams:one', '2026-10-10T11:00:00Z')] };
  const rows = range(state);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(item => item.source), ['manual', 'managebac', 'teams']);
  assert.equal(rows.find(item => item.taskId === 'personal').completed, true);
  assert.ok(rows.every(item => item.kind === 'task' && item.date === '2026-10-10'));
});

test('courses honor calendar holidays and makeup weekdays through the existing schedule engine', () => {
  let state = Core.emptyState();
  state.settings.customLessons = [{ id: 'math', title: 'Math', weekdays: [3], weekPattern: 'all', start: '09:00', end: '09:40', room: 'E101' }];
  state = calendar(state, [
    'BEGIN:VEVENT', 'UID:makeup', 'DTSTART;VALUE=DATE:20261010', 'DTEND;VALUE=DATE:20261011', 'SUMMARY:补周三的课', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:holiday', 'DTSTART;VALUE=DATE:20261014', 'DTEND;VALUE=DATE:20261015', 'SUMMARY:学校放假', 'END:VEVENT'
  ]);
  const saturday = range(state);
  assert.equal(saturday.filter(item => item.kind === 'course').length, 1);
  assert.equal(saturday.find(item => item.kind === 'course').startAt, '2026-10-10T01:00:00.000Z');
  assert.equal(range(state, '2026-10-14').filter(item => item.kind === 'course').length, 0);
  assert.equal(range(state, '2026-10-14')[0].kind, 'school');
});

test('an overnight one-off lesson continues on its next day even when the range starts there', () => {
  const state = Core.emptyState();
  state.settings.customLessons = [{ id: 'night', title: 'Astronomy', date: '2026-10-09', weekdays: [], weekPattern: 'all', start: '23:45', end: '', period: '' }];
  const rows = range(state);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2026-10-10');
  assert.equal(rows[0].startAt, '2026-10-09T16:00:00.000Z');
  assert.equal(rows[0].endAt, '2026-10-09T16:30:00.000Z');
});

test('recurring source-timezone school events remain correct across DST and date boundaries', () => {
  const state = calendar(Core.emptyState(), [
    'BEGIN:VEVENT', 'UID:dst', 'DTSTART;TZID=America/New_York:20261031T090000', 'DTEND;TZID=America/New_York:20261031T100000',
    'RRULE:FREQ=DAILY;COUNT=3', 'EXDATE;TZID=America/New_York:20261101T090000', 'SUMMARY:International meeting', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:night', 'DTSTART;TZID=Asia/Shanghai:20261031T233000', 'DTEND;TZID=Asia/Shanghai:20261101T000000', 'SUMMARY:Night call', 'END:VEVENT'
  ]);
  state.settings.timezone = 'UTC';
  const rows = range(state, '2026-10-31', '2026-11-03');
  assert.equal(rows.filter(item => item.title === 'International meeting').length, 2);
  assert.equal(rows.find(item => item.date === '2026-10-31' && item.title === 'International meeting').startAt, '2026-10-31T13:00:00.000Z');
  assert.equal(rows.find(item => item.date === '2026-11-02').startAt, '2026-11-02T14:00:00.000Z');
  assert.equal(rows.filter(item => item.title === 'Night call').length, 1);
  assert.equal(state.settings.timezone, 'UTC', 'reading the calendar does not change saved settings');
});

test('Monday-first month ranges handle leap years and clamp work to at most 42 days', () => {
  assert.deepEqual(Agenda.monthRange('2028-02'), { month: '2028-02', start: '2028-01-31', end: '2028-03-12' });
  assert.deepEqual(Agenda.monthRange('2027-01'), { month: '2027-01', start: '2026-12-28', end: '2027-02-07' });
  assert.deepEqual(Agenda.monthRange('2026-11'), { month: '2026-11', start: '2026-10-26', end: '2026-12-06' });
  assert.throws(() => range(Core.emptyState(), '2026-10-01', '2026-11-12'), /42/);
  assert.throws(() => range(Core.emptyState(), '2026-10-10', '2026-10-09'), /42/);
  assert.throws(() => Agenda.monthRange('2026-02-30'), /有效日期/);
});

test('multi-day personal events cross the year boundary without mutating inclusive end dates', () => {
  const state = Agenda.upsertPersonalEvent(Core.emptyState(), event({ title: 'New year break', startDate: '2026-12-31', endDate: '2027-01-02', allDay: true }), { now });
  const rows = range(state, '2026-12-30', '2027-01-03');
  assert.deepEqual(rows.map(item => item.date), ['2026-12-31', '2027-01-01', '2027-01-02']);
  assert.equal(rows.at(-1).endAt, '2027-01-02T16:00:00.000Z');
  assert.equal(state.personalEvents[0].endDate, '2027-01-02');
});

test('legacy timed school events ending at midnight do not create a zero-length next-day entry', () => {
  const state = Core.emptyState();
  state.schoolCalendar.events = [{ id: 'legacy', title: 'Late practice', startDate: '2026-10-10', endDate: '2026-10-11',
    startTime: '23:00', endTime: '00:00', allDay: false }];
  const normalized = Core.validateState(state);
  assert.equal(range(normalized, '2026-10-11').length, 0);
  assert.equal(range(normalized, '2026-10-10')[0].endAt, '2026-10-10T16:00:00.000Z');
});

test('widget snapshot caps history and fields while retaining today and emitting only the display contract', () => {
  let state = Core.emptyState();
  for (let i = 0; i < 130; i += 1) state.manualTasks.push(task('late-' + i, new Date(Date.parse(now) - (i + 24) * 3600000).toISOString()));
  state.manualTasks.push(task('future', '2026-10-17T15:00:00Z'), task('outside', '2026-10-18T00:00:00Z'), task('complete', '2026-10-10T12:00:00Z', { status: 'completed' }));
  state = Agenda.upsertPersonalEvent(state, event({ title: 'T'.repeat(250), location: 'L'.repeat(250), notes: 'PRIVATE DESCRIPTION' }), { now });
  const snapshot = Agenda.widgetSnapshot(state, now);
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.day, '2026-10-10');
  assert.equal(snapshot.timezone, 'Asia/Shanghai');
  assert.equal(snapshot.items.filter(item => item.date < snapshot.day).length, 20);
  assert.equal(snapshot.counts.overdue, 130);
  assert.equal(snapshot.counts.today, 1);
  assert.equal(snapshot.counts.upcoming, 1);
  assert.equal(snapshot.items.find(item => item.kind === 'personal').title.length, 180);
  assert.equal(snapshot.items.find(item => item.kind === 'personal').location.length, 160);
  const allowed = ['id', 'title', 'kind', 'source', 'date', 'startAt', 'endAt', 'allDay', 'completed', 'location'].sort();
  assert.ok(snapshot.items.every(item => JSON.stringify(Object.keys(item).sort()) === JSON.stringify(allowed)));
  assert.ok(snapshot.items.some(item => item.title === 'outside'), 'known future homework remains visible beyond the calendar window');
  assert.equal(snapshot.counts.homework, 132);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE DESCRIPTION|"title":"complete"/);
});

test('widget prioritizes today and enforces its 100-row limit under a dense calendar', () => {
  const state = Core.emptyState();
  for (let i = 0; i < 120; i += 1) state.manualTasks.push(task('today-' + i, '2026-10-10T14:00:00Z'));
  const snapshot = Agenda.widgetSnapshot(state, now);
  assert.equal(snapshot.items.length, 100);
  assert.equal(snapshot.counts.today, 120);
  assert.equal(new Set(snapshot.items.map(item => item.id)).size, 100);
});

test('dense courses cannot crowd out school events, personal events or homework', () => {
  let state = Core.emptyState();
  state.settings.customLessons = Array.from({ length: 120 }, (_, index) => ({ id: 'class-' + index, title: 'Class ' + index,
    date: '2026-10-10', weekdays: [], weekPattern: 'all', start: '12:00', end: '12:40', room: 'E101' }));
  state.manualTasks = [task('late', '2026-10-09T14:00:00Z'), task('far-future', '2026-12-10T14:00:00Z'), task('no-date', null)];
  state = calendar(state, ['BEGIN:VEVENT', 'UID:school', 'DTSTART;VALUE=DATE:20261010', 'DTEND;VALUE=DATE:20261011', 'SUMMARY:School event', 'END:VEVENT']);
  state = Agenda.upsertPersonalEvent(state, event({ title: 'Personal event' }), { now });
  const snapshot = Agenda.widgetSnapshot(state, now);
  assert.equal(snapshot.items.length, 100);
  assert.deepEqual(new Set(snapshot.items.map(item => item.kind)), new Set(['course', 'school', 'personal', 'task']));
  assert.ok(['late', 'far-future', 'no-date'].every(title => snapshot.items.some(item => item.title === title)));
  assert.equal(snapshot.counts.courses, 120);
  assert.equal(snapshot.counts.calendar, 2);
  assert.equal(snapshot.counts.homework, 3);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < 262144);
});

test('undated homework keeps an explicit unknown deadline and excludes every source completion', () => {
  const state = Core.emptyState();
  state.manualTasks = [task('personal-undated', null), task('personal-done', null, { status: 'completed' })];
  state.snapshots.managebac.test = { capturedAt: now, tasks: [task('mb-undated', null), task('mb-done', null)] };
  state.taskChecks['mb-done'] = true;
  state.snapshots.teams.test = { capturedAt: now, tasks: [task('teams:undated', null), task('teams:done', null, { status: 'completed' })] };
  const snapshot = Agenda.widgetSnapshot(state, now);
  assert.equal(snapshot.items.length, 3);
  assert.equal(snapshot.counts.homework, 3);
  assert.deepEqual(new Set(snapshot.items.map(item => item.source)), new Set(['manual', 'managebac', 'teams']));
  assert.ok(snapshot.items.every(item => item.kind === 'task' && item.startAt === null && item.endAt === null && item.date === snapshot.day && !item.allDay));
  assert.equal(snapshot.counts.today, 0, 'unknown deadlines do not count as due today');
  assert.equal(snapshot.counts.overdue, 0);
  assert.equal(range(state).length, 0, 'undated homework does not acquire an in-app calendar deadline');
});

test('widget IDs conceal source identity and remain stable while Unicode truncation preserves emoji', () => {
  let state = Core.emptyState();
  state.manualTasks = [task('student@example.edu/https://school.example/private-id', '2026-10-10T13:00:00Z')];
  state.manualTasks[0].title = 'Homework';
  state = Agenda.upsertPersonalEvent(state, event({ title: 'a'.repeat(179) + '🚀more', location: 'b'.repeat(159) + '🧪more' }), { now });
  const before = Agenda.widgetSnapshot(state, now), after = Agenda.widgetSnapshot(state, '2026-10-10T04:00:00Z');
  assert.deepEqual(before.items.map(item => item.id), after.items.map(item => item.id));
  assert.ok(before.items.every(item => /^item-[a-f0-9]{16}$/.test(item.id)));
  assert.doesNotMatch(JSON.stringify(before), /student@example|school\.example|private-id/);
  const personal = before.items.find(item => item.kind === 'personal');
  assert.equal(personal.title, 'a'.repeat(179) + '🚀');
  assert.equal(personal.location, 'b'.repeat(159) + '🧪');
  assert.equal(Array.from(personal.title).length, 180);
  assert.equal(Array.from(personal.location).length, 160);
  assert.match(range(state).find(item => item.kind === 'task').id, /student@example/, 'the in-app calendar retains its original interaction identity');
});

test('agenda and widget projection run in a DOM-free native-style JSContext', () => {
  const context = vm.createContext({});
  for (const file of ['core.js', 'agenda.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../Resources', file), 'utf8'), context);
  const output = vm.runInContext('JSON.stringify(CampusAgenda.widgetSnapshot(CampusCore.emptyState(), "2026-10-09T16:00:00Z"))', context);
  assert.equal(JSON.parse(output).day, '2026-10-10');
  assert.deepEqual(JSON.parse(output).items, []);
});
