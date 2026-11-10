<template>
  <el-dialog
    :model-value="true"
    :title="$t('experience.review')"
    width="min(760px,94vw)"
    :close-on-click-modal="false"
    :close-on-press-escape="!flow.busy"
    :before-close="close"
  >
    <p>
      {{ $t('experience.destination') }}: <strong>{{ branch }}</strong>
    </p>
    <code>{{ root }}</code>
    <p>{{ $t('experience.selection', { count: files.length }) }}</p>
    <p class="muted">{{ $t('experience.latest') }}</p>
    <p v-if="hidden" role="status">{{ $t('experience.hidden', { count: hidden }) }}</p>
    <ul class="review-paths">
      <li v-for="file in files" :key="file">
        <code>{{ file }}</code>
      </li>
    </ul>
    <CommitMessageEditor :disabled="flow.busy" compact />
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <pre v-if="flow.busy && flow.commandOutput">{{ flow.commandOutput }}</pre>
    <template #footer
      ><el-button :disabled="flow.busy" @click="close">{{ $t('common.cancel') }}</el-button
      ><el-button
        type="primary"
        :disabled="
          flow.busy || !staging.ready || !files.length || !draft.message.trim() || changedContext
        "
        :loading="flow.busy"
        @click="submit"
        >{{ $t(unversioned.length ? 'experience.addFirst' : 'experience.submit') }}</el-button
      ></template
    >
  </el-dialog>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorkflowStore } from '@/stores/workflows'
import { useStagingStore } from '@/stores/staging'
import { useCommitDraftStore } from '@/stores/commitDraft'
import { useSettings } from '@/composables/useSettings'
import { svnAdd, svnCommit, svnStatus } from '@/api/svn'
import CommitMessageEditor from './CommitMessageEditor.vue'
const props = defineProps<{ visibleFiles?: string[] }>()
const emit = defineEmits<{ close: []; submitted: [] }>()
const { t } = useI18n(),
  workspace = useWorkspaceStore(),
  staging = useStagingStore(),
  flow = useWorkflowStore(),
  draft = useCommitDraftStore(),
  { settings } = useSettings()
const root = workspace.currentPath!,
  branch = workspace.svnInfo?.url || '',
  key = staging.key
const files = ref([...staging.paths]),
  error = ref(''),
  notice = ref('')
const changedContext = computed(
  () => root !== workspace.currentPath || key !== staging.key || branch !== workspace.svnInfo?.url
)
const unversioned = computed(() =>
  (workspace.rawStatusList || [])
    .filter((entry) => files.value.includes(entry.path) && entry.status_code === 'unversioned')
    .map((entry) => entry.path)
)
const hidden = computed(
  () =>
    files.value.filter(
      (file) =>
        !(props.visibleFiles || workspace.statusList.map((entry) => entry.path)).includes(file)
    ).length
)
function close() {
  if (!flow.busy) emit('close')
}
async function submit() {
  if (changedContext.value || flow.busy || !staging.ready) return
  error.value = ''
  notice.value = ''
  const message = draft.message,
    draftKey = draft.key,
    selected = [...files.value],
    toAdd = [...unversioned.value]
  try {
    const result = await flow.perform(t('menu.commit'), async () => {
      const fresh = await svnStatus(root, true)
      if (changedContext.value) throw new Error(t('branchUI.contextChanged'))
      const available = new Set(
        fresh
          .filter(
            (entry) => entry.status_code !== 'conflicted' && entry.prop_status !== 'conflicted'
          )
          .map((entry) => entry.path)
      )
      if (selected.some((file) => !available.has(file)))
        throw new Error(t('branchUI.contextChanged'))
      if (toAdd.length) return { added: true, result: await svnAdd(root, toAdd) }
      return {
        added: false,
        result: await svnCommit(root, message, selected, settings.autoDeleteMissingOnCommit),
      }
    })
    if (result.added) {
      files.value = (workspace.rawStatusList || [])
        .filter(
          (entry) =>
            selected.includes(entry.path) ||
            toAdd.some((parent) => entry.path.startsWith(parent + '/'))
        )
        .map((entry) => entry.path)
      staging.stage(files.value)
      notice.value = t('commit.reviewAdded')
      return
    }
    if (!result.result.success) {
      error.value = result.result.error || result.result.output
      return
    }
    staging.unstage(selected, key)
    draft.clearIfUnchanged(draftKey, message)
    try {
      const history = JSON.parse(localStorage.getItem('orcasvn-recent-commit-messages') || '{}')
      history[root] = [
        { message, createdAt: new Date().toISOString() },
        ...(history[root] || []).filter((item: { message: string }) => item.message !== message),
      ].slice(0, 20)
      localStorage.setItem('orcasvn-recent-commit-messages', JSON.stringify(history))
    } catch {
      /* Submission already succeeded. */
    }
    ElMessage.success(t('experience.commitSuccess'))
    emit('submitted')
    emit('close')
  } catch (e) {
    error.value = String(e)
  }
}
</script>
<style scoped>
.review-paths {
  max-height: 24vh;
  overflow: auto;
  padding: 8px 20px;
  background: var(--md-sys-color-surface-container-low);
  font-size: 12px;
}
.review-paths li {
  padding: 2px;
  overflow-wrap: anywhere;
}
.muted {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 12px;
}
.error {
  color: var(--md-sys-color-error);
  white-space: pre-wrap;
}
code {
  overflow-wrap: anywhere;
}
pre {
  max-height: 15vh;
  overflow: auto;
  white-space: pre-wrap;
}
</style>
