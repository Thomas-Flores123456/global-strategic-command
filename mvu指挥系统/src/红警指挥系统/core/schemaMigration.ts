/**
 * 协议五态单向状态机、存量协议静态索引表与 V1→V2 / 存量协议无损迁移（自 core/schema.ts 抽离）
 */

export const PROTOCOL_SCHEMA_VERSION = 1 as const;

export const ProtocolStatus = z.enum([
  'undiscovered', // 机密未启封（仅配置了 discovery 且尚未被事件或实验室在场启封的协议）
  'locked', // 已立卷但准入未齐（同轨前序未 active / 阵营对口实验室 Tier 未达标 / requirements 未齐）
  'available', // 待立项实验（准入全通，attempts = 0, exp = 0%）
  'experimenting', // 实验攻关中（attempts >= 1, 0 < exp < 100%；实验室离线时数据 100% 封存保留）
  'active', // 实验突破，已定型颁布（exp = 100%，终态永久生效，永不因建筑损毁回退）
  'voided', // 互斥封存终态（预留供 exclusive_with 使用，MVP 18 条不使用）
]);
export type ProtocolStatus = z.output<typeof ProtocolStatus>;
export type ProtocolStatusType = z.infer<typeof ProtocolStatus>;

export const ProtocolLastResult = z.object({
  day: z.number(), // 发生该结果的游戏日 (meta.day_count)
  outcome: z.enum(['breakthrough', 'accumulated', 'discovered']), // 突破定型 | 阶段经验积累 | 实验室自动启封
  attempt: z.number().int().min(0).default(0), // 本次为第几轮实验
  exp_before: z.number().min(0).max(100).default(0), // 实验前经验 %
  exp_after: z.number().min(0).max(100).default(0), // 实验后经验 %
  next_prob: z.number().min(0).max(100).default(0), // 下次实验突破率 %
});
export type ProtocolLastResult = z.output<typeof ProtocolLastResult>;
export type ProtocolLastResultType = z.infer<typeof ProtocolLastResult>;

export const ProtocolInstance = z.object({
  ref: z.string(), // 协议权威 ID (如 sov.protocol.ra3.*)
  status: ProtocolStatus.default('locked'), // 五态状态机
  attempts: z.number().int().min(0).default(0), // 已开展实验轮次 k
  exp: z.number().min(0).max(100).default(0), // 累计定型经验 (0 ~ 100%)
  points_spent: z.number().min(0).default(0), // 累计已投入协议点
  credits_spent: z.number().min(0).default(0), // 累计已投入实验资金
  auto_queued: z.boolean().default(false), // D-P27：是否加入 UTO 自动实验排程
  queue_order: z.number().int().optional(), // D-P27：自动排程候列优先级序号
  hold: z.boolean().default(false), // D-P27：工务暂缓标记（对齐 UTO Hold/Resume）
  discovered_via: z.enum(['init', 'experiment', 'event']).optional(),
  updated_at_day: z.number().default(0), // 最后状态/实验跃迁游戏日
  last_result: ProtocolLastResult.optional(), // D-P28：最近一次实验/启封回执（供提示词注入）
  schema_version: z.literal(PROTOCOL_SCHEMA_VERSION).default(PROTOCOL_SCHEMA_VERSION),
});
export type ProtocolInstance = z.output<typeof ProtocolInstance>;
export type ProtocolInstanceType = z.infer<typeof ProtocolInstance>;

export interface LegacyProtocolDefinition {
  readonly id: string;
  readonly name: string;
  readonly faction: '苏联' | '盟军';
  readonly tier: 1 | 2 | 3;
  readonly aliases: readonly string[];
}

/**
 * 18 条存量协议权威名↔ID 静态索引表（D-P18b/18c）：
 * - 《特色科技·苏联_世界书.json》16 条（12 条 RA3 uid 112~123 ＋ 铁幕紧急过载 uid 43/44 ＋
 *   核演习隔离与通报规程 uid 71/72 ＋ 核指挥接替与态势重建规程 uid 85/86 ＋ 常规战略打击授权隔离 uid 105/106）
 * - 《特色科技·盟军_世界书.json》2 条（UID 21《欧洲联合防务协议》＋ UID 22《环太平洋防务合作协议》）
 */
