const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

// Exercise the real shared operation runner as well as the update action. No
// native command or remote URL is used; unexpected imports fail immediately.
function harness() {
  const command = deferred(), refresh = deferred(), calls = [], messages = []
  const workspace = vue.reactive({ currentPath: '/synthetic/update', epoch: 0, isLoading: false,
    svnInfo: {url:'file:///synthetic/dev'}, statusIsStale: false, error: null, setError(error) { this.error = error } })
  const storage = new Map()
  const mocks = {
    vue: { ...vue, watch() {} },
    pinia: { defineStore: (_name, setup) => () => vue.reactive(setup()) },
    '@tauri-apps/api/event': { listen: async () => () => {} },
    '@/utils/repositoryUi': { repositoryUi: () => ({}) },
    '@/utils/branches': {},
    './workspace': { useWorkspaceStore: () => workspace },
    '@/stores/workspace': { useWorkspaceStore: () => workspace },
    '@/api/workflows': { repositoryIdentity: async () => { throw new Error('fixture: no remote') } },
    '@/composables/useWorkspace': { useWorkspace: () => ({ refreshStatusAfterMutation: async () => { throw new Error('Update must not use the generic foreground refresh') },
    refreshStatusAfterUpdate: (path, url) => {
      if (workspace.currentPath !== path || workspace.svnInfo.url !== url) return Promise.resolve(false)
      calls.push(['refresh', path])
      workspace.statusIsStale = true
      return refresh.promise.then(fresh => {
        if (fresh) workspace.statusIsStale = false
        else workspace.setError('synthetic refresh failed')
        return fresh
      })
    } }) },
    'vue-i18n': { useI18n: () => ({ t: key => key }) },
    'element-plus/es/components/message/index': { ElMessage: {
      success: message => messages.push(['success', message]),
      warning: message => messages.push(['warning', message]),
    } },
    '@/api/svn': { svnUpdate: path => { calls.push(['update', path]); return command.promise } },
  }
  function load(path) {
    const context = { exports: {}, localStorage: { getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value) },
      require: name => { assert.ok(name in mocks, `unexpected dependency: ${name}`); return mocks[name] } }
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, context)
    return context.exports
  }
  const flow = load('src/stores/workflows.ts').useWorkflowStore()
  mocks['@/stores/workflows'] = { useWorkflowStore: () => flow }
  const createAction = load('src/composables/useSvnUpdate.ts').useSvnUpdate
  return { ...createAction(), createAction, workspace, flow, command, refresh, calls, messages }
}

test('in-place update completes without awaiting background verification and records output without navigation', async () => {
  const h = harness()
  const pending = h.updateWorkspace()
  assert.equal(h.updating.value, true)
  assert.equal(h.flow.busy, true)
  h.command.resolve({ output: 'Updated to revision 2.', conflicts: [] })
  await new Promise(resolve => setImmediate(resolve))
  await pending
  assert.equal(h.flow.phase, 'completed')
  assert.equal(h.flow.busy, false)
  assert.equal(h.workspace.statusIsStale, true)
  assert.equal(h.messages[0][0], 'success')
  h.refresh.resolve(true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.workspace.statusIsStale, false)
  assert.deepEqual(h.calls, [['update', '/synthetic/update'], ['refresh', '/synthetic/update']])
  assert.equal(h.flow.activities[0].output, 'Updated to revision 2.')
  assert.equal(h.flow.phase, 'completed')
  assert.equal(h.updating.value, false)
  assert.equal(h.flow.busy, false)
  assert.equal(h.messages[0][0], 'success')
})

test('toolbar and legacy page cannot start duplicate updates', async () => {
  const h = harness(), second = h.createAction()
  const pending = h.updateWorkspace()
  await h.updateWorkspace()
  await second.updateWorkspace()
  assert.equal(h.calls.length, 1)
  h.command.resolve({ conflicts: [] })
  h.refresh.resolve(true)
  await pending
})

