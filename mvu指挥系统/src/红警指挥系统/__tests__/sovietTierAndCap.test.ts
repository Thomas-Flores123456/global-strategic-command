import { describe, expect, it } from 'vitest';

import { FACTION_DEFS, deriveFactionTiers } from '../core/catalog';
import {
  SOVIET_T2_LAB_NAMES,
  SOVIET_T3_HEAVY_WEAPONS,
  SOVIET_T3_MANUFACTURING_LOOPS,
  SOVIET_T3_SCIENCE_CITY_NAMES,
  SOVIET_T3_TICKET_TECHS,
  evaluatePrerequisite,
  evaluateSovietSpecialCapacity,
  evaluateSovietTierGate,
  type PrerequisiteContext,
} from '../core/prerequisites';
import { evaluateSovietSpecialCapacity as evaluateSovietSpecialCapacityFromLanes } from '../engines/productionLanes';
import { evaluateRedStarHammerPayload } from '../engines/projectEngine';
import { factionLabTier, scanActiveProtocolBuildings } from '../engines/protocolAnchors';
import { techTier } from '../engines/researchSlots';

describe('SOV-CODE-TIER-01 苏联 T1→T2→T3 跨代门槛与新旧实验室别名互通', () => {
  it('导出完整的苏联 T2/T3 核心常量表', () => {
    expect(SOVIET_T2_LAB_NAMES).toEqual([
      '红星实验设计局综合体',
      '红星实验设计局',
      '苏联战斗实验室',
      '苏联作战实验室',
    ]);
    expect(SOVIET_T3_SCIENCE_CITY_NAMES).toEqual([
      '红星科学城',
      '国家战略工程综合体／红星科学城',
      '国家战略工程综合体/红星科学城',
      '国家战略工程综合体',
    ]);
    expect(SOVIET_T3_TICKET_TECHS).toEqual([
      '高能电容脉冲',
      '磁能反应堆',
      '纳米机器人控制芯片',
      '作战实验室联合数据链',
    ]);
    expect(SOVIET_T3_MANUFACTURING_LOOPS).toEqual([
      '重核聚变闭环',
      '超导磁流体闭环',
      '高能合成材料闭环',
    ]);
    expect(SOVIET_T3_HEAVY_WEAPONS).toEqual([
      '天启坦克',
      '基洛夫空艇',
      'V4战术导弹发射车',
      '无畏级导弹舰',
      '米格重型截击机',
    ]);
  });

  it('T1→T2：支持红星实验设计局综合体与旧名苏联战斗实验室/作战实验室互通判定，过滤非运转建筑', () => {
    const t1Only = evaluateSovietTierGate({
      buildings: ['苏联建造厂', '磁能反应炉', { name: '红星实验设计局综合体', state: '建造中' }],
    });
    expect(t1Only.tier).toBe(1);
    expect(t1Only.t2Met).toBe(false);
    expect(t1Only.t3Met).toBe(false);
    expect(t1Only.missingForT2.length).toBeGreaterThan(0);

    for (const labAlias of SOVIET_T2_LAB_NAMES) {
      const res = evaluateSovietTierGate({ buildings: ['苏联建造厂', labAlias] });
      expect(res.tier).toBe(2);
      expect(res.t2Met).toBe(true);
      expect(res.t3Met).toBe(false);
      expect(res.missingForT2).toEqual([]);
    }
  });

  it('跨模块别名互通：catalog / protocolAnchors / researchSlots / prerequisites 对新旧苏联实验室名完全等价', () => {
    for (const labAlias of SOVIET_T2_LAB_NAMES) {
      const tiers = deriveFactionTiers(
        FACTION_DEFS,
        [
          { name: '苏联建造厂', state: '正常' },
          { name: labAlias, state: '正常' },
        ],
        [],
      );
      expect(tiers).toEqual([{ faction: '苏联', tier: 2, next: 'T3 条件未公布' }]);

      const stateView = {
        bases: [{ id: 'b1', buildings: [{ name: labAlias, state: '正常' }] }],
      };
      const scan = scanActiveProtocolBuildings(stateView);
      expect(scan.sovietT2Lab).toBe(true);
      expect(scan.commonBattleLab).toBe(false);
      expect(factionLabTier(stateView, '苏联')).toBe(2);
      expect(techTier(stateView)).toBe(2);

      const ctx: PrerequisiteContext = {
        techDone: new Set(),
        selectedBaseId: 'b1',
        bases: new Map([
          [
            'b1',
            {
              existing: new Set([labAlias]),
              completed: new Set([labAlias]),
              running: new Set([labAlias]),
            },
          ],
        ]),
        unitPresent: new Map(),
      };
      expect(
        evaluatePrerequisite(
          { kind: 'building', name: '红星实验设计局综合体', scope: 'current', state: 'completed' },
          ctx,
        ).satisfied,
      ).toBe(true);
      expect(
        evaluatePrerequisite(
          { kind: 'building', name: '苏联战斗实验室', scope: 'current', state: 'completed' },
          ctx,
        ).satisfied,
      ).toBe(true);
    }
  });

  it('T2→T3 常规模式与严格科学城认证模式（四卡 + 三闭环 + 五大重器五选二）', () => {
    // 1. 常规模式：有 T2 实验室 + 红星科学城即升 T3
    const normalT3 = evaluateSovietTierGate({
      buildings: ['红星实验设计局综合体', '国家战略工程综合体／红星科学城'],
    });
    expect(normalT3.tier).toBe(3);
    expect(normalT3.t2Met).toBe(true);
    expect(normalT3.t3Met).toBe(true);
    expect(normalT3.missingForT3).toEqual([]);

    // 2. 严格科学城认证模式：缺门票卡、缺闭环、重器不足 2 项时阻塞并返回明细
    const strictIncomplete = evaluateSovietTierGate({
      buildings: ['红星实验设计局综合体', '红星科学城'],
      strictScienceCityCert: true,
      techDone: ['高能电容脉冲', '磁能反应堆'],
      manufacturingLoops: ['重核聚变闭环'],
      heavyWeapons: ['天启坦克'],
    });
    expect(strictIncomplete.tier).toBe(2);
    expect(strictIncomplete.t2Met).toBe(true);
    expect(strictIncomplete.t3Met).toBe(false);
    expect(strictIncomplete.missingForT3).toContain('缺少科学城门票卡科技：纳米机器人控制芯片');
    expect(strictIncomplete.missingForT3).toContain('缺少科学城门票卡科技：作战实验室联合数据链');
    expect(strictIncomplete.missingForT3).toContain('缺少科学城制造闭环：超导磁流体闭环');
    expect(strictIncomplete.missingForT3).toContain('缺少科学城制造闭环：高能合成材料闭环');
    expect(strictIncomplete.missingForT3).toContain('五大T2重器列装/解锁不足2项（当前 1/2）');

    // 3. 严格科学城认证模式：4 张门票卡 + 3 大制造闭环 + 2 项 T2 重器齐备时通过 T3
    const strictComplete = evaluateSovietTierGate({
      buildings: ['苏联战斗实验室', '红星科学城'],
      strictScienceCityCert: true,
      techDone: [...SOVIET_T3_TICKET_TECHS, '重核聚变闭环'],
      activeProtocols: [
        { name: '超导磁流体闭环', status: 'active' },
        { name: '高能合成材料闭环', status: 'active' },
      ],
      unitPresent: new Map([
        ['基洛夫空艇', 1],
        ['无畏级导弹舰', 1],
      ]),
    });
    expect(strictComplete.tier).toBe(3);
    expect(strictComplete.t2Met).toBe(true);
    expect(strictComplete.t3Met).toBe(true);
    expect(strictComplete.missingForT3).toEqual([]);
  });
});

