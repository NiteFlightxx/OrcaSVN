<template>
  <div ref="workspaceElement" class="workspace-view" @keydown="handleWorkspaceKeydown">
    <!-- 未打开工作区时的空状态 -->
    <div v-if="!workspaceStore.currentPath" class="empty-state">
      <div class="empty-content">
        <img class="welcome-mark" src="/forksvn.svg" alt="" />
        <h2>{{ $t('workspace.welcomeTitle') }}</h2>
        <p>{{ $t('workspace.emptyDescription') }}</p>
        <div class="empty-actions">
          <el-button type="primary" @click="openWorkspace">
            <el-icon><FolderOpened /></el-icon>
            {{ $t('workspace.openWorkspace') }}
          </el-button>
          <el-button @click="doCheckout">
            <el-icon><Download /></el-icon>
            {{ $t('common.checkout') }}
          </el-button>
        </div>
      </div>
    </div>

    <!-- 工作区主界面 -->
    <div
      v-else
      class="workspace-layout"
      :style="{
        '--changes-width': `${changeWidth}px`,
        '--composer-height': `${composerHeight}px`,
      }"
    >
      <main class="center-panel">
        <div class="changes-filterbar">
          <label class="changes-search">
            <el-icon aria-hidden="true"><Search /></el-icon>
            <input
              ref="changeSearchInput"
              v-model="fileQuery"
              type="search"
              :placeholder="$t('sourceUI.filterChanges')"
              :aria-label="$t('sourceUI.filterChanges')"
              :title="workspaceName"
            />
          </label>
          <button
            v-if="!conflictsMode"
            :title="$t('sourceUI.discardVisible')"
            :aria-label="$t('sourceUI.discardVisible')"
            :disabled="
              !filteredFiles.length || !staging.ready || flow.busy || pendingFileAction !== null
            "
            @click="discardTargets(filteredFiles.map((file) => file.path))"
          >
            <el-icon><RefreshLeft /></el-icon>
          </button>
          <select
            v-if="!conflictsMode"
            v-model="filter"
            class="changes-status"
            :aria-label="$t('workspace.fileStatus')"
          >
            <option value="all">
              {{ $t('common.all') }} ({{ visibleStatus.length }})
            </option>
            <option value="modified">
              {{ $t('workspace.statusChanged') }} ({{ visibleStatusCounts.modified }})
            </option>
            <option value="added">
              {{ $t('workspace.statusUnversioned') }} ({{ visibleStatusCounts.added }})
            </option>
            <option value="conflicted">
              {{ $t('status.conflicted') }} ({{ visibleStatusCounts.conflicted }})
            </option>
            <option value="missing">
              {{ $t('status.missing') }} ({{ visibleStatusCounts.missing }})
            </option>
          </select>
          <button
            v-if="ignoredCount"
            :title="
              $t('experience.showHidden') +
              ' · ' +
              $t('experience.ignored', { count: ignoredCount })
            "
            :aria-label="$t('experience.showHidden')"
            :aria-pressed="showIgnored"
            @click="showIgnored = !showIgnored"
          >
            <el-icon><Eye v-if="showIgnored" /><EyeOff v-else /></el-icon>
          </button>
          <select v-model="viewMode" :aria-label="$t('sourceUI.viewMode')">
            <option value="tree">{{ $t('sourceUI.tree') }}</option>
            <option value="compact">{{ $t('sourceUI.compact') }}</option>
            <option value="list">{{ $t('sourceUI.list') }}</option>
          </select>
        </div>
        <div v-if="workspaceStore.statusIsStale" class="cached-status-notice" role="status">
          {{ $t('workspace.cachedStatus')
          }}<span v-if="workspaceStore.isLoading"> · {{ $t('common.loading') }}</span>
        </div>

        <p v-if="flow.busy || pendingFileAction !== null" class="staging-notice" role="status">
          {{ actionBlockReason }}
        </p>
        <p v-if="hiddenUnstagedBinariesCount" class="staging-notice" role="status">
          {{ $t('changes.hiddenUnstagedBinaries', { count: hiddenUnstagedBinariesCount }) }}
        </p>
        <!-- 文件列表 -->
        <div class="file-list" :aria-busy="workspaceStore.isLoading">
          <GlassLoading
            :active="
              workspaceStore.isLoading &&
              !workspaceStore.statusIsStale &&
              workspaceStore.statusList.length === 0
            "
            :label="$t('common.loading')"
          />
          <div
            v-if="
              workspaceStore.isLoading &&
              !workspaceStore.statusIsStale &&
              workspaceStore.statusList.length === 0
            "
            class="loading-files"
          >
            <el-skeleton :rows="6" />
          </div>
          <div
            v-else
            class="workspace-change-groups"
            :style="{
              gridTemplateRows: conflictsMode
                ? 'minmax(0, 1fr)'
                : `${groupSplit}fr 4px ${100 - groupSplit}fr`,
            }"
          >
            <WorkspaceChangeTree
              :title="$t(conflictsMode ? 'flow.conflicts' : 'changes.unstaged')"
              :conflict-mode="conflictsMode"
              :total="conflictsMode ? workspaceStore.conflictedCount : unstagedTotal"
              :entries="unstagedFiles"
              :selectable="selectablePaths"
              :staged="false"
              :active="activePanel === false"
              :workspace-key="staging.key"
              :filter-key="`${conflictsMode}|${filter}|${fileQuery}`"
              :view-mode="viewMode"
              :selected-file="selectedFile"
              :disabled="!staging.ready || flow.busy || pendingFileAction !== null"
              :action-pending="pendingFileAction !== null"
              :empty-text="
                $t(
                  conflictsMode
                    ? 'conflictReview.empty'
                    : workspaceStore.statusList.length === 0
                      ? 'workspace.noChanges'
                      : 'changes.noUnstaged'
                )
              "
              @select="selectFile"
              @selection-change="handleChangeSelection"
              @copy-paths="copySelectionPaths"
              @context="openFileContextMenu"
              @discard-targets="discardTargets"
              @toggle-selection="staging.stage"
              @resolve="(paths) => openConflictDialog(paths, false, 'working')"
            />
            <PanelSplitter
              v-if="!conflictsMode"
              axis="y"
              v-model:value="groupSplit"
              :min="20"
              :max="80"
              percent
              :label="$t('sourceUI.resizeGroups')"
            />
            <WorkspaceChangeTree
              v-if="!conflictsMode"
              :title="$t('changes.staged')"
              :total="staging.paths.length"
              :entries="stagedFiles"
              :selectable="selectablePaths"
              :staged="true"
              :active="activePanel === true"
              :workspace-key="staging.key"
              :filter-key="`${filter}|${fileQuery}`"
              :view-mode="viewMode"
              :selected-file="selectedFile"
              :disabled="!staging.ready || flow.busy || pendingFileAction !== null"
              :action-pending="pendingFileAction !== null"
              :empty-text="$t('changes.noStaged')"
              @select="selectFile"
              @selection-change="handleChangeSelection"
              @copy-paths="copySelectionPaths"
              @context="openFileContextMenu"
              @discard-targets="discardTargets"
              @toggle-selection="staging.unstage"
            />
          </div>
        </div>
        <p v-if="!conflictsMode && hiddenStagedCount" class="staging-notice">
          {{ $t('changes.hiddenStaged', { count: hiddenStagedCount }) }}
          <button @click="staging.clear()">
            {{ $t('changes.clearSelection') }}
          </button>
        </p>
        <FileContextMenu
          v-if="fileContextMenu.visible"
          :x="fileContextMenu.x"
          :y="fileContextMenu.y"
          :items="contextItems"
          :notice="
            actionBlockReason || $t('experience.scoped', { count: fileContextMenu.targets.length })
          "
          @action="runContextAction"
          @close="hideFileContextMenu"
        />
      </main>

      <PanelSplitter
        axis="x"
        v-model:value="changeWidth"
        :min="240"
        :max="700"
        :label="$t('sourceUI.resizeChanges')"
      />
      <!-- 右侧面板：差异预览 -->
      <aside class="right-panel">
        <div class="panel-header">
          <span class="panel-title" :title="selectedFile || ''"
            ><el-icon><Connection /></el-icon
            ><span>{{
              selectedConflictPaths.length && !selectedFile
                ? $t('conflictActions.selected', { count: selectedConflictPaths.length })
                : selectedFile || $t('diff.title')
            }}</span></span
          >
          <div
            v-if="selectedFile && !selectedConflict && !selectedDetails?.binary"
            class="panel-tools"
          >
            <span v-if="diffResult" class="compact-diff-stats"
              ><b>+{{ diffStats.added }}</b
              ><i>−{{ diffStats.removed }}</i></span
            ><button
              :title="$t('experience.properties')"
              :aria-label="$t('experience.properties')"
              :aria-pressed="propertiesOpen"
              @click="propertiesOpen = !propertiesOpen"
            >
              <el-icon><List /></el-icon></button
            ><button
              :title="$t('experience.externalDiff')"
              :aria-label="$t('experience.externalDiff')"
              :disabled="flow.busy"
              @click="openExternal"
            >
              <el-icon><Connection /></el-icon>
            </button>
          </div>
        </div>
        <div class="panel-content" :aria-busy="isLoadingDiff">
          <GlassLoading :active="isLoadingDiff" :label="$t('common.loading')" />
          <ConflictInspector
            v-if="lastConflictFile"
            v-show="selectedConflict && selectedConflictPaths.length <= 1"
            :file="lastConflictFile"
            :visible="!!selectedConflict && selectedConflictPaths.length <= 1"
            @resolve="(choice) => openConflictDialog([lastConflictFile!], false, choice)"
          />
          <div
            v-if="
              selectedConflictPaths.length && (!selectedFile || selectedConflictPaths.length > 1)
            "
            class="conflict-batch-summary"
          >
            <strong>{{
              $t('conflictActions.selected', { count: selectedConflictPaths.length })
            }}</strong>
            <p>{{ $t('conflictActions.batchHint') }}</p>
            <div class="conflict-batch-buttons">
              <el-button
                :disabled="!staging.ready || flow.busy"
                @click="openConflictDialog(selectedConflictPaths, false, 'mine-full')"
                >{{ $t('conflictDialog.local') }}</el-button
              >
              <el-button
                :disabled="!staging.ready || flow.busy"
                @click="openConflictDialog(selectedConflictPaths, false, 'theirs-full')"
                >{{ $t('conflictDialog.incoming') }}</el-button
              >
              <el-button
                :disabled="!staging.ready || flow.busy"
                @click="openConflictDialog(selectedConflictPaths, false, 'working')"
                >{{ $t('flow.keepWorking') }}</el-button
              >
            </div>
            <ul>
              <li v-for="path in selectedConflictPaths" :key="path">{{ path }}</li>
            </ul>
          </div>
          <div v-else-if="!selectedFile" class="empty-diff">
            <el-icon><Document /></el-icon>
            <span>{{ $t('diff.selectFile') }}</span>
          </div>
          <template v-else-if="selectedConflict" />
          <div v-else-if="isLoadingDiff" class="loading-diff">
            <el-skeleton :rows="10" />
          </div>
          <div v-else-if="selectedDetails?.binary" class="empty-diff">
            <strong>{{ $t('experience.binary') }}</strong
            ><code>{{ selectedFile }}</code
            ><small>{{ selectedDetails.size?.toLocaleString() }} B</small>
            <p>{{ $t('experience.binaryHint') }}</p>
            <el-button :disabled="flow.busy" @click="openExternal">{{
              $t('experience.externalDiff')
            }}</el-button>
          </div>
          <div v-else-if="diffError" role="alert" class="empty-diff">
            <p>{{ diffError }}</p>
            <el-button @click="loadDiff(selectedFile!)">{{ $t('experience.retry') }}</el-button>
          </div>
          <div v-else-if="diffResult" class="diff-content">
            <pre v-if="propertiesOpen" class="property-diff">{{
              properties || $t('diff.noDiff')
            }}</pre>
            <DiffViewer :text="diffResult.diff" compact @stats="diffStats = $event" />
          </div>
          <div v-else class="empty-diff">
            <el-icon><Document /></el-icon>
            <span>{{ $t('diff.noDiff') }}</span>
          </div>
        </div>
        <PanelSplitter
          v-if="!conflictsMode"
          axis="y"
          v-model:value="composerHeight"
          :min="140"
          :max="420"
          reverse
          :label="$t('sourceUI.resizeCommit')"
        />
        <div v-if="!conflictsMode" class="workspace-commit-composer">
          <CommitMessageEditor compact :disabled="flow.busy" />
          <div class="commit-action-row">
            <small :title="$t('experience.latest')">{{
              $t('sourceUI.selectedForCommit', { count: staging.paths.length })
            }}</small
            ><el-button
              type="primary"
              size="small"
              :disabled="!draft.message || !staging.paths.length || !staging.ready || flow.busy"
              @click="doCommit"
              >{{ $t('changes.reviewCommit') }}</el-button
            >
          </div>
        </div>
      </aside>
    </div>
    <CommitReviewDialog
      :visible-files="filteredFiles.map((file) => file.path)"
      v-if="reviewOpen"
      @close="reviewOpen = false"
    />
    <el-dialog
      v-if="fileTool"
      :model-value="true"
      :title="t('svnTools.' + fileTool.kind)"
      width="min(560px, calc(100vw - 32px))"
      append-to-body
      :close-on-click-modal="false"
      @update:model-value="fileTool = null"
    >
      <form class="workspace-file-tool" @submit.prevent="executeFileTool(fileTool)">
        <code class="file-tool-path">{{ fileTool.target }}</code>
        <p v-if="fileTool.kind === 'delete'">{{ t('svnTools.keepLocal') }}</p>
        <p v-if="fileTool.directory && ['add', 'move', 'copy', 'delete'].includes(fileTool.kind)">
          {{ t('svnTools.folderScope') }}
        </p>
        <p v-if="fileTool.kind === 'lock' || fileTool.kind === 'unlock'">
          {{ t('svnTools.remoteLockHint') }}
        </p>
        <label v-if="fileTool.kind === 'move' || fileTool.kind === 'copy'">
          {{ t('svnTools.relativePath') }}
          <el-input v-model="fileTool.destination" :disabled="fileTool.busy" />
        </label>
        <label v-if="fileTool.kind === 'lock'">
          {{ t('svnTools.lockMessage') }}
          <el-input v-model="fileTool.comment" :disabled="fileTool.busy" />
        </label>
        <label v-if="['changelist', 'setProperty', 'deleteProperty'].includes(fileTool.kind)">
          {{ t(fileTool.kind === 'changelist' ? 'svnTools.changelistName' : 'svnTools.propertyName') }}
          <el-input v-model="fileTool.name" :disabled="fileTool.busy" />
        </label>
        <label v-if="fileTool.kind === 'setProperty'">
          {{ t('svnTools.propertyValue') }}
          <el-input v-model="fileTool.value" type="textarea" :rows="4" :disabled="fileTool.busy" />
        </label>
        <p v-if="fileTool.error" class="file-tool-error" role="alert">{{ fileTool.error }}</p>
        <p v-else-if="!fileTool.readOnly && !fileTool.busy && !isCurrentFileTool(fileTool)" role="status">
          {{ t('fileMenu.changed') }}
        </p>
        <p v-else-if="!fileTool.readOnly && !fileTool.busy && !staging.ready" role="status">
          {{ t('fileMenu.verifyFirst') }}
        </p>
        <p v-else-if="!fileTool.readOnly && !fileTool.busy && !fileToolStatusMatches(fileTool)" role="status">
          {{ t('fileMenu.changed') }}
        </p>
        <p v-else-if="fileTool.busy && fileTool.readOnly" role="status">{{ t('common.loading') }}</p>
        <pre v-else-if="fileTool.readOnly" class="file-tool-output">{{ fileTool.output }}</pre>
        <div v-if="!fileTool.readOnly" class="file-tool-buttons">
          <el-button @click="fileTool = null">{{ t('common.cancel') }}</el-button>
          <el-button
            native-type="submit"
            :type="fileTool.kind === 'delete' || fileTool.kind === 'deleteProperty' ? 'danger' : 'primary'"
            :loading="fileTool.busy"
            :disabled="!canApplyFileTool(fileTool)"
          >{{ t('svnTools.' + fileTool.kind) }}</el-button>
        </div>
      </form>
    </el-dialog>
    <ConflictResolutionDialog
      v-if="conflictRequest"
      :request="conflictRequest"
      @close="conflictRequest = null"
      @resolved="onConflictsResolved"
    />
  </div>
