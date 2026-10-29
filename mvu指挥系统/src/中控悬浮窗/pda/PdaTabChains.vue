<template>
  <div
    class="pda-tab-chains flex h-full flex-1 flex-col overflow-hidden font-mono text-xs text-(--text,#d9e5ed) select-none"
    :data-daily-net="dailyNet"
    :data-chain-count="chainsList.length"
    :data-testid="'pda-tab-chains'"
  >
    <!-- ══ 顶栏：日均收支总览看板 (DailyNet) ══ -->
    <div
      class="flex items-center justify-between border-b border-(--line,rgba(141,180,207,0.12)) bg-(--deep-1,rgba(7,12,17,0.8)) px-3 py-2"
      :data-testid="'pda-chains-summary-bar'"
    >
      <div class="flex flex-col gap-0.5">
        <span class="text-[10px] tracking-wider text-(--text-3,#7a8e9a)">DAILY NET // 标称日均净收益</span>
        <span
          class="text-sm/tight font-bold tracking-wide"
          :class="dailyNetClass"
          :data-testid="'pda-chains-daily-net'"
        >
          {{ dailyNetFormatted }}
        </span>
      </div>

      <div class="flex flex-col items-end gap-0.5 text-[10px]">
        <span class="text-(--text-3,#7a8e9a)">在册链条: {{ chainsList.length }}</span>
        <span
          v-if="abnormalCount > 0"
          class="rounded-xs bg-(--alert-bright,#ff5a36)/20 px-1.5 py-0.5 font-bold text-(--alert-bright,#ff5a36)"
          :data-testid="'pda-chains-abnormal-badge'"
        >
          异常告警: {{ abnormalCount }}
        </span>
        <span v-else class="text-(--safe,#78b69b)">全网运转平稳</span>
      </div>
    </div>

    <!-- ══ 主体：资金链工况卡片列表 ══ -->
    <div class="flex-1 overflow-y-auto px-2.5 py-2">
      <div
        v-if="chainsList.length === 0"
        class="flex h-full min-h-[160px] flex-col items-center justify-center gap-1.5 text-center text-(--text-3,#7a8e9a)"
        :data-testid="'pda-chains-empty'"
      >
        <span class="text-[11px] font-bold text-(--ice,#8bc3e7)">[ 暂无活跃资金链条 ]</span>
        <span class="text-[10px] text-(--text-4,#354957)">战区尚未建立持续性商路、矿脉或采购合同</span>
      </div>

      <div v-else class="flex flex-col gap-2" :data-testid="'pda-chains-list'">
        <article
          v-for="chain in chainsList"
          :key="chain.id"
          class="pda-chain-card flex flex-col gap-1.5 rounded-sm border p-2 transition-colors"
          :class="cardBorderClass(chain)"
          :data-chain-id="chain.id"
          :data-chain-status="chain.status"
          :data-chain-flow="chain.flow"
          :data-testid="'pda-chain-card'"
        >
          <!-- 第一行：流向标识 + 链条名称 + 五态标签 -->
          <div class="flex items-center justify-between gap-1.5">
            <div class="flex items-center gap-1.5 overflow-hidden">
              <span
                class="shrink-0 rounded-xs px-1 py-0.5 text-[10px] leading-none font-bold"
                :class="
                  chain.flow === '支出'
                    ? 'bg-(--alert-bright,#ff5a36)/20 text-(--alert-bright,#ff5a36)'
                    : 'bg-(--safe,#78b69b)/20 text-(--safe,#78b69b)'
                "
                :data-testid="'pda-chain-flow'"
              >
                [{{ chain.flow }}]
              </span>
              <span
                v-if="getChainKind(chain)"
                class="shrink-0 rounded-xs border border-(--ice)/35 bg-(--ice)/12 px-1 py-0.5 text-[11px] leading-none font-bold text-(--ice)"
                :data-chain-kind="getChainKind(chain)"
                :data-testid="'pda-chain-kind'"
              >
                [{{ getChainKind(chain) }}]
              </span>
              <span class="truncate text-[11px] font-bold text-(--text,#d9e5ed)" :data-testid="'pda-chain-name'">
                {{ chain.name }}
              </span>
            </div>

            <!-- 五态标签 -->
            <span
              class="shrink-0 rounded-xs border px-1.5 py-0.5 text-[10px] leading-none font-bold"
              :class="statusBadgeClass(chain.status)"
              :data-status="chain.status"
              :data-testid="'pda-chain-status'"
            >
              {{ statusLabel(chain.status) }}
            </span>
          </div>

          <!-- 第二行：标称日额度 + 效率百分比指示 (eff: 100% / 0%) -->
          <div class="flex items-center justify-between text-[11px]">
            <span
              class="font-bold"
              :class="chain.flow === '支出' ? 'text-(--alert-bright,#ff5a36)' : 'text-(--safe,#78b69b)'"
              :data-testid="'pda-chain-rate'"
            >
              {{ chain.rate_daily }} CR/天
            </span>
            <span
              class="font-mono text-[10px] font-bold"
              :class="effTextClass(chain)"
              :data-testid="'pda-chain-eff'"
            >
              eff: {{ formatEffPercent(chain.eff) }}%
            </span>
          </div>

          <!-- 外币与实物货物日收支胶囊行 (FD-51) -->
          <div
            v-if="getMultitrackBadges(chain).length > 0"
            class="flex flex-wrap items-center gap-1 text-[11px]"
            :data-testid="'pda-chain-multitrack'"
          >
            <span
              v-for="(item, idx) in getMultitrackBadges(chain)"
              :key="idx"
              class="rounded-xs border border-(--ice)/30 bg-black/40 px-1.5 py-0.5 font-mono text-(--ice)"
            >
              {{ item }}
            </span>
          </div>

          <!-- 物理三要素依赖标签行 (FD-51) -->
          <div
            v-if="getChainDepBadges(chain).length > 0"
            class="flex flex-wrap items-center gap-1 text-[11px] text-(--text-2)"
            :data-testid="'pda-chain-deps'"
          >
            <span
              v-for="(dep, idx) in getChainDepBadges(chain)"
              :key="idx"
              class="rounded-xs border border-white/10 bg-black/30 px-1.5 py-0.5 font-mono"
            >
              {{ dep }}
            </span>
          </div>

          <!-- 断电停工 / 工况异常醒目警示条（当带有 reason 说明时醒目突出） -->
          <div
            v-if="chain.reason && chain.reason.trim() !== ''"
            class="flex items-start gap-1.5 rounded-xs border px-2 py-1 text-[10px] leading-snug font-bold"
            :class="reasonAlertClass(chain)"
            :data-alert-level="isSevereAlert(chain) ? 'critical' : 'warn'"
            :data-testid="'pda-chain-reason-alert'"
          >
            <span class="shrink-0">{{ isPowerOrBrokenAlert(chain) ? '⚡ 断电/停工告警:' : '⚠ 工况说明:' }}</span>
            <span class="break-all">{{ chain.reason }}</span>
          </div>

          <!-- 有限资源链的开采进度条 (extracted / total_yield) -->
          <div
            v-if="hasFiniteCapacity(chain)"
            class="mt-0.5 flex flex-col gap-1 rounded-xs bg-black/35 px-2 py-1"
            :data-testid="'pda-chain-capacity'"
          >
            <div class="flex items-center justify-between text-[10px] text-(--text-3,#7a8e9a)">
              <span>开采进度（已开采 / 总储量）</span>
              <span class="font-bold text-(--text,#d9e5ed)" :data-testid="'pda-chain-capacity-text'">
                {{ chain.capacity.extracted }} / {{ chain.capacity.total_yield }} ({{ capacityPercent(chain) }}%)
              </span>
            </div>
            <div class="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                class="h-full rounded-full transition-all duration-300"
                :class="
                  chain.status === 'exhausted' || capacityPercent(chain) >= 100
                    ? 'bg-(--alert-bright,#ff5a36)'
                    : 'bg-(--ice,#8bc3e7)'
                "
                :style="{ width: `${capacityPercent(chain)}%` }"
                :data-testid="'pda-chain-capacity-bar'"
              />
            </div>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getActivePinia } from 'pinia';
