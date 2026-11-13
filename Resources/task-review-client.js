/* Opt-in periodic task review. A review recommends work; it never completes it. */
(function (root, factory) {
  'use strict';
  const api = factory(typeof module === 'object' && module.exports ? require('./core.js') : root.CampusCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CampusTaskReviewClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  function create(options) {
    const { getState, onState, send } = options;
    const canRun = options.canRun || (() => true), onStatus = options.onStatus || (() => {});
    const now = options.now || Date.now, later = options.setTimeout || setTimeout, clear = options.clearTimeout || clearTimeout;
    let active = null, timer = null, timerAt = 0, serial = 0, lastStatus = '', forced = false, deferUntil = 0;
    let status = { running: false, pending: false, message: '', nextRunAt: null, errorCode: '' };
    function iso() { return new Date(now()).toISOString(); }
    function candidates() {
      return Core.getTasks(getState(), now()).filter(task => !task.completed).map(task => ({ id: task.id,
        title: String(task.title || '').slice(0, 500), category: task.category === 'activity' ? 'activity' : 'homework',
        dueAt: task.dueAt || '', course: String(task.course || '').slice(0, 300),
        summary: String(task.analysisSummary || task.summary || task.requirements || '').slice(0, 800) }));
    }
    function fingerprint(items = candidates(), model = Core.teamsAnalysisModel(getState())) {
      return Core.taskReviewInputFingerprint(items, model);
    }
    function nextDue(state) {
      if (state.settings?.taskReviewEnabled !== true) return null;
      const attempted = Date.parse(state.taskReview?.lastAttemptAt || '') || 0;
      const completed = Date.parse(state.taskReview?.lastCompletedAt || '') || 0;
      const enabled = Date.parse(state.settings.taskReviewEnabledAt || '') || 0;
      const hours = Math.max(1, Math.min(10, Number(state.settings.taskReviewIntervalHours) || 2));
      // A retry can wait through a long outage or provider cooldown. Completing
      // that review starts a fresh interval instead of immediately firing again.
      return Math.max(attempted, completed, enabled, !attempted && !completed && !enabled ? now() : 0) + hours * 3600000;
    }
    function publish(errorCode = status.errorCode) {
      const state = getState(), due = nextDue(state);
      const next = { running: !!active, pending: forced, nextRunAt: due ? new Date(due).toISOString() : null, errorCode,
        message: !state.settings?.taskReviewEnabled ? '定时提醒已关闭' : active ? '正在分析当前待办' : state.taskReview?.error || (deferUntil > now() ? '等待 AI 空闲后分析' : '等待下一次分析') };
      const key = JSON.stringify(next); status = next;
      if (key !== lastStatus) { lastStatus = key; onStatus(Object.assign({}, next)); }
    }
    function schedule(delay = 0) {
      const at = now() + delay;
      if (timer !== null && timerAt <= at) return;
      if (timer !== null) clear(timer);
      timerAt = at;
      timer = later(() => { timer = null; timerAt = 0; pump(); }, delay);
    }
    function cancel() {
      if (!active) return;
      clear(active.watchdog);
      if (active.requestId) send('taskReviewCancel', { requestId: active.requestId });
      active = null;
    }
    function saveReport(patch) {
      const state = getState(); onState(Object.assign({}, state, { taskReview: Object.assign({}, state.taskReview || {}, patch) }));
    }
    function batches(items) {
      const out = []; let batch = [], size = 0;
      for (const item of items) {
        const bytes = JSON.stringify(item).length;
        if (batch.length && (batch.length >= 100 || size + bytes > 46000)) { out.push(batch); batch = []; size = 0; }
        batch.push(item); size += bytes;
      }
      if (batch.length) out.push(batch); return out;
    }
    function finishError(code) {
      cancel(); forced = false; deferUntil = 0;
      const messages = { missingKey: '请先配置 DeepSeek API Key', unauthorized: 'DeepSeek API Key 无效，请更新后重试', insufficientBalance: 'DeepSeek 余额不足，请充值后重试', network: '网络连接失败，可稍后立即分析', rateLimited: 'DeepSeek 请求过于频繁，可稍后立即分析', busy: 'AI 正忙，本轮尚未完成，可稍后立即分析', serviceUnavailable: 'DeepSeek 暂时不可用，可稍后立即分析', stale: '待办已变化，本轮建议未发送，可重新分析' };
      saveReport({ error: messages[code] || '本轮分析未完成，未发送提醒，可重试' }); publish(code);
    }
    function dispatch() {
      if (!active || active.requestId) return;
      // Recheck after a retry or between batches, before sending the old
      // snapshot again. Finished or edited tasks must not be analyzed as current.
      if (fingerprint() !== active.signature) { finishError('stale'); return; }
      if (!canRun()) { schedule(30000); return; }
      if (deferUntil > now()) { schedule(Math.min(30000, deferUntil - now())); return; }
      const run = active;
      const requestId = 'task-review-' + now().toString(36) + '-' + (++serial); run.requestId = requestId;
      run.watchdog = later(() => { if (active === run && run.requestId === requestId) finishError('timeout'); }, 120000);
      const accepted = send('taskReviewAnalyze', { requestId, model: run.model, currentTime: iso(), items: run.batches[run.index] });
      if (accepted === false) finishError('network');
      publish('');
    }
    function pump() {
      const state = getState();
      if (!state.settings?.taskReviewEnabled) { cancel(); forced = false; deferUntil = 0; publish(''); return; }
      if (!state.settings.taskReviewEnabledAt) {
        onState(Object.assign({}, state, { settings: Object.assign({}, state.settings, { taskReviewEnabledAt: iso() }) }));
        schedule(); publish(); return;
      }
      if (active && active.model !== Core.teamsAnalysisModel(state)) { cancel(); forced = false; publish(''); return; }
      if (active) { dispatch(); return; }
      if ((!forced && now() < nextDue(state)) || !canRun()) { publish(); return; }
      forced = false;
      const items = candidates();
      saveReport({ lastAttemptAt: iso(), error: '' });
      if (!items.length) { saveReport({ lastCompletedAt: iso(), summary: '当前没有未完成的待办。', recommendations: [], error: '', inputFingerprint: fingerprint(items) }); publish(''); return; }
      active = { model: Core.teamsAnalysisModel(state), signature: fingerprint(items), original: new Map(items.map(item => [item.id, item])),
        batches: batches(items), index: 0, selected: [], requestId: '', failures: 0, watchdog: null, round: 0 };
      dispatch();
    }
    function receive(event) {
      if (event?.type === 'taskReviewTick') { schedule(); return true; }
      if (event?.type !== 'taskReviewResult') return false;
      const run = active;
      if (!run || run.requestId !== event.requestId) return true;
      if (!getState().settings?.taskReviewEnabled || Core.teamsAnalysisModel(getState()) !== run.model) { cancel(); publish(''); return true; }
      clear(run.watchdog);
      if (event.success !== true) {
        const code = String(event.errorCode || 'badResponse');
        if (['busy', 'rateLimited', 'serviceUnavailable', 'network'].includes(code) && ++run.failures <= 2) {
          const seconds = Number(event.retryAfterSeconds);
          // Match the native transport's 24-hour maximum. Shortening Retry-After
          // consumes retries against the native cooldown before it can expire.
          const delay = Math.max(30000, Number.isFinite(seconds) ? Math.min(86400, Math.max(0, seconds)) * 1000 : 0);
          run.requestId = ''; deferUntil = now() + delay; schedule(30000); publish(code);
        } else finishError(code);
        return true;
      }
      const result = event.result || event;
      const allowed = new Set(run.batches[run.index].map(item => item.id));
      if (event.model !== run.model || typeof result.summary !== 'string' || !result.summary.trim() || result.summary.length > 1200 ||
          !Array.isArray(result.recommendations) || result.recommendations.length > 3 ||
          new Set(result.recommendations.map(item => item.id)).size !== result.recommendations.length ||
          result.recommendations.some(item => !allowed.has(item.id) || typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > 300)) {
        finishError('badResponse'); return true;
      }
      if (fingerprint() !== run.signature) { finishError('stale'); return true; }
      run.selected.push(...result.recommendations); run.failures = 0;
      if (++run.index < run.batches.length) { run.requestId = ''; dispatch(); return true; }
      if (run.batches.length > 1 && run.selected.length) {
        if (++run.round > 4) { finishError('badResponse'); return true; }
        const selectedIDs = Array.from(new Set(run.selected.map(item => item.id)));
        run.batches = batches(selectedIDs.map(id => run.original.get(id))); run.selected = []; run.index = 0; run.requestId = ''; dispatch(); return true;
      }
      const recommendations = run.selected.slice(0, 3);
      const requestId = run.requestId; active = null; deferUntil = 0;
      const summary = run.batches.length === 1 ? result.summary : '已分析当前待办，建议优先完成以下任务。';
      saveReport({ lastCompletedAt: iso(), summary, recommendations, error: '', inputFingerprint: run.signature });
      // Native only accepts IDs from this completed request and checks its
      // epoch. Titles for the notification always come from submitted tasks.
      if (recommendations.length) send('taskReviewNotify', { requestId, summary, taskIDs: recommendations.map(item => item.id) });
      publish(''); return true;
    }
    function reset() { cancel(); if (timer !== null) clear(timer); timer = null; timerAt = 0; forced = false; deferUntil = 0; publish(''); }
    return Object.freeze({ reconcile: () => schedule(), receive, runNow: () => { if (active || !getState().settings?.taskReviewEnabled) return; forced = true; publish(''); schedule(); }, reset,
      getStatus: () => Object.assign({}, status) });
  }
  return Object.freeze({ create });
});
