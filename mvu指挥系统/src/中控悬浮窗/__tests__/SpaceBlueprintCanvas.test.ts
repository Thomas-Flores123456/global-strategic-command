/**
 * SpaceBlueprintCanvas.test.ts —— PKG-B 天基交互式拖拽缩放 SVG 蓝图画布与 28 枚军工图元库单元测试
 *
 * 覆盖：
 * 1. spaceCanvasSvgSymbols.ts：28 枚正典构件 svgSymbolId 100% 映射、自定义图元注册 registerCustomSvgSymbol 与兜底图元；
 * 2. useSvgPanZoomCanvas.ts：zoomIn / zoomOut / setZoom / resetView / focusPoint 及指针拖拽/滚轮缩放；
 * 3. SpaceBlueprintCanvas.vue：
 *    - 三域画布（station / constellation / lunar）SSR 渲染、底图层、顶部水电预算账本与星座羁绊芯片；
 *    - 缩放与聚焦操作实时更新 SVG stage 的 transform 属性；
 *    - 在空间站 `st_fwd_hub` 挂载 `asset.st.node_hub` 后，Tier-2 外延槽 `st_ext_dock` 动态生长展开；
 *    - 在月球基地 `ln_hub_west` 挂载 `asset.ln.tunnel_hub` 及探测车整备库 `asset.ln.rover_bay` 后，外环矿脉槽动态生长并解锁；
 *    - 点击「锁定总体建造蓝图」与「拟定该节点发射合同 / 下达建造令」正确 emit `commit-blueprint` 与 `launch-node` 事件；
 *    - 23 号任务包 18 个禁用词静态清零检查。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读写临时编译产物，不进 bundle */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import { Schema } from '../../红警指挥系统/core/schema';
import {
  DEFAULT_SPACE_CANVAS_ASSETS,
  type SpaceCanvasDomainId,
  type SpaceCanvasNodeActionPayload,
  type SpaceCanvasNodeView,
} from '../models/spaceCanvasModel';
import {
  BUILTIN_SPACE_SVG_SYMBOLS,
  DEFAULT_FALLBACK_SVG_SYMBOL,
  clearCustomSvgSymbols,
  getSvgSymbolDef,
  getSvgSymbolPaths,
  registerCustomSvgSymbol,
} from '../panels/spaceCanvasSvgSymbols';
import { useSvgPanZoomCanvas } from '../panels/useSvgPanZoomCanvas';

/* ═══════════════ SFC 即时编译辅助（与 ModalEngineering.test.ts 同管道） ═══════════════ */

const SFC_PATH = join(__dirname, '../panels/SpaceBlueprintCanvas.vue');
const COMPILED_PATH = join(__dirname, '../panels/SpaceBlueprintCanvas.__ssr__.mts');
const BINDINGS_PATH = COMPILED_PATH.replace(
  'SpaceBlueprintCanvas.__ssr__.mts',
  'SpaceBlueprintCanvas.__bindings__.mts',
);

let componentPromise: Promise<Component> | undefined;
let bindingsModPromise: Promise<{ setup: (p: unknown, ctx: unknown) => Record<string, unknown> }> | undefined;

function safeUnlink(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // 忽略文件不存在或已清理
  }
}

function cleanupCompiledMts(): void {
  safeUnlink(COMPILED_PATH);
  safeUnlink(BINDINGS_PATH);
}

afterEach(() => {
  clearCustomSvgSymbols();
});

afterAll(cleanupCompiledMts);

