<template>
  <div class="log-view">
    <el-card class="log-card">
      <template #header>
        <div class="card-header">
          <span class="card-title">
            <el-icon><Document /></el-icon>
            {{ $t('log.title') }}
          </span>
          <div class="header-actions">
            <el-input
              v-model.number="limit"
              type="number"
              :min="1"
              :max="1000"
              style="width: 120px"
              :placeholder="$t('log.quantity')"
              size="small"
            />
            <el-button @click="loadLogs" :loading="loading" type="primary" size="small">
              <el-icon><Refresh /></el-icon>
              {{ $t('log.load') }}
            </el-button>
          </div>
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

      <div v-else class="log-content">
        <div class="log-filters">
          <el-input
            v-model="filters.author"
            :placeholder="$t('log.searchAuthor')"
            clearable
            size="small"
          />
          <el-input
            v-model="filters.keyword"
            :placeholder="$t('log.searchKeyword')"
            clearable
            size="small"
          />
          <el-input
            v-model="filters.dateFrom"
            type="date"
            :placeholder="$t('log.dateFrom')"
            clearable
            size="small"
          />
          <el-input
            v-model="filters.dateTo"
            type="date"
            :placeholder="$t('log.dateTo')"
            clearable
            size="small"
          />
          <el-button size="small" @click="resetFilters">
            <el-icon><RefreshLeft /></el-icon>
            {{ $t('common.reset') }}
          </el-button>
        </div>

        <el-table
          :data="filteredLogs"
          style="width: 100%"
          max-height="600"
          @row-click="handleRowClick"
          row-key="revision"
          stripe
          highlight-current-row
          class="log-table"
        >
          <el-table-column prop="revision" :label="$t('log.revision')" width="90" sortable align="center">
            <template #default="{ row }">
              <el-tag type="primary" size="small" effect="plain">r{{ row.revision }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="author" :label="$t('log.author')" width="120">
            <template #default="{ row }">
              <div class="author-cell">
                <el-icon><User /></el-icon>
                <span>{{ row.author }}</span>
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
          <el-table-column prop="message" :label="$t('log.commitMessage')" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="message-text">{{ row.message }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="$t('log.changedFiles')" width="110" align="center">
            <template #default="{ row }">
              <el-tag size="small" effect="plain">
                {{ row.changed_paths?.length || 0 }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <el-dialog
        v-model="dialogVisible"
        :title="$t('log.commitDetails')"
        width="60%"
        class="log-dialog"
        destroy-on-close
      >
        <div v-if="selectedLog" class="log-detail">
          <el-descriptions :column="2" border class="detail-descriptions">
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
        
        <template #footer>
          <el-button @click="dialogVisible = false">
            {{ $t('common.close') }}
          </el-button>
        </template>
      </el-dialog>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { svnLog } from '@/api/svn'
import type { SvnLogEntry } from '@/types'
import { useI18n } from 'vue-i18n'
import { useWorkspace } from '@/composables/useWorkspace'

const { t, locale } = useI18n()
const workspaceStore = useWorkspaceStore()
const { openWorkspace: openWorkspaceDialog } = useWorkspace()

const limit = ref(50)
const logs = ref<SvnLogEntry[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const selectedLog = ref<SvnLogEntry | null>(null)
const filters = reactive({
  author: '',
  keyword: '',
  dateFrom: '',
  dateTo: '',
})

const filteredLogs = computed(() => {
  const author = filters.author.trim().toLowerCase()
  const keyword = filters.keyword.trim().toLowerCase()
  const from = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`) : null
  const to = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999`) : null

  return logs.value.filter((entry) => {
    const date = new Date(entry.date)
    const paths = entry.changed_paths?.map((item) => item.path).join('\n') || ''
    const searchable = `${entry.message}\n${paths}\nr${entry.revision}`.toLowerCase()

    return (
      (!author || entry.author.toLowerCase().includes(author)) &&
      (!keyword || searchable.includes(keyword)) &&
      (!from || date >= from) &&
      (!to || date <= to)
    )
  })
})

const openWorkspace = async () => {
  const success = await openWorkspaceDialog(t('dialog.selectSVNWorkspaceDirectory'))
  if (success) {
    loadLogs()
  }
}

const loadLogs = async () => {
  if (!workspaceStore.currentPath) return

  loading.value = true
  try {
    logs.value = await svnLog(workspaceStore.currentPath, limit.value)
  } catch (err) {
    workspaceStore.setError(String(err))
  } finally {
    loading.value = false
  }
}

const handleRowClick = (row: SvnLogEntry) => {
  selectedLog.value = row
  dialogVisible.value = true
}

const resetFilters = () => {
  filters.author = ''
  filters.keyword = ''
  filters.dateFrom = ''
  filters.dateTo = ''
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

onMounted(() => {
  if (workspaceStore.currentPath) {
    loadLogs()
  }
})
</script>

<style scoped>
.log-view {
  height: 100%;
}

.log-card {
  height: 100%;
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
  display: flex;
  gap: var(--app-spacing-sm);
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
  grid-template-columns: minmax(120px, 1fr) minmax(180px, 2fr) minmax(140px, 1fr) minmax(140px, 1fr) auto;
  gap: var(--app-spacing-sm);
  margin-bottom: var(--app-spacing);
}

.log-table {
  border-radius: var(--app-radius-md);
  overflow: hidden;
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
  font-size: 14px;
  color: var(--el-text-color-secondary);
}

.message-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-dialog {
  border-radius: var(--app-radius-lg);
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

.author-info .el-icon,
.date-info .el-icon {
  font-size: 14px;
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
  font-size: 18px;
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
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--el-text-color-primary);
}

.changed-files-table {
  border-radius: var(--app-radius-md);
  overflow: hidden;
}

.file-path {
  font-family: "Cascadia Mono", Consolas, Monaco, monospace;
  font-size: 13px;
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
  .log-dialog {
    width: 90% !important;
  }

  .log-filters {
    grid-template-columns: 1fr;
  }
}
</style>
