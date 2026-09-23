'use strict';
// DOM/bridge harness: verifies dashboard behavior without a WebKit or browser binary.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
function harness({ native = true, hash = '#overview', saved = null, idle = false } = {}) {
  const nodes = new Map(), listeners = {}, intervals = [], sent = [], opened = [], store = new Map(), idleQueue = [];
  let instant = Date.parse('2026-09-19T00:41:28Z');
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [instant])); } static now() { return instant; } }
  class Element {
    constructor(id = '') { this.id = id; this.dataset = {}; this.attributes={};this.tagName='DIV';this.style={};this.scrollTop=0;this.scrollLeft=0;this.selectionStart=0;this.selectionEnd=0;this.events = {}; this.value = ''; this.checked = false; this.open = false; this.writes = 0; this.children = []; this.textContent = ''; this.animations = []; this.classList = { toggle() {}, add() {}, remove() {} }; }
    set innerHTML(html) { for (const id of this.children) nodes.delete(id); this.children = []; this.html = html; this.writes++; scan(html, this); }
    get innerHTML() { return this.html || ''; }
    addEventListener(type, cb) { this.events[type] = cb; }
    setAttribute(name, value) { if (name === 'open') this.open = true; this[name] = value; }
    removeAttribute(name) { if (name === 'open') this.open = false; }
    matches(selector) { return selector.split(',').some(part => { const match = /^\[([\w-]+)\]$/.exec(part.trim()); return Boolean(match && Object.hasOwn(this.attributes, match[1])); }); }
    animate(keyframes, options) { const animation = { keyframes, options, cancelled: false }; this.animations.push(animation); return { cancel() { animation.cancelled = true; }, set onfinish(callback) { animation.onfinish = callback; } }; }
    showModal() { this.open = true; } close() { this.open = false; } focus() {ctx.document.activeElement=this;} scrollIntoView() {}
    setSelectionRange(start,end,direction){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;}
    contains(node){return node===this || this.children.includes(node && node.id);}
    replaceWith(node){nodes.set(this.id,node);}
    querySelectorAll(selector){return this.children.map(id=>nodes.get(id)).filter(Boolean).filter(node=>selector==='details[id]'?node.tagName==='DETAILS':selector==='[data-preserve-scroll][id]'?Object.hasOwn(node.attributes,'data-preserve-scroll'):selector==='[data-reading-anchor][id]'?Object.hasOwn(node.attributes,'data-reading-anchor'):false);}
    getBoundingClientRect(){return {top:0,bottom:100};}
    reset() {} closest() { return this; } click() { if (this.events.click) this.events.click({ target: this, preventDefault() {} }); }
  }
  function scan(html, owner) {
    for (const match of html.matchAll(/<[a-z][^>]*\bid="([^"]+)"[^>]*>/gi)) {
      const node = new Element(match[1]), value = /\bvalue="([^"]*)"/.exec(match[0]);
      node.tagName=match[0].match(/^<([a-z]+)/i)[1].toUpperCase();for(const attribute of match[0].matchAll(/\s([\w-]+)(?:="([^"]*)")?/g))node.attributes[attribute[1]]=attribute[2] || '';
      for (const [name, value] of Object.entries(node.attributes)) if (name.startsWith('data-')) node.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      node.value = value ? value[1] : ''; node.checked = /\bchecked\b/.test(match[0]);
      nodes.set(node.id, node); if (owner) owner.children.push(node.id);
    }
  }
  scan(fs.readFileSync(path.join(root, 'Resources/index.html'), 'utf8'));
  nodes.set('settings-nav', new Element('settings-nav'));
  if (saved) store.set('campusdesk.browser.v1', JSON.stringify(saved));
  const ctx = { Date: Clock, Intl, URL, URLSearchParams, Blob, setTimeout: () => 1, clearTimeout() {}, setInterval: (cb, ms) => { intervals.push({ cb, ms }); return intervals.length; }, console,
    location: { hash }, localStorage: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) },
    document: { getElementById: id => nodes.get(id) || null, querySelector: selector => selector === '.settings-nav' ? nodes.get('settings-nav') : null, createElement: () => new Element(), addEventListener: (event, cb) => (listeners[event] ||= []).push(cb) },
    addEventListener() {}, scrollX:0,scrollY:0,scrollTo(x,y) {this.scrollX=x;this.scrollY=y;}, requestAnimationFrame: callback => { callback(instant); return 1; }, confirm: () => true, open: (...args) => opened.push(args), crypto: { randomUUID: () => 'test-uuid' }
  };
  if (idle) ctx.requestIdleCallback = callback => { idleQueue.push(callback); return idleQueue.length; };
  ctx.window = ctx;
  if (native) ctx.webkit = { messageHandlers: { campus: { postMessage: item => sent.push(JSON.parse(JSON.stringify(item))) } } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'Resources/core.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'Resources/grade-planner.js'), 'utf8'), ctx);
  // The public application defaults to no configured school; this harness uses invented hosts.
  vm.runInContext("CampusCore.configureSchools({seiue:'https://example-school.seiue.com/',managebac:'https://example-school.managebac.cn/'})", ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'Resources/graph.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'Resources/dashboard.js'), 'utf8'), ctx);
  return { ctx, nodes, sent, opened, intervals, store,
    node: id => { const node = nodes.get(id); assert.ok(node, 'Missing rendered element: ' + id); return node; },
    click: dataset => { const element = new Element(); element.dataset = dataset; for (const listener of listeners.click || []) listener({ target: element }); },
    change: (id, data) => { const element = nodes.get(id); assert.ok(element, id); Object.assign(element, data); for (const listener of listeners.change || []) listener({ target: element }); },
    input: (id, value) => { const element = nodes.get(id); assert.ok(element, id); element.value = value; for (const listener of listeners.input || []) listener({ target: element }); },
    runIdleStep: () => { const callback = idleQueue.shift(); if (callback) callback({ timeRemaining: () => 50 }); },
    drainIdle: () => { let steps = 0; while (idleQueue.length && steps++ < 1000) { const callback = idleQueue.shift(); callback({ timeRemaining: () => 50 }); } assert.ok(steps < 1000, 'idle work should finish'); },
    submit: id => { const target = nodes.get(id), event = { target, preventDefault() {} }; if (target.events.submit) target.events.submit(event); for (const listener of listeners.submit || []) listener(event); },
    receive: event => { ctx.__eventJSON = JSON.stringify(event); vm.runInContext('CampusDesk.receive(JSON.parse(__eventJSON))', ctx); },
    tick: milliseconds => { instant += milliseconds; for (const timer of intervals) timer.cb(); },
    last: action => sent.filter(item => item.action === action).at(-1)
  };
}
function teamsSnapshot(tasks = []) {
  return { source: 'teams', url: 'https://teams.microsoft.com/v2/#/channels/test', title: 'Class channel', capturedAt: '2026-09-19T00:41:00Z', coverage: 'visible', warnings: ['仅覆盖已加载消息'], tasks, posts: [
    { id: 'notice-ec', title: 'EC ANNOUNCEMENT', text: 'Roster notice\nGroup A: Student One\nCheck the original PDF.', kind: 'ec', author: 'Teacher', recipient: 'Grade 10 A', channel: 'ENGLISH CORNER ROSTER', date: '2026-09-18T08:00:00Z', url: 'https://teams.microsoft.com/v2/#/channels/test', attachments: [{ title: 'Roster.pdf', url: 'https://school.sharepoint.com/Shared%20Documents/Roster.pdf' }] },
    { id: 'work-message', title: 'Writing task', text: 'Write a paragraph.\nExplain your evidence.', kind: 'assignment', recipient: 'Grade 10 A', channel: 'HOMEWORK', dateLabel: '5:18 PM', url: 'https://teams.microsoft.com/v2/#/channels/test' }
  ] };
}
function task(overrides = {}) { return Object.assign({ id: 'writing', title: 'Writing <task>', course: 'English', dueAt: '2026-09-19T02:00:00Z', requirements: 'Read the source.\nExplain <your> evidence.', status: 'open', url: 'https://teams.microsoft.com/v2/#/channels/test', attachments: [{ title: 'Guide.pdf', url: 'https://school.sharepoint.com/Guide.pdf' }] }, overrides); }
function schedule() { return { source: 'seiue', url: 'https://example-school.seiue.com/timetable', capturedAt: '2026-09-19T00:40:00Z', warnings: [], schedule: [
  { id: 'math', date: '2026-09-19', start: '08:00', end: '08:40', title: 'Math', room: '201' },
  { id: 'english', date: '2026-09-19', start: '08:50', end: '09:30', title: 'English', room: '202' }
] }; }

test('dashboard appearance setting switches between the preserved classic panel and the card board', () => {
  const app = harness(); app.receive({ type: 'snapshot', snapshot: teamsSnapshot([task()]) }); app.receive({ type: 'snapshot', snapshot: schedule() });
  assert.equal(app.node('app-shell').dataset.dashboardTheme, 'classic');
  assert.match(app.node('content').innerHTML, /今天，也有条不紊/);
  app.click({ page: 'settings' });
  assert.match(app.node('content').innerHTML, /面板样式/);
  assert.match(app.node('content').innerHTML, /卡片看板/);
  app.click({ action: 'dashboard-theme', theme: 'board' });
  assert.equal(app.node('app-shell').dataset.dashboardTheme, 'board');
  app.click({ page: 'overview' });
  assert.match(app.node('content').innerHTML, /集中处理最重要的事/);
  assert.match(app.node('content').innerHTML, /board-task-grid/);
  assert.match(app.node('class-clock-detail').textContent, /下节 English · 08:50–09:30/);
  app.click({ action: 'appearance-settings' });
  assert.match(app.node('content').innerHTML, /经典面板/);
  app.click({ action: 'dashboard-theme', theme: 'classic' });
  assert.equal(app.node('app-shell').dataset.dashboardTheme, 'classic');
  app.click({ page: 'overview' });
  assert.match(app.node('content').innerHTML, /今天，也有条不紊/);
});

test('sidebar navigation animates once and does not rebuild the unchanged navigation bar', () => {
  const app = harness();
  const navWrites = app.node('nav').writes;
  app.click({ page: 'schedule' });
  assert.equal(app.node('nav').writes, navWrites);
  assert.equal(app.node('content').animations.length, 1);
  assert.equal(app.node('content').animations[0].options.duration, 360);
  assert.match(app.node('content').animations[0].keyframes[0].transform, /translate3d\(0, 16px, 0\)/);
  assert.equal(app.node('content').animations[0].keyframes[0].opacity, 0.42);
  const contentWrites = app.node('content').writes;
  app.click({ page: 'schedule' });
  assert.equal(app.node('content').writes, contentWrites);
  assert.equal(app.node('content').animations.length, 1);
});

test('Teams and EC message pages paginate large captured histories', () => {
  const teams = harness({ hash: '#teams' });
  const teamSnapshot = teamsSnapshot();
  teamSnapshot.posts = Array.from({ length: 45 }, (_, index) => ({
    id: 'message-' + index, title: 'Captured message ' + index, text: 'Message body ' + index,
    kind: 'general', author: 'Teacher', channel: 'HOMEWORK', date: '2026-09-18T08:00:00Z',
    url: 'https://teams.microsoft.com/v2/#/channels/test'
  }));
  teams.receive({ type: 'snapshot', snapshot: teamSnapshot });
  assert.equal((teams.node('content').innerHTML.match(/class="teams-post"/g) || []).length, 40);
  assert.match(teams.node('content').innerHTML, /显示 40 \/ 45 条已读取消息/);
  teams.click({ action: 'teams-show-more' });
  assert.equal((teams.node('content').innerHTML.match(/class="teams-post"/g) || []).length, 45);

  const ec = harness({ hash: '#ec' });
  const ecSnapshot = teamsSnapshot();
  ecSnapshot.posts = Array.from({ length: 45 }, (_, index) => ({
    id: 'ec-notice-' + index, title: 'EC notice ' + index, text: 'Roster body ' + index,
    kind: 'ec', author: 'Teacher', channel: 'ENGLISH CORNER ROSTER', date: '2026-09-18T08:00:00Z',
    url: 'https://teams.microsoft.com/v2/#/channels/test'
  }));
  ec.receive({ type: 'snapshot', snapshot: ecSnapshot });
  assert.equal((ec.node('content').innerHTML.match(/class="teams-post"/g) || []).length, 40);
  assert.match(ec.node('content').innerHTML, /显示 40 \/ 45 条匹配通知/);
  ec.click({ action: 'ec-show-more' });
  assert.equal((ec.node('ec-results').innerHTML.match(/class="teams-post"/g) || []).length, 45);
});

test('interface language setting persists and translates the application chrome without translating school data', () => {
  const app = harness();
  app.receive({ type: 'snapshot', snapshot: teamsSnapshot([task({ title: 'Write in English', course: 'English' })]) });
  app.click({ page: 'settings' });
  assert.match(app.node('content').innerHTML, /id="app-language"/);
  app.change('app-language', { value: 'en-US' });
  assert.equal(app.last('saveState').state.settings.language, 'en-US');
  assert.equal(app.node('breadcrumb-page').textContent, 'Connections & Settings');
  assert.match(app.node('content').innerHTML, /Interface language/);
  app.click({ page: 'tasks' });
  assert.equal(app.node('breadcrumb-page').textContent, 'To-Do');
  assert.match(app.node('content').innerHTML, /Teams assignments/);
  assert.match(app.node('content').innerHTML, /Write in English/);
  app.click({ page: 'settings' });
  app.click({ action: 'dashboard-theme', theme: 'board' });
  app.click({ page: 'overview' });
  assert.match(app.node('content').innerHTML, /Today, make steady progress\./);
  assert.doesNotMatch(app.node('content').innerHTML, /[\u4e00-\u9fff]/);
  app.click({ action: 'dashboard-theme', theme: 'classic' });
  app.click({ page: 'overview' });
  assert.doesNotMatch(app.node('content').innerHTML, /[\u4e00-\u9fff]/);
  for (const page of ['schedule', 'grades', 'tasks', 'feedback', 'teams', 'ec', 'settings']) {
    app.click({ page });
    assert.doesNotMatch(app.node('content').innerHTML, /[\u4e00-\u9fff]/, 'English page contains Chinese text: ' + page);
  }
  app.click({ page: 'settings' });
  app.change('app-language', { value: 'zh-CN' });
  assert.equal(app.last('saveState').state.settings.language, 'zh-CN');
  assert.equal(app.node('breadcrumb-page').textContent, '连接与设置');
});

test('estimated GPA is always presented with two decimal places', () => {
  const app = harness();
  app.receive({ type: 'snapshot', snapshot: { source: 'managebac', url: 'https://example-school.managebac.cn/academics', capturedAt: '2026-09-19T00:40:00Z', warnings: [], courses: [
    { id: 'math', name: 'Math', percentage: 90, term: 'Current', isCurrentTerm: true, isCourseGrade: true },
    { id: 'english', name: 'English', percentage: 80, term: 'Current', isCurrentTerm: true, isCourseGrade: true }
  ], tasks: [], feedback: [], officialGPA: null } });
  app.click({ page: 'settings' }); app.click({ action: 'dashboard-theme', theme: 'board' }); app.click({ page: 'overview' });
  assert.match(app.node('content').innerHTML, /<strong>3\.50<\/strong>/);
  app.click({ page: 'grades' });
  assert.match(app.node('content').innerHTML, />3\.50</);
  assert.match(app.node('content').innerHTML, />4\.00</);
});

test('semester forecast explains its assumptions and saves local term dates', () => {
  const app = harness({ hash: '#grades' });
  app.receive({ type: 'snapshot', snapshot: { source: 'managebac', url: 'https://example-school.managebac.cn/student/classes/7001/core_tasks', capturedAt: '2026-09-19T00:40:00Z', warnings: [], courses: [
    { id: 'math', name: 'Synthetic Math', percentage: null, term: 'Current', isCurrentTerm: true, isCourseGrade: false,
      gradeComponents: [{ id: 'essay', name: 'Synthetic essay', percentage: 85, weight: 60 }, { id: 'exam', name: 'Synthetic exam', percentage: null, weight: 40 }] }
  ], tasks: [], feedback: [], officialGPA: null } });
  app.click({ page: 'grades' });
  assert.match(app.node('content').innerHTML, /学期 GPA 预测/);
  assert.match(app.node('content').innerHTML, /无需填写日期也能按类别预测/);
  assert.match(app.node('content').innerHTML, /情景参考 GPA/);
  assert.match(app.node('content').innerHTML, /type="text" id="gpa-term-start"[^>]*placeholder="YYYY-MM-DD"/);
  assert.match(app.node('content').innerHTML, /支持 YYYY-MM-DD 或 YYYYMMDD/);
  const savesBeforeInvalidDates = app.sent.filter(item => item.action === 'saveState').length;
  app.node('gpa-term-start').value = '2026-02-31'; app.node('gpa-term-end').value = '2026-12-31';
  app.node('gpa-term-dates-form').dataset.term = 'current';
  app.submit('gpa-term-dates-form');
  assert.equal(app.sent.filter(item => item.action === 'saveState').length, savesBeforeInvalidDates);
  assert.equal(app.node('toast').textContent, '请按 YYYY-MM-DD 填写有效的学期日期。');
  app.node('gpa-term-start').value = '2026-09-01'; app.node('gpa-term-end').value = '2026-12-31';
  app.node('gpa-term-dates-form').dataset.term = 'current';
  app.submit('gpa-term-dates-form');
  assert.deepEqual(app.last('saveState').state.settings.gpaTermDates.current, { start: '2026-09-01', end: '2026-12-31' });
  assert.match(app.node('content').innerHTML, /情景参考 GPA/);
  assert.match(app.node('content').innerHTML, /3\.00 \/ 4\.00/);
});

test('semester date drafts survive background sync, blur, navigation and clearing before explicit save', () => {
  const app = harness({ hash: '#grades' });
  const snapshot = { source: 'managebac', url: 'https://example-school.managebac.cn/grades', capturedAt: '2026-09-19T00:40:00Z', warnings: [], courses: [
    { id: 'math', name: 'Math', percentage: 85, term: 'Current', isCurrentTerm: true, isCourseGrade: true }
  ], tasks: [], feedback: [], officialGPA: null };
  app.receive({ type: 'snapshot', snapshot });
  const start = app.node('gpa-term-start'), end = app.node('gpa-term-end');
  start.focus(); app.input(start.id, '2026-09-01');
  end.focus(); app.input(end.id, '2026-12-'); end.setSelectionRange(8, 8);
  app.receive({ type: 'snapshot', snapshot: teamsSnapshot() });
  assert.equal(app.node(start.id).value, '2026-09-01');
  assert.equal(app.node(end.id).value, '2026-12-');
  assert.equal(app.node(start.id), start, 'sync retains the actual editing controls');
  assert.equal(app.node(end.id), end);
  assert.equal(app.ctx.document.activeElement, end);
  assert.equal(end.selectionStart, 8);
  assert.deepEqual(app.last('saveState').state.settings.gpaTermDates, {}, 'drafts are not committed by background sync');
  app.input(start.id, '');
  app.click({ page: 'overview' }); app.click({ page: 'grades' });
  assert.equal(app.node(start.id).value, '');
  assert.equal(app.node(end.id).value, '2026-12-');
  app.node(start.id).focus(); app.input(start.id, '2026-09-01');
  app.node(end.id).focus(); app.input(end.id, '2026-12-31');
  app.submit('gpa-term-dates-form');
  assert.deepEqual(app.last('saveState').state.settings.gpaTermDates.current, { start: '2026-09-01', end: '2026-12-31' });
  app.receive({ type: 'snapshot', snapshot });
  assert.equal(app.node(start.id).value, '2026-09-01');
  assert.equal(app.node(end.id).value, '2026-12-31');
});

test('tasks group by subject and Teams group by sender/channel with local focus controls', () => {
  const app = harness(); app.receive({ type: 'snapshot', snapshot: teamsSnapshot([task(), task({ id: 'math-work', title: 'Math work', course: 'Math' })]) }); app.receive({ type: 'snapshot', snapshot: { source: 'managebac', url: 'https://example-school.managebac.cn/tasks', capturedAt: '2026-09-19T00:42:00Z', warnings: [], courses: [], tasks: [{ id: 'biology-work', title: 'Biology work', course: 'Biology', dueAt: null, dueLabel: '', status: 'open', url: 'https://example-school.managebac.cn/tasks' }], feedback: [], officialGPA: null } });
  assert.match(app.node('content').innerHTML, /Teams 作业/); assert.match(app.node('content').innerHTML, /ManageBac 作业/); assert.match(app.node('content').innerHTML, /task-source-grid/);
  app.click({ page: 'settings' }); app.click({ action: 'dashboard-theme', theme: 'board' }); app.click({ page: 'overview' });
  assert.match(app.node('content').innerHTML, /Teams 作业/); assert.match(app.node('content').innerHTML, /ManageBac 作业/); assert.match(app.node('content').innerHTML, /task-source-grid/);
  app.click({ page: 'tasks' });
  assert.match(app.node('content').innerHTML, /Teams 作业/); assert.match(app.node('content').innerHTML, /ManageBac 作业/); assert.match(app.node('content').innerHTML, /task-source-grid/); assert.match(app.node('content').innerHTML, /English/); assert.match(app.node('content').innerHTML, /Math/); assert.match(app.node('content').innerHTML, /Biology/);
  app.click({ action: 'toggle-focus-subject', value: 'English' });
  assert.deepEqual(app.last('saveState').state.settings.focusSubjects, ['English']);
  app.click({ action: 'task-subject-filter', filter: 'focus' }); assert.match(app.node('content').innerHTML, /English/); assert.doesNotMatch(app.node('content').innerHTML, /Math work/);
  app.click({ page: 'teams' });
  assert.match(app.node('content').innerHTML, /发件人：Teacher/); assert.match(app.node('content').innerHTML, /HOMEWORK/);
  app.click({ action: 'toggle-focus-channel', value: 'HOMEWORK' });
  assert.deepEqual(app.last('saveState').state.settings.focusTeamsChannels, ['HOMEWORK']);
  app.click({ action: 'teams-channel-filter', filter: 'focus' }); assert.match(app.node('content').innerHTML, /HOMEWORK/); assert.doesNotMatch(app.node('content').innerHTML, /ENGLISH CORNER ROSTER/);
});

test('new users can edit school addresses through sync and activate them only after native persistence', () => {
  const app = harness({ hash: '#settings' });
  app.receive({ type: 'schoolConfiguration', config: { seiue: '', managebac: '' } });
  assert.equal(app.node('seiue-url').value, '');
  assert.equal(app.node('managebac-url').value, '');
  assert.equal(Object.hasOwn(app.node('seiue-url').attributes, 'readonly'), false);
  app.node('seiue-url').focus(); app.input('seiue-url', 'new-school.seiue.com');
  app.node('managebac-url').focus(); app.input('managebac-url', 'https://new-school.managebac.cn/');
  app.receive({ type: 'snapshot', snapshot: teamsSnapshot() });
  assert.equal(app.node('seiue-url').value, 'new-school.seiue.com');
  assert.equal(app.node('managebac-url').value, 'https://new-school.managebac.cn/');
  app.submit('school-configuration-form');
  const config = app.last('saveSchoolConfiguration').config;
  assert.deepEqual(config, { seiue: 'https://new-school.seiue.com/', managebac: 'https://new-school.managebac.cn/' });
  assert.equal(app.ctx.CampusCore.schoolHomes().seiue, '', 'do not claim success before disk acknowledgement');
  app.receive({ type: 'schoolConfigurationError' });
  assert.match(app.node('toast').textContent, /未能保存/);
  app.submit('school-configuration-form');
  app.receive({ type: 'schoolConfiguration', config, saved: true });
  assert.equal(app.ctx.CampusCore.safeURL(config.seiue, 'seiue'), config.seiue);
  assert.equal(app.last('saveState').state.settings.managebacURL, config.managebac);
  assert.match(app.node('toast').textContent, /学校网址已保存在本机/);
  const before = app.sent.filter(item => item.action === 'saveSchoolConfiguration').length;
  app.input('managebac-url', 'https://managebac.cn.evil.invalid/');
  app.submit('school-configuration-form');
  assert.equal(app.sent.filter(item => item.action === 'saveSchoolConfiguration').length, before);
  assert.equal(app.ctx.CampusCore.schoolHomes().managebac, config.managebac);
});

test('boot migrates old local state, renders new pages, and browser source opening never claims connection', () => {
  const old = { version: 1, settings: {}, snapshots: { seiue: {}, managebac: {} }, manualTasks: [], taskChecks: {}, feedbackRead: {}, gradeHistory: [] };
  const app = harness({ native: false, saved: old });
  assert.match(app.node('nav').innerHTML, /Teams 消息/);
  assert.match(app.node('nav').innerHTML, /English Corner/);
  assert.equal(app.node('class-clock-time').textContent, '—');
  for (const page of ['schedule', 'grades', 'tasks', 'feedback', 'teams', 'ec', 'settings', 'overview']) {
    app.click({ page }); assert.ok(app.node('content').innerHTML.length > 100);
  }
  app.click({ action: 'open-source', source: 'teams' });
  assert.equal(app.opened[0][0], 'https://teams.microsoft.com/v2/');
  assert.match(app.node('toast').textContent, /需要使用 CampusDesk Mac 应用/);
});

test('task reader preserves escaped requirements, routes Teams links and native attachments, and EC remains original notice', () => {
  const app = harness(); app.receive({ type: 'snapshot', snapshot: teamsSnapshot([task()]) });
  app.click({ page: 'tasks' }); assert.match(app.node('content').innerHTML, /data-source="teams"/);
  app.click({ action: 'task-detail', id: 'teams:writing' });
  assert.equal(app.node('detail-dialog').open, true);
  assert.match(app.node('detail-content').innerHTML, /Explain &lt;your&gt; evidence/);
  assert.match(app.node('detail-content').innerHTML, /Guide.pdf/);
  app.click({ action: 'open-source', source: 'teams', url: task().url }); assert.equal(app.last('openSource').source, 'teams');
  app.click({ action: 'open-attachment', url: 'https://school.sharepoint.com/Guide.pdf' }); assert.equal(app.last('openAttachment').url, 'https://school.sharepoint.com/Guide.pdf');
  const count = app.sent.length; app.click({ action: 'open-attachment', url: 'https://evil.example/Guide.pdf' }); assert.equal(app.sent.length, count);
  app.click({ action: 'close-detail' }); app.click({ page: 'teams' });
  assert.match(app.node('content').innerHTML, /原文时间：5:18 PM（日期未确认）/);
  app.click({ page: 'ec' });
  assert.match(app.node('content').innerHTML, /Roster notice\nGroup A: Student One/);
  assert.doesNotMatch(app.node('content').innerHTML, /data-action="toggle-task"/);
  assert.match(app.node('content').innerHTML, /旧名单不代表今天的安排/);
});

test('followed Teams pages validate hosts, preserve EC kind when repinned, edit and remove', () => {
  const app = harness(); app.click({ page: 'settings' }); app.click({ action: 'add-teams-page' });
  app.node('teams-page-label').value = 'EC'; app.node('teams-page-url').value = 'https://evil.example/teams'; app.node('teams-page-kind').value = 'ec';
  app.submit('teams-page-form'); assert.equal(app.last('saveState'), undefined); assert.equal(app.node('teams-page-dialog').open, true);
  app.node('teams-page-url').value = 'https://teams.microsoft.com/v2/#/channels/ec'; app.submit('teams-page-form');
  let entry = app.last('saveState').state.settings.teamsPages[0]; assert.equal(entry.kind, 'ec'); assert.equal(app.node('teams-page-dialog').open, false);
  app.receive({ type: 'pinTeamsPage', page: { url: entry.url, label: 'EC Roster', kind: 'auto' } });
  assert.equal(app.node('teams-page-dialog').open, true);
  assert.equal(app.node('teams-page-kind').value, 'ec');
  app.submit('teams-page-form');
  assert.equal(app.last('saveState').state.settings.teamsPages[0].kind, 'ec');
  app.click({ action: 'edit-teams-page', id: entry.id }); app.node('teams-page-label').value = 'EC Notices'; app.submit('teams-page-form');
  assert.equal(app.last('saveState').state.settings.teamsPages[0].label, 'EC Notices');
  app.click({ action: 'remove-teams-page', id: entry.id }); assert.equal(app.last('saveState').state.settings.teamsPages.length, 0);
});

test('Teams due overrides use Beijing time, schedule notices and cancel on completion/off', () => {
  const app = harness(); app.receive({ type: 'snapshot', snapshot: teamsSnapshot([task()]) }); app.click({ page: 'settings' });
  app.change('teams-notifications', { checked: true }); assert.equal(app.last('requestNotifications').action, 'requestNotifications');
  assert.equal(app.last('syncReminders').items[0].fireAt, '2026-09-19T01:30:00.000Z');
  app.receive({ type: 'notificationPermission', granted: true, status: 'authorized' }); assert.match(app.node('notification-status').textContent, /已允许/);
  app.click({ action: 'task-detail', id: 'teams:writing' }); app.node('detail-due').value = '2026-09-19T09:00'; app.click({ action: 'save-task-due', id: 'teams:writing' });
  assert.equal(app.last('saveState').state.settings.teamsDueOverrides['teams:writing'], '2026-09-19T01:00:00.000Z');
  assert.equal(app.last('syncReminders').items[0].fireAt, '2026-09-19T01:00:00.000Z');
  app.click({ action: 'toggle-detail-task', id: 'teams:writing' }); assert.equal(app.last('syncReminders').items.length, 0);
  app.click({ action: 'toggle-detail-task', id: 'teams:writing' }); assert.equal(app.last('syncReminders').items.length, 1);
  app.click({ action: 'reset-task-due', id: 'teams:writing' }); assert.equal(app.last('saveState').state.settings.teamsDueOverrides['teams:writing'], undefined);
  app.change('teams-notifications', { checked: false }); assert.equal(app.last('syncReminders').items.length, 0);
});

test('reminders exclude past/unknown deadlines and ticker never repeatedly schedules them', () => {
  const app = harness(); app.receive({ type: 'snapshot', snapshot: teamsSnapshot([task({ id: 'past', dueAt: '2026-09-19T00:01:00Z' }), task({ id: 'unknown', dueAt: null }), task()]) });
  app.click({ page: 'settings' }); app.change('teams-notifications', { checked: true });
  assert.equal(app.last('syncReminders').items.length, 1);
  const count = app.sent.filter(item => item.action === 'syncReminders').length;
  for (let i = 0; i < 5; i++) app.tick(1000);
  assert.equal(app.sent.filter(item => item.action === 'syncReminders').length, count);
});

test('to-do deadline icons distinguish upcoming, overdue and unknown dates without claiming delivery', () => {
  const app = harness({ hash: '#tasks' });
  app.receive({ type: 'snapshot', snapshot: teamsSnapshot([
    task(), task({ id: 'past', dueAt: '2026-09-19T00:01:00Z' }), task({ id: 'unknown', dueAt: null })
  ]) });
  const html = app.node('content').innerHTML;
  assert.match(html, /class="task-due has-date"><svg class="task-due-icon"/);
  assert.match(html, /class="task-due is-overdue"><svg class="task-due-icon"[^>]*>.*?<span>已逾期 · /);
  assert.match(html, /class="task-due date-unknown"><span>未设置截止日期<\/span>/);
  assert.equal(app.sent.filter(item => item.action === 'syncReminders').at(-1)?.items.length ?? 0, 0);
  app.click({ page: 'settings' });
  assert.match(app.node('content').innerHTML, /id="reminder-settings"[\s\S]*?Teams 作业提醒/);
});

test('reminder glyph dimensions and state colors remain legible', () => {
  const stylesheet = fs.readFileSync(path.join(root, 'Resources/reminders.css'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'Resources/index.html'), 'utf8');
  assert.match(html, /<link rel="stylesheet" href="reminders\.css">/);
  const block = selector => {
    const start = stylesheet.indexOf(selector + ' {');
    assert.notEqual(start, -1, selector);
    return stylesheet.slice(stylesheet.indexOf('{', start) + 1, stylesheet.indexOf('}', start));
  };
  assert.match(block('.nav-item[data-page="tasks"] .icon svg'), /width:\s*22px/);
  assert.match(block('#reminder-settings .card-title .icon svg'), /width:\s*24px/);
  const rgb = color => [...color.matchAll(/[0-9a-f]{2}/gi)].map(match => parseInt(match[0], 16) / 255);
  const lightness = color => rgb(color).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const contrast = css => {
    const foreground = /color:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
    const background = /background:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
    assert.ok(foreground && background, 'Both colors explicitly defined');
    const a = lightness(foreground), b = lightness(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  for (const selector of ['.task-due.has-date', '.task-due.is-overdue', '#reminder-settings .card-title .icon', '.nav-item[data-page="tasks"].active .icon']) {
    assert.ok(contrast(block(selector)) >= 4.5, selector + ' text/icon contrast');
  }
});

test('second ticker updates isolated text and stable native countdown, crosses into class without false break', () => {
  const app = harness(); app.receive({ type: 'snapshot', snapshot: schedule() });
  assert.equal(app.node('class-clock-label').textContent, '课间剩余'); assert.equal(app.node('class-clock-time').textContent, '08:32');
  assert.match(app.node('class-clock-detail').textContent, /English · 08:50–09:30 · 202/);
  const writes = app.node('content').writes, countdowns = app.sent.filter(item => item.action === 'setMenuCountdown').length;
  assert.equal(app.last('setMenuCountdown').endsAt, '2026-09-19T08:50:00+08:00');
  app.tick(1000); assert.equal(app.node('class-clock-time').textContent, '08:31'); assert.equal(app.node('content').writes, writes);
  assert.equal(app.sent.filter(item => item.action === 'setMenuCountdown').length, countdowns);
  app.tick(511000); assert.equal(app.node('class-clock-label').textContent, '距离下课'); assert.equal(app.last('setMenuCountdown').clear, true);
  assert.equal(app.node('content').writes, writes + 1);
});

test('legacy state leaves external Teams browser automation off and read actions gated', () => {
  const app = harness();
  app.receive({ type: 'state', state: { version: 1, settings: {}, snapshots: { seiue: {}, managebac: {} }, manualTasks: [], taskChecks: {}, feedbackRead: {}, gradeHistory: [] } });
  app.click({ page: 'settings' });
  assert.equal(app.node('teams-browser-automation').checked, false);
  assert.match(app.node('content').innerHTML, /value="chrome" selected/);
  assert.match(app.node('content').innerHTML, /data-action="pin-teams-browser"\s+disabled/);
  app.click({ action: 'pin-teams-browser' });
  app.click({ action: 'capture-teams-browser' });
  app.tick(600000);
  assert.equal(app.last('pinTeamsBrowserPage'), undefined);
  assert.equal(app.last('captureTeamsBrowserPage'), undefined);
  assert.equal(app.last('sync'), undefined);
  app.click({ action: 'open-source', source: 'teams' });
  assert.equal(app.last('openSource').source, 'teams');
  assert.doesNotMatch(app.node('content').innerHTML, /data-action="clear-session" data-source="teams"/);
  assert.match(app.node('content').innerHTML, /data-action="clear-session" data-source="managebac"/);
  assert.match(app.node('content').innerHTML, /data-action="clear-session" data-source="seiue"/);
});

test('browser selection and explicit opt-in persist before current-page and selection reads', () => {
  const app = harness(); app.click({ page: 'settings' });
  app.change('teams-browser', { value: 'edge' });
  assert.equal(app.last('saveState').state.settings.teamsBrowser, 'edge');
  assert.equal(app.last('saveState').state.settings.teamsBrowserAutomation, false);
  app.change('teams-browser-automation', { checked: true });
  assert.equal(app.last('saveState').state.settings.teamsBrowserAutomation, true);
  assert.equal(app.last('captureTeamsBrowserPage'), undefined);
  assert.doesNotMatch(app.node('content').innerHTML, /data-action="pin-teams-browser"\s+disabled/);
  app.click({ action: 'pin-teams-browser' });
  assert.equal(app.last('pinTeamsBrowserPage').action, 'pinTeamsBrowserPage');
  let actionIndex = app.sent.findLastIndex(item => item.action === 'pinTeamsBrowserPage');
  let saveIndex = app.sent.findLastIndex(item => item.action === 'saveState');
  assert.ok(saveIndex < actionIndex);
  assert.equal(app.sent[saveIndex].state.settings.teamsBrowser, 'edge');
  app.click({ action: 'capture-teams-browser' }); assert.equal(app.last('captureTeamsBrowserPage').selectionOnly, false);
  app.click({ action: 'capture-teams-selection' }); assert.equal(app.last('captureTeamsBrowserPage').selectionOnly, true);
  app.change('teams-browser-automation', { checked: false });
  const count = app.sent.filter(item => item.action === 'captureTeamsBrowserPage').length;
  app.click({ action: 'capture-teams-browser' });
  assert.equal(app.sent.filter(item => item.action === 'captureTeamsBrowserPage').length, count);
  assert.equal(app.last('saveState').state.settings.teamsBrowserAutomation, false);
  app.receive({ type: 'status', source: 'teams', busy: false, message: '请允许来自 Apple 事件的 JavaScript。' });
  assert.match(app.node('toast').textContent, /Apple 事件/);
});

test('native browser pin asks for page kind before save and browser preview never sends read commands', () => {
  const app = harness();
  app.receive({ type: 'pinTeamsPage', page: { url: 'https://teams.microsoft.com/v2/#/channels/new-ec', label: 'EC Channel', kind: 'auto' } });
  assert.equal(app.node('teams-page-dialog').open, true);
  assert.equal(app.last('saveState'), undefined);
  app.node('teams-page-kind').value = 'ec'; app.submit('teams-page-form');
  assert.equal(app.last('saveState').state.settings.teamsPages[0].kind, 'ec');
  const browser = harness({ native: false, hash: '#settings' });
  browser.change('teams-browser-automation', { checked: true });
  assert.equal(browser.node('teams-browser-automation').checked, false);
  assert.match(browser.node('toast').textContent, /需要使用 CampusDesk Mac 应用/);
  browser.click({ action: 'capture-teams-browser' });
  assert.match(browser.node('toast').textContent, /需要使用 CampusDesk Mac 应用/);
  assert.equal(browser.sent.length, 0);
});

function graphBatch(messages, channel = 'ec-channel') {
  return { kind: 'channelMessages', source: 'teams', provider: 'graph', capturedAt: '2026-09-19T00:41:00Z',
    team: { id: 'school-team', displayName: 'School' }, channel: { id: channel, displayName: channel === 'ec-channel' ? 'ENGLISH CORNER ROSTER' : 'General' },
    complete: false, messages: messages.map(message => Object.assign({ createdDateTime: '2026-09-18T08:00:00Z', body: { contentType: 'html', content: '<p>EC roster is attached.</p>' }, from: { user: { displayName: 'Teacher' } } }, message)) };
}

function graphHarness(hash) {
  const app = harness({hash: hash || '#teams'});
  const state = app.ctx.CampusCore.emptyState(); state.settings.teamsMode = 'graph';
  app.receive({type:'state',state}); return app;
}
test('browser automation is the default, displays partial coverage, and never persists bridge credentials', () => {
  const app = harness({hash:'#teams'});
  assert.ok(app.last('requestTeamsAutoStatus'));
  assert.match(app.node('content').innerHTML, /teams-auto-start/);
  assert.doesNotMatch(app.node('content').innerHTML, /首次接入需要配置微软应用/);
  app.receive({type:'teamsAutoStatus',running:true,message:'正在读取 EC',counts:{messages:12,attachments:2},warnings:['回复尚未核对'],access_token:'never-save-this'});
  assert.match(app.node('teams-auto-counts').textContent, /12 条消息/);
  assert.match(app.node('teams-auto-warnings').innerHTML, /回复尚未核对/);
  assert.doesNotMatch(app.node('content').innerHTML, /never-save-this/);
  app.click({page:'settings'}); app.change('teams-browser-automation',{checked:true});
  app.click({action:'teams-auto-ec'});
  assert.equal(app.last('teams-auto-start').focus,'ec');
  assert.doesNotMatch(JSON.stringify(app.last('saveState')), /never-save-this/);
  app.click({action:'teams-auto-stop'}); assert.ok(app.last('teams-auto-stop'));
});
test('parsed attachment text is linked to exact account and source, safely rendered, and saved', () => {
  const app = harness({hash:'#ec'}), snapshot = teamsSnapshot();
  snapshot.coverage='browser'; snapshot.snapshotId='browser:ec'; snapshot.accountId='account-1';
  snapshot.posts[0].attachments[0].id='file-1';
  app.receive({type:'snapshot',snapshot});
  const event={type:'teamsAttachment',accountId:'other',snapshotId:'browser:ec',attachmentId:'file-1',result:{status:'read',text:'Roster <script>bad</script>\nStudent A\t14:00'}};
  app.receive(event); assert.doesNotMatch(app.node('content').innerHTML,/Student A/);
  event.accountId='account-1'; app.receive(event);
  assert.match(app.node('content').innerHTML,/Student A/);
  assert.match(app.node('content').innerHTML,/&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(app.node('content').innerHTML,/<script>bad/);
  assert.match(JSON.stringify(app.last('saveState')),/Student A/);
});
test('explicit Graph mode requests native status and retains configuration and sign-in controls', () => {
  const app = graphHarness();
  assert.equal(app.last('requestGraphStatus').action, 'requestGraphStatus');
  assert.match(app.node('content').innerHTML, /首次接入需要配置微软应用/);
  assert.doesNotMatch(app.node('content').innerHTML, /pin-teams-browser|capture-teams|teams-page/);
  app.click({ action: 'graph-settings' });
  assert.equal(app.node('graph-configuration').open, true);
  assert.match(app.node('content').innerHTML, /<details class="advanced-settings legacy-connection"><summary>高级/);
  assert.equal(app.last('graphSignIn'), undefined);
  app.receive({ type: 'graphStatus', configured: true, connected: false, clientId: 'aabbccdd-1234-1234-1234-123456789abc', tenant: 'organizations' });
  app.click({ page: 'teams' });
  assert.match(app.node('content').innerHTML, /data-action="graph-sign-in"/);
  app.click({ action: 'graph-sign-in' });
  assert.equal(app.last('graphSignIn').action, 'graphSignIn');
  assert.equal(app.last('saveState').state.settings.teamsMode, 'graph');
  assert.equal(app.last('pinTeamsBrowserPage'), undefined);
});

test('configuration rejects secrets and invalid tenants, preserves drafts during status updates, and stays outside data backups', () => {
  const app = graphHarness('#settings');
  app.node('graph-client-id').value = 'client-secret';
  app.click({ action: 'graph-save-configuration' }); assert.equal(app.last('graphSaveConfiguration'), undefined);
  const clientId = 'aabbccdd-1234-1234-1234-123456789abc';
  app.input('graph-client-id', clientId); app.input('graph-tenant', 'https://evil.example/');
  app.click({ action: 'graph-save-configuration' }); assert.equal(app.last('graphSaveConfiguration'), undefined);
  app.receive({ type: 'graphStatus', configured: false, connected: false, message: '尚未配置', access_token: 'secret-access', refresh_token: 'secret-refresh' });
  assert.equal(app.node('graph-client-id').value, clientId);
  app.input('graph-tenant', 'school.onmicrosoft.com');
  app.click({ action: 'graph-save-configuration' });
  assert.deepEqual(app.last('graphSaveConfiguration'), { action: 'graphSaveConfiguration', clientId, tenant: 'school.onmicrosoft.com' });
  const exported = JSON.stringify(app.last('saveState').state);
  assert.doesNotMatch(exported, /secret-access|secret-refresh|clientId|graphTenant|school.onmicrosoft/);
  assert.equal(app.last('graphSignIn'), undefined);
});

test('Graph status distinguishes connected, partial, and admin consent without claiming all information was synced', () => {
  const app = graphHarness();
  app.receive({ type: 'graphStatus', configured: true, connected: true, displayName: 'School Student', busy: false, coverage: 'partial', counts: { teams: 2, channels: 5, chats: 3, messages: 12, assignments: 4 }, message: '部分频道未授权。' });
  assert.match(app.node('content').innerHTML, /部分频道未授权/);
  assert.match(app.node('content').innerHTML, /2 个团队 · 5 个频道 · 3 个聊天 · 4 份作业 · 12 条消息/);
  assert.match(app.node('content').innerHTML, /仅完成部分同步/);
  app.click({ action: 'graph-sync' }); assert.equal(app.last('graphSync').action, 'graphSync');
  app.receive({ type: 'graphStatus', configured: true, connected: false, busy: false, requiresAdminConsent: true, message: 'approval required' });
  assert.match(app.node('content').innerHTML, /学校要求管理员批准应用权限/);
  assert.match(app.node('content').innerHTML, /data-action="graph-sign-in"/);
  app.receive({ type: 'graphStatus', configured: true, connected: true, busy: false, requiresAdminConsent: false, status: 'authRequired', message: '登录已过期。' });
  assert.match(app.node('content').innerHTML, /重新登录 Teams/);
  app.click({ action: 'graph-sign-in' }); assert.equal(app.last('graphSignIn').action, 'graphSignIn');
});

test('incremental Graph pages persist before checkpoint acknowledgements and malformed pages receive no acknowledgement', () => {
  const app = harness({ hash: '#teams' });
  app.receive({ type: 'graphBatch', batchId: 'batch-1', batch: graphBatch([{ id: 'first' }]) });
  app.receive({ type: 'graphBatch', batchId: 'batch-2', batch: graphBatch([{ id: 'second', body: { contentType: 'html', content: '<p>EC cancelled on Friday.</p>' } }]) });
  assert.equal(app.last('graphBatchProcessed').batchId, 'batch-2');
  const saved = app.last('saveState').state;
  const posts = app.ctx.CampusCore.getTeamsPosts(saved);
  assert.equal(posts.length, 2);
  assert.match(app.node('content').innerHTML, /EC cancelled on Friday/);
  const savedIndex = app.sent.findLastIndex(item => item.action === 'saveState');
  const ackIndex = app.sent.findLastIndex(item => item.action === 'graphBatchProcessed');
  assert.ok(savedIndex < ackIndex);
  app.receive({ type: 'graphBatch', batchId: 'invalid-1', batch: { kind: 'channelMessages', messages: [] } });
  assert.equal(app.last('graphBatchFailed').batchId, 'invalid-1');
  app.receive({ type: 'graphBatch', batchId: 'invalid-2', batch: {} });
  assert.equal(app.last('graphBatchFailed').batchId, 'invalid-2');
  assert.equal(app.last('graphBatchProcessed').batchId, 'batch-2');
  assert.equal(app.ctx.CampusCore.getTeamsPosts(app.last('saveState').state).length, 2);
});

test('Graph disconnect clears Teams cache and reminders while preserving personal tasks and school schedule', () => {
  const app = harness();
  app.receive({ type: 'snapshot', snapshot: schedule() });
  app.receive({ type: 'snapshot', snapshot: teamsSnapshot([task()]) });
  app.click({ action: 'add-task' }); app.node('task-title').value = 'Keep my task'; app.submit('task-form');
  app.click({ page: 'settings' }); app.change('teams-notifications', { checked: true });
  assert.equal(app.last('syncReminders').items.length, 1);
  app.receive({ type: 'graphStatus', configured: true, connected: true, displayName: 'Account A', busy: true });
  app.click({ action: 'graph-sign-out' }); assert.equal(app.last('graphSignOut').action, 'graphSignOut');
  app.receive({ type: 'graphReset' });
  const state = app.last('saveState').state;
  assert.deepEqual(state.snapshots.teams, {});
  assert.equal(state.manualTasks[0].title, 'Keep my task');
  assert.equal(app.ctx.CampusCore.getSchedule(state, '2026-09-19').length, 2);
  assert.equal(app.last('syncReminders').items.length, 0);
  assert.doesNotMatch(app.node('content').innerHTML, /Account A/);
});

test('Teams teacher feedback opens the Teams source and never renders as ManageBac content', () => {
  const app = harness({ hash: '#feedback' });
  app.receive({ type: 'graphBatch', batchId: 'assignment-feedback', batch: { kind: 'assignment', capturedAt: '2026-09-19T00:41:00Z', class: { id: 'class-id', displayName: 'English' }, userId: 'me', assignment: {
    id: 'assignment-id', displayName: 'Essay', webUrl: 'https://teams.microsoft.com/l/entity/assignments/essay', instructions: { contentType: 'html', content: '<p>Use evidence.</p>' },
    submissions: [{ id: 'submission-id', status: 'returned', recipient: { userId: 'me' }, outcomes: [{ id: 'outcome-id', publishedFeedback: { text: { contentType: 'text', content: 'Explain your evidence more clearly.' }, feedbackBy: { user: { displayName: 'Teacher' } }, feedbackDateTime: '2026-09-19T00:20:00Z' } }] }]
  } } });
  assert.match(app.node('content').innerHTML, /Explain your evidence more clearly/);
  assert.match(app.node('content').innerHTML, /Teams · English/);
  assert.match(app.node('content').innerHTML, /data-source="teams" data-url="https:\/\/teams.microsoft.com\/l\/entity\/assignments\/essay"/);
});

test('backup import resets native account affinity only after accepting the import', () => {
  const app = harness();
  app.receive({ type: 'snapshot', snapshot: schedule() });
  const candidate = app.ctx.CampusCore.emptyState();
  candidate.manualTasks.push({ id: 'restored-task', title: 'Restored personal task', dueAt: null, status: 'open' });
  app.ctx.confirm = () => false;
  app.receive({ type: 'import', state: candidate });
  assert.equal(app.sent.filter(item => item.action === 'saveState' && item.imported).length, 0);
  assert.equal(app.ctx.CampusCore.getSchedule(app.last('saveState').state, '2026-09-19').length, 2);
  app.ctx.confirm = () => true;
  app.receive({ type: 'import', state: candidate });
  assert.equal(app.last('saveState').imported, true);
  assert.equal(app.last('saveState').state.manualTasks[0].title, 'Restored personal task');
  app.receive({ type: 'graphReset' });
  assert.equal(app.last('saveState').imported, undefined);
  assert.equal(app.last('saveState').state.manualTasks[0].title, 'Restored personal task');
});

test('Graph text truncation and merged cache limits acknowledge partial coverage instead of complete sync', () => {
  const textApp = harness({ hash: '#settings' });
  textApp.receive({ type: 'graphBatch', batchId: 'clipped-text', batch: graphBatch([{ id: 'long', subject: 'Long notice', body: { contentType: 'text', content: 'a'.repeat(30001) } }]) });
  assert.equal(textApp.last('graphBatchProcessed').partial, true);
  assert.match(textApp.last('graphBatchProcessed').warnings.join(' '), /本地长度上限/);
  const cacheApp = harness({ hash: '#settings' });
  const messages = Array.from({ length: 3000 }, (_, i) => ({ id: 'message-' + i, subject: 'Notice', body: { contentType: 'text', content: 'Notice' } }));
  cacheApp.receive({ type: 'graphBatch', batchId: 'full-cache', batch: graphBatch(messages, 'general-channel') });
  assert.equal(cacheApp.last('graphBatchProcessed').partial, undefined, 'normal paged coverage must not imply data loss');
  cacheApp.receive({ type: 'graphBatch', batchId: 'overflow', batch: graphBatch([{ id: 'one-more' }], 'general-channel') });
  const ack = cacheApp.last('graphBatchProcessed');
  assert.equal(ack.batchId, 'overflow');
  assert.equal(ack.partial, true);
  assert.match(ack.warnings.join(' '), /3000 条本地缓存上限/);
  assert.ok(ack.warnings.length <= 10 && ack.warnings.every(warning => warning.length <= 1000));
  assert.equal(cacheApp.ctx.CampusCore.getTeamsPosts(cacheApp.last('saveState').state).length, 3000);
});

function searchableEC() {
  const snapshot=teamsSnapshot();snapshot.coverage='browser';snapshot.accountId='account-one';snapshot.snapshotId='browser:ec';
  snapshot.posts=[
    {id:'roster-a',title:'Friday roster',kind:'ec',text:'See the attachment',date:'2026-09-18T08:00:00Z',attachments:[{id:'file-a',title:'Roster.txt',text:'Student Alice\n张同学',extractionStatus:'read'}]},
    {id:'notice-b',title:'Thursday update',kind:'ec',text:'Schedule updated',date:'2026-09-17T08:00:00Z'},
    {id:'undated',title:'Undated EC notice',kind:'ec',text:'No EC tomorrow.',dateLabel:'5:18 PM'}
  ];return snapshot;
}
test('first-run home routes browser Teams users to login, not Graph configuration',()=>{
  const app=harness();assert.match(app.node('content').innerHTML,/data-action="teams-auto-login"/);assert.doesNotMatch(app.node('content').innerHTML,/data-action="graph-settings"/);
  app.click({action:'teams-auto-login'});assert.ok(app.last('teams-auto-login'));assert.equal(app.last('graphSignIn'),undefined);
  const graph=graphHarness('#overview');assert.match(graph.node('content').innerHTML,/data-action="graph-settings"/);
});
test('automatic progress updates only status nodes and leaves EC reading and focused search intact',()=>{
  const app=harness({hash:'#ec'});app.receive({type:'snapshot',snapshot:searchableEC()});
  const detailID='attachment-'+encodeURIComponent('post:teams:roster-a|file-a'),details=app.node(detailID);details.open=true;
  const search=app.node('ec-search');search.value='Alice';search.focus();search.setSelectionRange(1,4,'forward');
  const writes=app.node('content').writes;app.ctx.scrollY=310;
  app.receive({type:'teamsAutoStatus',running:true,message:'Reading next channel',counts:{messages:18,attachmentsCached:3},warnings:['部分范围待核验'],coverageItems:[{label:'EC',status:'partial',reason:'历史待核验'}]});
  assert.equal(app.node('content').writes,writes);assert.equal(app.node(detailID),details);assert.equal(details.open,true);
  assert.equal(app.ctx.document.activeElement,search);assert.equal(search.value,'Alice');assert.equal(search.selectionStart,1);assert.equal(app.ctx.scrollY,310);
  assert.equal(app.node('teams-auto-message').textContent,'Reading next channel');assert.match(app.node('teams-auto-counts').textContent,/18 条消息/);
  assert.match(app.node('teams-auto-counts').textContent,/版本未变，复用 3 份/);
  assert.equal(app.node('teams-auto-stop-button').disabled,false);assert.equal(app.node('teams-auto-start-button').disabled,true);
});
test('new snapshots preserve attachment expansion, nested scroll, search focus and caret',()=>{
  const app=harness({hash:'#ec'});const snapshot=searchableEC();app.receive({type:'snapshot',snapshot});
  const detailID='attachment-'+encodeURIComponent('post:teams:roster-a|file-a');app.node(detailID).open=true;app.node(detailID+'-text').scrollTop=120;
  const search=app.node('ec-search');search.value='Alice';search.focus();search.setSelectionRange(2,5,'backward');app.ctx.scrollY=400;
  snapshot.capturedAt='2026-09-19T00:42:00Z';snapshot.posts[1].text='Schedule updated again';app.receive({type:'snapshot',snapshot});
  assert.equal(app.node(detailID).open,true);assert.equal(app.node(detailID+'-text').scrollTop,120);
  assert.equal(app.ctx.document.activeElement,app.node('ec-search'));assert.equal(app.node('ec-search').value,'Alice');assert.equal(app.node('ec-search').selectionStart,2);assert.equal(app.node('ec-search').selectionEnd,5);assert.equal(app.ctx.scrollY,400);
});
test('EC search matches local extracted attachment text without inventing attendance and keeps controls stable',()=>{
  const app=harness({hash:'#ec'});app.receive({type:'snapshot',snapshot:searchableEC()});const search=app.node('ec-search'),writes=app.node('content').writes;
  app.input('ec-search','ａｌｉｃｅ');
  assert.equal(app.node('ec-search'),search);assert.equal(app.node('content').writes,writes);
  assert.match(app.node('ec-results').innerHTML,/Friday roster/);assert.doesNotMatch(app.node('ec-results').innerHTML,/Thursday update|Undated EC notice/);assert.match(app.node('ec-results').innerHTML,/显示 1 \/ 3/);
  app.input('ec-search','张同学');assert.match(app.node('ec-results').innerHTML,/Friday roster/);
  app.input('ec-search','No matching name');assert.match(app.node('ec-results').innerHTML,/未匹配不代表不在名单中/);
  assert.equal(app.last('teams-auto-start'),undefined);
});
test('large EC search indexes six notices per idle slice and updates progress without blocking the page',()=>{
  const app=harness({hash:'#ec',idle:true}),snapshot=teamsSnapshot();
  snapshot.posts=Array.from({length:15},(_,index)=>({id:'large-ec-'+index,title:'EC notice '+index,text:index===14?'needle appears in this notice':'Roster update '+index,kind:'ec',date:'2026-09-18T08:00:00Z'}));
  app.receive({type:'snapshot',snapshot});app.input('ec-search','needle');
  assert.match(app.node('ec-results').innerHTML,/正在准备搜索索引 · 0 \/ 15/);
  app.runIdleStep();
  assert.equal(app.node('ec-result-count').textContent,'正在准备搜索索引 · 6 / 15');
  assert.equal(app.node('ec-search-progress-fill').style.width,'40%');
  app.drainIdle();
  assert.match(app.node('ec-results').innerHTML,/EC notice 14/);
  assert.doesNotMatch(app.node('ec-results').innerHTML,/EC notice 13/);
});
test('EC filters use confirmed publication dates and retain an explicit undated group',()=>{
  const app=harness({hash:'#ec'});app.receive({type:'snapshot',snapshot:searchableEC()});
  app.change('ec-date-filter',{value:'2026-09-18'});
  const html=app.node('ec-results').innerHTML;assert.match(html,/Friday roster/);assert.match(html,/Undated EC notice/);assert.doesNotMatch(html,/Thursday update/);assert.match(html,/日期未确认（保留显示）/);assert.match(html,/显示 2 \/ 3/);
  app.change('ec-date-filter',{value:'unknown'});assert.doesNotMatch(app.node('ec-results').innerHTML,/Friday roster|Thursday update/);assert.match(app.node('ec-results').innerHTML,/Undated EC notice/);
  app.click({action:'ec-clear'});assert.equal(app.node('ec-search').value,'');assert.equal(app.node('ec-date-filter').value,'all');assert.match(app.node('ec-results').innerHTML,/显示 3 \/ 3/);
});
test('Graph progress on an unchanged connection also leaves message content in place',()=>{
  const app=graphHarness('#ec');app.receive({type:'graphStatus',configured:true,connected:true,busy:false,message:'Connected'});
  const writes=app.node('content').writes;
  app.receive({type:'graphStatus',configured:true,connected:true,busy:true,message:'Reading next page',counts:{messages:9}});
  assert.equal(app.node('content').writes,writes);assert.equal(app.node('graph-progress-message').textContent,'Reading next page');assert.match(app.node('graph-progress-scope').textContent,/9 条消息/);
});

test('attachment text metadata is bounded, persisted and shown without claiming verified roster semantics',()=>{
  const app=harness({hash:'#ec'});app.receive({type:'snapshot',snapshot:searchableEC()});
  const page={page:1,status:'partial',method:'pdf_text+ocr',visualContent:'detected',ocrStatus:'completed',characters:12,ocrMeanConfidence:0.7,ocrLowConfidenceLines:2,reason:'Check table order'};
  app.receive({type:'teamsAttachment',accountId:'account-one',snapshotId:'browser:ec',attachmentId:'file-a',versionKey:'v1:abcdef0123456789',result:{status:'partial',text:'Alice\n张同学',truncated:true,extractionCoverage:'partial',textOnly:true,semanticVerified:false,pagesTotal:4,pagesRead:2,ocrPages:1,warnings:['<unverified>','Visual layout may matter',...Array(10).fill('w'.repeat(600))],pageCoverage:[page,{...page,page:-1}]}});
  const item=Object.values(app.last('saveState').state.snapshots.teams)[0].posts[0].attachments[0];
  assert.equal(item.versionKey,'v1:abcdef0123456789');assert.equal(item.extractionCoverage,'partial');assert.equal(item.semanticVerified,false);assert.equal(item.textOnly,true);
  assert.equal(item.warnings.length,8);assert.equal(item.warnings[2].length,500);assert.equal(item.pageCoverage.length,1);assert.equal(item.pageCoverage[0].ocrMeanConfidence,0.7);assert.equal(item.pagesTotal,4);
  assert.match(app.node('content').innerHTML,/已提取部分文字/);assert.match(app.node('content').innerHTML,/提取文字不等于名单已核验/);assert.match(app.node('content').innerHTML,/&lt;unverified&gt;/);assert.doesNotMatch(app.node('content').innerHTML,/<unverified>/);
});

test('unchanged attachment requires exact account, snapshot, file and version with existing text',()=>{
  const app=harness({hash:'#ec'}),snapshot=searchableEC();
  Object.assign(snapshot.posts[0].attachments[0],{versionKey:'v1:abcdef0123456789',capturedAt:'2026-09-18T02:00:00Z',extractionStatus:'partial',extractionCoverage:'partial',semanticVerified:false,textOnly:true,truncated:true});
  app.receive({type:'snapshot',snapshot});
  const event={type:'teamsAttachmentUnchanged',accountId:'account-one',snapshotId:'browser:ec',attachmentId:'file-a',versionKey:'v1:abcdef0123456789',checkedAt:'2026-09-19T03:00:00Z'};
  const saves=app.sent.filter(row=>row.action==='saveState').length,writes=app.node('content').writes;
  for(const wrong of [{accountId:'other'},{snapshotId:'other'},{attachmentId:'other'},{versionKey:'v1:99999999'},{checkedAt:'bad'}])app.receive({...event,...wrong});
  assert.equal(app.sent.filter(row=>row.action==='saveState').length,saves);
  app.receive(event);
  const item=Object.values(app.last('saveState').state.snapshots.teams)[0].posts[0].attachments[0];
  assert.equal(item.checkedAt,'2026-09-19T03:00:00.000Z');assert.equal(item.capturedAt,'2026-09-18T02:00:00.000Z');assert.equal(item.text,'Student Alice\n张同学');assert.equal(item.extractionStatus,'partial');assert.equal(item.extractionCoverage,'partial');assert.equal(item.truncated,true);assert.equal(item.semanticVerified,false);assert.equal(app.node('content').writes,writes);
  const noText=harness({hash:'#ec'}),emptySnapshot=searchableEC();delete emptySnapshot.posts[0].attachments[0].text;emptySnapshot.posts[0].attachments[0].versionKey=event.versionKey;noText.receive({type:'snapshot',snapshot:emptySnapshot});
  const emptySaves=noText.sent.filter(row=>row.action==='saveState').length;noText.receive(event);assert.equal(noText.sent.filter(row=>row.action==='saveState').length,emptySaves);
});

test('failed new-version extraction preserves old text version and capture time for honest cache reuse',()=>{
  const app=harness({hash:'#ec'}),snapshot=searchableEC();Object.assign(snapshot.posts[0].attachments[0],{versionKey:'v1:abcdef0123456789',capturedAt:'2026-09-18T02:00:00Z',extractionStatus:'partial',truncated:true});app.receive({type:'snapshot',snapshot});
  app.receive({type:'teamsAttachment',accountId:'account-one',snapshotId:'browser:ec',attachmentId:'file-a',versionKey:'v1:99999999',result:{status:'error',error:'Extraction failed'}});
  const item=Object.values(app.last('saveState').state.snapshots.teams)[0].posts[0].attachments[0];
  assert.equal(item.versionKey,'v1:abcdef0123456789');assert.equal(item.capturedAt,'2026-09-18T02:00:00.000Z');assert.equal(item.cached,true);assert.equal(item.truncated,true);assert.equal(item.text,'Student Alice\n张同学');assert.match(app.node('content').innerHTML,/缓存文字/);
});

test('successful replacement text clears an old version when new identity is absent or invalid',()=>{
  for(const versionKey of ['',undefined,'invalid-version','v1:ABCDEF01','v1:'+ 'a'.repeat(129)]) {
    const app=harness({hash:'#ec'}),snapshot=searchableEC();snapshot.posts[0].attachments[0].versionKey='v1:abcdef0123456789';app.receive({type:'snapshot',snapshot});
    const saves=app.sent.filter(row=>row.action==='saveState').length;
    app.receive({type:'teamsAttachment',accountId:'account-one',snapshotId:'browser:ec',attachmentId:'file-a',versionKey,result:{status:'read',text:'Fresh replacement text'}});
    assert.equal(app.sent.filter(row=>row.action==='saveState').length,saves+1);
    const item=Object.values(app.last('saveState').state.snapshots.teams)[0].posts[0].attachments[0];
    assert.equal(item.text,'Fresh replacement text');assert.equal(item.cached,false);assert.equal(item.versionKey,undefined);
  }
});
