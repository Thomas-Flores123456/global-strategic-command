/**
 * scheduleGanttModel.ts —— 多轨时间轴甘特排程、五大领域汇总与产线双模建筑统计纯函数模型（PKG-A）
 *
 * 纪律与红线：
 * - 100% 纯函数：零 Vue / 零 Pinia / 零 DOM / 零宿主写路径，不原地修改任何入参；
 * - 严格遵守干练军事指挥官视角用语规范。
 */
import {
  accelCoefficientFor,
  LANE_REGISTRY,
  laneDefFromKey,
  type LaneDef,
} from '../../红警指挥系统/engines/productionLanes';
import type { TaskDomain, UnifiedTask } from '../../红警指挥系统/engines/taskOrchestrator';
import type {
  ScheduleBaseSection,
  ScheduleGanttState,
  SchedulePanelInput,
  ScheduleProdLaneRow,
  ScheduleProtocolLaneModel,
  ScheduleSlotRow,
  ScheduleTxnRow,
} from './schedulePanelModel';

export type GanttHorizonMode = '24h' | '72h' | '7d' | '30d' | 'auto';
export type ScheduleViewMode = 'base' | 'domain' | 'table';

export type GanttBlockCategory = 'construction' | 'production' | 'research' | 'retrofit' | 'paused';

export interface GanttAxisTick {
  offsetMin: number;
  pct: number;
  label: string;
  subLabel?: string;
}

export interface GanttAxisSegment {
  index: number;
  startOffsetMin: number;
  endOffsetMin: number;
  leftPct: number;
  widthPct: number;
  label: string;
  subLabel: string;
  isOriginSegment: boolean;
}

export interface GanttTimeAxis {
  horizonMode: GanttHorizonMode;
  horizonMinutes: number;
  originLabel: string;
  ticks: GanttAxisTick[];
  segments: GanttAxisSegment[];
}

export interface LaneDualModeBuildingRef {
  baseIndex: number;
  buildingIndex: number;
  baseName: string;
  name: string;
  mode: '生产' | '加速';
  accelScope: 'global' | 'base';
  state: string;
}

export interface LaneDualModeSummary {
  laneId: string;
  dualModeCapable: boolean;
  productionCount: number;
  accelCount: number;
  globalAccelCount: number;
  baseAccelCount: number;
  accelMultiplier: number;
  instances: LaneDualModeBuildingRef[];
}

export interface GanttSubTrackRow {
  trackIndex: number;
  label: string;
  rows: ScheduleTxnRow[];
  isIdle: boolean;
  freeAtMin: number;
  freeAtText: string;
}

export type DomainGroupId = 'construction' | 'production' | 'retrofit_megastructure' | 'research' | 'protocol';

export interface DomainScheduleGroup {
  id: DomainGroupId;
  label: string;
  shortLabel: string;
  activeCount: number;
  queuedCount: number;
  rows: ScheduleTxnRow[];
}

export interface ScheduleKpiSummary {
  activeStationCount: number;
  totalUnlockedCapacity: number;
  acceleratingLaneCount: number;
  strandedLaneCount: number;
}

const INACTIVE_BUILDING_STATES = new Set(['建造中', '停机', '受损', '损毁', '离线', '被毁', '战损']);

const LANE_UPGRADE_DESCENDANTS: Readonly<Record<string, readonly string[]>> = {
  'lane.vehicle_land': [
    '扩大版自动化战车工厂',
    '全自动军工综合体',
    '巨型联合兵工厂',
    '苏维埃工业工厂',
    '国家总动员兵工城',
    '国家总动员兵工城实现',
  ],
  'lane.vehicle_air': ['苏联空军基地', '空天飞机维护综合体'],
  'lane.vehicle_naval': ['简易船坞', '海军造船厂', '扩大版造船厂', '超级造船综合体'],
};

/**
 * 将分钟偏移量（距当前机制时钟 T=0）格式化为世界内时刻或相对时长文案。
 */
