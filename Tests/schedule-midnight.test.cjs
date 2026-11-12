'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../Resources/core.js');
const Agenda = require('../Resources/agenda.js');

function nightState(date = '2026-11-12', start = '23:45') {
  const state = Core.emptyState();
  state.settings.customLessons = [{ id: 'night', title: 'Synthetic night class', date, weekdays: [], start, end: '' }];
  return Core.validateState(state);
}

test('course countdown and next class agree with the agenda across Beijing midnight', () => {
  const state = nightState(), reader = Core.createClassClockReader(state);
  assert.equal(state.settings.customLessons[0].end, '00:30');
  for (const [now, phase, remaining] of [
    ['2026-11-12T23:44:59+08:00', 'before', 1],
    ['2026-11-12T23:45:00+08:00', 'class', 2700],
    ['2026-11-12T23:59:59+08:00', 'class', 1801],
    ['2026-11-13T00:00:00+08:00', 'class', 1800],
    ['2026-11-13T00:29:59+08:00', 'class', 1],
    ['2026-11-13T00:30:00+08:00', 'after', 0]
  ]) {
    const clock = reader(now), next = Core.getNextClass(state, now);
    assert.equal(clock.phase, phase, now);
    assert.equal(clock.remainingSeconds, remaining, now);
    assert.equal(Boolean(next.current), phase === 'class', now);
    const agenda = Agenda.buildRange(state, { start: Core.today(now) });
    const active = agenda.find(row => Date.parse(row.startAt) <= Date.parse(now) && Date.parse(now) < Date.parse(row.endAt));
    assert.equal(Boolean(active), phase === 'class', now);
    if (clock.current) {
      assert.equal(clock.current.date, '2026-11-12', 'continuation retains its original lesson identity');
      assert.equal(clock.current.endAt, Date.parse('2026-11-13T00:30:00+08:00'));
    }
  }
});

test('overnight lessons cross year boundaries using school time even in a different display zone', () => {
  const state = nightState('2026-12-31');
  state.settings.timezone = 'America/Los_Angeles';
  const now = '2027-01-01T00:10:00+08:00';
  assert.equal(Core.getClassClock(state, now).remainingSeconds, 1200);
  assert.equal(Core.getNextClass(state, now).current.title, 'Synthetic night class');
  const rows = Agenda.buildRange(state, { start: '2027-01-01' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].endAt, '2026-12-31T16:30:00.000Z');
});

test('exact midnight ends and cancelled original lessons create no next-day continuation', () => {
  const midnight = nightState('2026-11-12', '23:15');
  assert.equal(Core.getClassClock(midnight, '2026-11-12T23:59:59+08:00').remainingSeconds, 1);
  assert.equal(Core.getClassClock(midnight, '2026-11-13T00:00:00+08:00').phase, 'empty');
  assert.deepEqual(Core.getNextClass(midnight, '2026-11-13T00:00:00+08:00'), { current: null, next: null });

  const cancelled = nightState();
  cancelled.settings.scheduleOverrides = [{ id: 'cancel-night', date: '2026-11-12', action: 'cancel', targetId: 'night@2026-11-12' }];
  const state = Core.validateState(cancelled);
  assert.equal(Core.getClassClock(state, '2026-11-13T00:10:00+08:00').phase, 'empty');
  assert.equal(Agenda.buildRange(state, { start: '2026-11-13' }).length, 0);
  assert.equal(Core.scheduleInterval({ date: '2026-11-13', start: '', end: '' }), null);
});

test('overnight widget publications continue while ordinary schedule dates and overview counts stay scoped', () => {
  const state = nightState(), readWidget = Agenda.widgetSnapshotReader(state);
  assert.equal(Core.getSchedule(state, '2026-11-12').length, 1);
  assert.equal(Core.getSchedule(state, '2026-11-13').length, 0, 'today counts never relabel yesterday’s course as a new lesson');
  for (const now of ['2026-11-12T23:50:00+08:00', '2026-11-13T00:10:00+08:00']) {
    const snapshot = readWidget(now), day = Core.today(now);
    assert.equal(snapshot.day, day);
    assert.ok(snapshot.items.some(item => item.kind === 'course' && item.date === day &&
      Date.parse(item.startAt) <= Date.parse(now) && Date.parse(now) < Date.parse(item.endAt)), now);
  }
  assert.equal(readWidget('2026-11-13T00:30:00+08:00').items.filter(item => item.kind === 'course').length, 0);

  const ordinary = nightState('2026-11-13', '09:00');
  assert.equal(Core.getSchedule(ordinary, '2026-11-13').length, 1);
  assert.equal(Core.getClassClock(ordinary, '2026-11-13T09:10:00+08:00').remainingSeconds, 2100);
  assert.equal(Core.getClassClock(ordinary, '2026-11-14T00:00:00+08:00').phase, 'empty');
});
