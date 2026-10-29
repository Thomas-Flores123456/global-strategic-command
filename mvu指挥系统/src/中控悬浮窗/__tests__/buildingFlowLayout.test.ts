import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';

vi.mock('toastr', () => ({
  default: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../红警指挥系统/composables/useCatalog', () => ({
  useCatalogStore: () => ({
    effectiveCatalog: createMultiFactionMockCatalog(),
  }),
}));

vi.mock('../../红警指挥系统/composables/store', () => ({
  in_tavern: false,
  useDataStore: () => ({
    data: {},
  }),
}));

vi.mock('../../红警指挥系统/ui/Icon.vue', async () => {
  const { h: hh } = await import('vue');
  return { default: { name: 'Icon', props: ['name', 'size'], render: () => hh('span') } };
});

import type { EffectiveCatalog } from '../../红警指挥系统/core/catalogEffective';
import { Schema, type StatData } from '../../红警指挥系统/core/schema';
import ModalBuildings from '../modals/ModalBuildings.vue';
import {
  computeInteractiveBlueprintLayout,
  resolveBlueprintNodeAction,
  YURI_NODE_VARIANT_FALLBACK,
} from '../modals/modalBuildingsHelpers';
import { computeSystemDagreLayout } from '../models/buildingFlowLayout';
import {
  buildBuildingOverviewModel,
  inferBuildingFaction,
  inferConyardFaction,
  resolveAvailableBuildingFactions,
} from '../models/buildingSystemModel';

function createMultiFactionMockCatalog(): EffectiveCatalog {
  return {
    techs: [],
    units: [],
    girlweapons: [],
    protocols: [],
    factionDefs: [
      { id: 'allied', name: '盟军体系' },
      { id: 'soviet', name: '苏联体系' },
      { id: 'yuri', name: '尤里体系' },
      { id: 'rising_sun', name: '升阳帝国' },
    ] as unknown as EffectiveCatalog['factionDefs'],
    buildings: [
      { id: 'b0', name: '建造厂核心', cost: 0, power: 50, faction: 'common', system: 'military' },
      { id: 'b0_yuri', name: '尤里建造厂核心', cost: 0, power: 50, faction: 'yuri', system: 'military' },
      { id: 'b1_common', name: '兵营', cost: 500, power: -10, faction: 'common', system: 'military' },
      {
        id: 'b1',
        name: '尤里克隆与新兵训导营',
        aliases: ['尤里兵营'],
        cost: 500,
        power: -10,
        faction: 'yuri',
        system: 'military',
      },
      { id: 'b1_alias', name: '尤里兵营', cost: 500, power: -10, faction: 'yuri', system: 'military' },
      {
        id: 'b2',
        name: '生物克隆与素体培育中心',
        aliases: ['克隆缸'],
        cost: 2000,
        power: -50,
        faction: 'yuri',
        system: 'military',
        need_building: '尤里克隆与新兵训导营',
      },
      {
        id: 'b2_alias',
        name: '克隆缸',
        cost: 2000,
        power: -50,
        faction: 'yuri',
        system: 'military',
        need_building: '尤里兵营',
      },
      {
        id: 'b3',
        name: '高能厌氧生化反应炉',
        aliases: ['生化反应炉'],
        cost: 600,
        power: 150,
        faction: 'yuri',
        system: 'industry',
      },
      { id: 'b4', name: '奴隶矿场', cost: 1500, power: -20, faction: 'yuri', system: 'industry' },
      {
        id: 'b5',
        name: '心灵控制塔',
        aliases: ['精神控制塔'],
        cost: 1500,
        power: -100,
        faction: 'yuri',
        system: 'defense',
      },
      {
        id: 'b6',
        name: '基因崩解与神经凋亡共振阵列',
        aliases: ['基因突变器'],
        cost: 2500,
        power: -200,
        faction: 'yuri',
        system: 'research_space',
      },
      { id: 'b7', name: '心灵支配仪', cost: 5000, power: -300, faction: 'yuri', system: 'research_space' },
      { id: 'b8', name: '盟军兵营', cost: 500, power: -10, faction: 'allied', system: 'military' },
      { id: 'b9', name: '苏联兵营', cost: 500, power: -10, faction: 'soviet', system: 'military' },
      { id: 'b10', name: '纳米道场', cost: 600, power: -15, faction: 'rising_sun', system: 'military' },
    ],
  };
}

