<template>
  <div v-if="flow.busy || flow.activities.length || history.length" class="activity-panel">
    <button
      type="button"
      class="activity-trigger"
      :aria-expanded="updateFeedback.running ? undefined : expanded"
      :aria-haspopup="updateFeedback.running ? 'dialog' : undefined"
      @click="toggleActivity"
    >
      <span class="activity-summary" role="status">
        {{ flow.title || $t('flow.activity') }}
        <span v-if="flow.title" class="phase-label" :data-phase="flow.phase">{{ phaseLabel }}</span>
      </span>
      <el-icon aria-hidden="true"><ArrowDown v-if="expanded && !updateFeedback.running" /><ChevronRight v-else /></el-icon>
    </button>
    <p v-if="flow.refreshWarning" class="refresh-warning" role="alert">{{ $t('experience.refreshFailed') }}</p>
    <div v-if="flow.busy" class="operation-progress">
      <progress
        :aria-label="phaseLabel"
        :value="countedProgress?.current"
        :max="countedProgress?.total || 1"
      />
      <span v-if="countedProgress">{{ Math.floor(100 * countedProgress.current / countedProgress.total) }}%</span>
      <span v-if="currentFile" class="progress-file" :title="currentFile">{{ currentFile }}</span>
    </div>
    <div v-if="expanded" class="activity-records">
      <SvnOutputDetails v-if="flow.busy && flow.commandOutput" :text="flow.commandOutput" live />
      <article v-for="record in flow.activities" :key="record.id">
        <div class="activity-record-heading">
          <strong>{{ record.title }}</strong>
          <span class="phase-label" :data-phase="record.phase">{{ $t(`experience.${record.phase}`) }}</span>
          <span class="activity-time">{{ record.time }}</span>
          <el-button
          v-if="record.undoId"
          size="small"
          :disabled="flow.busy"
          @click="undo(record.undoId)"
          >{{ $t('flow.undo') }}</el-button
          >
        </div>
        <SvnOutputDetails v-if="record.output" :text="record.output" />
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
import { computed, onMounted, ref } from 'vue'
import { svnUpdateFeedback as updateFeedback } from '@/composables/useSvnUpdate'
import { useWorkflowStore } from '@/stores/workflows'
import { repositoryActivities, repositoryUndo } from '@/api/workflows'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from 'vue-i18n'
import SvnOutputDetails from './SvnOutputDetails.vue'
const flow = useWorkflowStore(),
  expanded = ref(false),
  history = ref<Record<string, unknown>[]>([])
const { t } = useI18n()
const currentProgress = computed(() => flow.busy && flow.phase !== 'refreshing' ? flow.progress : null)
const currentFile = computed(() => currentProgress.value?.file || '')
const countedProgress = computed(() => {
  const progress = currentProgress.value
  // These commands report an advancing file index. Commit events report only phase boundaries.
  return progress && progress.total > 0 && ['capturing', 'restoring', 'patch-export'].includes(progress.phase)
    ? progress : null
})
const phaseLabel = computed(() => {
  if (updateFeedback.running) return t('updateProgress.running')
  const stage = currentProgress.value?.phase
  if (stage && ['checking', 'adding', 'committing', 'refreshing'].includes(stage))
    return t(`commitFlow.${stage}`)
  return t(`experience.${flow.phase}`)
})
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
.progress-file {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.operation-progress progress {
  width: min(180px, 25vw);
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.activity-trigger:hover {
  background: var(--md-sys-color-surface-container-low);
}
.activity-trigger:focus-visible {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: -2px;
}
.activity-summary,
.activity-record-heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.phase-label {
  padding: 2px 7px;
  border-radius: 999px;
  font-size: var(--app-font-size-xs);
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface-variant);
}
.phase-label:is([data-phase='executing'], [data-phase='refreshing'], [data-phase='checking'], [data-phase='completed'], [data-phase='added']) {
  color: var(--md-sys-color-primary);
}
.phase-label[data-phase='conflicts'] {
  color: var(--app-color-status-modified-text);
}
.phase-label[data-phase='failed'],
.refresh-warning {
  color: var(--md-sys-color-error);
}
.refresh-warning {
  margin: 0;
  padding: 0 16px 6px;
  font-size: var(--app-font-size-xs);
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
.activity-records article {
  padding: 6px 0;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}
.activity-time {
  margin-left: auto;
  color: var(--md-sys-color-on-surface-variant);
}
</style>
