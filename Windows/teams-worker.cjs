'use strict';
const {parentPort, workerData} = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const {createRunner} = require('../Resources/teams-auto-runner.js');
const {runTeamsAPI, runTeamsAPIIndex} = require('../Resources/teams-api-runner.js');
const readResource = name => {
  if (!['teams.js', 'teams-auto.js', 'teams-api.js'].includes(name)) throw new Error('Invalid resource');
  return fs.readFileSync(path.join(workerData.resources, name), 'utf8');
};
const adapter = readResource('teams.js') + '\n' + readResource('teams-auto.js');
function pageEval(script) {
  const shared = new SharedArrayBuffer(24 * 1024 * 1024 + 8), header = new Int32Array(shared, 0, 2);
  parentPort.postMessage({type: 'evaluate', script, shared});
  if (Atomics.wait(header, 0, 0, 70000) === 'timed-out') throw new Error('Browser request timed out');
  const length = Atomics.load(header, 1);
  if (length < 1 || length > shared.byteLength - 8) throw new Error('Invalid browser response');
  const result = JSON.parse(Buffer.from(shared, 8, length).toString('utf8'));
  if (!result.ok) { const error = new Error(result.error || 'Browser read failed'); error.code = result.code; throw error; }
  return result.value;
}
createRunner(workerData.config, {
  now: Date.now, session: workerData.checkpoint || {}, readResource,
  sleep(seconds) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000); },
  emit(event) { parentPort.postMessage({type: 'event', event}); },
  saveCheckpoint(checkpoint) { parentPort.postMessage({type: 'checkpoint', checkpoint}); },
  captureHook: runTeamsAPI, indexHook: runTeamsAPIIndex, pageEval,
  execute(request) {
    const result = pageEval(`(function(){${adapter}\nreturn JSON.stringify(window.CampusTeamsAuto.run(${JSON.stringify(request)}));})();`);
    if (typeof result !== 'string' || result.length > 4000000) throw new Error('Invalid Teams result');
    return JSON.parse(result);
  }
}).start();
