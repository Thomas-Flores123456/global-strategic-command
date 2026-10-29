/**
 * researchSlots.test.ts —— CTRL-RSLOT-IMPL-01 验收测试
 *
 * 真源：docs/design/systems/科技研究槽总设计案.md §7 验收合同
 * 覆盖：① 注册表全表；② 开通门；③ 双层门；④ 接缝恒等；⑤ 报文回环；⑥ 调度令槽内语义
 */
import { describe, expect, it } from 'vitest';
import { RESEARCHES } from '../core/catalog';
import { parseMessageText } from '../parse/parsePipeline';
import {
  GLOBAL_RESEARCH_LIMITS,
  lineIndexFromCatalog,
  makeGlobalLimitFor,
  makeLaneKeyFor,
  makeParallelLimitFor,
  MECHA_RESEARCH_NAMES,
  SLOT_REGISTRY,
  slotBoard,
  slotFor,
  techTier,
  type SlotStateView,
  type SlotWarn,
} from '../engines/researchSlots';
import { Schema } from '../core/schema';
import { settleTransactions, type TransactionItem } from '../engines/transactionEngine';

/* ═══════════════ 测试工具 ═══════════════ */

/** 造一条 v2 全字段事务（默认 queued 研究，工期 1000 分钟） */
function txn(overrides: Partial<TransactionItem> = {}): TransactionItem {
  return {
    type: '研究',
    item: '测试研究',
    base: '',
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

/** 造一个带建筑的最小状态视图 */
function stateWith(buildings: string[], queues: TransactionItem[] = []): SlotStateView & { queues: TransactionItem[] } {
  return {
    bases: [{ buildings: buildings.map(name => ({ name, state: '运转' })) }],
    queues,
  };
}

/** 测试用 line 查找表（不依赖 catalog，便于造农畜业/环保/机娘等 catalog 外研究） */
const TEST_LINES: Record<string, string> = {
  基础步兵训练学: '主建筑',
  基础化工学: '工业基础',
  战场医疗工学: '防御辅助',
  机动侦察工学: '陆地载具',
  制空权学说: '空中载具',
  水面作战舰艇学: '水面舰艇',
  军犬行为工程学: '人员',
  光学瞄准工学: '装备',
  基础水培农业: '农畜业',
  畜牧集成学: '农畜业',
  基础环境工程学: '环保与公共设施',
  废弃电子回收学: '环保与公共设施',
  火箭推进基础工学: '航天工业',
  拟态全息工学: '盟军特色',
  磁暴线圈工学: '苏联特色',
  相变微流道散热工学: '机娘保障工程线缺line字段——不该经此表命中',
};
const testLineOf = (name: string): string | undefined => (name === '相变微流道散热工学' ? undefined : TEST_LINES[name]);

/** 三回调裁决器全家桶（快捷组装） */
function adjudicator(state: SlotStateView, opts: { warnSink?: (w: SlotWarn) => void; tier?: 1 | 2 | 3 } = {}) {
  return {
    laneKeyFor: makeLaneKeyFor(testLineOf, opts.warnSink),
    parallelLimitFor: makeParallelLimitFor(state, testLineOf, { warnSink: opts.warnSink }),
    globalLimitFor: makeGlobalLimitFor(state, opts.tier ? { techTierOf: () => opts.tier! } : {}),
  };
}

/** 全 11 槽锚定建筑齐备的建筑清单（全部开通） */
const ALL_ANCHORS = [
  '建造厂核心',
  '矿石精炼厂',
  '兵营',
  '战车工厂',
  '个人装备制造所', // slot.equipment 锚点（裁决 A：由合成工坊归位；裸名经 anchorNames includes 匹配覆盖）
  '小型纳米合成工坊',
  '生态副食与水循环保障站',
  '基础废物分拣站',
  '航天发射中心',
  '机娘接口设施',
];

/* ═══════════════ ① 注册表全表（§7.1） ═══════════════ */

describe('① 注册表：11 槽、12 line 全覆盖', () => {
  it('SLOT_REGISTRY 恰好 11 槽，槽 ID 无重复，容量全 1', () => {
    expect(SLOT_REGISTRY).toHaveLength(11);
    const ids = SLOT_REGISTRY.map(s => s.slotId);
    expect(new Set(ids).size).toBe(11);
    expect(SLOT_REGISTRY.every(s => s.capacity === 1)).toBe(true);
  });

  it('12 条已知 line（catalog 10 ＋ 农畜业/环保世界书 2）全覆盖，无一兜底', () => {
    const lines = [
      '主建筑',
      '工业基础',
      '防御辅助',
      '陆地载具',
      '空中载具',
      '水面舰艇',
      '人员',
      '装备',
      '盟军特色',
      '航天工业',
      '农畜业',
      '环保与公共设施',
    ];
    for (const line of lines) {
      const r = slotFor(line);
      expect(r.matched, `line=${line}`).not.toBe('fallback');
      expect(r.warn).toBeUndefined();
    }
  });

  it('catalog 全量 156 项研究的 line 全部入表（真实目录回环，零兜底）', () => {
    for (const research of RESEARCHES) {
      const r = slotFor(research.line);
      expect(r.matched, `${research.name} line=${research.line}`).not.toBe('fallback');
    }
  });

  it('三军载具三线（陆/空/海）同槽 slot.vehicle', () => {
    expect(slotFor('陆地载具').slotId).toBe('slot.vehicle');
    expect(slotFor('空中载具').slotId).toBe('slot.vehicle');
    expect(slotFor('水面舰艇').slotId).toBe('slot.vehicle');
  });

  it('农畜业/环保先例线各自独占专属槽（不可推翻只可承接）', () => {
    expect(slotFor('农畜业').slotId).toBe('slot.agri');
    expect(slotFor('环保与公共设施').slotId).toBe('slot.eco');
  });

  it('阵营特色线经「XX特色」前缀归 slot.faction（盟军直表＋苏联/尤里前缀）', () => {
    expect(slotFor('盟军特色')).toMatchObject({ slotId: 'slot.faction', matched: 'line' });
    expect(slotFor('苏联特色')).toMatchObject({ slotId: 'slot.faction', matched: 'faction-pattern' });
    expect(slotFor('尤里特色')).toMatchObject({ slotId: 'slot.faction', matched: 'faction-pattern' });
  });

  it('机娘保障工程线登记在表；无 line 字段的 9 项研究按名单枚举兜底进 slot.mecha', () => {
    expect(slotFor('机娘保障工程').slotId).toBe('slot.mecha');
    expect(MECHA_RESEARCH_NAMES).toHaveLength(9);
    for (const name of MECHA_RESEARCH_NAMES) {
      expect(slotFor(name)).toMatchObject({ slotId: 'slot.mecha', matched: 'mecha-name' });
    }
  });

  it('未注册 line 兜底 slot.main ＋结构化 warn 留痕（fail-open，不 console）', () => {
    const r = slotFor('量子玄学');
    expect(r.slotId).toBe('slot.main');
    expect(r.matched).toBe('fallback');
    expect(r.warn).toMatchObject({ type: 'unregistered_line', line: '量子玄学' });
  });

  it('laneKeyFor 对未注册研究产出 warn 并落 slot.main lane；warnSink 收集不 console', () => {
    const warns: SlotWarn[] = [];
    const laneKeyFor = makeLaneKeyFor(testLineOf, w => warns.push(w));
    const key = laneKeyFor(txn({ item: '不存在的黑科技' }));
    expect(key).toBe('research:slot.main');
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ type: 'unregistered_line', item: '不存在的黑科技' });
  });
});

