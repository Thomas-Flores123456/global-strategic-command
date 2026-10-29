/**
 * engSceneStation.test.ts —— V2-06 场景引擎跨书扩展 + 空间站多视角 SVG 资产
 *
 * 覆盖（仓段化V2设计案 §5 / D22 / D23 / D24 / D-C5）：
 * ① engSceneAsset 跨书资产路由：scene id 前缀 → 探测书清单（工程·通用 → 工程·盟军）；书名双口径/专属先于通用回退/fail-closed；
 * ② 热点 target 扩展：module:<id> 头部语法、phaseIdx 等价映射（hotspotTarget）、模块五态着色（hotspotStateForTarget）；
 * ③ 场景注册表：scene.station.orbital 注册、resolveScene 资产优先/缺资产退通用场景（fail-closed，D23）；
 * ④ fixtures/eng-scene-station-asset.json：uid24 条目格式对齐（V2-08 直接入书）+ .svg 源零漂移；
 * ⑤ 渲染冒烟：最小 DOM shim（node 环境无 jsdom 包，结构性契约与组件 @click 同一代码路径）断言视角/热点节点存在、
 *    点击派发（hotspotFromDomTarget）、REDUCED-MOTION 降级对照（组件 CSS 类名词汇表 + 媒体查询，D23 先例）；
 * ⑥ EngSceneView 接通 catalog project def.scene（V2-04 透传位）：SSR 首帧 fail-closed 内置兜底。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试读 fixture/临时编译产物，不进 bundle（engScene.test.ts 同口径） */
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
import type { ProjectDef, RetrofitDef } from '../../红警指挥系统/core/catalog';
import type { Project } from '../../红警指挥系统/core/schema';
import {
  GENERIC_SCENE_ID,
  STATION_ORBITAL_SCENE_ID,
  assetEntryName,
  findSceneSpec,
  hotspotFromDomTarget,
  hotspotStateFor,
  hotspotStateForTarget,
  hotspotStates,
  hotspotTarget,
  listViews,
  parseSceneAssetEntry,
  renderSceneSvg,
  resolveScene,
  SCENE_REGISTRY,
  type EngSceneDef,
  type EngSceneTarget,
  type ModuleSlice,
} from '../models/engScene';
import {
  ENGINE_COMMON_WORLDBOOK,
  GENERIC_ASSET_ENTRY_NAME,
  SCENE_ASSET_WORLDBOOK,
  assetWorldbooksFor,
  loadSceneAsset,
} from '../models/engSceneAsset';

/* ═══════════════ fixtures 载入（uid24 条目格式对齐） ═══════════════ */

interface StationAssetFixture {
  name: string;
  comment: string;
  disable: boolean;
  constant: boolean;
  key: unknown[];
  content: string;
}

const FIXTURE_URL = new URL('../../../../tests/fixtures/eng-scene-station-asset.json', import.meta.url);
const FIXTURE_SVG_URL = new URL('../../../../tests/fixtures/eng-scene-station-asset.svg', import.meta.url);

let fixtureCache: StationAssetFixture | undefined;
async function loadStationFixture(): Promise<StationAssetFixture> {
  if (!fixtureCache) {
    const fs = await nodeFs;
    fixtureCache = JSON.parse(fs.readFileSync(FIXTURE_URL, 'utf8')) as StationAssetFixture;
  }
  return fixtureCache;
}

let stationSceneCache: EngSceneDef | undefined;
async function loadStationScene(): Promise<EngSceneDef> {
  if (!stationSceneCache) {
    const fixture = await loadStationFixture();
    const def = parseSceneAssetEntry(fixture.content, '轨道空间站');
    if (!def) throw new Error('空间站资产 fixture 解析失败');
    stationSceneCache = def;
  }
  return stationSceneCache;
}

const STATION_MODULES: ModuleSlice[] = [
  { id: 'core', status: '完工' },
  { id: 'hab', status: '进行中' },
  { id: 'lab', status: '暂停' },
  { id: 'solar', status: '未启动' },
  { id: 'dock', status: '取消' },
];

