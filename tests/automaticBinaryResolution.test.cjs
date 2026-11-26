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
  const settings = vue.reactive({ binaryConflictPolicy: 'local', ...options.settings })
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
    '@/composables/useSettings': { useSettings: () => ({ settings }) },
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
    settings,
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


test('disabled automation preserves existing conflicts until enabled, independently of hiding', async () => {
  const path = 'Plugins/P/Binaries/a.dll'
  const h = harness({
    settings: { binaryConflictPolicy: 'off', hideUnstagedBinaries: true },
    workspace: { rawStatusList: [entry(path)] },
  })
  await settle()
  assert.equal(h.calls.length, 0)
  h.workspace.epoch++
  await settle()
  assert.deepEqual(h.workspace.rawStatusList.map(item => item.path), [path])
  assert.equal(h.calls.length, 0)
  h.settings.binaryConflictPolicy = 'local'
  await settle()
  assert.deepEqual(Array.from(h.calls[0][1]), [path])
  assert.equal(h.workspace.rawStatusList.length, 0)
  h.stop()
})

test('turning automation off during a batch applies its result and stops the next batch', async () => {
  let finish
  const resolveFirstBatch = new Promise(resolve => { finish = resolve })
  const h = harness({
    resolve: (_workspace, files) => files.length === 8 ? resolveFirstBatch :
      Promise.resolve({ resolved: files, failures: {}, status: { paths: files } }),
  })
  const paths = Array.from({ length: 9 }, (_, i) => 'Binaries/' + i + '.dll')
  h.workspace.rawStatusList = paths.map(path => entry(path))
  await settle()
  assert.equal(h.calls.length, 1)
  h.settings.binaryConflictPolicy = 'off'
  finish({ resolved: paths.slice(0, 8), failures: {}, status: { paths: paths.slice(0, 8) } })
  await settle()
  assert.equal(h.patches.length, 1)
  assert.equal(h.calls.length, 1)
  assert.deepEqual(h.workspace.rawStatusList.map(item => item.path), paths.slice(8))
  h.settings.binaryConflictPolicy = 'local'
  await settle()
  assert.equal(h.calls.length, 2)
  assert.deepEqual(Array.from(h.calls[1][1]), paths.slice(8))
  h.stop()
})


test('incoming resolves with its own policy and retries a conflict attempted under the local policy', async () => {
  const file = 'Binaries/Editor.dll'
  const h = harness({
    workspace: { rawStatusList: [entry(file)] },
    resolve: async (_workspace, files, _url, side) => side === 'incoming'
      ? { resolved: files, failures: {}, status: { paths: files } }
      : { resolved: [], failures: { [file]: 'local version unavailable' } },
  })
  await settle()
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0][3], 'local')
  h.settings.binaryConflictPolicy = 'incoming'
  await settle()
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1][3], 'incoming')
  assert.match(h.activities[1].result.output, /autoBinaryResolvedIncoming:1/)
  assert.equal(h.workspace.rawStatusList.length, 0)
  h.stop()
})

test('persisted conflict preferences migrate safely and retain all three new choices', async () => {
  const compiled = ts.transpileModule(fs.readFileSync('src/composables/useSettings.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  for (const [saved, expected] of [
    [{}, 'local'],
    [{ autoResolveBinaries: true }, 'local'],
    [{ autoResolveBinaries: false }, 'off'],
    [{ autoResolveBinaries: false, binaryConflictPolicy: 'unknown' }, 'off'],
    [{ autoResolveBinaries: false, binaryConflictPolicy: 'incoming' }, 'incoming'],
    [{ binaryConflictPolicy: 'off' }, 'off'],
    [{ binaryConflictPolicy: 'local' }, 'local'],
  ]) {
    let stored = JSON.stringify({ hideUnstagedBinaries: true, ...saved })
    const localStorage = { getItem: () => stored, setItem: (_key, value) => { stored = value } }
    const exports = {}
    const scope = vue.effectScope()
    scope.run(() => vm.runInNewContext(compiled, {
      exports, localStorage,
      require: name => name === 'vue' ? vue : { detectSystemLocale: () => 'en-US' },
    }))
    const { settings, updateSettings } = exports.useSettings()
    assert.equal(settings.binaryConflictPolicy, expected)
    assert.equal(settings.hideUnstagedBinaries, true)
    updateSettings({ binaryConflictPolicy: expected === 'incoming' ? 'off' : 'incoming' })
    await vue.nextTick()
    const savedAgain = JSON.parse(stored)
    assert.equal(savedAgain.binaryConflictPolicy, settings.binaryConflictPolicy)
    assert.equal(Object.hasOwn(savedAgain, 'autoResolveBinaries'), false)
    scope.stop()
  }
})
