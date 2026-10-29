/**
 * 有效目录纯合并模块（DLC设计.md §6 承重墙的无 UI 版本 · FD-27 世界书 SSOT 收口）
 * 运行时有效目录以世界书 `<数据>` 块解析产物（ParsedWorldbookCatalog）为唯一核心事实源（SSOT），
 * 按序叠加 $dlc 安装序 overlay 与楼层已批准 `<数据更新>` 补丁（catalog.ts 静态空数组已退役，仅作单测兼容槽）。
 *
 * 本模块供楼层 UI store（useCatalog.ts）与长驻脚本编译期共享，因此：
 * - 零 Pinia / store / vue / getCurrentMessageId 依赖；
 * - 不读取酒馆变量：$dlc 注册表由调用方读出后以参数注入（readDlcOverlaysFromRegistry）；
 * - 阵营定义只合并内置 + $dlc 两源；codex kind='阵营' 与建筑命名兜底属 UI 状态层，由 store 追加。
 */
import type {
  BuildingDef,
  FactionDef,
  ProductionDef,
  ProjectDef,
  ProtocolCatalogItem,
  ResearchDef,
  RetrofitDef,
} from './catalog';
import {
  BUILDINGS,
  FACTION_DEFS,
  PRODUCTIONS,
  PROJECTS,
  PROTOCOLS,
  protocols as STATIC_PROTOCOLS,
  RESEARCHES,
  RETROFITS,
} from './catalog';
import { resolveLegacyProtocolName } from './schema';
import { filterVisibleResearches } from './catalogOverlayHelpers';
import { checkOverlayData } from '../parse/systemCheck';
import {
  defaultExperimentCostCreditsByTier,
  type ParsedWorldbookCatalog,
  type WbProtocolBlock,
  type WorldbookBuildingData,
  type WorldbookProductionData,
  type WorldbookProjectData,
  type WorldbookProtocolData,
  type WorldbookResearchData,
  type WorldbookRetrofitData,
} from '../../中控悬浮窗/models/worldbookCatalogParser';

/** DLC overlay 数据形状（manifest.data 子集，安装时由安装器拷入 $dlc.<id>.data） */
export interface DlcOverlay {
  id: string;
  faction?: { name?: string; mcv: string; lab: string; labResearch?: string | null };
  researches?: ResearchDef[];
  buildings?: BuildingDef[];
  productions?: ProductionDef[];
  protocols?:
    | readonly (ProtocolCatalogItem | WbProtocolBlock | (Partial<WbProtocolBlock> & { id: string; name?: string }))[]
    | Record<
        string,
        ProtocolCatalogItem | WbProtocolBlock | (Partial<WbProtocolBlock> & { id: string; name?: string })
      >;
  books?: string[];
  /** DLC 安装器登记的世界书内容指纹；缺失表示旧注册表，不能授予破坏性重装/卸载权限。 */
  bookAssets?: Record<string, { fingerprint: string; installedVersion: string }>;
  takeoverAssets?: Record<string, { fingerprint: string; installedVersion: string }>;
  codexSeeds?: string[];
  /** 注册表 data 不是对象时保留诊断，不让损坏包被误当成空 overlay。 */
  dataError?: string;
}