/* ═══════════════ ① 跨书资产路由（engSceneAsset，D-C5） ═══════════════ */

describe('V2-06 · assetWorldbooksFor（scene id → 探测书清单）', () => {
  it('默认口径（SU-01 起）：未声明/空/未知前缀 → [工程·盟军, 工程·苏联] 双书（苏联在后，命中序不变）', () => {
    expect(assetWorldbooksFor(undefined)).toEqual([SCENE_ASSET_WORLDBOOK, '工程·苏联']);
    expect(assetWorldbooksFor(null)).toEqual([SCENE_ASSET_WORLDBOOK, '工程·苏联']);
    expect(assetWorldbooksFor('')).toEqual([SCENE_ASSET_WORLDBOOK, '工程·苏联']);
    expect(assetWorldbooksFor('scene.workshop.generic')).toEqual([SCENE_ASSET_WORLDBOOK, '工程·苏联']);
    expect(assetWorldbooksFor('scene.worldbook.custom')).toEqual([SCENE_ASSET_WORLDBOOK, '工程·苏联']);
    // 命中序不变：盟军仍居首，苏联仅尾随补位
    expect(assetWorldbooksFor(undefined)![0]).toBe(SCENE_ASSET_WORLDBOOK);
  });

  it('scene.station.* 前缀路由：《工程·通用》优先、《工程·盟军》次之（书序即优先级）', () => {
    expect(assetWorldbooksFor(STATION_ORBITAL_SCENE_ID)).toEqual([ENGINE_COMMON_WORLDBOOK, SCENE_ASSET_WORLDBOOK]);
    expect(assetWorldbooksFor('scene.station.orbital.shipyard')).toEqual([ENGINE_COMMON_WORLDBOOK, SCENE_ASSET_WORLDBOOK]);
  });
});

