/**
 * useDebugMode.ts —— 开发者沙盒与调试模式状态及免 LLM 状态注入引擎
 *
 * 提供：
 * 1. debugState（响应式持久化配置：总开关 enabled、前置全解锁上帝预览 bypassPrerequisites、全阵营透视 unlockAllFactionsPreview）
 * 2. 当前楼层 stat_data 快照备份与无损还原（按 floorId 分桶）
 * 3. 纯函数式 stat_data 快捷状态注入器（资金/六柱资源/阵营启封/核心母体建筑铺设/T1-T3科技解锁/测试部队注入/队列瞬间完工）
 */
import { reactive, watch } from 'vue';
import { Schema, type StatData } from '../core/schema';
import { canon } from '../parse/parseTypesAndCanon';

export const DEBUG_STORAGE_KEY = 'tavernweave.ra.debug_mode.v1';
export const DEBUG_BACKUP_STORAGE_KEY = 'tavernweave.ra.debug_backups.v1';

export interface DebugModeState {
  /** 调试模式总开关 */
  enabled: boolean;
  /** ① 全解锁上帝预览开关：无视建筑/科技/母体前置查看与点选全图鉴 */
  bypassPrerequisites: boolean;
  /** 全阵营透视开关：无视 unlocked_factions 同时预览盟军/苏联/尤里条目 */
  unlockAllFactionsPreview: boolean;
  /** 角落 Mini HUD 实时数据流监视胶囊显隐开关（DBG41-07） */
  miniHudOpen: boolean;
}

function loadInitialDebugState(): DebugModeState {
  try {
    const raw = globalThis.localStorage?.getItem(DEBUG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DebugModeState>;
      return {
        enabled: Boolean(parsed.enabled),
        bypassPrerequisites: Boolean(parsed.bypassPrerequisites),
        unlockAllFactionsPreview: Boolean(parsed.unlockAllFactionsPreview),
        miniHudOpen: Boolean(parsed.miniHudOpen),
      };
    }
  } catch {
    /* ignore storage error */
  }
  return {
    enabled: false,
    bypassPrerequisites: false,
    unlockAllFactionsPreview: false,
    miniHudOpen: false,
  };
}

export const debugState = reactive<DebugModeState>(loadInitialDebugState());

watch(
  debugState,
  val => {
    try {
      globalThis.localStorage?.setItem(
        DEBUG_STORAGE_KEY,
        JSON.stringify({
          enabled: val.enabled,
          bypassPrerequisites: val.bypassPrerequisites,
          unlockAllFactionsPreview: val.unlockAllFactionsPreview,
          miniHudOpen: val.miniHudOpen,
        }),
      );
    } catch {
      /* ignore storage error */
    }
  },
  { deep: true },
);

/** 是否启用前置条件沙盒绕过（上帝视角） */
export function isDebugBypassPrerequisitesActive(): boolean {
  return Boolean(debugState.enabled && debugState.bypassPrerequisites);
}

/** 是否启用全阵营图鉴透视 */
export function isDebugUnlockAllFactionsActive(): boolean {
  return Boolean(debugState.enabled && debugState.unlockAllFactionsPreview);
}

/* ═══════════════ 快照备份与无损还原 ═══════════════ */

const memoryBackups = reactive<Record<string, { time: string; data: StatData }>>({});

