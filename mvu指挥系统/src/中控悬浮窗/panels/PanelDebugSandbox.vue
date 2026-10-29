<template>
  <div class="ra-debug-sandbox flex flex-col gap-3 text-[12px] text-(--rac-text)">
    <!-- 顶部状态概览与快照安全网 -->
    <div class="ob-panel rounded-[2px] border border-(--rac-warn)/40 bg-(--rac-panel) p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <span
            class="inline-flex items-center rounded-[2px] border border-(--rac-warn)/40 bg-(--rac-panel-2) px-2 py-0.5 font-mono text-[11px] font-bold text-(--rac-warn)"
          >
            ◆ DEV SANDBOX
          </span>
          <span class="text-[13px] font-semibold text-(--rac-hi)">
            开发者沙盒调试台 · 锚定楼层 #{{ floating.floorId ?? '未就绪' }}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="rounded-[2px] border border-(--rac-accent)/50 bg-(--rac-panel-2) px-2.5 py-1 text-[12px] font-medium text-(--rac-accent) hover:bg-(--rac-bg) disabled:opacity-40"
            :disabled="busy || floating.floorId === null"
            @click="onManualBackup"
          >
            ◆ 备份当前楼层快照
          </button>
          <button
            type="button"
            class="rounded-[2px] border border-(--rac-alert)/50 bg-(--rac-panel-2) px-2.5 py-1 text-[12px] font-medium text-(--rac-alert) hover:bg-(--rac-bg) disabled:opacity-40"
            :disabled="busy || !backupMeta"
            @click="onRestoreBackup"
          >
            ← 一键还原快照{{ backupMeta ? ` (${backupMeta.time})` : '' }}
          </button>
        </div>
      </div>

      <!-- 实时核心指标 -->
      <div class="mt-2.5 grid grid-cols-2 gap-2 border-t border-(--rac-dim) pt-2 text-[11px] sm:grid-cols-6">
        <div class="ob-readout rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) px-2 py-1">
          <div class="text-[12px] text-(--rac-muted)">当前战区时间</div>
          <div class="truncate font-mono text-(--rac-warn)">{{ floating.snapshot.meta.datetime || '-' }}</div>
        </div>
        <div class="ob-readout rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) px-2 py-1">
          <div class="text-[12px] text-(--rac-muted)">系统资金</div>
          <div class="font-mono font-semibold text-(--rac-ok)">${{ floating.snapshot.economy.credits }}</div>
        </div>
        <div class="ob-readout rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) px-2 py-1">
          <div class="text-[12px] text-(--rac-muted)">已启封阵营</div>
          <div class="font-mono text-(--rac-accent)">{{ (floating.snapshot.command.unlocked_factions || []).join(' / ') }}</div>
        </div>
        <div class="ob-readout rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) px-2 py-1">
          <div class="text-[12px] text-(--rac-muted)">辖属基地数</div>
          <div class="font-mono text-(--rac-hi)">{{ floating.snapshot.bases.length }} 座</div>
        </div>
        <div class="ob-readout rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) px-2 py-1">
          <div class="text-[12px] text-(--rac-muted)">已研科技数</div>
          <div class="font-mono text-(--rac-warn)">{{ floating.snapshot.tech.done.length }} 项</div>
        </div>
        <div class="ob-readout rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) px-2 py-1">
          <div class="text-[12px] text-(--rac-muted)">在册队列数</div>
          <div class="font-mono text-(--rac-accent)">{{ floating.snapshot.queues.length }} 项</div>
        </div>
      </div>

      <div
        v-if="statusMsg"
        class="mt-2 rounded-[2px] border border-(--rac-ok)/40 bg-(--rac-bg) px-2.5 py-1.5 font-mono text-[11px] text-(--rac-ok)"
      >
        {{ statusMsg }}
      </div>
    </div>

    <!-- 1. 全解锁上帝预览开关 -->
    <div class="rounded-[2px] border border-(--rac-dim) bg-(--rac-panel) p-3">
      <div class="mb-2 flex items-center justify-between">
        <span class="font-semibold text-(--rac-warn)">1. 全解锁上帝预览开关（纯前端视图透视，不污染楼层存档）</span>
        <span class="text-[11px] text-(--rac-muted)">持久化于浏览器本地存储</span>
      </div>
      <div class="grid grid-cols-1 gap-2.5 md:grid-cols-3">
        <label
          class="flex cursor-pointer items-start gap-2.5 rounded-[2px] border p-2.5 transition-colors"
          :class="
            debugState.enabled
              ? 'border-(--rac-warn)/60 bg-(--rac-panel-2) text-(--rac-hi)'
              : 'border-(--rac-dim) bg-(--rac-bg) text-(--rac-text)'
          "
        >
          <input
            v-model="debugState.enabled"
            type="checkbox"
            class="mt-0.5 accent-(--rac-warn)"
            @change="onToggleDebugMaster"
          />
          <div>
            <div class="font-semibold">启用开发者调试模式总开关</div>
            <div class="mt-0.5 text-[11px] text-(--rac-muted)">
              开启后在顶栏显示 DEV 徽标，开放工程车间并联动启用工程/巨构世界书
            </div>
          </div>
        </label>

        <label
          class="flex cursor-pointer items-start gap-2.5 rounded-[2px] border p-2.5 transition-colors"
          :class="
            debugState.enabled && debugState.bypassPrerequisites
              ? 'border-(--rac-ok)/60 bg-(--rac-panel-2) text-(--rac-hi)'
              : 'border-(--rac-dim) bg-(--rac-bg) text-(--rac-text)'
          "
        >
          <input
            v-model="debugState.bypassPrerequisites"
            type="checkbox"
            class="mt-0.5 accent-(--rac-ok)"
            @change="onToggleBypass"
          />
          <div>
            <div class="font-semibold">全图鉴前置条件全解锁预览</div>
            <div class="mt-0.5 text-[11px] text-(--rac-muted)">
              无视建造厂/母体建筑/前置科技限制，在建造网格、建筑树、科技树、工程车间查看全图鉴
            </div>
          </div>
        </label>

        <label
          class="flex cursor-pointer items-start gap-2.5 rounded-[2px] border p-2.5 transition-colors"
          :class="
            debugState.enabled && debugState.unlockAllFactionsPreview
              ? 'border-(--rac-accent)/60 bg-(--rac-panel-2) text-(--rac-hi)'
              : 'border-(--rac-dim) bg-(--rac-bg) text-(--rac-text)'
          "
        >
          <input
            v-model="debugState.unlockAllFactionsPreview"
            type="checkbox"
            class="mt-0.5 accent-(--rac-accent)"
            @change="onToggleUnlockAllFactions"
          />
          <div>
            <div class="font-semibold">跨阵营图鉴全透视 (盟/苏/尤)</div>
            <div class="mt-0.5 text-[11px] text-(--rac-muted)">
              无视当前已启封阵营限制，直接开放全部阵营过滤页签与专属建筑/单位/科技浏览
            </div>
          </div>
        </label>
      </div>
    </div>

    <!-- 2. 免 LLM 快捷状态注入 -->
    <div class="flex flex-col gap-3 rounded-[2px] border border-(--rac-dim) bg-(--rac-panel) p-3">
      <div class="flex items-center justify-between">
        <span class="font-semibold text-(--rac-warn)">
          2. 快捷修改当前存档数据（直接修改当前楼层数据，首次修改前自动备份）
        </span>
        <div class="flex items-center gap-1.5 text-[12px]">
          <span class="text-(--rac-muted)">目标基地:</span>
          <select
            v-model.number="targetBaseIdx"
            class="rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) px-2 py-0.5 text-[12px] text-(--rac-text)"
          >
            <option v-for="(b, idx) in floating.snapshot.bases" :key="b.id || idx" :value="idx">
              [{{ idx + 1 }}] {{ b.name || b.id }} ({{ b.buildings.length }}座)
            </option>
          </select>
        </div>
      </div>

      <!-- 资金与六柱资源 -->
      <div class="flex flex-wrap items-center gap-2">
        <span class="w-24 shrink-0 text-[12px] text-(--rac-muted)">◆ 资金与战略资源:</span>
        <button
          type="button"
          class="debug-btn border-(--rac-ok)/40 text-(--rac-ok)"
          :disabled="busy"
          @click="runMutation('资金 +$10,000', d => debugMutateCredits(d, 'add10k'))"
        >
          +$10,000 资金
        </button>
        <button
          type="button"
          class="debug-btn border-(--rac-ok)/40 text-(--rac-ok)"
          :disabled="busy"
          @click="runMutation('资金 +$100,000', d => debugMutateCredits(d, 'add100k'))"
        >
          +$100,000 资金
        </button>
        <button
          type="button"
          class="debug-btn border-(--rac-dim) text-(--rac-text)"
          :disabled="busy"
          @click="runMutation('资金设为 $50,000', d => debugMutateCredits(d, 'set50k'))"
        >
          设为 $50,000
        </button>
        <button
          type="button"
          class="debug-btn border-(--rac-dim) text-(--rac-muted)"
          :disabled="busy"
          @click="runMutation('资金重置为 $2,000', d => debugMutateCredits(d, 'reset2k'))"
        >
          重置 $2,000
        </button>
        <button
          type="button"
          class="debug-btn border-(--rac-warn)/50 text-(--rac-warn)"
          :disabled="busy"
          @click="runMutation('灌满全部战略物资 (+5000) & 协议点 (+500)', d => debugFillAllResourcesAndPoints(d, 5000))"
        >
          + 灌满全部战略物资 (+5000) & 协议点 (+500)
        </button>
      </div>

      <!-- 阵营与基地核心建筑 -->
      <div class="flex flex-wrap items-center gap-2">
        <span class="w-24 shrink-0 text-[12px] text-(--rac-muted)">◆ 阵营与母体建筑:</span>
        <button
          type="button"
          class="debug-btn border-(--rac-alert)/40 text-(--rac-alert)"
          :disabled="busy"
          @click="runMutation('启封苏联体系权限', d => debugUnlockFactions(d, ['soviet']))"
        >
          ◆ 启封苏联体系
        </button>
        <button
          type="button"
          class="debug-btn border-(--rac-warn)/40 text-(--rac-warn)"
          :disabled="busy"
          @click="runMutation('启封全阵营 (盟/苏/尤)', d => debugUnlockFactions(d, ['allied', 'soviet', 'yuri']))"
        >
          ◆ 全阵营启封
        </button>
        <button
          type="button"
          class="debug-btn border-(--rac-accent)/40 text-(--rac-accent)"
          :disabled="busy"
          @click="runMutation('当前基地展开盟军建造厂', d => debugApplyBuildingPreset(d, targetBaseIdx, 'allied_conyard'))"
        >
          展开盟军建造厂
        </button>
        <button
          type="button"
          class="debug-btn border-(--rac-accent)/50 text-(--rac-accent)"
          :disabled="busy"
          @click="
            runMutation('当前基地铺满盟军核心母体建筑群', d => debugApplyBuildingPreset(d, targetBaseIdx, 'allied_full_core'))
          "
        >
          ◆ 铺满盟军核心母体群 (兵营/车厂/空指/船坞/实验室)
        </button>
        <button
          type="button"
          class="debug-btn border-(--rac-alert)/50 text-(--rac-alert)"
          :disabled="busy"
          @click="
            runMutation('当前基地铺满苏联核心母体建筑群', d => debugApplyBuildingPreset(d, targetBaseIdx, 'soviet_full_core'))
          "
        >
          ◆ 铺满苏联核心母体群 (含工业工厂/红星设计局)
        </button>
        <button
          type="button"
          class="debug-btn border-(--rac-warn)/50 text-(--rac-warn)"
          :disabled="busy"
          @click="
            runMutation('新建第2基地「北方红星分基地」(苏联全母体)', d =>
              debugApplyBuildingPreset(d, targetBaseIdx, 'spawn_second_base_soviet'),
            )
          "
        >
          + 新建第2基地「北方红星分基地」(跨基地协同测试)
        </button>
      </div>

      <!-- 科技与测试部队 -->
      <div class="flex flex-wrap items-center gap-2">
        <span class="w-24 shrink-0 text-[12px] text-(--rac-muted)">◆ 科技与测试兵力:</span>
        <button
          type="button"
          class="debug-btn border-(--rac-accent)/40 text-(--rac-accent)"
          :disabled="busy"
          @click="runMutation('解锁全部 T1 基础科技', d => debugUnlockResearches(d, catalog.researches, 1))"
        >
          ◆ 解锁全部 T1 科技
        </button>
        <button
          type="button"
          class="debug-btn border-(--rac-accent)/50 text-(--rac-accent)"
          :disabled="busy"
          @click="runMutation('解锁全部 T1+T2 科技', d => debugUnlockResearches(d, catalog.researches, 2))"
        >
          ◆ 解锁 T1+T2 科技
        </button>
        <button
          type="button"
          class="debug-btn border-(--rac-warn)/50 text-(--rac-warn)"
          :disabled="busy"
          @click="runMutation('解锁全量科技 (T1-T3)', d => debugUnlockResearches(d, catalog.researches, 3))"
        >
          ▲ 解锁全量科技 (T1-T3)
        </button>
        <button
          type="button"
          class="debug-btn border-(--rac-dim) text-(--rac-muted)"
          :disabled="busy"
          @click="runMutation('重置科技为初始态', d => debugUnlockResearches(d, catalog.researches, 'clear'))"
        >
          × 重置科技
        </button>
        <button
          type="button"
          class="debug-btn border-(--rac-ok)/50 text-(--rac-ok)"
          :disabled="busy"
          @click="runMutation('注入三军代表性测试部队 (验证 unit_present)', d => debugInjectTestForces(d))"
        >
          + 注入三军测试部队 (F-16C/艾布拉姆斯/天启/基洛夫)
        </button>
      </div>
    </div>

    <!-- 3. 免 LLM 时间推进与队列结算器 -->
    <div class="flex flex-col gap-2.5 rounded-[2px] border border-(--rac-dim) bg-(--rac-panel) p-3">
      <div class="flex items-center justify-between">
        <span class="font-semibold text-(--rac-warn)">
          3. 免 LLM 时间推进与队列结算器（直接调用 settleFloor 推进时钟与在建队列）
        </span>
        <span class="text-[11px] text-(--rac-muted)">无需等待大模型回复即可验证跨楼层结算</span>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="debug-btn border-(--rac-accent)/40 text-(--rac-accent)"
          :disabled="busy"
          @click="onAdvanceTime(30, '+30 分钟')"
        >
          → 推进 +30 分钟
        </button>
        <button
          type="button"
          class="debug-btn border-(--rac-accent)/40 text-(--rac-accent)"
          :disabled="busy"
          @click="onAdvanceTime(120, '+2 小时')"
        >
          → 推进 +2 小时
        </button>
        <button
          type="button"
          class="debug-btn border-(--rac-accent)/50 text-(--rac-accent)"
          :disabled="busy"
          @click="onAdvanceTime(360, '+6 小时')"
        >
          → 推进 +6 小时
        </button>
        <button
          type="button"
          class="debug-btn border-(--rac-warn)/50 text-(--rac-warn)"
          :disabled="busy"
          @click="onAdvanceTime(1440, '+1 天 (24h)')"
        >
          → 推进 +1 天 (24h)
        </button>
        <button
          type="button"
          class="debug-btn border-(--rac-ok)/50 text-(--rac-ok)"
          :disabled="busy"
          @click="runMutation('队列全部瞬间完工并入账', d => debugSettleOrClearQueues(d, 'complete_all'))"
        >
          ● 队列全部瞬间完工入账
        </button>
        <button
          type="button"
          class="debug-btn border-(--rac-dim) text-(--rac-muted)"
          :disabled="busy"
          @click="runMutation('清理已完工队列记录', d => debugSettleOrClearQueues(d, 'clear_done'))"
        >
          × 清理已完工队列
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useCatalogStore } from '../../红警指挥系统/composables/useCatalog';
import {
  cloneValidStatData,
  debugApplyBuildingPreset,
  debugFillAllResourcesAndPoints,
  debugInjectTestForces,
  debugMutateCredits,
  debugSettleOrClearQueues,
  debugState,
  debugUnlockFactions,
  debugUnlockResearches,
  ensureFloorDebugBackup,
  getFloorDebugBackupMeta,
  restoreFloorDebugBackup,
  saveFloorDebugBackup,
} from '../../红警指挥系统/composables/useDebugMode';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';
import { Schema, type StatData } from '../../红警指挥系统/core/schema';
import { settleFloor } from '../../红警指挥系统/engines/settleFloor';
import { syncMultiFactionWorldbooksOnFloorEvent } from '../host/floorObservers';
import { updateFloorVars } from '../host/floorVarWrite';

