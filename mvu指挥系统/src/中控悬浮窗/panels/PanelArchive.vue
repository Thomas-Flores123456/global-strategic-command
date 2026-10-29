<template>
  <!--
    动态归档 · Archive（自 PanelSystem 迁入中控台设置弹窗；CTRL-SETTINGS-MIGRATE-04 第四枪 & FD-32 人物分支）
    codex（楼层变量，草稿态）→《EVA·动态档案》（全局正史）晋升管道 + 回溯孤儿补录/删除。
    支持 人物（NPC人物）与 科技/建筑/载具/人员/装备 分类过滤与色标徽章。
  -->
  <section class="ra-archive card ob-panel px-3 py-2.5">
    <div class="flex items-center justify-between">
      <span class="micro flex items-center gap-1.5 text-[12px] text-(--rac-hi)">
        <Icon name="archive" :size="12" />
        新设定归档
      </span>
      <button class="sysbtn" :disabled="archBusy" @click="refreshArchive">刷新</button>
    </div>

    <!-- 分类过滤栏（支持 人物 / 科技 / 建筑 / 载具 / 人员 / 装备） -->
    <div class="mt-2 flex flex-wrap items-center gap-1" data-test="archive-kind-filters">
      <button
        type="button"
        class="kind-filter-btn"
        :class="{ 'is-active': selectedKind === 'all' }"
        @click="selectedKind = 'all'"
      >
        全部 ({{ unfiledArchCandidates.length }})
      </button>
      <button
        v-for="k in ARCHIVE_FILTER_KINDS"
        :key="k"
        type="button"
        class="kind-filter-btn"
        :class="[KIND_BADGE_CLASS[k] ?? '', { 'is-active': selectedKind === k }]"
        :data-kind="k"
        @click="selectedKind = k"
      >
        {{ k === '人物' ? 'NPC人物' : k }} ({{ archKindCounts[k] ?? 0 }})
      </button>
    </div>

    <template v-if="archReady">
      <div v-if="filteredArchCandidates.length" class="mt-1.5">
        <div style="color: var(--rac-text); font-size: 12px">
          待归档词条（共 {{ filteredArchCandidates.length }} 条，建议在本轮剧情稳定后归档）：
        </div>
        <label
          v-for="c in filteredArchCandidates"
          :key="c.name"
          class="mt-1 flex items-center gap-1.5"
          style="font-size: 12px; cursor: pointer"
        >
          <input type="checkbox" :checked="archSel.has(c.name)" @change="toggleArchSel(c.name)" />
          <span class="kind-badge" :class="KIND_BADGE_CLASS[c.kind] ?? 'badge-other'">{{ c.kind }}</span>
          <span style="color: var(--rac-hi)">{{ c.kind }}·{{ c.name }}</span>
          <span
            v-if="c.kind === '人物' && (c.params?.['所属势力'] || c.params?.['势力'] || c.params?.['态度'] || c.params?.['信任度'])"
            style="color: var(--rac-warn); font-size: 11px"
          >
            [{{ [c.params?.['所属势力'] || c.params?.['势力'], c.params?.['态度'], c.params?.['信任度'] ? `信任:${c.params['信任度']}` : ''].filter(Boolean).join(' · ') }}]
          </span>
          <span style="color: var(--rac-muted)">{{ (c.desc ?? '').slice(0, 26) }}</span>
        </label>
        <button
          class="sysbtn sysbtn--danger mt-1.5"
          :disabled="!env.inTavern || !archSel.size || archBusy"
          @click="doArchive"
        >
          {{ archBusy ? '归档中…' : `归档 ${archSel.size} 条 →《EVA·动态档案》` }}
        </button>
      </div>
      <div v-else class="mt-1.5" style="color: var(--rac-muted); font-size: 12px">
        当前所有在册人员与扩展设定均已入库（无待归档动态内容，新登场的扩展档案与机娘默认自动存入当前聊天档案书）
      </div>
      <div v-if="archOrphans.length" class="mt-2 border-t pt-1.5" style="border-color: var(--rac-dim)">
        <div style="color: var(--warn); font-size: 12px">
          回退残留词条 {{ archOrphans.length }} 条（世界书中已存在、但当前楼层变量中缺失，通常由回退消息产生）：
        </div>
        <div v-for="o in archOrphans" :key="o" class="mt-1 flex items-center gap-2" style="font-size: 12px">
          <span style="color: var(--rac-hi)">{{ o }}</span>
          <span class="flex-1"></span>
          <button class="sysbtn" :disabled="archBusy" @click="doOrphan(o, 'restore')">恢复到当前进度</button>
          <button class="sysbtn sysbtn--danger" :disabled="archBusy" @click="doOrphan(o, 'delete')">删除条目</button>
        </div>
      </div>
      <div v-if="archMsg" class="mt-1.5" style="color: var(--ok); font-size: 12px">{{ archMsg }}</div>
      <div v-if="archErr" class="mt-1.5" style="color: var(--danger); font-size: 12px">{{ archErr }}</div>
    </template>
    <div v-else class="mt-1.5" style="color: var(--rac-muted); font-size: 12px">
      <!-- 变量→世界书晋升管道 -->
      将剧情中新出现的单位、科技或人物永久保存至《EVA·动态档案》世界书（独立预览环境不可用）
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import { archiveCodexEntries, resolveOrphan } from '../../红警指挥系统/worldbook/dlcInstaller';
import { in_tavern, useDataStore } from '../../红警指挥系统/composables/store';
import { checkEnv, readArchive, type ArchiveRecord } from '../../红警指挥系统/parse/systemCheck';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';
import { updateFloorVars } from '../host/floorVarWrite';
import { emptyCounts } from '../models/archiveIndex';
import { EXPANSION_KINDS, KIND_BADGE_CLASS } from '../models/expansionView';

