'use strict';
const {XMLParser} = require('fast-xml-parser');
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
function readXML(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unsupported XML declaration');
  return new XMLParser({ignoreAttributes:false,parseTagValue:false,processEntities:true}).parse(xml);
}
function richText(value) {
  if (typeof value === 'string') return value;
  if (value?.['#text'] != null) return String(value['#text']);
  return value ? list(value.t).map(richText).join('') + list(value.r).map(richText).join('') : '';
}
function spreadsheetText(entries) {
  const strings = entries['xl/sharedStrings.xml'] ? list(readXML(Buffer.from(entries['xl/sharedStrings.xml']).toString()).sst?.si).map(richText) : [];
  return Object.keys(entries).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(key => {
    const rows = list(readXML(Buffer.from(entries[key]).toString()).worksheet?.sheetData?.row);
    return rows.map(row => list(row.c).map(cell => {
      const type = cell['@_t'];
      if (type === 's') return strings[Number(cell.v)] || '';
      if (type === 'inlineStr') return richText(cell.is);
      return cell.v == null ? '' : String(cell.v);
    }).join('\t')).join('\n');
  }).join('\n\n');
}
module.exports = {spreadsheetText};