describe('SOV-CODE-CAP-01 基洛夫 1:1 专库、无畏船坞与赤星天锤 3→6 轨道载荷补给', () => {
  it('基洛夫空艇：严格按运转态专库 1:1 校验硬容量（含在编 + 队列）', () => {
    expect(evaluateSovietSpecialCapacityFromLanes).toBe(evaluateSovietSpecialCapacity);

    // 0 座专库 -> 不可建造
    const noHangar = evaluateSovietSpecialCapacity('基洛夫空艇', ['苏联空军指挥部'], 0, 0);
    expect(noHangar).toEqual({
      allowed: false,
      cap: 0,
      used: 0,
      reason: '基洛夫专库泊位已满（需 1:1 专属飞艇库支撑）',
    });

    // 2 座运转专库 + 1 座建造中专库 -> 有效泊位 2
    const buildings = [
      { name: '基洛夫飞艇制造厂', state: '正常' },
      { name: '基洛夫专库', state: '正常' },
      { name: '重型飞艇船坞', state: '建造中' },
    ];
    expect(evaluateSovietSpecialCapacity('基洛夫空艇', buildings, 1, 0)).toEqual({
      allowed: true,
      cap: 2,
      used: 1,
      reason: null,
    });
    expect(evaluateSovietSpecialCapacity('基洛夫空艇', buildings, 1, 1)).toEqual({
      allowed: false,
      cap: 2,
      used: 2,
      reason: '基洛夫专库泊位已满（需 1:1 专属飞艇库支撑）',
    });
  });

  it('无畏级导弹舰：按运转态造船厂/重型船坞 1:1 泊位校验，普通单位无专库上限', () => {
    const navalBuildings = [
      { name: '苏联造船厂', state: '正常' },
      { name: '重型船坞', state: '损毁' },
    ];
    expect(evaluateSovietSpecialCapacity('无畏级导弹舰', navalBuildings, 0, 0)).toEqual({
      allowed: true,
      cap: 1,
      used: 0,
      reason: null,
    });
    expect(evaluateSovietSpecialCapacity('无畏级导弹舰', navalBuildings, 1, 0)).toEqual({
      allowed: false,
      cap: 1,
      used: 1,
      reason: '重型船坞泊位已满（需增建造船厂/重型船坞）',
    });

    // 普通单位不受专库/重型船坞硬上限限制
    expect(evaluateSovietSpecialCapacity('天启坦克', [], 5, 2)).toEqual({
      allowed: true,
      cap: null,
      used: 7,
      reason: null,
    });
  });

  it('赤星天锤：默认 3 枚轨道载荷上限，扩仓改装后提升为 6 枚，并准确计算补弹与剩余容量', () => {
    // 默认基础仓（3 枚上限）
    expect(evaluateRedStarHammerPayload({ expanded: false, currentShells: 1, resupplyDelta: 1 })).toEqual({
      expanded: false,
      maxShells: 3,
      currentShells: 1,
      nextShells: 2,
      remainingCapacity: 1,
    });

    // 基础仓补弹溢出钳制在 3
    expect(evaluateRedStarHammerPayload({ expanded: false, currentShells: 2, resupplyDelta: 5 })).toEqual({
      expanded: false,
      maxShells: 3,
      currentShells: 2,
      nextShells: 3,
      remainingCapacity: 0,
    });

    // 扩仓改装后（6 枚上限）
    expect(evaluateRedStarHammerPayload({ expanded: true, currentShells: 3, resupplyDelta: 2 })).toEqual({
      expanded: true,
      maxShells: 6,
      currentShells: 3,
      nextShells: 5,
      remainingCapacity: 1,
    });

    // 发射消耗下限钳制在 0
    expect(evaluateRedStarHammerPayload({ expanded: true, currentShells: 2, resupplyDelta: -5 })).toEqual({
      expanded: true,
      maxShells: 6,
      currentShells: 2,
      nextShells: 0,
      remainingCapacity: 6,
    });
  });
});
