import { useI18n } from 'vue-i18n'
import zhCn from 'element-plus/dist/locale/zh-cn.mjs'
import zhTw from 'element-plus/dist/locale/zh-tw.mjs'
import ja from 'element-plus/dist/locale/ja.mjs'
import ko from 'element-plus/dist/locale/ko.mjs'
import en from 'element-plus/dist/locale/en.mjs'
import { computed } from 'vue'

const localeMap: Record<string, any> = {
  'zh-CN': zhCn,
  'zh-TW': zhTw,
  'ja-JP': ja,
  'ko-KR': ko,
  'en-US': en,
}

const STORAGE_KEY = 'orcasvn-settings'

export function useLocale() {
  const { locale } = useI18n()

  const elementLocale = computed(() => {
    return localeMap[locale.value] || zhCn
  })

  const setLocale = (newLocale: string) => {
    locale.value = newLocale
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      const settings = stored ? JSON.parse(stored) : {}
      settings.language = newLocale
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // ignore
    }
  }

  return {
    locale,
    elementLocale,
    setLocale,
  }
}