export function formatClockOffsetLabel(clock: { day: number; time: string } | undefined, offsetMin: number): string {
  const safeOffset = Number.isFinite(offsetMin) ? Math.round(offsetMin) : 0;

  if (clock && typeof clock.day === 'number' && Number.isFinite(clock.day) && typeof clock.time === 'string') {
    const baseDay = Math.max(1, Math.floor(clock.day));
    const trimmedTime = clock.time.trim();
    const match = trimmedTime.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!match) {
      return safeOffset <= 0 ? `第${baseDay}日 ${trimmedTime}` : `第${baseDay}日 ${trimmedTime} +${Math.max(1, Math.round(safeOffset / 60))}h`;
    }
    const baseHour = Number(match[1]);
    const baseMinute = Number(match[2]);
    if (safeOffset <= 0) {
      const hh0 = String(baseHour).padStart(2, '0');
      const mm0 = String(baseMinute).padStart(2, '0');
      return `第${baseDay}日 ${hh0}:${mm0}`;
    }
    const totalMin = baseHour * 60 + baseMinute + safeOffset;
    const dayOffset = Math.floor(totalMin / 1440);
    const remMin = ((totalMin % 1440) + 1440) % 1440;
    const hh = String(Math.floor(remMin / 60)).padStart(2, '0');
    const mm = String(remMin % 60).padStart(2, '0');
    return `第${baseDay + dayOffset}日 ${hh}:${mm}`;
  }

  if (safeOffset <= 0) {
    return '当前时刻';
  }

  const totalHours = Math.max(1, Math.round(safeOffset / 60));
  if (totalHours <= 24) {
    return `+${totalHours}h`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `+${days}d ${hours}h`;
}

/**
 * 构建甘特时间轴视野标尺与刻度列表（支持 24h / 72h / 7d / 30d / auto 五档）。
 */
export function buildGanttTimeAxis(
  clock: { day: number; time: string } | undefined,
  horizonMode: GanttHorizonMode,
  maxEndOffsetMin = 1440,
): GanttTimeAxis {
  const safeMaxEnd = Number.isFinite(maxEndOffsetMin) ? Math.max(0, maxEndOffsetMin) : 1440;

  let horizonMinutes: number;
  let tickOffsets: number[];

  switch (horizonMode) {
    case '24h':
      horizonMinutes = 1440;
      tickOffsets = [0, 360, 720, 1080, 1440];
      break;
    case '72h':
      horizonMinutes = 4320;
      tickOffsets = [0, 720, 1440, 2160, 2880, 3600, 4320];
      break;
    case '7d':
      horizonMinutes = 10080;
      tickOffsets = [0, 1440, 2880, 4320, 5760, 7200, 8640, 10080];
      break;
    case '30d':
      horizonMinutes = 43200;
      tickOffsets = [0, 7200, 14400, 21600, 28800, 36000, 43200];
      break;
    case 'auto':
    default: {
      horizonMinutes = Math.max(1440, Math.ceil(safeMaxEnd / 720) * 720);
      const step = horizonMinutes / 4;
      tickOffsets = [0, step, step * 2, step * 3, horizonMinutes];
      break;
    }
  }

  const useDayLabel =
    horizonMode === '7d' ||
    horizonMode === '30d' ||
    (horizonMode === 'auto' && horizonMinutes >= 5760 && horizonMinutes % 1440 === 0);

  const originLabel = formatClockOffsetLabel(clock, 0);
  const ticks: GanttAxisTick[] = tickOffsets.map(offsetMin => {
    const pct = horizonMinutes > 0 ? Number(((offsetMin / horizonMinutes) * 100).toFixed(2)) : 0;
    let label: string;
    if (offsetMin <= 0) {
      label = '0h';
    } else if (horizonMode === '7d' || horizonMode === '30d') {
      label = `+${Math.round(offsetMin / 1440)}d`;
    } else if (useDayLabel && offsetMin % 1440 === 0) {
      label = `+${Math.round(offsetMin / 1440)}d`;
    } else {
      label = `+${Math.round(offsetMin / 60)}h`;
    }
    return {
      offsetMin,
      pct,
      label,
      subLabel: formatClockOffsetLabel(clock, offsetMin),
    };
  });

  const segments: GanttAxisSegment[] = [];
  for (let i = 0; i < ticks.length - 1; i++) {
    const cur = ticks[i];
    const nxt = ticks[i + 1];
    const widthPct = Number(Math.max(0, nxt.pct - cur.pct).toFixed(2));
    segments.push({
      index: i,
      startOffsetMin: cur.offsetMin,
      endOffsetMin: nxt.offsetMin,
      leftPct: cur.pct,
      widthPct,
      label: i === 0 ? `T0 (${originLabel})` : `${cur.label} → ${nxt.label}`,
      subLabel: cur.subLabel ?? cur.label,
      isOriginSegment: i === 0,
    });
  }

  return {
    horizonMode,
    horizonMinutes,
    originLabel,
    ticks,
    segments,
  };
}

