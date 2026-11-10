<template>
  <el-dialog
    :model-value="true"
    :title="$t('experience.compare')"
    width="min(1100px,96vw)"
    :before-close="() => $emit('close')"
    ><div class="compare-controls">
      <label
        >{{ $t('experience.from') }}
        <el-input-number v-model="old" :min="0" :precision="0" /></label
      ><label
        >{{ $t('experience.to') }}
        <el-input-number v-model="next" :min="0" :precision="0" :disabled="working" /></label
      ><label v-if="allowWorking"
        ><input v-model="working" type="checkbox" /> {{ $t('experience.working') }}</label
      ><el-button :loading="loading" @click="compare">{{ $t('experience.compare') }}</el-button>
    </div>
    <p>
      <code>{{ source }}</code>
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <div class="comparison"><DiffViewer :text="diff" compact /></div
  ></el-dialog>
</template>
<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useWorkspaceStore } from '@/stores/workspace'
import DiffViewer from './DiffViewer.vue'
const props = defineProps<{
  source: string
  revisions: number[]
  allowWorking: boolean
  initialWorking?: boolean
}>()
defineEmits<{ close: [] }>()
const workspace = useWorkspaceStore(),
  old = ref(Math.min(...props.revisions)),
  next = ref(Math.max(...props.revisions)),
  working = ref(Boolean(props.initialWorking)),
  diff = ref(''),
  error = ref(''),
  loading = ref(false)
let generation = 0
async function compare() {
  const request = ++generation,
    path = workspace.currentPath
  if (!path) return
  loading.value = true
  error.value = ''
  try {
    const result = await invoke<string>('workspace_compare', {
      path,
      source: props.source,
      old: old.value,
      new: next.value,
      working: working.value,
    })
    if (request === generation && path === workspace.currentPath) diff.value = result
  } catch (e) {
    if (request === generation) error.value = String(e)
  } finally {
    if (request === generation) loading.value = false
  }
}
onBeforeUnmount(() => {
  generation++
})
void compare()
</script>
<style scoped>
.compare-controls {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 12px;
}
.comparison {
  height: 58vh;
  display: flex;
  min-height: 0;
}
code {
  overflow-wrap: anywhere;
}
</style>
