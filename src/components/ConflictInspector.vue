<template>
  <section class="conflict-inspector">
    <header>
      <strong>{{ file }}</strong
      ><button :disabled="flow.busy || loading" @click="load">{{ $t('menu.refresh') }}</button>
    </header>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <template v-if="conflict">
      <p>{{ $t('flow.conflicts') }} · {{ conflict.kind }}</p>
      <div class="conflict-actions">
        <el-button :disabled="flow.busy" @click="resolve('working')">{{
          $t('flow.keepWorking')
        }}</el-button
        ><el-button
          :disabled="flow.busy || conflict.kind !== 'content'"
          @click="resolve('mine-full')"
          >{{ $t('flow.keepLocal') }}</el-button
        ><el-button
          :disabled="flow.busy || conflict.kind !== 'content'"
          @click="resolve('theirs-full')"
          >{{ $t('flow.takeIncoming') }}</el-button
        ><el-button :disabled="flow.busy || conflict.kind !== 'content'" @click="merge">{{
          $t('experience.externalMerge')
        }}</el-button>
      </div>
      <p class="muted">
        {{ $t(conflict.kind === 'content' ? 'flow.resolveConfirm' : 'flow.conflictHint') }}
      </p>
      <div class="conflict-versions">
        <article v-for="version in conflict.versions" :key="version.side">
          <strong>{{ $t(`flow.${version.side}`) }}</strong
          ><small>{{ version.size.toLocaleString() }} B</small>
          <pre>{{ version.text ?? $t('experience.binary') }}</pre>
        </article>
      </div>
      <details>
        <summary>{{ $t('flow.details') }}</summary>
        <pre>{{ conflict.details }}</pre>
      </details>
    </template>
  </section>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessageBox } from 'element-plus'
import { repositoryConflicts, repositoryResolve, type Conflict } from '@/api/workflows'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorkflowStore } from '@/stores/workflows'
import { useExternalTool } from '@/composables/useExternalTool'
const props = defineProps<{ file: string }>(),
  emit = defineEmits<{ resolved: [file: string] }>()
const workspace = useWorkspaceStore(),
  flow = useWorkflowStore(),
  { t } = useI18n()
const conflict = ref<Conflict | null>(null),
  loading = ref(false),
  error = ref('')
let generation = 0
async function load() {
  const request = ++generation,
    path = workspace.currentPath,
    file = props.file
  conflict.value = null
  error.value = ''
  if (!path) return
  loading.value = true
  try {
    const next = await repositoryConflicts(path)
    if (request === generation)
      conflict.value =
        next.find(
          (item) =>
            item.path === file ||
            item.path ===
              [
                path
                  .replace(/\\/g, '/')
                  .slice((flow.identity?.root || path).replace(/\\/g, '/').length)
                  .replace(/^\//, ''),
                file,
              ]
                .filter(Boolean)
                .join('/')
        ) || null
  } catch (e) {
    if (request === generation) error.value = String(e)
  } finally {
    if (request === generation) loading.value = false
  }
}
async function resolve(strategy: string) {
  const path = workspace.currentPath,
    url = flow.identity?.url,
    item = conflict.value
  if (!path || !url || !item || flow.busy) return
  try {
    await ElMessageBox.confirm(`${item.path}\n${t('flow.resolveConfirm')}`, t('flow.conflicts'), {
      type: 'warning',
    })
    if (path !== workspace.currentPath || item !== conflict.value) return
    const result = await flow.perform(t('flow.conflicts'), () =>
      repositoryResolve(path, item.path, strategy, url)
    )
    if (result.error) error.value = result.error
    else emit('resolved', props.file)
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') error.value = String(e)
  }
}
async function merge() {
  try {
    await useExternalTool().open(conflict.value?.path || props.file, true, true)
    await load()
  } catch (e) {
    error.value = String(e)
  }
}
watch(() => [workspace.currentPath, props.file], load, { immediate: true })
</script>
<style scoped>
.conflict-inspector {
  height: 100%;
  overflow: auto;
  padding: 12px;
  box-sizing: border-box;
}
header,
.conflict-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
header strong {
  flex: 1;
  overflow-wrap: anywhere;
}
header button {
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
}
.conflict-versions {
  display: flex;
  gap: 8px;
}
.conflict-versions article {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--md-sys-color-outline-variant);
  padding: 8px;
}
.conflict-versions small {
  float: right;
}
.conflict-versions pre {
  max-height: 34vh;
  overflow: auto;
  white-space: pre-wrap;
  font-size: 11px;
}
.muted {
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
}
.error {
  color: var(--md-sys-color-error);
  white-space: pre-wrap;
}
@media (max-width: 1000px) {
  .conflict-versions {
    flex-direction: column;
  }
}
</style>
