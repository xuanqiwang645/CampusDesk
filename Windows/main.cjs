'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, session, Notification, Menu, Tray, nativeImage, safeStorage, powerMonitor } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { readConfig, writeConfig, schoolURL, SchoolWorker } = require('./school.cjs');
const Core = require('../Resources/core.js');
const {TeamsService} = require('./teams.cjs');
const {GraphService} = require('./graph.cjs');
const {parseDocument} = require('./documents.cjs');
const {Reminders} = require('./reminders.cjs');

const resources = path.resolve(__dirname, '..', 'Resources');
const dashboardFile = path.join(resources, 'index.html');
const dataFolder = () => path.join(app.getPath('userData'), 'CampusDesk');
const stateFile = () => path.join(dataFolder(), 'state.json');
const schoolFile = () => path.join(dataFolder(), 'SchoolConfig.json');
const MAX_STATE = 26_214_400;
let dashboard, homes = { seiue: '', managebac: '' }, state = {};
const browsers = new Map(), workers = new Map();
let syncTimer = null, refreshMinutes = 0, teams, graph, reminders, tray, quitting = false, countdown;
const langPath = () => app.isPackaged ? path.join(process.resourcesPath, 'ocr-data') : path.join(__dirname, 'ocr-data');

app.setName('CampusDesk Windows');
app.setPath('userData', path.join(app.getPath('appData'), 'CampusDesk Windows'));
if (process.platform === 'win32') app.setAppUserModelId('local.campusdesk.windows');

