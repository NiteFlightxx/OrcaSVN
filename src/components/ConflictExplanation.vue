<template>
  <div class="conflict-explanation">
    <div class="reason-card">
      <strong>{{ title }}</strong>
      <template v-if="conflict.kind === 'tree' && info">
        <p>
          {{
            $t('conflictReview.incomingSentence', {
              operation: label('operation', info.operation),
              action: label('action', info.action),
              node: label('node', info.nodeKind),
            })
          }}
        </p>
        <p>{{ $t('conflictReview.reasonSentence', { reason: label('reason', info.reason) }) }}</p>
        <small>{{ $t('conflictReview.recordedReason') }}</small>
      </template>
      <p v-else>
        {{
          $t(
            conflict.kind === 'property'
              ? 'conflictReview.propertyHelp'
              : 'conflictReview.contentHelp'
          )
        }}
      </p>
    </div>
    <div class="conflict-sides">
      <article>
        <h4>{{ $t('conflictReview.localSide') }}</h4>
        <dl>
          <dt>{{ $t('conflictReview.currentNode') }}</dt>
          <dd>{{ info ? label('node', info.localKind) : $t('conflictReview.unavailable') }}</dd>
          <dt>{{ $t('conflictReview.scheduleLabel') }}</dt>
          <dd :class="{ danger: info?.schedule === 'delete' }">
            {{ info ? label('schedule', info.schedule) : $t('conflictReview.unavailable') }}
          </dd>
        </dl>
        <p v-if="info?.schedule === 'delete'" class="pending-delete">
          {{ $t('conflictReview.pendingDelete') }}
        </p>
        <template v-if="workspace && file && info?.localKind === 'dir'">
          <el-button size="small" @click="preview('local')">{{
            $t('conflictReview.viewLocalChildren')
          }}</el-button>
          <small class="scope-note">{{ $t('conflictReview.directChildren') }}</small>
          <div v-if="previews.local" class="child-preview">
            <p v-if="previews.local.loading" role="status">{{ $t('common.loading') }}</p>
            <p v-else-if="previews.local.error" class="danger" role="alert">
              {{ previews.local.error }}
            </p>
            <template v-else>
              <p v-if="!previews.local.data?.entries.length">
                {{ $t('conflictReview.emptyDirectory') }}
              </p>
              <ul>
                <li v-for="child in previews.local.data?.entries" :key="child.name">
                  {{ child.name }}{{ child.kind === 'dir' ? '/' : '' }}
                </li>
              </ul>
              <small v-if="previews.local.data?.truncated">{{
                $t('conflictReview.truncatedChildren')
              }}</small>
            </template>
          </div>
        </template>
      </article>
      <article>
        <h4>{{ $t('conflictReview.incomingSide') }}</h4>
        <dl>
          <dt>{{ $t('conflictReview.operationLabel') }}</dt>
          <dd>
            {{ info ? label('operation', info.operation) : $t('conflictReview.unavailable') }}
          </dd>
          <dt>{{ $t('conflictReview.actionLabel') }}</dt>
          <dd>
            {{
              conflict.kind === 'tree' && info
                ? label('action', info.action)
                : $t('conflictReview.unavailable')
            }}
          </dd>
          <template v-if="info?.base"
            ><dt>{{ $t('flow.base') }}</dt>
            <dd>r{{ info.base.revision }}</dd></template
          >
          <template v-if="info?.incoming"
            ><dt>{{ $t('conflictReview.sourceRevision') }}</dt>
            <dd>r{{ info.incoming.revision }}</dd></template
          >
        </dl>
        <p v-if="info?.incoming" class="source-url">{{ info.incoming.url }}</p>
        <p v-else class="scope-note">{{ $t('conflictReview.noIncomingMetadata') }}</p>
        <template v-if="workspace && file && info?.incoming?.kind === 'dir'">
          <el-button size="small" @click="preview('incoming')">{{
            $t('conflictReview.viewIncomingChildren')
          }}</el-button>
          <small class="scope-note">{{ $t('conflictReview.directChildren') }}</small>
          <div v-if="previews.incoming" class="child-preview">
            <p v-if="previews.incoming.loading" role="status">{{ $t('common.loading') }}</p>
            <p v-else-if="previews.incoming.error" class="danger" role="alert">
              {{ previews.incoming.error }}
            </p>
            <template v-else>
              <p v-if="!previews.incoming.data?.entries.length">
                {{ $t('conflictReview.emptyDirectory') }}
              </p>
              <ul>
                <li v-for="child in previews.incoming.data?.entries" :key="child.name">
                  {{ child.name }}{{ child.kind === 'dir' ? '/' : '' }}
                </li>
              </ul>
              <small v-if="previews.incoming.data?.truncated">{{
                $t('conflictReview.truncatedChildren')
              }}</small>
            </template>
          </div>
        </template>
      </article>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { conflictChildren, type Conflict, type ConflictChildren } from '@/api/workflows'
