<template>
  <section class="change-tree-panel" data-changes-view>
    <header>
      <strong
        >{{ title }}
        <span
          >({{ entries.length
          }}<template v-if="total !== undefined && total !== entries.length">
            / {{ total }}</template
          >)</span
        ></strong
      >
      <div class="tree-tools">
        <button
          v-if="!viewMode || viewMode === 'tree'"
          :title="$t('changes.expandAll')"
          :aria-label="$t('changes.expandAll')"
          :disabled="!rows.length"
          @click="setAllExpanded(true)"
        >
          <el-icon><ExpandAll /></el-icon>
        </button>
        <button
          v-if="!viewMode || viewMode === 'tree'"
          :title="$t('changes.collapseAll')"
          :aria-label="$t('changes.collapseAll')"
          :disabled="!rows.length"
          @click="setAllExpanded(false)"
        >
          <el-icon><CollapseAll /></el-icon>
        </button>
        <button
          :disabled="disabled || !selectedSelectable.length"
          :title="$t(staged ? 'changes.unstage' : 'changes.stage') + ' · Space / Enter'"
          :aria-label="$t(staged ? 'changes.unstage' : 'changes.stage')"
          @click="toggleSelected"
        >
          <el-icon><ArrowUp v-if="staged" /><ArrowDownToLine v-else /></el-icon>
        </button>
        <button
          :disabled="disabled || !batchTargets.length"
          :title="$t(staged ? 'changes.unstageAll' : 'changes.stageAll')"
          :aria-label="$t(staged ? 'changes.unstageAll' : 'changes.stageAll')"
          @click="$emit('toggle-selection', batchTargets)"
        >
          <el-icon><ChevronsUp v-if="staged" /><ChevronsDown v-else /></el-icon>
        </button>
      </div>
    </header>
    <VirtualViewport
      v-if="rows.length"
      ref="viewport"
      class="change-tree"
      :item-count="rows.length"
      :row-height="26"
      :reset-key="`${workspaceKey}|${filterKey}|${viewMode}`"
      role="tree"
      aria-multiselectable="true"
      :aria-label="title"
    >
      <template #default="{ start, end }">
        <div
          v-for="(row, index) in rows.slice(start, end)"
          :key="row.node.path"
          class="change-row"
          :class="{
            active: selectedRows.includes(row.node.path),
            folder: row.node.children.length > 0,
          }"
          :style="{ paddingLeft: `${6 + row.depth * 16}px` }"
          :data-index="start + index"
          role="treeitem"
          :aria-level="row.depth + 1"
          :aria-posinset="row.position"
          :aria-setsize="row.siblings"
          :aria-expanded="row.node.children.length ? !collapsed.has(row.node.path) : undefined"
          :aria-selected="selectedRows.includes(row.node.path)"
          @click="selectNode(row.node, $event)"
          @dblclick="doubleClick(row.node)"
          @contextmenu.prevent.stop="openContext($event, row.node)"
        >
          <button
            v-if="row.node.children.length"
            class="tree-disclosure"
            tabindex="-1"
            :aria-label="$t(collapsed.has(row.node.path) ? 'changes.expand' : 'changes.collapse')"
            @click.stop="
              () => {
                selectNode(row.node)
                toggleFolder(row.node.path)
              }
            "
          >
            <el-icon
              ><ChevronRight v-if="collapsed.has(row.node.path)" /><ArrowDown v-else
            /></el-icon></button
          ><span v-else class="tree-disclosure"></span>
          <el-icon v-if="row.node.children.length || row.node.path === '.'" class="folder-icon"
            ><Folder v-if="collapsed.has(row.node.path)" /><FolderOpened v-else
          /></el-icon>
          <el-icon v-if="row.node.entry && !row.node.children.length" class="file-type-icon"
            ><component :is="fileIconName(row.node.path)"
          /></el-icon>
          <button
            class="tree-label"
            :title="row.node.path"
            :aria-label="row.node.path"
            @keydown="navigate($event, start + index)"
          >
            {{ row.node.label
            }}<small v-if="viewMode === 'compact'">{{
              row.node.path.slice(0, Math.max(0, row.node.path.lastIndexOf('/')))
            }}</small>
          </button>
          <span
            v-if="row.node.entry"
            class="tree-status"
            :class="statusClass(row.node.entry)"
            :title="statusLabel(row.node.entry)"
            >{{ statusCode(row.node.entry) }}</span
          >
          <span v-if="row.node.children.length" class="tree-count">{{
            row.node.targets.length
          }}</span>
          <div class="tree-row-actions">
            <button
              v-if="selectableTargets(row.node).length"
              :disabled="disabled"
              :title="$t(staged ? 'changes.unstage' : 'changes.stage')"
              :aria-label="$t(staged ? 'changes.unstage' : 'changes.stage')"
              @click.stop="
                () => {
                  selectNode(row.node)
                  toggleSelected()
                }
              "
            >
              <el-icon><Minus v-if="staged" /><Plus v-else /></el-icon>
            </button>
            <button
              :disabled="disabled || actionPending || !row.node.targets.length"
              :title="$t('fileMenu.discard')"
              :aria-label="$t('fileMenu.discard')"
              @click.stop="
                () => {
                  selectNode(row.node)
                  $emit('discard-targets', row.node.targets)
                }
              "
            >
              <el-icon><RefreshLeft /></el-icon>
            </button>
          </div>
        </div>
      </template>
    </VirtualViewport>
    <div v-else class="empty-tree">{{ emptyText }}</div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { fileIconName } from '@/utils/filePresentation'
