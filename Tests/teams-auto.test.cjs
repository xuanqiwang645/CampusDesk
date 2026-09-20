'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const auto = require('../Resources/teams-auto.js');
const url = 'https://teams.cloud.microsoft/';
const when = '2026-09-20T00:00:00.000Z';
const scope = {type:'channel',id:'19:synthetic@thread.tacv2',name:'HOMEWORK',label:'Example Team > HOMEWORK',strong:true,accountId:'synthetic-account'};
function result(records, overrides) { return auto.normalizeRecords(records,{...scope,...overrides},url,when,'Synthetic Teams'); }
function text(value) { return {nodeType:3,nodeValue:value}; }
function node(tag, attrs, children) { return {nodeType:1,tagName:tag,childNodes:children || [],getAttribute:name=>(attrs || {})[name] || null}; }
test('root Teams URL uses strong DOM channel identity, not a fabricated deep link',()=>{
  const data = result([{nativeID:'content-10',text:'Read the source.'}]);
  assert.equal(data.url,url);
  assert.equal(data.posts[0].url,url);
  assert.equal(data.coverageMetadata.scope.id,scope.id);
  assert.equal(data.coverage,'browser');
  assert.equal(data.tasks.length,1);
  assert.equal(data.tasks[0].requirements,'Read the source.');
});
test('message IDs survive edits but separate accounts, channels and reply content IDs',()=>{
  const a=result([{nativeID:'content-10',text:'Original'}]);
  assert.equal(a.posts[0].id,result([{nativeID:'content-10',text:'Edited'}]).posts[0].id);
  assert.notEqual(a.posts[0].id,result([{nativeID:'content-10',text:'Original'}],{id:'another-channel'}).posts[0].id);
  assert.notEqual(a.posts[0].id,result([{nativeID:'content-10',text:'Original'}],{accountId:'another-account'}).posts[0].id);
  assert.equal(result([{nativeID:'content-10',text:'Parent'},{nativeID:'content-11',text:'Reply'}]).posts.length,2);
  assert.equal(result([{nativeID:'content-10',text:'Parent'},{nativeID:'content-10',text:'Parent duplicated'}]).posts.length,1);
});
test('snapshot key is stable across captures and differs across accounts and scopes',()=>{
  const key=result([]).snapshotId;
  assert.equal(key,result([{nativeID:'content-11',text:'A'}]).snapshotId);
  assert.notEqual(key,result([],{accountId:'second-account'}).snapshotId);
  assert.notEqual(key,result([],{id:'second-channel'}).snapshotId);
});
test('emoji-only replies and paragraph boundaries are retained',()=>{
  const body=node('DIV',{},[node('P',{},[text('Hello '),node('IMG',{alt:'👍'})]),node('P',{},[text('Second line'),node('BR'),text('Third line')])]);
  assert.equal(auto.plainText(body),'Hello 👍\nSecond line\nThird line');
  const emoji=auto.plainText(node('DIV',{},[node('IMG',{alt:'👍','aria-hidden':'true'})]));
  assert.equal(result([{nativeID:'content-12',text:emoji}],{name:'General',label:'General'}).posts[0].text,'👍');
});
test('message text excludes hidden elements, scripts and controls',()=>{
  const body=node('DIV',{},[text('Visible'),node('SPAN',{'aria-hidden':'true'},[text('Hidden')]),node('SCRIPT',{},[text('secret()')]),node('BUTTON',{},[text('Send')])]);
  assert.equal(auto.plainText(body),'Visible');
});
test('metadata-only and signed attachments are retained without exporting secrets',()=>{
  const data=result([{nativeID:'file-message',text:'See the document.',attachments:[
    {title:'No link.pdf'},
    {title:'Signed.pdf',url:'https://example.sharepoint.com/doc?sig=SECRET'},
    {title:'Safe.pdf',url:'https://example.sharepoint.com/sites/example/Safe.pdf'},
    {title:'Image',kind:'image',url:'blob:https://teams.cloud.microsoft/example'}
  ]}]);
  assert.equal(data.posts[0].attachments.length,4);
  assert.deepEqual(data.posts[0].attachments.map(a=>a.extractionStatus),['unread','unread','unread','unread']);
  assert.deepEqual(data.posts[0].attachments.map(a=>a.url),[null,null,'https://example.sharepoint.com/sites/example/Safe.pdf',null]);
  assert.equal(JSON.stringify(data).includes('SECRET'),false);
  assert.equal(data.coverageMetadata.attachmentContentRead,false);
});
test('attachment-only message remains visible without pretending to read its content',()=>{
  const data=result([{nativeID:'attachment-only',attachments:[{title:'Roster.pdf'}]}],{label:'ENGLISH CORNER ROSTER'});
  assert.equal(data.posts.length,1);
  assert.equal(data.posts[0].title,'Roster.pdf');
  assert.equal(data.posts[0].text,'');
  assert.equal(data.posts[0].kind,'ec');
  assert.equal(data.tasks.length,0);
});
test('homework and EC are classified while grades and completion are never invented',()=>{
  const data=result([{nativeID:'ec',text:'English Corner roster\nGroup A'},{nativeID:'homework',text:'Homework: Read the source.\nDue: Friday',postedAt:'2026-09-19T13:00:00Z'}]);
  assert.deepEqual(data.posts.map(p=>p.kind),['ec','assignment']);
  assert.equal(data.tasks[0].dueAt,null);
  assert.equal(data.tasks[0].dueLabel,'Due: Friday');
  assert.equal(data.tasks[0].status,'unknown');
  assert.deepEqual(data.grades,[]);
  assert.equal(data.coverageMetadata.fullHistory,false);
});
test('empty rendered channel is a valid empty snapshot with incomplete-history flag',()=>{
  const data=result([]);
  assert.equal(data.parseError,false);
  assert.deepEqual(data.posts,[]);
  assert.equal(data.coverageMetadata.fullHistory,false);
});
test('emoji and acknowledgements in HOMEWORK remain messages, not invented tasks',()=>{
  for(const body of ['👌','👍','OK','Thanks!','收到']) {
    const data=result([{nativeID:'reply',text:body}],{label:'HOMEWORK'});
    assert.equal(data.posts.length,1);assert.equal(data.posts[0].kind,'general');assert.equal(data.tasks.length,0);
  }
});
test('record, text and attachment bounds are explicit in coverage',()=>{
  const records=Array.from({length:auto.limits.records+1},(_,i)=>({nativeID:String(i),text:'x'.repeat(auto.limits.text+1),attachments:Array.from({length:auto.limits.attachments+1},(_,a)=>({title:'file '+a}))}));
  const data=result(records);
  assert.equal(data.posts.length,auto.limits.records);
  assert.equal(data.posts[0].text.length,auto.limits.text);
  assert.equal(data.posts[0].attachments.length,auto.limits.attachments);
  assert.equal(data.coverageMetadata.recordsTruncated,true);
  assert.equal(data.coverageMetadata.textTruncated,true);
  assert.equal(data.coverageMetadata.attachmentsTruncated,true);
});
test('scope guards require IDs and reject changes even if root URL never changes',()=>{
  assert.equal(auto.sameScope(scope,scope),true);
  assert.equal(auto.sameScope(scope,{}),false);
  assert.equal(auto.sameScope(scope,{...scope,id:'another'}),false);
  assert.equal(auto.sameScope(scope,{...scope,type:'chat'}),false);
  assert.equal(auto.sameScope(scope,{...scope,accountId:'another'}),false);
});
test('shown and hidden channel DOM IDs normalize to one identity',()=>{
  assert.equal(auto.normalizeChannelID('channel-shown-19:example@thread.tacv2'),'19:example@thread.tacv2');
  assert.equal(auto.normalizeChannelID('channel-hidden-19:example@thread.tacv2'),'19:example@thread.tacv2');
});
// A deliberately sparse browser fixture exercises command dispatch and its
// refusal paths independently of live Teams DOM/selector coverage.
function navigationWindow(href=url) {
  let clicks=0;
  const appbar={querySelectorAll:()=>[]};
  const label={innerText:'HOMEWORK'};
  const channel={
    getAttribute:name=>({'data-sid':'channel-shown-19:synthetic@thread.tacv2','aria-selected':'true'})[name] || '',
    querySelectorAll:selector=>selector==='[data-tid^="channel-list-item-text-"]' ? [label] : [],
    closest:selector=>selector==='[role="treeitem"]' ? channel : null,
    getClientRects:()=>[{}],matches:()=>false,click:()=>{clicks++;}
  };
  const header={innerText:'HOMEWORK',closest:()=>null,getClientRects:()=>[{}]};
  const doc={title:'Synthetic',querySelectorAll:selector=>{
    if(selector==='[data-tid="app-bar-wrapper"]')return [appbar];
    if(selector==='[data-tid="channel-list-item"]')return [channel];
    if(selector==='[data-tid="channelTitle-text"], [data-tid="channel-header-title"], [data-tid="channel-name"]')return [header];
    return [];
  }};
  const win={document:doc,location:{href},getComputedStyle:()=>({})};
  return {adapter:auto.createAdapter(win),clicks:()=>clicks};
}
test('browser dispatcher recognizes header + selected DOM ID even at root URL',()=>{
  const fixture=navigationWindow();
  const state=fixture.adapter.run({action:'inspect'});
  assert.equal(state.ok,true);
  assert.equal(state.scope.id,scope.id);
  assert.equal(state.scope.strong,true);
  assert.equal(state.channels[0].name,'HOMEWORK');
  assert.equal(fixture.clicks(),0);
});
test('navigation never executes unknown targets, unsupported actions or stale scopes',()=>{
  const fixture=navigationWindow();
  assert.equal(fixture.adapter.run({action:'openChannel',channelID:'not-discovered'}).code,'NAVIGATION_NOT_FOUND');
  assert.equal(fixture.adapter.run({action:'delete'}).code,'UNSUPPORTED_ACTION');
  assert.equal(fixture.adapter.run({action:'openChannel',channelID:scope.id,expectedScope:{id:'changed'}}).code,'SCOPE_CHANGED');
  assert.equal(fixture.adapter.run({action:'expand'}).code,'SCOPE_REQUIRED');
  assert.equal(fixture.clicks(),0);
});
test('dispatch refuses non-Teams pages before reading or clicking navigation',()=>{
  const fixture=navigationWindow('https://example.invalid/');
  assert.equal(fixture.adapter.run({action:'openTeams'}).code,'NOT_TEAMS');
  assert.equal(fixture.clicks(),0);
});
