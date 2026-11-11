const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
const vue = require('vue')

function harness(fetch, diff = async () => ({ diff: '' }), live = false) {
  const clipboard = [], operations = []
  const calls = [], uiState = {}, hooks = { activated: [], deactivated: [] }
  const flow = vue.reactive({ browsingUrl: '', identity: null, busy:false, async perform(_title,operation){return operation()} })
  const store = vue.reactive({ currentPath: '/wc', epoch: 0, isLoading: false, ...(live ? { svnInfo: { url: 'file:///repo/dev', repository_root: 'file:///repo' } } : {}), setError(error) { this.error = error } })
  const route = vue.reactive({ query: {} })
  const cacheContext = { exports: {} }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/utils/historyCache.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, cacheContext)
  const mocks = {
    '@/utils/historyCache': cacheContext.exports,
    '@/utils/historyMenu': (()=>{const c={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/utils/historyMenu.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,c);return c.exports})(),
    '@/composables/useHistoryPresence': { useHistoryPresence: () => ({ rows: vue.ref({}), checking: vue.ref(false), error: vue.ref(''), baseRevision: vue.ref(null), scopeMatches: vue.ref(null), state: () => 'unknown', refresh() {} }) },
    '@/utils/changeSelection': { readPanelSize: (_key,fallback) => fallback },
    '@/utils/repositoryUi': { repositoryUi: () => uiState },
    vue: { ...vue, watch: live ? vue.watch : () => {}, onMounted() {}, onActivated(fn) { hooks.activated.push(fn) }, onDeactivated(fn) { hooks.deactivated.push(fn) }, onUnmounted() {} },
    '@/stores/workflows': { useWorkflowStore: () => flow },
    '@/api/workflows': {historyMergePreview:async(...args)=>{operations.push(args);return {kind:args[3]?'reverse-merge':'cherry-pick',revisions:args[2]}}},
    '@/components/DiffViewer.vue': {},
    '@/utils/clipboard': {writeClipboardText:async text=>clipboard.push(text)},
    'element-plus': {},
    '@/stores/workspace': { useWorkspaceStore: () => store },
    '@/api/svn': { svnLog: async (...args) => { calls.push(args); return fetch(...args) }, svnDiff: diff },
    'vue-i18n': { useI18n: () => ({ t: key => key, locale: vue.ref('en-US') }) },
    '@/composables/useWorkspace': { useWorkspace: () => ({}) },
    'vue-router': { useRouter: () => ({}), useRoute: () => route },
  }
  const script = fs.readFileSync('src/views/LogView.vue', 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const context = { exports: {}, window: { setTimeout, clearTimeout }, sessionStorage: { getItem() { return null }, removeItem() {} }, require: name => { assert.ok(name in mocks, name); return mocks[name] } }
  const code = ts.transpileModule(script + '\nexports.state = { reloadLogs, loadMoreLogs, handleHistoryScroll, syncHistoryContext, logs, nextCursor, historyLoadError, hasMore, loading, filters, saveHistoryView, restoreHistoryView, inspectorTab, selectedRevisionPath, selectedLog, inlineDiff, handleRowClick, previewChangedPath, closeInspector, selectHistoryRow, selectedRevisions, navigateHistory, comparison, historyViewport, contextMenu, contextVisible, contextItems, contextRows, runHistoryAction, historyActionRequest };', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const scope = vue.effectScope()
  scope.run(() => vm.runInNewContext(code, context))
  return { ...context.exports.state, clipboard, operations, calls, store, flow, route, deactivate() { hooks.deactivated.forEach(fn => fn()) }, activate() { hooks.activated.forEach(fn => fn()) }, stop() { scope.stop() } }
}
const entries = Array.from({ length: 130 }, (_, index) => ({
  revision: 300 - index * 2, author: index % 2 ? 'alice' : 'bob', message: 'change', date: '', changed_paths: [],
}))
const query = (_path, limit, cursor, _end, _keyword, author) => entries
  .filter(entry => (cursor === undefined || entry.revision <= cursor) && (!author || entry.author === author)).slice(0, limit)

test('continuous history appends revision batches without gaps or repeated cached queries', async () => {
  const h = harness(query)
  await h.reloadLogs()
  assert.equal(h.logs.value.length, 100)
  assert.equal(h.hasMore.value, true)
  assert.equal(h.calls[0][1], 101)
  const first = Array.from(h.logs.value, entry => entry.revision)
  await h.loadMoreLogs()
  assert.equal(h.calls[1][2], first.at(-1) - 1)
  assert.equal(h.logs.value.length, 130)
  assert.equal(new Set(h.logs.value.map(e => e.revision)).size, 130)
  assert.equal(h.hasMore.value, false)
  await h.reloadLogs()
  assert.equal(h.calls.length, 2)
  assert.equal(h.logs.value.length, 130)
})

test('filtered results remain bounded and cache reuse preserves the filter context', async () => {
  const h = harness(query)
  await h.reloadLogs()
  h.filters.author = 'alice'
  await h.reloadLogs(false, true)
  assert.equal(h.logs.value.length, 65)
  assert.ok(h.logs.value.every(entry => entry.author === 'alice'))
  assert.equal(h.calls.at(-1)[1], 101)
  assert.equal(h.calls.at(-1)[2], undefined)
  h.filters.author = ''
  await h.reloadLogs(false, true)
  assert.equal(h.logs.value.length, 100)
  assert.equal(h.calls.length, 2)
})

test('empty and exact-size histories stop automatic loading', async () => {
  for (const count of [0, 100]) {
    const h = harness(() => entries.slice(0, count))
    await h.reloadLogs()
    assert.equal(h.logs.value.length, count)
    assert.equal(h.hasMore.value, false)
    await h.loadMoreLogs()
    assert.equal(h.calls.length, 1)
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

test('restoring repository history retains all loaded rows without querying again', async () => {
  const h = harness(query)
  await h.reloadLogs()
  await h.loadMoreLogs()
  const expected = Array.from(h.logs.value, entry => entry.revision)
  h.saveHistoryView()
  await h.restoreHistoryView()
  assert.deepEqual(Array.from(h.logs.value, entry => entry.revision), expected)
  assert.equal(h.calls.length, 2)
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

test('history keyboard navigation retains its selection when older commits append', async () => {
  const h = harness(query), scrolled = []
  h.historyViewport.value = { scrollToIndex: index => scrolled.push(index), resetScroll() {} }
  await h.reloadLogs()
  const target = {}
  h.navigateHistory({ key: 'End', target, currentTarget: target, preventDefault() {} })
  assert.equal(h.selectedLog.value.revision, entries[99].revision)
  assert.equal(scrolled.at(-1), 99)
  await h.loadMoreLogs()
  assert.equal(h.selectedLog.value.revision, entries[99].revision)
})

test('history view restoration uses the virtual list scroll position', async () => {
  const h = harness(query)
  const element = { scrollTop: 0 }
  h.historyViewport.value = { element, resetScroll() { element.scrollTop = 0 } }
  await h.reloadLogs()
  element.scrollTop = 420
  h.saveHistoryView()
  await h.reloadLogs()
  assert.equal(element.scrollTop, 420)
  await h.restoreHistoryView()
  assert.equal(element.scrollTop, 420)
})


test('scroll prefetch deduplicates in-flight loads and preserves the selected commit and scroll', async () => {
  let finish
  const h = harness((...args) => args[2] === undefined ? query(...args) : new Promise(resolve => { finish = resolve }))
  await h.reloadLogs()
  const viewport = { scrollTop: 2250, scrollHeight: 2800, clientHeight: 500 }
  h.handleHistoryScroll({ currentTarget: viewport })
  h.handleHistoryScroll({ currentTarget: viewport })
  assert.equal(h.calls.length, 2)
  finish(entries.slice(100))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.logs.value.length, 130)
  assert.equal(h.selectedLog.value.revision, entries[0].revision)
  assert.equal(viewport.scrollTop, 2250)
})

test('failed append preserves the list and retries the same cursor', async () => {
  let fail = true
  const h = harness((...args) => { if (args[2] !== undefined && fail) throw new Error('fixture offline'); return query(...args) })
  await h.reloadLogs()
  await h.loadMoreLogs()
  assert.equal(h.logs.value.length, 100)
  assert.match(h.historyLoadError.value, /fixture offline/)
  const cursor = h.calls.at(-1)[2]
  fail = false
  await h.loadMoreLogs()
  assert.equal(h.calls.at(-1)[2], cursor)
  assert.equal(h.logs.value.length, 130)
  assert.equal(h.historyLoadError.value, '')
})

test('cache keys isolate working copies and branch sources without using the transient workspace epoch', async () => {
  const h = harness(query)
  h.store.svnInfo = { url: 'file:///repo/dev', repository_root: 'file:///repo' }
  h.flow.browsingUrl = h.store.svnInfo.url
  await h.reloadLogs()
  await h.loadMoreLogs()
  h.store.currentPath = '/wc-other'
  h.store.epoch++
  await h.reloadLogs()
  assert.equal(h.calls.length, 3)
  h.store.currentPath = '/wc'
  h.store.epoch++
  await h.reloadLogs()
  assert.equal(h.calls.length, 3)
  assert.equal(h.logs.value.length, 130)
  h.flow.browsingUrl = 'file:///repo/publish'
  await h.reloadLogs()
  assert.equal(h.calls.length, 4)
})

test('explicit refresh invalidates filter caches for the same working copy and source', async () => {
  const h = harness(query)
  await h.reloadLogs()
  h.filters.author = 'alice'
  await h.reloadLogs(false, true)
  await h.reloadLogs(true)
  h.filters.author = ''
  await h.reloadLogs(false, true)
  assert.equal(h.calls.length, 4)
})


test('actual lifecycle watchers reuse history on navigation and refresh once after an explicit workspace refresh', async () => {
  const h = harness(query, undefined, true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.length, 1)
  h.deactivate()
  h.activate()
  await h.restoreHistoryView()
  assert.equal(h.calls.length, 1)
  h.store.isLoading = true
  h.store.epoch++
  await vue.nextTick()
  assert.equal(h.calls.length, 1)
  h.store.isLoading = false
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.length, 2)
  h.stop()
})

test('deactivating an initial request rejects its reply and reactivation retries instead of leaving an empty history', async () => {
  let finish
  const h = harness(() => new Promise(resolve => { finish = resolve }), undefined, true)
  assert.equal(h.calls.length, 1)
  h.deactivate()
  finish(entries.slice(0, 101))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.logs.value.length, 0)
  h.activate()
  assert.equal(h.calls.length, 2)
  finish(entries.slice(0, 101))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.logs.value.length, 100)
  h.stop()
})


test('history right click preserves a selected set and replaces it only for an unselected revision', async () => {
 const h=harness(()=>entries.slice(0,4));await h.reloadLogs()
 h.store.svnInfo={url:'file:///repo/dev',revision:400};h.flow.browsingUrl='file:///repo/dev'
 h.selectedRevisions.value=[entries[0].revision,entries[2].revision]
 h.contextMenu(entries[2],null,{preventDefault(){},clientX:10,clientY:10})
 assert.deepEqual(Array.from(h.contextRows.value,e=>e.revision),[entries[0].revision,entries[2].revision])
 assert.equal(h.operations.length,0)
 h.contextMenu(entries[1],null,{preventDefault(){},clientX:10,clientY:10})
 assert.deepEqual(Array.from(h.contextRows.value,e=>e.revision),[entries[1].revision])
 assert.equal(h.contextVisible.value,true)
 h.stop()
})

test('history menu forms capture source and revision without issuing repository writes', async () => {
 const h=harness(()=>entries.slice(0,3));await h.reloadLogs()
 h.store.svnInfo={url:'file:///repo/dev',revision:400};h.flow.browsingUrl='file:///repo/dev';h.selectedLog.value=entries[1]
 await h.runHistoryAction('createBranch')
 assert.equal(h.historyActionRequest.value.source,'file:///repo/dev')
 assert.equal(h.historyActionRequest.value.entries[0].revision,entries[1].revision)
 assert.equal(h.operations.length,0)
 await h.runHistoryAction('copyInfo')
 assert.match(h.clipboard[0],new RegExp('r'+entries[1].revision))
 assert.equal(h.operations.length,0)
 h.stop()
})

test('multi-revision cherry-pick passes an exact sparse set, and BASE/working comparisons start at the selected revision', async () => {
 const h=harness(()=>entries.slice(0,4));await h.reloadLogs()
 h.store.svnInfo={url:'file:///repo/dev',revision:100};h.flow.browsingUrl='file:///repo/other';h.selectedLog.value=entries[0]
 h.selectedRevisions.value=[entries[0].revision,entries[2].revision]
 await h.runHistoryAction('cherryPick')
 assert.deepEqual(Array.from(h.operations[0][2]),[entries[0].revision,entries[2].revision])
 assert.equal(h.flow.plan.kind,'cherry-pick')
 h.selectedRevisions.value=[];h.flow.browsingUrl='file:///repo/dev'
 await h.runHistoryAction('compareBase')
 assert.deepEqual(Array.from(h.comparison.value.revisions),[entries[0].revision,100])
 assert.equal(h.comparison.value.ordered,true)
 await h.runHistoryAction('compareWorking')
 assert.equal(h.comparison.value.revisions[0],entries[0].revision)
 assert.equal(h.comparison.value.working,true)
 h.stop()
})
