const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')
const vue = require('vue')

test('revision folders retain original SVN paths and folder selection cannot open a diff', () => {
  const compile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const treeModule = { exports: {} }
  vm.runInNewContext(compile(fs.readFileSync('src/utils/changeTree.ts', 'utf8')), treeModule)
  const props = vue.reactive({ paths: [
    { path: '/dev/Content/Map.umap', action: 'D' },
    { path: '/dev/Source/Game.cpp', action: 'M' },
    { path: '/dev/Source', action: 'M' },
  ] })
  const calls = []
  const mocks = { vue, '@/utils/changeTree': treeModule.exports }
  const script = fs.readFileSync('src/components/RevisionPathTree.vue', 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const scope = { exports: {}, defineProps: () => props, defineEmits: () => (...args) => calls.push(args), require: name => { assert.ok(name in mocks, name); return mocks[name] } }
  vm.runInNewContext(compile(script + '\nexports.state = { tree, selectNode, openNode };'), scope)
  const { tree, selectNode, openNode } = scope.exports.state
  assert.equal(tree.value[0].label, 'dev')
  selectNode(tree.value[0])
  openNode(tree.value[0])
  assert.deepEqual(calls, [])
  const content = tree.value[0].children.find(node => node.label === 'Content')
  selectNode(content.children[0])
  assert.equal(calls[0][1].path, '/dev/Content/Map.umap')
  assert.equal(calls[0][1].action, 'D')
  const source = tree.value[0].children.find(node => node.label === 'Source')
  assert.equal(source.children[0].original.path, '/dev/Source/Game.cpp')
  openNode(source)
  assert.equal(calls[1][1].path, '/dev/Source', 'a directory property change remains inspectable')
  props.paths.push({ path: '/', action: 'M' })
  assert.equal(tree.value[0].label, '/')
  selectNode(tree.value[0])
  assert.equal(calls[2][1].path, '/', 'repository root property changes remain visible')
})
