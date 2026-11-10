const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
const compiled = ts.transpileModule(fs.readFileSync('src/utils/changeTree.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const context = { exports: {} }
vm.runInNewContext(compiled, context)
const { buildChangeTree, isWithinDirectory, flattenChangeTree } = context.exports
const entry = (path) => ({ path, status_code: 'modified', prop_status: 'none' })
test('directory boundaries exclude similarly named siblings and normalize Windows paths', () => {
  assert.equal(isWithinDirectory('zhy/profiles-old/a', 'zhy/profiles'), false)
  assert.equal(isWithinDirectory('zhy/profiles/a', 'zhy/profiles/'), true)
  assert.equal(isWithinDirectory('zhy\\profiles\\a', 'zhy/profiles'), true)
})

test('visible rows retain hierarchy and original SVN targets while collapsed folders hide descendants', () => {
  const tree = buildChangeTree([entry('Content/Maps/Level.umap'), entry('Content/Blueprints/Player.uasset'), entry('Source\\Game.cpp')])
  const all = flattenChangeTree(tree, new Set())
  assert.deepEqual(Array.from(all, row => row.node.path), ['Content', 'Content/Blueprints', 'Content/Blueprints/Player.uasset', 'Content/Maps', 'Content/Maps/Level.umap', 'Source', 'Source/Game.cpp'])
  assert.equal(all[2].depth, 2)
  assert.equal(all[2].parent, 'Content/Blueprints')
  assert.equal(all[6].node.entry.path, 'Source\\Game.cpp')
  assert.deepEqual(Array.from(flattenChangeTree(tree, new Set(['Content'])), row => row.node.path), ['Content', 'Source', 'Source/Game.cpp'])
})

test('root and directory property changes remain actionable once each', () => {
  const root = { ...entry('.'), status_code: 'normal', prop_status: 'modified' }
  const tree = buildChangeTree([root, entry('Content'), entry('Content/Map.umap')])
  const rows = flattenChangeTree(tree, new Set())
  assert.equal(rows[0].node.entry, root)
  assert.equal(rows.filter(row => row.node.entry).length, 3)
  assert.equal(rows[1].node.targets.length, 2)
})
test('scoped tree preserves original target paths and directory property changes', () => {
  const tree = buildChangeTree([entry('zhy/profiles'), entry('zhy/profiles/a'), entry('zhy/profiles/nested/b'), entry('zhy/profiles-old/c')], 'zhy/profiles')
  assert.equal(tree.length, 1)
  assert.equal(tree[0].path, 'zhy/profiles')
  assert.equal(tree[0].targets.length, 3)
  assert.ok(tree[0].targets.includes('zhy/profiles'))
  assert.ok(!tree[0].targets.includes('zhy/profiles-old/c'))
  assert.equal(tree[0].children[0].path, 'zhy/profiles/nested')
})
test('root properties and nested changes each appear once; empty scope has no phantom targets', () => {
  const tree = buildChangeTree([entry('.'), entry('A/file'), entry('B/file')])
  assert.equal(tree[0].targets.length, 3)
  assert.equal(new Set(tree[0].targets).size, 3)
  assert.equal(buildChangeTree([entry('B/file')], 'A').length, 0)
})
