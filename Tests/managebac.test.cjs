'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mb = require('../Resources/managebac.js');

// Synthetic DOM projection modeled on the visible ManageBac page structure.
// All course IDs, task IDs, titles, and scores below are fictional.
const fixture = {
  url:'https://beijing101.managebac.cn/student/classes/12345678/core_tasks',
  title:'Tasks', heading:'Biology (Grade 10) E106', hasPassword:false,
  term:'First Semester (current)',
  overallRows:[{label:'Overall',value:'B (88.50%)'}],
  links:[
    {url:'/student/classes/12345678/core_tasks',title:'Biology (Grade 10) E106'},
    {url:'/student/classes/87654321/core_tasks',title:'English (Grade 10)'},
    {url:'/student/classes/12345678/core_tasks/23456789',title:'Biology worksheet 2'},
    {url:'/student/classes/12345678/core_tasks/23456788',title:'Chapter quiz'},
    {url:'/student/classes/12345678/core_tasks/23456787',title:'Biology worksheet 1'}
  ],
  tasks:[
    {url:'/student/classes/12345678/core_tasks/23456789',title:'Biology worksheet 2',month:'Sep',day:'19',dueText:'Saturday at 8:00 PM',datetime:null,badge:'Pending',points:'',assessment:'Not Submitted',section:'Upcoming'},
    {url:'/student/classes/12345678/core_tasks/23456788',title:'Chapter quiz',month:'Sep',day:'16',dueText:'Wednesday at 9:25 AM',datetime:null,badge:'Pending',points:'17 / 20 pts',assessment:'B 17 / 20 pts',section:'Completed'},
    {url:'/student/classes/12345678/core_tasks/23456787',title:'Biology worksheet 1',month:'Sep',day:'10',dueText:'Thursday at 6:00 PM',datetime:null,badge:'Submitted',points:'30 / 30 pts',assessment:'A 30 / 30 pts',section:'Completed'}
  ], feedback:[],gpaRows:[]
};
const clone = () => JSON.parse(JSON.stringify(fixture));
const timestamp = '2026-09-18T12:00:00Z';
test('verified course fixture extracts overall without averaging individual task grades',()=>{
  const result = mb.fromProjection(fixture,timestamp);
  assert.equal(result.courses.length,1);
  assert.equal(result.courses[0].percentage,88.5);
  assert.equal(result.courses[0].isCourseGrade,true);
  assert.equal(result.courses[0].isCurrentTerm,true);
  assert.equal(result.officialGPA,null);
  assert.equal(result.tasks.length,3);
  assert.equal(result.tasks[0].status,'pending');
  assert.equal(result.tasks[1].status,'graded');
  assert.equal(result.tasks[2].status,'graded');
});
test('missing and category-only scores never become overall or GPA',()=>{
  const p=clone(); p.overallRows=[{label:'Homework (20%)',value:'A (100%)'},{label:'Overall',value:'-'}];
  const result=mb.fromProjection(p,timestamp);
  assert.equal(result.courses[0].percentage,null);
  assert.equal(result.courses[0].isCourseGrade,false);
  assert.equal(result.officialGPA,null);
  assert.equal(mb.overallPercentage('Overall','17 / 20 pts'),null);
  assert.equal(mb.overallPercentage('Overall','101%'),null);
  assert.equal(mb.overallPercentage('Overall','A (0.00%)'),0);
});
test('task detail with 100/100 does not overwrite course grade with 100',()=>{
  const p=clone(); p.url+='/'+'23456787'; p.overallRows=[];
  const result=mb.fromProjection(p,timestamp);
  assert.deepEqual(result.courses,[]);
  assert.equal(result.officialGPA,null);
});
test('exact detail URLs preserved, only approved read-only routes exposed',()=>{
  const p=clone(); p.links.push(
    {url:'#main-content',title:'Skip to Content'},
    {url:'#',title:'Log Out'},
    {url:'/student/classes/12345678/core_tasks/23456787/dropbox',title:'Upload Submission'},
    {url:'https://other.example/student/classes/123/core_tasks',title:'Other site'},
    {url:'/student/classes/12345678/core_tasks?token=SECRET',title:'Session link'},
    {url:'javascript:void(0)',title:'Create Discussion'}
  );
  const result=mb.fromProjection(p,timestamp);
  assert.equal(result.links.length,5);
  assert.equal(result.tasks[0].url,'https://beijing101.managebac.cn/student/classes/12345678/core_tasks/23456789');
  assert.equal(result.links.find(x=>x.url.endsWith('23456789')).kind,'feedback');
});
test('partial dates remain labels; UTC dates require explicit year and timezone',()=>{
  const result=mb.fromProjection(fixture,timestamp);
  assert.equal(result.tasks[0].dueAt,null);
  assert.equal(result.tasks[0].dueLabel,'Sep 19 · Saturday at 8:00 PM');
  assert.equal(mb.exactDate('2026-09-19T20:00:00+08:00'),'2026-09-19T12:00:00.000Z');
  assert.equal(mb.exactDate('2026-09-19T20:00:00'),null);
  assert.equal(mb.exactDate('Sep 19'),null);
});
test('sign-in pages short-circuit without stale school data',()=>{
  for(const patch of [{url:'https://beijing101.managebac.cn/login'},{hasPassword:true}]) {
    const result=mb.fromProjection(Object.assign(clone(),patch),timestamp);
    assert.equal(result.loginRequired,true);
    assert.deepEqual(result.courses,[]);
    assert.deepEqual(result.tasks,[]);
    assert.deepEqual(result.links,[]);
  }
});
test('historical term and missing term are explicitly not current',()=>{
  for(const term of ['Second Semester (2025)',null]) {
    const p=clone();p.term=term;
    assert.equal(mb.fromProjection(p,timestamp).courses[0].isCurrentTerm,false);
  }
});
test('Completed time section alone does not claim work was submitted',()=>{
  assert.equal(mb.taskStatus({section:'Completed',badge:'Pending',points:'',assessment:'Not Submitted'}),'pending');
  assert.equal(mb.taskStatus({section:'Completed',badge:'',points:'',assessment:'N/A'}),'unknown');
});
test('explicit feedback is exact, missing authors remain null',()=>{
  const p=clone(); p.url+='/23456787'; p.feedback=[{text:'Review your explanation.\nAdd evidence.',teacher:null,date:null}];
  const result=mb.fromProjection(p,timestamp);
  assert.equal(result.feedback[0].text,'Review your explanation.\nAdd evidence.');
  assert.equal(result.feedback[0].teacher,null);
});
test('official GPA is never inferred from percentage or unlabeled numeric values',()=>{
  const p=clone(); p.gpaRows=['3.9','GPA 3.9','Overall 92.50%'];
  assert.equal(mb.fromProjection(p,timestamp).officialGPA,null);
  p.gpaRows=['Cumulative GPA: 3.75 / 4.00'];
  assert.deepEqual(mb.fromProjection(p,timestamp).officialGPA,{value:3.75,scale:4,label:'Cumulative GPA'});
});
test('inconsistent overall blocks fail closed',()=>{
  const p=clone();p.overallRows.push({label:'Overall',value:'A (95%)'});
  assert.equal(mb.fromProjection(p,timestamp).courses[0].percentage,null);
});
test('incompletely loaded task page preserves previous cache through parseError',()=>{
  const p=clone();p.recognized=false;
  const result=mb.fromProjection(p,timestamp);
  assert.equal(result.parseError,true);
  assert.deepEqual(result.courses,[]);
  assert.deepEqual(result.tasks,[]);
});
