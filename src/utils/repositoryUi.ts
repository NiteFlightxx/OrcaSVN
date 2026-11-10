export interface RepositoryUiState {
  route: string
  query: Record<string, unknown>
  browsingUrl: string
  workingUrl?: string
  workspace?: { filter: string; query: string; selected: string | null; scroll: number[] }
  history?: {
    filters: Record<string, string>
    revision?: number
    page: number
    cursors: (number | undefined)[]
    scroll: number
  }
}
const states = new Map<string, RepositoryUiState>()
const storageKey = 'orcasvn-repository-ui-v1'
const routes = new Set([
  'workspace',
  'log',
  'stash',
  'update',
  'settings',
  'diff',
  'blame',
  'checkout',
])
try {
  const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]')
  if (Array.isArray(saved))
    for (const pair of saved.slice(-20)) {
      if (
        !Array.isArray(pair) ||
        typeof pair[0] !== 'string' ||
        !pair[1] ||
        !routes.has(pair[1].route)
      )
        continue
      const state = pair[1]
      if (typeof state.browsingUrl !== 'string' || !state.query || typeof state.query !== 'object')
        continue
      if (
        state.workspace &&
        (typeof state.workspace.query !== 'string' ||
          !['all', 'modified', 'added', 'conflicted', 'missing'].includes(state.workspace.filter) ||
          !Array.isArray(state.workspace.scroll) ||
          !state.workspace.scroll.every(
            (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
          ) ||
          (state.workspace.selected !== null && typeof state.workspace.selected !== 'string'))
      )
        delete state.workspace
      if (
        state.history &&
        (!state.history.filters ||
          !Object.values(state.history.filters).every((value) => typeof value === 'string') ||
          !Array.isArray(state.history.cursors) ||
          !Number.isSafeInteger(state.history.page) ||
          state.history.page < 0)
      )
        delete state.history
      states.set(pair[0], state)
    }
} catch {
  /* Corrupt settings must never prevent opening a repository. */
}
export function persistRepositoryUi() {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...states].slice(-20)))
  } catch {
    /* Keep session state in memory. */
  }
}
export function repositoryUi(path: string): RepositoryUiState {
  if (!states.has(path)) states.set(path, { route: 'workspace', query: {}, browsingUrl: '' })
  return states.get(path)!
}
export function reorderTabs(tabs: string[], from: string, to: string): string[] {
  if (from === to || !tabs.includes(from) || !tabs.includes(to)) return tabs
  const next = tabs.filter((path) => path !== from)
  next.splice(tabs.indexOf(to), 0, from)
  return next
}
export function tabsToClose(tabs: string[], target: string, kind: string): string[] {
  if (!tabs.includes(target)) return []
  return kind === 'others'
    ? tabs.filter((path) => path !== target)
    : tabs.slice(tabs.indexOf(target) + 1)
}
