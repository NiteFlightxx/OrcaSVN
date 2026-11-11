const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'), vm=require('node:vm'), ts=require('typescript')
function load(path){const context={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context);return context.exports}
const {historyMenu,historyClipboard}=load('src/utils/historyMenu.ts')
const base={count:1,busy:false,scoped:false,sameSource:true,canReverse:true,hasWorkspace:true}
const menu=overrides=>historyMenu({...base,...overrides},key=>key)
const item=(items,id)=>items.flatMap(i=>i.children||[i]).find(i=>i.id===id)
test('SVN history menu groups branch/tag, working-copy operations, comparisons and clipboard without Git rewriting',()=>{
 const items=menu({})
 for(const id of ['createBranch','createTag','updateRevision','checkoutRevision','reverseMerge','editMessage','exportPatch','compareBase','compareWorking','copyInfo'])assert.ok(items.some(i=>i.id===id),id)
 assert.ok(!items.some(i=>/^(rebase|interactiveRebase|squash|reset|drop|fixup)$/i.test(i.id)))
 assert.equal(item(items,'cherryPick').disabled,true)
 assert.equal(item(items,'reverseMerge').disabled,false)
 assert.ok(items.filter(i=>i.separator).length>=3)
 assert.ok(items.find(i=>i.id==='copy').children.length>=5)
})
test('multi-selection keeps exact revision operations and copying, while disabling single-revision forms',()=>{
 const items=menu({count:3,sameSource:false})
 for(const id of ['createBranch','createTag','updateRevision','checkoutRevision','editMessage','compare'])assert.equal(item(items,id),undefined,id)
 for(const id of ['cherryPick','exportPatch','copyInfo','copyMessage'])assert.equal(item(items,id).disabled,false,id)
 assert.equal(item(menu({count:2}),'compare').disabled,false)
})
test('busy, scoped and unknown-source contexts cannot initiate incompatible writes',()=>{
 for(const id of ['createBranch','updateRevision','cherryPick','reverseMerge','editMessage','exportPatch'])assert.equal(item(menu({busy:true}),id).disabled,true,id)
 for(const id of ['createBranch','createTag','updateRevision','checkoutRevision','cherryPick','reverseMerge'])assert.equal(item(menu({scoped:true}),id).disabled,true,id)
 assert.equal(item(menu({scoped:true}),'editMessage').disabled,false)
 assert.equal(item(menu({canReverse:false}),'reverseMerge').disabled,true)
 assert.equal(item(menu({count:129}),'exportPatch').disabled,true)
 assert.equal(item(menu({busy:true}),'copyMessage').disabled,false)
})
test('clipboard information uses SVN revisions and keeps full messages, source and multiple selected rows',()=>{
 const rows=[{revision:9,author:'a',date:'2026-11-11',message:'Subject\n\nDetails'},{revision:5,author:'b',date:'2026-11-10',message:'Other'}]
 assert.equal(historyClipboard('copyRevision',rows,'file:///repo/dev'),'r9\nr5')
 assert.equal(historyClipboard('copySummary',rows,'file:///repo/dev'),'r9 - Subject\nr5 - Other')
 assert.match(historyClipboard('copyInfo',rows,'file:///repo/dev'),/Subject\n\nDetails/)
 assert.equal(historyClipboard('copyUrl',rows,'file:///repo/dev'),'file:///repo/dev@9\nfile:///repo/dev@5')
})
test('all five locales supply every menu, eligibility reason and confirmation hint',()=>{
 const {historyMenuLocales:locales}=load('src/i18n/historyMenu.ts')
 const keys=Object.keys(locales['en-US']).sort()
 assert.equal(Object.keys(locales).length,5)
 for(const messages of Object.values(locales)){assert.deepEqual(Object.keys(messages).sort(),keys);for(const text of Object.values(messages))assert.ok(text.length)}
})