</template>

<script setup lang="ts">
import {
  nextTick,
  onActivated,
  h,
  ref,
  computed,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  reactive,
  watch,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWorkspaceStore } from '@/stores/workspace'
import {
  previewWorkspaceDiscard,
  executeWorkspaceDiscard,
  cancelWorkspaceDiscard,
  revealWorkspaceFile,
  svnDiff,
  workspaceItemDetails,
  openWorkspaceItem,
  ignoreWorkspaceItem,
  exportWorkspacePatch,
  svnWorkspaceAction,
  type SvnWorkspaceAction,
  type WorkspaceItemDetails,
  type DiscardStatusPatch,
} from '@/api/svn'
import { save } from '@tauri-apps/plugin-dialog'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { ElMessageBox } from 'element-plus/es/components/message-box/index'
import { useWorkspace } from '@/composables/useWorkspace'
import { useSettings } from '@/composables/useSettings'
import WorkspaceChangeTree from '@/components/WorkspaceChangeTree.vue'
import PanelSplitter from '@/components/PanelSplitter.vue'
import ConflictResolutionDialog from '@/components/ConflictResolutionDialog.vue'
import type { ConflictRequest, ConflictStrategy } from '@/utils/conflictResolution'
import { readPanelSize } from '@/utils/changeSelection'
import { useStagingStore } from '@/stores/staging'
import { useCommitDraftStore } from '@/stores/commitDraft'
import { useWorkflowStore } from '@/stores/workflows'
import CommitReviewDialog from '@/components/CommitReviewDialog.vue'
import ConflictInspector from '@/components/ConflictInspector.vue'
import { useExternalTool } from '@/composables/useExternalTool'
import { invoke } from '@tauri-apps/api/core'
import { repositoryUi } from '@/utils/repositoryUi'
import CommitMessageEditor from '@/components/CommitMessageEditor.vue'
import FileContextMenu from '@/components/FileContextMenu.vue'
import { normalizePath, type ChangeNode } from '@/utils/changeTree'
import type { FileMenuItem } from '@/utils/fileMenu'
import DiffViewer from '@/components/DiffViewer.vue'
import GlassLoading from '@/components/GlassLoading.vue'
import { writeClipboardText } from '@/utils/clipboard'
import { retainedSelection } from '@/utils/statusSelection'
import { toWorkspaceRelativePath } from '@/utils/workspacePath'
import type { SvnStatus, DiffResult } from '@/types'

