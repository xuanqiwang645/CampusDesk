'use strict';
const {parentPort, workerData} = require('node:worker_threads');
const path = require('node:path');
const {unzipSync} = require('fflate');
const {XMLParser} = require('fast-xml-parser');
const LIMIT = 80000;
let ocr;
function result(text, parser, partial = false, extra = {}) {
  text = String(text || '').trim();
  const truncated = text.length > LIMIT;
  return {status: text ? partial || truncated ? 'partial' : 'read' : 'no_text', text: text.slice(0, LIMIT),
    parser, truncated, textOnly: true, semanticVerified: false,
    extractionCoverage: !text ? 'none' : partial || truncated ? 'partial' : 'text_extracted', ...extra};
}
async function recognize(image) {
  if (!ocr) {
    const {createWorker} = require('tesseract.js');
    ocr = await createWorker(['eng', 'chi_sim'], 1, {langPath: workerData.langPath, cacheMethod: 'none', gzip: true, logger() {}});
  }
  const {data} = await ocr.recognize(image);
  return data.text || '';
}
function xmlText(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('文件包含不受支持的 XML 声明');
  const document = new XMLParser({ignoreAttributes: true, processEntities: false, trimValues: false}).parse(xml);
  const strings = [];
  function visit(value, key = '') {
    if (typeof value === 'string' || typeof value === 'number') { if (['t', 'w:t', 'a:t', 'v', '#text'].includes(key)) strings.push(String(value)); }
    else if (Array.isArray(value)) value.forEach(v => visit(v, key));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) visit(v, k);
  }
  visit(document); return strings.join(' ');
}
async function parse() {
  const data = new Uint8Array(workerData.bytes), name = (workerData.name || '').toLowerCase(), mime = workerData.mime || '';
  if (!data.length || data.length > 25 * 1024 * 1024) throw new Error('附件为空或超过 25 MiB');
  if (Buffer.from(data.subarray(0, 5)).toString() === '%PDF-') {
    const {createCanvas, DOMMatrix, ImageData, Path2D} = require('@napi-rs/canvas');
    Object.assign(globalThis, {DOMMatrix, ImageData, Path2D});
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({data, isEvalSupported: false, useSystemFonts: true, stopAtErrors: false}).promise;
    const coverage = [], pages = [], deadline = Date.now() + 90000;
    try {
      for (let i = 1; i <= Math.min(doc.numPages, 50); i++) {
        if (Date.now() > deadline) break;
        const page = await doc.getPage(i), content = await page.getTextContent();
        const native = content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('').trim();
        // Calendar grids need geometric reading order. OCR supplements native text
        // and is mandatory for image-only pages; text itself is never guessed.
        let recognized = '', ocrStatus = 'not_needed';
        if (native.length < 100 || workerData.calendar) {
          try {
            const original = page.getViewport({scale: 1});
            const scale = Math.min(2, 2600 / Math.max(original.width, original.height));
            const viewport = page.getViewport({scale});
            const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
            await page.render({canvasContext: canvas.getContext('2d'), viewport}).promise;
            recognized = await recognize(canvas.toBuffer('image/png')); ocrStatus = recognized.trim() ? 'read' : 'no_text';
          } catch { ocrStatus = 'failed'; }
        }
        pages.push([native, recognized && !native.includes(recognized.trim()) ? recognized : ''].filter(Boolean).join('\n'));
        coverage.push({page: i, textCharacters: native.length, ocrStatus});
        page.cleanup();
      }
      return result(pages.join('\n\n'), 'pdfjs+tesseract', pages.length < doc.numPages || coverage.some(p => p.ocrStatus === 'failed'),
        {pageCoverage: coverage, pagesRead: pages.length, totalPages: doc.numPages});
    } finally { await doc.destroy(); }
  }
  if (/\.(png|jpe?g|webp|bmp|tiff?)$/i.test(name) || /^image\//i.test(mime)) return result(await recognize(Buffer.from(data)), 'tesseract');
  if (/\.(docx|xlsx|pptx)$/i.test(name)) {
    let total = 0, count = 0;
    const entries = unzipSync(data, {filter(file) {
      if (!/^(?:word\/document\.xml|xl\/(?:sharedStrings|worksheets\/sheet\d+)\.xml|ppt\/slides\/slide\d+\.xml)$/.test(file.name)) return false;
      total += file.originalSize; count++;
      if (total > 20 * 1024 * 1024 || count > 200 || file.originalSize > 8 * 1024 * 1024) throw new Error('Office 文件解压后超出读取上限');
      return true;
    }});
    const names = Object.keys(entries).sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
    if (/\.xlsx$/i.test(name)) return result(require('./office.cjs').spreadsheetText(entries), 'xlsx-xml', true);
    return result(names.map(key => xmlText(Buffer.from(entries[key]).toString('utf8'))).join('\n'), 'office-xml');
  }
  if (/\.(txt|csv|tsv|md|json|html?|rtf)$/i.test(name) || /^text\//i.test(mime)) {
    let text = new TextDecoder(data[0] === 255 && data[1] === 254 ? 'utf-16le' : 'utf-8').decode(data);
    if (/\.html?$/i.test(name)) text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ');
    if (/\.rtf$/i.test(name)) return result('', 'rtf', true, {status: 'unsupported', error: '请打开 RTF 原件查看正文。'});
    return result(text, 'text');
  }
  return result('', 'unknown', false, {status: 'unsupported', error: '此文件格式请打开原件查看。'});
}
parse().then(value => parentPort.postMessage(value)).catch(error => parentPort.postMessage({status: 'error', text: '', extractionCoverage: 'none', error: String(error.message).slice(0, 500)}))
  .finally(async () => { if (ocr) await ocr.terminate(); });
