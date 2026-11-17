<template>
  <div class="conflicts-workbench" :aria-busy="loading || refreshing">
    <header>
      <strong>{{ $t('flow.conflicts') }} ({{ conflicts.length }})</strong>
      <el-button :disabled="flow.busy || loading || refreshing" @click="refresh">{{
        $t('flow.refresh')
      }}</el-button>
    </header>
    <p v-if="refreshing" role="status">{{ $t('common.loading') }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="!loading && !refreshing && !error && !conflicts.length" class="muted" role="status">
      {{ $t('conflictReview.empty') }}
    </p>
    <div v-if="conflicts.length" class="conflict-split">
      <nav :aria-label="$t('flow.conflicts')">
        <button
          v-for="item in conflicts"
          :key="item.path"
          :class="{ active: selected?.path === item.path }"
          :aria-pressed="selected?.path === item.path"
          @click="selectedPath = item.path"
        >
          <span class="conflict-kind">{{ kindLabel(item.kind) }}</span
          ><span>{{ item.path }}</span>
        </button>
      </nav>
      <section v-if="selected">
        <h3>{{ selected.path }}</h3>
        <p v-if="loading" class="muted" role="status">{{ $t('conflictReview.loadingDetails') }}</p>
        <p v-if="!selected.confirmed && !loading && !refreshing" class="notice" role="status">
          {{ $t('conflictReview.unverified') }}
        </p>
        <template v-if="detail">
          <ConflictExplanation
            :conflict="detail"
            :workspace="workspace.currentPath || undefined"
            :file="selected.path"
            :version="context"
          />
          <div class="actions">
            <el-button type="primary" :disabled="!canResolve" @click="openResolution">{{
              $t('conflictReview.handle')
            }}</el-button>
            <el-button @click="reveal">{{ $t('flow.openFile') }}</el-button>
          </div>
          <details v-if="detail.versions.length" class="version-details">
            <summary>{{ $t('conflictDialog.versions') }}</summary>
            <div class="versions">
              <article v-for="version in detail.versions" :key="version.side">
                <strong
                  >{{ $t(`flow.${version.side}`) }} · {{ version.size.toLocaleString() }} B</strong
                >
                <p>{{ version.path }}</p>
                <pre>{{ version.text ?? $t('flow.binary') }}</pre>
              </article>
            </div>
          </details>
          <details>
            <summary>{{ $t('conflictReview.diagnostics') }}</summary>
            <pre>{{ detail.details }}</pre>
          </details>
        </template>
      </section>
    </div>
    <ConflictResolutionDialog
      v-if="conflictRequest"
      :request="conflictRequest"
      @close="conflictRequest = null"
      @resolved="onResolved"
    />
  </div>
</template>
<script setup lang="ts">
import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  ref,
  shallowReactive,
  watch,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorkflowStore } from '@/stores/workflows'
import { useWorkspace } from '@/composables/useWorkspace'
import { repositoryConflictDetail, type ConflictDetail } from '@/api/workflows'
import { revealWorkspaceFile } from '@/api/svn'
import ConflictExplanation from '@/components/ConflictExplanation.vue'
import ConflictResolutionDialog from '@/components/ConflictResolutionDialog.vue'
import type { ConflictRequest } from '@/utils/conflictResolution'

const workspace = useWorkspaceStore(),
  flow = useWorkflowStore(),
  { t } = useI18n()
type Snapshot = { detail: ConflictDetail | null; error: string }
const cache = shallowReactive(new Map<string, Snapshot>())
const pending = new Map<string, Promise<Snapshot>>()
const selectedPath = ref(''),
  loading = ref(false),
  refreshing = ref(false),
  refreshError = ref('')
const active = ref(true)
const conflictRequest = ref<ConflictRequest | null>(null)
let generation = 0,
  disposed = false,
  cacheContext = ''
