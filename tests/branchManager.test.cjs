const {test}=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs'); const vm=require('node:vm'); const ts=require('typescript'); const vue=require('vue');
function harness(addBranch) {
 const workspace=vue.reactive({currentPath:'/fixture/wc'}), flow=vue.reactive({identity:{uuid:'fixture',url:'https://example.test/dev'},browserUrl:'https://example.test',addBranch}), closed=[];
 const mocks={vue:{...vue,onBeforeUnmount(){}},'@/stores/workflows':{useWorkflowStore:()=>flow},'@/stores/workspace':{useWorkspaceStore:()=>workspace},'vue-i18n':{useI18n:()=>({t:key=>key})}};
 const source=fs.readFileSync('src/components/BranchManagerDialog.vue','utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
 const context={exports:{},defineProps:()=>({initialMode:'add'}),defineEmits:()=>()=>closed.push(true),require:name=>{assert.ok(name in mocks,name);return mocks[name]}};
 const scope=vue.effectScope();scope.run(()=>vm.runInNewContext(ts.transpileModule(source+'\nexports.actions={input,error,saved,adding,add};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context));
 return {...context.exports.actions,workspace,flow,closed,stop:()=>scope.stop()};
}
test('adding several branch URLs keeps successful entries and leaves failed URLs editable',async()=>{
 const calls=[];const h=harness(async url=>{calls.push(url);if(url.endsWith('/bad'))throw new Error('Access denied');});
 h.input.value='https://example.test/good\nhttps://example.test/bad\nhttps://example.test/good';await h.add();
 assert.deepEqual(calls,['https://example.test/good','https://example.test/bad']);assert.equal(h.saved.value,1);assert.equal(h.input.value,'https://example.test/bad');assert.match(h.error.value,/Access denied/);assert.equal(h.closed.length,0);assert.equal(h.adding.value,false);h.stop();
});
test('successful URL additions close the manager without switching a branch',async()=>{
 const h=harness(async()=>{});h.input.value='https://example.test/good';await h.add();assert.equal(h.saved.value,1);assert.equal(h.closed.length,1);h.stop();
});
test('a late URL-validation reply cannot update a different workspace dialog',async()=>{
 let finish;const h=harness(()=>new Promise(resolve=>{finish=resolve}));h.input.value='https://example.test/good';const pending=h.add();h.workspace.currentPath='/other';await vue.nextTick();finish();await pending;assert.equal(h.saved.value,0);assert.equal(h.closed.length,1);h.stop();
});
