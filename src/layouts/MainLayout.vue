<template>
  <el-container class="main-container">
    <el-aside width="224px" class="sidebar" :class="{ 'is-collapsed': isCollapsed }">
      <div class="logo">
        <div class="logo-mark">
          <el-icon><FolderOpened /></el-icon>
        </div>
        <div class="logo-text">
          <span class="logo-title">OrcaSVN</span>
          <small class="logo-subtitle">SVN Workbench</small>
        </div>
      </div>
      <el-menu
        :default-active="activeMenu"
        class="sidebar-menu"
        @select="handleMenuSelect"
      >
        <el-menu-item
          v-for="item in menuItems"
          :key="item.index"
          :index="item.index"
          class="menu-item"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ $t(item.labelKey) }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <div class="header-left">
          <div v-if="workspaceStore.currentPath" class="workspace-nav">
            <div class="workspace-path">
              <el-icon><FolderOpened /></el-icon>
              <span>{{ workspaceStore.currentPath }}</span>
            </div>
            <div class="workspace-actions">
              <el-button
                class="switch-workspace-btn"
                circle
                size="small"
                :title="$t('workspace.switchWorkspace')"
                @click="switchWorkspace"
              >
                <el-icon><FolderOpened /></el-icon>
              </el-button>
              <el-button
                circle
                size="small"
                :title="$t('workspace.closeWorkspace')"
                @click="closeWorkspace"
              >
                <el-icon><Close /></el-icon>
              </el-button>
            </div>
          </div>
          <div v-else class="header-title">{{ $t('menu.workspace') }}</div>
        </div>
        <div class="header-right">
          <el-button 
            circle 
            @click="refreshStatus" 
            :loading="workspaceStore.isLoading" 
            :title="$t('menu.refresh')"
            class="header-btn"
          >
            <el-icon><Refresh /></el-icon>
          </el-button>
          <el-button 
            circle 
            @click="openSettings" 
            :title="$t('menu.settings')"
            class="header-btn"
          >
            <el-icon><Setting /></el-icon>
          </el-button>
          <LanguageSwitcher />
        </div>
      </el-header>
      <el-main class="main-content">
        <router-view v-slot="{ Component, route }">
          <transition name="fade-slide" mode="out-in">
            <keep-alive :include="cachedViews">
              <component :is="Component" :key="route.path" />
            </keep-alive>
          </transition>
        </router-view>
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useWorkspaceStore } from '@/stores/workspace'
import LanguageSwitcher from '@/components/LanguageSwitcher.vue'
import { useWorkspace } from '@/composables/useWorkspace'
import { useI18n } from 'vue-i18n'
import {
  Connection,
  Document,
  Download,
  Edit,
  HomeFilled,
  Upload,
} from '@element-plus/icons-vue'

const menuItems = [
  { index: 'workspace', labelKey: 'menu.workspace', icon: HomeFilled },
  { index: 'checkout', labelKey: 'menu.checkout', icon: Download },
  { index: 'commit', labelKey: 'menu.commit', icon: Upload },
  { index: 'log', labelKey: 'menu.log', icon: Document },
  { index: 'diff', labelKey: 'menu.diff', icon: Connection },
  { index: 'blame', labelKey: 'menu.blame', icon: Edit },
] as const

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const workspaceStore = useWorkspaceStore()
const { openWorkspace, refreshStatus } = useWorkspace()

const isCollapsed = ref(false)
const cachedViews = ref(['WorkspaceView', 'LogView'])

const activeMenu = computed(() => route.name as string)

const handleMenuSelect = (index: string) => {
  router.push({ name: index })
}

const openSettings = () => {
  router.push({ name: 'settings' })
}

const switchWorkspace = async () => {
  await openWorkspace(t('dialog.selectSVNWorkspaceDirectory'))
}

const closeWorkspace = () => {
  workspaceStore.clearWorkspace()
}
</script>

<style scoped>
.main-container {
  height: 100vh;
  background: transparent;
}

.sidebar {
  width: 224px;
  border-right: 1px solid var(--md-sys-color-outline-variant);
  background: rgba(32, 33, 42, 0.88);
  color: #fff;
  backdrop-filter: blur(24px);
  transition: width var(--app-transition-normal);
  overflow: hidden;
}

