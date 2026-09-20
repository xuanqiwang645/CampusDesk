'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const bridge=require('../Resources/teams-browser.js');
const bridgeSource=fs.readFileSync(require.resolve('../Resources/teams-browser.js'),'utf8');
const home='https://teams.microsoft.com/v2/';
const ec='https://teams.microsoft.com/l/channel/example/EC?tenantId=example';
const work='https://teams.microsoft.com/l/channel/example/HOMEWORK?tenantId=example';
const exampleSnapshot={source:'teams',url:home,capturedAt:'2026-09-19T12:00:00Z',loginRequired:false,parseError:false,coverage:'visible',tasks:[],posts:[{id:'teams:example',kind:'ec',title:'Example',text:'Example roster'}],warnings:[]};
const extractor='window.CampusTeams={extract:function(options){window.receivedOptions=options;var s=JSON.parse(JSON.stringify(window.testSnapshot));s.url=location.href;return s;}};';
function tab(url,extra={}){
  const state={reads:0,titleReads:0,executes:0,options:null};
  const object={
    url(){state.reads++;return typeof url==='function'?url(state.reads):url;},
    title(){state.titleReads++;return extra.title || 'Example Teams channel';},
    execute({javascript}){
      state.executes++;
      if(extra.error)throw extra.error;
      if(extra.raw!==undefined)return extra.raw;
      const context={URL,location:{href:extra.actualURL || (typeof url==='function'?url(state.reads):url)},testSnapshot:extra.snapshot || exampleSnapshot};
      context.window=context;
      const output=vm.runInNewContext(javascript,context);
      state.options=context.receivedOptions;
      return output;
    },state
  };
  return object;
}
function invoke(input,windows,extra={}){
  const seen={factory:0,running:0,windows:0,name:null};
  const context={Application(name){
    seen.factory++;seen.name=name;
    return {running(){seen.running++;return extra.running!==false;},windows(){seen.windows++;if(extra.error)throw extra.error;return windows;}};
  }};
  vm.runInNewContext(bridgeSource,context);
  const output=JSON.parse(context.run([JSON.stringify(input)]));
  return {output,seen};
}
const input=(operation='capture',overrides={})=>Object.assign({operation,browser:'chrome',pages:[],extractor},overrides);
const windowFor=(active,tabs=[active])=>({activeTab:()=>active,tabs:()=>tabs});
test('pin reads only active Teams URL/title and executes no browser JavaScript',()=>{
  const active=tab(ec),other=tab('https://other.example/');
  const {output,seen}=invoke(input('pin'),[windowFor(active,[active,other])]);
  assert.equal(output.ok,true);assert.equal(output.page.url,ec);assert.equal(output.page.kind,'auto');
  assert.equal(active.state.executes,0);assert.equal(other.state.reads,0);assert.equal(other.state.titleReads,0);
  assert.equal(seen.name,'Google Chrome');
});
test('valid Edge input selects only Microsoft Edge',()=>{
  const {output,seen}=invoke(input('pin',{browser:'edge'}),[windowFor(tab(ec))]);
  assert.equal(output.ok,true);assert.equal(seen.name,'Microsoft Edge');
});
test('not running never asks for windows and never launches the browser',()=>{
  const {output,seen}=invoke(input(),[],{running:false});
  assert.equal(output.code,'NOT_RUNNING');assert.equal(seen.running,1);assert.equal(seen.windows,0);
});
test('missing windows and foreign active tab stop without reading another tab',()=>{
  assert.equal(invoke(input(),[]).output.code,'NO_WINDOW');
  const active=tab('https://other.example/'),teams=tab(ec);
  const {output}=invoke(input(),[windowFor(active,[active,teams])]);
  assert.equal(output.code,'NOT_TEAMS');assert.equal(teams.state.reads,0);assert.equal(active.state.executes,0);
});
test('browser automation denial maps to bounded guidance without raw error details',()=>{
  const error=Object.assign(new Error('Not authorized -1743 secret private URL'),{errorNumber:-1743});
  const {output}=invoke(input(),[],{error});
  assert.equal(output.code,'AUTOMATION_DENIED');assert.ok(output.message.includes('自动化'));
  assert.equal(JSON.stringify(output).includes('secret'),false);
});
test('JavaScript disabled maps to manual permission guidance, never changes browser settings',()=>{
  const active=tab(ec,{error:new Error('Executing JavaScript through AppleScript is turned off. SECRET')});
  const {output}=invoke(input(),[windowFor(active)]);
  assert.equal(output.code,'JAVASCRIPT_DISABLED');assert.equal(active.state.executes,1);
  assert.equal(JSON.stringify(output).includes('SECRET'),false);
});
test('capture uses active page metadata and saved kind/label on exact route match',()=>{
  const active=tab(ec),page={url:ec,kind:'ec',label:'Example EC'};
  const {output}=invoke(input('capture',{pages:[page]}),[windowFor(active)]);
  assert.equal(output.ok,true);assert.equal(output.page.kind,'ec');
  assert.equal(output.snapshots[0].url,ec);assert.equal(output.snapshots[0].browser,'chrome');
  assert.equal(output.snapshots[0].captureMethod,'browser-apple-events');
  assert.equal(active.state.options.kind,'ec');assert.equal(active.state.options.label,'Example EC');
});
test('selectionOnly is forwarded as boolean and no webpage navigation occurs',()=>{
  const active=tab(ec);
  const {output}=invoke(input('capture',{selectionOnly:true}),[windowFor(active)]);
  assert.equal(output.ok,true);assert.equal(active.state.options.selectionOnly,true);
});
test('URL change before execute is rejected without any DOM extraction',()=>{
  const active=tab(n=>n===1?ec:work);
  const {output}=invoke(input(),[windowFor(active)]);
  assert.equal(output.code,'ROUTE_CHANGED');assert.equal(active.state.executes,0);
});
test('injected TOCTOU guard rejects URL changes before evaluating extractor',()=>{
  const active=tab(ec,{actualURL:'https://other.example/'});
  const {output}=invoke(input(),[windowFor(active)]);
  assert.equal(output.code,'ROUTE_CHANGED');assert.equal(active.state.options,undefined);
});
test('injected guard rejects route change on same Teams host',()=>{
  const active=tab(ec,{actualURL:work});
  assert.equal(invoke(input(),[windowFor(active)]).output.code,'ROUTE_CHANGED');
});
test('sync extracts only existing tabs matching saved routes, skips missing tabs',()=>{
  const foreign=tab('https://other.example/'),approved=tab(ec),unapproved=tab(work);
  const pages=[{url:ec,kind:'ec',label:'EC'},{url:'https://teams.microsoft.com/l/channel/other/Absent',kind:'auto',label:'Absent'}];
  const {output}=invoke(input('sync',{pages}),[windowFor(foreign,[foreign,approved,unapproved])]);
  assert.equal(output.ok,true);assert.equal(output.snapshots.length,1);assert.equal(approved.state.executes,1);
  assert.equal(foreign.state.executes,0);assert.equal(unapproved.state.executes,0);
  assert.equal(foreign.state.titleReads,0);assert.equal(unapproved.state.titleReads,0);
  assert.equal(output.skipped.length,1);assert.equal(output.skipped[0].code,'TAB_NOT_OPEN');
});
test('route equivalence allows two Teams hosts but not changed path query or fragment',()=>{
  assert.equal(bridge.matchRoute(ec,ec.replace('teams.microsoft.com','teams.cloud.microsoft')),true);
  assert.equal(bridge.matchRoute(ec,ec+'&groupId=other'),false);
  assert.equal(bridge.matchRoute(ec,ec+'#other'),false);
  const approved=tab(ec.replace('teams.microsoft.com','teams.cloud.microsoft'));
  assert.equal(invoke(input('sync',{pages:[{url:ec,kind:'ec'}]}),[windowFor(approved)]).output.ok,true);
});
test('deep-link contexts, encoded channel slash and SPA hash queries retain the approved exact route',()=>{
  const urls=[
    'https://teams.microsoft.com/v2/?context=%7B%22channelId%22%3A%22example%22%7D#/conversations/example?ctx=channel&threadId=example',
    'https://teams.microsoft.com/l/channel/example/English%2FDiscussion?context=example'
  ];
  for(const url of urls){
    assert.equal(bridge.safeURL(url).url,url);
    const approved=tab(url),output=invoke(input('sync',{pages:[{url,kind:'ec'}]}),[windowFor(approved)]).output;
    assert.equal(output.ok,true);assert.equal(output.snapshots[0].url,url);
    assert.equal(bridge.matchRoute(url,url+'&contextChanged=yes'),false);
  }
  assert.equal(bridge.safeURL('https://teams.microsoft.com/v2/#/conversations/example?%74oken=SECRET'),null);
});
test('unsupported or login snapshots report unavailable without inventing successful connection',()=>{
  for(const patch of [{parseError:true,warnings:['Unsupported browser']},{loginRequired:true}]){
    const active=tab(ec,{snapshot:Object.assign({},exampleSnapshot,patch)});
    const {output}=invoke(input(),[windowFor(active)]);
    assert.equal(output.ok,false);assert.equal(output.code,'PAGE_UNAVAILABLE');assert.equal(output.snapshots.length,1);
  }
});
test('invalid extraction output and oversized output are bounded errors',()=>{
  for(const raw of ['not json','null','x'.repeat(1000001),JSON.stringify({snapshot:{source:'evil',url:ec,tasks:[],posts:[],warnings:[]}})]){
    const {output}=invoke(input(),[windowFor(tab(ec,{raw}))]);
    assert.equal(output.code,'INVALID_SNAPSHOT');assert.equal(output.snapshots.length,0);
  }
});
test('total output limit keeps prior snapshots and stops before further tabs are executed',()=>{
  const snapshot=Object.assign({},exampleSnapshot,{posts:Array.from({length:100},(_,i)=>({id:'teams:'+i,kind:'general',title:'Example',text:'x'.repeat(7000)}))});
  const tabs=Array.from({length:4},(_,i)=>tab(home+'?channelId='+i,{snapshot}));
  const pages=tabs.map((_,i)=>({url:home+'?channelId='+i,kind:'auto',label:'Example '+i}));
  const {output}=invoke(input('sync',{pages}),[windowFor(tabs[0],tabs)]);
  assert.equal(output.code,'OUTPUT_LIMIT');assert.equal(output.snapshots.length,2);
  assert.equal(tabs[3].state.executes,0);
});
test('malformed and oversize input does not touch Application',()=>{
  let calls=0;
  for(const argv of [[],['{'],['x'.repeat(250001)],['{}','{}']]){
    const output=JSON.parse(bridge.runInput(argv,()=>{calls++;throw Error('no');}));
    assert.equal(output.code,'INVALID_INPUT');
  }
  for(const patch of [{browser:'Safari'},{operation:'navigate'},{pages:Array.from({length:21},()=>({url:ec}))},{extractor:'x'.repeat(150001)},{pages:[{url:'https://other.example/'}]}]){
    const output=bridge.perform(input('capture',patch),()=>{calls++;throw Error('no');});
    assert.equal(output.code,'INVALID_INPUT');
  }
  assert.equal(calls,0);
});
test('credential and authentication URLs are rejected without ever appearing in output',()=>{
  for(const raw of ['https://user:SECRET@teams.microsoft.com/','https://teams.microsoft.com/?access_token=SECRET','https://teams.microsoft.com/#access_token=SECRET','https://teams.microsoft.com.evil.example/','http://teams.microsoft.com/','https://teams.microsoft.com:8443/']){
    assert.equal(bridge.safeURL(raw),null);
    const output=invoke(input('pin'),[windowFor(tab(raw))]).output;
    assert.equal(output.code,'NOT_TEAMS');assert.equal(JSON.stringify(output).includes('SECRET'),false);
  }
});
test('labels are treated as data even when containing quotes or JavaScript text',()=>{
  const label='EC "}; throw new Error("unexpected"); //';
  const active=tab(ec);
  const {output}=invoke(input('capture',{pages:[{url:ec,kind:'ec',label}]}),[windowFor(active)]);
  assert.equal(output.ok,true);assert.equal(active.state.options.label,label);
});
test('sync with no matching open page returns a truthful incomplete status',()=>{
  const active=tab('https://other.example/');
  const {output}=invoke(input('sync',{pages:[{url:ec,kind:'ec',label:'EC'}]}),[windowFor(active)]);
  assert.equal(output.ok,false);assert.equal(output.code,'NO_MATCHING_TABS');assert.equal(active.state.executes,0);
});
test('ambiguous Teams shell URLs cannot be pinned or automatically synchronized, but explicit capture is allowed',()=>{
  for(const url of ['https://teams.microsoft.com/',home,home+'?culture=en-US',home+'#/chat']){
    const active=tab(url);
    assert.equal(invoke(input('pin'),[windowFor(active)]).output.code,'AMBIGUOUS_ROUTE');
    const sync=invoke(input('sync',{pages:[{url,label:'Generic shell',kind:'auto'}]}),[windowFor(active)]).output;
    assert.equal(sync.code,'AMBIGUOUS_ROUTE');assert.equal(active.state.executes,0);
    assert.equal(sync.skipped[0].code,'AMBIGUOUS_ROUTE');
    assert.equal(invoke(input('capture'),[windowFor(active)]).output.ok,true);
    assert.equal(active.state.executes,1);
  }
});
test('specific channel/message routes and explicit channel IDs are eligible; generic saved pages are skipped in mixed sync',()=>{
  for(const url of [ec,'https://teams.microsoft.com/l/message/example/123',home+'#/channels/example',home+'#/conversations/example',home+'?channelId=example']){
    assert.equal(bridge.hasSpecificRoute(url),true);
    assert.equal(invoke(input('pin'),[windowFor(tab(url))]).output.ok,true);
  }
  const generic=tab(home),specific=tab(ec);
  const output=invoke(input('sync',{pages:[{url:home,label:'Generic',kind:'auto'},{url:ec,label:'EC',kind:'ec'}]}),[windowFor(generic,[generic,specific])]).output;
  assert.equal(output.ok,true);assert.equal(output.snapshots.length,1);
  assert.equal(generic.state.executes,0);assert.equal(specific.state.executes,1);
  assert.equal(output.skipped[0].code,'AMBIGUOUS_ROUTE');
});
