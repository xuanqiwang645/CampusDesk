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
  recognized: true, gradesCaptured: true,
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

test('Details category blocks accept whitespace layouts but require explicit section and headers', () => {
  for (const sep of [' ', '\n']) {
    const input=['Task Category Averages','Category (Weight)','Mark (Score)','Overall','A (94%)','Quiz (40%)','A (90%)','Project (60%)','-'].join(sep);
    assert.deepEqual(mb.categoryAveragesFromText(input).map(({name,weight,percentage})=>({name,weight,percentage})),[{name:'Quiz',weight:40,percentage:90},{name:'Project',weight:60,percentage:null}]);
  }
  assert.deepEqual(mb.categoryAveragesFromText('Quiz (40%) A (90%) Project (60%) -'),[]);
  assert.deepEqual(mb.categoryAveragesFromText('Task Category Averages\nCategory (Weight)\nMark (Score)\nOverall\n-\nQuiz (100%)\n-').map(({name,weight,percentage})=>({name,weight,percentage})),[{name:'Quiz',weight:100,percentage:null}]);
  assert.deepEqual(mb.categoryAveragesFromText('Task Category Averages Category (Weight) Mark (Score) Overall B (85%) Midterm (Group Research Project) (20%) - Final exam (80%) B (85%)').map(({name,weight,percentage})=>({name,weight,percentage})),[{name:'Midterm (Group Research Project)',weight:20,percentage:null},{name:'Final exam',weight:80,percentage:85}]);
  assert.deepEqual(mb.categoryAveragesFromText('任务类别平均成绩\n类别（权重）\n评分（得分）\n总评 B (86.88%)\n形成性评价 (20%) B (86.88%)\n总结性评价 (35%) -\n考试 (45%) -').map(({name,weight,percentage})=>({name,weight,percentage})),[
    {name:'形成性评价',weight:20,percentage:86.88},{name:'总结性评价',weight:35,percentage:null},{name:'考试',weight:45,percentage:null}
  ]);
});

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

