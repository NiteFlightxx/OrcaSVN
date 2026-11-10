const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
const vue = require('vue')

function harness(fetch) {
  const calls = []
  const flow = vue.reactive({ browsingUrl: '', identity: null })
  const store = vue.reactive({ currentPath: '/wc', epoch: 0, setError(error) { this.error = error } })
  const route = vue.reactive({ query: {} })
  const mocks = {
    vue: { ...vue, watch() {}, onActivated() {}, onUnmounted() {} },
    '@/stores/workflows': { useWorkflowStore: () => flow },
    '@/api/workflows': {},
    '@/components/DiffViewer.vue': {},
    '@/utils/clipboard': {},
    'element-plus': {},
    '@/stores/workspace': { useWorkspaceStore: () => store },
    '@/api/svn': { svnLog: async (...args) => { calls.push(args); return fetch(...args) } },
    'vue-i18n': { useI18n: () => ({ t: key => key, locale: vue.ref('en-US') }) },
    '@/composables/useWorkspace': { useWorkspace: () => ({}) },
    'vue-router': { useRouter: () => ({}), useRoute: () => route },
  }
  const script = fs.readFileSync('src/views/LogView.vue', 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const context = { exports: {}, require: name => { assert.ok(name in mocks, name); return mocks[name] } }
  const code = ts.transpileModule(script + '\nexports.state = { reloadLogs, fetchLogPage, logs, pageIndex, pageCursors, hasMore, loading, filters };', { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(code, context)
  return { ...context.exports.state, calls, store, flow, route }
}
const entries = Array.from({ length: 50 }, (_, index) => ({
  revision: 300 - index * 2, author: index % 2 ? 'alice' : 'bob', message: 'change', date: '', changed_paths: [],
}))
const query = (_path, limit, cursor, _end, _keyword, author) => entries
  .filter(entry => (cursor === undefined || entry.revision <= cursor) && (!author || entry.author === author)).slice(0, limit)

test('explicit pages replace rows, use revision cursors without gaps, and restore previous pages from cache', async () => {
  const h = harness(query)
  await h.reloadLogs()
  assert.equal(h.logs.value.length, 20)
  assert.equal(h.hasMore.value, true)
  assert.equal(h.calls[0][1], 21)
  const first = Array.from(h.logs.value, entry => entry.revision)
  await h.fetchLogPage(1)
  const second = Array.from(h.logs.value, entry => entry.revision)
  assert.equal(h.calls[1][2], first.at(-1) - 1)
  assert.equal(new Set([...first, ...second]).size, 40)
  await h.fetchLogPage(2)
  assert.equal(h.logs.value.length, 10)
  assert.equal(h.hasMore.value, false)
  await h.fetchLogPage(0)
  assert.deepEqual(Array.from(h.logs.value, entry => entry.revision), first)
  assert.equal(h.calls.length, 3)
})

test('filtered results remain bounded and a filter reload resets the page cursor', async () => {
  const h = harness(query)
  await h.reloadLogs()
  await h.fetchLogPage(1)
  h.filters.author = 'alice'
  await h.reloadLogs(true, true)
  assert.equal(h.pageIndex.value, 0)
  assert.equal(h.logs.value.length, 20)
  assert.ok(h.logs.value.every(entry => entry.author === 'alice'))
  assert.equal(h.calls.at(-1)[1], 21)
  assert.equal(h.calls.at(-1)[2], undefined)
  await h.fetchLogPage(1)
  assert.equal(h.logs.value.length, 5)
  assert.equal(h.hasMore.value, false)
})

test('empty and exact-size pages do not offer another page', async () => {
  for (const count of [0, 20]) {
    const h = harness(() => entries.slice(0, count))
    await h.reloadLogs()
    assert.equal(h.logs.value.length, count)
    assert.equal(h.hasMore.value, false)
  }
})

test('late response from a superseded query cannot replace the new page', async () => {
  let finish
  const h = harness((_path, _limit, _cursor, _end, keyword) => keyword === 'new'
    ? [entries[1]] : new Promise(resolve => { finish = resolve }))
  const old = h.reloadLogs()
  h.filters.keyword = 'new'
  await h.reloadLogs(true, true)
  finish([entries[0]])
  await old
  assert.equal(h.logs.value[0].revision, entries[1].revision)
  assert.equal(h.loading.value, false)
})

test('branch browsing in the same working copy rejects late replies from the old source', async () => {
  let finish
  const h = harness((path) => path.endsWith('/dev') ? new Promise(resolve => { finish = resolve }) : [entries[1]])
  h.flow.browsingUrl = 'file:///repo/dev'
  const old = h.reloadLogs()
  h.flow.browsingUrl = 'file:///repo/publish'
  await h.reloadLogs(true, true)
  finish([entries[0]])
  await old
  assert.equal(h.logs.value[0].revision, entries[1].revision)
  assert.equal(h.calls[0][0], 'file:///repo/dev')
  assert.equal(h.store.currentPath, '/wc')
})

test('file history reads its selected URL and drops the scope after a branch or workspace change', async () => {
  const h = harness(() => [entries[0]])
  h.store.svnInfo = { url: 'file:///repo/dev' }
  h.flow.browsingUrl = 'file:///repo/other'
  h.route.query = { target: 'file:///repo/dev/Content/Map.umap', workspace: '/wc', branch: 'file:///repo/dev' }
  await h.reloadLogs(true, true)
  assert.equal(h.calls.at(-1)[0], 'file:///repo/dev/Content/Map.umap')
  h.store.svnInfo = { url: 'file:///repo/publish' }
  await h.reloadLogs(true, true)
  assert.equal(h.calls.at(-1)[0], 'file:///repo/other')
})
