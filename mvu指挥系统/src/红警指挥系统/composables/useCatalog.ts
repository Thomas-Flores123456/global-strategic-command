/**
 * 合并目录 store（DLC设计.md §6 承重墙 ＋ 中控台 SSOT 聚合引擎）
 * 运行时有效目录 = Dynamic WB（世界书动态优先）-> Static Baseline（静态基线兜底）-> $dlc Overlays（运行时覆盖）
 * 阵营定义三源动态发现：内置（不可覆盖）> $dlc.data.faction > codex kind='阵营' > 建筑命名兜底。
 *
 * 初始化屏障：App 挂载时调用 init()，ready 后 UI 才放行——杜绝 overlay 与动态世界书到位前
 * derive* 用 base 目录算出错误建议的一致性窗口。
 *
 * 聚合优先级（任务包 §2.1 与 §3.4）：
 * 1. 第一优先级（Dynamic WB）：解析当前启用的世界书（worldbookReader 或注入 loader），通过 parseWorldbookEntries 解析出强类型目录；
 * 2. 第二优先级（Static Baseline）：静态 catalog.ts，仅补全动态源中不存在的旧条目，确保未打标条目（State B/C）零丢失；
 * 3. 第三优先级（DLC Overlays）：叠加 $dlc 运行时注册表数据；
 * 4. 自动降级与鲁棒性：非酒馆环境（Node 单测、npm run serve 本地独立预览、API 不可用）自动平稳降级为纯静态基线（+ MOCK DLC），绝不挂起或抛错。
 */
import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import type { BuildingDef, FactionDef, ProductionDef, ProjectDef, ResearchDef, RetrofitDef } from '../core/catalog';
import type { DlcOverlay, EffectiveCatalog, ProtocolCatalogItem } from '../core/catalogEffective';
import {
  mergeEffectiveCatalog,
  readDlcOverlaysFromRegistry,
} from '../core/catalogEffective';
import { in_tavern, useDataStore } from './store';
import { useFloatingStore } from './useFloatingStore';
import { tav } from '../parse/systemCheck';
import { makeWorldbookReader, type WorldbookReader } from '../../中控悬浮窗/host/worldbookReader';
import { nowPerfMs, recordPerfSample } from '../../中控悬浮窗/models/perfMonitor';
import {
  parseWorldbookEntries,
  type ParsedWorldbookCatalog,
  type WorldbookEntryLike,
} from '../../中控悬浮窗/models/worldbookCatalogParser';

/** 纯合并逻辑与映射函数（与长驻脚本/无 UI 模块共享） */
export type { DlcOverlay, DynamicWorldbookCatalog, EffectiveCatalog, ProtocolCatalogItem } from '../core/catalogEffective';
export {
  buildRevealedByProtocolMap,
  computeHiddenTechIds,
  filterVisibleResearches,
  isCatalogOverlayUsable,
  worldbookBuildingToDef,
  worldbookProductionToDef,
  worldbookProjectToDef,
  worldbookResearchToDef,
  worldbookRetrofitToDef,
} from '../core/catalogEffective';

/** 初始化 options 接口 */
export interface InitCatalogOptions {
  /** 自定义或注入 loader，直接异步返回世界书条目数组（优先级最高） */
  loader?: () => Promise<WorldbookEntryLike[] | unknown> | WorldbookEntryLike[] | unknown;
  /** 自定义世界书读取器；缺省使用 makeWorldbookReader() */
  worldbookReader?: WorldbookReader;
  /** 显式指定要读取的世界书名称列表；缺省自动探测当前激活/绑定的世界书 */
  worldbookNames?: string[];
  /** 直接注入世界书条目列表（跳过读取器） */
  entries?: WorldbookEntryLike[] | unknown;
  /** 直接注入已解析的动态目录（最高层测试注入） */
  dynamicCatalog?: ParsedWorldbookCatalog | null;
  /** 是否重置 ready 状态为 false（用于测试屏障状态流转，缺省在首次 init 时自动为 false） */
  resetReady?: boolean;
  /** 是否强制重跑加载（即使已经 ready） */
  force?: boolean;
}