/** 两源（内置 + $dlc）合并后的有效目录 */
export interface EffectiveCatalog {
  researches: ResearchDef[];
  buildings: BuildingDef[];
  productions: ProductionDef[];
  /** base 层改装工程（暂无 overlay 源） */
  retrofits: RetrofitDef[];
  /** base 层仓段化 V2 工程（V2-04：静态基线空，世界书 project 块动态贯通；暂无 overlay 源） */
  projects: ProjectDef[];
  /** 第四集合：协议静态目录（PRT-PARSE-01：世界书动态条目 > 静态 catalog > DLC） */
  protocols: ProtocolCatalogItem[];
  /** 内置阵营最先注册故不可覆盖；同名 DLC 阵营先到先得 */
  factionDefs: FactionDef[];
  /**
   * 同名研究覆盖检测 warn（《通用·科技》V1 接入）：世界书研究覆盖静态基线同名、
   * 或世界书源内部彼此同名时收集；只收集不阻断，不改变合并行为（W4 §3 静默覆盖风险的可见化）。
   */
  researchWarnings?: string[];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 已读出的 $dlc 注册表对象 → overlay 列表（installedAt 安装序）。
 * 非对象注册表视为空；损坏条目保留并打上 dataError，供体检显示但不进入有效目录。
 */
export function readDlcOverlaysFromRegistry(rawRegistry: unknown): DlcOverlay[] {
  if (!isPlainRecord(rawRegistry)) return [];
  return Object.entries(rawRegistry)
    .sort((a, b) => {
      const left = isPlainRecord(a[1]) ? a[1].installedAt : '';
      const right = isPlainRecord(b[1]) ? b[1].installedAt : '';
      return String(left ?? '').localeCompare(String(right ?? ''));
    })
    .map(([id, rawEntry]) => {
      const entryValid = isPlainRecord(rawEntry);
      const entry = entryValid ? rawEntry : {};
      const data = entry.data;
      const overlayData = isPlainRecord(data) ? data : {};
      const overlay = {
        ...overlayData,
        id,
        books: Array.isArray(entry.books) ? entry.books.filter((name): name is string => typeof name === 'string') : [],
        bookAssets: isPlainRecord(entry.bookAssets) ? (entry.bookAssets as DlcOverlay['bookAssets']) : undefined,
        takeoverAssets: isPlainRecord(entry.takeoverAssets)
          ? (entry.takeoverAssets as DlcOverlay['takeoverAssets'])
          : undefined,
        codexSeeds: Array.isArray(entry.codexSeeds)
          ? entry.codexSeeds.filter((name): name is string => typeof name === 'string')
          : [],
      } as unknown as DlcOverlay;
      if (!entryValid) overlay.dataError = '注册表条目必须是对象';
      else if (data !== undefined && !isPlainRecord(data)) overlay.dataError = '注册表 data 必须是对象';
      return overlay;
    });
}

function getBaseResearchNames(wbResearches?: readonly { name: string }[]): Set<string> {
  const names = new Set<string>(RESEARCHES.map(r => r.name));
  if (Array.isArray(wbResearches)) {
    for (const r of wbResearches) {
      if (r?.name) names.add(r.name);
    }
  }
  return names;
}

/** 原始损坏 overlay 保留供体检显示，但不得进入运行时有效目录。 */
export function isCatalogOverlayUsable(
  overlay: unknown,
  wbResearches?: readonly { name: string }[],
): boolean {
  return !checkOverlayData(overlay, getBaseResearchNames(wbResearches)).some(issue => issue.level === 'error');
}

/** 按 name 键合并：overlay 同名覆盖 base，新名追加（后装包胜前装包）；base 项只被覆盖、不被删除 */
export function mergeByName<T extends { name: string }>(base: readonly T[], overlays: (T[] | undefined)[]): T[] {
  const merged = new Map(base.map(item => [item.name, item]));
  for (const overlay of overlays) for (const item of overlay ?? []) merged.set(item.name, item);
  return [...merged.values()];
}

/** 动态世界书聚合源类型接口（纯函数层） */
export interface DynamicWorldbookCatalog {
  researches?: readonly (ResearchDef | WorldbookResearchData)[];
  buildings?: readonly (BuildingDef | WorldbookBuildingData)[];
  productions?: readonly (ProductionDef | WorldbookProductionData)[];
  retrofits?: readonly (RetrofitDef | WorldbookRetrofitData)[];
  projects?: readonly (ProjectDef | WorldbookProjectData)[];
  protocols?:
    | readonly (ProtocolCatalogItem | WbProtocolBlock | (Partial<WbProtocolBlock> & { id: string; name?: string }))[]
    | Record<
        string,
        ProtocolCatalogItem | WbProtocolBlock | (Partial<WbProtocolBlock> & { id: string; name?: string })
      >;
  /** 可选：当前已激活协议集合（透传供 mergeEffectiveCatalog reveals 可见性过滤使用） */
  activeProtocols?: ActiveProtocolsInput;
}

export interface ProtocolRuntimeInstanceLike {
  ref?: string;
  id?: string;
  name?: string;
  status?: string;
}

export type ActiveProtocolsInput =
  | Iterable<string | ProtocolRuntimeInstanceLike>
  | {
      activeProtocols?: Iterable<string | ProtocolRuntimeInstanceLike> | null;
      protocols?: Iterable<string | ProtocolRuntimeInstanceLike> | null;
    }
  | null
  | undefined;

/** 将世界书建筑数据映射为兼容 BuildingDef 的对象，完整透传 v1.2 物理字段 */
export function worldbookBuildingToDef(item: WorldbookBuildingData): BuildingDef {
  return {
    ...item,
    name: item.name,
    cost: item.cost ?? 0,
    power: item.power ?? 0,
    research: item.research ?? null,
    need_building: item.need_building,
    prereqs: item.prereqs ?? [],
    need_buildings: item.need_buildings ?? [],
    requirements: item.requirements,
    desc: item.desc ?? '',
  };
}

/**
 * 世界书 V2（schema_version:2）透传元数据：挂在有效目录研究 def 上，供名↔ID 索引层与体检使用。
 * 不改变既有 ResearchDef 字段语义；tech.done 仍按名存储，ID/别名只存在于索引层。
 */
export interface WorldbookV2Meta {
  aliases?: string[];
  scope?: string;
  faction?: string;
  pack?: string;
  status?: string;
  replaced_by?: string;
  grants?: string[];
}

/** 有效目录中的研究定义（ResearchDef + 可选 V2 元数据） */
export type EffectiveResearchDef = ResearchDef & WorldbookV2Meta;

/** 将世界书科技数据映射为兼容 ResearchDef 的对象，完整透传 v1.2 物理字段与 V2 元数据字段 */
export function worldbookResearchToDef(item: WorldbookResearchData): EffectiveResearchDef {
  return {
    ...item,
    name: item.name,
    cost: item.cost ?? 0,
    eta: item.eta ?? '',
    line: item.line ?? '通用',
    tier: (item.tier ?? 1) as 1 | 2 | 3,
    unlocks: item.unlocks ?? '',
    prereq: item.prereq ?? '',
    prereqs: item.prereqs ?? [],
    need_buildings: item.need_buildings ?? [],
    need_units: item.need_units,
    requirements: item.requirements,
    desc: item.desc ?? '',
    // V2（schema_version:2）元数据显式透传（tech.done 仍按名存储，ID/别名只在索引层使用）
    aliases: item.aliases,
    scope: item.scope,
    faction: item.faction,
    pack: item.pack,
    status: item.status,
    replaced_by: item.replaced_by,
    grants: item.grants,
  };
}

/** 将世界书生产数据映射为兼容 ProductionDef 的对象，完整透传 v1.2 物理字段 */
export function worldbookProductionToDef(item: WorldbookProductionData): ProductionDef {
  return {
    ...item,
    name: item.name,
    cost: item.cost ?? 0,
    need_building: item.need_building ?? '',
    need_buildings: item.need_buildings ?? [],
    prereqs: item.prereqs ?? [],
    requirements: item.requirements,
    ...(typeof item.max_count === 'number' ? { max_count: item.max_count } : {}),
    ...(Array.isArray(item.aliases) ? { aliases: item.aliases } : {}),
    desc: item.desc ?? '',
  };
}

/** 将世界书改装数据映射为兼容 RetrofitDef 的对象 */
export function worldbookRetrofitToDef(item: WorldbookRetrofitData): RetrofitDef {
  const grade = (item.grade === '小改' || item.grade === '大改' ? item.grade : '中改') as '小改' | '中改' | '大改';
  return {
    ...item,
    kind: 'retrofit',
    name: item.name || item.id,
    research: item.research,
    grade,
    desc: item.desc ?? '',
  };
}

/**
 * 将世界书仓段化 project 块映射为 ProjectDef（V2-04）。
 * 口径对齐 worldbookRetrofitToDef：grade 枚举宽容收敛（合法四档保留，未知/缺席丢弃 →
 * 引擎缺省补「巨构」，D-C2），name/desc 兑底；requirements/modules 逐字段透传（形状已由
 * parser schema 判别，此处不做二次校验）；type:'project' 等解析器专属键随展开残留，不影响赋值兼容。
 */
export function worldbookProjectToDef(item: WorldbookProjectData): ProjectDef {
  const grade: ProjectDef['grade'] =
    item.grade === '小改' || item.grade === '中改' || item.grade === '大改' || item.grade === '巨构'
      ? item.grade
      : undefined;
  return {
    ...item,
    kind: 'project',
    id: item.id,
    name: item.name,
    grade,
    desc: item.desc ?? '',
    modules: item.modules,
  };
}

export function normalizeWbBuildings(items: readonly (BuildingDef | WorldbookBuildingData)[]): BuildingDef[] {
  return items.map(item =>
    'type' in item && item.type === 'building'
      ? worldbookBuildingToDef(item as WorldbookBuildingData)
      : (item as BuildingDef),
  );
}

export function normalizeWbResearches(items: readonly (ResearchDef | WorldbookResearchData)[]): EffectiveResearchDef[] {
  return items.map(item =>
    'type' in item && item.type === 'research'
      ? worldbookResearchToDef(item as WorldbookResearchData)
      : (item as ResearchDef),
  );
}

export function normalizeWbProductions(items: readonly (ProductionDef | WorldbookProductionData)[]): ProductionDef[] {
  return items.map(item =>
    'type' in item && item.type === 'production'
      ? worldbookProductionToDef(item as WorldbookProductionData)
      : (item as ProductionDef),
  );
}

export function normalizeWbRetrofits(items: readonly (RetrofitDef | WorldbookRetrofitData)[]): RetrofitDef[] {
  return items.map(item =>
    'type' in item && item.type === 'retrofit'
      ? worldbookRetrofitToDef(item as WorldbookRetrofitData)
      : (item as RetrofitDef),
  );
}

export function normalizeWbProjects(items: readonly (ProjectDef | WorldbookProjectData)[]): ProjectDef[] {
  return items.map(item =>
    'type' in item && item.type === 'project'
      ? worldbookProjectToDef(item as WorldbookProjectData)
      : (item as ProjectDef),
  );
}

export type WbProtocolInput =
  | ProtocolCatalogItem
  | WbProtocolBlock
  | WorldbookProtocolData
  | (Partial<WbProtocolBlock> & { id: string; name?: string });

/**
 * 将单个世界书 protocol 数据块或静态协议定义归一化为 ProtocolCatalogItem（PRT-PARSE-01）。
 * 自动补齐：
 * - cost_points = block.cost_points ?? 1
 * - experiment_cost_credits = block.experiment_cost_credits ?? (tier === 1 ? 500 : tier === 2 ? 1500 : 4000)
 * - reveals = block.reveals ?? []
 * - exclusive_with = block.exclusive_with ?? []
 */
export function worldbookProtocolToDef(block: WbProtocolInput): ProtocolCatalogItem {
  const tier: 1 | 2 | 3 = block.tier === 2 || block.tier === 3 ? block.tier : 1;
  const id = typeof block.id === 'string' && block.id.trim() ? block.id.trim() : String(block.name ?? '');
  const rawName = typeof block.name === 'string' ? block.name.trim() : '';
  const name = rawName || resolveLegacyProtocolName(id) || id;
  const rawFaction = typeof block.faction === 'string' ? block.faction.trim() : '';
  const faction = rawFaction || (id.startsWith('sov.') ? '苏联' : id.startsWith('all.') ? '盟军' : '');

  return {
    ...block,
    type: 'protocol',
    schema_version: block.schema_version ?? 2,
    id,
    name,
    scope: block.scope ?? 'faction',
    faction,
    track: block.track ?? '',
    tier,
    cost_points: block.cost_points ?? 1,
    experiment_cost_credits: block.experiment_cost_credits ?? defaultExperimentCostCreditsByTier(tier),
    reveals: Array.isArray(block.reveals) ? [...block.reveals] : [],
    discovery: block.discovery,
    exclusive_with: Array.isArray(block.exclusive_with) ? [...block.exclusive_with] : [],
    requirements: block.requirements,
    pack: block.pack ?? 'base',
    status: block.status ?? 'active',
    desc: block.desc ?? '',
    tags: Array.isArray(block.tags) ? [...block.tags] : [],
  };
}

/**
 * 批量归一化协议块列表（PRT-PARSE-01 · 任务包 §3.1 / §6 PRT-PARSE-01）。
 * 同时兼容 WbProtocolBlock[] 数组与 Record<string, WbProtocolBlock> 字典输入。
 */
export function normalizeWbProtocols(
  blocks?: readonly WbProtocolInput[] | Record<string, WbProtocolInput> | null,
): ProtocolCatalogItem[] {
  if (!blocks) return [];
  const list: readonly WbProtocolInput[] = Array.isArray(blocks)
    ? blocks
    : isPlainRecord(blocks)
      ? (Object.values(blocks) as WbProtocolInput[])
      : [];
  return list
    .filter(
      (item): item is WbProtocolInput =>
        isPlainRecord(item) && (typeof item.id === 'string' || typeof item.name === 'string'),
    )
    .map(worldbookProtocolToDef);
}

/**
 * 按协议 id / name 合并多源协议层（后层覆盖前层同 id 或同 name 项并保留原位，新项追加）。
 * 同时在返回数组上挂载非枚举的 id/name 键属性，兼容数组遍历与字典下标访问。
 */
function mergeProtocolLayers(layers: readonly (readonly ProtocolCatalogItem[] | undefined)[]): ProtocolCatalogItem[] {
  const result: ProtocolCatalogItem[] = [];
  const indexById = new Map<string, number>();
  const indexByName = new Map<string, number>();

  for (const layer of layers) {
    for (const item of layer ?? []) {
      const existingIdx = indexById.get(item.id) ?? indexByName.get(item.name);
      if (existingIdx !== undefined) {
        result[existingIdx] = item;
        indexById.set(item.id, existingIdx);
        indexByName.set(item.name, existingIdx);
      } else {
        const idx = result.length;
        result.push(item);
        indexById.set(item.id, idx);
        indexByName.set(item.name, idx);
      }
    }
  }

  for (const item of result) {
    if (item.id && !(item.id in Array.prototype)) {
      Object.defineProperty(result, item.id, {
        value: item,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    }
    if (item.name && item.name !== item.id && !(item.name in Array.prototype)) {
      Object.defineProperty(result, item.name, {
        value: item,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    }
  }

  return result;
}

export interface TimelineDataPatchInput {
  id?: string;
  target?: string;
  category?: string;
  changes?: Record<string, unknown>;
  patch?: Record<string, unknown>;
}

function extractPatchChanges(patch: TimelineDataPatchInput | null | undefined): Record<string, unknown> | null {
  if (!isPlainRecord(patch)) return null;
  const hasChanges = isPlainRecord(patch.changes);
  const hasPatch = isPlainRecord(patch.patch);
  if (hasChanges && hasPatch) {
    return { ...(patch.patch as Record<string, unknown>), ...(patch.changes as Record<string, unknown>) };
  }
  if (hasChanges) return patch.changes as Record<string, unknown>;
  if (hasPatch) return patch.patch as Record<string, unknown>;
  return null;
}

function matchesCatalogTarget(item: { name?: string; id?: string }, target: string): boolean {
  return item.name === target || (typeof item.id === 'string' && item.id === target);
}

function applyChangesToCatalogList<T extends { name: string; id?: string }>(
  list: T[],
  target: string,
  changes: Record<string, unknown>,
): T[] {
  let matched = false;
  const next = list.map(item => {
    if (matchesCatalogTarget(item, target)) {
      matched = true;
      return { ...item, ...changes };
    }
    return item;
  });
  return matched ? next : list;
}

/**
 * 将楼层已批准的 `<数据更新>` 补丁列表合成为虚拟 DlcOverlay（17号方案A · SEAM-03 · FD-27 世界书 SSOT）。
 * 支持传入世界书基准目录 `baseCatalog`（优先于已退役的静态空数组），当 patches 为空或无有效补丁时返回 null。
 */
export function dataPatchesToDlcOverlay(
  patches:
    | readonly {
        id?: string;
        target?: string;
        category?: string;
        changes?: Record<string, unknown>;
        patch?: Record<string, unknown>;
      }[]
    | undefined
    | null,
  baseCatalog?:
    | Partial<Pick<EffectiveCatalog, 'researches' | 'buildings' | 'productions' | 'retrofits' | 'projects'>>
    | ParsedWorldbookCatalog
    | DynamicWorldbookCatalog
    | null,
): DlcOverlay | null {
  if (!patches || patches.length === 0) return null;

  const baseResearches: ResearchDef[] = baseCatalog?.researches?.length
    ? mergeByName(RESEARCHES, [normalizeWbResearches(baseCatalog.researches)])
    : RESEARCHES;
  const baseBuildings: BuildingDef[] = baseCatalog?.buildings?.length
    ? mergeByName(BUILDINGS, [normalizeWbBuildings(baseCatalog.buildings)])
    : BUILDINGS;
  const baseProductions: ProductionDef[] = baseCatalog?.productions?.length
    ? mergeByName(PRODUCTIONS, [normalizeWbProductions(baseCatalog.productions)])
    : PRODUCTIONS;
  const baseRetrofits: RetrofitDef[] = baseCatalog?.retrofits?.length
    ? mergeByName(RETROFITS, [normalizeWbRetrofits(baseCatalog.retrofits)])
    : RETROFITS;

  const researchMap = new Map<string, ResearchDef>();
  const buildingMap = new Map<string, BuildingDef>();
  const productionMap = new Map<string, ProductionDef>();
  const retrofitMap = new Map<string, RetrofitDef>();
  let anyMatched = false;

  for (const rawPatch of patches) {
    const target = typeof rawPatch?.target === 'string' ? rawPatch.target.trim() : '';
    const changes = extractPatchChanges(rawPatch);
    if (!target || !changes) continue;

    const category = typeof rawPatch?.category === 'string' ? rawPatch.category.trim().toLowerCase() : '';

    const matchResearch =
      !category || category === 'research' || category === 'researches' || category === '科技' || category === '研究';
    const matchBuilding =
      !category || category === 'building' || category === 'buildings' || category === '建筑';
    const matchProduction =
      !category || category === 'production' || category === 'productions' || category === '生产' || category === '载具';
    const matchRetrofit =
      !category || category === 'retrofit' || category === 'retrofits' || category === '改装';

    if (matchResearch) {
      const existing =
        [...researchMap.values()].find(r => matchesCatalogTarget(r, target)) ??
        baseResearches.find(r => matchesCatalogTarget(r, target));
      if (existing) {
        researchMap.set(existing.name, { ...existing, ...changes } as ResearchDef);
        anyMatched = true;
      }
    }
    if (matchBuilding) {
      const existing =
        [...buildingMap.values()].find(b => matchesCatalogTarget(b, target)) ??
        baseBuildings.find(b => matchesCatalogTarget(b, target));
      if (existing) {
        buildingMap.set(existing.name, { ...existing, ...changes } as BuildingDef);
        anyMatched = true;
      }
    }
    if (matchProduction) {
      const existing =
        [...productionMap.values()].find(p => matchesCatalogTarget(p, target)) ??
        baseProductions.find(p => matchesCatalogTarget(p, target));
      if (existing) {
        productionMap.set(existing.name, { ...existing, ...changes } as ProductionDef);
        anyMatched = true;
      }
    }
    if (matchRetrofit) {
      const existing =
        [...retrofitMap.values()].find(t => matchesCatalogTarget(t, target)) ??
        baseRetrofits.find(t => matchesCatalogTarget(t, target));
      if (existing) {
        retrofitMap.set(existing.name, { ...existing, ...changes } as RetrofitDef);
        anyMatched = true;
      }
    }
  }

  if (!anyMatched) return null;

  const overlay: DlcOverlay & { retrofits?: RetrofitDef[] } = {
    id: '__timeline_data_patches__',
  };
  if (researchMap.size > 0) overlay.researches = [...researchMap.values()];
  if (buildingMap.size > 0) overlay.buildings = [...buildingMap.values()];
  if (productionMap.size > 0) overlay.productions = [...productionMap.values()];
  if (retrofitMap.size > 0) overlay.retrofits = [...retrofitMap.values()];
  return overlay;
}

/**
 * 安装序 overlay 列表（可含损坏项，内部过滤）＋ 动态世界书源 → 有效目录
 *
 * 聚合优先级（FD-27 世界书唯一事实源 SSOT + 17号方案A SEAM-03）：
 * 1. 主干底座（Dynamic WB SSOT）：世界书 `<数据>` 块解析出的 `wbResearches / wbBuildings / wbProductions / wbRetrofits / wbProjects / wbProtocols`；
 * 2. 单测兼容槽（Legacy Fixture Slot）：仅当单测向已退役的 `catalog.ts` 数组注入测试 fixture 时参与合并；
 * 3. 扩展覆盖层（DLC Overlays）：叠加运行时 $dlc 扩展包；
 * 4. 时间线补丁层（Timeline Data Patches）：基于世界书有效目录应用楼层已批准 `<数据更新>` 补丁。
 */
export function mergeEffectiveCatalog(
  overlays: readonly DlcOverlay[],
  dynamicWb?: ParsedWorldbookCatalog | DynamicWorldbookCatalog | null,
  activeProtocols?: ActiveProtocolsInput,
  appliedDataPatches?:
    | readonly {
        id?: string;
        target?: string;
        category?: string;
        changes?: Record<string, unknown>;
        patch?: Record<string, unknown>;
      }[]
    | null,
): EffectiveCatalog {
  const wbBuildings = dynamicWb?.buildings?.length ? normalizeWbBuildings(dynamicWb.buildings) : [];
  const wbResearches = dynamicWb?.researches?.length ? normalizeWbResearches(dynamicWb.researches) : [];
  const wbProductions = dynamicWb?.productions?.length ? normalizeWbProductions(dynamicWb.productions) : [];
  const wbRetrofits = dynamicWb?.retrofits?.length ? normalizeWbRetrofits(dynamicWb.retrofits) : [];
  const wbProjects = dynamicWb?.projects?.length ? normalizeWbProjects(dynamicWb.projects) : [];
  const wbProtocols = normalizeWbProtocols(dynamicWb?.protocols);

  const effective = overlays.filter((o): o is DlcOverlay => isCatalogOverlayUsable(o, wbResearches));
  const factionDefs = new Map<string, FactionDef>();
  const put = (d: FactionDef) => {
    if (!factionDefs.has(d.faction)) factionDefs.set(d.faction, d);
  };
  FACTION_DEFS.forEach(put);
  for (const o of effective) {
    if (o.faction)
      put({
        faction: o.faction.name ?? o.id,
        mcv: o.faction.mcv,
        lab: o.faction.lab,
        labResearch: o.faction.labResearch ?? null,
      });
  }

  const staticProtocols = normalizeWbProtocols([...PROTOCOLS, ...Object.values(STATIC_PROTOCOLS)]);
  const dlcProtocolLayers = effective.map(o => normalizeWbProtocols(o.protocols)).filter(layer => layer.length > 0);
  const hasAnyProtocols = wbProtocols.length > 0 || staticProtocols.length > 0 || dlcProtocolLayers.length > 0;
  // 遵循优先级：世界书动态条目 (wbProtocols) > 静态兼容槽 (staticProtocols) > DLC (dlcProtocolLayers)
  const mergedProtocols = hasAnyProtocols
    ? mergeProtocolLayers([...dlcProtocolLayers, staticProtocols, wbProtocols])
    : PROTOCOLS;

  // 同名研究覆盖检测（只收集 warn，不阻断、不改变 mergeByName 覆盖语义）
  const researchWarnings: string[] = [];
  if (wbResearches.length > 0) {
    const legacyFixtureNames = new Set(RESEARCHES.map(r => r.name));
    const seenWbNames = new Set<string>();
    for (const r of wbResearches) {
      if (legacyFixtureNames.has(r.name)) {
        researchWarnings.push(`[同名覆盖] 世界书研究「${r.name}」覆盖静态基线同名研究（世界书源生效）`);
      }
      if (seenWbNames.has(r.name)) {
        researchWarnings.push(`[同名覆盖] 世界书研究「${r.name}」在世界书源内重复定义（后者生效）`);
      }
      seenWbNames.add(r.name);
    }
  }

  const mergedResearches = mergeByName(RESEARCHES, [wbResearches, ...effective.map(o => o.researches)]);
  const effectiveActiveProtocols =
    activeProtocols !== undefined
      ? activeProtocols
      : dynamicWb && 'activeProtocols' in dynamicWb
        ? dynamicWb.activeProtocols
        : undefined;
  const visibleResearches = filterVisibleResearches(
    mergedResearches,
    mergedProtocols as unknown as import('./catalogOverlayHelpers').ProtocolRevealSource,
    effectiveActiveProtocols,
  );

  let finalResearches = visibleResearches;
  let finalBuildings = mergeByName(BUILDINGS, [wbBuildings, ...effective.map(o => o.buildings)]);
  let finalProductions = mergeByName(PRODUCTIONS, [wbProductions, ...effective.map(o => o.productions)]);
  let finalRetrofits = wbRetrofits.length > 0 ? mergeByName(RETROFITS, [wbRetrofits]) : RETROFITS;
  let finalProjects = wbProjects.length > 0 ? mergeByName(PROJECTS, [wbProjects]) : PROJECTS;

  if (appliedDataPatches && appliedDataPatches.length > 0) {
    const patchOverlay = dataPatchesToDlcOverlay(appliedDataPatches, {
      researches: finalResearches,
      buildings: finalBuildings,
      productions: finalProductions,
      retrofits: finalRetrofits,
      projects: finalProjects,
    }) as (DlcOverlay & { retrofits?: RetrofitDef[] }) | null;

    if (patchOverlay) {
      if (patchOverlay.researches?.length) {
        finalResearches = mergeByName(finalResearches, [patchOverlay.researches]);
      }
      if (patchOverlay.buildings?.length) {
        finalBuildings = mergeByName(finalBuildings, [patchOverlay.buildings]);
      }
      if (patchOverlay.productions?.length) {
        finalProductions = mergeByName(finalProductions, [patchOverlay.productions]);
      }
      if (patchOverlay.retrofits?.length) {
        finalRetrofits = mergeByName(finalRetrofits, [patchOverlay.retrofits]);
      }
    }

    for (const rawPatch of appliedDataPatches) {
      const target = typeof rawPatch?.target === 'string' ? rawPatch.target.trim() : '';
      const changes = extractPatchChanges(rawPatch);
      if (!target || !changes) continue;
      finalProjects = applyChangesToCatalogList(finalProjects, target, changes);
    }
  }

  return {
    researches: finalResearches,
    buildings: finalBuildings,
    productions: finalProductions,
    retrofits: finalRetrofits,
    projects: finalProjects,
    protocols: mergedProtocols,
    factionDefs: [...factionDefs.values()],
    researchWarnings,
  };
}

export * from './catalogOverlayHelpers';


