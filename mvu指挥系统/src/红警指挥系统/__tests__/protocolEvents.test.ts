/**
 * PRT-EVT-01 · `<事件>` 标签协议两动词扩展与 `settleFloor` 协议结算齿轮 —— 专项单测
 *
 * 覆盖任务包 §2.3、§3.5.3、§3.6.1、§6 PRT-EVT-01 与脑暴决策记录 D-P5c / D-P9b / D-P16b / D-P27：
 * 1. `<事件>` 三色裁决门：
 *    - 🟢 绿通道：标准 `协议发现` / `协议实验` 零修复入库，产出结构化 `kind: 'protocol'` 声明；
 *    - 🟡 黄通道：动词别名（`协议启封` → `协议发现`、`协议攻关/协议推演/协议激活` → `协议实验`）与协议名别名/破折号/前缀/模糊对齐（`applyAlign`）；
 *    - 🔴 红通道（EVT-01 Q2 越权键铁律）：试图写 `credits / 资金 / balance / 余额 / protocol_points / 协议点 / 协议点数 / exp / 定型经验 / attempts` 100% 隔离，绝不执行；
 * 2. `settleFloor` 协议结算齿轮端到端：
 *    - 步骤 A：Δt > 0 按 7 建筑双轴公式累加 `protocol_points`，自动启封实验协议并刷新同轨准入；
 *    - 步骤 B：执行 `<事件: 协议发现>` 与 `<事件: 协议实验>`（同源确定性种子 `deterministicRoll`、扣点扣款、经验积累 `accumulated` 与突破定型 `breakthrough → active, exp=100`、`last_result` 快照）；
 *    - 步骤 C：Δt > 0 `auto_queued` 自动实验排程推进、同轨后继解锁、UTO 轴三“零单步跨任务穿透”与同楼手动+自动防双扣；
 * 3. 相同楼层/种子下 `settleFloor` 重算与 `useParse.runParseFor` Swipe 重解析 100% 幂等。
 */
import { describe, expect, it } from 'vitest';
import type { EffectiveCatalog } from '../core/catalogEffective';
import { extractEvents, parseMessageText, type StatData } from '../parse/parsePipeline';
import { deterministicRoll, type ProtocolDefinitionLike } from '../engines/protocolEngine';
import { Schema } from '../core/schema';
import { settleFloor } from '../engines/settleFloor';

/* ═══════════════ 测试夹具与确定性选日辅助 ═══════════════ */

function mkStat(partial: Record<string, unknown> = {}): StatData {
  return Schema.parse(partial);
}

function mkCatalog(protocols: ProtocolDefinitionLike[]): EffectiveCatalog {
  return {
    researches: [],
    buildings: [],
    productions: [],
    retrofits: [],
    projects: [],
    protocols: protocols as EffectiveCatalog['protocols'],
    factionDefs: [],
    warnings: [],
    researchWarnings: [],
  };
}

/** 搜索满足指定 deterministicRoll 谓词的游戏日 day_count */
function findGameDayForRoll(protocolId: string, attempt: number, predicate: (roll: number) => boolean): number {
  for (let day = 1; day <= 500; day++) {
    const r = deterministicRoll(protocolId, attempt, day);
    if (predicate(r)) return day;
  }
  throw new Error(`未找到满足条件的测试日期: ${protocolId} attempt=${attempt}`);
}

const PROTO_SOV_T1_BUNKER: ProtocolDefinitionLike = {
  id: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
  name: '战斗工兵—预制战斗碉堡协议',
  faction: '苏联',
  track: 'track.sov.frontline_engineering',
  tier: 1,
  cost_points: 1,
  experiment_cost_credits: 500,
};

const PROTO_SOV_T2_OVERLOAD: ProtocolDefinitionLike = {
  id: 'sov.research.t2.iron_curtain_emergency_overload',
  name: '铁幕紧急过载协议',
  faction: '苏联',
  track: 'track.sov.frontline_engineering',
  tier: 2,
  cost_points: 1,
  experiment_cost_credits: 1500,
  discovery: {
    kind: 'experiment',
    buildings: ['红星实验设计局综合体', '战斗实验室'],
    tech_done: ['磁暴线圈增压理论'],
  },
};

const PROTO_SOV_T3_KIROV: ProtocolDefinitionLike = {
  id: 'sov.protocol.ra3.kirov_dreadnought_overlimit',
  name: '基洛夫—无畏越限运行协议',
  faction: '苏联',
  track: 'track.sov.frontline_engineering',
  tier: 3,
  cost_points: 1,
  experiment_cost_credits: 4000,
};

const PROTO_SOV_T1_SPUTNIK: ProtocolDefinitionLike = {
  id: 'sov.protocol.ra3.sputnik_one_way_deployment',
  name: 'Sputnik一次展开前沿节点协议',
  faction: '苏联',
  track: 'track.sov.sputnik_logistics',
  tier: 1,
  cost_points: 1,
  experiment_cost_credits: 500,
};

/* ═══════════════ 验收 ①：<事件> 绿 / 黄 / 红三通道单测 ═══════════════ */

