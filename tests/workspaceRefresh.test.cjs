const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function harness() {
  const requests = [], snapshots = new Map(), writes = [], invalidations = [], publications = [], revisionReads = [], historyInvalidations = []
  const store = {
    currentPath: '/a', statusList: [], rawStatusList: null, svnInfo: null, gitignorePatterns: [], epoch: 0, historyEpoch: 0, advanceHistoryEpoch() { this.historyEpoch++ },
    advanceEpoch() { this.epoch++ },
    setCurrentPath(path) { this.currentPath = path },
    setStatusList(list) { publications.push(list); this.statusList = list },
    setRawStatusList(list) { this.rawStatusList = list },
    setSvnInfo(info) { this.svnInfo = info },
    setStatusIsStale(value) { this.statusIsStale = value },
    setLoading(value) { this.isLoading = value },
    setError(value) { this.error = value },
    setGitignorePatterns(value) { this.gitignorePatterns = value },
    setGitignoreMtime() {}, setGitignoreWorkspacePath() {},
    remembered: [], rememberWorkspace(path) { this.remembered.push(path) },
    lastWorkspacePath: null,
    getLastWorkspacePath() { return this.lastWorkspacePath },
    clearWorkspace() { this.lastWorkspacePath = null; this.resetWorkspaceState() },
    resetWorkspaceState() { this.currentPath = null; this.error = null },
  }
  let filter = async list => list
  let localRevision = async () => 12
  const mocks = {
    '@/stores/workspace': { useWorkspaceStore: () => store },
    '@/api/svn': {
      svnStatus: (path, force = false, includeInventory = true) => { const request = { path, force, includeInventory, ...deferred() }; requests.push(request); return request.promise },
      svnLocalRevision: () => { revisionReads.push(true); return localRevision() },
    },
    '@tauri-apps/plugin-dialog': {},
    '@/composables/useSettings': { useSettings: () => ({ settings: { gitignoreEnabled: false } }) },
    '@/i18n': { default: { global: { t: key => key } } },
    '@/utils/historyCache': { invalidateHistoryForSource: (...args) => historyInvalidations.push(args) },
    '@/utils/gitignore': {},
    '@/utils/statusPatch': (() => { const context = { exports: {} }; vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/utils/statusPatch.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, context); return context.exports })(),
    '@/utils/gitignoreWorker': { filterByGitignoreAsync: list => filter(list) },
    '@/utils/workspaceSnapshot': { getWorkspaceSnapshot: path => snapshots.get(path) || null, cacheWorkspaceSnapshot: (...args) => writes.push(args), invalidateWorkspaceSnapshot: path => { invalidations.push(path); snapshots.delete(path) } },
    '@/utils/svnInfoCache': { getCachedSvnInfoMetadata: () => ({ url: store.svnInfo?.url || 'file:///repo' }), invalidateSvnInfoMetadata() {}, cacheSvnInfoMetadata() {} },
  }
  const context = { exports: {}, queueMicrotask, require: name => { assert.ok(name in mocks, name); return mocks[name] } }
  const code = ts.transpileModule(fs.readFileSync('src/composables/useWorkspace.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(code, context)
  return { store, requests, snapshots, writes, invalidations, publications, revisionReads, historyInvalidations, useWorkspace: context.exports.useWorkspace, setFilter: value => { filter = value }, setLocalRevision: value => { localRevision = value } }
}

test('separate consumers share an in-flight refresh and background polls reuse fresh state', async () => {
  const h = harness(), a = h.useWorkspace(), b = h.useWorkspace()
  const first = a.refreshStatus(), second = b.refreshStatus()
  assert.equal(first, second)
  assert.equal(h.requests.length, 1)
  h.requests[0].resolve([{ path: 'first' }])
  assert.equal(await first, true)
  await b.refreshStatusIfStale(60_000)
  assert.equal(h.requests.length, 1)
  const manual = a.refreshStatus()
  assert.equal(h.requests.length, 2)
  h.requests[1].resolve([{ path: 'manual' }])
  assert.equal(await manual, true)
})

test('failed refresh is retried rather than treated as fresh', async () => {
  const h = harness(), workspace = h.useWorkspace()
  const failed = workspace.refreshStatus()
  h.requests[0].reject(new Error('status failed'))
  assert.equal(await failed, false)
  const retry = workspace.refreshStatusIfStale(60_000)
  assert.equal(h.requests.length, 2)
  h.requests[1].resolve([])
  assert.equal(await retry, true)
})

test('display filtering retains fresh unfiltered SVN status for commit selection', async () => {
  const h = harness(), workspace = h.useWorkspace()
  h.setFilter(async () => [])
  const refresh = workspace.refreshStatus()
  h.requests[0].resolve([{ path: 'Content/Map.umap', status_code: 'modified' }])
  assert.equal(await refresh, true)
  assert.equal(h.store.statusList.length, 0)
  assert.equal(h.store.rawStatusList[0].path, 'Content/Map.umap')
})

const changed = (path, code = 'modified') => ({ path, status_code: code, prop_status: 'none' })
function prepareDiscard(h) {
  h.store.svnInfo = { url: 'file:///repo/dev', revision: 12 }
  h.store.rawStatusList = [changed('folder/a.txt'), changed('folder/hidden.txt'), changed('other.txt')]
  h.store.statusList = h.store.rawStatusList
  return { workspace: '/a', expectedUrl: 'file:///repo/dev', paths: ['.', 'folder', 'folder/a.txt'], subtrees: [], entries: [] }
}

test('discard updates verified paths once without a global scan, revision query or repository reload', async () => {
  const h = harness(), patch = prepareDiscard(h)
  h.store.error = 'File retained: locked.uasset'
  h.setFilter(async list => list.filter(file => !file.path.includes('hidden')))
  assert.equal(await h.useWorkspace().refreshStatusAfterDiscard(patch), true)
  assert.equal(h.requests.length, 0)
  assert.equal(h.revisionReads.length, 0)
  assert.equal(h.store.epoch, 0)
  assert.deepEqual(h.invalidations, ['/a'])
  assert.deepEqual(Array.from(h.store.rawStatusList, file => file.path), ['folder/hidden.txt', 'other.txt'])
  assert.deepEqual(Array.from(h.store.statusList, file => file.path), ['other.txt'])
  assert.equal(h.publications.length, 1)
  assert.equal(h.store.error, 'File retained: locked.uasset')
  assert.equal(h.store.statusIsStale, false)
  assert.equal(h.store.isLoading, false)
})

test('structural discard replaces only the queried subtree and retains partial failures', async () => {
  const h = harness(), patch = prepareDiscard(h)
  h.store.rawStatusList.push(changed('folder2/keep.txt'))
  patch.subtrees = ['folder']
  patch.entries = [changed('folder/locked.uasset', 'unversioned')]
  assert.equal(await h.useWorkspace().refreshStatusAfterDiscard(patch), true)
  assert.deepEqual(Array.from(h.store.rawStatusList, file => file.path), ['folder/locked.uasset', 'folder2/keep.txt', 'other.txt'])
})

test('a collapsed unversioned parent removes obsolete child statuses', async () => {
  const h = harness(), patch = prepareDiscard(h)
  patch.entries = [changed('folder', 'unversioned')]
  assert.equal(await h.useWorkspace().refreshStatusAfterDiscard(patch), true)
  assert.deepEqual(Array.from(h.store.rawStatusList, file => file.path), ['folder', 'other.txt'])
})

test('an older background reply cannot resurrect discarded paths', async () => {
  const h = harness(), patch = prepareDiscard(h), workspace = h.useWorkspace()
  const old = workspace.refreshStatusIfStale(0)
  assert.equal(await workspace.refreshStatusAfterDiscard(patch), true)
  h.requests[0].resolve([changed('folder/a.txt')])
  assert.equal(await old, false)
  assert.equal(h.store.statusList.some(file => file.path === 'folder/a.txt'), false)
  await workspace.refreshStatusIfStale(60_000)
  assert.equal(h.requests.length, 1)
})

test('a manual refresh supersedes a pending discard filter', async () => {
  const h = harness(), patch = prepareDiscard(h), workspace = h.useWorkspace(), worker = deferred()
  h.setFilter(() => worker.promise)
  const discard = workspace.refreshStatusAfterDiscard(patch)
  for (let i = 0; i < 10; i++) await Promise.resolve()
  h.setFilter(async list => list)
  const manual = workspace.refreshStatus()
  h.requests[0].resolve([changed('external.txt')])
  assert.equal(await manual, true)
  worker.resolve([])
  assert.equal(await discard, false)
  assert.equal(h.store.statusList[0].path, 'external.txt')
  assert.equal(h.store.isLoading, false)
})

test('missing or mismatched discard status falls back to an authoritative complete scan', async () => {
  for (const mismatch of ['missing', 'workspace', 'branch', 'baseline']) {
    const h = harness(), patch = prepareDiscard(h)
    if (mismatch === 'workspace') patch.workspace = '/other'
    if (mismatch === 'branch') patch.expectedUrl = 'file:///repo/publish'
    if (mismatch === 'baseline') h.store.rawStatusList = null
    const pending = h.useWorkspace().refreshStatusAfterDiscard(mismatch === 'missing' ? null : patch)
    assert.equal(h.requests.length, 1)
    assert.equal(h.requests[0].force, true)
    h.requests[0].resolve([changed('verified.txt')])
    assert.equal(await pending, true)
    assert.equal(h.store.statusList[0].path, 'verified.txt')
  }
})

test('refresh keeps the visible list until filtering finishes and publishes only once', async () => {
  const h = harness(), workspace = h.useWorkspace(), worker = deferred()
  h.store.statusList = [changed('old.txt')]
  h.setFilter(() => worker.promise)
  const pending = workspace.refreshStatus()
  h.requests[0].resolve([changed('visible.txt'), changed('hidden.txt')])
  for (let i = 0; i < 10; i++) await Promise.resolve()
  assert.equal(h.publications.length, 0)
  assert.equal(h.store.statusList[0].path, 'old.txt')
  worker.resolve([changed('visible.txt')])
  assert.equal(await pending, true)
  assert.equal(h.publications.length, 1)
  assert.equal(h.store.statusList.length, 1)
  assert.equal(h.store.rawStatusList.length, 2)
})

test('background verification does not replace a clean view with a loading skeleton', async () => {
  const h = harness(), workspace = h.useWorkspace(), metadata = deferred()
  h.store.isLoading = false
  h.setLocalRevision(() => metadata.promise)
  const pending = workspace.refreshStatusIfStale(0)
  assert.equal(h.store.isLoading, false)
  h.requests[0].resolve([])
  for (let i = 0; i < 10; i++) await Promise.resolve()
  assert.equal(h.store.isLoading, false)
  metadata.resolve(12)
  assert.equal(await pending, true)
  assert.equal(h.store.isLoading, false)
})

test('post-mutation scan supersedes an earlier background scan', async () => {
  const h = harness(), workspace = h.useWorkspace()
  const background = workspace.refreshStatus()
  const mutation = workspace.refreshStatusAfterMutation()
  assert.equal(h.requests.length, 2)
  h.requests[1].resolve([{ path: 'new' }])
  assert.equal(await mutation, true)
  h.requests[0].resolve([{ path: 'old' }])
  assert.equal(await background, false)
  assert.equal(h.store.statusList[0].path, 'new')
  assert.equal(h.store.isLoading, false)
})

test('workspace switch rejects late results from the previous workspace', async () => {
  const h = harness(), workspace = h.useWorkspace()
  const previous = workspace.refreshStatus()
  const current = workspace.loadWorkspace('/b')
  assert.equal(h.requests[1].path, '/b')
  h.requests[1].resolve([{ path: 'b' }])
  assert.equal(await current, true)
  h.requests[0].resolve([{ path: 'a' }])
  assert.equal(await previous, false)
  assert.equal(h.store.statusList[0].path, 'b')
})

test('late worker reply cannot overwrite status after a mutation', async () => {
  const h = harness(), workspace = h.useWorkspace(), worker = deferred()
  h.setFilter(list => list[0]?.path === 'old' ? worker.promise : Promise.resolve(list))
  const old = workspace.refreshStatus()
  h.requests[0].resolve([{ path: 'old' }])
  // Let the old request reach the asynchronous filter.
  for (let i = 0; i < 10; i++) await Promise.resolve()
  const fresh = workspace.refreshStatusAfterMutation()
  h.requests[1].resolve([{ path: 'fresh' }])
  assert.equal(await fresh, true)
  worker.resolve([{ path: 'old' }])
  assert.equal(await old, false)
  assert.equal(h.store.statusList[0].path, 'fresh')
})


test('reopening shows a cached small change list synchronously and verifies it in the background', async () => {
  const h = harness(), workspace = h.useWorkspace()
  h.snapshots.set('/b', { statusList: [{ path: 'cached.ts' }], svnInfo: { revision: 11 } })
  const pending = workspace.loadWorkspace('/b')
  assert.equal(h.store.currentPath, '/b')
  assert.equal(h.store.statusList[0].path, 'cached.ts')
  assert.equal(h.store.svnInfo.revision, 11)
  assert.equal(h.store.statusIsStale, true)
  assert.equal(h.store.isLoading, true)
  assert.equal(h.requests.length, 1)
  h.requests[0].resolve([{ path: 'fresh.ts' }])
  assert.equal(await pending, true)
  assert.equal(h.store.statusList[0].path, 'fresh.ts')
  assert.equal(h.store.statusIsStale, false)
  assert.equal(h.store.isLoading, false)
  assert.equal(h.writes[0][0], '/b')
  assert.equal(h.writes[0][1][0].path, 'fresh.ts')
})

test('an empty cached list is still marked unverified until the scan succeeds', async () => {
  const h = harness()
  h.snapshots.set('/b', { statusList: [], svnInfo: { revision: 11 } })
  const pending = h.useWorkspace().loadWorkspace('/b')
  assert.equal(h.store.statusIsStale, true)
  h.requests[0].resolve([{ path: 'new.ts' }])
  assert.equal(await pending, true)
  assert.equal(h.store.statusIsStale, false)
})

test('failed verification preserves the cached view but does not mark it fresh', async () => {
  const h = harness(), workspace = h.useWorkspace()
  h.snapshots.set('/b', { statusList: [{ path: 'cached.ts' }], svnInfo: { revision: 11 } })
  const pending = workspace.loadWorkspace('/b')
  h.requests[0].reject(new Error('workspace unavailable'))
  assert.equal(await pending, false)
  assert.equal(h.store.currentPath, '/b')
  assert.equal(h.store.statusList[0].path, 'cached.ts')
  assert.equal(h.store.statusIsStale, true)
  assert.match(h.store.error, /workspace unavailable/)
  assert.equal(h.writes.length, 0)
  const retry = workspace.refreshStatus()
  h.requests[1].resolve([])
  assert.equal(await retry, true)
  assert.equal(h.store.statusIsStale, false)
})

test('post-mutation scan invalidates persistence and old file actions until fresh status arrives', async () => {
  const h = harness()
  h.snapshots.set('/a', { statusList: [{ path: 'old.ts' }], svnInfo: { revision: 11 } })
  const pending = h.useWorkspace().refreshStatusAfterMutation()
  assert.deepEqual(h.invalidations, ['/a'])
  assert.equal(h.snapshots.has('/a'), false)
  assert.equal(h.store.statusIsStale, true)
  h.requests[0].resolve([])
  await pending
  assert.equal(h.store.statusIsStale, false)
})

test('filesystem-scoped background checks do not satisfy an explicit complete refresh', async () => {
  const h = harness(), workspace = h.useWorkspace()
  const background = workspace.refreshStatusIfStale(0)
  assert.equal(h.requests[0].force, false)
  const manual = workspace.refreshStatus()
  assert.equal(h.requests[1].force, true)
  h.requests[1].resolve([{ path: 'verified.ts' }])
  assert.equal(await manual, true)
  h.requests[0].resolve([{ path: 'old.ts' }])
  assert.equal(await background, false)
  assert.equal(h.store.statusList[0].path, 'verified.ts')
})

test('a background refresh reports a failure once, so a dismissed error stays dismissed', async () => {
  const h = harness(), workspace = h.useWorkspace()
  const first = workspace.refreshStatusIfStale(0)
  h.requests[0].reject(new Error('offline'))
  assert.equal(await first, false)
  assert.match(h.store.error, /offline/)

  h.store.setError(null)
  const repeated = workspace.refreshStatusIfStale(0)
  h.requests[1].reject(new Error('offline'))
  assert.equal(await repeated, false)
  assert.equal(h.store.error, null)

  const changed = workspace.refreshStatusIfStale(0)
  h.requests[2].reject(new Error('denied'))
  assert.equal(await changed, false)
  assert.match(h.store.error, /denied/)
})

test('a background refresh leaves other errors alone and clears only its own on recovery', async () => {
  const h = harness(), workspace = h.useWorkspace()
  h.store.setError('cleanup failed')
  const unrelated = workspace.refreshStatusIfStale(0)
  assert.equal(h.store.error, 'cleanup failed')
  h.requests[0].resolve([])
  assert.equal(await unrelated, true)
  assert.equal(h.store.error, 'cleanup failed')

  const failed = workspace.refreshStatus()
  h.requests[1].reject(new Error('offline'))
  await failed
  const recovered = workspace.refreshStatusIfStale(0)
  h.requests[2].resolve([])
  assert.equal(await recovered, true)
  assert.equal(h.store.error, null)
})

test('loading a workspace does not join a background refresh that hides its errors', async () => {
  const h = harness(), workspace = h.useWorkspace()
  const background = workspace.refreshStatusIfStale(0)
  const load = workspace.loadWorkspace('/a')
  assert.equal(h.requests.length, 2)
  h.requests[1].reject(new Error('offline'))
  assert.equal(await load, false)
  assert.match(h.store.error, /offline/)
  h.requests[0].resolve([])
  assert.equal(await background, false)
})

test('a failed first load keeps the remembered workspace', async () => {
  const h = harness(), workspace = h.useWorkspace()
  h.store.currentPath = null
  h.store.lastWorkspacePath = '/last'
  const pending = workspace.loadWorkspace('/b')
  h.requests[0].reject(new Error('offline'))
  assert.equal(await pending, false)
  assert.equal(h.store.currentPath, null)
  assert.equal(h.store.lastWorkspacePath, '/last')
  assert.match(h.store.error, /offline/)
})

test('a failed launch path stays reported after falling back to the last workspace', async () => {
  const h = harness(), workspace = h.useWorkspace()
  h.store.currentPath = null
  h.store.lastWorkspacePath = '/last'
  const pending = workspace.openStartupWorkspace('/launch')
  h.requests[0].reject(new Error('launch failed'))
  for (let i = 0; i < 20 && h.requests.length < 2; i++) await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.requests[1].path, '/last')
  assert.equal(h.store.error, null)
  h.requests[1].resolve([])
  await pending
  assert.equal(h.store.currentPath, '/last')
  assert.match(h.store.error, /launch failed/)
})

