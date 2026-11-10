<template>
  <div class="log-view" @click="contextVisible = false">
    <div class="log-branch-context"><span>{{ $t('flow.current') }}: {{ flow.identity?.url || workspaceStore.svnInfo?.url }}</span><span>{{ $t('flow.browsing') }}: {{ logSource }}</span><button v-if="scopedHistory" @click="router.replace({ name: 'log', query: {} })">{{ $t('fileMenu.branchHistory') }}</button></div>
    <div v-if="contextVisible" class="log-context" :style="{ left: `${contextX}px`, top: `${contextY}px` }" @click.stop>
      <button :disabled="flow.busy || scopedHistory" @click="cherryPick">{{ $t('flow.cherryPick') }}</button>
      <button @click="copyRevision">{{ $t('log.revision') }}</button>
    </div>
    <el-card class="log-card">
      <template #header>
        <div class="card-header">
          <span class="card-title">
            <el-icon><Document /></el-icon>
            {{ $t('log.title') }}
          </span>
        </div>
      </template>

      <div v-if="!workspaceStore.currentPath" class="no-workspace">
        <el-empty :description="$t('log.openWorkspaceFirst')">
          <template #image>
            <el-icon class="empty-icon"><Document /></el-icon>
          </template>
          <el-button type="primary" @click="openWorkspace">
            <el-icon><FolderOpened /></el-icon>
            {{ $t('common.open') }}
          </el-button>
        </el-empty>
      </div>

      <div v-else ref="logScroller" class="log-content">
        <div class="log-filters">
          <el-select
            v-model="filters.author"
            :placeholder="$t('log.searchAuthor')"
            class="author-select"
            filterable
            clearable
            :disabled="authorOptions.length === 0"
            size="small"
            value-on-clear=""
            @clear="clearAuthorFilter"
          >
            <el-option
              v-for="option in authorOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
          <el-input
            v-model="filters.keyword"
            :placeholder="$t('log.searchKeyword')"
            clearable
            size="small"
          />
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            format="YYYY/MM/DD"
            :start-placeholder="$t('log.dateFrom')"
            :end-placeholder="$t('log.dateTo')"
            range-separator="-"
            popper-class="log-date-range-dropdown"
            placement="bottom-end"
            :fallback-placements="['top-end', 'bottom-start', 'top-start']"
            class="log-date-range"
            clearable
            unlink-panels
            :editable="false"
            size="small"
          />
          <el-button type="primary" size="small" :loading="loading" @click="queryLogs">
            <el-icon><Search /></el-icon>
            {{ $t('log.query') }}
          </el-button>
          <el-button size="small" @click="resetFilters">
            <el-icon><RefreshLeft /></el-icon>
            {{ $t('common.reset') }}
          </el-button>
        </div>

        <div class="log-query-state">
          <span v-if="loading" class="query-status">
            <el-icon class="is-loading"><Loading /></el-icon>
            {{ $t('log.querying') }}
          </span>
          <span v-else>{{ logResultSummary }}</span>
          <el-tag v-if="hasActiveFilters" size="small" effect="plain" type="info">
            {{ $t('log.filtered') }}
          </el-tag>
        </div>

        <el-table
          :data="logs"
          v-loading="loading"
          :element-loading-text="$t('log.querying')"
          style="width: 100%"
          @row-click="handleRowClick"
          @row-contextmenu="contextMenu"
          row-key="revision"
          highlight-current-row
          class="log-table"
        >
          <el-table-column prop="message" :label="$t('log.commitMessage')" min-width="220">
            <template #default="{ row }">
              <span class="message-text" :title="row.message">{{ row.message }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="revision" :label="$t('log.revision')" width="90" sortable align="center">
            <template #default="{ row }">
              <el-tag type="primary" size="small" effect="plain">r{{ row.revision }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="author" :label="$t('log.author')" width="180">
            <template #default="{ row }">
              <div class="author-cell">
                <el-icon><User /></el-icon>
                <span :title="row.author">{{ row.author }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="date" :label="$t('log.date')" width="180" sortable>
            <template #default="{ row }">
              <div class="date-cell">
                <el-icon><Calendar /></el-icon>
                <span>{{ formatDate(row.date) }}</span>
              </div>
            </template>
          </el-table-column>

          <el-table-column
            :label="$t('log.changedFiles')"
            width="150"
            align="center"
            class-name="changed-files-column"
            label-class-name="changed-files-header"
          >
            <template #default="{ row }">
              <el-tag size="small" effect="plain">
                {{ row.changed_paths?.length || 0 }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
        <el-empty
          v-if="!loading && logs.length === 0"
          class="empty-log-result"
          :description="hasActiveFilters ? $t('log.noMatchedLogs') : $t('log.noLogs')"
        >
          <el-button v-if="hasActiveFilters" size="small" @click="resetFilters">
            <el-icon><RefreshLeft /></el-icon>
            {{ $t('log.clearFilters') }}
          </el-button>
        </el-empty>
        <div class="log-pagination">
          <el-button size="small" :disabled="loading || pageIndex === 0" @click="changePage(pageIndex - 1)">
            {{ $t('log.previousPage') }}
          </el-button>
          <span>{{ $t('log.pageNumber', { page: pageIndex + 1 }) }}</span>
          <el-button size="small" :disabled="loading || !hasMore" @click="changePage(pageIndex + 1)">
            {{ $t('log.nextPage') }}
          </el-button>
        </div>
      </div>

      <section v-if="dialogVisible" class="log-inspector">
        <div class="log-detail-actions"><el-button :disabled="flow.busy || scopedHistory || logSource === flow.identity?.url" @click="cherryPick">{{ $t('flow.cherryPick') }}</el-button><el-button @click="dialogVisible = false; onDialogClose()">{{ $t('common.close') }}</el-button></div>        <div v-if="selectedLog" class="log-detail">
          <el-descriptions :column="1" border class="detail-descriptions">
            <el-descriptions-item :label="$t('log.revision')">
              <el-tag type="primary" size="small">r{{ selectedLog.revision }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item :label="$t('log.author')">
              <div class="author-info">
                <el-icon><User /></el-icon>
                <span>{{ selectedLog.author }}</span>
              </div>
            </el-descriptions-item>
            <el-descriptions-item :label="$t('log.date')">
              <div class="date-info">
                <el-icon><Calendar /></el-icon>
                <span>{{ formatDate(selectedLog.date) }}</span>
              </div>
            </el-descriptions-item>
          </el-descriptions>

          <div class="commit-message-section">
            <h4 class="message-title">
              <el-icon><ChatLineSquare /></el-icon>
              {{ $t('log.commitMessage') }}
            </h4>
            <div class="commit-message">
              <pre>{{ selectedLog.message }}</pre>
            </div>
          </div>

          <div class="changed-files-section">
            <h4 class="message-title">
              <el-icon><Document /></el-icon>
              {{ $t('log.changedFiles') }}
            </h4>
            <el-table
              :data="selectedLog.changed_paths || []"
              max-height="260"
              stripe
              class="changed-files-table"
              @row-click="previewChangedPath"
              @row-dblclick="openChangedPathDiff"
            >
              <el-table-column :label="$t('commit.status')" width="96" align="center">
                <template #default="{ row }">
                  <el-tag size="small" :type="getActionTagType(row.action)">
                    {{ getActionLabel(row.action) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column :label="$t('commit.file')" show-overflow-tooltip>
                <template #default="{ row }">
                  <span class="file-path">{{ row.path }}</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
        
        <DiffViewer v-if="inlineDiff" :text="inlineDiff" compact />
      </section>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onUnmounted, reactive, ref, watch } from 'vue'
import { useWorkflowStore } from '@/stores/workflows'
import { repositoryPreview } from '@/api/workflows'
import { svnDiff } from '@/api/svn'
import { ElMessage } from 'element-plus'
import DiffViewer from '@/components/DiffViewer.vue'
import { writeClipboardText } from '@/utils/clipboard'
import { useWorkspaceStore } from '@/stores/workspace'
import { svnCurrentUser, svnLog } from '@/api/svn'
import type { SvnLogEntry, SvnLogPath } from '@/types'
import { useI18n } from 'vue-i18n'
import { useWorkspace } from '@/composables/useWorkspace'
import { useRouter, useRoute } from 'vue-router'

const { t, locale } = useI18n()
const router = useRouter()
const route = useRoute()
const workspaceStore = useWorkspaceStore()
const flow = useWorkflowStore()
const scopedHistory = computed(() => typeof route.query.target === 'string')
const logSource = computed(() => {
  if (typeof route.query.target === 'string' && route.query.workspace === workspaceStore.currentPath && route.query.branch === workspaceStore.svnInfo?.url) return route.query.target
  return flow.browsingUrl || workspaceStore.svnInfo?.url || workspaceStore.currentPath || ''
})
const inlineDiff = ref('')
const contextVisible = ref(false), contextX = ref(0), contextY = ref(0)
let diffGeneration = 0
function contextMenu(row: SvnLogEntry, _column: unknown, event: MouseEvent) {
  event.preventDefault(); selectedLog.value = row; dialogVisible.value = true
  contextX.value = Math.min(event.clientX, window.innerWidth - 250); contextY.value = Math.min(event.clientY, window.innerHeight - 100); contextVisible.value = true
}
async function copyRevision() { if (selectedLog.value) { await writeClipboardText(String(selectedLog.value.revision)); contextVisible.value = false } }
async function cherryPick() {
  contextVisible.value = false
  const path = workspaceStore.currentPath, revision = selectedLog.value?.revision, source = logSource.value
  if (!path || !revision || flow.busy || scopedHistory.value) return
  try { const result = await flow.perform(t('flow.cherryPick'), () => repositoryPreview(path, source, revision), false); if (path === workspaceStore.currentPath && source === logSource.value) flow.plan = result } catch (e) { ElMessage.error(String(e)) }
}
async function previewChangedPath(row: SvnLogPath) {
  if (!workspaceStore.currentPath || !selectedLog.value || !workspaceStore.svnInfo) return
  const request = ++diffGeneration, revision = selectedLog.value.revision
  const peg = row.action === 'D' ? revision - 1 : revision
  const url = `${workspaceStore.svnInfo.repository_root.replace(/\/+$/, '')}${row.path}@${peg}`
  try { const result = await svnDiff(workspaceStore.currentPath, url, revision); if (request === diffGeneration) inlineDiff.value = result.diff } catch (e) { if (request === diffGeneration) inlineDiff.value = String(e) }
}
const { openWorkspace: openWorkspaceDialog } = useWorkspace()

const logs = ref<SvnLogEntry[]>([])
const loading = ref(false)
const hasMore = ref(true)
const logScroller = ref<HTMLElement | null>(null)
let requestGeneration = 0
let authorRequestGeneration = 0
const pageIndex = ref(0)
const pageCursors = ref<(number | undefined)[]>([undefined])
const FILTER_RELOAD_DELAY_MS = 250
let filterReloadTimer: number | undefined
const dialogVisible = ref(false)
const selectedLog = ref<SvnLogEntry | null>(null)
const LOG_CACHE_TTL_MS = 5 * 60 * 1000
const LOG_CACHE_KEY_VERSION = 'v4'
const DEFAULT_LOG_PAGE_SIZE = 20
const MAX_CACHE_SIZE = 50
type LogCacheEntry = {
  entries: SvnLogEntry[]
  cachedAt: number
}
const logPageCache = new Map<string, LogCacheEntry>()
const logCacheVersion = ref(0)
const currentAuthor = ref('')

const getDefaultFilters = () => ({
  author: '',
  keyword: '',
  dateFrom: '',
  dateTo: '',
})

const filters = reactive({
  ...getDefaultFilters(),
})
const hasActiveFilters = computed(() => {
  return Boolean(filters.author.trim() || filters.keyword.trim() || filters.dateFrom || filters.dateTo)
})
const logResultSummary = computed(() => {
  const key = hasActiveFilters.value ? 'log.matchedCount' : 'log.loadedCount'
  return t(key, { count: logs.value.length })
})

const dateRange = computed<string[]>({
  get: () => filters.dateFrom && filters.dateTo ? [filters.dateFrom, filters.dateTo] : [],
  set: (value: string[]) => {
    filters.dateFrom = value?.[0] || ''
    filters.dateTo = value?.[1] || ''
  },
})

const cloneLogEntry = (entry: SvnLogEntry): SvnLogEntry => ({
  ...entry,
  changed_paths: [...(entry.changed_paths || [])],
})

const sortLogEntries = (entries: SvnLogEntry[]) => {
  return [...entries].sort((a, b) => {
    const revisionOrder = b.revision - a.revision
    if (revisionOrder !== 0) return revisionOrder
    return Date.parse(b.date || '') - Date.parse(a.date || '')
  })
}

const normalizeLogEntries = (entries: SvnLogEntry[]) => {
  const seenRevisions = new Set<number>()
  const uniqueEntries = entries.filter(entry => {
    if (seenRevisions.has(entry.revision)) return false
    seenRevisions.add(entry.revision)
    return true
  })
  return sortLogEntries(uniqueEntries.map(cloneLogEntry))
}

const getLogCacheKey = (path: string, limit: number | undefined, startRev?: number, endRev?: number, keyword?: string, author?: string, dateFrom?: string, dateTo?: string) => {
  return `${LOG_CACHE_KEY_VERSION}|${workspaceStore.epoch}|${path}|${limit}|${startRev ?? ''}|${endRev ?? ''}|${keyword ?? ''}|${author ?? ''}|${dateFrom ?? ''}|${dateTo ?? ''}`
}

const getCachedLogPage = (path: string, limit: number | undefined, startRev?: number, endRev?: number, keyword?: string, author?: string, dateFrom?: string, dateTo?: string) => {
  const key = getLogCacheKey(path, limit, startRev, endRev, keyword, author, dateFrom, dateTo)
  const cached = logPageCache.get(key)
  if (!cached) return null
  if (Date.now() - cached.cachedAt > LOG_CACHE_TTL_MS) {
    logPageCache.delete(key)
    return null
  }
  return normalizeLogEntries(cached.entries)
}

const setCachedLogPage = (
  path: string,
  limit: number | undefined,
  entries: SvnLogEntry[],
  startRev?: number,
  endRev?: number,
  keyword?: string,
  author?: string,
  dateFrom?: string,
  dateTo?: string
) => {
  // 缓存达到上限时淘汰最旧的条目
  if (logPageCache.size >= MAX_CACHE_SIZE) {
    let oldestKey: string | undefined
    let oldestTime = Infinity
    for (const [k, v] of logPageCache) {
      if (v.cachedAt < oldestTime) {
        oldestTime = v.cachedAt
        oldestKey = k
      }
    }
    if (oldestKey) logPageCache.delete(oldestKey)
  }

  const key = getLogCacheKey(path, limit, startRev, endRev, keyword, author, dateFrom, dateTo)
  logPageCache.set(key, {
    entries: normalizeLogEntries(entries),
    cachedAt: Date.now(),
  })
  logCacheVersion.value += 1
}

const clearLogCacheForPath = (path: string) => {
  const prefix = `${LOG_CACHE_KEY_VERSION}|${path}|`
  let changed = false
  for (const key of logPageCache.keys()) {
    if (key.startsWith(prefix)) {
      logPageCache.delete(key)
      changed = true
    }
  }
  if (changed) logCacheVersion.value += 1
}

const getCachedAuthorsForPath = (path: string | null) => {
  if (!path) return []
  logCacheVersion.value

  const prefix = `${LOG_CACHE_KEY_VERSION}|${path}|`
  const authors = new Set<string>()
  for (const [key, cached] of logPageCache.entries()) {
    if (!key.startsWith(prefix)) continue
    cached.entries.forEach(entry => {
      if (entry.author) authors.add(entry.author)
    })
  }
  return [...authors]
}

const knownAuthors = computed(() => {
  const authors = new Set<string>()
  logs.value.forEach(entry => {
    if (entry.author) authors.add(entry.author)
  })
  getCachedAuthorsForPath(workspaceStore.currentPath).forEach(author => authors.add(author))
  return [...authors]
})

const authorOptions = computed(() => {
  const self = currentAuthor.value
  const otherAuthors = knownAuthors.value
    .filter(author => author && author !== self)
    .sort((a, b) => a.localeCompare(b, locale.value))

  return [
    ...(self ? [{ label: self, value: self }] : []),
    ...otherAuthors.map(author => ({ label: author, value: author })),
  ]
})

const loadCurrentAuthor = async (path: string) => {
  const generation = ++authorRequestGeneration
  try {
    const authUser = await svnCurrentUser(path)
    if (generation === authorRequestGeneration && path === workspaceStore.currentPath) {
      currentAuthor.value = authUser?.username || ''
    }
  } catch {
    if (generation === authorRequestGeneration && path === workspaceStore.currentPath) {
      currentAuthor.value = ''
    }
  }
}

const openWorkspace = async () => {
  const success = await openWorkspaceDialog(t('dialog.selectSVNWorkspaceDirectory'))
  if (success) {
    reloadLogs()
  }
}

let lastLogError: string | null = null

const fetchLogPage = async (index: number, refreshCache = false) => {
  const requestedPath = workspaceStore.currentPath
  const requestedSource = logSource.value
  const epoch = workspaceStore.epoch
  if (!requestedPath || !requestedSource) return
  const generation = ++requestGeneration
  const startRev = pageCursors.value[index]
  const endRev = startRev === undefined ? undefined : 1
  // One extra match determines whether there is another page, including filters.
  const limit = DEFAULT_LOG_PAGE_SIZE + 1
  const kw = filters.keyword.trim() || undefined
  const author = filters.author.trim() || undefined
  const df = filters.dateFrom || undefined
  const dt = filters.dateTo || undefined
  loading.value = true
  try {
    const cached = refreshCache ? null : getCachedLogPage(requestedSource, limit, startRev, endRev, kw, author, df, dt)
    const batch = cached || normalizeLogEntries(await svnLog(requestedSource, limit, startRev, endRev, kw, author, df, dt))
    if (generation !== requestGeneration || requestedPath !== workspaceStore.currentPath || requestedSource !== logSource.value || epoch !== workspaceStore.epoch) return
    if (!cached) setCachedLogPage(requestedSource, limit, batch, startRev, endRev, kw, author, df, dt)
    const repositoryRoot = workspaceStore.svnInfo?.repository_root || ''
    const relativeSource = repositoryRoot && requestedSource.startsWith(repositoryRoot) ? decodeURIComponent(requestedSource.slice(repositoryRoot.length)).replace(/\/+$/, '') : ''
    logs.value = batch.slice(0, DEFAULT_LOG_PAGE_SIZE).map(entry => ({ ...entry, changed_paths: relativeSource ? entry.changed_paths.filter(p => p.path === relativeSource || p.path.startsWith(`${relativeSource}/`)) : entry.changed_paths }))
    hasMore.value = batch.length > DEFAULT_LOG_PAGE_SIZE
    pageIndex.value = index
    if (hasMore.value) pageCursors.value[index + 1] = logs.value[logs.value.length - 1].revision - 1
    await nextTick()
    if (logScroller.value) logScroller.value.scrollTop = 0
    if (lastLogError !== null) {
      if (workspaceStore.error === lastLogError) workspaceStore.setError(null)
      lastLogError = null
    }
  } catch (err) {
    if (generation === requestGeneration) {
      lastLogError = String(err)
      workspaceStore.setError(lastLogError)
    }
  } finally {
    if (generation === requestGeneration) loading.value = false
  }
}

const reloadLogs = async (refreshCache = false, restart = false) => {
  if (!restart && !refreshCache && loading.value) return
  if (refreshCache && workspaceStore.currentPath) clearLogCacheForPath(workspaceStore.currentPath)
  pageIndex.value = 0
  pageCursors.value = [undefined]
  logs.value = []
  hasMore.value = false
  await fetchLogPage(0, refreshCache)
}

const changePage = (index: number) => {
  if (loading.value || filterReloadTimer !== undefined || index < 0 || index >= pageCursors.value.length) return
  void fetchLogPage(index)
}

const scheduleFilterReload = () => {
  if (!workspaceStore.currentPath) return
  if (filterReloadTimer !== undefined) {
    window.clearTimeout(filterReloadTimer)
  }
  filterReloadTimer = window.setTimeout(() => {
    filterReloadTimer = undefined
    void reloadLogs(true, true)
  }, FILTER_RELOAD_DELAY_MS)
}

const queryLogs = () => {
  if (!workspaceStore.currentPath || loading.value) return
  if (filterReloadTimer !== undefined) {
    window.clearTimeout(filterReloadTimer)
    filterReloadTimer = undefined
  }
  void reloadLogs(true, true)
}

const handleRowClick = (row: SvnLogEntry) => {
  diffGeneration++; inlineDiff.value = ''
  selectedLog.value = row
  dialogVisible.value = true
}

let preserveLogSelection = false

const openChangedPathDiff = (row: SvnLogPath) => {
  if (!selectedLog.value || !workspaceStore.svnInfo) return

  preserveLogSelection = true
  sessionStorage.setItem('orca_log_selection', String(selectedLog.value.revision))

  const repositoryRoot = workspaceStore.svnInfo.repository_root.replace(/\/+$/, '')
  const revision = selectedLog.value.revision
  const currentRepoPath = row.path.startsWith('/') ? row.path : `/${row.path}`
  const currentPegRev = row.action === 'D' ? Math.max(0, revision - 1) : revision

  const allFiles = (selectedLog.value.changed_paths || []).map(p => {
    const repoPath = p.path.startsWith('/') ? p.path : `/${p.path}`
    const pegRev = p.action === 'D' ? Math.max(0, revision - 1) : revision
    return {
      display: repoPath,
      query: `${repositoryRoot}${repoPath}@${pegRev}`,
    }
  })

  const currentIndex = allFiles.findIndex(f => f.query === `${repositoryRoot}${currentRepoPath}@${currentPegRev}`)

  sessionStorage.setItem('orca_diff_files', JSON.stringify({
    source: 'log',
    files: allFiles.map(f => f.query),
    displayNames: allFiles.map(f => f.display),
    current: `${repositoryRoot}${currentRepoPath}@${currentPegRev}`,
    index: Math.max(0, currentIndex),
  }))

  dialogVisible.value = false
  router.push({
    name: 'diff',
    query: {
      path: `${repositoryRoot}${currentRepoPath}@${currentPegRev}`,
      revision: String(revision),
    },
  })
}

const onDialogClose = () => {
  if (!preserveLogSelection) {
    sessionStorage.removeItem('orca_log_selection')
  }
}

const resetFilters = () => {
  Object.assign(filters, getDefaultFilters())
}

const clearAuthorFilter = () => {
  filters.author = ''
}

const getActionLabel = (action: string) => {
  const key = `log.action${action || 'Unknown'}`
  const translated = t(key)
  return translated === key ? action || t('common.noData') : translated
}

const getActionTagType = (action: string) => {
  switch (action) {
    case 'A': return 'success'
    case 'D': return 'danger'
    case 'M': return 'warning'
    case 'R': return 'primary'
    default: return 'info'
  }
}

const formatDate = (dateStr: string): string => {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleString(locale.value)
}

watch(
  () => workspaceStore.currentPath,
  (path, oldPath) => {
    if (path && path !== oldPath) {
      currentAuthor.value = ''
      loadCurrentAuthor(path)
      reloadLogs(true)
    }
    if (!path) {
      requestGeneration += 1
      authorRequestGeneration += 1
      logs.value = []
      currentAuthor.value = ''
      hasMore.value = true
      loading.value = false
      pageIndex.value = 0
      pageCursors.value = [undefined]
    }
  },
  { immediate: true }
)

watch([logSource, () => workspaceStore.epoch], () => { requestGeneration++; diffGeneration++; inlineDiff.value = ''; dialogVisible.value = false; selectedLog.value = null; void reloadLogs(true, true) })

watch(
  () => [filters.author, filters.keyword, filters.dateFrom, filters.dateTo] as const,
  scheduleFilterReload
)

onActivated(() => {
  const saved = sessionStorage.getItem('orca_log_selection')
  if (saved && !dialogVisible.value) {
    const revision = Number(saved)
    if (!isNaN(revision)) {
      const log = logs.value.find(l => l.revision === revision)
      if (log) {
        selectedLog.value = log
        dialogVisible.value = true
      }
    }
    sessionStorage.removeItem('orca_log_selection')
  }
  preserveLogSelection = false
})

onUnmounted(() => {
  sessionStorage.removeItem('orca_log_selection')
  if (filterReloadTimer !== undefined) {
    window.clearTimeout(filterReloadTimer)
  }
})

</script>

<style scoped>
.log-branch-context{display:flex;flex-wrap:wrap;gap:8px 24px;padding:8px 12px;border-bottom:1px solid var(--md-sys-color-outline-variant);font-size:12px;overflow-wrap:anywhere}
.log-inspector{flex-shrink:0;box-sizing:border-box;border-top:1px solid var(--md-sys-color-outline-variant);padding:12px;max-height:60vh;overflow:auto;resize:vertical;min-height:200px}
.log-detail-actions{display:flex;justify-content:flex-end;gap:8px;margin-bottom:8px}
.log-context{position:fixed;z-index:2500;background:var(--md-sys-color-surface-container-lowest);border:1px solid var(--md-sys-color-outline-variant);padding:4px;min-width:210px}
.log-context button{display:block;background:none;color:inherit;border:0;padding:8px;width:100%;text-align:left;cursor:pointer}
.log-context button:hover{background:var(--md-sys-color-primary-container)}

.log-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.log-card {
  flex: 1;
  min-height: 0;
  height: auto;
  border-radius: var(--app-radius-lg);
}

:deep(.log-card > .el-card__body) {
  display: flex;
  flex-direction: column;
  height: calc(100% - 57px);
  min-height: 0;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-title {
  display: inline-flex;
  align-items: center;
  gap: var(--app-spacing-sm);
  font-weight: 700;
}

.header-actions {
  align-items: center;
  display: flex;
  gap: var(--app-spacing-sm);
}

.loaded-count {
  color: var(--el-text-color-secondary);
  font-size: var(--app-font-size-xs);
}

.no-workspace {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--app-spacing-xl) 0;
}

.empty-icon {
  font-size: 64px;
  color: var(--el-text-color-placeholder);
}

.log-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.log-filters {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) minmax(180px, 2fr) 380px auto auto;
  gap: var(--app-spacing-sm);
  margin-bottom: var(--app-spacing);
}

.author-select {
  width: 100%;
}

.author-select :deep(.el-select__wrapper) {
  height: 40px;
  min-height: 40px;
}

.author-select :deep(.el-select__wrapper.is-focused),
.author-select :deep(.el-select__wrapper.is-focus) {
  box-shadow: 0 0 0 2px var(--md-sys-color-primary) inset;
}

.author-select :deep(.el-select__input),
.author-select :deep(.el-select__input:focus),
.author-select :deep(.el-select__input:focus-visible) {
  border: 0;
  outline: none;
  box-shadow: none;
}

.log-date-range {
  width: 100%;
  min-width: 0;
}

.log-date-range :deep(.el-range-input) {
  color: var(--el-text-color-primary);
}

.log-date-range :deep(.el-range-input::placeholder) {
  color: var(--el-text-color-placeholder);
}

.log-date-range :deep(.el-range-separator),
.log-date-range :deep(.el-range__icon),
.log-date-range :deep(.el-range__close-icon) {
  color: var(--el-text-color-secondary);
}

.log-query-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 28px;
  gap: var(--app-spacing-sm);
  margin: -4px 0 var(--app-spacing-sm);
  color: var(--el-text-color-secondary);
  font-size: var(--app-font-size-sm);
}

.query-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--md-sys-color-primary);
  font-weight: 600;
}

.log-table {
  border-radius: var(--app-radius-md);
  overflow: hidden;
}

.log-table :deep(.changed-files-column .cell),
.log-table :deep(.changed-files-header .cell) {
  white-space: nowrap;
}

.log-pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding: 12px;
  color: var(--el-text-color-secondary);
  font-size: var(--app-font-size-xs);
  text-align: center;
}

.empty-log-result {
  padding: var(--app-spacing-lg) 0 var(--app-spacing-xl);
}

:global(.theme-dark) .log-query-state,
:global(.dark) .log-query-state {
  color: var(--md-sys-color-on-surface-variant);
}

:global(.theme-dark) .query-status,
:global(.dark) .query-status {
  color: var(--md-sys-color-on-primary-container);
}

:global(.theme-dark) .log-table,
:global(.dark) .log-table {
  --el-table-border-color: rgba(115, 115, 115, .12);
  border: 1px solid rgba(115, 115, 115, .1);
}

:global(.theme-dark) .log-table :deep(.el-table__inner-wrapper::before),
:global(.theme-dark) .log-table :deep(.el-table__inner-wrapper::after),
:global(.dark) .log-table :deep(.el-table__inner-wrapper::before),
:global(.dark) .log-table :deep(.el-table__inner-wrapper::after) {
  background-color: rgba(115, 115, 115, .1);
}

:global(.theme-dark) .empty-log-result,
:global(.dark) .empty-log-result {
  color: var(--md-sys-color-on-surface-variant);
}

.author-cell,
.date-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--el-text-color-regular);
}

