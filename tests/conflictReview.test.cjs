const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
const settle = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const conflict = (path, kind = 'content') => ({ path, kind, details: '<info/>', versions: [] })
const status = (path, property = false) => ({
  path,
  status_code: property ? 'normal' : 'conflicted',
  prop_status: property ? 'conflicted' : 'none',
})
function harness(options = {}) {
  const workspace = vue.reactive({
    currentPath: '/fixture/wc',
    svnInfo: { url: 'file:///fixture/dev' },
    epoch: 0,
    historyEpoch: 0,
    statusList: options.status || (options.conflicts || []).map((item) => status(item.path)),
    error: null,
  })
  const calls = [],
    errors = [],
    unmount = [],
    activate = [],
    deactivate = [],
    queried = []
  let loads = 0,
    refreshes = 0
  const flow = vue.reactive({ busy: false, perform: async (_title, action) => action() })
  const api = {
    repositoryConflictDetail: async (path, file) => {
      loads++
      queried.push([path, file])
      const info = { root: path, url: workspace.svnInfo.url, ...options.identity }
      const prefix = path.slice(info.root.length).replace(/^\//, '')
      const relative = [prefix, file === '.' ? '' : file].filter(Boolean).join('/') || '.'
      const conflicts = options.load
        ? await options.load(loads, file, path)
        : options.conflicts || []
      return { identity: info, conflict: conflicts.find((item) => item.path === relative) || null }
    },
    repositoryResolve: async (...args) => {
      calls.push(args)
      return { error: null }
    },
  }
  const mocks = {
    vue: {
      ...vue,
      onBeforeUnmount: (fn) => unmount.push(fn),
      onActivated: (fn) => activate.push(fn),
      onDeactivated: (fn) => deactivate.push(fn),
    },
    'vue-i18n': { useI18n: () => ({ t: (key) => key }) },
    'element-plus': {
      ElMessage: { error: (text) => errors.push(text) },
      ElMessageBox: { confirm: options.confirm || (async () => {}) },
    },
    '@/stores/workspace': { useWorkspaceStore: () => workspace },
    '@/stores/workflows': { useWorkflowStore: () => flow },
    '@/composables/useWorkspace': {
      useWorkspace: () => ({
        refreshStatus: async () => {
          refreshes++
          return options.refresh ? options.refresh(workspace) : true
        },
      }),
    },
    '@/api/workflows': api,
    '@/api/svn': { revealWorkspaceFile: async () => {} },
    '@/components/ConflictExplanation.vue': { default: {} },
    '@/components/ConflictResolutionDialog.vue': { default: {} },
  }
  const props = vue.reactive({
    file: options.file || workspace.statusList[0]?.path || '',
    visible: true,
  })
  const events = []
  mocks['@/composables/useExternalTool'] = { useExternalTool: () => ({ open: async () => {} }) }
  const source = fs
    .readFileSync('src/components/ConflictInspector.vue', 'utf8')
    .match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const compiled = ts.transpileModule(
    source +
      '\nexports.state = { conflicts, selected, loading, canResolve, error, load, openResolution };',
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
  ).outputText
  const context = {
    exports: {},
    defineProps: () => props,
    defineEmits:
      () =>
      (...args) =>
        events.push(args),
    require: (name) => {
      assert.ok(name in mocks, name)
      return mocks[name]
    },
  }
  const scope = vue.effectScope()
  scope.run(() => vm.runInNewContext(compiled, context))
  return {
    ...context.exports.state,
    workspace,
    props,
    events,
    flow,
    calls,
    errors,
    queried,
    activate: () => activate.forEach((fn) => fn()),
    deactivate: () => deactivate.forEach((fn) => fn()),
    loads: () => loads,
    refreshes: () => refreshes,
    stop: () => {
      unmount.forEach((fn) => fn())
      scope.stop()
    },
  }
}
test('known conflict paths are visible before details arrive and cannot be resolved', async () => {
  const pending = deferred(),
    h = harness({ status: [status('Content/example.uasset')], load: () => pending.promise })
  assert.equal(h.conflicts.value[0].path, 'Content/example.uasset')
  assert.equal(h.canResolve.value, false)
  h.openResolution()
  assert.equal(h.calls.length, 0)
  pending.resolve([conflict('Content/example.uasset')])
  await settle()
  assert.equal(h.conflicts.value.length, 1)
  assert.equal(h.canResolve.value, true)
  h.stop()
})
test('a status-only conflict stays visible when details exclude external working copies', async () => {
  const h = harness({ status: [status('external/text.txt')] })
  await settle()
  assert.equal(h.conflicts.value[0].path, 'external/text.txt')
  assert.equal(h.selected.value.confirmed, false)
  assert.equal(h.loading.value, false)
  assert.equal(h.canResolve.value, false)
  h.stop()
})
test('detail query failure preserves every known path and exposes the error', async () => {
  const h = harness({
    status: [status('a.txt'), status('b.txt', true)],
    load: async () => {
      throw new Error('detail query failed')
    },
  })
  await settle()
  assert.equal(h.conflicts.value.length, 2)
  assert.equal(h.conflicts.value.find((c) => c.path === 'b.txt').kind, 'property')
  assert.match(h.error.value, /detail query failed/)
  assert.equal(h.canResolve.value, false)
  h.stop()
})
test('an empty page needs no query and late status loads only the selected path', async () => {
  const h = harness({ file: 'late.txt', load: () => [conflict('late.txt', 'tree')] })
  await settle()
  assert.equal(h.loads(), 0)
  h.workspace.statusList = [status('late.txt')]
  await settle()
  assert.equal(h.loads(), 1)
  assert.equal(h.selected.value.kind, 'tree')
  assert.equal(h.selected.value.confirmed, true)
  h.workspace.epoch++
  await settle()
  assert.equal(h.loads(), 2)
  h.stop()
})
test('unrelated status changes do not repeat conflict detail scans', async () => {
  const h = harness({ status: [status('a.txt')] })
  await settle()
  h.workspace.statusList = [status('a.txt'), { path: 'other.txt', status_code: 'modified' }]
  await settle()
  assert.equal(h.loads(), 1)
  h.stop()
})
test('subdirectory paths are mapped to the working-copy root without duplicate entries', async () => {
  const h = harness({
    identity: { root: '/fixture' },
    status: [status('Content/a.txt')],
    conflicts: [conflict('wc/Content/a.txt')],
  })
  await settle()
  assert.equal(h.conflicts.value.length, 1)
  assert.equal(h.selected.value.path, 'Content/a.txt')
  h.openResolution('mine-full')
  assert.equal(h.events.at(-1)[0], 'resolve')
  assert.equal(h.events.at(-1)[1], 'mine-full')
  assert.equal(h.calls.length, 0)
  h.stop()
})
test('late responses and errors from another working copy never replace current results', async () => {
  for (const reject of [false, true]) {
    const pending = deferred(),
      h = harness({
        status: [status('old.txt')],
        load: (n) => (n === 1 ? pending.promise : [conflict('new.txt')]),
      })
    h.workspace.currentPath = '/fixture/other'
    h.workspace.statusList = [status('new.txt')]
    h.props.file = 'new.txt'
    await settle()
    if (reject) pending.reject(new Error('old error'))
    else pending.resolve([conflict('old.txt')])
    await settle()
    assert.equal(h.selected.value.path, 'new.txt')
    assert.equal(h.error.value, '')
    h.stop()
  }
})
test('a hidden inspector cannot launch a resolution', async () => {
  const h = harness({ conflicts: [conflict('a.txt')] })
  await settle()
  h.props.visible = false
  await settle()
  h.openResolution('working')
  assert.equal(h.events.length, 0)
  h.stop()
  h.openResolution('working')
  assert.equal(h.events.length, 0)
})
test('returning to the conflict view retains selection and details without loading or querying', async () => {
  const h = harness({ conflicts: [conflict('a.txt'), conflict('b.txt')] })
  await settle()
  assert.deepEqual(h.queried, [['/fixture/wc', 'a.txt']])
  h.props.file = 'b.txt'
  await settle()
  assert.equal(h.loads(), 2)
  h.deactivate()
  h.activate()
  assert.equal(h.loading.value, false)
  assert.equal(h.selected.value.path, 'b.txt')
  assert.equal(h.canResolve.value, true)
  await settle()
  assert.equal(h.loads(), 2)
  h.props.file = 'a.txt'
  await settle()
  assert.equal(h.loads(), 2)
  h.stop()
})
test('leaving and returning during an initial query reuses its in-flight request', async () => {
  const pending = deferred(),
    h = harness({ status: [status('a.txt')], load: () => pending.promise })
  h.deactivate()
  h.activate()
  assert.equal(h.loads(), 1)
  pending.resolve([conflict('a.txt')])
  await settle()
  assert.equal(h.canResolve.value, true)
  assert.equal(h.loading.value, false)
  h.stop()
})
test('a hidden conflict view invalidates old details but defers querying until it becomes active', async () => {
  const h = harness({ conflicts: [conflict('a.txt')] })
  await settle()
  h.deactivate()
  h.workspace.historyEpoch++
  await settle()
  assert.equal(h.loads(), 1)
  assert.equal(h.canResolve.value, false)
  h.activate()
  await settle()
  assert.equal(h.loads(), 2)
  assert.equal(h.canResolve.value, true)
  h.stop()
})
test('a late detail response from another selection does not replace or unblock the current one', async () => {
  const a = deferred(),
    b = deferred(),
    h = harness({
      status: [status('a.txt'), status('b.txt')],
      load: (_n, file) => (file === 'a.txt' ? a.promise : b.promise),
    })
  h.props.file = 'b.txt'
  await settle()
  a.resolve([conflict('a.txt')])
  await settle()
  assert.equal(h.selected.value.path, 'b.txt')
  assert.equal(h.loading.value, true)
  assert.equal(h.canResolve.value, false)
  b.resolve([conflict('b.txt')])
  await settle()
  assert.equal(h.loading.value, false)
  assert.equal(h.canResolve.value, true)
  h.stop()
})
test('both conflict and local changes routes use the same cached workspace component', () => {
  const router = fs.readFileSync('src/router/index.ts', 'utf8')
  assert.match(router, /name: 'conflicts',[\s\S]*?import\('@\/views\/WorkspaceView.vue'\)/)
  assert.equal(fs.existsSync('src/views/ConflictsView.vue'), false)
})
