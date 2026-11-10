<template>
  <div class="source-shell" @keydown="handleShellKeydown">
    <div class="repository-tabs">
      <button class="app-mark" :title="$t('workspace.openWorkspace')" @click="handleWorkspaceCommand('__open__')">◈ <strong>OrcaSVN</strong></button>
      <div class="repository-tab-list" role="tablist" :aria-label="$t('sourceUI.repositories')">
        <div v-for="path in openTabs" :key="path" class="repository-tab" :class="{ active: path === workspaceStore.currentPath }">
          <button role="tab" :aria-selected="path === workspaceStore.currentPath" :title="path" :disabled="loadingTab" @click="selectRepositoryTab(path)"><el-icon><Folder/></el-icon><span>{{ workspaceNameFromPath(path) }}</span></button>
          <button class="tab-close" :title="$t('common.close')" :aria-label="$t('common.close') + ': ' + workspaceNameFromPath(path)" :disabled="loadingTab" @click="closeRepositoryTab(path)">×</button>
        </div>
      </div>
      <el-dropdown trigger="click" @command="handleWorkspaceCommand"><button class="add-repository" :title="$t('sourceUI.recentRepositories')" :aria-label="$t('sourceUI.recentRepositories')">＋</button><template #dropdown><el-dropdown-menu><el-dropdown-item command="__open__">{{ $t('workspace.openWorkspace') }}…</el-dropdown-item><el-dropdown-item v-for="path in workspaceStore.recentWorkspaces" :key="path" :command="path"><span :title="path">{{ workspaceNameFromPath(path) }}<small class="recent-path">{{ path }}</small></span><button class="recent-remove" :title="$t('workspace.removeWorkspace')" :aria-label="$t('workspace.removeWorkspace')" @click.stop="removeWorkspace(path)">×</button></el-dropdown-item></el-dropdown-menu></template></el-dropdown>
    </div>
    <header class="repository-toolbar">
      <div class="toolbar-group">
        <button class="tool-button icon-only" :title="$t('sourceUI.toggleSidebar')" :aria-label="$t('sourceUI.toggleSidebar')" :aria-pressed="!sidebarCollapsed" @click="sidebarCollapsed = !sidebarCollapsed"><el-icon><FolderOpened/></el-icon></button>
        <el-dropdown trigger="click" :disabled="!workspaceStore.currentPath" @command="openCurrentWorkspaceIn"><button class="tool-button" :disabled="!workspaceStore.currentPath" :title="$t('menu.openIn')"><el-icon><component :is="selectedOpenTargetIcon"/></el-icon><el-icon class="chevron"><ArrowDown/></el-icon></button><template #dropdown><el-dropdown-menu><el-dropdown-item v-for="target in (['explorer', 'vscode', 'terminal'] as const)" :key="target" :command="target"><el-icon><component :is="openTargetIcons[target]"/></el-icon>{{ $t('openIn.' + target) }}</el-dropdown-item></el-dropdown-menu></template></el-dropdown>
        <span class="toolbar-divider"></span>
        <span class="repository-name" :title="workspaceStore.currentPath || ''">{{ repositoryName }}</span>
      </div>
      <div class="toolbar-group toolbar-primary">
        <button class="tool-button" :disabled="!workspaceStore.currentPath || workspaceStore.isLoading" @click="refreshStatus"><el-icon :class="{ 'is-loading': workspaceStore.isLoading }"><Refresh/></el-icon><span>{{ $t('menu.refresh') }}</span></button>
        <button class="tool-button" :disabled="!workspaceStore.currentPath" @click="navigateTo('update')"><el-icon><RefreshRight/></el-icon><span>{{ $t('menu.update') }}</span></button>
        <button class="tool-button" :disabled="!workspaceStore.currentPath" @click="navigateTo('commit')"><el-icon><Upload/></el-icon><span>{{ $t('menu.commit') }}</span></button>
        <button class="tool-button" :disabled="!workspaceStore.currentPath" @click="navigateTo('stash')"><el-icon><Archive/></el-icon><span>{{ $t('menu.stash') }}</span></button>
      </div>
      <div class="toolbar-group toolbar-right"><button class="tool-button current-branch" :disabled="!workspaceStore.currentPath" :title="workflow.identity?.url" @click="sidebarCollapsed = false; branchSidebar?.focus()"><el-icon><GitBranch/></el-icon><span>{{ workflow.branchName || repositoryRevision }}</span><el-icon class="chevron"><ArrowDown/></el-icon></button><LanguageSwitcher/></div>
    </header>
    <main class="source-body" :class="{ 'sidebar-hidden': sidebarCollapsed || !workspaceStore.currentPath }" :style="{ '--sidebar-width': `${sidebarWidth}px` }">
      <nav class="page-switcher" :aria-label="$t('workspace.quickActions')">
        <button :class="{ active: routeName === 'log' }" :title="$t('menu.log') + ' · Ctrl+1'" :aria-label="$t('menu.log')" @click="navigateTo('log')"><el-icon><List/></el-icon></button>
        <button :class="{ active: routeName === 'workspace' || routeName === 'commit' }" :title="$t('menu.workspace') + ' · Ctrl+2'" :aria-label="$t('menu.workspace')" @click="navigateTo('workspace')"><el-icon><Document/></el-icon><b v-if="workspaceStore.statusList.length">{{ workspaceStore.statusList.length > 99 ? '99+' : workspaceStore.statusList.length }}</b></button>
        <button :class="{ active: routeName === 'stash' }" :title="$t('menu.stash') + ' · Ctrl+3'" :aria-label="$t('menu.stash')" @click="navigateTo('stash')"><el-icon><Archive/></el-icon><b v-if="stashCount">{{ stashCount }}</b></button>
        <button v-if="workspaceStore.conflictedCount" :class="{ active: routeName === 'conflicts' }" :title="$t('flow.conflicts')" :aria-label="$t('flow.conflicts')" @click="navigateTo('conflicts')"><el-icon><Warning/></el-icon></button>
        <div class="rail-spacer"></div>
        <button :class="{ active: routeName === 'diff' }" :title="$t('menu.diff')" :aria-label="$t('menu.diff')" @click="navigateTo('diff')"><el-icon><Connection/></el-icon></button>
        <button :class="{ active: routeName === 'blame' }" :title="$t('menu.blame')" :aria-label="$t('menu.blame')" @click="navigateTo('blame')"><el-icon><Edit/></el-icon></button>
        <button :class="{ active: routeName === 'checkout' }" :title="$t('menu.checkout')" :aria-label="$t('menu.checkout')" @click="navigateTo('checkout')"><el-icon><Download/></el-icon></button>
        <button :class="{ active: routeName === 'settings' }" :title="$t('menu.settings')" :aria-label="$t('menu.settings')" @click="navigateTo('settings')"><el-icon><Setting/></el-icon></button>
      </nav>
      <aside v-show="!sidebarCollapsed && workspaceStore.currentPath" class="source-sidebar">
        <div class="sidebar-repository"><strong :title="workspaceStore.currentPath || ''">{{ repositoryName }}</strong><small>{{ repositoryRevision }}</small></div>
        <BranchSidebar ref="branchSidebar"/>
        <details class="sidebar-stashes" open><summary>{{ $t('menu.stash') }} <span>({{ stashCount }})</span></summary><button v-for="entry in workflow.stashes" :key="entry.id" :title="entry.identity.url" @click="router.push({ name: 'stash', query: { id: entry.id } })"><el-icon><Archive/></el-icon>{{ entry.name }}</button><button @click="navigateTo('stash')">{{ $t('sourceUI.manageStashes') }}</button></details>
        <details class="repository-details"><summary>{{ $t('workspace.repository') }}</summary><small>{{ workspaceStore.svnInfo?.url }}</small><small>{{ workspaceStore.currentPath }}</small></details>
      </aside>
      <div v-show="!sidebarCollapsed && workspaceStore.currentPath" class="sidebar-resizer" role="separator" aria-orientation="vertical" :aria-label="$t('flow.branches')" tabindex="0" @pointerdown="startResize" @pointermove="resizeSidebar" @pointerup="finishResize" @lostpointercapture="finishResize" @keydown.left.prevent="setSidebarWidth(sidebarWidth - 16)" @keydown.right.prevent="setSidebarWidth(sidebarWidth + 16)"></div>
      <section class="route-workbench">
        <header v-if="!['workspace', 'log'].includes(routeName)" class="route-header"><strong>{{ currentRouteTitle }}</strong><small>{{ repositoryName }}</small></header>
        <div class="route-content"><router-view v-slot="{ Component }"><keep-alive :include="cachedViews"><component :is="Component"/></keep-alive></router-view></div>
      </section>
    </main>
    <OperationDialog />
    <div class="shell-bottom">
      <ActivityPanel />
      <footer class="fork-status">
        <span>{{ workspaceStore.currentPath || $t('workspace.noWorkspace') }}</span>
        <div><span v-if="workspaceStore.hasChanges">{{ $t('workspace.changeCount', { count: workspaceStore.statusList.length }) }}</span><span v-if="workspaceStore.svnInfo">r{{ workspaceStore.svnInfo.revision }}</span><button v-if="updateState === 'available'" class="version-update" :title="$t('appUpdate.viewRelease')" @click="openReleasePage">v{{ appVersion }}<span class="update-dot"></span>{{ $t('appUpdate.available', { version: latestVersion }) }}</button><span v-else>v{{ appVersion }}</span></div>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { launchWorkspacePath, openWorkspaceTarget, type OpenWorkspaceTarget } from '@/api/svn'