/* ═══════════════ ② 开通门（§7.2 混合开通制） ═══════════════ */

describe('② 开通门：锚定建筑在场检测', () => {
  it('锚定建筑不在场：limit=0，排队保留、升格封死', () => {
    const state = stateWith([], [txn({ item: '机动侦察工学' })]); // 无战车工厂
    const r = settleTransactions(state, 60, adjudicator(state));
    expect(r.next.queues[0].status).toBe('queued'); // 有队无道
    expect(r.events.filter(e => e.type === 'promoted')).toHaveLength(0);
  });

  it('锚定建筑建成后队首自动升格', () => {
    const state = stateWith(['战车工厂'], [txn({ item: '机动侦察工学' })]);
    const r = settleTransactions(state, 60, adjudicator(state));
    expect(r.next.queues[0].status).toBe('active');
    expect(r.events.some(e => e.type === 'promoted' && e.item === '机动侦察工学')).toBe(true);
  });

  it('建造中的锚定建筑不算在场（建成才开通）', () => {
    const state: SlotStateView & { queues: TransactionItem[] } = {
      bases: [{ buildings: [{ name: '战车工厂', state: '建造中' }] }],
      queues: [txn({ item: '机动侦察工学' })],
    };
    const r = settleTransactions(state, 60, adjudicator(state));
    expect(r.next.queues[0].status).toBe('queued');
  });

  it('阵营前缀兼容：「苏联兵营」满足 slot.defense/personnel 的锚定「兵营」', () => {
    const state = stateWith(['苏联兵营'], [txn({ item: '战场医疗工学' }), txn({ item: '军犬行为工程学' })]);
    const r = settleTransactions(state, 60, adjudicator(state));
    // 防御辅助与人员分属两槽，各自开通各升 1
    expect(r.next.queues.every(q => q.status === 'active')).toBe(true);
  });

  it('装备槽锚定「个人装备制造所」直接开通（裁决 A：锚点由合成工坊归位）', () => {
    const closed = stateWith(['小型纳米合成工坊'], [txn({ item: '光学瞄准工学' })]);
    expect(settleTransactions(closed, 60, adjudicator(closed)).next.queues[0].status).toBe('queued');
    const open = stateWith(['个人装备制造所'], [txn({ item: '光学瞄准工学' })]);
    expect(settleTransactions(open, 60, adjudicator(open)).next.queues[0].status).toBe('active');
  });

  it('农畜业/环保先例槽的锚定建筑各自独立开通', () => {
    const agriOnly = stateWith(
      ['生态副食与水循环保障站'],
      [txn({ item: '基础水培农业' }), txn({ item: '基础环境工程学' })],
    );
    const r = settleTransactions(agriOnly, 60, adjudicator(agriOnly));
    const byItem = Object.fromEntries(r.next.queues.map(q => [q.item, q.status]));
    expect(byItem['基础水培农业']).toBe('active'); // 农畜业槽已开通
    expect(byItem['基础环境工程学']).toBe('queued'); // 环保槽无分拣站，冻结
  });

  it('非研究事务不受开通门影响（委托现行规则恒 1）', () => {
    const state = stateWith([], [txn({ type: '生产', item: '灰熊坦克', base: 'alpha' })]);
    const r = settleTransactions(state, 60, adjudicator(state));
    expect(r.next.queues[0].status).toBe('active');
  });
});

