<template>
  <Transition name="ra-modal">
    <div
      v-if="open"
      ref="backdropRef"
      class="ra-modal-mask fixed inset-0 z-10010 flex items-center justify-center p-3"
      @click.self="$emit('close')"
    >
      <section
        ref="panelRef"
        class="ra-modal-card ob-panel flex max-h-[86vh] w-full max-w-[840px] flex-col overflow-hidden rounded-[4px] select-none"
        role="dialog"
        aria-modal="true"
        aria-label="战况档案"
      >
        <header class="ra-modal-header flex items-center justify-between border-b px-3.5 py-2.5">
          <div class="flex flex-wrap items-center gap-2">
            <span class="ra-modal-icon"><Icon name="archive" :size="14" /></span>
            <span class="ra-modal-title text-[13px] font-bold tracking-wide">战况档案与在册人员总览 · ARCHIVE</span>
            <span class="badge-npc rounded-[2px] px-1.5 py-0.5 text-[11px] font-bold">
              ◆ 在册 {{ counts.total }} 条 · 点击词条查阅正史全文
            </span>
          </div>
          <div class="flex items-center gap-1.5">
            <button
              type="button"
              class="ra-toolbar-btn rounded-[2px] px-2 py-1 text-[11px] transition-colors"
              data-test="archive-modal-refresh"
              :disabled="floating.busy"
              @click="handleRefresh"
            >
              刷新
            </button>
            <button
              class="ra-modal-close rounded-[2px] p-1 transition-colors"
              aria-label="关闭弹窗"
              @click="$emit('close')"
            >
              <Icon name="close" :size="12" />
            </button>
          </div>
        </header>

        <!-- 顶部筛选与搜索工具栏 -->
        <div class="ra-archive-toolbar border-b px-3.5 py-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-1" data-test="archive-modal-categories">
              <button
                v-for="cat in categoryTabs"
                :key="cat.key"
                type="button"
                class="kind-filter-btn"
                :class="[cat.badgeClass, { 'is-active': selectedCategory === cat.key }]"
                :data-category="cat.key"
                @click="selectedCategory = cat.key"
              >
                {{ cat.label }} ({{ cat.count }})
              </button>
            </div>
            <div class="flex items-center gap-1.5">
              <input
                v-model="searchKeyword"
                type="search"
                class="ra-search-input rounded-[2px] px-2 py-1 text-[12px]"
                data-test="archive-modal-search"
                placeholder="检索名称 / 势力 / 型号 / 摘要…"
              />
            </div>
          </div>
        </div>

        <!-- 主体列表区：只读在册档案卡片网格 + 底部可折叠维护区 -->
        <div class="ra-modal-body flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
          <div
            v-if="filteredItems.length > 0"
            class="grid grid-cols-1 gap-2 md:grid-cols-2"
            data-test="archive-modal-list"
          >
            <article
              v-for="item in filteredItems"
              :key="`${item.source}:${item.kind}:${item.name}`"
              class="ra-archive-item-card cursor-pointer rounded-[2px] p-2.5 transition-colors"
              :data-test="`archive-item-${item.name}`"
              @click="handleInspectItem(item)"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span class="kind-badge" :class="badgeClassFor(item.kind)">
                    {{ item.kind === '人物' ? 'NPC人物' : item.kind }}
                  </span>
                  <span class="truncate text-[13px] font-bold text-(--rac-hi)">{{ item.name }}</span>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                  <span
                    v-if="item.status === 'new'"
                    class="ra-badge-new rounded-[2px] px-1.5 py-0.5 font-mono text-[11px] font-bold"
                  >
                    ★ NEW · 本楼新增
                  </span>
                  <span class="text-[11px] text-(--rac-muted)">
                    {{ loadingItemKey === `${item.source}:${item.kind}:${item.name}` ? '读取中…' : '查阅 ▸' }}
                  </span>
                </div>
              </div>

              <!-- 人物 / 人员 / 装备关键属性标签 -->
              <div v-if="formatItemMetaTags(item).length > 0" class="mt-1.5 flex flex-wrap items-center gap-1">
                <span
                  v-for="tag in formatItemMetaTags(item)"
                  :key="tag"
                  class="ra-meta-chip rounded-[2px] px-1.5 py-0.5 text-[11px]"
                >
                  {{ tag }}
                </span>
              </div>

              <!-- 简介摘要 -->
              <p class="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-(--rac-text)">
                {{ item.desc || '暂无摘要，点击调阅世界书完整档案正文。' }}
              </p>
            </article>
          </div>

          <div
            v-else
            class="ra-empty-state rounded-[2px] px-3 py-6 text-center text-[12px]"
            data-test="archive-modal-empty"
          >
            <template v-if="searchKeyword.trim()">
              未检索到匹配「{{ searchKeyword.trim() }}」的在册档案词条
            </template>
            <template v-else>
              当前分类下暂无在册档案记录（随剧情推进自动收录机娘、人员、人物与各类扩展图鉴）
            </template>
          </div>

          <!-- 底部折叠式「新设定手动归档 / 历史回退孤儿维护」抽屉 -->
          <div class="ra-legacy-drawer rounded-[2px] border">
            <button
              type="button"
              class="ra-legacy-toggle flex w-full items-center justify-between px-3 py-2 text-left text-[12px]"
              data-test="archive-legacy-toggle"
              @click="showLegacyPanel = !showLegacyPanel"
            >
              <span class="flex items-center gap-1.5 font-bold text-(--rac-text)">
                <span>{{ showLegacyPanel ? '▾' : '▸' }}</span>
                <span>新设定手动归档 / 历史回退孤儿维护（《EVA·动态档案》兼容管线）</span>
              </span>
              <span class="text-[11px] text-(--rac-muted)">
                {{ showLegacyPanel ? '收起维护面板' : '展开维护面板' }}
              </span>
            </button>
            <div v-if="showLegacyPanel" class="border-t p-2" style="border-color: var(--rac-dim)">
              <PanelArchive />
            </div>
          </div>
        </div>
      </section>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { openDetail } from '../../红警指挥系统/composables/useDetail';