describe('PRT-EVT-01 · 验收 ①：<事件> 标签协议两动词绿/黄/红三通道裁决', () => {
  it('🟢 绿通道：标准「协议发现」与「协议实验」零修复入库，产出结构化 kind="protocol" 声明', () => {
    const yaml = `
- 类型: 协议发现
  对象: 铁幕紧急过载协议
  来源: 第三防区磁暴线圈过载战损复盘

- 类型: 协议实验
  对象: 战斗工兵—预制战斗碉堡协议
  基地: 1号基地
  理由: 红星设计局组织第2轮模块化掩体实弹演训与参数定型
`;
    const gate = extractEvents(yaml);
    expect(gate.quarantineEvents).toHaveLength(0);
    expect(gate.yellowEvents).toHaveLength(0);
    expect(gate.greenEvents).toHaveLength(2);

    const [discoverDecl, expDecl] = gate.greenEvents;
    expect(discoverDecl).toMatchObject({
      verb: '协议发现',
      kind: 'protocol',
      protocolAction: 'discover',
      protocolId: 'sov.research.t2.iron_curtain_emergency_overload',
      protocolName: '铁幕紧急过载协议',
      source: '第三防区磁暴线圈过载战损复盘',
      protocol: {
        action: 'discover',
        protocolAction: 'discover',
        id: 'sov.research.t2.iron_curtain_emergency_overload',
        protocolId: 'sov.research.t2.iron_curtain_emergency_overload',
        name: '铁幕紧急过载协议',
        protocolName: '铁幕紧急过载协议',
        source: '第三防区磁暴线圈过载战损复盘',
      },
    });

    expect(expDecl).toMatchObject({
      verb: '协议实验',
      kind: 'protocol',
      protocolAction: 'experiment',
      protocolId: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
      protocolName: '战斗工兵—预制战斗碉堡协议',
      base: '1号基地',
      reason: '红星设计局组织第2轮模块化掩体实弹演训与参数定型',
      protocol: {
        action: 'experiment',
        protocolAction: 'experiment',
        id: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
        protocolId: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
        name: '战斗工兵—预制战斗碉堡协议',
        protocolName: '战斗工兵—预制战斗碉堡协议',
        base: '1号基地',
        reason: '红星设计局组织第2轮模块化掩体实弹演训与参数定型',
      },
    });
  });

  it('🟢 parseMessageText 集成：协议事件进入 eventDeclarations 待结转，解析层绝不越权改写账本', () => {
    const baseline = mkStat({
      economy: { credits: 5000, credits_daily: 0, wallet: {}, chains: [] },
      protocol_points: 3,
    });
    const raw = `
叙事正文：前线呈递协议演训报告。
<事件>
- 类型: 协议发现
  对象: 铁幕紧急过载协议
  来源: 第三防区磁暴线圈过载战损复盘
- 类型: 协议实验
  对象: 战斗工兵—预制战斗碉堡协议
  基地: 1号基地
  理由: 红星设计局组织第2轮模块化掩体实弹演训与参数定型
</事件>
`;
    const parsed = parseMessageText(raw, baseline);
    expect(parsed.quarantine).toHaveLength(0);
    expect(parsed.eventDeclarations).toHaveLength(2);
    expect(parsed.eventDeclarations.map(d => d.kind)).toEqual(['protocol', 'protocol']);
    // 解析层只构造声明、不直接扣费或掷骰
    expect(parsed.data.economy.credits).toBe(5000);
    expect(parsed.data.protocol_points).toBe(3);
    expect(parsed.data.protocols).toBeUndefined();
    expect(parsed.events.some(e => e.light === '🟢' && e.message.includes('随本楼结算接缝结转'))).toBe(true);
  });

  it('🟡 黄通道：动词别名（协议启封 / 协议攻关 / 协议推演 / 协议激活）归一为标准动词并记修复留痕', () => {
    const yaml = `
- 类型: 协议启封
  对象: 铁幕紧急过载协议
  来源: 战地工程卷宗解密
- 类型: 协议攻关
  对象: 战斗工兵—预制战斗碉堡协议
  理由: 第一轮演训
- 类型: 协议推演
  对象: 磁暴步兵移动储能并联充能协议
  理由: 战术推演
- 类型: 协议激活
  对象: 摩托化迫击炮后备分队协议
  理由: 编制激活
`;
    const gate = extractEvents(yaml);
    expect(gate.quarantineEvents).toHaveLength(0);
    expect(gate.greenEvents).toHaveLength(0);
    expect(gate.yellowEvents).toHaveLength(4);

    expect(gate.yellowEvents[0].declaration.verb).toBe('协议发现');
    expect(gate.yellowEvents[0].declaration.protocolAction).toBe('discover');
    expect(gate.yellowEvents[0].repairs.some(r => r.includes('协议启封') && r.includes('协议发现'))).toBe(true);

    expect(gate.yellowEvents[1].declaration.verb).toBe('协议实验');
    expect(gate.yellowEvents[1].declaration.protocolAction).toBe('experiment');
    expect(gate.yellowEvents[1].repairs.some(r => r.includes('协议攻关') && r.includes('协议实验'))).toBe(true);

    expect(gate.yellowEvents[2].declaration.verb).toBe('协议实验');
    expect(gate.yellowEvents[2].repairs.some(r => r.includes('协议推演') && r.includes('协议实验'))).toBe(true);

    expect(gate.yellowEvents[3].declaration.verb).toBe('协议实验');
    expect(gate.yellowEvents[3].repairs.some(r => r.includes('协议激活') && r.includes('协议实验'))).toBe(true);
  });

  it('🟡 黄通道：协议名别名、半角连字符、世界书编号前缀与 authority 别名词典对齐为权威名与权威 ID', () => {
    const yaml = `
- 类型: 协议实验
  对象: 战斗工兵-预制战斗碉堡协议
  基地: 1号基地
- 类型: 协议实验
  协议: 113·战斗工兵—预制战斗碉堡协议
- 类型: 协议发现
  target: 恐怖机器人双任务包协议
- 类型: 协议实验
  项目: 欧盟防务协议
- 类型: 协议发现
  对象: 铁幕过载手写简称
`;
    const gate = extractEvents(yaml, {
      authority: {
        names: ['铁幕紧急过载协议'],
        aliases: { 铁幕过载手写简称: '铁幕紧急过载协议' },
      },
    });
    expect(gate.quarantineEvents).toHaveLength(0);
    expect(gate.greenEvents).toHaveLength(0);
    expect(gate.yellowEvents).toHaveLength(5);

    expect(gate.yellowEvents[0].declaration).toMatchObject({
      protocolId: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
      protocolName: '战斗工兵—预制战斗碉堡协议',
    });
    expect(gate.yellowEvents[0].align).toEqual({
      from: '战斗工兵-预制战斗碉堡协议',
      to: '战斗工兵—预制战斗碉堡协议',
    });

    expect(gate.yellowEvents[1].declaration).toMatchObject({
      protocolId: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
      protocolName: '战斗工兵—预制战斗碉堡协议',
    });

    expect(gate.yellowEvents[2].declaration).toMatchObject({
      protocolId: 'sov.protocol.ra3.terror_drone_dual_mode',
      protocolName: '恐怖机器人拆解／短时电磁锁止双任务包协议',
    });

    expect(gate.yellowEvents[3].declaration).toMatchObject({
      protocolId: 'all.research.t1.european_defense_agreement',
      protocolName: '欧洲联合防务协议',
    });

    expect(gate.yellowEvents[4].declaration).toMatchObject({
      protocolId: 'sov.research.t2.iron_curtain_emergency_overload',
      protocolName: '铁幕紧急过载协议',
    });
  });

  it('🔴 红通道（EVT-01 Q2 越权键铁律）：试图在 <事件> 中直接写 credits / 资金 / protocol_points / 协议点 / exp / attempts 100% 打入 quarantine 隔离', () => {
    const yaml = `
- 类型: 协议实验
  对象: 战斗工兵—预制战斗碉堡协议
  protocol_points: 99
- 类型: 协议实验
  对象: 战斗工兵—预制战斗碉堡协议
  协议点: 10
- 类型: 协议实验
  对象: 战斗工兵—预制战斗碉堡协议
  credits: 50000
- 类型: 协议发现
  对象: 铁幕紧急过载协议
  资金: 8000
- 类型: 协议实验
  对象: 战斗工兵—预制战斗碉堡协议
  exp: 100
`;
    const gate = extractEvents(yaml);
    expect(gate.greenEvents).toHaveLength(0);
    expect(gate.yellowEvents).toHaveLength(0);
    expect(gate.quarantineEvents).toHaveLength(5);
    for (const q of gate.quarantineEvents) {
      expect(q.error).toContain('越权键');
      expect(q.error).toContain('Q2');
    }

    // 额外验证第 6 条（attempts / 定型经验 / 协议点数）同样 100% 隔离
    const gateMore = extractEvents(`
- 类型: 协议实验
  对象: 战斗工兵—预制战斗碉堡协议
  定型经验: 100
- 类型: 协议实验
  对象: 战斗工兵—预制战斗碉堡协议
  attempts: 3
- 类型: 协议实验
  对象: 战斗工兵—预制战斗碉堡协议
  协议点数: 5
`);
    expect(gateMore.greenEvents).toHaveLength(0);
    expect(gateMore.yellowEvents).toHaveLength(0);
    expect(gateMore.quarantineEvents).toHaveLength(3);
  });

  it('🔴 红通道：缺目标协议名或协议名完全未知无法对齐时，打入 quarantine 隔离', () => {
    const gate = extractEvents(`
- 类型: 协议发现
  来源: 只有来源没有对象
- 类型: 协议实验
  对象: 虚空星际歼星舰神装协议
`);
    expect(gate.greenEvents).toHaveLength(0);
    expect(gate.yellowEvents).toHaveLength(0);
    expect(gate.quarantineEvents).toHaveLength(2);
    expect(gate.quarantineEvents[0].error).toContain('缺目标协议名');
    expect(gate.quarantineEvents[1].error).toContain('未知协议');
  });
});

