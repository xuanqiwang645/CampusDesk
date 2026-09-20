/* CampusDesk data model. No network calls, credentials, or platform dependencies. */
(function (root, factory) {
  'use strict';
  const api = factory(root.CampusSchoolConfig);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CampusCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (initialSchoolConfig) {
  'use strict';
  const VERSION = 1;
  const MAX_BYTES = 25 * 1024 * 1024;
  const MAX_ROWS = 3000;
  const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
  const SOURCES = ['seiue', 'managebac', 'teams'];
  const TEAMS_HOSTS = new Set(['teams.microsoft.com', 'teams.cloud.microsoft']);
  let configuredSchools = { seiue: '', managebac: '' };
  function configureSchools(config) {
    const next = { seiue: '', managebac: '' };
    for (const source of ['seiue', 'managebac']) {
      const raw = config && config[source];
      if (typeof raw !== 'string' || raw.length > 2048 || !/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::443)?\/?$/i.test(raw)) continue;
      try {
        const url = new URL(raw), host = url.hostname.toLowerCase();
        const suffixes = source === 'seiue' ? ['seiue.com'] : ['managebac.com', 'managebac.cn'];
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443') || (url.pathname && url.pathname !== '/') || host.length > 253) continue;
        if (!host.split('.').every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) continue;
        if (!suffixes.some(suffix => host === suffix || host.endsWith('.' + suffix))) continue;
        next[source] = 'https://' + host + '/';
      } catch (_) {}
    }
    configuredSchools = next;
    return schoolHomes();
  }
  function schoolHomes() { return Object.assign({}, configuredSchools); }
  configureSchools(initialSchoolConfig);
  const MAX_TEAMS_ROWS = 500;
  const MAX_GRAPH_ROWS = 3000;
  const METHOD = '课程等权；90/80/70/60 分对应 4/3/2/1，低于 60 分为 0；非学校官方 GPA';

  function fail(message) { throw new Error('数据格式无效：' + message); }
  function record(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + '应为对象');
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) fail(label + '包含不安全的对象');
    return value;
  }
  function inspect(value, depth, count) {
    if (depth > 16) fail('嵌套层数过多');
    count.n += 1;
    if (count.n > 2000000) fail('内容过多');
    if (typeof value === 'string' && value.length > 100000) fail('文本过长');
    if (typeof value === 'number' && !Number.isFinite(value)) fail('数字无效');
    if (value === null || typeof value !== 'object') {
      if (!['undefined', 'string', 'number', 'boolean', 'object'].includes(typeof value)) fail('不支持的数据类型');
      return;
    }
    if (!Array.isArray(value)) record(value, '内容');
    for (const key of Object.keys(value)) {
      if (BAD_KEYS.has(key)) fail('包含不安全的字段');
      inspect(value[key], depth + 1, count);
    }
  }
  function utf8Length(value) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
    let bytes = 0;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code <= 0x7f) bytes += 1;
      else if (code <= 0x7ff) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i += 1; }
      else bytes += 3; // Unicode replacement characters cover unpaired surrogates.
    }
    return bytes;
  }
  function checkSize(value) {
    let serialized;
    try { serialized = JSON.stringify(value); } catch (_) { fail('无法读取对象'); }
    if (utf8Length(serialized) > MAX_BYTES) fail('文件超过 25 MB');
  }
  function inputObject(input) {
    if (typeof input === 'string') {
      if (utf8Length(input) > MAX_BYTES) fail('文件超过 25 MB');
      try { input = JSON.parse(input); } catch (_) { fail('不是有效的 JSON'); }
    }
    inspect(input, 0, { n: 0 });
    checkSize(input);
    return record(input, '根数据');
  }
  function str(value, max, fallback) {
    if (value === undefined || value === null) return fallback || '';
    if (typeof value !== 'string') fail('文本字段类型错误');
    if (value.length > max) fail('文本字段过长');
    return value.trim();
  }
  function bool(value, fallback) {
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') fail('布尔字段类型错误');
    return value;
  }
  function finite(value, min, max, nullable) {
    if ((value === undefined || value === null) && nullable) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail('数字超出范围');
    return value;
  }
  function array(value, name, max) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > (max || MAX_ROWS)) fail(name + '数量或格式错误');
    return value;
  }
  function dateISO(value, nullable) {
    if ((value === null || value === undefined || value === '') && nullable) return null;
    const s = str(value, 48);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) || !Number.isFinite(Date.parse(s))) fail('时间戳无效');
    return new Date(s).toISOString();
  }
  function zonedISO(value, nullable) {
    if ((value === null || value === undefined || value === '') && nullable) return null;
    const s = str(value, 48);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(s)) fail('Teams 截止时间需要明确时区');
    dayKey(s.slice(0, 10));
    timeKey(s.slice(11, 16));
    if (s[16] === ':' && Number(s.slice(17, 19)) > 59) fail('秒数无效');
    const zone = s.match(/[+-](\d{2}):(\d{2})$/);
    if (zone && (Number(zone[1]) > 14 || Number(zone[2]) > 59 || (Number(zone[1]) === 14 && Number(zone[2]) !== 0))) fail('时区偏移无效');
    return dateISO(s, false);
  }
  function dayKey(value) {
    const s = str(value, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail('日期无效');
    const d = new Date(s + 'T00:00:00Z');
    if (!Number.isFinite(d.valueOf()) || d.toISOString().slice(0, 10) !== s) fail('日期无效');
    return s;
  }
  function timeKey(value) {
    const s = str(value, 5);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) fail('上课时间无效');
    return s;
  }
  function safeURL(value, source) {
    if (!value || typeof value !== 'string' || value.length > 4096) return '';
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return '';
      const host = u.hostname.toLowerCase();
      const seiue = configuredSchools.seiue !== '' && u.origin + '/' === configuredSchools.seiue;
      const managebac = configuredSchools.managebac !== '' && u.origin + '/' === configuredSchools.managebac;
      const teams = TEAMS_HOSTS.has(host);
      if (source && !SOURCES.includes(source)) return '';
      if ((source === 'seiue' && !seiue) || (source === 'managebac' && !managebac) || (source === 'teams' && !teams) || (!seiue && !managebac && !teams)) return '';
      if (hasAuthParameters(u)) return '';
      return u.href;
    } catch (_) { return ''; }
  }
  function hasAuthParameters(url) {
    const unsafe = /^(?:access_token|id_token|refresh_token|token|code|client_secret|assertion|password|passwd|authorization|auth_token|session_token|authkey|sig|signature|session_state)$/i;
    const fragment = url.hash.replace(/^#/, '');
    const query = fragment.includes('?') ? fragment.slice(fragment.indexOf('?') + 1) : fragment;
    return [url.searchParams, new URLSearchParams(query)].some(params => [...params.keys()].some(key => unsafe.test(key)));
  }
  function safeAttachmentURL(value) {
    if (!value || typeof value !== 'string' || value.length > 4096) return '';
    try {
      const u = new URL(value), host = u.hostname.toLowerCase();
      const allowed = TEAMS_HOSTS.has(host) || ['.sharepoint.com', '.sharepoint.cn'].some(suffix => host.endsWith(suffix)) || host === 'onedrive.live.com' || host === '1drv.ms';
      if (!allowed || u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || hasAuthParameters(u)) return '';
      return u.href;
    } catch (_) { return ''; }
  }
  function storedURL(value, source) {
    const live = safeURL(value, source);
    if (live) return live;
    // Cached provider URLs are data, not permission to connect. Preserve old
    // exports when a public build has blank or changed school configuration;
    // navigation and incoming extraction still require safeURL's exact origin.
    if (!['seiue', 'managebac'].includes(source) || typeof value !== 'string' || value.length > 4096) return '';
    try {
      const url = new URL(value), host = url.hostname.toLowerCase();
      const suffixes = source === 'seiue' ? ['seiue.com'] : ['managebac.com', 'managebac.cn'];
      if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || hasAuthParameters(url)) return '';
      return suffixes.some(suffix => host === suffix || host.endsWith('.' + suffix)) ? url.href : '';
    } catch (_) { return ''; }
  }
  function checkedURL(value, source, optional) {
    if ((value === undefined || value === null || value === '') && optional) return '';
    const url = storedURL(value, source);
    if (!url) fail('仅接受相应希悦、ManageBac 或 Teams 的 HTTPS 地址');
    return url;
  }
  function id(value, fallback) {
    const key = str(value, 512, fallback);
    if (!key || BAD_KEYS.has(key)) fail('记录 ID 无效');
    return key;
  }
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }
  function timezone(value) {
    const tz = str(value, 100, 'Asia/Shanghai');
    try { new Intl.DateTimeFormat('en', { timeZone: tz }).format(); } catch (_) { fail('时区无效'); }
    return tz;
  }
  function emptyState() {
    return { version: VERSION, settings: { timezone: 'Asia/Shanghai', refreshMinutes: 15, selfStudy: true,
      seiueURL: configuredSchools.seiue, managebacURL: configuredSchools.managebac, teamsPages: [], teamsNotifications: false,
      teamsBrowser: 'chrome', teamsBrowserAutomation: false, teamsMode: 'browser', teamsAutoDiscover: true, graphIncludeChats: true,
      reminderMinutes: 30, teamsDueOverrides: {} }, snapshots: { seiue: {}, managebac: {}, teams: {} },
      manualTasks: [], taskChecks: {}, feedbackRead: {}, gradeHistory: [] };
  }
  function scheduleRow(row) {
    record(row, '课程');
    const date = dayKey(row.date), start = timeKey(row.start), end = timeKey(row.end);
    if (end <= start) fail('课程结束时间必须晚于开始时间');
    const title = str(row.title, 300);
    const isSelfStudy = bool(row.isSelfStudy, !title);
    return { id: id(row.id, 'schedule-' + hash(date + start + title)), date, start, end,
      title: title || (isSelfStudy ? '自习课' : ''), room: str(row.room, 200), teacher: str(row.teacher, 200), isSelfStudy };
  }
  function courseRow(row) {
    record(row, '成绩');
    const name = str(row.name, 300);
    if (!name) fail('课程名不能为空');
    const result = { id: id(row.id, 'course-' + hash(name)), name,
      percentage: finite(row.percentage, 0, 100, true), term: str(row.term, 300), url: checkedURL(row.url, 'managebac', true) };
    for (const field of ['isCurrentTerm', 'isCourseGrade', 'gpaEligible']) {
      if (row[field] !== undefined) result[field] = bool(row[field]);
    }
    return result;
  }
  function taskRow(row, manual) {
    record(row, '待办');
    const title = str(row.title, 500);
    if (!title) fail('待办标题不能为空');
    const course = str(row.course, 300, manual ? '个人待办' : '');
    const dueAt = dateISO(row.dueAt, true);
    const result = { id: id(row.id, (manual ? 'manual-' : 'task-') + hash(title + course + (dueAt || ''))),
      title, course, dueAt, dueLabel: str(row.dueLabel, 300), status: str(row.status, 100, 'open'),
      url: checkedURL(row.url, 'managebac', true) };
    if (manual) result.createdAt = dateISO(row.createdAt, true);
    return result;
  }
  function teamsID(value, fallback) {
    const key = id(value, fallback);
    return key.startsWith('teams:') ? key : 'teams:' + key;
  }
  function attachments(value) {
    return array(value, '附件', 100).map(item => {
      record(item, '附件');
      const result = { title: str(item.title, 500, '附件'), url: safeAttachmentURL(item.url) };
      // File cards may expose a filename but no link. Retain the inventory without
      // turning an untrusted/nonexistent URL into a clickable attachment.
      if (item.id !== undefined) result.id = id(item.id);
      if (item.text !== undefined) result.text = str(item.text, 80000);
      if (item.mimeType !== undefined) result.mimeType = str(item.mimeType, 200);
      if (item.error !== undefined) result.error = str(item.error, 2000);
      if (item.capturedAt !== undefined) result.capturedAt = dateISO(item.capturedAt, true);
      if (item.checkedAt !== undefined) result.checkedAt = dateISO(item.checkedAt, true);
      if (item.versionKey !== undefined) {
        const version = str(item.versionKey, 140);
        if (version && !/^v[0-9]+:[a-f0-9]{8,128}$/.test(version)) fail('附件版本标识无效');
        result.versionKey = version;
      }
      if (item.extractionCoverage !== undefined) {
        if (!['text_extracted','partial','none'].includes(item.extractionCoverage)) fail('附件文字覆盖状态无效');
        result.extractionCoverage = item.extractionCoverage;
      }
      // Text/OCR extraction never attests to table semantics or roster accuracy.
      if (item.textOnly !== undefined) result.textOnly = bool(item.textOnly, true);
      if (item.semanticVerified !== undefined) {
        if (item.semanticVerified !== false) fail('附件名单语义未经核验');
        result.semanticVerified = false;
      }
      for (const key of ['pagesTotal','pagesRead','ocrPages']) if (item[key] !== undefined) {
        result[key] = finite(item[key], 0, 100000);
        if (!Number.isInteger(result[key])) fail('附件页数应为整数');
      }
      if (item.warnings !== undefined) result.warnings = array(item.warnings, '附件提示', 8).map(v => str(v, 500));
      if (item.pageCoverage !== undefined) result.pageCoverage = array(item.pageCoverage, '附件逐页覆盖', 100).map(value => {
        record(value, '页覆盖');
        const row = {page:finite(value.page,1,100000),characters:finite(value.characters,0,80000)};
        if (!Number.isInteger(row.page) || !Number.isInteger(row.characters)) fail('页覆盖计数应为整数');
        const allowed = {status:['text_extracted','partial','no_text','skipped'],method:['pdf_text','pdf_text+ocr','ocr','none'],visualContent:['detected','not_detected','unknown'],ocrStatus:['not_needed','completed','failed','limit','no_text']};
        for (const key of Object.keys(allowed)) {if (!allowed[key].includes(value[key])) fail('页覆盖状态无效');row[key] = value[key];}
        if (value.ocrMeanConfidence !== undefined) row.ocrMeanConfidence = finite(value.ocrMeanConfidence,0,1);
        if (value.ocrLowConfidenceLines !== undefined) {row.ocrLowConfidenceLines=finite(value.ocrLowConfidenceLines,0,10000);if(!Number.isInteger(row.ocrLowConfidenceLines))fail('OCR 行数应为整数');}
        if (value.reason !== undefined) row.reason = str(value.reason,500);
        return row;
      });
      if (item.truncated !== undefined) result.truncated = bool(item.truncated, false);
      if (item.cached !== undefined) result.cached = bool(item.cached, false);
      if (item.extractionStatus !== undefined) {
        if (!['links_only', 'unread', 'read', 'partial', 'no_text', 'unsupported', 'error'].includes(item.extractionStatus)) fail('附件读取状态无效');
        result.extractionStatus = item.extractionStatus;
      } else if (!result.url) result.extractionStatus = 'unread';
      return result;
    });
  }
  function gradeFields(row) {
    const result = {};
    if (row.score !== undefined) result.score = finite(row.score, 0, 1000000000, true);
    if (row.maxScore !== undefined) result.maxScore = finite(row.maxScore, 0, 1000000000, true);
    if (row.gradeLabel !== undefined) result.gradeLabel = str(row.gradeLabel, 1000);
    if (row.feedback !== undefined) result.feedback = str(row.feedback, 20000);
    if (row.rubric !== undefined) result.rubric = str(row.rubric, 20000);
    return result;
  }
  function teamsGrade(row) {
    record(row, 'Teams 成绩');
    const fields = gradeFields(row);
    if (fields.score == null && !fields.gradeLabel && !fields.rubric) fail('Teams 成绩缺少已读取的分数或等级');
    return Object.assign({ id: teamsID(row.id), assignmentId: row.assignmentId ? teamsID(row.assignmentId) : '',
      title: str(row.title, 500, 'Teams 作业成绩'), course: str(row.course, 300), teacher: str(row.teacher, 300),
      date: str(row.date, 100), url: checkedURL(row.url, 'teams', true), capturedAt: dateISO(row.capturedAt, true) }, fields);
  }
  function coverageMetadata(value) {
    record(value, 'Teams 覆盖范围');
    const result = { historyComplete: bool(value.historyComplete, false) };
    for (const key of ['discovered', 'read', 'unread', 'errors', 'attachmentsDiscovered', 'attachmentsRead']) {
      if (value[key] === undefined) continue;
      const count = finite(value[key], 0, 1000000000, false);
      if (!Number.isInteger(count)) fail('Teams 覆盖计数应为整数');
      result[key] = count;
    }
    if (value.status !== undefined) result.status = str(value.status, 100);
    if (value.reason !== undefined) result.reason = str(value.reason, 2000);
    if (value.warnings !== undefined) result.warnings = array(value.warnings, 'Teams 覆盖提示', 100).map(w => str(w, 2000));
    if (result.errors > 0 || result.unread > 0) result.historyComplete = false;
    return result;
  }
  function snapshotKey(value) {
    return value.source === 'teams' && value.coverage === 'browser' && value.snapshotId
      ? 'browser:' + encodeURIComponent(value.accountId || '') + ':' + encodeURIComponent(value.snapshotId) : value.url;
  }
  function teamsTask(row) {
    record(row, 'Teams 作业');
    const title = str(row.title, 500), course = str(row.course, 300);
    if (!title) fail('Teams 作业标题不能为空');
    const url = checkedURL(row.url, 'teams', true);
    const result = { id: teamsID(row.id, hash(url + title + course)), title, course,
      dueAt: zonedISO(row.dueAt, true), dueLabel: str(row.dueLabel, 300), status: str(row.status, 100, 'open'),
      url, requirements: str(row.requirements, 30000), attachments: attachments(row.attachments) };
    if (row.capturedAt !== undefined) result.capturedAt = dateISO(row.capturedAt, false);
    if (row.submissionStatus !== undefined) result.submissionStatus = str(row.submissionStatus, 100);
    Object.assign(result, gradeFields(row));
    if (row.graphProvidedFields !== undefined) result.graphProvidedFields = array(row.graphProvidedFields, 'Graph 字段', 3).map(field => {
      if (!['instructions', 'resources', 'submissions'].includes(field)) fail('Graph 字段无效');
      return field;
    });
    return result;
  }
  function teamsPost(row) {
    record(row, 'Teams 帖子');
    const title = str(row.title, 500), text = str(row.text, 30000), url = checkedURL(row.url, 'teams', true);
    if (!title && !text) fail('Teams 帖子不能为空');
    const kind = str(row.kind, 30, 'general');
    if (!['assignment', 'ec', 'general'].includes(kind)) fail('Teams 帖子类型无效');
    const result = { id: teamsID(row.id, hash(url + title + text)), title, text, url, kind,
      author: str(row.author, 300), channel: str(row.channel, 300), date: str(row.date, 100),
      dateLabel: str(row.dateLabel, 300, str(row.date, 100)), attachments: attachments(row.attachments) };
    if (row.replyToId !== undefined) result.replyToId = row.replyToId ? teamsID(row.replyToId) : '';
    if (row.capturedAt !== undefined) result.capturedAt = dateISO(row.capturedAt, false);
    return result;
  }
  function teamsPage(row) {
    record(row, 'Teams 页面');
    const url = checkedURL(row.url, 'teams'), kind = str(row.kind, 30, 'auto');
    if (!['auto', 'assignments', 'ec'].includes(kind)) fail('Teams 页面类型无效');
    return { id: id(row.id, 'teams-page-' + hash(url)), label: str(row.label, 100, 'Teams'), url, kind };
  }
  function teamsFeedback(row) {
    record(row, 'Teams 教师反馈');
    const text = str(row.text, 20000);
    if (!text) fail('反馈内容不能为空');
    return Object.assign({ id: teamsID(row.id), course: str(row.course, 300), teacher: str(row.teacher, 200), text,
      date: str(row.date, 100), url: checkedURL(row.url, 'teams', true), assignmentId: teamsID(row.assignmentId),
      capturedAt: dateISO(row.capturedAt, true) }, gradeFields(row));
  }
  function feedbackRow(row) {
    record(row, '教师反馈');
    const text = str(row.text, 20000), course = str(row.course, 300), teacher = str(row.teacher, 200);
    if (!text) fail('反馈内容不能为空');
    return { id: id(row.id, 'feedback-' + hash(text + course + teacher)), course, teacher, text,
      date: str(row.date, 100), url: checkedURL(row.url, 'managebac', true) };
  }
  function officialGPA(value) {
    if (value === undefined || value === null) return null;
    record(value, '官方 GPA');
    const result = { value: finite(value.value, 0, 100, false), scale: finite(value.scale, 0.1, 100, true),
      label: str(value.label, 300, '页面显示的 GPA'), sourceLabel: str(value.sourceLabel, 300), term: str(value.term, 300) };
    if (result.scale !== null && result.value > result.scale) fail('GPA 大于量表上限');
    if (value.isCurrentTerm !== undefined) result.isCurrentTerm = bool(value.isCurrentTerm);
    return result;
  }
  function snapshot(value, expectedSource, expectedURL) {
    record(value, '快照');
    if (!SOURCES.includes(value.source) || (expectedSource && value.source !== expectedSource)) fail('数据来源无效');
    const source = value.source, url = checkedURL(value.url, source);
    const result = { source, url, title: str(value.title, 500), capturedAt: dateISO(value.capturedAt, false),
      loginRequired: bool(value.loginRequired, false), warnings: array(value.warnings, '提示', 100).map(w => str(w, 2000)) };
    if (source === 'seiue') {
      result.schedule = array(value.schedule, '课表').map(scheduleRow);
      result.calendarDates = [...new Set(array(value.calendarDates, '已核对的课表日期', 366).map(dayKey))];
    }
    else if (source === 'teams') {
      if (value.coverage !== undefined && !['visible', 'graph', 'browser'].includes(value.coverage)) fail('Teams 同步范围无效');
      result.coverage = value.coverage || 'visible';
      if (value.snapshotId !== undefined) result.snapshotId = id(value.snapshotId);
      if (value.accountId !== undefined) result.accountId = str(value.accountId, 512);
      if (value.coverageMetadata !== undefined) result.coverageMetadata = coverageMetadata(value.coverageMetadata);
      if (result.coverage === 'browser') result.browserExcludedIDs = array(value.browserExcludedIDs, '非消息记录', MAX_GRAPH_ROWS).map(value => teamsID(value));
      const limit = result.coverage === 'visible' ? MAX_TEAMS_ROWS : MAX_GRAPH_ROWS;
      result.tasks = array(value.tasks, 'Teams 作业', limit).map(teamsTask);
      result.posts = array(value.posts, 'Teams 帖子', limit).map(teamsPost);
      result.feedback = array(value.feedback, 'Teams 教师反馈', limit).map(teamsFeedback);
      result.grades = array(value.grades, 'Teams 成绩', limit).map(teamsGrade);
      if (result.coverage === 'graph') {
        result.graphComplete = bool(value.graphComplete, false);
        result.graphDeletedIDs = array(value.graphDeletedIDs, 'Graph 删除记录', MAX_GRAPH_ROWS).map(value => {
          const key = teamsID(value);
          if (!key.startsWith('teams:graph:')) fail('Graph 删除记录来源无效');
          return key;
        });
      }
      for (const row of result.tasks.concat(result.posts, result.feedback, result.grades)) if (!row.capturedAt) row.capturedAt = result.capturedAt;
    }
    else {
      result.courses = array(value.courses, '成绩').map(courseRow);
      result.tasks = array(value.tasks, '待办').map(r => taskRow(r, false));
      result.feedback = array(value.feedback, '教师反馈').map(feedbackRow);
      result.officialGPA = officialGPA(value.officialGPA);
    }
    // Old exports key snapshots by URL. New browser snapshots retain their real
    // URL but use explicit identity, because several channels share /v2/.
    if (expectedURL && expectedURL !== snapshotKey(result) && storedURL(expectedURL, source) !== url) fail('快照地址或来源标识不匹配');
    if (value.error !== undefined) result.error = str(value.error, 2000);
    if (value.success !== undefined) result.success = bool(value.success);
    if (value.parseError !== undefined) result.parseError = bool(value.parseError);
    if (value.lastAttemptAt !== undefined) result.lastAttemptAt = dateISO(value.lastAttemptAt, false);
    if (value.lastAttemptFailed !== undefined) result.lastAttemptFailed = bool(value.lastAttemptFailed);
    return result;
  }
  function flagMap(value, name) {
    const out = {};
    if (value === undefined) return out;
    record(value, name);
    const entries = Object.entries(value);
    if (entries.length > 10000) fail(name + '过多');
    for (const [key, val] of entries) out[id(key)] = bool(val);
    return out;
  }
  function historyRow(value) {
    record(value, '成绩历史');
    return { capturedAt: dateISO(value.capturedAt, false), date: dayKey(value.date),
      value: finite(value.value, 0, 4, false), count: finite(value.count, 1, 1000, false), scale: 4,
      term: str(value.term, 300), method: str(value.method, 500, METHOD), signature: str(value.signature, 100000) };
  }
  function validateState(input) {
    const raw = inputObject(input);
    if (raw.version !== VERSION) fail('不支持的数据版本');
    const s = emptyState(), settings = record(raw.settings, '设置');
    s.settings.timezone = timezone(settings.timezone);
    s.settings.refreshMinutes = settings.refreshMinutes === undefined ? 15 : finite(settings.refreshMinutes, 1, 1440, false);
    s.settings.selfStudy = bool(settings.selfStudy, true);
    s.settings.seiueURL = checkedURL(settings.seiueURL || s.settings.seiueURL, 'seiue', true);
    s.settings.managebacURL = checkedURL(settings.managebacURL || s.settings.managebacURL, 'managebac', true);
    s.settings.teamsPages = array(settings.teamsPages, 'Teams 页面', 20).map(teamsPage);
    if (new Set(s.settings.teamsPages.map(page => page.id)).size !== s.settings.teamsPages.length) fail('Teams 页面 ID 重复');
    s.settings.teamsNotifications = bool(settings.teamsNotifications, false);
    s.settings.teamsBrowser = settings.teamsBrowser === undefined ? 'chrome' : settings.teamsBrowser;
    if (!['chrome', 'edge'].includes(s.settings.teamsBrowser)) fail('Teams 浏览器仅支持 Chrome 或 Edge');
    s.settings.teamsBrowserAutomation = bool(settings.teamsBrowserAutomation, false);
    s.settings.teamsAutoDiscover = bool(settings.teamsAutoDiscover, true);
    s.settings.teamsMode = settings.teamsMode === undefined ? 'browser' : settings.teamsMode;
    if (!['graph', 'browser'].includes(s.settings.teamsMode)) fail('Teams 连接方式无效');
    s.settings.graphIncludeChats = bool(settings.graphIncludeChats, true);
    s.settings.reminderMinutes = settings.reminderMinutes === undefined ? 30 : finite(settings.reminderMinutes, 0, 10080, false);
    if (!Number.isInteger(s.settings.reminderMinutes)) fail('提醒分钟数必须为整数');
    if (settings.teamsDueOverrides !== undefined) {
      const overrides = record(settings.teamsDueOverrides, 'Teams 截止时间');
      if (Object.keys(overrides).length > MAX_ROWS) fail('手动截止时间过多');
      for (const [key, value] of Object.entries(overrides)) {
        if (!id(key).startsWith('teams:')) fail('手动截止时间仅用于 Teams 作业');
        s.settings.teamsDueOverrides[key] = zonedISO(value, false);
      }
    }
    const snapshots = record(raw.snapshots, '快照');
    for (const source of SOURCES) {
      // Keep the existing native version and migrate v1 exports that predate Teams.
      const records = record(source === 'teams' && snapshots[source] === undefined ? {} : snapshots[source], source + '快照');
      const entries = Object.entries(records);
      if (entries.length > (source === 'teams' ? 500 : 250)) fail('保存页面过多');
      for (const [url, value] of entries) {
        const entry = snapshot(value, source, url);
        const key = snapshotKey(entry);
        if (Object.prototype.hasOwnProperty.call(s.snapshots[source], key)) fail('同步来源标识重复');
        s.snapshots[source][key] = entry;
      }
    }
    s.manualTasks = array(raw.manualTasks, '个人待办').map(r => taskRow(r, true));
    s.taskChecks = flagMap(raw.taskChecks, '待办标记');
    s.feedbackRead = flagMap(raw.feedbackRead, '反馈标记');
    s.gradeHistory = array(raw.gradeHistory, '成绩历史', 120).map(historyRow);
    return s;
  }
  function parts(date, tz) {
    const d = date === undefined ? new Date() : new Date(date);
    if (!Number.isFinite(d.valueOf())) fail('查询时间无效');
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Asia/Shanghai', year: 'numeric',
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const out = {};
    for (const part of formatter.formatToParts(d)) out[part.type] = part.value;
    return out;
  }
  function today(date, tz) { const p = parts(date, tz); return p.year + '-' + p.month + '-' + p.day; }
  function clock(date, tz) { const p = parts(date, tz); return p.hour + ':' + p.minute; }
  function entries(state, source) {
    return Object.values(state.snapshots[source] || {}).sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
  }
  function getSchedule(state, date, includeSelfStudy) {
    const key = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? dayKey(date) : today(date, state.settings.timezone);
    const seen = new Set(), rows = [];
    // One slot gets the latest authoritative title, including a change to self-study.
    for (const s of entries(state, 'seiue')) {
      for (const r of s.schedule || []) {
        if (r.date !== key) continue;
        const slot = r.date + '|' + r.start + '|' + r.end;
        if (seen.has(slot)) continue;
        seen.add(slot);
        if (r.isSelfStudy && !state.settings.selfStudy && !includeSelfStudy) continue;
        rows.push(Object.assign({}, r, { capturedAt: s.capturedAt, sourceURL: s.url }));
      }
      // A verified complete day is authoritative, including a day with no lessons.
      if ((s.calendarDates || []).includes(key)) break;
    }
    return rows.sort((a, b) => a.start.localeCompare(b.start));
  }
  function termKey(value) { return (value || '').toLowerCase().replace(/\s*\((?:current|current term)\)\s*/g, '').trim(); }
  function getCourses(state) {
    const snapshots = entries(state, 'managebac');
    let cohort;
    for (const s of snapshots) {
      cohort = (s.courses || []).find(c => c.isCurrentTerm === true && c.isCourseGrade === true);
      if (cohort) break;
    }
    const chosenTerm = cohort ? termKey(cohort.term) : null;
    const seen = new Set(), result = [];
    for (const s of snapshots) for (const course of s.courses || []) {
      if (course.isCurrentTerm === false) continue;
      if (chosenTerm !== null && termKey(course.term) !== chosenTerm) continue;
      const key = course.id || course.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(Object.assign({}, course, { capturedAt: s.capturedAt, sourceURL: s.url,
        gpaEligible: course.isCurrentTerm === true && course.isCourseGrade === true && course.gpaEligible !== false }));
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }
  function points(percentage) {
    if (typeof percentage !== 'number' || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) return null;
    return percentage >= 90 ? 4 : percentage >= 80 ? 3 : percentage >= 70 ? 2 : percentage >= 60 ? 1 : 0;
  }
  function estimateGPA(courses) {
    const eligible = courses.filter(c => c.gpaEligible !== false && c.isCurrentTerm !== false && c.isCourseGrade !== false);
    const grades = eligible.map(c => points(c.percentage)).filter(p => p !== null);
    return { value: grades.length ? Math.round(grades.reduce((a, b) => a + b, 0) / grades.length * 100) / 100 : null,
      count: grades.length, excluded: courses.length - grades.length, scale: 4, method: METHOD };
  }
  function getOfficialGPA(state) {
    for (const s of entries(state, 'managebac')) {
      if (s.officialGPA && s.officialGPA.isCurrentTerm !== false) return Object.assign({}, s.officialGPA,
        { capturedAt: s.capturedAt, url: s.url, sourceLabel: s.officialGPA.sourceLabel || s.title });
    }
    return null;
  }
  function done(status) { return /^(completed|complete|done|submitted|graded|已完成|已提交|已评分)$/i.test(status || ''); }
  function getTasks(state) {
    const rows = [], seenIds = new Set(), seenKeys = new Set();
    for (const s of entries(state, 'managebac')) for (const task of s.tasks || []) {
      const key = [task.title.toLowerCase(), task.course.toLowerCase(), task.dueAt || task.dueLabel || ''].join('|');
      if (seenIds.has(task.id) || seenKeys.has(key)) continue;
      seenIds.add(task.id); seenKeys.add(key);
      rows.push(Object.assign({}, task, { manual: false, source: 'managebac', sourceURL: s.url, capturedAt: s.capturedAt,
        completed: Object.prototype.hasOwnProperty.call(state.taskChecks, task.id) ? state.taskChecks[task.id] : done(task.status) }));
    }
    const teamRows = entries(state, 'teams').flatMap(s => (s.tasks || []).map(task => Object.assign({}, task, { sourceURL: s.url, capturedAt: task.capturedAt || s.capturedAt })))
      .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
    const seenTeams = new Set();
    for (const task of teamRows) {
      const taskID = teamsID(task.id);
      if (seenTeams.has(taskID)) continue;
      seenTeams.add(taskID);
      const override = (state.settings.teamsDueOverrides || {})[taskID];
      rows.push(Object.assign({}, task, { id: taskID, source: 'teams', manual: false,
        originalDueAt: task.dueAt, dueAt: override || task.dueAt, dueOverride: !!override,
        completed: Object.prototype.hasOwnProperty.call(state.taskChecks, taskID) ? state.taskChecks[taskID] : done(task.status) }));
    }
    for (const task of state.manualTasks) rows.push(Object.assign({}, task, { manual: true, source: 'manual',
      completed: Object.prototype.hasOwnProperty.call(state.taskChecks, task.id) ? state.taskChecks[task.id] : done(task.status) }));
    return rows.sort((a, b) => Number(a.completed) - Number(b.completed) || (Date.parse(a.dueAt) || Infinity) - (Date.parse(b.dueAt) || Infinity) || a.title.localeCompare(b.title));
  }
  function getTeamsPosts(state, kind) {
    const rows = entries(state, 'teams').flatMap(s => (s.posts || []).map(post => Object.assign({}, post,
      { source: 'teams', sourceURL: s.url, capturedAt: post.capturedAt || s.capturedAt })))
      .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
    const byID = new Map();
    for (const post of rows) {
      const latest = byID.get(post.id);
      if (!latest) byID.set(post.id, post);
      else if (!knownPublishedDate(latest.date) && knownPublishedDate(post.date)) latest.date = post.date;
    }
    return [...byID.values()].filter(post => !kind || post.kind === kind)
      .map(post => Object.assign({}, post, { publishedAt: knownPublishedDate(post.date) }))
      // Capturing an old page again must not make an old roster the latest publication.
      // Unknown local dates remain unknown and are shown after confirmed timestamps.
      .sort((a, b) => (b.publishedAt ? Date.parse(b.publishedAt) : -Infinity) - (a.publishedAt ? Date.parse(a.publishedAt) : -Infinity) || Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
  }
  function knownPublishedDate(value) {
    if (!value) return null;
    try { return zonedISO(value, false); } catch (_) { return null; }
  }
  function getTeamsEC(state) { return getTeamsPosts(state, 'ec'); }
  function getTeamsGrades(state) {
    const rows = entries(state, 'teams').flatMap(s => (s.grades || []).map(item => Object.assign({}, item,
      { source: 'teams', sourceURL: s.url, accountId: s.accountId || '', capturedAt: item.capturedAt || s.capturedAt })))
      .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
    const seen = new Set();
    return rows.filter(item => {
      const key = item.accountId + '|' + item.id;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0) || Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
  }
  function getFeedback(state) {
    const rows = [], seen = new Set();
    for (const s of entries(state, 'managebac')) for (const item of s.feedback || []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      rows.push(Object.assign({}, item, { source: 'managebac', read: state.feedbackRead[item.id] === true, capturedAt: s.capturedAt }));
    }
    for (const s of entries(state, 'teams')) for (const item of s.feedback || []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      rows.push(Object.assign({}, item, { source: 'teams', read: state.feedbackRead[item.id] === true, capturedAt: item.capturedAt || s.capturedAt }));
    }
    return rows.sort((a, b) => Number(a.read) - Number(b.read) || (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  }
  function getNextClass(state, date) {
    const rows = getSchedule(state, date), time = clock(date, state.settings.timezone);
    return { current: rows.find(r => r.start <= time && time < r.end) || null, next: rows.find(r => r.start > time) || null };
  }
  function remainingLabel(seconds) {
    const value = Math.max(0, Math.ceil(seconds)), h = Math.floor(value / 3600), m = Math.floor(value / 60) % 60, s = value % 60;
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') : String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  function getClassClock(state, date) {
    const now = date === undefined ? Date.now() : new Date(date).valueOf();
    if (!Number.isFinite(now)) fail('查询时间无效');
    // School slots use Beijing civil time regardless of the computer/display time zone.
    const key = today(now, 'Asia/Shanghai');
    const rows = getSchedule(state, key, true).map(row => Object.assign({}, row, {
      startAt: Date.parse(row.date + 'T' + row.start + ':00+08:00'), endAt: Date.parse(row.date + 'T' + row.end + ':00+08:00')
    })).sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt);
    const status = getSourceStatus(state, 'seiue', now);
    const ageLimit = Math.max(30, state.settings.refreshMinutes * 2) * 60000;
    const relevantSnapshots = entries(state, 'seiue').filter(s => (s.calendarDates || []).includes(key) || (s.schedule || []).some(r => r.date === key));
    const relevant = relevantSnapshots[0];
    const stale = !relevant || now - Date.parse(relevant.capturedAt) > ageLimit || !!relevant.lastAttemptFailed || status.loginRequired || status.failed || rows.some(row => now - Date.parse(row.capturedAt) > ageLimit);
    const output = { phase: 'empty', current: null, next: null, previous: null, remainingSeconds: 0, remainingLabel: '00:00', stale };
    if (!rows.length) return output;
    const current = rows.filter(row => row.startAt <= now && now < row.endAt).sort((a, b) => b.endAt - a.endAt || b.startAt - a.startAt)[0] || null;
    const next = rows.find(row => row.startAt > now) || null;
    const previous = rows.filter(row => row.endAt <= now).sort((a, b) => b.endAt - a.endAt)[0] || null;
    output.current = current; output.next = next; output.previous = previous;
    let target = now;
    if (current) { output.phase = 'class'; target = current.endAt; }
    else if (!previous && next) { output.phase = 'before'; target = next.startAt; }
    else if (previous && !next) output.phase = 'after';
    else if (previous && next) {
      const noon = Date.parse(key + 'T12:00:00+08:00');
      // Lunch is a display heuristic: an internal gap >=45 minutes containing noon.
      output.phase = next.startAt - previous.endAt >= 45 * 60000 && previous.endAt <= noon && next.startAt > noon ? 'lunch' : 'break';
      target = next.startAt;
    }
    output.remainingSeconds = Math.max(0, Math.ceil((target - now) / 1000));
    output.remainingLabel = remainingLabel(output.remainingSeconds);
    return output;
  }
  function getSourceStatus(state, source, date) {
    if (!SOURCES.includes(source)) fail('来源无效');
    const all = entries(state, source), now = date === undefined ? Date.now() : new Date(date).valueOf();
    const useful = all.filter(s => !s.loginRequired || s.lastAttemptFailed).filter(s =>
      source === 'seiue' ? (s.schedule || []).length || (s.calendarDates || []).length : source === 'teams' ? (s.tasks || []).length || (s.posts || []).length || (s.feedback || []).length || (s.grades || []).length || (!s.parseError && !s.lastAttemptFailed) : (s.courses || []).length || (s.tasks || []).length || (s.feedback || []).length || s.officialGPA);
    const latest = useful[0];
    const lastAttempt = all.slice().sort((a, b) => Date.parse(b.lastAttemptAt || b.capturedAt) - Date.parse(a.lastAttemptAt || a.capturedAt))[0];
    const lastCapturedAt = latest ? latest.capturedAt : null;
    const ageMinutes = lastCapturedAt ? Math.max(0, (now - Date.parse(lastCapturedAt)) / 60000) : null;
    return { lastCapturedAt, ageMinutes, stale: ageMinutes === null || ageMinutes > Math.max(30, state.settings.refreshMinutes * 2),
      loginRequired: !!(lastAttempt && lastAttempt.loginRequired), warnings: lastAttempt ? lastAttempt.warnings.slice() : [],
      lastAttemptAt: lastAttempt ? lastAttempt.lastAttemptAt || lastAttempt.capturedAt : null, failed: !!(lastAttempt && lastAttempt.lastAttemptFailed) };
  }
  function mergeSnapshot(state, incoming) {
    const result = validateState(state), raw = inputObject(incoming), item = snapshot(raw);
    if (!safeURL(item.url, item.source)) fail('尚未配置此学校地址，或新读取页面不属于当前配置的学校');
    const key = snapshotKey(item), previous = result.snapshots[item.source][key];
    if (previous && Date.parse(previous.lastAttemptAt || previous.capturedAt) > Date.parse(item.capturedAt)) return result;
    const hasData = item.source === 'seiue' ? item.schedule.length || item.calendarDates.length : item.source === 'teams' ? item.tasks.length || item.posts.length || item.feedback.length || item.grades.length : item.courses.length || item.tasks.length || item.feedback.length || item.officialGPA;
    const failed = item.loginRequired || item.parseError || item.success === false || !!item.error || (!hasData && item.source !== 'teams');
    // An unreadable/logged-out page records the attempted sync while retaining its last useful data.
    if (failed && previous) result.snapshots[item.source][key] = Object.assign({}, previous, {
      lastAttemptAt: item.capturedAt, lastAttemptFailed: true, loginRequired: item.loginRequired,
      warnings: item.warnings.length ? item.warnings : ['本次未读到可用数据，保留上次同步结果。'] },
      item.coverageMetadata ? { coverageMetadata: item.coverageMetadata } : {});
    else {
      item.lastAttemptAt = item.capturedAt;
      item.lastAttemptFailed = !!failed;
      if (failed) {
        if (item.source === 'seiue') { item.schedule = []; item.calendarDates = []; }
        else if (item.source === 'teams') { item.tasks = []; item.posts = []; item.feedback = []; item.grades = []; }
        else { item.courses = []; item.tasks = []; item.feedback = []; item.officialGPA = null; }
      } else if (item.source === 'teams' && previous && !(item.coverage === 'graph' && item.graphComplete)) {
        // Browser views and individual Graph pages are partial; absence is not deletion.
        const deleted = new Set((item.graphDeletedIDs || []).concat(item.browserExcludedIDs || []));
        const removed = row => [...deleted].some(key => row.id === key || row.id.startsWith(key + ':reply:'));
        for (const field of ['tasks', 'posts', 'feedback', 'grades']) {
          const noLongerTasks = new Set(item.coverage === 'browser' && field === 'tasks' ? item.posts.filter(post => post.kind !== 'assignment').map(post => post.id) : []);
          if (field === 'tasks' && item.coverage === 'graph') {
            const oldTasks = new Map((previous.tasks || []).map(task => [task.id, task]));
            item.tasks = item.tasks.map(task => {
              const old = oldTasks.get(task.id), provided = task.graphProvidedFields;
              if (!old || !provided) return task;
              const merged = Object.assign({}, task);
              if (!provided.includes('instructions')) merged.requirements = old.requirements;
              if (!provided.includes('resources')) merged.attachments = old.attachments;
              if (!provided.includes('submissions')) { merged.status = old.status; merged.submissionStatus = old.submissionStatus; }
              return merged;
            });
          }
          if (item.coverage === 'browser' && ['tasks', 'posts'].includes(field)) {
            const oldRows = new Map((previous[field] || []).map(row => [row.id, row]));
            item[field] = item[field].map(row => {
              const old = oldRows.get(row.id);
              if (!old) return row;
              const fileKey = file => file.id || file.url || file.title;
              const oldFiles = new Map((old.attachments || []).map(file => [fileKey(file), file]));
              const seenFiles = new Set();
              const files = (row.attachments || []).map(file => {
                const identity = fileKey(file), prior = oldFiles.get(identity); seenFiles.add(identity);
                if (prior && prior.text && !file.text && file.extractionStatus !== 'read') {
                  return Object.assign({}, prior, file, { text: prior.text, capturedAt: prior.capturedAt || old.capturedAt, truncated: !!prior.truncated, cached: true });
                }
                return file;
              });
              for (const file of old.attachments || []) if (!seenFiles.has(fileKey(file))) files.push(Object.assign({}, file, { cached: true }));
              return Object.assign({}, row, { attachments: files.slice(0, 100) });
            });
          }
          const seen = new Set();
          if (field === 'posts') {
            const oldPosts = new Map((previous.posts || []).map(post => [post.id, post]));
            item.posts = item.posts.map(post => {
              const oldPost = oldPosts.get(post.id);
              // Some Teams views omit the full timestamp shown in a previously opened view.
              if (oldPost && !knownPublishedDate(post.date) && knownPublishedDate(oldPost.date)) return Object.assign({}, post, { date: oldPost.date });
              return post;
            });
          }
          const merged = item[field].concat(previous[field] || []).filter(row => {
            if (seen.has(row.id) || removed(row) || noLongerTasks.has(row.id)) return false;
            seen.add(row.id); return true;
          });
          const limit = item.coverage === 'visible' ? MAX_TEAMS_ROWS : MAX_GRAPH_ROWS;
          if (item.coverage !== 'visible') merged.sort((a, b) => (Date.parse(b.date || b.capturedAt) || 0) - (Date.parse(a.date || a.capturedAt) || 0));
          if (merged.length > limit && item.coverage !== 'visible') {
            if (item.coverage === 'graph') item.graphComplete = false;
            else item.coverageMetadata = Object.assign({}, item.coverageMetadata, { historyComplete: false, status: 'partial', reason: '本地缓存容量上限' });
            const warning = '此同步分组超过 3000 条本地缓存上限，较早记录请在 Teams 查看。';
            if (!item.warnings.includes(warning)) item.warnings.push(warning);
          }
          item[field] = merged.slice(0, limit);
        }
      }
      if (item.source === 'teams' && !previous && Object.keys(result.snapshots.teams).length >= 500) fail('Teams 已达到 500 个本地同步分组上限，无法保存新的分组');
      result.snapshots[item.source][key] = item;
    }
    if (!failed && item.source === 'managebac') {
      const courses = getCourses(result), estimate = estimateGPA(courses);
      if (estimate.count) {
        const relevant = courses.filter(c => c.gpaEligible && points(c.percentage) !== null);
        const signature = JSON.stringify(relevant.map(c => [c.id, c.term, c.percentage]).sort((a, b) => a[0].localeCompare(b[0])));
        const last = result.gradeHistory[result.gradeHistory.length - 1];
        if (!last || last.signature !== signature) {
          const entry = { capturedAt: item.capturedAt, date: today(item.capturedAt, result.settings.timezone),
            value: estimate.value, count: estimate.count, scale: 4, term: relevant[0].term, method: METHOD, signature };
          const sameDay = result.gradeHistory.findIndex(h => h.date === entry.date && termKey(h.term) === termKey(entry.term));
          if (sameDay >= 0) result.gradeHistory[sameDay] = entry;
          else result.gradeHistory.push(entry);
        }
        result.gradeHistory = result.gradeHistory.slice(-120);
      }
    }
    // Fail before the caller replaces its in-memory state or acknowledges a Graph page.
    checkSize(result);
    return result;
  }
  function resetTeamsData(state) {
    const result = validateState(state);
    result.snapshots.teams = {};
    result.settings.teamsDueOverrides = {};
    for (const map of [result.taskChecks, result.feedbackRead]) for (const key of Object.keys(map)) if (key.startsWith('teams:')) delete map[key];
    return result;
  }
  function buildView(state, date) {
    const courses = getCourses(state);
    return { date: today(date, state.settings.timezone), time: clock(date, state.settings.timezone),
      schedule: getSchedule(state, date), courses, tasks: getTasks(state), feedback: getFeedback(state),
      officialGPA: getOfficialGPA(state), estimatedGPA: estimateGPA(courses), nextClass: getNextClass(state, date),
      classClock: getClassClock(state, date), teamsPosts: getTeamsPosts(state), teamsEC: getTeamsEC(state), teamsGrades: getTeamsGrades(state),
      sources: { seiue: getSourceStatus(state, 'seiue', date), managebac: getSourceStatus(state, 'managebac', date), teams: getSourceStatus(state, 'teams', date) } };
  }
  return Object.freeze({ VERSION, configureSchools, schoolHomes, emptyState, defaultState: emptyState, validateState, normalizeState: validateState,
    mergeSnapshot, resetTeamsData, clearTeamsData: resetTeamsData, today, clock, getSchedule, getCourses, getTasks, getFeedback, getOfficialGPA, estimateGPA,
    getNextClass, getClassClock, getTeamsPosts, getTeamsEC, getTeamsGrades, getSourceStatus, buildView, safeURL, safeAttachmentURL, gradePoints: points });
});