import { computed } from 'vue';
import { calcDailyNet } from '../../红警指挥系统/engines/chainEngine';
import type { ChainStatus, IncomeChain, Schema } from '../../红警指挥系统/core/schema';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';

export interface PdaTabChainsProps {
  chains?: IncomeChain[];
  snapshot?: Partial<Schema> | null;
}

const props = withDefaults(defineProps<PdaTabChainsProps>(), {
  chains: undefined,
  snapshot: undefined,
});

const STATUS_LABELS: Record<ChainStatus, string> = {
  active: '运转正常',
  distressed: '运转受挫',
  broken: '断裂停摆',
  exhausted: '开采枯竭',
  establishing: '筹建中',
};

const storeSnapshot = computed<Partial<Schema> | null>(() => {
  if (props.snapshot !== undefined) return props.snapshot;
  try {
    if (!getActivePinia()) return null;
    const floating = useFloatingStore();
    return floating.snapshot;
  } catch {
    return null;
  }
});

const chainsList = computed<readonly IncomeChain[]>(() => {
  if (props.chains !== undefined) {
    return props.chains;
  }
  return storeSnapshot.value?.economy?.chains ?? [];
});

const dailyNet = computed<number>(() => {
  return calcDailyNet(chainsList.value);
});

const dailyNetFormatted = computed<string>(() => {
  const net = dailyNet.value;
  const prefix = net > 0 ? '+' : '';
  return `${prefix}${net} CR/DAY`;
});

