'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../Resources/core.js');
const NOW = '2026-09-20T04:00:00Z';
const LATER = '2026-09-20T04:15:00Z';
const URL = 'https://teams.microsoft.com/v2/';
const post = (id, changes = {}) => Object.assign({ id, title: id, text: 'Message body', url: URL, kind: 'general', attachments: [] }, changes);
const snapshot = (changes = {}) => Object.assign({ source: 'teams', url: URL, title: 'Class', capturedAt: NOW,
  coverage: 'browser', snapshotId: 'team-1/channel-1', accountId: 'student@example.test', warnings: [], tasks: [], posts: [], feedback: [], grades: [],
  coverageMetadata: { discovered: 5, read: 2, unread: 3, errors: 0, historyComplete: false, status: 'partial', reason: 'History not reached', warnings: ['Remaining channels'] } }, changes);
const only = state => Object.values(state.snapshots.teams)[0];
test('confirmed browser system records are removed only from their source and acknowledgements cease to be tasks', () => {
  const initial=snapshot({posts:[post('system'),post('ack',{kind:'assignment'})],tasks:[{id:'system',title:'Control record',url:URL},{id:'ack',title:'OK',url:URL}]});
  let state=Core.mergeSnapshot(Core.emptyState(),initial);
  state=Core.mergeSnapshot(state,snapshot({snapshotId:'other-channel',posts:[post('system')]}));
  state.manualTasks.push({id:'manual-test',title:'User note',course:'个人待办',dueAt:null,dueLabel:'',status:'open',createdAt:NOW});
  state=Core.mergeSnapshot(state,snapshot({capturedAt:LATER,posts:[post('ack',{kind:'general'})],browserExcludedIDs:['system']}));
  const current=Object.values(state.snapshots.teams).find(s=>s.snapshotId==='team-1/channel-1');
  assert.equal(current.tasks.length,0);assert.deepEqual(current.posts.map(p=>p.id),['teams:ack']);
  assert.equal(Object.values(state.snapshots.teams).find(s=>s.snapshotId==='other-channel').posts.length,1);
  assert.equal(state.manualTasks[0].title,'User note');
});

test('shared Teams root URL keeps channels separate by explicit identity across export/import', () => {
  let state = Core.mergeSnapshot(Core.emptyState(), snapshot({ posts: [post('channel-1:m1')] }));
  state = Core.mergeSnapshot(state, snapshot({ snapshotId: 'team-1/channel-2', posts: [post('channel-2:m1')] }));
  assert.equal(Object.keys(state.snapshots.teams).length, 2);
  assert(Object.values(state.snapshots.teams).every(row => row.url === URL));
  state = Core.validateState(JSON.stringify(state));
  assert.equal(Core.getTeamsPosts(state).length, 2);
  assert(Core.getTeamsPosts(state).every(row => row.sourceURL === URL));
  state = Core.mergeSnapshot(state, snapshot({ capturedAt: LATER, posts: [post('channel-1:m1', { text: 'Edited' }), post('channel-1:m2')] }));
  assert.equal(Core.getTeamsPosts(state).length, 3);
  assert.equal(Core.getTeamsPosts(state).find(row => row.id === 'teams:channel-1:m1').text, 'Edited');
});

test('browser source identity separates accounts and URL-keyed browser exports migrate without losing data', () => {
  const initial = snapshot({ posts: [post('m1')] });
  const state = Core.emptyState(); state.snapshots.teams[URL] = initial;
  const migrated = Core.validateState(state);
  assert.equal(Object.keys(migrated.snapshots.teams).length, 1);
  assert.equal(only(migrated).url, URL);
  const next = Core.mergeSnapshot(migrated, snapshot({ accountId: 'other@example.test', posts: [post('m2')] }));
  assert.equal(Object.keys(next.snapshots.teams).length, 2);
  const broken = JSON.parse(JSON.stringify(next));
  const key = Object.keys(broken.snapshots.teams)[0];
  broken.snapshots.teams['browser:forged'] = broken.snapshots.teams[key]; delete broken.snapshots.teams[key];
  assert.throws(() => Core.validateState(broken), /标识不匹配/);
});