describe('V2-06 · loadSceneAsset 跨书探测（按 scene id 路由）', () => {
  it('路由命中《工程·通用》：双名探测 + 禁用条目读取 → 解析空间站场景（三视角）', async () => {
    const fixture = await loadStationFixture();
    const calls: string[] = [];
    const getWorldbook = async (name: string) => {
      calls.push(name);
      if (name === '工程·通用') throw new Error(`未能找到世界书 '${name}'`); // 裸名抛错 → 后缀名命中（ENG-RM-01 双口径）
      if (name === `${ENGINE_COMMON_WORLDBOOK}_世界书`) {
        return [{ name: fixture.name, disable: true, content: fixture.content }];
      }
      throw new Error(`未能找到世界书 '${name}'`);
    };
    const def = await loadSceneAsset('轨道空间站', { getWorldbook }, STATION_ORBITAL_SCENE_ID);
    expect(def?.source).toBe('worldbook');
    expect(def?.id).toBe(STATION_ORBITAL_SCENE_ID);
    expect(listViews(def!).map(v => v.id)).toEqual(['overview', 'section', 'dock']);
    expect(calls).toEqual(['工程·通用', '工程·通用_世界书']); // 专属命中即止，不再探《工程·盟军》
  });

  it('专属条目跨书续探：首书无条目 → 次书《工程·盟军》命中（书序保底链）', async () => {
    const fixture = await loadStationFixture();
    const calls: string[] = [];
    const getWorldbook = async (name: string) => {
      calls.push(name);
      if (name === '工程·通用') return []; // 通用书存在但无目标条目
      if (name === '工程·盟军') throw new Error('不存在');
      if (name === `${SCENE_ASSET_WORLDBOOK}_世界书`) {
        return [{ name: fixture.name, disable: true, content: fixture.content }];
      }
      throw new Error(`未能找到世界书 '${name}'`);
    };
    const def = await loadSceneAsset('轨道空间站', { getWorldbook }, 'scene.station.orbital');
    expect(def?.id).toBe(STATION_ORBITAL_SCENE_ID);
    expect(calls).toEqual(['工程·通用', '工程·盟军', `${SCENE_ASSET_WORLDBOOK}_世界书`]);
  });

  it('通用回退跨书扫描：专属条目全缺、通用车间条目落《工程·盟军》→ 命中（D23 接缝）', async () => {
    const getWorldbook = async (name: string) => {
      if (name === '工程·通用') return [];
      if (name === `${SCENE_ASSET_WORLDBOOK}_世界书`) {
        return [{ name: GENERIC_ASSET_ENTRY_NAME, disable: true, content: '<svg viewBox="0 0 2 2"><g data-view="a"><rect width="1" height="1"/></g></svg>' }];
      }
      throw new Error('不存在');
    };
    const def = await loadSceneAsset('任意工程', { getWorldbook }, STATION_ORBITAL_SCENE_ID);
    expect(def?.source).toBe('worldbook');
    expect(def?.viewBox).toBe('0 0 2 2');
  });

  it('fail-closed：路由内全部书不可读/无条目 → null → resolveScene 退通用场景（缺资产 fail-closed）', async () => {
    const getWorldbook = async () => {
      throw new Error('宿主不可用');
    };
    await expect(loadSceneAsset('轨道空间站', { getWorldbook }, STATION_ORBITAL_SCENE_ID)).resolves.toBeNull();
    expect(resolveScene(STATION_ORBITAL_SCENE_ID, null).id).toBe(GENERIC_SCENE_ID);
  });

  it('向后兼容：不传 sceneId → 先探《工程·盟军》双名、续探《工程·苏联》双名；均无条目 → null（fail-closed 不变）', async () => {
    const calls: string[] = [];
    const getWorldbook = async (name: string) => {
      calls.push(name);
      if (name === `${SCENE_ASSET_WORLDBOOK}_世界书`) return []; // 后缀名命中（酒馆导入口径）但无条目
      throw new Error(`未能找到世界书 '${name}'`); // 其余书名（含《工程·苏联》双名）均不可读 → 跨书容错
    };
    await expect(loadSceneAsset('灰熊坦克现代化改装工程', { getWorldbook })).resolves.toBeNull();
    expect(calls).toEqual([SCENE_ASSET_WORLDBOOK, `${SCENE_ASSET_WORLDBOOK}_世界书`, '工程·苏联', '工程·苏联_世界书']);
  });

  it('SU-01 · 缺省双书续探：首书《工程·盟军》不可读 → 次书《工程·苏联》镜像资产命中（scene.workshop.generic）', async () => {
    const calls: string[] = [];
    const getWorldbook = async (name: string) => {
      calls.push(name);
      if (name === '工程·苏联_世界书') {
        // 真实镜像资产条目形状：禁用 + name 命名约定（engSceneAsset 双名探测依赖）
        return [{ name: GENERIC_ASSET_ENTRY_NAME, disable: true, content: '<!--ENG-SCENE-ASSET\nscene: scene.workshop.generic\nview: overview | 工位总览\n--><svg viewBox="0 0 2 2"><g data-view="overview"><rect width="1" height="1"/></g></svg>' }];
      }
      throw new Error(`未能找到世界书 '${name}'`);
    };
    const def = await loadSceneAsset('犀牛坦克现代化改装工程', { getWorldbook });
    expect(def?.source).toBe('worldbook');
    expect(def?.id).toBe('scene.workshop.generic'); // 镜像资产 scene id 同盟军 uid24
    expect(calls).toEqual(['工程·盟军', '工程·盟军_世界书', '工程·苏联', '工程·苏联_世界书']);
  });
});

/* ═══════════════ ② 热点 target 扩展（phase | module） ═══════════════ */