const knownConflicts = computed(() =>
  workspace.statusList.filter(
    (item) => item.status_code === 'conflicted' || item.prop_status === 'conflicted'
  )
)
const context = computed(() =>
  JSON.stringify([
    workspace.currentPath,
    workspace.svnInfo?.url,
    workspace.epoch,
    workspace.historyEpoch,
    knownConflicts.value.map((item) => [item.path, item.status_code, item.prop_status]).sort(),
  ])
)
const conflicts = computed(() =>
  knownConflicts.value
    .map((item) => ({
      path: item.path,
      kind:
        cache.get(item.path)?.detail?.conflict?.kind ||
        (item.prop_status === 'conflicted' ? 'property' : 'unknown'),
      confirmed: !!cache.get(item.path)?.detail?.conflict,
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
)
const selected = computed(
  () =>
    conflicts.value.find((item) => item.path === selectedPath.value) || conflicts.value[0] || null
)
const snapshot = computed(() => (selected.value ? cache.get(selected.value.path) : undefined))
const detail = computed(() => snapshot.value?.detail?.conflict || null)
const identity = computed(() => snapshot.value?.detail?.identity || null)
const error = computed(() => refreshError.value || snapshot.value?.error || '')
const canResolve = computed(
  () =>
    active.value &&
    !disposed &&
    !loading.value &&
    !refreshing.value &&
    !flow.busy &&
    context.value === cacheContext &&
    !!selected.value?.confirmed &&
    !!identity.value
)
function kindLabel(kind: string) {
  return t(`conflictReview.${['content', 'property', 'tree'].includes(kind) ? kind : 'unknown'}`)
}

async function load(force = false) {
  const version = context.value
  if (cacheContext !== version) {
    cacheContext = version
    cache.clear()
    pending.clear()
    generation++
  }
  const path = workspace.currentPath,
    file = selected.value?.path,
    request = ++generation
  loading.value = false
  if (!path || !file || disposed || !active.value || refreshing.value) return
  if (!force && cache.has(file)) return
  loading.value = true
  let query = pending.get(file)
  if (!query) {
    query = repositoryConflictDetail(path, file).then(
      (detail) => ({ detail, error: '' }),
      (error) => ({ detail: null, error: String(error) })
    )
    pending.set(file, query)
  }
  const next = await query
  if (pending.get(file) === query) pending.delete(file)
  if (!disposed && version === context.value && version === cacheContext) {
    cache.delete(file)
    cache.set(file, next)
    // Bound retained file previews while keeping the currently selected path.
    while (cache.size > 8) {
      const oldest = [...cache.keys()].find((key) => key !== selected.value?.path)
      if (!oldest) break
      cache.delete(oldest)
    }
  }
  if (request === generation && !disposed) loading.value = false
}
async function refresh() {
  if (refreshing.value || loading.value || flow.busy) return
  const path = workspace.currentPath,
    url = workspace.svnInfo?.url
  refreshing.value = true
  refreshError.value = ''
  try {
    const success = await useWorkspace().refreshStatus()
    if (disposed || path !== workspace.currentPath || url !== workspace.svnInfo?.url) return
    refreshing.value = false
    await load(true)
    if (success === false) refreshError.value = workspace.error || t('conflictReview.refreshFailed')
  } catch (e) {
    if (!disposed && path === workspace.currentPath) refreshError.value = String(e)
  } finally {
    if (!disposed) refreshing.value = false
  }
}
function openResolution() {
  if (!canResolve.value || !selected.value || !workspace.currentPath || !workspace.svnInfo?.url)
    return
  conflictRequest.value = {
    workspace: workspace.currentPath,
    branch: workspace.svnInfo.url,
    files: [selected.value.path],
    otherCount: 0,
  }
}
async function onResolved() {
  conflictRequest.value = null
  await load(true)
}
async function reveal() {
  if (detail.value && identity.value) {
    try {
      await revealWorkspaceFile(identity.value.root, detail.value.path)
    } catch (e) {
      ElMessage.error(String(e))
    }
  }
}
watch([() => workspace.currentPath, () => workspace.svnInfo?.url], () => {
  selectedPath.value = ''
  if (!flow.busy) conflictRequest.value = null
})
watch(
  [context, () => selected.value?.path],
  () => {
    refreshError.value = ''
    void load()
  },
  { immediate: true }
)
onActivated(() => {
  active.value = true
  void load()
})
onDeactivated(() => {
  active.value = false
  generation++
  loading.value = false
  if (!flow.busy) conflictRequest.value = null
})
onBeforeUnmount(() => {
  disposed = true
  conflictRequest.value = null
  generation++
  cache.clear()
  pending.clear()
})
</script>
<style scoped>
.conflicts-workbench {
  padding: 16px;
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
}
header,
.actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
header {
  justify-content: space-between;
}
.conflict-split {
  display: grid;
  grid-template-columns: minmax(200px, 30%) minmax(0, 1fr);
  gap: 16px;
  margin-top: 12px;
}
nav {
  min-width: 0;
}
nav button {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  text-align: left;
  padding: 10px;
  border: 0;
  border-radius: 4px;
  background: none;
  color: inherit;
  overflow-wrap: anywhere;
  cursor: pointer;
}
nav button.active {
  background: var(--md-sys-color-primary-container);
}
.conflict-kind,
.muted {
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
}
.conflict-kind {
  color: var(--md-sys-color-error);
}
section {
  min-width: 0;
}
h3 {
  font-size: 14px;
  overflow-wrap: anywhere;
  margin: 8px 0 12px;
}
.versions {
  display: flex;
  gap: 12px;
  margin-top: 16px;
}
.version-details {
  margin-top: 16px;
}
summary {
  cursor: pointer;
  font-size: 12px;
}
.versions article {
  min-width: 0;
  flex: 1;
  border: 1px solid var(--md-sys-color-outline-variant);
  padding: 10px;
}
.versions p {
  overflow-wrap: anywhere;
}
pre {
  white-space: pre-wrap;
  overflow: auto;
  max-height: 50vh;
  font-size: 12px;
}
.error {
  color: var(--md-sys-color-error);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.notice {
  padding: 12px;
  background: var(--md-sys-color-surface-container);
  border: 1px solid var(--md-sys-color-outline-variant);
  line-height: 1.6;
  font-size: 13px;
}
@media (max-width: 1000px) {
  .versions {
    flex-direction: column;
  }
}
@media (max-width: 650px) {
  .conflict-split {
    grid-template-columns: 1fr;
  }
}
</style>
