/**
 * tagFilter.test.ts
 * 中控台多维战术标签检索与分类视图专项单元测试（CTRL-TAG-FILTER-01）
 *
 * 1. §3.5 标签体系与常量契约（10 大主领域 + 11 大战术特征）；
 * 2. 标签推导纯函数 inferItemTags（显式优先、关键词识别、保底映射、去重清洗）；
 * 3. 战术过滤判定纯函数 matchItem（主领域单选/全选、特征交集AND/并集OR、多词模糊检索）；
 * 4. 真实世界书 14 项主建筑（8 项 T1 试点 + 2a 扩建 6 项）数据回环与战术检索；
 * 5. TagFilterBar.vue 紧凑胶囊组件契约与军工暗色风格；
 * 6. ConsoleBuildGrid.vue 战术筛选与网格渲染集成契约。
 */

/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本与世界书 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';
import {
  BUILD_PANEL_GROUPS,
  PRIMARY_DOMAINS,
  PRODUCTION_SUBS,
  SECONDARY_TRAITS,
  SUB_TAB_ICONS,
  inferItemTags,
  inferProductionSubTab,
  isEquipmentProduction,
  matchItem,
  sortBuildGridItems,
  type PrimaryDomain,
  type SecondaryTrait,
} from '../models/tagTaxonomy';
import { parseWorldbookEntries, stripMassProductionSuffix } from '../models/worldbookCatalogParser';

const DIR = join(__dirname, '..');
const TAG_FILTER_BAR_SFC = readFileSync(join(DIR, 'console/TagFilterBar.vue'), 'utf8');
const BUILD_GRID_SFC = readFileSync(join(DIR, 'console/ConsoleBuildGrid.vue'), 'utf8');
const ICON_SFC = readFileSync(join(DIR, '../红警指挥系统/ui/Icon.vue'), 'utf8');
const PILOT_WB_PATH = join(__dirname, '../../../../worldbooks/通用·主建筑_世界书.json');

describe('1. §3.5 标签体系与常量契约', () => {
  it('一级主领域标签（Primary Domains）精准收录 10 大核心领域且无重复', () => {
    expect(PRIMARY_DOMAINS).toHaveLength(10);
    const expectedDomains: PrimaryDomain[] = [
      '资源产出',
      '电力设施',
      '人员相关',
      '载具建造',
      '航天工业',
      '科技建筑',
      '防御工事',
      '物流仓储',
      '公共设施',
      '战略超武',
    ];
    for (const domain of expectedDomains) {
      expect(PRIMARY_DOMAINS).toContain(domain);
    }
    expect(new Set(PRIMARY_DOMAINS).size).toBe(10);
  });

  it('二级战术特征标签（Secondary Traits）精准收录 11 大战术特征且无重复', () => {
    expect(SECONDARY_TRAITS).toHaveLength(11);
    const expectedTraits: SecondaryTrait[] = [
      '重型装甲',
      '轻装快速',
      'C4ISR',
      '态势感知',
      '区域拒止',
      '环境依赖',
      '清洁能源',
      '高危设施',
      '应急储能',
      '机娘专属',
      '战略超武',
    ];
    for (const trait of expectedTraits) {
      expect(SECONDARY_TRAITS).toContain(trait);
    }
    expect(new Set(SECONDARY_TRAITS).size).toBe(11);
  });
});