/**
 * 推导单条甘特任务块对应的视觉语义类别（用于 F10 风格五色战术块面与圆环图例联动）。
 */
export function resolveGanttBlockCategory(txn: Pick<ScheduleTxnRow, 'type' | 'domain' | 'hold' | 'ganttState'>): GanttBlockCategory {
  if (txn.hold || txn.ganttState === 'paused') {
    return 'paused';
  }
  if (txn.domain === 'construction' || txn.type === '建造') {
    return 'construction';
  }
  if (txn.domain === 'research' || txn.domain === 'protocol' || txn.type === '研究') {
    return 'research';
  }
  if (txn.domain === 'retrofit' || txn.domain === 'megastructure' || txn.type === '改装' || txn.type === '工程') {
    return 'retrofit';
  }
  return 'production';
}

/**
 * 计算单条任务在甘特时间轴上的百分比左偏移与宽度（保底可见门柱宽度 >= 3% 且不溢出 100%）。
 */
export function computeGanttBarPosition(
  startOffsetMin: number | undefined,
  endOffsetMin: number | undefined,
  horizonMinutes: number,
): { leftPct: number; widthPct: number } {
  const safeHorizon = Number.isFinite(horizonMinutes) && horizonMinutes > 0 ? horizonMinutes : 1440;
  const rawStart = typeof startOffsetMin === 'number' && Number.isFinite(startOffsetMin) ? Math.max(0, startOffsetMin) : 0;
  const rawEnd = typeof endOffsetMin === 'number' && Number.isFinite(endOffsetMin) ? Math.max(rawStart, endOffsetMin) : rawStart;

  const MIN_WIDTH_PCT = 4;
  let leftPct = Math.min(100, Math.max(0, (rawStart / safeHorizon) * 100));
  const rightPct = Math.min(100, Math.max(leftPct, (rawEnd / safeHorizon) * 100));
  let widthPct = rightPct - leftPct;

  if (widthPct < MIN_WIDTH_PCT) {
    widthPct = MIN_WIDTH_PCT;
  }
  if (leftPct + widthPct > 100) {
    leftPct = Math.max(0, 100 - widthPct);
    widthPct = Math.min(100 - leftPct, widthPct);
  }

  return {
    leftPct: Number(leftPct.toFixed(2)),
    widthPct: Number(widthPct.toFixed(2)),
  };
}

function resolveCanonicalLaneDef(laneIdOrKey: string): { resolvedLaneId: string; def: LaneDef | undefined } {
  const trimmed = String(laneIdOrKey ?? '').trim();
  if (!trimmed) return { resolvedLaneId: 'lane.default', def: undefined };

  const direct = LANE_REGISTRY.find(d => d.laneId === trimmed);
  if (direct) return { resolvedLaneId: direct.laneId, def: direct };

  const fromKey = laneDefFromKey(trimmed);
  if (fromKey) return { resolvedLaneId: fromKey.laneId, def: fromKey };

  if (trimmed.endsWith(' lane.default')) {
    const def = LANE_REGISTRY.find(d => d.laneId === 'lane.default');
    return { resolvedLaneId: 'lane.default', def };
  }

  return { resolvedLaneId: trimmed, def: undefined };
}

function isBuildingActiveForLane(building: { name?: string; state?: string; status?: string }, def: LaneDef): boolean {
  const bName = typeof building.name === 'string' ? building.name.trim() : '';
  if (!bName) return false;

  const rawState = typeof building.state === 'string' ? building.state.trim() : '';
  const rawStatus = typeof building.status === 'string' ? building.status.trim() : '';
  if (rawState && INACTIVE_BUILDING_STATES.has(rawState)) return false;
  if (rawStatus && INACTIVE_BUILDING_STATES.has(rawStatus)) return false;

  if (def.anchorNames.some(anchor => bName.includes(anchor))) return true;
  const descendants = LANE_UPGRADE_DESCENDANTS[def.laneId];
  if (descendants && descendants.some(desc => bName === desc || bName.includes(desc))) {
    return true;
  }
  return false;
}

