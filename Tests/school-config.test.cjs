const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../Resources/core.js');

test('public defaults contain no school endpoint and keep Teams usable', () => {
  const defaults = JSON.parse(fs.readFileSync(path.join(__dirname, '../Resources/SchoolConfig.json'), 'utf8'));
  assert.deepEqual(defaults, { seiue: '', managebac: '' });
  Core.configureSchools(defaults);
  assert.equal(Core.validateState(Core.emptyState()).settings.seiueURL, '');
  assert.equal(Core.validateState(Core.emptyState()).settings.managebacURL, '');
  assert.equal(Core.safeURL('https://example-school.seiue.com/calendar', 'seiue'), '');
  assert.equal(Core.safeURL('https://teams.microsoft.com/v2/', 'teams'), 'https://teams.microsoft.com/v2/');
  assert.equal(Core.safeURL('https://teams.cloud.microsoft/', 'teams'), 'https://teams.cloud.microsoft/');
});

test('school config normalizes safe origins and navigation matches exact configured hosts', () => {
  assert.deepEqual(Core.configureSchools({ seiue: 'HTTPS://EXAMPLE-SCHOOL.SEIUE.COM:443/', managebac: 'https://example-school.managebac.cn' }),
    { seiue: 'https://example-school.seiue.com/', managebac: 'https://example-school.managebac.cn/' });
  assert.equal(Core.safeURL('https://example-school.seiue.com/calendar?date=2026-09-20', 'seiue'), 'https://example-school.seiue.com/calendar?date=2026-09-20');
  for (const url of ['https://other-school.seiue.com/', 'https://sub.example-school.seiue.com/', 'https://example-school.seiue.com.evil.invalid/', 'https://example-school.managebac.cn/']) {
    assert.equal(Core.safeURL(url, 'seiue'), '', url);
  }
  assert.equal(Core.safeURL('https://example-school.seiue.com/?code=secret', 'seiue'), '');
  assert.equal(Core.safeURL('https://example-school.seiue.com/#access_token=secret', 'seiue'), '');
  assert.equal(Core.safeURL('https://example-school.seiue.com:444/', 'seiue'), '');
  const copy = Core.schoolHomes(); copy.seiue = 'https://other-school.seiue.com/';
  assert.equal(Core.schoolHomes().seiue, 'https://example-school.seiue.com/');
});

test('malformed or overbroad configured endpoints fail closed', () => {
  const invalid = ['', 'http://example-school.seiue.com/', 'https://example-school.seiue.com:8443/', 'https://user:password@example-school.seiue.com/',
    'https://example-school.seiue.com/?token=secret', 'https://example-school.seiue.com/?', 'https://example-school.seiue.com/#',
    'https://example-school.seiue.com/calendar', 'https://example-school.seiue.com//', 'https://evilseiue.com/', 'https://seiue.com.evil.invalid/',
    'https://.seiue.com/', 'https://example..seiue.com/', 'https://-example.seiue.com/', 'https://example-.seiue.com/',
    'https://example-school.seiue.com./', ' https://example-school.seiue.com/', 'https://%65xample-school.seiue.com/', 'https://example-school.seiue.com/\n'];
  for (const value of invalid) assert.equal(Core.configureSchools({ seiue: value }).seiue, '', value);
  assert.equal(Core.configureSchools({ managebac: 'https://example-school.seiue.com/' }).managebac, '');
  assert.equal(Core.configureSchools({ managebac: 'https://example-school.managebac.com/' }).managebac, 'https://example-school.managebac.com/');
  assert.deepEqual(Core.configureSchools({ teams: 'https://evil.invalid/' }), { seiue: '', managebac: '' });
  assert.equal(Core.safeURL('https://teams.microsoft.com/', 'teams'), 'https://teams.microsoft.com/');
});

test('blank or changed config preserves cached school and Teams data without enabling school reads', () => {
  const old = { seiue: 'https://example-school.seiue.com/', managebac: 'https://example-school.managebac.cn/' };
  Core.configureSchools(old);
  let state = Core.mergeSnapshot(Core.emptyState(), { source: 'seiue', url: old.seiue + 'calendar', capturedAt: '2026-09-20T00:00:00Z',
    schedule: [{ id: 'fixture-course', date: '2026-09-20', start: '08:00', end: '09:00', title: 'Fixture course' }] });
  state = Core.mergeSnapshot(state, { source: 'teams', url: 'https://teams.microsoft.com/v2/', capturedAt: '2026-09-20T00:00:00Z',
    posts: [{ id: 'fixture-post', title: 'Fixture notice', text: 'Preserved notice' }] });
  for (const config of [{}, { seiue: 'https://another-school.seiue.com/', managebac: 'https://another-school.managebac.com/' }]) {
    Core.configureSchools(config);
    const restored = Core.validateState(JSON.stringify(state));
    assert.equal(Core.getSchedule(restored, '2026-09-20')[0].title, 'Fixture course');
    assert.equal(Core.getTeamsPosts(restored)[0].text, 'Preserved notice');
    assert.equal(Core.safeURL(old.seiue + 'calendar', 'seiue'), '');
    assert.throws(() => Core.mergeSnapshot(restored, { source: 'seiue', url: old.seiue + 'calendar', capturedAt: '2026-09-21T00:00:00Z', schedule: [] }), /尚未配置/);
    const next = Core.mergeSnapshot(restored, { source: 'teams', url: 'https://teams.microsoft.com/v2/', capturedAt: '2026-09-21T00:00:00Z', posts: [] });
    assert.equal(Core.getSchedule(next, '2026-09-20')[0].title, 'Fixture course');
  }
  Core.configureSchools({});
});
