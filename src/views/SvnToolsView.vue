<template>
  <main class="svn-tools">
    <header>
      <h1>{{ t('svnTools.title') }}</h1>
      <code v-if="workspace.currentPath">{{ workspace.currentPath }}</code>
    </header>
    <el-empty v-if="!workspace.currentPath" :description="t('workspace.noWorkspace')" />
    <template v-else>
      <div class="tool-tabs" role="group" :aria-label="t('svnTools.title')">
        <button v-for="tab in tabs" :key="tab" :aria-pressed="section === tab" :disabled="busy"
          @click="section = tab">{{ t('svnTools.' + tab) }}</button>
      </div>

      <section v-if="section === 'browse'" aria-labelledby="repository-browser-title">
        <h2 id="repository-browser-title">{{ t('svnTools.browse') }}</h2>
        <form class="inline" @submit.prevent="browse(address)">
          <el-input v-model="address" :aria-label="t('svnTools.url')" :disabled="busy" />
          <el-button native-type="submit" :loading="busy" :disabled="!address.trim()">{{ t('svnTools.load') }}</el-button>
          <el-button :disabled="busy || !parentUrl" @click="browse(parentUrl)">{{ t('svnTools.parent') }}</el-button>
        </form>
        <div v-if="listed" class="repo-entries">
          <p v-if="!entries.length">{{ t('svnTools.emptyDirectory') }}</p>
          <div v-for="entry in entries" :key="entry.url" class="repo-entry">
            <button v-if="entry.kind === 'dir'" class="directory-link" :disabled="busy" @click="browse(entry.url)">{{ entry.name }}/</button>
            <code v-else>{{ entry.name }}</code>
            <button class="entry-action" :disabled="busy" @click="exportEntry(entry)">{{ t('svnTools.export') }}</button>
          </div>
        </div>
      </section>

      <section v-else aria-labelledby="svn-action-title">
        <h2 id="svn-action-title">{{ t('svnTools.' + section) }}</h2>
        <form @submit.prevent="execute">
          <label class="field">
            <span>{{ t('svnTools.action') }}</span>
            <select v-model="kind" :disabled="busy || flow.busy">
              <option v-for="option in choices" :key="option" :value="option">{{ t('svnTools.' + option) }}</option>
            </select>
          </label>
          <div v-if="needsTarget" class="field">
            <label>
              <span>{{ t('svnTools.relativePath') }}</span>
              <el-input v-model="target" :disabled="busy || flow.busy" />
            </label>
            <div v-if="kind !== 'mkdir'" class="inline picker">
              <el-button :disabled="busy || flow.busy" @click="chooseTarget(false)">{{ t('svnTools.chooseFile') }}</el-button>
              <el-button :disabled="busy || flow.busy" @click="chooseTarget(true)">{{ t('svnTools.chooseDirectory') }}</el-button>
            </div>
          </div>
          <label v-if="needsName" class="field">
            <span>{{ t(kind === 'changelist' ? 'svnTools.changelistName' : 'svnTools.propertyName') }}</span>
            <el-input v-model="name" :disabled="busy || flow.busy" />
          </label>
          <label v-if="kind === 'setProperty'" class="field">
            <span>{{ t('svnTools.propertyValue') }}</span>
            <el-input v-model="value" type="textarea" :rows="3" :disabled="busy || flow.busy" />
          </label>
          <div v-if="needsSource" class="field">
            <label>
              <span>{{ t(kind === 'mergeinfo' || kind === 'branchMerge' ? 'svnTools.url' : 'svnTools.source') }}</span>
              <el-input v-model="source" :disabled="busy || flow.busy" />
            </label>
            <div v-if="kind === 'import' || kind === 'patch'" class="inline picker">
              <el-button :disabled="busy" @click="chooseSource(false)">{{ t('svnTools.chooseFile') }}</el-button>
              <el-button v-if="kind === 'import'" :disabled="busy" @click="chooseSource(true)">{{ t('svnTools.chooseDirectory') }}</el-button>
            </div>
          </div>
          <label v-if="needsDestination" class="field">
            <span>{{ t(destinationLabel) }}</span>
            <el-input v-model="destination" :disabled="busy || flow.busy" />
          </label>
          <el-button v-if="kind === 'export'" :disabled="busy" @click="chooseExport">{{ t('svnTools.chooseDestination') }}</el-button>
          <label v-if="kind === 'export'" class="field">
            <span>{{ t('svnTools.revision') }}</span>
            <el-input v-model="revision" :disabled="busy || flow.busy" :placeholder="t('svnTools.defaultRevision')" />
          </label>
          <label v-if="needsMessage" class="field">
            <span>{{ t(kind === 'lock' ? 'svnTools.lockMessage' : 'svnTools.commitMessage') }}</span>
            <el-input v-model="message" type="textarea" :rows="2" :disabled="busy || flow.busy" />
          </label>
          <label v-if="kind === 'patch'" class="checkbox">
            <input v-model="reverse" type="checkbox" :disabled="busy" /> {{ t('svnTools.reverse') }}
          </label>
          <p v-if="kind === 'delete'" class="note">{{ t('svnTools.keepLocal') }}</p>
          <p v-if="kind === 'cleanup'" class="note">{{ t('svnTools.cleanupHint') }}</p>
          <p v-if="remoteWrite" class="note">{{ t('svnTools.immediateRevision') }}</p>
          <el-button type="primary" native-type="submit" :loading="busy" :disabled="!canRun">{{ t('svnTools.' + kind) }}</el-button>
        </form>
      </section>

      <el-alert v-if="error" class="result" type="error" :closable="false" :title="error" show-icon />
      <pre v-if="output" class="result output" aria-live="polite">{{ output }}</pre>
    </template>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { open, save } from '@tauri-apps/plugin-dialog'