/** 独立预览 mock（?scenario=dlc）：焚风包，验证合并管道全链路 */
const FOEHN_MOCK: DlcOverlay = {
  id: 'foehn-preview',
  faction: { name: '焚风', mcv: '焚风建造厂核心', lab: '焚风湍流实验室', labResearch: null },
  researches: [
    {
      name: '湍流基础工学',
      cost: 400,
      eta: '约3日',
      line: '焚风特色',
      tier: 1,
      unlocks: '湍流压缩机',
      prereq: '焚风MCV在场',
      prereqs: [],
      need_buildings: ['焚风建造厂核心'],
      desc: '大气湍流的定向压缩与释放理论，焚风动力体系的起点。',
    },
    {
      name: '纳米蜂群协同学',
      cost: 900,
      eta: '约6日',
      line: '焚风特色',
      tier: 2,
      unlocks: '蜂群维护单元',
      prereq: '焚风湍流实验室+MCV',
      prereqs: [],
      need_buildings: ['焚风湍流实验室', '焚风建造厂核心'],
      desc: '分布式纳米集群的协同决策理论。',
    },
  ],
  buildings: [
    {
      name: '湍流压缩机',
      cost: 900,
      power: -150,
      research: '湍流基础工学',
      prereqs: ['湍流基础工学'],
      need_buildings: [],
      desc: '焚风制式发电设施，发电150。预览样例。',
    },
  ],
  productions: [
    {
      name: '雷鸣特攻队',
      cost: 700,
      need_building: '焚风兵营',
      need_buildings: ['焚风兵营'],
      desc: '焚风制式特种步兵。预览样例。',
    },
  ],
};

/** 读取 $dlc 注册表 → overlay 列表（安装序）；解析交给纯模块，此处只负责宿主读取与降级 */
function readDlcOverlays(): DlcOverlay[] {
  if (in_tavern) {
    try {
      const gv = (globalThis as { getVariables?: (o: { type: string }) => Record<string, unknown> }).getVariables;
      const chat = typeof gv === 'function' ? gv({ type: 'chat' }) : {};
      return readDlcOverlaysFromRegistry((chat as Record<string, unknown>)?.$dlc);
    } catch {
      return []; // $dlc 缺失/损坏时安全降级为纯 base
    }
  }
  try {
    if (typeof window !== 'undefined' && window.location && typeof window.location.search === 'string') {
      if (new URLSearchParams(window.location.search).get('scenario') === 'dlc') return [FOEHN_MOCK];
    }
  } catch {
    return [];
  }
  return [];
}

/**
 * 探测当前环境中激活或绑定的世界书名称列表
 * 优先级：
 * 1. 全局激活列表（getGlobalWorldbookNames）
 * 2. 角色卡绑定列表（getCharWorldbookNames('current')）
 * 3. 聊天绑定列表（getChatWorldbookName('current')）
 * 4. 仅测试/单桩兜底：若前三者均空，尝试从 getWorldbookNames 探测红警相关前缀书名
 */
