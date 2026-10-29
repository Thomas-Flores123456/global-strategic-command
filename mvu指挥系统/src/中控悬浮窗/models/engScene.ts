/**
 * engScene.ts —— ENG-UI-02 SVG 场景引擎·纯函数模块（D18v2 / D22 / D23 / D24）
 *
 * 契约来源：
 * - 任务包 §3.7：场景引擎数据驱动，按 `scene` id 装配；多视角 = 单 SVG 分层 `<g data-view>`（首选方案，
 *   视角切换为纯 UI 状态，不进 MVU）；热点 = 命名节点 `data-hotspot`，点亮/置灰由 `projects[]` 阶段状态驱动；
 *   点击热点 = 纯读取；动效遵守 prefers-reduced-motion。
 * - 任务包 §3.7 + 决策记录 §10：世界书资产条目 `⚠SVG资产·<工程名>·勿启用`（禁用态，LLM 零注入），
 *   热点映射表放条目头部注释；条目不写 <数据> 块、不参与 catalog 合并链。
 * - D23：MVP 期 23 项改装共用一张通用车间场景（scene.workshop.generic），专属场景在 Growth。
 * - V2-06（仓段化V2设计案 §5）：热点绑定键扩为 target {kind:'phase'|'module'}（旧 phaseIdx 等价映射）；
 *   场景注册表（SCENE_REGISTRY）接通 catalog def.scene → 场景解析；模块热点按 modules[].status 同 phase 色板着色。
 *
 * 本模块零宿主依赖、零写操作：世界书读取在 engSceneAsset.ts（deps 注入），此处只做解析/装配/渲染字符串。
 * vitest node 环境直测；SVG 以字符串产出，由 EngSceneView.vue 经 v-html 挂载（fail-closed 消毒见 sanitize）。
 */
import type { ProjectModule, ProjectPhase } from '../../红警指挥系统/core/schema';

/* ═══════════════ 类型 ═══════════════ */

/**
 * 场景热点目标（V2-06 · 仓段化V2设计案 §5）：
 * - phase：V1 阶段映射（id 对齐 projects[].phases[].idx，0 起）；
 * - module：V2 模块映射（id 对齐运行时 ProjectModule.id / 世界书 modules[].id）。
 */
export type EngSceneTarget = { kind: 'phase'; id: number } | { kind: 'module'; id: string };

/** 场景热点（命名节点）：phaseIdx 为 V1 阶段映射（0 起，对齐 projects[].phases[].idx）；null = 中立常亮。
 *  V2-06 起热点可声明 target 绑定模块（资产头部 `module:<id>` 语法）；缺省 target 时 phaseIdx 等价映射 {kind:'phase', id}。 */
export interface EngSceneHotspot {
  id: string;
  label: string;
  desc: string;
  phaseIdx: number | null;
  /** V2-06 热点目标扩展：声明后优先于 phaseIdx（兼容映射见 hotspotTarget） */
  target?: EngSceneTarget;
}

/** 单视角层（对应 `<g data-view="id">` 的内部片段） */
export interface EngSceneView {
  id: string;
  label: string;
  svg: string;
}

export interface EngSceneDef {
  id: string;
  title: string;
  viewBox: string;
  views: EngSceneView[];
  hotspots: EngSceneHotspot[];
  source: 'builtin' | 'worldbook';
}

/** 热点点亮状态（由 phases 驱动；idle=无实例/中立，pending=未启动，active=进行中，paused=暂停，done=完工） */
export type HotspotState = 'idle' | 'pending' | 'active' | 'paused' | 'done';

export type PhaseSlice = Pick<ProjectPhase, 'idx' | 'status'>;

/** 模块切片（V2-06）：与 PhaseSlice 同构口径，模块热点状态推导用 */
export type ModuleSlice = Pick<ProjectModule, 'id' | 'status'>;

/** 热点点击事件载荷（emit 给父级弹信息，纯读取，零写操作） */
export interface EngSceneHotspotEvent extends EngSceneHotspot {
  state: HotspotState;
}

/** 事件代理目标最小契约（D24 纯读取）：宿主 Element 结构性满足，测试 DOM shim 同构复用 */
export interface EngSceneDomTarget {
  closest?(selector: string): EngSceneDomNode | null;
}

export interface EngSceneDomNode {
  getAttribute?(name: string): string | null;
}

/* ═══════════════ 常量与命名约定 ═══════════════ */

/** D23：MVP 期 23 项改装共用的通用车间场景 id（骨架期代码侧默认映射，ENG-WB-01 回填后由 retrofit.scene 贯通） */
export const GENERIC_SCENE_ID = 'scene.workshop.generic';

export const DEFAULT_VIEW_BOX = '0 0 640 360';

/** 资产条目名约定（决策记录 §10）：`⚠SVG资产·<工程名>·勿启用` */
export function assetEntryName(projectName: string): string {
  return `⚠SVG资产·${projectName}·勿启用`;
}

/** 骨架期代码侧默认映射：任何未声明 scene 的 retrofit 一律落到通用车间场景 */
export function defaultSceneId(scene?: string | null): string {
  return scene && scene.trim() !== '' ? scene : GENERIC_SCENE_ID;
}

/* ═══════════════ 世界书资产条目解析（fail-closed） ═══════════════ */

/**
 * 消毒红线：资产条目内容是宿主世界书原文，挂载前必须过此关。
 * 命中任一危险特征 → 整条目判废（返回 null 走内置回退），不做局部清洗（避免半清半留的歧义面）。
 */
const FORBIDDEN_PATTERN =
  /<\s*(script|foreignObject|iframe|object|embed|link|meta|style)\b|javascript:|data\s*:\s*text\/html|\son[a-zA-Z]+\s*=/i;

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 平衡扫描提取顶层 `<g data-view="...">` 层（正则无法处理嵌套分组，这里手工配平）。
 * 未闭合的层丢弃（容错）；嵌套在内层视角里的 data-view 归父层内容，不再独立成层。
 */
function extractViewGroups(svgInner: string): { id: string; svg: string }[] {
  const groups: { id: string; svg: string }[] = [];
  const openRe = /<g\b[^>]*\bdata-view="([^"]+)"[^>]*>/g;
  let coveredUntil = -1;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(svgInner)) !== null) {
    if (m.index < coveredUntil) continue;
    const openEnd = m.index + m[0].length;
    const tagRe = /<g\b[^>]*>|<\/g>/g;
    tagRe.lastIndex = openEnd;
    let depth = 1;
    let closeStart = -1;
    let tm: RegExpExecArray | null;
    while ((tm = tagRe.exec(svgInner)) !== null) {
      if (tm[0].startsWith('</')) {
        depth -= 1;
        if (depth === 0) {
          closeStart = tm.index;
          break;
        }
      } else if (!tm[0].endsWith('/>')) {
        depth += 1;
      }
    }
    if (closeStart === -1) continue; // 未闭合 → 丢弃本层
    groups.push({ id: m[1], svg: svgInner.slice(openEnd, closeStart) });
    coveredUntil = closeStart + 4;
    openRe.lastIndex = coveredUntil;
  }
  return groups;
}

