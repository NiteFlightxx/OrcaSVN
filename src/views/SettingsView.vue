<template>
  <div class="settings-view">
    <nav class="preferences-tabs" role="tablist" :aria-label="$t('menu.settings')">
      <button
        v-for="(tab, index) in preferenceTabs"
        :key="tab.name"
        :id="`${preferenceId}-preference-${tab.name}`"
        role="tab"
        :aria-selected="activeTab === tab.name"
        :aria-controls="`${preferenceId}-preference-panel-${tab.name}`"
        :tabindex="activeTab === tab.name ? 0 : -1"
        :class="{ active: activeTab === tab.name }"
        @click="activeTab = tab.name"
        @keydown="handleTabKeydown($event, index)"
      >
        {{ $t(tab.label) }}
      </button>
    </nav>
    <div class="preferences-content">
      <section
        v-for="tab in preferenceTabs"
        v-show="activeTab === tab.name"
        :key="tab.name"
        :id="`${preferenceId}-preference-panel-${tab.name}`"
        role="tabpanel"
        :aria-labelledby="`${preferenceId}-preference-${tab.name}`"
        tabindex="0"
      >
        <el-form
          v-if="tab.name === 'general'"
          :model="settings"
          label-width="172px"
          class="settings-form"
          label-position="right"
        >
          <el-form-item :label="$t('language.label')" class="form-item">
            <el-select
              v-model="currentLanguage"
              class="settings-control language-select"
              popper-class="settings-select-dropdown"
            >
              <el-option
                v-for="lang in languages"
                :key="lang.value"
                :label="lang.label"
                :value="lang.value"
              />
            </el-select>
          </el-form-item>
        </el-form>
        <el-form
          v-else-if="tab.name === 'appearance'"
          :model="settings"
          label-width="172px"
          class="settings-form"
          label-position="right"
        >
          <el-form-item :label="$t('settings.theme')" class="form-item">
            <el-radio-group v-model="settings.theme" @change="applyTheme" class="theme-group">
              <el-radio value="light" class="theme-radio">
                <div class="theme-option">
                  <el-icon><Sunny /></el-icon>
                  <span>{{ $t('settings.themeLight') }}</span>
                </div>
              </el-radio>
              <el-radio value="dark" class="theme-radio">
                <div class="theme-option">
                  <el-icon><Moon /></el-icon>
                  <span>{{ $t('settings.themeDark') }}</span>
                </div>
              </el-radio>
              <el-radio value="auto" class="theme-radio">
                <div class="theme-option">
                  <el-icon><Monitor /></el-icon>
                  <span>{{ $t('settings.themeAuto') }}</span>
                </div>
              </el-radio>
            </el-radio-group>
          </el-form-item>
        </el-form>
        <el-form
          v-else-if="tab.name === 'svn'"
          :model="settings"
          label-width="172px"
          class="settings-form"
          label-position="right"
        >
          <el-form-item :label="$t('settings.svnPath')" class="form-item">
            <el-input
              v-model="settings.svnPath"
              :placeholder="$t('settings.svnPathPlaceholder')"
              class="settings-control settings-path-input"
              clearable
              @change="handleSvnPathChange"
            >
              <template #prefix>
                <el-icon><Folder /></el-icon>
              </template>
            </el-input>
          </el-form-item>

          <el-form-item :label="$t('settings.encoding')" class="form-item">
            <el-select
              v-model="settings.encoding"
              class="settings-control"
              popper-class="settings-select-dropdown"
            >
              <el-option label="UTF-8" value="utf-8" />
              <el-option label="GBK" value="gbk" />
              <el-option label="GB2312" value="gb2312" />
            </el-select>
          </el-form-item>

          <el-form-item :label="$t('settings.gitignore')" class="form-item">
            <el-switch v-model="settings.gitignoreEnabled" @change="handleGitignoreChange" />
            <span class="form-item-hint">{{ $t('settings.gitignoreHint') }}</span>
          </el-form-item>

          <el-form-item :label="$t('settings.autoDeleteMissingOnCommit')" class="form-item">
            <el-switch v-model="settings.autoDeleteMissingOnCommit" />
            <span class="form-item-hint">{{ $t('settings.autoDeleteMissingOnCommitHint') }}</span>
          </el-form-item>
        </el-form>
        <ToolSettings v-else-if="tab.name === 'tools'" />
        <div v-else class="about-section">
          <div class="about-content">
            <div class="about-logo">
              <div class="logo-mark">
                <el-icon><FolderOpened /></el-icon>
              </div>
              <div class="about-info">
                <h4>OrcaSVN</h4>
                <p class="about-subtitle">{{ $t('settings.aboutSubtitle') }}</p>
              </div>
            </div>
            <div class="about-details">
              <div class="detail-item">
                <span class="detail-label">{{ $t('common.version') }}：</span>
                <el-tag size="small" type="primary">{{ appVersion }}</el-tag>
                <el-button
                  v-if="updateState === 'available'"
                  size="small"
                  type="primary"
                  link
                  @click="openReleasePage"
                >
                  {{ $t('appUpdate.available', { version: latestVersion }) }}
                </el-button>
                <span v-else-if="updateState !== 'idle'" class="update-status">
                  {{ $t(`appUpdate.${updateState}`) }}
                </span>
                <el-button
                  v-if="updateState !== 'checking'"
                  size="small"
                  link
                  @click="checkForUpdates"
                >
                  {{ $t('appUpdate.check') }}
                </el-button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
    <p class="preferences-hint">{{ $t('settings.appliedImmediately') }}</p>
  </div>
