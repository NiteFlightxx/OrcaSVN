import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { svnUpdate } from '@/api/svn'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorkflowStore } from '@/stores/workflows'
import { useWorkspace } from '@/composables/useWorkspace'

// Updating is a repository operation. Keep the current route and let the shared
// operation runner retain command output. Verify local state in the background
// after the native command finishes, including partially failed updates.
export function useSvnUpdate() {
  const workspace = useWorkspaceStore()
  const workflow = useWorkflowStore()
  const { refreshStatusAfterUpdate } = useWorkspace()
  const { t } = useI18n()
  const updating = ref(false)

  async function updateWorkspace() {
    const path = workspace.currentPath
    const url = workspace.svnInfo?.url || ''
    if (!path || workspace.isLoading || workflow.busy || updating.value) return
    const isCurrent = () =>
      workspace.currentPath === path && (!url || workspace.svnInfo?.url === url)
    updating.value = true
    try {
      const result = await workflow.perform(
        t('menu.update'),
        async () => {
          try {
            return await svnUpdate(path)
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
      if (!isCurrent()) return
      if (result.conflicts?.length) ElMessage.warning(t('update.conflictsTitle'))
      else if (!workflow.refreshWarning)
        ElMessage.success(`${t('common.update')} ${t('common.success')}`)
      return result
    } catch (error) {
      if (isCurrent()) workspace.setError(String(error))
    } finally {
      updating.value = false
    }
  }

  return { updateWorkspace, updating }
}