const floating = useFloatingStore();
const catalog = useCatalogStore();

const busy = ref(false);
const statusMsg = ref('');
const targetBaseIdx = ref(0);

const backupMeta = computed(() => getFloorDebugBackupMeta(floating.floorId));

async function onToggleDebugMaster() {
  try {
    await syncMultiFactionWorldbooksOnFloorEvent({
      engineeringEnabled: Boolean(debugState.enabled),
    });
  } catch {
    /* 非宿主环境静默忽略 */
  }
  statusMsg.value = debugState.enabled
    ? '已开启开发者调试模式 · 工程车间与巨构世界书已同步开启'
    : '已关闭开发者调试模式 · 工程车间与巨构世界书已同步停用';
}

function onToggleBypass() {
  if (debugState.bypassPrerequisites && !debugState.enabled) {
    debugState.enabled = true;
    void onToggleDebugMaster();
  }
  statusMsg.value = debugState.bypassPrerequisites
    ? '已开启「全图鉴前置条件全解锁预览」（不改写存档）'
    : '已关闭「全图鉴前置条件全解锁预览」';
}

function onToggleUnlockAllFactions() {
  if (debugState.unlockAllFactionsPreview && !debugState.enabled) {
    debugState.enabled = true;
    void onToggleDebugMaster();
  }
  statusMsg.value = debugState.unlockAllFactionsPreview
    ? '已开启「跨阵营图鉴全透视 (盟/苏/尤)」'
    : '已关闭「跨阵营图鉴全透视」';
}

