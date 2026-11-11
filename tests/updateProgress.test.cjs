const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
const vue = require('vue')
function deferred() {
  let resolve, reject
  const promise = new Promise((yes,no) => {resolve=yes;reject=no})
  return {promise,resolve,reject}
}
function harness() {
  const update=deferred(), verification=deferred(), calls=[]
  const workspace=vue.reactive({currentPath:'/synthetic/wc',isLoading:false,svnInfo:{url:'file:///synthetic/dev'},setError:error=>calls.push(['error',error])})
  const flow=vue.reactive({busy:false,commandOutput:'previous command',refreshWarning:false,perform:async(_title,operation,_mutation,refreshLocal)=>{
    assert.equal(refreshLocal,false)
    flow.busy=true;flow.commandOutput=''
    try{return await operation()}finally{flow.busy=false}
  }})
  const mocks={vue,'vue-i18n':{useI18n:()=>({t:key=>key})},'element-plus/es/components/message/index':{ElMessage:{success:()=>calls.push(['success']),warning:()=>calls.push(['warning'])}},'@/api/svn':{svnUpdate:(...args)=>{calls.push(['update',...args]);return update.promise}},'@/stores/workspace':{useWorkspaceStore:()=>workspace},'@/stores/workflows':{useWorkflowStore:()=>flow},'@/composables/useWorkspace':{useWorkspace:()=>({refreshStatusAfterUpdate:(...args)=>{calls.push(['refresh',...args]);return verification.promise}})}}
  const context={exports:{},require:name=>{assert.ok(name in mocks,name);return mocks[name]}}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/composables/useSvnUpdate.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context)
  return {...context.exports.useSvnUpdate(),feedback:context.exports.svnUpdateFeedback,makeUpdate:context.exports.useSvnUpdate,flow,workspace,update,verification,calls}
}

test('update feedback opens immediately, streams output and shares the running guard across callers',async()=>{
  const h=harness(), pending=h.updateWorkspace()
  assert.equal(h.feedback.visible,true)
  assert.equal(h.feedback.running,true)
  assert.equal(h.feedback.workspace,'/synthetic/wc')
  assert.equal(h.feedback.output,'')
  h.flow.commandOutput='Updating working copy...\nU    Content/Selected.uasset\n'
  assert.match(h.feedback.output,/Selected.uasset/)
  const other=h.makeUpdate()
  assert.equal(other.updating.value,true)
  await other.updateWorkspace()
  assert.equal(h.calls.filter(call=>call[0]==='update').length,1)
  h.update.resolve({success:true,output:'Updated to revision 43.\n',conflicts:[]})
  await pending
  assert.equal(h.feedback.state,'completed')
  assert.equal(h.updating.value,false)
  assert.equal(other.updating.value,false)
  assert.match(h.feedback.output,/revision 43/)
  // Native completion does not wait for the background inventory.
  assert.deepEqual(h.calls.map(call=>call[0]),['update','refresh','success'])
  h.verification.resolve(true)
})

test('backgrounding does not cancel the command and a failure reopens the result with its output',async()=>{
  const h=harness(), pending=h.updateWorkspace()
  h.flow.commandOutput='U    Content/A.uasset\n'
  h.feedback.visible=false
  assert.equal(h.feedback.running,true)
  h.update.reject(new Error('Synthetic connection interrupted'))
  await pending
  assert.equal(h.feedback.state,'failed')
  assert.equal(h.feedback.running,false)
  assert.equal(h.feedback.visible,true)
  assert.match(h.feedback.output,/A.uasset/)
  assert.match(h.feedback.error,/connection interrupted/)
  assert.equal(h.calls.some(call=>call[0]==='success'),false)
  h.flow.commandOutput='unrelated later command'
  assert.match(h.feedback.output,/A.uasset/)
  h.verification.resolve(true)
})

test('conflict results remain visible and preserve paths without a success notification',async()=>{
  const h=harness(),pending=h.updateWorkspace()
  h.feedback.visible=false
  h.update.resolve({success:true,output:'C    Content/A.uasset',conflicts:['Content/A.uasset']})
  await pending
  assert.equal(h.feedback.state,'conflicts')
  assert.equal(h.feedback.visible,true)
  assert.deepEqual(Array.from(h.feedback.conflicts),['Content/A.uasset'])
  assert.equal(h.calls.some(call=>call[0]==='warning'),true)
  assert.equal(h.calls.some(call=>call[0]==='success'),false)
  h.verification.resolve(true)
})

test('completion is attributed to the original workspace when the selected repository changes',async()=>{
  const h=harness(),pending=h.updateWorkspace()
  h.workspace.currentPath='/synthetic/other'
  h.update.resolve({success:true,output:'At revision 43.',conflicts:[]})
  await pending
  assert.equal(h.feedback.workspace,'/synthetic/wc')
  assert.equal(h.feedback.state,'completed')
  assert.equal(h.calls.some(call=>call[0]==='success'),false)
  h.verification.resolve(true)
})
