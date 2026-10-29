/**
 * productionLanes.test.ts —— CTRL-PROD-LANE-01 验收测试
 *
 * 真源：docs/design/systems/产线与产能调度总设计案.md（confirmed-v2）
 * 覆盖（对照 researchSlots.test.ts 版型）：
 * ① 注册表完整性；② Q2 四级判定；③ 容量门（双模/canon 原生容量）；④ 加速系数表与 cap；
 * ⑤ accel_scope 聚合；⑥ 缺省兼容（旧档行为等价 v1）；⑦ 引擎升格门回环；⑧ 模式切换事务；⑨ laneBoard
 */
import { describe, expect, it } from 'vitest';
import {
  ACCEL_COEFFICIENT_CAP,
  accelCoefficientFor,
  capabilityCovers,
  deployIndexFromCatalog,
  effectiveAccelCount,
  LANE_DEPLOY_CAPABILITY,
  LANE_REGISTRY,
  laneBoard,
  laneDefFromKey,
  laneFor,
  makeAccelEffFor,
  makeProdLaneKeyFor,
  makeProdParallelLimitFor,
  MODE_SWITCH_MINUTES,
  prodLaneIndexFromCatalog,
  requestModeSwitch,
  settleModeSwitches,
  type DeployOf,
  type LaneStateView,
  type LaneWarn,
  type ProdTxnView,
} from '../engines/productionLanes';
import { Schema } from '../core/schema';
import { settleTransactions, type TransactionItem } from '../engines/transactionEngine';

/* ═══════════════ 测试工具 ═══════════════ */

/** 造一条 v2 全字段事务（默认 queued 生产，工期 1000 分钟） */
function txn(overrides: Partial<TransactionItem> & { lane?: string } = {}): TransactionItem & { lane?: string } {
  return {
    type: '生产',
    item: '测试产物',
    base: '基地A',
    progress: 0,
    eta: '',
    status: 'queued',
    started_at: '',
    total_minutes: 1000,
    spent_minutes: 0,
    qty: 1,
    qty_done: 0,
    cost_paid: true,
    min_days_lock: 0,
    hold: false,
    ...overrides,
  };
}

interface BuildingSpec {
  name: string;
  state?: string;
  mode?: string;
  accel_scope?: string;
}

/** 造一个最小状态视图：{基地名: 建筑名单} */
function stateWith(
  bases: Record<string, BuildingSpec[]>,
  queues: ReadonlyArray<{ type: string; item: string; base?: string; status?: string; lane?: string }> = [],
): LaneStateView {
  return {
    bases: Object.entries(bases).map(([name, buildings]) => ({
      id: name,
      name,
      buildings: buildings.map(b => ({ state: '运转', ...b })),
    })),
    queues,
  };
}

/** 显式 lane 查找表（Q2 第 2 级 catalog 映射模拟） */
const testLaneOf = (map: Record<string, string>) => {
  const index = prodLaneIndexFromCatalog({
    productions: Object.entries(map)
      .filter(([k]) => k.startsWith('生产 '))
      .map(([k, lane]) => ({ name: k.slice(3), lane })),
    buildings: Object.entries(map)
      .filter(([k]) => k.startsWith('建造 '))
      .map(([k, lane]) => ({ name: k.slice(3), lane })),
  });
  return index;
};

/* ═══════════════ ① 注册表完整性 ═══════════════ */

describe('LANE_REGISTRY 注册表完整性（§1 九线全表）', () => {
  it('九线定格：id 唯一、显示名非空、双模标记符合 canon 适用品类', () => {
    expect(LANE_REGISTRY).toHaveLength(9);
    const ids = LANE_REGISTRY.map(l => l.laneId);
    expect(new Set(ids).size).toBe(9);
    expect(ids).toEqual([
      'lane.main',
      'lane.defense',
      'lane.other_building',
      'lane.personnel',
      'lane.vehicle_land',
      'lane.vehicle_air',
      'lane.vehicle_naval',
      'lane.equipment',
      'lane.default',
    ]);
    for (const def of LANE_REGISTRY) expect(def.name.length).toBeGreaterThan(0);
    // canon 适用品类冻结：MCV 三线＋兵营/战车工厂/空军指挥部/造船厂双模；装备线（工坊）与综合线恒生产
    const dualModeIds = LANE_REGISTRY.filter(l => l.dualMode).map(l => l.laneId);
    expect(dualModeIds).toEqual([
      'lane.main',
      'lane.defense',
      'lane.other_building',
      'lane.personnel',
      'lane.vehicle_land',
      'lane.vehicle_air',
      'lane.vehicle_naval',
    ]);
  });

  it('产线键反解析：laneDefFromKey 从右侧匹配（base 名含空格不炸）', () => {
    expect(laneDefFromKey('基地A lane.personnel')?.laneId).toBe('lane.personnel');
    expect(laneDefFromKey('青岚山 北坡基地 lane.vehicle_air')?.laneId).toBe('lane.vehicle_air');
    expect(laneDefFromKey('基地A 生产')).toBeUndefined(); // v1 兜底键非命名产线
  });
});