/* ═══════════════ ③ 双层门（§7.3/§7.4） ═══════════════ */

describe('③ 双层门：全局 tier 门 × 槽内恒 1', () => {
  it('GLOBAL_RESEARCH_LIMITS 合同：T1=2／T2=4／T3=Infinity', () => {
    expect(GLOBAL_RESEARCH_LIMITS[1]).toBe(2);
    expect(GLOBAL_RESEARCH_LIMITS[2]).toBe(4);
    expect(GLOBAL_RESEARCH_LIMITS[3]).toBe(Infinity);
  });

  it('techTier：默认 T1；战斗实验室/盟军战斗实验室/红星实验设计局综合体→T2；建造中不算', () => {
    expect(techTier(stateWith([]))).toBe(1);
    expect(techTier(stateWith(['战斗实验室']))).toBe(2);
    expect(techTier(stateWith(['盟军战斗实验室']))).toBe(2);
    expect(techTier(stateWith(['红星实验设计局综合体']))).toBe(2);
    expect(makeGlobalLimitFor(stateWith(['红星实验设计局综合体']))('研究')).toBe(4);
    expect(techTier({ bases: [{ buildings: [{ name: '战斗实验室', state: '建造中' }] }] })).toBe(1);
    expect(techTier({ bases: [{ buildings: [{ name: '红星实验设计局综合体', state: '建造中' }] }] })).toBe(1);
  });

  it('techTier（D-P26）：红星科学城/盟军联合科研节点/量子超算中心→T3；先扫到T2建筑不早退漏判T3', () => {
    expect(techTier(stateWith(['国家战略工程综合体']))).toBe(3);
    expect(techTier(stateWith(['红星科学城']))).toBe(3);
    expect(techTier(stateWith(['国家战略工程综合体／红星科学城']))).toBe(3);
    expect(techTier(stateWith(['盟军联合科研与国家工程组织节点']))).toBe(3);
    expect(techTier(stateWith(['量子超算中心']))).toBe(3);
    expect(makeGlobalLimitFor(stateWith(['国家战略工程综合体']))('研究')).toBe(Infinity);
    expect(makeGlobalLimitFor(stateWith(['红星科学城']))('研究')).toBe(Infinity);
    expect(makeGlobalLimitFor(stateWith(['盟军联合科研与国家工程组织节点']))('研究')).toBe(Infinity);
    expect(makeGlobalLimitFor(stateWith(['量子超算中心']))('研究')).toBe(Infinity);
    // 回归：先存在 T2 战斗实验室/红星设计局，后存在 T3 红星科学城，必须返回 3 而非早退返回 2
    expect(techTier(stateWith(['战斗实验室', '红星实验设计局综合体', '国家战略工程综合体／红星科学城']))).toBe(3);
    expect(makeGlobalLimitFor(stateWith(['战斗实验室', '红星科学城']))('研究')).toBe(Infinity);
    // T3 建筑建造中但 T2 已建成 → 返回 2
    expect(
      techTier({
        bases: [
          {
            buildings: [
              { name: '红星实验设计局综合体', state: '运转' },
              { name: '国家战略工程综合体／红星科学城', state: '建造中' },
            ],
          },
        ],
      }),
    ).toBe(2);
  });

  it('T3（真实建筑红星科学城在场，无需注入 techTierOf）：全局不限，6 项研究同升 active', () => {
    const state = stateWith(
      [...ALL_ANCHORS, '红星实验设计局综合体', '国家战略工程综合体／红星科学城'],
      [
        txn({ item: '基础步兵训练学' }),
        txn({ item: '机动侦察工学' }),
        txn({ item: '基础化工学' }),
        txn({ item: '基础水培农业' }),
        txn({ item: '火箭推进基础工学' }),
        txn({ item: '相变微流道散热工学' }),
      ],
    );
    const r = settleTransactions(state, 60, adjudicator(state));
    expect(r.next.queues.every(q => q.status === 'active')).toBe(true);
  });

  it('T1：三槽全开通也只升 2 项，第 3 项留 queued（全局门锁）', () => {
    const state = stateWith(ALL_ANCHORS, [
      txn({ item: '基础步兵训练学' }), // slot.main
      txn({ item: '机动侦察工学' }), // slot.vehicle
      txn({ item: '基础化工学' }), // slot.industry
    ]);
    const r = settleTransactions(state, 60, adjudicator(state));
    const statuses = r.next.queues.map(q => q.status);
    expect(statuses.filter(s => s === 'active')).toHaveLength(2);
    expect(r.next.queues[2].status).toBe('queued'); // 数组序先到先得，第 3 项被全局门拦下
  });

  it('T2（战斗实验室在场）：全局门放宽至 4，第 5 项留 queued', () => {
    const state = stateWith(
      [...ALL_ANCHORS, '战斗实验室'],
      [
        txn({ item: '基础步兵训练学' }), // slot.main
        txn({ item: '机动侦察工学' }), // slot.vehicle
        txn({ item: '基础化工学' }), // slot.industry
        txn({ item: '基础水培农业' }), // slot.agri
        txn({ item: '火箭推进基础工学' }), // slot.aerospace
      ],
    );
    const r = settleTransactions(state, 60, adjudicator(state));
    expect(r.next.queues.filter(q => q.status === 'active')).toHaveLength(4);
    expect(r.next.queues[4].status).toBe('queued');
  });

  it('T3（注入 techTierOf）：全局不限，受开通槽数天然封顶', () => {
    const state = stateWith(ALL_ANCHORS, [
      txn({ item: '基础步兵训练学' }),
      txn({ item: '机动侦察工学' }),
      txn({ item: '基础化工学' }),
      txn({ item: '基础水培农业' }),
      txn({ item: '火箭推进基础工学' }),
      txn({ item: '相变微流道散热工学' }), // slot.mecha 名单枚举兜底
    ]);
    const r = settleTransactions(state, 60, adjudicator(state, { tier: 3 }));
    expect(r.next.queues.every(q => q.status === 'active')).toBe(true);
  });

  it('槽内恒 1：同槽第 2 项永不与第 1 项同时 active（三军载具跨线同槽）', () => {
    const state = stateWith(ALL_ANCHORS, [
      txn({ item: '机动侦察工学' }), // 陆地载具 → slot.vehicle
      txn({ item: '制空权学说' }), // 空中载具 → 同槽
      txn({ item: '水面作战舰艇学' }), // 水面舰艇 → 同槽
    ]);
    const r = settleTransactions(state, 60, adjudicator(state, { tier: 3 }));
    expect(r.next.queues[0].status).toBe('active');
    expect(r.next.queues[1].status).toBe('queued');
    expect(r.next.queues[2].status).toBe('queued');
  });

  it('农畜业/环保先例线：线内串行上限 1 回归断言', () => {
    const state = stateWith(ALL_ANCHORS, [
      txn({ item: '基础水培农业' }),
      txn({ item: '畜牧集成学' }), // 同农畜业槽
      txn({ item: '基础环境工程学' }),
      txn({ item: '废弃电子回收学' }), // 同环保槽
    ]);
    const r = settleTransactions(state, 60, adjudicator(state, { tier: 3 }));
    const byItem = Object.fromEntries(r.next.queues.map(q => [q.item, q.status]));
    expect(byItem['基础水培农业']).toBe('active');
    expect(byItem['畜牧集成学']).toBe('queued');
    expect(byItem['基础环境工程学']).toBe('active');
    expect(byItem['废弃电子回收学']).toBe('queued');
  });

  it('研究跨基地同槽仍串行（研究 lane 与 base 解耦）', () => {
    const state = stateWith(ALL_ANCHORS, [
      txn({ item: '机动侦察工学', base: 'alpha' }),
      txn({ item: '制空权学说', base: 'beta' }),
    ]);
    const r = settleTransactions(state, 60, adjudicator(state, { tier: 3 }));
    expect(r.next.queues[0].status).toBe('active');
    expect(r.next.queues[1].status).toBe('queued'); // 不因 base 不同而开双道
  });

  it('全局门只管研究：生产/建造不受 globalLimitFor 影响（Infinity）', () => {
    const state = stateWith(ALL_ANCHORS, [
      txn({ item: '基础步兵训练学' }),
      txn({ item: '机动侦察工学' }),
      txn({ type: '生产', item: '灰熊坦克', base: 'alpha' }),
      txn({ type: '建造', item: '盟军围墙', base: 'alpha' }),
    ]);
    const r = settleTransactions(state, 60, adjudicator(state)); // T1 全局研究门=2
    expect(r.next.queues.every(q => q.status === 'active')).toBe(true); // 2 研究＋2 非研究全升
  });
});

