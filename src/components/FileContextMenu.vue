<template>
  <Teleport to="body">
    <div ref="element" class="file-context-menu" role="menu" data-path-menu :style="{ left: `${position.x}px`, top: `${position.y}px` }" @click.stop @contextmenu.prevent.stop @keydown="navigate">
      <p v-if="notice" class="file-menu-notice" role="status">{{ notice }}</p>
      <template v-for="item in items" :key="item.id">
        <hr v-if="item.separator" role="separator" />
        <details v-if="item.children" class="file-menu-submenu" @toggle="measure">
          <summary role="menuitem" :aria-disabled="item.disabled" :title="item.title" @click="blockDisabled($event, item)">{{ item.label }}<span>›</span></summary>
          <button v-for="child in item.children" :key="child.id" role="menuitem" type="button" class="context-menu-item nested" :disabled="item.disabled || child.disabled" :title="child.title" @click="$emit('action', child.id)">{{ child.label }}</button>
        </details>
        <button v-else role="menuitem" type="button" class="context-menu-item" :class="{ danger: item.danger }" :disabled="item.disabled" :title="item.title" @click="$emit('action', item.id)"><span>{{ item.label }}</span><kbd v-if="item.shortcut">{{ item.shortcut }}</kbd></button>
      </template>
    </div>
  </Teleport>
</template>
<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { fitMenu, type FileMenuItem } from '@/utils/fileMenu'
const props = defineProps<{ x: number; y: number; items: FileMenuItem[]; notice?: string }>()
const emit = defineEmits<{ action: [id: string]; close: [] }>()
const element = ref<HTMLElement | null>(null)
const position = ref({ x: props.x, y: props.y })
async function measure() { await nextTick(); const bounds = element.value?.getBoundingClientRect(); if (bounds) position.value = fitMenu(props.x, props.y, bounds.width, bounds.height, window.innerWidth, window.innerHeight) }
function blockDisabled(event: Event, item: FileMenuItem) { if (item.disabled) event.preventDefault() }
onMounted(async () => { await measure(); element.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus() })
watch(() => [props.x, props.y, props.items], measure, { flush: 'post' })
function navigate(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  const items = [...(element.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') || [])].filter(item => !item.hasAttribute('disabled') && item.getAttribute('aria-disabled') !== 'true' && item.getClientRects().length)
  const index = items.indexOf(target)
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  } else if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); emit('close') }
  else if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'c' || event.code === 'KeyC')) { event.preventDefault(); event.stopPropagation(); emit('action', event.altKey || event.shiftKey ? 'copy-absolute' : 'copy-relative') }
  else if (event.key === 'Delete') { event.preventDefault(); emit('action', 'discard') }
}
</script>
<style scoped>
.file-menu-notice{margin:4px 6px;padding:6px 4px;white-space:normal;overflow-wrap:anywhere;font-size:12px;color:var(--md-sys-color-on-surface-variant);border-bottom:1px solid var(--md-sys-color-outline-variant)}
.file-context-menu{position:fixed;z-index:3500;width:min(290px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;padding:4px;border:1px solid var(--md-sys-color-outline-variant);border-radius:5px;background:var(--md-sys-color-surface-container);color:var(--md-sys-color-on-surface);box-shadow:var(--app-shadow-floating);box-sizing:border-box}.context-menu-item,.file-menu-submenu>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:28px;padding:5px 10px;background:none;border:0;border-radius:3px;color:inherit;font:inherit;font-size:12px;text-align:left;cursor:pointer;box-sizing:border-box}.context-menu-item:hover:not(:disabled),.context-menu-item:focus-visible,.file-menu-submenu>summary:hover,.file-menu-submenu>summary:focus-visible{outline:none;background:var(--md-sys-color-surface-container-highest)}.context-menu-item:disabled,.file-menu-submenu>summary[aria-disabled="true"]{opacity:.4;cursor:default}.context-menu-item.danger:not(:disabled){color:var(--md-sys-color-error)}.context-menu-item.nested{padding-left:24px}hr{border:0;border-top:1px solid var(--md-sys-color-outline-variant);margin:4px 6px}kbd{font-family:inherit;font-size:11px;opacity:.55;white-space:nowrap}.file-menu-submenu>summary{list-style:none}.file-menu-submenu>summary::-webkit-details-marker{display:none}
</style>
