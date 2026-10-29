/**
 * settleFloor 测试（CTRL-TXN-INTEG-01 · F4 事务引擎结算接线）
 *
 * 覆盖任务验收自动化面：
 * - Δt 三来源顺序与兜底缺席记 0（parseTimePast 成功才算，不走 60 分钟兜底）；
 * - canon 后缀去重合并（本楼新建 × 在册 active；存量重复不动；R19 交集不重复合并）；
 * - total_minutes=0 旧事务兼容（只发 unknown_duration、不推进、不覆盖 LLM progress）；
 * - §3.3 工期回填（显式工期优先、ECON-02 反算、无来源保持 0）；
 * - catalog 缓存缺失退默认值（引擎默认行为恒等）；
 * - clock 只在 Δt>0 时写入；
 * - 挂点幂等与 swipe/编辑重算（runParseFor 集成，node 桩模拟酒馆变量读写）。
 */
// eslint-disable-next-line import-x/no-nodejs-modules
import { readFileSync } from 'node:fs';
// eslint-disable-next-line import-x/no-nodejs-modules
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EffectiveCatalog } from '../core/catalogEffective';
import { canon } from '../parse/parsePipeline';
import { parseProductionDeclarations, reconcileProduction } from '../engines/productionReconciliation';
import { Schema } from '../core/schema';
import {
  canonTxnName,
  dedupeNewQueues,
  durationFromEntry,
  orchestrateFloorTasks,
  promoteIdleQueuesAtZeroDelta,
  recomputeBasePowerFromCatalog,
  resolveDeltaMinutes,
  settleFloor,
  TXN_SUFFIXES,
} from '../engines/settleFloor';
import type { TransactionItem } from '../engines/transactionEngine';

/* ═══════════════ 工具 ═══════════════ */

function mkTxn(partial: Partial<TransactionItem> & Pick<TransactionItem, 'type' | 'item'>): TransactionItem {
  return {
    base: '',
    progress: 0,
    eta: '',
    status: 'active',
    started_at: '',
    total_minutes: 0,
    spent_minutes: 0,
    qty: 1,
    qty_done: 0,
    cost_paid: true,
    min_days_lock: 0,
    hold: false,
    ...partial,
  };
}

function mkStat(overrides: Record<string, unknown> = {}) {
  return Schema.parse({
    meta: { world_id: 'cyber2042', date: '2042-03-14', day_count: 1, location: '锈蚀低壑' },
    ...overrides,
  });
}

function mkCatalog(overrides: Partial<EffectiveCatalog> = {}): EffectiveCatalog {
  return {
    researches: [],
    buildings: [],
    productions: [],
    retrofits: [],
    factionDefs: [],
    ...overrides,
  } as EffectiveCatalog;
}

/* ═══════════════ Δt 三来源 ═══════════════ */

describe('resolveDeltaMinutes（Δt 三来源顺序，已登记偏差：无 60 分钟兜底）', () => {
  const prev = mkStat({ meta: { date: '2042-03-14', day_count: 1 } });
  const next = mkStat({ meta: { date: '2042-03-16', day_count: 3 } });

  it('① parseTimePast 成功优先于日期差', () => {
    const r = resolveDeltaMinutes('正文\n<timePast>0 D 6 H 0 M</timePast>', prev, next);
    expect(r).toEqual({ deltaMinutes: 360, source: 'timePast' });
  });

  it('① timePast 明示 0 也是成功值（不再看日期差）', () => {
    const r = resolveDeltaMinutes('<timePast>0 D 0 H 0 M</timePast>', prev, next);
    expect(r).toEqual({ deltaMinutes: 0, source: 'timePast' });
  });

  it('② 无标签时退 meta.date 日期差 ×1440', () => {
    const r = resolveDeltaMinutes('没有标签的正文', prev, next);
    expect(r).toEqual({ deltaMinutes: 2880, source: 'meta.date' });
  });

  it('② 标签解析失败（畸变内容）同样退日期差，不走 60 兜底', () => {
    const r = resolveDeltaMinutes('<timePast>很久以前</timePast>', prev, next);
    expect(r).toEqual({ deltaMinutes: 2880, source: 'meta.date' });
  });

  it('③ 两源都没有记 0（关键：不是 60）', () => {
    const sameDay = mkStat({ meta: { date: '2042-03-14', day_count: 1 } });
    const r = resolveDeltaMinutes('无标签', prev, sameDay);
    expect(r).toEqual({ deltaMinutes: 0, source: 'none' });
    expect(r.deltaMinutes).not.toBe(60);
  });

  it('③ 无基线楼（prev undefined）且标签缺席 → 0', () => {
    const r = resolveDeltaMinutes('无标签', undefined, next);
    expect(r).toEqual({ deltaMinutes: 0, source: 'none' });
  });

  it('③ 日期回退（next<prev）不结算出负 Δt', () => {
    const r = resolveDeltaMinutes('无标签', next, prev);
    expect(r).toEqual({ deltaMinutes: 0, source: 'none' });
  });
});

/* ═══════════════ canon 后缀去重（R22） ═══════════════ */

describe('canonTxnName / TXN_SUFFIXES（后缀词表钉死）', () => {
  it('词表冻结：试制型/研制型/改装型/试制/研制', () => {
    expect(TXN_SUFFIXES).toEqual(['试制型', '研制型', '改装型', '试制', '研制']);
  });
  it('剥后缀：试制/研制/改装型/试制型；无后缀原样', () => {
    expect(canonTxnName('伯克级驱逐舰试制')).toBe(canon('伯克级驱逐舰'));
    expect(canonTxnName('湍流压缩机研制')).toBe(canon('湍流压缩机'));
    expect(canonTxnName('灰熊坦克改装型')).toBe(canon('灰熊坦克'));
    expect(canonTxnName('灰熊坦克试制型')).toBe(canon('灰熊坦克'));
    expect(canonTxnName('灰熊坦克')).toBe(canon('灰熊坦克'));
  });
  it('剥后缀不掏空名字（「试制」本身不是「」）', () => {
    expect(canonTxnName('试制')).toBe('试制');
  });
});

describe('dedupeNewQueues（本楼新建 × 在册 active 合并）', () => {
  const prev = mkStat({
    bases: [{ id: 'B1', name: '主基地' }],
    queues: [
      mkTxn({ type: '生产', item: '静默折光伪装网', base: 'B1', progress: 40, spent_minutes: 100, total_minutes: 500 }),
    ],
  });

  it('命中合并：新「XX试制」并入在册 active「XX」，字段保留在册方', () => {
    const nextQueues = [
      mkTxn({ type: '生产', item: '静默折光伪装网', base: 'B1', progress: 40, spent_minutes: 100, total_minutes: 500 }),
      mkTxn({ type: '生产', item: '静默折光伪装网试制', base: 'B1' }),
    ];
    const r = dedupeNewQueues(prev, nextQueues);
    expect(r.queues).toHaveLength(1);
    expect(r.queues[0].item).toBe('静默折光伪装网');
    expect(r.queues[0].progress).toBe(40);
    expect(r.issues.some(i => i.rule === 'R22' && i.level === 'info')).toBe(true);
    expect(r.events.some(e => e.message.includes('去重合并'))).toBe(true);
  });

  it('存量重复不自动合并（prev 已共存的两条原样保留）', () => {
    const prevDup = mkStat({
      bases: [{ id: 'B1', name: '主基地' }],
      queues: [
        mkTxn({ type: '生产', item: '伪装网', base: 'B1' }),
        mkTxn({ type: '生产', item: '伪装网试制', base: 'B1' }),
      ],
    });
    const sameQueues = [
      mkTxn({ type: '生产', item: '伪装网', base: 'B1' }),
      mkTxn({ type: '生产', item: '伪装网试制', base: 'B1' }),
    ];
    const r = dedupeNewQueues(prevDup, sameQueues);
    expect(r.queues).toHaveLength(2);
    expect(r.issues).toHaveLength(0);
  });

  it('R19 交集不重复合并：解析层已对齐成同名（canon 相等），本层无动作', () => {
    const nextQueues = [
      mkTxn({ type: '生产', item: '静默折光伪装网', base: 'B1', progress: 40, spent_minutes: 100, total_minutes: 500 }),
    ];
    const r = dedupeNewQueues(prev, nextQueues);
    expect(r.queues).toHaveLength(1);
    expect(r.issues).toHaveLength(0);
  });

  it('不同 base / 不同 type / 在册方非 active 均不合并', () => {
    const byBase = dedupeNewQueues(prev, [
      mkTxn({ type: '生产', item: '静默折光伪装网', base: 'B1', progress: 40, spent_minutes: 100, total_minutes: 500 }),
      mkTxn({ type: '生产', item: '静默折光伪装网试制', base: 'B2' }),
    ]);
    expect(byBase.queues).toHaveLength(2);

    const byType = dedupeNewQueues(prev, [
      mkTxn({ type: '生产', item: '静默折光伪装网', base: 'B1', progress: 40, spent_minutes: 100, total_minutes: 500 }),
      mkTxn({ type: '改装', item: '静默折光伪装网试制', base: 'B1' }),
    ]);
    expect(byType.queues).toHaveLength(2);

    const prevQueued = mkStat({
      bases: [{ id: 'B1', name: '主基地' }],
      queues: [mkTxn({ type: '生产', item: '伪装网', base: 'B1', status: 'queued' })],
    });
    const notActive = dedupeNewQueues(prevQueued, [
      mkTxn({ type: '生产', item: '伪装网', base: 'B1', status: 'queued' }),
      mkTxn({ type: '生产', item: '伪装网试制', base: 'B1' }),
    ]);
    expect(notActive.queues).toHaveLength(2);
  });
});

/* ═══════════════ §3.3 工期回填 ═══════════════ */

describe('durationFromEntry（§3.3 工期来源：显式 > eta 文本 > ECON-02 反算）', () => {
  it('workload.days 显式工期优先，min_days 落 min_days_lock', () => {
    expect(durationFromEntry({ workload: { days: 2, min_days: 1, tflops: 10 }, cost: 99999, tier: 3 })).toEqual({
      totalMinutes: 2880,
      minDaysLock: 1,
      source: '显式工期',
    });
  });
  it('assembly.min_days 作显式工期并落锁', () => {
    expect(durationFromEntry({ assembly: { min_days: 3 } })).toEqual({
      totalMinutes: 4320,
      minDaysLock: 3,
      source: '显式工期',
    });
  });
  it('eta 文本（如 "约3日"、"约2-3日"）在无 workload.days 时同样解析为显式工期（不误入 ECON-02 秒完）', () => {
    expect(durationFromEntry({ name: '基础环境工程学', cost: 300, tier: 1, eta: '约3日' })).toEqual({
      totalMinutes: 4320,
      minDaysLock: 2,
      source: '显式工期',
    });
    expect(
      durationFromEntry({
        name: '拟态伪装与欺骗学派总论',
        cost: 500,
        tier: 1,
        eta: '约3-4日',
        workload: { min_days: 2 },
      }),
    ).toEqual({
      totalMinutes: 5760,
      minDaysLock: 2,
      source: '显式工期',
    });
  });
  it('ECON-02 统一式反算：纯裸 { cost, tier } 输入按梯级带宽（T1=5000/T2=8000/T3=20000）', () => {
    expect(durationFromEntry({ cost: 5000, tier: 1 })?.totalMinutes).toBe(1440);
    expect(durationFromEntry({ cost: 8000, tier: 2 })?.totalMinutes).toBe(1440);
    expect(durationFromEntry({ cost: 20000, tier: 3 })?.totalMinutes).toBe(1440);
    expect(durationFromEntry({ cost: 400 })?.totalMinutes).toBeCloseTo(115.2); // tier 缺席按 T1
  });
  it('六大类别写实工期反算：建筑/人员/装备/陆军载具/空军/海军舰艇按类别与造价分档折算（兵营 2.5天、矿石精炼厂 6.5天、采矿车 5天、驱逐舰 60天、福特级航母 120天）', () => {
    // 1. 建筑：兵营 $500 -> 2.5天(3600m)；矿石精炼厂 $2000 -> 6.5天(9360m)
    expect(durationFromEntry({ type: 'building', name: '兵营', cost: 500 })).toEqual({
      totalMinutes: 3600,
      minDaysLock: 1.5,
      source: '分类工期（建筑）',
    });
    expect(durationFromEntry({ type: 'building', name: '矿石精炼厂', cost: 2000 })).toEqual({
      totalMinutes: 9360,
      minDaysLock: 4,
      source: '分类工期（建筑）',
    });
    // 2. 人员：美国大兵 $200 -> 1天(1440m)；尤里X $2000 -> 4天(5760m)
    expect(durationFromEntry({ type: 'production', category: 'infantry', name: '美国大兵', cost: 200 })?.totalMinutes).toBe(1440);
    expect(durationFromEntry({ type: 'production', category: 'infantry', name: '尤里X', cost: 2000 })?.totalMinutes).toBe(5760);
    // 3. 陆军载具：恐怖机器人 $400 -> 2.5天(3600m)；超时空采矿车 $1400 -> 5天(7200m)
    expect(durationFromEntry({ type: 'production', category: 'vehicle', name: '恐怖机器人', cost: 400 })?.totalMinutes).toBe(3600);
    expect(durationFromEntry({ type: 'production', category: 'support', name: '超时空采矿车', cost: 1400 })?.totalMinutes).toBe(7200);
    // 4. 空军：F-22A $8000 -> 15天(21600m)；B-21 $40000 -> 27天(38880m)
    expect(durationFromEntry({ type: 'production', category: 'air', name: 'F-22A猛禽隐身制空战斗机', cost: 8000 })?.totalMinutes).toBe(21600);
    expect(durationFromEntry({ type: 'production', category: 'air', name: 'B-21突袭者隐身战略轰炸机', cost: 40000 })?.totalMinutes).toBe(38880);
    // 5. 海军舰艇：伯克级驱逐舰 $55000 -> 60天(86400m)；福特级核动力航母 $550000 -> 120天(172800m，按季度算)
    expect(durationFromEntry({ type: 'production', category: 'naval', name: 'DDG-51阿利·伯克级宙斯盾驱逐舰', cost: 55000 })?.totalMinutes).toBe(86400);
    expect(durationFromEntry({ type: 'production', category: 'naval', name: 'CVN-78福特级电磁弹射核动力航空母舰', cost: 550000 })?.totalMinutes).toBe(172800);
  });
  it('无工期字段且无 cost → null（保持 total_minutes=0 走 unknown_duration）', () => {
    expect(durationFromEntry({ name: '什么都没有' })).toBeNull();
    expect(durationFromEntry(undefined)).toBeNull();
    expect(durationFromEntry('bad')).toBeNull();
  });
});

