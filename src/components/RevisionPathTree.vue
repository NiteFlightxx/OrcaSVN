<template>
  <el-tree
    :data="tree"
    node-key="path"
    :props="{ label: 'label', children: 'children' }"
    :expand-on-click-node="false"
    :current-node-key="selected"
    highlight-current
    default-expand-all
    @node-click="selectNode"
  >
    <template #default="{ data }"
      ><span
        class="revision-path"
        :title="data.original?.path || data.path"
        @dblclick.stop="openNode(data)"
      >
        <el-icon><Folder v-if="data.children.length" /><Document v-else /></el-icon>
        <span>{{ data.label }}</span
        ><small v-if="data.original">{{ data.original.action }}</small>
      </span></template
    >
  </el-tree>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { buildChangeTree, type ChangeNode } from '@/utils/changeTree'
import type { SvnLogPath } from '@/types'
const props = defineProps<{ paths: SvnLogPath[]; selected?: string }>()
const emit = defineEmits<{
  select: [path: SvnLogPath]
  open: [path: SvnLogPath]
}>()
type RevisionNode = {
  path: string
  label: string
  children: RevisionNode[]
  original?: SvnLogPath
}
const tree = computed(() => {
  const originals = new Map(props.paths.map((row) => [row.path.replace(/^\/+/, '') || '.', row]))
  const roots = buildChangeTree(
    [...originals.keys()].map((path) => ({
      path,
      status: '',
      status_code: 'modified',
      prop_status: 'none',
      locked: false,
      history: false,
      switched: false,
    }))
  )
  const convert = (node: ChangeNode): RevisionNode => ({
    path: originals.get(node.path)?.path || node.path,
    label: node.path === '.' ? '/' : node.label,
    original: originals.get(node.path),
    children: node.children.map(convert),
  })
  return roots.flatMap((root) => (root.entry ? [root] : root.children)).map(convert)
})
function selectNode(node: RevisionNode) {
  if (node.original) emit('select', node.original)
}
function openNode(node: RevisionNode) {
  if (node.original) emit('open', node.original)
}
</script>
<style scoped>
.revision-path {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  font-size: 12px;
}
.revision-path > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.revision-path small {
  margin-left: auto;
  padding-right: 8px;
  color: var(--md-sys-color-on-surface-variant);
}
</style>
