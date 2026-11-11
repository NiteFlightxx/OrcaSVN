<template>
  <section class="asset-stashes">
    <header class="stash-toolbar">
      <strong
        >{{ $t('menu.stash') }} <small>{{ records.length }}</small></strong
      >
      <div class="actions">
        <el-button
          :disabled="flow.busy || !workspace.currentPath || !flow.identity"
          @click="openCreate"
          ><el-icon><Plus /></el-icon>{{ $t('flow.createStash') }}</el-button
        ><el-dropdown trigger="click"
          ><button
            class="quiet-icon"
            :title="$t('common.action')"
            :aria-label="$t('common.action')"
          >
            <el-icon><MoreFilled /></el-icon></button
          ><template #dropdown
            ><el-dropdown-menu
              ><el-dropdown-item :disabled="flow.busy" @click="importStash"
                ><el-icon><Download /></el-icon>{{ $t('flow.import') }}</el-dropdown-item
              ><el-dropdown-item :disabled="flow.busy" @click="legacyOpen = true">{{
                $t('experience.legacy')
              }}</el-dropdown-item
              ><el-dropdown-item
                v-if="legacyStore.entries.length"
                :disabled="flow.busy"
                @click="migrate"
                >{{ $t('experience.migrate') }}</el-dropdown-item
              ></el-dropdown-menu
            ></template
          ></el-dropdown
        >
      </div>
    </header>
    <p v-if="flow.error" class="error">{{ flow.error }}</p>
    <div
      class="stash-workbench"
      :style="{ gridTemplateColumns: `${stashWidth}px 4px minmax(0,1fr)` }"
    >
      <aside class="stash-browser">
        <input v-model="search" type="search" :placeholder="$t('experience.searchStashes')" />
        <div class="stash-records">
          <button
            v-for="entry in records"
            :key="entry.key"
            class="stash-choice"
            :class="{ active: selectedKey === entry.key }"
            @click="choose(entry.key)"
            @contextmenu.prevent="openMenu($event, entry.key)"
          >
            <strong>{{ entry.name }}</strong
            ><small
              >{{ entry.kind === 'legacy' ? $t('experience.legacy') : $t('experience.full') }} ·
              {{ entry.count }}</small
            ><small>{{ entry.branch }}</small>
          </button>
        </div>
        <div v-if="selected" class="stash-files">
          <el-tree
            default-expand-all
            :data="nodeTree"
            node-key="path"
            :props="{ label: 'label', children: 'children' }"
            :expand-on-click-node="false"
            @node-click="
              (node: ChangeNode) => {
                if (node.entry) previewNode(node.path)
              }
            "
          />
        </div>
      </aside>
      <PanelSplitter
        axis="x"
        v-model:value="stashWidth"
        :min="240"
        :max="600"
        :label="$t('sourceUI.resizeChanges')"
      />
      <main class="stash-inspector">
        <div class="actions">
          <template v-if="selected"
            ><el-button :disabled="flow.busy" @click="restore(selected, false)">{{
              $t('flow.applyStash')
            }}</el-button
            ><el-button :disabled="flow.busy" @click="restore(selected, true)">{{
              $t('flow.pop')
            }}</el-button
            ><el-button :disabled="flow.busy" @click="exportStash(selected)">{{
              $t('flow.export')
            }}</el-button
            ><el-button :disabled="flow.busy" @click="remove(selected)">{{
              $t('flow.delete')
            }}</el-button></template
          ><el-button v-if="selectedLegacy" :disabled="flow.busy" @click="migrate">{{
            $t('experience.migrate')
          }}</el-button>
        </div>
        <p v-if="selected?.warning" class="error">{{ selected.warning }}</p>
        <p v-if="selectedLegacy" class="legacy-hint">{{ $t('experience.legacyHint') }}</p>
        <DiffViewer v-if="selectedLegacy" :text="selectedLegacy.patch" compact />
        <template v-else-if="filePreview"
          ><div class="preview-heading">
            <code>{{ filePreview.path }}</code
            ><small>{{ size(filePreview.size) }}</small>
          </div>
          <DiffViewer
            v-if="filePreview.base !== null && filePreview.working !== null"
            :text="snapshotDiff(filePreview.base, filePreview.working)"
            compact
          />
          <p v-else>{{ $t('experience.binary') }} · {{ size(filePreview.size) }}</p></template
        >
        <p v-else>{{ $t('experience.noSelection') }}</p>
      </main>
    </div>
    <FileContextMenu
      v-if="menu.visible"
      :x="menu.x"
      :y="menu.y"
      :items="menuItems"
      @action="menuAction"
      @close="menu.visible = false"
    />
    <el-dialog
      v-model="legacyOpen"
      :title="$t('experience.legacy')"
      width="min(1080px,96vw)"
      destroy-on-close
      ><LegacyStashTools
    /></el-dialog>
    <el-dialog
      v-model="creatingDialog"
      :title="$t('flow.createStash')"
      width="min(760px, 94vw)"
      class="stash-create-dialog"
      :close-on-click-modal="false"
    >
      <p v-if="!inspecting" class="stash-scope-hint">
        {{ $t('flow.stashScopeHint', { count: preview.length }) }}
      </p>
      <p v-if="inspecting" role="status">{{ $t('common.loading') }}</p>
      <el-table
        :data="preview"
        max-height="280"
        class="stash-scope-list"
        :empty-text="inspecting ? $t('common.loading') : $t('flow.stashNoChanges')"
      >
        <el-table-column
          prop="path"
          :label="$t('flow.files')"
          min-width="240"
          show-overflow-tooltip
        />
        <el-table-column prop="status" :label="$t('flow.state')" width="110" />
      </el-table>
      <el-input
        v-model="name"
        :placeholder="$t('flow.name')"
        :aria-label="$t('flow.name')"
        maxlength="120"
        class="stash-name-input"
      />
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <el-button
        v-if="error && files.length"
        :loading="inspecting"
        :disabled="flow.busy || !contextMatches()"
        @click="inspect"
        >{{ $t('common.retry') }}</el-button
      >
      <template #footer
        ><el-button :disabled="flow.busy" @click="creatingDialog = false">{{
          $t('common.cancel')
        }}</el-button
        ><el-button
          type="primary"
          :loading="flow.busy"
          :disabled="!canCreate || !name.trim()"
          @click="create"
          >{{ $t('flow.saveHide') }}</el-button
        ></template
      >
    </el-dialog>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import LegacyStashTools from './LegacyStashTools.vue'