import { ElMessageBox } from 'element-plus'
import { svnWorkspaceAction, type SvnWorkspaceAction } from '@/api/svn'
import { repositoryBranchMergePreview, repositoryList, type RepositoryEntry } from '@/api/workflows'
import { useWorkspaceStore } from '@/stores/workspace'
import { useWorkflowStore } from '@/stores/workflows'
import { invalidateAllHistorySnapshots } from '@/utils/historyCache'
import { toWorkspaceRelativePath } from '@/utils/workspacePath'

type Kind = SvnWorkspaceAction['kind'] | 'branchMerge'
const tabs = ['working', 'browse', 'transfer'] as const
type Tab = (typeof tabs)[number]
const groups: Record<'working' | 'transfer', Kind[]> = {
  working: ['info', 'properties', 'remoteStatus', 'add', 'delete', 'move', 'copy', 'mkdir', 'lock', 'unlock',
    'setProperty', 'deleteProperty', 'changelist', 'removeChangelist', 'cleanup'],
  transfer: ['export', 'import', 'remoteMkdir', 'patch', 'mergeinfo', 'branchMerge'],
}

const route = useRoute()
const { t } = useI18n()
const workspace = useWorkspaceStore()
const flow = useWorkflowStore()
const section = ref<Tab>('working')
const kind = ref<Kind>('info')
const target = ref('.')
const name = ref('')
const value = ref('')
const source = ref('.')
const destination = ref('')
const revision = ref('')
const message = ref('')
const reverse = ref(false)
const address = ref('')
const entries = ref<RepositoryEntry[]>([])
const listed = ref(false)
const busy = ref(false)
const error = ref('')
const output = ref('')
let generation = 0
onBeforeUnmount(() => { generation++ })

const choices = computed(() => groups[section.value === 'transfer' ? 'transfer' : 'working'])
const needsTarget = computed(() => groups.working.includes(kind.value) && kind.value !== 'cleanup')
const needsName = computed(() => ['setProperty', 'deleteProperty', 'changelist'].includes(kind.value))
const needsSource = computed(() => ['export', 'import', 'patch', 'mergeinfo', 'branchMerge'].includes(kind.value))
const needsDestination = computed(() => ['move', 'copy', 'export', 'import', 'remoteMkdir'].includes(kind.value))
const needsMessage = computed(() => ['lock', 'import', 'remoteMkdir'].includes(kind.value))
const remoteWrite = computed(() => kind.value === 'import' || kind.value === 'remoteMkdir')
const destinationLabel = computed(() => remoteWrite.value ? 'svnTools.url' : kind.value === 'export'
  ? 'svnTools.exportPath' : 'svnTools.destination')
