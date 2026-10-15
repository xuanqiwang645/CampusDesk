'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../Resources/core.js');
const HOST = 'https://grade-fixture.managebac.cn';
Core.configureSchools({ managebac: HOST + '/' });
const at = hour => `2032-04-08T${String(hour).padStart(2, '0')}:00:00.000Z`;
const course = (percentage = 90, extra = {}) => ({ id: 'math', name: 'Math', percentage, term: 'Term 1 (current)', isCurrentTerm: true, isCourseGrade: true, ...extra });
const grade = (score = 18, extra = {}) => ({ id: 'task-10', assignmentId: '10', courseId: 'math', course: 'Math', term: 'Term 1', title: 'Synthetic quiz',
  score, maxScore: 20, percentage: score === null ? null : score * 5, gradeLabel: '', url: HOST + '/student/classes/math/core_tasks/10', ...extra });
const snapshot = (hour = 1, extra = {}) => ({ source: 'managebac', url: HOST + '/student/classes/math/core_tasks', capturedAt: at(hour), success: true,
  warnings: [], courses: [course()], tasks: [], feedback: [], gradesCaptured: true, grades: [grade()], ...extra });
const merge = (state, hour, extra = {}) => Core.mergeSnapshot(state, snapshot(hour, extra));
const baseline = () => merge(Core.emptyState(), 1);

test('first recognized capture quietly establishes baselines and old backups default safely', () => {
  const old = Core.emptyState();
  for (const key of ['gradeUpdates', 'gradeUpdateRead', 'gradeUpdateBaselines', 'gradeUpdateCaptures']) delete old[key];
  const state = merge(old, 1);
  assert.deepEqual(Core.getGradeUpdates(state), []);
  assert.equal(state.gradeUpdateBaselines.length, 1);
  assert.deepEqual(Core.validateState(state), state);
});

test('new grade includes subject and observed course plus both GPA changes without changing formulas', () => {
  let state = baseline();
  state = merge(state, 2, { courses: [course(95)], grades: [grade(), grade(20, { id: 'task-11', assignmentId: '11', title: 'New quiz' })] });
  const [update] = Core.getGradeUpdates(state);
  assert.equal(update.kind, 'new'); assert.equal(update.course, 'Math'); assert.equal(update.read, false);
  assert.equal(update.before, null); assert.equal(update.after.score, 20);
  assert.deepEqual(update.impact, { courseBefore: 90, courseAfter: 95, bandedBefore: 3.7, bandedAfter: 4, linearBefore: 3.6, linearAfter: 3.8, comparable: true });
  assert.equal(Core.estimateGPA(Core.getCourses(state)).value, 4);
  assert.equal(Core.estimateLinearGPA(Core.getCourses(state)).value, 3.8);
});

test('updated grade preserves before/after and repeated captures do not duplicate', () => {
  let state = merge(baseline(), 2, { grades: [grade(19)] });
  const [update] = Core.getGradeUpdates(state);
  assert.equal(update.kind, 'updated'); assert.equal(update.before.score, 18); assert.equal(update.after.score, 19);
  state = merge(state, 2, { grades: [grade(19)] });
  state = merge(state, 3, { grades: [grade(19)] });
  assert.equal(state.gradeUpdates.length, 1);
});

test('zero is an explicit grade, missing or withdrawn grades never become zero', () => {
  let state = merge(Core.emptyState(), 1, { grades: [] });
  state = merge(state, 2, { grades: [grade(0)] });
  assert.equal(state.gradeUpdates[0].after.score, 0);
  state = merge(state, 3, { grades: [grade(null, { maxScore: null })] });
  state = merge(state, 4, { grades: [] });
  state = merge(state, 5, { grades: [grade(0)] });
  assert.equal(state.gradeUpdates.length, 1);
});

test('newly visited detail and paginated pages do not flood historical marks', () => {
  let state = baseline();
  state = merge(state, 2, { url: HOST + '/student/classes/math/core_tasks?page=2', grades: [grade(16, { id: 'task-12', assignmentId: '12' })] });
  assert.equal(state.gradeUpdates.length, 0);
  state = merge(state, 3, { url: grade().url, grades: [grade(19)] });
  assert.equal(state.gradeUpdates.length, 1);
  state = merge(state, 4, { grades: [grade(19)] });
  assert.equal(state.gradeUpdates.length, 1);
});