function loadCanvasComponent(): Promise<Component> {
  componentPromise ??= (async () => {
    const source = readFileSync(SFC_PATH, 'utf8');
    const { descriptor, errors } = parse(source, { filename: 'SpaceBlueprintCanvas.vue' });
    if (errors.length > 0) {
      throw new Error(`SpaceBlueprintCanvas.vue 解析失败：${errors.map(String).join('; ')}`);
    }
    const compiled = compileScript(descriptor, {
      id: 'spaceblueprintcanvasssr',
      inlineTemplate: true,
      templateOptions: { id: 'spaceblueprintcanvasssr', scoped: descriptor.styles.some(s => s.scoped) },
    });
    const js = `// @ts-nocheck\n${compiled.content.replace(/^import\s+type\s[\s\S]*?from\s+['"][^'"]+['"];?[\t ]*$/gm, '')}`;
    writeFileSync(COMPILED_PATH, js, 'utf8');
    try {
      const mod = (await import(pathToFileURL(COMPILED_PATH).href)) as { default: Component };
      return mod.default;
    } finally {
      safeUnlink(COMPILED_PATH);
    }
  })();
  return componentPromise;
}

async function renderCanvasSSR(props: {
  domain: SpaceCanvasDomainId;
  snapshot?: Schema | null;
  selectedBaseName?: string;
  initialDraft?: Record<string, string>;
}): Promise<string> {
  const Comp = await loadCanvasComponent();
  return renderToString(
    createSSRApp({
      render: () =>
        h(Comp, {
          domain: props.domain,
          snapshot: props.snapshot ?? null,
          selectedBaseName: props.selectedBaseName ?? '北坡主基地',
          initialDraft: props.initialDraft,
        }),
    }),
  );
}

async function loadCanvasSetupState(
  props: {
    domain: SpaceCanvasDomainId;
    snapshot?: Schema | null;
    selectedBaseName?: string;
    initialDraft?: Record<string, string>;
  },
  emitSpy = vi.fn(),
): Promise<{ state: Record<string, unknown>; emitSpy: ReturnType<typeof vi.fn> }> {
  bindingsModPromise ??= (async () => {
    const source = readFileSync(SFC_PATH, 'utf8');
    const { descriptor, errors } = parse(source, { filename: 'SpaceBlueprintCanvas.vue' });
    if (errors.length > 0) {
      throw new Error(`SpaceBlueprintCanvas.vue 解析失败：${errors.map(String).join('; ')}`);
    }
    const compiled = compileScript(descriptor, { id: 'spacecanvasbindings', inlineTemplate: false });
    const bindingsJs = `// @ts-nocheck\n${compiled.content.replace(/^import\s+type\s[\s\S]*?from\s+['"][^'"]+['"];?[\t ]*$/gm, '')}`;
    writeFileSync(BINDINGS_PATH, bindingsJs, 'utf8');
    try {
      const mod = (await import(pathToFileURL(BINDINGS_PATH).href)) as {
        default: { setup: (p: unknown, ctx: unknown) => Record<string, unknown> };
      };
      return mod.default;
    } finally {
      safeUnlink(BINDINGS_PATH);
    }
  })();
  const comp = await bindingsModPromise;
  const state = comp.setup(
    {
      domain: props.domain,
      snapshot: props.snapshot ?? null,
      selectedBaseName: props.selectedBaseName ?? '北坡主基地',
      initialDraft: props.initialDraft,
    },
    { emit: emitSpy, expose: vi.fn(), attrs: {}, slots: {} },
  );
  return { state, emitSpy };
}

/* ═══════════════ 1. spaceCanvasSvgSymbols.ts 图元库测试 ═══════════════ */