/* ═══════════════ ② Q2 四级判定 ═══════════════ */

describe('laneFor 四级判定（§2 Q2）', () => {
  it('第 1 级：QueueItem.lane 显式指定优先', () => {
    const r = laneFor(txn({ item: '灰熊坦克', lane: 'lane.personnel' }) as ProdTxnView);
    expect(r).toEqual({ laneId: 'lane.personnel', matched: 'explicit' });
  });

  it('第 1 级非法值：warn 留痕并落下一级（不直接兜底）', () => {
    const r = laneFor(txn({ item: '灰熊坦克', lane: 'lane.不存在' }) as ProdTxnView);
    expect(r.matched).toBe('derived'); // 坦克→陆地载具线
    expect(r.laneId).toBe('lane.vehicle_land');
    expect(r.warn?.type).toBe('unknown_explicit_lane');
  });

  it('第 2 级：catalog lane 字段映射（显式缺席时）', () => {
    const laneOf = testLaneOf({ '生产 多功能机器狗': 'lane.equipment' });
    const r = laneFor(txn({ item: '多功能机器狗' }) as ProdTxnView, laneOf);
    expect(r).toEqual({ laneId: 'lane.equipment', matched: 'catalog' });
  });

  it('第 2 级非法 catalog lane：warn 留痕转推导', () => {
    const laneOf = testLaneOf({ '生产 灰熊坦克': 'lane.乱填' });
    const r = laneFor(txn({ item: '灰熊坦克' }) as ProdTxnView, laneOf);
    expect(r.laneId).toBe('lane.vehicle_land');
    expect(r.matched).toBe('derived');
    expect(r.warn?.type).toBe('unknown_catalog_lane');
  });

  it('第 3 级推导：建造按防御/MCV/其他三分', () => {
    expect(laneFor(txn({ type: '建造', item: '机枪碉堡' }) as ProdTxnView).laneId).toBe('lane.defense');
    expect(laneFor(txn({ type: '建造', item: '建造厂核心（副核心）' }) as ProdTxnView).laneId).toBe('lane.main');
    expect(laneFor(txn({ type: '建造', item: '发电厂' }) as ProdTxnView).laneId).toBe('lane.other_building');
  });

  it('第 3 级推导：生产按产物关键词海陆空分线；改装恒装备线', () => {
    expect(laneFor(txn({ item: '灰熊坦克' }) as ProdTxnView).laneId).toBe('lane.vehicle_land');
    expect(laneFor(txn({ item: '武装直升机' }) as ProdTxnView).laneId).toBe('lane.vehicle_air');
    expect(laneFor(txn({ item: '导弹驱逐舰' }) as ProdTxnView).laneId).toBe('lane.vehicle_naval');
    expect(laneFor(txn({ item: '动员兵' }) as ProdTxnView).laneId).toBe('lane.default'); // 无关键词命中→兜底
    expect(laneFor(txn({ item: '步兵班' }) as ProdTxnView).laneId).toBe('lane.personnel');
    expect(laneFor(txn({ type: '改装', item: '灰熊坦克改装型' }) as ProdTxnView).laneId).toBe('lane.equipment');
  });

  it('第 4 级兜底：未匹配事务＋日常生活用品＋研究（非本模块辖区）→ lane.default', () => {
    expect(laneFor(txn({ item: '日常生活用品' }) as ProdTxnView)).toEqual({
      laneId: 'lane.default',
      matched: 'fallback',
    });
    expect(laneFor(txn({ type: '研究', item: '基础步兵训练学' }) as ProdTxnView).laneId).toBe('lane.default');
  });
});

