<template>
  <el-dialog
    class="branch-operation-dialog"
    :align-center="true"
    :model-value="Boolean(flow.switchRequest || flow.plan)"
    :title="$t(isSwitch ? 'flow.switchTo' : 'flow.cherryPick')"
    width="min(720px, 94vw)"
    :close-on-click-modal="false"
    :close-on-press-escape="!executing"
    :before-close="close"
  >
    <template v-if="isSwitch">
      <div class="switch-route">
        <article>
          <small>{{ $t('branchUI.current') }}</small
          ><strong>⑂ {{ branchName(currentUrl) }}</strong
          ><code>{{ currentUrl }}</code>
        </article>
        <span class="route-arrow">→</span>
        <article class="switch-target">
          <small>{{ $t('flow.target') }}</small
          ><strong>⑂ {{ branchName(targetUrl) }}</strong
          ><code>{{ targetUrl }}</code
          ><small v-if="flow.plan">r{{ flow.plan.sourceRevision }}</small>
        </article>
      </div>
      <p class="switch-workspace">
        <span>{{ $t('flow.current') }}</span
        ><code>{{ flow.plan?.identity.root || flow.switchRequest?.workspace }}</code>
      </p>
      <p class="switch-note">{{ $t('branchUI.switchScope') }}</p>
      <details v-if="flow.plan?.localChanges?.length" class="switch-details">
        <summary>
          {{ $t('branchUI.keepChanges', { count: flow.plan.localChanges.length }) }}
        </summary>
        <ul class="blocked-paths">
          <li v-for="path in flow.plan.localChanges" :key="path">
            <code>{{ path }}</code>
          </li>
        </ul>
        <div class="changes-actions">
          <button @click="showChanges('workspace')">{{ $t('branchUI.viewChanges') }}</button
          ><button @click="showChanges('stash')">{{ $t('branchUI.openStash') }}</button>
        </div>
      </details>
      <p v-if="loading" class="check-status" role="status">{{ $t('branchUI.checking') }}</p>
      <p v-else-if="flow.plan && !error" class="check-status ready" role="status">
        ✓ {{ $t('branchUI.ready') }}
      </p>
    </template>
    <template v-else-if="flow.plan">
      <p>
        <strong>{{ $t('flow.current') }}</strong
        >: {{ flow.plan.identity.url }}
      </p>
      <p>
        <strong>{{ $t('flow.source') }}</strong
        >: {{ flow.plan.source }}
      </p>
      <p>{{ $t('flow.cherryHint', { revision: flow.plan.revision }) }}</p>
      <pre class="operation-output">{{ flow.plan.preview }}</pre>
    </template>
    <div v-if="error" class="switch-error" role="alert">
      <strong>{{
        $t(
          failure.kind === 'changes'
            ? 'branchUI.localChanges'
            : failure.kind === 'access'
              ? 'branchUI.accessFailure'
              : 'branchUI.checkFailed'
        )
      }}</strong>
      <p v-if="failure.kind === 'changes'">{{ $t('branchUI.changesHint') }}</p>
      <p v-if="failure.kind === 'access'">{{ $t('branchUI.accessHint') }}</p>
      <ul v-if="failure.paths.length" class="blocked-paths">
        <li v-for="path in failure.paths" :key="path">
          <code>{{ path }}</code>
        </li>
      </ul>
      <div v-if="failure.kind === 'changes'" class="changes-actions">
        <button @click="showChanges('workspace')">{{ $t('branchUI.viewChanges') }}</button
        ><button @click="showChanges('stash')">{{ $t('branchUI.openStash') }}</button>
      </div>
      <details>
        <summary>{{ $t('flow.details') }}</summary>
        <pre>{{ failure.details }}</pre>
      </details>
    </div>
    <details v-if="isSwitch && flow.plan && !error" class="switch-details">
      <summary>{{ $t('flow.details') }}</summary>
      <pre>{{ flow.plan.preview }}</pre>
    </details>
    <p v-if="executing" class="check-status" role="status">{{ $t('branchUI.switching') }}</p>
    <pre v-if="executing && flow.commandOutput" class="operation-output" aria-live="polite">{{
      flow.commandOutput
    }}</pre>
    <template #footer
      ><el-button :disabled="executing" @click="close">{{ $t('common.cancel') }}</el-button
      ><el-button
        v-if="isSwitch && error"
        :disabled="executing || loading || flow.busy"
        @click="check"
        >{{ $t('branchUI.recheck') }}</el-button
      ><el-button type="primary" :loading="executing" :disabled="!canExecute" @click="execute">{{
        $t(isSwitch ? 'branchUI.switch' : 'flow.apply')
      }}</el-button></template
    >
  </el-dialog>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useWorkflowStore } from '@/stores/workflows'