test('a successful poll of the fallback workspace keeps the failed launch path error', async () => {
  const h = harness(), workspace = h.useWorkspace()
  h.store.currentPath = null
  h.store.lastWorkspacePath = '/last'
  const pending = workspace.openStartupWorkspace('/launch')
  h.requests[0].reject(new Error('launch failed'))
  for (let i = 0; i < 20 && h.requests.length < 2; i++) await new Promise(resolve => setImmediate(resolve))
  h.requests[1].resolve([])
  await pending
  const poll = workspace.refreshStatusIfStale(0)
  h.requests[2].resolve([])
  assert.equal(await poll, true)
  assert.match(h.store.error, /launch failed/)
})

test('a failed revision read still opens the workspace and reports the error', async () => {
  const h = harness(), workspace = h.useWorkspace()
  h.store.currentPath = null
  h.store.lastWorkspacePath = '/last'
  h.setLocalRevision(async () => { throw new Error('no revision') })
  const pending = workspace.loadWorkspace('/b')
  h.requests[0].resolve([{ path: 'fresh.ts' }])
  assert.equal(await pending, true)
  assert.equal(h.store.currentPath, '/b')
  assert.equal(h.store.statusList[0].path, 'fresh.ts')
  assert.equal(h.store.statusIsStale, false)
  assert.equal(h.store.svnInfo, null)
  assert.deepEqual(h.store.remembered, ['/b'])
  assert.match(h.store.error, /no revision/)
  assert.equal(h.writes.length, 0)
})

