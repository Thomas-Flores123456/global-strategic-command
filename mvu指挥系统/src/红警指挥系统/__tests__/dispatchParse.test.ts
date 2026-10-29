/**
 * dispatchParse.test.ts —— 调度令解析接线（CTRL-DISPATCH-PARSE-01）
 *
 * 真源：docs/design/systems/系统事务与时间推进总设计案.md §2.3（confirmed）。
 * 覆盖任务验收自动化面：
 * - 四动词解析（<队列>「调度: <动词>」扩展字段 → DispatchOrder[]，纯指令声明不 upsert 账本）；
 * - 目标消歧（研究 type+item 全局唯一免基地；物理队列 type+item+base，基地名称归一 Base.id；
 *   同楼新建条目可被本楼调度；多义目标解析层隔离——复用 upsertQueues「定位不唯一」先例）；
 * - 免疫拒令留痕端到端（parse → settleFloor → dispatch_rejected 事件 → R21 warn 入 issues）；
 * - 非法动词 / 未知目标拒令留痕（宽进严出：解析层如实构造，引擎裁决 invalid_verb / target_not_found）；
 * - 同楼多令（多条调度令按序执行）；
 * - settleFloor 兼容性自证（缺省/空 orders 行为逐字节零变化）。
 */
import { describe, expect, it } from 'vitest';
import { parseMessageText } from '../parse/parsePipeline';
import { Schema } from '../core/schema';
import { settleFloor } from '../engines/settleFloor';

/* ═══════════════ 工具 ═══════════════ */

const twoBases = () =>
  Schema.parse({
    bases: [
      { id: 'alpha-id', name: '北坡基地', buildings: [] },
      { id: 'beta-id', name: '南港基地', buildings: [] },
    ],
  });

/** 解析＋结算一条龙（Δt=0：无 timePast 且 meta.date 无差，调度令照常在结算第①步执行） */
function parseAndSettle(raw: string, baseline: unknown) {
  const result = parseMessageText(raw, baseline, {});
  const settled = settleFloor(baseline, result.data, raw, { orders: result.orders });
  return { result, settled };
}

/* ═══════════════ 四动词解析 ═══════════════ */