test('unmarked term labels explain why the course is excluded from current-term GPA', () => {
  const page = clone(); page.term = 'Semester One';
  const result = mb.fromProjection(page, timestamp);
  assert.equal(result.courses[0].isCurrentTerm, false);
  assert.ok(result.warnings.some(value=>value.includes('暂不计入当前 GPA')));
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

test('assignment notifications preserve points separately from course averages and pending badges', () => {
  const result = mb.fromProjection(fixture, timestamp);
  assert.equal(result.gradesCaptured, true);
  assert.deepEqual(result.grades, [{id:'8102',assignmentId:'8102',courseId:'7001',term:'Practice Term 2032 (current)',
    title:'Invented sample analysis',course:'Synthetic Environmental Systems',url:HOME + COURSE + '/8102',
    score:17,maxScore:20,percentage:85,gradeLabel:null}]);
  assert.equal(result.courses[0].percentage,84.5);
  const detail = clone(); detail.url += '/8102';
  assert.deepEqual(mb.fromProjection(detail,timestamp).grades, result.grades);
});

test('assignment grades accept zero, explicit percentages and letters, never missing marks as zero', () => {
  assert.deepEqual(mb.assignmentGrade({points:'0 / 20'}),{score:0,maxScore:20,percentage:0,gradeLabel:null});
  assert.deepEqual(mb.assignmentGrade({points:'0%'}),{score:null,maxScore:null,percentage:0,gradeLabel:null});
  assert.deepEqual(mb.assignmentGrade({points:'',gradeText:'Grade: A− (91.5%)'}),{score:null,maxScore:null,percentage:91.5,gradeLabel:'A-'});
  assert.deepEqual(mb.assignmentGrade({gradeText:'B+'}),{score:null,maxScore:null,percentage:null,gradeLabel:'B+'});
  assert.deepEqual(mb.assignmentGrade({gradeText:'B+',percentageText:'88%'}),{score:null,maxScore:null,percentage:88,gradeLabel:'B+'});
  assert.deepEqual(mb.assignmentGrade({points:'21 / 20'}),{score:21,maxScore:20,percentage:null,gradeLabel:null});
  for (const points of ['',null,undefined,'—','Pending','Not assessed','0','6','0 / 0','-1 / 20','101%','8 / 10 9 / 10','A (93%','93%)']) {
    assert.equal(mb.assignmentGrade({points}),null,String(points));
  }
  assert.equal(mb.assignmentGrade({points:'',assessment:'Assignment instructions: achieve 90%',title:'Quiz 10 / 10'}),null);
  assert.equal(mb.taskStatus({gradeText:'B+',badge:'Not submitted'}),'graded');
  assert.equal(mb.taskStatus({points:'0%',badge:'Not submitted'}),'graded');
});

test('grade capture capability is explicit and unavailable pages cannot establish a baseline', () => {
  const empty = clone(); empty.tasks=[];
  assert.equal(mb.fromProjection(empty,timestamp).gradesCaptured,true);
  assert.deepEqual(mb.fromProjection(empty,timestamp).grades,[]);
  for (const patch of [{gradesCaptured:false},{gradesCaptured:undefined},{recognized:false},{hasPassword:true},
    {url:HOME+'/student/grades'},{url:HOME+'/login'}]) {
    assert.equal(mb.fromProjection(Object.assign(clone(),patch),timestamp).gradesCaptured,false,JSON.stringify(patch));
  }
});

test('grade rows reject unsafe URLs, foreign courses and conflicting duplicate scores', () => {
  const page=clone(), original=page.tasks[1];
  page.tasks.push({...original}, {...original,url:'https://outside.invalid'+COURSE+'/8104'},
    {...original,url:COURSE+'/8105?token=never-store'},
    {...original,url:'/student/classes/7002/core_tasks/8106'});
  assert.equal(mb.fromProjection(page,timestamp).grades.length,1);
  page.tasks.push({...original,points:'19 / 20'});
  const conflict=mb.fromProjection(page,timestamp);
  assert.deepEqual(conflict.grades,[]);
  assert.ok(conflict.warnings.some(value=>value.includes('不一致的成绩')));
});

test('only explicitly ungraded score blocks establish pending assignment evidence', () => {
  const page=clone(); page.tasks=[{...page.tasks[0],gradePending:true}];
  const result=mb.fromProjection(page,timestamp);
  assert.deepEqual(result.grades,[{id:'8101',assignmentId:'8101',courseId:'7001',term:'Practice Term 2032 (current)',title:'Invented ecosystem diagram',course:'Synthetic Environmental Systems',url:HOME+COURSE+'/8101',score:null,maxScore:null,percentage:null,gradeLabel:''}]);
  page.tasks[0].gradePending=false;
  assert.deepEqual(mb.fromProjection(page,timestamp).grades,[],'submission badge alone does not prove the task is ungraded');
});

test('rendered grade roster distinguishes pending, zero, hidden and loading marks', {skip:!process.env.PLAYWRIGHT_MODULE}, async () => {
  const fs=require('node:fs');
  const browser=await require(process.env.PLAYWRIGHT_MODULE).chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE || undefined});
  try {
    const page=await browser.newPage();
    const card=(id,title,score)=>`<div class="short-assignment"><div class="title"><a href="${COURSE}/${id}">${title}</a></div>${score}</div>`;
    await page.setContent(`<main><h1>Synthetic Environmental Systems</h1><h2>All Tasks</h2><select id="term"><option selected>Practice Term 2032 (current)</option></select>
      ${card('8101','Pending quiz','<div class="task-score">Pending</div>')}
      ${card('8102','Zero quiz','<div class="badge-label">Not submitted</div><div class="task-score"><span class="points">0 / 20</span></div>')}
      ${card('8103','Letter quiz','<div class="task-score"><span class="grade">A-</span> <span class="percentage">91%</span></div>')}
      ${card('8104','Hidden quiz','<div class="task-score" hidden><span class="points">20 / 20</span></div>')}
      <aside><div class="list-item"><strong>Overall</strong><span class="cell">Overall</span><span class="cell">94%</span></div></aside></main>`);
    await page.evaluate(fs.readFileSync(require.resolve('../Resources/managebac.js'),'utf8'));
    const read=()=>page.evaluate(url=>CampusManageBac.fromProjection(CampusManageBac.collect(document,url),'2032-04-08T01:00:00.000Z'),HOME+COURSE);
    const result=await read();
    assert.equal(result.gradesCaptured,true);
    assert.deepEqual(result.grades.map(row=>[row.id,row.score,row.maxScore,row.percentage,row.gradeLabel]),[['8101',null,null,null,''],['8102',0,20,0,null],['8103',null,null,91,'A-']]);
    assert.equal(result.courses[0].percentage,94);
    await page.locator('main').evaluate(node=>node.setAttribute('aria-busy','true'));
    assert.equal((await read()).gradesCaptured,false);
    await page.locator('main').evaluate(node=>{node.removeAttribute('aria-busy');node.querySelectorAll('.short-assignment').forEach(card=>card.remove());});
    assert.equal((await read()).gradesCaptured,false,'recognized heading alone may still be loading');
    await page.locator('main').evaluate(node=>node.insertAdjacentHTML('beforeend','<div class="empty-state">No tasks found</div>'));
    const empty=await read(); assert.equal(empty.gradesCaptured,true); assert.deepEqual(empty.grades,[]);
  } finally {await browser.close();}
});
