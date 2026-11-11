const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const context = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/utils/historyPresentation.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context)
const { commitSubject, authorInitials, historySourceLabel, revisionDisplayPath } = context.exports

test('history subject shows only its first line and author marks use local Unicode initials', () => {
  assert.equal(commitSubject('Fix animation\r\n\r\nDetailed description'), 'Fix animation')
  assert.equal(commitSubject(''), '—')
  assert.equal(authorInitials('alice cooper'), 'AC')
  assert.equal(authorInitials('王林峰'), '王林')
  assert.equal(authorInitials(''), '?')
})

test('revision paths are relative only to their real browsing source', () => {
  const root = 'file:///repository'
  assert.equal(revisionDisplayPath('/dev/Source/Game.cpp', root + '/dev', root), 'Source/Game.cpp')
  assert.equal(revisionDisplayPath('/development/Source/Game.cpp', root + '/dev', root), 'development/Source/Game.cpp')
  assert.equal(revisionDisplayPath('/dev/A.cpp', 'file:///other/dev', root), 'dev/A.cpp')
  assert.equal(revisionDisplayPath('/', root, root), '/')
  assert.equal(historySourceLabel(root + '/%E5%BC%80%E5%8F%91/'), '开发')
})