/* ═══════════════ settleFloor 主流程 ═══════════════ */

describe('settleFloor（Δt 结算 + 兼容 + clock）', () => {
  it('timePast 6H：active 事务 spent += 360、progress 按 total 折算', () => {
    const prev = mkStat({ queues: [mkTxn({ type: '研究', item: '化石燃料发电学', total_minutes: 2880 })] });
    const next = mkStat({ queues: [mkTxn({ type: '研究', item: '化石燃料发电学', total_minutes: 2880 })] });
    const r = settleFloor(prev, next, '<timePast>0 D 6 H 0 M</timePast>', { catalog: null });
    expect(r.deltaMinutes).toBe(360);
    expect(r.data.queues[0].spent_minutes).toBe(360);
    expect(r.data.queues[0].progress).toBeCloseTo(12.5);
  });

  it('total_minutes=0 旧事务兼容：只发 unknown_duration、不推进、不覆盖 LLM progress', () => {
    const prev = mkStat({ queues: [mkTxn({ type: '生产', item: '无名装备', base: 'B1', progress: 40 })] });
    const next = mkStat({ queues: [mkTxn({ type: '生产', item: '无名装备', base: 'B1', progress: 40 })] });
    const r = settleFloor(prev, next, '<timePast>0 D 6 H 0 M</timePast>', { catalog: null });
    expect(r.data.queues[0].spent_minutes).toBe(0);
    expect(r.data.queues[0].progress).toBe(40); // LLM 报的 progress 原样
    expect(r.events.some(e => e.message.includes('unknown_duration'))).toBe(true);
    expect(r.issues.some(i => i.rule === 'R21' && i.message.includes('未知工期'))).toBe(true);
  });

  it('catalog 回填工期后旧事务恢复推进（unknown_duration 不再发）', () => {
    const catalog = mkCatalog({ productions: [{ name: '标准动力甲', cost: 8000, tier: 2 } as never] });
    const prev = mkStat({ queues: [mkTxn({ type: '生产', item: '标准动力甲', base: 'B1' })] });
    const next = mkStat({ queues: [mkTxn({ type: '生产', item: '标准动力甲', base: 'B1' })] });
    const r = settleFloor(prev, next, '<timePast>0 D 6 H 0 M</timePast>', { catalog });
    expect(r.data.queues[0].total_minutes).toBe(1440);
    expect(r.data.queues[0].spent_minutes).toBe(360);
    expect(r.events.some(e => e.message.includes('回填工期'))).toBe(true);
    expect(r.events.some(e => e.message.includes('unknown_duration'))).toBe(false);
  });

  it('catalog 缺失退默认值：eff 恒 1（spent=Δt），研究走默认 lane，不炸', () => {
    const prev = mkStat({ queues: [mkTxn({ type: '研究', item: '不存在于任何目录的科技', total_minutes: 1440 })] });
    const next = mkStat({ queues: [mkTxn({ type: '研究', item: '不存在于任何目录的科技', total_minutes: 1440 })] });
    const r = settleFloor(prev, next, '<timePast>0 D 6 H 0 M</timePast>');
    expect(r.data.queues[0].spent_minutes).toBe(360);
  });

  it('工况效率注入：低电基地建筑 eff=0.2 时进度按 0.2 缩放', () => {
    const catalog = mkCatalog({
      buildings: [
        {
          name: '发电厂',
          cost: 800,
          power: -150,
          operation: {
            conditions: [{ trigger: 'low_power', behavior: 'degraded', efficiency: 0.2, desc: '低电降频' }],
          },
        } as never,
      ],
    });
    const base = {
      id: 'B1',
      name: '主基地',
      power: { gen: 0, use: 50 },
      buildings: [{ name: '发电厂', state: '运转' }],
    };
    const prev = mkStat({
      bases: [base],
      queues: [mkTxn({ type: '建造', item: '某防御塔', base: 'B1', total_minutes: 1440 })],
    });
    const next = mkStat({
      bases: [base],
      queues: [mkTxn({ type: '建造', item: '某防御塔', base: 'B1', total_minutes: 1440 })],
    });
    const r = settleFloor(prev, next, '<timePast>0 D 6 H 0 M</timePast>', { catalog });
    expect(r.data.queues[0].spent_minutes).toBeCloseTo(72); // 360 × 0.2
  });

  it('clock 只在 Δt>0 时写入；Δt=0 零注入', () => {
    const prev = mkStat();
    const next = mkStat();
    const advanced = settleFloor(prev, next, '<timePast>1 D 6 H 0 M</timePast>', { catalog: null });
    expect(advanced.data.clock).toEqual({ day: 2, time: '14:00' }); // day_count 1 + 跨 1 天；08:00+30H
    const frozen = settleFloor(prev, mkStat(), '无标签正文', { catalog: null });
    expect(frozen.data.clock).toBeUndefined();
  });

  it('clock 续楼累进：prev.clock.day 为基数，prev.clock.time 为当日起点（不倒退）', () => {
    const prev = mkStat({ clock: { day: 1, time: '14:00' } });
    const next = mkStat({ meta: { date: '2042-03-14', day_count: 1 } });
    const r = settleFloor(prev, next, '<timePast>0 D 2 H 0 M</timePast>', { catalog: null });
    expect(r.data.clock).toEqual({ day: 1, time: '16:00' }); // 14:00 + 2H，而非 08:00 + 2H
  });

  it('clock 续楼跨日：prev.clock.time 深夜 + Δt 跨天', () => {
    const prev = mkStat({ clock: { day: 3, time: '23:00' } });
    const next = mkStat({ meta: { date: '2042-03-16', day_count: 3 } });
    const r = settleFloor(prev, next, '<timePast>0 D 3 H 0 M</timePast>', { catalog: null });
    expect(r.data.clock?.day).toBe(4);
    expect(r.data.clock?.time).toBe('02:00');
  });

  it('纯函数：prevData / nextData 入参零突变', () => {
    const prev = mkStat({ queues: [mkTxn({ type: '研究', item: 'X', total_minutes: 1440 })] });
    const next = mkStat({ queues: [mkTxn({ type: '研究', item: 'X', total_minutes: 1440 })] });
    const prevSnap = JSON.stringify(prev);
    const nextSnap = JSON.stringify(next);
    settleFloor(prev, next, '<timePast>0 D 6 H 0 M</timePast>', { catalog: null });
    expect(JSON.stringify(prev)).toBe(prevSnap);
    expect(JSON.stringify(next)).toBe(nextSnap);
  });

  it('queued 事务经带宽门升格（研究槽：锚定建筑在场开通）', () => {
    const catalog = mkCatalog({
      researches: [{ name: '基础军务学', line: '人员', tier: 1, cost: 400 } as never],
    });
    const base = {
      id: 'B1',
      name: '主基地',
      power: { gen: 100, use: 0 },
      buildings: [{ name: '兵营', state: '运转' }],
    };
    const prev = mkStat({ bases: [base], queues: [mkTxn({ type: '研究', item: '基础军务学', status: 'queued' })] });
    const next = mkStat({ bases: [base], queues: [mkTxn({ type: '研究', item: '基础军务学', status: 'queued' })] });
    const r = settleFloor(prev, next, '<timePast>0 D 6 H 0 M</timePast>', { catalog });
    expect(r.data.queues[0].status).toBe('active'); // 兵营在场 → 人员槽开通 → 升格
    expect(r.events.some(e => e.message.includes('promoted'))).toBe(true);
  });

  it('锚定建筑不在场：研究升格封死（有队无道）', () => {
    const catalog = mkCatalog({
      researches: [{ name: '基础军务学', line: '人员', tier: 1, cost: 400 } as never],
    });
    const base = { id: 'B1', name: '主基地', power: { gen: 100, use: 0 }, buildings: [] };
    const prev = mkStat({ bases: [base], queues: [mkTxn({ type: '研究', item: '基础军务学', status: 'queued' })] });
    const next = mkStat({ bases: [base], queues: [mkTxn({ type: '研究', item: '基础军务学', status: 'queued' })] });
    const r = settleFloor(prev, next, '<timePast>0 D 6 H 0 M</timePast>', { catalog });
    expect(r.data.queues[0].status).toBe('queued');
  });
});

/* ═══════════════ 算力加速集成（§3.8：研究×算力设施，经 settleFloor 真接缝） ═══════════════ */