const dailyNetClass = computed<string>(() => {
  if (dailyNet.value > 0) return 'text-(--safe,#78b69b)';
  if (dailyNet.value < 0) return 'text-(--alert-bright,#ff5a36)';
  return 'text-(--text-2,#8fa3b1)';
});

const abnormalCount = computed<number>(() => {
  return chainsList.value.filter(
    c => c.status === 'distressed' || c.status === 'broken' || c.status === 'exhausted' || isPowerOrBrokenAlert(c),
  ).length;
});

function statusLabel(status: ChainStatus): string {
  return STATUS_LABELS[status] ?? status;
}

function formatEffPercent(eff: number | undefined): number {
  if (typeof eff !== 'number' || !Number.isFinite(eff)) return 0;
  return Math.round(Math.min(1, Math.max(0, eff)) * 100);
}

function isPowerOrBrokenAlert(chain: IncomeChain): boolean {
  const r = chain.reason ?? '';
  return (
    chain.status === 'broken' ||
    /断电|电网|断供|停产|停工|断裂|停摆/.test(r) ||
    (chain.eff === 0 && r.trim().length > 0)
  );
}

function isSevereAlert(chain: IncomeChain): boolean {
  return chain.status === 'broken' || chain.status === 'exhausted' || isPowerOrBrokenAlert(chain);
}

function cardBorderClass(chain: IncomeChain): string {
  if (chain.status === 'broken' || isPowerOrBrokenAlert(chain)) {
    return 'border-(--alert-bright,#ff5a36)/55 bg-(--alert-bright,#ff5a36)/8';
  }
  if (chain.status === 'distressed') {
    return 'border-(--amber,#d2ad69)/50 bg-(--amber,#d2ad69)/8';
  }
  if (chain.status === 'exhausted') {
    return 'border-white/10 bg-black/50 opacity-75';
  }
  return 'border-white/10 bg-black/35';
}

function statusBadgeClass(status: ChainStatus): string {
  switch (status) {
    case 'active':
      return 'border-(--safe,#78b69b)/45 bg-(--safe,#78b69b)/15 text-(--safe,#78b69b)';
    case 'distressed':
      return 'border-(--amber,#d2ad69)/45 bg-(--amber,#d2ad69)/20 text-(--amber,#d2ad69)';
    case 'broken':
      return 'border-(--alert-bright,#ff5a36)/55 bg-(--alert-bright,#ff5a36)/25 text-(--alert-bright,#ff5a36)';
    case 'exhausted':
      return 'border-white/20 bg-white/10 text-(--text-3,#7a8e9a)';
    case 'establishing':
    default:
      return 'border-(--ice,#8bc3e7)/40 bg-(--ice,#8bc3e7)/15 text-(--ice,#8bc3e7)';
  }
}

function effTextClass(chain: IncomeChain): string {
  const pct = formatEffPercent(chain.eff);
  if (pct === 0 || chain.status === 'broken') return 'text-(--alert-bright,#ff5a36)';
  if (pct < 100 || chain.status === 'distressed') return 'text-(--amber,#d2ad69)';
  return 'text-(--safe,#78b69b)';
}

