const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const css = fs.readFileSync('src/sourcegit-theme.css', 'utf8')
const luminance = hex => {
  const values = hex.slice(1).match(/../g).map(value => {
    const channel = parseInt(value, 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722
}
const contrast = (a, b) => {
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

for (const [name, selector] of [['light', 'html:root'], ['dark', 'html:root.theme-dark, html:root.dark']]) {
  test(`${name} reading text, selections and diff colors retain normal-text contrast`, () => {
    const block = css.slice(css.indexOf(selector + ' {')).split('}')[0]
    const colors = Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[\da-f]{6});/gi)].map(match => [match[1], match[2]]))
    const pairs = []
    for (const surface of ['surface', 'surface-container-lowest', 'surface-container-low', 'surface-container', 'surface-container-high', 'surface-container-highest']) {
      for (const text of ['on-surface', 'on-surface-variant']) pairs.push([`--md-sys-color-${text}`, `--md-sys-color-${surface}`])
    }
    pairs.push(['--md-sys-color-on-primary', '--md-sys-color-primary'], ['--md-sys-color-on-primary-container', '--md-sys-color-primary-container'])
    for (const kind of ['added', 'error', 'modified', 'unversioned']) pairs.push([`--app-color-status-${kind}-text`, `--app-color-status-${kind}-bg`])
    pairs.push(['--app-color-diff-meta-text', '--app-color-diff-meta-bg'])
    for (const [text, background] of pairs) {
      assert.ok(colors[text] && colors[background], `${name}: missing color for ${text} / ${background}`)
      const ratio = contrast(colors[text], colors[background])
      assert.ok(ratio >= 4.5, `${name}: ${text} / ${background} contrast is ${ratio.toFixed(2)}, expected at least 4.5`)
    }
  })
}
