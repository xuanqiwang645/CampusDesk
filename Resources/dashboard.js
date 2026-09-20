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
  let page = ['overview', 'schedule', 'grades', 'tasks', 'feedback', 'teams', 'ec', 'settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  let selectedDate = Core.today();
  let taskFilter = 'open';
  let feedbackFilter = 'all';
  let teamsFilter = 'all';
  let ecQuery = '', ecDateFilter = 'all', renderedPage = null;
  let detailTaskId = null;
  let notificationPermission = 'unknown';
  let lastReminderSignature = '';
  let lastRenderedDay = Core.today();
  let lastClockBoundary = '';
  let statuses = {};
  // Authentication stays in the native layer; only display-safe status lives here.
  let graphStatus = { configured: false, connected: false, busy: false, displayName: '', message: '', clientId: '', tenant: 'organizations', requiresAdminConsent: false };
  let graphConfigurationDraft = null;
  let teamsAuto = { running: false, phase: 'idle', message: '登录 Teams 后自动发现频道和聊天。', counts: {}, warnings: [], coverageItems: [] };
  let toastTimer = null;
  let lastMenuTitle = '';
  let lastMenuCountdown = '';
  const pageNames = { overview: '总览', schedule: '课程表', grades: '成绩与 GPA', tasks: '待办事项', feedback: '老师反馈', teams: 'Teams 消息', ec: 'English Corner', settings: '连接与设置' };
  const icons = {
    overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    schedule: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-13 4h3m3 0h3m-9 3h3"/>',
    grades: '<path d="M4 20V10m6 10V4m6 16v-7m5 7H2"/>',
    tasks: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/>',
    feedback: '<path d="M21 11a8 8 0 0 1-8 8H7l-4 3v-8a8 8 0 0 1 8-10h2a8 8 0 0 1 8 7Z"/><path d="M7 10h9m-9 4h6"/>',
    teams: '<rect x="3" y="7" width="11" height="13" rx="2"/><path d="M6 11h5m-2.5 0v6m8-9h4v8a3 3 0 0 1-4 3"/><circle cx="17" cy="4" r="2"/><path d="M6 4h5"/>',
    ec: '<circle cx="8" cy="7" r="3"/><circle cx="17" cy="8" r="2"/><path d="M2 21v-3a6 6 0 0 1 12 0v3m3-8a5 5 0 0 1 5 5v3"/>',
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
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/>',
    alert: '<path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3h.01"/>'
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
  function persist(options) {
    const details = { state: state };
    if (options && options.imported === true) details.imported = true;
    if (!send('saveState', details)) {
      try { localStorage.setItem(storageKey, JSON.stringify(state)); }
      catch (_) { toast('浏览器无法保存数据。请导出备份，或使用 Mac 应用。'); }
    }
    syncReminders();
  }
  function sourceName(source) { return ({ seiue: '希悦', managebac: 'ManageBac', teams: 'Microsoft Teams' })[source] || '个人待办'; }
  const schoolConfigurationHelp = '请在源码 Resources/SchoolConfig.json 配置学校 HTTPS 根地址后重新构建应用。留空时不会连接该学校系统，Teams 不受影响。';
  function sourceURL(source) { return source === 'teams' ? 'https://teams.microsoft.com/v2/' : Core.schoolHomes()[source] || ''; }
  function teamsBrowserName() { return state.settings.teamsBrowser === 'edge' ? 'Microsoft Edge' : 'Google Chrome'; }
  function graphPrimaryButton() {
    if (!graphStatus.configured) return button('设置 Teams 连接', 'graph-settings', '', 'button-primary');
    const canSync = graphStatus.connected && !graphStatus.authRequired;
    return button(graphStatus.busy ? (graphStatus.connected ? '正在同步…' : '正在登录…') : canSync ? '立即同步 Teams' : graphStatus.authRequired ? '重新登录 Teams' : '登录 Teams', canSync ? 'graph-sync' : 'graph-sign-in', graphStatus.busy || !native ? 'disabled' : '', 'button-primary');
  }
  function teamsPrimaryButton() {
    return state.settings.teamsMode === 'browser' ? button('登录／打开 Teams', 'teams-auto-login', !native || teamsAuto.running ? 'disabled' : '', 'button-primary') : graphPrimaryButton();
  }
  function graphStatusCopy() {
    if (!native) return '请在 CampusDesk Mac 应用中登录 Teams。';
    if (!graphStatus.configured) return '首次接入需要配置微软应用。配置完成后，登录学校账号即可自动同步。';
    if (graphStatus.requiresAdminConsent) return '学校要求管理员批准应用权限。请让学校管理员完成授权后重新登录。';
    if (graphStatus.message) return graphStatus.message;
    if (graphStatus.busy) return '正在自动发现你的团队、频道和课程作业…';
    if (graphStatus.connected) return (graphStatus.displayName ? graphStatus.displayName + ' · ' : '') + '已连接，应用运行时定期同步。';
    return '登录学校 Microsoft 账号，自动汇总频道消息、作业要求和 EC 通知。';
  }
  function graphScopeCopy() {
    const summary = typeof Core.getTeamsGraphSummary === 'function' ? Core.getTeamsGraphSummary(state) : null;
    const counts = graphStatus.counts || (summary && summary.counts);
    const parts = [];
    if (counts && typeof counts === 'object') {
      [['teams', '个团队'], ['channels', '个频道'], ['chats', '个聊天'], ['assignments', '份作业'], ['messages', '条消息']].forEach(entry => {
        const count = Number(counts[entry[0]]);
        if (Number.isFinite(count) && count >= 0) parts.push(Math.floor(count) + ' ' + entry[1]);
      });
    }
    return parts.length ? '本次同步：' + parts.join(' · ') : '自动发现账号所属团队和可访问频道，读取频道消息、回复及课程作业。';
  }
  function graphAction(action) {
    if (!native) { toast('Teams 自动同步需要使用 CampusDesk Mac 应用。'); return; }
    if (!graphStatus.configured) { showGraphConfiguration(); return; }
    if (graphStatus.busy) return;
    state.settings.teamsMode = 'graph';
    persist();
    send(action);
  }
  function showGraphConfiguration() {
    navigate('settings');
    const config = document.getElementById('graph-configuration');
    if (config) { config.open = true; config.scrollIntoView({ block: 'center', behavior: 'auto' }); }
  }
  function teamsBrowserAction(action, details) {
    if (!native) { toast('读取浏览器中的 Teams 页面需要使用 CampusDesk Mac 应用。'); return; }
    if (!state.settings.teamsBrowserAutomation) { navigate('settings'); toast('请先开启“允许读取 Teams 浏览器页面”，再按说明设置 Mac 和浏览器权限。'); return; }
    // Persist the selected browser and explicit opt-in before asking the native bridge to act.
    persist();
    send(action, details);
  }
  function teamsBrowserButtons() {
    const disabled = !native || !state.settings.teamsBrowserAutomation ? ' disabled' : '';
    return '<div class="teams-browser-actions">' + button('关注浏览器当前 Teams 页', 'pin-teams-browser', disabled) + button('读取当前页', 'capture-teams-browser', disabled) + button('读取选中文字', 'capture-teams-selection', disabled) + '</div>';
  }
  function openSource(source, requestedURL) {
    const url = requestedURL ? Core.safeURL(requestedURL, source) : Core.safeURL(sourceURL(source), source);
    if (!url) { navigate('settings'); toast(sourceURL(source) ? '此地址不属于当前配置的学校，已取消打开。' : schoolConfigurationHelp); return; }
    if (!send('openSource', { source: source, url: url })) {
      window.open(url, '_blank', 'noopener,noreferrer');
      toast('网页预览可以打开学校网站；把登录后的数据同步到这里需要使用 CampusDesk Mac 应用。');
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
      const local = state.manualTasks.some(t => t.id === task.id), source = task.source === 'teams' ? 'teams' : 'managebac';
      const due = taskDue(task);
      const hasKnownDue = Boolean(task.dueAt) && Number.isFinite(new Date(task.dueAt).getTime());
      const dueText = (due.overdue ? '已逾期 · ' : '') + due.label + (task.dueOverride ? ' · 本机设置' : '');
      // A deadline icon is not a claim that a macOS notification was scheduled.
      const dueBadge = '<span class="task-due ' + (due.overdue ? 'is-overdue' : hasKnownDue ? 'has-date' : 'date-unknown') + '">' +
        (hasKnownDue ? icon(due.overdue ? 'alert' : 'clock', 'task-due-icon') : '') + '<span>' + esc(dueText) + '</span></span>';
      return '<div class="task-row ' + (task.completed ? 'done' : '') + '"><button class="check-button ' + (task.completed ? 'checked' : '') + '" type="button" data-action="toggle-task" data-id="' + esc(task.id) + '" aria-label="' + esc((task.completed ? '标为未完成：' : '标为已完成：') + task.title) + '" aria-pressed="' + Boolean(task.completed) + '">' + (task.completed ? icon('check') : '') + '</button><div class="task-copy"><h3>' + (local ? esc(task.title) : '<button class="task-title-button" type="button" data-action="task-detail" data-id="' + esc(task.id) + '">' + esc(task.title) + '</button>') + '</h3><div class="task-meta"><span>' + esc(task.course || (local ? '个人待办' : sourceName(source))) + '</span>' + dueBadge + '</div>' + (!local ? '<button class="text-action" type="button" data-action="task-detail" data-id="' + esc(task.id) + '">查看要求' + (task.attachments && task.attachments.length ? ' · ' + task.attachments.length + ' 个附件' : '') + ' ↗</button>' : '') + '</div><span class="task-tag ' + (local ? 'local' : source === 'teams' ? 'teams-tag' : '') + '">' + (local ? '个人' : source === 'teams' ? 'Teams' : 'MB') + '</span>' + (local ? '<button class="icon-button" data-action="delete-task" data-id="' + esc(task.id) + '" aria-label="删除个人待办" title="删除个人待办">' + icon('trash') + '</button>' : task.url ? '<button class="icon-button" data-action="open-source" data-source="' + source + '" data-url="' + esc(task.url) + '" aria-label="打开学校任务" title="打开学校任务">' + icon('link') + '</button>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function feedbackRows(items, limit) {
    return items.slice(0, limit || items.length).map(item => '<article class="feedback-row"><div class="feedback-top"><span class="feedback-initial">' + esc((item.teacher || '师').slice(0, 1)) + '</span><span>' + esc(item.teacher || '老师反馈') + '</span>' + (!item.read ? '<span class="unread-dot" aria-label="未读"></span>' : '') + '<span class="feedback-course">' + esc((item.source === 'teams' ? 'Teams · ' : '') + (item.course || '')) + '</span></div><p class="feedback-text">' + esc(item.text) + '</p><div class="feedback-bottom"><span>' + esc(item.date ? fmtDate(item.date) : '日期未标明') + '</span><span><button type="button" data-action="toggle-feedback" data-id="' + esc(item.id) + '">' + (item.read ? '标为未读' : '标为已读') + '</button>' + (item.url ? '<button type="button" data-action="open-source" data-source="' + (item.source === 'teams' ? 'teams' : 'managebac') + '" data-url="' + esc(item.url) + '">查看原文 ↗</button>' : '') + '</span></div></article>').join('');
  }
  function clockCopy(clock) {
    const labels = { class: '距离下课', break: '课间剩余', lunch: '午间休息剩余', before: '距离第一节课', after: '今日课程已结束', empty: '等待今日课表' };
    const next = clock.next;
    return {
      label: labels[clock.phase] || labels.empty,
      time: clock.phase === 'empty' || clock.phase === 'after' ? '—' : clock.remainingLabel,
      detail: clock.phase === 'class' && clock.current ? clock.current.title + (clock.current.room ? ' · ' + clock.current.room : '') : next ? '下一节 ' + next.title + ' · ' + (next.start || '时间待定') + (next.room ? ' · ' + next.room : '') : clock.phase === 'after' ? '已读取课节均已结束，可以查看接下来的待办。' : '同步希悦当天课表后，这里显示课间倒计时。'
    };
  }
  function renderClassClock() {
    const clock = Core.getClassClock(state), copy = clockCopy(clock), status = sourceStatus('seiue');
    return '<section id="class-clock" class="class-clock phase-' + esc(clock.phase) + '" aria-label="今日课程倒计时"><div class="clock-mark">' + icon('clock') + '</div><div class="clock-primary"><span id="class-clock-label" class="clock-label">' + esc(copy.label) + '</span><span id="class-clock-time" class="clock-value" role="timer" aria-live="off">' + esc(copy.time) + '</span></div><div class="clock-secondary"><p id="class-clock-detail">' + esc(copy.detail) + '</p><small id="class-clock-cache">' + esc((clock.stale ? '课表缓存待更新 · ' : '基于已读取课表 · ') + lastUpdated(status.lastCapturedAt)) + '</small></div></section>';
  }
  function updateClock() {
    const clock = Core.getClassClock(state), copy = clockCopy(clock), root = document.getElementById('class-clock');
    if (root) {
      root.className = 'class-clock phase-' + clock.phase;
      document.getElementById('class-clock-label').textContent = copy.label;
      document.getElementById('class-clock-time').textContent = copy.time;
      document.getElementById('class-clock-detail').textContent = copy.detail;
      document.getElementById('class-clock-cache').textContent = (clock.stale ? '课表缓存待更新 · ' : '基于已读取课表 · ') + lastUpdated(sourceStatus('seiue').lastCapturedAt);
    }
    return clock;
  }
  function attachmentsHTML(items, owner) {
    const valid = (Array.isArray(items) ? items : []).slice(0,100);
    return valid.length ? '<div class="attachment-list">' + valid.map((item,index) => {
      const url = Core.safeAttachmentURL(item.url), title = esc(item.title || '附件');
      const key = 'attachment-' + encodeURIComponent((owner || 'detail') + '|' + (item.id || url || item.title || index));
      const label = item.text ? (item.cached ? '缓存文字' : item.extractionStatus === 'partial' ? '已提取部分文字' : '已提取文字') : ({error:'读取失败',unsupported:'格式暂不支持',read:'没有可提取文字',no_text:'未识别到文字'}[item.extractionStatus] || '正文尚未读取');
      const warnings = (Array.isArray(item.warnings) ? item.warnings : []).filter(value => typeof value === 'string').slice(0,2);
      return '<div class="attachment-preview">' + (url ? button(icon('link') + title, 'open-attachment', 'data-url="' + esc(url) + '"') : '<span>' + title + '</span>') + '<small> · ' + label + (item.truncated ? ' · 内容已截断' : '') + (item.capturedAt ? ' · 提取于 ' + esc(lastUpdated(item.capturedAt)) : '') + '</small>' + (item.text ? '<details id="' + esc(key) + '"><summary>查看表格／文档文字</summary><p class="attachment-caution">提取文字不等于名单已核验；请结合日期、表格布局和原件确认。</p><pre id="' + esc(key+'-text') + '" data-preserve-scroll data-selection-key class="attachment-text">' + esc(item.text) + '</pre></details>' : '') + (warnings.length ? '<p class="gpa-note">' + warnings.map(esc).join('<br>') + '</p>' : '') + (item.error ? '<p class="gpa-note">' + esc(item.error) + '</p>' : '') + '</div>';
    }).join('') + '</div>' : '';
  }
  function retainAttachmentMetadata(item, result) {
    if (['text_extracted','partial','none'].includes(result.extractionCoverage)) item.extractionCoverage=result.extractionCoverage;
    if (result.textOnly===true) item.textOnly=true;
    if (result.semanticVerified===false) item.semanticVerified=false;
    for (const key of ['pagesTotal','pagesRead','ocrPages']) if(Number.isSafeInteger(result[key]) && result[key]>=0 && result[key]<=100000)item[key]=result[key];
    if(Array.isArray(result.warnings))item.warnings=result.warnings.filter(value=>typeof value==='string').slice(0,8).map(value=>value.slice(0,500));
    if(Array.isArray(result.pageCoverage))item.pageCoverage=result.pageCoverage.slice(0,100).filter(row=>row && Number.isSafeInteger(row.page) && row.page>=1 && row.page<=100000 && ['text_extracted','partial','no_text','skipped'].includes(row.status) && ['pdf_text','pdf_text+ocr','ocr','none'].includes(row.method) && ['detected','not_detected','unknown'].includes(row.visualContent) && ['not_needed','completed','failed','limit','no_text'].includes(row.ocrStatus) && Number.isSafeInteger(row.characters) && row.characters>=0 && row.characters<=80000).map(row=>{
      const value={page:row.page,status:row.status,method:row.method,visualContent:row.visualContent,ocrStatus:row.ocrStatus,characters:row.characters};
      if(typeof row.ocrMeanConfidence==='number' && Number.isFinite(row.ocrMeanConfidence) && row.ocrMeanConfidence>=0 && row.ocrMeanConfidence<=1)value.ocrMeanConfidence=row.ocrMeanConfidence;
      if(Number.isSafeInteger(row.ocrLowConfidenceLines) && row.ocrLowConfidenceLines>=0 && row.ocrLowConfidenceLines<=10000)value.ocrLowConfidenceLines=row.ocrLowConfidenceLines;
      if(typeof row.reason==='string')value.reason=row.reason.slice(0,500);return value;
    });
  }
  function teamsGuide() {
    if (state.settings.teamsMode === 'browser') return renderTeamsAutoPanel(false);
    return '<div class="teams-guide graph-guide"><div><h3>' + (graphStatus.connected ? 'Teams 已连接，信息自动汇总' : '登录一次，自动汇总校园信息') + '</h3><p id="graph-progress-message">' + esc(graphStatusCopy()) + '</p><small id="graph-progress-scope">' + esc(graphScopeCopy()) + '</small><small>读取范围取决于学校授权和同步结果。默认也读取你参与的聊天，可在连接设置中关闭；图片和 PDF 通过原件入口查看。</small><p id="graph-progress-partial" class="source-warning"'+(graphStatus.coverage !== 'partial'?' hidden':'')+'>本次仅完成部分同步，已保留已获取内容，请查看同步提示。</p></div><div id="graph-progress-actions" class="banner-actions">' + graphPrimaryButton() + button('连接设置', 'teams-settings') + '</div></div>';
  }
  function teamsWarning() {
    const status = sourceStatus('teams');
    const warnings = [...new Set((graphStatus.warnings || []).concat(status.warnings || []))];
    return warnings.length ? '<div class="source-warning teams-warning">' + warnings.slice(0, 6).map(esc).join('<br>') + '</div>' : '';
  }
  function postRows(posts) {
    return posts.map(post => '<article id="post-' + esc(encodeURIComponent(post.id)) + '" class="teams-post" data-reading-anchor><div class="post-meta"><span class="post-kind">' + ({ assignment: '作业消息', ec: 'EC 通知', general: '频道消息' }[post.kind] || '频道消息') + '</span><span>' + esc(post.channel || 'Teams') + '</span><span>' + esc(post.author || '发送者未标明') + '</span><span>' + esc(post.publishedAt ? lastUpdated(post.publishedAt) : post.dateLabel ? '原文时间：' + post.dateLabel + '（日期未确认）' : '发布日期未确认') + '</span></div><h3>' + esc(post.title || (post.kind === 'ec' ? 'English Corner 通知' : '频道消息')) + '</h3><div id="post-text-' + esc(encodeURIComponent(post.id)) + '" data-selection-key class="post-original">' + esc(post.text || '本条消息未读取到文字，请打开原页面。') + '</div>' + attachmentsHTML(post.attachments, 'post:'+post.id) + '<div class="post-foot"><span>读取于 ' + esc(lastUpdated(post.capturedAt)) + '</span>' + (post.url ? button('查看 Teams 原文 ↗', 'open-source', 'data-source="teams" data-url="' + esc(post.url) + '"', 'button-plain') : '') + '</div></article>').join('');
  }
  function renderTeams() {
    const posts = Core.getTeamsPosts(state), visible = posts.filter(post => teamsFilter === 'all' || post.kind === teamsFilter), tasks = Core.getTasks(state).filter(task => task.source === 'teams' && !task.completed);
    return heading('频道里的重要信息，在这里。', '作业要求保留原文，截止时间集中到待办。', button(icon('link') + '打开 Teams', 'open-source', 'data-source="teams"')) + teamsGuide() + (tasks.length ? '<section class="card settings-section">' + cardHeader('tasks', 'Teams 待完成作业', goLink('tasks', '全部待办')) + taskRows(tasks, 5) + (tasks.length > 5 ? '<p class="gpa-note">另有 ' + (tasks.length - 5) + ' 项，可在待办中查看。</p>' : '') + '</section>' : '') + '<div class="page-tools"><div class="filter-pills">' + [['all', '全部消息'], ['assignment', '作业消息'], ['general', '其他通知']].map(filter => '<button type="button" class="pill ' + (teamsFilter === filter[0] ? 'active' : '') + '" data-action="teams-filter" data-filter="' + filter[0] + '">' + filter[1] + '</button>').join('') + '</div><span class="subtle">' + visible.length + ' 条已读取消息</span></div><section class="card">' + (visible.length ? postRows(visible) : empty('teams', '还没有已读取的消息', '连接学校 Microsoft 账号后，这里会自动汇总有权访问的频道消息。没有同步到消息不代表频道没有消息。')) + teamsWarning() + sourceFooter('teams') + '</section>';
  }
  function ecDate(post) { return post.publishedAt ? Core.today(new Date(post.publishedAt)) : ''; }
  function searchText(value) { return String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim(); }
  function ecResultsHTML() {
    const all = Core.getTeamsEC(state), query = searchText(ecQuery);
    const matched = all.filter(post => !query || searchText([post.title,post.text,post.channel,post.author].concat((post.attachments || []).flatMap(item => [item.title,item.text])).join('\n')).includes(query));
    const known = matched.filter(post => ecDate(post) && ecDateFilter !== 'unknown' && (ecDateFilter === 'all' || ecDate(post) === ecDateFilter));
    const unknown = matched.filter(post => !ecDate(post));
    const shown = known.length + unknown.length;
    return '<p id="ec-result-count" class="ec-result-count" role="status" aria-live="polite">显示 ' + shown + ' / ' + all.length + ' 条已读取通知' + (unknown.length ? ' · ' + unknown.length + ' 条日期未确认（保留显示）' : '') + '</p>' + (known.length ? postRows(known) : '') + (unknown.length ? '<h3 class="ec-undated-heading">发布日期未确认</h3><p class="subtle">这些原文未因日期筛选被隐藏，不据此推断活动日期。</p>' + postRows(unknown) : '') + (!shown ? empty('ec', all.length ? '没有匹配的已读取通知' : '等待第一份 EC 通知', all.length ? '试试姓名的一部分、附件中的词语，或清除筛选。未匹配不代表不在名单中。' : '登录 Teams 并完成同步后，这里汇总已识别的 EC 原文。', all.length ? button('清除筛选','ec-clear') : teamsPrimaryButton()) : '');
  }
  function updateECResults() { const target = document.getElementById('ec-results'); if (target) target.innerHTML = ecResultsHTML(); }
  function renderEC() {
    const dates = [...new Set(Core.getTeamsEC(state).map(ecDate).filter(Boolean))].sort().reverse();
    return heading('English Corner，记得赴约。', '搜索已读取原文和附件文字，核对最新安排。', button(icon('link') + '打开 Teams', 'open-source', 'data-source="teams"')) + teamsGuide() + '<div class="info-note">先核对取消或变更通知，再查看对应日期的名单；旧名单不代表今天的安排。下面按通知的明确发布日期筛选，不推断活动日期或参与人员。附件提取文字可能不完整，未匹配到姓名不代表不在名单中，请核对原件。</div>' + '<section class="card"><div class="ec-filters"><label for="ec-search">姓名或全文<input id="ec-search" type="search" value="' + esc(ecQuery) + '" placeholder="搜索通知和已解析附件" autocomplete="off" maxlength="200" aria-controls="ec-results"></label><label for="ec-date-filter">通知发布日期<select id="ec-date-filter" aria-controls="ec-results"><option value="all"' + (ecDateFilter === 'all' ? ' selected' : '') + '>全部日期</option><option value="unknown"' + (ecDateFilter === 'unknown' ? ' selected' : '') + '>仅日期未确认</option>' + dates.map(date => '<option value="' + date + '"' + (ecDateFilter === date ? ' selected' : '') + '>' + date + '</option>').join('') + '</select></label>' + button('清除筛选','ec-clear') + '</div><div id="ec-results">' + ecResultsHTML() + '</div>' + teamsWarning() + sourceFooter('teams') + '</section>';
  }
  function renderOverview() {
    const today = Core.today(), classes = Core.getSchedule(state, today), tasks = Core.getTasks(state), feedback = Core.getFeedback(state);
    const openTasks = tasks.filter(t => !t.completed), overdue = openTasks.filter(t => taskDue(t).overdue).length;
    const dueToday = openTasks.filter(t => t.dueAt && Core.today(new Date(t.dueAt)) === today).length;
    const gpa = getGpaView(), displayGpa = gpa.official || gpa.estimate;
    const course = Core.getNextClass(state);
    const connected = Boolean(sourceStatus('seiue').lastCapturedAt || sourceStatus('managebac').lastCapturedAt || sourceStatus('teams').lastCapturedAt);
    const topText = course.current ? '正在上 ' + course.current.title + '，' + (course.current.end || '课后') + ' 结束。' : course.next ? '下一节是 ' + course.next.title + '，' + (course.next.start || '时间待定') + ' 开始。' : '课程、成绩和待办，在这里从容安排。';
    const date = new Date();
    return heading('今天，也有条不紊。', topText, '<div class="date-stamp">' + esc(fmtDate(date, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })) + '<span>BEIJING · ' + esc(Core.clock()) + '</span></div>') +
      (!native ? '<div class="browser-banner">你正在使用网页预览。个人待办可以本地保存；学校登录与自动同步需要打开 CampusDesk Mac 应用。</div>' : '') +
      (!connected ? '<div class="connect-banner"><div class="banner-icon">' + icon('cloud') + '</div><div class="banner-copy"><h3>连接校园，开始你的第一天</h3><p>连接希悦、ManageBac 和 Teams，把课表、作业和通知放在一起。</p></div><div class="banner-actions">' + button('连接希悦', 'open-source', 'data-source="seiue"', 'button-primary') + button('连接 ManageBac', 'open-source', 'data-source="managebac"') + teamsPrimaryButton() + '</div></div>' : '') +
      renderClassClock() + '<div class="overview-grid"><section class="card schedule-card">' + cardHeader('schedule', '今日课程', goLink('schedule', '完整课表')) + (classes.length ? scheduleRows(classes, today) : noSchedule(today)) + sourceFooter('seiue') + '</section>' +
      '<section class="card gpa-card">' + cardHeader('grades', gpa.official ? '学校 GPA' : '参考 GPA', goLink('grades', '成绩详情')) + '<div class="gpa-row">' + gpaValue(displayGpa && displayGpa.value, displayGpa && displayGpa.scale) + '<div class="gpa-detail">' + (gpa.official ? '学校页面显示的 GPA<br>' + esc(gpa.official.label || '') : '非官方 · 等权参考<br>' + esc(gpa.estimate.count || 0) + ' 门可用课程') + '</div></div><p class="gpa-note">' + (gpa.official ? '以学校正式成绩单为准。' : '90 / 80 / 70 / 60 分 → 4 / 3 / 2 / 1，不含 AP 加权。') + '</p></section>' +
      '<section class="card task-summary-card">' + cardHeader('tasks', '待办一览', goLink('tasks', '全部待办')) + '<div class="task-stats"><div class="stat"><span class="stat-number">' + openTasks.length + '</span><span class="stat-name">未完成</span></div><div class="stat"><span class="stat-number">' + dueToday + '</span><span class="stat-name">今日截止</span></div><div class="stat overdue"><span class="stat-number">' + overdue + '</span><span class="stat-name">已逾期</span></div></div></section></div>' +
      '<div class="overview-bottom"><section class="card">' + cardHeader('tasks', '接下来要做', button(icon('plus') + '添加待办', 'add-task', '', 'button-plain')) + (openTasks.length ? taskRows(openTasks, 4) : '<div class="empty small-empty"><h3>给重要的事留一个位置</h3><p>学校任务会在同步后出现，也可以先添加自己的待办。</p></div>') + '<div class="section-foot"><span>完成勾选仅保存在本机</span><span>不代表已向学校提交</span></div></section><section class="card feedback-preview">' + cardHeader('feedback', '老师的反馈', goLink('feedback', '查看全部')) + (feedback.length ? feedbackRows(feedback, 1) : '<div class="empty small-empty"><h3>等待新的反馈</h3><p>同步后汇总已读取的老师评语。仅覆盖已读取页面。</p></div>') + sourceFooter('managebac') + '</section></div>';
  }
  function renderSchedule() {
    const rows = Core.getSchedule(state, selectedDate);
    return heading('为每一节课，留好位置。', '以北京时间展示课程。空白课节按你的设置显示为自习。') + (selectedDate === Core.today() ? renderClassClock() : '') + '<div class="page-tools"><div class="date-control"><button class="icon-button" type="button" data-action="prev-day" aria-label="前一天">' + icon('back') + '</button><label class="visually-hidden" for="schedule-date">课表日期</label><input id="schedule-date" type="date" value="' + esc(selectedDate) + '"><button class="icon-button" type="button" data-action="next-day" aria-label="后一天">' + icon('arrow') + '</button><span class="date-day">' + esc(dayLabel(selectedDate)) + '</span>' + button('今天', 'today') + '</div>' + button(icon('link') + '打开希悦课表', 'open-source', 'data-source="seiue"') + '</div><section class="card schedule-full">' + cardHeader('schedule', selectedDate === Core.today() ? '今日课程' : esc(selectedDate) + ' 的课程', '<span class="card-kicker">' + rows.length + ' 节已读取课程</span>') + (rows.length ? scheduleRows(rows, selectedDate) : noSchedule(selectedDate)) + sourceFooter('seiue') + '</section><p class="footer-note">自习仅补充学校页面中能确认时间的空白课节，不推测未读取的课表。</p>';
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
    return heading('一件一件，慢慢完成。', '汇总学校任务，也留一个位置给自己的安排。', button(icon('plus') + '添加待办', 'add-task', '', 'button-primary')) + '<div class="page-tools"><div class="filter-pills">' + [['open', '未完成'], ['overdue', '已逾期'], ['done', '已完成'], ['all', '全部']].map(f => '<button type="button" class="pill ' + (taskFilter === f[0] ? 'active' : '') + '" data-action="task-filter" data-filter="' + f[0] + '">' + f[1] + '</button>').join('') + '</div><span class="subtle">' + tasks.length + ' 项</span></div><div class="info-note">勾选仅更新本机待办状态，不会提交作业、回复老师或修改 ManageBac / Teams。学校页面显示的完成状态可能不同，请以原页面为准。</div><section class="card">' + (tasks.length ? taskRows(tasks) : empty('tasks', taskFilter === 'done' ? '完成的事情，会留在这里' : '这里暂时没有待办', taskFilter === 'open' ? '连接 ManageBac 和 Teams 获取已读取的学校任务，或添加一个个人待办。' : '切换筛选条件，查看其他任务。', taskFilter === 'open' ? button(icon('plus') + '添加待办', 'add-task', '', 'button-primary') : '')) + sourceFooter('managebac') + sourceFooter('teams') + '</section>';
  }
  function renderFeedback() {
    const all = Core.getFeedback(state), items = all.filter(f => feedbackFilter === 'all' || !f.read);
    return heading('认真读懂，每一次反馈。', '把老师的建议带回下一次学习。', button(icon('link') + '打开 ManageBac', 'open-source', 'data-source="managebac"')) + '<div class="page-tools"><div class="filter-pills"><button type="button" class="pill ' + (feedbackFilter === 'all' ? 'active' : '') + '" data-action="feedback-filter" data-filter="all">全部反馈</button><button type="button" class="pill ' + (feedbackFilter === 'unread' ? 'active' : '') + '" data-action="feedback-filter" data-filter="unread">未读</button></div><span class="subtle">' + items.length + ' 条</span></div><div class="info-note">这里汇总 ManageBac 评语和 Teams 已发布的作业反馈，覆盖范围取决于同步结果。尚未读取的课程、附件或历史内容请到学校原页面查看。已读标记仅保存在本机。</div><section class="card">' + (items.length ? feedbackRows(items) : empty('feedback', feedbackFilter === 'unread' ? '没有已读取的未读反馈' : '等待老师的下一条建议', '登录 ManageBac 并打开评语页，或连接 Teams 同步已发布的作业反馈。', button('打开 ManageBac', 'open-source', 'data-source="managebac"'))) + sourceFooter('managebac') + sourceFooter('teams') + '</section>';
  }
  function renderSourceCard(source) {
    if (source === 'teams') return renderGraphSourceCard();
    if (!sourceURL(source)) return '<section class="card source-card"><h2>' + esc(sourceName(source)) + '</h2><span class="status-badge warning">未配置学校地址</span><p>' + esc(schoolConfigurationHelp) + '</p></section>';
    const status = sourceStatus(source), busy = statuses[source] && statuses[source].busy;
    const badge = busy ? '正在同步' : status.loginRequired ? '需要登录' : status.lastCapturedAt ? status.stale ? '缓存待更新' : '已读取' : '尚未连接';
    return '<section class="card source-card"><div class="source-header"><span class="source-logo ' + (source === 'managebac' ? 'mb' : source === 'teams' ? 'teams-logo' : '') + '">' + (source === 'seiue' ? '希' : source === 'teams' ? 'T' : 'M') + '</span><div><h2>' + sourceName(source) + '</h2><p>' + (source === 'seiue' ? '课程表 · 上课时间 · 教室' : source === 'teams' ? '作业要求 · 提醒 · EC 通知' : '课程成绩 · 学校任务 · 老师反馈') + '</p></div><span class="status-badge ' + (status.stale || status.loginRequired ? 'warning' : '') + '">' + badge + '</span></div><p>最近读取：' + esc(lastUpdated(status.lastCapturedAt)) + '</p>' + (statuses[source] && statuses[source].message ? '<p>' + esc(statuses[source].message) + '</p>' : '') + (status.warnings && status.warnings.length ? '<div class="source-warning">' + status.warnings.slice(0, 3).map(esc).join('<br>') + '</div>' : '') + '<div class="source-actions">' + button(source === 'teams' ? '在浏览器打开 Teams' : status.lastCapturedAt ? '打开学校页面' : '登录并连接', 'open-source', 'data-source="' + source + '"', 'button-primary') + (source === 'teams' ? '' : button('退出登录', 'clear-session', 'data-source="' + source + '"')) + '</div>' + (source === 'teams' ? '<p class="gpa-note">使用 ' + esc(teamsBrowserName()) + ' 的登录状态，退出 Teams 请在该浏览器操作。应用内旧登录状态不会转移到浏览器。</p>' : '') + '</section>';
  }
  function permissionCopy() {
    if (!native) return '通知提醒只在 CampusDesk Mac 应用中可用。';
    if (notificationPermission === 'denied') return '系统通知未允许。请到 Mac 系统设置 → 通知 → CampusDesk 开启。';
    if (notificationPermission === 'authorized' || notificationPermission === 'provisional' || notificationPermission === 'granted') return '系统通知已允许。仅为已确认截止时间的 Teams 未完成作业安排提醒。';
    return '启用后将请求 macOS 通知权限。没有明确截止时间的作业可在“查看要求”中手动设置。';
  }
  function renderGraphSourceCard() {
    if (state.settings.teamsMode === 'browser') return '<section class="card source-card"><div class="source-header"><span class="source-logo teams-logo">T</span><div><h2>Microsoft Teams</h2><p>自动发现 · EC 附件 · 本机缓存</p></div><span id="teams-source-badge" class="status-badge">' + (teamsAuto.running ? '正在读取' : '浏览器自动同步') + '</span></div><p id="teams-source-message">' + esc(teamsAuto.message) + '</p><div class="source-actions">' + button('登录／打开 Teams', 'teams-auto-login', !native ? 'disabled' : '', 'button-primary') + '</div></section>';
    const badge = graphStatus.busy ? '正在同步' : graphStatus.connected ? '已连接' : graphStatus.configured ? '等待登录' : '待首次配置';
    return '<section class="card source-card"><div class="source-header"><span class="source-logo teams-logo">T</span><div><h2>Microsoft Teams</h2><p>频道消息 · 作业要求 · EC 名单</p></div><span class="status-badge ' + (!graphStatus.connected ? 'warning' : '') + '">' + badge + '</span></div><p>' + esc(graphStatusCopy()) + '</p><div class="source-actions">' + graphPrimaryButton() + '</div></section>';
  }
  function renderGraphSettings() {
    const config = graphConfigurationDraft || { clientId: graphStatus.clientId || '', tenant: graphStatus.tenant || 'organizations' };
    return '<section id="teams-settings" class="card settings-section">' + cardHeader('teams', 'Teams 自动同步') + '<p class="settings-intro">' + esc(graphStatusCopy()) + '</p><div class="graph-connection-actions">' + graphPrimaryButton() + (graphStatus.connected || graphStatus.busy ? button(graphStatus.connected ? '退出并清除 Teams 缓存' : '取消连接', 'graph-sign-out') : '') + '</div><p class="graph-coverage">' + esc(graphScopeCopy()) + '</p><p class="gpa-note">自动发现你所属团队中的可访问频道，读取消息、回复、课程作业及已发布的老师反馈。EC 名单公告保留原文和附件入口。同步状态会说明未能读取的范围，无法授权的内容不会被获取。</p>' + (graphStatus.coverage === 'partial' ? '<div class="source-warning">本次同步不完整，已保留成功读取的内容和历史缓存。请查看同步提示后重试。</div>' : '') + teamsWarning() + '<div class="settings-fields"><div class="settings-field"><div><label for="graph-include-chats">也同步我参与的聊天</label><p>默认汇总你参与的一对一和群聊。关闭后，后续同步只读取团队频道与课程作业。</p></div><label class="toggle" for="graph-include-chats"><input id="graph-include-chats" type="checkbox" ' + (state.settings.graphIncludeChats ? 'checked' : '') + (!native ? ' disabled' : '') + ' aria-label="也同步 Teams 聊天"><span></span></label></div></div><details id="graph-configuration" class="advanced-settings"><summary>首次接入配置（开发者或学校管理员）</summary><p class="settings-intro">此测试版尚未配备已注册的微软应用。请在 Microsoft Entra 注册桌面应用，并按安装包 README 完成重定向地址和读取权限配置。学校可能需要管理员批准。这里只填写公开的应用 ID，不需要密码或客户端密钥。</p><div class="graph-config-fields"><label for="graph-client-id">应用（客户端）ID<input id="graph-client-id" type="text" maxlength="36" value="' + esc(config.clientId) + '" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autocomplete="off" spellcheck="false"></label><label for="graph-tenant">租户<input id="graph-tenant" type="text" maxlength="253" value="' + esc(config.tenant) + '" placeholder="organizations" autocomplete="off" spellcheck="false"></label></div><p class="field-hint">一般使用 organizations；学校单租户应用请填写管理员提供的租户 ID 或域名。</p><div class="graph-connection-actions">' + button('保存连接配置', 'graph-save-configuration', graphStatus.busy || !native ? 'disabled' : '') + '</div></details></section>' + renderReminderSettings() + '<details class="advanced-settings legacy-connection"><summary>高级：旧版浏览器读取</summary><p class="settings-intro">仅在需要兼容旧版本时使用。自动同步无需关注页面，也无需保持 Teams 标签页打开。</p><div class="settings-field"><div><label for="teams-mode">Teams 同步方式</label><p>默认使用微软授权自动同步。</p></div><select id="teams-mode"><option value="graph" ' + (state.settings.teamsMode !== 'browser' ? 'selected' : '') + '>微软授权自动同步</option><option value="browser" ' + (state.settings.teamsMode === 'browser' ? 'selected' : '') + '>旧版浏览器读取</option></select></div>' + renderTeamsLegacySettings() + '</details>';
  }
  function renderTeamsAutoPanel(settings) {
    const counts = teamsAuto.counts || {}, count = key => Number.isSafeInteger(counts[key]) && counts[key] >= 0 ? counts[key] : 0;
    const diagnostics = (teamsAuto.coverageItems || []).filter(item => item.status !== 'complete').slice(0,60);
    const enabled = native && state.settings.teamsBrowserAutomation;
    return '<section id="teams-auto-panel" class="card settings-section teams-auto-panel">' + cardHeader('teams', 'Teams 自动同步 · 0.4.0') + '<p id="teams-auto-message" role="status">' + esc(teamsAuto.message) + '</p><p id="teams-auto-counts" class="graph-coverage">' + esc(teamsAutoCountText()) + '</p><div class="banner-actions">' + button('登录／打开 Teams', 'teams-auto-login', 'id="teams-auto-login-button" '+(!native || teamsAuto.running ? 'disabled' : ''), 'button-primary') + button(teamsAuto.running ? '正在自动读取…' : '立即自动同步', 'teams-auto-start', 'id="teams-auto-start-button" '+(!enabled || teamsAuto.running ? 'disabled' : '')) + button('优先读取 EC', 'teams-auto-ec', 'id="teams-auto-ec-button" '+(!enabled || teamsAuto.running ? 'disabled' : '')) + button('停止本轮', 'teams-auto-stop', 'id="teams-auto-stop-button" '+(!teamsAuto.running ? 'disabled' : '')) + '</div><p class="gpa-note">自动发现账号可见页面，优先读取 EC；无需逐页关注。应用运行、Mac 唤醒且联网时按设置周期更新。学校要求重新验证时需要你登录。正式作业、成绩及全部历史尚未验证，不会当作已完整同步。</p><div id="teams-auto-warnings" class="source-warning"'+(!teamsAuto.warnings.length?' hidden':'')+'>' + teamsAuto.warnings.map(esc).join('<br>') + '</div><details id="teams-auto-diagnostics"'+(!diagnostics.length?' hidden':'')+'><summary id="teams-auto-diagnostics-summary">查看未完成范围（' + diagnostics.length + '）</summary><div id="teams-auto-diagnostics-items">' + diagnosticsHTML(diagnostics) + '</div></details>' + (!settings ? '<div class="banner-actions">' + button('连接设置', 'teams-settings') + '</div>' : '') + '</section>';
  }
  function teamsAutoCountText() {
    const counts = teamsAuto.counts || {}, count = key => Number.isSafeInteger(counts[key]) && counts[key] >= 0 ? counts[key] : 0;
    return '本轮已读取 ' + count('messages') + ' 条消息 · ' + count('channelsRead') + ' 个频道 · ' + count('chatsRead') + ' 个聊天 · 已发现 ' + count('attachments') + ' 个附件' + (Number.isSafeInteger(teamsAuto.attachmentsParsed) ? ' · 已提取文字 ' + teamsAuto.attachmentsParsed + ' 个附件' : '') + (Number.isSafeInteger(teamsAuto.counts.attachmentsCached) ? ' · 版本未变，复用 ' + count('attachmentsCached') + ' 份' : '');
  }
  function diagnosticsHTML(items) { return items.map(item => '<p><strong>' + esc(item.label || item.kind || 'Teams') + '</strong>：' + esc(item.reason || '部分读取') + '</p>').join(''); }
  function setText(id,value) { const node = document.getElementById(id); if (node && node.textContent !== value) node.textContent = value; }
  function setHTML(id,value) { const node = document.getElementById(id); if (node && node.innerHTML !== value) node.innerHTML = value; }
  function updateTeamsAutoPanel() {
    setText('teams-auto-message',teamsAuto.message); setText('teams-auto-counts',teamsAutoCountText());
    const enabled = native && state.settings.teamsBrowserAutomation;
    for (const [id,disabled] of [['login',!native || teamsAuto.running],['start',!enabled || teamsAuto.running],['ec',!enabled || teamsAuto.running],['stop',!teamsAuto.running]]) { const node = document.getElementById('teams-auto-'+id+'-button'); if (node) node.disabled = disabled; }
    setText('teams-auto-start-button',teamsAuto.running ? '正在自动读取…' : '立即自动同步');
    const warnings = document.getElementById('teams-auto-warnings'); if (warnings) { warnings.hidden = !teamsAuto.warnings.length; setHTML(warnings.id,teamsAuto.warnings.map(esc).join('<br>')); }
    const items = (teamsAuto.coverageItems || []).filter(item => item.status !== 'complete').slice(0,60), details = document.getElementById('teams-auto-diagnostics');
    if (details) { details.hidden = !items.length; setText('teams-auto-diagnostics-summary','查看未完成范围（'+items.length+'）'); setHTML('teams-auto-diagnostics-items',diagnosticsHTML(items)); }
    setText('teams-source-badge',teamsAuto.running ? '正在读取' : '浏览器自动同步'); setText('teams-source-message',teamsAuto.message);
    updateStatus();
  }
  function updateGraphProgress() {
    setText('graph-progress-message',graphStatusCopy());setText('graph-progress-scope',graphScopeCopy());
    const partial=document.getElementById('graph-progress-partial');if(partial)partial.hidden=graphStatus.coverage!=='partial';
    setHTML('graph-progress-actions',graphPrimaryButton()+button('连接设置','teams-settings'));updateStatus();
  }
  function renderTeamsSettings() {
    if (state.settings.teamsMode !== 'browser') return renderGraphSettings();
    return '<div id="teams-settings">' + renderTeamsAutoPanel(true) + '<section class="card settings-section"><div class="settings-field"><div><label for="teams-mode">Teams 连接方式</label><p>浏览器模式复用你的学校登录。Graph 模式需要独立应用配置及学校授权。</p></div><select id="teams-mode"><option value="browser" selected>浏览器自动发现</option><option value="graph">微软 Graph 授权</option></select></div><div class="settings-field"><div><label for="teams-auto-discover">定时自动发现和同步</label><p>关闭后停止当前自动读取，保留已同步内容。</p></div><input id="teams-auto-discover" type="checkbox" ' + (state.settings.teamsAutoDiscover ? 'checked' : '') + '></div><div class="settings-field"><div><label for="graph-include-chats">也同步我参与的聊天</label><p>关闭后只自动读取团队频道。</p></div><input id="graph-include-chats" type="checkbox" ' + (state.settings.graphIncludeChats ? 'checked' : '') + '></div></section>' + renderTeamsBrowserSettings() + renderReminderSettings() + '</div>';
  }
  function renderTeamsBrowserSettings() {
    return '<section id="teams-browser-settings" class="card settings-section">' + cardHeader('teams', '浏览器连接与授权') + '<p class="settings-intro">学校账号只在 Chrome 或 Edge 中登录。CampusDesk 使用专用 Teams 同步标签读取消息和可访问附件；接口不可用时尝试页面读取。</p><div class="settings-fields"><div class="settings-field"><div><label for="teams-browser">用于 Teams 的浏览器</label><p>选择你已安装并登录学校账号的浏览器。</p></div><select id="teams-browser"><option value="chrome" ' + (state.settings.teamsBrowser !== 'edge' ? 'selected' : '') + '>Google Chrome</option><option value="edge" ' + (state.settings.teamsBrowser === 'edge' ? 'selected' : '') + '>Microsoft Edge</option></select></div><div class="settings-field"><div><label for="teams-browser-automation">允许读取 Teams 浏览器页面</label><p>允许只读发现和同步账号可见的团队、频道、聊天及附件。不会发送消息、提交作业或修改学校数据；关闭后停止自动读取并保留缓存。</p></div><label class="toggle" for="teams-browser-automation"><input id="teams-browser-automation" type="checkbox" ' + (state.settings.teamsBrowserAutomation ? 'checked' : '') + (!native ? ' disabled' : '') + ' aria-label="允许 CampusDesk 读取 Teams 浏览器页面"><span></span></label></div></div><div class="browser-permission-guide"><p>首次同步时，按 Mac 提示允许 CampusDesk 控制 ' + esc(teamsBrowserName()) + '。也可在系统设置 → 隐私与安全性 → 自动化核对。</p><p>浏览器需启用 Allow JavaScript from Apple Events（允许来自 Apple 事件的 JavaScript）。Chrome 位于“显示 → 开发者”。</p><p>同步时请保留专用 Teams 标签，不要切换其中的页面。登录凭据仅在浏览器内使用；附件在本机解析，不上传外部 AI 服务。关闭应用后不会继续同步。</p></div><details><summary>手动读取当前页面</summary>' + teamsBrowserButtons() + '</details></section>';
  }
  function renderTeamsLegacySettings() {
    const pages = state.settings.teamsPages || [];
    return renderTeamsBrowserSettings() + '<section class="card settings-section">' + cardHeader('teams', '关注的 Teams 页面', button(icon('plus') + '添加页面', 'add-teams-page', '', 'button-plain')) + '<p class="settings-intro">在选定浏览器打开 Teams 频道，在 CampusDesk 点击“关注浏览器当前 Teams 页”，选择页面类型并保存。同步只读取已打开的关注标签页，不会替你打开已关闭的页面。</p>' + (pages.length ? '<div class="followed-pages">' + pages.map(item => '<div class="followed-page"><div><h3>' + esc(item.label) + '<span class="task-tag">' + ({ auto: '自动识别', assignments: '作业频道', ec: 'EC 频道' }[item.kind] || '自动识别') + '</span></h3><p>' + esc(item.url) + '</p></div><div class="page-item-actions">' + button('打开', 'open-source', 'data-source="teams" data-url="' + esc(item.url) + '"') + button('编辑', 'edit-teams-page', 'data-id="' + esc(item.id) + '"') + '<button class="icon-button" type="button" data-action="remove-teams-page" data-id="' + esc(item.id) + '" aria-label="取消关注 ' + esc(item.label) + '">' + icon('trash') + '</button></div></div>').join('') + '</div>' : '<div class="empty small-empty"><h3>先关注一个常看的频道</h3><p>例如课程团队 → HOMEWORK，以及学校团队 → ENGLISH CORNER ROSTER。页面类型随时可以修改。</p></div>') + '<p class="gpa-note">仅覆盖已加载的消息文字。EC 名单保留通知原文；图片或 PDF 内容请通过附件打开。</p></section>';
  }
  function renderReminderSettings() {
    return '<section id="reminder-settings" class="card settings-section">' + cardHeader('bell', 'Teams 作业提醒') + '<div class="settings-fields"><div class="settings-field"><div><label for="teams-notifications">截止前系统通知</label><p id="notification-status">' + esc(permissionCopy()) + '</p></div><label class="toggle" for="teams-notifications"><input id="teams-notifications" type="checkbox" ' + (state.settings.teamsNotifications ? 'checked' : '') + (!native ? ' disabled' : '') + ' aria-label="Teams 作业截止提醒"><span></span></label></div><div class="settings-field"><div><label for="reminder-minutes">提前多久提醒</label><p>如果提前提醒时间已过，将在截止时提醒。已逾期或已完成的作业不安排通知。</p></div><select id="reminder-minutes">' + [[0, '截止时'], [10, '提前 10 分钟'], [30, '提前 30 分钟'], [60, '提前 1 小时'], [1440, '提前 1 天']].map(item => '<option value="' + item[0] + '" ' + (Number(state.settings.reminderMinutes) === item[0] ? 'selected' : '') + '>' + item[1] + '</option>').join('') + '</select></div></div><p class="gpa-note">课表倒计时按北京时间每秒更新，依据已读取课节的结束和下一节开始时间计算。应用需定期运行并同步，才能发现新作业和截止时间变更；系统通知是否显示还受 Mac 通知和专注模式设置影响。</p></section>';
  }
  function renderSettings() {
    return heading('让它适合你的每一天。', '学校系统各自登录；课表、任务和频道原文保存在本机。') + (!native ? '<div class="browser-banner">这是网页预览。登录、会话管理与自动读取只在 Mac 应用中可用。</div>' : '') + '<div class="source-grid">' + renderSourceCard('seiue') + renderSourceCard('managebac') + renderSourceCard('teams') + '</div>' + renderTeamsSettings() + '<section class="card settings-section">' + cardHeader('link', '学校连接') + '<div class="settings-fields"><div class="settings-field"><div><label for="seiue-url">希悦网址</label><p>构建时配置；未配置时不会连接。</p></div><input id="seiue-url" type="url" value="' + esc(sourceURL('seiue')) + '" placeholder="未配置；编辑 SchoolConfig.json 后重新构建" readonly></div><div class="settings-field"><div><label for="managebac-url">学校 ManageBac 网址</label><p>构建时配置；仅允许指定学校的精确地址。</p></div><input id="managebac-url" type="url" value="' + esc(sourceURL('managebac')) + '" placeholder="未配置；编辑 SchoolConfig.json 后重新构建" readonly></div></div></section><section class="card settings-section">' + cardHeader('settings', '日常偏好') + '<div class="settings-fields"><div class="settings-field"><div><label for="refresh-minutes">自动刷新间隔</label><p>应用正在运行且电脑联网时，尝试更新已连接的数据。</p></div><select id="refresh-minutes">' + [[5, '每 5 分钟'], [15, '每 15 分钟'], [30, '每 30 分钟'], [60, '每小时']].map(o => '<option value="' + o[0] + '" ' + (Number(state.settings.refreshMinutes) === o[0] ? 'selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div><div class="settings-field"><div><label for="self-study">空白课节显示为自习</label><p>只处理希悦明确给出时间的空白课节。</p></div><label class="toggle" for="self-study"><input id="self-study" type="checkbox" ' + (state.settings.selfStudy ? 'checked' : '') + ' aria-label="空白课节显示为自习"><span></span></label></div><div class="settings-field"><div><label>显示时区</label><p>在不同地区使用 Mac，也按北京的上课时间展示。</p></div><span class="subtle">Asia / Shanghai · UTC+8</span></div></div></section><section class="card settings-section">' + cardHeader('cloud', '数据与备份') + '<div class="settings-fields"><div class="settings-field"><div><label>导出或恢复本机数据</label><p>包含课程缓存、个人待办及 GPA 记录。也包含 Teams 消息、EC 通知和提醒设置。备份不包含登录会话或密码。</p></div><div class="backup-actions">' + button('导出备份', 'export') + button('导入备份', 'import') + '</div></div></div></section><div class="info-note">希悦和 ManageBac 配置后在应用内登录并读取页面。Teams 默认使用本机 Chrome 或 Edge 已登录页面读取，也可选配 Microsoft Graph 授权；应用运行时定期同步。权限不足、网络中断或接口限制会在同步状态中提示，现有内容作为缓存保留。</div><p class="footer-note">CampusDesk 0.4.2 测试版 · 独立学习工具，与希悦、ManageBac 及 Microsoft 无隶属关系。</p>';
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
    document.getElementById('nav').innerHTML = ['overview', 'schedule', 'grades', 'tasks', 'feedback', 'teams', 'ec'].map(key => '<button type="button" class="nav-item ' + (page === key ? 'active' : '') + '" data-page="' + key + '" ' + (page === key ? 'aria-current="page"' : '') + '><span class="icon">' + icon(key) + '</span>' + pageNames[key] + (key === 'tasks' && openCount ? '<span class="nav-count">' + openCount + '</span>' : '') + '</button>').join('');
    document.querySelector('.settings-nav').classList.toggle('active', page === 'settings');
    document.getElementById('settings-icon').innerHTML = icon('settings');
  }
  function updateStatus() {
    const busy = Object.values(statuses).some(s => s.busy);
    const sync = document.getElementById('sync-button');
    sync.disabled = busy; sync.classList.toggle('syncing', busy);
    const sourceTimes = ['seiue', 'managebac', 'teams'].map(s => sourceStatus(s).lastCapturedAt).filter(Boolean).sort();
    const active = Object.values(statuses).find(s => s.busy);
    document.getElementById('global-status').textContent = busy ? (active.message || '正在读取学校页面…') : sourceTimes.length ? '最近读取 ' + lastUpdated(sourceTimes[sourceTimes.length - 1]) : '尚未同步';
  }
  function updateMenu(clock) {
    clock = clock || Core.getClassClock(state);
    const count = Core.getTasks(state).filter(t => !t.completed).length;
    const title = clock.phase === 'break' || clock.phase === 'lunch' ? (clock.phase === 'break' ? '课间 ' : '午间 ') + clock.remainingLabel : clock.current ? clock.current.title + ' · ' + clock.remainingLabel : clock.next ? (clock.next.start || '') + ' ' + clock.next.title : count ? count + ' 项待办' : 'CampusDesk';
    if (title !== lastMenuTitle) { send('setMenuTitle', { title: title }); lastMenuTitle = title; }
    const isGap = (clock.phase === 'break' || clock.phase === 'lunch') && clock.next && clock.next.start;
    const countdown = isGap ? { label: clock.phase === 'break' ? '课间剩余' : '午休剩余', endsAt: (clock.next.date || Core.today()) + 'T' + clock.next.start + ':00+08:00', nextTitle: clock.next.title || '' } : { clear: true };
    const signature = JSON.stringify(countdown);
    if (signature !== lastMenuCountdown) { send('setMenuCountdown', countdown); lastMenuCountdown = signature; }
  }
  function readingState(container) {
    const all = selector => container && container.querySelectorAll ? Array.from(container.querySelectorAll(selector)) : [];
    const active = document.activeElement, current = {x:window.scrollX || 0,y:window.scrollY || 0,details:all('details[id]').filter(node => node.open).map(node => node.id),scrolls:all('[data-preserve-scroll][id]').map(node => ({id:node.id,top:node.scrollTop,left:node.scrollLeft}))};
    if (active && active.id && container && container.contains && container.contains(active)) current.focus = {id:active.id,value:active.value,start:active.selectionStart,end:active.selectionEnd,direction:active.selectionDirection};
    const anchor = all('[data-reading-anchor][id]').find(node => node.getBoundingClientRect && node.getBoundingClientRect().bottom > 0);
    if (anchor) current.anchor = {id:anchor.id,top:anchor.getBoundingClientRect().top};
    try {
      const selection = window.getSelection && window.getSelection();
      if (selection && selection.rangeCount && !selection.isCollapsed && document.createRange) {
        const range = selection.getRangeAt(0), element = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
        const owner = element && element.closest && element.closest('[data-selection-key][id]');
        if (owner && container.contains(owner)) {
          const before = document.createRange(); before.selectNodeContents(owner); before.setEnd(range.startContainer,range.startOffset); const start = before.toString().length;
          before.setEnd(range.endContainer,range.endOffset);current.selection = {id:owner.id,start,end:before.toString().length,text:range.toString()};
        }
      }
    } catch (_) { /* A changing native selection must not interrupt rendering. */ }
    return current;
  }
  function restoreReading(saved) {
    if (!saved) return;
    for (const id of saved.details) { const node = document.getElementById(id); if (node) node.open = true; }
    for (const entry of saved.scrolls) { const node = document.getElementById(entry.id); if (node) { node.scrollTop=entry.top;node.scrollLeft=entry.left; } }
    if (saved.focus) { const node = document.getElementById(saved.focus.id); if (node) { if (typeof saved.focus.value === 'string') node.value=saved.focus.value; node.focus({preventScroll:true}); if (node.setSelectionRange && Number.isInteger(saved.focus.start)) try {node.setSelectionRange(saved.focus.start,saved.focus.end,saved.focus.direction);} catch (_) {} } }
    try {
      const selection=saved.selection,owner=selection && document.getElementById(selection.id);
      if (owner && document.createTreeWalker && document.createRange) {
        const walker=document.createTreeWalker(owner,4),range=document.createRange();let offset=0,node,start=null,end=null;
        while ((node=walker.nextNode())) { const length=node.textContent.length;if(!start && offset+length>=selection.start)start={node,offset:selection.start-offset};if(offset+length>=selection.end){end={node,offset:selection.end-offset};break;}offset+=length; }
        if(start && end){range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);if(range.toString()===selection.text){const current=window.getSelection();current.removeAllRanges();current.addRange(range);}}
      }
    } catch (_) {}
    let y=saved.y;const anchor=saved.anchor && document.getElementById(saved.anchor.id);if(anchor && anchor.getBoundingClientRect)y+=(anchor.getBoundingClientRect().top-saved.anchor.top);
    window.scrollTo(saved.x,Math.max(0,y));
  }
  function render() {
    const saved = renderedPage === page ? readingState(document.getElementById('content')) : null;
    const graphConfigOpen = page === 'settings' && document.getElementById('graph-configuration') && document.getElementById('graph-configuration').open;
    renderNav();
    document.getElementById('breadcrumb-page').textContent = pageNames[page];
    document.getElementById('sidebar-clock').textContent = Core.clock();
    document.getElementById('sync-icon').innerHTML = icon('refresh');
    document.getElementById('content').innerHTML = ({ overview: renderOverview, schedule: renderSchedule, grades: renderGrades, tasks: renderTasks, feedback: renderFeedback, teams: renderTeams, ec: renderEC, settings: renderSettings })[page]();
    if (graphConfigOpen && document.getElementById('graph-configuration')) document.getElementById('graph-configuration').open = true;
    renderedPage = page;restoreReading(saved);
    const clock = updateClock();
    lastRenderedDay = Core.today();
    lastClockBoundary = clock.phase + ':' + (clock.current && clock.current.id || '') + ':' + (clock.next && clock.next.id || '');
    updateStatus(); updateMenu(clock);
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
  function showDialog(id) {
    const dialog = document.getElementById(id);
    if (dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else { dialog.setAttribute('open', ''); dialog.classList.add('dialog-fallback'); }
  }
  function closeDialog(id) {
    const dialog = document.getElementById(id);
    if (typeof dialog.close === 'function') dialog.close();
    else { dialog.removeAttribute('open'); dialog.classList.remove('dialog-fallback'); }
  }
  function localDateInput(value) {
    const time = new Date(value).getTime();
    return value && Number.isFinite(time) ? new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 16) : '';
  }
  function openTaskDetail(id) {
    const task = Core.getTasks(state).find(item => item.id === id);
    if (!task) { toast('这条任务暂时无法找到，请刷新后重试。'); return; }
    detailTaskId = id;
    const teams = task.source === 'teams', due = taskDue(task), source = teams ? 'teams' : 'managebac';
    document.getElementById('detail-content').innerHTML = '<div class="dialog-heading"><span class="task-tag ' + (teams ? 'teams-tag' : '') + '">' + esc(sourceName(source)) + '</span><button class="icon-button" type="button" data-action="close-detail" aria-label="关闭任务详情">×</button></div><h2 id="detail-title">' + esc(task.title) + '</h2><div class="detail-meta"><span>' + esc(task.course || '') + '</span><span>' + esc(due.label) + (task.dueOverride ? ' · 本机设置' : '') + '</span><span>' + (task.completed ? '本机已完成' : '未完成') + '</span></div><h3 class="detail-subtitle">作业要求</h3><div class="requirements-text">' + esc(task.requirements || task.description || '尚未读取到这份作业的详细要求，请打开学校原页面查看。') + '</div>' + (task.attachments && task.attachments.length ? '<h3 class="detail-subtitle">原文附件</h3>' + attachmentsHTML(task.attachments) + '<p class="gpa-note">附件在浏览器打开，可能需要 Microsoft 登录。附件文字读取状态请逐项核对；未成功解析的请查看原件。</p>' : '') + (teams ? '<div class="due-editor"><label for="detail-due">本机提醒截止时间（北京时间）</label><input id="detail-due" type="datetime-local" value="' + esc(localDateInput(task.dueAt)) + '"><p class="field-hint">请核对原文后设置。这里只改变本机提醒，不会修改 Teams 作业。' + (task.originalDueAt ? '原文已读取截止时间：' + esc(lastUpdated(task.originalDueAt)) + '。' : '原文未读取到可确认的完整截止时间。') + '</p><div class="due-actions">' + button('保存截止时间', 'save-task-due', 'data-id="' + esc(task.id) + '"') + (task.dueOverride ? button('恢复原文时间', 'reset-task-due', 'data-id="' + esc(task.id) + '"') : '') + '</div></div>' : '') + '<div class="dialog-actions">' + button(task.completed ? '标为未完成' : '标为已完成', 'toggle-detail-task', 'data-id="' + esc(task.id) + '"') + (task.url ? button('打开原文 ↗', 'open-source', 'data-source="' + source + '" data-url="' + esc(task.url) + '"', 'button-primary') : '') + '</div>';
    showDialog('detail-dialog');
  }
  function openTeamsPageDialog(id, candidate) {
    const existing = (state.settings.teamsPages || []).find(entry => entry.id === id || (candidate && entry.url === candidate.url));
    const item = existing || candidate;
    document.getElementById('teams-page-form').reset();
    document.getElementById('teams-page-id').value = existing ? existing.id : '';
    document.getElementById('teams-page-label').value = item ? item.label : '';
    document.getElementById('teams-page-url').value = item ? item.url : '';
    document.getElementById('teams-page-kind').value = item ? item.kind : 'auto';
    showDialog('teams-page-dialog');
    document.getElementById('teams-page-label').focus();
  }
  function saveTeamsPage(candidate) {
    const url = Core.safeURL(candidate.url, 'teams'), label = String(candidate.label || '').trim().slice(0, 120);
    if (!url || !label) { toast('请填写页面名称，以及 teams.microsoft.com 或 teams.cloud.microsoft 的 HTTPS 页面网址。'); return false; }
    const pages = state.settings.teamsPages || [];
    const existing = pages.find(item => candidate.id ? item.id === candidate.id : item.url === url);
    if (!existing && pages.length >= 20) { toast('最多关注 20 个 Teams 页面，请先取消一个不常用页面。'); return false; }
    const item = { id: existing ? existing.id : 'page-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8), label: label, url: url, kind: existing && !candidate.id ? existing.kind : ['auto', 'assignments', 'ec'].includes(candidate.kind) ? candidate.kind : 'auto' };
    state.settings.teamsPages = existing ? pages.map(entry => entry.id === existing.id ? item : entry) : pages.concat(item);
    persist(); render(); toast('已关注 ' + label + '。下次同步将读取这个页面。');
    return true;
  }
  function syncReminders() {
    if (!native) return;
    const now = Date.now(), lead = Number(state.settings.reminderMinutes == null ? 30 : state.settings.reminderMinutes) * 60000;
    const items = state.settings.teamsNotifications ? Core.getTasks(state).filter(task => task.source === 'teams' && !task.completed).map(task => {
      const due = new Date(task.dueAt || '').getTime(), url = Core.safeURL(task.url, 'teams');
      if (!Number.isFinite(due) || due <= now || !url) return null;
      const fire = due - lead > now ? due - lead : due;
      return { id: task.id, title: task.title, body: (task.course ? task.course + ' · ' : '') + '作业即将截止，请查看要求。', fireAt: new Date(fire).toISOString(), source: 'teams', url: url };
    }).filter(Boolean).sort((a, b) => a.fireAt.localeCompare(b.fireAt)).slice(0, 60) : [];
    const signature = JSON.stringify(items);
    if (signature !== lastReminderSignature) { send('syncReminders', { items: items }); lastReminderSignature = signature; }
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
      state = candidate; persist({ imported: true }); render(); toast('已恢复备份。Teams 重新同步时会按当前账号重建缓存，其他学校账号需要在这台 Mac 上重新登录。');
    } catch (err) { toast('无法导入：' + (err.message || '备份格式无效。')); }
  }
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action], [data-page]');
    if (!target) return;
    if (target.dataset.page) { navigate(target.dataset.page); return; }
    const action = target.dataset.action;
    if (action === 'open-source') openSource(target.dataset.source, target.dataset.url);
    else if (action === 'graph-settings') showGraphConfiguration();
    else if (action === 'graph-sign-in') graphAction('graphSignIn');
    else if (action === 'graph-sync') graphAction('graphSync');
    else if (action === 'graph-sign-out') {
      if (!native) return;
      send('graphSignOut');
    }
    else if (action === 'graph-save-configuration') {
      if (!native || graphStatus.busy) return;
      const clientId = document.getElementById('graph-client-id').value.trim();
      const tenant = document.getElementById('graph-tenant').value.trim() || 'organizations';
      const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const domain = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
      if (!guid.test(clientId)) { toast('请填写微软应用的有效客户端 ID（UUID），不是密码或密钥。'); return; }
      if (tenant !== 'organizations' && !guid.test(tenant) && !domain.test(tenant)) { toast('租户应为 organizations、学校租户 ID 或学校域名。'); return; }
      state.settings.teamsMode = 'graph'; persist(); graphConfigurationDraft = null;
      send('graphSaveConfiguration', { clientId: clientId, tenant: tenant });
    }
    else if (action === 'pin-teams-browser') teamsBrowserAction('pinTeamsBrowserPage');
    else if (action === 'capture-teams-browser') teamsBrowserAction('captureTeamsBrowserPage', { selectionOnly: false });
    else if (action === 'capture-teams-selection') teamsBrowserAction('captureTeamsBrowserPage', { selectionOnly: true });
    else if (action === 'open-attachment') {
      const url = Core.safeAttachmentURL(target.dataset.url);
      if (!url) { toast('这个附件链接无法打开，请到 Teams 原页面查看。'); return; }
      if (!send('openAttachment', { url: url })) window.open(url, '_blank', 'noopener,noreferrer');
    }
    else if (action === 'task-detail') openTaskDetail(target.dataset.id);
    else if (action === 'close-detail') { detailTaskId = null; closeDialog('detail-dialog'); }
    else if (action === 'toggle-detail-task') {
      const item = Core.getTasks(state).find(task => task.id === target.dataset.id);
      if (item) { state.taskChecks[item.id] = !item.completed; persist(); render(); openTaskDetail(item.id); }
    }
    else if (action === 'save-task-due') {
      const task = Core.getTasks(state).find(item => item.id === target.dataset.id && item.source === 'teams');
      if (!task) return;
      const value = document.getElementById('detail-due').value;
      const date = value ? new Date(value + ':00+08:00') : null;
      if (!date || !Number.isFinite(date.getTime())) { toast('请选择有效的北京时间截止时间。'); return; }
      state.settings.teamsDueOverrides[task.id] = date.toISOString();
      persist(); render(); openTaskDetail(task.id); toast('本机截止时间已保存。');
    }
    else if (action === 'reset-task-due') {
      delete state.settings.teamsDueOverrides[target.dataset.id]; persist(); render(); openTaskDetail(target.dataset.id); toast('已恢复读取到的原文截止时间。');
    }
    else if (action === 'teams-settings') { navigate('settings'); document.getElementById('teams-settings').scrollIntoView({ block: 'start', behavior: 'auto' }); }
    else if (['teams-auto-login', 'teams-auto-start', 'teams-auto-stop', 'teams-auto-ec'].includes(action)) {
      if (!native) { toast('请在 Mac 应用中使用自动同步。'); return; }
      if (action !== 'teams-auto-login' && action !== 'teams-auto-stop' && !state.settings.teamsBrowserAutomation) { navigate('settings'); toast('请先允许读取 Teams 浏览器页面。'); return; }
      state.settings.teamsMode = 'browser'; persist();
      send(action === 'teams-auto-ec' ? 'teams-auto-start' : action, action === 'teams-auto-ec' ? {focus:'ec'} : {});
    }
    else if (action === 'add-teams-page') openTeamsPageDialog();
    else if (action === 'edit-teams-page') openTeamsPageDialog(target.dataset.id);
    else if (action === 'close-teams-page') closeDialog('teams-page-dialog');
    else if (action === 'remove-teams-page') {
      if (!window.confirm('取消关注这个 Teams 页面？已读取的消息会保留。')) return;
      state.settings.teamsPages = state.settings.teamsPages.filter(item => item.id !== target.dataset.id); persist(); render();
    }
    else if (action === 'teams-filter') { teamsFilter = target.dataset.filter; render(); }
    else if (action === 'ec-clear') { ecQuery='';ecDateFilter='all';const search=document.getElementById('ec-search'),date=document.getElementById('ec-date-filter');if(search)search.value='';if(date)date.value='all';updateECResults();if(search)search.focus(); }
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
      if (target.dataset.source === 'teams') { toast('Teams 退出登录请在 ' + teamsBrowserName() + ' 中操作。'); return; }
      send('clearSession', { source: target.dataset.source });
    }
  });
  document.addEventListener('change', event => {
    const el = event.target;
    if (el.id === 'ec-date-filter') { ecDateFilter=/^(?:all|unknown|\d{4}-\d{2}-\d{2})$/.test(el.value)?el.value:'all';updateECResults(); }
    else if (el.id === 'schedule-date') { if (/^\d{4}-\d{2}-\d{2}$/.test(el.value)) { selectedDate = el.value; render(); } }
    else if (el.id === 'refresh-minutes') { state.settings.refreshMinutes = Number(el.value); persist(); toast('刷新间隔已更新。'); }
    else if (el.id === 'self-study') { state.settings.selfStudy = el.checked; persist(); toast('课表显示设置已更新。'); }
    else if (el.id === 'teams-auto-discover') { state.settings.teamsAutoDiscover = Boolean(el.checked); persist(); render(); }
    else if (el.id === 'graph-include-chats') {
      if (!native) { el.checked = false; return; }
      state.settings.graphIncludeChats = Boolean(el.checked); persist();
      toast(el.checked ? '已加入聊天同步。下次连接时可能需要补充授权。' : '已关闭后续聊天同步，已读取内容仍保留在本机。');
    }
    else if (el.id === 'teams-mode') {
      if (!['graph', 'browser'].includes(el.value)) return;
      state.settings.teamsMode = el.value; persist(); render();
      toast(el.value === 'graph' ? '已使用微软授权自动同步。' : '已切换到浏览器自动发现，请登录 Teams 并允许浏览器读取。');
    }
    else if (el.id === 'teams-browser') {
      if (!['chrome', 'edge'].includes(el.value)) return;
      state.settings.teamsBrowser = el.value; persist(); render(); toast('Teams 浏览器已设为 ' + teamsBrowserName() + '，请在这个浏览器登录学校账号并保持关注标签页打开。');
    }
    else if (el.id === 'teams-browser-automation') {
      if (!native) { el.checked = false; toast('读取浏览器中的 Teams 页面需要使用 CampusDesk Mac 应用。'); return; }
      state.settings.teamsBrowserAutomation = Boolean(el.checked); persist(); render();
      toast(el.checked ? '已启用浏览器读取。请按页面说明设置 Mac 与浏览器权限，然后读取当前 Teams 页。' : '已关闭 Teams 浏览器读取，现有缓存仍可查看。');
    }
    else if (el.id === 'teams-notifications') {
      if (!native) { el.checked = false; toast('通知提醒需要使用 CampusDesk Mac 应用。'); return; }
      state.settings.teamsNotifications = Boolean(el.checked);
      if (el.checked) send('requestNotifications');
      persist(); toast(el.checked ? '已启用 Teams 截止提醒，请允许 Mac 通知。' : 'Teams 作业提醒已关闭。');
    }
    else if (el.id === 'reminder-minutes') { state.settings.reminderMinutes = Number(el.value); persist(); toast('作业提醒时间已更新。'); }
    else if (el.id === 'seiue-url' || el.id === 'managebac-url') {
      const source = el.id === 'seiue-url' ? 'seiue' : 'managebac', value = el.value.trim();
      const safe = value ? Core.safeURL(value, source) : '';
      if (value && !safe) { toast('请输入正确的学校 HTTPS 网址，不能使用其他网站。'); el.value = sourceURL(source); return; }
      state.settings[source + 'URL'] = safe; persist(); toast(sourceName(source) + ' 网址已保存。');
    }
  });
  document.addEventListener('input', event => {
    if (event.target.id === 'ec-search') { ecQuery=event.target.value.slice(0,200);updateECResults();return; }
    if (event.target.id !== 'graph-client-id' && event.target.id !== 'graph-tenant') return;
    graphConfigurationDraft = { clientId: document.getElementById('graph-client-id').value, tenant: document.getElementById('graph-tenant').value };
  });
  document.getElementById('teams-page-form').addEventListener('submit', event => {
    event.preventDefault();
    if (saveTeamsPage({ id: document.getElementById('teams-page-id').value, label: document.getElementById('teams-page-label').value, url: document.getElementById('teams-page-url').value, kind: document.getElementById('teams-page-kind').value })) closeDialog('teams-page-dialog');
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
    if (file.size > 25 * 1024 * 1024) { toast('备份过大，请选择 25 MB 以内的 JSON 文件。'); event.target.value = ''; return; }
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
        if (event.type === 'state') { state = event.state && Object.keys(event.state).length ? Core.validateState(event.state) : Core.emptyState(); render(); syncReminders(); }
        else if (event.type === 'teamsAutoStatus') {
          teamsAuto.running = Boolean(event.running);
          ['phase','message','updatedAt','coverage'].forEach(key => { if (typeof event[key] === 'string') teamsAuto[key] = event[key].slice(0,1600); });
          if (event.counts && typeof event.counts === 'object') { teamsAuto.counts = {}; for (const key of ['teams','channels','channelsRead','chats','chatsRead','messages','attachments','attachmentsCached']) if (Number.isSafeInteger(event.counts[key]) && event.counts[key] >= 0) teamsAuto.counts[key] = event.counts[key]; }
          if (Number.isSafeInteger(event.attachmentsParsed)) teamsAuto.attachmentsParsed = event.attachmentsParsed;
          if (Array.isArray(event.warnings)) teamsAuto.warnings = event.warnings.filter(v => typeof v === 'string').slice(0,20).map(v => v.slice(0,1500));
          if (Array.isArray(event.coverageItems)) teamsAuto.coverageItems = event.coverageItems.filter(v => v && typeof v === 'object').slice(0,300).map(v => ({status:String(v.status||''),label:String(v.label||'').slice(0,300),reason:String(v.reason||'').slice(0,1500),kind:String(v.kind||'').slice(0,100)}));
          if (state.settings.teamsMode === 'browser') { statuses.teams = {busy:teamsAuto.running,message:teamsAuto.message}; updateTeamsAutoPanel(); }
        }
        else if (event.type === 'teamsAttachment') {
          if (!event.accountId || !event.snapshotId || !event.attachmentId || !event.result) return;
          const next = JSON.parse(JSON.stringify(state)); let changed = false;
          for (const snapshot of Object.values(next.snapshots.teams || {})) {
            if (snapshot.accountId !== event.accountId || snapshot.snapshotId !== event.snapshotId) continue;
            for (const row of (snapshot.posts || []).concat(snapshot.tasks || [])) for (const item of row.attachments || []) {
              if (item.id !== event.attachmentId) continue;
              const result = event.result, previous = item.text, previousTruncated = Boolean(item.truncated);
              if (typeof result.text === 'string' && result.text) { item.text = result.text.slice(0,80000); item.cached = false; }
              else if (previous) item.cached = true;
              item.extractionStatus = ['read','partial','no_text','unsupported','error'].includes(result.status) ? result.status : 'error';
              item.error = typeof result.error === 'string' ? result.error.slice(0,2000) : '';
              item.truncated = Boolean(result.truncated) || (typeof result.text === 'string' && result.text.length > 80000) || (item.cached && previousTruncated);
              if (item.truncated && item.text && item.extractionStatus === 'read') item.extractionStatus = 'partial';
              retainAttachmentMetadata(item,result);
              // A failed new-version extraction can retain old cached text, but
              // must never label that old text with the new version's identity.
              if(typeof result.text==='string' && result.text) {
                if(typeof event.versionKey==='string' && event.versionKey.length<=140 && /^v[0-9]+:[a-f0-9]{8,128}$/.test(event.versionKey))item.versionKey=event.versionKey;
                else delete item.versionKey;
              }
              if(!item.cached)item.capturedAt = new Date().toISOString(); changed = true;
            }
          }
          if (changed) { state = Core.validateState(next); persist(); render(); }
        }
        else if (event.type === 'teamsAttachmentUnchanged') {
          if(!event.accountId || !event.snapshotId || !event.attachmentId || typeof event.versionKey!=='string' || !event.versionKey || typeof event.checkedAt!=='string' || !Number.isFinite(Date.parse(event.checkedAt)))return;
          const next=JSON.parse(JSON.stringify(state));let changed=false;
          for(const snapshot of Object.values(next.snapshots.teams || {})) {
            if(snapshot.accountId!==event.accountId || snapshot.snapshotId!==event.snapshotId)continue;
            for(const row of (snapshot.posts || []).concat(snapshot.tasks || []))for(const item of row.attachments || []) {
              if(item.id!==event.attachmentId || !item.text || item.versionKey!==event.versionKey)continue;
              item.checkedAt=new Date(event.checkedAt).toISOString();changed=true;
            }
          }
          if(changed){state=Core.validateState(next);persist();}
        }
        else if (event.type === 'graphStatus') {
          const priorConnection=JSON.stringify([graphStatus.configured,graphStatus.connected,graphStatus.authRequired,graphStatus.requiresAdminConsent,graphStatus.clientId,graphStatus.tenant]);
          // Never copy the whole bridge event into state or local storage.
          ['configured', 'connected', 'busy', 'requiresAdminConsent', 'authRequired'].forEach(key => { if (typeof event[key] === 'boolean') graphStatus[key] = event[key]; });
          ['displayName', 'message', 'clientId', 'tenant'].forEach(key => { if (typeof event[key] === 'string') graphStatus[key] = event[key].slice(0, key === 'message' ? 1200 : 253); });
          if (typeof event.status === 'string') graphStatus.authRequired = ['authRequired', 'auth_required'].includes(event.status);
          if (typeof event.coverage === 'string') graphStatus.coverage = event.coverage === 'paused' ? 'partial' : ['partial', 'complete', 'running'].includes(event.coverage) ? event.coverage : '';
          if (Array.isArray(event.warnings)) graphStatus.warnings = event.warnings.filter(warning => typeof warning === 'string').slice(0, 20).map(warning => warning.slice(0, 2000));
          if (event.counts && typeof event.counts === 'object') {
            graphStatus.counts = {};
            ['teams', 'channels', 'assignments', 'messages', 'chats'].forEach(key => { if (Number.isSafeInteger(event.counts[key]) && event.counts[key] >= 0) graphStatus.counts[key] = event.counts[key]; });
          }
          statuses.teams = { busy: graphStatus.busy, message: graphStatus.message || graphStatusCopy() };
          const connectionChanged=priorConnection!==JSON.stringify([graphStatus.configured,graphStatus.connected,graphStatus.authRequired,graphStatus.requiresAdminConsent,graphStatus.clientId,graphStatus.tenant]);
          if(connectionChanged && ['settings','teams','ec','overview'].includes(page))render();else updateGraphProgress();
        }
        else if (event.type === 'graphBatch') {
          if (!window.CampusGraph) throw new Error('Teams 数据适配文件未能加载，请重新安装完整应用。');
          const normalized = window.CampusGraph.normalizeBatch(event.batch);
          if (!normalized.snapshots || !normalized.snapshots.length) throw new Error('Teams 数据批次无效，未记录同步进度。');
          let updated = state;
          for (const snapshot of normalized.snapshots) updated = Core.mergeSnapshot(updated, snapshot);
          state = updated;
          persist();
          // Native handles saveState and this acknowledgement in order and only
          // commits a resume checkpoint after successful persistence of all pages.
          if (typeof event.batchId === 'string' && event.batchId) {
            const acknowledgement = { batchId: event.batchId };
            const isCapWarning = warning => typeof warning === 'string' && /本地[^。]{0,40}上限/.test(warning);
            const capWarnings = Object.values(state.snapshots.teams || {}).flatMap(snapshot => snapshot.warnings || []).filter(isCapWarning);
            if (normalized.coverage && normalized.coverage.capped || capWarnings.length) {
              acknowledgement.partial = true;
              acknowledgement.warnings = [...new Set((normalized.warnings || []).filter(isCapWarning).concat(capWarnings))].slice(0, 10).map(warning => warning.slice(0, 1000));
              if (!acknowledgement.warnings.length) acknowledgement.warnings = ['已达到本地内容存储上限，其余内容请在 Teams 查看。'];
            }
            send('graphBatchProcessed', acknowledgement);
          }
          render();
        }
        else if (event.type === 'graphReset') {
          state = Core.resetTeamsData(state);
          graphStatus.connected = false; graphStatus.busy = false; graphStatus.displayName = ''; graphStatus.counts = {}; graphStatus.coverage = ''; graphStatus.message = ''; graphStatus.requiresAdminConsent = false; graphStatus.authRequired = false; graphStatus.warnings = [];
          statuses.teams = { busy: false, message: 'Teams 已退出，已清除本机 Teams 缓存。' };
          detailTaskId = null; closeDialog('detail-dialog'); lastReminderSignature = '';
          persist(); render();
        }
        else if (event.type === 'snapshot') {
          state = Core.mergeSnapshot(state, event.snapshot);
          persist(); render();
        } else if (event.type === 'status') {
          statuses[event.source || 'app'] = { busy: Boolean(event.busy), message: String(event.message || '') };
          updateStatus();
          if (!event.busy && event.message && (event.source === 'app' || event.source === 'teams')) toast(event.message);
          // Progress messages update the toolbar in place; settings forms stay put.
        } else if (event.type === 'import') applyImport(event.state);
        else if (event.type === 'pinTeamsPage' && event.page) {
          const url = Core.safeURL(event.page.url, 'teams');
          if (!url) { toast('当前页面不是可关注的 Teams 页面，请先在浏览器打开目标频道。'); return; }
          navigate('settings');
          openTeamsPageDialog(null, { url: url, label: String(event.page.label || 'Teams 页面').slice(0, 120), kind: ['auto', 'assignments', 'ec'].includes(event.page.kind) ? event.page.kind : 'auto' });
        }
        else if (event.type === 'notificationPermission') {
          notificationPermission = event.status || (event.granted ? 'authorized' : 'denied');
          const status = document.getElementById('notification-status');
          if (status) status.textContent = permissionCopy();
          if (event.granted) { lastReminderSignature = ''; syncReminders(); }
        }

      } catch (err) {
        if (event.type === 'snapshot' && event.snapshot && event.snapshot.coverage === 'browser') send('teamsAutoSnapshotFailed');
        if (event.type === 'graphBatch' && typeof event.batchId === 'string' && event.batchId) send('graphBatchFailed', { batchId: event.batchId });
        toast('数据暂时无法读取，已保留当前内容。' + (err && err.message ? ' ' + err.message : ''));
      }
    }
  };
  function restoreBrowserState() {
    try { const saved = localStorage.getItem(storageKey); if (saved) state = Core.validateState(JSON.parse(saved)); }
    catch (_) { toast('浏览器中的旧数据无法读取，可以从备份恢复。'); }
  }
  if (!native) {
    if (typeof fetch === 'function') {
      // The native app injects the same validated bundled file before core.js.
      // A hosted preview can read it too; file:// or missing files stay safely
      // unconfigured rather than inventing a school domain.
      fetch('SchoolConfig.json', { cache: 'no-store' }).then(response => {
        if (!response.ok) throw new Error('School configuration unavailable');
        return response.text();
      }).then(text => {
        if (text.length > 8192) throw new Error('School configuration too large');
        Core.configureSchools(JSON.parse(text));
      }).catch(() => {}).finally(() => { restoreBrowserState(); render(); });
    } else restoreBrowserState();
  }
  render();
  send('ready');
  send('requestGraphStatus');
  send('requestTeamsAutoStatus');
  setInterval(() => {
    document.getElementById('sidebar-clock').textContent = Core.clock();
    const clock = updateClock(); updateMenu(clock);
    const today = Core.today(), boundary = clock.phase + ':' + (clock.current && clock.current.id || '') + ':' + (clock.next && clock.next.id || '');
    const dialogOpen = ['task-dialog', 'detail-dialog', 'teams-page-dialog'].some(id => document.getElementById(id).open);
    if (!dialogOpen && (page === 'overview' || page === 'schedule') && (today !== lastRenderedDay || boundary !== lastClockBoundary)) {
      if (selectedDate === lastRenderedDay && today !== lastRenderedDay) selectedDate = today;
      lastRenderedDay = today; lastClockBoundary = boundary; render();
    }
  }, 1000);
})();
