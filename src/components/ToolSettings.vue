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
  padding: 12px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  display: grid;
  gap: 8px;
  font-size: 12px;
}
.tool-settings label {
  display: grid;
  grid-template-columns: 150px 1fr;
  align-items: center;
  gap: 8px;
}
.tool-settings p {
  color: var(--md-sys-color-on-surface-variant);
}
</style>