/* ═══════════════ 验收 ②：settleFloor 协议结算齿轮端到端单测 ═══════════════ */

describe('PRT-EVT-01 · 验收 ②：settleFloor 协议结算齿轮端到端（步骤 A / B / C）', () => {
  it('步骤 A：Δt > 0 按在役院所与算力中心累加 protocol_points，并自动启封满足条件的实验型协议', () => {
    const catalog = mkCatalog([PROTO_SOV_T1_BUNKER, PROTO_SOV_T2_OVERLOAD]);
    // 总部默认 0.10 + 红星实验设计局综合体 0.15 + 超算中心 0.10 = 0.35 点/日
    const state = mkStat({
      meta: { date: '2042-05-01', day_count: 5, location: '北坡' },
      bases: [
        {
          id: 'B1',
          name: '1号基地',
          buildings: [
            { name: '红星实验设计局综合体', state: '运转' },
            { name: '超算中心', state: '运转' },
          ],
        },
      ],
      tech: { done: ['磁暴线圈增压理论'] },
      protocol_points: 0.5,
      protocols: [
        {
          ref: PROTO_SOV_T1_BUNKER.id,
          status: 'active',
          exp: 100,
          attempts: 1,
        },
        {
          ref: PROTO_SOV_T2_OVERLOAD.id,
          status: 'undiscovered',
          exp: 0,
          attempts: 0,
        },
      ],
    });

    const settled = settleFloor(state, state, '<timePast>1 D 0 H 0 M</timePast>', { catalog });
    expect(settled.protocolSettlement?.dailyRate).toBeCloseTo(0.35, 4);
    expect(settled.protocolSettlement?.deltaPoints).toBeCloseTo(0.35, 4);
    expect(settled.data.protocol_points).toBeCloseTo(0.85, 4);
    expect(settled.protocolSettlement?.discoveredByExperimentIds).toContain(PROTO_SOV_T2_OVERLOAD.id);

    const overloadInst = settled.data.protocols?.find(p => p.ref === PROTO_SOV_T2_OVERLOAD.id);
    expect(overloadInst?.status).toBe('available');
    expect(overloadInst?.discovered_via).toBe('experiment');
  });

  it('步骤 B（协议发现）：<事件: 协议发现> 在准入已齐时启封为 available，准入未齐时置为 locked，后续建所自动解锁', () => {
    const catalog = mkCatalog([PROTO_SOV_T2_OVERLOAD]);
    const rawDiscover = `
<事件>
- 类型: 协议发现
  对象: 铁幕紧急过载协议
  来源: 第三防区磁暴线圈过载战损复盘
</事件>
`;
    const parsed = parseMessageText(rawDiscover, mkStat({ meta: { day_count: 6 } }));

    // 1. 尚无 T2 实验室时触发 <事件: 协议发现> → 登记 discovered_via: 'event' 且 status 为 'locked'
    const stateNoLab = mkStat({
      meta: { day_count: 6 },
      bases: [{ id: 'B1', name: '1号基地', buildings: [] }],
    });
    const settledLocked = settleFloor(stateNoLab, stateNoLab, rawDiscover, {
      catalog,
      eventDeclarations: parsed.eventDeclarations,
    });
    const instLocked = settledLocked.data.protocols?.find(p => p.ref === PROTO_SOV_T2_OVERLOAD.id);
    expect(instLocked).toMatchObject({
      ref: PROTO_SOV_T2_OVERLOAD.id,
      status: 'locked',
      discovered_via: 'event',
      last_result: {
        day: 6,
        outcome: 'discovered',
        next_prob: 35,
      },
    });

    // 2. 建成红星实验设计局综合体后推进 Δt → 自动由 locked 解锁为 available，且保留 discovered_via: 'event'
    const stateWithLab = mkStat({
      ...settledLocked.data,
      bases: [
        {
          id: 'B1',
          name: '1号基地',
          buildings: [{ name: '红星实验设计局综合体', state: '运转' }],
        },
      ],
    });
    const settledUnlocked = settleFloor(settledLocked.data, stateWithLab, '<timePast>0 D 6 H 0 M</timePast>', {
      catalog,
    });
    const instUnlocked = settledUnlocked.data.protocols?.find(p => p.ref === PROTO_SOV_T2_OVERLOAD.id);
    expect(instUnlocked?.status).toBe('available');
    expect(instUnlocked?.discovered_via).toBe('event');

    // 3. 若发现当下 T2 实验室已在役 → 直接启封为 available
    const settledDirectAvailable = settleFloor(stateWithLab, stateWithLab, rawDiscover, {
      catalog,
      eventDeclarations: parsed.eventDeclarations,
    });
    const instDirect = settledDirectAvailable.data.protocols?.find(p => p.ref === PROTO_SOV_T2_OVERLOAD.id);
    expect(instDirect?.status).toBe('available');
    expect(instDirect?.discovered_via).toBe('event');
  });

  it('步骤 B（协议实验）：同源确定性种子控制阶段经验积累（accumulated）与临界突破定型（breakthrough → active, exp=100）及同轨后继解锁', () => {
    const catalog = mkCatalog([PROTO_SOV_T1_BUNKER, PROTO_SOV_T2_OVERLOAD]);
    // 找一个第 1 轮必然积累（roll >= 0.55）的日期
    const accumulateDay = findGameDayForRoll(PROTO_SOV_T1_BUNKER.id, 1, r => r >= 0.55);
    // 找一个第 2 轮必然突破（roll < 0.85）的日期
    const breakthroughDay = findGameDayForRoll(PROTO_SOV_T1_BUNKER.id, 2, r => r < 0.85);

    const rawExp = `
<事件>
- 类型: 协议实验
  对象: 战斗工兵—预制战斗碉堡协议
  基地: 1号基地
  理由: 模块化掩体实弹演训
</事件>
`;
    const parsed = parseMessageText(rawExp, {});

    const initialState = mkStat({
      meta: { date: '2042-05-10', day_count: accumulateDay, location: '1号基地' },
      economy: { credits: 3000, credits_daily: 0, wallet: {}, chains: [] },
      bases: [
        {
          id: 'B1',
          name: '1号基地',
          buildings: [{ name: '红星实验设计局综合体', state: '运转' }],
        },
      ],
      protocol_points: 3,
      protocols: [
        {
          ref: PROTO_SOV_T1_BUNKER.id,
          status: 'available',
          exp: 0,
          attempts: 0,
          auto_queued: true,
        },
        {
          ref: PROTO_SOV_T2_OVERLOAD.id,
          status: 'locked',
          exp: 0,
          attempts: 0,
        },
      ],
    });

    // 第 1 轮：阶段经验积累（accumulated）
    const round1 = settleFloor(initialState, initialState, rawExp, {
      catalog,
      eventDeclarations: parsed.eventDeclarations,
    });
    expect(round1.data.protocol_points).toBe(2); // 3 - 1
    expect(round1.data.economy.credits).toBe(2500); // 3000 - 500
    const bunkerAfterR1 = round1.data.protocols?.find(p => p.ref === PROTO_SOV_T1_BUNKER.id);
    expect(bunkerAfterR1).toMatchObject({
      status: 'experimenting',
      attempts: 1,
      exp: 50,
      points_spent: 1,
      credits_spent: 500,
      last_result: {
        day: accumulateDay,
        outcome: 'accumulated',
        attempt: 1,
        exp_before: 0,
        exp_after: 50,
        next_prob: 85,
      },
    });
    // 同轨 T2 因前序尚未 active，仍保持 locked
    expect(round1.data.protocols?.find(p => p.ref === PROTO_SOV_T2_OVERLOAD.id)?.status).toBe('locked');

    // 第 2 轮：临界突破定型（breakthrough）→ status='active', exp=100, auto_queued 清 false, 解锁同轨 T2
    const stateForR2 = mkStat({
      ...round1.data,
      meta: { ...round1.data.meta, day_count: breakthroughDay },
    });
    const round2 = settleFloor(round1.data, stateForR2, rawExp, {
      catalog,
      eventDeclarations: parsed.eventDeclarations,
    });
    expect(round2.data.protocol_points).toBe(1); // 2 - 1
    expect(round2.data.economy.credits).toBe(2000); // 2500 - 500
    const bunkerAfterR2 = round2.data.protocols?.find(p => p.ref === PROTO_SOV_T1_BUNKER.id);
    expect(bunkerAfterR2).toMatchObject({
      status: 'active',
      attempts: 2,
      exp: 100,
      auto_queued: false,
      points_spent: 2,
      credits_spent: 1000,
      last_result: {
        day: breakthroughDay,
        outcome: 'breakthrough',
        attempt: 2,
        exp_before: 50,
        exp_after: 100,
        next_prob: 100,
      },
    });
    // 同轨 T2 协议因前序已 active 且红星设计局在场，自动由 locked 解锁为 available
    expect(round2.data.protocols?.find(p => p.ref === PROTO_SOV_T2_OVERLOAD.id)?.status).toBe('available');
  });

  it('步骤 C（D-P27 自动实验排程）：按 queue_order 推进队首协议，严守“零单步跨任务穿透”与“同楼手动+自动不双扣”', () => {
    const catalog = mkCatalog([PROTO_SOV_T1_BUNKER, PROTO_SOV_T2_OVERLOAD, PROTO_SOV_T3_KIROV, PROTO_SOV_T1_SPUTNIK]);
    const winDay = findGameDayForRoll(PROTO_SOV_T1_BUNKER.id, 1, r => r < 0.55);

    const state = mkStat({
      meta: { date: '2042-05-15', day_count: winDay, location: '1号基地' },
      economy: { credits: 10000, credits_daily: 0, wallet: {}, chains: [] },
      bases: [
        {
          id: 'B1',
          name: '1号基地',
          buildings: [{ name: '国家战略工程综合体（红星科学城）', state: '运转' }],
        },
      ],
      protocol_points: 5,
      protocols: [
        {
          ref: PROTO_SOV_T1_BUNKER.id,
          status: 'available',
          exp: 0,
          attempts: 0,
          auto_queued: true,
          queue_order: 1,
        },
        {
          ref: PROTO_SOV_T2_OVERLOAD.id,
          status: 'locked',
          exp: 0,
          attempts: 0,
          auto_queued: true,
          queue_order: 2,
        },
      ],
    });

    // 1. 纯 Δt 推进：队首 T1 突破为 active 并解锁同轨 T2，但 T2 在本轮绝不跨任务穿透执行实验
    const floor1 = settleFloor(state, state, '<timePast>1 D 0 H 0 M</timePast>', { catalog });
    expect(floor1.protocolSettlement?.autoExecuted).toBe(true);
    expect(floor1.protocolSettlement?.autoProtocolId).toBe(PROTO_SOV_T1_BUNKER.id);
    expect(floor1.protocolSettlement?.autoOutcome).toBe('breakthrough');

    const t1AfterF1 = floor1.data.protocols?.find(p => p.ref === PROTO_SOV_T1_BUNKER.id);
    const t2AfterF1 = floor1.data.protocols?.find(p => p.ref === PROTO_SOV_T2_OVERLOAD.id);
    expect(t1AfterF1?.status).toBe('active');
    expect(t1AfterF1?.auto_queued).toBe(false);
    // T2 已解锁为 available，但 attempts 必须为 0（零单步跨任务穿透）
    expect(t2AfterF1?.status).toBe('available');
    expect(t2AfterF1?.attempts).toBe(0);

    // 2. 同楼手动 <事件: 协议实验> + auto_queued 同指一条协议时，绝不重复双扣
    const accDaySputnik = findGameDayForRoll(PROTO_SOV_T1_SPUTNIK.id, 1, r => r >= 0.55);
    const manualAndAutoState = mkStat({
      meta: { date: '2042-05-16', day_count: accDaySputnik, location: '1号基地' },
      economy: { credits: 5000, credits_daily: 0, wallet: {}, chains: [] },
      bases: [],
      protocol_points: 4,
      protocols: [
        {
          ref: PROTO_SOV_T1_SPUTNIK.id,
          status: 'available',
          exp: 0,
          attempts: 0,
          auto_queued: true,
          queue_order: 1,
        },
      ],
    });
    const parsedSputnik = parseMessageText(
      `<事件>\n- 类型: 协议实验\n  对象: Sputnik一次展开前沿节点协议\n</事件>`,
      manualAndAutoState,
    );
    const settledNoDouble = settleFloor(manualAndAutoState, manualAndAutoState, '<timePast>1 D 0 H 0 M</timePast>', {
      catalog,
      eventDeclarations: parsedSputnik.eventDeclarations,
    });
    const sputnikAfter = settledNoDouble.data.protocols?.find(p => p.ref === PROTO_SOV_T1_SPUTNIK.id);
    // 仅由步骤 B 手动实验执行 1 次，步骤 C 不会对同一协议再次扣费
    expect(sputnikAfter?.attempts).toBe(1);
    expect(sputnikAfter?.points_spent).toBe(1);
    expect(sputnikAfter?.credits_spent).toBe(500);
    expect(sputnikAfter?.auto_queued).toBe(true); // 未突破，保留原 auto_queued 开关供下楼使用
    expect(settledNoDouble.data.economy.credits).toBe(4500);
    // 4.0 + 0.10(总部日产) - 1.0(单次实验) = 3.10
    expect(settledNoDouble.data.protocol_points).toBeCloseTo(3.1, 4);
  });
});

