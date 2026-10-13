'use strict';
// Run from the repository root after electron-builder; never inspect user data.
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
for (const directory of ['win-unpacked','win-arm64-unpacked']) {
  const root = path.join(__dirname,'../dist-windows',directory,'resources');
  const archive = path.join(root,'app.asar');
  const files = new Set(asar.listPackage(archive));
  for (const name of ['main','preload','browser','teams','teams-worker','graph','documents','documents-worker','office','reminders','school']) {
    if (!files.has(`/Windows/${name}.cjs`)) throw Error(`Missing module: ${name}`);
  }
  for (const arch of ['x64','arm64']) {
    const binary=path.join(root,'app.asar.unpacked','node_modules','@napi-rs',`canvas-win32-${arch}-msvc`,`skia.win32-${arch}-msvc.node`);
    if (fs.statSync(binary).size<100000) throw Error(`Missing native canvas: ${arch}`);
  }
  for (const lang of ['eng','chi_sim']) if (fs.statSync(path.join(root,'ocr-data',`${lang}.traineddata.gz`)).size<100000) throw Error(`Missing OCR data: ${lang}`);
  console.log(directory+': packaged modules, native binaries and OCR resources verified');
}