/* ═══════════════ ③ 容量门（双模 · canon 原生容量） ═══════════════ */

describe('makeProdParallelLimitFor 容量门（§2 Q3）', () => {
  it('两座生产模式兵营＝两条人员线并行；一座加速一座生产＝一条', () => {
    const twoProd = stateWith({ 基地A: [{ name: '兵营' }, { name: '苏联兵营' }] });
    const limit2 = makeProdParallelLimitFor(twoProd);
    expect(limit2(txn({ item: '步兵班' }))).toBe(2);

    const oneAccel = stateWith({ 基地A: [{ name: '兵营' }, { name: '苏联兵营', mode: '加速' }] });
    expect(makeProdParallelLimitFor(oneAccel)(txn({ item: '步兵班' }))).toBe(1);
  });

  it('全部加速＝容量 0（队列滞留）；建造中建筑不计容量', () => {
    const allAccel = stateWith({ 基地A: [{ name: '兵营', mode: '加速' }] });
    expect(makeProdParallelLimitFor(allAccel)(txn({ item: '步兵班' }))).toBe(0);

    const building = stateWith({ 基地A: [{ name: '兵营', state: '建造中' }] });
    expect(makeProdParallelLimitFor(building)(txn({ item: '步兵班' }))).toBe(0);
  });

  it('容量按基地隔离：基地B 的兵营不给基地A 开线', () => {
    const state = stateWith({ 基地A: [], 基地B: [{ name: '兵营' }] });
    const limit = makeProdParallelLimitFor(state);
    expect(limit(txn({ item: '步兵班', base: '基地A' }))).toBe(0);
    expect(limit(txn({ item: '步兵班', base: '基地B' }))).toBe(1);
  });

  it('非适用品类（装备线工坊）无 mode 语义：恒视为生产', () => {
    const state = stateWith({ 基地A: [{ name: '小型纳米合成工坊', mode: '加速' }] });
    expect(makeProdParallelLimitFor(state)(txn({ item: '光学瞄准镜' }))).toBe(1);
  });

  it('基地不可解析（空/查无）→ fail-open 恒 1（旧档兼容）；兜底线恒 1', () => {
    const state = stateWith({ 基地A: [{ name: '兵营' }] });
    const limit = makeProdParallelLimitFor(state);
    expect(limit(txn({ item: '步兵班', base: '查无此基地' }))).toBe(1);
    expect(limit(txn({ item: '步兵班', base: '' }))).toBe(1);
    expect(limit(txn({ item: '日常生活用品' }))).toBe(1); // lane.default
  });
});

/* ═══════════════ ④⑤ 加速系数（§4.2 递减表/cap／§4.3 scope 聚合） ═══════════════ */

describe('accelCoefficientFor 递减系数表（§4.2 canon 公式冻结）', () => {
  it('递减表：0→1.00／1→1.50／2→1.80／3→2.00／4→2.05／5→2.10', () => {
    expect(accelCoefficientFor(0)).toBe(1);
    expect(accelCoefficientFor(1)).toBe(1.5);
    expect(accelCoefficientFor(2)).toBeCloseTo(1.8, 10);
    expect(accelCoefficientFor(3)).toBeCloseTo(2.0, 10);
    expect(accelCoefficientFor(4)).toBeCloseTo(2.05, 10);
    expect(accelCoefficientFor(5)).toBeCloseTo(2.1, 10);
  });

  it('硬上限 2.50（生产时间不低于基础值四成）；非法输入按 0 计', () => {
    expect(accelCoefficientFor(100)).toBe(ACCEL_COEFFICIENT_CAP);
    expect(accelCoefficientFor(30)).toBe(ACCEL_COEFFICIENT_CAP); // 1+1.0+27×0.05=2.35→未 cap？否：1+0.5+0.3+0.2=2.0，+27×0.05=1.35，合计 3.35 → cap 2.50
    expect(accelCoefficientFor(-3)).toBe(1);
    expect(accelCoefficientFor(1.9)).toBe(1.5); // 取整
  });
});