export const LEGACY_PROTOCOL_DEFINITIONS: readonly LegacyProtocolDefinition[] = Object.freeze([
  {
    id: 'sov.research.t2.iron_curtain_emergency_overload',
    name: '铁幕紧急过载协议',
    faction: '苏联',
    tier: 2,
    aliases: ['44·铁幕紧急过载协议'],
  },
  {
    id: 'sov.research.t2.nuclear_exercise_isolation_notification',
    name: '核演习隔离与通报规程',
    faction: '苏联',
    tier: 2,
    aliases: ['72·核演习隔离与通报规程'],
  },
  {
    id: 'sov.research.t3.nuclear_command_succession_rebuild',
    name: '核指挥接替与态势重建规程',
    faction: '苏联',
    tier: 3,
    aliases: ['86·核指挥接替与态势重建规程'],
  },
  {
    id: 'sov.research.t3.conventional_strategic_authorization_isolation',
    name: '常规战略打击授权隔离协议',
    faction: '苏联',
    tier: 2,
    aliases: ['106·常规战略打击授权隔离协议'],
  },
  {
    id: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
    name: '战斗工兵—预制战斗碉堡协议',
    faction: '苏联',
    tier: 1,
    aliases: [
      '113·战斗工兵—预制战斗碉堡协议',
      '战斗工兵-预制战斗碉堡协议',
      '战斗工兵--预制战斗碉堡协议',
      '战斗工兵－预制战斗碉堡协议',
    ],
  },
  {
    id: 'sov.protocol.ra3.sputnik_one_way_deployment',
    name: 'Sputnik一次展开前沿节点协议',
    faction: '苏联',
    tier: 1,
    aliases: ['114·Sputnik一次展开前沿节点协议', 'Sputnik 一次展开前沿节点协议'],
  },
  {
    id: 'sov.protocol.ra3.crusher_crane_salvage',
    name: 'Crusher Crane维修—拆件—报废协议',
    faction: '苏联',
    tier: 1,
    aliases: [
      '115·Crusher Crane维修—拆件—报废协议',
      'Crusher Crane维修-拆件-报废协议',
      'Crusher Crane 维修—拆件—报废协议',
      'Crusher Crane 维修-拆件-报废协议',
    ],
  },
  {
    id: 'sov.protocol.ra3.terror_drone_dual_mode',
    name: '恐怖机器人拆解／短时电磁锁止双任务包协议',
    faction: '苏联',
    tier: 1,
    aliases: [
      '116·恐怖机器人拆解／短时电磁锁止双任务包协议',
      '恐怖机器人双任务包协议',
      '恐怖机器人拆解/短时电磁锁止双任务包协议',
    ],
  },
  {
    id: 'sov.protocol.ra3.tesla_mobile_parallel_charge',
    name: '磁暴步兵移动储能并联充能协议',
    faction: '苏联',
    tier: 1,
    aliases: ['117·磁暴步兵移动储能并联充能协议'],
  },
  {
    id: 'sov.protocol.ra3.urban_molotov_magnetic_mine',
    name: '动员兵燃烧瓶／防空兵附着式反机动雷协议',
    faction: '苏联',
    tier: 1,
    aliases: ['118·动员兵燃烧瓶／防空兵附着式反机动雷协议', '动员兵燃烧瓶/防空兵附着式反机动雷协议'],
  },
  {
    id: 'sov.protocol.ra3.motorized_mortar_reserve',
    name: '摩托化迫击炮后备分队协议',
    faction: '苏联',
    tier: 1,
    aliases: ['119·摩托化迫击炮后备分队协议'],
  },
  {
    id: 'sov.protocol.ra3.v4_precision_payload_package',
    name: 'V3体系V4精确弹／多载荷任务包协议',
    faction: '苏联',
    tier: 2,
    aliases: ['120·V3体系V4精确弹／多载荷任务包协议', 'V3体系V4精确弹/多载荷任务包协议'],
  },
  {
    id: 'sov.protocol.ra3.kirov_dreadnought_overlimit',
    name: '基洛夫—无畏越限运行协议',
    faction: '苏联',
    tier: 2,
    aliases: [
      '121·基洛夫—无畏越限运行协议',
      '基洛夫-无畏越限运行协议',
      '基洛夫--无畏越限运行协议',
      '基洛夫－无畏越限运行协议',
    ],
  },
  {
    id: 'sov.protocol.ra3.anchored_magnetic_lock',
    name: '地锚式磁锁／局部奇点压制区协议',
    faction: '苏联',
    tier: 2,
    aliases: ['122·地锚式磁锁／局部奇点压制区协议', '地锚式磁锁/局部奇点压制区协议'],
  },
  {
    id: 'sov.protocol.ra3.mass_production_fold_in',
    name: 'Mass Production工业调度折叠协议',
    faction: '苏联',
    tier: 2,
    aliases: ['123·Mass Production工业调度折叠协议', 'Mass Production 工业调度折叠协议'],
  },
  {
    id: 'sov.protocol.ra3.hammer_inventory_reentry',
    name: '受库存与授权约束的轨道常规载荷再入协议',
    faction: '苏联',
    tier: 2,
    aliases: ['124·受库存与授权约束的轨道常规载荷再入协议'],
  },
  {
    id: 'all.research.t1.european_defense_agreement',
    name: '欧洲联合防务协议',
    faction: '盟军',
    tier: 2,
    aliases: [
      '154·欧洲联合防务协议',
      '欧盟防务协议',
      'all.research.european_defense_pact',
      'all.research.european_defense_agreement',
      'all.protocol.european_defense_pact',
      'all.protocol.european_defense_agreement',
    ],
  },
  {
    id: 'all.research.t1.pacific_rim_defense_agreement',
    name: '环太平洋防务合作协议',
    faction: '盟军',
    tier: 2,
    aliases: [
      '155·环太平洋防务合作协议',
      '日韩防务协议',
      'all.research.pacific_rim_defense_pact',
      'all.research.pacific_rim_defense_agreement',
      'all.protocol.pacific_rim_defense_pact',
      'all.protocol.pacific_rim_defense_agreement',
    ],
  },
]);

