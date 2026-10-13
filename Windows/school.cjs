'use strict';
const fs = require('node:fs');
const path = require('node:path');

const sources = ['seiue', 'managebac'];
const suffixes = { seiue: ['seiue.com'], managebac: ['managebac.com', 'managebac.cn'] };
const maxPages = { seiue: 1, managebac: 55 };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizeHome(value, source) {
  if (!sources.includes(source) || typeof value !== 'string' || value.length > 2048) return '';
  let raw = value.trim();
  if (!raw.includes('://')) raw = 'https://' + raw;
  if (!/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::443)?\/?$/i.test(raw)) return '';
  try {
    const url = new URL(raw), host = url.hostname.toLowerCase();
    if (host.length > 253 || !host.split('.').every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return '';
    return suffixes[source].some(suffix => host === suffix || host.endsWith('.' + suffix)) ? `https://${host}/` : '';
  } catch { return ''; }
}

function schoolURL(raw, source, homes) {
  if (typeof raw !== 'string' || raw.length > 4096 || !homes[source]) return null;
  try {
    const url = new URL(raw), home = new URL(homes[source]);
    if (url.protocol !== 'https:' || url.hostname !== home.hostname || url.username || url.password || (url.port && url.port !== '443')) return null;
    if ([...url.searchParams.keys()].some(key => /^(?:access_token|refresh_token|id_token|token|client_secret|password|passwd|assertion|code|authorization|auth_token|session_token|authkey|sig|signature|session_state)$/i.test(key))) return null;
    if (/(?:^|[?&#])(?:access_token|refresh_token|id_token|token|client_secret|password|passwd|assertion|code|authorization|auth_token|session_token|authkey|sig|signature|session_state)=/i.test(decodeURIComponent(url.hash))) return null;
    return url;
  } catch { return null; }
}

function readConfig(file, bundled) {
  const values = {};
  for (const candidate of [bundled, file]) {
    try {
      if (fs.statSync(candidate).size > 8192) continue;
      const data = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      for (const source of sources) if (Object.hasOwn(data, source)) values[source] = data[source];
    } catch { /* Missing or invalid config leaves an unset school endpoint. */ }
  }
  return Object.fromEntries(sources.map(source => [source, normalizeHome(values[source], source)]));
}

function writeConfig(file, values, saveJSON) {
  if (!values || typeof values !== 'object') throw new Error('Invalid school configuration');
  const result = {};
  for (const source of sources) {
    if (typeof values[source] !== 'string') throw new Error('Invalid school configuration');
    const input = values[source].trim();
    result[source] = input ? normalizeHome(input, source) : '';
    if (input && !result[source]) throw new Error('Invalid school URL');
  }
  saveJSON(file, result);
  return result;
}

function isReadOnlyManageBacPath(pathname) {
  return ['/student/home', '/student/grades', '/student/reports', '/student/academics'].includes(pathname)
    || /^\/student\/classes\/[0-9]+(?:\/core_tasks(?:\/[0-9]+)?)?\/?$/.test(pathname);
}

class SchoolWorker {
  constructor(source, getWindow, resources, getHomes, emit) {
    this.source = source;
    this.getWindow = getWindow;
    this.resources = resources;
    this.getHomes = getHomes;
    this.emit = emit;
    this.running = false;
    this.generation = 0;
  }

  cancel() { this.generation += 1; this.running = false; }

  async start() {
    if (this.running) return;
    const home = this.getHomes()[this.source];
    if (!home) { this.emit('请先填写学校网址，然后登录。', false); return; }
    const generation = ++this.generation;
    this.running = true;
    const queue = [home], visited = new Set();
    let readable = 0, failed = 0, truncated = 0;
    let stopReason = '';
    const script = fs.readFileSync(path.join(this.resources, `${this.source}.js`), 'utf8');
    while (queue.length && visited.size < maxPages[this.source] && generation === this.generation) {
      const raw = queue.shift();
      if (visited.has(raw)) continue;
      visited.add(raw);
      this.emit(`正在读取第 ${visited.size} 页…`, true);
      try {
        const win = this.getWindow(this.source, false);
        await win.loadURL(raw);
        await delay(2000);
        if (generation !== this.generation) break;
        let snapshot;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const current = schoolURL(win.webContents.getURL(), this.source, this.getHomes());
          if (!current) throw new Error('login_required');
          const origin = JSON.stringify(current.origin);
          const symbol = this.source === 'seiue' ? 'CampusSeiue' : 'CampusManageBac';
          const result = await win.webContents.executeJavaScript(`(function(){if(location.origin!==${origin})throw Error('Unexpected origin');\n${script}\nreturn JSON.stringify(window.${symbol}.extract());})();`, true);
          snapshot = JSON.parse(result);
          const keys = this.source === 'seiue' ? ['schedule', 'calendarDates'] : ['courses', 'tasks', 'feedback', 'links'];
          const empty = keys.every(key => !Array.isArray(snapshot[key]) || snapshot[key].length === 0) && !snapshot.officialGPA;
          if ((!empty && !snapshot.categoryAveragesPending && !snapshot.parseError) || snapshot.loginRequired || attempt === 3) break;
          await delay(1800);
        }
        if (generation !== this.generation) break;
        if (snapshot.loginRequired) { stopReason = '登录已失效，请打开学校网页重新登录'; break; }
        if (snapshot.parseError) failed += 1;
        else readable += 1;
        this.emit(null, true, snapshot);
        if (this.source === 'managebac' && Array.isArray(snapshot.links)) {
          for (const link of snapshot.links) {
            const target = schoolURL(link.url, this.source, this.getHomes());
            if (!target || !isReadOnlyManageBacPath(target.pathname) || visited.has(target.href) || queue.includes(target.href)) continue;
            if (link.kind === 'feedback') queue.push(target.href);
            else queue.unshift(target.href);
            if (queue.length > 150) { truncated += queue.length - 150; queue.length = 150; }
          }
        }
      } catch (error) {
        failed += 1;
        if (error.message === 'login_required') { stopReason = '请先打开学校网页登录，再点刷新'; break; }
        this.emit('页面读取失败，保留上次数据', true);
      }
      await delay(800);
    }
    if (generation !== this.generation) return;
    this.running = false;
    this.emit(stopReason || (readable ? `本轮读取完成（${readable} 页；${failed} 页失败${truncated ? `；${truncated} 个链接超出队列上限` : ''}）` : '本轮未读取到可识别数据，保留缓存；请检查登录和原页面'), false);
  }
}

module.exports = { normalizeHome, schoolURL, readConfig, writeConfig, isReadOnlyManageBacPath, SchoolWorker };
