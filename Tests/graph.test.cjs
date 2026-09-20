'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Graph = require('../Resources/graph.js');
const Core = require('../Resources/core.js');
const CAPTURE = '2026-09-19T15:00:00Z';
const later = '2026-09-19T15:30:00Z';
function message(id, changes = {}) {
  return Object.assign({ id, body: { contentType: 'html', content: '<p>Read the instructions.</p>' },
    createdDateTime: '2026-09-19T10:00:00Z', from: { user: { displayName: 'Fixture Teacher' } },
    webUrl: 'https://teams.microsoft.com/l/message/c/' + id }, changes);
}
function channel(changes = {}) {
  return Object.assign({ kind: 'channelMessages', capturedAt: CAPTURE, team: { id: 'team-1', displayName: 'Fixture class' },
    channel: { id: 'channel-1', displayName: 'General', webUrl: 'https://teams.microsoft.com/l/channel/channel-1/General' },
    messages: [message('m1')], complete: false }, changes);
}
function assignment(changes = {}) {
  return Object.assign({ kind: 'assignment', capturedAt: CAPTURE, userId: 'student-1', class: { id: 'class-1', displayName: 'Fixture English' },
    providedFields: ['instructions', 'resources', 'submissions'], assignment: { id: 'a1', displayName: 'Write a paragraph',
      dueDateTime: '2026-09-21T08:00:00.0000000Z', instructions: { contentType: 'html', content: '<p>Explain your claim.</p><p>Use two examples.</p>' },
      webUrl: 'https://teams.microsoft.com/l/entity/assignment/a1', resources: [{ resource: { displayName: 'Guide.pdf', fileUrl: 'https://school.sharepoint.com/documents/guide.pdf' } }],
      submissions: [{ id: 's1', recipient: { userId: 'student-1' }, status: 'working' }] } }, changes);
}
function apply(state, batch) {
  const normalized = Graph.normalizeBatch(batch);
  return normalized.snapshots.reduce((result, snapshot) => Core.mergeSnapshot(result, snapshot), state);
}

test('HTML is converted to inert plain text without DOM, script text or embedded image requests', () => {
  assert.equal(Graph.plainHTML('<p>Hello&nbsp;<at id="0">student</at> &amp; class</p><ul><li>One</li><li>Two</li></ul><script>secret()</script><style>body{}</style><img src="https://tracking.test/x">'), 'Hello student & class\n• One\n• Two');
  assert.equal(Graph.plainHTML('&lt;b&gt;literal&lt;/b&gt; &#x1F600; &#128512; &#0;'), '<b>literal</b> 😀 😀 �');
  assert.equal(Graph.bodyText({ contentType: 'text', content: '<keep> &amp;' }), '<keep> &amp;');
  assert.equal(Graph.plainHTML('Before<script>unterminated'), 'Before');
});

test('channel graph IDs include team and channel identity and preserve source links', () => {
  const a = Graph.normalizeBatch(channel()).snapshots[0];
  const b = Graph.normalizeBatch(channel({ channel: { id: 'channel-2', displayName: 'General' } })).snapshots[0];
  assert.notEqual(a.posts[0].id, b.posts[0].id);
  assert.match(a.posts[0].id, /^teams:graph:channel:/);
  assert.equal(a.posts[0].author, 'Fixture Teacher');
  assert.equal(a.posts[0].date, '2026-09-19T10:00:00.000Z');
  assert.equal(a.posts[0].url, 'https://teams.microsoft.com/l/message/c/m1');
  assert.equal(a.coverage, 'graph');
  assert.equal(a.graphComplete, false);
  assert.equal(Core.validateState(apply(Core.emptyState(), channel())).snapshots.teams[a.url].posts.length, 1);
});

test('channel replies have stable parent-scoped IDs across embedded and paginated responses', () => {
  const parent = message('m1', { replies: [message('r1', { replyToId: 'm1' })] });
  const embedded = Graph.normalizeBatch(channel({ messages: [parent] })).snapshots[0].posts;
  const paginated = Graph.normalizeBatch(channel({ rootMessageId: 'm1', messages: [message('r1', { replyToId: 'm1' })] })).snapshots[0].posts;
  assert.equal(embedded[1].id, paginated[0].id);
  assert.equal(embedded[1].replyToId, embedded[0].id);
  assert.match(embedded[1].title, /^回复/);
  const state = apply(apply(Core.emptyState(), channel({ messages: [parent] })), channel({ capturedAt: later, messages: [message('r1', { replyToId: 'm1' })] }));
  assert.equal(Core.getTeamsPosts(state).length, 2);
});

