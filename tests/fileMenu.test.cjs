const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
function load(path) { const context = { exports: {} }; vm.runInNewContext(compile(fs.readFileSync(path, 'utf8')), context); return context.exports }
const tree = load('src/utils/changeTree.ts')
const stagingUtils = load('src/utils/staging.ts')
const changeSelection = load('src/utils/changeSelection.ts')
const { fitMenu } = load('src/utils/fileMenu.ts')
const entry = (path, status_code = 'modified') => ({ path, status_code, prop_status: 'none' })

function harness(options = {}) {
  const files = [entry('Content/A.txt'), entry('Content/B.txt'), entry('Source/Game.cpp')]
  const workspace = vue.reactive({ currentPath: '/wc', svnInfo: { url: 'file:///repo/dev' }, statusList: files, statusIsStale: false, setError() {} })
  const calls = [], messages = []
  const staging = vue.reactive({ key: vue.computed(() => stagingUtils.stagingKey(workspace.currentPath, workspace.svnInfo?.url)), paths: [], eligible: files, ready: vue.computed(() => !workspace.statusIsStale), stage: paths => calls.push(['stage', paths]), unstage: paths => calls.push(['unstage', paths]) })
  const details = { kind: 'file', exists: true, binary: false, historyUrl: 'file:///repo/dev/Content/A.txt' }
  const mocks = {
    '@/composables/useExternalTool': { useExternalTool: () => ({ open: async () => {} }) },
    '@tauri-apps/api/core': { invoke: async () => '' },
    '@/utils/repositoryUi': { repositoryUi: () => ({}) },
    vue: { ...vue, onMounted() {}, onDeactivated() {}, onBeforeUnmount() {} },
    'vue-router': { useRoute: () => ({ query: {} }), useRouter: () => ({ push: value => calls.push(['route', value]) }) },
    'vue-i18n': { useI18n: () => ({ t: key => key }) },
    '@/stores/workspace': { useWorkspaceStore: () => workspace }, '@/stores/staging': { useStagingStore: () => staging },
    '@/stores/commitDraft': { useCommitDraftStore: () => ({ key: 'draft', message: '' }) },
    '@/stores/workflows': { useWorkflowStore: () => options.flow || ({ busy: false, perform: async (_title, operation, mutation = true) => { const result = await operation(); if (mutation) calls.push(['refresh']); return result } }) },
    '@/api/svn': {
      workspaceItemDetails: options.details || (async () => details),
      openWorkspaceItem: async (...args) => calls.push(['open', ...args]),
      revealWorkspaceFile: async (...args) => calls.push(['reveal', ...args]),
      svnDiff: async () => ({ diff: '' }),
      previewWorkspaceDiscard: async (workspace, targets, branch, protectedFiles) => { calls.push(['preview-discard', workspace, targets, branch, protectedFiles]); return { id: 'discard-plan', nodes: targets.map(path => ({ path, remove: false })) } },
      executeWorkspaceDiscard: async id => { calls.push(['discard', id]); return { completedPaths: [], error: null } },
      cancelWorkspaceDiscard: async () => {},
      ignoreWorkspaceItem: async (...args) => calls.push(['ignore', ...args]),
      exportWorkspacePatch: async (...args) => calls.push(['patch', ...args]),
    },
    '@tauri-apps/plugin-dialog': { save: options.save || (async () => '/export/file.patch') },
    'element-plus/es/components/message/index': { ElMessage: { error: message => messages.push(message), success() {} } },
    'element-plus/es/components/message-box/index': { ElMessageBox: { confirm: async () => calls.push(['confirm']) } },
    '@/composables/useWorkspace': { useWorkspace: () => ({ refreshStatusAfterMutation: async () => calls.push(['refresh']), refreshStatusAfterDiscard: async () => calls.push(['refresh']) }) },
    '@/components/ConflictResolutionDialog.vue': {}, '@/components/PanelSplitter.vue': {}, '@/components/WorkspaceChangeTree.vue': {}, '@/components/FileContextMenu.vue': {}, '@/components/CommitMessageEditor.vue': {}, '@/components/DiffViewer.vue': {}, '@/components/GlassLoading.vue': {},
    '@/utils/changeSelection': changeSelection, '@/utils/changeTree': tree, '@/utils/statusSelection': { retainedSelection: (selected, paths) => paths.includes(selected) ? selected : null },
    '@/utils/clipboard': { writeClipboardText: async path => calls.push(['copy', path]) },
  }
  const source = fs.readFileSync('src/views/WorkspaceView.vue', 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const context = { exports: {}, require: name => { assert.ok(name in mocks, name); return mocks[name] } }
  const scope = vue.effectScope()
  scope.run(() => vm.runInNewContext(compile(source + '\nexports.state = { openFileContextMenu, runContextAction, fileContextMenu, contextItems, actionBlockReason, pendingFileAction, fileActionPhase, fileQuery, filteredFiles, handleChangeSelection, selectedFile, activePanel, conflictRequest };'), context))
  const folder = tree.buildChangeTree(files)[0].children.find(node => node.path === 'Content')
  return { ...context.exports.state, calls, messages, details, workspace, staging, folder, file: folder.children[0], stop: () => scope.stop() }
}
const pointer = { clientX: 100, clientY: 200 }

test('file and folder menus stage the selected targets and support folder copying/stashing', async () => {
  const h = harness()
  await h.openFileContextMenu(pointer, h.folder, false)
  await h.runContextAction('stage')
  assert.deepEqual(Array.from(h.calls[0][1]), ['Content/A.txt', 'Content/B.txt'])
  await h.openFileContextMenu(pointer, h.folder, false)
  await h.runContextAction('copy-relative')
  assert.deepEqual(h.calls.at(-1), ['copy', 'Content'])
  await h.openFileContextMenu(pointer, h.folder, false)
  await h.runContextAction('stash')
  assert.deepEqual(Array.from(h.calls.at(-1)[1].query.files), ['Content/A.txt', 'Content/B.txt'])
  h.stop()
})

test('Staged menu unstages and file history uses the clicked file URL', async () => {
  const h = harness()
  h.staging.paths = ['Content/A.txt']
  await h.openFileContextMenu(pointer, h.file, true)
  await h.runContextAction('stage')
  assert.equal(h.calls.at(-1)[0], 'unstage')
  await h.openFileContextMenu(pointer, h.file, false)
  await h.runContextAction('history')
  assert.equal(h.calls.at(-1)[1].query.target, h.details.historyUrl)
  assert.equal(h.calls.at(-1)[1].query.workspace, '/wc')
  h.stop()
})

test('binary files disable blame and text patches; tracked files cannot use Ignore', async () => {
  const h = harness()
  h.details.binary = true
  await h.openFileContextMenu(pointer, h.file, false)
  for (const id of ['blame', 'patch', 'ignore']) assert.equal(h.contextItems.value.find(item => item.id === id).disabled, true)
  await h.runContextAction('ignore-exact')
  await h.runContextAction('patch')
  assert.equal(h.calls.length, 0)
  h.staging.eligible = []
  assert.equal(h.contextItems.value.find(item => item.id === 'stage-all').disabled, true)
  h.stop()
})

test('unversioned files use SVN Ignore and pass the branch captured by the menu', async () => {
  const h = harness()
  h.file.entry.status_code = 'unversioned'
  await h.openFileContextMenu(pointer, h.file, false)
  await h.runContextAction('ignore-extension')
  assert.deepEqual(h.calls[0], ['ignore', '/wc', 'Content/A.txt', true, 'file:///repo/dev'])
  assert.equal(h.calls[1][0], 'refresh')
  h.stop()
})

test('stale menu actions and a workspace change during Save As cannot write', async () => {
  const h = harness({ save: async () => { h.workspace.currentPath = '/other'; return '/export/file.patch' } })
  await h.openFileContextMenu(pointer, h.file, false)
  await h.runContextAction('patch')
  assert.equal(h.calls.length, 0)
  h.workspace.currentPath = '/wc'
  await h.openFileContextMenu(pointer, h.file, false)
  h.workspace.statusIsStale = true
  await h.runContextAction('stage')
  assert.equal(h.calls.length, 0)
  h.stop()
})

test('late metadata cannot overwrite a newer context menu', async () => {
  let finish
  const h = harness({ details: (_workspace, path) => path.endsWith('A.txt') ? new Promise(resolve => { finish = resolve }) : Promise.resolve({ kind: 'file', exists: true, binary: true, historyUrl: null }) })
  const first = h.openFileContextMenu(pointer, h.file, false)
  await h.openFileContextMenu(pointer, h.folder.children[1], false)
  finish({ kind: 'dir', exists: true, binary: false, historyUrl: 'old' })
  await first
  assert.equal(h.fileContextMenu.path, 'Content/B.txt')
  assert.equal(h.fileContextMenu.details.binary, true)
  h.stop()
})

test('menu positioning stays inside the window near the bottom-right edge', () => {
  const fitted = fitMenu(1190, 790, 290, 430, 1200, 800)
  assert.equal(fitted.x, 902)
  assert.equal(fitted.y, 362)
})

test('folder discard previews and confirms exactly its current panel targets', async () => {
  const h = harness()
  h.staging.paths = ['Content/B.txt']
  const scopeFolder = tree.buildChangeTree([h.workspace.statusList[0]])[0].children.find(node => node.path === 'Content')
  await h.openFileContextMenu(pointer, scopeFolder, false)
  assert.equal(h.fileContextMenu.file, null)
  assert.equal(h.contextItems.value.find(item => item.id === 'discard').disabled, false)
  await h.runContextAction('discard')
  assert.equal(h.calls[0][0], 'preview-discard')
  assert.deepEqual(Array.from(h.calls[0][2]), ['Content/A.txt'])
  assert.equal(h.calls[0][3], 'file:///repo/dev')
  assert.deepEqual(Array.from(h.calls[0][4]), ['Content/B.txt', 'Source/Game.cpp'])
  assert.equal(h.calls.filter(call => call[0] === 'confirm').length, 1)
  assert.equal(h.calls.filter(call => call[0] === 'discard').length, 1)
  h.stop()
})

test('staged folder discard excludes unstaged and display-filtered paths', async () => {
  const h = harness()
  h.staging.paths = ['Content/A.txt']
  const folder = tree.buildChangeTree([h.workspace.statusList[0]])[0].children.find(node => node.path === 'Content')
  await h.openFileContextMenu(pointer, folder, true)
  await h.runContextAction('discard')
  assert.deepEqual(Array.from(h.calls[0][2]), ['Content/A.txt'])
  h.stop()
})

test('unverified status explains disabled mutations and provides an explicit refresh action', async () => {
  const h = harness()
  h.workspace.statusIsStale = true
  await h.openFileContextMenu(pointer, h.folder, false)
  for (const id of ['discard', 'stage', 'stage-all', 'stash', 'patch']) {
    const item = h.contextItems.value.find(item => item.id === id)
    assert.equal(item.disabled, true)
    assert.equal(item.title, 'fileMenu.verifyFirst')
  }
  assert.equal(h.contextItems.value.find(item => item.id === 'refresh-status').disabled, false)
  await h.runContextAction('discard')
  assert.equal(h.calls.length, 0)
  h.stop()
})

test('tree Delete dispatches directory targets and respects pending/disabled state', () => {
  const props = vue.reactive({ entries: [entry('Content/A.txt'), entry('Content/B.txt')], selectable: [], staged: false, workspaceKey: 'scope', disabled: false, actionPending: false })
  const calls = []
  const mocks = {
    vue, 'vue-i18n': { useI18n: () => ({ t: key => key }) },
    './VirtualViewport.vue': {}, '@/utils/changeSelection': changeSelection, '@/utils/changeTree': tree,
    '@/composables/useSvnStatus': {},
  }
  const source = fs.readFileSync('src/components/WorkspaceChangeTree.vue', 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const context = { exports: {}, defineExpose() {}, defineProps: () => props, defineEmits: () => (...args) => calls.push(args), localStorage: { getItem: () => null }, require: name => mocks[name] }
  const scope = vue.effectScope()
  scope.run(() => vm.runInNewContext(compile(source + '\nexports.actions = { navigate, rows };'), context))
  const { navigate, rows } = context.exports.actions
  const index = rows.value.findIndex(row => row.node.path === 'Content')
  const event = { key: 'Delete', preventDefault() {} }
  navigate(event, index)
  const discard = calls.filter(call => call[0] === 'discard-targets')
  assert.equal(discard.length, 1)
  assert.deepEqual(Array.from(discard[0][1]), ['Content/A.txt', 'Content/B.txt'])
  props.actionPending = true
  navigate(event, index)
  props.actionPending = false
  props.disabled = true
  navigate(event, index)
  assert.equal(calls.filter(call => call[0] === 'discard-targets').length, 1)
  scope.stop()
})


test('actual operation and discard phases explain disabled actions and release them when complete', async () => {
  const flow = vue.reactive({ busy: true, title: 'Synthetic action' })
  const h = harness({ flow })
  await h.openFileContextMenu(pointer, h.folder, false)
  assert.equal(h.actionBlockReason.value, 'fileMenu.operationBusy')
  assert.equal(h.contextItems.value.find(item => item.id === 'discard').disabled, true)
  flow.busy = false
  assert.equal(h.contextItems.value.find(item => item.id === 'discard').disabled, false)
  h.pendingFileAction.value = 'Content/A.txt'
  for (const phase of ['preview', 'confirm', 'execute', 'refresh']) {
    h.fileActionPhase.value = phase
    assert.equal(h.actionBlockReason.value, 'fileMenu.discardPhase_' + phase)
    assert.equal(h.contextItems.value.find(item => item.id === 'discard').disabled, true)
  }
  h.pendingFileAction.value = null
  assert.equal(h.actionBlockReason.value, '')
  assert.equal(h.contextItems.value.find(item => item.id === 'discard').disabled, false)
  h.stop()
})

test('compiled Vue menu renders the blocker visibly and leaves ready folder actions enabled', async () => {
  const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc')
  const { renderToString } = require('@vue/server-renderer')
  const filename = 'src/components/FileContextMenu.vue'
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'))
  const script = compileScript(descriptor, { id: 'file-menu-render-test' })
  const template = compileTemplate({ source: descriptor.template.content, filename, id: 'file-menu-render-test', ssr: true, ssrCssVars: [], compilerOptions: { bindingMetadata: script.bindings } })
  assert.equal(template.errors.length, 0)
  const mocks = { vue, 'vue/server-renderer': require('vue/server-renderer'), '@/utils/fileMenu': { fitMenu } }
  const scriptContext = { exports: {}, require: name => mocks[name] }
  vm.runInNewContext(compile(script.content), scriptContext)
  const renderContext = { exports: {}, require: name => mocks[name] }
  vm.runInNewContext(compile(template.code), renderContext)
  const component = { ...scriptContext.exports.default, ssrRender: renderContext.exports.ssrRender }
  const context = {}
  await renderToString(vue.createSSRApp(component, { x: 0, y: 0, notice: 'Inspecting selected changes', items: [{ id: 'discard', label: 'Discard folder', disabled: true }] }), context)
  assert.match(context.teleports.body, /role="status"[^>]*>Inspecting selected changes/)
  assert.match(context.teleports.body, /disabled/)
  const ready = {}
  await renderToString(vue.createSSRApp(component, { x: 0, y: 0, items: [{ id: 'discard', label: 'Discard folder', disabled: false }] }), ready)
  assert.match(ready.teleports.body, /Discard folder/)
  assert.doesNotMatch(ready.teleports.body, / disabled(?:[ =>])/)
})


test('multi-selection context stages and copies exactly the selected files', async () => {
  const h = harness()
  const selection = { targets: ['Content/A.txt', 'Source/Game.cpp'], count: 2 }
  await h.openFileContextMenu(pointer, h.file, false, selection)
  assert.equal(h.fileContextMenu.file, null)
  assert.equal(h.contextItems.value.find(item => item.id === 'open').disabled, true)
  assert.equal(h.contextItems.value.find(item => item.id === 'history').disabled, true)
  await h.runContextAction('copy-relative')
  assert.deepEqual(h.calls.at(-1), ['copy', 'Content/A.txt\nSource/Game.cpp'])
  await h.openFileContextMenu(pointer, h.file, false, selection)
  await h.runContextAction('stage')
  assert.deepEqual(Array.from(h.calls.at(-1)[1]), ['Content/A.txt', 'Source/Game.cpp'])
  h.stop()
})

test('path filtering preserves staged choices and folder selection clears stale file diff', async () => {
  const h = harness()
  h.staging.paths = ['Source/Game.cpp']
  h.fileQuery.value = 'content/'
  assert.deepEqual(Array.from(h.filteredFiles.value.map(file => file.path)), ['Content/A.txt', 'Content/B.txt'])
  assert.deepEqual(Array.from(h.staging.paths), ['Source/Game.cpp'])
  h.selectedFile.value = 'Content/A.txt'
  h.handleChangeSelection(['Content/A.txt', 'Content/B.txt'], false, false)
  assert.equal(h.selectedFile.value, null)
  assert.equal(h.activePanel.value, false)
  h.stop()
})


test('mixed folder discard opens choices only for conflicts and retains other changes', async () => {
  const h = harness()
  h.workspace.statusList[0].status_code = 'conflicted'
  await h.openFileContextMenu(pointer, h.folder, false)
  assert.ok(h.contextItems.value.find(item => item.id === 'resolve-conflicts'))
  await h.runContextAction('discard')
  assert.equal(h.calls.filter(call => ['preview-discard', 'discard'].includes(call[0])).length, 0)
  assert.deepEqual(Array.from(h.conflictRequest.value.files), ['Content/A.txt'])
  assert.equal(h.conflictRequest.value.otherCount, 1)
  h.stop()
})


test('context stash transfers exactly the selected paths and their workspace and branch', async () => {
  const h = harness()
  await h.openFileContextMenu(pointer, h.folder, false)
  const targets = Array.from(h.fileContextMenu.targets)
  const originWorkspace = h.fileContextMenu.workspace, originBranch = h.fileContextMenu.branch
  await h.runContextAction('stash')
  const route = h.calls.find(call => call[0] === 'route')[1]
  assert.equal(route.name, 'stash')
  assert.deepEqual(Array.from(route.query.files), targets)
  assert.equal(route.query.stashWorkspace, originWorkspace)
  assert.equal(route.query.stashBranch, originBranch)
  assert.equal(targets.includes('Source/Game.cpp'), false)
  h.stop()
})
