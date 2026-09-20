/* JXA host adapter for the read-only in-page Teams API. Browser session secrets
   never cross this bridge. Only bounded message data and attachment bytes do. */
function teamsAPIRetry(ctx, response) {
  var error=response && response.error;
  if(!error || !['HTTP_429','HTTP_503','RATE_LIMITED'].includes(error.code))return;
  var until=Date.parse(error.retryAt), remaining=Number(error.retryAfterMs);
  if(!Number.isFinite(until))until=ctx.now()+(Number.isFinite(remaining)&&remaining>0?remaining:60000);
  until=Math.max(ctx.now()+1000,Math.min(ctx.now()+86400000,until));
  var service=typeof error.service==='string' && /^(?:teams-(?:chat|auth|media)|sharepoint:[a-z0-9.-]{1,200})$/.test(error.service)?error.service:'teams-chat';
  var retry={accountId:ctx.identity,service:service,retryAt:new Date(until).toISOString()};
  if(ctx.setCooldown)ctx.setCooldown(retry);
  var stop=new Error('服务暂时限流或不可用，已停止本轮请求并保留缓存；最早 '+retry.retryAt+' 后重试。');
  stop.code='RATE_LIMITED';stop.retry=retry;throw stop;
}
function teamsAPITerminal(error) {return error && ['RATE_LIMITED','TIME_LIMIT','account_changed','ACCOUNT_CHANGED','TAB_CHANGED'].includes(error.code);}
function runTeamsAPI(ctx) {
  var scope=ctx.scope, source=ctx.readResource('teams-api.js'), url='https://teams.cloud.microsoft/';
  if (!source || !scope || !scope.strong || !scope.id || !ctx.identity) return false;
  function evaluate(script) {
    ctx.deadline();
    var raw=ctx.pageEval(script);
    if (typeof raw!=='string' || raw.length>20000000) throw new Error('API_RESPONSE_LIMIT');
    return JSON.parse(raw);
  }
  function job(request) {
    var began=ctx.now();
    try {
    var initial=evaluate('(function(){'+source+'\nreturn JSON.stringify(window.CampusDeskTeamsAPI.start('+JSON.stringify(request)+'));})();');
    if (!initial || !initial.jobId) return initial || {status:'error'};
    var end=ctx.now()+Math.min(65000,Number(request.timeoutMs)||45000), latest=initial, polls=0;
    while(ctx.now()<end) {
      ctx.sleep(0.35);
      latest=evaluate('JSON.stringify(window.CampusDeskTeamsAPI.status('+JSON.stringify(initial.jobId)+'))');
      if(latest.status!=='running' && latest.status!=='pending') break;
      if(++polls%25===0)ctx.progress('api','正在读取 '+ctx.item.label+' 的接口数据…');
    }
    try{ctx.pageEval('window.CampusDeskTeamsAPI.forget('+JSON.stringify(initial.jobId)+'); "ok";');}catch(_){}
    return latest;
    } finally {
      if(ctx.timings){var key=request.op==='attachment'?'attachments':request.op==='messages'?'messages':'discovery';var metric=ctx.timings[key]||(ctx.timings[key]={requests:0,milliseconds:0});metric.requests++;metric.milliseconds+=Math.max(0,ctx.now()-began);}
    }
  }
  try {
    ctx.progress('api','正在通过 Teams 接口读取 '+ctx.item.label+'…');
    var response=job({op:'messages',conversationId:scope.id,maxPages:8,maxItems:240,timeoutMs:45000});
    if(response && response.error && response.error.code==='SCOPE_DENIED') {
      job({op:'conversations',maxItems:500,timeoutMs:15000});
      response=job({op:'messages',conversationId:scope.id,maxPages:8,maxItems:240,timeoutMs:45000});
    }
    var data=response && response.result;
    if (!data || !Array.isArray(data.messages) || (!data.messages.length && !(data.excludedNativeIDs||[]).length) || data.accountId!==ctx.identity || data.conversationId!==scope.id) {
      teamsAPIRetry(ctx,response);
      ctx.warn('部分页面的接口读取不可用，已回退到浏览器页面读取。'); return false;
    }
    var snapshotID='', attachments=[], seen={};
    var excludedRecords=(data.excludedNativeIDs||[]).slice(0,2000).filter(function(item){return item && typeof item.nativeID==='string' && ['system_type','deleted'].indexOf(item.reason)>=0;}).map(function(item){return {nativeID:item.nativeID,text:'excluded system record'};});
    var excludedIDs=[];
    for(var group=0;group<excludedRecords.length;group+=100) {
      var excluded=evaluate('JSON.stringify(window.CampusTeamsAuto.normalizeRecords('+JSON.stringify(excludedRecords.slice(group,group+100))+','+JSON.stringify(scope)+','+JSON.stringify(url)+',null,"Excluded IDs").posts.map(function(p){return p.id}))');
      excludedIDs=excludedIDs.concat(excluded);
    }
    for(var offset=0;offset<Math.max(1,data.messages.length);offset+=100) {
      var records=data.messages.slice(offset,offset+100);
      var snapshot=evaluate('JSON.stringify(window.CampusTeamsAuto.normalizeRecords('+JSON.stringify(records)+','+JSON.stringify(scope)+','+JSON.stringify(url)+',null,'+JSON.stringify(ctx.item.label)+'))');
      snapshotID=snapshot.snapshotId;
      snapshot.browserExcludedIDs=excludedIDs;
      snapshot.warnings=['Teams 接口已读取当前批次；频道回复、完整历史和正式成绩仍需单独核验。'];
      snapshot.coverageMetadata={discovered:1,read:1,unread:0,errors:0,status:'partial',historyComplete:false,reason:'接口消息已读取；不代表账号全部数据完成。'};
      ctx.publish(snapshot,ctx.item);
      records.forEach(function(record){(record.attachments||[]).forEach(function(file){if(file.id&&!seen[file.id]){seen[file.id]=true;attachments.push(file);}});});
    }
    // Publish any safely read pages first, then stop the entire run on throttling.
    // Never turn a throttle into a DOM fallback or a different download method.
    teamsAPIRetry(ctx,response);
    // EC gets first access to the bounded local parsing budget. Never download an
    // arbitrary URL supplied by a message: API only accepts its own discovered IDs.
    var isEC=/english\s*corner|\bEC\b|英语角/i.test(ctx.item.label);
    if(isEC || ctx.config.focus==='ec') {
      var budget=Math.max(0,Math.min(12,40-(ctx.counts.attachmentDownloads||0)));
      // Keep the newest four visible attachments first, then rotate the rest
      // across runs. Cached/failed early files must not starve older entries.
      var cursor=ctx.getAttachmentCursor?ctx.getAttachmentCursor(scope.id):'',tail=attachments.slice(4),position=tail.findIndex(function(file){return file.id===cursor;});
      if(position>=0)tail=tail.slice(position+1).concat(tail.slice(0,position+1));
      var pending=attachments.slice(0,4).concat(tail);
      var downloadedHere=0, checkedHere=0;
      for(var index=0;index<pending.length&&checkedHere<40&&downloadedHere<budget;index++) {
        checkedHere++;
        ctx.progress('attachments','正在核对 EC 附件 '+(index+1)+'；本轮新下载 '+downloadedHere+' / '+budget+'…');
        var remaining=48*1024*1024-(ctx.counts.attachmentBytes||0);
        if(remaining<=0){ctx.warn('本轮附件下载达到 48 MiB 上限，其余仍未读取。');break;}
        var file=pending[index], cache=(ctx.config.attachmentCache||[]).find(function(c){return c.accountId===ctx.identity && c.attachmentId===file.id && typeof c.versionKey==='string' && /^v[0-9]+:[a-f0-9]{8,128}$/.test(c.versionKey);});
        var download=job({op:'attachment',attachmentId:file.id,knownVersionKey:cache?cache.versionKey:'',maxBytes:Math.min(12*1024*1024,remaining),timeoutMs:30000});
        teamsAPIRetry(ctx,download);
        if(ctx.saveAttachmentCursor && index>=4)ctx.saveAttachmentCursor(scope.id,file.id);
        var binary=download && download.result;
        if(binary && binary.notModified===true && cache && binary.accountId===ctx.identity && binary.attachmentId===file.id && binary.versionKey===cache.versionKey) {
          ctx.emit({type:'attachmentUnchanged',accountId:ctx.identity,snapshotId:snapshotID,attachmentId:file.id,versionKey:cache.versionKey,checkedAt:new Date(ctx.now()).toISOString()});
          ctx.counts.attachmentsCached=(ctx.counts.attachmentsCached||0)+1;continue;
        }
        var encoded=binary && binary.base64;
        var validBytes=typeof encoded==='string' && encoded.length>0 && encoded.length<=16777216 && encoded.length%4===0 && !/[^A-Za-z0-9+/=]/.test(encoded) && !/=/.test(encoded.slice(0,-2)) && /^[A-Za-z0-9+/]{2}$|^[A-Za-z0-9+/]=$|^==$/.test(encoded.slice(-2));
        var actualBytes=validBytes ? encoded.length/4*3-(encoded.slice(-2)==='=='?2:encoded.slice(-1)==='='?1:0) : -1;
        if(binary && binary.accountId===ctx.identity && binary.attachmentId===file.id && Number.isSafeInteger(binary.byteLength) && binary.byteLength>0 && binary.byteLength===actualBytes && binary.byteLength<=Math.min(12*1024*1024,remaining)) {
          ctx.emit({type:'attachment',accountId:ctx.identity,snapshotId:snapshotID,attachmentId:file.id,title:binary.title||file.title||'EC 附件',mimeType:binary.mimeType||'',base64:binary.base64,versionKey:typeof binary.versionKey==='string' && /^v[0-9]+:[a-f0-9]{8,128}$/.test(binary.versionKey)?binary.versionKey:''});
          ctx.counts.attachmentDownloads=(ctx.counts.attachmentDownloads||0)+1;
          downloadedHere++;
          ctx.counts.attachmentBytes=(ctx.counts.attachmentBytes||0)+binary.byteLength;
        } else ctx.warn('部分 EC 附件未能下载（'+(download && download.error && download.error.code || 'INVALID_ATTACHMENT')+'）或超过单文件 12 MiB 限制，已保留原件入口。');
      }
      if(index<attachments.length)ctx.warn('本轮 EC 附件达到读取数量或核对上限，其余附件尚未读取。');
    }
    return {handled:true,read:data.messages.length,status:'partial',reason:'已通过接口读取 '+data.messages.length+' 条消息；全部历史、回复和附件覆盖仍需核对。',historyComplete:false,stopReasons:['api_partial']};
  } catch (error) {
    if(teamsAPITerminal(error))throw error;
    ctx.warn('Teams 接口暂不可用或读取达到限制，已保留结果并尝试浏览器读取。');
    return false;
  }
}
function runTeamsAPIIndex(ctx) {
  var source=ctx.readResource('teams-api.js'), jobID='',result=null;
  if(!source || !ctx.identity)return false;
  function evaluate(script){ctx.deadline();var raw=ctx.pageEval(script);if(typeof raw!=='string'||raw.length>3000000)throw new Error('INDEX_LIMIT');return JSON.parse(raw);}
  try {
    ctx.progress('discovery','正在读取 Teams 本地会话索引，优先同步 EC…');
    var opened=evaluate('(function(){'+source+'\nreturn JSON.stringify(window.CampusDeskTeamsAPI.start({op:"conversations",maxItems:500,timeoutMs:15000}));})();');
    if(!opened.jobId)return false;
    jobID=opened.jobId;var until=ctx.now()+16000;
    while(ctx.now()<until){ctx.sleep(0.25);result=evaluate('JSON.stringify(window.CampusDeskTeamsAPI.status('+JSON.stringify(jobID)+'))');if(result.status!=='running')break;}
    teamsAPIRetry(ctx,result);
    if(!result||!result.result||result.result.accountId!==ctx.identity||!Array.isArray(result.result.conversations))return false;
    var conversations=result.result.conversations.filter(function(c){return c && typeof c.id==='string' && /^19:[A-Za-z0-9_.:@-]{1,300}$/.test(c.id);});
    var isEC=function(c){return /english\s*corner|\bEC\b|英语角/i.test(c.name||'');};
    conversations.sort(function(a,b){return Number(isEC(b))-Number(isEC(a));});
    if(ctx.config.focus==='ec')conversations=conversations.filter(isEC);
    if(ctx.config.includeChats===false)conversations=conversations.filter(function(c){return c.type==='channel';});
    ctx.counts.channels=conversations.filter(function(c){return c.type==='channel';}).length;
    ctx.counts.chats=conversations.length-ctx.counts.channels;
    ctx.recordCoverage({kind:'discovery',label:'Teams 本地会话索引',status:'partial',read:conversations.length,reason:'仅覆盖 Teams 已同步到此浏览器的索引；不代表学校全部内容。',historyComplete:false});
    var successes=0;
    for(var i=0;i<conversations.length;i++) {
      ctx.deadline();var c=conversations[i],type=c.type==='channel'?'channel':'chat';
      var item={kind:type,id:c.id,label:String(c.name||'Teams 会话').slice(0,300)};
      var scope={id:c.id,type:type,label:item.label,name:item.label,strong:true,accountId:ctx.identity};
      var child=Object.assign({},ctx,{item:item,scope:scope});
      var captured=runTeamsAPI(child);
      if(captured && captured.handled){successes++;if(type==='channel')ctx.counts.channelsRead=(ctx.counts.channelsRead||0)+1;else ctx.counts.chatsRead=(ctx.counts.chatsRead||0)+1;ctx.recordCoverage(Object.assign({},item,{status:'partial',read:captured.read,reason:captured.reason,historyComplete:false}));}
      else{ctx.counts.errors=(ctx.counts.errors||0)+1;ctx.recordCoverage(Object.assign({},item,{status:'unread',reason:'此会话接口未读取成功，已保留旧缓存。'}));}
    }
    ctx.recordCoverage({kind:'education',label:'正式作业、成绩和教师反馈',status:'unread',reason:'本轮仅核对消息和 EC 附件；正式教育接口的学校授权仍未验证。'});
    ctx.warn('本轮从 Teams 本地索引自动读取，无需逐页导航；索引外的隐藏会话、独立回复链和完整历史仍未确认。');
    return {handled:successes>0 || ctx.config.focus==='ec',message:ctx.config.focus==='ec'?'EC 自动读取已完成本轮可访问范围；请核对附件正文状态。':'本轮已自动读取 '+ctx.counts.messages+' 条消息；其余范围见未完成列表。'};
  } catch(error) {if(teamsAPITerminal(error))throw error;ctx.warn('本地索引读取未完成，尝试浏览器页面发现。');return false;}
  finally {if(jobID)try{ctx.pageEval('window.CampusDeskTeamsAPI.forget('+JSON.stringify(jobID)+'); "ok";');}catch(_){} }
}
if(typeof module==='object'&&module.exports)module.exports={runTeamsAPI:runTeamsAPI,runTeamsAPIIndex:runTeamsAPIIndex};