describe('算力设施落地（compute 入书 → settleFloor computeFor → 研究加速）', () => {
  /** 工业基础槽锚定（矿石精炼厂）+ 算力设施（超算中心 200F/120T，对齐世界书块） */
  const catalog = mkCatalog({
    researches: [
      { name: '高性能计算工学', line: '工业基础', tier: 2, workload: { days: 2, tflops: 100 } } as never,
      {
        name: '深层地下空间工程学',
        line: '工业基础',
        tier: 3,
        workload: { days: 10, min_days: 6, tflops: 10 },
      } as never,
    ],
    buildings: [
      { name: '矿石精炼厂', cost: 2000, power: 50 } as never,
      {
        name: '超算中心',
        cost: 12000,
        power: 150,
        outputs: { virtual: { compute: { tflops: 200, tops: 120 } } },
      } as never,
    ],
  });
  const mkBase = (computeState: string) => ({
    id: 'B1',
    name: '主基地',
    power: { gen: 2000, use: 0 },
    buildings: [
      { name: '矿石精炼厂', state: '运转' },
      { name: '超算中心', state: computeState },
    ],
  });

  it('① 阶段二吃算力：满配 tflops（200≥100）→ 研究权重 ×1.7，Δt=360 落 612 分钟', () => {
    const txn = mkTxn({
      type: '研究',
      item: '高性能计算工学',
      base: 'B1',
      total_minutes: 2880,
      spent_minutes: 1440,
      progress: 50,
    });
    const prev = mkStat({ bases: [mkBase('运转')], queues: [txn] });
    const next = mkStat({ bases: [mkBase('运转')], queues: [{ ...txn }] });
    const r = settleFloor(prev, next, '<timePast>0 D 6 H 0 M</timePast>', { catalog });
    expect(r.data.queues[0].spent_minutes).toBeCloseTo(2052); // 1440 + 360×1.7
    expect(r.data.queues[0].progress).toBeCloseTo(71.25); // 2052/2880
  });

  it('①对照：同研究无算力设施 → 阶段二按基础速率（Δt=360 落 360 分钟）', () => {
    const txn = mkTxn({
      type: '研究',
      item: '高性能计算工学',
      base: 'B1',
      total_minutes: 2880,
      spent_minutes: 1440,
      progress: 50,
    });
    const baseNoCompute = {
      id: 'B1',
      name: '主基地',
      power: { gen: 2000, use: 0 },
      buildings: [{ name: '矿石精炼厂', state: '运转' }],
    };
    const prev = mkStat({ bases: [baseNoCompute], queues: [txn] });
    const next = mkStat({ bases: [baseNoCompute], queues: [{ ...txn }] });
    const r = settleFloor(prev, next, '<timePast>0 D 6 H 0 M</timePast>', { catalog });
    expect(r.data.queues[0].spent_minutes).toBe(1800); // 1440 + 360×1
  });

  it('② 阶段一不吃算力：spent<phase1End 时即便算力满配也按基础速率', () => {
    const txn = mkTxn({ type: '研究', item: '高性能计算工学', base: 'B1', total_minutes: 2880 });
    const prev = mkStat({ bases: [mkBase('运转')], queues: [txn] });
    const next = mkStat({ bases: [mkBase('运转')], queues: [{ ...txn }] });
    const r = settleFloor(prev, next, '<timePast>0 D 6 H 0 M</timePast>', { catalog });
    expect(r.data.queues[0].spent_minutes).toBe(360); // 无加速，无纳米抵扣（spec 无 req_nanites）
  });

  it('③ 建造中的超算中心不贡献算力（state=建造中 → 阶段二无加速）', () => {
    const txn = mkTxn({
      type: '研究',
      item: '高性能计算工学',
      base: 'B1',
      total_minutes: 2880,
      spent_minutes: 1440,
      progress: 50,
    });
    const prev = mkStat({ bases: [mkBase('建造中')], queues: [txn] });
    const next = mkStat({ bases: [mkBase('建造中')], queues: [{ ...txn }] });
    const r = settleFloor(prev, next, '<timePast>0 D 6 H 0 M</timePast>', { catalog });
    expect(r.data.queues[0].spent_minutes).toBe(1800);
  });

  it('④ min_days ≤ 阶段一标称 → 总地板不钳制：满配 tflops 阶段二 ×1.7（09 总工期地板语义）', () => {
    // days:10→total 14400，phase1=7200；min_days:6→lock 8640 ≤ phase1 7200？否（8640>7200）
    // room = 8640−7200 = 1440 → cap = 7200/1440 = 5 > raw 1.7 → 加速全额生效
    const txn = mkTxn({
      type: '研究',
      item: '深层地下空间工程学',
      base: 'B1',
      total_minutes: 14400,
      spent_minutes: 7200,
      progress: 50,
      min_days_lock: 6,
    });
    const prev = mkStat({ bases: [mkBase('运转')], queues: [txn] });
    const next = mkStat({ bases: [mkBase('运转')], queues: [{ ...txn }] });
    const r = settleFloor(prev, next, '<timePast>0 D 12 H 0 M</timePast>', { catalog });
    expect(r.data.queues[0].spent_minutes).toBeCloseTo(8424); // 7200 + 720×1.7
  });

  it('④b lock 落在阶段二区间 → 部分钳制：lock 9 日 → cap=1.25，Δt=720 落 900 分钟', () => {
    const txn = mkTxn({
      type: '研究',
      item: '深层地下空间工程学',
      base: 'B1',
      total_minutes: 14400,
      spent_minutes: 7200,
      progress: 50,
      min_days_lock: 9,
    });
    const prev = mkStat({ bases: [mkBase('运转')], queues: [txn] });
    const next = mkStat({ bases: [mkBase('运转')], queues: [{ ...txn }] });
    const r = settleFloor(prev, next, '<timePast>0 D 12 H 0 M</timePast>', { catalog });
    expect(r.data.queues[0].spent_minutes).toBeCloseTo(8100); // 7200 + 720×1.25
  });

  it('④c lock = 总工期 → 封顶 1：满配算力也不加速（且不减速），Δt=720 落 720 分钟', () => {
    const txn = mkTxn({
      type: '研究',
      item: '深层地下空间工程学',
      base: 'B1',
      total_minutes: 14400,
      spent_minutes: 7200,
      progress: 50,
      min_days_lock: 10,
    });
    const prev = mkStat({ bases: [mkBase('运转')], queues: [txn] });
    const next = mkStat({ bases: [mkBase('运转')], queues: [{ ...txn }] });
    const r = settleFloor(prev, next, '<timePast>0 D 12 H 0 M</timePast>', { catalog });
    expect(r.data.queues[0].spent_minutes).toBeCloseTo(7920); // 7200 + 720×1
  });
});

/* ═══════════════ runParseFor 挂点集成（node 桩） ═══════════════ */

describe('runParseFor 挂点（幂等 / swipe 重算 / 同楼落盘）', () => {
  function installTavernStubs(rawRef: { raw: string }, baseline: unknown) {
    const g = globalThis as Record<string, unknown>;
    const msgVars: Record<number, Record<string, unknown>> = { 0: { stat_data: baseline } };
    let chatVars: Record<string, unknown> = {};
    g.getChatMessages = (id: number) => {
      if (id === 0) return [{ message_id: 0, role: 'assistant', is_hidden: false, message: '开局楼' }];
      if (id === 1) return [{ message_id: 1, role: 'assistant', is_hidden: false, message: rawRef.raw }];
      return [];
    };
    g.getVariables = (o: { type: string; message_id?: number }) =>
      o.type === 'chat' ? chatVars : (msgVars[o.message_id ?? -1] ?? {});
    g.updateVariablesWith = async (
      updater: (v: Record<string, unknown>) => Record<string, unknown>,
      o: { type: string; message_id?: number },
    ) => {
      if (o.type === 'chat') chatVars = updater(chatVars);
      else msgVars[o.message_id ?? -1] = updater(msgVars[o.message_id ?? -1] ?? {});
    };
    return { msgVars, readChat: () => chatVars };
  }

  const savedKeys = ['getChatMessages', 'getVariables', 'updateVariablesWith'];
  let saved: Record<string, unknown> = {};
  function save() {
    const g = globalThis as Record<string, unknown>;
    saved = {};
    for (const k of savedKeys) saved[k] = g[k];
  }
  function restore() {
    const g = globalThis as Record<string, unknown>;
    for (const k of savedKeys) g[k] = saved[k];
  }

  it('解析后结算、同楼落盘；同原文幂等 skipped；swipe 换文重算（不叠加）', async () => {
    save();
    try {
      const baseline = mkStat({ queues: [mkTxn({ type: '研究', item: '化石燃料发电学', total_minutes: 2880 })] });
      const rawRef = { raw: '正文\n<timePast>0 D 6 H 0 M</timePast>' };
      const { msgVars } = installTavernStubs(rawRef, baseline);
      const { runParseFor } = await import('../composables/useParse');

      const first = await runParseFor(1);
      expect(first).toBe('parsed');
      const written = msgVars[1].stat_data as { queues: TransactionItem[]; clock?: { day: number; time: string } };
      expect(written.queues[0].spent_minutes).toBe(360);
      expect(written.clock).toBeDefined(); // Δt>0 首次写入

      // 幂等：原文 hash 未变 → skipped，stat_data 引用零改写
      const beforeRef = msgVars[1];
      const second = await runParseFor(1);
      expect(second).toBe('skipped');
      expect(msgVars[1]).toBe(beforeRef);

      // swipe：原文变化 → 重解析重结算（从基线重算 360，而非 360+360）
      rawRef.raw = '换页正文\n<timePast>0 D 6 H 0 M</timePast>';
      const third = await runParseFor(1);
      expect(third).toBe('parsed');
      const rewritten = msgVars[1].stat_data as { queues: TransactionItem[] };
      expect(rewritten.queues[0].spent_minutes).toBe(360);
    } finally {
      restore();
    }
  });

  it('结算事件进入报告流水（[结算] 前缀），绿色计数含结算事件', async () => {
    save();
    try {
      const baseline = mkStat({ queues: [mkTxn({ type: '研究', item: '化石燃料发电学', total_minutes: 2880 })] });
      const rawRef = { raw: '<timePast>0 D 6 H 0 M</timePast>' };
      installTavernStubs(rawRef, baseline);
      const { runParseFor, parseState } = await import('../composables/useParse');
      await runParseFor(1);
      const report = parseState.reports.find(r => r.message_id === 1);
      expect(report?.events.some(e => e.message.startsWith('[结算]'))).toBe(true);
      expect(report?.events.some(e => e.message.includes('Δt=360'))).toBe(true);
    } finally {
      restore();
    }
  });
});

/* ═══════════════ E2d 接缝①：deployOf 经真接缝到达引擎（通道B） ═══════════════ */

describe('E2d 通道B 接线（批（八十八）：settleFloor 接缝注入 deployOf）', () => {
  const dt = '<timePast>0 D 6 H 0 M</timePast>';

  it('① lane 集成链：在场 deploy 目标建筑（produce.* 覆盖）经真接缝开通陆线，queued 升格', () => {
    const catalog = mkCatalog({
      productions: [
        { name: '轻型坦克', cost: 700, lane: 'lane.vehicle_land' } as never,
        {
          name: '前线战车组装车',
          cost: 2000,
          deploy: { into: '前线战车组装场', capabilities: ['produce.*'] },
        } as never,
      ],
    });
    const base = {
      id: 'B1',
      name: '主基地',
      power: { gen: 100, use: 0 },
      buildings: [{ name: '前线战车组装场', state: '运转' }],
    };
    const prev = mkStat({
      bases: [base],
      queues: [mkTxn({ type: '生产', item: '轻型坦克', base: 'B1', status: 'queued', total_minutes: 1440 })],
    });
    const next = mkStat({
      bases: [base],
      queues: [mkTxn({ type: '生产', item: '轻型坦克', base: 'B1', status: 'queued', total_minutes: 1440 })],
    });
    const r = settleFloor(prev, next, dt, { catalog });
    expect(r.data.queues[0].status).toBe('active'); // 「前线战车组装场」不含「战车工厂」：唯通道B 可开通
    expect(r.events.some(e => e.message.includes('promoted'))).toBe(true);

    // 对照：同在场建筑、无 deploy 块 → 通道A/B 均不命中 → 升格封死（隔离通道B 贡献）
    const catalogNoDeploy = mkCatalog({
      productions: [
        { name: '轻型坦克', cost: 700, lane: 'lane.vehicle_land' } as never,
        { name: '前线战车组装车', cost: 2000 } as never,
      ],
    });
    const r0 = settleFloor(prev, next, dt, { catalog: catalogNoDeploy });
    expect(r0.data.queues[0].status).toBe('queued');
  });

  it('① 研究槽集成链：deploy 授予 research 能力面 → slot.main 经真接缝开通升格', () => {
    const catalog = mkCatalog({
      researches: [{ name: '合成前沿学', line: '前沿机动', tier: 1, cost: 400 } as never],
      productions: [
        {
          name: '机动科研车',
          cost: 1500,
          deploy: { into: '机动科研前哨', capabilities: ['research'] },
        } as never,
      ],
    });
    const base = {
      id: 'B1',
      name: '主基地',
      power: { gen: 100, use: 0 },
      buildings: [{ name: '机动科研前哨', state: '运转' }],
    };
    const prev = mkStat({ bases: [base], queues: [mkTxn({ type: '研究', item: '合成前沿学', status: 'queued' })] });
    const next = mkStat({ bases: [base], queues: [mkTxn({ type: '研究', item: '合成前沿学', status: 'queued' })] });
    const r = settleFloor(prev, next, dt, { catalog });
    expect(r.data.queues[0].status).toBe('active'); // 未注册 line 兜底 slot.main；「机动科研前哨」不含「建造厂」/「MCV」
    expect(r.events.some(e => e.message.includes('promoted'))).toBe(true);

    // 对照：无 deploy 块 → slot.main 通道A/B 均不命中 → 封死
    const catalogNoDeploy = mkCatalog({
      researches: [{ name: '合成前沿学', line: '前沿机动', tier: 1, cost: 400 } as never],
      productions: [{ name: '机动科研车', cost: 1500 } as never],
    });
    const r0 = settleFloor(prev, next, dt, { catalog: catalogNoDeploy });
    expect(r0.data.queues[0].status).toBe('queued');
  });

  it('② 能力面不覆盖仍封死：前沿工地 build.whitelist 解不开研究槽（research）与陆线（produce.vehicle）', () => {
    const catalog = mkCatalog({
      researches: [{ name: '合成前沿学', line: '前沿机动', tier: 1, cost: 400 } as never],
      productions: [
        { name: '轻型坦克', cost: 700, lane: 'lane.vehicle_land' } as never,
        {
          name: '前沿基地建设车',
          cost: 2000,
          deploy: { into: '前沿工地', capabilities: ['build.whitelist'] },
        } as never,
      ],
    });
    const base = {
      id: 'B1',
      name: '主基地',
      power: { gen: 100, use: 0 },
      buildings: [{ name: '前沿工地', state: '运转' }],
    };
    const queues = [
      mkTxn({ type: '研究', item: '合成前沿学', status: 'queued' }),
      mkTxn({ type: '生产', item: '轻型坦克', base: 'B1', status: 'queued', total_minutes: 1440 }),
    ];
    const prev = mkStat({ bases: [base], queues });
    const next = mkStat({ bases: [base], queues });
    const r = settleFloor(prev, next, dt, { catalog });
    expect(r.data.queues[0].status).toBe('queued'); // build.whitelist 不覆盖 research
    expect(r.data.queues[1].status).toBe('queued'); // build.whitelist 不覆盖 produce.vehicle
    expect(r.events.some(e => e.message.includes('promoted'))).toBe(false);
  });

  it('③ deploy 数据缺失/三池缺池：安全降级不炸，通道A 既有行为不变', () => {
    // 运行时对象缺 productions/retrofits 池（模拟旧存档/类型外形状）＋ 畸形 deploy 块（缺 into）
    const catalog = mkCatalog({
      researches: [{ name: '基础军务学', line: '人员', tier: 1, cost: 400 } as never],
      buildings: [{ name: '空部署块设施', cost: 100, power: 0, deploy: {} } as never],
    });
    delete (catalog as unknown as Record<string, unknown>).productions;
    delete (catalog as unknown as Record<string, unknown>).retrofits;
    const base = {
      id: 'B1',
      name: '主基地',
      power: { gen: 100, use: 0 },
      buildings: [
        { name: '兵营', state: '运转' },
        { name: '空部署块设施', state: '运转' },
      ],
    };
    const prev = mkStat({ bases: [base], queues: [mkTxn({ type: '研究', item: '基础军务学', status: 'queued' })] });
    const next = mkStat({ bases: [base], queues: [mkTxn({ type: '研究', item: '基础军务学', status: 'queued' })] });
    const r = settleFloor(prev, next, dt, { catalog });
    expect(r.data.queues[0].status).toBe('active'); // 通道A（兵营在场）不受缺池影响
    expect(r.events.some(e => e.message.includes('promoted'))).toBe(true);
  });
});

