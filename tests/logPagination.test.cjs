const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
const vue = require('vue')

function harness(fetch, diff = async () => ({ diff: '' })) {
  const calls = [], uiState = {}
  const flow = vue.reactive({ browsingUrl: '', identity: null })
  const store = vue.reactive({ currentPath: '/wc', epoch: 0, setError(error) { this.error = error } })
  const route = vue.reactive({ query: {} })
  const mocks = {
    '@/utils/changeSelection': { readPanelSize: (_key,fallback) => fallback },
    '@/utils/repositoryUi': { repositoryUi: () => uiState },
    vue: { ...vue, watch() {}, onMounted() {}, onActivated() {}, onDeactivated() {}, onUnmounted() {} },
    '@/stores/workflows': { useWorkflowStore: () => flow },
    '@/api/workflows': {},
    '@/components/DiffViewer.vue': {},
    '@/utils/clipboard': {},
    'element-plus': {},
    '@/stores/workspace': { useWorkspaceStore: () => store },
    '@/api/svn': { svnLog: async (...args) => { calls.push(args); return fetch(...args) }, svnDiff: diff },
    'vue-i18n': { useI18n: () => ({ t: key => key, locale: vue.ref('en-US') }) },
    '@/composables/useWorkspace': { useWorkspace: () => ({}) },
    'vue-router': { useRouter: () => ({}), useRoute: () => route },
  }
  const script = fs.readFileSync('src/views/LogView.vue', 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const context = { exports: {}, sessionStorage: { removeItem() {} }, require: name => { assert.ok(name in mocks, name); return mocks[name] } }
  const code = ts.transpileModule(script + '\nexports.state = { reloadLogs, fetchLogPage, logs, pageIndex, pageCursors, hasMore, loading, filters, saveHistoryView, restoreHistoryView, inspectorTab, selectedRevisionPath, selectedLog, inlineDiff, handleRowClick, previewChangedPath, closeInspector, selectHistoryRow, selectedRevisions, navigateHistory, comparison, historyViewport };', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  vm.runInNewContext(code, context)
  return { ...context.exports.state, calls, store, flow, route }
}
const entries = Array.from({ length: 130 }, (_, index) => ({
  revision: 300 - index * 2, author: index % 2 ? 'alice' : 'bob', message: 'change', date: '', changed_paths: [],
}))
const query = (_path, limit, cursor, _end, _keyword, author) => entries
  .filter(entry => (cursor === undefined || entry.revision <= cursor) && (!author || entry.author === author)).slice(0, limit)

test('explicit pages replace rows, use revision cursors without gaps, and restore previous pages from cache', async () => {
  const h = harness(query)
  await h.reloadLogs()
  assert.equal(h.logs.value.length, 50)
  assert.equal(h.hasMore.value, true)
  assert.equal(h.calls[0][1], 51)
  const first = Array.from(h.logs.value, entry => entry.revision)
  await h.fetchLogPage(1)
  const second = Array.from(h.logs.value, entry => entry.revision)
  assert.equal(h.calls[1][2], first.at(-1) - 1)
  assert.equal(new Set([...first, ...second]).size, 100)
  await h.fetchLogPage(2)
  assert.equal(h.logs.value.length, 30)
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
  assert.equal(h.logs.value.length, 50)
  assert.ok(h.logs.value.every(entry => entry.author === 'alice'))
  assert.equal(h.calls.at(-1)[1], 51)
  assert.equal(h.calls.at(-1)[2], undefined)
  await h.fetchLogPage(1)
  assert.equal(h.logs.value.length, 15)
  assert.equal(h.hasMore.value, false)
})

test('empty and exact-size pages do not offer another page', async () => {
  for (const count of [0, 50]) {
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

test('restoring repository history retains the actual revision cursor page and selection', async () => {
  const h = harness(query)
  await h.reloadLogs()
  await h.fetchLogPage(1)
  const expected = Array.from(h.logs.value, entry => entry.revision)
  h.saveHistoryView()
  await h.reloadLogs()
  assert.equal(h.pageIndex.value,0)
  await h.restoreHistoryView()
  assert.equal(h.pageIndex.value,1)
  assert.deepEqual(Array.from(h.logs.value,entry=>entry.revision),expected)
})

test('history selection opens metadata without eagerly fetching a file diff', async () => {
  const calls = []
  const h = harness(query, async (...args) => { calls.push(args); return { diff: 'unexpected' } })
  h.store.svnInfo = { url: 'file:///repo/dev', repository_root: 'file:///repo' }
  h.handleRowClick({ ...entries[0], changed_paths: [{ path: '/dev/Source/A.cpp', action: 'M' }] })
  assert.equal(h.inspectorTab.value, 'commit')
  assert.equal(h.selectedLog.value.revision, entries[0].revision)
  assert.equal(h.selectedRevisionPath.value, '')
  assert.deepEqual(calls, [])
})

test('changing history selection or closing details rejects a pending file diff', async () => {
  let finish
  const h = harness(query, () => new Promise(resolve => { finish = resolve }))
  h.store.svnInfo = { url: 'file:///repo/dev', repository_root: 'file:///repo' }
  h.handleRowClick(entries[0])
  const pending = h.previewChangedPath({ path: '/dev/A.cpp', action: 'M' })
  h.handleRowClick(entries[1])
  finish({ diff: 'stale first selection' })
  await pending
  assert.equal(h.inlineDiff.value, '')
  const next = h.previewChangedPath({ path: '/dev/B.cpp', action: 'D' })
  h.closeInspector()
  finish({ diff: 'closed details' })
  await next
  assert.equal(h.inlineDiff.value, '')
  assert.equal(h.selectedLog.value, null)
})

test('history restoration retains the inspector tab and selected revision file', async () => {
  const file = { path: '/dev/Source/Game.cpp', action: 'M' }
  const revision = { ...entries[0], changed_paths: [file] }
  const h = harness(() => [revision], async () => ({ diff: 'restored diff' }))
  h.store.svnInfo = { url: 'file:///repo/dev', repository_root: 'file:///repo' }
  await h.reloadLogs()
  h.handleRowClick(revision)
  h.inspectorTab.value = 'tree'
  await h.previewChangedPath(file)
  h.saveHistoryView()
  h.closeInspector()
  h.inspectorTab.value = 'commit'
  await h.restoreHistoryView()
  assert.equal(h.inspectorTab.value, 'tree')
  assert.equal(h.selectedRevisionPath.value, file.path)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.inlineDiff.value, 'restored diff')
})

test('Ctrl-click compares two actual revisions and a plain click clears the comparison selection', async () => {
  const h = harness(query)
  await h.reloadLogs()
  assert.equal(h.selectedLog.value.revision, entries[0].revision)
  h.selectHistoryRow(entries[2], { ctrlKey: true })
  assert.deepEqual(Array.from(h.selectedRevisions.value), [entries[0].revision, entries[2].revision])
  const target = {}
  h.navigateHistory({ key: 'Enter', target, currentTarget: target, preventDefault() {} })
  assert.deepEqual(Array.from(h.comparison.value.revisions), [entries[0].revision, entries[2].revision])
  h.selectHistoryRow(entries[3], {})
  assert.equal(h.selectedRevisions.value.length, 0)
})

test('history keyboard navigation scrolls to the selected row and pagination selects a visible revision', async () => {
  const h = harness(query), scrolled = []
  h.historyViewport.value = { scrollToIndex: index => scrolled.push(index), resetScroll() {} }
  await h.reloadLogs()
  const target = {}
  h.navigateHistory({ key: 'End', target, currentTarget: target, preventDefault() {} })
  assert.equal(h.selectedLog.value.revision, entries[49].revision)
  assert.equal(scrolled.at(-1), 49)
  await h.fetchLogPage(1)
  assert.equal(h.selectedLog.value.revision, entries[50].revision)
})

test('history view restoration uses the virtual list scroll position', async () => {
  const h = harness(query)
  const element = { scrollTop: 0 }
  h.historyViewport.value = { element, resetScroll() { element.scrollTop = 0 } }
  await h.reloadLogs()
  element.scrollTop = 420
  h.saveHistoryView()
  await h.reloadLogs()
  assert.equal(element.scrollTop, 0)
  await h.restoreHistoryView()
  assert.equal(element.scrollTop, 420)
})
