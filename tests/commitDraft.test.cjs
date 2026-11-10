const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
const vue = require('vue')

function load(path, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const context = { exports: {}, ...globals }
  vm.runInNewContext(code, context)
  return context.exports
}
const message = load('src/utils/commitMessage.ts')
const staging = load('src/utils/staging.ts')
function harness(storage = new Map()) {
  const workspace = vue.reactive({ currentPath: 'F:/Work/Game', svnInfo: { url: 'file:///repo/dev' } })
  const mocks = { vue, pinia: { defineStore: (_id, setup) => () => vue.reactive(setup()) }, './workspace': { useWorkspaceStore: () => workspace }, '@/utils/staging': staging, '@/utils/commitMessage': message }
  const localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }
  const module = load('src/stores/commitDraft.ts', { localStorage, require: name => { assert.ok(name in mocks, name); return mocks[name] } })
  return { draft: module.useCommitDraftStore(), workspace, storage }
}

test('SVN message contains a required subject and an optional multiline description', () => {
  assert.equal(message.composeCommitMessage(' 修复地图 ', ' 修改出生点\r\n补充验证说明 '), '修复地图\n\n修改出生点\n补充验证说明')
  assert.equal(message.composeCommitMessage('只有标题', ''), '只有标题')
  assert.equal(message.composeCommitMessage(' \n ', '只有描述'), '')
  assert.equal(message.composeCommitMessage('pasted\nsubject', 'details'), 'pasted subject\n\ndetails')
})

test('legacy full messages and recent messages retain their body when split', () => {
  for (const original of ['subject', 'subject\n\nfirst line\nsecond line', 'subject\nbody without blank separator']) {
    const parts = message.splitCommitMessage(original)
    const composed = message.composeCommitMessage(parts.subject, parts.description)
    assert.ok(composed.startsWith('subject'))
    if (original.includes('second line')) assert.equal(parts.description, 'first line\nsecond line')
    if (original.endsWith('blank separator')) assert.equal(parts.description, 'body without blank separator')
  }
})

test('subject and description persist together and remain isolated by branch and workspace', () => {
  const h = harness()
  h.draft.subject = 'dev 标题'
  h.draft.description = 'dev 描述'
  const reopened = harness(h.storage)
  assert.equal(reopened.draft.message, 'dev 标题\n\ndev 描述')
  h.workspace.svnInfo.url = 'file:///repo/publish'
  assert.equal(h.draft.message, '')
  h.draft.subject = 'publish title'
  h.workspace.svnInfo.url = 'file:///repo/dev'
  assert.equal(h.draft.message, 'dev 标题\n\ndev 描述')
  h.workspace.currentPath = 'F:/Work/Other'
  assert.equal(h.draft.message, '')
})

test('successful commit clears only the unchanged submitted draft', () => {
  const h = harness()
  h.draft.loadMessage('subject\n\noriginal body')
  const originalKey = h.draft.key, submitted = h.draft.message
  h.draft.description = 'new edits while committing'
  h.draft.clearIfUnchanged(originalKey, submitted)
  assert.equal(h.draft.description, 'new edits while committing')
  h.workspace.svnInfo.url = 'file:///repo/publish'
  h.draft.subject = 'publish draft'
  h.draft.clearIfUnchanged(originalKey, 'subject\n\nnew edits while committing')
  assert.equal(h.draft.subject, 'publish draft')
  h.workspace.svnInfo.url = 'file:///repo/dev'
  assert.equal(h.draft.message, '')
})
