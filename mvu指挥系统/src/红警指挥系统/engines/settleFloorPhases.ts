/**
 * settleFloorPhases.ts —— settleFloor 子阶段结算模块
 *
 * 从 settleFloor.ts 拆出：
 * - PRT-EVT-01 协议结算齿轮（settleFloorProtocols 及回执类型）
 * - CMD-ENGINE-01 联席参谋部结算引擎与终生唯一首发 MCV 防刷锁
 *   （ensureCommandHQ / cloneCommandHQ / applyFactionUnlockSettlement / applyAdjutantEventDeclaration / settleCommandHQSlice）
 */

import { buildProtocolIdIndex, normalizeWbProtocols, type EffectiveCatalog } from '../core/catalogEffective';
import {
  HUMAN_ADJUTANT_DAILY_UPKEEP,
  deriveStaffSlotCap,
  normalizeFactionId,
  resolveAdjutantBuffPreset,
  resolveFactionPenaltyPreset,
  resolveStarterMcvInfo,
  type AdjutantBuffEffectValues,
} from '../core/commandPresets';
import {
  LEGACY_PROTOCOL_DEFINITIONS,
  resolveLegacyProtocolName,
  type Adjutant,
  type CommandHQ,
  type FactionBreakInPenalty,
  type ProtocolInstance,
} from '../core/schema';
import type { ParsedFactionUnlock } from '../parse/factionUnlockParser';
import {
  canon,
  type AdjutantEventDecl,
  type EventDeclaration,
  type ParseEvent,
  type StatData,
} from '../parse/parsePipeline';
import { dailyProtocolPointRate } from './protocolAnchors';
import {
  areProtocolRequirementsMet,
  canonicalizeProtocolRef,
  createDefaultProtocolInstance,
  discoverProtocolByEvent,
  discoverProtocolsByExperiment,
  executeProtocolExperiment,
  isProtocolLabOnline,
  isProtocolTrackPredecessorActive,
  refreshProtocolTrackAvailability,
  roundPoints4,
  settleAutoProtocols,
  type ProtocolDefinitionLike,
  type ProtocolExperimentBlockReason,
  type ProtocolExperimentOutcome,
} from './protocolEngine';

/* ═══════════════ PRT-EVT-01 · 协议结算齿轮类型与实现 ═══════════════ */

export interface ProtocolManualExperimentReceipt {
  protocolId: string;
  protocolName: string;
  executed: boolean;
  outcome?: ProtocolExperimentOutcome;
  reason?: ProtocolExperimentBlockReason;
  instance?: ProtocolInstance;
  unlockedNextIds: string[];
}

export interface ProtocolFloorSettlementReceipt {
  dailyRate: number;
  deltaPoints: number;
  discoveredByExperimentIds: string[];
  discoveredByEventIds: string[];
  unlockedTrackIds: string[];
  manualExperiments: ProtocolManualExperimentReceipt[];
  autoExecuted: boolean;
  autoProtocolId?: string;
  autoOutcome?: ProtocolExperimentOutcome;
  autoBlockReason?: ProtocolExperimentBlockReason;
  autoUnlockedNextIds: string[];
}

export interface SettleFloorProtocolsOptions {
  catalog?: EffectiveCatalog | null;
  eventDeclarations?: EventDeclaration[];
}

/**
 * PRT-EVT-01 · 协议结算齿轮（对接 settleFloor 流水线 §3.5.3 / §3.6.1 / D-P5c / D-P9b / D-P16b / D-P27）
 *
 * 三步流水：
 * - 步骤 A（Δt > 0 点数累积与实验自动启封）：按 dailyProtocolPointRate(state) * (deltaMinutes / 1440)
 *   累加 protocol_points；调用 discoverProtocolsByExperiment 与 refreshProtocolTrackAvailability；
 * - 步骤 B（执行本楼 <事件> 协议声明）：
 *   · '协议发现'：调用 discoverProtocolByEvent 启封为 available（准入已齐）或 locked（准入未齐），记录 discovered_via: 'event' 与 last_result；
 *   · '协议实验'：调用 executeProtocolExperiment 执行单轮实验（同源确定性种子 deterministicRoll），扣点扣款、更新 exp/status/last_result，突破时清 auto_queued 并解锁同轨下一级；
 * - 步骤 C（Δt > 0 时 auto_queued 自动实验排程，D-P27）：
 *   调用 settleAutoProtocols 推进队首排程协议单轮实验；遵循 UTO 轴三“零单步跨任务穿透”铁律，且避免同楼手动+自动重复双扣。
 */
