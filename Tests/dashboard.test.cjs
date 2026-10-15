'use strict';
// DOM/bridge harness: verifies dashboard behavior without a WebKit or browser binary.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
function harness({ native = true, hash = '#overview', saved = null, idle = false, themeEdition = false, online = true, appVersion = '1.0.0' } = {}) {
  const nodes = new Map(), listeners = {}, windowListeners = {}, intervals = [], sent = [], opened = [], store = new Map(), idleQueue = [], timeouts = [];
  let instant = Date.parse('2026-09-19T00:41:28Z');
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [instant])); } static now() { return instant; } }
  class Element {
    constructor(id = '') { this.id = id; this.dataset = {}; this.attributes={};this.tagName='DIV';this.style={};this.scrollTop=0;this.scrollLeft=0;this.selectionStart=0;this.selectionEnd=0;this.events = {}; this.value = ''; this.checked = false; this.open = false; this.writes = 0; this.children = []; this.textContent = ''; this.animations = []; this.classList = { toggle() {}, add() {}, remove() {} }; }
    set innerHTML(html) { for (const id of this.children) nodes.delete(id); this.children = []; this.html = html; this.writes++; scan(html, this); }
    get innerHTML() { return this.html || ''; }
    addEventListener(type, cb) { this.events[type] = cb; }
    getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }
    setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'open') this.open = true; this[name] = value; }
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
      if (node.tagName === 'TEXTAREA') node.value = html.slice(match.index + match[0].length).split('</textarea>')[0].replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity]);
      nodes.set(node.id, node); if (owner) owner.children.push(node.id);
    }
  }
  scan(fs.readFileSync(path.join(root, 'Resources/index.html'), 'utf8'));
  nodes.set('settings-nav', new Element('settings-nav'));
  if (saved) store.set('campusdesk.browser.v1', JSON.stringify(saved));
  const ctx = { Date: Clock, Intl, URL, URLSearchParams, Blob, CampusDeskThemeEdition: themeEdition, CampusDeskAppVersion: { version: appVersion, name: 'Orion' }, setTimeout: () => 1, clearTimeout() {}, setInterval: (cb, ms) => { intervals.push({ cb, ms }); return intervals.length; }, console,
    location: { hash }, navigator: { onLine: online }, localStorage: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) },
    setTimeout: callback => { timeouts.push(callback); return timeouts.length; },
    document: { documentElement: { dataset: {} }, getElementById: id => nodes.get(id) || null, querySelectorAll: () => [], querySelector: selector => selector === '.settings-nav' ? nodes.get('settings-nav') : null, createElement: () => new Element(), addEventListener: (event, cb) => (listeners[event] ||= []).push(cb) },
    addEventListener: (event, callback) => (windowListeners[event] ||= []).push(callback), scrollX:0,scrollY:0,scrollTo(x,y) {this.scrollX=x;this.scrollY=y;}, requestAnimationFrame: callback => { callback(instant); return 1; }, confirm: () => true, open: (...args) => opened.push(args), crypto: { randomUUID: () => 'test-uuid' }
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
    changeAttributes: (attributes, data) => { const element = new Element(); for (const [name, value] of Object.entries(attributes)) { element.setAttribute(name, value); if (name.startsWith('data-')) element.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value; } Object.assign(element, data); for (const listener of listeners.change || []) listener({ target: element }); },
    input: (id, value) => { const element = nodes.get(id); assert.ok(element, id); element.value = value; for (const listener of listeners.input || []) listener({ target: element }); },
    runIdleStep: () => { const callback = idleQueue.shift(); if (callback) callback({ timeRemaining: () => 50 }); },
    drainIdle: () => { let steps = 0; while (idleQueue.length && steps++ < 1000) { const callback = idleQueue.shift(); callback({ timeRemaining: () => 50 }); } assert.ok(steps < 1000, 'idle work should finish'); },
    composition: (type, id, value) => { const target = nodes.get(id); assert.ok(target, id); if (value !== undefined) target.value = value; for (const listener of listeners[type] || []) listener({ type, target, data: '', isComposing: type === 'compositionstart' }); },
    blur: id => { const target = nodes.get(id); assert.ok(target, id); if (ctx.document.activeElement === target) ctx.document.activeElement = null; for (const listener of listeners.focusout || []) listener({ type: 'focusout', target, relatedTarget: null }); },
    keydown: (id, key, modifiers = {}) => { const target = nodes.get(id); assert.ok(target, id); let prevented = false; for (const listener of listeners.keydown || []) listener(Object.assign({ type: 'keydown', target, key, keyCode: key === 'Enter' ? 13 : 0, preventDefault() { prevented = true; } }, modifiers)); return prevented; },
    flushTimeouts: () => { let steps = 0; while (timeouts.length && steps++ < 1000) timeouts.shift()(); assert.ok(steps < 1000, 'queued timers should finish'); },
    submit: id => { const target = nodes.get(id), event = { target, preventDefault() {} }; if (target.events.submit) target.events.submit(event); for (const listener of listeners.submit || []) listener(event); },
    receive: event => { ctx.__eventJSON = JSON.stringify(event); vm.runInContext('CampusDesk.receive(JSON.parse(__eventJSON))', ctx); },
    setOnline: value => { ctx.navigator.onLine = value; for (const callback of windowListeners[value ? 'online' : 'offline'] || []) callback(); },
    tick: milliseconds => { instant += milliseconds; for (const timer of intervals) timer.cb(); },
    last: action => sent.filter(item => item.action === action).at(-1)
  };
}
function confirmDeepSeekModels(app, models = ['deepseek-flash', 'deepseek-v4-pro']) {
  const request = app.sent.filter(item => item.action === 'assistantListModels' && item.provider === 'deepseek').at(-1);
  assert.ok(request, 'DeepSeek discovery must start before confirming models');
  app.receive({ type: 'assistantModels', provider: 'deepseek', requestId: request.requestId, models });
}
test('chat provider buttons preserve draft and route online requests locally when Ollama is selected', () => {
  const app = harness({ themeEdition: true, hash: '#assistant', online: true });
  app.input('assistant-question', 'Keep this question');
  const input = app.node('assistant-question');
  app.click({ action: 'assistant-switch-provider', provider: 'ollama' });
  assert.equal(app.last('saveState').state.settings.aiProvider, 'ollama');
  assert.equal(app.node('assistant-question'), input);
  assert.equal(input.value, 'Keep this question');
  app.click({ action: 'assistant-send' });
  assert.equal(app.last('assistantRequest').provider, 'ollama');
  app.click({ action: 'assistant-switch-provider', provider: 'deepseek' });
  assert.equal(app.last('saveState').state.settings.aiProvider, 'ollama', 'cannot switch during a response');
  app.receive({ type: 'assistantResponse', requestId: 'test-uuid', answer: 'Done', providerUsed: 'ollama' });
  app.click({ action: 'assistant-switch-provider', provider: 'deepseek' });
  assert.equal(app.last('saveState').state.settings.aiProvider, 'deepseek');
  app.setOnline(false);
  app.click({ action: 'assistant-switch-provider', provider: 'ollama' });
  assert.equal(app.node('assistant-question').disabled, false);
});
function teamsSnapshot(tasks = []) {
  return { source: 'teams', url: 'https://teams.microsoft.com/v2/#/channels/test', title: 'Class channel', capturedAt: '2026-09-19T00:41:00Z', coverage: 'visible', warnings: ['仅覆盖已加载消息'], tasks, posts: [
    { id: 'notice-ec', title: 'EC ANNOUNCEMENT', text: 'Roster notice\nGroup A: Student One\nCheck the original PDF.', kind: 'ec', author: 'Teacher', recipient: 'Grade 10 A', channel: 'ENGLISH CORNER ROSTER', date: '2026-09-18T08:00:00Z', url: 'https://teams.microsoft.com/v2/#/channels/test', attachments: [{ title: 'Roster.pdf', url: 'https://school.sharepoint.com/Shared%20Documents/Roster.pdf' }] },
    { id: 'work-message', title: 'Writing task', text: 'Write a paragraph.\nExplain your evidence.', kind: 'assignment', recipient: 'Grade 10 A', channel: 'HOMEWORK', dateLabel: '5:18 PM', url: 'https://teams.microsoft.com/v2/#/channels/test' }
  ] };
}
function gradeUpdateFixture(overrides = {}) {
  return Object.assign({ id: 'grade-test-1', source: 'managebac', kind: 'updated', title: '<img src=x onerror=alert(1)> Lab report', course: 'Synthetic Physics', courseId: '7001', term: 'Term 1 (current)', url: 'https://example-school.managebac.cn/student/classes/7001/core_tasks/9001', capturedAt: '2026-09-19T00:40:00Z', before: { score: 80, maxScore: 100, percentage: 80, gradeLabel: '' }, after: { score: 90, maxScore: 100, percentage: 90, gradeLabel: '' }, impact: { courseBefore: 86, courseAfter: 88, bandedBefore: 3, bandedAfter: 3.3, linearBefore: 3.44, linearAfter: 3.52, comparable: true } }, overrides);
}
test('grade notifications show unread counts, escaped scores and observed impacts without marking on open', () => {
  const app = harness(), state = app.ctx.CampusCore.emptyState();
  state.gradeUpdates = [gradeUpdateFixture()]; app.receive({ type: 'state', state });
  assert.match(app.node('grade-notifications-button').getAttribute('aria-label'), /1 条未读/);
  app.click({ action: 'grade-notifications-open' });
  assert.equal(app.node('grade-notifications-dialog').open, true);
  const html = app.node('grade-notifications-content').innerHTML;
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/); assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /80 \/ 100 · 80%/); assert.match(html, /90 \/ 100 · 90%/);
  assert.match(html, /86% → 88%/); assert.match(html, /3 → 3.3/); assert.match(html, /3.44 → 3.52/);
  assert.match(html, /本次同步的同期变化/); assert.match(html, /不代表这份作业的单独贡献/);
  assert.equal(app.last('saveState'), undefined, 'opening is not a read acknowledgement');
  app.click({ action: 'grade-notification-read', id: 'grade-test-1' });
  assert.equal(app.last('saveState').state.gradeUpdateRead['grade-test-1'], true);
  assert.match(app.node('grade-notifications-button').getAttribute('aria-label'), /暂无未读/);
  assert.doesNotMatch(app.node('grade-notifications-content').innerHTML, /data-action="grade-notification-read"/);
});
test('grade notification empty, unavailable impact, zero scores, English and mark-all persist correctly', () => {
  const app = harness({ native: false });
  app.click({ action: 'grade-notifications-open' });
  assert.match(app.node('grade-notifications-content').innerHTML, /首次读取某门课程的已有成绩只建立基线/);
  const state = app.ctx.CampusCore.emptyState(); state.settings.language = 'en-US';
  state.gradeUpdates = [gradeUpdateFixture({ id: 'zero', kind: 'new', title: 'Zero points', before: null, after: { score: 0, maxScore: 10, percentage: 0, gradeLabel: '' }, impact: { comparable: false } }), gradeUpdateFixture({ id: 'second', title: 'Another task' })];
  app.receive({ type: 'state', state });
  assert.match(app.node('grade-notifications-content').innerHTML, /0 \/ 10 · 0%/);
  assert.match(app.node('grade-notifications-content').innerHTML, /cannot yet be quantified/);
  assert.match(app.node('grade-notifications-content').innerHTML, /not the effect of this assignment alone/);
  assert.match(app.node('grade-notifications-button').getAttribute('aria-label'), /2 unread/);
  app.click({ action: 'grade-notifications-read-all' });
  const saved = JSON.parse(app.store.get('campusdesk.browser.v1'));
  assert.deepEqual(saved.gradeUpdateRead, { zero: true, second: true });
  const reloaded = harness({ native: false, saved });
  assert.match(reloaded.node('grade-notifications-button').getAttribute('aria-label'), /no unread/);
  reloaded.click({ action: 'grade-notifications-open' }); reloaded.click({ action: 'grade-notifications-filter', filter: 'unread' });
  assert.match(reloaded.node('grade-notifications-content').innerHTML, /You’re all caught up/);
});
test('grade updates repaint the bell without disturbing a focused assistant draft or the page under the drawer', () => {
  const app = harness({ themeEdition: true, hash: '#assistant' });
  const state = app.ctx.CampusCore.emptyState(); state.settings.setupWizardCompleted = true; state.settings.setupWizardIntroVersion = '1.0.0';
  app.receive({ type: 'state', state });
  app.input('assistant-question', 'Keep my draft'); const field = app.node('assistant-question'); field.focus();
  state.gradeUpdates = [gradeUpdateFixture()]; app.receive({ type: 'state', state });
  assert.equal(app.node('assistant-question'), field); assert.equal(field.value, 'Keep my draft');
  assert.match(app.node('grade-notifications-button').getAttribute('aria-label'), /1 条未读/);
  app.click({ action: 'grade-notifications-open' });
  const writes = app.node('content').writes;
  state.gradeUpdates.push(gradeUpdateFixture({ id: 'second' })); app.receive({ type: 'state', state });
  assert.equal(app.node('content').writes, writes); assert.equal(app.node('assistant-question'), field);
  assert.equal(field.value, 'Keep my draft'); assert.match(app.node('grade-notifications-button').getAttribute('aria-label'), /2 条未读/);
  app.click({ action: 'grade-notifications-close' });
  assert.equal(app.node('grade-notifications-dialog').open, false);
  assert.equal(app.node('grade-notifications-button').getAttribute('aria-expanded'), 'false');
});
test('GPA legends identify every moving average and keep the two methods independent', () => {
  for (const language of ['zh-CN', 'en-US']) {
    const app = harness({ hash: '#grades' });
    const state = app.ctx.CampusCore.emptyState();
    state.settings.language = language;
    // Deliberate calendar gaps: MA5 must average recorded periods, not fill days.
    state.gradeHistory = [3.71, 3.25, 3.25, 3.25, 3.75].map((value, i) => ({
      value, method: app.ctx.CampusCore.GPA_BANDED_METHOD, linearValue: 3.5 + i / 10, date: new Date(Date.UTC(2026, 8, 1 + i * 3)).toISOString().slice(0, 10), capturedAt: new Date(Date.UTC(2026, 8, 1 + i * 3)).toISOString(), count: 7
    }));
    app.receive({ type: 'state', state });
    const html = app.node('content').innerHTML;
    assert.equal((html.match(/data-gpa-ma="5" data-ma-ready="true"/g) || []).length, 2);
    assert.match(html, /background:#f0a23b[^]*?MA5[^]*?<strong>3\.44<\/strong>/);
    assert.match(html, /data-gpa-ma="5"[^]*?<strong>3\.70<\/strong>/);
    for (const period of [10, 30, 60]) assert.equal((html.match(new RegExp('data-gpa-ma="' + period + '" data-ma-ready="false"', 'g')) || []).length, 2);
    if (language === 'zh-CN') assert.match(html, /不是当前 GPA、目标或预测/);
    else assert.match(html, /not your current GPA, target or forecast/);
  }
});
function assistantModelOptions(app, id) {
  const select = new RegExp('<select id="' + id + '"[^>]*>([\\s\\S]*?)<\\/select>').exec(app.node('content').innerHTML);
  assert.ok(select, 'Missing model dropdown: ' + id);
  return [...select[1].matchAll(/<option value="([^"]+)"/g)].map(match => match[1]);
}

test('unverifiable legacy GPA history is excluded only from the banded chart', () => {
  const app = harness({ hash: '#grades' });
  const state = app.ctx.CampusCore.emptyState();
  state.gradeHistory = [
    { date: '2026-09-16', capturedAt: '2026-09-16T08:00:00Z', value: 1.21, linearValue: 1.23, count: 2 },
    { date: '2026-09-17', capturedAt: '2026-09-17T08:00:00Z', value: 3.2, linearValue: 3.4, count: 2, method: app.ctx.CampusCore.GPA_BANDED_METHOD },
    { date: '2026-09-18', capturedAt: '2026-09-18T08:00:00Z', value: 3.7, linearValue: 3.6, count: 2, method: app.ctx.CampusCore.GPA_BANDED_METHOD }
  ];
  app.receive({ type: 'state', state });
  const charts = app.node('content').innerHTML.split('<section class="card gpa-kline-card"').slice(1);
  assert.equal(charts.length, 2);
  assert.match(charts[0], /2 个周期/);
  assert.match(charts[0], /1 条旧分档记录/);
  assert.match(charts[1], /3 个周期/);
  assert.doesNotMatch(charts[1], /gpa-history-migration/);
});

test('learning assistant and setup wizard are isolated to CampusDesk Theme Edition', () => {
  const original = harness({ hash: '#assistant' });
  assert.doesNotMatch(original.node('nav').innerHTML, /data-page="assistant"/);
  assert.doesNotMatch(original.node('content').innerHTML, /assistant-workspace/);
  assert.equal(original.ctx.CampusCore.emptyState().settings.aiProvider, undefined);

  const theme = harness({ hash: '#assistant', themeEdition: true });
  assert.match(theme.node('nav').innerHTML, /data-page="assistant"/);
  const themeState = theme.ctx.CampusCore.emptyState();
  assert.equal(themeState.settings.aiProvider, 'off');
  assert.equal(themeState.settings.setupWizardCompleted, false);
  themeState.settings.setupWizardStep = 5;
  theme.receive({ type: 'state', state: themeState });
  assert.equal(theme.node('setup-wizard-dialog').open, true);
  assert.match(theme.node('setup-wizard-content').innerHTML, /setup-ai-provider/);
  assert.equal((theme.node('setup-wizard-content').innerHTML.match(/<option value=/g) || []).length, 4);

  theme.node('setup-ai-provider').value = 'deepseek';
  theme.change('setup-ai-provider');
  assert.equal(theme.last('saveState').state.settings.aiProvider, 'deepseek');
  theme.node('setup-ai-provider').value = 'hybrid';
  theme.change('setup-ai-provider');
  assert.equal(theme.last('saveState').state.settings.aiProvider, 'hybrid');
  assert.match(theme.node('setup-wizard-content').innerHTML, /仅联网 DeepSeek（断网即停用，不回退到 Ollama）/);
  assert.match(theme.node('setup-wizard-content').innerHTML, /联网 DeepSeek，离线 Ollama/);
  assert.doesNotMatch(theme.node('setup-wizard-content').innerHTML, /联网限定模式/);
  theme.click({ action: 'setup-ai-configure' });
  assert.equal(theme.node('setup-wizard-dialog').open, false);
  assert.match(theme.node('content').innerHTML, /assistant-workspace/);
  assert.match(theme.node('content').innerHTML, /data-action="assistant-send"/);
  assert.match(theme.node('content').innerHTML, /data-action="assistant-review"/);
});

test('completed setup gets one version welcome after upgrade; legacy completion migrates without reopening setup', () => {
  const upgraded = harness({ themeEdition: true, appVersion: '1.0.1' });
  const old = upgraded.ctx.CampusCore.emptyState();
  old.settings.setupWizardCompleted = true;
  old.settings.setupWizardStep = 6;
  delete old.settings.setupWizardIntroVersion;
  const migrated = upgraded.ctx.CampusCore.validateState(old);
  assert.equal(migrated.settings.setupWizardCompleted, true, 'legacy wizard completion remains intact');
  assert.equal(migrated.settings.setupWizardIntroVersion, '', 'old boolean-only state is eligible for one version welcome');
  migrated.settings.setupWizardIntroVersion = 'x'.repeat(41);
  assert.throws(() => upgraded.ctx.CampusCore.validateState(migrated), /文本字段过长/);
  migrated.settings.setupWizardIntroVersion = '';
  upgraded.receive({ type: 'state', state: migrated });
  assert.equal(upgraded.node('setup-wizard-dialog').open, true);
  assert.match(upgraded.node('setup-wizard-content').innerHTML, /欢迎使用新版 CampusDesk/);
  assert.doesNotMatch(upgraded.node('setup-wizard-content').innerHTML, /连接 ManageBac/);
  upgraded.click({ action: 'setup-wizard-next' });
  assert.equal(upgraded.node('setup-wizard-dialog').open, false);
  assert.equal(upgraded.last('saveState').state.settings.setupWizardCompleted, true);
  assert.equal(upgraded.last('saveState').state.settings.setupWizardIntroVersion, '1.0.1');

  const sameVersion = harness({ themeEdition: true, appVersion: '1.0.1' });
  const saved = sameVersion.ctx.CampusCore.emptyState();
  saved.settings.setupWizardCompleted = true;
  saved.settings.setupWizardIntroVersion = '1.0.1';
  sameVersion.receive({ type: 'state', state: saved });
  assert.equal(sameVersion.node('setup-wizard-dialog').open, false, 'reopening the same version does not replay welcome');
});

test('setup guide restart is a sequenced flow request and repeated restarts rebuild it', () => {
  const app = harness({ themeEdition: true });
  const saved = app.ctx.CampusCore.emptyState();
  saved.settings.setupWizardCompleted = true;
  saved.settings.setupWizardIntroVersion = '1.0.0';
  app.receive({ type: 'state', state: saved });
  assert.equal(app.node('setup-wizard-dialog').open, false);
  app.click({ action: 'setup-wizard-restart' });
  assert.equal(app.node('setup-wizard-dialog').open, true);
  app.click({ action: 'setup-wizard-next' });
  assert.match(app.node('setup-wizard-content').innerHTML, /先认识一下你/);
  app.click({ action: 'setup-wizard-restart' });
  assert.match(app.node('setup-wizard-content').innerHTML, /首次设置向导/);
  const writes = app.node('setup-wizard-content').writes;
  app.click({ action: 'setup-wizard-restart' });
  assert.ok(app.node('setup-wizard-content').writes > writes, 'a repeated same-mode request is not dropped');
});

test('DeepSeek-only mode is disabled offline and never falls back to Ollama', () => {
  const offline = harness({ hash: '#assistant', themeEdition: true, online: false });
  const offlineState = offline.ctx.CampusCore.emptyState();
  offlineState.settings.setupWizardCompleted = true;
  offlineState.settings.aiProvider = 'deepseek';
  offline.receive({ type: 'state', state: offlineState });
  offline.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true });
  assert.match(offline.node('content').innerHTML, /已停用|disabled offline/i);
  assert.equal(offline.node('assistant-question').attributes.disabled, '');
  assert.match(offline.node('content').innerHTML, /data-action="assistant-send" disabled/);
  offline.setOnline(true);
  assert.equal(offline.node('assistant-question').attributes.disabled, undefined);
  assert.doesNotMatch(offline.node('content').innerHTML, /离线时已停用|Disabled offline; no Ollama fallback/);
  offline.setOnline(false);
  offline.input('assistant-question', 'What should I study?');
  offline.click({ action: 'assistant-send' });
  assert.equal(offline.sent.filter(row => row.action === 'assistantRequest').length, 0);
  assert.equal(offline.node('assistant-question').value, 'What should I study?');
  assert.equal(offline.node('assistant-confirm-dialog').open, false);

  const online = harness({ hash: '#assistant', themeEdition: true, online: true });
  const onlineState = online.ctx.CampusCore.emptyState();
  onlineState.settings.setupWizardCompleted = true;
  onlineState.settings.aiProvider = 'deepseek';
  online.receive({ type: 'state', state: onlineState });
  online.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true });
  confirmDeepSeekModels(online);
  online.input('assistant-question', 'What should I study?');
  online.click({ action: 'assistant-send' });
  assert.equal(online.sent.filter(row => row.action === 'assistantRequest').length, 1);
  assert.equal(online.node('assistant-confirm-dialog').open, false);
  assert.equal(online.last('assistantRequest').provider, 'deepseek');
  assert.equal(online.last('assistantRequest').networkAvailable, true);
});