/* ═══════════════ ④ 接缝恒等（§7.5） ═══════════════ */

describe('④ 接缝恒等：不注入回调时行为零变化', () => {
  it('显式注入默认恒等回调（base+type lane ＋ Infinity 全局）与不注入结果全等', () => {
    const queues = [
      txn({ type: '生产', item: 'A', base: 'x', status: 'active', spent_minutes: 100 }),
      txn({ type: '生产', item: 'B', base: 'x' }),
      txn({ type: '研究', item: 'R1' }),
      txn({ type: '研究', item: 'R2' }),
      txn({ type: '建造', item: 'C', base: 'y', hold: true }),
    ];
    const bare = settleTransactions({ queues }, 120, { now: '第1日 08:00' });
    const explicitDefaults = settleTransactions({ queues }, 120, {
      now: '第1日 08:00',
      laneKeyFor: t => `${t.base}\u0000${t.type}`,
      globalLimitFor: () => Infinity,
    });
    expect(explicitDefaults.next).toStrictEqual(bare.next);
    expect(explicitDefaults.events).toStrictEqual(bare.events);
  });

  it('默认路径下研究仍按 base+type 单 lane（现行"全局单研究槽"行为保真）', () => {
    const queues = [txn({ item: 'R1' }), txn({ item: 'R2' })];
    const r = settleTransactions({ queues }, 0, {});
    expect(r.next.queues[0].status).toBe('active');
    expect(r.next.queues[1].status).toBe('queued'); // 默认恒 1，未分槽
  });

  it('注入 laneKeyFor 后非研究事务 laneKey 仍走默认通道（逐字节零变化）', () => {
    const laneKeyFor = makeLaneKeyFor(testLineOf);
    expect(laneKeyFor(txn({ type: '生产', item: '灰熊坦克', base: 'alpha' }))).toBe('alpha\u0000生产');
    expect(laneKeyFor(txn({ type: '建造', item: '围墙', base: 'beta' }))).toBe('beta\u0000建造');
    expect(laneKeyFor(txn({ type: '研究', item: '机动侦察工学' }))).toBe('research:slot.vehicle');
  });

  it('globalLimitFor 默认 Infinity：parallelLimitFor 放宽时多项同 lane 可并行（现行语义）', () => {
    const queues = [txn({ item: 'R1' }), txn({ item: 'R2' }), txn({ item: 'R3' })];
    const r = settleTransactions({ queues }, 0, { parallelLimitFor: () => 3 });
    expect(r.next.queues.every(q => q.status === 'active')).toBe(true);
  });
});