const { t } = useI18n()
const router = useRouter(),
  route = useRoute()
const conflictsMode = computed(() => route.name === 'conflicts')
const reviewOpen = ref(false),
  showIgnored = ref(false),
  properties = ref(''),
  propertiesOpen = ref(false),
  diffError = ref('')
const selectedDetails = ref<WorkspaceItemDetails | null>(null)
const workspaceElement = ref<HTMLElement | null>(null)
const workspaceStore = useWorkspaceStore()
const staging = useStagingStore()
const draft = useCommitDraftStore()
const flow = useWorkflowStore()
const { settings } = useSettings()
const {
  openWorkspace: openWorkspaceDialog,
  refreshStatus,
  refreshStatusAfterDiscard,
} = useWorkspace()

const filter = ref<'all' | 'modified' | 'added' | 'conflicted' | 'missing'>('all')
const fileQuery = ref('')
const conflictRequest = ref<ConflictRequest | null>(null)
const changeSearchInput = ref<HTMLInputElement | null>(null)
const activePanel = ref<boolean | null>(null)
const changeWidth = ref(readPanelSize('orcasvn-changes-width', 340, 240, 700))
const groupSplit = ref(readPanelSize('orcasvn-changes-split', 50, 20, 80))
const composerHeight = ref(readPanelSize('orcasvn-fork-composer-height', 160, 140, 420))
const viewMode = ref<'tree' | 'list' | 'compact'>(
  (() => {
    try {
      const value = localStorage.getItem('orcasvn-changes-mode')
      return value === 'list' || value === 'compact' ? value : 'tree'
    } catch {
      return 'tree'
    }
  })()
)
watch([changeWidth, groupSplit, composerHeight, viewMode], () => {
  try {
    localStorage.setItem('orcasvn-changes-width', String(changeWidth.value))
    localStorage.setItem('orcasvn-changes-split', String(groupSplit.value))
    localStorage.setItem('orcasvn-fork-composer-height', String(composerHeight.value))
    localStorage.setItem('orcasvn-changes-mode', viewMode.value)
  } catch {
    /* Keep current panel sizes in memory. */
  }
})
const selectedFile = ref<string | null>(null)
const lastConflictFile = ref<string | null>(null)
const selectedChangePaths = ref<string[]>([])
const selectedConflictPaths = computed(() =>
  selectedChangePaths.value.filter((path) =>
    (workspaceStore.rawStatusList || workspaceStore.statusList).some(
      (entry) =>
        entry.path === path &&
        (entry.status_code === 'conflicted' || entry.prop_status === 'conflicted')
    )
  )
)
const isLoadingDiff = ref(false)
const diffResult = ref<DiffResult | null>(null)
let diffRequestGeneration = 0
let fileActionWorkspaceGeneration = 0
const pendingFileAction = ref<string | null>(null)
const fileActionPhase = ref<'preview' | 'confirm' | 'execute' | 'refresh'>('preview')
const actionBlockReason = computed(() => {
  if (pendingFileAction.value !== null) return t(`fileMenu.discardPhase_${fileActionPhase.value}`)
  if (flow.busy)
    return t('fileMenu.operationBusy', {
      operation: flow.title || t('common.loading'),
    })
  if (!staging.ready) return t('fileMenu.verifyFirst')
  return ''
})
const fileContextMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  file: null as SvnStatus | null,
  path: '',
  targets: [] as string[],
  staged: false,
  multiple: false,
  workspace: '',
  branch: '',
  key: '',
  details: null as WorkspaceItemDetails | null,
})
type FileToolKind =
  | 'info' | 'properties' | 'remoteStatus' | 'export'
  | 'add' | 'delete' | 'move' | 'copy' | 'lock' | 'unlock'
  | 'setProperty' | 'deleteProperty' | 'changelist' | 'removeChangelist'