import { useWorkspaceStore } from '@/stores/workspace'
import { useStashStore } from '@/stores/stash'
import { useWorkspace } from '@/composables/useWorkspace'
import { useWorkspaceErrorToast } from '@/composables/useWorkspaceErrorToast'
import { useUpdateCheck } from '@/composables/useUpdateCheck'
import BranchSidebar from '@/components/BranchSidebar.vue'
import OperationDialog from '@/components/OperationDialog.vue'
import ActivityPanel from '@/components/ActivityPanel.vue'
import { useWorkflowStore } from '@/stores/workflows'
import LanguageSwitcher from '@/components/LanguageSwitcher.vue'
import {
  Archive,
  GitBranch,
  Warning,
  Code,
  FolderOpened as FolderOpenedIcon,
  Terminal,
} from '@/components/icons/materialIcons'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const workspaceStore = useWorkspaceStore()
const stashStore = useStashStore()
const workflow = useWorkflowStore()
const { loadWorkspace, openWorkspace, refreshStatus, refreshStatusIfStale, openStartupWorkspace } = useWorkspace()
const branchSidebar = ref<InstanceType<typeof BranchSidebar> | null>(null)
const sidebarCollapsed = ref(localStorage.getItem('orcasvn-sidebar-hidden') === 'true')
const openTabs = ref<string[]>((() => { try { const saved: unknown = JSON.parse(localStorage.getItem('orcasvn-open-workspaces') || '[]'); return Array.isArray(saved) ? [...new Set(saved.filter((p): p is string => typeof p === 'string' && p.length > 0))] : [] } catch { return [] } })())
const loadingTab = ref(false)
watch([() => workspaceStore.currentPath, () => workspaceStore.svnInfo?.url, () => workspaceStore.isLoading], ([path, url, loading]) => { if (path && url && !loading && !openTabs.value.includes(path)) openTabs.value = [...openTabs.value, path] }, { immediate: true })
watch(openTabs, paths => { try { localStorage.setItem('orcasvn-open-workspaces', JSON.stringify(paths)) } catch { /* Retain the open tabs in memory. */ } })
watch(sidebarCollapsed, hidden => { try { localStorage.setItem('orcasvn-sidebar-hidden', String(hidden)) } catch { /* Retain the current layout. */ } })
async function selectRepositoryTab(path: string) {
  if (loadingTab.value || path === workspaceStore.currentPath) return
  loadingTab.value = true
  try { if (await loadWorkspace(path)) await router.push({ name: 'workspace' }) } finally { loadingTab.value = false }
}
async function closeRepositoryTab(path: string) {
  if (loadingTab.value) return
  const index = openTabs.value.indexOf(path)
  if (workspaceStore.currentPath === path) {
    const next = openTabs.value[index + 1] || openTabs.value[index - 1]
    if (next) {
      loadingTab.value = true
      try { if (!await loadWorkspace(next)) return } finally { loadingTab.value = false }
    } else workspaceStore.clearWorkspace()
    await router.push({ name: 'workspace' })
  }
  openTabs.value = openTabs.value.filter(tab => tab !== path)
}
function handleShellKeydown(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return
  const pages = { '1': 'log', '2': 'workspace', '3': 'stash' } as Record<string, string>
  if (pages[event.key]) { event.preventDefault(); void navigateTo(pages[event.key]) }
  if (event.key === 'Tab' && openTabs.value.length > 1) {
    event.preventDefault()
    const index = openTabs.value.indexOf(workspaceStore.currentPath || '')
    void selectRepositoryTab(openTabs.value[(index + (event.shiftKey ? -1 : 1) + openTabs.value.length) % openTabs.value.length])
  }
}
const savedSidebarWidth = Number(localStorage.getItem('orcasvn-sidebar-width'))
const sidebarWidth = ref(savedSidebarWidth >= 200 && savedSidebarWidth <= 420 ? savedSidebarWidth : 240)
let resizing = false
function setSidebarWidth(value: number) { sidebarWidth.value = Math.max(200, Math.min(420, value)); localStorage.setItem('orcasvn-sidebar-width', String(sidebarWidth.value)) }
function startResize(event: PointerEvent) { resizing = true; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); event.preventDefault() }
function resizeSidebar(event: PointerEvent) { if (resizing) { const rail = event.currentTarget as HTMLElement; setSidebarWidth(event.clientX - (rail.parentElement?.getBoundingClientRect().left || 0) - 49) } }
function finishResize() { resizing = false }
const {
  currentVersion: appVersion,
  state: updateState,
  latestVersion,
  checkForUpdates,
  openReleasePage,
} = useUpdateCheck()
const cachedViews = ref(['WorkspaceView', 'LogView', 'UpdateView'])
const statusRefreshIntervalMs = 60_000
let statusRefreshTimer: number | undefined
const selectedOpenTarget = ref<OpenWorkspaceTarget>('explorer')
useWorkspaceErrorToast()