describe('PKG-B · spaceCanvasSvgSymbols 军工蓝图 SVG 图元库', () => {
  it('内置全部 28 枚正典构件的 svgSymbolId 均精准命中非兜底专属矢量图元', () => {
    expect(DEFAULT_SPACE_CANVAS_ASSETS.length).toBeGreaterThanOrEqual(28);
    for (const asset of DEFAULT_SPACE_CANVAS_ASSETS) {
      const def = getSvgSymbolDef(asset.svgSymbolId, asset.id);
      expect(def.id).not.toBe(DEFAULT_FALLBACK_SVG_SYMBOL.id);
      expect(def.paths.length).toBeGreaterThan(0);
      expect(BUILTIN_SPACE_SVG_SYMBOLS[def.id]).toBeDefined();
    }
  });

  it('支持 registerCustomSvgSymbol 动态注册新图元，且未知 ID 自动回退至通用兜底图元', () => {
    const fallback = getSvgSymbolDef('unknown_future_symbol_xyz');
    expect(fallback.id).toBe(DEFAULT_FALLBACK_SVG_SYMBOL.id);

    const customPaths = ['M -10 -10 L 10 10', 'M -10 10 L 10 -10'];
    const registered = registerCustomSvgSymbol('sym_allied_chronosphere_sat', customPaths, {
      title: '轨道超时空中继器',
      accentColor: '#60a5fa',
    });
    expect(registered.paths).toEqual(customPaths);

    const resolved = getSvgSymbolDef('sym_allied_chronosphere_sat');
    expect(resolved.title).toBe('轨道超时空中继器');
    expect(getSvgSymbolPaths('sym_allied_chronosphere_sat')).toEqual(customPaths);
  });
});

/* ═══════════════ 2. useSvgPanZoomCanvas.ts 平移缩放控制器测试 ═══════════════ */

describe('PKG-B · useSvgPanZoomCanvas 交互式平移缩放控制器', () => {
  it('初始状态为 translate(0.0, 0.0) scale(1.000)，支持放大、缩小、边界钳制、聚焦与复位', () => {
    const pz = useSvgPanZoomCanvas();
    expect(pz.transformAttr.value).toBe('translate(0.0, 0.0) scale(1.000)');
    expect(pz.zoomPercent.value).toBe(100);

    pz.zoomIn();
    expect(pz.zoom.value).toBeCloseTo(1.2, 3);
    expect(pz.zoomPercent.value).toBe(120);
    expect(pz.transformAttr.value).toContain('scale(1.200)');

    pz.zoomOut();
    expect(pz.zoom.value).toBeCloseTo(1.0, 3);

    // 极限缩放钳制在 [0.5, 2.5]
    pz.setZoom(9.9);
    expect(pz.zoom.value).toBe(2.5);
    pz.setZoom(0.1);
    expect(pz.zoom.value).toBe(0.5);

    // 聚焦指定画布节点坐标 (250, 150) 到视口中心 (400, 230)
    pz.focusPoint(250, 150, 1.5);
    expect(pz.zoom.value).toBe(1.5);
    expect(pz.panX.value).toBeCloseTo(400 - 250 * 1.5, 1);
    expect(pz.panY.value).toBeCloseTo(230 - 150 * 1.5, 1);

    // 一键复位
    pz.resetView();
    expect(pz.transformAttr.value).toBe('translate(0.0, 0.0) scale(1.000)');
  });

  it('支持指针拖拽平移（onPointerDown / onPointerMove / onPointerUp）与滚轮无级缩放（onWheel）', () => {
    const pz = useSvgPanZoomCanvas();
    pz.onPointerDown({ button: 0, clientX: 100, clientY: 120 } as MouseEvent);
    expect(pz.isDragging.value).toBe(true);

    pz.onPointerMove({ clientX: 145, clientY: 95 } as MouseEvent);
    expect(pz.panX.value).toBe(45);
    expect(pz.panY.value).toBe(-25);
    expect(pz.transformAttr.value).toBe('translate(45.0, -25.0) scale(1.000)');

    pz.onPointerUp();
    expect(pz.isDragging.value).toBe(false);

    // 滚轮向上放大
    const preventDefault = vi.fn();
    pz.onWheel({ deltaY: -100, preventDefault } as unknown as WheelEvent);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(pz.zoom.value).toBeGreaterThan(1);
  });
});

/* ═══════════════ 3. SpaceBlueprintCanvas.vue 组件测试 ═══════════════ */

