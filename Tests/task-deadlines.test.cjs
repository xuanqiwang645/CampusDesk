'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../Resources/core.js');
const Teams = require('../Resources/teams.js');
const MB = require('../Resources/managebac.js');
const parse = (dueLabel, context) => Core.resolveTaskDeadline({ dueLabel }, context);

test('deadline text parses English AM/PM and Chinese dates in the school timezone', () => {
  assert.equal(parse('Due: September 28, 2026 at 11:55 PM').dueAt, '2026-09-28T15:55:00.000Z');
  assert.equal(parse('截止日期：2026年9月28日 下午 3:30').dueAt, '2026-09-28T07:30:00.000Z');
  assert.equal(parse('2026/09/28 00:00').dueAt, '2026-09-27T16:00:00.000Z');
  assert.equal(parse('2026-09-28T23:55:00+08:00').dueAt, '2026-09-28T15:55:00.000Z');
  assert.equal(parse('2026-09-28 23:55 UTC').dueAt, '2026-09-28T23:55:00.000Z');
  assert.equal(parse('28 September 2026 at 11:55 PM').dueAt, '2026-09-28T15:55:00.000Z');
  assert.equal(parse('9/28/2026 at 11:55 PM').dueAt, '2026-09-28T15:55:00.000Z');
  assert.equal(parse('28/9/2026 at 11:55 PM').dueAt, '2026-09-28T15:55:00.000Z');
  assert.equal(parse('9/10/2026 at 11:55 PM').dueAt, null);
  assert.equal(parse('2026-09-28 12:00:70').dueAt, null);
});

test('cross-year term range resolves January and validates the displayed weekday', () => {
  const context = { term: 'Semester 1 (current)', range: { start: '2026-09-02', end: '2027-01-20' } };
  assert.equal(parse('JAN 17 · Sunday at 9:15 AM', context).dueAt, '2027-01-17T01:15:00.000Z');
  assert.equal(parse('JAN 17 · Sunday at 9:15 AM', context).dueResolution, 'term');
  assert.equal(parse('JAN 17 · Monday at 9:15 AM', context).dueAt, null);
  assert.equal(parse('JAN 17 · Sunday at 9:15 AM').dueAt, null);
  assert.equal(parse('JAN 17 · Sunday at 9:15 AM', { term: '2026–27' }).dueAt, '2027-01-17T01:15:00.000Z');
});

test('missing clocks, impossible dates, unclear years and multiple deadlines are not invented', () => {
  for (const label of ['Deadline:', '2026-02-30 12:00', '2026-09-28', 'Jan 17 09:15', '2026-09-28 24:00', '2026-09-28 13:00 PM', '2026-09-28 10:00 PST', 'Class 3: Sep 28, 2026 10:00; Class 4: Sep 29, 2026 10:00']) assert.equal(parse(label).dueAt, null, label);
  assert.equal(MB.exactDate('2026-02-30T12:00:00Z'), null);
});

test('a split deadline heading captures its value without using an unrelated date', () => {
  const instructions = 'Read pages 28–30.\nHomework Deadline:\n2026-09-28 23:55';
  const dueLabel = Teams.deadlineLabel({ instructions, dueLabel: 'Deadline:' });
  assert.match(dueLabel, /2026-09-28 23:55/);
  assert.equal(parse(dueLabel).dueAt, '2026-09-28T15:55:00.000Z');
  assert.equal(Core.resolveTaskDeadline({requirements: instructions}).dueAt, '2026-09-28T15:55:00.000Z');
  assert.equal(Core.resolveTaskDeadline({requirements: 'We met on 2026-09-28 at 23:55.'}).dueAt, null);
});

test('explicit source dates take precedence and cached tasks use their own term', () => {
  assert.equal(Core.resolveTaskDeadline({ dueAt: '2026-10-01T00:00:00Z', dueLabel: '2026-09-28 23:55' }).dueAt, '2026-10-01T00:00:00Z');
  const state = Core.emptyState();
  state.settings.gpaTermDates = { 'semester 1': { start: '2026-09-02', end: '2027-01-20' } };
  state.snapshots.managebac.example = { capturedAt:'2026-09-26T00:00:00Z', courses:[{ name:'English', term:'Semester 1 (current)' }], tasks:[{id:'term-task',title:'Essay',course:'English',dueLabel:'JAN 17 · Sunday at 9:15 AM',status:'pending'}] };
  assert.equal(Core.getTasks(state)[0].dueAt, '2027-01-17T01:15:00.000Z');
  assert.equal(state.snapshots.managebac.example.tasks[0].dueAt, undefined);
});