test('assistant settings expose exactly four modes, migrate the old online-only value, and keep local models separate', () => {
  const app = harness({ hash: '#settings', themeEdition: true });
  const state = app.ctx.CampusCore.emptyState();
  state.settings.setupWizardCompleted = true;
  state.settings.aiProvider = 'auto';
  state.settings.aiModel = 'deepseek-chat';
  app.receive({ type: 'state', state });
  let html = app.node('content').innerHTML;
  const providerSelect = /<select id="assistant-provider"[^>]*>(.*?)<\/select>/.exec(html)?.[1] || '';
  assert.deepEqual([...providerSelect.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]), ['off', 'ollama', 'deepseek', 'hybrid']);
  assert.match(providerSelect, /value="deepseek" selected/);
  assert.doesNotMatch(providerSelect, /auto/);

  app.change('assistant-provider', { value: 'hybrid' });
  html = app.node('content').innerHTML;
  assert.match(html, /id="assistant-model"/);
  assert.match(html, /id="assistant-ollama-model"/);
  assert.equal(app.last('saveState').state.settings.aiModel, 'deepseek-chat');
  assert.equal(app.last('saveState').state.settings.aiOllamaModel, 'qwen3:8b');
});

test('Ollama-only requests use the separately saved local model and never request DeepSeek', () => {
  const app = harness({ hash: '#assistant', themeEdition: true });
  const state = app.ctx.CampusCore.emptyState();
  state.settings.setupWizardCompleted = true;
  state.settings.aiProvider = 'ollama';
  state.settings.aiModel = 'deepseek-chat';
  state.settings.aiOllamaModel = 'llama3.2';
  app.receive({ type: 'state', state });
  app.input('assistant-question', 'What should I study?');
  app.click({ action: 'assistant-send' });
  assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 1);
  assert.equal(app.node('assistant-confirm-dialog').open, false);
  assert.equal(app.last('assistantRequest').provider, 'ollama');
  assert.equal(app.last('assistantRequest').model, 'llama3.2');
  assert.equal(app.last('assistantRequest').fallbackModel, '');
});

test('hybrid assistant sends directly with the current network route and reports the actual provider', () => {
  const offline = harness({ hash: '#assistant', themeEdition: true, online: false });
  const offlineState = offline.ctx.CampusCore.emptyState();
  offlineState.settings.setupWizardCompleted = true;
  offlineState.settings.aiProvider = 'hybrid';
  offline.receive({ type: 'state', state: offlineState });
  offline.input('assistant-question', 'What should I study?');
  offline.click({ action: 'assistant-send' });
  assert.equal(offline.sent.filter(row => row.action === 'assistantRequest').length, 1);
  assert.equal(offline.node('assistant-confirm-dialog').open, false);
  assert.equal(offline.last('assistantRequest').provider, 'hybrid');
  assert.equal(offline.last('assistantRequest').networkAvailable, false);
  assert.equal(offline.last('assistantRequest').fallbackModel, 'qwen3:8b');
  offline.receive({ type: 'assistantResponse', requestId: 'test-uuid', answer: 'Local answer', providerUsed: 'ollama', fallbackReason: 'offline' });
  assert.match(offline.node('content').innerHTML, /本次由 Ollama 回复（当前离线）/);

  const online = harness({ hash: '#assistant', themeEdition: true, online: true });
  const onlineState = online.ctx.CampusCore.emptyState();
  onlineState.settings.setupWizardCompleted = true;
  onlineState.settings.aiProvider = 'hybrid';
  online.receive({ type: 'state', state: onlineState });
  online.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true });
  confirmDeepSeekModels(online);
  online.input('assistant-question', 'What should I study?');
  online.click({ action: 'assistant-send' });
  assert.equal(online.sent.filter(row => row.action === 'assistantRequest').length, 1);
  assert.equal(online.node('assistant-confirm-dialog').open, false);
  assert.equal(online.last('assistantRequest').provider, 'hybrid');
  assert.equal(online.last('assistantRequest').networkAvailable, true);
  assert.equal(online.last('assistantRequest').fallbackModel, 'qwen3:8b');
  online.receive({ type: 'assistantResponse', requestId: 'test-uuid', answer: 'Cloud answer', providerUsed: 'deepseek' });
  assert.match(online.node('content').innerHTML, /本次由 DeepSeek 回复/);
});

test('optional AI request preview never sends by itself and API keys never enter saved dashboard state', () => {
  const app = harness({ hash: '#assistant', themeEdition: true });
  const themeState = app.ctx.CampusCore.emptyState();
  themeState.settings.setupWizardStep = 5;
  app.receive({ type: 'state', state: themeState });
  app.node('setup-ai-provider').value = 'deepseek';
  app.change('setup-ai-provider');
  app.click({ action: 'setup-ai-configure' });
  app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true });
  confirmDeepSeekModels(app);
  app.input('assistant-question', 'Which task should I do first?');
  app.click({ action: 'assistant-review' });
  assert.equal(app.node('assistant-confirm-dialog').open, true);
  assert.match(app.node('assistant-confirm-content').innerHTML, /Which task should I do first\?/);
  assert.match(app.node('assistant-confirm-content').innerHTML, /DeepSeek/);
  assert.match(app.node('assistant-confirm-content').innerHTML, /<details\b[^>]*>[\s\S]*assistant-request-preview/);
  assert.doesNotMatch(app.node('assistant-confirm-content').innerHTML, /<details\b[^>]*\bopen(?:[\s=>])/);
  assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 0);
  app.click({ action: 'assistant-cancel-review' });
  assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 0);
  app.click({ action: 'assistant-review' });
  app.click({ action: 'assistant-confirm-send' });
  const request = app.last('assistantRequest');
  assert.equal(request.provider, 'deepseek');
  assert.match(request.messages.at(-1).content, /Which task should I do first\?/);
  assert.equal(JSON.stringify(app.last('saveState').state).includes('api-key'), false);
});

test('assistant input survives background refreshes without interrupting CJK composition', () => {
  const app = harness({ hash: '#assistant', themeEdition: true });
  const themeState = app.ctx.CampusCore.emptyState();
  themeState.settings.setupWizardCompleted = true;
  themeState.settings.aiProvider = 'ollama';
  app.receive({ type: 'state', state: themeState });
  const editor = app.node('assistant-question');
  editor.focus();
  const composingDraft = '今天要先复习生物，再完成数学作业。';
  editor.value = composingDraft;
  app.composition('compositionstart', 'assistant-question');
  app.input('assistant-question', composingDraft);
  app.composition('compositionend', 'assistant-question', composingDraft);
  const contentWrites = app.node('content').writes;

  const refreshed = app.ctx.CampusCore.emptyState();
  refreshed.settings.setupWizardCompleted = true;
  refreshed.settings.aiProvider = 'ollama';
  app.receive({ type: 'state', state: refreshed });
  assert.equal(app.node('assistant-question'), editor, 'background updates must not replace a focused editor');
  assert.equal(app.node('content').writes, contentWrites, 'background updates must defer the page repaint');
  assert.equal(editor.value, composingDraft);

  app.blur('assistant-question');
  app.flushTimeouts();
  assert.match(app.node('content').innerHTML, /今天要先复习生物，再完成数学作业。/, 'the full draft must remain visible after repaint');
  app.click({ action: 'assistant-review' });
  assert.equal(app.node('assistant-confirm-dialog').open, true);
  assert.match(app.node('assistant-confirm-content').innerHTML, /今天要先复习生物，再完成数学作业。/);
  assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 0, 'review must not send before explicit confirmation');
});

test('assistant Cmd-or-Ctrl-Enter sends once directly while ordinary Enter remains available for text', () => {
  for (const modifier of ['metaKey', 'ctrlKey']) {
    const app = harness({ hash: '#assistant', themeEdition: true });
    const themeState = app.ctx.CampusCore.emptyState();
    themeState.settings.setupWizardCompleted = true;
    themeState.settings.aiProvider = 'ollama';
    app.receive({ type: 'state', state: themeState });
    const editor = app.node('assistant-question');
    editor.focus();
    app.input('assistant-question', '请帮我安排复习顺序');
    assert.equal(app.keydown('assistant-question', 'Enter'), false);
    assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 0);
    assert.equal(app.keydown('assistant-question', 'Enter', { [modifier]: true }), true);
    assert.equal(app.node('assistant-confirm-dialog').open, false);
    assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 1);
    assert.match(app.last('assistantRequest').messages.at(-1).content, /请帮我安排复习顺序/);
    assert.equal(app.node('assistant-question'), editor);
    assert.equal(editor.value, '');
  }
});

