/* Shared calendar and desktop-widget data. Pure JS; all displayed times are Beijing time. */
(function (root, factory) {
  'use strict';
  const core = typeof module === 'object' && module.exports ? require('./core.js') : root.CampusCore;
  const api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CampusAgenda = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  const DAY = 86400000, ZONE = 'Asia/Shanghai', OFFSET = 8 * 3600000;
  let nextID = 0;
  function instant(value) {
    const result = value === undefined ? new Date() : new Date(value);
    if (!Number.isFinite(result.valueOf())) throw new Error('日程时间无效');
    return result;
  }
  function dayKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('请选择有效日期');
    const parsed = new Date(value + 'T00:00:00Z');
    if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('请选择有效日期');
    return value;
  }
  function addDays(day, count) { return new Date(Date.parse(dayKey(day) + 'T00:00:00Z') + count * DAY).toISOString().slice(0, 10); }
  function today(now) { return new Date(instant(now).valueOf() + OFFSET).toISOString().slice(0, 10); }
  function at(day, time) { return new Date(dayKey(day) + 'T' + (time || '00:00') + ':00+08:00').toISOString(); }
  function displayText(value, limit) {
    // A UTF-16 slice may cut an emoji in half and produce JSON that cannot be
    // decoded by the native widget. Bound complete Unicode code points instead.
    return Array.from(String(value || '')).slice(0, limit).join('');
  }
  function widgetID(value) {
    // Source IDs can contain URLs, account IDs or email addresses. The widget
    // only needs a stable identity for view updates, never the original key.
    let a = 2166136261, b = 0x9e3779b9;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      a = Math.imul(a ^ code, 16777619);
      b = Math.imul(b ^ code, 0x85ebca6b);
    }
    return 'item-' + (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  }
  function order(a, b) {
    return a.date.localeCompare(b.date) || Number(b.allDay) - Number(a.allDay) ||
      String(a.startAt || '').localeCompare(String(b.startAt || '')) || a.kind.localeCompare(b.kind) ||
      a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  }
  function monthRange(value) {
    const date = typeof value === 'string' && /^\d{4}-\d{2}$/.test(value) ? dayKey(value + '-01') :
      typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? dayKey(value) : today(value);
    const first = date.slice(0, 7) + '-01', weekday = new Date(first + 'T00:00:00Z').getUTCDay();
    const start = addDays(first, -(weekday + 6) % 7);
    return { start, end: addDays(start, 41), month: first.slice(0, 7) };
  }
  function range(options) {
    const start = dayKey(options.start), end = dayKey(options.end || options.start);
    const days = Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / DAY) + 1;
    if (days < 1 || days > 42) throw new Error('行事历一次可显示 1 至 42 天');
    return { start, end, days };
  }
  function schoolClockState(state) {
    return state.settings.timezone === ZONE ? state : Object.assign({}, state, { settings: Object.assign({}, state.settings, { timezone: ZONE }) });
  }
  function taskItem(task) {
    if (!task.dueAt || !Number.isFinite(Date.parse(task.dueAt))) return null;
    const startAt = instant(task.dueAt).toISOString();
    return { id: 'task:' + task.source + ':' + task.id, taskId: task.id, title: task.title,
      kind: 'task', source: task.source, date: today(startAt), startAt, endAt: null, allDay: false,
      completed: Boolean(task.completed), location: '', description: task.course || '', url: task.url || task.sourceURL || '' };
  }
  function collect(state, options, tasks) {
    const bounds = range(options), schoolState = schoolClockState(state), items = [], seen = new Set(), lessons = new Map();
    const push = item => { if (!seen.has(item.id)) { seen.add(item.id); items.push(item); } };
    const lessonsOn = day => {
      if (!lessons.has(day)) lessons.set(day, Core.getSchedule(schoolState, day));
      return lessons.get(day);
    };
    for (let offset = 0; offset < bounds.days; offset += 1) {
      const day = addDays(bounds.start, offset), nextDay = addDays(day, 1);
      const priorDay = addDays(day, -1);
      for (const lesson of lessonsOn(day).concat(lessonsOn(priorDay).filter(row => row.start && row.end && row.end < row.start && row.end !== '00:00'))) {
        if (!lesson.start || !lesson.end) continue;
        const continuation = lesson.date === priorDay;
        push({ id: 'course:' + lesson.id + ':' + day, title: lesson.title, kind: 'course', source: lesson.custom ? 'personal' : 'seiue',
          date: day, startAt: at(day, continuation ? '' : lesson.start), endAt: continuation ? at(day, lesson.end) : lesson.end <= lesson.start ? at(nextDay) : at(day, lesson.end),
          allDay: false, completed: false, location: lesson.room || '', description: lesson.teacher || '', url: lesson.sourceURL || '' });
      }
      for (const event of Core.getSchoolCalendarEvents(schoolState, day)) {
        const startTime = event.displayStartTime || '00:00', endTime = event.displayEndTime || '';
        const startAt = at(day, event.allDay ? '' : startTime), endAt = event.allDay || !endTime ? at(nextDay) : at(day, endTime);
        // Older saved calendars have no recurrenceSource and can yield an empty
        // continuation on an exclusive midnight boundary. Do not surface it.
        if (!event.allDay && endAt <= startAt) continue;
        push({ id: 'school:' + event.id + ':' + event.occurrenceDate + ':' + day, eventId: event.id,
          title: event.title, kind: 'school', source: 'school', date: day, startAt, endAt,
          allDay: event.allDay, completed: false, location: event.location || '', description: event.description || '', url: '' });
      }
      for (const event of state.personalEvents || []) {
        if (day < event.startDate || day > event.endDate) continue;
        // Midnight is an exclusive boundary: 23:00–00:00 has no next-day entry.
        if (!event.allDay && event.endTime === '00:00' && day === event.endDate) continue;
        const first = day === event.startDate, last = day === event.endDate;
        push({ id: 'personal:' + event.id + ':' + day, eventId: event.id, title: event.title, kind: 'personal', source: 'personal', date: day,
          startAt: at(day, event.allDay || !first ? '' : event.startTime),
          endAt: event.allDay || !last ? at(nextDay) : event.endTime ? at(day, event.endTime) : null,
          allDay: event.allDay, completed: false, location: event.location || '', description: event.notes || '', url: '' });
      }
    }
    for (const task of tasks || Core.getTasks(state)) {
      const item = taskItem(task);
      if (item && item.date >= bounds.start && item.date <= bounds.end) push(item);
    }
    return items.sort(order);
  }
  /** Inclusive start/end, at most 42 days. Spanning events return one clipped entry per day. */
  function buildRange(state, options) { return collect(state, options || {}, null); }
  function eventForDate(items, day) { return items.filter(item => item.date === dayKey(day)); }
  function normalizePersonalEvent(input, options) {
    const config = options || {}, now = instant(config.now).toISOString();
    const row = Object.assign({}, input, { id: config.id || input.id || 'personal-' + Date.parse(now).toString(36) + '-' + (++nextID).toString(36) + '-' + Math.random().toString(36).slice(2, 9),
      createdAt: input.createdAt || now, updatedAt: now });
    return Core.normalizePersonalEvent(row);
  }
  function upsertPersonalEvent(state, input, options) {
    const previous = (state.personalEvents || []).find(event => event.id === input.id);
    const event = normalizePersonalEvent(Object.assign({}, input, { createdAt: previous ? previous.createdAt : input.createdAt }), options);
    const events = (state.personalEvents || []).filter(row => row.id !== event.id).concat(event);
    return Core.validateState(Object.assign({}, state, { personalEvents: events }));
  }
  function removePersonalEvent(state, id) {
    return Core.validateState(Object.assign({}, state, { personalEvents: (state.personalEvents || []).filter(row => row.id !== id) }));
  }
  /** Widget contract v1: courses/calendar cover today through +7 days; homework
   * includes future and undated work, plus 20 most recent prior-day deadlines.
   * Only display titles, source enums, times and locations cross into the widget.
   * Legacy date counts describe the bounded date window. Category counts include
   * all useful candidates before the 100-item cap (including unresolved work).
   */
  function widgetSnapshot(state, now) {
    const current = instant(now), day = today(current), tasks = Core.getTasks(state);
    const inRange = collect(state, { start: day, end: addDays(day, 7) }, tasks).filter(item => !item.completed);
    const homework = tasks.filter(task => !task.completed).map(task => taskItem(task) || {
      id: 'task:' + task.source + ':' + task.id, title: task.title, kind: 'task', source: task.source,
      // This date only anchors the snapshot. A null startAt explicitly means
      // there is no known deadline; it must never become a fabricated due date.
      date: day, startAt: null, endAt: null, allDay: false, completed: false, location: ''
    });
    const overdue = homework.filter(item => item.startAt && Date.parse(item.startAt) < current.valueOf());
    const prior = overdue.filter(item => item.date < day).sort((a, b) => b.startAt.localeCompare(a.startAt)).slice(0, 20);
    const useful = inRange.filter(item => item.kind !== 'task' && (item.endAt ? Date.parse(item.endAt) > current.valueOf() : item.allDay || Date.parse(item.startAt) >= current.valueOf()));
    const courses = useful.filter(item => item.kind === 'course');
    const calendar = useful.filter(item => item.kind === 'school' || item.kind === 'personal');
    // Reserve representation for every kind instead of letting a full school
    // week exhaust the cap before calendar events or homework are reached.
    const groups = [courses, calendar.filter(item => item.kind === 'school'), calendar.filter(item => item.kind === 'personal'),
      overdue.filter(item => item.date === day).concat(prior).sort((a, b) => b.startAt.localeCompare(a.startAt)),
      homework.filter(item => item.startAt && Date.parse(item.startAt) >= current.valueOf()).sort(order),
      homework.filter(item => !item.startAt)];
    const selected = [];
    for (let index = 0; selected.length < 100; index += 1) {
      let added = false;
      for (const group of groups) {
        if (selected.length < 100 && index < group.length) { selected.push(group[index]); added = true; }
      }
      if (!added) break;
    }
    const items = selected.sort(order).map(item => ({ id: widgetID(item.id), title: displayText(item.title, 180), kind: item.kind, source: item.source,
      date: item.date, startAt: item.startAt, endAt: item.endAt, allDay: Boolean(item.allDay), completed: Boolean(item.completed), location: displayText(item.location, 160) }));
    return { schemaVersion: 1, generatedAt: current.toISOString(), day, timezone: ZONE, items,
      counts: { today: inRange.filter(item => item.date === day).length, upcoming: inRange.filter(item => item.date > day).length, overdue: overdue.length,
        courses: courses.length, calendar: calendar.length, homework: homework.length } };
  }
  return Object.freeze({ today, addDays, monthRange, buildRange, eventForDate, normalizePersonalEvent, upsertPersonalEvent, removePersonalEvent, widgetSnapshot });
});
