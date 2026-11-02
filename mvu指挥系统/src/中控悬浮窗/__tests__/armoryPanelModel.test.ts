import { describe, expect, it } from 'vitest';
import { Schema } from '../../红警指挥系统/core/schema';
import {
  buildArmoryViewModel,
  deriveGirlHpBadgeAndHeadline,
  parseDossierDataBlock,
  parseExposureGrades,
  parseTroopUnitAndDesignation,
  parseVehicleToken,
  parseWorldbookSections,
  resolveBaseDisplayName,
  type ArmoryDossierInput,
  type ArmorySnapshotLike,
} from '../models/armoryPanelModel';

function createMockTheaterSnapshot(): ArmorySnapshotLike {
  return {
    girls: [
      {
        name: '红叶',
        model: 'XT-09赤霄',
        affection: 78,
        obedience: 88,
        status: '完好',
        duty: '前线突击队长',
        base: '一号基地',
        traits: ['高机动斩击', '热能过载'],
      },
      {
        name: '凛冬',
        model: 'KV-2极寒',
        affection: 64,
        obedience: 92,
        status: '轻损',
        duty: '重装防空火力支点',
        base: '二号基地',
        traits: ['重装甲', '极寒屏障'],
        weapons: '双联装电磁重炮；极寒护盾发生器',
      },
      {
        name: '零音',
        model: 'EW-04幽影',
        affection: 81,
        obedience: 90,
        status: '完好',
        duty: '战区电子侦察',
        base: '',
        traits: ['全域监听'],
      },
    ],
    bases: {
      一号基地: {
        name: '一号基地',
        status: '隐蔽中',
        power: { gen: 300, use: 180 },
        forces: {
          infantry: {
            动员兵: 50,
            战斗工程师: 10,
          },
          vehicles: ['天启坦克(正常)', '天启坦克(受损)', '犀牛坦克(正常) ×2'],
          aircraft: ['基洛夫空艇(正常)', '黑鹰战机(受损)'],
          equipment: {
            外骨骼装甲: 20,
            便携式防空导弹: 15,
          },
        },
      },
      二号基地: {
        name: '二号基地',
        status: '警戒',
        power: { gen: 200, use: 150 },
        forces: {
          infantry: {
            动员兵: 30,
            磁暴步兵: 12,
          },
          vehicles: ['犀牛坦克(受损)', '多功能步兵车(正常)'],
          aircraft: ['黑鹰战机(正常)'],
          equipment: {
            外骨骼装甲: 8,
            高能磁暴线圈: 6,
          },
        },
      },
    },
    queues: [
      {
        type: '生产',
        item: '重装大兵',
        base: '一号基地',
        progress: 60,
        eta: '余2小时',
        status: 'active',
        lane: 'personnel',
      },
      {
        type: '生产',
        item: '幻影坦克',
        base: '二号基地',
        progress: 40,
        eta: '余6小时',
        status: 'active',
        lane: 'land',
      },
      {
        type: '改装',
        item: '赤霄高周波斩舰刀挂载包',
        base: '一号基地',
        progress: 75,
        eta: '余1小时',
        status: 'active',
      },
    ],
  };
}

const MOCK_DOSSIER_MAP: Record<string, ArmoryDossierInput> = {
  红叶: {
    found: true,
    name: '红叶',
    model: 'XT-09赤霄',
    dossierContent: `[机娘·能力档案 | 红叶——XT-09赤霄]
<数据>
型号: XT-09赤霄
武器: 赤霄高周波太刀；微型诱导飞弹舱
技能: 瞬步斩击；热能偏导力场
暴露分档: 🟢 常规武装 / 🔴 极限超频
社会外壳: 北坡运输队护卫领班
</数据>`,
    storyContent: '[剧情·北坡纪事 | 红叶]\n当前驻防一号基地，战备状态良好。',
  },
};

