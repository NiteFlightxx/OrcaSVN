const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const vm=require('node:vm')
const ts=require('typescript')
const vue=require('vue')
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
const versionContext={exports:{}};vm.runInNewContext(compile(fs.readFileSync('src/utils/version.ts','utf8')),versionContext)
function harness(releases,current='0.6.5-rc.4',status=200){
 const requests=[],opened=[]
 const mocks={vue,'@tauri-apps/plugin-shell':{open:url=>opened.push(url)},'../../package.json':{default:{version:current}},'@/utils/version':versionContext.exports}
 const context={exports:{},require:name=>{assert.ok(name in mocks,name);return mocks[name]},AbortController,window:{setTimeout:()=>1,clearTimeout(){}},fetch:async url=>{requests.push(url);return {ok:status===200,status,json:async()=>releases}}}
 vm.runInNewContext(compile(fs.readFileSync('src/composables/useUpdateCheck.ts','utf8')),context)
 return {...context.exports.useUpdateCheck(),requests,opened}
}
test('fork update check uses its own repository and treats an empty release list as no update',async()=>{
 const h=harness([]);await h.checkForUpdates();assert.equal(h.state.value,'upToDate');assert.match(h.requests[0],/repos\/NiteFlightxx\/OrcaSVN\/releases\?/);h.openReleasePage();assert.equal(h.opened[0],'https://github.com/NiteFlightxx/OrcaSVN/releases')
})
test('only prereleases or drafts do not produce a failed check or a stable update',async()=>{
 const h=harness([{tag_name:'v0.6.5-rc.5',prerelease:true},{tag_name:'v0.6.6',draft:true}]);await h.checkForUpdates();assert.equal(h.state.value,'upToDate');assert.equal(h.latestVersion.value,null)
})
test('release selection compares versions numerically and opens the fork tag',async()=>{
 const h=harness([{tag_name:'v0.9.0'},{tag_name:'v0.10.0',html_url:'https://github.com/wustites/OrcaSVN/releases/tag/v0.10.0'},{tag_name:'v0.8.0'}]);await h.checkForUpdates();assert.equal(h.state.value,'available');assert.equal(h.latestVersion.value,'0.10.0');h.openReleasePage();assert.equal(h.opened[0],'https://github.com/NiteFlightxx/OrcaSVN/releases/tag/v0.10.0')
})
test('matching stable version is offered to its release candidate and newer candidates are ignored',async()=>{
 const h=harness([{tag_name:'v0.6.5'},{tag_name:'v0.7.0-rc.1',prerelease:true}]);await h.checkForUpdates();assert.equal(h.latestVersion.value,'0.6.5')
})
test('network failure and malformed payloads remain failures rather than reporting up to date',async()=>{
 for(const [data,status] of [[[],403],[{},200]]){const h=harness(data,'0.6.5',status);await h.checkForUpdates();assert.equal(h.state.value,'failed')}
})
test('simultaneous update checks share one request',async()=>{
 const h=harness([]);await Promise.all([h.checkForUpdates(),h.checkForUpdates()]);assert.equal(h.requests.length,1)
})
