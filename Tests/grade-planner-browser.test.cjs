'use strict';
// Isolated synthetic browser fixture; no school accounts or user browser data.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const Core = require('../Resources/core.js');
const P = require('../Resources/grade-planner.js');
const optional = { skip: !process.env.PLAYWRIGHT_MODULE };
const launch = () => require(process.env.PLAYWRIGHT_MODULE).chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE || undefined});
test('category plans support typing, background refresh, save, reload, import, English and narrow layouts', optional, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({viewport:{width:1280,height:1000}}), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const state=Core.emptyState(); state.settings.language='en-US';
    const url='https://example-school.managebac.cn/student/classes/7001/core_tasks';
    const c={id:'7001',name:'Synthetic English',percentage:86.88,term:'Term 1 (current)',isCurrentTerm:true,isCourseGrade:true,url,
      gradeComponents:[{id:'a',name:'Formative Assessment',weight:20,percentage:86.88},{id:'b',name:'Summative Assessment',weight:35,percentage:null},{id:'c',name:'Exams',weight:45,percentage:null}]};
    state.snapshots.managebac[url]={source:'managebac',url,capturedAt:'2026-09-23T00:00:00Z',courses:[c],tasks:[],feedback:[],warnings:[]};
    await page.addInitScript(state=>localStorage.setItem('campusdesk.browser.v1',JSON.stringify(state)),state);
    await page.goto(pathToFileURL(path.resolve(__dirname,'../Resources/index.html')).href+'#grades');
    await page.locator('#gp-target').waitFor();
    assert.match(await page.locator('#gp-live-results').innerText(),/90.78%/);
    assert.match(await page.locator('.gpa-forecast-card').innerText(),/3.00 \/ 4.00/);
    assert.doesNotMatch(await page.locator('.gp-card').allInnerTexts().then(t=>t.join('')),/[\u3400-\u9fff]/);
    await page.locator('#gp-target').fill('91.');
    await page.evaluate(()=>CampusDesk.receive({type:'snapshot',snapshot:{source:'teams',url:'https://teams.microsoft.com/v2/',capturedAt:'2026-09-23T01:00:00Z',posts:[],assignments:[],ec:[],feedback:[],grades:[],warnings:[]}}));
    assert.equal(await page.locator('#gp-target').inputValue(),'91.');
    await page.locator('#gp-target').fill('90');
    await page.locator('#gp-score-1').fill('95'); await page.locator('#gp-score-2').fill('90');
    assert.match(await page.locator('#gp-live-results').innerText(),/91.13%/);
    await page.locator('#grade-plan-form [type="submit"]').click();
    assert.match(await page.locator('.gpa-forecast-card').innerText(),/91.13%/);
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('campusdesk.browser.v1')));
    assert.equal(saved.settings.gradePlans[P.key(c)].overrides[0].score,95);
    // Reload without the seeding init script so saved state is what gets tested.
    const page2=await browser.newPage({viewport:{width:1280,height:1000}});
    await page2.addInitScript(saved=>localStorage.setItem('campusdesk.browser.v1',JSON.stringify(saved)),saved);
    await page2.goto(pathToFileURL(path.resolve(__dirname,'../Resources/index.html')).href+'#grades');
    assert.equal(await page2.locator('#gp-score-1').inputValue(),'95');
    await page.locator('#gp-mode-0').selectOption('estimate');
    assert.equal(await page.locator('#gp-score-0').isEnabled(),true);
    await page.locator('#gp-score-0').fill('92');
    await page.locator('#grade-plan-form [type="submit"]').click();
    await page.locator('#gp-score-0').fill('101');
    await page.locator('#gp-mode-0').selectOption('hold');
    await page.locator('#grade-plan-form [type="submit"]').click();
    const heldState=await page.evaluate(()=>JSON.parse(localStorage.getItem('campusdesk.browser.v1')));
    assert.doesNotThrow(()=>Core.validateState(heldState),'an unused invalid estimate must not corrupt saved state');
    await page.locator('#gpa-term-start').fill('20260902'); await page.locator('#gpa-term-end').fill('20270120');
    await page.locator('#gpa-term-dates-form [type="submit"]').click();
    assert.equal(await page.locator('#gpa-term-start').inputValue(),'2026-09-02');
    await page.locator('#gp-paste-details summary').click();
    await page.locator('#gp-paste').fill('Formative Assessment (20%)\nB (86.88%)\nSummative Assessment (35%)\n-\nExams (45%)\n-');
    await page.locator('[data-gp-action="paste"]').click();
    assert.equal(await page.locator('#gp-weight-0').inputValue(),'20');
    await page.locator('#gp-weight-0').fill('19');
    await page.locator('#grade-plan-form [type="submit"]').click();
    assert.match(await page.locator('#gp-error').innerText(),/99.00%/);
    await page.locator('#gp-weight-0').fill('20');
    await page.locator('#grade-plan-form [type="submit"]').click();
    assert.match(await page.locator('.gp-source').innerText(),/Local data/);
    await page.setViewportSize({width:760,height:1000});
    await page.locator('#grade-plan-form').scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no page-wide overflow');
    await page.setViewportSize({width:1280,height:1000});
    await page.locator('.gp-card').first().screenshot({path:'/private/tmp/campusdesk-grade-planner.png'});
    await page.locator('.gpa-forecast-card').screenshot({path:'/private/tmp/campusdesk-grade-forecast.png'});
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});
test('ManageBac information icon survives adapter reinjection and reads the category popup',optional,async()=>{
  const browser=await launch();
  try {
    const page=await browser.newPage();
    await page.setContent('<main><h1>Synthetic course</h1><h2>All Tasks</h2><select id="term"><option selected>Term 1 (current)</option></select><span title="Task information" data-toggle="popover">ⓘ</span></main>');
    await page.evaluate(()=>{window.clickCount=0; document.querySelector('span').onclick=()=>{window.clickCount++;};});
    const script=fs.readFileSync(path.resolve(__dirname,'../Resources/managebac.js'),'utf8');
    const url='https://example-school.managebac.cn/student/classes/7001/core_tasks';
    for(let i=0;i<3;i++) {await page.evaluate(script); assert.equal((await page.evaluate(url=>CampusManageBac.extract(document,url),url)).categoryAveragesPending,true);}
    assert.equal(await page.evaluate(()=>window.clickCount),1,'retries do not toggle the popup closed');
    await page.evaluate(()=>{const portal=document.createElement('div');portal.innerHTML='<h3>Task Category Averages</h3><table><tr><td>Category (Weight)</td><td>Mark (Score)</td></tr><tr><td>Overall</td><td>B (86.88%)</td></tr><tr><td>Formative Assessment (20%)</td><td>B (86.88%)</td></tr><tr><td>Summative Assessment (35%)</td><td>-</td></tr><tr><td>Exams (45%)</td><td>-</td></tr></table>';document.body.append(portal);});
    await page.evaluate(script);
    const result=await page.evaluate(url=>CampusManageBac.extract(document,url),url);
    assert.equal(result.categoryAveragesPending,undefined);
    assert.deepEqual(result.courses[0].gradeComponents.map(({name,weight,percentage})=>({name,weight,percentage})),[{name:'Formative Assessment',weight:20,percentage:86.88},{name:'Summative Assessment',weight:35,percentage:null},{name:'Exams',weight:45,percentage:null}]);
    // Actual site layout uses ordinary blocks in Details, without table roles.
await page.evaluate(()=>{document.querySelector('table').parentElement.remove(); const panel=document.createElement('aside'); panel.innerHTML='<section><h6>Task Category Averages</h6><div><div>Category (Weight)</div><div>Mark (Score)</div></div><div><div>Overall</div><div>A (93%)</div></div><div><span>Quiz (20%)</span><div>A (92%)</div></div><div><span>Homework (15%)</span><div>A (97%)</div></div><div><span>Essay (10%)</span><div>A (90%)</div></div><div><span>Midterm (25%)</span><div>-</div></div><div><span>Endterm (25%)</span><div>-</div></div><div><span>Discussion (5%)</span><div>-</div></div><p>View the average grades per task category calculated in the class.</p></section>';document.body.append(panel);});
    const blockResult=await page.evaluate(url=>CampusManageBac.extract(document,url),url);
    assert.deepEqual(blockResult.courses[0].gradeComponents.map(row=>row.weight),[20,15,10,25,25,5]);
    assert.deepEqual(blockResult.courses[0].gradeComponents.map(row=>row.percentage),[92,97,90,null,null,null]);
  } finally {await browser.close();}
});