describe('V2-06 · parseSceneAssetEntry 头部绑定键双语法', () => {
  it('module:<id> → target {kind:"module"}；phaseIdx 保持 null（不参与 V1 映射）', () => {
    const content = [
      '<!--ENG-SCENE-ASSET',
      'scene: scene.station.orbital',
      'hotspot: core | 核心舱 | 指挥舱段 | module:core',
      'hotspot: hab | 居住舱 | 生活舱段 | module:hab',
      '-->',
      '<svg viewBox="0 0 4 4"><g data-view="a">',
      '<g data-hotspot="core" data-module-id="core"><rect width="1" height="1"/></g>',
      '<g data-hotspot="hab" data-module-id="hab"><rect width="1" height="1"/></g>',
      '</g></svg>',
    ].join('\n');
    const def = parseSceneAssetEntry(content, '轨道空间站');
    expect(def?.hotspots).toEqual([
      { id: 'core', label: '核心舱', desc: '指挥舱段', phaseIdx: null, target: { kind: 'module', id: 'core' } },
      { id: 'hab', label: '居住舱', desc: '生活舱段', phaseIdx: null, target: { kind: 'module', id: 'hab' } },
    ]);
  });

  it('legacy 整数绑定键 → phaseIdx 原口径（V1 资产零迁移）；坏 target（module: 空串/负数）→ 中立常亮', () => {
    const content = [
      '<!--ENG-SCENE-ASSET',
      'scene: scene.x',
      'hotspot: a | 甲 | 描述 | 2',
      'hotspot: bad | 坏 | 空 module | module:',
      'hotspot: neg | 负 | 负数 | -1',
      '-->',
      '<svg viewBox="0 0 4 4"><g data-view="a">',
      '<g data-hotspot="a"><rect width="1" height="1"/></g>',
      '<g data-hotspot="bad"><rect width="1" height="1"/></g>',
      '<g data-hotspot="neg"><rect width="1" height="1"/></g>',
      '</g></svg>',
    ].join('\n');
    const def = parseSceneAssetEntry(content, 'X');
    expect(def?.hotspots[0]).toEqual({ id: 'a', label: '甲', desc: '描述', phaseIdx: 2, target: undefined });
    expect(def?.hotspots[1].target).toBeUndefined();
    expect(def?.hotspots[1].phaseIdx).toBeNull();
    expect(def?.hotspots[2].phaseIdx).toBeNull();
  });
});

describe('V2-06 · hotspotTarget 兼容映射与模块着色', () => {
  it('显式 target 优先；缺省时 phaseIdx 等价映射 {kind:"phase", id}；双空 = null 中立', () => {
    expect(hotspotTarget({ phaseIdx: 3, target: { kind: 'module', id: 'core' } })).toEqual({ kind: 'module', id: 'core' });
    expect(hotspotTarget({ phaseIdx: 3 })).toEqual({ kind: 'phase', id: 3 });
    expect(hotspotTarget({ phaseIdx: null })).toBeNull();
  });

  it('hotspotStateForTarget：模块五态同 phase 色板（未启动/取消=置灰 pending）', () => {
    const modules: ModuleSlice[] = [
      { id: 'a', status: '完工' },
      { id: 'b', status: '进行中' },
      { id: 'c', status: '暂停' },
      { id: 'd', status: '未启动' },
      { id: 'e', status: '取消' },
    ];
    expect(hotspotStateForTarget({ kind: 'module', id: 'a' }, [], modules)).toBe('done');
    expect(hotspotStateForTarget({ kind: 'module', id: 'b' }, [], modules)).toBe('active');
    expect(hotspotStateForTarget({ kind: 'module', id: 'c' }, [], modules)).toBe('paused');
    expect(hotspotStateForTarget({ kind: 'module', id: 'd' }, [], modules)).toBe('pending');
    expect(hotspotStateForTarget({ kind: 'module', id: 'e' }, [], modules)).toBe('pending');
    expect(hotspotStateForTarget({ kind: 'module', id: 'missing' }, [], modules)).toBe('pending'); // 实例无此模块 → 置灰
    expect(hotspotStateForTarget({ kind: 'module', id: 'a' }, [])).toBe('pending'); // 无 V2 实例 → 置灰（对齐 V1 无实例口径）
  });

  it('phase 目标 = 旧 hotspotStateFor 同值（等价映射回归）；null 目标 = idle', () => {
    const phases = [
      { idx: 0, status: '完工' as const },
      { idx: 1, status: '进行中' as const },
    ];
    const phaseTarget: EngSceneTarget = { kind: 'phase', id: 0 };
    expect(hotspotStateForTarget(phaseTarget, phases)).toBe(hotspotStateFor(0, phases));
    expect(hotspotStateForTarget({ kind: 'phase', id: 1 }, phases)).toBe('active');
    expect(hotspotStateForTarget(null, phases)).toBe('idle');
  });

  it('hotspotStates：V2 工程实例传入时按 modules[].status 着色（模块热点+中立热点混合）', async () => {
    const scene = await loadStationScene();
    expect(hotspotStates(scene, [], STATION_MODULES)).toEqual({
      core: 'done',
      hab: 'active',
      lab: 'paused',
      solar: 'pending',
      dock: 'pending',
      cupola: 'idle',
    });
  });
});

