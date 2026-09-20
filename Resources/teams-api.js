/* CampusDesk read-only, in-page Teams bridge.
 * Protocol: start({op:'conversations'|'messages'|'attachment', ...}) -> jobId;
 * status(jobId) -> {status:'running'|'complete'|'partial'|'error',result,error}.
 * No tokens leave this closure. No storage writes, redirects, account changes,
 * message sends, or third-party services. GET-only except exact authz discovery.
 * Inspired by gediz/teams-web-chat-exporter (MIT); see THIRD_PARTY_TEAMS_API.txt.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else if (!root.CampusDeskTeamsAPI || root.CampusDeskTeamsAPI.version !== 7) root.CampusDeskTeamsAPI = factory(root);
})(typeof window === 'object' ? window : globalThis, function createBridge(env) {
  'use strict';
  var VERSION = 7, jobs = new Map(), known = new Map(), files = new Map(), cooldowns = new Map(), owner = '', serial = 0, mediaRegion = '';
  var UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  var MAX_JSON = 2000000, MAX_RESULT = 2500000, MAX_FILE = 12 * 1024 * 1024, MAX_RETRY_MS = 24 * 60 * 60 * 1000;
  var errors = {
    NOT_TEAMS:'必须在已登录的 Teams 学校网页版内运行。', ACCOUNT_UNVERIFIED:'无法确认当前 Teams 账号，保留页面读取方式。',
    ACCOUNT_CHANGED:'Teams 账号已改变，本轮停止。', SCOPE_DENIED:'资源不属于本轮确认的 Teams 范围。',
    TOKEN_UNAVAILABLE:'当前页没有可验证的匹配会话授权，保留页面读取方式。', TOKEN_AMBIGUOUS:'存在多个账号或租户授权，无法安全确定当前会话。',
    ENDPOINT_UNAVAILABLE:'当前页面尚未出现可确认的聊天服务端点，保留页面读取方式。',
    INVALID_RESPONSE:'服务返回内容无法确认，不计为历史结束。', RESPONSE_LIMIT:'响应达到大小上限，保留已读数据。',
    TIMEOUT:'本轮读取超时，保留已读数据。', NETWORK:'服务请求失败或被浏览器阻止，保留页面读取方式。',
    HTTP_401:'Teams 会话已失效，请重新登录。', HTTP_403:'当前账号或浏览器不允许读取该资源。', HTTP_429:'Teams 限流，本轮停止以等待下次同步。', HTTP_503:'服务暂不可用，本轮停止并等待服务恢复。',
    HTTP_ERROR:'Teams 服务未成功返回内容。', PAGINATION_LOOP:'历史分页重复，无法确认完整性。',
    FILE_UNSUPPORTED:'附件不是可确认的文档、文本或图片，未导出正文。', FILE_ACCESS_DENIED:'SharePoint 明确禁止下载此附件。', IDB_UNAVAILABLE:'Teams 本地会话列表尚不可读。'
  };
  function failure(code) { var e = new Error(errors[code] || code); e.code = code; return e; }
  function fail(code) { throw failure(code); }
  function str(v, n) { return typeof v === 'string' ? v.slice(0, n || 1000) : ''; }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  function clamp(v, n, max) { return Math.max(1, Math.min(max, Number.isFinite(Number(v)) ? Math.floor(Number(v)) : n)); }
  function parse(v) { try { return JSON.parse(v); } catch (_) { return null; } }
  function url(v) { try { var u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && !u.port ? u : null; } catch (_) { return null; } }
  function chatHost(h) { return /^(?:[a-z0-9-]+\.)+(?:asm\.skype\.com|ic3\.teams\.office\.com|ng\.msg\.teams\.microsoft\.com)$/.test(h); }
  function shareHost(h) { return /^[a-z0-9-]+\.sharepoint\.com$/.test(h); }
  function retryClock() { return env.Date && typeof env.Date.now === 'function' ? env.Date.now() : Date.now(); }
  function serviceFor(mode, host) { return mode==='authz'?'teams-auth':mode==='chat'?'teams-chat':/^media-/.test(mode)?'teams-media':'sharepoint:'+host; }
  function safeService(value) { return /^(?:teams-(?:auth|chat|media)|sharepoint:[a-z0-9-]+\.sharepoint\.com)$/.test(value||'')?value:''; }
  function safeError(e, job) {
    var code=e&&errors[e.code]?e.code:'NETWORK',out={code:code,message:errors[code]},service=safeService(e&&e.service||job&&job.service);
    if(service)out.service=service;
    if(e&&Number.isInteger(e.httpStatus)&&e.httpStatus>=100&&e.httpStatus<=599)out.httpStatus=e.httpStatus;
    var at=e&&typeof e.retryAt==='string'?Date.parse(e.retryAt):NaN;
    if(service&&Number.isFinite(at)){out.retryAt=new Date(at).toISOString();out.retryAfterMs=Math.max(0,Math.min(MAX_RETRY_MS,Math.ceil(at-retryClock())));}
    return out;
  }
  function cooldownError(entry, service) {
    var e=failure(entry.httpStatus===503?'HTTP_503':'HTTP_429');e.httpStatus=entry.httpStatus;e.service=service;e.retryAt=new Date(entry.until).toISOString();return e;
  }
  function checkCooldown(job, service) {
    var entry=cooldowns.get(job.accountId+'|'+service);if(entry&&entry.until>retryClock())throw cooldownError(entry,service);
  }
  function rateLimited(job, service, response) {
    var now=retryClock(),key=job.accountId+'|'+service,previous=cooldowns.get(key),strikes=previous&&now-previous.last<MAX_RETRY_MS?Math.min(previous.strikes+1,8):1;
    var raw=str(response.headers.get('retry-after'),100).trim(),delay=NaN;
    if(/^\d+$/.test(raw))delay=Number(raw)*1000;
    else if(/\b(?:GMT|UTC)\b/i.test(raw)){var date=Date.parse(raw);if(Number.isFinite(date))delay=date-now;}
    if(!Number.isFinite(delay)){
      var random=env.Math&&typeof env.Math.random==='function'?env.Math.random():Math.random();random=Number.isFinite(random)?Math.max(0,Math.min(1,random)):0.5;
      delay=Math.min(3600000,30000*Math.pow(2,strikes-1))*(1+random*0.25);
    }
    // Bound hostile/broken headers; even Retry-After: 0 avoids an immediate loop.
    delay=Math.max(1000,Math.min(MAX_RETRY_MS,Math.ceil(delay)));
    var entry={until:now+delay,last:now,strikes:strikes,httpStatus:response.status};
    for(var row of cooldowns)if(now-row[1].last>=MAX_RETRY_MS)cooldowns.delete(row[0]);
    cooldowns.set(key,entry);throw cooldownError(entry,service);
  }
  function isBackoff(e) { return !!(e&&(e.code==='HTTP_429'||e.code==='HTTP_503')); }
  async function fileVersion(metadata) {
    // Only file-version metadata is eligible: never object/share/download URLs,
    // message timestamps, session IDs, credentials, or locally captured time.
    var m=obj(metadata),info=obj(m.fileInfo),tag=m.eTag||m.etag||m.cTag||m.ctag||info.eTag||info.etag,canonical='';
    if(typeof tag==='string'&&tag.length>0&&tag.length<=512&&!/[\r\n?]|:\/\//.test(tag))canonical='etag:'+tag;
    else {
      var modified=m.lastModifiedDateTime||m.modifiedDateTime||info.lastModifiedDateTime,size=m.size!=null?m.size:info.size;
      if(typeof modified==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d\d:\d\d)$/.test(modified)&&Number.isFinite(Date.parse(modified))&&size!==''&&size!=null&&Number.isSafeInteger(Number(size))&&Number(size)>=0)
        canonical='modified:'+new Date(modified).toISOString()+'|size:'+Number(size);
    }
    if(!canonical||!env.crypto||!env.crypto.subtle)return '';
    try{var digest=new Uint8Array(await env.crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical)));return 'v1:'+Array.from(digest,function(b){return b.toString(16).padStart(2,'0');}).join('');}catch(_){return '';}
  }
  function mediaURL(value,account) {
    var u=url(value);if(!u||!(/^[a-z0-9-]+\.(?:asm\.skype\.com|asyncgw\.teams\.microsoft\.com)$/.test(u.hostname)))return null;
    if(!new RegExp('^/v1/(?:'+account+'/)?objects/[A-Za-z0-9_.:-]+/views/[A-Za-z0-9_-]+$','i').test(u.pathname))return null;
    return u;
  }
  function safeLink(v) {
    var u = url(v); if (!u || !(/^(?:teams\.microsoft\.com|teams\.cloud\.microsoft)$/.test(u.hostname) || shareHost(u.hostname))) return '';
    // Sharing credentials are never exported, persisted, or placed in diagnostics.
    if ([...u.searchParams.keys()].some(function (k) { return /token|auth|sig|code|key|^e$/i.test(k); })) return '';
    u.hash = ''; return u.href;
  }
  function currentAccount() {
    var here = url(env.location && env.location.href);
    if (!here || !/^(?:teams\.microsoft\.com|teams\.cloud\.microsoft)$/.test(here.hostname)) fail('NOT_TEAMS');
    var avatar = env.document && env.document.querySelector('[data-tid="me-control-avatar"] img');
    var match = str(avatar && avatar.getAttribute('src'), 4000).match(new RegExp('/users/(' + UUID + ')/', 'i'));
    if (!match) fail('ACCOUNT_UNVERIFIED');
    var id = match[1].toLowerCase();
    if (owner && owner !== id) { known.clear(); files.clear(); fail('ACCOUNT_CHANGED'); }
    owner = id; return id;
  }
  function assertAccount(account) { if (currentAccount() !== account) fail('ACCOUNT_CHANGED'); }
  function activeConversation(account) {
    try {
      var raw = env.sessionStorage.getItem('tmp.session.' + account + '-mainWindowNavHistory');
      var idx = parse(env.sessionStorage.getItem('tmp.session.' + account + '-mainWindowNavHistoryIndex'));
      if (!raw || raw.length > MAX_JSON) return '';
      var hist = parse(raw), entry = obj(obj(Array.isArray(hist) && hist[Number(obj(idx).windowHistoryIndex) || 0]).activeEntities).mainEntity;
      return entry && entry.action === 'view' && /^(?:chats|channels|meetings)$/.test(entry.type) ? conversationID(entry.id) : '';
    } catch (_) { return ''; }
  }
  function conversationID(v) { return typeof v === 'string' && /^(?:19:[A-Za-z0-9_.:@-]{1,300}|48:notes)$/.test(v) ? v : ''; }
  function sameMessagePath(path,expected){try{return decodeURIComponent(path)===decodeURIComponent(expected);}catch(_){return false;}}
  function kind(id, row) { return /Channel/i.test(str(obj(row).type) + ' ' + str(obj(obj(row).threadProperties).threadType)) || /@thread\.tacv2$/.test(id) ? 'channel' : /^19:meeting_/.test(id) ? 'meeting' : 'chat'; }
  function b64bytes(s) {
    if (typeof s !== 'string' || s.length > 40000) fail('TOKEN_UNAVAILABLE');
    var b = env.atob(s.replace(/-/g, '+').replace(/_/g, '/')), out = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) out[i] = b.charCodeAt(i); return out;
  }
  async function decrypt(entry, client) {
    // Same-page MSAL v4 encryption, only after account and exact resource match.
    // Never inspect refresh tokens, ID tokens, other browser stores, or disk.
    try {
      var cookie = env.document.cookie.match(/(?:^|;\s*)msal\.cache\.encryption=([^;]+)/);
      var config = cookie && parse(decodeURIComponent(cookie[1]));
      if (!config || !config.key || !env.crypto || !env.crypto.subtle) return null;
      var base = await env.crypto.subtle.importKey('raw', b64bytes(config.key), 'HKDF', false, ['deriveKey']);
      var key = await env.crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:b64bytes(entry.nonce),info:new TextEncoder().encode(client)}, base, {name:'AES-GCM',length:256}, false, ['decrypt']);
      var data = await env.crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(12)}, key, b64bytes(entry.data));
      return parse(new TextDecoder().decode(data));
    } catch (_) { return null; }
  }
  async function tokenFor(account, resourceHost) {
    assertAccount(account);
    var storage = env.localStorage, candidates = [], identities = new Set();
    if (!storage || storage.length > 5000) fail('TOKEN_UNAVAILABLE');
    for (var i = 0; i < storage.length; i++) {
      var key = storage.key(i), p = typeof key === 'string' ? key.split('|') : [];
      if (p.length < 7 || p[0] !== 'msal.2' || p[3] !== 'accesstoken' || p[1].split('.')[0].toLowerCase() !== account) continue;
      if (!/^(?:login\.windows\.net|login\.microsoftonline\.com)$/.test(p[2])) continue;
      var targets = p[6].split(/\s+/), exact = targets.some(function (scope) { var u = url(scope); return u && u.hostname === resourceHost; });
      if (!exact) continue;
      var raw = storage.getItem(key); if (!raw || raw.length > 40000) continue;
      var e = parse(raw); if (!e) continue;
      if (e.data && e.nonce) e = await decrypt(e, p[4]);
      if (!e || (e.homeAccountId && e.homeAccountId.toLowerCase() !== p[1].toLowerCase()) || (e.realm && e.realm.toLowerCase() !== p[5].toLowerCase())) continue;
      if (typeof e.secret !== 'string' || e.secret.length < 20 || e.secret.length > 20000 || /\s/.test(e.secret) || Number(e.expiresOn) <= Date.now()/1000 + 30) continue;
      identities.add(p[1].toLowerCase() + '|' + p[5].toLowerCase()); candidates.push(e);
    }
    if (identities.size > 1) fail('TOKEN_AMBIGUOUS');
    if (!candidates.length) fail('TOKEN_UNAVAILABLE');
    candidates.sort(function(a,b){return Number(b.expiresOn)-Number(a.expiresOn);});
    assertAccount(account); return candidates[0].secret;
  }
  async function endpoint(job) {
    var list = env.performance && env.performance.getEntriesByType('resource') || [];
    for (var i = list.length-1; i >= Math.max(0,list.length-3000); i--) {
      var u = url(list[i].name); if (!u || !chatHost(u.hostname)) continue;
      var marker = u.pathname.indexOf('/v1/users/ME/conversations');
      if (marker >= 0) return u.origin + u.pathname.slice(0,marker);
    }
    // Authentication exchange for service discovery only. Never use returned
    // tokens; messages use the independently account/scoped-checked IC3 token.
    var response=await request(job,'https://authsvc.teams.microsoft.com/v1.0/authz','api.spaces.skype.com',100000,'authz');
    var data=parse(new TextDecoder().decode(response.bytes)), discovered=url(obj(obj(data).regionGtms).chatService);
    if(!discovered||!chatHost(discovered.hostname)||discovered.search||discovered.hash||!/^(?:\/|\/chat)?$/.test(discovered.pathname))fail('ENDPOINT_UNAVAILABLE');
    mediaRegion=str(obj(data).userRegion||obj(data).region,20).toLowerCase();
    return discovered.origin+discovered.pathname.replace(/\/$/,'');
  }
  function bounded(job) { if (job.cancelled || Date.now() > job.deadline) fail('TIMEOUT'); assertAccount(job.accountId); }
  async function readResponse(response, max, controller) {
    if (Number(response.headers.get('content-length')) > max) { controller.abort(); fail('RESPONSE_LIMIT'); }
    if (!response.body || !response.body.getReader) fail('INVALID_RESPONSE');
    var reader = response.body.getReader(), chunks = [], size = 0;
    while (true) { var piece = await reader.read(); if (piece.done) break; size += piece.value.length;
      if (size > max) { controller.abort(); try { await reader.cancel(); } catch (_) {} fail('RESPONSE_LIMIT'); } chunks.push(piece.value); }
    var out = new Uint8Array(size), pos = 0; chunks.forEach(function(c){out.set(c,pos);pos+=c.length;}); return out;
  }
  async function request(job, address, resource, max, mode) {
    bounded(job); var u = url(address);
    if (!u || (mode==='authz' ? u.href!=='https://authsvc.teams.microsoft.com/v1.0/authz'||resource!=='api.spaces.skype.com' : mode==='chat' ? !chatHost(u.hostname)||resource!=='ic3.teams.office.com' : mode==='media-cookie' ? !mediaURL(u.href,job.accountId) : mode==='media-token' ? !mediaURL(u.href,job.accountId)||!/\.asyncgw\.teams\.microsoft\.com$/.test(u.hostname)||!u.pathname.startsWith('/v1/'+job.accountId+'/')||resource!=='ic3.teams.office.com' : !shareHost(u.hostname)||u.hostname!==resource)) fail('SCOPE_DENIED');
    var service=serviceFor(mode,u.hostname);job.service=service;checkCooldown(job,service);
    var noToken=['media-cookie','file-cookie','download'].includes(mode),token=null,controller=new AbortController();
    var timer = env.setTimeout(function(){controller.abort();}, Math.min(12000, Math.max(1,job.deadline-Date.now())));
    try {
      token=noToken?null:await tokenFor(job.accountId,resource);bounded(job);checkCooldown(job,service);
      var init={method:mode==='authz'?'POST':'GET',headers:token?{Authorization:'Bearer '+token}:{},credentials:['media-cookie','file-cookie'].includes(mode)?'include':'omit',redirect:'error',cache:'no-store',signal:controller.signal};
      if(mode==='authz'){init.headers['Content-Type']='application/json';init.body='{}';}
      if(mode==='file-resolve'){init.headers.Accept='application/json';init.headers.Prefer='getShortLivedDownloadUrl';init.headers.application='Teams_Web';}
      var response = await env.fetch(u.href,init);
      token = null;
      if(response.status===429||response.status===503){controller.abort();rateLimited(job,service,response);}
      if (!response.ok){controller.abort();var http=failure([401,403].includes(response.status)?'HTTP_'+response.status:'HTTP_ERROR');http.httpStatus=response.status;throw http;}
      var bytes = await readResponse(response,max,controller); bounded(job);
      cooldowns.delete(job.accountId+'|'+service);
      return {bytes:bytes,mimeType:str(response.headers.get('content-type'),200).split(';')[0].toLowerCase()};
    } catch (e) { if(!e||!errors[e.code])e=failure(controller.signal.aborted?'TIMEOUT':'NETWORK');e.service=service;throw e; }
    finally { token = null; env.clearTimeout(timer); }
  }
  async function json(job,address) {
    var response = await request(job,address,'ic3.teams.office.com',MAX_JSON,'chat');
    var data = parse(new TextDecoder().decode(response.bytes)); if (!data || typeof data !== 'object' || data.errorCode) fail('INVALID_RESPONSE'); return data;
  }
  function plain(value) {
    return str(value,30000).replace(/<(script|style|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<br\s*\/?\s*>|<\/(?:p|div|li|tr)>/gi,'\n').replace(/<[^>]*>/g,'')
      .replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:\d+|x[0-9a-f]+);/gi,function(m){var basic={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '};if(basic[m])return basic[m];var n=m[2].toLowerCase()==='x'?parseInt(m.slice(3,-1),16):parseInt(m.slice(2,-1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}).trim();
  }
  async function normalizeMessage(raw, conversation, job) {
    var id = str(raw.id || raw.clientmessageid,500); if (!id) return null;
    if (raw.conversationid && raw.conversationid !== conversation) fail('SCOPE_DENIED');
    var p = obj(raw.properties), messageType=str(raw.messagetype,100),reason='';
    function isTrue(v){return v===true||v===1||v==='1'||typeof v==='string'&&v.toLowerCase()==='true';}
    if(isTrue(raw.deleted)||isTrue(raw.isDeleted)||isTrue(p.deleted)||isTrue(p.isDeleted)||Number(p.deletetime)>0)reason='deleted';
    else if(!messageType)reason='missing_type';
    else if(/^(?:ThreadActivity|Control|Event)(?:\/|$)/.test(messageType))reason='system_type';
    else if(!/^(?:Text|RichText(?:\/(?:Html|Media_GenericFile|Media_Card|Media_Album|Media_Video|Media_AudioMsg))?)$/.test(messageType))reason='unknown_type';
    if(reason){
      if(!job.excludedSet.has(id)){
        if(job.result.excludedNativeIDs.length>=2000)fail('RESPONSE_LIMIT');
        job.excludedSet.add(id);job.result.excludedNativeIDs.push({nativeID:id,type:/^[A-Za-z][A-Za-z0-9_/-]{0,99}$/.test(messageType)?messageType:messageType?'UNKNOWN':'',reason:reason});
        // A later tombstone must not leave an earlier duplicate in this result.
        job.result.messages=job.result.messages.filter(function(m){return m.nativeID!==id;});
      }
      if(reason==='missing_type'||reason==='unknown_type')job.warnings.push('部分消息类型尚未确认，未当作正文导入。');
      return {excluded:true};
    }
    var fileRows = typeof p.files === 'string' ? parse(p.files) : p.files, attachments = [];
    if(p.files&&!Array.isArray(fileRows))job.warnings.push('部分消息附件元数据无法解析。');
    if(Array.isArray(fileRows)&&fileRows.length>50)job.warnings.push('部分消息的附件数量达到上限。');
    var boundedFiles=(Array.isArray(fileRows)?fileRows:[]).slice(0,50);
    for(var index=0;index<boundedFiles.length;index++){
      var file=obj(boundedFiles[index]);
      var fid = conversation + '|' + id + '|' + str(file.itemid || file.id || String(index),200), original = str(file.objectUrl || file.baseUrl,5000), u = url(original);
      var attachment = {id:fid,title:str(file.fileName || file.title || '附件',500),url:safeLink(original),extractionStatus:'unread',mimeType:str(file.fileType,100),versionKey:await fileVersion(file)};
      if (u && shareHost(u.hostname) && files.size < 1000) {
        var sharing=url(obj(file.fileInfo).shareUrl);
        files.set(fid,{accountId:job.accountId,url:u.href,title:attachment.title,itemId:str(file.itemid,100),shareUrl:sharing&&sharing.hostname===u.hostname?sharing.href:''});
      }
      attachments.push(attachment);
    }
    // Inline roster pictures are not present in properties.files. Only known
    // Teams media object paths are eligible; never fetch arbitrary img src.
    var html=str(raw.content,30000), imagePattern=/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, imageMatch, imageIndex=0, imageURLs=new Set();
    while((imageMatch=imagePattern.exec(html))&&attachments.length<50){
      var media=mediaURL(imageMatch[1].replace(/&amp;/g,'&'),job.accountId);if(!media||imageURLs.has(media.href))continue;imageURLs.add(media.href);
      var imageId=conversation+'|'+id+'|image-'+(++imageIndex), label=imageMatch[0].match(/\balt\s*=\s*["']([^"']*)["']/i);
      var imageTitle=label&&plain(label[1])?str(plain(label[1]),480):'image-'+imageIndex+'.png';
      if(files.size<1000)files.set(imageId,{accountId:job.accountId,url:media.href,title:imageTitle,media:true});
      attachments.push({id:imageId,title:imageTitle,url:'',kind:'image',mimeType:'image/png',extractionStatus:'unread',versionKey:''});
    }
    var content = str(raw.content,30001), text = plain(content), posted = raw.composetime || raw.originalarrivaltime;
    return {id:id,nativeID:id,text:text,title:plain(p.subject || ''),author:str(raw.imdisplayname || raw.fromDisplayNameInToken,300),postedAt:typeof posted==='string'&&!isNaN(Date.parse(posted))?new Date(posted).toISOString():null,
      attachments:attachments,deleted:false,truncated:content.length>30000,messageType:messageType};
  }
  async function readLocal(job) {
    var idb = env.indexedDB; if (!idb || !idb.databases) fail('IDB_UNAVAILABLE');
    var metas = await idb.databases(), matches = metas.filter(function(d){return typeof d.name==='string' && d.name.startsWith('Teams:conversation-manager:react-web-client:') && d.name.split(':').includes(job.accountId);});
    if (!matches.length) fail('IDB_UNAVAILABLE');
    var rows = new Map();
    for (var meta of matches.slice(0,8)) {
      bounded(job);
      await new Promise(function(resolve,reject){
        var db, settled=false, timer=env.setTimeout(function(){finish(failure('TIMEOUT'));},Math.min(5000,Math.max(1,job.deadline-Date.now())));
        function finish(e){if(settled)return;settled=true;env.clearTimeout(timer);if(db)db.close();e?reject(e):resolve();}
        var req=idb.open(meta.name,meta.version);
        req.onupgradeneeded=function(){req.transaction.abort();finish(failure('IDB_UNAVAILABLE'));};
        req.onerror=function(){finish(failure('IDB_UNAVAILABLE'));};req.onblocked=function(){finish(failure('IDB_UNAVAILABLE'));};
        req.onsuccess=function(){db=req.result;if(settled){db.close();return;}if(!db.objectStoreNames.contains('conversations')){finish(failure('IDB_UNAVAILABLE'));return;}
          var tx=db.transaction('conversations','readonly'), cur=tx.objectStore('conversations').openCursor();
          cur.onerror=function(){finish(failure('IDB_UNAVAILABLE'));};cur.onsuccess=function(){
            if(settled)return;var cursor=cur.result;if(!cursor){finish();return;}
            var row=cursor.value,id=conversationID(row&&row.id);if(id)rows.set(id,{id:id,type:str(row.type,100),displayName:str(row.displayName,500),chatTitle:{shortTitle:str(obj(row.chatTitle).shortTitle,500)},threadProperties:{topic:str(obj(row.threadProperties).topic,500),threadType:str(obj(row.threadProperties).threadType,100),groupId:str(obj(row.threadProperties).groupId,100)}});
            if(rows.size>=job.maxItems){job.warnings.push('会话列表达到本轮数量上限。');finish();return;}cursor.continue();
          };
        };
      });
    }
    return [...rows.values()];
  }
  async function conversations(job) {
    var rows = await readLocal(job), result={accountId:job.accountId,conversations:[],source:'teams-local-index',historyComplete:false,discoveryComplete:false};
    bounded(job);
    rows.forEach(function(r){var id=conversationID(r.id), p=obj(r.threadProperties), item={id:id,type:kind(id,r),name:str(obj(r.chatTitle).shortTitle||p.topic||r.displayName||id,500),teamId:str(p.groupId,100)};
      known.set(id,{accountId:job.accountId,type:item.type});result.conversations.push(item);});
    job.result=result;job.warnings.push('本地会话索引只代表 Teams 已同步范围，未证明全部学校频道或历史已发现。');job.status='partial';
  }
  async function messages(job, input) {
    var id=conversationID(input.conversationId);if(!id)fail('SCOPE_DENIED');
    var found=known.get(id), verifiedDOM=false;
    if(env.CampusTeamsAuto&&typeof env.CampusTeamsAuto.run==='function'){
      var live=env.CampusTeamsAuto.run({action:'inspect'});
      verifiedDOM=!!(live&&live.accountId===job.accountId&&live.scope&&live.scope.strong&&live.scope.id===id);
    }
    if((!found || found.accountId!==job.accountId)&&activeConversation(job.accountId)!==id&&!verifiedDOM)fail('SCOPE_DENIED');
    var type=found?found.type:kind(id), base=await endpoint(job), path='/v1/users/ME/conversations/'+encodeURIComponent(id)+'/messages';
    var next=base+path+'?pageSize=200&startTime=1&view=msnp24Equivalent%7CsupportsMessageProperties';
    var seenPages=new Set(),seen=new Set(),result={accountId:job.accountId,conversationId:id,type:type,messages:[],excludedNativeIDs:[],pages:0,timelineComplete:false,historyComplete:false},total=0;
    job.result=result;job.excludedSet=new Set();
    while(next&&result.pages<job.maxPages){
      bounded(job);var u=url(next);
      if(!u||!chatHost(u.hostname)||!sameMessagePath(u.pathname,new URL(base+path).pathname)||u.hash)fail('SCOPE_DENIED');
      if(seenPages.has(u.href))fail('PAGINATION_LOOP');seenPages.add(u.href);
      var data=await json(job,u.href);if(!Array.isArray(data.messages))fail('INVALID_RESPONSE');result.pages++;
      for(var raw of data.messages){bounded(job);var m=await normalizeMessage(obj(raw),id,job);if(!m){job.warnings.push('部分消息缺少稳定标识，未纳入结果。');continue;}if(m.excluded||seen.has(m.id)||job.excludedSet.has(m.id))continue;var size=JSON.stringify(m).length;
        if(result.messages.length>=job.maxItems||total+size>MAX_RESULT){job.warnings.push('本轮消息达到数量或大小上限。');job.status='partial';return;}
        seen.add(m.id);total+=size;result.messages.push(m);if(m.truncated)job.warnings.push('部分消息正文达到长度上限。');
      }
      var meta=obj(data._metadata);if(meta.backwardLink!=null&&typeof meta.backwardLink!=='string')fail('INVALID_RESPONSE');next=typeof meta.backwardLink==='string'?meta.backwardLink:'';
      if(!next){result.timelineComplete=true;break;}
    }
    if(next)job.warnings.push('历史分页达到本轮页数上限。');
    if(type==='channel')job.warnings.push('频道消息主时间线已读取；独立回复链完整性尚未确认。');
    result.historyComplete=result.timelineComplete&&type!=='channel'&&job.warnings.length===0;
    job.status=result.historyComplete?'complete':'partial';
  }
  async function sharePointFile(job,file,limit,knownVersionKey){
    var u=url(file.url),base=u.origin,site=u.pathname.match(/^(\/(?:personal|sites|teams)\/[^/]+)/i),address;
    var select='@microsoft.graph.downloadUrl,file,id,name,currentUserRole,size,eTag,cTag,lastModifiedDateTime';
    if(new RegExp('^'+UUID+'$','i').test(file.itemId))address=base+(site?site[1]:'')+'/_api/v2.0/sites/root/items/'+encodeURIComponent(file.itemId)+'/driveItem/?select='+encodeURIComponent(select);
    else {
      var link=file.shareUrl||file.url,bytes=new TextEncoder().encode(link),binary='';for(var i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
      var share='u!'+env.btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
      address=base+'/_api/v2.0/shares/'+share+'/driveItem/?select='+encodeURIComponent(select);
    }
    try{
      var response=await request(job,address,u.hostname,100000,'file-resolve'),item=parse(new TextDecoder().decode(response.bytes));
      if(!item||typeof item!=='object')fail('INVALID_RESPONSE');
      if(obj(item.currentUserRole).blocksDownload===true)fail('FILE_ACCESS_DENIED');
      if(Number(item.size)>limit)fail('RESPONSE_LIMIT');
      var versionKey=await fileVersion(item);bounded(job);
      // Revalidate on every run. A message's cached file metadata is only a hint;
      // only this fresh resolver response may suppress the binary download.
      if(versionKey&&versionKey===knownVersionKey)return {notModified:true,versionKey:versionKey};
      var download=url(item['@content.downloadUrl']||item['@microsoft.graph.downloadUrl']);
      if(download){
        // A pre-authorized URL is itself sensitive. Keep it in this stack only;
        // send neither bearer nor cookies, and refuse cross-host/redirect hops.
        if(download.hostname!==u.hostname)fail('SCOPE_DENIED');
        var downloaded=await request(job,download.href,u.hostname,limit,'download');downloaded.versionKey=versionKey;return downloaded;
      }
    }catch(e){if(isBackoff(e)||['ACCOUNT_CHANGED','TIMEOUT','RESPONSE_LIMIT','SCOPE_DENIED','FILE_ACCESS_DENIED'].includes(e.code))throw e;}
    // Existing browser login cookies may serve direct files if metadata API is
    // unavailable. No permission redemption or sharing mutation is attempted.
    return await request(job,u.href,u.hostname,limit,'file-cookie');
  }
  async function attachment(job,input){
    var file=files.get(input.attachmentId);if(!file||file.accountId!==job.accountId)fail('SCOPE_DENIED');
    var u=url(file.url),limit=Math.min(MAX_FILE,clamp(input.maxBytes,MAX_FILE,MAX_FILE)),response;
    if(file.media){
      var prefixes={emea:'eu',amer:'na',apac:'as',uk:'uk',au:'au',in:'in',jp:'jp'},prefix=prefixes[mediaRegion];
      if(prefix){
        var path=u.pathname.replace(new RegExp('^/v1/(?:'+job.accountId+'/)?'),'');
        var proxy='https://'+prefix+'-prod.asyncgw.teams.microsoft.com/v1/'+job.accountId+'/'+path+'?v=1';
        try{response=await request(job,proxy,'ic3.teams.office.com',limit,'media-token');}catch(e){if(isBackoff(e)||['ACCOUNT_CHANGED','TIMEOUT','RESPONSE_LIMIT','SCOPE_DENIED'].includes(e.code))throw e;}
      }
      if(!response)response=await request(job,u.href,'',limit,'media-cookie');
    }else response=await sharePointFile(job,file,limit,typeof input.knownVersionKey==='string'&&/^v1:[a-f0-9]{64}$/.test(input.knownVersionKey)?input.knownVersionKey:'');
    if(response.notModified){job.result={accountId:job.accountId,attachmentId:input.attachmentId,versionKey:response.versionKey,notModified:true};job.status='complete';return;}
    var b=response.bytes;
    var head=new TextDecoder().decode(b.slice(0,400)).trim();
    if(/^(?:<!doctype\s+html|<html|<svg|<script)/i.test(head)||/html|svg|javascript|executable/i.test(response.mimeType))fail('FILE_UNSUPPORTED');
    var binary=/^%PDF-/.test(head)||(b[0]===0x50&&b[1]===0x4b)||(b[0]===0xff&&b[1]===0xd8)||(b[0]===137&&b[1]===80)||(head.slice(0,3)==='GIF');
    if(!binary&&!/^text\/(?:plain|csv)$/.test(response.mimeType))fail('FILE_UNSUPPORTED');
    var bytes='';for(var i=0;i<b.length;i+=8192)bytes+=String.fromCharCode.apply(null,b.subarray(i,i+8192));
    job.result={accountId:job.accountId,attachmentId:input.attachmentId,title:file.title,mimeType:response.mimeType,byteLength:b.length,base64:env.btoa(bytes),extractionStatus:'downloaded',versionKey:response.versionKey||''};job.status='complete';
  }
  function prune(){var now=Date.now();for(var entry of jobs){if(entry[1].status!=='running'&&(entry[1].expires<now||jobs.size>=4))jobs.delete(entry[0]);}}
  function status(id){var j=jobs.get(id);if(!j)return{jobId:id,status:'error',error:{code:'UNKNOWN_JOB',message:'读取任务已过期。'},warnings:[]};
    var error=j.error?safeError(j.error,j):null,retry=error&&error.retryAt?{service:error.service,retryAt:error.retryAt,retryAfterMs:error.retryAfterMs,httpStatus:error.httpStatus}:null;
    return {jobId:id,status:j.status,result:j.result||null,error:error,retry:retry,warnings:[...new Set(j.warnings)].slice(0,20)};}
  function start(input){
    input=obj(input);prune();if([...jobs.values()].some(function(j){return j.status==='running';}))return{status:'error',error:{code:'BUSY',message:'已有读取任务正在进行。'}};
    var id='campus-api-'+Date.now()+'-'+(++serial),job={status:'running',warnings:[],expires:Date.now()+300000,deadline:Date.now()+clamp(input.timeoutMs,40000,60000),maxPages:clamp(input.maxPages,10,40),maxItems:clamp(input.maxItems,1000,2000)};jobs.set(id,job);
    var timer=env.setTimeout(function(){job.cancelled=true;job.error=safeError(failure('TIMEOUT'),job);job.status=job.result&&job.result.messages&&job.result.messages.length?'partial':'error';},Math.max(1,job.deadline-Date.now()));
    Promise.resolve().then(async function(){job.accountId=currentAccount();if(input.op==='conversations')await conversations(job);else if(input.op==='messages')await messages(job,input);else if(input.op==='attachment')await attachment(job,input);else fail('SCOPE_DENIED');bounded(job);})
      .catch(function(e){job.error=safeError(e,job);job.status=job.result&&job.result.messages&&job.result.messages.length?'partial':'error';if(job.error.code==='ACCOUNT_CHANGED'){job.result=null;job.status='error';}}).finally(function(){env.clearTimeout(timer);});
    return{jobId:id,status:'running'};
  }
  function forget(id){var j=jobs.get(id);if(j&&j.status!=='running')jobs.delete(id);return true;}
  return Object.freeze({version:VERSION,start:start,status:status,forget:forget});
});
