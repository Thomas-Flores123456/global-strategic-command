/**
 * chainEngine.ts —— 资金链五态机与时钟推进计算器（EVT-CHAIN-01，任务包 §3.2 / §6）
 *
 * 核心架构与职责：
 * 1. 纯函数状态机：严格遵守无副作用（Immutability）铁律，输入与输出完全解耦，零全局状态；
 * 2. 五态生命周期流转：establishing（铺设中）➔ active（正常履约）➔ distressed（受挫降效）➔ broken（断裂停摆）➔ exhausted（永久枯竭）；
 * 3. 游戏时钟 Δt 积分驱动：消费游戏推进分钟数（Δt / 1440），折算整数资金流（credits 净增减）；
 * 4. 枯竭守卫（Exhaustion Guard）：资源储量（total_yield）开采殆尽自动转入 exhausted，eff 归零并生成事件；
 * 5. 坏例与容错防御：防 NaN、防负数异常、防状态非法跃迁。
 */

import type { IncomeChain, ChainStatus, ChainFlow, ChainKind } from '../core/schema';

export type { ChainKind };

export interface SettleChainsResult {
  nextChains: IncomeChain[];
  deltaCredits: number;
  /** FD-51：本轮按 Δt 结算的本地外币净增减 */
  deltaWallet: Record<string, number>;
  /** FD-51：本轮按 Δt 结算的六柱资源净增减（canonical pillar -> subKey -> delta） */
  deltaResources: Record<string, Record<string, number>>;
  exhaustedEvents: Array<{ id: string; name: string }>;
}

export type ChainAction = '建立' | '断裂' | '受挫' | '恢复' | '枯竭' | '注资';

export interface ChainEventPayload {
  action: ChainAction;
  id: string;
  name?: string;
  flow?: ChainFlow;
  rate_daily?: number;
  chain_kind?: ChainKind;
  wallet_daily?: Record<string, number>;
  resources_daily?: Record<string, Record<string, number>>;
  eff?: number;
  reason?: string;
  deps?: {
    base_id?: string;
    buildings?: string[];
    vehicles?: string[];
    faction?: string;
    world_resource?: string;
  };
  capacity?: {
    total_yield?: number | null;
    extracted?: number;
  };
}

export interface ChainStockView {
  wallet?: Record<string, number>;
  resources?: Record<string, Record<string, number | null>>;
}

export interface ChainMultiTrackDailySummary {
  dailyNetCredits: number;
  walletDailyNet: Record<string, number>;
  resourcesDailyNet: Record<string, Record<string, number>>;
}

const CHAIN_PILLAR_ALIAS_MAP: Readonly<Record<string, string>> = {
  nanites: 'nanites',
  nanite: 'nanites',
  纳米: 'nanites',
  纳米机械: 'nanites',
  纳米工料: 'nanites',
  minerals: 'minerals',
  mineral: 'minerals',
  矿产: 'minerals',
  矿产与原矿: 'minerals',
  原矿: 'minerals',
  矿物: 'minerals',
  矿石: 'minerals',
  materials: 'materials',
  material: 'materials',
  建材: 'materials',
  材料: 'materials',
  工业材料: 'materials',
  大宗常规建材与化工材料: 'materials',
  fuel: 'fuel',
  energy: 'fuel',
  燃油: 'fuel',
  燃料: 'fuel',
  能源: 'fuel',
  燃油与能源介质: 'fuel',
  munitions: 'munitions',
  ammo: 'munitions',
  ammunition: 'munitions',
  弹药: 'munitions',
  军械: 'munitions',
  军火: 'munitions',
  战术军械弹药: 'munitions',
  logistics: 'logistics',
  food: 'logistics',
  supplies: 'logistics',
  后勤: 'logistics',
  补给: 'logistics',
  粮食: 'logistics',
  维生: 'logistics',
  基地维生与水文后勤: 'logistics',
};