.logo {
  display: flex;
  align-items: center;
  min-height: 76px;
  padding: 18px 18px 14px;
  gap: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.logo-text {
  overflow: hidden;
}

.logo-title {
  display: block;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.logo-subtitle {
  display: block;
  margin-top: 2px;
  color: rgba(255, 255, 255, 0.55);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.logo-mark {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: var(--app-radius);
  background: linear-gradient(135deg, #e4e2ff, #d7f5ee);
  color: #3730a3;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.2);
  flex-shrink: 0;
  transition: transform var(--app-transition-fast);
}

.logo-mark:hover {
  transform: scale(1.05);
}

.sidebar-menu {
  border-right: none;
  background: transparent;
  padding: var(--app-spacing);
}

.menu-item {
  height: 44px;
  margin-bottom: 4px;
  border-radius: var(--app-radius-full);
  color: rgba(255, 255, 255, 0.72);
  font-weight: 600;
  font-size: 13px;
  transition: all var(--app-transition-fast);
}

:deep(.el-menu-item:hover),
:deep(.el-menu-item.is-active) {
  background: rgba(228, 226, 255, 0.18);
  color: #fff;
}

:deep(.el-menu-item.is-active) {
  background: rgba(228, 226, 255, 0.22);
  box-shadow: inset 0 0 0 1px rgba(228, 226, 255, 0.25);
}

:deep(.el-menu-item:active) {
  transform: scale(0.98);
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 64px;
  background: rgba(255, 253, 248, 0.78);
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  padding: 0 var(--app-spacing-lg);
  backdrop-filter: blur(20px);
}

.header-left {
  flex: 1;
  min-width: 0;
}

.workspace-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--app-spacing);
}

.workspace-path {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.workspace-path .el-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.workspace-path span {
  overflow: hidden;
  color: var(--el-text-color-primary);
  font-family: "Cascadia Mono", Consolas, Monaco, monospace;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-actions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
  margin-right: var(--app-spacing-md);
}

.switch-workspace-btn {
  border-color: #4f46e5;
  background: #4f46e5;
  color: #fff;
}

.workspace-actions .el-button {
  width: 36px;
  height: 36px;
  min-width: 36px;
  padding: 0;
  border-radius: 10px;
  margin-left: 0;
}

.switch-workspace-btn:hover,
.switch-workspace-btn:focus {
  border-color: #4338ca;
  background: #4338ca;
  color: #fff;
}

.switch-workspace-btn:active {
  border-color: #3730a3;
  background: #3730a3;
  color: #fff;
}

.header-title {
  color: #2e3040;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.header-right {
  display: flex;
  align-items: center;
  gap: var(--app-spacing-sm);
}

.header-btn {
  transition: transform var(--app-transition-fast), background-color var(--app-transition-fast);
}

.header-btn:active {
  transform: scale(0.95);
}

.main-content {
  background: transparent;
  padding: var(--app-spacing-lg);
  overflow: auto;
}

/* 页面过渡动画 */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: 
    opacity var(--app-transition-normal),
    transform var(--app-transition-normal);
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(12px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}

/* 响应式布局 */
@media (max-width: 860px) {
  .sidebar {
    width: 64px;
  }
  
  .logo-text {
    display: none;
  }
  
  .logo {
    justify-content: center;
    padding: 18px 12px;
  }
  
  .sidebar-menu {
    padding: var(--app-spacing-sm);
  }
  
  :deep(.el-menu-item span) {
    display: none;
  }
  
  :deep(.el-menu-item) {
    justify-content: center;
    padding: 0;
    height: 44px;
    width: 44px;
    margin: 0 auto var(--app-spacing-xs);
  }
  
  .header {
    padding: 0 var(--app-spacing-md);
  }

  .workspace-actions {
    display: none;
  }
  
  .main-content {
    padding: var(--app-spacing-md);
  }
}

@media (max-width: 640px) {
  .sidebar {
    width: 0;
    border-right: none;
  }
  
  .header-left {
    display: none;
  }
  
  .header {
    min-height: 56px;
  }
}
</style>