test('English Corner is classified from channel context even when body is only names', () => {
  const state = apply(Core.emptyState(), channel({ channel: { id: 'ec-1', displayName: 'ENGLISH CORNER ROSTER' }, messages: [message('roster', { body: { contentType: 'html', content: '<p>Fixture Student A</p><p>Fixture Student B</p>' } })] }));
  assert.equal(Core.getTeamsEC(state).length, 1);
  assert.equal(Core.getTeamsEC(state)[0].text, 'Fixture Student A\nFixture Student B');
  assert.equal(Graph.normalizeBatch(channel()).snapshots[0].posts[0].kind, 'general');
});

test('attachments are deduplicated, restricted to safe Microsoft links and never expose tokens', () => {
  const batch = channel({ messages: [message('files', { body: { contentType: 'html', content: '<a href="https://school.sharepoint.com/documents/a.pdf">A &amp; B</a><a href="javascript:alert(1)">bad</a><a href="https://outside.test/file">outside</a>' }, attachments: [
    { name: 'Same', contentUrl: 'https://school.sharepoint.com/documents/a.pdf' },
    { name: 'Token', contentUrl: 'https://school.sharepoint.com/file?access_token=secret' },
    { name: 'Lookalike', contentUrl: 'https://sharepoint.com.evil.test/file' },
    { name: 'Unsafe', contentUrl: 'file:///private/file' }
  ] })] });
  const files = Graph.normalizeBatch(batch).snapshots[0].posts[0].attachments;
  assert.deepEqual(files[0], { title: 'A & B', url: 'https://school.sharepoint.com/documents/a.pdf' });
  assert.equal(files.length, 4);
  assert(files.slice(1).every(file => file.url === 'https://teams.microsoft.com/l/message/c/files'));
  assert(!JSON.stringify(files).includes('secret'));
});

test('own assignment requirements, seven-digit ISO dates and resources become task fields', () => {
  const state = apply(Core.emptyState(), assignment());
  const task = Core.getTasks(state)[0];
  assert.equal(task.source, 'teams');
  assert.equal(task.requirements, 'Explain your claim.\nUse two examples.');
  assert.equal(task.dueAt, '2026-09-21T08:00:00.000Z');
  assert.equal(task.attachments[0].title, 'Guide.pdf');
  assert.equal(task.completed, false);
  assert.equal(Core.getOfficialGPA(state), null);
  assert.equal(Core.getCourses(state).length, 0);
});

test('assignment state uses only the current student submission and handles returned/reassigned/excused', () => {
  const base = assignment();
  base.assignment.submissions.push({ id: 'foreign', recipient: { userId: 'other-student' }, status: 'submitted', lastModifiedDateTime: '2027-01-01T00:00:00Z' });
  assert.equal(Core.getTasks(apply(Core.emptyState(), base))[0].completed, false);
  for (const status of ['submitted', 'returned', 'excused', 'reassigned', 'working']) {
    base.assignment.submissions[0].status = status;
    const task = Core.getTasks(apply(Core.emptyState(), base))[0];
    assert.equal(task.completed, ['submitted', 'returned', 'excused'].includes(status));
    assert.equal(task.submissionStatus, status);
  }
});

test('published own-submission feedback and points are preserved separately from GPA', () => {
  const batch = assignment();
  batch.assignment.grading = { maxPoints: 100 };
  batch.assignment.submissions[0].outcomes = [
    { id: 'draft', points: { points: 55 }, feedback: { text: { contentType: 'text', content: 'Unpublished fixture feedback' } } },
    { id: 'published', publishedFeedback: { feedbackBy: { user: { displayName: 'Fixture Teacher' } }, feedbackDateTime: CAPTURE, text: { contentType: 'html', content: '<p>Support the second claim.</p>' } } },
    { id: 'points', publishedPoints: { points: 97 } }
  ];
  batch.assignment.submissions.push({ id: 'other', recipient: { userId: 'someone-else' }, outcomes: [{ id: 'foreign-feedback', publishedFeedback: { text: { contentType: 'text', content: 'Someone else feedback' } } }] });
  const state = apply(Core.emptyState(), batch), feedback = Core.getFeedback(state);
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0].text, 'Support the second claim.');
  assert.equal(feedback[0].source, 'teams');
  assert.equal(feedback[0].teacher, 'Fixture Teacher');
  assert.equal(feedback[0].date, '2026-09-19T15:00:00.000Z');
  const grades = Core.getTeamsGrades(state);
  assert.equal(grades.length, 1);
  assert.equal(grades[0].score, 97);
  assert.equal(grades[0].maxScore, 100);
  assert.equal(grades[0].feedback, 'Support the second claim.');
  assert.equal(grades[0].title, 'Write a paragraph');
  assert.equal(Core.getCourses(state).length, 0);
  assert.equal(Core.getOfficialGPA(state), null);
  assert.equal(state.gradeHistory.length, 0);
});