const props = defineProps<{
  conflict: Conflict
  workspace?: string
  file?: string
  version?: string
}>()
const { t } = useI18n()
const info = computed(() => props.conflict.summary)
const tokens: Record<string, string[]> = {
  node: ['dir', 'file', 'missing', 'none', 'other'],
  operation: ['update', 'switch', 'merge'],
  action: ['add', 'edit', 'delete', 'replace'],
  reason: [
    'unversioned',
    'edited',
    'deleted',
    'missing',
    'obstructed',
    'added',
    'replaced',
    'moved-away',
    'moved-here',
  ],
  schedule: ['normal', 'add', 'delete', 'replace'],
}
function label(group: string, value: string) {
  return tokens[group]?.includes(value)
    ? t(`conflictReview.${group}.${value}`)
    : t('conflictReview.unavailable')
}
const title = computed(() =>
  t(
    `conflictReview.${props.conflict.kind === 'tree' ? 'treeTitle' : props.conflict.kind === 'property' ? 'propertyTitle' : 'contentTitle'}`,
    { node: info.value ? label('node', info.value.nodeKind) : t('conflictReview.node.other') }
  )
)
type Preview = { loading: boolean; error: string; data: ConflictChildren | null }
const previews = ref<Partial<Record<'local' | 'incoming', Preview>>>({})
let generation = 0,
  disposed = false
async function preview(side: 'local' | 'incoming') {
  if (!props.workspace || !props.file || (previews.value[side] && !previews.value[side]?.error))
    return
  const current = generation,
    path = props.workspace,
    file = props.file,
    version = props.version
  previews.value[side] = { loading: true, error: '', data: null }
  try {
    const data = await conflictChildren(path, file, side)
    if (
      !disposed &&
      current === generation &&
      path === props.workspace &&
      file === props.file &&
      version === props.version
    )
      previews.value[side] = { loading: false, error: '', data }
  } catch (e) {
    if (!disposed && current === generation)
      previews.value[side] = { loading: false, error: String(e), data: null }
  }
}
watch(
  () => [props.workspace, props.file, props.version, props.conflict],
  () => {
    generation++
    previews.value = {}
  }
)
onBeforeUnmount(() => {
  disposed = true
  generation++
})
</script>
<style scoped>
.reason-card {
  padding: 14px 16px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-left: 3px solid var(--md-sys-color-warning);
  border-radius: 4px;
  background: var(--md-sys-color-surface-container-low);
}
.reason-card strong {
  font-size: 15px;
}
.reason-card p {
  font-size: 13px;
  line-height: 1.7;
  margin: 6px 0;
}
.reason-card small,
.scope-note {
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
  line-height: 1.6;
}
.conflict-sides {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  margin: 12px 0;
}
article {
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 4px;
}
h4 {
  font-size: 13px;
  margin: 0 0 12px;
}
dl {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 7px 12px;
  font-size: 12px;
}
dt {
  color: var(--md-sys-color-on-surface-variant);
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.danger,
.pending-delete {
  color: var(--md-sys-color-error);
}
.pending-delete {
  font-size: 12px;
  line-height: 1.6;
  margin: 10px 0;
}
.scope-note {
  display: block;
  margin: 8px 0;
}
.source-url {
  font-size: 12px;
  overflow-wrap: anywhere;
  margin: 10px 0;
}
.child-preview {
  font-size: 12px;
  max-height: 180px;
  overflow: auto;
  margin-top: 8px;
}
.child-preview ul {
  list-style: none;
  padding: 0;
}
.child-preview li {
  padding: 3px 0;
  overflow-wrap: anywhere;
}
.child-preview p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
@media (max-width: 850px) {
  .conflict-sides {
    grid-template-columns: 1fr;
  }
}
</style>