interface FileToolRequest {
  kind: FileToolKind
  workspace: string
  branch: string
  key: string
  generation: number
  status: SvnStatus[]
  target: string
  directory: boolean
  readOnly: boolean
  destination: string
  comment: string
  name: string
  value: string
  busy: boolean
  error: string
  output: string
}
const fileTool = ref<FileToolRequest | null>(null)
let contextRequest = 0
const contextItems = computed<FileMenuItem[]>(() => {
  const details = fileContextMenu.details,
    file = fileContextMenu.file
  const current =
    fileContextMenu.workspace === workspaceStore.currentPath &&
    fileContextMenu.branch === (workspaceStore.svnInfo?.url || '') &&
    fileContextMenu.key === staging.key
  const ready = current && staging.ready && !flow.busy && pendingFileAction.value === null
  const blockedReason = !current ? t('fileMenu.changed') : actionBlockReason.value || undefined
  const canIgnore = ready && file?.status_code === 'unversioned'
  const history = Boolean(details?.historyUrl) && file?.status_code !== 'added'
  const conflicts = (workspaceStore.rawStatusList || workspaceStore.statusList).filter(
    (entry) =>
      fileContextMenu.targets.includes(entry.path) &&
      (entry.status_code === 'conflicted' || entry.prop_status === 'conflicted')
  )
  if (
    conflicts.length &&
    (conflictsMode.value || conflicts.length === fileContextMenu.targets.length)
  )
    return [
      { id: 'resolve-local', label: t('conflictDialog.local'), disabled: !ready },
      { id: 'resolve-incoming', label: t('conflictDialog.incoming'), disabled: !ready },
      { id: 'resolve-working', label: t('flow.keepWorking'), disabled: !ready },
      {
        id: 'reveal',
        label: t('flow.openFile'),
        separator: true,
        disabled: !current || fileContextMenu.multiple,
      },
      { id: 'copy-relative', label: t('workspace.copyPath'), disabled: !current },
      { id: 'copy-absolute', label: t('workspace.copyAbsolutePath'), disabled: !current },
    ]
  const showTools = !fileContextMenu.multiple && details && fileContextMenu.path !== '.'
  const readable = current && !!fileContextMenu.branch && !flow.busy
  const writable = ready && readable && !conflicts.length
  const versioned = history || file?.status_code === 'added'
  const present = details?.exists && !['deleted', 'missing', 'obstructed'].includes(file?.status_code || '')
  const localItem = showTools && versioned && present
  const fileItem = localItem && details.kind === 'file'
  const tool = (kind: FileToolKind, enabled: boolean, icon: string): FileMenuItem => ({
    id: 'svn-file-' + kind,
    label: t('svnTools.' + kind),
    disabled: !enabled,
    icon,
    title: enabled ? undefined : blockedReason,
    danger: kind === 'delete' || kind === 'deleteProperty',
  })
  const extraTools = [
    ...(showTools && versioned
      ? [tool('info', readable, 'InfoFilled'), tool('properties', readable, 'Document')]
      : []),
    ...(showTools && history ? [tool('remoteStatus', readable, 'Refresh')] : []),
    ...(localItem && history ? [tool('copy', writable, 'CopyDocument')] : []),
    ...(localItem
      ? [
          tool('delete', writable, 'Delete'),
          tool('setProperty', writable, 'Edit'),
          tool('deleteProperty', writable, 'Delete'),
          tool('export', readable, 'Download'),
        ]
      : []),
    ...(fileItem && history
      ? [tool('lock', writable, 'Lock'), tool('unlock', writable, 'Unlock')]
      : []),
    ...(fileItem
      ? [tool('changelist', writable, 'List'), tool('removeChangelist', writable, 'Minus')]
      : []),
  ]
  return [
    {
      id: 'open',
      label: t('fileMenu.open'),
      disabled: !current || fileContextMenu.multiple || !details?.exists,
    },
    {
      id: 'diff',
      label: t('common.diff'),
      disabled: !current || fileContextMenu.multiple || !file,
    },
    {
      id: 'reveal',
      label: t('workspace.openInExplorer'),
      disabled: !current || fileContextMenu.multiple,
    },
    {
      id: 'blame',
      label: t('fileMenu.blame'),
      separator: true,
      disabled: !current || !history || details?.kind !== 'file' || details.binary,
    },
    {
      id: 'history',
      label: t('fileMenu.history'),
      disabled: !current || !history,
    },
    {
      id: 'stage',
      icon: fileContextMenu.staged ? 'Minus' : 'Plus',
      label: t(
        fileContextMenu.multiple
          ? fileContextMenu.staged
            ? 'sourceUI.unstageSelected'
            : 'sourceUI.stageSelected'
          : fileContextMenu.staged
            ? 'changes.unstage'
            : 'changes.stage',
        { count: fileContextMenu.targets.length }
      ),
      separator: true,
      disabled: !ready || !fileContextMenu.targets.some((path) => selectableSet.value.has(path)),
    },
    {
      id: 'discard',
      label: t('fileMenu.discard'),
      danger: true,
      disabled: !ready || !fileContextMenu.targets.length,
      title: blockedReason || t('fileMenu.discardFolderHint'),
      shortcut: 'Delete',
    },
    ...(showTools && present && file?.status_code === 'unversioned'
      ? [tool('add', writable, 'Plus')]
      : []),
    ...(localItem ? [tool('move', writable, 'Edit')] : []),
    ...(extraTools.length
      ? [{ id: 'svn-file-more', icon: 'MoreFilled', label: t('svnTools.fileActions'), children: extraTools }]
      : []),
    ...(conflicts.length
      ? [
          {
            id: 'resolve-conflicts',
            label: t('conflictDialog.menu', { count: conflicts.length }),
            disabled: !ready,
          },
          { id: 'resolve-local', label: t('conflictDialog.local'), disabled: !ready },
          { id: 'resolve-incoming', label: t('conflictDialog.incoming'), disabled: !ready },
          { id: 'resolve-working', label: t('flow.keepWorking'), disabled: !ready },
        ]
      : []),
    {
      id: 'stage-all',
      label: t(fileContextMenu.staged ? 'changes.unstageAll' : 'changes.stageAll'),
      separator: true,
      disabled:
        !ready ||
        !(fileContextMenu.staged ? stagedFiles.value : unstagedFiles.value).some((entry) =>
          selectableSet.value.has(entry.path)
        ),
    },
    {
      id: 'ignore',
      label: t('fileMenu.ignore'),
      disabled: !canIgnore,
      title: t('fileMenu.ignoreHint'),
      children: [
        { id: 'ignore-exact', label: t('fileMenu.ignoreExact') },
        {
          id: 'ignore-extension',
          label: t('fileMenu.ignoreExtension'),
          disabled: details?.kind !== 'file' || !/\.[^/.]+$/.test(fileContextMenu.path),
        },
      ],
    },
    {
      id: 'stash',
      label: t('fileMenu.stash', { count: fileContextMenu.targets.length }),
      separator: true,
      disabled: !ready,
    },
    {
      id: 'patch',
      label: t('fileMenu.patch'),
      disabled:
        !ready ||
        (!fileContextMenu.multiple &&
          (!details ||
            details.binary ||
            (details.kind === 'dir' && file?.status_code === 'unversioned'))),
      title: t('fileMenu.patchHint'),
    },
    {
      id: 'copy-relative',
      label: t('workspace.copyPath'),
      separator: true,
      shortcut: 'Ctrl+C',
    },
    {
      id: 'copy-absolute',
      label: t('workspace.copyAbsolutePath'),
      shortcut: 'Ctrl+Alt+C',
    },
    ...(!staging.ready
      ? [
          {
            id: 'refresh-status',
            label: t('fileMenu.verifyFirst'),
            separator: true,
            disabled: !current || flow.busy || pendingFileAction.value !== null,
          },
        ]
      : []),
  ].map((item) =>
    ['stage', 'stage-all', 'stash', 'patch'].includes(item.id) && !ready
      ? { ...item, title: blockedReason }
      : item
  )
})
const workspaceName = computed(() => {
  const path = workspaceStore.currentPath || ''
  return path.split(/[\\/]/).filter(Boolean).pop() || path
})

const diffStats = ref({ added: 0, removed: 0 })

const displayedStatus = computed(() =>
  showIgnored.value
    ? workspaceStore.rawStatusList || workspaceStore.statusList
    : workspaceStore.statusList
)
const displayedStatusByPath = computed(
  () => new Map(displayedStatus.value.map((entry) => [entry.path, entry]))
)
const selectedSet = computed(() => new Set(staging.paths))
const hideUnstagedBinaries = computed(() => !conflictsMode.value && settings.hideUnstagedBinaries)
const binariesFolder = /(?:^|[\\/])binaries(?:[\\/]|$)/i
const workspaceInBinaries = computed(() => {
  const path = workspaceStore.currentPath
  if (!path) return false
  const root = flow.identity?.root
  const relative = root ? toWorkspaceRelativePath(path, root) : null
  return binariesFolder.test(relative ?? path)
})
const isHiddenUnstagedBinary = (path: string) =>
  hideUnstagedBinaries.value &&
  !selectedSet.value.has(path) &&
  (workspaceInBinaries.value || binariesFolder.test(path))

const visibleStatus = computed(() =>
  hideUnstagedBinaries.value
    ? displayedStatus.value.filter((file) => !isHiddenUnstagedBinary(file.path))
    : displayedStatus.value
)
const hiddenUnstagedBinariesCount = computed(() =>
  displayedStatus.value.length - visibleStatus.value.length
)
const unstagedTotal = computed(() =>
  visibleStatus.value.filter((file) => !selectedSet.value.has(file.path)).length
)
const statusFilters = {
  all: () => true,
  modified: (file: SvnStatus) =>
    ['modified', 'added', 'deleted', 'replaced'].includes(file.status_code) ||
    file.prop_status === 'modified',
  added: (file: SvnStatus) => file.status_code === 'unversioned',
  conflicted: (file: SvnStatus) =>
    file.status_code === 'conflicted' || file.prop_status === 'conflicted',
  missing: (file: SvnStatus) => file.status_code === 'missing',
}
const visibleStatusCounts = computed(() => {
  const counts = { modified: 0, added: 0, conflicted: 0, missing: 0 }
  for (const file of visibleStatus.value) {
    if (statusFilters.modified(file)) counts.modified++
    if (statusFilters.added(file)) counts.added++
    if (statusFilters.conflicted(file)) counts.conflicted++
    if (statusFilters.missing(file)) counts.missing++
  }
  return counts
})
const filteredFiles = computed(() => {
  const query = fileQuery.value.trim().toLocaleLowerCase()
  const matchesStatus = statusFilters[conflictsMode.value ? 'conflicted' : filter.value]
  return visibleStatus.value.filter(
    (file) => matchesStatus(file) && (!query || normalizePath(file.path).toLocaleLowerCase().includes(query))
  )
})

