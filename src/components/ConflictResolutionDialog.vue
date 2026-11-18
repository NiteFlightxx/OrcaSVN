<template>
  <el-dialog
    :model-value="true"
    :title="$t('conflictDialog.title')"
    width="min(760px, 94vw)"
    :close-on-click-modal="false"
    :close-on-press-escape="!executing"
    :before-close="close"
  >
    <p class="conflict-intro">
      {{ $t(request.strategy ? 'conflictActions.confirmScope' : 'conflictDialog.intro') }}
    </p>
    <strong v-if="request.strategy">{{ $t(choiceLabel) }} · {{ eligible.length }}</strong>
    <p v-if="request.otherCount" class="conflict-notice">
      {{ $t('conflictDialog.otherChanges', { count: request.otherCount }) }}
    </p>
    <p v-if="loading" role="status">{{ $t('common.loading') }}</p>
    <p v-if="error" role="alert" class="conflict-error">{{ error }}</p>
    <ul class="conflict-targets">
      <li v-for="item in items.filter((item) => !skipped.includes(item))" :key="item.path">
        <code>{{ item.path }}</code
        ><span v-if="completed.includes(item.path)">✓</span>
      </li>
    </ul>
    <ConflictExplanation v-if="items.length === 1 && !request.strategy" :conflict="items[0]" />
    <fieldset
      v-if="!request.strategy"
      :disabled="loading || executing || !isCurrent() || !remaining.length"
    >
      <legend>{{ $t('conflictDialog.choose') }}</legend>
      <label
        ><input v-model="strategy" type="radio" value="working" name="conflict-strategy" /><span
          ><strong>{{ $t('conflictDialog.working') }}</strong
          ><small>{{
            $t(hasManualConflict ? 'flow.conflictHint' : 'conflictDialog.workingHint')
          }}</small></span
        ></label
      >
      <label
        ><input v-model="strategy" type="radio" value="mine-full" name="conflict-strategy" /><span
          ><strong>{{ $t('conflictDialog.local') }}</strong
          ><small>{{ $t('conflictDialog.localHint') }}</small></span
        ></label
      >
      <label
        ><input v-model="strategy" type="radio" value="theirs-full" name="conflict-strategy" /><span
          ><strong>{{ $t('conflictDialog.incoming') }}</strong
          ><small>{{ $t('conflictDialog.incomingHint') }}</small></span
        ></label
      >
    </fieldset>
    <label v-if="needsManual" class="manual-confirm"
      ><input v-model="manual" type="checkbox" :disabled="loading || executing" /><span>{{
        $t('conflictDialog.manual')
      }}</span></label
    >
    <p v-if="skipped.length" class="conflict-notice">
      {{ $t('conflictActions.skipped', { count: skipped.length }) }}
    </p>
    <ul v-if="skipped.length" class="conflict-targets">
      <li v-for="item in skipped" :key="item.path">
        <code>{{ item.path }}</code
        ><span>{{
          $t(item.kind === 'tree' ? 'conflictReview.tree' : 'conflictReview.property')
        }}</span>
      </li>
    </ul>
    <p v-for="issue in loadIssues" :key="issue.path" class="conflict-error" role="alert">
      {{ issue.path }} — {{ issue.error }}
    </p>
    <p v-if="executing || completed.length" role="status">
      {{
        $t('conflictActions.progress', {
          done: completed.length,
          total: eligible.length + completed.length,
        })
      }}<span v-if="currentFile"> · {{ currentFile }}</span>
    </p>
    <p v-for="issue in failures" :key="issue.path" class="conflict-error" role="alert">
      {{ issue.path }} — {{ issue.error }}
    </p>
    <div v-if="remaining.length" class="resolution-effect">
      <strong>{{ $t('conflictReview.effectTitle') }}</strong>
      <p>
        {{
          $t(
            strategy === 'mine-full'
              ? 'conflictReview.localEffect'
              : strategy === 'theirs-full'
                ? 'conflictReview.incomingEffect'
                : hasManualConflict
                  ? 'conflictReview.workingEffect'
                  : 'conflictDialog.workingHint'
          )
        }}
      </p>
      <p
        v-for="item in eligible.filter((item) => item.summary?.schedule === 'delete')"
        :key="item.path"
        class="conflict-error"
      >
        {{ item.path }} — {{ $t('conflictReview.pendingDelete') }}
      </p>
    </div>
    <p class="conflict-notice">{{ $t('conflictDialog.backup') }}</p>
    <details v-if="versionItems.length">
      <summary>{{ $t('conflictDialog.versions') }}</summary>
      <article v-for="item in versionItems" :key="item.path">
        <strong>{{ item.path }}</strong>
        <div v-for="version in item.versions" :key="version.side">
          <small
            >{{ $t(`flow.${version.side}`) }} · {{ version.size.toLocaleString() }} B ·
            {{ version.path }}</small
          >
          <pre v-if="version.text !== null">{{ version.text }}</pre>
          <small v-else>{{ $t('flow.binary') }}</small>
        </div>
      </article>
    </details>
    <template #footer
      ><el-button :disabled="executing" @click="close">{{ $t('common.cancel') }}</el-button
      ><el-button :disabled="executing || loading" @click="load">{{ $t('flow.refresh') }}</el-button
      ><el-button type="primary" :loading="executing" :disabled="!canApply" @click="apply">{{
        $t(failures.length ? 'conflictActions.retry' : 'conflictDialog.apply')
      }}</el-button></template
    >
  </el-dialog>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorkflowStore } from '@/stores/workflows'
