<template>
  <div
    class="log-view"
    :style="{
      '--history-split': `${historySplit}%`,
      '--files-width': `${filesWidth}px`,
    }"
    @click="contextVisible = false"
  >
    <div
      v-if="scopedHistory || (logSource && logSource !== flow.identity?.url)"
      class="log-branch-context"
    >
      <span>{{ $t('flow.current') }}: {{ flow.identity?.url || workspaceStore.svnInfo?.url }}</span
      ><span>{{ $t('flow.browsing') }}: {{ logSource }}</span
      ><button v-if="scopedHistory" @click="router.replace({ name: 'log', query: {} })">
        {{ $t('fileMenu.branchHistory') }}
      </button>
    </div>
    <div
      v-if="contextVisible"
      class="log-context"
      :style="{ left: `${contextX}px`, top: `${contextY}px` }"
      @click.stop
    >
      <button :disabled="flow.busy || scopedHistory" @click="cherryPick">
        {{ $t('flow.cherryPick') }}
      </button>
      <button @click="openComparison()">{{ $t('experience.compare') }}</button
      ><button :disabled="logSource !== flow.identity?.url" @click="openComparison(true)">
        {{ $t('experience.compareWorking') }}
      </button>
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
          <el-input
            v-model="filters.keyword"
            :placeholder="$t('log.searchKeyword')"
            :aria-label="$t('log.searchKeyword')"
            clearable
            size="small"
          />
          <details class="history-extra-filters">
            <summary>
              <el-icon><Search /></el-icon>{{ $t('forkUI.filters') }}
            </summary>
            <div class="history-filter-popover">
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
            </div>
          </details>
          <el-button type="primary" size="small" :loading="loading" @click="queryLogs">
            <el-icon><Search /></el-icon>
            {{ $t('log.query') }}
          </el-button>
          <el-button
            size="small"
            :title="$t('common.reset')"
            :aria-label="$t('common.reset')"
            @click="resetFilters"
            ><el-icon><RefreshLeft /></el-icon
          ></el-button>
        </div>

        <div class="log-query-state">
          <el-button size="small" @click="openComparison()"
            >{{ $t('experience.compare')
            }}<span v-if="selectedRevisions.length">
              ({{ selectedRevisions.length }})</span
            ></el-button
          >
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
          @selection-change="
            (rows: SvnLogEntry[]) => (selectedRevisions = rows.map((row) => row.revision))
          "
          @row-click="handleRowClick"
          @row-contextmenu="contextMenu"
          row-key="revision"
          highlight-current-row
          class="log-table"
        >
          <el-table-column type="selection" width="36" />
          <el-table-column prop="message" :label="$t('log.commitMessage')" min-width="220">
            <template #default="{ row }">
              <span class="message-text" :title="row.message">{{ row.message }}</span>
            </template>
          </el-table-column>
          <el-table-column
            prop="revision"
            :label="$t('log.revision')"
            width="90"
            sortable
            align="center"
          >
            <template #default="{ row }">
              <el-tag type="primary" size="small" effect="plain">r{{ row.revision }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="author" :label="$t('log.author')" width="110">
            <template #default="{ row }">
              <div class="author-cell">
                <el-icon><User /></el-icon>
                <span :title="row.author">{{ row.author }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="date" :label="$t('log.date')" width="150" sortable>
            <template #default="{ row }">
              <div class="date-cell">
                <el-icon><Calendar /></el-icon>
                <span>{{ formatDate(row.date) }}</span>
              </div>
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
          <el-button
            size="small"
            :disabled="loading || pageIndex === 0"
            @click="changePage(pageIndex - 1)"
          >
            {{ $t('log.previousPage') }}
          </el-button>
          <span>{{ $t('log.pageNumber', { page: pageIndex + 1 }) }}</span>
          <el-button
            size="small"
            :disabled="loading || !hasMore"
            @click="changePage(pageIndex + 1)"
          >
            {{ $t('log.nextPage') }}
          </el-button>
        </div>
      </div>

      <PanelSplitter
        v-if="workspaceStore.currentPath"
        axis="x"
        v-model:value="historySplit"
        :min="40"
        :max="75"
        percent
        :label="$t('forkUI.resizeHistory')"
      />
      <section v-if="workspaceStore.currentPath" class="log-inspector">
        <div
          class="inspector-tabs"
          role="tablist"
          :aria-label="$t('forkUI.commit')"
          @keydown="navigateInspectorTabs"
        >
          <button
            v-for="tab in inspectorTabs"
            :id="'history-tab-' + tab.id"
            :key="tab.id"
            role="tab"
            :aria-selected="inspectorTab === tab.id"
            aria-controls="history-tabpanel"
            :tabindex="inspectorTab === tab.id ? 0 : -1"
            :class="{ active: inspectorTab === tab.id }"
            @click="inspectorTab = tab.id"
          >
            {{ $t(tab.label) }}
          </button>
        </div>
        <div v-if="!selectedLog" class="inspector-empty">
          {{ $t('forkUI.selectCommit') }}
        </div>
        <div
          v-else
          id="history-tabpanel"
          class="inspector-content"
          role="tabpanel"
          :aria-labelledby="'history-tab-' + inspectorTab"
        >
          <div class="revision-actions">
            <strong>r{{ selectedLog.revision }}</strong
            ><el-button
              size="small"
              :disabled="flow.busy || scopedHistory || logSource === flow.identity?.url"
              @click="cherryPick"
              >{{ $t('flow.cherryPick') }}</el-button
            ><button
              class="quiet-icon"
              :title="$t('common.close')"
              :aria-label="$t('common.close')"
              @click="closeInspector"
            >
              <el-icon><Close /></el-icon>
            </button>
          </div>
          <section v-show="inspectorTab === 'commit'" class="revision-overview">
            <dl>
              <dt>{{ $t('log.author') }}</dt>
              <dd>{{ selectedLog.author }}</dd>
              <dt>{{ $t('log.date') }}</dt>
              <dd>{{ formatDate(selectedLog.date) }}</dd>
              <dt>{{ $t('forkUI.repository') }}</dt>
              <dd :title="logSource">{{ logSource }}</dd>
            </dl>
            <pre class="revision-message">{{ selectedLog.message }}</pre>
            <h4>
              {{ $t('log.changedFiles') }} ·
              {{ selectedLog.changed_paths?.length || 0 }}
            </h4>
            <RevisionPathTree
              :key="selectedLog.revision"
              :paths="selectedLog.changed_paths || []"
              :selected="selectedRevisionPath"
              @select="showRevisionFile"
              @open="openChangedPathDiff"
            />
          </section>
          <section v-show="inspectorTab !== 'commit'" class="revision-changes">
            <div class="revision-file-browser" :style="{ flexBasis: filesWidth + 'px' }">
              <div v-show="inspectorTab === 'changes'" class="revision-file-list">
                <button
                  v-for="row in selectedLog.changed_paths || []"
                  :key="row.path"
                  :class="{ active: selectedRevisionPath === row.path }"
                  :title="row.path"
                  @click="previewChangedPath(row)"
                  @dblclick="openChangedPathDiff(row)"
                >
                  <small>{{ row.action }}</small
                  ><span>{{ row.path }}</span>
                </button>
              </div>
              <RevisionPathTree
                v-show="inspectorTab === 'tree'"
                :key="selectedLog.revision"
                :paths="selectedLog.changed_paths || []"
                :selected="selectedRevisionPath"
                @select="previewChangedPath"
                @open="openChangedPathDiff"
              />
            </div>
            <PanelSplitter
              axis="y"
              v-model:value="filesWidth"
              :min="90"
              :max="400"
              :label="$t('sourceUI.resizeChanges')"
            />
            <div class="history-diff">
              <DiffViewer v-if="selectedRevisionPath" :text="inlineDiff" compact /><span
                v-else
                class="inspector-empty"
                >{{ $t('forkUI.selectRevisionFile') }}</span
              >
            </div>
          </section>
        </div>
      </section>
    </el-card>
    <RevisionCompareDialog
      v-if="comparison"
      :source="logSource"
      :revisions="comparison.revisions"
      :initial-working="comparison.working"
      :allow-working="logSource === flow.identity?.url"
      @close="comparison = null"
    />
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onActivated,
  onDeactivated,
  onUnmounted,
  reactive,
  ref,
  watch,
} from 'vue'
import { useWorkflowStore } from '@/stores/workflows'
import { repositoryPreview } from '@/api/workflows'
import { svnDiff } from '@/api/svn'
import { ElMessage } from 'element-plus'
import PanelSplitter from '@/components/PanelSplitter.vue'
import RevisionCompareDialog from '@/components/RevisionCompareDialog.vue'
import { readPanelSize } from '@/utils/changeSelection'
import { repositoryUi } from '@/utils/repositoryUi'
import DiffViewer from '@/components/DiffViewer.vue'
import RevisionPathTree from '@/components/RevisionPathTree.vue'
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
  if (
    typeof route.query.target === 'string' &&
    route.query.workspace === workspaceStore.currentPath &&
    route.query.branch === workspaceStore.svnInfo?.url
  )
    return route.query.target
  return flow.browsingUrl || workspaceStore.svnInfo?.url || workspaceStore.currentPath || ''
})
const inlineDiff = ref('')
const selectedRevisionPath = ref('')
const inspectorTab = ref<'commit' | 'changes' | 'tree'>('commit')
const inspectorTabs = [
  { id: 'commit', label: 'forkUI.commit' },
  { id: 'changes', label: 'forkUI.changes' },
  { id: 'tree', label: 'forkUI.fileTree' },
] as const
function navigateInspectorTabs(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const index = inspectorTabs.findIndex((tab) => tab.id === inspectorTab.value)
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? 2
        : (index + (event.key === 'ArrowLeft' ? 2 : 1)) % 3
  inspectorTab.value = inspectorTabs[next].id
  ;(event.currentTarget as HTMLElement)
    .querySelectorAll<HTMLButtonElement>('[role="tab"]')
    [next]?.focus()
}
function showRevisionFile(row: SvnLogPath) {
  inspectorTab.value = 'changes'
  void previewChangedPath(row)
}
function closeInspector() {
  diffGeneration++
  selectedLog.value = null
  selectedRevisionPath.value = ''
  inlineDiff.value = ''
  dialogVisible.value = false
  onDialogClose()
}

