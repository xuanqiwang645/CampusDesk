'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../Resources/grade-planner.js');
const Core = require('../Resources/core.js');
const course = () => ({ id: 'sample', name: 'Synthetic course', term: 'Term 1 (current)', percentage: 86.88, isCurrentTerm: true,
  gradeComponents: [{name:'Formative Assessment',weight:20,percentage:86.88},{name:'Summative Assessment',weight:35,percentage:null},{name:'Exams',weight:45,percentage:null}] });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
test('actual 20/35/45 categories drive targets and forecast without term dates', () => {
  const c = course(), original = JSON.stringify(c), r = P.evaluate(c, {target:90});
  near(r.required, 90.78); near(r.projectedPercent, 86.88); assert.equal(r.adjustableWeight,80);
  near(P.aggregate([c], {}, Core.gradePoints).linearGPA, 3.4752);
  assert.equal(r.goalStatus,'possible'); assert.equal(JSON.stringify(c),original);
  const changed = P.evaluate(c,{target:90,overrides:[{name:'Summative Assessment',mode:'estimate',score:95},{name:'Exams',mode:'estimate',score:90}]});
  near(changed.projectedPercent,91.126);
});
test('graded categories can be estimated and are never assumed completed', () => {
  const r = P.evaluate(course(),{target:90,overrides:[{name:'Formative Assessment',mode:'estimate',score:90}]});
  near(r.required,90); assert.equal(r.adjustableWeight,100);
});
test('every course uses its own captured weights even with identical category names', () => {
  const a=course(), b={...course(),id:'other',gradeComponents:[{name:'Formative Assessment',weight:50,percentage:80},{name:'Summative Assessment',weight:20,percentage:null},{name:'Exams',weight:30,percentage:null}]};
  const plans={[P.key(a)]:{target:90,overrides:[{name:'Exams',mode:'estimate',score:99}]}};
  const report=P.aggregate([a,b],plans,Core.gradePoints);
  near(report.rows[0].required,90.78); near(report.rows[1].required,100);
  assert.equal(report.rows[1].components[2].score,80,'other course does not inherit the first course scenario');
});
test('unreachable, fixed, zero and missing scores remain explicit', () => {
  const c = course(); c.gradeComponents=[{name:'A',weight:90,percentage:0},{name:'B',weight:10,percentage:null}];
  const r=P.evaluate(c,{target:90}); assert.equal(r.goalStatus,'unreachable'); near(r.required,900); near(r.projectedPercent,0);
  c.gradeComponents=[{name:'A',weight:100,percentage:0}];
  assert.equal(P.evaluate(c,{target:90}).goalStatus,'fixed'); assert.equal(P.evaluate(c,{target:0}).goalStatus,'met');
  c.percentage=null; c.gradeComponents[0].percentage=null;
  assert.equal(P.evaluate(c).projectionReason,'missing-scores');
  near(P.evaluate(c,{overrides:[{name:'A',mode:'estimate',score:0}]}).projectedPercent,0);
});
test('invalid and incomplete category tables cannot produce GPA', () => {
  for (const rows of [[],[{name:'A',weight:80,percentage:90}],[{name:'A',weight:110,percentage:90}],[{name:'A',weight:50,percentage:90},{name:'a',weight:50,percentage:90}],[{name:'A',weight:100,percentage:101}]]) {
    assert.equal(P.evaluate({...course(),gradeComponents:rows}).projectedPercent,null);
  }
  assert.equal(P.evaluate(course(),{target:''}).goalReason,'invalid-target');
  const r=P.aggregate([course(),{...course(),id:'missing',gradeComponents:[]},{...course(),id:'old',isCurrentTerm:false}],{},Core.gradePoints);
  assert.equal(r.count,1); assert.equal(r.excluded,1); assert.equal(r.gpa,3);
});
test('paste parses real table layout, dashes and zero without using Overall as a category', () => {
  for (const separator of ['\n','\t']) {
    const rows=P.parseCategoryText('Task Category Averages\nCategory (Weight)\tMark (Score)\nOverall\tB (86.88%)\nFormative Assessment (20%)'+separator+'B (86.88%)\nSummative Assessment (35%)'+separator+'-\nExams (45%)'+separator+'-');
    assert.deepEqual(rows,course().gradeComponents);
  }
  assert.deepEqual(P.parseCategoryText('Zero (100%)\tF (0%)'),[{name:'Zero',weight:100,percentage:0}]);
  assert.deepEqual(P.parseCategoryText('unrelated assignment 9/10'),[]);
});
test('local plans round-trip through state validation and are isolated by course and term', () => {
  const c=course(), state=Core.emptyState(), plan={target:90,manual:true,categories:c.gradeComponents,overrides:[{name:'Exams',mode:'estimate',score:92}]};
  state.settings.gradePlans[P.key(c)]=plan;
  const restored=Core.validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored.settings.gradePlans[P.key(c)],plan);
  assert.notEqual(P.key(c),P.key({...c,term:'Term 2'}));
  assert.notEqual(P.key(c),P.key({...c,id:'another'}));
  state.settings.gradePlans[P.key(c)].overrides[0].score=101;
  assert.throws(()=>Core.validateState(state));
});