test('update is disabled without a workspace or during a workspace refresh', async () => {
  const h = harness()
  h.workspace.currentPath = null
  await h.updateWorkspace()
  h.workspace.currentPath = '/synthetic/update'
  h.workspace.isLoading = true
  await h.updateWorkspace()
  assert.deepEqual(h.calls, [])
})

test('reported conflicts warn and remain in activity state without navigating', async () => {
  const h = harness(), pending = h.updateWorkspace()
  h.command.resolve({ output: 'C asset.uasset', conflicts: ['asset.uasset'] })
  h.refresh.resolve(true)
  const result = await pending
  assert.deepEqual(result.conflicts, ['asset.uasset'])
  assert.equal(h.flow.phase, 'conflicts')
  assert.equal(h.messages[0][0], 'warning')
  assert.equal(h.messages.length, 1)
})

test('partial update failure still refreshes and releases operation gates', async () => {
  const h = harness(), pending = h.updateWorkspace()
  h.command.reject(new Error('synthetic connection failure'))
  h.refresh.resolve(true)
  await pending
  assert.equal(h.calls.filter(call => call[0] === 'refresh').length, 1)
  assert.match(h.workspace.error, /synthetic connection failure/)
  assert.equal(h.flow.phase, 'failed')
  assert.equal(h.flow.busy, false)
  assert.equal(h.updating.value, false)
  assert.deepEqual(h.messages, [])
})

test('failed background verification cannot change a successful update into a command failure or a stuck gate', async () => {
  const h = harness(), pending = h.updateWorkspace()
  h.command.resolve({ conflicts: [] })
  h.refresh.resolve(false)
  await pending
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.flow.refreshWarning, false)
  assert.equal(h.workspace.statusIsStale, true)
  assert.match(h.workspace.error, /synthetic refresh failed/)
  assert.equal(h.flow.busy, false)
  assert.equal(h.updating.value, false)
  assert.equal(h.messages[0][0], 'success')
  assert.equal(h.flow.activities[0].failed, false)
})

test('late completion cannot refresh or notify a different repository', async () => {
  const h = harness(), pending = h.updateWorkspace()
  h.workspace.currentPath = '/synthetic/other'
  h.command.resolve({ conflicts: [] })
  await pending
  assert.deepEqual(h.calls, [['update', '/synthetic/update']])
  assert.deepEqual(h.messages, [])
  assert.equal(h.flow.busy, false)
})


test('late completion in a different branch cannot notify or verify that branch', async () => {
  const h = harness(), pending = h.updateWorkspace()
  h.workspace.svnInfo.url = 'file:///synthetic/publish'
  h.command.resolve({conflicts:[]})
  await pending
  assert.deepEqual(h.calls, [['update', '/synthetic/update']])
  assert.deepEqual(h.messages, [])
})


test('background failure does not wait or mask the native update error', async () => {
  const h = harness(), pending = h.updateWorkspace()
  h.command.reject(new Error('native update failed'))
  await pending
  assert.match(h.workspace.error, /native update failed/)
  assert.equal(h.flow.busy, false)
  assert.equal(h.updating.value, false)
  assert.deepEqual(h.messages, [])
  h.refresh.resolve(false)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.flow.phase, 'failed')
  assert.match(h.flow.activities[0].output, /native update failed/)
})

test('status API requests inventory for regular polls and bypasses it only when explicitly requested', async () => {
  const calls = []
  const context = { exports: {}, require: name => {
    assert.equal(name, '@tauri-apps/api/core')
    return { invoke: async (...args) => {calls.push(args); return []} }
  } }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/api/svn.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, context)
  await context.exports.svnStatus('/synthetic/update')
  await context.exports.svnStatus('/synthetic/update',true,false)
  assert.equal(calls[0][0], 'svn_status')
  assert.equal(calls[0][1].includeInventory,true)
  assert.equal(calls[1][1].includeInventory,false)
  assert.equal(calls[1][1].force,true)
})
