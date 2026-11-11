<template>
  <div class="source-shell" @keydown="handleShellKeydown">
    <nav class="shell-menubar" :aria-label="$t('forkUI.mainMenu')">
      <el-dropdown
        v-for="menu in shellMenus"
        :key="menu.label"
        trigger="click"
        @command="handleShellCommand"
      >
        <button class="menu-button">{{ $t(menu.label) }}</button>
        <template #dropdown
          ><el-dropdown-menu
            ><el-dropdown-item
              v-for="item in menu.items"
              :key="item.command"
              :command="item.command"
              :disabled="item.repository && (!workspaceStore.currentPath || workflow.busy)"
              >{{ $t(item.label) }}</el-dropdown-item
            ></el-dropdown-menu
          ></template
        >
      </el-dropdown>
    </nav>
    <header class="repository-toolbar">
      <div class="toolbar-group toolbar-primary">
        <button
          class="tool-button icon-only"
          :title="$t('sourceUI.toggleSidebar')"
          :aria-label="$t('sourceUI.toggleSidebar')"
          :aria-pressed="showSidebar"
          @click="toggleSidebar"
        >
          <el-icon><PanelLeft /></el-icon>
        </button>
        <button
          class="tool-button"
          :disabled="!workspaceStore.currentPath || workspaceStore.isLoading || workflow.busy"
          :title="$t('menu.refresh')"
          :aria-label="$t('menu.refresh')"
          @click="refreshStatus"
        >
          <el-icon :class="{ 'is-loading': workspaceStore.isLoading }"><Refresh /></el-icon
          ><span>{{ $t('menu.refresh') }}</span>
        </button>
        <button
          class="tool-button"
          :disabled="!workspaceStore.currentPath || workspaceStore.isLoading || workflow.busy"
          :title="$t('menu.update')"
          :aria-label="$t('menu.update')"
          :aria-busy="updating"
          @click="updateWorkspace()"
        >
          <el-icon :class="{ 'is-loading': updating }"><RefreshRight /></el-icon
          ><span>{{ $t('menu.update') }}</span>
        </button>
        <button
          class="tool-button"
          :disabled="!workspaceStore.currentPath"
          :title="$t('menu.stash')"
          @click="navigateTo('stash')"
        >
          <el-icon><Archive /></el-icon><span>{{ $t('menu.stash') }}</span>
        </button>
      </div>
      <button
        class="repository-identity"
        :disabled="!workspaceStore.currentPath"
        :title="workflow.identity?.url"
        @click="focusBranches"
      >
        <strong>{{
          workspaceStore.currentPath
            ? workspaceNameFromPath(workspaceStore.currentPath)
            : $t('workspace.openWorkspace')
        }}</strong>
        <span
          ><el-icon><GitBranch /></el-icon>{{ workflow.branchName || repositoryRevision
          }}<el-icon><ArrowDown /></el-icon
        ></span>
      </button>
      <div class="toolbar-group toolbar-right">
        <el-dropdown
          trigger="click"
          :disabled="!workspaceStore.currentPath"
          @command="openCurrentWorkspaceIn"
        >
          <button
            class="tool-button"
            :disabled="!workspaceStore.currentPath"
            :title="$t('menu.openIn')"
            :aria-label="$t('menu.openIn')"
          >
            <el-icon><component :is="selectedOpenTargetIcon" /></el-icon
            ><span>{{ $t('menu.openIn') }}</span
            ><el-icon class="chevron"><ArrowDown /></el-icon>
          </button>
          <template #dropdown
            ><el-dropdown-menu
              ><el-dropdown-item
                v-for="target in ['explorer', 'vscode', 'terminal'] as const"
                :key="target"
                :command="target"
                ><el-icon><component :is="openTargetIcons[target]" /></el-icon
                >{{ $t('openIn.' + target) }}</el-dropdown-item
              ></el-dropdown-menu
            ></template
          >
        </el-dropdown>
        <button
          class="tool-button"
          :disabled="!workspaceStore.currentPath"
          :title="$t('openIn.terminal')"
          @click="openCurrentWorkspaceIn('terminal')"
        >
          <el-icon><Terminal /></el-icon><span>{{ $t('openIn.terminal') }}</span>
        </button>
        <button
          class="tool-button"
          :title="$t('forkUI.appearance')"
          @click="navigateTo('settings')"
        >
          <el-icon><Setting /></el-icon><span>{{ $t('forkUI.appearance') }}</span>
        </button>
        <LanguageSwitcher />
      </div>
    </header>
    <div class="repository-tabs">
      <button
        class="app-mark"
        :title="$t('workspace.openWorkspace')"
        @click="handleWorkspaceCommand('__open__')"
      >
        <img class="brand-logo" :src="orcaLogo" alt="" /><strong>OrcaSVN</strong>
      </button>
      <div class="repository-tab-list" role="tablist" :aria-label="$t('sourceUI.repositories')">
        <div
          v-for="path in openTabs"
          :key="path"
          class="repository-tab"
          :draggable="!workflow.busy"
          @dragstart="draggedTab = path"
          @dragover.prevent
          @drop.prevent="openTabs = reorderTabs(openTabs, draggedTab, path)"
          @auxclick.middle.prevent="closeRepositoryTab(path)"
          @contextmenu.prevent="openTabMenu($event, path)"
          :class="{ active: path === workspaceStore.currentPath }"
        >
          <button
            role="tab"
            :aria-selected="path === workspaceStore.currentPath"
            :title="path"
            :disabled="loadingTab || workflow.busy"
            @click="selectRepositoryTab(path)"
          >
            <el-icon><Folder /></el-icon><span>{{ workspaceNameFromPath(path) }}</span>
          </button>
          <button
            class="tab-close"
            :title="$t('common.close')"
            :aria-label="$t('common.close') + ': ' + workspaceNameFromPath(path)"
            :disabled="loadingTab || workflow.busy"
            @click="closeRepositoryTab(path)"
          >
            <el-icon><Close /></el-icon>
          </button>
        </div>
      </div>
      <el-dropdown trigger="click" @command="handleWorkspaceCommand"
        ><button
          class="add-repository"
          :title="$t('sourceUI.recentRepositories')"
          :aria-label="$t('sourceUI.recentRepositories')"
        >
          <el-icon><Plus /></el-icon></button
        ><template #dropdown
          ><el-dropdown-menu
            ><el-dropdown-item command="__open__"
              >{{ $t('workspace.openWorkspace') }}…</el-dropdown-item
            ><el-dropdown-item
              v-for="path in workspaceStore.recentWorkspaces"
              :key="path"
              :command="path"
              ><span :title="path"
                >{{ workspaceNameFromPath(path)
                }}<small class="recent-path">{{ path }}</small></span
              ><button
                class="recent-remove"
                :title="$t('workspace.removeWorkspace')"
                :aria-label="$t('workspace.removeWorkspace')"
                @click.stop="removeWorkspace(path)"
              >
                <el-icon
                  ><Close
                /></el-icon></button></el-dropdown-item></el-dropdown-menu></template
      ></el-dropdown>
    </div>
    <main
      class="source-body"
      :class="{ 'sidebar-hidden': !showSidebar }"
      :style="{ '--sidebar-width': `${sidebarWidth}px` }"
    >
      <aside v-show="showSidebar" class="source-sidebar">
        <div class="sidebar-repository">
          <strong :title="workspaceStore.currentPath || ''">{{
            workspaceStore.currentPath
              ? workspaceNameFromPath(workspaceStore.currentPath)
              : 'OrcaSVN'
          }}</strong>
          <button
            :title="$t('menu.settings')"
            :aria-label="$t('menu.settings')"
            @click="navigateTo('settings')"
          >
            <el-icon><Setting /></el-icon>
          </button>
        </div>
        <nav class="repository-navigation" :aria-label="$t('workspace.quickActions')">
          <button
            :class="{
              active: routeName === 'workspace' || routeName === 'commit',
            }"
            :title="$t('menu.workspace') + ' · Ctrl+2'"
            :aria-label="$t('forkUI.localChanges')"
            @click="navigateTo('workspace')"
          >
            <el-icon><Layers /></el-icon><span>{{ $t('forkUI.localChanges') }}</span
            ><b v-if="workspaceStore.statusList.length">{{
              workspaceStore.statusList.length > 99 ? '99+' : workspaceStore.statusList.length
            }}</b>
          </button>
          <button
            :class="{ active: routeName === 'log' }"
            :title="$t('menu.log') + ' · Ctrl+1'"
            :aria-label="$t('forkUI.allCommits')"
            @click="navigateTo('log')"
          >
            <el-icon><History /></el-icon><span>{{ $t('forkUI.allCommits') }}</span>
          </button>
        </nav>
        <div class="repository-navigation-scroll">
          <BranchSidebar ref="branchSidebar" />
          <details class="sidebar-stashes" open>
            <summary>
              <el-icon class="stash-chevron"><ChevronRight /></el-icon
              ><span>{{ $t('menu.stash') }}</span
              ><small>{{ stashCount }}</small
              ><button
                class="stash-manage"
                :title="$t('menu.stash')"
                :aria-label="$t('menu.stash')"
                @click.prevent="navigateTo('stash')"
              >
                <el-icon><ArrowRight /></el-icon>
              </button>
            </summary>
            <button
              v-for="entry in workflow.stashes"
              :key="entry.id"
              class="sidebar-stash"
              :title="entry.name"
              @click="openStash(entry.id)"
            >
              <el-icon><Archive /></el-icon><span>{{ entry.name }}</span>
            </button>
          </details>
        </div>
        <nav class="repository-navigation sidebar-utilities" :aria-label="$t('common.action')">
          <button
            :class="{ active: routeName === 'checkout' }"
            :title="$t('menu.checkout')"
            :aria-label="$t('menu.checkout')"
            @click="navigateTo('checkout')"
          >
            <el-icon><Download /></el-icon><span>{{ $t('menu.checkout') }}</span>
          </button>
        </nav>
      </aside>
      <div
        v-show="showSidebar"
        class="sidebar-resizer"
        role="separator"
        aria-orientation="vertical"
        :aria-label="$t('flow.branches')"
        :aria-valuenow="sidebarWidth"
        :aria-valuemin="200"
        :aria-valuemax="420"
        tabindex="0"
        @pointerdown="startResize"
        @pointermove="resizeSidebar"
        @pointerup="finishResize"
        @lostpointercapture="finishResize"
        @keydown.left.prevent="setSidebarWidth(sidebarWidth - 16)"
        @keydown.right.prevent="setSidebarWidth(sidebarWidth + 16)"
      ></div>
      <section class="route-workbench">
        <div
          v-if="workspaceStore.conflictedCount && routeName !== 'conflicts'"
          class="repository-conflict-bar"
        >
          <strong>{{ $t('flow.conflicts') }} · {{ workspaceStore.conflictedCount }}</strong
          ><button @click="navigateTo('conflicts')">{{ $t('flow.conflicts') }}…</button>
        </div>
        <div class="route-content">
          <router-view v-slot="{ Component }"
            ><keep-alive :include="cachedViews"><component :is="Component" /></keep-alive
          ></router-view>
        </div>
      </section>
    </main>
    <FileContextMenu
      v-if="tabMenu.visible"
      :x="tabMenu.x"
      :y="tabMenu.y"
      :items="[
        {
          id: 'others',
          label: $t('experience.closeOthers'),
          disabled: workflow.busy,
        },
        {
          id: 'right',
          label: $t('experience.closeRight'),
          disabled: workflow.busy,
        },
      ]"
      @action="closeTabGroup"
      @close="tabMenu.visible = false"
    />
    <OperationDialog />
    <div class="shell-bottom">
      <ActivityPanel />
      <footer class="fork-status">
        <span class="status-path" :title="workspaceStore.currentPath || ''">{{
          workspaceStore.currentPath || $t('workspace.noWorkspace')
        }}</span>
        <div>
          <span v-if="workspaceStore.hasChanges">{{
            $t('workspace.changeCount', {
              count: workspaceStore.statusList.length,
            })
          }}</span
          ><span v-if="workspaceStore.svnInfo">r{{ workspaceStore.svnInfo.revision }}</span
          ><button
            v-if="updateState === 'available'"
            class="version-update"
            :title="$t('appUpdate.viewRelease')"
            @click="openReleasePage"
          >
            v{{ appVersion }}<span class="update-dot"></span
            >{{ $t('appUpdate.available', { version: latestVersion }) }}</button
          ><span v-else>v{{ appVersion }}</span>
        </div>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import orcaLogo from '../../src-tauri/icons/orca.svg'