function onManualBackup() {
  if (floating.floorId === null) return;
  saveFloorDebugBackup(floating.floorId, floating.snapshot);
  statusMsg.value = `已备份 #${floating.floorId} 楼 stat_data 快照`;
}

async function onRestoreBackup() {
  if (floating.floorId === null) return;
  const restored = restoreFloorDebugBackup(floating.floorId);
  if (!restored) {
    statusMsg.value = '未找到可还原的楼层快照';
    return;
  }
  busy.value = true;
  try {
    await updateFloorVars(floating.floorId, vars => {
      vars.stat_data = restored;
      return vars;
    });
    await floating.refresh();
    statusMsg.value = `已将 #${floating.floorId} 楼完整还原至备份快照 (${backupMeta.value?.time ?? ''})`;
  } catch (e) {
    statusMsg.value = `还原失败: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    busy.value = false;
  }
}

async function runMutation(label: string, mutator: (cur: StatData) => StatData) {
  if (floating.floorId === null) {
    statusMsg.value = '当前未锚定有效楼层，无法写入 stat_data';
    return;
  }
  busy.value = true;
  try {
    ensureFloorDebugBackup(floating.floorId, floating.snapshot);
    await updateFloorVars(floating.floorId, vars => {
      const cur = cloneValidStatData(vars.stat_data ?? floating.snapshot);
      vars.stat_data = mutator(cur);
      return vars;
    });
    await floating.refresh();
    statusMsg.value = `● [沙盒注入成功] ${label}`;
  } catch (e) {
    statusMsg.value = `× 注入失败: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    busy.value = false;
  }
}

