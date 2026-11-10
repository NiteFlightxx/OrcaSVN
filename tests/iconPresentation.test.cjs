const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const vm=require('node:vm')
const ts=require('typescript')
const vue=require('vue')
const {renderToString}=require('vue/server-renderer')
function load(path,mocks={}) {
  const context={exports:{},require:name=>{assert.ok(name in mocks,name);return mocks[name]}}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context)
  return context.exports
}
test('all shared icons render as accessible decorative SVG without font ligature text',async()=>{
  const icons=load('src/components/icons/materialIcons.ts',{vue})
  assert.ok(Object.keys(icons).length>40)
  for(const [name,component] of Object.entries(icons)) {
    const html=await renderToString(vue.createSSRApp(component,{class:'caller-class'}))
    assert.match(html,/<svg /,name)
    assert.match(html,/viewBox="0 0 24 24"/,name)
    assert.match(html,/aria-hidden="true"/,name)
    assert.match(html,/caller-class/,name)
    assert.match(html,/<path d="[^"]+"/,name)
    assert.doesNotMatch(html,/material-symbols|account_tree|progress_activity/,name)
  }
})
test('file icons distinguish UE assets, images and source while handling casing and @ paths',()=>{
  const {fileIconName}=load('src/utils/filePresentation.ts')
  assert.equal(fileIconName('Content/Hero.UASSET'),'FileAsset')
  assert.equal(fileIconName('Maps/世界.umap'),'FileAsset')
  assert.equal(fileIconName('Source/@feature/Locomotion.h'),'FileCode')
  assert.equal(fileIconName('Config/DefaultEngine.ini'),'FileCode')
  assert.equal(fileIconName('Textures/A.TGA'),'FileImage')
  assert.equal(fileIconName('README'),'Document')
})
