<template>
  <div class="workspace-view">
    <div v-if="!workspaceStore.currentPath" class="empty-workspace">
      <div class="empty-panel animate-scale-in">
        <div class="empty-mark">
          <el-icon><FolderOpened /></el-icon>
        </div>
        <h1>{{ $t('workspace.emptyWorkspace') }}</h1>
        <p class="empty-description">{{ $t('workspace.emptyDescription') }}</p>
        <div class="empty-actions">
          <el-button type="primary" @click="openWorkspace" size="large">
            <el-icon><FolderOpened /></el-icon>
            {{ $t('workspace.openWorkspace') }}
          </el-button>
          <el-button @click="doCheckout" size="large">
            <el-icon><Download /></el-icon>
            {{ $t('common.checkout') }}
          </el-button>
        </div>
      </div>
    </div>

    <div v-else class="workspace-content">
      <div v-if="!infoExpanded && !workspaceStore.error" class="info-collapsed-bar animate-fade-in">
        <span class="card-title">
          <el-icon><InfoFilled /></el-icon>
          {{ $t('workspace.repositoryInfo') }}
        </span>
        <el-button @click="infoExpanded = true" size="small" text>
          <el-icon class="collapse-icon">
            <ArrowDown />
          </el-icon>
          {{ $t('common.view') }}
        </el-button>
      </div>

      <el-card v-else class="info-card animate-fade-in">
        <template #header>
          <div class="card-header">
            <span class="card-title">
              <el-icon><InfoFilled /></el-icon>
              {{ $t('workspace.repositoryInfo') }}
            </span>
            <div class="header-actions">
              <el-button @click="infoExpanded = !infoExpanded" size="small" text>
                <el-icon class="collapse-icon" :class="{ 'is-expanded': infoExpanded }">
                  <ArrowDown />
                </el-icon>
                {{ infoExpanded ? $t('common.close') : $t('common.view') }}
              </el-button>
            </div>
          </div>
        </template>
        <el-alert v-if="workspaceStore.error" type="error" :title="workspaceStore.error" :closable="false" class="mb-4" show-icon />
        <div v-if="infoExpanded">
          <el-descriptions :column="responsiveColumns" border v-if="workspaceStore.svnInfo" class="info-descriptions">
            <el-descriptions-item :label="$t('workspace.path')">
              <span class="path-text">{{ workspaceStore.svnInfo.path }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="URL">
              <span class="url-text">{{ workspaceStore.svnInfo.url }}</span>
            </el-descriptions-item>
            <el-descriptions-item :label="$t('workspace.repositoryRoot')">
              <span class="path-text">{{ workspaceStore.svnInfo.repository_root }}</span>
            </el-descriptions-item>
            <el-descriptions-item :label="$t('workspace.revision')">
              <el-tag type="primary" size="small">r{{ workspaceStore.svnInfo.revision }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item :label="$t('workspace.type')">
              <el-tag size="small">{{ workspaceStore.svnInfo.node_kind }}</el-tag>
            </el-descriptions-item>
          </el-descriptions>
          <div v-else-if="!workspaceStore.isLoading" class="no-info">
            <el-icon><InfoFilled /></el-icon>
            <span>{{ $t('workspace.noRepositoryInfo') }}</span>
          </div>
        </div>
      </el-card>

      <el-card class="status-card animate-fade-in" style="animation-delay: 0.1s">
        <template #header>
          <div class="card-header">
            <span class="card-title">
              <el-icon><List /></el-icon>
              {{ $t('workspace.fileStatus') }}
            </span>
            <div class="header-actions">
              <el-button @click="refreshStatus" :loading="workspaceStore.isLoading" size="small">
                <el-icon><Refresh /></el-icon>
                {{ $t('common.refresh') }}
              </el-button>
              <el-button type="primary" @click="doUpdate" size="small">
                <el-icon><RefreshRight /></el-icon>
                {{ $t('common.update') }}
              </el-button>
            </div>
          </div>
        </template>

        <div class="status-summary">
          <div class="status-metric modified">
            <div class="metric-icon">
              <el-icon><Edit /></el-icon>
            </div>
            <div class="metric-info">
              <span class="metric-label">{{ $t('workspace.statusModified') }}</span>
              <strong class="metric-value">{{ workspaceStore.modifiedCount }}</strong>
            </div>
          </div>
          <div class="status-metric added">
            <div class="metric-icon">
              <el-icon><Plus /></el-icon>
            </div>
            <div class="metric-info">
              <span class="metric-label">{{ $t('workspace.statusAdded') }}</span>
              <strong class="metric-value">{{ workspaceStore.addedCount }}</strong>
            </div>
          </div>
          <div class="status-metric deleted">
            <div class="metric-icon">
              <el-icon><Delete /></el-icon>
            </div>
            <div class="metric-info">
              <span class="metric-label">{{ $t('workspace.statusDeleted') }}</span>
              <strong class="metric-value">{{ workspaceStore.deletedCount }}</strong>
            </div>
          </div>
        </div>

        <div class="selection-toolbar">
          <span class="selection-count">
            {{ $t('workspace.selectedFiles', { count: selectedFiles.length }) }}
          </span>
          <div class="selection-actions">
            <el-button
              type="primary"
              size="small"
              @click="doCommitSelected"
              :disabled="selectedCommittableFiles.length === 0"
            >
              <el-icon><Upload /></el-icon>
              {{ $t('common.commit') }}
            </el-button>
            <el-button
              type="success"
              size="small"
              @click="doAddSelected"
              :disabled="selectedUnversionedFiles.length === 0"
            >
              <el-icon><Plus /></el-icon>
              {{ $t('common.add') }}
            </el-button>
            <el-button
              type="danger"
              size="small"
              @click="doDeleteSelected"
              :disabled="selectedMissingFiles.length === 0"
            >
              <el-icon><Delete /></el-icon>
              {{ $t('workspace.markDeleted') }}
            </el-button>
            <el-button
              size="small"
              @click="doRevertSelected"
              :disabled="selectedRevertableFiles.length === 0"
            >
              <el-icon><RefreshLeft /></el-icon>
              {{ $t('common.revert') }}
            </el-button>
          </div>
        </div>

        <el-table 
          :data="workspaceStore.statusList" 
          style="width: 100%" 
          max-height="400"
          stripe
          highlight-current-row
          class="status-table"
          row-key="path"
          @selection-change="handleSelectionChange"
        >
          <el-table-column type="selection" width="48" align="center" />
          <el-table-column prop="status_code" :label="$t('commit.status')" width="140" align="center">
            <template #default="{ row }">
              <span class="status-badge" :class="getStatusClass(row.status_code)">
                {{ $t(getStatusLabelKey(row.status_code)) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="path" :label="$t('commit.file')" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="file-path">{{ row.path }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="$t('common.action')" width="200" fixed="right" align="center">
            <template #default="{ row }">
              <div class="row-actions">
                <el-button link type="primary" @click="viewDiff(row.path)" size="small">
                  <el-icon><Connection /></el-icon>
                  {{ $t('common.diff') }}
                </el-button>
                <el-button link type="primary" @click="viewBlame(row.path)" size="small">
                  <el-icon><Edit /></el-icon>
                  {{ $t('common.blame') }}
                </el-button>
                <el-button link type="danger" @click="revertFile(row.path)" size="small">
                  <el-icon><RefreshLeft /></el-icon>
                  {{ $t('common.revert') }}
                </el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkspaceStore } from '@/stores/workspace'
import { svnUpdate, svnRevert, svnAdd, svnDelete } from '@/api/svn'
import { ElMessageBox } from 'element-plus/es/components/message-box/index'
import { useI18n } from 'vue-i18n'
import { getStatusClass, getStatusLabelKey } from '@/composables/useSvnStatus'
import { useWorkspace } from '@/composables/useWorkspace'
import type { SvnStatus } from '@/types'

const { t } = useI18n()
const router = useRouter()
const workspaceStore = useWorkspaceStore()
const { openWorkspace: openWorkspaceDialog, refreshStatus } = useWorkspace()

const windowWidth = ref(window.innerWidth)
const infoExpanded = ref(false)
const selectedFiles = ref<SvnStatus[]>([])

const responsiveColumns = computed(() => {
  return windowWidth.value > 860 ? 2 : 1
})

const committableStatuses = new Set(['added', 'modified', 'deleted', 'replaced'])

const isCommittable = (file: SvnStatus) => committableStatuses.has(file.status_code) || file.prop_status === 'modified'

const selectedCommittableFiles = computed(() => selectedFiles.value.filter(isCommittable))
const selectedUnversionedFiles = computed(() => selectedFiles.value.filter((file) => file.status_code === 'unversioned'))
const selectedMissingFiles = computed(() => selectedFiles.value.filter((file) => file.status_code === 'missing'))
const selectedRevertableFiles = computed(() => selectedFiles.value.filter((file) => isCommittable(file) || file.status_code === 'missing'))

const updateWindowWidth = () => {
  windowWidth.value = window.innerWidth
}

onMounted(() => {
  window.addEventListener('resize', updateWindowWidth)
})

onUnmounted(() => {
  window.removeEventListener('resize', updateWindowWidth)
})

const openWorkspace = () => openWorkspaceDialog(t('dialog.selectSVNWorkspaceDirectory'))

const doCheckout = () => {
  router.push({ name: 'checkout' })
}

const doUpdate = async () => {
  if (!workspaceStore.currentPath) return

  try {
    await svnUpdate(workspaceStore.currentPath)
    await refreshStatus()
  } catch (err) {
    workspaceStore.setError(String(err))
  }
}

const handleSelectionChange = (rows: SvnStatus[]) => {
  selectedFiles.value = rows
}

const doCommitSelected = () => {
  const files = selectedCommittableFiles.value.map((file) => file.path)
  if (files.length === 0) return
  router.push({ name: 'commit', query: { files } })
}

const doAddSelected = async () => {
  if (!workspaceStore.currentPath) return
  if (selectedUnversionedFiles.value.length === 0) return

  const files = selectedUnversionedFiles.value.map((file) => file.path)
  try {
    await ElMessageBox.confirm(
      t('workspace.addUnversionedConfirm', { count: files.length }),
      t('workspace.quickAddUnversioned'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      }
    )
  } catch {
    return
  }

  try {
    await svnAdd(workspaceStore.currentPath, files)
    await refreshStatus()
  } catch (err) {
    workspaceStore.setError(String(err))
  }
}

const doDeleteSelected = async () => {
  if (!workspaceStore.currentPath) return
  if (selectedMissingFiles.value.length === 0) return

  const files = selectedMissingFiles.value.map((file) => file.path)
  try {
    await ElMessageBox.confirm(
      t('workspace.deleteMissingConfirm', { count: files.length }),
      t('workspace.quickDeleteMissing'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      }
    )
  } catch {
    return
  }

  try {
    await svnDelete(workspaceStore.currentPath, files)
    await refreshStatus()
  } catch (err) {
    workspaceStore.setError(String(err))
  }
}

const doRevertSelected = async () => {
  if (!workspaceStore.currentPath) return
  if (selectedRevertableFiles.value.length === 0) return

  const files = selectedRevertableFiles.value.map((file) => file.path)
  try {
    await ElMessageBox.confirm(
      t('workspace.revertSelectedConfirm', { count: files.length }),
      t('common.revert'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      }
    )
  } catch {
    return
  }

  try {
    await svnRevert(workspaceStore.currentPath, files)
    await refreshStatus()
  } catch (err) {
    workspaceStore.setError(String(err))
  }
}

const viewDiff = (path: string) => {
  router.push({ name: 'diff', query: { path } })
}

const viewBlame = (path: string) => {
  router.push({ name: 'blame', query: { path } })
}

const revertFile = async (path: string) => {
  if (!workspaceStore.currentPath) return

  try {
    await svnRevert(workspaceStore.currentPath, [path])
    await refreshStatus()
  } catch (err) {
    workspaceStore.setError(String(err))
  }
}
</script>

<style scoped>
.workspace-view {
  height: 100%;
}

.empty-workspace {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  padding: var(--app-spacing-lg);
}

.empty-panel {
  width: min(520px, 100%);
  padding: var(--app-spacing-xl);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--app-radius-lg);
  background: rgba(255, 255, 255, 0.82);
  box-shadow: var(--md-sys-elevation-2);
  text-align: center;
  backdrop-filter: blur(20px);
}

.empty-panel h1 {
  margin: var(--app-spacing-lg) 0 var(--app-spacing-sm);
  color: #20212a;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.3;
}

.empty-description {
  color: var(--el-text-color-secondary);
  margin-bottom: var(--app-spacing-lg);
  font-size: 14px;
}

.empty-mark {
  display: grid;
  place-items: center;
  width: 80px;
  height: 80px;
  margin: 0 auto;
  border-radius: var(--app-radius-md);
  background: linear-gradient(135deg, var(--md-sys-color-primary-container), var(--md-sys-color-secondary-container));
  color: var(--md-sys-color-primary);
  font-size: 36px;
  box-shadow: var(--md-sys-elevation-2);
}

.empty-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--app-spacing);
}

.workspace-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
  gap: var(--app-spacing-md);
  padding: 2px;
  height: 100%;
  overflow-y: auto;
}

