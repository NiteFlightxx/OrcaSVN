import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { svnCommit } from '@/api/svn'
import { useCommitDraftStore } from '@/stores/commitDraft'
import { useStagingStore } from '@/stores/staging'
import { useWorkflowStore } from '@/stores/workflows'
import { useWorkspaceStore } from '@/stores/workspace'
import { useSettings } from '@/composables/useSettings'
import { useWorkspace } from '@/composables/useWorkspace'

export function useStagedCommit() {
  const { t } = useI18n()
  const workspace = useWorkspaceStore()
  const staging = useStagingStore()
  const flow = useWorkflowStore()
  const draft = useCommitDraftStore()
  const { settings } = useSettings()
  const { applyCommitResult } = useWorkspace()
  const submitting = ref(false)
  const error = ref('')
  const notice = ref('')
  const canSubmit = computed(() =>
    Boolean(workspace.currentPath && workspace.svnInfo?.url && draft.message.trim()) &&
    staging.ready && staging.paths.length > 0 && !flow.busy && !submitting.value
  )
  const needsAdd = computed(() => {
    const selected = new Set(staging.paths)
    return workspace.rawStatusList?.some((entry) =>
      entry.status_code === 'unversioned' && selected.has(entry.path)
    ) ?? false
  })
  const commitPhase = computed(() => {
    if (flow.phase === 'refreshing') return 'refreshing'
    const phase = flow.progress?.phase
    return phase === 'adding' || phase === 'committing' || phase === 'refreshing' ? phase : 'checking'
  })
  watch(() => staging.key, () => {
    error.value = ''
    notice.value = ''
  }, { flush: 'sync' })

  async function submit() {
    const root = workspace.currentPath
    const branch = workspace.svnInfo?.url
    if (!canSubmit.value || !root || !branch) return
    const selectionKey = staging.key
    const draftKey = draft.key
    const message = draft.message
    const selected = [...staging.paths]
    const isCurrent = () =>
      root === workspace.currentPath && branch === workspace.svnInfo?.url && selectionKey === staging.key
    submitting.value = true
    error.value = ''
    notice.value = ''

    try {
      const result = await flow.perform(
        t('menu.commit'),
        async () => {
          const outcome = await svnCommit(root, message, selected, settings.autoDeleteMissingOnCommit, branch)
          flow.phase = 'refreshing'
          const refreshed = await applyCommitResult(root, branch, outcome)
          if (isCurrent()) {
            flow.refreshWarning = !refreshed
            if (outcome.success && (!refreshed || outcome.warning))
              ElMessage.warning(t('commitFlow.refreshWarning'))
          }
          return outcome
        },
        true,
        false
      )
      if (!result.success) {
        if (isCurrent()) error.value = result.error || result.output || t('common.error')
        return
      }
      if (result.added) {
        if (!isCurrent()) return
        const retained = new Set(selected)
        const added = result.addedPaths || []
        const expanded = (workspace.rawStatusList || [])
          .filter((entry) => retained.has(entry.path) || added.some((parent) => entry.path.startsWith(parent + '/')))
          .map((entry) => entry.path)
        staging.stage(expanded)
        notice.value = t('commit.reviewAdded')
        return
      }
      staging.unstage(selected, selectionKey)
      draft.clearIfUnchanged(draftKey, message)
      try {
        const history = JSON.parse(localStorage.getItem('orcasvn-recent-commit-messages') || '{}')
        history[root] = [
          { message, createdAt: new Date().toISOString() },
          ...(history[root] || []).filter((item: { message: string }) => item.message !== message),
        ].slice(0, 20)
        localStorage.setItem('orcasvn-recent-commit-messages', JSON.stringify(history))
      } catch {
        // The SVN commit has already succeeded.
      }
      if (isCurrent()) ElMessage.success(t('experience.commitSuccess'))
    } catch (failure) {
      if (isCurrent()) error.value = String(failure)
    } finally {
      submitting.value = false
    }
  }

  return { canSubmit, needsAdd, submitting, error, notice, commitPhase, submit }
}