test('assistant send shortcut respects composition state, event flags, and legacy IME key codes', () => {
  const app = harness({ hash: '#assistant', themeEdition: true });
  const state = app.ctx.CampusCore.emptyState();
  state.settings.setupWizardCompleted = true;
  state.settings.aiProvider = 'ollama';
  app.receive({ type: 'state', state });
  const editor = app.node('assistant-question');
  editor.focus();
  app.input('assistant-question', '还在输入中文');
  app.composition('compositionstart', 'assistant-question');
  assert.equal(app.keydown('assistant-question', 'Enter', { metaKey: true }), false);
  app.composition('compositionend', 'assistant-question', '中文输入完成');
  assert.equal(app.keydown('assistant-question', 'Enter', { ctrlKey: true, isComposing: true }), false);
  assert.equal(app.keydown('assistant-question', 'Enter', { metaKey: true, keyCode: 229 }), false);
  assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 0);
  assert.equal(app.node('assistant-confirm-dialog').open, false);
  assert.equal(editor.value, '中文输入完成');
  assert.equal(app.keydown('assistant-question', 'Enter', { metaKey: true }), true);
  assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 1);
  assert.match(app.last('assistantRequest').messages.at(-1).content, /中文输入完成/);
});

test('one assistant primary send dispatches once, keeps the focused editor, and renders the response without consuming the next draft', () => {
  const app = harness({ hash: '#assistant', themeEdition: true });
  const state = app.ctx.CampusCore.emptyState();
  state.settings.setupWizardCompleted = true;
  state.settings.aiProvider = 'ollama';
  app.receive({ type: 'state', state });
  const editor = app.node('assistant-question');
  editor.focus();
  app.input('assistant-question', '先完成哪项作业？');
  app.click({ action: 'assistant-send' });
  assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 1);
  assert.equal(app.node('assistant-confirm-dialog').open, false);
  assert.equal(app.node('assistant-question'), editor);
  assert.equal(app.ctx.document.activeElement, editor);
  assert.equal(editor.value, '');
  assert.match(app.node('assistant-chat-log').innerHTML, /先完成哪项作业？/);

  app.input('assistant-question', '下一题正在输入');
  app.click({ action: 'assistant-send' });
  app.keydown('assistant-question', 'Enter', { metaKey: true });
  assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 1, 'busy state must block duplicate clicks and shortcuts');
  assert.equal(editor.value, '下一题正在输入');

  const response = { type: 'assistantResponse', requestId: app.last('assistantRequest').requestId, answer: '先完成明天截止的作业。', providerUsed: 'ollama' };
  app.receive(response);
  assert.match(app.node('assistant-chat-log').innerHTML, /先完成明天截止的作业。/);
  assert.doesNotMatch(app.node('assistant-chat-log').innerHTML, /assistant-typing/);
  assert.equal(app.node('assistant-question'), editor);
  assert.equal(app.ctx.document.activeElement, editor);
  assert.equal(editor.value, '下一题正在输入');
  app.receive(response);
  app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true });
  app.receive({ type: 'state', state });
  app.tick(60_000);
  app.flushTimeouts();
  assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 1, 'response, status, state, and timer events must never resend');
  assert.equal((app.node('assistant-chat-log').innerHTML.match(/先完成明天截止的作业。/g) || []).length, 1);
  assert.equal(editor.value, '下一题正在输入');
});

test('assistant failure reports the error without retrying or discarding the next draft', () => {
  const app = harness({ hash: '#assistant', themeEdition: true });
  const state = app.ctx.CampusCore.emptyState();
  state.settings.setupWizardCompleted = true;
  state.settings.aiProvider = 'ollama';
  app.receive({ type: 'state', state });
  const editor = app.node('assistant-question');
  editor.focus();
  app.input('assistant-question', 'Question that fails');
  app.click({ action: 'assistant-send' });
  app.input('assistant-question', 'Unsaved next question');
  const response = { type: 'assistantResponse', requestId: app.last('assistantRequest').requestId, errorCode: 'localUnavailable' };
  app.receive(response);
  app.receive(response);
  app.receive({ type: 'state', state });
  app.flushTimeouts();
  assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 1);
  assert.match(app.node('assistant-chat-log').innerHTML, /无法连接本机 Ollama|Could not reach local Ollama/);
  assert.doesNotMatch(app.node('assistant-chat-log').innerHTML, /assistant-typing/);
  assert.equal(app.node('assistant-question'), editor);
  assert.equal(editor.value, 'Unsaved next question');
  assert.equal(app.node('assistant-confirm-dialog').open, false);
});

test('assistant primary send rejects disabled providers, blank questions, missing keys, and browser previews without dispatch', () => {
  const cases = [
    { provider: 'off', draft: '保留这段未发送的问题' },
    { provider: 'ollama', draft: '  \n  ' },
    { provider: 'deepseek', draft: '缺少密钥时保留问题' },
    { provider: 'hybrid', draft: '联网混合模式也需要密钥' },
    { provider: 'ollama', draft: '网页预览不发送', native: false }
  ];
  for (const item of cases) {
    const app = harness({ hash: '#assistant', themeEdition: true, native: item.native !== false });
    const state = app.ctx.CampusCore.emptyState();
    state.settings.setupWizardCompleted = true;
    state.settings.aiProvider = item.provider;
    app.receive({ type: 'state', state });
    const editor = app.node('assistant-question');
    editor.focus();
    app.input('assistant-question', item.draft);
    app.click({ action: 'assistant-send' });
    assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 0, item.provider + ': invalid request must not dispatch');
    assert.equal(app.node('assistant-confirm-dialog').open, false);
    assert.equal(editor.value, item.draft, item.provider + ': a rejected send must retain the draft');
  }
});

test('assistant direct send includes only the currently selected context categories and keeps source links local', () => {
  const app = harness({ hash: '#assistant', themeEdition: true });
  const state = app.ctx.CampusCore.emptyState();
  state.settings.setupWizardCompleted = true;
  state.settings.aiProvider = 'ollama';
  state.settings.aiContextCategories = ['tasks'];
  app.receive({ type: 'state', state });
  app.receive({ type: 'snapshot', snapshot: teamsSnapshot([task({ title: 'Selected assignment', requirements: 'Selected instructions' })]) });
  app.receive({ type: 'snapshot', snapshot: schedule() });
  app.input('assistant-question', 'Use the selected assignments');
  app.click({ action: 'assistant-send' });
  const request = app.last('assistantRequest');
  assert.ok(request);
  const userContent = request.messages.at(-1).content;
  const context = JSON.parse(userContent.slice(userContent.indexOf('{')));
  assert.deepEqual(Object.keys(context), ['tasks']);
  assert.equal(context.tasks[0].title, 'Selected assignment');
  assert.equal(context.tasks[0].requirements, 'Selected instructions');
  assert.doesNotMatch(JSON.stringify(request.messages), /EC ANNOUNCEMENT|Roster notice|School calendar|https:\/\//);
  assert.equal(app.node('assistant-confirm-dialog').open, false);
});

test('inaccessible DeepSeek keys stay inline, block dispatch, and retain the question until explicit settings navigation', () => {
  for (const keyState of ['locked', 'unavailable']) {
    const app = harness({ hash: '#assistant', themeEdition: true });
    const state = app.ctx.CampusCore.emptyState();
    state.settings.setupWizardCompleted = true;
    state.settings.aiProvider = 'deepseek';
    app.receive({ type: 'state', state });
    app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: keyState === 'locked', deepSeekKeyState: keyState });
    assert.match(app.node('content').innerHTML, /data-action="assistant-restore-key"/);
    app.input('assistant-question', '保留这道尚未发送的问题');
    app.click({ action: 'assistant-send' });
    assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 0, keyState + ': protected credentials must block a network request');
    assert.equal(app.node('assistant-confirm-dialog').open, false);
    assert.match(app.node('content').innerHTML, /assistant-workspace/, 'a blocked send must not navigate away automatically');
    assert.equal(app.node('assistant-question').value, '保留这道尚未发送的问题');
    app.click({ action: 'assistant-open-key-settings' });
    assert.match(app.node('content').innerHTML, /assistant-settings/);
    assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 0);
    app.click({ page: 'assistant' });
    assert.equal(app.node('assistant-question').value, '保留这道尚未发送的问题');
  }
});

test('a silent Keychain access failure restores an untouched question, preserves a new draft, and never retries a send', () => {
  for (const nextDraft of ['', '另一个正在编辑的问题']) {
    const app = harness({ hash: '#assistant', themeEdition: true });
    const state = app.ctx.CampusCore.emptyState();
    state.settings.setupWizardCompleted = true;
    state.settings.aiProvider = 'deepseek';
    app.receive({ type: 'state', state });
    app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'stored' });
    confirmDeepSeekModels(app);
    const editor = app.node('assistant-question');
    editor.focus();
    app.input('assistant-question', '这道题尚未发给模型');
    app.click({ action: 'assistant-send' });
    assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 1);
    if (nextDraft) app.input('assistant-question', nextDraft);
    const failure = { type: 'assistantResponse', requestId: app.last('assistantRequest').requestId, errorCode: 'keyAccess' };
    app.receive(failure);
    assert.equal(app.node('assistant-question'), editor);
    assert.equal(editor.value, nextDraft || '这道题尚未发给模型');
    assert.match(app.node('assistant-chat-log').innerHTML, /恢复密钥访问|restore.*key.*access/i);
    assert.equal(app.node('assistant-confirm-dialog').open, false);
    app.receive(failure);
    app.click({ action: 'assistant-send' });
    assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 1, 'an inaccessible key must stop repeated send clicks');
    app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'stored' });
    app.receive({ type: 'state', state });
    app.flushTimeouts();
    assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 1, 'a later key-status refresh must never resend an old question');
    assert.equal(editor.value, nextDraft || '这道题尚未发给模型');
  }
});

test('inaccessible DeepSeek credentials do not block Ollama or offline hybrid requests', () => {
  for (const options of [{ provider: 'ollama', online: true }, { provider: 'hybrid', online: false }]) {
    const app = harness({ hash: '#assistant', themeEdition: true, online: options.online });
    const state = app.ctx.CampusCore.emptyState();
    state.settings.setupWizardCompleted = true;
    state.settings.aiProvider = options.provider;
    app.receive({ type: 'state', state });
    app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'locked' });
    app.input('assistant-question', 'Use the local model');
    app.click({ action: 'assistant-send' });
    assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 1);
    assert.equal(app.last('assistantRequest').provider, options.provider);
    assert.equal(app.last('assistantRequest').networkAvailable, options.online);
    assert.equal(app.node('assistant-confirm-dialog').open, false);
  }
});

test('DeepSeek models are selectable presets refreshed from the service and arbitrary names cannot be saved', () => {
  const app = harness({ hash: '#settings', themeEdition: true });
  const state = app.ctx.CampusCore.emptyState();
  state.settings.setupWizardCompleted = true;
  state.settings.aiProvider = 'deepseek';
  app.receive({ type: 'state', state });
  assert.equal(app.node('assistant-model').tagName, 'SELECT');
  assert.doesNotMatch(app.node('content').innerHTML, /<input\b[^>]*id="assistant-model"/);
  assert.deepEqual(assistantModelOptions(app, 'assistant-model'), ['deepseek-flash', 'deepseek-v4-pro']);
  assert.equal(app.sent.filter(row => row.action === 'assistantListModels').length, 0, 'missing credentials must not start model discovery');
  app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'stored' });
  const request = app.last('assistantListModels');
  assert.equal(request.provider, 'deepseek');
  assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 0, 'model discovery must not send a chat question');
  app.receive({ type: 'assistantModels', provider: 'deepseek', requestId: request.requestId, models: ['deepseek-v4-pro', 'deepseek-flash', 'deepseek-v4-pro', 'deepseek-next'] });
  assert.deepEqual(assistantModelOptions(app, 'assistant-model'), ['deepseek-v4-pro', 'deepseek-flash', 'deepseek-next']);
  app.change('assistant-model', { value: 'deepseek-v4-pro' });
  assert.equal(app.last('saveState').state.settings.aiModel, 'deepseek-v4-pro');
  const saves = app.sent.filter(row => row.action === 'saveState').length;
  app.change('assistant-model', { value: 'unlisted-arbitrary-model' });
  assert.equal(app.sent.filter(row => row.action === 'saveState').length, saves);
  app.click({ page: 'assistant' });
  app.input('assistant-question', 'Use the model I selected');
  app.click({ action: 'assistant-send' });
  assert.equal(app.last('assistantRequest').model, 'deepseek-v4-pro');
});

test('switching to DeepSeek discovers models immediately and waits for confirmation even with a focused draft', () => {
  for (const focused of [false, true]) {
    const app = assistantAuditHarness([]);
    app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'stored' });
    const editor = app.node('assistant-question');
    if (focused) editor.focus();
    app.input('assistant-question', 'Keep my first DeepSeek question');
    app.click({ action: 'assistant-switch-provider', provider: 'deepseek' });
    assert.equal(app.last('assistantListModels').provider, 'deepseek', 'mode switching starts discovery without a complete page render');
    assert.equal(app.node('assistant-send').disabled, true);
    app.click({ action: 'assistant-send' });
    assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 0);
    assert.equal(app.node('assistant-question').value, 'Keep my first DeepSeek question');
    confirmDeepSeekModels(app, ['deepseek-v4-pro']);
    assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 0, 'discovery never sends the waiting draft automatically');
    if (focused) assert.equal(app.node('assistant-question'), editor);
    assert.equal(app.node('assistant-send').disabled, false);
    app.click({ action: 'assistant-send' });
    assert.equal(app.last('assistantRequest').model, 'deepseek-v4-pro', 'the first question uses the confirmed model rather than the earlier preset');
  }
});

test('restoring DeepSeek access starts model discovery while typing and cloud discovery never blocks offline hybrid', () => {
  const app = assistantAuditHarness([], 'deepseek');
  app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'locked' });
  const editor = app.node('assistant-question'); editor.focus();
  app.input('assistant-question', 'Question retained after restoring access');
  app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'stored', notice: 'keyRestored' });
  assert.equal(app.last('assistantListModels').provider, 'deepseek');
  assert.equal(app.node('assistant-question'), editor);
  assert.equal(app.node('assistant-send').disabled, true);
  app.click({ action: 'assistant-switch-provider', provider: 'hybrid' });
  app.setOnline(false);
  assert.equal(app.node('assistant-send').disabled, false, 'offline hybrid needs no confirmation from the cloud');
  app.click({ action: 'assistant-send' });
  assert.equal(app.last('assistantRequest').provider, 'hybrid');
  assert.equal(app.last('assistantRequest').networkAvailable, false);
});

test('a confirmed DeepSeek model remains usable during refresh and temporary discovery failures', () => {
  const app = assistantAuditHarness([], 'deepseek');
  app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'stored' });
  confirmDeepSeekModels(app);
  app.input('assistant-question', 'Use my confirmed model');
  app.click({ action: 'assistant-refresh-models', provider: 'deepseek' });
  assert.equal(app.node('assistant-send').disabled, false, 'refreshing a confirmed catalog must not interrupt a question');
  const refresh = app.last('assistantListModels');
  app.receive({ type: 'assistantModels', provider: 'deepseek', requestId: refresh.requestId, errorCode: 'rateLimited' });
  assert.equal(app.node('assistant-send').disabled, false);
  app.click({ action: 'assistant-send' });
  assert.equal(app.last('assistantRequest').model, 'deepseek-flash');
  app.click({ page: 'settings' });
  assert.match(app.node('content').innerHTML, /请求过于频繁/);
  assert.doesNotMatch(app.node('content').innerHTML, /尚未设置 DeepSeek API 密钥/);
});