/* ═══════════════ ⑤ 报文回环（§7.6 零变化） ═══════════════ */

describe('⑤ <队列> 研究报文 parsePipeline→裁决器→引擎全链路回环', () => {
  it('现行研究报文格式零变化直通裁决器与引擎，不新增槽位字段（F7：出生即 queued，升格统一走带宽门）', () => {
    const baseline = Schema.parse({
      bases: [{ id: 'alpha-id', name: '北坡基地', buildings: [{ name: '战车工厂', state: '运转' }] }],
    });
    const parsed = parseMessageText(
      '<战况>\n队列:\n  - 项目: 机动侦察工学\n    类型: 研究\n    基地: 北坡基地\n</战况>',
      baseline,
      {},
    );
    expect(parsed.applied).toBe(true);
    const queued = parsed.data.queues[0];
    expect(queued).toMatchObject({ type: '研究', item: '机动侦察工学', status: 'queued' }); // F7：出生即排队
    expect(Object.keys(queued)).not.toContain('slot'); // 报文与变量树均无槽位字段

    // 裁决器消费 parsePipeline 产物（真实 catalog line 索引），引擎结算升格——不再需要人工先置 queued
    const lineOf = lineIndexFromCatalog(RESEARCHES);
    const r = settleTransactions(parsed.data, 60, {
      laneKeyFor: makeLaneKeyFor(lineOf),
      parallelLimitFor: makeParallelLimitFor(parsed.data, lineOf),
      globalLimitFor: makeGlobalLimitFor(parsed.data),
    });
    expect(r.next.queues[0].status).toBe('active'); // 战车工厂在场，载具槽开通
    expect(Object.keys(r.next.queues[0]).sort()).toEqual(Object.keys(queued).sort()); // 字段集合零变化
  });
});

/* ═══════════════ ⑥ 调度令槽内语义（§7.7） ═══════════════ */

