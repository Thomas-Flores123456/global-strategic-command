<template>
  <button
    class="menu-row flex w-full items-baseline justify-between gap-3 px-2 py-1.5 text-left"
    :class="disabled ? 'cursor-not-allowed' : 'cursor-pointer'"
    :disabled="disabled"
    :style="{ color: disabled ? 'var(--t-faint)' : 'var(--t-hi)', borderRadius: '2px', fontSize: '12px' }"
    @click="!disabled && $emit('pick')"
  >
    <span class="min-w-0 truncate">{{ label }}</span>
    <span
      class="num flex-none"
      :style="{ color: disabled ? 'var(--t-faint)' : 'var(--t-low)', fontSize: '10.5px' }"
    >
      {{ meta }}
    </span>
  </button>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ label: string; meta?: string; disabled?: boolean }>(), { meta: '', disabled: false });
defineEmits<{ pick: [] }>();
</script>