test('weighted boundaries and tolerated displayed weights remain consistent with rendered GPA', () => {
  for (const weights of [[21,52,27], [33.33,33.33,33.33], [33.335,33.335,33.335]]) {
    for (const score of [0,60,63,67,70,73,77,80,83,87,90,93,100]) {
      const c = {...course(), gradeComponents: weights.map((weight,i) => ({name:'Category '+i,weight,percentage:score}))};
      const result = P.evaluate(c);
      assert.equal(result.reason, null);
      assert.equal(result.projectedPercent, score, JSON.stringify({weights,score}));
      assert.equal(P.aggregate([c], {}, Core.gradePoints).gpa, Core.gradePoints(score));
      const planner = P.create({Core,getState:()=>Core.emptyState(),isEnglish:()=>false,esc:String,persist:()=>{},render:()=>{},openCourse:()=>{}});
      assert.doesNotThrow(() => planner.goal([c]));
      assert.doesNotThrow(() => planner.summary([c]));
    }
  }
  const nearBoundary = {...course(),gradeComponents:[{name:'A',weight:100,percentage:89.999}]};
  assert.equal(P.aggregate([nearBoundary], {}, Core.gradePoints).gpa, 3.3, 'a real sub-boundary mark is not rounded into the higher band');
  const c = {...course(),gradeComponents:[{name:'A',weight:50.0025,percentage:80},{name:'B',weight:50.0025,percentage:null}]};
  const result = P.evaluate(c, {target:90});
  near(result.heldPoints,40); near(result.adjustableWeight,50); near(result.required,100);
  assert.equal(P.evaluate({...c,gradeComponents:[{name:'A',weight:100,percentage:90},{name:'B',weight:0.02,percentage:90}]}).reason,'weight-total');
});

test('scenario GPA uses all 12 requested bands while linear projection stays exact', () => {
  const bands = [[93,4], [90,3.7], [87,3.3], [83,3], [80,2.7], [77,2.3], [73,2], [70,1.7], [67,1.3], [63,1], [60,0.7], [0,0]];
  const inputs = bands.flatMap(([minimum, points], index) => {
    const maximum = index ? bands[index - 1][0] - 0.001 : 100;
    return [[minimum, points], [maximum, points]];
  });
  for (const [percentage, expected] of inputs) {
    const item = {...course(), percentage, gradeComponents:[{name:'Overall category',weight:100,percentage}]};
    const result = P.aggregate([item], {}, Core.gradePoints);
    assert.equal(result.gpa, expected, String(percentage));
    near(result.linearGPA, percentage / 100 * 4);
  }
  const courses = [92.99, 87.5, 63.25].map((percentage, index) => ({...course(), id:String(index), percentage,
    gradeComponents:[{name:'A',weight:20,percentage},{name:'B',weight:35,percentage},{name:'C',weight:45,percentage}]}));
  const result = P.aggregate(courses, {}, Core.gradePoints);
  near(result.gpa, (3.7 + 3.3 + 1) / 3);
  near(result.linearGPA, (92.99 + 87.5 + 63.25) / 3 / 100 * 4);
  for (const english of [false, true]) {
    const planner = P.create({Core,getState:()=>Core.emptyState(),isEnglish:()=>english,esc:String,persist:()=>{},render:()=>{},openCourse:()=>{}});
    const summary = planner.summary(courses);
    assert.doesNotMatch(summary, /90\/80\/70\/60/);
    assert.match(summary, english ? /12 grades from A to F/ : /A 至 F 的 12 档标准/);
    assert.match(summary, /2\.67 \/ 4\.00/);
  }
});
