import { describe, expect, it } from 'vitest';

import {
  buildCatalogPrerequisiteContext,
  buildCompletedTechAndProtocolSet,
  buildUnitPresent,
} from '../core/catalogRuntimeContext';
import * as prerequisites from '../core/prerequisites';
import {
  BUILDING_EQUIVALENTS,
  buildEffectiveTechAndProtocolSet,
  combineLegacyPrerequisites,
  evaluateBuildingUnlock,
  evaluatePrerequisite,
  ROOT_CONYARD_BUILDINGS,
  setHasEquivalentBuilding,
  TECH_EQUIVALENT_GROUPS,
  UNIT_EQUIVALENT_GROUPS,
  type PrerequisiteBaseState,
  type PrerequisiteContext,
} from '../core/prerequisites';
import * as prerequisitesHelpers from '../core/prerequisitesHelpers';

const makeBase = (buildings: string[] = []): PrerequisiteBaseState => ({
  existing: new Set(buildings),
  completed: new Set(buildings),
  running: new Set(buildings),
});

const makeContext = (overrides: Partial<PrerequisiteContext> = {}): PrerequisiteContext => ({
  techDone: new Set(),
  selectedBaseId: 'base-1',
  bases: new Map([['base-1', makeBase(['建造厂核心'])]]),
  unitPresent: new Map(),
  ...overrides,
});

describe('PKG-A · 1. prerequisites.ts 与 prerequisitesHelpers.ts 无环导出契约', () => {
  it('从 prerequisites 与 prerequisitesHelpers 均可正常读取全部共享常量与函数，无 TDZ 异常', () => {
    expect(prerequisites.TECH_EQUIVALENT_GROUPS).toBe(prerequisitesHelpers.TECH_EQUIVALENT_GROUPS);
    expect(prerequisites.BUILDING_EQUIVALENTS).toBe(prerequisitesHelpers.BUILDING_EQUIVALENTS);
    expect(prerequisites.UNIT_EQUIVALENT_GROUPS).toBe(prerequisitesHelpers.UNIT_EQUIVALENT_GROUPS);
    expect(prerequisites.SOVIET_T2_LAB_NAMES).toBe(prerequisitesHelpers.SOVIET_T2_LAB_NAMES);
    expect(prerequisites.SOVIET_T3_SCIENCE_CITY_NAMES).toBe(prerequisitesHelpers.SOVIET_T3_SCIENCE_CITY_NAMES);
    expect(prerequisites.evaluateBuildingUnlock).toBe(prerequisitesHelpers.evaluateBuildingUnlock);
    expect(prerequisites.evaluateProductionUnlock).toBe(prerequisitesHelpers.evaluateProductionUnlock);
    expect(prerequisites.setHasEquivalentBuilding).toBe(prerequisitesHelpers.setHasEquivalentBuilding);
  });
});