.info-card,
.status-card {
  flex-shrink: 0;
}

.info-collapsed-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 48px;
  padding: 0 var(--app-spacing-md);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--app-radius-lg);
  background: var(--el-bg-color);
  box-shadow: var(--md-sys-elevation-1);
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
  display: flex;
  gap: var(--app-spacing-sm);
}

.collapse-icon {
  transition: transform var(--app-transition-fast);
}

.collapse-icon.is-expanded {
  transform: rotate(180deg);
}

.info-descriptions {
  margin-top: var(--app-spacing-sm);
}

.path-text {
  font-family: "Cascadia Mono", Consolas, Monaco, monospace;
  font-size: 13px;
  word-break: break-all;
}

.url-text {
  color: var(--md-sys-color-primary);
  word-break: break-all;
}

.no-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--app-spacing-sm);
  color: var(--el-text-color-secondary);
  text-align: center;
  padding: var(--app-spacing-lg);
}

.status-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--app-spacing);
  margin-bottom: var(--app-spacing-md);
}

.status-metric {
  display: flex;
  align-items: center;
  gap: var(--app-spacing);
  min-height: 80px;
  padding: var(--app-spacing-md);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--app-radius-md);
  background: #fff;
  transition: transform var(--app-transition-fast), box-shadow var(--app-transition-fast);
}