import { useTacticalModalMotion } from '../../红警指挥系统/ui/motion/useGsapMotion';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import { countArchiveIndex, PENDING_KIND, type ArchiveItem } from '../models/archiveIndex';
import { KIND_BADGE_CLASS } from '../models/expansionView';
import { useArchiveIndex } from '../models/useArchiveIndex';
import PanelArchive from '../panels/PanelArchive.vue';

const props = defineProps<{
  open: boolean;
}>();

defineEmits<{
  (e: 'close'): void;
}>();

const backdropRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
useTacticalModalMotion(panelRef, backdropRef, { open: () => props.open });

const { floating, index, worldbook, resolveItemDetail } = useArchiveIndex();

type CategoryFilterKey = 'all' | typeof PENDING_KIND | '人物' | '科技' | '建筑' | '载具' | '人员' | '装备' | '其他';
const selectedCategory = ref<CategoryFilterKey>('all');
const searchKeyword = ref('');
const loadingItemKey = ref<string | null>(null);
const showLegacyPanel = ref(false);

const counts = computed(() => countArchiveIndex(index.value));

const categoryTabs = computed<Array<{ key: CategoryFilterKey; label: string; count: number; badgeClass: string }>>(
  () => [
    { key: 'all', label: '全部', count: counts.value.total, badgeClass: '' },
    { key: PENDING_KIND, label: '机娘', count: counts.value.机娘, badgeClass: 'badge-girl' },
    { key: '人物', label: 'NPC人物', count: counts.value.人物, badgeClass: KIND_BADGE_CLASS['人物'] ?? '' },
    { key: '人员', label: '人员', count: counts.value.人员, badgeClass: KIND_BADGE_CLASS['人员'] ?? '' },
    { key: '科技', label: '科技', count: counts.value.科技, badgeClass: KIND_BADGE_CLASS['科技'] ?? '' },
    { key: '建筑', label: '建筑', count: counts.value.建筑, badgeClass: KIND_BADGE_CLASS['建筑'] ?? '' },
    { key: '载具', label: '载具', count: counts.value.载具, badgeClass: KIND_BADGE_CLASS['载具'] ?? '' },
    { key: '装备', label: '装备', count: counts.value.装备, badgeClass: KIND_BADGE_CLASS['装备'] ?? '' },
    {
      key: '其他',
      label: '其他/阵营',
      count: counts.value.其他 + counts.value.阵营,
      badgeClass: 'badge-other',
    },
  ],
);

