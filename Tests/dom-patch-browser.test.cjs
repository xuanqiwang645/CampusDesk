'use strict';
// Real Chromium DOM/IME regressions. All fixtures are synthetic and isolated.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const optional = { skip: !process.env.PLAYWRIGHT_MODULE };
const script = path.resolve(__dirname, '../Resources/dom-patch.js');

async function fixture(run) {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<main id="fixture"></main><button id="outside">Outside</button>');
    await page.addScriptTag({ path: script });
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}
const patch = (page, html) => page.evaluate(html => CampusDOM.patch(document.getElementById('fixture'), html), html);

test('same-slot focused controls keep identity, caret and a real in-progress IME composition', optional, async () => fixture(async page => {
  const markup = status => `<section id="form"><p id="status">${status}</p><input id="date" value="saved"><textarea id="draft">old server text</textarea></section>`;
  await patch(page, markup('old'));
  await page.locator('#date').fill('2026-');
  await page.evaluate(() => {
    window.dateNode = document.getElementById('date');
    dateNode.setSelectionRange(1, 4, 'backward');
  });
  await patch(page, markup('updated'));
  assert.deepEqual(await page.evaluate(() => ({ same: dateNode === document.getElementById('date'), focused: document.activeElement === dateNode, value: dateNode.value, start: dateNode.selectionStart, end: dateNode.selectionEnd, direction: dateNode.selectionDirection })),
    { same:true, focused:true, value:'2026-', start:1, end:4, direction:'backward' });
  await page.locator('#draft').fill('ab__cd');
  await page.evaluate(() => {
    window.draftNode = document.getElementById('draft');
    window.compositionEvents = [];
    for (const name of ['compositionstart','compositionend']) draftNode.addEventListener(name, event => compositionEvents.push([name,event.isTrusted]));
    draftNode.setSelectionRange(2,4);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text:'拼', selectionStart:1, selectionEnd:1 });
  assert.equal(await page.locator('#draft').inputValue(), 'ab拼cd');
  await patch(page, markup('during composition'));
  assert.deepEqual(await page.evaluate(() => ({ same:draftNode===document.getElementById('draft'), focused:document.activeElement===draftNode, value:draftNode.value, events:compositionEvents })),
    { same:true, focused:true, value:'ab拼cd', events:[['compositionstart',true]] });
  await cdp.send('Input.imeSetComposition', { text:'拼音', selectionStart:2, selectionEnd:2 });
  await cdp.send('Input.insertText', { text:'拼音' });
  assert.equal(await page.locator('#draft').inputValue(), 'ab拼音cd', 'the second composition update replaces the marked text instead of appending a duplicate');
  assert.equal(await page.locator('#status').textContent(), 'during composition');
}));

test('keyed card insertion, deletion and reordering retain surviving nodes and exact render order', optional, async () => fixture(async page => {
  await patch(page, '<!--before--><article data-dom-key="a">A</article><article data-dom-key="b">B</article><article data-dom-key="c">C</article><p id="footer">old</p>');
  await page.evaluate(() => {
    window.cards = Object.fromEntries([...document.querySelectorAll('[data-dom-key]')].map(node=>[node.dataset.domKey,node]));
    window.clicked = 0; cards.b.addEventListener('click',()=>clicked++);
  });
  await patch(page, '<!--after--><article data-dom-key="new">New</article><article data-dom-key="c">C updated</article><span>Separator</span><article data-dom-key="b">B updated</article><p id="footer">new footer</p>');
  assert.deepEqual(await page.evaluate(() => ({ order:[...document.getElementById('fixture').childNodes].map(node=>node.nodeType===8?'comment:'+node.nodeValue:node.nodeType===3?'text:'+node.nodeValue:node.getAttribute('data-dom-key')||node.id||node.tagName), sameB:cards.b===document.querySelector('[data-dom-key="b"]'), sameC:cards.c===document.querySelector('[data-dom-key="c"]'), removedA:!cards.a.isConnected, count:document.querySelectorAll('[data-dom-key]').length })),
    {order:['comment:after','new','c','SPAN','b','footer'],sameB:true,sameC:true,removedA:true,count:3});
  await page.locator('[data-dom-key="b"]').click();
  assert.equal(await page.evaluate(()=>clicked),1);
  assert.equal(await page.locator('#footer').textContent(),'new footer');
  await patch(page,'<p id="footer">Only footer</p>');
  assert.equal(await page.locator('#fixture').innerHTML(),'<p id="footer">Only footer</p>');
}));

