<template>
  <section class="asset-stashes">
    <header><div><strong>{{ $t('flow.fullStash') }}</strong><p>{{ $t('flow.snapshotHint') }}</p></div><div class="actions"><el-button :disabled="flow.busy" @click="openCreate">{{ $t('flow.createStash') }}</el-button><el-button :disabled="flow.busy" @click="importStash">{{ $t('flow.import') }}</el-button></div></header>
    <p v-if="flow.error" class="error">{{ flow.error }}</p>
    <el-button v-if="legacyStore.entries.length" :disabled="flow.busy" @click="migrate">{{ $t('flow.migrate') }} ({{ legacyStore.entries.length }})</el-button>
    <article v-for="entry in flow.stashes" :key="entry.id" class="stash-record" :class="{ selected: selected?.id === entry.id }" @click="selected = entry" @contextmenu.prevent="selected = entry">
      <div><strong>{{ entry.name || entry.id }}</strong><small>{{ new Date(entry.createdAt).toLocaleString() }} · {{ entry.nodes.length }} {{ $t('flow.files') }} · {{ size(entry.nodes.reduce((total,n) => total + n.size, 0)) }}</small><small :title="entry.identity.url">{{ $t('flow.sourceBranch') }}: {{ entry.identity.url }}</small><span>{{ phase(entry.phase) }}</span><p v-if="entry.warning" class="error">{{ entry.warning }}</p></div>
      <div class="actions"><el-button size="small" :disabled="flow.busy" @click.stop="restore(entry, false)">{{ $t('flow.applyStash') }}</el-button><el-button size="small" :disabled="flow.busy" @click.stop="restore(entry, true)">{{ $t('flow.pop') }}</el-button><el-button size="small" :disabled="flow.busy" @click.stop="exportStash(entry)">{{ $t('flow.export') }}</el-button><el-button size="small" :disabled="flow.busy" @click.stop="remove(entry)">{{ $t('flow.delete') }}</el-button></div>
    </article>
    <div v-if="selected" class="stash-details"><strong>{{ selected.name }}</strong><pre v-if="selected.legacy">{{ selected.legacy.patch }}</pre><button v-for="node in selected.nodes" :key="node.path" class="node-line" @click="previewNode(node.path)"><span>{{ node.status }} · {{ node.path }}</span><span>{{ size(node.size) }}</span></button></div>
    <div v-if="filePreview" class="asset-preview"><article><strong>{{ $t('flow.base') }}</strong><pre>{{ filePreview.base ?? $t('flow.binary') }}</pre></article><article><strong>{{ $t('flow.saved') }}</strong><pre>{{ filePreview.working ?? $t('flow.binary') }}</pre></article></div>
    <el-dialog v-model="creatingDialog" :title="$t('flow.createStash')" width="min(960px, 94vw)" :close-on-click-modal="false">
      <el-input v-model="name" :placeholder="$t('flow.name')" maxlength="120" />
      <p>{{ $t('flow.selectFiles') }}</p>
      <el-table :data="choices" max-height="280" @selection-change="select"><el-table-column type="selection" width="42"/><el-table-column prop="path" :label="$t('flow.files')"/><el-table-column prop="status_code" :label="$t('flow.state')" width="120"/></el-table>
      <el-button :loading="inspecting" :disabled="!files.length || flow.busy" @click="inspect">{{ $t('flow.inspect') }}</el-button>
      <div v-if="preview.length" class="stash-details"><div v-for="node in preview" :key="node.path" class="node-line"><span>{{ node.status }} · {{ node.path }}</span><span>{{ size(node.size) }}</span></div></div>
      <p v-if="error" class="error">{{ error }}</p>
      <template #footer><el-button :disabled="flow.busy" @click="creatingDialog = false">{{ $t('common.cancel') }}</el-button><el-button type="primary" :loading="flow.busy" :disabled="!preview.length || !name.trim()" @click="create">{{ $t('flow.saveHide') }}</el-button></template>
    </el-dialog>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { open } from '@tauri-apps/plugin-dialog'
