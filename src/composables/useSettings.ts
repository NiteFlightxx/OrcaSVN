import { reactive, watch } from 'vue'
import { detectSystemLocale } from '@/i18n'

export interface AppSettings {
  svnPath: string
  encoding: string
  logLimit: number
  theme: 'light' | 'dark' | 'auto'
  language: string
  gitignoreEnabled: boolean
  autoDeleteMissingOnCommit: boolean
  diffToolPath: string
  diffToolArgs: string
  mergeToolPath: string
  mergeToolArgs: string
}

const STORAGE_KEY = 'orcasvn-settings'

const defaults: AppSettings = {
  svnPath: '',
  encoding: 'utf-8',
  logLimit: 50,
  theme: 'auto',
  language: detectSystemLocale(),
  gitignoreEnabled: false,
  autoDeleteMissingOnCommit: false,
  diffToolPath: '',
  diffToolArgs: '["{left}", "{right}"]',
  mergeToolPath: '',
  mergeToolArgs: '["{base}", "{mine}", "{theirs}", "{merged}"]',
}

function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return { ...defaults, ...JSON.parse(stored) }
    }
  } catch {
    // ignore parse errors
  }
  return { ...defaults }
}

const settings = reactive<AppSettings>(loadSettings())

watch(
  () => ({ ...settings }),
  (val) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(val))
  },
  { deep: true }
)

export function useSettings() {
  function updateSettings(partial: Partial<AppSettings>) {
    Object.assign(settings, partial)
  }

  function resetSettings() {
    Object.assign(settings, defaults)
  }

  return { settings, updateSettings, resetSettings }
}
