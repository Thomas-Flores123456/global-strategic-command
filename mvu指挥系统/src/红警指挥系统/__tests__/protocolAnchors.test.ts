/**
 * protocolAnchors.test.ts —— 7 建筑阶梯锚定与双轴产点单元测试（PRT-SLOT-01）
 *
 * 覆盖：
 * 1. PROTOCOL_ANCHOR_BUILDINGS 7 座建筑注册表完整性与 researchSlots.ts 同源对齐；
 * 2. scanActiveProtocolBuildings 在役扫描与废弃基地 / 建造中 / 损毁 / 停机 / 离线 / 断电 / 瘫痪过滤；
 * 3. factionLabTier 阵营对口 Tier 准入（含跨阵营不越权代解锁 T2/T3、通用战斗实验室兜底双方 T2 但不升 T3、超算不解锁协议 Tier）；
 * 4. dailyProtocolPointRate 与 resolveProtocolPointBreakdown 双轴日产速率（基础 0.10、同阵营 T3 替代 T2、跨阵营第二院所 50% 折算、量子超算 0.25 替代超算 0.10、单系满配 0.65/日、双系满配 0.80/日、断电/损毁不产点）。
 */

import { describe, expect, it } from 'vitest';
import {
  dailyProtocolPointRate,
  factionLabTier,
  isAnyBuildingOperationalInState,
  PROTOCOL_ANCHOR_BUILDINGS,
  PROTOCOL_BASE_DAILY_RATE,
  resolveProtocolPointBreakdown,
  scanActiveProtocolBuildings,
  TECH_TIER_T2_ANCHORS,
  TECH_TIER_T3_ANCHORS,
  type ProtocolAnchorStateView,
} from '../engines/protocolAnchors';
import { techTier } from '../engines/researchSlots';

function makeState(
  buildings: Array<string | { name: string; state?: string }>,
  baseStatus = '隐蔽中',
): ProtocolAnchorStateView {
  return {
    bases: [
      {
        id: 'base-1',
        name: '1号基地',
        status: baseStatus,
        buildings: buildings.map(b => (typeof b === 'string' ? { name: b, state: '运转' } : b)),
      },
    ],
  };
}