export function resolveActiveWorldbookNames(): string[] {
  const names = new Set<string>();

  // 1. 全局启用（驾驶员裁决真源）
  const getGlobal = tav<() => string[]>('getGlobalWorldbookNames');
  if (getGlobal) {
    try {
      const g = getGlobal();
      if (Array.isArray(g)) {
        for (const n of g) {
          if (typeof n === 'string' && n.trim()) names.add(n.trim());
        }
      }
    } catch {
      /* ignore */
    }
  }

  // 2. 角色卡绑定
  const getChar = tav<(c: string) => { primary: string | null; additional: string[] }>('getCharWorldbookNames');
  if (getChar) {
    try {
      const cw = getChar('current');
      if (cw && typeof cw === 'object') {
        if (typeof cw.primary === 'string' && cw.primary.trim()) names.add(cw.primary.trim());
        if (Array.isArray(cw.additional)) {
          for (const n of cw.additional) {
            if (typeof n === 'string' && n.trim()) names.add(n.trim());
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  // 3. 聊天绑定（原生 getChatWorldbookName + 聊天变量 $timeline.boundBookName / $promoted / $archive 兜底）
  const getChat = tav<(c: string) => string | null>('getChatWorldbookName');
  if (getChat) {
    try {
      const chatBook = getChat('current');
      if (typeof chatBook === 'string' && chatBook.trim()) names.add(chatBook.trim());
    } catch {
      /* ignore */
    }
  }
  const getVars = tav<(o: { type: string }) => Record<string, unknown>>('getVariables');
  if (getVars) {
    try {
      const chatVars = getVars({ type: 'chat' });
      const timeline = chatVars?.$timeline as { boundBookName?: unknown } | undefined;
      if (typeof timeline?.boundBookName === 'string' && timeline.boundBookName.trim()) {
        names.add(timeline.boundBookName.trim());
      }
      const promoted = chatVars?.$promoted as Record<string, { targetBook?: unknown }> | undefined;
      if (promoted && typeof promoted === 'object' && !Array.isArray(promoted)) {
        for (const rec of Object.values(promoted)) {
          if (typeof rec?.targetBook === 'string' && rec.targetBook.trim()) {
            names.add(rec.targetBook.trim());
          }
        }
      }
      const archive = chatVars?.$archive;
      if (archive && typeof archive === 'object' && !Array.isArray(archive) && Object.keys(archive).length > 0) {
        names.add('EVA·动态档案');
      }
    } catch {
      /* ignore */
    }
  }

  // 4. 探测已安装红警标准图鉴世界书（单阵营开局未全局启用其他阵营世界书时，前端图鉴仍只读加载全阵营建筑/科技/武备/工程/协议）
  const getAll = tav<() => string[]>('getWorldbookNames');
  if (getAll) {
    try {
      const all = getAll();
      if (Array.isArray(all)) {
        for (const n of all) {
          if (
            typeof n === 'string' &&
            /^(?:通用·|特色科技·|特色建筑·|科技·|研究·|建筑·|武备·|生产·|工程·|改装·|协议_世界书$|协议$)/.test(
              n.trim(),
            )
          ) {
            names.add(n.trim());
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  return [...names];
}

/** 异步读取并解析动态世界书 */
export async function loadDynamicWorldbook(options?: InitCatalogOptions): Promise<ParsedWorldbookCatalog | null> {
  // 1. 最高优先级：直接注入的已解析动态目录
  if (options?.dynamicCatalog !== undefined) {
    return options.dynamicCatalog;
  }

  // 2. 直接注入的条目列表
  if (options?.entries !== undefined) {
    return parseWorldbookEntries(options.entries, { silent: true });
  }

  // 3. 注入的 loader 函数
  if (typeof options?.loader === 'function') {
    try {
      const res = await options.loader();
      return parseWorldbookEntries(res, { silent: true });
    } catch (err) {
      console.warn('[useCatalog] 注入 loader 执行失败:', err);
      return null;
    }
  }

  // 4. 非酒馆环境且无世界书 API：自动平稳降级为 null（纯静态基线）
  if (!in_tavern && !tav('getWorldbook') && !options?.worldbookReader) {
    return null;
  }

  // 5. 自动发现或指定书名读取
  try {
    const bookNames = options?.worldbookNames ?? resolveActiveWorldbookNames();
    if (bookNames.length === 0) {
      return null;
    }

    const rawGetBook = tav<(name: string) => unknown>('getWorldbook');
    const reader = options?.worldbookReader ?? getSharedWorldbookReader(rawGetBook);
    const allEntries: WorldbookEntryLike[] = [];

    for (const name of bookNames) {
      try {
        let entries = await reader.read(name);
        if (!entries) {
          if (name.endsWith('.json')) {
            entries = await reader.read(name.replace(/\.json$/, ''));
          } else {
            entries = await reader.read(`${name}.json`);
          }
        }
        if (Array.isArray(entries)) {
          for (const e of entries) {
            if (e && typeof e === 'object') {
              allEntries.push(e as WorldbookEntryLike);
            }
          }
        }
      } catch {
        // 单书异常跳过
      }
    }

    if (allEntries.length === 0) {
      return null;
    }

    return parseWorldbookEntries(allEntries, { silent: true });
  } catch (err) {
    console.warn('[useCatalog] 世界书读取与解析失败，降级为静态基线:', err);
    return null;
  }
}

/** 模块级默认 WorldbookReader 与世界书目录缓存（供 effectiveCatalogNames 纯同步快速使用） */
let sharedWorldbookReader: WorldbookReader | null = null;
let sharedWorldbookRawFn: unknown = undefined;
let cachedDynamicCatalog: ParsedWorldbookCatalog | null = null;
let cachedBookNamesSig: string | null = null;
let inFlightEnsurePromise: Promise<ParsedWorldbookCatalog | null> | null = null;
let lastSnapshotCatalogRef: ParsedWorldbookCatalog | null | undefined = undefined;
let lastSnapshotOverlaysSig = '';
let lastSnapshotResult: EffectiveCatalog | null = null;

function getSharedWorldbookReader(rawGetBook: ((name: string) => unknown) | undefined): WorldbookReader {
  if (!sharedWorldbookReader || sharedWorldbookRawFn !== rawGetBook) {
    sharedWorldbookRawFn = rawGetBook;
    sharedWorldbookReader = makeWorldbookReader(
      rawGetBook
        ? {
            getWorldbook: async (bName: string) => {
              const rawList = await rawGetBook(bName);
              if (!Array.isArray(rawList)) return rawList;
              return rawList.map((entry, idx) => {
                if (entry && typeof entry === 'object') {
                  const rec = entry as Record<string, unknown>;
                  if (typeof rec.name !== 'string') {
                    return {
                      ...rec,
                      name: String(rec.comment ?? rec.uid ?? `entry_${idx}`),
                    };
                  }
                }
                return entry;
              });
            },
          }
        : undefined,
    );
  }
  return sharedWorldbookReader;
}

export function setCachedDynamicCatalog(cat: ParsedWorldbookCatalog | null): void {
  cachedDynamicCatalog = cat;
  cachedBookNamesSig = null;
  lastSnapshotResult = null;
  sharedWorldbookReader?.invalidate();
}

/**
 * 世界书唯一事实源（SSOT）预热入口（FD-27）：
 * - 当 `cachedDynamicCatalog !== null && !options?.force`（且未注入单次覆盖参数）时直接返回缓存；
 * - 否则调用 `loadDynamicWorldbook(options)` 读取全局 + 角色 + 聊天世界书并经 `parseWorldbookEntries` 解析 `<数据>` 块，
 *   若解析结果非空则写入 `cachedDynamicCatalog` 并返回。
 */
export async function ensureWorldbookCatalogLoaded(
  options?: InitCatalogOptions,
): Promise<ParsedWorldbookCatalog | null> {
  const hasExplicitInput =
    options?.dynamicCatalog !== undefined ||
    options?.entries !== undefined ||
    typeof options?.loader === 'function' ||
    options?.worldbookReader !== undefined ||
    options?.worldbookNames !== undefined;

  const activeSig = !hasExplicitInput ? resolveActiveWorldbookNames().join('\u0000') : null;
  const bookNamesChanged =
    !hasExplicitInput &&
    cachedDynamicCatalog !== null &&
    cachedBookNamesSig !== null &&
    activeSig !== cachedBookNamesSig;

  if (options?.force || options?.resetReady || bookNamesChanged) {
    sharedWorldbookReader?.invalidate();
    lastSnapshotResult = null;
  }

  if (cachedDynamicCatalog !== null && !options?.force && !hasExplicitInput && !bookNamesChanged) {
    return cachedDynamicCatalog;
  }

  if (inFlightEnsurePromise && !options?.force && !hasExplicitInput && !bookNamesChanged) {
    return inFlightEnsurePromise;
  }

  const task = (async () => {
    try {
      const parsed = await loadDynamicWorldbook(options);
      if (parsed !== null) {
        cachedDynamicCatalog = parsed;
        if (activeSig !== null) {
          cachedBookNamesSig = activeSig;
        }
      }
      return cachedDynamicCatalog;
    } catch (err) {
      console.warn('[useCatalog] ensureWorldbookCatalogLoaded 预热异常:', err);
      return cachedDynamicCatalog;
    } finally {
      if (!hasExplicitInput) {
        inFlightEnsurePromise = null;
      }
    }
  })();

  if (!hasExplicitInput) {
    inFlightEnsurePromise = task;
  }
  return task;
}

/**
 * 世界书动态目录只读取件（R3 派生链接线：scheduleText / researchAdvisory 注入通道）。
 * 只读模块级缓存，零 pinia / 零酒馆 API，任何时序可安全调用；
 * catalog.init() 或 ensureWorldbookCatalogLoaded() 完成前缓存为 null。
 */
export function dynamicCatalogSnapshot(): ParsedWorldbookCatalog | null {
  return cachedDynamicCatalog;
}

/**
 * 无 pinia 依赖的有效目录名单（批 C buildAuthority 专用）。
 * 此函数只走世界书缓存 + readDlcOverlays + 静态兼容槽，收录全六大域（researches / buildings / productions / retrofits / projects / protocols）与阵营名。
 */
export function effectiveCatalogNames(): string[] {
  const catalog = effectiveCatalogSnapshot();
  const names = new Set<string>();
  for (const r of catalog.researches) if (r.name) names.add(r.name);
  for (const b of catalog.buildings) if (b.name) names.add(b.name);
  for (const p of catalog.productions) if (p.name) names.add(p.name);
  for (const t of catalog.retrofits) if (t.name) names.add(t.name);
  for (const j of catalog.projects) if (j.name) names.add(j.name);
  for (const pr of catalog.protocols) if (pr.name) names.add(pr.name);
  for (const f of catalog.factionDefs) if (f.faction) names.add(f.faction);
  return [...names];
}

/**
 * 无 pinia 依赖的有效目录快照（CTRL-TXN-INTEG-01 接缝，供解析结算挂点同步读取）。
 * 与 effectiveCatalogNames 同通道：静态基线 + 模块级动态缓存 + $dlc overlay，
 * 任何时序可安全调用；动态缓存未就绪时退化为静态基线。
 */
export function effectiveCatalogSnapshot(): EffectiveCatalog {
  let overlays: DlcOverlay[] = [];
  try {
    overlays = readDlcOverlays();
  } catch {
    /* 无 window 等极端环境：纯 base 目录 */
  }
  let overlaysSig = '';
  try {
    overlaysSig = overlays.length > 0 ? JSON.stringify(overlays) : '';
  } catch {
    overlaysSig = String(overlays.length);
  }
  if (
    lastSnapshotResult !== null &&
    lastSnapshotCatalogRef === cachedDynamicCatalog &&
    lastSnapshotOverlaysSig === overlaysSig
  ) {
    recordPerfSample('catalog.merge', 0, { cacheHit: true, silentLog: true });
    return lastSnapshotResult;
  }
  const t0 = nowPerfMs();
  const merged = mergeEffectiveCatalog(overlays, cachedDynamicCatalog);
  lastSnapshotCatalogRef = cachedDynamicCatalog;
  lastSnapshotOverlaysSig = overlaysSig;
  lastSnapshotResult = merged;
  recordPerfSample('catalog.merge', nowPerfMs() - t0, {
    cacheHit: false,
    detail: `overlays=${overlays.length}`,
    silentLog: true,
  });
  return merged;
}

export const useCatalogStore = defineStore('catalog.effective', () => {
  const dataStore = useDataStore();
  const floatingStore = useFloatingStore();
  const ready = ref(false);
  const overlays = ref<DlcOverlay[]>([]);
  const dynamicCatalog = shallowRef<ParsedWorldbookCatalog | null>(null);

  let activeInitPromise: Promise<void> | null = null;

  /** 初始化屏障入口：App 挂载时调用一次 */
  async function init(options?: InitCatalogOptions): Promise<void> {
    if (options?.resetReady) {
      ready.value = false;
    }
    if (options?.force || options?.resetReady) {
      sharedWorldbookReader?.invalidate();
      lastSnapshotResult = null;
    }

    // 同步读取 $dlc 注册表
    overlays.value = readDlcOverlays();

    if (activeInitPromise && !options?.force && !options?.resetReady) {
      return activeInitPromise;
    }

    const run = async () => {
      try {
        const dynamic = await loadDynamicWorldbook(options);
        dynamicCatalog.value = dynamic;
        cachedDynamicCatalog = dynamic;
      } catch (err) {
        console.warn('[useCatalog] 动态世界书加载失败，平稳降级为静态基线:', err);
        dynamicCatalog.value = null;
      } finally {
        ready.value = true;
        activeInitPromise = null;
      }
    };

    activeInitPromise = run();
    return activeInitPromise;
  }

  /** 强制刷新有效目录 */
  async function refresh(options?: InitCatalogOptions): Promise<void> {
    return init({ ...options, force: true });
  }

  /** 当前已激活协议实例列表（供 reveals 单向隐藏表过滤科技可见性；dynamicCatalog.value?.researches 保持原始未过滤列表） */
  let prevActiveProtocols: Array<Record<string, unknown>> = [];
  let prevActiveProtocolsSig = '';
  const activeProtocols = computed(() => {
    const list = (floatingStore.snapshot?.protocols ?? dataStore.data?.protocols ?? []).filter(
      p => p.status === 'active',
    );
    const sig = list
      .map(p => {
        const rec = p as unknown as Record<string, unknown>;
        return `${String(rec.ref ?? '')}:${String(rec.id ?? '')}:${String(rec.name ?? '')}:${String(p.status ?? '')}:${String(rec.exp ?? '')}:${String(rec.attempts ?? '')}`;
      })
      .join('|');
    if (list.length === prevActiveProtocols.length && sig === prevActiveProtocolsSig) {
      return prevActiveProtocols as unknown as typeof list;
    }
    prevActiveProtocols = list as unknown as Array<Record<string, unknown>>;
    prevActiveProtocolsSig = sig;
    return list;
  });

  /** 楼层已批准生效的数据更新补丁账本（17号方案A · SEAM-03；同时兼容中控悬浮窗 snapshot 与楼层端 dataStore） */
  let prevAppliedPatches: unknown[] = [];
  let prevAppliedPatchesSig = '';
  const appliedDataPatches = computed(() => {
    const list = floatingStore.snapshot?.applied_data_patches?.length
      ? floatingStore.snapshot.applied_data_patches
      : (dataStore.data?.applied_data_patches ?? []);
    const sig = list
      .map(p => {
        const rec = (p ?? {}) as Record<string, unknown>;
        return `${String(rec.id ?? '')}:${String(rec.target ?? '')}:${String(rec.appliedAtFloor ?? '')}:${JSON.stringify(rec.changes ?? {})}`;
      })
      .join('|');
    if (list.length === prevAppliedPatches.length && sig === prevAppliedPatchesSig) {
      return prevAppliedPatches as typeof list;
    }
    prevAppliedPatches = list as unknown[];
    prevAppliedPatchesSig = sig;
    return list;
  });

  /** 四级合并有效目录：Dynamic WB -> Static Baseline -> $dlc Overlays -> Timeline Data Patches（结合 activeProtocols 应用 reveals 可见性过滤） */
  const effectiveCatalog = computed(() =>
    mergeEffectiveCatalog(overlays.value, dynamicCatalog.value, activeProtocols.value, appliedDataPatches.value),
  );
  const researches = computed<ResearchDef[]>(() => effectiveCatalog.value.researches);
  const buildings = computed<BuildingDef[]>(() => effectiveCatalog.value.buildings);
  const productions = computed<ProductionDef[]>(() => effectiveCatalog.value.productions);
  const retrofits = computed<RetrofitDef[]>(() => effectiveCatalog.value.retrofits);
  const projects = computed<ProjectDef[]>(() => effectiveCatalog.value.projects);
  const protocols = computed<ProtocolCatalogItem[]>(() => effectiveCatalog.value.protocols);

  /** 阵营定义三源合并（先到先得；内置最先注册故不可覆盖） */
  const factionDefs = computed<FactionDef[]>(() => {
    const defs = new Map<string, FactionDef>();
    const put = (d: FactionDef) => {
      if (!defs.has(d.faction)) defs.set(d.faction, d);
    };
    // 1+2. 内置三阵营 + $dlc 安装的阵营（纯模块已按先到先得合并）
    effectiveCatalog.value.factionDefs.forEach(put);
    // 3. codex kind='阵营'（AI 剧情中临时登场的势力）
    for (const c of dataStore.data.codex) {
      if (c.kind !== '阵营') continue;
      const mcv = c.params['MCV'];
      const lab = c.params['实验室'];
      if (mcv && lab) put({ faction: c.name, mcv, lab, labResearch: c.params['实验室研究'] ?? null });
    }
    // 4. 建筑命名兜底："X建造厂核心" 出现即注册阵营 X（lab 按 "X战斗实验室" 约定）
    const known = new Set([...defs.values()].map(d => d.mcv));
    for (const base of dataStore.data.bases) {
      for (const b of base.buildings) {
        const m = b.name.match(/^(.+)建造厂核心$/);
        if (m && !known.has(b.name)) {
          put({ faction: m[1], mcv: b.name, lab: `${m[1]}战斗实验室`, labResearch: null });
          known.add(b.name);
        }
      }
    }
    return [...defs.values()];
  });

  return {
    ready,
    overlays,
    dynamicCatalog,
    effectiveCatalog,
    catalog: effectiveCatalog,
    init,
    refresh,
    researches,
    buildings,
    productions,
    retrofits,
    projects,
    protocols,
    factionDefs,
  };
});