test('new term and newly observed course quietly establish separate baselines', () => {
  let state = baseline();
  state = merge(state, 2, { courses: [course(85, { term: 'Term 2 (current)' })], grades: [grade(17, { term: 'Term 2' })] });
  state = merge(state, 3, { courses: [course(92, { id: 'art', name: 'Art' })], grades: [grade(19, { courseId: 'art', course: 'Art' })] });
  assert.equal(state.gradeUpdates.length, 0);
  assert.equal(state.gradeUpdateBaselines.length, 3);
});

test('failed logged-out and stale captures preserve grade baseline without notifications', () => {
  let state = baseline();
  state = merge(state, 2, { success: false, grades: [grade(1)] });
  state = merge(state, 3, { loginRequired: true, grades: [grade(2)] });
  state = merge(state, 4, { parseError: true, grades: [grade(3)] });
  state = merge(state, 5, { grades: [grade(19)] });
  state = merge(state, 3, { url: grade().url, grades: [grade(4)] });
  assert.equal(state.gradeUpdates.length, 1);
  assert.equal(state.gradeUpdateBaselines[0].score, 19);
});

test('same-timestamp cross-page conflicts cannot overwrite an existing score', () => {
  const state = merge(baseline(), 1, { url: grade().url, grades: [grade(10)] });
  assert.equal(state.gradeUpdates.length, 0);
  assert.equal(state.gradeUpdateBaselines[0].score, 18);
});

test('grade-only page cannot falsely report cached course totals as impact', () => {
  const state = merge(baseline(), 2, { courses: [], grades: [grade(19)] });
  assert.equal(state.gradeUpdates.length, 1);
  assert.equal(state.gradeUpdates[0].impact.comparable, false);
  assert.equal(state.gradeUpdates[0].impact.courseAfter, null);
});

test('out-of-order grade page never uses newer cached course total as its before/after impact', () => {
  let state = merge(baseline(), 4, { url: HOST + '/student/academics', courses: [course(95)], gradesCaptured: false, grades: [] });
  state = merge(state, 3, { courses: [course(95)], grades: [grade(19)] });
  assert.equal(state.gradeUpdates.length, 1);
  assert.equal(state.gradeUpdates[0].impact.comparable, false);
});

test('eligibility or cohort changes prevent misleading aggregate impact', () => {
  for (const courses of [[course(95), course(80, { id: 'art', name: 'Art' })], [course(95, { gpaEligible: false })]]) {
    const state = merge(baseline(), 2, { courses, grades: [grade(19)] });
    assert.equal(state.gradeUpdates[0].impact.comparable, false);
    assert.equal(state.gradeUpdates[0].impact.bandedAfter, null);
  }
});

test('numeric grade rendering changes do not create duplicate grade updates', () => {
  let state = merge(baseline(), 2, { grades: [grade(18, { gradeLabel: 'A−' })] });
  state = merge(state, 3, { grades: [grade(null, { maxScore: null, percentage: 90, gradeLabel: 'A-' })] });
  assert.equal(state.gradeUpdates.length, 0);
  state = merge(Core.emptyState(), 1, { grades: [grade(17, { maxScore: 30, percentage: null })] });
  state = merge(state, 2, { grades: [grade(17, { maxScore: 30, percentage: 56.67, gradeLabel: 'F' })] });
  assert.equal(state.gradeUpdates.length, 0);
  state = merge(state, 3, { grades: [grade(null, { maxScore: null, percentage: 56.67 })] });
  assert.equal(state.gradeUpdates.length, 0);
  assert.equal(state.gradeUpdateBaselines[0].score, 17);
  assert.equal(state.gradeUpdateBaselines[0].maxScore, 30);
});

test('incomparable letter-only view does not fabricate an update or erase point evidence', () => {
  let state = merge(Core.emptyState(), 1, { grades: [grade(17, { maxScore: 30, percentage: 56.6667 })] });
  state = merge(state, 2, { grades: [grade(null, { maxScore: null, gradeLabel: 'F' })] });
  assert.equal(state.gradeUpdates.length, 0);
  assert.equal(state.gradeUpdateBaselines[0].score, 17);
  assert.equal(state.gradeUpdateBaselines[0].maxScore, 30);
  assert.equal(state.gradeUpdateBaselines[0].gradeLabel, 'F');
  state = merge(state, 3, { grades: [grade(null, { maxScore: null, gradeLabel: 'D' })] });
  assert.equal(state.gradeUpdates.length, 1);
});

