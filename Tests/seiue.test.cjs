'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTimeRange, resolveWeekDates, parseDetails, parseCalendar, parsePeriods } = require('../Resources/seiue.js');

const headers = ['14\nMon', '15\nTue', '16\nWed', '17\nThu', '18\nFri', '19\nSat', '20\nSun'];
const periods = ['P1\n08:00 - 08:40', 'P2\n08:50 - 09:30', 'P3\n10:00 - 10:40'];
const event = (title, time, details = 'Grade 10 Class 1  E103  Teacher Name') => ({ title, time, details });
const model = () => ({ monthText: 'Today\nSep 2026 (Week 3)', headers, periods, completeWeek: true, loading: false, days: Array.from({ length: 7 }, () => ({ complete: true, events: [] })) });

test('date is based on displayed year/month/weekdays, independent of local time', () => {
  assert.deepEqual(resolveWeekDates('Sep 2026 (Week 3)', headers), ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']);
  assert.equal(resolveWeekDates('Sep', headers), null);
  assert.equal(resolveWeekDates('Sep 2025', headers), null);
  assert.equal(resolveWeekDates('Sep 2026', headers.slice(0, 5)), null);
});

test('week crossing New Year and month boundaries preserves actual dates', () => {
  const rollover = ['28\nMon', '29\nTue', '30\nWed', '31\nThu', '1\nFri', '2\nSat', '3\nSun'];
  assert.equal(resolveWeekDates('Jan 2027', rollover)[0], '2026-12-28');
  assert.equal(resolveWeekDates('Dec 2026', rollover)[6], '2027-01-03');
  assert.equal(resolveWeekDates('2027年1月', ['28\n周一', '29\n周二', '30\n周三', '31\n周四', '1\n周五', '2\n周六', '3\n周日'])[0], '2026-12-28');
});

test('time parser validates clock times and never guesses malformed values', () => {
  assert.deepEqual(parseTimeRange('8:00 – 8:40'), { start: '08:00', end: '08:40' });
  for (const text of ['24:00-24:40', '09:60-10:40', '10:00-09:40', '10:00', 'x08:00-08:40']) assert.equal(parseTimeRange(text), null);
  assert.equal(parsePeriods(['P1\n08:00-08:40', 'P3\n10:00-10:40']), null);
});

test('room and teacher are separated without guessing missing values', () => {
  assert.deepEqual(parseDetails('Grade 10 Class 1  E103  Teacher Name'), { room: 'E103', teacher: 'Teacher Name' });
  assert.deepEqual(parseDetails('Grade 10 PE Class 1  Teacher Name'), { room: '', teacher: 'Teacher Name' });
  assert.deepEqual(parseDetails('Grade 10 Class 1  E106'), { room: 'E106', teacher: '' });
  assert.deepEqual(parseDetails('Grade 10 Class 1  信息技术教室  Teacher Name'), { room: '信息技术教室', teacher: 'Teacher Name' });
});

test('missing periods infer self-study only for verified nonempty weekdays', () => {
  const input = model();
  input.days[0].events.push(event('Chemistry', '08:00-08:40'));
  input.days[5].events.push(event('Club', '08:00-08:40'));
  const result = parseCalendar(input);
  assert.equal(result.schedule.length, 4);
  assert.equal(result.schedule.filter(x => x.isSelfStudy).length, 2);
  assert.ok(result.schedule.filter(x => x.isSelfStudy).every(x => x.date === '2026-09-14'));
  assert.ok(!result.schedule.some(x => x.date === '2026-09-15'));
});

test('holidays, loading, invalid events and missing axis never create self-study', () => {
  for (const mutate of [x => x.days[0].holiday = true, x => x.days[0].complete = false, x => x.periods = [], x => x.days[0].events.push(event('Unknown', 'bad'))]) {
    const input = model(); input.days[0].events.push(event('Chemistry', '08:00-08:40')); mutate(input);
    assert.equal(parseCalendar(input).schedule.filter(x => x.isSelfStudy).length, 0);
  }
  for (const mutate of [x => x.loading = true, x => x.completeWeek = false, x => x.monthText = 'unknown']) {
    const input = model(); input.days[0].events.push(event('Chemistry', '08:00-08:40')); mutate(input);
    assert.equal(parseCalendar(input).schedule.length, 0);
  }
});

test('a double lesson covers both periods; duplicate DOM events are deduplicated', () => {
  const input = model();
  input.days[0].events.push(event('Chemistry', '08:00-09:30'), event('Chemistry', '08:00-09:30'));
  const result = parseCalendar(input);
  assert.equal(result.schedule.length, 2);
  assert.equal(result.schedule[1].start, '10:00');
  assert.equal(result.schedule[1].isSelfStudy, true);
});

test('next-week capture never labels new lessons with previous-week dates', () => {
  const input = model();
  input.days[4].events.push(event('Physics', '08:00-08:40'));
  const old = parseCalendar(input);
  input.headers = ['21 Mon', '22 Tue', '23 Wed', '24 Thu', '25 Fri', '26 Sat', '27 Sun'];
  const updated = parseCalendar(input);
  assert.equal(old.schedule[0].date, '2026-09-18');
  assert.equal(updated.schedule[0].date, '2026-09-25');
  assert.notEqual(old.schedule[0].id, updated.schedule[0].id);
});