test('DeepSeek API and model discovery failures explain the real cause, retain drafts, and never resend or request a new key', () => {
  const errors = [
    ['remoteInvalidRequest', /无法处理本次请求/, /could not process/],
    ['insufficientBalance', /余额不足/, /balance is insufficient/],
    ['modelUnavailable', /模型当前不可用/, /model is unavailable/],
    ['rateLimited', /请求过于频繁/, /limiting requests/],
    ['serviceUnavailable', /服务暂时不可用/, /temporarily unavailable/]
  ];
  for (const language of ['zh-CN', 'en-US']) for (const [code, zh, en] of errors) {
    const app = assistantAuditHarness([], 'deepseek');
    const state = app.ctx.CampusCore.emptyState();
    Object.assign(state.settings, { aiProvider: 'deepseek', language, setupWizardCompleted: true });
    app.receive({ type: 'state', state });
    app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'stored' });
    const request = app.last('assistantListModels');
    app.receive({ type: 'assistantModels', provider: 'deepseek', requestId: request.requestId, errorCode: code });
    const pattern = language === 'zh-CN' ? zh : en;
    assert.match(app.node('content').innerHTML, pattern);
    app.input('assistant-question', 'Retain this request');
    app.click({ action: 'assistant-send' });
    assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 0);
    assert.equal(app.node('assistant-question').value, 'Retain this request');
    app.click({ action: 'assistant-refresh-models', provider: 'deepseek' });
    confirmDeepSeekModels(app);
    const editor = app.node('assistant-question'); editor.focus();
    app.click({ action: 'assistant-send' });
    app.receive({ type: 'assistantResponse', requestId: app.last('assistantRequest').requestId, errorCode: code });
    assert.equal(app.node('assistant-question'), editor);
    assert.equal(editor.value, 'Retain this request');
    assert.match(app.node('assistant-chat-log').innerHTML, pattern);
    assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 1);
    app.click({ action: 'assistant-send' });
    app.input('assistant-question', 'A newer draft');
    app.receive({ type: 'assistantResponse', requestId: app.last('assistantRequest').requestId, errorCode: code });
    assert.equal(editor.value, 'A newer draft', 'failure must not overwrite a newer question');
    assert.equal(app.sent.filter(row => row.action === 'assistantSaveDeepSeekKey').length, 0);
    app.click({ page: 'settings' });
    assert.doesNotMatch(app.node('content').innerHTML, /id="assistant-deepseek-key"/, 'non-credential errors preserve the saved-key UI');
  }
});

test('Ollama lists only discovered installed models and ignores stale model-list replies', () => {
  const app = harness({ hash: '#settings', themeEdition: true });
  const state = app.ctx.CampusCore.emptyState();
  state.settings.setupWizardCompleted = true;
  state.settings.aiProvider = 'ollama';
  state.settings.aiOllamaModel = 'legacy-unlisted-model';
  app.receive({ type: 'state', state });
  assert.equal(app.node('assistant-ollama-model').tagName, 'SELECT');
  assert.deepEqual(assistantModelOptions(app, 'assistant-ollama-model'), []);
  assert.doesNotMatch(app.node('content').innerHTML, /<input\b[^>]*id="assistant-ollama-model"/);
  const first = app.last('assistantListModels');
  assert.equal(first.provider, 'ollama');
  app.click({ action: 'assistant-refresh-models', provider: 'ollama' });
  assert.equal(app.sent.filter(row => row.action === 'assistantListModels').length, 1, 'refresh clicks must not duplicate a pending lookup');
  app.receive({ type: 'assistantModels', provider: 'ollama', requestId: first.requestId, models: ['qwen3:8b', 'llama3.2', 'qwen3:8b'] });
  assert.deepEqual(assistantModelOptions(app, 'assistant-ollama-model'), ['qwen3:8b', 'llama3.2']);
  assert.equal(app.last('saveState').state.settings.aiOllamaModel, 'qwen3:8b', 'an unavailable saved model is replaced by an installed model');
  app.change('assistant-ollama-model', { value: 'llama3.2' });
  assert.equal(app.last('saveState').state.settings.aiOllamaModel, 'llama3.2');
  const saves = app.sent.filter(row => row.action === 'saveState').length;
  app.change('assistant-ollama-model', { value: 'not-installed' });
  assert.equal(app.sent.filter(row => row.action === 'saveState').length, saves);
  app.click({ action: 'assistant-refresh-models', provider: 'ollama' });
  const latest = app.last('assistantListModels');
  assert.notEqual(latest.requestId, first.requestId);
  app.receive({ type: 'assistantModels', provider: 'ollama', requestId: first.requestId, models: ['stale-model'] });
  assert.deepEqual(assistantModelOptions(app, 'assistant-ollama-model'), ['qwen3:8b', 'llama3.2']);
  app.receive({ type: 'assistantModels', provider: 'ollama', requestId: latest.requestId, models: ['llama3.2', 'newly-installed:small'] });
  assert.deepEqual(assistantModelOptions(app, 'assistant-ollama-model'), ['llama3.2', 'newly-installed:small']);
  assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 0);
  app.click({ page: 'assistant' });
  app.input('assistant-question', 'Use my installed model');
  app.click({ action: 'assistant-send' });
  assert.equal(app.last('assistantRequest').model, 'llama3.2');
});

test('empty or unavailable Ollama model lists show recovery guidance and never trigger chat sends', () => {
  const app = harness({ hash: '#settings', themeEdition: true });
  const state = app.ctx.CampusCore.emptyState();
  state.settings.setupWizardCompleted = true;
  state.settings.aiProvider = 'ollama';
  app.receive({ type: 'state', state });
  app.receive({ type: 'assistantModels', provider: 'ollama', requestId: app.last('assistantListModels').requestId, models: [] });
  assert.deepEqual(assistantModelOptions(app, 'assistant-ollama-model'), []);
  assert.equal(app.node('assistant-ollama-model').attributes.disabled, '');
  assert.match(app.node('content').innerHTML, /Ollama 中还没有模型|No models are installed in Ollama/);
  app.click({ page: 'assistant' });
  app.input('assistant-question', 'Wait for an installed model');
  app.click({ action: 'assistant-send' });
  assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 0);
  assert.equal(app.node('assistant-question').value, 'Wait for an installed model');
  app.click({ page: 'settings' });
  app.click({ action: 'assistant-refresh-models', provider: 'ollama' });
  app.receive({ type: 'assistantModels', provider: 'ollama', requestId: app.last('assistantListModels').requestId, errorCode: 'localUnavailable' });
  assert.match(app.node('content').innerHTML, /启动 Ollama.*安装模型.*刷新|Start Ollama, install a model, then refresh/);
  assert.deepEqual(assistantModelOptions(app, 'assistant-ollama-model'), []);
  assert.equal(app.sent.filter(row => row.action === 'assistantListModels').length, 2, 'failed discovery waits for another explicit refresh');
  assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 0);
});

test('setup guides are collapsed, bilingual, and available before choosing a provider', () => {
  for (const language of ['zh-CN', 'en-US']) {
    for (const provider of ['off', 'ollama', 'deepseek', 'hybrid']) {
      const app = harness({ hash: '#settings', themeEdition: true });
      const state = app.ctx.CampusCore.emptyState();
      Object.assign(state.settings, { language, aiProvider: provider, setupWizardCompleted: true });
      app.receive({ type: 'state', state });
      for (const id of ['assistant-guide-deepseek', 'assistant-guide-ollama']) {
        assert.equal(app.node(id).tagName, 'DETAILS');
        assert.equal(app.node(id).open, false);
      }
      const html = app.node('content').innerHTML;
      const guide = html.match(/<section class="assistant-setup-guides"[\s\S]*?<\/section>/)[0];
      assert.match(guide, /ollama pull qwen3\.5:4b/);
      assert.match(guide, /ollama pull qwen3\.5:9b/);
      assert.match(guide, /ollama ls/);
      assert.match(guide, /401.*402/);
      assert.doesNotMatch(guide, /data-action="assistant-(?:save-key|delete-key|send|edit-key)"/);
      if (language === 'en-US') assert.doesNotMatch(guide, /[\u4e00-\u9fff]/);
      else assert.match(guide, /已显示“密钥已安全保存”时无需重填/);
      assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 0);
    }
  }
  assert.doesNotMatch(harness({ hash: '#settings' }).node('content').innerHTML, /assistant-setup-guides/);
});

test('open setup guides and key drafts survive model and key-status refreshes', () => {
  const app = harness({ hash: '#settings', themeEdition: true });
  const state = app.ctx.CampusCore.emptyState();
  Object.assign(state.settings, { aiProvider: 'hybrid', setupWizardCompleted: true });
  app.receive({ type: 'state', state });
  app.node('assistant-guide-deepseek').open = true;
  app.node('assistant-guide-ollama').open = true;
  app.input('assistant-deepseek-key', 'synthetic-key-draft');
  app.node('assistant-deepseek-key').focus();
  app.receive({ type: 'assistantModels', provider: 'ollama', requestId: app.last('assistantListModels').requestId, models: ['qwen3.5:9b'] });
  assert.equal(app.node('assistant-guide-deepseek').open, true);
  assert.equal(app.node('assistant-guide-ollama').open, true);
  assert.equal(app.node('assistant-deepseek-key').value, 'synthetic-key-draft');
  app.blur('assistant-deepseek-key');
  app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'stored' });
  assert.equal(app.node('assistant-guide-deepseek').open, true);
  assert.equal(app.node('assistant-guide-ollama').open, true);
  assert.doesNotMatch(app.node('content').innerHTML, /id="assistant-deepseek-key"/);
});

test('tutorial links and command copies use matching native allowlists, never arbitrary input', () => {
  const app = harness({ hash: '#settings', themeEdition: true });
  const swift = fs.readFileSync(path.join(root, 'Sources/AssistantSetupGuide.swift'), 'utf8');
  const html = app.node('content').innerHTML;
  for (const [id, value] of [...swift.matchAll(/"([\w-]+)": "([^"\n]+)"/g)].map(match => [match[1], match[2]])) {
    assert.match(html, new RegExp('data-guide-id="' + id + '"'));
    const isLink = value.startsWith('https://');
    app.click({ action: isLink ? 'assistant-guide-link' : 'assistant-guide-copy', guideId: id });
    assert.deepEqual(app.last(isLink ? 'assistantOpenGuide' : 'assistantCopyGuideCommand'), { action: isLink ? 'assistantOpenGuide' : 'assistantCopyGuideCommand', id });
    if (!isLink) assert.ok(html.includes(value), 'copied command must exactly match visible command');
  }
  const count = app.sent.length;
  for (const id of ['__proto__', 'constructor', 'https://example.com/', 'qwen-small; touch unsafe']) {
    app.click({ action: 'assistant-guide-link', guideId: id });
    app.click({ action: 'assistant-guide-copy', guideId: id });
  }
  assert.equal(app.sent.length, count);
  assert.equal(app.sent.filter(row => /assistant(?:Request|SaveDeepSeekKey|DeleteDeepSeekKey)/.test(row.action)).length, 0);
  const original = harness({ hash: '#settings' });
  original.click({ action: 'assistant-guide-link', guideId: 'deepseek-platform' });
  original.click({ action: 'assistant-guide-copy', guideId: 'qwen-small' });
  assert.equal(original.last('assistantOpenGuide'), undefined);
  assert.equal(original.last('assistantCopyGuideCommand'), undefined);
});

test('tutorial web preview opens only official links and reports clipboard failures honestly', async () => {
  const app = harness({ hash: '#settings', themeEdition: true, native: false });
  app.click({ action: 'assistant-guide-link', guideId: 'ollama-download' });
  assert.deepEqual(app.opened.at(-1), ['https://ollama.com/download/mac', '_blank', 'noopener,noreferrer']);
  const copied = [];
  app.ctx.navigator.clipboard = { writeText: async text => copied.push(text) };
  app.click({ action: 'assistant-guide-copy', guideId: 'qwen-standard' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(copied, ['ollama pull qwen3.5:9b']);
  assert.match(app.node('toast').textContent, /命令已复制|Command copied/);
  app.ctx.navigator.clipboard = { writeText: async () => { throw new Error('denied'); } };
  app.click({ action: 'assistant-guide-copy', guideId: 'list-models' });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(app.node('toast').textContent, /未能复制|Could not copy/);
});

test('stored DeepSeek keys show a saved status instead of asking for another save', () => {
  const app = harness({ hash: '#settings', themeEdition: true });
  const state = app.ctx.CampusCore.emptyState();
  state.settings.setupWizardCompleted = true;
  state.settings.aiProvider = 'deepseek';
  app.receive({ type: 'state', state });
  app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'stored' });
  assert.doesNotMatch(app.node('content').innerHTML, /id="assistant-deepseek-key"|data-action="assistant-save-key"/);
  assert.match(app.node('content').innerHTML, /data-action="assistant-edit-key"/);
  app.click({ action: 'assistant-edit-key' });
  assert.match(app.node('content').innerHTML, /id="assistant-deepseek-key"/);
  app.click({ action: 'assistant-cancel-key-edit' });
  assert.doesNotMatch(app.node('content').innerHTML, /id="assistant-deepseek-key"/);
  assert.equal(app.sent.filter(row => row.action === 'assistantSaveDeepSeekKey').length, 0);
});

test('DeepSeek key recovery is explicit, single-flight, preserves drafts and never auto-sends', () => {
  const app = harness({ hash: '#assistant', themeEdition: true });
  const state = app.ctx.CampusCore.emptyState();
  state.settings.setupWizardCompleted = true;
  state.settings.aiProvider = 'deepseek';
  app.receive({ type: 'state', state });
  app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'locked' });
  assert.equal(app.sent.filter(row => row.action === 'assistantRestoreDeepSeekKey').length, 0);
  app.input('assistant-question', '恢复后保留我的问题');
  app.click({ action: 'assistant-restore-key' });
  app.click({ action: 'assistant-restore-key' });
  assert.equal(app.sent.filter(row => row.action === 'assistantRestoreDeepSeekKey').length, 1);
  app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'locked', notice: 'keyRecoveryFinished', errorCode: 'keyAccess' });
  assert.equal(app.node('assistant-question').value, '恢复后保留我的问题');
  app.click({ action: 'assistant-restore-key' });
  assert.equal(app.sent.filter(row => row.action === 'assistantRestoreDeepSeekKey').length, 2);
  app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'stored', notice: 'keyRestored' });
  assert.equal(app.node('assistant-question').value, '恢复后保留我的问题');
  assert.doesNotMatch(app.node('content').innerHTML, /data-action="assistant-restore-key"/);
  assert.equal(app.sent.filter(row => row.action === 'assistantSaveDeepSeekKey' || row.action === 'assistantRequest').length, 0);
});

test('key-status and model-list updates preserve focused credential input and a focused question', () => {
  const app = harness({ hash: '#settings', themeEdition: true });
  const state = app.ctx.CampusCore.emptyState();
  state.settings.setupWizardCompleted = true;
  state.settings.aiProvider = 'deepseek';
  app.receive({ type: 'state', state });
  app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'stored' });
  app.click({ action: 'assistant-edit-key' });
  const keyInput = app.node('assistant-deepseek-key');
  keyInput.focus();
  app.input('assistant-deepseek-key', 'synthetic-unsaved-key-draft');
  keyInput.setSelectionRange(7, 13);
  app.receive({ type: 'assistantModels', provider: 'deepseek', requestId: app.last('assistantListModels').requestId, models: ['deepseek-flash', 'deepseek-v4-pro'] });
  app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'locked' });
  assert.equal(app.node('assistant-deepseek-key'), keyInput);
  assert.equal(app.ctx.document.activeElement, keyInput);
  assert.equal(keyInput.value, 'synthetic-unsaved-key-draft');
  assert.equal(keyInput.selectionStart, 7);
  assert.equal(keyInput.selectionEnd, 13);
  assert.equal(JSON.stringify(app.sent.filter(row => row.action === 'saveState')).includes('synthetic-unsaved-key-draft'), false);
  app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'stored' });
  app.click({ action: 'assistant-refresh-models', provider: 'deepseek' });
  const refresh = app.last('assistantListModels');
  app.click({ page: 'assistant' });
  const question = app.node('assistant-question');
  question.focus();
  app.input('assistant-question', '模型列表更新时不要打断这句话');
  question.setSelectionRange(4, 9);
  app.receive({ type: 'assistantModels', provider: 'deepseek', requestId: refresh.requestId, models: ['deepseek-v4-pro'] });
  app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'stored' });
  assert.equal(app.node('assistant-question'), question);
  assert.equal(app.ctx.document.activeElement, question);
  assert.equal(question.value, '模型列表更新时不要打断这句话');
  assert.equal(question.selectionStart, 4);
  assert.equal(question.selectionEnd, 9);
  assert.equal(app.last('saveState').state.settings.aiModel, 'deepseek-v4-pro');
  assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 0);
});

