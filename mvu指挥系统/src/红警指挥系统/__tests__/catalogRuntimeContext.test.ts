import { describe, expect, it } from 'vitest';

import {
  deriveBuildableWithContext,
  deriveProducibleWithContext,
  deriveResearchableWithContext,
  type BuildingDef,
  type ProductionDef,
  type ResearchDef,
} from '../core/catalog';
import {
  buildCatalogPrerequisiteContext,
  buildUnitPresent,
  isQueueVisibleForBase,
  queueItemsForAction,
  resolveBaseReference,
  type RuntimeBaseLike,
} from '../core/catalogRuntimeContext';
import { evaluatePrerequisite } from '../core/prerequisites';

const bases: RuntimeBaseLike[] = [
  {
    id: 'alpha-id',
    name: '北坡基地',
    buildings: [
      { name: '施工楼', state: '建造中' },
      { name: '停机楼', state: '停机' },
      { name: '运转楼', state: '运转' },
    ],
  },
  { id: 'beta-id', name: '南港基地', buildings: [{ name: '异地工厂', state: '运转' }] },
];

describe('S1-B catalog 运行时上下文', () => {
  it('Base.id 优先，旧基地名称仅在唯一时兼容；重名和缺失 fail-closed', () => {
    expect(resolveBaseReference(bases, 'alpha-id')).toEqual({ status: 'resolved', baseId: 'alpha-id' });
    expect(resolveBaseReference(bases, '北坡基地')).toEqual({ status: 'resolved', baseId: 'alpha-id' });
    expect(resolveBaseReference([...bases, { id: 'gamma-id', name: '北坡基地', buildings: [] }], '北坡基地')).toEqual({
      status: 'ambiguous',
      reference: '北坡基地',
    });
    expect(resolveBaseReference(bases, '')).toEqual({ status: 'missing', reference: '' });
  });

  it('构造逐基地 existing/completed/running，并严格区分 current/global', () => {
    const context = buildCatalogPrerequisiteContext({
      bases,
      selectedBaseId: 'alpha-id',
      techDone: ['完成研究'],
      forces: { troops: {}, vehicles: [] },
    });
    expect(context).not.toBeNull();
    expect(
      evaluatePrerequisite({ kind: 'building', name: '施工楼', scope: 'current', state: 'existing' }, context!)
        .satisfied,
    ).toBe(true);
    expect(
      evaluatePrerequisite({ kind: 'building', name: '施工楼', scope: 'current', state: 'completed' }, context!)
        .satisfied,
    ).toBe(false);
    expect(
      evaluatePrerequisite({ kind: 'building', name: '停机楼', scope: 'current', state: 'completed' }, context!)
        .satisfied,
    ).toBe(true);
    expect(
      evaluatePrerequisite({ kind: 'building', name: '停机楼', scope: 'current', state: 'running' }, context!)
        .satisfied,
    ).toBe(false);
    expect(
      evaluatePrerequisite({ kind: 'building', name: '异地工厂', scope: 'current', state: 'running' }, context!)
        .satisfied,
    ).toBe(false);
    expect(
      evaluatePrerequisite({ kind: 'building', name: '异地工厂', scope: 'global', state: 'running' }, context!)
        .satisfied,
    ).toBe(true);
  });

  it('旧 need_buildings 在研究/建造/生产三类均只认当前基地，显式 global 才可跨基地', () => {
    const context = buildCatalogPrerequisiteContext({
      bases,
      selectedBaseId: 'alpha-id',
      techDone: [],
      forces: { troops: {}, vehicles: [] },
    })!;
    const research: ResearchDef = {
      name: '异地研究',
      cost: 1,
      eta: '1日',
      line: '测试',
      tier: 1,
      unlocks: '无',
      prereq: '异地工厂',
      prereqs: [],
      need_buildings: ['异地工厂'],
      desc: '测试',
    };
    const building: BuildingDef = {
      name: '异地建筑',
      cost: 1,
      power: 0,
      research: null,
      prereqs: [],
      need_buildings: ['异地工厂'],
      desc: '测试',
    };
    const production: ProductionDef = {
      name: '异地生产',
      cost: 1,
      need_building: '异地工厂',
      need_buildings: ['异地工厂'],
      desc: '测试',
    };
    expect(deriveResearchableWithContext([research], context, [])).toEqual([]);
    expect(deriveBuildableWithContext([building], context, [])).toEqual([]);
    expect(deriveProducibleWithContext([production], context)).toEqual([]);

    const explicitGlobal: ResearchDef = {
      ...research,
      name: '显式全局研究',
      need_buildings: [],
      requirements: { kind: 'building', name: '异地工厂', scope: 'global', state: 'completed' },
    };
    expect(deriveResearchableWithContext([explicitGlobal], context, [])).toEqual([explicitGlobal]);
  });

  it('unitPresent 只统计正数 troops 与 vehicles；不接受机娘或首产推断源', () => {
    const units = buildUnitPresent({
      troops: { 工程兵: 2, 宪兵: 0, 炮兵: -1, 通信兵: Number.NaN },
      vehicles: ['F-16C战隼', 'F-16C战隼', ' 机动雷达车 ', ''],
    });
    expect(Object.fromEntries(units)).toEqual({ 工程兵: 2, 'F-16C战隼': 2, 机动雷达车: 1 });
  });

  it('研究全局去重，建造/生产按当前基地 ID 去重并兼容唯一旧名称', () => {
    const queues = [
      { type: '研究', item: '研究A', base: 'beta-id' },
      { type: '研究', item: '研究B', base: '' },
      { type: '建造', item: '工厂A', base: 'alpha-id' },
      { type: '建造', item: '工厂B', base: '南港基地' },
      { type: '生产', item: '载具A', base: '北坡基地' },
      { type: '生产', item: '载具B', base: 'beta-id' },
    ];
    expect(queueItemsForAction(queues, '研究', 'alpha-id', bases)).toEqual(['研究A', '研究B']);
    expect(queueItemsForAction(queues, '建造', 'alpha-id', bases)).toEqual(['工厂A']);
    expect(queueItemsForAction(queues, '建造', 'beta-id', bases)).toEqual(['工厂B']);
    expect(queueItemsForAction(queues, '生产', 'alpha-id', bases)).toEqual(['载具A']);
  });

  it('单基地旧物理队列缺 base 时仍按当前基地去重，多基地则不猜测', () => {
    const singleBase = [bases[0]];
    const legacyQueues = [{ type: '生产', item: '旧制载具', base: '' }];
    expect(queueItemsForAction(legacyQueues, '生产', 'alpha-id', singleBase)).toEqual(['旧制载具']);
    expect(queueItemsForAction(legacyQueues, '生产', 'alpha-id', bases)).toEqual([]);
  });

  it('队列显示：研究全局可见，物理队列按 ID/唯一旧名称，空 base 仅单基地兼容', () => {
    expect(isQueueVisibleForBase({ type: '研究', item: '研究A', base: 'beta-id' }, 'alpha-id', bases)).toBe(true);
    expect(isQueueVisibleForBase({ type: '生产', item: '载具A', base: '北坡基地' }, 'alpha-id', bases)).toBe(true);
    expect(isQueueVisibleForBase({ type: '生产', item: '载具B', base: 'beta-id' }, 'alpha-id', bases)).toBe(false);
    expect(isQueueVisibleForBase({ type: '生产', item: '旧载具', base: '' }, 'alpha-id', [bases[0]])).toBe(true);
    expect(isQueueVisibleForBase({ type: '生产', item: '旧载具', base: '' }, 'alpha-id', bases)).toBe(false);
  });

  it('无当前基地、重复 Base.id 或歧义名称时不构造上下文', () => {
    expect(
      buildCatalogPrerequisiteContext({
        bases,
        selectedBaseId: '不存在',
        techDone: [],
        forces: { troops: {}, vehicles: [] },
      }),
    ).toBeNull();
    expect(
      buildCatalogPrerequisiteContext({
        bases: [...bases, { id: 'alpha-id', name: '重复ID', buildings: [] }],
        selectedBaseId: 'alpha-id',
        techDone: [],
        forces: { troops: {}, vehicles: [] },
      }),
    ).toBeNull();
  });
});