test('Teams grades and feedback scores survive normalization without entering ManageBac GPA', () => {
  const state = Core.mergeSnapshot(Core.emptyState(), snapshot({
    grades: [{ id: 'score-1', assignmentId: 'a1', title: 'Essay', course: 'English', score: 0, maxScore: 20, gradeLabel: '', feedback: 'Revise paragraph 2', url: URL }],
    feedback: [{ id: 'feedback-1', assignmentId: 'a1', text: 'Revise paragraph 2', score: 0, maxScore: 20, url: URL }]
  }));
  const restored = Core.validateState(JSON.stringify(state));
  assert.equal(Core.getTeamsGrades(restored)[0].score, 0);
  assert.equal(Core.getTeamsGrades(restored)[0].maxScore, 20);
  assert.equal(Core.getTeamsGrades(restored)[0].feedback, 'Revise paragraph 2');
  assert.equal(Core.getFeedback(restored)[0].score, 0);
  assert.equal(Core.buildView(restored, NOW).teamsGrades.length, 1);
  assert.equal(Core.getCourses(restored).length, 0);
  assert.equal(Core.getOfficialGPA(restored), null);
  assert.deepEqual(restored.gradeHistory, []);
  assert.throws(() => Core.mergeSnapshot(restored, snapshot({ grades: [{ id: 'bad', score: Infinity }] })), /数字无效/);
});

test('grade-only snapshots and unreadable later attempts retain prior grades plus current coverage diagnostics', () => {
  const initial = snapshot({ grades: [{ id: 'g1', gradeLabel: 'A', rubric: 'Evidence: excellent', url: URL }] });
  let state = Core.mergeSnapshot(Core.emptyState(), initial);
  state = Core.mergeSnapshot(state, snapshot({ capturedAt: LATER, parseError: true, coverageMetadata: { errors: 1, status: 'error', historyComplete: true, reason: 'Page unavailable' } }));
  assert.equal(Core.getTeamsGrades(state).length, 1);
  assert.equal(only(state).lastAttemptFailed, true);
  assert.equal(only(state).coverageMetadata.errors, 1);
  assert.equal(only(state).coverageMetadata.historyComplete, false);
});

test('file cards retain inert bounded text and unread filenames; unsafe URLs never become links', () => {
  const files = [
    { title: 'roster.pdf', url: 'https://school.sharepoint.com/roster.pdf', text: 'Student A\nStudent B', mimeType: 'application/pdf', extractionStatus: 'read', capturedAt: NOW, truncated: false },
    { title: 'unopened.docx', extractionStatus: 'unread' },
    { title: 'unsafe.html', url: 'javascript:alert(1)', text: '<img src=x onerror=alert(1)>', html: '<script>run()</script>' }
  ];
  const state = Core.validateState(Core.mergeSnapshot(Core.emptyState(), snapshot({ posts: [post('m1', { attachments: files })] })));
  const saved = Core.getTeamsPosts(state)[0].attachments;
  assert.equal(saved.length, 3);
  assert.equal(saved[0].text, 'Student A\nStudent B');
  assert.equal(saved[0].extractionStatus, 'read');
  assert.equal(saved[1].url, ''); assert.equal(saved[1].extractionStatus, 'unread');
  assert.equal(saved[2].url, ''); assert.equal(saved[2].html, undefined);
  assert.throws(() => Core.mergeSnapshot(state, snapshot({ posts: [post('m2', { attachments: [{ title: 'too large', text: 'x'.repeat(80001) }] })] })), /文本字段过长/);
});

