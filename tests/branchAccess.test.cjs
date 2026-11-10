const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
const vue = require('vue')

function harness(overrides = {}, refreshStatusAfterMutation = async () => true) {
  const root = 'https://example.test/svn/ugame'
  const identity = { root: '/wc', uuid: 'repo-uuid', url: `${root}/dev`, repositoryRoot: 'https://example.test/svn', revision: 1, depth: 'infinity' }
  const workspace = vue.reactive({ currentPath: '/wc', epoch: 0 })
  const storage = new Map()
  const calls = []
  const api = {
    repositoryIdentity: async () => identity,
    repositoryList: async (path, url) => { calls.push(url); throw new Error(`svn: E175013: Access to '${url}' forbidden`) },
    repositoryBranch: async (_path, url) => ({ url, name: url.split('/').pop(), kind: 'dir' }),
    assetStashList: async () => [{ id: 'stash', phase: 'complete' }],
    ...overrides,
  }
  const mocks = {
    vue: { ...vue, watch() {} },
    pinia: { defineStore: (_name, setup) => () => vue.reactive(setup()) },
    '@tauri-apps/api/event': { listen: async () => () => {} },
    '@/api/workflows': api,
    '@/utils/branches': (() => { const context = { exports: {}, URL }; vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/utils/branches.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, context); return context.exports })(),
    './workspace': { useWorkspaceStore: () => workspace },
    '@/composables/useWorkspace': { useWorkspace: () => ({ refreshStatusAfterMutation }) },
  }
  const context = { exports: {}, localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }, require: name => { assert.ok(name in mocks, name); return mocks[name] } }
  const code = ts.transpileModule(fs.readFileSync('src/stores/workflows.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  vm.runInNewContext(code, context)
  return { flow: context.exports.useWorkflowStore(), root, identity, workspace, calls, storage }
}

test('denied parent listing retains current branch, local stashes, and attempted directory', async () => {
  const h = harness()
  await h.flow.refresh()
  assert.equal(h.flow.identity.url, `${h.root}/dev`)
  assert.equal(h.flow.knownBranches[0].url, `${h.root}/dev`)
  assert.equal(h.flow.browserUrl, h.root)
  assert.equal(h.flow.branchAccessDenied, true)
  assert.equal(h.flow.error, '')
  assert.equal(h.flow.stashes[0].id, 'stash')
  await h.flow.refresh()
  assert.equal(h.calls.length, 1, 'background refresh does not repeat a denied listing')
  await h.flow.refresh(true)
  assert.equal(h.calls.length, 2, 'explicit refresh retries access')
})

test('an accessible branch can be added without listing its forbidden parent', async () => {
  const h = harness()
  await h.flow.refresh()
  await h.flow.addBranch(`  ${h.root}/publish  `)
  assert.equal(h.flow.knownBranches.length, 2)
  assert.ok(h.flow.knownBranches.some(branch => branch.url === `${h.root}/publish`))
  assert.equal(h.calls.length, 1)
  assert.match(h.storage.get('orcasvn-known-branches-repo-uuid'), /publish/)
  await h.flow.refresh()
  assert.equal(h.flow.knownBranches.length, 2)
})

test('a rejected branch is not persisted, and a late listing cannot replace newer results', async () => {
  let completeOld
  const h = harness({
    repositoryBranch: async () => { throw new Error('Different repository UUID') },
    repositoryList: async (_path, url) => url.endsWith('/old') ? new Promise(resolve => { completeOld = resolve }) : [{ name: 'new', url: `${url}/new`, kind: 'dir' }],
  })
  await h.flow.refresh()
  await assert.rejects(h.flow.addBranch('https://other.test/branch'), /Different repository UUID/)
  assert.equal(h.flow.knownBranches.length, 1)
  const old = h.flow.browse(`${h.root}/old`)
  await h.flow.browse(`${h.root}/new`)
  completeOld([{ name: 'stale', url: 'https://example.test/stale', kind: 'dir' }])
  await old
  assert.equal(h.flow.branches[0].name, 'new')
  assert.equal(h.flow.branchError, '')
})


test('failed post-operation status refresh cannot leave workspace actions permanently busy', async () => {
  const h = harness({}, async () => { throw new Error('local refresh failed') })
  await assert.rejects(h.flow.perform('synthetic operation', async () => 'completed'), /local refresh failed/)
  assert.equal(h.flow.busy, false)
})

test('remote branch refresh cannot keep a finished local operation busy', async () => {
  let finishIdentity
  const h = harness({ repositoryIdentity: () => new Promise(resolve => { finishIdentity = resolve }) })
  const completed = h.flow.perform('synthetic operation', async () => 'completed')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.flow.busy, false)
  finishIdentity(h.identity)
  await completed
})

test('a stalled parent listing does not block identity, saved branches or stashes', async () => {
  const h = harness({ repositoryList: () => new Promise(() => {}) })
  h.storage.set('orcasvn-favorite-branches-repo-uuid', JSON.stringify([`${h.root}/dev/`, `${h.root}/publish`]))
  await h.flow.refresh()
  assert.equal(h.flow.directoryLoading, true)
  assert.equal(h.flow.stashes.length, 1)
  assert.equal(h.flow.knownBranches.length, 2)
  await h.flow.addBranch(`${h.root}/publish/`)
  assert.equal(h.flow.knownBranches.length, 2)
})

test('unfavoriting retains a saved branch and removing it does not delete the current branch', async () => {
  const h = harness()
  h.storage.set('orcasvn-favorite-branches-repo-uuid', JSON.stringify([`${h.root}/publish`]))
  await h.flow.refresh()
  h.flow.toggleFavorite(`${h.root}/publish`)
  assert.equal(h.flow.favorites.length, 0)
  assert.equal(h.flow.knownBranches.length, 2)
  h.flow.removeBranch(`${h.root}/publish`)
  assert.equal(h.flow.knownBranches.length, 1)
  h.flow.removeBranch(`${h.root}/dev`)
  assert.equal(h.flow.knownBranches.length, 1)
})

test('switching identities retains the old branch in the saved list', async () => {
  let current
  const h = harness({ repositoryIdentity: async () => current || h.identity })
  await h.flow.refresh()
  current = { ...h.identity, url: `${h.root}/publish` }
  await h.flow.refresh()
  assert.equal(h.flow.knownBranches.length, 2)
  assert.equal(h.flow.identity.url, `${h.root}/publish`)
  assert.ok(h.flow.knownBranches.some(entry => entry.url === `${h.root}/dev`))
})

test('late branch validation cannot save into a different workspace', async () => {
  let finish
  const h = harness({ repositoryBranch: (_path, url) => new Promise(resolve => { finish = () => resolve({ url, name: 'publish', kind: 'dir' }) }) })
  await h.flow.refresh()
  const pending = h.flow.addBranch(`${h.root}/publish`)
  h.workspace.currentPath = '/different'
  finish()
  await assert.rejects(pending, /Workspace changed/)
  assert.equal(h.flow.knownBranches.length, 1)
})