describe('DISPATCH-PARSE-01 · 四动词解析（§2.3.1 报文）', () => {
  const baseline = () =>
    Schema.parse({
      bases: [{ id: 'alpha-id', name: '北坡基地', buildings: [] }],
      queues: [
        { type: '生产', item: '天启坦克', base: 'alpha-id', status: 'queued' },
        { type: '研究', item: '磁暴线圈', base: '', status: 'queued' },
        { type: '生产', item: '犀牛坦克', base: 'alpha-id', status: 'queued' },
        { type: '建造', item: '光棱塔', base: 'alpha-id', status: 'queued', hold: true },
      ],
    });

  it('四动词全部解析为 DispatchOrder，按队列条目复合身份携带目标身份', () => {
    const result = parseMessageText(
      '<战况>\n队列:\n' +
        '  - 项目: 天启坦克\n    类型: 生产\n    基地: 北坡基地\n    调度: 置顶\n' +
        '  - 项目: 磁暴线圈\n    调度: 置底\n' +
        '  - 项目: 犀牛坦克\n    类型: 生产\n    基地: 北坡基地\n    调度: 暂缓\n' +
        '  - 项目: 光棱塔\n    类型: 建造\n    基地: 北坡基地\n    调度: 恢复\n' +
        '</战况>',
      baseline(),
      {},
    );
    expect(result.orders).toHaveLength(4);
    expect(result.orders.map(o => o.verb)).toEqual(['置顶', '置底', '暂缓', '恢复']);
    // 物理队列：type+item+base（基地名称已归一 Base.id）
    expect(result.orders[0]).toEqual({ item: '天启坦克', verb: '置顶', type: '生产', base: 'alpha-id' });
    // 研究：type+item 全局唯一，免基地
    expect(result.orders[1]).toEqual({ item: '磁暴线圈', verb: '置底', type: '研究' });
    expect(result.orders[1].base).toBeUndefined();
    expect(result.orders[2]).toEqual({ item: '犀牛坦克', verb: '暂缓', type: '生产', base: 'alpha-id' });
    expect(result.orders[3]).toEqual({ item: '光棱塔', verb: '恢复', type: '建造', base: 'alpha-id' });
    // 解析留痕：每令一条 🟢 instruction 事件
    expect(result.events.filter(e => e.layer === 'instruction' && /调度令/.test(e.message))).toHaveLength(4);
  });

  it('调度条目是纯指令声明：不 upsert 账本、不创建幻影事务', () => {
    const base = baseline();
    const result = parseMessageText(
      '<战况>\n队列:\n  - 项目: 天启坦克\n    类型: 生产\n    基地: 北坡基地\n    调度: 置顶\n</战况>',
      base,
      {},
    );
    expect(result.data.queues).toEqual(base.queues);
  });

  it('调度条目夹带状态字段不改账本，残留键进隔离区', () => {
    const result = parseMessageText(
      '<战况>\n队列:\n  - 项目: 天启坦克\n    类型: 生产\n    基地: 北坡基地\n    进度: 50\n    调度: 置顶\n</战况>',
      baseline(),
      {},
    );
    expect(result.orders).toHaveLength(1);
    expect(result.data.queues.find(q => q.item === '天启坦克')?.progress).toBe(0);
    expect(result.quarantine.some(q => q.path === '队列[天启坦克].进度' && q.scope === 'key')).toBe(true);
  });

  it('调度令收集不计 appliedCount（声明通道先例，对齐 操作.完成 收讫声明）', () => {
    const result = parseMessageText(
      '<战况>\n队列:\n  - 项目: 天启坦克\n    类型: 生产\n    基地: 北坡基地\n    调度: 置顶\n</战况>',
      baseline(),
      {},
    );
    expect(result.orders).toHaveLength(1);
    expect(result.applied).toBe(false);
  });
});

/* ═══════════════ 目标消歧 ═══════════════ */

describe('DISPATCH-PARSE-01 · 目标消歧（复合身份口径）', () => {
  const dualTank = () =>
    Schema.parse({
      bases: [
        { id: 'alpha-id', name: '北坡基地', buildings: [] },
        { id: 'beta-id', name: '南港基地', buildings: [] },
      ],
      queues: [
        { type: '生产', item: '天启坦克', base: 'alpha-id', status: 'queued' },
        { type: '生产', item: '天启坦克', base: 'beta-id', status: 'queued' },
        { type: '研究', item: '磁暴线圈', base: '', status: 'queued' },
      ],
    });

  it('物理队列带基地消歧：合法基地名称归一为 Base.id 后唯一命中', () => {
    const result = parseMessageText(
      '<战况>\n队列:\n  - 项目: 天启坦克\n    类型: 生产\n    基地: 南港基地\n    调度: 置底\n</战况>',
      dualTank(),
      {},
    );
    expect(result.orders).toEqual([{ item: '天启坦克', verb: '置底', type: '生产', base: 'beta-id' }]);
    expect(result.quarantine).toHaveLength(0);
  });

  it('多义目标（同名跨基地、未提供消歧）：解析层隔离，不静默取首条', () => {
    const result = parseMessageText('<战况>\n队列:\n  - 项目: 天启坦克\n    调度: 置顶\n</战况>', dualTank(), {});
    expect(result.orders).toHaveLength(0);
    expect(result.quarantine.some(q => /调度令目标不唯一/.test(q.error))).toBe(true);
  });

  it('同楼新建队列条目可被本楼调度（第二遍基于队列增量后状态解析）', () => {
    const result = parseMessageText(
      '<战况>\n队列:\n' +
        '  - 项目: 新建坦克\n    类型: 生产\n    基地: 北坡基地\n' +
        '  - 项目: 新建坦克\n    调度: 暂缓\n' +
        '</战况>',
      twoBases(),
      {},
    );
    expect(result.data.queues).toHaveLength(1);
    expect(result.data.queues[0]).toMatchObject({ item: '新建坦克', type: '生产', base: 'alpha-id', status: 'queued' });
    expect(result.orders).toEqual([{ item: '新建坦克', verb: '暂缓', type: '生产', base: 'alpha-id' }]);
  });
});

