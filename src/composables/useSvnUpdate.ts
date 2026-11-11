import { computed, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { svnUpdate } from '@/api/svn'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorkflowStore } from '@/stores/workflows'
import { useWorkspace } from '@/composables/useWorkspace'

// Shared across the toolbar and legacy update view, including when hidden.
export const svnUpdateFeedback = reactive({
  visible: false,
  running: false,
  state: 'idle' as 'idle' | 'running' | 'completed' | 'conflicts' | 'failed',
  workspace: '',
  output: '',
  error: '',
  conflicts: [] as string[],
  startedAt: 0,
  finishedAt: 0,
})

// Updating is a repository operation. Keep the current route and let the shared
// operation runner retain command output. Verify local state in the background
// after the native command finishes, including partially failed updates.
export function useSvnUpdate() {
  const workspace = useWorkspaceStore()
  const workflow = useWorkflowStore()
  const { refreshStatusAfterUpdate } = useWorkspace()
  const { t } = useI18n()
  const updating = computed(() => svnUpdateFeedback.running)

  async function updateWorkspace(revision?: number) {
    const path = workspace.currentPath
    const url = workspace.svnInfo?.url || ''
    if (!path || workspace.isLoading || workflow.busy || updating.value) return
    const isCurrent = () =>
      workspace.currentPath === path && (!url || workspace.svnInfo?.url === url)
    Object.assign(svnUpdateFeedback, {
      visible: true,
      running: true,
      state: 'running',
      workspace: path,
      output: '',
      error: '',
      conflicts: [],
      startedAt: Date.now(),
      finishedAt: 0,
    })
    const stopOutput = watch(
      () => workflow.commandOutput,
      (output) => {
        svnUpdateFeedback.output = output || ''
      },
      { flush: 'sync' }
    )
    try {
      const result = await workflow.perform(
        t('menu.update'),
        async () => {
          try {
            return await svnUpdate(path, revision, revision === undefined ? undefined : url)
          } finally {
            // Do not make a successful SVN command wait for full working-copy
            // verification. The existing list remains visible but marked stale.
            const report = (error: unknown) => {
              if (isCurrent()) workspace.setError(String(error))
            }
            try {
              void refreshStatusAfterUpdate(path, url).catch(report)
            } catch (error) {
              report(error)
            }
          }
        },
        true,
        false
      )
      svnUpdateFeedback.output = result.output || svnUpdateFeedback.output
      svnUpdateFeedback.conflicts = result.conflicts || []
      svnUpdateFeedback.error = result.error || ''
      svnUpdateFeedback.state =
        result.error || result.success === false
          ? 'failed'
          : result.conflicts?.length
            ? 'conflicts'
            : 'completed'
      if (svnUpdateFeedback.state !== 'completed') svnUpdateFeedback.visible = true
      if (!isCurrent()) return
      if (svnUpdateFeedback.state === 'failed')
        workspace.setError(svnUpdateFeedback.error || t('updateProgress.failed'))
      else if (result.conflicts?.length) ElMessage.warning(t('update.conflictsTitle'))
      else if (!workflow.refreshWarning)
        ElMessage.success(`${t('common.update')} ${t('common.success')}`)
      return result
    } catch (error) {
      svnUpdateFeedback.state = 'failed'
      svnUpdateFeedback.visible = true
      svnUpdateFeedback.error = String(error)
      if (isCurrent()) workspace.setError(String(error))
    } finally {
      stopOutput()
      svnUpdateFeedback.running = false
      svnUpdateFeedback.finishedAt = Date.now()
    }
  }

  return { updateWorkspace, updating }
}