describe('PKG-B · SpaceBlueprintCanvas.vue 三域画布渲染与交互闭环', () => {
  it('支持空间站 (station)、轨道星座 (constellation)、月球基地 (lunar) 三域 SSR 渲染与专属底图', async () => {
    const stationHtml = await renderCanvasSSR({ domain: 'station' });
    expect(stationHtml).toContain('data-test="space-blueprint-canvas"');
    expect(stationHtml).toContain('data-domain="station"');
    expect(stationHtml).toContain('data-test="space-canvas-ledger"');
    expect(stationHtml).toContain('data-test="space-canvas-viewport"');
    expect(stationHtml).toContain('data-test="space-canvas-inspector"');
    expect(stationHtml).toContain('data-test="canvas-bg-station"');
    expect(stationHtml).toContain('data-test="canvas-slot-st_core"');
    expect(stationHtml).toContain('data-test="canvas-slot-st_fwd_hub"');
    // 初始未挂节点舱时，st_ext_dock 显示为微缩扩展口锚点而非正式可见槽
    expect(stationHtml).toContain('data-test="canvas-locked-stub-st_ext_dock"');

    const constellationHtml = await renderCanvasSSR({
      domain: 'constellation',
      initialDraft: {
        orb_leo_1: 'asset.sat.opt_recon',
        orb_sso_1: 'asset.sat.sar_radar',
      },
    });
    expect(constellationHtml).toContain('data-domain="constellation"');
    expect(constellationHtml).toContain('data-test="canvas-bg-constellation"');
    expect(constellationHtml).toContain('data-test="space-canvas-synergies"');
    expect(constellationHtml).toContain('data-test="synergy-chip-syn.constellation.sky_eye"');
    expect(constellationHtml).toContain('data-synergy-active="true"');

    const lunarHtml = await renderCanvasSSR({ domain: 'lunar' });
    expect(lunarHtml).toContain('data-domain="lunar"');
    expect(lunarHtml).toContain('data-test="canvas-bg-lunar"');
    expect(lunarHtml).toContain('data-test="canvas-slot-ln_core"');
    expect(lunarHtml).toContain('data-test="canvas-slot-ln_hub_west"');

    const launchCenterHtml = await renderCanvasSSR({ domain: 'launch_center' });
    expect(launchCenterHtml).toContain('data-domain="launch_center"');
    expect(launchCenterHtml).toContain('data-test="canvas-bg-launch-center"');
    expect(launchCenterHtml).toContain('data-test="canvas-slot-lc_pad_1"');
    expect(launchCenterHtml).toContain('data-test="canvas-slot-lc_hif"');
    expect(launchCenterHtml).toContain('data-test="canvas-slot-lc_prop_yard"');
    expect(launchCenterHtml).toContain('data-test="canvas-slot-lc_telemetry_1"');
  });

  it('FD-27 · 发射中心 (launch_center) 4→8→12 槽渐进展开：挂载 VAB 展开 Tier-2，再挂载超重型转运基座展开 Tier-3', async () => {
    const { state } = await loadCanvasSetupState({ domain: 'launch_center' });
    const getVisibleSlotIds = () =>
      ((state.visibleNodes as { value: SpaceCanvasNodeView[] }).value ?? []).map(n => n.slot.id);

    // 初始 Tier-1 小型发射场 4 个槽可见
    expect(getVisibleSlotIds()).toHaveLength(4);
    expect(getVisibleSlotIds()).not.toContain('lc_pad_2');
    expect(getVisibleSlotIds()).not.toContain('lc_pad_super');

    // 1. 在 lc_hif 挂载 VAB 垂直总装测试厂房 -> Tier-2 中型发射中心 8 槽展开
    (state.handleMountAsset as (slotId: string, assetId: string) => void)('lc_hif', 'asset.lc.vab_vertical');
    expect(getVisibleSlotIds()).toHaveLength(8);
    expect(getVisibleSlotIds()).toContain('lc_pad_2');
    expect(getVisibleSlotIds()).toContain('lc_crawler_way');

    // 2. 在 lc_crawler_way 挂载超重型双轨转运与航天城流水线基座 -> Tier-3 大型发射中心 12 槽展开
    (state.handleMountAsset as (slotId: string, assetId: string) => void)(
      'lc_crawler_way',
      'asset.lc.crawler_super_base',
    );
    expect(getVisibleSlotIds()).toHaveLength(12);
    expect(getVisibleSlotIds()).toContain('lc_pad_super');
    expect(getVisibleSlotIds()).toContain('lc_underground_fab');
    expect(getVisibleSlotIds()).toContain('lc_spacecraft_hall');
    expect(getVisibleSlotIds()).toContain('lc_cryo_plant');
  });

  it('点击缩放与复位控制方法实时更新 space-canvas-stage 的 transform 属性', async () => {
    const { state } = await loadCanvasSetupState({ domain: 'station' });
    const transformAttr = state.transformAttr as { value: string };
    expect(transformAttr.value).toBe('translate(0.0, 0.0) scale(1.000)');

    (state.zoomIn as () => void)();
    expect(transformAttr.value).toContain('scale(1.200)');

    (state.zoomOut as () => void)();
    expect(transformAttr.value).toBe('translate(0.0, 0.0) scale(1.000)');

    (state.handleFocusCore as () => void)();
    expect(transformAttr.value).toContain('scale(1.350)');

    (state.resetView as () => void)();
    expect(transformAttr.value).toBe('translate(0.0, 0.0) scale(1.000)');
  });

  it('在空间站 st_fwd_hub 挂载六向节点舱 (asset.st.node_hub) 后，Tier-2 外延槽 st_ext_dock 动态生长展开', async () => {
    const { state, emitSpy } = await loadCanvasSetupState({ domain: 'station' });

    const getVisibleSlotIds = () =>
      ((state.visibleNodes as { value: SpaceCanvasNodeView[] }).value ?? []).map(n => n.slot.id);

    // 初始 9 个 Tier-1 基准槽可见，st_ext_dock 未展开
    expect(getVisibleSlotIds()).toHaveLength(9);
    expect(getVisibleSlotIds()).not.toContain('st_ext_dock');

    // 在前向枢纽口挂载六向在轨装配节点舱
    (state.handleMountAsset as (slotId: string, assetId: string) => void)('st_fwd_hub', 'asset.st.node_hub');

    // st_ext_dock 立即生长展开并处于空闲可选配状态
    expect(getVisibleSlotIds()).toContain('st_ext_dock');
    expect(getVisibleSlotIds()).toHaveLength(10);
    expect((state.ledgerView as { value: { expandedCount: number } }).value.expandedCount).toBe(1);
    expect(emitSpy).toHaveBeenCalledWith(
      'update:draft',
      expect.objectContaining({
        st_core: 'asset.st.core',
        st_fwd_hub: 'asset.st.node_hub',
      }),
    );

    // SSR 同样直接渲染出展开后的 canvas-slot-st_ext_dock
    const expandedHtml = await renderCanvasSSR({
      domain: 'station',
      initialDraft: { st_fwd_hub: 'asset.st.node_hub' },
    });
    expect(expandedHtml).toContain('data-test="canvas-slot-st_ext_dock"');
  });

  it('在月球基地挂载加压管廊枢纽与探测车车库后，外环极地水冰与氦-3矿脉槽动态生长并解锁', async () => {
    const { state } = await loadCanvasSetupState({ domain: 'lunar' });

    // 1. 挂载西侧加压管廊延伸枢纽 -> 外环槽生长可见但提示需探测车勘探
    (state.handleMountAsset as (slotId: string, assetId: string) => void)('ln_hub_west', 'asset.ln.tunnel_hub');
    let iceNode = ((state.visibleNodes as { value: SpaceCanvasNodeView[] }).value ?? []).find(
      n => n.slot.id === 'ln_rim_ice',
    );
    expect(iceNode).toBeDefined();
    expect(iceNode?.state).toBe('locked');
    expect(iceNode?.lockReason).toContain('探测车');

    // 2. 在内环挂载月面无人探测车与机娘整备车库 -> 外环水冰矿槽立即解锁为 empty
    (state.handleMountAsset as (slotId: string, assetId: string) => void)('ln_inner_1', 'asset.ln.rover_bay');
    iceNode = ((state.visibleNodes as { value: SpaceCanvasNodeView[] }).value ?? []).find(
      n => n.slot.id === 'ln_rim_ice',
    );
    expect(iceNode?.state).toBe('empty');
    expect(iceNode?.lockReason).toBeUndefined();
  });

  it('点击锁定总体建造蓝图与单节点发射/施工按钮正确 emit commit-blueprint 与 launch-node 事件', async () => {
    const { state, emitSpy } = await loadCanvasSetupState({
      domain: 'station',
      selectedBaseName: '北坡主基地',
      initialDraft: {
        st_truss_up_L: 'asset.st.solar',
      },
    });

    // 1. 触发锁定总体建造蓝图
    (state.handleCommitBlueprint as () => void)();
    expect(emitSpy).toHaveBeenCalledWith(
      'commit-blueprint',
      expect.stringContaining('【天基蓝图规划令】'),
      expect.objectContaining({
        st_core: 'asset.st.core',
        st_truss_up_L: 'asset.st.solar',
      }),
    );

    // 2. 选中左翼太阳翼槽并触发单节点发射合同/施工指令
    (state.selectSlot as (slotId: string) => void)('st_truss_up_L');
    (state.handleLaunchSelectedNode as () => void)();

    const launchCall = emitSpy.mock.calls.find(c => c[0] === 'launch-node');
    expect(launchCall).toBeDefined();
    const payload = launchCall![1] as SpaceCanvasNodeActionPayload;
    const nodeView = launchCall![2] as SpaceCanvasNodeView;
    expect(payload.domain).toBe('station');
    expect(payload.slotId).toBe('st_truss_up_L');
    expect(payload.assetId).toBe('asset.st.solar');
    expect(payload.orderText).toContain('【天基节点建造与发射令】');
    expect(payload.orderText).toContain('北坡主基地');
    expect(payload.contractPreset?.payload).toBe('标准太阳翼与供配电组件');
    expect(nodeView.slot.id).toBe('st_truss_up_L');
  });

  it('Gate 1 · 23 号任务包 18 个禁用词零命中检查', () => {
    const bannedWords = [
      '六柱',
      '战略柱',
      '柱域',
      '协议轨道',
      'X 轨',
      '同源面板',
      '同源投影',
      '零注入语义',
      '直呈',
      '三态实例',
      '无实例驱动',
      '未投影',
      '抽象槽',
      '通用底座',
      '暂存门',
      '审核门',
      '待落盘',
      '原子热重算',
      '作用域',
    ];
    const filesToCheck = [
      join(__dirname, '../panels/spaceCanvasSvgSymbols.ts'),
      join(__dirname, '../panels/useSvgPanZoomCanvas.ts'),
      join(__dirname, '../panels/SpaceBlueprintCanvas.vue'),
    ];
    for (const filePath of filesToCheck) {
      const content = readFileSync(filePath, 'utf8');
      for (const word of bannedWords) {
        expect(content).not.toContain(word);
      }
    }

    // SpaceBlueprintCanvas.vue 全文严禁出现“画布”二字（统一使用“拓扑视图 / 工程蓝图 / 组装视图”）
    const canvasVueSource = readFileSync(join(__dirname, '../panels/SpaceBlueprintCanvas.vue'), 'utf8');
    expect(canvasVueSource).not.toContain('画布');
  });
});