const ignoredCount = computed(() =>
  Math.max(0, (workspaceStore.rawStatusList || []).length - workspaceStore.statusList.length)
)
const selectedConflict = computed(() =>
  (workspaceStore.rawStatusList || workspaceStore.statusList).some(
    (entry) =>
      entry.path === selectedFile.value &&
      (entry.status_code === 'conflicted' || entry.prop_status === 'conflicted')
  )
)
watch([selectedFile, selectedConflict], () => {
  if (selectedConflict.value && selectedFile.value) lastConflictFile.value = selectedFile.value
})
const selectablePaths = computed(() => staging.eligible.map((entry) => entry.path))
const selectableSet = computed(() => new Set(selectablePaths.value))
const stagedFiles = computed(() =>
  filteredFiles.value.filter((file) => selectedSet.value.has(file.path))
)
const unstagedFiles = computed(() =>
  filteredFiles.value.filter((file) => !selectedSet.value.has(file.path))
)
const hiddenStagedCount = computed(() => staging.paths.length - stagedFiles.value.length)

const selectFile = async (file: SvnStatus) => {
  hideFileContextMenu()
  selectedFile.value = file.path
  await loadDiff(file.path)
}

const loadDiff = async (path: string) => {
  const workspacePath = workspaceStore.currentPath
  if (!workspacePath) return
  const generation = ++diffRequestGeneration
  const isCurrent = () =>
    generation === diffRequestGeneration &&
    workspaceStore.currentPath === workspacePath &&
    selectedFile.value === path
  isLoadingDiff.value = true
  diffResult.value = null
  selectedDetails.value = null
  properties.value = ''
  diffError.value = ''
  try {
    const details = await workspaceItemDetails(workspacePath, path)
    if (!isCurrent()) return
    selectedDetails.value = details
    if (details.binary || selectedConflict.value) return
    void invoke<string>('workspace_properties', {
      path: workspacePath,
      file: path,
    })
      .then((value) => {
        if (isCurrent()) properties.value = value
      })
      .catch(() => {})
    const result = await svnDiff(workspacePath, path)
    if (isCurrent()) diffResult.value = result
  } catch (e) {
    if (isCurrent()) {
      diffResult.value = null
      diffError.value = String(e)
    }
  } finally {
    if (isCurrent()) isLoadingDiff.value = false
  }
}

const openWorkspace = () => openWorkspaceDialog(t('dialog.selectSVNWorkspaceDirectory'))

async function openExternal() {
  if (!selectedFile.value) return
  try {
    await useExternalTool().open(selectedFile.value)
  } catch (e) {
    ElMessage.error(String(e))
  }
}
async function selectNextConflict() {
  const next = (workspaceStore.rawStatusList || []).find(
    (entry) => statusFilters.conflicted(entry) && !isHiddenUnstagedBinary(entry.path)
  )
  if (next) {
    activePanel.value = false
    selectedChangePaths.value = [next.path]
    await selectFile(next)
  } else if (conflictsMode.value) {
    selectedFile.value = null
    selectedChangePaths.value = []
  } else if (selectedFile.value) await loadDiff(selectedFile.value)
}
let viewOwner = workspaceStore.currentPath
function saveWorkspaceView() {
  const path = workspaceStore.currentPath
  if (path && path === viewOwner)
    repositoryUi(path).workspace = {
      filter: filter.value,
      query: fileQuery.value,
      selected: selectedFile.value,
      scroll: Array.from(
        workspaceElement.value?.querySelectorAll<HTMLElement>('.virtual-viewport') || []
      ).map((element) => element.scrollTop),
    }
}
async function restoreWorkspaceView() {
  const path = workspaceStore.currentPath
  if (!path) return
  const saved = repositoryUi(path).workspace
  viewOwner = path
  if (!saved) return
  filter.value = saved.filter as typeof filter.value
  fileQuery.value = saved.query
  await nextTick()
  if (path !== workspaceStore.currentPath) return
  const entry = workspaceStore.statusList.find((entry) => entry.path === saved.selected)
  if (entry && !isHiddenUnstagedBinary(entry.path)) {
    activePanel.value = staging.paths.includes(entry.path)
    await selectFile(entry)
  }
  await nextTick()
  workspaceElement.value
    ?.querySelectorAll<HTMLElement>('.virtual-viewport')
    .forEach((element, index) => {
      element.scrollTop = saved.scroll[index] || 0
    })
}
watch(
  () => [route.query.commit, staging.ready],
  () => {
    if (route.name === 'workspace' && route.query.commit === '1' && staging.ready && !flow.busy) {
      const requested = route.query.files
      if (requested)
        staging.stage(
          (Array.isArray(requested) ? requested : [requested]).filter(
            (value): value is string => typeof value === 'string'
          )
        )
      const merge = sessionStorage.getItem('orca_merge_message')
      if (merge) {
        try {
          const data = JSON.parse(merge)
          if (data.root === workspaceStore.currentPath) {
            draft.loadMessage(data.message)
            sessionStorage.removeItem('orca_merge_message')
          }
        } catch {}
      }
      doCommit()
      void router.replace({ name: 'workspace', query: {} })
    }
  },
  { immediate: true }
)
onActivated(async () => {
  restoreWorkspaceView()
  if (conflictsMode.value && !selectedFile.value) await selectNextConflict()
})
watch(conflictsMode, () => {
  selectedChangePaths.value = []
  selectedFile.value = null
  activePanel.value = false
  hideFileContextMenu()
  if (conflictsMode.value) void nextTick().then(selectNextConflict)
})

const doCheckout = () => router.push({ name: 'checkout' })

const doCommit = () => {
  if (staging.ready && !flow.busy && staging.paths.length) reviewOpen.value = true
}

const viewDiff = (path: string) => {
  hideFileContextMenu()
  router.push({ name: 'diff', query: { path } })
}

const hideFileContextMenu = () => {
  contextRequest++
  fileContextMenu.visible = false
  fileContextMenu.file = null
}

const openFileContextMenu = async (
  event: MouseEvent,
  target: ChangeNode,
  staged: boolean,
  selection?: { targets: string[]; count: number }
) => {
  const request = ++contextRequest
  const path = workspaceStore.currentPath
  if (!path) return
  fileContextMenu.multiple = Boolean(selection && selection.count > 1)
  fileContextMenu.file = fileContextMenu.multiple ? null : target.entry || null
  fileContextMenu.path = target.path
  fileContextMenu.targets = [...(selection?.targets || target.targets)]
  fileContextMenu.staged = staged
  fileContextMenu.workspace = path
  fileContextMenu.branch = workspaceStore.svnInfo?.url || ''
  fileContextMenu.key = staging.key
  fileContextMenu.details = null
  fileContextMenu.x = event.clientX
  fileContextMenu.y = event.clientY
  fileContextMenu.visible = true
  if (fileContextMenu.multiple) return
  if (target.entry && !target.children.length) {
    selectedFile.value = target.entry.path
    void loadDiff(target.entry.path)
  }
  try {
    const details = await workspaceItemDetails(path, target.path)
    if (
      request === contextRequest &&
      path === workspaceStore.currentPath &&
      fileContextMenu.visible
    )
      fileContextMenu.details = details
  } catch (error) {
    if (request === contextRequest && fileContextMenu.visible) ElMessage.error(String(error))
  }
}

const isAbsolutePath = (path: string) => {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('/')
}

const joinWorkspacePath = (workspacePath: string, filePath: string) => {
  if (isAbsolutePath(filePath)) return filePath
  const separator = workspacePath.includes('\\') ? '\\' : '/'
  const base = workspacePath.replace(/[\\/]+$/, '')
  const relative = filePath.replace(/^[\\/]+/, '')
  return `${base}${separator}${relative}`
}

