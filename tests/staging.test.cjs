const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
const vue = require('vue')

const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
function load(file, globals = {}) { const context = { exports: {}, ...globals }; vm.runInNewContext(compile(fs.readFileSync(file, 'utf8')), context); return context.exports }
const utils = load('src/utils/staging.ts')
const messageUtils = load('src/utils/commitMessage.ts')
const treeUtils = load('src/utils/changeTree.ts')
const entry = (path, status_code = 'modified', prop_status = 'none') => ({ path, status_code, prop_status })
function harness(storage = new Map()) {
  const localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }
  const entries = [entry('Content/Map.umap'), entry('Content/Player.uasset'), entry('Source/Game.cpp')]
  const workspace = vue.reactive({ currentPath: '/wc', svnInfo: { url: 'file:///repo/dev' }, statusList: entries, rawStatusList: entries, statusIsStale: false })
  const settings = vue.reactive({ autoDeleteMissingOnCommit: false })
  const mocks = { vue, pinia: { defineStore: (_id, setup) => () => vue.reactive(setup()) }, './workspace': { useWorkspaceStore: () => workspace }, '@/composables/useSettings': { useSettings: () => ({ settings }) }, '@/utils/staging': utils, '@/utils/commitMessage': messageUtils }
  const scope = vue.effectScope()
  const exports = load('src/stores/staging.ts', { localStorage, require: name => { assert.ok(name in mocks, name); return mocks[name] } })
  const staging = scope.run(() => exports.useStagingStore())
  const draftExports = load('src/stores/commitDraft.ts', { localStorage, require: name => { assert.ok(name in mocks, name); return mocks[name] } })
  const draft = scope.run(() => draftExports.useCommitDraftStore())
  return { staging, draft, workspace, settings, storage, localStorage, scope, stop: () => scope.stop() }
}

test('a directory stages only its changed targets; unstage preserves other selected files', () => {
  const h = harness()
  const folder = treeUtils.buildChangeTree(h.workspace.statusList)[0].children.find(node => node.path === 'Content')
  h.staging.stage(folder.targets)
  assert.deepEqual(Array.from(h.staging.paths), ['Content/Map.umap', 'Content/Player.uasset'])
  h.staging.stage(['Source/Game.cpp', 'not-a-change'])
  h.staging.unstage(folder.targets)
  assert.deepEqual(Array.from(h.staging.paths), ['Source/Game.cpp'])
  assert.equal(h.workspace.statusList.length, 3)
  h.stop()
})

test('selection reloads from local storage without confusing Windows and case-sensitive paths', () => {
  const h = harness()
  h.staging.stage(['Content/Map.umap'])
  h.stop()
  const reopened = harness(h.storage)
  assert.deepEqual(Array.from(reopened.staging.paths), ['Content/Map.umap'])
  assert.equal(utils.stagingKey('F:\\Work\\Game\\', 'file:///repo/dev'), utils.stagingKey('f:/work/game', 'file:///repo/dev'))
  assert.notEqual(utils.stagingKey('/Work/Game', 'file:///repo/dev'), utils.stagingKey('/work/game', 'file:///repo/dev'))
  reopened.stop()
})

test('selection survives display filters and is isolated by branch and working-copy path', async () => {
  const h = harness()
  h.staging.stage(['Content/Map.umap'])
  h.workspace.statusList = []
  await vue.nextTick()
  assert.deepEqual(Array.from(h.staging.paths), ['Content/Map.umap'])
  h.workspace.svnInfo.url = 'file:///repo/publish'
  await vue.nextTick()
  assert.equal(h.staging.paths.length, 0)
  h.workspace.svnInfo.url = 'file:///repo/dev'
  await vue.nextTick()
  assert.deepEqual(Array.from(h.staging.paths), ['Content/Map.umap'])
  h.workspace.currentPath = '/other-wc'
  await vue.nextTick()
  assert.equal(h.staging.paths.length, 0)
  h.stop()
})

test('only fresh raw status prunes selections; conflicts and clean files leave Staged', async () => {
  const h = harness()
  h.staging.stage(['Content/Map.umap'])
  h.workspace.rawStatusList = null
  h.workspace.statusIsStale = true
  h.workspace.statusList = []
  await vue.nextTick()
  assert.equal(h.staging.paths.length, 1)
  h.staging.stage(['Source/Game.cpp'])
  assert.equal(h.staging.paths.length, 1)
  h.workspace.rawStatusList = [entry('Content/Map.umap', 'modified', 'conflicted')]
  h.workspace.statusIsStale = false
  await vue.nextTick()
  assert.equal(h.staging.paths.length, 0)
  h.stop()
})

test('partial commit scope preserves selections outside that directory and accepts property-only changes', () => {
  const h = harness()
  h.workspace.rawStatusList.push(entry('.', 'normal', 'modified'))
  h.staging.stage(['Source/Game.cpp', 'Content/Map.umap', '.'])
  h.staging.replaceInScope(['Content/Player.uasset'], ['Content/Map.umap', 'Content/Player.uasset'])
  assert.deepEqual(Array.from(h.staging.paths), ['Source/Game.cpp', '.', 'Content/Player.uasset'])
  assert.equal(utils.canSelectForCommit(entry('missing', 'missing')), false)
  assert.equal(utils.canSelectForCommit(entry('missing', 'missing'), true), true)
  h.stop()
})