export function settleFloorProtocols(
  stateBefore: StatData,
  deltaMinutes: number,
  clockDay: number | undefined,
  options: SettleFloorProtocolsOptions,
): { next: StatData; events: ParseEvent[]; receipt: ProtocolFloorSettlementReceipt } {
  const events: ParseEvent[] = [];
  const protocolDecls = (options.eventDeclarations ?? []).filter(
    (d): d is EventDeclaration & { kind: 'protocol' } => d.kind === 'protocol',
  );
  const hadProtocolsField = stateBefore.protocols !== undefined;

  const explicitCatalogProtocols = normalizeWbProtocols(
    options.catalog?.protocols as unknown as Parameters<typeof normalizeWbProtocols>[0],
  );
  const protocolIndex = buildProtocolIdIndex(
    explicitCatalogProtocols as unknown as import('../core/catalogEffective').ProtocolIndexSource,
  );

  const lookupProtocolDef = (idOrName: string): ProtocolDefinitionLike => {
    const resolvedId = protocolIndex.resolveProtocolIdByName(idOrName) ?? canonicalizeProtocolRef(idOrName);
    const fromExplicit = explicitCatalogProtocols.find(item => {
      const itemRef = canonicalizeProtocolRef(item.id || item.name || '');
      return itemRef === resolvedId || item.id === idOrName || item.name === idOrName;
    });
    if (fromExplicit) return fromExplicit;
    const fromLegacy = LEGACY_PROTOCOL_DEFINITIONS.find(leg => leg.id === resolvedId || leg.name === idOrName);
    if (fromLegacy) {
      return {
        id: fromLegacy.id,
        name: fromLegacy.name,
        faction: fromLegacy.faction,
        tier: fromLegacy.tier,
      };
    }
    return {
      id: resolvedId || idOrName,
      name: protocolIndex.resolveProtocolNameById(resolvedId || idOrName) ?? idOrName,
      tier: 1,
    };
  };

  const resolveProtocolDisplayName = (idOrName: string): string => {
    const def = lookupProtocolDef(idOrName);
    return def.name || resolveLegacyProtocolName(idOrName) || idOrName;
  };

  const effectiveCatalogProtocols: ProtocolDefinitionLike[] = [];
  const seenRefs = new Set<string>();
  const pushCatalogDef = (def: ProtocolDefinitionLike) => {
    const ref = canonicalizeProtocolRef(def.id || def.name || '');
    if (!ref || seenRefs.has(ref)) return;
    seenRefs.add(ref);
    effectiveCatalogProtocols.push(def);
  };
  for (const def of explicitCatalogProtocols) pushCatalogDef(def);
  for (const inst of stateBefore.protocols ?? []) pushCatalogDef(lookupProtocolDef(inst.ref));
  for (const decl of protocolDecls) {
    const targetKey =
      decl.protocolId ?? decl.protocol?.protocolId ?? decl.protocolName ?? decl.protocol?.protocolName ?? '';
    if (targetKey) pushCatalogDef(lookupProtocolDef(targetKey));
  }

  const metaDay = stateBefore.meta?.day_count;
  const gameDay =
    typeof metaDay === 'number' && Number.isFinite(metaDay) && metaDay > 0
      ? Math.floor(metaDay)
      : typeof stateBefore.clock?.day === 'number' &&
          Number.isFinite(stateBefore.clock.day) &&
          stateBefore.clock.day > 0
        ? Math.floor(stateBefore.clock.day)
        : typeof clockDay === 'number' && Number.isFinite(clockDay) && clockDay > 0
          ? Math.floor(clockDay)
          : 0;

  let workingState: StatData = stateBefore;
  const baseDailyRate = dailyProtocolPointRate(workingState);
  const cmdMods = evaluateCommandHQModifiers(workingState);
  const dailyRate =
    cmdMods.protocolDailyRateBonus > 0
      ? Math.round(baseDailyRate * (1 + cmdMods.protocolDailyRateBonus) * 10000) / 10000
      : baseDailyRate;
  let deltaPoints = 0;
  const discoveredByExperimentIds: string[] = [];
  const discoveredByEventIds: string[] = [];
  const unlockedTrackIds: string[] = [];
  const manualExperiments: ProtocolManualExperimentReceipt[] = [];

  // ── 步骤 A：Δt > 0 点数累积与实验自动启封 ──
  if (deltaMinutes > 0) {
    const rawDeltaPoints = dailyRate * (deltaMinutes / 1440);
    deltaPoints = roundPoints4(rawDeltaPoints);
    const prevPoints =
      typeof workingState.protocol_points === 'number' && Number.isFinite(workingState.protocol_points)
        ? workingState.protocol_points
        : 0;
    const accruedPoints = roundPoints4(prevPoints + rawDeltaPoints);
    workingState = {
      ...workingState,
      protocol_points: accruedPoints,
    };

    if (effectiveCatalogProtocols.length > 0) {
      const discRes = discoverProtocolsByExperiment(workingState, effectiveCatalogProtocols, gameDay);
      if (discRes.discoveredIds.length > 0) {
        workingState = discRes.state;
        discoveredByExperimentIds.push(...discRes.discoveredIds);
        for (const id of discRes.discoveredIds) {
          events.push({
            light: '🟢',
            layer: 'instruction',
            message: `[协议] 实验院所自动启封「${resolveProtocolDisplayName(id)}」（${id}）→ available`,
            path: 'protocols',
          });
        }
      }

      const trackRes = refreshProtocolTrackAvailability(workingState, effectiveCatalogProtocols, gameDay);
      if (trackRes.unlockedIds.length > 0) {
        workingState = trackRes.state;
        unlockedTrackIds.push(...trackRes.unlockedIds);
        for (const id of trackRes.unlockedIds) {
          events.push({
            light: '🟢',
            layer: 'instruction',
            message: `[协议] 同轨准入解锁「${resolveProtocolDisplayName(id)}」（${id}）→ available`,
            path: 'protocols',
          });
        }
      }
    }
  } else if (
    protocolDecls.length > 0 &&
    effectiveCatalogProtocols.length > 0 &&
    (workingState.protocols?.length ?? 0) > 0
  ) {
    const trackRes = refreshProtocolTrackAvailability(workingState, effectiveCatalogProtocols, gameDay);
    if (trackRes.unlockedIds.length > 0) {
      workingState = trackRes.state;
      unlockedTrackIds.push(...trackRes.unlockedIds);
    }
  }

  // ── 步骤 B：执行本楼 <事件> 协议声明 ──
  const manualExperimentedIds = new Set<string>();
  const unlockedInStepB = new Set<string>();

  for (const decl of protocolDecls) {
    const action =
      decl.protocolAction ??
      decl.protocol?.protocolAction ??
      (decl.verb === '协议发现' ? 'discover' : decl.verb === '协议排程' ? 'schedule' : 'experiment');
    const targetKey =
      decl.protocolId ?? decl.protocol?.protocolId ?? decl.protocolName ?? decl.protocol?.protocolName ?? '';
    const protocolDef = lookupProtocolDef(targetKey);
    const canonicalRef = canonicalizeProtocolRef(protocolDef.id || protocolDef.name || targetKey);
    const displayName = protocolDef.name || resolveLegacyProtocolName(canonicalRef) || canonicalRef;

    const scheduleVerb = decl.scheduleAction ?? decl.protocol?.scheduleAction;
    const expAutoQueued = decl.auto_queued ?? decl.protocol?.auto_queued;
    const expQueueOrder = decl.queue_order ?? decl.protocol?.queue_order;
    const expHold = decl.hold ?? decl.protocol?.hold;
    const hasScheduleMutation =
      action === 'schedule' ||
      scheduleVerb !== undefined ||
      expAutoQueued !== undefined ||
      expQueueOrder !== undefined ||
      expHold !== undefined;

    if (hasScheduleMutation) {
      const existingProtocols = workingState.protocols ?? [];
      let targetIdx = existingProtocols.findIndex(inst => canonicalizeProtocolRef(inst.ref) === canonicalRef);
      const isUndiscovered =
        targetIdx < 0 ? protocolDef.discovery !== undefined : existingProtocols[targetIdx].status === 'undiscovered';
      if (isUndiscovered) {
        events.push({
          light: '🟡',
          layer: 'instruction',
          message: `[协议] 协议排程未执行「${displayName}」（原因：undiscovered）`,
          path: 'protocols',
        });
      } else if (
        targetIdx < 0 ||
        (existingProtocols[targetIdx].status !== 'active' && existingProtocols[targetIdx].status !== 'voided')
      ) {
        const list = existingProtocols.map(inst => ({ ...inst }));
        if (targetIdx < 0) {
          const canInitAvailable =
            isProtocolTrackPredecessorActive(workingState, protocolDef, effectiveCatalogProtocols) &&
            isProtocolLabOnline(workingState, protocolDef) &&
            areProtocolRequirementsMet(workingState, protocolDef, effectiveCatalogProtocols);
          list.push(createDefaultProtocolInstance(protocolDef, canInitAvailable ? 'available' : 'locked', gameDay));
          targetIdx = list.length - 1;
        }
        const getOrderedAutoIndices = () =>
          list
            .map((inst, idx) => ({ inst, idx }))
            .filter(({ inst }) => inst.auto_queued === true)
            .sort((a, b) => {
              const oa =
                typeof a.inst.queue_order === 'number' && Number.isFinite(a.inst.queue_order)
                  ? a.inst.queue_order
                  : Number.MAX_SAFE_INTEGER;
              const ob =
                typeof b.inst.queue_order === 'number' && Number.isFinite(b.inst.queue_order)
                  ? b.inst.queue_order
                  : Number.MAX_SAFE_INTEGER;
              return oa !== ob ? oa - ob : a.idx - b.idx;
            })
            .map(({ idx }) => idx);
        const renumber = (ordered: number[]) => {
          ordered.forEach((idx, pos) => {
            list[idx] = { ...list[idx], queue_order: pos + 1 };
          });
        };

        switch (scheduleVerb) {
          case '加入候列': {
            list[targetIdx] = { ...list[targetIdx], auto_queued: true, hold: false };
            const ordered = getOrderedAutoIndices().filter(i => i !== targetIdx);
            ordered.push(targetIdx);
            renumber(ordered);
            break;
          }
          case '移出候列': {
            const copy = { ...list[targetIdx], auto_queued: false, hold: false };
            delete copy.queue_order;
            list[targetIdx] = copy;
            renumber(getOrderedAutoIndices());
            break;
          }
          case '置顶': {
            list[targetIdx] = { ...list[targetIdx], auto_queued: true };
            const ordered = [targetIdx, ...getOrderedAutoIndices().filter(i => i !== targetIdx)];
            renumber(ordered);
            break;
          }
          case '上移': {
            list[targetIdx] = { ...list[targetIdx], auto_queued: true };
            const ordered = getOrderedAutoIndices();
            if (!ordered.includes(targetIdx)) ordered.push(targetIdx);
            const pos = ordered.indexOf(targetIdx);
            if (pos > 0) [ordered[pos - 1], ordered[pos]] = [ordered[pos], ordered[pos - 1]];
            renumber(ordered);
            break;
          }
          case '下移': {
            list[targetIdx] = { ...list[targetIdx], auto_queued: true };
            const ordered = getOrderedAutoIndices();
            if (!ordered.includes(targetIdx)) ordered.push(targetIdx);
            const pos = ordered.indexOf(targetIdx);
            if (pos >= 0 && pos < ordered.length - 1) {
              [ordered[pos], ordered[pos + 1]] = [ordered[pos + 1], ordered[pos]];
            }
            renumber(ordered);
            break;
          }
          case '暂缓': {
            list[targetIdx] = { ...list[targetIdx], hold: true };
            break;
          }
          case '恢复': {
            list[targetIdx] = { ...list[targetIdx], hold: false };
            break;
          }
        }
        if (expAutoQueued !== undefined) list[targetIdx] = { ...list[targetIdx], auto_queued: expAutoQueued };
        if (expQueueOrder !== undefined) list[targetIdx] = { ...list[targetIdx], queue_order: expQueueOrder };
        if (expHold !== undefined) list[targetIdx] = { ...list[targetIdx], hold: expHold };

        workingState = { ...workingState, protocols: list };
        events.push({
          light: '🟢',
          layer: 'instruction',
          message: `[协议] 协议排程「${displayName}」（${canonicalRef}）：${scheduleVerb ?? '字段更新'}（auto_queued=${Boolean(list[targetIdx].auto_queued)}, queue_order=${list[targetIdx].queue_order ?? 0}, hold=${Boolean(list[targetIdx].hold)}）`,
          path: 'protocols',
        });
      }
      if (action === 'schedule') continue;
    }

    if (action === 'discover') {
      const evDisc = discoverProtocolByEvent(workingState, protocolDef, gameDay);
      workingState = evDisc.state;
      if (evDisc.discovered) {
        discoveredByEventIds.push(canonicalRef);
        const admissionReady = isProtocolLabOnline(workingState, protocolDef);
        if (!admissionReady && Array.isArray(workingState.protocols)) {
          workingState = {
            ...workingState,
            protocols: workingState.protocols.map(inst =>
              canonicalizeProtocolRef(inst.ref) === canonicalRef ? { ...inst, status: 'locked' as const } : inst,
            ),
          };
        }
        const finalStatus = admissionReady ? 'available' : 'locked';
        const srcNote = decl.source || decl.reason || '奇遇/战损复盘';
        events.push({
          light: '🟢',
          layer: 'instruction',
          message: `[协议] 协议发现「${displayName}」（${canonicalRef}）→ ${finalStatus}（来源：${srcNote}）`,
          path: 'protocols',
        });
      } else {
        events.push({
          light: '🟢',
          layer: 'instruction',
          message: `[协议] 协议发现「${displayName}」（已在册 ${evDisc.instance.status}，保持不退化）`,
          path: 'protocols',
        });
      }
      continue;
    }

    // action === 'experiment'
    const expRes = executeProtocolExperiment(workingState, protocolDef, {
      gameDay,
      catalogProtocols: effectiveCatalogProtocols,
    });
    if (expRes.executed) {
      workingState = expRes.state;
      manualExperimentedIds.add(canonicalRef);
      for (const uid of expRes.unlockedNextIds) {
        unlockedInStepB.add(uid);
        unlockedTrackIds.push(uid);
      }
      manualExperiments.push({
        protocolId: canonicalRef,
        protocolName: displayName,
        executed: true,
        outcome: expRes.outcome,
        instance: expRes.instance,
        unlockedNextIds: expRes.unlockedNextIds,
      });
      events.push({
        light: '🟢',
        layer: 'instruction',
        message:
          expRes.outcome === 'breakthrough'
            ? `[协议] 协议实验突破「${displayName}」（第${expRes.instance.attempts}轮）：定型经验 100%，已正式颁布生效（消耗 ${expRes.prediction?.costPoints ?? 1} 点＋${expRes.prediction?.costCredits ?? 0} 资金）`
            : `[协议] 协议实验积累「${displayName}」（第${expRes.instance.attempts}轮）：定型经验 ${expRes.prediction?.expBefore ?? 0}%→${expRes.instance.exp}%，下次突破率 ${expRes.prediction?.nextProbPercent ?? 0}%（消耗 ${expRes.prediction?.costPoints ?? 1} 点＋${expRes.prediction?.costCredits ?? 0} 资金）`,
        path: 'protocols',
      });
    } else {
      manualExperiments.push({
        protocolId: canonicalRef,
        protocolName: displayName,
        executed: false,
        reason: expRes.reason,
        instance: expRes.instance,
        unlockedNextIds: [],
      });
      events.push({
        light: '🟡',
        layer: 'instruction',
        message: `[协议] 协议实验未执行「${displayName}」（原因：${expRes.reason ?? 'unknown'}）`,
        path: 'protocols',
      });
    }
  }

  // ── 步骤 C：Δt > 0 时 auto_queued 自动实验排程（D-P27）──
  let autoExecuted = false;
  let autoProtocolId: string | undefined;
  let autoOutcome: ProtocolExperimentOutcome | undefined;
  let autoBlockReason: ProtocolExperimentBlockReason | undefined;
  const autoUnlockedNextIds: string[] = [];

  if (deltaMinutes > 0 && (workingState.protocols?.some(p => p.auto_queued === true) ?? false)) {
    const skipProtocolIds = new Set<string>([...manualExperimentedIds, ...unlockedInStepB]);
    const autoRes = settleAutoProtocols(workingState, effectiveCatalogProtocols, {
      gameDay,
      skipProtocolIds,
    });
    workingState = autoRes.state;

    if (autoRes.experimentExecuted && autoRes.experimentResult) {
      autoExecuted = true;
      autoProtocolId = autoRes.experimentProtocolId;
      autoOutcome = autoRes.experimentOutcome;
      for (const uid of autoRes.unlockedIds) {
        if (!unlockedTrackIds.includes(uid)) unlockedTrackIds.push(uid);
        autoUnlockedNextIds.push(uid);
      }
      const autoName = resolveProtocolDisplayName(autoProtocolId ?? '');
      events.push({
        light: '🟢',
        layer: 'instruction',
        message:
          autoOutcome === 'breakthrough'
            ? `[协议] 自动排程实验突破「${autoName}」（第${autoRes.experimentResult.attempt}轮）：定型经验 100%，已正式颁布生效`
            : `[协议] 自动排程实验积累「${autoName}」（第${autoRes.experimentResult.attempt}轮）：定型经验 ${autoRes.experimentResult.exp_after}%`,
        path: 'protocols',
      });
    } else if (autoRes.experimentBlockedReason) {
      autoBlockReason = autoRes.experimentBlockedReason;
    }
  }

  // 旧档零注入护栏：若入参无 protocols 字段且本轮未产生任何协议实例，保持 protocols 为 undefined
  if (!hadProtocolsField && Array.isArray(workingState.protocols) && workingState.protocols.length === 0) {
    const rest = { ...workingState };
    delete (rest as { protocols?: unknown }).protocols;
    workingState = rest as StatData;
  }

  return {
    next: workingState,
    events,
    receipt: {
      dailyRate,
      deltaPoints,
      discoveredByExperimentIds,
      discoveredByEventIds,
      unlockedTrackIds,
      manualExperiments,
      autoExecuted,
      autoProtocolId,
      autoOutcome,
      autoBlockReason,
      autoUnlockedNextIds,
    },
  };
}

