import { describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { Schema } from '../core/schema';
import {
  TECH_TIER_T2_ANCHORS,
  TECH_TIER_T3_ANCHORS,
  resolveMaxTechTier,
  techTier,
} from '../engines/researchSlots';
import {
  PROTOCOL_ANCHOR_BUILDINGS,
  factionLabTier,
  isProtocolTierUnlockedByBuildings,
  resolveDailyProtocolPointRate,
  resolveProtocolPointBreakdown,
  scanActiveProtocolBuildings,
} from '../engines/protocolAnchors';
import {
  BUILDING_EQUIVALENTS,
  ROOT_CONYARD_BUILDINGS,
  YURI_ACE_CAPACITY_BUILDINGS,
  evaluateSovietSpecialCapacity,
  evaluateYuriSpecialCapacity,
  setHasEquivalentBuilding,
} from '../core/prerequisitesHelpers';
import {
  CONYARD_BUILDING_NAMES,
  FACTION_PRODUCTION_BUILDING_ALLOWLIST,
  checkBaseHasFactionMotherBuilding,
  inferRunningBuildingFaction,
} from '../../中控悬浮窗/console/consoleBuildGridHelpers';
import {
  DEFAULT_YURI_PROTOCOL_CATALOG,
  YURI_INSTITUTE_DISPLAY_TITLE,
  YURI_TRACK_NAMES,
  buildRawTrackViewsForFaction,
  computeNodeHint,
  resolveYuriInstituteInfo,
} from '../../中控悬浮窗/panels/panelProtocolHelpers';
import PanelProtocol from '../../中控悬浮窗/panels/PanelProtocol.vue';

function buildStateWithBuildings(buildingNames: string[]) {
  return Schema.parse({
    bases: [
      {
        id: 'b1',
        name: '尤里前哨基地',
        status: '运转中',
        buildings: buildingNames.map(name => ({ name, count: 1, state: '运转' })),
      },
    ],
  });
}

describe('YURI-CODE-01 · 尤里科研锚点、协议督导院、母体建筑等价与王牌专库集成单测', () => {
  describe('1. researchSlots.ts 尤里科研阶位锚点与 resolveMaxTechTier', () => {
    it('TECH_TIER_T2_ANCHORS 与 TECH_TIER_T3_ANCHORS 包含尤里研究院与双螺旋科学院正式名及别名', () => {
      expect(TECH_TIER_T2_ANCHORS).toContain('基因测序与心灵谐振研究院');
      expect(TECH_TIER_T2_ANCHORS).toContain('尤里作战实验室');
      expect(TECH_TIER_T2_ANCHORS).toContain('尤里心灵研究实验室');

      expect(TECH_TIER_T3_ANCHORS).toContain('双螺旋生命工程与高维意识科学院');
      expect(TECH_TIER_T3_ANCHORS).toContain('双螺旋生命科学院');
    });

    it('resolveMaxTechTier 与 techTier 正确识别尤里 T2 研究院与 T3 科学院阶位', () => {
      expect(resolveMaxTechTier).toBe(techTier);

      const t1State = buildStateWithBuildings(['尤里建造厂核心', '高能厌氧生化反应炉']);
      expect(resolveMaxTechTier(t1State)).toBe(1);

      const t2State = buildStateWithBuildings(['基因测序与心灵谐振研究院']);
      expect(resolveMaxTechTier(t2State)).toBe(2);

      const t2AliasState = buildStateWithBuildings(['尤里心灵研究实验室']);
      expect(resolveMaxTechTier(t2AliasState)).toBe(2);

      const t3State = buildStateWithBuildings(['基因测序与心灵谐振研究院', '双螺旋生命工程与高维意识科学院']);
      expect(resolveMaxTechTier(t3State)).toBe(3);

      const t3ShortState = buildStateWithBuildings(['双螺旋生命科学院']);
      expect(resolveMaxTechTier(t3ShortState)).toBe(3);
    });
  });

  describe('2. protocolAnchors.ts 尤里协议锚点、多院所协同折算与对口 Tier 门控', () => {
    it('PROTOCOL_ANCHOR_BUILDINGS 注册尤里 T2 研究院 (+0.15/日) 与 T3 双螺旋科学院 (+0.30/日)', () => {
      const yuriT2 = PROTOCOL_ANCHOR_BUILDINGS.find(b => b.id === 'bld.yuri.gene_psychic_institute');
      const yuriT3 = PROTOCOL_ANCHOR_BUILDINGS.find(b => b.id === 'bld.yuri.double_helix_academy');

      expect(yuriT2).toBeDefined();
      expect(yuriT2?.faction).toBe('尤里');
      expect(yuriT2?.tier).toBe(2);
      expect(yuriT2?.dailyRate).toBe(0.15);
      expect(yuriT2?.anchorNames).toEqual([
        '基因测序与心灵谐振研究院',
        '尤里心灵研究实验室',
        '尤里作战实验室',
      ]);

      expect(yuriT3).toBeDefined();
      expect(yuriT3?.faction).toBe('尤里');
      expect(yuriT3?.tier).toBe(3);
      expect(yuriT3?.dailyRate).toBe(0.3);
      expect(yuriT3?.anchorNames).toEqual([
        '双螺旋生命工程与高维意识科学院',
        '双螺旋生命科学院',
      ]);
    });

    it('尤里单院所同系 T3 替代 T2（不叠加），以及苏/盟/尤多阵营院所协同并网 50% 折算', () => {
      // 仅尤里 T2：基础 0.10 + 尤里 T2 0.15 = 0.25
      const yuriT2Only = resolveProtocolPointBreakdown(
        buildStateWithBuildings(['基因测序与心灵谐振研究院']),
      );
      expect(yuriT2Only.scan.yuriT2Lab).toBe(true);
      expect(yuriT2Only.scan.yuriT3Sanctuary).toBe(false);
      expect(yuriT2Only.yuriAxisRate).toBe(0.15);
      expect(yuriT2Only.primaryInstituteRate).toBe(0.15);
      expect(yuriT2Only.secondaryInstituteRate).toBe(0);
      expect(yuriT2Only.totalDailyRate).toBe(0.25);

      // 尤里 T2 + T3 同在：同系 T3(0.30) 替代 T2(0.15)，总计 0.10 + 0.30 = 0.40
      const yuriT2AndT3 = resolveProtocolPointBreakdown(
        buildStateWithBuildings(['基因测序与心灵谐振研究院', '双螺旋生命工程与高维意识科学院']),
      );
      expect(yuriT2AndT3.scan.yuriT2Lab).toBe(true);
      expect(yuriT2AndT3.scan.yuriT3Sanctuary).toBe(true);
      expect(yuriT2AndT3.yuriAxisRate).toBe(0.3);
      expect(yuriT2AndT3.primaryInstituteRate).toBe(0.3);
      expect(yuriT2AndT3.secondaryInstituteRate).toBe(0);
      expect(yuriT2AndT3.totalDailyRate).toBe(0.4);

      // 三阵营同在：苏联 T3(0.30) + 盟军 T2(0.15) + 尤里 T3(0.30)
      // 最高一院 = 0.30，其余两院按 50% 折算 = 0.30 * 0.5 + 0.15 * 0.5 = 0.225，总速率 = 0.10 + 0.30 + 0.225 = 0.625
      const triFaction = resolveProtocolPointBreakdown(
        buildStateWithBuildings([
          '国家战略工程综合体／红星科学城',
          '盟军战斗实验室',
          '双螺旋生命工程与高维意识科学院',
        ]),
      );
      expect(triFaction.sovietAxisRate).toBe(0.3);
      expect(triFaction.alliedAxisRate).toBe(0.15);
      expect(triFaction.yuriAxisRate).toBe(0.3);
      expect(triFaction.primaryInstituteRate).toBe(0.3);
      expect(triFaction.secondaryInstituteRate).toBe(0.225);
      expect(triFaction.scan.crossFactionSynergy).toBe(true);
      expect(triFaction.totalDailyRate).toBe(0.625);
      expect(
        resolveDailyProtocolPointRate(
          buildStateWithBuildings([
            '国家战略工程综合体／红星科学城',
            '盟军战斗实验室',
            '双螺旋生命工程与高维意识科学院',
          ]),
        ),
      ).toBe(0.625);
    });

    it('factionLabTier 与 isProtocolTierUnlockedByBuildings 严格执行尤里 T2/T3 对口门控', () => {
      // 1. 通用战斗实验室可解锁尤里 T2，不可解锁尤里 T3
      const commonScan = scanActiveProtocolBuildings(buildStateWithBuildings(['战斗实验室']));
      expect(factionLabTier(commonScan, '尤里')).toBe(2);
      expect(isProtocolTierUnlockedByBuildings(buildStateWithBuildings(['战斗实验室']), '尤里', 2)).toBe(true);
      expect(isProtocolTierUnlockedByBuildings(buildStateWithBuildings(['战斗实验室']), '尤里', 3)).toBe(false);

      // 2. 基因测序与心灵谐振研究院解锁尤里 T2，不跨阵营解锁苏/盟 T2
      const yuriT2State = buildStateWithBuildings(['基因测序与心灵谐振研究院']);
      expect(isProtocolTierUnlockedByBuildings(yuriT2State, '尤里', 2)).toBe(true);
      expect(isProtocolTierUnlockedByBuildings(yuriT2State, '尤里', 3)).toBe(false);
      expect(isProtocolTierUnlockedByBuildings(yuriT2State, '苏联', 2)).toBe(false);
      expect(isProtocolTierUnlockedByBuildings(yuriT2State, '盟军', 2)).toBe(false);

      // 3. 苏联红星科学城或盟军联合科研节点不可跨阵营解锁尤里 T3，必须双螺旋生命工程与高维意识科学院在场
      const sovAndAllT3State = buildStateWithBuildings([
        '国家战略工程综合体／红星科学城',
        '盟军联合科研与国家工程组织节点',
      ]);
      expect(isProtocolTierUnlockedByBuildings(sovAndAllT3State, '尤里', 3)).toBe(false);

      const yuriT3State = buildStateWithBuildings(['双螺旋生命工程与高维意识科学院']);
      expect(isProtocolTierUnlockedByBuildings(yuriT3State, '尤里', 3)).toBe(true);
      expect(isProtocolTierUnlockedByBuildings(yuriT3State, 'yuri', 3)).toBe(true);
    });
  });

  describe('3. panelProtocolHelpers.ts & PanelProtocol.vue 尤里督导院与三大条令分组', () => {
    it('尤里督导院标题、T1/T2/T3 阶段横幅与三大条令轨道构建正确', () => {
      expect(YURI_INSTITUTE_DISPLAY_TITLE).toBe('◆ 尤里认知与生物工程督导院');
      expect(YURI_TRACK_NAMES).toEqual([
        '神经过载与心控协同',
        '生物机电与夺舍工程',
        '磁流谐振与特种攻城',
      ]);
      expect(DEFAULT_YURI_PROTOCOL_CATALOG).toHaveLength(12);

      const stage0 = resolveYuriInstituteInfo(scanActiveProtocolBuildings(buildStateWithBuildings([])));
      expect(stage0.stage).toBe(0);
      expect(stage0.tier).toBe(1);
      expect(stage0.title).toContain('◆ 尤里认知与生物工程督导院');

      const stage1 = resolveYuriInstituteInfo(
        scanActiveProtocolBuildings(buildStateWithBuildings(['基因测序与心灵谐振研究院'])),
      );
      expect(stage1.stage).toBe(1);
      expect(stage1.tier).toBe(2);
      expect(stage1.title).toBe('◆ 基因测序与心灵谐振研究院 [T2]');

      const stage2 = resolveYuriInstituteInfo(
        scanActiveProtocolBuildings(buildStateWithBuildings(['双螺旋生命工程与高维意识科学院'])),
      );
      expect(stage2.stage).toBe(2);
      expect(stage2.tier).toBe(3);
      expect(stage2.title).toBe('◆ 双螺旋生命工程与高维意识科学院 [T3]');

      const yuriTracks = buildRawTrackViewsForFaction({ faction: '尤里' });
      expect(yuriTracks.map(t => t.name)).toEqual([
        '神经过载与心控协同',
        '生物机电与夺舍工程',
        '磁流谐振与特种攻城',
      ]);
      expect(yuriTracks.every(t => t.nodes.length === 4)).toBe(true);

      const t3Node = yuriTracks[0].nodes.find(n => n.tier === 3)!;
      expect(computeNodeHint(buildStateWithBuildings([]), t3Node)).toContain(
        '需 T3 双螺旋生命工程与高维意识科学院',
      );
    });

    it('PanelProtocol.vue 支持切换到尤里督导院并渲染 T2/T3 横幅与三大条令轨道', async () => {
      const snapshot = {
        ...Schema.parse({
          bases: [
            {
              id: 'b1',
              name: '尤里中枢基地',
              status: '运转中',
              buildings: [{ name: '双螺旋生命工程与高维意识科学院', state: '运转' }],
            },
          ],
        }),
        protocol_points: 3,
      };

      const html = await renderToString(
        createSSRApp({
          render: () =>
            h(PanelProtocol, {
              snapshot,
              initialInstitute: 'yuri',
              initialTrack: '神经过载与心控协同',
            }),
        }),
      );

      expect(html).toContain('data-institute-theme="yuri"');
      expect(html).toContain('data-institute-tab="yuri"');
      expect(html).toContain('尤里认知与生物工程督导院');
      expect(html).toContain('◆ 双螺旋生命工程与高维意识科学院 [T3]');
      expect(html).toContain('神经过载与心控协同');
      expect(html).toContain('生物机电与夺舍工程');
      expect(html).toContain('磁流谐振与特种攻城');
      expect(html).toContain('复制人—心灵控制塔神经并联增幅协议');
    });
  });

  describe('4. prerequisitesHelpers.ts & consoleBuildGridHelpers.ts 尤里母体建筑等价与王牌专库', () => {
    it('BUILDING_EQUIVALENTS 与 setHasEquivalentBuilding 覆盖全部 8 组尤里母体建筑正式名互通关系', () => {
      // 1. 建造厂 <-> 尤里建造厂核心
      expect(ROOT_CONYARD_BUILDINGS.has('尤里建造厂核心')).toBe(true);
      expect(CONYARD_BUILDING_NAMES.has('尤里建造厂核心')).toBe(true);
      expect(setHasEquivalentBuilding(new Set(['尤里建造厂核心']), '建造厂')).toBe(true);
      expect(setHasEquivalentBuilding(new Set(['尤里建造厂核心']), '尤里建造厂')).toBe(true);

      // 2. 发电厂 <-> 高能厌氧生化反应炉 / 深层地热-嗜热菌电化学复合反应堆
      expect(setHasEquivalentBuilding(new Set(['高能厌氧生化反应炉']), '发电厂')).toBe(true);
      expect(setHasEquivalentBuilding(new Set(['深层地热-嗜热菌电化学复合反应堆']), '发电厂')).toBe(true);
      expect(setHasEquivalentBuilding(new Set(['深层地热-嗜热菌电化学复合反应堆']), '高能厌氧生化反应炉')).toBe(true);

      // 3. 兵营 / 尤里兵营 <-> 尤里克隆与新兵训导营
      expect(setHasEquivalentBuilding(new Set(['尤里克隆与新兵训导营']), '兵营')).toBe(true);
      expect(setHasEquivalentBuilding(new Set(['尤里克隆与新兵训导营']), '尤里兵营')).toBe(true);
      expect(setHasEquivalentBuilding(new Set(['尤里兵营']), '尤里克隆与新兵训导营')).toBe(true);

      // 4. 战车工厂 / 尤里战车工厂 <-> 尤里生物机电战车总装厂
      expect(setHasEquivalentBuilding(new Set(['尤里生物机电战车总装厂']), '战车工厂')).toBe(true);
      expect(setHasEquivalentBuilding(new Set(['尤里生物机电战车总装厂']), '尤里战车工厂')).toBe(true);
      expect(setHasEquivalentBuilding(new Set(['尤里战车工厂']), '尤里生物机电战车总装厂')).toBe(true);

      // 5. 海军造船厂 / 船厂 <-> 尤里半潜与仿生造船厂
      expect(setHasEquivalentBuilding(new Set(['尤里半潜与仿生造船厂']), '海军造船厂')).toBe(true);
      expect(setHasEquivalentBuilding(new Set(['尤里半潜与仿生造船厂']), '船厂')).toBe(true);

      // 6. 空指部 / 机场 <-> 神经航空引导盘
      expect(setHasEquivalentBuilding(new Set(['神经航空引导盘']), '空指部')).toBe(true);
      expect(setHasEquivalentBuilding(new Set(['神经航空引导盘']), '机场')).toBe(true);
      expect(setHasEquivalentBuilding(new Set(['神经航空引导盘']), '空军指挥部')).toBe(true);

      // 7. 雷达站 / 作战情报中心 <-> 心灵感应器 / 尤里深层神经态势与防空指挥中心
      expect(setHasEquivalentBuilding(new Set(['心灵感应器']), '雷达站')).toBe(true);
      expect(setHasEquivalentBuilding(new Set(['心灵感应器']), '作战情报中心')).toBe(true);
      expect(setHasEquivalentBuilding(new Set(['尤里深层神经态势与防空指挥中心']), '雷达站')).toBe(true);
      expect(setHasEquivalentBuilding(new Set(['尤里深层神经态势与防空指挥中心']), '作战情报中心')).toBe(true);
      expect(setHasEquivalentBuilding(new Set(['尤里深层神经态势与防空指挥中心']), '心灵感应器')).toBe(true);

      // 8. 战斗实验室 / 尤里心灵研究实验室 <-> 基因测序与心灵谐振研究院
      expect(setHasEquivalentBuilding(new Set(['基因测序与心灵谐振研究院']), '战斗实验室')).toBe(true);
      expect(setHasEquivalentBuilding(new Set(['基因测序与心灵谐振研究院']), '尤里心灵研究实验室')).toBe(true);
      expect(BUILDING_EQUIVALENTS['战斗实验室']).toContain('基因测序与心灵谐振研究院');
    });

    it('尤里三座王牌专库（母脑湿件跨、环形飞碟巢、半潜消磁船坞）容量门控与白名单完备', () => {
      expect(YURI_ACE_CAPACITY_BUILDINGS).toEqual([
        '母脑湿件培育与特装总装跨',
        '环形磁流体飞碟整备与微波充能巢',
        '半潜消磁船坞与龟背重弹装填栈桥',
      ]);

      // 精神控制车泊位校验
      expect(evaluateYuriSpecialCapacity('精神控制车', [], 0, 0).allowed).toBe(false);
      expect(
        evaluateYuriSpecialCapacity('精神控制车', ['母脑湿件培育与特装总装跨'], 0, 0).allowed,
      ).toBe(true);
      expect(
        evaluateYuriSpecialCapacity('精神控制车', ['母脑湿件培育与特装总装跨'], 1, 0).allowed,
      ).toBe(false);

      // 镭射幽浮一舰一巢位校验
      expect(evaluateYuriSpecialCapacity('镭射幽浮', [], 0, 0).allowed).toBe(false);
      expect(
        evaluateYuriSpecialCapacity('镭射幽浮', ['环形磁流体飞碟整备与微波充能巢'], 0, 0).allowed,
      ).toBe(true);
      expect(
        evaluateSovietSpecialCapacity('镭射幽浮', ['环形磁流体飞碟整备与微波充能巢'], 1, 0).allowed,
      ).toBe(false);

      // 深渊母巢巨型潜舰泊位校验
      expect(evaluateYuriSpecialCapacity('深渊母巢双壳体巨型潜水母舰', [], 0, 0).allowed).toBe(false);
      expect(
        evaluateYuriSpecialCapacity(
          '深渊母巢双壳体巨型潜水母舰',
          ['半潜消磁船坞与龟背重弹装填栈桥'],
          0,
          0,
        ).allowed,
      ).toBe(true);

      // consoleBuildGridHelpers.ts yuri 生产母体白名单校验
      const requiredYuriMotherBuildings = [
        '尤里建造厂核心',
        '尤里克隆与新兵训导营',
        '尤里生物机电战车总装厂',
        '尤里半潜与仿生造船厂',
        '神经航空引导盘',
        '基因测序与心灵谐振研究院',
        '双螺旋生命工程与高维意识科学院',
        '母脑湿件培育与特装总装跨',
        '环形磁流体飞碟整备与微波充能巢',
        '半潜消磁船坞与龟背重弹装填栈桥',
      ];
      for (const bName of requiredYuriMotherBuildings) {
        expect(FACTION_PRODUCTION_BUILDING_ALLOWLIST.yuri).toContain(bName);
        expect(inferRunningBuildingFaction(bName)).toBe('yuri');
      }

      const yuriBase = buildStateWithBuildings([
        '尤里建造厂核心',
        '尤里克隆与新兵训导营',
        '神经航空引导盘',
      ]).bases[0];
      expect(
        checkBaseHasFactionMotherBuilding(yuriBase, ['兵营'], 'yuri', new Set(['yuri'])),
      ).toBe(true);
      expect(
        checkBaseHasFactionMotherBuilding(yuriBase, ['空指部'], 'yuri', new Set(['yuri'])),
      ).toBe(true);
    });
  });
});