const categoryFilteredItems = computed<ArchiveItem[]>(() => {
  const cat = selectedCategory.value;
  if (cat === 'all') {
    return [...index.value.pending, ...index.value.groups.flatMap(g => g.items)];
  }
  if (cat === PENDING_KIND) {
    return index.value.pending;
  }
  if (cat === '其他') {
    return index.value.groups
      .filter(g => g.kind === '其他' || g.kind === '阵营')
      .flatMap(g => g.items);
  }
  return index.value.groups.find(g => g.kind === cat)?.items ?? [];
});

const filteredItems = computed<ArchiveItem[]>(() => {
  const kw = searchKeyword.value.trim().toLowerCase();
  if (!kw) return categoryFilteredItems.value;
  return categoryFilteredItems.value.filter(item => {
    if (item.name.toLowerCase().includes(kw)) return true;
    if (item.kind.toLowerCase().includes(kw)) return true;
    if ((item.desc ?? '').toLowerCase().includes(kw)) return true;
    for (const [k, v] of Object.entries(item.params ?? {})) {
      if (k.toLowerCase().includes(kw) || String(v).toLowerCase().includes(kw)) return true;
    }
    return false;
  });
});

function badgeClassFor(kind: string): string {
  if (kind === PENDING_KIND) return 'badge-girl';
  return KIND_BADGE_CLASS[kind] ?? 'badge-other';
}

function formatItemMetaTags(item: ArchiveItem): string[] {
  const p = item.params ?? {};
  const tags: string[] = [];
  const faction = p['所属势力'] || p['势力'] || p['阵营'];
  if (faction) tags.push(`势力:${faction}`);
  if (p['态度']) tags.push(`态度:${p['态度']}`);
  if (p['信任度']) tags.push(`信任:${p['信任度']}`);
  const roleOrModel = p['席位任命'] || p['型号'] || p['定位'];
  if (roleOrModel) tags.push(roleOrModel);
  if (p['暴露分档']) tags.push(`暴露:${p['暴露分档']}`);
  return tags.slice(0, 4);
}

async function handleRefresh() {
  worldbook.invalidate();
  await floating.refresh();
}

async function handleInspectItem(item: ArchiveItem) {
  const key = `${item.source}:${item.kind}:${item.name}`;
  loadingItemKey.value = key;
  try {
    const rawDetail = await resolveItemDetail(item);
    const paramMap = new Map(rawDetail.params);
    let cleanedDesc = rawDetail.desc;
    if (paramMap.has('性格与口吻') || paramMap.has('外貌着装')) {
      cleanedDesc = cleanedDesc
        .replace(/\s*\|\s*性格与作风[：:][\s\S]*$/, '')
        .replace(/\s*\|\s*外貌特征[：:][\s\S]*$/, '')
        .trim();
    }
    if (cleanedDesc && paramMap.get('履历与绝活')?.trim() === cleanedDesc) {
      cleanedDesc = '';
    }
    const cleanedNote =
      rawDetail.note === '草稿 · 本楼层 codex，尚未归档'
        ? '在册卷宗 · 战局人员与设定档案'
        : rawDetail.note === '草稿 · 本楼层 pending_lore，尚未入档'
          ? '待入档卷宗 · 本轮新增设定'
          : rawDetail.note;
    const detailData = {
      ...rawDetail,
      desc: cleanedDesc,
      note: cleanedNote,
      readonly: true,
    };
    openDetail(detailData);
  } finally {
    if (loadingItemKey.value === key) {
      loadingItemKey.value = null;
    }
  }
}
</script>

<style scoped>
.ra-modal-mask {
  z-index: 10010;
  background: color-mix(in srgb, var(--rac-bg) 82%, transparent);
}

