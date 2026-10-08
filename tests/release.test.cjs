const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateRelease } = require('../scripts/validate-release.cjs')

test('accepts stable release tags when package versions match', () => {
  assert.equal(validateRelease('v0.6.3', { npm: '0.6.3', cargo: '0.6.3', tauri: '0.6.3' }), '0.6.3')
})

test('rejects prerelease, malformed and leading-zero stable tags', () => {
  for (const tag of ['v0.6.3-rc.4', '0.6.3', 'v0.6', 'v00.6.3', 'v0.06.3', 'v0.6.03', undefined]) {
    assert.throws(() => validateRelease(tag, {}), /stable release tag/)
  }
})

test('rejects mismatched or missing versions before creating a stable release', () => {
  for (const actual of ['0.6.3-rc.4', '0.6.2', undefined]) {
    assert.throws(() => validateRelease('v0.6.3', { cargo: actual }), /cargo: expected/)
  }
})
