import type { SvnStatus } from '../types'

export const normalizePath = (path: string) => path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
export const isWithinDirectory = (path: string, directory: string) => {
  const target = normalizePath(path)
  const parent = normalizePath(directory)
  return !parent || parent === '.' || target === parent || target.startsWith(`${parent}/`)
}
export interface ChangeNode {
  path: string
  label: string
  entry?: SvnStatus
  children: ChangeNode[]
  targets: string[]
}
export function buildChangeTree(entries: SvnStatus[], scope = ''): ChangeNode[] {
  const root: ChangeNode = { path: scope || '.', label: scope || '.', children: [], targets: [] }
  const nodes = new Map<string, ChangeNode>([[normalizePath(scope) || '.', root]])
  const ensure = (path: string): ChangeNode => {
    const existing = nodes.get(path)
    if (existing) return existing
    const split = path.lastIndexOf('/')
    const parent = split < 0 ? root : ensure(path.slice(0, split))
    const node: ChangeNode = { path, label: path.slice(split + 1), children: [], targets: [] }
    nodes.set(path, node)
    parent.children.push(node)
    return node
  }
  entries.filter(entry => isWithinDirectory(entry.path, scope)).forEach(entry => {
    ensure(normalizePath(entry.path)).entry = entry
  })
  const finish = (node: ChangeNode): string[] => {
    node.children.sort((a, b) => Number(b.children.length > 0) - Number(a.children.length > 0) || a.label.localeCompare(b.label))
    node.targets = [...(node.entry ? [node.entry.path] : []), ...node.children.flatMap(finish)]
    return node.targets
  }
  finish(root)
  return root.targets.length ? [root] : []
}

export interface VisibleChangeRow {
  node: ChangeNode
  depth: number
  parent: string | null
  position: number
  siblings: number
}
export function flattenChangeTree(roots: ChangeNode[], collapsed: Set<string>): VisibleChangeRow[] {
  const rows: VisibleChangeRow[] = []
  const visit = (nodes: ChangeNode[], depth: number, parent: string | null) => {
    nodes.forEach((node, index) => {
      rows.push({ node, depth, parent, position: index + 1, siblings: nodes.length })
      if (!collapsed.has(node.path)) visit(node.children, depth + 1, node.path)
    })
  }
  // The implicit workspace root is omitted, except when it has its own property changes.
  for (const root of roots) {
    if (root.entry) visit([root], 0, null)
    else visit(root.children, 0, null)
  }
  return rows
}
