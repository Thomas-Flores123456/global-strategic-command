/**
 * fcvBuildAuthority.test.ts —— 三级基地建造权限体系（MCV主基地 / 前哨节点 / FCV现地筑城）与 FCV 机娘核心权能动态扩权测试
 */
import { describe, expect, it } from 'vitest';
import {
  buildDeployFcvOrderText,
  buildDeployOutpostNodeOrderText,
  checkBuildingAllowedByAuthority,
  evaluateBaseBuildAuthority,
  isFcvVehicleName,
  isMainBaseExclusiveBuildingName,
  isMainMcvVehicleName,
  isOutpostNodeVehicleName,
} from '../core/buildAuthority';
import {
  isMcvVehicleName,
  resolveAvailableMcvInFleet,
  resolveBaseConyardFactions,
  checkHasOperationalConyard,
} from '../../中控悬浮窗/console/consoleBuildGridHelpers';
import { buildBuildingOverviewModel } from '../../中控悬浮窗/models/buildingSystemModel';
import { schedulePanelModel } from '../../中控悬浮窗/models/schedulePanelModel';
import { mergeEffectiveCatalog } from '../core/catalogEffective';
import { deployBlockIndexFromCatalog } from '../engines/deploymentEngine';
import { hasFieldConstructionUnitInBase, laneCapacityInBase, LANE_REGISTRY, makeProdParallelLimitFor } from '../engines/productionLanes';
import { settleFloor } from '../engines/settleFloor';
import { parseMessageText } from '../parse/parsePipeline';
import { Schema } from '../core/schema';

describe('FCV-AUTH-01 · 载具分类隔离（MCV vs FCV vs 一次展开前哨车）', () => {
  it('isMainMcvVehicleName / isMcvVehicleName 严格排除前沿基地建设车与前哨基地展开车', () => {
    expect(isMainMcvVehicleName('MCV（盟军）')).toBe(true);
    expect(isMainMcvVehicleName('盟军基地车')).toBe(true);
    expect(isMainMcvVehicleName('苏联MCV')).toBe(true);
    expect(isMainMcvVehicleName('尤里MCV')).toBe(true);

    expect(isMainMcvVehicleName('前沿基地建设车')).toBe(false);
    expect(isMainMcvVehicleName('8.5吨前沿基地建设车（FCV）')).toBe(false);
    expect(isMainMcvVehicleName('前哨基地展开车')).toBe(false);
    expect(isMainMcvVehicleName('苏联前哨展开车')).toBe(false);

    expect(isMcvVehicleName('MCV（盟军）')).toBe(true);
    expect(isMcvVehicleName('前沿基地建设车')).toBe(false);
    expect(isMcvVehicleName('前哨基地展开车')).toBe(false);
  });

  it('isFcvVehicleName 与 isOutpostNodeVehicleName 准确识别各自车型', () => {
    expect(isFcvVehicleName('前沿基地建设车')).toBe(true);
    expect(isFcvVehicleName('8.5吨前沿基地建设车（FCV）本体')).toBe(true);
    expect(isFcvVehicleName('FCV前沿建设车')).toBe(true);
    expect(isFcvVehicleName('MCV（盟军）')).toBe(false);

    expect(isOutpostNodeVehicleName('前哨基地展开车')).toBe(true);
    expect(isOutpostNodeVehicleName('苏联前哨展开车')).toBe(true);
    expect(isOutpostNodeVehicleName('Sputnik勘探车')).toBe(true);
    expect(isOutpostNodeVehicleName('前沿基地建设车')).toBe(false);
  });

  it('resolveAvailableMcvInFleet 不会将车队中的前沿基地建设车误判为主基地 MCV', () => {
    const snapshot = Schema.parse({
      meta: { world_id: 'ra2', date: '1972-05-01', day_count: 1 },
      bases: [],
      forces: {
        vehicles: ['前沿基地建设车', '前哨基地展开车'],
      },
    });
    expect(
      resolveAvailableMcvInFleet({
        snapshot,
        selectedFactionFilter: 'all',
        unlockedFactions: ['allied'],
      }),
    ).toBeNull();
  });
});

