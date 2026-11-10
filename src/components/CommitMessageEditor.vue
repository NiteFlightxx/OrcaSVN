<template>
  <section class="commit-message-editor" :class="{ compact }" :aria-label="$t('commitDetails.editor')">
    <label>
      <span>{{ $t('commitDetails.subject') }} <span class="required">*</span></span>
      <el-input v-model="draft.subject" :disabled="disabled || !draft.key" :placeholder="$t('commitDetails.subjectPlaceholder')" :aria-label="$t('commitDetails.subject')" />
    </label>
    <label>
      <span>{{ $t('commitDetails.description') }}</span>
      <el-input v-model="draft.description" :disabled="disabled || !draft.key" type="textarea" :rows="compact ? 3 : 5" resize="vertical" :placeholder="$t('commitDetails.descriptionPlaceholder')" :aria-label="$t('commitDetails.description')" />
    </label>
    <small v-if="draft.message">{{ $t('commitDetails.characters', { count: draft.message.length }) }}</small>
  </section>
</template>

<script setup lang="ts">
import { useCommitDraftStore } from '@/stores/commitDraft'
defineProps<{ compact?: boolean; disabled?: boolean }>()
const draft = useCommitDraftStore()
</script>

<style scoped>
.commit-message-editor{display:flex;flex-direction:column;gap:10px;width:100%;min-width:0}.commit-message-editor label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--md-sys-color-on-surface-variant)}.commit-message-editor small{font-size:11px;text-align:right;color:var(--md-sys-color-on-surface-variant)}.required{color:var(--md-sys-color-error)}.compact{gap:6px}.compact :deep(.el-textarea__inner){max-height:220px}.commit-message-editor :deep(.el-textarea__inner){font-family:inherit}
</style>
