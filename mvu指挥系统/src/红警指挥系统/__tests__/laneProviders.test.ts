/**
 * laneProviders.test.ts —— UTO-PROV-01 验收测试
 *
 * 真源：docs/project/plans/通用任务编排器MVP任务包.md §3.2 / §6（任务卡 UTO-PROV-01）
 * 覆盖：
 * ① 黄金对照单测：构造涵盖建造、生产、改装、研究、工程（V1 eng.main 与 V2 eng.orbital）的
 *    多基地测试状态与有效目录，逐项对比 LaneRegistryHub 输出与 settleFloor.ts L521-575
 *    直接调用 productionLanes / researchSlots / engineeringSlots 原函数的 laneKey、parallelLimit、
 *    globalLimit、accelEff 及 warnSink 结构化告警，断言 100% 逐字节相等；
 * ② 九大产线双模切换单测：验证生产模式建筑数＝capacity、加速模式建筑提供递减加速比
 *    （accelMultiplier 最高 2.50x）、accel_scope（global vs base）隔离、全切加速模式时
 *    capacity=0, locked=true 及非双模产线（工坊/综合线）免疫；
 * ③ 11 科研序列与 techTier 单测：验证锚定建筑开通门及 T1=2 / T2=4 / T3=∞ 全局并行上限；
 * ④ 工程槽属地容量（eng.main / eng.orbital）与 E2b 通道B 展开车能力面跨三域隔离单测；
 * ⑤ ProtocolLaneProvider 预留挂载、自定义 Provider 扩展与入参深冻结（Object.freeze）零突变、
 *    纯函数红线（零 Pinia/Vue/宿主 API/DOM）审查。
 */

import { describe, expect, it } from 'vitest';
import type { EffectiveCatalog } from '../core/catalogEffective';
import {
  ENGINEERING_SLOT_REGISTRY,
  engSlotCapacityInBase,
  makeEngLaneKeyFor,
  makeEngParallelLimitFor,
} from '../engines/engineeringSlots';
import * as laneProviderExports from '../engines/laneProviders';
import {
  createLaneRegistryHub,
  EngineeringLaneProvider,
  LaneRegistryHub,
  ProductionLaneProvider,
  PROTOCOL_LANE_DISPLAY_NAME,
  PROTOCOL_LANE_KEY,
  ProtocolLaneProvider,
  ResearchLaneProvider,
} from '../engines/laneProviders';
import {
  ACCEL_COEFFICIENT_CAP,
  deployIndexFromCatalog,
  LANE_REGISTRY,
  laneCapacityInBase,
  makeAccelEffFor,
  makeProdLaneKeyFor,
  makeProdParallelLimitFor,
  prodLaneIndexFromCatalog,
  type LaneStateView,
} from '../engines/productionLanes';
import {
  lineIndexFromCatalog,
  makeGlobalLimitFor,
  makeLaneKeyFor,
  makeParallelLimitFor,
  MECHA_RESEARCH_NAMES,
  SLOT_REGISTRY,
} from '../engines/researchSlots';
import { SCHEDULE_COPY } from '../planning/scheduleCopy';
import type { ILaneProvider, LaneResolveEnv, LaneStationView } from '../engines/taskOrchestrator';
import type { TransactionItem } from '../engines/transactionEngine';

/* ═══════════════ 测试工具 ═══════════════ */

/** 递归深冻结（用于入参零突变硬核断言） */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** 构造标准测试环境快照（支持建筑可选 accel_scope，结构完全兼容 LaneResolveEnv） */
function makeEnv(input: {
  bases: ReadonlyArray<{
    id?: string;
    name?: string;
    status?: string;
    buildings?: ReadonlyArray<{ name: string; state?: string; mode?: string; accel_scope?: string }>;
  }>;
  queues?: ReadonlyArray<TransactionItem>;
  catalog: EffectiveCatalog;
}): LaneResolveEnv {
  return input;
}

/** 构造标准 v2 事务（支持可选 lane 字段） */
function makeTxn(overrides: Partial<TransactionItem> & { lane?: string } = {}): TransactionItem & { lane?: string } {
  return {
    type: '生产',
    item: '犀牛主战坦克',
    base: '1号基地',
    progress: 0,
    eta: '',
    status: 'queued',
    started_at: '',
    total_minutes: 1440,
    spent_minutes: 0,
    qty: 1,
    qty_done: 0,
    cost_paid: true,
    min_days_lock: 0,
    hold: false,
    ...overrides,
  };
}

