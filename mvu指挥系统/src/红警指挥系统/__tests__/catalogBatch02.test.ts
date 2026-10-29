import { describe, expect, it } from 'vitest';
import {
  BUILDINGS,
  FACTION_DEFS,
  RESEARCHES,
  RETROFITS,
  deriveBuildable,
  deriveFactionTiers,
  deriveResearchable,
} from '../core/catalog';

const byName = <T extends { name: string }>(items: T[], name: string): T => {
  const item = items.find(entry => entry.name === name);
  if (!item) throw new Error(`catalog 缺少条目：${name}`);
  return item;
};

describe('Batch 0-2 catalog 数据化迁移', () => {
  it('C4ISR 六项 T2 研究保留世界书费用与机器前置', () => {
    const expected = [
      ['韧性组网通信工学', 1000, [], ['战斗实验室', '情报分析中心']],
      ['多源情报融合工学', 1100, [], ['战斗实验室', '情报分析中心']],
      ['战场欺骗体系工学', 900, [], ['战斗实验室', '情报分析中心']],
      ['空中电子攻击工学', 1300, ['韧性组网通信工学', '先进航电综合工学'], ['战斗实验室', '情报分析中心']],
      ['网络作战工学', 1200, ['韧性组网通信工学'], ['战斗实验室', '情报分析中心']],
      ['全域指挥控制工学', 1800, ['韧性组网通信工学', '多源情报融合工学'], ['战斗实验室', '情报分析中心']],
    ] as const;

    for (const [name, cost, prereqs, needBuildings] of expected) {
      const item = byName(RESEARCHES, name);
      expect(item).toMatchObject({ cost, tier: 2, line: '防御辅助' });
      expect(item.prereqs).toEqual(prereqs);
      expect(item.need_buildings).toEqual(needBuildings);
    }
  });

  it('C4ISR 研究不会越过情报分析中心前置', () => {
    const withoutCenter = deriveResearchable(RESEARCHES, ['先进航电综合工学'], [], ['战斗实验室']);
    expect(withoutCenter.map(item => item.name)).not.toContain('韧性组网通信工学');

    const withCenter = deriveResearchable(RESEARCHES, ['先进航电综合工学'], [], ['战斗实验室', '情报分析中心']);
    expect(withCenter.map(item => item.name)).toContain('韧性组网通信工学');
  });

  it('二十一项可无损承载的建筑保留世界书名称、价格、耗电和研究前置', () => {
    const expected = [
      ['通讯中继桩', 200, 5, null],
      ['网络战中心', 1200, 30, '网络作战工学'],
      ['盟军围墙', 20, 0, null],
      ['反载具障碍带', 150, 0, null],
      ['照明塔', 100, 5, null],
      ['盟军碉堡', 500, 0, null],
      ['哨戒探针阵列', 300, 0, null],
      ['野战物资库', 400, 5, null],
      ['电力分配节点', 300, 0, null],
      ['拟态伪装网', 300, 10, null],
      ['纳米诱饵设施', 200, 5, null],
      ['遥控武器站塔', 600, 15, '自动化火力工学'],
      ['反装甲炮位', 550, 10, '自动化火力工学'],
      ['纳米雷区部署器', 500, 0, '区域封锁工学'],
      ['迫击炮巢', 300, 0, '压制火炮工学'],
      ['半固定榴弹炮阵地', 1200, 15, '压制火炮工学'],
      ['多管火箭炮阵地', 1400, 20, '压制火炮工学'],
      ['强化掩体', 800, 0, '强化工事工学'],
      ['中程防空阵地', 900, 25, '近程防空工学'],
      ['反小型目标近防系统', 700, 20, '近程防空工学'],
      ['法式要塞巨炮', 3500, 100, '要塞重炮工学'],
    ] as const;

    for (const [name, cost, power, research] of expected) {
      expect(byName(BUILDINGS, name)).toMatchObject({ cost, power, research });
    }

    const locked = deriveBuildable(BUILDINGS, ['网络作战工学'], [], []);
    expect(locked.map(item => item.name)).not.toContain('网络战中心');
    const unlocked = deriveBuildable(BUILDINGS, ['网络作战工学'], ['情报分析中心'], []);
    expect(unlocked.map(item => item.name)).toContain('网络战中心');
  });

  it('既有研究与建筑的机器前置不再早于世界书条件放行', () => {
    expect(byName(RESEARCHES, '战场态势感知学').need_buildings).toEqual(['发电厂', '兵营', '哨戒探针阵列']);
    expect(byName(RESEARCHES, '情报分析工学').need_buildings).toEqual(['兵营', '通讯中继桩']);
    expect(byName(RESEARCHES, '前沿保障工学').need_buildings).toEqual(['兵营', '野战物资库']);

    expect(byName(BUILDINGS, '小型纳米合成工坊').need_buildings).toEqual(['兵营', '矿石精炼厂']);
    expect(byName(BUILDINGS, '综合感知塔').need_buildings).toEqual(['发电厂', '兵营', '哨戒探针阵列']);
    expect(byName(BUILDINGS, '情报分析中心').need_buildings).toEqual(['兵营', '通讯中继桩']);
    expect(byName(BUILDINGS, '前线综合后勤站').need_buildings).toEqual(['兵营', '野战物资库']);
  });

  it('八项已落书工程以 retrofit 建模并全部挂靠已存在的 T2 研究', () => {
    const expected = [
      ['海马斯弹药兼容工程', '精密远程投射工学', '小改'],
      ['机动雷达车雷达升级工程', '弹道导弹防御工学', '中改'],
      ['死神协同数据链改装工程', '协同无人作战工学', '小改'],
      ['女武神协同数据链改装工程', '协同无人作战工学', '小改'],
      ['B-52J换发改装工程', '先进航电综合工学', '中改'],
      ['黄蜂级短垂适配改装工程', '多任务隐身平台工学', '大改'],
      ['爱国者阵地增强改装工程', '弹道导弹防御工学', '中改'],
      ['电子战干扰站正式化改装工程', '灵气屏蔽工学', '中改'],
    ] as const;
    const researchNames = new Set(RESEARCHES.map(item => item.name));

    for (const [name, research, grade] of expected) {
      expect(byName(RETROFITS, name)).toMatchObject({ kind: 'retrofit', research, grade });
      expect(researchNames.has(research)).toBe(true);
    }
  });

  it('目录主键在各数据类别内保持唯一，base 研究仍不含 T3 数据', () => {
    for (const items of [RESEARCHES, BUILDINGS, RETROFITS]) {
      const names = items.map(item => item.name);
      expect(new Set(names).size).toBe(names.length);
    }
    expect(RESEARCHES.some(item => item.tier === 3)).toBe(false);
    expect(BUILDINGS.some(item => ['无人系统指挥中心', '先进态势指挥中心'].includes(item.name))).toBe(false);
  });
});

