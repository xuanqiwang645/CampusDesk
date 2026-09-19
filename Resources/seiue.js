/* CampusDesk — read-only adapter for the rendered Seiue weekly calendar.
 * No tokens, cookies, private APIs, framework state, or network calls are used.
 * Selectors verified against the school's live September 2026 calendar.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CampusSeiue = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const DAY = 86400000;
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const CN_WEEKDAYS = { '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };
  const clean = value => String(value || '').replace(/\u00a0/g, ' ').trim();
  const isoDate = ms => new Date(ms).toISOString().slice(0, 10);
  const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

  function parseTimeRange(value) {
    const match = clean(value).match(/(?:^|\s)(\d{1,2}):(\d{2})\s*[-–—~～至]\s*(\d{1,2}):(\d{2})(?:\s|$)/);
    if (!match) return null;
    const [h1, m1, h2, m2] = match.slice(1).map(Number);
    if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59 || h2 * 60 + m2 <= h1 * 60 + m1) return null;
    return { start: String(h1).padStart(2, '0') + ':' + match[2], end: String(h2).padStart(2, '0') + ':' + match[4] };
  }

  function parseMonth(value) {
    const text = clean(value);
    let match = text.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(20\d{2})\b/i);
    if (match) return { year: Number(match[2]), month: MONTHS.indexOf(match[1].slice(0, 3).toLowerCase()) };
    match = text.match(/\b(20\d{2})\s*年\s*(\d{1,2})\s*月/);
    if (match && Number(match[2]) >= 1 && Number(match[2]) <= 12) return { year: Number(match[1]), month: Number(match[2]) - 1 };
    return null;
  }

  function parseDayHeader(value) {
    const text = clean(value);
    const day = text.match(/(?:^|\s)([1-9]|[12]\d|3[01])(?:日|\s|$)/);
    const english = text.match(/\b(Sun(?:day)?|Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?)\b/i);
    const chinese = text.match(/(?:周|星期)([一二三四五六日天])/);
    if (!day || (!english && !chinese)) return null;
    return { day: Number(day[1]), weekday: english ? WEEKDAYS.indexOf(english[1].slice(0, 3).toLowerCase()) : CN_WEEKDAYS[chinese[1]] };
  }

  // Use the displayed month/year and all seven displayed weekday/day pairs.
  // UTC is only calendar arithmetic here; it never depends on the Mac timezone.
  // Seiue's week-number picker is intentionally not treated as an ISO week.
  function resolveWeekDates(monthText, headerTexts) {
    const selected = parseMonth(monthText);
    const headers = (headerTexts || []).map(parseDayHeader);
    if (!selected || headers.length !== 7 || headers.some(x => !x)) return null;
    const first = Date.UTC(selected.year, selected.month, 1);
    const next = Date.UTC(selected.year, selected.month + 1, 1);
    const candidates = [];
    for (let start = first - 6 * DAY; start < next; start += DAY) {
      const dates = headers.map((_, index) => start + index * DAY);
      if (!dates.some(ms => ms >= first && ms < next)) continue;
      if (dates.every((ms, index) => {
        const date = new Date(ms);
        return date.getUTCDate() === headers[index].day && date.getUTCDay() === headers[index].weekday;
      })) candidates.push(dates.map(isoDate));
    }
    return candidates.length === 1 ? candidates[0] : null;
  }

  function parseDetails(value) {
    const chunks = clean(value).split(/\s{2,}/).map(clean).filter(Boolean);
    if (chunks.length >= 3) return { room: chunks[chunks.length - 2], teacher: chunks[chunks.length - 1] };
    if (chunks.length === 2) {
      const tail = chunks[1];
      if (/^(?:[A-Z]\d{2,4}|.*(?:教室|实验室|操场|体育馆))$/i.test(tail)) return { room: tail, teacher: '' };
      return { room: '', teacher: tail };
    }
    return { room: '', teacher: '' };
  }

  function identifier(parts) {
    let value = 2166136261;
    const text = parts.join('|');
    for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
    return 'seiue-' + (value >>> 0).toString(16);
  }

  function parsePeriods(texts) {
    const result = (texts || []).map(text => {
      const label = clean(text).match(/^(?:P\s*(\d+)|第\s*(\d+)\s*节)(?:\s|$)/i);
      const range = parseTimeRange(text);
      return label && range ? { number: Number(label[1] || label[2]), ...range } : null;
    });
    if (!result.length || result.some(x => !x)) return null;
    result.sort((a, b) => a.number - b.number);
    if (!result.every((period, index) => period.number === index + 1 && (!index || minutes(period.start) >= minutes(result[index - 1].end)))) return null;
    return result;
  }

  function parseCalendar(model) {
    const warnings = [];
    const dates = resolveWeekDates(model.monthText, model.headers);
    if (!model.completeWeek || !dates || !Array.isArray(model.days) || model.days.length !== 7) {
      return { schedule: [], calendarDates: [], warnings: ['请在希悦首页打开完整的周课表；未能核对日期，暂不读取课程。'] };
    }
    if (model.loading) return { schedule: [], calendarDates: [], warnings: ['希悦课表仍在加载，等待加载完成后更新。'] };
    const periods = parsePeriods(model.periods);
    if (!periods) warnings.push('未能确认完整课时列表，暂不推断自习课。');
    const schedule = [];
    model.days.forEach((day, index) => {
      const date = dates[index];
      const events = [];
      let complete = day.complete !== false;
      (day.events || []).forEach(event => {
        const range = parseTimeRange(event.time);
        const title = clean(event.title);
        if (!range || !title) { complete = false; return; }
        const details = parseDetails(event.details);
        events.push({ id: identifier([date, range.start, range.end, title, details.room]), date, ...range, title, ...details, isSelfStudy: /^(?:自习(?:课)?|self[ -]?study)$/i.test(title) });
      });
      if (!complete) warnings.push(date + ' 部分课程无法识别，未推断该日自习课。');
      const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
      // Empty whole days can be holidays or days without school. Never fill them.
      if (periods && complete && events.length && weekday >= 1 && weekday <= 5 && !day.holiday) {
        periods.forEach(period => {
          const occupied = events.some(event => minutes(event.start) < minutes(period.end) && minutes(event.end) > minutes(period.start));
          if (!occupied) events.push({ id: identifier([date, period.start, period.end, 'self-study']), date, start: period.start, end: period.end, title: '自习', room: '', teacher: '', isSelfStudy: true });
        });
      }
      schedule.push(...events);
    });
    const unique = new Map(schedule.map(event => [event.id, event]));
    return { schedule: [...unique.values()].sort((a, b) => (a.date + a.start + a.title).localeCompare(b.date + b.start + b.title)), calendarDates: dates, warnings };
  }

  function readDOM(doc) {
    const visible = element => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && element.getAttribute('aria-hidden') !== 'true';
    };
    const container = Array.from(doc.querySelectorAll('[data-test-id="seiue-schedule-container"]')).find(visible);
    if (!container) return null;
    const grid = container.querySelector('.seiue-schedule-week-calendar');
    const headerGroup = container.querySelector('[data-test-id="seiue-schedule-container-weekday-bar-group"]');
    const heading = container.querySelector('[data-test-id="seiue-schedule-container-header"]');
    const axis = container.querySelector('.seiue-schedule-lesson-view');
    const headerElements = headerGroup ? Array.from(headerGroup.children) : [];
    const columns = grid ? Array.from(grid.children) : [];
    const completeWeek = visible(grid) && headerElements.length === 7 && columns.length === 7 && columns.every((column, index) => {
      if (!visible(column) || !visible(headerElements[index])) return false;
      const a = column.getBoundingClientRect(), b = headerElements[index].getBoundingClientRect();
      return Math.abs(a.left - b.left) < 4 && Math.abs(a.width - b.width) < 4;
    });
    const loading = Array.from(container.querySelectorAll('[aria-busy="true"], .ant-spin-spinning')).some(visible);
    return {
      monthText: heading ? heading.innerText : '',
      headers: headerElements.map(element => element.innerText),
      periods: axis ? Array.from(axis.children).map(element => element.innerText) : [],
      completeWeek, loading,
      days: columns.map(column => {
        const cards = Array.from(column.querySelectorAll('.calendar-export-change-style'));
        const events = cards.map(card => {
          const title = card.querySelector('.seiue-schedule__event-title');
          const lines = clean(card.innerText).split('\n').map(clean).filter(Boolean);
          const time = lines.find(line => parseTimeRange(line));
          return { title: title ? title.innerText : '', time: time || '', details: lines.find(line => line !== clean(title && title.innerText) && line !== time) || '' };
        });
        return {
          complete: cards.every(visible), events,
          holiday: /(?:^|\n)\s*(?:holiday|no school|school closed|放假|假期|停课|节假日)(?:\s|$|[，。、:：（])/i.test(column.innerText)
        };
      })
    };
  }

  function extract(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    const location = doc && doc.location;
    const result = { source: 'seiue', url: location ? location.href : '', title: doc ? doc.title : '', capturedAt: new Date().toISOString(), loginRequired: false, schedule: [], calendarDates: [], warnings: [] };
    if (!doc) { result.warnings.push('没有可读取的页面。'); return result; }
    const model = readDOM(doc);
    const bodyText = clean(doc.body && doc.body.innerText);
    result.loginRequired = !model && (!!doc.querySelector('input[type="password"]') || /(?:登录|sign in|log in)/i.test(bodyText.slice(0, 3000)));
    if (result.loginRequired) { result.warnings.push('请在希悦页面登录，登录成功后会自动读取周课表。'); return result; }
    if (!model) { result.warnings.push('当前页面没有周课表，请打开希悦首页并选择“周”。'); return result; }
    return { ...result, ...parseCalendar(model) };
  }

  return { extract, parseTimeRange, parseMonth, parseDayHeader, resolveWeekDates, parseDetails, parsePeriods, parseCalendar, readDOM };
});
