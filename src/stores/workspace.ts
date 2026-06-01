import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { SvnStatus, SvnInfo } from '@/types'

export const useWorkspaceStore = defineStore('workspace', () => {
  const currentPath = ref<string | null>(null)
  const svnInfo = ref<SvnInfo | null>(null)
  const statusList = ref<SvnStatus[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const hasChanges = computed(() => {
    return statusList.value.some(s => s.status_code !== 'normal' && s.status_code !== '')
  })

  const modifiedCount = computed(() => {
    return statusList.value.filter(s => s.status_code === 'modified').length
  })

  const addedCount = computed(() => {
    return statusList.value.filter(s => s.status_code === 'added').length
  })

  const deletedCount = computed(() => {
    return statusList.value.filter(s => s.status_code === 'deleted').length
  })

  function setCurrentPath(path: string) {
    currentPath.value = path
  }

  function setStatusList(list: SvnStatus[]) {
    statusList.value = list
  }

  function setSvnInfo(info: SvnInfo | null) {
    svnInfo.value = info
  }

  function setLoading(value: boolean) {
    isLoading.value = value
  }

  function setError(value: string | null) {
    error.value = value
  }

  function clearWorkspace() {
    currentPath.value = null
    svnInfo.value = null
    statusList.value = []
    error.value = null
  }

  return {
    currentPath,
    svnInfo,
    statusList,
    isLoading,
    error,
    hasChanges,
    modifiedCount,
    addedCount,
    deletedCount,
    setCurrentPath,
    setStatusList,
    setSvnInfo,
    setLoading,
    setError,
    clearWorkspace,
  }
})