function normalizeProtocolIdentifierKey(raw: string): string {
  return raw
    .trim()
    .replace(/^[《「【]+|[》」】]+$/g, '')
    .replace(/^\d+\s*[·.、]\s*/, '')
    .replace(/[／⁄]/g, '/')
    .replace(/[—－–―]+|--+/g, '-')
    .replace(/\s+/g, '')
    .toLowerCase();
}

const protocolNameToIdRecord: Record<string, string> = {};
const protocolIdToNameRecord: Record<string, string> = {};
const normalizedProtocolLookup = new Map<string, LegacyProtocolDefinition>();

for (const def of LEGACY_PROTOCOL_DEFINITIONS) {
  protocolNameToIdRecord[def.name] = def.id;
  protocolIdToNameRecord[def.id] = def.name;
  normalizedProtocolLookup.set(normalizeProtocolIdentifierKey(def.id), def);
  normalizedProtocolLookup.set(normalizeProtocolIdentifierKey(def.name), def);
  for (const alias of def.aliases) {
    normalizedProtocolLookup.set(normalizeProtocolIdentifierKey(alias), def);
    if (alias.includes('.')) {
      Object.defineProperty(protocolIdToNameRecord, alias, {
        value: def.name,
        enumerable: false,
        configurable: false,
        writable: false,
      });
    } else {
      Object.defineProperty(protocolNameToIdRecord, alias, {
        value: def.id,
        enumerable: false,
        configurable: false,
        writable: false,
      });
    }
  }
}

/** 18 条存量协议权威中文名 → 权威 ID 映射表（Object.keys 恒为 18 条，常见别名挂非枚举属性） */
export const LEGACY_PROTOCOL_NAME_TO_ID: Readonly<Record<string, string>> = Object.freeze(protocolNameToIdRecord);

