/**
 * mcvDeployAndPrereq.test.ts —— MCV-ENGINE-01 单元测试
 *
 * 覆盖：
 * 1. prerequisites.ts：BUILDING_EQUIVALENTS 双向建筑名称等价映射 + 铁律一（建造厂母体硬门槛 & 生产建筑母体硬门槛）；
 * 2. deploymentEngine.ts & parse/engAndDeployOrders.ts：MCV 名称双向等价（resolveMcvVehicleAliases）与 duration_min=0 归一；
 * 3. parse/eventDoor.ts & parsePipeline.ts & settleFloor.ts：<事件> MCV展开 / <部署> 展开 当楼即时展开闭环（Δt=0 即时翻转、基地升格运转中、注入基础发电 50）；
 * 4. <事件> MCV收起 闭环：将在场「盟军建造厂」收回 forces.vehicles 的「MCV（盟军）」。
 */
import { describe, expect, it } from 'vitest';
import {
  deployBlockIndexFromCatalog,
  resolveMcvVehicleAliases,
} from '../engines/deploymentEngine';
import { extractEvents, parseMessageText } from '../parse/parsePipeline';
import {
  BUILDING_EQUIVALENTS,
  deriveBuildableWithContext,
  deriveProducibleWithContext,
  evaluateBuildingUnlock,
  evaluateProductionUnlock,
  ROOT_CONYARD_BUILDINGS,
  setHasEquivalentBuilding,
} from '../core/prerequisites';
import { Schema } from '../core/schema';
import { settleFloor } from '../engines/settleFloor';

describe('MCV-ENGINE-01 · 1. 建造厂母体硬门槛与 BUILDING_EQUIVALENTS 等价映射', () => {
  it('无建造厂时：evaluateBuildingUnlock 对 need_buildings=[] 的发电厂返回 { unlocked: false, missingBuildings: ["建造厂"] }；加入盟军建造厂后返回 unlocked: true', () => {
    const powerPlant = { name: '发电厂', need_buildings: [] as string[], prereqs: [] as string[] };

    const lockedRes = evaluateBuildingUnlock(powerPlant, {
      selectedBaseBuildings: new Set<string>(),
    });
    expect(lockedRes.unlocked).toBe(false);
    expect(lockedRes.missingBuildings).toEqual(['建造厂']);

    const unlockedRes = evaluateBuildingUnlock(powerPlant, {
      selectedBaseBuildings: new Set<string>(['盟军建造厂']),
    });
    expect(unlockedRes.unlocked).toBe(true);
    expect(unlockedRes.missingBuildings).toEqual([]);
  });

  it('免母体根建筑（ROOT_CONYARD_BUILDINGS）自身不受建造厂母体门槛拦截，其他建筑受门控', () => {
    for (const rootName of ROOT_CONYARD_BUILDINGS) {
      const res = evaluateBuildingUnlock(
        { name: rootName, need_buildings: [] },
        { selectedBaseBuildings: new Set<string>() },
      );
      expect(res.unlocked).toBe(true);
    }

    const list = [
      { name: '发电厂', need_buildings: [] },
      { name: '矿石精炼厂', need_buildings: ['发电厂'] },
    ];
    expect(deriveBuildableWithContext(list, { selectedBaseBuildings: new Set() })).toEqual([]);
    expect(
      deriveBuildableWithContext(list, { selectedBaseBuildings: new Set(['苏联建造厂', '磁能反应堆']) }).map(
        b => b.name,
      ),
    ).toEqual(['发电厂', '矿石精炼厂']);
  });

  it('BUILDING_EQUIVALENTS 覆盖各阵营发电厂/矿场/兵营/车厂/空指/船厂/实验室/雷达站等价判定', () => {
    expect(BUILDING_EQUIVALENTS['建造厂']).toContain('盟军建造厂');
    expect(BUILDING_EQUIVALENTS['发电厂']).toContain('磁能反应堆');
    expect(BUILDING_EQUIVALENTS['矿石精炼厂']).toContain('奴隶矿场');
    expect(BUILDING_EQUIVALENTS['兵营']).toContain('盟军兵营');
    expect(BUILDING_EQUIVALENTS['个人装备制造所']).toContain('装备制造所');
    expect(BUILDING_EQUIVALENTS['战车工厂']).toContain('苏联战车工厂');
    expect(BUILDING_EQUIVALENTS['空军指挥部']).toContain('雷达站');
    expect(BUILDING_EQUIVALENTS['海军造船厂']).toContain('潜艇船坞');
    expect(BUILDING_EQUIVALENTS['作战实验室']).toContain('盟军战斗实验室');
    expect(BUILDING_EQUIVALENTS['战斗实验室']).toContain('苏联作战实验室');
    expect(BUILDING_EQUIVALENTS['雷达站']).toContain('心灵感应器');

    expect(setHasEquivalentBuilding(new Set(['盟军战斗实验室']), '作战实验室')).toBe(true);
    expect(setHasEquivalentBuilding(new Set(['苏联雷达站']), '雷达站')).toBe(true);
  });
});

