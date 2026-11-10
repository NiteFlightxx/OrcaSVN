import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { svnUpdate } from '@/api/svn'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorkflowStore } from '@/stores/workflows'

// Updating is a repository operation. Keep the current route and let the shared
// operation runner refresh local state and retain command output, even on failure.
export function useSvnUpdate() {
  const workspace = useWorkspaceStore()
  const workflow = useWorkflowStore()
  const { t } = useI18n()
  const updating = ref(false)

  async function updateWorkspace() {
    const path = workspace.currentPath
    if (!path || workspace.isLoading || workflow.busy || updating.value) return
    updating.value = true
    try {
      const result = await workflow.perform(t('menu.update'), () => svnUpdate(path))
      if (workspace.currentPath !== path) return
      if (result.conflicts?.length) ElMessage.warning(t('update.conflictsTitle'))
      else if (!workflow.refreshWarning)
        ElMessage.success(`${t('common.update')} ${t('common.success')}`)
      return result
    } catch (error) {
      if (workspace.currentPath === path) workspace.setError(String(error))
    } finally {
      updating.value = false
    }
  }

  return { updateWorkspace, updating }
}