function send(payload) {
  if (dashboard && !dashboard.isDestroyed()) dashboard.webContents.send('campus-event', payload);
}
function status(source, message, busy = false) { send({ type: 'status', source, message, busy }); }
function safeJSON(file, limit) {
  try {
    if (fs.statSync(file).size > limit) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return null; }
}
function saveJSON(file, value, limit = MAX_STATE) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, 'utf8') > limit) throw new Error('Data is too large');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, text, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    try { fs.unlinkSync(temp); } catch { /* Rename already consumed the temporary file. */ }
  }
}
function readState() {
  for (const file of [stateFile(), path.join(dataFolder(), 'state.previous.json')]) {
    const saved = safeJSON(file, MAX_STATE);
    if (!saved) continue;
    try { return Core.validateState(saved); } catch { /* Try the last known valid backup. */ }
  }
  const fresh = Core.emptyState(); fresh.settings.teamsBrowser = 'edge'; return fresh;
}
function writeState(candidate) {
  const validated = Core.validateState(candidate);
  const current = safeJSON(stateFile(), MAX_STATE);
  try { if (current) saveJSON(path.join(dataFolder(), 'state.previous.json'), Core.validateState(current)); }
  catch { /* Do not copy a corrupt current file over a good backup. */ }
  saveJSON(stateFile(), validated);
  state = validated;
  configureTimer();
  if (teams?.worker && (state.settings.teamsMode !== 'browser' || !state.settings.teamsBrowserAutomation || !state.settings.teamsAutoDiscover)) teams.stop();
  if (graph?.busy && state.settings.teamsMode !== 'graph') graph.cancel();
}
function resetTeamsState() {
  if (Object.keys(state.snapshots.teams || {}).length) saveJSON(path.join(dataFolder(), `state.before-account-change-${Date.now()}.json`), state);
  writeState(Core.resetTeamsData(state)); reminders?.sync([], false); send({type: 'state', state});
}
function validDashboardSender(event) {
  if (!dashboard || event.sender !== dashboard.webContents || event.senderFrame !== dashboard.webContents.mainFrame) return false;
  try { return fileURLToPath(event.senderFrame.url) === dashboardFile; }
  catch { return false; }
}
function allowHTTPSNavigation(contents) {
  contents.on('will-navigate', (event, target) => {
    if (!/^https:\/\//i.test(target)) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (!/^https:\/\//i.test(url)) return { action: 'deny' };
    return { action: 'allow', overrideBrowserWindowOptions: {
      width: 900, height: 760, webPreferences: {
        partition: 'persist:school', nodeIntegration: false, contextIsolation: true, sandbox: true,
        webSecurity: true
      }
    } };
  });
  contents.on('did-create-window', popup => allowHTTPSNavigation(popup.webContents));
}
async function captureVisibleSchoolPage(source, win) {
  if (win.isDestroyed() || workers.get(source)?.running) return;
  const url = schoolURL(win.webContents.getURL(), source, homes);
  if (!url) return;
  try {
    const script = fs.readFileSync(path.join(resources, `${source}.js`), 'utf8');
    const symbol = source === 'seiue' ? 'CampusSeiue' : 'CampusManageBac';
    const result = await win.webContents.executeJavaScript(`(function(){if(location.origin!==${JSON.stringify(url.origin)})throw Error('Unexpected origin');\n${script}\nreturn JSON.stringify(window.${symbol}.extract());})();`, true);
    if (win.isDestroyed() || win.webContents.getURL() !== url.href) return;
    const snapshot = JSON.parse(result);
    const keys = source === 'seiue' ? ['schedule', 'calendarDates'] : ['courses', 'tasks', 'feedback', 'links'];
    if (snapshot.loginRequired || snapshot.parseError || !keys.some(key => Array.isArray(snapshot[key]) && snapshot[key].length) && !snapshot.officialGPA) return;
    send({ type: 'snapshot', snapshot });
    status(source, '已识别学校页面，正在后台同步', true);
    syncSchool(source);
  } catch { /* A sign-in or loading page is not a successful capture. */ }
}
function schoolBrowser(source, show = true) {
  let win = browsers.get(source);
  if (win && !win.isDestroyed()) {
    if (show) { win.show(); win.focus(); }
    return win;
  }
  win = new BrowserWindow({
    title: source === 'seiue' ? 'CampusDesk · 希悦' : 'CampusDesk · ManageBac',
    width: 1280, height: 900, show,
    webPreferences: {
      partition: 'persist:school', nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true
    }
  });
  win.on('closed', () => browsers.delete(source));
  allowHTTPSNavigation(win.webContents);
  win.webContents.on('did-finish-load', () => {
    if (!win.isVisible() || workers.get(source)?.running) return;
    setTimeout(() => captureVisibleSchoolPage(source, win), 1500);
  });
  browsers.set(source, win);
  return win;
}
function openSource(source, raw) {
  if (source === 'teams') {
    const target = typeof raw === 'string' && /^https:\/\/(?:teams\.microsoft\.com|teams\.cloud\.microsoft)(?:\/|$)/i.test(raw) ? raw : 'https://teams.microsoft.com/';
    if (raw) shell.openExternal(target); else teams.login();
    return;
  }
  if (!['seiue', 'managebac'].includes(source)) return;
  if (!homes[source]) { status(source, '请先填写学校网址，然后登录。'); return; }
  const target = raw ? schoolURL(raw, source, homes) : new URL(homes[source]);
  if (!target) { status(source, '地址不属于当前配置的学校，已取消打开'); return; }
  const win = schoolBrowser(source);
  win.loadURL(target.href).catch(() => status(source, '无法打开学校页面，请检查网络。'));
}
function syncSchool(source) {
  const worker = workers.get(source);
  if (worker) worker.start().catch(() => status(source, '学校同步失败，已保留缓存。'));
}
function syncAll() {
  for (const source of ['seiue', 'managebac']) syncSchool(source);
  syncTeams();
}
function syncTeams(focus = 'all') {
  if (state.settings.teamsMode === 'graph') graph.sync().catch(() => graph.status('Graph 同步未完成，请重新登录。'));
  else if (state.settings.teamsBrowserAutomation && state.settings.teamsAutoDiscover) teams.start(focus);
}
function configureTimer() {
  const n = Number(state.settings && state.settings.refreshMinutes);
  const minutes = Number.isFinite(n) ? Math.max(5, Math.min(120, n)) : 15;
  if (syncTimer && refreshMinutes === minutes) return;
  if (syncTimer) clearInterval(syncTimer);
  refreshMinutes = minutes;
  syncTimer = setInterval(syncAll, minutes * 60_000);
}
async function importCalendar() {
  const result = await dialog.showOpenDialog(dashboard, { properties: ['openFile'], filters: [
    { name: 'School calendar', extensions: ['ics', 'pdf'] }
  ] });
  if (result.canceled || !result.filePaths[0]) return;
  const file = result.filePaths[0];
  try {
    if (fs.statSync(file).size > 5 * 1024 * 1024) throw new Error('校历文件超过 5 MB');
    if (path.extname(file).toLowerCase() === '.pdf') {
      status('app', '正在识别校历文字和表格…', true);
      const result = await parseDocument(fs.readFileSync(file), path.basename(file), 'application/pdf', langPath(), true);
      if (!result.text) throw new Error(result.error || '没有识别到校历文字，请检查 PDF。');
      send({type: 'schoolCalendarPDF', fileName: path.basename(file), text: result.text});
      status('app', result.status === 'partial' ? '部分页面未完整识别，请在预览中核对。' : '校历识别完成，请核对预览。'); return;
    }
    send({ type: 'schoolCalendarFile', fileName: path.basename(file), text: fs.readFileSync(file, 'utf8') });
  } catch (error) { send({ type: 'schoolCalendarFileError', message: error.message }); }
}
async function exportData() {
  const result = await dialog.showSaveDialog(dashboard, { defaultPath: 'CampusDesk-backup.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (result.canceled || !result.filePath) return;
  try { saveJSON(result.filePath, state); status('app', '备份已导出（不包含登录凭据）'); }
  catch { status('app', '导出失败，请检查路径和磁盘空间'); }
}
async function importData() {
  const result = await dialog.showOpenDialog(dashboard, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (result.canceled || !result.filePaths[0]) return;
  const candidate = safeJSON(result.filePaths[0], MAX_STATE);
  try { send({ type: 'import', state: Core.validateState(candidate) }); }
  catch { status('app', '文件不是有效的 CampusDesk 备份，或超过 25 MiB。'); }
}
async function clearSession(source) {
  if (!['seiue', 'managebac'].includes(source) || !homes[source]) return;
  const response = await dialog.showMessageBox(dashboard, {
    type: 'warning', buttons: ['取消', '退出登录'], defaultId: 0, cancelId: 0,
    message: '退出此学校系统？', detail: '将清除此应用中的学校登录状态，已缓存的课表、任务和成绩仍会保留。'
  });
  if (response.response !== 1) return;
  workers.get(source).cancel();
  const host = new URL(homes[source]).hostname;
  const cookies = await session.fromPartition('persist:school').cookies.get({ domain: host });
  for (const cookie of cookies) {
    const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
    if (domain !== host && !domain.endsWith(`.${host}`)) continue;
    await session.fromPartition('persist:school').cookies.remove(`https://${domain}${cookie.path}`, cookie.name);
  }
  await session.fromPartition('persist:school').clearStorageData({ origin: homes[source], storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] });
  status(source, '已退出，请重新登录');
}
function handleAction(event, body) {
  if (!validDashboardSender(event) || !body || typeof body !== 'object' || Array.isArray(body) || typeof body.action !== 'string') return;
  const { action } = body;
  switch (action) {
    case 'ready':
      send({ type: 'schoolConfiguration', config: homes });
      send({ type: 'state', state });
      graph.status(); teams.emitStatus();
      configureTimer();
      setTimeout(syncAll, 1000);
      break;
    case 'saveState':
      try { writeState(body.state); } catch { status('app', '本次无法保存到磁盘，请导出备份并检查磁盘空间'); }
      break;
    case 'saveSchoolConfiguration':
      try {
        const next = writeConfig(schoolFile(), body.config, (file, data) => saveJSON(file, data, 8192));
        for (const source of ['seiue', 'managebac']) if (next[source] !== homes[source]) {
          workers.get(source).cancel();
          const win = browsers.get(source); if (win && !win.isDestroyed()) win.close();
        }
        homes = next;
        send({ type: 'schoolConfiguration', config: homes, saved: true });
      } catch { send({ type: 'schoolConfigurationError' }); }
      break;
    case 'connectSchool': if (typeof body.source === 'string') openSource(body.source); break;
    case 'openSource': openSource(body.source, body.url); break;
    case 'syncSchool': syncSchool(body.source); break;
    case 'sync': syncAll(); break;
    case 'importSchoolCalendar': importCalendar(); break;
    case 'exportData': exportData(); break;
    case 'importData': importData(); break;
    case 'clearSession': clearSession(body.source); break;
    case 'openAttachment':
      if (Core.safeAttachmentURL(body.url)) shell.openExternal(body.url); break;
    case 'requestNotifications':
      send({ type: 'notificationPermission', granted: Notification.isSupported() }); break;
    case 'syncReminders': reminders.sync(body.items, state.settings.teamsNotifications === true); break;
    case 'setMenuTitle': if (tray && typeof body.title === 'string') tray.setToolTip(body.title.slice(0, 120)); break;
    case 'setMenuCountdown': countdown = body.clear ? null : {endsAt: Date.parse(body.endsAt), label: String(body.label || ''), nextTitle: String(body.nextTitle || '')}; break;
    case 'requestGraphStatus': graph.status(); break;
    case 'graphSignIn': graph.signIn().catch(() => graph.status('Microsoft 登录未完成，请检查配置。')); break;
    case 'graphSync': graph.sync().catch(() => graph.status('Graph 同步未完成。')); break;
    case 'graphSignOut': graph.signOut().catch(() => graph.status('退出登录未完成，请重试。')); break;
    case 'graphSaveConfiguration': graph.configure(body.clientId, body.tenant).catch(e => graph.status(e.message)); break;
    case 'requestTeamsAutoStatus': teams.emitStatus(); break;
    case 'teams-auto-start': syncTeams(body.focus === 'ec' ? 'ec' : 'all'); break;
    case 'teams-auto-login': teams.login(); break;
    case 'teams-auto-stop': teams.stop(); break;
    case 'teamsAutoSnapshotFailed': teams.stop('Teams 数据无法完整保存，请检查磁盘空间后重试。'); break;
    case 'captureTeamsBrowserPage': teams.manual('capture', body.selectionOnly === true); break;
    case 'pinTeamsBrowserPage': teams.manual('pin'); break;
    case 'syncTeams': syncTeams(); break;
    default: break;
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', () => { if (dashboard) { dashboard.show(); dashboard.focus(); } });

app.whenReady().then(() => {
  homes = readConfig(schoolFile(), path.join(resources, 'SchoolConfig.json'));
  state = readState();
  const options = {folder: dataFolder(), resources, getState: () => state, emit: send, readJSON: safeJSON, saveJSON,
    resetAccount: resetTeamsState, langPath: langPath()};
  teams = new TeamsService(options);
  graph = new GraphService({...options, safeStorage, openExternal: url => shell.openExternal(url), bindAccount: account => teams.bindAccount(account),
    saveSnapshots: snapshots => { let next = state; for (const snapshot of snapshots) next = Core.mergeSnapshot(next, snapshot); writeState(next); send({type: 'state', state}); }});
  graph.initialize().catch(() => graph.status('Microsoft 登录凭据无法读取，请重新登录。'));
  reminders = new Reminders({onError: message => status('app', message)});
  for (const source of ['seiue', 'managebac']) workers.set(source, new SchoolWorker(
    source, schoolBrowser, resources, () => homes,
    (message, busy, snapshot) => {
      if (snapshot) send({ type: 'snapshot', snapshot });
      if (message) status(source, message, busy);
    }
  ));
  dashboard = new BrowserWindow({ title: 'CampusDesk', width: 1320, height: 900, minWidth: 900, minHeight: 650,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
  });
  dashboard.on('close', event => { if (!quitting) { event.preventDefault(); dashboard.hide(); } });
  const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({width: 24, height: 24}));
  tray.setToolTip('CampusDesk');
  tray.setContextMenu(Menu.buildFromTemplate([{label: '打开 CampusDesk', click: () => { dashboard.show(); dashboard.focus(); }},
    {label: '刷新', click: syncAll}, {label: '退出', click: () => app.quit()}]));
  tray.on('double-click', () => { dashboard.show(); dashboard.focus(); });
  setInterval(() => { if (tray && countdown && Number.isFinite(countdown.endsAt)) { const left = Math.max(0, Math.ceil((countdown.endsAt - Date.now()) / 1000)); tray.setToolTip(`${countdown.label} ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · ${countdown.nextTitle}`.slice(0, 120)); } }, 1000);
  powerMonitor.on('suspend', () => { teams.stop(); graph.cancel(); });
  powerMonitor.on('resume', () => setTimeout(syncAll, 4000));
  dashboard.webContents.on('will-navigate', (event, target) => {
    try { if (fileURLToPath(target.split('#')[0]) === dashboardFile) return; } catch { /* Block non-file navigation. */ }
    event.preventDefault();
  });
  dashboard.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'CampusDesk', submenu: [
    { label: '显示学习看板', click: () => { dashboard.show(); dashboard.focus(); } },
    { label: '刷新学校数据', accelerator: 'CmdOrCtrl+R', click: syncAll },
    { role: 'quit', label: '退出' }
  ] }]));
  ipcMain.on('campus-action', handleAction);
  dashboard.loadFile(dashboardFile);
});
app.on('before-quit', () => { quitting = true; teams?.stop(); graph?.cancel(); teams?.connection?.close(); });
app.on('window-all-closed', () => { if (quitting) app.quit(); });
