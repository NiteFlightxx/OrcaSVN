<template>
  <el-dialog
    :model-value="true"
    :title="$t('historyMenu.' + request.action)"
    width="min(720px,94vw)"
    :close-on-click-modal="false"
    :close-on-press-escape="!loading"
    :before-close="close"
  >
    <p class="revision-set">
      <strong>{{ revisions.map((r) => 'r' + r).join(', ') }}</strong>
    </p>
    <code class="source">{{ request.source }}</code>
    <p>{{ $t('historyMenu.' + hint) }}</p>
    <el-form label-position="top" :disabled="loading">
      <el-form-item v-if="needsDestination" :label="$t('historyMenu.destination')" required>
        <el-input
          v-model="destination"
          :placeholder="remoteCopy ? request.source.replace(/[^/]+$/, '') + '…' : ''"
        />
        <el-button v-if="!remoteCopy" @click="choose">{{ $t('historyMenu.choose') }}</el-button>
      </el-form-item>
      <el-form-item v-if="needsMessage" :label="$t('commit.commitMessage')" required>
        <el-input v-model="message" type="textarea" :rows="6" />
      </el-form-item>
    </el-form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <template #footer
      ><el-button :disabled="loading" @click="close">{{ $t('common.cancel') }}</el-button
      ><el-button
        type="primary"
        :disabled="!valid || changed"
        :loading="loading"
        @click="execute"
        >{{ $t('historyMenu.confirm') }}</el-button
      ></template
    >
  </el-dialog>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import {
  historyCopy,
  historyCheckout,
  historyEditMessage,
  historyExportPatches,
} from '@/api/historyActions'
import { useWorkflowStore } from '@/stores/workflows'
import { useWorkspaceStore } from '@/stores/workspace'
import { useSvnUpdate } from '@/composables/useSvnUpdate'
import type { HistoryActionRequest } from '@/utils/historyMenu'
const props = defineProps<{ request: HistoryActionRequest }>()
const emit = defineEmits<{ close: []; changed: [] }>()
const { t } = useI18n(),
  flow = useWorkflowStore(),
  workspace = useWorkspaceStore(),
  { updateWorkspace } = useSvnUpdate()
const loading = ref(false),
  error = ref(''),
  destination = ref(''),
  message = ref(props.request.action === 'editMessage' ? props.request.entries[0].message : '')
const revisions = props.request.entries.map((e) => e.revision).sort((a, b) => a - b)
const remoteCopy = computed(() => ['createBranch', 'createTag'].includes(props.request.action))
const needsDestination = computed(
  () => remoteCopy.value || ['checkoutRevision', 'exportPatch'].includes(props.request.action)
)
const needsMessage = computed(() => remoteCopy.value || props.request.action === 'editMessage')
const changed = computed(
  () =>
    workspace.currentPath !== props.request.path ||
    workspace.svnInfo?.url !== props.request.expectedUrl
)
const valid = computed(
  () =>
    !loading.value &&
    !flow.busy &&
    (!needsDestination.value || Boolean(destination.value.trim())) &&
    (!needsMessage.value || Boolean(message.value.trim()))
)
const hint = computed(() =>
  remoteCopy.value
    ? 'copyHint'
    : props.request.action === 'editMessage'
      ? 'messageHint'
      : props.request.action === 'exportPatch'
        ? 'patchHint'
        : props.request.action === 'updateRevision'
          ? 'updateHint'
          : 'checkoutHint'
)
function close() {
  if (!loading.value) emit('close')
}
async function choose() {
  const folder = await open({ directory: true, multiple: false })
  if (typeof folder === 'string') destination.value = folder
}
async function execute() {
  if (!valid.value || changed.value) return
  loading.value = true
  error.value = ''
  const r = props.request,
    revision = revisions[0]
  try {
    if (r.action === 'updateRevision') {
      const result = await updateWorkspace(revision)
      if (!result?.success) {
        error.value = workspace.error || t('common.error')
        return
      }
    } else {
      await flow.perform(
        t('historyMenu.' + r.action),
        async () => {
          if (remoteCopy.value)
            return historyCopy(
              r.path,
              r.source,
              revision,
              destination.value.trim(),
              message.value,
              r.expectedUrl
            )
          if (r.action === 'checkoutRevision')
            return historyCheckout(
              r.path,
              r.source,
              revision,
              destination.value.trim(),
              r.expectedUrl
            )
          if (r.action === 'editMessage')
            return historyEditMessage(
              r.path,
              r.source,
              revision,
              r.entries[0].message,
              message.value,
              r.expectedUrl
            )
          return historyExportPatches(
            r.path,
            r.source,
            revisions,
            destination.value.trim(),
            r.expectedUrl
          )
        },
        false
      )
      if (r.action === 'createBranch' && !changed.value) {
        try {
          flow.rememberBranch({
            url: destination.value.trim(),
            name: destination.value.trim().split('/').pop() || '',
            kind: 'dir',
          })
        } catch {
          /* The repository copy already succeeded. */
        }
      }
      if (remoteCopy.value || r.action === 'editMessage') emit('changed')
      ElMessage.success(t('historyMenu.done'))
    }
    emit('close')
  } catch (e) {
    error.value = String(e)
  } finally {
    loading.value = false
  }
}
</script>
<style scoped>
.revision-set {
  max-height: 10em;
  overflow: auto;
}
.source {
  display: block;
  overflow-wrap: anywhere;
  font-size: var(--app-font-size-sm);
}
.error {
  color: var(--el-color-danger);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 30vh;
  overflow: auto;
}
</style>
