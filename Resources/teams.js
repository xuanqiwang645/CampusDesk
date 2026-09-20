/* CampusDesk Teams adapter. Read-only rendered DOM; no network, cookies or private app state.
   Selectors are best-effort and have NOT been verified against this student's live Teams.
   Unknown layouts fail closed; explicit text selection offers a manual fallback. */
(function (root) {
  'use strict';
  const LIMIT = 100, BODY_LIMIT = 16000;
  const clean = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const multiline = value => String(value == null ? '' : value).replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
  const read = node => node ? multiline(node.innerText == null ? node.textContent : node.innerText) : '';
  const all = (node, selector) => Array.from(node.querySelectorAll(selector));
  const first = (node, selector) => node.querySelector(selector);
  const attr = (node, name) => node && node.getAttribute(name);
  const TEAMS_HOSTS = new Set(['teams.microsoft.com', 'teams.cloud.microsoft']);
  const AUTH_PARAMETER = /^(?:access_token|id_token|refresh_token|token|code|client_secret|assertion|password|passwd|authorization|auth_token|session_token|authkey|sig|signature|session_state)$/i;
  const CARD_SELECTOR = '[data-tid="chat-pane-message"], [data-tid="channel-post"], [data-tid="channel-message"], [data-tid="assignment-card"], [data-tid="assignment-details"]';
  const BODY_SELECTOR = '[data-tid="message-body"], [data-tid="messageBodyContent"], [data-tid="chat-pane-message-body"], [data-tid="channel-post-content"], [data-tid="post-body"]';
  const INSTRUCTION_SELECTOR = '[data-tid="assignment-instructions"], [data-tid="assignment-description"]';
  const TITLE_SELECTOR = '[data-tid="assignment-title"], [data-tid="message-subject"], [data-tid="post-subject"]';
  const DUE_SELECTOR = '[data-tid="assignment-due-date"], [data-tid="due-date"], [data-due-date]';
  function visible(node) {
    if (!node || node.closest('[hidden], [aria-hidden="true"]')) return false;
    if (node.getClientRects && !node.getClientRects().length) return false;
    const view = node.ownerDocument && node.ownerDocument.defaultView;
    if (view && view.getComputedStyle) {
      const style = view.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  }
  function teamsURL(href, base, source) {
    try {
      if (!href || typeof href !== 'string') return null;
      const url = base ? new URL(href, base) : new URL(href);
      if (url.protocol !== 'https:' || !TEAMS_HOSTS.has(url.hostname) || url.port || url.username || url.password) return null;
      if (url.href.length > 4096 || hasAuthParameters(url)) return null;
      // Preserve the exact legitimate Teams route, including SPA hash queries.
      // Never silently strip query data and relabel it as a different page.
      return url.href;
    } catch (_) { return null; }
  }
  function hasAuthParameters(url) {
    const fragment = url.hash.replace(/^#/, '');
    const query = fragment.includes('?') ? fragment.slice(fragment.indexOf('?')+1) : fragment;
    return [url.searchParams,new URLSearchParams(query)].some(params=>[...params.keys()].some(key=>AUTH_PARAMETER.test(key)));
  }
  function attachmentURL(href, base) {
    const teams = teamsURL(href, base, false); if (teams) return teams;
    try {
      if (!href || typeof href !== 'string') return null;
      const url = base ? new URL(href, base) : new URL(href), host = url.hostname.toLowerCase();
      if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
      if (!(host.endsWith('.sharepoint.com') || host.endsWith('.sharepoint.cn') || host === 'onedrive.live.com' || host === '1drv.ms')) return null;
      if (url.href.length > 4096 || hasAuthParameters(url)) return null;
      return url.href;
    } catch (_) { return null; }
  }
  function exactDate(value) {
    const input = clean(value);
    const match = input.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year,month,0)).getUTCDate() || +match[4] > 23 || +match[5] > 59 || +(match[6] || 0) > 59) return null;
    const timestamp = Date.parse(input);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  }
  function hash(value) {
    let result = 2166136261;
    for (let i = 0; i < value.length; i++) { result ^= value.charCodeAt(i); result = Math.imul(result,16777619); }
    return (result >>> 0).toString(16).padStart(8,'0');
  }
  function classify(item, options) {
    const body = [item.title,item.text,item.instructions].map(multiline).join('\n');
    const channel = clean(item.channel || (options && options.label));
    const ecAnnouncement = /\bEC\s+announcements?\b|\bno\s+EC\b|\bEC\b[^\n.]{0,35}\b(?:cancelled|canceled|cancellation|postponed)\b|\bEC\b[^\n。]{0,20}(?:取消|暂停|延期)/i.test(body);
    if ((options && options.kind === 'ec') || /\bEnglish\s+Corner\b/i.test(body+'\n'+channel) || ecAnnouncement || (/\bEC\b/i.test(body) && /名单|分组|\broster\b|\blist\b/i.test(body))) return 'ec';
    // Channel labels seen in user screenshots inform classification only; the
    // message body must still come from a recognized card / explicit selection.
    const homeworkChannel = /(?:^|[>›/])\s*(?:homework|assignments?|作业)\s*$/i.test(channel);
    if (item.assignmentCard || (item.manual && options && options.kind === 'assignments') || homeworkChannel || /\b(?:homework|assignments?)\b|作业|任务要求/i.test(body)) return 'assignment';
    return 'general';
  }
  function taskStatus(value) {
    const label = clean(value);
    if (/^(?:not submitted|not turned in|未提交|待提交|pending)$/i.test(label)) return 'pending';
    if (/^(?:submitted|turned in|已提交)$/i.test(label)) return 'submitted';
    if (/^(?:graded|已评分)$/i.test(label)) return 'graded';
    if (/^(?:returned|已返还)$/i.test(label)) return 'unknown';
    return 'unknown';
  }
  function deadlineLabel(item) {
    if (clean(item.dueLabel)) return clean(item.dueLabel).slice(0,400);
    const lines = multiline(item.instructions || item.text).split('\n');
    const line = lines.find(value => /^\s*(?:due(?:\s+date)?|deadline|截止(?:时间|日期)?|提交截止)\s*[:：]/i.test(value));
    return line ? clean(line).slice(0,400) : null;
  }
  function collect(doc, url, options) {
    options = options || {};
    const page = {url,title:doc.title || '',hasPassword:false,loginField:false,unsupported:false,messages:[],warnings:[],recognized:false,channel:''};
    page.hasPassword = all(doc,'input[type="password"]').some(visible);
    page.loginField = all(doc,'input[name="loginfmt"], input[autocomplete="username"][type="email"]').some(visible);
    // Only short headings/alerts are inspected for a browser gate, never the whole body.
    const gate = all(doc,'h1, h2, [role="alert"]').filter(visible).map(read).filter(x=>x.length<500).join('\n').slice(0,3000);
    page.unsupported = /(?:browser[^\n]{0,50}(?:not supported|isn.t supported|unsupported)|unsupported browser|浏览器[^\n]{0,20}不支持|不支持[^\n]{0,20}浏览器)/i.test(gate);
    page.channel = clean(read(first(doc,'[data-tid="channel-name"], [data-tid="channel-header-title"], [data-tid="chat-header-title"]'))).slice(0,160);
    if (options.selectionOnly) {
      const view = doc.defaultView || root;
      const selection = view && view.getSelection ? String(view.getSelection()) : '';
      if (multiline(selection)) {
        page.recognized = true;
        page.messages.push({text:multiline(selection),channel:page.channel,manual:true,attachments:[]});
      } else page.selectionEmpty = true;
      return page;
    }
    const cards = all(doc,CARD_SELECTOR).filter(visible);
    // Nested assignment cards belong to their message; collect that message once.
    const outer = cards.filter(card=>!cards.some(other=>other!==card && other.contains(card)));
    if (outer.length > LIMIT) page.warnings.push('当前已渲染消息超过 100 条，仅提取其中最后 100 条。');
    for (const card of outer.slice(-LIMIT)) {
      const assignmentCard = card.matches('[data-tid="assignment-card"], [data-tid="assignment-details"]') || Boolean(first(card,'[data-tid="assignment-card"], [data-tid="assignment-details"]'));
      const bodyNode = first(card,BODY_SELECTOR), instructionsNode = first(card,INSTRUCTION_SELECTOR), titleNode = first(card,TITLE_SELECTOR);
      const body = read(bodyNode), instructions = read(instructionsNode), title = clean(read(titleNode));
      if (!body && !(assignmentCard && (instructions || title))) continue;
      page.recognized = true;
      const dueNode = first(card,DUE_SELECTOR), dueTime = dueNode && (dueNode.matches('time[datetime]') ? dueNode : first(dueNode,'time[datetime]'));
      const postedNode = first(card,'[data-tid="message-timestamp"], [data-tid="timestamp"]');
      const postedTime = postedNode && (postedNode.matches('time[datetime]') ? postedNode : first(postedNode,'time[datetime]'));
      const linkNodes = all(card,'a[href]').filter(visible);
      const permalink = linkNodes.find(a=>/\/l\/message\//.test(attr(a,'href') || '') || a.matches('[data-tid="message-permalink"], [data-tid="assignment-link"]'));
      const attachments = [];
      let attachmentCount = all(card,'[data-tid="attachment"], [data-tid="file-attachment"], [data-tid="attachment-card"]').length;
      for (const a of linkNodes) {
        if (a === permalink) continue;
        const href = attr(a,'href'), safe = attachmentURL(href,url);
        const isAttachment = Boolean(a.closest('[data-tid="attachment"], [data-tid="file-attachment"], [data-tid="attachment-card"]')) || Boolean(safe && !teamsURL(safe,url,false));
        if (!isAttachment) continue;
        if (safe) attachments.push({title:clean(read(a) || attr(a,'aria-label')) || '附件',url:safe});
        else attachmentCount++;
      }
      if (attachmentCount > attachments.length) page.warnings.push('部分附件没有可安全导出的文件链接，请在 Teams 原消息中查看。');
      page.messages.push({nativeID:attr(card,'data-message-id') || attr(card,'data-item-id') || attr(card,'id') || null,
        channelID:attr(card,'data-channel-id') || null,channel:page.channel,title,text:body,instructions,assignmentCard,
        author:clean(read(first(card,'[data-tid="message-author-name"], [data-tid="message-author"], [data-tid="post-author"]'))) || null,
        postedAt:attr(postedTime,'datetime') || attr(postedNode,'datetime'),dateLabel:read(postedNode),url:permalink && attr(permalink,'href'),dueLabel:read(dueNode),
        dueDatetime:attr(dueTime,'datetime') || attr(dueNode,'data-due-date'),status:read(first(card,'[data-tid="assignment-status"]')),attachments});
    }
    return page;
  }
  function fromProjection(page, capturedAt, options) {
    options = options || {};
    const url = teamsURL(page.url,null,true);
    const result = {source:'teams',url:url || '',title:clean(page.title).slice(0,200),capturedAt:capturedAt || new Date().toISOString(),
      loginRequired:Boolean(page.hasPassword || page.loginField),parseError:false,warnings:[],coverage:'visible',tasks:[],posts:[]};
    const warn = value=>{if (!result.warnings.includes(value)) result.warnings.push(value);};
    warn('仅同步当前页面已渲染的消息；未展开的正文和未加载的回复可能不完整，展开或滚动后可继续同步。');
    warn('Teams 页面选择器尚未经过你的实际账号验证，无法识别时请手动选取消息文字后同步。');
    if (result.loginRequired) { warn('请先在应用内登录 Microsoft Teams。'); return result; }
    if (!url) { result.parseError=true; warn('只能从 teams.microsoft.com 或 teams.cloud.microsoft 的 HTTPS 页面读取消息。'); return result; }
    if (page.unsupported) { result.parseError=true; warn('Teams 提示当前浏览器不受支持，尚未读取消息。请在支持的浏览器中打开原页面。'); return result; }
    if (options.selectionOnly) warn('手动选取：仅保存你选中的原文，名单、要求和日期未作推断。');
    if (page.selectionEmpty) { result.parseError=true; warn('没有选中的文字。请先在 Teams 页面选中作业要求或 EC 名单原文。'); return result; }
    for (const warning of (page.warnings || []).slice(0,12)) warn(clean(warning).slice(0,250));
    const messages = Array.isArray(page.messages) ? page.messages : [];
    if (messages.length > LIMIT) warn('本次最多保留 100 条已渲染消息。');
    const seen = new Set();
    for (const item of messages.slice(-LIMIT)) {
      if (!item || typeof item !== 'object') continue;
      const body = multiline(item.text), instructions = multiline(item.instructions);
      const title = clean(item.title) || clean(body.split('\n')[0]) || clean(instructions.split('\n')[0]);
      if (!title && !body && !instructions) continue;
      if (body.length > BODY_LIMIT || instructions.length > BODY_LIMIT || title.length > 1500) { warn('有消息超出长度限制，已跳过；请选取需要的部分后同步。'); continue; }
      const channel = clean(item.channel || options.label || page.channel).slice(0,160) || null;
      const scope = clean(item.channelID) || channel || url;
      const key = clean(item.nativeID) ? scope+'|'+clean(item.nativeID) : scope+'|'+title+'|'+body+'|'+instructions;
      const id = 'teams:'+hash(key);
      if (seen.has(id)) continue; seen.add(id);
      const kind = classify(Object.assign({},item,{channel}),options), itemURL = teamsURL(item.url,url,false) || url;
      const attachments = [];
      for (const attachment of (Array.isArray(item.attachments) ? item.attachments : []).slice(0,30)) {
        if (!attachment || typeof attachment !== 'object') continue;
        const safe = attachmentURL(attachment.url,url);
        if (!safe) { warn('部分附件链接含授权参数或不属于已支持的文件域名，请在 Teams 原消息中查看。'); continue; }
        if (!attachments.some(x=>x.url===safe)) attachments.push({title:clean(attachment.title).slice(0,200) || '附件',url:safe});
      }
      result.posts.push({id,title:title.slice(0,160) || 'Teams 消息',text:body || instructions,author:clean(item.author).slice(0,160) || null,
        channel,date:exactDate(item.postedAt),dateLabel:clean(item.dateLabel || item.postedLabel || item.postedAt).slice(0,200) || null,url:itemURL,kind,attachments});
      if (kind !== 'assignment') continue;
      const dueLabel = deadlineLabel(item);
      // Message publication timestamps are deliberately never used as deadlines.
      const dueAt = exactDate(item.dueDatetime);
      result.tasks.push({id,title:title.slice(0,160) || 'Teams 作业',course:channel,dueAt,dueLabel:dueLabel || (dueAt ? clean(item.dueDatetime) : null),
        status:taskStatus(item.status),url:itemURL,requirements:instructions || body || null,attachments});
      if (dueLabel && !dueAt) warn('部分截止时间缺少年份或时区，仅保留原文；请在 Teams 中核对。');
    }
    if (!result.posts.length) {
      result.parseError = true;
      warn('当前页面没有可识别的消息或作业正文。请打开具体频道，或选中原文后使用手动同步。');
    }
    return result;
  }
  function extract(options) {
    options = options && typeof options === 'object' ? options : {};
    if (!root || !root.document) throw new Error('extract requires a browser document; use fromProjection for fixtures.');
    return fromProjection(collect(root.document,root.location.href,options),null,options);
  }
  const api = {extract,collect,fromProjection,classify,taskStatus,exactDate,teamsURL,attachmentURL,hash};
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CampusTeams = api;
})(typeof window !== 'undefined' ? window : null);
