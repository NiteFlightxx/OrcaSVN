<template>
  <div ref="workspaceElement" class="workspace-view" @keydown="handleWorkspaceKeydown">
    <!-- 未打开工作区时的空状态 -->
    <div v-if="!workspaceStore.currentPath" class="empty-state">
      <aside class="welcome-sidebar">
        <div class="sidebar-section">
          <div class="sidebar-heading">{{ $t('workspace.quickActions') }}</div>
          <button class="sidebar-row active" @click="openWorkspace">
            <el-icon><FolderOpened /></el-icon>
            {{ $t('workspace.openWorkspace') }}
          </button>
          <button class="sidebar-row" @click="doCheckout">
            <el-icon><Download /></el-icon>
            {{ $t('common.checkout') }}
          </button>
        </div>
      </aside>
      <div class="empty-content">
        <div class="welcome-mark">
          <el-icon><FolderOpened /></el-icon>
        </div>
        <span class="welcome-eyebrow">{{ $t('workspace.svnClient') }}</span>
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
      <!-- 左侧面板：工作区信息 -->
      <aside class="left-panel">
        <div class="repository-name">
          <strong>{{ workspaceName }}</strong>
          <button
            :aria-label="$t('workspace.closeWorkspace')"
            :title="$t('workspace.closeWorkspace')"
            @click="closeWorkspace"
          >
            <el-icon><Close /></el-icon>
          </button>
        </div>
        <div class="sidebar-section">
          <div class="sidebar-heading">{{ $t('workspace.workingCopy') }}</div>
          <button class="sidebar-row active" @click="setFilter('all')">
            <el-icon><Document /></el-icon>
            <span>{{ $t('workspace.fileStatus') }}</span>
            <b>{{ workspaceStore.statusList.length }}</b>
          </button>
          <button class="sidebar-row" @click="doCommit">
            <el-icon><Upload /></el-icon>
            <span>{{ $t('common.commit') }}</span>
          </button>
        </div>
        <div class="sidebar-section">
          <div class="sidebar-heading">{{ $t('workspace.repository') }}</div>
          <button class="sidebar-row" @click="router.push({ name: 'log' })">
            <el-icon><List /></el-icon>
            <span>{{ $t('menu.log') }}</span>
          </button>
          <button class="sidebar-row" @click="router.push({ name: 'blame' })">
            <el-icon><Edit /></el-icon>
            <span>{{ $t('menu.blame') }}</span>
          </button>
        </div>
        <div v-if="workspaceStore.svnInfo" class="repository-meta">
          <div>
            <span>URL</span><strong>{{ workspaceStore.svnInfo.url }}</strong>
          </div>
          <div>
            <span>{{ $t('workspace.revision') }}</span
            ><strong>r{{ workspaceStore.svnInfo.revision }}</strong>
          </div>
        </div>
        <div class="sidebar-actions">
          <button @click="doCleanup">
            <el-icon><Brush /></el-icon>{{ $t('common.cleanup') }}
          </button>
        </div>
      </aside>

      <!-- 中间面板：文件列表 -->
      <main class="center-panel">
        <div class="changes-filterbar">
          <input
            ref="changeSearchInput"
            v-model="fileQuery"
            type="search"
            :placeholder="$t('sourceUI.filterChanges')"
            :aria-label="$t('sourceUI.filterChanges')"
            :title="workspaceName"
          />
          <button
            :title="$t('sourceUI.discardVisible')"
            :aria-label="$t('sourceUI.discardVisible')"
            :disabled="
              !filteredFiles.length || !staging.ready || flow.busy || pendingFileAction !== null
            "
            @click="discardTargets(filteredFiles.map((file) => file.path))"
          >
            <el-icon><RefreshLeft /></el-icon>
          </button>
          <select v-model="filter" :aria-label="$t('workspace.fileStatus')">
            <option value="all">
              {{ $t('common.all') }} ({{ workspaceStore.statusList.length }})
            </option>
            <option value="modified">
              {{ $t('workspace.statusChanged') }} ({{ workspaceStore.changedCount }})
            </option>
            <option value="added">
              {{ $t('workspace.statusUnversioned') }} ({{ workspaceStore.unversionedCount }})
            </option>
            <option value="conflicted">
              {{ $t('status.conflicted') }} ({{ workspaceStore.conflictedCount }})
            </option>
            <option value="missing">
              {{ $t('status.missing') }} ({{ workspaceStore.missingCount }})
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
              gridTemplateRows: `${groupSplit}fr 4px ${100 - groupSplit}fr`,
            }"
          >
            <WorkspaceChangeTree
              :title="$t('changes.unstaged')"
              :total="
                workspaceStore.statusList.filter((file) => !selectedSet.has(file.path)).length
              "
              :entries="unstagedFiles"
              :selectable="selectablePaths"
              :staged="false"
              :active="activePanel === false"
              :workspace-key="staging.key"
              :filter-key="`${filter}|${fileQuery}`"
              :view-mode="viewMode"
              :selected-file="selectedFile"
              :disabled="!staging.ready || flow.busy || pendingFileAction !== null"
              :action-pending="pendingFileAction !== null"
              :empty-text="
                $t(
                  workspaceStore.statusList.length === 0
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
            />
            <PanelSplitter
              axis="y"
              v-model:value="groupSplit"
              :min="20"
              :max="80"
              percent
              :label="$t('sourceUI.resizeGroups')"
            />
            <WorkspaceChangeTree
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
        <p v-if="hiddenStagedCount" class="staging-notice">
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
            ><span>{{ selectedFile || $t('diff.title') }}</span></span
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
          <div v-if="!selectedFile" class="empty-diff">
            <el-icon><Document /></el-icon>
            <span>{{ $t('diff.selectFile') }}</span>
          </div>
          <ConflictInspector
            v-else-if="selectedConflict"
            :file="selectedFile"
            @resolved="selectNextConflict"
          />
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
          axis="y"
          v-model:value="composerHeight"
          :min="140"
          :max="420"
          reverse
          :label="$t('sourceUI.resizeCommit')"
        />
        <div class="workspace-commit-composer">
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
    <ConflictResolutionDialog
      v-if="conflictRequest"
      :request="conflictRequest"
      @close="conflictRequest = null"
      @resolved="conflictRequest = null"
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
  svnCleanup,
  svnDiff,
  workspaceItemDetails,
  openWorkspaceItem,
  ignoreWorkspaceItem,
  exportWorkspacePatch,
  type WorkspaceItemDetails,
  type DiscardStatusPatch,
} from '@/api/svn'
import { save } from '@tauri-apps/plugin-dialog'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { ElMessageBox } from 'element-plus/es/components/message-box/index'
import { useWorkspace } from '@/composables/useWorkspace'
import WorkspaceChangeTree from '@/components/WorkspaceChangeTree.vue'
import PanelSplitter from '@/components/PanelSplitter.vue'
import ConflictResolutionDialog from '@/components/ConflictResolutionDialog.vue'
import type { ConflictRequest } from '@/utils/conflictResolution'
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
import type { SvnStatus, DiffResult } from '@/types'