/** 构造覆盖全品类（科研 11 槽 + 建筑/生产/改装显式产线 + E2b deploy 能力面）的测试有效目录 */
function makeGoldenCatalog(): EffectiveCatalog {
  return {
    researches: [
      { name: '模块化主基地架构', line: '主建筑' },
      { name: '高效矿石精炼法', line: '工业基础' },
      { name: '主动点防御矩阵', line: '防御辅助' },
      { name: '复合反应装甲工学', line: '陆地载具' },
      { name: '超音速矢量推进', line: '空中载具' },
      { name: '核动力舰体结构', line: '水面舰艇' },
      { name: '单兵战术数据链', line: '人员' },
      { name: '外骨骼伺服关节', line: '装备' },
      { name: '高密度气雾水培学', line: '农畜业' },
      { name: '工业尾气闭环回收', line: '环保与公共设施' },
      { name: '低轨重型入轨工学', line: '航天工业' },
      { name: '超时空相控阵学说', line: '盟军特色' },
      { name: '高压磁暴谐振学说', line: '苏联特色' },
      { name: '未知领域神秘课题', line: '未登记奇异分类' },
    ],
    buildings: [
      { name: '盟军建造厂' },
      { name: '爱国者防空导弹' },
      { name: '矿石精炼厂' },
      { name: '特种雷达塔', lane: 'lane.defense' },
      { name: '非法产线建筑', lane: 'lane.non_existent' },
      {
        name: '前沿工程展开车部署点',
        deploy: { into: '前沿工程展开站', capabilities: ['build.whitelist', 'engineer'] },
      },
    ],
    productions: [
      { name: '犀牛主战坦克' },
      { name: '动员步兵班' },
      { name: '米格战机' },
      { name: '无畏级战列舰' },
      { name: '重型单兵外骨骼' },
      { name: '特种攻城重炮', lane: 'lane.vehicle_land' },
      { name: '非法产线产物', lane: 'lane.bad_catalog' },
      { name: '日常补给口粮箱' }, // 不命中关键词 → lane.default
      {
        name: '机动战车组装模块车',
        deploy: { into: '展开式野战车场', capabilities: ['produce.vehicle'] },
      },
      {
        name: '机动战地科研方舱车',
        deploy: { into: '展开式科研方舱', capabilities: ['research'] },
      },
    ],
    retrofits: [{ name: '灰熊坦克火控升级包' }, { name: '基洛夫空艇挂架改装', lane: 'lane.vehicle_air' }],
    projects: [],
    factionDefs: [],
  } as unknown as EffectiveCatalog;
}

/**
 * 复刻 settleFloor.ts L521-575 的黄金参照原函数组合（用于逐字节对齐断言）
 */
function buildSettleFloorGoldenReference(env: LaneResolveEnv) {
  const catalog = env.catalog;
  const lineOf = lineIndexFromCatalog(catalog.researches);
  const prodLaneOf = prodLaneIndexFromCatalog({
    buildings: catalog.buildings,
    productions: catalog.productions,
    retrofits: catalog.retrofits,
  });
  const deployOf = deployIndexFromCatalog({
    buildings: catalog.buildings,
    productions: catalog.productions,
    retrofits: catalog.retrofits,
  });
  const slotView = { bases: env.bases, queues: env.queues };
  const prodState: LaneStateView = { bases: env.bases, queues: env.queues };

  return {
    laneKeyFor: (txn: TransactionItem, warnSink?: (w: { message: string }) => void) => {
      const researchKeyFor = makeLaneKeyFor(lineOf, warnSink);
      const prodKeyFor = makeProdLaneKeyFor(prodLaneOf, warnSink);
      const engKeyFor = makeEngLaneKeyFor(warnSink);
      return txn.type === '研究' ? researchKeyFor(txn) : txn.type === '工程' ? engKeyFor(txn) : prodKeyFor(txn);
    },
    parallelLimitFor: (txn: TransactionItem, warnSink?: (w: { message: string }) => void) => {
      const researchLimitFor = makeParallelLimitFor(slotView, lineOf, { warnSink, deployOf });
      const prodLimitFor = makeProdParallelLimitFor(prodState, prodLaneOf, { warnSink, deployOf });
      const engLimitFor = makeEngParallelLimitFor(prodState, { warnSink, deployOf });
      return txn.type === '研究' ? researchLimitFor(txn) : txn.type === '工程' ? engLimitFor(txn) : prodLimitFor(txn);
    },
    globalLimitFor: makeGlobalLimitFor(slotView),
    accelEffFor: makeAccelEffFor(prodState, prodLaneOf),
  };
}

/* ═══════════════ ① 黄金对照单测（settleFloor.ts L521-575 100% 逐字节相等） ═══════════════ */

