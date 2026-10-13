'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {Worker} = require('node:worker_threads');
const {BrowserConnection} = require('./browser.cjs');
const {parseDocument} = require('./documents.cjs');
const Manual = require('../Resources/teams-browser.js');
class TeamsService {
  constructor(options) { Object.assign(this, options); this.status = {running: false, phase: 'idle', message: '登录 Teams 后自动同步。'}; this.generation = 0; this.parsing = Promise.resolve(); }
  emitStatus(value = this.status) { this.status = {...this.status, ...value}; this.emit({type: 'teamsAutoStatus', ...this.status}); }
  async browser(show) {
    const browser = this.getState().settings.teamsBrowser === 'chrome' ? 'chrome' : 'edge';
    if (this.connection?.browser !== browser) { this.connection?.close(); this.connection = new BrowserConnection(path.join(this.folder, `teams-${browser}-profile`), browser); }
    return this.connection.page(show);
  }
  async login() { try { await this.browser(true); if (!this.worker) this.emitStatus({phase: 'login_required', message: '请在打开的浏览器登录 Teams，完成后点击立即同步。'}); } catch (e) { this.emitStatus({phase: 'error', message: e.message, running: false}); } }
  async manual(operation, selectionOnly = false) {
    try {
      if (this.worker || this.starting) throw new Error('请先停止自动读取，再手动读取当前页。');
      if (!this.getState().settings.teamsBrowserAutomation) throw new Error('请先开启 Teams 浏览器读取。');
      const browser = await this.browser(false);
      const info = await browser.evaluate('({url:location.href,title:document.title})');
      const safe = Manual.safeURL(info?.url);
      if (!safe || (operation === 'pin' && !Manual.hasSpecificRoute(safe.url))) throw new Error('请先在 CampusDesk 的 Teams 浏览器中打开具体频道。');
      const page = {url: safe.url, label: String(info.title || 'Teams').slice(0,100), kind: 'auto'};
      if (operation === 'pin') { this.emit({type:'pinTeamsPage',page}); return; }
      const extractor = fs.readFileSync(path.join(this.resources,'teams.js'),'utf8');
      const raw = await browser.evaluate(Manual.injectionScript(extractor,page,selectionOnly));
      if (typeof raw !== 'string' || raw.length > 4*1024*1024) throw new Error('页面返回内容无效。');
      const value = JSON.parse(raw), snapshot = value.snapshot;
      if (value.bridgeError || snapshot?.source !== 'teams' || !Manual.matchRoute(snapshot.url,page.url)) throw new Error('页面已改变，请重新读取。');
      snapshot.coverage = 'visible'; snapshot.captureMethod = 'browser-cdp';
      this.emit({type:'snapshot',snapshot});
      this.emitStatus({message:snapshot.parseError ? '当前页未识别出正文，请选择文字后重试。' : '已读取当前 Teams 页面。'});
    } catch (e) { this.emitStatus({message:e.message}); }
  }
  cache() {
    const result = [], seen = new Set();
    for (const snapshot of Object.values(this.getState().snapshots.teams || {})) for (const row of [...snapshot.posts || [], ...snapshot.tasks || []]) for (const file of row.attachments || []) {
      if (file.text && !file.truncated && file.versionKey && !seen.has(file.id) && file.extractionStatus !== 'error') { seen.add(file.id); result.push({accountId: snapshot.accountId, attachmentId: file.id, versionKey: file.versionKey}); }
    }
    return result.slice(0, 300);
  }
  async start(focus = 'all') {
    if (this.worker || this.starting) return;
    this.starting = true; const generation = ++this.generation;
    try {
      const browser = await this.browser(false);
      if (generation !== this.generation) return;
      const settings = this.getState().settings;
      const checkpointFile = path.join(this.folder, 'teams-checkpoint.json');
      const worker = new Worker(path.join(__dirname, 'teams-worker.cjs'), {workerData: {resources: this.resources,
        config: {focus, includeChats: settings.graphIncludeChats !== false, maxSeconds: 600, attachmentCache: this.cache()},
        checkpoint: this.readJSON(checkpointFile, 2000000) || {}}});
      this.worker = worker; this.emitStatus({running: true, phase: 'connecting', message: '正在连接 Teams 浏览器…'});
      worker.on('message', message => {
        if (generation !== this.generation) return;
        if (message.type === 'evaluate') {
          const shared = message.shared, header = new Int32Array(shared, 0, 2);
          Promise.resolve().then(() => browser.evaluate(message.script)).then(value => ({ok: true, value}), e => ({ok: false, error: e.message, code: e.code})).then(value => {
            let encoded = Buffer.from(JSON.stringify(value));
            if (encoded.length > shared.byteLength - 8) encoded = Buffer.from(JSON.stringify({ok: false, error: 'Teams 返回内容过大'}));
            new Uint8Array(shared, 8, encoded.length).set(encoded); Atomics.store(header, 1, encoded.length); Atomics.store(header, 0, 1); Atomics.notify(header, 0);
          });
        } else if (message.type === 'checkpoint') {
          try { this.saveJSON(checkpointFile, message.checkpoint); } catch { this.stop('同步进度无法保存，请检查磁盘空间。'); }
        } else if (message.type === 'event') {
          try { this.event(message.event, generation); } catch (e) { this.stop(e.message); }
        }
      });
      worker.on('error', error => { if (generation === this.generation) this.stop('Teams 同步未完成：' + error.message); });
      worker.on('exit', () => { if (this.worker === worker) { this.worker = null; if (this.status.running) this.emitStatus({running: false, phase: 'partial', message: '本轮读取结束，请核对覆盖范围。'}); } });
    } catch (e) { this.emitStatus({running: false, phase: 'error', message: e.message}); }
    finally { this.starting = false; }
  }
  event(event, generation) {
    const account = event.accountId || event.snapshot?.accountId || event.status?.accountId;
    if (account) this.bindAccount(account);
    if (event.type === 'snapshot') this.emit(event);
    else if (event.type === 'progress' || event.type === 'done') this.emitStatus(event.status);
    else if (event.type === 'error') this.emitStatus({message: event.message});
    else if (event.type === 'attachmentUnchanged') this.emit({...event, type: 'teamsAttachmentUnchanged'});
    else if (event.type === 'attachment') {
      this.parsing = this.parsing.then(async () => {
        if (generation !== this.generation || event.accountId !== this.account) return;
        const bytes = Buffer.from(event.base64 || '', 'base64');
        if (!bytes.length || bytes.length > 12 * 1024 * 1024) return;
        const file = path.join(this.folder, 'attachments', crypto.createHash('sha256').update(event.accountId + '|' + event.attachmentId).digest('hex'));
        fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, bytes);
        const result = await parseDocument(bytes, event.title, event.mimeType, this.langPath);
        if (generation !== this.generation || event.accountId !== this.account) return;
        this.emit({type: 'teamsAttachment', accountId: event.accountId, snapshotId: event.snapshotId, attachmentId: event.attachmentId, versionKey: event.versionKey, result});
      }).catch(() => this.emitStatus({message: '部分附件识别失败，已保留原有数据，请查看原件。'}));
    }
  }
  bindAccount(account) {
    if (typeof account !== 'string' || !account || account.length > 300) throw new Error('无法确认 Teams 账号，已停止读取。');
    if (!this.account) this.account = this.readJSON(path.join(this.folder, 'teams-identity.json'), 8192)?.accountId;
    if (this.account === account) return;
    if (this.account || Object.keys(this.getState().snapshots.teams || {}).length) this.resetAccount();
    this.saveJSON(path.join(this.folder, 'teams-identity.json'), {accountId: account}); this.account = account;
  }
  stop(message = '自动读取已停止，已保留成功读取的内容。') {
    ++this.generation; this.worker?.terminate(); this.worker = null;
    this.emitStatus({running: false, phase: 'paused', message});
  }
}
module.exports = {TeamsService};
