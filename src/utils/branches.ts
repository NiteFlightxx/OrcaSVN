import type { RepositoryEntry } from '@/api/workflows'

export function branchKey(url: string): string { return url.trim().replace(/\/+$/, '') }
export function branchName(url: string): string {
  const value = branchKey(url).split('/').pop() || url
  try { return decodeURIComponent(value) } catch { return value }
}
export function normalizeBranchUrl(input: string): string {
  const markdown = input.trim().match(/^\[[^\]]+\]\(([^)]+)\)$/)
  const url = new URL(markdown ? markdown[1] : input.trim())
  if (!['https:', 'http:', 'svn:', 'svn+ssh:', 'file:'].includes(url.protocol)
    || url.password || url.search || url.hash) throw new Error('Invalid branch URL')
  return branchKey(url.toString())
}
export function uniqueBranches(entries: RepositoryEntry[]): RepositoryEntry[] {
  const result = new Map<string, RepositoryEntry>()
  for (const entry of entries) if (entry.kind === 'dir') {
    const url = branchKey(entry.url)
    if (!result.has(url)) result.set(url, { ...entry, url })
  }
  return [...result.values()]
}
export function switchFailure(error: unknown): { kind: 'changes' | 'access' | 'other'; paths: string[]; details: string } {
  const details = String(error)
  if (/Commit, stash or resolve these paths first:/.test(details)) {
    return { kind: 'changes', paths: details.split(/Commit, stash or resolve these paths first:\s*/)[1].split(/\r?\n/).filter(Boolean), details }
  }
  return { kind: /E175013|E170001|forbidden|authentication failed/i.test(details) ? 'access' : 'other', paths: [], details }
}