interface AssetHeader {
  sceneId?: string;
  title?: string;
  viewLabels: Map<string, string>;
  hotspots: EngSceneHotspot[];
}

/** 头部注释（热点映射表，决策记录 §10 约定）：<!--ENG-SCENE-ASSET ... --> 块内 `key: value` 行 */
function parseAssetHeader(content: string): AssetHeader | null {
  const m = content.match(/<!--\s*ENG-SCENE-ASSET([\s\S]*?)-->/);
  if (!m) return null;
  const header: AssetHeader = { viewLabels: new Map(), hotspots: [] };
  for (const rawLine of m[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    const kv = line.match(/^([A-Za-z]+)\s*:\s*(.+)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (key === 'scene') {
      header.sceneId = value.trim();
    } else if (key === 'title') {
      header.title = value.trim();
    } else if (key === 'view') {
      const [id, label] = value.split('|').map(s => s.trim());
      if (id) header.viewLabels.set(id, label || id);
    } else if (key === 'hotspot') {
      const [id, label, desc, targetField] = value.split('|').map(s => (s ?? '').trim());
      if (!id) continue;
      // 绑定键双语法（V2-06）：非负整数 = phaseIdx（V1）；module:<id> = 模块 target（V2）；缺省 = 中立常亮
      const rawTarget = targetField ?? '';
      let target: EngSceneTarget | undefined;
      let phaseIdx: number | null = null;
      if (rawTarget.startsWith('module:')) {
        const moduleId = rawTarget.slice('module:'.length).trim();
        if (moduleId !== '') target = { kind: 'module', id: moduleId };
      } else {
        const phaseNum = Number.parseInt(rawTarget, 10);
        phaseIdx = Number.isInteger(phaseNum) && phaseNum >= 0 ? phaseNum : null;
      }
      header.hotspots.push({
        id,
        label: label || id,
        desc: desc || '',
        phaseIdx,
        target,
      });
    }
  }
  return header;
}

/**
 * 解析世界书 SVG 资产条目内容 → EngSceneDef；任何畸形/危险输入 → null（调用方回退内置场景）。
 *
 * 条目格式（ENG-WB-01 落地时的约定，本函数即真机门复测的解析基准）：
 * ```
 * <!--ENG-SCENE-ASSET
 * scene: scene.workshop.generic
 * title: 通用改装车间
 * view: overview | 工位总览
 * hotspot: chassis | 底盘工位 | 底盘拆解与结构检修 | 0
 * hotspot: core | 核心舱 | 指挥与数据中心舱段 | module:core
 * -->
 * <svg viewBox="0 0 640 360"><g data-view="overview">…<g data-hotspot="chassis">…</g>…</g></svg>
 * ```
 * 热点第四段 = 绑定键：非负整数 → phaseIdx（V1 口径）；`module:<id>` → target {kind:'module'}（V2-06）；
 * 缺省/无法解析 → 中立常亮。节点侧可同时声明 data-module-id（模块绑定自描述，D22 数据在 SVG 内）。
 */
export function parseSceneAssetEntry(content: unknown, fallbackTitle = '工程场景'): EngSceneDef | null {
  if (typeof content !== 'string' || content.trim() === '') return null;
  if (FORBIDDEN_PATTERN.test(content)) return null;

  const svgMatch = content.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i);
  if (!svgMatch) return null;
  const svgOpen = svgMatch[1];
  const svgInner = svgMatch[2];

  const viewBoxMatch = svgOpen.match(/viewBox="([^"]+)"/i);
  const viewBox = viewBoxMatch ? viewBoxMatch[1] : DEFAULT_VIEW_BOX;

  const header = parseAssetHeader(content);
  const viewGroups = extractViewGroups(svgInner);
  // 容错：无 data-view 分层时整体视作单视角「主视角」
  const views: EngSceneView[] =
    viewGroups.length > 0
      ? viewGroups.map(g => ({ id: g.id, label: header?.viewLabels.get(g.id) ?? g.id, svg: g.svg }))
      : [{ id: 'main', label: header?.viewLabels.get('main') ?? '主视角', svg: svgInner }];
  if (views.every(v => v.svg.trim() === '')) return null; // 全空层 = 畸形载荷

  // 热点：头部映射表为准；未声明时从 SVG 自动发现（label 回退为 id，中立常亮）
  let hotspots = header?.hotspots ?? [];
  if (hotspots.length === 0) {
    const ids = new Set<string>();
    const hsRe = /\bdata-hotspot="([^"]+)"/g;
    let hm: RegExpExecArray | null;
    while ((hm = hsRe.exec(svgInner)) !== null) ids.add(hm[1]);
    hotspots = [...ids].map(id => ({ id, label: id, desc: '', phaseIdx: null }));
  } else {
    // 声明了但 SVG 无对应命名节点 → 丢弃该声明（容错，不判废整条目）
    hotspots = hotspots.filter(h => new RegExp(`\\bdata-hotspot="${escapeRegExp(h.id)}"`).test(svgInner));
  }

  return {
    id: header?.sceneId ?? 'scene.worldbook.custom',
    title: header?.title ?? fallbackTitle,
    viewBox,
    views,
    hotspots,
    source: 'worldbook',
  };
}

/* ═══════════════ 场景注册表与装配（V2-06 · D22 场景引擎化） ═══════════════ */

/** 轨道空间站场景 id（V2-06 注册；资产条目落《工程·通用》D-C5，物理入书归 V2-08） */
export const STATION_ORBITAL_SCENE_ID = 'scene.station.orbital';

/** 天基测控与发射大厅场景 id（PKG-A 内置三视角场景：pad / leo / tli） */
export const AEROSPACE_MCC_SCENE_ID = 'scene.aerospace.mcc';

/** 注册场景规格：builtin 缺省 = 无内置兑底，回退通用车间（fail-closed，D23） */
export interface EngSceneSpec {
  id: string;
  /** 场景名（注册语义；未配资产时的占位识别） */
  title: string;
  /** 内置装配器（无声明 = 无内置兑底） */
  builtin?: () => EngSceneDef;
}

