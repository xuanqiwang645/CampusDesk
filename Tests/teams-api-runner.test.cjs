'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {runTeamsAPI,runTeamsAPIIndex}=require('../Resources/teams-api-runner.js');
const auto=require('../Resources/teams-auto.js');
function fixture(options={}) {
  const events=[],snapshots=[],warnings=[],requests=[];
  let clock=0;
  const account='account-one',conversation='19:example@thread.tacv2';
  const messages=options.messages || [{nativeID:'message-1',text:'EC roster',attachments:[{id:'file-1',title:'Roster.txt'}]}];
  const api={start(request){
    requests.push(request);
    if(request.op==='conversations')return {jobId:'index',status:'running'};
    if(request.op==='messages')return options.messageResponse || {status:'complete',result:{accountId:options.messageAccount || account,conversationId:options.messageScope || conversation,messages}};
    if(request.op==='attachment')return options.attachmentReply?options.attachmentReply(request):options.attachmentResponse || {status:'complete',result:{accountId:account,attachmentId:request.attachmentId,title:'Roster.txt',mimeType:'text/plain',byteLength:3,base64:'YWJj',...options.binary}};
    throw new Error('Unexpected operation '+request.op);
  },status(){return {status:'partial',result:{accountId:options.indexAccount||account,conversations:options.conversations||[{id:conversation,name:'English Corner',type:'channel'}]}};},forget(){}};
  const window={CampusDeskTeamsAPI:api,CampusTeamsAuto:auto};
  const context={scope:{strong:true,type:'channel',id:conversation,name:'English Corner',label:'English Corner',accountId:account},identity:account,item:{label:'English Corner'},config:{focus:'ec'},counts:{},
    readResource:()=>'',pageEval:script=>vm.runInNewContext(script,{window}),now:()=>clock,sleep:seconds=>{clock+=seconds*1000;},deadline:()=>{},progress:()=>{},warn:value=>warnings.push(value),
    emit:event=>events.push(event),publish:snapshot=>snapshots.push(snapshot),recordCoverage:()=>{}};
  context.readResource=()=> '/* Test uses a preinstalled fake API. */';
  return {context,events,snapshots,warnings,requests};
}
test('matching message and binary scopes publish one partial snapshot and one bounded attachment',()=>{
  const f=fixture(),result=runTeamsAPI(f.context);
  assert.equal(result.handled,true);assert.equal(result.historyComplete,false);
  assert.equal(f.snapshots.length,1);assert.equal(f.snapshots[0].coverageMetadata.historyComplete,false);
  assert.equal(f.events.length,1);assert.equal(f.events[0].accountId,'account-one');
  assert.equal(f.events[0].attachmentId,'file-1');
});
test('429 ends the index run after the first attempted scope and records a safe cooldown',()=>{
  const f=fixture({conversations:[{id:'19:example@thread.tacv2',name:'English Corner A',type:'channel'},{id:'19:second@thread.tacv2',name:'English Corner B',type:'channel'}],messageResponse:{status:'error',error:{code:'HTTP_429',retryAfterMs:120000,service:'teams-chat',secret:'do not store'}}});
  let cooldown;f.context.setCooldown=value=>{cooldown=value;};
  assert.throws(()=>runTeamsAPIIndex(f.context),error=>error.code==='RATE_LIMITED');
  assert.equal(f.requests.filter(r=>r.op==='messages').length,1);
  assert.deepEqual(cooldown,{accountId:'account-one',service:'teams-chat',retryAt:'1970-01-01T00:02:00.250Z'});
  assert.equal(f.events.length,0);
});
test('partial messages before throttling are published, but attachments and fallbacks are not requested',()=>{
  const f=fixture({messageResponse:{status:'partial',result:{accountId:'account-one',conversationId:'19:example@thread.tacv2',messages:[{nativeID:'m1',text:'EC roster'}]},error:{code:'HTTP_429'}}});
  assert.throws(()=>runTeamsAPI(f.context),error=>error.code==='RATE_LIMITED');
  assert.equal(f.snapshots.length,1);assert.equal(f.requests.length,1);
});
test('an attachment throttle ends the loop without retrying the next attachment',()=>{
  const f=fixture({messages:[{nativeID:'m1',text:'EC roster',attachments:[{id:'f1'},{id:'f2'}]}],attachmentResponse:{status:'error',error:{code:'HTTP_503',retryAfterMs:10000}}});
  assert.throws(()=>runTeamsAPI(f.context),error=>error.code==='RATE_LIMITED');
  assert.equal(f.requests.filter(r=>r.op==='attachment').length,1);
});
test('verified unchanged metadata reuses only a matching persisted account/file/version without emitting bytes',()=>{
  const f=fixture({binary:{notModified:true,versionKey:'v1:12345678',base64:undefined}});
  f.context.config.attachmentCache=[{accountId:'account-one',attachmentId:'file-1',versionKey:'v1:12345678'}];
  runTeamsAPI(f.context);
  assert.equal(f.requests.find(r=>r.op==='attachment').knownVersionKey,'v1:12345678');
  assert.equal(f.events[0].type,'attachmentUnchanged');assert.equal(f.events[0].base64,undefined);
  assert.equal(f.context.counts.attachmentsCached,1);
});
test('unknown, foreign or mismatched versions cannot suppress downloading or claim cached validation',()=>{
  for(const cache of [[],[{accountId:'other',attachmentId:'file-1',versionKey:'v1:12345678'}],[{accountId:'account-one',attachmentId:'file-1',versionKey:'v1:87654321'}]]) {
    const f=fixture({binary:{notModified:true,versionKey:'v1:12345678',base64:undefined}});f.context.config.attachmentCache=cache;
    runTeamsAPI(f.context);assert.equal(f.events.length,0);assert.equal(f.context.counts.attachmentsCached,undefined);
  }
});
test('request timings contain aggregate stages only',()=>{
  const f=fixture();f.context.timings={};runTeamsAPI(f.context);
  assert.equal(f.context.timings.messages.requests,1);assert.equal(f.context.timings.attachments.requests,1);
  assert.deepEqual(Object.keys(f.context.timings).sort(),['attachments','messages']);
});
test('persisted attachment rotation reaches file 41 after the first 40 cache hits',()=>{
  const files=Array.from({length:41},(_,i)=>({id:'f'+i,title:'Roster '+i+'.txt'}));
  let cursor='';
  const options={messages:[{nativeID:'m1',text:'EC roster',attachments:files}],attachmentReply:r=>({status:'complete',result:{accountId:'account-one',attachmentId:r.attachmentId,title:'Roster.txt',versionKey:'v1:12345678',...(r.knownVersionKey?{notModified:true}:{mimeType:'text/plain',byteLength:3,base64:'YWJj'})}})};
  function run(){const f=fixture(options);f.context.config.attachmentCache=files.slice(0,40).map(file=>({accountId:'account-one',attachmentId:file.id,versionKey:'v1:12345678'}));f.context.getAttachmentCursor=()=>cursor;f.context.saveAttachmentCursor=(_,id)=>{cursor=id;};runTeamsAPI(f.context);return f;}
  const first=run();assert.equal(first.requests.filter(r=>r.op==='attachment').length,40);assert.equal(cursor,'f39');
  const second=run();assert.ok(second.events.some(e=>e.type==='attachment'&&e.attachmentId==='f40'));
  assert.equal(second.context.counts.attachmentDownloads,1);
});
test('foreign message account or conversation falls back without publication',()=>{
  for(const options of [{messageAccount:'account-two'},{messageScope:'another-conversation'}]) {
    const f=fixture(options);assert.equal(runTeamsAPI(f.context),false);assert.equal(f.events.length,0);assert.equal(f.snapshots.length,0);
  }
});
test('oversized binary remains unread and is never emitted',()=>{
  const f=fixture({binary:{base64:'Y'.repeat(3500001),byteLength:3000000}});
  assert.equal(runTeamsAPI(f.context).handled,true);assert.equal(f.events.length,0);assert.ok(f.warnings.length>0);
});
test('foreign binary account or attachment identity must not be relabeled as the requested file',()=>{
  for(const binary of [{accountId:'account-two'},{attachmentId:'foreign-file'}]) {
    const f=fixture({binary});runTeamsAPI(f.context);assert.equal(f.events.length,0);
  }
});
test('invalid or dishonest decoded-byte metadata must not bypass the binary gate',()=>{
  for(const binary of [{byteLength:-1},{byteLength:0},{byteLength:'3'},{byteLength:2},{base64:'not base64',byteLength:3}]) {
    const f=fixture({binary});runTeamsAPI(f.context);assert.equal(f.events.length,0);
  }
});
test('account-matched local index reads EC without navigating pages',()=>{
  const f=fixture();const result=runTeamsAPIIndex(f.context);
  assert.equal(result.handled,true);assert.equal(f.context.counts.channels,1);
  assert.equal(f.context.counts.channelsRead,1);assert.equal(f.snapshots.length,1);assert.equal(f.events.length,1);
  assert.equal(f.requests[0].op,'conversations');
});
test('foreign local index cannot grant conversation scope',()=>{
  const f=fixture({indexAccount:'foreign'});assert.equal(runTeamsAPIIndex(f.context),false);
  assert.equal(f.snapshots.length,0);assert.equal(f.events.length,0);assert.equal(f.requests.length,1);
});