const { t } = useI18n()
const router = useRouter(),
  route = useRoute()
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
let contextRequest = 0
const contextItems = computed<FileMenuItem[]>(() => {
  const details = fileContextMenu.details,
    file = fileContextMenu.file
  const current =
    fileContextMenu.workspace === workspaceStore.currentPath && fileContextMenu.key === staging.key
  const ready = current && staging.ready && !flow.busy && pendingFileAction.value === null
  const blockedReason = !current ? t('fileMenu.changed') : actionBlockReason.value || undefined
  const canIgnore = ready && file?.status_code === 'unversioned'
  const history = Boolean(details?.historyUrl) && file?.status_code !== 'added'
  const conflicts = (workspaceStore.rawStatusList || workspaceStore.statusList).filter(
    (entry) =>
      fileContextMenu.targets.includes(entry.path) &&
      (entry.status_code === 'conflicted' || entry.prop_status === 'conflicted')
  )
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
    ...(conflicts.length
      ? [
          {
            id: 'resolve-conflicts',
            label: t('conflictDialog.menu', { count: conflicts.length }),
            disabled: !ready,
          },
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
const filteredFiles = computed(() => {
  const query = fileQuery.value.trim().toLocaleLowerCase()
  return displayedStatus.value
    .filter((file) => !query || normalizePath(file.path).toLocaleLowerCase().includes(query))
    .filter((f) => {
      if (filter.value === 'modified')
        return (
          ['modified', 'added', 'deleted', 'replaced'].includes(f.status_code) ||
          f.prop_status === 'modified'
        )
      if (filter.value === 'added') return f.status_code === 'unversioned'
      if (filter.value === 'conflicted')
        return f.status_code === 'conflicted' || f.prop_status === 'conflicted'
      if (filter.value === 'missing') return f.status_code === 'missing'
      return true
    })
})

const ignoredCount = computed(() =>
  Math.max(0, (workspaceStore.rawStatusList || []).length - workspaceStore.statusList.length)
)
const selectedConflict = computed(() =>
  (workspaceStore.rawStatusList || []).some(
    (entry) =>
      entry.path === selectedFile.value &&
      (entry.status_code === 'conflicted' || entry.prop_status === 'conflicted')
  )
)
const selectedSet = computed(() => new Set(staging.paths))
const selectablePaths = computed(() => staging.eligible.map((entry) => entry.path))
const selectableSet = computed(() => new Set(selectablePaths.value))
const stagedFiles = computed(() =>
  filteredFiles.value.filter((file) => selectedSet.value.has(file.path))
)
const unstagedFiles = computed(() =>
  filteredFiles.value.filter((file) => !selectedSet.value.has(file.path))
)
const hiddenStagedCount = computed(() => staging.paths.length - stagedFiles.value.length)

const setFilter = (f: typeof filter.value) => {
  filter.value = f
}

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

const closeWorkspace = () => {
  diffRequestGeneration += 1
  workspaceStore.clearWorkspace()
  selectedFile.value = null
  diffResult.value = null
  isLoadingDiff.value = false
}

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
    (entry) => entry.status_code === 'conflicted' || entry.prop_status === 'conflicted'
  )
  if (next) await selectFile(next)
  else if (selectedFile.value) await loadDiff(selectedFile.value)
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
  if (entry) {
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
onActivated(restoreWorkspaceView)

const doCheckout = () => router.push({ name: 'checkout' })

const doCommit = () => {
  if (staging.ready && !flow.busy && staging.paths.length) reviewOpen.value = true
}

const doCleanup = async () => {
  if (!workspaceStore.currentPath) return
  try {
    await flow.perform(t('common.cleanup'), () => svnCleanup(workspaceStore.currentPath!))
  } catch (err) {
    workspaceStore.setError(String(err))
  }
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

const runContextAction = async (action: string) => {
  const menu = contextItems.value
    .flatMap((item) => [item, ...(item.disabled ? [] : item.children || [])])
    .find((item) => item.id === action)
  if (
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
    else if (action === 'resolve-conflicts') openConflictDialog(context.targets)
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
      await router.push({ name: 'stash', query: { files: context.targets } })
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
  activePanel.value = staged
  if (!singleFile) {
    diffRequestGeneration += 1
    selectedFile.value = null
    diffResult.value = null
    isLoadingDiff.value = false
  }
}
const openConflictDialog = (targets: string[], inspectFresh = false) => {
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
  }
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
  () => workspaceStore.statusList.map((file) => file.path),
  (paths) => {
    if (retainedSelection(selectedFile.value, paths) === selectedFile.value) return
    diffRequestGeneration += 1
    selectedFile.value = null
    diffResult.value = null
    isLoadingDiff.value = false
  }
)

watch(
  () => [workspaceStore.currentPath, workspaceStore.svnInfo?.url],
  () => {
    fileActionWorkspaceGeneration += 1
    diffRequestGeneration += 1
    selectedFile.value = null
    diffResult.value = null
    isLoadingDiff.value = false
    activePanel.value = null
    conflictRequest.value = null
    reviewOpen.value = false
    fileQuery.value = ''
    hideFileContextMenu()
  },
  { flush: 'sync' }
)

watch(
  () => [staging.key, [...staging.paths].sort().join('\n'), filter.value, fileQuery.value],
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
  conflictRequest.value = null
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
  const original = targets
    .map((path) => displayedStatus.value.find((entry) => entry.path === path))
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
  const stillSelected = () =>
    isCurrent() &&
    staging.ready &&
    !flow.busy &&
    !workspaceStore.statusIsStale &&
    original.every((entry) => {
      const current = displayedStatus.value.find((file) => file.path === entry!.path)
      return (
        current &&
        current.status_code === entry!.status_code &&
        current.prop_status === entry!.prop_status
      )
    })
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
    ].filter((path) => !targets.includes(path))
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
        await refreshStatusAfterDiscard(
          workspaceStore.epoch === executionEpoch ? statusPatch : null
        )
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
      if (!result.error) ElMessage.success(t('fileMenu.discardCompleted'))
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
.selection-hint {
  font-size: 11px;
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
  font-size: 11px;
}
.property-diff {
  max-height: 30vh;
  overflow: auto;
  white-space: pre-wrap;
  padding: 8px;
  font-size: 11px;
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
.left-panel,
.welcome-sidebar {
  display: none;
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
.changes-filterbar input {
  min-width: 40px;
  flex: 1;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 12px;
  padding: 3px 8px;
  background: var(--md-sys-color-surface-container-lowest);
  font-size: 12px;
}
.changes-filterbar button {
  display: grid;
  place-items: center;
  min-width: 24px;
  height: 24px;
  padding: 2px;
  border: 0;
  background: none;
  cursor: pointer;
}
.changes-filterbar button:disabled {
  opacity: 0.35;
  cursor: default;
}
.changes-filterbar select,
.changes-status-filter select {
  border: 0;
  min-width: 0;
  background: var(--md-sys-color-surface-container-lowest);
  font-size: 11px;
  max-width: 96px;
}
.changes-status-filter {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 26px;
  min-height: 26px;
  padding: 0 8px;
  font-size: 11px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  color: var(--md-sys-color-on-surface-variant);
}
.changes-status-filter select {
  max-width: 220px;
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
  font-size: 11px;
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
  font-size: 12px;
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
  font-size: 11px;
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
  font-size: 11px;
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
  font-size: 48px;
  opacity: 0.5;
}
.welcome-eyebrow {
  color: var(--md-sys-color-primary);
  font-size: 12px;
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
</style>
