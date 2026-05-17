<template>
  <div class="commit-view">
    <el-card class="commit-card">
      <template #header>
        <span>{{ $t('commit.title') }}</span>
      </template>

      <div v-if="!workspaceStore.currentPath" class="no-workspace">
        <el-empty :description="$t('log.openWorkspaceFirst')">
          <el-button type="primary" @click="openWorkspace">{{ $t('common.open') }}</el-button>
        </el-empty>
      </div>

      <div v-else>
        <el-alert
          :title="$t('commit.commitMessage')"
          type="info"
          :closable="false"
          class="commit-info"
        >
          {{ $t('commit.currentWorkspace') }}：<strong>{{ workspaceStore.currentPath }}</strong>
          <br>
          {{ $t('commit.changedFiles') }}：{{ changedFiles.length }} {{ $t('commit.filesCount', { count: changedFiles.length }) }}
        </el-alert>

        <el-form class="commit-form">
          <el-form-item :label="$t('commit.selectFiles')">
            <el-table :data="changedFiles" style="width: 100%" @selection-change="handleSelectionChange">
              <el-table-column type="selection" width="55" />
              <el-table-column prop="status_code" :label="$t('commit.status')" width="180" align="center">
                <template #default="{ row }">
                  <span class="status-badge" :class="getStatusClass(row.status_code)">
                    {{ $t(getStatusLabelKey(row.status_code)) }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column prop="path" :label="$t('commit.file')" />
            </el-table>
          </el-form-item>

          <el-form-item :label="$t('commit.commitMessage')" required>
            <el-input
              v-model="commitMessage"
              type="textarea"
              :rows="5"
              :placeholder="$t('commit.enterCommitMessage')"
            />
          </el-form-item>

          <el-form-item>
            <el-button type="primary" @click="doCommit" :loading="loading">
              <el-icon><Upload /></el-icon>
              {{ $t('common.commit') }}
            </el-button>
            <el-button @click="resetForm">{{ $t('common.reset') }}</el-button>
          </el-form-item>
        </el-form>

        <div v-if="output" class="output-area">
          <el-input
            v-model="output"
            type="textarea"
            :rows="8"
            readonly
            class="output-textarea"
          />
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkspaceStore } from '@/stores/workspace'
import { svnCommit } from '@/api/svn'
import { useI18n } from 'vue-i18n'
import { getStatusClass, getStatusLabelKey } from '@/composables/useSvnStatus'
import { useWorkspace } from '@/composables/useWorkspace'
import type { SvnStatus } from '@/types'

const { t } = useI18n()
const router = useRouter()
const workspaceStore = useWorkspaceStore()
const { openWorkspace: openWorkspaceDialog } = useWorkspace()

const selectedFiles = ref<string[]>([])
const commitMessage = ref('')
const loading = ref(false)
const output = ref('')

const changedFiles = computed(() => {
  return workspaceStore.statusList.filter(
    s => s.status_code !== 'normal' && s.status_code !== ''
  )
})

const handleSelectionChange = (rows: SvnStatus[]) => {
  selectedFiles.value = rows.map(f => f.path)
}

const openWorkspace = async () => {
  const success = await openWorkspaceDialog(t('dialog.selectSVNWorkspaceDirectory'))
  if (success) {
    router.push({ name: 'workspace' })
  }
}

const doCommit = async () => {
  if (!workspaceStore.currentPath || !commitMessage.value) {
    return
  }

  loading.value = true
  output.value = ''

  try {
    const files = selectedFiles.value.length > 0 ? selectedFiles.value : undefined
    const result = await svnCommit(workspaceStore.currentPath, commitMessage.value, files)
    output.value = result.output

    setTimeout(() => {
      router.push({ name: 'workspace' })
    }, 1000)
  } catch (err) {
    output.value = `${t('common.error')}：${err}`
  } finally {
    loading.value = false
  }
}

const resetForm = () => {
  selectedFiles.value = []
  commitMessage.value = ''
  output.value = ''
}
</script>

<style scoped>
.commit-view {
  max-width: 900px;
  margin: 0 auto;
}

.no-workspace {
  padding: 40px 0;
}

.commit-info {
  margin-bottom: 20px;
}

.commit-form {
  margin-top: 20px;
}

.output-area {
  margin-top: 20px;
}

.output-textarea {
  font-family: 'Consolas', 'Monaco', monospace;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 82px;
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: #f5f5fb;
  font-weight: 800;
}

.status-added {
  color: #15803d;
  background: #dcfce7;
}

.status-modified {
  color: #a16207;
  background: #fef9c3;
}

.status-deleted {
  color: #dc2626;
  background: #fee2e2;
}

.status-unversioned {
  color: #6366f1;
  background: #e0e7ff;
}
</style>