/**
 * 预计算全战区各制造产线的全局加速（accelScope === 'global'）建筑数量，
 * 供 buildSchedulePanelModel 顶层单次求值后下传，避免每个基地每个工位重复遍历所有基地。
 */
export function precomputeGlobalAccelCountByLane(
  bases: SchedulePanelInput['bases'],
): Map<string, number> {
  const result = new Map<string, number>();
  const safeBases = bases ?? [];
  if (safeBases.length === 0) return result;

  for (const laneDef of LANE_REGISTRY) {
    if (!laneDef.dualMode) continue;
    let count = 0;
    for (let bi = 0; bi < safeBases.length; bi++) {
      const buildings = safeBases[bi]?.buildings ?? [];
      for (let bdi = 0; bdi < buildings.length; bdi++) {
        const bd = buildings[bdi] as {
          name?: string;
          state?: string;
          status?: string;
          mode?: string;
          accel_scope?: string;
          accelScope?: string;
        };
        if (!isBuildingActiveForLane(bd, laneDef)) continue;
        if (bd.mode !== '加速') continue;
        const rawScope = bd.accel_scope ?? bd.accelScope;
        const accelScope: 'global' | 'base' = rawScope === 'base' ? 'base' : 'global';
        if (accelScope === 'global') {
          count += 1;
        }
      }
    }
    result.set(laneDef.laneId, count);
  }
  return result;
}

export interface DraftDependencyIndex {
  readonly validDrafts: readonly UnifiedTask[];
  readonly dependedTaskIds: ReadonlySet<string>;
}

/**
 * 预构建 draftTasks 的有效拓扑节点与前序依赖 ID 集合，
 * 使无依赖命中的常规工位直接 O(1) 短路跳过 while(progressed) 推演。
 */
export function buildDraftDependencyIndex(
  draftTasks?: readonly UnifiedTask[],
): DraftDependencyIndex {
  if (!draftTasks || draftTasks.length === 0) {
    return { validDrafts: [], dependedTaskIds: new Set<string>() };
  }
  const validDrafts: UnifiedTask[] = [];
  const dependedTaskIds = new Set<string>();
  for (const dt of draftTasks) {
    const deps = dt.topology?.dependsOn ?? [];
    if (deps.length === 0) continue;
    validDrafts.push(dt);
    for (const depId of deps) {
      dependedTaskIds.add(depId);
    }
  }
  return { validDrafts, dependedTaskIds };
}

/**
 * 统计指定基地某制造产线下的对口双模建筑（⚙️生产 vs 🚀加速）实例及当前生效加速比。
 */