describe('① 黄金对照单测 · LaneRegistryHub vs settleFloor.ts 三路分支原函数', () => {
  const catalog = makeGoldenCatalog();
  const env = makeEnv({
    bases: [
      {
        id: '1号基地',
        name: '1号基地·北境主城',
        buildings: [
          { name: '盟军建造厂', state: '正常', mode: '生产' },
          { name: '盟军建造厂', state: '正常', mode: '加速', accel_scope: 'global' },
          { name: '苏联兵营', state: '正常', mode: '生产' },
          { name: '苏联兵营', state: '正常', mode: '生产' },
          { name: '苏联战车工厂', state: '正常', mode: '生产' },
          { name: '苏联战车工厂', state: '正常', mode: '加速', accel_scope: 'base' },
          { name: '苏联战车工厂', state: '正常', mode: '加速', accel_scope: 'global' },
          { name: '空军指挥部', state: '正常', mode: '加速', accel_scope: 'base' }, // 全切加速 → 容量 0
          { name: '小型纳米合成工坊', state: '正常', mode: '加速' }, // 工坊非双模 → 仍算容量 1
          { name: '个人装备制造所', state: '正常' },
          { name: '矿石精炼厂', state: '正常' },
          { name: '战地维修所', state: '正常' },
          { name: '航天发射中心', state: '正常' },
          { name: '战斗实验室', state: '正常' }, // T2 科技门 → globalLimit = 4
        ],
      },
      {
        id: '2号基地',
        name: '2号基地·海湾前哨',
        buildings: [
          { name: '造船厂', state: '正常', mode: '生产' },
          { name: '海上发射平台', state: '正常' },
          { name: '巨型航天发射港', state: '正常' },
          { name: '水培站', state: '建造中' }, // 建造中不计开通
          { name: '前沿工程展开站', state: '正常' }, // E2b 通道B：build.whitelist + engineer
          { name: '展开式野战车场', state: '正常' }, // E2b 通道B：produce.vehicle
        ],
      },
    ],
    queues: [],
    catalog,
  });

  const golden = buildSettleFloorGoldenReference(env);
  const hub = createLaneRegistryHub();

  const testTransactions: Array<TransactionItem & { lane?: string }> = [
    // 建造类
    makeTxn({ type: '建造', item: '盟军建造厂核心（MCV）', base: '1号基地' }),
    makeTxn({ type: '建造', item: '爱国者防空导弹', base: '1号基地' }),
    makeTxn({ type: '建造', item: '矿石精炼厂', base: '1号基地' }),
    makeTxn({ type: '建造', item: '特种雷达塔', base: '1号基地' }), // catalog lane: lane.defense
    makeTxn({ type: '建造', item: '非法产线建筑', base: '1号基地' }), // catalog 非法 lane → warn + 推导
    makeTxn({ type: '建造', item: '矿石精炼厂', base: '2号基地' }), // 2号基地经通道B build.whitelist 开通其他建筑线
    // 生产类
    makeTxn({ type: '生产', item: '动员步兵班', base: '1号基地' }),
    makeTxn({ type: '生产', item: '犀牛主战坦克', base: '1号基地' }),
    makeTxn({ type: '生产', item: '米格战机', base: '1号基地' }),
    makeTxn({ type: '生产', item: '无畏级战列舰', base: '1号基地' }),
    makeTxn({ type: '生产', item: '无畏级战列舰', base: '2号基地' }),
    makeTxn({ type: '生产', item: '重型单兵外骨骼', base: '1号基地' }),
    makeTxn({ type: '生产', item: '特种攻城重炮', base: '2号基地' }), // 2号基地经通道B produce.vehicle 开通容量
    makeTxn({ type: '生产', item: '日常补给口粮箱', base: '1号基地' }), // 兜底 lane.default
    makeTxn({ type: '生产', item: '犀牛主战坦克', base: '1号基地', lane: 'lane.vehicle_air' }), // 显式指定覆盖
    makeTxn({ type: '生产', item: '犀牛主战坦克', base: '1号基地', lane: 'lane.invalid_explicit' }), // 显式非法 → warn
    makeTxn({ type: '生产', item: '非法产线产物', base: '1号基地' }), // catalog 非法 → warn
    makeTxn({ type: '生产', item: '犀牛主战坦克', base: '未登记幽灵基地' }), // 基地不可解析 → fail-open 1
    // 改装类
    makeTxn({ type: '改装', item: '灰熊坦克火控升级包', base: '1号基地' }),
    makeTxn({ type: '改装', item: '基洛夫空艇挂架改装', base: '1号基地' }), // catalog lane: lane.vehicle_air
    // 研究类（覆盖全 11 槽 + 阵营特色正则 + 机娘名单枚举 + 未知兜底告警）
    makeTxn({ type: '研究', item: '模块化主基地架构', base: '' }),
    makeTxn({ type: '研究', item: '高效矿石精炼法', base: '' }),
    makeTxn({ type: '研究', item: '主动点防御矩阵', base: '' }),
    makeTxn({ type: '研究', item: '复合反应装甲工学', base: '' }),
    makeTxn({ type: '研究', item: '超音速矢量推进', base: '' }),
    makeTxn({ type: '研究', item: '核动力舰体结构', base: '' }),
    makeTxn({ type: '研究', item: '单兵战术数据链', base: '' }),
    makeTxn({ type: '研究', item: '外骨骼伺服关节', base: '' }),
    makeTxn({ type: '研究', item: '高密度气雾水培学', base: '' }),
    makeTxn({ type: '研究', item: '工业尾气闭环回收', base: '' }),
    makeTxn({ type: '研究', item: '低轨重型入轨工学', base: '' }),
    makeTxn({ type: '研究', item: '超时空相控阵学说', base: '' }),
    makeTxn({ type: '研究', item: '高压磁暴谐振学说', base: '' }),
    makeTxn({ type: '研究', item: MECHA_RESEARCH_NAMES[0], base: '' }),
    makeTxn({ type: '研究', item: '未知领域神秘课题', base: '' }), // line 未注册 → warn + slot.main
    makeTxn({ type: '研究', item: '完全不在目录里的野生研究', base: '' }), // 研究名未注册 → warn + slot.main
    // 工程类（覆盖 V1 eng.main 缺省/显式、V2 eng.orbital 显式/裸名、非法槽位告警、未知基地 fail-open）
    makeTxn({ type: '工程', item: 'proj_1·一阶段车体拆解', base: '1号基地' }),
    makeTxn({ type: '工程', item: 'proj_1·二阶段火控合装', base: '1号基地', lane: 'eng:eng.main' }),
    makeTxn({ type: '工程', item: 'proj_orbital·核心桁架入轨', base: '1号基地', lane: 'eng:eng.orbital' }),
    makeTxn({ type: '工程', item: 'proj_orbital·推进舱对接', base: '2号基地', lane: 'eng.orbital' }),
    makeTxn({ type: '工程', item: 'proj_bad·异常槽位工程', base: '1号基地', lane: 'eng:eng.unknown' }),
    makeTxn({ type: '工程', item: 'proj_ghost·幽灵基地工程', base: '未登记幽灵基地', lane: 'eng:eng.main' }),
  ];

  it('对全部 42 条跨领域事务：resolveLaneKeyForTxn / resolveParallelLimitForTxn / resolveAccelEffForTxn 及 warnSink 与 settleFloor 100% 逐字节相等', () => {
    for (const txn of testTransactions) {
      const hubKeyWarns: string[] = [];
      const refKeyWarns: string[] = [];
      const hubKey = hub.resolveLaneKeyForTxn(txn, env, { warnSink: w => hubKeyWarns.push(w.message) });
      const refKey = golden.laneKeyFor(txn, w => refKeyWarns.push(w.message));
      expect(hubKey).toBe(refKey);
      expect(hubKeyWarns).toEqual(refKeyWarns);

      const hubLimitWarns: string[] = [];
      const refLimitWarns: string[] = [];
      const hubLimit = hub.resolveParallelLimitForTxn(txn, env, { warnSink: w => hubLimitWarns.push(w.message) });
      const refLimit = golden.parallelLimitFor(txn, w => refLimitWarns.push(w.message));
      expect(hubLimit).toBe(refLimit);
      expect(hubLimitWarns).toEqual(refLimitWarns);

      const hubAccel = hub.resolveAccelEffForTxn(txn, env);
      const refAccel = golden.accelEffFor(txn);
      expect(hubAccel).toBe(refAccel);
    }
  });

  it('resolveGlobalLimitForType 对全部事务类型与 makeGlobalLimitFor 100% 逐字节相等', () => {
    for (const type of ['研究', '工程', '建造', '生产', '改装', '协议', '未知类型']) {
      expect(hub.resolveGlobalLimitForType(type, env)).toBe(golden.globalLimitFor(type));
    }
    expect(hub.resolveGlobalLimitForType('研究', env)).toBe(4); // 1号基地含战斗实验室（T2=4）
    expect(hub.resolveGlobalLimitForType('生产', env)).toBe(Infinity);
    expect(hub.resolveGlobalLimitForType('工程', env)).toBe(Infinity);
  });

  it('resolveAllLanes 输出的工位快照与各事务 resolveLaneKeyForTxn / parallelLimit / accelEff 同源闭环对齐', () => {
    const allLanes = hub.resolveAllLanes(env);
    // 2 个基地 × 9 产线 = 18；科研 11 槽 = 11；2 个基地 × 2 工程槽 = 4；合计 33 条工位视图
    expect(allLanes).toHaveLength(18 + 11 + 4);
    const laneByKey = new Map<string, LaneStationView>(allLanes.map(l => [l.laneKey, l]));

    // 验证在册基地的命名产线、科研槽、工程槽事务的 laneKey 均能精确命中 LaneStationView
    const inBaseNamedTxns = testTransactions.filter(
      t =>
        (t.base === '' || t.base === '1号基地' || t.base === '2号基地') &&
        t.item !== '日常补给口粮箱' &&
        t.item !== '非法产线产物', // 兜底综合线事务在 makeProdLaneKeyFor 中返回 v1 兼容键 `${base} ${type}`
    );
    for (const txn of inBaseNamedTxns) {
      const key = hub.resolveLaneKeyForTxn(txn, env);
      const station = laneByKey.get(key);
      expect(station).toBeDefined();
      expect(station!.capacity).toBe(hub.resolveParallelLimitForTxn(txn, env));
      if (txn.type === '研究') {
        expect(station!.globalLimit).toBe(hub.resolveGlobalLimitForType('研究', env));
        expect(station!.accelMultiplier).toBe(1.0);
      } else if (txn.type === '工程') {
        expect(station!.accelMultiplier).toBe(1.0);
      } else {
        expect(station!.accelMultiplier).toBe(hub.resolveAccelEffForTxn(txn, env));
      }
    }

    // 兜底综合线事务：makeProdLaneKeyFor 返回 v1 兼容键 `${base} ${type}`，容量恒为 1、加速比恒为 1.0
    for (const item of ['日常补给口粮箱', '非法产线产物']) {
      const fallbackTxn = testTransactions.find(t => t.item === item)!;
      expect(hub.resolveLaneKeyForTxn(fallbackTxn, env)).toBe('1号基地 生产');
      expect(hub.resolveParallelLimitForTxn(fallbackTxn, env)).toBe(1);
      expect(hub.resolveAccelEffForTxn(fallbackTxn, env)).toBe(1);
    }
  });
});

