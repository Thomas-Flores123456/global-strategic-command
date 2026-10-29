/**
 * reproBundleAndDryRun.ts —— 免落盘干跑试算器与 AI 排障复现包生成器（DBG41-03）
 *
 * 职责边界：
 * 1. runDryRunPipeline：对入参 baselineStatData 只做一次入口深拷贝与 Schema.parse 归一，
 *    按真实生产顺序串联 parseMessageText -> settleFloor -> reconcileProduction/syncProjects ->
 *    applyEngOrders/commitPlanningIntent，生成 source='dry_run' 的七阶追踪记录 FloorTraceRecord。
 * 2. 全程 100% 零副作用：严禁调用 uvw、严禁触发 timelineLedger 宿主写盘、严禁写入世界书。
 * 3. buildReproBundleJson：将指定 FloorTraceRecord 与关联（或最近 20 条）异步飞行日志打包为
 *    tavernweave.ra.repro_bundle.v1 标准格式 JSON 字符串。
 */
import { klona } from 'klona';
import type { EffectiveCatalog } from '../core/catalogEffective';
import { Schema, type StatData } from '../core/schema';
import { deployBlockIndexFromCatalog } from '../engines/deploymentEngine';
import { applyEngOrders } from '../engines/engOrderBridge';
import {
  buildItemCategoriesFromCatalog,
  operationCompletionsToDeclarations,
  parseProductionDeclarations,
  reconcileEventToIssue,
  reconcileEventToParseEvent,
  reconcileProduction,
} from '../engines/productionReconciliation';
import { stripThinking } from '../parse/floorSanitize';
import { syncProjects } from '../engines/projectEngine';
import {
  applyAdjutantEventDeclaration,
  applyFactionUnlockSettlement,
  promoteIdleQueuesAtZeroDelta,
  settleFloor,
} from '../engines/settleFloor';
import { cloneCommandHQ } from '../engines/settleFloorPhases';
import {
  canon,
  parseMessageText,
  type DeployCatalogIndexLike,
  type ParseEvent,
  type ProtocolIndexSource,
  type QuarantineItem,
} from '../parse/parsePipeline';
import type { CheckIssue } from '../parse/systemCheck';
import { commitPlanningIntent } from '../planning/planningReceipt';
import {
  beginFloorTrace,
  finishFloorTrace,
  recordTraceStage,
  type AsyncFlightLogEntry,
  type FloorTraceRecord,
  type TraceStageRecord,
} from './dataFlowTracer';

export interface DryRunPipelineInput {
  rawText: string;
  baselineStatData: unknown;
  catalog?: EffectiveCatalog | null;
  floorId?: number | null;
  chatId?: string | null;
  swipeId?: number | null;
  extraDeltaMinutes?: number;
}

export interface DryRunPipelineResult {
  trace: FloorTraceRecord;
  finalStatData: StatData;
  events: ParseEvent[];
  issues: CheckIssue[];
}

