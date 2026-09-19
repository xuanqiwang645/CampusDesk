(function () {
  'use strict';
  const Core = window.CampusCore;
  if (!Core) {
    document.getElementById('content').textContent = '核心文件 core.js 未能加载。请重新解压完整的 CampusDesk 文件夹。';
    return;
  }
  const native = Boolean(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.campus);
  const storageKey = 'campusdesk.browser.v1';
  let state = Core.emptyState();
  let page = ['overview', 'schedule', 'grades', 'tasks', 'feedback', 'settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  let selectedDate = Core.today();
  let taskFilter = 'open';
  let feedbackFilter = 'all';
  let statuses = {};
  let toastTimer = null;
  let lastMenuTitle = '';
  const pageNames = { overview: '总览', schedule: '课程表', grades: '成绩与 GPA', tasks: '待办事项', feedback: '老师反馈', settings: '连接与设置' };
  const icons = {
    overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    schedule: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-13 4h3m3 0h3m-9 3h3"/>',
    grades: '<path d="M4 20V10m6 10V4m6 16v-7m5 7H2"/>',
    tasks: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/>',
    feedback: '<path d="M21 11a8 8 0 0 1-8 8H7l-4 3v-8a8 8 0 0 1 8-10h2a8 8 0 0 1 8 7Z"/><path d="M7 10h9m-9 4h6"/>',
    settings: '<path d="m9 3-.6 2.1-2 .9-2.1-.5-2 3.5L4 10.5v3L2.3 15l2 3.5 2.1-.5 2 .9L9 21h4l.6-2.1 2-.9 2.1.5 2-3.5-1.7-1.5v-3L19.7 9l-2-3.5-2.1.5-2-.9L13 3Z"/><circle cx="11" cy="12" r="3"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.4 7a8 8 0 0 1 13-2L20 7M4 17l1.6 2a8 8 0 0 0 13-2"/>',
    arrow: '<path d="m9 5 7 7-7 7"/>',
    back: '<path d="m15 5-7 7 7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    link: '<path d="M14 4h6v6m0-6L10 14M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/>',
    book: '<path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1m0-14c3-2 6-2 9-1v14c-3-1-6-1-9 1V6Z"/>',
    cloud: '<path d="M7 18a5 5 0 1 1 0-10 6 6 0 0 1 11-1 5.5 5.5 0 0 1 0 11M12 13v8m-3-3 3 3 3-3"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
  };
  function icon(name, cls) { return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (icons[name] || icons.book) + '</svg>'; }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
  function fmtDate(value, opts) {
    if (!value) return '时间未标明';
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return String(value);
    return new Intl.DateTimeFormat('zh-CN', Object.assign({ timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' }, opts || {})).format(d);
  }
  function lastUpdated(value) { return value ? fmtDate(value, { hour: '2-digit', minute: '2-digit', hour12: false }) : '尚未同步'; }
  function dayLabel(value) { return fmtDate(value + 'T12:00:00+08:00', { weekday: 'long' }); }
  function button(label, action, extra, kind) { return '<button class="button ' + (kind || 'button-light') + '" type="button" data-action="' + esc(action) + '" ' + (extra || '') + '>' + label + '</button>'; }
  function goLink(target, label) { return '<button type="button" class="view-link" data-page="' + target + '">' + label + icon('arrow') + '</button>'; }
  function toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message; el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 5200);
  }
  function send(action, details) {
    if (native) { window.webkit.messageHandlers.campus.postMessage(Object.assign({ action: action }, details || {})); return true; }
    return false;
  }
  function persist() {
    if (!send('saveState', { state: state })) {
      try { localStorage.setItem(storageKey, JSON.stringify(state)); }
      catch (_) { toast('浏览器无法保存数据。请导出备份，或使用 Mac 应用。'); }
    }
  }
  function sourceName(source) { return source === 'seiue' ? '希悦' : 'ManageBac'; }
  function sourceURL(source) { return source === 'seiue' ? 'https://yly.seiue.com/' : 'https://beijing101.managebac.cn/'; }
  function openSource(source, requestedURL) {
    const url = requestedURL ? Core.safeURL(requestedURL, source) : Core.safeURL(sourceURL(source), source);
    if (!url) { navigate('settings'); toast('请先填写学校的 ' + sourceName(source) + ' 网址。'); return; }
    if (!send('openSource', { source: source, url: url })) {
      window.open(url, '_blank', 'noopener,noreferrer');
      toast('网页版只能打开学校网站。登录并同步学校数据需要使用 CampusDesk Mac 应用。');
    }
  }
  function sourceStatus(source) { return Core.getSourceStatus(state, source); }
  function sourceFooter(source) {
    const s = sourceStatus(source);
    return '<div class="section-foot"><span>' + esc(sourceName(source)) + ' · ' + esc(lastUpdated(s.lastCapturedAt)) + '</span><span>' + (s.loginRequired ? '请重新登录' : (s.stale && s.lastCapturedAt ? '缓存可能已过期' : '')) + '</span></div>';
  }
  function empty(kind, title, description, cta) {
    return '<div class="empty"><div class="empty-illustration">' + icon(kind) + '</div><h3>' + esc(title) + '</h3><p>' + esc(description) + '</p>' + (cta || '') + '</div>';
  }
  function heading(title, subtitle, right) {
    return '<div class="page-heading"><div><div class="eyebrow">YOUR EVERYDAY, IN VIEW</div><h1>' + esc(title) + '</h1><p class="page-subtitle">' + esc(subtitle) + '</p></div>' + (right || '') + '</div>';
  }
  function cardHeader(name, title, right) { return '<div class="card-header"><h2 class="card-title"><span class="icon">' + icon(name) + '</span>' + title + '</h2>' + (right || '') + '</div>'; }
  function scheduleRows(rows, date) {
    const now = Core.clock(), today = Core.today();
    return '<div class="schedule-list">' + rows.map(row => {
      const current = date === today && row.start && row.end && row.start <= now && row.end > now;
      const past = date < today || (date === today && row.end && row.end <= now);
      return '<div class="schedule-row ' + (current ? 'current' : past ? 'past' : '') + '"><div class="schedule-time">' + esc(row.start || '待定') + '<small>' + esc(row.end || '') + '</small></div><div class="timeline"><span class="timeline-dot"></span></div><div class="class-tile"><h3>' + esc(row.title || (row.isSelfStudy ? '自习课' : '未命名课程')) + (current ? '<span class="inline-label">正在上课</span>' : '') + '</h3><div class="class-meta">' + (row.room ? '<span>' + esc(row.room) + '</span>' : '') + (row.teacher ? '<span>' + esc(row.teacher) + '</span>' : '') + (row.isSelfStudy ? '<span>空白课节 · 自习</span>' : '') + (!row.room && !row.teacher && !row.isSelfStudy ? '<span>教室与教师未显示</span>' : '') + '</div></div></div>';
    }).join('') + '</div>';
  }
  function noSchedule(date) {
    const status = sourceStatus('seiue');
    const connected = Boolean(status.lastCapturedAt);
    return empty('schedule', connected ? '这一天暂无已读取的课程' : '先把你的课程表接进来', connected ? '可能没有课程，也可能尚未读取这一天。打开希悦核对并切换到对应日期，再同步。' : '在应用中登录希悦并打开课程表，这里的每一天就有了安排。', button('打开希悦', 'open-source', 'data-source="seiue"', 'button-light'));
  }
  function getGpaView() {
    const official = Core.getOfficialGPA(state);
    const courses = Core.getCourses(state);
    const estimate = Core.estimateGPA(courses);
    return { official: official, estimate: estimate, courses: courses };
  }
  function gpaValue(value, scale) { return '<div class="gpa-value">' + (value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(2)) + '<small>/ ' + esc(scale || '4.00') + '</small></div>'; }
  function taskDue(task) {
    if (!task.dueAt) return { label: task.dueLabel || '未设置截止日期', overdue: false };
    const time = new Date(task.dueAt).getTime();
    if (!Number.isFinite(time)) return { label: task.dueLabel || '截止日期待核对', overdue: false };
    return { label: fmtDate(task.dueAt, { hour: '2-digit', minute: '2-digit', hour12: false }), overdue: !task.completed && time < Date.now() };
  }
  function taskRows(tasks, limit) {
    return '<div class="task-list">' + tasks.slice(0, limit || tasks.length).map(task => {
      const local = state.manualTasks.some(t => t.id === task.id);
      const due = taskDue(task);
      return '<div class="task-row ' + (task.completed ? 'done' : '') + '"><button class="check-button ' + (task.completed ? 'checked' : '') + '" type="button" data-action="toggle-task" data-id="' + esc(task.id) + '" aria-label="' + esc((task.completed ? '标为未完成：' : '标为已完成：') + task.title) + '" aria-pressed="' + Boolean(task.completed) + '">' + (task.completed ? icon('check') : '') + '</button><div class="task-copy"><h3>' + esc(task.title) + '</h3><div class="task-meta"><span>' + esc(task.course || (local ? '个人待办' : 'ManageBac')) + '</span><span class="' + (due.overdue ? 'overdue' : '') + '">' + (due.overdue ? '已逾期 · ' : '') + esc(due.label) + '</span></div></div><span class="task-tag ' + (local ? 'local' : '') + '">' + (local ? '个人' : '学校') + '</span>' + (local ? '<button class="icon-button" data-action="delete-task" data-id="' + esc(task.id) + '" aria-label="删除个人待办" title="删除个人待办">' + icon('trash') + '</button>' : task.url ? '<button class="icon-button" data-action="open-source" data-source="managebac" data-url="' + esc(task.url) + '" aria-label="打开学校任务" title="打开学校任务">' + icon('link') + '</button>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function feedbackRows(items, limit) {
    return items.slice(0, limit || items.length).map(item => '<article class="feedback-row"><div class="feedback-top"><span class="feedback-initial">' + esc((item.teacher || '师').slice(0, 1)) + '</span><span>' + esc(item.teacher || '老师反馈') + '</span>' + (!item.read ? '<span class="unread-dot" aria-label="未读"></span>' : '') + '<span class="feedback-course">' + esc(item.course || '') + '</span></div><p class="feedback-text">' + esc(item.text) + '</p><div class="feedback-bottom"><span>' + esc(item.date ? fmtDate(item.date) : '日期未标明') + '</span><span><button type="button" data-action="toggle-feedback" data-id="' + esc(item.id) + '">' + (item.read ? '标为未读' : '标为已读') + '</button>' + (item.url ? '<button type="button" data-action="open-source" data-source="managebac" data-url="' + esc(item.url) + '">查看原文 ↗</button>' : '') + '</span></div></article>').join('');
  }
  function renderOverview() {
    const today = Core.today(), classes = Core.getSchedule(state, today), tasks = Core.getTasks(state), feedback = Core.getFeedback(state);
    const openTasks = tasks.filter(t => !t.completed), overdue = openTasks.filter(t => taskDue(t).overdue).length;
    const dueToday = openTasks.filter(t => t.dueAt && Core.today(new Date(t.dueAt)) === today).length;
    const gpa = getGpaView(), displayGpa = gpa.official || gpa.estimate;
    const course = Core.getNextClass(state);
    const connected = Boolean(sourceStatus('seiue').lastCapturedAt || sourceStatus('managebac').lastCapturedAt);
    const topText = course.current ? '正在上 ' + course.current.title + '，' + (course.current.end || '课后') + ' 结束。' : course.next ? '下一节是 ' + course.next.title + '，' + (course.next.start || '时间待定') + ' 开始。' : '课程、成绩和待办，在这里从容安排。';
    const date = new Date();
    return heading('今天，也有条不紊。', topText, '<div class="date-stamp">' + esc(fmtDate(date, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })) + '<span>BEIJING · ' + esc(Core.clock()) + '</span></div>') +
      (!native ? '<div class="browser-banner">你正在使用网页预览。个人待办可以本地保存；学校登录与自动同步需要打开 CampusDesk Mac 应用。</div>' : '') +
      (!connected ? '<div class="connect-banner"><div class="banner-icon">' + icon('cloud') + '</div><div class="banner-copy"><h3>连接校园，开始你的第一天</h3><p>分别登录希悦与 ManageBac。读取已登录页面后显示真实数据。</p></div><div class="banner-actions">' + button('连接希悦', 'open-source', 'data-source="seiue"', 'button-primary') + button('连接 ManageBac', 'open-source', 'data-source="managebac"') + '</div></div>' : '') +
      '<div class="overview-grid"><section class="card schedule-card">' + cardHeader('schedule', '今日课程', goLink('schedule', '完整课表')) + (classes.length ? scheduleRows(classes, today) : noSchedule(today)) + sourceFooter('seiue') + '</section>' +
      '<section class="card gpa-card">' + cardHeader('grades', gpa.official ? '学校 GPA' : '参考 GPA', goLink('grades', '成绩详情')) + '<div class="gpa-row">' + gpaValue(displayGpa && displayGpa.value, displayGpa && displayGpa.scale) + '<div class="gpa-detail">' + (gpa.official ? '学校页面显示的 GPA<br>' + esc(gpa.official.label || '') : '非官方 · 等权参考<br>' + esc(gpa.estimate.count || 0) + ' 门可用课程') + '</div></div><p class="gpa-note">' + (gpa.official ? '以学校正式成绩单为准。' : '90 / 80 / 70 / 60 分 → 4 / 3 / 2 / 1，不含 AP 加权。') + '</p></section>' +
      '<section class="card task-summary-card">' + cardHeader('tasks', '待办一览', goLink('tasks', '全部待办')) + '<div class="task-stats"><div class="stat"><span class="stat-number">' + openTasks.length + '</span><span class="stat-name">未完成</span></div><div class="stat"><span class="stat-number">' + dueToday + '</span><span class="stat-name">今日截止</span></div><div class="stat overdue"><span class="stat-number">' + overdue + '</span><span class="stat-name">已逾期</span></div></div></section></div>' +
      '<div class="overview-bottom"><section class="card">' + cardHeader('tasks', '接下来要做', button(icon('plus') + '添加待办', 'add-task', '', 'button-plain')) + (openTasks.length ? taskRows(openTasks, 4) : '<div class="empty small-empty"><h3>给重要的事留一个位置</h3><p>学校任务会在同步后出现，也可以先添加自己的待办。</p></div>') + '<div class="section-foot"><span>完成勾选仅保存在本机</span><span>不代表已向学校提交</span></div></section><section class="card feedback-preview">' + cardHeader('feedback', '老师的反馈', goLink('feedback', '查看全部')) + (feedback.length ? feedbackRows(feedback, 1) : '<div class="empty small-empty"><h3>等待新的反馈</h3><p>同步后汇总已读取的老师评语。仅覆盖已读取页面。</p></div>') + sourceFooter('managebac') + '</section></div>';
  }
  function renderSchedule() {
    const rows = Core.getSchedule(state, selectedDate);
    return heading('为每一节课，留好位置。', '以北京时间展示课程。空白课节按你的设置显示为自习。') + '<div class="page-tools"><div class="date-control"><button class="icon-button" type="button" data-action="prev-day" aria-label="前一天">' + icon('back') + '</button><label class="visually-hidden" for="schedule-date">课表日期</label><input id="schedule-date" type="date" value="' + esc(selectedDate) + '"><button class="icon-button" type="button" data-action="next-day" aria-label="后一天">' + icon('arrow') + '</button><span class="date-day">' + esc(dayLabel(selectedDate)) + '</span>' + button('今天', 'today') + '</div>' + button(icon('link') + '打开希悦课表', 'open-source', 'data-source="seiue"') + '</div><section class="card schedule-full">' + cardHeader('schedule', selectedDate === Core.today() ? '今日课程' : esc(selectedDate) + ' 的课程', '<span class="card-kicker">' + rows.length + ' 节已读取课程</span>') + (rows.length ? scheduleRows(rows, selectedDate) : noSchedule(selectedDate)) + sourceFooter('seiue') + '</section><p class="footer-note">自习仅补充学校页面中能确认时间的空白课节，不推测未读取的课表。</p>';
  }
  function renderGrades() {
    const gpa = getGpaView();
    return heading('看见积累，也看见进步。', '先确认成绩来自哪一门课、哪一个学期，再理解 GPA。', button(icon('link') + '打开成绩页面', 'open-source', 'data-source="managebac"')) +
      '<div class="grade-top"><section class="card">' + cardHeader('grades', '学校 GPA', '<span class="card-kicker">学校公布</span>') + gpaValue(gpa.official && gpa.official.value, gpa.official ? gpa.official.scale : '—') + '<p class="gpa-note">' + (gpa.official ? esc(gpa.official.label || '来自已读取的学校页面，以正式成绩单为准。') : '尚未读取到学校公布的 GPA。这里不会用参考值替代。') + '</p></section><section class="card">' + cardHeader('grades', '参考 GPA', '<span class="card-kicker">非官方 · 4.0 制</span>') + gpaValue(gpa.estimate.value, '4.00') + '<p class="gpa-note">根据 ' + esc(gpa.estimate.count || 0) + ' 门可用课程等权估算' + (gpa.estimate.excluded ? '，另有 ' + esc(gpa.estimate.excluded) + ' 门未计入' : '') + '。</p></section></div>' +
      '<div class="info-note">参考换算：90–100 → 4.0；80–89.99 → 3.0；70–79.99 → 2.0；60–69.99 → 1.0；低于 60 → 0。仅使用能确认的当前学期课程总评，不把单次作业分数当总评；不含学分与 AP 加权，也不代表学校的换算规则。</div><section class="card">' + cardHeader('book', '课程成绩', '<span class="card-kicker">' + gpa.courses.length + ' 门已读取课程</span>') +
      (gpa.courses.length ? '<div style="overflow-x:auto"><table class="grade-table"><thead><tr><th>课程</th><th>学期</th><th>百分制总评</th><th>参考绩点</th><th></th></tr></thead><tbody>' + gpa.courses.map(c => '<tr><td class="course-name">' + esc(c.name) + '</td><td>' + esc(c.term || '未确认') + '</td><td class="num">' + (c.percentage == null ? '—' : esc(Number(c.percentage).toFixed(1)) + '%') + (c.percentage == null ? '' : '<span class="grade-bar"><span style="width:' + Math.max(0, Math.min(100, Number(c.percentage) || 0)) + '%"></span></span>') + '</td><td class="num">' + (c.gpaEligible === false || c.percentage == null ? '未计入' : Core.estimateGPA([c]).value == null ? '未计入' : Number(Core.estimateGPA([c]).value).toFixed(1)) + '</td><td>' + (c.url ? '<button type="button" class="icon-button" data-action="open-source" data-source="managebac" data-url="' + esc(c.url) + '" aria-label="打开课程成绩">' + icon('link') + '</button>' : '') + '</td></tr>').join('') + '</tbody></table></div>' : empty('grades', '你的成绩，值得准确地记录', '登录 ManageBac 并打开当前学期成绩页面。读取到课程总评后，参考 GPA 会自动计算。', button('打开 ManageBac', 'open-source', 'data-source="managebac"'))) + sourceFooter('managebac') + '</section>' + renderHistory();
  }
  function renderHistory() {
    const history = (state.gradeHistory || []).filter(h => h.value != null && Number.isFinite(Number(h.value))).slice(-12);
    if (!history.length) return '';
    return '<section class="card" style="margin-top:21px">' + cardHeader('clock', '本机记录的 GPA 变化', '<span class="card-kicker">参考值 · 最近 ' + history.length + ' 次</span>') + '<table class="grade-table"><thead><tr><th>记录时间</th><th>参考 GPA</th><th>计入课程</th></tr></thead><tbody>' + history.slice().reverse().map(h => '<tr><td>' + esc(lastUpdated(h.capturedAt || h.date)) + '</td><td>' + Number(h.value).toFixed(2) + '</td><td>' + esc(h.count) + ' 门</td></tr>').join('') + '</tbody></table><p class="gpa-note">记录从使用本应用后开始；课程覆盖范围变化也可能导致参考值变化。</p></section>';
  }
  function renderTasks() {
    const all = Core.getTasks(state);
    let tasks = all.filter(t => taskFilter === 'all' || (taskFilter === 'done' ? t.completed : taskFilter === 'overdue' ? taskDue(t).overdue : !t.completed));
    return heading('一件一件，慢慢完成。', '汇总学校任务，也留一个位置给自己的安排。', button(icon('plus') + '添加待办', 'add-task', '', 'button-primary')) + '<div class="page-tools"><div class="filter-pills">' + [['open', '未完成'], ['overdue', '已逾期'], ['done', '已完成'], ['all', '全部']].map(f => '<button type="button" class="pill ' + (taskFilter === f[0] ? 'active' : '') + '" data-action="task-filter" data-filter="' + f[0] + '">' + f[1] + '</button>').join('') + '</div><span class="subtle">' + tasks.length + ' 项</span></div><div class="info-note">勾选仅更新本机待办状态，不会提交作业、回复老师或修改 ManageBac。学校页面显示的完成状态可能不同，请以原页面为准。</div><section class="card">' + (tasks.length ? taskRows(tasks) : empty('tasks', taskFilter === 'done' ? '完成的事情，会留在这里' : '这里暂时没有待办', taskFilter === 'open' ? '连接 ManageBac 获取已读取的学校任务，或添加一个个人待办。' : '切换筛选条件，查看其他任务。', taskFilter === 'open' ? button(icon('plus') + '添加待办', 'add-task', '', 'button-primary') : '')) + sourceFooter('managebac') + '</section>';
  }
  function renderFeedback() {
    const all = Core.getFeedback(state), items = all.filter(f => feedbackFilter === 'all' || !f.read);
    return heading('认真读懂，每一次反馈。', '把老师的建议带回下一次学习。', button(icon('link') + '打开 ManageBac', 'open-source', 'data-source="managebac"')) + '<div class="page-tools"><div class="filter-pills"><button type="button" class="pill ' + (feedbackFilter === 'all' ? 'active' : '') + '" data-action="feedback-filter" data-filter="all">全部反馈</button><button type="button" class="pill ' + (feedbackFilter === 'unread' ? 'active' : '') + '" data-action="feedback-filter" data-filter="unread">未读</button></div><span class="subtle">' + items.length + ' 条</span></div><div class="info-note">这里汇总已读取页面中的评语与反馈，覆盖范围可能不完整。尚未读取的课程、附件或历史页面请到 ManageBac 查看。已读标记仅保存在本机。</div><section class="card">' + (items.length ? feedbackRows(items) : empty('feedback', feedbackFilter === 'unread' ? '没有已读取的未读反馈' : '等待老师的下一条建议', '登录 ManageBac，打开课程的反馈或评语页面，再同步。系统不会生成示例评语。', button('打开 ManageBac', 'open-source', 'data-source="managebac"'))) + sourceFooter('managebac') + '</section>';
  }
  function renderSourceCard(source) {
    const status = sourceStatus(source), busy = statuses[source] && statuses[source].busy;
    const badge = busy ? '正在同步' : status.loginRequired ? '需要登录' : status.lastCapturedAt ? status.stale ? '缓存待更新' : '已读取' : '尚未连接';
    return '<section class="card source-card"><div class="source-header"><span class="source-logo ' + (source === 'managebac' ? 'mb' : '') + '">' + (source === 'seiue' ? '希' : 'M') + '</span><div><h2>' + sourceName(source) + '</h2><p>' + (source === 'seiue' ? '课程表 · 上课时间 · 教室' : '课程成绩 · 学校任务 · 老师反馈') + '</p></div><span class="status-badge ' + (status.stale || status.loginRequired ? 'warning' : '') + '">' + badge + '</span></div><p>最近读取：' + esc(lastUpdated(status.lastCapturedAt)) + '</p>' + (statuses[source] && statuses[source].message ? '<p>' + esc(statuses[source].message) + '</p>' : '') + (status.warnings && status.warnings.length ? '<div class="source-warning">' + status.warnings.slice(0, 3).map(esc).join('<br>') + '</div>' : '') + '<div class="source-actions">' + button(status.lastCapturedAt ? '打开学校页面' : '登录并连接', 'open-source', 'data-source="' + source + '"', 'button-primary') + button('退出登录', 'clear-session', 'data-source="' + source + '"') + '</div></section>';
  }
  function renderSettings() {
    return heading('让它适合你的每一天。', '两套学校系统，各自登录；读取结果保存在本机。') + (!native ? '<div class="browser-banner">这是网页预览。登录、会话管理与自动读取只在 Mac 应用中可用。</div>' : '') + '<div class="source-grid">' + renderSourceCard('seiue') + renderSourceCard('managebac') + '</div><section class="card settings-section">' + cardHeader('link', '学校连接') + '<div class="settings-fields"><div class="settings-field"><div><label for="seiue-url">希悦网址</label><p>北京学校的希悦系统。</p></div><input id="seiue-url" type="url" value="https://yly.seiue.com/" readonly></div><div class="settings-field"><div><label for="managebac-url">学校 ManageBac 网址</label><p>北京一零一中的 ManageBac 系统。</p></div><input id="managebac-url" type="url" value="https://beijing101.managebac.cn/" readonly></div></div></section><section class="card settings-section">' + cardHeader('settings', '日常偏好') + '<div class="settings-fields"><div class="settings-field"><div><label for="refresh-minutes">自动刷新间隔</label><p>应用正在运行且电脑联网时，尝试更新已连接的数据。</p></div><select id="refresh-minutes">' + [[5, '每 5 分钟'], [15, '每 15 分钟'], [30, '每 30 分钟'], [60, '每小时']].map(o => '<option value="' + o[0] + '" ' + (Number(state.settings.refreshMinutes) === o[0] ? 'selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div><div class="settings-field"><div><label for="self-study">空白课节显示为自习</label><p>只处理希悦明确给出时间的空白课节。</p></div><label class="toggle" for="self-study"><input id="self-study" type="checkbox" ' + (state.settings.selfStudy ? 'checked' : '') + ' aria-label="空白课节显示为自习"><span></span></label></div><div class="settings-field"><div><label>显示时区</label><p>在不同地区使用 Mac，也按北京的上课时间展示。</p></div><span class="subtle">Asia / Shanghai · UTC+8</span></div></div></section><section class="card settings-section">' + cardHeader('cloud', '数据与备份') + '<div class="settings-fields"><div class="settings-field"><div><label>导出或恢复本机数据</label><p>包含课程缓存、个人待办及 GPA 记录。备份不包含登录会话或密码。</p></div><div class="backup-actions">' + button('导出备份', 'export') + button('导入备份', 'import') + '</div></div></div></section><div class="info-note">首次使用：先在应用内分别登录学校系统，再打开课表、当前学期成绩、待办与反馈页面。同步时会读取当前可访问页面；登录过期或网络失败时保留上次读取结果，并显示时间。学校页面结构变化可能需要更新应用。</div><p class="footer-note">CampusDesk 0.1 测试版 · 独立学习工具，与希悦及 ManageBac 无隶属关系。</p>';
  }
  function navigate(target) {
    if (!pageNames[target]) return;
    page = target;
    location.hash = target;
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  function renderNav() {
    const openCount = Core.getTasks(state).filter(t => !t.completed).length;
    document.getElementById('nav').innerHTML = ['overview', 'schedule', 'grades', 'tasks', 'feedback'].map(key => '<button type="button" class="nav-item ' + (page === key ? 'active' : '') + '" data-page="' + key + '" ' + (page === key ? 'aria-current="page"' : '') + '><span class="icon">' + icon(key) + '</span>' + pageNames[key] + (key === 'tasks' && openCount ? '<span class="nav-count">' + openCount + '</span>' : '') + '</button>').join('');
    document.querySelector('.settings-nav').classList.toggle('active', page === 'settings');
    document.getElementById('settings-icon').innerHTML = icon('settings');
  }
  function updateStatus() {
    const busy = Object.values(statuses).some(s => s.busy);
    const sync = document.getElementById('sync-button');
    sync.disabled = busy; sync.classList.toggle('syncing', busy);
    const sourceTimes = ['seiue', 'managebac'].map(s => sourceStatus(s).lastCapturedAt).filter(Boolean).sort();
    const active = Object.values(statuses).find(s => s.busy);
    document.getElementById('global-status').textContent = busy ? (active.message || '正在读取学校页面…') : sourceTimes.length ? '最近读取 ' + lastUpdated(sourceTimes[sourceTimes.length - 1]) : '尚未同步';
  }
  function updateMenu() {
    const next = Core.getNextClass(state);
    const count = Core.getTasks(state).filter(t => !t.completed).length;
    const title = next.current ? next.current.title + ' · 上课中' : next.next ? (next.next.start || '') + ' ' + next.next.title : count ? count + ' 项待办' : 'CampusDesk';
    if (title !== lastMenuTitle) { send('setMenuTitle', { title: title }); lastMenuTitle = title; }
  }
  function render() {
    renderNav();
    document.getElementById('breadcrumb-page').textContent = pageNames[page];
    document.getElementById('sidebar-clock').textContent = Core.clock();
    document.getElementById('sync-icon').innerHTML = icon('refresh');
    document.getElementById('content').innerHTML = ({ overview: renderOverview, schedule: renderSchedule, grades: renderGrades, tasks: renderTasks, feedback: renderFeedback, settings: renderSettings })[page]();
    updateStatus(); updateMenu();
  }
  function shiftDate(direction) {
    const d = new Date(selectedDate + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + direction);
    selectedDate = d.toISOString().slice(0, 10); render();
  }
  function openTaskDialog() {
    const dialog = document.getElementById('task-dialog');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else { dialog.setAttribute('open', ''); dialog.classList.add('dialog-fallback'); }
  }
  function closeTaskDialog() {
    const dialog = document.getElementById('task-dialog');
    if (typeof dialog.close === 'function') dialog.close();
    else { dialog.removeAttribute('open'); dialog.classList.remove('dialog-fallback'); }
  }
  function exportBrowser() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'CampusDesk-backup-' + Core.today() + '.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  function applyImport(input) {
    try {
      const candidate = Core.validateState(input);
      if (!window.confirm('导入将替换当前课程缓存、个人待办与 GPA 记录。确定恢复这份备份吗？')) return;
      state = candidate; persist(); render(); toast('已恢复备份。学校账号需要在这台 Mac 上重新登录。');
    } catch (err) { toast('无法导入：' + (err.message || '备份格式无效。')); }
  }
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action], [data-page]');
    if (!target) return;
    if (target.dataset.page) { navigate(target.dataset.page); return; }
    const action = target.dataset.action;
    if (action === 'open-source') openSource(target.dataset.source, target.dataset.url);
    else if (action === 'add-task') { document.getElementById('task-form').reset(); openTaskDialog(); document.getElementById('task-title').focus(); }
    else if (action === 'close-task') closeTaskDialog();
    else if (action === 'toggle-task') {
      const item = Core.getTasks(state).find(t => t.id === target.dataset.id);
      if (item) { state.taskChecks[item.id] = !item.completed; persist(); render(); }
    } else if (action === 'delete-task') {
      const id = target.dataset.id;
      if (!window.confirm('删除这条个人待办？')) return;
      state.manualTasks = state.manualTasks.filter(t => t.id !== id); delete state.taskChecks[id]; persist(); render();
    } else if (action === 'toggle-feedback') {
      const item = Core.getFeedback(state).find(f => f.id === target.dataset.id);
      if (item) { state.feedbackRead[item.id] = !item.read; persist(); render(); }
    } else if (action === 'task-filter') { taskFilter = target.dataset.filter; render(); }
    else if (action === 'feedback-filter') { feedbackFilter = target.dataset.filter; render(); }
    else if (action === 'prev-day') shiftDate(-1);
    else if (action === 'next-day') shiftDate(1);
    else if (action === 'today') { selectedDate = Core.today(); render(); }
    else if (action === 'export') { if (!send('exportData')) exportBrowser(); }
    else if (action === 'import') { if (!send('importData')) document.getElementById('import-file').click(); }
    else if (action === 'clear-session') {
      if (!native) { toast('登录会话只能在 Mac 应用内管理。'); return; }
      send('clearSession', { source: target.dataset.source });
    }
  });
  document.addEventListener('change', event => {
    const el = event.target;
    if (el.id === 'schedule-date') { if (/^\d{4}-\d{2}-\d{2}$/.test(el.value)) { selectedDate = el.value; render(); } }
    else if (el.id === 'refresh-minutes') { state.settings.refreshMinutes = Number(el.value); persist(); toast('刷新间隔已更新。'); }
    else if (el.id === 'self-study') { state.settings.selfStudy = el.checked; persist(); toast('课表显示设置已更新。'); }
    else if (el.id === 'seiue-url' || el.id === 'managebac-url') {
      const source = el.id === 'seiue-url' ? 'seiue' : 'managebac', value = el.value.trim();
      const safe = value ? Core.safeURL(value, source) : '';
      if (value && !safe) { toast('请输入正确的学校 HTTPS 网址，不能使用其他网站。'); el.value = sourceURL(source); return; }
      state.settings[source + 'URL'] = safe; persist(); toast(sourceName(source) + ' 网址已保存。');
    }
  });
  document.getElementById('task-form').addEventListener('submit', event => {
    event.preventDefault();
    const title = document.getElementById('task-title').value.trim();
    if (!title) return;
    const due = document.getElementById('task-due').value;
    const dueDate = due ? new Date(due + ':00+08:00') : null;
    if (dueDate && !Number.isFinite(dueDate.getTime())) { toast('截止日期无效，请重新选择。'); return; }
    const id = 'manual-' + (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
    state.manualTasks.push({ id: id, title: title, course: '个人待办', dueAt: dueDate ? dueDate.toISOString() : null, dueLabel: '', status: 'open', createdAt: new Date().toISOString() });
    persist(); closeTaskDialog(); render(); toast('个人待办已添加。');
  });
  document.getElementById('import-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('备份过大，请选择 5 MB 以内的 JSON 文件。'); event.target.value = ''; return; }
    try { applyImport(JSON.parse(await file.text())); } catch (_) { toast('无法读取这份 JSON 备份。'); }
    event.target.value = '';
  });
  document.getElementById('sync-button').addEventListener('click', () => {
    if (!send('sync')) toast('学校数据同步需要使用 Mac 应用。网页预览只能管理个人待办和本地备份。');
  });
  window.addEventListener('hashchange', () => { const target = location.hash.slice(1); if (pageNames[target] && target !== page) { page = target; render(); } });
  window.CampusDesk = {
    receive: function (event) {
      if (!event || typeof event !== 'object') return;
      try {
        if (event.type === 'state') { state = event.state && Object.keys(event.state).length ? Core.validateState(event.state) : Core.emptyState(); render(); }
        else if (event.type === 'snapshot') {
          state = Core.mergeSnapshot(state, event.snapshot);
          persist(); render();
        } else if (event.type === 'status') {
          statuses[event.source || 'app'] = { busy: Boolean(event.busy), message: String(event.message || '') };
          updateStatus();
          if (!event.busy && event.message && event.source === 'app') toast(event.message);
          if (page === 'settings') render();
        } else if (event.type === 'import') applyImport(event.state);

      } catch (err) { toast('数据暂时无法读取，已保留当前内容。' + (err && err.message ? ' ' + err.message : '')); }
    }
  };
  if (!native) {
    try { const saved = localStorage.getItem(storageKey); if (saved) state = Core.validateState(JSON.parse(saved)); }
    catch (_) { toast('浏览器中的旧数据无法读取，可以从备份恢复。'); }
  }
  render();
  send('ready');
  setInterval(() => {
    document.getElementById('sidebar-clock').textContent = Core.clock();
    updateMenu();
    if ((page === 'overview' || page === 'schedule') && !document.getElementById('task-dialog').open) render();
  }, 60000);
})();
