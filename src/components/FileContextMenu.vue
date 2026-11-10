<template>
  <Teleport to="body">
    <div
      ref="element"
      class="file-context-menu"
      role="menu"
      data-path-menu
      :style="{ left: `${position.x}px`, top: `${position.y}px` }"
      @click.stop
      @contextmenu.prevent.stop
      @keydown="navigate"
    >
      <p v-if="notice" class="file-menu-notice" role="status">{{ notice }}</p>
      <template v-for="item in items" :key="item.id">
        <hr v-if="item.separator" role="separator" />
        <div v-if="item.children" class="file-menu-submenu" @mouseenter="openSubmenu(item)">
          <button
            role="menuitem"
            :data-submenu="item.id"
            aria-haspopup="menu"
            :aria-expanded="submenu === item.id"
            :disabled="item.disabled"
            :title="item.title"
            @click="openSubmenu(item)"
          >
            {{ item.label }}<span>›</span>
          </button>
          <div
            v-if="submenu === item.id && !item.disabled"
            class="file-menu-flyout"
            role="menu"
            :style="submenuPosition"
            @keydown.left.prevent.stop="closeSubmenu"
          >
            <button
              v-for="child in item.children"
              :key="child.id"
              role="menuitem"
              type="button"
              class="context-menu-item nested"
              :disabled="child.disabled"
              :title="child.title"
              @click="$emit('action', child.id)"
            >
              {{ child.label }}
            </button>
          </div>
        </div>
        <button
          v-else
          role="menuitem"
          type="button"
          class="context-menu-item"
          :class="{ danger: item.danger }"
          :disabled="item.disabled"
          :title="item.title"
          @click="$emit('action', item.id)"
        >
          <span>{{ item.label }}</span
          ><kbd v-if="item.shortcut">{{ item.shortcut }}</kbd>
        </button>
      </template>
    </div>
  </Teleport>
</template>
<script setup lang="ts">
import { nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { fitMenu, type FileMenuItem } from '@/utils/fileMenu'
const props = defineProps<{ x: number; y: number; items: FileMenuItem[]; notice?: string }>()
const emit = defineEmits<{ action: [id: string]; close: [] }>()
const element = ref<HTMLElement | null>(null)
const previousFocus =
  typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)
function closeOutside(event: Event) {
  if (!element.value?.contains(event.target as Node)) emit('close')
}
function closeForWindow() {
  emit('close')
}
const submenu = ref(''),
  submenuPosition = ref({ left: '0px', top: '0px' })
async function openSubmenu(item: FileMenuItem) {
  if (item.disabled) return
  submenu.value = item.id
  await nextTick()
  const parent = element.value?.querySelector<HTMLElement>(`[data-submenu="${item.id}"]`),
    flyout = element.value?.querySelector<HTMLElement>('.file-menu-flyout')
  if (!parent || !flyout) return
  const anchor = parent.getBoundingClientRect(),
    bounds = flyout.getBoundingClientRect()
  const x =
    anchor.right + bounds.width > window.innerWidth - 8 ? anchor.left - bounds.width : anchor.right
  const fit = fitMenu(
    x,
    anchor.top,
    bounds.width,
    bounds.height,
    window.innerWidth,
    window.innerHeight
  )
  submenuPosition.value = { left: fit.x + 'px', top: fit.y + 'px' }
}
function closeSubmenu() {
  const id = submenu.value
  submenu.value = ''
  element.value?.querySelector<HTMLElement>(`[data-submenu="${id}"]`)?.focus()
}
const position = ref({ x: props.x, y: props.y })
async function measure() {
  await nextTick()
  const bounds = element.value?.getBoundingClientRect()
  if (bounds)
    position.value = fitMenu(
      props.x,
      props.y,
      bounds.width,
      bounds.height,
      window.innerWidth,
      window.innerHeight
    )
}
onMounted(async () => {
  document.addEventListener('pointerdown', closeOutside)
  window.addEventListener('resize', closeForWindow)
  window.addEventListener('blur', closeForWindow)
  await measure()
  element.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeOutside)
  window.removeEventListener('resize', closeForWindow)
  window.removeEventListener('blur', closeForWindow)
  if (previousFocus?.isConnected) previousFocus.focus()
})
watch(() => [props.x, props.y, props.items], measure, { flush: 'post' })
function navigate(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  const items = [
    ...(element.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') || []),
  ].filter(
    (item) =>
      !item.hasAttribute('disabled') &&
      item.getAttribute('aria-disabled') !== 'true' &&
      item.getClientRects().length
  )
  const index = items.indexOf(target)
  if (
    event.key === 'ArrowDown' ||
    event.key === 'ArrowUp' ||
    event.key === 'Home' ||
    event.key === 'End'
  ) {
    event.preventDefault()
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  } else if (event.key === 'ArrowRight' && target.dataset.submenu) {
    event.preventDefault()
    const item = props.items.find((item) => item.id === target.dataset.submenu)
    if (item)
      void openSubmenu(item).then(() =>
        element.value
          ?.querySelector<HTMLElement>('.file-menu-flyout button:not(:disabled)')
          ?.focus()
      )
  } else if (event.key === 'Escape' && submenu.value) {
    event.preventDefault()
    closeSubmenu()
  } else if (event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault()
    emit('close')
  } else if (
    (event.ctrlKey || event.metaKey) &&
    (event.key.toLowerCase() === 'c' || event.code === 'KeyC')
  ) {
    event.preventDefault()
    event.stopPropagation()
    emit('action', event.altKey || event.shiftKey ? 'copy-absolute' : 'copy-relative')
  } else if (event.key === 'Delete') {
    event.preventDefault()
    emit('action', 'discard')
  }
}
</script>
<style scoped>
.file-menu-flyout {
  position: fixed;
  z-index: 3501;
  min-width: 220px;
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 16px);
  overflow: auto;
  padding: 4px;
  background: var(--md-sys-color-surface-container);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 4px;
}
.file-menu-notice {
  margin: 4px 6px;
  padding: 6px 4px;
  white-space: normal;
  overflow-wrap: anywhere;
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}
.file-context-menu {
  position: fixed;
  z-index: 3500;
  width: min(290px, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
  overflow: auto;
  padding: 4px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 5px;
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface);
  box-shadow: var(--app-shadow-floating);
  box-sizing: border-box;
}
.context-menu-item,
.file-menu-submenu > button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 28px;
  padding: 5px 10px;
  background: none;
  border: 0;
  border-radius: 3px;
  color: inherit;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
}
.context-menu-item:hover:not(:disabled),
.context-menu-item:focus-visible,
.file-menu-submenu > button:hover,
.file-menu-submenu > button:focus-visible {
  outline: none;
  background: var(--md-sys-color-surface-container-highest);
}
.context-menu-item:disabled,
.file-menu-submenu > button[aria-disabled='true'] {
  opacity: 0.4;
  cursor: default;
}
.context-menu-item.danger:not(:disabled) {
  color: var(--md-sys-color-error);
}
.context-menu-item.nested {
  padding-left: 24px;
}
hr {
  border: 0;
  border-top: 1px solid var(--md-sys-color-outline-variant);
  margin: 4px 6px;
}
kbd {
  font-family: inherit;
  font-size: 11px;
  opacity: 0.55;
  white-space: nowrap;
}
.file-menu-submenu > button {
  list-style: none;
}
.file-menu-submenu > button::-webkit-details-marker {
  display: none;
}
</style>