/* ═══════════════ E3a 部署接缝（④″ settleDeployments 接入既有结算链，仿 ④′ 接缝形制） ═══════════════ */
describe('E3a 部署接缝（settleDeployments 到达／requestDeployment 入账与拒收留痕）', () => {
  const dt = '<timePast>0 D 6 H 0 M</timePast>'; // Δt=360
  const deployCatalog = () =>
    mkCatalog({
      productions: [
        { name: '前沿基地建设车', deploy: { into: '前沿工地', duration_min: 600, reverse: true } } as never,
      ],
    });
  const baseWith = (buildings: { name: string; state?: string }[]) => ({
    id: '北坡主基地',
    name: '北坡主基地',
    power: { gen: 100, use: 0 },
    buildings,
  });

  it('接缝到达：在途展开经 settleFloor 结算翻转（vehicles→buildings），事件入 instruction 层', () => {
    const next = mkStat({
      bases: [baseWith([{ name: '盟军发电站', state: '运转' }])],
      forces: { vehicles: ['前沿基地建设车'] },
      pending_deployments: [
        { vehicle: '前沿基地建设车', action: '展开', base: '北坡主基地', into: '前沿工地', remaining_minutes: 60 },
      ],
    });
    const r = settleFloor(mkStat(), next, dt, { catalog: null });
    expect(r.data.forces.vehicles).toEqual([]);
    expect(r.data.bases[0].buildings.map(b => b.name)).toContain('前沿工地');
    expect(r.data.pending_deployments).toEqual([]);
    expect(r.events.some(e => e.light === '🟢' && e.message.includes('deployment_done'))).toBe(true);
  });

  it('deployOrders 入账接缝：合法令入账（Δt=0 不翻转）；冲突护栏拒收 🟡 留痕', () => {
    const next = mkStat({
      bases: [baseWith([])],
      forces: { vehicles: ['前沿基地建设车'] },
    });
    const booked = settleFloor(mkStat(), next, '无标签正文', {
      catalog: deployCatalog(),
      deployOrders: [{ vehicle: '前沿基地建设车', action: '展开', base: '北坡主基地', into: '前沿工地' }],
    });
    expect(booked.data.pending_deployments).toEqual([
      { vehicle: '前沿基地建设车', action: '展开', base: '北坡主基地', into: '前沿工地', remaining_minutes: 600 },
    ]); // duration 读 catalog deploy.duration_min
    expect(booked.data.forces.vehicles).toContain('前沿基地建设车'); // Δt=0 不翻转

    const conflict = mkStat({
      bases: [baseWith([{ name: '前沿工地', state: '运转' }])],
      forces: { vehicles: [] },
      pending_mode_switches: [
        { base: '北坡主基地', building: '前沿工地', target_mode: '加速', remaining_minutes: 720 },
      ],
    });
    const rejected = settleFloor(mkStat(), conflict, '无标签正文', {
      catalog: deployCatalog(),
      deployOrders: [{ vehicle: '前沿基地建设车', action: '收起', base: '北坡主基地', into: '前沿工地' }],
    });
    expect(rejected.data.pending_deployments).toBeUndefined();
    expect(rejected.events.some(e => e.light === '🟡' && e.message.includes('部署令拒收'))).toBe(true);
  });

  it('零行为变化：无挂载无 deployOrders（含 catalog 缺席）→ 无部署事件、状态不动', () => {
    const next = mkStat({ bases: [baseWith([{ name: '盟军发电站', state: '运转' }])], forces: { vehicles: ['MCV'] } });
    const r = settleFloor(mkStat(), next, dt, { catalog: null });
    expect(r.data.pending_deployments).toBeUndefined();
    expect(r.data.forces.vehicles).toEqual(['MCV']);
    expect(r.events.some(e => e.message.includes('deployment_') || e.message.includes('部署令'))).toBe(false);
  });
});

/* ═══════════════ UTO-SETTLE-01 · 三路硬编码分流消解与跨领域混合并发结算回归 ═══════════════ */

