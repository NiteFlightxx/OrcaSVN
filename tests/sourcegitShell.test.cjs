const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
function load(path) { const context = { exports: {} }; vm.runInNewContext(compile(fs.readFileSync(path, 'utf8')), context); return context.exports }
function setup(path, names, mocks, extra = {}) {
  const source = fs.readFileSync(path, 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const scope = vue.effectScope(), context = { exports: {}, require: name => { assert.ok(name in mocks, name); return mocks[name] }, ...extra }
  scope.run(() => vm.runInNewContext(compile(source + '\nexports.actions = { ' + names + ' };'), context))
  return { ...context.exports.actions, stop: () => scope.stop() }
}
function shellHarness() {
  const workspace = vue.reactive({ currentPath: '/fixture/alpha', svnInfo: { url: 'file:///fixture/dev', revision: 1 }, isLoading: false, statusList: [], recentWorkspaces: [], clearWorkspace() { this.currentPath = null; this.svnInfo = null } })
  const storage = new Map(), calls = [], route = vue.reactive({ name: 'workspace', meta: {} })
  let fail = false
  const mocks = {
    '@/utils/repositoryUi': load('src/utils/repositoryUi.ts'),
    vue: { ...vue, onMounted() {}, onUnmounted() {} }, 'vue-router': { useRoute: () => route, useRouter: () => ({ push: async value => { calls.push(['route', value]); route.name = value.name } }) }, 'vue-i18n': { useI18n: () => ({ t: key => key }) },
    'element-plus/es/components/message/index': { ElMessage: {} }, '@/api/svn': {}, '@/stores/workspace': { useWorkspaceStore: () => workspace }, '@/stores/stash': { useStashStore: () => ({ currentEntries: () => [] }) }, '@/stores/workflows': { useWorkflowStore: () => ({ stashes: [] }) },
    '@/composables/useWorkspace': { useWorkspace: () => ({ loadWorkspace: async path => { calls.push(['load', path]); if (fail) return false; workspace.currentPath = path; workspace.svnInfo = { url: 'file:///fixture/dev', revision: 1 }; return true } }) }, '@/composables/useWorkspaceErrorToast': { useWorkspaceErrorToast() {} }, '@/composables/useUpdateCheck': { useUpdateCheck: () => ({}) },
    '@/composables/useSvnUpdate': { useSvnUpdate: () => ({ updateWorkspace: async () => calls.push(['update']), updating: vue.ref(false) }) },
    '@/components/BranchSidebar.vue': {}, '@/components/OperationDialog.vue': {}, '@/components/ActivityPanel.vue': {}, '@/components/LanguageSwitcher.vue': {}, '@/components/icons/materialIcons': {},
  }
  const h = setup('src/layouts/MainLayout.vue', 'openTabs, selectRepositoryTab, closeRepositoryTab, handleShellKeydown, showSidebar, toggleSidebar, updateWorkspace, openStash, handleShellCommand', mocks, { document: { dispatchEvent() {} }, Event: class Event {}, localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) } })
  return { ...h, workspace, storage, calls, route, fail: value => { fail = value } }
}
test('repository tabs switch and close adjacent tabs without removing recent repositories', async () => {
  const h = shellHarness()
  h.openTabs.value = ['/fixture/alpha', '/fixture/beta']
  await h.selectRepositoryTab('/fixture/beta')
  assert.equal(h.workspace.currentPath, '/fixture/beta')
  await h.closeRepositoryTab('/fixture/beta')
  assert.equal(h.workspace.currentPath, '/fixture/alpha')
  assert.deepEqual(Array.from(h.openTabs.value), ['/fixture/alpha'])
  await h.closeRepositoryTab('/fixture/alpha')
  assert.equal(h.workspace.currentPath, null)
  assert.equal(h.openTabs.value.length, 0)
  h.stop()
})
test('failed repository loading keeps the current tab and does not forget its workspace', async () => {
  const h = shellHarness()
  h.openTabs.value = ['/fixture/alpha', '/fixture/beta']
  h.fail(true)
  await h.closeRepositoryTab('/fixture/alpha')
  assert.equal(h.workspace.currentPath, '/fixture/alpha')
  assert.deepEqual(Array.from(h.openTabs.value), ['/fixture/alpha', '/fixture/beta'])
  await h.selectRepositoryTab('/fixture/missing')
  assert.equal(h.workspace.currentPath, '/fixture/alpha')
  assert.equal(h.openTabs.value.includes('/fixture/missing'), false)
  h.stop()
})
test('SourceGit navigation keys select history and cycle only opened repository tabs', async () => {
  const h = shellHarness()
  h.openTabs.value = ['/fixture/alpha', '/fixture/beta']
  h.handleShellKeydown({ ctrlKey: true, key: '1', preventDefault() {} })
  assert.equal(h.calls.at(-1)[1].name, 'log')
  h.handleShellKeydown({ ctrlKey: true, key: 'Tab', preventDefault() {} })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.workspace.currentPath, '/fixture/beta')
  h.stop()
})
test('splitter drag, keyboard limits and reverse percentage use the actual panel dimensions', () => {
  const props = vue.reactive({ axis: 'x', value: 340, min: 240, max: 700, reverse: false, percent: false })
  const values = []
  const h = setup('src/components/PanelSplitter.vue', 'start, move, finish, keyboard', {}, { defineProps: () => props, defineEmits: () => (_event, value) => { values.push(value); props.value = value } })
  const element = { parentElement: { getBoundingClientRect: () => ({ width: 1000, height: 200 }) }, setPointerCapture() {} }
  h.start({ button: 0, currentTarget: element, clientX: 200, clientY: 0, pointerId: 1, preventDefault() {} })
  h.move({ clientX: 400 })
  assert.equal(props.value, 540)
  h.move({ clientX: 2000 })
  assert.equal(props.value, 700)
  h.finish()
  h.move({ clientX: 0 })
  assert.equal(props.value, 700)
  Object.assign(props, { axis: 'y', value: 50, min: 20, max: 80, reverse: true, percent: true })
  h.start({ button: 0, currentTarget: element, clientX: 0, clientY: 10, pointerId: 1, preventDefault() {} })
  h.move({ clientY: 60 })
  assert.equal(props.value, 25)
  h.keyboard({ key: 'End', preventDefault() {} })
  assert.equal(props.value, 80)
  h.keyboard({ key: 'Home', preventDefault() {} })
  assert.equal(props.value, 20)
  h.stop()
})
test('branch right-click opens choices and only an explicit switch action prepares a switch', async () => {
  const workspace = vue.reactive({ currentPath: '/fixture/wc' }), calls = []
  const flow = vue.reactive({ identity: { url: 'file:///fixture/dev', uuid: 'fixture' }, knownBranches: [], branches: [], busy: false, perform: async (_name, operation) => operation() })
  const mocks = { vue: { ...vue, onMounted() {}, onBeforeUnmount() {} }, 'vue-router': { useRouter: () => ({ push: value => calls.push(['route', value]) }) }, 'vue-i18n': { useI18n: () => ({ t: key => key }) }, 'element-plus': { ElMessage: { error: error => calls.push(['error', error]) }, ElMessageBox: {} }, './FileContextMenu.vue': {}, './BranchManagerDialog.vue': {}, '@/utils/clipboard': {}, '@/utils/branches': load('src/utils/branches.ts'), '@/stores/workflows': { useWorkflowStore: () => flow }, '@/stores/workspace': { useWorkspaceStore: () => workspace }, '@/api/workflows': { repositoryPreview: async (...args) => { calls.push(['preview', ...args]); return { id: 'fixture-plan' } } } }
  const h = setup('src/components/BranchSidebar.vue', 'openBranchMenu, runBranchAction, branchMenu', mocks, { defineExpose() {}, localStorage: { getItem: () => null, setItem() {} } })
  h.openBranchMenu({ clientX: 1, clientY: 1 }, 'file:///fixture/publish')
  assert.equal(h.branchMenu.visible, true)
  assert.equal(calls.length, 0)
  await h.runBranchAction('branch-switch')
  assert.equal(calls.length, 0)
  assert.equal(flow.switchRequest.source, 'file:///fixture/publish')
  const request = flow.switchRequest
  h.openBranchMenu({ clientX: 1, clientY: 1 }, 'file:///fixture/publish')
  workspace.currentPath = '/fixture/other'
  await h.runBranchAction('branch-switch')
  assert.equal(flow.switchRequest, request)
  h.stop()
})

