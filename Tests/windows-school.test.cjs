'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
});