import DiffViewer from './DiffViewer.vue'
import PanelSplitter from './PanelSplitter.vue'
import FileContextMenu from './FileContextMenu.vue'
import { buildChangeTree, type ChangeNode } from '@/utils/changeTree'
import { readPanelSize } from '@/utils/changeSelection'
import { snapshotDiff } from '@/utils/diffPairs'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { open } from '@tauri-apps/plugin-dialog'
import { useWorkflowStore } from '@/stores/workflows'
import { useStashStore } from '@/stores/stash'
import { useWorkspaceStore } from '@/stores/workspace'
import {
  assetStashCandidates,
  assetStashCreate,
  assetStashCheck,
  assetStashApply,
  assetStashDelete,
  assetStashExport,
  assetStashImport,
  assetStashMigrate,
  assetStashPreview,
  type AssetStash,
  type AssetNode,
} from '@/api/workflows'
const flow = useWorkflowStore(),
  workspace = useWorkspaceStore(),
  route = useRoute(),
  router = useRouter(),
  { t } = useI18n()
const legacyStore = useStashStore()
const legacyOpen = ref(false)
const search = ref(''),
  selectedKey = ref(''),
  stashWidth = ref(readPanelSize('orcasvn-stash-width', 330, 240, 600)),
  menu = ref({ visible: false, x: 0, y: 0 })