/* ═══════════════ CMD-ENGINE-01 · 联席参谋部结算引擎与终生唯一首发 MCV 防刷锁 ═══════════════ */

export type CommandHQWithCap = CommandHQ & { staff_slot_cap?: number };

/**
 * BUG-R2-25(2)：按副官 `name` 去重（跳过空名与主指挥官兼任占位），
 * 当同一副官因 `<阵营解锁>` 与 `<事件> 副官指派` 先后入账出现重复项时，原位合并最新字段并移除重复项。
 */
export function dedupAdjutantsByName(adjutants: Adjutant[]): Adjutant[] {
  if (!Array.isArray(adjutants) || adjutants.length <= 1) return adjutants;
  const seenByName = new Map<string, number>();
  const result: Adjutant[] = [];

  for (const adj of adjutants) {
    if (!adj) continue;
    const trimmedName = String(adj.name ?? '').trim();
    if (!trimmedName || adj.identity === 'commander_self') {
      result.push(adj);
      continue;
    }
    const prevIdx = seenByName.get(trimmedName);
    if (prevIdx === undefined) {
      seenByName.set(trimmedName, result.length);
      result.push(adj);
    } else {
      const prev = result[prevIdx];
      const mergedRole = prev.role === 'faction' || adj.role === 'faction' ? 'faction' : adj.role;
      const mergedFaction =
        adj.faction && adj.faction !== 'common'
          ? adj.faction
          : prev.faction && prev.faction !== 'common'
            ? prev.faction
            : adj.faction || prev.faction;
      result[prevIdx] = {
        ...prev,
        ...adj,
        id:
          mergedRole === 'faction' && mergedFaction
            ? `adj_faction_${normalizeFactionId(mergedFaction) || mergedFaction}`
            : adj.id || prev.id,
        role: mergedRole,
        faction: mergedFaction,
        title: adj.title || prev.title,
        buff_preset: adj.buff_preset || prev.buff_preset,
        note: adj.note || prev.note,
      };
    }
  }

  adjutants.splice(0, adjutants.length, ...result);
  return adjutants;
}

