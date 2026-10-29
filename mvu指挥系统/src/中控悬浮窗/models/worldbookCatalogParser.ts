/**
 * worldbookCatalogParser.ts —— 世界书单一事实源（SSOT）纯函数解析模块（CTRL-FRONT-CAT-01）
 *
 * 核心职责：
 * 1. 从世界书条目数组中提取 `<数据>...</数据>` 块，兼容前后换行、缩进与空白；
 * 2. 基于 Zod 严格校验与归一化数据，构建强类型数据对象（建筑/科技/生产/改装）；
 * 3. 完整支持 Tags、动态条件工况（operation）、实体与虚拟产出三元组（inputs/outputs/storage）、
 *    双轨代偿配方（recipes）等 v1.2 物理字段；
 * 4. 描述字段智能提炼：数据块未显式定义 desc 时，自动提取外部自然叙述首段（剥离中括号标题与数据标签）；
 * 5. 异常隔离：单个条目损坏仅记录警告与诊断，绝不中断整体解析；
 * 6. 纯函数原则：零 Pinia、零 Vue、零宿主 API 强依赖，通用运行于 Node.js / Vitest / 浏览器环境。
 */

import { validatePrerequisiteCondition } from '../../红警指挥系统/core/prerequisites';
import {
  defaultExperimentCostCreditsByTier,
  extractDataBlockString,
  extractDescriptionFromContent,
  preprocessRawData as basePreprocessRawData,
  stripMassProductionSuffix,
  WorldbookDataBlockSchema,
  type WbProtocolBlock,
  type WorldbookBuildingData,
  type WorldbookDataBlock,
  type WorldbookMaidenData,
  type WorldbookProductionData,
  type WorldbookProjectData,
  type WorldbookProtocolData,
  type WorldbookResearchData,
  type WorldbookRetrofitData,
} from './worldbookCatalogHelpers';

export * from './worldbookCatalogHelpers';

export function preprocessRawData(raw: unknown): unknown {
  const res = basePreprocessRawData(raw);
  if (
    typeof res === 'object' &&
    res !== null &&
    !Array.isArray(res) &&
    typeof (res as Record<string, unknown>).system === 'string' &&
    ((res as Record<string, unknown>).system as string).trim().toLowerCase() === 'agriculture'
  ) {
    (res as Record<string, unknown>).system = 'agro';
  }
  return res;
}

// ==========================================
// 3. 解析器输入与输出接口
// ==========================================

export interface WorldbookEntryLike {
  uid?: number;
  name?: string;
  comment?: string;
  content?: string;
  enabled?: boolean;
  disable?: boolean;
  [key: string]: unknown;
}

export interface CatalogParserDiagnostic {
  entryName: string;
  code: 'json_syntax_error' | 'validation_error' | 'empty_data_block' | 'invalid_structure';
  message: string;
  rawText?: string;
  issues?: z.ZodIssue[];
  rawObj?: unknown;
}

export interface ParsedWorldbookCatalog {
  buildings: WorldbookBuildingData[];
  researches: WorldbookResearchData[];
  productions: WorldbookProductionData[];
  retrofits: WorldbookRetrofitData[];
  /** 仓段化 V2 工程块（V2-04 激活，schema_version 2；schema_version ≠2 的 project 块 fail-closed 隔离） */
  projects: WorldbookProjectData[];
  /** 协议数据块集合（PRT-PARSE-01 · 任务包 §3.1 / D-P17） */
  protocols: WbProtocolBlock[];
  /** 所有解析成功的数据块映射表（按 id 索引） */
  byId: Record<string, WorldbookDataBlock>;
  /** 所有解析成功的数据块数组 */
  items: WorldbookDataBlock[];
  /** 格式异常或校验未通过的诊断记录 */
  diagnostics: CatalogParserDiagnostic[];
}

export interface ParserOptions {
  /** 是否静默控制台警告日志（单测建议开启） */
  silent?: boolean;
  /** 自定义日志记录器 */
  logger?: {
    warn: (msg: string, ...args: unknown[]) => void;
  };
  /** 描述文字截断长度（缺省不截断） */
  descMaxLength?: number;
}

// ==========================================
// 4. 类型守卫函数
// ==========================================

export function isBuildingData(block: WorldbookDataBlock): block is WorldbookBuildingData {
  return block.type === 'building';
}

export function isResearchData(block: WorldbookDataBlock): block is WorldbookResearchData {
  return block.type === 'research';
}

