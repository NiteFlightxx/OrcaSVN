<template>
  <el-dialog class="branch-manager-dialog" :align-center="true" :model-value="true" :title="$t('branchUI.manage')" width="min(700px, 94vw)" :close-on-click-modal="false" :close-on-press-escape="!adding" :before-close="close">
    <nav class="manager-tabs"><button :class="{ active: mode === 'add' }" :disabled="adding" @click="mode = 'add'">{{ $t('branchUI.add') }}</button><button :class="{ active: mode === 'browse' }" :disabled="adding" @click="mode = 'browse'">{{ $t('branchUI.directory') }}</button></nav>
    <template v-if="mode === 'add'">
      <p>{{ $t('branchUI.addHint') }}</p>
      <label>{{ $t('branchUI.urls') }}<textarea v-model="input" :disabled="adding" rows="5" :placeholder="flow.identity?.url || 'https://…/branches/dev'" /></label>
    </template>
    <template v-else>
      <p>{{ $t('branchUI.directoryHint') }}</p>
      <form class="directory-address" @submit.prevent="browse"><input v-model="address" :aria-label="$t('flow.layout')" /><button type="button" :disabled="flow.directoryLoading" @click="parent">↑</button><button :disabled="flow.directoryLoading">{{ $t('flow.browseDirectory') }}</button></form>
      <button class="save-root" :disabled="!address || flow.directoryLoading" @click="flow.configureRoot(address)">{{ $t('branchUI.saveLocation') }}</button>
      <div v-if="flow.branchError" class="manager-warning"><strong>{{ $t(flow.branchAccessDenied ? 'branchUI.denied' : 'flow.branchBrowseFailed') }}</strong><p>{{ $t('branchUI.directStillWorks') }}</p><button @click="mode = 'add'">{{ $t('branchUI.add') }}</button><details><summary>{{ $t('flow.details') }}</summary><pre>{{ flow.branchError }}</pre></details></div>
      <p v-if="flow.directoryLoading" role="status">{{ $t('common.loading') }}</p>
      <div class="directory-entries" role="listbox" :aria-label="$t('branchUI.directory')"><button v-for="entry in flow.branches" :key="entry.url" :class="{ selected: selected === entry.url }" role="option" :aria-selected="selected === entry.url" :title="entry.url" @click="selected = entry.url" @dblclick="flow.browse(entry.url); address = entry.url; selected = ''"><span>▸ {{ entry.name }}</span><small>{{ entry.url }}</small></button></div>
    </template>
    <p v-if="error" class="manager-error" role="alert">{{ error }}</p>
    <p v-if="saved" role="status">{{ $t('branchUI.added', { count: saved }) }}</p>
    <template #footer><el-button :disabled="adding" @click="close">{{ $t('common.close') }}</el-button><el-button type="primary" :loading="adding" :disabled="adding || (mode === 'add' ? !input.trim() : !selected)" @click="add">{{ $t('branchUI.addSelected') }}</el-button></template>
  </el-dialog>
</template>
<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useWorkflowStore } from '@/stores/workflows'
import { useWorkspaceStore } from '@/stores/workspace'
import { useI18n } from 'vue-i18n'
const props = defineProps<{ initialMode: 'add' | 'browse' }>()
const emit = defineEmits<{ close: [] }>()
const flow = useWorkflowStore(), workspace = useWorkspaceStore(), { t } = useI18n()
const mode = ref(props.initialMode), input = ref(''), address = ref(flow.browserUrl), selected = ref(''), error = ref(''), saved = ref(0), adding = ref(false)
const scope = { workspace: workspace.currentPath, uuid: flow.identity?.uuid }
let disposed = false
const isCurrent = () => !disposed && workspace.currentPath === scope.workspace && flow.identity?.uuid === scope.uuid
function close(done?: () => void) { if (adding.value) return; disposed = true; emit('close'); if (typeof done === 'function') done() }
async function browse() { error.value = ''; selected.value = ''; await flow.browse(address.value.trim()) }
async function parent() { address.value = address.value.replace(/\/+$/, '').replace(/\/[^/]+$/, ''); await browse() }
async function add() {
  if (adding.value || !isCurrent()) return
  const urls = mode.value === 'add' ? [...new Set(input.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean))] : [selected.value]
  if (!urls.length || urls.some(url => !url)) return
  adding.value = true; error.value = ''; saved.value = 0
  const failed: string[] = [], details: string[] = []
  try {
    for (const url of urls) {
      if (!isCurrent()) return
      try { await flow.addBranch(url); if (isCurrent()) saved.value++ }
      catch (e) { if (isCurrent()) { failed.push(url); details.push(`${url}\n${/Invalid branch URL|Invalid URL/.test(String(e)) ? t('branchUI.invalidUrl') : String(e)}`) } }
    }
    if (!isCurrent()) return
    input.value = failed.join('\n'); error.value = details.join('\n\n')
    if (!failed.length) { adding.value = false; close() }
  } finally { adding.value = false }
}
watch(() => flow.browserUrl, value => { address.value = value; selected.value = '' })
watch(address, () => { selected.value = '' })
watch(() => [workspace.currentPath, flow.identity?.uuid], () => { if (!isCurrent()) { disposed = true; emit('close') } })
onBeforeUnmount(() => { disposed = true })
</script>
<style scoped>
.manager-tabs{display:flex;gap:6px;border-bottom:1px solid var(--md-sys-color-outline-variant);margin-bottom:12px}.manager-tabs button{padding:7px 12px;border:0;border-bottom:2px solid transparent;background:none;color:inherit;cursor:pointer}.manager-tabs .active{border-bottom-color:var(--md-sys-color-primary);color:var(--md-sys-color-primary)}p{font-size:12px;margin:8px 0;line-height:1.6}label{font-size:12px;display:block}input,textarea{background:var(--md-sys-color-surface);color:inherit;border:1px solid var(--md-sys-color-outline-variant);border-radius:4px;padding:8px;font:inherit;box-sizing:border-box}textarea{display:block;resize:vertical;width:100%;margin-top:6px;max-height:35vh;min-height:110px;font-family:var(--app-font-family-mono);font-size:12px}.directory-address{display:flex;gap:6px}.directory-address input{flex:1;min-width:0}.directory-address button,.save-root,.manager-warning button{background:var(--md-sys-color-surface-container-high);color:inherit;border:1px solid var(--md-sys-color-outline-variant);border-radius:4px;padding:5px 9px;cursor:pointer}.save-root{font-size:11px;margin:6px 0}.directory-entries{max-height:30vh;overflow:auto;margin-top:8px}.directory-entries button{display:flex;width:100%;align-items:center;gap:12px;border:0;background:none;color:inherit;text-align:left;padding:7px 9px;cursor:pointer}.directory-entries small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.6;flex:1}.directory-entries .selected{background:var(--md-sys-color-primary-container)}.manager-warning{padding:10px;background:var(--md-sys-color-surface-container);font-size:12px}.manager-warning details{margin-top:8px}.manager-warning pre,.manager-error{white-space:pre-wrap;overflow-wrap:anywhere;max-height:22vh;overflow:auto;font-size:11px}.manager-error{color:var(--md-sys-color-error)}button:disabled{opacity:.4;cursor:default}
</style>
