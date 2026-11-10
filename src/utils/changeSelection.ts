import type { ChangeNode } from './changeTree'

export function selectChangeRows(visible: string[], selected: string[], clicked: string, anchor: string | null, additive = false, range = false) {
  if (!visible.includes(clicked)) return { selected, anchor }
  if (range && anchor && visible.includes(anchor)) {
    const from = visible.indexOf(anchor), to = visible.indexOf(clicked)
    const interval = visible.slice(Math.min(from, to), Math.max(from, to) + 1)
    return { selected: [...new Set([...(additive ? selected : []), ...interval])], anchor }
  }
  return {
    selected: additive ? selected.includes(clicked) ? selected.filter(path => path !== clicked) : [...selected, clicked] : [clicked],
    anchor: clicked,
  }
}

export function changeTargets(nodes: ChangeNode[], selected: string[]) {
  const wanted = new Set(selected)
  const paths = new Set<string>()
  const visit = (items: ChangeNode[]) => {
    for (const node of items) {
      if (wanted.has(node.path)) node.targets.forEach(path => paths.add(path))
      visit(node.children)
    }
  }
  visit(nodes)
  return [...paths]
}

export function readPanelSize(key: string, fallback: number, min: number, max: number) {
  try {
    const value = localStorage.getItem(key)
    const size = value === null ? fallback : Number(value)
    return Number.isFinite(size) ? Math.max(min, Math.min(max, size)) : fallback
  } catch { return fallback }
}