/* ═══════════════ ③ 场景注册表与 resolveScene ═══════════════ */

describe('V2-06 · 场景注册表（SCENE_REGISTRY）', () => {
  it('scene.station.orbital 已注册（title=轨道空间站，无内置=资产驱动）；通用车间带内置装配器', () => {
    expect(SCENE_REGISTRY.map(s => s.id)).toContain(STATION_ORBITAL_SCENE_ID);
    expect(findSceneSpec(STATION_ORBITAL_SCENE_ID)?.title).toBe('轨道空间站');
    expect(findSceneSpec(STATION_ORBITAL_SCENE_ID)?.builtin).toBeUndefined();
    expect(findSceneSpec(GENERIC_SCENE_ID)?.builtin).toBeTypeOf('function');
    expect(findSceneSpec('scene.unknown.x')).toBeUndefined();
    expect(findSceneSpec(undefined)).toBeUndefined();
  });

  it('resolveScene：资产优先；注册未配内置/未知 id → 通用车间（fail-closed，D23）', async () => {
    const asset = await loadStationScene();
    expect(resolveScene(STATION_ORBITAL_SCENE_ID, asset)).toBe(asset); // 资产优先（世界书条目命中后）
    expect(resolveScene(STATION_ORBITAL_SCENE_ID, null).id).toBe(GENERIC_SCENE_ID); // V2-08 入书前的兜底
    expect(resolveScene('scene.unknown.future', null).id).toBe(GENERIC_SCENE_ID);
    expect(resolveScene(GENERIC_SCENE_ID, null).id).toBe(GENERIC_SCENE_ID);
  });
});

/* ═══════════════ ④ fixture 资产契约（uid24 条目格式对齐，V2-08 直接入书） ═══════════════ */

describe('V2-06 · 空间站资产 fixture（tests/fixtures/eng-scene-station-asset.json）', () => {
  it('uid24 条目形状：⚠ 警告名 + 禁用态 + 零触发词 + 不参与 catalog 合并链', async () => {
    const fixture = await loadStationFixture();
    expect(fixture.name).toBe(assetEntryName('轨道空间站'));
    expect(fixture.comment).toBe(fixture.name);
    expect(fixture.disable).toBe(true); // 禁用态：LLM 零注入（wb-disabled-entry-read 先例）
    expect(fixture.constant).toBe(false);
    expect(fixture.key).toEqual([]);
    expect(fixture.content).not.toContain('<数据>');
  });

  it('零漂移：.json content === .svg 源文件（单一事实源）', async () => {
    const fs = await nodeFs;
    const fixture = await loadStationFixture();
    expect(fixture.content).toBe(fs.readFileSync(FIXTURE_SVG_URL, 'utf8'));
  });

  it('解析契约：scene id/标题/三视角×中文标签/六热点（五模块绑定 + 一中立）', async () => {
    const scene = await loadStationScene();
    expect(scene.id).toBe(STATION_ORBITAL_SCENE_ID);
    expect(scene.title).toBe('轨道空间站');
    expect(scene.viewBox).toBe('0 0 640 360');
    expect(listViews(scene)).toEqual([
      { id: 'overview', label: '总览' },
      { id: 'section', label: '舱段剖面' },
      { id: 'dock', label: '对接口特写' },
    ]);
    expect(scene.hotspots.map(h => [h.id, h.target?.kind ?? 'neutral'])).toEqual([
      ['core', 'module'],
      ['hab', 'module'],
      ['lab', 'module'],
      ['solar', 'module'],
      ['dock', 'module'],
      ['cupola', 'neutral'],
    ]);
    for (const id of ['core', 'hab', 'lab', 'solar', 'dock']) {
      expect(scene.hotspots.find(h => h.id === id)?.target).toEqual({ kind: 'module', id });
    }
  });

  it('渲染契约：每视角产出完整 svg；舱段剖面含五个 data-module-id 命名节点；载荷零内联事件/零 style', async () => {
    const scene = await loadStationScene();
    for (const v of listViews(scene)) {
      const svg = renderSceneSvg(scene, v.id);
      expect(svg).toContain(`data-scene="${STATION_ORBITAL_SCENE_ID}"`);
      expect(svg).toContain(`data-view-active="${v.id}"`);
    }
    const section = renderSceneSvg(scene, 'section');
    for (const id of ['core', 'hab', 'lab', 'solar', 'dock']) {
      expect(section).toContain(`data-hotspot="${id}" data-module-id="${id}"`);
    }
    expect(section).not.toContain('data-module-id="cupola"'); // 中立热点不带模块绑定
    // FORBIDDEN_PATTERN 同口径静态钉死（D24：点击纯读取，SVG 内禁止内联事件处理器）
    expect(section).not.toMatch(/<\s*(script|foreignObject|style)\b|javascript:|\son[a-zA-Z]+\s*=/i);
  });
});

