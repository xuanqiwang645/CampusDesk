'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const teams = require('../Resources/teams.js');
const url = 'https://teams.microsoft.com/v2/';
const timestamp = '2026-09-19T12:00:00Z';
// Entirely synthetic examples: no actual student names, messages, or account data.
const fixture = () => ({url,title:'Synthetic Teams fixture',recognized:true,channel:'Example English',messages:[
  {nativeID:'message-1',channelID:'channel-example',title:'Homework: reading response',text:'Homework: reading response\nExplain one passage.\nDue: Friday at 17:00',author:'Example Teacher',postedAt:'2026-09-19T09:00:00+08:00',status:'Not submitted',attachments:[]},
  {nativeID:'message-2',channelID:'channel-example',title:'English Corner',text:'English Corner — EC 名单\nGroup A: Example A, Example B\nBring your homework notebook.',attachments:[]},
  {nativeID:'message-3',channelID:'channel-example',title:'Assembly',text:'Meet in the hall at lunch.',attachments:[]}
]});
const result = (page, options) => teams.fromProjection(page,timestamp,options);
test('synthetic messages become one task and exact EC/general posts',()=>{
  const data=result(fixture());
  assert.equal(data.source,'teams'); assert.equal(data.coverage,'visible'); assert.equal(data.parseError,false);
  assert.equal(data.tasks.length,1); assert.equal(data.posts.length,3);
  assert.deepEqual(data.posts.map(x=>x.kind),['assignment','ec','general']);
  assert.equal(data.tasks[0].requirements,fixture().messages[0].text);
  assert.equal(data.posts[1].text,fixture().messages[1].text);
  assert.match(data.tasks[0].id,/^teams:[a-f0-9]{8}$/);
  assert.equal(data.tasks[0].status,'pending');
  assert.equal(data.posts[1].author,null);
});
test('deadlines never use message timestamps or infer Friday year',()=>{
  const data=result(fixture());
  assert.equal(data.tasks[0].dueAt,null);
  assert.equal(data.tasks[0].dueLabel,'Due: Friday at 17:00');
  assert.equal(data.posts[0].date,'2026-09-19T01:00:00.000Z');
  assert.ok(data.warnings.some(x=>x.includes('截止时间')));
});
test('an explicitly labeled deadline with ISO zone is accepted',()=>{
  const page=fixture(); page.messages[0].dueDatetime='2026-09-21T17:00:00+08:00';
  page.messages[0].dueLabel='Due Sep 21, 2026 at 17:00 CST';
  assert.equal(result(page).tasks[0].dueAt,'2026-09-21T09:00:00.000Z');
  for (const value of ['2026-02-30T17:00:00Z','2026-09-21T17:00:00','2026-09-21','tomorrow','Friday','2026-13-01T10:00:00Z']) assert.equal(teams.exactDate(value),null);
});
test('EC classification is bounded and takes precedence over homework',()=>{
  assert.equal(teams.classify({text:'EC roster\nExample A'},{kind:'auto'}),'ec');
  assert.equal(teams.classify({text:'EC 名单\nComplete homework first.'},{kind:'auto'}),'ec');
  assert.equal(teams.classify({text:'SPEC list of homework'},{kind:'auto'}),'assignment');
  assert.equal(teams.classify({text:'EC lesson'},{kind:'auto'}),'general');
  assert.equal(teams.classify({text:'Group 1: Example A'},{kind:'ec'}),'ec');
  assert.equal(teams.classify({text:'Lunch assembly'},{kind:'assignments'}),'general');
});
test('English Corner roster channel includes announcements even without a roster in the body',()=>{
  const page={url,title:'Teams',channel:'ENGLISH CORNER ROSTER',messages:[
    {nativeID:'example-notice',title:'Schedule update',text:'Details will follow later.'},
    {nativeID:'example-file',title:'Roster attachment',text:'See the attached file.',attachments:[{title:'EC Roster example.pdf',url:'https://example.sharepoint.com/sites/EC/roster-example.pdf'}]}
  ]};
  const data=result(page);
  assert.deepEqual(data.posts.map(post=>post.kind),['ec','ec']);
  assert.equal(data.tasks.length,0);
  assert.equal(data.posts[1].attachments[0].title,'EC Roster example.pdf');
  assert.equal(data.posts[1].text,'See the attached file.');
});
test('EC announcement and cancellation are EC information without inferring tomorrow',()=>{
  const page={url,title:'Teams',messages:[
    {nativeID:'example-announcement',title:'EC ANNOUNCEMENT',text:'Schedule updated.'},
    {nativeID:'example-cancellation',text:'No EC tomorrow.'},
    {nativeID:'example-postponement',text:'EC is postponed.'}
  ]};
  const data=result(page);
  assert.deepEqual(data.posts.map(post=>post.kind),['ec','ec','ec']);
  assert.equal(data.tasks.length,0);
  assert.equal(data.posts[1].date,null);
  assert.equal(data.posts[1].text,'No EC tomorrow.');
});
test('partial EC publication labels are preserved without inventing a timestamp or year',()=>{
  const page={url,title:'Teams',channel:'ENGLISH CORNER ROSTER',messages:[
    {nativeID:'example-time',title:'EC ANNOUNCEMENT',text:'No EC tomorrow.',dateLabel:'5:18 PM'},
    {nativeID:'example-old-file',title:'Roster attachment',text:'See the attached file.',dateLabel:'9/15'}
  ]};
  const data=result(page);
  assert.deepEqual(data.posts.map(post=>post.date),[null,null]);
  assert.deepEqual(data.posts.map(post=>post.dateLabel),['5:18 PM','9/15']);
  assert.equal(data.tasks.length,0);
});
test('recognized homework channel instructions become course tasks without needing a homework keyword',()=>{
  const page={url,title:'Teams',channel:'Example History > HOMEWORK',messages:[
    {nativeID:'example-reading',title:'Reading response',text:'Read the chapter.\nWrite three observations.\nDue: Friday'}
  ]};
  const data=result(page);
  assert.equal(data.tasks.length,1);
  assert.equal(data.tasks[0].course,'Example History > HOMEWORK');
  assert.equal(data.tasks[0].requirements,page.messages[0].text);
  assert.equal(data.tasks[0].dueAt,null);
  assert.equal(data.tasks[0].dueLabel,'Due: Friday');
  const ecPage={url,title:'Teams',messages:[{text:'Schedule details later.'}]};
  assert.equal(result(ecPage,{label:'ENGLISH CORNER ROSTER'}).posts[0].kind,'ec');
});
test('General channel course notices remain general despite submission and deadline wording',()=>{
  const page={url,title:'Teams',channel:'General',messages:[
    {nativeID:'example-notice',title:'Course update',text:'课程调整申请将在下周截止。\n请提交选择表。'},
    {nativeID:'example-reply',text:'The form submission deadline is Wednesday.'}
  ]};
  const data=result(page,{kind:'assignments'});
  assert.deepEqual(data.posts.map(post=>post.kind),['general','general']);
  assert.equal(data.tasks.length,0);
  assert.ok(data.warnings.some(warning=>warning.includes('未展开的正文') && warning.includes('未加载的回复')));
});
test('native message IDs remain stable across editing and channel scope prevents collisions',()=>{
  const page=fixture(), first=result(page);
  page.messages[0].text='Homework edited instructions';
  assert.equal(result(page).posts[0].id,first.posts[0].id);
  page.messages[0].channelID='other-channel';
  assert.notEqual(result(page).posts[0].id,first.posts[0].id);
  page.messages[0].nativeID=null;
  assert.equal(result(page).posts[0].id,result(page).posts[0].id);
});
test('duplicate visible cards are only exported once',()=>{
  const page=fixture(); page.messages.push({...page.messages[0]});
  assert.equal(result(page).tasks.length,1); assert.equal(result(page).posts.length,3);
});
test('status is never guessed from message prose or returned label',()=>{
  for (const label of ['Returned','I submitted yesterday','Completed','No homework']) assert.equal(teams.taskStatus(label),'unknown');
  assert.equal(teams.taskStatus('Turned in'),'submitted');
  assert.equal(teams.taskStatus('已评分'),'graded');
});
test('only exact Teams source HTTPS hosts are accepted',()=>{
  for (const bad of ['http://teams.microsoft.com/v2/','https://teams.microsoft.com.evil.example/','https://evil.example/','https://user:password@teams.microsoft.com/','https://teams.microsoft.com:8443/']) {
    const page=fixture(); page.url=bad;
    assert.equal(result(page).parseError,true); assert.deepEqual(result(page).posts,[]);
  }
  const page=fixture(); page.url='https://teams.cloud.microsoft/v2/'; assert.equal(result(page).parseError,false);
});
test('source URL rejects authentication query data and task links reject it',()=>{
  const page=fixture(); page.url=url+'?access_token=SECRET&tenantId=example';
  const data=result(page);
  assert.equal(data.parseError,true); assert.equal(data.url,''); assert.equal(data.tasks.length,0);
  assert.equal(JSON.stringify(data).includes('SECRET'),false);
  page.url=url; page.messages[0].url='/l/message/example/123?token=SECRET';
  assert.equal(result(page).tasks[0].url,url);
  assert.equal(teams.teamsURL('/l/message/example/123#access_token=SECRET',url,false),null);
});
test('legitimate deep-link context and Teams SPA hash queries are preserved exactly',()=>{
  const page=fixture();page.url='https://teams.microsoft.com/v2/?context=%7B%22channelId%22%3A%22example%22%7D#/conversations/example?ctx=channel&threadId=example';
  const data=result(page);assert.equal(data.parseError,false);assert.equal(data.url,page.url);
  assert.equal(teams.teamsURL('https://teams.microsoft.com/l/channel/example/English%2FDiscussion?context=example',null,true),'https://teams.microsoft.com/l/channel/example/English%2FDiscussion?context=example');
  assert.equal(teams.teamsURL('https://teams.microsoft.com/v2/#/conversations/example?%74oken=SECRET',null,true),null);
});
test('observed safe message permalink is preserved',()=>{
  const page=fixture(); page.messages[0].url='/l/message/example/123?tenantId=example&parentMessageId=123';
  assert.equal(result(page).tasks[0].url,'https://teams.microsoft.com/l/message/example/123?tenantId=example&parentMessageId=123');
});
test('safe Microsoft attachments retained; signed, hostile and non-HTTPS links omitted',()=>{
  const page=fixture(); page.messages[0].attachments=[
    {title:'Instructions.docx',url:'https://school.sharepoint.com/sites/Example/Instructions.docx?web=1'},
    {title:'China.docx',url:'https://school.sharepoint.cn/sites/Example/China.docx'},
    {title:'Signed',url:'https://school.sharepoint.com/doc?sig=SECRET'},
    {title:'Auth',url:'https://onedrive.live.com/file?authkey=SECRET'},
    {title:'Impostor',url:'https://school.sharepoint.com.evil.example/file'},
    {title:'Offsite',url:'https://external.example/file'},
    {title:'Local',url:'file:///private/file'},
    {title:'Script',url:'javascript:alert(1)'}
  ];
  const data=result(page); assert.equal(data.tasks[0].attachments.length,2);
  assert.equal(JSON.stringify(data).includes('SECRET'),false);
  assert.ok(data.warnings.some(x=>x.includes('附件链接')));
});
test('login and unsupported browser gates export no messages',()=>{
  for (const gate of [{hasPassword:true},{loginField:true},{unsupported:true}]) {
    const data=result(Object.assign(fixture(),gate));
    assert.deepEqual(data.tasks,[]); assert.deepEqual(data.posts,[]);
    if (gate.unsupported) assert.equal(data.parseError,true); else assert.equal(data.loginRequired,true);
  }
});
test('unknown empty page fails closed instead of treating the page body as data',()=>{
  const data=result({url,title:'Teams',messages:[],body:'Homework\nEC 名单\nALL PAGE CONTENT'});
  assert.equal(data.parseError,true); assert.deepEqual(data.tasks,[]); assert.deepEqual(data.posts,[]);
});
test('manual selection imports exactly the original text as explicitly chosen kind',()=>{
  const page={url,title:'Teams',messages:[{text:'Group A\nExample A\nExample B',manual:true}]};
  const ec=result(page,{selectionOnly:true,kind:'ec',label:'EC group'});
  assert.equal(ec.posts[0].kind,'ec'); assert.equal(ec.posts[0].channel,'EC group');
  assert.equal(ec.posts[0].text,page.messages[0].text);
  assert.ok(ec.warnings.some(x=>x.includes('手动选取')));
  const assignment=result(page,{selectionOnly:true,kind:'assignments'});
  assert.equal(assignment.tasks.length,1); assert.equal(assignment.tasks[0].requirements,page.messages[0].text);
});
test('empty manual selection returns parseError and does not silently synchronize page',()=>{
  const page=fixture(); page.selectionEmpty=true;
  const data=result(page,{selectionOnly:true,kind:'ec'});
  assert.equal(data.parseError,true); assert.deepEqual(data.posts,[]);
});
test('message length and count bounded, with truthful warnings',()=>{
  const page=fixture(); page.messages=[...Array.from({length:110},(_,n)=>({nativeID:String(n),text:'Homework '+n})),{text:'Homework '+ 'a'.repeat(17000)}];
  const data=result(page); assert.equal(data.posts.length,99);
  assert.ok(data.warnings.some(x=>x.includes('100'))); assert.ok(data.warnings.some(x=>x.includes('长度限制')));
});
// Tiny DOM doubles exercise collect separately from the pure projection tests.
function node(text='', attrs={}, query=()=>[]) {
  return {innerText:text,textContent:text,getAttribute:name=>attrs[name] || null,
    closest:()=>null,getClientRects:()=>[{}],contains:()=>false,
    matches:selector=>selector.split(',').some(s=>s.trim()==='[data-tid="'+attrs['data-tid']+'"]'),
    querySelectorAll:query,querySelector:selector=>query(selector)[0] || null};
}
function documentFor(cards,selection='') {
  const doc=node('Entire page text is not a message',{},selector=>selector.includes('[data-tid="chat-pane-message"]') ? cards : []);
  doc.title='Fixture'; doc.defaultView={getSelection:()=>selection}; return doc;
}
test('DOM collection requires recognizable message body, never entire card text',()=>{
  const unknown=node('Homework from unrecognized body');
  const page=teams.collect(documentFor([unknown]),url,{});
  assert.equal(page.messages.length,0); assert.equal(result(page).parseError,true);
});
test('DOM collection preserves message lines and ignores unrelated timestamp as due time',()=>{
  const body=node('Homework: write a response\nUse two examples.'), time=node('',{datetime:'2026-09-19T09:00:00+08:00'});
  const card=node('UI controls and entire wrapper',{'data-message-id':'sample'},selector=>{
    if (selector.includes('[data-tid="message-body"]')) return [body];
    if (selector.includes('[data-tid="message-timestamp"]')) return [time];
    return [];
  });
  const page=teams.collect(documentFor([card]),url,{}), data=result(page);
  assert.equal(data.tasks[0].requirements,body.innerText);
  assert.equal(data.tasks[0].dueAt,null);
  assert.equal(data.posts[0].date,'2026-09-19T01:00:00.000Z');
});
test('DOM manual fallback only reads explicit current selection',()=>{
  const selected='EC 名单\nExample A\nExample B';
  const page=teams.collect(documentFor([],selected),url,{selectionOnly:true,kind:'ec'});
  assert.equal(page.messages[0].text,selected);
  const empty=teams.collect(documentFor([]),url,{selectionOnly:true});
  assert.equal(empty.selectionEmpty,true); assert.deepEqual(empty.messages,[]);
});
test('attachment truncation is explicitly reported instead of silently dropping file links',()=>{
  const page=fixture();
  page.messages=[{nativeID:'many-files',title:'Files',text:'See the files.',attachments:Array.from({length:31},(_,index)=>({title:'File '+index,url:'https://example.sharepoint.com/sites/class/file-'+index+'.pdf'}))}];
  const data=result(page);
  assert.equal(data.posts[0].attachments.length,30);
  assert.ok(data.warnings.some(value=>value.includes('超过 30 个')));
});