describe('effectiveAccelCount / makeAccelEffFor（§4.3 scope 聚合）', () => {
  const mkTxn = (base = '基地A') => txn({ item: '步兵班', base }) as ProdTxnView;

  it('global 加速跨基地聚合；base scope 只加速本基地', () => {
    const state = stateWith({
      基地A: [{ name: '兵营' }],
      基地B: [{ name: '苏联兵营', mode: '加速' }], // global（缺省）
      基地C: [{ name: '兵营', mode: '加速', accel_scope: 'base' }], // 只加速基地C
    });
    // 基地A：1 座 global（基地B）→ 系数 1.5
    expect(effectiveAccelCount(state, mkTxn('基地A'), LANE_REGISTRY[3])).toBe(1);
    // 基地C：1 global＋1 base → 2 → 系数 1.8
    expect(effectiveAccelCount(state, mkTxn('基地C'), LANE_REGISTRY[3])).toBe(2);
  });

  it('makeAccelEffFor：双模线吃系数，非双模/兜底恒 1，基地不可解析恒 1', () => {
    const state = stateWith({
      基地A: [{ name: '兵营' }, { name: '苏联兵营', mode: '加速' }],
    });
    const eff = makeAccelEffFor(state);
    expect(eff(mkTxn())).toBe(1.5);
    expect(eff(txn({ item: '日常生活用品' }) as ProdTxnView)).toBe(1); // lane.default
    expect(eff(txn({ item: '光学瞄准镜' }) as ProdTxnView)).toBe(1); // 装备线非双模
    expect(eff(txn({ item: '步兵班', base: '查无' }) as ProdTxnView)).toBe(1);
  });

  it('FIX-P1-01 建造中/受损/停机加速贡献口径：仅 state=运转（或缺省）计入容量与加速', () => {
    const state = stateWith({
      基地A: [
        { name: '兵营' },
        { name: '苏联兵营', mode: '加速', state: '建造中' }, // 不计
        { name: '后备兵营', mode: '加速', state: '受损' }, // 不计（FIX-P1-01）
        { name: '二线兵营', mode: '加速', state: '停机' }, // 不计（FIX-P1-01）
        { name: '近卫兵营', mode: '加速', state: '运转' }, // 在场运转计入
      ],
    });
    expect(makeAccelEffFor(state)(mkTxn())).toBe(1.5);
  });
});

/* ═══════════════ ⑥ 缺省兼容（旧档行为等价 v1） ═══════════════ */

describe('缺省兼容（§0.2 红线 4：旧档零迁移惰性缺省）', () => {
  it('旧档事务（无 lane 字段）未匹配 → 兜底键逐字节等于 v1 `${base} ${type}`', () => {
    const keyFor = makeProdLaneKeyFor();
    const t = txn({ item: '神秘旧产物' });
    expect(keyFor(t)).toBe('基地A 生产');
    expect(keyFor(txn({ type: '建造', item: '神秘旧建筑' }))).not.toBe('基地A 建造'); // 建造走推导（设计意图：多产线并行）
    expect(keyFor(txn({ type: '研究', item: '任意研究' }))).toBe('基地A 研究'); // 研究落兜底键（组合层分流）
  });

  it('旧档建筑（无 mode/accel_scope）→ 生产模式＋global：容量照常、加速系数 1', () => {
    const state = stateWith({ 基地A: [{ name: '兵营' }] });
    expect(makeProdParallelLimitFor(state)(txn({ item: '步兵班' }))).toBe(1);
    expect(makeAccelEffFor(state)(txn({ item: '步兵班' }) as ProdTxnView)).toBe(1);
  });

  it('schema 缺省：Building mode/accel_scope 与 QueueItem.lane 惰性缺席（零迁移钉死兼容）；pending_mode_switches 不注入', () => {
    const parsed = Schema.parse({
      bases: [{ id: 'b1', name: '基地A', buildings: [{ name: '兵营' }] }],
      queues: [{ type: '生产', item: '步兵班', base: '基地A' }],
    });
    expect(parsed.bases[0].buildings[0].mode).toBeUndefined(); // 惰性缺省='生产'（引擎侧兑现）
    expect(parsed.bases[0].buildings[0].accel_scope).toBeUndefined(); // 惰性缺省='global'
    expect(parsed.queues[0].lane).toBeUndefined(); // 未指定走 Q2 推导
    expect(parsed.pending_mode_switches).toBeUndefined();
  });

  it('schema 显式值落账：mode=加速/accel_scope=base/lane 显式', () => {
    const parsed = Schema.parse({
      bases: [{ id: 'b1', name: '基地A', buildings: [{ name: '兵营', mode: '加速', accel_scope: 'base' }] }],
      queues: [{ type: '生产', item: '步兵班', base: '基地A', lane: 'lane.personnel' }],
    });
    expect(parsed.bases[0].buildings[0].mode).toBe('加速');
    expect(parsed.bases[0].buildings[0].accel_scope).toBe('base');
    expect(parsed.queues[0].lane).toBe('lane.personnel');
  });
});