const historySplit = ref(readPanelSize('orcasvn-history-columns', 60, 40, 75)),
  filesWidth = ref(readPanelSize('orcasvn-history-file-height', 180, 90, 400))
watch([historySplit, filesWidth], () => {
  try {
    localStorage.setItem('orcasvn-history-columns', String(historySplit.value))
    localStorage.setItem('orcasvn-history-file-height', String(filesWidth.value))
  } catch {}
})
const comparison = ref<{ revisions: number[]; working: boolean } | null>(null),
  selectedRevisions = ref<number[]>([])
function openComparison(working = false) {
  const revision = selectedLog.value?.revision || logs.value[0]?.revision || 0
  comparison.value = {
    revisions:
      selectedRevisions.value.length === 2
        ? [...selectedRevisions.value]
        : [Math.max(0, revision - 1), revision],
    working,
  }
  contextVisible.value = false
}
let restoringHistory = false
let historyOwner = workspaceStore.currentPath
function saveHistoryView() {
  const path = workspaceStore.currentPath
  if (path && path === historyOwner)
    repositoryUi(path).history = {
      filters: { ...filters },
      revision: selectedLog.value?.revision,
      inspectorTab: inspectorTab.value,
      selectedPath: selectedRevisionPath.value,
      page: pageIndex.value,
      cursors: [...pageCursors.value],
      scroll: logScroller.value?.scrollTop || 0,
    }
}
async function restoreHistoryView() {
  const path = workspaceStore.currentPath
  if (!path) return
  const state = repositoryUi(path).history
  historyOwner = path
  if (!state) return
  restoringHistory = true
  try {
    Object.assign(filters, state.filters)
    await nextTick()
    if (filterReloadTimer !== undefined) {
      window.clearTimeout(filterReloadTimer)
      filterReloadTimer = undefined
    }
    if (path !== workspaceStore.currentPath) return
    pageCursors.value = [...state.cursors]
    await fetchLogPage(Math.min(state.page, pageCursors.value.length - 1), true)
    if (path !== workspaceStore.currentPath) return
    await nextTick()
    if (logScroller.value) logScroller.value.scrollTop = state.scroll
    const entry = logs.value.find((log) => log.revision === state.revision)
    if (entry) {
      selectedLog.value = entry
      dialogVisible.value = true
      inspectorTab.value = state.inspectorTab || 'commit'
      const file = entry.changed_paths?.find((row) => row.path === state.selectedPath)
      if (file) void previewChangedPath(file)
    }
  } finally {
    restoringHistory = false
  }
}

