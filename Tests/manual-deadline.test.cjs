'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../Resources/core.js');

test('typed manual deadlines preserve explicit Beijing time and normalize unambiguous entry', () => {
  for (const day of ['2026-09-29', '2026/9/29', ' ２０２６-０９-２９ ']) {
    const value = Core.parseManualDeadline(day, '１１：３０');
    assert.equal(value.error, '');
    assert.equal(value.dueAt, '2026-09-29T03:30:00.000Z');
    assert.equal(value.day, '2026-09-29');
    assert.equal(value.time, '11:30');
  }
  assert.equal(Core.parseManualDeadline('2026-09-29', '0:00').dueAt, '2026-09-28T16:00:00.000Z');
  assert.equal(Core.parseManualDeadline('2028-02-29', '23:59').dueAt, '2028-02-29T15:59:00.000Z');
});
test('optional means empty, and date-only defaults to 23:59 while time-only is rejected', () => {
  assert.equal(Core.parseManualDeadline('', '').dueAt, null);
  assert.equal(Core.parseManualDeadline('2026-09-29', '').dueAt, '2026-09-29T15:59:00.000Z');
  assert.equal(Core.parseManualDeadline('', '11:30').error, 'missing-date');
});
test('invalid calendar dates and locale-ambiguous dates cannot silently roll over or save', () => {
  for (const day of ['2026-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '09/29/2026', '2026-9/29', '2026-09-', '2026-09-00']) {
    assert.equal(Core.parseManualDeadline(day, '11:30').error, 'invalid-date', day);
  }
  for (const time of ['24:00', '11:60', '11:3', '11:30 AM', 'abc']) {
    assert.equal(Core.parseManualDeadline('2026-09-29', time).error, 'invalid-time', time);
  }
});
