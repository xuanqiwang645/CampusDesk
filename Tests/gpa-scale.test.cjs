'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../Resources/core.js');

const expected = [
  [0, 'F', 0], [60, 'D−', 0.7], [63, 'D', 1], [67, 'D+', 1.3],
  [70, 'C−', 1.7], [73, 'C', 2], [77, 'C+', 2.3], [80, 'B−', 2.7],
  [83, 'B', 3], [87, 'B+', 3.3], [90, 'A−', 3.7], [93, 'A', 4]
];
test('all twelve GPA bands match the supplied scale, including fractional boundaries', () => {
  assert.deepEqual(Core.GPA_BANDS.slice().reverse().map(b => [b.minimum, b.letter, b.points]), expected);
  for (let i = 0; i < expected.length; i++) {
    const [lower, , points] = expected[i], upper = expected[i + 1]?.[0] ?? 100;
    assert.equal(Core.gradePoints(lower), points, `lower threshold ${lower}`);
    assert.equal(Core.gradePoints((lower + upper) / 2), points);
    assert.equal(Core.gradePoints(upper - 0.00001), points, 'fractional marks are not rounded up');
  }
  assert.equal(Core.gradePoints(100), 4);
  for (const invalid of [-1, 100.0001, NaN, Infinity, null, undefined, '', '93']) {
    assert.equal(Core.gradePoints(invalid), null);
  }
  assert.ok(Object.isFrozen(Core.GPA_BANDS) && Core.GPA_BANDS.every(Object.isFrozen));
});

test('every hundredth of a percent keeps the original linear formula', () => {
  for (let i = 0; i <= 10000; i++) {
    const percentage = i / 100;
    assert.equal(Core.linearGradePoints(percentage), percentage / 100 * 4);
  }
  const courses = expected.map(([percentage]) => ({ percentage }));
  assert.equal(Core.estimateGPA(courses).value, 2.14);
  assert.equal(Core.estimateLinearGPA(courses).value,
    courses.reduce((sum, course) => sum + course.percentage / 100 * 4, 0) / courses.length);
});

function history(overrides = {}) {
  return { capturedAt: '2026-09-18T08:00:00Z', date: '2026-09-18', count: 2, scale: 4,
    term: 'Fall', value: 3.5, linearValue: 3.5,
    method: '课程等权；90/80/70/60 分对应 4/3/2/1，低于 60 分为 0；非学校官方 GPA',
    signature: JSON.stringify([['math', 'Fall', 90], ['art', 'Fall', 85]]), ...overrides };
}
test('old banded history is recalculated from exact per-course evidence, with linear data untouched', () => {
  const state = Core.emptyState();
  state.gradeHistory = [history(), history({date:'2026-09-19', capturedAt:'2026-09-19T08:00:00Z'})];
  const original = JSON.stringify(state), restored = Core.validateState(state);
  assert.equal(JSON.stringify(state), original, 'does not mutate the loaded source');
  for (let i = 0; i < restored.gradeHistory.length; i++) {
    assert.equal(restored.gradeHistory[i].value, 3.35);
    assert.equal(restored.gradeHistory[i].method, Core.GPA_BANDED_METHOD);
    assert.equal(restored.gradeHistory[i].linearValue, state.gradeHistory[i].linearValue);
    assert.equal(restored.gradeHistory[i].signature, state.gradeHistory[i].signature);
  }
  assert.deepEqual(Core.validateState(restored), restored, 'migration is idempotent');
  assert.deepEqual(Core.importBackup(Core.exportBackup(restored)).state, restored);
});

test('incomplete old history is retained, never fabricated or labelled as the new algorithm', () => {
  const state = Core.emptyState();
  for (const signature of ['', 'invalid', 'null', '{}', '[]',
    JSON.stringify([['math', 'Fall', 90]]),
    JSON.stringify([['math', 'Fall', 90], ['math', 'Fall', 85]]),
    JSON.stringify([['math', 'Fall', 90], ['art', 'Other term', 85]]),
    JSON.stringify([['math', 'Fall', 90], ['art', 'Fall', 101]])]) {
    state.gradeHistory = [history({ signature, method: undefined })];
    const row = Core.validateState(state).gradeHistory[0];
    assert.equal(row.value, 3.5);
    assert.equal(row.linearValue, 3.5);
    assert.notEqual(row.method, Core.GPA_BANDED_METHOD);
  }
});
