const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
const vue = require('vue')

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function harness(status = 'modified', path = 'file.ts') {
  const confirmation = deferred(), dialogs = [], operations = [], messages = [], discardRefreshes = []
  const file = { path, status_code: status, prop_status: 'none' }
  const store = vue.reactive({ currentPath: '/wc', statusList: [file], svnInfo: { url: 'file:///repo/dev' }, error: null, setError(error) { this.error = error } })
  let refreshes = 0, operation = async () => {}, unmount
  const staging = vue.reactive({ paths: [], eligible: [], key: 'scope', ready: true })
  const mocks = {
    '@/composables/useExternalTool': { useExternalTool: () => ({ open: async () => {} }) },
    '@tauri-apps/api/core': { invoke: async () => '' },
    '@/utils/repositoryUi': { repositoryUi: () => ({}) },
    vue: { ...vue, onMounted() {}, onDeactivated() {}, onBeforeUnmount(fn) { unmount = fn } },
    'vue-router': { useRoute: () => ({ query: {} }), useRouter: () => ({}) },
    'vue-i18n': { useI18n: () => ({ t: key => key }) },
    '@/stores/workspace': { useWorkspaceStore: () => store },
    '@/stores/staging': { useStagingStore: () => staging },
    '@/stores/commitDraft': { useCommitDraftStore: () => ({ key: '', message: '' }) },
    '@/stores/workflows': { useWorkflowStore: () => ({ busy: false, perform: async (_title,operation) => operation() }) },
    '@/api/svn': {
      previewWorkspaceDiscard: async (_wc, paths) => ({ id: 'plan', nodes: paths.map(path => ({ path, remove: status === 'unversioned' || status === 'added' })) }),
      executeWorkspaceDiscard: async (...args) => { operations.push({ type: 'discard', args }); const result = await operation(); return result || { completedPaths: [path], error: null } },
      cancelWorkspaceDiscard: async () => {},
    },
    'element-plus/es/components/message/index': { ElMessage: { success: message => messages.push(message) } },
    'element-plus/es/components/message-box/index': { ElMessageBox: { confirm: (...args) => { dialogs.push(args); return confirmation.promise } } },
    '@/composables/useSvnStatus': {},
    '@/composables/useWorkspace': { useWorkspace: () => ({ refreshStatusAfterMutation: async () => { refreshes++; return true }, refreshStatusAfterDiscard: async patch => { refreshes++; discardRefreshes.push(patch); if (!patch) store.setError(null); return true } }) },
    '@/components/VirtualViewport.vue': {},
    '@/components/ConflictResolutionDialog.vue': {}, '@/components/PanelSplitter.vue': {}, '@/components/WorkspaceChangeTree.vue': {},
    '@/components/FileContextMenu.vue': {},
    '@/components/CommitMessageEditor.vue': {},
    '@/components/DiffViewer.vue': {},
    '@/components/GlassLoading.vue': {},
    '@/utils/clipboard': {},
    '@/utils/changeSelection': { readPanelSize: (_key, fallback) => fallback },
    '@/utils/changeTree': { normalizePath: path => path.replace(/\\/g, '/') },
    '@tauri-apps/plugin-dialog': {},
    '@/utils/statusSelection': { retainedSelection: (selected, paths) => selected && paths.includes(selected) ? selected : null },
  }
  const script = fs.readFileSync('src/views/WorkspaceView.vue', 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const code = ts.transpileModule(script + '\nexports.actions = { handleFileAction: file => discardTargets([file.path]), discardTargets, pendingFileAction, conflictRequest };', { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const context = { exports: {}, document: { removeEventListener() {} }, require: name => { assert.ok(name in mocks, name); return mocks[name] } }
  vm.runInNewContext(code, context)
  return { ...context.exports.actions, file, store, staging, confirmation, dialogs, operations, messages, discardRefreshes,
    refreshes: () => refreshes, setOperation: fn => { operation = fn }, unmount: () => unmount() }
}

test('revert waits for explicit confirmation and displays the target as escaped text', async () => {
  const h = harness('modified', '<img src=x onerror=alert(1)>.ts')
  const pending = h.handleFileAction(h.file)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.operations.length, 0)
  assert.equal(h.dialogs.length, 1)
  const [message, title, options] = h.dialogs[0]
  assert.equal(title, 'fileMenu.discard')
  assert.equal(message.children[0].children, 'fileMenu.discardConfirm')
  assert.equal(message.children[1].children[0].children[1].children, '<img src=x onerror=alert(1)>.ts')
  assert.equal(message.children[1].children[0].children[1].props.innerHTML, undefined)
  assert.equal(options.closeOnClickModal, false)
  assert.equal(options.autofocus, false)
  assert.equal(message.children.length, 2)
  assert.equal(h.messages.length, 0)
  h.confirmation.resolve('confirm')
  await pending
  assert.equal(h.operations[0].type, 'discard')
  assert.equal(h.operations[0].args[0], 'plan')
  assert.equal(h.refreshes(), 1)
  assert.equal(h.pendingFileAction.value, null)
  assert.deepEqual(h.messages, ['fileMenu.discardCompleted'])
})

test('unversioned targets show deletion in the same reviewed discard flow', async () => {
  const h = harness('unversioned', 'new-directory')
  const pending = h.handleFileAction(h.file)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.dialogs[0][1], 'fileMenu.discard')
  assert.equal(h.dialogs[0][0].children[1].children[0].children[0].children, 'common.delete: ')
  assert.equal(h.dialogs[0][2].confirmButtonText, 'fileMenu.discard')
  h.confirmation.resolve('confirm')
  await pending
  assert.equal(h.operations[0].type, 'discard')
})

test('cancel and close leave files and error state unchanged', async () => {
  for (const action of ['cancel', 'close']) {
    const h = harness()
    const pending = h.handleFileAction(h.file)
  await new Promise(resolve => setImmediate(resolve))
    h.confirmation.reject(action)
    await pending
    assert.equal(h.operations.length, 0)
    assert.equal(h.refreshes(), 0)
    assert.equal(h.store.error, null)
    assert.equal(h.pendingFileAction.value, null)
  }
})

test('a workspace switch, even away and back, invalidates the confirmation', async () => {
  const h = harness()
  const pending = h.handleFileAction(h.file)
  await new Promise(resolve => setImmediate(resolve))
  h.store.currentPath = '/another'
  h.store.currentPath = '/wc'
  h.confirmation.resolve('confirm')
  await pending
  assert.equal(h.operations.length, 0)
})

test('removed or changed SVN status requires a new confirmation', async () => {
  for (const change of [h => { h.store.statusList = [] }, h => { h.store.statusList[0].status_code = 'added' }]) {
    const h = harness('unversioned')
    const pending = h.handleFileAction(h.file)
  await new Promise(resolve => setImmediate(resolve))
    change(h)
    h.confirmation.resolve('confirm')
    await pending
    assert.equal(h.operations.length, 0)
  }
})

test('duplicate clicks cannot open multiple dialogs or execute the operation twice', async () => {
  const h = harness(), execution = deferred()
  h.setOperation(() => execution.promise)
  const first = h.handleFileAction(h.file)
  await h.handleFileAction(h.file)
  assert.equal(h.dialogs.length, 1)
  h.confirmation.resolve('confirm')
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve))
  await h.handleFileAction(h.file)
  assert.equal(h.operations.length, 1)
  execution.resolve()
  await first
  assert.equal(h.pendingFileAction.value, null)
})

