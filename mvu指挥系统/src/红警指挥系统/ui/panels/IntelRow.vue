<template>
  <div class="group border-t px-3 py-2" style="border-color: var(--line)">
    <div class="flex items-start justify-between gap-2">
      <button
        class="pressable min-w-0 text-left"
        :style="{ color: item.read ? 'var(--t-low)' : 'var(--t-hi)', fontSize: '12px', lineHeight: 1.55 }"
        @click="$emit('open')"
      >
        <span
          v-if="!item.read"
          class="dot mr-1.5 align-middle"
          style="background: var(--warn); width: 4px; height: 4px"
          aria-label="未读"
        />
        <span class="chip chip--dim mr-1.5 align-middle" style="height: 15px; font-size: 9px">{{ item.src }}</span>
        {{ item.content }}
      </button>
      <span class="flex flex-none gap-1">
        <button
          class="icon-button pressable"
          style="min-width: 26px; min-height: 26px"
          :style="{ color: item.pinned ? 'var(--warn)' : 'var(--t-faint)' }"
          :title="item.pinned ? '取消置顶' : '置顶'"
          :aria-label="item.pinned ? '取消置顶' : '置顶'"
          @click="$emit('pin')"
        >
          <Icon name="pin" :size="12" />
        </button>
        <button
          class="icon-button pressable"
          style="min-width: 26px; min-height: 26px; color: var(--t-faint)"
          title="归档"
          aria-label="归档"
          @click="$emit('archive')"
        >
          <Icon name="archive" :size="12" />
        </button>
      </span>
    </div>
    <div class="num mt-1 flex items-center gap-3" style="color: var(--t-faint); font-size: 10px">
      <span>{{ item.date }}</span>
      <span class="flex items-center gap-1">
        可信度
        <span class="dot" :style="{ background: credColor(item.cred), width: '4px', height: '4px' }" />
        <span :style="{ color: credColor(item.cred) }">{{ item.cred }}</span>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import Icon from '../Icon.vue';

defineProps<{ item: { src: string; content: string; date: string; cred: string; read: boolean; pinned: boolean } }>();
defineEmits<{ pin: []; archive: []; open: [] }>();

function credColor(c: string) {
  return { 高: 'var(--ok)', 中: 'var(--warn)', 低: 'var(--bad)' }[c] ?? 'var(--t-low)';
}
</script>
