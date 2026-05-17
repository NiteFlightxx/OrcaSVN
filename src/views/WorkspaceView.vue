<template>
  <div class="workspace-view">
    <div v-if="!workspaceStore.currentPath" class="empty-workspace">
      <div class="empty-panel">
        <div class="empty-mark">
          <el-icon><FolderOpened /></el-icon>
        </div>
        <h1>{{ $t('workspace.emptyWorkspace') }}</h1>
        <div class="empty-actions">
          <el-button type="primary" @click="openWorkspace">{{ $t('workspace.openWorkspace') }}</el-button>
          <el-button @click="doCheckout">{{ $t('common.checkout') }}</el-button>
        </div>
      </div>
    </div>

    <div v-else class="workspace-content">
      <el-card class="info-card">
        <template #header>
          <div class="card-header">
            <span>{{ $t('workspace.repositoryInfo') }}</span>
            <el-button @click="closeWorkspace">{{ $t('common.close') }}</el-button>
          </div>
        </template>
        <el-alert v-if="workspaceStore.error" type="error" :title="workspaceStore.error" :closable="false" class="mb-4" />
        <el-descriptions :column="2" border v-if="workspaceStore.svnInfo">
          <el-descriptions-item :label="$t('workspace.path')">{{ workspaceStore.svnInfo.path }}</el-descriptions-item>
          <el-descriptions-item label="URL">{{ workspaceStore.svnInfo.url }}</el-descriptions-item>
          <el-descriptions-item :label="$t('workspace.repositoryRoot')">{{ workspaceStore.svnInfo.repository_root }}</el-descriptions-item>
          <el-descriptions-item :label="$t('workspace.revision')">{{ workspaceStore.svnInfo.revision }}</el-descriptions-item>
          <el-descriptions-item :label="$t('workspace.type')">{{ workspaceStore.svnInfo.node_kind }}</el-descriptions-item>
        </el-descriptions>
        <div v-else-if="!workspaceStore.isLoading" class="no-info">{{ $t('workspace.noRepositoryInfo') }}</div>
      </el-card>

      <el-card class="status-card">
        <template #header>
          <div class="card-header">
            <span>{{ $t('workspace.fileStatus') }}</span>
            <div class="header-actions">
              <el-button @click="refreshStatus" :loading="workspaceStore.isLoading">
                <el-icon><Refresh /></el-icon>
                {{ $t('common.refresh') }}
              </el-button>
              <el-button type="primary" @click="doUpdate">
                <el-icon><RefreshRight /></el-icon>
                {{ $t('common.update') }}
              </el-button>
            </div>
          </div>
        </template>

        <div class="status-summary">
          <div class="status-metric modified">
            <span>{{ $t('workspace.statusModified') }}</span>
            <strong>{{ workspaceStore.modifiedCount }}</strong>
          </div>
          <div class="status-metric added">
            <span>{{ $t('workspace.statusAdded') }}</span>
            <strong>{{ workspaceStore.addedCount }}</strong>
          </div>
          <div class="status-metric deleted">
            <span>{{ $t('workspace.statusDeleted') }}</span>
            <strong>{{ workspaceStore.deletedCount }}</strong>
          </div>
        </div>

        <el-table :data="workspaceStore.statusList" style="width: 100%" max-height="400">
          <el-table-column prop="status_code" :label="$t('commit.status')" width="180" align="center">
            <template #default="{ row }">
              <span class="status-badge" :class="getStatusClass(row.status_code)">
                {{ $t(getStatusLabelKey(row.status_code)) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="path" :label="$t('commit.file')" />
          <el-table-column :label="$t('common.action')" width="236" fixed="right">
            <template #default="{ row }">
              <div class="row-actions">
                <el-button link @click="viewDiff(row.path)">
                  <el-icon><Connection /></el-icon>
                  {{ $t('common.diff') }}
                </el-button>
                <el-button link @click="viewBlame(row.path)">
                  <el-icon><Edit /></el-icon>
                  {{ $t('common.blame') }}
                </el-button>
                <el-button link type="danger" @click="revertFile(row.path)">
                  <el-icon><RefreshLeft /></el-icon>
                  {{ $t('common.revert') }}
                </el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-card class="actions-card">
        <template #header>
          <span>{{ $t('workspace.quickActions') }}</span>
        </template>
        <div class="quick-actions">
          <el-button @click="doCommit">
            <el-icon><Upload /></el-icon>
            {{ $t('common.commit') }}
          </el-button>
          <el-button @click="doAdd">
            <el-icon><Plus /></el-icon>
            {{ $t('common.add') }}
          </el-button>
          <el-button @click="doDelete">
            <el-icon><Delete /></el-icon>
            {{ $t('common.delete') }}
          </el-button>
          <el-button @click="doCleanup">
            <el-icon><Brush /></el-icon>
            {{ $t('common.cleanup') }}
          </el-button>
          <el-button @click="doSwitch">
            <el-icon><Switch /></el-icon>
            {{ $t('common.switch') }}
          </el-button>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useWorkspaceStore } from '@/stores/workspace'
import { svnUpdate, svnCleanup, svnRevert, svnAdd, svnDelete, svnSwitch } from '@/api/svn'
import { open } from '@tauri-apps/plugin-dialog'
import { ElMessageBox } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { getStatusClass, getStatusLabelKey } from '@/composables/useSvnStatus'
import { useWorkspace } from '@/composables/useWorkspace'

const { t } = useI18n()
const router = useRouter()
const workspaceStore = useWorkspaceStore()
const { openWorkspace: openWorkspaceDialog, refreshStatus } = useWorkspace()

const openWorkspace = () => openWorkspaceDialog(t('dialog.selectSVNWorkspaceDirectory'))

const doCheckout = () => {
  router.push({ name: 'checkout' })
}

const closeWorkspace = () => {
  workspaceStore.clearWorkspace()
}

const doUpdate = async () => {
  if (!workspaceStore.currentPath) return

  try {
    await svnUpdate(workspaceStore.currentPath)
    await refreshStatus()
  } catch (err) {
    workspaceStore.error = String(err)
  }
}

const doCommit = () => {
  router.push({ name: 'commit' })
}

const doAdd = async () => {
  if (!workspaceStore.currentPath) return

  const selected = await open({
    multiple: true,
    title: t('common.add'),
  })

  if (!selected) return

  const files = Array.isArray(selected) ? selected : [selected]
  try {
    await svnAdd(workspaceStore.currentPath, files)
    await refreshStatus()
  } catch (err) {
    workspaceStore.error = String(err)
  }
}

const doDelete = async () => {
  if (!workspaceStore.currentPath) return

  const selected = await open({
    multiple: true,
    title: t('common.delete'),
  })

  if (!selected) return

  const files = Array.isArray(selected) ? selected : [selected]
  try {
    await svnDelete(workspaceStore.currentPath, files)
    await refreshStatus()
  } catch (err) {
    workspaceStore.error = String(err)
  }
}

const doCleanup = async () => {
  if (!workspaceStore.currentPath) return

  try {
    await svnCleanup(workspaceStore.currentPath)
    await refreshStatus()
  } catch (err) {
    workspaceStore.error = String(err)
  }
}

const doSwitch = async () => {
  if (!workspaceStore.currentPath) return

  try {
    const { value } = await ElMessageBox.prompt(
      t('switch.enterUrl'),
      t('common.switch'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        inputPattern: /^https?:\/\/.+/,
        inputErrorMessage: t('switch.invalidUrl'),
      }
    )

    if (value) {
      await svnSwitch(workspaceStore.currentPath, value)
      await refreshStatus()
    }
  } catch {
    // user cancelled
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
    workspaceStore.error = String(err)
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
}

.empty-panel {
  width: min(520px, 100%);
  padding: 42px;
  border: 1px solid rgba(198, 198, 210, 0.8);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.76);
  box-shadow: var(--md-sys-elevation-2);
  text-align: center;
  backdrop-filter: blur(18px);
}

.empty-panel h1 {
  margin: 18px 0 22px;
  color: #20212a;
  font-size: 22px;
  line-height: 1.25;
}

.empty-mark {
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  margin: 0 auto;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--md-sys-color-primary-container), var(--md-sys-color-secondary-container));
  color: var(--md-sys-color-primary);
  font-size: 34px;
}