/* ═══════════════ ⑦ 引擎升格门回环（经既有回调接缝，引擎本体零改动） ═══════════════ */

describe('settleTransactions 产线门回环（§5 落地门 4）', () => {
  const wire = (state: LaneStateView) => ({
    laneKeyFor: makeProdLaneKeyFor(),
    parallelLimitFor: makeProdParallelLimitFor(state),
  });

  it('双兵营＝两条人员线并行升格（canon 原生容量）', () => {
    const state = stateWith({ 基地A: [{ name: '兵营' }, { name: '苏联兵营' }] });
    const queues = [txn({ item: '步兵班甲' }), txn({ item: '步兵班乙' })];
    const { next, events } = settleTransactions({ queues }, 0, wire(state));
    expect(next.queues.map(q => q.status)).toEqual(['active', 'active']);
    expect(events.filter(e => e.type === 'promoted')).toHaveLength(2);
  });

  it('单兵营＝人员线串行；全加速＝升格封死（队列滞留）', () => {
    const single = stateWith({ 基地A: [{ name: '兵营' }] });
    const queues = [txn({ item: '步兵班甲' }), txn({ item: '步兵班乙' })];
    const r1 = settleTransactions({ queues }, 0, wire(single));
    expect(r1.next.queues.map(q => q.status)).toEqual(['active', 'queued']);

    const allAccel = stateWith({ 基地A: [{ name: '兵营', mode: '加速' }] });
    const r2 = settleTransactions({ queues }, 0, wire(allAccel));
    expect(r2.next.queues.map(q => q.status)).toEqual(['queued', 'queued']);
  });

  it('多产线并行：人员＋陆地载具＋防御建造同基地同楼升格互不挤占', () => {
    const state = stateWith({ 基地A: [{ name: '兵营' }, { name: '战车工厂' }, { name: '建造厂核心' }] });
    const queues = [
      txn({ item: '步兵班' }),
      txn({ item: '灰熊坦克' }),
      txn({ type: '建造', item: '机枪碉堡' }),
      txn({ type: '建造', item: '发电厂' }),
    ];
    const { next } = settleTransactions({ queues }, 0, wire(state));
    expect(next.queues.map(q => q.status)).toEqual(['active', 'active', 'active', 'active']);
  });

  it('③′ 回检跟随：超编 active（双兵营退单兵营）降格 queued', () => {
    const state = stateWith({ 基地A: [{ name: '兵营' }] }); // 容量 1
    const queues = [txn({ item: '步兵班甲', status: 'active' }), txn({ item: '步兵班乙', status: 'active' })];
    const { next, events } = settleTransactions({ queues }, 0, wire(state));
    expect(next.queues.map(q => q.status)).toEqual(['active', 'queued']);
    expect(events.some(e => e.type === 'demoted' && e.item === '步兵班乙')).toBe(true);
  });

  it('调度令分组跟随 laneKey：置顶多半个同线项只在本线内重排（平移语义不变）', () => {
    const state = stateWith({ 基地A: [{ name: '兵营' }] });
    const queues = [
      txn({ item: '步兵班甲', status: 'active' }),
      txn({ item: '步兵班乙' }),
      txn({ item: '日常生活用品' }), // 兜底线，不干预人员线
    ];
    const { next } = settleTransactions({ queues }, 0, {
      ...wire(state),
      orders: [{ item: '步兵班乙', verb: '置顶' }],
    });
    // 置顶抢占：甲降格回 queued（进度保留），乙升格
    const byItem = Object.fromEntries(next.queues.map(q => [q.item, q.status]));
    expect(byItem['步兵班乙']).toBe('active');
    expect(byItem['步兵班甲']).toBe('queued');
    expect(byItem['日常生活用品']).toBe('active'); // 兜底线容量 1，正常升格
  });
});

/* ═══════════════ ⑧ 模式切换事务（§4.4 · 720 分钟校准） ═══════════════ */