test('live selects and details preserve user state while unfocused controls accept new values', optional, async () => fixture(async page => {
  await patch(page,'<select id="choice"><option value="a" selected>A</option><option value="b">B</option></select><details id="expanded"><summary>Open me</summary><p>Old</p></details><details id="collapsed" open><summary>Close me</summary></details><input id="check" type="checkbox"><textarea id="idle">old</textarea>');
  await page.locator('#choice').selectOption('b');
  await page.locator('#choice').focus();
  await page.evaluate(()=>{window.selectNode=document.getElementById('choice');document.getElementById('expanded').open=true;document.getElementById('collapsed').open=false;});
  const next='<select id="choice"><option value="a">New A</option><option value="b">New B</option><option value="c" selected>C</option></select><details id="expanded"><summary>Open me</summary><p>Updated</p></details><details id="collapsed" open><summary>Close me</summary></details><input id="check" type="checkbox" checked><textarea id="idle">new</textarea>';
  await patch(page,next);
  assert.deepEqual(await page.evaluate(()=>({same:selectNode===document.getElementById('choice'),focused:document.activeElement===selectNode,value:selectNode.value,expanded:document.getElementById('expanded').open,collapsed:document.getElementById('collapsed').open,checked:document.getElementById('check').checked,idle:document.getElementById('idle').value})),
    {same:true,focused:true,value:'b',expanded:true,collapsed:false,checked:true,idle:'new'});
  assert.equal(await page.locator('#expanded p').textContent(),'Updated');
  await page.locator('#outside').click(); await patch(page,next);
  assert.deepEqual(await page.locator('#choice option').allTextContents(),['New A','New B','C']);
  assert.equal(await page.locator('#choice').inputValue(),'c');
}));

test('chart-owned canvases, hover nodes and listeners survive ordinary surrounding updates', optional, async () => fixture(async page => {
  await patch(page,'<section id="chart-card"><h2>Old title</h2><div id="gpa-kline-chart"></div><div id="gpa-kline-linear-chart"></div><p id="caption">Old caption</p></section>');
  await page.evaluate(()=>{
    window.hosts = ['gpa-kline-chart','gpa-kline-linear-chart'].map(id=>document.getElementById(id));
    window.canvasNodes = hosts.map(host=>{const canvas=document.createElement('canvas');canvas.width=13;host.append(canvas);const badge=document.createElement('span');badge.textContent='Owned hover';host.append(badge);return canvas;});
    window.chartClicks=0;canvasNodes[0].addEventListener('click',()=>chartClicks++);
  });
  await patch(page,'<section id="chart-card"><h2>Updated title</h2><div id="gpa-kline-chart"></div><div id="gpa-kline-linear-chart"></div><p id="caption">Updated caption</p></section>');
  assert.deepEqual(await page.evaluate(()=>hosts.map((host,i)=>({same:host===document.getElementById(host.id),canvas:host.firstChild===canvasNodes[i],width:canvasNodes[i].width,hover:host.querySelector('span').textContent}))),
    [{same:true,canvas:true,width:13,hover:'Owned hover'},{same:true,canvas:true,width:13,hover:'Owned hover'}]);
  await page.locator('#gpa-kline-chart canvas').click();
  assert.equal(await page.evaluate(()=>chartClicks),1);
  assert.equal(await page.locator('#caption').textContent(),'Updated caption');
}));

for (const fallback of [false, true]) test('reordering a keyed card containing the active editor preserves focus and composition' + (fallback ? ' without atomic DOM move support' : ''), optional, async () => fixture(async page => {
  if (fallback) await page.evaluate(()=>Object.defineProperty(Element.prototype,'moveBefore',{value:undefined,configurable:true}));
  await patch(page,'<article data-dom-key="a">A</article><article data-dom-key="b"><input id="moving" value="ab__cd"></article>');
  await page.locator('#moving').focus();
  await page.evaluate(()=>{window.movingNode=document.getElementById('moving');movingNode.setSelectionRange(2,4);});
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition',{text:'拼',selectionStart:1,selectionEnd:1});
  await patch(page,'<article data-dom-key="b"><input id="moving" value="stale state"></article><article data-dom-key="a">A updated</article>');
  assert.deepEqual(await page.evaluate(()=>({same:movingNode===document.getElementById('moving'),focused:document.activeElement===movingNode,value:movingNode.value})),{same:true,focused:true,value:'ab拼cd'});
  await cdp.send('Input.imeSetComposition',{text:'拼音',selectionStart:2,selectionEnd:2});
  await cdp.send('Input.insertText',{text:'拼音'});
  assert.equal(await page.locator('#moving').inputValue(),'ab拼音cd');
}));
