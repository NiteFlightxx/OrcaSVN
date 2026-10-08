const { readVersions } = require('./validate-prerelease.cjs')

function validateRelease(tag, versions) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag || '')) {
    throw new Error('Use a stable release tag such as v0.6.3.')
  }
  const version = tag.slice(1)
  for (const [file, actual] of Object.entries(versions)) {
    if (actual !== version) throw new Error(`${file}: expected ${version}, found ${actual}`)
  }
  return version
}

if (require.main === module) {
  const version = validateRelease(process.env.RELEASE_TAG, readVersions())
  console.log(`Validated stable release ${version}`)
}

module.exports = { validateRelease }