describe('MCV-ENGINE-01 · 2. 生产建筑母体硬门槛（evaluateProductionUnlock）', () => {
  it('无兵营/战车工厂时：need_buildings=[] 的 infantry 步兵返回 { unlocked: false, missingBuildings: ["兵营"] }；加入盟军兵营后返回 unlocked: true', () => {
    const infantrySquad = {
      name: '盟军步兵班',
      category: 'infantry',
      need_buildings: [] as string[],
      prereqs: [] as string[],
    };

    const lockedRes = evaluateProductionUnlock(infantrySquad, {
      selectedBaseBuildings: new Set<string>(['盟军建造厂']),
    });
    expect(lockedRes.unlocked).toBe(false);
    expect(lockedRes.missingBuildings).toEqual(['兵营']);

    const unlockedRes = evaluateProductionUnlock(infantrySquad, {
      selectedBaseBuildings: new Set<string>(['盟军建造厂', '盟军兵营']),
    });
    expect(unlockedRes.unlocked).toBe(true);
    expect(unlockedRes.missingBuildings).toEqual([]);
  });

  it('按 category 推导 equipment / aircraft / naval / vehicle 默认母体建筑', () => {
    const samples = [
      { name: '外骨骼装甲', category: 'equipment', need_buildings: [] },
      { name: '入侵者战机', category: 'aircraft', need_buildings: [] },
      { name: '驱逐舰', category: 'naval', need_buildings: [] },
      { name: '灰熊坦克', category: 'vehicle', need_buildings: [] },
    ];

    const onlyConyard = { selectedBaseBuildings: new Set<string>(['盟军建造厂']) };
    expect(evaluateProductionUnlock(samples[0], onlyConyard)).toMatchObject({
      unlocked: false,
      missingBuildings: ['个人装备制造所'],
    });
    expect(evaluateProductionUnlock(samples[1], onlyConyard)).toMatchObject({
      unlocked: false,
      missingBuildings: ['空军指挥部'],
    });
    expect(evaluateProductionUnlock(samples[2], onlyConyard)).toMatchObject({
      unlocked: false,
      missingBuildings: ['海军造船厂'],
    });
    expect(evaluateProductionUnlock(samples[3], onlyConyard)).toMatchObject({
      unlocked: false,
      missingBuildings: ['战车工厂'],
    });

    const fullBase = {
      selectedBaseBuildings: new Set<string>([
        '盟军建造厂',
        '装备制造所',
        '盟军空军指挥部',
        '盟军海军造船厂',
        '盟军战车工厂',
      ]),
    };
    expect(deriveProducibleWithContext(samples, fullBase).map(s => s.name)).toEqual([
      '外骨骼装甲',
      '入侵者战机',
      '驱逐舰',
      '灰熊坦克',
    ]);
  });
});

