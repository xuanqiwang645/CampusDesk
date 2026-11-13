'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { launchChromium } = require('./launch-chromium.cjs');
const Core = require('../Resources/core.js');
const optional = { skip: !process.env.PLAYWRIGHT_MODULE };
const appURL = pathToFileURL(path.resolve(__dirname, '../Resources/index.html')).href;

function fixture() {
  const url = 'https://teams.microsoft.com/v2/#/channels/synthetic-class';
  const rows = [
    ['homework', 'Practice sheet', 'Complete the practice sheet.', 'assignment'],
    ['activity', 'Science fair', 'Attend the science fair.', 'ec'],
    ['notice', 'Lunch menu', 'The lunch menu changed. No homework is required.', 'assignment'],
    ['pending', 'New message', 'A new school message.', 'general'],
    ['failed', 'Unreadable announcement', 'Please check the original announcement.', 'general'],
    ['uncertain', 'Unclear meeting', 'Maybe meet later.', 'general']
  ];
  let state = Core.mergeSnapshot(Core.emptyState(), { source: 'teams', url, accountId: 'synthetic-account', capturedAt: '2026-09-19T00:00:00Z', coverage: 'visible', warnings: [],
    posts: rows.map(([id, title, text, kind]) => ({ id, title, text, kind, channel: 'SYNTHETIC', author: 'Teacher', url, date: '2026-09-18T00:00:00Z' })),
    tasks: rows.slice(0, 3).map(([id, title, text]) => ({ id, title, requirements: text, course: 'SYNTHETIC', dueAt: '2030-09-29T10:00:00Z', status: 'open', officialAssignment: false, url }))
  });
  Object.assign(state.settings, { teamsAnalysisEnabled: true, aiProvider: 'off', dashboardTheme: 'board', colorTheme: 'midnight' });
  const results = Core.getTeamsAnalysisInputs(state).filter(input => !input.id.endsWith(':pending')).map(input => {
    const name = input.id.split(':').at(-1), kind = ['homework', 'activity'].includes(name) ? name : null;
    return { id: input.id, fingerprint: input.fingerprint, status: name === 'failed' ? 'failed' : 'ready', error: name === 'failed' ? 'Network unavailable' : '', summary: 'Summary: ' + input.title,
      classification: kind ? 'actionable' : name === 'notice' ? 'notice' : 'uncertain', tasks: kind ? [{ category: kind, title: input.title, summary: 'Action: ' + input.title, evidence: rows.find(row => row[0] === name)[2], deadlineText: '' }] : [] };
  });
  return Core.applyTeamsAnalysisResults(state, { model: Core.teamsAnalysisModel(state), results });
}
async function openFixture(browser, hash = 'tasks', state = fixture(), native = false) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ state, native }) => {
    window.CampusDeskThemeEdition = true;
    window.uiMessages = [];
    if (native) window.webkit = { messageHandlers: { campus: { postMessage: message => window.uiMessages.push(message) } } };
    else localStorage.setItem('campusdesk.browser.v1', JSON.stringify(state));
  }, { state, native });
  await page.goto(appURL + '#' + hash);
  if (native) await page.evaluate(state => CampusDesk.receive({ type: 'state', state, stateGeneration: 3 }), state);
  await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); });
  return { page, errors };
}

