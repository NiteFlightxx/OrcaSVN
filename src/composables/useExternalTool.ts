import { useSettings } from './useSettings'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorkflowStore } from '@/stores/workflows'
import { invoke } from '@tauri-apps/api/core'
import { useI18n } from 'vue-i18n'
export function useExternalTool() {
  const { settings } = useSettings(),
    workspace = useWorkspaceStore(),
    flow = useWorkflowStore(),
    { t } = useI18n()
  return {
    async open(file: string, merge = false, rootRelative = false) {
      const executable = merge ? settings.mergeToolPath : settings.diffToolPath
      if (!executable.trim()) throw new Error(t('experience.toolMissing'))
      let args: unknown
      try {
        args = JSON.parse(merge ? settings.mergeToolArgs : settings.diffToolArgs)
      } catch {
        throw new Error(t('experience.invalidArgs'))
      }
      if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string'))
        throw new Error(t('experience.invalidArgs'))
      const path = rootRelative ? flow.identity?.root : workspace.currentPath,
        expectedUrl = flow.identity?.url || workspace.svnInfo?.url
      if (!path || !expectedUrl) return
      await flow.perform(
        t(merge ? 'experience.externalMerge' : 'experience.externalDiff'),
        () =>
          invoke('workspace_external_tool', { path, file, executable, args, merge, expectedUrl }),
        merge
      )
    },
  }
}