.status-metric:hover {
  transform: translateY(-2px);
  box-shadow: var(--md-sys-elevation-2);
}

.metric-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: var(--app-radius);
  font-size: 20px;
  flex-shrink: 0;
}

.status-metric.modified .metric-icon {
  background: #fef9c3;
  color: #a16207;
}

.status-metric.added .metric-icon {
  background: #dcfce7;
  color: #15803d;
}

.status-metric.deleted .metric-icon {
  background: #fee2e2;
  color: #dc2626;
}

.metric-info {
  overflow: hidden;
}

.metric-label {
  display: block;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.metric-value {
  display: block;
  margin-top: 4px;
  color: #20212a;
  font-size: 28px;
  font-weight: 800;
  line-height: 1;
}

.status-metric.modified {
  background: linear-gradient(135deg, #fef9c3, #fff);
}

.status-metric.added {
  background: linear-gradient(135deg, #dcfce7, #fff);
}

.status-metric.deleted {
  background: linear-gradient(135deg, #fee2e2, #fff);
}

.status-table {
  border-radius: var(--app-radius-md);
  overflow: hidden;
}

.file-path {
  font-family: "Cascadia Mono", Consolas, Monaco, monospace;
  font-size: 13px;
}

.selection-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--app-spacing);
  padding: var(--app-spacing-sm) 0 var(--app-spacing);
}

.selection-count {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 600;
}

.selection-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--app-spacing-sm);
}

.row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 82px;
  height: 28px;
  padding: 0 var(--app-spacing);
  border-radius: var(--app-radius-full);
  background: #f5f5fb;
  font-weight: 700;
  font-size: 12px;
}

.status-missing {
  color: #9333ea;
  background: #f3e8ff;
}

.mb-4 {
  margin-bottom: var(--app-spacing-md);
}

@media (max-width: 860px) {
  .status-summary {
    grid-template-columns: 1fr;
  }

  .selection-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (max-width: 640px) {
  .empty-panel {
    padding: var(--app-spacing-lg);
  }
  
  .empty-panel h1 {
    font-size: 20px;
  }
  
  .status-metric {
    min-height: 70px;
    padding: var(--app-spacing);
  }
  
  .metric-value {
    font-size: 24px;
  }
  
  .selection-actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
