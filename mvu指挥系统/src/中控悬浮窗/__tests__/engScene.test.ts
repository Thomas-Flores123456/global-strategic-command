/**
 * engScene.test.ts —— ENG-UI-02 SVG 场景引擎纯函数 + 组件 SSR 冒烟
 *
 * 覆盖验收①：视角切换、热点映射（phases 驱动点亮/置灰）、禁用资产条目缺失回退、malformed SVG 容错；
 * 外加：资产读取路径（engSceneAsset.loadSceneAsset，deps 注入 mock，对齐 ENG-VERIFY-01 实证口径）、
 * EngSceneView SSR 首帧、新文件零 MVU/宿主写 API 静态钉死。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读写临时编译产物，不进 bundle */
/**
 * 项目 tsconfig 的 types 白名单不含 node（@types/node 未安装），静态 `import … from 'node:fs'` 会产生
 * TS2591/TS2304 基线外错误（验收④：tsc 零新增）。这里以运行时动态导入 + 本地最小类型契约替代，
 * vitest 运行于 node 环境，行为与静态导入一致；路径一律走 `import.meta.url` 派生的 file: URL（node fs 直收 URL）。
 */
interface NodeFsLike {
  readFileSync(path: URL, encoding: 'utf8'): string;
  writeFileSync(path: URL, data: string, encoding: 'utf8'): void;
  rmSync(path: URL, options?: { force?: boolean }): void;
  unlinkSync?(path: URL): void;
  existsSync?(path: URL): boolean;
}
const nodeFs: Promise<NodeFsLike> = import('node:' + 'fs') as unknown as Promise<NodeFsLike>;
/* eslint-enable import-x/no-nodejs-modules */
import { afterAll, describe, expect, it } from 'vitest';
import { createSSRApp, h, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import type { RetrofitDef } from '../../红警指挥系统/core/catalog';
import type { Project } from '../../红警指挥系统/core/schema';
import {
  AEROSPACE_MCC_SCENE_ID,
  GENERIC_SCENE_ID,
  SCENE_REGISTRY,
  assetEntryName,
  buildAerospaceMccScene,
  buildGenericWorkshopScene,
  defaultSceneId,
  findSceneSpec,
  hotspotStateFor,
  hotspotStates,
  listViews,
  parseSceneAssetEntry,
  renderSceneSvg,
  resolveScene,
  type EngSceneDef,
} from '../models/engScene';
import { GENERIC_ASSET_ENTRY_NAME, SCENE_ASSET_WORLDBOOK, loadSceneAsset } from '../models/engSceneAsset';

/* ═══════════════ ① 内置通用场景与场景装配 ═══════════════ */

describe('ENG-UI-02 · 内置 scene.workshop.generic 与装配回退', () => {
  it('骨架期代码侧默认映射：未声明 scene → 通用车间 id（D23 回填前语义）', () => {
    expect(defaultSceneId(undefined)).toBe(GENERIC_SCENE_ID);
    expect(defaultSceneId(null)).toBe(GENERIC_SCENE_ID);
    expect(defaultSceneId('')).toBe(GENERIC_SCENE_ID);
    expect(defaultSceneId('scene.custom.x')).toBe('scene.custom.x');
  });

  it('内置场景：三视角 × 五热点（热点=改装部位，phaseIdx 0~4 映射）', () => {
    const scene = buildGenericWorkshopScene();
    expect(scene.id).toBe(GENERIC_SCENE_ID);
    expect(scene.source).toBe('builtin');
    expect(listViews(scene).map(v => v.id)).toEqual(['overview', 'section', 'crane']);
    expect(scene.hotspots.map(h => h.phaseIdx)).toEqual([0, 1, 2, 3, 4]);
  });

  it('resolveScene：资产优先；资产 null/未知 sceneId → 内置通用场景（零报错回退）', () => {
    const asset: EngSceneDef = {
      id: 'scene.worldbook.custom',
      title: '资产场景',
      viewBox: '0 0 100 100',
      views: [{ id: 'main', label: '主视角', svg: '<rect width="10" height="10"/>' }],
      hotspots: [],
      source: 'worldbook',
    };
    expect(resolveScene('scene.workshop.generic', asset)).toBe(asset);
    expect(resolveScene('scene.workshop.generic', null).id).toBe(GENERIC_SCENE_ID);
    expect(resolveScene('scene.unknown.future', null).id).toBe(GENERIC_SCENE_ID);
    expect(resolveScene(undefined, null).id).toBe(GENERIC_SCENE_ID);
  });

  it('资产条目名约定：⚠SVG资产·<工程名>·勿启用', () => {
    expect(assetEntryName('灰熊坦克现代化改装工程')).toBe('⚠SVG资产·灰熊坦克现代化改装工程·勿启用');
  });
});

/* ═══════════════ ② 视角切换（纯 UI 状态，换渲染） ═══════════════ */

describe('ENG-UI-02 · 视角切换渲染', () => {
  const scene = buildGenericWorkshopScene();

  it('每个视角产出完整 svg，且 data-view-active 标记当前视角', () => {
    for (const v of listViews(scene)) {
      const svg = renderSceneSvg(scene, v.id);
      expect(svg).toContain('<svg');
      expect(svg).toContain(`data-view-active="${v.id}"`);
      expect(svg).toContain(`data-scene="${GENERIC_SCENE_ID}"`);
    }
  });

  it('视角隔离：吊装作业独有的 PWR-PACK 标记不出现在工位总览', () => {
    expect(renderSceneSvg(scene, 'crane')).toContain('PWR-PACK');
    expect(renderSceneSvg(scene, 'overview')).not.toContain('PWR-PACK');
    expect(renderSceneSvg(scene, 'section')).toContain('PIT-02');
    expect(renderSceneSvg(scene, 'overview')).not.toContain('PIT-02');
  });

  it('未知 viewId 回退首个视角；空视角场景 → 空串（防御兜底）', () => {
    expect(renderSceneSvg(scene, 'no-such-view')).toContain('data-view-active="overview"');
    expect(renderSceneSvg(scene, null)).toContain('data-view-active="overview"');
    const empty: EngSceneDef = { ...scene, views: [] };
    expect(renderSceneSvg(empty, 'overview')).toBe('');
  });
});

/* ═══════════════ ③ 热点映射（phases 状态驱动点亮/置灰） ═══════════════ */

describe('ENG-UI-02 · 热点状态映射', () => {
  it('phaseIdx ↔ phases[].idx 五态映射（含缺失/中立）', () => {
    const phases = [
      { idx: 0, status: '完工' as const },
      { idx: 1, status: '进行中' as const },
      { idx: 2, status: '暂停' as const },
      { idx: 3, status: '未启动' as const },
      { idx: 4, status: '取消' as const },
    ];
    expect(hotspotStateFor(0, phases)).toBe('done');
    expect(hotspotStateFor(1, phases)).toBe('active');
    expect(hotspotStateFor(2, phases)).toBe('paused');
    expect(hotspotStateFor(3, phases)).toBe('pending');
    expect(hotspotStateFor(4, phases)).toBe('pending'); // 取消按未点亮处理
    expect(hotspotStateFor(9, phases)).toBe('pending'); // 实例无此阶段（小改 1 阶段）→ 置灰
    expect(hotspotStateFor(null, phases)).toBe('idle'); // 中立常亮
    expect(hotspotStateFor(0, [])).toBe('pending');
  });

  it('hotspotStates + renderSceneSvg：状态 class 注入命名节点，含可聚焦/aria', () => {
    const scene = buildGenericWorkshopScene();
    const states = hotspotStates(scene, [
      { idx: 0, status: '完工' },
      { idx: 2, status: '进行中' },
    ]);
    expect(states).toEqual({ chassis: 'done', power: 'pending', defense: 'active', network: 'pending', acceptance: 'pending' });
    const svg = renderSceneSvg(scene, 'overview', states);
    expect(svg).toMatch(/<g data-hotspot="chassis" class="eng-hs eng-hs--done" tabindex="0" role="button" aria-label="热点·底盘工位">/);
    expect(svg).toMatch(/<g data-hotspot="defense" class="eng-hs eng-hs--active"/);
    expect(svg).toMatch(/<g data-hotspot="acceptance" class="eng-hs eng-hs--pending"/);
  });

  it('无状态入参（无实例）→ 全部 idle 中立', () => {
    const svg = renderSceneSvg(buildGenericWorkshopScene(), 'overview');
    expect(svg).toMatch(/data-hotspot="power" class="eng-hs eng-hs--idle"/);
  });
});

/* ═══════════════ ④ 世界书资产条目解析与容错 ═══════════════ */

const VALID_ASSET = `<!--ENG-SCENE-ASSET
scene: scene.workshop.grizzly
title: 灰熊专用车间
view: main | 主工位
view: lift | 吊装
hotspot: hull | 底盘位 | 底盘检修 | 0
hotspot: gun | 火力位 | 火炮换装 | 1
hotspot: ghost | 缺失位 | 无对应节点 | 2
-->
<svg viewBox="0 0 320 200">
  <g data-view="main">
    <rect width="10" height="10"/>
    <g data-hotspot="hull"><circle r="4"/></g>
  </g>
  <g data-view="lift">
    <g class="crane-arm" data-hotspot="gun"><rect width="6" height="6"/></g>
  </g>
</svg>`;

describe('ENG-UI-02 · parseSceneAssetEntry（世界书资产条目）', () => {
  it('合法条目：头部注释映射表 + 平衡分组提取 + 视角标签贯通', () => {
    const def = parseSceneAssetEntry(VALID_ASSET, '灰熊坦克现代化改装工程');
    expect(def).not.toBeNull();
    expect(def!.id).toBe('scene.workshop.grizzly');
    expect(def!.title).toBe('灰熊专用车间');
    expect(def!.source).toBe('worldbook');
    expect(def!.viewBox).toBe('0 0 320 200');
    expect(listViews(def!).map(v => v.label)).toEqual(['主工位', '吊装']);
    // 声明了但 SVG 无对应节点的 ghost 热点被容错丢弃
    expect(def!.hotspots.map(h => h.id)).toEqual(['hull', 'gun']);
    expect(def!.hotspots[1].phaseIdx).toBe(1);
  });

  it('嵌套分组配平：内层 <g> 不截断视角层、不独立成层', () => {
    const def = parseSceneAssetEntry(VALID_ASSET)!;
    const main = def.views.find(v => v.id === 'main')!;
    expect(main.svg).toContain('data-hotspot="hull"');
    const lift = def.views.find(v => v.id === 'lift')!;
    expect(lift.svg).toContain('crane-arm');
  });

  it('已含 class 的热点节点：注入时合并 class 并补交互属性', () => {
    const def = parseSceneAssetEntry(VALID_ASSET)!;
    const svg = renderSceneSvg(def, 'lift', hotspotStates(def, [{ idx: 1, status: '进行中' }]));
    expect(svg).toContain('class="crane-arm eng-hs eng-hs--active"');
    expect(svg).toContain('tabindex="0" role="button"');
  });

  it('malformed 容错：非字符串/空串/无 svg/全空层 → null（调用方回退内置）', () => {
    expect(parseSceneAssetEntry(undefined)).toBeNull();
    expect(parseSceneAssetEntry(42)).toBeNull();
    expect(parseSceneAssetEntry('')).toBeNull();
    expect(parseSceneAssetEntry('纯文本，没有 SVG')).toBeNull();
    expect(parseSceneAssetEntry('<svg viewBox="0 0 1 1"></svg>')).toBeNull();
  });

  it('危险载荷 fail-closed：script / 事件处理器 / javascript: / foreignObject 整条目判废', () => {
    const svg = '<svg><g data-view="a"><rect width="1" height="1"/></g></svg>';
    expect(parseSceneAssetEntry(`${svg}<script>alert(1)</script>`)).toBeNull();
    expect(parseSceneAssetEntry(svg.replace('<rect', '<rect onload="alert(1)"'))).toBeNull();
    expect(parseSceneAssetEntry(svg.replace('<rect', '<rect onclick="x()"'))).toBeNull();
    expect(parseSceneAssetEntry(svg.replace('<g data-view="a">', '<g data-view="a"><a href="javascript:alert(1)">x</a>'))).toBeNull();
    expect(parseSceneAssetEntry(svg.replace('<rect', '<foreignObject><div>x</div></foreignObject><rect'))).toBeNull();
  });

  it('未闭合 data-view 层容错：丢弃坏层，整体按单视角兜底而非判废', () => {
    const def = parseSceneAssetEntry('<svg><g data-view="broken"><rect width="1" height="1"/></svg>');
    expect(def).not.toBeNull();
    expect(def!.views).toHaveLength(1);
    expect(def!.views[0].id).toBe('main');
  });

  it('无头部注释容错：自动发现 data-hotspot 节点（中立常亮），id/title 兜底', () => {
    const def = parseSceneAssetEntry('<svg><g data-view="a"><g data-hotspot="turret"><rect width="2" height="2"/></g></g></svg>');
    expect(def).not.toBeNull();
    expect(def!.id).toBe('scene.worldbook.custom');
    expect(def!.hotspots).toEqual([{ id: 'turret', label: 'turret', desc: '', phaseIdx: null }]);
  });

  it('禁用资产条目缺失回退链路：parse null → resolveScene 给内置通用场景', () => {
    const def = resolveScene(GENERIC_SCENE_ID, parseSceneAssetEntry('条目正文被清空'));
    expect(def.id).toBe(GENERIC_SCENE_ID);
    expect(def.source).toBe('builtin');
  });
});

/* ═══════════════ ⑤ 世界书资产读取路径（fail-closed，真机门复测点） ═══════════════ */

describe('ENG-UI-02 · loadSceneAsset（工程·盟军 禁用资产条目读取）', () => {
  it('命中禁用条目（enabled:false / disable:true 双命名）→ 解析为 worldbook 场景', async () => {
    const getWorldbook = async (name: string) => {
      expect(name).toBe(SCENE_ASSET_WORLDBOOK);
      return [
        { name: '无关条目', enabled: true, content: 'x' },
        { name: assetEntryName('灰熊坦克现代化改装工程'), enabled: false, content: VALID_ASSET },
        { name: assetEntryName('帕拉丁现代化改装工程'), disable: true, content: VALID_ASSET },
      ];
    };
    const a = await loadSceneAsset('灰熊坦克现代化改装工程', { getWorldbook });
    expect(a?.source).toBe('worldbook');
    expect(a?.id).toBe('scene.workshop.grizzly');
    const b = await loadSceneAsset('帕拉丁现代化改装工程', { getWorldbook });
    expect(b?.source).toBe('worldbook');
  });

  it('ENG-WB-01 通用名回退：工程专属条目缺失时命中「⚠SVG资产·通用改装车间·勿启用」', async () => {
    const getWorldbook = async () => [
      { name: GENERIC_ASSET_ENTRY_NAME, disable: true, content: VALID_ASSET },
    ];
    const def = await loadSceneAsset('任意未配专属资产的工程', { getWorldbook });
    expect(def?.source).toBe('worldbook');
    expect(def?.id).toBe('scene.workshop.grizzly'); // 按条目自身头部 scene id 解析
  });

  it('工程专属条目优先于通用回退（精确命中不旁路）', async () => {
    const specific = VALID_ASSET.replace('灰熊专用车间', '灰熊专属车间');
    const getWorldbook = async () => [
      { name: GENERIC_ASSET_ENTRY_NAME, disable: true, content: VALID_ASSET },
      { name: assetEntryName('灰熊坦克现代化改装工程'), disable: true, content: specific },
    ];
    const def = await loadSceneAsset('灰熊坦克现代化改装工程', { getWorldbook });
    expect(def?.title).toBe('灰熊专属车间');
  });

  it('ENG-RM-01 书名双口径：无后缀名抛错 → 自动探测 `_世界书` 后缀名（酒馆导入口径；SU-01 起缺省双书续探）', async () => {
    const calls: string[] = [];
    const getWorldbook = async (name: string) => {
      calls.push(name);
      if (!name.endsWith('_世界书')) throw new Error(`未能找到世界书 '${name}'`);
      return [{ name: GENERIC_ASSET_ENTRY_NAME, disable: true, content: VALID_ASSET }];
    };
    const def = await loadSceneAsset('任意工程', { getWorldbook });
    expect(def?.source).toBe('worldbook');
    // 双名口径×双书序：盟军裸名抛错→后缀命中；通用回退触发跨书扫描→苏联裸名抛错→后缀命中（V2-06）
    expect(calls).toEqual([
      SCENE_ASSET_WORLDBOOK,
      `${SCENE_ASSET_WORLDBOOK}_世界书`,
      '工程·苏联',
      '工程·苏联_世界书',
    ]);
  });

  it('MVP 期优雅回退：条目不存在 → null（ENG-WB-01 未落地，零报错）', async () => {
    const getWorldbook = async () => [{ name: '常规条目', enabled: true, content: '无 svg' }];
    await expect(loadSceneAsset('灰熊坦克现代化改装工程', { getWorldbook })).resolves.toBeNull();
  });

  it('fail-closed：API 缺失 / 抛错 / 返回非数组 / 载荷畸形 → null', async () => {
    await expect(loadSceneAsset('X', { getWorldbook: undefined })).resolves.toBeNull();
    await expect(
      loadSceneAsset('X', {
        getWorldbook: async () => {
          throw new Error('宿主不可用');
        },
      }),
    ).resolves.toBeNull();
    await expect(loadSceneAsset('X', { getWorldbook: async () => ({ not: 'array' }) })).resolves.toBeNull();
    const bad = async () => [{ name: assetEntryName('X'), enabled: false, content: '<svg><script>1</script></svg>' }];
    await expect(loadSceneAsset('X', { getWorldbook: bad })).resolves.toBeNull();
  });

  it('ENG-WB-01 实证：《工程·盟军》资产条目禁用态 + 通用回退接线贯通（真书直读）', async () => {
    const fs = await nodeFs;
    const wbUrl = new URL('../../../../worldbooks/工程·盟军_世界书.json', import.meta.url);
    const raw = JSON.parse(fs.readFileSync(wbUrl, 'utf8')) as { entries: Record<string, unknown> };
    const entries = Object.values(raw.entries) as {
      name?: string;
      disable?: boolean;
      constant?: boolean;
      key?: unknown;
      content?: string;
    }[];
    const asset = entries.find(e => e.name === GENERIC_ASSET_ENTRY_NAME);
    expect(asset).toBeDefined();
    // 禁用态证明（验收③）：disable=true + constant=false + 无触发词 → 常驻 token 零注入
    expect(asset!.disable).toBe(true);
    expect(asset!.constant).toBe(false);
    expect(asset!.key).toEqual([]);
    expect(asset!.content ?? '').not.toContain('<数据>'); // 不参与 catalog 合并链
    // 接线贯通：任意工程名经通用名回退命中该条目并解析成功
    const def = await loadSceneAsset('灰熊坦克现代化改装工程', { getWorldbook: async () => entries });
    expect(def?.source).toBe('worldbook');
    expect(def?.id).toBe(GENERIC_SCENE_ID);
    expect(listViews(def!).map(v => v.id)).toEqual(['overview', 'section', 'crane']);
    expect(def!.hotspots.map(h => h.id)).toEqual(['chassis', 'power', 'defense', 'network', 'acceptance']);
  });
});

/* ═══════════════ ⑥ EngSceneView 组件 SSR 冒烟 ═══════════════ */

const SCENE_SFC_URL = new URL('../panels/EngSceneView.vue', import.meta.url);
const SCENE_COMPILED_URL = new URL('../panels/EngSceneView.__ssr__.mts', import.meta.url);

let sceneComponentPromise: Promise<Component> | undefined;

function loadSceneComponent(): Promise<Component> {
  sceneComponentPromise ??= (async () => {
    const fs = await nodeFs;
    const source = fs.readFileSync(SCENE_SFC_URL, 'utf8');
    const { descriptor, errors } = parse(source, { filename: 'EngSceneView.vue' });
    if (errors.length > 0) throw new Error(`EngSceneView.vue 解析失败：${errors.map(String).join('; ')}`);
    const compiled = compileScript(descriptor, {
      id: 'engsceneviewssr',
      inlineTemplate: true,
      templateOptions: { id: 'engsceneviewssr', scoped: descriptor.styles.some(s => s.scoped) },
    });
    const js = compiled.content.replace(/^import\s+type\s[^;]*;?[\t ]*$/gm, '');
    fs.writeFileSync(SCENE_COMPILED_URL, js, 'utf8');
    try {
      const mod = (await import(SCENE_COMPILED_URL.href)) as { default: Component };
      return mod.default;
    } finally {
      fs.rmSync(SCENE_COMPILED_URL, { force: true });
      if (fs.existsSync?.(SCENE_COMPILED_URL)) {
        fs.unlinkSync?.(SCENE_COMPILED_URL);
      }
    }
  })();
  return sceneComponentPromise;
}

afterAll(async () => {
  const fs = await nodeFs;
  fs.rmSync(SCENE_COMPILED_URL, { force: true });
  if (fs.existsSync?.(SCENE_COMPILED_URL)) {
    fs.unlinkSync?.(SCENE_COMPILED_URL);
  }
});

const DEMO_DEF: RetrofitDef = {
  kind: 'retrofit',
  name: '灰熊坦克现代化改装工程',
  research: '混合动力装甲工学',
  grade: '大改',
  desc: '混动APU+主动防御系统+车际数据网络。',
};

const DEMO_PROJECT: Project = {
  id: 'proj:scene-test',
  ref: '灰熊坦克现代化改装工程',
  scope: 'base',
  bases: ['beipo'],
  lead_base: 'beipo',
  grade: '大改',
  status: '在建',
  phases: [
    { idx: 0, name: '底盘拆解', status: '完工', queue_index: null },
    { idx: 1, name: '混动APU换装', status: '完工', queue_index: null },
    { idx: 2, name: '主动防御集成', status: '进行中', queue_index: null },
    { idx: 3, name: '车际网络联调', status: '未启动', queue_index: null },
    { idx: 4, name: '出厂验收', status: '未启动', queue_index: null },
  ],
  outcome: { type: 'mark' },
  schema_version: 1,
};

describe('ENG-UI-02 · EngSceneView 组件（SSR 首帧）', () => {
  it('首帧渲染内置通用场景：视角页签 ×3 + 热点命名节点 ×5 + 内置来源徽标', async () => {
    const Comp = await loadSceneComponent();
    const html = await renderToString(createSSRApp({ render: () => h(Comp, { def: DEMO_DEF, project: null }) }));
    expect(html).toContain('通用改装车间');
    expect(html).toContain('内置通用场景');
    for (const label of ['工位总览', '平台剖面', '吊装作业']) expect(html).toContain(label);
    for (const hs of ['chassis', 'power', 'defense', 'network', 'acceptance']) {
      expect(html).toContain(`data-hotspot="${hs}"`);
    }
    expect(html).toContain('data-view-active="overview"');
  });

  it('phases 驱动点亮：完工热点 eng-hs--done、进行中 eng-hs--active、未启动置灰 pending', async () => {
    const Comp = await loadSceneComponent();
    const html = await renderToString(createSSRApp({ render: () => h(Comp, { def: DEMO_DEF, project: DEMO_PROJECT }) }));
    expect(html).toMatch(/data-hotspot="chassis" class="eng-hs eng-hs--done"/);
    expect(html).toMatch(/data-hotspot="defense" class="eng-hs eng-hs--active"/);
    expect(html).toMatch(/data-hotspot="acceptance" class="eng-hs eng-hs--pending"/);
  });

  it('reduced-motion：forceReducedMotion prop → 降级 class；组件样式含 prefers-reduced-motion 媒体查询', async () => {
    const Comp = await loadSceneComponent();
    const html = await renderToString(
      createSSRApp({ render: () => h(Comp, { def: DEMO_DEF, project: null, forceReducedMotion: true }) }),
    );
    expect(html).toContain('eng-scene-view--rm');
    const src = (await nodeFs).readFileSync(SCENE_SFC_URL, 'utf8');
    expect(src).toContain('prefers-reduced-motion: reduce');
  });
});

/* ═══════════════ ⑦ 静态契约：零 MVU/宿主写 API ═══════════════ */

describe('ENG-UI-02 静态契约 · 新文件零写操作自证', () => {
  const banned =
    /replaceVariables|insertVariables|updateVariablesWith|insertOrAssignVariables|deleteVariable|createChatMessages|triggerSlash|updateWorldbookWith|createWorldbook|replaceWorldbook|deleteWorldbook/;

  it.each(['../models/engScene.ts', '../models/engSceneAsset.ts', '../panels/EngSceneView.vue'])('%s 零 MVU/宿主写 API', async rel => {
    const src = (await nodeFs).readFileSync(new URL(rel, import.meta.url), 'utf8');
    expect(src).not.toMatch(banned);
  });

  it('ModalEngineering.vue 场景槽接入后仍零写 API', async () => {
    const src = (await nodeFs).readFileSync(new URL('../modals/ModalEngineering.vue', import.meta.url), 'utf8');
    expect(src).not.toMatch(banned);
  });
});

/* ═══════════════ ⑧ PKG-A · 内置天基测控三视角场景 scene.aerospace.mcc ═══════════════ */

describe('PKG-A · 天基测控三视角场景 scene.aerospace.mcc 与热点状态映射', () => {
  const EXPECTED_HOTSPOTS = [
    'vab_assembly',
    'launch_pad',
    'recovery_pad',
    'leo_constellation',
    'lunar_transfer',
  ] as const;

  it('AEROSPACE_MCC_SCENE_ID 与 buildAerospaceMccScene：三视角（pad/leo/tli）× 五热点（phaseIdx 0~4）', () => {
    expect(AEROSPACE_MCC_SCENE_ID).toBe('scene.aerospace.mcc');
    const scene = buildAerospaceMccScene();
    expect(scene.id).toBe('scene.aerospace.mcc');
    expect(scene.title).toBe('天基测控与发射大厅');
    expect(scene.viewBox).toBe('0 0 640 360');
    expect(scene.source).toBe('builtin');
    expect(listViews(scene)).toEqual([
      { id: 'pad', label: '发射场总览' },
      { id: 'leo', label: '近地轨道' },
      { id: 'tli', label: '地月深空' },
    ]);
    expect(scene.hotspots.map(h => h.id)).toEqual([...EXPECTED_HOTSPOTS]);
    expect(scene.hotspots.map(h => h.label)).toEqual([
      '垂直总装厂房',
      '1号发射工位',
      '助推回收坪',
      '近地轨道星座',
      '地月转移与月表前哨',
    ]);
    expect(scene.hotspots.map(h => h.phaseIdx)).toEqual([0, 1, 2, 3, 4]);
  });

  it('SCENE_REGISTRY 与 resolveScene("scene.aerospace.mcc")：直接解析天基测控内置场景，不回退通用车间', () => {
    expect(SCENE_REGISTRY.map(s => s.id)).toContain(AEROSPACE_MCC_SCENE_ID);
    const spec = findSceneSpec(AEROSPACE_MCC_SCENE_ID);
    expect(spec?.title).toBe('天基测控与发射大厅');
    expect(spec?.builtin).toBe(buildAerospaceMccScene);

    const resolved = resolveScene(AEROSPACE_MCC_SCENE_ID, null);
    expect(resolved.id).toBe(AEROSPACE_MCC_SCENE_ID);
    expect(resolved.id).not.toBe(GENERIC_SCENE_ID);
    expect(resolved.title).toBe('天基测控与发射大厅');
    expect(resolved.source).toBe('builtin');
  });

  it('renderSceneSvg：pad / leo / tli 三视角渲染、视角特征隔离、五态热点着色与消毒检查', () => {
    const scene = buildAerospaceMccScene();
    const states = hotspotStates(scene, [
      { idx: 0, status: '完工' },
      { idx: 1, status: '进行中' },
      { idx: 2, status: '暂停' },
      { idx: 3, status: '未启动' },
      { idx: 4, status: '取消' },
    ]);
    expect(states).toEqual({
      vab_assembly: 'done',
      launch_pad: 'active',
      recovery_pad: 'paused',
      leo_constellation: 'pending',
      lunar_transfer: 'pending',
    });

    const forbiddenRe =
      /<\s*(script|foreignObject|iframe|object|embed|link|meta|style)\b|javascript:|data\s*:\s*text\/html|\son[a-zA-Z]+\s*=/i;

    for (const viewId of ['pad', 'leo', 'tli'] as const) {
      const svg = renderSceneSvg(scene, viewId, states);
      expect(svg).toContain(`data-scene="${AEROSPACE_MCC_SCENE_ID}"`);
      expect(svg).toContain(`data-view-active="${viewId}"`);
      expect(svg).not.toMatch(forbiddenRe);

      for (const hsId of EXPECTED_HOTSPOTS) {
        expect(svg).toContain(`data-hotspot="${hsId}"`);
      }
      expect(svg).toMatch(/<g data-hotspot="vab_assembly" class="eng-hs eng-hs--done"/);
      expect(svg).toMatch(/<g data-hotspot="launch_pad" class="eng-hs eng-hs--active"/);
      expect(svg).toMatch(/<g data-hotspot="recovery_pad" class="eng-hs eng-hs--paused"/);
      expect(svg).toMatch(/<g data-hotspot="leo_constellation" class="eng-hs eng-hs--pending"/);
      expect(svg).toMatch(/<g data-hotspot="lunar_transfer" class="eng-hs eng-hs--pending"/);

      // 无实例默认入参时五热点均为 idle
      const idleSvg = renderSceneSvg(scene, viewId);
      expect(idleSvg).toMatch(/<g data-hotspot="vab_assembly" class="eng-hs eng-hs--idle"/);
    }

    // 三视角特征元素隔离检查
    const padSvg = renderSceneSvg(scene, 'pad', states);
    const leoSvg = renderSceneSvg(scene, 'leo', states);
    const tliSvg = renderSceneSvg(scene, 'tli', states);
    expect(padSvg).toContain('VAB-01');
    expect(padSvg).toContain('LC-01');
    expect(padSvg).toContain('LZ-01');
    expect(padSvg).toContain('RADAR-MCC');
    expect(leoSvg).toContain('LEO · 400KM');
    expect(leoSvg).toContain('SSO · 680KM');
    expect(leoSvg).toContain('GEO · 35786KM');
    expect(tliSvg).toContain('TLI · HOHMANN ARC');
    expect(tliSvg).toContain('LUNA · OUTPOST BASE');

    // 通过 parseSceneAssetEntry 消毒校验（将三视角拼装为资产包仍可合法解析）
    const wrapped = [
      '<!--ENG-SCENE-ASSET',
      `scene: ${AEROSPACE_MCC_SCENE_ID}`,
      `title: ${scene.title}`,
      ...scene.views.map(v => `view: ${v.id} | ${v.label}`),
      ...scene.hotspots.map(h => `hotspot: ${h.id} | ${h.label} | ${h.desc} | ${h.phaseIdx}`),
      '-->',
      `<svg viewBox="${scene.viewBox}">`,
      ...scene.views.map(v => `<g data-view="${v.id}">${v.svg}</g>`),
      '</svg>',
    ].join('\n');
    const parsed = parseSceneAssetEntry(wrapped);
    expect(parsed).not.toBeNull();
    expect(parsed!.views.map(v => v.id)).toEqual(['pad', 'leo', 'tli']);
    expect(parsed!.hotspots.map(h => h.id)).toEqual([...EXPECTED_HOTSPOTS]);
  });

  it('EngSceneView SSR：支持 scene.aerospace.mcc 首帧直出与 initialView 视角指定', async () => {
    const Comp = await loadSceneComponent();
    const mccDef: RetrofitDef = {
      ...DEMO_DEF,
      name: '天基火箭垂直总装与发射场工程',
      scene: AEROSPACE_MCC_SCENE_ID,
    };
    const defaultHtml = await renderToString(
      createSSRApp({ render: () => h(Comp, { def: mccDef, project: DEMO_PROJECT }) }),
    );
    expect(defaultHtml).toContain('天基测控与发射大厅');
    for (const tabLabel of ['发射场总览', '近地轨道', '地月深空']) {
      expect(defaultHtml).toContain(tabLabel);
    }
    expect(defaultHtml).toContain('data-view-active="pad"');
    expect(defaultHtml).toMatch(/data-hotspot="vab_assembly" class="eng-hs eng-hs--done"/);
    expect(defaultHtml).toMatch(/data-hotspot="recovery_pad" class="eng-hs eng-hs--active"/);

    const tliHtml = await renderToString(
      createSSRApp({ render: () => h(Comp, { def: mccDef, project: null, initialView: 'tli' }) }),
    );
    expect(tliHtml).toContain('data-view-active="tli"');
    expect(tliHtml).toContain('TLI · HOHMANN ARC');
  });
});