const store = useDataStore();
const floating = useFloatingStore();
const env = checkEnv(in_tavern);

const ARCHIVE_FILTER_KINDS = [...EXPANSION_KINDS] as const;
const selectedKind = ref<'all' | string>('all');

/* ── 动态归档（逐字搬自 PanelSystem，仅保留本区自身逻辑，无体检态/总开关跨区联动） ── */
const archReady = ref(false);
const archRegistry = ref<Record<string, ArchiveRecord>>({});
const archOrphans = ref<string[]>([]);
const archSel = ref(new Set<string>());
const archBusy = ref(false);
const archMsg = ref('');
const archErr = ref('');
/** 待归档候选：codex 非阵营注册且未入 $archive */
const archCandidates = computed(() =>
  store.data.codex.filter(c => c.kind !== '阵营' && !(c.name in archRegistry.value)),
);

const CANONICAL_STARTER_GIRLS = new Set(['白凌', '喀秋莎', '尤里卡', '凛冬妮娅', '妮娅', '薇拉']);
const CANONICAL_STARTER_HUMANS = new Set(['萧栖雪', '杜月欣', '陆玉凝', '林晚', '苏晓']);

/**
 * 判定 codex 条目是否属于已在册核心人员（首发 MCV 机娘 / 开局随行人类人员）、
 * 已在 forces.girls 在编的机娘、或已标明归入《机娘·能力档案》的派生索引。
 */
function isAlreadyRosteredOrCanonical(c: (typeof store.data.codex)[number]): boolean {
  const name = (c.name ?? '').trim();
  if (!name) return true;
  if (CANONICAL_STARTER_GIRLS.has(name) || name.startsWith('待授名·')) return true;
  if (CANONICAL_STARTER_HUMANS.has(name)) return true;
  if (c.params?.['随行渊源'] || c.params?.['席位任命']) return true;
  const girls = store.data.forces?.girls ?? [];
  if (girls.some(g => g.name === name || g.callsign === name || g.alias === name)) return true;
  if ((c.desc ?? '').includes('完整技能档案见《机娘·能力档案》')) return true;
  return false;
}

const unfiledArchCandidates = computed(() =>
  archCandidates.value.filter(c => !isAlreadyRosteredOrCanonical(c)),
);

const archKindCounts = computed(() => {
  const counts = emptyCounts();
  for (const c of unfiledArchCandidates.value) {
    const k = c.kind as keyof typeof counts;
    if (k in counts && k !== 'total') {
      counts[k] += 1;
    } else {
      counts.其他 += 1;
    }
    counts.total += 1;
  }
  return counts;
});

