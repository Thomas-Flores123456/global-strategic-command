/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读取 SFC 源码校验 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';
import { Schema } from '../../红警指挥系统/core/schema';
import { settleFloor } from '../../红警指挥系统/engines/settleFloor';
import {
  BUILDING_SYSTEM_TABS,
  buildBuildingOverviewModel,
  classifyBuildingSystem,
} from '../models/buildingSystemModel';
import {
  BUILD_PANEL_GROUPS,
  domainsOfBuilding,
  isConyardOriginBuilding,
  isSingleInstancePerBaseBuilding,
  stripFactionBuildingPrefix,
} from '../models/tagTaxonomy';

describe('FD-18 基地建筑五大体系模型与红警蓝图化契约 (buildingSystemModel)', () => {
  it('导出五大建筑体系页签并覆盖节点四态（built 双模 / building / unlocked / locked）与 base/global 视角切换', () => {
    expect(BUILDING_SYSTEM_TABS.map(t => t.id)).toEqual([
      'military',
      'defense',
      'agro',
      'industry',
      'research_space',
    ]);

    const snapshot = Schema.parse({
      bases: [
        {
          id: 'base-1',
          name: '一号主基地',
          status: '隐蔽中',
          power: { gen: 300, use: 180 },
          buildings: [
            { name: '盟军建造厂', state: '运转' },
            { name: '盟军兵营', state: '运转', mode: '生产' },
            { name: '兵营', state: '运转', mode: '加速' },
            { name: '发电厂', state: '运转' },
            { name: '有机循环处理站', state: '运转' },
          ],
        },
        {
          id: 'base-2',
          name: '二号前哨基地',
          status: '警戒',
          power: { gen: 200, use: 90 },
          buildings: [
            { name: '苏联建造厂', state: '运转' },
            { name: '磁暴线圈', state: '运转' },
            { name: '铁幕装置', state: '运转' },
          ],
        },
      ],
      tech: { done: ['光棱聚焦理论'] },
      queues: [
        {
          type: '建造',
          item: '战车工厂',
          base: 'base-1',
          progress: 65,
          status: 'active',
        },
      ],
    });

    const mockCatalog = {
      buildings: [
        {
          name: '个人装备制造所',
          cost: 800,
          power: 20,
          research: null,
          need_building: '兵营',
          prereqs: [],
          need_buildings: ['兵营'],
          desc: '制造单兵武器与外骨骼装具',
        },
        {
          name: '战斗实验室',
          cost: 2000,
          power: 100,
          research: '高级作战实验理论',
          prereqs: ['高级作战实验理论'],
          need_buildings: ['建造厂核心'],
          desc: 'T2 科技研发中枢',
        },
      ],
    };

    const baseModel = buildBuildingOverviewModel(snapshot, mockCatalog, {
      scope: 'base',
      activeBaseIndex: 0,
    });

    expect(baseModel.activeBaseName).toBe('一号主基地');
    expect(baseModel.totalBuiltCount).toBe(5);
    expect(baseModel.powerSummary).toEqual({ gen: 300, use: 180, net: 120 });

    const milNodes = baseModel.systems.military.nodes;
    const conyardNode = milNodes.find(n => n.id === 'mil_conyard')!;
    expect(conyardNode.state).toBe('built');
    expect(conyardNode.statusText).toBe('已展开×1 · 运转');
    expect(baseModel.hasOperationalConyard).toBe(true);

    const barracksNode = milNodes.find(n => n.id === 'mil_barracks')!;
    expect(barracksNode.state).toBe('built');
    expect(barracksNode.builtCount).toBe(2);
    expect(barracksNode.productionModeCount).toBe(1);
    expect(barracksNode.accelModeCount).toBe(1);
    expect(barracksNode.statusText).toContain('产1/加1');
    expect(barracksNode.instances.length).toBe(2);

    const wfNode = milNodes.find(n => n.id === 'mil_warfactory')!;
    expect(wfNode.state).toBe('building');
    expect(wfNode.buildingProgress).toBe(65);

    const equipNode = milNodes.find(n => n.id === 'mil_equip')!;
    expect(equipNode.state).toBe('unlocked');

    const labNode = baseModel.systems.research_space.nodes.find(n => n.id === 'rs_battlelab')!;
    expect(labNode.state).toBe('locked');
    expect(labNode.hint).toContain('高级作战实验理论');

    // 切换战区全局视角：合并且点亮二号基地的磁暴线圈与铁幕装置
    const globalModel = buildBuildingOverviewModel(snapshot, mockCatalog, {
      scope: 'global',
      activeBaseIndex: 0,
    });
    expect(globalModel.totalBuiltCount).toBe(8);
    expect(globalModel.powerSummary).toEqual({ gen: 500, use: 270, net: 230 });
    const teslaNode = globalModel.systems.defense.nodes.find(n => n.id === 'def_mid_tesla')!;
    expect(teslaNode.state).toBe('built');
    const ironNode = globalModel.systems.research_space.nodes.find(n => n.id === 'rs_iron')!;
    expect(ironNode.state).toBe('built');
  });

  it('防御纵深三圈（far/mid/near/core）与农畜四阶闭环（含 feedback 回灌虚线边）结构完整', () => {
    const model = buildBuildingOverviewModel(Schema.parse({}), null);
    const defNodes = model.systems.defense.nodes;
    expect(defNodes.filter(n => n.defenseRing === 'far').length).toBe(4);
    expect(defNodes.filter(n => n.defenseRing === 'mid').length).toBe(4);
    expect(defNodes.filter(n => n.defenseRing === 'near').length).toBe(4);
    expect(defNodes.filter(n => n.defenseRing === 'core').length).toBe(4);

    const agroSys = model.systems.agro;
    expect(agroSys.nodes.filter(n => n.agroStage === 'base').length).toBe(4);
    expect(agroSys.nodes.filter(n => n.agroStage === 'primary').length).toBe(5);
    expect(agroSys.nodes.filter(n => n.agroStage === 'process').length).toBe(3);
    expect(agroSys.nodes.filter(n => n.agroStage === 'recycle').length).toBe(3);
    const feedbackEdges = agroSys.edges.filter(e => e.feedback);
    expect(feedbackEdges.length).toBeGreaterThanOrEqual(2);

    expect(classifyBuildingSystem({ name: '智能温室大棚' })).toBe('agro');
    expect(classifyBuildingSystem({ name: '爱国者防空导弹阵地' })).toBe('defense');
    expect(classifyBuildingSystem({ name: '受控核聚变示范堆' })).toBe('industry');
    expect(classifyBuildingSystem({ name: '超时空传送仪' })).toBe('research_space');
    expect(classifyBuildingSystem({ name: '战车工厂' })).toBe('military');
  });

  it('D-BLD-04：排除建造厂核心原点、识别单基地唯一中枢、标准建筑分桶绝不掉入其他', () => {
    expect(isConyardOriginBuilding({ id: 'bld.common.construction_yard_core', name: '建造厂核心', cost: 0 })).toBe(true);
    expect(isConyardOriginBuilding({ name: '盟军建造厂', cost: 0 })).toBe(true);
    expect(isConyardOriginBuilding({ name: '发电厂', cost: 800 })).toBe(false);

    expect(isSingleInstancePerBaseBuilding({ name: '盟军战斗实验室' })).toBe(true);
    expect(isSingleInstancePerBaseBuilding({ name: '超时空传送仪' })).toBe(true);
    expect(isSingleInstancePerBaseBuilding({ name: '光棱塔' })).toBe(false);
    expect(stripFactionBuildingPrefix('苏联兵营')).toBe('兵营');

    const groupDomains = new Set(BUILD_PANEL_GROUPS.flatMap(g => g.domains));
    for (const sample of [
      { name: '盟军兵营', tags: ['主建筑', '人员相关', '基础设施'] },
      { name: '光棱塔', tags: ['防御建筑', '光棱聚焦'] },
      { name: '智能温室大棚', tags: ['农业建筑'] },
      { name: '战地维修所', tags: ['工业建筑'] },
    ]) {
      const d = domainsOfBuilding(sample.name, '', sample.tags);
      expect(d.some(dom => groupDomains.has(dom as never))).toBe(true);
    }
  });

  it('D-BLD-05：settleFloor 跨楼层自动归档清理上一楼遗留的 done / cancelled 终态队列项', () => {
    const prevData = Schema.parse({
      queues: [
        {
          type: '建造',
          item: '发电厂',
          base: 'base-1',
          progress: 100,
          status: 'done',
          started_at: '2026-01-01 08:00',
          total_minutes: 60,
        },
        {
          type: '生产',
          item: '动员兵',
          base: 'base-1',
          progress: 20,
          status: 'cancelled',
          started_at: '2026-01-01 09:00',
          total_minutes: 30,
        },
      ],
    });

    const nextData = Schema.parse({
      queues: [
        ...prevData.queues,
        {
          type: '建造',
          item: '兵营',
          base: 'base-1',
          progress: 40,
          status: 'active',
          started_at: '2026-01-01 10:00',
          total_minutes: 120,
        },
      ],
    });

    const res = settleFloor(prevData, nextData, '推进事务');
    expect(res.data.queues.map(q => q.item)).toEqual(['兵营']);
  });

  it('MCV 未展开门禁：基地无运转中的建造厂核心时，建造厂核心显示「未展开」，连发电厂也处于 locked 状态', () => {
    const noConyardSnapshot = Schema.parse({
      bases: [
        {
          id: 'base-empty',
          name: '新建前哨基地',
          status: '隐蔽中',
          power: { gen: 0, use: 0 },
          buildings: [],
        },
      ],
      forces: { troops: {}, vehicles: ['盟军基地车(MCV)'], girls: [] },
    });

    const mockCatalog = {
      buildings: [
        {
          id: 'bld.common.construction_yard_core',
          name: '建造厂核心',
          cost: 0,
          power: 0,
          research: null,
          need_building: undefined,
          prereqs: [],
          need_buildings: [],
          desc: '基地建造中枢',
        },
        {
          id: 'bld.common.power_plant',
          name: '发电厂',
          cost: 800,
          power: -200,
          research: null,
          need_building: undefined,
          prereqs: [],
          need_buildings: [],
          desc: '基础电力设施',
        },
      ],
    };

    const model = buildBuildingOverviewModel(noConyardSnapshot, mockCatalog, {
      scope: 'base',
      activeBaseIndex: 0,
    });

    expect(model.hasOperationalConyard).toBe(false);
    const conyardNode = model.systems.military.nodes.find(n => n.id === 'mil_conyard')!;
    expect(conyardNode.state).toBe('locked');
    expect(conyardNode.statusText).toBe('未展开');
    expect(conyardNode.hint).toContain('MCV');

    const powerNode = model.systems.industry.nodes.find(n => n.id === 'ind_power')!;
    expect(powerNode.state).toBe('locked');
    expect(powerNode.statusText).toBe('未解锁');
    expect(powerNode.hint).toContain('需先展开建造厂核心 (MCV)');
  });

  it('苏联阵营切换：同位节点自动切换苏联实名，且包含天启车间/基洛夫飞艇库/无畏船坞等苏联专属节点', () => {
    const sovietSnapshot = Schema.parse({
      bases: [
        {
          id: 'base-sov',
          name: '红星一号基地',
          status: '警戒',
          power: { gen: 400, use: 200 },
          buildings: [
            { name: '苏联建造厂', state: '运转' },
            { name: '基洛夫飞艇整备锚泊库', state: '运转' },
            { name: '天启超重型总装车间', state: '运转' },
            { name: '无畏级深水干船坞', state: '运转' },
          ],
        },
      ],
    });

    const sovModel = buildBuildingOverviewModel(sovietSnapshot, null, {
      scope: 'base',
      activeBaseIndex: 0,
      factionFilter: 'soviet',
    });

    const milNodes = sovModel.systems.military.nodes;
    expect(milNodes.find(n => n.id === 'mil_conyard')?.displayShortLabel).toBe('苏联建造厂');
    expect(milNodes.find(n => n.id === 'mil_barracks')?.displayShortLabel).toBe('苏联兵营');
    expect(milNodes.find(n => n.id === 'mil_academy')?.displayShortLabel).toBe('复制中心');
    expect(milNodes.find(n => n.id === 'mil_apoc_bay')?.state).toBe('built');
    expect(milNodes.find(n => n.id === 'mil_kirov_hangar')?.state).toBe('built');
    expect(milNodes.find(n => n.id === 'mil_dreadnought_dock')?.state).toBe('built');
    expect(sovModel.systems.research_space.nodes.find(n => n.id === 'rs_quantum')?.displayShortLabel).toBe(
      '红星科学城',
    );
  });

  it('阵营建造厂独立门禁：仅展开「盟军建造厂」而无「苏联建造厂」时，苏联建造厂显示「未展开」，全部苏联专属建筑与苏联体系下节点均不可建造（locked）', () => {
    const alliedOnlySnapshot = Schema.parse({
      command: { primary_faction: 'allied', unlocked_factions: ['allied'] },
      bases: [
        {
          id: 'base-allied-only',
          name: '前沿第一基地',
          status: '警戒',
          power: { gen: 200, use: 50 },
          buildings: [
            { name: '盟军建造厂', state: '运转' },
            { name: '盟军兵营', state: '运转' },
          ],
        },
      ],
    });

    const mixedCatalog = {
      buildings: [
        {
          id: 'bld.common.construction_yard_core',
          name: '建造厂核心',
          faction: 'common',
          cost: 0,
          power: 0,
          research: null,
          need_building: '',
          prereqs: [],
          need_buildings: [],
          desc: '基地建造中枢',
        },
        {
          id: 'bld.common.power_plant',
          name: '发电厂',
          faction: 'common',
          cost: 800,
          power: -200,
          research: null,
          need_building: '',
          prereqs: [],
          need_buildings: [],
          desc: '基础电力设施',
        },
        {
          id: 'bld.allied.power_plant',
          name: '盟军发电厂',
          faction: 'allied',
          cost: 800,
          power: -200,
          research: null,
          need_building: '',
          prereqs: [],
          need_buildings: [],
          desc: '盟军制式电厂',
        },
        {
          id: 'bld.soviet.tesla_reactor',
          name: '苏联磁能反应炉',
          faction: 'soviet',
          cost: 600,
          power: -150,
          research: null,
          need_building: '',
          prereqs: [],
          need_buildings: [],
          desc: '苏联基础电厂',
        },
        {
          id: 'bld.soviet.heavy_engineering_expansion_module',
          name: '苏联大规模工程扩建模块',
          faction: 'soviet',
          cost: 1200,
          power: 40,
          research: null,
          need_building: '建造厂核心',
          prereqs: [],
          need_buildings: ['建造厂核心'],
          desc: '苏联建造厂工程扩建',
        },
        {
          id: 'bld.soviet.sentry_gun',
          name: '苏联哨戒炮',
          faction: 'soviet',
          cost: 500,
          power: 20,
          research: null,
          need_building: '兵营',
          prereqs: [],
          need_buildings: ['兵营'],
          desc: '苏联基础点防',
        },
      ],
    };

    // 1. 全部阵营视角：盟军建造厂已展开，盟军/通用基础建筑可建造，但苏联建筑因无苏联建造厂一律为 locked
    const allModel = buildBuildingOverviewModel(alliedOnlySnapshot, mixedCatalog, {
      scope: 'base',
      activeBaseIndex: 0,
      factionFilter: 'all',
    });
    expect(allModel.hasOperationalConyard).toBe(true);
    expect(allModel.systems.military.nodes.find(n => n.id === 'mil_conyard')?.state).toBe('built');
    expect(allModel.systems.industry.nodes.find(n => n.id === 'ind_power')?.state).toBe('unlocked');
    expect(allModel.systems.industry.nodes.find(n => n.id === 'ind_tesla_plant')?.state).toBe('locked');

    const findInAll = (name: string) =>
      Object.values(allModel.systems)
        .flatMap(s => s.catalogEntries)
        .find(e => e.name === name);
    expect(findInAll('发电厂')?.state).toBe('unlocked');
    expect(findInAll('盟军发电厂')?.state).toBe('unlocked');
    expect(findInAll('苏联磁能反应炉')?.state).toBe('locked');
    expect(findInAll('苏联磁能反应炉')?.prereqText).toContain('需先展开苏联MCV');
    expect(findInAll('苏联大规模工程扩建模块')?.state).toBe('locked');
    expect(findInAll('苏联哨戒炮')?.state).toBe('locked');

    // 2. 切换至「苏联体系」视角：由于没有展开苏联建造厂，苏联建造厂必须为「未展开」(locked)，且没有任何建筑可建造
    const sovViewModel = buildBuildingOverviewModel(alliedOnlySnapshot, mixedCatalog, {
      scope: 'base',
      activeBaseIndex: 0,
      factionFilter: 'soviet',
    });
    expect(sovViewModel.hasOperationalConyard).toBe(false);
    const sovConyardNode = sovViewModel.systems.military.nodes.find(n => n.id === 'mil_conyard')!;
    expect(sovConyardNode.displayShortLabel).toBe('苏联建造厂');
    expect(sovConyardNode.builtCount).toBe(0);
    expect(sovConyardNode.state).toBe('locked');
    expect(sovConyardNode.statusText).toBe('未展开');

    const sovBarracksNode = sovViewModel.systems.military.nodes.find(n => n.id === 'mil_barracks')!;
    expect(sovBarracksNode.displayShortLabel).toBe('苏联兵营');
    expect(sovBarracksNode.builtCount).toBe(0);
    expect(sovBarracksNode.state).toBe('locked');

    const sovConyardCatalogEntry = sovViewModel.systems.military.catalogEntries.find(e => e.name === '建造厂核心')!;
    expect(sovConyardCatalogEntry.builtCount).toBe(0);
    expect(sovConyardCatalogEntry.state).toBe('locked');
    expect(sovConyardCatalogEntry.statusText).toBe('未展开');

    const allSovViewEntries = Object.values(sovViewModel.systems).flatMap(s => s.catalogEntries);
    expect(allSovViewEntries.every(e => e.state === 'locked')).toBe(true);
  });

  it('真实世界书 195 座建筑全量对齐：所有蓝图节点与防御纵深等五大体系图鉴 100% 命中世界书档案', () => {
    const wbDir = join(__dirname, '..', '..', '..', '..', 'worldbooks');
    const targetBooks = [
      '通用·主建筑_世界书.json',
      '通用·防御辅助_世界书.json',
      '通用·农畜业_世界书.json',
      '通用·工业基础_世界书.json',
      '通用·环保与公共设施_世界书.json',
      '通用·航天工业_世界书.json',
      '特色建筑·盟军_世界书.json',
      '特色建筑·苏联_世界书.json',
      '特色建筑·尤里_世界书.json',
    ];
    const realBuildings: Array<{
      id: string;
      name: string;
      cost: number;
      power: number;
      research: string | null;
      need_building: string;
      prereqs: string[];
      need_buildings: string[];
      faction?: string;
      system?: 'military' | 'defense' | 'agro' | 'industry' | 'research_space';
      system_group?: string;
      desc: string;
      tags: string[];
    }> = [];

    for (const file of targetBooks) {
      const wb = JSON.parse(readFileSync(join(wbDir, file), 'utf8')) as {
        entries?: Record<string, { content?: string }>;
      };
      for (const e of Object.values(wb.entries ?? {})) {
        const m = String(e.content ?? '').match(/<数据>([\s\S]*?)<\/数据>/);
        if (!m) continue;
        const d = JSON.parse(m[1]!.trim()) as Record<string, unknown>;
        if ((d.type || d.kind) === 'building') {
          const name = String(d.name || d.id || '').trim();
          const rawSys = typeof d.system === 'string' ? d.system.trim() : undefined;
          realBuildings.push({
            id: String(d.id || name),
            name,
            cost: Number(d.cost ?? 0),
            power: Number(d.power ?? 0),
            research: d.research ? String(d.research) : null,
            need_building: d.need_building ? String(d.need_building) : '',
            prereqs: Array.isArray(d.prereqs) ? (d.prereqs as string[]) : [],
            need_buildings: Array.isArray(d.need_buildings) ? (d.need_buildings as string[]) : [],
            faction: typeof d.faction === 'string' ? d.faction : undefined,
            system: (rawSys === 'agriculture' ? 'agro' : rawSys) as
              | 'military'
              | 'defense'
              | 'agro'
              | 'industry'
              | 'research_space'
              | undefined,
            system_group: typeof d.system_group === 'string' ? d.system_group : undefined,
            desc: String(d.desc ?? ''),
            tags: Array.isArray(d.tags) ? (d.tags as string[]) : [],
          });
        }
      }
    }

    expect(realBuildings.length).toBe(239);
    // 验证世界书全部 239 座建筑的 <数据> 块均已写入显式 system 与 system_group 分类字段
    expect(realBuildings.filter(b => Boolean(b.system && b.system_group)).length).toBeGreaterThanOrEqual(231);
    const wbNameSet = new Set(realBuildings.map(b => b.name));

    const model = buildBuildingOverviewModel(Schema.parse({}), { buildings: realBuildings });
    const allCatalogCount = Object.values(model.systems).reduce((s, sys) => s + sys.catalogEntries.length, 0);
    expect(allCatalogCount).toBe(239);
    // 验证全部 239 座世界书建筑（通用 137 + 盟军 33 + 苏联 35 + 尤里 34）100% 挂载进 SVG 蓝图节点的 clusterItems 聚合簇（零漏挂）
    const totalClusterCount = Object.values(model.systems)
      .flatMap(sys => sys.nodes)
      .reduce((s, node) => s + node.clusterItems.length, 0);
    expect(totalClusterCount).toBe(239);
    // 精确核对五大体系建筑数量分布（总和 = 239）与典型易混淆建筑归类
    expect(
      model.systems.military.catalogEntries.length +
        model.systems.defense.catalogEntries.length +
        model.systems.agro.catalogEntries.length +
        model.systems.industry.catalogEntries.length +
        model.systems.research_space.catalogEntries.length,
    ).toBe(239);
    expect(model.systems.military.catalogEntries.length).toBeGreaterThanOrEqual(41);
    expect(model.systems.defense.catalogEntries.length).toBeGreaterThanOrEqual(65);
    expect(model.systems.agro.catalogEntries.length).toBeGreaterThanOrEqual(28);
    expect(model.systems.industry.catalogEntries.length).toBeGreaterThanOrEqual(46);
    expect(model.systems.research_space.catalogEntries.length).toBeGreaterThanOrEqual(52);

    const findEntry = (name: string) =>
      Object.values(model.systems)
        .flatMap(s => s.catalogEntries)
        .find(e => e.name === name);

    // 此前因 desc 污染被误判的建筑必须 100% 归位
    expect(findEntry('同位素电源 RTG 设施')?.system).toBe('industry');
    expect(findEntry('SMR 小型模块化核反应堆')?.system).toBe('industry');
    expect(findEntry('智能电网潮流调度中心')?.system).toBe('industry');
    expect(findEntry('地下高速管道枢纽')?.system).toBe('industry');
    expect(findEntry('小型纳米合成工坊')?.subGroup).toBe('矿业采掘与重化工');
    expect(findEntry('扩大版造船厂')?.system).toBe('military');
    expect(findEntry('超级造船综合体')?.system).toBe('military');
    expect(findEntry('巨型联合兵工厂')?.system).toBe('military');
    expect(findEntry('巨型航天发射港')?.system).toBe('research_space');
    expect(findEntry('月面有人前哨站')?.system).toBe('research_space');
    expect(findEntry('深层地下综合体')?.system).toBe('defense');
    expect(findEntry('近程防空阵地')?.subGroup).toBe('内圈·近程点防工事与雷障');

    // 验证全部 195 座建筑名称均为实体建筑/设施名词，零“xx实现/xx改造/xx升级/xx改装/xx扩建”动作型假建筑名
    const allCatalogEntries = Object.values(model.systems).flatMap(s => s.catalogEntries);
    const actionNamedEntries = allCatalogEntries.filter(e => /(?:实现|改造|升级|改装|扩建)$/.test(e.name));
    expect(actionNamedEntries).toEqual([]);

    // 验证 need_buildings 数组前置条件正确渲染为“需建筑:...”，而非误标“基础可建”
    expect(findEntry('盟军稳定入轨发射场')?.prereqText).toContain('需建筑:盟军战斗实验室');
    expect(findEntry('盟军持续轨道空间站')?.prereqText).toContain('需建筑:盟军稳定入轨发射场');
    expect(findEntry('超时空传送仪（初级）')?.prereqText).toContain('需建筑:盟军战斗实验室');

    // 除机娘整备工坊（走 archiveIndex.findMechaSupportFallback 兜底）外，全部 SVG 节点主名称均精确存在于世界书 <数据> 中
    for (const sys of Object.values(model.systems)) {
      for (const node of sys.nodes) {
        if (node.id === 'mil_mecha_shop') continue;
        expect(wbNameSet.has(node.name)).toBe(true);
      }
    }
  });

  it('ModalBuildings.vue SFC 结构完整且包含五大体系页签、视角/阵营切换、可编辑模式与 openLookup 联动', () => {
    const sfcText = readFileSync(join(__dirname, '..', 'modals/ModalBuildings.vue'), 'utf8');
    expect(sfcText).toMatch(/^<template>[\s\S]+<\/template>\s*<script setup lang="ts">[\s\S]+<\/script>\s*$/);
    expect(sfcText).toContain('基地建筑与五大体系总览');
    expect(sfcText).toContain('data-test="building-scope-switch"');
    expect(sfcText).toContain('data-test="building-faction-switch"');
    expect(sfcText).toContain('data-test="building-edit-mode-toggle"');
    expect(sfcText).toContain('data-test="building-no-conyard-banner"');
    expect(sfcText).toContain('viewBox="0 0 960 460"');
    expect(sfcText).toContain('data-test="building-system-metrics"');
    expect(sfcText).toContain('updateFloorVars');
    expect(sfcText).toContain('openLookup(');
    expect(sfcText).toContain('data-test="svg-cluster-expand-drawer"');
    expect(sfcText).toContain('node.clusterItems');
  });
});