/* ═══════════════ ⑤ 渲染冒烟（最小 DOM shim：视角/热点节点存在 + 点击派发） ═══════════════ */

interface MicroNode {
  tag: string;
  attrs: Record<string, string>;
  children: MicroNode[];
  parent: MicroNode | null;
  getAttribute(name: string): string | null;
  closest(selector: string): MicroNode | null;
  queryAll(selector: string): MicroNode[];
}

function parseSvgDom(source: string): MicroNode {
  const root: MicroNode = microNode('#document', {}, null);
  const stack: MicroNode[] = [root];
  const tokenRe = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>|[^<]+/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(source)) !== null) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {
      // 闭合标签：弹栈到匹配标签（容错：不匹配则忽略）
      const closeTag = m[1];
      const idx = [...stack].reverse().findIndex(n => n.tag === closeTag);
      if (idx >= 0) stack.length = stack.length - idx - 1;
    } else if (m[2] !== undefined) {
      const attrs: Record<string, string> = {};
      const attrRe = /([\w:.-]+)="([^"]*)"/g;
      let am: RegExpExecArray | null;
      while ((am = attrRe.exec(m[3] ?? '')) !== null) attrs[am[1]] = am[2];
      const node = microNode(m[2], attrs, top);
      top.children.push(node);
      if (m[4] !== '/') stack.push(node); // 非自闭合 → 入栈
    }
    // 文本节点与注释不进树（冒烟断言只需元素结构）
  }
  return root;
}

function microNode(tag: string, attrs: Record<string, string>, parent: MicroNode | null): MicroNode {
  return {
    tag,
    attrs,
    children: [],
    parent,
    getAttribute(name: string) {
      return name in attrs ? attrs[name] : null;
    },
    closest(selector: string) {
      const attr = selector.match(/^\[([\w:.-]+)\]$/)?.[1];
      if (!attr) return null;
      let cur: MicroNode | null = this;
      while (cur) {
        if (attr in cur.attrs) return cur;
        cur = cur.parent;
      }
      return null;
    },
    queryAll(selector: string): MicroNode[] {
      const attr = selector.match(/^\[([\w:.-]+)\]$/)?.[1];
      if (!attr) return [];
      const out: MicroNode[] = [];
      const walk = (n: MicroNode) => {
        if (attr in n.attrs) out.push(n);
        for (const c of n.children) walk(c);
      };
      walk(this);
      return out;
    },
  };
}