describe('UTO-SETTLE-01 · settleFloor.ts 三路硬编码分流消解与 UTO 编排管道无损接管', () => {
  const settleFloorSrc = readFileSync(join(__dirname, '../engines/settleFloor.ts'), 'utf8');

  it('① 静态源码断言：彻底清零 txn.type 三路硬编码分流与底层槽位散装导入，接入 LaneRegistryHub 与 UTO 管道', () => {
    // 1. 彻底移除 txn.type === '研究' / '工程' / '生产' 三元产线分流硬编码
    expect(settleFloorSrc).not.toMatch(/txn\.type\s*===\s*['"]研究['"]/);
    expect(settleFloorSrc).not.toMatch(/txn\.type\s*===\s*['"]工程['"]/);
    expect(settleFloorSrc).not.toMatch(/txn\.type\s*===\s*['"]生产['"]/);
    expect(settleFloorSrc).not.toContain('researchKeyFor');
    expect(settleFloorSrc).not.toContain('engKeyFor');
    expect(settleFloorSrc).not.toContain('prodKeyFor');
    expect(settleFloorSrc).not.toContain('researchLimitFor');
    expect(settleFloorSrc).not.toContain('engLimitFor');
    expect(settleFloorSrc).not.toContain('prodLimitFor');

    // 2. 移除底层槽位散装工厂导入
    expect(settleFloorSrc).not.toContain("from './researchSlots'");
    expect(settleFloorSrc).not.toContain("from './engineeringSlots'");
    expect(settleFloorSrc).not.toContain('makeLaneKeyFor');
    expect(settleFloorSrc).not.toContain('makeProdLaneKeyFor');
    expect(settleFloorSrc).not.toContain('makeEngLaneKeyFor');

    // 3. 确认已接入 LaneRegistryHub 与 UTO 编排管道，且严守纯函数红线（零 Pinia/Vue/宿主/DOM）
    expect(settleFloorSrc).toContain('createLaneRegistryHub');
    expect(settleFloorSrc).toContain('resolveLaneKeyForTxn');
    expect(settleFloorSrc).toContain('resolveParallelLimitForTxn');
    expect(settleFloorSrc).toContain('resolveGlobalLimitForType');
    expect(settleFloorSrc).toContain('resolveAccelEffForTxn');
    expect(settleFloorSrc).toContain('tickTaskOrchestration');
    expect(settleFloorSrc).toContain('applyUnifiedCommands');
    expect(settleFloorSrc).toContain('toUnifiedTasks');
    expect(settleFloorSrc).not.toMatch(/from\s+['"](?:vue|pinia)['"]/);
    expect(settleFloorSrc).not.toMatch(/\b(?:window|document|SillyTavern|TavernHelper)\b/);
  });

  it('② 跨领域混合并发结算：同楼涵盖建造（纳米抵扣）、批量生产（双模加速+四动词调度）、科研（techTier全局门+算力加速）与 V1/V2 工程（eng.main/eng.orbital）', () => {
    const catalog = mkCatalog({
      buildings: [
        {
          name: '磁暴线圈',
          cost: 1500,
          lane: 'lane.defense',
          assembly: { t_mat: 1, t_asm: 1, req_nanites: 100 },
        } as never,
        {
          name: '超算中心',
          cost: 12000,
          power: 150,
          outputs: { virtual: { compute: { tflops: 200, tops: 200 } } },
        } as never,
      ],
      productions: [
        { name: '犀牛主战坦克', cost: 900, lane: 'lane.vehicle_land' } as never,
        { name: '防空履带车', cost: 600, lane: 'lane.vehicle_land' } as never,
        { name: 'V3火箭发射车', cost: 800, lane: 'lane.vehicle_land' } as never,
      ],
      researches: [
        { name: '模块化主基地架构', line: '主建筑', tier: 1, workload: { days: 2, tflops: 100 } } as never,
        { name: '高效矿石精炼法', line: '工业基础', tier: 1, workload: { days: 2 } } as never,
        { name: '单兵战术数据链', line: '人员', tier: 1, workload: { days: 2 } } as never,
      ],
      retrofits: [
        {
          name: '灰熊坦克现代化改装',
          phases: [{ name: '火控换装', workload: { days: 2, tops: 100 } }],
        } as never,
      ],
      projects: [
        {
          name: '天基轨道船坞',
          modules: [{ id: 'core', name: '核心舱段', workload: { days: 2, tflops: 100, tops: 100 } }],
        } as never,
      ],
    });

    // T1 科技梯级：僅盟军建造厂（无作战实验室 → techTier=1，研究全局上限=2）；
    // 陆地载具线：1 座生产模式战车工厂 + 1 座加速模式战车工厂 → capacity=1，accelEff=1.25x；
    // 工程槽：战车工厂开通 eng.main（capacity=1），天基轨道船坞开通 eng.orbital（capacity=1）
    const base = {
      id: 'B1',
      name: '北坡主基地',
      power: { gen: 5000, use: 500 },
      buildings: [
        { name: '盟军建造厂', state: '运转', mode: '生产' },
        { name: '矿石精炼厂', state: '运转', mode: '生产' },
        { name: '兵营', state: '运转', mode: '生产' },
        { name: '战车工厂', state: '运转', mode: '生产' },
        { name: '战车工厂', state: '运转', mode: '加速' },
        { name: '天基轨道船坞', state: '运转', mode: '生产' },
        { name: '超算中心', state: '运转' },
      ],
    };

    const queues: (TransactionItem & { lane?: string })[] = [
      // [0] 建造：零进度 active，吃 100% 纳米抵扣（注入阶段一 720 分钟）+ Δt=360 推进 360 → 1080
      mkTxn({ type: '建造', item: '磁暴线圈', base: 'B1', status: 'active', total_minutes: 1440, spent_minutes: 0 }),
      // [1] 批量生产：active，qty=4，total=1440（单件 360），已 spent=300；Δt=360 × 1.25(双模加速) = +450 → spent=750, qty_done=2
      mkTxn({
        type: '生产',
        item: '犀牛主战坦克',
        base: 'B1',
        status: 'active',
        total_minutes: 1440,
        spent_minutes: 300,
        progress: 20.83,
        qty: 4,
        qty_done: 0,
      }),
      // [2] 同产线候列：防空履带车（queued, spent=120），测试暂缓/恢复调度不丢进度
      mkTxn({
        type: '生产',
        item: '防空履带车',
        base: 'B1',
        status: 'queued',
        total_minutes: 720,
        spent_minutes: 120,
        progress: 16.67,
        hold: true,
      }),
      // [3] 科研 1（主建筑槽，阶段二吃算力 1.7x）：spent=1440 + 360×1.7 = 2052
      mkTxn({
        type: '研究',
        item: '模块化主基地架构',
        base: 'B1',
        status: 'active',
        total_minutes: 2880,
        spent_minutes: 1440,
        progress: 50,
      }),
      // [4] 科研 2（工业基础槽）：queued → 经带宽门升格为 active（占满 T1 全局上限 2/2）
      mkTxn({
        type: '研究',
        item: '高效矿石精炼法',
        base: 'B1',
        status: 'queued',
        total_minutes: 2880,
        spent_minutes: 0,
      }),
      // [5] 科研 3（人员槽）：虽兵营在场单槽开通，但受 techTier=1 全局上限 2 拦截，保持 queued
      mkTxn({
        type: '研究',
        item: '单兵战术数据链',
        base: 'B1',
        status: 'queued',
        total_minutes: 2880,
        spent_minutes: 0,
      }),
      // [6] V1 工程阶段（eng:eng.main，阶段二吃 tops 算力 1.7x）：spent=1440 + 360×1.7 = 2052
      {
        ...mkTxn({
          type: '工程',
          item: '灰熊坦克现代化改装·火控换装',
          base: 'B1',
          status: 'active',
          total_minutes: 2880,
          spent_minutes: 1440,
          progress: 50,
        }),
        lane: 'eng:eng.main',
      },
      // [7] V2 仓段巨构模块（eng:eng.orbital，阶段二吃双算力 2.0x）：spent=1440 + 360×2.0 = 2160
      {
        ...mkTxn({
          type: '工程',
          item: '天基轨道船坞·核心舱段',
          base: 'B1',
          status: 'active',
          total_minutes: 2880,
          spent_minutes: 1440,
          progress: 50,
        }),
        lane: 'eng:eng.orbital',
      },
    ];

    const state = mkStat({
      bases: [base],
      economy: { credits: 10000, resources: { nanites: { structural: 100 } } },
      queues,
    });

    const settled = settleFloor(state, state, '<timePast>0 D 6 H 0 M</timePast>', {
      catalog,
      orders: [{ item: '防空履带车', base: 'B1', type: '生产', verb: '恢复' }],
    });

    const q = settled.data.queues;
    // [0] 建造：纳米抵扣 720 + Δt 360 = 1080
    expect(q[0].spent_minutes).toBeCloseTo(1080);
    expect(settled.events.some(e => e.message.includes('nanites_deducted') && e.message.includes('磁暴线圈'))).toBe(
      true,
    );
    // [1] 批量生产：300 + 360 × 1.5(1座生产+1座加速=+50%) = 840，qty_done = floor(840 / 360) = 2
    expect(q[1].spent_minutes).toBeCloseTo(840);
    expect(q[1].qty_done).toBe(2);
    expect(settled.events.some(e => e.message.includes('qty_progress') && e.message.includes('2/4'))).toBe(true);
    // [2] 恢复调度令：hold 解除为 false，因战车工厂容量=1（已被犀牛占用）保持 queued，且 spent_minutes=120 恒等保留
    expect(q[2].hold).toBe(false);
    expect(q[2].status).toBe('queued');
    expect(q[2].spent_minutes).toBe(120);
    // [3] 科研 1：阶段二算力加速 1.7x → 2052
    expect(q[3].spent_minutes).toBeCloseTo(2052);
    // [4] 科研 2：升格为 active（2/2）
    expect(q[4].status).toBe('active');
    // [5] 科研 3：受 T1 全局上限 2 约束，保持 queued
    expect(q[5].status).toBe('queued');
    // [6] V1 工程阶段（eng.main）：1440 + 360 × 1.7 = 2052
    expect(q[6].spent_minutes).toBeCloseTo(2052);
    // [7] V2 巨构模块（eng.orbital）：1440 + 360 × 2.0 = 2160
    expect(q[7].spent_minutes).toBeCloseTo(2160);
  });

  it('③ 端到端闭环：Δt 推进至 settling → 三色对账门认领（MATCH/UNDERRUN/OVERRUN） → syncProjects 里程碑回写与 ④′/④″/④⁗ 协同', () => {
    const catalog = mkCatalog({
      productions: [
        { name: '犀牛主战坦克', cost: 900, lane: 'lane.vehicle_land' } as never,
        { name: '前沿基地建设车', deploy: { into: '前沿工地', duration_min: 300, reverse: true } } as never,
      ],
      researches: [{ name: '高能激光导引学', line: '防御辅助', tier: 1, workload: { days: 1 } } as never],
    });

    const base = {
      id: 'B1',
      name: '北坡主基地',
      power: { gen: 2000, use: 200 },
      buildings: [
        { name: '盟军建造厂', state: '运转', mode: '生产' },
        { name: '雷达站', state: '运转', mode: '生产' },
        { name: '战车工厂', state: '运转', mode: '生产' },
        { name: '兵营', state: '运转', mode: '生产' },
        { name: '航天发射中心', state: '运转', mode: '生产' },
      ],
    };

    // 初始队列：[0] 科研（差 300 分满额）、[1] V1 改装末阶段（queue_index=1，差 300 分满额）、
    // [2] V2 巨构唯一模块（queue_index=2，差 300 分满额）、[3] 批量生产犀牛（qty=2, 差 300 分满额，置于末尾防 UNDERRUN 拆项偏移前序索引）
    const initial = mkStat({
      bases: [base],
      forces: { vehicles: ['前沿基地建设车'] },
      pending_mode_switches: [{ base: 'B1', building: '战车工厂', target_mode: '加速', remaining_minutes: 300 }],
      pending_deployments: [
        { vehicle: '前沿基地建设车', action: '展开', base: 'B1', into: '前沿工地', remaining_minutes: 300 },
      ],
      queues: [
        mkTxn({
          type: '研究',
          item: '高能激光导引学',
          base: 'B1',
          status: 'active',
          total_minutes: 1440,
          spent_minutes: 1140,
        }),
        {
          ...mkTxn({
            type: '工程',
            item: '灰熊坦克现代化改装·火控换装',
            base: 'B1',
            status: 'active',
            total_minutes: 1440,
            spent_minutes: 1140,
          }),
          lane: 'eng:eng.main',
        },
        {
          ...mkTxn({
            type: '工程',
            item: '天基轨道船坞·核心舱段',
            base: 'B1',
            status: 'active',
            total_minutes: 1440,
            spent_minutes: 1140,
          }),
          lane: 'eng:eng.orbital',
        },
        mkTxn({
          type: '生产',
          item: '犀牛主战坦克',
          base: 'B1',
          status: 'active',
          total_minutes: 1440,
          spent_minutes: 1140,
          qty: 2,
          qty_done: 1,
        }),
      ],
      projects: [
        {
          id: 'proj:v1',
          ref: '灰熊坦克现代化改装',
          scope: 'base',
          lead_base: 'B1',
          bases: ['B1'],
          grade: '中改',
          status: '在建',
          phases: [{ idx: 0, name: '火控换装', status: '进行中', queue_index: 1 }],
        },
        {
          schema_version: 2,
          id: 'proj:v2',
          ref: '天基轨道船坞',
          scope: 'base',
          lead_base: 'B1',
          bases: ['B1'],
          grade: '巨构',
          status: '在建',
          modules: [{ id: 'core', name: '核心舱段', status: '进行中', base: 'B1', queue_index: 2 }],
        },
      ],
    });

    // 第一步：Δt = 360 分钟推进（显式传 autoSettleCompleted: false 以专门测试三色门 UNDERRUN 拆分与手动对账分支）
    // 同时 ④′ 模式切换完成、④″ 展开车翻转完成、④⁗ 资金链建立并计息
    const step1 = settleFloor(initial, initial, '<timePast>0 D 6 H 0 M</timePast>', {
      catalog,
      autoSettleCompleted: false,
      eventDeclarations: [
        {
          kind: 'chain',
          verb: '资金链建立',
          raw: '资金链建立',
          chain: { name: '北坡矿脉专线', flow: 'in', rate_daily: 2400, reason: '矿脉贯通' },
        },
      ],
    });

    expect(step1.data.queues.every(q => q.status === 'settling')).toBe(true);
    expect(step1.data.pending_mode_switches).toEqual([]);
    expect(step1.data.bases[0].buildings.find(b => b.name === '战车工厂')?.mode).toBe('加速');
    expect(step1.data.bases[0].buildings.some(b => b.name === '前沿工地')).toBe(true);
    expect(step1.data.economy.credits).toBe(600); // 2400/日 × (360/1440) = +600

    // 第二步：过三色对账门（reconcileProduction）——
    // 科研 MATCH（1项）→ done 并入 tech.done；犀牛坦克 UNDERRUN（声明 1 辆 < 2 辆）→ 拆出 1 辆 done，余 1 辆退回 active；
    // 未在队幽灵项目 OVERRUN → 拦截告警
    const prodDecls = parseProductionDeclarations(
      '<生产>\n- 高能激光导引学: 1项\n- 犀牛主战坦克: 1辆\n- 幻影重型巡洋舰: 1艘\n</生产>',
    );
    const reconciled = reconcileProduction(step1.data, prodDecls);
    expect(reconciled.verdicts.find(v => v.item === '高能激光导引学')?.verdict).toBe('MATCH');
    expect(reconciled.verdicts.find(v => v.item === '犀牛主战坦克')?.verdict).toBe('UNDERRUN');
    expect(reconciled.verdicts.find(v => v.item === '幻影重型巡洋舰')?.verdict).toBe('OVERRUN');
    expect(reconciled.next.tech.done).toContain('高能激光导引学');

    // 将两项工程投影项收讫置为 done（模拟工程阶段验收完成），再过 settleFloor 触发 ④‴ syncProjects 里程碑回写
    const afterEngClaim = {
      ...reconciled.next,
      queues: reconciled.next.queues.map(q => (q.type === '工程' ? { ...q, status: 'done' as const } : q)),
    };
    const step2 = settleFloor(reconciled.next, afterEngClaim, '无时间标签', { catalog });
    const projV1 = step2.data.projects[0] as {
      status: string;
      outcome?: { type: string };
      phases: { status: string }[];
    };
    const projV2 = step2.data.projects[1] as {
      status: string;
      outcome?: { type: string };
      modules: { status: string }[];
    };
    expect(projV1.phases[0].status).toBe('完工');
    expect(projV1.status).toBe('完工');
    expect(projV1.outcome).toEqual({ type: 'mark' });
    expect(projV2.modules[0].status).toBe('完工');
    expect(projV2.status).toBe('完工');
    expect(projV2.outcome).toEqual({ type: 'mark' });
    expect(step2.events.some(e => e.message.includes('project_completed'))).toBe(true);
  });

  it('④ orchestrateFloorTasks 编排管道桥接与 R21 槽位告警：settlingTaskIds 同源对齐且入参深冻结零突变', () => {
    const catalog = mkCatalog({
      productions: [{ name: '犀牛主战坦克', cost: 900, lane: 'lane.vehicle_land' } as never],
    });
    const state = mkStat({
      bases: [
        {
          id: 'B1',
          name: '北坡主基地',
          power: { gen: 1000, use: 100 },
          buildings: [{ name: '战车工厂', state: '运转', mode: '生产' }],
        },
      ],
      queues: [
        mkTxn({
          type: '生产',
          item: '犀牛主战坦克',
          base: 'B1',
          status: 'active',
          total_minutes: 360,
          spent_minutes: 0,
        }),
        {
          ...mkTxn({
            type: '工程',
            item: '非法槽位测试项·首段',
            base: 'B1',
            status: 'queued',
            total_minutes: 1440,
            spent_minutes: 0,
          }),
          lane: 'eng:invalid_slot_id',
        },
      ],
    });

    // R21 槽位告警：经 LaneRegistryHub warnSink 正常写入 issues；满工时项由系统自动交割为 done（BUG-R2-20）
    const settled = settleFloor(state, state, '<timePast>0 D 6 H 0 M</timePast>', { catalog });
    expect(settled.data.queues[0].status).toBe('done');
    expect(settled.issues.some(i => i.rule === 'R21' && i.level === 'warn')).toBe(true);

    // orchestrateFloorTasks 统一编排管道：深冻结入参零突变，settlingTaskIds 精确命中 task:queue:0
    Object.freeze(state);
    Object.freeze(state.queues);
    const orchestrated = orchestrateFloorTasks(state, 360, { catalog, now: '2042-03-14 14:00' });
    expect(orchestrated.lanes.length).toBeGreaterThan(0);
    expect(orchestrated.settlingTaskIds).toContain('task:queue:0');
    expect(orchestrated.tickResult.nextTasks.find(t => t.id === 'task:queue:0')?.status).toBe('settling');
  });

  it('⑤ 四动词满员抢占（置顶踢出末序 active 保进度）与六动词 UnifiedCommand（Cancel / Allocate）编排协同', () => {
    const catalog = mkCatalog({
      productions: [
        { name: '犀牛主战坦克', cost: 900, lane: 'lane.vehicle_land' } as never,
        { name: '防空履带车', cost: 600, lane: 'lane.vehicle_land' } as never,
        { name: 'V3火箭发射车', cost: 800, lane: 'lane.vehicle_land' } as never,
      ],
    });
    const state = mkStat({
      bases: [
        {
          id: 'B1',
          name: '北坡主基地',
          power: { gen: 1000, use: 100 },
          buildings: [{ name: '战车工厂', state: '运转', mode: '生产' }],
        },
      ],
      queues: [
        mkTxn({
          type: '生产',
          item: '犀牛主战坦克',
          base: 'B1',
          status: 'active',
          total_minutes: 1440,
          spent_minutes: 200,
          progress: 13.89,
        }),
        mkTxn({
          type: '生产',
          item: '防空履带车',
          base: 'B1',
          status: 'queued',
          total_minutes: 720,
          spent_minutes: 60,
          progress: 8.33,
        }),
        mkTxn({
          type: '生产',
          item: 'V3火箭发射车',
          base: 'B1',
          status: 'queued',
          total_minutes: 1080,
          spent_minutes: 0,
        }),
      ],
    });

    // 1. settleFloor：先执行 <队列> 置顶『防空履带车』抢占容量=1 的陆地载具线（犀牛被踢回 queued 且 spent_minutes=200 完整保留），
    //    随后经带宽门将队首『防空履带车』升格为 active（spent_minutes=60 保留），『V3火箭发射车』置 hold=true
    const settled = settleFloor(state, state, '<timePast>0 D 1 H 40 M</timePast>', {
      catalog,
      orders: [
        { item: '防空履带车', base: 'B1', type: '生产', verb: '置顶' },
        { item: 'V3火箭发射车', base: 'B1', type: '生产', verb: '暂缓' },
      ],
    });
    const topItem = settled.data.queues.find(q => q.item === '防空履带车');
    const demotedItem = settled.data.queues.find(q => q.item === '犀牛主战坦克');
    const heldItem = settled.data.queues.find(q => q.item === 'V3火箭发射车');
    expect(topItem?.status).toBe('active');
    expect(topItem?.spent_minutes).toBe(60);
    expect(demotedItem?.status).toBe('queued');
    expect(demotedItem?.spent_minutes).toBe(200);
    expect(heldItem?.hold).toBe(true);

    // 2. orchestrateFloorTasks：同时消费旧版 orders 与新版六动词 commands（Cancel），验证统一总线与时间步进协同
    const orchestrated = orchestrateFloorTasks(state, 100, {
      catalog,
      orders: [{ item: '防空履带车', base: 'B1', type: '生产', verb: '置顶' }],
      commands: [{ type: 'Cancel', taskId: 'task:queue:2' }],
      now: '2042-03-14 15:40',
    });
    expect(orchestrated.dispatchResult.demotions).toHaveLength(1);
    expect(orchestrated.dispatchResult.nextTasks.find(t => t.id === 'task:queue:2')?.status).toBe('cancelled');
    expect(orchestrated.tickResult.nextTasks.find(t => t.id === 'task:queue:1')?.status).toBe('active');
    expect(orchestrated.tickResult.nextTasks.find(t => t.id === 'task:queue:1')?.workload.spentMinutes).toBe(160);
  });

  it('④ FIX-P0-04 / FIX-P1-01：全局研究（base=""）汇总全战区运转建筑算力加速；协议排程事件入账；批量工期×qty 与纳米真实扣库存；无关受损建筑不连坐冻结', () => {
    const catalog = mkCatalog({
      buildings: [
        {
          name: '超算中心',
          cost: 12000,
          power: 150,
          outputs: { virtual: { compute: { tflops: 200, tops: 200 } } },
        } as never,
        {
          name: '防空炮',
          cost: 800,
          power: 20,
          operation: {
            conditions: [{ trigger: 'damaged', behavior: 'suspended', efficiency: 0, desc: '受损停摆' }],
          },
        } as never,
      ],
      productions: [
        {
          name: '犀牛主战坦克',
          cost: 900,
          lane: 'lane.vehicle_land',
          assembly: { min_days: 1, t_mat: 12, t_asm: 12, req_nanites: 50 },
        } as never,
      ],
      researches: [{ name: '超时空场论', line: '战略武器', tier: 1, workload: { days: 2, tflops: 100 } } as never],
    });

    const state = mkStat({
      bases: [
        {
          id: 'B1',
          name: '北坡基地',
          status: '隐蔽中',
          power: { gen: 1000, use: 200 },
          buildings: [
            { name: '战车工厂', state: '运转', mode: '生产' },
            { name: '超算中心', state: '运转' },
            { name: '防空炮', state: '受损' },
          ],
        },
        {
          id: 'B2',
          name: '陷落前哨',
          status: '失守',
          power: { gen: 1000, use: 100 },
          buildings: [{ name: '超算中心', state: '运转' }],
        },
      ],
      economy: { credits: 10000, resources: { nanites: { structural: 100 } } },
      queues: [
        // 全局研究（base=""）：已在阶段二起点（1440/2880），吃 B1 超算中心 1.7x 加速
        mkTxn({
          type: '研究',
          item: '超时空场论',
          base: '',
          status: 'active',
          total_minutes: 2880,
          spent_minutes: 1440,
          progress: 50,
        }),
        // 批量生产（qty=4, total_minutes=0）：回填 1440*4=5760，req_nanites=50*4=200，扣完 100 库存跳过 50% 阶段一（1440 分钟）
        mkTxn({
          type: '生产',
          item: '犀牛主战坦克',
          base: 'B1',
          status: 'active',
          total_minutes: 0,
          spent_minutes: 0,
          progress: 0,
          qty: 4,
          qty_done: 0,
        }),
      ],
      protocols: [
        {
          ref: 'soviet.iron_curtain_overload',
          status: 'available',
          exp: 0,
          attempts: 0,
          points_spent: 0,
          credits_spent: 0,
          discovered_via: 'init',
          auto_queued: false,
          hold: false,
        },
      ],
    });

    const settled = settleFloor(state, state, '<timePast>0 D 1 H 0 M</timePast>', {
      catalog,
      eventDeclarations: [
        {
          verb: '协议排程',
          kind: 'protocol',
          protocolAction: 'schedule',
          protocolId: 'soviet.iron_curtain_overload',
          protocolName: '铁幕紧急过载协议',
          scheduleAction: '加入候列',
        },
      ],
    });

    // 1. 全局研究拿到全战区非陷落基地算力加速（1440 + 60 * 1.7 = 1542）
    const research = settled.data.queues.find(q => q.item === '超时空场论')!;
    expect(research.spent_minutes).toBeCloseTo(1542);

    // 2. REPRO_4：批量工期回填乘以 qty=4（5760 分钟），纳米抵扣后经过 60 分钟仍在阶段一备料期，qty_done 保持 0，且纳米库存从 100 扣至 0
    const tank = settled.data.queues.find(q => q.item === '犀牛主战坦克')!;
    expect(tank.total_minutes).toBe(5760);
    expect(tank.spent_minutes).toBe(1440 + 60); // 受损防空炮不连坐冻结，正常推进 +60
    expect(tank.qty_done).toBe(0);
    expect(settled.data.economy.resources?.nanites?.structural).toBe(0);

    // 3. 协议排程事件入账：auto_queued 置为 true 且分配 queue_order=1
    expect(settled.data.protocols?.[0]).toMatchObject({
      ref: 'soviet.iron_curtain_overload',
      auto_queued: true,
      queue_order: 1,
      hold: false,
    });
  });

  it('④ FIX-P1-04：settleFloor 资金链结算后同步回写 economy.credits_daily，且支持 资金链恢复 / 资金链枯竭 事件', () => {
    const state = mkStat({
      economy: {
        credits: 1000,
        credits_daily: 0,
        chains: [
          {
            id: 'chain_走廊a',
            name: '走廊A',
            flow: '收入',
            rate_daily: 600,
            status: 'distressed',
            eff: 0.5,
            deps: { base_id: '', buildings: [], world_resource: '' },
            capacity: { total_yield: null, extracted: 0 },
            reason: '受挫中',
            updated_at_day: 1,
          },
          {
            id: 'chain_矿脉b',
            name: '矿脉B',
            flow: '收入',
            rate_daily: 400,
            status: 'active',
            eff: 1,
            deps: { base_id: '', buildings: [], world_resource: '' },
            capacity: { total_yield: 1000, extracted: 500 },
            reason: '正常开采',
            updated_at_day: 1,
          },
        ],
      },
    });

    const settled = settleFloor(state, state, '<timePast>1 D 0 H 0 M</timePast>', {
      eventDeclarations: [
        {
          verb: '资金链恢复',
          kind: 'chain',
          chain: { name: '走廊A', flow: '收入', rate_daily: 0, base_id: '', buildings: [], reason: '抢修完毕' },
        },
        {
          verb: '资金链枯竭',
          kind: 'chain',
          chain: { name: '矿脉B', flow: '收入', rate_daily: 0, base_id: '', buildings: [], reason: '矿脉坍塌枯竭' },
        },
      ],
    });

    // 走廊A 恢复为 active (eff=1, +600/日)，矿脉B 枯竭为 exhausted (eff=0, 0/日)
    expect(settled.data.economy.chains[0].status).toBe('active');
    expect(settled.data.economy.chains[0].eff).toBe(1);
    expect(settled.data.economy.chains[1].status).toBe('exhausted');
    expect(settled.data.economy.chains[1].eff).toBe(0);
    // 推进 1 天结算 +600，且 credits_daily 同步写回 600
    expect(settled.data.economy.credits).toBe(1600);
    expect(settled.data.economy.credits_daily).toBe(600);
  });

  it('⑤ G04-02：基地存在但 buildings 为 [] 或省略时，依赖特定建筑的资金链仍触发/保持挂起（eff=0），无 bases 最小存档兼容不变', () => {
    const chain = {
      id: 'chain_精炼矿线',
      name: '精炼矿线',
      flow: '收入' as const,
      rate_daily: 800,
      status: 'active' as const,
      eff: 1,
      deps: { base_id: 'B1', buildings: ['矿石精炼厂'], world_resource: '' },
      capacity: { total_yield: null, extracted: 0 },
      reason: '长期矿石合同',
      updated_at_day: 1,
    };

    // 1. 基地 buildings: []（最后一座依赖建筑已被移除）→ active 链挂起为 distressed (eff=0)，推进 1 天 0 收益
    const emptyBldState = mkStat({
      bases: [{ id: 'B1', name: '北坡基地', power: { gen: 200, use: 50 }, buildings: [] }],
      economy: { credits: 1000, credits_daily: 800, chains: [chain] },
    });
    const rEmpty = settleFloor(emptyBldState, emptyBldState, '<timePast>1 D 0 H 0 M</timePast>');
    expect(rEmpty.data.economy.chains[0].status).toBe('distressed');
    expect(rEmpty.data.economy.chains[0].eff).toBe(0);
    expect(rEmpty.data.economy.credits).toBe(1000);
    expect(rEmpty.data.economy.credits_daily).toBe(0);

    // 2. 基地省略 buildings 字段 → 同样挂起为 distressed (eff=0)，0 收益
    const rawOmittedState = mkStat({
      bases: [{ id: 'B1', name: '北坡基地', power: { gen: 200, use: 50 } }],
      economy: { credits: 1000, credits_daily: 800, chains: [chain] },
    });
    delete (rawOmittedState.bases[0] as Record<string, unknown>).buildings;
    const rOmitted = settleFloor(rawOmittedState, rawOmittedState, '<timePast>1 D 0 H 0 M</timePast>');
    expect(rOmitted.data.economy.chains[0].status).toBe('distressed');
    expect(rOmitted.data.economy.chains[0].eff).toBe(0);
    expect(rOmitted.data.economy.credits).toBe(1000);

    // 3. 已因建筑缺失挂起的链，在 buildings: [] 下绝不误恢复
    const rStillOutage = settleFloor(rEmpty.data, rEmpty.data, '<timePast>1 D 0 H 0 M</timePast>');
    expect(rStillOutage.data.economy.chains[0].status).toBe('distressed');
    expect(rStillOutage.data.economy.chains[0].eff).toBe(0);
    expect(rStillOutage.data.economy.credits).toBe(1000);

    // 4. 恢复依赖建筑「矿石精炼厂」（运转）后，链条恢复为 active (eff=1) 并正常产出 +800
    const restoredState = {
      ...rEmpty.data,
      bases: [
        {
          id: 'B1',
          name: '北坡基地',
          power: { gen: 200, use: 50 },
          buildings: [{ name: '矿石精炼厂', state: '运转' as const }],
        },
      ],
    };
    const rRestored = settleFloor(rEmpty.data, restoredState, '<timePast>1 D 0 H 0 M</timePast>');
    expect(rRestored.data.economy.chains[0].status).toBe('active');
    expect(rRestored.data.economy.chains[0].eff).toBe(1);
    expect(rRestored.data.economy.credits).toBe(1800);

    // 5. 完全无 bases 的最小存档兼容行为不变（跳过建筑存在性检查，保持原 active 产出）
    const noBasesState = mkStat({
      bases: [],
      economy: { credits: 1000, credits_daily: 800, chains: [chain] },
    });
    const rNoBases = settleFloor(noBasesState, noBasesState, '<timePast>1 D 0 H 0 M</timePast>');
    expect(rNoBases.data.economy.chains[0].status).toBe('active');
    expect(rNoBases.data.economy.chains[0].eff).toBe(1);
    expect(rNoBases.data.economy.credits).toBe(1800);
  });

  it('G02-04：协议点在 3×10m vs 1×30m、144×10m vs 1×1440m、1440×1m 及随机切片（含副官加成与跨 1.0 自动实验）下净额严格一致', () => {
    const runSlices = (initial: ReturnType<typeof mkStat>, slices: number[], catalog = mkCatalog()) => {
      let cur = initial;
      for (const mins of slices) {
        cur = settleFloor(cur, cur, `<timePast>0 D 0 H ${mins} M</timePast>`, { catalog }).data;
      }
      return cur;
    };

    const baseState = mkStat({
      bases: [
        {
          id: 'B1',
          name: '1号基地',
          power: { gen: 500, use: 100 },
          buildings: [{ name: '红星实验设计局综合体', state: '运转', mode: '生产' }],
        },
      ],
      protocol_points: 0.9,
      economy: { credits: 5000 },
      command: {
        unlocked_factions: ['soviet'],
        mcv_granted_factions: ['soviet'],
        adjutant_slots: [
          {
            slot_id: 'slot_1',
            role: 'doctrine_director',
            assignee: '库可夫',
            identity: 'human',
            faction: 'soviet',
            tier: 'high',
            scope: 'global',
            status: 'active',
            assigned_at_day: 1,
          },
        ],
        break_in_penalties: [],
        first_unlock_free_used: true,
      },
      protocols: [
        {
          ref: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
          status: 'available',
          attempts: 0,
          exp: 0,
          points_spent: 0,
          credits_spent: 0,
          auto_queued: true,
          queue_order: 1,
          hold: false,
          updated_at_day: 1,
          schema_version: 1,
        },
      ],
    });

    // 1. 3 × 10 min vs 1 × 30 min
    const s3x10 = runSlices(baseState, [10, 10, 10]);
    const s1x30 = runSlices(baseState, [30]);
    expect(s3x10.protocol_points).toBe(s1x30.protocol_points);

    // 2. 144 × 10 min vs 1440 × 1 min vs 随机切片 vs 1 × 1440 min（跨过 1.0 整点门槛触发自动实验并扣除 1 点）
    const protoCatalog = mkCatalog({
      protocols: [
        {
          id: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
          name: '战斗工兵—预制战斗碉堡协议',
          faction: '苏联',
          track: '钢铁基干与国家动员',
          tier: 1,
          cost_points: 1,
          experiment_cost_credits: 500,
        },
      ] as never,
    });
    const oneDay = runSlices(baseState, [1440], protoCatalog);
    const by10Min = runSlices(baseState, Array(144).fill(10), protoCatalog);
    const by1Min = runSlices(baseState, Array(1440).fill(1), protoCatalog);
    const randomSlices = runSlices(baseState, [7, 13, 25, 95, 180, 160, 480, 11, 29, 40, 100, 300], protoCatalog);

    expect(oneDay.protocols[0].attempts).toBe(1);
    expect(by10Min.protocols[0].attempts).toBe(1);
    expect(by1Min.protocols[0].attempts).toBe(1);
    expect(randomSlices.protocols[0].attempts).toBe(1);

    expect(by10Min.protocol_points).toBe(oneDay.protocol_points);
    expect(by1Min.protocol_points).toBe(oneDay.protocol_points);
    expect(randomSlices.protocol_points).toBe(oneDay.protocol_points);
  });

  it('BUG-LIVE-02a/02b, 03, 04, 05, 08, 10 · 百楼真机全链路回归验证', () => {
    const catalog = mkCatalog({
      buildings: [
        { name: '盟军建造厂', cost: 2500, power: -50 } as never,
        { name: '发电厂', cost: 800, power: -200 } as never,
        { name: '兵营', cost: 500, power: 20 } as never,
        { name: '战车工厂', cost: 2000, power: 50 } as never,
      ],
      productions: [
        { name: '美国大兵', cost: 200, category: 'infantry', need_buildings: ['兵营'] } as never,
        { name: 'M2A3布拉德利步兵战车', cost: 800, category: 'vehicle', need_buildings: ['战车工厂'] } as never,
      ],
      researches: [
        { name: '战地急救学', line: '人员', tier: 1, cost: 500, workload: { days: 1, min_days: 0.5 } } as never,
      ],
    });

    // 1. BUG-LIVE-03 & BUG-LIVE-10：有符号数字型 BuildingDef.power（发电厂 -200 发电、兵营 +20 耗电）正确汇总；
    //    且本楼新建（prevData 无此项）的零进度 queued 项在空闲产线上预升格为 active 并参与本楼 Δt 积分
    const prev = mkStat({
      bases: [
        {
          id: 'B1',
          name: '恶土前哨主基地',
          power: { gen: 50, use: 0 },
          buildings: [
            { name: '盟军建造厂', state: '运转' },
            { name: '发电厂', state: '运转' },
            { name: '兵营', state: '运转' },
            { name: '战车工厂', state: '运转' },
          ],
        },
      ],
      queues: [],
    });
    const nextWithNewQueued = mkStat({
      bases: prev.bases,
      queues: [
        mkTxn({
          type: '生产',
          item: '美国大兵',
          base: 'B1',
          status: 'queued',
          total_minutes: 600,
          spent_minutes: 0,
        }),
      ],
    });
    const settled = settleFloor(prev, nextWithNewQueued, '<timePast>0 D 5 H 0 M</timePast>', { catalog });
    // 电网：盟军建造厂(50) + 发电厂(200) = 250 发电；兵营(20) + 战车工厂(50) = 70 耗电
    expect(settled.data.bases[0].power).toEqual({ gen: 250, use: 70 });
    // 本楼新建的美国大兵在空闲兵营产线立即预升格并吃满 300 分钟 Δt
    expect(settled.data.queues[0].status).toBe('active');
    expect(settled.data.queues[0].spent_minutes).toBe(300);
  });

  it('BUG-LIVE-25（#72楼实机复现）：基地拥有运转态「苏联战车工厂」时，依赖「战车工厂」的资金链「北境重工备件外包网」经 setHasEquivalentBuilding 等价匹配保持 active (eff=1) 并正常计息', () => {
    const prev = mkStat({
      economy: { credits: 10000, credits_daily: 0, chains: [] },
      bases: [
        {
          id: '铁砧重矿前哨分基地',
          name: '铁砧重矿前哨分基地',
          power: { gen: 250, use: 120 },
          buildings: [
            { name: '苏联建造厂', state: '运转' },
            { name: '苏联磁能反应炉', state: '运转' },
            { name: '苏联战车工厂', state: '运转' },
          ],
        },
      ],
    });
    const next = mkStat({
      economy: {
        credits: 10000,
        credits_daily: 0,
        chains: [
          {
            id: 'chain_北境重工备件外包网',
            name: '北境重工备件外包网',
            flow: '收入',
            rate_daily: 900,
            status: 'active',
            eff: 1,
            deps: {
              base_id: '铁砧重矿前哨分基地',
              buildings: ['战车工厂'],
              world_resource: '',
            },
            capacity: { total_yield: null, extracted: 0 },
            reason: '铁砧重矿前哨分基地战车工厂投产后向荒原自由佣兵团定向供应标准履带与装甲备件',
            updated_at_day: 1,
          },
        ],
      },
      bases: prev.bases,
    });

    const settled = settleFloor(prev, next, '<timePast>1 D 0 H 0 M</timePast>');
    const chainAfter = settled.data.economy.chains[0];
    expect(chainAfter.status).toBe('active');
    expect(chainAfter.eff).toBe(1);
    expect(settled.events.some(e => e.message.includes('电网断供'))).toBe(false);
    expect(settled.data.economy.credits).toBe(10900);
  });

  it('BUG-LIVE-27（#80/#82楼实机复现）：在同一基地（含苏联战车工厂+苏联兵营）同时入列「通用履带底盘与空降轻装族×2」与「动员兵×10」时，二者分别路由至战车产线与步兵产线双双升格 active，并在下一楼推进时间后双双 enter_settling -> MATCH 完工零 OVERRUN', () => {
    const catalog = mkCatalog({
      productions: [
        {
          name: '动员兵',
          cost: 200,
          need_building: '兵营',
          need_buildings: ['兵营'],
          category: 'infantry',
          tags: ['人员相关', '轻装快速'],
        } as never,
        {
          name: '通用履带底盘与空降轻装族',
          aliases: ['防空履带车', '苏联防空履带车', '履带防空车'],
          cost: 500,
          need_building: '战车工厂',
          need_buildings: ['战车工厂'],
          category: 'vehicle',
          tags: ['载具建造', '轻装快速'],
        } as never,
      ],
    });
    const baseState = mkStat({
      bases: [
        {
          id: '铁砧重矿前哨分基地',
          name: '铁砧重矿前哨分基地',
          power: { gen: 300, use: 150 },
          buildings: [
            { name: '苏联建造厂', state: '运转', mode: '生产' },
            { name: '苏联磁能反应炉', state: '运转', mode: '生产' },
            { name: '苏联矿石精炼厂', state: '运转', mode: '生产' },
            { name: '苏联战车工厂', state: '运转', mode: '生产' },
            { name: '苏联兵营', state: '运转', mode: '生产' },
          ],
        },
      ],
      queues: [
        mkTxn({
          type: '生产',
          item: '通用履带底盘与空降轻装族',
          base: '铁砧重矿前哨分基地',
          status: 'queued',
          total_minutes: 288,
          spent_minutes: 0,
          qty: 2,
        }),
        mkTxn({
          type: '生产',
          item: '动员兵',
          base: '铁砧重矿前哨分基地',
          status: 'queued',
          total_minutes: 580,
          spent_minutes: 0,
          qty: 10,
        }),
      ],
    });

    // #80楼落盘前 0 分钟升格门：两条生产队列分别走战车工厂线与兵营线，双双升格为 active
    const promoted80 = promoteIdleQueuesAtZeroDelta(baseState, catalog);
    expect(promoted80.data.queues[0].status).toBe('active');
    expect(promoted80.data.queues[1].status).toBe('active');

    // #82楼推进 1 天（1440 分钟）：两条 active 队列满工时由系统自动交割为 done（BUG-R2-20），同楼 <生产> 对账门幂等认领双双 MATCH 完工零 OVERRUN
    const settled82 = settleFloor(promoted80.data, promoted80.data, '<timePast>1 D 0 H 0 M</timePast>', {
      catalog,
    });
    expect(settled82.data.queues[0].status).toBe('done');
    expect(settled82.data.queues[1].status).toBe('done');

    const decls82 = parseProductionDeclarations(
      '<生产>\n- 通用履带底盘与空降轻装族: 2辆\n- 动员兵: 10人\n</生产>',
    );
    const reconciled82 = reconcileProduction(settled82.data, decls82);
    expect(reconciled82.verdicts.find(v => v.item === '通用履带底盘与空降轻装族')?.verdict).toBe('MATCH');
    expect(reconciled82.verdicts.find(v => v.item === '动员兵')?.verdict).toBe('MATCH');
    expect(reconciled82.verdicts.some(v => v.verdict === 'OVERRUN')).toBe(false);
  });

  it('BUG-R2-02b（#10楼 Swipe 0 实机复现）：基地严重缺电（50/160，gridEff=0.5）时，生产队列（美国大兵、M1A1灰熊主战坦克）与研究队列同样受 gridEff=0.5 约束（120m 内推进 60m 而非 120m）', () => {
    const catalog = mkCatalog({
      buildings: [
        { name: '盟军建造厂', cost: 3000, power: { gen: 50, use: 0 } } as never,
        { name: '盟军发电厂', cost: 800, power: { gen: 200, use: 0 } } as never,
        { name: '兵营', cost: 500, power: { gen: 0, use: 20 } } as never,
        { name: '战车工厂', cost: 2000, power: { gen: 0, use: 50 } } as never,
      ],
      productions: [
        { name: '美国大兵', cost: 200, lane: 'lane.personnel' } as never,
        { name: 'M1A1灰熊主战坦克', cost: 700, lane: 'lane.vehicle_land' } as never,
      ],
      researches: [{ name: '装甲载具工学', line: '陆地载具', tier: 1, workload: { days: 2 } } as never],
    });

    const lowPowerState = mkStat({
      bases: [
        {
          id: '恶土前哨主基地',
          name: '恶土前哨主基地',
          power: { gen: 50, use: 160 },
          buildings: [
            { name: '盟军建造厂', state: '运转' },
            { name: '盟军发电厂', state: '受损' },
            { name: '兵营', state: '运转', mode: '生产' },
            { name: '战车工厂', state: '运转', mode: '生产' },
          ],
        },
      ],
      queues: [
        mkTxn({
          type: '研究',
          item: '装甲载具工学',
          base: '恶土前哨主基地',
          status: 'active',
          total_minutes: 2880,
          spent_minutes: 0,
        }),
        mkTxn({
          type: '生产',
          item: '美国大兵',
          base: '恶土前哨主基地',
          status: 'active',
          total_minutes: 240,
          spent_minutes: 0,
          qty: 4,
        }),
        mkTxn({
          type: '生产',
          item: 'M1A1灰熊主战坦克',
          base: '恶土前哨主基地',
          status: 'active',
          total_minutes: 360,
          spent_minutes: 0,
          qty: 2,
        }),
      ],
    });

    const settled10 = settleFloor(lowPowerState, lowPowerState, '<timePast>0 D 2 H 0 M</timePast>', {
      catalog,
    });
    const rQueue = settled10.data.queues.find(q => q.item === '装甲载具工学')!;
    const giQueue = settled10.data.queues.find(q => q.item === '美国大兵')!;
    const tankQueue = settled10.data.queues.find(q => q.item === 'M1A1灰熊主战坦克')!;
    expect(rQueue.spent_minutes).toBeCloseTo(60);
    expect(giQueue.spent_minutes).toBeCloseTo(60);
    expect(tankQueue.spent_minutes).toBeCloseTo(60);
  });

  it('BUG-R2-14（#4/#6/#7/#8楼实机复现）：① S3_RECONCILE 核销发电厂/兵营完工转运转后 recomputeBasePowerFromCatalog 即刻重算 base.power；② 同车道串行 active+queued 溢出 Δt 顺延推进下一项零 OVERRUN', () => {
    const catalog = mkCatalog({
      buildings: [
        { name: '盟军建造厂', cost: 3000, power: { gen: 50, use: 0 } } as never,
        { name: '盟军发电厂', cost: 800, power: { gen: 200, use: 0 } } as never,
        { name: '兵营', cost: 500, power: { gen: 0, use: 20 } } as never,
      ],
      researches: [
        { name: '基础步兵训练学', line: '人员', tier: 1, workload: { days: 2 } } as never,
        { name: '个人装备工程学', line: '人员', tier: 1, workload: { days: 2 } } as never,
      ],
    });

    const state4 = mkStat({
      bases: [
        {
          id: '恶土前哨主基地',
          name: '恶土前哨主基地',
          power: { gen: 50, use: 0 },
          buildings: [
            { name: '盟军建造厂', state: '运转' },
            { name: '盟军发电厂', state: '建造中' },
            { name: '兵营', state: '运转' },
          ],
        },
      ],
      queues: [
        mkTxn({
          type: '建造',
          item: '盟军发电厂',
          base: '恶土前哨主基地',
          status: 'settling',
          progress: 100,
          total_minutes: 360,
          spent_minutes: 360,
        }),
        mkTxn({
          type: '研究',
          item: '基础步兵训练学',
          base: '恶土前哨主基地',
          status: 'active',
          total_minutes: 2880,
          spent_minutes: 0,
        }),
        mkTxn({
          type: '研究',
          item: '个人装备工程学',
          base: '恶土前哨主基地',
          status: 'queued',
          total_minutes: 2880,
          spent_minutes: 0,
        }),
      ],
    });

    // 推进 5880m（4天2小时）：第一项基础步兵训练学(2880m)跑满后溢出 3000m 顺延升格个人装备工程学(2880m)也跑满，双双由系统自动交割为 done！
    const settled6 = settleFloor(state4, state4, '<timePast>4 D 2 H 0 M</timePast>', { catalog });
    const r1 = settled6.data.queues.find(q => q.item === '基础步兵训练学')!;
    const r2 = settled6.data.queues.find(q => q.item === '个人装备工程学')!;
    expect(r1.status).toBe('done');
    expect(r1.spent_minutes).toBe(2880);
    expect(r2.status).toBe('done');
    expect(r2.progress).toBe(100);

    // S3_RECONCILE 对账认领盟军发电厂与两项研究：全部 MATCH 零 OVERRUN，且重算电力后 power 为 { gen: 250, use: 20 }
    const decls6 = parseProductionDeclarations(
      '<生产>\n- 盟军发电厂: 1座\n- 基础步兵训练学: 1项\n- 个人装备工程学: 1项\n</生产>',
    );
    const reconciled6 = reconcileProduction(settled6.data, decls6);
    expect(reconciled6.verdicts.every(v => v.verdict === 'MATCH')).toBe(true);
    const afterPowerRecompute = recomputeBasePowerFromCatalog(reconciled6.next, catalog, [], {
      useBuiltinFallback: true,
    });
    expect(afterPowerRecompute.bases[0].power).toEqual({ gen: 250, use: 20 });
  });

  it('BUG-R2-20：① 不写 <生产> 标签仅靠 <timePast> 跑满工时，建造/生产/研究/工程自动转 done 并入库；② 同楼写 <生产> 幂等防重绝不双倍入账；③ 未满工时写 <生产> 仍触发 OVERRUN (chrono_mismatch)', () => {
    const catalog = mkCatalog({
      buildings: [
        { name: '盟军建造厂', cost: 2500, power: -50 } as never,
        { name: '盟军发电厂', cost: 800, power: -200 } as never,
        { name: '兵营', cost: 500, power: 20 } as never,
        { name: '战车工厂', cost: 2000, power: 50 } as never,
      ],
      productions: [
        { name: '动员兵', cost: 100, category: '步兵', need_buildings: ['兵营'] } as never,
        { name: '灰熊主战坦克', cost: 700, category: '载具', need_buildings: ['战车工厂'] } as never,
      ],
      researches: [
        { name: '基础步兵训练学', line: '人员', tier: 1, cost: 500 } as never,
        { name: '个人装备工程学', line: '人员', tier: 1, cost: 800 } as never,
        { name: '复合装甲冶金学', line: '陆地载具', tier: 1, cost: 1200 } as never,
      ],
    });

    const initialState = mkStat({
      bases: [
        {
          id: 'B1',
          name: '北坡主基地',
          power: { gen: 50, use: 70 },
          buildings: [
            { name: '盟军建造厂', state: '运转' },
            { name: '盟军发电厂', state: '建造中' },
            { name: '兵营', state: '运转' },
            { name: '战车工厂', state: '运转' },
          ],
          forces: {
            troops: { 动员兵: 5 },
            vehicles: [],
          },
        },
      ],
      forces: {
        troops: { 动员兵: 5 },
        vehicles: [],
        equipment: {},
        reinforcements_pending: [],
      },
      tech: {
        doing: ['基础步兵训练学', '个人装备工程学', '复合装甲冶金学'],
        done: [],
        unlocked: [],
      },
      projects: [
        {
          id: 'proj:北坡防空网工程@B1',
          ref: '北坡防空网工程',
          grade: '小改',
          scope: 'base',
          lead_base: '北坡主基地',
          bases: ['北坡主基地'],
          status: '在建',
          phases: [
            {
              idx: 0,
              name: '雷达基座浇筑',
              status: '进行中',
              queue_index: 6,
            },
          ],
        },
      ],
      queues: [
        mkTxn({
          type: '建造',
          item: '盟军发电厂',
          base: '北坡主基地',
          status: 'active',
          qty: 1,
          total_minutes: 360,
          spent_minutes: 200,
        }),
        mkTxn({
          type: '生产',
          item: '动员兵',
          base: '北坡主基地',
          status: 'active',
          qty: 10,
          total_minutes: 600,
          spent_minutes: 0,
        }),
        mkTxn({
          type: '生产',
          item: '灰熊主战坦克',
          base: '北坡主基地',
          status: 'active',
          qty: 2,
          total_minutes: 1200,
          spent_minutes: 0,
        }),
        mkTxn({
          type: '研究',
          item: '基础步兵训练学',
          base: '北坡主基地',
          status: 'active',
          qty: 1,
          total_minutes: 720,
          spent_minutes: 0,
        }),
        mkTxn({
          type: '研究',
          item: '个人装备工程学',
          base: '北坡主基地',
          status: 'queued',
          qty: 1,
          total_minutes: 720,
          spent_minutes: 0,
        }),
        mkTxn({
          type: '研究',
          item: '复合装甲冶金学',
          base: '北坡主基地',
          status: 'active',
          qty: 1,
          total_minutes: 2880,
          spent_minutes: 0,
        }),
        mkTxn({
          type: '工程',
          item: '北坡防空网工程·雷达基座浇筑',
          base: '北坡主基地',
          lane: 'eng:eng.main',
          status: 'active',
          qty: 1,
          total_minutes: 720,
          spent_minutes: 0,
        }),
      ],
    });

    // ① 推进 2 天（2880 分钟，电网初期 50/70 缺电折半 -> 实际有效工时 1440m）：
    // - 盟军发电厂(剩160m) -> 跑满转 done，建筑转 '运转'，基地电网重算为 gen=250, use=70
    // - 动员兵×10(600m) -> 跑满转 done，forces.troops.动员兵 5 + 10 = 15，base.forces.troops.动员兵 = 15
    // - 灰熊主战坦克×2(1200m) -> 跑满转 done，forces.vehicles = 2，base.forces.vehicles = 2
    // - 基础步兵训练学(720m) -> 跑满转 done，溢出 720m 顺延给同车道 queued 的 个人装备工程学(720m) 也跑满转 done！双双入库 tech.done
    // - 工程阶段1(720m) -> 跑满转 done，syncProjects 自动将阶段1与工程整体置为 '完工'
    // - 复合装甲冶金学(2880m) -> 仅推进 1440m (50%)，仍为 active
    const settled = settleFloor(initialState, initialState, '<timePast>2 D 0 H 0 M</timePast>', {
      catalog,
    });

    const byItem = Object.fromEntries(settled.data.queues.map(q => [q.item, q]));
    expect(byItem['盟军发电厂'].status).toBe('done');
    expect(byItem['动员兵'].status).toBe('done');
    expect(byItem['灰熊主战坦克'].status).toBe('done');
    expect(byItem['基础步兵训练学'].status).toBe('done');
    expect(byItem['个人装备工程学'].status).toBe('done');
    expect(byItem['北坡防空网工程·雷达基座浇筑'].status).toBe('done');
    expect(byItem['复合装甲冶金学'].status).toBe('active');
    expect(byItem['复合装甲冶金学'].progress).toBe(50);

    // 验证四类资产均已自动交割入库（无需任何 <生产> 标签）
    expect(
      settled.data.bases[0].buildings.find(b => b.name === '盟军发电厂')?.state,
    ).toBe('运转');
    expect(settled.data.bases[0].power).toEqual({ gen: 250, use: 70 });
    expect(settled.data.forces.troops['动员兵']).toBe(15);
    expect(settled.data.bases[0].forces?.troops['动员兵']).toBe(15);
    expect(settled.data.forces.vehicles.filter(v => v === '灰熊主战坦克')).toHaveLength(2);
    expect(settled.data.bases[0].forces?.vehicles.filter(v => v === '灰熊主战坦克')).toHaveLength(2);
    expect(settled.data.tech.done).toEqual(
      expect.arrayContaining(['基础步兵训练学', '个人装备工程学']),
    );
    expect(settled.data.tech.done).not.toContain('复合装甲冶金学');
    expect(settled.data.projects[0].status).toBe('完工');
    expect(settled.data.projects[0].phases[0].status).toBe('完工');

    // ② 同楼若 LLM 顺手写了已满工时项的 <生产>，且同时抢跑写了未满工时项「复合装甲冶金学」：
    // - 已满工时项（动员兵、灰熊主战坦克、基础步兵训练学）返回 MATCH 且绝不二次入账（动员兵仍为 15、灰熊仍为 2）
    // - 未满工时项（复合装甲冶金学）返回 OVERRUN (time_conflict) 供触发 chrono_mismatch 横幅
    const decls = parseProductionDeclarations(
      '<生产>\n- 动员兵: 10名\n- 灰熊主战坦克: 2辆\n- 基础步兵训练学: 1项\n- 复合装甲冶金学: 1项\n</生产>',
    );
    const reconciled = reconcileProduction(settled.data, decls, {
      autoSettleRemaining: true,
    });
    const verdictByItem = Object.fromEntries(reconciled.verdicts.map(v => [v.item, v]));
    expect(verdictByItem['动员兵'].verdict).toBe('MATCH');
    expect(verdictByItem['灰熊主战坦克'].verdict).toBe('MATCH');
    expect(verdictByItem['基础步兵训练学'].verdict).toBe('MATCH');
    expect(verdictByItem['复合装甲冶金学'].verdict).toBe('OVERRUN');
    expect(verdictByItem['复合装甲冶金学'].overrunKind).toBe('time_conflict');

    // 确认绝无二次入账
    expect(reconciled.next.forces.troops['动员兵']).toBe(15);
    expect(reconciled.next.bases[0].forces?.troops['动员兵']).toBe(15);
    expect(reconciled.next.forces.vehicles.filter(v => v === '灰熊主战坦克')).toHaveLength(2);
    expect(reconciled.next.bases[0].forces?.vehicles.filter(v => v === '灰熊主战坦克')).toHaveLength(2);
    expect(reconciled.next.tech.done.filter(t => t === '基础步兵训练学')).toHaveLength(1);
    expect(reconciled.next.tech.done).not.toContain('复合装甲冶金学');
  });
});