import { nextTick, reactive, computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { launchWorkspacePath, openWorkspaceTarget, type OpenWorkspaceTarget } from '@/api/svn'
import { useWorkspaceStore } from '@/stores/workspace'
import { useStashStore } from '@/stores/stash'
import { useWorkspace } from '@/composables/useWorkspace'
import { useWorkspaceErrorToast } from '@/composables/useWorkspaceErrorToast'
import { useUpdateCheck } from '@/composables/useUpdateCheck'
import { useSvnUpdate } from '@/composables/useSvnUpdate'
import { persistRepositoryUi, repositoryUi, reorderTabs, tabsToClose } from '@/utils/repositoryUi'
import FileContextMenu from '@/components/FileContextMenu.vue'
import BranchSidebar from '@/components/BranchSidebar.vue'
import OperationDialog from '@/components/OperationDialog.vue'
import ActivityPanel from '@/components/ActivityPanel.vue'
import { useWorkflowStore } from '@/stores/workflows'
import LanguageSwitcher from '@/components/LanguageSwitcher.vue'
import {
  GitBranch,
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
const { updateWorkspace, updating } = useSvnUpdate()
const { loadWorkspace, openWorkspace, refreshStatus, refreshStatusIfStale, openStartupWorkspace } =
  useWorkspace()
const branchSidebar = ref<InstanceType<typeof BranchSidebar> | null>(null)
const sidebarCollapsed = ref(localStorage.getItem('orcasvn-fork-sidebar-hidden') === 'true')
const openTabs = ref<string[]>(
  (() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('orcasvn-open-workspaces') || '[]')
      return Array.isArray(saved)
        ? [...new Set(saved.filter((p): p is string => typeof p === 'string' && p.length > 0))]
        : []
    } catch {
      return []
    }
  })()
)
const loadingTab = ref(false),
  draggedTab = ref('')