/**
 * 场景注册表（V2-06）：已知 scene id 清单。
 * - resolveScene 兑底解析消费；engSceneAsset 跨书路由以 scene id 前缀对齐本表；
 * - 空间站（scene.station.*）资产落《工程·通用》（D-C5）；Growth 可补内置精修（D24 旗舰定制）。
 */
export const SCENE_REGISTRY: readonly EngSceneSpec[] = [
  { id: GENERIC_SCENE_ID, title: '通用改装车间', builtin: buildGenericWorkshopScene },
  { id: STATION_ORBITAL_SCENE_ID, title: '轨道空间站' },
  { id: AEROSPACE_MCC_SCENE_ID, title: '天基测控与发射大厅', builtin: buildAerospaceMccScene },
];

export function findSceneSpec(sceneId: string | null | undefined): EngSceneSpec | undefined {
  const id = (sceneId ?? '').trim();
  return id === '' ? undefined : SCENE_REGISTRY.find(s => s.id === id);
}

/**
 * 场景装配入口（D22 / V2-06 注册表接通 catalog def.scene → 场景解析）：
 * 世界书资产优先；无资产 → 注册表内置装配器；未注册 id / 注册未配内置 → 内置通用车间
 * （fail-closed，D23——空间站资产由 V2-08 落《工程·通用》前同样回退）。
 */
export function resolveScene(sceneId: string | null | undefined, asset?: EngSceneDef | null): EngSceneDef {
  if (asset) return asset;
  const spec = findSceneSpec(defaultSceneId(sceneId));
  return spec?.builtin ? spec.builtin() : buildGenericWorkshopScene();
}

/* ═══════════════ 热点目标与状态推导（V2-06 target 扩展） ═══════════════ */

/** 热点目标归一（V2-06 兼容映射）：显式 target 优先；否则 phaseIdx 等价映射 {kind:'phase', id}；null = 中立常亮 */
export function hotspotTarget(hotspot: Pick<EngSceneHotspot, 'phaseIdx' | 'target'>): EngSceneTarget | null {
  if (hotspot.target) return hotspot.target;
  return hotspot.phaseIdx == null ? null : { kind: 'phase', id: hotspot.phaseIdx };
}

/** 状态枚举 → 热点点亮态（phase/module 同色板：完工=done 进行中=active 暂停=paused 未启动/取消=pending） */
function statusToHotspotState(status: PhaseSlice['status'] | ModuleSlice['status']): HotspotState {
  switch (status) {
    case '完工':
      return 'done';
    case '进行中':
      return 'active';
    case '暂停':
      return 'paused';
    default: // 未启动 / 取消
      return 'pending';
  }
}

/** 单热点状态推导（纯映射：phaseIdx ↔ phases[].idx） */
export function hotspotStateFor(phaseIdx: number | null, phases: readonly PhaseSlice[]): HotspotState {
  if (phaseIdx == null) return 'idle';
  const phase = phases.find(p => p.idx === phaseIdx);
  if (!phase) return 'pending';
  return statusToHotspotState(phase.status);
}

/**
 * 单热点状态推导·目标口径（V2-06）：phase 目标走 V1 阶段映射；module 目标按 modules[].status
 * （ProjectModule.status 与 ProjectPhase.status 同枚举，五态同 phase 色板）；目标缺省 = idle 中立。
 */
export function hotspotStateForTarget(
  target: EngSceneTarget | null,
  phases: readonly PhaseSlice[],
  modules: readonly ModuleSlice[] = [],
): HotspotState {
  if (!target) return 'idle';
  if (target.kind === 'module') {
    const module = modules.find(m => m.id === target.id);
    if (!module) return 'pending';
    return statusToHotspotState(module.status);
  }
  return hotspotStateFor(target.id, phases);
}

/** 全场景热点状态：phases 驱动 V1 阶段热点；modules 驱动 V2 模块热点（V2 工程实例传入时按 modules[].status 着色） */
export function hotspotStates(
  scene: EngSceneDef,
  phases: readonly PhaseSlice[],
  modules: readonly ModuleSlice[] = [],
): Record<string, HotspotState> {
  const out: Record<string, HotspotState> = {};
  for (const h of scene.hotspots) out[h.id] = hotspotStateForTarget(hotspotTarget(h), phases, modules);
  return out;
}

/**
 * 事件代理解析（D24 点击纯读取）：点击/键盘目标 → 热点信息载荷；未命中命名节点 → null。
 * EngSceneView @click 直接消费；测试 DOM shim 以结构性契约同构复用同一代码路径。
 */
export function hotspotFromDomTarget(
  target: EngSceneDomTarget | null | undefined,
  scene: EngSceneDef,
  states: Record<string, HotspotState>,
): EngSceneHotspotEvent | null {
  const node = target?.closest?.('[data-hotspot]');
  const id = node?.getAttribute?.('data-hotspot');
  if (!id) return null;
  const hs = scene.hotspots.find(h => h.id === id);
  if (!hs) return null;
  return { ...hs, state: states[id] ?? 'idle' };
}

export function listViews(scene: EngSceneDef): { id: string; label: string }[] {
  return scene.views.map(v => ({ id: v.id, label: v.label }));
}

/** 给热点命名节点注入交互/状态属性（class 合并、可聚焦、aria）；v-html 挂载后由组件事件代理接管点击 */
function annotateHotspots(viewSvg: string, scene: EngSceneDef, states: Record<string, HotspotState>): string {
  return viewSvg.replace(/<g\b[^>]*\bdata-hotspot="([^"]+)"[^>]*>/g, (tag, id: string) => {
    const hs = scene.hotspots.find(h => h.id === id);
    if (!hs) return tag;
    const state = states[id] ?? 'idle';
    const inject = ` tabindex="0" role="button" aria-label="${escapeAttr(`热点·${hs.label}`)}"`;
    const classBit = `eng-hs eng-hs--${state}`;
    const classMatch = tag.match(/\sclass="([^"]*)"/);
    if (classMatch) {
      const merged = tag.replace(classMatch[0], ` class="${classMatch[1]} ${classBit}"`);
      return `${merged.slice(0, -1)}${inject}>`;
    }
    return `${tag.slice(0, -1)} class="${classBit}"${inject}>`;
  });
}

/**
 * 渲染单视角完整 `<svg>` 字符串（视角切换=换渲染，纯 UI 状态）。
 * viewId 未知时回退首个视角；场景无视角 → 空串（组件侧不应发生，防御兜底）。
 */
export function renderSceneSvg(
  scene: EngSceneDef,
  viewId: string | null | undefined,
  states: Record<string, HotspotState> = {},
): string {
  const view = scene.views.find(v => v.id === viewId) ?? scene.views[0];
  if (!view) return '';
  const inner = annotateHotspots(view.svg, scene, states);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${escapeAttr(scene.viewBox)}" ` +
    `class="eng-scene-svg" data-scene="${escapeAttr(scene.id)}" data-view-active="${escapeAttr(view.id)}" ` +
    `role="group" aria-label="${escapeAttr(scene.title)}">${inner}</svg>`
  );
}

