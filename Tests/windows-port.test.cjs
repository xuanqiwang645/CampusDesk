'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {validURL, validConfig, GraphService} = require('../Windows/graph.cjs');
const {spreadsheetText} = require('../Windows/office.cjs');
const {parseDocument} = require('../Windows/documents.cjs');
test('Graph URLs cannot redirect tokens to external hosts or contain credentials', () => {
  assert.equal(validURL('https://graph.microsoft.com/v1.0/me/messages?$skiptoken=a'),true);
  for (const url of ['http://graph.microsoft.com/v1.0/me','https://evil.test/v1.0/me','https://graph.microsoft.com/v1.0/me?access_token=secret','https://u:p@graph.microsoft.com/v1.0/me']) assert.equal(validURL(url),false);
  assert.equal(validConfig('11111111-1111-1111-1111-111111111111','organizations'),true);
  assert.equal(validConfig('00000000-0000-0000-0000-000000000000','organizations'),false);
});
test('XLSX resolves shared-string indices and inline strings in sheet row order', () => {
  const entries = {'xl/sharedStrings.xml':Buffer.from('<sst><si><t>姓名</t></si><si><r><t>张</t></r><r><t>三</t></r></si></sst>'),'xl/worksheets/sheet1.xml':Buffer.from('<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="inlineStr"><is><t>EC</t></is></c></row><row><c t="s"><v>1</v></c><c><v>12</v></c></row></sheetData></worksheet>')};
  assert.equal(spreadsheetText(entries),'姓名\tEC\n张三\t12');
});
test('XML external declarations are rejected', () => {
  assert.throws(() => spreadsheetText({'xl/sharedStrings.xml':Buffer.from('<!DOCTYPE a><sst/>')}));
});
test('document worker reads text and truthfully rejects unsupported data', async () => {
  const langs=path.join(__dirname,'../Windows/ocr-data');
  const result=await parseDocument(Buffer.from('课程 12'),'test.txt','text/plain',langs);
  assert.equal(result.text,'课程 12'); assert.equal(result.status,'read');
  const unknown=await parseDocument(Buffer.from('test'),'test.bin','application/octet-stream',langs);
  assert.equal(unknown.status,'unsupported');
});
test('Graph preserves current job when local snapshot storage fails', async () => {
  let checkpoint;
  const service=new GraphService({folder:'/unused',resources:'/unused',readJSON:()=>null,emit:()=>{},bindAccount:()=>{},getState:()=>({settings:{}}),saveJSON:(_p,v)=>{checkpoint=v;},saveSnapshots:()=>{throw Error('disk full');}});
  service.account={}; service.config={clientId:'11111111-1111-1111-1111-111111111111',tenant:'organizations'};
  service.readJSON=()=>({accountId:'me',configKey:service.config.clientId+'|organizations',jobs:[{url:'https://graph.microsoft.com/v1.0/me/chats/chat/messages',kind:'chatMessages',context:{chat:{id:'chat'}}}]});
  service.request=async url=>url.includes('/me?$select')?{id:'me'}:{value:[{id:'1',body:{content:'hello'}}]};
  await service.sync(); assert.equal(checkpoint.jobs.length,1); assert.match(service.progress.message,/未能保存/);
});