test('operation failures retain their error and unlock file actions', async () => {
  const h = harness()
  h.setOperation(async () => { throw new Error('SVN failed') })
  const pending = h.handleFileAction(h.file)
  await new Promise(resolve => setImmediate(resolve))
  h.confirmation.resolve('confirm')
  await pending
  assert.equal(h.store.error, 'Error: SVN failed')
  assert.equal(h.refreshes(), 1)
  assert.equal(h.pendingFileAction.value, null)
})

test('unmounting the view invalidates a pending confirmation', async () => {
  const h = harness()
  const pending = h.handleFileAction(h.file)
  await new Promise(resolve => setImmediate(resolve))
  h.unmount()
  h.confirmation.resolve('confirm')
  await pending
  assert.equal(h.operations.length, 0)
})


test('unverified cached status cannot start or confirm a destructive file action', async () => {
  const h = harness()
  h.store.statusIsStale = true
  await h.handleFileAction(h.file)
  assert.equal(h.dialogs.length, 0)
  h.store.statusIsStale = false
  const pending = h.handleFileAction(h.file)
  await new Promise(resolve => setImmediate(resolve))
  h.store.statusIsStale = true
  h.confirmation.resolve('confirm')
  await pending
  assert.equal(h.operations.length, 0)
})

test('branch changes, including away and back at the same path, invalidate confirmation', async () => {
  const h = harness()
  const pending = h.handleFileAction(h.file)
  await new Promise(resolve => setImmediate(resolve))
  h.store.svnInfo.url = 'file:///repo/publish'
  h.store.svnInfo.url = 'file:///repo/dev'
  h.confirmation.resolve('confirm')
  await pending
  assert.equal(h.operations.length, 0)
})

