<template>
  <section v-if="workspace.currentPath" class="branch-panel">
    <header class="branch-heading">
      <strong
        >{{ $t('flow.branches') }} <small>{{ rows.length }}</small></strong
      >
      <div>
        <button
          :title="$t('branchUI.add')"
          :aria-label="$t('branchUI.add')"
          :disabled="flow.busy"
          @click="manager = 'add'"
        >
          <el-icon><Plus /></el-icon></button
        ><button
          :title="$t('branchUI.directory')"
          :aria-label="$t('branchUI.directory')"
          @click="manager = 'browse'"
        >
          <el-icon><MoreFilled /></el-icon></button
        ><button
          :title="$t('flow.branches') + ' · ' + $t('flow.refresh')"
          :aria-label="$t('flow.refresh')"
          :disabled="loading"
          @click="refresh"
        >
          <el-icon><Refresh /></el-icon>
        </button>
      </div>
    </header>
    <input
      ref="filterInput"
      v-model="filter"
      type="search"
      :placeholder="$t('flow.filterBranches')"
      :aria-label="$t('flow.filterBranches')"
    />
    <details class="branch-options">
      <summary :title="$t('experience.sort')">
        <el-icon><List /></el-icon>{{ $t('experience.sort') }}
      </summary>
      <div class="branch-options-body">
        <select v-model="sortMode" :aria-label="$t('experience.sort')">
          <option value="name">{{ $t('experience.name') }}</option>
          <option value="path">{{ $t('experience.path') }}</option></select
        ><label
          ><input v-model="groupPaths" type="checkbox" />{{ $t('experience.groupPaths') }}</label
        >
      </div>
    </details>
    <p v-if="flow.error" class="flow-error" :title="flow.error">{{ flow.error }}</p>
    <button
      v-if="flow.branchError"
      class="branch-list-notice"
      :title="$t('branchUI.directoryHint')"
      @click="manager = 'browse'"
    >
      <el-icon><InfoFilled /></el-icon> {{ $t('branchUI.directoryUnavailable') }}
      <el-icon><ChevronRight /></el-icon>
    </button>
    <div class="branch-groups" @keydown="navigate">
      <component
        :is="group.key === 'branches' ? 'section' : 'details'"
        v-for="group in groups"
        :key="group.key"
        class="branch-group"
        open
      >
        <summary v-if="group.key !== 'branches'">
          {{ group.title || $t(group.key === 'favorites' ? 'flow.favorites' : 'flow.branches') }}
          <small>({{ group.entries.length }})</small>
        </summary>
        <div
          v-for="entry in group.entries"
          :key="entry.url"
          class="branch-row"
          :class="{ selected: selectedUrl === entry.url, current: isCurrent(entry.url) }"
          @contextmenu.prevent.stop="openBranchMenu($event, entry.url)"
        >
          <button
            class="branch-name"
            :data-branch-url="entry.url"
            :title="entry.url"
            :aria-current="isCurrent(entry.url) ? 'true' : undefined"
            @click="browseHistory(entry.url)"
            @dblclick="prepare(entry.url)"
          >
            <el-icon class="branch-icon"><GitBranch /></el-icon><span>{{ entry.name }}</span
            ><el-icon v-if="isCurrent(entry.url)" class="current-check"><Check /></el-icon>
          </button>
          <button
            class="branch-star"
            :class="{ favorite: isFavorite(entry.url) }"
            :title="$t(isFavorite(entry.url) ? 'branchUI.unfavorite' : 'flow.favorite')"
            :aria-label="
              $t(isFavorite(entry.url) ? 'branchUI.unfavorite' : 'flow.favorite') +
              ': ' +
              entry.name
            "
            @click="toggleFavorite(entry.url)"
          >
            <el-icon><StarFilled v-if="isFavorite(entry.url)" /><Star v-else /></el-icon>
          </button>
        </div>
      </component>
      <p v-if="!rows.length" class="branch-empty">{{ $t('branchUI.noMatches') }}</p>
    </div>
    <FileContextMenu
      v-if="branchMenu.visible"
      :x="branchMenu.x"
      :y="branchMenu.y"
      :items="branchMenuItems"
      @action="runBranchAction"
      @close="branchMenu.visible = false"
    />
    <BranchManagerDialog v-if="manager" :initial-mode="manager" @close="manager = null" />
  </section>
</template>
<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, reactive, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import FileContextMenu from './FileContextMenu.vue'
import BranchManagerDialog from './BranchManagerDialog.vue'
import type { FileMenuItem } from '@/utils/fileMenu'
import { branchKey, uniqueBranches } from '@/utils/branches'
import { writeClipboardText } from '@/utils/clipboard'
import { useWorkflowStore } from '@/stores/workflows'
import { useWorkspaceStore } from '@/stores/workspace'
const flow = useWorkflowStore(),
  workspace = useWorkspaceStore(),
  router = useRouter(),
  { t } = useI18n()