test('a failed revision read keeps the snapshot revision and new status', async () => {
  const h = harness(), workspace = h.useWorkspace()
  h.snapshots.set('/b', { statusList: [{ path: 'cached.ts' }], svnInfo: { revision: 11 } })
  h.setLocalRevision(async () => { throw new Error('no revision') })
  const pending = workspace.loadWorkspace('/b')
  h.requests[0].resolve([{ path: 'fresh.ts' }])
  assert.equal(await pending, true)
  assert.equal(h.store.statusList[0].path, 'fresh.ts')
  assert.equal(h.store.svnInfo.revision, 11)
  assert.match(h.store.error, /no revision/)
})

test('a refresh with a failed revision read updates status, keeps the revision and retries', async () => {
  const h = harness(), workspace = h.useWorkspace()
  h.store.svnInfo = { revision: 11 }
  h.setLocalRevision(async () => { throw new Error('no revision') })
  const failed = workspace.refreshStatus()
  h.requests[0].resolve([{ path: 'fresh.ts' }])
  assert.equal(await failed, false)
  assert.equal(h.store.statusList[0].path, 'fresh.ts')
  assert.equal(h.store.statusIsStale, false)
  assert.equal(h.store.svnInfo.revision, 11)
  assert.match(h.store.error, /no revision/)

  h.setLocalRevision(async () => 12)
  const retry = workspace.refreshStatusIfStale(60_000)
  assert.equal(h.requests.length, 2)
  h.requests[1].resolve([])
  assert.equal(await retry, true)
  assert.equal(h.store.svnInfo.revision, 12)
  assert.equal(h.store.error, null)
})