onDeactivated(saveHistoryView)
onMounted(() => {
  document.addEventListener('orcasvn-save-view', saveHistoryView)
  document.addEventListener('orcasvn-restore-view', restoreHistoryView)
})
onUnmounted(() => {
  document.removeEventListener('orcasvn-save-view', saveHistoryView)
  document.removeEventListener('orcasvn-restore-view', restoreHistoryView)
})
const contextVisible = ref(false),
  contextX = ref(0),
  contextY = ref(0)
let diffGeneration = 0
function contextMenu(row: SvnLogEntry, _column: unknown, event: MouseEvent) {
  event.preventDefault()
  handleRowClick(row)
  contextX.value = Math.min(event.clientX, window.innerWidth - 250)
  contextY.value = Math.min(event.clientY, window.innerHeight - 100)
  contextVisible.value = true
}
async function copyRevision() {
  if (selectedLog.value) {
    await writeClipboardText(String(selectedLog.value.revision))
    contextVisible.value = false
  }
}
async function cherryPick() {
  contextVisible.value = false
  const path = workspaceStore.currentPath,
    revision = selectedLog.value?.revision,
    source = logSource.value
  if (!path || !revision || flow.busy || scopedHistory.value) return
  try {
    const result = await flow.perform(
      t('flow.cherryPick'),
      () => repositoryPreview(path, source, revision),
      false
    )
    if (path === workspaceStore.currentPath && source === logSource.value) flow.plan = result
  } catch (e) {
    ElMessage.error(String(e))
  }
}
async function previewChangedPath(row: SvnLogPath) {
  if (!workspaceStore.currentPath || !selectedLog.value || !workspaceStore.svnInfo) return
  selectedRevisionPath.value = row.path
  inlineDiff.value = ''
  const request = ++diffGeneration,
    revision = selectedLog.value.revision
  const peg = row.action === 'D' ? revision - 1 : revision
  const url = `${workspaceStore.svnInfo.repository_root.replace(/\/+$/, '')}${row.path}@${peg}`
  try {
    const result = await svnDiff(workspaceStore.currentPath, url, revision)
    if (request === diffGeneration) inlineDiff.value = result.diff
  } catch (e) {
    if (request === diffGeneration) inlineDiff.value = String(e)
  }
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
  return Boolean(
    filters.author.trim() || filters.keyword.trim() || filters.dateFrom || filters.dateTo
  )
})
const logResultSummary = computed(() => {
  const key = hasActiveFilters.value ? 'log.matchedCount' : 'log.loadedCount'
  return t(key, { count: logs.value.length })
})

