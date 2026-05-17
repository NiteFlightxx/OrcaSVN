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
    workspaceStore.setCurrentPath(path)

    try {
      const status = await svnStatus(path)
      workspaceStore.setStatusList(status)

      const info = await svnInfo(path)
      workspaceStore.setSvnInfo(info)
      return true
    } catch (err) {
      workspaceStore.error = String(err)
      return false
    }
  }

  async function refreshStatus(): Promise<void> {
    if (!workspaceStore.currentPath) return

    workspaceStore.setLoading(true)
    try {
      const [status, info] = await Promise.all([
        svnStatus(workspaceStore.currentPath),
        svnInfo(workspaceStore.currentPath),
      ])
      workspaceStore.setStatusList(status)
      workspaceStore.setSvnInfo(info)
    } catch (err) {
      workspaceStore.error = String(err)
    } finally {
      workspaceStore.setLoading(false)
    }
  }

  return { openWorkspace, refreshStatus }
}