/* ═══════════════ ② 九大产线双模切换单测（ProductionLaneProvider） ═══════════════ */

describe('② ProductionLaneProvider · 九大产线容量与双模递减加速比', () => {
  const emptyCatalog = {
    researches: [],
    buildings: [],
    productions: [],
    retrofits: [],
    projects: [],
    factionDefs: [],
  } as unknown as EffectiveCatalog;

  it('单基地完整输出 LANE_REGISTRY 九大产线（顺序、displayName、baseId、lane.default 恒开通容量 1）', () => {
    const provider = new ProductionLaneProvider();
    const env: LaneResolveEnv = {
      bases: [{ id: 'base_alpha', name: '阿尔法基地', buildings: [] }],
      catalog: emptyCatalog,
    };
    const lanes = provider.resolveLanes(env);
    expect(lanes).toHaveLength(9);
    expect(lanes.map(l => l.displayName)).toEqual(LANE_REGISTRY.map(r => r.name));
    expect(lanes.map(l => l.laneKey)).toEqual(LANE_REGISTRY.map(r => `base_alpha ${r.laneId}`));
    expect(lanes.every(l => l.baseId === 'base_alpha' && l.domain === 'production')).toBe(true);

    // 除综合线（lane.default）容量恒为 1 外，空基地其余 8 条命名产线全部 capacity=0, locked=true
    const defaultLane = lanes.find(l => l.laneKey === 'base_alpha lane.default')!;
    expect(defaultLane.capacity).toBe(1);
    expect(defaultLane.locked).toBe(false);
    expect(defaultLane.lockedReason).toBeUndefined();
    expect(defaultLane.accelMultiplier).toBe(1.0);

    for (const lane of lanes.filter(l => l.laneKey !== 'base_alpha lane.default')) {
      expect(lane.capacity).toBe(0);
      expect(lane.locked).toBe(true);
      expect(lane.lockedReason).toContain('未建成，序列未开通');
      expect(lane.accelMultiplier).toBe(1.0);
    }
  });

  it('双模切换与递减加速比公式：1 座 +0.50 / 2 座 +0.30 / 3 座 +0.20 / 4 座起 +0.05 / 硬上限 2.50x', () => {
    const provider = new ProductionLaneProvider();
    const hub = createLaneRegistryHub();

    const cases: Array<{ accelCount: number; expectedMultiplier: number }> = [
      { accelCount: 0, expectedMultiplier: 1.0 },
      { accelCount: 1, expectedMultiplier: 1.5 },
      { accelCount: 2, expectedMultiplier: 1.8 },
      { accelCount: 3, expectedMultiplier: 2.0 },
      { accelCount: 4, expectedMultiplier: 2.05 },
      { accelCount: 5, expectedMultiplier: 2.1 },
      { accelCount: 12, expectedMultiplier: 2.45 },
      { accelCount: 13, expectedMultiplier: ACCEL_COEFFICIENT_CAP },
      { accelCount: 25, expectedMultiplier: ACCEL_COEFFICIENT_CAP },
    ];

    for (const { accelCount, expectedMultiplier } of cases) {
      const buildings = [
        { name: '盟军战车工厂', state: '正常', mode: '生产' },
        { name: '苏联战车工厂', state: '正常', mode: '生产' },
        ...Array.from({ length: accelCount }, (_, idx) => ({
          name: `战车工厂#${idx + 1}`,
          state: '正常',
          mode: '加速',
          accel_scope: 'global',
        })),
      ];
      const env: LaneResolveEnv = {
        bases: [{ id: '1号基地', buildings }],
        catalog: emptyCatalog,
      };
      const landLane = provider.resolveLanes(env).find(l => l.laneKey === '1号基地 lane.vehicle_land')!;
      expect(landLane.capacity).toBe(2);
      expect(landLane.locked).toBe(false);
      expect(landLane.accelMultiplier).toBeCloseTo(expectedMultiplier, 6);
      expect(
        hub.resolveAccelEffForTxn(makeTxn({ type: '生产', item: '犀牛主战坦克', base: '1号基地' }), env),
      ).toBeCloseTo(expectedMultiplier, 6);
    }
  });

  it('全切加速模式时：capacity=0、locked=true（队列滞留），且 accelMultiplier 照常保留；建造中建筑不计容量亦不计加速', () => {
    const provider = new ProductionLaneProvider();
    const env = makeEnv({
      bases: [
        {
          id: '1号基地',
          buildings: [
            { name: '战车工厂', state: '正常', mode: '加速', accel_scope: 'base' },
            { name: '战车工厂', state: '正常', mode: '加速', accel_scope: 'global' },
            { name: '战车工厂', state: '建造中', mode: '生产' },
            { name: '战车工厂', state: '建造中', mode: '加速' },
          ],
        },
      ],
      catalog: emptyCatalog,
    });
    const landLane = provider.resolveLanes(env).find(l => l.laneKey === '1号基地 lane.vehicle_land')!;
    expect(landLane.capacity).toBe(0);
    expect(landLane.locked).toBe(true);
    expect(landLane.lockedReason).toBe(SCHEDULE_COPY.lockedReason('战车工厂'));
    expect(landLane.accelMultiplier).toBeCloseTo(1.8, 6);
  });

  it('accel_scope 隔离：global 跨基地共享加速，base 仅对本基地生效；非双模产线（lane.equipment）恒视为生产模式', () => {
    const provider = new ProductionLaneProvider();
    const env = makeEnv({
      bases: [
        {
          id: '基地A',
          buildings: [
            { name: '兵营', state: '正常', mode: '生产' },
            { name: '兵营', state: '正常', mode: '加速', accel_scope: 'base' }, // 仅加速基地A (+0.50)
            { name: '兵营', state: '正常', mode: '加速', accel_scope: 'global' }, // 全局加速 (+0.30 / +0.50)
            { name: '小型纳米合成工坊', state: '正常', mode: '加速' }, // 工坊 dualMode=false → 仍计生产容量 1，加速 1.0
          ],
        },
        {
          id: '基地B',
          buildings: [{ name: '兵营', state: '正常', mode: '生产' }],
        },
      ],
      catalog: emptyCatalog,
    });
    const lanes = provider.resolveLanes(env);
    const personnelA = lanes.find(l => l.laneKey === '基地A lane.personnel')!;
    const personnelB = lanes.find(l => l.laneKey === '基地B lane.personnel')!;
    const equipA = lanes.find(l => l.laneKey === '基地A lane.equipment')!;

    expect(personnelA.capacity).toBe(1);
    expect(personnelA.accelMultiplier).toBeCloseTo(1.8, 6); // 2 座生效（1 global + 1 base）
    expect(personnelB.capacity).toBe(1);
    expect(personnelB.accelMultiplier).toBeCloseTo(1.5, 6); // 仅 1 座 global 生效
    expect(equipA.capacity).toBe(1);
    expect(equipA.locked).toBe(false);
    expect(equipA.accelMultiplier).toBe(1.0);
  });
});

