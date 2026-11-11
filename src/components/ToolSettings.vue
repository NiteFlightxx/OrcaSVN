<template>
  <section class="tool-settings">
    <p>{{ $t('experience.toolHint') }}</p>
    <template v-for="kind in ['diff', 'merge'] as const" :key="kind"
      ><strong>{{
        $t(kind === 'diff' ? 'experience.externalDiff' : 'experience.externalMerge')
      }}</strong
      ><label
        >{{ $t('experience.executable')
        }}<el-input v-model="settings[kind === 'diff' ? 'diffToolPath' : 'mergeToolPath']" /></label
      ><label
        >{{ $t('experience.arguments')
        }}<el-input v-model="settings[kind === 'diff' ? 'diffToolArgs' : 'mergeToolArgs']" /></label
      ><small
        ><code>{{
          kind === 'diff' ? '{left}, {right}' : '{base}, {mine}, {theirs}, {merged}'
        }}</code></small
      ></template
    >
  </section>
</template>
<script setup lang="ts">
import { useSettings } from '@/composables/useSettings'
const { settings } = useSettings()
</script>
<style scoped>
.tool-settings {
  padding: 0 8px 12px;
  display: grid;
  gap: 12px;
  font-size: var(--app-font-size-sm);
}
.tool-settings label {
  display: grid;
  grid-template-columns: 156px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}
.tool-settings p {
  color: var(--md-sys-color-on-surface-variant);
}
.tool-settings small {
  padding-left: 164px;
  color: var(--md-sys-color-on-surface-variant);
  overflow-wrap: anywhere;
}
.tool-settings strong {
  padding-top: 8px;
  font-weight: 600;
}
@media (max-width: 600px) {
  .tool-settings label {
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }
  .tool-settings small {
    padding-left: 0;
  }
}
</style>