const canRun = computed(() => Boolean(workspace.currentPath && workspace.svnInfo?.url) &&
  !busy.value && !flow.busy && (!needsTarget.value || !!target.value.trim()) &&
  (!needsName.value || !!name.value.trim()) && (!needsSource.value || !!source.value.trim()) &&
  (!needsDestination.value || !!destination.value.trim()) && (!remoteWrite.value || !!message.value.trim()) &&
  (kind.value !== 'export' || !revision.value.trim() || /^\d+$/.test(revision.value.trim()) &&
    Number.isSafeInteger(Number(revision.value))))
const parentUrl = computed(() => {
  const root = workspace.svnInfo?.repository_root?.replace(/\/+$/, '') || ''
  const current = address.value.replace(/\/+$/, '')
  if (!root || !current.startsWith(root + '/')) return ''
  return current.slice(0, current.lastIndexOf('/'))
})

watch([() => workspace.currentPath, () => workspace.svnInfo?.url, () => route.query.path], () => {
  generation++
  target.value = typeof route.query.path === 'string' ? route.query.path : '.'
  source.value = target.value
  address.value = workspace.svnInfo?.url || ''
  destination.value = ''
  revision.value = ''
  name.value = ''
  value.value = ''
  message.value = ''
  reverse.value = false
  entries.value = []
  listed.value = false
  busy.value = false
  output.value = ''
  error.value = ''
}, { immediate: true })

watch(section, tab => {
  if (tab !== 'browse') kind.value = groups[tab][0]
  if (tab === 'browse' && !listed.value && address.value) void browse(address.value)
})
watch(kind, () => { error.value = ''; output.value = '' })

function buildAction(): SvnWorkspaceAction | { kind: 'branchMerge'; source: string } {
  const file = target.value.trim()
  const from = source.value.trim()
  const to = destination.value.trim()
  const property = name.value.trim()
  switch (kind.value) {
    case 'copy': case 'move': return { kind: kind.value, target: file, destination: to }
    case 'lock': return { kind: 'lock', target: file, message: message.value }
    case 'setProperty': return { kind: 'setProperty', target: file, name: property, value: value.value }
    case 'deleteProperty': case 'changelist': return { kind: kind.value, target: file, name: property }
    case 'cleanup': return { kind: 'cleanup' }
    case 'export': return { kind: 'export', source: from, destination: to, revision: revision.value.trim() ? Number(revision.value) : undefined }
    case 'import': return { kind: 'import', source: from, destination: to, message: message.value }
    case 'remoteMkdir': return { kind: 'remoteMkdir', destination: to, message: message.value }
    case 'patch': return { kind: 'patch', source: from, reverse: reverse.value }
    case 'mergeinfo': return { kind: 'mergeinfo', source: from }
    case 'branchMerge': return { kind: 'branchMerge', source: from }
    default: return { kind: kind.value, target: file }
  }
}

async function browse(url: string) {
  const path = workspace.currentPath
  if (!path || !url.trim() || busy.value) return
  const request = generation
  error.value = ''
  output.value = ''
  address.value = url.trim()
  entries.value = []
  listed.value = false
  busy.value = true
  try {
    const result = await repositoryList(path, address.value)
    if (request === generation) {
      entries.value = result
      listed.value = true
    }
  } catch (problem) {
    if (request === generation) error.value = String(problem)
  } finally {
    if (request === generation) busy.value = false
  }
}

function exportEntry(entry: RepositoryEntry) {
  source.value = entry.url
  destination.value = ''
  section.value = 'transfer'
}

async function chooseSource(directory: boolean) {
  const request = generation
  try {
    const result = await open({ directory, multiple: false, title: t('svnTools.source') })
    if (request === generation && typeof result === 'string') source.value = result
  } catch (problem) {
    if (request === generation) error.value = String(problem)
  }
}

async function chooseTarget(directory: boolean) {
  const path = workspace.currentPath
  if (!path) return
  const request = generation
  try {
    const selected = await open({ directory, multiple: false, defaultPath: path, title: t('svnTools.relativePath') })
    if (request !== generation || typeof selected !== 'string') return
    const relative = toWorkspaceRelativePath(selected, path)
    if (relative === null) error.value = t('svnTools.outsideWorkspace')
    else {
      error.value = ''
      target.value = relative || '.'
    }
  } catch (problem) {
    if (request === generation) error.value = String(problem)
  }
}

