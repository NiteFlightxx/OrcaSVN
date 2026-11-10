import { getDiffRows, indexDiff, type DiffRow } from './diffDocument'
export interface DiffPair {
  left: DiffRow | null
  right: DiffRow | null
  source: number
}
export function pairDiffRows(text: string): DiffPair[] {
  const index = indexDiff(text),
    rows = getDiffRows(text, index, 0, index.offsets.length),
    result: DiffPair[] = []
  for (let i = 0; i < rows.length; ) {
    if (rows[i].className === 'diff-removed' || rows[i].className === 'diff-added') {
      const left: DiffRow[] = [],
        right: DiffRow[] = []
      while (i < rows.length && ['diff-removed', 'diff-added'].includes(rows[i].className)) {
        ;(rows[i].className === 'diff-removed' ? left : right).push(rows[i++])
      }
      for (let j = 0; j < Math.max(left.length, right.length); j++)
        result.push({
          left: left[j] || null,
          right: right[j] || null,
          source: (left[j] || right[j]).index - 1,
        })
    } else {
      const row = rows[i++]
      result.push({ left: row, right: row, source: row.index - 1 })
    }
  }
  return result
}
export function snapshotDiff(base: string, saved: string): string {
  if (base === saved) return ''
  const old = base.split('\n'),
    next = saved.split('\n')
  let prefix = 0,
    suffix = 0
  while (prefix < old.length && prefix < next.length && old[prefix] === next[prefix]) prefix++
  while (
    suffix < old.length - prefix &&
    suffix < next.length - prefix &&
    old[old.length - suffix - 1] === next[next.length - suffix - 1]
  )
    suffix++
  const left = old.slice(prefix, old.length - suffix),
    right = next.slice(prefix, next.length - suffix)
  return `--- BASE\n+++ Saved\n@@ -${prefix + 1},${left.length} +${prefix + 1},${right.length} @@\n${left
    .map((line) => '-' + line)
    .concat(right.map((line) => '+' + line))
    .join('\n')}`
}