describe('PRT-SLOT-01 · protocolAnchors 7 建筑阶梯锚定与双轴产点', () => {
  describe('① 7 座核心科研/算力建筑注册表与 researchSlots 同源会师', () => {
    it('PROTOCOL_ANCHOR_BUILDINGS 精确收录核心科研/算力建筑，ID/阵营/轴向/档位/日产速率无偏差', () => {
      expect(PROTOCOL_ANCHOR_BUILDINGS.length).toBeGreaterThanOrEqual(7);
      const byId = Object.fromEntries(PROTOCOL_ANCHOR_BUILDINGS.map(b => [b.id, b]));

      expect(byId['bld.common.battle_lab']).toMatchObject({
        name: '战斗实验室',
        faction: '通用',
        axis: 'institute',
        tier: 2,
        dailyRate: 0.15,
      });
      expect(byId['bld.soviet.red_star_design_bureau']).toMatchObject({
        name: '红星实验设计局综合体',
        faction: '苏联',
        axis: 'institute',
        tier: 2,
        dailyRate: 0.15,
      });
      expect(byId['bld.soviet.red_star_science_city']).toMatchObject({
        name: '国家战略工程综合体／红星科学城',
        faction: '苏联',
        axis: 'institute',
        tier: 3,
        dailyRate: 0.3,
      });
      expect(byId['bld.allied.battle_lab']).toMatchObject({
        name: '盟军战斗实验室',
        faction: '盟军',
        axis: 'institute',
        tier: 2,
        dailyRate: 0.15,
      });
      expect(byId['bld.allied.joint_research_organization_node']).toMatchObject({
        name: '盟军联合科研与国家工程组织节点',
        faction: '盟军',
        axis: 'institute',
        tier: 3,
        dailyRate: 0.3,
      });
      expect(byId['bld.common.supercomputing_center']).toMatchObject({
        name: '超算中心',
        faction: '通用',
        axis: 'compute',
        tier: 2,
        dailyRate: 0.1,
      });
      expect(byId['bld.common.quantum_supercomputing_center']).toMatchObject({
        name: '量子超算中心',
        faction: '通用',
        axis: 'compute',
        tier: 3,
        dailyRate: 0.25,
      });
    });

    it('与 researchSlots.ts TECH_TIER_T2_ANCHORS / TECH_TIER_T3_ANCHORS 同源对齐', () => {
      expect(TECH_TIER_T2_ANCHORS).toEqual(expect.arrayContaining(['战斗实验室', '红星实验设计局']));
      expect(TECH_TIER_T3_ANCHORS).toEqual(
        expect.arrayContaining([
          '国家战略工程综合体',
          '红星科学城',
          '盟军联合科研与国家工程组织节点',
          '量子超算中心',
        ]),
      );
      expect(techTier(makeState(['战斗实验室', '红星科学城']))).toBe(3);
    });
  });

  describe('② scanActiveProtocolBuildings 在役扫描与非运转状态过滤', () => {
    it('精确区分「战斗实验室」与「盟军战斗实验室」、「超算中心」与「量子超算中心」', () => {
      const scanAllied = scanActiveProtocolBuildings(makeState(['盟军战斗实验室', '量子超算中心']));
      expect(scanAllied.alliedT2Lab).toBe(true);
      expect(scanAllied.commonBattleLab).toBe(false);
      expect(scanAllied.quantumSupercomputer).toBe(true);
      expect(scanAllied.supercomputer).toBe(false);

      const scanCommon = scanActiveProtocolBuildings(makeState(['07·战斗实验室', '25·超算中心']));
      expect(scanCommon.commonBattleLab).toBe(true);
      expect(scanCommon.alliedT2Lab).toBe(false);
      expect(scanCommon.supercomputer).toBe(true);
      expect(scanCommon.quantumSupercomputer).toBe(false);
    });

    it('过滤建造中/损毁/受损/停机/离线/断电/瘫痪建筑及废弃/失守基地', () => {
      const inactiveStates = ['建造中', '损毁', '受损', '停机', '离线', '断电', '瘫痪', '摧毁'];
      for (const st of inactiveStates) {
        const scan = scanActiveProtocolBuildings(makeState([{ name: '国家战略工程综合体／红星科学城', state: st }]));
        expect(scan.sovietT3Sanctuary, `state=${st}`).toBe(false);
        expect(scan.buildings, `state=${st}`).toHaveLength(0);
      }

      for (const baseStatus of ['废弃', '失守']) {
        const scan = scanActiveProtocolBuildings(makeState(['红星实验设计局综合体', '量子超算中心'], baseStatus));
        expect(scan.buildings, `baseStatus=${baseStatus}`).toHaveLength(0);
      }
    });

    it('isAnyBuildingOperationalInState 支持候选建筑名列表判定', () => {
      const state = makeState(['红星实验设计局综合体']);
      expect(isAnyBuildingOperationalInState(state, ['红星实验设计局综合体', '战斗实验室'])).toBe(true);
      expect(isAnyBuildingOperationalInState(state, ['国家战略工程综合体'])).toBe(false);
    });
  });

  describe('③ factionLabTier 阵营对口 Tier 准入（D-P8b）', () => {
    it('Stage 0（无实验室）：苏/盟/通用均返回 Tier 1', () => {
      const empty = makeState(['苏联建造厂', '核子反应堆']);
      expect(factionLabTier(empty, '苏联')).toBe(1);
      expect(factionLabTier(empty, '盟军')).toBe(1);
      expect(factionLabTier(empty)).toBe(1);
    });

    it('通用战斗实验室可兜底解锁苏联 T2 与盟军 T2，但不可解锁任一阵营 T3', () => {
      const state = makeState(['07·战斗实验室']);
      expect(factionLabTier(state, '苏联')).toBe(2);
      expect(factionLabTier(state, '盟军')).toBe(2);
      expect(factionLabTier(state)).toBe(2);
    });

    it('苏联对口准入：红星设计局→T2，国家战略工程综合体/红星科学城→T3', () => {
      expect(factionLabTier(makeState(['红星实验设计局综合体']), '苏联')).toBe(2);
      expect(factionLabTier(makeState(['国家战略工程综合体']), '苏联')).toBe(3);
      expect(factionLabTier(makeState(['红星科学城']), '苏联')).toBe(3);
      expect(factionLabTier(makeState(['26·国家战略工程综合体／红星科学城']), 'soviet')).toBe(3);
    });

    it('盟军对口准入：盟军战斗实验室→T2，盟军联合科研与国家工程组织节点→T3', () => {
      expect(factionLabTier(makeState(['盟军战斗实验室']), '盟军')).toBe(2);
      expect(factionLabTier(makeState(['盟军联合科研与国家工程组织节点']), '盟军')).toBe(3);
      expect(factionLabTier(makeState(['37·盟军联合科研与国家工程组织节点']), 'allied')).toBe(3);
    });

    it('跨阵营隔离铁律：盟军联合科研节点/盟军战斗实验室/量子超算绝不可代解锁苏联 T2/T3', () => {
      const alliedMax = makeState(['盟军战斗实验室', '盟军联合科研与国家工程组织节点', '超算中心', '量子超算中心']);
      expect(factionLabTier(alliedMax, '苏联')).toBe(1);
      expect(factionLabTier(alliedMax, 'soviet')).toBe(1);
      expect(factionLabTier(alliedMax, '盟军')).toBe(3);
      expect(factionLabTier(alliedMax)).toBe(3);
    });

    it('跨阵营隔离铁律：苏联红星设计局/红星科学城/量子超算绝不可代解锁盟军 T2/T3', () => {
      const sovietMax = makeState([
        '红星实验设计局综合体',
        '国家战略工程综合体／红星科学城',
        '超算中心',
        '量子超算中心',
      ]);
      expect(factionLabTier(sovietMax, '盟军')).toBe(1);
      expect(factionLabTier(sovietMax, 'allied')).toBe(1);
      expect(factionLabTier(sovietMax, '苏联')).toBe(3);
      expect(factionLabTier(sovietMax)).toBe(3);
    });

    it('通用战斗实验室 + 盟军联合科研节点在场时，苏联最多到 T2，绝不可蹭升 T3', () => {
      const state = makeState(['战斗实验室', '盟军联合科研与国家工程组织节点']);
      expect(factionLabTier(state, '苏联')).toBe(2);
      expect(factionLabTier(state, '盟军')).toBe(3);
    });
  });

  describe('④ dailyProtocolPointRate 与 resolveProtocolPointBreakdown 双轴日产速率（D-P8c）', () => {
    it('战地基础流：无科研/算力建筑时恒为 0.10 点/日', () => {
      expect(PROTOCOL_BASE_DAILY_RATE).toBe(0.1);
      expect(dailyProtocolPointRate(makeState([]))).toBe(0.1);
      expect(dailyProtocolPointRate(undefined)).toBe(0.1);
    });

    it('单院所与同阵营 T3 替代 T2（不重复叠加同系 T2）', () => {
      // 通用战斗实验室单独在场：0.10 + 0.15 = 0.25（不重复双计苏盟）
      expect(dailyProtocolPointRate(makeState(['战斗实验室']))).toBe(0.25);
      // 苏联 T2 红星设计局：0.10 + 0.15 = 0.25
      expect(dailyProtocolPointRate(makeState(['红星实验设计局综合体']))).toBe(0.25);
      // 苏联 T3 红星科学城替代 T2 红星设计局：0.10 + 0.30 = 0.40
      expect(dailyProtocolPointRate(makeState(['红星实验设计局综合体', '国家战略工程综合体／红星科学城']))).toBe(0.4);
      // 盟军 T3 联合科研节点替代 T2 盟军战斗实验室：0.10 + 0.30 = 0.40
      expect(dailyProtocolPointRate(makeState(['盟军战斗实验室', '盟军联合科研与国家工程组织节点']))).toBe(0.4);
    });

    it('算力辅助副轴：量子超算（+0.25）替代普通超算（+0.10），与主轴直接叠加', () => {
      // 红星设计局(0.15) + 超算中心(0.10) + 基础(0.10) = 0.35（任务包 §3.6.2 标准示例）
      expect(dailyProtocolPointRate(makeState(['红星实验设计局综合体', '超算中心']))).toBe(0.35);
      // 红星设计局(0.15) + 超算 + 量子超算(0.25 替代 0.10) + 基础(0.10) = 0.50
      expect(dailyProtocolPointRate(makeState(['红星实验设计局综合体', '超算中心', '量子超算中心']))).toBe(0.5);
    });

    it('单阵营满配（基础 0.10 + T3 圣地 0.30 + 量子超算 0.25）= 0.65 点/日', () => {
      const sovietFull = makeState([
        '战斗实验室',
        '红星实验设计局综合体',
        '国家战略工程综合体／红星科学城',
        '超算中心',
        '量子超算中心',
      ]);
      const breakdown = resolveProtocolPointBreakdown(sovietFull);
      expect(breakdown.baseRate).toBe(0.1);
      expect(breakdown.instituteAxisRate).toBe(0.3);
      expect(breakdown.computeAxisRate).toBe(0.25);
      expect(breakdown.totalDailyRate).toBe(0.65);
      expect(dailyProtocolPointRate(sovietFull)).toBe(0.65);
    });

    it('跨阵营并网协同：主院所 100% 计入，副院所按 50% 折算', () => {
      // 苏 T2 (0.15) + 盟 T2 (0.15 * 0.5 = 0.075) + 基础 (0.10) = 0.325
      const bothT2 = resolveProtocolPointBreakdown(makeState(['红星实验设计局综合体', '盟军战斗实验室']));
      expect(bothT2.crossFactionSynergy).toBe(true);
      expect(bothT2.primaryInstituteRate).toBe(0.15);
      expect(bothT2.secondaryInstituteRate).toBe(0.075);
      expect(bothT2.totalDailyRate).toBe(0.325);

      // 苏 T3 (0.30) + 盟 T2 (0.15 * 0.5 = 0.075) + 基础 (0.10) = 0.475
      const sovT3AllT2 = resolveProtocolPointBreakdown(makeState(['国家战略工程综合体／红星科学城', '盟军战斗实验室']));
      expect(sovT3AllT2.primaryInstituteRate).toBe(0.3);
      expect(sovT3AllT2.secondaryInstituteRate).toBe(0.075);
      expect(sovT3AllT2.totalDailyRate).toBe(0.475);

      // 苏 T3 (0.30) + 盟 T3 (0.30 * 0.5 = 0.15) + 量子超算 (0.25) + 基础 (0.10) = 0.80
      const dualT3Full = resolveProtocolPointBreakdown(
        makeState(['国家战略工程综合体／红星科学城', '盟军联合科研与国家工程组织节点', '量子超算中心']),
      );
      expect(dualT3Full.instituteAxisRate).toBe(0.45);
      expect(dualT3Full.totalDailyRate).toBe(0.8);
    });

    it('断电/损毁/停机/建造中建筑不产点，仅剩余运转建筑计入', () => {
      const state = makeState([
        { name: '红星实验设计局综合体', state: '运转' },
        { name: '国家战略工程综合体／红星科学城', state: '断电' },
        { name: '量子超算中心', state: '损毁' },
        { name: '超算中心', state: '建造中' },
      ]);
      // 仅红星实验设计局运转：0.10 + 0.15 = 0.25
      expect(dailyProtocolPointRate(state)).toBe(0.25);
    });
  });
});