describe('⑥ 调度令：置顶/暂缓在槽 lane 内语义正确', () => {
  it('置顶抢占仅发生于同槽：载具槽被抢占，主建筑槽在研项无恙', () => {
    const state = stateWith(ALL_ANCHORS, [
      txn({ item: '机动侦察工学', status: 'active', spent_minutes: 300, progress: 30 }), // slot.vehicle
      txn({ item: '基础步兵训练学', status: 'active' }), // slot.main
      txn({ item: '制空权学说' }), // slot.vehicle queued
    ]);
    const r = settleTransactions(state, 0, {
      ...adjudicator(state),
      orders: [{ item: '制空权学说', verb: '置顶' }],
    });
    const byItem = Object.fromEntries(r.next.queues.map(q => [q.item, q]));
    expect(byItem['机动侦察工学'].status).toBe('queued'); // 同槽 victim，进度保留
    expect(byItem['机动侦察工学'].progress).toBe(30);
    expect(byItem['基础步兵训练学'].status).toBe('active'); // 异槽不受抢占波及
    expect(byItem['制空权学说'].status).toBe('active'); // 顶位后经带宽门升格
    expect(r.events.some(e => e.type === 'preempted' && e.item === '机动侦察工学')).toBe(true);
  });

  it('暂缓：槽内 active 研究退回 queued＋hold，空位由同槽队首递补', () => {
    const state = stateWith(ALL_ANCHORS, [
      txn({ item: '机动侦察工学', status: 'active', spent_minutes: 500, progress: 50 }),
      txn({ item: '制空权学说' }), // 同槽 queued
    ]);
    const r = settleTransactions(state, 0, {
      ...adjudicator(state),
      orders: [{ item: '机动侦察工学', verb: '暂缓' }],
    });
    const byItem = Object.fromEntries(r.next.queues.map(q => [q.item, q]));
    expect(byItem['机动侦察工学']).toMatchObject({ status: 'queued', hold: true, progress: 50 });
    expect(byItem['制空权学说'].status).toBe('active'); // 同槽递补
  });

  it('置顶挪位发生在槽 lane 内：不打乱其他槽/其他 type 的数组相对序', () => {
    const state = stateWith(ALL_ANCHORS, [
      txn({ type: '生产', item: '灰熊坦克', base: 'alpha', status: 'active' }),
      txn({ item: '机动侦察工学' }),
      txn({ item: '制空权学说' }),
    ]);
    const r = settleTransactions(state, 0, {
      ...adjudicator(state),
      orders: [{ item: '制空权学说', verb: '置顶' }],
    });
    const items = r.next.queues.map(q => q.item);
    expect(items).toEqual(['灰熊坦克', '制空权学说', '机动侦察工学']); // 只在载具槽 lane 内换位
    expect(r.next.queues[1].status).toBe('active'); // 顶位者升格
  });
});

/* ═══════════════ slotBoard 派生视图（§5.3） ═══════════════ */

describe('slotBoard：派生只读视图', () => {
  it('各槽 {开通状态, 在研项, 排队数} 完全派生自 queues，覆盖全 11 槽', () => {
    const state = stateWith(
      ['战车工厂', '建造厂核心'],
      [
        txn({ item: '机动侦察工学', status: 'active' }),
        txn({ item: '制空权学说' }),
        txn({ item: '水面作战舰艇学' }),
        txn({ item: '基础步兵训练学' }),
        txn({ type: '生产', item: '灰熊坦克', base: 'alpha', status: 'active' }), // 非研究不入板
      ],
    );
    const board = slotBoard(state, testLineOf);
    expect(board).toHaveLength(11);
    const bySlot = Object.fromEntries(board.map(e => [e.slotId, e]));
    expect(bySlot['slot.vehicle']).toMatchObject({ unlocked: true, active: ['机动侦察工学'], queued: 2 });
    expect(bySlot['slot.main']).toMatchObject({ unlocked: true, active: [], queued: 1 });
    expect(bySlot['slot.agri']).toMatchObject({ unlocked: false, active: [], queued: 0 });
    expect(bySlot['slot.faction']).toMatchObject({ unlocked: true }); // MCV 在场
  });

  it('slotBoard 不修改入参（纯函数）', () => {
    const state = stateWith(['战车工厂'], [txn({ item: '机动侦察工学', status: 'active' })]);
    const snapshot = structuredClone(state);
    slotBoard(state, testLineOf);
    expect(state).toStrictEqual(snapshot);
  });
});

/* ═══════════════ ⑦ 锚定名对齐急修（批 E1：建造厂核心 → 建造厂/MCV） ═══════════════ */