test('Fork navigation stays visible across pages and only an explicit toggle collapses it', async () => {
  const h=shellHarness()
  assert.equal(h.showSidebar.value,true)
  for (const name of ['log', 'workspace', 'stash', 'settings']) {
    h.route.name = name
    await vue.nextTick()
    assert.equal(h.showSidebar.value,true)
  }
  h.toggleSidebar()
  assert.equal(h.showSidebar.value,false)
  h.route.name = 'log'
  await vue.nextTick()
  assert.equal(h.showSidebar.value,false)
  h.toggleSidebar()
  assert.equal(h.showSidebar.value,true)
  h.stop()
})

test('toolbar update executes in place instead of navigating to the legacy update page', async () => {
  const source = fs.readFileSync('src/layouts/MainLayout.vue', 'utf8')
  const button = source.match(/<button\s[^>]*:aria-label="\$t\('menu.update'\)"[^>]*>/)[0]
  assert.match(button, /@click="updateWorkspace"/)
  assert.match(button, /:disabled="[^"]*workflow.busy/)
  const h = shellHarness()
  await h.updateWorkspace()
  assert.deepEqual(h.calls, [['update']])
  assert.equal(h.showSidebar.value, true)
  h.stop()
})

test('repository menu update stays in place and sidebar stashes select the requested entry', async () => {
  const h = shellHarness()
  await h.handleShellCommand('update')
  assert.deepEqual(h.calls, [['update']])
  h.openStash('synthetic-stash')
  assert.equal(h.calls.at(-1)[1].name, 'stash')
  assert.equal(h.calls.at(-1)[1].query.id, 'synthetic-stash')
  assert.equal(h.showSidebar.value, true)
  h.stop()
})