const tabMenu = reactive({ visible: false, x: 0, y: 0, path: '' })
function openTabMenu(event: MouseEvent, path: string) {
  tabMenu.visible = true
  tabMenu.x = event.clientX
  tabMenu.y = event.clientY
  tabMenu.path = path
}
async function closeTabGroup(kind: string) {
  tabMenu.visible = false
  if (workflow.busy) return
  const closing = tabsToClose(openTabs.value, tabMenu.path, kind)
  if (closing.includes(workspaceStore.currentPath || '')) {
    await selectRepositoryTab(tabMenu.path)
    if (workspaceStore.currentPath !== tabMenu.path) return
  }
  openTabs.value = openTabs.value.filter((path) => !closing.includes(path))
}

function saveRepositoryView() {
  document.dispatchEvent(new Event('orcasvn-save-view'))
  const path = workspaceStore.currentPath
  if (path) {
    const state = repositoryUi(path)
    state.route = String(route.name || 'workspace')
    state.query = { ...route.query }
    state.browsingUrl = workflow.browsingUrl || state.browsingUrl
    state.workingUrl = workflow.identity?.url || state.workingUrl
    persistRepositoryUi()
  }
}
async function restoreRepositoryView(path: string) {
  const state = repositoryUi(path)
  if (state.browsingUrl) workflow.browsingUrl = state.browsingUrl
  await router.push({
    name: state.route,
    query: state.query as Record<string, string>,
  })
  await nextTick()
  document.dispatchEvent(new Event('orcasvn-restore-view'))
}