export function normalizeChainResourcePillar(rawKey: string): string {
  const k = String(rawKey ?? '').trim().toLowerCase();
  return CHAIN_PILLAR_ALIAS_MAP[k] ?? String(rawKey ?? '').trim();
}

function cloneResourcesDaily(
  src: Record<string, Record<string, number>> | undefined,
): Record<string, Record<string, number>> | undefined {
  if (!src) return undefined;
  const out: Record<string, Record<string, number>> = {};
  for (const [k, sub] of Object.entries(src)) {
    if (sub && typeof sub === 'object') {
      out[k] = { ...sub };
    }
  }
  return out;
}

function cloneChainDeps(deps: IncomeChain['deps'] | undefined): IncomeChain['deps'] {
  const out: IncomeChain['deps'] = {
    base_id: deps?.base_id ?? '',
    buildings: deps?.buildings ? [...deps.buildings] : [],
    world_resource: deps?.world_resource ?? '',
  };
  if (deps?.base !== undefined) out.base = deps.base;
  if (deps?.vehicles !== undefined) out.vehicles = [...deps.vehicles];
  if (deps?.faction !== undefined) out.faction = deps.faction;
  return out;
}

function cloneIncomeChain(c: IncomeChain): IncomeChain {
  const out: IncomeChain = {
    ...c,
    deps: cloneChainDeps(c.deps),
    capacity: { ...c.capacity },
  };
  if (c.chain_kind !== undefined) out.chain_kind = c.chain_kind;
  if (c.wallet_daily !== undefined) out.wallet_daily = { ...c.wallet_daily };
  if (c.resources_daily !== undefined) {
    out.resources_daily = cloneResourcesDaily(c.resources_daily);
  }
  return out;
}

function findMatchingStockKey(record: Record<string, number>, targetKey: string): string {
  if (Object.prototype.hasOwnProperty.call(record, targetKey)) return targetKey;
  const norm = targetKey.trim().toLowerCase().replace(/\s+/g, '');
  return Object.keys(record).find(k => k.trim().toLowerCase().replace(/\s+/g, '') === norm) ?? targetKey;
}

const parsedChainEventEffRegistry = new Map<string, number>();

export function registerParsedChainEventEff(
  chainId: string,
  action: '受挫' | '恢复',
  eff: number | undefined,
): void {
  const key = `${chainId}\u0000${action}`;
  if (typeof eff === 'number' && Number.isFinite(eff) && eff >= 0 && eff <= 2) {
    parsedChainEventEffRegistry.set(key, eff);
  } else {
    parsedChainEventEffRegistry.delete(key);
  }
}

function consumeParsedChainEventEff(
  chainId: string,
  action: '受挫' | '恢复',
): number | undefined {
  const key = `${chainId}\u0000${action}`;
  const val = parsedChainEventEffRegistry.get(key);
  if (val !== undefined) {
    parsedChainEventEffRegistry.delete(key);
  }
  return val;
}

/**
 * 计算当前资金链池的标称日均净收益（DailyNet）
 * 仅对处于 'active' 或 'distressed' 状态的链条按实际效率（eff）折算
 */
export function calcDailyNet(chains: readonly IncomeChain[]): number {
  if (!chains || chains.length === 0) return 0;

  let totalInflow = 0;
  let totalOutflow = 0;

  for (const c of chains) {
    if (c.status !== 'active' && c.status !== 'distressed') {
      continue;
    }
    const safeRate = Number.isFinite(c.rate_daily) && c.rate_daily > 0 ? c.rate_daily : 0;
    const safeEff = Number.isFinite(c.eff) && c.eff >= 0 ? Math.min(2, Math.max(0, c.eff)) : 0;
    const effectiveFlow = safeRate * safeEff;

    if (c.flow === '支出') {
      totalOutflow += effectiveFlow;
    } else {
      totalInflow += effectiveFlow;
    }
  }

  return Math.round(totalInflow - totalOutflow);
}