/* ═══════════════ 内置通用车间场景（D24：程序化参数 SVG 打底） ═══════════════ */

/** RAC 中控台色板（对齐 ModalEngineering/ConsoleBuildGrid 现有视觉变量取值） */
const PAL = {
  bg: '#0c1113',
  panel: '#0f1619',
  dim: '#2c3b40',
  line: '#5f7c84',
  accent: '#38bdf8',
  warn: '#d2ad69',
  text: '#cfdde0',
  muted: '#8aa1a7',
} as const;

function rect(x: number, y: number, w: number, h: number, extra = ''): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${extra}/>`;
}

function lineSeg(x1: number, y1: number, x2: number, y2: number, extra = ''): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${extra}/>`;
}

function circle(cx: number, cy: number, r: number, extra = ''): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" ${extra}/>`;
}

function label(x: number, y: number, text: string, cls = 'sc-label'): string {
  return `<text class="${cls}" x="${x}" y="${y}">${text}</text>`;
}

/** 热点命名节点：脉冲光环 + 芯点 + 文字标签（状态色由组件 CSS 按 eng-hs--<state> 着色） */
function hotspotNode(id: string, x: number, y: number, text: string, labelDx = 12, labelDy = -12): string {
  return (
    `<g data-hotspot="${id}">` +
    circle(x, y, 13, 'class="hs-halo" fill="none" stroke-width="1.5"') +
    circle(x, y, 3.5, 'class="hs-core"') +
    `<text class="hs-label" x="${x + labelDx}" y="${y + labelDy}">${text}</text>` +
    `</g>`
  );
}

/** 车间地景公共件：地坪线 + 透视网格 + 龙门吊横梁立柱 */
function workshopFloor(): string {
  const parts: string[] = [
    rect(0, 0, 640, 360, `fill="${PAL.bg}"`),
    lineSeg(0, 300, 640, 300, `stroke="${PAL.line}" stroke-width="1.5"`),
  ];
  for (let i = 1; i <= 5; i += 1) {
    parts.push(lineSeg(0, 300 + i * 11, 640, 300 + i * 11, `stroke="${PAL.dim}" stroke-width="0.6" opacity="0.5"`));
  }
  for (let i = 0; i <= 10; i += 1) {
    const xTop = 320 + (i - 5) * 130;
    parts.push(lineSeg(i * 64, 300, xTop, 360, `stroke="${PAL.dim}" stroke-width="0.6" opacity="0.5"`));
  }
  // 龙门吊：双立柱 + 横梁 + 走行小车
  parts.push(
    rect(48, 56, 10, 244, `fill="${PAL.panel}" stroke="${PAL.dim}" stroke-width="1"`),
    rect(582, 56, 10, 244, `fill="${PAL.panel}" stroke="${PAL.dim}" stroke-width="1"`),
    rect(40, 42, 560, 16, `fill="${PAL.panel}" stroke="${PAL.line}" stroke-width="1"`),
    rect(292, 46, 56, 9, `fill="${PAL.dim}"`),
  );
  return parts.join('');
}

/** 载具侧影（通用底盘+炮塔，车间台位上的被改装对象） */
function vehicleSilhouette(dx = 0, dy = 0): string {
  const parts: string[] = [
    rect(240 + dx, 218 + dy, 168, 40, `rx="5" fill="${PAL.panel}" stroke="${PAL.line}" stroke-width="1.2"`),
    rect(292 + dx, 194 + dy, 72, 26, `rx="3" fill="${PAL.panel}" stroke="${PAL.line}" stroke-width="1.2"`),
    lineSeg(364 + dx, 206 + dy, 430 + dx, 200 + dy, `stroke="${PAL.line}" stroke-width="3"`),
  ];
  for (let i = 0; i < 5; i += 1) {
    parts.push(circle(262 + i * 30 + dx, 266 + dy, 11, `fill="${PAL.bg}" stroke="${PAL.line}" stroke-width="1.2"`));
  }
  parts.push(lineSeg(408 + dx, 196 + dy, 408 + dx, 170 + dy, `stroke="${PAL.muted}" stroke-width="1.4"`));
  return parts.join('');
}

function overviewView(hotspots: EngSceneHotspot[]): string {
  const h = Object.fromEntries(hotspots.map(x => [x.id, x]));
  return [
    workshopFloor(),
    vehicleSilhouette(),
    label(16, 24, '通用改装车间 · 工位总览', 'sc-title'),
    label(470, 336, 'BAY-01 · 台位剖线 A-A', 'sc-dim-label'),
    hotspotNode('chassis', 262, 266, h.chassis?.label ?? '底盘工位', -12, 34),
    hotspotNode('power', 392, 236, h.power?.label ?? '动力包区', 14, -6),
    hotspotNode('defense', 328, 194, h.defense?.label ?? '防御集成站', -30, -20),
    hotspotNode('network', 408, 170, h.network?.label ?? '电子联调区', 14, -6),
    hotspotNode('acceptance', 544, 268, h.acceptance?.label ?? '出厂验收台', -28, -40),
    rect(516, 236, 56, 64, `fill="none" stroke="${PAL.dim}" stroke-width="1.2" stroke-dasharray="4 3"`),
  ].join('');
}

function sectionView(hotspots: EngSceneHotspot[]): string {
  const h = Object.fromEntries(hotspots.map(x => [x.id, x]));
  const parts: string[] = [
    rect(0, 0, 640, 360, `fill="${PAL.bg}"`),
    lineSeg(0, 250, 640, 250, `stroke="${PAL.line}" stroke-width="1.5"`),
    // 地坑剖面（下车体检修位）
    rect(200, 250, 240, 72, `fill="${PAL.panel}" stroke="${PAL.dim}" stroke-width="1.2"`),
    lineSeg(200, 264, 440, 264, `stroke="${PAL.dim}" stroke-width="0.8" stroke-dasharray="5 4"`),
    // 举升臂
    lineSeg(236, 250, 268, 196, `stroke="${PAL.line}" stroke-width="2.5"`),
    lineSeg(404, 250, 372, 196, `stroke="${PAL.line}" stroke-width="2.5"`),
    // 剖面上的车体
    vehicleSilhouette(0, -56),
    label(16, 24, '平台剖面 · 下车体检修坑', 'sc-title'),
    label(452, 306, 'PIT-02', 'sc-dim-label'),
  ];
  parts.push(
    hotspotNode('chassis', 320, 288, h.chassis?.label ?? '底盘工位', 14, 8),
    hotspotNode('power', 392, 180, h.power?.label ?? '动力包区', 14, -6),
    hotspotNode('defense', 328, 138, h.defense?.label ?? '防御集成站', -30, -18),
    hotspotNode('network', 408, 114, h.network?.label ?? '电子联调区', 14, -6),
    hotspotNode('acceptance', 544, 226, h.acceptance?.label ?? '出厂验收台', -28, -26),
  );
  return parts.join('');
}