watch(
  [
    () => workspaceStore.currentPath,
    () => workspaceStore.svnInfo?.url,
    () => workspaceStore.isLoading,
  ],
  ([path, url, loading]) => {
    if (path && url && !loading && !openTabs.value.includes(path))
      openTabs.value = [...openTabs.value, path]
  },
  { immediate: true }
)
watch(openTabs, (paths) => {
  try {
    localStorage.setItem('orcasvn-open-workspaces', JSON.stringify(paths))
  } catch {
    /* Retain the open tabs in memory. */
  }
})
watch(sidebarCollapsed, (hidden) => {
  try {
    localStorage.setItem('orcasvn-fork-sidebar-hidden', String(hidden))
  } catch {
    /* Retain the current layout. */
  }
})
async function selectRepositoryTab(path: string) {
  if (loadingTab.value || workflow.busy || path === workspaceStore.currentPath) return
  saveRepositoryView()
  loadingTab.value = true
  try {
    if (await loadWorkspace(path)) await restoreRepositoryView(path)
  } finally {
    loadingTab.value = false
  }
}
async function closeRepositoryTab(path: string) {
  if (loadingTab.value || workflow.busy) return
  saveRepositoryView()
  const index = openTabs.value.indexOf(path)
  if (workspaceStore.currentPath === path) {
    const next = openTabs.value[index + 1] || openTabs.value[index - 1]
    if (next) {
      loadingTab.value = true
      try {
        if (!(await loadWorkspace(next))) return
      } finally {
        loadingTab.value = false
      }
    } else workspaceStore.clearWorkspace()
    if (workspaceStore.currentPath) await restoreRepositoryView(workspaceStore.currentPath)
    else await router.push({ name: 'workspace' })
  }
  openTabs.value = openTabs.value.filter((tab) => tab !== path)
}
function handleShellKeydown(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return
  const pages = { '1': 'log', '2': 'workspace', '3': 'stash' } as Record<string, string>
  if (pages[event.key]) {
    event.preventDefault()
    void navigateTo(pages[event.key])
  }
  if (event.key === 'Tab' && openTabs.value.length > 1) {
    event.preventDefault()
    const index = openTabs.value.indexOf(workspaceStore.currentPath || '')
    void selectRepositoryTab(
      openTabs.value[
        (index + (event.shiftKey ? -1 : 1) + openTabs.value.length) % openTabs.value.length
      ]
    )
  }
}
const savedSidebarWidth = Number(localStorage.getItem('orcasvn-sidebar-width'))
const sidebarWidth = ref(
  savedSidebarWidth >= 200 && savedSidebarWidth <= 420 ? savedSidebarWidth : 240
)
let resizing = false
function setSidebarWidth(value: number) {
  sidebarWidth.value = Math.max(200, Math.min(420, value))
  localStorage.setItem('orcasvn-sidebar-width', String(sidebarWidth.value))
}
function startResize(event: PointerEvent) {
  resizing = true
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  event.preventDefault()
}
function resizeSidebar(event: PointerEvent) {
  if (resizing) {
    const rail = event.currentTarget as HTMLElement
    setSidebarWidth(event.clientX - (rail.parentElement?.getBoundingClientRect().left || 0))
  }
}
function finishResize() {
  resizing = false
}
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
const stashCount = computed(
  () => stashStore.currentEntries(workspaceStore.currentPath).length + workflow.stashes.length
)