/**
 * FD-51：汇总所有 active | distressed 链条按 eff 折算后的三轨日净流量
 */
export function calcChainMultiTrackDailySummary(
  chains: readonly IncomeChain[],
): ChainMultiTrackDailySummary {
  const dailyNetCredits = calcDailyNet(chains);
  const walletDailyNet: Record<string, number> = {};
  const resourcesDailyNet: Record<string, Record<string, number>> = {};

  if (!chains || chains.length === 0) {
    return { dailyNetCredits, walletDailyNet, resourcesDailyNet };
  }

  for (const c of chains) {
    if (c.status !== 'active' && c.status !== 'distressed') {
      continue;
    }
    const safeEff = Number.isFinite(c.eff) && c.eff >= 0 ? Math.min(2, Math.max(0, c.eff)) : 0;
    if (safeEff <= 0) continue;

    if (c.wallet_daily) {
      for (const [curr, val] of Object.entries(c.wallet_daily)) {
        if (typeof val === 'number' && Number.isFinite(val) && val !== 0) {
          const effVal = Math.round(val * safeEff);
          if (effVal !== 0) {
            walletDailyNet[curr] = (walletDailyNet[curr] ?? 0) + effVal;
          }
        }
      }
    }

    if (c.resources_daily) {
      for (const [rawPillar, subMap] of Object.entries(c.resources_daily)) {
        if (!subMap || typeof subMap !== 'object') continue;
        const pillar = normalizeChainResourcePillar(rawPillar);
        for (const [subKey, val] of Object.entries(subMap)) {
          if (typeof val === 'number' && Number.isFinite(val) && val !== 0) {
            const effVal = Math.round(val * safeEff);
            if (effVal !== 0) {
              const bucket = (resourcesDailyNet[pillar] ??= {});
              bucket[subKey] = (bucket[subKey] ?? 0) + effVal;
            }
          }
        }
      }
    }
  }

  return { dailyNetCredits, walletDailyNet, resourcesDailyNet };
}

/**
 * 状态机纯函数跃迁：对单条资金链应用状态转移
 */
export function applyChainTransition(
  chain: IncomeChain,
  targetStatus: ChainStatus,
  options?: {
    eff?: number;
    reason?: string;
    currentDay?: number;
  },
): IncomeChain {
  // 枯竭态为不可逆终态（除非重置），若当前已枯竭则拒绝转移并保持
  if (chain.status === 'exhausted' && targetStatus !== 'exhausted') {
    return {
      ...cloneIncomeChain(chain),
      reason: options?.reason || chain.reason,
    };
  }

  let nextEff = chain.eff;
  if (targetStatus === 'active') {
    nextEff = options?.eff !== undefined ? Math.min(2, Math.max(0, options.eff)) : 1;
  } else if (targetStatus === 'distressed') {
    nextEff = options?.eff !== undefined ? Math.min(2, Math.max(0, options.eff)) : chain.eff > 0 ? chain.eff : 0.5;
  } else if (targetStatus === 'broken' || targetStatus === 'exhausted' || targetStatus === 'establishing') {
    nextEff = 0;
  }

  return {
    ...cloneIncomeChain(chain),
    status: targetStatus,
    eff: nextEff,
    reason: options?.reason ?? chain.reason,
    updated_at_day: options?.currentDay ?? chain.updated_at_day,
  };
}

/**
 * 基于游戏内时钟推进分钟数（deltaMinutes）结算资金链收益与枯竭跃迁
 *
 * 核心数学公式：
 * Δcredits = ∑ (inflow_daily * eff * Δt / 1440) - ∑ (outflow_daily * eff * Δt / 1440)
 */