describe('2. 标签推导纯函数 inferItemTags', () => {
  it('显式优先：条目已有 tags 时原样保留并去重，过滤空白字符串', () => {
    const item = {
      name: '战车工厂',
      tags: ['主建筑', '载具建造', '重型装甲', '陆军核心', '主建筑', '   '],
    };
    const tags = inferItemTags(item);
    expect(tags).toEqual(['主建筑', '载具建造', '重型装甲', '陆军核心']);
  });

  it('关键词推导：资源产出（精炼厂、油井、合成工坊）', () => {
    const tags1 = inferItemTags({ name: '矿石精炼厂', desc: '矿车卸载与提炼矿石成资金' });
    expect(tags1).toContain('资源产出');

    const tags2 = inferItemTags({ name: '油井抽油机', desc: '持续开采地下原油' });
    expect(tags2).toContain('资源产出');
  });

  it('关键词推导：电力设施与清洁/高危/环境特征（发电厂、核反应堆、光伏阵列）', () => {
    const solarTags = inferItemTags({
      name: '光伏阵列',
      desc: '太阳能发电，清洁能源但受昼夜与阴雨天候制约',
    });
    expect(solarTags).toContain('电力设施');
    expect(solarTags).toContain('清洁能源');
    expect(solarTags).toContain('环境依赖');

    const nuclearTags = inferItemTags({
      name: '小型模块化核反应堆(SMR)',
      desc: '核裂变电站，高危设施提供巨额电网输出',
    });
    expect(nuclearTags).toContain('电力设施');
    expect(nuclearTags).toContain('高危设施');
  });

  it('关键词推导：人员相关（兵营、军校、步兵单位）', () => {
    const infantryTags = inferItemTags({ name: '盟军大兵', desc: '单兵步枪与沙袋部署', category: '人员' });
    expect(infantryTags).toContain('人员相关');

    const academyTags = inferItemTags({ name: '陆军军校', desc: '军官深造与战术推演' });
    expect(academyTags).toContain('人员相关');
  });

  it('关键词推导：载具建造与轻重特征（战车工厂、海军船坞、天启坦克、直升机）', () => {
    const tankTags = inferItemTags({
      name: '天启主战坦克',
      desc: '重型装甲与双联重炮，地面决战核心',
      category: '载具',
    });
    expect(tankTags).toContain('载具建造');
    expect(tankTags).toContain('重型装甲');

    const heliTags = inferItemTags({
      name: '黑鹰战机',
      desc: '快速突击空中单位',
      category: '载具',
    });
    expect(heliTags).toContain('载具建造');
    expect(heliTags).toContain('轻装快速');
  });

  it('关键词推导：航天工业与科技建筑（空间站、卫星测控、战斗实验室）', () => {
    const spaceTags = inferItemTags({
      name: '航天发射中心',
      desc: '火箭总装与空间站轨道载荷出射段',
    });
    expect(spaceTags).toContain('航天工业');

    const labTags = inferItemTags({
      name: '战术科研中心',
      desc: '前沿理论探索、雷达空情与C4ISR数据链通讯',
    });
    expect(labTags).toContain('科技建筑');
    expect(labTags).toContain('C4ISR');
    expect(labTags).toContain('态势感知');
  });

  it('关键词推导：防御工事与区域拒止（爱国者防空、光棱塔、雷区）', () => {
    const defTags = inferItemTags({
      name: '爱国者防空阵地',
      desc: '防空导弹拦截网络，提供要地空域区域拒止',
      category: '防辅',
    });
    expect(defTags).toContain('防御工事');
    expect(defTags).toContain('区域拒止');
  });

  it('关键词推导：物流仓储（大宗矿料仓、物资库、战备油罐区）', () => {
    const logTags = inferItemTags({
      name: '战备油罐区',
      desc: '油罐区与大宗矿料仓储，周转枢纽',
    });
    expect(logTags).toContain('物流仓储');
  });

  it('安全兜底：无任何匹配关键词时依据 category 赋予合理主领域标签', () => {
    expect(inferItemTags({ name: '神秘装备', category: '人员' })).toContain('人员相关');
    expect(inferItemTags({ name: '未知车辆', category: '载具' })).toContain('载具建造');
    expect(inferItemTags({ name: '未命名设施', category: '防辅' })).toContain('防御工事');
    expect(inferItemTags({ name: '未知装置' })).toContain('科技建筑');
  });
});