const filteredArchCandidates = computed(() => {
  if (selectedKind.value === 'all') return unfiledArchCandidates.value;
  return unfiledArchCandidates.value.filter(c => c.kind === selectedKind.value);
});

async function refreshArchive() {
  archMsg.value = '';
  archErr.value = '';
  const arch = await readArchive();
  if (arch === null) {
    archReady.value = false;
    return;
  }
  archRegistry.value = arch;
  const codexNames = new Set(store.data.codex.map(c => c.name));
  archOrphans.value = Object.keys(arch).filter(n => !codexNames.has(n));
  archReady.value = true;
}
function toggleArchSel(name: string) {
  const s = new Set(archSel.value);
  if (s.has(name)) s.delete(name);
  else s.add(name);
  archSel.value = s;
}
async function doArchive() {
  archBusy.value = true;
  archMsg.value = '';
  archErr.value = '';
  try {
    const items = store.data.codex.filter(c => archSel.value.has(c.name));
    const written = await archiveCodexEntries(items);
    archSel.value = new Set();
    await refreshArchive();
    archMsg.value = `◆ 已归档 ${written.length} 条：${written.join('、')}`;
  } catch (e) {
    archErr.value = e instanceof Error ? e.message : String(e);
  } finally {
    archBusy.value = false;
  }
}
async function doOrphan(name: string, action: 'restore' | 'delete') {
  archBusy.value = true;
  archMsg.value = '';
  archErr.value = '';
  try {
    const rec = await resolveOrphan(name, action);
    if (action === 'restore' && rec) {
      if (!store.data.codex.some(c => c.name === name)) {
        store.data.codex.push({
          name,
          kind: rec.kind,
          desc: rec.desc,
          params: rec.params,
        } as (typeof store.data.codex)[number]);
      }
      if (floating.floorId !== null) {
        await updateFloorVars(floating.floorId, vars => {
          const sd = (vars.stat_data ?? {}) as Record<string, unknown>;
          const codex = Array.isArray(sd.codex)
            ? (structuredClone(sd.codex) as (typeof store.data.codex)[number][])
            : [];
          if (!codex.some(c => c.name === name)) {
            codex.push({
              name,
              kind: rec.kind,
              desc: rec.desc,
              params: rec.params,
            } as (typeof store.data.codex)[number]);
          }
          return { ...vars, stat_data: { ...sd, codex } };
        });
        await floating.refresh();
      }
    }
    await refreshArchive();
    archMsg.value =
      action === 'restore' ? `◆ 已将「${name}」恢复至当前进度（世界书条目保留）` : `◆ 已删除「${name}」正史条目并除册`;
  } catch (e) {
    archErr.value = e instanceof Error ? e.message : String(e);
  } finally {
    archBusy.value = false;
  }
}

onMounted(() => {
  void refreshArchive();
});
</script>

<style scoped>
.ra-archive .sysbtn {
  font-size: 12px;
  letter-spacing: 0.04em;
  padding: 4px 12px;
  border: 1px solid var(--rac-dim);
  border-radius: 2px;
  background: var(--rac-panel-2);
  color: var(--rac-text);
}
.ra-archive .sysbtn:hover:not(:disabled) {
  border-color: var(--rac-line);
  color: var(--rac-hi);
}
.ra-archive .sysbtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ra-archive .sysbtn--danger {
  color: var(--rac-alert);
  border-color: var(--rac-alert);
}
.ra-archive .sysbtn--danger:disabled {
  opacity: 0.5;
}
.kind-filter-btn {
  font-size: 12px;
  padding: 2px 8px;
  border: 1px solid var(--rac-dim);
  border-radius: 2px;
  color: var(--rac-muted);
  background: var(--rac-panel);
  cursor: pointer;
}
.kind-filter-btn.is-active {
  color: var(--rac-hi);
  border-color: var(--rac-accent);
  background: color-mix(in srgb, var(--rac-accent) 14%, transparent);
}
.kind-badge {
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 2px;
  border: 1px solid var(--rac-dim);
  color: var(--rac-text);
}
.badge-npc {
  color: var(--rac-warn);
  border-color: color-mix(in srgb, var(--rac-warn) 45%, transparent);
  background: color-mix(in srgb, var(--rac-warn) 14%, transparent);
}
</style>
