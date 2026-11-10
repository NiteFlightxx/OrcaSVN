import type { SvnStatus } from '@/types'
import type { DiscardStatusPatch } from '@/api/svn'

// An exact directory property query must never erase its children's changes.
// Structural queries replace their entire subtree, including collapsed paths.
export function mergeDiscardStatus(previous: SvnStatus[], patch: DiscardStatusPatch): SvnStatus[] {
  const exact = new Set(patch.paths)
  const subtrees = [...patch.subtrees, ...patch.entries
    .filter(entry => ['unversioned', 'missing'].includes(entry.status_code)).map(entry => entry.path)]
  const within = (path: string, parent: string) => parent === '.' || path === parent || path.startsWith(`${parent}/`)
  const entries = new Map(previous.filter(entry => !exact.has(entry.path)
    && !subtrees.some(parent => within(entry.path, parent))).map(entry => [entry.path, entry]))
  for (const entry of patch.entries) entries.set(entry.path, entry)
  return [...entries.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}