describe('3. 战术过滤判定纯函数 matchItem', () => {
  const sampleItems = [
    {
      name: '战车工厂',
      desc: '生产重型坦克与步兵战车',
      tags: ['主建筑', '载具建造', '重型装甲', '陆军核心'],
      prereq: '需 矿石精炼厂',
    },
    {
      name: '空军指挥部',
      desc: '空中战机调度与空情雷达扫描',
      tags: ['主建筑', '载具建造', '轻装快速', '态势感知'],
      prereq: '需 战车工厂',
    },
    {
      name: '战斗实验室',
      desc: 'T2 前沿实验与科研超算集群，C4ISR 枢纽',
      tags: ['主建筑', '科技建筑', '前沿实验', 'C4ISR'],
      prereq: '需 空军指挥部',
    },
    {
      name: '小型纳米合成工坊',
      desc: '精密纳米制造与日用品织造，应急储能缓冲',
      tags: ['主建筑', '资源产出', '纳米制造', '应急储能'],
      prereq: '需 兵营',
    },
    {
      name: '光伏发电机组',
      desc: '太阳能阵列清洁能源，夜间与阴雨天输出降额',
      tags: ['防辅', '电力设施', '清洁能源', '环境依赖'],
      prereq: '需 发电厂',
    },
  ];

  it('无筛选条件时全数通过', () => {
    for (const item of sampleItems) {
      expect(matchItem(item, {})).toBe(true);
      expect(matchItem(item, { selectedDomain: null, selectedTraits: [], searchQuery: '' })).toBe(true);
    }
  });

  it('主领域单选过滤（精准命中与排除）', () => {
    const res = sampleItems.filter(item => matchItem(item, { selectedDomain: '载具建造' }));
    expect(res.map(i => i.name)).toEqual(['战车工厂', '空军指挥部']);

    const power = sampleItems.filter(item => matchItem(item, { selectedDomain: '电力设施' }));
    expect(power.map(i => i.name)).toEqual(['光伏发电机组']);

    const all = sampleItems.filter(item => matchItem(item, { selectedDomain: '全部' }));
    expect(all).toHaveLength(5);
  });

  it('战术特征并集（OR 模式）：包含任一所选特征即可', () => {
    const res = sampleItems.filter(item =>
      matchItem(item, {
        selectedTraits: ['C4ISR', '态势感知'],
        traitMatchMode: 'or',
      }),
    );
    expect(res.map(i => i.name)).toEqual(['空军指挥部', '战斗实验室']);
  });

  it('战术特征交集（AND 模式）：必须同时满足所有选定特征', () => {
    const andMatch = sampleItems.filter(item =>
      matchItem(item, {
        selectedTraits: ['主建筑', '载具建造', '重型装甲'],
        traitMatchMode: 'and',
      }),
    );
    expect(andMatch.map(i => i.name)).toEqual(['战车工厂']);

    const andFail = sampleItems.filter(item =>
      matchItem(item, {
        selectedTraits: ['主建筑', '清洁能源'],
        traitMatchMode: 'and',
      }),
    );
    expect(andFail).toHaveLength(0);
  });

  it('关键字模糊搜索（名称匹配、描述匹配、前置需求匹配、Tags 匹配）', () => {
    // 按名称
    expect(sampleItems.filter(i => matchItem(i, { searchQuery: '纳米' })).map(i => i.name)).toEqual([
      '小型纳米合成工坊',
    ]);

    // 按描述
    expect(sampleItems.filter(i => matchItem(i, { searchQuery: '超算' })).map(i => i.name)).toEqual(['战斗实验室']);

    // 按前置
    expect(sampleItems.filter(i => matchItem(i, { searchQuery: '兵营' })).map(i => i.name)).toEqual([
      '小型纳米合成工坊',
    ]);

    // 按 Tags
    expect(sampleItems.filter(i => matchItem(i, { searchQuery: '环境依赖' })).map(i => i.name)).toEqual([
      '光伏发电机组',
    ]);
  });

  it('多词联合搜索（空格分隔多词，所有词均须命中）', () => {
    const res = sampleItems.filter(item => matchItem(item, { searchQuery: '战车 重型' }));
    expect(res.map(i => i.name)).toEqual(['战车工厂']);

    const noMatch = sampleItems.filter(item => matchItem(item, { searchQuery: '战车 清洁能源' }));
    expect(noMatch).toHaveLength(0);
  });

  it('复合多维检索（主领域 + 战术特征 + 搜索词组合生效）', () => {
    const res = sampleItems.filter(item =>
      matchItem(item, {
        selectedDomain: '载具建造',
        selectedTraits: ['态势感知'],
        searchQuery: '雷达',
      }),
    );
    expect(res.map(i => i.name)).toEqual(['空军指挥部']);
  });
});

