/**
 * engineeringSlots.test.ts —— ENG-SLOT-01 验收测试
 *
 * 真源：docs/project/plans/工程玩法MVP任务包.md §3.2/§3.3；决策记录 D5-B/D10-A/D21
 * 覆盖（对照 researchSlots.test.ts / productionLanes.test.ts 版型）：
 * ① 注册表与槽映射（§3.3 显式入口 `eng:<slotId>`、fail-open 兜底）；
 * ② 锚定建筑门双通道（通道A includes／通道B deploy 能力面，建造中不算在场）；
 * ③ 属地容量=锚定建筑数（D10-A）＋引擎升格门回环（有队无道/建成升格）；
 * ④ 分流互不串道：'工程' 不进 lane.equipment、与研究槽互不串道；
 * ⑤ 多基地 theater 属地结算（D21）；⑥ engBoard 派生视图。
 */
import { describe, expect, it } from 'vitest';
import {
  ENG_DEPLOY_CAPABILITY,
  ENGINEERING_SLOT_REGISTRY,
  engBoard,
  engSlotCapacityInBase,
  engSlotFor,
  makeEngLaneKeyFor,
  makeEngParallelLimitFor,
  type EngSlotWarn,
  type EngStateView,
} from '../engines/engineeringSlots';
import { laneFor, type DeployOf } from '../engines/productionLanes';
import { lineIndexFromCatalog, makeLaneKeyFor, makeParallelLimitFor } from '../engines/researchSlots';
import { settleTransactions, type TransactionItem } from '../engines/transactionEngine';

/* ═══════════════ 测试工具 ═══════════════ */