/** 18 条存量协议权威 ID → 权威中文名映射表（Object.keys 恒为 18 条，简写 ID 别名挂非枚举属性） */
export const LEGACY_PROTOCOL_ID_TO_NAME: Readonly<Record<string, string>> = Object.freeze(protocolIdToNameRecord);

/** 将任意协议名称/ID/别名解析为权威协议 ID；非 18 条存量协议返回 undefined */
export function resolveLegacyProtocolId(identifier: unknown): string | undefined {
  if (typeof identifier !== 'string' || identifier.trim() === '') return undefined;
  return normalizedProtocolLookup.get(normalizeProtocolIdentifierKey(identifier))?.id;
}

/** 将任意协议名称/ID/别名解析为权威协议中文名；非 18 条存量协议返回 undefined */
export function resolveLegacyProtocolName(identifier: unknown): string | undefined {
  if (typeof identifier !== 'string' || identifier.trim() === '') return undefined;
  return normalizedProtocolLookup.get(normalizeProtocolIdentifierKey(identifier))?.name;
}

/** 判断给定标识符是否属于 18 条存量协议（支持中文名、权威 ID、常见破折号/斜杠/书名号及别名） */
export function isLegacyProtocolIdentifier(identifier: unknown): boolean {
  return resolveLegacyProtocolId(identifier) !== undefined;
}

const PROTOCOL_STATUS_RANK: Record<ProtocolStatusType, number> = {
  undiscovered: 0,
  locked: 1,
  available: 2,
  experimenting: 3,
  active: 4,
  voided: 5,
};