export function isProductionData(block: WorldbookDataBlock): block is WorldbookProductionData {
  return block.type === 'production';
}

export function isRetrofitData(block: WorldbookDataBlock): block is WorldbookRetrofitData {
  return block.type === 'retrofit';
}

/** project 块类型守卫（V2-04 激活：仓段化 V2 工程块，schema_version 2） */
export function isProjectData(block: WorldbookDataBlock): block is WorldbookProjectData {
  return block.type === 'project';
}

/** protocol 块类型守卫（PRT-PARSE-01：协议数据块） */
export function isProtocolData(block: WorldbookDataBlock): block is WorldbookProtocolData {
  return block.type === 'protocol';
}

/** maiden 块类型守卫（MAIDEN-DATA-01：机娘能力档案数据块） */
export function isMaidenData(block: WorldbookDataBlock): block is WorldbookMaidenData {
  return block.type === 'maiden';
}

/**
 * 解析单个条目的数据块
 */
export function parseSingleDataBlock(
  rawText: string,
  options?: {
    entryName?: string;
    content?: string;
    descMaxLength?: number;
    logger?: { warn: (msg: string, ...args: unknown[]) => void };
  },
): { success: true; data: WorldbookDataBlock } | { success: false; diagnostic: CatalogParserDiagnostic } {
  const entryName = options?.entryName || 'unknown_entry';
  const logger = options?.logger;

  if (!rawText || rawText.trim() === '') {
    const diagnostic: CatalogParserDiagnostic = {
      entryName,
      code: 'empty_data_block',
      message: '数据块内容为空',
      rawText,
    };
    logger?.warn(`[worldbookCatalogParser] 数据块内容为空: ${entryName}`);
    return { success: false, diagnostic };
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawText);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const diagnostic: CatalogParserDiagnostic = {
      entryName,
      code: 'json_syntax_error',
      message: errorMsg,
      rawText,
    };
    logger?.warn(`[worldbookCatalogParser] JSON 语法损坏 (${entryName}): ${errorMsg}`);
    return { success: false, diagnostic };
  }

  const preprocessed = preprocessRawData(rawJson);
  const parseResult = WorldbookDataBlockSchema.safeParse(preprocessed);

  if (!parseResult.success) {
    const errorMsg = parseResult.error.message;
    const diagnostic: CatalogParserDiagnostic = {
      entryName,
      code: 'validation_error',
      message: errorMsg,
      issues: parseResult.error.issues,
      rawObj: rawJson,
      rawText,
    };
    logger?.warn(`[worldbookCatalogParser] Schema 校验未通过 (${entryName}): ${errorMsg}`);
    return { success: false, diagnostic };
  }

  const data = parseResult.data as WorldbookDataBlock;

  // V2-04 仓段模块缺省兑底：module.name 空缺回填 module.id
  //（preprocessRawData 块级 id/name 双向对称的模块版；投影命名 `ref·模块名` 不因缺名退化）
  if (data.type === 'project' && Array.isArray(data.modules)) {
    for (const m of data.modules) {
      if (!m.name) m.name = m.id;
    }
  }

  // PRT-PARSE-01 协议块缺省兑底与准入门原子树校验（任务包 §3.1 / §6 PRT-PARSE-01）
  if (data.type === 'protocol') {
    if (typeof data.cost_points !== 'number') {
      data.cost_points = 1;
    }
    if (typeof data.experiment_cost_credits !== 'number') {
      data.experiment_cost_credits = defaultExperimentCostCreditsByTier(data.tier);
    }
    if (!Array.isArray(data.reveals)) {
      data.reveals = [];
    }
    if (!Array.isArray(data.exclusive_with)) {
      data.exclusive_with = [];
    }
    if (!data.faction && typeof data.id === 'string') {
      if (data.id.startsWith('sov.')) data.faction = '苏联';
      else if (data.id.startsWith('all.')) data.faction = '盟军';
    }
    if (data.requirements !== undefined) {
      const isEmptyReqObject =
        typeof data.requirements === 'object' &&
        data.requirements !== null &&
        !Array.isArray(data.requirements) &&
        Object.keys(data.requirements as Record<string, unknown>).length === 0;
      if (!isEmptyReqObject) {
        const reqIssues = validatePrerequisiteCondition(data.requirements, 'requirements');
        if (reqIssues.length > 0) {
          const msg = `protocol requirements 校验未通过: ${reqIssues.map(i => `${i.path}: ${i.message}`).join('; ')}`;
          const diagnostic: CatalogParserDiagnostic = {
            entryName,
            code: 'validation_error',
            message: msg,
            rawObj: rawJson,
            rawText,
          };
          logger?.warn(`[worldbookCatalogParser] ${msg} (${entryName})`);
          return { success: false, diagnostic };
        }
      }
    }
  }

  // A9 遗留补强（ENG-WB-01 回填期落地）：retrofit 块顶层禁止裸 nanites 字段——
  // P0 对象化红线要求纳米需求必须经 resources: { nanites } 承载；裸字段判 validation_error 并条目级隔离。
  if (
    data.type === 'retrofit' &&
    typeof rawJson === 'object' &&
    rawJson !== null &&
    !Array.isArray(rawJson) &&
    'nanites' in (rawJson as Record<string, unknown>)
  ) {
    const diagnostic: CatalogParserDiagnostic = {
      entryName,
      code: 'validation_error',
      message: 'retrofit 块禁止顶层裸 nanites 字段，纳米需求必须经 resources: { nanites } 对象化承载（P0 红线）',
      rawObj: rawJson,
      rawText,
    };
    logger?.warn(`[worldbookCatalogParser] retrofit 裸 nanites 字段已拒绝 (${entryName})`);
    return { success: false, diagnostic };
  }

  // V2 点号稳定 ID 护栏（《通用·科技》世界书 V1 §3/W4 §1）：id 含 '.' 的条目视为 v2 条目，
  // 必须显式声明 name 且 name ≠ id；否则显示名会退化成 ext.tech.xxx 并写进 tech.done。
  // 违规条目生成诊断并跳过（条目级隔离），不影响其他条目；v1 条目（id 即中文名）维持原行为。
  if (data.type === 'research' && typeof data.id === 'string' && data.id.includes('.')) {
    const rawName =
      typeof rawJson === 'object' && rawJson !== null && !Array.isArray(rawJson)
        ? (rawJson as Record<string, unknown>).name
        : undefined;
    const explicitName = typeof rawName === 'string' ? rawName.trim() : '';
    if (!explicitName || explicitName === data.id) {
      const diagnostic: CatalogParserDiagnostic = {
        entryName,
        code: 'validation_error',
        message: `V2 点号 ID 条目必须显式声明 name 且 ≠ id（id: ${data.id}）`,
        rawObj: rawJson,
        rawText,
      };
      logger?.warn(`[worldbookCatalogParser] V2 条目缺显示名，已隔离 (${entryName}): id=${data.id}`);
      return { success: false, diagnostic };
    }
  }

  // V2-04 project 点号 ID 护栏（research 同形）：命名规约 <阵营>.project.<slug> 下 id 含 '.'，
  // 必须显式声明 name 且 ≠ id——否则运行时引用键 ref=def.name 退化成 all.project.xxx，
  // 污染工程账本与投影命名合同；违规条目级隔离，不影响其他条目。
  if (data.type === 'project' && typeof data.id === 'string' && data.id.includes('.')) {
    const rawName =
      typeof rawJson === 'object' && rawJson !== null && !Array.isArray(rawJson)
        ? (rawJson as Record<string, unknown>).name
        : undefined;
    const explicitName = typeof rawName === 'string' ? rawName.trim() : '';
    if (!explicitName || explicitName === data.id) {
      const diagnostic: CatalogParserDiagnostic = {
        entryName,
        code: 'validation_error',
        message: `V2 project 点号 ID 块必须显式声明 name 且 ≠ id（id: ${data.id}）`,
        rawObj: rawJson,
        rawText,
      };
      logger?.warn(`[worldbookCatalogParser] V2 project 块缺显示名，已隔离 (${entryName}): id=${data.id}`);
      return { success: false, diagnostic };
    }
  }

  // 保证 name 始终存在
  if (!data.name) {
    data.name = data.id;
  }

  // 生产项目统一剥离尾部“（量产体）”/“（量产型步兵）”后缀，同时将旧名记入 aliases 保持向后兼容
  if (data.type === 'production') {
    const rawProdName = data.name;
    const cleanedProdName = stripMassProductionSuffix(rawProdName);
    if (cleanedProdName && cleanedProdName !== rawProdName) {
      data.name = cleanedProdName;
      const existingAliases = Array.isArray(data.aliases) ? data.aliases : [];
      if (!existingAliases.includes(rawProdName)) {
        data.aliases = [...existingAliases, rawProdName];
      }
      if (typeof data.id === 'string' && !data.id.includes('.') && stripMassProductionSuffix(data.id) === cleanedProdName) {
        data.id = cleanedProdName;
      }
    }
  }

  // 若未显式定义 desc 或 desc 为空白，则从正文中自动提炼
  if (!data.desc || data.desc.trim() === '') {
    if (options?.content) {
      data.desc = extractDescriptionFromContent(options.content, options.descMaxLength);
    }
  }

  return { success: true, data };
}