const openTargetIcons = {
  explorer: FolderOpenedIcon,
  vscode: Code,
  terminal: Terminal,
} satisfies Record<OpenWorkspaceTarget, typeof FolderOpenedIcon>
const selectedOpenTargetIcon = computed(() => openTargetIcons[selectedOpenTarget.value])
const stashCount = computed(() => stashStore.currentEntries(workspaceStore.currentPath).length + workflow.stashes.length)

const repositoryName = computed(() => {
  const path = workspaceStore.currentPath
  if (!path) return t('workspace.welcomeRepository')
  return path.split(/[\\/]/).filter(Boolean).pop() || path
})

const workspaceNameFromPath = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() || path

const repositoryRevision = computed(() => workspaceStore.svnInfo ? `r${workspaceStore.svnInfo.revision}` : 'OrcaSVN')

const routeName = computed(() => String(route.name || 'workspace'))
const currentRouteTitle = computed(() => {
  const titleKey = route.meta.title
  return t(typeof titleKey === 'string' ? titleKey : 'menu.workspace')
})

const navigateTo = (name: string) => router.push({ name })

const handleWorkspaceCommand = async (command: string) => {
  if (command === '__open__') {
    await openWorkspace(t('workspace.selectWorkspaceTitle'))
  } else if (command !== workspaceStore.currentPath) {
    await loadWorkspace(command)
  }
  await router.push({ name: 'workspace' })
}