/* ═══════════════ 验收 ③：Swipe 重解析与同种子重算 100% 幂等断言 ═══════════════ */

describe('PRT-EVT-01 · 验收 ③：相同楼层/种子下 settleFloor 与 useParse.runParseFor Swipe 重解析幂等', () => {
  it('纯函数幂等：同一基线与原文多次调用 settleFloor 产出逐字节深相等，不累加轮次与扣费', () => {
    const catalog = mkCatalog([PROTO_SOV_T1_BUNKER, PROTO_SOV_T2_OVERLOAD]);
    const raw = `
<timePast>1 D 0 H 0 M</timePast>
<事件>
- 类型: 协议发现
  对象: 铁幕紧急过载协议
  来源: 战损复盘
- 类型: 协议实验
  对象: 战斗工兵—预制战斗碉堡协议
  基地: 1号基地
  理由: 实弹定型
</事件>
`;
    const baseline = mkStat({
      meta: { date: '2042-06-01', day_count: 10, location: '1号基地' },
      economy: { credits: 5000, credits_daily: 0, wallet: {}, chains: [] },
      bases: [
        {
          id: 'B1',
          name: '1号基地',
          buildings: [{ name: '红星实验设计局综合体', state: '运转' }],
        },
      ],
      protocol_points: 2,
    });

    const parsed1 = parseMessageText(raw, baseline);
    const settled1 = settleFloor(baseline, parsed1.data, raw, {
      catalog,
      eventDeclarations: parsed1.eventDeclarations,
    });

    const parsed2 = parseMessageText(raw, baseline);
    const settled2 = settleFloor(baseline, parsed2.data, raw, {
      catalog,
      eventDeclarations: parsed2.eventDeclarations,
    });

    expect(settled2).toEqual(settled1);
    expect(settled1.data.economy.credits).toBe(4500);
    expect(settled1.data.protocols?.find(p => p.ref === PROTO_SOV_T1_BUNKER.id)?.attempts).toBe(1);
  });

  it('useParse.runParseFor 宿主端到端幂等：同原文 skipped、force 重解析与 Swipe 换页回切从基线重算不双扣', async () => {
    const g = globalThis as Record<string, unknown>;
    const savedKeys = ['getChatMessages', 'getVariables', 'updateVariablesWith', 'SillyTavern'] as const;
    const saved: Record<string, unknown> = {};
    for (const k of savedKeys) saved[k] = g[k];

    try {
      const baseline = mkStat({
        meta: { date: '2042-06-01', day_count: 10, location: '1号基地' },
        economy: { credits: 5000, credits_daily: 0, wallet: {}, chains: [] },
        bases: [
          {
            id: 'B1',
            name: '1号基地',
            buildings: [{ name: '红星实验设计局综合体', state: '运转' }],
          },
        ],
        protocol_points: 2,
      });

      const floor1State = {
        raw: `<timePast>1 D 0 H 0 M</timePast>\n<事件>\n- 类型: 协议实验\n  对象: 战斗工兵—预制战斗碉堡协议\n  基地: 1号基地\n  理由: 第1轮演训\n</事件>`,
        swipeId: 0,
      };
      const chatVars: Record<string, unknown> = {};
      const msgVars: Record<number, Record<string, unknown>> = {
        0: { stat_data: structuredClone(baseline) },
        1: {},
      };

      g.SillyTavern = { getCurrentChatId: () => 'chat-prt-evt-01' };
      g.getChatMessages = (id: number) => {
        if (id === 0)
          return [
            { message_id: 0, role: 'assistant', is_hidden: false, message: '<初始状态></初始状态>', swipe_id: 0 },
          ];
        if (id === 1)
          return [
            {
              message_id: 1,
              role: 'assistant',
              is_hidden: false,
              message: floor1State.raw,
              swipe_id: floor1State.swipeId,
            },
          ];
        return [];
      };
      g.getVariables = (opt: { type: string; message_id?: number }) => {
        if (opt.type === 'chat') return chatVars;
        return msgVars[opt.message_id ?? 0] ?? {};
      };
      g.updateVariablesWith = (
        updater: (v: Record<string, unknown>) => Record<string, unknown>,
        opt: { type: string; message_id?: number },
      ) => {
        if (opt.type === 'chat') {
          const next = updater(chatVars);
          Object.assign(chatVars, next);
          return;
        }
        const mid = opt.message_id ?? 0;
        msgVars[mid] = updater(msgVars[mid] ?? {});
      };

      const { runParseFor } = await import('../composables/useParse');

      // 1. 首次解析结算
      const r1 = await runParseFor(1);
      expect(r1).toBe('parsed');
      const snapshot1 = structuredClone(msgVars[1].stat_data) as StatData;
      expect(snapshot1.economy.credits).toBe(4500);
      expect(snapshot1.protocol_points).toBeCloseTo(1.25, 4); // 2 + 0.25(日产: 总部0.10+设计局0.15) - 1(实验消耗) = 1.25
      expect(snapshot1.protocols?.find(p => p.ref === PROTO_SOV_T1_BUNKER.id)?.attempts).toBe(1);

      // 2. 同原文同 swipe 二次触发 → skipped
      const r2 = await runParseFor(1);
      expect(r2).toBe('skipped');

      // 3. MESSAGE_EDITED / force 重解析 → 从 #0 基线重算，结果与首次完全一致，绝不叠加扣费
      const r3 = await runParseFor(1, { force: true });
      expect(r3).toBe('parsed');
      expect(msgVars[1].stat_data).toEqual(snapshot1);

      // 4. Swipe 切到 swipe_id=1（仅协议发现、不实验），再切回 swipe_id=0 → 100% 还原 snapshot1
      floor1State.swipeId = 1;
      floor1State.raw = `<事件>\n- 类型: 协议发现\n  对象: 铁幕紧急过载协议\n  来源: 战损复盘\n</事件>`;
      const r4 = await runParseFor(1, { force: true });
      expect(r4).toBe('parsed');
      const swipe1Data = msgVars[1].stat_data as StatData;
      expect(swipe1Data.economy.credits).toBe(5000);
      expect(swipe1Data.protocols?.find(p => p.ref === PROTO_SOV_T2_OVERLOAD.id)?.discovered_via).toBe('event');

      floor1State.swipeId = 0;
      floor1State.raw = `<timePast>1 D 0 H 0 M</timePast>\n<事件>\n- 类型: 协议实验\n  对象: 战斗工兵—预制战斗碉堡协议\n  基地: 1号基地\n  理由: 第1轮演训\n</事件>`;
      const r5 = await runParseFor(1, { force: true });
      expect(r5).toBe('parsed');
      expect(msgVars[1].stat_data).toEqual(snapshot1);
    } finally {
      for (const k of savedKeys) {
        if (saved[k] === undefined) delete g[k];
        else g[k] = saved[k];
      }
    }
  });
});