describe('PKG-A · 2. 科技别名与同义词双向映射（TECH_EQUIVALENT_GROUPS）', () => {
  it('研发「化学火箭推进学」可解锁要求旧名「火箭推进基础工学」的条目，且不会越级伪解锁「月面电磁投射工学」', () => {
    const ctx = makeContext({
      techDone: new Set(['化学火箭推进学', '可复用运载火箭工学', '天基侦察与遥感学']),
    });
    const effective = buildEffectiveTechAndProtocolSet(ctx);
    expect(effective.has('火箭推进基础工学')).toBe(true);
    expect(effective.has('可回收火箭工学')).toBe(true);
    expect(effective.has('轨道侦察工学')).toBe(true);
    expect(effective.has('月面电磁投射工学')).toBe(false);
    expect(effective.has('月面原位资源利用工学')).toBe(false);

    const evalRes = evaluatePrerequisite(
      combineLegacyPrerequisites(
        {
          prereqs: ['火箭推进基础工学', '可回收火箭工学', '轨道侦察工学'],
        },
        'completed',
      ),
      ctx,
    );
    expect(evalRes.satisfied).toBe(true);
    expect(evalRes.unmet).toEqual([]);
  });

  it('研发「月面电磁投射工学」双向互通「月面原位资源利用工学」并兼容展开挂靠的航天旧别名', () => {
    const completed = buildCompletedTechAndProtocolSet(['月面电磁投射工学']);
    expect(completed.has('月面原位资源利用工学')).toBe(true);
    expect(completed.has('火箭推进基础工学')).toBe(true);
    expect(completed.has('化学火箭推进学')).toBe(true);
    expect(completed.has('可回收火箭工学')).toBe(true);
    expect(completed.has('轨道侦察工学')).toBe(true);
  });

  it('覆盖工业/盟军/苏联全部 17 组世界书科技同义词与点分 ID 双向互通', () => {
    expect(TECH_EQUIVALENT_GROUPS.length).toBeGreaterThanOrEqual(17);

    const pairs: Array<[string, string]> = [
      ['重型全复用运载工学', '地月转移轨道工学'],
      ['空间核动力工学', '空间太阳能发电工学'],
      ['在轨组装与发射工学', '在轨组装工学'],
      ['特种原油催化裂解学', '灵沁油处理学'],
      ['ind.research.t1.heavy_oil_processing', '特种重油处理学'],
      ['特种高能原油加氢精制学', '灵沁油完全精炼工学'],
      ['战术气象干预工学', '战术气象武器工学'],
      ['电子对抗工学', '全频谱电子对抗工学'],
      ['无人地面平台学', '无人地面平台工学'],
      ['通用导弹制导与再入理论', '精确制导武器学'],
      ['重装甲突击学', '复合装甲材料学'],
      ['高超声速打击工学', '高超声速滑翔武器理论'],
      ['空天飞行器工学', '空天往返载具工程学'],
      ['轨道常规战略载荷工学', 'sov.unit.orbital.red_star_hammer_conventional_payload'],
    ];

    for (const [doneTech, requiredTech] of pairs) {
      const ctx = makeContext({ techDone: new Set([doneTech]) });
      expect(evaluatePrerequisite({ kind: 'research', name: requiredTech }, ctx).satisfied).toBe(true);

      const reverseCtx = makeContext({ techDone: new Set([requiredTech]) });
      expect(evaluatePrerequisite({ kind: 'research', name: doneTech }, reverseCtx).satisfied).toBe(true);
    }
  });

  it('支持通过 context.catalog.researches 动态双向展开 id、name 与 aliases', () => {
    const ctx = makeContext({
      techDone: new Set(['custom.tech.alpha']),
      catalog: {
        researches: [
          {
            id: 'custom.tech.alpha',
            name: '自定义阿尔法工学',
            aliases: ['旧版阿尔法理论'],
          },
        ],
      },
    });
    expect(evaluatePrerequisite({ kind: 'research', name: '自定义阿尔法工学' }, ctx).satisfied).toBe(true);
    expect(evaluatePrerequisite({ kind: 'research', name: '旧版阿尔法理论' }, ctx).satisfied).toBe(true);
  });
});

describe('PKG-A · 3. 建筑别名等价扩展（BUILDING_EQUIVALENTS）', () => {
  it('建造厂核心、区域防空与预警雷达站、战术科研实验室及 5 组世界书建筑别名双向满足前置校验', () => {
    expect(ROOT_CONYARD_BUILDINGS.has('建造厂核心')).toBe(true);
    expect(BUILDING_EQUIVALENTS['建造厂']).toContain('建造厂核心');
    expect(setHasEquivalentBuilding(new Set(['建造厂核心']), '建造厂')).toBe(true);
    expect(setHasEquivalentBuilding(new Set(['盟军建造厂']), '建造厂核心')).toBe(true);

    // 雷达站扩展
    expect(setHasEquivalentBuilding(new Set(['区域防空与预警雷达站']), '雷达站')).toBe(true);
    expect(setHasEquivalentBuilding(new Set(['战略预警雷达站']), '雷达站')).toBe(true);
    expect(setHasEquivalentBuilding(new Set(['雷达站']), '区域防空与预警雷达站')).toBe(true);

    // 实验室扩展
    expect(setHasEquivalentBuilding(new Set(['战术科研实验室']), '作战实验室')).toBe(true);
    expect(setHasEquivalentBuilding(new Set(['盟军作战实验室']), '战斗实验室')).toBe(true);
    expect(setHasEquivalentBuilding(new Set(['国家战略工程综合体／红星科学城']), '作战实验室')).toBe(true);

    // 5 组世界书建筑新旧别名双向互通
    const aliasPairs: Array<[string, string]> = [
      ['核弹发射井', '核导弹工程与地下发射群'],
      ['战区超导脉冲储能场', '战区超导脉冲电网中枢'],
      ['月壤原位能源开采设施', '月面采矿加工站'],
      ['月面基地基础设施', '月面有人前哨站'],
      ['深井泵站', '深井泵站与水文净化设施'],
    ];
    for (const [a, b] of aliasPairs) {
      expect(setHasEquivalentBuilding(new Set([a]), b)).toBe(true);
      expect(setHasEquivalentBuilding(new Set([b]), a)).toBe(true);
    }

    const unlockRes = evaluateBuildingUnlock(
      {
        name: '测试高级雷达设施',
        need_building: '雷达站',
      },
      {
        selectedBaseBuildings: new Set(['建造厂核心', '区域防空与预警雷达站']),
      },
    );
    expect(unlockRes.unlocked).toBe(true);
    expect(unlockRes.missingBuildings).toEqual([]);
  });
});

