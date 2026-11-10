<template>
  <div class="conflicts-workbench">
    <header><strong>{{ $t('flow.conflicts') }} ({{ conflicts.length }})</strong><el-button :disabled="flow.busy" @click="load">{{ $t('flow.refresh') }}</el-button></header>
    <p>{{ $t('flow.conflictHint') }}</p>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="conflict-split">
      <nav><button v-for="item in conflicts" :key="item.path" :class="{ active: selected?.path === item.path }" @click="selected = item">{{ item.kind }} · {{ item.path }}</button></nav>
      <section v-if="selected">
        <h3>{{ selected.path }}</h3>
        <div class="actions"><el-button :disabled="flow.busy" @click="resolve('working')">{{ $t('flow.keepWorking') }}</el-button><el-button :disabled="flow.busy || selected.kind !== 'content'" @click="resolve('mine-full')">{{ $t('flow.keepLocal') }}</el-button><el-button :disabled="flow.busy || selected.kind !== 'content'" @click="resolve('theirs-full')">{{ $t('flow.takeIncoming') }}</el-button><el-button @click="reveal">{{ $t('flow.openFile') }}</el-button></div>
        <div class="versions"><article v-for="version in selected.versions" :key="version.side"><strong>{{ $t(`flow.${version.side}`) }} · {{ version.size.toLocaleString() }} B</strong><p>{{ version.path }}</p><pre>{{ version.text ?? $t('flow.binary') }}</pre></article></div>
        <details><summary>{{ $t('flow.details') }}</summary><pre>{{ selected.details }}</pre></details>
      </section>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorkflowStore } from '@/stores/workflows'
import { repositoryConflicts, repositoryResolve, type Conflict } from '@/api/workflows'
import { revealWorkspaceFile } from '@/api/svn'
const workspace = useWorkspaceStore(), flow = useWorkflowStore(), { t } = useI18n()
const conflicts = ref<Conflict[]>([]), selected = ref<Conflict | null>(null), error = ref('')
let generation = 0
async function load() {
  const path = workspace.currentPath, request = ++generation
  if (!path) { conflicts.value = []; selected.value = null; return }
  try { const next = await repositoryConflicts(path); if (request !== generation || path !== workspace.currentPath) return; conflicts.value = next; selected.value = next.find(c => c.path === selected.value?.path) || next[0] || null; error.value = '' } catch (e) { if (request === generation) error.value = String(e) }
}
async function resolve(strategy: string) {
  const item = selected.value, path = workspace.currentPath, url = flow.identity?.url
  if (!item || !path || !url) return
  try {
    await ElMessageBox.confirm(`${item.path}\n${t('flow.resolveConfirm')}`, t('flow.conflicts'), { type: 'warning' })
    const result = await flow.perform(t('flow.conflicts'), () => repositoryResolve(path, item.path, strategy, url))
    if (result.error) ElMessage.error(result.error)
    await load()
  } catch (e) { if (e !== 'cancel' && e !== 'close') ElMessage.error(String(e)) }
}
async function reveal() { if (selected.value && flow.identity?.root) { try { await revealWorkspaceFile(flow.identity.root, selected.value.path) } catch (e) { ElMessage.error(String(e)) } } }
watch(() => [workspace.currentPath, workspace.svnInfo?.url], load, { immediate: true })
</script>
<style scoped>.conflicts-workbench{padding:16px;height:100%;overflow:auto}header,.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}header{justify-content:space-between}.conflict-split{display:grid;grid-template-columns:minmax(160px,25%) 1fr;gap:16px}.conflict-split nav button{display:block;width:100%;text-align:left;padding:10px;border:0;background:none;color:inherit;overflow-wrap:anywhere}.conflict-split nav button.active{background:var(--md-sys-color-primary-container)}.conflict-split section{min-width:0}.versions{display:flex;gap:12px;margin-top:16px}.versions article{min-width:0;flex:1;border:1px solid var(--md-sys-color-outline-variant);padding:10px}.versions p{overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow:auto;max-height:50vh;font-size:12px}.error{color:var(--md-sys-color-error)}@media(max-width:1000px){.versions{flex-direction:column}}</style>
