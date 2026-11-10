<template>
  <el-dialog :model-value="true" :title="$t('conflictDialog.title')" width="min(760px, 94vw)" :close-on-click-modal="false" :close-on-press-escape="!executing" :before-close="close">
    <p class="conflict-intro">{{ $t('conflictDialog.intro') }}</p>
    <p v-if="request.otherCount" class="conflict-notice">{{ $t('conflictDialog.otherChanges', { count: request.otherCount }) }}</p>
    <p v-if="loading" role="status">{{ $t('common.loading') }}</p>
    <p v-if="error" role="alert" class="conflict-error">{{ error }}</p>
    <ul class="conflict-targets"><li v-for="item in items" :key="item.path"><code>{{ item.path }}</code><span v-if="completed.includes(item.path)">✓</span></li></ul>
    <fieldset :disabled="loading || executing || !isCurrent() || !remaining.length">
      <legend>{{ $t('conflictDialog.choose') }}</legend>
      <label><input v-model="strategy" type="radio" value="working" name="conflict-strategy"/><span><strong>{{ $t('conflictDialog.working') }}</strong><small>{{ $t('conflictDialog.workingHint') }}</small></span></label>
      <label><input v-model="strategy" type="radio" value="mine-full" name="conflict-strategy" :disabled="hasManualConflict"/><span><strong>{{ $t('conflictDialog.local') }}</strong><small>{{ $t('conflictDialog.localHint') }}</small></span></label>
      <label><input v-model="strategy" type="radio" value="theirs-full" name="conflict-strategy" :disabled="hasManualConflict"/><span><strong>{{ $t('conflictDialog.incoming') }}</strong><small>{{ $t('conflictDialog.incomingHint') }}</small></span></label>
      <label v-if="hasManualConflict" class="manual-confirm"><input v-model="manual" type="checkbox"/><span>{{ $t('conflictDialog.manual') }}</span></label>
    </fieldset>
    <p class="conflict-notice">{{ $t('conflictDialog.backup') }}</p>
    <details v-if="items.length"><summary>{{ $t('conflictDialog.versions') }}</summary><article v-for="item in items" :key="item.path"><strong>{{ item.path }}</strong><div v-for="version in item.versions" :key="version.side"><small>{{ $t(`flow.${version.side}`) }} · {{ version.size.toLocaleString() }} B · {{ version.path }}</small><pre v-if="version.text !== null">{{ version.text }}</pre><small v-else>{{ $t('flow.binary') }}</small></div></article></details>
    <template #footer><el-button :disabled="executing" @click="close">{{ $t('common.cancel') }}</el-button><el-button :disabled="executing || loading" @click="load">{{ $t('flow.refresh') }}</el-button><el-button type="primary" :loading="executing" :disabled="!canApply" @click="apply">{{ $t('conflictDialog.apply') }}</el-button></template>
  </el-dialog>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorkflowStore } from '@/stores/workflows'
import { repositoryConflicts, repositoryIdentity, repositoryResolve, type Conflict, type Identity } from '@/api/workflows'
import { selectedConflicts, strategyAllowed, type ConflictRequest, type ConflictStrategy } from '@/utils/conflictResolution'
const props = defineProps<{ request: ConflictRequest }>()
const emit = defineEmits<{ close: []; resolved: [] }>()
const workspace = useWorkspaceStore(), flow = useWorkflowStore(), { t } = useI18n()
const items = ref<Conflict[]>([]), identity = ref<Identity | null>(null), completed = ref<string[]>([])
const strategy = ref<ConflictStrategy>('working'), manual = ref(false), loading = ref(false), executing = ref(false), error = ref('')
let generation = 0, disposed = false
const remaining = computed(() => items.value.filter(item => !completed.value.includes(item.path)))
const hasManualConflict = computed(() => remaining.value.some(item => item.kind !== 'content'))
function isCurrent() { return !disposed && props.request.workspace === workspace.currentPath && props.request.branch === workspace.svnInfo?.url }
const canApply = computed(() => !loading.value && !executing.value && !flow.busy && isCurrent() && identity.value !== null && strategyAllowed(strategy.value, remaining.value, manual.value))
async function load() {
  if (executing.value) return
  const request = props.request, current = ++generation
  loading.value = true; error.value = ''; items.value = []; identity.value = null; completed.value = []; manual.value = false
  try {
    const [info, conflicts] = await Promise.all([repositoryIdentity(request.workspace), repositoryConflicts(request.workspace)])
    if (current !== generation || props.request !== request || !isCurrent()) return
    items.value = selectedConflicts(request.workspace, info.root, request.files, conflicts)
    identity.value = info
    if (!items.value.length) error.value = t('conflictDialog.noConflicts')
  } catch (e) { if (current === generation && isCurrent()) error.value = String(e) }
  finally { if (current === generation && !disposed) loading.value = false }
}
async function apply() {
  if (!canApply.value || !identity.value) return
  const current = generation, request = props.request, info = { ...identity.value }, choice = strategy.value, selected = [...remaining.value]
  executing.value = true; error.value = ''
  try {
    await flow.perform(t('conflictDialog.title'), async () => {
      for (const item of selected) {
        if (!isCurrent() || props.request !== request || current !== generation) throw new Error(t('fileMenu.changed'))
        const result = await repositoryResolve(info.root, item.path, choice, info.url)
        if (result.error) throw new Error(result.error)
        if (result.conflicts.includes(item.path)) throw new Error(t('conflictDialog.unresolved', { path: item.path }))
        completed.value.push(item.path)
      }
      return { strategy: choice, paths: completed.value, error: null }
    })
    if (current === generation && isCurrent()) emit('resolved')
  } catch (e) {
    if (current === generation && isCurrent()) error.value = `${t('conflictDialog.partial', { count: completed.value.length })}\n${String(e)}`
  } finally { executing.value = false }
}
function close() { if (!executing.value) { generation++; emit('close') } }
watch(() => props.request, load, { immediate: true })
watch(() => [workspace.currentPath, workspace.svnInfo?.url], () => { if (!isCurrent() && !executing.value) close() })
onBeforeUnmount(() => { disposed = true; generation++ })
</script>
<style scoped>
.conflict-intro{margin-bottom:10px;font-size:13px}.conflict-notice{margin:10px 0;font-size:12px;line-height:1.6;color:var(--md-sys-color-on-surface-variant)}.conflict-error{white-space:pre-wrap;color:var(--md-sys-color-error);font-size:12px;margin:8px 0}.conflict-targets{max-height:125px;overflow:auto;padding:8px 0;list-style:none;border-block:1px solid var(--md-sys-color-outline-variant)}.conflict-targets li{display:flex;gap:10px;justify-content:space-between;padding:3px 0;overflow-wrap:anywhere;font-size:12px}fieldset{border:0;padding:8px 0}legend{font-size:12px;font-weight:600;padding-top:8px}label{display:flex;align-items:flex-start;gap:9px;padding:9px 4px;cursor:pointer}label input{margin-top:3px}label strong{font-size:13px}label small{display:block;line-height:1.5;margin-top:3px;color:var(--md-sys-color-on-surface-variant);font-size:12px}.manual-confirm{font-size:12px;line-height:1.5}details{font-size:12px}summary{cursor:pointer}article{padding:9px 0;border-bottom:1px solid var(--md-sys-color-outline-variant)}article small{display:block;overflow-wrap:anywhere;padding:4px 0}pre{white-space:pre-wrap;max-height:160px;overflow:auto;font-size:11px}
</style>