watch(stashWidth, (value) => {
  try {
    localStorage.setItem('orcasvn-stash-width', String(value))
  } catch {}
})
const selectedLegacy = computed(
  () => legacyStore.entries.find((entry) => 'legacy:' + entry.id === selectedKey.value) || null
)
const records = computed(() =>
  [
    ...flow.stashes.map((entry) => ({
      key: 'full:' + entry.id,
      name: entry.name,
      kind: 'full',
      count: entry.nodes.length,
      branch: entry.identity.url,
    })),
    ...legacyStore.currentEntries(workspace.currentPath).map((entry) => ({
      key: 'legacy:' + entry.id,
      name: entry.name,
      kind: 'legacy',
      count: entry.files.length,
      branch: entry.workspacePath,
    })),
  ].filter((entry) =>
    `${entry.name} ${entry.branch}`.toLowerCase().includes(search.value.toLowerCase())
  )
)
const nodeTree = computed(() => {
  const nodes = buildChangeTree(
    (selected.value?.nodes || []).map((node) => ({
      path: node.path,
      status: node.status,
      status_code: node.status,
      prop_status: 'none',
      locked: false,
      history: false,
      switched: false,
    }))
  )
  return nodes.flatMap((node) => (node.path === '.' && !node.entry ? node.children : [node]))
})
function choose(key: string) {
  selectedKey.value = key
  selected.value = flow.stashes.find((entry) => 'full:' + entry.id === key) || null
}
function openMenu(event: MouseEvent, key: string) {
  choose(key)
  menu.value = { visible: true, x: event.clientX, y: event.clientY }
}
const menuItems = computed(() =>
  selectedLegacy.value
    ? [{ id: 'migrate', label: t('experience.migrate'), disabled: flow.busy }]
    : [
        { id: 'apply', label: t('flow.applyStash'), disabled: flow.busy },
        { id: 'pop', label: t('flow.pop'), disabled: flow.busy },
        { id: 'export', label: t('flow.export'), disabled: flow.busy },
        { id: 'remove', label: t('flow.delete'), disabled: flow.busy, separator: true },
      ]
)
async function menuAction(action: string) {
  menu.value.visible = false
  if (flow.busy) return
  if (action === 'migrate') return migrate()
  const entry = selected.value
  if (!entry) return
  if (action === 'apply' || action === 'pop') await restore(entry, action === 'pop')
  if (action === 'export') await exportStash(entry)
  if (action === 'remove') await remove(entry)
}

const selected = ref<AssetStash | null>(null),
  creatingDialog = ref(false),
  inspecting = ref(false),
  preview = ref<AssetNode[]>([]),
  files = ref<string[]>([]),
  name = ref(''),
  error = ref('')
const creationContext = ref<{ path: string; url: string } | null>(null)
const contextMatches = () =>
  creationContext.value?.path === workspace.currentPath &&
  creationContext.value?.url === flow.identity?.url