export function summarizeLaneDualModeBuildings(
  bases: SchedulePanelInput['bases'],
  baseKey: string,
  laneId: string,
  accelMultiplier = 1,
  precomputedGlobalAccelByLane?: ReadonlyMap<string, number>,
): LaneDualModeSummary {
  const { resolvedLaneId, def } = resolveCanonicalLaneDef(laneId);
  if (!def || !def.dualMode) {
    return {
      laneId: resolvedLaneId,
      dualModeCapable: false,
      productionCount: 0,
      accelCount: 0,
      globalAccelCount: 0,
      baseAccelCount: 0,
      accelMultiplier: 1,
      instances: [],
    };
  }

  const safeBases = bases ?? [];
  const ref = String(baseKey ?? '').trim();
  let targetBaseIndex = safeBases.findIndex(
    b => (typeof b.id === 'string' && b.id.trim() === ref) || (typeof b.name === 'string' && b.name.trim() === ref),
  );
  if (targetBaseIndex < 0 && ref) {
    targetBaseIndex = safeBases.findIndex(b => {
      const bid = typeof b.id === 'string' ? b.id.trim() : '';
      const bname = typeof b.name === 'string' ? b.name.trim() : '';
      return (bid.length > 0 && ref.startsWith(`${bid} `)) || (bname.length > 0 && ref.startsWith(`${bname} `));
    });
  }

  let productionCount = 0;
  let accelCount = 0;
  let globalAccelCount = precomputedGlobalAccelByLane
    ? (precomputedGlobalAccelByLane.get(resolvedLaneId) ?? 0)
    : 0;
  let baseAccelCount = 0;
  const instances: LaneDualModeBuildingRef[] = [];

  if (precomputedGlobalAccelByLane) {
    // 已预计算全战区 globalAccelCount：仅扫描目标基地自身的 buildings
    if (targetBaseIndex >= 0 && targetBaseIndex < safeBases.length) {
      const b = safeBases[targetBaseIndex];
      const baseName = (b.name ?? b.id ?? '').trim() || `基地#${targetBaseIndex + 1}`;
      const buildings = b.buildings ?? [];
      for (let bdi = 0; bdi < buildings.length; bdi++) {
        const bd = buildings[bdi] as {
          name?: string;
          state?: string;
          status?: string;
          mode?: string;
          accel_scope?: string;
          accelScope?: string;
        };
        if (!isBuildingActiveForLane(bd, def)) continue;

        const mode: '生产' | '加速' = bd.mode === '加速' ? '加速' : '生产';
        const rawScope = bd.accel_scope ?? bd.accelScope;
        const accelScope: 'global' | 'base' = rawScope === 'base' ? 'base' : 'global';
        const state = (bd.state ?? bd.status ?? '运转').trim() || '运转';

        if (mode === '加速') {
          accelCount += 1;
          if (accelScope === 'base') {
            baseAccelCount += 1;
          }
        } else {
          productionCount += 1;
        }
        instances.push({
          baseIndex: targetBaseIndex,
          buildingIndex: bdi,
          baseName,
          name: (bd.name ?? '').trim(),
          mode,
          accelScope,
          state,
        });
      }
    }
  } else {
    for (let bi = 0; bi < safeBases.length; bi++) {
      const b = safeBases[bi];
      const baseName = (b.name ?? b.id ?? '').trim() || `基地#${bi + 1}`;
      const buildings = b.buildings ?? [];

      for (let bdi = 0; bdi < buildings.length; bdi++) {
        const bd = buildings[bdi] as {
          name?: string;
          state?: string;
          status?: string;
          mode?: string;
          accel_scope?: string;
          accelScope?: string;
        };
        if (!isBuildingActiveForLane(bd, def)) continue;

        const mode: '生产' | '加速' = bd.mode === '加速' ? '加速' : '生产';
        const rawScope = bd.accel_scope ?? bd.accelScope;
        const accelScope: 'global' | 'base' = rawScope === 'base' ? 'base' : 'global';
        const state = (bd.state ?? bd.status ?? '运转').trim() || '运转';

        if (mode === '加速') {
          if (accelScope === 'base') {
            if (bi === targetBaseIndex) {
              baseAccelCount += 1;
            }
          } else {
            globalAccelCount += 1;
          }
        }

        if (bi === targetBaseIndex) {
          if (mode === '加速') {
            accelCount += 1;
          } else {
            productionCount += 1;
          }
          instances.push({
            baseIndex: bi,
            buildingIndex: bdi,
            baseName,
            name: (bd.name ?? '').trim(),
            mode,
            accelScope,
            state,
          });
        }
      }
    }
  }

  const totalEffectiveAccelCount = globalAccelCount + baseAccelCount;
  const resolvedAccelMultiplier =
    totalEffectiveAccelCount > 0
      ? accelCoefficientFor(totalEffectiveAccelCount)
      : Number.isFinite(accelMultiplier) && accelMultiplier > 0
        ? Number(accelMultiplier.toFixed(2))
        : 1;

  return {
    laneId: resolvedLaneId,
    dualModeCapable: true,
    productionCount,
    accelCount,
    globalAccelCount,
    baseAccelCount,
    accelMultiplier: resolvedAccelMultiplier,
    instances,
  };
}

/**
 * 单产线/工位多子轨道最早空闲接力排程（Earliest-Available Sub-Track Scheduling）。
 */
