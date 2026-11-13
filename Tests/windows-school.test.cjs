'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { normalizeHome, schoolURL, readConfig, writeConfig, isReadOnlyManageBacPath } = require('../Windows/school.cjs');

test('Windows school URL validation matches source-specific HTTPS hosts', () => {
  assert.equal(normalizeHome(' school.seiue.com ', 'seiue'), 'https://school.seiue.com/');
  assert.equal(normalizeHome('https://school.managebac.cn/', 'managebac'), 'https://school.managebac.cn/');
  assert.equal(normalizeHome('https://school.managebac.cn/student/home', 'managebac'), '');
  assert.equal(normalizeHome('https://managebac.cn.evil.com/', 'managebac'), '');
  assert.equal(normalizeHome('http://school.seiue.com/', 'seiue'), '');
  assert.equal(normalizeHome('https://school.seiue.com/?token=abc', 'seiue'), '');
});

test('Windows school links stay on the exact configured origin and reject credentials', () => {
  const homes = { managebac: 'https://school.managebac.cn/' };
  assert.equal(schoolURL('https://school.managebac.cn/student/grades', 'managebac', homes)?.pathname, '/student/grades');
  assert.equal(schoolURL('https://other.managebac.cn/student/grades', 'managebac', homes), null);
  assert.equal(schoolURL('https://school.managebac.cn/student/grades?code=secret', 'managebac', homes), null);
  assert.equal(schoolURL('https://school.managebac.cn/student/grades#access_token=x', 'managebac', homes), null);
});

test('Windows school configuration saves only validated endpoints', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'campusdesk-windows-test-'));
  try {
    const bundled = path.join(folder, 'default.json'), local = path.join(folder, 'local.json');
    fs.writeFileSync(bundled, JSON.stringify({ seiue: '', managebac: '' }));
    const result = writeConfig(local, { seiue: 'school.seiue.com', managebac: '' }, (file, data) => fs.writeFileSync(file, JSON.stringify(data)));
    assert.deepEqual(result, { seiue: 'https://school.seiue.com/', managebac: '' });
    assert.deepEqual(readConfig(local, bundled), result);
    assert.throws(() => writeConfig(local, { seiue: 'https://evil.com/', managebac: '' }, () => {}));
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('ManageBac crawler does not follow unrelated or write-capable pages', () => {
  assert.equal(isReadOnlyManageBacPath('/student/classes/123/core_tasks/45'), true);
  assert.equal(isReadOnlyManageBacPath('/student/grades'), true);
  assert.equal(isReadOnlyManageBacPath('/student/classes/123/submit'), false);
  assert.equal(isReadOnlyManageBacPath('/admin'), false);
  for (const root of ['home', 'grades', 'reports', 'academics']) assert.equal(isReadOnlyManageBacPath('/student/' + root + '/'), true);
  for (const route of ['/student/grades/delete', '/student/academics//', '/student/classes/123/core_tasks/45/edit']) assert.equal(isReadOnlyManageBacPath(route), false);
});

function syntheticWorker(snapshot) {
  // Run the actual worker with in-memory pages and an immediate fixture clock;
  // no Electron window, authenticated browser, local profile or network is used.
  const module = { exports: {} }, loaded = [], events = [];
  vm.runInNewContext(fs.readFileSync(require.resolve('../Windows/school.cjs'), 'utf8'), {
    module, URL, setTimeout: callback => queueMicrotask(callback),
    require: name => name === 'node:fs' ? { ...fs, readFileSync: () => '' } : require(name)
  });
  const origin = 'https://school.managebac.cn', home = origin + '/';
  const win = { loadURL: async url => { loaded.push(url); }, webContents: {
    getURL: () => loaded.at(-1), executeJavaScript: async () => JSON.stringify(snapshot(loaded.at(-1), origin))
  } };
  const worker = new module.exports.SchoolWorker('managebac', () => win, '/synthetic', () => ({ managebac: home }),
    (message, running, value) => events.push({ message, running, value }));
  return { worker, loaded, events };
}

test('crawler reads all nine course summaries before feedback and reports the page cap as partial', async () => {
  const fixture = syntheticWorker((url, origin) => {
    if (url === origin + '/') return { links: Array.from({ length: 9 }, (_, i) => ({ kind: 'course', url: origin + '/student/classes/' + (i + 1) + '/core_tasks' })) };
    const course = url.match(/\/classes\/(\d+)\/core_tasks$/);
    return course ? { courses: [{ id: course[1] }], links: Array.from({ length: 70 }, (_, i) => ({ kind: 'feedback', url: url + '/' + (i + 1) })) } : { feedback: [{ text: 'Synthetic feedback' }] };
  });
  await fixture.worker.start();
  assert.equal(fixture.loaded.filter(url => /\/classes\/\d+\/core_tasks$/.test(url)).length, 9);
  assert.equal(fixture.loaded.length, 55);
  assert.match(fixture.events.at(-1).message, /还有 \d+ 页未读取/);
  assert.doesNotMatch(fixture.events.at(-1).message, /本轮读取完成/);
});

test('an empty school page after retries is not reported as a successful read', async () => {
  const fixture = syntheticWorker(() => ({ courses: [], tasks: [], feedback: [], links: [] }));
  await fixture.worker.start();
  assert.match(fixture.events.at(-1).message, /未读取到可识别数据/);
  assert.doesNotMatch(fixture.events.at(-1).message, /本轮读取完成/);
});