export function runDryRunPipeline(input: DryRunPipelineInput): DryRunPipelineResult {
  const catalog = input.catalog ?? null;
  const chatId = input.chatId ?? 'dry-run';
  const floorId = input.floorId ?? null;
  const swipeId = input.swipeId ?? 0;

  const s0Start = performance.now();
  const initialSnap: StatData = Schema.parse(klona(input.baselineStatData ?? {}));

  const thinkFreeRaw = stripThinking(input.rawText).text;
  const rawTagsPreview = Array.from(
    new Set(Array.from(thinkFreeRaw.matchAll(/<([a-zA-Z\u4e00-\u9fa5]+)>/g), m => `<${m[1]}>`)),
  );

  const traceId = beginFloorTrace(
    {
      chatId,
      floorId,
      swipeId,
      source: 'dry_run',
      rawTagsPreview,
    },
    initialSnap,
  );

  recordTraceStage(traceId, 'S0_BASELINE', {
    beforeSnap: initialSnap,
    afterSnap: initialSnap,
    durationMs: Math.round((performance.now() - s0Start) * 100) / 100,
    status: 'ok',
    summary: '干跑基线就绪',
    meta: {
      chatId,
      floorId,
      swipeId,
      outcome: 'proceed',
    },
  });

  // S1_PARSE：标签提取与预解析（deferPlanningCommit: true 延后排产入列至 S4_BRIDGES）
  const s1Start = performance.now();
  const deployIndex: DeployCatalogIndexLike | undefined = catalog
    ? deployBlockIndexFromCatalog({
        buildings: catalog.buildings,
        productions: catalog.productions,
        retrofits: catalog.retrofits,
      })
    : undefined;
  const protocolCatalog: ProtocolIndexSource | undefined = catalog
    ? (catalog.protocols as unknown as ProtocolIndexSource)
    : undefined;

  const parsedResult = parseMessageText(input.rawText, initialSnap, {
    isFirstFloor: floorId === 0,
    floorId: floorId ?? undefined,
    deployIndex,
    protocolCatalog,
    deferPlanningCommit: true,
  });
  const s1AfterParse: StatData = parsedResult.data;
  const allEvents: ParseEvent[] = [...parsedResult.events];
  const allIssues: CheckIssue[] = [...parsedResult.issues];
  const allQuarantine: QuarantineItem[] = [...parsedResult.quarantine];

  recordTraceStage(traceId, 'S1_PARSE', {
    beforeSnap: initialSnap,
    afterSnap: s1AfterParse,
    durationMs: Math.round((performance.now() - s1Start) * 100) / 100,
    status: parsedResult.quarantine.length > 0 ? 'warn' : 'ok',
    summary: `解析完成 · 事件 ${parsedResult.events.length} 条 · 隔离 ${parsedResult.quarantine.length} 项`,
    meta: {
      tagsCount: rawTagsPreview.length,
      rawTagsPreview,
      applied: parsedResult.applied,
      eventsCount: parsedResult.events.length,
      quarantineCount: parsedResult.quarantine.length,
    },
  });

  // S2_SETTLE：九大玩法结算引擎（仅当存在副官声明或阵营解锁时按需浅拷贝 command 分支，保持其余子树结构共享）
  const s2Start = performance.now();
  const hasAdjutantDecls = parsedResult.eventDeclarations.some(
    d => d.kind === 'adjutant' && d.adjutant !== undefined,
  );
  let s2Input: StatData =
    hasAdjutantDecls || parsedResult.factionUnlocks.length > 0
      ? { ...s1AfterParse, command: cloneCommandHQ(s1AfterParse) }
      : s1AfterParse;

  if (hasAdjutantDecls) {
    for (const decl of parsedResult.eventDeclarations) {
      if (decl.kind === 'adjutant' && decl.adjutant) {
        const adjLogs = applyAdjutantEventDeclaration(s2Input, decl.adjutant);
        for (const msg of adjLogs) {
          allEvents.push({
            light: '🟢',
            layer: 'instruction',
            message: msg,
            path: 'command.adjutants',
          });
        }
      }
    }
  }
  if (parsedResult.factionUnlocks.length > 0) {
    const unlockLogs = applyFactionUnlockSettlement(s2Input, parsedResult.factionUnlocks);
    for (const msg of unlockLogs) {
      allEvents.push({
        light: msg.includes('防刷拦截') ? '🟡' : '🟢',
        layer: 'instruction',
        message: msg,
        path: 'command.unlocked_factions',
      });
    }
  }

  const settled = settleFloor(initialSnap, s2Input, input.rawText, {
    catalog,
    extraDeltaMinutes: input.extraDeltaMinutes,
    orders: parsedResult.orders,
    deployOrders: parsedResult.deployOrders,
    eventDeclarations: parsedResult.eventDeclarations.filter(d => d.kind !== 'adjutant'),
  });
  const s2AfterSettle: StatData = settled.data;
  allEvents.push(...settled.events);
  allIssues.push(...settled.issues);

  const settledSubstages = (settled as { substages?: TraceStageRecord[] }).substages;
  recordTraceStage(traceId, 'S2_SETTLE', {
    beforeSnap: s1AfterParse,
    afterSnap: s2AfterSettle,
    durationMs: Math.round((performance.now() - s2Start) * 100) / 100,
    status: settled.issues.some(i => i.level === 'error' || i.level === 'warn') ? 'warn' : 'ok',
    summary: `结算完成 · Δt=${settled.deltaMinutes}m (${settled.deltaSource})`,
    meta: {
      deltaMinutes: settled.deltaMinutes,
      deltaSource: settled.deltaSource,
    },
    ...(settledSubstages && settledSubstages.length > 0 ? { substages: settledSubstages } : {}),
  });

  // S3_RECONCILE：生产对账三色门 + 竣工工程回写 syncProjects
  const s3Start = performance.now();
  let s3Working: StatData = s2AfterSettle;
  const productionParsed = parseProductionDeclarations(thinkFreeRaw);

  const researchNamesCanon = new Set<string>();
  for (const r of catalog?.researches ?? []) {
    researchNamesCanon.add(canon(r.name));
    for (const a of (r as { aliases?: string[] }).aliases ?? []) {
      if (a) researchNamesCanon.add(canon(a));
    }
  }
  for (const c of s3Working.codex ?? []) {
    if (c.kind === '科技' && c.name) researchNamesCanon.add(canon(c.name));
  }

  const filteredOpCompletions = parsedResult.operationCompletions.filter(op => {
    const cItem = canon(op.item);
    const hasQueueCandidate = (s3Working.queues ?? []).some(q => canon(q.item) === cItem);
    if (hasQueueCandidate) return true;
    if (researchNamesCanon.has(cItem)) {
      if (!s3Working.tech.done.some(d => canon(d) === cItem)) {
        s3Working = {
          ...s3Working,
          tech: {
            ...s3Working.tech,
            done: [...s3Working.tech.done, op.item],
          },
        };
      }
      return false;
    }
    const inBuildings = (s3Working.bases ?? []).some(b =>
      (b.buildings ?? []).some(bld => canon(bld.name) === cItem && bld.state === '运转'),
    );
    const inTroops = Object.keys(s3Working.forces?.troops ?? {}).some(k => canon(k) === cItem);
    const inVehicles = (s3Working.forces?.vehicles ?? []).some(v => canon(v) === cItem);
    if (inBuildings || inTroops || inVehicles) return false;
    return true;
  });

  const completionDecls = operationCompletionsToDeclarations(s3Working, filteredOpCompletions);
  const reconcileInput = {
    found: productionParsed.found || completionDecls.length > 0,
    declarations: [...productionParsed.declarations, ...completionDecls],
    rejected: productionParsed.rejected,
  };

  let overrunCount = 0;
  if (reconcileInput.found) {
    const derivedItemCategories = buildItemCategoriesFromCatalog(catalog);
    const reconcileState =
      Object.keys(derivedItemCategories).length > 0
        ? {
            ...s3Working,
            itemCategories: {
              ...derivedItemCategories,
              ...((s3Working as { itemCategories?: Record<string, 'troops' | 'vehicles' | 'equipment'> })
                .itemCategories ?? {}),
            },
          }
        : s3Working;
    const reconciled = reconcileProduction(reconcileState, reconcileInput);
    const { itemCategories: _omitItemCategories, ...nextWithoutItemCategories } = reconciled.next as StatData & {
      itemCategories?: unknown;
    };
    s3Working = nextWithoutItemCategories as StatData;
    overrunCount = reconciled.verdicts.filter(v => v.verdict === 'OVERRUN').length;
    for (const event of reconciled.events) {
      allEvents.push(reconcileEventToParseEvent(event));
      const issue = reconcileEventToIssue(event);
      if (issue) allIssues.push(issue);
    }
    if (overrunCount === 0) {
      const syncedAfterReconcile = syncProjects(s3Working);
      s3Working = syncedAfterReconcile.next;
      for (const ev of syncedAfterReconcile.events) {
        allEvents.push({
          light: ev.type === 'sync_warn' ? '🟡' : '🟢',
          layer: 'instruction',
          path: 'projects',
          message: `[工程] ${ev.type}: ${ev.item}${ev.detail ? ` (${ev.detail})` : ''}`,
        });
      }
    }
  }
  const s3AfterReconcile: StatData = s3Working;

  recordTraceStage(traceId, 'S3_RECONCILE', {
    beforeSnap: s2AfterSettle,
    afterSnap: s3AfterReconcile,
    durationMs: Math.round((performance.now() - s3Start) * 100) / 100,
    status: overrunCount > 0 || reconcileInput.rejected.length > 0 ? 'warn' : 'ok',
    summary: reconcileInput.found
      ? `生产对账 ${reconcileInput.declarations.length} 项 · OVERRUN ${overrunCount} 项`
      : '无生产对账声明',
    meta: {
      found: reconcileInput.found,
      declarationsCount: reconcileInput.declarations.length,
      rejectedCount: reconcileInput.rejected.length,
      overrunCount,
    },
  });

  // S4_BRIDGES：工程令接缝 + 排产计划沙盒提交（不传 options.floor 以免触发 timelineLedger 宿主写盘）
  const s4Start = performance.now();
  let s4Working: StatData = s3AfterReconcile;
  if (parsedResult.engOrders.length > 0) {
    const bridged = applyEngOrders(
      s4Working,
      parsedResult.engOrders,
      catalog?.retrofits ?? [],
      catalog?.projects ?? [],
    );
    s4Working = bridged.next;
    allEvents.push(...bridged.events);
    allQuarantine.push(...bridged.quarantine);
  }

  const planningStatuses: string[] = [];
  if (parsedResult.planningDecls.length > 0 && overrunCount === 0) {
    for (const decl of parsedResult.planningDecls) {
      const committed = commitPlanningIntent(s4Working, decl, catalog);
      if (typeof floorId === 'number' && committed.next.planning?.latest_receipt) {
        committed.next.planning.latest_receipt.created_at_floor = floorId;
      }
      s4Working = committed.next;
      planningStatuses.push(committed.receipt.status);
      for (const ev of committed.events) {
        allEvents.push({
          light: ev.light,
          layer: ev.layer,
          path: 'planning',
          message: ev.message,
        });
      }
    }
  }
  if (parsedResult.engOrders.length > 0 || (parsedResult.planningDecls.length > 0 && overrunCount === 0)) {
    const promotedAfterBridges = promoteIdleQueuesAtZeroDelta(s4Working, catalog);
    s4Working = promotedAfterBridges.data;
    allEvents.push(...promotedAfterBridges.events);
    allIssues.push(...promotedAfterBridges.issues);
  }
  const s4Final: StatData = s4Working;

  recordTraceStage(traceId, 'S4_BRIDGES', {
    beforeSnap: s3AfterReconcile,
    afterSnap: s4Final,
    durationMs: Math.round((performance.now() - s4Start) * 100) / 100,
    status: 'ok',
    summary:
      parsedResult.engOrders.length > 0 || parsedResult.planningDecls.length > 0
        ? `工程令 ${parsedResult.engOrders.length} 条 · 排产计划 ${parsedResult.planningDecls.length} 份`
        : '无工程令与排产计划',
    meta: {
      engOrdersCount: parsedResult.engOrders.length,
      planningDeclsCount: parsedResult.planningDecls.length,
      planningStatuses,
    },
  });

  // S5_GUARD_RECHECK & S6_COMMIT_FEED：干跑免宿主写锁与免落盘标记
  recordTraceStage(traceId, 'S5_GUARD_RECHECK', {
    beforeSnap: s4Final,
    afterSnap: s4Final,
    durationMs: 0,
    status: 'ok',
    summary: '干跑模式免宿主写锁复核',
  });

  recordTraceStage(traceId, 'S6_COMMIT_FEED', {
    beforeSnap: s4Final,
    afterSnap: s4Final,
    durationMs: 0,
    status: 'skipped',
    summary: '免落盘干跑 · 未写入酒馆变量或世界书',
  });

  const trace = finishFloorTrace(traceId, {
    outcome: 'ok',
    finalSnap: s4Final,
    events: allEvents.map(ev => ({
      level: ev.light,
      domain: ev.layer,
      code: ev.path,
      msg: ev.message,
    })),
    issues: allIssues.map(iss => ({
      level: iss.level,
      code: iss.rule,
      message: iss.target ? `[${iss.target}] ${iss.message}` : iss.message,
    })),
    quarantine: allQuarantine.map(q => ({
      blockType: q.tag ?? q.path ?? q.scope,
      reason: q.error,
      headerLine: q.raw.slice(0, 120),
    })),
  })!;

  return {
    trace,
    finalStatData: s4Final,
    events: allEvents,
    issues: allIssues,
  };
}

export function buildReproBundleJson(
  trace: FloorTraceRecord,
  flightLogs: readonly AsyncFlightLogEntry[] = [],
): string {
  const matchedLogs = flightLogs.filter(log => {
    const chatMatch = trace.meta.chatId !== null && log.chatId === trace.meta.chatId;
    const floorMatch = trace.meta.floorId !== null && log.floorId === trace.meta.floorId;
    return chatMatch || floorMatch;
  });
  const relatedFlightLogs = (matchedLogs.length > 0 ? matchedLogs : flightLogs).slice(0, 20);

  const bundle = {
    schema: 'tavernweave.ra.repro_bundle.v1',
    exportedAt: new Date().toISOString(),
    trace,
    relatedFlightLogs,
  };

  return JSON.stringify(bundle, null, 2);
}
