import { reactive, watch } from 'vue'
import { detectSystemLocale } from '@/i18n'
import type { BinaryConflictSide } from '@/api/workflows'

export type BinaryConflictPolicy = 'off' | BinaryConflictSide
export type Accent = 'indigo' | 'teal' | 'amber'

export interface AppSettings {
  svnPath: string
  encoding: string
  logLimit: number
  theme: 'light' | 'dark' | 'auto'
  accent: Accent
  language: string
  gitignoreEnabled: boolean
  binaryConflictPolicy: BinaryConflictPolicy
  hideUnstagedBinaries: boolean
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
  accent: 'indigo',
  language: detectSystemLocale(),
  gitignoreEnabled: false,
  binaryConflictPolicy: 'local',
  hideUnstagedBinaries: false,
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
      const { binaryConflictPolicy: policy, autoResolveBinaries, ...saved } = JSON.parse(stored)
      const fallbackPolicy = autoResolveBinaries === false ? 'off' : defaults.binaryConflictPolicy
      return {
        ...defaults,
        ...saved,
        binaryConflictPolicy:
          policy === 'off' || policy === 'local' || policy === 'incoming' ? policy : fallbackPolicy,
      }
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