/* ═══════════════ ③ 11 科研序列与 techTier 单测（ResearchLaneProvider） ═══════════════ */

describe('③ ResearchLaneProvider · 11 科研序列开通门与 techTier 全局并行上限', () => {
  const catalog = makeGoldenCatalog();

  it('空基地：11 科研序列全部 locked=true、capacity=0、baseId=undefined、T1 globalLimit=2', () => {
    const provider = new ResearchLaneProvider();
    const env: LaneResolveEnv = { bases: [{ id: '1号基地', buildings: [] }], catalog };
    const lanes = provider.resolveLanes(env);

    expect(lanes).toHaveLength(11);
    expect(lanes.map(l => l.laneKey)).toEqual(SLOT_REGISTRY.map(s => `research:${s.slotId}`));
    expect(lanes.map(l => l.displayName)).toEqual(SLOT_REGISTRY.map(s => s.name));
    for (let i = 0; i < lanes.length; i++) {
      expect(lanes[i].baseId).toBeUndefined();
      expect(lanes[i].domain).toBe('research');
      expect(lanes[i].capacity).toBe(0);
      expect(lanes[i].locked).toBe(true);
      expect(lanes[i].globalLimit).toBe(2);
      expect(lanes[i].accelMultiplier).toBe(1.0);
      expect(lanes[i].lockedReason).toBe(SCHEDULE_COPY.lockedReason(SLOT_REGISTRY[i].anchor));
    }
  });

  it('全 11 槽锚定建筑就位时全部解锁（capacity=1, locked=false）；建造中锚定建筑不解锁', () => {
    const provider = new ResearchLaneProvider();
    const env: LaneResolveEnv = {
      bases: [
        {
          id: '1号基地',
          buildings: [
            { name: '盟军建造厂', state: '正常' }, // 解锁 slot.main & slot.faction
            { name: '矿石精炼厂', state: '正常' }, // 解锁 slot.industry
            { name: '苏联兵营', state: '正常' }, // 解锁 slot.defense & slot.personnel
            { name: '苏联战车工厂', state: '正常' }, // 解锁 slot.vehicle
            { name: '个人装备制造所', state: '正常' }, // 解锁 slot.equipment
            { name: '生态副食与水循环保障站', state: '正常' }, // 解锁 slot.agri
            { name: '基础废物分拣站', state: '正常' }, // 解锁 slot.eco
            { name: '航天发射中心', state: '建造中' }, // 建造中 → slot.aerospace 仍锁定
            { name: '机娘接口设施', state: '正常' }, // 解锁 slot.mecha
          ],
        },
      ],
      catalog,
    };

    const lanes = provider.resolveLanes(env);
    const aero = lanes.find(l => l.laneKey === 'research:slot.aerospace')!;
    expect(aero.capacity).toBe(0);
    expect(aero.locked).toBe(true);
    expect(aero.lockedReason).toBe(SCHEDULE_COPY.lockedReason('航天发射中心'));

    for (const lane of lanes.filter(l => l.laneKey !== 'research:slot.aerospace')) {
      expect(lane.capacity).toBe(1);
      expect(lane.locked).toBe(false);
      expect(lane.lockedReason).toBeUndefined();
    }
  });

  it('techTier 三档全局上限：T1=2 / T2=4 / T3=Infinity（先扫到 T2 再扫到 T3 仍精确返回 Infinity）', () => {
    const hub = createLaneRegistryHub();
    const provider = new ResearchLaneProvider();

    // T1：无实验室
    const envT1: LaneResolveEnv = {
      bases: [{ id: '1号基地', buildings: [{ name: '盟军建造厂', state: '正常' }] }],
      catalog,
    };
    expect(hub.resolveGlobalLimitForType('研究', envT1)).toBe(2);
    expect(provider.resolveLanes(envT1)[0].globalLimit).toBe(2);

    // T2：红星实验设计局综合体在场（且 T3 建筑处于建造中不生效）
    const envT2: LaneResolveEnv = {
      bases: [
        {
          id: '1号基地',
          buildings: [
            { name: '红星实验设计局综合体', state: '正常' },
            { name: '量子超算中心', state: '建造中' },
          ],
        },
      ],
      catalog,
    };
    expect(hub.resolveGlobalLimitForType('研究', envT2)).toBe(4);
    expect(provider.resolveLanes(envT2)[0].globalLimit).toBe(4);

    // T3：先有战斗实验室（T2），后有国家战略工程综合体（T3）→ 返回 Infinity
    const envT3: LaneResolveEnv = {
      bases: [
        { id: '1号基地', buildings: [{ name: '盟军战斗实验室', state: '正常' }] },
        { id: '2号基地', buildings: [{ name: '国家战略工程综合体', state: '正常' }] },
      ],
      catalog,
    };
    expect(hub.resolveGlobalLimitForType('研究', envT3)).toBe(Infinity);
    expect(provider.resolveLanes(envT3)[0].globalLimit).toBe(Infinity);
  });
});

