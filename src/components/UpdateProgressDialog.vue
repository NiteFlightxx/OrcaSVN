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
      <el-icon :class="{ 'is-loading': feedback.running }"
        ><Loading v-if="feedback.running" /><Warning
          v-else-if="feedback.state === 'conflicts' || feedback.state === 'failed'" /><Check v-else
      /></el-icon>
      <strong>{{ $t(`updateProgress.${feedback.state}`) }}</strong>
      <span>{{ $t('updateProgress.elapsed', { seconds: elapsed }) }}</span>
    </div>
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
    <p v-if="feedback.state === 'completed'" class="update-note">
      {{ $t('updateProgress.backgroundRefresh') }}
    </p>
    <ul v-if="feedback.conflicts.length" class="update-conflicts">
      <li v-for="path in feedback.conflicts" :key="path">{{ path }}</li>
    </ul>
    <pre
      v-if="feedback.output"
      ref="outputElement"
      class="update-output"
      tabindex="0"
      :aria-label="$t('updateProgress.output')"
      @scroll="trackScroll"
      >{{ feedback.output }}</pre>
    <template #footer
      ><el-button @click="feedback.visible = false">{{
        $t(feedback.running ? 'updateProgress.background' : 'common.close')
      }}</el-button></template
    >
  </el-dialog>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { svnUpdateFeedback as feedback } from '@/composables/useSvnUpdate'
const now = ref(Date.now())
const outputElement = ref<HTMLElement | null>(null)
const following = ref(true)
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
      following.value = true
      now.value = Date.now()
      timer = setInterval(() => {
        now.value = Date.now()
      }, 1000)
    }
  },
  { immediate: true }
)
function trackScroll() {
  const el = outputElement.value
  if (el) following.value = el.scrollHeight - el.scrollTop - el.clientHeight < 32
}
watch([() => feedback.output, () => feedback.visible], async () => {
  await nextTick()
  if (following.value && outputElement.value)
    outputElement.value.scrollTop = outputElement.value.scrollHeight
})
onBeforeUnmount(() => {
  if (timer !== undefined) clearInterval(timer)
})
</script>
<style scoped>
.update-summary {
  display: flex;
  align-items: center;
  gap: 8px;
}
.update-summary > span {
  margin-left: auto;
  font-size: var(--app-font-size-xs);
  color: var(--md-sys-color-on-surface-variant);
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
.update-output {
  max-height: 32vh;
  margin: 12px 0 0;
  padding: 10px;
  background: var(--md-sys-color-surface-container-lowest);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 3px;
  font: var(--app-font-size-xs)/1.7 var(--app-font-family-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  overflow: auto;
  user-select: text;
}
.update-conflicts {
  max-height: 120px;
  overflow: auto;
  padding-left: 20px;
  font-size: var(--app-font-size-sm);
  overflow-wrap: anywhere;
}
</style>