async function onAdvanceTime(minutes: number, label: string) {
  if (floating.floorId === null) {
    statusMsg.value = '当前未锚定有效楼层，无法推进时间';
    return;
  }
  busy.value = true;
  try {
    ensureFloorDebugBackup(floating.floorId, floating.snapshot);
    let settledCount = 0;
    await updateFloorVars(floating.floorId, vars => {
      const cur = cloneValidStatData(vars.stat_data ?? floating.snapshot);
      const res = settleFloor(cur, cur, '', {
        catalog: {
          buildings: catalog.buildings,
          productions: catalog.productions,
          researches: catalog.researches,
        },
        extraDeltaMinutes: minutes,
      });
      settledCount = res.completed?.length ?? 0;
      vars.stat_data = Schema.parse(res.data);
      return vars;
    });
    await floating.refresh();
    statusMsg.value = `● [时间推进 ${label}] 新时间: ${floating.snapshot.meta.datetime}（本轮自动结算完工 ${settledCount} 项）`;
  } catch (e) {
    statusMsg.value = `× 时间推进失败: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.debug-btn {
  border-width: 1px;
  border-radius: 2px;
  background-color: var(--rac-bg);
  padding: 0.25rem 0.6rem;
  font-size: 12px;
  line-height: 1.35;
  transition: background-color 0.15s ease;
}
.debug-btn:hover:not(:disabled) {
  background-color: var(--rac-panel-2);
}
.debug-btn:disabled {
  opacity: 0.4;
}
</style>