test('commit merges only verified paths, preserves hidden changes and advances only history', async () => {
  const h = harness(), patch = prepareDiscard(h)
  h.setFilter(async list => list.filter(file => !file.path.includes('hidden')))
  const outcome = { success: true, status: patch, info: { url: patch.expectedUrl, revision: 12 } }
  assert.equal(await h.useWorkspace().applyCommitResult('/a', patch.expectedUrl, outcome), true)
  assert.equal(h.requests.length, 0)
  assert.equal(h.revisionReads.length, 0)
  assert.equal(h.store.epoch, 0)
  assert.equal(h.store.historyEpoch, 1)
  assert.deepEqual(h.historyInvalidations, [['/a', patch.expectedUrl]])
  assert.deepEqual(Array.from(h.store.rawStatusList, e => e.path), ['folder/hidden.txt', 'other.txt'])
  assert.deepEqual(Array.from(h.store.statusList, e => e.path), ['other.txt'])
  assert.equal(h.store.statusIsStale, false)
})

test('add review and failed commits do not invalidate history, and retain post-command modifications', async () => {
  for (const outcome of [{ success: true, added: true }, { success: false, error: 'hook rejected' }]) {
    const h = harness(), patch = prepareDiscard(h)
    patch.entries = [changed('folder/a.txt')]
    assert.equal(await h.useWorkspace().applyCommitResult('/a', patch.expectedUrl, { ...outcome, status: patch }), true)
    assert.equal(h.store.historyEpoch, 0)
    assert.equal(h.historyInvalidations.length, 0)
    assert.equal(h.requests.length, 0)
    assert.ok(h.store.rawStatusList.some(e => e.path === 'folder/a.txt'))
  }
})

