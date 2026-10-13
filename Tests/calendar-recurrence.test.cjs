'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../Resources/core.js');

function calendar(lines) {
  const state = Core.emptyState();
  state.schoolCalendar = Core.parseSchoolCalendarICS(['BEGIN:VCALENDAR','BEGIN:VEVENT','UID:synthetic','SUMMARY:Synthetic event',...lines,'END:VEVENT','END:VCALENDAR'].join('\r\n'), 'synthetic.ics', 'Asia/Shanghai');
  return Core.validateState(JSON.stringify(state));
}
const events = (state, date) => Core.getSchoolCalendarEvents(state,date);

test('UTC weekly recurrences retain their source weekday after conversion across midnight', () => {
  const state = calendar(['DTSTART:20260921T180000Z','DTEND:20260921T190000Z','RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3']);
  for (const date of ['2026-09-22','2026-09-29','2026-10-06']) {
    assert.deepEqual(events(state,date).map(event=>[event.displayStartTime,event.displayEndTime]), [['02:00','03:00']]);
  }
  for (const date of ['2026-09-21','2026-09-28','2026-10-05','2026-10-13']) assert.equal(events(state,date).length,0,date);
  state.settings.timezone = 'UTC';
  assert.equal(events(state,'2026-09-22').length,0,'cached Beijing results cannot leak into a changed display timezone');
  assert.equal(events(state,'2026-09-21')[0].displayStartTime,'18:00');
});

test('DAILY, MONTHLY and YEARLY BYDAY participate in recurrence generation and COUNT', () => {
  const daily=calendar(['DTSTART;VALUE=DATE:20260925','DTEND;VALUE=DATE:20260926','RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;COUNT=3']);
  for(const day of ['2026-09-25','2026-09-28','2026-09-29']) assert.equal(events(daily,day).length,1,day);
  for(const day of ['2026-09-26','2026-09-27','2026-09-30']) assert.equal(events(daily,day).length,0,day);
  for(const freq of ['MONTHLY','YEARLY']) {
    const state=calendar(['DTSTART;VALUE=DATE:20260907','DTEND;VALUE=DATE:20260908',`RRULE:FREQ=${freq};BYDAY=MO;COUNT=3`]);
    for(const day of ['2026-09-07','2026-09-14','2026-09-21']) assert.equal(events(state,day).length,1,`${freq} ${day}`);
    for(const day of ['2026-09-08','2026-09-28','2026-10-05']) assert.equal(events(state,day).length,0,`${freq} ${day}`);
  }
  const alternateMonths=calendar(['DTSTART;VALUE=DATE:20260907','RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=MO']);
  assert.equal(events(alternateMonths,'2026-10-05').length,0);
  assert.equal(events(alternateMonths,'2026-11-02').length,1);
});

test('source timezone recurrence changes displayed hour at DST and excludes exact occurrences', () => {
  const state=calendar(['DTSTART;TZID=America/New_York:20261031T090000','DTEND;TZID=America/New_York:20261031T100000','RRULE:FREQ=DAILY;COUNT=3','EXDATE;TZID=America/New_York:20261101T090000']);
  assert.equal(events(state,'2026-10-31')[0].displayStartTime,'21:00');
  assert.equal(events(state,'2026-11-01').length,0);
  assert.equal(events(state,'2026-11-02')[0].displayStartTime,'22:00');
  assert.equal(events(state,'2026-11-03').length,0,'EXDATE does not extend COUNT');
  const spring=calendar(['DTSTART;TZID=America/New_York:20260307T023000','DTEND;TZID=America/New_York:20260307T030000','RRULE:FREQ=DAILY;COUNT=3']);
  assert.equal(events(spring,'2026-03-08').length,0,'nonexistent spring-forward occurrence is omitted');
  assert.equal(events(spring,'2026-03-09').length,1);
  assert.equal(events(spring,'2026-03-10').length,1,'nonexistent wall times do not consume COUNT');
  assert.equal(events(spring,'2026-03-11').length,0);
});

test('UNTIL retains its exact instant and a midnight end does not add an empty next-day event', () => {
  const state=calendar(['DTSTART:20260921T180000Z','DTEND:20260921T190000Z','RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260928T175959Z']);
  assert.equal(events(state,'2026-09-22').length,1);
  assert.equal(events(state,'2026-09-29').length,0);
  const midnight=calendar(['DTSTART;TZID=Asia/Shanghai:20260927T230000','DTEND;TZID=Asia/Shanghai:20260928T000000']);
  assert.equal(events(midnight,'2026-09-27').length,1);
  assert.equal(events(midnight,'2026-09-28').length,0);
});

test('invalid recurrence counts and impossible source wall times are rejected explicitly', () => {
  for(const rule of ['FREQ=DAILY;COUNT=0','FREQ=DAILY;COUNT=1.5','FREQ=DAILY;INTERVAL=0','FREQ=DAILY;COUNT=2;UNTIL=20260928']) {
    assert.throws(()=>calendar(['DTSTART;VALUE=DATE:20260925','RRULE:'+rule]),/校历重复/);
  }
  assert.throws(()=>calendar(['DTSTART;TZID=America/New_York:20260308T023000','DTEND;TZID=America/New_York:20260308T033000']),/源时区不存在/);
  assert.throws(()=>calendar(['DTSTART:20260230T120000Z','DTEND:20260230T130000Z']),/日期无效/);
});