test('Teams analysis keeps notices out of both to-do tabs, preserves originals and respects manual correction', optional, async () => {
  const browser = await launchChromium();
  try {
    const { page, errors } = await openFixture(browser);
    assert.match(await page.locator('.todo-page-content').innerText(), /Practice sheet/);
    assert.doesNotMatch(await page.locator('.todo-page-content').innerText(), /Science fair|Lunch menu|New message|Unreadable|Unclear/);
    await page.locator('[data-action="task-category-filter"][data-category="activity"]').click();
    assert.match(await page.locator('.todo-page-content').innerText(), /Science fair/);
    assert.doesNotMatch(await page.locator('.todo-page-content').innerText(), /Practice sheet/);
    await page.locator('.todo-card-hit').click();
    assert.match(await page.locator('#detail-content').innerText(), /活动原文与安排|原文依据/);
    assert.match(await page.locator('.teams-analysis-evidence').innerText(), /Attend the science fair/);
    assert.equal(await page.locator('#detail-content [data-action="open-source"]').count(), 1);
    await page.locator('[data-action="close-detail"]').click();
    await page.locator('.todo-complete-button').click();
    await page.locator('[data-page="teams"]').first().click();
    const activity = page.locator('.teams-post').filter({ has: page.locator('h3', { hasText: 'Science fair' }) });
    await activity.locator('.teams-analysis-correction summary').click();
    await activity.locator('[data-category="notice"]').click();
    assert.match(await activity.innerText(), /人工分类 · 普通通知/);
    assert.match(await activity.locator('.post-original').innerText(), /Attend the science fair/);
    if (!await activity.locator('[data-category="activity"]').isVisible()) await activity.locator('.teams-analysis-correction summary').click();
    await activity.locator('[data-category="activity"]').click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('campusdesk.browser.v1')));
    assert.equal(saved.taskChecks['teams:activity'], true, 'correction preserves completion');
    assert.equal(saved.teamsAnalysisOverrides['teams:activity'].category, 'activity');
    const text = await page.locator('.teams-groups-card').innerText();
    assert.match(text, /已分析 · 普通通知/); assert.match(text, /待分析/); assert.match(text, /分析失败/); assert.match(text, /已分析 · 待核对/);
    await page.locator('[data-page="ec"]').first().click();
    assert.match(await page.locator('#ec-results').innerText(), /Attend the science fair/);
    assert.match(await page.locator('#content').innerText(), /未匹配到姓名不代表不在名单中/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('personal activity category survives editing and both overview layouts keep separate groups', optional, async () => {
  const browser = await launchChromium();
  try {
    const { page, errors } = await openFixture(browser);
    await page.locator('[data-action="task-category-filter"][data-category="activity"]').click();
    await page.locator('[data-action="add-task"]').first().click();
    assert.equal(await page.locator('#task-category').inputValue(), 'activity');
    await page.locator('#task-title').fill('Personal club meeting');
    await page.locator('#task-form button[type="submit"]').click();
    const card = page.locator('.todo-deadline-card').filter({ hasText: 'Personal club meeting' });
    await card.locator('.todo-card-hit').click();
    await page.locator('#manual-task-category').selectOption('homework');
    await page.locator('[data-action="save-manual-task-due"]').click();
    await page.locator('[data-action="close-detail"]').click();
    assert.equal(await page.locator('[data-action="task-category-filter"][data-category="homework"]').getAttribute('aria-pressed'), 'true');
    assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('campusdesk.browser.v1')))).manualTasks[0].category, 'homework');
    await page.locator('[data-page="overview"]').first().click();
    assert.equal(await page.locator('.task-category-section').count(), 2);
    assert.match(await page.locator('[data-dom-key="category-homework"]').innerText(), /Practice sheet|Personal club meeting/);
    assert.match(await page.locator('[data-dom-key="category-activity"]').innerText(), /Science fair/);
    await page.setViewportSize({ width: 390, height: 850 });
    assert.ok(await page.locator('#content').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'categorized overview fits a narrow window');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('Teams automatic organizing has its own switch and key access without changing chat provider', optional, async () => {
  const browser = await launchChromium();
  try {
    const state = fixture(); state.settings.teamsAnalysisEnabled = false;
    const { page, errors } = await openFixture(browser, 'settings', state, true);
    await page.locator('label[for="teams-analysis-enabled"]').click();
    const saved = await page.evaluate(() => window.uiMessages.filter(message => message.action === 'saveState').at(-1).state);
    assert.equal(saved.settings.teamsAnalysisEnabled, true); assert.equal(saved.settings.aiProvider, 'off');
    assert.match(await page.locator('#teams-analysis-settings').innerText(), /附件文字.*DeepSeek|API/);
    await page.locator('#teams-analysis-settings [data-action="teams-analysis-key"]').click();
    assert.equal(await page.locator('#assistant-deepseek-key').count(), 1);
    assert.equal(await page.locator('#assistant-provider').inputValue(), 'off');
    await page.locator('label[for="teams-analysis-enabled"]').click();
    assert.equal((await page.evaluate(() => window.uiMessages.filter(message => message.action === 'saveState').at(-1).state)).settings.teamsAnalysisEnabled, false);
    assert.doesNotMatch(await page.locator('#teams-browser-settings').innerText(), /不上传外部 AI/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('scheduled reviews wait for their interval, support an immediate review and retain a safe report when disabled', optional, async () => {
  const browser = await launchChromium();
  try {
    const state = Core.emptyState();
    state.manualTasks = [{ id: 'manual-review', title: 'Prepare club notes', category: 'activity', course: 'Personal', dueAt: '2030-09-29T10:00:00Z', status: 'open' }];
    const { page, errors } = await openFixture(browser, 'settings', state, true);
    assert.equal(await page.locator('#task-review-interval option').count(), 10);
    await page.locator('#task-review-interval').selectOption('10');
    await page.locator('label[for="task-review-enabled"]').click();
    await page.waitForFunction(() => document.querySelector('.task-review-status').textContent.includes('下次分析'));
    const saved = await page.evaluate(() => uiMessages.filter(message => message.action === 'saveState').at(-1).state);
    assert.equal(saved.settings.taskReviewEnabled, true);
    assert.equal(saved.settings.taskReviewIntervalHours, 10);
    assert.ok(Number.isFinite(Date.parse(saved.settings.taskReviewEnabledAt)));
    assert.equal(await page.evaluate(() => uiMessages.filter(message => message.action === 'taskReviewAnalyze').length), 0, 'enabling waits until the next interval');
    await page.locator('[data-action="task-review-permission"]').click();
    assert.equal(await page.evaluate(() => uiMessages.at(-1).action), 'requestNotifications');
    await page.locator('[data-action="task-review-now"]').click();
    await page.waitForFunction(() => uiMessages.some(message => message.action === 'taskReviewAnalyze'));
    const request = await page.evaluate(() => uiMessages.filter(message => message.action === 'taskReviewAnalyze').at(-1));
    assert.deepEqual(request.items.map(item => item.id), ['manual-review']);
    await page.evaluate(request => CampusDesk.receive({ type: 'taskReviewResult', requestId: request.requestId, stateGeneration: 3, model: request.model, success: true,
      result: { summary: 'Start with <img src=x onerror=alert(1)> the club notes.', recommendations: [{ id: 'manual-review', reason: 'Prepare before the meeting.' }] } }), request);
    await page.waitForFunction(() => document.querySelector('.task-review-summary')?.textContent.includes('club notes'));
    assert.equal(await page.locator('.task-review-summary img').count(), 0, 'AI text is not interpreted as markup');
    assert.equal(await page.locator('.task-review-recommendations li').count(), 1);
    assert.match(await page.locator('.task-review-status').innerText(), /上次完成/);
    await page.locator('[data-action="task-review-now"]').click();
    await page.waitForFunction(id => uiMessages.filter(message => message.action === 'taskReviewAnalyze').at(-1)?.requestId !== id, request.requestId);
    const retry = await page.evaluate(() => uiMessages.filter(message => message.action === 'taskReviewAnalyze').at(-1));
    await page.evaluate(request => CampusDesk.receive({ type: 'taskReviewResult', requestId: request.requestId, stateGeneration: 3, model: request.model, success: false, errorCode: 'unauthorized' }), retry);
    await page.waitForFunction(() => document.querySelector('.task-review-error')?.textContent.includes('无效'));
    assert.match(await page.locator('[data-action="task-review-now"]').innerText(), /重试/);
    await page.locator('label[for="task-review-enabled"]').click();
    await page.evaluate(() => CampusDesk.receive({ type: 'taskReviewTick', stateGeneration: 3 }));
    assert.equal(await page.locator('[data-action="task-review-now"]').isDisabled(), true);
    const disabled = await page.evaluate(() => uiMessages.filter(message => message.action === 'saveState').at(-1).state);
    assert.equal(disabled.settings.taskReviewEnabled, false);
    assert.match(disabled.taskReview.summary, /club notes/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('overview reminder panel controls scheduling beside the title and opens current priorities in both layouts', optional, async () => {
  const browser = await launchChromium();
  try {
    const state = fixture();
    state.settings.taskReviewEnabled = false;
    state.settings.teamsAnalysisEnabled = false;
    state.manualTasks = [{ id: 'review-practice', title: 'Practice sheet', course: 'SYNTHETIC', status: 'open' }, { id: 'review-fair', title: 'Science fair', course: 'SYNTHETIC', category: 'activity', status: 'open' }];
    state.taskReview = { lastCompletedAt: new Date().toISOString(), summary: 'Current priorities', inputFingerprint: Core.taskReviewInputFingerprint(Core.getTasks(Core.validateState(state)), Core.teamsAnalysisModel(state)), recommendations: [{ id: 'review-practice', reason: 'Finish the practice first.' }, { id: 'review-fair', reason: 'Prepare for the fair.' }, { id: 'removed-task', reason: 'Stale item' }] };
    const { page, errors } = await openFixture(browser, 'overview', state, true);
    const panel = page.locator('.overview-heading-controls .overview-task-review');
    assert.equal(await panel.count(), 1);
    const regularWidth = (await panel.boundingBox()).width;
    assert.ok(regularWidth > 420, 'desktop reminder uses the blank space beside the heading');
    await page.setViewportSize({ width: 1440, height: 850 });
    const widePanel = await panel.boundingBox(), styleControl = await page.locator('.overview-heading-controls > [data-action="appearance-settings"]').boundingBox();
    assert.ok(widePanel.width > regularWidth + 100, 'reminder border expands with the available space');
    assert.ok(Math.abs(widePanel.x + widePanel.width + 12 - styleControl.x) <= 1, 'reminder keeps its existing right-side anchor beside the style control');
    await page.setViewportSize({ width: 1100, height: 850 });
    assert.equal(await panel.locator('select option').count(), 10);
    assert.match(await panel.innerText(), /上次建议 · 已暂停/);
    assert.doesNotMatch(await panel.innerText(), /Stale item/);
    await panel.locator('label[for="review-overview-enabled"]').click();
    await panel.locator('select').selectOption('3');
    await page.waitForFunction(() => document.querySelector('.overview-review-status').textContent.includes('下次分析'));
    assert.equal(await page.evaluate(() => uiMessages.filter(m => m.action === 'saveState').at(-1).state.settings.taskReviewIntervalHours), 3);
    await panel.locator('[data-action="task-review-now"]').click();
    await page.waitForFunction(() => uiMessages.some(m => m.action === 'taskReviewAnalyze'));
    await panel.locator('[data-action="task-detail"]').first().click();
    assert.match(await page.locator('#detail-content').innerText(), /Practice sheet/);
    await page.locator('[data-action="close-detail"]').click();
    await page.locator('[data-page="settings"]').first().click();
    await page.locator('[data-action="dashboard-theme"][data-theme="classic"]').click();
    await page.locator('[data-page="overview"]').first().click();
    assert.equal(await page.locator('.overview-heading-controls .overview-task-review').count(), 1);
    assert.ok(await page.locator('#content').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'classic heading remains within the content width');
    await page.setViewportSize({ width: 390, height: 850 });
    assert.ok(await page.locator('#content').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('overview reminder fully collapses, persists its preference and keeps scheduled analysis enabled', optional, async () => {
  const browser = await launchChromium();
  try {
    const state = fixture();
    Object.assign(state.settings, { teamsAnalysisEnabled: false, taskReviewEnabled: true, taskReviewIntervalHours: 1, taskReviewEnabledAt: new Date().toISOString() });
    state.manualTasks = [{ id: 'collapse-task', title: 'Keep the upcoming task', status: 'open', category: 'homework' }];
    const { page, errors } = await openFixture(browser, 'overview', state, true);
    const panel = page.locator('.overview-task-review'), disclosure = panel.locator('[data-action="toggle-overview-review"]');
    const expanded = await panel.boundingBox();
    await disclosure.click();
    await page.waitForFunction(() => document.querySelector('.overview-task-review').dataset.collapsed === 'true');
    assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
    assert.equal(await panel.locator('#review-overview-enabled').isVisible(), false);
    assert.equal(await panel.locator('#review-overview-interval').isVisible(), false);
    assert.equal(await panel.locator('[data-action="task-review-now"]').isVisible(), false);
    assert.ok((await panel.boundingBox()).height < expanded.height - 30);
    const saved = await page.evaluate(() => uiMessages.filter(message => message.action === 'saveState').at(-1).state);
    assert.equal(saved.settings.taskReviewEnabled, true); assert.equal(saved.settings.taskReviewIntervalHours, 1);
    assert.equal(saved.settings.taskReviewPanelCollapsed, true);
    saved.settings.taskReviewEnabledAt = new Date(Date.now() - 3700000).toISOString();
    await page.evaluate(state => CampusDesk.receive({ type: 'state', state, stateGeneration: 3 }), saved);
    await page.evaluate(() => CampusDesk.receive({ type: 'taskReviewTick', stateGeneration: 3 }));
    await page.waitForFunction(() => uiMessages.some(message => message.action === 'taskReviewAnalyze'));
    assert.equal(await disclosure.getAttribute('aria-expanded'), 'false', 'scheduled work does not expand the panel');
    const persisted = await page.evaluate(() => uiMessages.filter(message => message.action === 'saveState').at(-1).state);
    await page.reload();
    await page.evaluate(state => { CampusDesk.receive({ type: 'state', state, stateGeneration: 3 }); document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); }, persisted);
    await page.waitForFunction(() => document.querySelector('.overview-task-review')?.dataset.collapsed === 'true');
    await disclosure.press('Enter');
    await page.waitForFunction(() => document.querySelector('.overview-task-review').dataset.collapsed === 'false');
    assert.equal(await panel.locator('#review-overview-interval').inputValue(), '1');
    assert.equal(await panel.locator('#review-overview-enabled').isChecked(), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('midnight learning plan renders dark rows with readable text and transparent sidebar icon borders', optional, async () => {
  const browser = await launchChromium();
  try {
    const { page, errors } = await openFixture(browser, 'learning');
    await page.locator('#settings-icon').evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
    const report = await page.evaluate(() => {
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d'); canvas.width = canvas.height = 1;
      const rgb = value => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
      const luminance = values => values.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
      const row = document.querySelector('.hub-plan-row'), bg = rgb(getComputedStyle(row).backgroundColor);
      return { background: luminance(bg), contrasts: [...row.querySelectorAll('strong, small, .hub-plan-control > span')].map(el => (luminance(rgb(getComputedStyle(el).color)) + .05) / (luminance(bg) + .05)), icons: [...document.querySelectorAll('.nav-item .icon')].map(el => getComputedStyle(el).borderColor) };
    });
    assert.ok(report.background < .08, JSON.stringify(report));
    assert.ok(report.contrasts.every(value => value >= 4.5), JSON.stringify(report));
    assert.ok(report.icons.every(color => color === 'rgba(0, 0, 0, 0)'), JSON.stringify(report));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('manual overview review runs after the current Teams batch before the remaining backlog', optional, async () => {
  const browser = await launchChromium();
  try {
    const url = 'https://teams.microsoft.com/v2/#/channels/synthetic-review-backlog';
    const state = Core.mergeSnapshot(Core.emptyState(), { source: 'teams', url, accountId: 'synthetic-account', capturedAt: new Date().toISOString(), coverage: 'visible', warnings: [],
      posts: Array.from({ length: 20 }, (_, index) => ({ id: 'backlog-' + index, title: 'School information ' + index, text: 'School notice number ' + index, channel: 'SYNTHETIC', author: 'Teacher', url, date: '2026-09-18T00:00:00Z', kind: 'general' })) });
    Object.assign(state.settings, { teamsAnalysisEnabled: true, aiProvider: 'off', dashboardTheme: 'board' });
    state.manualTasks = [{ id: 'backlog-review-task', title: 'Prepare chemistry practice', status: 'open' }];
    const { page, errors } = await openFixture(browser, 'overview', state, true);
    await page.waitForFunction(() => uiMessages.some(message => message.action === 'teamsAnalyze'));
    const first = await page.evaluate(() => uiMessages.find(message => message.action === 'teamsAnalyze'));
    assert.equal(first.items.length, 8);
    await page.locator('label[for="review-overview-enabled"]').click();
    await page.locator('.overview-task-review [data-action="task-review-now"]').click();
    await page.waitForFunction(() => document.querySelector('.overview-review-status').textContent.includes('已排队'));
    await page.evaluate(request => CampusDesk.receive({ type: 'teamsAnalysisResult', requestId: request.requestId, stateGeneration: 3, phase: request.phase, model: request.model, success: true,
      results: request.items.map(item => ({ id: item.id, fingerprint: item.fingerprint, summary: 'School information only.', classification: 'notice', tasks: [] })) }), first);
    await page.waitForFunction(() => uiMessages.some(message => message.action === 'taskReviewAnalyze'));
    assert.equal(await page.evaluate(() => uiMessages.filter(message => message.action === 'teamsAnalyze').length), 1, 'review gets priority before the next Teams batch');
    const review = await page.evaluate(() => uiMessages.find(message => message.action === 'taskReviewAnalyze'));
    await page.evaluate(request => CampusDesk.receive({ type: 'taskReviewResult', requestId: request.requestId, stateGeneration: 3, model: request.model, success: true,
      result: { summary: 'Start with chemistry practice.', recommendations: [{ id: 'backlog-review-task', reason: 'Prepare before class.' }] } }), review);
    await page.waitForFunction(() => uiMessages.filter(message => message.action === 'teamsAnalyze').length === 2);
    await page.waitForFunction(() => document.querySelector('.overview-task-review').textContent.includes('Prepare before class'));
    assert.match(await page.locator('.overview-task-review').innerText(), /Prepare before class/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('reminders expose their own DeepSeek setup and hide outdated advice without deleting history', optional, async () => {
  const browser = await launchChromium();
  try {
    const state = Core.emptyState();
    Object.assign(state.settings, { taskReviewEnabled: true, taskReviewEnabledAt: new Date().toISOString(), teamsAnalysisEnabled: false, aiProvider: 'off' });
    state.manualTasks = [{ id: 'reminder-only', title: 'Prepare notes', course: 'Personal', dueAt: '2030-09-29T10:00:00Z', status: 'open' }];
    state.taskReview = { lastCompletedAt: new Date().toISOString(), summary: 'Old deadline advice', recommendations: [{ id: 'reminder-only', reason: 'Due tomorrow' }], inputFingerprint: Core.taskReviewInputFingerprint(Core.getTasks(state), Core.teamsAnalysisModel(state)) };
    const { page, errors } = await openFixture(browser, 'settings', state, true);
    assert.equal(await page.locator('#assistant-deepseek-key').count(), 1, 'reminder-only mode can configure a key without enabling chat or Teams');
    assert.equal(await page.locator('#assistant-model').count(), 1, 'reminder-only mode exposes the model');
    assert.match(await page.locator('.task-review-summary').innerText(), /Old deadline advice/);
    const edited = structuredClone(state); edited.manualTasks[0].dueAt = '2031-09-29T10:00:00Z';
    await page.evaluate(state => CampusDesk.receive({ type: 'state', state, stateGeneration: 3, replaceState: true }), edited);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()));
    assert.equal(await page.locator('.task-review-recommendations li').count(), 0);
    assert.equal(await page.locator('.task-review-summary').count(), 0);
    assert.match(await page.locator('#task-review-settings').innerText(), /待办或模型已变化|重新分析/);
    await page.locator('[data-page="overview"]').first().click();
    assert.equal(await page.locator('.overview-review-priority').count(), 0);
    assert.match(await page.locator('.overview-task-review').innerText(), /重新分析/);
    await page.locator('[data-action="toggle-overview-review"]').click();
    const saved = await page.evaluate(() => uiMessages.filter(m => m.action === 'saveState').at(-1).state);
    assert.equal(saved.taskReview.summary, 'Old deadline advice', 'history stays intact when stale');
    assert.equal(saved.taskReview.recommendations[0].reason, 'Due tomorrow');
    assert.equal(saved.settings.aiProvider, 'off'); assert.equal(saved.settings.teamsAnalysisEnabled, false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
