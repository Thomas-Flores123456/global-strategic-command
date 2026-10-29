<template>
  <div class="flex flex-col gap-2 p-2">
    <!-- ── 摘要 ── -->
    <div class="micro flex items-center gap-1.5 px-1">
      <Icon name="base" :size="11" />
      <span class="truncate"
        >目录 {{ catalogItems.length }} · 动态 {{ dynamicItems.length }} · 已建 {{ builtTotal }} 座</span
      >
    </div>

    <!-- ── 目录 / 动态 两段 ── -->
    <section v-for="sec in sections" :key="sec.title" class="card">
      <button class="pressable flex w-full items-center justify-between px-3 py-2.5" @click="toggle(sec.title)">
        <span class="flex items-center gap-2.5">
          <span style="color: var(--t-hi); font-size: 12.5px; letter-spacing: 0.04em">{{ sec.title }}</span>
          <span class="num micro">{{ sec.items.length }}</span>
        </span>
        <Icon :name="expanded[sec.title] ? 'chevron-up' : 'chevron-down'" :size="10" style="color: var(--t-faint)" />
      </button>
      <div v-if="expanded[sec.title]" class="border-t px-3 pb-1.5" style="border-color: var(--line)">
        <div v-if="!sec.items.length" class="py-2" style="color: var(--t-faint); font-size: 11px">{{ sec.empty }}</div>
        <button
          v-for="b in sec.items"
          :key="b.name"
          class="bld-row pressable flex w-full items-center justify-between gap-2 border-b py-1.5 text-left last:border-b-0"
          style="border-color: var(--line)"
          @click="openLookup(b.name, codex)"
        >
          <span class="bld-col flex min-w-0 flex-col gap-0.5">
            <span class="bld-head flex min-w-0 items-center gap-2">
              <span
                class="bld-name truncate"
                :style="{ color: b.built ? 'var(--t-hi)' : 'var(--t-low)', fontSize: '12px' }"
                >{{ b.name }}</span
              >
              <span
                v-if="b.built"
                class="num flex-none"
                style="
                  color: var(--ok);
                  border: 1px solid var(--ok);
                  border-radius: 3px;
                  padding: 0 3px;
                  font-size: 9px;
                "
              >
                已建 {{ b.built }}
              </span>
              <span
                v-if="b.dynamic"
                class="flex-none"
                style="
                  color: var(--t-faint);
                  border: 1px solid var(--line);
                  border-radius: 3px;
                  padding: 0 3px;
                  font-size: 9px;
                  letter-spacing: 0.06em;
                "
                >EVA</span
              >
            </span>
            <span v-if="b.prereq" class="bld-prereq truncate">{{ b.prereq }}</span>
          </span>
          <span class="bld-meta num flex-none text-right">{{ b.meta }}</span>
        </button>
      </div>
    </section>

    <div class="px-1 pb-1" style="color: var(--t-faint); font-size: 10px">
      目录 = 内置 + 已安装 DLC · 动态 = 本楼 codex 建筑 · 已建数按各基地 buildings 计
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import { useCatalogStore } from '../../红警指挥系统/composables/useCatalog';
import { openLookup } from '../../红警指挥系统/composables/useDetail';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';

interface UiBuilding {
  name: string;
  /** 造价 · 耗电/发电 摘要 */
  meta: string;
  /** 前置研究 / 前置建筑摘要 */
  prereq: string;
  /** 各基地已建数量（0 不显示） */
  built: number;
  dynamic?: boolean;
}

const catalog = useCatalogStore();
const floating = useFloatingStore();

const codex = computed(() => floating.snapshot?.codex ?? []);

/** 已建计数：遍历 snapshot.bases[].buildings[].name */
const builtCount = computed(() => {
  const m = new Map<string, number>();
  for (const base of floating.snapshot?.bases ?? []) {
    for (const b of base.buildings) m.set(b.name, (m.get(b.name) ?? 0) + 1);
  }
  return m;
});
const builtTotal = computed(() => [...builtCount.value.values()].reduce((a, n) => a + n, 0));

/** 有效目录（内置 + DLC overlay，useCatalogStore 已合并） */
const catalogItems = computed<UiBuilding[]>(() =>
  catalog.buildings.map(b => ({
    name: b.name,
    meta: `${b.cost} · ${b.power < 0 ? `发电${Math.abs(b.power)}` : `耗电${b.power}`}`,
    prereq: [b.research ? `前置 ${b.research}` : '', b.need_building ? `需 ${b.need_building}` : '']
      .filter(Boolean)
      .join(' · '),
    built: builtCount.value.get(b.name) ?? 0,
  })),
);

/** 动态：codex kind=建筑 且目录不含（镜像 PanelTech 的“静态目录 + 动态创造”合并） */
const dynamicItems = computed<UiBuilding[]>(() => {
  const known = new Set(catalog.buildings.map(b => b.name));
  return codex.value
    .filter(c => c.kind === '建筑' && !known.has(c.name))
    .map(c => ({
      name: c.name,
      meta:
        [c.params['造价'] ?? c.params['费用'], c.params['耗电'] ?? c.params['发电']].filter(Boolean).join(' · ') ||
        'EVA 增补',
      prereq: [c.params['前置'], c.params['前置研究'], c.params['前置建筑']].filter(Boolean).join(' · '),
      built: builtCount.value.get(c.name) ?? 0,
      dynamic: true,
    }));
});

const sections = computed(() => [
  { title: '目录', items: catalogItems.value, empty: '目录为空' },
  { title: '动态', items: dynamicItems.value, empty: '本楼层无 EVA 增补建筑' },
]);

const expanded = reactive<Record<string, boolean>>({ 目录: true, 动态: true });
function toggle(title: string) {
  expanded[title] = !expanded[title];
}
</script>

<style scoped>
/* 造价·电力 / 前置摘要：由内联样式改为类，便于窄宽媒体查询覆盖（宽屏计算值不变） */
.bld-prereq {
  color: var(--t-faint);
  font-size: 9.5px;
}
.bld-meta {
  color: var(--t-faint);
  font-size: 10px;
}
/* F-QA-03：脚本 iframe 即文档视口，≤239px（悬浮窗 200 宽 / 内容区 160）时单行布局下名称列仅剩约 37px。
   改两行：① 名称（可换行、不截断）+ 已建/EVA 标；② 造价·电力 + 前置摘要（10px 弱化色）。
   .bld-col 以 display:contents 让三段成为按钮的直接 flex 项，靠 order + wrap 排两行；DOM 与只读语义不变。 */
@media (max-width: 239px) {
  .bld-row {
    flex-wrap: wrap;
    row-gap: 2px;
  }
  .bld-col {
    display: contents;
  }
  .bld-head {
    order: 0;
    flex: 1 1 100%;
  }
  .bld-name {
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .bld-meta {
    order: 1;
    text-align: left;
  }
  .bld-prereq {
    order: 2;
    flex: 1 1 0;
    min-width: 0;
    font-size: 10px;
  }
}
</style>
