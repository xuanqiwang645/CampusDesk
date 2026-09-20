'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createRunner,allowedURL}=require('../Resources/teams-auto-runner.js');
function fixture(options={}) {
  let clock=0,state='home',team=null,channel=null,chat=null,hidden=false,navIndex=0,timeline=2;
  const events=[],requests=[],checkpoints=[];
  const teams=options.teamPages || [[{id:'team-1',name:'Example School'}]];
  const channels=options.channels || [{id:'general',name:'General'},{id:'ec',name:'ENGLISH CORNER ROSTER'}];
  const chats=options.chats || [];
  function snap(id,kind) {
    const empty=options.emptyTimeline===true;
    return {source:'teams',coverage:'browser',snapshotId:id,accountId:'account-one',url:'https://teams.cloud.microsoft/',posts:empty?[]:[{id:id+':'+timeline,text:'Example '+timeline,kind:kind||'general',attachments:[]}],tasks:[],grades:[],coverageMetadata:{empty:empty,fullHistory:false}};
  }
  function view() {
    const base={ok:true,code:'NAVIGATION_ONLY',accountId:options.accountChanged && clock>1?'account-two':'account-one',scope:{type:'unknown',id:'',strong:false},teams:[],channels:[],chats:[],sections:[],expandTargets:[],scroll:{available:false},navigationViews:{teams:state==='home',channels:state==='team'||state==='channel',chats:state==='chats'||state==='chat'},navigationScroll:{teams:{available:false},channels:{available:false},chats:{available:false}}};
    if(state==='home') {
      base.teams=teams[navIndex]||[];
      base.navigationScroll.teams={available:teams.length>1,position:navIndex*100,height:teams.length*100,viewport:100};
    }
    if(state==='team'||state==='channel') {
      base.team=team;
      base.channels=options.hidden && !hidden?channels.filter(c=>c.id!=='ec'):channels;
      base.hiddenChannels={available:!!options.hidden,expanded:hidden};
    }
    if(state==='channel') {
      base.scope={type:'channel',id:channel.id,name:channel.name,strong:true,accountId:'account-one'};
      base.snapshot=snap(channel.id,channel.id==='ec'?'ec':'general');
      base.scroll={available:!options.noScroll && !options.emptyTimeline,position:timeline*100,height:300,viewport:100};
      base.code=options.emptyTimeline?'EMPTY_CHANNEL':'OK';
    }
    if(state==='chats'||state==='chat')base.chats=chats;
    if(state==='chat') {
      base.scope={type:'chat',id:chat.id,name:chat.name,strong:true,accountId:'account-one'};base.snapshot=snap(chat.id);
      base.scroll={available:false};base.code='OK';
    }
    return base;
  }
  const host={now:()=>clock*1000,sleep:s=>{clock+=s;},emit:e=>events.push(JSON.parse(JSON.stringify(e))),saveCheckpoint:s=>checkpoints.push(JSON.parse(JSON.stringify(s))),execute:request=>{
    requests.push({...request});
    switch(request.action) {
      case 'inspect':return view();
      case 'openTeams':state='home';navIndex=0;break;
      case 'openTeam':team=(teams.flat().find(t=>t.id===request.teamID));state='team';hidden=false;break;
      case 'revealHiddenChannels':hidden=true;break;
      case 'openChannel':channel=channels.find(c=>c.id===request.channelID);state='channel';timeline=2;break;
      case 'openChats':state='chats';break;
      case 'openChat':chat=chats.find(c=>c.id===request.chatID);state='chat';break;
      case 'scrollNavigation':{
        const before=navIndex;navIndex=Math.max(0,Math.min(teams.length-1,navIndex+(request.direction==='previous'?-1:1)));
        return {...view(),scroll:{atBoundary:navIndex===before}};
      }
      case 'scroll':{
        const before=timeline;
        timeline=options.infiniteHistory?timeline+1:Math.max(0,Math.min(2,timeline+(request.direction==='older'?-1:1)));
        return {...view(),scroll:{...view().scroll,atBoundary:timeline===before}};
      }
      default:throw new Error('Unmodeled action '+request.action);
    }
    return view();
  }};
  return {host,events,requests,checkpoints,elapsed:()=>clock,view};
}
function execute(options={},config={}) {
  const f=fixture(options);const result=createRunner({maxSeconds:60,maxScopeSeconds:10,maxScrollSteps:12,...config},f.host).start();return {...f,result};
}
test('empty identified team and chat lists finish quickly with explicit empty discovery',()=>{
  const f=execute({teamPages:[[]],chats:[]});
  assert.equal(f.result.counts.teams,0);assert.equal(f.result.counts.chats,0);assert.equal(f.result.counts.errors,0);
  assert.ok(f.elapsed()<2);
  assert.equal(f.events.filter(e=>e.type==='done').length,1);
  assert.ok(f.result.coverageItems.every(item=>item.reason==='empty_rendered_list'));
  assert.equal(f.result.historyComplete,false);
});
test('hidden-channel reveal uses the real adapter protocol and EC focus skips unrelated scopes',()=>{
  const f=execute({hidden:true},{focus:'ec'});
  assert.ok(f.requests.some(r=>r.action==='revealHiddenChannels'));
  assert.equal(f.requests.some(r=>r.action==='revealChannels'),false);
  assert.deepEqual(f.requests.filter(r=>r.action==='openChannel').map(r=>r.channelID),['ec']);
  assert.equal(f.requests.some(r=>r.action==='openChats'),false);
  assert.equal(f.result.counts.ec,3);
  assert.equal(f.result.counts.channelsRead,1);
  assert.ok(f.result.warnings.some(w=>w.includes('EC 专项')));
});
test('virtualized team discovery merges both directions and re-renders each target before opening',()=>{
  const f=execute({teamPages:[[{id:'t1',name:'One'}],[{id:'t2',name:'Two'}],[{id:'t3',name:'Three'}]],channels:[]},{includeChats:false});
  assert.equal(f.result.counts.teams,3);
  assert.deepEqual(f.requests.filter(r=>r.action==='openTeam').map(r=>r.teamID),['t1','t2','t3']);
  assert.ok(f.requests.some(r=>r.action==='scrollNavigation'&&r.direction==='previous'));
  assert.ok(f.requests.some(r=>r.action==='scrollNavigation'&&r.direction==='next'));
  assert.equal(f.result.errorCode,undefined);
});
test('history loads both directions, deduplicates snapshots, and never equates the UI boundary with full history',()=>{
  const f=execute({channels:[{id:'general',name:'General'}]},{includeChats:false});
  assert.equal(f.result.counts.messages,3);
  assert.equal(f.events.filter(e=>e.type==='snapshot').length,3);
  const record=f.result.coverageItems.find(i=>i.kind==='channel');
  assert.equal(record.read,3);assert.equal(record.historyComplete,false);
  assert.ok(record.stopReasons.includes('older_rendered_boundary'));
  assert.ok(record.stopReasons.includes('newer_rendered_boundary'));
  assert.ok(f.requests.filter(r=>r.action==='scroll').every(r=>r.expectedScope.id==='general'));
});
test('an explicit empty channel publishes its empty snapshot without pointless scrolling',()=>{
  const f=execute({channels:[{id:'general',name:'General'}],emptyTimeline:true},{includeChats:false});
  assert.equal(f.result.counts.channelsRead,1);assert.equal(f.result.counts.messages,0);
  assert.equal(f.requests.some(r=>r.action==='scroll'),false);
  assert.equal(f.events.filter(e=>e.type==='snapshot').length,1);
  assert.ok(f.result.coverageItems.find(i=>i.kind==='channel').stopReasons.includes('explicit_empty_state'));
});
test('a growing timeline is bounded per scope and records its actual stop condition',()=>{
  const f=execute({channels:[{id:'general',name:'General'}],infiniteHistory:true},{includeChats:false,maxScopeSeconds:2,maxScrollSteps:60});
  assert.ok(f.elapsed()<5);
  assert.ok(f.result.coverageItems.find(i=>i.kind==='channel').stopReasons.includes('scope_time_limit'));
  assert.equal(f.result.errorCode,undefined);
});
test('global time limit emits one done and does not promise unimplemented cursor continuation',()=>{
  const f=execute({infiniteHistory:true},{maxSeconds:5,maxScopeSeconds:90,maxScrollSteps:60});
  assert.equal(f.result.errorCode,'TIME_LIMIT');
  assert.equal(f.events.filter(e=>e.type==='done').length,1);
  assert.equal(f.result.checkpoint.resumableHistory,false);
  const saved=f.checkpoints.at(-1);
  assert.equal(saved.lastRun.historyCursor,null);
  assert.equal(saved.lastRun.reason,'TIME_LIMIT');
  assert.match(f.result.message,/不保证从历史断点续传/);
});
test('API capture hook publishes through the same protocol and avoids DOM history when handled',()=>{
  const f=fixture({channels:[{id:'ec',name:'English Corner'}]});
  f.host.captureHook=context=>{
    assert.equal(context.scope.id,'ec');assert.equal(typeof context.deadline,'function');
    context.publish({source:'teams',coverage:'browser',posts:[{id:'api-message',kind:'ec',text:'Example',attachments:[]}],tasks:[],grades:[],coverageMetadata:{}},context.item);
    return {handled:true,read:1,status:'partial',reason:'API page returned',historyComplete:false};
  };
  const result=createRunner({focus:'ec'},f.host).start();
  assert.equal(result.counts.ec,1);assert.equal(result.counts.channelsRead,1);
  assert.equal(f.requests.some(r=>r.action==='scroll'),false);
  assert.equal(f.events.filter(e=>e.type==='snapshot').length,1);
});
test('API hook declining a scope falls back to DOM and preserves unread boundaries',()=>{
  const f=fixture({channels:[{id:'ec',name:'English Corner'}],noScroll:true});f.host.captureHook=()=>false;
  const result=createRunner({focus:'ec'},f.host).start();
  assert.equal(result.counts.ec,1);assert.equal(result.counts.channelsRead,1);
  assert.ok(result.coverageItems.find(i=>i.kind==='channel').stopReasons.includes('no_rendered_scroll_container'));
});
test('handled index hook publishes and saves coverage without any DOM navigation',()=>{
  const f=fixture();
  f.host.indexHook=context=>{
    assert.equal(context.identity,'account-one');
    context.publish({source:'teams',coverage:'browser',snapshotId:'indexed-ec',posts:[{id:'index-message',kind:'ec',text:'EC roster',attachments:[]}],tasks:[],grades:[],coverageMetadata:{}},context.item);
    context.counts.channelsRead=1;
    context.recordCoverage({kind:'channel',id:'ec',label:'English Corner',status:'partial',read:1,historyComplete:false,reason:'confirmed index'});
    return {handled:true};
  };
  const result=createRunner({focus:'ec'},f.host).start();
  assert.equal(result.counts.ec,1);assert.equal(result.counts.channelsRead,1);
  assert.equal(f.requests.some(r=>r.action!=='inspect'),false);
  assert.equal(f.events.filter(e=>e.type==='snapshot').length,1);
  assert.equal(f.events.filter(e=>e.type==='done').length,1);
  assert.equal(f.checkpoints.at(-1).lastRun.reason,'finished_index');
  assert.equal(f.checkpoints.at(-1).lastRun.completedScopes[0].id,'ec');
  assert.equal(result.historyComplete,false);
  assert.ok(result.warnings.some(w=>w.includes('不能视为账号全量数据')));
});
test('account switch halts instead of combining two accounts in one report',()=>{
  const f=execute({accountChanged:true});
  assert.equal(f.result.errorCode,'account_changed');
  assert.equal(f.events.filter(e=>e.type==='done').length,1);
});
test('native URL gate rejects impostors and encoded credential parameters',()=>{
  assert.equal(allowedURL('https://teams.cloud.microsoft/'),true);
  assert.equal(allowedURL('https://teams.microsoft.com/v2/'),true);
  for(const value of ['https://teams.cloud.microsoft.evil.invalid/','http://teams.cloud.microsoft/','https://user:password@teams.cloud.microsoft/','https://teams.cloud.microsoft/?%74oken=SECRET','https://teams.cloud.microsoft/#/chat?access_token=SECRET'])assert.equal(allowedURL(value),false);
});
test('a persisted account-scoped cooldown blocks API and DOM navigation after restart',()=>{
  const f=fixture();f.host.session={apiCooldown:{accountId:'account-one',service:'teams-chat',retryAt:'1970-01-01T00:02:00Z'}};
  f.host.indexHook=()=>{throw new Error('must not request while cooling down');};
  const result=createRunner({},f.host).start();
  assert.equal(result.phase,'waiting');assert.equal(result.errorCode,'RATE_LIMITED');
  assert.equal(f.requests.some(r=>r.action!=='inspect'),false);
  assert.equal(f.checkpoints.at(-1).apiCooldown.retryAt,'1970-01-01T00:02:00Z');
});
test('expired or foreign-account cooldown does not block the newly confirmed account',()=>{
  for(const cooldown of [{accountId:'account-one',retryAt:'1969-12-31T23:59:00Z'},{accountId:'account-two',retryAt:'1970-01-01T00:02:00Z'}]) {
    const f=fixture();f.host.session={apiCooldown:cooldown};let called=false;f.host.indexHook=()=>{called=true;return {handled:true};};
    createRunner({},f.host).start();assert.equal(called,true);assert.equal(f.checkpoints.at(-1).apiCooldown,undefined);
  }
});
test('an API cooldown is saved across runs without trying DOM fallback',()=>{
  const f=fixture();f.host.indexHook=context=>{
    context.setCooldown({accountId:context.identity,service:'teams-chat',retryAt:'1970-01-01T00:02:00Z'});
    const error=new Error('cooling down');error.code='RATE_LIMITED';throw error;
  };
  const result=createRunner({},f.host).start();
  assert.equal(result.phase,'waiting');assert.equal(f.requests.some(r=>r.action!=='inspect'),false);
  assert.equal(f.checkpoints.at(-1).lastRun.reason,'RATE_LIMITED');
});
