import type { SvnLogEntry } from '@/types'

export interface HistorySnapshot {
  entries: SvnLogEntry[]
  nextCursor: number | undefined
  hasMore: boolean
}

// Keep loaded history for open repositories without persisting large log payloads.
// Remote changes become visible through an explicit refresh or local operation.
const snapshots = new Map<string, HistorySnapshot>()
const MAX_CONTEXTS = 12
export function historyCacheKey(path: string, source: string, filters: Record<string, string>) {
  return JSON.stringify([
    path,
    source,
    filters.keyword.trim(),
    filters.author.trim(),
    filters.dateFrom,
    filters.dateTo,
  ])
}
export function getHistorySnapshot(key: string): HistorySnapshot | undefined {
  const value = snapshots.get(key)
  if (value) {
    snapshots.delete(key)
    snapshots.set(key, value)
  }
  return value
}
export function setHistorySnapshot(key: string, value: HistorySnapshot) {
  snapshots.delete(key)
  snapshots.set(key, value)
  while (snapshots.size > MAX_CONTEXTS) snapshots.delete(snapshots.keys().next().value!)
}
export function invalidateHistoryForSource(path: string, source: string) {
  const prefix = JSON.stringify([path, source]).slice(0, -1) + ','
  for (const key of snapshots.keys()) if (key.startsWith(prefix)) snapshots.delete(key)
}

// Revision properties are repository-wide, including copied path histories.
export function invalidateAllHistorySnapshots() { snapshots.clear() }