export function settleChainsDeltaT(
  chains: readonly IncomeChain[],
  deltaMinutes: number,
  currentDay: number = 0,
  stockView?: ChainStockView,
): SettleChainsResult {
  if (!chains || chains.length === 0 || !Number.isFinite(deltaMinutes) || deltaMinutes <= 0) {
    return {
      nextChains: chains ? chains.map(c => cloneIncomeChain(c)) : [],
      deltaCredits: 0,
      deltaWallet: {},
      deltaResources: {},
      exhaustedEvents: [],
    };
  }

  let grossIncome = 0;
  let grossExpense = 0;
  const deltaWallet: Record<string, number> = {};
  const deltaResources: Record<string, Record<string, number>> = {};
  const nextChains: IncomeChain[] = [];
  const exhaustedEvents: Array<{ id: string; name: string }> = [];

  const workingWallet: Record<string, number> = {};
  const workingResources: Record<string, Record<string, number>> = {};
  if (stockView) {
    for (const [curr, amt] of Object.entries(stockView.wallet ?? {})) {
      if (typeof amt === 'number' && Number.isFinite(amt)) {
        workingWallet[curr] = Math.max(0, amt);
      }
    }
    for (const [rawPillar, subMap] of Object.entries(stockView.resources ?? {})) {
      if (!subMap || typeof subMap !== 'object') continue;
      const pillar = normalizeChainResourcePillar(rawPillar);
      const bucket = (workingResources[pillar] ??= {});
      for (const [subKey, amt] of Object.entries(subMap)) {
        bucket[subKey] = typeof amt === 'number' && Number.isFinite(amt) ? Math.max(0, amt) : 0;
      }
    }
  }

  const timeRatio = deltaMinutes / 1440;

  for (const c of chains) {
    // 非计息状态直接原样复制
    if (c.status !== 'active' && c.status !== 'distressed') {
      nextChains.push(cloneIncomeChain(c));
      continue;
    }

    const safeRate = Number.isFinite(c.rate_daily) && c.rate_daily > 0 ? c.rate_daily : 0;
    const safeEff = Number.isFinite(c.eff) && c.eff >= 0 ? Math.min(2, Math.max(0, c.eff)) : 0;
    const chainTimeRatio = timeRatio * safeEff;

    // FD-51 欠料/欠费停机守卫：当传入 stockView 且链条存在负向消耗时，先核验库存是否足以支付本轮消耗
    if (stockView && safeEff > 0) {
      let hasShortage = false;
      if (c.wallet_daily) {
        for (const [curr, dailyVal] of Object.entries(c.wallet_daily)) {
          if (typeof dailyVal === 'number' && Number.isFinite(dailyVal) && dailyVal < 0) {
            const reqAmount = Math.ceil(Math.abs(dailyVal) * chainTimeRatio);
            const wKey = findMatchingStockKey(workingWallet, curr);
            const avail = workingWallet[wKey] ?? 0;
            if (avail < reqAmount) {
              hasShortage = true;
              break;
            }
          }
        }
      }
      if (!hasShortage && c.resources_daily) {
        for (const [rawPillar, subMap] of Object.entries(c.resources_daily)) {
          if (!subMap || typeof subMap !== 'object') continue;
          const pillar = normalizeChainResourcePillar(rawPillar);
          const pBucket = workingResources[pillar] ?? {};
          for (const [subKey, dailyVal] of Object.entries(subMap)) {
            if (typeof dailyVal === 'number' && Number.isFinite(dailyVal) && dailyVal < 0) {
              const reqAmount = Math.ceil(Math.abs(dailyVal) * chainTimeRatio);
              const rKey = findMatchingStockKey(pBucket, subKey);
              const avail = pBucket[rKey] ?? 0;
              if (avail < reqAmount) {
                hasShortage = true;
                break;
              }
            }
          }
          if (hasShortage) break;
        }
      }

      if (hasShortage) {
        const pauseReason = c.reason.includes('上游原料/外币不足暂停')
          ? c.reason
          : c.reason
            ? `${c.reason} [上游原料/外币不足暂停]`
            : '[上游原料/外币不足暂停]';
        nextChains.push({
          ...cloneIncomeChain(c),
          status: 'distressed',
          eff: 0,
          reason: pauseReason,
          updated_at_day: currentDay,
        });
        continue;
      }
    }

    const theoreticalYield = safeRate * safeEff * timeRatio;

    const totalYield = c.capacity?.total_yield ?? null;
    const currentExtracted = c.capacity?.extracted ?? 0;

    let actualYield = theoreticalYield;
    let nextStatus: ChainStatus = c.status;
    let nextEff = safeEff;
    let nextExtracted: number;
    let nextReason = c.reason;

    // 有限矿脉/合同资源开采上限判定（仅对收入向链条适用枯竭判定）
    if (totalYield !== null && c.flow !== '支出' && (safeRate > 0 || totalYield <= currentExtracted)) {
      const remainingYield = Math.max(0, totalYield - currentExtracted);
      if (theoreticalYield >= remainingYield) {
        // 达到或超过枯竭上限！
        actualYield = remainingYield;
        nextExtracted = totalYield;
        nextStatus = 'exhausted';
        nextEff = 0;
        nextReason = c.reason ? `${c.reason} [资源储量已采空枯竭]` : '资源储量已采空枯竭';
        exhaustedEvents.push({ id: c.id, name: c.name });
      } else {
        nextExtracted = currentExtracted + theoreticalYield;
      }
    } else {
      nextExtracted = currentExtracted + theoreticalYield;
    }

    if (c.flow === '支出') {
      grossExpense += actualYield;
    } else {
      grossIncome += actualYield;
    }

    // FD-51：正常履约时同步结算 wallet_daily 与 resources_daily
    if (chainTimeRatio > 0) {
      if (c.wallet_daily) {
        for (const [curr, dailyVal] of Object.entries(c.wallet_daily)) {
          if (typeof dailyVal === 'number' && Number.isFinite(dailyVal) && dailyVal !== 0) {
            const deltaW = Math.round(dailyVal * chainTimeRatio);
            if (deltaW !== 0) {
              deltaWallet[curr] = (deltaWallet[curr] ?? 0) + deltaW;
              if (stockView) {
                const wKey = findMatchingStockKey(workingWallet, curr);
                workingWallet[wKey] = Math.max(0, (workingWallet[wKey] ?? 0) + deltaW);
              }
            }
          }
        }
      }

      if (c.resources_daily) {
        for (const [rawPillar, subMap] of Object.entries(c.resources_daily)) {
          if (!subMap || typeof subMap !== 'object') continue;
          const pillar = normalizeChainResourcePillar(rawPillar);
          for (const [subKey, dailyVal] of Object.entries(subMap)) {
            if (typeof dailyVal === 'number' && Number.isFinite(dailyVal) && dailyVal !== 0) {
              const deltaR = Math.round(dailyVal * chainTimeRatio);
              if (deltaR !== 0) {
                const pBucket = (deltaResources[pillar] ??= {});
                pBucket[subKey] = (pBucket[subKey] ?? 0) + deltaR;
                if (stockView) {
                  const wBucket = (workingResources[pillar] ??= {});
                  const rKey = findMatchingStockKey(wBucket, subKey);
                  wBucket[rKey] = Math.max(0, (wBucket[rKey] ?? 0) + deltaR);
                }
              }
            }
          }
        }
      }
    }

    const updatedChain: IncomeChain = {
      ...cloneIncomeChain(c),
      status: nextStatus,
      eff: nextEff,
      reason: nextReason,
      updated_at_day: nextStatus === 'exhausted' ? currentDay : c.updated_at_day,
      capacity: {
        ...(c.capacity?.total !== undefined ? { total: c.capacity.total } : {}),
        total_yield: totalYield,
        extracted: Math.round(nextExtracted * 100) / 100,
      },
    };
    nextChains.push(updatedChain);
  }

  const deltaCredits = Math.round(grossIncome - grossExpense);

  return {
    nextChains,
    deltaCredits,
    deltaWallet,
    deltaResources,
    exhaustedEvents,
  };
}