async function chooseExport() {
  const request = generation
  try {
    const result = await save({ title: t('svnTools.exportPath') })
    if (request === generation && result) destination.value = result
  } catch (problem) {
    if (request === generation) error.value = String(problem)
  }
}

async function execute() {
  const path = workspace.currentPath
  const url = workspace.svnInfo?.url
  if (!path || !url || !canRun.value) return
  const request = generation
  const action = buildAction()
  const readOnly = ['info', 'properties', 'remoteStatus', 'mergeinfo', 'export'].includes(action.kind)
  const remote = action.kind === 'import' || action.kind === 'remoteMkdir'
  const title = t('svnTools.' + action.kind)
  busy.value = true
  error.value = ''
  output.value = ''
  try {
    if (action.kind === 'branchMerge') {
      const plan = await repositoryBranchMergePreview(path, action.source, url)
      if (request === generation && !flow.busy) flow.plan = plan
      return
    }
    if (['delete', 'deleteProperty', 'patch', 'import', 'remoteMkdir'].includes(action.kind)) {
      const scope = ['source', 'target', 'destination', 'name']
        .flatMap(key => key in action ? [String(action[key as keyof typeof action])] : [])
        .join('\n')
      await ElMessageBox.confirm(scope, title, { type: 'warning', confirmButtonText: title })
    }
    if (request !== generation || flow.busy) return
    const run = () => svnWorkspaceAction(path, url, action)
    const refreshLocal = !remote && !['lock', 'unlock', 'changelist', 'removeChangelist'].includes(action.kind)
    const result = readOnly ? await run() : await flow.perform(title, run, true, refreshLocal)
    if (remote) {
      invalidateAllHistorySnapshots()
      if (workspace.currentPath === path) workspace.advanceHistoryEpoch()
    }
    if (request !== generation) return
    if (remote) listed.value = false
    output.value = result.trim() || t(readOnly ? 'svnTools.noOutput' : 'common.success')
  } catch (problem) {
    if (request === generation && problem !== 'cancel' && problem !== 'close') error.value = String(problem)
  } finally {
    if (request === generation) busy.value = false
  }
}
</script>

<style scoped>
.svn-tools { max-width: 900px; margin: 0 auto; padding: 20px 26px; }
h1 { font-size: 22px; margin: 0 0 6px; }
h2 { font-size: 16px; margin: 0 0 14px; }
header code { overflow-wrap: anywhere; }
.tool-tabs { display: flex; flex-wrap: wrap; gap: 5px; margin: 16px 0; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
.tool-tabs button, .entry-action, .directory-link { background: none; border: 0; color: inherit; cursor: pointer; padding: 7px 10px; }
.tool-tabs button[aria-pressed="true"] { border-bottom: 2px solid var(--md-sys-color-primary); font-weight: 600; }
.field { display: block; max-width: 580px; margin: 0 0 12px; }
.field span { display: block; margin-bottom: 4px; font-size: 13px; }
.field select { width: 100%; padding: 6px 10px; color: inherit; background: var(--md-sys-color-surface); border: 1px solid var(--md-sys-color-outline-variant); border-radius: 4px; }
.inline { display: flex; gap: 8px; }
.inline .el-button + .el-button { margin-left: 0; }
.picker { margin-top: 6px; }
.checkbox { display: block; margin: 8px 0; }
.note { max-width: 580px; }
.repo-entries { margin-top: 12px; max-height: 50vh; overflow: auto; }
.repo-entry { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 3px 6px; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
.repo-entry code, .directory-link { overflow-wrap: anywhere; }
.directory-link { text-align: left; padding-left: 0; }
.entry-action { color: var(--md-sys-color-primary); }
button:disabled { cursor: default; opacity: .6; }
.result { margin-top: 15px; }
.output { padding: 12px; margin-bottom: 12px; background: var(--md-sys-color-surface-container); white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 600px) { .svn-tools { padding: 12px; } .inline { flex-wrap: wrap; } }
</style>
