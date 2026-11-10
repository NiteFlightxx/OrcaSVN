import { repositoryUi } from '@/utils/repositoryUi'
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { listen } from '@tauri-apps/api/event'
import {
  repositoryIdentity,
  repositoryList,
  repositoryBranch,
  assetStashList,
  type Identity,
  type RepositoryEntry,
  type AssetStash,
  type OperationPlan,
} from '@/api/workflows'
import { useWorkspaceStore } from './workspace'
import { useWorkspace } from '@/composables/useWorkspace'
import {
  branchKey,
  branchName as nameFromUrl,
  normalizeBranchUrl,
  uniqueBranches,
} from '@/utils/branches'

export const useWorkflowStore = defineStore('workflows', () => {
  const workspace = useWorkspaceStore()
  const identity = ref<Identity | null>(null)
  const browsingUrl = ref('')
  const branches = ref<RepositoryEntry[]>([])
  const stashes = ref<AssetStash[]>([])
  const browserUrl = ref('')
  const error = ref('')
  const branchError = ref('')
  const branchAccessDenied = computed(() => /E175013|E170001|forbidden/i.test(branchError.value))
  const configuredBranches = ref<RepositoryEntry[]>([])
  const favorites = ref<string[]>([])
  const directoryLoading = ref(false)
  const switchRequest = ref<{ workspace: string; source: string; current: string } | null>(null)
  const knownBranches = computed(() =>
    uniqueBranches([
      ...(identity.value ? [{ url: identity.value.url, name: branchName.value, kind: 'dir' }] : []),
      ...configuredBranches.value,
      ...favorites.value.map((url) => ({ url, name: nameFromUrl(url), kind: 'dir' })),
    ])
  )
  const busy = ref(false)
  const phase = ref('completed')
  const commandOutput = ref('')
  const operationWorkspace = ref('')
  const refreshWarning = ref(false)
  void listen<{ workspace: string; text: string }>('svn-command-output', (event) => {
    if (
      busy.value &&
      event.payload.workspace.toLowerCase() === operationWorkspace.value.toLowerCase()
    )
      commandOutput.value = (commandOutput.value + event.payload.text).slice(-100_000)
  }).catch(() => {})
  const progress = ref<{ phase: string; file: string; current: number; total: number } | null>(null)
  void listen<{ phase: string; file: string; current: number; total: number }>(
    'workflow-progress',
    (event) => {
      progress.value = event.payload
    }
  ).catch(() => {})
  const title = ref('')
  const plan = ref<OperationPlan | null>(null)
  const activities = ref<
    { title: string; output: string; failed: boolean; time: string; undoId?: string }[]
  >([])
  const branchName = computed(() => (identity.value ? nameFromUrl(identity.value.url) : ''))
  let generation = 0
  let browseGeneration = 0
  function configureRoot(url: string) {
    if (!identity.value) return
    localStorage.setItem(`orcasvn-branch-root-${identity.value.uuid}`, url)
    browserUrl.value = url
  }
  function loadConfiguredBranches(uuid: string) {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(`orcasvn-known-branches-${uuid}`) || '[]'
      )
      configuredBranches.value = Array.isArray(saved)
        ? saved.filter(
            (entry): entry is RepositoryEntry =>
              Boolean(entry) &&
              typeof entry.url === 'string' &&
              typeof entry.name === 'string' &&
              entry.kind === 'dir'
          )
        : []
    } catch {
      configuredBranches.value = []
    }
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(`orcasvn-favorite-branches-${uuid}`) || '[]'
      )
      favorites.value = Array.isArray(saved)
        ? [...new Set(saved.filter((url): url is string => typeof url === 'string').map(branchKey))]
        : []
    } catch {
      favorites.value = []
    }
  }
  function rememberBranch(entry: RepositoryEntry) {
    const uuid = identity.value?.uuid
    if (!uuid) return
    configuredBranches.value = uniqueBranches([entry, ...configuredBranches.value])
    try {
      localStorage.setItem(
        `orcasvn-known-branches-${uuid}`,
        JSON.stringify(configuredBranches.value)
      )
    } catch {
      /* Keep the list usable in this session. */
    }
  }
  function toggleFavorite(url: string) {
    const uuid = identity.value?.uuid
    if (!uuid) return
    url = branchKey(url)
    rememberBranch(
      knownBranches.value.find((entry) => branchKey(entry.url) === url) || {
        url,
        name: nameFromUrl(url),
        kind: 'dir',
      }
    )
    favorites.value = favorites.value.includes(url)
      ? favorites.value.filter((value) => value !== url)
      : [...favorites.value, url]
    try {
      localStorage.setItem(`orcasvn-favorite-branches-${uuid}`, JSON.stringify(favorites.value))
    } catch {
      /* Keep the list usable in this session. */
    }
  }
  function removeBranch(url: string) {
    if (!identity.value || branchKey(url) === branchKey(identity.value.url)) return
    configuredBranches.value = configuredBranches.value.filter(
      (entry) => branchKey(entry.url) !== branchKey(url)
    )
    try {
      localStorage.setItem(
        `orcasvn-known-branches-${identity.value.uuid}`,
        JSON.stringify(configuredBranches.value)
      )
    } catch {
      /* Keep the list usable in this session. */
    }
    favorites.value = favorites.value.filter((value) => value !== branchKey(url))
    try {
      localStorage.setItem(
        `orcasvn-favorite-branches-${identity.value.uuid}`,
        JSON.stringify(favorites.value)
      )
    } catch {
      /* Keep the list usable in this session. */
    }
  }
  async function addBranch(url: string) {
    const path = workspace.currentPath,
      uuid = identity.value?.uuid,
      request = generation
    if (!path || !uuid) return
    const entry = await repositoryBranch(path, normalizeBranchUrl(url))
    if (workspace.currentPath !== path || identity.value?.uuid !== uuid || request !== generation)
      throw new Error('Workspace changed; retry adding the branch')
    try {
      entry.name = decodeURIComponent(entry.name)
    } catch {
      /* retain encoded name */
    }
    rememberBranch(entry)
    return entry
  }
  async function browse(url: string) {
    const path = workspace.currentPath
    if (!path || !url) return
    const request = ++browseGeneration
    directoryLoading.value = true
    if (browserUrl.value !== url) branches.value = []
    browserUrl.value = url
    try {
      const entries = await repositoryList(path, url)
      if (request !== browseGeneration || workspace.currentPath !== path) return
      browserUrl.value = url
      branches.value = entries.filter((entry) => entry.kind === 'dir')
      branchError.value = ''
    } catch (e) {
      if (request === browseGeneration && workspace.currentPath === path)
        branchError.value = String(e)
    } finally {
      if (request === browseGeneration) directoryLoading.value = false
    }
  }
  async function refresh(retryBranches = false) {
    const path = workspace.currentPath
    const request = ++generation
    let identityVerified = false
    if (!path) {
      identity.value = null
      branches.value = []
      configuredBranches.value = []
      stashes.value = []
      browsingUrl.value = ''
      branchError.value = ''
      return
    }
    try {
      const next = await repositoryIdentity(path)
      if (request !== generation || workspace.currentPath !== path) return
      const changed = identity.value?.url !== next.url || identity.value?.root !== next.root
      identity.value = next
      error.value = ''
      loadConfiguredBranches(next.uuid)
      identityVerified = true
      if (changed) {
        browseGeneration++
        directoryLoading.value = false
        browsingUrl.value =
          repositoryUi(path).workingUrl === next.url
            ? repositoryUi(path).browsingUrl || next.url
            : next.url
        plan.value = null
      }
      rememberBranch({ url: next.url, name: nameFromUrl(next.url), kind: 'dir' })
      const parent = next.url.replace(/\/+$/, '').replace(/\/[^/]+$/, '')
      const configured = localStorage.getItem(`orcasvn-branch-root-${next.uuid}`)
      const nextBrowserUrl = changed || !browserUrl.value ? configured || parent : browserUrl.value
      if (retryBranches || !branchAccessDenied.value || browserUrl.value !== nextBrowserUrl)
        void browse(nextBrowserUrl)
      const records = await assetStashList(path)
      if (request === generation && workspace.currentPath === path)
        stashes.value = records.filter((s) => !['deleted', 'popped'].includes(s.phase))
    } catch (e) {
      if (request === generation) {
        if (!identityVerified) identity.value = null
        error.value = String(e)
      }
    }
  }
  async function perform<T>(
    name: string,
    operation: () => Promise<T>,
    mutation = true,
    refreshLocal = true
  ): Promise<T> {
    if (busy.value) throw new Error('Another operation is running')
    busy.value = true
    title.value = name
    progress.value = null
    phase.value = mutation ? 'executing' : 'checking'
    commandOutput.value = ''
    refreshWarning.value = false
    const path = workspace.currentPath
    operationWorkspace.value = path || ''
    let finalPhase = 'completed'
    try {
      const result = await operation()
      const failure =
        result && typeof result === 'object'
          ? (result as { error?: string; warning?: string }).error ||
            (result as { warning?: string }).warning
          : ''
      const operationResult = result as { id?: string; kind?: string; output?: string }
      const conflicts = (result as { conflicts?: string[] } | null)?.conflicts
      finalPhase = conflicts?.length ? 'conflicts' : failure ? 'failed' : 'completed'
      activities.value.unshift({
        title: name,
        output: typeof result === 'string' ? result : operationResult?.output || failure || name,
        failed: Boolean(failure),
        time: new Date().toLocaleString(),
        undoId:
          !failure && operationResult?.kind === 'cherry-pick' ? operationResult.id : undefined,
      })
      return result
    } catch (e) {
      finalPhase = 'failed'
      activities.value.unshift({
        title: name,
        output: String(e),
        failed: true,
        time: new Date().toLocaleString(),
      })
      throw e
    } finally {
      try {
        if (mutation && refreshLocal && workspace.currentPath === path) {
          phase.value = 'refreshing'
          try {
            refreshWarning.value = (await useWorkspace().refreshStatusAfterMutation()) === false
          } catch {
            refreshWarning.value = true
          }
        }
      } finally {
        // Read-only branch/stash refresh must not hold the writer UI gate, and
        // a failed local refresh must always release it. Staging still requires
        // a fresh local status before allowing workspace actions.
        activities.value = activities.value.slice(0, 30)
        busy.value = false
        phase.value = finalPhase
      }
      if (mutation && refreshLocal && workspace.currentPath === path) void refresh()
    }
  }
  watch(
    () => workspace.currentPath,
    () => {
      generation++
      browseGeneration++
      directoryLoading.value = false
      switchRequest.value = null
      identity.value = null
      branches.value = []
      configuredBranches.value = []
      favorites.value = []
      stashes.value = []
      browsingUrl.value = ''
      branchError.value = ''
      void refresh()
    },
    { immediate: true }
  )
  watch(
    () => workspace.epoch,
    () => {
      void refresh()
    }
  )
  return {
    identity,
    browsingUrl,
    branches,
    knownBranches,
    favorites,
    directoryLoading,
    switchRequest,
    stashes,
    browserUrl,
    branchName,
    error,
    branchError,
    branchAccessDenied,
    busy,
    title,
    phase,
    commandOutput,
    operationWorkspace,
    refreshWarning,
    plan,
    progress,
    activities,
    refresh,
    browse,
    configureRoot,
    addBranch,
    toggleFavorite,
    removeBranch,
    rememberBranch,
    perform,
  }
})