describe('4. 真实世界书 18 项主建筑（8 项 T1 试点 + 2a 扩建 6 项 + D3 Tier0 补块 4 项）数据回环验证', () => {
  it('从《通用·主建筑_世界书.json》中准确解析 18 项主建筑战术 Tags 并完整检索', () => {
    const raw = readFileSync(PILOT_WB_PATH, 'utf8');
    const json = JSON.parse(raw);
    const parsed = parseWorldbookEntries(json);

    expect(parsed.buildings).toHaveLength(40);

    const bldMap = new Map(parsed.buildings.map(b => [b.name, b]));

    // 1. 战车工厂
    const factory = bldMap.get('战车工厂');
    expect(factory?.tags).toEqual(['载具建造', '主建筑', '重型装甲', '陆军核心']);

    // 2. 空军指挥部
    const air = bldMap.get('空军指挥部');
    expect(air?.tags).toEqual(['载具建造', '主建筑', '空军生产', '雷达扫描', '航空枢纽']);

    // 3. 海军造船厂
    const navy = bldMap.get('海军造船厂');
    expect(navy?.tags).toEqual(['载具建造', '主建筑', '海军建造', '船坞码头', '水域设施']);

    // 4. 战斗实验室
    const lab = bldMap.get('战斗实验室');
    expect(lab?.tags).toEqual(['科技建筑', '主建筑', '前沿科研', 'T2入口', '科技核心']);

    // 5. 小型纳米合成工坊
    const nano = bldMap.get('小型纳米合成工坊');
    expect(nano?.tags).toEqual(['资源产出', '主建筑', '纳米制造', '应急储能']);

    // 6. 个人装备制造所
    const gear = bldMap.get('个人装备制造所');
    expect(gear?.tags).toEqual(['载具建造', '主建筑', '轻装武备', '单兵装备', '步兵配套']);

    // 7. 陆军军校
    const academy = bldMap.get('陆军军校');
    expect(academy?.tags).toEqual(['人员相关', '主建筑', '军官培训', '作战条令', '战术推演']);

    // 8. 战地维修所
    const repair = bldMap.get('战地维修所');
    expect(repair?.tags).toEqual(['载具建造', '主建筑', '野战抢修', '战车维保', '装甲整备']);

    // 真实条目过滤验证：主领域为“人员相关”（2a 扩建后含兵营）
    const personnelBuildings = parsed.buildings.filter(b => matchItem(b, { selectedDomain: '人员相关' }));
    expect(personnelBuildings.map(b => b.name)).toContain('兵营');

    // 真实条目过滤验证：特征为“重型装甲”
    const armorBuildings = parsed.buildings.filter(b => matchItem(b, { selectedTraits: ['重型装甲'] }));
    expect(armorBuildings.map(b => b.name)).toContain('战车工厂');

    // 真实条目过滤验证：模糊搜索“维修”
    const repairBuildings = parsed.buildings.filter(b => matchItem(b, { searchQuery: '维修' }));
    // 战地维修所（名称含维修）与战车工厂（描述含基础维修泊位/维修所四成）
    expect(repairBuildings.map(b => b.name)).toContain('战地维修所');
    expect(repairBuildings.map(b => b.name)).toContain('战车工厂');
  });
});

