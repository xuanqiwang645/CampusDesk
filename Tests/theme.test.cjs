'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const resources = path.join(__dirname, '../Resources');
const theme = fs.readFileSync(path.join(resources, 'vivid.css'), 'utf8');
const html = fs.readFileSync(path.join(resources, 'index.html'), 'utf8');
const presets = fs.readFileSync(path.join(resources, 'themes.css'), 'utf8');

function color(name) {
  const value = new RegExp('--' + name + ':\\s*(#[0-9a-f]{6})', 'i').exec(theme)?.[1];
  assert.ok(value, 'Missing theme color: ' + name);
  return value;
}
function luminance(hex) {
  const channels = [...hex.matchAll(/[0-9a-f]{2}/gi)]
    .map(match => parseInt(match[0], 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels.reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}
function contrast(foreground, background) {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('the WebGL liquid-glass compositor loads after the content dashboard', () => {
  const base = html.indexOf('href="style.css"');
  const reminders = html.indexOf('href="reminders.css"');
  const vivid = html.indexOf('href="vivid.css"');
  const liquid = html.indexOf('href="liquid-glass.css"');
  assert.ok(base >= 0 && reminders > base && vivid > reminders && liquid > vivid);
  assert.match(theme, /\.task-row\.done \.task-copy h3\s*\{\s*color:\s*#53685b/);
  const glass = fs.readFileSync(path.join(resources, 'liquid-glass.css'), 'utf8');
  const shader = fs.readFileSync(path.join(resources, 'liquid-glass-webgl.js'), 'utf8');
  for (const file of fs.readdirSync(resources).filter(file => file.endsWith('.css'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(resources, file), 'utf8'), /backdrop-filter/, file + ' must not fake glass with CSS backdrop capture');
  }
  assert.match(html, /id="liquid-glass-canvas"/);
  assert.match(html, /src="three\.min\.js"/);
  assert.match(html, /src="liquid-glass-webgl\.js"/);
  assert.match(shader, /paintComposeRT/);
  assert.match(shader, /textureLod\(paintComposeRT/);
  assert.match(shader, /minFilter:\s*THREE\.LinearMipmapLinearFilter/);
  assert.match(shader, /generateMipmaps:\s*true/);
  assert.match(shader, /float sdCircle\(/);
  assert.match(shader, /float sdRoundedBox\(/);
  assert.match(shader, /float smin\(/);
  assert.match(shader, /float glassSurfaceSdf\(/);
  assert.match(shader, /float interior = max\(-sdf, 0\.0\)/);
  assert.match(shader, /float bevel = uNormalTransition \* 0\.82/);
  assert.match(shader, /clamp\(uNormalTransition \* 0\.13, 0\.003, 0\.012\)/);
  assert.match(shader, /refract\(incident, frontNormal, 1\.0 \/ ior\)/);
  assert.match(shader, /float glassPath = height \/ max\(-insideRay\.z, 0\.025\)/);
  assert.match(shader, /refract\(insideRay, vec3\(0\.0, 0\.0, 1\.0\), ior\)/);
  assert.match(shader, /distributionGGX/);
  assert.match(glass, /\.icon-button/);
  assert.match(glass, /prefers-reduced-transparency/);
});

test('text, sidebar and primary button retain at least 4.5:1 contrast', () => {
  for (const [foreground, background] of [
    ['ink', 'paper'], ['ink', 'card'], ['muted', 'paper'], ['muted', 'card']
  ]) assert.ok(contrast(color(foreground), color(background)) >= 4.5, foreground + ' on ' + background);
  assert.ok(contrast('#3f6251', color('nav')) >= 4.5, 'sidebar navigation');
  assert.ok(contrast('#ffffff', color('teal')) >= 4.5, 'primary button');
  assert.ok(contrast('#174e3c', '#cbe6d7') >= 4.5, 'active navigation');
});

test('color palettes preserve readable text and accessible primary actions', () => {
  assert.ok(html.indexOf('href="themes.css"') > html.indexOf('href="liquid-board.css"'));
  const blocks = [...presets.matchAll(/:root\[data-color-theme="(ocean|ember|midnight)"\]\s*\{([^}]+)\}/g)];
  assert.equal(blocks.length, 3, 'three additional palettes should be defined');
  for (const [, name, block] of blocks) {
    const values = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(([, key, value]) => [key, value]));
    for (const key of ['paper', 'card', 'ink', 'muted', 'teal', 'teal-soft', 'accent-ink']) assert.ok(values[key], name + ' missing --' + key);
    assert.ok(contrast(values.ink, values.paper) >= 4.5, name + ' body text on page');
    assert.ok(contrast(values.ink, values.card) >= 4.5, name + ' body text on cards');
    assert.ok(contrast(values.muted, values.paper) >= 4.5, name + ' secondary text on page');
    assert.ok(contrast(values.muted, values.card) >= 4.5, name + ' secondary text on cards');
    assert.ok(contrast('#ffffff', values.teal) >= 4.5, name + ' primary button text');
    assert.ok(contrast(values['accent-ink'], values['teal-soft']) >= 4.5, name + ' selected navigation');
  }
  assert.match(presets, /@media \(max-width: 900px\)[\s\S]*color-theme-options/);
  assert.match(presets, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(presets, /prefers-reduced-transparency: reduce/);
  assert.match(presets, /board-kpi-overdue strong/);
  assert.match(presets, /board-kpi-week strong/);
  assert.match(presets, /board-kpi-done strong/);
  assert.match(presets, /board-kpi-gpa strong/);
});
