'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Core=require('../Resources/core.js');

test('backup envelopes round-trip validated independent state and require matching app, edition and schema',()=>{
  const state=Core.emptyState();
  state.manualTasks.push({id:'manual',title:'Synthetic personal task',course:'Personal',dueAt:null,dueLabel:'',status:'open',createdAt:'2026-09-27T00:00:00Z'});
  const envelope=Core.exportBackup(state);
  assert.equal(envelope.app,'CampusDesk');assert.equal(envelope.edition,'standard');assert.equal(envelope.schemaVersion,1);
  const restored=Core.importBackup(JSON.stringify(envelope));
  assert.equal(restored.legacy,false);assert.equal(restored.state.manualTasks[0].title,'Synthetic personal task');
  restored.state.manualTasks[0].title='Changed';assert.equal(state.manualTasks[0].title,'Synthetic personal task');
  for(const override of [{app:'AnotherApp'},{edition:'theme'},{schemaVersion:2},{data:{version:1}}]) {
    assert.throws(()=>Core.importBackup({...envelope,...override},{allowLegacy:true}));
  }
  const context={CampusDeskThemeEdition:true,URL,TextEncoder};
  vm.runInNewContext(fs.readFileSync(require.resolve('../Resources/core.js'),'utf8'),context);
  const theme=context.CampusCore, themeEnvelope=theme.exportBackup(theme.emptyState());
  assert.equal(themeEnvelope.edition,'theme');
  assert.equal(theme.importBackup(JSON.stringify(themeEnvelope)).legacy,false);
  assert.throws(()=>theme.importBackup(JSON.stringify(envelope)),/应用或版本类型不匹配/);
});

test('legacy import requires explicit permission while local missing-field migration remains compatible',()=>{
  const old=Core.emptyState();delete old.changeLog;delete old.settings.graphicsMode;
  assert.throws(()=>Core.importBackup(old),/旧格式备份需要明确确认/);
  const result=Core.importBackup(JSON.stringify(old),{allowLegacy:true});
  assert.equal(result.legacy,true);assert.deepEqual(result.state.changeLog,[]);
  assert.equal(result.state.settings.graphicsMode,'auto');
  assert.equal(Core.validateState(old).settings.graphicsMode,'auto');
  assert.throws(()=>Core.importBackup({...old,app:'WrongApp'},{allowLegacy:true}),/应用或版本类型不匹配/);
  for(const graphicsMode of ['auto','low-power']) assert.equal(Core.validateState({...old,settings:{...old.settings,graphicsMode}}).settings.graphicsMode,graphicsMode);
  assert.throws(()=>Core.validateState({...old,settings:{...old.settings,graphicsMode:'invalid'}}),/图形性能设置无效/);
});