const dateRange = computed<string[]>({
  get: () => (filters.dateFrom && filters.dateTo ? [filters.dateFrom, filters.dateTo] : []),
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
  const uniqueEntries = entries.filter((entry) => {
    if (seenRevisions.has(entry.revision)) return false
    seenRevisions.add(entry.revision)
    return true
  })
  return sortLogEntries(uniqueEntries.map(cloneLogEntry))
}

const getLogCacheKey = (
  path: string,
  limit: number | undefined,
  startRev?: number,
  endRev?: number,
  keyword?: string,
  author?: string,
  dateFrom?: string,
  dateTo?: string
) => {
  return `${LOG_CACHE_KEY_VERSION}|${workspaceStore.epoch}|${path}|${limit}|${startRev ?? ''}|${endRev ?? ''}|${keyword ?? ''}|${author ?? ''}|${dateFrom ?? ''}|${dateTo ?? ''}`
}

const getCachedLogPage = (
  path: string,
  limit: number | undefined,
  startRev?: number,
  endRev?: number,
  keyword?: string,
  author?: string,
  dateFrom?: string,
  dateTo?: string
) => {
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
    cached.entries.forEach((entry) => {
      if (entry.author) authors.add(entry.author)
    })
  }
  return [...authors]
}

const knownAuthors = computed(() => {
  const authors = new Set<string>()
  logs.value.forEach((entry) => {
    if (entry.author) authors.add(entry.author)
  })
  getCachedAuthorsForPath(workspaceStore.currentPath).forEach((author) => authors.add(author))
  return [...authors]
})