import VirtualViewport from './VirtualViewport.vue'
import { buildChangeTree, flattenChangeTree, type ChangeNode } from '@/utils/changeTree'
import { changeTargets, selectChangeRows } from '@/utils/changeSelection'
import { getStatusClass, getStatusLabelKey } from '@/composables/useSvnStatus'
import type { SvnStatus } from '@/types'

const props = defineProps<{
  title: string
  total?: number
  entries: SvnStatus[]
  selectable: string[]
  staged: boolean
  workspaceKey: string
  filterKey: string
  selectedFile: string | null
  disabled: boolean
  actionPending: boolean
  emptyText: string
  active?: boolean
  viewMode?: 'tree' | 'list' | 'compact'
}>()
const emit = defineEmits<{
  select: [entry: SvnStatus]
  context: [
    event: MouseEvent,
    node: ChangeNode,
    staged: boolean,
    selection: { targets: string[]; count: number },
  ]
  'selection-change': [targets: string[], singleFile: boolean, staged: boolean]
  'copy-paths': [paths: string[], absolute: boolean]
  'discard-targets': [paths: string[]]
  'toggle-selection': [paths: string[]]
}>()
const { t } = useI18n()
const viewport = ref<InstanceType<typeof VirtualViewport> | null>(null)
const collapsed = ref(new Set<string>()),
  activePath = ref(''),
  selectedRows = ref<string[]>([]),
  anchor = ref<string | null>(null)
const tree = computed(() => {
  if (props.viewMode && props.viewMode !== 'tree')
    return props.entries.map((entry) => ({
      path: entry.path,
      label: props.viewMode === 'list' ? entry.path : entry.path.split('/').pop()!,
      entry,
      children: [],
      targets: [entry.path],
    }))
  return buildChangeTree(props.entries)
})
const rows = computed(() => flattenChangeTree(tree.value, collapsed.value))
const allowed = computed(() => new Set(props.selectable))
const selectableTargets = (node: ChangeNode) =>
  node.targets.filter((path) => allowed.value.has(path))
