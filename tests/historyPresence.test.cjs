const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')

function harness() {
  const requests = [], hooks = {}, fingerprints = []
  let fingerprint = 'fixture-base'
  const store = vue.reactive({ currentPath: '/fixture', svnInfo: { url: 'file:///fixture/dev', revision: 10 }, epoch: 0, statusList: [], isLoading: false })
  const entries = vue.ref([{ revision: 12, changed_paths: [] }]), source = vue.ref(store.svnInfo.url)
  const mocks = {
    vue: { ...vue, onActivated(fn) { hooks.activate = fn }, onDeactivated(fn) { hooks.deactivate = fn }, onUnmounted(fn) { hooks.unmount = fn } },
    '@/stores/workspace': { useWorkspaceStore: () => store },
    '@/api/svn': { svnHistoryBaseFingerprint: async path => { fingerprints.push(path); return fingerprint }, svnHistoryPresence(...args) { return new Promise((resolve, reject) => requests.push({ args, resolve, reject })) } },
  }
  const context = { exports: {}, require: name => { assert.ok(name in mocks, name); return mocks[name] } }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/composables/useHistoryPresence.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context)
  const scope = vue.effectScope()
  const state = scope.run(() => context.exports.useHistoryPresence(entries, source))
  const result = (revision = 12, status = 'included', scopeMatches = true) => ({ workingUrl: store.svnInfo.url, baseRevision: 10, baseFingerprint: fingerprint, scopeMatches, rows: [{ revision, state: status, included: 1, pending: 0, unknown: 0 }] })
  return { store, entries, source, requests, hooks, state, result, fingerprints, changeFingerprint(value) { fingerprint = value }, stop() { hooks.unmount(); scope.stop() } }
}
const settle = async () => { await Promise.resolve(); await vue.nextTick(); await Promise.resolve() }

test('history states use verified per-revision rows and missing rows stay unconfirmed', async () => {
  const h = harness()
  assert.equal(h.state.state(12), 'checking')
  h.requests[0].resolve(h.result())
  await settle()
  assert.equal(h.state.state(12), 'included')
  assert.equal(h.state.state(11), 'unknown')
  assert.equal(h.state.baseRevision.value, 10)
  h.stop()
})

test('late history presence from an old page cannot mark the new page included', async () => {
  const h = harness()
  h.entries.value = [{ revision: 13, changed_paths: [] }]
  await settle()
  h.requests[1].resolve(h.result(13, 'pending'))
  await settle()
  h.requests[0].resolve(h.result(12))
  await settle()
  assert.equal(h.state.state(13), 'pending')
  assert.equal(h.state.state(12), 'unknown')
  h.stop()
})

test('changing working copy rejects a late response even with identical revisions', async () => {
  const h = harness(), old = h.result()
  h.store.currentPath = '/fixture-other'
  h.store.svnInfo.url = 'file:///fixture/publish'
  h.store.epoch++
  h.source.value = h.store.svnInfo.url
  await settle()
  h.requests[0].resolve(old)
  await settle()
  assert.equal(h.state.state(12), 'checking')
  h.requests[1].resolve(h.result(12, 'pending'))
  await settle()
  assert.equal(h.state.state(12), 'pending')
  h.stop()
})

test('errors and mismatching returned URLs cannot mark any row included', async () => {
  const h = harness()
  h.requests[0].reject(new Error('local metadata unavailable'))
  await settle()
  assert.equal(h.state.state(12), 'unknown')
  assert.match(h.state.error.value, /metadata unavailable/)
  const retry = h.state.refresh()
  h.requests[1].resolve({ ...h.result(), workingUrl: 'file:///wrong/dev' })
  await retry
  assert.equal(h.state.state(12), 'unknown')
  h.stop()
})

test('other branch browsing remains distinct from current working copy inclusion', async () => {
  const h = harness()
  h.source.value = 'file:///fixture/publish'
  await settle()
  h.requests[1].resolve(h.result(12, 'unknown', false))
  await settle()
  assert.equal(h.state.state(12), 'other')
  assert.equal(h.state.scopeMatches.value, false)
  h.stop()
})

test('workspace refresh rechecks local BASE after update without replacing history', async () => {
  const h = harness()
  h.requests[0].resolve(h.result(12, 'pending'))
  await settle()
  h.store.isLoading = true
  await settle()
  assert.equal(h.requests.length, 1)
  h.store.statusList = []
  h.store.svnInfo.revision = 12
  h.store.isLoading = false
  await settle()
  assert.equal(h.requests.length, 2)
  h.requests[1].resolve({ ...h.result(), baseRevision: 12 })
  await settle()
  assert.equal(h.state.state(12), 'included')
  assert.equal(h.state.baseRevision.value, 12)
  assert.equal(h.entries.value[0].revision, 12)
  h.stop()
})

test('deactivation invalidates requests and activation checks the current page again', async () => {
  const h = harness()
  h.hooks.deactivate()
  h.requests[0].resolve(h.result())
  await settle()
  assert.equal(h.state.state(12), 'unknown')
  h.hooks.activate()
  h.requests[1].resolve(h.result(12, 'partial'))
  await settle()
  assert.equal(h.state.state(12), 'partial')
  h.stop()
})

test('all supported languages provide the same history presence keys', () => {
  const context = { exports: {} }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/i18n/historyPresence.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
  const locales = context.exports.historyPresenceLocales
  assert.equal(Object.keys(locales).length, 5)
  const keys = Object.keys(locales['en-US']).sort()
  for (const value of Object.values(locales)) assert.deepEqual(Object.keys(value).sort(), keys)
})

test('scrolling into another window only checks new revisions and retains verified colors', async () => {
  const h = harness()
  h.requests[0].resolve(h.result())
  await settle()
  h.entries.value = [{ revision: 12, changed_paths: [] }, { revision: 11, changed_paths: [] }]
  await settle()
  assert.equal(h.requests.length, 2)
  assert.deepEqual(Array.from(h.requests[1].args[3], entry => entry.revision), [11])
  assert.equal(h.state.state(12), 'included')
  h.requests[1].resolve(h.result(11, 'partial'))
  await settle()
  assert.equal(h.state.state(11), 'partial')
  h.entries.value = [{ revision: 12, changed_paths: [] }]
  await settle()
  assert.equal(h.requests.length, 2)
  assert.equal(h.state.state(12), 'included')
  h.stop()
})

test('ordinary working-file status updates do not invalidate BASE inclusion', async () => {
  const h = harness()
  h.requests[0].resolve({ ...h.result(), rows: [{ ...h.result().rows[0], basis: 'range', reasons: [] }] })
  await settle()
  h.store.statusList = [{ path: 'Content/Fixture.uasset', status_code: 'modified' }]
  await settle()
  assert.equal(h.requests.length, 1)
  assert.equal(h.fingerprints.length, 1)
  assert.equal(h.state.state(12), 'included')
  assert.equal(h.state.rows.value[12].basis, 'range')
  h.stop()
})

test('an external subtree update invalidates cached states even if the root revision stays the same', async () => {
  const h = harness()
  h.requests[0].resolve(h.result(12, 'partial'))
  await settle()
  h.changeFingerprint('external-update')
  h.store.statusList = []
  await settle()
  assert.equal(h.requests.length, 2)
  assert.equal(h.store.svnInfo.revision, 10)
  h.requests[1].resolve(h.result(12, 'included'))
  await settle()
  assert.equal(h.state.state(12), 'included')
  h.stop()
})
