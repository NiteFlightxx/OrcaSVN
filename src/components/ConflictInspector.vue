<template>
  <section class="conflict-inspector" :aria-busy="loading || refreshing">
    <header>
      <strong>{{ file }}</strong
      ><el-button size="small" :disabled="flow.busy || loading" @click="load(true)">{{
        $t('menu.refresh')
      }}</el-button>
    </header>
    <p v-if="loading" class="muted" role="status">{{ $t('conflictReview.loadingDetails') }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="!detail && !loading && !error" class="muted">{{ $t('conflictReview.unverified') }}</p>
    <template v-if="detail">
      <div class="conflict-actions">
        <el-button
          v-if="detail.kind === 'content'"
          :disabled="!canResolve"
          @click="openResolution('mine-full')"
          >{{ $t('conflictDialog.local') }}</el-button
        >
        <el-button
          v-if="detail.kind === 'content'"
          :disabled="!canResolve"
          @click="openResolution('theirs-full')"
          >{{ $t('conflictDialog.incoming') }}</el-button
        >
        <el-button :disabled="!canResolve" @click="openResolution('working')">{{
          $t('flow.keepWorking')
        }}</el-button>
        <el-button v-if="detail.kind === 'content'" :disabled="!canResolve" @click="merge">{{
          $t('experience.externalMerge')
        }}</el-button>
        <el-button @click="reveal">{{ $t('flow.openFile') }}</el-button>
      </div>
      <ConflictExplanation
        :conflict="detail"
        :workspace="workspace.currentPath || undefined"
        :file="file"
        :version="context"
      />
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
import { ElMessage } from 'element-plus'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorkflowStore } from '@/stores/workflows'

import { repositoryConflictDetail, type ConflictDetail } from '@/api/workflows'
import { revealWorkspaceFile } from '@/api/svn'
import ConflictExplanation from '@/components/ConflictExplanation.vue'

import type { ConflictStrategy } from '@/utils/conflictResolution'
import { useExternalTool } from '@/composables/useExternalTool'

const props = defineProps<{ file: string; visible?: boolean }>()
const emit = defineEmits<{ resolve: [strategy: ConflictStrategy] }>()
const workspace = useWorkspaceStore(),
  flow = useWorkflowStore()
type Snapshot = { detail: ConflictDetail | null; error: string }
const cache = shallowReactive(new Map<string, Snapshot>())
const pending = new Map<string, Promise<Snapshot>>()
const loading = ref(false),
  refreshing = ref(false),
  refreshError = ref('')
const active = ref(true)

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
const selected = computed(() => conflicts.value.find((item) => item.path === props.file) || null)
const snapshot = computed(() => (selected.value ? cache.get(selected.value.path) : undefined))
const detail = computed(() => snapshot.value?.detail?.conflict || null)
const identity = computed(() => snapshot.value?.detail?.identity || null)
const error = computed(() => refreshError.value || snapshot.value?.error || '')
const canResolve = computed(
  () =>
    active.value &&
    props.visible !== false &&
    !disposed &&
    !loading.value &&
    !refreshing.value &&
    !flow.busy &&
    context.value === cacheContext &&
    !!selected.value?.confirmed &&
    !!identity.value
)
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
  if (!path || !file || disposed || !active.value || props.visible === false || refreshing.value)
    return
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
function openResolution(strategy: ConflictStrategy = 'working') {
  if (!canResolve.value) return
  emit('resolve', strategy)
}
async function merge() {
  if (!detail.value || detail.value.kind !== 'content' || !canResolve.value) return
  try {
    await useExternalTool().open(props.file, true)
    await load(true)
  } catch (e) {
    refreshError.value = String(e)
  }
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
watch(
  [context, () => selected.value?.path, () => props.visible],
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
})
onBeforeUnmount(() => {
  disposed = true
  generation++
  cache.clear()
  pending.clear()
})
</script>
<style scoped>
.conflict-inspector {
  height: 100%;
  overflow: auto;
  padding: 16px;
  box-sizing: border-box;
}
header,
.conflict-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
header strong {
  flex: 1;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.conflict-actions {
  margin: 12px 0;
}
.versions {
  display: flex;
  gap: 10px;
  margin: 12px 0;
}
.versions article {
  flex: 1;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--md-sys-color-outline-variant);
}
.versions p {
  overflow-wrap: anywhere;
}
pre {
  white-space: pre-wrap;
  overflow: auto;
  max-height: 40vh;
  font-size: 12px;
}
.muted {
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
}
.error {
  color: var(--md-sys-color-error);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
summary {
  cursor: pointer;
  font-size: 12px;
  margin: 12px 0;
}
@media (max-width: 1000px) {
  .versions {
    flex-direction: column;
  }
}
</style>