/**
 * 纯函数：应用单条事件载荷变更链条集合
 */
export function applyChainEvent(
  chains: readonly IncomeChain[],
  payload: ChainEventPayload,
  currentDay: number = 0,
): IncomeChain[] {
  const normKey = (s: string | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, '');
  const payloadIdNorm = normKey(payload.id);
  const payloadNameNorm = normKey(payload.name || payload.id.replace(/^chain_/, ''));
  const existingIdx = chains.findIndex(
    c =>
      c.id === payload.id ||
      (payloadIdNorm !== '' && normKey(c.id) === payloadIdNorm) ||
      (payloadNameNorm !== '' && normKey(c.name) === payloadNameNorm),
  );

  if (payload.action === '建立') {
    if (existingIdx >= 0) {
      const existing = chains[existingIdx];
      // 当同名资金链已处于 exhausted 不可逆终态时，忽略重复「建立」覆盖
      if (existing.status === 'exhausted') {
        return chains.map(c => cloneIncomeChain(c));
      }
      // 同名非枯竭资金链（如 establishing 筹建态）收到「建立/开通」：直接激活为 active，
      // 当事件未提供新 rate_daily（或为 0 且无商路/外币/货物覆盖）时保留原有的 rate_daily，并保留已有 capacity.extracted
      const nextChainKind = payload.chain_kind ?? existing.chain_kind;
      const nextWalletDaily = payload.wallet_daily
        ? { ...payload.wallet_daily }
        : existing.wallet_daily
          ? { ...existing.wallet_daily }
          : undefined;
      const nextResourcesDaily = payload.resources_daily
        ? cloneResourcesDaily(payload.resources_daily)
        : cloneResourcesDaily(existing.resources_daily);
      const nextVehicles =
        payload.deps?.vehicles && payload.deps.vehicles.length > 0
          ? [...payload.deps.vehicles]
          : existing.deps?.vehicles
            ? [...existing.deps.vehicles]
            : undefined;
      const nextFaction = payload.deps?.faction || existing.deps?.faction;

      const mergedDeps: IncomeChain['deps'] = {
        base_id: payload.deps?.base_id || existing.deps?.base_id || '',
        ...(existing.deps?.base !== undefined ? { base: existing.deps.base } : {}),
        buildings:
          payload.deps?.buildings && payload.deps.buildings.length > 0
            ? [...payload.deps.buildings]
            : [...(existing.deps?.buildings ?? [])],
        ...(nextVehicles !== undefined ? { vehicles: nextVehicles } : {}),
        ...(nextFaction !== undefined ? { faction: nextFaction } : {}),
        world_resource: payload.deps?.world_resource || existing.deps?.world_resource || '',
      };

      const resolvedRateDaily =
        payload.rate_daily !== undefined && payload.rate_daily > 0
          ? payload.rate_daily
          : payload.rate_daily === 0 && (payload.wallet_daily || payload.resources_daily || payload.chain_kind === '本土商路')
            ? 0
            : existing.rate_daily;

      const mergedChain: IncomeChain = {
        ...cloneIncomeChain(existing),
        id: existing.id || payload.id,
        name: payload.name || existing.name || payload.id,
        flow: payload.flow ?? existing.flow ?? '收入',
        rate_daily: resolvedRateDaily,
        ...(nextChainKind !== undefined ? { chain_kind: nextChainKind } : {}),
        ...(nextWalletDaily !== undefined ? { wallet_daily: nextWalletDaily } : {}),
        ...(nextResourcesDaily !== undefined ? { resources_daily: nextResourcesDaily } : {}),
        status: 'active',
        eff: payload.eff !== undefined ? Math.min(2, Math.max(0, payload.eff)) : 1,
        deps: mergedDeps,
        capacity: {
          ...(existing.capacity?.total !== undefined ? { total: existing.capacity.total } : {}),
          total_yield:
            payload.capacity?.total_yield !== undefined
              ? payload.capacity.total_yield
              : (existing.capacity?.total_yield ?? null),
          extracted: existing.capacity?.extracted ?? payload.capacity?.extracted ?? 0,
        },
        reason: payload.reason || existing.reason || '新开辟资金链',
        updated_at_day: currentDay,
      };
      return chains.map((c, idx) => (idx === existingIdx ? mergedChain : cloneIncomeChain(c)));
    }

    const newDeps: IncomeChain['deps'] = {
      base_id: payload.deps?.base_id ?? '',
      buildings: payload.deps?.buildings ? [...payload.deps.buildings] : [],
      ...(payload.deps?.vehicles !== undefined ? { vehicles: [...payload.deps.vehicles] } : {}),
      ...(payload.deps?.faction !== undefined ? { faction: payload.deps.faction } : {}),
      world_resource: payload.deps?.world_resource ?? '',
    };

    const newChain: IncomeChain = {
      id: payload.id,
      name: payload.name || payload.id,
      flow: payload.flow ?? '收入',
      rate_daily: Math.max(0, payload.rate_daily ?? 0),
      ...(payload.chain_kind !== undefined ? { chain_kind: payload.chain_kind } : {}),
      ...(payload.wallet_daily !== undefined ? { wallet_daily: { ...payload.wallet_daily } } : {}),
      ...(payload.resources_daily !== undefined
        ? { resources_daily: cloneResourcesDaily(payload.resources_daily) }
        : {}),
      status: 'active',
      eff: payload.eff !== undefined ? Math.min(2, Math.max(0, payload.eff)) : 1,
      deps: newDeps,
      capacity: {
        total_yield: payload.capacity?.total_yield ?? null,
        extracted: payload.capacity?.extracted ?? 0,
      },
      reason: payload.reason ?? '新开辟资金链',
      updated_at_day: currentDay,
    };
    return [...chains.map(c => cloneIncomeChain(c)), newChain];
  }

  if (existingIdx === -1) {
    // 目标链条不存在，原样返回不报错
    return chains.map(c => cloneIncomeChain(c));
  }

  const target = chains[existingIdx];
  let updated: IncomeChain;

  switch (payload.action) {
    case '断裂':
      updated = applyChainTransition(target, 'broken', {
        reason: payload.reason ?? '因外力打击或突发变故彻底停摆断裂',
        currentDay,
      });
      break;
    case '受挫': {
      const stagedEff = consumeParsedChainEventEff(payload.id, '受挫');
      const rawEff = payload.eff !== undefined ? payload.eff : stagedEff;
      const validEff =
        typeof rawEff === 'number' && Number.isFinite(rawEff) && rawEff >= 0 && rawEff <= 2
          ? rawEff
          : 0.5;
      updated = applyChainTransition(target, 'distressed', {
        eff: validEff,
        reason: payload.reason ?? '受到局部干扰或前置设施受损效率下降',
        currentDay,
      });
      break;
    }
    case '恢复': {
      const stagedEff = consumeParsedChainEventEff(payload.id, '恢复');
      const rawEff = payload.eff !== undefined ? payload.eff : stagedEff;
      const validEff =
        typeof rawEff === 'number' && Number.isFinite(rawEff) && rawEff >= 0 && rawEff <= 2
          ? rawEff
          : 1;
      updated = applyChainTransition(target, 'active', {
        eff: validEff,
        reason: payload.reason ?? '干扰排除，管网抢修完毕恢复全额履约',
        currentDay,
      });
      break;
    }
    case '枯竭':
      updated = applyChainTransition(target, 'exhausted', {
        reason: payload.reason ?? '开采枯竭或协议终止',
        currentDay,
      });
      break;
    default:
      updated = cloneIncomeChain(target);
  }

  return chains.map((c, idx) => (idx === existingIdx ? updated : cloneIncomeChain(c)));
}
