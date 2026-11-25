const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
}
const entry = (path, prop_status = 'none') => ({ path, status_code: 'conflicted', prop_status })

function harness(options = {}) {
  const calls = [],
    patches = [],
    activities = [],
    refreshes = []
  const workspace = vue.reactive({
    currentPath: '/fixture/wc',
    svnInfo: { url: 'file:///fixture/dev' },
    rawStatusList: [],
    isLoading: false,
    statusIsStale: false,
    epoch: 0,
    historyEpoch: 0,
    ...options.workspace,
    setError(error) {
      this.error = error
    },
    setStatusIsStale(value) {
      this.statusIsStale = value
    },
  })
  const flow = vue.reactive({
    busy: false,
    refreshWarning: false,
    async perform(title, action, mutation, refresh) {
      assert.equal(mutation, true)
      assert.equal(refresh, false)
      this.busy = true
      try {
        const result = await action()
        activities.push({ title, result })
        return result
      } finally {
        this.busy = false
      }
    },
  })
  const mocks = {
    vue,
    'vue-i18n': {
      useI18n: () => ({ t: (key, params) => `${key}${params ? ':' + params.count : ''}` }),
    },
    '@/stores/workspace': { useWorkspaceStore: () => workspace },
    '@/stores/workflows': { useWorkflowStore: () => flow },
    '@/composables/useWorkspace': {
      useWorkspace: () => ({
        refreshStatusIfStale: async age => { refreshes.push(age) },
        applyStatusPatch: async (patch) => {
          patches.push(patch)
          workspace.rawStatusList = [
            ...workspace.rawStatusList.filter((item) => !patch.paths.includes(item.path)),
            ...(patch.entries || []),
          ]
          return true
        },
      }),
    },
    '@/api/workflows': {
      repositoryResolveBinaries: async (...args) => {
        calls.push(args)
        if (options.resolve) return options.resolve(...args)
        const resolved = args[1].filter(file => !file.endsWith('.txt'))
        return { resolved, failures: {}, status: { paths: resolved } }
      },
    },
  }
  const compiled = ts.transpileModule(
    fs.readFileSync('src/composables/useAutomaticBinaryResolution.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
  ).outputText
  const scope = vue.effectScope()
  const context = {
    exports: {},
    setTimeout: options.schedule || setImmediate,
    require: (name) => {
      assert.ok(mocks[name], name)
      return mocks[name]
    },
  }
  vm.runInNewContext(compiled, context)
  const stop = scope.run(() => context.exports.useAutomaticBinaryResolution())
  return {
    workspace,
    flow,
    calls,
    patches,
    activities,
    refreshes,
    stop: () => {
      stop()
      scope.stop()
    },
  }
}

test('automatic binary resolution waits for fresh idle status, processes directories and records results without a full scan', async () => {
  const h = harness({
    workspace: {
      isLoading: true,
      rawStatusList: [
        entry('Binaries/Win64/a.dll'),
        entry('Plugins/P/Binaries/b.so'),
        entry('Source/a.dll'),
        entry('Binaries/notes.txt', 'conflicted'),
        { ...entry('Binaries/property.dll', 'conflicted'), status_code: 'normal' },
      ],
    },
  })
  await settle()
  assert.equal(h.calls.length, 0)
  h.workspace.isLoading = false
  h.flow.busy = true
  await settle()
  assert.equal(h.calls.length, 0)
  h.flow.busy = false
  await settle()
  assert.deepEqual(
    Array.from(h.calls[0][1]),
    [
      'Binaries/Win64/a.dll',
      'Plugins/P/Binaries/b.so',
      'Binaries/notes.txt',
      'Binaries/property.dll',
    ]
  )
  assert.equal(h.calls.length, 1)
  assert.equal(h.patches.length, 1)
  assert.equal(h.activities.length, 1)
  assert.match(h.activities[0].result.output, /autoBinaryResolved:3/)
  assert.deepEqual(
    h.workspace.rawStatusList.map((item) => item.path),
    ['Source/a.dll', 'Binaries/notes.txt']
  )
  h.stop()
})

test('background refreshes keep skipped and failed paths quiet until an explicit refresh', async () => {
  const h = harness({
    resolve: async (_path, files) => {
      const resolved = files.filter(file => file.endsWith('good.dll'))
      return { resolved, failures: { 'Binaries/locked.dll': 'synthetic locked file' }, status: { paths: resolved } }
    },
  })
  h.workspace.rawStatusList = [
    entry('Binaries/good.dll'),
    entry('Binaries/locked.dll'),
    entry('Binaries/notes.txt'),
  ]
  await settle()
  assert.equal(h.calls.length, 1)
  assert.match(h.activities[0].result.error, /locked.dll/)
  assert.equal(h.workspace.rawStatusList.length, 2)
  h.flow.busy = true
  await settle()
  h.flow.busy = false
  await settle()
  assert.equal(h.calls.length, 1)
  h.workspace.rawStatusList = h.workspace.rawStatusList.map((item) => ({ ...item }))
  await settle()
  assert.equal(h.calls.length, 1)
  h.workspace.epoch++
  await settle()
  assert.equal(h.calls.length, 2)
  assert.deepEqual(Array.from(h.calls[1][1]), ['Binaries/locked.dll', 'Binaries/notes.txt'])
  h.stop()
})

test('subworkspace candidates include ancestor Binaries and stale snapshots cannot trigger writes', async () => {
  const h = harness({
    workspace: {
      currentPath: '/fixture/wc/Plugins/P/Binaries',
      statusIsStale: true,
      rawStatusList: [entry('Win64/a.dll')],
    },
  })
  await settle()
  assert.equal(h.calls.length, 0)
  h.workspace.statusIsStale = false
  await settle()
  assert.equal(h.calls.length, 1)
  h.stop()
  h.workspace.rawStatusList = [entry('Win64/b.dll')]
  await settle()
  assert.equal(h.calls.length, 1)
})

test('switching workspace while resolving stops the remaining batch and never patches the new workspace', async () => {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  const h = harness({ resolve: () => promise })
  h.workspace.rawStatusList = [entry('Binaries/a.dll'), entry('Binaries/b.dll')]
  await settle()
  assert.equal(h.calls.length, 1)
  h.workspace.currentPath = '/fixture/other'
  h.workspace.rawStatusList = []
  release({ resolved: ['Binaries/a.dll'], failures: {}, status: { paths: ['Binaries/a.dll'] } })
  await settle()
  assert.equal(h.calls.length, 1)
  assert.equal(h.patches.length, 0)
  h.stop()
})

test('a failed resolve whose status patch replaces the conflicted entry does not trigger an automatic retry loop', async () => {
  const h = harness({
    resolve: async (_path, [file]) => ({
      resolved: [],
      failures: { [file]: 'synthetic failure' },
      status: { paths: [file], entries: [entry(file)] },
    }),
  })
  h.workspace.rawStatusList = [entry('Binaries/locked.dll')]
  await settle()
  assert.equal(h.calls.length, 1)
  assert.equal(h.patches.length, 1)
  assert.match(h.activities[0].result.error, /synthetic failure/)
  assert.equal(h.workspace.rawStatusList[0].status_code, 'conflicted')
  h.stop()
})

test('large conflict lists release the workflow gate between bounded batches', async () => {
  const scheduled = []
  const h = harness({ schedule: callback => scheduled.push(callback) })
  h.workspace.rawStatusList = Array.from({ length: 11 }, (_, i) => entry(`Binaries/${i}.dll`))
  await settle()
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0][1].length, 8)
  assert.equal(h.patches.length, 1)
  assert.equal(h.flow.busy, false)
  h.flow.busy = true
  scheduled.shift()()
  await settle()
  assert.equal(h.calls.length, 1)
  h.flow.busy = false
  await settle()
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1][1].length, 3)
  assert.equal(h.patches.length, 2)
  scheduled.shift()()
  h.stop()
})

test('a write with unverified status schedules recovery without waiting for it', async () => {
  const h = harness({ resolve: async () => ({
    resolved: [], failures: { 'Binaries/a.dll': 'verification failed' }, verificationFailed: true,
  }) })
  h.workspace.rawStatusList = [entry('Binaries/a.dll')]
  await settle()
  assert.equal(h.flow.busy, false)
  assert.equal(h.workspace.statusIsStale, true)
  assert.deepEqual(h.refreshes, [0])
  assert.equal(h.patches.length, 0)
  h.stop()
})
