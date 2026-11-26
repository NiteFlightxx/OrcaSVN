<template>
  <details class="svn-output-details" @toggle="opened = ($event.target as HTMLDetailsElement).open">
    <summary>{{ $t('experience.svnOutput') }}</summary>
    <template v-if="opened">
      <el-button size="small" @click="copyOutput">{{ $t('experience.copyOutput') }}</el-button>
      <pre
        ref="output"
        tabindex="0"
        :aria-label="$t('experience.svnOutput')"
        @scroll="trackScroll"
      >{{ text }}</pre>
    </template>
  </details>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { writeClipboardText } from '@/utils/clipboard'

const props = defineProps<{ text: string; live?: boolean }>()
const { t } = useI18n()
const opened = ref(false)
const output = ref<HTMLElement | null>(null)
let following = true

function trackScroll() {
  const el = output.value
  if (el) following = el.scrollHeight - el.scrollTop - el.clientHeight < 32
}

watch([opened, () => props.text], () => {
  if (!opened.value) following = true
  if (props.live && following && output.value) output.value.scrollTop = output.value.scrollHeight
}, { flush: 'post' })

async function copyOutput() {
  try {
    await writeClipboardText(props.text)
    ElMessage.success(t('experience.outputCopied'))
  } catch {
    ElMessage.error(t('workspace.copyFailed'))
  }
}
</script>

<style scoped>
.svn-output-details {
  margin: 8px 0 0;
  padding: 8px 10px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 8px;
  background: var(--md-sys-color-surface-container-low);
  font-size: var(--app-font-size-xs);
}
summary {
  cursor: pointer;
  font-weight: 500;
}
summary:focus-visible {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: 2px;
  border-radius: 3px;
}
.el-button {
  margin-top: 8px;
}
pre {
  max-height: 24vh;
  overflow: auto;
  margin: 8px 0 0;
  font: inherit;
  font-family: var(--app-font-family-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}
</style>
