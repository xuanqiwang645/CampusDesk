/* Native JXA driver for the inspected Teams DOM adapter. Streams checkpoints
   as NDJSON to CampusDesk; it never sends messages, changes coursework or reads
   browser credential stores. The renderer handles authentication itself. */
function createDOMRunner(config, host) {
  var now=host.now || Date.now, delay=host.sleep, identity = '', started = now(), last = null;
  var focus=config.focus==='ec' || config.ecOnly===true ? 'ec' : 'all';
  var limits={seconds:bounded(config.maxSeconds,240,5,1200),scopeSeconds:bounded(config.maxScopeSeconds,20,2,90),scrollSteps:bounded(config.maxScrollSteps,12,1,60),navigationSteps:bounded(config.maxNavigationSteps,16,1,80),navigationSeconds:bounded(config.maxNavigationSeconds,15,2,60),waitSeconds:bounded(config.navigationWaitSeconds,8,0.2,20)};
  var counts = {teams:0,channels:0,channelsRead:0,chats:0,chatsRead:0,messages:0,assignments:0,grades:0,ec:0,attachments:0,attachmentsRead:0,errors:0};
  var seenMessages = {}, seenTasks = {}, seenGrades={}, seenAttachments = {}, warnings = [], coverage = [], session = host.session || {}, completedScopes=[],timings={};
  function bounded(value,fallback,min,max) {value=Number(value);return Math.max(min,Math.min(max,Number.isFinite(value)&&value>0?value:fallback));}
  function ecName(value) {return /\bEnglish\s+Corner\b|\bEC(?:\s+(?:roster|list|announcement))?\b|英语角/i.test(String(value || ''));}
  function emit(value) { host.emit(value); }
  function status(phase,message,running) {
    return {running:running!==false,phase:phase,message:message,counts:counts,coverage:'partial',coverageItems:coverage.slice(-500),warnings:warnings.slice(-30),accountId:identity,updatedAt:new Date(now()).toISOString(),historyComplete:false,focus:focus,checkpoint:{mode:'results_and_tab_only',resumableHistory:false},limits:limits,timings:timings,elapsedMs:Math.max(0,now()-started),retry:session.apiCooldown && session.apiCooldown.accountId===identity?session.apiCooldown:null};
  }
  function progress(phase,message) { emit({type:'progress',status:status(phase,message,true)}); }
  function warn(value) { if (warnings.indexOf(value)<0) warnings.push(value); }
  function setCooldown(value) {session.apiCooldown=value;saveSession('RATE_LIMITED');}
  function getAttachmentCursor(scope) {
    var progress=session.attachmentProgress;
    return progress && progress.accountId===identity && progress.scopes && typeof progress.scopes[scope]==='string'?progress.scopes[scope]:'';
  }
  function saveAttachmentCursor(scope,file) {
    if(typeof scope!=='string' || !/^19:[A-Za-z0-9_.:@-]{1,300}$/.test(scope) || typeof file!=='string' || file.length>300)return;
    if(!session.attachmentProgress || session.attachmentProgress.accountId!==identity)session.attachmentProgress={accountId:identity,scopes:{}};
    var scopes=session.attachmentProgress.scopes || (session.attachmentProgress.scopes={});
    if(!Object.prototype.hasOwnProperty.call(scopes,scope) && Object.keys(scopes).length>=500)delete scopes[Object.keys(scopes)[0]];
    scopes[scope]=file;saveSession('attachment_progress');
  }
  function fault(code,message) { var e=new Error(message); e.code=code; throw e; }
  function saveSession(reason) {
    if (!host.saveCheckpoint) return;
    try {
      session.accountId=identity; session.updatedAt=new Date(now()).toISOString();session.version=2;
      session.lastRun={focus:focus,startedAt:new Date(started).toISOString(),updatedAt:session.updatedAt,reason:reason || 'running',counts:counts,completedScopes:completedScopes.slice(-500),historyCursor:null,resumableHistory:false};
      host.saveCheckpoint(session);
    } catch (_) {}
  }
  function deadline() { if (now()-started>=limits.seconds*1000) fault('TIME_LIMIT','本轮已达到时间上限，已读取内容已保存；尚未读取的范围仍待核验。下一轮会重新发现页面，不保证从历史断点续传。'); }
  function call(request) {
    deadline();
    var value=host.execute(request);
    if(!value || typeof value!=='object')fault('INVALID_RESULT','Teams 返回了无法识别的结果。');
    if (value.accountId) {
      if (identity && identity!==value.accountId) fault('account_changed','Teams 账号在同步中发生变化，已停止本轮；请重新同步。');
      if (!identity) { identity=value.accountId; saveSession(); progress('connected','已连接 Teams，正在核对账号可见范围。'); }
    } else if (identity && (value.code==='LOGIN_REQUIRED' || value.code==='NOT_TEAMS')) fault('NEED_LOGIN','Teams 登录状态已失效，请在浏览器重新登录。');
    last=value;
    return value;
  }
  function inspect() { return call({action:'inspect'}); }
  function waitFor(predicate,seconds,initial) {
    var end=now()+(seconds==null?limits.waitSeconds:seconds)*1000, value=initial || inspect();
    while(!predicate(value) && now()<end){delay(0.35);value=inspect();}
    return value;
  }
  function navigate(request,predicate) {
    var reply=call(request);
    if(!reply.ok) return reply;
    // DOM navigation resolves asynchronously; require the target identity twice
    // and allow its content to mount before returning any snapshot.
    var value=waitFor(predicate,limits.waitSeconds);
    if (!predicate(value)) return {ok:false,code:'NAVIGATION_TIMEOUT'};
    delay(0.3); value=inspect();
    return predicate(value) ? value : {ok:false,code:'SCOPE_CHANGED'};
  }
  function publish(snapshot,item) {
    if(!snapshot) return;
    snapshot.accountId=identity;
    snapshot.coverageMetadata=Object.assign({},snapshot.coverageMetadata,{discovered:1,read:1,unread:0,errors:0,historyComplete:false,status:'partial',reason:'已读取加载内容；历史边界及全部回复尚未证实。'});
    (snapshot.posts||[]).forEach(function(p){if(!seenMessages[p.id]){seenMessages[p.id]=true;counts.messages++;if(p.kind==='ec')counts.ec++;} (p.attachments||[]).forEach(function(a){var key=p.id+'|'+a.id;if(!seenAttachments[key]){seenAttachments[key]=true;counts.attachments++;}});});
    (snapshot.tasks||[]).forEach(function(t){if(!seenTasks[t.id]){seenTasks[t.id]=true;counts.assignments++;}});
    (snapshot.grades||[]).forEach(function(g){if(!seenGrades[g.id]){seenGrades[g.id]=true;counts.grades++;}});
    emit({type:'snapshot',snapshot:snapshot});
  }
  function captureTimeline(value,item) {
    if(value && value.ok && value.scope && value.scope.strong && host.captureHook) {
      var beforeCount=counts.messages, hook=host.captureHook({value:value,item:item,scope:value.scope,config:config,identity:identity,counts:counts,timings:timings,setCooldown:setCooldown,getAttachmentCursor:getAttachmentCursor,saveAttachmentCursor:saveAttachmentCursor,pageEval:host.pageEval,readResource:host.readResource,emit:emit,publish:publish,deadline:deadline,progress:progress,sleep:delay,now:now,warn:warn});
      if(hook===true || hook && hook.handled) {
        item.status=hook.status || 'partial';item.read=Number.isFinite(hook.read)?hook.read:counts.messages-beforeCount;item.reason=hook.reason || '已读取 API 返回范围；完整历史状态见覆盖记录。';item.historyComplete=hook.historyComplete===true;item.stopReasons=hook.stopReasons || [];
        coverage.push(item);completedScopes.push({id:value.scope.id,type:value.scope.type,read:item.read,historyComplete:item.historyComplete});
        if(value.scope.type==='channel')counts.channelsRead++;else if(value.scope.type==='chat')counts.chatsRead++;
        saveSession();progress('reading','已读取 '+item.label+'：'+item.read+' 条消息。');return;
      }
    }
    if(value && value.ok && value.scope && value.scope.strong && !value.snapshot) {
      var pendingScope=value.scope;
      value=waitFor(function(v){return !v.scope || v.scope.id!==pendingScope.id || !!v.snapshot || v.platformError;},Math.min(3,limits.waitSeconds),value);
    }
    if(!value || !value.ok || !value.scope || !value.scope.strong || !value.snapshot) {
      counts.errors++; item.status='unread'; item.reason=value && value.code || 'CONTENT_NOT_LOADED'; coverage.push(item); saveSession(); return;
    }
    var scope=value.scope, scopeStarted=now(), seenExpansions={}, directions=['older','newer'], stable=0, steps=0, snapshotKeys={}, lastSignature='', published={},stopReasons=[],replyCount=0;
    function capture(v) {
      if(!v.scope || v.scope.id!==scope.id || v.scope.type!==scope.type) fault('SCOPE_CHANGED','同步页面被切换，已保存之前内容；请保留同步标签供 CampusDesk 使用。');
      if(v.snapshot) {
        var contentSignature=JSON.stringify([v.snapshot.posts||[],v.snapshot.tasks||[],v.snapshot.grades||[]]);
        if(!published[contentSignature]){published[contentSignature]=true;publish(v.snapshot,item);}
        (v.snapshot.posts||[]).forEach(function(p){snapshotKeys[p.id]=true;});
      }
      replyCount=Math.max(replyCount,(v.expandTargets||[]).filter(function(t){return t.kind==='replies';}).length);
    }
    capture(value);
    if(value.snapshot.coverageMetadata && value.snapshot.coverageMetadata.empty)stopReasons.push('explicit_empty_state');
    else for(var d=0;d<directions.length;d++) {
      stable=0;lastSignature='';
      for(var n=0;n<limits.scrollSteps;n++) {
        if(now()-scopeStarted>=limits.scopeSeconds*1000){stopReasons.push('scope_time_limit');break;}
        var targets=(value.expandTargets||[]).filter(function(t){return t.kind==='text'&&!seenExpansions[t.id];}).slice(0,8);
        for(var e=0;e<targets.length;e++) {
          seenExpansions[targets[e].id]=true;
          var expanded=call({action:'expand',expectedScope:scope,expansionID:targets[e].id,maxClicks:1}); if(!expanded.ok){stopReasons.push(expanded.code);break;} delay(0.15);
        }
        if(targets.length){value=inspect();capture(value);}
        var count=Object.keys(snapshotKeys).length;
        if(!value.scroll || !value.scroll.available){stopReasons.push('no_rendered_scroll_container');break;}
        var moved=call({action:'scroll',expectedScope:scope,direction:directions[d]});
        if(!moved.ok) {stopReasons.push(moved.code);break;}
        delay(0.5); value=inspect(); capture(value); steps++;
        var signature=JSON.stringify([value.scroll && value.scroll.position,value.scroll && value.scroll.height,Object.keys(snapshotKeys).length]);
        if(signature===lastSignature && Object.keys(snapshotKeys).length===count) stable++; else stable=0;
        lastSignature=signature;
        if(steps%5===0) progress('history','正在加载 '+item.label+' 的历史消息…');
        if(moved.scroll && moved.scroll.atBoundary && stable>=1 || stable>=2){stopReasons.push(directions[d]+'_rendered_boundary');break;}
        if(n===limits.scrollSteps-1)stopReasons.push(directions[d]+'_step_limit');
      }
      if(now()-scopeStarted>=limits.scopeSeconds*1000)break;
    }
    item.status='partial';item.read=Object.keys(snapshotKeys).length;item.scrollSteps=steps;item.stopReasons=stopReasons;item.unopenedReplyControls=replyCount;item.historyComplete=false;
    item.reason=stopReasons.indexOf('explicit_empty_state')>=0?'Teams 当前页面明确显示为空；不推断未加载历史。':'已读取本轮加载记录；页面边界不等于完整历史，折叠回复和附件正文仍需核验。'; coverage.push(item);
    if(scope.type==='channel')counts.channelsRead++;else counts.chatsRead++;
    completedScopes.push({id:scope.id,type:scope.type,read:item.read,stopReasons:stopReasons,historyComplete:false});saveSession();
    progress('reading','已读取 '+item.label+'：'+item.read+' 条消息。');
  }
  function navVisible(value,target){return !!(value && value.ok && (value.navigationViews && value.navigationViews[target] || value[target] && value[target].length));}
  function teamsHome() { return navigate({action:'openTeams'},function(v){return navVisible(v,'teams');}); }
  function list(target,initial) {
    var value=initial || inspect(),items=Object.create(null),order=[],steps=0,listStarted=now(),reason='rendered_list',capped=false;
    function collect(v){(v[target]||[]).forEach(function(item){if(item&&item.id&&!items[item.id]){items[item.id]=item;order.push(item.id);}});}
    collect(value);
    if(!(value.navigationScroll && value.navigationScroll[target] && value.navigationScroll[target].available))return {items:order.map(function(id){return items[id];}),value:value,steps:0,reason:order.length?'rendered_list':'empty_rendered_list'};
    var directions=['previous','next'];
    for(var d=0;d<directions.length;d++) {
      var stable=0,previous='';
      for(var n=0;n<limits.navigationSteps;n++) {
        if(now()-listStarted>=limits.navigationSeconds*1000){reason='navigation_time_limit';capped=true;break;}
        var moved=call({action:'scrollNavigation',target:target,direction:directions[d],expectedScope:value.scope && value.scope.id?value.scope:undefined});
        if(!moved.ok || moved.code==='NO_NAVIGATION_SCROLL_CONTAINER'){reason=moved.code || 'navigation_unavailable';break;}
        delay(0.3);value=inspect();collect(value);steps++;
        var metrics=value.navigationScroll && value.navigationScroll[target] || {},signature=JSON.stringify([metrics.position,metrics.height,order.length]);
        stable=signature===previous?stable+1:0;previous=signature;
        if(moved.scroll && moved.scroll.atBoundary && stable>=1 || stable>=2){reason='rendered_boundary';break;}
        if(n===limits.navigationSteps-1){reason='navigation_step_limit';capped=true;}
      }
      if(capped)break;
    }
    if(capped)warn('部分导航列表达到本轮遍历上限，尚不能视为全部发现。');
    return {items:order.map(function(id){return items[id];}),value:value,steps:steps,reason:reason};
  }
  function seek(target,id,initial) {
    var value=initial || inspect();
    if((value[target]||[]).some(function(item){return item.id===id;}))return value;
    var directions=['previous','next'];
    for(var d=0;d<directions.length;d++)for(var n=0;n<limits.navigationSteps;n++) {
      if(!(value.navigationScroll && value.navigationScroll[target] && value.navigationScroll[target].available))break;
      var moved=call({action:'scrollNavigation',target:target,direction:directions[d],expectedScope:value.scope && value.scope.id?value.scope:undefined});if(!moved.ok)break;
      delay(0.25);value=inspect();if((value[target]||[]).some(function(item){return item.id===id;}))return value;
      if(moved.scroll && moved.scroll.atBoundary)break;
    }
    return {ok:false,code:'TARGET_NOT_RENDERED'};
  }
  function unread(item,reason){counts.errors++;item.status='unread';item.reason=reason;coverage.push(item);}
  function prioritize(items){return items.slice().sort(function(a,b){return Number(ecName(b.name))-Number(ecName(a.name));});}
  function start() {
  try {
    progress('connecting','正在连接 Teams 同步标签…');
    var initial=waitFor(function(v){return !!v.accountId;},20);
    if(!initial.accountId) fault('NEED_LOGIN','请在浏览器登录 Teams 后再次同步。');
    var cooldown=session.apiCooldown,until=cooldown && Date.parse(cooldown.retryAt);
    if(cooldown && cooldown.accountId===identity && Number.isFinite(until) && until>now() && until<=now()+86400000)fault('RATE_LIMITED','服务仍在冷却，已保留缓存；最早 '+cooldown.retryAt+' 后重试。');
    if(cooldown)delete session.apiCooldown;
    if(host.indexHook) {
      var indexed=host.indexHook({value:initial,scope:initial.scope,item:{kind:'discovery',label:'Teams 会话索引'},config:config,identity:identity,counts:counts,timings:timings,setCooldown:setCooldown,getAttachmentCursor:getAttachmentCursor,saveAttachmentCursor:saveAttachmentCursor,pageEval:host.pageEval,readResource:host.readResource,emit:emit,publish:publish,deadline:deadline,progress:progress,sleep:delay,now:now,warn:warn,recordCoverage:function(item){coverage.push(item);if(item && item.id)completedScopes.push({id:item.id,type:item.kind,read:item.read || 0,historyComplete:item.historyComplete===true});}});
      if(indexed && indexed.handled) {
        warn('本轮通过当前账号已确认的会话索引读取；索引可能不包含尚未加载、隐藏或学校限制的范围，不能视为账号全量数据。');
        if(focus==='ec')warn('本轮为 EC 专项：其他频道、聊天、作业和成绩未遍历。');
        if(counts.attachments)warn('已登记 '+counts.attachments+' 个附件；正文读取结果请在附件卡片核对，未成功解析的仍未读。');
        saveSession('finished_index');
        var indexedMessage=focus==='ec'?'EC 专项读取 '+counts.ec+' 条消息；请核对覆盖范围。':'本轮通过会话索引读取 '+counts.messages+' 条消息；请核对未读范围。';
        if(!counts.channelsRead && !counts.chatsRead)indexedMessage='本轮索引未找到可读取的目标会话；已记录发现范围，未宣称读取完成。';
        var indexedStatus=status('partial',indexedMessage,false);emit({type:'done',status:indexedStatus});return indexedStatus;
      }
    }
    var home=teamsHome();
    if(!home.ok)unread({kind:'team-list',label:'团队列表'},home.code);
    var teamList=home.ok?list('teams',home):{items:[]},teams=prioritize(teamList.items);counts.teams=teams.length;
    coverage.push({kind:'discovery',label:'团队列表',status:'partial',read:teams.length,reason:teamList.reason||'not_available',historyComplete:false});
    progress('discovery','发现 '+teams.length+' 个团队；'+(focus==='ec'?'本轮只读取 EC / English Corner 频道。':'开始逐一核对频道。'));
    for(var i=0;i<teams.length;i++) {
      if(i || teamList.steps)home=teamsHome();
      var team=teams[i],rendered=seek('teams',team.id,home);
      if(!rendered.ok){unread({kind:'team',label:team.name},rendered.code);continue;}
      var opened=navigate({action:'openTeam',teamID:team.id},function(v){return v.team && v.team.id===team.id;});
      if(!opened.ok){counts.errors++;coverage.push({kind:'team',label:team.name,status:'unread',reason:opened.code});continue;}
      if(opened.hiddenChannels && opened.hiddenChannels.available && !opened.hiddenChannels.expanded){var revealed=call({action:'revealHiddenChannels',expectedScope:opened.scope && opened.scope.id?opened.scope:undefined});if(revealed.ok){delay(0.3);opened=inspect();}else warn('隐藏频道展开失败：'+team.name+' ('+revealed.code+')');}
      var channelList=list('channels',opened),channels=prioritize(channelList.items);counts.channels+=channels.length;
      coverage.push({kind:'discovery',label:team.name+' / 频道列表',status:'partial',read:channels.length,reason:channelList.reason,historyComplete:false});
      for(var c=0;c<channels.length;c++) {
        var channel=channels[c];
        if(focus==='ec' && !ecName(channel.name) && !ecName(team.name))continue;
        var channelVisible=seek('channels',channel.id);
        if(!channelVisible.ok){unread({kind:'channel',id:channel.id,label:team.name+' / '+channel.name},channelVisible.code);continue;}
        var page=navigate({action:'openChannel',channelID:channel.id},function(v){return v.scope && v.scope.type==='channel' && v.scope.id===channel.id && v.scope.strong;});
        captureTimeline(page,{kind:'channel',id:channel.id,label:team.name+' / '+channel.name});
      }
      // Inspect the dedicated education surfaces separately from messages.
      if(focus==='ec')continue;
      var sections=(inspect().sections||[]);
      for(var s=0;s<sections.length;s++) {
        var section=sections[s];
        var detail=navigate({action:'openSection',sectionID:section.id},function(v){return v.scope && v.scope.type==='section' && v.scope.id===section.id;});
        if(detail.ok && detail.snapshot){publish(detail.snapshot,{kind:section.kind,id:section.id});coverage.push({kind:section.kind,label:team.name+' / '+section.name,status:'partial',reason:'已读取渲染页面，未证实全部条目。'});continue;}
        var reason=detail.platformError?'Teams 网页自身加载失败，提示使用桌面版。':detail.frames && detail.frames.inaccessible?'内容位于跨域框架，当前浏览器授权无法读取。':detail.code || '尚未验证此页面的正文读取。';
        coverage.push({kind:section.kind || 'section',id:section.id,label:team.name+' / '+section.name,status:'unread',reason:reason});
        counts.errors++;warn(section.name+'未完成：'+reason);
      }
    }
    if(config.includeChats!==false && focus!=='ec') {
      var chatView=navigate({action:'openChats'},function(v){return navVisible(v,'chats');});
      if(!chatView.ok)unread({kind:'chat-list',label:'聊天列表'},chatView.code);
      var chatList=chatView.ok?list('chats',chatView):{items:[]},chats=chatList.items;counts.chats=chats.length;
      coverage.push({kind:'discovery',label:'聊天列表',status:'partial',read:chats.length,reason:chatList.reason || 'not_available',historyComplete:false});
      for(var h=0;h<chats.length;h++) {
        var chat=chats[h];
        var chatVisible=seek('chats',chat.id);
        if(!chatVisible.ok){unread({kind:'chat',id:chat.id,label:chat.name},chatVisible.code);continue;}
        var chatPage=navigate({action:'openChat',chatID:chat.id},function(v){return v.scope && v.scope.type==='chat' && v.scope.id===chat.id && v.scope.strong;});
        captureTimeline(chatPage,{kind:'chat',id:chat.id,label:chat.name});
      }
    }
    warn('自动发现覆盖当前账号网页中展示的团队与聊天；隐藏、未加载或学校限制的范围仍可能遗漏。');
    if(focus==='ec')warn('本轮为 EC 专项：其他频道、聊天、作业和成绩未遍历。');
    if(counts.attachments)warn('已登记 '+counts.attachments+' 个附件；正文读取结果请在附件卡片核对，未成功解析的仍未读。');
    saveSession('finished');
    var message=focus==='ec'?'EC 专项读取 '+counts.ec+' 条消息；请核对覆盖范围。':'本轮读取 '+counts.messages+' 条消息、'+counts.assignments+' 条作业消息；请核对未读范围。';
    if(!counts.channelsRead && !counts.chatsRead)message=focus==='ec'?'本轮未找到可读取的 EC 频道；已记录发现范围，未宣称读取完成。':'本轮未发现可读取的频道或聊天，已记录空列表或失败原因。';
    var finalStatus=status('partial',message,false);emit({type:'done',status:finalStatus});return finalStatus;
  } catch(error) {
    var code=error.code||'BRIDGE_ERROR', msg=String(error.message||'');
    if(/-1743|not authorized.*apple events/i.test(String(error))){code='AUTOMATION_DENIED';msg='请在 macOS 自动化设置中允许 CampusDesk 控制浏览器。';}
    else if(/javascript.*(?:disabled|turned off|not allowed)|allow javascript from apple events/i.test(String(error))){code='JAVASCRIPT_DISABLED';msg='请在浏览器“显示 → 开发者”中启用来自 Apple Events 的 JavaScript。';}
    if(!error.code && code==='BRIDGE_ERROR')msg='Teams 浏览器连接未完成，已保存之前的读取结果。';
    saveSession(code);
    emit({type:'error',code:code,message:msg});
    var failed=status(code==='NEED_LOGIN'?'login_required':code==='RATE_LIMITED'?'waiting':'partial',msg,false);failed.errorCode=code;emit({type:'done',status:failed});return failed;
  }
  }
  return {start:start,inspect:inspect,list:list,captureTimeline:captureTimeline,status:status};
}