export function ensureCommandHQ(data: StatData): CommandHQWithCap {
  const existing = (data.command ?? {}) as Partial<CommandHQWithCap>;
  const adjutants = Array.isArray(existing.adjutants) ? existing.adjutants : [];
  dedupAdjutantsByName(adjutants);
  const cmd: CommandHQWithCap = {
    commander_name: typeof existing.commander_name === 'string' ? existing.commander_name : '',
    commander_title:
      typeof existing.commander_title === 'string' && existing.commander_title
        ? existing.commander_title
        : '战区最高统帅',
    unlocked_factions: Array.isArray(existing.unlocked_factions) ? existing.unlocked_factions : ['allied'],
    mcv_granted_factions: Array.isArray(existing.mcv_granted_factions) ? existing.mcv_granted_factions : [],
    adjutants,
    break_in_penalties: Array.isArray(existing.break_in_penalties) ? existing.break_in_penalties : [],
    ...(typeof existing.upkeep_remainder === 'number' && existing.upkeep_remainder > 0
      ? { upkeep_remainder: existing.upkeep_remainder }
      : {}),
    staff_slot_cap: deriveStaffSlotCap(data),
  };
  data.command = cmd;
  return cmd;
}

export function cloneCommandHQ(data: StatData): CommandHQWithCap {
  const cmd = ensureCommandHQ(data);
  return {
    commander_name: cmd.commander_name,
    commander_title: cmd.commander_title,
    unlocked_factions: [...cmd.unlocked_factions],
    mcv_granted_factions: [...cmd.mcv_granted_factions],
    adjutants: cmd.adjutants.map(a => ({ ...a })),
    break_in_penalties: cmd.break_in_penalties.map(p => ({ ...p })),
    ...(typeof cmd.upkeep_remainder === 'number' && cmd.upkeep_remainder > 0
      ? { upkeep_remainder: cmd.upkeep_remainder }
      : {}),
    staff_slot_cap: deriveStaffSlotCap(data),
  };
}

/**
 * 阵营解锁入账与终生唯一首发 MCV 机娘防刷锁：
 * - 确保 `data.command` 初始化（含 `unlocked_factions`、`mcv_granted_factions`、`adjutants`、`break_in_penalties`、`staff_slot_cap`）；
 * - 首次解锁阵营时，写入 `mcv_granted_factions`，配发首发 MCV 载具与首发 MCV 机娘，并默认指派为该阵营主责副官；
 * - 若 `mcv_granted_factions` 已包含该阵营，严禁再次发放第二台 MCV 或重复注册机娘，记录防刷拦截日志。
 */
