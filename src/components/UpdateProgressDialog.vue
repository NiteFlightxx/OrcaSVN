<template>
  <el-dialog
    v-model="feedback.visible"
    :title="$t('menu.update')"
    width="min(720px, 94vw)"
    class="update-progress-dialog"
    align-center
    :close-on-click-modal="false"
  >
    <div class="update-summary" :class="feedback.state" role="status" aria-live="polite">
      <el-icon aria-hidden="true" :class="{ 'is-loading': feedback.running }"
        ><Loading v-if="feedback.running" /><Warning
          v-else-if="feedback.state === 'conflicts' || feedback.state === 'failed'" /><Check v-else
      /></el-icon>
      <strong>{{ $t(`updateProgress.${feedback.state}`, { count: feedback.conflicts.length }) }}</strong>
    </div>
    <p class="update-elapsed">{{ $t('updateProgress.elapsed', { seconds: elapsed }) }}</p>
    <p class="update-workspace">{{ feedback.workspace }}</p>
    <progress
      v-if="feedback.running"
      class="update-indeterminate"
      :aria-label="$t('updateProgress.running')"
    ></progress>
    <p v-if="feedback.running" class="update-current" :title="lastLine">
      {{ lastLine || $t('updateProgress.waiting') }}
    </p>
    <p v-if="feedback.error" class="update-error" role="alert">{{ feedback.error }}</p>
    <p v-if="!feedback.running && feedback.verification === 'refreshing'" class="update-note" role="status">
      {{ $t('updateProgress.backgroundRefresh') }}
    </p>
    <p v-else-if="feedback.verification === 'failed'" class="update-error" role="alert">
      {{ $t('experience.refreshFailed') }}
    </p>
    <ul v-if="feedback.conflicts.length" class="update-conflicts">
      <li v-for="path in feedback.conflicts" :key="path">{{ path }}</li>
    </ul>
    <SvnOutputDetails v-if="feedback.output" :key="feedback.startedAt" :text="feedback.output" :live="feedback.running" />
    <template #footer
      ><el-button @click="feedback.visible = false">{{
        $t(feedback.running ? 'updateProgress.background' : 'common.close')
      }}</el-button></template
    >
  </el-dialog>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { svnUpdateFeedback as feedback } from '@/composables/useSvnUpdate'
import SvnOutputDetails from './SvnOutputDetails.vue'
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
const elapsed = computed(() =>
  Math.max(
    0,
    Math.floor(((feedback.running ? now.value : feedback.finishedAt) - feedback.startedAt) / 1000)
  )
)
const lastLine = computed(() => feedback.output.trim().split(/\r?\n/).pop() || '')
watch(
  () => feedback.running,
  (running) => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
    if (running) {
      now.value = Date.now()
      timer = setInterval(() => {
        now.value = Date.now()
      }, 1000)
    }
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  if (timer !== undefined) clearInterval(timer)
})
</script>
<style scoped>
.update-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border-radius: 8px;
  background: var(--md-sys-color-surface-container-low);
}
.update-summary.completed .el-icon {
  color: var(--md-sys-color-primary);
}
.update-summary.failed,
.update-error {
  color: var(--md-sys-color-error);
}
.update-summary.conflicts .el-icon {
  color: var(--app-color-status-modified-text);
}
.update-elapsed {
  text-align: right;
  margin: 6px 0 0;
  font-size: var(--app-font-size-xs);
  color: var(--md-sys-color-on-surface-variant);
  font-variant-numeric: tabular-nums;
}
@media (prefers-reduced-motion: reduce) {
  .update-summary .is-loading {
    animation: none;
  }
}
.update-workspace,
.update-note {
  margin: 10px 0;
  font-size: var(--app-font-size-xs);
  color: var(--md-sys-color-on-surface-variant);
  overflow-wrap: anywhere;
}
.update-indeterminate {
  width: 100%;
  height: 6px;
  accent-color: var(--md-sys-color-primary);
}
.update-current {
  margin: 10px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--app-font-size-sm);
}
.update-error {
  margin: 10px 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.update-conflicts {
  max-height: 120px;
  overflow: auto;
  padding-left: 20px;
  font-size: var(--app-font-size-sm);
  overflow-wrap: anywhere;
}
</style>