test('a completed commit clears the original branch selection without altering a newly opened branch', () => {
  const h = harness()
  h.staging.stage(['Source/Game.cpp'])
  const original = h.staging.key
  h.workspace.svnInfo.url = 'file:///repo/publish'
  h.staging.stage(['Source/Game.cpp'])
  h.staging.unstage(['Source/Game.cpp'], original)
  assert.deepEqual(Array.from(h.staging.paths), ['Source/Game.cpp'])
  h.workspace.svnInfo.url = 'file:///repo/dev'
  assert.equal(h.staging.paths.length, 0)
  h.stop()
})

async function mountCommitView(h, options = {}) {
  const calls = [], addCalls = [], mounted = []
  const sessionStorage = { getItem: () => null, removeItem() {}, setItem() {} }
  const route = vue.reactive({ query: {} })
  const mocks = {
    vue: { ...vue, onMounted: fn => mounted.push(fn) },
    'vue-router': { useRoute: () => route, useRouter: () => ({ push() {}, replace() {} }), onBeforeRouteLeave() {} },
    'vue-i18n': { useI18n: () => ({ t: key => key }) },
    'element-plus/es/components/tree/index': {}, 'element-plus/es/components/checkbox/index': {},
    '@/stores/workspace': { useWorkspaceStore: () => h.workspace }, '@/stores/staging': { useStagingStore: () => h.staging },
    '@/stores/commitDraft': { useCommitDraftStore: () => h.draft }, '@/components/CommitMessageEditor.vue': {},
    '@/composables/useSettings': { useSettings: () => ({ settings: h.settings }) },
    '@/composables/useSvnStatus': {}, '@/utils/changeTree': treeUtils,
    '@/composables/useWorkspace': { useWorkspace: () => ({ refreshStatusAfterMutation: options.refresh || (async () => true), applyCommitResult: options.refresh || (async () => true) }) },
    '@/api/svn': {
      svnCommit: async (...args) => { calls.push(args); if (options.commitError) throw new Error('commit failed'); return options.result || { success: true, output: 'committed' } },
      svnAdd: async (...args) => { addCalls.push(args) },
    },
  }
  const script = fs.readFileSync('src/views/CommitView.vue', 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const context = { exports: {}, sessionStorage, localStorage: h.localStorage, setTimeout() {}, require: name => { assert.ok(name in mocks, name); return mocks[name] } }
  h.scope.run(() => vm.runInNewContext(compile(script + '\nexports.state = { selectedFiles, commitMessage, doCommit };'), context))
  for (const mount of mounted) await mount()
  const state = context.exports.state
  return { state, calls, addCalls }
}

test('commit view consumes the same Staged selection and commits only selected paths', async () => {
  const h = harness()
  h.staging.stage(['Content/Map.umap'])
  const { state, calls } = await mountCommitView(h)
  assert.deepEqual(Array.from(state.selectedFiles.value), ['Content/Map.umap'])
  h.draft.subject = 'Selected map only'
  h.draft.description = '保留地图设置\n验证角色出生点'
  await state.doCommit()
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1], 'Selected map only\n\n保留地图设置\n验证角色出生点')
  assert.deepEqual(Array.from(calls[0][2]), ['Content/Map.umap'])
  assert.equal(h.staging.paths.length, 0)
  assert.equal(h.draft.message, '')
  h.stop()
})

test('failed commits preserve both subject and description for retry', async () => {
  const h = harness()
  h.staging.stage(['Content/Map.umap'])
  h.draft.subject = '修复地图'
  h.draft.description = '失败后仍保留完整说明'
  const { state, calls } = await mountCommitView(h, { commitError: true })
  await state.doCommit()
  assert.equal(calls.length, 1)
  assert.equal(h.draft.message, '修复地图\n\n失败后仍保留完整说明')
  assert.equal(h.staging.paths.length, 1)
  h.stop()
})

test('the Add-and-review step does not consume the commit description or submit prematurely', async () => {
  const h = harness()
  const untracked = entry('Source/New.cpp', 'unversioned')
  h.workspace.statusList = [untracked]
  h.workspace.rawStatusList = [untracked]
  h.staging.stage([untracked.path])
  h.draft.subject = '新增源码'
  h.draft.description = 'Add 后先审阅，再确认提交'
  const { state, calls, addCalls } = await mountCommitView(h, { result: { success: true, added: true, addedPaths: [untracked.path] }, refresh: async () => {
    h.workspace.statusList = [entry(untracked.path, 'added')]
    h.workspace.rawStatusList = h.workspace.statusList
    return true
  } })
  await state.doCommit()
  assert.equal(addCalls.length, 0)
  assert.equal(calls.length, 1)
  assert.equal(h.draft.message, '新增源码\n\nAdd 后先审阅，再确认提交')
  assert.equal(h.staging.paths.length, 1)
  h.stop()
})


test('a returned command failure preserves the staged selection and full draft', async () => {
  const h = harness()
  h.staging.stage(['Content/Map.umap'])
  h.draft.subject = 'Retry me'
  h.draft.description = 'Keep details'
  const { state } = await mountCommitView(h, { result: { success: false, error: 'hook rejected', output: '' } })
  await state.doCommit()
  assert.equal(h.draft.message, 'Retry me\n\nKeep details')
  assert.equal(h.staging.paths.length, 1)
  h.stop()
})