describe('MCV-ENGINE-01 · 3. MCV 当楼即时展开闭环（<事件> MCV展开 与 <部署> 展开）', () => {
  const mkInitialMcvState = () =>
    Schema.parse({
      meta: { world_id: 'ra2_test', date: '2042-05-01', day_count: 1 },
      bases: [
        {
          id: '一号前哨站',
          name: '一号前哨站',
          location: '东海岸滩头',
          status: '隐蔽中',
          power: { gen: 0, use: 0 },
          buildings: [],
          alerts: [],
        },
      ],
      forces: {
        vehicles: ['MCV（盟军）'],
      },
    });

  it('resolveMcvVehicleAliases 与 deployBlockIndexFromCatalog 将 MCV 别名全部归一且 duration_min=0', () => {
    expect(resolveMcvVehicleAliases('盟军移动基地车')).toContain('MCV（盟军）');
    expect(resolveMcvVehicleAliases('苏联移动基地车')).toContain('MCV（苏联）');
    expect(resolveMcvVehicleAliases('尤里移动基地车')).toContain('MCV（尤里）');

    const idx = deployBlockIndexFromCatalog({
      productions: [
        {
          name: '盟军移动基地车',
          deploy: { into: '盟军建造厂', capabilities: ['build.conyard'], duration_min: 60, reverse: true },
        },
      ],
    });
    expect(idx.byVehicle('MCV（盟军）')).toMatchObject({
      into: '盟军建造厂',
      duration_min: 0,
      reverse: true,
    });
    expect(idx.byVehicle('盟军移动基地车')?.duration_min).toBe(0);
    expect(idx.byInto('盟军建造厂')?.vehicle).toBe('MCV（盟军）');
    expect(idx.byInto('建造厂')?.vehicle).toBe('MCV（盟军）');
  });

  it('<事件> MCV展开：即使 <timePast> 为 0，parseMessageText + settleFloor 当楼移除 MCV（盟军）、新增盟军建造厂（运转）、基地升格运转中、发电变为 50、零在途卡死', () => {
    const prev = mkInitialMcvState();
    const rawText = [
      '<事件>',
      '- 类型: MCV展开',
      '  载具: MCV（盟军）',
      '  基地: 一号前哨站',
      '  理由: 在一号前哨站就地展开移动基地车建立建造厂核心',
      '</事件>',
    ].join('\n');

    const gate = extractEvents(
      '- 类型: MCV展开\n  载具: MCV（盟军）\n  基地: 一号前哨站\n  理由: 就地展开',
    );
    expect(gate.greenEvents).toHaveLength(1);
    expect(gate.greenEvents[0]).toMatchObject({
      verb: 'MCV展开',
      kind: 'deploy',
      deploy: {
        action: '展开',
        vehicle: 'MCV（盟军）',
        base: '一号前哨站',
      },
    });

    const parsed = parseMessageText(rawText, prev);
    expect(parsed.deployOrders).toEqual([
      {
        vehicle: 'MCV（盟军）',
        action: '展开',
        base: '一号前哨站',
        into: '盟军建造厂',
        duration_min: 0,
      },
    ]);

    const settled = settleFloor(prev, parsed.data, rawText, {
      deployOrders: parsed.deployOrders,
      eventDeclarations: parsed.eventDeclarations,
    });

    expect(settled.deltaMinutes).toBe(0);
    expect(settled.data.forces.vehicles).not.toContain('MCV（盟军）');
    expect(settled.data.forces.vehicles).toEqual([]);
    expect(settled.data.bases[0].buildings).toContainEqual({
      name: '盟军建造厂',
      layer: '',
      state: '运转',
    });
    expect(settled.data.bases[0].status).toBe('运转中');
    expect(settled.data.bases[0].power.gen).toBe(50);
    expect(settled.data.pending_deployments ?? []).toEqual([]);
  });

  it('<部署> 展开: 盟军移动基地车 | 基地: 一号前哨站（跨别名匹配车队 MCV（盟军））：Δt=0 当楼即时展开', () => {
    const prev = mkInitialMcvState();
    const deployIndex = deployBlockIndexFromCatalog({});
    const rawText = '<战况>\n<部署>\n展开: 盟军移动基地车 | 基地: 一号前哨站\n</部署>\n</战况>';

    const parsed = parseMessageText(rawText, prev, { deployIndex });
    expect(parsed.deployOrders).toEqual([
      {
        vehicle: 'MCV（盟军）',
        action: '展开',
        base: '一号前哨站',
        into: '盟军建造厂',
        duration_min: 0,
      },
    ]);

    const settled = settleFloor(prev, parsed.data, rawText, {
      deployOrders: parsed.deployOrders,
    });
    expect(settled.data.forces.vehicles).toEqual([]);
    expect(settled.data.bases[0].buildings).toContainEqual({
      name: '盟军建造厂',
      layer: '',
      state: '运转',
    });
    expect(settled.data.bases[0].status).toBe('运转中');
    expect(settled.data.bases[0].power.gen).toBe(50);
    expect(settled.data.pending_deployments ?? []).toEqual([]);
  });
});

