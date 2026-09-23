'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mb = require('../Resources/managebac.js');

// Entirely synthetic DOM projection. IDs, names, grades, dates, and feedback
// below are invented test data, not copied from any student or school account.
const HOME = 'https://example-school.managebac.cn';
const COURSE = '/student/classes/7001/core_tasks';
const fixture = {
  url: HOME + COURSE,
  title: 'Synthetic Lab Tasks', heading: 'Synthetic Environmental Systems', hasPassword: false,
  term: 'Practice Term 2032 (current)',
  overallRows: [{ label: 'Overall', value: '84.5%' }],
  links: [
    { url: COURSE, title: 'Synthetic Environmental Systems' },
    { url: '/student/classes/7002/core_tasks', title: 'Synthetic Creative Computing' },
    { url: '/student/classes/7003/core_tasks', title: 'Synthetic World Literature' },
    { url: '/student/grades', title: 'Example grade report' },
    { url: COURSE + '/8101', title: 'Invented ecosystem diagram' }
  ],
  tasks: [
    { url: COURSE + '/8101', title: 'Invented ecosystem diagram', month: 'Apr', day: '09', dueText: 'Due at 10:30', datetime: null, badge: 'Not submitted', points: '', assessment: 'Pending', section: 'Upcoming' },
    { url: COURSE + '/8102', title: 'Invented sample analysis', month: 'Apr', day: '07', dueText: 'Due at 15:00', datetime: null, badge: 'Not submitted', points: '17 / 20', assessment: 'Assessed', section: 'Past' },
    { url: COURSE + '/8103', title: 'Invented field journal', month: 'Apr', day: '06', dueText: 'Due at 08:45', datetime: null, badge: 'Submitted', points: '', assessment: '', section: 'Past' }
  ],
  feedback: [], gpaRows: []
};
const clone = () => JSON.parse(JSON.stringify(fixture));
const timestamp = '2032-04-08T01:00:00.000Z';

test('synthetic overall grade and task statuses use their own explicit fields', () => {
  const result = mb.fromProjection(fixture, timestamp);
  assert.equal(result.courses.length, 1);
  assert.equal(result.courses[0].id, '7001');
  assert.equal(result.courses[0].name, 'Synthetic Environmental Systems');
  assert.equal(result.courses[0].percentage, 84.5);
  assert.equal(result.courses[0].isCourseGrade, true);
  assert.equal(result.courses[0].isCurrentTerm, true);
  assert.equal(result.officialGPA, null);
  assert.deepEqual(result.tasks.map(row => row.id), ['8101', '8102', '8103']);
  assert.deepEqual(result.tasks.map(row => row.status), ['pending', 'graded', 'submitted']);
});

test('a synthetic zero overall remains a real course grade', () => {
  const page = clone(); page.overallRows = [{ label: 'Overall', value: '0%' }];
  const result = mb.fromProjection(page, timestamp);
  assert.equal(result.courses[0].percentage, 0);
  assert.equal(result.courses[0].isCourseGrade, true);
});

test('weighted grade components require an explicit weight and never infer an IB grade as a percent', () => {
  assert.equal(mb.isPercentageWeightHeader('Category weight (%)'), true);
  assert.equal(mb.isPercentageWeightHeader('Weight percentage'), true);
  assert.equal(mb.isPercentageWeightHeader('Weight'), false);
  assert.equal(mb.isPercentageWeightHeader('Absolute weighting'), false);
  assert.deepEqual(mb.parseGradeComponents([
    { name: 'Synthetic essays', weight: '40%', percentage: '18 / 20' },
    { name: 'Synthetic exams', weight: '60', percentage: '84.5%' },
    { name: 'Ungraded component', weight: '20%', percentage: '' },
    { name: 'IB criterion', weight: '10%', percentage: '6' },
    { name: 'No weight', percentage: '99%' }
  ]), [
    { id: 'component-0-Synthetic%20essays', name: 'Synthetic essays', percentage: 90, weight: 40 },
    { id: 'component-1-Synthetic%20exams', name: 'Synthetic exams', percentage: 84.5, weight: 60 },
    { id: 'component-2-Ungraded%20component', name: 'Ungraded component', percentage: null, weight: 20 },
    { id: 'component-3-IB%20criterion', name: 'IB criterion', percentage: null, weight: 10 }
  ]);
});

test('captured course components remain distinct from the course overall grade', () => {
  const page = clone(); page.gradeComponents = [{ name: 'Synthetic labs', percentage: 88, weight: 35 }];
  page.overallRows = [];
  const result = mb.fromProjection(page, timestamp);
  assert.equal(result.courses[0].percentage, null);
  assert.equal(result.courses[0].isCourseGrade, false);
  assert.deepEqual(result.courses[0].gradeComponents.map(({ name, percentage, weight }) => ({ name, percentage, weight })), [
    { name: 'Synthetic labs', percentage: 88, weight: 35 }
  ]);
});

