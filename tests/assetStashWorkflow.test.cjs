const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
const vue = require('vue')

function harness(inspect) {
  const workspace = vue.reactive({ currentPath: '/wc', statusList: [] })
  const flow = vue.reactive({ stashes: [], identity: { url: 'file:///repo/dev' } })
  const mocks = {
    '@/utils/changeTree': { buildChangeTree: () => [] },
    '@/utils/changeSelection': { readPanelSize: (_key,fallback) => fallback },
    '@/utils/diffPairs': {},
    vue,
    'vue-router': { useRoute: () => vue.reactive({ query: {} }) },
    'vue-i18n': { useI18n: () => ({ t: key => key, te: () => false }) },
    'element-plus': { ElMessage: { error: error => { throw new Error(error) } } },
    '@tauri-apps/plugin-dialog': {},
    '@/stores/workflows': { useWorkflowStore: () => flow },
    '@/stores/stash': { useStashStore: () => ({ entries: [] }) },
    '@/stores/workspace': { useWorkspaceStore: () => workspace },
    '@/api/workflows': { assetStashCandidates: inspect },
  }
  const script = fs.readFileSync('src/components/AssetStashPanel.vue', 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const context = { exports: {}, require: name => { assert.ok(name in mocks, name); return mocks[name] } }
  const code = ts.transpileModule(script + '\nexports.state = { selected, select, inspect, preview, inspecting, files };', { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const scope = vue.effectScope()
  scope.run(() => vm.runInNewContext(code, context))
  return { ...context.exports.state, workspace, flow, stop: () => scope.stop() }
}

test('stash panel initializes real Vue watchers and clears previews on record change', async () => {
  const h = harness(async () => [])
  assert.equal(h.selected.value, null)
  h.selected.value = { id: 'first' }
  await vue.nextTick()
  assert.equal(h.preview.value.length, 0)
  h.stop()
})

test('inspection of an earlier selection cannot authorize a new selection', async () => {
  let finish
  const h = harness(() => new Promise(resolve => { finish = resolve }))
  h.select([{ path: 'first.uasset' }])
  const old = h.inspect()
  h.select([{ path: 'second.uasset' }])
  finish([{ path: 'first.uasset', size: 10 }])
  await old
  assert.equal(h.preview.value.length, 0)
  assert.deepEqual(Array.from(h.files.value), ['second.uasset'])
  assert.equal(h.inspecting.value, false)
  h.stop()
})

test('inspection responses cannot leak into another working copy', async () => {
  let finish
  const h = harness(() => new Promise(resolve => { finish = resolve }))
  h.select([{ path: 'asset.uasset' }])
  const old = h.inspect()
  h.workspace.currentPath = '/other'
  await vue.nextTick()
  finish([{ path: 'asset.uasset', size: 10 }])
  await old
  assert.equal(h.preview.value.length, 0)
  assert.equal(h.files.value.length, 0)
  h.stop()
})
