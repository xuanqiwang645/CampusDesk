/* Teams analysis scheduler. Native owns credentials/network; Core owns task admission. */
(function (root, factory) {
  'use strict';
  const api = factory(typeof module === 'object' && module.exports ? require('./core.js') : root.CampusCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CampusTeamsAnalysisClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  const MAX_ITEM = 32000, CHUNK = 20000, MAX_BATCH = 48000, MAX_ITEMS = 8;
  const TRANSIENT = new Set(['rateLimited', 'serviceUnavailable', 'network', 'timeout', 'busy']);
  function split(text, size = CHUNK) {
    const parts = [];
    for (let start = 0; start < text.length;) {
      let end = Math.min(text.length, start + size);
      // Keep UTF-16 surrogate pairs intact at the boundary.
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      parts.push(text.slice(start, end)); start = end;
    }
    return parts.length ? parts : [''];
  }
  function resultIsValid(item) {
    if (!item || typeof item.id !== 'string' || typeof item.fingerprint !== 'string' || typeof item.summary !== 'string' || item.summary.length > 1200) return false;
    if (!['actionable', 'notice', 'uncertain'].includes(item.classification) || !Array.isArray(item.tasks) || item.tasks.length > 8) return false;
    if (item.classification !== 'actionable' && item.tasks.length) return false;
    if (item.classification === 'actionable' && !item.tasks.length) return false;
    return item.tasks.every(task => task && ['homework', 'activity'].includes(task.category) &&
      ['title', 'summary', 'evidence', 'deadlineText'].every(key => typeof task[key] === 'string') &&
      task.title.trim() && task.title.length <= 180 && task.summary.length <= 500 &&
      task.evidence.trim() && task.evidence.length <= 600 && task.deadlineText.length <= 400);
  }
  function create(options) {
    const { getState, onState, send } = options;
    const canRun = options.canRun || (() => true), onStatus = options.onStatus || (() => {});
    const now = options.now || Date.now, later = options.setTimeout || setTimeout, clear = options.clearTimeout || clearTimeout;
    const jobs = new Map();
    let active = null, timer = null, timerAt = 0, scope = '', serial = 0, blocked = null, lastStatus = '', deferUntil = 0, malformedStreak = 0;
    let status = { running: false, activeIds: [], phase: '', message: '', blocked: false, errorCode: '', pending: 0 };
    function publish() {
      const state = getState();
      const enabled = state.settings?.teamsAnalysisEnabled === true;
      const pending = enabled ? Core.getTeamsAnalysisSummary(state).pending : 0;
      const next = { running: !!active, activeIds: active ? Array.from(new Set(active.entries.map(entry => entry.job.input.id))) : [],
        phase: active?.phase || '', blocked: !!blocked, errorCode: blocked?.code || '', pending,
        message: !enabled ? '自动整理已关闭' : blocked ? blocked.message : active ? (active.phase === 'summarize' ? '正在读取消息和附件全文' : '正在归纳作业与活动') : deferUntil > now() ? '稍后重试分析' : pending ? '等待分析' : '分析已完成' };
      const key = JSON.stringify(next); status = next;
      if (key !== lastStatus) { lastStatus = key; onStatus(Object.assign({}, next)); }
    }
    function cancelActive() {
      if (!active) return;
      const old = active; active = null;
      clear(old.watchdog);
      for (const entry of old.entries) entry.job.inFlight.delete(entry.index);
      send('teamsAnalysisCancel', { requestId: old.requestId });
    }
    function clearTimer() { if (timer !== null) clear(timer); timer = null; timerAt = 0; }
    function schedule(delay = 0) {
      const at = now() + delay;
      if (timer !== null && timerAt <= at) return;
      clearTimer(); timerAt = at;
      timer = later(() => { timer = null; timerAt = 0; pump(); }, delay);
    }
    function currentInputs() {
      // Recent instructions reach the dashboard first while the historical
      // backlog continues through the same complete queue.
      return Core.getTeamsAnalysisInputs(getState()).slice().sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
    }
    function writeFailures(entries, message) {
      const unique = new Map(entries.map(entry => [entry.job.input.id, entry.job.input]));
      const state = getState();
      onState(Core.applyTeamsAnalysisResults(state, { model: Core.teamsAnalysisModel(state), results: Array.from(unique.values(), input => ({
        id: input.id, fingerprint: input.fingerprint, status: 'failed', summary: '', classification: 'uncertain', tasks: [], error: message, analyzedAt: new Date(now()).toISOString()
      })) }));
      for (const id of unique.keys()) jobs.delete(id);
    }
    function failure(batch, code, retryAfterSeconds) {
      if (active !== batch) return;
      clear(batch.watchdog); active = null;
      for (const entry of batch.entries) entry.job.inFlight.delete(entry.index);
      if (code === 'badResponse') {
        // Isolate a bad quotation/JSON result to its message, instead of making
        // one ambiguous post prevent every other channel from being analyzed.
        if (batch.entries.length > 1) {
          for (const entry of batch.entries) entry.job.single = true;
          schedule(); publish(); return;
        }
        const message = 'AI 返回内容不完整，未生成待办，请重试';
        writeFailures(batch.entries, message);
        if (++malformedStreak >= 3) blocked = { code, message: '连续分析结果未通过检查，队列已暂停，请重试' };
        else schedule();
        publish(); return;
      }
      const retryable = TRANSIENT.has(code);
      const retryCount = Math.max(...batch.entries.map(entry => ++entry.job.failures));
      if (retryable && retryCount <= 2) {
        const delay = Math.min(86400000, Math.max(code === 'busy' ? 5000 : 15000 * retryCount, (Number(retryAfterSeconds) || 0) * 1000));
        deferUntil = now() + delay; schedule(delay);
      } else {
        const messages = { missingKey: '请先在学习助手中配置 DeepSeek API Key', unauthorized: 'DeepSeek API Key 无效，请更新后重试', insufficientBalance: 'DeepSeek 余额不足，请充值后重试', modelUnavailable: '当前 DeepSeek 模型不可用，请调整模型后重试', rateLimited: 'DeepSeek 请求过于频繁，请稍后重试', network: '网络连接失败，请稍后重试', serviceUnavailable: 'DeepSeek 暂时不可用，请稍后重试', timeout: '分析超时，请稍后重试', busy: '学习助手正在使用 AI，请稍后重试', cancelled: '分析已暂停，请重试', badResponse: 'AI 返回内容不完整，未生成待办，请重试' };
        const message = messages[code] || '分析未完成，未生成待办，请重试';
        writeFailures(batch.entries, message);
        // A provider/authentication failure affects the whole queue. Do not burn
        // through every remaining message with identical unsuccessful requests.
        blocked = { code, message }; deferUntil = 0;
      }
      publish();
    }
    function makeJob(input) {
      const text = String(input.text || '');
      return { input, phase: text.length > MAX_ITEM ? 'summarize' : 'classify', parts: text.length > MAX_ITEM ? split(text) : [text],
        results: new Map(), inFlight: new Set(), level: 0, failures: 0 };
    }
    function advance(job) {
      if (job.phase !== 'summarize' || job.results.size !== job.parts.length) return;
      const text = '以下为同一消息全部正文及附件的分段分析。请综合所有分段，保留否定、取消和不确定信息；evidence 与 deadlineText 必须逐字引用原文片段。\n' +
        job.parts.map((_, i) => {
          const result = job.results.get(i);
          // Keep quotations as literal text. JSON escaping would turn quoted
          // newlines/backslashes into different evidence at the next level.
          return '分段 ' + (i + 1) + '\n归纳：' + result.summary + '\n分类：' + result.classification + '\n' +
            result.tasks.map(task => ['类别：' + task.category, '标题：' + task.title, '说明：' + task.summary, '原文证据：' + task.evidence, '截止原文：' + task.deadlineText].join('\n')).join('\n');
        }).join('\n\n');
      if (++job.level > 8) {
        writeFailures([{ job }], '消息内容过长，无法可靠归纳，未生成待办'); return;
      }
      job.phase = text.length > MAX_ITEM ? 'summarize' : 'classify';
      job.parts = text.length > MAX_ITEM ? split(text) : [text]; job.results.clear(); job.inFlight.clear();
    }
    function pump() {
      const state = getState(), model = Core.teamsAnalysisModel(state);
      if (state.settings?.teamsAnalysisEnabled !== true) {
        cancelActive(); jobs.clear(); blocked = null; deferUntil = 0; malformedStreak = 0; scope = ''; publish(); return;
      }
      const inputs = currentInputs(), nextScope = model + '|' + Array.from(new Set(inputs.map(input => input.accountId || ''))).sort().join('|');
      if (scope !== nextScope) { cancelActive(); jobs.clear(); blocked = null; deferUntil = 0; malformedStreak = 0; scope = nextScope; }
      const byID = new Map(inputs.map(input => [input.id, input]));
      if (active && active.entries.some(entry => byID.get(entry.job.input.id)?.fingerprint !== entry.job.input.fingerprint)) cancelActive();
      for (const [id, job] of jobs) if (byID.get(id)?.fingerprint !== job.input.fingerprint) jobs.delete(id);
      if (active || blocked || !canRun()) { publish(); return; }
      if (now() < deferUntil) { schedule(deferUntil - now()); publish(); return; }
      deferUntil = 0;
      const entries = []; let length = 0, phase = '';
      for (const input of inputs) {
        const record = Core.getTeamsAnalysisRecord(state, input.id);
        if (['ready', 'failed'].includes(record?.status) && record.model === model && record.fingerprint === input.fingerprint) continue;
        let job = jobs.get(input.id); if (!job) { job = makeJob(input); jobs.set(input.id, job); }
        if (phase && phase !== job.phase) continue;
        if (job.single && entries.length) break;
        for (let i = 0; i < job.parts.length && entries.length < MAX_ITEMS; i++) {
          if (job.results.has(i) || job.inFlight.has(i)) continue;
          const text = job.parts[i];
          if (length + text.length > MAX_BATCH) break;
          phase = job.phase; length += text.length; job.inFlight.add(i);
          entries.push({ job, index: i, id: 'item-' + (++serial), text });
          if (job.single) break;
        }
        if ((job.single && entries.length) || entries.length >= MAX_ITEMS || length >= MAX_BATCH) break;
      }
      if (!entries.length) { publish(); return; }
      const requestId = 'teams-analysis-' + now().toString(36) + '-' + (++serial);
      const batch = { requestId, phase, model, entries, watchdog: null };
      active = batch;
      batch.watchdog = later(() => { if (active === batch) { send('teamsAnalysisCancel', { requestId }); failure(batch, 'timeout'); } }, 120000);
      const accepted = send('teamsAnalyze', { requestId, phase, model, items: entries.map(entry => ({
        id: entry.id, fingerprint: entry.job.input.fingerprint, title: String(entry.job.input.title || '').slice(0, 500),
        channel: String(entry.job.input.channel || '').slice(0, 300), publishedAt: entry.job.input.publishedAt || '',
        sourceIncomplete: !!entry.job.input.sourceIncomplete, text: entry.text
      })) });
      if (accepted === false) failure(batch, 'network');
      publish();
    }
    function receive(event) {
      if (!event || event.type !== 'teamsAnalysisResult') return false;
      const batch = active;
      if (!batch || event.requestId !== batch.requestId) return true;
      const state = getState(), byID = new Map(currentInputs().map(input => [input.id, input]));
      if (!state.settings?.teamsAnalysisEnabled || Core.teamsAnalysisModel(state) !== batch.model) { cancelActive(); schedule(); return true; }
      if (batch.entries.some(entry => byID.get(entry.job.input.id)?.fingerprint !== entry.job.input.fingerprint)) { cancelActive(); schedule(); return true; }
      if (event.success !== true) { failure(batch, String(event.errorCode || 'badResponse'), event.retryAfterSeconds); return true; }
      if (event.phase !== batch.phase || event.model !== batch.model || !Array.isArray(event.results) || event.results.length !== batch.entries.length) { failure(batch, 'badResponse'); return true; }
      const received = new Map();
      for (const item of event.results) {
        if (!resultIsValid(item) || received.has(item.id)) { failure(batch, 'badResponse'); return true; }
        received.set(item.id, item);
      }
      if (batch.entries.some(entry => !received.has(entry.id) || received.get(entry.id).fingerprint !== entry.job.input.fingerprint)) { failure(batch, 'badResponse'); return true; }
      clear(batch.watchdog); active = null;
      malformedStreak = 0;
      const completed = [], summarized = new Set();
      for (const entry of batch.entries) {
        const job = entry.job; job.inFlight.delete(entry.index);
        if (byID.get(job.input.id)?.fingerprint !== job.input.fingerprint) { jobs.delete(job.input.id); continue; }
        const result = received.get(entry.id); job.failures = 0;
        if (batch.phase === 'summarize') {
          // Only schema fields enter the reduction, never model-supplied IDs.
          job.results.set(entry.index, { summary: result.summary, classification: result.classification, tasks: result.tasks }); summarized.add(job);
        } else {
          completed.push(Object.assign({}, result, { id: job.input.id, status: 'ready', analyzedAt: new Date(now()).toISOString() })); jobs.delete(job.input.id);
        }
      }
      if (completed.length) onState(Core.applyTeamsAnalysisResults(getState(), { model: batch.model, results: completed }));
      for (const job of summarized) advance(job);
      publish(); schedule(); return true;
    }
    function retry(id) {
      cancelActive(); clearTimer(); blocked = null; deferUntil = 0; malformedStreak = 0;
      const state = getState(), cache = Object.assign({}, state.teamsAnalysis || {});
      for (const key of Object.keys(cache)) if ((!id || key === id) && cache[key].status === 'failed') delete cache[key];
      if (id) jobs.delete(id); else jobs.clear();
      onState(Object.assign({}, state, { teamsAnalysis: cache })); schedule();
    }
    function reset() { cancelActive(); clearTimer(); jobs.clear(); scope = ''; blocked = null; deferUntil = 0; malformedStreak = 0; publish(); }
    return Object.freeze({ reconcile: () => schedule(), receive, retry, reset, getStatus: () => Object.assign({}, status, { activeIds: status.activeIds.slice() }) });
  }
  return Object.freeze({ create, split });
});
