import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorkflowStore } from '@/stores/workflows'
import { useWorkspace } from '@/composables/useWorkspace'
import { useSettings } from '@/composables/useSettings'
import { repositoryResolveBinaries } from '@/api/workflows'

const BATCH_SIZE = 8

// Mount once in the main layout. Read-only status commands remain read-only.
export function useAutomaticBinaryResolution() {
  const workspace = useWorkspaceStore()
  const flow = useWorkflowStore()
  const { settings } = useSettings()
  const { applyStatusPatch, refreshStatusIfStale } = useWorkspace()
  const { t } = useI18n()
  const attempted = new Set<string>()
  let attemptScope = ''
  const running = ref(false)
  let disposed = false
  const stop = watch(
    () => [
      settings.binaryConflictPolicy,
      workspace.rawStatusList,
      workspace.isLoading,
      workspace.statusIsStale,
      workspace.currentPath,
      workspace.svnInfo?.url,
      workspace.epoch,
      workspace.historyEpoch,
      flow.busy,
      running.value,
    ],
    async () => {
      const side = settings.binaryConflictPolicy
      const path = workspace.currentPath
      const url = workspace.svnInfo?.url
      if (
        disposed ||
        (side !== 'local' && side !== 'incoming') ||
        running.value ||
        flow.busy ||
        workspace.isLoading ||
        workspace.statusIsStale ||
        !path ||
        !url
      )
        return
      const scope = JSON.stringify([path, url, workspace.epoch, workspace.historyEpoch, side])
      if (attemptScope !== scope) {
        attempted.clear()
        attemptScope = scope
      }
      const binaries = (workspace.rawStatusList || []).filter(
        (entry) =>
          (entry.status_code === 'conflicted' || entry.prop_status === 'conflicted') &&
          `${path}/${entry.path}`
            .replace(/\\/g, '/')
            .split('/')
            .slice(0, -1)
            .some((part) => part.toLowerCase() === 'binaries')
      )
      const present = new Set(binaries.map(entry => entry.path))
      for (const file of attempted) {
        if (!present.has(file)) attempted.delete(file)
      }
      const candidates = binaries.filter(entry => !attempted.has(entry.path))
        .slice(0, BATCH_SIZE).map(entry => entry.path)
      if (!candidates.length) return
      running.value = true
      const isCurrent = () =>
        !disposed && workspace.currentPath === path && workspace.svnInfo?.url === url
      try {
        await flow.perform(
          t('conflictActions.autoBinaryTitle'),
          async () => {
            for (const file of candidates) attempted.add(file)
            const { resolved, failures, status, verificationFailed } =
              await repositoryResolveBinaries(path, candidates, url, side)
            if (isCurrent()) {
              const needsRefresh = verificationFailed || (status && !(await applyStatusPatch(status)))
              if (needsRefresh && isCurrent()) {
                flow.refreshWarning = true
                workspace.setStatusIsStale(true)
                void refreshStatusIfStale(0)
              }
            }
            const errors = Object.entries(failures).map(([file, error]) => `${file}: ${error}`)
            return {
              output: [
                resolved.length
                  ? t(
                      side === 'local'
                        ? 'conflictActions.autoBinaryResolved'
                        : 'conflictActions.autoBinaryResolvedIncoming',
                      { count: resolved.length }
                    ) +
                    '\n' +
                    resolved.join('\n')
                  : '',
                ...errors,
              ]
                .filter(Boolean)
                .join('\n'),
              error: errors.length ? errors.join('\n') : null,
            }
          },
          true,
          false
        )
      } catch (error) {
        if (isCurrent()) workspace.setError(String(error))
      } finally {
        // Release the workflow gate between bounded batches so the user can
        // start an operation, or switch away and leave remaining files alone.
        if (!disposed) await new Promise(resolve => setTimeout(resolve, 75))
        running.value = false
      }
    },
    { immediate: true, flush: 'post' }
  )
  return () => {
    disposed = true
    stop()
  }
}