test('published zero is a valid grade, unknown maximum stays unknown and malformed grades are not guessed', () => {
  const batch = assignment();
  batch.assignment.submissions[0].outcomes = [
    { id: 'zero', publishedPoints: { points: 0, gradedDateTime: CAPTURE, gradedBy: { user: { displayName: 'Teacher' } } } },
    { id: 'text-score', publishedPoints: { points: 'A' } }
  ];
  const normalized = Graph.normalizeBatch(batch), grade = normalized.snapshots[0].grades[0];
  assert.equal(normalized.snapshots[0].grades.length, 1);
  assert.equal(grade.score, 0);
  assert.equal(grade.maxScore, null);
  assert.equal(grade.teacher, 'Teacher');
  assert.equal(grade.date, '2026-09-19T15:00:00.000Z');
  assert(normalized.warnings.some(warning => warning.includes('成绩格式')));
});

test('failed optional enrichments preserve cached requirements, resources and completion', () => {
  const initial = assignment();
  initial.assignment.submissions[0].status = 'submitted';
  let state = apply(Core.emptyState(), initial);
  const partial = assignment({ capturedAt: later, providedFields: [], assignment: { id: 'a1', displayName: 'Edited title', dueDateTime: '2026-09-22T08:00:00Z' } });
  state = apply(state, partial);
  const task = Core.getTasks(state)[0];
  assert.equal(task.title, 'Edited title');
  assert.equal(task.completed, true);
  assert.equal(task.requirements, 'Explain your claim.\nUse two examples.');
  assert.equal(task.attachments.length, 1);
  assert.equal(task.dueAt, '2026-09-22T08:00:00.000Z');
});

test('explicitly empty successful resource/submission reads clear old attachment and completion state', () => {
  const initial = assignment(); initial.assignment.submissions[0].status = 'submitted';
  const next = assignment({ capturedAt: later }); next.assignment.resources = []; next.assignment.submissions = [];
  const task = Core.getTasks(apply(apply(Core.emptyState(), initial), next))[0];
  assert.equal(task.completed, false);
  assert.equal(task.attachments.length, 0);
});

test('assignment pages group by class and never overwrite another assignment', () => {
  const a = assignment(), b = assignment({ capturedAt: later });
  b.assignment.id = 'a2'; b.assignment.displayName = 'Second assignment';
  const state = apply(apply(Core.emptyState(), a), b);
  assert.equal(Object.keys(state.snapshots.teams).length, 1);
  assert.equal(Core.getTasks(state).length, 2);
});

test('ambiguous or invalid Graph dates do not create guessed reminders', () => {
  for (const due of ['2026-09-21T08:00:00', '2026-02-30T08:00:00Z', '2026-09-21T25:00:00Z', 'tomorrow', '2026-09-21T08:00:00+15:00']) {
    const batch = assignment(); batch.assignment.dueDateTime = due;
    const result = Graph.normalizeBatch(batch);
    assert.equal(result.snapshots[0].tasks[0].dueAt, null);
    assert.match(result.warnings.join(' '), /截止时间/);
  }
});

test('Graph partial tombstones delete cached parents and their replies, but not other channels', () => {
  const initial = channel({ messages: [message('m1', { replies: [message('r1')] }), message('m2')] });
  let state = apply(Core.emptyState(), initial);
  state = apply(state, channel({ capturedAt: later, messages: [message('m1', { deletedDateTime: later })] }));
  assert.deepEqual(Core.getTeamsPosts(state).map(p => p.id), ['teams:graph:channel:team-1:channel-1:m2']);
});

test('confirmed complete Graph collection replaces absent rows; partial empty page preserves them', () => {
  const initial = apply(Core.emptyState(), channel());
  const partial = apply(initial, channel({ capturedAt: later, messages: [] }));
  assert.equal(Core.getTeamsPosts(partial).length, 1);
  const complete = apply(initial, channel({ capturedAt: later, messages: [], complete: true }));
  assert.equal(Core.getTeamsPosts(complete).length, 0);
});