import { useWorkflowStore } from '@/stores/workflows'
import { useStashStore } from '@/stores/stash'
import { useWorkspaceStore } from '@/stores/workspace'
import { assetStashCandidates, assetStashCreate, assetStashCheck, assetStashApply, assetStashDelete, assetStashExport, assetStashImport, assetStashMigrate, assetStashPreview, type AssetStash, type AssetNode } from '@/api/workflows'
const flow = useWorkflowStore(), workspace = useWorkspaceStore(), route = useRoute(), { t, te } = useI18n()
const legacyStore = useStashStore()
const selected = ref<AssetStash | null>(null), creatingDialog = ref(false), inspecting = ref(false), preview = ref<AssetNode[]>([]), files = ref<string[]>([]), name = ref(''), error = ref('')
const filePreview = ref<Awaited<ReturnType<typeof assetStashPreview>> | null>(null)
let previewGeneration = 0
let inspectionGeneration = 0
async function previewNode(path: string) {
  const id = selected.value?.id, request = ++previewGeneration
  if (!id) return
  try { const result = await assetStashPreview(id, path); if (request === previewGeneration && selected.value?.id === id) filePreview.value = result } catch (e) { ElMessage.error(String(e)) }
}
watch(() => selected.value?.id, () => { previewGeneration++; filePreview.value = null })
const choices = computed(() => workspace.statusList.filter(s => ['modified','added','deleted','unversioned','normal','none'].includes(s.status_code) || s.prop_status === 'modified'))
const size = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`
const phase = (value: string) => te(`flow.${value}`) ? t(`flow.${value}`) : value
function select(rows: { path: string }[]) { inspectionGeneration++; inspecting.value = false; files.value = rows.map(r => r.path); preview.value = []; error.value = '' }
function openCreate() { inspectionGeneration++; inspecting.value = false; name.value = `WIP ${new Date().toLocaleString()}`; files.value = []; preview.value = []; error.value = ''; creatingDialog.value = true }
async function inspect() {
  const path = workspace.currentPath, request = ++inspectionGeneration, selection = [...files.value]
  if (!path) return
  inspecting.value = true
  try { const result = await assetStashCandidates(path, selection); if (request === inspectionGeneration && path === workspace.currentPath) { preview.value = result; error.value = '' } } catch (e) { if (request === inspectionGeneration) { error.value = String(e); preview.value = [] } } finally { if (request === inspectionGeneration) inspecting.value = false }
}
async function create() {
  const path = workspace.currentPath, url = flow.identity?.url
  if (!path || !url || !preview.value.length) return
  try { const entry = await flow.perform(t('flow.createStash'), () => assetStashCreate(path, name.value, files.value, url)); selected.value = entry; creatingDialog.value = false; if (entry.warning) ElMessage.warning(entry.warning) } catch (e) { error.value = String(e) }
}
async function restore(entry: AssetStash, pop: boolean) {
  const path = workspace.currentPath
  if (!path) return
  try {
    await ElMessageBox.confirm(`${entry.name}\n${entry.identity.url || t('flow.unknown')}\n→ ${path}\n${entry.legacy ? entry.warning || '' : ''}\n${t('flow.restoreConfirm')}`, pop ? t('flow.pop') : t('flow.applyStash'), { type:'warning' })
    const collisions = await assetStashCheck(path, entry.id)
    if (collisions.length) await ElMessageBox.confirm(`${t('flow.overwriteConfirm')}\n${collisions.map(c => c.path).join('\n')}`, t('flow.warning'), { type: 'warning' })
    const result = await flow.perform(pop ? t('flow.pop') : t('flow.applyStash'), () => assetStashApply(path, entry.id, pop, collisions))
    selected.value = result
    if (result.warning) ElMessage.warning(result.warning)
  } catch (e) { if (e !== 'cancel' && e !== 'close') ElMessage.error(String(e)) }
}
async function remove(entry: AssetStash) {
  try { await ElMessageBox.confirm(t('flow.deleteConfirm'), entry.name, { type: 'warning' }); await flow.perform(t('flow.delete'), () => assetStashDelete(entry.id)); if (selected.value?.id === entry.id) selected.value = null } catch (e) { if (e !== 'cancel' && e !== 'close') ElMessage.error(String(e)) }
}
async function exportStash(entry: AssetStash) {
  try { const destination = await open({ directory: true, title: t('flow.exportHint') }); if (typeof destination === 'string') await flow.perform(t('flow.export'), () => assetStashExport(entry.id, destination), false) } catch (e) { ElMessage.error(String(e)) }
}
async function importStash() {
  try { const source = await open({ directory: true, title: t('flow.importHint') }); if (typeof source === 'string') { const entry = await flow.perform(t('flow.import'), () => assetStashImport(source)); selected.value = entry } } catch (e) { ElMessage.error(String(e)) }
}
async function migrate() {
  try {
    const ids = await flow.perform(t('flow.migrate'), () => assetStashMigrate([...legacyStore.entries]))
    for (const id of ids) legacyStore.removeEntry(id)
  } catch (e) { ElMessage.error(String(e)) }
}
watch([() => route.query.id, () => flow.stashes], ([id]) => { if (typeof id === 'string') selected.value = flow.stashes.find(s => s.id === id) || null }, { immediate: true })
watch(() => [route.query.file, route.query.files], async ([file, selected]) => {
  const requested = Array.isArray(selected) ? selected.filter((value): value is string => typeof value === 'string') : typeof selected === 'string' ? [selected] : typeof file === 'string' ? [file] : []
  if (requested.length) { openCreate(); files.value = requested; await inspect() }
}, { immediate: true })
watch(() => workspace.currentPath, () => { inspectionGeneration++; inspecting.value = false; creatingDialog.value = false; selected.value = null; preview.value = []; files.value = [] })
</script>
<style scoped>
.node-line{width:100%;border:0;background:none;color:inherit;text-align:left;cursor:pointer}.asset-preview{display:flex;gap:12px;padding:12px}.asset-preview article{flex:1;min-width:0}.asset-preview pre,.stash-details pre{white-space:pre-wrap;max-height:300px;overflow:auto;font-size:12px}
.asset-stashes{padding:16px;border-bottom:1px solid var(--md-sys-color-outline-variant)}header,.stash-record,.node-line{display:flex;justify-content:space-between;gap:12px}header p{font-size:12px;color:var(--md-sys-color-on-surface-variant);max-width:600px}.actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.stash-record{border-top:1px solid var(--md-sys-color-outline-variant);padding:12px 0;cursor:pointer}.stash-record.selected{background:var(--md-sys-color-surface-container)}.stash-record small{display:block;font-size:11px;overflow-wrap:anywhere}.stash-details{max-height:240px;overflow:auto;padding:12px;background:var(--md-sys-color-surface-container);font-size:12px;margin-top:12px}.node-line{padding:4px;overflow-wrap:anywhere}.error{color:var(--md-sys-color-error);white-space:pre-wrap}@media(max-width:1000px){header,.stash-record{flex-direction:column}}</style>
