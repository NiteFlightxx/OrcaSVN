<template>
  <div class="diff-view">
    <el-card class="diff-card">
      <template #header>
        <div class="card-header">
          <span class="view-title">
            <el-icon><Connection /></el-icon>
            {{ $t('diff.title') }}
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
            <el-button @click="loadDiff" :loading="loading">
              <el-icon><Connection /></el-icon>
              {{ $t('diff.compare') }}
            </el-button>
          </div>
        </div>
      </template>

      <div class="diff-options">
        <el-radio-group v-model="diffType" class="mode-switch">
          <el-radio-button label="working">{{ $t('diff.workingCopy') }}</el-radio-button>
          <el-radio-button label="revision">{{ $t('diff.betweenRevisions') }}</el-radio-button>
        </el-radio-group>

        <div v-if="diffType === 'revision'" class="revision-inputs">
          <el-input
            v-model.number="oldRev"
            type="number"
            :placeholder="$t('diff.oldRevision')"
            style="width: 120px"
          />
          <span>{{ $t('diff.to') }}</span>
          <el-input
            v-model.number="newRev"
            type="number"
            :placeholder="$t('diff.newRevision')"
            style="width: 120px"
          />
        </div>
      </div>

      <div v-if="!diffResult && !loading" class="empty-diff">
        <el-empty :description="$t('diff.selectFileAndCompare')" />
      </div>

      <div v-else-if="loading" class="loading-diff">
        <el-skeleton :rows="20" animated />
      </div>

      <div v-else class="diff-content">
        <div class="diff-header">
          <el-tag class="path-tag">
            <el-icon><Document /></el-icon>
            {{ $t('diff.file') }}：{{ diffResult?.path }}
          </el-tag>
          <el-tag v-if="diffResult?.old_revision && diffResult?.new_revision">
            {{ $t('common.version') }}：{{ diffResult?.old_revision }} → {{ diffResult?.new_revision }}
          </el-tag>
          <el-tag type="success">+{{ diffStats.added }}</el-tag>
          <el-tag type="danger">-{{ diffStats.removed }}</el-tag>
        </div>

        <div class="diff-lines" role="table" aria-label="Diff">
          <div
            v-for="line in diffLines"
            :key="line.index"
            class="diff-row"
            :class="line.className"
            role="row"
          >
            <span class="diff-line-number" role="cell">{{ line.index }}</span>
            <span class="diff-marker" role="cell">{{ line.marker }}</span>
            <code class="diff-code" role="cell">{{ line.text }}</code>
          </div>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { svnDiff } from '@/api/svn'
import { useWorkspaceStore } from '@/stores/workspace'
import { useI18n } from 'vue-i18n'
import type { DiffResult } from '@/types'

const { t } = useI18n()
const route = useRoute()
const workspaceStore = useWorkspaceStore()

type DiffLineType = 'added' | 'removed' | 'context' | 'meta'

interface DiffLineRow {
  index: number
  marker: string
  text: string
  className: string
  type: DiffLineType
}

const currentPath = ref('')
const diffType = ref<'working' | 'revision'>('working')
const oldRev = ref<number>()
const newRev = ref<number>()
const loading = ref(false)
const diffResult = ref<DiffResult | null>(null)

const diffLines = computed<DiffLineRow[]>(() => {
  if (!diffResult.value?.diff) return []

  const lines = diffResult.value.diff.split('\n')
  return lines.map((line, index) => {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      return {
        index: index + 1,
        marker: '+',
        text: line.slice(1),
        className: 'diff-added',
        type: 'added',
      }
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      return {
        index: index + 1,
        marker: '-',
        text: line.slice(1),
        className: 'diff-removed',
        type: 'removed',
      }
    }

    const isMeta = line.startsWith('@@') || line.startsWith('+++') || line.startsWith('---')
    return {
      index: index + 1,
      marker: isMeta ? '@' : '',
      text: line,
      className: isMeta ? 'diff-meta' : 'diff-context',
      type: isMeta ? 'meta' : 'context',
    }
  })
})

const diffStats = computed(() => {
  return diffLines.value.reduce(
    (stats, line) => {
      if (line.type === 'added') stats.added += 1
      if (line.type === 'removed') stats.removed += 1
      return stats
    },
    { added: 0, removed: 0 }
  )
})

const loadDiff = async () => {
  const file = currentPath.value || route.query.path as string
  if (!file || !workspaceStore.currentPath) return

  loading.value = true
  diffResult.value = null

  try {
    const old = diffType.value === 'revision' ? oldRev.value : undefined
    const new_ = diffType.value === 'revision' ? newRev.value : undefined

    diffResult.value = await svnDiff(workspaceStore.currentPath, file, old, new_)
  } catch (err) {
    diffResult.value = null
    ElMessage.error(`${t('common.error')}：${err}`)
  } finally {
    loading.value = false
  }
}

watch(() => route.query.path, (path) => {
  if (path) {
    currentPath.value = path as string
    loadDiff()
  }
}, { immediate: true })
</script>

<style scoped>
.diff-view {
  height: 100%;
}

.diff-card {
  height: 100%;
}

:deep(.diff-card > .el-card__body) {
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

.diff-options {
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 20px;
}

.mode-switch :deep(.el-radio-button__inner) {
  font-weight: 700;
}

.revision-inputs {
  display: flex;
  align-items: center;
  gap: 10px;
}

.empty-diff,
.loading-diff {
  padding: 40px 0;
}

.diff-content {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  margin-top: 20px;
}

.diff-header {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 15px;
}

.path-tag {
  max-width: min(720px, 100%);
}

.diff-lines {
  flex: 1;
  min-height: 320px;
  background: #fbfbff;
  border: 1px solid rgba(198, 198, 210, 0.8);
  border-radius: 8px;
  overflow: auto;
  font-family: "Cascadia Mono", Consolas, Monaco, monospace;
  font-size: 13px;
}

.diff-row {
  display: grid;
  grid-template-columns: 64px 34px minmax(max-content, 1fr);
  min-width: max-content;
  border-bottom: 1px solid rgba(226, 228, 238, 0.72);
}

.diff-line-number,
.diff-marker {
  user-select: none;
  color: #747789;
  background: rgba(241, 242, 251, 0.86);
  text-align: right;
}

.diff-line-number {
  padding: 3px 12px;
}

.diff-marker {
  padding: 3px 10px;
  text-align: center;
  font-weight: 800;
}

.diff-code {
  padding: 3px 12px;
  color: #20212a;
  white-space: pre;
}

.diff-added {
  background-color: #ecfdf3;
}

.diff-added .diff-marker,
.diff-added .diff-line-number {
  background: #dcfce7;
  color: #15803d;
}

.diff-removed {
  background-color: #fff1f2;
}

.diff-removed .diff-marker,
.diff-removed .diff-line-number {
  background: #fee2e2;
  color: #dc2626;
}

.diff-meta {
  background: #eef2ff;
}

.diff-meta .diff-code,
.diff-meta .diff-marker {
  color: #4338ca;
  font-weight: 800;
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