test('real fractional changes to percentage-only grades remain visible', () => {
  let state = merge(Core.emptyState(), 1, { grades: [grade(null, { maxScore: null, percentage: 90 })] });
  state = merge(state, 2, { grades: [grade(null, { maxScore: null, percentage: 90.4 })] });
  assert.equal(state.gradeUpdates.length, 1);
  assert.equal(state.gradeUpdates[0].after.percentage, 90.4);
});

test('explicit changed letters still notify even when displayed point pair is unchanged', () => {
  let state = merge(Core.emptyState(), 1, { grades: [grade(18, { gradeLabel: 'A−' })] });
  state = merge(state, 2, { grades: [grade(18, { gradeLabel: 'B+' })] });
  assert.equal(state.gradeUpdates.length, 1);
  assert.equal(state.gradeUpdates[0].before.gradeLabel, 'A−');
  assert.equal(state.gradeUpdates[0].after.gradeLabel, 'B+');
});

test('an explicitly pending assignment graded on its first detail visit notifies exactly once', () => {
  let state = merge(Core.emptyState(), 1, { grades: [grade(null, { maxScore: null })] });
  state = merge(state, 2, { url: grade().url, grades: [grade(19)] });
  assert.equal(state.gradeUpdates.length, 1);
  assert.equal(state.gradeUpdates[0].kind, 'new');
  state = merge(state, 3, { grades: [grade(19)] });
  assert.equal(state.gradeUpdates.length, 1);
});

test('letter-only grades are supported without inventing percentage or course impact', () => {
  let state = merge(Core.emptyState(), 1, { grades: [grade(null, { maxScore: null, gradeLabel: 'B' })] });
  state = merge(state, 2, { courses: [], grades: [grade(null, { maxScore: null, gradeLabel: 'A−' })] });
  assert.equal(state.gradeUpdates[0].after.gradeLabel, 'A−');
  assert.equal(state.gradeUpdates[0].after.percentage, null);
  assert.equal(state.gradeUpdates[0].impact.comparable, false);
});

test('read states persist through export/import and marking is immutable', () => {
  const before = merge(baseline(), 2, { grades: [grade(19)] });
  const state = Core.markGradeUpdatesRead(before, [before.gradeUpdates[0].id]);
  assert.equal(Core.getGradeUpdates(before)[0].read, false);
  assert.equal(Core.getGradeUpdates(state)[0].read, true);
  const restored = Core.importBackup(Core.exportBackup(state)).state;
  assert.equal(Core.getGradeUpdates(restored)[0].read, true);
  const newer = merge(restored, 3, { grades: [grade(20)] });
  assert.deepEqual(Core.getGradeUpdates(newer).map(row => row.read), [false, true]);
  assert.ok(Core.getGradeUpdates(Core.markGradeUpdatesRead(newer)).every(row => row.read));
});

test('notification URLs and score types follow strict source validation', () => {
  assert.throws(() => merge(baseline(), 2, { grades: [grade(19, { url: 'javascript:alert(1)' })] }), /HTTPS/);
  assert.throws(() => merge(baseline(), 2, { grades: [grade('', { percentage: null })] }), /数字/);
  assert.throws(() => merge(baseline(), 2, { grades: [grade(-1)] }), /数字/);
  assert.throws(() => merge(baseline(), 2, { gradesCaptured: 'true' }), /布尔/);
});

test('notifications and read flags are pruned together at 200 records', () => {
  let state = baseline();
  const prototype = merge(state, 2, { grades: [grade(19)] }).gradeUpdates[0];
  state.gradeUpdates = Array.from({ length: 200 }, (_, index) => ({ ...prototype, id: 'fixture-' + index }));
  state.gradeUpdateRead = Object.fromEntries(state.gradeUpdates.map(row => [row.id, true]));
  state = merge(state, 3, { grades: [grade(20)] });
  assert.equal(state.gradeUpdates.length, 200);
  assert.equal(Object.keys(state.gradeUpdateRead).length, 199);
  assert.equal(Core.getGradeUpdates(state)[0].read, false);
});

test('non-grade-capable legacy snapshots do not initialize or notify', () => {
  const state = merge(Core.emptyState(), 1, { gradesCaptured: false });
  assert.equal(state.gradeUpdateBaselines.length, 0);
  assert.equal(state.gradeUpdates.length, 0);
});