const isCurrentFileTool = (request: FileToolRequest) =>
  request.generation === fileActionWorkspaceGeneration &&
  request.workspace === workspaceStore.currentPath &&
  request.branch === workspaceStore.svnInfo?.url &&
  request.key === staging.key

const fileToolStatusMatches = (request: FileToolRequest) =>
  request.status === (workspaceStore.rawStatusList || workspaceStore.statusList)

const canApplyFileTool = (request: FileToolRequest) =>
  isCurrentFileTool(request) && !flow.busy && !request.busy &&
  pendingFileAction.value === null && staging.ready && !workspaceStore.statusIsStale &&
  fileToolStatusMatches(request) &&
  (!['move', 'copy'].includes(request.kind) ||
    (!!request.destination.trim() && normalizePath(request.destination.trim()) !== request.target)) &&
  (!['changelist', 'setProperty', 'deleteProperty'].includes(request.kind) || !!request.name.trim())

function fileToolAction(request: FileToolRequest): SvnWorkspaceAction {
  const { kind, target } = request
  const name = request.name.trim()
  switch (kind) {
    case 'move':
    case 'copy':
      return { kind, target, destination: normalizePath(request.destination.trim()) }
    case 'lock':
      return { kind, target, message: request.comment }
    case 'setProperty':
      return { kind, target, name, value: request.value }
    case 'deleteProperty':
    case 'changelist':
      return { kind, target, name }
    case 'export':
      return { kind, source: target, destination: request.destination }
    default:
      return { kind, target }
  }
}

async function executeFileTool(request: FileToolRequest) {
  if (!isCurrentFileTool(request) || flow.busy || request.busy) return
  if (!request.readOnly && !canApplyFileTool(request)) {
    if (fileTool.value === request) request.error = t('fileMenu.changed')
    return
  }

  const action = fileToolAction(request)
  const title = t('svnTools.' + action.kind)
  const run = () => svnWorkspaceAction(request.workspace, request.branch, action)
  request.busy = true
  request.error = ''
  try {
    if (action.kind === 'export') {
      await flow.perform(title, run, false)
      if (isCurrentFileTool(request)) ElMessage.success(t('common.success'))
    } else if (request.readOnly) {
      const output = await run()
      if (isCurrentFileTool(request)) request.output = output.trim() || t('svnTools.noOutput')
    } else {
      const refresh = !['lock', 'unlock', 'changelist', 'removeChangelist'].includes(action.kind)
      await flow.perform(title, run, true, refresh)
      if (isCurrentFileTool(request)) {
        if (fileTool.value === request) fileTool.value = null
        ElMessage.success(t('common.success'))
      }
    }
  } catch (error) {
    if (isCurrentFileTool(request)) {
      if (fileTool.value === request) request.error = String(error)
      else ElMessage.error(String(error))
    }
  } finally {
    request.busy = false
  }
}

async function startFileTool(kind: FileToolKind, context: typeof fileContextMenu) {
  const target = normalizePath(context.path)
  const request: FileToolRequest = reactive({
    kind,
    target,
    directory: context.details?.kind === 'dir',
    readOnly: ['info', 'properties', 'remoteStatus', 'export'].includes(kind),
    workspace: context.workspace,
    branch: context.branch,
    key: context.key,
    generation: fileActionWorkspaceGeneration,
    status: workspaceStore.rawStatusList || workspaceStore.statusList,
    destination: kind === 'move' ? target : '',
    comment: '',
    name: '',
    value: '',
    busy: false,
    error: '',
    output: '',
  })

  if (kind === 'export') {
    const destination = await save({
      title: t('svnTools.exportPath'),
      defaultPath: target.split('/').pop(),
    })
    if (!destination || !isCurrentFileTool(request)) return
    request.destination = destination
    await executeFileTool(request)
    return
  }
  if ((kind === 'add' && !request.directory) || kind === 'removeChangelist') {
    await executeFileTool(request)
    return
  }
  fileTool.value = request
  if (request.readOnly) await executeFileTool(request)
}

const runContextAction = async (action: string) => {
  const menu = contextItems.value
    .flatMap((item) => [item, ...(item.disabled ? [] : item.children || [])])
    .find((item) => item.id === action)
  if (
    !fileContextMenu.visible ||
    !menu ||
    menu.disabled ||
    fileContextMenu.workspace !== workspaceStore.currentPath ||
    fileContextMenu.key !== staging.key
  )
    return
  const context = { ...fileContextMenu, targets: [...fileContextMenu.targets] }
  hideFileContextMenu()
  try {
    if (action === 'open') await openWorkspaceItem(context.workspace, context.path)
    else if (action === 'reveal') await revealWorkspaceFile(context.workspace, context.path)
    else if (action === 'diff') viewDiff(context.path)
    else if (action === 'copy-relative' || action === 'copy-absolute') {
      const paths = context.multiple ? context.targets : [context.path]
      const target = paths
        .map((path) =>
          action === 'copy-relative'
            ? path
            : path === '.'
              ? context.workspace
              : joinWorkspacePath(context.workspace, path)
        )
        .join('\n')
      await writeClipboardText(target)
      ElMessage.success(t('workspace.pathCopied'))
    } else if (action === 'stage' || action === 'stage-all') {
      const entries = context.staged ? stagedFiles.value : unstagedFiles.value
      const targets = action === 'stage-all' ? entries.map((file) => file.path) : context.targets
      if (context.staged) staging.unstage(targets)
      else staging.stage(targets)
    } else if (action === 'discard') await discardTargets(context.targets)
    else if (action.startsWith('svn-file-'))
      await startFileTool(action.slice('svn-file-'.length) as FileToolKind, context)
    else if (action === 'resolve-conflicts') openConflictDialog(context.targets)
    else if (action === 'resolve-local') openConflictDialog(context.targets, false, 'mine-full')
    else if (action === 'resolve-incoming')
      openConflictDialog(context.targets, false, 'theirs-full')
    else if (action === 'resolve-working') openConflictDialog(context.targets, false, 'working')
    else if (action === 'refresh-status') await refreshStatus()
    else if (action === 'history' && context.details?.historyUrl) {
      await router.push({
        name: 'log',
        query: {
          target: context.details.historyUrl,
          workspace: context.workspace,
          branch: context.branch,
        },
      })
    } else if (action === 'blame')
      await router.push({ name: 'blame', query: { path: context.path } })
    else if (action === 'stash')
      await router.push({
        name: 'stash',
        query: {
          files: context.targets,
          stashWorkspace: context.workspace,
          stashBranch: context.branch,
        },
      })
    else if (action === 'patch') {
      const destination = await save({
        title: t('fileMenu.patch'),
        defaultPath: `${context.path.split('/').pop() || 'changes'}.patch`,
        filters: [{ name: 'Patch', extensions: ['patch', 'diff'] }],
      })
      if (
        !destination ||
        context.workspace !== workspaceStore.currentPath ||
        context.key !== staging.key
      )
        return
      await flow.perform(
        t('fileMenu.patch'),
        async () => {
          await exportWorkspacePatch(
            context.workspace,
            context.targets.map(normalizePath),
            destination,
            context.branch
          )
          return { path: context.path, destination }
        },
        false
      )
      ElMessage.success(t('fileMenu.patchSaved'))
    } else if (action === 'ignore-exact' || action === 'ignore-extension') {
      await flow.perform(t('fileMenu.ignore'), async () => {
        await ignoreWorkspaceItem(
          context.workspace,
          context.path,
          action === 'ignore-extension',
          context.branch
        )
        return { path: context.path, extension: action === 'ignore-extension' }
      })
    }
  } catch (err) {
    ElMessage.error(`${t('common.error')}: ${err}`)
  }
}

