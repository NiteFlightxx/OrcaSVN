<template>
  <div ref="element" class="virtual-viewport" tabindex="0" @scroll="updateScroll">
    <div class="virtual-spacer" :style="{ height: `${range.height}px`, width: `max(100%, ${contentWidth}px)` }">
      <div class="virtual-window" :style="{ top: `${range.start * rowHeight}px` }">
        <slot :start="range.start" :end="range.end" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { getVirtualWindow } from '@/utils/virtualWindow'

const props = withDefaults(defineProps<{
  itemCount: number
  rowHeight: number
  contentWidth?: number
  resetKey?: string | number
}>(), { contentWidth: 0 })
const element = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(0)
const range = computed(() => getVirtualWindow(props.itemCount, props.rowHeight, scrollTop.value, viewportHeight.value))
let observer: ResizeObserver | undefined

function updateScroll() {
  scrollTop.value = element.value?.scrollTop || 0
}
function measure() {
  if (!element.value) return
  viewportHeight.value = element.value.clientHeight
  element.value.scrollTop = range.value.top
  updateScroll()
}
function observe() {
  if (!element.value) return
  observer ??= new ResizeObserver(measure)
  observer.observe(element.value)
  measure()
}
function scrollToIndex(index: number, align: 'nearest' | 'center' = 'nearest') {
  const viewport = element.value
  if (!viewport || props.itemCount === 0) return
  const top = Math.max(0, Math.min(index, props.itemCount - 1)) * props.rowHeight
  if (align === 'center') viewport.scrollTop = Math.max(0, top - (viewport.clientHeight - props.rowHeight) / 2)
  else if (top < viewport.scrollTop) viewport.scrollTop = top
  else if (top + props.rowHeight > viewport.scrollTop + viewport.clientHeight) {
    viewport.scrollTop = top + props.rowHeight - viewport.clientHeight
  }
  updateScroll()
}
function resetScroll() {
  if (element.value) {
    element.value.scrollTop = 0
    element.value.scrollLeft = 0
  }
  updateScroll()
}
watch(() => props.resetKey, resetScroll, { flush: 'post' })
watch(() => [props.itemCount, props.rowHeight], () => { void nextTick(measure) }, { flush: 'post' })
onMounted(observe)
onActivated(observe)
onDeactivated(() => observer?.disconnect())
onBeforeUnmount(() => observer?.disconnect())
defineExpose({ scrollToIndex, resetScroll, element })
</script>

<style scoped>
.virtual-viewport { flex: 1; min-width: 0; min-height: 0; overflow: auto; overflow-anchor: none; }
.virtual-spacer { position: relative; }
.virtual-window { position: absolute; left: 0; width: 100%; }
</style>