import { repositoryExecute, repositoryPreview } from '@/api/workflows'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorkspace } from '@/composables/useWorkspace'
import { branchKey, branchName, switchFailure } from '@/utils/branches'
import { ElMessage } from 'element-plus'
const flow = useWorkflowStore(),
  { t } = useI18n(),
  router = useRouter(),
  workspace = useWorkspaceStore()
const loading = ref(false),
  executing = ref(false),
  error = ref('')
const displayedKind = ref('switch')
let generation = 0,
  disposed = false
const isSwitch = computed(() => displayedKind.value === 'switch')
const currentUrl = computed(() => flow.switchRequest?.current || flow.plan?.identity.url || '')
const targetUrl = computed(() => flow.switchRequest?.source || flow.plan?.source || '')
const failure = computed(() => switchFailure(error.value))
const canExecute = computed(
  () =>
    Boolean(flow.plan) &&
    !loading.value &&
    !executing.value &&
    !flow.busy &&
    !error.value &&
    (!flow.switchRequest ||
      (flow.switchRequest.workspace === workspace.currentPath &&
        flow.switchRequest.current === flow.identity?.url))
)
function close(done?: unknown) {
  if (executing.value) return
  generation++
  loading.value = false
  error.value = ''
  flow.plan = null
  flow.switchRequest = null
  if (typeof done === 'function') done()
}
async function check() {
  const request = flow.switchRequest
  if (!request || executing.value || flow.busy) return
  if (request.workspace !== workspace.currentPath || request.current !== flow.identity?.url) {
    error.value = t('branchUI.contextChanged')
    return
  }
  const current = ++generation
  loading.value = true
  error.value = ''
  flow.plan = null
  const isCurrent = () =>
    !disposed &&
    generation === current &&
    flow.switchRequest === request &&
    workspace.currentPath === request.workspace &&
    flow.identity?.url === request.current
  try {
    const plan = await repositoryPreview(request.workspace, request.source)
    if (!isCurrent()) return
    if (
      plan.kind !== 'switch' ||
      branchKey(plan.identity.url) !== branchKey(request.current) ||
      branchKey(plan.source) !== branchKey(request.source)
    )
      throw new Error(t('branchUI.contextChanged'))
    flow.plan = plan
  } catch (e) {
    if (isCurrent()) error.value = String(e)
  } finally {
    if (current === generation) loading.value = false
  }
}
function showChanges(name: 'workspace' | 'stash') {
  close()
  void router.push({ name })
}
async function execute() {
  const plan = flow.plan,
    originalWorkspace = workspace.currentPath
  if (!plan || !canExecute.value) return
  executing.value = true
  error.value = ''
  try {
    const result = await flow.perform(
      t(plan.kind === 'switch' ? 'flow.switchTo' : 'flow.cherryPick'),
      () => repositoryExecute(plan.id)
    )
    if (disposed || workspace.currentPath !== originalWorkspace) return
    if (workspace.currentPath !== result.root) await useWorkspace().loadWorkspace(result.root)
    if (result.identity) {
      flow.identity = result.identity
      flow.browsingUrl = result.identity.url
      flow.rememberBranch({
        name: branchName(result.identity.url),
        url: result.identity.url,
        kind: 'dir',
      })
    }
    if (plan.kind === 'switch' && result.conflicts.length) {
      generation++
      flow.plan = null
      flow.switchRequest = null
      ElMessage.warning(t('branchUI.switchConflicts', { count: result.conflicts.length }))
      await router.push({ name: 'conflicts' })
      return
    }
    if (result.error) {
      error.value = result.error
      flow.plan = null
      if (plan.kind !== 'switch') ElMessage.error(result.error)
      return
    }
    generation++
    flow.plan = null
    flow.switchRequest = null
    if (result.conflicts.length) {
      await router.push({ name: 'conflicts' })
      return
    }
    if (plan.kind === 'cherry-pick') {
      sessionStorage.setItem(
        'orca_merge_message',
        JSON.stringify({
          root: plan.identity.root,
          message: `Merge ${plan.source} r${plan.revision}`,
        })
      )
      await router.push({
        name: 'commit',
        query: {
          files: workspace.statusList
            .filter((s) => !['unversioned', 'ignored', 'external'].includes(s.status_code))
            .map((s) => s.path),
        },
      })
    }
    ElMessage.success(t(plan.kind === 'switch' ? 'branchUI.switched' : 'flow.completed'))
  } catch (e) {
    if (!disposed && workspace.currentPath === originalWorkspace) {
      error.value = String(e)
      flow.plan = null
      if (plan.kind !== 'switch') ElMessage.error(String(e))
    }
  } finally {
    executing.value = false
  }
}
watch(
  () => flow.switchRequest,
  (request) => {
    generation++
    error.value = ''
    loading.value = false
    if (request) void check()
  },
  { immediate: true }
)
watch(
  () => (flow.switchRequest ? 'switch' : flow.plan?.kind),
  (kind) => {
    if (kind) displayedKind.value = kind
  },
  { immediate: true, flush: 'sync' }
)
watch(
  () => [workspace.currentPath, flow.identity?.url],
  () => {
    if (
      !executing.value &&
      flow.switchRequest &&
      (workspace.currentPath !== flow.switchRequest.workspace ||
        flow.identity?.url !== flow.switchRequest.current)
    )
      close()
  }
)
onBeforeUnmount(() => {
  disposed = true
  generation++
})
</script>
<style scoped>
.switch-route {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 22px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}
.switch-route article {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 5px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.switch-route small {
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant);
}
.switch-route strong {
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.switch-route code,
.switch-workspace code {
  font-family: var(--app-font-family-mono);
  font-size: 11px;
  overflow-wrap: anywhere;
  user-select: text;
}
.switch-target {
  background: var(--md-sys-color-surface-container);
  border-color: var(--md-sys-color-primary) !important;
}
.route-arrow {
  text-align: center;
  color: var(--md-sys-color-on-surface-variant);
}
.switch-workspace {
  display: flex;
  gap: 12px;
  margin: 15px 0 8px;
  font-size: 12px;
}
.switch-workspace code {
  flex: 1;
}
.switch-note {
  font-size: 12px;
  line-height: 1.6;
  color: var(--md-sys-color-on-surface-variant);
}
.check-status {
  padding: 10px 0;
  font-size: 12px;
}
.ready {
  color: var(--md-sys-color-primary);
}
.switch-error {
  padding: 12px;
  margin: 12px 0;
  background: var(--md-sys-color-surface-container);
  border-left: 3px solid var(--md-sys-color-error);
  font-size: 12px;
}
.switch-error p {
  margin: 6px 0;
  line-height: 1.6;
}
.blocked-paths {
  list-style: none;
  max-height: 180px;
  overflow: auto;
  padding: 6px 0;
  white-space: pre;
  font-size: 11px;
}
.changes-actions {
  display: flex;
  gap: 12px;
  margin: 8px 0;
}
.changes-actions button {
  background: none;
  border: 0;
  color: var(--md-sys-color-primary);
  cursor: pointer;
  font: inherit;
}
.switch-details {
  margin-top: 8px;
  font-size: 12px;
}
summary {
  cursor: pointer;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 25vh;
  overflow: auto;
  margin: 8px 0;
  font-size: 11px;
}
.operation-output {
  max-height: 45vh;
  padding: 12px;
  background: var(--md-sys-color-surface-container);
}
p {
  overflow-wrap: anywhere;
}
@media (max-width: 600px) {
  .switch-route {
    grid-template-columns: minmax(0, 1fr);
  }
  .route-arrow {
    display: none;
  }
}
</style>