/**
 * 归一化输入的世界书条目列表
 * 支持格式：
 * 1. WorldbookEntry[]
 * 2. { entries: Record<string, WorldbookEntry> } 或 { entries: WorldbookEntry[] }
 * 3. Record<string, WorldbookEntry>
 */
export function normalizeWorldbookEntries(raw: unknown): WorldbookEntryLike[] {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw.filter((item): item is WorldbookEntryLike => typeof item === 'object' && item !== null);
  }

  if (typeof raw === 'object') {
    const rec = raw as Record<string, unknown>;
    if ('entries' in rec) {
      const entries = rec.entries;
      if (Array.isArray(entries)) {
        return entries.filter((item): item is WorldbookEntryLike => typeof item === 'object' && item !== null);
      }
      if (typeof entries === 'object' && entries !== null) {
        return Object.values(entries).filter(
          (item): item is WorldbookEntryLike => typeof item === 'object' && item !== null,
        );
      }
    }
    // 可能是字典对象 { "0": { ... }, "1": { ... } }
    return Object.values(rec).filter((item): item is WorldbookEntryLike => typeof item === 'object' && item !== null);
  }

  return [];
}

/**
 * 纯函数主入口：从世界书条目数组中解析全部量化 Catalog 数据
 *
 * @param raw 世界书数据（条目数组或世界书 JSON 对象）
 * @param options 解析选项（静默、日志器、描述截断等）
 * @returns 强类型结构化目录与诊断报告
 */