function craneView(hotspots: EngSceneHotspot[]): string {
  const h = Object.fromEntries(hotspots.map(x => [x.id, x]));
  const parts: string[] = [
    workshopFloor(),
    // 吊装臂：塔身 + 回转臂 + 吊钩缆绳 + 吊运中的动力包
    rect(108, 58, 22, 242, `fill="${PAL.panel}" stroke="${PAL.line}" stroke-width="1.2"`),
    lineSeg(119, 66, 420, 96, `stroke="${PAL.line}" stroke-width="5"`),
    lineSeg(119, 66, 119, 42, `stroke="${PAL.dim}" stroke-width="1.2"`),
    lineSeg(119, 42, 320, 84, `stroke="${PAL.dim}" stroke-width="1.2"`),
    lineSeg(392, 94, 392, 158, `stroke="${PAL.warn}" stroke-width="1.6" stroke-dasharray="6 3"`),
    rect(384, 158, 16, 12, `fill="none" stroke="${PAL.warn}" stroke-width="1.6"`),
    rect(362, 170, 60, 34, `rx="3" fill="${PAL.panel}" stroke="${PAL.warn}" stroke-width="1.4"`),
    label(430, 192, 'PWR-PACK', 'sc-dim-label'),
    // 台位上空载底盘等待对接
    rect(240, 238, 168, 34, `rx="5" fill="none" stroke="${PAL.line}" stroke-width="1.2" stroke-dasharray="6 4"`),
    circle(262, 282, 11, `fill="${PAL.bg}" stroke="${PAL.line}" stroke-width="1.2"`),
    circle(322, 282, 11, `fill="${PAL.bg}" stroke="${PAL.line}" stroke-width="1.2"`),
    circle(382, 282, 11, `fill="${PAL.bg}" stroke="${PAL.line}" stroke-width="1.2"`),
    label(16, 24, '吊装作业 · 动力包对接', 'sc-title'),
  ];
  parts.push(
    hotspotNode('chassis', 262, 282, h.chassis?.label ?? '底盘工位', -12, 34),
    hotspotNode('power', 392, 158, h.power?.label ?? '动力包区', 16, -8),
    hotspotNode('defense', 119, 58, h.defense?.label ?? '防御集成站', 20, -12),
    hotspotNode('network', 462, 246, h.network?.label ?? '电子联调区', -28, -22),
    hotspotNode('acceptance', 548, 292, h.acceptance?.label ?? '出厂验收台', -28, -24),
  );
  return parts.join('');
}

/** 内置通用改装车间场景（MVP 期 23 项改装共用，D23）：三视角 × 五热点（热点=改装部位示意） */
export function buildGenericWorkshopScene(): EngSceneDef {
  const hotspots: EngSceneHotspot[] = [
    { id: 'chassis', label: '底盘工位', desc: '底盘拆解与结构检修：行走系、悬挂与装甲基体的检修台位。', phaseIdx: 0 },
    { id: 'power', label: '动力包区', desc: '动力包换装区：吊装位对接发动机/混动APU 的整体拆装作业。', phaseIdx: 1 },
    { id: 'defense', label: '防御集成站', desc: '主动防御与武器站集成工位：传感器、拦截器挂装与标定。', phaseIdx: 2 },
    { id: 'network', label: '电子联调区', desc: '车际网络与电子系统联调：数据总线、天线阵列与终端排故。', phaseIdx: 3 },
    { id: 'acceptance', label: '出厂验收台', desc: '出厂验收：整车工况复检、批次封存与交付登记。', phaseIdx: 4 },
  ];
  return {
    id: GENERIC_SCENE_ID,
    title: '通用改装车间',
    viewBox: DEFAULT_VIEW_BOX,
    views: [
      { id: 'overview', label: '工位总览', svg: overviewView(hotspots) },
      { id: 'section', label: '平台剖面', svg: sectionView(hotspots) },
      { id: 'crane', label: '吊装作业', svg: craneView(hotspots) },
    ],
    hotspots,
    source: 'builtin',
  };
}

/* ═══════════════ 内置天基测控三视角场景（PKG-A · scene.aerospace.mcc） ═══════════════ */