describe('⑦ 锚定名对齐：实况名「盟军建造厂」（不含「核心」）开通 slot.main/slot.faction', () => {
  it('盟军建造厂在场：slot.main/slot.faction 开通，主建筑/盟军特色研究 limit=1', () => {
    const state = stateWith(['盟军建造厂']);
    const board = slotBoard(state, testLineOf);
    const unlocked = Object.fromEntries(board.map(e => [e.slotId, e.unlocked]));
    expect(unlocked['slot.main']).toBe(true);
    expect(unlocked['slot.faction']).toBe(true);
    const limitFor = makeParallelLimitFor(state, testLineOf);
    expect(limitFor(txn({ item: '基础步兵训练学' }))).toBe(1); // line=主建筑 → slot.main
    expect(limitFor(txn({ item: '拟态全息工学' }))).toBe(1); // line=盟军特色 → slot.faction
  });

  it('盟军建造厂在场：主建筑＋盟军特色研究经引擎升格（真机升格封死形态复归）', () => {
    const state = stateWith(['盟军建造厂'], [txn({ item: '基础步兵训练学' }), txn({ item: '拟态全息工学' })]);
    const r = settleTransactions(state, 60, adjudicator(state));
    expect(r.next.queues.every(q => q.status === 'active')).toBe(true);
  });

  it('阵营前缀形态同样命中：苏联建造厂/尤里建造厂/MCV 均开通两槽', () => {
    for (const name of ['苏联建造厂', '尤里建造厂', 'MCV']) {
      const board = slotBoard(stateWith([name]), testLineOf);
      const unlocked = Object.fromEntries(board.map(e => [e.slotId, e.unlocked]));
      expect(unlocked['slot.main'], name).toBe(true);
      expect(unlocked['slot.faction'], name).toBe(true);
    }
  });

  it('建造中的盟军建造厂不算在场（anchorPresent 跳过 建造中，升格仍封死）', () => {
    const state: SlotStateView & { queues: TransactionItem[] } = {
      bases: [{ buildings: [{ name: '盟军建造厂', state: '建造中' }] }],
      queues: [txn({ item: '基础步兵训练学' })],
    };
    const limitFor = makeParallelLimitFor(state, testLineOf);
    expect(limitFor(txn({ item: '基础步兵训练学' }))).toBe(0);
    expect(limitFor(txn({ item: '拟态全息工学' }))).toBe(0);
    const r = settleTransactions(state, 60, adjudicator(state));
    expect(r.next.queues[0].status).toBe('queued'); // 有队无道
  });

  it('其余 9 槽锚定判定零回归：仅有盟军建造厂时全锁定，各锚建筑各自开通', () => {
    const mainOnly = slotBoard(stateWith(['盟军建造厂']), testLineOf);
    for (const e of mainOnly) {
      if (e.slotId === 'slot.main' || e.slotId === 'slot.faction') continue;
      expect(e.unlocked, e.slotId).toBe(false);
    }
    const anchors: Array<[string, string, string]> = [
      ['矿石精炼厂', 'slot.industry', '基础化工学'],
      ['苏联兵营', 'slot.defense', '战场医疗工学'],
      ['战车工厂', 'slot.vehicle', '机动侦察工学'],
      ['苏联兵营', 'slot.personnel', '军犬行为工程学'],
      ['个人装备制造所', 'slot.equipment', '光学瞄准工学'],
      ['水培站', 'slot.agri', '基础水培农业'],
      ['基础废物分拣站', 'slot.eco', '基础环境工程学'],
      ['航天发射中心', 'slot.aerospace', '火箭推进基础工学'],
      ['机娘接口设施', 'slot.mecha', '相变微流道散热工学'],
    ];
    for (const [building, slotId, item] of anchors) {
      const state = stateWith([building]);
      const board = slotBoard(state, testLineOf);
      expect(board.find(e => e.slotId === slotId)!.unlocked, `${building}→${slotId}`).toBe(true);
      expect(makeParallelLimitFor(state, testLineOf)(txn({ item })), item).toBe(1);
    }
  });

  it('slotBoard 派生视图在新锚定下正确：盟军建造厂开通两槽、占用完全派生自 queues', () => {
    const state = stateWith(
      ['盟军建造厂'],
      [
        txn({ item: '基础步兵训练学', status: 'active' }), // slot.main 在研
        txn({ item: '拟态全息工学' }), // slot.faction 排队
        txn({ item: '磁暴线圈工学' }), // 苏联特色前缀 → slot.faction 排队
      ],
    );
    const board = slotBoard(state, testLineOf);
    expect(board).toHaveLength(11);
    const bySlot = Object.fromEntries(board.map(e => [e.slotId, e]));
    expect(bySlot['slot.main']).toMatchObject({ unlocked: true, active: ['基础步兵训练学'], queued: 0 });
    expect(bySlot['slot.faction']).toMatchObject({ unlocked: true, active: [], queued: 2 });
    expect(bySlot['slot.vehicle']).toMatchObject({ unlocked: false, active: [], queued: 0 });
  });
});

/* ═══════════════ E2b 通道B：deploy 能力面锚定消费 ═══════════════ */