/** 造一条工程投影事务（默认 queued，工期 1000 分钟；lane 为 §3.3 可选显式槽位） */
function txn(overrides: Partial<TransactionItem> & { lane?: string } = {}): TransactionItem & { lane?: string } {
  return {
    type: '工程',
    item: '灰熊坦克现代化改装工程·阶段一',
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
}

/** 造一个多基地最小状态视图（buildings 缺省视为运转） */
function stateWith(
  bases: Array<{ id?: string; name?: string; buildings: Array<string | BuildingSpec> }>,
  queues: TransactionItem[] = [],
): EngStateView & { queues: TransactionItem[] } {
  return {
    bases: bases.map(b => ({
      id: b.id,
      name: b.name,
      buildings: b.buildings.map(x => (typeof x === 'string' ? { name: x, state: '运转' } : { state: '运转', ...x })),
    })),
    queues,
  };
}

/** 单基地快捷形态 */
function baseA(buildings: Array<string | BuildingSpec>, queues: TransactionItem[] = []) {
  return stateWith([{ name: '基地A', buildings }], queues);
}

/** 工程槽裁决器（复刻 settleFloor 组合回调中 '工程' 分支的接线口径） */
function engAdjudicator(
  state: EngStateView,
  opts: { warnSink?: (w: EngSlotWarn) => void; deployOf?: DeployOf } = {},
) {
  return {
    laneKeyFor: makeEngLaneKeyFor(opts.warnSink),
    parallelLimitFor: makeEngParallelLimitFor(state, { warnSink: opts.warnSink, deployOf: opts.deployOf }),
  };
}

/* ═══════════════ ① 注册表与槽映射 ═══════════════ */

describe('① 注册表与槽映射（§3.2/§3.3）', () => {
  it('注册表：首槽 eng.main 保持首版定义（承接 retrofit+project 双品类），V2-02 追加 eng.orbital', () => {
    expect(ENGINEERING_SLOT_REGISTRY).toHaveLength(2);
    expect(ENGINEERING_SLOT_REGISTRY[0]).toMatchObject({
      slotId: 'eng.main',
      accepts: ['retrofit', 'project'],
    });
    expect(ENGINEERING_SLOT_REGISTRY[0].anchorNames.length).toBeGreaterThan(0);
    expect(ENGINEERING_SLOT_REGISTRY[1]).toMatchObject({ slotId: 'eng.orbital' });
  });

  it('显式 lane「eng:<slotId>」走显式入口命中；兼容裸 slotId 写法', () => {
    expect(engSlotFor(txn({ lane: 'eng:eng.main' }))).toEqual({ slotId: 'eng.main', matched: 'explicit' });
    expect(engSlotFor(txn({ lane: 'eng.main' }))).toEqual({ slotId: 'eng.main', matched: 'explicit' });
    expect(engSlotFor(txn({ lane: '  eng:eng.main  ' })).matched).toBe('explicit');
  });

  it('未注册显式 lane 兜底首槽＋结构化 warn（fail-open，不 console；V2-02 后 eng.orbital 已注册，改用未注册示例）', () => {
    const r = engSlotFor(txn({ lane: 'eng:eng.ghost' }));
    expect(r.slotId).toBe('eng.main');
    expect(r.matched).toBe('default');
    expect(r.warn).toMatchObject({ type: 'unknown_explicit_slot', lane: 'eng:eng.ghost' });
  });

  it('缺省 lane 归首槽（首版唯一槽，无歧义，不 warn）', () => {
    const r = engSlotFor(txn());
    expect(r).toEqual({ slotId: 'eng.main', matched: 'default' });
  });

  it('laneKeyFor：工程→`${base} eng:<slotId>`（base 前缀属地分组）；非工程→引擎默认键', () => {
    const keyFor = makeEngLaneKeyFor();
    expect(keyFor(txn())).toBe('基地A eng:eng.main');
    expect(keyFor(txn({ base: '基地B', lane: 'eng:eng.main' }))).toBe('基地B eng:eng.main');
    // 防御性兜底（组合回调不会送达）：逐字节等价引擎缺席行为
    expect(keyFor(txn({ type: '生产' }))).toBe('基地A 生产');
  });

  it('parallelLimitFor：非工程类型委托 baseLimitFor（缺省恒 1）', () => {
    const limitFor = makeEngParallelLimitFor(baseA([]));
    expect(limitFor(txn({ type: '生产' }))).toBe(1);
    const custom = makeEngParallelLimitFor(baseA([]), { baseLimitFor: () => 7 });
    expect(custom(txn({ type: '改装' }))).toBe(7);
  });

  it('通道B 能力面表：工程槽要求 engineer，且绝非 research/build.*/produce.*（三套注册表能力面隔离）', () => {
    expect(ENG_DEPLOY_CAPABILITY['eng.main']).toBe('engineer');
  });
});

/* ═══════════════ ② 锚定建筑门（双通道） ═══════════════ */

describe('② 锚定建筑门（§3.2 双通道）', () => {
  const slot = ENGINEERING_SLOT_REGISTRY[0];

  it('通道A：建造厂核心/盟军建造厂（阵营前缀变体）/战地维修所在场即命中', () => {
    expect(engSlotCapacityInBase(baseA(['建造厂核心']), '基地A', slot)).toBe(1);
    expect(engSlotCapacityInBase(baseA(['盟军建造厂']), '基地A', slot)).toBe(1);
    expect(engSlotCapacityInBase(baseA(['苏联建造厂']), '基地A', slot)).toBe(1);
    expect(engSlotCapacityInBase(baseA(['战地维修所']), '基地A', slot)).toBe(1);
  });

  it('建造中的锚定建筑不算在场（建成才开通，对齐 anchorPresent 口径）', () => {
    const state = baseA([{ name: '建造厂核心', state: '建造中' }, '发电厂']);
    expect(engSlotCapacityInBase(state, '基地A', slot)).toBe(0);
  });

  it('无锚定建筑 → 容量 0（未开通）', () => {
    expect(engSlotCapacityInBase(baseA(['发电厂', '矿石精炼厂']), '基地A', slot)).toBe(0);
  });

  it('通道B：deploy 能力面授予 engineer 即命中；未注入 deployOf 时恒不命中（与单通道逐字节一致）', () => {
    const state = baseA(['前沿维修驻点']);
    const deployOf: DeployOf = name => (name === '前沿维修驻点' ? ['engineer'] : undefined);
    expect(engSlotCapacityInBase(state, '基地A', slot, deployOf)).toBe(1);
    expect(engSlotCapacityInBase(state, '基地A', slot)).toBe(0);
  });

  it('通道B 隔离：research/build.full/produce.* 能力面不可解锁工程槽', () => {
    const state = baseA(['伪装驻点']);
    const deployOf: DeployOf = () => ['research', 'build.full', 'produce.vehicle'];
    expect(engSlotCapacityInBase(state, '基地A', slot, deployOf)).toBe(0);
  });
});

/* ═══════════════ ③ 属地容量=锚定建筑数（D10-A）＋引擎回环 ═══════════════ */

describe('③ 属地容量裁决与引擎升格门回环', () => {
  it('容量=该基地可运转锚定建筑数（建造厂+维修所=2，两座并行）', () => {
    const state = baseA(['建造厂核心', '战地维修所'], [
      txn({ item: '工程甲' }),
      txn({ item: '工程乙' }),
      txn({ item: '工程丙' }),
    ]);
    const r = settleTransactions(state, 60, engAdjudicator(state));
    const byItem = new Map(r.next.queues.map(q => [q.item, q.status]));
    expect(byItem.get('工程甲')).toBe('active');
    expect(byItem.get('工程乙')).toBe('active');
    expect(byItem.get('工程丙')).toBe('queued'); // 第 3 条超出属地容量滞留
    expect(r.events.filter(e => e.type === 'promoted')).toHaveLength(2);
  });

  it('未开通（无锚定建筑）：limit=0，排队保留、升格封死（有队无道）', () => {
    const state = baseA(['发电厂'], [txn()]);
    const r = settleTransactions(state, 60, engAdjudicator(state));
    expect(r.next.queues[0].status).toBe('queued');
    expect(r.events.filter(e => e.type === 'promoted')).toHaveLength(0);
  });

  it('锚定建筑建成后队首自动升格', () => {
    const state = baseA(['建造厂核心'], [txn()]);
    const r = settleTransactions(state, 60, engAdjudicator(state));
    expect(r.next.queues[0].status).toBe('active');
    expect(r.events.some(e => e.type === 'promoted')).toBe(true);
  });

  it('基地不可解析：有基地快照（bases.length > 0）时不存在基地返回 0（防幽灵基地白嫖并行度）；仅无基地快照（bases.length === 0）时兜底返回 1', () => {
    const state = baseA([]);
    const limitFor = makeEngParallelLimitFor(state);
    expect(limitFor(txn({ base: '' }))).toBe(0);
    expect(limitFor(txn({ base: '不存在的基地' }))).toBe(0);

    const emptyBasesState = stateWith([]);
    const fallbackLimitFor = makeEngParallelLimitFor(emptyBasesState);
    expect(fallbackLimitFor(txn({ base: '' }))).toBe(1);
    expect(fallbackLimitFor(txn({ base: '不存在的基地' }))).toBe(1);
  });
});

/* ═══════════════ ④ 分流互不串道 ═══════════════ */

describe("④ 裁决分流：'工程' 不进 lane.equipment、与研究槽互不串道（D5-B）", () => {
  it("产线 laneFor 对 '工程' 无推导表命中（不落 lane.equipment）；分流接缝保证其永不送达产线", () => {
    // 防御性事实锁定：即便误达 laneFor，'工程' 也只落 lane.default 兜底，绝不进 lane.equipment（改装专属推导仅限 type==='改装'）
    expect(laneFor({ type: '工程', item: '灰熊坦克现代化改装工程', base: '基地A' }).laneId).toBe('lane.default');
    expect(laneFor({ type: '改装', item: '灰熊坦克现代化改装工程', base: '基地A' }).laneId).toBe('lane.equipment');
  });

  it('组合分流键三分天下：研究→research:*／工程→`${base} eng:*`／生产→产线键，互不相同', () => {
    const engKeyFor = makeEngLaneKeyFor();
    const researchKeyFor = makeLaneKeyFor(lineIndexFromCatalog([{ name: '基础步兵训练学', line: '主建筑' }]));
    const seamKeyFor = (t: TransactionItem & { lane?: string }) =>
      t.type === '研究' ? researchKeyFor(t) : t.type === '工程' ? engKeyFor(t) : `${t.base} ${t.type}`;
    const researchKey = seamKeyFor(txn({ type: '研究', item: '基础步兵训练学' }));
    const engKey = seamKeyFor(txn());
    expect(researchKey).toBe('research:slot.main');
    expect(engKey).toBe('基地A eng:eng.main');
    expect(researchKey).not.toBe(engKey);
  });

  it('引擎回环互不串道：研究占研究槽不占工程槽，工程占工程槽不占研究槽（同基地并发各自升格）', () => {
    // 基地有建造厂核心（研究 slot.main 与工程 eng.main 共用锚点——锚点同源但槽位互不复用）
    const state = baseA(['建造厂核心'], [
      txn({ type: '研究', item: '基础步兵训练学' }),
      txn({ item: '工程甲' }),
      txn({ item: '工程乙' }), // 工程容量=1（仅一座锚定建筑），第二条滞留
    ]);
    const lineOf = lineIndexFromCatalog([{ name: '基础步兵训练学', line: '主建筑' }]);
    const researchKeyFor = makeLaneKeyFor(lineOf);
    const engKeyFor = makeEngLaneKeyFor();
    const researchLimitFor = makeParallelLimitFor(state, lineOf);
    const engLimitFor = makeEngParallelLimitFor(state);
    const r = settleTransactions(state, 60, {
      laneKeyFor: t => (t.type === '研究' ? researchKeyFor(t) : t.type === '工程' ? engKeyFor(t) : `${t.base} ${t.type}`),
      parallelLimitFor: t =>
        t.type === '研究' ? researchLimitFor(t) : t.type === '工程' ? engLimitFor(t as TransactionItem & { lane?: string }) : 1,
    });
    const byItem = new Map(r.next.queues.map(q => [q.item, q.status]));
    expect(byItem.get('基础步兵训练学')).toBe('active'); // 研究槽升格不被工程队列阻塞
    expect(byItem.get('工程甲')).toBe('active'); // 工程槽升格不被研究在编占用
    expect(byItem.get('工程乙')).toBe('queued'); // 工程属地容量=1，独立计数
  });
});

/* ═══════════════ ⑤ 多基地 theater 属地结算（D21） ═══════════════ */

describe('⑤ 多基地 theater：属地容量按各基地锚定建筑独立结算', () => {
  const slot = ENGINEERING_SLOT_REGISTRY[0];

  it('容量裁决函数按基地查询：A 基地两座锚定=2，B 基地一座=1，C 基地零座=0', () => {
    const state = stateWith([
      { name: '基地A', buildings: ['建造厂核心', '战地维修所'] },
      { name: '基地B', buildings: ['盟军建造厂'] },
      { name: '基地C', buildings: ['发电厂'] },
    ]);
    expect(engSlotCapacityInBase(state, '基地A', slot)).toBe(2);
    expect(engSlotCapacityInBase(state, '基地B', slot)).toBe(1);
    expect(engSlotCapacityInBase(state, '基地C', slot)).toBe(0);
  });

  it('基地按 id 或名解析（id 优先精确匹配）', () => {
    const state = stateWith([{ id: 'base-01', name: '主基地', buildings: ['建造厂核心'] }]);
    expect(engSlotCapacityInBase(state, 'base-01', slot)).toBe(1);
    expect(engSlotCapacityInBase(state, '主基地', slot)).toBe(1);
  });

  it('引擎回环：各阶段投影项按各自 base 占用属地槽容量，跨基地互不挤压', () => {
    const state = stateWith(
      [
        { name: '基地A', buildings: ['建造厂核心'] }, // 容量 1
        { name: '基地B', buildings: ['战地维修所'] }, // 容量 1
        { name: '基地C', buildings: ['发电厂'] }, // 容量 0
      ],
      [
        txn({ item: '阶段甲', base: '基地A' }),
        txn({ item: '阶段乙', base: '基地B' }),
        txn({ item: '阶段丙', base: '基地C' }), // C 无锚定→滞留
        txn({ item: '阶段丁', base: '基地A' }), // A 容量已满→滞留
      ],
    );
    const r = settleTransactions(state, 60, engAdjudicator(state));
    const byItem = new Map(r.next.queues.map(q => [q.item, q.status]));
    expect(byItem.get('阶段甲')).toBe('active');
    expect(byItem.get('阶段乙')).toBe('active'); // 属地容量互不吃占（若 laneKey 缺 base 前缀，A/B 会互挤串道）
    expect(byItem.get('阶段丙')).toBe('queued');
    expect(byItem.get('阶段丁')).toBe('queued');
  });
});

/* ═══════════════ ⑥ engBoard 派生只读视图 ═══════════════ */

describe('⑥ engBoard：属地派生视图', () => {
  it('容量>0 的 (基地×槽) 预列；工程活动归槽；非工程事务不入板', () => {
    const state = stateWith(
      [
        { name: '基地A', buildings: ['建造厂核心', '战地维修所'] },
        { name: '基地B', buildings: ['发电厂'] },
      ],
      [
        { ...txn({ item: '工程甲', base: '基地A' }), status: 'active' },
        txn({ item: '工程乙', base: '基地A' }),
        txn({ type: '研究', item: '基础步兵训练学', base: '基地A' }),
        txn({ type: '生产', item: '灰熊坦克', base: '基地A' }),
      ],
    );
    const board = engBoard(state);
    expect(board).toHaveLength(1); // 仅基地A容量>0
    expect(board[0]).toMatchObject({
      slotId: 'eng.main',
      base: '基地A',
      capacity: 2,
      active: ['工程甲'],
      queued: 1,
    });
  });

  it('容量 0 但有工程活动的基地仍列板（有队无道可见性），非法显式 lane 留痕不 console', () => {
    const warns: EngSlotWarn[] = [];
    const state = stateWith(
      [{ name: '基地B', buildings: ['发电厂'] }],
      [txn({ item: '工程丙', base: '基地B', lane: 'eng:eng.ghost' })],
    );
    const board = engBoard(state, w => warns.push(w));
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ base: '基地B', capacity: 0, queued: 1 });
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ type: 'unknown_explicit_slot', item: '工程丙' });
  });
});