function ellipseNode(cx: number, cy: number, rx: number, ry: number, extra = ''): string {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${extra}/>`;
}

function pathNode(d: string, extra = ''): string {
  return `<path d="${d}" ${extra}/>`;
}

/** 视角 1：发射场总览（pad）——地面透视网格 + VAB 总装高塔 + 1号发射塔架与运载火箭 + 助推器回收坪 + 气象测控雷达 */
function aerospacePadView(hotspots: EngSceneHotspot[]): string {
  const h = Object.fromEntries(hotspots.map(x => [x.id, x]));
  const parts: string[] = [
    rect(0, 0, 640, 360, `fill="${PAL.bg}"`),
    // 顶部测控遥测标尺与入轨上升走廊虚线弧
    lineSeg(16, 34, 624, 34, `stroke="${PAL.dim}" stroke-width="0.7" opacity="0.7"`),
    pathNode(
      'M 304 126 Q 368 62 496 48',
      `fill="none" stroke="${PAL.accent}" stroke-width="1.2" stroke-dasharray="5 4" opacity="0.65"`,
    ),
    pathNode(
      'M 496 48 Q 558 42 608 26',
      `fill="none" stroke="${PAL.warn}" stroke-width="1.1" stroke-dasharray="3 4" opacity="0.6"`,
    ),
    // 发射场地坪基准线与透视网格
    lineSeg(0, 304, 640, 304, `stroke="${PAL.line}" stroke-width="1.5"`),
  ];
  for (let i = 1; i <= 5; i += 1) {
    parts.push(lineSeg(0, 304 + i * 10, 640, 304 + i * 10, `stroke="${PAL.dim}" stroke-width="0.6" opacity="0.5"`));
  }
  for (let i = 0; i <= 10; i += 1) {
    const xBottom = 320 + (i - 5) * 128;
    parts.push(lineSeg(i * 64, 304, xBottom, 360, `stroke="${PAL.dim}" stroke-width="0.6" opacity="0.5"`));
  }
  // 左侧 VAB 垂直总装厂房高塔 + 重型履带转运道
  parts.push(
    rect(48, 102, 86, 202, `fill="${PAL.panel}" stroke="${PAL.line}" stroke-width="1.3"`),
    rect(134, 152, 26, 152, `fill="${PAL.panel}" stroke="${PAL.dim}" stroke-width="1.1"`),
    lineSeg(76, 102, 76, 304, `stroke="${PAL.dim}" stroke-width="0.9"`),
    lineSeg(106, 102, 106, 304, `stroke="${PAL.dim}" stroke-width="0.9"`),
    lineSeg(48, 148, 134, 148, `stroke="${PAL.dim}" stroke-width="0.8"`),
    lineSeg(48, 198, 134, 198, `stroke="${PAL.dim}" stroke-width="0.8"`),
    lineSeg(48, 248, 134, 248, `stroke="${PAL.dim}" stroke-width="0.8"`),
    rect(82, 120, 18, 168, `fill="none" stroke="${PAL.muted}" stroke-width="0.9" stroke-dasharray="4 3"`),
    lineSeg(160, 298, 256, 298, `stroke="${PAL.warn}" stroke-width="1.4" stroke-dasharray="6 4"`),
    label(56, 94, 'VAB-01 · 垂直总装', 'sc-dim-label'),
  );
  // 中央 1 号发射塔架 + 导流槽底座 + 竖立多级运载火箭箭体剪影
  parts.push(
    // 导流槽基础台座
    rect(248, 282, 112, 22, `fill="${PAL.panel}" stroke="${PAL.line}" stroke-width="1.3"`),
    lineSeg(262, 304, 284, 282, `stroke="${PAL.dim}" stroke-width="1"`),
    lineSeg(346, 304, 324, 282, `stroke="${PAL.dim}" stroke-width="1"`),
    // 勤务脐带塔（左侧格构塔 + 4 层回转摆臂）
    rect(260, 88, 22, 194, `fill="${PAL.panel}" stroke="${PAL.line}" stroke-width="1.2"`),
    lineSeg(260, 118, 282, 142, `stroke="${PAL.dim}" stroke-width="0.9"`),
    lineSeg(282, 118, 260, 142, `stroke="${PAL.dim}" stroke-width="0.9"`),
    lineSeg(260, 166, 282, 190, `stroke="${PAL.dim}" stroke-width="0.9"`),
    lineSeg(282, 166, 260, 190, `stroke="${PAL.dim}" stroke-width="0.9"`),
    lineSeg(260, 214, 282, 238, `stroke="${PAL.dim}" stroke-width="0.9"`),
    lineSeg(282, 214, 260, 238, `stroke="${PAL.dim}" stroke-width="0.9"`),
    lineSeg(282, 126, 306, 126, `stroke="${PAL.line}" stroke-width="2"`),
    lineSeg(282, 162, 306, 162, `stroke="${PAL.line}" stroke-width="2"`),
    lineSeg(282, 204, 306, 204, `stroke="${PAL.line}" stroke-width="2"`),
    lineSeg(282, 244, 306, 244, `stroke="${PAL.line}" stroke-width="2"`),
    // 运载火箭本体（逃逸塔尖 + 整流罩 + 芯二级 + 芯一级 + 双助推器）
    lineSeg(314, 72, 314, 88, `stroke="${PAL.text}" stroke-width="1.6"`),
    pathNode('M 306 112 L 314 88 L 322 112 Z', `fill="${PAL.panel}" stroke="${PAL.text}" stroke-width="1.2"`),
    rect(306, 112, 16, 166, `fill="${PAL.panel}" stroke="${PAL.text}" stroke-width="1.3"`),
    lineSeg(306, 168, 322, 168, `stroke="${PAL.line}" stroke-width="1.1"`),
    lineSeg(306, 224, 322, 224, `stroke="${PAL.line}" stroke-width="1.1"`),
    rect(298, 198, 7, 78, `rx="2" fill="${PAL.panel}" stroke="${PAL.line}" stroke-width="1.1"`),
    rect(323, 198, 7, 78, `rx="2" fill="${PAL.panel}" stroke="${PAL.line}" stroke-width="1.1"`),
    // 防雷塔桅杆
    lineSeg(346, 98, 346, 282, `stroke="${PAL.dim}" stroke-width="1.1"`),
    label(264, 78, 'LC-01 · LAUNCH PAD', 'sc-dim-label'),
  );
  // 右侧助推器回收着陆坪（十字靶标 + 同心环 + 反推下降引导线）
  parts.push(
    pathNode(
      'M 454 96 Q 476 178 488 274',
      `fill="none" stroke="${PAL.warn}" stroke-width="1.1" stroke-dasharray="4 4" opacity="0.7"`,
    ),
    ellipseNode(488, 290, 44, 11, `fill="${PAL.panel}" stroke="${PAL.line}" stroke-width="1.3"`),
    ellipseNode(488, 290, 24, 6, `fill="none" stroke="${PAL.warn}" stroke-width="1" stroke-dasharray="3 2"`),
    lineSeg(448, 290, 528, 290, `stroke="${PAL.line}" stroke-width="1"`),
    lineSeg(488, 277, 488, 303, `stroke="${PAL.line}" stroke-width="1"`),
    label(456, 270, 'LZ-01 · 回收着陆坪', 'sc-dim-label'),
  );
  // 右端气象与跟踪测控雷达站
  parts.push(
    rect(574, 246, 20, 58, `fill="${PAL.panel}" stroke="${PAL.line}" stroke-width="1.1"`),
    lineSeg(574, 266, 594, 286, `stroke="${PAL.dim}" stroke-width="0.9"`),
    lineSeg(594, 266, 574, 286, `stroke="${PAL.dim}" stroke-width="0.9"`),
    pathNode('M 566 232 Q 584 250 602 226', `fill="none" stroke="${PAL.accent}" stroke-width="1.6"`),
    lineSeg(584, 240, 596, 220, `stroke="${PAL.accent}" stroke-width="1.2"`),
    circle(596, 220, 2.2, `fill="${PAL.accent}"`),
    label(552, 212, 'RADAR-MCC', 'sc-dim-label'),
  );
  // 标题与遥测注记
  parts.push(
    label(16, 24, '天基测控与发射大厅 · 发射场总览', 'sc-title'),
    label(452, 342, 'MCC-PAD · TELEMETRY GRID 01', 'sc-dim-label'),
  );
  // 5 个标准热点节点
  parts.push(
    hotspotNode('vab_assembly', 92, 204, h.vab_assembly?.label ?? '垂直总装厂房', -34, -22),
    hotspotNode('launch_pad', 314, 184, h.launch_pad?.label ?? '1号发射工位', 16, -8),
    hotspotNode('recovery_pad', 488, 290, h.recovery_pad?.label ?? '助推回收坪', -28, 28),
    hotspotNode('leo_constellation', 446, 62, h.leo_constellation?.label ?? '近地轨道星座', -34, 24),
    hotspotNode('lunar_transfer', 566, 36, h.lunar_transfer?.label ?? '地月转移与月表前哨', -116, 22),
  );
  return parts.join('');
}

/** 视角 2：近地轨道（leo）——底部地球弧形大气地平线 + LEO/SSO/GEO 椭圆轨道虚线环 + 空间站桁架与太阳翼 + 侦察/通信卫星节点 */
function aerospaceLeoView(hotspots: EngSceneHotspot[]): string {
  const h = Object.fromEntries(hotspots.map(x => [x.id, x]));
  const parts: string[] = [
    rect(0, 0, 640, 360, `fill="${PAL.bg}"`),
    lineSeg(16, 34, 624, 34, `stroke="${PAL.dim}" stroke-width="0.7" opacity="0.7"`),
    // 经纬测控网格背景线
    lineSeg(320, 34, 320, 330, `stroke="${PAL.dim}" stroke-width="0.6" stroke-dasharray="3 5" opacity="0.5"`),
    lineSeg(40, 176, 600, 176, `stroke="${PAL.dim}" stroke-width="0.6" stroke-dasharray="3 5" opacity="0.5"`),
    // LEO / SSO / GEO 三层椭圆轨道虚线环
    ellipseNode(
      320,
      236,
      188,
      78,
      `fill="none" stroke="${PAL.accent}" stroke-width="1.2" stroke-dasharray="6 4" opacity="0.8"`,
    ),
    ellipseNode(
      320,
      224,
      238,
      106,
      `fill="none" stroke="${PAL.line}" stroke-width="1.1" stroke-dasharray="4 4" opacity="0.75"`,
    ),
    ellipseNode(
      320,
      210,
      286,
      136,
      `fill="none" stroke="${PAL.dim}" stroke-width="1" stroke-dasharray="2 4" opacity="0.75"`,
    ),
    label(138, 172, 'LEO · 400KM', 'sc-dim-label'),
    label(92, 134, 'SSO · 680KM', 'sc-dim-label'),
    label(54, 96, 'GEO · 35786KM', 'sc-dim-label'),
    // 底部地球弧形大气地平线（双层弧面 + 地面发射场测控站标记）
    pathNode('M -20 348 Q 320 236 660 348 L 660 364 L -20 364 Z', `fill="${PAL.panel}" stroke="${PAL.line}" stroke-width="1.5"`),
    pathNode(
      'M -10 338 Q 320 224 650 338',
      `fill="none" stroke="${PAL.accent}" stroke-width="1" stroke-dasharray="5 3" opacity="0.6"`,
    ),
    // 中央轨道空间站主桁架与四翼太阳能电池阵剪影
    lineSeg(236, 156, 404, 156, `stroke="${PAL.text}" stroke-width="2.2"`),
    rect(294, 146, 52, 20, `rx="3" fill="${PAL.panel}" stroke="${PAL.text}" stroke-width="1.4"`),
    rect(312, 132, 16, 48, `rx="2" fill="${PAL.panel}" stroke="${PAL.line}" stroke-width="1.2"`),
    // 左翼双太阳翼
    rect(248, 118, 26, 32, `fill="${PAL.panel}" stroke="${PAL.accent}" stroke-width="1.1"`),
    rect(248, 162, 26, 32, `fill="${PAL.panel}" stroke="${PAL.accent}" stroke-width="1.1"`),
    lineSeg(261, 118, 261, 194, `stroke="${PAL.dim}" stroke-width="0.8"`),
    // 右翼双太阳翼
    rect(366, 118, 26, 32, `fill="${PAL.panel}" stroke="${PAL.accent}" stroke-width="1.1"`),
    rect(366, 162, 26, 32, `fill="${PAL.panel}" stroke="${PAL.accent}" stroke-width="1.1"`),
    lineSeg(379, 118, 379, 194, `stroke="${PAL.dim}" stroke-width="0.8"`),
    // 轨道上的光学侦察与通信中继卫星节点 + 星间链路
    rect(156, 194, 14, 10, `fill="${PAL.panel}" stroke="${PAL.line}" stroke-width="1.1"`),
    lineSeg(144, 199, 182, 199, `stroke="${PAL.accent}" stroke-width="1.4"`),
    rect(468, 190, 14, 10, `fill="${PAL.panel}" stroke="${PAL.line}" stroke-width="1.1"`),
    lineSeg(456, 195, 494, 195, `stroke="${PAL.accent}" stroke-width="1.4"`),
    lineSeg(170, 196, 294, 156, `stroke="${PAL.accent}" stroke-width="0.8" stroke-dasharray="3 3" opacity="0.65"`),
    lineSeg(346, 156, 468, 194, `stroke="${PAL.accent}" stroke-width="0.8" stroke-dasharray="3 3" opacity="0.65"`),
    // 地面上行入轨轨迹与右上深空切入矢量
    pathNode(
      'M 252 304 Q 268 232 308 166',
      `fill="none" stroke="${PAL.warn}" stroke-width="1.1" stroke-dasharray="4 3" opacity="0.7"`,
    ),
    pathNode(
      'M 404 156 Q 496 112 568 58',
      `fill="none" stroke="${PAL.warn}" stroke-width="1.2" stroke-dasharray="5 3" opacity="0.75"`,
    ),
    label(16, 24, '天基测控与发射大厅 · 近地轨道星座', 'sc-title'),
    label(446, 342, 'MCC-LEO · ORBITAL CONSTELLATION', 'sc-dim-label'),
  ];
  // 5 个标准热点节点
  parts.push(
    hotspotNode('vab_assembly', 148, 314, h.vab_assembly?.label ?? '垂直总装厂房', -34, -18),
    hotspotNode('launch_pad', 252, 304, h.launch_pad?.label ?? '1号发射工位', -28, -18),
    hotspotNode('recovery_pad', 416, 308, h.recovery_pad?.label ?? '助推回收坪', 14, -12),
    hotspotNode('leo_constellation', 320, 156, h.leo_constellation?.label ?? '近地轨道星座', 18, -24),
    hotspotNode('lunar_transfer', 560, 62, h.lunar_transfer?.label ?? '地月转移与月表前哨', -118, 22),
  );
  return parts.join('');
}

/** 视角 3：地月深空（tli）——左侧地球轨道圈 + 地月霍曼转移虚线弧线 + 右侧月球环形山球面与月表前哨基座剪影 */
function aerospaceTliView(hotspots: EngSceneHotspot[]): string {
  const h = Object.fromEntries(hotspots.map(x => [x.id, x]));
  const parts: string[] = [
    rect(0, 0, 640, 360, `fill="${PAL.bg}"`),
    lineSeg(16, 34, 624, 34, `stroke="${PAL.dim}" stroke-width="0.7" opacity="0.7"`),
    // 深空测控极坐标十字基准线与距离刻度
    lineSeg(40, 196, 600, 196, `stroke="${PAL.dim}" stroke-width="0.7" stroke-dasharray="4 4" opacity="0.55"`),
    lineSeg(320, 44, 320, 332, `stroke="${PAL.dim}" stroke-width="0.6" stroke-dasharray="3 5" opacity="0.45"`),
    // 左侧地球本体与停泊轨道圈
    circle(136, 214, 46, `fill="${PAL.panel}" stroke="${PAL.line}" stroke-width="1.5"`),
    pathNode('M 94 202 Q 136 184 178 202', `fill="none" stroke="${PAL.dim}" stroke-width="0.9"`),
    pathNode('M 96 228 Q 136 244 176 228', `fill="none" stroke="${PAL.dim}" stroke-width="0.9"`),
    circle(136, 214, 66, `fill="none" stroke="${PAL.accent}" stroke-width="1.2" stroke-dasharray="5 3" opacity="0.8"`),
    circle(136, 214, 84, `fill="none" stroke="${PAL.dim}" stroke-width="0.9" stroke-dasharray="2 4" opacity="0.65"`),
    label(96, 298, 'EARTH · LEO PARKING', 'sc-dim-label'),
    // 地月霍曼转移虚线主弧线 + 自由返回轨道虚线包络
    pathNode(
      'M 156 150 C 248 64, 412 62, 496 126',
      `fill="none" stroke="${PAL.warn}" stroke-width="1.6" stroke-dasharray="7 4"`,
    ),
    pathNode(
      'M 182 260 C 282 316, 418 288, 502 204',
      `fill="none" stroke="${PAL.line}" stroke-width="1.1" stroke-dasharray="4 4" opacity="0.75"`,
    ),
    // 转移轨道中途修正节点与拉格朗日点标记
    circle(328, 86, 3, `fill="${PAL.warn}"`),
    lineSeg(320, 78, 336, 94, `stroke="${PAL.warn}" stroke-width="1"`),
    lineSeg(336, 78, 320, 94, `stroke="${PAL.warn}" stroke-width="1"`),
    label(284, 70, 'TLI · HOHMANN ARC', 'sc-dim-label'),
    // 右侧月球球面、环形山与环月轨道圈 + 月表前哨站基座剪影
    circle(516, 162, 54, `fill="${PAL.panel}" stroke="${PAL.line}" stroke-width="1.4"`),
    circle(516, 162, 38, `fill="${PAL.bg}" stroke="${PAL.text}" stroke-width="1.4"`),
    // 月球环形山
    circle(502, 152, 7, `fill="none" stroke="${PAL.dim}" stroke-width="1"`),
    circle(528, 172, 9, `fill="none" stroke="${PAL.dim}" stroke-width="1"`),
    circle(514, 182, 4.5, `fill="none" stroke="${PAL.dim}" stroke-width="0.9"`),
    // 月表前哨站基座剪影（穹顶舱 + 桁架通信塔 + 太阳能列阵）
    rect(500, 118, 32, 8, `rx="2" fill="${PAL.panel}" stroke="${PAL.warn}" stroke-width="1.2"`),
    pathNode('M 506 118 A 10 8 0 0 1 526 118 Z', `fill="${PAL.panel}" stroke="${PAL.text}" stroke-width="1.2"`),
    lineSeg(530, 102, 530, 118, `stroke="${PAL.accent}" stroke-width="1.3"`),
    circle(530, 100, 2.2, `fill="${PAL.accent}"`),
    label(468, 234, 'LUNA · OUTPOST BASE', 'sc-dim-label'),
    label(16, 24, '天基测控与发射大厅 · 地月深空转移', 'sc-title'),
    label(436, 342, 'MCC-TLI · CISLUNAR TRANSFER 384400KM', 'sc-dim-label'),
  ];
  // 5 个标准热点节点
  parts.push(
    hotspotNode('vab_assembly', 98, 224, h.vab_assembly?.label ?? '垂直总装厂房', -42, 34),
    hotspotNode('launch_pad', 136, 196, h.launch_pad?.label ?? '1号发射工位', 14, 6),
    hotspotNode('recovery_pad', 174, 242, h.recovery_pad?.label ?? '助推回收坪', 14, 18),
    hotspotNode('leo_constellation', 156, 150, h.leo_constellation?.label ?? '近地轨道星座', -38, -20),
    hotspotNode('lunar_transfer', 516, 126, h.lunar_transfer?.label ?? '地月转移与月表前哨', -96, -24),
  );
  return parts.join('');
}

/** 内置天基测控与发射大厅场景（PKG-A · scene.aerospace.mcc）：三视角（pad/leo/tli）× 五热点（phaseIdx 0~4 映射） */
export function buildAerospaceMccScene(): EngSceneDef {
  const hotspots: EngSceneHotspot[] = [
    { id: 'vab_assembly', label: '垂直总装厂房', desc: '火箭多级箭体垂直总装、载荷扣罩与出厂检测工位。', phaseIdx: 0 },
    { id: 'launch_pad', label: '1号发射工位', desc: '主发射塔架、导流槽喷水系统与低温推进剂加注勤务塔。', phaseIdx: 1 },
    { id: 'recovery_pad', label: '助推回收坪', desc: '可复用芯一级与捆绑助推器垂直反推着陆回收平台。', phaseIdx: 2 },
    { id: 'leo_constellation', label: '近地轨道星座', desc: '近地轨道空间站核心区与光学侦察、通信中继卫星组网环带。', phaseIdx: 3 },
    { id: 'lunar_transfer', label: '地月转移与月表前哨', desc: '地月霍曼转移轨道、月球环轨转运站与月面勘探前哨站。', phaseIdx: 4 },
  ];
  return {
    id: AEROSPACE_MCC_SCENE_ID,
    title: '天基测控与发射大厅',
    viewBox: DEFAULT_VIEW_BOX,
    views: [
      { id: 'pad', label: '发射场总览', svg: aerospacePadView(hotspots) },
      { id: 'leo', label: '近地轨道', svg: aerospaceLeoView(hotspots) },
      { id: 'tli', label: '地月深空', svg: aerospaceTliView(hotspots) },
    ],
    hotspots,
    source: 'builtin',
  };
}