test('late commit patches cannot overwrite a newly opened workspace but invalidate the old history cache', async () => {
  const h = harness(), patch = prepareDiscard(h)
  h.store.currentPath = '/b'
  assert.equal(await h.useWorkspace().applyCommitResult('/a', patch.expectedUrl, { success: true, status: patch }), false)
  assert.equal(h.store.historyEpoch, 0)
  assert.equal(h.requests.length, 0)
  assert.deepEqual(h.historyInvalidations, [['/a', patch.expectedUrl]])
  assert.equal(h.store.rawStatusList.length, 3)
})

test('a commit patch supersedes an older scan and is itself superseded by a newer explicit refresh', async () => {
  const h = harness(), patch = prepareDiscard(h), workspace = h.useWorkspace()
  const older = workspace.refreshStatus()
  assert.equal(await workspace.applyCommitResult('/a', patch.expectedUrl, { success: true, status: patch }), true)
  h.requests[0].resolve([changed('obsolete.txt')])
  assert.equal(await older, false)
  assert.ok(!h.store.rawStatusList.some(e => e.path === 'obsolete.txt'))
  assert.equal(h.store.isLoading, false)
  const gate = deferred()
  h.setFilter(() => gate.promise)
  const merge = workspace.applyCommitResult('/a', patch.expectedUrl, { success: true, status: patch })
  await new Promise(resolve => setImmediate(resolve))
  h.setFilter(async list => list)
  const manual = workspace.refreshStatus()
  h.requests[1].resolve([changed('latest.txt')])
  assert.equal(await manual, true)
  gate.resolve([])
  assert.equal(await merge, false)
  assert.deepEqual(Array.from(h.store.rawStatusList, e => e.path), ['latest.txt'])
})

