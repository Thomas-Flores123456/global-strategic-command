/**
 * protocolEngine.test.ts —— 协议五态状态机、渐进概率实验引擎、同源确定性种子与 UTO 自动排程单元测试（PRT-SLOT-01）
 *
 * 覆盖：
 * 1. T1/T2/T3 双资源渐进概率实验表（PROTOCOL_TIER_EXPERIMENT_SPEC）、期望次数 E[N]=1.52/1.90/2.62 与 3/4/5 次硬保底必成；
 * 2. deterministicRoll 同源确定性种子幂等性、[0, 1) 分布边界及 predictExperimentOutcome 前后端同源预判；
 * 3. 五态机四重守卫：单向无环（canTransitionProtocolStatus）、实验室离线封存守卫（exp/attempts/points_spent/credits_spent 100% 保全不清零）、active 终态永久生效守卫、双资源扣费与不足拒止；
 * 4. discoverProtocolsByExperiment 实验自动启封、discoverProtocolByEvent 奇遇事件启封、refreshProtocolTrackAvailability 同轨线性拓扑解锁；
 * 5. settleAutoProtocols Δt 积分产点、自动启封、按 queue_order 队首自动实验、突破后同轨后继解锁与 UTO 轴三「零单步跨任务穿透」铁律；
 * 6. createProtocolLaneProvider 工位视图与实验室状态联动。
 */

import { describe, expect, it } from 'vitest';
import {
  calculateExpectedExperimentAttempts,
  canTransitionProtocolStatus,
  createProtocolLaneProvider,
  deterministicRoll,
  discoverProtocolByEvent,
  discoverProtocolsByExperiment,
  executeProtocolExperiment,
  getExperimentStepSpec,
  getNextBreakthroughProb,
  getNextBreakthroughProbPercent,
  getProtocolExperimentCost,
  isProtocolLabOnline,
  predictExperimentOutcome,
  PROTOCOL_LANE_KEY,
  PROTOCOL_TIER_EXPERIMENT_SPEC,
  refreshProtocolTrackAvailability,
  roundPoints4,
  settleAutoProtocols,
  type ProtocolDefinitionLike,
  type ProtocolEngineStateView,
} from '../engines/protocolEngine';
import type { ProtocolStatus } from '../core/schema';

/* ═══════════════ 测试夹具 ═══════════════ */

const T1_SOVIET_PROTO_1: ProtocolDefinitionLike = {
  id: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
  name: '战斗工兵—预制战斗碉堡协议',
  faction: '苏联',
  track: '钢铁基干与国家动员',
  tier: 1,
  cost_points: 1,
  experiment_cost_credits: 500,
};

const T1_SOVIET_PROTO_2: ProtocolDefinitionLike = {
  id: 'sov.protocol.ra3.sputnik_one_way_deployment',
  name: 'Sputnik一次展开前沿节点协议',
  faction: '苏联',
  track: '钢铁基干与国家动员',
  tier: 1,
  cost_points: 1,
  experiment_cost_credits: 500,
};

const T2_SOVIET_OVERLOAD: ProtocolDefinitionLike = {
  id: 'sov.research.t2.iron_curtain_emergency_overload',
  name: '铁幕紧急过载协议',
  faction: '苏联',
  track: '过载工程与战区拒止',
  tier: 2,
  cost_points: 1,
  experiment_cost_credits: 1500,
  discovery: {
    kind: 'experiment',
    building_any: ['红星实验设计局综合体', '战斗实验室'],
    research_all: ['高级作战实验理论'],
  },
};

const T3_SOVIET_ORBITAL: ProtocolDefinitionLike = {
  id: 'sov.protocol.ra3.hammer_inventory_reentry',
  name: '受库存与授权约束的轨道常规载荷再入协议',
  faction: '苏联',
  track: '国家战略工程与工业外延',
  tier: 3,
  cost_points: 1,
  experiment_cost_credits: 4000,
};

/** 搜索满足特定 roll 区间（成功或失败）的测试 gameDay，确保测试完全确定性 */
function findDayForRoll(protocolId: string, attempt: number, predicate: (roll: number) => boolean): number {
  for (let day = 1; day <= 5000; day++) {
    const r = deterministicRoll(protocolId, attempt, day);
    if (predicate(r)) return day;
  }
  throw new Error(`Unable to find deterministic day for ${protocolId}#${attempt}`);
}