.author-cell .el-icon,
.date-cell .el-icon {
  flex-shrink: 0;
  font-size: var(--app-font-size-body);
  color: var(--el-text-color-secondary);
}

.author-cell span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-dialog {
  border-radius: var(--app-radius-xl);
}

.log-detail {
  display: flex;
  flex-direction: column;
  gap: var(--app-spacing-lg);
}

.detail-descriptions {
  border-radius: var(--app-radius-md);
  overflow: hidden;
}

.author-info,
.date-info {
  display: flex;
  align-items: center;
  gap: 6px;
}

.author-info span,
.date-info span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.author-info .el-icon,
.date-info .el-icon {
  flex-shrink: 0;
}

.author-info .el-icon,
.date-info .el-icon {
  font-size: var(--app-font-size-body);
  color: var(--el-text-color-secondary);
}

.commit-message-section {
  margin-top: var(--app-spacing-sm);
}

.changed-files-section {
  margin-top: var(--app-spacing-sm);
}

.message-title {
  display: flex;
  align-items: center;
  gap: var(--app-spacing-sm);
  margin-bottom: var(--app-spacing);
  font-size: 15px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.message-title .el-icon {
  font-size: var(--app-font-size-title);
  color: var(--md-sys-color-primary);
}

.commit-message {
  background: var(--el-fill-color-light);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--app-radius-md);
  padding: var(--app-spacing-md);
  overflow: auto;
}

