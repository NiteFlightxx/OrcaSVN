<template>
  <div
    class="log-view"
    :style="{
      '--history-split': `${historySplit}%`,
      '--files-width': `${filesWidth}px`,
    }"
    @click="contextVisible = false"
    @keydown.ctrl.f.prevent="focusHistorySearch"
    @keydown.meta.f.prevent="focusHistorySearch"
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
        <div v-if="filtersVisible || hasActiveFilters" class="log-filters">
          <el-input
            ref="historySearch"
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

        <VirtualViewport
          v-if="logs.length"
          ref="historyViewport"
          class="history-list"
          :item-count="logs.length"
          :row-height="historyRowHeight"
          :content-width="640"
          role="grid"
          :aria-label="$t('forkUI.allCommits')"
          :aria-rowcount="logs.length"
          :aria-colcount="4"
          :aria-activedescendant="selectedLog ? 'history-row-' + selectedLog.revision : undefined"
          @keydown="navigateHistory"
        >
          <template #default="{ start, end }">
            <div
              v-for="(row, offset) in logs.slice(start, end)"
              :id="'history-row-' + row.revision"
              :key="row.revision"
              class="history-row"
              :class="{
                current: selectedLog?.revision === row.revision,
                selected: selectedRevisions.includes(row.revision),
              }"
              :style="{ height: historyRowHeight + 'px' }"
              role="row"
              :aria-rowindex="start + offset + 1"
              :aria-selected="
                selectedLog?.revision === row.revision || selectedRevisions.includes(row.revision)
              "
              @click="selectHistoryRow(row, $event)"
              @contextmenu="contextMenu(row, null, $event)"
            >
              <span class="history-subject" role="gridcell" :title="row.message"
                ><i class="revision-dot" aria-hidden="true"></i
                ><span>{{ commitSubject(row.message) }}</span></span
              >
              <span class="history-author" role="gridcell" :title="row.author"
                ><span class="author-avatar small-avatar" aria-hidden="true">{{
                  authorInitials(row.author)
                }}</span
                ><span>{{ row.author }}</span></span
              >
              <span class="history-revision" role="gridcell">r{{ row.revision }}</span>
              <time
                class="history-date"
                role="gridcell"
                :title="formatDate(row.date)"
                :datetime="row.date"
                >{{ compactDate(row.date) }}</time
              >
            </div>
          </template>
        </VirtualViewport>
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
          <button
            class="history-footer-tool"
            :title="$t('log.searchKeyword') + ' · Ctrl+F'"
            :aria-label="$t('log.searchKeyword')"
            :aria-pressed="filtersVisible"
            @click="toggleHistorySearch"
          >
            <el-icon><Search /></el-icon>
          </button>
          <button
            class="history-footer-tool"
            :title="$t('experience.compare')"
            :aria-label="$t('experience.compare')"
            @click="openComparison()"
          >
            <el-icon><Connection /></el-icon
            ><span v-if="selectedRevisions.length">{{ selectedRevisions.length }}</span>
          </button>
          <span class="history-result" role="status">{{
            loading ? $t('log.querying') : logResultSummary
          }}</span>
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
          <el-dropdown v-if="selectedLog" trigger="click" @command="revisionCommand"
            ><button
              class="quiet-icon revision-menu"
              :title="$t('common.action')"
              :aria-label="$t('common.action')"
            >
              <el-icon><MoreFilled /></el-icon></button
            ><template #dropdown
              ><el-dropdown-menu
                ><el-dropdown-item command="compare">{{
                  $t('experience.compare')
                }}</el-dropdown-item
                ><el-dropdown-item
                  command="pick"
                  :disabled="flow.busy || scopedHistory || logSource === flow.identity?.url"
                  >{{ $t('flow.cherryPick') }}</el-dropdown-item
                ><el-dropdown-item command="copy">{{
                  $t('log.revision')
                }}</el-dropdown-item></el-dropdown-menu
              ></template
            ></el-dropdown
          >
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
          <section v-show="inspectorTab === 'commit'" class="revision-overview">
            <div class="revision-author-block">
              <span class="author-avatar large-avatar" aria-hidden="true">{{
                authorInitials(selectedLog.author)
              }}</span>
              <div>
                <small>{{ $t('log.author') }}</small
                ><strong>{{ selectedLog.author || '—' }}</strong
                ><time :datetime="selectedLog.date">{{ formatDate(selectedLog.date) }}</time>
              </div>
            </div>
            <dl class="revision-facts">
              <dt>{{ $t('flow.source') }}</dt>
              <dd>
                <span class="revision-source-tag" :title="logSource"
                  ><el-icon><GitBranch /></el-icon>{{ historySourceLabel(logSource) }}</span
                >
              </dd>
              <dt>{{ $t('log.revision') }}</dt>
              <dd>
                <button
                  class="revision-copy"
                  :title="$t('forkUI.copyRevision')"
                  @click="copyRevision"
                >
                  r{{ selectedLog.revision }}<el-icon><CopyDocument /></el-icon>
                </button>
              </dd>
            </dl>
            <pre class="revision-message">{{ selectedLog.message }}</pre>
            <div class="revision-files-heading">
              <span
                >{{ $t('log.changedFiles') }} · {{ selectedLog.changed_paths?.length || 0 }}</span
              ><button @click="inspectorTab = 'tree'">{{ $t('forkUI.fileTree') }}</button>
            </div>
            <div class="revision-summary-files">
              <button
                v-for="row in selectedLog.changed_paths || []"
                :key="row.path"
                :title="row.path"
                @click="showRevisionFile(row)"
                @dblclick="openChangedPathDiff(row)"
              >
                <el-icon><ChevronRight /></el-icon
                ><span class="revision-status" :class="'action-' + row.action">{{
                  row.action
                }}</span
                ><el-icon><component :is="fileIconName(row.path)" /></el-icon
                ><span class="revision-summary-path"
                  ><span v-if="row.path !== '/'" class="revision-directory">{{
                    revisionDisplayPath(
                      row.path,
                      logSource,
                      workspaceStore.svnInfo?.repository_root || ''
                    ).replace(/[^/]+$/, '')
                  }}</span
                  ><span class="revision-basename">{{
                    row.path.split('/').pop() || '/'
                  }}</span></span
                >
              </button>
            </div>
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
import VirtualViewport from '@/components/VirtualViewport.vue'
import {
  commitSubject,
  authorInitials,
  historySourceLabel,
  revisionDisplayPath,
} from '@/utils/historyPresentation'
import { fileIconName } from '@/utils/filePresentation'
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
const historyRowHeight = 28
const historyViewport = ref<InstanceType<typeof VirtualViewport> | null>(null)
const historySearch = ref<{ focus: () => void } | null>(null)
const filtersVisible = ref(false)
async function focusHistorySearch() {
  filtersVisible.value = true
  await nextTick()
  historySearch.value?.focus()
}
function toggleHistorySearch() {
  if (filtersVisible.value) filtersVisible.value = false
  else void focusHistorySearch()
}
function compactDate(value: string) {
  return value
    ? new Date(value).toLocaleString(locale.value, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : ''
}
function revisionCommand(command: string) {
  if (command === 'pick') void cherryPick()
  else if (command === 'copy') void copyRevision()
  else openComparison()
}
function selectHistoryRow(
  row: SvnLogEntry,
  event: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>
) {
  if (
    event.shiftKey &&
    selectedLog.value &&
    logs.value.some((entry) => entry.revision === selectedLog.value!.revision)
  ) {
    const first = logs.value.findIndex((entry) => entry.revision === selectedLog.value!.revision)
    const last = logs.value.findIndex((entry) => entry.revision === row.revision)
    selectedRevisions.value = logs.value
      .slice(Math.min(first, last), Math.max(first, last) + 1)
      .map((entry) => entry.revision)
  } else if (event.ctrlKey || event.metaKey) {
    const previous = selectedLog.value?.revision
    const selected = new Set(
      selectedRevisions.value.length ? selectedRevisions.value : previous ? [previous] : []
    )
    if (selected.has(row.revision)) selected.delete(row.revision)
    else selected.add(row.revision)
    selectedRevisions.value = [...selected]
  } else selectedRevisions.value = []
  handleRowClick(row)
}
function navigateHistory(event: KeyboardEvent) {
  if (event.target !== event.currentTarget || !logs.value.length) return
  if (event.key === 'Enter' && selectedRevisions.value.length === 2) {
    event.preventDefault()
    openComparison()
    return
  }
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const current = logs.value.findIndex((entry) => entry.revision === selectedLog.value?.revision)
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? logs.value.length - 1
        : Math.max(0, Math.min(logs.value.length - 1, current + (event.key === 'ArrowUp' ? -1 : 1)))
  selectHistoryRow(logs.value[next], event)
  historyViewport.value?.scrollToIndex(next)
}

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

const historySplit = ref(readPanelSize('orcasvn-history-columns', 68, 40, 75)),
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
      scroll: historyViewport.value?.element?.scrollTop || logScroller.value?.scrollTop || 0,
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
    if (historyViewport.value?.element) historyViewport.value.element.scrollTop = state.scroll
    else if (logScroller.value) logScroller.value.scrollTop = state.scroll
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
  if (
    !selectedRevisions.value.includes(row.revision) &&
    selectedLog.value?.revision !== row.revision
  )
    selectedRevisions.value = []
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
const DEFAULT_LOG_PAGE_SIZE = 50
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
    if (!logs.value.some((entry) => entry.revision === selectedLog.value?.revision)) {
      selectedRevisions.value = []
      if (logs.value.length) handleRowClick(logs.value[0])
      else closeInspector()
    }
    hasMore.value = batch.length > DEFAULT_LOG_PAGE_SIZE
    pageIndex.value = index
    if (hasMore.value) pageCursors.value[index + 1] = logs.value[logs.value.length - 1].revision - 1
    await nextTick()
    historyViewport.value?.resetScroll()
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
.history-list {
  min-width: 0;
  min-height: 0;
  flex: 1;
}
.history-row {
  display: grid;
  grid-template-columns: minmax(200px, 1fr) 126px 82px 156px;
  align-items: center;
  padding: 0 6px 0 0;
  font-size: var(--app-font-size-sm);
  cursor: default;
  user-select: none;
}
.history-row:hover {
  background: var(--md-sys-color-surface-container-high);
}
.history-row.current,
.history-row.selected {
  background: var(--app-color-history-selection-bg);
  color: var(--app-color-history-selection-text);
}
.history-row > [role='gridcell'] {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-subject {
  position: relative;
  display: flex;
  align-items: center;
  height: 100%;
  padding-left: 26px;
  padding-right: 12px;
}
.history-subject::before {
  content: '';
  position: absolute;
  left: 9px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--app-color-history-timeline);
}
.revision-dot {
  position: absolute;
  left: 7px;
  top: calc(50% - 3px);
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--app-color-history-timeline);
}
.history-subject > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.history-author {
  display: flex;
  align-items: center;
  gap: 6px;
}
.history-author > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
}
.author-avatar {
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  border-radius: 3px;
  background: var(--md-sys-color-surface-container-highest);
  color: var(--md-sys-color-on-surface);
  font-weight: 500;
}
.small-avatar {
  width: 18px;
  height: 18px;
  font-size: 10px;
}
.large-avatar {
  width: 44px;
  height: 44px;
  font-size: 18px;
}
.history-date,
.history-revision {
  font-size: var(--app-font-size-xs);
  color: var(--md-sys-color-on-surface-variant);
  font-variant-numeric: tabular-nums;
}
.history-row.current .history-date,
.history-row.current .history-revision,
.history-row.selected .history-date,
.history-row.selected .history-revision {
  color: inherit;
}
.history-footer-tool {
  display: inline-flex;
  gap: 3px;
  align-items: center;
  justify-content: center;
  border: 0;
  background: none;
  color: inherit;
  width: 25px;
  height: 24px;
  cursor: pointer;
}
.history-footer-tool:hover {
  background: var(--md-sys-color-surface-container-high);
}
.history-result {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.revision-menu {
  width: 28px;
  height: 32px;
}
.revision-author-block {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0 15px 58px;
}
.revision-author-block > div {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.revision-author-block small {
  color: var(--md-sys-color-on-surface-variant);
  font-size: var(--app-font-size-xs);
}
.revision-author-block strong {
  font-size: var(--app-font-size-label);
  font-weight: 500;
  overflow-wrap: anywhere;
}
.revision-author-block time {
  font-size: var(--app-font-size-xs);
  color: var(--md-sys-color-on-surface-variant);
}
.revision-source-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 6px;
  border: 1px solid var(--md-sys-color-outline);
  border-radius: 3px;
}
.revision-copy {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: none;
  color: var(--md-sys-color-primary);
  cursor: pointer;
  font: inherit;
}
.revision-files-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 0 7px;
  font-size: var(--app-font-size-xs);
}
.revision-files-heading button {
  border: 0;
  background: none;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
  font: inherit;
}
.revision-summary-files > button {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 26px;
  width: 100%;
  border: 0;
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font: inherit;
  font-size: var(--app-font-size-sm);
  padding: 3px 0;
}
.revision-summary-files > button:hover {
  background: var(--md-sys-color-surface-container-high);
}
.revision-summary-files .el-icon {
  flex-shrink: 0;
}
.revision-summary-path {
  display: flex;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.revision-directory {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.revision-basename {
  flex-shrink: 0;
  max-width: 75%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.revision-status {
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border-radius: 2px;
  font-size: 11px;
  background: var(--app-color-status-modified-bg);
  color: var(--app-color-status-modified-text);
}
.revision-status.action-A {
  background: var(--app-color-status-added-bg);
  color: var(--app-color-status-added-text);
}
.revision-status.action-D {
  background: var(--app-color-status-error-bg);
  color: var(--app-color-status-error-text);
}
@media (max-width: 1050px) {
  .revision-author-block {
    padding-left: 0;
  }
  .revision-message {
    padding-left: 0;
  }
}

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
  overflow: hidden;
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
.log-pagination {
  margin-top: auto;
  flex-shrink: 0;
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
.quiet-icon {
  display: grid;
  place-items: center;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
}
.revision-overview {
  padding: 12px 16px;
  overflow: auto;
  flex: 1;
  min-height: 0;
}
.revision-overview dl {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 7px 12px;
  grid-template-columns: 58px minmax(0, 1fr);
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
  padding: 12px 0 12px 70px;
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
@media (max-width: 1050px) {
  .revision-message { padding-left: 0; }
}
</style>
