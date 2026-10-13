'use strict';
const path = require('node:path');
const {Worker} = require('node:worker_threads');
function parseDocument(bytes, name, mime, langPath, calendar = false) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'documents-worker.cjs'), {workerData: {bytes, name, mime, langPath, calendar}});
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; worker.terminate(); reject(new Error('附件识别超时，请缩小文件后重试。')); } }, 120000);
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(value); };
    worker.once('message', value => finish(null, value));
    worker.once('error', error => finish(error));
    worker.once('exit', code => { if (!settled) finish(new Error(`附件处理未完成 (${code})`)); });
  });
}
module.exports = {parseDocument};
