<template>
  <el-dropdown popper-class="language-dropdown" @command="handleLanguageChange">
    <el-button text class="language-switcher-button">
      <svg class="language-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9" />
        <path d="M12 3c-2.4 2.5-3.6 5.5-3.6 9s1.2 6.5 3.6 9" />
      </svg>
      {{ currentLanguageLabel }}
      <el-icon class="el-icon--right"><ArrowDown /></el-icon>
    </el-button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item
          v-for="lang in languages"
          :key="lang.value"
          :command="lang.value"
        >
          {{ lang.label }}
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocale } from '@/composables/useLocale'

const { locale, t } = useI18n()
const { setLocale } = useLocale()

const languages = computed(() => [
  { label: t('language.zhCN'), value: 'zh-CN' },
  { label: t('language.zhTW'), value: 'zh-TW' },
  { label: t('language.jaJP'), value: 'ja-JP' },
  { label: t('language.koKR'), value: 'ko-KR' },
  { label: t('language.enUS'), value: 'en-US' },
])

const currentLanguageLabel = computed(() => {
  const lang = languages.value.find((l) => l.value === locale.value)
  return lang?.label || t('language.zhCN')
})

const handleLanguageChange = (command: string) => {
  setLocale(command)
}
</script>

<style scoped>
.language-switcher-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 48px;
  gap: 5px;
  padding: 0 10px;
  border: 0;
  border-radius: 5px;
  color: #526173;
  background: transparent;
  font-size: 10px;
  transition:
    color var(--app-transition-fast),
    background-color var(--app-transition-fast);
}

.language-switcher-button:hover,
.language-switcher-button:focus {
  color: #123a55;
  background: #edf3f9;
}

.language-icon {
  width: 17px;
  height: 17px;
  color: currentColor;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.language-switcher-button :deep(.el-icon--right) {
  margin-left: 0;
}

:global(.theme-dark) .language-switcher-button,
:global(.dark) .language-switcher-button {
  color: #b9c6d0;
  background: #17212b;
}

:global(.theme-dark) .language-switcher-button:hover,
:global(.theme-dark) .language-switcher-button:focus,
:global(.dark) .language-switcher-button:hover,
:global(.dark) .language-switcher-button:focus {
  color: #e2eaf0;
  background: #202d39;
}
</style>
