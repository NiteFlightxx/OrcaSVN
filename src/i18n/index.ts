import { conflictActionLocales } from './conflictActions'
import { updateProgressLocales } from './updateProgress'
import { historyMenuLocales } from './historyMenu'
import { commitFlowLocales } from './commitFlow'
import { experienceLocales } from './experience'
import { branchUiLocales } from './branchUi'
import { conflictDialogLocales } from './conflictDialog'
import { conflictReviewLocales } from './conflictReview'
import { sourceUiLocales } from './sourceUi'
import { workflowLocales } from './workflows'
import { changeLocales } from './changes'
import { commitDetailLocales } from './commitDetails'
import { fileMenuLocales } from './fileMenu'
import { historyPresenceLocales } from './historyPresence'
import { svnToolsLocales } from './svnTools'
import { watch } from 'vue'
import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import zhTW from './locales/zh-TW'
import jaJP from './locales/ja-JP'
import koKR from './locales/ko-KR'
import enUS from './locales/en-US'

export const supportedLocales = ['zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'en-US'] as const
export type SupportedLocale = (typeof supportedLocales)[number]

export function detectSystemLocale(): SupportedLocale {
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]

  for (const language of languages) {
    const normalized = language.toLowerCase()
    if (
      normalized === 'zh-tw' ||
      normalized === 'zh-hk' ||
      normalized === 'zh-mo' ||
      normalized === 'zh-hant'
    ) {
      return 'zh-TW'
    }
    if (
      normalized === 'zh-cn' ||
      normalized === 'zh-sg' ||
      normalized === 'zh-hans' ||
      normalized === 'zh'
    ) {
      return 'zh-CN'
    }
    if (normalized.startsWith('ja')) return 'ja-JP'
    if (normalized.startsWith('ko')) return 'ko-KR'
    if (normalized.startsWith('en')) return 'en-US'
  }

  return 'en-US'
}

function getStoredLocale(): string {
  try {
    const stored = localStorage.getItem('orcasvn-settings')
    if (stored) {
      const settings = JSON.parse(stored)
      if (supportedLocales.includes(settings.language)) return settings.language
    }
  } catch {
    // ignore
  }
  return detectSystemLocale()
}

const i18n = createI18n({
  legacy: false,
  locale: getStoredLocale(),
  fallbackLocale: 'en-US',
  messages: {
    'zh-CN': {
      experience: experienceLocales['zh-CN'],
      branchUI: branchUiLocales['zh-CN'],
      conflictDialog: conflictDialogLocales['zh-CN'],
      conflictActions: conflictActionLocales['zh-CN'],
      conflictReview: conflictReviewLocales['zh-CN'],
      sourceUI: sourceUiLocales['zh-CN'],
      ...zhCN,
      flow: workflowLocales['zh-CN'],
      changes: changeLocales['zh-CN'],
      commitDetails: commitDetailLocales['zh-CN'],
      fileMenu: fileMenuLocales['zh-CN'],
      historyPresence: historyPresenceLocales['zh-CN'],
      commitFlow: commitFlowLocales['zh-CN'],
      historyMenu: historyMenuLocales['zh-CN'],
      updateProgress: updateProgressLocales['zh-CN'],
      svnTools: svnToolsLocales['zh-CN'],
    },
    'zh-TW': {
      experience: experienceLocales['zh-TW'],
      branchUI: branchUiLocales['zh-TW'],
      conflictDialog: conflictDialogLocales['zh-TW'],
      conflictActions: conflictActionLocales['zh-TW'],
      conflictReview: conflictReviewLocales['zh-TW'],
      sourceUI: sourceUiLocales['zh-TW'],
      ...zhTW,
      flow: workflowLocales['zh-TW'],
      changes: changeLocales['zh-TW'],
      commitDetails: commitDetailLocales['zh-TW'],
      fileMenu: fileMenuLocales['zh-TW'],
      historyPresence: historyPresenceLocales['zh-TW'],
      commitFlow: commitFlowLocales['zh-TW'],
      historyMenu: historyMenuLocales['zh-TW'],
      updateProgress: updateProgressLocales['zh-TW'],
      svnTools: svnToolsLocales['zh-TW'],
    },
    'ja-JP': {
      experience: experienceLocales['ja-JP'],
      branchUI: branchUiLocales['ja-JP'],
      conflictDialog: conflictDialogLocales['ja-JP'],
      conflictActions: conflictActionLocales['ja-JP'],
      conflictReview: conflictReviewLocales['ja-JP'],
      sourceUI: sourceUiLocales['ja-JP'],
      ...jaJP,
      flow: workflowLocales['ja-JP'],
      changes: changeLocales['ja-JP'],
      commitDetails: commitDetailLocales['ja-JP'],
      fileMenu: fileMenuLocales['ja-JP'],
      historyPresence: historyPresenceLocales['ja-JP'],
      commitFlow: commitFlowLocales['ja-JP'],
      historyMenu: historyMenuLocales['ja-JP'],
      updateProgress: updateProgressLocales['ja-JP'],
      svnTools: svnToolsLocales['ja-JP'],
    },
    'ko-KR': {
      experience: experienceLocales['ko-KR'],
      branchUI: branchUiLocales['ko-KR'],
      conflictDialog: conflictDialogLocales['ko-KR'],
      conflictActions: conflictActionLocales['ko-KR'],
      conflictReview: conflictReviewLocales['ko-KR'],
      sourceUI: sourceUiLocales['ko-KR'],
      ...koKR,
      flow: workflowLocales['ko-KR'],
      changes: changeLocales['ko-KR'],
      commitDetails: commitDetailLocales['ko-KR'],
      fileMenu: fileMenuLocales['ko-KR'],
      historyPresence: historyPresenceLocales['ko-KR'],
      commitFlow: commitFlowLocales['ko-KR'],
      historyMenu: historyMenuLocales['ko-KR'],
      updateProgress: updateProgressLocales['ko-KR'],
      svnTools: svnToolsLocales['ko-KR'],
    },
    'en-US': {
      experience: experienceLocales['en-US'],
      branchUI: branchUiLocales['en-US'],
      conflictDialog: conflictDialogLocales['en-US'],
      conflictActions: conflictActionLocales['en-US'],
      conflictReview: conflictReviewLocales['en-US'],
      sourceUI: sourceUiLocales['en-US'],
      ...enUS,
      flow: workflowLocales['en-US'],
      changes: changeLocales['en-US'],
      commitDetails: commitDetailLocales['en-US'],
      fileMenu: fileMenuLocales['en-US'],
      historyPresence: historyPresenceLocales['en-US'],
      commitFlow: commitFlowLocales['en-US'],
      historyMenu: historyMenuLocales['en-US'],
      updateProgress: updateProgressLocales['en-US'],
      svnTools: svnToolsLocales['en-US'],
    },
  },
})

function syncDocumentLang(locale: string) {
  document.documentElement.lang = locale
}

syncDocumentLang(i18n.global.locale.value)
watch(i18n.global.locale, syncDocumentLang)

export default i18n