test('missing commit patches return immediately while recovery runs in the background', async () => {
  const h = harness(), patch = prepareDiscard(h)
  assert.equal(await h.useWorkspace().applyCommitResult('/a', patch.expectedUrl, { success: true, status: null }), false)
  assert.equal(h.requests.length, 1)
  assert.equal(h.store.statusIsStale, true)
  h.requests[0].resolve([changed('unrelated.txt')])
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.store.statusIsStale, false)
})

test('a failed commit display filter starts recovery without changing the completed command result', async () => {
  const h = harness(), patch = prepareDiscard(h)
  h.setFilter(async () => { throw new Error('worker unavailable') })
  const outcome = { success: true, status: patch }
  assert.equal(await h.useWorkspace().applyCommitResult('/a', patch.expectedUrl, outcome), false)
  assert.equal(outcome.success, true)
  assert.equal(h.requests.length, 1)
  h.setFilter(async list => list)
  h.requests[0].resolve([])
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.store.statusIsStale, false)
})


test('post-update verification runs once in the background without filesystem inventory or branch reloads', async () => {
  const h = harness(), patch = prepareDiscard(h), workspace = h.useWorkspace()
  const before = h.store.statusList
  const verification = workspace.refreshStatusAfterUpdate('/a', patch.expectedUrl)
  assert.equal(h.store.statusIsStale, true)
  assert.equal(h.store.isLoading, false)
  assert.equal(h.store.statusList, before)
  assert.equal(h.store.epoch, 0)
  assert.equal(h.store.historyEpoch, 1)
  assert.deepEqual(h.historyInvalidations, [['/a', patch.expectedUrl]])
  assert.equal(h.requests[0].includeInventory, false)
  assert.equal(h.requests[0].force, true)
  const joined = workspace.refreshStatusIfStale(60_000)
  assert.equal(joined, verification)
  assert.equal(h.requests.length, 1)
  h.requests[0].resolve([changed('new.txt')])
  assert.equal(await verification, true)
  assert.equal(h.store.statusIsStale, false)
  assert.deepEqual(Array.from(h.store.statusList, e => e.path), ['new.txt'])
})