test('deleted replies do not remove their parent or siblings', () => {
  let state = apply(Core.emptyState(), channel({ messages: [message('m1', { replies: [message('r1'), message('r2')] })] }));
  state = apply(state, channel({ capturedAt: later, rootMessageId: 'm1', messages: [message('r1', { deletedDateTime: later })] }));
  assert.equal(Core.getTeamsPosts(state).length, 2);
  assert(Core.getTeamsPosts(state).some(p => p.id.endsWith(':m1')));
  assert(Core.getTeamsPosts(state).some(p => p.id.endsWith(':reply:r2')));
});

test('chat pages have an independent namespace and preserve chat source context', () => {
  const batch = { kind: 'chatMessages', capturedAt: CAPTURE, chat: { id: 'chat-1', topic: 'Fixture study group' }, messages: [message('m1')] };
  const state = apply(apply(Core.emptyState(), channel()), batch);
  assert.equal(Core.getTeamsPosts(state).length, 2);
  assert(Core.getTeamsPosts(state).some(p => p.id === 'teams:graph:chat:chat-1:m1' && p.channel === 'Fixture study group'));
});

test('malformed batch metadata throws instead of acknowledging an unpersisted page', () => {
  assert.throws(() => Graph.normalizeBatch(channel({ capturedAt: 'today' })), /Graph/);
  assert.throws(() => Graph.normalizeBatch(channel({ team: {} })), /Graph/);
  assert.throws(() => Graph.normalizeBatch({ kind: 'unexpected', capturedAt: CAPTURE }), /Graph/);
});

test('graph migration preserves legacy browser setting and reset clears only Teams information', () => {
  let state = apply(Core.emptyState(), channel());
  state.manualTasks.push({ id: 'manual-1', title: 'Personal item', course: '个人待办', dueAt: null, dueLabel: '', status: 'open', url: '', createdAt: CAPTURE });
  state.taskChecks = { 'teams:graph:assignment:c:a': true, 'manual-1': true };
  state.feedbackRead = { 'teams:graph:feedback:f': true, 'mb-feedback': true };
  state.settings.teamsDueOverrides = { 'teams:graph:assignment:c:a': '2026-09-22T00:00:00Z' };
  state.settings.teamsBrowserAutomation = true;
  delete state.settings.teamsMode; delete state.settings.graphIncludeChats;
  state = Core.validateState(state);
  assert.equal(state.settings.teamsMode, 'browser'); assert.equal(state.settings.graphIncludeChats, true);
  assert.equal(state.settings.teamsBrowserAutomation, true);
  const reset = Core.resetTeamsData(state);
  assert.equal(Core.getTeamsPosts(reset).length, 0);
  assert.deepEqual(reset.taskChecks, { 'manual-1': true });
  assert.deepEqual(reset.feedbackRead, { 'mb-feedback': true });
  assert.deepEqual(reset.settings.teamsDueOverrides, {});
  assert.equal(reset.manualTasks.length, 1);
  assert.equal(Core.getTeamsPosts(state).length, 1);
});

test('oversized Graph collections/text report explicit gaps instead of claiming complete coverage', () => {
  const batch = channel({ complete: true, messages: Array.from({ length: 3001 }, (_, i) => message(String(i))) });
  const result = Graph.normalizeBatch(batch);
  assert.equal(result.snapshots[0].posts.length, 3000);
  assert.equal(result.snapshots[0].graphComplete, false);
  assert.equal(result.coverage.capped, true);
  assert.match(result.warnings.join(' '), /3000/);
  const textResult = Graph.normalizeBatch(channel({ complete: true, messages: [message('long', { subject: 'Long fixture', body: { contentType: 'text', content: 'x'.repeat(30001) } })] }));
  assert.equal(textResult.coverage.capped, true);
  assert.equal(textResult.snapshots[0].posts[0].text.length, 30000);
});

test('streamed Graph history keeps newest messages at the cache limit and reports the gap', () => {
  const newest = Array.from({ length: 3000 }, (_, i) => message('new' + i, { createdDateTime: '2026-09-19T10:00:00Z' }));
  let state = apply(Core.emptyState(), channel({ messages: newest }));
  state = apply(state, channel({ capturedAt: later, messages: [message('old', { createdDateTime: '2025-01-01T00:00:00Z' })] }));
  const posts = Core.getTeamsPosts(state);
  assert.equal(posts.length, 3000);
  assert.equal(posts.some(p => p.id.endsWith(':old')), false);
  assert.match(Core.getSourceStatus(state, 'teams').warnings.join(' '), /3000/);
});
