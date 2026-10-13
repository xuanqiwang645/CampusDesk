'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Graph = require('../Resources/graph.js');
const ROOT = 'https://graph.microsoft.com/v1.0';
const scopes = ['User.Read', 'Team.ReadBasic.All', 'Channel.ReadBasic.All', 'ChannelMessage.Read.All', 'Chat.Read', 'EduAssignments.Read'].map(s => 'https://graph.microsoft.com/' + s);
function validURL(raw) {
  try {
    const u = new URL(raw);
    return typeof raw === 'string' && raw.length < 65536 && !/[\\\s]/.test(raw) && u.origin === 'https://graph.microsoft.com' && u.pathname.startsWith('/v1.0/') && !u.username && !u.password && !u.hash
      && ![...u.searchParams.keys()].some(k => /^(access_token|refresh_token|id_token|client_secret|authorization)$/i.test(k));
  } catch { return false; }
}
function validConfig(clientId, tenant) {
  return /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(clientId) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(clientId)
    && /^(?:organizations|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)$/i.test(tenant);
}
class GraphService {
  constructor(options) {
    Object.assign(this, options); this.revision = 0; this.progress = {};
    this.config = this.readJSON(path.join(this.folder, 'graph-config.json'), 8192) || this.readJSON(path.join(this.resources, 'MicrosoftGraphConfig.json'), 8192) || {};
  }
  status(message) {
    this.emit({type: 'graphStatus', configured: validConfig(this.config.clientId || '', this.config.tenant || 'organizations'), connected: !!this.account,
      clientId: this.config.clientId || '', tenant: this.config.tenant || 'organizations', displayName: this.account?.name || '',
      busy: !!this.busy || !!this.signingIn, ...this.progress, ...(message ? {message} : {})});
  }
  async initialize() {
    if (!validConfig(this.config.clientId || '', this.config.tenant || 'organizations')) return;
    const {PublicClientApplication} = require('@azure/msal-node');
    const key = crypto.createHash('sha256').update(this.config.clientId + '|' + this.config.tenant).digest('hex');
    this.cacheFile = path.join(this.folder, `graph-auth-${key}.bin`);
    this.client = new PublicClientApplication({auth: {clientId: this.config.clientId, authority: `https://login.microsoftonline.com/${this.config.tenant || 'organizations'}`},
      cache: {cachePlugin: {
        beforeCacheAccess: async context => {
          if (!this.safeStorage.isEncryptionAvailable()) throw new Error('Windows 凭据加密暂不可用');
          if (fs.existsSync(this.cacheFile) && fs.statSync(this.cacheFile).size < 2 * 1024 * 1024) context.tokenCache.deserialize(this.safeStorage.decryptString(fs.readFileSync(this.cacheFile)));
        },
        afterCacheAccess: async context => {
          if (!context.cacheHasChanged) return;
          if (!this.safeStorage.isEncryptionAvailable()) throw new Error('Windows 凭据加密暂不可用');
          fs.mkdirSync(this.folder, {recursive: true});
          const temp = this.cacheFile + '.tmp'; fs.writeFileSync(temp, this.safeStorage.encryptString(context.tokenCache.serialize())); fs.renameSync(temp, this.cacheFile);
        }
      }}});
    this.account = (await this.client.getTokenCache().getAllAccounts())[0];
    this.status();
  }
  async configure(clientId, tenant) {
    clientId = String(clientId || '').trim(); tenant = String(tenant || '').trim().toLowerCase();
    if (!validConfig(clientId, tenant)) throw new Error('请填写有效的 Microsoft 应用 ID 和租户。');
    if (this.signingIn) throw new Error('请先完成当前登录。');
    await this.signOut(); this.config = {clientId, tenant}; this.saveJSON(path.join(this.folder, 'graph-config.json'), this.config);
    await this.initialize(); this.status('配置已保存。Windows 桌面应用需注册 http://localhost 回调地址。');
  }
  async signIn() {
    if (this.signingIn) return;
    if (!this.client) await this.initialize();
    if (!this.client) { this.status('请先配置 Microsoft 应用 ID。'); return; }
    this.signingIn = true; const revision = this.revision; this.status('请在 Microsoft 网页完成登录。');
    try {
      const result = await this.client.acquireTokenInteractive({scopes, openBrowser: url => this.openExternal(url), prompt: 'select_account', timeout: 180000});
      if (revision !== this.revision) { await this.client.getTokenCache().removeAccount(result.account); return; }
      this.account = result.account; this.status('已登录，正在同步。');
    } catch (e) { this.progress = {requiresAdminConsent: /consent|65001|90094/i.test(e.errorCode || e.message), message: 'Microsoft 登录未完成，请检查应用配置及学校授权。'}; }
    finally { this.signingIn = false; this.status(); }
    if (this.account) await this.sync();
  }
  async signOut() {
    this.cancel(); if (this.client) { for (const account of await this.client.getTokenCache().getAllAccounts()) await this.client.getTokenCache().removeAccount(account); }
    this.account = null; this.progress = {}; this.resetAccount(); this.status('已退出 Teams。');
  }
  cancel() { this.revision++; this.controller?.abort(); this.busy = false; }
  async request(url, forceRefresh = false) {
    if (!validURL(url)) throw new Error('Graph 分页地址无效');
    const token = await this.client.acquireTokenSilent({account: this.account, scopes, forceRefresh});
    const response = await fetch(url, {headers: {Authorization: `Bearer ${token.accessToken}`}, redirect: 'error', signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(45000)])});
    if (response.status === 401 && !forceRefresh) return this.request(url, true);
    if ([429, 503].includes(response.status)) {
      const retry = response.headers.get('retry-after');
      const delay = /^\d+$/.test(retry || '') ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
      const error = new Error('服务暂时限流，已保存进度，稍后自动重试。'); error.throttled = true; error.retryAt = Date.now() + Math.max(1000, Math.min(86400000, delay || 60000)); throw error;
    }
    if (!response.ok) throw new Error(`Graph HTTP ${response.status}`);
    const text = await response.text(); if (text.length > 16 * 1024 * 1024) throw new Error('Graph 返回内容超出读取上限');
    return JSON.parse(text);
  }
  async collection(url) {
    const rows = [], visited = new Set();
    while (url) {
      if (visited.has(url) || visited.size >= 100) throw new Error('Graph 分页未完整读取');
      visited.add(url); const data = await this.request(url); if (!Array.isArray(data.value)) throw new Error('Graph 列表结构无法识别');
      rows.push(...data.value); if (rows.length > 10000) throw new Error('Graph 列表超出读取上限');
      url = data['@odata.nextLink'];
    }
    return rows;
  }
  async sync() {
    if (this.busy || !this.account) { this.status(); return; }
    if (this.retryAt > Date.now()) { this.status('服务暂时限流，稍后自动重试。'); return; }
    this.busy = true; const revision = ++this.revision; this.controller = new AbortController();
    const checkpointFile = path.join(this.folder, 'graph-checkpoint.json');
    const warnings = [], seen = new Set(), teams = {}, counts = {teams: 0, channels: 0, chats: 0, messages: 0, assignments: 0};
    let queue = [], accountID;
    const configKey = this.config.clientId + '|' + (this.config.tenant || 'organizations');
    const enqueue = (url, kind, context = {}) => { if (validURL(url) && !seen.has(url) && !queue.some(j => j.url === url)) queue.push({url, kind, context}); };
    const batch = data => { const normalized = Graph.normalizeBatch({...data, capturedAt: new Date().toISOString(), complete: false, userId: accountID}); try { this.saveSnapshots(normalized.snapshots); } catch (e) { e.storageFailure = true; throw e; } if (normalized.coverage?.capped) warnings.push('部分内容达到本地缓存上限。'); };
    try {
      const me = await this.request(ROOT + '/me?$select=id,displayName');
      if (!me.id || revision !== this.revision) return;
      accountID = me.id; this.bindAccount('graph:' + this.config.clientId + ':' + accountID);
      const saved = this.readJSON(checkpointFile, 2000000);
      if (saved?.configKey === configKey && saved?.accountId === accountID && Array.isArray(saved.jobs) && saved.jobs.length && saved.jobs.every(j => validURL(j.url) && ['teams','channels','messages','replies','chats','chatMessages','assignments'].includes(j.kind))) queue = saved.jobs;
      else {
        enqueue(ROOT + '/me/joinedTeams', 'teams'); enqueue(ROOT + '/me/teamwork/associatedTeams', 'teams');
        enqueue(ROOT + '/education/me/assignments?$top=50', 'assignments');
        if (this.getState().settings.graphIncludeChats !== false) enqueue(ROOT + '/me/chats?$top=50', 'chats');
      }
      const began = Date.now(); let pages = 0;
      while (queue.length && revision === this.revision && pages < 1000 && Date.now() - began < 600000) {
        const job = queue[0], c = job.context || {};
        try {
          const data = await this.request(job.url); if (revision !== this.revision) break;
          if (!Array.isArray(data.value)) throw new Error('Graph 列表结构无法识别');
          const rows = data.value;
          if (job.kind === 'teams') for (const team of rows) { if (!team.id) continue; teams[team.id] = team; counts.teams++; enqueue(`${ROOT}/teams/${encodeURIComponent(team.id)}/allChannels`, 'channels', {team}); }
          if (job.kind === 'channels') for (const channel of rows) {
            if (!channel.id || !c.team?.id) continue; counts.channels++;
            let base = `${ROOT}/teams/${encodeURIComponent(c.team.id)}/channels/${encodeURIComponent(channel.id)}`;
            if (channel['@odata.id']) { if (!validURL(channel['@odata.id'])) throw new Error('共享频道地址无法确认'); const u = new URL(channel['@odata.id']); u.pathname = u.pathname.replace(/^\/v1\.0\/tenants\/[^/]+\//, '/v1.0/'); u.search = ''; base = u.href; }
            enqueue(base + '/messages?$top=50', 'messages', {team: c.team, channel, base});
          }
          if (job.kind === 'messages' || job.kind === 'replies') {
            batch({...c, kind: 'channelMessages', messages: rows.map(r => job.kind === 'replies' ? {...r, replyToId: c.rootMessageId} : r)}); counts.messages += rows.length;
            if (job.kind === 'messages') for (const row of rows) if (row.id && !row.deletedDateTime) enqueue(`${c.base}/messages/${encodeURIComponent(row.id)}/replies?$top=50`, 'replies', {...c, rootMessageId: row.id});
          }
          if (job.kind === 'chats') for (const chat of rows) { if (!chat.id) continue; counts.chats++; enqueue(`${ROOT}/me/chats/${encodeURIComponent(chat.id)}/messages?$top=50`, 'chatMessages', {chat}); }
          if (job.kind === 'chatMessages') { batch({...c, kind: 'chatMessages', messages: rows}); counts.messages += rows.length; }
          if (job.kind === 'assignments') for (const summary of rows) {
            if (!summary.id || !summary.classId) continue;
            const base = `${ROOT}/education/classes/${encodeURIComponent(summary.classId)}/assignments/${encodeURIComponent(summary.id)}`;
            let assignment = {...summary}, providedFields = [], localWarnings = [];
            try { Object.assign(assignment, await this.request(base)); providedFields.push('instructions'); } catch (e) { if (e.throttled) throw e; localWarnings.push('作业要求未完整读取'); }
            try { assignment.resources = await this.collection(base + '/resources?$top=50'); providedFields.push('resources'); } catch (e) { if (e.throttled) throw e; localWarnings.push('作业附件未完整读取'); }
            try {
              assignment.submissions = (await this.collection(base + '/submissions?$top=50')).filter(s => s.recipient?.userId === accountID); providedFields.push('submissions');
              for (const submission of assignment.submissions) { try { submission.outcomes = await this.collection(`${base}/submissions/${encodeURIComponent(submission.id)}/outcomes?$top=50`); } catch (e) { if (e.throttled) throw e; localWarnings.push('教师反馈未完整读取'); } }
            } catch (e) { if (e.throttled) throw e; localWarnings.push('提交状态未完整读取'); }
            if (revision !== this.revision) break;
            batch({kind: 'assignment', assignment, class: teams[summary.classId] || {id: summary.classId}, providedFields, warnings: localWarnings}); counts.assignments++; warnings.push(...localWarnings);
          }
          if (data['@odata.nextLink']) { if (!validURL(data['@odata.nextLink']) || seen.has(data['@odata.nextLink']) || data['@odata.nextLink'] === job.url) warnings.push('部分 Graph 分页地址无效或重复'); else enqueue(data['@odata.nextLink'], job.kind, c); }
        } catch (e) {
          if (e.storageFailure) throw e;
          if (e.throttled) { this.retryAt = e.retryAt; throw e; }
          if (revision !== this.revision) break;
          warnings.push(`${job.kind}：${e.message}`);
        }
        if (revision !== this.revision) break;
        seen.add(job.url); queue.shift(); pages++;
        this.saveJSON(checkpointFile, {configKey, accountId: accountID, jobs: queue, savedAt: new Date().toISOString()});
        this.progress = {counts, coverage: 'partial', warnings: [...new Set(warnings)].slice(0, 40), message: `正在同步 Teams，已读取 ${pages} 个分页。`}; this.status();
      }
      if (revision === this.revision) this.progress = {...this.progress, status: queue.length || warnings.length ? 'partial' : 'complete', coverage: queue.length || warnings.length ? 'partial' : 'complete', message: queue.length ? '本轮达到读取上限，下次将从已保存位置继续。' : warnings.length ? '同步结束，部分内容未能读取，请核对覆盖范围。' : '已读取 Graph 返回的可访问分页。'};
    } catch (e) { if (revision === this.revision) { if (accountID) this.saveJSON(checkpointFile, {configKey, accountId: accountID, jobs: queue}); this.progress = {...this.progress, coverage: 'partial', message: e.storageFailure ? '数据未能保存，未推进同步进度。请检查磁盘空间。' : e.throttled ? e.message : 'Graph 同步未完成，请核对登录和学校授权。'}; } }
    finally { if (revision === this.revision) { this.busy = false; this.status(); } }
  }
}
module.exports = {GraphService, validURL, validConfig};