describe('模式切换事务（720 分钟校准，v1 从简）', () => {
  const baseState = () => ({
    bases: [{ id: 'b1', name: '基地A', buildings: [{ name: '兵营', state: '运转', mode: '生产' as const }] }],
  });

  it('requestModeSwitch 入账 720 分钟；同建筑新指令替换旧指令；幂等指令不入账', () => {
    const s0 = baseState();
    const s1 = requestModeSwitch(s0, { base: '基地A', building: '兵营', target_mode: '加速' });
    expect(s1.pending_mode_switches).toEqual([
      { base: '基地A', building: '兵营', target_mode: '加速', remaining_minutes: MODE_SWITCH_MINUTES },
    ]);
    expect(s0.pending_mode_switches).toBeUndefined(); // 不原地修改

    const s2 = requestModeSwitch(s1, { base: '基地A', building: '兵营', target_mode: '生产' });
    expect(s2.pending_mode_switches).toHaveLength(1);
    expect(s2.pending_mode_switches?.[0].target_mode).toBe('生产');

    // 幂等：建筑已是目标模式且无在途 → 原样返回
    const s3 = requestModeSwitch(s0, { base: '基地A', building: '兵营', target_mode: '生产' });
    expect(s3).toBe(s0);
  });

  it('Δt 是唯一燃料：Δt=0 不推进；到期翻转 mode 并出账留痕', () => {
    const s0 = requestModeSwitch(baseState(), { base: '基地A', building: '兵营', target_mode: '加速' });
    const r0 = settleModeSwitches(s0, 0);
    expect(r0.next.pending_mode_switches?.[0].remaining_minutes).toBe(720);

    const r1 = settleModeSwitches(s0, 300);
    expect(r1.next.pending_mode_switches?.[0].remaining_minutes).toBe(420);
    expect(r1.next.bases?.[0].buildings?.[0].mode).toBe('生产'); // 未到期不翻转

    const r2 = settleModeSwitches(r1.next, 500); // 累计 800 > 720
    expect(r2.next.pending_mode_switches).toEqual([]);
    expect(r2.next.bases?.[0].buildings?.[0].mode).toBe('加速');
    expect(r2.events.some(e => e.type === 'mode_switch_done')).toBe(true);
  });

  it('orphan：目标建筑消失 → 出账＋留痕，不阻塞结算', () => {
    const s0 = requestModeSwitch(baseState(), { base: '基地A', building: '兵营', target_mode: '加速' });
    const gone = {
      bases: [{ id: 'b1', name: '基地A', buildings: [] }],
      pending_mode_switches: s0.pending_mode_switches,
    };
    const r = settleModeSwitches(gone, 10);
    expect(r.next.pending_mode_switches).toEqual([]);
    expect(r.events[0].type).toBe('mode_switch_orphan');
  });

  it('切换生效后容量/加速口径立即跟随（双模真源被引擎消费）', () => {
    const s0 = requestModeSwitch(baseState(), { base: '基地A', building: '兵营', target_mode: '加速' });
    const done = settleModeSwitches(s0, 720).next;
    const view: LaneStateView = { bases: done.bases };
    expect(makeProdParallelLimitFor(view)(txn({ item: '步兵班' }))).toBe(0); // 全加速＝容量 0
    expect(makeAccelEffFor(view)(txn({ item: '步兵班' }) as ProdTxnView)).toBe(1.5); // 且贡献加速
  });
});

/* ═══════════════ ⑨ laneBoard 派生视图 ═══════════════ */

describe('laneBoard 派生只读视图', () => {
  it('容量>0 的 (基地×产线) 预列；队列活动归线；兜底线承接未匹配', () => {
    const state = stateWith({ 基地A: [{ name: '兵营' }, { name: '战车工厂', mode: '加速' }] }, [
      { type: '生产', item: '步兵班', base: '基地A', status: 'active' },
      { type: '生产', item: '灰熊坦克', base: '基地A', status: 'queued' },
      { type: '生产', item: '日常生活用品', base: '基地A', status: 'queued' },
      { type: '研究', item: '基础步兵训练学', base: '基地A', status: 'active' }, // 研究不属本辖区
    ]);
    const board = laneBoard(state);
    const personnel = board.find(e => e.laneId === 'lane.personnel');
    expect(personnel).toMatchObject({ base: '基地A', capacity: 1, active: ['步兵班'], queued: 0 });
    const land = board.find(e => e.laneId === 'lane.vehicle_land');
    expect(land).toMatchObject({ capacity: 0, active: [], queued: 1 }); // 战车工厂加速中→容量 0 但有排队
    const dflt = board.find(e => e.laneId === 'lane.default');
    expect(dflt).toMatchObject({ capacity: 1, queued: 1 });
    expect(board.some(e => e.active.includes('基础步兵训练学'))).toBe(false); // 研究不进 laneBoard
  });

  it('非法显式 lane 在 board 归线时 warn 留痕（不 console）', () => {
    const warns: LaneWarn[] = [];
    const state = stateWith({}, [
      { type: '生产', item: '灰熊坦克', base: '基地A', status: 'queued', lane: 'lane.乱填' },
    ]);
    laneBoard(state, undefined, w => warns.push(w));
    expect(warns).toHaveLength(1);
    expect(warns[0].type).toBe('unknown_explicit_lane');
  });
});