describe('E2b 通道B：deploy 能力面锚定消费（批（八十四））', () => {
  /** 合成 resolver（MCV 无 <数据> 块系（八十二）登记决定，夹具不依赖世界书真数据） */
  const deployOfFixture =
    (table: Record<string, string[]>) =>
    (name: string): string[] | undefined =>
      table[name];

  it('① 注入 resolver 后：deploy 目标建筑能力面覆盖 research → slot.main/slot.faction 判在场', () => {
    const state = stateWith(['前沿科研枢纽']); // 名不含 建造厂/MCV，通道A 不命中
    const deployOf = deployOfFixture({ 前沿科研枢纽: ['research'] });
    // 未注入：两槽封死（现状基线）
    expect(makeParallelLimitFor(state, testLineOf)(txn({ item: '基础步兵训练学' }))).toBe(0);
    expect(makeParallelLimitFor(state, testLineOf)(txn({ item: '拟态全息工学' }))).toBe(0);
    // 注入后：主建筑槽/阵营特色槽开通
    const limitFor = makeParallelLimitFor(state, testLineOf, { deployOf });
    expect(limitFor(txn({ item: '基础步兵训练学' }))).toBe(1);
    expect(limitFor(txn({ item: '拟态全息工学' }))).toBe(1);
    // slotBoard 同口径；非 deploy 通道槽（slot.industry）不受影响
    const board = slotBoard(state, testLineOf, undefined, { deployOf });
    expect(board.find(e => e.slotId === 'slot.main')?.unlocked).toBe(true);
    expect(board.find(e => e.slotId === 'slot.faction')?.unlocked).toBe(true);
    expect(board.find(e => e.slotId === 'slot.industry')?.unlocked).toBe(false);
  });

  it('② 前沿工地（build.whitelist）/车族四场（produce.*）注入后研究槽仍封死（红线结构性免疫实证）', () => {
    const state = stateWith(['前沿工地', '前线战车组装场']);
    const deployOf = deployOfFixture({ 前沿工地: ['build.whitelist'], 前线战车组装场: ['produce.*'] });
    const limitFor = makeParallelLimitFor(state, testLineOf, { deployOf });
    expect(limitFor(txn({ item: '基础步兵训练学' }))).toBe(0);
    expect(limitFor(txn({ item: '拟态全息工学' }))).toBe(0);
    const board = slotBoard(state, testLineOf, undefined, { deployOf });
    expect(board.every(e => !e.unlocked)).toBe(true);
  });

  it('③ 不注入 resolver → 现状零变化（deploy 目标建筑对研究槽无影响）', () => {
    const state = stateWith(['前沿工地', '前沿科研枢纽']);
    expect(makeParallelLimitFor(state, testLineOf)(txn({ item: '基础步兵训练学' }))).toBe(0);
    const board = slotBoard(state, testLineOf);
    expect(board.every(e => !e.unlocked)).toBe(true);
  });

  it('通道B 同样遵守建造中不算在场（与通道A 同口径）', () => {
    const state: SlotStateView = { bases: [{ buildings: [{ name: '前沿科研枢纽', state: '建造中' }] }] };
    const deployOf = deployOfFixture({ 前沿科研枢纽: ['research'] });
    expect(makeParallelLimitFor(state, testLineOf, { deployOf })(txn({ item: '基础步兵训练学' }))).toBe(0);
  });

  it('BUG-R2-04：ENUM_BUILDING_STATE 补齐战损/停用同义词，且受损/停机建筑不提供研究槽开通与 T2/T3 科技等级', () => {
    const baseline = Schema.parse({
      bases: [{ id: 'b1', name: '北坡基地', buildings: [] }],
    });
    const parsed = parseMessageText(
      [
        '<战况>',
        '基地:',
        '  - 名称: 北坡基地',
        '    建筑:',
        '      - { 名称: 盟军建造厂, 状态: 被毁 }',
        '      - { 名称: 战车工厂, 状态: 瘫痪 }',
        '      - { 名称: 战斗实验室, 状态: 重创 }',
        '      - { 名称: 量子超算中心, 状态: 封存 }',
        '      - { 名称: 矿石精炼厂, 状态: 变卖 }',
        '</战况>',
      ].join('\n'),
      baseline,
      {},
    );
    const blds = parsed.data.bases[0].buildings;
    expect(blds.find(b => b.name === '盟军建造厂')?.state).toBe('受损');
    expect(blds.find(b => b.name === '战车工厂')?.state).toBe('受损');
    expect(blds.find(b => b.name === '战斗实验室')?.state).toBe('受损');
    expect(blds.find(b => b.name === '量子超算中心')?.state).toBe('停机');
    expect(blds.find(b => b.name === '矿石精炼厂')?.state).toBe('停机');

    // 受损/停机的战斗实验室与量子超算中心不提供 T2/T3 科技等级，退回 T1
    expect(techTier(parsed.data)).toBe(1);
    // 受损/停机的建造厂、战车工厂、矿石精炼厂不提供研究槽开通
    const board = slotBoard(parsed.data, testLineOf);
    expect(board.find(e => e.slotId === 'slot.main')?.unlocked).toBe(false);
    expect(board.find(e => e.slotId === 'slot.vehicle')?.unlocked).toBe(false);
    expect(board.find(e => e.slotId === 'slot.industry')?.unlocked).toBe(false);
  });
});