export function parseWorldbookEntries(raw: unknown, options?: ParserOptions): ParsedWorldbookCatalog {
  const logger = options?.logger || (options?.silent ? { warn: () => {} } : console);
  const entries = normalizeWorldbookEntries(raw);

  const buildings: WorldbookBuildingData[] = [];
  const researches: WorldbookResearchData[] = [];
  const productions: WorldbookProductionData[] = [];
  const retrofits: WorldbookRetrofitData[] = [];
  const projects: WorldbookProjectData[] = [];
  const protocols: WbProtocolBlock[] = [];
  const byId: Record<string, WorldbookDataBlock> = {};
  const items: WorldbookDataBlock[] = [];
  const diagnostics: CatalogParserDiagnostic[] = [];

  for (const entry of entries) {
    const content = typeof entry.content === 'string' ? entry.content : '';
    if (!content) continue;

    const rawDataBlock = extractDataBlockString(content);
    // 没有 <数据> 标签则属于纯设定（State D）或待回填（State B），安全放行
    if (rawDataBlock === null) continue;

    const entryName =
      (typeof entry.name === 'string' && entry.name) ||
      (typeof entry.comment === 'string' && entry.comment) ||
      (typeof entry.uid === 'number' ? `uid_${entry.uid}` : 'unknown_entry');

    const result = parseSingleDataBlock(rawDataBlock, {
      entryName,
      content,
      descMaxLength: options?.descMaxLength,
      logger,
    });

    if (result.success) {
      const item = result.data;
      byId[item.id] = item;
      items.push(item);

      switch (item.type) {
        case 'building':
          buildings.push(item);
          break;
        case 'research':
          researches.push(item);
          break;
        case 'production':
          // 排除混入 production 块但属于非实物的条令/总览（category === 'doctrine'）
          if (item.category !== 'doctrine') {
            productions.push(item);
          }
          break;
        case 'retrofit':
          retrofits.push(item);
          break;
        case 'project':
          // V2-04 激活：仓段化 V2 工程块落专项桶（schema_version 2 已由 schema 判别，
          // ≠2 的 project 块在 parseSingleDataBlock 阶段 fail-closed 隔离）
          projects.push(item);
          break;
        case 'protocol':
          protocols.push(item);
          break;
      }
    } else {
      diagnostics.push(result.diagnostic);
    }
  }

  const catalogResult: ParsedWorldbookCatalog = {
    buildings,
    researches,
    productions,
    retrofits,
    projects,
    protocols,
    byId,
    items,
    diagnostics,
  };
  if (protocols.length === 0) {
    Object.defineProperty(catalogResult, 'protocols', {
      value: protocols,
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
  return catalogResult;
}