import {
  repositoryConflictDetail,
  repositoryResolve,
  type Conflict,
  type Identity,
} from '@/api/workflows'
import {
  selectedConflicts,
  strategyAllowed,
  type ConflictRequest,
  type ConflictStrategy,
} from '@/utils/conflictResolution'
import ConflictExplanation from '@/components/ConflictExplanation.vue'
import { useWorkspace } from '@/composables/useWorkspace'
const props = defineProps<{ request: ConflictRequest }>()
const emit = defineEmits<{ close: []; resolved: [] }>()
const workspace = useWorkspaceStore(),
  flow = useWorkflowStore(),
  { t } = useI18n()
const items = ref<Conflict[]>([]),
  identity = ref<Identity | null>(null),
  completed = ref<string[]>([])
const strategy = ref<ConflictStrategy>('working'),
  manual = ref(false),
  loading = ref(false),
  executing = ref(false),
  error = ref('')
const currentFile = ref('')
const loadIssues = ref<{ path: string; error: string }[]>([])
const failures = ref<{ path: string; error: string }[]>([])
let generation = 0,
  disposed = false
const remaining = computed(() => items.value.filter((item) => !completed.value.includes(item.path)))
const versionItems = computed(() => items.value.filter((item) => item.versions.length > 0))
const hasManualConflict = computed(() => remaining.value.some((item) => item.kind !== 'content'))
const eligible = computed(() =>
  remaining.value.filter((item) => strategy.value === 'working' || item.kind === 'content')
)
const skipped = computed(() => remaining.value.filter((item) => !eligible.value.includes(item)))
const needsManual = computed(() => eligible.value.some((item) => item.kind !== 'content'))
const choiceLabel = computed(() =>
  strategy.value === 'mine-full'
    ? 'conflictDialog.local'
    : strategy.value === 'theirs-full'
      ? 'conflictDialog.incoming'
      : 'flow.keepWorking'
)
function isCurrent() {
  return (
    !disposed &&
    props.request.workspace === workspace.currentPath &&
    props.request.branch === workspace.svnInfo?.url
  )
}
const canApply = computed(
  () =>
    !loading.value &&
    !executing.value &&
    !flow.busy &&
    isCurrent() &&
    identity.value !== null &&
    strategyAllowed(strategy.value, eligible.value, manual.value)
)
async function load() {
  if (executing.value) return
  const request = props.request,
    current = ++generation
  loading.value = true
  error.value = ''
  items.value = []
  identity.value = null
  completed.value = []
  manual.value = false
  strategy.value = request.strategy || 'working'
  loadIssues.value = []
  failures.value = []
  currentFile.value = ''
  try {
    const conflicts: Conflict[] = []
    let info: Identity | null = null
    for (const file of [...new Set(request.files)]) {
      try {
        const result = await repositoryConflictDetail(request.workspace, file)
        if (current !== generation || props.request !== request || !isCurrent()) return
        if (info && (info.root !== result.identity.root || info.url !== result.identity.url))
          throw new Error(t('fileMenu.changed'))
        info = result.identity
        if (result.conflict) conflicts.push(result.conflict)
        else loadIssues.value.push({ path: file, error: t('conflictDialog.noConflicts') })
      } catch (e) {
        if (current !== generation || !isCurrent()) return
        loadIssues.value.push({ path: file, error: String(e) })
      }
    }
    if (!info) throw new Error(t('conflictDialog.noConflicts'))
    items.value = selectedConflicts(request.workspace, info.root, request.files, conflicts)
    identity.value = info
    if (!items.value.length) error.value = t('conflictDialog.noConflicts')
  } catch (e) {
    if (current === generation && isCurrent()) error.value = String(e)
  } finally {
    if (current === generation && !disposed) loading.value = false
  }
}
async function apply() {
  if (!canApply.value || !identity.value) return
  const current = generation,
    request = props.request,
    info = { ...identity.value },
    choice = strategy.value,
    selected = [...eligible.value]
  executing.value = true
  error.value = ''
  failures.value = []
  try {
    await flow.perform(
      t('conflictDialog.title'),
      async () => {
        for (const item of selected) {
          if (!isCurrent() || props.request !== request || current !== generation)
            throw new Error(t('fileMenu.changed'))
          currentFile.value = item.path
          try {
            const result = await repositoryResolve(request.workspace, item.path, choice, info.url)
            if (isCurrent() && !(await useWorkspace().applyStatusPatch(result.status || null)))
              flow.refreshWarning = true
            if (result.error) throw new Error(result.error)
            if (result.conflicts.includes(item.path))
              throw new Error(t('conflictDialog.unresolved', { path: item.path }))
            completed.value.push(item.path)
          } catch (e) {
            failures.value.push({ path: item.path, error: String(e) })
          }
        }
        return {
          strategy: choice,
          paths: completed.value,
          error: failures.value.length
            ? t('conflictActions.failed', { count: failures.value.length })
            : null,
        }
      },
      true,
      false
    )
    if (current === generation && isCurrent()) {
      if (!failures.value.length && !loadIssues.value.length) emit('resolved')
      else if (!failures.value.length)
        error.value = t('conflictActions.failed', { count: loadIssues.value.length })
      else
        error.value = `${t('conflictDialog.partial', { count: completed.value.length })}\n${failures.value.map((item) => `${item.path}: ${item.error}`).join('\n')}`
    }
  } catch (e) {
    if (current === generation && isCurrent())
      error.value = `${t('conflictDialog.partial', { count: completed.value.length })}\n${String(e)}`
  } finally {
    executing.value = false
    currentFile.value = ''
  }
}
function close() {
  if (!executing.value) {
    generation++
    emit('close')
  }
}
watch(() => props.request, load, { immediate: true })
watch(
  () => [workspace.currentPath, workspace.svnInfo?.url],
  () => {
    if (!isCurrent() && !executing.value) close()
  }
)
onBeforeUnmount(() => {
  disposed = true
  generation++
})
</script>
<style scoped>
.resolution-effect {
  padding: 12px;
  margin: 8px 0;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.6;
}
.resolution-effect p {
  margin: 6px 0 0;
}
.conflict-intro {
  margin-bottom: 10px;
  font-size: 13px;
}
.conflict-notice {
  margin: 10px 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--md-sys-color-on-surface-variant);
}
.conflict-error {
  white-space: pre-wrap;
  color: var(--md-sys-color-error);
  font-size: 12px;
  margin: 8px 0;
}
.conflict-targets {
  max-height: 125px;
  overflow: auto;
  padding: 8px 0;
  list-style: none;
  border-block: 1px solid var(--md-sys-color-outline-variant);
}
.conflict-targets li {
  display: flex;
  gap: 10px;
  justify-content: space-between;
  padding: 3px 0;
  overflow-wrap: anywhere;
  font-size: 12px;
}
fieldset {
  border: 0;
  padding: 8px 0;
}
legend {
  font-size: 12px;
  font-weight: 600;
  padding-top: 8px;
}
label {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 9px 4px;
  cursor: pointer;
}
label input {
  margin-top: 3px;
}
label strong {
  font-size: 13px;
}
label small {
  display: block;
  line-height: 1.5;
  margin-top: 3px;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 12px;
}
.manual-confirm {
  font-size: 12px;
  line-height: 1.5;
}
details {
  font-size: 12px;
}
summary {
  cursor: pointer;
}
article {
  padding: 9px 0;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}
article small {
  display: block;
  overflow-wrap: anywhere;
  padding: 4px 0;
}
pre {
  white-space: pre-wrap;
  max-height: 160px;
  overflow: auto;
  font-size: 11px;
}
</style>