const handleChangeSelection = (_paths: string[], singleFile: boolean, staged: boolean) => {
  selectedChangePaths.value = [..._paths]
  activePanel.value = staged
  if (!singleFile) {
    diffRequestGeneration += 1
    selectedFile.value = null
    diffResult.value = null
    isLoadingDiff.value = false
  }
}
const openConflictDialog = (
  targets: string[],
  inspectFresh = false,
  strategy?: ConflictStrategy
) => {
  const path = workspaceStore.currentPath,
    branch = workspaceStore.svnInfo?.url
  if (!path || !branch || !staging.ready || flow.busy) return
  const conflicts = (workspaceStore.rawStatusList || workspaceStore.statusList)
    .filter(
      (entry) =>
        targets.includes(entry.path) &&
        (entry.status_code === 'conflicted' || entry.prop_status === 'conflicted')
    )
    .map((entry) => entry.path)
  const files = inspectFresh ? targets : conflicts
  if (!files.length) return
  conflictRequest.value = {
    workspace: path,
    branch,
    files: [...files],
    otherCount: inspectFresh ? 0 : targets.length - conflicts.length,
    strategy,
  }
}
async function onConflictsResolved() {
  conflictRequest.value = null
  await nextTick()
  await selectNextConflict()
}
const copySelectionPaths = async (paths: string[], absolute: boolean) => {
  const workspace = workspaceStore.currentPath
  if (!workspace || !paths.length) return
  try {
    await writeClipboardText(
      paths
        .map((path) =>
          absolute ? (path === '.' ? workspace : joinWorkspacePath(workspace, path)) : path
        )
        .join('\n')
    )
    ElMessage.success(t('workspace.pathCopied'))
  } catch (error) {
    ElMessage.error(String(error))
  }
}
const handleWorkspaceKeydown = (event: KeyboardEvent) => {
  if (!(event.ctrlKey || event.metaKey)) return
  if (
    event.key.toLowerCase() === 'f' &&
    !(event.target as HTMLElement)?.closest?.('.diff-viewer')
  ) {
    event.preventDefault()
    changeSearchInput.value?.focus()
  }
  if (
    event.shiftKey &&
    ['s', 'u'].includes(event.key.toLowerCase()) &&
    staging.ready &&
    !flow.busy &&
    pendingFileAction.value === null
  ) {
    event.preventDefault()
    if (event.key.toLowerCase() === 's') staging.stage(unstagedFiles.value.map((file) => file.path))
    else staging.unstage(stagedFiles.value.map((file) => file.path))
  }
}

const handleDocumentScroll = (event: Event) => {
  const target = event.target as HTMLElement | null
  if (!target?.closest?.('.file-context-menu')) hideFileContextMenu()
}

const handleDocumentKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') hideFileContextMenu()
}

watch(
  () => visibleStatus.value.map((file) => file.path),
  (paths) => {
    if (retainedSelection(selectedFile.value, paths) === selectedFile.value) return
    diffRequestGeneration += 1
    selectedFile.value = null
    diffResult.value = null
    isLoadingDiff.value = false
  }
)

watch(
  [() => workspaceStore.currentPath, () => workspaceStore.svnInfo?.url],
  () => {
    fileActionWorkspaceGeneration += 1
    diffRequestGeneration += 1
    selectedFile.value = null
    diffResult.value = null
    isLoadingDiff.value = false
    activePanel.value = null
    selectedChangePaths.value = []
    lastConflictFile.value = null
    conflictRequest.value = null
    fileTool.value = null
    reviewOpen.value = false
    fileQuery.value = ''
    hideFileContextMenu()
  },
  { flush: 'sync' }
)

watch(
  [() => staging.key, () => [...staging.paths].sort().join('\n'), filter, fileQuery, hideUnstagedBinaries],
  () => {
    fileActionWorkspaceGeneration += 1
    hideFileContextMenu()
  },
  { flush: 'sync' }
)

onMounted(() => {
  document.addEventListener('orcasvn-save-view', saveWorkspaceView)
  document.addEventListener('orcasvn-restore-view', restoreWorkspaceView)
  document.addEventListener('click', hideFileContextMenu)
  document.addEventListener('contextmenu', hideFileContextMenu)
  document.addEventListener('scroll', handleDocumentScroll, true)
  document.addEventListener('keydown', handleDocumentKeydown)
})

onBeforeUnmount(() => {
  fileActionWorkspaceGeneration += 1
  document.removeEventListener('orcasvn-save-view', saveWorkspaceView)
  document.removeEventListener('orcasvn-restore-view', restoreWorkspaceView)
  document.removeEventListener('click', hideFileContextMenu)
  document.removeEventListener('contextmenu', hideFileContextMenu)
  document.removeEventListener('scroll', handleDocumentScroll, true)
  document.removeEventListener('keydown', handleDocumentKeydown)
})
onDeactivated(() => {
  saveWorkspaceView()
  fileActionWorkspaceGeneration += 1
  hideFileContextMenu()
  fileTool.value = null
  if (!flow.busy) conflictRequest.value = null
})

const discardTargets = async (targets: string[]) => {
  hideFileContextMenu()
  const workspacePath = workspaceStore.currentPath
  if (
    !workspacePath ||
    !targets.length ||
    !staging.ready ||
    flow.busy ||
    pendingFileAction.value !== null ||
    workspaceStore.statusIsStale
  )
    return
  const selectionKey = staging.key
  const branch = workspaceStore.svnInfo?.url || ''
  const targetPaths = new Set(targets)
  const original = targets
    .map((path) => displayedStatusByPath.value.get(path))
    .map((entry) => (entry ? { ...entry } : null))
  if (original.some((entry) => !entry)) return
  if (
    original.some(
      (entry) => entry!.status_code === 'conflicted' || entry!.prop_status === 'conflicted'
    )
  ) {
    openConflictDialog(targets)
    return
  }
  const generation = fileActionWorkspaceGeneration
  const isCurrent = () =>
    generation === fileActionWorkspaceGeneration &&
    workspaceStore.currentPath === workspacePath &&
    staging.key === selectionKey
  const stillSelected = () => {
    if (!isCurrent() || !staging.ready || flow.busy || workspaceStore.statusIsStale) return false
    return original.every((entry) => {
      const current = displayedStatusByPath.value.get(entry!.path)
      return (
        current &&
        current.status_code === entry!.status_code &&
        current.prop_status === entry!.prop_status
      )
    })
  }
  pendingFileAction.value = targets[0]
  fileActionPhase.value = 'preview'
  let planId: string | null = null
  let executionStarted = false
  let refreshedScope = false
  let statusPatch: DiscardStatusPatch | null = null
  let operationError: string | null = null
  let executionEpoch = workspaceStore.epoch
  try {
    const protectedPaths = [
      ...new Set([
        ...(workspaceStore.rawStatusList || workspaceStore.statusList).map((file) => file.path),
        ...staging.paths,
      ]),
    ].filter((path) => !targetPaths.has(path))
    const preview = await previewWorkspaceDiscard(
      workspacePath,
      targets.map(normalizePath),
      branch,
      protectedPaths.map(normalizePath)
    )
    planId = preview.id
    if (!stillSelected()) return
    fileActionPhase.value = 'confirm'
    try {
      await ElMessageBox.confirm(
        h('div', [
          h('p', t('fileMenu.discardConfirm', { count: preview.nodes.length })),
          h(
            'div',
            {
              class: 'workspace-discard-targets',
              tabindex: 0,
              role: 'region',
              'aria-label': t('flow.files'),
            },
            preview.nodes.map((node) =>
              h('div', { class: 'workspace-discard-target' }, [
                h('strong', t(node.remove ? 'common.delete' : 'common.revert') + ': '),
                h('code', { title: node.path }, node.path),
              ])
            )
          ),
        ]),
        t('fileMenu.discard'),
        {
          type: 'warning',
          customClass: 'workspace-file-confirm workspace-discard-confirm',
          confirmButtonText: t('fileMenu.discard'),
          confirmButtonType: 'danger',
          cancelButtonText: t('common.cancel'),
          closeOnClickModal: false,
          autofocus: false,
          distinguishCancelAndClose: true,
        }
      )
    } catch (action) {
      if (action === 'cancel' || action === 'close') return
      throw action
    }
    if (!stillSelected()) return
    executionStarted = true
    executionEpoch = workspaceStore.epoch
    fileActionPhase.value = 'execute'
    const result = await flow.perform(
      t('fileMenu.discard'),
      async () => {
        const result = await executeWorkspaceDiscard(preview.id)
        statusPatch = result.status
        operationError = result.error
        flow.phase = 'refreshing'
        const refreshed = await refreshStatusAfterDiscard(
          workspaceStore.epoch === executionEpoch ? statusPatch : null
        )
        flow.refreshWarning = !refreshed && isCurrent() && workspaceStore.statusIsStale
        refreshedScope = true
        return result
      },
      true,
      false
    )
    statusPatch = result.status
    operationError = result.error
    planId = null
    if (workspaceStore.currentPath === workspacePath && staging.key === selectionKey) {
      if (!result.error && !flow.refreshWarning) ElMessage.success(t('fileMenu.discardCompleted'))
      if (result.error) workspaceStore.setError(result.error)
    }
  } catch (err) {
    if (executionStarted) operationError = String(err)
    if (isCurrent()) {
      if (!executionStarted && /\(conflicted\)/.test(String(err))) openConflictDialog(targets, true)
      else workspaceStore.setError(String(err))
    }
  } finally {
    if (planId) {
      try {
        await cancelWorkspaceDiscard(planId)
      } catch {
        /* Expiry also releases abandoned previews. */
      }
    }
    // Even partial execution returns fresh status for its original scope.
    // Only an unavailable scoped result requires a complete rescan.
    try {
      if (
        executionStarted &&
        !refreshedScope &&
        workspaceStore.currentPath === workspacePath &&
        staging.key === selectionKey
      ) {
        fileActionPhase.value = 'refresh'
        await refreshStatusAfterDiscard(
          workspaceStore.epoch === executionEpoch ? statusPatch : null
        )
        if (
          operationError &&
          workspaceStore.currentPath === workspacePath &&
          staging.key === selectionKey
        )
          workspaceStore.setError(operationError)
        if (
          workspaceStore.currentPath === workspacePath &&
          staging.key === selectionKey &&
          selectedFile.value &&
          targets.includes(selectedFile.value)
        ) {
          diffRequestGeneration += 1
          selectedFile.value = null
          diffResult.value = null
          isLoadingDiff.value = false
        }
      }
    } catch (err) {
      if (workspaceStore.currentPath === workspacePath && staging.key === selectionKey)
        workspaceStore.setError([workspaceStore.error, String(err)].filter(Boolean).join('\n'))
    } finally {
      pendingFileAction.value = null
    }
  }
}
</script>