describe('FCV-AUTH-02 · 三级基地建造权限（MCV full / 前哨节点 outpost_node / FCV fcv_whitelist）', () => {
  it('Tier 1 (full)：拥有运转中盟军建造厂的主基地具备全套建造权限', () => {
    const snapshot = Schema.parse({
      meta: { world_id: 'ra2', date: '1972-05-01', day_count: 2 },
      bases: [
        {
          id: '白凌主基地',
          name: '白凌主基地',
          location: '1号谷地',
          buildings: [{ name: '盟军建造厂', state: '运转' }],
        },
      ],
    });
    const auth = evaluateBaseBuildAuthority({
      base: snapshot.bases[0],
      snapshot,
    });
    expect(auth.tier).toBe('full');
    expect(auth.canBuild).toBe(true);
    expect([...resolveBaseConyardFactions(snapshot.bases[0], 'allied', auth)]).toContain('allied');

    expect(
      checkBuildingAllowedByAuthority({
        building: { name: '盟军作战实验室', tier: 3, cost: 2000 },
        authority: auth,
      }).allowed,
    ).toBe(true);
    expect(
      checkBuildingAllowedByAuthority({
        building: { name: '天气控制仪', tier: 4, cost: 5000 },
        authority: auth,
      }).allowed,
    ).toBe(true);
  });

  it('Tier 2 (outpost_node)：一次展开前沿节点允许基础供电/采矿精炼/外围防卫点位，拦截兵营/重工/高科/超武', () => {
    const snapshot = Schema.parse({
      meta: { world_id: 'ra2', date: '1972-05-01', day_count: 2 },
      bases: [
        {
          id: '河谷前哨',
          name: '河谷前哨',
          location: '2号河口',
          buildings: [{ name: '一次展开前沿节点', state: '运转' }],
        },
      ],
    });
    const auth = evaluateBaseBuildAuthority({
      base: snapshot.bases[0],
      snapshot,
    });
    expect(auth.tier).toBe('outpost_node');
    expect(auth.canBuild).toBe(true);

    expect(
      checkBuildingAllowedByAuthority({
        building: { name: '盟军发电厂', tier: 1, cost: 800 },
        authority: auth,
      }).allowed,
    ).toBe(true);
    expect(
      checkBuildingAllowedByAuthority({
        building: { name: '盟军矿石精炼厂', tier: 1, cost: 2000 },
        authority: auth,
      }).allowed,
    ).toBe(true);
    expect(
      checkBuildingAllowedByAuthority({
        building: { name: '光棱塔', tier: 2, cost: 1500 },
        authority: auth,
      }).allowed,
    ).toBe(true);
    expect(
      checkBuildingAllowedByAuthority({
        building: { name: '盟军兵营', tier: 1, cost: 500 },
        authority: auth,
      }).allowed,
    ).toBe(false);
    expect(
      checkBuildingAllowedByAuthority({
        building: { name: '盟军战车工厂', tier: 2, cost: 2000 },
        authority: auth,
      }).allowed,
    ).toBe(false);
    expect(
      checkBuildingAllowedByAuthority({
        building: { name: '盟军作战实验室', tier: 3, cost: 2000 },
        authority: auth,
      }).allowed,
    ).toBe(false);
  });

  it('Tier 3 (fcv_whitelist)：单纯前沿工地允许基础供电/T1防御/仓储民生，拦截兵营/战车工厂/高科/超武', () => {
    const snapshot = Schema.parse({
      meta: { world_id: 'ra2', date: '1972-05-01', day_count: 2 },
      bases: [
        {
          id: '矿坑B',
          name: '矿坑B',
          location: '北侧废弃矿区',
          buildings: [{ name: '前沿工地', state: '运转' }],
        },
      ],
    });
    const auth = evaluateBaseBuildAuthority({
      base: snapshot.bases[0],
      snapshot,
    });
    expect(auth.tier).toBe('fcv_whitelist');
    expect(auth.canBuild).toBe(true);

    expect(
      checkBuildingAllowedByAuthority({
        building: { name: '盟军发电厂', tier: 1, cost: 800 },
        authority: auth,
      }).allowed,
    ).toBe(true);
    expect(
      checkBuildingAllowedByAuthority({
        building: { name: '机枪碉堡', tier: 1, cost: 500 },
        authority: auth,
      }).allowed,
    ).toBe(true);
    expect(
      checkBuildingAllowedByAuthority({
        building: { name: '水处理厂', tier: 1, cost: 600 },
        authority: auth,
      }).allowed,
    ).toBe(true);
    // 单纯前沿工地（无机娘特许）不能建战地维修所或模块化营区
    expect(
      checkBuildingAllowedByAuthority({
        building: { name: '战地维修所', tier: 2, cost: 1200 },
        authority: auth,
      }).allowed,
    ).toBe(false);
    expect(
      checkBuildingAllowedByAuthority({
        building: { name: '盟军兵营', tier: 1, cost: 500 },
        authority: auth,
      }).allowed,
    ).toBe(false);
  });
});