export function applyFactionUnlockSettlement(data: StatData, unlocks: readonly ParsedFactionUnlock[]): string[] {
  const logs: string[] = [];
  const cmd = ensureCommandHQ(data);
  if (!data.forces) {
    (data as unknown as Record<string, unknown>).forces = {
      girls: [],
      troops: {},
      command_cap: '',
      vehicles: [],
      ammo: {},
      equipment: {},
    };
  }
  if (!Array.isArray(data.forces.vehicles)) {
    data.forces.vehicles = [];
  }
  if (!Array.isArray(data.forces.girls)) {
    data.forces.girls = [];
  }

  if (!Array.isArray(unlocks) || unlocks.length === 0) {
    return logs;
  }

  for (const unlock of unlocks) {
    if (!unlock) continue;
    const factionId = normalizeFactionId(unlock.factionId);
    if (!factionId) continue;

    if (!cmd.unlocked_factions.includes(factionId)) {
      cmd.unlocked_factions.push(factionId);
    }

    if (cmd.mcv_granted_factions.includes(factionId)) {
      logs.push(`[防刷拦截] 阵营 ${factionId} 曾发放过首发 MCV，跳过重复配发`);
      continue;
    }

    cmd.mcv_granted_factions.push(factionId);
    const starter = resolveStarterMcvInfo(factionId);
    const vehicleName =
      starter?.vehicleName ??
      unlock.initialGrants?.find((g: string) => g.includes('MCV')) ??
      `MCV（${unlock.factionLabel || factionId}）`;
    const girlName = starter?.girlName ?? unlock.starterGirlName ?? '';
    const girlDuty =
      starter?.girlDuty ?? unlock.starterGirlModel ?? `${unlock.factionLabel || factionId}MCV移动基地车核心`;
    const defaultBuffPreset = starter?.defaultBuffPreset ?? '';

    if (vehicleName && !data.forces.vehicles.includes(vehicleName)) {
      data.forces.vehicles.push(vehicleName);
    }

    if (girlName) {
      const hasGirl = data.forces.girls.some(
        g => (typeof g === 'string' && g === girlName) || (g && typeof g === 'object' && g.name === girlName),
      );
      if (!hasGirl) {
        data.forces.girls.push({
          name: girlName,
          duty: girlDuty,
          hp: '完好',
          base: '',
        } as unknown as StatData['forces']['girls'][number]);
      }
    }

    const existingByNameIdx = girlName
      ? cmd.adjutants.findIndex(a => a && a.identity !== 'commander_self' && String(a.name ?? '').trim() === girlName)
      : -1;
    const hasFactionAdjutant = cmd.adjutants.some(
      a => a.role === 'faction' && normalizeFactionId(a.faction) === factionId,
    );
    if (existingByNameIdx >= 0 && !hasFactionAdjutant) {
      const prev = cmd.adjutants[existingByNameIdx];
      cmd.adjutants[existingByNameIdx] = {
        ...prev,
        id: `adj_faction_${factionId}`,
        role: 'faction',
        faction: factionId,
        identity: 'mcv_girl',
        name: girlName,
        title: prev.title || girlDuty,
        buff_preset: prev.buff_preset || defaultBuffPreset,
        upkeep_daily: 0,
      };
    } else if (!hasFactionAdjutant && girlName && existingByNameIdx < 0) {
      cmd.adjutants.push({
        id: `adj_faction_${factionId}`,
        role: 'faction',
        faction: factionId,
        identity: 'mcv_girl',
        name: girlName,
        title: girlDuty,
        buff_preset: defaultBuffPreset,
        upkeep_daily: 0,
        status: 'active',
        note: '',
      });
    }

    logs.push(`[阵营解锁] 已解锁 ${factionId} 并配发首发 MCV 与机娘 ${starter?.girlName ?? girlName}`);
  }

  return logs;
}

/**
 * 处理 `<事件> 副官指派` 声明入账：
 * - `role === 'faction'`：按阵营替换或新增阵营主责副官；
 * - `role === 'staff'`：校验 `deriveStaffSlotCap(data)`，若已满且非同名更新则替换最早的 `'staff'` 副官；
 * - `penalty_preset` 存在时经 `resolveFactionPenaltyPreset` 校验后写入 `break_in_penalties`（同 `id`+`faction` 幂等去重）。
 */
export function applyAdjutantEventDeclaration(data: StatData, decl: AdjutantEventDecl): string[] {
  const logs: string[] = [];
  if (!decl) return logs;

  const cmd = ensureCommandHQ(data);
  const cap = deriveStaffSlotCap(data);
  cmd.staff_slot_cap = cap;

  const faction = decl.faction ? normalizeFactionId(decl.faction) : decl.role === 'staff' ? 'common' : 'allied';

  if (decl.identity === 'mcv_girl') {
    if (faction !== 'common' && !cmd.unlocked_factions.some(f => normalizeFactionId(f) === faction)) {
      logs.push(`[副官指派拦截] 阵营 ${faction} 尚未解锁，拒绝指派 MCV 机娘副官 ${decl.name}`);
      return logs;
    }
    const girls = Array.isArray(data.forces?.girls)
      ? (data.forces.girls as unknown as Array<Record<string, unknown>>)
      : [];
    const girl = girls.find(g => g && g.name === decl.name);
    const rawHp = girl?.hp;
    const stateText = `${typeof rawHp === 'string' ? rawHp : ''} ${String(girl?.status ?? '')}`;
    if (!girl || (typeof rawHp === 'number' && rawHp <= 0) || GIRL_SEVERE_INJURY_RE.test(stateText)) {
      logs.push(`[副官指派拦截] 机娘 ${decl.name} 不在编或处于失能状态，拒绝指派`);
      return logs;
    }
  }

  const resolvedBuff = decl.buff_preset ? resolveAdjutantBuffPreset(decl.buff_preset) : undefined;
  const buffPresetId = decl.identity === 'commander_self' ? '' : (resolvedBuff?.id ?? decl.buff_preset ?? '');
  const upkeepDaily = decl.identity === 'human' ? HUMAN_ADJUTANT_DAILY_UPKEEP : 0;

  const nextAdj: Adjutant = {
    id: decl.role === 'faction' ? `adj_faction_${faction}` : `adj_staff_${decl.name}`,
    role: decl.role,
    faction,
    identity: decl.identity,
    name: decl.name,
    title: decl.title || '',
    buff_preset: buffPresetId,
    upkeep_daily: upkeepDaily,
    status: 'active',
    note: decl.reason || '',
    ...(decl.base?.trim() ? { base: decl.base.trim() } : {}),
  };

  // BUG-R2-25(2)：先按副官姓名查找是否已在编（不论此前是 faction 还是 staff），防同名副官重复入列
  const existingSameNameIdx =
    decl.identity !== 'commander_self' && decl.name.trim()
      ? cmd.adjutants.findIndex(a => a && a.identity !== 'commander_self' && String(a.name ?? '').trim() === decl.name.trim())
      : -1;

  if (decl.role === 'faction') {
    const existFactionIdx = cmd.adjutants.findIndex(
      a => a.role === 'faction' && normalizeFactionId(a.faction) === faction,
    );
    if (existFactionIdx >= 0) {
      cmd.adjutants[existFactionIdx] = nextAdj;
      if (existingSameNameIdx >= 0 && existingSameNameIdx !== existFactionIdx) {
        cmd.adjutants.splice(existingSameNameIdx, 1);
      }
      logs.push(`[副官指派] 已更新 ${faction} 阵营主责副官为 ${decl.name}（${decl.identity}）`);
    } else if (existingSameNameIdx >= 0) {
      const prev = cmd.adjutants[existingSameNameIdx];
      const resolvedFaction =
        faction && faction !== 'common'
          ? faction
          : prev.faction && prev.faction !== 'common'
            ? normalizeFactionId(prev.faction) || prev.faction
            : faction;
      cmd.adjutants[existingSameNameIdx] = {
        ...prev,
        ...nextAdj,
        id: `adj_faction_${resolvedFaction}`,
        role: 'faction',
        faction: resolvedFaction,
        title: nextAdj.title || prev.title,
        buff_preset: nextAdj.buff_preset || prev.buff_preset,
        note: nextAdj.note || prev.note,
      };
      logs.push(`[副官指派] 已更新 ${resolvedFaction} 阵营主责副官为 ${decl.name}（${decl.identity}）`);
    } else {
      cmd.adjutants.push(nextAdj);
      logs.push(`[副官指派] 已指派 ${faction} 阵营主责副官 ${decl.name}（${decl.identity}）`);
    }
  } else {
    const sameNameIdx =
      existingSameNameIdx >= 0
        ? existingSameNameIdx
        : cmd.adjutants.findIndex(a => a.role === 'staff' && a.name === decl.name);
    if (sameNameIdx >= 0) {
      const prev = cmd.adjutants[sameNameIdx];
      cmd.adjutants[sameNameIdx] = {
        ...prev,
        ...nextAdj,
        title: nextAdj.title || prev.title,
        buff_preset: nextAdj.buff_preset || prev.buff_preset,
        note: nextAdj.note || prev.note,
      };
      logs.push(`[副官指派] 已更新参谋部随行参谋 ${decl.name}`);
    } else {
      const staffIndices = cmd.adjutants.map((a, idx) => (a.role === 'staff' ? idx : -1)).filter(idx => idx >= 0);
      if (staffIndices.length >= cap) {
        const earliestIdx = staffIndices[0];
        const replaced = cmd.adjutants[earliestIdx];
        cmd.adjutants[earliestIdx] = nextAdj;
        logs.push(
          `[副官指派] 参谋槽已满（${cap}/${cap}），新任参谋 ${decl.name} 替换最早在编参谋 ${replaced?.name ?? ''}`,
        );
      } else {
        cmd.adjutants.push(nextAdj);
        logs.push(`[副官指派] 已增补参谋部随行参谋 ${decl.name}（槽位 ${staffIndices.length + 1}/${cap}）`);
      }
    }
  }

  dedupAdjutantsByName(cmd.adjutants);

  if (decl.penalty_preset && decl.penalty_preset !== '无' && decl.penalty_preset.toLowerCase() !== 'none') {
    const preset = resolveFactionPenaltyPreset(decl.penalty_preset, faction);
    if (preset) {
      const penFaction = faction && faction !== 'common' ? faction : preset.faction;
      const nextPenalty: FactionBreakInPenalty = {
        id: preset.id,
        faction: penFaction,
        name: preset.name,
        effect_kind: preset.effect_kind,
        magnitude: preset.magnitude,
        total_minutes: preset.totalMinutes,
        remaining_minutes: preset.totalMinutes,
        reason: decl.reason || preset.reason,
        ...(decl.base?.trim() ? { base: decl.base.trim() } : {}),
      };
      const existPenIdx = cmd.break_in_penalties.findIndex(
        p => p.id === nextPenalty.id && normalizeFactionId(p.faction) === normalizeFactionId(nextPenalty.faction),
      );
      if (existPenIdx >= 0) {
        cmd.break_in_penalties[existPenIdx] = nextPenalty;
      } else {
        cmd.break_in_penalties.push(nextPenalty);
      }
      logs.push(`[磨合代价] 触发阵营磨合期代价「${preset.name}」（持续 ${preset.totalMinutes} 分钟）`);
    }
  }

  return logs;
}