function reasonAlertClass(chain: IncomeChain): string {
  if (isSevereAlert(chain)) {
    return 'border-(--alert-bright,#ff5a36)/60 bg-(--alert-bright,#ff5a36)/20 text-(--alert-bright,#ff5a36)';
  }
  return 'border-(--amber,#d2ad69)/60 bg-(--amber,#d2ad69)/20 text-(--amber,#d2ad69)';
}

function hasFiniteCapacity(chain: IncomeChain): boolean {
  return (
    chain.capacity !== undefined &&
    chain.capacity !== null &&
    typeof chain.capacity.total_yield === 'number' &&
    Number.isFinite(chain.capacity.total_yield) &&
    chain.capacity.total_yield > 0
  );
}

function capacityPercent(chain: IncomeChain): number {
  const total = chain.capacity?.total_yield;
  const extracted = chain.capacity?.extracted ?? 0;
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return 0;
  const safeExtracted = Number.isFinite(extracted) && extracted > 0 ? extracted : 0;
  return Math.min(100, Math.round((safeExtracted / total) * 100));
}

type MultiTrackChainCompat = IncomeChain & {
  chain_kind?: string;
  wallet_daily?: Record<string, number>;
  resources_daily?: Record<string, Record<string, number>>;
  deps?: IncomeChain['deps'] & {
    vehicles?: string[];
    faction?: string;
  };
};

function getChainKind(chain: IncomeChain): string {
  const raw = (chain as MultiTrackChainCompat).chain_kind;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : '';
}

function formatSignedDaily(val: number): string {
  const rounded = Math.round(val);
  return `${rounded > 0 ? '+' : ''}${rounded}/天`;
}

function getWalletDailyItems(chain: IncomeChain): string[] {
  const walletDaily = (chain as MultiTrackChainCompat).wallet_daily;
  if (!walletDaily || typeof walletDaily !== 'object') return [];
  const items: string[] = [];
  for (const [currency, amount] of Object.entries(walletDaily)) {
    if (typeof amount === 'number' && Number.isFinite(amount) && amount !== 0) {
      items.push(`外币: ${currency}${formatSignedDaily(amount)}`);
    }
  }
  return items;
}

function getResourcesDailyItems(chain: IncomeChain): string[] {
  const resDaily = (chain as MultiTrackChainCompat).resources_daily;
  if (!resDaily || typeof resDaily !== 'object') return [];
  const items: string[] = [];
  for (const subMap of Object.values(resDaily)) {
    if (!subMap || typeof subMap !== 'object') continue;
    for (const [subKey, amount] of Object.entries(subMap)) {
      if (typeof amount === 'number' && Number.isFinite(amount) && amount !== 0) {
        items.push(`货物: ${subKey}${formatSignedDaily(amount)}`);
      }
    }
  }
  return items;
}

function getMultitrackBadges(chain: IncomeChain): string[] {
  return [...getWalletDailyItems(chain), ...getResourcesDailyItems(chain)];
}

function getChainDepBadges(chain: IncomeChain): string[] {
  const deps = (chain as MultiTrackChainCompat).deps;
  if (!deps || typeof deps !== 'object') return [];
  const badges: string[] = [];
  const buildings = Array.isArray(deps.buildings) ? deps.buildings.filter(Boolean) : [];
  if (buildings.length > 0) {
    badges.push(`建筑: ${buildings.join(' / ')}`);
  }
  const vehicles = Array.isArray(deps.vehicles) ? deps.vehicles.filter(Boolean) : [];
  if (vehicles.length > 0) {
    badges.push(`载具: ${vehicles.join(' / ')}`);
  }
  const siteOrFaction: string[] = [];
  if (typeof deps.world_resource === 'string' && deps.world_resource.trim().length > 0) {
    siteOrFaction.push(deps.world_resource.trim());
  }
  if (typeof deps.faction === 'string' && deps.faction.trim().length > 0) {
    siteOrFaction.push(deps.faction.trim());
  }
  if (siteOrFaction.length > 0) {
    badges.push(`矿区/势力: ${siteOrFaction.join(' · ')}`);
  }
  return badges;
}

defineExpose({
  chainsList,
  dailyNet,
  dailyNetFormatted,
  abnormalCount,
  getChainKind,
  getMultitrackBadges,
  getChainDepBadges,
});
</script>

<style scoped>
.pda-tab-chains {
  box-sizing: border-box;
}
</style>