.empty-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
}

.workspace-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  padding: 2px;
  height: 100%;
  overflow-y: auto;
}

.info-card,
.status-card,
.actions-card {
  flex-shrink: 0;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.status-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.status-metric {
  min-height: 72px;
  padding: 13px 14px;
  border: 1px solid rgba(198, 198, 210, 0.72);
  border-radius: 8px;
  background: #fff;
}

.status-metric span {
  display: block;
  color: #5b5d6b;
  font-size: 12px;
  font-weight: 700;
}

.status-metric strong {
  display: block;
  margin-top: 6px;
  color: #20212a;
  font-size: 26px;
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

.quick-actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 12px;
}

.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 82px;
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: #f5f5fb;
  font-weight: 800;
}

.status-added {
  color: #15803d;
  font-weight: bold;
  background: #dcfce7;
}

.status-modified {
  color: #a16207;
  font-weight: bold;
  background: #fef9c3;
}

.status-deleted {
  color: #dc2626;
  font-weight: bold;
  background: #fee2e2;
}

.status-unversioned {
  color: #6366f1;
  background: #e0e7ff;
}

.mb-4 {
  margin-bottom: 16px;
}

.no-info {
  color: #999;
  text-align: center;
  padding: 20px;
}

@media (max-width: 720px) {
  .status-summary {
    grid-template-columns: 1fr;
  }
}
</style>
