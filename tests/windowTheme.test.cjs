const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')

const source = fs.readFileSync('src/composables/useTheme.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText

function harness(theme, desktop = true) {
  const settings = vue.reactive({ theme, accent: 'indigo' })
  const classes = new Set()
  const element = { classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) }, style: {}, dataset: {} }
  const body = { classList: { toggle() {} }, style: {} }
  const media = new Map()
  const calls = []
  const mocks = {
    vue,
    '@/composables/useSettings': { useSettings: () => ({ settings }) },
    '@tauri-apps/api/core': {
      isTauri: () => desktop,
      invoke: async (key, data) => calls.push(JSON.parse(JSON.stringify({ key, ...data }))),
    },
  }
  const context = {
    exports: {},
    require: name => mocks[name],
    window: { matchMedia: key => {
      const query = { matches: false, addEventListener: (_name, listener) => { query.change = listener } }
      media.set(key, query)
      return query
    } },
    document: { documentElement: element, body },
    getComputedStyle: () => ({ getPropertyValue: name => {
      const dark = classes.has('theme-dark')
      return name === '--source-titlebar' ? (dark ? '#101620' : '#e5eaf1') : (dark ? '#e9f1fb' : '#172435')
    } }),
  }
  vm.runInNewContext(compiled, context)
  const scope = vue.effectScope()
  scope.run(context.exports.initializeTheme)
  return {
    settings, classes, calls, stop: () => scope.stop(),
    colorScheme: value => { const query = media.get('(prefers-color-scheme: dark)'); query.matches = value; query.change() },
    forcedColors: value => { const query = media.get('(forced-colors: active)'); query.matches = value; query.change() },
  }
}

test('native caption uses the same palette as saved and live workbench appearance', () => {
  const h = harness('dark')
  assert.deepEqual(h.calls, [{ key: 'sync_window_chrome', dark: true, colors: { caption: 0x101620, text: 0xe9f1fb } }])
  h.settings.theme = 'light'
  assert.deepEqual(h.calls.at(-1), { key: 'sync_window_chrome', dark: false, colors: { caption: 0xe5eaf1, text: 0x172435 } })
  h.colorScheme(true)
  assert.equal(h.calls.length, 2, 'a manual theme ignores changes to the system scheme')
  h.settings.theme = 'auto'
  assert.deepEqual(h.calls.at(-1), { key: 'sync_window_chrome', dark: null, colors: { caption: 0x101620, text: 0xe9f1fb } })
  h.colorScheme(false)
  assert.equal(h.calls.at(-1).colors.caption, 0xe5eaf1)
  h.forcedColors(true)
  assert.deepEqual(h.calls.at(-1), { key: 'sync_window_chrome', dark: null, colors: null })
  h.forcedColors(false)
  assert.equal(h.calls.at(-1).colors.caption, 0xe5eaf1)
  h.stop()
})

test('browser preview changes its theme without issuing native commands', () => {
  const h = harness('dark', false)
  assert.ok(h.classes.has('theme-dark'))
  assert.deepEqual(h.calls, [])
  h.stop()
})