const authorOptions = computed(() => {
  const self = currentAuthor.value
  const otherAuthors = knownAuthors.value
    .filter((author) => author && author !== self)
    .sort((a, b) => a.localeCompare(b, locale.value))

  return [
    ...(self ? [{ label: self, value: self }] : []),
    ...otherAuthors.map((author) => ({ label: author, value: author })),
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
    const cached = refreshCache
      ? null
      : getCachedLogPage(requestedSource, limit, startRev, endRev, kw, author, df, dt)
    const batch =
      cached ||
      normalizeLogEntries(
        await svnLog(requestedSource, limit, startRev, endRev, kw, author, df, dt)
      )
    if (
      generation !== requestGeneration ||
      requestedPath !== workspaceStore.currentPath ||
      requestedSource !== logSource.value ||
      epoch !== workspaceStore.epoch
    )
      return
    if (!cached)
      setCachedLogPage(requestedSource, limit, batch, startRev, endRev, kw, author, df, dt)
    const repositoryRoot = workspaceStore.svnInfo?.repository_root || ''
    const relativeSource =
      repositoryRoot && requestedSource.startsWith(repositoryRoot)
        ? decodeURIComponent(requestedSource.slice(repositoryRoot.length)).replace(/\/+$/, '')
        : ''
    logs.value = batch.slice(0, DEFAULT_LOG_PAGE_SIZE).map((entry) => ({
      ...entry,
      changed_paths: relativeSource
        ? entry.changed_paths.filter(
            (p) => p.path === relativeSource || p.path.startsWith(`${relativeSource}/`)
          )
        : entry.changed_paths,
    }))
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
  if (
    loading.value ||
    filterReloadTimer !== undefined ||
    index < 0 ||
    index >= pageCursors.value.length
  )
    return
  void fetchLogPage(index)
}

const scheduleFilterReload = () => {
  if (restoringHistory) return
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
  diffGeneration++
  inlineDiff.value = ''
  selectedRevisionPath.value = ''
  selectedLog.value = row
  dialogVisible.value = true
  if (inspectorTab.value !== 'commit' && row.changed_paths?.[0])
    void previewChangedPath(row.changed_paths[0])
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

  const allFiles = (selectedLog.value.changed_paths || []).map((p) => {
    const repoPath = p.path.startsWith('/') ? p.path : `/${p.path}`
    const pegRev = p.action === 'D' ? Math.max(0, revision - 1) : revision
    return {
      display: repoPath,
      query: `${repositoryRoot}${repoPath}@${pegRev}`,
    }
  })

  const currentIndex = allFiles.findIndex(
    (f) => f.query === `${repositoryRoot}${currentRepoPath}@${currentPegRev}`
  )

  sessionStorage.setItem(
    'orca_diff_files',
    JSON.stringify({
      source: 'log',
      files: allFiles.map((f) => f.query),
      displayNames: allFiles.map((f) => f.display),
      current: `${repositoryRoot}${currentRepoPath}@${currentPegRev}`,
      index: Math.max(0, currentIndex),
    })
  )

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

watch([logSource, () => workspaceStore.epoch], () => {
  comparison.value = null
  selectedRevisions.value = []
  requestGeneration++
  diffGeneration++
  inlineDiff.value = ''
  dialogVisible.value = false
  selectedLog.value = null
  selectedRevisionPath.value = ''
  void reloadLogs(true, true)
})

watch(
  () => [filters.author, filters.keyword, filters.dateFrom, filters.dateTo] as const,
  scheduleFilterReload
)

onActivated(() => {
  const saved = sessionStorage.getItem('orca_log_selection')
  if (saved && !dialogVisible.value) {
    const revision = Number(saved)
    if (!isNaN(revision)) {
      const log = logs.value.find((l) => l.revision === revision)
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
.log-view {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.log-card {
  flex: 1;
  min-height: 0;
  border: 0;
  border-radius: 0;
}
.log-card :deep(> .el-card__header) {
  display: none;
}
.log-card :deep(> .el-card__body) {
  height: 100%;
  padding: 0 !important;
  display: grid;
  grid-template-columns:
    minmax(220px, min(var(--history-split), calc(100% - 244px)))
    4px minmax(240px, 1fr);
  overflow: hidden;
}
.no-workspace {
  grid-column: 1/-1;
  display: grid;
  place-items: center;
}
.log-content {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}
.log-filters {
  position: relative;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 8px;
}
.log-filters > .el-input {
  flex: 1;
  min-width: 50px;
}
.log-filters .el-button {
  margin-left: 0;
}
.history-extra-filters {
  position: static;
  flex-shrink: 0;
}
.history-extra-filters > summary {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px;
  font-size: var(--app-font-size-xs);
  cursor: pointer;
  list-style: none;
}
.history-extra-filters > summary::-webkit-details-marker {
  display: none;
}
.history-filter-popover {
  position: absolute;
  z-index: 20;
  left: 8px;
  top: 100%;
  display: grid;
  gap: 8px;
  width: min(300px, calc(100% - 16px));
  padding: 10px;
  border: 1px solid var(--md-sys-color-outline-variant);
  background: var(--md-sys-color-surface-container);
}
.log-filters > * {
  min-width: 0;
}
.log-filters :deep(.log-date-range) {
  width: 100% !important;
  min-width: 0 !important;
}
.log-filters :deep(.el-select),
.log-filters :deep(.el-input) {
  width: 100%;
}
.log-query-state {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 8px;
  font-size: var(--app-font-size-xs);
}
.query-status {
  display: flex;
  gap: 5px;
  align-items: center;
}
.log-table {
  flex: 1;
  min-height: 140px;
}
.log-table :deep(.el-table__cell) {
  padding: 2px 0;
  height: 30px;
}
.log-table :deep(.cell) {
  font-size: var(--app-font-size-label);
  line-height: 20px;
}
.log-table :deep(.el-tag) {
  border: 0;
  background: transparent;
  font-size: var(--app-font-size-xs);
}
.message-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.author-cell,
.date-cell {
  display: flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  white-space: nowrap;
}
.author-cell span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.log-pagination {
  margin-top: auto;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  padding: 5px 8px;
  border-top: 1px solid var(--md-sys-color-outline-variant);
  font-size: var(--app-font-size-xs);
}
.empty-log-result {
  flex: 1;
}
.log-inspector {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--md-sys-color-surface-container-low);
}
.inspector-tabs {
  display: flex;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  flex-shrink: 0;
}
.inspector-tabs button {
  flex: 1;
  height: 32px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--md-sys-color-on-surface-variant);
  font-size: var(--app-font-size-sm);
  cursor: pointer;
}
.inspector-tabs button.active {
  color: var(--md-sys-color-primary);
  border-bottom-color: var(--md-sys-color-primary);
}
.inspector-content {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}
.revision-actions {
  min-height: 32px;
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 3px 8px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}
.revision-actions strong {
  flex: 1;
  font-size: var(--app-font-size-sm);
}
.quiet-icon {
  display: grid;
  place-items: center;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
}
.revision-overview {
  padding: 10px;
  overflow: auto;
  flex: 1;
  min-height: 0;
}
.revision-overview dl {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 7px 12px;
  margin: 0;
  font-size: var(--app-font-size-xs);
}
.revision-overview dt {
  color: var(--md-sys-color-on-surface-variant);
}
.revision-overview dd {
  margin: 0;
  overflow-wrap: anywhere;
  user-select: text;
}
.revision-message {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 12px 0;
  padding: 10px 0;
  border-block: 1px solid var(--md-sys-color-outline-variant);
  font: inherit;
  font-size: var(--app-font-size-label);
  user-select: text;
}
.revision-overview h4 {
  font-size: var(--app-font-size-xs);
  font-weight: 500;
  margin: 10px 0 6px;
}
.revision-changes {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  flex: 1;
}
.revision-file-browser {
  overflow: auto;
  flex-grow: 0;
  flex-shrink: 1;
  min-height: 60px;
  max-height: 55%;
}
.revision-file-list button {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  text-align: left;
  border: 0;
  background: none;
  color: inherit;
  padding: 5px 8px;
  font-size: var(--app-font-size-sm);
  cursor: pointer;
}
.revision-file-list button.active {
  background: var(--md-sys-color-primary-container);
}
.revision-file-list button span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.revision-file-list button small {
  color: var(--md-sys-color-on-surface-variant);
}
.history-diff {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.history-diff :deep(.diff-viewer) {
  border: 0;
  border-radius: 0;
}
.inspector-empty {
  display: grid;
  place-items: center;
  flex: 1;
  padding: 14px;
  font-size: var(--app-font-size-sm);
  color: var(--md-sys-color-on-surface-variant);
}
.log-context {
  position: fixed;
  z-index: 100;
  display: flex;
  flex-direction: column;
  padding: 4px;
  border: 1px solid var(--md-sys-color-outline-variant);
  background: var(--md-sys-color-surface-container);
}
.log-context button {
  text-align: left;
  border: 0;
  background: none;
  padding: 7px 12px;
  color: inherit;
  cursor: pointer;
}
.log-context button:hover {
  background: var(--md-sys-color-surface-container-high);
}
.log-branch-context {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 12px;
  padding: 4px 8px;
  font-size: var(--app-font-size-2xs);
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  overflow-wrap: anywhere;
}
</style>
