const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const context = { exports: {}, URL }; vm.runInNewContext(compile(fs.readFileSync('src/utils/branches.ts', 'utf8')), context)
const utils = context.exports
const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
function harness(options = {}) {
  const calls = [], messages = [], routes = []
  const identity = { root: '/fixture/wc', uuid: 'fixture', url: 'https://example.test/ugame/dev', revision: 1 }
  const plan = { id: 'fixture-plan', kind: options.kind || 'switch', identity, source: 'https://example.test/ugame/publish', sourceRevision: 20, revision: 0, preview: 'synthetic' }
  const workspace = vue.reactive({ currentPath: identity.root, svnInfo: { url: identity.url }, statusList: [] })
  const flow = vue.reactive({ identity, browsingUrl: identity.url, busy: false, plan: options.kind ? plan : null, switchRequest: options.kind ? null : { workspace: identity.root, current: identity.url, source: plan.source }, rememberBranch: entry => calls.push(['remember', entry]), perform: async (_name, operation) => { flow.busy = true; try { return await operation() } finally { flow.busy = false } } })
  let preview = options.preview || (async () => plan), execute = options.execute || (async () => ({ root: identity.root, identity: { ...identity, url: plan.source }, conflicts: [], error: null }))
  let unmount = () => {}
  const mocks = {
    vue: { ...vue, onBeforeUnmount: fn => { unmount = fn } },
    '@/stores/workflows': { useWorkflowStore: () => flow }, '@/stores/workspace': { useWorkspaceStore: () => workspace },
    '@/api/workflows': { repositoryPreview: async (...args) => { calls.push(['preview', ...args]); return preview(...args) }, repositoryExecute: async (...args) => { calls.push(['execute', ...args]); return execute(...args) } },
    'vue-i18n': { useI18n: () => ({ t: key => key }) }, 'vue-router': { useRouter: () => ({ push: value => routes.push(value) }) },
    '@/composables/useWorkspace': { useWorkspace: () => ({ loadWorkspace: async path => { workspace.currentPath = path } }) },
    '@/utils/branches': utils,
    'element-plus': { ElMessage: { success: value => messages.push(['success', value]), warning: value => messages.push(['warning', value]), error: value => messages.push(['error', value]) } },
  }
  const source = fs.readFileSync('src/components/OperationDialog.vue', 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const cell = { exports: {}, sessionStorage: { setItem() {} }, require: name => { assert.ok(name in mocks, name); return mocks[name] } }
  const scope = vue.effectScope()
  scope.run(() => vm.runInNewContext(compile(source + '\nexports.actions = { loading, error, failure, canExecute, execute, close, check, showChanges };'), cell))
  return { ...cell.exports.actions, flow, workspace, plan, calls, routes, messages, setPreview: fn => { preview = fn }, setExecute: fn => { execute = fn }, stop: () => { unmount(); scope.stop() } }
}

test('branch URLs are normalized without changing case-sensitive paths and list entries are deduplicated', () => {
  assert.equal(utils.normalizeBranchUrl(' [dev](https://EXAMPLE.test/ugame/Dev/) '), 'https://example.test/ugame/Dev')
  assert.equal(utils.uniqueBranches([{ url: 'https://example.test/dev', name: 'dev', kind: 'dir' }, { url: 'https://example.test/dev/', name: 'duplicate', kind: 'dir' }]).length, 1)
  assert.equal(utils.branchName('https://example.test/%E5%BC%80%E5%8F%91'), '开发')
  assert.doesNotThrow(() => utils.branchName('https://example.test/%ZZ'))
  for (const url of ['not a URL', 'javascript:alert(1)', 'https://a.test/dev?secret=1', 'https://user:secret@a.test/dev']) assert.throws(() => utils.normalizeBranchUrl(url))
})

test('switch dialog opens immediately, checks the exact URL and waits for explicit execution', async () => {
  const request = deferred(), h = harness({ preview: () => request.promise })
  assert.equal(h.loading.value, true)
  assert.equal(h.canExecute.value, false)
  assert.equal(h.calls[0][0], 'preview')
  assert.equal(h.calls[0][2], h.plan.source)
  assert.equal(h.calls.some(call => call[0] === 'execute'), false)
  request.resolve(h.plan); await tick()
  assert.equal(h.canExecute.value, true)
  assert.equal(h.flow.plan.sourceRevision, 20)
  assert.equal(h.calls.some(call => call[0] === 'execute'), false)
  h.stop()
})

test('cancel ignores a late preflight reply and never switches files', async () => {
  const request = deferred(), h = harness({ preview: () => request.promise })
  h.close(); request.resolve(h.plan); await tick()
  assert.equal(h.flow.plan, null)
  assert.equal(h.flow.switchRequest, null)
  assert.equal(h.calls.some(call => call[0] === 'execute'), false)
  h.stop()
})

test('local changes stay in the dialog with actionable paths and no automatic stash or discard', async () => {
  const h = harness({ preview: async () => { throw new Error('Commit, stash or resolve these paths first:\nContent/a.uasset\nConfig/local.ini') } })
  await tick()
  assert.equal(h.failure.value.kind, 'changes')
  assert.deepEqual(Array.from(h.failure.value.paths), ['Content/a.uasset', 'Config/local.ini'])
  assert.equal(h.canExecute.value, false)
  h.showChanges('stash')
  assert.equal(h.routes[0].name, 'stash')
  assert.equal(h.calls.filter(call => call[0] === 'execute').length, 0)
  h.stop()
})

test('switch confirmation cannot execute twice and updates the actual current branch', async () => {
  const execution = deferred(), h = harness({ execute: () => execution.promise })
  await tick()
  const first = h.execute(), duplicate = h.execute()
  await duplicate
  assert.equal(h.calls.filter(call => call[0] === 'execute').length, 1)
  execution.resolve({ root: h.workspace.currentPath, identity: { ...h.plan.identity, url: h.plan.source }, conflicts: [], error: null })
  await first; await tick()
  assert.equal(h.flow.identity.url, h.plan.source)
  assert.equal(h.flow.browsingUrl, h.plan.source)
  assert.equal(h.flow.switchRequest, null)
  assert.equal(h.messages[0][1], 'branchUI.switched')
  h.stop()
})

test('workspace changes invalidate a pending switch check', async () => {
  const request = deferred(), h = harness({ preview: () => request.promise })
  h.workspace.currentPath = '/fixture/other'
  await tick(); request.resolve(h.plan); await tick()
  assert.equal(h.flow.plan, null)
  assert.equal(h.flow.switchRequest, null)
  assert.equal(h.canExecute.value, false)
  h.stop()
})

test('target-access errors are separate from parent browsing and can be rechecked', async () => {
  const h = harness({ preview: async () => { throw new Error('svn: E175013: forbidden target') } })
  await tick()
  assert.equal(h.failure.value.kind, 'access')
  h.setPreview(async () => h.plan)
  await h.check()
  assert.equal(h.error.value, '')
  assert.equal(h.canExecute.value, true)
  h.stop()
})

test('a stale consumed plan requires a new check before execution can resume', async () => {
  const h = harness({ execute: async () => { throw new Error('Working-copy changed after preview') } })
  await tick(); await h.execute()
  assert.equal(h.canExecute.value, false)
  assert.equal(h.flow.plan, null)
  assert.match(h.error.value, /changed after preview/)
  await h.check()
  assert.equal(h.canExecute.value, true)
  h.stop()
})

test('cherry-pick failures retain their visible error notification', async () => {
  const h = harness({ kind: 'cherry-pick', execute: async () => { throw new Error('synthetic merge error') } })
  await h.execute()
  assert.ok(h.messages.some(([kind, value]) => kind === 'error' && value.includes('synthetic merge error')))
  assert.equal(h.flow.plan, null)
  h.stop()
})

test('successful cherry-picks still open commit review with tracked changes only', async () => {
  const h = harness({ kind: 'cherry-pick', execute: async () => ({ root: '/fixture/wc', identity: h.plan.identity, conflicts: [], error: null }) })
  h.workspace.statusList = [{ path: 'tracked.txt', status_code: 'modified' }, { path: 'new.txt', status_code: 'unversioned' }]
  await h.execute()
  assert.equal(h.routes[0].name, 'commit')
  assert.deepEqual(Array.from(h.routes[0].query.files), ['tracked.txt'])
  h.stop()
})

test('a preview with local changes remains executable without automatic cleanup', async () => {
  const h = harness()
  h.plan.localChanges = ['Content/local.uasset', 'Config/local.ini']
  await tick()
  assert.equal(h.canExecute.value, true)
  assert.deepEqual(Array.from(h.flow.plan.localChanges), ['Content/local.uasset', 'Config/local.ini'])
  assert.equal(h.calls.filter(call => call[0] === 'execute').length, 0)
  h.stop()
})

test('switch conflicts open conflict review even if SVN also reports an error', async () => {
  const h = harness({ execute: async () => ({ root: '/fixture/wc', identity: { ...h.plan.identity, url: h.plan.source }, error: 'svn: conflict summary', conflicts: ['Content/local.uasset'] }) })
  await tick(); await h.execute()
  assert.equal(h.routes[0].name, 'conflicts')
  assert.equal(h.flow.plan, null)
  assert.equal(h.flow.switchRequest, null)
  assert.equal(h.flow.identity.url, h.plan.source)
  assert.equal(h.messages.some(([kind]) => kind === 'success'), false)
  assert.equal(h.messages[0][0], 'warning')
  h.stop()
})
