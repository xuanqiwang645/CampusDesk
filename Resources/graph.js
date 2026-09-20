/* Microsoft Graph response normalization. Pure data handling: no requests, DOM insertion,
   credentials, or executable HTML. Works in WKWebView and Node fixture tests. */
(function (root, factory) {
  'use strict';
  const core = typeof module === 'object' && module.exports ? require('./core.js') : root.CampusCore;
  const api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CampusGraph = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  const MAX_ROWS = 3000, MAX_TEXT = 30000;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const text = value => typeof value === 'string' ? value : '';
  const list = value => Array.isArray(value) ? value : [];
  function decodeEntities(value) {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', bull: '•', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };
    return text(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, entity) => {
      if (entity[0] !== '#') return own(named, entity.toLowerCase()) ? named[entity.toLowerCase()] : all;
      const cp = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '�';
    });
  }
  function cleanHTML(value) {
    return text(value).replace(/<!--[\s\S]*?(?:-->|$)/g, '')
      .replace(/<(script|style|head|iframe|object|svg|math|noscript)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '');
  }
  function plainHTML(value) {
    const clean = cleanHTML(value)
      .replace(/<(?:br|hr)\b[^>]*\/?\s*>/gi, '\n')
      .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote|section)\s*>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '• ')
      .replace(/<\/(?:td|th)\s*>/gi, '\t')
      .replace(/<[^>]*>/g, '');
    return decodeEntities(clean).replace(/\r\n?/g, '\n').replace(/[\t ]+\n/g, '\n').replace(/\n[\t ]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function bodyText(body) {
    const item = object(body);
    return text(item.contentType).toLowerCase() === 'html' ? plainHTML(item.content) : text(item.content).trim();
  }
  function iso(value) {
    const s = text(value);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/i.test(s)) return '';
    const day = new Date(s.slice(0, 10) + 'T00:00:00Z');
    if (!Number.isFinite(day.valueOf()) || day.toISOString().slice(0, 10) !== s.slice(0, 10)) return '';
    if (Number(s.slice(11, 13)) > 23 || Number(s.slice(14, 16)) > 59 || Number(s.slice(17, 19)) > 59) return '';
    const offset = s.match(/[+-](\d{2}):(\d{2})$/);
    if (offset && (Number(offset[1]) > 14 || Number(offset[2]) > 59 || (Number(offset[1]) === 14 && Number(offset[2]) !== 0))) return '';
    return Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : '';
  }
  function graphID(kind, ...parts) {
    if (parts.some(p => typeof p !== 'string' || !p || p.length > 400 || /[\u0000-\u001f]/.test(p))) return '';
    const value = 'teams:graph:' + kind + ':' + parts.map(encodeURIComponent).join(':');
    return value.length <= 512 ? value : '';
  }
  function messageID(batch, message, parentID) {
    if (batch.kind === 'chatMessages') return graphID('chat', text(object(batch.chat).id), text(message.id));
    const rootId = text(parentID) || text(message.replyToId) || text(batch.rootMessageId);
    const base = graphID('channel', text(object(batch.team).id), text(object(batch.channel).id), rootId || text(message.id));
    return rootId ? (base && base + ':reply:' + encodeURIComponent(text(message.id))) : base;
  }
  function addAttachment(out, title, url) {
    const safe = Core.safeAttachmentURL(text(url));
    if (safe && !out.some(item => item.url === safe) && out.length < 100) out.push({ title: (text(title).trim() || '附件').slice(0, 500), url: safe });
  }
  function htmlAttachments(body, out) {
    if (text(object(body).contentType).toLowerCase() !== 'html') return;
    // Parse only observed link attributes; never create a document or load hosted images.
    const html = cleanHTML(object(body).content);
    for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
      const href = match[1].match(/(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      if (href) addAttachment(out, plainHTML(match[2]), decodeEntities(href[1] ?? href[2] ?? href[3]));
    }
  }
  function attachments(message, resources, fallbackURL, warn) {
    const out = [];
    htmlAttachments(message.body || message.instructions, out);
    function resource(title, value) {
      const safe = Core.safeAttachmentURL(text(value));
      if (safe) addAttachment(out, title, safe);
      else if (text(title) || text(value)) {
        const fallback = Core.safeURL(fallbackURL, 'teams');
        if (fallback && out.length < 100) out.push({ title: (text(title).trim() || '附件').slice(0, 480) + '（Teams 原文）', url: fallback });
        if (warn) warn('部分附件仅能通过 Teams 原文打开；尚未下载附件内容。');
      }
    }
    for (const item of list(message.attachments)) resource(item.name || item.displayName, item.contentUrl || item.webUrl);
    for (const item of list(resources)) {
      const r = object(item.resource || item);
      resource(r.displayName, r.fileUrl || r.link || r.webUrl);
    }
    return out;
  }
  function classify(channel, title, body) {
    const s = [channel, title, body].join('\n');
    if (/\benglish\s*corner\b|\bEC\s*(?:roster|list|schedule)\b|\bEC\s*(?:名单|安排)|英语角/i.test(s) || /^\s*EC\s*$/i.test(channel)) return 'ec';
    if (/\b(?:assignment|homework|coursework)\b|作业|提交要求|截止时间/i.test(title + '\n' + body)) return 'assignment';
    return 'general';
  }
  function snapshotURL(batch) {
    const team = object(batch.team), channel = object(batch.channel), chat = object(batch.chat), assignment = object(batch.assignment), cls = object(batch.class);
    if (batch.kind === 'channelMessages' && text(channel.id) && text(team.id)) return 'https://teams.microsoft.com/l/channel/' + encodeURIComponent(channel.id) + '/channel?groupId=' + encodeURIComponent(team.id);
    if (batch.kind === 'chatMessages' && text(chat.id)) return 'https://teams.microsoft.com/l/chat/' + encodeURIComponent(chat.id) + '/conversations';
    if (batch.kind === 'assignment' && text(assignment.id) && text(cls.id || assignment.classId || team.id)) return 'https://teams.microsoft.com/?campusdesk=graph-class&classId=' + encodeURIComponent(cls.id || assignment.classId || team.id);
    return '';
  }
  function normalizeOne(input) {
    const batch = object(input), warnings = list(batch.warnings).filter(w => typeof w === 'string').map(w => w.slice(0, 2000)).slice(0, 80);
    const coverage = { channels: 0, chats: 0, assignments: 0, messages: 0, complete: batch.kind !== 'assignment' && batch.complete === true, capped: false };
    function warn(message) { if (!warnings.includes(message) && warnings.length < 100) warnings.push(message); }
    function clip(value, length, label) {
      const s = text(value);
      if (s.length <= length) return s;
      coverage.capped = true; coverage.complete = false;
      warn(label + '内容超过本地长度上限，请在 Teams 查看原文。');
      return s.slice(0, length);
    }
    const capturedAt = iso(batch.capturedAt), url = snapshotURL(batch);
    if (!capturedAt || !url || !['channelMessages', 'chatMessages', 'assignment'].includes(batch.kind)) {
      throw new Error('Graph 数据缺少来源标识或有效时间，本次未导入。');
    }
    const channel = object(batch.channel), team = object(batch.team), chat = object(batch.chat), cls = object(batch.class);
    const label = text(channel.displayName) || text(chat.topic) || text(cls.displayName) || text(team.displayName) || 'Teams';
    const snapshot = { source: 'teams', url, title: clip(label, 500, '名称'), capturedAt, coverage: 'graph', graphComplete: coverage.complete,
      graphDeletedIDs: [], warnings, loginRequired: false, tasks: [], posts: [], feedback: [], grades: [] };
    const seen = new Set();
    function addMessage(raw, parentID) {
      const message = object(raw), id = messageID(batch, message, parentID);
      if (!id || id.length > 512 || !text(message.id)) { warn('一条消息缺少有效 ID，已跳过。'); coverage.complete = false; return; }
      if (seen.has(id)) return;
      seen.add(id);
      if (message.deletedDateTime) {
        if (snapshot.graphDeletedIDs.length < MAX_ROWS) snapshot.graphDeletedIDs.push(id);
        else { coverage.capped = true; coverage.complete = false; warn('删除记录超过本地批次上限，需继续同步。'); }
        return;
      }
      if (message.messageType && !['message', 'unknownFutureValue'].includes(message.messageType)) return;
      let content = bodyText(message.body);
      const originURL = Core.safeURL(message.webUrl, 'teams') || Core.safeURL(channel.webUrl, 'teams') || Core.safeURL(chat.webUrl, 'teams') || url;
      const files = attachments(message, null, originURL, warn);
      if (/<(?:img|video|audio)\b/i.test(text(object(message.body).content))) {
        content += (content ? '\n\n' : '') + '[图片或影音内容：请在 Teams 原文查看]';
        warn('图片、影音和附件内容保留 Teams 入口，尚未转换为文字。');
      }
      if (!content && !text(message.subject) && !files.length) {
        for (const reply of list(message.replies)) addMessage(reply, text(message.id));
        return;
      }
      if (snapshot.posts.length >= MAX_ROWS) {
        coverage.capped = true; coverage.complete = false; warn('此频道超过 3000 条本地缓存上限，其余消息请在 Teams 查看。'); return;
      }
      const isReply = !!(parentID || message.replyToId || batch.rootMessageId);
      const title = text(message.subject).trim() || (isReply ? '回复 · ' : '') + (content.split('\n').find(Boolean) || '附件');
      const messageURL = originURL;
      const date = iso(message.createdDateTime);
      if (message.createdDateTime && !date) warn('一条消息的发布时间格式无法确认。');
      snapshot.posts.push({ id, title: clip(title, 500, '消息标题'), text: clip(content, MAX_TEXT, '消息'), url: messageURL,
        author: clip(text(object(object(message.from).user).displayName) || text(object(object(message.from).application).displayName), 300, '作者'),
        channel: clip(label, 300, '频道名称'), date, dateLabel: date, kind: classify(label, title, content), attachments: files,
        replyToId: isReply ? graphID('channel', text(team.id), text(channel.id), text(parentID || message.replyToId || batch.rootMessageId)) : '',
        capturedAt });
      coverage.messages += 1;
      for (const reply of list(message.replies)) addMessage(reply, text(message.id));
    }
    if (batch.kind === 'channelMessages' || batch.kind === 'chatMessages') {
      coverage[batch.kind === 'channelMessages' ? 'channels' : 'chats'] = 1;
      for (const item of list(batch.messages)) addMessage(item);
    } else {
      const assignment = object(batch.assignment), classId = text(cls.id || assignment.classId || team.id), aid = graphID('assignment', classId, text(assignment.id));
      if (!aid) throw new Error('作业缺少有效 ID，本次未导入。');
      const title = clip(text(assignment.displayName).trim() || '未命名作业', 500, '作业标题');
      const due = iso(assignment.dueDateTime);
      if (assignment.dueDateTime && !due) warn('作业截止时间缺少明确时区或格式无效，未安排截止提醒。');
      const provided = Array.isArray(batch.providedFields) ? batch.providedFields : ['instructions', 'resources', 'submissions'].filter(key => own(assignment, key));
      const url = Core.safeURL(assignment.webUrl, 'teams') || Core.safeURL(assignment.moduleUrl, 'teams') || 'https://teams.microsoft.com/';
      const candidates = list(assignment.submissions).filter(s => {
        // Native limits the endpoint to the signed-in student's own submissions;
        // when an explicit recipient exists, enforce that boundary again here.
        const recipient = object(s.recipient);
        return !recipient.userId || (!!batch.userId && recipient.userId === batch.userId);
      });
      const submission = candidates.sort((a, b) => (Date.parse(b.lastModifiedDateTime) || 0) - (Date.parse(a.lastModifiedDateTime) || 0))[0];
      const submissionStatus = text(object(submission).status);
      const status = ['submitted', 'returned', 'excused'].includes(submissionStatus) ? 'submitted' : submissionStatus === 'reassigned' ? 'reassigned' : 'open';
      const task = { id: aid, title, course: clip(text(cls.displayName || team.displayName), 300, '班级名称'), dueAt: due || null,
        dueLabel: due ? '' : '未提供明确截止时间', status, submissionStatus, url,
        requirements: clip(bodyText(assignment.instructions), MAX_TEXT, '作业要求'), attachments: attachments(assignment, assignment.resources, url, warn), capturedAt,
        graphProvidedFields: provided.filter(field => ['instructions', 'resources', 'submissions'].includes(field)) };
      snapshot.tasks.push(task); coverage.assignments = 1;
      for (const s of candidates) for (const outcome of list(s.outcomes)) {
        const feedback = object(outcome.publishedFeedback), content = bodyText(feedback.text);
        const published = object(outcome.publishedPoints), score = published.points;
        if (typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1000000000) {
          const gid = graphID('grade', classId, text(assignment.id), text(s.id), text(outcome.id));
          const maximum = object(assignment.grading).maxPoints;
          if (gid) snapshot.grades.push({ id: gid, assignmentId: aid, title, course: task.course, score,
            maxScore: typeof maximum === 'number' && Number.isFinite(maximum) && maximum >= 0 && maximum <= 1000000000 ? maximum : null,
            gradeLabel: '', teacher: clip(text(object(object(published.gradedBy).user).displayName), 300, '评分教师'),
            date: iso(published.gradedDateTime), url, capturedAt,
            feedback: clip(list(s.outcomes).map(value => bodyText(object(value.publishedFeedback).text)).filter(Boolean).join('\n\n'), 20000, '教师反馈') });
        } else if (own(published, 'points')) warn('已发布成绩格式无法确认，未将其当作数值成绩。');
        if (!content) continue;
        const fid = graphID('feedback', classId, text(assignment.id), text(s.id), text(outcome.id));
        if (!fid) continue;
        snapshot.feedback.push({ id: fid, course: task.course, teacher: clip(text(object(object(feedback.feedbackBy).user).displayName), 200, '教师名称'),
          text: clip(content, 20000, '教师反馈'), date: iso(feedback.feedbackDateTime), url, assignmentId: aid });
      }
    }
    snapshot.graphComplete = coverage.complete;
    if (coverage.capped) coverage.reason = '本地缓存或文本长度上限';
    return { snapshots: [snapshot], warnings: warnings.slice(), coverage };
  }
  function normalizeBatch(input) {
    const batch = object(input);
    if (batch.kind) return normalizeOne(batch);
    // Also accept a complete grouped fixture/export, used by native integrations
    // that buffer collections instead of sending each Graph page immediately.
    const chunks = [];
    for (const row of list(batch.channels)) chunks.push({ kind: 'channelMessages', team: { id: row.teamId, displayName: row.teamName }, channel: { id: row.channelId, displayName: row.channelName, webUrl: row.webUrl }, messages: row.messages, complete: row.complete });
    for (const row of list(batch.assignments)) chunks.push({ kind: 'assignment', class: { id: row.classId, displayName: row.className }, assignment: Object.assign({}, row.assignment, { resources: row.resources, submissions: row.submissions }), complete: row.complete, userId: batch.userId });
    for (const row of list(batch.chats)) chunks.push({ kind: 'chatMessages', chat: { id: row.chatId, topic: row.topic, webUrl: row.webUrl }, messages: row.messages, complete: row.complete });
    const output = { snapshots: [], warnings: [], coverage: { channels: 0, chats: 0, assignments: 0, messages: 0, complete: chunks.length > 0, capped: false } };
    for (const chunk of chunks) {
      const result = normalizeOne(Object.assign({ capturedAt: batch.capturedAt, warnings: batch.warnings }, chunk));
      output.snapshots.push(...result.snapshots); output.warnings.push(...result.warnings);
      for (const field of ['channels', 'chats', 'assignments', 'messages']) output.coverage[field] += result.coverage[field];
      output.coverage.complete = output.coverage.complete && result.coverage.complete;
      output.coverage.capped = output.coverage.capped || result.coverage.capped;
    }
    output.warnings = [...new Set(output.warnings)];
    if (output.coverage.capped) output.coverage.reason = '本地缓存或文本长度上限';
    return output;
  }
  return Object.freeze({ normalizeBatch, plainHTML, bodyText });
});