describe('PRT-SLOT-01 · protocolEngine 渐进概率实验引擎与 UTO 自动排程', () => {
  describe('① T1/T2/T3 渐进突破率表、期望次数与硬保底规格（D-P9b）', () => {
    it('Tier 1/2/3 阶梯概率、未成经验、单次消耗与数学期望次数 E[N]=1.52/1.90/2.62 精确对齐', () => {
      // Tier 1: 1点+500资金, 55%(exp→50) → 85%(exp→90) → 100%, E[N]=1.52
      expect(PROTOCOL_TIER_EXPERIMENT_SPEC[1].costPoints).toBe(1);
      expect(PROTOCOL_TIER_EXPERIMENT_SPEC[1].costCredits).toBe(500);
      expect(PROTOCOL_TIER_EXPERIMENT_SPEC[1].maxAttempts).toBe(3);
      expect(calculateExpectedExperimentAttempts(1)).toBe(1.52);
      expect(PROTOCOL_TIER_EXPERIMENT_SPEC[1].expectedAttempts).toBe(1.52);
      expect(PROTOCOL_TIER_EXPERIMENT_SPEC[1].expectedCredits).toBe(760);
      expect(getExperimentStepSpec(1, 1)).toMatchObject({ prob: 0.55, failExp: 50, guaranteed: false });
      expect(getExperimentStepSpec(1, 2)).toMatchObject({ prob: 0.85, failExp: 90, guaranteed: false });
      expect(getExperimentStepSpec(1, 3)).toMatchObject({ prob: 1.0, failExp: 100, guaranteed: true });
      expect(getExperimentStepSpec(1, 9)).toMatchObject({ prob: 1.0, failExp: 100, guaranteed: true });

      // Tier 2: 1点+1500资金, 35%(exp→35) → 65%(exp→70) → 90%(exp→95) → 100%, E[N]=1.90
      expect(PROTOCOL_TIER_EXPERIMENT_SPEC[2].costPoints).toBe(1);
      expect(PROTOCOL_TIER_EXPERIMENT_SPEC[2].costCredits).toBe(1500);
      expect(PROTOCOL_TIER_EXPERIMENT_SPEC[2].maxAttempts).toBe(4);
      expect(calculateExpectedExperimentAttempts(2)).toBe(1.9);
      expect(PROTOCOL_TIER_EXPERIMENT_SPEC[2].expectedAttempts).toBe(1.9);
      expect(PROTOCOL_TIER_EXPERIMENT_SPEC[2].expectedCredits).toBe(2850);
      expect(getExperimentStepSpec(2, 1)).toMatchObject({ prob: 0.35, failExp: 35, guaranteed: false });
      expect(getExperimentStepSpec(2, 2)).toMatchObject({ prob: 0.65, failExp: 70, guaranteed: false });
      expect(getExperimentStepSpec(2, 3)).toMatchObject({ prob: 0.9, failExp: 95, guaranteed: false });
      expect(getExperimentStepSpec(2, 4)).toMatchObject({ prob: 1.0, failExp: 100, guaranteed: true });

      // Tier 3: 1点+4000资金, 15%(exp→25) → 35%(exp→50) → 65%(exp→75) → 90%(exp→95) → 100%, E[N]=2.62
      expect(PROTOCOL_TIER_EXPERIMENT_SPEC[3].costPoints).toBe(1);
      expect(PROTOCOL_TIER_EXPERIMENT_SPEC[3].costCredits).toBe(4000);
      expect(PROTOCOL_TIER_EXPERIMENT_SPEC[3].maxAttempts).toBe(5);
      expect(calculateExpectedExperimentAttempts(3)).toBe(2.62);
      expect(PROTOCOL_TIER_EXPERIMENT_SPEC[3].expectedAttempts).toBe(2.62);
      expect(PROTOCOL_TIER_EXPERIMENT_SPEC[3].expectedCredits).toBe(10480);
      expect(getExperimentStepSpec(3, 1)).toMatchObject({ prob: 0.15, failExp: 25, guaranteed: false });
      expect(getExperimentStepSpec(3, 2)).toMatchObject({ prob: 0.35, failExp: 50, guaranteed: false });
      expect(getExperimentStepSpec(3, 3)).toMatchObject({ prob: 0.65, failExp: 75, guaranteed: false });
      expect(getExperimentStepSpec(3, 4)).toMatchObject({ prob: 0.9, failExp: 95, guaranteed: false });
      expect(getExperimentStepSpec(3, 5)).toMatchObject({ prob: 1.0, failExp: 100, guaranteed: true });
    });

    it('getNextBreakthroughProb 与 getProtocolExperimentCost 辅助查询正确', () => {
      expect(getNextBreakthroughProb(2, 0)).toBe(0.35);
      expect(getNextBreakthroughProbPercent(2, 1)).toBe(65);
      expect(getNextBreakthroughProbPercent(2, 3)).toBe(100);
      expect(getProtocolExperimentCost({ tier: 3 })).toEqual({ costPoints: 1, costCredits: 4000 });
      expect(getProtocolExperimentCost({ tier: 2, cost_points: 2, experiment_cost_credits: 1800 })).toEqual({
        costPoints: 2,
        costCredits: 1800,
      });
    });
  });

  describe('② deterministicRoll 同源确定性种子与 predictExperimentOutcome（守卫④）', () => {
    it('deterministicRoll 对相同 (protocolId, nextAttempt, gameDay) 100% 幂等且严格落于 [0, 1)', () => {
      const r1 = deterministicRoll(T1_SOVIET_PROTO_1.id, 1, 12);
      const r2 = deterministicRoll(T1_SOVIET_PROTO_1.id, 1, 12);
      // 传入权威中文名也归一化到同一 ID 种子
      const rByName = deterministicRoll(T1_SOVIET_PROTO_1.name!, 1, 12);
      expect(r1).toBe(r2);
      expect(r1).toBe(rByName);

      for (let day = 0; day < 200; day++) {
        for (let attempt = 1; attempt <= 5; attempt++) {
          const val = deterministicRoll(T2_SOVIET_OVERLOAD.id, attempt, day);
          expect(val).toBeGreaterThanOrEqual(0);
          expect(val).toBeLessThan(1);
        }
      }
    });

    it('predictExperimentOutcome 在积累轮与硬保底轮的预判输出完整准确', () => {
      const failDay = findDayForRoll(T2_SOVIET_OVERLOAD.id, 1, r => r >= 0.35);
      const predFail = predictExperimentOutcome(T2_SOVIET_OVERLOAD, { attempts: 0, exp: 0 }, failDay);
      expect(predFail).toMatchObject({
        nextAttempt: 1,
        outcome: 'accumulated',
        willBreakthrough: false,
        nextStatus: 'experimenting',
        expBefore: 0,
        expAfter: 35,
        nextProbPercent: 65,
        costPoints: 1,
        costCredits: 1500,
      });

      // T2 第 4 轮（attempts=3 → nextAttempt=4）100% 硬保底必成
      const predPity = predictExperimentOutcome(T2_SOVIET_OVERLOAD, { attempts: 3, exp: 95 }, failDay);
      expect(predPity).toMatchObject({
        nextAttempt: 4,
        guaranteed: true,
        outcome: 'breakthrough',
        willBreakthrough: true,
        nextStatus: 'active',
        expBefore: 95,
        expAfter: 100,
        nextProbPercent: 100,
      });
    });
  });

  describe('③ 五态机四重守卫与 executeProtocolExperiment 双资源实验闭环（D-P2b）', () => {
    it('守卫①：canTransitionProtocolStatus 严格执行单向无环（experimenting 不退 available/locked，active 永不回退）', () => {
      const validPairs: Array<[ProtocolStatus, ProtocolStatus]> = [
        ['undiscovered', 'locked'],
        ['undiscovered', 'available'],
        ['locked', 'available'],
        ['available', 'experimenting'],
        ['available', 'active'],
        ['experimenting', 'experimenting'],
        ['experimenting', 'active'],
        ['active', 'active'],
      ];
      for (const [from, to] of validPairs) {
        expect(canTransitionProtocolStatus(from, to), `${from}->${to}`).toBe(true);
      }

      const invalidPairs: Array<[ProtocolStatus, ProtocolStatus]> = [
        ['locked', 'undiscovered'],
        ['available', 'locked'],
        ['available', 'undiscovered'],
        ['experimenting', 'available'],
        ['experimenting', 'locked'],
        ['experimenting', 'undiscovered'],
        ['active', 'experimenting'],
        ['active', 'available'],
        ['active', 'locked'],
        ['active', 'undiscovered'],
        ['active', 'voided'],
        ['voided', 'available'],
      ];
      for (const [from, to] of invalidPairs) {
        expect(canTransitionProtocolStatus(from, to), `${from}->${to}`).toBe(false);
      }
    });

    it('T1/T2/T3 连续未突破时经验逐轮递增，并在第 3/4/5 次触发 100% 硬保底突破', () => {
      // 测试 T2 协议经历 3 轮阶段积累 + 第 4 轮硬保底突破
      const d1 = findDayForRoll(T2_SOVIET_OVERLOAD.id, 1, r => r >= 0.35);
      const d2 = findDayForRoll(T2_SOVIET_OVERLOAD.id, 2, r => r >= 0.65);
      const d3 = findDayForRoll(T2_SOVIET_OVERLOAD.id, 3, r => r >= 0.9);

      let state: ProtocolEngineStateView = {
        bases: [{ id: 'b1', name: '1号基地', buildings: [{ name: '红星实验设计局综合体', state: '运转' }] }],
        protocol_points: 5,
        economy: { credits: 10000 },
        protocols: [
          {
            ref: T2_SOVIET_OVERLOAD.id,
            status: 'available',
            attempts: 0,
            exp: 0,
            points_spent: 0,
            credits_spent: 0,
            auto_queued: true,
            hold: false,
            updated_at_day: 1,
            schema_version: 1,
          },
        ],
      };

      // k=1 积累 → exp=35%
      const r1 = executeProtocolExperiment(state, T2_SOVIET_OVERLOAD, { gameDay: d1 });
      expect(r1.executed).toBe(true);
      expect(r1.outcome).toBe('accumulated');
      expect(r1.instance).toMatchObject({
        status: 'experimenting',
        attempts: 1,
        exp: 35,
        points_spent: 1,
        credits_spent: 1500,
      });
      state = r1.state;

      // k=2 积累 → exp=70%
      const r2 = executeProtocolExperiment(state, T2_SOVIET_OVERLOAD, { gameDay: d2 });
      expect(r2.executed).toBe(true);
      expect(r2.instance).toMatchObject({
        status: 'experimenting',
        attempts: 2,
        exp: 70,
        points_spent: 2,
        credits_spent: 3000,
      });
      state = r2.state;

      // k=3 积累 → exp=95%
      const r3 = executeProtocolExperiment(state, T2_SOVIET_OVERLOAD, { gameDay: d3 });
      expect(r3.executed).toBe(true);
      expect(r3.instance).toMatchObject({
        status: 'experimenting',
        attempts: 3,
        exp: 95,
        points_spent: 3,
        credits_spent: 4500,
      });
      state = r3.state;

      // k=4 硬保底 100% 必成 → status='active', exp=100, auto_queued 自动清除
      const r4 = executeProtocolExperiment(state, T2_SOVIET_OVERLOAD, { gameDay: d3 + 1 });
      expect(r4.executed).toBe(true);
      expect(r4.outcome).toBe('breakthrough');
      expect(r4.instance).toMatchObject({
        status: 'active',
        attempts: 4,
        exp: 100,
        points_spent: 4,
        credits_spent: 6000,
        auto_queued: false,
      });
      expect(r4.state.protocol_points).toBe(1);
      expect(r4.state.economy?.credits).toBe(4000);
    });

    it('T1 第 3 次硬保底必成、T3 第 5 次硬保底必成', () => {
      const stateT1: ProtocolEngineStateView = {
        bases: [{ buildings: [] }],
        protocol_points: 2,
        economy: { credits: 2000 },
        protocols: [
          {
            ref: T1_SOVIET_PROTO_1.id,
            status: 'experimenting',
            attempts: 2,
            exp: 90,
            points_spent: 2,
            credits_spent: 1000,
            auto_queued: false,
            hold: false,
            updated_at_day: 2,
            schema_version: 1,
          },
        ],
      };
      const resT1 = executeProtocolExperiment(stateT1, T1_SOVIET_PROTO_1, { gameDay: 5 });
      expect(resT1.executed).toBe(true);
      expect(resT1.outcome).toBe('breakthrough');
      expect(resT1.instance.status).toBe('active');
      expect(resT1.instance.exp).toBe(100);

      const stateT3: ProtocolEngineStateView = {
        bases: [{ buildings: [{ name: '国家战略工程综合体／红星科学城', state: '运转' }] }],
        protocol_points: 2,
        economy: { credits: 10000 },
        protocols: [
          {
            ref: T3_SOVIET_ORBITAL.id,
            status: 'experimenting',
            attempts: 4,
            exp: 95,
            points_spent: 4,
            credits_spent: 16000,
            auto_queued: false,
            hold: false,
            updated_at_day: 4,
            schema_version: 1,
          },
        ],
      };
      const resT3 = executeProtocolExperiment(stateT3, T3_SOVIET_ORBITAL, { gameDay: 8 });
      expect(resT3.executed).toBe(true);
      expect(resT3.outcome).toBe('breakthrough');
      expect(resT3.instance.status).toBe('active');
      expect(resT3.instance.exp).toBe(100);
    });

    it('守卫②与守卫③：实验室离线（断电/损毁）时 experimenting 数据 100% 封存不清零；active 终态永久保持', () => {
      const offlineState: ProtocolEngineStateView = {
        bases: [
          {
            buildings: [
              { name: '红星实验设计局综合体', state: '断电' },
              { name: '盟军联合科研与国家工程组织节点', state: '运转' }, // 异阵营 T3 在场也不代解锁苏 T2
            ],
          },
        ],
        protocol_points: 10,
        economy: { credits: 50000 },
        protocols: [
          {
            ref: T2_SOVIET_OVERLOAD.id,
            status: 'experimenting',
            attempts: 2,
            exp: 70,
            points_spent: 2,
            credits_spent: 3000,
            auto_queued: true,
            hold: false,
            updated_at_day: 10,
            schema_version: 1,
          },
          {
            ref: T3_SOVIET_ORBITAL.id,
            status: 'active',
            attempts: 3,
            exp: 100,
            points_spent: 3,
            credits_spent: 12000,
            auto_queued: false,
            hold: false,
            updated_at_day: 9,
            schema_version: 1,
          },
        ],
      };

      expect(isProtocolLabOnline(offlineState, T2_SOVIET_OVERLOAD)).toBe(false);
      const blocked = executeProtocolExperiment(offlineState, T2_SOVIET_OVERLOAD, { gameDay: 11 });
      expect(blocked.executed).toBe(false);
      expect(blocked.reason).toBe('lab_offline');
      // 100% 封存：attempts / exp / points_spent / credits_spent / status 原封不动，资源零扣减
      expect(blocked.instance).toMatchObject({
        status: 'experimenting',
        attempts: 2,
        exp: 70,
        points_spent: 2,
        credits_spent: 3000,
      });
      expect(blocked.state.protocol_points).toBe(10);
      expect(blocked.state.economy?.credits).toBe(50000);

      // active 协议即使所有苏联实验室全毁，依然保持 active (exp=100)
      const activeCheck = executeProtocolExperiment(offlineState, T3_SOVIET_ORBITAL, { gameDay: 11 });
      expect(activeCheck.executed).toBe(false);
      expect(activeCheck.reason).toBe('already_active');
      expect(activeCheck.instance).toMatchObject({ status: 'active', exp: 100 });
    });

    it('双资源不足拒止：协议点不足或资金不足时拒止实验且不扣任何资源', () => {
      const baseState: ProtocolEngineStateView = {
        bases: [{ buildings: [{ name: '红星实验设计局综合体', state: '运转' }] }],
        protocol_points: 0.8, // 不足 1 点
        economy: { credits: 5000 },
        protocols: [
          {
            ref: T2_SOVIET_OVERLOAD.id,
            status: 'available',
            attempts: 0,
            exp: 0,
            points_spent: 0,
            credits_spent: 0,
            auto_queued: false,
            hold: false,
            updated_at_day: 1,
            schema_version: 1,
          },
        ],
      };
      const noPoints = executeProtocolExperiment(baseState, T2_SOVIET_OVERLOAD, { gameDay: 2 });
      expect(noPoints.executed).toBe(false);
      expect(noPoints.reason).toBe('insufficient_points');
      expect(noPoints.state.economy?.credits).toBe(5000);

      const noCreditsState: ProtocolEngineStateView = {
        ...baseState,
        protocol_points: 2,
        economy: { credits: 1200 }, // 不足 T2 所需的 1500
      };
      const noCredits = executeProtocolExperiment(noCreditsState, T2_SOVIET_OVERLOAD, { gameDay: 2 });
      expect(noCredits.executed).toBe(false);
      expect(noCredits.reason).toBe('insufficient_credits');
      expect(noCredits.state.protocol_points).toBe(2);
    });
  });

  describe('④ 实验自动启封、奇遇事件启封与同轨线性拓扑解锁（D-P5c / D-P3）', () => {
    it('discoverProtocolsByExperiment：当 building_any 在场运转且 research_all 已完成时自动由 undiscovered 转 available', () => {
      const stateMissingTech: ProtocolEngineStateView = {
        bases: [{ buildings: [{ name: '红星实验设计局综合体', state: '运转' }] }],
        tech: { done: [] },
        protocols: [
          {
            ref: T2_SOVIET_OVERLOAD.id,
            status: 'undiscovered',
            attempts: 0,
            exp: 0,
            points_spent: 0,
            credits_spent: 0,
            auto_queued: false,
            hold: false,
            updated_at_day: 0,
            schema_version: 1,
          },
        ],
      };
      // 缺少「高级作战实验理论」时不启封
      expect(discoverProtocolsByExperiment(stateMissingTech, [T2_SOVIET_OVERLOAD], 6).discoveredIds).toHaveLength(0);

      // 补齐研究后自动启封并写入 last_result.outcome === 'discovered'
      const stateReady: ProtocolEngineStateView = {
        ...stateMissingTech,
        tech: { done: ['高级作战实验理论'] },
      };
      const disc = discoverProtocolsByExperiment(stateReady, [T2_SOVIET_OVERLOAD], 6);
      expect(disc.discoveredIds).toEqual([T2_SOVIET_OVERLOAD.id]);
      expect(disc.instances[0]).toMatchObject({
        ref: T2_SOVIET_OVERLOAD.id,
        status: 'available',
        discovered_via: 'experiment',
        updated_at_day: 6,
        last_result: {
          day: 6,
          outcome: 'discovered',
          attempt: 0,
          exp_before: 0,
          exp_after: 0,
          next_prob: 35,
        },
      });
    });

    it('discoverProtocolByEvent：奇遇事件启封记 discovered_via="event"，且对已 experimenting/active 实例绝不退化', () => {
      const state: ProtocolEngineStateView = { bases: [], protocols: [] };
      const res = discoverProtocolByEvent(state, T2_SOVIET_OVERLOAD, 9);
      expect(res.discovered).toBe(true);
      expect(res.instance).toMatchObject({
        ref: T2_SOVIET_OVERLOAD.id,
        status: 'available',
        discovered_via: 'event',
        last_result: { day: 9, outcome: 'discovered', next_prob: 35 },
      });

      // 再次对已 active 实例触发事件启封：绝不退化
      const activeState: ProtocolEngineStateView = {
        bases: [],
        protocols: [{ ...res.instance, status: 'active', exp: 100 }],
      };
      const repeat = discoverProtocolByEvent(activeState, T2_SOVIET_OVERLOAD, 10);
      expect(repeat.discovered).toBe(false);
      expect(repeat.instance.status).toBe('active');
      expect(repeat.instance.exp).toBe(100);
    });

    it('refreshProtocolTrackAvailability：同轨前序 active + 对口实验室 Tier 达标时解锁后继 locked 协议', () => {
      const catalog = [T1_SOVIET_PROTO_1, T1_SOVIET_PROTO_2];
      // 初始仅第 1 项 locked：无前序且 T1 免实验室 → 解锁第 1 项，第 2 项仍因前序未 active 保持 locked
      const init: ProtocolEngineStateView = {
        bases: [],
        protocols: [
          {
            ref: T1_SOVIET_PROTO_1.id,
            status: 'locked',
            attempts: 0,
            exp: 0,
            points_spent: 0,
            credits_spent: 0,
            auto_queued: false,
            hold: false,
            updated_at_day: 0,
            schema_version: 1,
          },
          {
            ref: T1_SOVIET_PROTO_2.id,
            status: 'locked',
            attempts: 0,
            exp: 0,
            points_spent: 0,
            credits_spent: 0,
            auto_queued: false,
            hold: false,
            updated_at_day: 0,
            schema_version: 1,
          },
        ],
      };
      const r1 = refreshProtocolTrackAvailability(init, catalog, 1);
      expect(r1.unlockedIds).toEqual([T1_SOVIET_PROTO_1.id]);
      expect(r1.state.protocols?.[0].status).toBe('available');
      expect(r1.state.protocols?.[1].status).toBe('locked');
    });
  });

  describe('⑤ settleAutoProtocols 消费已产点余额、排程推进与「零单步跨任务穿透」铁律（D-P27）', () => {
    it('仅按 queue_order 执行队首实验，突破后解锁同轨后继但不跨任务穿透', () => {
      const catalog = [T1_SOVIET_PROTO_1, T1_SOVIET_PROTO_2, T2_SOVIET_OVERLOAD];
      // 找一个让 T1_SOVIET_PROTO_1 在第 1 轮直接突破（roll < 0.55）的确定性游戏日
      const winDay = findDayForRoll(T1_SOVIET_PROTO_1.id, 1, r => r < 0.55);

      const initialState: ProtocolEngineStateView = {
        meta: { day_count: winDay },
        bases: [
          {
            id: 'base-1',
            name: '1号基地',
            buildings: [
              { name: '红星实验设计局综合体', state: '运转' },
              { name: '超算中心', state: '运转' }, // 日产 = 0.10 + 0.15 + 0.10 = 0.35/日
            ],
          },
        ],
        tech: { done: ['高级作战实验理论'] },
        protocol_points: 5, // 充足点数
        economy: { credits: 10000 }, // 充足资金
        protocols: [
          {
            ref: T1_SOVIET_PROTO_2.id,
            status: 'locked', // 同轨后继，排在队首突破后才应解锁为 available
            attempts: 0,
            exp: 0,
            points_spent: 0,
            credits_spent: 0,
            auto_queued: true,
            queue_order: 2,
            hold: false,
            updated_at_day: 1,
            schema_version: 1,
          },
          {
            ref: T1_SOVIET_PROTO_1.id,
            status: 'available',
            attempts: 0,
            exp: 0,
            points_spent: 0,
            credits_spent: 0,
            auto_queued: true,
            queue_order: 1, // 队首
            hold: false,
            updated_at_day: 1,
            schema_version: 1,
          },
        ],
      };

      const snapshotBefore = structuredClone(initialState);
      // 上游已完成产点，自动调度仅扣除本次实验费用。
      const res = settleAutoProtocols(initialState, catalog);

      // 纯函数零入参修改断言
      expect(initialState).toStrictEqual(snapshotBefore);

      // 队首 T1_SOVIET_PROTO_1 执行 1 轮实验并突破
      expect(res.experimentExecuted).toBe(true);
      expect(res.experimentProtocolId).toBe(T1_SOVIET_PROTO_1.id);
      expect(res.experimentOutcome).toBe('breakthrough');
      // 突破后同轨后继 T1_SOVIET_PROTO_2 自动由 locked 解锁为 available
      expect(res.unlockedIds).toContain(T1_SOVIET_PROTO_2.id);

      const byRef = Object.fromEntries((res.state.protocols ?? []).map(p => [p.ref, p]));
      // 队首突破为 active，且 auto_queued 清除为 false
      expect(byRef[T1_SOVIET_PROTO_1.id]).toMatchObject({
        status: 'active',
        exp: 100,
        attempts: 1,
        auto_queued: false,
      });
      // 零单步跨任务穿透铁律：尽管剩余 4 点、9500 资金且 T1_SOVIET_PROTO_2 已解锁为 available (auto_queued=true)，
      // 本轮绝不穿透执行 T1_SOVIET_PROTO_2 的实验（attempts 仍为 0）！
      expect(byRef[T1_SOVIET_PROTO_2.id]).toMatchObject({
        status: 'available',
        attempts: 0,
        exp: 0,
        auto_queued: true,
      });
      expect(res.state.protocol_points).toBe(4);
      expect(res.state.economy?.credits).toBe(9500);
    });

    it('hold=true 的排程协议被跳过，由下一顺位非 hold 协议递补执行', () => {
      const catalog = [T1_SOVIET_PROTO_1, T1_SOVIET_PROTO_2];
      const state: ProtocolEngineStateView = {
        meta: { day_count: 3 },
        bases: [],
        protocol_points: 2,
        economy: { credits: 2000 },
        protocols: [
          {
            ref: T1_SOVIET_PROTO_1.id,
            status: 'available',
            attempts: 0,
            exp: 0,
            points_spent: 0,
            credits_spent: 0,
            auto_queued: true,
            queue_order: 1,
            hold: true, // 暂缓
            updated_at_day: 1,
            schema_version: 1,
          },
          {
            ref: T1_SOVIET_PROTO_2.id,
            status: 'experimenting',
            attempts: 1,
            exp: 50,
            points_spent: 1,
            credits_spent: 500,
            auto_queued: true,
            queue_order: 2,
            hold: false,
            updated_at_day: 2,
            schema_version: 1,
          },
        ],
      };

      const res = settleAutoProtocols(state, catalog);
      expect(res.experimentExecuted).toBe(true);
      expect(res.experimentProtocolId).toBe(T1_SOVIET_PROTO_2.id);
    });

    it('FIX-P0-04：skipProtocolIds 显式排除当楼已手动实验或步骤 B 新解锁的协议，无需篡改 hold 字段', () => {
      const proto2Independent: ProtocolDefinitionLike = { ...T1_SOVIET_PROTO_2, track: '前哨机动与后勤节点' };
      const catalog = [T1_SOVIET_PROTO_1, proto2Independent];
      const state: ProtocolEngineStateView = {
        faction: '苏联',
        meta: { day_count: 3 },
        economy: { credits: 5000 },
        protocol_points: 5,
        bases: [{ status: '正常', buildings: [{ name: '红星实验设计局初创所', state: '运转' }] }],
        protocols: [
          {
            ref: T1_SOVIET_PROTO_1.id,
            status: 'available',
            attempts: 0,
            exp: 0,
            points_spent: 0,
            credits_spent: 0,
            auto_queued: true,
            queue_order: 1,
            hold: false,
            updated_at_day: 2,
            schema_version: 1,
          },
          {
            ref: proto2Independent.id,
            status: 'available',
            attempts: 0,
            exp: 0,
            points_spent: 0,
            credits_spent: 0,
            auto_queued: true,
            queue_order: 2,
            hold: false,
            updated_at_day: 2,
            schema_version: 1,
          },
        ],
      };

      const res = settleAutoProtocols(state, catalog, {
        skipProtocolIds: new Set([T1_SOVIET_PROTO_1.id]),
      });
      expect(res.experimentExecuted).toBe(true);
      expect(res.experimentProtocolId).toBe(proto2Independent.id);
      const firstInst = res.state.protocols?.find(p => p.ref === T1_SOVIET_PROTO_1.id);
      expect(firstInst?.hold).toBe(false);
    });

    it('G02-04：roundPoints4 按日产分钟有理格精确承接短楼层余数，3×10m、144×10m、1440×1m 与整段积分及跨 1.0 实验扣除严格一致', () => {
      const accrueSlices = (initPoints: number, dailyRate: number, slices: number[]) => {
        let pts = initPoints;
        for (const mins of slices) {
          pts = roundPoints4(pts + dailyRate * (mins / 1440));
        }
        return pts;
      };

      expect(accrueSlices(0, 0.35, [10, 10, 10])).toBe(accrueSlices(0, 0.35, [30]));
      expect(accrueSlices(0.9, 0.1, [480, 480, 480])).toBe(1);
      expect(accrueSlices(0.9, 0.112, Array(144).fill(10))).toBe(1.012);
      expect(accrueSlices(0.9, 0.112, Array(1440).fill(1))).toBe(1.012);

      // 累积跨过 1.0 后执行实验扣除 1 点，余数仍精确为 0.012
      const afterSlices = accrueSlices(0.9, 0.112, Array(144).fill(10));
      const expRes = executeProtocolExperiment(
        {
          bases: [{ buildings: [{ name: '红星实验设计局初创所', state: '运转' }] }],
          protocol_points: afterSlices,
          economy: { credits: 2000 },
          protocols: [
            {
              ref: T1_SOVIET_PROTO_1.id,
              status: 'available',
              attempts: 0,
              exp: 0,
              points_spent: 0,
              credits_spent: 0,
              auto_queued: true,
              hold: false,
              updated_at_day: 1,
              schema_version: 1,
            },
          ],
        },
        T1_SOVIET_PROTO_1,
        { gameDay: 1 },
      );
      expect(expRes.executed).toBe(true);
      expect(expRes.state.protocol_points).toBe(0.012);
    });
  });

  describe('⑥ createProtocolLaneProvider 工位视图对接（D-P27）', () => {
    it('输出 domain="protocol" 与 laneKey="theater:lane.protocol"，并根据在役实验室与超算中心联动状态', () => {
      const provider = createProtocolLaneProvider({
        requiredFaction: '苏联',
        requiredTier: 2,
      });
      expect(provider.domain).toBe('protocol');

      const offlineViews = provider.resolveLanes({ bases: [] });
      expect(offlineViews).toHaveLength(1);
      expect(offlineViews[0]).toMatchObject({
        laneKey: PROTOCOL_LANE_KEY,
        domain: 'protocol',
        capacity: 0,
        locked: true,
      });

      const onlineViews = provider.resolveLanes({
        bases: [
          {
            buildings: [
              { name: '红星实验设计局综合体', state: '运转' },
              { name: '量子超算中心', state: '运转' },
            ],
          },
        ],
      });
      expect(onlineViews[0]).toMatchObject({
        laneKey: PROTOCOL_LANE_KEY,
        domain: 'protocol',
        capacity: 1,
        locked: false,
        accelMultiplier: 1.25,
      });
    });
  });
});