/* ═══════════════ ④ 工程槽属地容量与 E2b 通道B 展开车能力面单测 ═══════════════ */

describe('④ EngineeringLaneProvider 属地容量与 E2b 通道B 展开车能力面', () => {
  const catalog = makeGoldenCatalog();

  it('工程槽（eng.main / eng.orbital）严格按属地基地隔离计算容量，建造中建筑不计容量', () => {
    const provider = new EngineeringLaneProvider();
    const env: LaneResolveEnv = {
      bases: [
        {
          id: '基地A',
          buildings: [
            { name: '盟军建造厂', state: '正常' },
            { name: '战地维修所', state: '正常' },
            { name: '航天发射中心', state: '建造中' },
            { name: '导弹发射井群', state: '正常' }, // 防误命中守卫：导弹发射井不属于 eng.orbital
          ],
        },
        {
          id: '基地B',
          buildings: [
            { name: '海上发射平台', state: '正常' },
            { name: '大型航天发射综合体', state: '正常' },
            { name: '山体发射场', state: '正常' },
          ],
        },
      ],
      catalog,
    };

    const lanes = provider.resolveLanes(env);
    expect(lanes).toHaveLength(2 * ENGINEERING_SLOT_REGISTRY.length);

    const mainA = lanes.find(l => l.laneKey === '基地A eng:eng.main')!;
    const orbitalA = lanes.find(l => l.laneKey === '基地A eng:eng.orbital')!;
    const mainB = lanes.find(l => l.laneKey === '基地B eng:eng.main')!;
    const orbitalB = lanes.find(l => l.laneKey === '基地B eng:eng.orbital')!;

    expect(mainA.capacity).toBe(2);
    expect(mainA.locked).toBe(false);
    expect(mainA.lockedReason).toBeUndefined();

    expect(orbitalA.capacity).toBe(0);
    expect(orbitalA.locked).toBe(true);
    expect(orbitalA.lockedReason).toBe(SCHEDULE_COPY.lockedReason('航天发射中心/发射场系'));

    expect(mainB.capacity).toBe(0);
    expect(mainB.locked).toBe(true);
    expect(mainB.lockedReason).toBe(SCHEDULE_COPY.lockedReason('建造厂核心/战地维修所'));

    expect(orbitalB.capacity).toBe(3);
    expect(orbitalB.locked).toBe(false);
    expect(orbitalB.lockedReason).toBeUndefined();
  });

  it('E2b 通道B 展开车能力面：按 build.whitelist / produce.vehicle / research / engineer 精确赋能且互不串道', () => {
    const hub = createLaneRegistryHub();
    const env: LaneResolveEnv = {
      bases: [
        {
          id: '前哨站',
          buildings: [
            { name: '前沿工程展开站', state: '正常' }, // 授予 build.whitelist + engineer
            { name: '展开式野战车场', state: '正常' }, // 授予 produce.vehicle
            { name: '展开式科研方舱', state: '正常' }, // 授予 research
          ],
        },
      ],
      catalog,
    };

    const allLanes = hub.resolveAllLanes(env);
    const byKey = new Map(allLanes.map(l => [l.laneKey, l]));

    // build.whitelist 解锁防御线与其他建筑线，但不解锁主建筑线 lane.main（需 build.full）
    expect(byKey.get('前哨站 lane.main')!.capacity).toBe(0);
    expect(byKey.get('前哨站 lane.defense')!.capacity).toBe(1);
    expect(byKey.get('前哨站 lane.other_building')!.capacity).toBe(1);

    // produce.vehicle 解锁陆/空/海载具线，但不解锁人员线或装备线
    expect(byKey.get('前哨站 lane.vehicle_land')!.capacity).toBe(1);
    expect(byKey.get('前哨站 lane.vehicle_air')!.capacity).toBe(1);
    expect(byKey.get('前哨站 lane.vehicle_naval')!.capacity).toBe(1);
    expect(byKey.get('前哨站 lane.personnel')!.capacity).toBe(0);
    expect(byKey.get('前哨站 lane.equipment')!.capacity).toBe(0);

    // research 能力面仅解锁 slot.main 与 slot.faction，其余科研槽保持未解锁
    expect(byKey.get('research:slot.main')!.capacity).toBe(1);
    expect(byKey.get('research:slot.faction')!.capacity).toBe(1);
    expect(byKey.get('research:slot.vehicle')!.capacity).toBe(0);

    // engineer 能力面解锁属地工程槽 eng.main 与 eng.orbital
    expect(byKey.get('前哨站 eng:eng.main')!.capacity).toBe(1);
    expect(byKey.get('前哨站 eng:eng.orbital')!.capacity).toBe(1);
  });
});

