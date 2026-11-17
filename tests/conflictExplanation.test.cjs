const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
const locales = { exports: {} }
vm.runInNewContext(compile(fs.readFileSync('src/i18n/conflictExplanation.ts', 'utf8')), locales)
const messages = locales.exports.conflictExplanationLocales
const settle = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve
  const promise = new Promise((yes) => (resolve = yes))
  return { promise, resolve }
}
const fixture = () => ({
  path: 'Settings/Platform',
  kind: 'tree',
  versions: [],
  details: '<info/>',
  summary: {
    nodeKind: 'dir',
    localKind: 'dir',
    exists: true,
    schedule: 'delete',
    operation: 'update',
    action: 'add',
    reason: 'unversioned',
    base: null,
    incoming: { kind: 'dir', url: 'file:///synthetic/dev/Settings/Platform', revision: 21 },
  },
})
function harness(options = {}) {
  const props = vue.reactive({
    conflict: fixture(),
    workspace: '/fixture/wc',
    file: 'Settings/Platform',
    version: 'one',
  })
  const calls = [],
    unmount = []
  const t = (key, vars = {}) => {
    let value =
      key
        .replace(/^conflictReview\./, '')
        .split('.')
        .reduce((obj, key) => obj?.[key], messages['zh-CN']) || key
    for (const [key, v] of Object.entries(vars)) value = value.replaceAll('{' + key + '}', v)
    return value
  }
  const mocks = {
    vue: { ...vue, onBeforeUnmount: (fn) => unmount.push(fn) },
    'vue-i18n': { useI18n: () => ({ t }) },
    '@/api/workflows': {
      conflictChildren: async (...args) => {
        calls.push(args)
        return options.preview
          ? options.preview(...args)
          : { entries: [{ name: 'example.ini', kind: 'file' }], truncated: false }
      },
    },
  }
  const source = fs
    .readFileSync('src/components/ConflictExplanation.vue', 'utf8')
    .match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const context = {
    exports: {},
    defineProps: () => props,
    require: (name) => {
      assert.ok(name in mocks, name)
      return mocks[name]
    },
  }
  const scope = vue.effectScope()
  scope.run(() =>
    vm.runInNewContext(
      compile(source + '\nexports.state={title,label,info,previews,preview};'),
      context
    )
  )
  return {
    ...context.exports.state,
    props,
    calls,
    stop: () => {
      unmount.forEach((fn) => fn())
      scope.stop()
    },
  }
}
test('directory explanations distinguish the recorded obstruction from current pending deletion', () => {
  const h = harness()
  assert.equal(h.title.value, '目录结构冲突')
  assert.equal(h.label('reason', h.info.value.reason), '被判定为未版本化')
  assert.equal(h.label('schedule', h.info.value.schedule), '待删除')
  assert.equal(h.label('node', h.info.value.localKind), '目录')
  assert.equal(h.calls.length, 0)
  h.stop()
})
test('unknown metadata is not guessed and previews only run on explicit requests', async () => {
  const h = harness()
  h.props.conflict.summary = null
  assert.equal(h.label('schedule', 'future-value'), '信息不可用')
  assert.equal(h.calls.length, 0)
  await h.preview('local')
  await h.preview('local')
  assert.equal(h.calls.length, 1)
  assert.deepEqual(h.calls[0], ['/fixture/wc', 'Settings/Platform', 'local'])
  h.stop()
})
test('an in-flight directory preview is shared and a late response cannot replace another selection', async () => {
  const pending = deferred(),
    h = harness({ preview: () => pending.promise })
  const first = h.preview('incoming')
  await h.preview('incoming')
  assert.equal(h.calls.length, 1)
  h.props.file = 'Settings/Other'
  await settle()
  pending.resolve({ entries: [{ name: 'old.ini', kind: 'file' }], truncated: false })
  await first
  assert.equal(h.previews.value.incoming, undefined)
  h.stop()
})
test('preview errors are visible and can be retried without clearing the conflict', async () => {
  let attempts = 0
  const h = harness({
    preview: async () => {
      if (++attempts === 1) throw new Error('offline')
      return { entries: [], truncated: false }
    },
  })
  await h.preview('incoming')
  assert.match(h.previews.value.incoming.error, /offline/)
  assert.equal(h.props.conflict.path, 'Settings/Platform')
  await h.preview('incoming')
  assert.equal(h.calls.length, 2)
  assert.equal(h.previews.value.incoming.error, '')
  h.stop()
})
test('conflict explanation strings cover the same keys in all five locales', () => {
  const keys = (value, prefix = '') =>
    Object.entries(value)
      .flatMap(([key, v]) => (typeof v === 'string' ? [prefix + key] : keys(v, prefix + key + '.')))
      .sort()
  for (const locale of ['zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'en-US'])
    assert.deepEqual(keys(messages[locale]), keys(messages['en-US']))
})