test('bulk discard displays every target and cancellation does not execute', async () => {
  const h = harness()
  h.store.statusList.push({ path: 'folder/second.uasset', status_code: 'modified', prop_status: 'none' })
  const pending = h.discardTargets([h.file.path, 'folder/second.uasset'])
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.dialogs[0][0].children[1].children.length, 2)
  h.confirmation.reject('cancel')
  await pending
  assert.equal(h.operations.length, 0)
})

test('large discard previews retain every full path without executing on open or cancel', async () => {
  const h = harness('unversioned')
  h.store.statusList = Array.from({ length: 2000 }, (_, index) => ({
    path: `Tools/test-environment/packages/wrappers/${index}/<long-file-name>.py`,
    status_code: 'unversioned', prop_status: 'none',
  }))
  const pending = h.discardTargets(h.store.statusList.map(file => file.path))
  await new Promise(resolve => setImmediate(resolve))
  const [message] = h.dialogs[0]
  const list = message.children[1]
  assert.equal(list.children.length, 2000)
  assert.equal(list.props.tabindex, 0)
  assert.equal(list.props.role, 'region')
  for (let index = 0; index < list.children.length; index++) {
    const path = list.children[index].children[1]
    assert.equal(path.children, h.store.statusList[index].path)
    assert.equal(path.props.title, h.store.statusList[index].path)
    assert.equal(path.props.innerHTML, undefined)
  }
  assert.equal(h.operations.length, 0)
  h.confirmation.reject('cancel')
  await pending
  assert.equal(h.operations.length, 0)
})

test('changing the staged selection during confirmation cancels the old operation', async () => {
  const h = harness()
  const pending = h.handleFileAction(h.file)
  await new Promise(resolve => setImmediate(resolve))
  h.staging.paths = [h.file.path]
  h.confirmation.resolve('confirm')
  await pending
  assert.equal(h.operations.length, 0)
})

test('partial discard reports the original error and refreshes the actual remaining changes', async () => {
  const h = harness()
  h.setOperation(async () => ({ completedPaths: [], error: 'File retained: locked.uasset' }))
  const pending = h.handleFileAction(h.file)
  await new Promise(resolve => setImmediate(resolve))
  h.confirmation.resolve('confirm')
  await pending
  assert.match(h.store.error, /File retained: locked.uasset/)
  assert.equal(h.store.error, 'File retained: locked.uasset')
  assert.equal(h.messages.length, 0)
  assert.equal(h.refreshes(), 1)
  assert.equal(h.pendingFileAction.value, null)
})

test('discard passes scoped status to the refresh instead of requesting a workspace scan', async () => {
  const h = harness()
  const status = { workspace: '/wc', expectedUrl: 'file:///repo/dev', paths: ['file.ts'], subtrees: [], entries: [] }
  h.setOperation(async () => ({ completedPaths: ['file.ts'], error: null, status }))
  const pending = h.handleFileAction(h.file)
  await new Promise(resolve => setImmediate(resolve))
  h.confirmation.resolve('confirm')
  await pending
  assert.equal(h.discardRefreshes.length, 1)
  assert.equal(h.discardRefreshes[0], status)
  assert.equal(h.pendingFileAction.value, null)
})

test('a newer workspace mutation invalidates the scoped discard result', async () => {
  const h = harness()
  const status = { workspace: '/wc', expectedUrl: 'file:///repo/dev', paths: ['file.ts'], subtrees: [], entries: [] }
  h.store.epoch = 0
  h.setOperation(async () => { h.store.epoch++; return { completedPaths: ['file.ts'], error: null, status } })
  const pending = h.handleFileAction(h.file)
  await new Promise(resolve => setImmediate(resolve))
  h.confirmation.resolve('confirm')
  await pending
  assert.equal(h.discardRefreshes[0], null)
})


test('discarding a conflicted file opens the resolution chooser without reverting it', async () => {
  const h = harness('conflicted', 'LuaUbtPlugin.dll')
  await h.handleFileAction(h.file)
  assert.equal(h.operations.length, 0)
  assert.equal(h.dialogs.length, 0)
  assert.deepEqual(Array.from(h.conflictRequest.value.files), ['LuaUbtPlugin.dll'])
  assert.equal(h.conflictRequest.value.branch, 'file:///repo/dev')
  assert.equal(h.pendingFileAction.value, null)
})