test('assignment points and non-overall percentages never become course GPA', () => {
  const page = clone(); page.overallRows = [{ label: 'Practice quiz', value: '93%' }, { label: 'Points', value: '14 / 25' }];
  const result = mb.fromProjection(page, timestamp);
  assert.equal(result.courses[0].percentage, null);
  assert.equal(result.courses[0].isCourseGrade, false);
  assert.equal(result.officialGPA, null);
  assert.equal(mb.overallPercentage('Practice quiz', '93%'), null);
  assert.equal(mb.overallPercentage('Overall', '14 / 25'), null);
  assert.equal(mb.overallPercentage('Overall grade', '76.5%'), 76.5);
});

test('task detail does not manufacture a course-level grade', () => {
  const page = clone(); page.url += '/8102'; page.overallRows = [];
  const result = mb.fromProjection(page, timestamp);
  assert.deepEqual(result.courses, []);
  assert.equal(result.officialGPA, null);
});

test('discovery retains same-origin read-only class links and rejects actions or credentials', () => {
  const page = clone(); page.links.push(
    { url: COURSE + '#past', title: 'Anchor only' },
    { url: '/student/classes/7001/dropbox/9901', title: 'Upload action' },
    { url: COURSE + '/8101?token=synthetic-only', title: 'Signed example' },
    { url: 'https://outside.invalid/student/classes/7001/core_tasks', title: 'External example' },
    { url: '/student/logout', title: 'Logout action' },
    { url: 'mailto:example@example.invalid', title: 'Email example' }
  );
  const result = mb.fromProjection(page, timestamp);
  assert.equal(result.links.length, 7);
  assert.equal(result.tasks[0].url, HOME + COURSE + '/8101');
  assert.equal(result.links.find(row => row.url.endsWith('/student/grades')).kind, 'grades');
  assert.ok(result.links.every(row => row.url.startsWith(HOME + '/student/')));
});

test('synthetic partial deadlines stay labels, and only explicit zoned dates are accepted', () => {
  const result = mb.fromProjection(fixture, timestamp);
  assert.equal(result.tasks[0].dueAt, null);
  assert.equal(result.tasks[0].dueLabel, 'Apr 09 · Due at 10:30');
  assert.equal(mb.exactDate('2032-04-09T10:30:00+08:00'), '2032-04-09T02:30:00.000Z');
  assert.equal(mb.exactDate('Apr 09 10:30'), null);
  assert.equal(mb.exactDate('2032-04-09T10:30:00'), null);
});

test('login pages and password forms cannot expose stale academic data', () => {
  for (const patch of [{ url: HOME + '/login' }, { hasPassword: true }]) {
    const result = mb.fromProjection(Object.assign(clone(), patch), timestamp);
    assert.equal(result.loginRequired, true);
    assert.deepEqual(result.courses, []);
    assert.deepEqual(result.tasks, []);
    assert.deepEqual(result.links, []);
  }
});

test('historical and unknown terms cannot claim to be current', () => {
  for (const term of ['Practice Term 2031', null]) {
    const page = clone(); page.term = term;
    assert.equal(mb.fromProjection(page, timestamp).courses[0].isCurrentTerm, false);
  }
});

test('pending and upcoming tasks are not treated as submitted', () => {
  assert.equal(mb.taskStatus({ section: 'Upcoming', badge: 'Not submitted', points: '', assessment: 'Pending' }), 'pending');
  assert.equal(mb.taskStatus({ section: 'Upcoming', badge: '', points: '', assessment: '' }), 'upcoming');
});

test('invented feedback is preserved without inventing a teacher identity', () => {
  const page = clone(); page.url += '/8102';
  page.feedback = [{ text: 'Synthetic feedback: label the imaginary sample axes.', teacher: null, date: null }];
  const result = mb.fromProjection(page, timestamp);
  assert.equal(result.feedback[0].text, 'Synthetic feedback: label the imaginary sample axes.');
  assert.equal(result.feedback[0].teacher, null);
});

test('only explicitly labeled and scaled GPA is recognized', () => {
  const page = clone(); page.gpaRows = ['Practice quiz 4 / 4', 'GPA not available', 'Overall 88%'];
  assert.equal(mb.fromProjection(page, timestamp).officialGPA, null);
  page.gpaRows = ['Cumulative GPA: 3.2 / 4'];
  assert.deepEqual(mb.fromProjection(page, timestamp).officialGPA, { value: 3.2, scale: 4, label: 'Cumulative GPA' });
});

test('conflicting synthetic overall grades are excluded from GPA', () => {
  const page = clone(); page.overallRows.push({ label: 'Overall', value: '79.25%' });
  assert.equal(mb.fromProjection(page, timestamp).courses[0].percentage, null);
});

test('an unrecognized task layout is an error rather than an empty success', () => {
  const page = clone(); page.recognized = false;
  const result = mb.fromProjection(page, timestamp);
  assert.equal(result.parseError, true);
  assert.deepEqual(result.courses, []);
  assert.deepEqual(result.tasks, []);
});