describe('V2-06 · 空间站资产渲染冒烟（DOM shim：节点存在 + 点击派发）', () => {
  it('视角/热点节点存在：三视角渲染产物各含 3~5 个命名热点，viewBox 画布内', async () => {
    const scene = await loadStationScene();
    const counts: Record<string, number> = { overview: 5, section: 5, dock: 2 };
    for (const v of listViews(scene)) {
      const dom = parseSvgDom(renderSceneSvg(scene, v.id, hotspotStates(scene, [], STATION_MODULES)));
      const svgEl = dom.children.find(n => n.tag === 'svg')!;
      expect(svgEl.getAttribute('data-view-active')).toBe(v.id);
      expect(svgEl.getAttribute('data-scene')).toBe(STATION_ORBITAL_SCENE_ID);
      const hotspots = dom.queryAll('[data-hotspot]');
      expect(hotspots).toHaveLength(counts[v.id]);
      for (const hs of hotspots) expect(hs.getAttribute('data-hotspot')).toBeTruthy();
    }
    const sectionDom = parseSvgDom(renderSceneSvg(scene, 'section', {}));
    expect(sectionDom.queryAll('[data-module-id]').map(n => n.getAttribute('data-module-id')).sort()).toEqual([
      'core',
      'dock',
      'hab',
      'lab',
      'solar',
    ]);
  });

  it('点击派发（D24 纯读取）：命中热点组内子节点 → hotspotFromDomTarget 出模块载荷；空白处 → null', async () => {
    const scene = await loadStationScene();
    const states = hotspotStates(scene, [], STATION_MODULES);
    const dom = parseSvgDom(renderSceneSvg(scene, 'section', states));
    // 点击「核心舱」热点的芯点（组内子节点）：事件代理应归约到命名节点并派发模块信息
    const coreGroup = dom.queryAll('[data-hotspot]').find(n => n.getAttribute('data-hotspot') === 'core')!;
    const coreCircle = coreGroup.children.find(c => c.tag === 'circle' && c.getAttribute('class') === 'hs-core')!;
    const payload = hotspotFromDomTarget(coreCircle, scene, states);
    expect(payload).toEqual({
      id: 'core',
      label: '核心舱',
      desc: scene.hotspots.find(h => h.id === 'core')!.desc,
      phaseIdx: null,
      target: { kind: 'module', id: 'core' },
      state: 'done',
    });
    // 点击非热点节点（背景矩形）→ 不派发
    const bg = dom.queryAll('[data-hotspot]').length; // sanity：树内有热点
    expect(bg).toBeGreaterThan(0);
    const plain = coreGroup.parent!.children.find(c => c.tag === 'rect') ?? null;
    expect(hotspotFromDomTarget(plain, scene, states)).toBeNull();
    expect(hotspotFromDomTarget(null, scene, states)).toBeNull();
  });

  it('REDUCED-MOTION 降级对照（D23 先例）：资产热点复用 hs-halo/hs-core 类词汇 → 组件 CSS 降级规则覆盖；源码含媒体查询', async () => {
    const scene = await loadStationScene();
    const svg = renderSceneSvg(scene, 'overview');
    expect(svg).toContain('class="hs-halo"');
    expect(svg).toContain('class="hs-core"');
    const fs = await nodeFs;
    const src = fs.readFileSync(new URL('../panels/EngSceneView.vue', import.meta.url), 'utf8');
    expect(src).toContain('.eng-scene-view--rm .hs-halo');
    expect(src).toContain('prefers-reduced-motion: reduce');
  });
});

/* ═══════════════ ⑥ EngSceneView 接通 catalog project def.scene（SSR 首帧） ═══════════════ */

const SCENE_SFC_URL = new URL('../panels/EngSceneView.vue', import.meta.url);
const SCENE_COMPILED_URL = new URL('../panels/EngSceneView.__ssr_v206__.mts', import.meta.url);

let sceneComponentPromise: Promise<Component> | undefined;

