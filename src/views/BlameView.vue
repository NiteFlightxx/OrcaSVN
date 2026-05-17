<template>
  <div class="blame-view">
    <el-card class="blame-card">
      <template #header>
        <div class="card-header">
          <span class="view-title">
            <el-icon><Edit /></el-icon>
            {{ $t('blame.title') }}
          </span>
          <div class="header-actions">
            <el-input
              v-model="currentPath"
              :placeholder="$t('diff.filePath')"
              clearable
              class="path-input"
            >
              <template #prepend>
                <el-icon><Document /></el-icon>
              </template>
            </el-input>
            <el-button @click="loadBlame" :loading="loading">
              <el-icon><Edit /></el-icon>
              {{ $t('blame.load') }}
            </el-button>
          </div>
        </div>
      </template>

      <div v-if="!blameLines.length && !loading" class="empty-blame">
        <el-empty :description="$t('blame.selectFileToBlame')" />
      </div>

      <div v-else-if="loading" class="loading-blame">
        <el-skeleton :rows="20" animated />
      </div>

      <div v-else class="blame-content">
        <div class="blame-header">
          <el-tag class="path-tag">
            <el-icon><Document /></el-icon>
            {{ currentPath }}
          </el-tag>
          <el-tag>{{ blameLines.length }}</el-tag>
        </div>

        <el-table :data="annotatedBlameLines" style="width: 100%" height="100%" row-key="lineNo">
          <el-table-column prop="lineNo" label="#" width="72" align="right" fixed />
          <el-table-column prop="revision" :label="$t('blame.revision')" width="112" sortable />
          <el-table-column prop="author" :label="$t('blame.author')" width="150" show-overflow-tooltip />
          <el-table-column prop="line" :label="$t('blame.content')">
            <template #default="{ row }">
              <span class="code-line">{{ row.line }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { svnBlame } from '@/api/svn'
import { useWorkspaceStore } from '@/stores/workspace'
import { useI18n } from 'vue-i18n'
import type { BlameLine } from '@/types'

const { t } = useI18n()
const route = useRoute()
const workspaceStore = useWorkspaceStore()

const currentPath = ref('')
const loading = ref(false)
const blameLines = ref<BlameLine[]>([])

const annotatedBlameLines = computed(() => {
  return blameLines.value.map((line, index) => ({
    ...line,
    lineNo: index + 1,
  }))
})

const loadBlame = async () => {
  const file = currentPath.value || route.query.path as string
  if (!file || !workspaceStore.currentPath) return

  loading.value = true
  blameLines.value = []

  try {
    blameLines.value = await svnBlame(workspaceStore.currentPath, file)
  } catch (err) {
    blameLines.value = []
    ElMessage.error(`${t('common.error')}：${err}`)
  } finally {
    loading.value = false
  }
}

watch(() => route.query.path, (path) => {
  if (path) {
    currentPath.value = path as string
    loadBlame()
  }
}, { immediate: true })
</script>

<style scoped>
.blame-view {
  height: 100%;
}

.blame-card {
  height: 100%;
}

:deep(.blame-card > .el-card__body) {
  display: flex;
  flex-direction: column;
  height: calc(100% - 57px);
  min-height: 0;
}

.view-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.path-input {
  width: min(420px, 42vw);
}

.empty-blame,
.loading-blame {
  padding: 40px 0;
}

.blame-content {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  margin-top: 20px;
}

.blame-header {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}

.path-tag {
  max-width: min(720px, 100%);
}

:deep(.el-table__cell) {
  padding: 6px 0;
}

:deep(.el-table__fixed),
:deep(.el-table__fixed-right) {
  box-shadow: 6px 0 14px rgba(31, 35, 64, 0.06);
}

.code-line {
  display: block;
  min-width: max-content;
  font-family: "Cascadia Mono", Consolas, Monaco, monospace;
  white-space: pre;
}

@media (max-width: 860px) {
  .path-input {
    width: 100%;
  }

  .header-actions {
    width: 100%;
  }
}
</style>