/* ═══════════════ E2b deriveFactionTiers MCV 口径修正（批（八十四）） ═══════════════ */

describe('E2b deriveFactionTiers：世界书实名/legacy 名双兼容，跨阵营护栏不退化', () => {
  const b = (name: string, state = '运转', progress?: number) => ({ name, state, progress });

  it('① 盟军建造厂（世界书实名）在场 → 盟军 tier 推导生效', () => {
    const tiers = deriveFactionTiers(FACTION_DEFS, [b('盟军建造厂')], []);
    expect(tiers).toHaveLength(1);
    expect(tiers[0]).toMatchObject({ faction: '盟军', tier: 1 });
  });

  it('② 苏联/尤里建造厂不误中盟军（盟军无前缀护栏：实名精确等名，禁 includes 写法）', () => {
    const tiers = deriveFactionTiers(FACTION_DEFS, [b('苏联建造厂'), b('尤里建造厂')], []);
    expect(tiers.map(t => t.faction)).toEqual(['苏联', '尤里']);
    expect(tiers.find(t => t.faction === '苏联')).toMatchObject({ tier: 1 });
    expect(tiers.find(t => t.faction === '尤里')).toMatchObject({ tier: 1 });
  });

  it('③ legacy 名「建造厂核心」系仍中（旧存档兼容），且互不跨阵营', () => {
    expect(deriveFactionTiers(FACTION_DEFS, [b('建造厂核心')], []).map(t => t.faction)).toEqual(['盟军']);
    expect(deriveFactionTiers(FACTION_DEFS, [b('苏联建造厂核心')], []).map(t => t.faction)).toEqual(['苏联']);
    expect(deriveFactionTiers(FACTION_DEFS, [b('尤里建造厂核心')], []).map(t => t.faction)).toEqual(['尤里']);
  });

  it('④ 实验室建造中不算建成（tier 保持 1 并提示进度）——既有 state 语义保持一致', () => {
    const building = deriveFactionTiers(FACTION_DEFS, [b('盟军建造厂'), b('战斗实验室', '建造中', 40)], []);
    expect(building[0]).toMatchObject({ faction: '盟军', tier: 1, next: '战斗实验室建造中 40%' });
    const done = deriveFactionTiers(FACTION_DEFS, [b('盟军建造厂'), b('战斗实验室')], []);
    expect(done[0]).toMatchObject({ faction: '盟军', tier: 2 });
  });
});