test('school sign-in from the setup wizard keeps the wizard open on the same step', () => {
  const app = harness({ themeEdition: true });
  const themeState = app.ctx.CampusCore.emptyState();
  themeState.settings.setupWizardStep = 2;
  app.receive({ type: 'state', state: themeState });
  assert.equal(app.node('setup-wizard-dialog').open, true);
  assert.match(app.node('setup-wizard-content').innerHTML, /连接 ManageBac/);

  app.click({ action: 'setup-wizard-connect', source: 'managebac' });
  assert.equal(app.node('setup-wizard-dialog').open, true);
  assert.match(app.node('setup-wizard-content').innerHTML, /连接 ManageBac/);
  assert.equal(app.last('connectSchool').source, 'managebac');

  app.receive({ type: 'status', source: 'managebac', message: '登录成功', busy: false });
  app.receive({ type: 'snapshot', snapshot: { source: 'managebac', url: 'https://example-school.managebac.cn/', capturedAt: '2026-09-26T02:00:00Z', coverage: 'complete', warnings: [], grades: [], tasks: [], feedback: [] } });
  assert.equal(app.node('setup-wizard-dialog').open, true);
  assert.match(app.node('setup-wizard-content').innerHTML, /连接 ManageBac/);
});
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
  assert.match(app.node('content').innerHTML, /board-task-columns/);
  assert.match(app.node('content').innerHTML, /board-task-grid/);
  assert.match(app.node('content').innerHTML, /data-todo-countdown/);
  assert.match(app.node('class-clock-detail').textContent, /下节 English · 08:50–09:30/);
  app.click({ action: 'appearance-settings' });
  assert.match(app.node('content').innerHTML, /经典面板/);
  app.click({ action: 'dashboard-theme', theme: 'classic' });
  assert.equal(app.node('app-shell').dataset.dashboardTheme, 'classic');
  app.click({ page: 'overview' });
  assert.match(app.node('content').innerHTML, /今天，也有条不紊/);
});