const workspaceNameFromPath = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() || path

const repositoryRevision = computed(() =>
  workspaceStore.svnInfo ? `r${workspaceStore.svnInfo.revision}` : 'OrcaSVN'
)

const shellMenus = [
  {
    label: 'forkUI.file',
    items: [
      { command: 'open', label: 'workspace.openWorkspace' },
      { command: 'checkout', label: 'menu.checkout' },
      { command: 'settings', label: 'menu.settings' },
    ],
  },
  {
    label: 'forkUI.view',
    items: [
      { command: 'workspace', label: 'forkUI.localChanges' },
      { command: 'log', label: 'forkUI.allCommits' },
      { command: 'sidebar', label: 'sourceUI.toggleSidebar' },
    ],
  },
  {
    label: 'forkUI.repository',
    items: [
      { command: 'refresh', label: 'menu.refresh', repository: true },
      { command: 'update', label: 'menu.update', repository: true },
      { command: 'branches', label: 'flow.branches', repository: true },
      { command: 'stash', label: 'menu.stash', repository: true },
    ],
  },
] as {
  label: string
  items: { command: string; label: string; repository?: boolean }[]
}[]
async function handleShellCommand(command: string) {
  if (command === 'open') return handleWorkspaceCommand('__open__')
  if (command === 'sidebar') return toggleSidebar()
  if (command === 'branches') return focusBranches()
  if (command === 'update') return updateWorkspace()
  if (command === 'refresh') {
    if (!workflow.busy) return refreshStatus()
    return
  }
  return navigateTo(command)
}
const routeName = computed(() => String(route.name || 'workspace'))
const showSidebar = computed(() => !sidebarCollapsed.value)
async function focusBranches() {
  sidebarCollapsed.value = false
  await nextTick()
  await branchSidebar.value?.focus()
}
function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
}
function openStash(id: string) {
  saveRepositoryView()
  void router.push({ name: 'stash', query: { id } })
}
const navigateTo = (name: string) => {
  saveRepositoryView()
  return router.push(name === 'commit' ? { name: 'workspace', query: { commit: '1' } } : { name })
}