describe('PKG-A · 4. buildUnitPresent 状态/数量剥离与 UNIT_EQUIVALENT_GROUPS 同义词映射', () => {
  it('剥离 "F-16C战隼(正常) ×2"、"犀牛坦克（受损） x3"、"美国大兵（量产体）" 并满足 F-16C战隼 / F-16C战隼多用途战斗机', () => {
    expect(UNIT_EQUIVALENT_GROUPS).toHaveLength(49);

    const units = buildUnitPresent({
      troops: { '美国大兵（量产体）': 4 },
      vehicles: ['F-16C战隼(正常) ×2', '犀牛坦克（受损） x3'],
    });

    expect(units.get('F-16C战隼(正常) ×2')).toBe(2);
    expect(units.get('F-16C战隼')).toBe(2);
    expect(units.get('F-16C战隼多用途战斗机')).toBe(2);
    expect(units.get('ally.unit.air.f16c_fighting_falcon')).toBe(2);
    expect(units.get('犀牛坦克（受损） x3')).toBe(3);
    expect(units.get('犀牛坦克')).toBe(3);
    expect(units.get('美国大兵（量产体）')).toBe(4);
    expect(units.get('美国大兵')).toBe(4);

    const ctx = makeContext({ unitPresent: units });
    expect(
      evaluatePrerequisite({ kind: 'unit_present', name: 'F-16C战隼', min: 2, scope: 'global' }, ctx).satisfied,
    ).toBe(true);
    expect(
      evaluatePrerequisite({ kind: 'unit_present', name: 'F-16C战隼多用途战斗机', min: 2, scope: 'global' }, ctx)
        .satisfied,
    ).toBe(true);
    expect(
      evaluatePrerequisite(
        { kind: 'unit_present', name: 'ally.unit.air.f16c_fighting_falcon', min: 2, scope: 'global' },
        ctx,
      ).satisfied,
    ).toBe(true);
    expect(
      evaluatePrerequisite({ kind: 'unit_present', name: '犀牛坦克', min: 3, scope: 'global' }, ctx).satisfied,
    ).toBe(true);
  });

  it('支持多基地 bases[].forces（含 infantry / aircraft）汇总与近海战斗舰 / 天锤轨道载荷等价匹配', () => {
    const units = buildUnitPresent(
      {
        troops: {},
        infantry: { '动员兵(完好)': 5 },
        vehicles: ['LCS-1自由级近海战斗舰(正常) ×1'],
        aircraft: ['赤星天锤常规战略载荷(待命) * 1'],
      },
      [
        {
          forces: {
            vehicles: ['20380型轻型护卫舰（待修） ×1'],
          },
        },
      ],
    );

    expect(units.get('动员兵')).toBe(5);
    expect(units.get('LCS-1自由级近海战斗舰')).toBe(1);
    expect(units.get('20380型轻型护卫舰')).toBe(1);
    expect(units.get('轻型近海战斗舰')).toBe(2);
    expect(units.get('sov.unit.orbital.red_star_hammer_conventional_payload')).toBe(1);
    expect(
      evaluatePrerequisite(
        { kind: 'unit_present', name: 'LCS-1自由级近海战斗舰', min: 2, scope: 'global' },
        makeContext({ unitPresent: units }),
      ).satisfied,
    ).toBe(true);

    const runtimeCtx = buildCatalogPrerequisiteContext({
      bases: [
        {
          id: 'b1',
          name: '一号基地',
          buildings: [{ name: '建造厂核心', state: '运转' }],
          forces: { vehicles: ['哨兵级近海巡逻护卫舰(战损) ×1'] },
        },
      ],
      selectedBaseId: 'b1',
      techDone: ['化学火箭推进学'],
      forces: {
        troops: {},
        vehicles: ['F-16C战隼(正常) ×2'],
      },
    })!;

    expect(
      evaluatePrerequisite({ kind: 'research', name: '火箭推进基础工学' }, runtimeCtx).satisfied,
    ).toBe(true);
    expect(
      evaluatePrerequisite({ kind: 'unit_present', name: 'F-16C战隼多用途战斗机', min: 2, scope: 'global' }, runtimeCtx)
        .satisfied,
    ).toBe(true);
    expect(
      evaluatePrerequisite({ kind: 'unit_present', name: '轻型近海战斗舰', min: 1, scope: 'global' }, runtimeCtx)
        .satisfied,
    ).toBe(true);
  });
});