test('post-update verification invalidates an older scan and rejects late replies after workspace switches', async () => {
  const h = harness(), patch = prepareDiscard(h), workspace = h.useWorkspace()
  const old = workspace.refreshStatusIfStale(60_000)
  const fresh = workspace.refreshStatusAfterUpdate('/a', patch.expectedUrl)
  h.requests[0].resolve([changed('obsolete.txt')])
  assert.equal(await old, false)
  h.store.currentPath = '/b'
  h.requests[1].resolve([])
  assert.equal(await fresh, false)
  assert.equal(h.store.rawStatusList.length, 3)
})

test('update verification never queries another workspace or branch, but invalidates the original history', async () => {
  for (const change of ['workspace', 'branch']) {
    const h = harness(), patch = prepareDiscard(h)
    if (change === 'workspace') h.store.currentPath = '/b'
    else h.store.svnInfo.url = 'file:///repo/publish'
    assert.equal(await h.useWorkspace().refreshStatusAfterUpdate('/a', patch.expectedUrl), false)
    assert.equal(h.requests.length, 0)
    assert.equal(h.store.historyEpoch, 0)
    assert.deepEqual(h.historyInvalidations, [['/a', patch.expectedUrl]])
  }
})

test('a failed post-update verification preserves the view and reports its error', async () => {
  const h = harness(), patch = prepareDiscard(h), before = h.store.statusList
  const pending = h.useWorkspace().refreshStatusAfterUpdate('/a', patch.expectedUrl)
  h.requests[0].reject(new Error('verification failed'))
  assert.equal(await pending, false)
  assert.equal(h.store.statusList, before)
  assert.equal(h.store.statusIsStale, true)
  assert.equal(h.store.isLoading, false)
  assert.match(h.store.error, /verification failed/)
})