describe('FCV-AUTH-03 · FCV 机娘核心权能动态扩权（独立现地筑城 + 工业废墟翻新水电并网）', () => {
  const mkFcvGirlSnapshot = () =>
    Schema.parse({
      meta: { world_id: 'ra2', date: '1972-05-03', day_count: 3 },
      bases: [
        {
          id: '白凌主基地',
          name: '白凌主基地',
          location: '主谷地',
          buildings: [
            { name: '盟军建造厂', state: '运转' },
            { name: '盟军发电厂', state: '运转' },
            { name: '盟军矿石精炼厂', state: '运转' },
            { name: '盟军兵营', state: '运转' },
            { name: '盟军战车工厂', state: '运转' },
          ],
        },
        {
          id: '矿坑B',
          name: '矿坑B',
          location: '外围矿坑B',
          buildings: [],
        },
        {
          id: '水泥厂C',
          name: '水泥厂C',
          location: '废弃水泥厂C',
          buildings: [{ name: '前沿工地', state: '运转' }],
        },
      ],
      forces: {
        girls: [
          {
            name: '筑城机娘·零壹',
            model: '前沿基地建设车',
            faction: 'allied',
            base: '白凌主基地',
            duty: '在外围据点（矿坑B、水泥厂C）独立并行筑城',
            skills: '不占主基地队列的独立现地筑城、工业废墟快速翻新与水电并网',
          },
        ],
        vehicles: ['前沿基地建设车'],
      },
    });

  const fcvDossierMap = {
    '筑城机娘·零壹': {
      name: '筑城机娘·零壹',
      model: '前沿基地建设车',
      specialSkills: [
        {
          name: '不占主基地队列的独立现地筑城',
          tag: '核心权能',
          desc: '依托8.5吨前沿基地建设车本体与量产工兵班，在外围据点（矿坑B、水泥厂C）独立并行建造维修所、营舍、旅馆、水培站与防御碉堡，彻底解放白凌主队列。',
        },
        {
          name: '工业废墟快速翻新与水电并网',
          tag: '核心权能',
          desc: '数日内将废弃矿坑与水泥厂改造为恒温供暖、通水通电的现代化军事前哨与商业驿站。',
        },
      ],
      specialEquipment: [
        {
          name: '8.5吨前沿基地建设车（FCV）本体',
          slot: '专属载具本体',
          desc: '集成纳米喷涂臂、轻钢龙骨成型机、混凝土地坪找平与独立柴油微网接口。',
        },
      ],
    },
  };

  it('即使外围据点（矿坑B）尚未显式写入前沿工地建筑，被 FCV 机娘核心权能点名赋能后也自动激活 fcv_whitelist 独立筑城权限', () => {
    const snapshot = mkFcvGirlSnapshot();
    const mineBase = snapshot.bases[1]!;
    const auth = evaluateBaseBuildAuthority({
      base: mineBase,
      snapshot,
      dossierMap: fcvDossierMap,
    });

    expect(auth.tier).toBe('fcv_whitelist');
    expect(auth.canBuild).toBe(true);
    expect(auth.independentQueue).toBe(true);
    expect(auth.fcvGirl).not.toBeNull();
    expect(auth.fcvGirl?.girlName).toBe('筑城机娘·零壹');
    expect(checkHasOperationalConyard(mineBase, auth)).toBe(true);
    expect([...resolveBaseConyardFactions(mineBase, 'allied', auth)]).toContain('allied');

    // 验证核心权能特许的五类设施全部放行且标记 grantedByGirlSkill = true
    for (const grantedName of [
      '战地维修所',
      '模块化战勤生活营区',
      '生态副食与水循环保障站',
      '机枪碉堡',
      '哨戒炮',
      '盟军发电厂',
      '水处理厂',
    ]) {
      const check = checkBuildingAllowedByAuthority({
        building: { name: grantedName, tier: 1, cost: 800 },
        authority: auth,
      });
      expect(check.allowed).toBe(true);
      expect(check.grantedByGirlSkill).toBe(true);
      expect(check.grantLabel).toContain('筑城机娘·零壹');
    }

    // 验证主基地专属重工/高科/超武依然被严格拦截
    for (const forbiddenName of ['盟军战车工厂', '盟军作战实验室', '空军指挥部', '天气控制仪']) {
      const check = checkBuildingAllowedByAuthority({
        building: { name: forbiddenName, tier: 3, cost: 2000 },
        authority: auth,
      });
      expect(check.allowed).toBe(false);
    }
  });

  it('R28 挂载校验联动：当外围据点有 FCV 机娘赋能时，挂载「战地维修所 / 模块化战勤生活营区 / 生态副食与水循环保障站」静默放行不报 R28', () => {
    const snapshot = mkFcvGirlSnapshot();
    const index = deployBlockIndexFromCatalog({
      productions: [
        {
          name: '前沿基地建设车',
          deploy: {
            into: '前沿工地',
            capabilities: ['build.whitelist'],
            reverse: true,
            whitelist: ['哨戒炮', '防御栅栏', '岗哨炮塔'],
          },
        },
      ],
    });

    const msg = `<战况>
队列:
  - 项目: 战地维修所
    类型: 建造
    基地: 水泥厂C
  - 项目: 模块化战勤生活营区
    类型: 建造
    基地: 水泥厂C
  - 项目: 生态副食与水循环保障站
    类型: 建造
    基地: 水泥厂C
</战况>`;

    const res = parseMessageText(msg, snapshot, { deployIndex: index });
    expect(res.issues.filter(i => i.rule === 'R28')).toHaveLength(0);
    expect(res.data.queues.map(q => q.item)).toEqual([
      '战地维修所',
      '模块化战勤生活营区',
      '生态副食与水循环保障站',
    ]);
  });

  it('buildBuildingOverviewModel 在 FCV 据点视角下准确标记「权能特许」与「权限受限」', () => {
    const snapshot = mkFcvGirlSnapshot();
    const catalog = {
      buildings: [
        { id: 'bld.allied.power', name: '盟军发电厂', faction: 'allied', cost: 800, power: -200, need_buildings: [] },
        {
          id: 'bld.common.repair_bay',
          name: '战地维修所',
          faction: 'common',
          cost: 1200,
          power: 40,
          need_building: '战车工厂',
        },
        {
          id: 'bld.common.living_quarter',
          name: '模块化战勤生活营区',
          faction: 'common',
          cost: 600,
          power: 20,
          need_building: '发电厂',
        },
        {
          id: 'bld.allied.tech_center',
          name: '盟军作战实验室',
          faction: 'allied',
          cost: 2000,
          power: 200,
          need_building: '盟军战车工厂',
        },
      ],
      protocols: [],
    };

    const overview = buildBuildingOverviewModel(snapshot, catalog, {
      scope: 'base',
      activeBaseIndex: 1, // 矿坑B
      dossierMap: fcvDossierMap,
    });

    expect(overview.hasOperationalConyard).toBe(true);
    expect(overview.buildAuthority?.tier).toBe('fcv_whitelist');
    expect(overview.buildAuthority?.independentQueue).toBe(true);

    const allEntries = Object.values(overview.systems).flatMap(s => s.catalogEntries);
    const repairEntry = allEntries.find(e => e.name === '战地维修所');
    expect(repairEntry?.state).toBe('unlocked');
    expect(repairEntry?.statusText).toBe('可建造');
    expect(repairEntry?.grantedByGirlSkill).toBe(true);

    const livingEntry = allEntries.find(e => e.name === '模块化战勤生活营区');
    expect(livingEntry?.state).toBe('unlocked');
    expect(livingEntry?.statusText).toBe('可建造');

    const labEntry = allEntries.find(e => e.name === '盟军作战实验室');
    expect(labEntry?.state).toBe('locked');
    expect(labEntry?.statusText).toBe('权限受限');
    expect(labEntry?.authorityLocked).toBe(true);
  });

  it('buildDeployFcvOrderText 与 buildDeployOutpostNodeOrderText 生成规范展开指令', () => {
    const fcvOrder = buildDeployFcvOrderText('矿坑B', '前沿基地建设车');
    expect(fcvOrder.orderText).toContain('前沿基地建设车');
    expect(fcvOrder.orderText).toContain('前沿工地');
    expect(fcvOrder.orderText).toContain('<部署>');

    const outpostOrder = buildDeployOutpostNodeOrderText('水泥厂C', '前哨基地展开车');
    expect(outpostOrder.orderText).toContain('前哨基地展开车');
    expect(outpostOrder.orderText).toContain('一次展开前沿节点');
  });
});