const GIRL_SEVERE_INJURY_RE = /重伤|重损|损毁|被毁|摧毁|瘫痪|离线|阵亡|mia|kia|offline/i;
const GIRL_RECOVERING_IN_PROGRESS_RE = /修复中|维修中|维护中|医疗舱|休整|抢修中|治疗中|康复中|recovering|repairing/i;

/**
 * 联席参谋部楼层时钟结算切片：
 * 1. 同步 `data.command.staff_slot_cap = deriveStaffSlotCap(data)`；
 * 2. 机娘副官重伤休眠联动：若对应机娘 `hp <= 0` 或状态含 `'重伤'|'重损'|'损毁'|'离线'`，置 `adj.status = 'recovering'`（专长 Buff 暂停）；
 *    当处于 `'修复中'|'维修中'|'维护中'|'医疗舱'|'休整'` 时保持 `recovering`，直至真正康复（如 `'完好'|'轻伤'|'轻损'`）后自动置回 `'active'`；
 * 3. 人类副官日薪扣除：`deltaMinutes > 0` 时按 `Math.round((HUMAN_ADJUTANT_DAILY_UPKEEP * humanCount * deltaMinutes) / 1440)` 扣减资金（下限 0）；
 * 4. 15 日（21600 分钟）磨合期倒计时自动消解：扣减 `deltaMinutes`，清除 `remaining_minutes <= 0` 的到期条目并记录消解日志。
 */
export function settleCommandHQSlice(
  data: StatData,
  deltaMinutes: number,
): {
  logs: string[];
  effectiveAdjutantBuffs: Record<string, number>;
  activePenalties: FactionBreakInPenalty[];
} {
  const logs: string[] = [];
  const cmd = ensureCommandHQ(data);
  cmd.staff_slot_cap = deriveStaffSlotCap(data);

  const girls = Array.isArray(data.forces?.girls)
    ? (data.forces.girls as unknown as Array<Record<string, unknown>>)
    : [];
  const isSevereText = (s: string) => GIRL_SEVERE_INJURY_RE.test(s);
  const isRecoveringInProgressText = (s: string) => GIRL_RECOVERING_IN_PROGRESS_RE.test(s);

  for (const adj of cmd.adjutants) {
    if (!adj || adj.identity !== 'mcv_girl') continue;
    const girlRef = (adj as Adjutant & { girl_ref?: string }).girl_ref || adj.name;
    const girl = girls.find(g => g && g.name === girlRef);
    if (!girl) {
      if ((adj.status as string) !== 'recovering') {
        (adj as { status: string }).status = 'recovering';
        logs.push(`[副官休眠] 机娘 ${adj.name} 不在编，副官职务转入休眠恢复态（recovering），专长加成暂停`);
      }
      continue;
    }

    const rawHp = girl.hp;
    const rawStatus = String(girl.status ?? '');
    const hpStr = typeof rawHp === 'string' ? rawHp : '';
    const isCriticallyInjured =
      (typeof rawHp === 'number' && rawHp <= 0) || isSevereText(rawStatus) || isSevereText(hpStr);
    const isStillInRepair = isRecoveringInProgressText(rawStatus) || isRecoveringInProgressText(hpStr);
    const isHealthy =
      (typeof rawHp === 'number' ? rawHp > 0 : !isSevereText(hpStr)) &&
      !isSevereText(rawStatus) &&
      !isStillInRepair;

    if (isCriticallyInjured) {
      if ((adj.status as string) !== 'recovering') {
        (adj as { status: string }).status = 'recovering';
        logs.push(`[副官休眠] 机娘 ${adj.name} 重伤/损毁，副官职务转入休眠恢复态（recovering），专长加成暂停`);
      }
    } else if ((adj.status as string) === 'recovering' && isHealthy) {
      (adj as { status: string }).status = 'active';
      logs.push(`[副官恢复] 机娘 ${adj.name} 伤势恢复，副官职务重新激活（active）`);
    }
  }

  const effectiveAdjutantBuffs: Record<string, number> = {};
  for (const adj of cmd.adjutants) {
    if (!adj || (adj.status as string) !== 'active') continue;
    if (adj.identity === 'commander_self' || !adj.buff_preset) continue;
    const preset = resolveAdjutantBuffPreset(adj.buff_preset);
    if (!preset) continue;
    const effectValues = adj.identity === 'mcv_girl' ? preset.mcv_girl : preset.human;
    for (const [key, val] of Object.entries(effectValues)) {
      if (typeof val === 'number' && Number.isFinite(val)) {
        effectiveAdjutantBuffs[key] = Math.round(((effectiveAdjutantBuffs[key] ?? 0) + val) * 10000) / 10000;
      }
    }
  }

  if (deltaMinutes > 0) {
    const activeHumans = cmd.adjutants.filter(a => a && (a.status as string) === 'active' && a.identity === 'human');
    if (activeHumans.length > 0) {
      const totalUpkeepDaily = activeHumans.reduce(
        (sum, a) => sum + (a.upkeep_daily > 0 ? a.upkeep_daily : HUMAN_ADJUTANT_DAILY_UPKEEP),
        0,
      );
      const exactTotal = (cmd.upkeep_remainder ?? 0) + (totalUpkeepDaily * deltaMinutes) / 1440;
      const upkeepCost = Math.floor(exactTotal + 1e-6);
      const nextRemainder = exactTotal - upkeepCost;
      if (nextRemainder > 1e-6) {
        cmd.upkeep_remainder = nextRemainder;
      } else {
        delete cmd.upkeep_remainder;
      }
      const rawResources = (data as unknown as { resources?: { credits?: number } }).resources;
      if (rawResources && typeof rawResources.credits === 'number') {
        rawResources.credits = Math.max(0, rawResources.credits - upkeepCost);
      }
      if (data.economy && typeof data.economy.credits === 'number') {
        data.economy.credits = Math.max(0, data.economy.credits - upkeepCost);
      }
      if (upkeepCost > 0) {
        logs.push(`[副官日薪] 结算 ${activeHumans.length} 名在岗人类副官日薪，扣除 ${upkeepCost} 资金`);
      }
    }

    if (cmd.break_in_penalties.length > 0) {
      let rawPenaltyUpkeep = 0;
      const remainingPenalties: FactionBreakInPenalty[] = [];
      for (const pen of cmd.break_in_penalties) {
        if (!pen) continue;
        const rem = Number(pen.remaining_minutes) || 0;
        const activeMinutes = Math.min(deltaMinutes, Math.max(0, rem));
        if (activeMinutes > 0 && pen.effect_kind === 'daily_upkeep') {
          const mag = Number(pen.magnitude) || 0;
          if (mag > 0) rawPenaltyUpkeep += (mag * activeMinutes) / 1440;
        }
        const nextRemaining = rem - deltaMinutes;
        if (nextRemaining <= 0) {
          logs.push(`[磨合消解] 阵营磨合期代价「${pen.name || pen.id}」已满期自动消解`);
        } else {
          pen.remaining_minutes = nextRemaining;
          remainingPenalties.push(pen);
        }
      }
      if (rawPenaltyUpkeep > 0) {
        const reduction = Math.min(0.9, Math.max(0, effectiveAdjutantBuffs.breakInUpkeepReduction ?? 0));
        const penaltyUpkeepCost = Math.round(rawPenaltyUpkeep * (1 - reduction));
        if (penaltyUpkeepCost > 0) {
          const rawResources = (data as unknown as { resources?: { credits?: number } }).resources;
          if (rawResources && typeof rawResources.credits === 'number') {
            rawResources.credits = Math.max(0, rawResources.credits - penaltyUpkeepCost);
          }
          if (data.economy && typeof data.economy.credits === 'number') {
            data.economy.credits = Math.max(0, data.economy.credits - penaltyUpkeepCost);
          }
          logs.push(
            `[磨合维持费] 结算阵营磨合期额外维持费${reduction > 0 ? `（后勤精算减免 ${Math.round(reduction * 100)}%）` : ''}，扣除 ${penaltyUpkeepCost} 资金`,
          );
        }
      }
      cmd.break_in_penalties = remainingPenalties;
    }
  }

  return {
    logs,
    effectiveAdjutantBuffs,
    activePenalties: [...cmd.break_in_penalties],
  };
}