</template>

<script setup lang="ts">
import ToolSettings from '@/components/ToolSettings.vue'
import { computed, onMounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { configureSvnExecutable } from '@/api/svn'
import { useLocale } from '@/composables/useLocale'
import { useSettings } from '@/composables/useSettings'
import { applyTheme } from '@/composables/useTheme'
import { useWorkspace } from '@/composables/useWorkspace'
import { useUpdateCheck } from '@/composables/useUpdateCheck'

const { t } = useI18n()
const preferenceId = useId()
const activeTab = ref('general')
const preferenceTabs = [
  { name: 'general', label: 'settings.general' },
  { name: 'appearance', label: 'settings.appearance' },
  { name: 'svn', label: 'settings.svnSettings' },
  { name: 'tools', label: 'experience.tools' },
  { name: 'about', label: 'nav.about' },
]
function handleTabKeydown(event: KeyboardEvent, index: number) {
  let next = index
  if (event.key === 'ArrowRight') next = (index + 1) % preferenceTabs.length
  else if (event.key === 'ArrowLeft')
    next = (index + preferenceTabs.length - 1) % preferenceTabs.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = preferenceTabs.length - 1
  else return
  event.preventDefault()
  activeTab.value = preferenceTabs[next].name
  const tablist = (event.currentTarget as HTMLElement).parentElement
  ;(tablist?.children[next] as HTMLElement)?.focus()
}
const { setLocale } = useLocale()
const { settings } = useSettings()
const { refreshStatusAfterMutation } = useWorkspace()
const {
  currentVersion: appVersion,
  state: updateState,
  latestVersion,
  checkForUpdates,
  openReleasePage,
} = useUpdateCheck()

const languages = computed(() => [
  { label: t('language.zhCN'), value: 'zh-CN' },
  { label: t('language.zhTW'), value: 'zh-TW' },
  { label: t('language.jaJP'), value: 'ja-JP' },
  { label: t('language.koKR'), value: 'ko-KR' },
  { label: t('language.enUS'), value: 'en-US' },
])

const currentLanguage = computed({
  get: () => settings.language,
  set: (val: string) => setLocale(val),
})

const handleGitignoreChange = () => {
  void refreshStatusAfterMutation()
}

const handleSvnPathChange = async (value: string) => {
  try {
    const version = await configureSvnExecutable(value)
    ElMessage.success(t('settings.svnPathApplied', { version }))
  } catch (err) {
    ElMessage.error(t('settings.svnPathInvalid', { error: String(err) }))
  }
}

onMounted(() => {
  setLocale(settings.language)
  applyTheme(settings.theme)
})
</script>

<style scoped>
.settings-view {
  display: flex;
  flex-direction: column;
  min-width: 0;
  color: var(--md-sys-color-on-surface);
}
.preferences-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  overflow-x: auto;
  flex-shrink: 0;
}
.preferences-tabs button {
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--md-sys-color-on-surface-variant);
  padding: 9px 14px;
  white-space: nowrap;
  font: inherit;
  cursor: pointer;
}
.preferences-tabs button:hover {
  background: var(--md-sys-state-hover);
}
.preferences-tabs button.active {
  color: var(--md-sys-color-primary);
  border-bottom-color: var(--md-sys-color-primary);
}
.preferences-tabs button:focus-visible {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: -2px;
}
.preferences-content {
  padding: 22px 8px 8px;
  min-height: 280px;
}
.preferences-content > section:focus-visible {
  outline: 1px solid var(--md-sys-color-outline);
  outline-offset: 4px;
}
.settings-form :deep(.el-form-item) {
  margin-bottom: 16px;
}
.settings-form :deep(.el-form-item__label) {
  line-height: 1.35;
  align-items: center;
  padding-right: 16px;
  min-height: 30px;
}
.settings-form :deep(.el-form-item__content) {
  min-width: 0;
  line-height: 1.5;
}
.settings-control {
  width: 100%;
  max-width: 360px;
}
.form-item-hint {
  display: block;
  flex-basis: 100%;
  margin-top: 4px;
  color: var(--md-sys-color-on-surface-variant);
  font-size: var(--app-font-size-xs);
  line-height: 1.6;
}
.theme-group {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.theme-radio {
  margin-right: 0;
}
.theme-option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.preferences-hint {
  margin: 8px 8px 0;
  padding-top: 12px;
  border-top: 1px solid var(--md-sys-color-outline-variant);
  color: var(--md-sys-color-on-surface-variant);
  font-size: var(--app-font-size-xs);
}
.about-content {
  display: grid;
  gap: 22px;
  padding: 8px 16px;
}
.about-logo {
  display: flex;
  align-items: center;
  gap: 16px;
}
.logo-mark {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  font-size: 28px;
  color: var(--md-sys-color-primary);
}
.about-info h4 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.about-subtitle {
  margin: 4px 0 0;
  color: var(--md-sys-color-on-surface-variant);
}
.detail-item {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.update-status {
  color: var(--md-sys-color-on-surface-variant);
}
@media (max-width: 600px) {
  .preferences-content {
    padding: 16px 0 4px;
  }
  .preferences-tabs button {
    padding: 9px 10px;
  }
  .settings-form :deep(.el-form-item) {
    display: block;
  }
  .settings-form :deep(.el-form-item__label) {
    display: block;
    width: auto !important;
    text-align: left;
    padding-bottom: 6px;
  }
}
</style>
