'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const resources = path.join(__dirname, '../Resources');
const theme = fs.readFileSync(path.join(resources, 'vivid.css'), 'utf8');
const html = fs.readFileSync(path.join(resources, 'index.html'), 'utf8');

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