/* ═══════════════ FD-26 · D-SCOPE-1 / D-WIRE-1 全系统副官专长与磨合惩罚硬数值汇总 ═══════════════ */

export interface CommandHQModifiers {
  /** 重工与载具生产速率加成（+0.12 / +0.18） */
  heavyVehicleProdRateBonus: number;
  /** 发电出力加成（+0.10 / +0.14 / +0.15） */
  powerOutputBonus: number;
  /** 电网磨合消退倍率（默认 1，激活时 1.25 / 1.5） */
  gridPenaltyDecayMultiplier: number;
  /** 正向资金链效率加成（+0.10 / +0.12） */
  positiveChainBonus: number;
  /** 磨合维持费减免比例（0.25 / 0.40） */
  breakInUpkeepReduction: number;
  /** 协议点日产速率加成（+0.08 / +0.12） */
  protocolDailyRateBonus: number;
  /** 协议每日保底经验加成（+5 / +8） */
  dailyExpFloor: number;
  /** 暴露度正向增量减免比例（0.30 / 0.40） */
  exposureGainReduction: number;
  /** 机匣抢修/改装/工程效率加成（+0.15 / +0.20 / +0.30） */
  repairThroughputBonus: number;
  /** 同 repairThroughputBonus（别名兼容） */
  retrofitAndEngRateBonus: number;
  /** 阵营磨合：掉电比例（power_loss，如 0.12） */
  powerLossRatio: number;
  /** 同 powerLossRatio（别名兼容） */
  power_loss: number;
  /** 阵营磨合：日额外维持费总额（未减免原始值） */
  breakInDailyUpkeepRaw: number;
  /** 阵营磨合：日额外维持费总额（已套用 breakInUpkeepReduction 减免后） */
  breakInDailyUpkeepEffective: number;
  /** 同 breakInDailyUpkeepEffective（别名兼容） */
  daily_upkeep: number;
  /** 阵营磨合：暴露度底线（exposure_floor，取最高底线） */
  exposureFloor: number;
  /** 同 exposureFloor（别名兼容） */
  exposure_floor: number;
  /** 阵营磨合：产线迟滞比例（prod_slowdown，如 0.10 / 0.12） */
  prodSlowdownRatio: number;
  /** 同 prodSlowdownRatio（别名兼容） */
  prod_slowdown: number;
}

function resolveAdjutantEffectsCompat(
  buffPresetRaw: string,
  identity: 'human' | 'mcv_girl' | 'commander_self',
): AdjutantBuffEffectValues | null {
  if (!buffPresetRaw || identity === 'commander_self') return null;
  const preset = resolveAdjutantBuffPreset(buffPresetRaw);
  if (preset) {
    return identity === 'mcv_girl' ? preset.mcv_girl : preset.human;
  }
  const norm = buffPresetRaw.trim().toLowerCase();
  if (/前线机匣抢修|机匣抢修|frontline_hull_repair|hull_repair/.test(norm)) {
    return identity === 'mcv_girl' ? { repairThroughputBonus: 0.2 } : { repairThroughputBonus: 0.15 };
  }
  return null;
}

function matchesTargetBaseScope(
  itemBase: string | undefined,
  targetBaseIdOrName: string | undefined,
  bases: ReadonlyArray<{ id?: string; name?: string }>,
): boolean {
  const scoped = typeof itemBase === 'string' ? itemBase.trim() : '';
  // 未设 base（或 base === ''）作为 theater 全局生效
  if (!scoped) return true;

  const target = typeof targetBaseIdOrName === 'string' ? targetBaseIdOrName.trim() : '';
  // 条目有 base 限定，但调用方未指定具体基地（查询纯全局修正）→ 不匹配
  if (!target) return false;

  if (scoped === target || canon(scoped) === canon(target)) return true;

  const matchedBase = bases.find(
    b =>
      b &&
      (b.id === target ||
        canon(b.id ?? '') === canon(target) ||
        b.name === target ||
        canon(b.name ?? '') === canon(target)),
  );
  if (matchedBase) {
    return (
      matchedBase.id === scoped ||
      canon(matchedBase.id ?? '') === canon(scoped) ||
      matchedBase.name === scoped ||
      canon(matchedBase.name ?? '') === canon(scoped)
    );
  }
  return false;
}