describe('MCV-ENGINE-01 · 4. MCV 收起闭环（<事件> MCV收起）', () => {
  it('<事件> - 类型: MCV收起 将在场「盟军建造厂」当楼收回 forces.vehicles 的「MCV（盟军）」', () => {
    const baseParsed = Schema.parse({
      meta: { world_id: 'ra2_test', date: '2042-05-01', day_count: 1 },
      bases: [
        {
          id: '一号前哨站',
          name: '一号前哨站',
          location: '东海岸滩头',
          status: '警戒',
          power: { gen: 50, use: 0 },
          buildings: [{ name: '盟军建造厂', layer: '', state: '运转' }],
          alerts: [],
        },
      ],
      forces: {
        vehicles: [],
      },
    });
    const deployedState = {
      ...baseParsed,
      bases: baseParsed.bases.map(b => ({ ...b, status: '运转中' as unknown as typeof b.status })),
    };

    // 即使事件中建筑缺省（默认「建造厂」）且基地缺省（回退 bases[0]），也能自动匹配在场「盟军建造厂」并收回为「MCV（盟军）」
    const rawText = [
      '<事件>',
      '- 类型: 基地收起',
      '  建筑: 建造厂',
      '  基地: 一号前哨站',
      '  理由: 战线转移，收起建造厂撤离',
      '</事件>',
    ].join('\n');

    const parsed = parseMessageText(rawText, deployedState);
    expect(parsed.deployOrders).toEqual([
      {
        vehicle: 'MCV（盟军）',
        action: '收起',
        base: '一号前哨站',
        into: '盟军建造厂',
        duration_min: 0,
      },
    ]);

    const settled = settleFloor(deployedState, parsed.data, rawText, {
      deployOrders: parsed.deployOrders,
      eventDeclarations: parsed.eventDeclarations,
    });

    expect(settled.data.bases[0].buildings).toEqual([]);
    expect(settled.data.forces.vehicles).toEqual(['MCV（盟军）']);
    expect(settled.data.bases[0].status).toBe('废弃');
    expect(settled.data.pending_deployments ?? []).toEqual([]);
  });

  it('开局占位基地「待侦知部署点」在首轮 <战况> 与 <事件> MCV展开 命名为「前沿第一基地」时就地合并，且 <图鉴>「盟军建造厂」不被截断为「盟军」', () => {
    const launchBaseline = Schema.parse({
      meta: { world_id: 'cyber2042', date: '2042-03-14', day_count: 0, location: '（自创城市·首铺时定）' },
      bases: [
        {
          id: 'cyber-entry',
          name: '待侦知部署点',
          location: '（自创城市·首铺时定）',
          status: '隐蔽中',
          power: { gen: 0, use: 0 },
          buildings: [],
          alerts: [],
        },
      ],
      forces: {
        vehicles: ['MCV（盟军）'],
      },
    });

    const rawText = [
      '<timePast>0 D 0 H 15 M</timePast>',
      '<战况>',
      '日期: 2042-03-14',
      '天气: 阴雨',
      '资金: 2000',
      '基地:',
      '  - 名称: 前沿第一基地',
      '    状态: 运转中',
      '    电力: {发电: 0, 用电: 0}',
      '    建筑:',
      '      - 名称: 盟军建造厂',
      '        状态: 运转',
      '</战况>',
      '<事件>',
      '- 类型: MCV展开',
      '  载具: MCV（盟军）',
      '  基地: 前沿第一基地',
      '</事件>',
      '<图鉴>',
      '- 名称: 盟军建造厂',
      '  类别: 建筑',
      '  简介: 战区战役展开与重工业施工的核心原点。',
      '</图鉴>',
    ].join('\n');

    const parsed = parseMessageText(rawText, launchBaseline, {
      authority: { names: ['盟军', '苏联', '发电厂', '兵营'], aliases: {} },
    });
    const settled = settleFloor(launchBaseline, parsed.data, rawText, {
      deployOrders: parsed.deployOrders,
      eventDeclarations: parsed.eventDeclarations,
    });

    // 不分裂出第二座基地，原地重命名为「前沿第一基地」
    expect(settled.data.bases).toHaveLength(1);
    expect(settled.data.bases[0].name).toBe('前沿第一基地');
    expect(settled.data.bases[0].status).toBe('运转中');
    expect(settled.data.bases[0].power.gen).toBe(50);
    expect(settled.data.bases[0].buildings).toEqual([{ name: '盟军建造厂', layer: '', state: '运转' }]);
    expect(settled.data.forces.vehicles).toEqual([]);
    // 图鉴名称保持「盟军建造厂」，不被模糊对齐截断为「盟军」
    expect(settled.data.codex[0]?.name).toBe('盟军建造厂');
  });

  it('严格锁死三大官方阵营（盟军/苏联/尤里）：非三大官方阵营 MCV 与建筑前缀不进入默认展开表与剥离规则', async () => {
    expect(resolveMcvVehicleAliases('盟军移动基地车')).toContain('MCV（盟军）');
    expect(resolveMcvVehicleAliases('苏联移动基地车')).toContain('MCV（苏联）');
    expect(resolveMcvVehicleAliases('尤里移动基地车')).toContain('MCV（尤里）');
    expect(ROOT_CONYARD_BUILDINGS.has('升阳建造厂')).toBe(false);

    const idx = deployBlockIndexFromCatalog({});
    expect(idx.byVehicle('MCV（盟军）')?.into).toBe('盟军建造厂');
    expect(idx.byVehicle('MCV（苏联）')?.into).toBe('苏联建造厂');
    expect(idx.byVehicle('MCV（尤里）')?.into).toBe('尤里建造厂');
    expect(idx.byVehicle('MCV（升阳）')).toBeUndefined();
    expect(idx.byInto('升阳建造厂')).toBeUndefined();

    const { stripFactionBuildingPrefix: stripPrereq } = await import('../core/prerequisitesHelpers');
    const { stripFactionBuildingPrefix: stripTax, CONYARD_ORIGIN_NAMES } = await import(
      '../../中控悬浮窗/models/tagTaxonomy'
    );
    const { CONYARD_BUILDING_NAMES, buildPrerequisiteContext } = await import(
      '../../中控悬浮窗/console/consoleBuildGridHelpers'
    );

    for (const prefix of ['盟军', '苏联', '苏军', '苏维埃', '尤里', '通用']) {
      expect(stripPrereq(`${prefix}发电厂`)).toBe('发电厂');
      expect(stripTax(`${prefix}发电厂`)).toBe('发电厂');
    }
    expect(stripPrereq('升阳发电厂')).toBe('升阳发电厂');
    expect(stripTax('升阳发电厂')).toBe('升阳发电厂');
    expect(CONYARD_ORIGIN_NAMES.has('升阳建造厂')).toBe(false);
    expect(CONYARD_BUILDING_NAMES.has('升阳建造厂')).toBe(false);

    const ctx = buildPrerequisiteContext(
      Schema.parse({
        bases: [
          {
            id: 'b_yuri',
            name: '心灵前哨',
            status: '运转中',
            buildings: [
              { name: '尤里建造厂', state: '运转' },
              { name: '尤里发电厂', state: '运转' },
            ],
          },
        ],
      }),
      0,
      [],
    );
    expect(ctx?.bases.get('b_yuri')?.running.has('发电厂')).toBe(true);
    expect(ctx?.bases.get('b_yuri')?.running.has('建造厂')).toBe(true);
  });
});