interface MigratedProtocolSeed {
  ref: string;
  status: ProtocolStatusType;
  attempts: number;
  exp: number;
  auto_queued: boolean;
  hold: boolean;
  discovered_via: 'init' | 'experiment' | 'event';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function mergeProtocolSeed(
  existing: Record<string, unknown> | undefined,
  seed: MigratedProtocolSeed,
  defaultDay: number,
): ProtocolInstanceType {
  const existingStatusRaw = typeof existing?.status === 'string' ? existing.status : undefined;
  const existingStatus: ProtocolStatusType =
    existingStatusRaw && existingStatusRaw in PROTOCOL_STATUS_RANK
      ? (existingStatusRaw as ProtocolStatusType)
      : 'locked';

  const status: ProtocolStatusType =
    existing === undefined
      ? seed.status
      : PROTOCOL_STATUS_RANK[existingStatus] >= PROTOCOL_STATUS_RANK[seed.status]
        ? existingStatus
        : seed.status;

  const existingExp = finiteNumber(existing?.exp) ?? 0;
  const existingAttempts = Math.max(0, Math.trunc(finiteNumber(existing?.attempts) ?? 0));
  const exp =
    status === 'active'
      ? 100
      : status === 'experimenting'
        ? Math.min(99, Math.max(1, Math.round(Math.max(existingExp, seed.exp))))
        : 0;
  const attempts =
    status === 'experimenting'
      ? Math.max(1, existingAttempts, seed.attempts)
      : Math.max(0, existingAttempts, seed.attempts);

  const isTerminal = status === 'active' || status === 'voided';
  const autoQueued = isTerminal
    ? false
    : Boolean((typeof existing?.auto_queued === 'boolean' ? existing.auto_queued : false) || seed.auto_queued);
  const hold = isTerminal ? false : Boolean(typeof existing?.hold === 'boolean' ? existing.hold : seed.hold);

  const discoveredViaRaw = existing?.discovered_via;
  const discoveredVia: 'init' | 'experiment' | 'event' =
    discoveredViaRaw === 'init' || discoveredViaRaw === 'experiment' || discoveredViaRaw === 'event'
      ? discoveredViaRaw
      : seed.discovered_via;

  const merged: ProtocolInstanceType = {
    ref: seed.ref,
    status,
    attempts,
    exp,
    points_spent: Math.max(0, finiteNumber(existing?.points_spent) ?? 0),
    credits_spent: Math.max(0, finiteNumber(existing?.credits_spent) ?? 0),
    auto_queued: autoQueued,
    hold,
    discovered_via: discoveredVia,
    updated_at_day: finiteNumber(existing?.updated_at_day) ?? defaultDay,
    schema_version: PROTOCOL_SCHEMA_VERSION,
  };

  const queueOrder = finiteNumber(existing?.queue_order);
  if (queueOrder !== undefined && Number.isInteger(queueOrder)) {
    merged.queue_order = queueOrder;
  }
  if (isRecord(existing?.last_result)) {
    const parsedLast = ProtocolLastResult.safeParse(existing.last_result);
    if (parsedLast.success) {
      merged.last_result = parsedLast.data;
    }
  }
  return merged;
}

function buildCarryoverSeedFromQueueLike(ref: string, itemRecord: Record<string, unknown>): MigratedProtocolSeed {
  const statusRaw = typeof itemRecord.status === 'string' ? itemRecord.status : 'active';
  const progressRaw = finiteNumber(itemRecord.progress);
  const spentMin = finiteNumber(itemRecord.spent_minutes);
  const totalMin = finiteNumber(itemRecord.total_minutes);

  if (statusRaw === 'done' || (progressRaw !== undefined && progressRaw >= 100)) {
    return {
      ref,
      status: 'active',
      attempts: 0,
      exp: 100,
      auto_queued: false,
      hold: false,
      discovered_via: 'init',
    };
  }

  if (statusRaw === 'cancelled') {
    return {
      ref,
      status: 'available',
      attempts: 0,
      exp: 0,
      auto_queued: false,
      hold: false,
      discovered_via: 'init',
    };
  }

  let carriedExp = 0;
  if (progressRaw !== undefined && progressRaw > 0) {
    carriedExp = Math.min(95, Math.max(1, Math.round(progressRaw)));
  } else if (spentMin !== undefined && spentMin > 0 && totalMin !== undefined && totalMin > 0) {
    carriedExp = Math.min(95, Math.max(1, Math.round((spentMin / totalMin) * 100)));
  }

  const hold = typeof itemRecord.hold === 'boolean' ? itemRecord.hold : false;
  if (carriedExp > 0) {
    return {
      ref,
      status: 'experimenting',
      attempts: 1,
      exp: carriedExp,
      auto_queued: true,
      hold,
      discovered_via: 'init',
    };
  }
  return {
    ref,
    status: 'available',
    attempts: 0,
    exp: 0,
    auto_queued: true,
    hold,
    discovered_via: 'init',
  };
}

/**
 * 旧档存量协议无损迁移纯函数（PRT-SCHEMA-01 · 任务包 §3.2 / D-P18b/18c）：
 * 1. 扫描 `tech.done`：命中 18 条存量协议（中文名/ID/别名）时迁入 `protocols[]` 置 `status: 'active', exp: 100, discovered_via: 'init'`，
 *    并自 `tech.done` 移除该协议名（非协议科技 100% 原样保留）；
 * 2. 扫描 `queues[]`（`type === '研究'`）与 `tech.current`：命中 18 条协议时按进度结转为 `experimenting`（0 < exp < 100, attempts>=1, auto_queued=true）
 *    或 `available`（exp=0, auto_queued=true），并从原研究队列中移除，防旧在研协议丢失；
 * 3. 若输入不含任何需迁移的存量协议，原样返回同一对象引用（`===`，零注入、零拷贝），重复调用 100% 幂等。
 */
export function migrateLegacyProtocolsInState<T = unknown>(input: T): T {
  if (!isRecord(input)) return input;

  const techRecord = isRecord(input.tech) ? input.tech : undefined;
  const rawDone = Array.isArray(techRecord?.done) ? techRecord.done : undefined;
  const rawCurrent = techRecord?.current;
  const rawQueues = Array.isArray(input.queues) ? input.queues : undefined;

  const hasDoneProtocol = rawDone !== undefined && rawDone.some(item => isLegacyProtocolIdentifier(item));
  const hasCurrentProtocol =
    typeof rawCurrent === 'string'
      ? isLegacyProtocolIdentifier(rawCurrent)
      : Array.isArray(rawCurrent)
        ? rawCurrent.some(item =>
            typeof item === 'string'
              ? isLegacyProtocolIdentifier(item)
              : isRecord(item) && isLegacyProtocolIdentifier(item.item ?? item.name),
          )
        : isRecord(rawCurrent) && isLegacyProtocolIdentifier(rawCurrent.item ?? rawCurrent.name);
  const hasQueueProtocol =
    rawQueues !== undefined &&
    rawQueues.some(q => isRecord(q) && q.type === '研究' && isLegacyProtocolIdentifier(q.item));

  if (!hasDoneProtocol && !hasCurrentProtocol && !hasQueueProtocol) {
    return input;
  }

  const defaultDay = isRecord(input.meta) ? (finiteNumber(input.meta.day_count) ?? 0) : 0;
  const seeds = new Map<string, MigratedProtocolSeed>();

  const upsertSeed = (nextSeed: MigratedProtocolSeed) => {
    const prev = seeds.get(nextSeed.ref);
    if (!prev) {
      seeds.set(nextSeed.ref, nextSeed);
      return;
    }
    const merged = mergeProtocolSeed(prev as unknown as Record<string, unknown>, nextSeed, defaultDay);
    seeds.set(nextSeed.ref, {
      ref: merged.ref,
      status: merged.status,
      attempts: merged.attempts,
      exp: merged.exp,
      auto_queued: merged.auto_queued,
      hold: merged.hold,
      discovered_via: merged.discovered_via ?? 'init',
    });
  };

  let nextDone: unknown[] | undefined;
  if (rawDone !== undefined) {
    nextDone = [];
    for (const item of rawDone) {
      const protoId = resolveLegacyProtocolId(item);
      if (protoId !== undefined) {
        upsertSeed({
          ref: protoId,
          status: 'active',
          attempts: 0,
          exp: 100,
          auto_queued: false,
          hold: false,
          discovered_via: 'init',
        });
      } else {
        nextDone.push(item);
      }
    }
  }

  let nextCurrent: unknown = rawCurrent;
  let shouldDeleteCurrent = false;
  if (hasCurrentProtocol) {
    if (typeof rawCurrent === 'string') {
      const protoId = resolveLegacyProtocolId(rawCurrent);
      if (protoId !== undefined) {
        upsertSeed(buildCarryoverSeedFromQueueLike(protoId, { item: rawCurrent }));
        shouldDeleteCurrent = true;
      }
    } else if (Array.isArray(rawCurrent)) {
      const keptCurrent: unknown[] = [];
      for (const entry of rawCurrent) {
        if (typeof entry === 'string') {
          const protoId = resolveLegacyProtocolId(entry);
          if (protoId !== undefined) {
            upsertSeed(buildCarryoverSeedFromQueueLike(protoId, { item: entry }));
            continue;
          }
        } else if (isRecord(entry)) {
          const protoId = resolveLegacyProtocolId(entry.item ?? entry.name);
          if (protoId !== undefined) {
            upsertSeed(buildCarryoverSeedFromQueueLike(protoId, entry));
            continue;
          }
        }
        keptCurrent.push(entry);
      }
      nextCurrent = keptCurrent;
    } else if (isRecord(rawCurrent)) {
      const protoId = resolveLegacyProtocolId(rawCurrent.item ?? rawCurrent.name);
      if (protoId !== undefined) {
        upsertSeed(buildCarryoverSeedFromQueueLike(protoId, rawCurrent));
        shouldDeleteCurrent = true;
      }
    }
  }

  let nextQueues: unknown[] | undefined;
  if (rawQueues !== undefined && hasQueueProtocol) {
    nextQueues = [];
    for (const q of rawQueues) {
      if (isRecord(q) && q.type === '研究') {
        const protoId = resolveLegacyProtocolId(q.item);
        if (protoId !== undefined) {
          upsertSeed(buildCarryoverSeedFromQueueLike(protoId, q));
          continue;
        }
      }
      nextQueues.push(q);
    }
  }

  const existingProtocolsRaw = Array.isArray(input.protocols) ? input.protocols : [];
  const nextProtocols: unknown[] = [];
  const handledRefs = new Set<string>();

  for (const item of existingProtocolsRaw) {
    if (!isRecord(item) || typeof item.ref !== 'string') {
      nextProtocols.push(item);
      continue;
    }
    const canonicalRef = resolveLegacyProtocolId(item.ref) ?? item.ref;
    const seed = seeds.get(canonicalRef);
    if (seed) {
      nextProtocols.push(mergeProtocolSeed(item, seed, defaultDay));
      handledRefs.add(canonicalRef);
    } else {
      nextProtocols.push(canonicalRef !== item.ref ? { ...item, ref: canonicalRef } : item);
    }
  }

  for (const [ref, seed] of seeds.entries()) {
    if (!handledRefs.has(ref)) {
      nextProtocols.push(mergeProtocolSeed(undefined, seed, defaultDay));
    }
  }

  const nextState: Record<string, unknown> = {
    ...input,
    protocols: nextProtocols,
  };

  if (techRecord !== undefined && (hasDoneProtocol || hasCurrentProtocol)) {
    const nextTech: Record<string, unknown> = { ...techRecord };
    if (nextDone !== undefined) {
      nextTech.done = nextDone;
    }
    if (hasCurrentProtocol) {
      if (shouldDeleteCurrent) {
        delete nextTech.current;
      } else {
        nextTech.current = nextCurrent;
      }
    }
    nextState.tech = nextTech;
  }

  if (nextQueues !== undefined) {
    nextState.queues = nextQueues;
  }

  return nextState as T;
}

export const SCHEMA_VERSION = 2 as const;

/** v1 钱袋固定字段 → v2 中文货币 record；不修改输入对象。 */
function migrateV1Wallet(value: unknown): Record<string, number> {
  const source = isRecord(value) ? value : {};
  const wallet: Record<string, number> = {};
  wallet['铜钱'] = finiteNumber(source['铜钱']) ?? finiteNumber(source.copper) ?? 0;
  wallet['银两'] = finiteNumber(source['银两']) ?? finiteNumber(source.silver) ?? 0;
  const stones = isRecord(source.spirit_stone) ? source.spirit_stone : {};
  wallet['下品灵石'] = finiteNumber(source['下品灵石']) ?? finiteNumber(stones.low) ?? 0;
  wallet['中品灵石'] = finiteNumber(source['中品灵石']) ?? finiteNumber(stones.mid) ?? 0;
  wallet['上品灵石'] = finiteNumber(source['上品灵石']) ?? finiteNumber(stones.high) ?? 0;
  return wallet;
}

/**
 * 唯一 v1→v2 迁移入口。旧档必属修真世界；空对象保留为 v2 归零态。
 * v2 与未来版本原样交给 Schema 校验，因此非法/未来版本不会被静默降级。
 */
export function migrateV1toV2(input: unknown): unknown {
  if (!isRecord(input) || Object.keys(input).length === 0) return input;
  if (input.schema_version === SCHEMA_VERSION) {
    return migrateLegacyProtocolsInState(input);
  }
  if (input.schema_version !== undefined && input.schema_version !== 1) return input;

  const meta =
    input.meta === undefined
      ? { world_id: 'xiuzhen' }
      : isRecord(input.meta)
        ? { ...input.meta, world_id: 'xiuzhen' }
        : input.meta;
  const economy =
    input.economy === undefined
      ? { wallet: migrateV1Wallet(undefined) }
      : isRecord(input.economy)
        ? {
            ...input.economy,
            wallet:
              input.economy.wallet === undefined || isRecord(input.economy.wallet)
                ? migrateV1Wallet(input.economy.wallet)
                : input.economy.wallet,
          }
        : input.economy;
  return migrateLegacyProtocolsInState({ ...input, schema_version: SCHEMA_VERSION, meta, economy });
}
