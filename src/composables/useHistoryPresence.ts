import { onActivated, onDeactivated, onUnmounted, ref, watch, type Ref } from 'vue'
import { svnHistoryPresence, svnHistoryBaseFingerprint } from '@/api/svn'
import { useWorkspaceStore } from '@/stores/workspace'
import type { RevisionPresence, SvnLogEntry } from '@/types'

export function useHistoryPresence(
  entries: Readonly<Ref<SvnLogEntry[]>>,
  source: Readonly<Ref<string>>
) {
  const workspace = useWorkspaceStore()
  const rows = ref<Record<number, RevisionPresence>>({})
  const checking = ref(false)
  const error = ref('')
  const baseRevision = ref<number | null>(null)
  const scopeMatches = ref<boolean | null>(null)
  let generation = 0,
    active = true
  let baseFingerprint: string | null | undefined
  let fingerprintGeneration = 0

  async function refresh(reset = true) {
    const request = ++generation
    fingerprintGeneration++
    const path = workspace.currentPath,
      url = workspace.svnInfo?.url,
      epoch = workspace.epoch
    const requestedSource = source.value,
      page = entries.value
    if (reset) rows.value = {}
    error.value = ''
    if (reset) scopeMatches.value = null
    baseRevision.value = workspace.svnInfo?.revision ?? null
    checking.value = false
    if (!active || !path || !url || !page.length || workspace.isLoading) return
    if (scopeMatches.value === false && !reset) return
    const missing = page.filter((entry) => !rows.value[entry.revision])
    if (!missing.length) return
    checking.value = true
    const isCurrent = () =>
      active &&
      request === generation &&
      path === workspace.currentPath &&
      url === workspace.svnInfo?.url &&
      epoch === workspace.epoch &&
      source.value === requestedSource &&
      entries.value === page
    try {
      const result = await svnHistoryPresence(path, url, requestedSource, missing)
      if (!isCurrent() || result.workingUrl !== url) return
      baseRevision.value = result.baseRevision
      baseFingerprint = result.baseFingerprint
      scopeMatches.value = result.scopeMatches
      const revisions = new Set(page.map((entry) => entry.revision))
      rows.value = {
        ...rows.value,
        ...Object.fromEntries(
          result.rows.filter((row) => revisions.has(row.revision)).map((row) => [row.revision, row])
        ),
      }
    } catch (failure) {
      if (isCurrent()) error.value = String(failure)
    } finally {
      if (request === generation) checking.value = false
    }
  }
  watch(
    [
      source,
      () => workspace.currentPath,
      () => workspace.svnInfo?.url,
      () => workspace.svnInfo?.revision,
      () => workspace.epoch,
      () => workspace.isLoading,
    ],
    () => {
      void refresh()
    },
    { immediate: true }
  )
  watch(entries, () => {
    void refresh(false)
  })
  // A normal file edit does not change BASE. On status polls, check only three
  // database file attributes; reclassify if an external SVN operation changed it.
  watch(
    () => workspace.statusList,
    async () => {
      if (
        !active ||
        checking.value ||
        workspace.isLoading ||
        !workspace.currentPath ||
        !entries.value.length
      )
        return
      const path = workspace.currentPath,
        request = generation,
        check = ++fingerprintGeneration
      try {
        const current = await svnHistoryBaseFingerprint(path)
        if (
          active &&
          path === workspace.currentPath &&
          request === generation &&
          check === fingerprintGeneration &&
          (current == null || current !== baseFingerprint)
        )
          void refresh()
      } catch {
        if (
          active &&
          path === workspace.currentPath &&
          request === generation &&
          check === fingerprintGeneration
        )
          void refresh()
      }
    }
  )
  onActivated(() => {
    active = true
    void refresh()
  })
  const stop = () => {
    active = false
    generation++
    checking.value = false
  }
  onDeactivated(stop)
  onUnmounted(stop)
  const state = (revision: number): RevisionPresence['state'] | 'other' | 'checking' => {
    if (scopeMatches.value === false) return 'other'
    const row = rows.value[revision] as RevisionPresence | undefined
    return row ? row.state : checking.value ? 'checking' : 'unknown'
  }
  return { rows, checking, error, baseRevision, scopeMatches, state, refresh }
}