export function scheduleLaneSubTracks(
  txns: readonly ScheduleTxnRow[],
  capacity: number,
  accelEff = 1,
  clock?: { day: number; time: string },
  draftTasks?: readonly UnifiedTask[],
  precomputedDraftIndex?: DraftDependencyIndex,
): {
  enrichedTxns: ScheduleTxnRow[];
  subTracks: GanttSubTrackRow[];
  draftPreviews: ScheduleTxnRow[];
  maxEndOffsetMin: number;
} {
  const safeCapacity = Number.isFinite(capacity) ? Math.max(0, Math.floor(capacity)) : 0;
  const trackCount = Math.max(1, safeCapacity);
  const trackFreeAt = new Array<number>(trackCount).fill(0);
  const trackRows: ScheduleTxnRow[][] = Array.from({ length: trackCount }, () => []);
  const effectiveAccel = Number.isFinite(accelEff) && accelEff > 0 ? Number(accelEff.toFixed(2)) : 1;

  let maxEndOffsetMin = 0;

  const pickEarliestTrack = (): number => {
    let bestIdx = 0;
    for (let i = 1; i < trackCount; i++) {
      if (trackFreeAt[i] < trackFreeAt[bestIdx]) {
        bestIdx = i;
      }
    }
    return bestIdx;
  };

  const enrichedTxns: ScheduleTxnRow[] = txns.map(txn => {
    const clone: ScheduleTxnRow = {
      ...txn,
      effectiveAccel: txn.effectiveAccel ?? effectiveAccel,
    };

    if (txn.status === 'settling') {
      clone.subTrackIndex = 0;
      clone.startOffsetMin = 0;
      clone.endOffsetMin = 0;
      clone.startEtaText = '待确认完工';
      clone.endEtaText = '立即交付';
      trackRows[0].push(clone);
      return clone;
    }

    if (txn.hold === true) {
      const rem = txn.remainingMinutes ?? 0;
      clone.subTrackIndex = 0;
      clone.startOffsetMin = 0;
      clone.endOffsetMin = rem;
      clone.startEtaText = '已暂缓';
      clone.endEtaText = '待恢复';
      if (rem > maxEndOffsetMin) maxEndOffsetMin = rem;
      trackRows[0].push(clone);
      return clone;
    }

    if (txn.status === 'active') {
      const tIdx = pickEarliestTrack();
      const dur =
        txn.remainingMinutes !== null && txn.remainingMinutes !== undefined
          ? Math.max(0, Math.ceil(txn.remainingMinutes / effectiveAccel))
          : 0;
      clone.subTrackIndex = tIdx;
      clone.startOffsetMin = 0;
      clone.endOffsetMin = dur;
      clone.startEtaText = formatClockOffsetLabel(clock, 0);
      clone.endEtaText = formatClockOffsetLabel(clock, dur);
      trackFreeAt[tIdx] = dur;
      if (dur > maxEndOffsetMin) maxEndOffsetMin = dur;
      trackRows[tIdx].push(clone);
      return clone;
    }

    // status === 'queued' (and !txn.hold)
    if (safeCapacity > 0) {
      const bestIdx = pickEarliestTrack();
      const startOffsetMin = trackFreeAt[bestIdx];
      const dur =
        txn.remainingMinutes !== null && txn.remainingMinutes !== undefined
          ? Math.max(0, Math.ceil(txn.remainingMinutes / effectiveAccel))
          : 0;
      const endOffsetMin = startOffsetMin + dur;
      clone.subTrackIndex = bestIdx;
      clone.startOffsetMin = startOffsetMin;
      clone.endOffsetMin = endOffsetMin;
      clone.startEtaText = formatClockOffsetLabel(clock, startOffsetMin);
      clone.endEtaText = formatClockOffsetLabel(clock, endOffsetMin);
      trackFreeAt[bestIdx] = endOffsetMin;
      if (endOffsetMin > maxEndOffsetMin) maxEndOffsetMin = endOffsetMin;
      trackRows[bestIdx].push(clone);
      return clone;
    }

    // safeCapacity <= 0 (stranded / paused lane)
    const rem = txn.remainingMinutes ?? 0;
    clone.subTrackIndex = 0;
    clone.startOffsetMin = 0;
    clone.endOffsetMin = rem;
    clone.startEtaText = '产线暂停';
    clone.endEtaText = '待建筑就绪';
    if (rem > maxEndOffsetMin) maxEndOffsetMin = rem;
    trackRows[0].push(clone);
    return clone;
  });

  const subTracks: GanttSubTrackRow[] = trackRows.map((rows, idx) => ({
    trackIndex: idx,
    label: `工位 #${idx + 1}`,
    rows,
    isIdle: rows.length === 0,
    freeAtMin: trackFreeAt[idx],
    freeAtText: trackFreeAt[idx] <= 0 ? '当前空闲' : `${formatClockOffsetLabel(clock, trackFreeAt[idx])} 起空闲`,
  }));

  const draftPreviews: ScheduleTxnRow[] = [];
  if (draftTasks && draftTasks.length > 0 && enrichedTxns.length > 0) {
    const draftIndex = precomputedDraftIndex ?? buildDraftDependencyIndex(draftTasks);
    const hasRelevantSeed =
      draftIndex.validDrafts.length > 0 &&
      enrichedTxns.some(r => Boolean(r.taskId && draftIndex.dependedTaskIds.has(r.taskId)));

    if (hasRelevantSeed) {
      const resolvedTaskMap = new Map<
        string,
        { endOffsetMin: number; subTrackIndex: number; base: string; item: string }
      >();
      for (const row of enrichedTxns) {
        if (row.taskId) {
          resolvedTaskMap.set(row.taskId, {
            endOffsetMin: row.endOffsetMin ?? 0,
            subTrackIndex: row.subTrackIndex ?? 0,
            base: row.base,
            item: row.item,
          });
        }
      }

      const addedDraftIds = new Set<string>();
      let progressed = true;
      while (progressed) {
        progressed = false;
        for (const dt of draftIndex.validDrafts) {
          if (addedDraftIds.has(dt.id)) continue;
          const deps = dt.topology?.dependsOn ?? [];
          if (deps.length === 0) continue;
          const matchedDeps = deps.map(id => resolvedTaskMap.get(id)).filter((v): v is NonNullable<typeof v> => Boolean(v));
          if (matchedDeps.length === 0) continue;

          const startOffsetMin = Math.max(...matchedDeps.map(d => d.endOffsetMin));
          const primaryDep = matchedDeps[0];
          const rawRemaining = Math.max(0, (dt.workload?.totalMinutes ?? 0) - (dt.workload?.spentMinutes ?? 0));
          const dur = rawRemaining > 0 ? Math.max(0, Math.ceil(rawRemaining / effectiveAccel)) : 0;
          const endOffsetMin = startOffsetMin + dur;

          const preview: ScheduleTxnRow = {
            item: dt.name,
            type: '工程',
            base: dt.leadBaseId ?? primaryDep.base ?? '',
            hold: false,
            status: 'queued',
            tone: 'idle',
            predicate: `待「${primaryDep.item}」完工后接续解锁`,
            ganttPct: 0,
            ganttState: 'queued',
            remainingMinutes: rawRemaining,
            taskId: dt.id,
            domain: dt.domain,
            taskStatus: dt.status,
            sourceKind: dt.metadata?.sourceKind,
            subTrackIndex: primaryDep.subTrackIndex,
            startOffsetMin,
            endOffsetMin,
            startEtaText: formatClockOffsetLabel(clock, startOffsetMin),
            endEtaText: formatClockOffsetLabel(clock, endOffsetMin),
            effectiveAccel,
            ...(dt.workload?.minDaysLock && dt.workload.minDaysLock > 0
              ? { minDaysLock: dt.workload.minDaysLock }
              : {}),
            isDraftPreview: true,
          };

          draftPreviews.push(preview);
          addedDraftIds.add(dt.id);
          resolvedTaskMap.set(dt.id, {
            endOffsetMin,
            subTrackIndex: preview.subTrackIndex ?? 0,
            base: preview.base,
            item: preview.item,
          });
          if (endOffsetMin > maxEndOffsetMin) maxEndOffsetMin = endOffsetMin;
          progressed = true;
        }
      }
    }
  }

  return {
    enrichedTxns,
    subTracks,
    draftPreviews,
    maxEndOffsetMin,
  };
}