.commit-message pre {
  margin: 0;
  font-family: inherit;
  font-size: var(--app-font-size-body);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--el-text-color-primary);
}

.changed-files-table {
  border-radius: var(--app-radius-md);
  overflow: hidden;
}

.changed-files-table :deep(.el-table__row) {
  cursor: pointer;
}

.file-path {
  font-family: var(--app-font-family-mono);
  font-size: var(--app-font-size-label);
}

@media (max-width: 860px) {
  .card-header {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--app-spacing-sm);
  }
  
  .header-actions {
    width: 100%;
  }

  .log-filters {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 640px) {
  .log-filters {
    grid-template-columns: 1fr;
  }
}

/* Dashboard.axaml/CommitDetail.axaml: compact history above the selected revision. */
.log-card :deep(>.el-card__header){display:none}.log-card :deep(>.el-card__body){height:100%;padding:0!important}.log-filters{padding:7px 9px;gap:6px;margin:0;grid-template-columns:minmax(90px,1fr) minmax(140px,2fr) minmax(200px,2fr) auto auto}.log-query-state{padding:4px 10px;font-size:11px}.log-branch-context{padding:4px 10px;font-size:10px;gap:4px 16px}.log-table :deep(.el-table__cell){padding:3px 0;height:28px}.log-table :deep(.cell){font-size:12px;line-height:20px}.log-table :deep(.el-tag){border:0;background:transparent;font-size:11px}.log-pagination{padding:5px 10px;margin:0;border-top:1px solid var(--md-sys-color-outline-variant)}.log-inspector{background:var(--md-sys-color-surface-container-low);padding:10px;max-height:55vh}.log-detail-actions{margin-bottom:6px}.log-inspector :deep(.el-descriptions__cell){padding:5px 9px!important;font-size:12px}.commit-message-section,.changed-files-section{margin-top:10px}

</style>
