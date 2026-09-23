/* CampusDesk automatic Teams DOM adapter. Reads rendered DOM only.
   Navigation is limited to discovered Teams navigation controls and message
   expansion. No private state, credentials, network requests or message edits. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(null, require('./teams.js'));
  else root.CampusTeamsAuto = factory(root, root.CampusTeams);
})(typeof window !== 'undefined' ? window : null, function (initialWindow, helpers) {
  'use strict';
  var VERSION = 1;
  var LIMITS = {records:300, text:24000, attachments:50, navigation:300, frames:20, clicks:8};
  var BODY = '[data-tid="message-body"], [data-tid="messageBodyContent"], [data-tid="chat-pane-message-body"], [data-tid="channel-post-content"], [data-tid="post-body"]';
  var CARD = '[data-tid="channel-pane-message"], [data-tid="chat-pane-message"], [data-tid="channel-post"], [data-tid="channel-message"], [data-tid="message-pane-message"]';
  var ASSIGNMENT = '[data-tid="assignment-card"], [data-tid="assignment-details"], [data-tid="assignment-detail"]';
  var ATTACHMENT = '[data-tid="attachment"], [data-tid="file-attachment"], [data-tid="attachment-card"], [data-tid="file-attachment-card"], [data-tid="attachment-thumbnail"]';
  var MORE = /^(?:read more|show more|see more|show full message|expand message|展开|显示更多|查看更多|查看更多信息|阅读更多|展开全文|显示全文)$/i;
  var REPLIES = /^(?:(?:show|view|see)(?: all)?(?: \d+)? repl(?:y|ies)|\d+ repl(?:y|ies)|(?:查看|显示|展开)(?:全部|所有)?(?:\s*\d+\s*(?:条)?)?回复|\d+\s*条回复)$/i;
  function clean(value) { return String(value == null ? '' : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/\r\n?/g,'\n').trim(); }
  function short(value, max) { return clean(value).replace(/\s+/g,' ').slice(0,max || 200); }
  function all(node, selector) { try { return Array.from(node.querySelectorAll(selector)); } catch (_) { return []; } }
  function first(node, selector) { return all(node,selector)[0] || null; }
  function attr(node,name) { return node && node.getAttribute ? node.getAttribute(name) || '' : ''; }
  function matches(node,selector) { try { return node.matches(selector); } catch (_) { return false; } }
  function closest(node,selector) { try { return node.closest(selector); } catch (_) { return null; } }
  function read(node) { return node ? clean(node.innerText == null ? node.textContent : node.innerText) : ''; }
  function visible(node) {
    if (!node || closest(node,'[hidden], [aria-hidden="true"]')) return false;
    if (node.getClientRects && !node.getClientRects().length) return false;
    var view = node.ownerDocument && node.ownerDocument.defaultView;
    var style = view && view.getComputedStyle ? view.getComputedStyle(node) : {};
    return style.display !== 'none' && style.visibility !== 'hidden';
  }
  function hash(value) { return helpers.hash(String(value)); }
  function plainText(node) {
    // innerText omits emoji rendered as images. Walk the owned message body,
    // including image alt text, while preserving paragraphs and line breaks.
    function walk(current) {
      if (!current) return '';
      if (current.nodeType === 3) return current.nodeValue || '';
      if (current.nodeType !== 1 && current.nodeType !== 11) return '';
      var tag = String(current.tagName || '').toUpperCase();
      // Emoji sprites may be aria-hidden for screen readers while visibly
      // carrying the entire reply; preserve their alt text before that filter.
      if (tag === 'IMG' && !current.hidden) return attr(current,'alt');
      if (/^(SCRIPT|STYLE|NOSCRIPT|BUTTON|INPUT|TEXTAREA)$/.test(tag) || attr(current,'aria-hidden') === 'true' || current.hidden) return '';
      if (tag === 'BR') return '\n';
      var value = Array.from(current.childNodes || []).map(walk).join('');
      return /^(P|DIV|LI|TR|H[1-6]|BLOCKQUOTE|PRE)$/.test(tag) ? value+'\n' : tag === 'TD' || tag === 'TH' ? value+'\t' : value;
    }
    return clean(walk(node)).replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n');
  }
  function normalizeChannelID(value) { return clean(value).replace(/^channel-(?:shown-|hidden-)?/,''); }
  function sameScope(actual, expected) {
    if (!expected || !expected.id) return false;
    return !!(actual && actual.id && actual.id === expected.id && (!expected.type || expected.type === actual.type) && (!expected.accountId || actual.accountId===expected.accountId));
  }
  function unique(items) {
    var seen = new Set();
    return items.filter(function (item) { if (!item.id || seen.has(item.id)) return false; seen.add(item.id); return true; });
  }
  function exportNav(items) { return items.map(function (item) { var out = {}; Object.keys(item).forEach(function (key) { if (key !== 'node') out[key] = item[key]; }); return out; }); }
  function normalizeRecords(records, scope, url, capturedAt, pageTitle) {
    var out = {source:'teams',coverage:'browser',url:url,title:short(pageTitle),capturedAt:capturedAt || new Date().toISOString(),success:true,
      snapshotId:'browser:'+hash((scope.accountId || '')+'|'+scope.type+'|'+scope.id),accountId:scope.accountId || null,loginRequired:false,parseError:false,warnings:[],tasks:[],posts:[],grades:[],
      coverageMetadata:{adapterVersion:VERSION,scope:scope,renderedOnly:true,fullHistory:false,attachmentContentRead:false,recordsTruncated:records.length>LIMITS.records,textTruncated:false,attachmentsTruncated:false}};
    var seen = new Set();
    records.slice(-LIMITS.records).forEach(function (record) {
      var body = clean(record.text), instructions = clean(record.instructions), attachments = [];
      var title = short(record.title || body.split('\n')[0] || instructions.split('\n')[0],160);
      if (!title && !body && !instructions && !(record.attachments || []).length) return;
      if ((record.attachments || []).length > LIMITS.attachments) out.coverageMetadata.attachmentsTruncated = true;
      (record.attachments || []).slice(0,LIMITS.attachments).forEach(function (attachment) {
        var safe = helpers.attachmentURL(attachment.url,url);
        var item = {id:attachment.id || 'attachment:'+hash(record.nativeID+'|'+attachment.title+'|'+attachments.length),title:short(attachment.title,200) || '附件',url:safe || null,
          kind:attachment.kind === 'image' ? 'image' : 'file',extractionStatus:'unread'};
        if (!attachments.some(function (other) { return other.id === item.id; })) attachments.push(item);
      });
      if (!title) title = attachments[0] ? attachments[0].title : 'Teams 消息';
      var stable = record.nativeID || [title,body,instructions,record.author,record.dateLabel].join('|');
      var id = 'teams:'+hash((scope.accountId || '')+'|'+scope.type+'|'+scope.id+'|'+stable);
      if (seen.has(id)) return; seen.add(id);
      var channel = short(scope.label || scope.name,200) || null;
      var kind = helpers.classify(Object.assign({},record,{channel:channel}),{kind:'auto'});
      if (kind === 'assignment' && (!/[A-Za-z\u3400-\u9fff]/.test(body + instructions) || /^(?:ok(?:ay)?|thanks?|thank you|got it|done|好的?|收到|明白)[\s.!！。]*$/i.test(body))) kind = 'general';
      var itemURL = helpers.teamsURL(record.url,url) || url;
      var clipped = body.length > LIMITS.text || instructions.length > LIMITS.text;
      if (clipped) out.coverageMetadata.textTruncated = true;
      out.posts.push({id:id,title:title,text:(body || instructions).slice(0,LIMITS.text),author:short(record.author,160) || null,
        recipient:scope.type === 'channel' ? short(scope.teamName,200) || null : scope.type === 'chat' ? short(scope.name,200) || null : null,
        channel:channel,date:helpers.exactDate(record.postedAt),dateLabel:short(record.dateLabel || record.postedAt,200) || null,url:itemURL,kind:kind,attachments:attachments,
        nativeID:record.nativeID || null,textTruncated:clipped,messageType:record.messageType || 'message'});
      if (kind === 'assignment') {
        var dueAt = helpers.exactDate(record.dueDatetime);
        var dueLine = clean(record.dueLabel) || (instructions || body).split('\n').find(function (line) { return /^\s*(?:due(?:\s+date)?|deadline|截止(?:时间|日期)?|提交截止)\s*[:：]/i.test(line); });
        out.tasks.push({id:id,title:title,course:channel,dueAt:dueAt,dueLabel:short(dueLine || (dueAt ? record.dueDatetime : ''),400) || null,
          status:helpers.taskStatus(record.status),url:itemURL,requirements:(instructions || body).slice(0,LIMITS.text) || null,attachments:attachments});
      }
    });
    out.warnings.push('浏览器同步覆盖已发现并加载的内容；历史、回复和附件正文尚不能视为全部读取。');
    if (out.posts.some(function (post) { return post.attachments.length; })) out.warnings.push('附件已登记；附件正文尚未读取，图片中的文字尚未识别。');
    if (out.coverageMetadata.textTruncated || out.coverageMetadata.recordsTruncated || out.coverageMetadata.attachmentsTruncated) out.warnings.push('本页部分内容达到读取上限；覆盖报告中已标记。');
    return out;
  }
  function createAdapter(win) {
    function scan() {
      var doc = win.document, url = helpers.teamsURL(win.location.href), teams = [], channels = [], chats = [], sections=[];
      var out = {ok:false,code:'UNKNOWN_LAYOUT',view:'unknown',scope:{type:'unknown',id:'',name:'',label:'',strong:false},teams:[],channels:[],chats:[],sections:[],frames:{total:0,readable:0,inaccessible:0},limits:LIMITS};
      if (!url) { out.code = 'NOT_TEAMS'; return {out:out}; }
      if (all(doc,'input[type="password"], input[name="loginfmt"]').some(visible)) { out.code = 'LOGIN_REQUIRED'; return {out:out}; }
      var avatar = first(doc,'[data-tid="me-control-avatar"] img');
      var identity = attr(avatar,'src').match(/\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i);
      out.accountId = identity ? identity[1].toLowerCase() : null;
      all(doc,'[data-tid="teams-grid-view"] [data-tid$="-team-card"]').filter(visible).forEach(function (node) {
        var button=first(node,'button[data-testid="team-name"]');
        var id=attr(node,'data-tid').replace(/-team-card$/,'');
        var label=short(attr(button,'aria-label') || read(button));
        if (id && button && label) teams.push({id:id,name:label,node:button,expanded:false});
      });
      all(doc,'[data-tid="team-list-item"], [data-tid="team-card"], [data-tid="team-channel-list-item"]').filter(visible).forEach(function (node) {
        var id = attr(node,'data-team-id') || attr(node,'data-sid') || attr(node,'id');
        var label = short(read(first(node,'[data-tid="team-name"], [data-tid="team-card-title"]')) || attr(node,'aria-label') || read(node),200);
        var target = closest(node,'[role="treeitem"]') || node;
        if (id && label) teams.push({id:id,name:label,node:target,expanded:attr(target,'aria-expanded')==='true'});
      });
      all(doc,'[data-tid="channel-list-item"]').filter(visible).forEach(function (node) {
        var id = normalizeChannelID(attr(node,'data-sid') || attr(node,'data-channel-id'));
        var label = short(read(first(node,'[data-tid^="channel-list-item-text-"]')) || attr(node,'aria-label') || read(node));
        var target = closest(node,'[role="treeitem"]') || node;
        if (id && label) channels.push({id:id,name:label,node:target,selected:attr(target,'aria-selected')==='true'});
      });
      all(doc,'[data-tid="chat-list-item"], [data-tid="chat-list-item-link"], [data-tid="chat-list-item-wrapper"]').filter(visible).forEach(function (node) {
        var id = attr(node,'data-chat-id') || attr(node,'data-thread-id') || attr(node,'data-sid') || attr(node,'id');
        var target = closest(node,'[role="treeitem"], [role="listitem"]') || node;
        var label = short(read(first(node,'[data-tid="chat-list-item-title"], [data-tid="chat-list-item-name"]')) || attr(node,'aria-label') || read(node));
        if (id && label) chats.push({id:id,name:label,node:target,selected:attr(target,'aria-selected')==='true'});
      });
      all(doc,'[data-testid="simple-collab-rail"] [data-testid="list-item"][data-item-type="chat"]').filter(visible).forEach(function (node) {
        var title=first(node,'span[id^="title-chat-list-item_"]');
        var id=attr(title,'id').replace(/^title-chat-list-item_/,'');
        var selected=false, raw=attr(node,'data-tabster');
        try {
          var tabster=raw.length<10000 ? JSON.parse(raw) : null;
          var names=tabster && tabster.observed && tabster.observed.names;
          selected=Array.isArray(names) && names.includes(id) && names.includes('LeftRailSelectedItem');
        } catch (_) {}
        var label=short(read(title));
        if (id && label) chats.push({id:id,name:label,node:node,selected:selected});
      });
      teams = unique(teams); channels = unique(channels); chats = unique(chats);
      out.navigationTruncated={teams:teams.length>LIMITS.navigation,channels:channels.length>LIMITS.navigation,chats:chats.length>LIMITS.navigation};
      teams=teams.slice(0,LIMITS.navigation); channels=channels.slice(0,LIMITS.navigation); chats=chats.slice(0,LIMITS.navigation);
      out.teams = exportNav(teams); out.channels = exportNav(channels); out.chats = exportNav(chats);
      var header = short(read(all(doc,'[data-tid="channelTitle-text"], [data-tid="channel-header-title"], [data-tid="channel-name"]').find(visible)));
      var chatHeader = short(read(all(doc,'[data-tid="chat-header-title"], [data-tid="chat-title"]').find(visible)));
      var selectedChannels = channels.filter(function (item) { return item.selected; }), selectedChats = chats.filter(function (item) { return item.selected; });
      var teamMenu = all(doc,'[data-tid^="team-context-menu-more-button-"]').filter(visible);
      var teamID = teamMenu.length===1 ? attr(teamMenu[0],'data-tid').replace('team-context-menu-more-button-','') : '';
      var teamName = '';
      if (teamMenu.length===1) {
        var teamHeader=teamMenu[0].parentElement;
        for (var teamDepth=0;teamHeader && teamDepth<3 && !teamName;teamDepth++,teamHeader=teamHeader.parentElement) {
          var labels=all(teamHeader,'span[title]').filter(visible);
          if (labels.length===1) teamName=short(attr(labels[0],'title'));
        }
      }
      all(doc,'[data-tid="app-layout-area--mid-nav"] [role="treeitem"]').filter(visible).forEach(function (node) {
        var name=short(read(node)), kind=/^(?:作业|Assignments)$/i.test(name) ? 'assignments' : /^(?:评分|Grades)$/i.test(name) ? 'grades' : '';
        if (kind && teamID) sections.push({id:teamID+':'+kind,kind:kind,name:name,node:node,selected:attr(node,'aria-selected')==='true'});
      });
      out.sections=exportNav(sections);
      var selectedSections=sections.filter(function (item) { return item.selected; });
      var selected = header && selectedChannels.length===1 && selectedChannels[0].name===header ? selectedChannels[0] : null;
      if (!selected && header) { var named = channels.filter(function (item) { return item.name===header; }); if (named.length===1) selected=named[0]; }
      if (header) out.scope={type:'channel',id:selected ? selected.id : 'header:'+hash(teamID+'|'+header),name:header,label:(teamName ? teamName+' > ' : '')+header,teamID:teamID,teamName:teamName,strong:!!selected};
      else if (selectedChats.length===1 && chatHeader && selectedChats[0].name===chatHeader) out.scope={type:'chat',id:selectedChats[0].id,name:chatHeader,label:chatHeader,strong:true};
      else if (chatHeader) out.scope={type:'chat',id:'header:'+hash(chatHeader),name:chatHeader,label:chatHeader,strong:false};
      else if (selectedSections.length===1) out.scope={type:'section',id:selectedSections[0].id,name:selectedSections[0].name,label:(teamName ? teamName+' > ' : '')+selectedSections[0].name,teamID:teamID,teamName:teamName,strong:true};
      out.scope.accountId=out.accountId;
      out.team={id:teamID,name:teamName};
      out.section=selectedSections.length===1 ? exportNav(selectedSections)[0] : null;
      out.navigationViews={teams:all(doc,'[data-tid="teams-grid-view"]').some(visible),channels:!!teamID && all(doc,'[data-tid="app-layout-area--mid-nav"]').some(visible),chats:all(doc,'[data-testid="simple-collab-rail"], [data-tid="simple-collab-dnd-rail"]').some(visible)};
      var docs = [doc];
      var frames = all(doc,'iframe').filter(visible); out.frames.total=frames.length;
      frames.slice(0,LIMITS.frames).forEach(function (frame) {
        try {
          var frameURL = new URL(attr(frame,'src') || url,url);
          if (frameURL.origin !== new URL(url).origin) { out.frames.inaccessible++; return; }
          var frameDoc = frame.contentDocument;
          if (!frameDoc || !frameDoc.defaultView || frameDoc.defaultView.location.origin !== new URL(url).origin) { out.frames.inaccessible++; return; }
          docs.push(frameDoc); out.frames.readable++;
        } catch (_) { out.frames.inaccessible++; }
      });
      out.frames.truncated = frames.length>LIMITS.frames;
      var records=[], bodies=[], cards=[], expand=[];
      docs.forEach(function (currentDoc) {
        all(currentDoc,BODY).filter(visible).forEach(function (body) {
          // A body can nest a formatting span but only its outer recognized body is a record.
          if (closest(body.parentElement,BODY)) return;
          var card=closest(body,CARD); if (!card) return;
          bodies.push(body); if (!cards.includes(card)) cards.push(card);
          var nativeID=attr(body,'id') || attr(body,'data-message-id');
          // Replies share channel-pane-message with their parent. Use the nearest
          // smaller wrapper containing exactly this message body for metadata.
          var owned=body, parent=body.parentElement;
          while (parent && parent!==card && all(parent,BODY).length===1) { owned=parent; parent=parent.parentElement; }
          if (all(card,BODY).length===1) owned=card;
          var attachments=collectAttachments(owned,body,url);
          var messageMillis=nativeID.match(/(?:content-|message-body-)(\d+)$/);
          var nativeTime=messageMillis && currentDoc.getElementById ? currentDoc.getElementById('timestamp-'+messageMillis[1]) : null;
          var nativeAuthor=messageMillis && currentDoc.getElementById ? currentDoc.getElementById('author-'+messageMillis[1]) : null;
          var time=nativeTime || first(owned,'[data-tid="message-timestamp"], [data-tid="timestamp"], time');
          var date=attr(time,'datetime') || attr(first(time,'time[datetime]'),'datetime');
          var permalink=all(owned,'a[href]').find(function (a) { return /\/l\/message\//.test(attr(a,'href')); });
          records.push({nativeID:nativeID || attr(owned,'data-message-id') || attr(owned,'id') || attr(card,'id'),text:plainText(body),
            title:read(first(owned,'[data-tid="subject-line"], [data-tid="message-subject"], [data-tid="post-subject"]')),author:read(nativeAuthor || first(owned,'[data-tid="message-author-name"], [data-tid="message-author"], [data-tid="post-author"]')),
            dateLabel:read(time) || attr(time,'aria-label'),postedAt:date,url:permalink && attr(permalink,'href'),attachments:attachments});
        });
        all(currentDoc,ASSIGNMENT).filter(visible).forEach(function (card) {
          if (closest(card.parentElement,ASSIGNMENT)) return;
          var instructions=first(card,'[data-tid="assignment-instructions"], [data-tid="assignment-description"]');
          var due=first(card,'[data-tid="assignment-due-date"], [data-tid="due-date"], [data-due-date]');
          var link=first(card,'[data-tid="assignment-link"][href]');
          records.push({nativeID:attr(card,'data-assignment-id') || attr(card,'id'),assignmentCard:true,title:read(first(card,'[data-tid="assignment-title"]')),
            instructions:plainText(instructions),text:plainText(instructions),dueLabel:read(due),dueDatetime:attr(due,'data-due-date') || attr(first(due,'time[datetime]'),'datetime'),
            status:read(first(card,'[data-tid="assignment-status"]')),url:link && attr(link,'href'),attachments:collectAttachments(card,instructions,url)});
        });
        all(currentDoc,CARD).filter(visible).forEach(function (card) {
          if (first(card,BODY) || closest(card.parentElement,CARD)) return;
          var attachments=collectAttachments(card,card,url);
          if (attachments.length) records.push({nativeID:attr(card,'data-message-id') || attr(card,'id'),text:'',attachments:attachments});
        });
        all(currentDoc,'[data-tid="control-message-renderer"]').filter(visible).forEach(function (node) {
          records.push({nativeID:attr(node,'id'),text:plainText(first(node,'[id^="content-control-message-"]') || node),messageType:'system',attachments:[]});
        });
      });
      cards.forEach(function (card) {
        all(card,'button, [role="button"]').filter(visible).forEach(function (node) {
          var label=short(attr(node,'aria-label') || read(node),160);
          var response=attr(node,'data-tid')==='response-summary-button';
          if (!(MORE.test(label) || REPLIES.test(label) || response) || !safeButton(node) || attr(node,'aria-expanded')==='true' || closest(node,CARD)!==card) return;
          expand.push({node:node,id:'expand:'+hash(out.scope.id+'|'+(attr(card,'id') || attr(card,'data-message-id') || short(read(first(card,BODY)),120))+'|'+attr(node,'data-tid')+'|'+label),kind:response || REPLIES.test(label) ? 'replies' : 'text'});
        });
      });
      var empty=all(doc,'[data-tid="channel-empty-state"], [data-tid="chat-empty-state"]').some(visible);
      if (header) out.view='channel'; else if (chatHeader || selectedChats.length) out.view='chat'; else if (selectedSections.length) out.view='section'; else if (teams.length || channels.length) out.view='teams'; else if (chats.length) out.view='chats';
      out.ok=!!(records.length || empty || teams.length || channels.length || chats.length || out.navigationViews.teams || out.navigationViews.channels || out.navigationViews.chats || first(doc,'[data-tid="app-bar-wrapper"]'));
      out.code=records.length ? 'OK' : empty ? 'EMPTY_CHANNEL' : out.ok ? 'NAVIGATION_ONLY' : 'UNKNOWN_LAYOUT';
      if (all(doc,'#hubErrorUi, [data-tid="platform-error"]').some(visible)) { out.code='PLATFORM_ERROR'; out.platformError=true; }
      out.expandAvailable=expand.length;
      out.expandTargets=expand.map(function (item) { return {id:item.id,kind:item.kind}; });
      if (out.scope.id && (records.length || empty)) {
        out.snapshot=normalizeRecords(records,out.scope,url,null,doc.title);
        out.snapshot.coverageMetadata.frames=out.frames;
        out.snapshot.coverageMetadata.empty=empty;
        out.snapshot.coverageMetadata.collapsedControls=expand.length;
        out.snapshot.coverageMetadata.strongScope=out.scope.strong;
      }
      var scroll=findScroller(bodies,doc);
      out.scroll=scrollState(scroll);
      var navScroll={teams:findNavigationScroller(teams,doc),channels:findNavigationScroller(channels,doc),chats:findNavigationScroller(chats,doc)};
      out.navigationScroll={teams:scrollState(navScroll.teams),channels:scrollState(navScroll.channels),chats:scrollState(navScroll.chats)};
      var hidden=all(doc,'[data-tid="app-layout-area--mid-nav"] #single-team-hidden-channels').filter(visible);
      out.hiddenChannels={available:hidden.length===1,expanded:hidden.length===1 && attr(hidden[0],'aria-expanded')==='true'};
      return {out:out,teams:teams,channels:channels,chats:chats,sections:sections,expand:expand,scroll:scroll,navigationScroll:navScroll,hidden:hidden.length===1 ? hidden[0] : null,doc:doc};
    }
    function collectAttachments(owned,body,url) {
      var attachments=[], candidates=all(owned,ATTACHMENT);
      candidates=candidates.filter(function (node) { return !candidates.some(function (other) { return other!==node && other.contains(node); }); });
      candidates.forEach(function (node,index) {
        var link=matches(node,'a[href]') ? node : first(node,'a[href]');
        attachments.push({id:attr(node,'data-item-id') || attr(node,'id') || 'file:'+hash(short(read(node),200)+'|'+index),title:short(read(node) || attr(node,'aria-label') || attr(node,'title'),200) || '附件',url:link && attr(link,'href'),kind:'file'});
      });
      all(owned,'a[href]').forEach(function (link) {
        if (closest(link,ATTACHMENT)) return;
        var safe=helpers.attachmentURL(attr(link,'href'),url);
        if (safe && !helpers.teamsURL(safe)) attachments.push({id:'link:'+hash(safe),title:short(read(link) || attr(link,'aria-label')) || '附件',url:safe,kind:'file'});
      });
      all(body,'img').forEach(function (img,index) {
        var alt=attr(img,'alt'), src=attr(img,'src');
        var emoji=/emoji|emoticon|sticker/i.test(attr(img,'data-tid')+' '+attr(img,'class')+' '+src) || /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D\s]+$/u.test(alt);
        if (emoji) return;
        attachments.push({id:'image:'+hash(attr(img,'id') || alt+'|'+index),title:short(alt) || '消息图片',url:helpers.attachmentURL(src,url),kind:'image'});
      });
      return attachments;
    }
    function safeButton(node) { return !(node.disabled || attr(node,'disabled') || attr(node,'aria-disabled')==='true' || attr(node,'type').toLowerCase()==='submit' || attr(node,'aria-haspopup') || closest(node,'form, [role="menu"], [data-tid="message-reactions"], [contenteditable="true"]') || matches(node,'input, textarea')); }
    function findScroller(bodies,doc) {
      var known=all(doc,'[data-tid="message-pane-list-viewport"]').filter(visible);
      if (known.length===1 && known[0].clientHeight>0 && known[0].scrollHeight>known[0].clientHeight+10) return known[0];
      if (!bodies.length) return null;
      var node=bodies[0].parentElement;
      for (var depth=0;node && depth<30;depth++,node=node.parentElement) {
        if (node===doc.body || node===doc.documentElement) break;
        var style=win.getComputedStyle(node);
        if (/auto|scroll/.test(style.overflowY || '') && node.scrollHeight>node.clientHeight+10 && node.clientHeight>0 && bodies.every(function (body) { return node.contains(body); })) return node;
      }
      return null;
    }
    function findNavigationScroller(items,doc) {
      if (!items.length) return null;
      var node=items[0].node.parentElement;
      for (var depth=0;node && depth<25;depth++,node=node.parentElement) {
        if (node===doc.body || node===doc.documentElement) break;
        var style=win.getComputedStyle(node);
        if (/auto|scroll/.test(style.overflowY || '') && node.scrollHeight>node.clientHeight+10 && node.clientHeight>0 && items.every(function (item) { return node.contains(item.node); })) return node;
      }
      return null;
    }
    function scrollState(node) {
      if (!node) return {available:false};
      var reverse=win.getComputedStyle(node).flexDirection==='column-reverse' || node.scrollTop<0;
      return {available:true,position:Number(node.scrollTop)||0,height:Number(node.scrollHeight)||0,viewport:Number(node.clientHeight)||0,reverse:reverse};
    }
    function run(request) {
      request=request && typeof request==='object' ? request : {action:'inspect'};
      var state=scan(), out=state.out;
      if (request.action==='inspect' || !request.action) return out;
      if (!out.ok) return out;
      if (request.expectedScope && !sameScope(out.scope,request.expectedScope)) return Object.assign(out,{ok:false,code:'SCOPE_CHANGED'});
      var node=null, nav;
      if (request.action==='openTeams' || request.action==='openChats') {
        if (request.action==='openTeams') node=all(state.doc,'button[data-track-action-scenario="schoolAppNavigateToAllTeams"]').filter(visible)[0] || null;
        var navRoot=first(state.doc,'[data-tid="app-bar-wrapper"]');
        var wanted=request.action==='openTeams' ? /^(?:团队|Teams)(?:\s*[（(].*)?$/i : /^(?:聊天|Chat)(?:\s*[（(].*)?$/i;
        nav=all(navRoot,'button, [role="button"]').filter(visible).filter(function (item) { return wanted.test(short(attr(item,'aria-label') || read(item))) && safeButton(item); });
        if (!node && nav.length===1) node=nav[0];
      } else if (request.action==='openTeam' || request.action==='openChannel' || request.action==='openChat' || request.action==='openSection') {
        var collection=request.action==='openTeam' ? state.teams : request.action==='openChannel' ? state.channels : request.action==='openChat' ? state.chats : state.sections;
        var id=request.action==='openTeam' ? request.teamID : request.action==='openChannel' ? request.channelID : request.action==='openChat' ? request.chatID : request.sectionID;
        nav=collection.filter(function (item) { return item.id===id; });
        if (nav.length===1 && safeButton(nav[0].node)) node=nav[0].node;
        if (nav.length===1 && (nav[0].selected || request.action==='openTeam' && nav[0].expanded)) return Object.assign(out,{code:'ALREADY_OPEN',action:{clicked:0,targetID:id}});
      } else if (request.action==='revealHiddenChannels') {
        if (!state.hidden || out.hiddenChannels.expanded) return Object.assign(out,{code:'NO_HIDDEN_CHANNELS'});
        node=safeButton(state.hidden) ? state.hidden : null;
      } else if (request.action==='scrollNavigation') {
        var navigationTarget=['teams','channels','chats'].includes(request.target) ? state.navigationScroll[request.target] : null;
        if (!navigationTarget) return Object.assign(out,{code:'NO_NAVIGATION_SCROLL_CONTAINER'});
        var navBefore=scrollState(navigationTarget), navAmount=Math.max(240,navBefore.viewport*0.8);
        navigationTarget.scrollTop=navBefore.position+(request.direction==='previous' ? -navAmount : navAmount);
        var navAfter=scrollState(navigationTarget);
        return Object.assign(out,{code:'NAVIGATION_SCROLLED',scroll:Object.assign(navAfter,{before:navBefore.position,moved:Math.abs(navAfter.position-navBefore.position)>1,atBoundary:Math.abs(navAfter.position-navBefore.position)<=1})});
      } else if (request.action==='expand') {
        if (!request.expectedScope || !out.scope.strong || !sameScope(out.scope,request.expectedScope)) return Object.assign(out,{ok:false,code:'SCOPE_REQUIRED'});
        var count=Math.min(LIMITS.clicks,Math.max(1,Number(request.maxClicks)||1));
        var clicked=0;
        for (var i=0;i<state.expand.length && clicked<count;i++) {
          if (request.expansionID && state.expand[i].id!==request.expansionID) continue;
          if (!sameScope(scan().out.scope,request.expectedScope)) break;
          if (visible(state.expand[i].node) && safeButton(state.expand[i].node)) { state.expand[i].node.click(); clicked++; }
        }
        return Object.assign(out,{code:clicked ? 'EXPANDED' : 'NO_EXPAND_CONTROLS',action:{clicked:clicked}});
      } else if (request.action==='scroll') {
        if (!request.expectedScope || !out.scope.strong || !sameScope(out.scope,request.expectedScope)) return Object.assign(out,{ok:false,code:'SCOPE_REQUIRED'});
        if (!state.scroll) return Object.assign(out,{code:'NO_SCROLL_CONTAINER'});
        var before=scrollState(state.scroll), amount=Math.max(240,before.viewport*0.8);
        var older=request.direction!=='newer';
        var target=before.position+(older ? -amount : amount);
        if (before.reverse) target=older ? before.position-amount : before.position+amount;
        state.scroll.scrollTop=target;
        var after=scrollState(state.scroll);
        return Object.assign(out,{code:'SCROLLED',scroll:Object.assign(after,{before:before.position,moved:Math.abs(after.position-before.position)>1,direction:older?'older':'newer',atBoundary:Math.abs(after.position-before.position)<=1})});
      } else return Object.assign(out,{ok:false,code:'UNSUPPORTED_ACTION'});
      if (!node) return Object.assign(out,{ok:false,code:'NAVIGATION_NOT_FOUND'});
      node.click();
      return Object.assign(out,{code:'NAVIGATED',action:{clicked:1,targetID:request.teamID || request.channelID || request.chatID || request.sectionID || request.action}});
    }
    return {run:run};
  }
  var live=initialWindow ? createAdapter(initialWindow) : null;
  return {version:VERSION,limits:LIMITS,run:function (request) { if (!live) throw new Error('A browser window is required'); return live.run(request); },createAdapter:createAdapter,plainText:plainText,normalizeRecords:normalizeRecords,normalizeChannelID:normalizeChannelID,sameScope:sameScope};
});
