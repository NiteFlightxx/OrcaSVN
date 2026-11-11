const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
const vue = require('vue')

function harness(inspect, options = {}) {
  const calls = [], route = vue.reactive({ query: options.query || {} })
  const workspace = vue.reactive({ currentPath: '/wc', statusList: options.statusList || [] })
  const flow = vue.reactive({ stashes: [], busy: false, identity: { url: 'file:///repo/dev' }, perform: async (_name, operation) => operation() })
  const mocks = {
    '@/utils/changeTree': { buildChangeTree: () => [] },
    '@/utils/changeSelection': { readPanelSize: (_key,fallback) => fallback },
    '@/utils/diffPairs': {},
    vue,
    'vue-router': { useRoute: () => route, useRouter: () => ({ replace: async value => { calls.push(['route', value]); route.query = value.query } }) },
    'vue-i18n': { useI18n: () => ({ t: key => key, te: () => false }) },
    'element-plus': { ElMessage: { error: error => calls.push(['error',error]), warning: message => calls.push(['warning',message]) } },
    '@tauri-apps/plugin-dialog': {},
    '@/stores/workflows': { useWorkflowStore: () => flow },
    '@/stores/stash': { useStashStore: () => ({ entries: [] }) },
    '@/stores/workspace': { useWorkspaceStore: () => workspace },
    '@/api/workflows': { assetStashCandidates: async (...args) => { calls.push(['inspect', ...args]); return inspect(...args) }, assetStashCreate: async (...args) => { calls.push(['create', ...args]); return { id: 'synthetic-stash', warning: null } } },
  }
  const script = fs.readFileSync('src/components/AssetStashPanel.vue', 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const context = { exports: {}, require: name => { assert.ok(name in mocks, name); return mocks[name] } }
  const code = ts.transpileModule(script + '\nexports.state = { selected, select, inspect, preview, inspecting, files, openCreate, startCreate, creatingDialog, creationContext, canCreate, create, name, error };', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const scope = vue.effectScope()
  scope.run(() => vm.runInNewContext(code, context))
  if (!context.exports.state.creationContext.value) context.exports.state.creationContext.value = {path:'/wc',url:flow.identity.url}
  return { ...context.exports.state, workspace, flow, route, calls, stop: () => scope.stop() }
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


const settle = () => new Promise(resolve => setImmediate(resolve))
const change = (path, status_code = 'modified') => ({ path, status_code, prop_status: 'none' })

test('context stash automatically inspects and saves only the requested file, with no second selector', async () => {
  const h = harness(async (_path, files) => files.map(path => ({ path, status: 'modified', size: 10 })), {
    query: { files: ['Content/Selected.uasset'], stashWorkspace: '/wc', stashBranch: 'file:///repo/dev' },
    statusList: [change('Content/Selected.uasset'), change('Unrelated.txt')],
  })
  await settle()
  assert.equal(h.creatingDialog.value, true)
  assert.deepEqual(Array.from(h.files.value), ['Content/Selected.uasset'])
  assert.deepEqual(Array.from(h.preview.value.map(node => node.path)), ['Content/Selected.uasset'])
  assert.equal(h.canCreate.value, true)
  assert.equal(h.route.query.files, undefined)
  await h.create()
  assert.deepEqual(Array.from(h.calls.find(call => call[0] === 'create')[3]), ['Content/Selected.uasset'])
  assert.equal(h.creatingDialog.value, false)
  const template = fs.readFileSync('src/components/AssetStashPanel.vue', 'utf8').match(/^<template>([\s\S]*)<\/template>\s*<script/)[1]
  assert.doesNotMatch(template, /type="selection"|@selection-change/)
  h.stop()
})

test('selected folder expands its children for review while retaining exactly the original scope for saving', async () => {
  const h = harness(async (_path, files) => {
    assert.deepEqual(Array.from(files), ['Content/Selected'])
    return [{path:'Content/Selected/A.uasset',size:10},{path:'Content/Selected/Nested/B.uasset',size:20}]
  }, {query:{files:['Content/Selected']},statusList:[change('Content/Selected/A.uasset'),change('Other/B.uasset')]})
  await settle()
  assert.equal(h.preview.value.length, 2)
  await h.create()
  assert.deepEqual(Array.from(h.calls.find(call => call[0] === 'create')[3]), ['Content/Selected'])
  h.stop()
})

test('empty scoped requests never fall back to all workspace changes and cancelled requests can be repeated', async () => {
  const h = harness(async (_path, files) => files.map(path => ({path,size:1})), { query:{files:[]},statusList:[change('Unrelated.txt')] })
  await settle()
  assert.equal(h.files.value.length, 0)
  assert.equal(h.canCreate.value, false)
  assert.equal(h.calls.some(call => call[0] === 'inspect'), false)
  await h.create()
  assert.equal(h.calls.some(call => call[0] === 'create'), false)
  h.creatingDialog.value = false
  await vue.nextTick()
  h.route.query = {files:['Selected.txt']}
  await settle()
  assert.equal(h.creatingDialog.value, true)
  h.creatingDialog.value = false
  await vue.nextTick()
  h.route.query = {files:['Selected.txt']}
  await settle()
  assert.equal(h.creatingDialog.value, true)
  assert.deepEqual(Array.from(h.files.value), ['Selected.txt'])
  h.stop()
})

test('switching branches during inspection cannot authorize a stash in the new branch', async () => {
  let finish
  const h = harness(() => new Promise(resolve => { finish = resolve }))
  h.startCreate(['Selected.txt'])
  h.flow.identity = { url:'file:///repo/publish' }
  await vue.nextTick()
  finish([{path:'Selected.txt',size:1}])
  await settle()
  assert.equal(h.creatingDialog.value, false)
  assert.equal(h.preview.value.length, 0)
  assert.equal(h.canCreate.value, false)
  await h.create()
  assert.equal(h.calls.some(call => call[0] === 'create'), false)
  h.stop()
})

test('unchanged identity refresh keeps the scope and stale origin requests are rejected', async () => {
  const h = harness(async () => [{path:'Selected.txt',size:1}])
  h.startCreate(['Selected.txt'])
  await settle()
  h.flow.identity = {url:'file:///repo/dev'}
  await vue.nextTick()
  assert.equal(h.canCreate.value, true)
  h.stop()
  const stale = harness(async () => [], {query:{files:['Selected.txt'],stashWorkspace:'/other'}})
  assert.ok(stale.calls.some(call => call[0] === 'error' && call[1] === 'fileMenu.changed'))
  assert.equal(stale.creatingDialog.value,false)
  assert.equal(stale.calls.some(call => call[0] === 'inspect'),false)
  stale.stop()
})
