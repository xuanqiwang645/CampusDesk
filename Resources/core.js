/* CampusDesk data model. No network calls, credentials, or platform dependencies. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CampusCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 1;
  const MAX_BYTES = 5 * 1024 * 1024;
  const MAX_ROWS = 3000;
  const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
  const SOURCES = ['seiue', 'managebac'];
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
    if (count.n > 160000) fail('内容过多');
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
  function inputObject(input) {
    if (typeof input === 'string') {
      if (input.length > MAX_BYTES) fail('文件超过 5 MB');
      try { input = JSON.parse(input); } catch (_) { fail('不是有效的 JSON'); }
    }
    inspect(input, 0, { n: 0 });
    let length;
    try { length = JSON.stringify(input).length; } catch (_) { fail('无法读取对象'); }
    if (length > MAX_BYTES) fail('文件超过 5 MB');
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
      const seiue = host === 'seiue.com' || host.endsWith('.seiue.com');
      const managebac = host === 'managebac.com' || host.endsWith('.managebac.com') || host === 'managebac.cn' || host.endsWith('.managebac.cn');
      if ((source === 'seiue' && !seiue) || (source === 'managebac' && !managebac) || (!seiue && !managebac)) return '';
      return u.href;
    } catch (_) { return ''; }
  }
  function checkedURL(value, source, optional) {
    if ((value === undefined || value === null || value === '') && optional) return '';
    const url = safeURL(value, source);
    if (!url) fail('仅接受希悦或 ManageBac 的 HTTPS 地址');
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
      seiueURL: 'https://yly.seiue.com/', managebacURL: '' }, snapshots: { seiue: {}, managebac: {} },
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
    if (expectedURL && url !== checkedURL(expectedURL, source)) fail('快照地址不匹配');
    const result = { source, url, title: str(value.title, 500), capturedAt: dateISO(value.capturedAt, false),
      loginRequired: bool(value.loginRequired, false), warnings: array(value.warnings, '提示', 100).map(w => str(w, 2000)) };
    if (source === 'seiue') {
      result.schedule = array(value.schedule, '课表').map(scheduleRow);
      result.calendarDates = [...new Set(array(value.calendarDates, '已核对的课表日期', 366).map(dayKey))];
    }
    else {
      result.courses = array(value.courses, '成绩').map(courseRow);
      result.tasks = array(value.tasks, '待办').map(r => taskRow(r, false));
      result.feedback = array(value.feedback, '教师反馈').map(feedbackRow);
      result.officialGPA = officialGPA(value.officialGPA);
    }
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
    s.settings.seiueURL = checkedURL(settings.seiueURL || s.settings.seiueURL, 'seiue');
    s.settings.managebacURL = checkedURL(settings.managebacURL, 'managebac', true);
    const snapshots = record(raw.snapshots, '快照');
    for (const source of SOURCES) {
      const records = record(snapshots[source], source + '快照');
      const entries = Object.entries(records);
      if (entries.length > 250) fail('保存页面过多');
      for (const [url, value] of entries) {
        const entry = snapshot(value, source, url);
        s.snapshots[source][entry.url] = entry;
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
    return Object.values(state.snapshots[source]).sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
  }
  function getSchedule(state, date) {
    const key = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? dayKey(date) : today(date, state.settings.timezone);
    const seen = new Set(), rows = [];
    // One slot gets the latest authoritative title, including a change to self-study.
    for (const s of entries(state, 'seiue')) {
      for (const r of s.schedule || []) {
        if (r.date !== key) continue;
        const slot = r.date + '|' + r.start + '|' + r.end;
        if (seen.has(slot)) continue;
        seen.add(slot);
        if (r.isSelfStudy && !state.settings.selfStudy) continue;
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
      rows.push(Object.assign({}, task, { manual: false, capturedAt: s.capturedAt,
        completed: Object.prototype.hasOwnProperty.call(state.taskChecks, task.id) ? state.taskChecks[task.id] : done(task.status) }));
    }
    for (const task of state.manualTasks) rows.push(Object.assign({}, task, { manual: true,
      completed: Object.prototype.hasOwnProperty.call(state.taskChecks, task.id) ? state.taskChecks[task.id] : done(task.status) }));
    return rows.sort((a, b) => Number(a.completed) - Number(b.completed) || (Date.parse(a.dueAt) || Infinity) - (Date.parse(b.dueAt) || Infinity) || a.title.localeCompare(b.title));
  }
  function getFeedback(state) {
    const rows = [], seen = new Set();
    for (const s of entries(state, 'managebac')) for (const item of s.feedback || []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      rows.push(Object.assign({}, item, { read: state.feedbackRead[item.id] === true, capturedAt: s.capturedAt }));
    }
    return rows.sort((a, b) => Number(a.read) - Number(b.read) || (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  }
  function getNextClass(state, date) {
    const rows = getSchedule(state, date), time = clock(date, state.settings.timezone);
    return { current: rows.find(r => r.start <= time && time < r.end) || null, next: rows.find(r => r.start > time) || null };
  }
  function getSourceStatus(state, source, date) {
    if (!SOURCES.includes(source)) fail('来源无效');
    const all = entries(state, source), now = date === undefined ? Date.now() : new Date(date).valueOf();
    const useful = all.filter(s => !s.loginRequired || s.lastAttemptFailed).filter(s =>
      source === 'seiue' ? (s.schedule || []).length || (s.calendarDates || []).length : (s.courses || []).length || (s.tasks || []).length || (s.feedback || []).length || s.officialGPA);
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
    const previous = result.snapshots[item.source][item.url];
    if (previous && Date.parse(previous.capturedAt) > Date.parse(item.capturedAt)) return result;
    const hasData = item.source === 'seiue' ? item.schedule.length || item.calendarDates.length : item.courses.length || item.tasks.length || item.feedback.length || item.officialGPA;
    const failed = item.loginRequired || item.parseError || item.success === false || !!item.error || !hasData;
    // An unreadable/logged-out page records the attempted sync while retaining its last useful data.
    if (failed && previous) result.snapshots[item.source][item.url] = Object.assign({}, previous, {
      lastAttemptAt: item.capturedAt, lastAttemptFailed: true, loginRequired: item.loginRequired,
      warnings: item.warnings.length ? item.warnings : ['本次未读到可用数据，保留上次同步结果。'] });
    else {
      item.lastAttemptAt = item.capturedAt;
      item.lastAttemptFailed = !!failed;
      if (failed) {
        if (item.source === 'seiue') { item.schedule = []; item.calendarDates = []; }
        else { item.courses = []; item.tasks = []; item.feedback = []; item.officialGPA = null; }
      }
      result.snapshots[item.source][item.url] = item;
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
    return result;
  }
  function buildView(state, date) {
    const courses = getCourses(state);
    return { date: today(date, state.settings.timezone), time: clock(date, state.settings.timezone),
      schedule: getSchedule(state, date), courses, tasks: getTasks(state), feedback: getFeedback(state),
      officialGPA: getOfficialGPA(state), estimatedGPA: estimateGPA(courses), nextClass: getNextClass(state, date),
      sources: { seiue: getSourceStatus(state, 'seiue', date), managebac: getSourceStatus(state, 'managebac', date) } };
  }
  return Object.freeze({ VERSION, emptyState, defaultState: emptyState, validateState, normalizeState: validateState,
    mergeSnapshot, today, clock, getSchedule, getCourses, getTasks, getFeedback, getOfficialGPA, estimateGPA,
    getNextClass, getSourceStatus, buildView, safeURL, gradePoints: points });
});
