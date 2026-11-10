const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const utilContext = { exports: {} }
vm.runInNewContext(compile(fs.readFileSync('src/utils/conflictResolution.ts', 'utf8')), utilContext)
const utils = utilContext.exports
const conflict = (path, kind = 'content') => ({ path, kind, details: '', versions: [] })
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
const settle = () => new Promise(resolve => setImmediate(resolve))
function harness(options = {}) {
  const workspace = vue.reactive({ currentPath: '/fixture/wc', svnInfo: { url: 'file:///fixture/dev' } })
  const props = vue.reactive({ request: { workspace: workspace.currentPath, branch: workspace.svnInfo.url, files: options.files || ['plugin.dll'], otherCount: 0 } })
  const events = [], calls = []
  let refreshes = 0
  const flow = vue.reactive({ busy: false, perform: async (_title, action) => { flow.busy = true; const path = workspace.currentPath; try { return await action() } finally { if (workspace.currentPath === path) refreshes++; flow.busy = false } } })
  const api = {
    repositoryIdentity: options.identity || (async () => ({ root: '/fixture/wc', url: 'file:///fixture/dev' })),
    repositoryConflicts: async () => options.conflicts || [conflict('plugin.dll')],
    repositoryResolve: async (...args) => { calls.push(args); return options.resolve ? options.resolve(...args) : { error: null, conflicts: [] } },
  }
  const mocks = { vue: { ...vue, onBeforeUnmount() {} }, 'vue-i18n': { useI18n: () => ({ t: (key, vars) => key + (vars?.count === undefined ? '' : ':' + vars.count) }) }, '@/stores/workspace': { useWorkspaceStore: () => workspace }, '@/stores/workflows': { useWorkflowStore: () => flow }, '@/api/workflows': api, '@/utils/conflictResolution': utils }
  const source = fs.readFileSync('src/components/ConflictResolutionDialog.vue', 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const context = { exports: {}, defineProps: () => props, defineEmits: () => (...args) => events.push(args), require: name => { assert.ok(name in mocks, name); return mocks[name] } }
  const scope = vue.effectScope()
  scope.run(() => vm.runInNewContext(compile(source + '\nexports.actions = { items, strategy, manual, canApply, apply, close, completed, error, loading };'), context))
  return { ...context.exports.actions, workspace, props, events, calls, flow, refreshes: () => refreshes, stop: () => scope.stop() }
}
test('opening the chooser and cancelling never resolves or reverts a file', async () => {
  const h = harness()
  await settle()
  assert.equal(h.strategy.value, 'working')
  assert.equal(h.calls.length, 0)
  assert.equal(h.canApply.value, true)
  h.close()
  assert.equal(h.events.at(-1)[0], 'close')
  assert.equal(h.calls.length, 0)
  h.stop()
})
test('each explicit choice maps to its correct SVN resolution strategy', async () => {
  for (const strategy of ['working', 'mine-full', 'theirs-full']) {
    const h = harness()
    await settle()
    h.strategy.value = strategy
    await h.apply()
    assert.deepEqual(h.calls[0], ['/fixture/wc', 'plugin.dll', strategy, 'file:///fixture/dev'])
    assert.equal(h.events.at(-1)[0], 'resolved')
    assert.equal(h.refreshes(), 1)
    h.stop()
  }
})
test('duplicate Apply and closing during execution cannot start a second operation', async () => {
  const operation = deferred(), h = harness({ resolve: () => operation.promise })
  await settle()
  const pending = h.apply()
  await h.apply()
  h.close()
  assert.equal(h.calls.length, 1)
  assert.equal(h.events.length, 0)
  operation.resolve({ error: null, conflicts: [] })
  await pending
  assert.equal(h.events.at(-1)[0], 'resolved')
  h.stop()
})
test('a changed workspace invalidates the chooser and late loading cannot authorize writes', async () => {
  const identity = deferred(), h = harness({ identity: () => identity.promise })
  h.workspace.currentPath = '/fixture/other'
  identity.resolve({ root: '/fixture/wc', url: 'file:///fixture/dev' })
  await settle()
  await h.apply()
  assert.equal(h.calls.length, 0)
  assert.equal(h.canApply.value, false)
  h.stop()
})
test('partial batch failure retains completed paths and leaves the remaining conflict available', async () => {
  const h = harness({ files: ['first.dll', 'second.dll'], conflicts: [conflict('first.dll'), conflict('second.dll')], resolve: async (_root, path) => path === 'first.dll' ? { error: null, conflicts: ['second.dll'] } : { error: 'locked', conflicts: ['second.dll'] } })
  await settle()
  await h.apply()
  assert.deepEqual(Array.from(h.completed.value), ['first.dll'])
  assert.equal(h.calls.length, 2)
  assert.match(h.error.value, /partial:1[\s\S]*locked/)
  assert.equal(h.events.some(event => event[0] === 'resolved'), false)
  assert.equal(h.refreshes(), 1)
  h.stop()
})
test('property and tree conflicts require manual acknowledgement and disallow whole-file replacement', async () => {
  const h = harness({ conflicts: [conflict('plugin.dll', 'tree')] })
  await settle()
  assert.equal(h.canApply.value, false)
  h.manual.value = true
  assert.equal(h.canApply.value, true)
  h.strategy.value = 'theirs-full'
  assert.equal(h.canApply.value, false)
  h.stop()
})
test('subdirectory selection maps to the root without including other conflicts', () => {
  const conflicts = [conflict('sub/plugin.dll'), conflict('plugin.dll'), conflict('sub/other.dll')]
  assert.deepEqual(Array.from(utils.selectedConflicts('E:\\fixture\\sub', 'E:\\fixture', ['plugin.dll'], conflicts).map(item => item.path)), ['sub/plugin.dll'])
  assert.throws(() => utils.selectedConflicts('/other', '/fixture', ['plugin.dll'], conflicts), /outside/)
})
