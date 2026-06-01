import { useI18n } from 'vue-i18n'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import zhTw from 'element-plus/es/locale/lang/zh-tw'
import ja from 'element-plus/es/locale/lang/ja'
import ko from 'element-plus/es/locale/lang/ko'
import en from 'element-plus/es/locale/lang/en'
import { computed } from 'vue'
import { useSettings } from '@/composables/useSettings'

type ElementLocale = typeof zhCn

const localeMap: Record<string, ElementLocale> = {
  'zh-CN': zhCn,
  'zh-TW': zhTw,
  'ja-JP': ja,
  'ko-KR': ko,
  'en-US': en,
}

export function useLocale() {
  const { locale } = useI18n()
  const { settings, updateSettings } = useSettings()

  const elementLocale = computed(() => {
    return localeMap[locale.value] || zhCn
  })

  const setLocale = (newLocale: string) => {
    locale.value = newLocale

    if (settings.language !== newLocale) {
      updateSettings({ language: newLocale })
    }
  }

  return {
    locale,
    elementLocale,
    setLocale,
  }
}