const filter = ref(''),
  loading = ref(false),
  selectedUrl = ref(''),
  manager = ref<'add' | 'browse' | null>(null)
const sortMode = ref(localStorage.getItem('orcasvn-branch-sort') || 'name'),
  groupPaths = ref(localStorage.getItem('orcasvn-branch-group') === 'true')
watch([sortMode, groupPaths], () => {
  try {
    localStorage.setItem('orcasvn-branch-sort', sortMode.value)
    localStorage.setItem('orcasvn-branch-group', String(groupPaths.value))
  } catch {}
})
const filterInput = ref<HTMLInputElement | null>(null)
const isCurrent = (url: string) => branchKey(url) === branchKey(flow.identity?.url || '')
const isFavorite = (url: string) => (flow.favorites || []).includes(branchKey(url))
const rows = computed(() =>
  uniqueBranches([...flow.knownBranches, ...flow.branches])
    .filter((entry) =>
      `${entry.name} ${entry.url}`.toLowerCase().includes(filter.value.trim().toLowerCase())
    )
    .sort(
      (a, b) =>
        Number(isCurrent(b.url)) - Number(isCurrent(a.url)) ||
        (sortMode.value === 'path' ? a.url.localeCompare(b.url) : a.name.localeCompare(b.name)) ||
        a.url.localeCompare(b.url)
    )
)
const groups = computed(() => {
  const result: { key: string; title: string; entries: typeof rows.value }[] = []
  const favorites = rows.value.filter((entry) => isFavorite(entry.url)),
    branches = rows.value.filter((entry) => !isFavorite(entry.url))
  if (favorites.length) result.push({ key: 'favorites', title: '', entries: favorites })
  if (groupPaths.value) {
    const paths = new Map<string, typeof rows.value>()
    for (const entry of branches) {
      const path = entry.url.slice(0, entry.url.lastIndexOf('/'))
      paths.set(path, [...(paths.get(path) || []), entry])
    }
    for (const [path, entries] of paths) result.push({ key: path, title: path, entries })
  } else if (branches.length) result.push({ key: 'branches', title: '', entries: branches })
  return result
})
function toggleFavorite(url: string) {
  flow.toggleFavorite(url)
}
defineExpose({
  focus: async () => {
    await nextTick()
    filterInput.value?.scrollIntoView({ block: 'nearest' })
    filterInput.value?.focus()
  },
})
const branchMenu = reactive({ visible: false, x: 0, y: 0, url: '', workspace: '', current: '' })
const branchMenuItems = computed<FileMenuItem[]>(() => [
  {
    id: 'branch-switch',
    label: t('flow.switchTo'),
    shortcut: 'Enter',
    disabled: flow.busy || isCurrent(branchMenu.url) || !flow.identity,
  },
  { id: 'branch-history', label: t('fileMenu.history') },
  {
    id: 'branch-favorite',
    label: t(isFavorite(branchMenu.url) ? 'branchUI.unfavorite' : 'flow.favorite'),
    separator: true,
  },
  { id: 'copy-relative', label: t('branchUI.copyUrl') },
  { id: 'branch-browse', label: t('flow.browseDirectory') },
  {
    id: 'branch-remove',
    label: t('branchUI.remove'),
    separator: true,
    disabled:
      isCurrent(branchMenu.url) ||
      !flow.knownBranches.some((entry) => branchKey(entry.url) === branchKey(branchMenu.url)),
  },
])
function openBranchMenu(event: MouseEvent, url: string) {
  selectedUrl.value = url
  Object.assign(branchMenu, {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    url,
    workspace: workspace.currentPath,
    current: flow.identity?.url || '',
  })
}
async function runBranchAction(action: string) {
  const { url, workspace: path, current } = branchMenu
  const item = branchMenuItems.value.find((item) => item.id === action)
  branchMenu.visible = false
  if (
    !item ||
    item.disabled ||
    path !== workspace.currentPath ||
    current !== (flow.identity?.url || '')
  )
    return
  if (action === 'branch-history') browseHistory(url)
  else if (action === 'branch-switch') prepare(url)
  else if (action === 'branch-browse') {
    manager.value = 'browse'
    await flow.browse(url)
  } else if (action === 'branch-favorite') toggleFavorite(url)
  else if (action === 'branch-remove') flow.removeBranch(url)
  else if (action === 'copy-relative') {
    try {
      await writeClipboardText(url)
    } catch (e) {
      ElMessage.error(String(e))
    }
  }
}
function closeBranchMenu() {
  branchMenu.visible = false
}
watch(
  () => [workspace.currentPath, flow.identity?.url],
  () => {
    closeBranchMenu()
    selectedUrl.value = flow.identity?.url || ''
    manager.value = null
  },
  { immediate: true }
)
onMounted(() => {
  document.addEventListener('click', closeBranchMenu)
  document.addEventListener('scroll', closeBranchMenu, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', closeBranchMenu)
  document.removeEventListener('scroll', closeBranchMenu, true)
})
function browseHistory(url: string) {
  selectedUrl.value = url
  flow.browsingUrl = url
  void router.push({ name: 'log' })
}
async function refresh() {
  loading.value = true
  try {
    await flow.refresh(true)
  } finally {
    loading.value = false
  }
}
function prepare(url: string) {
  if (!workspace.currentPath || !flow.identity || flow.busy || isCurrent(url)) return
  flow.plan = null
  flow.switchRequest = { workspace: workspace.currentPath, source: url, current: flow.identity.url }
}
function navigate(event: KeyboardEvent) {
  const button = (event.target as HTMLElement)?.closest<HTMLButtonElement>('[data-branch-url]')
  if (!button) return
  const url = button.dataset.branchUrl!
  if (event.key === 'Enter') {
    event.preventDefault()
    prepare(url)
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    const buttons = [
      ...button
        .closest('.branch-groups')!
        .querySelectorAll<HTMLButtonElement>('details[open] [data-branch-url]'),
    ]
    const index = buttons.indexOf(button)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
    selectedUrl.value = buttons[next]?.dataset.branchUrl || selectedUrl.value
    buttons[next]?.focus()
  }
}
</script>
<style scoped>
.branch-options {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  font-size: var(--app-font-size-2xs);
}
.branch-options select {
  border: 0;
  background: transparent;
  color: inherit;
  font-size: var(--app-font-size-xs);
}
.branch-options label {
  display: flex;
  align-items: center;
  gap: 3px;
}
.branch-options input {
  display: inline;
  width: auto;
  margin: 0;
}
.branch-group summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.branch-panel {
  padding: 4px 0 0;
  border-top: 1px solid var(--md-sys-color-outline-variant);
  font-size: var(--app-font-size-sm);
  min-height: 0;
}
.branch-panel button {
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  font: inherit;
}
.branch-panel button:disabled {
  opacity: 0.4;
  cursor: default;
}
.branch-heading {
  height: 28px;
  padding: 0 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.branch-heading strong {
  font-size: var(--app-font-size-xs);
}
.branch-heading small {
  font-weight: 400;
  opacity: 0.5;
  margin-left: 4px;
}
.branch-heading button {
  width: 25px;
  height: 24px;
  font-size: 16px;
}
.branch-current {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 12px;
}
.current-dot {
  font-size: 8px;
  color: var(--md-sys-color-primary);
}
.branch-current strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.branch-current small {
  font-size: var(--app-font-size-2xs);
  color: var(--md-sys-color-on-surface-variant);
}
input {
  display: block;
  width: calc(100% - 16px);
  margin: 5px 8px 6px;
  padding: 4px 8px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 4px;
  font: inherit;
  background: var(--md-sys-color-surface);
  color: inherit;
}
.branch-groups {
  max-height: 42vh;
  overflow: auto;
}
.branch-group summary {
  height: 26px;
  padding: 5px 9px;
  cursor: pointer;
  font-size: var(--app-font-size-xs);
  color: var(--md-sys-color-on-surface-variant);
  user-select: none;
}
.branch-group summary small {
  opacity: 0.6;
}
.branch-row {
  height: 26px;
  display: flex;
  align-items: center;
  padding: 0 8px 0 16px;
  gap: 6px;
}
.branch-row:hover {
  background: var(--md-sys-color-surface-container-high);
}
.branch-row.selected {
  background: var(--md-sys-color-primary-container);
}
.branch-name {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 1;
  min-width: 0;
  height: 100%;
  text-align: left;
}
.branch-name > span:nth-child(2) {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.branch-name small {
  color: var(--md-sys-color-primary);
}
.branch-icon {
  font-size: 15px;
  opacity: 0.65;
}
.branch-row.current .branch-name {
  font-weight: 600;
}
.branch-star {
  width: 20px;
  height: 24px;
  opacity: 0;
}
.branch-star.favorite,
.branch-row:hover .branch-star,
.branch-row:focus-within .branch-star {
  opacity: 1;
}
.branch-star.favorite {
  color: var(--md-sys-color-primary);
}
.branch-list-notice {
  display: flex;
  width: calc(100% - 16px);
  margin: 4px 8px;
  padding: 4px !important;
  font-size: 10px !important;
  text-align: left;
  color: var(--md-sys-color-on-surface-variant) !important;
  gap: 5px;
}
.branch-list-notice span {
  margin-left: auto;
}
.branch-explicit-switch {
  display: flex;
  justify-content: space-between;
  width: 100%;
  height: 29px;
  align-items: center;
  padding: 0 12px !important;
  border-top: 1px solid var(--md-sys-color-outline-variant) !important;
  margin-top: 5px;
}
.branch-explicit-switch span {
  opacity: 0.5;
}
.branch-empty,
.flow-error {
  padding: 8px;
  font-size: var(--app-font-size-xs);
  color: var(--md-sys-color-on-surface-variant);
}
.flow-error {
  color: var(--md-sys-color-error);
  max-height: 60px;
  overflow: auto;
  overflow-wrap: anywhere;
}
</style>