<style scoped>
.conflict-batch-summary {
  padding: 20px;
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
}
.conflict-batch-summary p {
  font-size: 13px;
  color: var(--md-sys-color-on-surface-variant);
  line-height: 1.6;
}
.conflict-batch-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0;
}
.conflict-batch-summary ul {
  max-height: 50vh;
  overflow: auto;
  list-style: none;
  padding: 0;
  font-size: 12px;
}
.conflict-batch-summary li {
  padding: 5px 0;
  overflow-wrap: anywhere;
}
.selection-hint {
  font-size: var(--app-font-size-xs);
  color: var(--md-sys-color-on-surface-variant);
}
.inspector-tools {
  display: flex;
  gap: 8px;
  padding: 4px 8px;
}
.inspector-tools button {
  border: 0;
  background: none;
  color: var(--md-sys-color-primary);
  cursor: pointer;
  font-size: var(--app-font-size-xs);
}
.property-diff {
  max-height: 30vh;
  overflow: auto;
  white-space: pre-wrap;
  padding: 8px;
  font-size: var(--app-font-size-xs);
}

.workspace-view {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.workspace-layout {
  height: 100%;
  display: grid;
  grid-template-columns: clamp(240px, var(--changes-width), 46%) 4px minmax(0, 1fr);
  min-height: 0;
}
.center-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--md-sys-color-surface-container-lowest);
}
.changes-filterbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  height: 36px;
  min-height: 36px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}
.changes-search {
  display: flex;
  align-items: center;
  min-width: 40px;
  flex: 1;
  height: 26px;
  gap: 5px;
  padding: 0 7px;
  border-radius: var(--app-radius);
  background: var(--workbench-field);
  box-shadow: var(--workbench-stroke);
}
.changes-search:focus-within {
  background: var(--workbench-popover);
  box-shadow: var(--workbench-focus);
}
.changes-search .el-icon {
  flex-shrink: 0;
  color: var(--md-sys-color-on-surface-variant);
}
.changes-search input {
  min-width: 0;
  width: 100%;
  border: 0;
  padding: 0;
  background: transparent;
  font-size: var(--app-font-size-sm);
}
.changes-filterbar .changes-search input:focus-visible {
  outline: 0;
}
.changes-filterbar button {
  display: grid;
  place-items: center;
  min-width: 24px;
  height: 24px;
  padding: 2px;
  border: 0;
  border-radius: var(--app-radius-sm);
  background: none;
  cursor: pointer;
}
.changes-filterbar button:hover:not(:disabled) {
  background: var(--md-sys-state-hover);
}
.changes-filterbar button:disabled {
  opacity: 0.35;
  cursor: default;
}
.changes-filterbar select {
  border: 0;
  min-width: 0;
  background: var(--md-sys-color-surface-container-lowest);
  font-size: var(--app-font-size-xs);
  max-width: 96px;
}
.file-list {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.workspace-change-groups {
  display: grid;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.staging-notice,
.cached-status-notice {
  font-size: var(--app-font-size-xs);
  padding: 6px 8px;
  line-height: 1.4;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  color: var(--md-sys-color-on-surface-variant);
}
.staging-notice button {
  background: none;
  border: 0;
  color: var(--md-sys-color-primary);
  cursor: pointer;
}
.right-panel {
  display: grid;
  grid-template-rows: 30px minmax(100px, 1fr) 4px minmax(140px, var(--composer-height));
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 0 4px;
  background: var(--md-sys-color-surface);
}
.panel-header {
  display: flex;
  align-items: center;
  padding: 0 8px;
  gap: 6px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  font-size: var(--app-font-size-sm);
  color: var(--md-sys-color-on-surface-variant);
}
.panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
}
.panel-content {
  position: relative;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.diff-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.diff-header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 8px;
  font-size: var(--app-font-size-xs);
}
.diff-path-tag {
  max-width: 80%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.diff-stats {
  display: flex;
  gap: 5px;
}
.diff-content :deep(.diff-viewer) {
  flex: 1;
  min-height: 0;
}
.empty-diff {
  display: flex;
  flex: 1;
  gap: 14px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 14px;
}
.empty-diff > .el-icon {
  font-size: 42px;
  opacity: 0.35;
}
.workspace-commit-composer {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
  padding: 8px;
  gap: 6px;
}
.workspace-commit-composer :deep(.commit-message-editor) {
  flex: 1;
  min-height: 0;
}
.workspace-commit-composer :deep(.compact label:last-of-type) {
  flex: 1;
  min-height: 0;
}
.workspace-commit-composer :deep(.el-textarea),
.workspace-commit-composer :deep(.el-textarea__inner) {
  height: 100%;
  min-height: 52px !important;
  max-height: none;
}
.commit-action-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-shrink: 0;
}
.commit-action-row small {
  font-size: var(--app-font-size-xs);
  color: var(--md-sys-color-on-surface-variant);
}
.loading-diff {
  padding: 16px;
}
.empty-state {
  display: grid;
  place-items: center;
  height: 100%;
}
.empty-content {
  text-align: center;
  max-width: 500px;
  padding: 28px;
}
.welcome-mark {
  width: 52px;
  height: 52px;
}
.empty-content h2 {
  margin: 10px 0;
  font-size: 24px;
}
.empty-content p {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 13px;
}
.empty-actions {
  margin-top: 24px;
  display: flex;
  gap: 12px;
  justify-content: center;
}
@media (max-width: 850px) {
  .workspace-layout {
    grid-template-columns: clamp(220px, var(--changes-width), 46%) 4px minmax(0, 1fr);
  }
  .changes-filterbar select {
    max-width: 70px;
  }
  .right-panel {
    grid-template-rows: 30px minmax(60px, 1fr) 4px minmax(140px, var(--composer-height));
  }
}
.workspace-file-tool {
  display: grid;
  gap: 12px;
}
.workspace-file-tool p,
.file-tool-output {
  margin: 0;
}
.file-tool-path,
.file-tool-error,
.file-tool-output {
  overflow-wrap: anywhere;
}
.file-tool-output {
  max-height: 52vh;
  overflow: auto;
  padding: 12px;
  white-space: pre-wrap;
  border-radius: 6px;
  background: var(--md-sys-color-surface-container);
}
.file-tool-error {
  color: var(--md-sys-color-error);
}
.file-tool-buttons {
  display: flex;
  justify-content: flex-end;
}
</style>