test('later partial browser captures retain extracted attachment content marked as cached', () => {
  let state = Core.mergeSnapshot(Core.emptyState(), snapshot({ posts: [post('m1', { attachments: [{ title: 'roster.pdf', text: 'Saved roster', extractionStatus: 'read', capturedAt: NOW }] })] }));
  state = Core.mergeSnapshot(state, snapshot({ capturedAt: LATER, posts: [post('m1', { attachments: [{ title: 'roster.pdf', extractionStatus: 'unread' }] })] }));
  const file = Core.getTeamsPosts(state)[0].attachments[0];
  assert.equal(file.text, 'Saved roster'); assert.equal(file.cached, true);
  assert.equal(file.extractionStatus, 'unread'); assert.equal(file.capturedAt, '2026-09-20T04:00:00.000Z');
});
test('attachment version and extraction coverage survive partial refresh without claiming roster semantics',()=>{
  const file={id:'f1',title:'Roster.pdf',text:'Header',versionKey:'v1:12345678',capturedAt:NOW,checkedAt:NOW,extractionStatus:'partial',truncated:false,textOnly:true,semanticVerified:false,extractionCoverage:'partial',warnings:['OCR needs review'],pagesTotal:1,pagesRead:1,ocrPages:1,
    pageCoverage:[{page:1,status:'partial',method:'pdf_text+ocr',visualContent:'detected',ocrStatus:'completed',characters:6,ocrMeanConfidence:0.5,ocrLowConfidenceLines:1}]};
  let state=Core.mergeSnapshot(Core.emptyState(),snapshot({posts:[post('m1',{attachments:[file]})]}));
  state=Core.mergeSnapshot(state,snapshot({capturedAt:LATER,posts:[post('m1',{attachments:[{id:'f1',title:'Roster.pdf',extractionStatus:'unread'}]})]}));
  const saved=Core.getTeamsPosts(Core.validateState(JSON.stringify(state)))[0].attachments[0];
  assert.equal(saved.versionKey,file.versionKey);assert.equal(saved.extractionCoverage,'partial');assert.equal(saved.cached,true);
  assert.equal(saved.semanticVerified,false);assert.equal(saved.pageCoverage[0].ocrMeanConfidence,0.5);
  assert.equal(saved.truncated,false);assert.deepEqual(saved.warnings,['OCR needs review']);
  for(const extra of [{semanticVerified:true},{versionKey:'https://secret.invalid/?token=x'},{pageCoverage:[{...file.pageCoverage[0],ocrMeanConfidence:4}]}]) {
    assert.throws(()=>Core.mergeSnapshot(Core.emptyState(),snapshot({posts:[post('m2',{attachments:[{...file,...extra}]})]})));
  }
});

test('new browser settings do not overwrite explicit Graph preference or unrelated saved data', () => {
  const state = Core.emptyState(); state.settings.teamsMode = 'graph'; state.settings.teamsAutoDiscover = false;
  state.taskChecks['old-task'] = true; state.feedbackRead['old-feedback'] = true;
  const result = Core.mergeSnapshot(state, snapshot());
  assert.equal(result.version, 1);
  assert.equal(result.settings.teamsMode, 'graph'); assert.equal(result.settings.teamsAutoDiscover, false);
  assert.equal(result.taskChecks['old-task'], true); assert.equal(result.feedbackRead['old-feedback'], true);
  assert.equal(Core.emptyState().settings.teamsMode, 'browser');
  assert.equal(Core.emptyState().settings.teamsAutoDiscover, true);
});

test('coverage counts are explicit and incomplete reads cannot claim complete history', () => {
  const state = Core.mergeSnapshot(Core.emptyState(), snapshot({ coverageMetadata: { discovered: 5, read: 2, unread: 3, errors: 0, historyComplete: true, attachmentsDiscovered: 4, attachmentsRead: 1 } }));
  assert.equal(only(state).coverageMetadata.historyComplete, false);
  assert.equal(only(state).coverageMetadata.attachmentsRead, 1);
  assert.throws(() => Core.mergeSnapshot(state, snapshot({ coverageMetadata: { read: -1 } })), /数字超出范围/);
  assert.throws(() => Core.mergeSnapshot(state, snapshot({ coverageMetadata: { errors: 1.5 } })), /整数/);
});
