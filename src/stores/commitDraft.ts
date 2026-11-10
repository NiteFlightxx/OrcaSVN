import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useWorkspaceStore } from './workspace'
import { stagingKey } from '@/utils/staging'
import { composeCommitMessage, splitCommitMessage, type CommitMessageParts } from '@/utils/commitMessage'

const STORAGE_KEY = 'orcasvn-commit-drafts-v1'
function readDrafts(): Record<string, CommitMessageParts> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
    return Object.fromEntries(Object.entries(saved).filter(([, draft]) => draft && typeof draft === 'object' && typeof draft.subject === 'string' && typeof draft.description === 'string'))
  } catch { return {} }
}

export const useCommitDraftStore = defineStore('commit-draft', () => {
  const workspace = useWorkspaceStore()
  const drafts = ref(readDrafts())
  const key = computed(() => stagingKey(workspace.currentPath, workspace.svnInfo?.url))
  const current = computed(() => drafts.value[key.value] || { subject: '', description: '' })

  function save(draft: CommitMessageParts, draftKey = key.value) {
    if (!draftKey) return
    drafts.value = { ...drafts.value, [draftKey]: draft }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts.value)) } catch { /* Keep the draft in memory if storage is unavailable. */ }
  }
  const subject = computed({ get: () => current.value.subject, set: (value: string) => save({ ...current.value, subject: value }) })
  const description = computed({ get: () => current.value.description, set: (value: string) => save({ ...current.value, description: value }) })
  const message = computed(() => composeCommitMessage(subject.value, description.value))
  function loadMessage(value: string) { save(splitCommitMessage(value)) }
  function clear() { save({ subject: '', description: '' }) }
  function clearIfUnchanged(draftKey: string, submittedMessage: string) {
    const draft = drafts.value[draftKey]
    if (draft && composeCommitMessage(draft.subject, draft.description) === submittedMessage) save({ subject: '', description: '' }, draftKey)
  }
  return { key, subject, description, message, loadMessage, clear, clearIfUnchanged }
})
