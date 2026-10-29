/**
 * engSceneAsset.ts —— ENG-UI-02 世界书 SVG 资产条目读取路径（D24 / ENG-VERIFY-01 / V2-06 跨书路由）
 *
 * 职责单一：用 `getWorldbook` 按探测书清单读世界书，按命名约定 `⚠SVG资产·<工程名>·勿启用` 找禁用资产条目，
 * 解析（engScene.parseSceneAssetEntry）为 EngSceneDef。**fail-closed**：API 缺失/抛错/书不存在/
 * 条目缺失/载荷畸形 → null，调用方（EngSceneView）回退内置通用场景，全程零报错零写操作。
 *
 * 实证依据：ENG-VERIFY-01（docs/project/reports/ENG-VERIFY-01.md）——`getWorldbook` 不按 enabled
 * 过滤（worldbook.d.ts:155），禁用条目可读；`disable`/`enabled` 双字段命名兼容（同报告未测边界 ④）。
 *
 * V2-06（仓段化V2设计案 §5 / D-C5）：资产条目可落任意工程书——按 scene id 前缀路由探测书清单
 * （空间站系 scene.station.* → [《工程·通用》,《工程·盟军》]；其余缺省 [《工程·盟军》,《工程·苏联》] 双书，SU-01 起）。
 * 每书仍走双名探测（裸名 + `_世界书` 后缀，ENG-RM-01 真机实证）。世界书侧物理落书归 V2-08。
 * 本文件逻辑集中在一个导出函数族上，真机门（ENG-RM-01）复测只需直调 loadSceneAsset。
 */
import { assetEntryName, parseSceneAssetEntry, type EngSceneDef } from './engScene';

/** 工程世界书名（世界书门 ENG-WB-01 的承载书；V1 改装工程资产缺省落点） */
export const SCENE_ASSET_WORLDBOOK = '工程·盟军';

/** 《工程·通用》书名（D-C5 冻结：阵营中立巨构资产与通用工程定义的家；空间站系场景资产目标书，V2-08 入书） */
export const ENGINE_COMMON_WORLDBOOK = '工程·通用';

/** 通用资产条目回退查找名（ENG-WB-01 / D23：单项通用车间资产条目供 23 项工程共用） */
export const GENERIC_ASSET_ENTRY_NAME = assetEntryName('通用改装车间');

/**
 * scene id → 资产探测书清单（V2-06 资产路由注册表，前缀映射）：
 * - 命中前缀 → 按序探测（专属条目按书序先到先得）；
 * - 未命中/缺省 → [《工程·盟军》,《工程·苏联》] 双书（SU-01：镜像书入列，苏联在后，命中序不变）。
 * 前缀与 engScene.SCENE_REGISTRY 注册 id 对齐（scene.station.* ↔ scene.station.orbital）。
 */
const SCENE_BOOK_ROUTES: readonly { prefix: string; books: readonly string[] }[] = [
  { prefix: 'scene.station.', books: [ENGINE_COMMON_WORLDBOOK, SCENE_ASSET_WORLDBOOK] },
];

/** 通用场景缺省探测书清单（SU-01：加《工程·苏联》，苏联在后，命中序不变） */
const GENERIC_SCENE_BOOKS: readonly string[] = [SCENE_ASSET_WORLDBOOK, '工程·苏联'];

export function assetWorldbooksFor(sceneId?: string | null): readonly string[] {
  const id = (sceneId ?? '').trim();
  if (id === '') return GENERIC_SCENE_BOOKS;
  for (const route of SCENE_BOOK_ROUTES) {
    if (id.startsWith(route.prefix)) return route.books;
  }
  return GENERIC_SCENE_BOOKS;
}

export interface SceneAssetDeps {
  /** 缺省 = 调用时读 globalThis.getWorldbook；显式传 undefined 视为 API 不可用 */
  getWorldbook?: (name: string) => unknown;
}

/** 默认宿主读取路径的内存缓存（按 getter 函数引用作第一层 WeakMap 隔离，内层以 `${sceneId}::${projectName}` 为键） */
let defaultSceneAssetCacheByGetter = new WeakMap<
  (name: string) => unknown,
  Map<string, EngSceneDef | null>
>();

export function clearSceneAssetCache(): void {
  defaultSceneAssetCacheByGetter = new WeakMap();
}