describe('G02-02 · 协议排程严禁隐式绕过发现门', () => {
  const PROTO_EVENT_DISCOVERY: ProtocolDefinitionLike = {
    ...PROTO_SOV_T3_KIROV,
    discovery: {
      kind: 'event',
      event_hint: '飞艇战损复盘',
    },
  };

  const PROTO_EXP_DISCOVERY_UNMET: ProtocolDefinitionLike = {
    ...PROTO_SOV_T2_OVERLOAD,
    discovery: {
      kind: 'experiment',
      building_any: ['红星实验设计局综合体', '战斗实验室'],
      research_all: ['磁暴线圈增压理论'],
    },
  };

  it.each(['加入候列', '移出候列', '置顶', '上移', '下移', '暂缓', '恢复'] as const)(
    '未入表或处于 undiscovered 的 event/experiment 发现协议执行「%s」时被拒绝，不启封、不实验、不扣费',
    scheduleVerb => {
      const catalog = mkCatalog([PROTO_EVENT_DISCOVERY, PROTO_EXP_DISCOVERY_UNMET]);
      const state = mkStat({
        meta: { date: '2042-06-02', day_count: 12, location: '1号基地' },
        economy: { credits: 5000, credits_daily: 0, wallet: {}, chains: [] },
        bases: [
          {
            id: 'B1',
            name: '1号基地',
            buildings: [{ name: '红星实验设计局综合体', state: '运转' }],
          },
        ],
        protocol_points: 3,
        protocols: [
          {
            ref: PROTO_SOV_T2_OVERLOAD.id,
            status: 'undiscovered',
            exp: 0,
            attempts: 0,
          },
        ],
      });

      const raw = `
<timePast>1 D 0 H 0 M</timePast>
<事件>
- 类型: 协议排程
  对象: 基洛夫—无畏越限运行协议
  排程: ${scheduleVerb}
- 类型: 协议排程
  对象: 铁幕紧急过载协议
  排程: ${scheduleVerb}
</事件>
`;
      const parsed = parseMessageText(raw, state, { catalog });
      const settled = settleFloor(state, parsed.data, raw, {
        catalog,
        eventDeclarations: parsed.eventDeclarations,
      });

      const eventProto = settled.data.protocols?.find(p => p.ref === PROTO_EVENT_DISCOVERY.id);
      const expProto = settled.data.protocols?.find(p => p.ref === PROTO_SOV_T2_OVERLOAD.id);

      expect(eventProto).toBeUndefined();
      expect(expProto?.status).toBe('undiscovered');
      expect(expProto?.discovered_via).toBeUndefined();
      expect(expProto?.auto_queued).toBe(false);
      expect(settled.protocolSettlement?.discoveredByEventIds).toEqual([]);
      expect(settled.protocolSettlement?.autoExecuted).toBe(false);
      expect(settled.data.economy.credits).toBe(5000);
      expect(settled.data.protocol_points).toBeCloseTo(3.25, 4);
      expect(
        settled.events.filter(
          e => e.light === '🟡' && e.message.includes('协议排程未执行') && e.message.includes('undiscovered'),
        ),
      ).toHaveLength(2);
    },
  );

  it('已入表 locked / available / experimenting 实例正常排程不受影响', () => {
    const catalog = mkCatalog([PROTO_SOV_T1_BUNKER, PROTO_SOV_T2_OVERLOAD, PROTO_SOV_T1_SPUTNIK]);
    const state = mkStat({
      meta: { date: '2042-06-02', day_count: 12, location: '1号基地' },
      economy: { credits: 5000, credits_daily: 0, wallet: {}, chains: [] },
      bases: [],
      protocol_points: 2,
      protocols: [
        {
          ref: PROTO_SOV_T1_BUNKER.id,
          status: 'available',
          exp: 0,
          attempts: 0,
          auto_queued: false,
          hold: false,
        },
        {
          ref: PROTO_SOV_T2_OVERLOAD.id,
          status: 'locked',
          exp: 0,
          attempts: 0,
          discovered_via: 'event',
          auto_queued: false,
          hold: false,
        },
        {
          ref: PROTO_SOV_T1_SPUTNIK.id,
          status: 'experimenting',
          exp: 50,
          attempts: 1,
          auto_queued: true,
          queue_order: 1,
          hold: false,
        },
      ],
    });

    const raw = `
<事件>
- 类型: 协议排程
  对象: 战斗工兵—预制战斗碉堡协议
  排程: 加入候列
- 类型: 协议排程
  对象: 铁幕紧急过载协议
  排程: 加入候列
- 类型: 协议排程
  对象: Sputnik一次展开前沿节点协议
  排程: 暂缓
</事件>
`;
    const parsed = parseMessageText(raw, state, { catalog });
    const settled = settleFloor(state, parsed.data, raw, {
      catalog,
      eventDeclarations: parsed.eventDeclarations,
    });

    const byRef = Object.fromEntries((settled.data.protocols ?? []).map(p => [p.ref, p]));
    expect(byRef[PROTO_SOV_T1_BUNKER.id]).toMatchObject({
      status: 'available',
      auto_queued: true,
      queue_order: 2,
      hold: false,
    });
    expect(byRef[PROTO_SOV_T2_OVERLOAD.id]).toMatchObject({
      status: 'locked',
      auto_queued: true,
      queue_order: 3,
      hold: false,
    });
    expect(byRef[PROTO_SOV_T1_SPUTNIK.id]).toMatchObject({
      status: 'experimenting',
      auto_queued: true,
      queue_order: 1,
      hold: true,
    });
  });

  it('BUG-LIVE-26a（#74/#76楼实机复现）：<事件> 协议发现 在苏联实验室在线但常规前置未齐时直接启封 available（或由历史 locked 刷为 available），且 <事件> 协议实验 消费「消耗 / 结果」零黄灯并正常执行', () => {
    const protoWithPrereqs: ProtocolDefinitionLike = {
      ...PROTO_SOV_T2_OVERLOAD,
      track: '过载工程与战区拒止',
      prereqs: ['铁幕区域赋盾工学'],
      requirements: {
        op: 'all',
        conditions: [
          { kind: 'building', name: '铁幕装置', scope: 'current', state: 'existing' },
          { kind: 'research', name: '铁幕区域赋盾工学' },
        ],
      },
    };
    const predProto: ProtocolDefinitionLike = {
      id: 'sov.protocol.ra3.terror_drone_dual_mode',
      name: '恐怖机器人拆解／短时电磁锁止双任务包协议',
      faction: '苏联',
      track: '过载工程与战区拒止',
      tier: 1,
    };
    const catalog = mkCatalog([predProto, protoWithPrereqs]);

    // 1. 验证 #76 楼 <事件> 协议实验 带「消耗: 3 / 结果: 突破」零黄灯入库
    const evtYaml76 = `
- 类型: 协议实验
  协议: 铁幕紧急过载协议
  消耗: 3
  结果: 突破
  原因: 依托主基地三座磁能反应炉充沛电力与天启重型坦克开展铁幕过载护盾实车演训
`;
    const raw76 = `
<timePast>1 D 0 H 0 M</timePast>
<事件>
${evtYaml76}
</事件>
`;
    const gate76 = extractEvents(evtYaml76);
    expect(gate76.quarantineEvents).toHaveLength(0);
    expect(gate76.yellowEvents).toHaveLength(0);
    expect(gate76.greenEvents).toHaveLength(1);

    // 2. 即使 #74 楼历史存档中该协议处于 status: 'locked', discovered_via: 'event'，#76 楼结算步骤 A 也会在步骤 B 实验前自动解锁为 available 并顺利执行实验
    const stateFrom74 = mkStat({
      meta: { date: '2078-02-01', day_count: 20, location: '恶土前哨主基地' },
      economy: { credits: 50000, credits_daily: 0, wallet: {}, chains: [] },
      bases: [
        {
          id: '恶土前哨主基地',
          name: '恶土前哨主基地',
          buildings: [{ name: '苏联作战实验室', state: '运转' }],
        },
      ],
      protocol_points: 3,
      protocols: [
        {
          ref: protoWithPrereqs.id,
          status: 'locked',
          discovered_via: 'event',
          exp: 0,
          attempts: 0,
        },
      ],
    });
    const parsed76 = parseMessageText(raw76, stateFrom74, { catalog });
    const settled76 = settleFloor(stateFrom74, parsed76.data, raw76, {
      catalog,
      eventDeclarations: parsed76.eventDeclarations,
    });
    expect(settled76.protocolSettlement?.manualExperiments[0]?.executed).toBe(true);
    const overloadAfter = settled76.data.protocols?.find(p => p.ref === protoWithPrereqs.id);
    expect(overloadAfter?.attempts).toBe(1);
    expect(['experimenting', 'active']).toContain(overloadAfter?.status);
  });
});

