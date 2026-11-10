const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
function load(path, globals = {}) { const context = { exports: {}, ...globals }; vm.runInNewContext(compile(fs.readFileSync(path, 'utf8')), context); return context.exports }
const tree = load('src/utils/changeTree.ts')
const selection = load('src/utils/changeSelection.ts')
const entry = path => ({ path, status_code: 'modified', prop_status: 'none' })
function treeHarness() {
  const props = vue.reactive({ entries: ['Content/A.txt', 'Content/B.txt', 'Source/Game.cpp'].map(entry), selectable: ['Content/A.txt', 'Content/B.txt', 'Source/Game.cpp'], staged: false, workspaceKey: 'fixture', filterKey: 'all', active: true, viewMode: 'tree', disabled: false, actionPending: false })
  const calls = []
  const mocks = { vue, 'vue-i18n': { useI18n: () => ({ t: key => key }) }, './VirtualViewport.vue': {}, '@/utils/changeTree': tree, '@/utils/changeSelection': selection, '@/composables/useSvnStatus': { getStatusClass: status => status, getStatusLabelKey: status => status } }
  const source = fs.readFileSync('src/components/WorkspaceChangeTree.vue', 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const context = { exports: {}, localStorage: { getItem: () => null, setItem() {} }, defineProps: () => props, defineExpose() {}, defineEmits: () => (...args) => { calls.push(args); if (args[0] === 'toggle-selection') props.entries = props.entries.filter(file => !args[1].includes(file.path)) }, require: name => { assert.ok(name in mocks, name); return mocks[name] } }
  const scope = vue.effectScope()
  scope.run(() => vm.runInNewContext(compile(source + '\nexports.actions = { rows, selectedRows, selectedTargets, selectNode, openContext, doubleClick, navigate, toggleFolder };'), context))
  return { ...context.exports.actions, props, calls, node(path) { return this.rows.value.find(row => row.node.path === path)?.node }, stop: () => scope.stop() }
}
test('single click selects a folder without expanding or staging and file click opens only its diff', () => {
  const h = treeHarness()
  const before = h.rows.value.length
  h.selectNode(h.node('Content'))
  assert.equal(h.rows.value.length, before)
  assert.deepEqual(Array.from(h.selectedTargets.value), ['Content/A.txt', 'Content/B.txt'])
  assert.equal(h.calls.filter(call => call[0] === 'select' || call[0] === 'toggle-selection').length, 0)
  h.selectNode(h.node('Content/A.txt'))
  assert.equal(h.calls.at(-1)[0], 'select')
  assert.equal(h.calls.at(-1)[1].path, 'Content/A.txt')
  h.stop()
})
test('Ctrl selection and Shift range use visible rows; folder and child targets are deduplicated', () => {
  const h = treeHarness()
  h.selectNode(h.node('Content/A.txt'))
  h.selectNode(h.node('Source/Game.cpp'), { ctrlKey: true })
  assert.deepEqual(Array.from(h.selectedTargets.value), ['Content/A.txt', 'Source/Game.cpp'])
  h.selectNode(h.node('Content/A.txt'))
  h.selectNode(h.node('Content/B.txt'), { shiftKey: true })
  assert.deepEqual(Array.from(h.selectedTargets.value), ['Content/A.txt', 'Content/B.txt'])
  h.selectNode(h.node('Content'), { ctrlKey: true })
  assert.deepEqual(Array.from(h.selectedTargets.value), ['Content/A.txt', 'Content/B.txt'])
  h.stop()
})
test('right-click preserves an existing multi-selection and switches to an unselected row', () => {
  const h = treeHarness(), pointer = { clientX: 1, clientY: 1 }
  h.selectNode(h.node('Content/A.txt'))
  h.selectNode(h.node('Content/B.txt'), { ctrlKey: true })
  h.openContext(pointer, h.node('Content/A.txt'))
  assert.deepEqual(Array.from(h.calls.at(-1)[4].targets), ['Content/A.txt', 'Content/B.txt'])
  assert.equal(h.calls.at(-1)[4].count, 2)
  h.openContext(pointer, h.node('Source/Game.cpp'))
  assert.deepEqual(Array.from(h.calls.at(-1)[4].targets), ['Source/Game.cpp'])
  h.stop()
})
test('double-click expands folders; file double-click stages and focuses a remaining change', async () => {
  const h = treeHarness()
  h.selectNode(h.node('Content'))
  h.doubleClick(h.node('Content'))
  assert.equal(h.rows.value.some(row => row.node.path === 'Content/A.txt'), false)
  assert.equal(h.calls.filter(call => call[0] === 'toggle-selection').length, 0)
  h.doubleClick(h.node('Content'))
  h.selectNode(h.node('Content/A.txt'))
  h.doubleClick(h.node('Content/A.txt'))
  await vue.nextTick()
  assert.deepEqual(Array.from(h.calls.find(call => call[0] === 'toggle-selection')[1]), ['Content/A.txt'])
  assert.deepEqual(Array.from(h.selectedTargets.value), ['Content/B.txt'])
  h.stop()
})
test('Enter and Space stage selected rows; Delete requests confirmation for the whole selection', async () => {
  for (const key of ['Enter', ' ']) {
    const h = treeHarness()
    h.selectNode(h.node('Content'))
    h.navigate({ key, preventDefault() {} }, h.rows.value.findIndex(row => row.node.path === 'Content'))
    assert.deepEqual(Array.from(h.calls.find(call => call[0] === 'toggle-selection')[1]), ['Content/A.txt', 'Content/B.txt'])
    await vue.nextTick()
    h.stop()
  }
  const h = treeHarness()
  h.selectNode(h.node('Content/A.txt'))
  h.selectNode(h.node('Content/B.txt'), { ctrlKey: true })
  h.navigate({ key: 'Delete', preventDefault() {} }, h.rows.value.findIndex(row => row.node.path === 'Content/B.txt'))
  assert.deepEqual(Array.from(h.calls.find(call => call[0] === 'discard-targets')[1]), ['Content/A.txt', 'Content/B.txt'])
  h.stop()
})
test('view changes retain file selection and filtering clears highlights without staging', async () => {
  const h = treeHarness()
  h.selectNode(h.node('Content'))
  h.props.viewMode = 'list'
  await vue.nextTick()
  assert.deepEqual(Array.from(h.selectedTargets.value), ['Content/A.txt', 'Content/B.txt'])
  assert.deepEqual(Array.from(h.rows.value.map(row => row.node.label)), ['Content/A.txt', 'Content/B.txt', 'Source/Game.cpp'])
  h.props.filterKey = 'only-source'
  await vue.nextTick()
  assert.equal(h.selectedRows.value.length, 0)
  h.selectNode(h.node('Content/B.txt'))
  h.props.active = false
  await vue.nextTick()
  assert.equal(h.selectedRows.value.length, 0)
  assert.equal(h.calls.filter(call => call[0] === 'toggle-selection').length, 0)
  h.stop()
})
test('persisted panel sizes reject malformed values and clamp overlarge settings', () => {
  const storage = new Map([['bad', 'NaN'], ['wide', '999999'], ['small', '5']])
  const utils = load('src/utils/changeSelection.ts', { localStorage: { getItem: key => storage.get(key) ?? null } })
  assert.equal(utils.readPanelSize('missing', 340, 240, 700), 340)
  assert.equal(utils.readPanelSize('bad', 340, 240, 700), 340)
  assert.equal(utils.readPanelSize('wide', 340, 240, 700), 700)
  assert.equal(utils.readPanelSize('small', 340, 240, 700), 240)
})


test('SourceGit full-path copy consumes its shortcut before document inspection handlers', () => {
  const h = treeHarness()
  h.selectNode(h.node('Content'))
  let stopped = false
  h.navigate({ key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true, preventDefault() {}, stopPropagation() { stopped = true } }, h.rows.value.findIndex(row => row.node.path === 'Content'))
  const copy = h.calls.find(call => call[0] === 'copy-paths')
  assert.deepEqual(Array.from(copy[1]), ['Content'])
  assert.equal(copy[2], true)
  assert.equal(stopped, true)
  h.stop()
})