function isGirlCriticallyInjuredInForces(data: Partial<StatData> | undefined | null, girlName: string): boolean {
  const girls = Array.isArray(data?.forces?.girls)
    ? (data!.forces!.girls as unknown as Array<Record<string, unknown>>)
    : [];
  const girl = girls.find(g => g && g.name === girlName);
  if (!girl) return false;
  const rawHp = girl.hp;
  const rawStatus = String(girl.status ?? '');
  const hpStr = typeof rawHp === 'string' ? rawHp : '';
  return (typeof rawHp === 'number' && rawHp <= 0) || GIRL_SEVERE_INJURY_RE.test(rawStatus) || GIRL_SEVERE_INJURY_RE.test(hpStr);
}

/**
 * 汇总当前对战区全局（或指定基地 `targetBaseIdOrName`）生效的参谋副官 6 大专长与阵营磨合 8 大惩罚（FD-26 · D-SCOPE-1 / D-WIRE-1）：
 * - 若副官或磨合惩罚未设 `base`（或 `base === ''`），作为 `theater` 全局生效；
 * - 若设了 `base`，则仅当 `targetBaseIdOrName` 匹配该基地（ID 或名称）时生效。
 */
export function evaluateCommandHQModifiers(
  data: Partial<StatData> | undefined | null,
  targetBaseIdOrName?: string,
): CommandHQModifiers {
  const bases = Array.isArray(data?.bases) ? (data!.bases as ReadonlyArray<{ id?: string; name?: string }>) : [];
  const adjutants = Array.isArray(data?.command?.adjutants) ? data!.command!.adjutants : [];
  const penalties = Array.isArray(data?.command?.break_in_penalties) ? data!.command!.break_in_penalties : [];

  let heavyVehicleProdRateBonus = 0;
  let powerOutputBonus = 0;
  let gridPenaltyDecayMultiplier = 1;
  let positiveChainBonus = 0;
  let breakInUpkeepReduction = 0;
  let protocolDailyRateBonus = 0;
  let dailyExpFloor = 0;
  let exposureGainReduction = 0;
  let repairThroughputBonus = 0;

  for (const adj of adjutants) {
    if (!adj || (adj.status as string) !== 'active') continue;
    if (adj.identity === 'commander_self' || !adj.buff_preset) continue;
    if (adj.identity === 'mcv_girl') {
      const girlRef = (adj as Adjutant & { girl_ref?: string }).girl_ref || adj.name;
      if (girlRef && isGirlCriticallyInjuredInForces(data, girlRef)) {
        continue;
      }
    }
    if (!matchesTargetBaseScope(adj.base, targetBaseIdOrName, bases)) continue;

    const fx = resolveAdjutantEffectsCompat(adj.buff_preset, adj.identity);
    if (!fx) continue;

    if (typeof fx.heavyVehicleProdRateBonus === 'number') {
      heavyVehicleProdRateBonus += fx.heavyVehicleProdRateBonus;
    }
    if (typeof fx.powerOutputBonus === 'number') {
      powerOutputBonus += fx.powerOutputBonus;
    }
    if (typeof fx.gridPenaltyDecayMultiplier === 'number') {
      gridPenaltyDecayMultiplier = Math.max(gridPenaltyDecayMultiplier, fx.gridPenaltyDecayMultiplier);
    }
    if (typeof fx.positiveChainBonus === 'number') {
      positiveChainBonus += fx.positiveChainBonus;
    }
    if (typeof fx.breakInUpkeepReduction === 'number') {
      breakInUpkeepReduction = Math.min(0.9, breakInUpkeepReduction + fx.breakInUpkeepReduction);
    }
    if (typeof fx.protocolDailyRateBonus === 'number') {
      protocolDailyRateBonus += fx.protocolDailyRateBonus;
    }
    if (typeof fx.dailyExpFloor === 'number') {
      dailyExpFloor += fx.dailyExpFloor;
    }
    if (typeof fx.exposureGainReduction === 'number') {
      exposureGainReduction = Math.min(0.9, exposureGainReduction + fx.exposureGainReduction);
    }
    if (typeof fx.repairThroughputBonus === 'number') {
      repairThroughputBonus += fx.repairThroughputBonus;
    }
  }

  let powerLossRatio = 0;
  let breakInDailyUpkeepRaw = 0;
  let exposureFloor = 0;
  let prodSlowdownRatio = 0;

  for (const pen of penalties) {
    if (!pen || (Number(pen.remaining_minutes) || 0) <= 0) continue;
    if (!matchesTargetBaseScope(pen.base, targetBaseIdOrName, bases)) continue;
    const mag = Number(pen.magnitude) || 0;
    if (mag <= 0) continue;

    switch (pen.effect_kind) {
      case 'power_loss':
        powerLossRatio = Math.min(0.95, powerLossRatio + mag);
        break;
      case 'daily_upkeep':
        breakInDailyUpkeepRaw += mag;
        break;
      case 'exposure_floor':
        exposureFloor = Math.max(exposureFloor, mag);
        break;
      case 'prod_slowdown':
        prodSlowdownRatio = Math.min(0.9, prodSlowdownRatio + mag);
        break;
    }
  }

  const round4 = (n: number) => Math.round(n * 10000) / 10000;
  heavyVehicleProdRateBonus = round4(heavyVehicleProdRateBonus);
  powerOutputBonus = round4(powerOutputBonus);
  gridPenaltyDecayMultiplier = round4(gridPenaltyDecayMultiplier);
  positiveChainBonus = round4(positiveChainBonus);
  breakInUpkeepReduction = round4(breakInUpkeepReduction);
  protocolDailyRateBonus = round4(protocolDailyRateBonus);
  dailyExpFloor = round4(dailyExpFloor);
  exposureGainReduction = round4(exposureGainReduction);
  repairThroughputBonus = round4(repairThroughputBonus);
  powerLossRatio = round4(powerLossRatio);
  breakInDailyUpkeepRaw = round4(breakInDailyUpkeepRaw);
  const breakInDailyUpkeepEffective = round4(breakInDailyUpkeepRaw * (1 - breakInUpkeepReduction));
  exposureFloor = round4(exposureFloor);
  prodSlowdownRatio = round4(prodSlowdownRatio);

  return {
    heavyVehicleProdRateBonus,
    powerOutputBonus,
    gridPenaltyDecayMultiplier,
    positiveChainBonus,
    breakInUpkeepReduction,
    protocolDailyRateBonus,
    dailyExpFloor,
    exposureGainReduction,
    repairThroughputBonus,
    retrofitAndEngRateBonus: repairThroughputBonus,
    powerLossRatio,
    power_loss: powerLossRatio,
    breakInDailyUpkeepRaw,
    breakInDailyUpkeepEffective,
    daily_upkeep: breakInDailyUpkeepEffective,
    exposureFloor,
    exposure_floor: exposureFloor,
    prodSlowdownRatio,
    prod_slowdown: prodSlowdownRatio,
  };
}

export const aggregateActiveCommandModifiers = evaluateCommandHQModifiers;