const batchTargets = computed(() =>
  props.entries.filter((entry) => allowed.value.has(entry.path)).map((entry) => entry.path)
)
const selectedTargets = computed(() => changeTargets(tree.value, selectedRows.value))
const selectedSelectable = computed(() =>
  selectedTargets.value.filter((path) => allowed.value.has(path))
)
let lastSelectedTargets: string[] = []
const storageKey = computed(
  () => `orcasvn-tree-folders:${props.workspaceKey}:${props.staged ? 'staged' : 'unstaged'}`
)
watch(
  storageKey,
  (key) => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) || '[]')
      collapsed.value = new Set(
        Array.isArray(saved) ? saved.filter((path): path is string => typeof path === 'string') : []
      )
    } catch {
      collapsed.value = new Set()
    }
    clearSelection()
  },
  { immediate: true }
)
watch(
  () => props.filterKey,
  () => {
    clearSelection()
    if (props.active) announceSelection()
  }
)
watch(
  () => props.viewMode,
  () => {
    const retained = new Set(lastSelectedTargets)
    selectedRows.value = rows.value
      .filter((row) => row.node.entry && retained.has(row.node.entry.path))
      .map((row) => row.node.path)
    anchor.value = selectedRows.value[0] || null
    if (props.active) announceSelection()
  }
)
watch(
  () => props.active,
  (active) => {
    if (active === false) clearSelection()
  }
)
watch(
  () => [props.selectedFile, props.active],
  () => {
    const path = props.selectedFile
    if (props.active && path && props.entries.some((entry) => entry.path === path)) {
      selectedRows.value = [path]
      anchor.value = path
      activePath.value = path
    }
  }
)
watch(
  () => rows.value.map((row) => row.node.path),
  (paths) => {
    const visible = new Set(paths)
    const retained = selectedRows.value.filter((path) => visible.has(path))
    if (retained.length !== selectedRows.value.length) {
      selectedRows.value = retained
      announceSelection()
    }
  }
)
function clearSelection() {
  selectedRows.value = []
  activePath.value = ''
  anchor.value = null
  lastSelectedTargets = []
}
function persist() {
  try {
    localStorage.setItem(storageKey.value, JSON.stringify([...collapsed.value]))
  } catch {
    /* Retain in memory. */
  }
}
function toggleFolder(path: string) {
  const next = new Set(collapsed.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  collapsed.value = next
  persist()
}
function setAllExpanded(expanded: boolean) {
  const folders: string[] = []
  const visit = (nodes: ChangeNode[]) => {
    for (const node of nodes) {
      if (node.children.length) folders.push(node.path)
      visit(node.children)
    }
  }
  visit(tree.value)
  collapsed.value = expanded ? new Set() : new Set(folders)
  persist()
}
function announceSelection() {
  lastSelectedTargets = [...selectedTargets.value]
  const node =
    selectedRows.value.length === 1
      ? rows.value.find((row) => row.node.path === selectedRows.value[0])?.node
      : undefined
  const single = Boolean(node?.entry && !node.children.length)
  emit('selection-change', selectedTargets.value, single, props.staged)
  if (single) emit('select', node!.entry!)
}
function selectNode(
  node: ChangeNode,
  event?: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>
) {
  const result = selectChangeRows(
    rows.value.map((row) => row.node.path),
    selectedRows.value,
    node.path,
    anchor.value,
    Boolean(event?.ctrlKey || event?.metaKey),
    Boolean(event?.shiftKey)
  )
  selectedRows.value = result.selected
  anchor.value = result.anchor
  activePath.value = node.path
  announceSelection()
}
function openContext(event: MouseEvent, node: ChangeNode) {
  if (!selectedRows.value.includes(node.path)) selectNode(node)
  emit('context', event, node, props.staged, {
    targets: [...selectedTargets.value],
    count: selectedRows.value.length,
  })
}
function doubleClick(node: ChangeNode) {
  if (node.children.length) toggleFolder(node.path)
  else toggleSelected()
}
function toggleSelected() {
  if (props.disabled || !selectedSelectable.value.length) return
  const paths = [...selectedSelectable.value]
  const removed = new Set(paths)
  let next: string | undefined
  for (let index = rows.value.length - 1; index >= 0; index--) {
    const path = rows.value[index].node.entry?.path
    if (!path) continue
    if (removed.has(path)) {
      if (next) break
    } else next = path
  }
  emit('toggle-selection', paths)
  void nextTick(() => {
    const row = rows.value.find((row) => row.node.entry?.path === next)
    if (row) {
      selectNode(row.node)
      void focusRow(rows.value.indexOf(row))
    } else {
      clearSelection()
      announceSelection()
    }
  })
}
const statusCode = (entry: SvnStatus) =>
  entry.prop_status === 'modified' && ['normal', 'none'].includes(entry.status_code)
    ? 'M'
    : {
        modified: 'M',
        added: 'A',
        deleted: 'D',
        replaced: 'R',
        unversioned: '?',
        missing: '!',
        conflicted: 'C',
      }[entry.status_code] || '•'
const statusClass = (entry: SvnStatus) =>
  getStatusClass(
    entry.prop_status === 'conflicted'
      ? 'conflicted'
      : entry.prop_status === 'modified' && ['normal', 'none'].includes(entry.status_code)
        ? 'modified'
        : entry.status_code
  )
const statusLabel = (entry: SvnStatus) =>
  t(
    getStatusLabelKey(
      entry.prop_status === 'conflicted'
        ? 'conflicted'
        : entry.prop_status === 'modified' && ['normal', 'none'].includes(entry.status_code)
          ? 'modified'
          : entry.status_code
    )
  )
async function focusRow(
  index: number,
  event?: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>
) {
  const row = rows.value[index]
  if (!row) return
  selectNode(row.node, event)
  viewport.value?.scrollToIndex(index)
  await nextTick()
  viewport.value?.element
    ?.querySelector<HTMLButtonElement>(`.change-row[data-index="${index}"] .tree-label`)
    ?.focus()
}
function navigate(event: KeyboardEvent, index: number) {
  const row = rows.value[index]
  if (!row) return
  const command = event.ctrlKey || event.metaKey
  if (command && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    selectedRows.value = rows.value.map((row) => row.node.path)
    announceSelection()
  } else if (command && (event.key.toLowerCase() === 'c' || event.code === 'KeyC')) {
    event.preventDefault()
    event.stopPropagation?.()
    const single =
      selectedRows.value.length === 1
        ? rows.value.find((row) => row.node.path === selectedRows.value[0])?.node
        : undefined
    emit(
      'copy-paths',
      single?.children.length ? [single.path] : selectedTargets.value,
      event.shiftKey || event.altKey
    )
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    void focusRow(index + 1, event)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    void focusRow(index - 1, event)
  } else if (event.key === 'Home') {
    event.preventDefault()
    void focusRow(0, event)
  } else if (event.key === 'End') {
    event.preventDefault()
    void focusRow(rows.value.length - 1, event)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    if (row.node.children.length) {
      if (collapsed.value.has(row.node.path)) toggleFolder(row.node.path)
      else void focusRow(index + 1)
    }
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    if (row.node.children.length && !collapsed.value.has(row.node.path)) toggleFolder(row.node.path)
    else if (row.parent)
      void focusRow(rows.value.findIndex((candidate) => candidate.node.path === row.parent))
  } else if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault()
    if (!selectedRows.value.includes(row.node.path)) selectNode(row.node)
    toggleSelected()
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    if (!props.disabled && !props.actionPending) {
      if (!selectedRows.value.includes(row.node.path)) selectNode(row.node)
      emit('discard-targets', selectedTargets.value)
    }
  }
}
defineExpose({ clearSelection })
</script>

