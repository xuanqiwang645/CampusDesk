/* CampusDesk external Teams browser bridge (JXA / osascript).
   Reads only existing Teams tabs in a running, explicitly chosen Chrome/Edge.
   Never opens a tab, navigates, enables browser permissions, or reads credentials.
   Browser AppleEvents JavaScript permission must be enabled manually by the user.
   Chromium API: https://www.chromium.org/developers/applescript/
   This bridge has mocked API coverage, not a claim of macOS live verification. */
var CampusTeamsBrowser = (function () {
  'use strict';
  var MAX_PAGES = 20, MAX_INPUT = 250000, MAX_EXTRACTOR = 150000, MAX_SNAPSHOT = 1000000, MAX_OUTPUT = 2000000;
  var HOSTS = ['teams.microsoft.com','teams.cloud.microsoft'];
  var AUTH_PARAMETER = /^(?:access_token|id_token|refresh_token|token|code|client_secret|assertion|password|passwd|authorization|auth_token|session_token|authkey|sig|signature|session_state)$/i;
  var MESSAGES = {
    INVALID_INPUT:'浏览器同步请求无效，请重新打开应用后重试。',
    NOT_RUNNING:'所选浏览器尚未运行，请先打开浏览器中的 Teams 页面。',
    NO_WINDOW:'所选浏览器没有打开的窗口。',
    NOT_TEAMS:'请将所选浏览器最前面的窗口切换到 Teams 频道页面。',
    AUTOMATION_DENIED:'macOS 尚未允许 CampusDesk 控制所选浏览器，请在“隐私与安全性 → 自动化”中允许后重试。',
    JAVASCRIPT_DISABLED:'浏览器尚未允许 Apple Events 执行 JavaScript。请在浏览器的“显示 → 开发者”菜单中手动启用该选项后重试。',
    BROWSER_ERROR:'无法读取所选浏览器，请确认浏览器已打开并允许自动化操作。',
    ROUTE_CHANGED:'Teams 标签页已切换到其他页面，本次未读取；请重新关注当前频道。',
    EXTRACTION_ERROR:'Teams 消息读取失败，请打开具体频道后重试。',
    INVALID_SNAPSHOT:'Teams 返回的数据格式不受支持，未保存本次结果。',
    PAGE_UNAVAILABLE:'当前 Teams 页面尚未能读取消息，请检查登录状态或选择具体频道。',
    NO_MATCHING_TABS:'没有找到已打开的关注页面；请在所选浏览器中打开对应 Teams 频道。',
    OUTPUT_LIMIT:'本次读取的数据已达到大小限制，请分批同步关注页面。',
    AMBIGUOUS_ROUTE:'当前网址无法区分频道，请使用具体频道链接，或手动读取当前页。'
  };
  function boundedText(value, limit) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001f]/g,' ').replace(/https?:\/\/\S+/g,'网页').replace(/\s+/g,' ').trim().slice(0,limit);
  }
  // JXA does not provide the browser URL constructor. This deliberately narrow
  // parser accepts only safe Teams routes and preserves their exact route bytes.
  function safeURL(value) {
    if (typeof value !== 'string' || value.length > 4096 || /[\s\\\u0000-\u001f]/.test(value)) return null;
    var match = value.match(/^https:\/\/(teams\.microsoft\.com|teams\.cloud\.microsoft)(?::443)?(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i);
    if (!match) return null;
    var host = match[1].toLowerCase(), path = match[2] || '/', search = match[3] || '', fragment = match[4] || '';
    // Reject URL-parser normalization and malformed escapes rather than guessing
    // which route the user approved. Browsers supply normalized URLs in practice.
    if (/(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(path) || /%(?![0-9a-f]{2})/i.test(path+search+fragment)) return null;
    var hashQuery=fragment.slice(1); if(hashQuery.indexOf('?')>=0)hashQuery=hashQuery.slice(hashQuery.indexOf('?')+1);
    var queries=[search.slice(1),hashQuery];
    for(var q=0;q<queries.length;q++) {
      var pairs = queries[q].split('&');
      for (var i=0; i<pairs.length; i++) {
        if (!pairs[i]) continue;
        var equals = pairs[i].indexOf('='), rawKey = equals < 0 ? pairs[i] : pairs[i].slice(0,equals), rawValue = equals < 0 ? '' : pairs[i].slice(equals+1);
        var key, valuePart; try { key = decodeURIComponent(rawKey); valuePart = decodeURIComponent(rawValue); } catch (_) { return null; }
        if (AUTH_PARAMETER.test(key) || /[\u0000-\u001f]/.test(key+valuePart)) return null;
      }
    }
    return {url:'https://'+host+path+search+fragment,host:host,route:path+search+fragment};
  }
  function matchRoute(a,b) { var left=safeURL(a),right=safeURL(b); return Boolean(left && right && left.route===right.route); }
  function hasSpecificRoute(value) {
    var parsed=safeURL(value); if(!parsed)return false;
    var route=parsed.route, hashAt=route.indexOf('#'), fragment=hashAt<0?'':route.slice(hashAt+1), beforeHash=hashAt<0?route:route.slice(0,hashAt);
    var queryAt=beforeHash.indexOf('?'), path=queryAt<0?beforeHash:beforeHash.slice(0,queryAt);
    if(/^\/l\/(?:channel|message)\/[^/?#]+(?:\/|$)/i.test(path))return true;
    var hashQueryAt=fragment.indexOf('?'), hashPath=hashQueryAt<0?fragment:fragment.slice(0,hashQueryAt);
    if(/^\/?(?:channels?|conversations?|chats?|messages?)\/[^/?#]+(?:\/|$)/i.test(hashPath))return true;
    var queries=[queryAt<0?'':beforeHash.slice(queryAt+1),hashQueryAt<0?'':fragment.slice(hashQueryAt+1)];
    for(var q=0;q<queries.length;q++){
      var pairs=queries[q].split('&');
      for(var p=0;p<pairs.length;p++){
        var equals=pairs[p].indexOf('=');if(equals<0)continue;
        var key,valuePart;try{key=decodeURIComponent(pairs[p].slice(0,equals));valuePart=decodeURIComponent(pairs[p].slice(equals+1)).trim();}catch(_){continue;}
        if(/^(?:channelId|chatId|threadId|messageId)$/i.test(key)&&valuePart)return true;
        if(key==='context'&&valuePart){
          try{var context=JSON.parse(valuePart);if(context&&typeof context==='object'&&['channelId','chatId','threadId','messageId'].some(function(k){return typeof context[k]==='string'&&context[k].trim();}))return true;}catch(_){}
        }
      }
    }
    return false;
  }
  function failure(code) { return {ok:false,code:code,message:MESSAGES[code] || MESSAGES.BROWSER_ERROR,snapshots:[],warnings:[],skipped:[]}; }
  function errorCode(error) {
    var number = error && (error.errorNumber || error.number), text = String(error || '');
    if (number===-1743 || /-1743|not authorized to send apple events|not permitted.*apple events|automation.*denied/i.test(text)) return 'AUTOMATION_DENIED';
    if (/javascript[^\n]{0,100}(?:turned off|disabled|not allowed)|allow javascript from apple events|executing javascript through applescript/i.test(text)) return 'JAVASCRIPT_DISABLED';
    return 'BROWSER_ERROR';
  }
  function pageRecord(value) {
    if (!value || typeof value!=='object') return null;
    var parsed=safeURL(value.url); if (!parsed) return null;
    var kind=['auto','assignments','ec'].indexOf(value.kind)>=0 ? value.kind : 'auto';
    return {url:parsed.url,label:boundedText(value.label,100) || 'Teams',kind:kind};
  }
  function validateInput(input) {
    if (!input || typeof input!=='object' || ['pin','capture','sync'].indexOf(input.operation)<0 || ['chrome','edge'].indexOf(input.browser)<0) return null;
    if (input.operation!=='pin' && (typeof input.extractor!=='string' || !input.extractor || input.extractor.length>MAX_EXTRACTOR)) return null;
    if (input.pages != null && !Array.isArray(input.pages)) return null;
    if ((input.pages || []).length>MAX_PAGES) return null;
    var pages=[], seen={};
    for (var i=0;i<(input.pages || []).length;i++) {
      var page=pageRecord(input.pages[i]); if (!page) return null;
      var key=safeURL(page.url).route;
      if (!seen[key]) { pages.push(page); seen[key]=true; }
    }
    return {operation:input.operation,browser:input.browser,pages:pages,extractor:input.extractor || '',selectionOnly:input.selectionOnly===true};
  }
  function injectionScript(extractor, page, selectionOnly) {
    var expected=safeURL(page.url), opts={kind:page.kind,label:page.label,selectionOnly:selectionOnly===true};
    // The URL is checked inside the target tab before the trusted bundled
    // extractor is evaluated, and after it runs. Never eval caller input in JXA.
    return '(function(){"use strict";var expected='+JSON.stringify(expected.route)+';'+
      'function matches(){try{var u=new URL(location.href);return u.protocol==="https:"&&!u.username&&!u.password&&!u.port&&'+
      '["teams.microsoft.com","teams.cloud.microsoft"].indexOf(u.hostname)>=0&&u.pathname+u.search+u.hash===expected;}catch(e){return false;}}'+
      'if(!matches())return JSON.stringify({bridgeError:"ROUTE_CHANGED"});try{'+extractor+'\n'+
      'if(!matches())return JSON.stringify({bridgeError:"ROUTE_CHANGED"});'+
      'var snapshot=window.CampusTeams.extract('+JSON.stringify(opts)+');'+
      'if(!matches())return JSON.stringify({bridgeError:"ROUTE_CHANGED"});return JSON.stringify({snapshot:snapshot});'+
      '}catch(e){return JSON.stringify({bridgeError:"EXTRACTION_ERROR"});}})();';
  }
  function readSnapshot(tab,page,input) {
    var raw;
    try { raw=tab.execute({javascript:injectionScript(input.extractor,page,input.selectionOnly)}); }
    catch(error) { return {error:errorCode(error)}; }
    if (typeof raw!=='string' || !raw || raw.length>MAX_SNAPSHOT) return {error:'INVALID_SNAPSHOT'};
    var value; try { value=JSON.parse(raw); } catch (_) { return {error:'INVALID_SNAPSHOT'}; }
    if (value && value.bridgeError) return {error:value.bridgeError==='ROUTE_CHANGED' ? 'ROUTE_CHANGED' : 'EXTRACTION_ERROR'};
    var snapshot=value && value.snapshot;
    if (!snapshot || typeof snapshot!=='object' || snapshot.source!=='teams' || !matchRoute(snapshot.url,page.url) || !Array.isArray(snapshot.tasks) || !Array.isArray(snapshot.posts) || snapshot.tasks.length>100 || snapshot.posts.length>100 || !Array.isArray(snapshot.warnings)) return {error:'INVALID_SNAPSHOT'};
    // Source and metadata use the exact approved browser route, never a stale
    // URL supplied by the page. Nested DOM content remains validated by Core.
    snapshot.url=safeURL(page.url).url;
    snapshot.coverage='visible';
    snapshot.browser=input.browser;
    snapshot.captureMethod='browser-apple-events';
    snapshot.warnings=snapshot.warnings.slice(0,20).map(function(x){return boundedText(x,400);});
    return {snapshot:snapshot,bytes:raw.length};
  }
  function perform(input,factory) {
    var checked=validateInput(input); if (!checked) return failure('INVALID_INPUT');
    var app;
    try {
      app=factory(checked.browser==='chrome'?'Google Chrome':'Microsoft Edge');
      if (!app.running()) return failure('NOT_RUNNING');
      var windows=app.windows();
      if (!windows.length) return failure('NO_WINDOW');
      if (checked.operation==='pin' || checked.operation==='capture') {
        var active=windows[0].activeTab(), activeURL=safeURL(active.url());
        if (!activeURL) return failure('NOT_TEAMS');
        if (checked.operation==='pin'&&!hasSpecificRoute(activeURL.url)) return failure('AMBIGUOUS_ROUTE');
        var label=boundedText(active.title(),100) || 'Teams';
        var page={url:activeURL.url,label:label,kind:'auto'};
        if (checked.operation==='pin') return {ok:true,page:page,snapshots:[],warnings:[],skipped:[]};
        for(var p=0;p<checked.pages.length;p++) if(matchRoute(checked.pages[p].url,page.url)){page=checked.pages[p];break;}
        // Check tab route again before dispatch; injection independently checks
        // the live location to handle tab navigation between these operations.
        if (!matchRoute(active.url(),page.url)) return failure('ROUTE_CHANGED');
        var captured=readSnapshot(active,page,checked);
        if(captured.error) return failure(captured.error);
        var unavailable=captured.snapshot.loginRequired || captured.snapshot.parseError;
        return {ok:!unavailable,code:unavailable?'PAGE_UNAVAILABLE':undefined,message:unavailable?MESSAGES.PAGE_UNAVAILABLE:undefined,page:page,snapshots:[captured.snapshot],warnings:[],skipped:[]};
      }
      var output={ok:false,snapshots:[],warnings:[],skipped:[]}, tabs=[], outputBytes=0, approvedPages=[];
      for(var selected=0;selected<checked.pages.length;selected++){
        if(hasSpecificRoute(checked.pages[selected].url))approvedPages.push(checked.pages[selected]);
        else output.skipped.push({label:checked.pages[selected].label,code:'AMBIGUOUS_ROUTE'});
      }
      if(output.skipped.length)output.warnings.push(MESSAGES.AMBIGUOUS_ROUTE);
      if(!approvedPages.length){output.code=checked.pages.length?'AMBIGUOUS_ROUTE':'NO_MATCHING_TABS';output.message=MESSAGES[output.code];return output;}
      // Reading tab URLs is needed to identify approved routes. No title or DOM
      // is inspected for unrelated tabs, and no tab is activated or navigated.
      for(var w=0;w<windows.length;w++) {
        var currentTabs=windows[w].tabs();
        for(var t=0;t<currentTabs.length;t++) {
          var candidateURL=safeURL(currentTabs[t].url());
          if(candidateURL) tabs.push({tab:currentTabs[t],url:candidateURL.url});
        }
      }
      for(var j=0;j<approvedPages.length;j++) {
        var approved=approvedPages[j], found=null;
        for(var k=0;k<tabs.length;k++) if(matchRoute(tabs[k].url,approved.url)){found=tabs[k];break;}
        if(!found){output.skipped.push({label:approved.label,code:'TAB_NOT_OPEN'});continue;}
        if(!matchRoute(found.tab.url(),approved.url)){output.skipped.push({label:approved.label,code:'ROUTE_CHANGED'});continue;}
        var read=readSnapshot(found.tab,approved,checked);
        if(read.error){
          output.skipped.push({label:approved.label,code:read.error});
          if(output.warnings.indexOf(MESSAGES[read.error])<0)output.warnings.push(MESSAGES[read.error]);
          if(read.error==='AUTOMATION_DENIED'||read.error==='JAVASCRIPT_DISABLED'){output.code=read.error;output.message=MESSAGES[read.error];break;}
        }else{
          outputBytes+=read.bytes;
          if(outputBytes>MAX_OUTPUT){output.code='OUTPUT_LIMIT';output.message=MESSAGES.OUTPUT_LIMIT;output.warnings.push(MESSAGES.OUTPUT_LIMIT);output.skipped.push({label:approved.label,code:'OUTPUT_LIMIT'});break;}
          output.snapshots.push(read.snapshot);
          if(!read.snapshot.loginRequired&&!read.snapshot.parseError)output.ok=true;
        }
      }
      if(!output.ok&&!output.code){output.code=output.snapshots.length?'PAGE_UNAVAILABLE':'NO_MATCHING_TABS';output.message=MESSAGES[output.code];}
      if(output.skipped.length)output.warnings.push('部分关注页面未读取；同步只读取所选浏览器中已经打开且地址匹配的 Teams 标签页。');
      return output;
    } catch(error) { return failure(errorCode(error)); }
  }
  function runInput(argv,factory) {
    if(!Array.isArray(argv)||argv.length!==1||typeof argv[0]!=='string'||argv[0].length>MAX_INPUT)return JSON.stringify(failure('INVALID_INPUT'));
    var input;try{input=JSON.parse(argv[0]);}catch(_){return JSON.stringify(failure('INVALID_INPUT'));}
    return JSON.stringify(perform(input,factory));
  }
  return {runInput:runInput,perform:perform,safeURL:safeURL,matchRoute:matchRoute,hasSpecificRoute:hasSpecificRoute,injectionScript:injectionScript,validateInput:validateInput,errorCode:errorCode};
})();
function run(argv) {
  return CampusTeamsBrowser.runInput(argv,function(name){return Application(name);});
}
if(typeof module==='object'&&module.exports)module.exports=CampusTeamsBrowser;
