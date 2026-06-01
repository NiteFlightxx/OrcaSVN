import { useWorkspaceStore } from '@/stores/workspace'
import { svnStatus, svnInfo } from '@/api/svn'
import { open } from '@tauri-apps/plugin-dialog'

export function useWorkspace() {
  const workspaceStore = useWorkspaceStore()

  async function openWorkspace(selectDialogTitle: string): Promise<boolean> {
    const selected = await open({
      directory: true,
      multiple: false,
      title: selectDialogTitle,
    })

    if (!selected) return false

    const path = Array.isArray(selected) ? selected[0] : selected
    workspaceStore.setLoading(true)
    workspaceStore.setError(null)

    try {
      const [status, info] = await Promise.all([
        svnStatus(path),
        svnInfo(path),
      ])

      workspaceStore.setCurrentPath(path)
      workspaceStore.setStatusList(status)
      workspaceStore.setSvnInfo(info)
      return true
    } catch (err) {
      workspaceStore.setError(String(err))
      return false
    } finally {
      workspaceStore.setLoading(false)
    }
  }

  async function refreshStatus(): Promise<void> {
    if (!workspaceStore.currentPath) return

    workspaceStore.setLoading(true)
    workspaceStore.setError(null)
    try {
      const [status, info] = await Promise.all([
        svnStatus(workspaceStore.currentPath),
        svnInfo(workspaceStore.currentPath),
      ])
      workspaceStore.setStatusList(status)
      workspaceStore.setSvnInfo(info)
    } catch (err) {
      workspaceStore.setError(String(err))
    } finally {
      workspaceStore.setLoading(false)
    }
  }

  return { openWorkspace, refreshStatus }
}