function loadStoredBackups(): void {
  try {
    const raw = globalThis.localStorage?.getItem(DEBUG_BACKUP_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, { time: string; data: StatData }>;
    for (const [k, v] of Object.entries(parsed)) {
      if (v && v.data) memoryBackups[k] = v;
    }
  } catch {
    /* ignore */
  }
}
loadStoredBackups();

function persistBackups(): void {
  try {
    globalThis.localStorage?.setItem(DEBUG_BACKUP_STORAGE_KEY, JSON.stringify(memoryBackups));
  } catch {
    /* ignore */
  }
}

export function hasFloorDebugBackup(floorId: number | null): boolean {
  if (floorId === null) return false;
  return Boolean(memoryBackups[String(floorId)]);
}

export function getFloorDebugBackupMeta(floorId: number | null): { time: string } | null {
  if (floorId === null) return null;
  const entry = memoryBackups[String(floorId)];
  return entry ? { time: entry.time } : null;
}

export function saveFloorDebugBackup(floorId: number, snapshot: StatData): void {
  const cloned = JSON.parse(JSON.stringify(snapshot)) as StatData;
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  memoryBackups[String(floorId)] = { time: timeStr, data: cloned };
  persistBackups();
}

export function ensureFloorDebugBackup(floorId: number, snapshot: StatData): void {
  if (!hasFloorDebugBackup(floorId)) {
    saveFloorDebugBackup(floorId, snapshot);
  }
}

export function restoreFloorDebugBackup(floorId: number): StatData | null {
  const entry = memoryBackups[String(floorId)];
  if (!entry) return null;
  return Schema.parse(JSON.parse(JSON.stringify(entry.data)));
}

/* ═══════════════ 快捷状态注入纯函数 ═══════════════ */

export function cloneValidStatData(raw: unknown): StatData {
  return Schema.parse(JSON.parse(JSON.stringify(raw ?? {})));
}

/** 1. 资金调整 */
export function debugMutateCredits(data: StatData, mode: 'add10k' | 'add100k' | 'set50k' | 'reset2k'): StatData {
  const next = cloneValidStatData(data);
  if (mode === 'add10k') next.economy.credits += 10000;
  else if (mode === 'add100k') next.economy.credits += 100000;
  else if (mode === 'set50k') next.economy.credits = 50000;
  else if (mode === 'reset2k') next.economy.credits = 2000;
  return Schema.parse(next);
}

/** 2. 六大战略资源柱与协议产点一键灌满 */
export function debugFillAllResourcesAndPoints(data: StatData, amount = 5000): StatData {
  const next = cloneValidStatData(data);
  next.economy.resources = {
    nanites: {
      工业纳米机械: amount,
      军用纳米活性体: amount,
    },
    minerals: {
      铁矿石与金属精矿: amount,
      铜铝与战略有色金属: amount,
      稀土与高纯硅晶: amount,
    },
    materials: {
      军用钢材与结构件: amount,
      特种水泥与工程构材: amount,
      精细化工与高分子基材: amount,
    },
    fuel: {
      军用柴油与重油: amount,
      航空煤油与高能推进剂: amount,
      聚变氘氚与裂变核燃料: amount,
    },
    munitions: {
      常规动能弹药: amount,
      精确制导弹体与战斗部: amount,
      高能炸药与装药: amount,
    },
    logistics: {
      战备饮水与净化水: amount,
      军用口粮与生鲜补给: amount,
      战地医疗与防疫物资: amount,
    },
  };
  next.protocol_points = Math.max(next.protocol_points ?? 0, 500) + 500;
  return Schema.parse(next);
}

/** 3. 阵营权限启封 */
export function debugUnlockFactions(data: StatData, factions: readonly ('allied' | 'soviet' | 'yuri')[]): StatData {
  const next = cloneValidStatData(data);
  const unlocked = new Set(next.command.unlocked_factions ?? ['allied']);
  const granted = new Set(next.command.mcv_granted_factions ?? ['allied']);
  for (const f of factions) {
    unlocked.add(f);
    granted.add(f);
  }
  next.command.unlocked_factions = [...unlocked];
  next.command.mcv_granted_factions = [...granted];
  return Schema.parse(next);
}

export type DebugBuildingPresetId =
  | 'allied_conyard'
  | 'soviet_conyard'
  | 'allied_full_core'
  | 'soviet_full_core'
  | 'spawn_second_base_soviet';

const ALLIED_CORE_BUILDINGS = [
  '盟军建造厂',
  '盟军发电厂',
  '盟军发电厂',
  '矿石精炼厂',
  '盟军兵营',
  '个人装备制造所',
  '盟军战车工厂',
  '空军指挥部',
  '海军造船厂',
  '区域防空与预警雷达站',
  '战术科研实验室',
  '盟军战斗实验室',
];

const SOVIET_CORE_BUILDINGS = [
  '苏联建造厂',
  '苏联磁能反应炉',
  '苏联磁能反应炉',
  '矿石精炼厂',
  '苏联兵营',
  '个人装备制造所',
  '苏联战车工厂',
  '苏维埃工业工厂',
  '苏联空军指挥部',
  '苏联海军造船厂',
  '战术科研实验室',
  '苏联作战实验室',
  '红星实验设计局综合体',
];

function ensureBaseExists(next: StatData, activeBaseIndex: number) {
  if (!Array.isArray(next.bases) || next.bases.length === 0) {
    next.bases = [
      {
        id: '前沿第一基地',
        name: '前沿第一基地',
        location: '调试战区',
        status: '警戒',
        power: { gen: 200, use: 20 },
        buildings: [],
        alerts: [],
      },
    ];
  }
  return next.bases[activeBaseIndex] ?? next.bases[0];
}

function addBuildingsIdempotent(
  buildings: { name: string; layer: string; state: '运转' | '建造中' | '受损' | '停机' }[],
  names: readonly string[],
) {
  for (const name of names) {
    const existing = buildings.find(b => canon(b.name) === canon(name));
    if (existing) {
      existing.state = '运转';
    } else {
      buildings.push({ name, layer: '', state: '运转' });
    }
  }
}

/** 4. 基地核心建筑套餐一键铺设 */
export function debugApplyBuildingPreset(
  data: StatData,
  activeBaseIndex: number,
  preset: DebugBuildingPresetId,
): StatData {
  const next = cloneValidStatData(data);
  if (preset === 'spawn_second_base_soviet') {
    const unlockSet = new Set(next.command.unlocked_factions ?? ['allied']);
    unlockSet.add('soviet');
    next.command.unlocked_factions = [...unlockSet];
    const secondName = '北方红星分基地';
    let secondBase = next.bases.find(b => b.name === secondName || b.id === secondName);
    if (!secondBase) {
      secondBase = {
        id: secondName,
        name: secondName,
        location: '北极圈冻土前哨',
        status: '警戒',
        power: { gen: 1500, use: 360 },
        buildings: [],
        alerts: [],
      };
      next.bases.push(secondBase);
    }
    addBuildingsIdempotent(secondBase.buildings, SOVIET_CORE_BUILDINGS);
    secondBase.power = { gen: 1500, use: 360 };
    return Schema.parse(next);
  }

  const base = ensureBaseExists(next, activeBaseIndex);
  if (preset === 'allied_conyard') {
    addBuildingsIdempotent(base.buildings, ['盟军建造厂']);
    base.power.gen = Math.max(base.power.gen, 100);
  } else if (preset === 'soviet_conyard') {
    const unlockSet = new Set(next.command.unlocked_factions ?? ['allied']);
    unlockSet.add('soviet');
    next.command.unlocked_factions = [...unlockSet];
    addBuildingsIdempotent(base.buildings, ['苏联建造厂']);
    base.power.gen = Math.max(base.power.gen, 100);
  } else if (preset === 'allied_full_core') {
    addBuildingsIdempotent(base.buildings, ALLIED_CORE_BUILDINGS);
    base.power = { gen: Math.max(base.power.gen, 1200), use: Math.max(base.power.use, 320) };
  } else if (preset === 'soviet_full_core') {
    const unlockSet = new Set(next.command.unlocked_factions ?? ['allied']);
    unlockSet.add('soviet');
    next.command.unlocked_factions = [...unlockSet];
    addBuildingsIdempotent(base.buildings, SOVIET_CORE_BUILDINGS);
    base.power = { gen: Math.max(base.power.gen, 1500), use: Math.max(base.power.use, 400) };
  }
  return Schema.parse(next);
}

/** 5. 科技按代数一键解锁或清空 */
export function debugUnlockResearches(
  data: StatData,
  catalogResearches: readonly { name: string; tier?: number }[],
  mode: 1 | 2 | 3 | 'clear',
): StatData {
  const next = cloneValidStatData(data);
  if (mode === 'clear') {
    next.tech.done = ['化石燃料发电学'];
    return Schema.parse(next);
  }
  const doneSet = new Set<string>(next.tech.done ?? []);
  const canonSet = new Set<string>([...doneSet].map(n => canon(n)));
  for (const r of catalogResearches) {
    const tier = typeof r.tier === 'number' ? r.tier : 1;
    if (tier <= mode && r.name) {
      const c = canon(r.name);
      if (!canonSet.has(c)) {
        canonSet.add(c);
        doneSet.add(r.name);
      }
    }
  }
  next.tech.done = [...doneSet];
  return Schema.parse(next);
}

/** 6. 代表性三军测试部队一键注入（验证 unit_present 等条件分析器） */
export function debugInjectTestForces(data: StatData): StatData {
  const next = cloneValidStatData(data);
  next.forces.troops = {
    ...next.forces.troops,
    美国大兵: Math.max(next.forces.troops?.['美国大兵'] ?? 0, 6),
    战斗工程师: Math.max(next.forces.troops?.['战斗工程师'] ?? 0, 2),
    重装大兵: Math.max(next.forces.troops?.['重装大兵'] ?? 0, 4),
    磁暴步兵: Math.max(next.forces.troops?.['磁暴步兵'] ?? 0, 2),
  };
  const vehSet = new Set(next.forces.vehicles ?? []);
  for (const v of [
    'F-16C战隼多用途战斗机',
    'M1A2艾布拉姆斯主战坦克',
    'LCS-1自由级近海战斗舰',
    '天启坦克',
    '基洛夫空艇',
  ]) {
    vehSet.add(v);
  }
  next.forces.vehicles = [...vehSet];
  return Schema.parse(next);
}

/** 7. 队列一键全部完工入账 / 清空队列 */
export function debugSettleOrClearQueues(data: StatData, action: 'complete_all' | 'clear_done' | 'clear_all'): StatData {
  const next = cloneValidStatData(data);
  if (action === 'clear_all') {
    next.queues = [];
    return Schema.parse(next);
  }
  if (action === 'clear_done') {
    next.queues = next.queues.filter(q => q.status !== 'done' && q.status !== 'cancelled');
    return Schema.parse(next);
  }
  const activeBase = next.bases[0];
  for (const q of next.queues) {
    if (q.status === 'done' || q.status === 'cancelled') continue;
    q.status = 'done';
    q.progress = 100;
    q.qty_done = q.qty ?? 1;
    if (q.total_minutes > 0) q.spent_minutes = q.total_minutes;
    if (q.type === '研究') {
      if (!next.tech.done.some(d => canon(d) === canon(q.item))) {
        next.tech.done.push(q.item);
      }
    } else if (q.type === '建造') {
      const targetBase =
        next.bases.find(b => canon(b.id) === canon(q.base) || canon(b.name) === canon(q.base)) ?? activeBase;
      if (targetBase) {
        const existing = targetBase.buildings.find(b => canon(b.name) === canon(q.item));
        if (existing) existing.state = '运转';
        else targetBase.buildings.push({ name: q.item, layer: '', state: '运转' });
      }
    } else if (q.type === '生产') {
      const cur = next.forces.troops[q.item] ?? 0;
      next.forces.troops[q.item] = cur + (q.qty ?? 1);
    }
  }
  return Schema.parse(next);
}