describe('FCV-AUTH-04 · 实况存档复现：基地驻有 FCV 载具/机娘（无虚拟「前沿工地」建筑条目）时的产线工位容量、日程无滞留与楼层自动升格', () => {
  const mkBase2LiveState = () =>
    Schema.parse({
      meta: { world_id: 'ra2', date: '2042-12-26', day_count: 193 },
      clock: { day: 193, time: '18:45' },
      bases: [
        {
          id: 'base_2',
          name: '三十八号矿坑前哨（道班客栈）',
          location: '恶土东段·5号公路里程碑38号南6km斜井矿坑',
          status: '警戒',
          buildings: [
            { name: '发电厂', state: '运转' },
            { name: '深井泵站与水文净化设施', state: '运转' },
            { name: '战地维修所', state: '运转' },
            { name: '模块化战勤生活营区', state: '运转' },
          ],
          forces: {
            troops: { '战斗工兵（白芷筑城班）': 4 },
            vehicles: ['前沿基地建设车', '前沿基地建设车', 'M1151增强型武装装甲悍马'],
            equipment: {},
          },
        },
      ],
      forces: {
        girls: [
          {
            name: '白芷',
            duty: '外围据点建设总工程师（白凌之妹）',
            hp: '完好',
            base: 'base_2',
            serial: 'FCV-01',
            callsign: '白芷',
            model: '前沿基地建设车',
            seq: '首台原型',
            faction: '盟军',
          },
        ],
        vehicles: ['前沿基地建设车', '前沿基地建设车'],
      },
      queues: [
        {
          type: '建造',
          item: '生态副食与水循环保障站',
          base: 'base_2',
          progress: 75,
          eta: '余1日',
          status: 'queued',
          started_at: '2042-12-21 09:00',
          total_minutes: 5760,
          spent_minutes: 4320,
          qty: 1,
          qty_done: 0,
          cost_paid: true,
          min_days_lock: 0,
          hold: false,
        },
      ],
    });

  it('hasFieldConstructionUnitInBase 与 laneCapacityInBase：识别 base.forces.vehicles 与 forces.girls 中的 FCV，现地筑城开通 lane.main / lane.defense / lane.other_building', () => {
    const state = mkBase2LiveState();
    expect(hasFieldConstructionUnitInBase(state, 'base_2')).toBe(true);

    const mainDef = LANE_REGISTRY.find(d => d.laneId === 'lane.main')!;
    const defDef = LANE_REGISTRY.find(d => d.laneId === 'lane.defense')!;
    const otherDef = LANE_REGISTRY.find(d => d.laneId === 'lane.other_building')!;

    expect(laneCapacityInBase(state, 'base_2', mainDef)).toBe(1);
    expect(laneCapacityInBase(state, 'base_2', defDef)).toBe(1);
    expect(laneCapacityInBase(state, 'base_2', otherDef)).toBe(1);

    const limitFor = makeProdParallelLimitFor(state);
    expect(limitFor({ type: '建造', item: '生态副食与水循环保障站', base: 'base_2' })).toBe(1);
    expect(limitFor({ type: '建造', item: '盟军碉堡', base: 'base_2' })).toBe(1);
    expect(limitFor({ type: '建造', item: '建造厂核心', base: 'base_2' })).toBe(0);
  });

  it('FCV 现地筑城：非军工主建筑可建，军备母体 / 军校 / 科研中枢 / 战略超武 / 巨构按件拦回 0', () => {
    const state = mkBase2LiveState();
    const limitFor = makeProdParallelLimitFor(state);

    for (const allowed of ['发电厂', '盟军发电厂', '苏联磁能反应炉', '矿石精炼厂']) {
      expect(limitFor({ type: '建造', item: allowed, base: 'base_2' }), allowed).toBe(1);
    }

    for (const blocked of [
      '兵营',
      '战车工厂',
      '扩大版自动化战车工厂',
      '空军指挥部',
      '海军造船厂',
      '简易船坞',
      '扩大版造船厂',
      '个人装备制造所',
      '陆军军校',
      '战斗实验室',
      '红星实验设计局综合体',
      '超算中心',
      '量子超算中心',
      '全自动军工综合体',
      '巨型联合兵工厂',
      '国家总动员兵工城',
      '苏维埃工业工厂',
      '超时空传送仪（初级）',
      '铁幕装置',
    ]) {
      expect(limitFor({ type: '建造', item: blocked, base: 'base_2' }), blocked).toBe(0);
    }
  });

  it('正规建造厂锚定后，同类军备母体不再被 FCV 物品级门阻挡', () => {
    const state = mkBase2LiveState();
    const base = state.bases.find(b => b.id === 'base_2')!;
    base.buildings.push({ ...base.buildings[0], name: '盟军建造厂' });
    const limitFor = makeProdParallelLimitFor(state);
    expect(limitFor({ type: '建造', item: '兵营', base: 'base_2' })).toBe(1);
    expect(limitFor({ type: '建造', item: '发电厂', base: 'base_2' })).toBe(1);
  });

  it('isMainBaseExclusiveBuildingName：精确集、阵营前缀剥离与名称启发式同源判定', () => {
    expect(isMainBaseExclusiveBuildingName('兵营')).toBe(true);
    expect(isMainBaseExclusiveBuildingName('盟军兵营')).toBe(true);
    expect(isMainBaseExclusiveBuildingName('小型纳米合成工坊')).toBe(true);
    expect(isMainBaseExclusiveBuildingName('超时空传送仪（初级）')).toBe(true); // 仅启发式命中
    expect(isMainBaseExclusiveBuildingName('苏联磁能反应炉')).toBe(false);
    expect(isMainBaseExclusiveBuildingName('发电厂')).toBe(false);
    expect(isMainBaseExclusiveBuildingName('')).toBe(false);
  });

  it('schedulePanelModel：base_2 的「其他建筑线」容量为 1、stranded 为 false、dualModeSummary.productionCount 为 1，不再误报「缺少对应生产建筑，队列已暂停」', () => {
    const state = mkBase2LiveState();
    const catalog = mergeEffectiveCatalog([]);
    const model = schedulePanelModel(state, catalog);

    const base2Sec = model.bases.find(b => b.key === 'base_2');
    expect(base2Sec).toBeDefined();

    const otherLane = base2Sec?.lanes.find(l => l.key.endsWith('lane.other_building'));
    expect(otherLane).toBeDefined();
    expect(otherLane?.capacity).toBe(1);
    expect(otherLane?.stranded).toBe(false);
    expect(otherLane?.dualModeSummary?.productionCount).toBe(1);
    expect(otherLane?.txns[0]?.endEtaText).not.toBe('待建筑就绪');
  });

  it('settleFloor：base_2 驻有 FCV 时，处于 queued 的「生态副食与水循环保障站」自动升格为 active，且在编 active 项随 Δt 正常推进绝不被误降格', () => {
    const prev = mkBase2LiveState();
    const next = mkBase2LiveState();
    const catalog = mergeEffectiveCatalog([]);

    // 第 1 步：原先因容量 0 滞留为 queued 的项目，在结算时自动升格回 active
    const settled1 = settleFloor(prev, next, '<timePast>1 H</timePast>', { catalog });
    const targetQ1 = settled1.data.queues.find(q => q.item === '生态副食与水循环保障站');
    expect(targetQ1).toBeDefined();
    expect(targetQ1?.status).toBe('active');

    // 第 2 步：升格为 active 后，下一轮 Δt 正常积分推进，且绝不会被步骤 ③′ 误降格回 queued
    const settled2 = settleFloor(settled1.data, settled1.data, '<timePast>1 H</timePast>', { catalog });
    const targetQ2 = settled2.data.queues.find(q => q.item === '生态副食与水循环保障站');
    expect(targetQ2?.status).toBe('active');
    expect(targetQ2?.spent_minutes).toBeGreaterThan(4320);
  });
});

