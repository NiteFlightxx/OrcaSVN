<template>
  <div v-if="flow.busy || flow.activities.length || history.length" class="activity-panel">
    <button class="activity-trigger" @click="toggleActivity">
      <el-icon v-if="flow.busy" class="is-loading"><Loading /></el-icon>
      {{ flow.title || $t('flow.activity') }} · {{ $t(`experience.${flow.phase}`) }}
      <el-icon><ArrowDown v-if="expanded" /><ChevronRight v-else /></el-icon>
    </button>
    <p v-if="flow.refreshWarning" role="alert">{{ $t('experience.refreshFailed') }}</p>
    <div v-if="flow.busy" class="operation-progress" role="status">
      <span>{{
        flow.progress?.file ||
        (updateFeedback.running ? $t('updateProgress.running') : $t('flow.running'))
      }}</span
      ><progress
        :value="flow.progress?.total ? flow.progress.current : undefined"
        :max="flow.progress?.total || 1"
      />
    </div>
    <div v-if="expanded" class="activity-records">
      <pre v-if="flow.commandOutput">{{ flow.commandOutput }}</pre>
      <article v-for="(record, index) in flow.activities" :key="index">
        <strong>{{ record.time }} · {{ record.title }}</strong
        ><el-button
          v-if="record.undoId"
          size="small"
          :disabled="flow.busy"
          @click="undo(record.undoId)"
          >{{ $t('flow.undo') }}</el-button
        >
        <pre :class="{ failed: record.failed }">{{ record.output }}</pre>
      </article>
      <details v-for="(record, index) in history" :key="`saved-${index}`">
        <summary>{{ $t('flow.savedActivity') }} {{ index + 1 }}</summary>
        <el-button
          v-if="savedUndoId(record)"
          size="small"
          :disabled="flow.busy"
          @click="undo(savedUndoId(record)!)"
          >{{ $t('flow.undo') }}</el-button
        >
        <pre>{{ JSON.stringify(record, null, 2) }}</pre>
      </details>
    </div>
  </div>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { svnUpdateFeedback as updateFeedback } from '@/composables/useSvnUpdate'
import { useWorkflowStore } from '@/stores/workflows'
import { repositoryActivities, repositoryUndo } from '@/api/workflows'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from 'vue-i18n'
const flow = useWorkflowStore(),
  expanded = ref(false),
  history = ref<Record<string, unknown>[]>([])
const { t } = useI18n()
function toggleActivity() {
  if (updateFeedback.running) updateFeedback.visible = true
  else expanded.value = !expanded.value
}
function savedUndoId(record: Record<string, unknown>): string | null {
  const plan = record.plan as { id?: string; kind?: string } | undefined
  return record.phase === 'finished' && plan?.kind === 'cherry-pick' ? plan.id || null : null
}
async function undo(id: string) {
  try {
    await ElMessageBox.confirm(t('flow.undoHint'), t('flow.undo'), { type: 'warning' })
    const result = await flow.perform(t('flow.undo'), () => repositoryUndo(id))
    if (result.error) ElMessage.error(result.error)
    history.value = await repositoryActivities()
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(String(e))
  }
}
onMounted(async () => {
  try {
    history.value = await repositoryActivities()
  } catch {
    /* Current operations remain visible if history cannot be read. */
  }
})
</script>
<style scoped>
.operation-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 10px 8px;
  font-size: var(--app-font-size-xs);
}
.operation-progress span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.operation-progress progress {
  width: 180px;
  height: 6px;
  accent-color: var(--md-sys-color-primary);
}
.activity-panel {
  border-top: 1px solid var(--md-sys-color-outline-variant);
  background: var(--md-sys-color-surface-container-lowest);
}
.activity-trigger {
  background: none;
  border: 0;
  color: inherit;
  padding: 6px 16px;
  cursor: pointer;
  text-align: left;
  width: 100%;
}
.activity-records {
  max-height: 32vh;
  overflow: auto;
  padding: 8px 16px;
  font-size: 12px;
}
.activity-records pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.failed {
  color: var(--md-sys-color-error);
}
</style>
