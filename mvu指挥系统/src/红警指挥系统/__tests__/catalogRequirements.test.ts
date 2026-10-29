import { describe, expect, it } from 'vitest';

import {
  BUILDINGS,
  PRODUCTIONS,
  RESEARCHES,
  deriveBuildable,
  deriveBuildableWithContext,
  deriveProducible,
  deriveProducibleWithContext,
  deriveResearchable,
  deriveResearchableWithContext,
  type BuildingDef,
  type ProductionDef,
  type ResearchDef,
} from '../core/catalog';
import {
  PREREQUISITE_ATOM_KINDS,
  buildEffectiveTechAndProtocolSet,
  combineLegacyPrerequisites,
  evaluatePrerequisite,
  validatePrerequisiteCondition,
  type PrerequisiteBaseState,
  type PrerequisiteCondition,
  type PrerequisiteContext,
} from '../core/prerequisites';
import { checkOverlayData, checkVariables } from '../parse/systemCheck';
import type { DlcOverlay } from '../composables/useCatalog';

const base = (existing: string[] = [], completed = existing, running = completed): PrerequisiteBaseState => ({
  existing: new Set(existing),
  completed: new Set(completed),
  running: new Set(running),
});

const context = (overrides: Partial<PrerequisiteContext> = {}): PrerequisiteContext => ({
  techDone: new Set(),
  selectedBaseId: 'alpha',
  bases: new Map([
    ['alpha', base()],
    ['beta', base()],
  ]),
  unitPresent: new Map(),
  ...overrides,
});

const research = (requirements?: PrerequisiteCondition): ResearchDef => ({
  name: '测试研究',
  cost: 1,
  eta: '1日',
  line: '测试',
  tier: 1,
  unlocks: '测试产物',
  prereq: '展示字段不参与求值',
  prereqs: [],
  requirements,
  desc: '测试',
});