/* ═══════════════ ⑩ E2b 通道B：deploy 能力面锚定消费 ═══════════════ */

describe('E2b 通道B：deploy 能力面锚定消费（批（八十四））', () => {
  /** 合成 resolver（MCV 无 <数据> 块系（八十二）登记决定，夹具不依赖世界书真数据） */
  const deployOfFixture =
    (table: Record<string, string[]>): DeployOf =>
    name =>
      table[name];

  it('capabilityCovers：精确匹配与 xxx.* 通配命中，跨命名空间/白名单↔全量互不覆盖', () => {
    expect(capabilityCovers('build.whitelist', 'build.whitelist')).toBe(true);
    expect(capabilityCovers('produce.*', 'produce.vehicle')).toBe(true);
    expect(capabilityCovers('produce.*', 'produce.*')).toBe(true);
    expect(capabilityCovers('build.whitelist', 'build.full')).toBe(false);
    expect(capabilityCovers('build.whitelist', 'research')).toBe(false);
    expect(capabilityCovers('produce.*', 'build.whitelist')).toBe(false);
    expect(capabilityCovers('produce.vehicle', 'produce.*')).toBe(false); // 细粒度不反包通配
  });

  it('deployIndexFromCatalog：以 deploy.into 聚合 capabilities，非目标 undefined，多源部署同名目标取并集', () => {
    const deployOf = deployIndexFromCatalog({
      productions: [
        { name: '前沿基地建设车', deploy: { into: '前沿工地', capabilities: ['build.whitelist'] } },
        { name: '前线战车组装车', deploy: { into: '前线战车组装场', capabilities: ['produce.*'] } },
        { name: '前线整备车', deploy: { into: '前线战车组装场', capabilities: ['produce.vehicle'] } },
        { name: '无部署块载具' },
      ],
    });
    expect(deployOf('前沿工地')).toEqual(['build.whitelist']);
    expect(new Set(deployOf('前线战车组装场'))).toEqual(new Set(['produce.*', 'produce.vehicle']));
    expect(deployOf('盟军建造厂')).toBeUndefined();
    expect(deployOf('无部署块载具')).toBeUndefined();
  });

  it('① 注入 resolver 后前沿工地（build.whitelist）挂上 lane.defense/lane.other_building', () => {
    const state = stateWith({ 基地A: [{ name: '前沿工地' }] }); // 无建造厂，通道A 不命中
    const deployOf = deployOfFixture({ 前沿工地: ['build.whitelist'] });
    const limit = makeProdParallelLimitFor(state, undefined, { deployOf });
    expect(limit(txn({ type: '建造', item: '叠合碉堡' }))).toBe(1); // lane.defense ← build.whitelist
    expect(limit(txn({ type: '建造', item: '雷达站' }))).toBe(1); // lane.other_building ← build.whitelist
    // 查无此基地 → fail-open 恒 1（既有裁量 c，与通道B 无关）
    expect(limit(txn({ type: '建造', item: '叠合碉堡', base: '基地B' }))).toBe(1);
  });

  it('①b 车族 deploy（produce.*）经通配覆盖生产线（lane.vehicle_land）', () => {
    const state = stateWith({ 基地A: [{ name: '前线战车组装场' }] });
    const deployOf = deployOfFixture({ 前线战车组装场: ['produce.*'] });
    expect(makeProdParallelLimitFor(state, undefined, { deployOf })(txn({ type: '生产', item: '轻型坦克' }))).toBe(1);
    expect(makeProdParallelLimitFor(state)(txn({ type: '生产', item: '轻型坦克' }))).toBe(0); // 未注入仍封死
  });

  it('①c lane.main 要求 build.full：前沿工地白名单不可开主建筑建造线', () => {
    const state = stateWith({ 基地A: [{ name: '前沿工地' }] });
    const deployOf = deployOfFixture({ 前沿工地: ['build.whitelist'] });
    const limit = makeProdParallelLimitFor(state, undefined, { deployOf });
    expect(limit(txn({ type: '建造', item: '建造厂核心' }))).toBe(0); // MCV 关键词→lane.main，白名单不覆盖 build.full
  });

  it('② 能力面不覆盖时仍封死（前沿工地无 produce → 生产线容量 0）；建造中状态通道B 同样不算在场', () => {
    const state = stateWith({ 基地A: [{ name: '前沿工地' }] });
    const deployOf = deployOfFixture({ 前沿工地: ['build.whitelist'] });
    expect(makeProdParallelLimitFor(state, undefined, { deployOf })(txn({ type: '生产', item: '步兵班' }))).toBe(0);
    const building = stateWith({ 基地A: [{ name: '前沿工地', state: '建造中' }] });
    expect(makeProdParallelLimitFor(building, undefined, { deployOf })(txn({ type: '建造', item: '叠合碉堡' }))).toBe(
      0,
    );
  });

  it('③ 不注入 resolver → 现状零变化（deploy 目标名不含 anchor 关键词时容量恒 0、board 不列线）', () => {
    const state = stateWith({ 基地A: [{ name: '前沿工地' }, { name: '前线战车组装场' }] });
    const limit = makeProdParallelLimitFor(state);
    expect(limit(txn({ type: '建造', item: '叠合碉堡' }))).toBe(0);
    expect(limit(txn({ type: '生产', item: '轻型坦克' }))).toBe(0);
    expect(laneBoard(state).filter(e => e.laneId !== 'lane.default')).toEqual([]);
  });

  it('laneBoard 注入 deployOf 后预列通道B 产能线（与引擎升格门同口径）', () => {
    const state = stateWith({ 基地A: [{ name: '前沿工地' }] });
    const deployOf = deployOfFixture({ 前沿工地: ['build.whitelist'] });
    const laneIds = laneBoard(state, undefined, undefined, { deployOf }).map(e => e.laneId);
    expect(laneIds).toContain('lane.defense');
    expect(laneIds).toContain('lane.other_building');
    expect(laneIds).not.toContain('lane.main'); // build.full 不覆盖
  });

  it('LANE_DEPLOY_CAPABILITY 结构性红线：无任何 lane 要求 research，研究槽不可经产线侧解锁', () => {
    expect(Object.values(LANE_DEPLOY_CAPABILITY)).not.toContain('research');
    expect(LANE_DEPLOY_CAPABILITY['lane.main']).toBe('build.full');
    expect(LANE_DEPLOY_CAPABILITY['lane.default']).toBeUndefined();
  });

  it('BUG-LIVE-27（#80楼实机复现）：prodLaneIndexFromCatalog 按 need_building 同源反推产线，使「通用履带底盘与空降轻装族」与「动员兵」分别路由至 lane.vehicle_land 与 lane.personnel 并发升格', () => {
    const laneOf = prodLaneIndexFromCatalog({
      productions: [
        {
          name: '动员兵',
          need_building: '兵营',
          need_buildings: ['兵营'],
        },
        {
          name: '通用履带底盘与空降轻装族',
          aliases: ['防空履带车', '苏联防空履带车', '履带防空车'],
          need_building: '战车工厂',
          need_buildings: ['战车工厂'],
        },
      ],
    });
    expect(laneFor(txn({ item: '动员兵' }) as ProdTxnView, laneOf)).toEqual({
      laneId: 'lane.personnel',
      matched: 'catalog',
    });
    expect(laneFor(txn({ item: '通用履带底盘与空降轻装族' }) as ProdTxnView, laneOf)).toEqual({
      laneId: 'lane.vehicle_land',
      matched: 'catalog',
    });
    expect(laneFor(txn({ item: '防空履带车' }) as ProdTxnView, laneOf)).toEqual({
      laneId: 'lane.vehicle_land',
      matched: 'catalog',
    });
  });
});

