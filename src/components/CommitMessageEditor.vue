<template>
  <section
    class="commit-message-editor"
    :class="{ compact }"
    :aria-label="$t('commitDetails.editor')"
  >
    <div class="message-actions">
      <select
        :aria-label="$t('experience.recent')"
        :disabled="disabled"
        @change="loadRecent($event)"
      >
        <option value="">{{ $t('experience.recent') }}</option>
        <option v-for="message in recent" :key="message" :value="message">
          {{ message.split('\n')[0].slice(0, 90) }}
        </option></select
      ><button :disabled="disabled" @click="draft.loadMessage($t('experience.templateBody'))">
        {{ $t('experience.template') }}
      </button>
    </div>
    <label>
      <span>{{ $t('commitDetails.subject') }} <span class="required">*</span></span>
      <el-input
        v-model="draft.subject"
        :disabled="disabled || !draft.key"
        :placeholder="$t('commitDetails.subjectPlaceholder')"
        :aria-label="$t('commitDetails.subject')"
      />
    </label>
    <label>
      <span>{{ $t('commitDetails.description') }}</span>
      <el-input
        v-model="draft.description"
        :disabled="disabled || !draft.key"
        type="textarea"
        :rows="compact ? 3 : 5"
        resize="vertical"
        :placeholder="$t('commitDetails.descriptionPlaceholder')"
        :aria-label="$t('commitDetails.description')"
      />
    </label>
    <small v-if="draft.message">{{
      $t('commitDetails.characters', { count: draft.message.length })
    }}</small>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useCommitDraftStore } from '@/stores/commitDraft'
defineProps<{ compact?: boolean; disabled?: boolean }>()
const draft = useCommitDraftStore(),
  workspace = useWorkspaceStore()
const recent = computed<string[]>(() => {
  void draft.message
  try {
    const data = JSON.parse(localStorage.getItem('orcasvn-recent-commit-messages') || '{}')
    return (data[workspace.currentPath || ''] || [])
      .map((entry: string | { message: string }) =>
        typeof entry === 'string' ? entry : entry.message
      )
      .filter((value: unknown) => typeof value === 'string')
  } catch {
    return []
  }
})
function loadRecent(event: Event) {
  const select = event.target as HTMLSelectElement
  if (select.value) draft.loadMessage(select.value)
  select.value = ''
}
</script>

<style scoped>
.message-actions {
  display: flex;
  gap: 8px;
  font-size: 11px;
}
.message-actions select {
  flex: 1;
  min-width: 0;
}
.message-actions button {
  border: 0;
  background: none;
  color: var(--md-sys-color-primary);
  cursor: pointer;
}
.commit-message-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  min-width: 0;
}
.commit-message-editor label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
}
.commit-message-editor small {
  font-size: 11px;
  text-align: right;
  color: var(--md-sys-color-on-surface-variant);
}
.required {
  color: var(--md-sys-color-error);
}
.compact {
  gap: 6px;
}
.compact :deep(.el-textarea__inner) {
  max-height: 220px;
}
.commit-message-editor :deep(.el-textarea__inner) {
  font-family: inherit;
}
</style>