const canCreate = computed(
  () => contextMatches() && !inspecting.value && !flow.busy && preview.value.length > 0
)
const filePreview = ref<Awaited<ReturnType<typeof assetStashPreview>> | null>(null)
let previewGeneration = 0
let inspectionGeneration = 0
async function previewNode(path: string) {
  const id = selected.value?.id,
    request = ++previewGeneration
  if (!id) return
  try {
    const result = await assetStashPreview(id, path)
    if (request === previewGeneration && selected.value?.id === id) filePreview.value = result
  } catch (e) {
    ElMessage.error(String(e))
  }
}
watch(
  () => selected.value?.id,
  () => {
    previewGeneration++
    filePreview.value = null
  }
)
const choices = computed(() =>
  workspace.statusList.filter(
    (s) =>
      ['modified', 'added', 'deleted', 'unversioned'].includes(s.status_code) ||
      s.prop_status === 'modified'
  )
)
const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KiB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MiB`
function select(rows: { path: string }[]) {
  inspectionGeneration++
  inspecting.value = false
  files.value = rows.map((r) => r.path)
  preview.value = []
  error.value = ''
}
function startCreate(requested: string[]) {
  if (flow.busy || !workspace.currentPath || !flow.identity?.url) return
  select([...new Set(requested.filter((path) => path.trim()))].map((path) => ({ path })))
  creationContext.value = { path: workspace.currentPath, url: flow.identity.url }
  name.value = `WIP ${new Date().toLocaleString()}`
  creatingDialog.value = true
  if (files.value.length) void inspect()
  else error.value = t('flow.stashNoChanges')
}
function openCreate() {
  startCreate(choices.value.map((entry) => entry.path))
}
async function inspect() {
  const path = workspace.currentPath,
    request = ++inspectionGeneration,
    selection = [...files.value]
  if (!path || !files.value.length || !contextMatches()) return
  const url = creationContext.value?.url
  inspecting.value = true
  try {
    const result = await assetStashCandidates(path, selection)
    if (
      request === inspectionGeneration &&
      path === workspace.currentPath &&
      url === flow.identity?.url
    ) {
      preview.value = result
      error.value = result.length ? '' : t('flow.stashNoChanges')
    }
  } catch (e) {
    if (request === inspectionGeneration) {
      error.value = String(e)
      preview.value = []
    }
  } finally {
    if (request === inspectionGeneration) inspecting.value = false
  }
}
async function create() {
  const path = workspace.currentPath,
    url = flow.identity?.url
  if (!path || !url || !canCreate.value || !name.value.trim()) return
  const selection = [...files.value]
  const stashName = name.value
  try {
    const entry = await flow.perform(t('flow.createStash'), () =>
      assetStashCreate(path, stashName, selection, url)
    )
    selected.value = entry
    selectedKey.value = 'full:' + entry.id
    creatingDialog.value = false
    if (entry.warning) ElMessage.warning(entry.warning)
  } catch (e) {
    error.value = String(e)
  }
}
async function restore(entry: AssetStash, pop: boolean) {
  const path = workspace.currentPath
  if (!path) return
  try {
    await ElMessageBox.confirm(
      `${entry.name}\n${entry.identity.url || t('flow.unknown')}\n→ ${path}\n${entry.legacy ? entry.warning || '' : ''}\n${t('flow.restoreConfirm')}`,
      pop ? t('flow.pop') : t('flow.applyStash'),
      { type: 'warning' }
    )
    const collisions = await assetStashCheck(path, entry.id)
    if (collisions.length)
      await ElMessageBox.confirm(
        `${t('flow.overwriteConfirm')}\n${collisions.map((c) => c.path).join('\n')}`,
        t('flow.warning'),
        { type: 'warning' }
      )
    const result = await flow.perform(pop ? t('flow.pop') : t('flow.applyStash'), () =>
      assetStashApply(path, entry.id, pop, collisions)
    )
    selected.value = pop && result.phase === 'popped' ? null : result
    if (!selected.value) selectedKey.value = ''
    if (result.warning) ElMessage.warning(result.warning)
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(String(e))
  }
}
async function remove(entry: AssetStash) {
  try {
    await ElMessageBox.confirm(t('flow.deleteConfirm'), entry.name, { type: 'warning' })
    await flow.perform(t('flow.delete'), () => assetStashDelete(entry.id))
    if (selected.value?.id === entry.id) selected.value = null
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(String(e))
  }
}
async function exportStash(entry: AssetStash) {
  try {
    const destination = await open({ directory: true, title: t('flow.exportHint') })
    if (typeof destination === 'string')
      await flow.perform(t('flow.export'), () => assetStashExport(entry.id, destination), false)
  } catch (e) {
    ElMessage.error(String(e))
  }
}
async function importStash() {
  try {
    const source = await open({ directory: true, title: t('flow.importHint') })
    if (typeof source === 'string') {
      const entry = await flow.perform(t('flow.import'), () => assetStashImport(source))
      selected.value = entry
    }
  } catch (e) {
    ElMessage.error(String(e))
  }
}
async function migrate() {
  try {
    const ids = await flow.perform(t('flow.migrate'), () =>
      assetStashMigrate(selectedLegacy.value ? [selectedLegacy.value] : [...legacyStore.entries])
    )
    for (const id of ids) legacyStore.removeEntry(id)
    selectedKey.value = ''
    selected.value = null
  } catch (e) {
    ElMessage.error(String(e))
  }
}
watch(
  [() => route.query.id, () => flow.stashes],
  ([id]) => {
    if (typeof id === 'string') choose('full:' + id)
    else if (selectedKey.value.startsWith('full:')) choose(selectedKey.value)
  },
  { immediate: true }
)
watch([() => workspace.currentPath, () => flow.identity?.url], () => {
  inspectionGeneration++
  inspecting.value = false
  creatingDialog.value = false
  creationContext.value = null
  selected.value = null
  selectedKey.value = ''
  menu.value.visible = false
  preview.value = []
  files.value = []
})
watch(
  [
    () => route.query.file,
    () => route.query.files,
    () => workspace.currentPath,
    () => flow.identity?.url,
    () => flow.busy,
  ],
  () => {
    const file = route.query.file,
      requested = route.query.files
    if (
      (file === undefined && requested === undefined) ||
      !workspace.currentPath ||
      !flow.identity?.url ||
      flow.busy
    )
      return
    const paths = Array.isArray(requested)
      ? requested.filter((value): value is string => typeof value === 'string')
      : typeof requested === 'string'
        ? [requested]
        : typeof file === 'string'
          ? [file]
          : []
    const sameWorkspace =
      !route.query.stashWorkspace || route.query.stashWorkspace === workspace.currentPath
    const sameBranch = !route.query.stashBranch || route.query.stashBranch === flow.identity?.url
    if (sameWorkspace && sameBranch) startCreate(paths)
    else ElMessage.error(t('fileMenu.changed'))
    const query = { ...route.query }
    delete query.file
    delete query.files
    delete query.stashWorkspace
    delete query.stashBranch
    void router.replace({ query })
  },
  { immediate: true }
)
watch(creatingDialog, (open) => {
  if (!open) {
    inspectionGeneration++
    inspecting.value = false
    preview.value = []
    files.value = []
    creationContext.value = null
  }
})
</script>
<style scoped>
.stash-scope-hint {
  margin-bottom: 12px;
  color: var(--md-sys-color-on-surface-variant);
}
.stash-name-input {
  margin-top: 14px;
}
.asset-stashes {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 0 !important;
  overflow: hidden;
}
.asset-stashes > header {
  padding: 6px 10px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  flex-shrink: 0;
}
.asset-stashes > header p {
  margin: 3px 0;
}
.stash-workbench {
  display: grid;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.stash-browser {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--md-sys-color-surface-container-lowest);
}
.stash-browser > input {
  margin: 6px;
  padding: 5px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 12px;
  background: transparent;
  font-size: 12px;
}
.stash-records {
  flex: 1;
  overflow: auto;
  min-height: 100px;
}
.stash-choice {
  display: block;
  width: 100%;
  padding: 8px;
  border: 0;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.stash-choice.active {
  background: var(--md-sys-color-primary-container);
}
.stash-choice small {
  display: block;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stash-files {
  height: 45%;
  overflow: auto;
  border-top: 1px solid var(--md-sys-color-outline-variant);
}
.stash-inspector {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 6px;
  overflow: hidden;
}
.stash-inspector > .actions {
  padding: 4px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  min-height: 28px;
  flex-shrink: 0;
}
.preview-heading {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 8px;
  font-size: 12px;
}
.preview-heading code {
  overflow-wrap: anywhere;
}
.legacy-hint {
  font-size: 12px;
}

.node-line {
  width: 100%;
  border: 0;
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.asset-preview {
  display: flex;
  gap: 12px;
  padding: 12px;
}
.asset-preview article {
  flex: 1;
  min-width: 0;
}
.asset-preview pre,
.stash-details pre {
  white-space: pre-wrap;
  max-height: 300px;
  overflow: auto;
  font-size: 12px;
}
.asset-stashes {
  padding: 16px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}
header,
.stash-record,
.node-line {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
header p {
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
  max-width: 600px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.stash-record {
  border-top: 1px solid var(--md-sys-color-outline-variant);
  padding: 12px 0;
  cursor: pointer;
}
.stash-record.selected {
  background: var(--md-sys-color-surface-container);
}
.stash-record small {
  display: block;
  font-size: 11px;
  overflow-wrap: anywhere;
}
.stash-details {
  max-height: 240px;
  overflow: auto;
  padding: 12px;
  background: var(--md-sys-color-surface-container);
  font-size: 12px;
  margin-top: 12px;
}
.node-line {
  padding: 4px;
  overflow-wrap: anywhere;
}
.error {
  color: var(--md-sys-color-error);
  white-space: pre-wrap;
}
@media (max-width: 1000px) {
  header,
  .stash-record {
    flex-direction: column;
  }
}
</style>