describe('S1-A catalog 纯条件内核', () => {
  it('支持嵌套 all/any，并保留结构化未满足原因', () => {
    const requirement: PrerequisiteCondition = {
      op: 'all',
      conditions: [
        { kind: 'research', name: '基础研究' },
        {
          op: 'any',
          conditions: [
            { kind: 'building', name: '空军指挥部', scope: 'current', state: 'completed' },
            { kind: 'building', name: '海军造船厂', scope: 'current', state: 'completed' },
          ],
        },
      ],
    };
    const missing = evaluatePrerequisite(requirement, context());
    expect(missing.satisfied).toBe(false);
    expect(missing.diagnostics).toEqual([]);
    expect(missing.unmet.map(item => item.message)).toContain('缺少研究：基础研究');
    expect(missing.unmet.map(item => item.message)).toContain('任选条件均未满足');

    const satisfied = evaluatePrerequisite(
      requirement,
      context({
        techDone: new Set(['基础研究']),
        bases: new Map([
          ['alpha', base(['海军造船厂'])],
          ['beta', base()],
        ]),
      }),
    );
    expect(satisfied).toEqual({ satisfied: true, unmet: [], diagnostics: [] });
  });

  it('区分 current/global 与建筑 existing/completed/running 三态', () => {
    const ctx = context({
      bases: new Map([
        ['alpha', base(['施工楼', '停机楼', '运转楼'], ['停机楼', '运转楼'], ['运转楼'])],
        ['beta', base(['异地工厂'])],
      ]),
    });
    expect(
      evaluatePrerequisite({ kind: 'building', name: '施工楼', scope: 'current', state: 'existing' }, ctx).satisfied,
    ).toBe(true);
    expect(
      evaluatePrerequisite({ kind: 'building', name: '施工楼', scope: 'current', state: 'completed' }, ctx).satisfied,
    ).toBe(false);
    expect(
      evaluatePrerequisite({ kind: 'building', name: '停机楼', scope: 'current', state: 'completed' }, ctx).satisfied,
    ).toBe(true);
    expect(
      evaluatePrerequisite({ kind: 'building', name: '停机楼', scope: 'current', state: 'running' }, ctx).satisfied,
    ).toBe(false);
    expect(
      evaluatePrerequisite({ kind: 'building', name: '异地工厂', scope: 'current', state: 'existing' }, ctx).satisfied,
    ).toBe(false);
    expect(
      evaluatePrerequisite({ kind: 'building', name: '异地工厂', scope: 'global', state: 'existing' }, ctx).satisfied,
    ).toBe(true);
  });

  it('单位条件按当前持有数量求值，不推断历史首产', () => {
    const ctx = context({ unitPresent: new Map([['F-16C战隼', 2]]) });
    expect(
      evaluatePrerequisite({ kind: 'unit_present', name: 'F-16C战隼', min: 2, scope: 'global' }, ctx).satisfied,
    ).toBe(true);
    const missing = evaluatePrerequisite({ kind: 'unit_present', name: 'F-16C战隼', min: 3, scope: 'global' }, ctx);
    expect(missing.satisfied).toBe(false);
    expect(missing.unmet[0].message).toContain('需要 3，当前 2');
  });

  it('all 空组为 true；空 any、未知原子、空名称、非法数量与过深嵌套均 fail-closed', () => {
    expect(evaluatePrerequisite({ op: 'all', conditions: [] }, context()).satisfied).toBe(true);
    const invalidCases: unknown[] = [
      { op: 'any', conditions: [] },
      { kind: 'mystery', name: 'X' },
      { kind: 'research', name: '' },
      { kind: 'research', name: ' 带空白的研究 ' },
      { kind: 'unit_present', name: 'X', min: 0, scope: 'global' },
    ];
    for (const value of invalidCases) {
      const result = evaluatePrerequisite(value, context());
      expect(result.satisfied).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
    let atLimit: unknown = { kind: 'research', name: '底层' };
    for (let index = 0; index < 8; index++) atLimit = { op: 'all', conditions: [atLimit] };
    expect(evaluatePrerequisite(atLimit, context()).diagnostics).toEqual([]);
    let tooDeep: unknown = { kind: 'research', name: '底层' };
    for (let index = 0; index < 9; index++) tooDeep = { op: 'all', conditions: [tooDeep] };
    const tooDeepResult = evaluatePrerequisite(tooDeep, context());
    expect(tooDeepResult.satisfied).toBe(false);
    expect(tooDeepResult.diagnostics.some(item => item.code === 'max_depth')).toBe(true);
  });

  it('旧机器字段与新 requirements 始终按 AND 合并，展示字段不参与求值', () => {
    const item = research({
      op: 'any',
      conditions: [
        { kind: 'building', name: '空军指挥部', scope: 'current', state: 'completed' },
        { kind: 'building', name: '海军造船厂', scope: 'current', state: 'completed' },
      ],
    });
    item.prereqs = ['旧前置研究'];
    const combined = combineLegacyPrerequisites(item, 'completed');
    const onlyNew = context({ bases: new Map([['alpha', base(['空军指挥部'])]]) });
    expect(evaluatePrerequisite(combined, onlyNew).satisfied).toBe(false);
    const both = context({
      techDone: new Set(['旧前置研究']),
      bases: new Map([['alpha', base(['海军造船厂'])]]),
    });
    expect(evaluatePrerequisite(combined, both).satisfied).toBe(true);
  });

  it('三个 derive 在未使用新字段时与写前 legacy 算法全量同构', () => {
    const matrices = [
      { done: [] as string[], queued: [] as string[], buildings: [] as string[], units: [] as string[] },
      { done: ['基础步兵训练学'], queued: ['装甲载具工学'], buildings: ['发电厂', '兵营'], units: [] },
      {
        done: ['固定翼空运航空学', '战略轰炸航空学'],
        queued: [],
        buildings: ['空军指挥部'],
        units: ['F-16C战隼', 'C-130J超级大力神'],
      },
    ];
    for (const matrix of matrices) {
      const expectedResearch = RESEARCHES.filter(
        item =>
          item.requirements === undefined &&
          !matrix.done.includes(item.name) &&
          !matrix.queued.includes(item.name) &&
          item.prereqs.every(name => matrix.done.includes(name)) &&
          (item.need_buildings ?? []).every(name => matrix.buildings.includes(name)) &&
          (item.need_units ?? []).every(name => matrix.units.includes(name)),
      ).map(item => item.name);
      expect(
        deriveResearchable(RESEARCHES, matrix.done, matrix.queued, matrix.buildings, matrix.units).map(
          item => item.name,
        ),
      ).toEqual(expectedResearch);

      const expectedBuild = BUILDINGS.filter(
        item =>
          item.requirements === undefined &&
          item.prereqs.every(name => matrix.done.includes(name)) &&
          item.need_buildings.every(name => matrix.buildings.includes(name)) &&
          !matrix.queued.includes(item.name),
      ).map(item => item.name);
      expect(deriveBuildable(BUILDINGS, matrix.done, matrix.buildings, matrix.queued).map(item => item.name)).toEqual(
        expectedBuild,
      );

      const expectedProduction = PRODUCTIONS.filter(
        item => item.requirements === undefined && item.need_buildings.every(name => matrix.buildings.includes(name)),
      ).map(item => item.name);
      expect(deriveProducible(PRODUCTIONS, matrix.buildings).map(item => item.name)).toEqual(expectedProduction);
    }
  });

  it('ProductionDef 可选研究前置由同一内核执行，同时不破坏旧调用', () => {
    const product: ProductionDef = {
      name: '测试载具',
      cost: 10,
      need_building: '战车工厂',
      need_buildings: ['战车工厂'],
      prereqs: ['测试制造学'],
      desc: '测试',
    };
    expect(deriveProducible([product], ['战车工厂'])).toEqual([]);
    expect(deriveProducible([product], ['战车工厂'], ['测试制造学'])).toEqual([product]);
  });

  it('context-aware 三类 derive 忠实区分 scope/state，并执行旧字段 AND 新字段', () => {
    const ctx = context({
      techDone: new Set(['旧前置研究']),
      bases: new Map([
        ['alpha', base(['施工楼', '停机楼', '运转楼'], ['停机楼', '运转楼'], ['运转楼'])],
        ['beta', base(['异地工厂'])],
      ]),
    });
    const researchItem = {
      ...research({ kind: 'building', name: '运转楼', scope: 'current', state: 'running' }),
      prereqs: ['旧前置研究'],
      need_buildings: ['停机楼'],
    };
    expect(deriveResearchableWithContext([researchItem], ctx, [])).toEqual([researchItem]);
    expect(
      deriveResearchableWithContext(
        [{ ...researchItem, requirements: { kind: 'building', name: '停机楼', scope: 'current', state: 'running' } }],
        ctx,
        [],
      ),
    ).toEqual([]);

    const buildingItem: BuildingDef = {
      name: '测试建筑',
      cost: 1,
      power: 0,
      research: '旧前置研究',
      prereqs: ['旧前置研究'],
      need_buildings: ['施工楼'],
      requirements: { kind: 'building', name: '异地工厂', scope: 'global', state: 'existing' },
      desc: '测试',
    };
    expect(deriveBuildableWithContext([buildingItem], ctx, [])).toEqual([buildingItem]);
    expect(
      deriveBuildableWithContext(
        [{ ...buildingItem, requirements: { kind: 'building', name: '施工楼', scope: 'current', state: 'completed' } }],
        ctx,
        [],
      ),
    ).toEqual([]);

    const product: ProductionDef = {
      name: '测试生产',
      cost: 1,
      need_building: '运转楼',
      need_buildings: ['运转楼'],
      prereqs: ['旧前置研究'],
      requirements: { kind: 'building', name: '异地工厂', scope: 'global', state: 'existing' },
      desc: '测试',
    };
    expect(deriveProducibleWithContext([product], ctx)).toEqual([product]);
    expect(
      deriveProducibleWithContext(
        [{ ...product, requirements: { kind: 'building', name: '停机楼', scope: 'current', state: 'running' } }],
        ctx,
      ),
    ).toEqual([]);
  });

  it('legacy derive 遇到显式 requirements 时 fail-closed，不用单一集合伪装建筑三态', () => {
    const structuredResearch = research({ kind: 'building', name: '施工楼', scope: 'current', state: 'completed' });
    const structuredBuilding: BuildingDef = {
      name: '结构化建筑',
      cost: 1,
      power: 0,
      research: null,
      prereqs: [],
      need_buildings: [],
      requirements: { kind: 'building', name: '施工楼', scope: 'current', state: 'completed' },
      desc: '测试',
    };
    const structuredProduction: ProductionDef = {
      name: '结构化生产',
      cost: 1,
      need_building: '施工楼',
      need_buildings: [],
      requirements: { kind: 'building', name: '施工楼', scope: 'current', state: 'existing' },
      desc: '测试',
    };
    expect(deriveResearchable([structuredResearch], [], [], ['施工楼'])).toEqual([]);
    expect(deriveBuildable([structuredBuilding], [], ['施工楼'], [])).toEqual([]);
    expect(deriveProducible([structuredProduction], ['施工楼'])).toEqual([]);
  });

  it('三类 context-aware derive 对非法 requirements 与畸形旧字段均 fail-closed 且不抛异常', () => {
    const ctx = context();
    const badResearch = { ...research(), prereqs: '不是数组' } as unknown as ResearchDef;
    const badBuilding = {
      name: '坏建筑',
      cost: 1,
      power: 0,
      research: null,
      prereqs: [],
      need_buildings: null,
      desc: '测试',
    } as unknown as BuildingDef;
    const badProduction = {
      name: '坏生产',
      cost: 1,
      need_building: '兵营',
      need_buildings: [],
      requirements: { op: 'any', conditions: [] },
      desc: '测试',
    } as unknown as ProductionDef;
    expect(() => deriveResearchableWithContext([badResearch], ctx, [])).not.toThrow();
    expect(() => deriveBuildableWithContext([badBuilding], ctx, [])).not.toThrow();
    expect(() => deriveProducibleWithContext([badProduction], ctx)).not.toThrow();
    expect(deriveResearchableWithContext([badResearch], ctx, [])).toEqual([]);
    expect(deriveBuildableWithContext([badBuilding], ctx, [])).toEqual([]);
    expect(deriveProducibleWithContext([badProduction], ctx)).toEqual([]);
  });

  it('overlay 的非法显式 requirements 被 R3 拒绝，不静默放行', () => {
    const overlay = {
      id: 'bad-requirements',
      researches: [
        {
          ...research(),
          requirements: { op: 'any', conditions: [] },
        },
      ],
      buildings: [
        {
          name: '坏建筑',
          cost: 1,
          power: 0,
          research: null,
          prereqs: [],
          need_buildings: [],
          requirements: { kind: 'unknown', name: 'X' },
          desc: '测试',
        },
      ],
      productions: [
        {
          name: '坏生产',
          cost: 1,
          need_building: '兵营',
          need_buildings: ['兵营'],
          requirements: { kind: 'unit_present', name: 'X', min: 0, scope: 'global' },
          desc: '测试',
        },
      ],
    } as unknown as DlcOverlay;
    const issues = checkOverlayData(overlay, new Set());
    const errors = issues.filter(
      issue => issue.rule === 'R3' && issue.level === 'error' && issue.message.includes('requirements 非法'),
    );
    expect(errors).toHaveLength(3);
    expect(errors.map(issue => issue.target)).toEqual(['测试研究', '坏建筑', '坏生产']);
  });

  it('overlay 的畸形 legacy 数组被 R3 诊断，不在 normalizer 中抛异常', () => {
    const overlay = {
      id: 'bad-legacy',
      researches: [{ ...research(), prereqs: '不是数组' }],
      buildings: [
        {
          name: '坏建筑旧字段',
          cost: 1,
          power: 0,
          research: null,
          prereqs: [],
          need_buildings: null,
          desc: '测试',
        },
      ],
      productions: [
        {
          name: '坏生产旧字段',
          cost: 1,
          need_building: '兵营',
          need_buildings: [' 兵营 '],
          desc: '测试',
        },
      ],
    } as unknown as DlcOverlay;
    const errors = checkOverlayData(overlay, new Set()).filter(
      issue => issue.rule === 'R3' && issue.level === 'error' && issue.message.includes('旧前置字段非法'),
    );
    expect(errors.map(issue => issue.target)).toEqual(['测试研究', '坏建筑旧字段', '坏生产旧字段']);
  });

  it('overlay 的非数组集合、非对象条目和非法主键只返回 R3，不抛异常', () => {
    expect(checkOverlayData(null, new Set())).toEqual([
      { rule: 'R3', level: 'error', target: '(overlay)', message: 'overlay 数据必须是对象' },
    ]);
    const malformedCollections = {
      id: 'bad-collections',
      researches: {},
      buildings: null,
      productions: '不是数组',
    };
    expect(() => checkOverlayData(malformedCollections, new Set())).not.toThrow();
    expect(
      checkOverlayData(malformedCollections, new Set())
        .filter(issue => issue.rule === 'R3' && issue.level === 'error')
        .map(issue => issue.message),
    ).toEqual(['研究集合必须是数组', '建筑集合必须是数组', '生产集合必须是数组']);

    const malformedItems = {
      id: 'bad-items',
      researches: [null, [], 1, { ...research(), name: ' 研究空白 ' }],
      buildings: [null, { name: '   ' }],
      productions: [['数组不是条目'], { name: 42 }],
    };
    expect(() => checkOverlayData(malformedItems, new Set())).not.toThrow();
    const errors = checkOverlayData(malformedItems, new Set()).filter(
      issue => issue.rule === 'R3' && issue.level === 'error',
    );
    expect(errors.map(issue => issue.message)).toEqual([
      '研究[0] 必须是对象',
      '研究[1] 必须是对象',
      '研究[2] 必须是对象',
      '建筑[0] 必须是对象',
      '生产[0] 必须是对象',
      '研究 name 不能含首尾空白： 研究空白 ',
      '建筑缺少有效 name',
      '生产缺少有效 name',
    ]);

    const malformedInstalled = [
      null,
      malformedCollections,
      malformedItems,
      { id: 'dup-a', researches: [{ ...research(), name: '合法重名' }] },
      { id: 'dup-b', researches: [{ ...research(), name: '合法重名' }] },
    ] as unknown as DlcOverlay[];
    expect(() =>
      checkVariables({
        codex: [],
        techDone: [],
        overlays: malformedInstalled,
        baseResearches: [],
        mergedResearchNames: [],
      }),
    ).not.toThrow();
    expect(
      checkVariables({
        codex: [],
        techDone: [],
        overlays: malformedInstalled,
        baseResearches: [],
        mergedResearchNames: [],
      }).some(issue => issue.rule === 'R12' && issue.target === '合法重名'),
    ).toBe(true);
  });

  // ── PRT-VIS-01：判定集并集 techDone ∪ activeProtocols、[协议] 前缀与三原子白名单（任务包 §3.3.2 / §6 PRT-VIS-01） ──
  it('原子白名单零新增断言：仅接受 research | building | unit_present 三原子，传入 kind: "protocol" 报错拒绝', () => {
    expect(PREREQUISITE_ATOM_KINDS).toEqual(['research', 'building', 'unit_present']);
    expect((PREREQUISITE_ATOM_KINDS as readonly string[]).includes('protocol')).toBe(false);

    const diag = validatePrerequisiteCondition({
      kind: 'protocol',
      name: '战斗工兵—预制战斗碉堡协议',
    });
    expect(diag).toEqual([
      {
        path: 'requirements.kind',
        code: 'invalid_atom',
        message: '未知条件原子：protocol',
      },
    ]);

    const evaluation = evaluatePrerequisite(
      { kind: 'protocol', id: 'sov.research.t2.superconducting_grid_protocol' },
      context(),
    );
    expect(evaluation).toEqual({
      satisfied: false,
      unmet: [],
      diagnostics: [
        {
          path: 'requirements.kind',
          code: 'invalid_atom',
          message: '未知条件原子：protocol',
        },
      ],
    });
  });

  it('判定集并集与 [协议] 前缀：requirements 中 { kind: "research", id/name } 在对应协议 active 时满足，未 active 时 unmet 含 [协议] 前缀，普通科技文案保持原样', () => {
    // 1. 协议未激活时：{ kind: 'research', id: 'sov.research.t2.superconducting_grid_protocol' } 未满足，unmet 带 [协议] 前缀
    const unmetById = evaluatePrerequisite(
      { kind: 'research', id: 'sov.research.t2.superconducting_grid_protocol' },
      context({
        state: {
          protocols: [{ ref: 'sov.research.t2.superconducting_grid_protocol', status: 'experimenting' }],
        },
      }),
    );
    expect(unmetById.satisfied).toBe(false);
    expect(unmetById.diagnostics).toEqual([]);
    expect(unmetById.unmet).toHaveLength(1);
    expect(unmetById.unmet[0].message).toMatch(/^\[协议\]/);
    expect(unmetById.unmet[0].message).toContain('高压超导电网协议');

    // 2. 协议未激活时：{ kind: 'research', name: '战斗工兵—预制战斗碉堡协议' } 未满足，unmet 带 [协议] 前缀
    const unmetByName = evaluatePrerequisite(
      { kind: 'research', name: '战斗工兵—预制战斗碉堡协议' },
      context({ activeProtocols: [] }),
    );
    expect(unmetByName.satisfied).toBe(false);
    expect(unmetByName.unmet).toHaveLength(1);
    expect(unmetByName.unmet[0].message).toMatch(/^\[协议\]/);
    expect(unmetByName.unmet[0].message).toContain('战斗工兵—预制战斗碉堡协议');

    // 3. 普通科技未满足时：文案保持原有 `缺少研究：${condition.name}` 100% 不变
    const normalUnmet = evaluatePrerequisite({ kind: 'research', name: '磁暴线圈' }, context());
    expect(normalUnmet).toEqual({
      satisfied: false,
      unmet: [{ path: 'requirements', message: '缺少研究：磁暴线圈' }],
      diagnostics: [],
    });

    // 4. 协议升为 active（通过 state.protocols 或 activeProtocols 传入 ID 或中文名）：双向解析命中并集，判定满足
    const metViaStateActive = evaluatePrerequisite(
      { kind: 'research', id: 'sov.research.t2.superconducting_grid_protocol' },
      context({
        state: {
          protocols: [{ ref: 'sov.research.t2.superconducting_grid_protocol', status: 'active' }],
        },
      }),
    );
    expect(metViaStateActive).toEqual({ satisfied: true, unmet: [], diagnostics: [] });

    const metCrossNameToId = evaluatePrerequisite(
      { kind: 'research', name: '高压超导电网协议' },
      context({
        activeProtocols: ['sov.research.t2.superconducting_grid_protocol'],
      }),
    );
    expect(metCrossNameToId).toEqual({ satisfied: true, unmet: [], diagnostics: [] });

    const metCrossIdToName = evaluatePrerequisite(
      { kind: 'research', id: 'sov.protocol.ra3.combat_engineer_prefab_bunker' },
      context({
        activeProtocols: ['战斗工兵—预制战斗碉堡协议'],
      }),
    );
    expect(metCrossIdToName).toEqual({ satisfied: true, unmet: [], diagnostics: [] });

    // 5. buildEffectiveTechAndProtocolSet 同时包含 techDone 与已激活协议双向标识
    const unionSet = buildEffectiveTechAndProtocolSet(
      context({
        techDone: new Set(['磁暴线圈']),
        state: {
          protocols: [
            { ref: 'sov.protocol.ra3.combat_engineer_prefab_bunker', status: 'active' },
            { ref: 'sov.protocol.ra3.terror_drone_dual_mode', status: 'locked' },
          ],
        },
      }),
    );
    expect(unionSet.has('磁暴线圈')).toBe(true);
    expect(unionSet.has('sov.protocol.ra3.combat_engineer_prefab_bunker')).toBe(true);
    expect(unionSet.has('战斗工兵—预制战斗碉堡协议')).toBe(true);
    expect(unionSet.has('sov.protocol.ra3.terror_drone_dual_mode')).toBe(false);
  });

  it('建筑/单位/改装顶层 research 字段与 prereqs 走同一判定集并集（techDone ∪ activeProtocols）', () => {
    const protoBuilding: BuildingDef = {
      name: '预制战斗碉堡',
      cost: 600,
      power: 0,
      research: '战斗工兵—预制战斗碉堡协议',
      prereqs: [],
      need_buildings: ['苏联兵营'],
      desc: '协议解锁防御工事',
    };
    const protoUnit: ProductionDef = {
      name: 'V4精确战术导弹车',
      cost: 1600,
      need_building: '苏联战车工厂',
      need_buildings: ['苏联战车工厂'],
      prereqs: ['sov.protocol.ra3.v4_precision_payload_package'],
      desc: '协议解锁单位',
    };
    const protoRetrofit = {
      research: 'sov.research.t2.superconducting_grid_protocol',
      need_buildings: ['苏联战斗实验室'],
    };

    const lockedCtx = context({
      bases: new Map([['alpha', base(['苏联兵营', '苏联战车工厂', '苏联战斗实验室'])]]),
      state: {
        protocols: [
          { ref: 'sov.protocol.ra3.combat_engineer_prefab_bunker', status: 'locked' },
          { ref: 'sov.protocol.ra3.v4_precision_payload_package', status: 'experimenting' },
          { ref: 'sov.research.t2.superconducting_grid_protocol', status: 'available' },
        ],
      },
    });

    expect(deriveBuildableWithContext([protoBuilding], lockedCtx, [])).toEqual([]);
    expect(deriveProducibleWithContext([protoUnit], lockedCtx)).toEqual([]);
    const retrofitLockedEval = evaluatePrerequisite(combineLegacyPrerequisites(protoRetrofit, 'running'), lockedCtx);
    expect(retrofitLockedEval.satisfied).toBe(false);
    expect(retrofitLockedEval.unmet[0].message).toMatch(/^\[协议\]/);

    const activeCtx = context({
      bases: new Map([['alpha', base(['苏联兵营', '苏联战车工厂', '苏联战斗实验室'])]]),
      state: {
        protocols: [
          { ref: 'sov.protocol.ra3.combat_engineer_prefab_bunker', status: 'active' },
          { ref: 'sov.protocol.ra3.v4_precision_payload_package', status: 'active' },
          { ref: 'sov.research.t2.superconducting_grid_protocol', status: 'active' },
        ],
      },
    });

    expect(deriveBuildableWithContext([protoBuilding], activeCtx, [])).toEqual([protoBuilding]);
    expect(deriveProducibleWithContext([protoUnit], activeCtx)).toEqual([protoUnit]);
    const retrofitActiveEval = evaluatePrerequisite(combineLegacyPrerequisites(protoRetrofit, 'running'), activeCtx);
    expect(retrofitActiveEval.satisfied).toBe(true);
    expect(retrofitActiveEval.unmet).toEqual([]);

    // 苏联战斗实验室与红星实验设计局综合体新旧名称双向互通
    const realNameBaseCtx = context({
      bases: new Map([['alpha', base(['苏联兵营', '苏联战车工厂', '红星实验设计局综合体'])]]),
      state: {
        protocols: [{ ref: 'sov.research.t2.superconducting_grid_protocol', status: 'active' }],
      },
    });
    expect(evaluatePrerequisite(combineLegacyPrerequisites(protoRetrofit, 'running'), realNameBaseCtx).satisfied).toBe(
      true,
    );
  });
});