/* ═══════════════ ⑤ ProtocolLaneProvider 预留位与入参深冻结零突变单测 ═══════════════ */

describe('⑤ ProtocolLaneProvider 预留扩展与入参深冻结（Object.freeze）零突变', () => {
  const catalog = makeGoldenCatalog();

  it('默认 createLaneRegistryHub 不输出协议工位；开启 includeProtocol 或手动注册后无缝挂载 theater:lane.protocol', () => {
    const defaultHub = createLaneRegistryHub();
    expect(defaultHub).toBeInstanceOf(LaneRegistryHub);
    const env: LaneResolveEnv = { bases: [{ id: '1号基地', buildings: [] }], catalog };

    expect(defaultHub.getProviders()).toHaveLength(3);
    expect(defaultHub.getProvider('protocol')).toBeUndefined();
    expect(defaultHub.resolveAllLanes(env).some(l => l.domain === 'protocol')).toBe(false);

    // 通过 includeProtocol 挂载
    const protoHub = createLaneRegistryHub({
      includeProtocol: {
        capacity: 1,
        accelMultiplier: 1.25,
      },
    });
    expect(protoHub.getProviders()).toHaveLength(4);
    const protoLane = protoHub.resolveAllLanes(env).find(l => l.domain === 'protocol')!;
    expect(protoLane).toEqual({
      laneKey: PROTOCOL_LANE_KEY,
      domain: 'protocol',
      displayName: PROTOCOL_LANE_DISPLAY_NAME,
      baseId: undefined,
      capacity: 1,
      globalLimit: Infinity,
      accelMultiplier: 1.25,
      locked: false,
      lockedReason: undefined,
    });

    const protoTxn = makeTxn({ type: '协议', item: '铁幕紧急过载协议', base: '' });
    expect(protoHub.resolveLaneKeyForTxn(protoTxn, env)).toBe('theater:lane.protocol');
    expect(protoHub.resolveParallelLimitForTxn(protoTxn, env)).toBe(1);
    expect(protoHub.resolveAccelEffForTxn(protoTxn, env)).toBe(1.25);

    // 支持锁定态与动态 resolveState
    const lockedProto = new ProtocolLaneProvider({
      resolveState: () => ({ capacity: 0, locked: true, lockedReason: '战斗实验室离线，协议推演暂停' }),
    });
    defaultHub.registerProvider(lockedProto);
    const lockedView = defaultHub.resolveAllLanes(env).find(l => l.laneKey === PROTOCOL_LANE_KEY)!;
    expect(lockedView.capacity).toBe(0);
    expect(lockedView.locked).toBe(true);
    expect(lockedView.lockedReason).toBe('战斗实验室离线，协议推演暂停');
    expect(defaultHub.resolveParallelLimitForTxn(protoTxn, env)).toBe(0);
  });

  it('registerProvider 支持替换同 domain 自定义 Provider 而不破坏其他领域', () => {
    const hub = createLaneRegistryHub();
    const customResearch: ILaneProvider = {
      domain: 'research',
      resolveLanes: () => [
        {
          laneKey: 'research:slot.custom',
          domain: 'research',
          displayName: '自定义科研序列',
          capacity: 1,
          accelMultiplier: 1.0,
          locked: false,
        },
      ],
      resolveTaskLaneKey: () => 'research:slot.custom',
    };
    hub.registerProvider(customResearch);
    expect(hub.getProviders()).toHaveLength(3);
    const env: LaneResolveEnv = { bases: [], catalog };
    expect(hub.resolveLaneKeyForTxn(makeTxn({ type: '研究', item: '任意课题' }), env)).toBe('research:slot.custom');
  });

  it('入参深冻结（deepFreeze）零突变：调用全部 Provider 与 Hub 方法绝不修改 env 与 txn', () => {
    const frozenEnv = deepFreeze<LaneResolveEnv>({
      bases: [
        {
          id: '1号基地',
          name: '1号基地',
          status: '正常',
          buildings: [
            { name: '盟军建造厂', state: '正常', mode: '生产' },
            { name: '苏联战车工厂', state: '正常', mode: '加速' },
            { name: '航天发射中心', state: '正常' },
          ],
        },
      ],
      queues: [
        makeTxn({ type: '生产', item: '犀牛主战坦克', base: '1号基地', status: 'active' }),
        makeTxn({ type: '研究', item: '模块化主基地架构', base: '', status: 'queued' }),
        makeTxn({ type: '工程', item: 'proj_1·一阶段', base: '1号基地', status: 'active', lane: 'eng:eng.main' }),
      ],
      catalog: makeGoldenCatalog(),
    });

    const snapshotBefore = JSON.stringify(frozenEnv);
    const hub = createLaneRegistryHub({ includeProtocol: true });

    const lanes = hub.resolveAllLanes(frozenEnv);
    expect(lanes.length).toBeGreaterThan(0);

    for (const q of frozenEnv.queues!) {
      const frozenTxn = deepFreeze({ ...q });
      expect(() => hub.resolveLaneKeyForTxn(frozenTxn, frozenEnv)).not.toThrow();
      expect(() => hub.resolveParallelLimitForTxn(frozenTxn, frozenEnv)).not.toThrow();
      expect(() => hub.resolveAccelEffForTxn(frozenTxn, frozenEnv)).not.toThrow();
      expect(() => hub.resolveGlobalLimitForType(frozenTxn.type, frozenEnv)).not.toThrow();
    }

    expect(JSON.stringify(frozenEnv)).toBe(snapshotBefore);
  });

  it('纯函数红线审查：零 Pinia / Vue / 宿主 API / DOM 引用，且既有三槽模块导出签名未被破坏', () => {
    const exportedValues = Object.values(laneProviderExports) as unknown[];
    const exportedFunctions = exportedValues.filter(v => typeof v === 'function') as Array<{ toString(): string }>;
    const compiledSource = exportedFunctions.map(fn => fn.toString()).join('\n');

    expect(compiledSource).not.toMatch(/\b(pinia|defineStore|getActivePinia)\b/);
    expect(compiledSource).not.toMatch(/\b(getCurrentInstance|getCurrentMessageId|SillyTavern|TavernHelper)\b/);
    expect(compiledSource).not.toMatch(/\b(document|window|globalThis)\s*\./);

    // 确认底层三模块核心函数引用完好
    expect(typeof laneCapacityInBase).toBe('function');
    expect(typeof engSlotCapacityInBase).toBe('function');
    expect(typeof makeLaneKeyFor).toBe('function');
  });
});