interface AssetEntryLike {
  name: string;
  content: string;
}

function resolveGetter(deps?: SceneAssetDeps): ((name: string) => unknown) | null {
  const fn = deps && 'getWorldbook' in deps ? deps.getWorldbook : (globalThis as Record<string, unknown>).getWorldbook;
  return typeof fn === 'function' ? (fn as (name: string) => unknown) : null;
}

/** 归一化条目（只取 name/content；enabled/disable 不参与过滤——禁用条目正是目标） */
function normalizeEntries(raw: unknown): AssetEntryLike[] | null {
  if (!Array.isArray(raw)) return null;
  const out: AssetEntryLike[] = [];
  for (const e of raw) {
    if (typeof e !== 'object' || e === null) continue;
    const rec = e as Record<string, unknown>;
    if (typeof rec.name !== 'string') continue;
    out.push({ name: rec.name, content: typeof rec.content === 'string' ? rec.content : '' });
  }
  return out;
}

/**
 * 读取指定工程的 SVG 资产条目并解析；任何一步失败 → null（优雅回退，零报错）。
 *
 * 跨书探测（V2-06）：按 assetWorldbooksFor(sceneId) 书序逐书双名探测（裸名 + `_世界书` 后缀，
 * ENG-RM-01 酒馆导入口径）；专属条目按书序先到先得；均未命中 → 跨书扫通用回退条目（ENG-WB-01/D23）。
 *
 * @param projectName 工程名（retrofit/project 块 name，如「灰熊坦克现代化改装工程」「轨道空间站」）
 * @param deps 宿主 API 注入（单测 mock / 真机门探针复测点）
 * @param sceneId 场景 id（V2-06 资产路由键；缺省 = V1 单书现状口径）
 */
export async function loadSceneAsset(
  projectName: string,
  deps?: SceneAssetDeps,
  sceneId?: string | null,
): Promise<EngSceneDef | null> {
  try {
    const getter = resolveGetter(deps);
    if (!getter) return null;
    const useDefaultCache = !deps || !('getWorldbook' in deps);
    const cacheKey = `${(sceneId ?? '').trim()}::${projectName ?? ''}`;
    let getterCache: Map<string, EngSceneDef | null> | undefined;
    if (useDefaultCache) {
      getterCache = defaultSceneAssetCacheByGetter.get(getter);
      if (getterCache?.has(cacheKey)) {
        return getterCache.get(cacheKey) ?? null;
      }
    }
    const target = assetEntryName(projectName);
    let specificEntry: AssetEntryLike | null = null;
    let genericEntry: AssetEntryLike | null = null;
    for (const book of assetWorldbooksFor(sceneId)) {
      // 书名双口径探测（ENG-RM-01 真机实证）：源码常量不带后缀，酒馆导入的书名带 `_世界书` 后缀（文件名去 .json）
      let entries: AssetEntryLike[] | null = null;
      for (const name of [book, `${book}_世界书`]) {
        try {
          entries = normalizeEntries(await getter(name));
        } catch {
          entries = null;
        }
        if (entries) break;
      }
      if (!entries) continue; // 本书不存在/不可读 → 试下一本（跨书容错）
      if (!specificEntry) {
        const hit = entries.find(e => e.name === target);
        if (hit) specificEntry = hit;
      }
      if (!genericEntry) {
        const hit = entries.find(e => e.name === GENERIC_ASSET_ENTRY_NAME);
        if (hit) genericEntry = hit;
      }
      if (specificEntry) break; // 专属条目按书序命中即止（通用回退无需再探）
    }
    // 先按工程名精确查找；未命中回退通用车间资产条目（ENG-WB-01 接缝，D23 共用场景）
    const entry = specificEntry ?? genericEntry;
    if (!entry) {
      if (useDefaultCache) {
        if (!getterCache) {
          getterCache = new Map();
          defaultSceneAssetCacheByGetter.set(getter, getterCache);
        }
        getterCache.set(cacheKey, null);
      }
      return null;
    }
    const parsed = parseSceneAssetEntry(entry.content, projectName);
    if (useDefaultCache) {
      if (!getterCache) {
        getterCache = new Map();
        defaultSceneAssetCacheByGetter.set(getter, getterCache);
      }
      getterCache.set(cacheKey, parsed);
    }
    return parsed;
  } catch {
    return null;
  }
}