.ra-modal-card {
  background: var(--rac-bg);
  border: 1px solid var(--rac-line);
  border-top: 2px solid var(--rac-accent);
  box-shadow:
    0 12px 40px rgba(0, 0, 0, 0.85),
    0 0 0 1px color-mix(in srgb, var(--rac-accent) 20%, transparent);
}

.ra-modal-header {
  background: var(--rac-panel);
  border-color: var(--rac-dim);
}

.ra-modal-icon {
  color: var(--rac-accent);
}

.ra-modal-title {
  color: var(--rac-hi);
}

.ra-toolbar-btn {
  border: 1px solid var(--rac-dim);
  background: var(--rac-panel-2);
  color: var(--rac-text);
  cursor: pointer;
}
.ra-toolbar-btn:hover:not(:disabled) {
  border-color: var(--rac-line);
  color: var(--rac-hi);
}
.ra-toolbar-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ra-archive-toolbar {
  background: var(--rac-panel-2);
  border-color: var(--rac-dim);
}

.ra-search-input {
  min-width: 210px;
  border: 1px solid var(--rac-dim);
  background: var(--rac-bg);
  color: var(--rac-hi);
  outline: none;
}
.ra-search-input:focus {
  border-color: var(--rac-focus);
}

.kind-filter-btn {
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid var(--rac-dim);
  border-radius: 2px;
  color: var(--rac-muted);
  background: var(--rac-panel);
  cursor: pointer;
}
.kind-filter-btn:hover {
  border-color: var(--rac-line);
  color: var(--rac-text);
}
.kind-filter-btn.is-active {
  color: var(--rac-hi);
  border-color: var(--rac-accent);
  background: color-mix(in srgb, var(--rac-accent) 16%, transparent);
}

.kind-badge {
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 2px;
  border: 1px solid var(--rac-dim);
  color: var(--rac-text);
  background: var(--rac-panel-2);
}

.badge-npc {
  color: var(--rac-warn);
  border: 1px solid color-mix(in srgb, var(--rac-warn) 45%, transparent);
  background: color-mix(in srgb, var(--rac-warn) 14%, transparent);
}

.badge-girl {
  color: var(--rac-accent);
  border: 1px solid color-mix(in srgb, var(--rac-accent) 45%, transparent);
  background: color-mix(in srgb, var(--rac-accent) 14%, transparent);
}

.ra-archive-item-card {
  border: 1px solid var(--rac-dim);
  background: var(--rac-panel);
}
.ra-archive-item-card:hover {
  border-color: var(--rac-accent);
  background: var(--rac-panel-2);
}

.ra-badge-new {
  color: var(--rac-warn);
  border: 1px solid color-mix(in srgb, var(--rac-warn) 50%, transparent);
  background: color-mix(in srgb, var(--rac-warn) 16%, transparent);
}

.ra-meta-chip {
  color: var(--rac-muted);
  border: 1px solid var(--rac-dim);
  background: var(--rac-bg);
}

.ra-empty-state {
  border: 1px dashed var(--rac-dim);
  background: var(--rac-panel);
  color: var(--rac-muted);
}

.ra-legacy-drawer {
  border-color: var(--rac-dim);
  background: var(--rac-panel);
}

.ra-legacy-toggle {
  cursor: pointer;
  background: var(--rac-panel-2);
}
.ra-legacy-toggle:hover {
  background: color-mix(in srgb, var(--rac-accent) 10%, var(--rac-panel-2));
}

.ra-modal-close {
  color: var(--rac-muted);
}
.ra-modal-close:hover {
  color: var(--rac-hi);
  background: var(--rac-panel-2);
}
.ra-modal-close:focus-visible {
  outline: 1px solid var(--rac-focus);
  outline-offset: 1px;
}

.ra-modal-body {
  background: var(--rac-bg);
}

.ra-modal-enter-active,
.ra-modal-leave-active {
  transition: opacity 0.2s cubic-bezier(.3,0,.1,1), transform 0.2s cubic-bezier(.3,0,.1,1);
}

.ra-modal-enter-from,
.ra-modal-leave-to {
  opacity: 0;
  transform: scale(0.97);
}
</style>