function classifyBaseLaneTxnDomainGroup(lane: ScheduleProdLaneRow, txn: ScheduleTxnRow): DomainGroupId {
  const key = lane.key;
  if (
    key.includes('eng:') ||
    lane.domain === 'retrofit' ||
    lane.domain === 'megastructure' ||
    txn.domain === 'retrofit' ||
    txn.domain === 'megastructure' ||
    txn.type === '改装' ||
    txn.type === '工程'
  ) {
    return 'retrofit_megastructure';
  }
  if (
    key.endsWith('lane.main') ||
    key.endsWith('lane.defense') ||
    key.endsWith('lane.other_building') ||
    txn.type === '建造' ||
    txn.domain === 'construction'
  ) {
    return 'construction';
  }
  return 'production';
}

/**
 * 将全战区各基地工位、科研序列与统帅部条令推演聚合为固定顺序的 5 大业务领域分组。
 */
export function buildDomainScheduleGroups(
  bases: readonly ScheduleBaseSection[],
  researchSlots: readonly ScheduleSlotRow[],
  protocolLane: ScheduleProtocolLaneModel,
): DomainScheduleGroup[] {
  const constructionRows: ScheduleTxnRow[] = [];
  const productionRows: ScheduleTxnRow[] = [];
  const retrofitRows: ScheduleTxnRow[] = [];
  const researchRows: ScheduleTxnRow[] = [];
  const protocolRows: ScheduleTxnRow[] = [];

  for (const base of bases) {
    for (const lane of base.lanes) {
      for (const txn of lane.txns) {
        const enriched: ScheduleTxnRow = {
          ...txn,
          base: txn.base || base.name,
        };
        const groupId = classifyBaseLaneTxnDomainGroup(lane, enriched);
        if (groupId === 'construction') {
          constructionRows.push(enriched);
        } else if (groupId === 'retrofit_megastructure') {
          retrofitRows.push(enriched);
        } else {
          productionRows.push(enriched);
        }
      }
    }
  }

  for (const slot of researchSlots) {
    for (const txn of slot.txns) {
      researchRows.push({
        ...txn,
        base: txn.base || slot.name,
      });
    }
  }

  if (protocolLane?.enabled && Array.isArray(protocolLane.items)) {
    for (const pItem of protocolLane.items) {
      const isActive = pItem.status === 'experimenting' && !pItem.hold;
      const ganttState: ScheduleGanttState = pItem.hold ? 'paused' : isActive ? 'active' : 'queued';
      const expPct = Math.min(100, Math.max(0, Math.round(pItem.exp ?? 0)));
      protocolRows.push({
        item: pItem.name,
        type: '研究',
        base: '最高统帅部',
        hold: Boolean(pItem.hold),
        status: isActive ? 'active' : 'queued',
        tone: pItem.hold ? 'hold' : isActive ? 'run' : 'idle',
        predicate: `顺位 #${pItem.queue_order} · 经验 ${expPct}% · 突破率 ${pItem.next_prob_pct}%`,
        ganttPct: expPct,
        ganttState,
        remainingMinutes: null,
        taskId: `task:protocol:${pItem.ref}`,
        domain: 'protocol' as TaskDomain,
        taskStatus: pItem.hold ? 'held' : isActive ? 'active' : 'queued',
        subTrackIndex: 0,
        startOffsetMin: 0,
        endOffsetMin: 1440,
        startEtaText: isActive ? '攻关推演中' : pItem.hold ? '已暂缓' : `候列 #${pItem.queue_order}`,
        endEtaText: `突破率 ${pItem.next_prob_pct}%`,
        effectiveAccel: 1,
      });
    }
  }

  const makeGroup = (
    id: DomainGroupId,
    label: string,
    shortLabel: string,
    rows: ScheduleTxnRow[],
  ): DomainScheduleGroup => ({
    id,
    label,
    shortLabel,
    activeCount: rows.filter(r => r.status === 'active' && !r.hold).length,
    queuedCount: rows.filter(r => r.status !== 'active' || r.hold).length,
    rows,
  });

  return [
    makeGroup('construction', '基地基建与防御工事', '基建建造', constructionRows),
    makeGroup('production', '军备列装与人员训练', '军备生产', productionRows),
    makeGroup('retrofit_megastructure', '装备改装与战略巨构', '改装与巨构', retrofitRows),
    makeGroup('research', '战区科研攻关序列', '战区科研', researchRows),
    makeGroup('protocol', '统帅部条令推演', '条令攻关', protocolRows),
  ];
}