describe('5. TagFilterBar.vue 组件契约与静态规范', () => {
  it('包含搜索输入框、清空按键与全库/本类切换按键', () => {
    expect(TAG_FILTER_BAR_SFC).toMatch(/ra-search-box/);
    expect(TAG_FILTER_BAR_SFC).toMatch(/ra-search-input/);
    expect(TAG_FILTER_BAR_SFC).toMatch(/ra-clear-btn/);
    expect(TAG_FILTER_BAR_SFC).toMatch(/ra-scope-btn/);
    expect(TAG_FILTER_BAR_SFC).toMatch(/toggleScope/);
    expect(TAG_FILTER_BAR_SFC).toMatch(/【全库】/);
    expect(TAG_FILTER_BAR_SFC).toMatch(/【本类】/);
  });

  it('一级领域胶囊栏已移除：领域筛选并入建造面板大类子页签（建造面板改版）', () => {
    expect(TAG_FILTER_BAR_SFC).not.toMatch(/ra-domain-bar/);
    expect(TAG_FILTER_BAR_SFC).not.toMatch(/selectDomain/);
    expect(TAG_FILTER_BAR_SFC).not.toMatch(/PRIMARY_DOMAINS/);
  });

  it('二级战术特征抽屉支持 AND/OR 模式切换与多选胶囊', () => {
    expect(TAG_FILTER_BAR_SFC).toMatch(/ra-trait-matrix/);
    expect(TAG_FILTER_BAR_SFC).toMatch(/SECONDARY_TRAITS/);
    expect(TAG_FILTER_BAR_SFC).toMatch(/toggleTrait/);
    expect(TAG_FILTER_BAR_SFC).toMatch(/并集 OR/);
    expect(TAG_FILTER_BAR_SFC).toMatch(/交集 AND/);
    expect(TAG_FILTER_BAR_SFC).toMatch(/setTraitMatchMode/);
    expect(TAG_FILTER_BAR_SFC).toMatch(/ra-pill--trait-active/);
  });

  it('提供 RESET 快速重置按键与生效筛选条件微条', () => {
    expect(TAG_FILTER_BAR_SFC).toMatch(/ra-reset-btn/);
    expect(TAG_FILTER_BAR_SFC).toMatch(/ra-active-strip/);
    expect(TAG_FILTER_BAR_SFC).toMatch(/ra-tag-chip/);
    expect(TAG_FILTER_BAR_SFC).toMatch(/resetAll/);
    expect(TAG_FILTER_BAR_SFC).toMatch(/\$emit\('reset'\)|emit\('reset'\)/);
  });

  it('Props 与 Emits 遵循 Vue 3 规范并实现响应式同步', () => {
    expect(TAG_FILTER_BAR_SFC).toMatch(/defineProps/);
    expect(TAG_FILTER_BAR_SFC).toMatch(/searchQuery/);
    expect(TAG_FILTER_BAR_SFC).toMatch(/selectedTraits/);
    expect(TAG_FILTER_BAR_SFC).toMatch(/traitMatchMode/);
    expect(TAG_FILTER_BAR_SFC).toMatch(/defineEmits/);
    expect(TAG_FILTER_BAR_SFC).toMatch(/update:searchQuery/);
    expect(TAG_FILTER_BAR_SFC).toMatch(/update:selectedTraits/);
    expect(TAG_FILTER_BAR_SFC).toMatch(/update:traitMatchMode/);
    expect(TAG_FILTER_BAR_SFC).toMatch(/update:scope/);
  });
});