describe('armoryPanelModel · 四维军备管理纯函数投影模型 (ARM-03)', () => {
  it('parseVehicleToken 与 parseDossierDataBlock 正确解析载具状态后缀与 <数据> 块', () => {
    expect(parseVehicleToken('天启坦克(正常)')).toEqual({
      model: '天启坦克',
      count: 1,
      intact: 1,
      damaged: 0,
      statusLabel: '正常',
    });
    expect(parseVehicleToken('犀牛坦克（受损）×3')).toEqual({
      model: '犀牛坦克',
      count: 3,
      intact: 0,
      damaged: 3,
      statusLabel: '受损',
    });

    const data = parseDossierDataBlock(MOCK_DOSSIER_MAP['红叶'].dossierContent);
    expect(data['型号']).toBe('XT-09赤霄');
    expect(data['武器']).toBe('赤霄高周波太刀；微型诱导飞弹舱');
    expect(data['社会外壳']).toBe('北坡运输队护卫领班');
  });

  it('ALL 全局战区视图：汇总基地选项、全部机娘、跨基地步兵求和、载具完好/受损归并与装备/改装队列', () => {
    const snap = createMockTheaterSnapshot();
    const vm = buildArmoryViewModel(snap, 'ALL', MOCK_DOSSIER_MAP);

    expect(vm.baseOptions).toEqual(['ALL', '一号基地', '二号基地']);
    expect(vm.summary.girlsCount).toBe(3);
    expect(vm.summary.personnelCount).toBe(50 + 10 + 30 + 12); // 102
    expect(vm.summary.vehiclesCount).toBe(4 + 2); // 6 台陆装
    expect(vm.summary.aircraftCount).toBe(2 + 1); // 3 架空军
    expect(vm.summary.vehiclesAndAircraftCount).toBe(9);

    // 机娘维度：红叶融合世界书档案详情与 <数据> 挂载
    const hongye = vm.girls.items.find(g => g.name === '红叶');
    expect(hongye).toBeDefined();
    expect(hongye?.affection).toBe(78);
    expect(hongye?.obedience).toBe(88);
    expect(hongye?.base).toBe('一号基地');
    expect(hongye?.shell).toBe('北坡运输队护卫领班');
    expect(hongye?.loadouts).toEqual(['赤霄高周波太刀', '微型诱导飞弹舱']);

    // 战区直属机娘：base 为空时标记为「战区直属」
    const lingyin = vm.girls.items.find(g => g.name === '零音');
    expect(lingyin?.base).toBe('战区直属');

    // 人员维度：动员兵跨基地求和 (50 + 30 = 80) 并保留分布明细
    const conscript = vm.personnel.rows.find(r => r.unitType === '动员兵');
    expect(conscript?.total).toBe(80);
    expect(conscript?.byBase).toEqual([
      { base: '一号基地', count: 50 },
      { base: '二号基地', count: 30 },
    ]);
    expect(vm.personnel.trainingQueues).toHaveLength(1);
    expect(vm.personnel.trainingQueues[0].item).toBe('重装大兵');

    // 载具维度：按型号归并完好与受损台数
    const apocalypse = vm.vehicles.vehicleGroups.find(v => v.model === '天启坦克');
    expect(apocalypse).toMatchObject({ total: 2, intact: 1, damaged: 1 });
    const rhino = vm.vehicles.vehicleGroups.find(v => v.model === '犀牛坦克');
    expect(rhino).toMatchObject({ total: 3, intact: 2, damaged: 1 });
    const blackEagle = vm.vehicles.aircraftGroups.find(v => v.model === '黑鹰战机');
    expect(blackEagle).toMatchObject({ total: 2, intact: 1, damaged: 1 });
    expect(vm.vehicles.intactCount).toBe(6);
    expect(vm.vehicles.damagedCount).toBe(3);

    // 装备维度：外骨骼装甲跨基地求和 (20 + 8 = 28) + 机娘挂载武装 + 改装队列
    const exo = vm.equipment.items.find(e => e.name === '外骨骼装甲');
    expect(exo?.count).toBe(28);
    expect(vm.equipment.girlLoadouts.map(l => l.item)).toEqual([
      '赤霄高周波太刀',
      '微型诱导飞弹舱',
      '双联装电磁重炮',
      '极寒护盾发生器',
    ]);
    expect(vm.equipment.activeQueues).toHaveLength(1);
    expect(vm.equipment.activeQueues[0].item).toBe('赤霄高周波斩舰刀挂载包');
  });

  it('单基地切换（一号基地 vs 二号基地）：严格按作用域过滤机娘、步兵、载具、装备与队列', () => {
    const snap = createMockTheaterSnapshot();
    const vmBase1 = buildArmoryViewModel(snap, '一号基地', MOCK_DOSSIER_MAP);

    // 一号基地机娘：含驻防一号基地的「红叶」与未绑定驻地的战区直属「零音」，排除二号基地的「凛冬」
    expect(vmBase1.girls.items.map(g => g.name)).toEqual(['红叶', '零音']);
    expect(vmBase1.personnel.totalCount).toBe(60);
    expect(vmBase1.personnel.rows.map(r => r.unitType)).toEqual(['动员兵', '战斗工程师']);
    expect(vmBase1.vehicles.totalVehicles).toBe(4);
    expect(vmBase1.vehicles.totalAircraft).toBe(2);
    expect(vmBase1.vehicles.productionQueues).toHaveLength(0); // 幻影坦克在二号基地
    expect(vmBase1.equipment.items.map(e => `${e.name}:${e.count}`)).toEqual([
      '外骨骼装甲:20',
      '便携式防空导弹:15',
    ]);
    expect(vmBase1.equipment.activeQueues).toHaveLength(1);

    const vmBase2 = buildArmoryViewModel(snap, '二号基地', MOCK_DOSSIER_MAP);
    expect(vmBase2.girls.items.map(g => g.name)).toEqual(['凛冬', '零音']);
    expect(vmBase2.personnel.totalCount).toBe(42);
    expect(vmBase2.vehicles.productionQueues).toHaveLength(1);
    expect(vmBase2.vehicles.productionQueues[0].item).toBe('幻影坦克');
    expect(vmBase2.equipment.activeQueues).toHaveLength(0);
  });

  it('空状态：真实机娘为空时 isEmpty=true 且返回空列表，不注入静态示例预设', () => {
    const emptySnap = Schema.parse({});
    const vmDefault = buildArmoryViewModel(emptySnap, 'ALL');

    expect(vmDefault.girls.isEmpty).toBe(true);
    expect(vmDefault.girls.items).toEqual([]);
    expect(vmDefault.summary.girlsCount).toBe(0);
  });

  it('兼容标准 Schema.parse 快照（bases 数组 + forces.girls / forces.troops / forces.vehicles + pending_lore 待入档机娘）', () => {
    const schemaSnap = Schema.parse({
      bases: [{ id: 'b1', name: '北坡主基地', status: '隐蔽中', power: { gen: 120, use: 80 } }],
      forces: {
        girls: [{ name: '白凌', hp: '完好', duty: '中枢调度' }],
        troops: { 动员兵: 25 },
        vehicles: ['灰熊坦克(正常)', '多功能步兵车(受损)'],
      },
      pending_lore: [
        {
          name: '苏研',
          model: 'BIO-02白衣',
          keys: ['苏研', '白衣'],
          shell: '镇卫生院医师',
          weapons: '纳米手术刃',
          skills: '战地急救',
          exposure: '🟢 医疗伪装',
        },
        {
          id: 'fac_01',
          name: '铁幕残部',
          kind: '势力',
        },
      ],
    });

    const vm = buildArmoryViewModel(schemaSnap, 'ALL');
    expect(vm.baseOptions).toEqual(['ALL', '北坡主基地']);
    // 自动纳入 forces.girls 与 pending_lore 中的机娘（并忽略新势力条目）
    expect(vm.girls.items.map(g => g.name)).toEqual(['白凌', '苏研']);
    expect(vm.girls.items.find(g => g.name === '苏研')?.isPending).toBe(true);
    expect(vm.personnel.totalCount).toBe(25);
    expect(vm.personnel.rows[0].byBase).toEqual([{ base: '战区机动直属', count: 25 }]);
    expect(vm.vehicles.totalVehicles).toBe(2);
    expect(vm.vehicles.intactCount).toBe(1);
    expect(vm.vehicles.damagedCount).toBe(1);
  });

  it('FD-37 PKG-D：全局总账 = 各基地驻军 + 战区机动直属 差额守恒，且单基地绝不拿全局兵力假回退', () => {
    const snap: ArmorySnapshotLike = {
      bases: [
        {
          id: 'base_1',
          name: '一号基地',
          forces: {
            troops: { 动员兵: 60 },
            vehicles: ['犀牛坦克(正常)'],
            equipment: { 外骨骼装甲: 20 },
          },
        },
        {
          id: 'base_2',
          name: '二号前哨站',
        },
      ],
      forces: {
        troops: { 动员兵: 100, 防空步兵: 20 },
        vehicles: ['犀牛坦克(正常) ×3', '灰熊坦克(受损)'],
        equipment: { 外骨骼装甲: 30 },
      },
    };

    // 1. ALL 全局视图：各基地驻军 + 战区机动直属差额 = 全局总账
    const vmAll = buildArmoryViewModel(snap, 'ALL');
    expect(vmAll.personnel.totalCount).toBe(120);
    expect(vmAll.unassignedPersonnelCount).toBe(60);
    expect(vmAll.personnel.rows).toEqual([
      {
        unitType: '动员兵',
        total: 100,
        byBase: [
          { base: '一号基地', count: 60 },
          { base: '战区机动直属', count: 40 },
        ],
      },
      {
        unitType: '防空步兵',
        total: 20,
        byBase: [{ base: '战区机动直属', count: 20 }],
      },
    ]);

    expect(vmAll.vehicles.totalVehicles).toBe(4);
    expect(vmAll.unassignedVehicleCount).toBe(3);
    const rhinoAll = vmAll.vehicles.vehicleGroups.find(v => v.model === '犀牛坦克');
    expect(rhinoAll?.total).toBe(3);
    expect(rhinoAll?.byBase).toEqual([
      { base: '一号基地', count: 1, intact: 1, damaged: 0 },
      { base: '战区机动直属', count: 2, intact: 2, damaged: 0 },
    ]);
    const grizzlyAll = vmAll.vehicles.vehicleGroups.find(v => v.model === '灰熊坦克');
    expect(grizzlyAll?.byBase).toEqual([
      { base: '战区机动直属', count: 1, intact: 0, damaged: 1 },
    ]);

    const exoAll = vmAll.equipment.items.find(e => e.name === '外骨骼装甲');
    expect(exoAll?.count).toBe(30);
    expect(exoAll?.byBase).toEqual([
      { base: '一号基地', count: 20 },
      { base: '战区机动直属', count: 10 },
    ]);

    // 2. 一号基地视图：仅展示一号基地自身驻军
    const vmBase1 = buildArmoryViewModel(snap, '一号基地');
    expect(vmBase1.personnel.totalCount).toBe(60);
    expect(vmBase1.personnel.rows).toEqual([
      { unitType: '动员兵', total: 60, byBase: [{ base: '一号基地', count: 60 }] },
    ]);
    expect(vmBase1.vehicles.totalVehicles).toBe(1);
    expect(vmBase1.vehicles.vehicleGroups.map(v => `${v.model}:${v.total}`)).toEqual(['犀牛坦克:1']);

    // 3. 二号前哨站视图（无独立驻军）：诚实返回 0，绝不把全局未分配兵力伪造为二号前哨站驻军
    const vmBase2 = buildArmoryViewModel(snap, '二号前哨站');
    expect(vmBase2.personnel.totalCount).toBe(0);
    expect(vmBase2.personnel.rows).toEqual([]);
    expect(vmBase2.unassignedPersonnelCount).toBe(60);
    expect(vmBase2.vehicles.totalCount).toBe(0);
    expect(vmBase2.vehicles.groups).toEqual([]);
    expect(vmBase2.unassignedVehicleCount).toBe(3);
    expect(vmBase2.equipment.items).toEqual([]);
  });

  it('FD-37 PKG-D：机娘专属座驾映射（assignedGirls）与在册参谋/重要人物（notableCharacters）按驻地收口', () => {
    const snap: ArmorySnapshotLike = {
      bases: [
        {
          id: 'b1',
          name: '北坡主基地',
          forces: {
            vehicles: ['基地车(正常)', '犀牛坦克(正常) ×2', '灰熊坦克(正常)'],
          },
        },
        {
          id: 'b2',
          name: '二号前哨站',
          forces: {
            aircraft: ['黑鹰战机(正常)'],
          },
        },
      ],
      girls: [
        { name: '白凌', model: '机动建设车（盟军）', base: '北坡主基地', status: '完好' },
        { name: '赤星', model: '犀牛主战坦克', base: '北坡主基地', status: '完好' },
        { name: '霜华', model: '黑鹰战机', base: '二号前哨站', status: '完好' },
      ],
      command: {
        adjutants: [
          {
            name: '叶琳娜',
            role: 'staff',
            title: '首席作战参谋',
            faction: '盟军',
            note: '统筹北坡战区日常调度',
          },
        ],
      },
      codex: [
        {
          name: '周镇长',
          kind: '人物',
          desc: '协助筹措地方民生物资',
          params: {
            身份: '北坡镇镇长',
            所属势力: '地方自治会',
            态度: '友善',
            信任度: '82',
            状态: '北坡主基地',
          },
        },
        {
          name: '老铁匠',
          kind: '人物',
          desc: '熟悉矿山暗道走向',
          params: {
            身份: '矿区工头',
            所属势力: '独立矿工',
            态度: '警觉',
            信任度: '45',
            驻地: '二号前哨站',
          },
        },
      ],
    };

    const vmAll = buildArmoryViewModel(snap, 'ALL');
    const mcvGrp = vmAll.vehicles.vehicleGroups.find(v => v.model === '基地车');
    const rhinoGrp = vmAll.vehicles.vehicleGroups.find(v => v.model === '犀牛坦克');
    const grizzlyGrp = vmAll.vehicles.vehicleGroups.find(v => v.model === '灰熊坦克');
    const eagleGrp = vmAll.vehicles.aircraftGroups.find(v => v.model === '黑鹰战机');

    expect(mcvGrp?.assignedGirls).toEqual(['白凌']);
    expect(rhinoGrp?.assignedGirls).toEqual(['赤星']);
    expect(grizzlyGrp?.assignedGirls).toEqual([]);
    expect(eagleGrp?.assignedGirls).toEqual(['霜华']);

    expect(vmAll.notableCharacters.map(c => c.name)).toEqual(['叶琳娜', '周镇长', '老铁匠']);
    expect(vmAll.notableCharacters.find(c => c.name === '周镇长')).toMatchObject({
      name: '周镇长',
      roleOrIdentity: '北坡镇镇长',
      faction: '地方自治会',
      attitude: '友善',
      trust: '82',
      statusOrBase: '北坡主基地',
      desc: '协助筹措地方民生物资',
    });

    // 切换到「北坡主基地」：保留全局参谋叶琳娜 + 驻北坡主基地的周镇长，排除二号前哨站的老铁匠
    const vmBase1 = buildArmoryViewModel(snap, '北坡主基地');
    expect(vmBase1.notableCharacters.map(c => c.name)).toEqual(['叶琳娜', '周镇长']);
  });

  it('暖石防务 #792 真实样例：人员兵力主兵种与括号编制番号双层识别、3基地带班组番号 + 全局带括号注记 = 32人/3类且机动直属=0', () => {
    expect(
      parseTroopUnitAndDesignation('美国大兵（量产战斗步兵·含徐磊/穆勒/宋蕊/周锐/铁楔子）'),
    ).toEqual({
      baseUnit: '美国大兵',
      designation: '量产战斗步兵·含徐磊/穆勒/宋蕊/周锐/铁楔子',
      stemKey: '美国大兵',
    });
    expect(parseTroopUnitAndDesignation('盟军侦察兵（外勤侦察班）')).toEqual({
      baseUnit: '盟军侦察兵',
      designation: '外勤侦察班',
      stemKey: '侦察兵',
    });
    expect(parseTroopUnitAndDesignation('侦察兵')).toEqual({
      baseUnit: '侦察兵',
      designation: '',
      stemKey: '侦察兵',
    });

    const snap792: ArmorySnapshotLike = {
      forces: {
        troops: {
          '美国大兵（量产战斗步兵·含徐磊/穆勒/宋蕊/周锐/铁楔子）': 20,
          '战斗工兵（量产工兵班）': 6,
          '盟军侦察兵（量产侦察班）': 6,
        },
      },
      bases: [
        {
          id: 'base_dark_river',
          name: '暗河地下主基地',
          forces: {
            troops: {
              '美国大兵（突击一班）': 10,
              '盟军侦察兵（外勤侦察班）': 4,
              '战斗工兵（主基地维保组）': 2,
            },
          },
        },
        {
          id: 'base_pit_38',
          name: '三十八号矿坑前哨（道班客栈）',
          forces: {
            troops: {
              '美国大兵（矿坑驻防分队·穆勒领衔）': 5,
              '战斗工兵（白芷筑城班）': 4,
              '盟军侦察兵（外围哨组）': 1,
            },
          },
        },
        {
          id: 'base_rockyridge',
          name: '罗基里奇水泥厂总部（Corp-Bud）',
          forces: {
            troops: {
              '美国大兵（突击二班·徐磊领衔）': 5,
              '盟军侦察兵（公路警戒组）': 1,
            },
          },
        },
      ],
    };

    const vmAll = buildArmoryViewModel(snap792, 'ALL');
    expect(vmAll.unassignedPersonnelCount).toBe(0);
    expect(vmAll.personnel.unassignedCount).toBe(0);
    expect(vmAll.personnel.totalCount).toBe(32);
    expect(vmAll.personnel.rows).toHaveLength(3);
    expect(vmAll.personnel.rows).toEqual([
      {
        unitType: '美国大兵',
        total: 20,
        byBase: [
          { base: '暗河地下主基地（突击一班）', count: 10 },
          { base: '三十八号矿坑前哨（道班客栈）（矿坑驻防分队·穆勒领衔）', count: 5 },
          { base: '罗基里奇水泥厂总部（Corp-Bud）（突击二班·徐磊领衔）', count: 5 },
        ],
      },
      {
        unitType: '盟军侦察兵',
        total: 6,
        byBase: [
          { base: '暗河地下主基地（外勤侦察班）', count: 4 },
          { base: '三十八号矿坑前哨（道班客栈）（外围哨组）', count: 1 },
          { base: '罗基里奇水泥厂总部（Corp-Bud）（公路警戒组）', count: 1 },
        ],
      },
      {
        unitType: '战斗工兵',
        total: 6,
        byBase: [
          { base: '暗河地下主基地（主基地维保组）', count: 2 },
          { base: '三十八号矿坑前哨（道班客栈）（白芷筑城班）', count: 4 },
        ],
      },
    ]);

    const vmDarkRiver = buildArmoryViewModel(snap792, '暗河地下主基地');
    expect(vmDarkRiver.personnel.totalCount).toBe(16);
    expect(vmDarkRiver.personnel.rows).toEqual([
      {
        unitType: '美国大兵',
        total: 10,
        byBase: [{ base: '暗河地下主基地（突击一班）', count: 10 }],
      },
      {
        unitType: '盟军侦察兵',
        total: 4,
        byBase: [{ base: '暗河地下主基地（外勤侦察班）', count: 4 }],
      },
      {
        unitType: '战斗工兵',
        total: 2,
        byBase: [{ base: '暗河地下主基地（主基地维保组）', count: 2 }],
      },
    ]);
  });

  it('FD-54 W1：自动将 base_1 / base_2 等内部基地 ID 解析为基地正式名称（涵盖机娘、挂载、队列、调配与重要人物）', () => {
    const snap: ArmorySnapshotLike = {
      bases: [
        {
          id: 'base_1',
          name: '暗河地下主基地',
          status: '隐蔽运转',
          power: { gen: 500, use: 320 },
        },
        {
          id: 'base_2',
          name: '三十八号矿坑前哨',
          status: '警戒',
          power: { gen: 180, use: 110 },
        },
      ],
      girls: [
        {
          name: '白凌',
          model: '盟军机动建设车（MCV）',
          base: 'base_1',
          status: '完好',
          duty: '基地主控与纳米织造总管',
          weapons: '多维纳米织造阵列；战术护盾发生器',
        },
      ],
      queues: [
        {
          type: '生产',
          item: '美国大兵',
          base: 'base_1',
          progress: 50,
          eta: '余1小时',
          status: 'active',
          lane: 'personnel',
        },
        {
          type: '生产',
          item: '灰熊主战坦克',
          base: 'base_2',
          progress: 30,
          eta: '余3小时',
          status: 'active',
          lane: 'land',
        },
        {
          type: '改装',
          item: '纳米微流道散热模组',
          base: 'base_1',
          progress: 80,
          eta: '余30分',
          status: 'active',
          lane: 'equipment',
        },
      ],
      pending_transfers: [
        {
          id: 'xfer-1',
          unit: '白凌',
          category: 'girls',
          qty: 1,
          from_base: 'base_1',
          to_base: 'base_2',
          total_minutes: 60,
          remaining_minutes: 25,
          method: '地下暗河机动',
        },
      ],
      command: {
        adjutants: [
          {
            name: '萧栖雪',
            role: 'staff',
            title: '首席后勤参谋',
            base: 'base_1',
          },
        ],
      },
      codex: [
        {
          name: '老陈',
          kind: '人物',
          desc: '矿坑联络人',
          params: {
            身份: '矿工代表',
            驻地: 'base_2',
          },
        },
      ],
    };

    const vm = buildArmoryViewModel(snap, 'ALL');
    expect(resolveBaseDisplayName('base_1', vm.basesMeta as never)).toBe('暗河地下主基地');
    expect(resolveBaseDisplayName('', vm.basesMeta as never, '战区直属')).toBe('战区直属');

    // 机娘驻地名已解析为正式名称，且保留 rawBase 供作用域匹配
    const bailing = vm.girls.items[0];
    expect(bailing.base).toBe('暗河地下主基地');
    expect(bailing.rawBase).toBe('base_1');

    // 机娘挂载装备驻地名
    expect(vm.equipment.girlLoadouts.map(l => l.base)).toEqual([
      '暗河地下主基地',
      '暗河地下主基地',
    ]);

    // 三类队列的 base 已解析为基地正式名称
    expect(vm.personnel.trainingQueues[0].base).toBe('暗河地下主基地');
    expect(vm.vehicles.productionQueues[0].base).toBe('三十八号矿坑前哨');
    expect(vm.equipment.activeQueues[0].base).toBe('暗河地下主基地');

    // 在途调配 fromBase / toBase 已解析为基地正式名称
    expect(vm.pendingTransfers[0].fromBase).toBe('暗河地下主基地');
    expect(vm.pendingTransfers[0].toBase).toBe('三十八号矿坑前哨');

    // 重要人物 statusOrBase 已解析为基地正式名称
    expect(vm.notableCharacters.find(c => c.name === '萧栖雪')?.statusOrBase).toBe('暗河地下主基地');
    expect(vm.notableCharacters.find(c => c.name === '老陈')?.statusOrBase).toBe('三十八号矿坑前哨');
  });

  it('FD-54 W1：长句叙事 status 自动分离为 2~3 字 hpBadge 与完整 statusHeadline，短状态保持完好/轻损/重损/离线', () => {
    const longNarrativeStatus =
      '坐镇暗河主基地主控室，逆向拆解圣诞夜缴获的荒坂车载卫星通讯终端，并监控全战区纳米能源管网负载。';
    const derivedLong = deriveGirlHpBadgeAndHeadline(longNarrativeStatus, undefined, '中枢调度');
    expect(derivedLong).toEqual({
      hpBadge: '执勤中',
      statusHeadline: longNarrativeStatus,
    });

    const derivedShortIntact = deriveGirlHpBadgeAndHeadline('完好', '完好', '前线突击队长');
    expect(derivedShortIntact).toEqual({
      hpBadge: '完好',
      statusHeadline: '前线突击队长',
    });

    const derivedDefaultDuty = deriveGirlHpBadgeAndHeadline('完好', '完好', '战区战备待命');
    expect(derivedDefaultDuty).toEqual({
      hpBadge: '完好',
      statusHeadline: '',
    });

    expect(
      deriveGirlHpBadgeAndHeadline('右臂液压回路受损，正在维修坞待修', '轻损', '重装突击'),
    ).toEqual({
      hpBadge: '轻损',
      statusHeadline: '右臂液压回路受损，正在维修坞待修',
    });

    expect(deriveGirlHpBadgeAndHeadline('核心重损大修中', '重损', '火力支点')).toEqual({
      hpBadge: '重损',
      statusHeadline: '核心重损大修中',
    });

    expect(deriveGirlHpBadgeAndHeadline('信号失联', '离线', '外围侦察')).toEqual({
      hpBadge: '离线',
      statusHeadline: '外围侦察',
    });

    const vm = buildArmoryViewModel({
      girls: [
        {
          name: '白凌',
          model: 'MCV',
          status: longNarrativeStatus,
          duty: '基地总管',
          base: '暗河地下主基地',
        },
      ],
    });
    expect(vm.girls.items[0].hpBadge).toBe('执勤中');
    expect(vm.girls.items[0].statusHeadline).toBe(longNarrativeStatus);
    expect(vm.girls.items[0].status).toBe(longNarrativeStatus);
  });

  it('FD-54 W1：parseExposureGrades 与 parseWorldbookSections 结构化解析多档暴露与世界书章节', () => {
    const multiEl =
      'EL-0 (无痕：微距扫描与日用品静默细织) / EL-2 (局部交战：大件整夜满负荷纳米织造) / EL-3 (高烈度展开：MCV本体展开落桩)';
    const grades = parseExposureGrades(multiEl);
    expect(grades).toEqual([
      { code: 'EL-0', label: '无痕：微距扫描与日用品静默细织', tone: 'ok' },
      { code: 'EL-2', label: '局部交战：大件整夜满负荷纳米织造', tone: 'warn' },
      { code: 'EL-3', label: '高烈度展开：MCV本体展开落桩', tone: 'danger' },
    ]);

    const emojiGrades = parseExposureGrades('🟢 常规武装 / 🔴 极限超频');
    expect(emojiGrades).toEqual([
      { code: '常规', label: '常规武装', tone: 'ok' },
      { code: '极限', label: '极限超频', tone: 'danger' },
    ]);

    const sections = parseWorldbookSections(
      '首台原型机总纲说明。\n【机体构造与纳米核心】\n搭载盟军第四代多维纳米织造炉。\n[结构性短板]\n展开落桩期间机动性归零。',
      '当前驻防暗河主基地。\n【北坡防卫纪要】\n成功保障圣诞夜前线物资供应。',
    );
    expect(sections).toEqual([
      {
        title: '机体与能力设定',
        source: 'dossier',
        lines: ['首台原型机总纲说明。'],
      },
      {
        title: '机体构造与纳米核心',
        source: 'dossier',
        lines: ['搭载盟军第四代多维纳米织造炉。'],
      },
      {
        title: '结构性短板',
        source: 'dossier',
        lines: ['展开落桩期间机动性归零。'],
      },
      {
        title: '战史与勤务纪要',
        source: 'story',
        lines: ['当前驻防暗河主基地。'],
      },
      {
        title: '北坡防卫纪要',
        source: 'story',
        lines: ['成功保障圣诞夜前线物资供应。'],
      },
    ]);
  });
});