const handleWorkspaceCommand = async (command: string) => {
  if (workflow.busy) return
  saveRepositoryView()
  if (command === '__open__') {
    await openWorkspace(t('workspace.selectWorkspaceTitle'))
  } else if (command !== workspaceStore.currentPath) {
    await loadWorkspace(command)
  }
  if (workspaceStore.currentPath) await restoreRepositoryView(workspaceStore.currentPath)
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

const handleFocus = () => {
  if (!workflow.busy) void refreshStatusIfStale(3000)
}
onMounted(async () => {
  window.addEventListener('focus', handleFocus)
  window.addEventListener('beforeunload', saveRepositoryView)
  void checkForUpdates()
  await openStartupWorkspace(await launchWorkspacePath().catch(() => null))
  if (workspaceStore.currentPath) await restoreRepositoryView(workspaceStore.currentPath)
  statusRefreshTimer = window.setInterval(refreshStatusSilently, statusRefreshIntervalMs)
})

onUnmounted(() => {
  window.removeEventListener('focus', handleFocus)
  window.removeEventListener('beforeunload', saveRepositoryView)
  if (statusRefreshTimer !== undefined) {
    window.clearInterval(statusRefreshTimer)
  }
})
</script>

<style scoped>
.shell-menubar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  background: var(--source-titlebar);
}
.menu-button {
  border: 0;
  background: none;
  color: inherit;
  font-size: var(--app-font-size-xs);
  padding: 2px 6px;
}
.repository-identity {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  min-width: 120px;
  max-width: 280px;
  width: 24%;
  border: 0;
  border-radius: 3px;
  background: var(--md-sys-color-surface-container);
  color: inherit;
  padding: 3px 12px;
}
.repository-identity strong {
  display: block;
  max-width: 100%;
  font-size: var(--app-font-size-sm);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.repository-identity > span {
  display: flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  font-size: var(--app-font-size-2xs);
  color: var(--md-sys-color-on-surface-variant);
}
.repository-toolbar > .toolbar-group {
  flex: 1;
}
.repository-navigation {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 3px 5px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}
.repository-navigation > button,
.sidebar-stashes button {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 26px;
  width: 100%;
  text-align: left;
  border: 0;
  border-radius: 3px;
  background: none;
  color: inherit;
  padding: 3px 8px;
  font-size: var(--app-font-size-sm);
}
.repository-navigation > button > span,
.sidebar-stashes button > span {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.repository-navigation > button.active,
.sidebar-stashes button.active {
  background: var(--md-sys-color-surface-container-highest);
}
.repository-navigation > button:hover,
.sidebar-stashes button:hover {
  background: var(--md-sys-color-surface-container-high);
}
.repository-navigation b,
.sidebar-stashes small {
  margin-left: auto;
  font-size: var(--app-font-size-2xs);
  font-weight: 400;
  color: var(--md-sys-color-on-surface-variant);
}
.repository-navigation-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.sidebar-utilities {
  border-top: 1px solid var(--md-sys-color-outline-variant);
  border-bottom: 0;
}
.sidebar-stashes {
  padding: 4px;
  border-top: 1px solid var(--md-sys-color-outline-variant);
}
.sidebar-stashes summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 5px;
  min-height: 26px;
  font-size: var(--app-font-size-xs);
  cursor: pointer;
  list-style: none;
}
.sidebar-stashes summary::-webkit-details-marker {
  display: none;
}
.sidebar-stashes[open] .stash-chevron {
  transform: rotate(90deg);
}
.sidebar-stashes summary > .stash-manage {
  width: 24px;
  padding: 3px;
  justify-content: center;
}
.sidebar-stashes .sidebar-stash {
  padding-left: 24px;
}
.sidebar-repository > button {
  display: grid;
  place-items: center;
  border: 0;
  background: none;
  color: inherit;
  padding: 4px;
}
.source-shell {
  display: grid;
  grid-template-rows: 24px 44px 28px minmax(0, 1fr) auto;
  height: 100vh;
  overflow: hidden;
  background: var(--md-sys-color-surface);
  color: var(--md-sys-color-on-surface);
}
button {
  cursor: pointer;
}
button:disabled {
  opacity: 0.35;
  cursor: default;
}
.repository-tabs {
  display: flex;
  align-items: stretch;
  background: var(--source-titlebar);
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  min-width: 0;
}
.app-mark {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
  padding: 0 14px;
  background: none;
  border: 0;
  font-size: 13px;
  color: var(--md-sys-color-primary);
}
.app-mark strong {
  color: var(--md-sys-color-on-surface);
  font-size: var(--app-font-size-sm);
}
.repository-tab-list {
  display: flex;
  align-items: stretch;
  overflow: auto;
  min-width: 0;
  scrollbar-width: thin;
}
.repository-tab {
  display: flex;
  align-items: stretch;
  min-width: 120px;
  max-width: 220px;
  border-right: 1px solid var(--md-sys-color-outline-variant);
  border-top: 2px solid transparent;
  font-size: var(--app-font-size-sm);
}
.repository-tab.active {
  border-top-color: var(--md-sys-color-primary);
  background: var(--md-sys-color-surface-container);
}
.repository-tab > button[role='tab'] {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  flex: 1;
  background: none;
  border: 0;
  padding: 0 10px;
}
.repository-tab span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tab-close,
.add-repository {
  border: 0;
  background: none;
  padding: 0 9px;
  font-size: 19px;
}
.tab-close:hover,
.add-repository:hover {
  background: var(--md-sys-state-hover);
}
.recent-path {
  display: block;
  max-width: 450px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--app-font-size-2xs);
  opacity: 0.65;
}
.repository-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 8px;
  background: var(--source-toolbar);
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  min-width: 0;
}
.toolbar-group {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
}
.toolbar-primary {
  justify-content: flex-start;
  flex: 1;
}
.toolbar-right {
  justify-content: flex-end;
}
.tool-button {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 4px 9px;
  border: 0;
  border-radius: 3px;
  background: none;
  font-size: var(--app-font-size-sm);
  white-space: nowrap;
}
.tool-button:hover:not(:disabled) {
  background: var(--md-sys-state-hover);
}
.tool-button .el-icon {
  font-size: 17px;
}
.tool-button .chevron {
  font-size: var(--app-font-size-2xs);
}
.toolbar-divider {
  height: 20px;
  width: 1px;
  background: var(--md-sys-color-outline-variant);
  margin: 0 5px;
}
.repository-name {
  font-size: var(--app-font-size-sm);
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.current-branch {
  max-width: 220px;
}
.current-branch span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.source-body {
  display: grid;
  grid-template-columns:
    min(var(--sidebar-width), calc(100vw - 484px))
    4px minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
}
.source-body.sidebar-hidden {
  grid-template-columns: minmax(0, 1fr);
}
.source-sidebar {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--md-sys-color-surface-container-low);
}
.sidebar-repository {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 34px;
  flex-shrink: 0;
  padding: 0 10px;
  font-size: var(--app-font-size-sm);
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}
.sidebar-repository strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidebar-repository small {
  font-size: var(--app-font-size-2xs);
  opacity: 0.65;
}
.sidebar-resizer {
  background: var(--md-sys-color-outline-variant);
  touch-action: none;
  cursor: col-resize;
}
.sidebar-resizer:hover,
.sidebar-resizer:focus-visible {
  background: var(--md-sys-color-primary);
}
.sidebar-stashes,
.repository-details {
  font-size: var(--app-font-size-xs);
  padding: 7px;
  border-top: 1px solid var(--md-sys-color-outline-variant);
}
summary {
  cursor: pointer;
  font-weight: 600;
  padding: 4px;
}
.sidebar-stashes button {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  background: none;
  border: 0;
  text-align: left;
  font-size: var(--app-font-size-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidebar-stashes button:hover {
  background: var(--md-sys-state-hover);
}
.repository-details small {
  display: block;
  overflow-wrap: anywhere;
  padding: 5px;
  font-size: var(--app-font-size-2xs);
  color: var(--md-sys-color-on-surface-variant);
}
.route-workbench {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--md-sys-color-surface-container-lowest);
}
.route-header {
  height: 32px;
  min-height: 32px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 12px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  font-size: var(--app-font-size-sm);
}
.route-header small {
  font-size: var(--app-font-size-xs);
  opacity: 0.6;
}
.route-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
.route-content :deep(.left-panel),
.route-content :deep(.welcome-sidebar) {
  display: none;
}
.route-content :deep(.workspace-layout) {
  height: 100%;
}
.route-content :deep(.checkout-view),
.route-content :deep(.commit-view),
.route-content :deep(.update-view),
.route-content :deep(.settings-view),
.route-content :deep(.log-view),
.route-content :deep(.diff-view),
.route-content :deep(.blame-view) {
  width: 100%;
  max-width: none;
  margin: 0;
  padding: 0;
  min-height: 100%;
}
.route-content :deep(.el-card) {
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.route-content :deep(.el-card__header) {
  padding: 8px 12px;
}
.route-content :deep(.el-card__body) {
  padding: 12px;
}
.shell-bottom {
  min-width: 0;
}
.fork-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 24px;
  padding: 0 9px;
  border-top: 1px solid var(--md-sys-color-outline-variant);
  background: var(--md-sys-color-surface-container);
  font-size: var(--app-font-size-2xs);
  color: var(--md-sys-color-on-surface-variant);
}
.fork-status > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fork-status > div {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-shrink: 0;
}
.version-update {
  display: flex;
  gap: 4px;
  align-items: center;
  border: 0;
  background: none;
  color: var(--md-sys-color-primary);
  font-size: var(--app-font-size-2xs);
}
.update-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--md-sys-color-primary);
}
@media (max-width: 1000px) {
  .toolbar-primary .tool-button {
    padding: 4px 6px;
  }
  .repository-name {
    max-width: 90px;
  }
}
@media (max-width: 850px) {
  .toolbar-primary .tool-button span {
    display: none;
  }
  .repository-name {
    display: none;
  }
  .app-mark strong {
    display: none;
  }
  .current-branch {
    max-width: 140px;
  }
}
</style>