const removeWorkspace = (path: string) => workspaceStore.removeRecentWorkspace(path, false)

const openCurrentWorkspaceIn = async (target: OpenWorkspaceTarget) => {
  if (!workspaceStore.currentPath) return

  try {
    await openWorkspaceTarget(workspaceStore.currentPath, target)
    selectedOpenTarget.value = target
  } catch (err) {
    ElMessage.error(`${t('common.error')}：${err}`)
  }
}

const refreshStatusSilently = async () => {
  if (!workspaceStore.currentPath || workspaceStore.isLoading) return
  await refreshStatusIfStale(statusRefreshIntervalMs)
}

onMounted(async () => {
  void checkForUpdates()
  await openStartupWorkspace(await launchWorkspacePath().catch(() => null))
  statusRefreshTimer = window.setInterval(refreshStatusSilently, statusRefreshIntervalMs)
})

onUnmounted(() => {
  if (statusRefreshTimer !== undefined) {
    window.clearInterval(statusRefreshTimer)
  }
})
</script>

<style scoped>
.source-shell{display:grid;grid-template-rows:35px 45px minmax(0,1fr) auto;height:100vh;overflow:hidden;background:var(--md-sys-color-surface);color:var(--md-sys-color-on-surface)}button{cursor:pointer}button:disabled{opacity:.35;cursor:default}.repository-tabs{display:flex;align-items:stretch;background:var(--source-titlebar);border-bottom:1px solid var(--md-sys-color-outline-variant);min-width:0}.app-mark{display:flex;gap:8px;align-items:center;flex-shrink:0;padding:0 14px;background:none;border:0;font-size:13px;color:var(--md-sys-color-primary)}.app-mark strong{color:var(--md-sys-color-on-surface);font-size:12px}.repository-tab-list{display:flex;align-items:stretch;overflow:auto;min-width:0;scrollbar-width:thin}.repository-tab{display:flex;align-items:stretch;min-width:120px;max-width:220px;border-right:1px solid var(--md-sys-color-outline-variant);border-top:2px solid transparent;font-size:12px}.repository-tab.active{border-top-color:var(--md-sys-color-primary);background:var(--md-sys-color-surface-container)}.repository-tab>button[role=tab]{display:flex;align-items:center;gap:7px;min-width:0;flex:1;background:none;border:0;padding:0 10px}.repository-tab span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tab-close,.add-repository{border:0;background:none;padding:0 9px;font-size:19px}.tab-close:hover,.add-repository:hover{background:var(--md-sys-state-hover)}.recent-path{display:block;max-width:450px;overflow:hidden;text-overflow:ellipsis;font-size:10px;opacity:.65}.repository-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 8px;background:var(--source-toolbar);border-bottom:1px solid var(--md-sys-color-outline-variant);min-width:0}.toolbar-group{display:flex;align-items:center;gap:3px;min-width:0}.toolbar-primary{justify-content:center;flex:1}.toolbar-right{justify-content:flex-end}.tool-button{display:flex;align-items:center;gap:6px;height:32px;padding:4px 9px;border:0;border-radius:3px;background:none;font-size:12px;white-space:nowrap}.tool-button:hover:not(:disabled){background:var(--md-sys-state-hover)}.tool-button .el-icon{font-size:17px}.tool-button .chevron{font-size:10px}.toolbar-divider{height:20px;width:1px;background:var(--md-sys-color-outline-variant);margin:0 5px}.repository-name{font-size:12px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.current-branch{max-width:220px}.current-branch span{overflow:hidden;text-overflow:ellipsis}.source-body{display:grid;grid-template-columns:49px var(--sidebar-width) 4px minmax(0,1fr);min-height:0;overflow:hidden}.source-body.sidebar-hidden{grid-template-columns:49px minmax(0,1fr)}.page-switcher{display:flex;flex-direction:column;gap:5px;align-items:center;padding:6px 0;border-right:1px solid var(--md-sys-color-outline-variant);background:var(--md-sys-color-surface-container)}.page-switcher>button{position:relative;display:grid;place-items:center;width:40px;height:38px;min-height:38px;border:0;border-radius:4px;background:none;color:var(--md-sys-color-on-surface-variant)}.page-switcher>button .el-icon{font-size:19px}.page-switcher>button.active{color:var(--md-sys-color-on-primary-container);background:var(--md-sys-color-primary-container)}.page-switcher>button:hover{background:var(--md-sys-state-hover)}.page-switcher b{position:absolute;right:1px;top:1px;font-size:9px;line-height:13px;padding:0 3px;border-radius:7px;background:var(--md-sys-color-primary);color:var(--md-sys-color-on-primary)}.rail-spacer{flex:1}.source-sidebar{min-width:0;min-height:0;overflow:auto;background:var(--md-sys-color-surface-container-low)}.sidebar-repository{display:flex;align-items:center;justify-content:space-between;gap:8px;height:34px;padding:0 10px;font-size:12px;border-bottom:1px solid var(--md-sys-color-outline-variant)}.sidebar-repository strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sidebar-repository small{font-size:10px;opacity:.65}.sidebar-resizer{background:var(--md-sys-color-outline-variant);touch-action:none;cursor:col-resize}.sidebar-resizer:hover,.sidebar-resizer:focus-visible{background:var(--md-sys-color-primary)}.sidebar-stashes,.repository-details{font-size:11px;padding:7px;border-top:1px solid var(--md-sys-color-outline-variant)}summary{cursor:pointer;font-weight:600;padding:4px}.sidebar-stashes button{display:flex;align-items:center;gap:6px;width:100%;padding:5px 8px;background:none;border:0;text-align:left;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sidebar-stashes button:hover{background:var(--md-sys-state-hover)}.repository-details small{display:block;overflow-wrap:anywhere;padding:5px;font-size:10px;color:var(--md-sys-color-on-surface-variant)}.route-workbench{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;background:var(--md-sys-color-surface-container-lowest)}.route-header{height:32px;min-height:32px;display:flex;justify-content:space-between;align-items:center;padding:0 12px;border-bottom:1px solid var(--md-sys-color-outline-variant);font-size:12px}.route-header small{font-size:11px;opacity:.6}.route-content{flex:1;min-width:0;min-height:0;overflow:auto}.route-content :deep(.left-panel),.route-content :deep(.welcome-sidebar){display:none}.route-content :deep(.workspace-layout){height:100%}.route-content :deep(.checkout-view),.route-content :deep(.commit-view),.route-content :deep(.update-view),.route-content :deep(.settings-view),.route-content :deep(.log-view),.route-content :deep(.diff-view),.route-content :deep(.blame-view){width:100%;max-width:none;margin:0;padding:0;min-height:100%}.route-content :deep(.el-card){border:0;border-radius:0;box-shadow:none}.route-content :deep(.el-card__header){padding:8px 12px}.route-content :deep(.el-card__body){padding:12px}.shell-bottom{min-width:0}.fork-status{display:flex;align-items:center;justify-content:space-between;gap:12px;height:24px;padding:0 9px;border-top:1px solid var(--md-sys-color-outline-variant);background:var(--md-sys-color-surface-container);font-size:10px;color:var(--md-sys-color-on-surface-variant)}.fork-status>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fork-status>div{display:flex;gap:12px;align-items:center;flex-shrink:0}.version-update{display:flex;gap:4px;align-items:center;border:0;background:none;color:var(--md-sys-color-primary);font-size:10px}.update-dot{width:5px;height:5px;border-radius:50%;background:var(--md-sys-color-primary)}@media(max-width:1000px){.toolbar-primary .tool-button{padding:4px 6px}.repository-name{max-width:90px}.source-body{grid-template-columns:49px min(var(--sidebar-width),210px) 4px minmax(0,1fr)}}@media(max-width:850px){.toolbar-primary .tool-button span{display:none}.repository-name{display:none}.app-mark strong{display:none}.current-branch{max-width:140px}}
</style>