function allowedTeamsURL(value) {
  if(typeof value!=='string' || value.length>4096 || /[\s\\\u0000-\u001f]/.test(value) || !/^https:\/\/teams\.(?:cloud\.microsoft|microsoft\.com)\//i.test(value))return false;
  var pieces=value.split(/[?&#]/).slice(1);
  for(var i=0;i<pieces.length;i++){var key;try{key=decodeURIComponent(pieces[i].split('=')[0]);}catch(_){return false;}if(/^(?:token|access_token|id_token|refresh_token|code|sig|signature|authkey|client_secret|assertion|authorization|password|session_token)$/i.test(key))return false;}
  return true;
}
if(typeof module==='object' && module.exports)module.exports={createRunner:createDOMRunner,allowedURL:allowedTeamsURL};

// Native entry point. Foundation is deliberately initialized here, not when
// node:test imports the portable orchestration above.
function run(argv) {
  ObjC.import('Foundation');
  var output=$.NSFileHandle.fileHandleWithStandardOutput,config,session={},tab,app;
  function emit(value){output.writeData($(JSON.stringify(value)+'\n').dataUsingEncoding($.NSUTF8StringEncoding));}
  function read(path){var value=$.NSString.stringWithContentsOfFileEncodingError(path,$.NSUTF8StringEncoding,null);return value && !value.isNil()?ObjC.unwrap(value):'';}
  function save(value){session=value;if(!config.checkpointPath)return;$(JSON.stringify(value)).writeToFileAtomicallyEncodingError(config.checkpointPath,true,$.NSUTF8StringEncoding,null);$.NSFileManager.defaultManager.setAttributesOfItemAtPathError($({NSFilePosixPermissions:384}),config.checkpointPath,null);}
  try {
    config=JSON.parse(argv[0]);
    if(!config.resources || ['chrome','edge'].indexOf(config.browser)<0)throw new Error('INVALID_CONFIG');
    var helpers=read(config.resources+'/teams.js'),adapter=read(config.resources+'/teams-auto.js');
    if(helpers.length<1000 || adapter.length<1000)throw new Error('RESOURCES_MISSING');
    var source=helpers+'\n'+adapter,apiCode=read(config.resources+'/teams-api-runner.js');
    var apiHooks=apiCode?eval(apiCode+'\n;({capture:typeof runTeamsAPI==="function"?runTeamsAPI:null,index:typeof runTeamsAPIIndex==="function"?runTeamsAPIIndex:null});'):{};
    if(config.checkpointPath)try{session=JSON.parse(read(config.checkpointPath)||'{}');}catch(_){session={};}
    app=Application(config.browser==='edge'?'Microsoft Edge':'Google Chrome');if(!app.running())app.launch();
    var windows=app.windows();
    for(var w=0;w<windows.length && !tab;w++){var tabs=windows[w].tabs();for(var t=0;t<tabs.length;t++)if(String(tabs[t].id())===String(session.tabId) && allowedTeamsURL(tabs[t].url())){tab=tabs[t];break;}}
    if(!tab && config.reuseActive && windows.length && allowedTeamsURL(windows[0].activeTab().url()))tab=windows[0].activeTab();
    if(!tab){if(!windows.length){app.windows.push(app.Window());windows=app.windows();}windows[0].tabs.push(app.Tab({url:'https://teams.cloud.microsoft/'}));var fresh=windows[0].tabs();tab=fresh[fresh.length-1];windows[0].activeTabIndex=fresh.length;session=Object.assign({},session,{windowId:String(windows[0].id()),tabId:String(tab.id())});save(session);}
    if(config.operation==='login'){app.activate();emit({type:'done',status:{running:false,phase:'login_required',message:'请在浏览器登录 Teams。',coverage:'partial',historyComplete:false}});return;}
    function pageEval(script){if(!allowedTeamsURL(tab.url())){var changed=new Error('同步标签已离开 Teams，请重新登录。');changed.code='TAB_CHANGED';throw changed;}return tab.execute({javascript:script});}
    createDOMRunner(config,{session:session,now:Date.now,sleep:delay,emit:emit,saveCheckpoint:save,captureHook:apiHooks.capture,indexHook:apiHooks.index,pageEval:pageEval,readResource:function(name){return read(config.resources+'/'+name);},execute:function(request){
      var script='(function(){'+source+'\nreturn JSON.stringify(window.CampusTeamsAuto.run('+JSON.stringify(request)+'));})();',raw=pageEval(script);
      if(typeof raw!=='string' || raw.length>4000000){var invalid=new Error('页面内容超出单次读取上限。');invalid.code='INVALID_RESULT';throw invalid;}return JSON.parse(raw);
    }}).start();
  }catch(error){emit({type:'error',code:'BRIDGE_SETUP_ERROR',message:'无法启动 Teams 自动读取：'+String(error.message || error).slice(0,200)});emit({type:'done',status:{running:false,phase:'partial',message:'Teams 读取未启动，已保留缓存。',coverage:'partial',historyComplete:false}});}
}
