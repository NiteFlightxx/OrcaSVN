import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useWorkspaceStore } from './workspace'
import { useSettings } from '@/composables/useSettings'
import { canSelectForCommit, replaceSelection, stagingKey } from '@/utils/staging'

const STORAGE_KEY = 'orcasvn-submit-selection-v1'
function readSelections(): Record<string, string[]> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
    return Object.fromEntries(Object.entries(saved).filter(([key, value]) => key && Array.isArray(value) && value.every(path => typeof path === 'string')))
  } catch { return {} }
}

export const useStagingStore = defineStore('staging', () => {
  const workspace = useWorkspaceStore(), { settings } = useSettings()
  const selections = ref(readSelections())
  const key = computed(() => stagingKey(workspace.currentPath, workspace.svnInfo?.url))
  const paths = computed(() => key.value ? selections.value[key.value] || [] : [])
  const eligible = computed(() => (workspace.rawStatusList || workspace.statusList).filter(entry => canSelectForCommit(entry, settings.autoDeleteMissingOnCommit)))
  const ready = computed(() => Boolean(key.value) && workspace.rawStatusList !== null && !workspace.statusIsStale)
  function save(next: string[], selectionKey = key.value) {
    if (!selectionKey) return
    selections.value = { ...selections.value, [selectionKey]: [...new Set(next)] }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(selections.value)) } catch { /* Selection remains usable in this session. */ }
  }
  function stage(selected: string[]) {
    if (!ready.value) return
    const allowed = new Set(eligible.value.map(entry => entry.path))
    save([...paths.value, ...selected.filter(path => allowed.has(path))])
  }
  function unstage(selected: string[], selectionKey = key.value) {
    const removed = new Set(selected)
    save((selections.value[selectionKey] || []).filter(path => !removed.has(path)), selectionKey)
  }
  function replaceInScope(selected: string[], scope: string[]) {
    if (!ready.value) return
    const allowed = new Set(eligible.value.map(entry => entry.path))
    const visible = new Set(scope.filter(path => allowed.has(path)))
    save(replaceSelection(paths.value, selected, visible))
  }
  function clear() { save([]) }
  // Only fresh, unfiltered SVN results can prove that a staged path is now clean.
  watch([key, () => workspace.rawStatusList, () => workspace.statusIsStale, () => settings.autoDeleteMissingOnCommit], () => {
    if (!ready.value) return
    const available = new Set(eligible.value.map(entry => entry.path))
    const retained = paths.value.filter(path => available.has(path))
    if (retained.length !== paths.value.length) save(retained)
  }, { immediate: true })
  return { key, paths, eligible, ready, stage, unstage, replaceInScope, clear }
})
