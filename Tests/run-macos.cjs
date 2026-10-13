'use strict';
// Reproducible synthetic browser + core suite; no signed-in browser profile.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE to the installed Playwright module path.');
const resources = path.resolve(__dirname, '../Resources');
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let file;
  try { file = path.resolve(resources, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname)); }
  catch (_) { res.writeHead(400).end(); return; }
  if (!file.startsWith(resources + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (error, bytes) => {
    if (error) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(bytes);
  });
});
server.listen(0, '127.0.0.1', () => {
  const files = fs.readdirSync(__dirname).filter(name => name.endsWith('.test.cjs') && !name.startsWith('windows-')).sort().map(name => path.join(__dirname, name));
  const child = spawn(process.execPath, ['--test', '--test-concurrency=2', ...files], {
    stdio: 'inherit', env: { ...process.env, CAMPUSDESK_TEST_URL: 'http://127.0.0.1:' + server.address().port + '/index.html' }
  });
  child.on('error', error => { console.error(error.message); server.close(() => { process.exitCode = 1; }); });
  child.on('exit', code => { server.close(() => { process.exitCode = code == null ? 1 : code; }); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child.kill(signal); server.close(); });
});