/* ═══════════════ 免疫拒令留痕端到端 ═══════════════ */

describe('DISPATCH-PARSE-01 · 免疫拒令留痕端到端（parse → settleFloor → dispatch_rejected → R21 warn）', () => {
  it('调度令作用于 settling 态事务：引擎拒令，R21 warn 入 issues，目标状态不动', () => {
    const base = Schema.parse({
      bases: [{ id: 'alpha-id', name: '北坡基地', buildings: [] }],
      queues: [{ type: '建造', item: '光棱塔', base: 'alpha-id', status: 'settling', progress: 100 }],
    });
    const raw = '<战况>\n队列:\n  - 项目: 光棱塔\n    类型: 建造\n    基地: 北坡基地\n    调度: 置顶\n</战况>';
    const { result, settled } = parseAndSettle(raw, base);
    // 解析层如实构造（宽进）
    expect(result.orders).toEqual([{ item: '光棱塔', verb: '置顶', type: '建造', base: 'alpha-id' }]);
    // 引擎裁决层拒令留痕：dispatch_rejected 事件（🟡 instruction）
    expect(settled.events.some(e => /dispatch_rejected/.test(e.message) && /光棱塔/.test(e.message))).toBe(true);
    // R21 warn 入 issues（§2.3.2 免疫约束原文口径）
    const warn = settled.issues.find(i => i.rule === 'R21' && i.level === 'warn' && i.target === '队列[光棱塔]');
    expect(warn).toBeDefined();
    expect(warn!.message).toMatch(/settling\/done\/cancelled 免疫/);
    // 免疫区不被调度触碰
    expect(settled.data.queues[0]).toMatchObject({ item: '光棱塔', status: 'settling', progress: 100 });
  });
});

/* ═══════════════ 非法动词 / 未知目标拒令留痕 ═══════════════ */

describe('DISPATCH-PARSE-01 · 非法动词与未知目标拒令留痕（宽进严出）', () => {
  const base = () =>
    Schema.parse({
      bases: [{ id: 'alpha-id', name: '北坡基地', buildings: [] }],
      queues: [{ type: '生产', item: '天启坦克', base: 'alpha-id', status: 'queued' }],
    });

  it('非法动词：解析层照实携带，引擎拒 invalid_verb，R21 warn 留痕', () => {
    const raw = '<战况>\n队列:\n  - 项目: 天启坦克\n    类型: 生产\n    基地: 北坡基地\n    调度: 加急\n</战况>';
    const { result, settled } = parseAndSettle(raw, base());
    expect(result.orders).toEqual([{ item: '天启坦克', verb: '加急', type: '生产', base: 'alpha-id' }]);
    const warn = settled.issues.find(i => i.rule === 'R21' && i.level === 'warn' && i.target === '队列[天启坦克]');
    expect(warn).toBeDefined();
    expect(warn!.message).toMatch(/非法调度动词「加急」/);
    expect(settled.events.some(e => /dispatch_rejected/.test(e.message))).toBe(true);
  });

  it('未知目标：如实构造携带所供身份，引擎拒 target_not_found，R21 warn 留痕', () => {
    const raw = '<战况>\n队列:\n  - 项目: 幽灵坦克\n    调度: 置顶\n</战况>';
    const { result, settled } = parseAndSettle(raw, base());
    expect(result.orders).toEqual([{ item: '幽灵坦克', verb: '置顶' }]);
    const warn = settled.issues.find(i => i.rule === 'R21' && i.level === 'warn' && i.target === '队列[幽灵坦克]');
    expect(warn).toBeDefined();
    expect(warn!.message).toMatch(/不存在于队列/);
  });

  it('不可解析基地引用照实携带原串：引擎按 target_not_found 拒令', () => {
    const raw = '<战况>\n队列:\n  - 项目: 天启坦克\n    类型: 生产\n    基地: 不存在的基地\n    调度: 暂缓\n</战况>';
    const activeBase = Schema.parse({
      bases: [{ id: 'alpha-id', name: '北坡基地', buildings: [] }],
      queues: [{ type: '生产', item: '天启坦克', base: 'alpha-id', status: 'active', total_minutes: 100 }],
    });
    const { result, settled } = parseAndSettle(raw, activeBase);
    expect(result.orders).toEqual([{ item: '天启坦克', verb: '暂缓', type: '生产', base: '不存在的基地' }]);
    const warn = settled.issues.find(i => i.rule === 'R21' && i.level === 'warn' && i.target === '队列[天启坦克]');
    expect(warn).toBeDefined();
    expect(warn!.message).toMatch(/不存在于队列/);
    // 拒令不触碰既有队列（Δt=0 不推进，状态与 hold 原样）
    expect(settled.data.queues[0]).toMatchObject({ item: '天启坦克', status: 'active', hold: false, spent_minutes: 0 });
  });
});