/* ═══════════════ ⑦ eng.orbital 轨道组装泊位（V2-02 / D-C4） ═══════════════ */

describe('⑦ eng.orbital 注册项（V2-02）', () => {
  const orbital = ENGINEERING_SLOT_REGISTRY[1];
  const main = ENGINEERING_SLOT_REGISTRY[0];

  it('注册项结构合法：四字段齐全，锚定词表全部为世界书实况建筑名（禁发明）', () => {
    expect(orbital).toEqual({
      slotId: 'eng.orbital',
      name: '轨道组装泊位',
      anchor: '航天发射中心/发射场系',
      // 出处：通用·航天工业 uid4（航天发射中心/海上发射平台）、通用·主建筑 uid17/uid23/uid29
      anchorNames: ['航天发射中心', '海上发射平台', '大型航天发射综合体', '山体发射场', '巨型航天发射港'],
      accepts: ['project'],
    });
    // 通道B 能力面：同 engineer 命名空间，仍非 research/build.*/produce.*（三套注册表能力面隔离红线）
    expect(ENG_DEPLOY_CAPABILITY['eng.orbital']).toBe('engineer');
  });

  it('锚定判定（通道A）：五处发射台系实况名命中；阵营前缀变体兼容；导弹类「发射井/发射车」不误命中', () => {
    for (const name of ['航天发射中心', '海上发射平台', '大型航天发射综合体', '山体发射场', '巨型航天发射港']) {
      expect(engSlotCapacityInBase(baseA([name]), '基地A', orbital)).toBe(1);
    }
    // includes 语义兼容前缀变体（对齐 eng.main 盟军/苏联建造厂先例）
    expect(engSlotCapacityInBase(baseA(['盟军航天发射中心']), '基地A', orbital)).toBe(1);
    // 词表刻意避开导弹发射设施（见文件头裁量 f）：发射井群/发射车/机动发射平台均不计容量
    expect(
      engSlotCapacityInBase(baseA(['超深层高加固地下发射井群', 'TEL机动发射车', '机动发射平台支援区']), '基地A', orbital),
    ).toBe(0);
  });

  it('与 eng.main 容量互不混淆：建造厂系只给 eng.main 容量、发射台系只给 eng.orbital 容量', () => {
    const state = baseA(['建造厂核心', '航天发射中心']);
    expect(engSlotCapacityInBase(state, '基地A', main)).toBe(1); // 建造厂核心归 eng.main
    expect(engSlotCapacityInBase(state, '基地A', orbital)).toBe(1); // 航天发射中心归 eng.orbital
    const onlyFactory = baseA(['建造厂核心']);
    expect(engSlotCapacityInBase(onlyFactory, '基地A', orbital)).toBe(0);
    const onlyPad = baseA(['航天发射中心']);
    expect(engSlotCapacityInBase(onlyPad, '基地A', main)).toBe(0);
  });

  it('容量语义同 eng.main 口径：属地可运转锚定建筑数，「建造中」不计；多座累计', () => {
    expect(engSlotCapacityInBase(baseA([{ name: '航天发射中心', state: '建造中' }]), '基地A', orbital)).toBe(0);
    expect(
      engSlotCapacityInBase(baseA(['航天发射中心', '山体发射场', '战地维修所']), '基地A', orbital),
    ).toBe(2); // 仅两座发射台系计入，维修所归 eng.main 锚定词表
  });

  it('显式 lane 解析：eng:eng.orbital / 裸 eng.orbital 均显式命中；laneKey 分道不串', () => {
    expect(engSlotFor(txn({ lane: 'eng:eng.orbital' }))).toEqual({ slotId: 'eng.orbital', matched: 'explicit' });
    expect(engSlotFor(txn({ lane: 'eng.orbital' }))).toEqual({ slotId: 'eng.orbital', matched: 'explicit' });
    const keyFor = makeEngLaneKeyFor();
    expect(keyFor(txn({ lane: 'eng:eng.orbital' }))).toBe('基地A eng:eng.orbital');
  });

  it('升格门回环：轨道泊位事务按 eng.orbital 属地容量放票，与 eng.main 事务互不挤压', () => {
    const state = stateWith(
      [
        { name: '基地A', buildings: ['建造厂核心', '航天发射中心'] }, // 各槽容量均为 1
      ],
      [
        txn({ item: '舱段甲', base: '基地A', lane: 'eng:eng.orbital' }),
        txn({ item: '舱段乙', base: '基地A', lane: 'eng:eng.orbital' }), // 轨道泊位容量 1 → 滞留
        txn({ item: '阶段甲', base: '基地A', lane: 'eng:eng.main' }), // eng.main 容量另计 → 放行
      ],
    );
    const r = settleTransactions(state, 60, engAdjudicator(state));
    const byItem = new Map(r.next.queues.map(q => [q.item, q.status]));
    expect(byItem.get('舱段甲')).toBe('active');
    expect(byItem.get('舱段乙')).toBe('queued');
    expect(byItem.get('阶段甲')).toBe('active');
  });

  it('engBoard：两槽并列出板（容量>0 的 (基地×槽) 预列，互不吞并）', () => {
    const state = stateWith([{ name: '基地A', buildings: ['建造厂核心', '航天发射中心'] }]);
    const board = engBoard(state);
    expect(board).toHaveLength(2);
    expect(board.find(e => e.slotId === 'eng.main')).toMatchObject({ base: '基地A', capacity: 1 });
    expect(board.find(e => e.slotId === 'eng.orbital')).toMatchObject({ base: '基地A', capacity: 1, active: [] });
  });
});