<style scoped>
.change-tree-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--md-sys-color-surface-container-lowest);
}
.change-tree-panel > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  min-height: 28px;
  padding: 0 7px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  gap: 4px;
  background: var(--md-sys-color-surface-container);
  font-size: 12px;
}
.change-tree-panel > header strong {
  white-space: nowrap;
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant);
}
.tree-tools {
  display: flex;
  gap: 1px;
  align-items: center;
}
.tree-tools button,
.tree-row-actions button {
  background: transparent;
  color: inherit;
  border: 0;
  border-radius: 3px;
  padding: 1px 5px;
  cursor: pointer;
  font-size: 16px;
  min-width: 24px;
}
.tree-tools button:disabled,
.tree-row-actions button:disabled {
  opacity: 0.35;
  cursor: default;
}
.tree-tools button:hover:not(:disabled) {
  background: var(--md-sys-state-hover);
}
.change-row {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  height: 26px;
  gap: 4px;
  padding-right: 5px;
  cursor: default;
  font-size: 12px;
}
.change-row:hover {
  background: var(--md-sys-state-hover);
}
.change-row.active {
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}
.tree-disclosure {
  flex: 0 0 14px;
  width: 14px;
  border: 0;
  background: none;
  color: inherit;
  padding: 0;
  cursor: pointer;
}
.folder-icon {
  color: #cca642;
  font-size: 15px;
  flex-shrink: 0;
}
.tree-label {
  flex: 1;
  min-width: 0;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  text-align: left;
  border: 0;
  background: none;
  color: inherit;
  padding: 2px 0;
  font: inherit;
  cursor: default;
}
.tree-label small {
  margin-left: 7px;
  opacity: 0.6;
  font: inherit;
}
.tree-label:focus-visible {
  outline: none;
}
.change-row:focus-within {
  box-shadow: inset 0 0 0 1px var(--md-sys-color-primary);
}
.tree-count {
  opacity: 0.6;
  font-size: 10px;
}
.tree-status {
  font-size: 10px;
  font-weight: 700;
  border-radius: 2px;
  min-width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.status-modified,
.status-replaced {
  background: #c29927;
  color: #fff;
}
.status-added {
  background: #2b9155;
  color: #fff;
}
.status-unversioned {
  background: #507daf;
  color: #fff;
}
.status-deleted,
.status-missing,
.status-conflicted,
.status-obstructed {
  background: #ac4f48;
  color: #fff;
}
.tree-row-actions {
  display: flex;
  gap: 1px;
  opacity: 0;
  flex-shrink: 0;
}
.change-row:hover .tree-row-actions,
.change-row:focus-within .tree-row-actions {
  opacity: 1;
}
.tree-row-actions button {
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 22px;
  padding: 1px 3px;
}
.tree-row-actions button:hover {
  background: var(--md-sys-color-surface-container-highest);
}
.empty-tree {
  padding: 18px 8px;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 12px;
  text-align: center;
}
</style>