describe('6. ConsoleBuildGrid.vue 战术筛选与网格渲染集成契约', () => {
  it('正确引入 TagFilterBar 组件与 tagTaxonomy 纯函数模块', () => {
    expect(BUILD_GRID_SFC).toMatch(/import TagFilterBar from '(?:\.\.|\.)(?:\/console)?\/TagFilterBar\.vue';/);
    expect(BUILD_GRID_SFC).toMatch(/import \{[\s\S]*?inferItemTags[\s\S]*?matchItem[\s\S]*?\} from '(?:\.\.|\.)(?:\/models)?\/tagTaxonomy';/);
    expect(BUILD_GRID_SFC).toMatch(/<TagFilterBar/);
  });

  it('ConsoleBuildItem 数据结构透传 tags 与 desc 字段', () => {
    expect(BUILD_GRID_SFC).toMatch(
      /export interface ConsoleBuildItem \{[\s\S]*?desc\?: string;[\s\S]*?tags\?: string\[\];/,
    );
  });

  it('在建筑、生产及动态条目编译中全量挂载战术标签', () => {
    expect(BUILD_GRID_SFC).toMatch(
      /const tags = inferItemTags\(\{ name: b\.name, desc: b\.desc, tags: b\.tags \}\);/,
    );
    expect(BUILD_GRID_SFC).toMatch(/const tags = inferItemTags\(\{[\s\S]*?name: cleanName,[\s\S]*?desc: p\.desc/);
    expect(BUILD_GRID_SFC).toMatch(/const tags = inferItemTags\(\{[\s\S]*?name: cleanCodexName,[\s\S]*?desc/);
  });

  it('currentItems 响应式接入 scopedItems 与 matchItem 战术过滤', () => {
    expect(BUILD_GRID_SFC).toMatch(/scopedItems/);
    expect(BUILD_GRID_SFC).toMatch(/matchItem\(item, \{/);
    expect(BUILD_GRID_SFC).toMatch(/selectedTraits: selectedTraits\.value/);
    expect(BUILD_GRID_SFC).toMatch(/traitMatchMode: traitMatchMode\.value/);
    expect(BUILD_GRID_SFC).toMatch(/searchQuery: searchQuery\.value/);
  });

  it('空态指示区分无匹配战术项目与空类别，并提供重置按键', () => {
    expect(BUILD_GRID_SFC).toMatch(/hasActiveFilters \? '未检索到匹配战术项目' : '当前类别暂无可调度项目'/);
    expect(BUILD_GRID_SFC).toMatch(/ra-filter-reset-btn/);
    expect(BUILD_GRID_SFC).toMatch(/resetFilters/);
  });

  it('网格卡片展示首个战术标签胶囊与完整标签 tooltip', () => {
    expect(BUILD_GRID_SFC).toMatch(/ra-card-tag-pill/);
    expect(BUILD_GRID_SFC).toMatch(/item\.tags\[0\]/);
    expect(BUILD_GRID_SFC).toMatch(/item\.tags\?\.join\(', '\)/);
  });

  it('严格守卫原有几何不变量与分页约束', () => {
    // 依然保持行高 60px 与几何计算
    expect(BUILD_GRID_SFC).toMatch(/GRID_ROW_HEIGHT = 60/);
    expect(BUILD_GRID_SFC).toMatch(/GRID_ROW_GAP = 6/);
    expect(BUILD_GRID_SFC).toMatch(/Math\.floor\(\(h \+ GRID_ROW_GAP\) \/ \(GRID_ROW_HEIGHT \+ GRID_ROW_GAP\)\)/);
    // 依然保持固定钉底 footer
    expect(BUILD_GRID_SFC).toMatch(/class="ra-pager flex-none/);
    // 依然测量网格自身 ref
    expect(BUILD_GRID_SFC).toMatch(/ref="gridContainerRef"[^>]*class="ra-grid-area flex-1 min-h-0/);
    // 五大核心页签（基建/工业/科研/防御/生产）由 BUILD_PANEL_GROUPS 单一事实源驱动；巨构已退役并移交工程系统
    expect(BUILD_PANEL_GROUPS.map(g => g.id)).toEqual(['基建', '工业', '科研', '防御', '生产']);
    expect(BUILD_GRID_SFC).toMatch(/BUILD_PANEL_GROUPS/);
    // 生产二级分类由 tagTaxonomy.PRODUCTION_SUBS 单一事实源驱动，SFC 不复活字面量
    expect(BUILD_GRID_SFC).toMatch(/PRODUCTION_SUBS/);
    expect(BUILD_GRID_SFC).not.toMatch(/const PRODUCTION_SUBS\s*=/);
    expect(PRODUCTION_SUBS).toEqual(['人员', '装备', '陆军', '空军', '海军']);
  });
});

describe('7. 装备生产类别（21 号改造：生产页装备子栏）', () => {
  it('PRODUCTION_SUBS 单一事实源：人员之后插装备（人员/装备/陆/空/海军）', () => {
    expect(PRODUCTION_SUBS).toEqual(['人员', '装备', '陆军', '空军', '海军']);
  });

  it('SUB_TAB_ICONS 覆盖装备子栏（ammo）且 Icon 注册表已登记，未知领域仍落 dots 兜底', () => {
    expect(SUB_TAB_ICONS['装备']).toBe('ammo');
    expect(SUB_TAB_ICONS['其他']).toBe('dots');
    expect(ICON_SFC).toContain("name === 'ammo'");
  });

  it('isEquipmentProduction：装备制造所锚定 + 名称关键词双通道', () => {
    // 静态目录三条装备生产项（catalog.ts 个人装备制造所·弹药装具）
    expect(isEquipmentProduction('5.56mm步枪弹 ×2000', '个人装备制造所')).toBe(true);
    expect(isEquipmentProduction('.45ACP手枪弹 ×500', '个人装备制造所')).toBe(true);
    expect(isEquipmentProduction('单兵装具一批', '个人装备制造所')).toBe(true);
    // 名称关键词兜底（动态/无锚定条目；与 productionLanes lane.equipment 推导表同源）
    expect(isEquipmentProduction('外骨骼步兵装具', '兵营')).toBe(true);
    expect(isEquipmentProduction('战术瞄准镜一批')).toBe(true);
    // 非装备不截留：人员/载具/空军归原通道
    expect(isEquipmentProduction('美国大兵', '兵营')).toBe(false);
    expect(isEquipmentProduction('美国大兵（量产体）', '兵营')).toBe(false);
    expect(isEquipmentProduction('M1A1灰熊坦克', '战车工厂')).toBe(false);
    expect(isEquipmentProduction('F-16C战隼', '空军指挥部')).toBe(false);
  });

  it('ConsoleBuildGrid 生产分桶装备先行、codex 装备动态条目不再静默丢弃', () => {
    expect(BUILD_GRID_SFC).toMatch(/inferProductionSubTab\(/);
    expect(BUILD_GRID_SFC).toMatch(/deriveProducibleWithContext\(/);
    expect(BUILD_GRID_SFC).toMatch(/sortBuildGridItems\(/);
    expect(BUILD_GRID_SFC).toMatch(/c\.kind === '装备'/);
    // 生产子栏字面量不得在 SFC 复活（单一事实源红线）
    expect(BUILD_GRID_SFC).not.toMatch(/const PRODUCTION_SUBS\s*=/);
  });

  it('stripMassProductionSuffix：去除生产项目名字中的“量产体/量产型步兵”后缀', () => {
    expect(stripMassProductionSuffix('美国大兵（量产体）')).toBe('美国大兵');
    expect(stripMassProductionSuffix('美国大兵（量产型步兵）')).toBe('美国大兵');
    expect(stripMassProductionSuffix('工程兵（量产体）')).toBe('工程兵');
    expect(stripMassProductionSuffix('医疗兵（量产体）')).toBe('医疗兵');
    expect(stripMassProductionSuffix('侦察兵（量产体）')).toBe('侦察兵');
    expect(stripMassProductionSuffix('间谍（量产体）')).toBe('间谍');
    expect(stripMassProductionSuffix('M1A1灰熊主战坦克')).toBe('M1A1灰熊主战坦克');
  });

  it('inferProductionSubTab 与 sortBuildGridItems：按 人员→装备→陆军→空军→海军、在产状态、解锁层级、职能与造价有序排列', () => {
    expect(inferProductionSubTab({ name: '美国大兵', needBuilding: '兵营' })).toBe('人员');
    expect(inferProductionSubTab({ name: '单兵装具一批', needBuilding: '个人装备制造所' })).toBe('装备');
    expect(inferProductionSubTab({ name: 'M1A1灰熊主战坦克', needBuilding: '战车工厂', rawCategory: 'armor' })).toBe('陆军');
    expect(inferProductionSubTab({ name: 'F-16C战隼多用途战斗机', needBuilding: '空军指挥部', rawCategory: 'air' })).toBe('空军');
    expect(inferProductionSubTab({ name: 'LCS-1自由级近海战斗舰', needBuilding: '海军造船厂', rawCategory: 'naval' })).toBe('海军');

    const unsorted = [
      { name: 'LCS-1自由级近海战斗舰', category: '生产', subCategory: '海军', cost: 20000, unlockTier: 1 },
      { name: '光棱坦克', category: '生产', subCategory: '陆军', cost: 1600, unlockTier: 2 },
      { name: 'M1A1灰熊主战坦克', category: '生产', subCategory: '陆军', cost: 800, unlockTier: 0 },
      { name: '超时空采矿车', category: '生产', subCategory: '陆军', cost: 1400, unlockTier: 0 },
      { name: '单兵装具一批', category: '生产', subCategory: '装备', cost: 120, unlockTier: 0 },
      { name: '制式步枪系列', category: '生产', subCategory: '装备', cost: 40, unlockTier: 0 },
      { name: '医疗兵', category: '生产', subCategory: '人员', cost: 500, unlockTier: 0 },
      { name: '工程兵', category: '生产', subCategory: '人员', cost: 300, unlockTier: 0 },
      { name: '侦察兵', category: '生产', subCategory: '人员', cost: 200, unlockTier: 0 },
      { name: '美国大兵', category: '生产', subCategory: '人员', cost: 200, unlockTier: 0 },
      { name: '盟军反装甲重装步兵', category: '生产', subCategory: '人员', cost: 350, unlockTier: 1 },
    ];

    const sorted = sortBuildGridItems(unsorted).map(i => i.name);
    expect(sorted).toEqual([
      // 人员：Tier 0（主战步兵 -> 侦察 -> 工程 -> 医疗）-> Tier 1
      '美国大兵',
      '侦察兵',
      '工程兵',
      '医疗兵',
      '盟军反装甲重装步兵',
      // 装备：枪械 -> 防护装具
      '制式步枪系列',
      '单兵装具一批',
      // 陆军：Tier 0（采矿车 -> 主战坦克）-> Tier 2（光棱坦克）
      '超时空采矿车',
      'M1A1灰熊主战坦克',
      '光棱坦克',
      // 海军
      'LCS-1自由级近海战斗舰',
    ]);
  });
});

describe('8. ConsoleBuildGrid.vue 双面板双铁律过滤与一键展开 MCV 交互契约（UI-BUILD-GRID-01）', () => {
  it('引入 deriveBuildableWithContext 与 fillHostSendInput 并声明建造厂核心集合', () => {
    expect(BUILD_GRID_SFC).toMatch(/deriveBuildableWithContext/);
    expect(BUILD_GRID_SFC).toMatch(/import \{ fillHostSendInput \} from '(?:\.\.\/)?\.\.\/红警指挥系统\/worldbook\/hostSendInput';/);
    expect(BUILD_GRID_SFC).toMatch(/CONYARD_BUILDING_NAMES/);
    expect(BUILD_GRID_SFC).toMatch(/hasOperationalConyard/);
    expect(BUILD_GRID_SFC).toMatch(/availableMcvInFleet/);
  });

  it('空态区涵盖未展开 MCV 提示、一键展开按钮 data-test="deploy-mcv-btn" 及生产面板未解锁提示', () => {
    expect(BUILD_GRID_SFC).toMatch(/尚未展开建造厂核心（MCV）/);
    expect(BUILD_GRID_SFC).toMatch(/data-test="deploy-mcv-btn"/);
    expect(BUILD_GRID_SFC).toMatch(/handleDeployMcvClick/);
    expect(BUILD_GRID_SFC).toMatch(/当前基地无运转中的建造厂，且车队中暂无可用 MCV 移动基地车/);
    expect(BUILD_GRID_SFC).toMatch(
      /当前类别暂无已解锁可制造项目（需先在基地建成并运转对应生产建筑：兵营 \/ 个人装备制造所 \/ 战车工厂 \/ 空军指挥部 \/ 海军造船厂，并完成前置科技研发）/,
    );
  });

  it('五大主类页签直显二字中文分类名（不裸露尾随数字），建造卡片采用 justify-between + leading-tight 防底行文字裁切，且阵营筛选默认文案为「全阵营」避免双全部撞车', () => {
    expect(BUILD_GRID_SFC).toContain('>{{ tab.label }}</span>');
    expect(BUILD_GRID_SFC).toMatch(/ra-build-card[^"]*justify-between/);
    expect(TAG_FILTER_BAR_SFC).toContain('v-if="!showCompactQuickBar"');
  });
});