test('color presets are independent of dashboard layout and keep English labels complete', () => {
  const app = harness();
  app.click({ page: 'settings' });
  assert.match(app.node('content').innerHTML, /主题配色/);
  app.click({ action: 'color-theme', theme: 'ocean' });
  assert.equal(app.node('app-shell').dataset.colorTheme, 'ocean');
  assert.equal(app.node('app-shell').dataset.dashboardTheme, 'classic');
  assert.equal(app.ctx.document.documentElement.dataset.colorTheme, 'ocean');
  assert.match(app.node('content').innerHTML, /清晰的冷调蓝色主题/);
  assert.match(app.node('content').innerHTML, /<option value="red-up" selected>/);
  app.click({ action: 'dashboard-theme', theme: 'board' });
  assert.equal(app.node('app-shell').dataset.colorTheme, 'ocean');
  assert.equal(app.node('app-shell').dataset.dashboardTheme, 'board');
  app.change('app-language', { value: 'en-US' });
  assert.match(app.node('content').innerHTML, /Color theme/);
  assert.match(app.node('content').innerHTML, /A low-luminance dark theme/);
  assert.doesNotMatch(app.node('content').innerHTML, /自然、柔和|清晰的冷调|低亮度深色/);
  app.click({ action: 'color-theme', theme: 'midnight' });
  assert.equal(app.node('app-shell').dataset.colorTheme, 'midnight');
  assert.equal(app.node('app-shell').dataset.dashboardTheme, 'board');
  app.click({ action: 'color-theme', theme: 'sage' });
  assert.equal(app.node('app-shell').dataset.colorTheme, 'sage');
  assert.equal(app.node('app-shell').dataset.dashboardTheme, 'board');
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
  assert.match(app.node('content').innerHTML, /todo-source-teams/);
  assert.match(app.node('content').innerHTML, /Open website/);
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
  assert.match(app.node('content').innerHTML, /<strong>3\.20<\/strong>/);
  app.click({ page: 'grades' });
  assert.match(app.node('content').innerHTML, />3\.20</);
  assert.match(app.node('content').innerHTML, />3\.70</);
  assert.match(app.node('content').innerHTML, /线性折算 GPA/);
  assert.match(app.node('content').innerHTML, />3\.40</);
  assert.match(app.node('content').innerHTML, /<th>线性绩点<\/th>/);
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

test('overview preserves source and subject groups while tasks retain deadline cards and focus controls', () => {
  const app = harness(); app.receive({ type: 'snapshot', snapshot: teamsSnapshot([task(), task({ id: 'math-work', title: 'Math work', course: 'Math' })]) }); app.receive({ type: 'snapshot', snapshot: { source: 'managebac', url: 'https://example-school.managebac.cn/tasks', capturedAt: '2026-09-19T00:42:00Z', warnings: [], courses: [], tasks: [{ id: 'biology-work', title: 'Biology work', course: 'Biology', dueAt: null, dueLabel: '', status: 'open', url: 'https://example-school.managebac.cn/tasks' }], feedback: [], officialGPA: null } });
  app.flushTimeouts();
  assert.match(app.node('content').innerHTML, /task-source-grid/); assert.match(app.node('content').innerHTML, /task-source-teams/); assert.match(app.node('content').innerHTML, /task-source-managebac/);
  assert.match(app.node('content').innerHTML, /task-subject-group/);
  app.click({ page: 'settings' }); app.click({ action: 'dashboard-theme', theme: 'board' }); app.click({ page: 'overview' });
  assert.match(app.node('content').innerHTML, /board-task-columns/); assert.match(app.node('content').innerHTML, /task-source-teams/); assert.match(app.node('content').innerHTML, /task-source-managebac/);
  assert.match(app.node('content').innerHTML, /task-subject-group/);
  assert.match(app.node('content').innerHTML, /board-due-card/);
  assert.match(app.node('content').innerHTML, /data-todo-countdown/);
  assert.match(app.node('content').innerHTML, /todo-urgency-bar/);
  assert.doesNotMatch(app.node('content').innerHTML, /todo-deadline-grid/);
  app.click({ page: 'tasks' });
  assert.match(app.node('content').innerHTML, /todo-deadline-grid/); assert.match(app.node('content').innerHTML, /English/); assert.match(app.node('content').innerHTML, /Math/); assert.match(app.node('content').innerHTML, /Biology/);
  app.click({ action: 'toggle-focus-subject', value: 'English' });
  assert.deepEqual(app.last('saveState').state.settings.focusSubjects, ['English']);
  app.click({ action: 'task-subject-filter', filter: 'focus' }); assert.match(app.node('content').innerHTML, /English/); assert.doesNotMatch(app.node('content').innerHTML, /Math work/);
  app.click({ page: 'teams' });
  assert.match(app.node('content').innerHTML, /发件人：Teacher/); assert.match(app.node('content').innerHTML, /HOMEWORK/);
  app.click({ action: 'toggle-focus-channel', value: 'HOMEWORK' });
  assert.deepEqual(app.last('saveState').state.settings.focusTeamsChannels, ['HOMEWORK']);
  app.click({ action: 'teams-channel-filter', filter: 'focus' }); assert.match(app.node('content').innerHTML, /HOMEWORK/); assert.doesNotMatch(app.node('content').innerHTML, /ENGLISH CORNER ROSTER/);
});

test('quick connection saves only the school origin and waits for persistence before opening sign-in', () => {
  const app = harness({ hash: '#settings' });
  app.receive({ type: 'schoolConfiguration', config: { seiue: '', managebac: 'https://example-school.managebac.cn/' } });
  app.click({ action: 'connect-source', source: 'seiue' });
  assert.equal(app.node('quick-connect-dialog').open, true);
  app.input('quick-connect-url', 'https://new-school.seiue.com/login?next=/timetable');
  app.receive({ type: 'snapshot', snapshot: teamsSnapshot() });
  assert.equal(app.node('quick-connect-url').value, 'https://new-school.seiue.com/login?next=/timetable');
  app.submit('quick-connect-form');
  assert.deepEqual(app.last('saveSchoolConfiguration').config, { seiue: 'https://new-school.seiue.com/', managebac: 'https://example-school.managebac.cn/' });
  assert.equal(app.last('connectSchool'), undefined);
  app.receive({ type: 'schoolConfiguration', config: app.last('saveSchoolConfiguration').config, saved: true });
  assert.equal(app.last('connectSchool').source, 'seiue');
  assert.equal(app.node('quick-connect-dialog').open, false);
});

test('quick connection rejects unrelated hosts and allows retry after a failed save', () => {
  const app = harness({ hash: '#settings' });
  app.click({ action: 'connection-options', source: 'managebac' });
  for (const invalid of ['https://managebac.cn.evil.invalid/', 'http://school.managebac.cn/', 'https://user:pass@school.managebac.cn/']) {
    app.input('quick-connect-url', invalid); app.submit('quick-connect-form');
    assert.equal(app.last('saveSchoolConfiguration'), undefined);
  }
  app.input('quick-connect-url', 'new-school.managebac.cn/student/home'); app.submit('quick-connect-form');
  app.receive({ type: 'schoolConfigurationError' });
  assert.equal(app.last('connectSchool'), undefined);
  assert.equal(app.node('quick-connect-submit').disabled, false);
  app.submit('quick-connect-form');
  assert.equal(app.sent.filter(item => item.action === 'saveSchoolConfiguration').length, 2);
});

test('canceling a pending quick connection does not launch a login window when saving completes', () => {
  const app = harness({ hash: '#settings' });
  app.click({ action: 'connection-options', source: 'seiue' });
  app.input('quick-connect-url', 'new-school.seiue.com'); app.submit('quick-connect-form');
  app.click({ action: 'close-quick-connect' });
  app.receive({ type: 'schoolConfiguration', config: app.last('saveSchoolConfiguration').config, saved: true });
  assert.equal(app.last('connectSchool'), undefined);
});

test('configured school sign-in is one click and does not rewrite school configuration', () => {
  const app = harness({ hash: '#settings' });
  app.click({ action: 'connect-source', source: 'managebac' });
  assert.deepEqual(app.last('connectSchool'), { action: 'connectSchool', source: 'managebac' });
  assert.equal(app.last('saveSchoolConfiguration'), undefined);
  app.click({ action: 'sync-school', source: 'seiue' });
  assert.deepEqual(app.last('syncSchool'), { action: 'syncSchool', source: 'seiue' });
});

test('Teams quick connection requires consent and saves the selected browser before opening sign-in', () => {
  const app = harness({ hash: '#settings' });
  app.click({ action: 'connection-options', source: 'teams' });
  app.node('quick-connect-consent').checked = false; app.submit('quick-connect-form');
  assert.equal(app.last('teams-auto-login'), undefined);
  app.node('quick-connect-consent').checked = true;
  app.node('quick-connect-browser').value = 'edge'; app.submit('quick-connect-form');
  const settings = app.last('saveState').state.settings;
  assert.equal(settings.teamsBrowser, 'edge'); assert.equal(settings.teamsBrowserAutomation, true); assert.equal(settings.teamsAutoDiscover, true);
  assert.ok(app.last('teams-auto-login'));
  app.receive({ type: 'teamsAutoStatus', running: true, phase: 'attachments', message: 'Reading' });
  const before = app.sent.filter(item => item.action === 'teams-auto-login').length;
  app.click({ action: 'connect-source', source: 'teams' });
  assert.equal(app.sent.filter(item => item.action === 'teams-auto-login').length, before + 1);
});

test('quick connection dialog is fully English when English is selected', () => {
  const app = harness({ hash: '#settings' });
  app.change('app-language', { value: 'en-US' });
  app.click({ action: 'connection-options', source: 'seiue' });
  assert.match(app.node('quick-connect-content').innerHTML, /Quick connect/);
  assert.doesNotMatch(app.node('quick-connect-content').innerHTML, /[\u3400-\u9fff]/);
  app.click({ action: 'close-quick-connect' });
  app.click({ action: 'connection-options', source: 'teams' });
  assert.doesNotMatch(app.node('quick-connect-content').innerHTML, /[\u3400-\u9fff]/);
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

test('Teams reminder subjects can be filtered and restored without changing assignment data', () => {
  const app = harness();
  app.receive({ type: 'snapshot', snapshot: teamsSnapshot([
    task({ id: 'english', title: 'English essay', course: 'English' }),
    task({ id: 'chemistry', title: 'Chemistry lab', course: 'Chemistry' })
  ]) });
  app.click({ page: 'settings' });
  app.change('teams-notifications', { checked: true });
  assert.equal(app.last('syncReminders').items.length, 2);
  assert.match(app.node('content').innerHTML, /提醒学科/);
  app.change('reminder-subject-choice-0', { checked: false });
  assert.deepEqual(app.last('saveState').state.settings.reminderSubjects, ['English']);
  assert.deepEqual(app.last('syncReminders').items.map(item => item.title), ['English essay']);
  app.click({ action: 'reminder-subjects-all' });
  assert.deepEqual(app.last('saveState').state.settings.reminderSubjects, []);
  assert.equal(app.last('syncReminders').items.length, 2);
  assert.equal(app.ctx.CampusCore.getTasks(app.last('saveState').state).filter(item => item.source === 'teams').length, 2);
  app.change('app-language', { value: 'en-US' });
  assert.match(app.node('content').innerHTML, /Reminder subjects/);
  assert.match(app.node('content').innerHTML, /Include all subjects/);
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
  assert.match(html, /todo-band-urgent todo-source-teams/);
  assert.match(html, /todo-band-overdue todo-source-teams/);
  assert.match(html, /todo-band-unknown todo-source-teams/);
  assert.match(html, /class="todo-due-date"><svg/);
  assert.match(html, /截止时间未标明/);
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
  event.accountId='account-1'; app.receive(event); app.flushTimeouts();
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
  app.receive({ type: 'graphStatus', configured: true, connected: true, busy: false, coverage: 'complete' });
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

test('manual to-do deadline accepts a separate typed 24-hour time in Beijing time', () => {
  const app = harness();
  app.click({ action: 'add-task' });
  assert.equal(app.node('task-due-date').value, '');
  assert.equal(app.node('task-due-time').value, '');
  app.node('task-title').value = 'Prepare notes';
  app.node('task-due-date').value = '2026-09-28';
  app.node('task-due-time').value = '18:30';
  app.submit('task-form');
  assert.equal(app.last('saveState').state.manualTasks[0].dueAt, '2026-09-28T10:30:00.000Z');
  app.click({ action: 'add-task' });
  app.node('task-title').value = 'Default late deadline';
  app.node('task-due-date').value = '2026-09-29';
  app.submit('task-form');
  assert.equal(app.last('saveState').state.manualTasks[1].dueAt, '2026-09-29T15:59:00.000Z');
});

test('manual to-do rejects invalid dates and times without saving a partial task', () => {
  const app = harness();
  app.click({ action: 'add-task' });
  app.node('task-title').value = 'Invalid deadline';
  app.node('task-due-date').value = '2026-09-28';
  app.node('task-due-time').value = '25:00';
  app.submit('task-form');
  assert.equal(app.last('saveState'), undefined);
  assert.equal(app.node('task-dialog').open, true);
  app.node('task-due-time').value = '18:75';
  app.submit('task-form');
  assert.equal(app.last('saveState'), undefined);
  app.node('task-due-date').value = '2026-02-30';
  app.node('task-due-time').value = '09:05';
  app.submit('task-form');
  assert.equal(app.last('saveState'), undefined);
  app.node('task-due-date').value = '';
  app.submit('task-form');
  assert.equal(app.last('saveState'), undefined);
  assert.match(app.node('task-form-error').textContent, /同时选择截止日期/);
  app.node('task-due-time').value = '';
  app.submit('task-form');
  assert.equal(app.last('saveState').state.manualTasks[0].dueAt, null);
});

test('Teams teacher feedback opens the Teams source and never renders as ManageBac content', () => {
  const app = harness({ hash: '#feedback' });
  app.receive({ type: 'graphBatch', batchId: 'assignment-feedback', batch: { kind: 'assignment', capturedAt: '2026-09-19T00:41:00Z', class: { id: 'class-id', displayName: 'English' }, userId: 'me', assignment: {
    id: 'assignment-id', displayName: 'Essay', webUrl: 'https://teams.microsoft.com/l/entity/assignments/essay', instructions: { contentType: 'html', content: '<p>Use evidence.</p>' },
    submissions: [{ id: 'submission-id', status: 'returned', recipient: { userId: 'me' }, outcomes: [{ id: 'outcome-id', publishedFeedback: { text: { contentType: 'text', content: 'Explain your evidence more clearly.' }, feedbackBy: { user: { displayName: 'Teacher' } }, feedbackDateTime: '2026-09-19T00:20:00Z' } }] }]
  } } });
  assert.equal(app.last('graphBatchFailed'), undefined, JSON.stringify(app.sent.filter(item => item.action === 'graphBatchFailed')));
  app.receive({ type: 'graphStatus', configured: true, connected: true, busy: false });
  assert.match(app.node('content').innerHTML, /Explain your evidence more clearly/);
  assert.match(app.node('content').innerHTML, /Teams · English/);
  assert.match(app.node('content').innerHTML, /data-source="teams" data-url="https:\/\/teams.microsoft.com\/l\/entity\/assignments\/essay"/);
});

test('backup import resets native account affinity only after accepting and acknowledging the import', () => {
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
  const pending = app.last('saveState');
  assert.match(pending.importRequestId, /^import-/);
  app.receive({ type: 'importResult', requestId: pending.importRequestId, success: true, state: pending.state });
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
  app.flushTimeouts();
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
  app.flushTimeouts();
  const item=Object.values(app.last('saveState').state.snapshots.teams)[0].posts[0].attachments[0];
  assert.equal(item.versionKey,'v1:abcdef0123456789');assert.equal(item.capturedAt,'2026-09-18T02:00:00.000Z');assert.equal(item.cached,true);assert.equal(item.truncated,true);assert.equal(item.text,'Student Alice\n张同学');assert.match(app.node('content').innerHTML,/缓存文字/);
});

test('sync bursts persist every snapshot but coalesce page rendering to the newest state', () => {
  const app = harness();
  const savedBefore = app.sent.filter(item => item.action === 'saveState').length;
  for (let index = 0; index < 8; index++) {
    app.receive({ type: 'snapshot', snapshot: teamsSnapshot([task({title: 'Newest task ' + index})]) });
    if (index === 0) app.firstSyncWrites = app.node('content').writes;
  }
  assert.equal(app.sent.filter(item => item.action === 'saveState').length - savedBefore, 8, 'no persistence is debounced or dropped');
  assert.equal(app.node('content').writes, app.firstSyncWrites, 'burst does not rebuild the page eight times');
  app.flushTimeouts();
  assert.equal(app.node('content').writes, app.firstSyncWrites + 1);
  assert.match(app.node('content').innerHTML, /Newest task 7/);
});

test('hidden windows and an open task editor defer sync painting and reveal the latest saved data', () => {
  const app = harness();
  const initial = app.node('content').writes;
  app.receive({ type: 'windowVisibility', visible: false });
  app.receive({ type: 'snapshot', snapshot: teamsSnapshot([task({title: 'Hidden update'})]) });
  app.tick(1000); app.flushTimeouts();
  assert.equal(app.node('content').writes, initial);
  assert.match(JSON.stringify(app.last('saveState')), /Hidden update/);
  app.receive({ type: 'windowVisibility', visible: true });
  assert.match(app.node('content').innerHTML, /Hidden update/);
  app.click({action: 'add-task'});
  app.input('task-title', 'Keep my unsaved title');
  const writes = app.node('content').writes;
  app.receive({ type: 'snapshot', snapshot: teamsSnapshot([task({title: 'While editing'})]) });
  app.tick(1000); app.flushTimeouts();
  assert.equal(app.node('content').writes, writes);
  assert.equal(app.node('task-title').value, 'Keep my unsaved title');
  app.node('task-dialog').close(); app.tick(1000);
  assert.match(app.node('content').innerHTML, /While editing/);
});

test('clock cache expires each second and invalidates when the schedule is replaced', () => {
  const app = harness();
  app.receive({type: 'snapshot', snapshot: schedule()});
  assert.equal(app.node('class-clock-time').textContent, '08:32');
  app.tick(0); app.tick(0);
  assert.equal(app.node('class-clock-time').textContent, '08:32');
  app.tick(1000);
  assert.equal(app.node('class-clock-time').textContent, '08:31');
  app.receive({type: 'state', state: app.ctx.CampusCore.emptyState()});
  assert.equal(app.node('class-clock-label').textContent, '等待今日课表');
  assert.equal(app.node('class-clock-time').textContent, '—');
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

test('school calendar events appear on overview and the selected schedule day in both dashboard styles',()=>{
  for(const dashboardTheme of ['classic','board']) {
    const app=harness({hash:'#overview'}),state=app.ctx.CampusCore.emptyState();
    state.settings.dashboardTheme=dashboardTheme;
    state.schoolCalendar=app.ctx.CampusCore.parseSchoolCalendarICS('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:today\nDTSTART;TZID=Asia/Shanghai:20260919T103000\nDTEND;TZID=Asia/Shanghai:20260919T113000\nSUMMARY:Assembly\nLOCATION:Hall A\nEND:VEVENT\nEND:VCALENDAR','school.ics','Asia/Shanghai');
    app.receive({type:'state',state});
    assert.match(app.node('content').innerHTML,/Assembly/);
    assert.match(app.node('content').innerHTML,/10:30/);
    app.click({page:'schedule'});
    assert.match(app.node('content').innerHTML,/data-action="import-school-calendar"/);
    assert.match(app.node('content').innerHTML,/Hall A/);
  }
});

test('school calendar file selection imports locally, persists the events, and rerenders today',async()=>{
  const app=harness({hash:'#overview'}),input=app.node('school-calendar-file');
  input.files=[{name:'school.ics',type:'text/calendar',size:120,text:async()=>'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:local\nDTSTART;TZID=Asia/Shanghai:20260919T130000\nDTEND;TZID=Asia/Shanghai:20260919T140000\nSUMMARY:Local event\nEND:VEVENT\nEND:VCALENDAR'}];
  await input.events.change({target:input});
  assert.equal(app.last('saveState').state.schoolCalendar.fileName,'school.ics');
  assert.equal(app.last('saveState').state.schoolCalendar.events[0].title,'Local event');
  assert.match(app.node('content').innerHTML,/Local event/);
  assert.equal(input.value,'');
});

test('imported calendar remains visible when the selected day has no events',()=>{
  const app=harness({hash:'#schedule'}); let state=app.ctx.CampusCore.emptyState();
  state.schoolCalendar=app.ctx.CampusCore.parseSchoolCalendarICS('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:later\nDTSTART;VALUE=DATE:20260925\nDTEND;VALUE=DATE:20260926\nSUMMARY:School holiday\nEND:VEVENT\nEND:VCALENDAR','school.ics','Asia/Shanghai');
  app.receive({type:'state',state});
  const html=app.node('content').innerHTML;
  assert.match(html,/已导入校历：school\.ics/);
  assert.match(html,/今天没有校历事件/);
});

test('calendar make-up day shows the weekday substitution without claiming school lessons were read',()=>{
  const app=harness({hash:'#schedule'}); let state=app.ctx.CampusCore.emptyState();
  state.schoolCalendar=app.ctx.CampusCore.parseSchoolCalendarPDFText('2026 年 9 月 校历\n安排明细\n1. 9 月 19 日（周六）补周二的课。','makeup.pdf',2026);
  app.receive({type:'state',state});
  const html=app.node('content').innerHTML;
  assert.match(html,/调休识别：每周自编课程按周二显示/);
  assert.match(html,/学校课程仍需希悦当天课表确认/);
});

test('calendar make-up day displays the date and count when borrowing a captured Seiue weekday timetable',()=>{
  const app=harness({hash:'#schedule'}); let state=app.ctx.CampusCore.emptyState();
  state.schoolCalendar=app.ctx.CampusCore.parseSchoolCalendarPDFText('2026 年 9 月 校历\n安排明细\n1. 9 月 19 日（周六）补周二的课。','makeup.pdf',2026);
  app.ctx.__scheduleSnapshot=JSON.stringify({source:'seiue',url:'https://example-school.seiue.com/timetable',capturedAt:'2026-09-18T00:00:00Z',warnings:[],schedule:[{id:'math',date:'2026-09-15',start:'08:00',end:'08:40',title:'数学',room:'201',teacher:'',isSelfStudy:false}]});
  app.ctx.__stateForTest=state; state=vm.runInContext('CampusCore.mergeSnapshot(__stateForTest, JSON.parse(__scheduleSnapshot))',app.ctx);
  app.receive({type:'state',state});
  assert.match(app.node('content').innerHTML,/按 2026-09-15 的课表临时代入 1 节/);
  assert.match(app.node('content').innerHTML,/数学/);
});

test('calendar holiday explains why regular lessons are hidden',()=>{
  const app=harness({hash:'#schedule'}),state=app.ctx.CampusCore.emptyState();
  state.schoolCalendar=app.ctx.CampusCore.parseSchoolCalendarPDFText('2026 年 9 月 校历\n安排明细\n1. 9 月 19 日，学校放假。','holiday.pdf',2026);
  app.receive({type:'state',state});
  assert.match(app.node('content').innerHTML,/这一天的常规课程已按导入的校历隐藏/);
});

test('calendar holiday surfaces a conflict instead of silently hiding Seiue classes',()=>{
  const app=harness({hash:'#schedule'}); let state=app.ctx.CampusCore.emptyState();
  state.schoolCalendar=app.ctx.CampusCore.parseSchoolCalendarPDFText('2026 年 9 月 校历\n安排明细\n1. 9 月 19 日，学校放假。','holiday.pdf',2026);
  app.ctx.__scheduleSnapshot=JSON.stringify({source:'seiue',url:'https://example-school.seiue.com/timetable',capturedAt:'2026-09-18T00:00:00Z',warnings:[],schedule:[{id:'math',date:'2026-09-19',start:'08:00',end:'08:40',title:'数学',room:'201',teacher:'',isSelfStudy:false}]});
  app.ctx.__stateForTest=state; state=vm.runInContext('CampusCore.mergeSnapshot(__stateForTest, JSON.parse(__scheduleSnapshot))',app.ctx);
  app.receive({type:'state',state});
  assert.match(app.node('content').innerHTML,/数据冲突：希悦仍记录当天 1 节课/);
});

test('native PDF school calendar opens an editable event preview without importing unconfirmed rows',()=>{
  const app=harness({hash:'#schedule'});
  app.receive({type:'schoolCalendarPDF',fileName:'term.pdf',text:'2026 年 9 月 校历\n安排明细\n1. 9 月 25—27 日，秋季假期。'});
  assert.equal(app.node('calendar-preview-dialog').open,true);
  assert.match(app.node('calendar-preview-rows').innerHTML,/秋季假期/);
  assert.equal(app.node('calendar-date-0').value,'2026-09-25');
  assert.equal(app.node('calendar-end-0').value,'2026-09-27');
  assert.equal(app.sent.filter(row=>row.action==='saveState').length,0);
  app.click({action:'confirm-calendar-preview'});
  assert.equal(app.last('saveState').state.schoolCalendar.events[0].endDate,'2026-09-28');
  assert.equal(app.node('calendar-preview-dialog').open,false);
});

function assistantAuditHarness(categories = [], provider = 'ollama') {
  const app = harness({ themeEdition: true, hash: '#assistant' });
  const state = app.ctx.CampusCore.emptyState();
  Object.assign(state.settings, { setupWizardCompleted: true, setupWizardIntroVersion: '1.0.0', aiProvider: provider, aiContextCategories: categories });
  app.receive({ type: 'state', state });
  let requestSequence = 0;
  app.ctx.crypto.randomUUID = () => 'audit-request-' + (++requestSequence);
  return app;
}
function sendAuditQuestion(app, question) {
  const count = app.sent.filter(row => row.action === 'assistantRequest').length;
  app.input('assistant-question', question);
  app.click({ action: 'assistant-send' });
  assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, count + 1, 'each valid question dispatches exactly once');
  return app.last('assistantRequest');
}
function replyAuditQuestion(app, request, answer = 'Synthetic answer') {
  app.receive({ type: 'assistantResponse', requestId: request.requestId, answer, providerUsed: request.provider === 'ollama' ? 'ollama' : 'deepseek' });
}
function auditRequestContext(request) {
  const content = request.messages.at(-1).content;
  return JSON.parse(content.slice(content.indexOf('{')));
}

test('setup bounds each long alias and keeps exactly one active step across restart, close, and a new session', () => {
  const app = harness({ themeEdition: true });
  const state = app.ctx.CampusCore.emptyState();
  Object.assign(state.settings, { setupWizardCompleted: true, setupWizardIntroVersion: '1.0.0' });
  state.manualTasks.push({ id: 'keep', title: 'Keep this personal task', status: 'open', dueAt: null });
  app.receive({ type: 'state', state });
  app.click({ action: 'setup-wizard-restart' });
  assert.equal(app.last('saveState').state.settings.setupWizardCompleted, false, 'restart is persisted as an unfinished setup');
  const oneActive = target => {
    const html = target.node('setup-wizard-content').innerHTML;
    assert.equal((html.match(/class="setup-rail-item active"/g) || []).length, 1);
    assert.equal((html.match(/aria-current="step"/g) || []).length, 1);
  };
  oneActive(app);
  app.click({ action: 'setup-wizard-next' });
  app.input('setup-identity-names', '名'.repeat(150) + ', Other Name');
  app.click({ action: 'setup-wizard-next' });
  const saved = app.last('saveState').state;
  assert.equal(saved.settings.ecIdentityNames[0], '名'.repeat(100));
  assert.equal(saved.settings.ecIdentityNames[1], 'Other Name');
  assert.doesNotThrow(() => app.ctx.CampusCore.validateState(JSON.stringify(saved)), 'wizard must never save an alias rejected by Core');
  assert.equal(saved.settings.setupWizardStep, 2);
  oneActive(app);
  app.click({ action: 'setup-wizard-close' });
  const resumed = harness({ themeEdition: true });
  resumed.receive({ type: 'state', state: app.last('saveState').state });
  assert.equal(resumed.node('setup-wizard-dialog').open, true);
  assert.match(resumed.node('setup-wizard-content').innerHTML, /id="setup-wizard-title">连接 ManageBac<\/h1>/);
  oneActive(resumed);
  resumed.click({ action: 'setup-wizard-restart' });
  assert.match(resumed.node('setup-wizard-content').innerHTML, /欢迎使用/);
  for (let step = 0; step < 9; step++) { oneActive(resumed); resumed.click({ action: 'setup-wizard-next' }); }
  assert.equal(resumed.node('setup-wizard-dialog').open, false);
  assert.equal(resumed.last('saveState').state.settings.setupWizardCompleted, true);
  assert.equal(resumed.last('saveState').state.manualTasks[0].title, 'Keep this personal task');
});

test('changing assistant scope excludes hidden old data, old questions, and answers derived from that scope', () => {
  const app = assistantAuditHarness(['tasks']);
  app.receive({ type: 'snapshot', snapshot: teamsSnapshot([task({ requirements: 'PRIVATE_CONTEXT_MARKER' })]) });
  const first = sendAuditQuestion(app, 'PRIVATE_OLD_QUESTION');
  replyAuditQuestion(app, first, 'PRIVATE_DERIVED_ANSWER');
  app.click({ page: 'settings' });
  app.changeAttributes({ 'data-ai-context': 'tasks' }, { checked: false });
  app.click({ page: 'assistant' });
  const second = sendAuditQuestion(app, 'An unrelated question');
  assert.deepEqual(auditRequestContext(second), {});
  assert.equal(second.messages.length, 2);
  assert.doesNotMatch(JSON.stringify(second.messages), /PRIVATE_CONTEXT_MARKER|PRIVATE_OLD_QUESTION|PRIVATE_DERIVED_ANSWER/);
});

test('switching from local Ollama to DeepSeek starts fresh context even if selected categories stay unchanged', () => {
  const app = assistantAuditHarness([]);
  const local = sendAuditQuestion(app, 'LOCAL_PRIVATE_QUESTION');
  replyAuditQuestion(app, local, 'LOCAL_PRIVATE_ANSWER');
  app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'stored' });
  app.click({ action: 'assistant-switch-provider', provider: 'deepseek' });
  confirmDeepSeekModels(app);
  const remote = sendAuditQuestion(app, 'REMOTE_NEW_QUESTION');
  assert.equal(remote.provider, 'deepseek');
  assert.equal(remote.messages.length, 2);
  assert.doesNotMatch(JSON.stringify(remote.messages), /LOCAL_PRIVATE_QUESTION|LOCAL_PRIVATE_ANSWER/);
});

test('a hybrid preview cannot forward offline-only history if connectivity changes before confirmation', () => {
  const app = assistantAuditHarness([], 'hybrid');
  app.setOnline(false);
  const local = sendAuditQuestion(app, 'OFFLINE_PRIVATE_QUESTION');
  app.receive({ type: 'assistantResponse', requestId: local.requestId, answer: 'OFFLINE_PRIVATE_ANSWER', providerUsed: 'ollama', fallbackReason: 'offline' });
  app.input('assistant-question', 'New preview question');
  app.click({ action: 'assistant-review' });
  assert.equal(app.node('assistant-confirm-dialog').open, true);
  app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'stored' });
  app.setOnline(true);
  app.click({ action: 'assistant-confirm-send' });
  const requests = app.sent.filter(row => row.action === 'assistantRequest');
  assert.ok(requests.length <= 2);
  // Implementations may require a fresh preview or rebuild safe context. They
  // must never send the offline history under the new online route.
  if (requests.length === 2) {
    assert.equal(requests[1].networkAvailable, true);
    assert.doesNotMatch(JSON.stringify(requests[1].messages), /OFFLINE_PRIVATE_QUESTION|OFFLINE_PRIVATE_ANSWER/);
  } else {
    assert.match(app.node('toast').textContent, /改变|变化|重新|changed|again/i);
  }
});

test('assistant sends missing course percentages as null and preserves a real zero grade', () => {
  const app = assistantAuditHarness(['grades']);
  app.receive({ type: 'snapshot', snapshot: {
    source: 'managebac', url: 'https://example-school.managebac.cn/grades', capturedAt: '2026-09-19T00:40:00Z', warnings: [],
    courses: [{ id: 'missing', name: 'Missing grade', percentage: null, term: 'Term 1', isCurrentTerm: true, isCourseGrade: true },
      { id: 'zero', name: 'Zero grade', percentage: 0, term: 'Term 1', isCurrentTerm: true, isCourseGrade: true }], tasks: [], feedback: []
  } });
  const grades = auditRequestContext(sendAuditQuestion(app, 'Review my grades')).grades;
  assert.equal(grades.find(row => row.course === 'Missing grade').percentage, null);
  assert.equal(grades.find(row => row.course === 'Zero grade').percentage, 0);
});

test('assistant trims whole historical turns to budget without repeating hidden context or blocking later questions', () => {
  const app = assistantAuditHarness(['tasks']);
  app.receive({ type: 'snapshot', snapshot: teamsSnapshot(Array.from({ length: 20 }, (_, index) => task({
    id: 'budget-' + index, title: 'Budget task ' + index, requirements: (index ? '' : 'UNIQUE_CONTEXT_MARKER') + 'R'.repeat(760)
  }))) });
  let latest;
  for (let turn = 0; turn < 8; turn++) {
    latest = sendAuditQuestion(app, 'Budget question ' + turn);
    assert.ok(JSON.stringify(latest.messages).length <= 40_000);
    assert.equal((JSON.stringify(latest.messages).match(/UNIQUE_CONTEXT_MARKER/g) || []).length, 1, 'source data belongs only in the current request message');
    assert.equal((latest.messages.length - 2) % 2, 0, 'trimming keeps complete user/assistant pairs');
    replyAuditQuestion(app, latest, 'ANSWER_' + turn + '_' + 'A'.repeat(7000));
  }
  assert.ok(latest.messages.length > 2, 'recent conversation remains available when it fits');
  assert.doesNotMatch(JSON.stringify(latest.messages), /ANSWER_0_/);
  assert.match(JSON.stringify(latest.messages), /ANSWER_6_/);
  app.click({ page: 'settings' });
  app.changeAttributes({ 'data-ai-context': 'tasks' }, { checked: false });
  app.click({ page: 'assistant' });
  const next = sendAuditQuestion(app, 'Still able to ask');
  assert.deepEqual(auditRequestContext(next), {});
  assert.equal(next.messages.length, 2);
});

test('DeepSeek continues multiple long turns within the request budget while preserving complete successful pairs', () => {
  const app = assistantAuditHarness([], 'deepseek');
  app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'stored' });
  confirmDeepSeekModels(app);
  let latest;
  for (let turn = 0; turn < 8; turn++) {
    latest = sendAuditQuestion(app, 'CLOUD_QUESTION_' + turn);
    assert.equal(latest.provider, 'deepseek');
    assert.ok(JSON.stringify(latest.messages).length <= 40_000);
    assert.deepEqual(latest.messages.map(message => message.role), ['system', ...Array((latest.messages.length - 2) / 2).fill(['user', 'assistant']).flat(), 'user']);
    assert.ok(latest.messages.every(message => message.content.trim()));
    if (turn) assert.match(JSON.stringify(latest.messages), new RegExp('CLOUD_ANSWER_' + (turn - 1) + '_'));
    replyAuditQuestion(app, latest, 'CLOUD_ANSWER_' + turn + '_' + 'A'.repeat(12_000));
  }
  assert.doesNotMatch(JSON.stringify(latest.messages), /CLOUD_QUESTION_0|CLOUD_ANSWER_0_/);
  assert.match(JSON.stringify(latest.messages), /CLOUD_QUESTION_6|CLOUD_ANSWER_6_/);
});

test('a failed DeepSeek follow-up skips only the failed turn and retains previous successful context for manual retry', () => {
  for (const code of ['network', 'remoteInvalidRequest', 'insufficientBalance', 'modelUnavailable', 'rateLimited', 'serviceUnavailable']) {
    const app = assistantAuditHarness([], 'deepseek');
    app.receive({ type: 'assistantStatus', deepSeekKeyConfigured: true, deepSeekKeyState: 'stored' });
    confirmDeepSeekModels(app);
    const first = sendAuditQuestion(app, 'SUCCESSFUL_FIRST_QUESTION');
    replyAuditQuestion(app, first, 'SUCCESSFUL_FIRST_ANSWER');
    const second = sendAuditQuestion(app, 'FOLLOW_UP_QUESTION');
    assert.match(JSON.stringify(second.messages), /SUCCESSFUL_FIRST_ANSWER/);
    app.receive({ type: 'assistantChunk', requestId: second.requestId, text: 'FAILED_ANSWER_FRAGMENT', providerUsed: 'deepseek' });
    app.receive({ type: 'assistantResponse', requestId: second.requestId, errorCode: code });
    assert.equal(app.node('assistant-question').value, 'FOLLOW_UP_QUESTION');
    assert.equal(app.sent.filter(row => row.action === 'assistantRequest').length, 2, 'failure never sends the restored question automatically');
    app.click({ action: 'assistant-send' });
    const retry = app.last('assistantRequest');
    assert.equal(retry.messages.length, 4);
    assert.match(JSON.stringify(retry.messages), /SUCCESSFUL_FIRST_QUESTION|SUCCESSFUL_FIRST_ANSWER/);
    assert.doesNotMatch(JSON.stringify(retry.messages), /FAILED_ANSWER_FRAGMENT|余额不足|请求过于频繁|temporarily unavailable/);
    assert.equal(retry.messages.filter(message => message.content.includes('FOLLOW_UP_QUESTION')).length, 1);
    replyAuditQuestion(app, retry, 'SUCCESSFUL_SECOND_ANSWER');
    const third = sendAuditQuestion(app, 'THIRD_QUESTION');
    assert.equal(third.messages.length, 6);
    assert.match(JSON.stringify(third.messages), /SUCCESSFUL_FIRST_ANSWER|SUCCESSFUL_SECOND_ANSWER/);
    assert.doesNotMatch(JSON.stringify(third.messages), /FAILED_ANSWER_FRAGMENT/);
  }
});

test('assistant chunks update incrementally, preserve the draft, and keep stop available after navigating back', () => {
  const app = assistantAuditHarness();
  const request = sendAuditQuestion(app, 'Start streaming');
  assert.equal(app.node('assistant-send').dataset.action, 'assistant-stop');
  assert.equal(app.node('assistant-send').disabled, false);
  app.receive({ type: 'assistantChunk', requestId: request.requestId, text: 'First ', providerUsed: 'ollama' });
  app.flushTimeouts();
  assert.match(app.node('assistant-chat-log').innerHTML, /First /);
  const editor = app.node('assistant-question'); editor.focus();
  app.input('assistant-question', 'Preserve my next draft');
  app.receive({ type: 'assistantChunk', requestId: request.requestId, text: '<second>', providerUsed: 'ollama' });
  app.flushTimeouts();
  assert.match(app.node('assistant-chat-log').innerHTML, /First &lt;second&gt;/);
  assert.equal(app.node('assistant-question'), editor);
  assert.equal(editor.value, 'Preserve my next draft');
  app.blur('assistant-question');
  app.click({ page: 'settings' });
  app.click({ page: 'assistant' });
  assert.equal(app.node('assistant-send').dataset.action, 'assistant-stop', 'a complete render must preserve the stop action while generation is in flight');
  assert.equal(app.node('assistant-send').disabled, false);
  replyAuditQuestion(app, request, 'First <second>');
  app.flushTimeouts();
  const log = app.node('assistant-chat-log').innerHTML || app.node('content').innerHTML;
  assert.equal((log.match(/First &lt;second&gt;/g) || []).length, 1, 'final text replaces the partial answer instead of duplicating it');
  assert.doesNotMatch(log, /assistant-typing/);
});

test('stop and clear cancel the native request and ignore late chunks or completions without polluting future history', () => {
  for (const action of ['assistant-stop', 'assistant-clear']) {
    const app = assistantAuditHarness();
    const first = sendAuditQuestion(app, 'INTERRUPTED_QUESTION');
    app.receive({ type: 'assistantChunk', requestId: first.requestId, text: 'INTERRUPTED_PARTIAL', providerUsed: 'ollama' });
    app.flushTimeouts();
    app.click({ action });
    assert.deepEqual(app.last('assistantCancelRequest'), { action: 'assistantCancelRequest', requestId: first.requestId });
    const second = sendAuditQuestion(app, 'Fresh after stop');
    assert.doesNotMatch(JSON.stringify(second.messages), /INTERRUPTED_QUESTION|INTERRUPTED_PARTIAL/);
    app.receive({ type: 'assistantChunk', requestId: first.requestId, text: 'LATE_CHUNK', providerUsed: 'ollama' });
    app.receive({ type: 'assistantResponse', requestId: first.requestId, answer: 'LATE_ANSWER', providerUsed: 'ollama' });
    app.flushTimeouts();
    assert.doesNotMatch(app.node('content').innerHTML + app.node('assistant-chat-log').innerHTML, /LATE_CHUNK|LATE_ANSWER/);
    assert.equal(app.node('assistant-send').dataset.action, 'assistant-stop', 'a stale completion must not finish the newer request');
    replyAuditQuestion(app, second, 'Fresh answer');
    const third = sendAuditQuestion(app, 'Next question');
    assert.doesNotMatch(JSON.stringify(third.messages), /INTERRUPTED_QUESTION|INTERRUPTED_PARTIAL|LATE_CHUNK|LATE_ANSWER/);
    assert.match(JSON.stringify(third.messages), /Fresh answer/);
  }
});

test('empty, errored, and incomplete assistant answers never become history in the next model request', () => {
  for (const failure of [{ answer: '' }, { answer: '  ' }, { errorCode: 'network' }, { errorCode: 'badResponse' }]) {
    const app = assistantAuditHarness();
    const first = sendAuditQuestion(app, 'FAILED_QUESTION');
    app.receive({ type: 'assistantChunk', requestId: first.requestId, text: 'FAILED_PARTIAL', providerUsed: 'ollama' });
    app.receive(Object.assign({ type: 'assistantResponse', requestId: first.requestId, providerUsed: 'ollama' }, failure));
    const second = sendAuditQuestion(app, 'A fresh question');
    assert.equal(second.messages.length, 2);
    assert.doesNotMatch(JSON.stringify(second.messages), /FAILED_QUESTION|FAILED_PARTIAL/);
    assert.ok(second.messages.every(message => message.content.trim()));
  }
});

async function importAuditFile(app, value) {
  const input = app.node('import-file'), text = JSON.stringify(value);
  input.files = [{ name: 'synthetic-backup.json', size: Buffer.byteLength(text), text: async () => text }];
  await input.events.change({ target: input });
}

test('browser backup envelopes require confirmation and retain an immutable recovery copy across later saves', async () => {
  const app = harness({ native: false, themeEdition: true });
  app.click({ action: 'add-task' }); app.node('task-title').value = 'Original browser task'; app.submit('task-form');
  const original = JSON.parse(app.store.get('campusdesk.browser.v1'));
  const candidate = app.ctx.CampusCore.emptyState();
  candidate.manualTasks.push({ id: 'imported', title: 'Imported browser task', dueAt: null, status: 'open' });
  const envelope = app.ctx.CampusCore.exportBackup(JSON.stringify(candidate)), confirmations = [];
  app.ctx.confirm = message => { confirmations.push(message); return false; };
  await importAuditFile(app, envelope);
  assert.equal(confirmations.length, 1, 'a recognized envelope needs the replacement confirmation only');
  assert.equal(JSON.parse(app.store.get('campusdesk.browser.v1')).manualTasks[0].title, 'Original browser task');
  assert.equal([...app.store.keys()].filter(key => key.startsWith('campusdesk.preimport.')).length, 0);
  app.ctx.confirm = message => { confirmations.push(message); return true; };
  await importAuditFile(app, envelope);
  assert.equal(JSON.parse(app.store.get('campusdesk.browser.v1')).manualTasks[0].title, 'Imported browser task');
  const recoveryKeys = [...app.store.keys()].filter(key => key.startsWith('campusdesk.preimport.'));
  assert.equal(recoveryKeys.length, 1);
  const recovered = JSON.parse(app.store.get(recoveryKeys[0]));
  assert.equal(recovered.app, 'CampusDesk'); assert.equal(recovered.edition, 'theme'); assert.equal(recovered.schemaVersion, 1);
  assert.deepEqual(recovered.data, JSON.parse(JSON.stringify(app.ctx.CampusCore.validateState(JSON.stringify(original)))));
  const recoveryBytes = app.store.get(recoveryKeys[0]);
  app.click({ action: 'add-task' }); app.node('task-title').value = 'Added after import'; app.submit('task-form');
  assert.equal(app.store.get(recoveryKeys[0]), recoveryBytes, 'routine saves never overwrite the pre-import copy');
});

test('browser import rejects foreign envelopes and aborts when the recovery copy cannot be saved', async () => {
  const app = harness({ native: false, themeEdition: true });
  app.click({ action: 'add-task' }); app.node('task-title').value = 'Keep on failure'; app.submit('task-form');
  const before = app.store.get('campusdesk.browser.v1'), candidate = app.ctx.CampusCore.emptyState();
  const envelope = app.ctx.CampusCore.exportBackup(candidate);
  const prompts = [];
  app.ctx.confirm = message => { prompts.push(message); return true; };
  for (const bad of [Object.assign({}, envelope, { app: 'OtherApp' }), Object.assign({}, envelope, { edition: 'standard' }), Object.assign({}, envelope, { schemaVersion: 99 })]) {
    await importAuditFile(app, bad);
    assert.equal(app.store.get('campusdesk.browser.v1'), before);
  }
  assert.equal(prompts.length, 0, 'invalid envelopes are rejected before offering to replace current data');
  const setItem = app.ctx.localStorage.setItem;
  app.ctx.localStorage.setItem = (key, value) => { if (key.startsWith('campusdesk.preimport.')) throw new Error('Synthetic storage full'); setItem(key, value); };
  await importAuditFile(app, envelope);
  assert.equal(app.store.get('campusdesk.browser.v1'), before);
  assert.match(app.node('toast').textContent, /无法导入.*Synthetic storage full/);
});

test('legacy browser imports require both provenance and replacement confirmations, and either decline preserves state', async () => {
  const app = harness({ native: false });
  app.click({ action: 'add-task' }); app.node('task-title').value = 'Existing legacy test'; app.submit('task-form');
  const before = app.store.get('campusdesk.browser.v1'), candidate = app.ctx.CampusCore.emptyState();
  for (const decisions of [[false], [true, false]]) {
    const prompts = []; let index = 0;
    app.ctx.confirm = message => { prompts.push(message); return decisions[index++]; };
    await importAuditFile(app, candidate);
    assert.equal(prompts.length, decisions.length);
    assert.match(prompts[0], /旧格式备份/);
    assert.equal(app.store.get('campusdesk.browser.v1'), before);
    assert.equal([...app.store.keys()].filter(key => key.startsWith('campusdesk.preimport.')).length, 0);
  }
});

test('browser import never reports success when the replacement state cannot be persisted', async () => {
  const app = harness({ native: false, themeEdition: true });
  app.click({ action: 'add-task' }); app.node('task-title').value = 'Original before quota failure'; app.submit('task-form');
  const original = app.store.get('campusdesk.browser.v1'), candidate = app.ctx.CampusCore.emptyState();
  candidate.manualTasks.push({ id: 'replacement', title: 'Replacement too large to save', dueAt: null, status: 'open' });
  const envelope = app.ctx.CampusCore.exportBackup(JSON.stringify(candidate));
  const setItem = app.ctx.localStorage.setItem;
  app.ctx.localStorage.setItem = (key, value) => { if (key === 'campusdesk.browser.v1') throw new Error('Synthetic replacement quota exceeded'); setItem(key, value); };
  await importAuditFile(app, envelope);
  assert.equal(app.store.get('campusdesk.browser.v1'), original);
  assert.equal([...app.store.keys()].filter(key => key.startsWith('campusdesk.preimport.')).length, 1, 'the original recovery copy is retained');
  assert.doesNotMatch(app.node('toast').textContent, /已恢复备份|restored successfully/i);
  assert.match(app.node('toast').textContent, /无法|失败|could not|failed/i);
});

test('native imports keep current data until a matching successful acknowledgement and use the native normalized state', () => {
  const app = harness({ hash: '#tasks' }), original = app.ctx.CampusCore.emptyState();
  original.manualTasks.push({ id: 'original', title: 'Original before native import', dueAt: null, status: 'open' });
  app.receive({ type: 'state', state: original });
  const candidate = app.ctx.CampusCore.emptyState();
  candidate.manualTasks.push({ id: 'candidate', title: 'Candidate awaiting native save', dueAt: null, status: 'open' });
  app.receive({ type: 'import', state: candidate, validated: true });
  const pending = app.last('saveState');
  assert.equal(pending.imported, true);
  assert.match(pending.importRequestId, /^import-/);
  assert.match(app.node('content').innerHTML, /Original before native import/);
  assert.doesNotMatch(app.node('content').innerHTML, /Candidate awaiting native save/);
  assert.doesNotMatch(app.node('toast').textContent, /已恢复备份/);
  app.receive({ type: 'importResult', requestId: 'unrelated-import', success: true, state: candidate });
  assert.match(app.node('content').innerHTML, /Original before native import/);
  const normalized = JSON.parse(JSON.stringify(pending.state));
  normalized.manualTasks[0].title = 'Native normalized restored task';
  app.receive({ type: 'importResult', requestId: pending.importRequestId, success: true, state: normalized });
  assert.match(app.node('content').innerHTML, /Native normalized restored task/);
  assert.doesNotMatch(app.node('content').innerHTML, /Original before native import|Candidate awaiting native save/);
  assert.match(app.node('toast').textContent, /已恢复备份/);
  assert.equal(app.sent.filter(row => row.action === 'saveState' && row.imported).length, 1, 'the successful acknowledgement never resubmits the import');
  app.receive({ type: 'importResult', requestId: pending.importRequestId, success: true, state: original });
  assert.match(app.node('content').innerHTML, /Native normalized restored task/, 'duplicate acknowledgements cannot overwrite the restored state');
});

test('failed native import leaves the original frontend state intact and a retry ignores the previous acknowledgement', () => {
  const app = harness({ hash: '#tasks' }), original = app.ctx.CampusCore.emptyState();
  original.manualTasks.push({ id: 'safe', title: 'Keep after native failure', dueAt: null, status: 'open' });
  app.receive({ type: 'state', state: original });
  const candidate = app.ctx.CampusCore.emptyState();
  candidate.manualTasks.push({ id: 'incoming', title: 'Incoming retry task', dueAt: null, status: 'open' });
  app.receive({ type: 'import', state: candidate, validated: true });
  const first = app.last('saveState');
  app.receive({ type: 'importResult', requestId: first.importRequestId, success: false, message: 'Synthetic native disk full' });
  assert.match(app.node('content').innerHTML, /Keep after native failure/);
  assert.doesNotMatch(app.node('content').innerHTML, /Incoming retry task/);
  assert.match(app.node('toast').textContent, /无法导入.*Synthetic native disk full/);
  app.receive({ type: 'state', state: original });
  app.receive({ type: 'import', state: candidate, validated: true });
  const retry = app.last('saveState');
  assert.notEqual(retry.importRequestId, first.importRequestId);
  app.receive({ type: 'importResult', requestId: first.importRequestId, success: true, state: candidate });
  assert.match(app.node('content').innerHTML, /Keep after native failure/);
  assert.doesNotMatch(app.node('content').innerHTML, /Incoming retry task/);
  app.receive({ type: 'importResult', requestId: retry.importRequestId, success: true, state: retry.state });
  assert.match(app.node('content').innerHTML, /Incoming retry task/);
  assert.doesNotMatch(app.node('content').innerHTML, /Keep after native failure/);
});

test('native import generation gates old batches and acknowledges the result before saving queued fresh data', () => {
  const app = harness({ hash: '#tasks' }), original = app.ctx.CampusCore.emptyState();
  original.manualTasks.push({ id: 'old-local', title: 'PRE_IMPORT_LOCAL', dueAt: null, status: 'open' });
  app.receive({ type: 'state', state: original, stateGeneration: 4 });
  const candidate = app.ctx.CampusCore.emptyState();
  candidate.manualTasks.push({ id: 'restored-local', title: 'RESTORED_LOCAL', dueAt: null, status: 'open' });
  app.receive({ type: 'import', state: candidate, validated: true, stateGeneration: 4 });
  const request = app.last('saveState');
  assert.equal(request.stateGeneration, 4);
  assert.equal(app.node('app-shell').inert, true);
  const sendsBefore = app.sent.length;
  app.receive({ type: 'snapshot', snapshot: teamsSnapshot([task({ title: 'STALE_SNAPSHOT' })]), stateGeneration: 4 });
  app.receive({ type: 'graphBatch', batchId: 'stale-batch', batch: graphBatch([{ id: 'old-graph', subject: 'STALE_GRAPH' }]), stateGeneration: 4 });
  app.receive({ type: 'state', state: original, stateGeneration: 4 });
  app.receive({ type: 'snapshot', snapshot: teamsSnapshot([task({ title: 'FRESH_SNAPSHOT' })]), stateGeneration: 5 });
  app.receive({ type: 'graphBatch', batchId: 'fresh-batch', batch: graphBatch([{ id: 'new-graph', subject: 'FRESH_GRAPH' }]), stateGeneration: 5 });
  assert.equal(app.sent.length, sendsBefore, 'pending import events cannot emit saves or Graph acknowledgements');
  app.receive({ type: 'importResult', requestId: 'unrelated', success: true, state: candidate, stateGeneration: 5 });
  assert.equal(app.node('app-shell').inert, true);
  app.receive({ type: 'importResult', requestId: request.importRequestId, success: true, state: candidate, stateGeneration: 5 });
  assert.equal(app.node('app-shell').inert, false);
  const ackIndex = app.sent.findIndex(row => row.action === 'importResultApplied');
  const firstSave = app.sent.findIndex((row, index) => index > sendsBefore - 1 && row.action === 'saveState');
  assert.ok(ackIndex >= sendsBefore && firstSave > ackIndex, 'applied-state acknowledgement precedes every replayed save');
  assert.equal(app.sent[ackIndex].stateGeneration, 5);
  assert.equal(app.sent[ackIndex].requestId, request.importRequestId);
  const saved = JSON.stringify(app.last('saveState').state);
  assert.match(saved, /RESTORED_LOCAL/); assert.match(saved, /FRESH_SNAPSHOT/); assert.match(saved, /FRESH_GRAPH/);
  assert.doesNotMatch(saved, /STALE_SNAPSHOT|STALE_GRAPH|PRE_IMPORT_LOCAL/);
  assert.equal(app.last('graphBatchProcessed').batchId, 'fresh-batch');
  assert.equal(app.last('graphBatchProcessed').stateGeneration, 5);
  const saveCount = app.sent.filter(row => row.action === 'saveState').length;
  for (const stateGeneration of [4, undefined]) {
    app.receive({ type: 'state', state: original, stateGeneration });
    app.receive({ type: 'snapshot', snapshot: teamsSnapshot([task({ title: 'LATE_OLD' })]), stateGeneration });
    app.receive({ type: 'graphBatch', batchId: 'late-batch', batch: graphBatch([{ id: 'late-old' }]), stateGeneration });
  }
  assert.equal(app.sent.filter(row => row.action === 'saveState').length, saveCount);
  app.click({ action: 'toggle-task', id: 'restored-local' });
  assert.equal(app.last('saveState').stateGeneration, 5);
  assert.match(JSON.stringify(app.last('saveState').state), /RESTORED_LOCAL/);
  assert.doesNotMatch(JSON.stringify(app.last('saveState').state), /PRE_IMPORT_LOCAL|LATE_OLD/);
});

test('failed generated import applies native state, unlocks editing, and a retry cannot be completed by an old result', () => {
  const app = harness({ hash: '#tasks' }), original = app.ctx.CampusCore.emptyState();
  original.manualTasks.push({ id: 'safe', title: 'AUTHORITATIVE_ORIGINAL', dueAt: null, status: 'open' });
  app.receive({ type: 'state', state: original, stateGeneration: 0 });
  const candidate = app.ctx.CampusCore.emptyState();
  app.receive({ type: 'import', state: candidate, validated: true, stateGeneration: 0 });
  const first = app.last('saveState');
  app.receive({ type: 'state', state: original, stateGeneration: 1 });
  assert.equal(app.node('app-shell').inert, true, 'a state event alone must not clear the pending request');
  app.receive({ type: 'importResult', requestId: first.importRequestId, success: false, state: original, stateGeneration: 1, message: 'Synthetic write failure' });
  assert.equal(app.node('app-shell').inert, false);
  assert.equal(app.last('importResultApplied').stateGeneration, 1);
  assert.match(app.node('content').innerHTML, /AUTHORITATIVE_ORIGINAL/);
  assert.match(app.node('toast').textContent, /Synthetic write failure/);
  app.receive({ type: 'import', state: candidate, validated: true, stateGeneration: 1 });
  const retry = app.last('saveState');
  assert.equal(retry.stateGeneration, 1);
  const ackCount = app.sent.filter(row => row.action === 'importResultApplied').length;
  app.receive({ type: 'importResult', requestId: first.importRequestId, success: true, state: candidate, stateGeneration: 2 });
  app.receive({ type: 'importResult', requestId: retry.importRequestId, success: true, state: candidate, stateGeneration: 0 });
  assert.equal(app.node('app-shell').inert, true);
  assert.equal(app.sent.filter(row => row.action === 'importResultApplied').length, ackCount);
  app.receive({ type: 'importResult', requestId: retry.importRequestId, success: false, state: original, stateGeneration: 2 });
  assert.equal(app.node('app-shell').inert, false);
  app.click({ action: 'add-task' }); app.node('task-title').value = 'EDIT_AFTER_FAILURE'; app.submit('task-form');
  assert.equal(app.last('saveState').stateGeneration, 2);
  assert.match(JSON.stringify(app.last('saveState').state), /AUTHORITATIVE_ORIGINAL/);
  assert.match(JSON.stringify(app.last('saveState').state), /EDIT_AFTER_FAILURE/);
});

test('non-state assistant completions cross import generations without retaining a permanently busy request', () => {
  const app = harness({ themeEdition: true, hash: '#assistant' });
  const original = app.ctx.CampusCore.emptyState();
  Object.assign(original.settings, { setupWizardCompleted: true, setupWizardIntroVersion: '1.0.0', aiProvider: 'ollama', aiContextCategories: [] });
  app.receive({ type: 'state', state: original, stateGeneration: 2 });
  const request = sendAuditQuestion(app, 'FIRST_QUESTION');
  app.receive({ type: 'import', state: original, validated: true, stateGeneration: 2 });
  const imported = app.last('saveState');
  app.receive({ type: 'assistantChunk', requestId: request.requestId, text: 'Completed ', stateGeneration: 2 });
  app.receive({ type: 'assistantResponse', requestId: request.requestId, answer: 'Completed answer', providerUsed: 'ollama', stateGeneration: 2 });
  app.receive({ type: 'importResult', requestId: imported.importRequestId, success: false, state: original, stateGeneration: 3 });
  const next = sendAuditQuestion(app, 'SECOND_QUESTION');
  assert.equal(next.stateGeneration, 3);
  assert.match(app.node('content').innerHTML, /Completed answer/);
});

test('failed first-run import accepts the native empty state and unlocks another attempt', () => {
  const app = harness({ hash: '#tasks' });
  app.receive({ type: 'state', state: {}, stateGeneration: 0 });
  const candidate = app.ctx.CampusCore.emptyState();
  app.receive({ type: 'import', state: candidate, validated: true, stateGeneration: 0 });
  const first = app.last('saveState');
  app.receive({ type: 'importResult', requestId: first.importRequestId, success: false, state: {}, stateGeneration: 1 });
  assert.equal(app.node('app-shell').inert, false);
  assert.equal(app.last('importResultApplied').stateGeneration, 1);
  app.receive({ type: 'import', state: candidate, validated: true, stateGeneration: 1 });
  assert.notEqual(app.last('saveState').importRequestId, first.importRequestId);
});

test('authoritative account reset advances generation and late old Teams batches cannot restore cleared data', () => {
  const app = harness({ hash: '#tasks' }), initial = app.ctx.CampusCore.emptyState();
  initial.manualTasks.push({ id: 'personal', title: 'KEEP_PERSONAL_TASK', dueAt: null, status: 'open' });
  app.receive({ type: 'state', state: initial, stateGeneration: 0 });
  app.receive({ type: 'graphBatch', batchId: 'old-before-reset', batch: graphBatch([{ id: 'prior-account', subject: 'OLD_ACCOUNT_CONTENT' }]), stateGeneration: 0 });
  assert.equal(app.last('saveState').stateGeneration, 0);
  assert.match(JSON.stringify(app.last('saveState').state), /OLD_ACCOUNT_CONTENT/);
  app.receive({ type: 'state', replaceState: true, state: initial, stateGeneration: 1 });
  app.receive({ type: 'graphReset', stateGeneration: 1 });
  assert.equal(app.last('saveState').stateGeneration, 1);
  assert.doesNotMatch(JSON.stringify(app.last('saveState').state), /OLD_ACCOUNT_CONTENT/);
  const savedCount = app.sent.filter(row => row.action === 'saveState').length;
  app.receive({ type: 'snapshot', snapshot: teamsSnapshot([task({ title: 'LATE_OLD_ACCOUNT' })]), stateGeneration: 0 });
  app.receive({ type: 'graphBatch', batchId: 'old-after-reset', batch: graphBatch([{ id: 'prior-late', subject: 'LATE_OLD_ACCOUNT' }]), stateGeneration: 0 });
  const unexpected = app.ctx.CampusCore.emptyState();
  unexpected.manualTasks.push({ id: 'unexpected', title: 'UNMARKED_FUTURE_STATE', dueAt: null, status: 'open' });
  app.receive({ type: 'state', state: unexpected, stateGeneration: 99 });
  assert.equal(app.sent.filter(row => row.action === 'saveState').length, savedCount);
  app.receive({ type: 'graphBatch', batchId: 'new-after-reset', batch: graphBatch([{ id: 'new-account', subject: 'NEW_ACCOUNT_CONTENT' }]), stateGeneration: 1 });
  const fresh = JSON.stringify(app.last('saveState').state);
  assert.match(fresh, /KEEP_PERSONAL_TASK/); assert.match(fresh, /NEW_ACCOUNT_CONTENT/);
  assert.doesNotMatch(fresh, /OLD_ACCOUNT_CONTENT|LATE_OLD_ACCOUNT|UNMARKED_FUTURE_STATE/);
  assert.equal(app.last('graphBatchProcessed').batchId, 'new-after-reset');
  assert.equal(app.last('graphBatchProcessed').stateGeneration, 1);
});