function loadSceneComponent(): Promise<Component> {
  sceneComponentPromise ??= (async () => {
    const fs = await nodeFs;
    const source = fs.readFileSync(SCENE_SFC_URL, 'utf8');
    const { descriptor, errors } = parse(source, { filename: 'EngSceneView.vue' });
    if (errors.length > 0) throw new Error(`EngSceneView.vue 解析失败：${errors.map(String).join('; ')}`);
    const compiled = compileScript(descriptor, {
      id: 'engsceneviewssrv206',
      inlineTemplate: true,
      templateOptions: { id: 'engsceneviewssrv206', scoped: descriptor.styles.some(s => s.scoped) },
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

const STATION_DEF: ProjectDef = {
  kind: 'project',
  id: 'all.project.station',
  name: '轨道空间站',
  desc: '近地轨道模块化空间站：核心舱/居住舱/实验舱/太阳能翼/对接口五仓段拓扑。',
  grade: '巨构',
  scope: 'theater',
  modules: [
    { id: 'core', name: '核心舱', cost: 300000, workload: { days: 30, min_days: 15 }, prereqs: [] },
    { id: 'hab', name: '居住舱', cost: 120000, workload: { days: 18, min_days: 9 }, prereqs: ['core'] },
    { id: 'lab', name: '实验舱', cost: 110000, workload: { days: 16, min_days: 8 }, prereqs: ['core'] },
    { id: 'solar', name: '太阳能翼', cost: 80000, workload: { days: 12, min_days: 6 }, prereqs: ['core'] },
    { id: 'dock', name: '对接口', cost: 90000, workload: { days: 10, min_days: 5 }, prereqs: ['core'] },
  ],
  scene: STATION_ORBITAL_SCENE_ID, // V2-04 透传位 → V2-06 接通：def.scene → 场景解析
};

const STATION_PROJECT: Project = {
  id: 'proj:station-v206',
  ref: '轨道空间站',
  scope: 'theater',
  bases: ['beipo', 'orbital'],
  lead_base: 'beipo',
  grade: '巨构',
  status: '在建',
  outcome: { type: 'mark' },
  modules: [
    { id: 'core', name: '核心舱', status: '完工', base: 'beipo', queue_index: null },
    { id: 'hab', name: '居住舱', status: '进行中', base: 'beipo', queue_index: 3 },
    { id: 'lab', name: '实验舱', status: '暂停', base: 'orbital', queue_index: null },
    { id: 'solar', name: '太阳能翼', status: '未启动', base: 'orbital', queue_index: null },
    { id: 'dock', name: '对接口', status: '未启动', base: 'orbital', queue_index: null },
  ],
  schema_version: 2,
};

describe('V2-06 · EngSceneView 接通 project def.scene（SSR 首帧）', () => {
  it('V2 工程定义 + V2 实例入参：SSR 首帧 fail-closed 内置兜底（资产未入书前=通用车间），零崩溃', async () => {
    const Comp = await loadSceneComponent();
    const html = await renderToString(
      createSSRApp({ render: () => h(Comp, { def: STATION_DEF, project: STATION_PROJECT }) }),
    );
    expect(html).toContain('通用改装车间'); // V2-08 入书前的 fail-closed 兜底（D23）
    expect(html).toContain('内置通用场景');
    expect(html).toContain('data-view-active="overview"');
  });

  it('retrofit def（V1）入参回归：SSR 首帧不受影响（向后兼容）', async () => {
    const Comp = await loadSceneComponent();
    const retrofitDef: RetrofitDef = {
      kind: 'retrofit',
      name: '灰熊坦克现代化改装工程',
      research: '混合动力装甲工学',
      grade: '大改',
      desc: '混动APU+主动防御系统+车际数据网络。',
    };
    const html = await renderToString(createSSRApp({ render: () => h(Comp, { def: retrofitDef, project: null }) }));
    expect(html).toContain('通用改装车间');
    for (const hs of ['chassis', 'power', 'defense', 'network', 'acceptance']) {
      expect(html).toContain(`data-hotspot="${hs}"`);
    }
  });

  it('源码接线点：def.scene → sceneId 路由进 loadSceneAsset；resolveScene 消费注册表；V2 实例走 modules 着色分支', async () => {
    const fs = await nodeFs;
    const src = fs.readFileSync(SCENE_SFC_URL, 'utf8');
    expect(src).toContain('loadSceneAsset(props.def.name, undefined, sceneId.value)');
    expect(src).toContain('return resolveScene(sceneId.value)');
    expect(src).toContain('isProjectV2(project)');
    expect(src).toContain('hotspotStates(scene.value, [], project.modules)');
  });
});
