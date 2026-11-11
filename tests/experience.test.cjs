const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
function load(path, mocks = {}, extra = {}) {
  const context = { exports:{}, require:name => { assert.ok(name in mocks,name); return mocks[name] }, ...extra }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context)
  return context.exports
}
const document = load('src/utils/diffDocument.ts')
const pairs = load('src/utils/diffPairs.ts',{'./diffDocument':document})
test('side-by-side pairs retain every deletion and insertion, including unequal blocks and properties',()=>{
  const text='--- old\n+++ new\n@@ -1,3 +1,2 @@\n-a\n-b\n-c\n+x\n+y\nProperty changes on: folder\nModified: svn:ignore\n## -0,0 +1 ##\n+*.tmp'
  const rows=pairs.pairDiffRows(text)
  assert.deepEqual(Array.from(rows.filter(row=>row.left?.className==='diff-removed'),row=>row.left.text),['a','b','c'])
  assert.deepEqual(Array.from(rows.filter(row=>row.right?.className==='diff-added'),row=>row.right.text),['x','y','*.tmp'])
  assert.ok(rows.some(row=>row.left?.text==='c' && row.right===null))
  assert.ok(rows.some(row=>row.left?.text==='Property changes on: folder'))
})
test('snapshot comparison keeps shared prefix and suffix out of the change block',()=>{
  assert.equal(pairs.snapshotDiff('a\nold\nz','a\nnew\nz'),'--- BASE\n+++ Saved\n@@ -2,1 +2,1 @@\n-old\n+new')
  assert.equal(pairs.snapshotDiff('same','same'),'')
})
test('repository view state is isolated and tab reordering or closing never invents targets',()=>{
  const ui=load('src/utils/repositoryUi.ts')
  ui.repositoryUi('/synthetic/a').route='log'
  ui.repositoryUi('/synthetic/a').workspace={filter:'modified',query:'asset',selected:'a.uasset',scroll:[52,26]}
  assert.equal(ui.repositoryUi('/synthetic/b').route,'workspace')
  assert.equal(ui.repositoryUi('/synthetic/a').workspace.scroll[0],52)
  assert.deepEqual(Array.from(ui.reorderTabs(['a','b','c'],'a','c')),['b','c','a'])
  assert.deepEqual(Array.from(ui.tabsToClose(['a','b','c'],'b','right')),['c'])
  assert.deepEqual(Array.from(ui.tabsToClose(['a','b','c'],'b','others')),['a','c'])
  assert.deepEqual(Array.from(ui.tabsToClose(['a','b'],'unknown','others')),[])
})
function commitHarness(options={}) {
  const entry=(path,status_code='modified')=>({path,status_code,prop_status:'none'})
  const workspace=vue.reactive({currentPath:'/synthetic/a',svnInfo:{url:'file:///synthetic/dev'},statusList:[entry('a.txt')],rawStatusList:options.entries||[entry('a.txt')],statusIsStale:false})
  const staging=vue.reactive({key:'a:dev',paths:workspace.rawStatusList.map(entry=>entry.path),ready:true,stage(paths){this.paths=[...paths]},unstage(paths,key){calls.push(['unstage',key,...paths]);this.paths=this.paths.filter(path=>!paths.includes(path))}})
  const draft=vue.reactive({key:'draft-a',message:'Summary\n\nDetails',clearIfUnchanged(key,message){if(this.key===key&&this.message===message)this.message=''}})
  const calls=[], emitted=[], storage=new Map()
  const flow=vue.reactive({busy:false,async perform(_title,operation){if(this.busy)throw new Error('busy');this.busy=true;try{return await operation()}finally{this.busy=false}}})
  const api={svnStatus:async()=>{throw new Error('Full workspace status must not be queried by commit UI')},svnAdd:async(_path,files)=>{calls.push(['add',...files]); workspace.rawStatusList=workspace.rawStatusList.map(entry=>({...entry,status_code:'added'}));return{success:true}},svnCommit:async(...args)=>{calls.push(['commit',...args]);if(options.commit)return options.commit(...args); const added=workspace.rawStatusList.some(e=>e.status_code==='unversioned'); if(added){calls.push(['add',...args[2]]); workspace.rawStatusList=workspace.rawStatusList.map(e=>({...e,status_code:'added'}))} return {success:true,output:'Committed',error:null,added}}}
  const mocks={vue,'vue-i18n':{useI18n:()=>({t:key=>key})},'element-plus':{ElMessage:{success:message=>calls.push(['success',message]),warning:message=>calls.push(['warning',message])}},'@/stores/workspace':{useWorkspaceStore:()=>workspace},'@/stores/workflows':{useWorkflowStore:()=>flow},'@/stores/staging':{useStagingStore:()=>staging},'@/stores/commitDraft':{useCommitDraftStore:()=>draft},'@/composables/useWorkspace':{useWorkspace:()=>({applyCommitResult:async()=>true})},'@/composables/useSettings':{useSettings:()=>({settings:{}})},'@/api/svn':api}
  const source=fs.readFileSync('src/components/CommitReviewDialog.vue','utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const context={exports:{},defineProps:()=>({}),defineEmits:()=>event=>emitted.push(event),localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},require:name=>{assert.ok(name in mocks,name);return mocks[name]}}
  vm.runInNewContext(ts.transpileModule(source+'\nexports.actions={submit,error,notice,files,changedContext,hidden,commitPhase};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context)
  return {...context.exports.actions,workspace,staging,draft,flow,calls,emitted,api}
}
test('submission failure keeps selection and the complete message available for retry',async()=>{
  const h=commitHarness({commit:async()=>{throw new Error('offline')}})
  await h.submit()
  assert.match(h.error.value,/offline/)
  assert.equal(h.draft.message,'Summary\n\nDetails')
  assert.deepEqual(Array.from(h.staging.paths),['a.txt'])
  assert.deepEqual(h.emitted,[])
  assert.equal(h.flow.busy,false)
})
test('new files are added and re-reviewed before a separate explicit submission',async()=>{
  const h=commitHarness({entries:[{path:'new.txt',status_code:'unversioned',prop_status:'none'}]})
  await h.submit()
  assert.equal(h.calls.filter(call=>call[0]==='add').length,1)
  assert.equal(h.calls.filter(call=>call[0]==='commit').length,1)
  assert.equal(h.draft.message,'Summary\n\nDetails')
  assert.equal(h.notice.value,'commit.reviewAdded')
  await h.submit()
  assert.equal(h.calls.filter(call=>call[0]==='commit').length,2)
  assert.equal(h.draft.message,'')
  assert.deepEqual(Array.from(h.staging.paths),[])
})
test('changing repositories invalidates the open submission review',async()=>{
  const h=commitHarness();h.workspace.currentPath='/synthetic/b';await h.submit()
  assert.equal(h.changedContext.value,true);assert.equal(h.calls.length,0)
})
test('backend scope validation failure preserves the draft without a full workspace scan',async()=>{
  const h=commitHarness({commit:async()=>{throw new Error('Selected path is no longer changed')}})
  await h.submit()
  assert.ok(h.error.value);assert.ok(h.draft.message)
  assert.deepEqual(Array.from(h.staging.paths),['a.txt'])
})

test('duplicate clicks cannot submit twice and edits made while submitting keep the new draft',async()=>{
  let finish
  const h=commitHarness({commit:()=>new Promise(resolve=>{finish=resolve})})
  const pending=h.submit();await new Promise(resolve=>setImmediate(resolve));await h.submit()
  h.draft.message='Next change';finish({success:true,output:'Committed'});await pending
  assert.equal(h.calls.filter(call=>call[0]==='commit').length,1);assert.equal(h.draft.message,'Next change')
})
test('hidden staged paths stay in the reviewed submission instead of silently dropping out',async()=>{
  const h=commitHarness({entries:[{path:'a.txt',status_code:'modified',prop_status:'none'},{path:'hidden.txt',status_code:'modified',prop_status:'none'}]})
  assert.equal(h.hidden.value,1);await h.submit();assert.deepEqual(Array.from(h.calls.find(call=>call[0]==='commit')[3]),['a.txt','hidden.txt'])
})
test('all five locales provide the same new workflow controls',()=>{
  const {experienceLocales}=load('src/i18n/experience.ts')
  const keys=Object.keys(experienceLocales['en-US']).sort()
  assert.equal(Object.keys(experienceLocales).length,5)
  for(const messages of Object.values(experienceLocales))assert.deepEqual(Object.keys(messages).sort(),keys)
})


test('added directory review expands only actual backend-added roots', async () => {
  const h = commitHarness({ entries: [
    {path:'new',status_code:'unversioned',prop_status:'none'},
    {path:'existing',status_code:'normal',prop_status:'modified'},
  ] })
  h.api.svnCommit = async () => {
    h.workspace.rawStatusList = [
      {path:'new',status_code:'added',prop_status:'none'},
      {path:'new/a.txt',status_code:'added',prop_status:'none'},
      {path:'existing',status_code:'normal',prop_status:'modified'},
      {path:'existing/unselected.txt',status_code:'modified',prop_status:'none'},
    ]
    return {success:true,added:true,addedPaths:['new'],output:''}
  }
  await h.submit()
  assert.deepEqual(Array.from(h.files.value), ['new','new/a.txt','existing'])
  assert.ok(h.draft.message)
  assert.deepEqual(h.emitted, [])
})

test('all five locales provide the same commit phases and refresh result message', () => {
  const {commitFlowLocales} = load('src/i18n/commitFlow.ts')
  const keys=Object.keys(commitFlowLocales['en-US']).sort()
  assert.equal(Object.keys(commitFlowLocales).length,5)
  for(const messages of Object.values(commitFlowLocales))assert.deepEqual(Object.keys(messages).sort(),keys)
})


test('commit progress distinguishes checking, submission, and the final local merge', () => {
  const h = commitHarness()
  assert.equal(h.commitPhase.value, 'checking')
  h.flow.progress = { phase: 'committing' }
  assert.equal(h.commitPhase.value, 'committing')
  h.flow.progress = { phase: 'refreshing' }
  assert.equal(h.commitPhase.value, 'refreshing')
  h.flow.phase = 'refreshing'
  h.flow.progress = { phase: 'committing' }
  assert.equal(h.commitPhase.value, 'refreshing')
})


test('an add result from the previous workspace cannot stage paths in the newly opened workspace', async () => {
  let complete
  const h = commitHarness({commit: () => new Promise(resolve => {complete = resolve})})
  const pending = h.submit()
  h.workspace.currentPath = '/synthetic/b'
  h.staging.key = 'b:dev'
  h.staging.paths = ['keep.txt']
  complete({success:true,added:true,addedPaths:['a.txt'],output:''})
  await pending
  assert.deepEqual(Array.from(h.staging.paths), ['keep.txt'])
  assert.ok(h.draft.message)
})
