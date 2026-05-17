import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import zhTW from './locales/zh-TW'
import jaJP from './locales/ja-JP'
import koKR from './locales/ko-KR'
import enUS from './locales/en-US'

function getStoredLocale(): string {
  try {
    const stored = localStorage.getItem('orcasvn-settings')
    if (stored) {
      const settings = JSON.parse(stored)
      if (settings.language) return settings.language
    }
  } catch {
    // ignore
  }
  return 'zh-CN'
}

const i18n = createI18n({
  legacy: false,
  locale: getStoredLocale(),
  fallbackLocale: 'en-US',
  messages: {
    'zh-CN': zhCN,
    'zh-TW': zhTW,
    'ja-JP': jaJP,
    'ko-KR': koKR,
    'en-US': enUS,
  },
})

export default i18n