function createYuriBaseSnapshot(): StatData {
  const s = Schema.parse({});
  (s.command as Record<string, unknown>).primary_faction = '尤里';
  (s.command as Record<string, unknown>).unlocked_factions = ['尤里', '盟军', '升阳'];
  s.bases = [
    {
      id: 'base_yuri_1',
      name: '心灵第一前哨',
      location: '恶土深处',
      power: { gen: 200, use: 60 },
      buildings: [
        { name: '尤里建造厂核心', layer: '地面', state: '运转', mode: '生产', accel_scope: 'base' },
        { name: '尤里克隆与新兵训导营', layer: '地面', state: '运转', mode: '生产', accel_scope: 'base' },
        { name: '尤里兵营', layer: '地面', state: '运转', mode: '生产', accel_scope: 'base' },
        { name: '高能厌氧生化反应炉', layer: '地面', state: '运转', mode: '生产', accel_scope: 'base' },
      ],
      defenses: [],
      garrison: {},
      logistics: {},
    },
  ];
  return s;
}

describe('FD-36 基地建筑动态多阵营与 Dagre 自动拓扑引擎测试', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('resolveAvailableBuildingFactions 应内置 全部/盟军/苏联/尤里 并自动发现 DLC 动态阵营', () => {
    const snap = createYuriBaseSnapshot();
    const cat = createMultiFactionMockCatalog();
    const options = resolveAvailableBuildingFactions(snap, cat);
    const ids = options.map(o => o.id);

    expect(ids).toContain('all');
    expect(ids).toContain('allied');
    expect(ids).toContain('soviet');
    expect(ids).toContain('yuri');
    expect(ids).toContain('rising_sun');

    const yuriOpt = options.find(o => o.id === 'yuri');
    expect(yuriOpt?.label).toBe('尤里体系');
    expect(yuriOpt?.shortBadge).toBe('尤');
  });

  it('inferConyardFaction 与 inferBuildingFaction 应精确识别尤里体系与动态阵营建筑', () => {
    expect(inferConyardFaction('尤里建造厂核心')).toBe('yuri');
    expect(inferConyardFaction('心灵前哨站')).toBe('yuri');
    expect(inferBuildingFaction({ name: '高能厌氧生化反应炉' })).toBe('yuri');
    expect(inferBuildingFaction({ name: '奴隶矿场' })).toBe('yuri');
    expect(inferBuildingFaction({ name: '克隆缸' })).toBe('yuri');
    expect(inferBuildingFaction({ name: '心灵控制塔' })).toBe('yuri');
    expect(inferBuildingFaction({ name: '纳米道场', faction: '升阳' })).toBe('rising_sun');
  });

  it('buildBuildingOverviewModel 与 computeInteractiveBlueprintLayout 在 factionFilter="yuri" 下应精确对齐《特色建筑·尤里_世界书.json》真名', () => {
    const snap = createYuriBaseSnapshot();
    const cat = createMultiFactionMockCatalog();
    const overview = buildBuildingOverviewModel(snap, cat, {
      activeBaseIndex: 0,
      scope: 'base',
      factionFilter: 'yuri',
    });

    expect(overview.hasOperationalConyard).toBe(true);
    expect(overview.availableFactions.some(f => f.id === 'yuri')).toBe(true);

    const layout = computeInteractiveBlueprintLayout(overview.systems.military, {
      viewMode: 'cluster',
      factionFilter: 'yuri',
    });
    const conyardNode = layout.nodes.find(n => n.id === 'mil_conyard');
    const barracksNode = layout.nodes.find(n => n.id === 'mil_barracks');
    const academyNode = layout.nodes.find(n => n.id === 'mil_academy');

    expect(YURI_NODE_VARIANT_FALLBACK.mil_conyard?.name).toBe('尤里建造厂核心');
    expect(YURI_NODE_VARIANT_FALLBACK.mil_barracks?.name).toBe('尤里克隆与新兵训导营');
    expect(YURI_NODE_VARIANT_FALLBACK.mil_academy?.name).toBe('生物克隆与素体培育中心');
    expect(YURI_NODE_VARIANT_FALLBACK.ind_power?.name).toBe('高能厌氧生化反应炉');
    expect(YURI_NODE_VARIANT_FALLBACK.rs_chrono?.name).toBe('基因崩解与神经凋亡共振阵列');

    expect(conyardNode?.displayName).toBe('尤里建造厂核心');
    expect(conyardNode?.state).toBe('built');
    expect(barracksNode?.displayName).toBe('尤里克隆与新兵训导营');
    expect(barracksNode?.state).toBe('built');
    expect(academyNode?.displayName).toBe('生物克隆与素体培育中心');
    expect(academyNode?.state).toBe('unlocked');
  });

  it('resolveBlueprintNodeAction 在 clusterItems.length > 1 及 locked 建造厂节点下均应返回非空 lookupName 以立即弹出 DetailDrawer', () => {
    const snap = createYuriBaseSnapshot();
    const cat = createMultiFactionMockCatalog();
    const overview = buildBuildingOverviewModel(snap, cat, {
      activeBaseIndex: 0,
      scope: 'base',
      factionFilter: 'yuri',
    });
    const layout = computeInteractiveBlueprintLayout(overview.systems.military, {
      viewMode: 'cluster',
      factionFilter: 'yuri',
    });

    // 1. 多同簇子建筑节点（clusterItems.length > 1）：点击时既切换展开抽屉，又返回非空 lookupName 立即打开 DetailDrawer
    const barracksNode = layout.nodes.find(n => n.id === 'mil_barracks')!;
    expect(barracksNode.clusterItems.length).toBeGreaterThan(1);
    const actExpand = resolveBlueprintNodeAction(barracksNode, null);
    expect(actExpand.kind).toBe('toggle_cluster');
    if (actExpand.kind === 'toggle_cluster') {
      expect(actExpand.nextExpandedNodeId).toBe('mil_barracks');
      expect(actExpand.lookupName).toBeTruthy();
      expect(['尤里克隆与新兵训导营', '尤里兵营']).toContain(actExpand.lookupName);
    }

    // 2. 切换到未展开的苏联阵营建造厂（state === 'locked'，但存在图鉴条目 clusterItems.length >= 1）：点击应查阅详情而非误填展开指令
    const sovOverview = buildBuildingOverviewModel(snap, cat, {
      activeBaseIndex: 0,
      scope: 'base',
      factionFilter: 'soviet',
    });
    const sovConyard = sovOverview.systems.military.nodes.find(n => n.id === 'mil_conyard')!;
    expect(sovConyard.state).toBe('locked');
    expect(sovConyard.clusterItems.length).toBeGreaterThanOrEqual(1);
    const sovAct = resolveBlueprintNodeAction(sovConyard, null);
    expect(sovAct.kind).not.toBe('deploy_mcv');
    if (sovAct.kind !== 'deploy_mcv') {
      expect(sovAct.lookupName).toBeTruthy();
    }

    // 3. 仅当没有任何图鉴条目（clusterItems.length === 0）且建造厂未展开时，才触发 deploy_mcv
    const emptyConyardAct = resolveBlueprintNodeAction(
      {
        ...sovConyard,
        clusterItems: [],
      },
      null,
    );
    expect(emptyConyardAct.kind).toBe('deploy_mcv');
  });

  it('computeSystemDagreLayout 应支持 cluster 与 expanded 两种 DAG 自动拓扑模式且节点不重叠', () => {
    const snap = createYuriBaseSnapshot();
    const cat = createMultiFactionMockCatalog();
    const overview = buildBuildingOverviewModel(snap, cat, {
      activeBaseIndex: 0,
      scope: 'base',
      factionFilter: 'all',
    });
    const milSystem = overview.systems.military;

    const clusterLayout = computeSystemDagreLayout(milSystem, {
      viewMode: 'cluster',
      factionFilter: 'all',
    });
    expect(clusterLayout.nodes.length).toBe(milSystem.nodes.length);
    expect(clusterLayout.flowNodes.length).toBe(milSystem.nodes.length);
    expect(clusterLayout.edges.length).toBeGreaterThan(0);

    // 校验同层或任意两节点中心坐标不会完全重合
    const coords = new Set(clusterLayout.nodes.map(n => `${n.x},${n.y}`));
    expect(coords.size).toBe(clusterLayout.nodes.length);

    // expanded 模式应自动展开同簇子建筑
    const expandedLayout = computeSystemDagreLayout(milSystem, {
      viewMode: 'expanded',
      factionFilter: 'all',
    });
    expect(expandedLayout.nodes.length).toBeGreaterThan(clusterLayout.nodes.length);
    expect(expandedLayout.nodes.some(n => n.isExpandedChild)).toBe(true);
  });

  it('ModalBuildings.vue SSR 渲染应包含动态视口按钮、尤里/动态阵营胶囊与拓扑切换控件', async () => {
    const snap = createYuriBaseSnapshot();
    const cat = createMultiFactionMockCatalog();
    const app = createSSRApp({
      render: () => h(ModalBuildings, { snapshot: snap, catalog: cat, activeBaseIndex: 0 }),
    });
    const html = await renderToString(app);

    expect(html).toContain('data-test="building-modal-size-btn"');
    expect(html).toContain('data-test="building-faction-switch"');
    expect(html).toContain('尤里体系');
    expect(html).toContain('data-test="building-topology-mode-toggle"');
    expect(html).toContain('data-test="building-canvas-controls"');
    expect(html).toContain('data-test="building-blueprint-svg-wrap"');
  });
});
