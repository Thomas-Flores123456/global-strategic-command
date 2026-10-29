/* eslint-disable import-x/no-nodejs-modules -- 测试内即时编译 SFC 并在 afterAll 清理临时模块 */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import { closeDetail, detail, openLookup } from '../composables/useDetail';
import { Schema } from '../core/schema';
import {
  BUILDING_BEARING_PRESETS,
  buildDrawerInstanceQuickOrder,
  buildSpatialBuildingDispatchOrder,
  resolveAvailableLayerOptions,
  resolveDrawerBuildingInstances,
} from '../ui/detailDrawerBuildingHelpers';

const storeFixture = vi.hoisted(() => ({
  data: null as any,
}));

const catalogFixture = vi.hoisted(() => ({
  buildings: [] as any[],
  productions: [] as any[],
  researches: [] as any[],
  retrofits: [] as any[],
  projects: [] as any[],
  factionDefs: [] as any[],
  protocols: [] as any[],
  effectiveCatalog: undefined as any,
  dynamicCatalog: undefined as any,
}));

const fillHostSendInputMock = vi.hoisted(() => vi.fn((_text: string) => 'textarea' as const));

vi.mock('../composables/store', () => ({ useDataStore: () => storeFixture }));
vi.mock('../composables/useCatalog', () => ({ useCatalogStore: () => catalogFixture }));
vi.mock('../worldbook/hostSendInput', () => ({
  fillHostSendInput: (text: string) => fillHostSendInputMock(text),
}));
vi.mock('toastr', () => ({
  default: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../ui/Icon.vue', async () => {
  const { h: hh } = await import('vue');
  return { default: { name: 'Icon', render: () => hh('span', { class: 'icon-stub' }) } };
});

const DRAWER_PATH = fileURLToPath(new URL('../ui/DetailDrawer.vue', import.meta.url));
const DRAWER_SSR_PATH = fileURLToPath(new URL('../ui/DetailDrawer.__bld_spatial_ssr__.mts', import.meta.url));
const DRAWER_BIND_PATH = fileURLToPath(new URL('../ui/DetailDrawer.__bld_spatial_bind__.mts', import.meta.url));

let bindSeq = 0;

function stripTypeImports(code: string): string {
  return code
    .replace(/^import\s+type\s[^;]*;?[\t ]*$/gm, '')
    .replace(/,\s*type\s+[A-Za-z0-9_$]+/g, '');
}

async function compileSfcComponent(sfcPath: string, outPath: string, id: string): Promise<Record<string, any>> {
  const source = readFileSync(sfcPath, 'utf8');
  const { descriptor, errors } = parse(source, { filename: sfcPath });
  if (errors.length > 0) throw new Error(`SFC 解析失败：${errors.map(String).join('; ')}`);
  const compiled = compileScript(descriptor, {
    id,
    inlineTemplate: true,
    templateOptions: { id, scoped: descriptor.styles.some(s => s.scoped) },
  });
  writeFileSync(outPath, `// @ts-nocheck\n${stripTypeImports(compiled.content)}`, 'utf8');
  return import(`${pathToFileURL(outPath).href}?v=${(bindSeq += 1)}`);
}

async function compileSfcSetup(
  sfcPath: string,
  outPath: string,
  id: string,
  props: Record<string, unknown> = {},
  emit = vi.fn(),
): Promise<{ mod: Record<string, any>; setupState: Record<string, any>; emit: ReturnType<typeof vi.fn> }> {
  const source = readFileSync(sfcPath, 'utf8');
  const { descriptor, errors } = parse(source, { filename: sfcPath });
  if (errors.length > 0) throw new Error(`SFC 解析失败：${errors.map(String).join('; ')}`);
  const compiled = compileScript(descriptor, { id, inlineTemplate: false });
  writeFileSync(outPath, `// @ts-nocheck\n${stripTypeImports(compiled.content)}`, 'utf8');
  const mod = (await import(`${pathToFileURL(outPath).href}?v=${(bindSeq += 1)}`)) as Record<string, any>;
  const setupState = mod.default.setup(props, { emit, expose: vi.fn(), attrs: {}, slots: {} });
  return { mod, setupState, emit };
}

afterAll(() => {
  for (const p of [DRAWER_SSR_PATH, DRAWER_BIND_PATH]) {
    try {
      unlinkSync(p);
    } catch {
      // ignore
    }
  }
});

beforeEach(() => {
  closeDetail();
  fillHostSendInputMock.mockClear();
  catalogFixture.buildings = [];
  catalogFixture.productions = [];
  catalogFixture.researches = [];
  catalogFixture.retrofits = [];
  catalogFixture.projects = [];
  catalogFixture.protocols = [];
  storeFixture.data = Schema.parse({
    bases: [
      {
        id: 'base-1',
        name: '1号主基地',
        status: '运转中',
        buildings: [
          { name: '盟军建造厂', state: '运转', layer: '地表层', coord: { x: 0, y: 0 } },
          {
            name: '盟军发电厂',
            state: '运转',
            layer: '地表层',
            coord: { x: 2, y: 0 },
            addons: ['智能电网潮流调度中心'],
          },
          {
            name: '盟军发电厂',
            state: '受损',
            layer: '地下层',
            bearing: '西北内环 220m (-1.5,+1.5)',
          },
          {
            name: '发电厂',
            state: '建造中',
            layer: '山体空腔',
            progress: 65,
            eta: '余1日',
          },
          {
            name: '盟军战车工厂',
            state: '运转',
            layer: '地表层',
            mode: '生产',
            coord: { x: 4, y: -2 },
          },
        ],
        sectors: [
          { name: '深层核掩体A区', layer: '深层岩洞层', status: '正常', desc: '防钻地弹加固层' },
        ],
      },
    ],
  });
});

describe('FD-39 · PKG-D：建筑详情抽屉在场实例账本与可视化空间选址立项器', () => {
  it('1. resolveDrawerBuildingInstances：准确提取本基地多座同名建筑（含在建、受损、addons、显式坐标与三环自动推导）', () => {
    const base = storeFixture.data.bases[0];
    const instances = resolveDrawerBuildingInstances('盟军发电厂（发电厂）', base);

    expect(instances).toHaveLength(3);

    expect(instances[0]).toMatchObject({
      ordinal: 1,
      buildingIndex: 1,
      name: '盟军发电厂',
      state: '运转',
      layer: '地表层',
      ring: 'inner',
      ringLabel: '内环',
      coord: { x: 2, y: 0 },
      bearingLabel: '正东·200m (+2,0)',
      dualModeCapable: false,
      addons: ['智能电网潮流调度中心'],
    });

    expect(instances[1]).toMatchObject({
      ordinal: 2,
      buildingIndex: 2,
      name: '盟军发电厂',
      state: '受损',
      layer: '地下层',
      ring: 'inner',
      ringLabel: '内环',
      addons: [],
    });
    expect(instances[1].bearingLabel).toContain('(-1.5,+1.5)');

    expect(instances[2]).toMatchObject({
      ordinal: 3,
      buildingIndex: 3,
      name: '发电厂',
      state: '建造中',
      layer: '山体空腔',
      ring: 'inner',
      ringLabel: '内环',
      progress: 65,
      eta: '余1日',
    });

    // 双模建筑（战车工厂）准确识别 dualModeCapable
    const wfInstances = resolveDrawerBuildingInstances('盟军战车工厂', base);
    expect(wfInstances).toHaveLength(1);
    expect(wfInstances[0].dualModeCapable).toBe(true);
    expect(wfInstances[0].mode).toBe('生产');
    expect(wfInstances[0].ringLabel).toBe('中环');
  });

  it('2. resolveAvailableLayerOptions & BUILDING_BEARING_PRESETS：合并标准层位与本基地自定义层位，提供三环八方位预设', () => {
    const base = storeFixture.data.bases[0];
    const layers = resolveAvailableLayerOptions(base);
    expect(layers[0]).toEqual({ value: 'auto', label: '自动/随基地默认层' });
    expect(layers.map(l => l.value)).toEqual(
      expect.arrayContaining(['auto', '地表层', '地下层', '掩体入口', '山体空腔', '深层岩洞层']),
    );

    expect(BUILDING_BEARING_PRESETS[0]).toEqual({
      value: 'auto',
      label: '自动按职能三环布防',
      ring: 'auto',
    });
    expect(BUILDING_BEARING_PRESETS.some(p => p.ring === 'inner' && p.value === '正东内环 200m (+2,0)')).toBe(true);
    expect(BUILDING_BEARING_PRESETS.some(p => p.ring === 'mid' && p.value === '东北中环 450m (+3,+3)')).toBe(true);
    expect(BUILDING_BEARING_PRESETS.some(p => p.ring === 'outer' && p.value === '正北外环 750m (0,+7.5)')).toBe(true);
  });

  it('3. buildSpatialBuildingDispatchOrder & buildDrawerInstanceQuickOrder：覆盖默认无参、空间选址+第2座新建、原位升阶、母体扩建挂载及实例抢修/切模', () => {
    // 场景 A：默认无参（100% 兼容旧格式）
    expect(
      buildSpatialBuildingDispatchOrder({
        buildingTitle: '光棱塔',
      }),
    ).toBe('【指挥官战术指令】批准建造：光棱塔');

    // 场景 B：指定层位 + 三环方位 + 第 2 座新建
    expect(
      buildSpatialBuildingDispatchOrder({
        buildingTitle: '盟军发电厂',
        baseName: '1号主基地',
        strategy: 'new',
        layer: '地下层',
        bearing: '正东内环 200m (+2,0)',
        existingInstanceCount: 1,
      }),
    ).toBe('【指挥官战术指令】批准建造：盟军发电厂（第2座） 基地: 1号主基地 层级: 地下层 方位: 正东内环 200m (+2,0)');

    // 场景 C：双轨原位升阶（upgrade）
    expect(
      buildSpatialBuildingDispatchOrder({
        buildingTitle: '扩大版自动化战车工厂',
        baseName: '1号主基地',
        strategy: 'upgrade',
        upgradeInfo: {
          mode: 'replace',
          standalone: true,
          upgradedName: '扩大版自动化战车工厂',
          hostLabel: '战车工厂 / 盟军战车工厂',
          cost: 3500,
          deltaCost: 1500,
          hasHostInCurrentBase: true,
          matchedHostInBase: '盟军战车工厂',
        },
      }),
    ).toBe('【指挥官战术指令】批准原位升级：将「盟军战车工厂」升阶为 扩大版自动化战车工厂（补差价 $1500） 基地: 1号主基地');

    // 场景 D：母体扩建挂载（addon）
    expect(
      buildSpatialBuildingDispatchOrder({
        buildingTitle: '天启超重总装跨',
        baseName: '1号主基地',
        strategy: 'addon',
        targetHostOrdinal: 1,
        upgradeInfo: {
          mode: 'addon',
          standalone: false,
          upgradedName: '天启超重总装跨',
          hostLabel: '苏联战车工厂',
          cost: 1500,
          deltaCost: 1500,
          hasHostInCurrentBase: true,
          matchedHostInBase: '苏联战车工厂',
        },
      }),
    ).toBe('【指挥官战术指令】批准扩建挂载：在「苏联战车工厂 #1」挂载 天启超重总装跨（费用 $1500） 基地: 1号主基地');

    // 场景 E：单座实例紧急抢修与模式切换
    const sampleInst = {
      name: '盟军发电厂',
      ordinal: 2,
      bearingLabel: '西北·210m (-1.5,+1.5)',
      mode: '生产' as const,
    };
    expect(buildDrawerInstanceQuickOrder(sampleInst, '1号主基地', 'repair')).toBe(
      '【指挥官战术指令】紧急抢修受损建筑：盟军发电厂 #2（西北·210m (-1.5,+1.5)） 基地: 1号主基地',
    );
    expect(buildDrawerInstanceQuickOrder(sampleInst, '1号主基地', 'switch_accel')).toBe(
      '【指挥官战术指令】切换建筑产线模式：将「盟军发电厂 #2」切换为【加速】模式 基地: 1号主基地',
    );
  });

  it('4. useDetail.openLookup：命中建筑目录时自动注入【防务圈层】参数', () => {
    catalogFixture.buildings = [
      { name: '盟军发电厂', cost: 800, power: -200, desc: '基础电力设施' },
      { name: '光棱塔', cost: 1200, power: 75, desc: '高能光束防御塔' },
      { name: '盟军战车工厂', cost: 2000, power: 100, desc: '装甲载具产线母体' },
      { name: '盟军建造厂', cost: 3000, power: 0, desc: '基地展开核心' },
    ];

    openLookup('盟军发电厂', []);
    expect(detail.data?.params).toContainEqual(['防务圈层', '内环（能源科研中枢）']);

    openLookup('光棱塔', []);
    expect(detail.data?.params).toContainEqual(['防务圈层', '外环（防线超武工事）']);

    openLookup('盟军战车工厂', []);
    expect(detail.data?.params).toContainEqual(['防务圈层', '中环（产线后勤母体）']);

    openLookup('盟军建造厂', []);
    expect(detail.data?.params).toContainEqual(['防务圈层', '核心（MCV原点）']);
  });

  it('5. DetailDrawer.vue：打开建筑详情时渲染在场实例账本、受损抢修按钮、双模切换按钮与底部空间选址立项器并闭环派发指令', async () => {
    catalogFixture.buildings = [
      { name: '盟军发电厂', cost: 800, power: -200, desc: '基础电力设施' },
      { name: '盟军战车工厂', cost: 2000, power: 100, desc: '装甲载具产线母体' },
      {
        name: '扩大版自动化战车工厂',
        cost: 3500,
        power: 200,
        standalone: true,
        host_building: ['盟军战车工厂', '战车工厂'],
        upgrade_mode: 'replace',
        upgraded_name: '扩大版自动化战车工厂',
        desc: '双轨高阶战车工厂',
      },
    ];

    openLookup('盟军发电厂', []);
    const drawerMod = await compileSfcComponent(DRAWER_PATH, DRAWER_SSR_PATH, 'drawerspatialssr1');
    const html = await renderToString(createSSRApp({ render: () => h(drawerMod.default as Component) }));

    expect(html).toContain('data-test="drawer-building-instances"');
    expect(html).toContain('data-test="drawer-building-instance-item"');
    expect(html).toContain('data-test="drawer-instance-repair-btn"');
    expect(html).toContain('智能电网潮流调度中心');
    expect(html).toContain('建造中 65% 余1日');
    expect(html).toContain('data-test="drawer-building-spatial-config"');
    expect(html).toContain('data-test="drawer-construct-strategy"');
    expect(html).toContain('data-test="drawer-layer-select"');
    expect(html).toContain('data-test="drawer-bearing-select"');
    expect(html).toContain('data-test="drawer-custom-bearing-input"');

    // 验证 setup 交互：受损实例抢修按钮与空间选址立项下达
    const { setupState } = await compileSfcSetup(DRAWER_PATH, DRAWER_BIND_PATH, 'drawerspatialbind1');
    expect(setupState.currentBaseInstances.value).toHaveLength(3);

    const damagedInst = setupState.currentBaseInstances.value[1];
    setupState.handleInstanceRepair(damagedInst);
    expect(fillHostSendInputMock).toHaveBeenLastCalledWith(
      expect.stringContaining('【指挥官战术指令】紧急抢修受损建筑：盟军发电厂 #2'),
    );

    // 重新打开建筑详情并设置空间选址参数后点击下达部署指令
    openLookup('盟军发电厂', []);
    setupState.selectedLayer.value = '地下层';
    setupState.selectedBearing.value = '正东内环 200m (+2,0)';
    setupState.handleDispatch();
    expect(fillHostSendInputMock).toHaveBeenLastCalledWith(
      '【指挥官战术指令】批准建造：盟军发电厂（第4座） 基地: 1号主基地 层级: 地下层 方位: 正东内环 200m (+2,0)',
    );

    // 打开双轨高阶建筑「扩大版自动化战车工厂」，验证切换为「原位升阶母体」后下达原位升级指令
    openLookup('扩大版自动化战车工厂', []);
    const { setupState: upgSetup } = await compileSfcSetup(DRAWER_PATH, DRAWER_BIND_PATH, 'drawerspatialbind2');
    expect(upgSetup.buildingUpgradeInfo.value?.hasHostInCurrentBase).toBe(true);
    upgSetup.selectedStrategy.value = 'upgrade';
    upgSetup.selectedLayer.value = '地表层';
    upgSetup.handleDispatch();
    expect(fillHostSendInputMock).toHaveBeenLastCalledWith(
      '【指挥官战术指令】批准原位升级：将「盟军战车工厂」升阶为 扩大版自动化战车工厂（补差价 $1500） 基地: 1号主基地 层级: 地表层',
    );
  });
});
