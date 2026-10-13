'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { allowedURL } = require('../Resources/teams-auto-runner.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class BrowserConnection {
  constructor(profile, browser = 'edge') { this.profile = profile; this.browser = browser; this.pending = new Map(); this.sequence = 0; }
  executable() {
    const relative = this.browser === 'chrome' ? 'Google/Chrome/Application/chrome.exe' : 'Microsoft/Edge/Application/msedge.exe';
    const candidates = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
      .filter(Boolean).map(root => path.join(root, relative));
    const found = candidates.find(file => fs.existsSync(file));
    if (!found) throw new Error(`请先安装 ${this.browser === 'chrome' ? 'Google Chrome' : 'Microsoft Edge'}，然后重新打开 Teams。`);
    return found;
  }
  async endpoint() {
    try {
      const lines = fs.readFileSync(path.join(this.profile, 'DevToolsActivePort'), 'utf8').trim().split('\n');
      const port = Number(lines[0]);
      if (!Number.isInteger(port) || port < 1024 || port > 65535 || !/^\/devtools\/browser\/[a-z0-9-]+$/i.test(lines[1])) return null;
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {signal: AbortSignal.timeout(1500)});
      const info = await response.json(), url = new URL(info.webSocketDebuggerUrl);
      if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || Number(url.port) !== port || url.pathname !== lines[1]) return null;
      return url.href;
    } catch { return null; }
  }
  async connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    fs.mkdirSync(this.profile, {recursive: true, mode: 0o700});
    let endpoint = await this.endpoint();
    if (!endpoint) {
      const child = spawn(this.executable(), ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
        `--user-data-dir=${this.profile}`, '--no-first-run', '--no-default-browser-check', 'https://teams.cloud.microsoft/'],
      {stdio: 'ignore', detached: true, windowsHide: false});
      let failure;
      child.on('error', error => { failure = error; }); child.unref();
      for (let i = 0; i < 60 && !endpoint; i++) { if (failure) throw failure; await sleep(500); endpoint = await this.endpoint(); }
      if (!endpoint) throw new Error('浏览器未能启动，请关闭 CampusDesk 的 Teams 浏览器窗口后重试。');
    }
    this.ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('浏览器连接超时')), 10000);
      this.ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, {once: true});
      this.ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('无法连接 Teams 浏览器')); }, {once: true});
    });
    this.ws.addEventListener('message', event => {
      let data; try { data = JSON.parse(event.data); } catch { return; }
      const pending = this.pending.get(data.id); if (!pending) return;
      this.pending.delete(data.id); clearTimeout(pending.timer);
      if (data.error) pending.reject(new Error('浏览器操作失败')); else pending.resolve(data.result || {});
    });
    this.ws.addEventListener('close', () => this.rejectPending());
  }
  rejectPending() { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Teams 浏览器已关闭')); } this.pending.clear(); }
  command(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState !== WebSocket.OPEN) return reject(new Error('Teams 浏览器未连接'));
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Teams 浏览器响应超时')); }, 65000);
      this.pending.set(id, {resolve, reject, timer});
      this.ws.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
    });
  }
  async page(show = false) {
    await this.connect();
    const {targetInfos = []} = await this.command('Target.getTargets');
    let target = targetInfos.find(t => t.type === 'page' && t.targetId === this.targetId && allowedURL(t.url))
      || targetInfos.find(t => t.type === 'page' && allowedURL(t.url));
    if (!target) {
      const {targetId} = await this.command('Target.createTarget', {url: 'https://teams.cloud.microsoft/'});
      target = {targetId};
    }
    this.targetId = target.targetId;
    this.sessionId = (await this.command('Target.attachToTarget', {targetId: this.targetId, flatten: true})).sessionId;
    if (show) await this.command('Target.activateTarget', {targetId: this.targetId});
    return this;
  }
  async evaluate(script) {
    const {targetInfo} = await this.command('Target.getTargetInfo', {targetId: this.targetId});
    if (!allowedURL(targetInfo.url)) { const error = new Error('请在浏览器完成 Teams 登录后重新同步。'); error.code = 'TAB_CHANGED'; throw error; }
    const result = await this.command('Runtime.evaluate', {expression: script, returnByValue: true, awaitPromise: true}, this.sessionId);
    if (result.exceptionDetails) throw new Error('Teams 页面读取失败，请刷新原网页。');
    return result.result?.value;
  }
  close() { this.rejectPending(); this.ws?.close(); this.ws = null; }
}
module.exports = {BrowserConnection};
