import type { SvnStatus } from '../types'

export function stagingKey(path: string | null, url: string | undefined): string {
  if (!path || !url) return ''
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const windows = /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')
  return JSON.stringify([windows ? normalized.toLowerCase() : normalized, url])
}

export function canSelectForCommit(entry: SvnStatus, autoDeleteMissing = false): boolean {
  if (entry.status_code === 'conflicted' || entry.prop_status === 'conflicted') return false
  return ['modified', 'added', 'deleted', 'replaced', 'unversioned'].includes(entry.status_code)
    || (entry.status_code === 'missing' && autoDeleteMissing)
    || (['normal', 'none'].includes(entry.status_code) && entry.prop_status === 'modified')
}

export function replaceSelection(current: string[], selected: string[], scope: Set<string>): string[] {
  return [...new Set([...current.filter(path => !scope.has(path)), ...selected.filter(path => scope.has(path))])]
}
