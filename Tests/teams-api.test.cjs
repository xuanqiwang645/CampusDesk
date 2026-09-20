'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const create=require('../Resources/teams-api.js');
const ACCOUNT='11111111-1111-1111-1111-111111111111',OTHER='22222222-2222-2222-2222-222222222222',TENANT='33333333-3333-3333-3333-333333333333';
const CONVERSATION='19:example@thread.v2',CHANNEL='19:example@thread.tacv2';
const HOST='https://apac.ng.msg.teams.microsoft.com';
const TOKEN='synthetic-only-not-a-live-token';
function storage(data){const map=new Map(Object.entries(data||{}));return{get length(){return map.size;},key:i=>[...map.keys()][i],getItem:k=>map.get(k)||null,setItem(){throw Error('storage write forbidden');}};}
function key(resource='ic3.teams.office.com',account=ACCOUNT,tenant=TENANT){return `msal.2|${account}.${tenant}|login.windows.net|accesstoken|fixture-client|${tenant}|https://${resource}/.default|`;}
function entry(){return JSON.stringify({secret:TOKEN,homeAccountId:ACCOUNT+'.'+TENANT,realm:TENANT,expiresOn:String(Math.floor(Date.now()/1000)+3600)});}
function fakeDB(rows,account=ACCOUNT){let opened=[];return{opened,async databases(){return[{name:`Teams:conversation-manager:react-web-client:${TENANT}:${account}:en-us`,version:1},{name:`Teams:conversation-manager:react-web-client:${TENANT}:${OTHER}:en-us`,version:1}];},open(name){opened.push(name);let req={},position=0,db={close(){},objectStoreNames:{contains:n=>n==='conversations'},transaction:(name,mode)=>{assert.equal(mode,'readonly');return{objectStore:()=>({openCursor(){let cursor={};function tick(){cursor.result=position<rows.length?{value:rows[position++],continue:()=>queueMicrotask(tick)}:null;cursor.onsuccess();}queueMicrotask(tick);return cursor;}})};}};queueMicrotask(()=>{req.result=db;req.onsuccess();});return req;}};}
function environment(options={}){
  let current=ACCOUNT,calls=[];
  const env={location:{href:'https://teams.cloud.microsoft/'},document:{cookie:'',querySelector:()=>({getAttribute:()=>`https://teams.microsoft.com/api/mt/emea/beta/users/${current}/profilepicture`})},
    sessionStorage:storage({['tmp.session.'+ACCOUNT+'-mainWindowNavHistory']:JSON.stringify([{activeEntities:{mainEntity:{id:options.conversation||CONVERSATION,type:'chats',action:'view'}}}]),['tmp.session.'+ACCOUNT+'-mainWindowNavHistoryIndex']:JSON.stringify({windowHistoryIndex:0})}),
    localStorage:storage({[key()]:entry()}),performance:{getEntriesByType:()=>[{name:HOST+'/v1/users/ME/conversations'}]},
    indexedDB:fakeDB([{id:CONVERSATION,chatTitle:{shortTitle:'Fixture chat'}}]),atob:s=>Buffer.from(s,'base64').toString('binary'),btoa:s=>Buffer.from(s,'binary').toString('base64'),crypto:webcrypto,setTimeout,clearTimeout,
    fetch:async(address,init)=>{calls.push({address,init});return options.fetch?options.fetch(address,init,calls.length):Response.json({messages:[]});},
    calls,changeAccount(){current=OTHER;}};
  return env;
}
async function run(bridge,input){let job=bridge.start(input);assert.equal(job.status,'running');for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,2));const status=bridge.status(job.jobId);if(status.status!=='running')return status;}throw Error('job did not settle');}
test('requires verified active Teams avatar account, not a conversation UUID',async()=>{
  const env=environment();env.document.querySelector=()=>null;
  const result=await run(create(env),{op:'conversations'});assert.equal(result.error.code,'ACCOUNT_UNVERIFIED');assert.equal(env.calls.length,0);
});
test('only current-account Teams conversations IDB opens read-only; discovery stays partial',async()=>{
  const env=environment(),bridge=create(env),result=await run(bridge,{op:'conversations'});
  assert.equal(result.status,'partial');assert.equal(result.result.conversations[0].name,'Fixture chat');assert.equal(result.result.discoveryComplete,false);
  assert.equal(env.indexedDB.opened.length,1);assert.ok(env.indexedDB.opened[0].includes(ACCOUNT));assert.equal(env.calls.length,0);
});
test('message pagination preserves text/metadata and never exports auth or HTML',async()=>{
  const next=HOST+'/v1/users/ME/conversations/'+encodeURIComponent(CONVERSATION)+'/messages?cursor=page2';
  const env=environment({fetch:async(u,init,n)=>Response.json(n===1?{messages:[{id:'1',messagetype:'Text',conversationid:CONVERSATION,content:'<p>Hello &amp; goodbye</p><script>run()</script>',imdisplayname:'Fixture',composetime:'2026-09-20T01:00:00Z',properties:{files:JSON.stringify([{itemid:'file-1',fileName:'Notes.pdf',objectUrl:'https://school.sharepoint.com/sites/class/Notes.pdf'}])}}],_metadata:{backwardLink:next}}:{messages:[{id:'1',messagetype:'Text',content:'Duplicate'},{id:'2',messagetype:'Text',content:'Second'}]})});
  const result=await run(create(env),{op:'messages',conversationId:CONVERSATION});
  assert.equal(result.status,'complete');assert.equal(result.result.messages.length,2);assert.equal(result.result.messages[0].text,'Hello & goodbye');
  assert.equal(result.result.messages[0].attachments[0].extractionStatus,'unread');assert.equal(result.result.historyComplete,true);
  assert.equal(JSON.stringify(result).includes(TOKEN),false);assert.equal(JSON.stringify(result).includes('run()'),false);
  for(const call of env.calls){assert.equal(call.init.method,'GET');assert.equal(call.init.redirect,'error');assert.equal(call.init.credentials,'omit');assert.equal(call.init.headers.Authorization,'Bearer '+TOKEN);}
});
test('cross-host and cross-conversation pagination is refused before credentials sent',async()=>{
  for(const next of ['https://evil.example/v1/users/ME/conversations/x/messages',HOST+'/v1/users/ME/conversations/other/messages']){
    const env=environment({fetch:async()=>Response.json({messages:[{id:'1',messagetype:'Text',content:'Saved'}],_metadata:{backwardLink:next}})});
    const result=await run(create(env),{op:'messages',conversationId:CONVERSATION});assert.equal(result.status,'partial');assert.equal(result.error.code,'SCOPE_DENIED');assert.equal(env.calls.length,1);
  }
});
test('missing, wrong-account, unrelated Graph, and ambiguous tenant tokens are not sent',async()=>{
  for(const data of [{},{[key('ic3.teams.office.com',OTHER)]:entry()},{[key('graph.microsoft.com')]:entry()},
    {[key()]:entry(),[key('ic3.teams.office.com',ACCOUNT,OTHER)]:JSON.stringify({secret:TOKEN,expiresOn:String(Date.now()/1000+3600)})}]){
    const env=environment();env.localStorage=storage(data);const result=await run(create(env),{op:'messages',conversationId:CONVERSATION});
    assert.match(result.error.code,/TOKEN_UNAVAILABLE|TOKEN_AMBIGUOUS/);assert.equal(env.calls.length,0);
  }
});
test('MSAL encrypted matching entry is used in-page without exporting encryption material',async()=>{
  const env=environment(),base=webcrypto.getRandomValues(new Uint8Array(32)),nonce=webcrypto.getRandomValues(new Uint8Array(16));
  const keyBase=await webcrypto.subtle.importKey('raw',base,'HKDF',false,['deriveKey']);
  const derived=await webcrypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:nonce,info:new TextEncoder().encode('fixture-client')},keyBase,{name:'AES-GCM',length:256},false,['encrypt']);
  const encrypted=await webcrypto.subtle.encrypt({name:'AES-GCM',iv:new Uint8Array(12)},derived,new TextEncoder().encode(entry()));
  const b64=a=>Buffer.from(a).toString('base64url');env.document.cookie='msal.cache.encryption='+encodeURIComponent(JSON.stringify({key:b64(base)}));
  env.localStorage=storage({[key()]:JSON.stringify({nonce:b64(nonce),data:b64(encrypted)})});
  const result=await run(create(env),{op:'messages',conversationId:CONVERSATION});assert.equal(result.status,'complete');assert.equal(env.calls[0].init.headers.Authorization,'Bearer '+TOKEN);
  assert.equal(JSON.stringify(result).includes(b64(base)),false);
});
test('unknown conversation and lookalike host never trigger unverified fetch',async()=>{
  let env=environment();assert.equal((await run(create(env),{op:'messages',conversationId:CHANNEL})).error.code,'SCOPE_DENIED');assert.equal(env.calls.length,0);
  for(const host of ['https://evilng.msg.teams.microsoft.com','https://apac.ng.msg.teams.microsoft.com.evil.example','http://apac.ng.msg.teams.microsoft.com']){
    env=environment();env.performance.getEntriesByType=()=>[{name:host+'/v1/users/ME/conversations'}];
    assert.equal((await run(create(env),{op:'messages',conversationId:CONVERSATION})).error.code,'TOKEN_UNAVAILABLE');assert.equal(env.calls.length,0);
  }
});
test('malformed JSON is an error, never a claimed history boundary',async()=>{
  const env=environment({fetch:async()=>new Response('not JSON')});const result=await run(create(env),{op:'messages',conversationId:CONVERSATION});
  assert.equal(result.error.code,'INVALID_RESPONSE');assert.equal(result.result.historyComplete,false);
});
test('channels and capped pagination remain partial, including repeat backward links',async()=>{
  const env=environment({conversation:CHANNEL,fetch:async()=>Response.json({messages:[{id:'1',messagetype:'Text',content:'post'}]})});
  assert.equal((await run(create(env),{op:'messages',conversationId:CHANNEL})).result.historyComplete,false);
  const capped=environment({fetch:async()=>Response.json({messages:[{id:'1',messagetype:'Text'}],_metadata:{backwardLink:HOST+'/v1/users/ME/conversations/'+encodeURIComponent(CONVERSATION)+'/messages?cursor=next'}})});
  const result=await run(create(capped),{op:'messages',conversationId:CONVERSATION,maxPages:1});assert.equal(result.status,'partial');assert.equal(result.result.timelineComplete,false);
});
test('oversized and HTTP failure responses are bounded and sanitized',async()=>{
  for(const response of [new Response('x',{headers:{'content-length':'9999999'}}),new Response('server supplied secret error',{status:403})]){
    const env=environment({fetch:async()=>response}),result=await run(create(env),{op:'messages',conversationId:CONVERSATION});
    assert.match(result.error.code,/RESPONSE_LIMIT|HTTP_403/);assert.equal(JSON.stringify(result).includes('server supplied secret'),false);
  }
});
test('attachments require a discovered ID and exact SharePoint scope; signed URL is not returned',async()=>{
  const env=environment({fetch:async(u)=>u.startsWith(HOST)?Response.json({messages:[{id:'1',messagetype:'Text',content:'File',properties:{files:[{itemid:'f',fileName:'Notes.pdf',objectUrl:'https://school.sharepoint.com/sites/class/Notes.pdf?sig=synthetic-signed'}]}}]}):new Response('%PDF-1.7\nfixture',{headers:{'content-type':'application/pdf'}})});
  env.localStorage=storage({[key()]:entry(),[key('school.sharepoint.com')]:entry()});const bridge=create(env),messages=await run(bridge,{op:'messages',conversationId:CONVERSATION});
  const file=messages.result.messages[0].attachments[0];assert.equal(file.url,'');assert.equal(JSON.stringify(messages).includes('synthetic-signed'),false);
  const result=await run(bridge,{op:'attachment',attachmentId:file.id});assert.equal(result.status,'complete');assert.equal(Buffer.from(result.result.base64,'base64').toString(),'%PDF-1.7\nfixture');
  assert.equal((await run(bridge,{op:'attachment',attachmentId:'invented'})).error.code,'SCOPE_DENIED');
});
test('attachment HTML and unexpected account switches cannot produce success',async()=>{
  const env=environment({fetch:async()=>{env.changeAccount();return Response.json({messages:[{id:'1',messagetype:'Text',content:'Other account'}]});}});
  const result=await run(create(env),{op:'messages',conversationId:CONVERSATION});assert.equal(result.error.code,'ACCOUNT_CHANGED');assert.equal(result.result,null);
});
test('authz discovery is only exact endpoint with matching Skype resource, then IC3 GET',async()=>{
  const env=environment({fetch:async(u)=>u.includes('/authz')?Response.json({regionGtms:{chatService:HOST},userRegion:'apac',tokens:{skypeToken:'must-not-export-or-use'}}):Response.json({messages:[]})});
  env.performance.getEntriesByType=()=>[];env.localStorage=storage({[key()]:entry(),[key('api.spaces.skype.com')]:entry()});
  const result=await run(create(env),{op:'messages',conversationId:CONVERSATION});assert.equal(result.status,'complete');assert.equal(env.calls.length,2);
  assert.equal(env.calls[0].address,'https://authsvc.teams.microsoft.com/v1.0/authz');assert.equal(env.calls[0].init.method,'POST');assert.equal(env.calls[0].init.body,'{}');assert.equal(env.calls[1].init.method,'GET');
  assert.equal(JSON.stringify(result).includes('must-not-export'),false);
});
test('poisoned discovery host is rejected without sending IC3 token',async()=>{
  const env=environment({fetch:async()=>Response.json({regionGtms:{chatService:'https://evil.example'}})});env.performance.getEntriesByType=()=>[];env.localStorage=storage({[key('api.spaces.skype.com')]:entry()});
  const result=await run(create(env),{op:'messages',conversationId:CONVERSATION});assert.equal(result.error.code,'ENDPOINT_UNAVAILABLE');assert.equal(env.calls.length,1);
});
test('strong current DOM scope is allowed without prior index enumeration',async()=>{
  const env=environment();env.CampusTeamsAuto={run:()=>({accountId:ACCOUNT,scope:{id:CHANNEL,strong:true}})};
  const result=await run(create(env),{op:'messages',conversationId:CHANNEL});assert.equal(result.status,'partial');assert.equal(env.calls.length,1);
});
test('inline roster media uses a discovered object path, without auth to external img sources',async()=>{
  const media='https://apac-api.asm.skype.com/v1/objects/fixture-object/views/imgo',png=new Uint8Array([137,80,78,71,13,10,26,10]);
  const env=environment({fetch:async(u)=>u.startsWith(HOST)?Response.json({messages:[{id:'1',messagetype:'Text',content:'Roster <img src="'+media+'" alt="Roster"><img src="https://evil.example/img.png">'}]}):new Response(png,{headers:{'content-type':'image/png'}})});
  const bridge=create(env),msg=await run(bridge,{op:'messages',conversationId:CONVERSATION}),files=msg.result.messages[0].attachments;
  assert.equal(files.length,1);assert.equal(files[0].kind,'image');const result=await run(bridge,{op:'attachment',attachmentId:files[0].id});assert.equal(result.status,'complete');
  assert.equal(env.calls[1].address,media);assert.deepEqual(env.calls[1].init.headers,{});assert.equal(env.calls[1].init.credentials,'include');assert.equal(env.calls[1].init.redirect,'error');
});
test('SharePoint resolver downloads same-host preauthorized file without leaking signed URL',async()=>{
  const env=environment({fetch:async(u)=>u.startsWith(HOST)?Response.json({messages:[{id:'1',messagetype:'Text',properties:{files:[{itemid:'44444444-4444-4444-4444-444444444444',fileName:'Notes.pdf',objectUrl:'https://school.sharepoint.com/sites/class/Notes.pdf'}]}}]}):u.includes('/driveItem/')?Response.json({'@content.downloadUrl':'https://school.sharepoint.com/_layouts/15/download.aspx?tempauth=synthetic-secret',size:20,currentUserRole:{blocksDownload:false}}):new Response('%PDF-1.7\nfixture',{headers:{'content-type':'application/pdf'}})});
  env.localStorage=storage({[key()]:entry(),[key('school.sharepoint.com')]:entry()});const bridge=create(env),message=await run(bridge,{op:'messages',conversationId:CONVERSATION});
  const result=await run(bridge,{op:'attachment',attachmentId:message.result.messages[0].attachments[0].id});assert.equal(result.status,'complete');assert.equal(env.calls.length,3);
  assert.ok(env.calls[1].address.includes('/sites/class/_api/v2.0/sites/root/items/'));assert.equal(env.calls[1].init.headers.Prefer,'getShortLivedDownloadUrl');
  assert.deepEqual(env.calls[2].init.headers,{});assert.equal(env.calls[2].init.credentials,'omit');assert.equal(JSON.stringify(result).includes('synthetic-secret'),false);
});
test('SharePoint download blocks and hostile returned URL fail closed, never raw fallback',async()=>{
  for(const metadata of [{currentUserRole:{blocksDownload:true}},{'@content.downloadUrl':'https://other.sharepoint.com/download?sig=synthetic'}]){
    const env=environment({fetch:async(u)=>u.startsWith(HOST)?Response.json({messages:[{id:'1',messagetype:'Text',properties:{files:[{fileName:'Notes.pdf',objectUrl:'https://school.sharepoint.com/Notes.pdf'}]}}]}):Response.json(metadata)});
    env.localStorage=storage({[key()]:entry(),[key('school.sharepoint.com')]:entry()});const bridge=create(env),message=await run(bridge,{op:'messages',conversationId:CONVERSATION});
    const result=await run(bridge,{op:'attachment',attachmentId:message.result.messages[0].attachments[0].id});assert.match(result.error.code,/FILE_ACCESS_DENIED|SCOPE_DENIED/);assert.equal(env.calls.length,2);
  }
});
test('media authz region maps to only current-user IC3 proxy path; cookies are not added',async()=>{
  const media='https://apac-api.asm.skype.com/v1/objects/fixture/views/imgo';
  const env=environment({fetch:async(u)=>u.includes('/authz')?Response.json({regionGtms:{chatService:HOST},userRegion:'apac'}):u.startsWith(HOST)?Response.json({messages:[{id:'1',messagetype:'Text',content:'<img src="'+media+'">'}]}):new Response(new Uint8Array([137,80,78,71]),{headers:{'content-type':'image/png'}})});
  env.performance.getEntriesByType=()=>[];env.localStorage=storage({[key()]:entry(),[key('api.spaces.skype.com')]:entry()});const bridge=create(env),message=await run(bridge,{op:'messages',conversationId:CONVERSATION});
  const result=await run(bridge,{op:'attachment',attachmentId:message.result.messages[0].attachments[0].id});assert.equal(result.status,'complete');
  assert.equal(env.calls[2].address,'https://as-prod.asyncgw.teams.microsoft.com/v1/'+ACCOUNT+'/objects/fixture/views/imgo?v=1');assert.equal(env.calls[2].init.headers.Authorization,'Bearer '+TOKEN);assert.equal(env.calls[2].init.credentials,'omit');
});
test('HTML masquerading as attachment is rejected and oversized stream is cancelled',async()=>{
  for(const response of [new Response('<html>Sign in</html>',{headers:{'content-type':'application/pdf'}}),new Response(new Uint8Array(1800001),{headers:{'content-type':'application/pdf'}})]){
    const env=environment({fetch:async(u)=>u.startsWith(HOST)?Response.json({messages:[{id:'1',messagetype:'Text',properties:{files:[{fileName:'File.pdf',objectUrl:'https://school.sharepoint.com/File.pdf'}]}}]}):u.includes('/driveItem/')?Response.json({}):response});
    env.localStorage=storage({[key()]:entry(),[key('school.sharepoint.com')]:entry()});const bridge=create(env),message=await run(bridge,{op:'messages',conversationId:CONVERSATION});
    const result=await run(bridge,{op:'attachment',attachmentId:message.result.messages[0].attachments[0].id,maxBytes:1800000});assert.match(result.error.code,/FILE_UNSUPPORTED|RESPONSE_LIMIT/);assert.equal(result.result,null);
  }
});
test('equivalent URL encoding in service backwardLink remains same selected scope',async()=>{
  const next=HOST+'/v1/users/ME/conversations/'+CONVERSATION+'/messages?cursor=page2';
  const env=environment({fetch:async(u,i,n)=>Response.json(n===1?{messages:[{id:'1',messagetype:'Text'}],_metadata:{backwardLink:next}}:{messages:[{id:'2',messagetype:'Text'}]})});
  const result=await run(create(env),{op:'messages',conversationId:CONVERSATION});assert.equal(result.status,'complete');assert.equal(result.result.messages.length,2);
});
test('unrecognized message rows or attachment metadata cannot claim full history',async()=>{
  const env=environment({fetch:async()=>Response.json({messages:[{messagetype:'Text',content:'Missing id'},{id:'1',messagetype:'Text',properties:{files:'not JSON'}}]})});
  const result=await run(create(env),{op:'messages',conversationId:CONVERSATION});assert.equal(result.status,'partial');assert.equal(result.result.historyComplete,false);assert.equal(result.warnings.length,2);
});
test('overall job timeout bounds an unavailable indexedDB promise and permits next job',async()=>{
  const env=environment();env.indexedDB.databases=()=>new Promise(()=>{});const bridge=create(env),job=bridge.start({op:'conversations',timeoutMs:5});
  assert.equal(bridge.start({op:'conversations'}).error.code,'BUSY');await new Promise(r=>setTimeout(r,12));assert.equal(bridge.status(job.jobId).error.code,'TIMEOUT');
  env.indexedDB=fakeDB([]);assert.equal((await run(bridge,{op:'conversations'})).status,'partial');
});
test('12 MiB absolute attachment cap cannot be raised by caller',async()=>{
  const env=environment({fetch:async(u)=>u.startsWith(HOST)?Response.json({messages:[{id:'1',messagetype:'Text',properties:{files:[{fileName:'Huge.pdf',objectUrl:'https://school.sharepoint.com/Huge.pdf'}]}}]}):Response.json({'@content.downloadUrl':'https://school.sharepoint.com/download',size:12*1024*1024+1})});
  env.localStorage=storage({[key()]:entry(),[key('school.sharepoint.com')]:entry()});const bridge=create(env),message=await run(bridge,{op:'messages',conversationId:CONVERSATION});
  const result=await run(bridge,{op:'attachment',attachmentId:message.result.messages[0].attachments[0].id,maxBytes:999999999});assert.equal(result.error.code,'RESPONSE_LIMIT');assert.equal(env.calls.length,2);
});
test('system events are excluded before text or attachment extraction, with only precise IDs and types',async()=>{
  const rows=[
    {id:'system-topic',messagetype:'ThreadActivity/TopicUpdate',content:'{"oldValue":"","newValue":"[{HOMEWORK}]"}'},
    {id:'system-control',messagetype:'Control/Typing',content:'17881689448428:orgid:fixtureTrue'},
    {id:'system-call',messagetype:'Event/Call',content:'<call>HOMEWORK system metadata</call>',properties:{files:[{fileName:'system.pdf',objectUrl:'https://school.sharepoint.com/system.pdf'}]}},
    {id:'user-text',messagetype:'Text',content:'Homework: Read chapter 4.'},
    {id:'user-rich',messagetype:'RichText/Html',content:'<p>Feedback: well done.</p>'},
    {id:'user-file',messagetype:'RichText/Media_GenericFile',properties:{files:[{fileName:'Roster.pdf',objectUrl:'https://school.sharepoint.com/Roster.pdf'}]}}
  ];
  const env=environment({fetch:async()=>Response.json({messages:rows})}),bridge=create(env),result=await run(bridge,{op:'messages',conversationId:CONVERSATION});
  assert.deepEqual(result.result.messages.map(m=>m.nativeID),['user-text','user-rich','user-file']);
  assert.deepEqual(result.result.excludedNativeIDs,[{nativeID:'system-topic',type:'ThreadActivity/TopicUpdate',reason:'system_type'},{nativeID:'system-control',type:'Control/Typing',reason:'system_type'},{nativeID:'system-call',type:'Event/Call',reason:'system_type'}]);
  assert.equal(JSON.stringify(result).includes('oldValue'),false);assert.equal(JSON.stringify(result).includes('17881689448428'),false);
  const attachment=await run(bridge,{op:'attachment',attachmentId:CONVERSATION+'|system-call|0'});assert.equal(attachment.error.code,'SCOPE_DENIED');
});
test('missing/unknown type is not imported; real Text containing system-like text remains untouched',async()=>{
  const rows=[{id:'missing',content:'Homework with absent type'},{id:'unknown',messagetype:'FutureType/Unknown',content:'Not confirmed'},
    {id:'wrong-case-field',messageType:'Text',content:'Wrong schema field'},
    {id:'text',messagetype:'Text',content:'{"oldValue":"","newValue":"HOMEWORK"}',properties:{isDeleted:'False'}}];
  const result=await run(create(environment({fetch:async()=>Response.json({messages:rows})})),{op:'messages',conversationId:CONVERSATION});
  assert.equal(result.status,'partial');assert.deepEqual(result.result.messages.map(m=>m.nativeID),['text']);assert.equal(result.result.messages[0].text,rows[3].content);
  assert.deepEqual(result.result.excludedNativeIDs.map(m=>m.reason),['missing_type','unknown_type','missing_type']);
  for(const excluded of result.result.excludedNativeIDs)assert.deepEqual(Object.keys(excluded).sort(),['nativeID','reason','type']);
});
test('deleted flags and tombstones remove duplicates without treating false as deleted',async()=>{
  const rows=[{id:'later-deleted',messagetype:'Text',content:'Old value'},{id:'later-deleted',messagetype:'Text',deleted:true,content:'Deleted value'},
    {id:'already-deleted',messagetype:'RichText/Html',properties:{isDeleted:'true'},content:'Hidden'},
    {id:'timestamp-deleted',messagetype:'Text',properties:{deletetime:'1788168944842'},content:'Hidden'},
    {id:'safe',messagetype:'Text',properties:{isDeleted:false,deletetime:'0'},content:'Still present'},
    {id:'later-deleted',messagetype:'Text',content:'Historical duplicate'}];
  const result=await run(create(environment({fetch:async()=>Response.json({messages:rows})})),{op:'messages',conversationId:CONVERSATION});
  assert.deepEqual(result.result.messages.map(m=>m.nativeID),['safe']);assert.equal(result.result.excludedNativeIDs.length,3);assert.ok(result.result.excludedNativeIDs.every(m=>m.reason==='deleted'));
});
test('excluded system IDs are deduplicated and capped at 2000 with no content exported',async()=>{
  const rows=Array.from({length:2001},(_,i)=>({id:'event-'+i,messagetype:'ThreadActivity/AddMember',content:'must not export'}));
  rows.unshift(rows[0]);
  const result=await run(create(environment({fetch:async()=>Response.json({messages:rows})})),{op:'messages',conversationId:CONVERSATION});
  assert.equal(result.error.code,'RESPONSE_LIMIT');assert.equal(result.result.excludedNativeIDs.length,2000);assert.equal(result.result.messages.length,0);assert.equal(JSON.stringify(result).includes('must not export'),false);
});
test('in-page injection upgrades a reused v6 singleton and preserves current v7 jobs',()=>{
  const vm=require('node:vm'),fs=require('node:fs'),source=fs.readFileSync(require.resolve('../Resources/teams-api.js'),'utf8');
  const env=environment(),old={version:6};env.CampusDeskTeamsAPI=old;
  const context=vm.createContext({window:env});vm.runInContext(source,context);
  const current=env.CampusDeskTeamsAPI;assert.notEqual(current,old);assert.equal(current.version,7);assert.equal(typeof current.start,'function');
  vm.runInContext(source,context);assert.equal(env.CampusDeskTeamsAPI,current);
});
test('429 Retry-After seconds blocks later jobs in memory, exports only safe retry diagnostics, and expires',async()=>{
  let now=Date.parse('2026-09-20T01:00:00Z');
  const env=environment({fetch:async(u,init,n)=>n===1?new Response('private upstream detail '+TOKEN,{status:429,headers:{'Retry-After':'120'}}):Response.json({messages:[]})});
  env.Date={now:()=>now};const bridge=create(env),first=await run(bridge,{op:'messages',conversationId:CONVERSATION});
  assert.deepEqual(first.error,{code:'HTTP_429',message:first.error.message,service:'teams-chat',httpStatus:429,retryAt:'2026-09-20T01:02:00.000Z',retryAfterMs:120000});
  assert.deepEqual(first.retry,{service:'teams-chat',httpStatus:429,retryAt:first.error.retryAt,retryAfterMs:120000});
  assert.equal(JSON.stringify(first).includes(TOKEN),false);assert.equal(JSON.stringify(first).includes('private upstream'),false);
  now+=1000;const next=await run(bridge,{op:'messages',conversationId:CONVERSATION});assert.equal(next.error.retryAfterMs,119000);assert.equal(env.calls.length,1);
  now+=119000;assert.equal((await run(bridge,{op:'messages',conversationId:CONVERSATION})).status,'complete');assert.equal(env.calls.length,2);
});
test('Retry-After HTTP-date, zero, stale dates, and extreme seconds are bounded',async()=>{
  const now=Date.parse('2026-09-20T01:00:00Z');
  for(const [header,expected] of [['Sun, 20 Sep 2026 01:03:00 GMT',180000],['0',1000],['Sun, 20 Sep 2026 00:00:00 GMT',1000],['999999999999',86400000]]){
    const env=environment({fetch:async()=>new Response('',{status:503,headers:{'Retry-After':header}})});env.Date={now:()=>now};
    const result=await run(create(env),{op:'messages',conversationId:CONVERSATION});assert.equal(result.error.code,'HTTP_503');assert.equal(result.error.httpStatus,503);assert.equal(result.error.retryAfterMs,expected);assert.equal(Date.parse(result.error.retryAt),now+expected);
  }
});
test('missing or invalid Retry-After uses bounded exponential backoff with deterministic jitter',async()=>{
  let now=Date.parse('2026-09-20T01:00:00Z');
  const env=environment({fetch:async()=>new Response('',{status:429,headers:{'Retry-After':'Bearer '+TOKEN}})});env.Date={now:()=>now};env.Math={random:()=>0.5};
  const bridge=create(env),first=await run(bridge,{op:'messages',conversationId:CONVERSATION});assert.equal(first.error.retryAfterMs,33750);assert.equal(JSON.stringify(first).includes(TOKEN),false);
  now+=33750;const second=await run(bridge,{op:'messages',conversationId:CONVERSATION});assert.equal(second.error.retryAfterMs,67500);assert.equal(env.calls.length,2);
  const missing=environment({fetch:async()=>new Response('',{status:503})});missing.Date={now:()=>now};missing.Math={random:()=>0};assert.equal((await run(create(missing),{op:'messages',conversationId:CONVERSATION})).error.retryAfterMs,30000);
});
test('rate limiting during pagination retains already read messages without claiming completeness',async()=>{
  const next=HOST+'/v1/users/ME/conversations/'+encodeURIComponent(CONVERSATION)+'/messages?page=2';
  const env=environment({fetch:async(u,i,n)=>n===1?Response.json({messages:[{id:'kept',messagetype:'Text',content:'Saved'}],_metadata:{backwardLink:next}}):new Response('',{status:429,headers:{'Retry-After':'60'}})});
  const result=await run(create(env),{op:'messages',conversationId:CONVERSATION});assert.equal(result.status,'partial');assert.equal(result.result.messages[0].id,'kept');assert.equal(result.result.historyComplete,false);assert.equal(result.error.service,'teams-chat');assert.equal(result.retry.httpStatus,429);assert.equal(env.calls.length,2);
});
function fileEnvironment(fetchFile,file={}){
  const env=environment({fetch:async(u,init,n)=>u.startsWith(HOST)?Response.json({messages:[{id:'file-message',messagetype:'RichText/Media_GenericFile',properties:{files:[{itemid:'44444444-4444-4444-4444-444444444444',fileName:'Notes.pdf',objectUrl:'https://school.sharepoint.com/sites/class/Notes.pdf',...file}]}}]}):fetchFile(u,init,n)});
  env.localStorage=storage({[key()]:entry(),[key('school.sharepoint.com')]:entry()});return env;
}
async function discoverFile(bridge){const result=await run(bridge,{op:'messages',conversationId:CONVERSATION});return result.result.messages[0].attachments[0];}
test('SharePoint metadata 429/503 never falls back to cookies, even in a later attachment job',async()=>{
  for(const status of [429,503]){
    const env=fileEnvironment(async()=>new Response('not exported',{status,headers:{'Retry-After':'90'}})),bridge=create(env),file=await discoverFile(bridge);
    const first=await run(bridge,{op:'attachment',attachmentId:file.id});assert.equal(first.error.code,'HTTP_'+status);assert.equal(first.error.service,'sharepoint:school.sharepoint.com');assert.equal(env.calls.length,2);assert.ok(env.calls[1].address.includes('/driveItem/'));
    const second=await run(bridge,{op:'attachment',attachmentId:file.id});assert.equal(second.error.code,'HTTP_'+status);assert.equal(env.calls.length,2);
    // Cooldown applies to this service, not the already verified chat service.
    assert.equal((await run(bridge,{op:'messages',conversationId:CONVERSATION})).status,'complete');assert.equal(env.calls.length,3);
  }
});
test('SharePoint download throttling cannot trigger a second cookie download',async()=>{
  const env=fileEnvironment(async(u)=>u.includes('/driveItem/')?Response.json({'@content.downloadUrl':'https://school.sharepoint.com/download?tempauth=secret',eTag:'"file,1"',size:16}):new Response('',{status:429,headers:{'Retry-After':'45'}}));
  const bridge=create(env),file=await discoverFile(bridge),result=await run(bridge,{op:'attachment',attachmentId:file.id});assert.equal(result.error.code,'HTTP_429');assert.equal(result.error.service,'sharepoint:school.sharepoint.com');assert.equal(env.calls.length,3);
  await run(bridge,{op:'attachment',attachmentId:file.id});assert.equal(env.calls.length,3);assert.equal(JSON.stringify(result).includes('tempauth'),false);
});
test('media proxy 429/503 cannot fall back to original cookie host or refetch on next job',async()=>{
  for(const status of [429,503]){
    const media='https://apac-api.asm.skype.com/v1/objects/fixture/views/imgo';
    const env=environment({fetch:async(u)=>u.includes('/authz')?Response.json({regionGtms:{chatService:HOST},userRegion:'apac'}):u.startsWith(HOST)?Response.json({messages:[{id:'media',messagetype:'RichText/Html',content:'<img src="'+media+'">'}]}):new Response('',{status,headers:{'Retry-After':'30'}})});
    env.performance.getEntriesByType=()=>[];env.localStorage=storage({[key()]:entry(),[key('api.spaces.skype.com')]:entry()});const bridge=create(env),file=await discoverFile(bridge);
    const result=await run(bridge,{op:'attachment',attachmentId:file.id});assert.equal(result.error.code,'HTTP_'+status);assert.equal(result.error.service,'teams-media');assert.equal(env.calls.length,3);assert.ok(env.calls[2].address.includes('.asyncgw.teams.microsoft.com/'));
    await run(bridge,{op:'attachment',attachmentId:file.id});assert.equal(env.calls.length,3);
  }
});
test('authz cooldown blocks repeated discovery while non-throttle errors still report their service',async()=>{
  const env=environment({fetch:async()=>new Response('',{status:503,headers:{'Retry-After':'30'}})});env.performance.getEntriesByType=()=>[];env.localStorage=storage({[key('api.spaces.skype.com')]:entry()});
  const bridge=create(env),first=await run(bridge,{op:'messages',conversationId:CONVERSATION});assert.equal(first.error.service,'teams-auth');await run(bridge,{op:'messages',conversationId:CONVERSATION});assert.equal(env.calls.length,1);
  const forbidden=await run(create(environment({fetch:async()=>new Response('',{status:403})})),{op:'messages',conversationId:CONVERSATION});assert.equal(forbidden.error.service,'teams-chat');assert.equal(forbidden.error.httpStatus,403);assert.equal(forbidden.retry,null);assert.equal(forbidden.error.retryAt,undefined);
});
test('fresh SharePoint version permits a metadata-only hit; changed versions redownload',async()=>{
  let etag='"file,1"',downloads=0;
  const env=fileEnvironment(async(u)=>u.includes('/driveItem/')?Response.json({'@content.downloadUrl':'https://school.sharepoint.com/download?tempauth=private',eTag:etag,size:16}):(downloads++,new Response('%PDF-1.7\nfixture',{headers:{'content-type':'application/pdf'}})),{eTag:'"file,old-message"'});
  const bridge=create(env),file=await discoverFile(bridge),first=await run(bridge,{op:'attachment',attachmentId:file.id});assert.equal(downloads,1);assert.match(first.result.versionKey,/^v1:[a-f0-9]{64}$/);assert.notEqual(first.result.versionKey,file.versionKey);
  const hit=await run(bridge,{op:'attachment',attachmentId:file.id,knownVersionKey:first.result.versionKey});assert.deepEqual(hit.result,{accountId:ACCOUNT,attachmentId:file.id,versionKey:first.result.versionKey,notModified:true});assert.equal(downloads,1);assert.equal(env.calls.length,4);
  etag='"file,2"';const changed=await run(bridge,{op:'attachment',attachmentId:file.id,knownVersionKey:first.result.versionKey});assert.equal(downloads,2);assert.notEqual(changed.result.versionKey,first.result.versionKey);assert.equal(changed.result.notModified,undefined);
  assert.equal(JSON.stringify(changed).includes('private'),false);assert.equal(JSON.stringify(changed).includes('file,2'),false);
});
test('message file version is stable across signed URL changes and absent metadata gives no version',async()=>{
  async function hint(file){return (await discoverFile(create(fileEnvironment(async()=>Response.json({}),file)))).versionKey;}
  const one=await hint({eTag:'"same,1"',objectUrl:'https://school.sharepoint.com/a?sig=secret-one'}),two=await hint({eTag:'"same,1"',objectUrl:'https://school.sharepoint.com/b?sig=secret-two'});
  assert.equal(one,two);assert.match(one,/^v1:[a-f0-9]{64}$/);assert.notEqual(one,await hint({eTag:'"same,2"'}));
  assert.equal(await hint({}), '');assert.equal(await hint({modifiedDateTime:'2026-09-20T01:00:00Z'}),'');assert.equal(await hint({eTag:'https://school.sharepoint.com/file?token=secret'}),'');
  assert.equal(await hint({lastModifiedDateTime:'2026-09-20T01:00:00Z',size:16}),await hint({lastModifiedDateTime:'2026-09-20T09:00:00+08:00',size:16}));
  assert.notEqual(await hint({lastModifiedDateTime:'2026-09-20T01:00:00Z',size:16}),await hint({lastModifiedDateTime:'2026-09-20T01:00:00Z',size:17}));
});
test('unknown fresh versions, resolver failure, and inline media never become permanent cache hits',async()=>{
  let metadata=true,downloads=0;
  const env=fileEnvironment(async(u)=>u.includes('/driveItem/')?(metadata?Response.json({'@content.downloadUrl':'https://school.sharepoint.com/download',size:16}):new Response('',{status:403})):(downloads++,new Response('%PDF-1.7\nfixture',{headers:{'content-type':'application/pdf'}})),{eTag:'"message-stale"'});
  const bridge=create(env),file=await discoverFile(bridge);
  for(const knownVersionKey of ['',file.versionKey]){const result=await run(bridge,{op:'attachment',attachmentId:file.id,knownVersionKey});assert.equal(result.result.notModified,undefined);assert.equal(result.result.versionKey,'');}
  metadata=false;const fallback=await run(bridge,{op:'attachment',attachmentId:file.id,knownVersionKey:file.versionKey});assert.equal(fallback.result.versionKey,'');assert.equal(fallback.result.notModified,undefined);assert.equal(downloads,3);
  const mediaEnv=environment({fetch:async(u)=>u.startsWith(HOST)?Response.json({messages:[{id:'picture',messagetype:'RichText/Html',content:'<img src="https://apac-api.asm.skype.com/v1/objects/fixture/views/imgo">'}]}):new Response(new Uint8Array([137,80,78,71]),{headers:{'content-type':'image/png'}})});
  const mediaBridge=create(mediaEnv),media=await discoverFile(mediaBridge),result=await run(mediaBridge,{op:'attachment',attachmentId:media.id,knownVersionKey:file.versionKey});assert.equal(media.versionKey,'');assert.equal(result.result.versionKey,'');assert.equal(result.result.notModified,undefined);
});
test('fresh blocksDownload and oversize checks take precedence over a cached version',async()=>{
  let blocked=false,oversize=false;
  const env=fileEnvironment(async(u)=>u.includes('/driveItem/')?Response.json({'@content.downloadUrl':'https://school.sharepoint.com/download',eTag:'"file,1"',size:oversize?MAX:16,currentUserRole:{blocksDownload:blocked}}):new Response('%PDF-1.7\nfixture',{headers:{'content-type':'application/pdf'}})),MAX=12*1024*1024+1;
  const bridge=create(env),file=await discoverFile(bridge),first=await run(bridge,{op:'attachment',attachmentId:file.id});blocked=true;
  assert.equal((await run(bridge,{op:'attachment',attachmentId:file.id,knownVersionKey:first.result.versionKey})).error.code,'FILE_ACCESS_DENIED');blocked=false;oversize=true;
  assert.equal((await run(bridge,{op:'attachment',attachmentId:file.id,knownVersionKey:first.result.versionKey})).error.code,'RESPONSE_LIMIT');
});