/* ═══════════════ 同楼多令 ═══════════════ */

describe('DISPATCH-PARSE-01 · 同楼多令（按数组序执行）', () => {
  it('暂缓＋恢复同楼下达：hold 标记各按其令，升格门自动跟随', () => {
    const base = Schema.parse({
      bases: [{ id: 'alpha-id', name: '北坡基地', buildings: [] }],
      queues: [
        { type: '生产', item: '天启坦克', base: 'alpha-id', status: 'queued' },
        { type: '生产', item: '犀牛坦克', base: 'alpha-id', status: 'queued', hold: true },
      ],
    });
    const raw =
      '<战况>\n队列:\n' +
      '  - 项目: 天启坦克\n    类型: 生产\n    基地: 北坡基地\n    调度: 暂缓\n' +
      '  - 项目: 犀牛坦克\n    类型: 生产\n    基地: 北坡基地\n    调度: 恢复\n' +
      '</战况>';
    const { result, settled } = parseAndSettle(raw, base);
    expect(result.orders.map(o => o.verb)).toEqual(['暂缓', '恢复']);
    const tianqi = settled.data.queues.find(q => q.item === '天启坦克');
    const xiniu = settled.data.queues.find(q => q.item === '犀牛坦克');
    expect(tianqi).toMatchObject({ status: 'queued', hold: true }); // 暂缓：带宽空位跳过
    expect(xiniu?.hold).toBe(false); // 恢复：清 hold，正常竞争带宽（本例被升格门升 active）
    expect(xiniu?.status).toBe('active');
    // 无拒令
    expect(settled.issues.some(i => i.rule === 'R21' && i.level === 'warn')).toBe(false);
  });
});

/* ═══════════════ settleFloor 兼容性自证 ═══════════════ */

describe('DISPATCH-PARSE-01 · settleFloor 兼容性（缺省/空 orders 行为逐字节零变化）', () => {
  const base = () =>
    Schema.parse({
      bases: [{ id: 'alpha-id', name: '北坡基地', buildings: [] }],
      queues: [
        { type: '生产', item: '天启坦克', base: 'alpha-id', status: 'active', total_minutes: 100, spent_minutes: 10 },
      ],
    });

  it('options 缺省 / orders: undefined / orders: [] 三态产出深相等，且无调度相关留痕', () => {
    const raw = '<timePast>0 D 1 H 0 M</timePast>';
    const a = settleFloor(base(), base(), raw, {});
    const b = settleFloor(base(), base(), raw, { orders: undefined });
    const c = settleFloor(base(), base(), raw, { orders: [] });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(a.events.some(e => /dispatch|调度/.test(e.message))).toBe(false);
    expect(a.issues.some(i => i.rule === 'R21' && i.level === 'warn')).toBe(false);
    // Δt>0 的正常积分行为不受 orders 接缝影响
    expect(a.data.queues[0].spent_minutes).toBe(70);
  });
});
