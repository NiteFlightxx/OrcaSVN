const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')

const compiled = ts.transpileModule(fs.readFileSync('src/utils/devtoolsShortcuts.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText
const context = { exports: {} }
vm.runInNewContext(compiled, context)
const { blockDevtoolsShortcut } = context.exports

function dispatch(properties) {
  const event = {
    key: '', code: '', ctrlKey: false, shiftKey: false, metaKey: false, altKey: false,
    prevented: false, stopped: false,
    preventDefault() { this.prevented = true },
    stopImmediatePropagation() { this.stopped = true },
    ...properties,
  }
  blockDevtoolsShortcut(event)
  return [event.prevented, event.stopped]
}

test('blocks native and Tauri inspection shortcuts, including physical keys with a non-Latin layout', () => {
  for (const code of ['KeyI', 'KeyJ', 'KeyC']) {
    assert.deepEqual(dispatch({ code, key: '非', ctrlKey: true, shiftKey: true }), [true, true])
    assert.deepEqual(dispatch({ code, metaKey: true, altKey: true }), [true, true])
  }
  assert.deepEqual(dispatch({ key: 'F12' }), [true, true])
  assert.deepEqual(dispatch({ code: 'F12', ctrlKey: true }), [true, true])
})

test('preserves editing, escape, and unrelated shortcuts', () => {
  for (const code of ['KeyC', 'KeyV', 'KeyX', 'KeyA', 'KeyZ', 'KeyI']) {
    assert.deepEqual(dispatch({ code, ctrlKey: true }), [false, false])
    assert.deepEqual(dispatch({ code, metaKey: true }), [false, false])
  }
  assert.deepEqual(dispatch({ key: 'Escape', code: 'Escape' }), [false, false])
  assert.deepEqual(dispatch({ code: 'KeyZ', ctrlKey: true, shiftKey: true }), [false, false])
})
