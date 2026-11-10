import type { Conflict } from '@/api/workflows'

export interface ConflictRequest { workspace: string; branch: string; files: string[]; otherCount: number }
export type ConflictStrategy = 'working' | 'mine-full' | 'theirs-full'
export function selectedConflicts(workspace: string, root: string, files: string[], conflicts: Conflict[]) {
  const normalize = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')
  const full = normalize(workspace), base = normalize(root)
  const insensitive = /^[a-z]:\//i.test(base)
  const compare = (path: string) => insensitive ? path.toLowerCase() : path
  if (compare(full) !== compare(base) && !compare(full).startsWith(compare(base) + '/')) throw new Error('Workspace is outside the working-copy root')
  const prefix = full.slice(base.length).replace(/^\//, '')
  const paths = new Set(files.map(file => [prefix, file === '.' ? '' : normalize(file).replace(/^\.\//, '')].filter(Boolean).join('/') || '.'))
  return conflicts.filter(conflict => paths.has(conflict.path))
}
export function strategyAllowed(strategy: ConflictStrategy, conflicts: Conflict[], manual: boolean) {
  return conflicts.length > 0 && (conflicts.every(item => item.kind === 'content') || (strategy === 'working' && manual))
}
