<template>
  <el-container class="main-container">
    <el-aside width="224px" class="sidebar">
      <div class="logo">
        <div class="logo-mark">
          <el-icon><FolderOpened /></el-icon>
        </div>
        <div>
          <span>OrcaSVN</span>
          <small>SVN Workbench</small>
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
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ $t(item.labelKey) }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <div class="header-left">
          <el-breadcrumb v-if="workspaceStore.currentPath">
            <el-breadcrumb-item>{{ workspaceStore.currentPath }}</el-breadcrumb-item>
          </el-breadcrumb>
          <div v-else class="header-title">{{ $t('menu.workspace') }}</div>
        </div>
        <div class="header-right">
          <el-button circle @click="refreshStatus" :loading="workspaceStore.isLoading" :title="$t('menu.refresh')">
            <el-icon><Refresh /></el-icon>
          </el-button>
          <el-button circle @click="openSettings" :title="$t('menu.settings')">
            <el-icon><Setting /></el-icon>
          </el-button>
          <LanguageSwitcher />
        </div>
      </el-header>
      <el-main class="main-content">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useWorkspaceStore } from '@/stores/workspace'
import LanguageSwitcher from '@/components/LanguageSwitcher.vue'
import { useWorkspace } from '@/composables/useWorkspace'
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
const workspaceStore = useWorkspaceStore()
const { refreshStatus } = useWorkspace()

const activeMenu = computed(() => route.name as string)

const handleMenuSelect = (index: string) => {
  router.push({ name: index })
}

const openSettings = () => {
  router.push({ name: 'settings' })
}
</script>

<style scoped>
.main-container {
  height: 100vh;
  background: transparent;
}

.sidebar {
  width: 224px;
  border-right: 1px solid rgba(198, 198, 210, 0.72);
  background: rgba(32, 33, 42, 0.86);
  color: #fff;
  backdrop-filter: blur(22px);
}

.logo {
  display: flex;
  align-items: center;
  min-height: 76px;
  padding: 18px 18px 14px;
  font-size: 18px;
  font-weight: 800;
  gap: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.logo small {
  display: block;
  margin-top: 2px;
  color: rgba(255, 255, 255, 0.58);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0;
}

.logo-mark {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: linear-gradient(135deg, #e4e2ff, #d7f5ee);
  color: #3730a3;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18);
}

.sidebar-menu {
  border-right: none;
  background: transparent;
  padding: 12px;
}

:deep(.el-menu-item) {
  height: 44px;
  margin-bottom: 6px;
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.72);
  font-weight: 700;
}

:deep(.el-menu-item:hover),
:deep(.el-menu-item.is-active) {
  background: rgba(228, 226, 255, 0.18);
  color: #fff;
}

:deep(.el-menu-item.is-active) {
  box-shadow: inset 0 0 0 1px rgba(228, 226, 255, 0.2);
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 64px;
  background: rgba(255, 253, 248, 0.74);
  border-bottom: 1px solid rgba(198, 198, 210, 0.72);
  padding: 0 22px;
  backdrop-filter: blur(18px);
}

.header-left {
  flex: 1;
  min-width: 0;
}

.header-title {
  color: #2e3040;
  font-size: 16px;
  font-weight: 800;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.main-content {
  background: transparent;
  padding: 22px;
  overflow: auto;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
