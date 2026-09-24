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
  function normalizeSchoolHome(value, source) {
    if (typeof value !== 'string' || value.length > 2048 || !['seiue', 'managebac'].includes(source)) return '';
    let raw = value.trim();
    if (!raw.includes('://')) raw = 'https://' + raw;
    if (!/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::443)?\/?$/i.test(raw)) return '';
    try {
      const url = new URL(raw), host = url.hostname.toLowerCase();
      const suffixes = source === 'seiue' ? ['seiue.com'] : ['managebac.com', 'managebac.cn'];
      if (host.length > 253 || !host.split('.').every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return '';
      return suffixes.some(suffix => host === suffix || host.endsWith('.' + suffix)) ? 'https://' + host + '/' : '';
    } catch (_) { return ''; }
  }
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
  function calendarDateTime(value, tzid, displayTimezone, allDay) {
    const raw = String(value || '');
    if (allDay) return { date: dayKey(raw.slice(0, 8).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')), time: '' };
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(raw);
    if (!match) fail('校历包含无法识别的事件时间');
    const local = match[1] + '-' + match[2] + '-' + match[3] + 'T' + match[4] + ':' + match[5] + ':' + (match[6] || '00');
    if (!match[7] && !tzid) return { date: dayKey(local.slice(0, 10)), time: timeKey(local.slice(11, 16)) };
    let instant;
    if (match[7]) instant = Date.parse(local + 'Z');
    else {
      // Interpret a TZID wall time, then convert it to the app's display zone.
      instant = Date.parse(local + 'Z');
      for (let i = 0; i < 3; i++) {
        const p = parts(instant, tzid);
        const represented = Date.parse(p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute + ':00Z');
        instant += Date.parse(local + 'Z') - represented;
      }
    }
    const p = parts(instant, displayTimezone || 'Asia/Shanghai');
    return { date: p.year + '-' + p.month + '-' + p.day, time: p.hour + ':' + p.minute };
  }
  function unescapeCalendarText(value) {
    return String(value || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
  }
  function parseCalendarRule(value) {
    if (!value) return null;
    const fields = {};
    for (const pair of value.split(';')) { const index = pair.indexOf('='); if (index > 0) fields[pair.slice(0, index).toUpperCase()] = pair.slice(index + 1); }
    if (Object.keys(fields).some(key => !['FREQ','INTERVAL','COUNT','UNTIL','BYDAY','WKST'].includes(key)) || (fields.WKST && fields.WKST !== 'MO')) fail('校历重复规则包含暂不支持的条件');
    const freq = String(fields.FREQ || '').toUpperCase();
    if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) fail('暂不支持校历中的重复规则：' + freq);
    const interval = Math.min(366, Math.max(1, Number(fields.INTERVAL) || 1));
    const count = fields.COUNT ? Math.min(10000, Math.max(1, Number(fields.COUNT) || 1)) : 10000;
    let until = '';
    if (fields.UNTIL) {
      const untilValue = fields.UNTIL;
      until = /^\d{8}$/.test(untilValue) ? untilValue.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') : calendarDateTime(untilValue, '', 'Asia/Shanghai', false).date;
    }
    if (fields.BYDAY && fields.BYDAY.split(',').some(item => !/^(MO|TU|WE|TH|FR|SA|SU)$/.test(item))) fail('暂不支持按第几个星期几重复的校历规则');
    const byDay = fields.BYDAY ? fields.BYDAY.split(',').map(item => item.slice(-2)).filter(item => ['MO','TU','WE','TH','FR','SA','SU'].includes(item)) : [];
    return { freq, interval, count, until, byDay };
  }
  function parseSchoolCalendarICS(text, fileName, displayTimezone) {
    if (typeof text !== 'string' || text.length > 5 * 1024 * 1024) fail('校历文件超过 5 MB 或无法读取');
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').reduce((out, line) => {
      if (/^[ \t]/.test(line) && out.length) out[out.length - 1] += line.slice(1); else out.push(line);
      return out;
    }, []);
    const events = [], props = [];
    let inEvent = false;
    for (const line of lines) {
      if (line === 'BEGIN:VEVENT') { inEvent = true; props.length = 0; continue; }
      if (line === 'END:VEVENT') {
        inEvent = false;
        const read = name => props.find(item => item.name === name);
        const startProp = read('DTSTART'), endProp = read('DTEND');
        if (!startProp) continue;
        const allDay = startProp.params.VALUE === 'DATE' || /^\d{8}$/.test(startProp.value);
        const start = calendarDateTime(startProp.value, startProp.params.TZID, displayTimezone, allDay);
        let end = endProp ? calendarDateTime(endProp.value, endProp.params.TZID || startProp.params.TZID, displayTimezone, allDay) :
          (allDay ? { date: addDays(start.date, 1), time: '' } : (() => { const next = new Date(Date.parse(start.date + 'T' + start.time + ':00Z') + 60 * 60 * 1000); return { date: next.toISOString().slice(0, 10), time: next.toISOString().slice(11, 16) }; })());
        if (allDay && end.date <= start.date) end = { date: addDays(start.date, 1), time: '' };
        if (!allDay && (end.date < start.date || (end.date === start.date && end.time <= start.time))) fail('校历事件结束时间无效');
        const uid = unescapeCalendarText((read('UID') || {}).value || '');
        const recurrence = parseCalendarRule((read('RRULE') || {}).value || '');
        const exdates = props.filter(item => item.name === 'EXDATE').flatMap(item => item.value.split(',').map(value => calendarDateTime(value, item.params.TZID || startProp.params.TZID, displayTimezone, allDay).date));
        events.push({ id: 'cal-' + hash(uid || start.date + start.time + ((read('SUMMARY') || {}).value || '') + events.length), uid, title: str(unescapeCalendarText((read('SUMMARY') || {}).value || '（无标题）'), 300),
          description: str(unescapeCalendarText((read('DESCRIPTION') || {}).value || ''), 2000), location: str(unescapeCalendarText((read('LOCATION') || {}).value || ''), 300),
          startDate: start.date, endDate: end.date, startTime: start.time, endTime: end.time, allDay,
          durationDays: Math.min(366, Math.max(0, Math.round((Date.parse(end.date + 'T00:00:00Z') - Date.parse(start.date + 'T00:00:00Z')) / 86400000))),
          recurrence, exdates: [...new Set(exdates)].slice(0, 500) });
        if (events.length > 5000) fail('校历事件超过 5000 条');
        continue;
      }
      if (!inEvent) continue;
      const colon = line.indexOf(':'); if (colon < 0) continue;
      const left = line.slice(0, colon).split(';'), name = left.shift().toUpperCase(), params = {};
      for (const part of left) { const i = part.indexOf('='); if (i > 0) params[part.slice(0, i).toUpperCase()] = part.slice(i + 1).replace(/^"|"$/g, ''); }
      props.push({ name, params, value: line.slice(colon + 1) });
    }
    if (!events.length) fail('没有找到可导入的校历事件');
    return { fileName: str(fileName || 'school-calendar.ics', 255), importedAt: new Date().toISOString(), events };
  }
  function parseSchoolCalendarPDFText(text, fileName, fallbackYear) {
    if (typeof text !== 'string' || text.length > 10 * 1024 * 1024) fail('PDF 校历文本超过 10 MB 或无法读取');
    const monthNames = { january:1, jan:1, february:2, feb:2, march:3, mar:3, april:4, apr:4, may:5, june:6, jun:6, july:7, jul:7, august:8, aug:8, september:9, sep:9, sept:9, october:10, oct:10, november:11, nov:11, december:12, dec:12 };
    const currentYear = Number(fallbackYear) || new Date().getFullYear();
    const explicitYears = [...text.matchAll(/\b(20\d{2})\b/g)].map(match => Number(match[1]));
    const defaultYear = explicitYears.length ? explicitYears.sort((a,b) => Math.abs(a-currentYear)-Math.abs(b-currentYear))[0] : currentYear;
    function validDate(year, month, day) {
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
      return date.toISOString().slice(0, 10);
    }
    function detailRows() {
      const rows = [];
      for (const raw of text.split(/\r?\n/)) {
        const item = /^\s*\d{1,2}[.、．]\s*(.+)$/.exec(raw.trim());
        if (!item) continue;
        const detail = item[1].trim();
        const date = /^(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日?\s*(?:[—–\-~～至到]\s*(?:(20\d{2})\s*年\s*)?(?:(\d{1,2})\s*月\s*)?(\d{1,2})\s*日?)?/.exec(detail);
        if (!date) continue;
        const startYear = +(date[1] || defaultYear), startMonth = +date[2], start = validDate(startYear, startMonth, +date[3]);
        const endMonth = +(date[5] || startMonth), endYear = +(date[4] || (endMonth < startMonth ? startYear + 1 : startYear));
        const end = date[6] ? validDate(endYear, endMonth, +date[6]) : start;
        if (!start || !end || end < start || Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z') > 365 * 86400000) continue;
        const title = detail.slice(date[0].length).replace(/^\s*[（(](?:周|星期)[一二三四五六日天][)）]\s*/, '').replace(/^[\s，,、:：.．]+/, '').replace(/[。．.\s]+$/, '').trim();
        if (title) rows.push({ date: start, endInclusive: end, title });
      }
      return rows;
    }
    function findDate(line) {
      let match = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(line);
      if (match) return { date: validDate(+match[1], +match[2], +match[3]), token: match[0], index: match.index };
      match = /(?:\b(20\d{2})年)?\s*(\d{1,2})月\s*(\d{1,2})日/.exec(line);
      if (match) return { date: validDate(+(match[1] || defaultYear), +match[2], +match[3]), token: match[0], index: match.index };
      match = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(line);
      if (match) { let year = match[3] ? +match[3] : defaultYear; if (year < 100) year += 2000; return { date: validDate(year, +match[1], +match[2]), token: match[0], index: match.index }; }
      match = /\b(January|Jan\.?|February|Feb\.?|March|Mar\.?|April|Apr\.?|May|June|Jun\.?|July|Jul\.?|August|Aug\.?|September|Sept?\.?|October|Oct\.?|November|Nov\.?|December|Dec\.?)\s+(\d{1,2})(?:,?\s+(20\d{2}))?\b/i.exec(line);
      if (match) { const month = monthNames[match[1].toLowerCase().replace('.', '')]; return { date: validDate(+(match[3] || defaultYear), month, +match[2]), token: match[0], index: match.index }; }
      return null;
    }
    const rows = []; let pendingDate = '';
    for (const raw of text.replace(/\r/g, '\n').split('\n')) {
      const line = raw.replace(/[\t\u00a0]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
      if (!line || /^(校历|school calendar|date|日期|event|事件|活动|说明|备注|page\s+\d+|第\s*\d+\s*页)$/i.test(line)) continue;
      const found = findDate(line);
      if (found) {
        if (!found.date) continue;
        let title = (line.slice(0, found.index) + ' ' + line.slice(found.index + found.token.length)).replace(/[|｜•·:：—–-]+/g, ' ').replace(/\b(Mon(day)?|Tue(sday)?|Wed(nesday)?|Thu(rsday)?|Fri(day)?|Sat(urday)?|Sun(day)?)\b/ig, ' ').replace(/星期[一二三四五六日天]|周[一二三四五六日天]/g, ' ').replace(/\s{2,}/g, ' ').trim();
        title = title.replace(/^(?:上午|下午|morning|afternoon)\s*/i, '').replace(/\s*(?:上午|下午)$/i, '').trim();
        if (title && !/^(?:holiday|event|活动名称|事项)$/i.test(title)) rows.push({ date: found.date, title });
        else pendingDate = found.date;
      } else if (line.length <= 240 && !/^\d+$/.test(line) && !/^(?:continued|续表|备注[:：]?|说明[:：]?)/i.test(line)) {
        if (pendingDate) { rows.push({ date: pendingDate, title: line }); pendingDate = ''; }
        else {
          const previous = rows[rows.length - 1];
          if (previous && previous.title.length < 280) previous.title = (previous.title + ' ' + line).slice(0, 300);
        }
      }
    }
    const detailed = detailRows(), selected = detailed.length ? detailed : rows;
    const seen = new Set();
    const events = selected.filter(row => { const key = row.date + '|' + (row.endInclusive || row.date) + '|' + row.title; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 500).map((row, index) => ({
      id: 'pdf-cal-' + hash(row.date + '|' + row.title + '|' + index), uid: '', title: str(row.title, 300, '校历事件'), description: '', location: '',
      startDate: row.date, endDate: addDays(row.endInclusive || row.date, 1), startTime: '', endTime: '', allDay: true,
      durationDays: Math.round((Date.parse((row.endInclusive || row.date) + 'T00:00:00Z') - Date.parse(row.date + 'T00:00:00Z')) / 86400000) + 1,
      recurrence: null, exdates: []
    }));
    if (!events.length) fail('PDF 中没有识别到“日期 + 事件名称”表格行，请确认 PDF 有可选择的文字');
    return { fileName: str(fileName || 'school-calendar.pdf', 255), importedAt: new Date().toISOString(), events };
  }
  function addDays(date, amount) { const value = new Date(date + 'T00:00:00Z'); value.setUTCDate(value.getUTCDate() + amount); return value.toISOString().slice(0, 10); }
  function normalizeSchoolCalendar(value) {
    if (value === undefined) return { fileName: '', importedAt: '', events: [] };
    record(value, '导入校历');
    return { fileName: str(value.fileName, 255), importedAt: value.importedAt ? dateISO(value.importedAt, false) : '', events: array(value.events, '校历事件', 5000).map(row => {
      record(row, '校历事件');
      const startDate = dayKey(row.startDate), endDate = dayKey(row.endDate), allDay = bool(row.allDay, false);
      if (endDate < startDate || (!allDay && endDate === startDate && timeKey(row.endTime) <= timeKey(row.startTime))) fail('校历事件日期范围无效');
      let recurrence = null;
      if (row.recurrence) {
        record(row.recurrence, '校历重复规则');
        if (!['DAILY','WEEKLY','MONTHLY','YEARLY'].includes(row.recurrence.freq)) fail('校历重复频率无效');
        recurrence = { freq: row.recurrence.freq, interval: finite(row.recurrence.interval, 1, 366, false), count: finite(row.recurrence.count, 1, 10000, false), until: row.recurrence.until ? dayKey(row.recurrence.until) : '', byDay: array(row.recurrence.byDay, '校历星期', 7).map(strDay) };
      }
      return { id: id(row.id), uid: str(row.uid, 512), title: str(row.title, 300, '（无标题）'), description: str(row.description, 2000), location: str(row.location, 300),
        startDate, endDate, startTime: allDay ? '' : timeKey(row.startTime), endTime: allDay ? '' : timeKey(row.endTime), allDay,
        durationDays: finite(row.durationDays === undefined ? Math.round((Date.parse(endDate + 'T00:00:00Z') - Date.parse(startDate + 'T00:00:00Z')) / 86400000) : row.durationDays, 0, 366, false),
        recurrence, exdates: array(row.exdates, '校历排除日期', 500).map(dayKey) };
    }) };
  }
  function strDay(value) { const day = str(value, 2); if (!['MO','TU','WE','TH','FR','SA','SU'].includes(day)) fail('校历星期无效'); return day; }
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
      reminderMinutes: 30, teamsDueOverrides: {}, dashboardTheme: 'classic', gpaCandleColors: 'red-up', language: 'zh-CN', focusSubjects: [], focusTeamsChannels: [], customLessons: [],
      scheduleHolidays: [], scheduleWeekAnchor: '', scheduleOverrides: [], focusMode: false, planOrder: [], taskMinutes: {}, taskPriority: {}, gradeGoals: {}, gradePlans: {}, gpaTermDates: {}, ecIdentityNames: [] }, snapshots: { seiue: {}, managebac: {}, teams: {} },
      manualTasks: [], taskChecks: {}, feedbackRead: {}, gradeHistory: [], changeLog: [], schoolCalendar: { fileName: '', importedAt: '', events: [] } };
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
  function periodRow(row) {
    record(row, '节次');
    const period = str(row.period || row.name, 40);
    const start = timeKey(row.start), end = timeKey(row.end);
    if (!period) fail('节次名称不能为空');
    if (end <= start) fail('节次结束时间必须晚于开始时间');
    return { period, start, end };
  }
  function dateList(value, name, limit) {
    return [...new Set(array(value, name, limit || 366).map(dayKey))].sort();
  }
  function weekPattern(value) {
    const pattern = str(value, 10, 'all').toLowerCase();
    if (!['all', 'odd', 'even'].includes(pattern)) fail('单双周设置无效');
    return pattern;
  }
  function customLessonRow(row) {
    record(row, '自编课程');
    const title = str(row.title || row.subject, 300);
    if (!title) fail('自编课程名称不能为空');
    const weekdays = array(row.weekdays, '自编课程星期', 7).map(value => finite(value, 0, 6, false));
    const date = row.date === undefined || row.date === null || row.date === '' ? '' : dayKey(row.date);
    if (!date && !weekdays.length) fail('自编课程需要指定日期或星期');
    if (new Set(weekdays).size !== weekdays.length) fail('自编课程星期重复');
    const period = str(row.period, 40);
    const start = row.start === undefined || row.start === null || row.start === '' ? '' : timeKey(row.start);
    let end = row.end === undefined || row.end === null || row.end === '' ? '' : timeKey(row.end);
    if (start && (!end || end <= start)) {
      const total = (Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + 45) % 1440;
      end = String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
    }
    if (!period && !start) fail('自编课程需要节次或开始时间');
    const skipDates = dateList(row.skipDates, '自编课程跳过日期', 366);
    return { id: id(row.id, 'custom-' + hash(title + date + period + start)), title, room: str(row.room, 200),
      date, weekdays: [...new Set(weekdays)].sort((a, b) => a - b), weekPattern: weekPattern(row.weekPattern), skipDates,
      period, start, end, byTime: bool(row.byTime, Boolean(start)), temporary: bool(row.temporary, Boolean(date)) };
  }
  function scheduleOverrideRow(row) {
    record(row, '临时调课');
    const date = dayKey(row.date), action = str(row.action, 20, 'replace').toLowerCase();
    if (!['cancel', 'replace'].includes(action)) fail('临时调课动作无效');
    const targetId = row.targetId === undefined || row.targetId === '' ? '' : id(row.targetId);
    const targetPeriod = str(row.targetPeriod, 40);
    const targetStart = row.targetStart === undefined || row.targetStart === '' ? '' : timeKey(row.targetStart);
    const targetEnd = row.targetEnd === undefined || row.targetEnd === '' ? '' : timeKey(row.targetEnd);
    if (action === 'cancel' && !targetId && !targetPeriod && !targetStart) fail('取消课程需要指定目标节次或时间');
    const title = str(row.title, 300, '临时课程');
    const start = row.start === undefined || row.start === '' ? '' : timeKey(row.start);
    let end = row.end === undefined || row.end === '' ? '' : timeKey(row.end);
    if (start && (!end || end <= start)) {
      const total = Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + 45;
      end = String(Math.floor((total % 1440) / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
    }
    if (action === 'replace' && !start && !row.period) fail('临时调课需要新的节次或开始时间');
    return { id: id(row.id, 'override-' + hash(date + action + targetPeriod + start + title)), date, action, targetId,
      targetPeriod, targetStart, targetEnd, title, room: str(row.room, 200), period: str(row.period, 40), start, end };
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
    result.gradeComponents = array(row.gradeComponents, 'GPA 成绩组成', 100).map(component => {
      record(component, 'GPA 成绩组成');
      const componentName = str(component.name, 300);
      if (!componentName) fail('GPA 成绩组成名称不能为空');
      const weight = finite(component.weight, 0, 100, false);
      if (weight <= 0) fail('GPA 成绩组成权重必须大于 0');
      return { id: id(component.id, 'component-' + hash(name + componentName)), name: componentName,
        percentage: finite(component.percentage, 0, 100, true), weight };
    });
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
      author: str(row.author, 300), recipient: str(row.recipient, 300), channel: str(row.channel, 300), date: str(row.date, 100),
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
      if (value.periods !== undefined) result.periods = array(value.periods, '节次', 100).map(periodRow);
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
      value: finite(value.value, 0, 4, false), linearValue: finite(value.linearValue, 0, 4, true), count: finite(value.count, 1, 1000, false), scale: 4,
      term: str(value.term, 300), method: str(value.method, 500, METHOD), signature: str(value.signature, 100000) };
  }
  function changeRow(value) {
    record(value, '变化记录');
    const source = str(value.source, 30);
    if (!SOURCES.includes(source)) fail('变化来源无效');
    return { id: id(value.id), source, kind: str(value.kind, 30, 'update'), category: str(value.category, 40),
      title: str(value.title, 500), course: str(value.course, 300), detail: str(value.detail, 500),
      capturedAt: dateISO(value.capturedAt, false), url: checkedURL(value.url, source, true) };
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
    s.settings.dashboardTheme = settings.dashboardTheme === undefined ? 'classic' : settings.dashboardTheme;
    if (!['classic', 'board'].includes(s.settings.dashboardTheme)) fail('面板样式无效');
    s.settings.gpaCandleColors = settings.gpaCandleColors === undefined ? 'red-up' : settings.gpaCandleColors;
    if (!['red-up', 'green-up'].includes(s.settings.gpaCandleColors)) fail('GPA K 线颜色设置无效');
    s.settings.language = settings.language === undefined ? 'zh-CN' : settings.language;
    if (!['zh-CN', 'en-US'].includes(s.settings.language)) fail('界面语言无效');
    s.settings.focusMode = bool(settings.focusMode, false);
    s.settings.ecIdentityNames = settings.ecIdentityNames === undefined ? [] : array(settings.ecIdentityNames, 'EC 姓名匹配', 10).map(value => str(value, 100));
    s.settings.planOrder = settings.planOrder === undefined ? [] : array(settings.planOrder, '今日计划顺序', 3000).map(value => str(value, 512));
    for (const key of ['taskMinutes', 'taskPriority', 'gradeGoals']) {
      if (settings[key] === undefined) { s.settings[key] = {}; continue; }
      const map = record(settings[key], key);
      if (Object.keys(map).length > MAX_ROWS) fail(key + '记录过多');
      const clean = {};
      for (const [rawID, rawValue] of Object.entries(map)) {
        const rowID = id(rawID);
        if (key === 'taskMinutes') clean[rowID] = finite(rawValue, 5, 1440, false);
        else if (key === 'taskPriority') clean[rowID] = finite(rawValue, 1, 3, false);
        else {
          record(rawValue, '成绩目标');
          clean[rowID] = { target: finite(rawValue.target, 0, 100, false), remainingWeight: finite(rawValue.remainingWeight, 1, 100, false) };
        }
      }
      s.settings[key] = clean;
    }
    s.settings.gradePlans = {};
    if (settings.gradePlans !== undefined) {
      const plans = record(settings.gradePlans, '类别成绩计划');
      if (Object.keys(plans).length > 500) fail('类别成绩计划过多');
      for (const [key, plan] of Object.entries(plans)) {
        if (!key || key.length > 1500 || BAD_KEYS.has(key)) fail('类别成绩计划标识无效');
        record(plan, '类别成绩计划');
        s.settings.gradePlans[key] = {
          target: finite(plan.target, 0, 100, false), manual: bool(plan.manual, false),
          categories: array(plan.categories, '本机类别', 40).map(row => {
            record(row, '本机类别');
            return { name: str(row.name, 300), weight: finite(row.weight, 0, 100, false), percentage: finite(row.percentage, 0, 100, true) };
          }),
          overrides: array(plan.overrides, '类别情景', 40).map(row => {
            record(row, '类别情景');
            if (!['hold', 'estimate'].includes(row.mode)) fail('类别情景无效');
            return { name: str(row.name, 300), mode: row.mode, score: finite(row.score, 0, 100, true) };
          })
        };
      }
    }
    if (settings.gpaTermDates !== undefined) {
      const terms = record(settings.gpaTermDates, 'GPA 学期日期');
      if (Object.keys(terms).length > 100) fail('GPA 学期日期过多');
      for (const [term, value] of Object.entries(terms)) {
        if (!term || term.length > 300 || BAD_KEYS.has(term)) fail('GPA 学期名称无效');
        record(value, 'GPA 学期日期');
        const start = dayKey(value.start), end = dayKey(value.end);
        if (end <= start) fail('GPA 学期结束日期必须晚于开始日期');
        s.settings.gpaTermDates[term] = { start, end };
      }
    }
    for (const [key, label] of [['focusSubjects', '特别关注学科'], ['focusTeamsChannels', '关注 Teams 频道']]) {
      const items = settings[key] === undefined ? [] : array(settings[key], label, 100).map(value => str(value, 300));
      if (items.some(value => !value)) fail(label + '不能为空');
      if (new Set(items).size !== items.length) fail(label + '重复');
      s.settings[key] = items;
    }
    s.settings.customLessons = array(settings.customLessons, '自编课程', 500).map(customLessonRow);
    s.settings.scheduleHolidays = dateList(settings.scheduleHolidays, '课表节假日', 366);
    s.settings.scheduleWeekAnchor = settings.scheduleWeekAnchor === undefined || settings.scheduleWeekAnchor === '' ? '' : dayKey(settings.scheduleWeekAnchor);
    s.settings.scheduleOverrides = array(settings.scheduleOverrides, '临时调课', 500).map(scheduleOverrideRow);
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
    // An old record only has the banded value. Recover the latest linear point
    // when its exact course signature still matches the current snapshot;
    // older points cannot be reconstructed honestly from aggregate GPA alone.
    const latestGrade = s.gradeHistory[s.gradeHistory.length - 1];
    if (latestGrade && latestGrade.linearValue == null && latestGrade.signature) {
      const currentCourses = getCourses(s).filter(c => c.gpaEligible && points(c.percentage) !== null);
      const currentSignature = JSON.stringify(currentCourses.map(c => [c.id, c.term, c.percentage]).sort((a, b) => a[0].localeCompare(b[0])));
      if (latestGrade.signature === currentSignature) latestGrade.linearValue = estimateLinearGPA(currentCourses).value;
    }
    s.changeLog = array(raw.changeLog, '变化收件箱', 600).map(changeRow);
    s.schoolCalendar = normalizeSchoolCalendar(raw.schoolCalendar);
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
  function getSchedulePeriods(state) {
    for (const snapshot of entries(state, 'seiue')) {
      if (Array.isArray(snapshot.periods) && snapshot.periods.length) return snapshot.periods.slice().sort((a, b) => a.start.localeCompare(b.start));
    }
    const latest = entries(state, 'seiue')[0];
    const seen = new Set(), inferred = [];
    for (const row of (latest && latest.schedule) || []) {
      const key = row.start + '|' + row.end;
      if (seen.has(key)) continue;
      seen.add(key); inferred.push({ period: 'P' + (inferred.length + 1), start: row.start, end: row.end });
    }
    return inferred.sort((a, b) => a.start.localeCompare(b.start));
  }
  function weekdayKey(value) { return new Date(value + 'T12:00:00Z').getUTCDay(); }
  function schoolCalendarScheduleRule(state, date) {
    const events = getSchoolCalendarEvents(state, date).filter(event => event.allDay);
    const days = { '日':0, '天':0, '一':1, '二':2, '三':3, '四':4, '五':5, '六':6 };
    for (const event of events) {
      if (event.durationDays > 1) continue;
      const match = /(?:补|按|上)(?:周|星期)([一二三四五六日天])(?:的)?(?:课|课表)/.exec(event.title);
      if (match) return { kind: 'makeup', weekday: days[match[1]], title: event.title };
    }
    const holiday = events.find(event => /(?:假期|放假|调休休息|休息日)/.test(event.title));
    return holiday ? { kind: 'holiday', title: holiday.title } : null;
  }
  function schoolCalendarScheduleConflict(state, date) {
    const key = dayKey(date), rule = schoolCalendarScheduleRule(state, key);
    if (!rule || rule.kind !== 'holiday') return null;
    const rows = entries(state, 'seiue').flatMap(snapshot => (snapshot.schedule || []).filter(row => row.date === key));
    return rows.length ? { date: key, title: rule.title, count: rows.length } : null;
  }
  function weekParity(key, anchor) {
    if (!anchor) return 'all';
    const start = new Date(anchor + 'T12:00:00Z'), current = new Date(key + 'T12:00:00Z');
    const startMonday = (start.getUTCDay() + 6) % 7, currentMonday = (current.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - startMonday); current.setUTCDate(current.getUTCDate() - currentMonday);
    const weeks = Math.floor((current.valueOf() - start.valueOf()) / (7 * 86400000));
    return ((weeks % 2) + 2) % 2 === 0 ? 'odd' : 'even';
  }
  function scheduleOverrideMatches(row, override) {
    if (override.targetId && row.id === override.targetId) return true;
    if (override.targetPeriod && String(row.period || '').toUpperCase() === override.targetPeriod.toUpperCase()) return true;
    if (override.targetStart && row.start === override.targetStart && (!override.targetEnd || row.end === override.targetEnd)) return true;
    return false;
  }
  function customScheduleForDay(state, key) {
    const rule = schoolCalendarScheduleRule(state, key);
    const periods = getSchedulePeriods(state), weekday = rule && rule.kind === 'makeup' ? rule.weekday : weekdayKey(key), holiday = (state.settings.scheduleHolidays || []).includes(key) || Boolean(rule && rule.kind === 'holiday'), parity = weekParity(key, state.settings.scheduleWeekAnchor);
    return (state.settings.customLessons || []).filter(item => {
      if (item.date === key) return true;
      if (item.date || holiday || (item.skipDates || []).includes(key) || !item.weekdays.includes(weekday)) return false;
      return item.weekPattern === 'all' || item.weekPattern === parity;
    }).map(item => {
      const period = periods.find(candidate => candidate.period.toUpperCase() === item.period.toUpperCase());
      const start = item.start || (period && period.start) || '';
      let end = item.end || (period && period.end) || '';
      if (start && !end) {
        const total = (Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + 45) % 1440;
        end = String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
      }
      return { id: item.id + '@' + key, date: key, start, end, title: item.title, room: item.room, teacher: '',
        isSelfStudy: false, custom: true, period: item.period, byTime: item.byTime, temporary: item.temporary };
    });
  }
  function applyScheduleOverrides(rows, state, key, periods) {
    const overrides = (state.settings.scheduleOverrides || []).filter(item => item.date === key);
    if (!overrides.length) return rows;
    const filtered = rows.filter(row => !overrides.some(item => item.action === 'cancel' || item.action === 'replace' ? scheduleOverrideMatches(row, item) : false));
    const additions = overrides.filter(item => item.action === 'replace').map(item => {
      const period = periods.find(candidate => String(candidate.period).toUpperCase() === String(item.period || item.targetPeriod).toUpperCase());
      const start = item.start || (period && period.start) || item.targetStart || '';
      let end = item.end || (period && period.end) || item.targetEnd || '';
      if (start && !end) {
        const total = Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + 45;
        end = String(Math.floor((total % 1440) / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
      }
      return { id: item.id + '@' + key, date: key, start, end, title: item.title, room: item.room, teacher: '',
        isSelfStudy: false, custom: true, temporary: true, period: item.period || item.targetPeriod, byTime: Boolean(item.start) };
    });
    return filtered.concat(additions);
  }
  function schedulePeriodForRow(row, periods) {
    if (row.period) return row.period;
    const start = Number(row.start.slice(0, 2)) * 60 + Number(row.start.slice(3));
    const end = Number(row.end.slice(0, 2)) * 60 + Number(row.end.slice(3));
    let best = '', bestOverlap = 0;
    for (const period of periods) {
      const a = Number(period.start.slice(0, 2)) * 60 + Number(period.start.slice(3));
      const b = Number(period.end.slice(0, 2)) * 60 + Number(period.end.slice(3));
      const overlap = Math.min(end, b) - Math.max(start, a);
      if (overlap > bestOverlap) { bestOverlap = overlap; best = period.period; }
    }
    return bestOverlap > 0 && bestOverlap / Math.max(1, end - start) >= 0.5 ? best : '';
  }
  function calendarWeekday(date) { return ['SU','MO','TU','WE','TH','FR','SA'][new Date(date + 'T00:00:00Z').getUTCDay()]; }
  function calendarMonday(date) { const day = new Date(date + 'T00:00:00Z').getUTCDay(); return addDays(date, -((day + 6) % 7)); }
  function calendarOccurrence(rule, startDate, occurrenceDate) {
    if (!rule) return occurrenceDate === startDate;
    if (occurrenceDate < startDate || (rule.until && occurrenceDate > rule.until)) return false;
    const start = new Date(startDate + 'T00:00:00Z'), current = new Date(occurrenceDate + 'T00:00:00Z');
    const dayDiff = Math.round((current - start) / 86400000), interval = rule.interval || 1;
    let matches = false;
    if (rule.freq === 'DAILY') matches = dayDiff % interval === 0;
    else if (rule.freq === 'WEEKLY') {
      const weeks = Math.round((Date.parse(calendarMonday(occurrenceDate) + 'T00:00:00Z') - Date.parse(calendarMonday(startDate) + 'T00:00:00Z')) / (7 * 86400000)), byDay = rule.byDay && rule.byDay.length ? rule.byDay : [calendarWeekday(startDate)];
      matches = weeks % interval === 0 && byDay.includes(calendarWeekday(occurrenceDate));
    } else if (rule.freq === 'MONTHLY') {
      const months = (current.getUTCFullYear() - start.getUTCFullYear()) * 12 + current.getUTCMonth() - start.getUTCMonth();
      matches = months >= 0 && months % interval === 0 && current.getUTCDate() === start.getUTCDate();
    } else if (rule.freq === 'YEARLY') matches = current.getUTCMonth() === start.getUTCMonth() && current.getUTCDate() === start.getUTCDate() && (current.getUTCFullYear() - start.getUTCFullYear()) % interval === 0;
    if (!matches) return false;
    if (rule.count && rule.count < 10000) {
      let count = 0;
      // Count generated dates through the candidate so COUNT is honored for all supported frequencies.
      for (let cursor = startDate; cursor <= occurrenceDate; cursor = addDays(cursor, 1)) {
        if (calendarOccurrenceMatches(rule, startDate, cursor)) count++;
        if (count > rule.count) return false;
      }
    }
    return true;
  }
  function calendarOccurrenceMatches(rule, startDate, occurrenceDate) {
    if (occurrenceDate < startDate || (rule.until && occurrenceDate > rule.until)) return false;
    const start = new Date(startDate + 'T00:00:00Z'), current = new Date(occurrenceDate + 'T00:00:00Z');
    const dayDiff = Math.round((current - start) / 86400000), interval = rule.interval || 1;
    if (rule.freq === 'DAILY') return dayDiff % interval === 0;
    if (rule.freq === 'WEEKLY') return Math.round((Date.parse(calendarMonday(occurrenceDate) + 'T00:00:00Z') - Date.parse(calendarMonday(startDate) + 'T00:00:00Z')) / (7 * 86400000)) % interval === 0 && (rule.byDay && rule.byDay.length ? rule.byDay : [calendarWeekday(startDate)]).includes(calendarWeekday(occurrenceDate));
    if (rule.freq === 'MONTHLY') return ((current.getUTCFullYear() - start.getUTCFullYear()) * 12 + current.getUTCMonth() - start.getUTCMonth()) % interval === 0 && current.getUTCDate() === start.getUTCDate();
    return (current.getUTCFullYear() - start.getUTCFullYear()) % interval === 0 && current.getUTCMonth() === start.getUTCMonth() && current.getUTCDate() === start.getUTCDate();
  }
  function getSchoolCalendarEvents(state, date) {
    const target = dayKey(date || today(undefined, state.settings.timezone));
    const output = [];
    for (const event of state.schoolCalendar.events) {
      const length = event.durationDays || 0, maxOffset = event.allDay ? Math.max(0, length - 1) : length;
      for (let offset = 0; offset <= maxOffset; offset++) {
        const occurrenceDate = addDays(target, -offset);
        if (occurrenceDate < event.startDate || event.exdates.includes(occurrenceDate)) continue;
        if (calendarOccurrence(event.recurrence, event.startDate, occurrenceDate)) {
          output.push(Object.assign({}, event, { date: target, occurrenceDate,
            displayStartTime: offset ? '00:00' : event.startTime,
            displayEndTime: offset === maxOffset ? event.endTime : '' }));
          break;
        }
      }
    }
    return output.sort((a, b) => Number(a.allDay) !== Number(b.allDay) ? Number(b.allDay) - Number(a.allDay) :
      (a.displayStartTime || '').localeCompare(b.displayStartTime || '') || a.title.localeCompare(b.title));
  }
  function getSchedule(state, date, includeSelfStudy) {
    const key = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? dayKey(date) : today(date, state.settings.timezone);
    const periods = getSchedulePeriods(state), seen = new Set(), rows = [];
    const calendarRule = schoolCalendarScheduleRule(state, key);
    const holiday = (state.settings.scheduleHolidays || []).includes(key) || Boolean(calendarRule && calendarRule.kind === 'holiday');
    const seiueEntries = entries(state, 'seiue');
    const schoolDateKnown = seiueEntries.some(snapshot => (snapshot.calendarDates || []).includes(key) || (snapshot.schedule || []).some(row => row.date === key));
    // One slot gets the latest authoritative title, including a change to self-study.
    for (const s of seiueEntries) {
      if (holiday) break;
      for (const r of s.schedule || []) {
        if (r.date !== key) continue;
        const slot = r.date + '|' + r.start + '|' + r.end;
        if (seen.has(slot)) continue;
        seen.add(slot);
        if (r.isSelfStudy && !state.settings.selfStudy && !includeSelfStudy) continue;
        rows.push(Object.assign({}, r, { period: schedulePeriodForRow(r, periods), capturedAt: s.capturedAt, sourceURL: s.url }));
      }
      // A verified complete day is authoritative, including a day with no lessons.
      if ((s.calendarDates || []).includes(key)) break;
    }
    if (!holiday && !schoolDateKnown && calendarRule && calendarRule.kind === 'makeup') {
      const candidates = seiueEntries.flatMap(snapshot => (snapshot.schedule || [])
        .filter(row => row.date !== key && weekdayKey(row.date) === calendarRule.weekday)
        .map(row => ({ row, distance: Math.abs(Date.parse(key + 'T12:00:00Z') - Date.parse(row.date + 'T12:00:00Z')) })))
        .filter(candidate => candidate.distance <= 35 * 86400000)
        .sort((a, b) => a.distance - b.distance);
      const nearestDate = candidates.length ? candidates[0].row.date : '';
      for (const candidate of candidates) {
        if (candidate.row.date !== nearestDate) break;
        const row = candidate.row, slot = key + '|' + row.start + '|' + row.end;
        if (seen.has(slot)) continue;
        seen.add(slot);
        if (row.isSelfStudy && !state.settings.selfStudy && !includeSelfStudy) continue;
        rows.push(Object.assign({}, row, { id: row.id + '@makeup-' + key, date: key, calendarSubstitute: true, calendarSourceDate: row.date,
          period: schedulePeriodForRow(row, periods), capturedAt: seiueEntries.find(snapshot => (snapshot.schedule || []).some(item => item.id === row.id))?.capturedAt || '',
          sourceURL: seiueEntries.find(snapshot => (snapshot.schedule || []).some(item => item.id === row.id))?.url || '' }));
      }
    }
    rows.push(...customScheduleForDay(state, key));
    const adjusted = applyScheduleOverrides(rows, state, key, periods);
    const order = new Map(periods.map((period, index) => [String(period.period).toUpperCase(), index]));
    return adjusted.sort((a, b) => {
      const ap = order.has(String(a.period || '').toUpperCase()) ? order.get(String(a.period).toUpperCase()) : 999;
      const bp = order.has(String(b.period || '').toUpperCase()) ? order.get(String(b.period).toUpperCase()) : 999;
      return ap - bp || String(a.start || '99:99').localeCompare(String(b.start || '99:99')) || String(a.title || '').localeCompare(String(b.title || ''));
    });
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
    const seen = new Map(), result = [];
    for (const s of snapshots) for (const course of s.courses || []) {
      if (course.isCurrentTerm === false) continue;
      if (chosenTerm !== null && termKey(course.term) !== chosenTerm) continue;
      const key = course.id || course.name.toLowerCase();
      const existingIndex = seen.get(key), existing = existingIndex === undefined ? null : result[existingIndex];
      const row = Object.assign({}, existing || {}, course, { capturedAt: s.capturedAt, sourceURL: s.url });
      if (existing && Number.isFinite(existing.percentage)) {
        row.percentage = existing.percentage;
        row.isCourseGrade = existing.isCourseGrade;
      }
      if (existing && (existing.gradeComponents || []).length) row.gradeComponents = existing.gradeComponents;
      if (existing) { row.capturedAt = existing.capturedAt; row.sourceURL = existing.sourceURL; }
      row.gpaEligible = row.isCurrentTerm === true && row.gpaEligible !== false &&
        ((row.isCourseGrade === true && row.percentage !== null && row.percentage !== undefined) || (row.gradeComponents || []).length > 0);
      if (existingIndex === undefined) { seen.set(key, result.length); result.push(row); }
      else result[existingIndex] = row;
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }
  function points(percentage) {
    if (typeof percentage !== 'number' || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) return null;
    return percentage >= 90 ? 4 : percentage >= 80 ? 3 : percentage >= 70 ? 2 : percentage >= 60 ? 1 : 0;
  }
  function linearPoints(percentage) {
    if (typeof percentage !== 'number' || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) return null;
    return percentage / 100 * 4;
  }
  function estimateGPA(courses) {
    const eligible = courses.filter(c => c.gpaEligible !== false && c.isCurrentTerm !== false && c.isCourseGrade !== false);
    const grades = eligible.map(c => points(c.percentage)).filter(p => p !== null);
    return { value: grades.length ? Math.round(grades.reduce((a, b) => a + b, 0) / grades.length * 100) / 100 : null,
      count: grades.length, excluded: courses.length - grades.length, scale: 4, method: METHOD };
  }
  function estimateLinearGPA(courses) {
    const eligible = courses.filter(c => c.gpaEligible !== false && c.isCurrentTerm !== false && c.isCourseGrade !== false);
    const grades = eligible.map(c => linearPoints(c.percentage)).filter(p => p !== null);
    return { value: grades.length ? grades.reduce((sum, value) => sum + value, 0) / grades.length : null,
      count: grades.length, excluded: courses.length - grades.length, scale: 4,
      method: '每门当前学期课程的百分制总评 ÷ 100 × 4，再按课程等权平均；非学校官方 GPA' };
  }
  function semesterGPAForecast(courses, termDates, now) {
    const start = termDates && termDates.start, end = termDates && termDates.end;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '') || end <= start) {
      return { available: false, reason: 'dates', courses: [], count: 0 };
    }
    try { dayKey(start); dayKey(end); } catch (_) { return { available: false, reason: 'dates', courses: [], count: 0 }; }
    const startMs = Date.parse(start + 'T00:00:00Z'), endMs = Date.parse(end + 'T00:00:00Z');
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return { available: false, reason: 'dates', courses: [], count: 0 };
    const current = now === undefined ? Date.now() : new Date(now).valueOf();
    if (!Number.isFinite(current)) fail('GPA 预测时间无效');
    const progress = Math.max(0, Math.min(1, (current - startMs) / (endMs - startMs)));
    const eligible = courses.filter(course => course.gpaEligible !== false && course.isCurrentTerm !== false &&
      (course.isCourseGrade !== false || (Array.isArray(course.gradeComponents) && course.gradeComponents.length > 0)));
    const forecasts = [];
    let missingComponents = 0, invalidWeights = 0;
    for (const course of eligible) {
      const components = Array.isArray(course.gradeComponents) ? course.gradeComponents : [];
      const totalWeight = components.reduce((sum, component) => sum + (Number(component.weight) || 0), 0);
      const graded = components.filter(component => component.percentage !== null && component.percentage !== undefined && Number.isFinite(Number(component.percentage)) && Number(component.weight) > 0);
      const gradedWeight = graded.reduce((sum, component) => sum + Number(component.weight), 0);
      if (!components.length || !gradedWeight) { missingComponents += 1; continue; }
      if (totalWeight > 100.001 || graded.some(component => Number(component.weight) <= 0 || Number(component.weight) > 100 || Number(component.percentage) < 0 || Number(component.percentage) > 100)) { invalidWeights += 1; continue; }
      const currentPercent = graded.reduce((sum, component) => sum + Number(component.percentage) * Number(component.weight), 0) / gradedWeight;
      // Neutral scenario: ungraded components and the unrepresented share are
      // projected at the student's weighted average on the components already graded.
      const projectedPercent = (graded.reduce((sum, component) => sum + Number(component.percentage) * Number(component.weight), 0) + (100 - gradedWeight) * currentPercent) / 100;
      forecasts.push({ id: course.id, name: course.name, currentPercent, projectedPercent,
        currentGPA: points(currentPercent), projectedGPA: points(projectedPercent),
        currentLinearGPA: linearPoints(currentPercent), projectedLinearGPA: linearPoints(projectedPercent), gradedWeight,
        representedWeight: Math.min(100, totalWeight), components: components.length });
    }
    const gpas = forecasts.map(course => course.projectedGPA).filter(value => value !== null);
    const remainingGpas = forecasts.map(course => course.currentGPA).filter(value => value !== null);
    const linearGpas = forecasts.map(course => course.projectedLinearGPA).filter(value => value !== null);
    const remainingLinearGpas = forecasts.map(course => course.currentLinearGPA).filter(value => value !== null);
    const daysRemaining = Math.max(0, Math.ceil((endMs - Date.UTC(new Date(current).getUTCFullYear(), new Date(current).getUTCMonth(), new Date(current).getUTCDate())) / 86400000));
    return { available: forecasts.length > 0, reason: forecasts.length ? null : missingComponents ? 'components' : invalidWeights ? 'weights' : 'components',
      start, end, progress: Math.round(progress * 1000) / 10, daysRemaining, count: forecasts.length,
      excluded: Math.max(0, eligible.length - forecasts.length), missingComponents, invalidWeights,
      coverage: forecasts.length ? Math.round(forecasts.reduce((sum, course) => sum + course.gradedWeight, 0) / forecasts.length * 10) / 10 : 0,
      remainingGPA: remainingGpas.length ? Math.round(remainingGpas.reduce((sum, value) => sum + value, 0) / remainingGpas.length * 100) / 100 : null,
      projectedGPA: gpas.length ? Math.round(gpas.reduce((sum, value) => sum + value, 0) / gpas.length * 100) / 100 : null,
      remainingLinearGPA: remainingLinearGpas.length ? remainingLinearGpas.reduce((sum, value) => sum + value, 0) / remainingLinearGpas.length : null,
      projectedLinearGPA: linearGpas.length ? linearGpas.reduce((sum, value) => sum + value, 0) / linearGpas.length : null,
      scale: 4, method: '已评分组成按学校页面中明确显示的权重加权；尚未评分的部分按该课程已评分组成的平均百分比作平稳情景；课程间等权。', courses: forecasts };
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
  function changeEvents(previous, current, source, capturedAt) {
    if (!previous) return [];
    const rows = [];
    const compare = (field, category, fields, label) => {
      const oldRows = new Map((previous[field] || []).map(row => [row.id, row]));
      for (const row of current[field] || []) {
        const old = oldRows.get(row.id);
        if (!old) {
          rows.push({ id: 'change-' + hash(source + '|new|' + row.id + '|' + category + '|' + capturedAt), source, kind: 'new', category,
            title: row.title || row.name || label, course: row.course || '', detail: '新读取到记录（可能为新增，也可能是首次覆盖到此内容）', capturedAt, url: row.url || current.url });
          continue;
        }
        const changes = fields.filter(key => JSON.stringify(old[key] == null ? null : old[key]) !== JSON.stringify(row[key] == null ? null : row[key]));
        if (!changes.length) continue;
        const details = changes.map(key => ({ dueAt: '截止日期已调整', dueLabel: '截止日期说明已调整', requirements: '作业要求已更新',
          attachments: '附件有增删或版本变化', percentage: '课程百分比成绩已更新', gradeComponents: '成绩组成、类别权重或类别均分已更新', score: '作业得分已更新', gradeLabel: '成绩等级已更新',
          text: '正文内容已更新', title: '标题已更新', status: '提交状态已更新' }[key] || '内容已更新'));
        if (field === 'posts' && row.kind === 'ec' && changes.includes('text')) {
          const before = ecSignals(old.text || ''), after = ecSignals(row.text || '');
          for (const key of ['group', 'time', 'place', 'members']) if (before[key] !== after[key] && (before[key] || after[key])) {
            details.push(({ group: 'EC 组别信息有变化', time: 'EC 时间信息有变化', place: 'EC 地点信息有变化', members: 'EC 成员名单信息有变化' })[key]);
          }
        }
        rows.push({ id: 'change-' + hash(source + '|' + row.id + '|' + category + '|' + capturedAt + '|' + changes.join(',')),
          source, kind: 'update', category, title: row.title || row.name || label, course: row.course || '', detail: [...new Set(details)].join(' · '),
          capturedAt, url: row.url || current.url });
      }
    };
    compare('tasks', '作业', ['dueAt', 'dueLabel', 'requirements', 'status', 'attachments'], '作业');
    compare('posts', '消息', ['title', 'text', 'attachments'], '消息');
    compare('courses', '成绩', ['percentage', 'gradeComponents'], '课程成绩');
    compare('grades', '成绩', ['score', 'percentage', 'gradeLabel'], '作业成绩');
    compare('feedback', '反馈', ['text', 'score', 'gradeLabel'], '老师反馈');
    // Only report removals when the source explicitly sends tombstones. An
    // absent row in a visible-page or partial sync is not proof of deletion.
    const deleted = new Set((current.graphDeletedIDs || current.deletedIDs || []).map(String));
    if (deleted.size) for (const field of ['tasks', 'posts', 'feedback', 'grades']) {
      for (const row of previous[field] || []) if ([...deleted].some(id => row.id === id || row.id.startsWith(id + ':reply:'))) {
        rows.push({ id: 'change-' + hash(source + '|removed|' + row.id + '|' + capturedAt), source, kind: 'removed', category: field === 'tasks' ? '作业' : field === 'posts' ? '消息' : field === 'grades' ? '成绩' : '反馈',
          title: row.title || row.name || '记录', course: row.course || '', detail: '来源已明确移除此记录', capturedAt, url: row.url || current.url });
      }
    }
    return rows;
  }
  function ecSignals(text) {
    const value = String(text || '').replace(/\r/g, '');
    const pick = pattern => ((value.match(pattern) || [])[1] || '').trim().replace(/\s+/g, ' ').slice(0, 240);
    return {
      group: pick(/(?:组别|小组|团队|group)\s*[:：]?\s*([^\n。；;]{2,100})/i),
      time: pick(/(?:时间|集合时间|time)\s*[:：]?\s*([^\n。；;]{2,100})/i) || pick(/\b(?:[01]?\d|2[0-3])[:：][0-5]\d(?:\s*[-–—至]\s*(?:[01]?\d|2[0-3])[:：][0-5]\d)?\b/),
      place: pick(/(?:地点|教室|位置|集合地点|location|room)\s*[:：]?\s*([^\n。；;]{2,100})/i),
      members: pick(/(?:成员|参加人员|名单|participants?|attendees?)\s*[:：]?\s*([^\n。；;]{2,240})/i)
    };
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
    const records = latest ? (source === 'seiue' ? (latest.schedule || []).length : source === 'managebac' ? (latest.courses || []).length + (latest.tasks || []).length + (latest.feedback || []).length : (latest.tasks || []).length + (latest.posts || []).length + (latest.feedback || []).length + (latest.grades || []).length) : 0;
    const failed = !!(lastAttempt && lastAttempt.lastAttemptFailed), loginRequired = !!(lastAttempt && lastAttempt.loginRequired);
    const stale = ageMinutes === null || ageMinutes > Math.max(30, state.settings.refreshMinutes * 2);
    const metadata = latest && latest.coverageMetadata;
    const partial = Boolean(lastAttempt && (lastAttempt.warnings.length || (metadata && metadata.status !== 'complete')));
    const attemptedRecords = lastAttempt ? (source === 'seiue' ? (lastAttempt.schedule || []).length : source === 'managebac' ? (lastAttempt.courses || []).length + (lastAttempt.tasks || []).length + (lastAttempt.feedback || []).length : (lastAttempt.tasks || []).length + (lastAttempt.posts || []).length + (lastAttempt.feedback || []).length + (lastAttempt.grades || []).length) : 0;
    const condition = !lastAttempt ? 'not_connected' : loginRequired ? 'login_required' : failed ? 'unread' : partial ? 'partial' : attemptedRecords === 0 ? 'empty' : stale ? 'stale' : 'available';
    return { lastCapturedAt, ageMinutes, stale, loginRequired, warnings: lastAttempt ? lastAttempt.warnings.slice() : [],
      lastAttemptAt: lastAttempt ? lastAttempt.lastAttemptAt || lastAttempt.capturedAt : null, failed, condition, records,
      snapshotCount: all.length, coverage: metadata || null, coverageLabel: lastAttempt && lastAttempt.coverage || '' };
  }
  function mergeSnapshot(state, incoming) {
    const result = validateState(state), raw = inputObject(incoming), item = snapshot(raw);
    if (!safeURL(item.url, item.source)) fail('尚未配置此学校地址，或新读取页面不属于当前配置的学校');
    const key = snapshotKey(item), previous = result.snapshots[item.source][key];
    if (previous && Date.parse(previous.lastAttemptAt || previous.capturedAt) > Date.parse(item.capturedAt)) return result;
    const hasData = item.source === 'seiue' ? item.schedule.length || item.calendarDates.length : item.source === 'teams' ? item.tasks.length || item.posts.length || item.feedback.length || item.grades.length : item.courses.length || item.tasks.length || item.feedback.length || item.officialGPA;
    const failed = item.loginRequired || item.parseError || item.success === false || !!item.error || (!hasData && item.source !== 'teams' && item.success !== true);
    const changes = !failed && previous ? changeEvents(previous, item, item.source, item.capturedAt) : [];
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
    if (changes.length) result.changeLog = result.changeLog.concat(changes).slice(-600);
    if (!failed && item.source === 'managebac') {
      const courses = getCourses(result), estimate = estimateGPA(courses), linear = estimateLinearGPA(courses);
      if (estimate.count) {
        const relevant = courses.filter(c => c.gpaEligible && points(c.percentage) !== null);
        const signature = JSON.stringify(relevant.map(c => [c.id, c.term, c.percentage]).sort((a, b) => a[0].localeCompare(b[0])));
        const last = result.gradeHistory[result.gradeHistory.length - 1];
        if (!last || last.signature !== signature || last.linearValue == null) {
          const entry = { capturedAt: item.capturedAt, date: today(item.capturedAt, result.settings.timezone),
            value: estimate.value, linearValue: linear.value, count: estimate.count, scale: 4, term: relevant[0].term, method: METHOD, signature };
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
      schedule: getSchedule(state, date), schedulePeriods: getSchedulePeriods(state), courses, tasks: getTasks(state), feedback: getFeedback(state),
      officialGPA: getOfficialGPA(state), estimatedGPA: estimateGPA(courses), linearGPA: estimateLinearGPA(courses), nextClass: getNextClass(state, date),
      classClock: getClassClock(state, date), teamsPosts: getTeamsPosts(state), teamsEC: getTeamsEC(state), teamsGrades: getTeamsGrades(state),
      schoolCalendarEvents: getSchoolCalendarEvents(state, today(date, state.settings.timezone)),
      sources: { seiue: getSourceStatus(state, 'seiue', date), managebac: getSourceStatus(state, 'managebac', date), teams: getSourceStatus(state, 'teams', date) },
      changes: state.changeLog.slice().sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt)) };
  }
  return Object.freeze({ VERSION, configureSchools, schoolHomes, normalizeSchoolHome, emptyState, defaultState: emptyState, validateState, normalizeState: validateState,
    mergeSnapshot, resetTeamsData, clearTeamsData: resetTeamsData, today, clock, getSchedule, getCourses, getTasks, getFeedback, getOfficialGPA, estimateGPA, estimateLinearGPA, semesterGPAForecast,
    getNextClass, getClassClock, getSchedulePeriods, getTeamsPosts, getTeamsEC, getTeamsGrades, getSourceStatus, buildView, getSchoolCalendarEvents, schoolCalendarScheduleRule, schoolCalendarScheduleConflict, parseSchoolCalendarICS, parseSchoolCalendarPDFText, safeURL, safeAttachmentURL, gradePoints: points, linearGradePoints: linearPoints });
});
