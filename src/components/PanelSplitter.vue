<template>
  <div class="panel-splitter" :class="axis" role="separator" tabindex="0" :aria-label="label" :aria-orientation="axis === 'x' ? 'vertical' : 'horizontal'" :aria-valuemin="min" :aria-valuemax="max" :aria-valuenow="Math.round(value)" @pointerdown="start" @pointermove="move" @pointerup="finish" @pointercancel="finish" @lostpointercapture="finish" @keydown="keyboard" />
</template>
<script setup lang="ts">
const props = defineProps<{ axis: 'x' | 'y'; value: number; min: number; max: number; label: string; reverse?: boolean; percent?: boolean }>()
const emit = defineEmits<{ 'update:value': [value: number] }>()
let origin = 0, initial = 0, extent = 1, dragging = false
function change(value: number) { emit('update:value', Math.max(props.min, Math.min(props.max, value))) }
function start(event: PointerEvent) {
  if (event.button !== 0) return
  const element = event.currentTarget as HTMLElement
  const bounds = element.parentElement!.getBoundingClientRect()
  extent = Math.max(1, props.axis === 'x' ? bounds.width : bounds.height)
  origin = props.axis === 'x' ? event.clientX : event.clientY
  initial = props.value
  dragging = true
  element.setPointerCapture(event.pointerId)
  event.preventDefault()
}
function move(event: PointerEvent) {
  if (!dragging) return
  const delta = (props.axis === 'x' ? event.clientX : event.clientY) - origin
  change(initial + delta * (props.percent ? 100 / extent : 1) * (props.reverse ? -1 : 1))
}
function finish() { dragging = false }
function keyboard(event: KeyboardEvent) {
  const direction = props.axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
  if (direction.includes(event.key)) { event.preventDefault(); change(props.value + (event.key === direction[0] ? -1 : 1) * (props.percent ? 5 : 16) * (props.reverse ? -1 : 1)) }
  else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); change(event.key === 'Home' ? props.min : props.max) }
}
</script>
<style scoped>
.panel-splitter{position:relative;touch-action:none;background:var(--md-sys-color-outline-variant);z-index:2}.panel-splitter.x{width:4px;cursor:col-resize}.panel-splitter.y{height:4px;cursor:row-resize}.panel-splitter:hover,.panel-splitter:focus-visible{background:var(--md-sys-color-primary);outline:none}.panel-splitter.x::after{content:'';position:absolute;inset:0 -3px}.panel-splitter.y::after{content:'';position:absolute;inset:-3px 0}
</style>
