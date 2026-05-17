<template>
  <div class="settings-view">
    <el-card class="settings-card">
      <template #header>
        <span>{{ $t('nav.settings') }}</span>
      </template>

      <el-form :model="settings" label-width="150px" class="settings-form">
        <el-form-item :label="$t('language.label')">
          <el-select v-model="currentLanguage" style="width: 200px">
            <el-option
              v-for="lang in languages"
              :key="lang.value"
              :label="lang.label"
              :value="lang.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item :label="$t('settings.svnPathPlaceholder')">
          <el-input
            v-model="settings.svnPath"
            :placeholder="$t('settings.svnPathPlaceholder')"
            clearable
          />
        </el-form-item>

        <el-form-item :label="$t('settings.encoding')">
          <el-select v-model="settings.encoding" style="width: 200px">
            <el-option label="UTF-8" value="utf-8" />
            <el-option label="GBK" value="gbk" />
            <el-option label="GB2312" value="gb2312" />
          </el-select>
        </el-form-item>

        <el-form-item :label="$t('settings.logLimit')">
          <el-input-number
            v-model="settings.logLimit"
            :min="1"
            :max="1000"
            :step="10"
          />
        </el-form-item>

        <el-form-item :label="$t('settings.autoRefresh')">
          <el-switch v-model="settings.autoRefresh" />
        </el-form-item>

        <el-form-item :label="$t('settings.theme')">
          <el-radio-group v-model="settings.theme" @change="applyTheme">
            <el-radio label="light">{{ $t('settings.themeLight') }}</el-radio>
            <el-radio label="dark">{{ $t('settings.themeDark') }}</el-radio>
            <el-radio label="auto">{{ $t('settings.themeAuto') }}</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" @click="handleSave">{{ $t('common.save') }}</el-button>
          <el-button @click="handleReset">{{ $t('common.cancel') }}</el-button>
        </el-form-item>
      </el-form>

      <el-divider />

      <div class="about-section">
        <h3>{{ $t('nav.about') }}</h3>
        <p>OrcaSVN - 基于 Tauri 的 SVN 图形客户端</p>
        <p>{{ $t('common.version') }}：0.1.0</p>
        <p>{{ $t('common.techStack') }}：Tauri + Rust + Vue 3 + TypeScript</p>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocale } from '@/composables/useLocale'
import { useSettings } from '@/composables/useSettings'

const { t } = useI18n()
const { setLocale } = useLocale()
const { settings, resetSettings } = useSettings()

const languages = computed(() => [
  { label: t('language.zhCN'), value: 'zh-CN' },
  { label: t('language.zhTW'), value: 'zh-TW' },
  { label: t('language.jaJP'), value: 'ja-JP' },
  { label: t('language.koKR'), value: 'ko-KR' },
  { label: t('language.enUS'), value: 'en-US' },
])

const currentLanguage = computed({
  get: () => settings.language,
  set: (val: string) => {
    settings.language = val
    setLocale(val)
  },
})

function applyTheme(theme: string) {
  const root = document.documentElement
  root.classList.remove('theme-light', 'theme-dark')

  if (theme === 'dark') {
    root.classList.add('theme-dark')
  } else if (theme === 'light') {
    root.classList.add('theme-light')
  } else {
    // auto: follow system
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      root.classList.add('theme-dark')
    }
  }
}

function handleSave() {
  setLocale(settings.language)
  applyTheme(settings.theme)
}

function handleReset() {
  resetSettings()
  setLocale(settings.language)
  applyTheme(settings.theme)
}

onMounted(() => {
  setLocale(settings.language)
  applyTheme(settings.theme)
})
</script>

<style scoped>
.settings-view {
  max-width: 700px;
  margin: 0 auto;
}

.settings-form {
  margin-top: 20px;
}

.about-section {
  padding: 20px 0;
}

.about-section h3 {
  margin-bottom: 15px;
}

.about-section p {
  margin: 8px 0;
  color: #666;
}
</style>
