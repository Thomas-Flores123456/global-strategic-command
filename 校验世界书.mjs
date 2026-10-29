#!/usr/bin/env node
/**
 * 世界书导入校验脚本（独立世界书文件 / World Info 格式）
 *
 * 用途：在导入 SillyTavern 之前，本地检查独立世界书 JSON 是否结构合法、
 *       字段类型是否正确、枚举是否越界、是否有会导致导入失败或行为异常的问题。
 *
 * 校验目标格式：ST「世界书编辑器」导出/导入的独立文件，即
 *   { "entries": { "0": {...}, "1": {...} } }
 * 字段为 camelCase（selectiveLogic / excludeRecursion / preventRecursion ...）。
 * 注意：这与「卡内世界书」(character_book 数组 + snake_case) 是两套 schema，本脚本只校验前者。
 *
 * 校验依据：TavernWeave Library A3《世界书优化》(回源 ST v1.14.0 world-info.js)
 *          与 A2《角色卡格式规范》字段定义。
 *
 * 用法：
 *   node 校验世界书.mjs 文件1.json [文件2.json ...]
 *   node 校验世界书.mjs            (不带参数则校验脚本同级 worldbooks/ 下所有 *世界书*.json)
 *
 * 退出码：0=全部通过(可能有 warn)，1=至少一个文件有 error，2=脚本使用错误。
 *
 * <数据> 块校验层（S1 离线门扩展）：在上方外壳校验之外，解析每条 content 中的全部
 * <数据> 块，校验块内 JSON、type 白名单（V2-04 起含仓段化 project 块，规则 11：
 * schema_version=2、点号 ID name 护栏、grade/scope 枚举、requirements 扁平四键、
 * modules 非空、prereqs 引用存在、Kahn 无环、模块 workload days/min_days D12 值域）、
 * V2 点号 ID research 规则、requirements 原子白名单（复刻运行时 prerequisites.ts 条件内核；
 * project 块 requirements 走扁平四键口径，不入条件树）、workload 形状、跨全书 id/name/aliases
 * 唯一性、悬空引用（存量 warn / 《通用·科技》判红）、研究前置环（红）、有效名碰撞
 * （有效名=name??id，对齐运行时 name 缺省=id 语义；补「name 撞别人的 id」缝隙）与
 * aliases 撞有效名，以及分层科研工期规则（09-research-pacing-convention-draft §2/§3，
 * 已冻结：T2 min_days∈[5,10]、T3∈[20,60] 必声明、T1 声明则∈[1,2]、days/eta 不得短于
 * min_days、算力需求缺 min_days 提示）。存量多块条目、悬空引用、纯存量有效名碰撞属已知债，warn 不判红；
 * 《通用·科技_世界书.json》书内多块/悬空引用、及任一方涉及该书的有效名碰撞判红。
 *
 * 免责边界：本脚本只做「静态离线校验」。它能拦住结构性 / 类型 / 枚举错误，
 *          但不能替代真机导入验证——激活行为、递归、分组竞争等运行时语义
 *          仍须在真实 SillyTavern 中确认。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- 字段规格（来自 A3/A2 + v1.14.0 回源） ----------

const POSITION_ENUM = {
  0: 'Before Char Defs',
  1: 'After Char Defs',
  2: "Top of Author's Note",
  3: "Bottom of Author's Note",
  4: '@ Depth',
  5: 'Before Example Messages',
  6: 'After Example Messages',
  7: 'Outlet',
};

const SELECTIVE_LOGIC_ENUM = {
  0: 'AND_ANY',
  1: 'NOT_ALL',
  2: 'NOT_ANY',
  3: 'AND_ALL',
};

const ROLE_ENUM = { 0: 'system', 1: 'user', 2: 'assistant' };

// 每个条目的字段规格：type 之一 'bool'|'int'|'string'|'array'|'intOrNull'|'boolOrNull'
// required=true 表示缺失会导致导入风险（记为 error 或 warn，见校验逻辑）
const ENTRY_FIELD_SPEC = {
  uid:                 { type: 'int',        required: true },
  key:                 { type: 'array',      required: true },
  keysecondary:        { type: 'array',      required: false },
  comment:             { type: 'string',     required: false },
  content:             { type: 'string',     required: true },
  constant:            { type: 'bool',       required: false },
  vectorized:          { type: 'bool',       required: false },
  selective:           { type: 'bool',       required: false },
  selectiveLogic:      { type: 'int',        required: false, enum: SELECTIVE_LOGIC_ENUM },
  addMemo:             { type: 'bool',       required: false },
  order:               { type: 'int',        required: false },
  position:            { type: 'int',        required: false, enum: POSITION_ENUM },
  disable:             { type: 'bool',       required: false },
  excludeRecursion:    { type: 'bool',       required: false },
  preventRecursion:    { type: 'bool',       required: false },
  delayUntilRecursion: { type: 'boolOrInt',  required: false }, // 可为 bool 或层级数字
  probability:         { type: 'int',        required: false, range: [0, 100] },
  useProbability:      { type: 'bool',       required: false },
  depth:               { type: 'int',        required: false },
  group:               { type: 'string',     required: false },
  groupOverride:       { type: 'bool',       required: false },
  groupWeight:         { type: 'int',        required: false },
  scanDepth:           { type: 'intOrNull',  required: false },
  caseSensitive:       { type: 'boolOrNull', required: false },
  matchWholeWords:     { type: 'boolOrNull', required: false },
  useGroupScoring:     { type: 'boolOrNull', required: false },
  automationId:        { type: 'string',     required: false },
  role:                { type: 'intOrNull',  required: false, enum: ROLE_ENUM },
  sticky:              { type: 'int',         required: false },
  cooldown:            { type: 'int',         required: false },
  delay:               { type: 'int',         required: false },
  displayIndex:        { type: 'int',         required: false },
};

// ---------- 类型判定工具 ----------

const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const isBool = (v) => typeof v === 'boolean';
const isStr = (v) => typeof v === 'string';
const isArr = (v) => Array.isArray(v);

function typeMatches(spec, v) {
  switch (spec.type) {
    case 'int':        return isInt(v);
    case 'bool':       return isBool(v);
    case 'string':     return isStr(v);
    case 'array':      return isArr(v);
    case 'intOrNull':  return v === null || isInt(v);
    case 'boolOrNull': return v === null || isBool(v);
    case 'boolOrInt':  return isBool(v) || isInt(v);
    default:           return false;
  }
}

// ---------- 单文件校验 ----------

function validateFile(filePath) {
  const errors = [];
  const warnings = [];
  const infos = [];

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    errors.push(`无法读取文件：${e.message}`);
    return { errors, warnings, infos };
  }

  // 1. BOM 检查（ST 通常能容忍，但提示）
  if (raw.charCodeAt(0) === 0xfeff) {
    warnings.push('文件以 UTF-8 BOM 开头。多数情况可导入，但建议保存为无 BOM 的 UTF-8。');
    raw = raw.slice(1);
  }

  // 2. JSON 合法性
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    errors.push(`JSON 解析失败（无法导入）：${e.message}`);
    return { errors, warnings, infos };
  }

  // 3. 顶层结构
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    errors.push('顶层必须是一个对象 { "entries": {...} }。');
    return { errors, warnings, infos };
  }
  if (!('entries' in data)) {
    errors.push('缺少顶层 "entries" 字段。独立世界书文件必须是 { "entries": {...} } 结构。');
    return { errors, warnings, infos };
  }
  const entries = data.entries;
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
    errors.push('"entries" 必须是对象（键为字符串索引 "0" "1" ...），不能是数组。数组结构属于卡内 character_book，不能直接作为独立世界书导入。');
    return { errors, warnings, infos };
  }

  const entryKeys = Object.keys(entries);
  if (entryKeys.length === 0) {
    warnings.push('entries 为空，没有任何条目。文件可导入但没有内容。');
  }
  infos.push(`条目数：${entryKeys.length}`);

  // 4. 逐条目校验
  const seenUids = new Map(); // uid -> index key
  const unknownFieldsGlobal = new Set();

  for (const idxKey of entryKeys) {
    const entry = entries[idxKey];
    const label = `条目[${idxKey}]`;

    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      errors.push(`${label} 不是对象。`);
      continue;
    }

    // 4a. 必填字段 + 类型 + 枚举 + 范围
    for (const [fname, spec] of Object.entries(ENTRY_FIELD_SPEC)) {
      const has = fname in entry;
      if (!has) {
        if (spec.required) {
          // uid/content/key 缺失属于严重问题
          errors.push(`${label} 缺少必填字段 "${fname}"。`);
        }
        continue;
      }
      const v = entry[fname];
      if (!typeMatches(spec, v)) {
        errors.push(`${label} 字段 "${fname}" 类型错误：期望 ${spec.type}，实际 ${describeType(v)}。`);
        continue;
      }
      if (spec.enum && isInt(v) && !(v in spec.enum)) {
        errors.push(`${label} 字段 "${fname}"=${v} 不在合法枚举内（合法值：${Object.keys(spec.enum).join('/')}）。`);
      }
      if (spec.range && isInt(v) && (v < spec.range[0] || v > spec.range[1])) {
        errors.push(`${label} 字段 "${fname}"=${v} 超出范围 [${spec.range[0]}, ${spec.range[1]}]。`);
      }
    }

    // 4b. uid 一致性 / 唯一性
    if (isInt(entry.uid)) {
      // index 与 uid 对齐（ST 内部按 index 键管理，不对齐通常仍能导入但易乱）
      if (String(entry.uid) !== idxKey) {
        warnings.push(`${label} 的 uid(${entry.uid}) 与索引键("${idxKey}")不一致。ST 通常仍可导入，但建议对齐避免编辑器错乱。`);
      }
      if (seenUids.has(entry.uid)) {
        errors.push(`uid 重复：${entry.uid} 同时出现在条目[${seenUids.get(entry.uid)}]和[${idxKey}]。uid 必须唯一。`);
      } else {
        seenUids.set(entry.uid, idxKey);
      }
    }

    // 4c. key 数组元素类型
    if (isArr(entry.key)) {
      entry.key.forEach((k, i) => {
        if (!isStr(k)) errors.push(`${label} key[${i}] 不是字符串。`);
      });
    }
    if (isArr(entry.keysecondary)) {
      entry.keysecondary.forEach((k, i) => {
        if (!isStr(k)) errors.push(`${label} keysecondary[${i}] 不是字符串。`);
      });
    }

    // 4d. 语义级警告（不阻止导入，但大概率不是你想要的行为）
    const isConstant = entry.constant === true;
    const keyEmpty = !isArr(entry.key) || entry.key.length === 0;
    const vectorized = entry.vectorized === true;
    const isArchivedStubOrSvg =
      entry.disable === true &&
      (/\[已迁出|迁移存根|迁出存根|⚠SVG资产/.test(entry.comment || '') ||
        /\[条目已迁出\]/.test(entry.content || ''));
    if (!isConstant && keyEmpty && !vectorized && !isArchivedStubOrSvg) {
      warnings.push(`${label}（"${shortComment(entry)}"）非常驻(constant=false)且无关键词(key为空)、非向量化 → 永远不会被激活。请确认是否遗漏关键词或应设为常驻。`);
    }
    if ((entry.content === undefined || entry.content === '') && !isConstant) {
      warnings.push(`${label}（"${shortComment(entry)}"）content 为空。`);
    }
    // @Depth 位置需要 depth；Outlet 位置需要 outlet 名（本脚本仅提示）
    if (entry.position === 4 && !isInt(entry.depth)) {
      warnings.push(`${label} position=4(@Depth) 但未设置有效 depth，将回退默认值 4。`);
    }
    if (entry.position === 7) {
      infos.push(`${label} 使用 Outlet(7) 位置，需在预设/格式化中用 {{outlet::名称}} 手动调用，否则内容不会出现。`);
    }
    // selective 但没有次级关键词
    if (entry.selective === true && (!isArr(entry.keysecondary) || entry.keysecondary.length === 0)) {
      infos.push(`${label} selective=true 但 keysecondary 为空 → selectiveLogic 不生效（仅按主键激活）。`);
    }
    // 全词匹配对中文的破坏性（仅当明显含中文且未关闭时提示）
    if (isArr(entry.key) && entry.key.some(hasCJK) && entry.matchWholeWords === true) {
      warnings.push(`${label} 含中文关键词且 matchWholeWords=true → 中文可能匹配失败，建议设为 false 或 null（继承全局关闭）。`);
    }

    // 4e. 未知字段（不影响导入，仅记录，帮助发现拼写错误）
    for (const fname of Object.keys(entry)) {
      if (!(fname in ENTRY_FIELD_SPEC)) unknownFieldsGlobal.add(fname);
    }
  }

  if (unknownFieldsGlobal.size > 0) {
    warnings.push(`发现未在标准字段表中的字段（可能是拼写错误或新版本字段，ST 一般忽略）：${[...unknownFieldsGlobal].join(', ')}`);
  }

  // ---------- <数据> 块层（S1 离线门扩展；上方外壳校验保持不动） ----------
  const dataBlocks = [];
  const pacing = { count: 0 }; // 分层科研工期规则违例计数（红+warn 合计，供计数摘要）
  const techBook = isTechBook(filePath);
  for (const idxKey of entryKeys) {
    const entry = entries[idxKey];
    if (!isRecord(entry)) continue;
    const ex = extractDataBlocks(filePath, idxKey, entry);
    if (ex.blocks.length === 0) {
      if (ex.openCount > 0) {
        warnings.push(`条目[${idxKey}]（"${ex.comment}"）有 ${ex.openCount} 个 <数据> 开标签但没有配对的 </数据> 闭标签，运行时无法提取任何数据块。`);
      }
      continue;
    }
    if (ex.openCount > ex.blocks.length) {
      warnings.push(`条目[${idxKey}]（"${ex.comment}"）疑似存在未闭合的 <数据> 标签（开标签 ${ex.openCount} 个 > 配对块 ${ex.blocks.length} 个），请检查标签配对。`);
    }
    // 规则 1：一条多块（运行时只读首块，其余静默丢失）
    if (ex.blocks.length > 1) {
      const msg = `条目[${idxKey}]（"${ex.comment}"）含 ${ex.blocks.length} 个 <数据> 块——运行时解析器只读首块，其余 ${ex.blocks.length - 1} 块静默丢失（worldbookCatalogParser.ts:18）。`;
      if (techBook) errors.push(`${msg}《通用·科技》一条目一块，判红。`);
      else warnings.push(`${msg}（存量已知债，warn 不判红）`);
    }
    ex.blocks.forEach((raw, i) => {
      const loc = `条目[${idxKey}]（"${ex.comment}"）<数据>块#${i + 1}/${ex.blocks.length}`;
      let data = null;
      let parseFailed = false;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        parseFailed = true;
        // 规则 2：块内 JSON 解析失败 → 红
        errors.push(`${loc} 块内 JSON 解析失败：${e.message}`);
      }
      const rec = { fileName: ex.fileName, techBook, entryKey: idxKey, comment: ex.comment, loc, data, refs: [] };
      if (!parseFailed) {
        if (!isRecord(data)) {
          errors.push(`${loc} 数据块必须是 JSON 对象（实际：${describeType(data)}）。`);
          rec.data = null;
        } else {
          rec.refs = validateDataBlockContent(rec, errors, warnings, pacing);
        }
      }
      dataBlocks.push(rec);
    });
  }

  return { errors, warnings, infos, dataBlocks, pacingViolations: pacing.count };
}

// ---------- 辅助 ----------

function describeType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
function shortComment(entry) {
  const c = entry.comment || entry.content || '';
  return String(c).replace(/\s+/g, ' ').slice(0, 20);
}
function hasCJK(s) {
  return typeof s === 'string' && /[\u4e00-\u9fff\u3040-\u30ff]/.test(s);
}

// ---------- <数据> 块校验层（S1 离线门扩展） ----------
//
// 依据：
//   artifacts/tech-worldbook-stage0/04-parser-runtime-contract.md（运行时只读首块、
//     name 缺省回退 id、type 四分支等解析器事实）
//   artifacts/tech-worldbook-stage0/06-tech-worldbook-v1-spec-draft.md（V1 schema / V2 点号 ID 规则）
//   mvu指挥系统/src/红警指挥系统/prerequisites.ts（条件内核：原子白名单在此复刻，
//     纯 .mjs 不 import TS；运行时白名单变更时需同步此处）
//
// 分级约定：红（error）= 硬错误，退出码非零；黄（warn）= 存量已知债（多块、悬空引用），
// 报告不阻塞。《通用·科技_世界书.json》适用更严口径：多块、书内悬空引用直接判红。

const DATA_BLOCK_RE = /<数据>([\s\S]*?)<\/数据>/g;
const DATA_BLOCK_OPEN_RE = /<数据\s*>/g;
const DATA_TYPES = new Set(['research', 'building', 'production', 'retrofit', 'project', 'protocol', 'maiden']);
// —— 以下为 prerequisites.ts 条件内核的复刻（validatePrerequisiteCondition）——
const MAX_PREREQ_DEPTH = 8; // prerequisites.ts:1 MAX_PREREQUISITE_DEPTH
const REQ_ATOMS = new Set(['research', 'building', 'unit_present']);
const REQ_OPS = new Set(['all', 'any']);
const BUILDING_SCOPES = new Set(['current', 'global']);
const BUILDING_STATES = new Set(['existing', 'completed', 'running']);
const UNIT_SCOPE = 'global';
// 算力/工期属条目顶层 workload 的需求侧声明（06 §5.5），永远不是前置条件
const REQ_FORBIDDEN_KEYS = new Set(['workload', 'tflops', 'tops', 'days', 'min_days', '算力']);
const RESEARCH_STATUS_ENUM = new Set(['active', 'deprecated', 'planned']);
const RESEARCH_SCOPE_ENUM = new Set(['common', 'faction']);
const WORKLOAD_NUM_FIELDS = ['days', 'min_days', 'tflops', 'tops'];

function isTechBook(filePath) {
  return path.basename(filePath).includes('通用·科技');
}
function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// 从单条目 content 提取全部 <数据> 块（运行时只读首块；离线门全量提取用于对账）
function extractDataBlocks(filePath, idxKey, entry) {
  const content = typeof entry.content === 'string' ? entry.content : '';
  const blocks = [];
  DATA_BLOCK_RE.lastIndex = 0;
  let m;
  while ((m = DATA_BLOCK_RE.exec(content))) blocks.push(m[1]);
  DATA_BLOCK_OPEN_RE.lastIndex = 0;
  const openCount = (content.match(DATA_BLOCK_OPEN_RE) || []).length;
  return { fileName: path.basename(filePath), idxKey, comment: shortComment(entry), blocks, openCount };
}

// requirements 条件树校验：形状复刻 validatePrerequisiteCondition，同时收集 research/building 引用
function validateRequirementNode(node, pathStr, depth, errs, refs) {
  if (depth > MAX_PREREQ_DEPTH) {
    errs.push(`${pathStr}：条件嵌套超过 ${MAX_PREREQ_DEPTH} 层（MAX_PREREQUISITE_DEPTH）。`);
    return;
  }
  if (!isRecord(node)) {
    errs.push(`${pathStr}：条件必须是对象。`);
    return;
  }
  for (const k of Object.keys(node)) {
    if (REQ_FORBIDDEN_KEYS.has(k)) {
      errs.push(`${pathStr}：requirements 内禁止出现算力/工期字段 "${k}"——算力需求写在条目顶层 workload，永远不是前置条件。`);
    }
  }
  const hasOp = Object.hasOwn(node, 'op');
  const hasKind = Object.hasOwn(node, 'kind');
  if (hasOp === hasKind) {
    errs.push(`${pathStr}：条件必须且只能包含 op 或 kind 判别字段之一。`);
    return;
  }
  if (hasOp) {
    if (!REQ_OPS.has(node.op)) {
      errs.push(`${pathStr}.op：未知条件组 ${JSON.stringify(node.op)}（合法值：all/any）。`);
      return;
    }
    if (!Array.isArray(node.conditions)) {
      errs.push(`${pathStr}.conditions：必须是数组。`);
      return;
    }
    if (node.op === 'any' && node.conditions.length === 0) {
      errs.push(`${pathStr}.conditions：any 条件组不能为空。`);
    }
    node.conditions.forEach((c, i) => validateRequirementNode(c, `${pathStr}.conditions[${i}]`, depth + 1, errs, refs));
    return;
  }
  if (!REQ_ATOMS.has(String(node.kind))) {
    errs.push(`${pathStr}.kind：未知条件原子 ${JSON.stringify(node.kind)}（白名单：research/building/unit_present）。`);
    return;
  }
  if (typeof node.name !== 'string' || !node.name.trim()) {
    errs.push(`${pathStr}.name：条件名称不能为空。`);
    return;
  }
  if (node.name !== node.name.trim()) {
    errs.push(`${pathStr}.name：条件名称不能含首尾空白。`);
  }
  if (node.kind === 'building') {
    if (!BUILDING_SCOPES.has(node.scope)) errs.push(`${pathStr}.scope：建筑 scope 必须是 current 或 global。`);
    if (!BUILDING_STATES.has(node.state)) errs.push(`${pathStr}.state：建筑 state 必须是 existing/completed/running。`);
    refs.push({ kind: 'building', name: node.name, via: 'requirements' });
    return;
  }
  if (node.kind === 'unit_present') {
    if (node.scope !== UNIT_SCOPE) errs.push(`${pathStr}.scope：单位条件只支持 scope:"global"。`);
    if (node.min !== undefined && (!Number.isInteger(node.min) || node.min < 1)) {
      errs.push(`${pathStr}.min：单位最小数量必须是 ≥1 的整数。`);
    }
    return;
  }
  refs.push({ kind: 'research', name: node.name, via: 'requirements' });
}

// 单个已解析数据块的内容校验（规则 3/4/6/8/9 + legacy 前置形状 + 分层科研工期规则）；返回收集到的引用列表
function validateDataBlockContent(rec, errors, warnings, pacing) {
  const d = rec.data;
  const L = rec.loc;
  const refs = [];

  // 规则 3：type 白名单
  if (typeof d.type !== 'string' || !DATA_TYPES.has(d.type)) {
    errors.push(`${L} type 缺失或不在白名单（research/building/production/retrofit/project/protocol/maiden）：${JSON.stringify(d.type)}。`);
  }

  // 规则 9：schema_version=2 条目的前置评估真源必须是 requirements/prereqs。
  // prereq 单数字符串仅允许作为 UI 显示缓存（前端 WorldbookResearchDataSchema 显式接受且 useDetail 详情页消费）；
  // 判错仅限「只有 prereq 显示串而缺评估真源」的偸懒写法（2026-10-13 与前端契约对齐修订）。
  if (d.schema_version === 2 && 'prereq' in d) {
    const hasEvalSource = d.requirements != null || (Array.isArray(d.prereqs) && d.prereqs.length > 0);
    const isNoPrereqMark = typeof d.prereq === 'string' && d.prereq.startsWith('无（');
    if (!hasEvalSource && !isNoPrereqMark) {
      errors.push(`${L} schema_version=2 条目仅写 prereq 显示串而缺 requirements/prereqs 评估真源——前置必须以 requirements（或 legacy prereqs 数组）为准，prereq 仅作 UI 缓存。`);
    }
  }

  // 规则 4：点号 ID 的 research 块按 V2 规则校验
  if (d.type === 'research' && typeof d.id === 'string' && d.id.includes('.')) {
    if (typeof d.name !== 'string' || !d.name.trim()) {
      errors.push(`${L} 点号 ID（${d.id}）的 research 块必须写 name——缺省时运行时拿 id 当显示名，会污染 tech.done/面板。`);
    } else if (d.name === d.id) {
      errors.push(`${L} name 不得与 id 相同（${d.id}）。`);
    }
    if (d.schema_version !== 2 && !(d.schema_version === 1 && d.line === '航天工业')) {
      errors.push(`${L} 点号 ID 条目必须 schema_version=2（当前：${JSON.stringify(d.schema_version)}）。`);
    }
    // 2026-10 驾驶员裁定：T3（特色高阶/巨构线）对点号 V2 块开放；月壤氧金属联产工学为首例。
    if (!Number.isInteger(d.tier) || d.tier < 1 || d.tier > 3) {
      errors.push(`${L} tier 必填且只能为 1|2|3（当前：${JSON.stringify(d.tier)}）。`);
    }
    if (typeof d.line !== 'string' || !d.line.trim()) {
      errors.push(`${L} line 必填且非空。`);
    }
    if (d.schema_version === 2 && (typeof d.scope !== 'string' || !RESEARCH_SCOPE_ENUM.has(d.scope))) {
      errors.push(`${L} scope 必填且只能为 common|faction（当前：${JSON.stringify(d.scope)}）。`);
    }
    if ('status' in d) {
      if (!RESEARCH_STATUS_ENUM.has(d.status)) {
        errors.push(`${L} status 只能为 active|deprecated|planned（当前：${JSON.stringify(d.status)}）。`);
      }
      if (d.status === 'deprecated' && (typeof d.replaced_by !== 'string' || !d.replaced_by.trim())) {
        errors.push(`${L} status=deprecated 必须配 replaced_by 指明继任条目。`);
      }
    }
    if ('aliases' in d && (!Array.isArray(d.aliases) || d.aliases.some((a) => typeof a !== 'string' || !a.trim()))) {
      errors.push(`${L} aliases 必须是非空字符串数组。`);
    }
  }

  // 规则 6：requirements 条件树（原子白名单 / 形状 / 深度）。
  // project 块的 requirements 是 V2 扁平四键声明位（research/building/credits/nanites，设计案 §3.1），
  // 不是 retrofit/building 的条件树口径——由规则 11 validateProjectBlock 按扁平口径校验，此处跳过防误判。
  if ('requirements' in d && d.type !== 'project') {
    validateRequirementNode(d.requirements, `${L} requirements`, 0, errors, refs);
  }

  // 规则 7 前半：legacy 前置字段形状 + 引用收集（跨书解析在全局层做）
  for (const [field, kind] of [['prereqs', 'research'], ['need_buildings', 'building']]) {
    if (!(field in d)) continue;
    if (!Array.isArray(d[field])) {
      errors.push(`${L} 字段 "${field}" 必须是字符串数组。`);
      continue;
    }
    d[field].forEach((n, i) => {
      if (typeof n !== 'string' || !n.trim()) errors.push(`${L} ${field}[${i}] 必须是非空字符串。`);
      else refs.push({ kind, name: n, via: field });
    });
  }

  // 规则 8：workload 形状
  if ('workload' in d) {
    if (!isRecord(d.workload)) {
      errors.push(`${L} workload 必须是对象。`);
    } else {
      for (const f of WORKLOAD_NUM_FIELDS) {
        if (f in d.workload && (typeof d.workload[f] !== 'number' || !Number.isFinite(d.workload[f]) || d.workload[f] < 0)) {
          errors.push(`${L} workload.${f} 必须是非负数（当前：${JSON.stringify(d.workload[f])}）。`);
        }
      }
    }
  }

  // 规则 8b：production 数量上限 max_count 校验（HERO-UNIT-01）
  if (d.type === 'production' && 'max_count' in d && d.max_count !== undefined) {
    if (!Number.isInteger(d.max_count) || d.max_count < 1) {
      errors.push(`${L} production 的 max_count 必须是 ≥1 的正整数（当前：${JSON.stringify(d.max_count)}）。`);
    }
  }

  // 规则 8c：建筑升级扩建与单位现代化字段校验（FD-22）
  if (d.type === 'building') {
    if ('standalone' in d && d.standalone !== undefined && typeof d.standalone !== 'boolean') {
      errors.push(`${L} building 的 standalone 必须是 boolean（当前：${JSON.stringify(d.standalone)}）。`);
    }
    if ('upgrade_mode' in d && d.upgrade_mode !== undefined && d.upgrade_mode !== 'replace' && d.upgrade_mode !== 'addon') {
      errors.push(`${L} building 的 upgrade_mode 只能为 "replace" | "addon"（当前：${JSON.stringify(d.upgrade_mode)}）。`);
    }
    if ('host_building' in d && d.host_building !== undefined) {
      const ok = (typeof d.host_building === 'string' && d.host_building.trim().length > 0) ||
        (Array.isArray(d.host_building) && d.host_building.length > 0 && d.host_building.every(s => typeof s === 'string' && s.trim().length > 0));
      if (!ok) {
        errors.push(`${L} building 的 host_building 必须是非空字符串或非空字符串数组（当前：${JSON.stringify(d.host_building)}）。`);
      }
    }
    if ('upgraded_name' in d && d.upgraded_name !== undefined && (typeof d.upgraded_name !== 'string' || !d.upgraded_name.trim())) {
      errors.push(`${L} building 的 upgraded_name 必须是非空字符串（当前：${JSON.stringify(d.upgraded_name)}）。`);
    }
  }
  if (d.type === 'retrofit') {
    if ('target_unit' in d && d.target_unit !== undefined) {
      const ok = (typeof d.target_unit === 'string' && d.target_unit.trim().length > 0) ||
        (Array.isArray(d.target_unit) && d.target_unit.length > 0 && d.target_unit.every(s => typeof s === 'string' && s.trim().length > 0));
      if (!ok) {
        errors.push(`${L} retrofit 的 target_unit 必须是非空字符串或非空字符串数组（当前：${JSON.stringify(d.target_unit)}）。`);
      }
    }
    if ('host_building' in d && d.host_building !== undefined) {
      const ok = (typeof d.host_building === 'string' && d.host_building.trim().length > 0) ||
        (Array.isArray(d.host_building) && d.host_building.length > 0 && d.host_building.every(s => typeof s === 'string' && s.trim().length > 0));
      if (!ok) {
        errors.push(`${L} retrofit 的 host_building 必须是非空字符串或非空字符串数组（当前：${JSON.stringify(d.host_building)}）。`);
      }
    }
    if ('upgraded_name' in d && d.upgraded_name !== undefined) {
      const ok = (typeof d.upgraded_name === 'string' && d.upgraded_name.trim().length > 0) ||
        (isRecord(d.upgraded_name) && Object.keys(d.upgraded_name).length > 0 && Object.values(d.upgraded_name).every(v => typeof v === 'string' && v.trim().length > 0));
      if (!ok) {
        errors.push(`${L} retrofit 的 upgraded_name 必须是非空字符串或非空字符串映射对象（当前：${JSON.stringify(d.upgraded_name)}）。`);
      }
    }
  }

  // 规则 10：分层科研工期（仅 type=research；详见 validateResearchPacing）
  validateResearchPacing(rec, errors, warnings, pacing);

  // 规则 11：仓段化 V2 project 块（V2-04；详见 validateProjectBlock）
  validateProjectBlock(rec, errors, refs);

  // 规则 12：机娘能力档案 maiden 块（MAIDEN-DATA-01；详见 validateMaidenBlock）
  validateMaidenBlock(rec, errors);

  return refs;
}

// 宽松解析 eta 标称工期为日数：提取字符串中全部数字取大值（「约9日」→9、「约4-5日」→5）；
// 纯数字直接采用；解析不出返回 null（不判）。
function parseEtaDays(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const nums = v.match(/\d+(?:\.\d+)?/g);
  if (!nums) return null;
  return Math.max(...nums.map(Number));
}

// 规则 10：分层科研工期校验（09-research-pacing-convention-draft.md §2/§3，已冻结）
//   P1 tier=2 必须声明 workload.min_days 且 ∈ [5,10]
//   P2 tier=3 必须声明 workload.min_days 且 ∈ [20,60]（V1 阶段 T3 禁入，本条为未来批次预备）
//   P3 tier=1 声明了 min_days 则必须 ∈ [1,2]；未声明不判
//   P4 workload.days / eta（宽松解析）不得小于 min_days；eta 解析不出不判
//   P5 tflops/tops > 0 但缺 min_days → warn（提示加速无地板保护）
// 分级：凡属《通用·科技》一律红；其余书 v2（schema_version>=2）判红、v1 同情形 warn。
// 例外：P5 按冻结口径恒 warn（v2）、v1 不判，不随《通用·科技》升级为红。
function validateResearchPacing(rec, errors, warnings, pacing) {
  const d = rec.data;
  const L = rec.loc;
  if (d.type !== 'research') return;
  const isV2 = typeof d.schema_version === 'number' && d.schema_version >= 2;
  const w = isRecord(d.workload) ? d.workload : null;
  const minDays = w && typeof w.min_days === 'number' && Number.isFinite(w.min_days) ? w.min_days : null;

  const report = (msg) => {
    pacing.count++;
    if (rec.techBook || isV2) errors.push(msg);
    else warnings.push(`${msg}（存量 v1 块，warn 豁免不判红）`);
  };

  // P1/P2/P3：分层 min_days 地板（航天工业线 T1 基础试车物理周期允许 [1,4]、T3 登月生保周期允许 [14,60]）
  const isAeroLine = d.line === '航天工业';
  if (d.tier === 2 || d.tier === 3) {
    const [lo, hi] = d.tier === 2 ? [5, 10] : isAeroLine ? [14, 60] : [20, 60];
    if (minDays === null) {
      report(`${L} tier=${d.tier} 的 research 必须声明 workload.min_days 且值 ∈ [${lo},${hi}]（当前未声明）——min_days 是理论验证与工程试制的物理周期，算力不能消灭「必须熬过去的时间」。`);
    } else if (minDays < lo || minDays > hi) {
      report(`${L} tier=${d.tier} 的 workload.min_days=${minDays} 越界，必须 ∈ [${lo},${hi}]。`);
    }
  } else if (d.tier === 1) {
    const t1Hi = isAeroLine ? 4 : 2;
    if (minDays !== null && (minDays < 1 || minDays > t1Hi)) {
      report(`${L} tier=1 的 workload.min_days=${minDays} 越界——T1 若声明 min_days 必须 ∈ [1,${t1Hi}]（未声明不判）。`);
    }
  }

  // P4：标称工期不得短于物理地板
  if (w && minDays !== null) {
    if (typeof w.days === 'number' && Number.isFinite(w.days) && w.days < minDays) {
      report(`${L} workload.days=${w.days} 小于 workload.min_days=${minDays}——标称工期不得短于物理地板。`);
    }
    const etaDays = parseEtaDays(d.eta);
    if (etaDays !== null && etaDays < minDays) {
      report(`${L} eta=${JSON.stringify(d.eta)}（解析为 ${etaDays} 日）小于 workload.min_days=${minDays}——标称工期不得短于物理地板。`);
    }
  }

  // P5：算力需求缺地板保护 → 恒 warn（v2）；v1 不判
  if (isV2 && w && minDays === null) {
    const tflops = typeof w.tflops === 'number' ? w.tflops : 0;
    const tops = typeof w.tops === 'number' ? w.tops : 0;
    if (tflops > 0 || tops > 0) {
      pacing.count++;
      warnings.push(`${L} workload 声明了算力需求（tflops=${tflops}, tops=${tops}）但缺 min_days——加速无地板保护，建议补 workload.min_days。`);
    }
  }
}

// 规则 11：仓段化 V2 project 块校验（V2-04 · docs/project/plans/仓段化V2设计案-草案.md §3.1；
// 形状对齐运行时 worldbookCatalogParser.WorldbookProjectDataSchema 与 projectEngine.ProjectV2Def）。
//   P-V1 schema_version 必须严格 ===2（版本轴判别，设计案 §2；≠2/缺席判红——V2 是唯一 project 版本）
//   P-V2 点号 id 块必须显式 name 且 ≠id（与 parser 运行时护栏同形；非点号 id 缺 name 走运行时 name=id 兑底，不判）
//   P-V3 grade 声明则 ∈{小改,中改,大改,巨构}（D-C2）；scope 声明则 ∈{base,theater}（D-C3）
//   P-V4 requirements 扁平四键：research/building 非空字符串（入悬空引用池，由规则 7a 跨书判）；
//        credits/nanites 非负数；未知键判红（与 retrofit 条件树 requirements 异口径，规则 6 已放行）
//   P-V5 modules 必填非空数组；模块 id 非空且工程内唯一；name 声明则非空；cost/resources.nanites 非负
//   P-V6 模块 workload：days 与 min_days 均必填（模块级无缺省口径，严于条目顶层 workload 全可选）；
//        min_days≥1（D12 物理地板起点，对齐 T1 下限）；days≥min_days（标称不得短于物理地板，D12 语义；
//        project 无 tier 分层，不套研究侧 [5,10]/[20,60] 分层表）；tflops/tops 声明则非负
//   P-V7 prereqs 字符串数组；引用必须落在本工程 modules[].id 内（悬空判红）；Kahn 拓扑检测环（判红，
//        与 projectEngine.validateModuleTopology 判定语义对齐，脚本侧独立实现——纯 .mjs 不 import TS）
function validateProjectBlock(rec, errors, refs) {
  const d = rec.data;
  if (d.type !== 'project') return;
  const L = rec.loc;
  const PROJECT_GRADES = new Set(['小改', '中改', '大改', '巨构']);
  const PROJECT_SCOPES = new Set(['base', 'theater']);

  // P-V1：版本轴
  if (d.schema_version !== 2) {
    errors.push(`${L} project 块必须 schema_version=2（当前：${JSON.stringify(d.schema_version)}）——仓段化 V2 是唯一 project 版本，无存量迁移负担。`);
  }

  // P-V2：id/name 护栏（与 parser 点号 ID 护栏同形：非点号 id 缺 name 走运行时 name=id 兑底，离线不另判）
  if (typeof d.id !== 'string' || !d.id.trim()) {
    errors.push(`${L} project 块必须声明非空 id。`);
  } else if (d.id.includes('.')) {
    if (typeof d.name !== 'string' || !d.name.trim()) {
      errors.push(`${L} 点号 ID（${d.id}）的 project 块必须写 name——缺省时运行时 ref=def.name 退化为 id，污染工程账本与投影命名合同。`);
    } else if (d.name === d.id) {
      errors.push(`${L} name 不得与 id 相同（${d.id}）。`);
    }
  }

  // P-V3：grade/scope 枚举
  if ('grade' in d && d.grade !== undefined && !PROJECT_GRADES.has(d.grade)) {
    errors.push(`${L} grade 只能为 小改|中改|大改|巨构（当前：${JSON.stringify(d.grade)}）——D-C2 V2 档。`);
  }
  if ('scope' in d && d.scope !== undefined && !PROJECT_SCOPES.has(d.scope)) {
    errors.push(`${L} scope 只能为 base|theater（当前：${JSON.stringify(d.scope)}）——D-C3 属地口径。`);
  }

  // P-V4：requirements 扁平四键
  if ('requirements' in d && d.requirements !== undefined) {
    if (!isRecord(d.requirements)) {
      errors.push(`${L} requirements 必须是对象（扁平四键：research/building/credits/nanites）。`);
    } else {
      const PROJECT_REQ_KEYS = new Set(['research', 'building', 'credits', 'nanites']);
      for (const k of Object.keys(d.requirements)) {
        if (!PROJECT_REQ_KEYS.has(k)) {
          errors.push(`${L} requirements.${k} 不是 project 块合法键（合法键：research/building/credits/nanites——V2 扁平声明位，非 retrofit 条件树）。`);
        }
      }
      const rq = d.requirements;
      if (rq.research !== undefined) {
        if (typeof rq.research !== 'string' || !rq.research.trim()) {
          errors.push(`${L} requirements.research 必须是非空字符串。`);
        } else {
          refs.push({ kind: 'research', name: rq.research, via: 'requirements.research' });
        }
      }
      if (rq.building !== undefined) {
        if (typeof rq.building !== 'string' || !rq.building.trim()) {
          errors.push(`${L} requirements.building 必须是非空字符串。`);
        } else {
          refs.push({ kind: 'building', name: rq.building, via: 'requirements.building' });
        }
      }
      for (const k of ['credits', 'nanites']) {
        if (rq[k] !== undefined && (typeof rq[k] !== 'number' || !Number.isFinite(rq[k]) || rq[k] < 0)) {
          errors.push(`${L} requirements.${k} 必须是非负数（当前：${JSON.stringify(rq[k])}）。`);
        }
      }
    }
  }

  // P-V5/P-V6/P-V7：modules 拓扑（形状/引用/环一次遍历 + Kahn 收尾）
  if (!Array.isArray(d.modules)) {
    errors.push(`${L} project 块必须声明 modules 非空数组（当前：${describeType(d.modules)}）——仓段化 V2 无空拓扑工程。`);
    return;
  }
  if (d.modules.length === 0) {
    errors.push(`${L} modules 不能为空数组——工程至少含一个根模块（prereqs 空集，设计案 §3.1）。`);
    return;
  }
  const modIds = new Set();
  const edges = new Map(); // id -> Set(前置 id)；Kahn 用
  d.modules.forEach((m, i) => {
    const ml = `${L} modules[${i}]`;
    if (!isRecord(m)) {
      errors.push(`${ml} 必须是对象。`);
      return;
    }
    if (typeof m.id !== 'string' || !m.id.trim()) {
      errors.push(`${ml}.id 必须是非空字符串。`);
    } else {
      if (m.id !== m.id.trim()) errors.push(`${ml}.id 不得含首尾空白。`);
      if (modIds.has(m.id)) errors.push(`${ml}.id "${m.id}" 与本工程其他模块重复——模块 id 工程内唯一。`);
      modIds.add(m.id);
      edges.set(m.id, new Set());
    }
    if (m.name !== undefined && m.name !== '' && (typeof m.name !== 'string' || !m.name.trim())) {
      errors.push(`${ml}.name 必须是非空字符串。`);
    }
    if (m.cost !== undefined && (typeof m.cost !== 'number' || !Number.isFinite(m.cost) || m.cost < 0)) {
      errors.push(`${ml}.cost 必须是非负数（当前：${JSON.stringify(m.cost)}）。`);
    }
    if (m.resources !== undefined) {
      if (!isRecord(m.resources)) errors.push(`${ml}.resources 必须是对象。`);
      else if (m.resources.nanites !== undefined &&
        (typeof m.resources.nanites !== 'number' || !Number.isFinite(m.resources.nanites) || m.resources.nanites < 0)) {
        errors.push(`${ml}.resources.nanites 必须是非负数（D8b 纳米开工门门槛口径，当前：${JSON.stringify(m.resources.nanites)}）。`);
      }
    }
    // P-V6：模块 workload（days/min_days 均必填）
    if (m.workload !== undefined) {
      if (!isRecord(m.workload)) {
        errors.push(`${ml}.workload 必须是对象。`);
      } else {
        const w = m.workload;
        for (const f of ['days', 'min_days']) {
          if (!(f in w)) errors.push(`${ml}.workload.${f} 必填（模块工作量无缺省口径，区别于条目顶层 workload 全可选）。`);
          else if (typeof w[f] !== 'number' || !Number.isFinite(w[f]) || w[f] <= 0) {
            errors.push(`${ml}.workload.${f} 必须是正数（当前：${JSON.stringify(w[f])}）。`);
          }
        }
        if (typeof w.min_days === 'number' && Number.isFinite(w.min_days) && w.min_days < 1) {
          errors.push(`${ml}.workload.min_days=${w.min_days} 越界——物理地板起点为 1 日（D12，对齐 T1 下限）。`);
        }
        if (typeof w.days === 'number' && Number.isFinite(w.days) &&
          typeof w.min_days === 'number' && Number.isFinite(w.min_days) && w.days < w.min_days) {
          errors.push(`${ml}.workload.days=${w.days} 小于 min_days=${w.min_days}——标称工期不得短于物理地板（D12）。`);
        }
        for (const f of ['tflops', 'tops']) {
          if (w[f] !== undefined && (typeof w[f] !== 'number' || !Number.isFinite(w[f]) || w[f] < 0)) {
            errors.push(`${ml}.workload.${f} 必须是非负数（当前：${JSON.stringify(w[f])}）。`);
          }
        }
      }
    }
    // P-V7 前半（第二遍循环）：prereqs 形状 + 引用存在性。
    // 引用检查必须在 modules[].id 集齐后做（单遍内增量判会误报后置模块悬空——fixtures 驱动验证踩坑）。
    // 形状/值域已在上方第一遍校验，此遍只处理 prereqs 本身。
  });

  d.modules.forEach((m, i) => {
    const ml = `${L} modules[${i}]`;
    if (!isRecord(m) || typeof m.id !== 'string' || !m.id.trim()) return;
    if (m.prereqs === undefined) return;
    if (!Array.isArray(m.prereqs)) {
      errors.push(`${ml}.prereqs 必须是字符串数组。`);
      return;
    }
    const pres = edges.get(m.id);
    m.prereqs.forEach((p, j) => {
      if (typeof p !== 'string' || !p.trim()) {
        errors.push(`${ml}.prereqs[${j}] 必须是非空字符串。`);
        return;
      }
      if (!modIds.has(p)) {
        errors.push(`${ml}.prereqs[${j}] "${p}" 悬空——不在本工程 modules[].id 内（现有：${[...modIds].join('、')}）。`);
        return;
      }
      if (pres) pres.add(p);
    });
  });

  // P-V7 后半：Kahn 拓扑剥离——剥不尽即成环
  if (edges.size > 0) {
    const indeg = new Map([...edges].map(([id, pres]) => [id, pres.size]));
    const queue = [...edges.keys()].filter((id) => indeg.get(id) === 0);
    let peeled = 0;
    while (queue.length > 0) {
      const cur = queue.shift();
      peeled++;
      for (const [id, pres] of edges) {
        if (pres.delete(cur)) {
          const left = pres.size;
          indeg.set(id, left);
          if (left === 0) queue.push(id);
        }
      }
    }
    if (peeled < edges.size) {
      const cyclic = [...edges.keys()].filter((id) => indeg.get(id) > 0);
      errors.push(`${L} 模块 prereqs 成环：${cyclic.join('、')} 拓扑排序无法剥离——DAG 是立项前提（projectEngine.validateModuleTopology 同语义）。`);
    }
  }
}

// 规则 12：机娘能力档案 maiden 块校验（MAIDEN-DATA-01）
const MAIDEN_FACTIONS = new Set(['盟军', '苏联', '尤里', '通用']);
const MAIDEN_INCUBATION_MODES = new Set(['iconic_fixed', 'blindbox_christen', 'rule_guideline']);

function validateMaidenBlock(rec, errors) {
  const d = rec.data;
  if (d.type !== 'maiden') return;
  const L = rec.loc;

  if (typeof d.id !== 'string' || !d.id.trim() || !d.id.startsWith('maiden.')) {
    errors.push(`${L} maiden 块必须声明以 "maiden." 开头的非空 id（当前：${JSON.stringify(d.id)}）。`);
  }
  if (typeof d.name !== 'string' || !d.name.trim()) {
    errors.push(`${L} maiden 块必须声明非空 name。`);
  } else if (d.name === d.id) {
    errors.push(`${L} maiden 块 name 不得与 id 相同（${d.id}）。`);
  }
  if (typeof d.model !== 'string' || !d.model.trim()) {
    errors.push(`${L} maiden 块必须声明非空 model（机体型号/定位）。`);
  }
  if (typeof d.faction !== 'string' || !MAIDEN_FACTIONS.has(d.faction)) {
    errors.push(`${L} maiden 块 faction 必须为 盟军|苏联|尤里|通用（当前：${JSON.stringify(d.faction)}）。`);
  }
  if (typeof d.incubation_mode !== 'string' || !MAIDEN_INCUBATION_MODES.has(d.incubation_mode)) {
    errors.push(`${L} maiden 块 incubation_mode 必须为 iconic_fixed|blindbox_christen|rule_guideline（当前：${JSON.stringify(d.incubation_mode)}）。`);
  }
  const isUnitMaiden = d.incubation_mode === 'iconic_fixed' || d.incubation_mode === 'blindbox_christen';
  if (!Array.isArray(d.special_skills) || (isUnitMaiden && d.special_skills.length === 0)) {
    errors.push(`${L} maiden 块必须声明非空数组 special_skills（特殊技能列表）。`);
  } else {
    d.special_skills.forEach((sk, i) => {
      if (!isRecord(sk)) {
        errors.push(`${L} special_skills[${i}] 必须是对象。`);
        return;
      }
      for (const k of ['name', 'kind', 'desc']) {
        if (typeof sk[k] !== 'string' || !sk[k].trim()) {
          errors.push(`${L} special_skills[${i}].${k} 必须是非空字符串。`);
        }
      }
    });
  }
  if (!Array.isArray(d.special_equipment) || (isUnitMaiden && d.special_equipment.length === 0)) {
    errors.push(`${L} maiden 块必须声明非空数组 special_equipment（特殊装备列表）。`);
  } else {
    d.special_equipment.forEach((eq, i) => {
      if (!isRecord(eq)) {
        errors.push(`${L} special_equipment[${i}] 必须是对象。`);
        return;
      }
      for (const k of ['name', 'slot', 'desc']) {
        if (typeof eq[k] !== 'string' || !eq[k].trim()) {
          errors.push(`${L} special_equipment[${i}].${k} 必须是非空字符串。`);
        }
      }
    });
  }
  if (isUnitMaiden) {
    if (typeof d.exposure_grade !== 'string' || !d.exposure_grade.trim()) {
      errors.push(`${L} 机娘单位 maiden 块必须声明非空 exposure_grade（暴露分档）。`);
    }
    if (typeof d.flaws !== 'string' || !d.flaws.trim()) {
      errors.push(`${L} 机娘单位 maiden 块必须声明非空 flaws（结构性短板）。`);
    }
  }
}

// 跨书 <数据> 块全局校验（规则 5 唯一性、规则 7 悬空引用与前置环）
function validateDataBlocksGlobal(allBlocks) {
  const errors = [];
  const warnings = [];
  const infos = [];
  const parsed = allBlocks.filter((b) => isRecord(b.data));

  // 多块条目统计（per-file 层已分级报告，这里只计数）
  const entryBlockCount = new Map();
  for (const b of allBlocks) {
    const k = `${b.fileName}|${b.entryKey}`;
    entryBlockCount.set(k, (entryBlockCount.get(k) || 0) + 1);
  }
  const multiBlockEntries = [...entryBlockCount.values()].filter((n) => n > 1).length;

  // 规则 5：跨全书唯一性
  const idMap = new Map();
  const nameMap = new Map();
  const aliasMap = new Map();
  const pushMap = (map, key, loc) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(loc);
  };
  for (const b of parsed) {
    const d = b.data;
    const loc = `${b.fileName} ${b.loc}`;
    if (typeof d.id === 'string' && d.id) pushMap(idMap, d.id, loc);
    if (typeof d.name === 'string' && d.name) pushMap(nameMap, d.name, loc);
    if (Array.isArray(d.aliases)) for (const a of d.aliases) if (typeof a === 'string' && a) pushMap(aliasMap, a, loc);
  }
  for (const [id, locs] of idMap) {
    if (locs.length > 1) errors.push(`id 重复："${id}" 出现在 ${locs.join('；')}。id 必须跨全书唯一。`);
  }
  for (const [name, locs] of nameMap) {
    if (locs.length > 1) errors.push(`name 重复："${name}" 出现在 ${locs.join('；')}。世界书合并按 name 整对象替换，重复会静默覆盖。`);
  }
  for (const [alias, locs] of aliasMap) {
    if (nameMap.has(alias)) errors.push(`aliases 冲突："${alias}"（别名见 ${locs.join('；')}）与 name 相撞（${nameMap.get(alias).join('；')}）。`);
    if (locs.length > 1) errors.push(`aliases 冲突："${alias}" 被多个条目用作别名（${locs.join('；')}）。`);
  }

  // 规则 5b：有效名碰撞。有效名 = name 存在取 name，否则取 id（对齐运行时
  // worldbookCatalogParser.ts 的 name 缺省=id 语义）。id/name 各自重复已由规则 5 判红，
  // 这里只补「name 撞别人的 id」的混合占用缝隙：v2 按 name 合并、v1 按 id 定位，
  // 同名异源违反唯一 owner 原则。纯存量碰撞 → warn；任一方来自《通用·科技》→ 红。
  const effMap = new Map(); // 有效名 → [{ loc, techBook, source, id, name }]
  for (const b of parsed) {
    const d = b.data;
    const hasName = typeof d.name === 'string' && d.name;
    const hasId = typeof d.id === 'string' && d.id;
    const eff = hasName ? d.name : hasId ? d.id : null;
    if (!eff) continue;
    pushMap(effMap, eff, {
      loc: `${b.fileName} ${b.loc}`,
      techBook: b.techBook,
      source: hasName ? 'name' : 'id',
      id: hasId ? d.id : null,
      name: hasName ? d.name : null,
    });
  }
  const describeOwner = (o) =>
    `${o.loc}（${o.source === 'name' ? `name="${o.name}"` : `name 缺省，id="${o.id}"`}）`;
  let nameCollisions = 0;
  for (const [eff, owners] of effMap) {
    if (owners.length < 2) continue;
    // 全部源自 id（均缺 name）→ 规则 5「id 重复」已判红；全部源自 name →「name 重复」已判红。不重复报告。
    if (new Set(owners.map((o) => o.source)).size === 1) continue;
    nameCollisions++;
    const msg =
      `有效名碰撞："${eff}" 被 ${owners.length} 个块占用（有效名 = name ?? id）：${owners.map(describeOwner).join('；')}。` +
      `违反唯一 owner 原则——v2 按 name 合并、v1 按 id 定位，同名异源会互相串位。`;
    if (owners.some((o) => o.techBook)) errors.push(`${msg}涉及《通用·科技》，判红。`);
    else warnings.push(`${msg}（存量已知债，warn 不判红）`);
  }

  // 规则 5c：aliases 撞有效名。上方「aliases vs name」只查 name 字段；此处扩到有效名，
  // 即补「别名撞缺 name 块的 id」缝隙。自引用（块把自己的 id 又写进 aliases）不算碰撞。
  const aliasOwners = new Map(); // alias → [{ loc, techBook }]
  for (const b of parsed) {
    if (!Array.isArray(b.data.aliases)) continue;
    for (const a of b.data.aliases) {
      if (typeof a === 'string' && a) pushMap(aliasOwners, a, { loc: `${b.fileName} ${b.loc}`, techBook: b.techBook });
    }
  }
  for (const [alias, owners] of aliasOwners) {
    const targets = (effMap.get(alias) || []).filter((o) => o.source === 'id');
    const pairs = [];
    for (const o of owners) for (const t of targets) if (o.loc !== t.loc) pairs.push([o, t]);
    if (!pairs.length) continue; // 撞 name 派生有效名已由上方 aliases-vs-name 规则判红
    nameCollisions++;
    const aliasSide = [...new Map(owners.map((o) => [o.loc, o])).values()].map((o) => o.loc).join('；');
    const targetSide = [...new Map(targets.map((t) => [t.loc, t])).values()].map(describeOwner).join('；');
    const msg =
      `aliases 撞有效名："${alias}" 被用作别名（${aliasSide}），同时是他块有效名（${targetSide}）。` +
      `别名解析与 id 定位会串位。`;
    if (pairs.some(([o, t]) => o.techBook || t.techBook)) errors.push(`${msg}涉及《通用·科技》，判红。`);
    else warnings.push(`${msg}（存量已知债，warn 不判红）`);
  }

  // 规则 7a：悬空引用（name∪id∪aliases 查无 → warn；《通用·科技》书内 → 红）
  const resolvable = new Set([...idMap.keys(), ...nameMap.keys(), ...aliasMap.keys()]);
  let danglingRefs = 0;
  for (const b of parsed) {
    for (const r of b.refs) {
      if (resolvable.has(r.name)) continue;
      danglingRefs++;
      const msg = `悬空引用：${b.fileName} ${b.loc} 的 ${r.via} 引用了 ${r.kind} "${r.name}"，全书 name∪id∪aliases 中查无此名。`;
      if (b.techBook) errors.push(`${msg}《通用·科技》书内引用悬空判红。`);
      else warnings.push(`${msg}（存量已知债，warn 不判红）`);
    }
  }

  // 规则 7b：前置环检测（research/building 混合前置图，Tarjan SCC）
  const resolve = new Map();
  parsed.forEach((b, i) => {
    const d = b.data;
    const keys = [d.id, d.name, ...(Array.isArray(d.aliases) ? d.aliases : [])];
    for (const key of keys) {
      if (typeof key === 'string' && key && !resolve.has(key)) resolve.set(key, i);
    }
  });
  const adj = parsed.map((b) => {
    const out = new Set();
    for (const r of b.refs) {
      const j = resolve.get(r.name);
      if (j !== undefined) out.add(j);
    }
    return [...out];
  });
  const indexOf = new Array(parsed.length).fill(-1);
  const low = new Array(parsed.length).fill(0);
  const onStack = new Array(parsed.length).fill(false);
  const stack = [];
  const sccs = [];
  let counter = 0;
  function strongconnect(v) {
    indexOf[v] = low[v] = counter++;
    stack.push(v);
    onStack[v] = true;
    for (const w of adj[v]) {
      if (indexOf[w] === -1) {
        strongconnect(w);
        low[v] = Math.min(low[v], low[w]);
      } else if (onStack[w]) {
        low[v] = Math.min(low[v], indexOf[w]);
      }
    }
    if (low[v] === indexOf[v]) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        onStack[w] = false;
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  }
  parsed.forEach((_, v) => {
    if (indexOf[v] === -1) strongconnect(v);
  });
  let cycles = 0;
  for (const scc of sccs) {
    const isCycle = scc.length > 1 || adj[scc[0]].includes(scc[0]);
    if (!isCycle) continue;
    cycles++;
    const names = scc.map((i) => parsed[i].data.name || parsed[i].data.id || parsed[i].loc);
    errors.push(`前置环：${names.join(' → ')} 构成循环前置（研究/建筑互相依赖成环，前置求值无法收敛）。`);
  }

  infos.push(
    `数据块统计：共 ${allBlocks.length} 块（成功解析 ${parsed.length} 块），分布于 ${entryBlockCount.size} 个条目；` +
    `多块条目 ${multiBlockEntries} 个；悬空引用 ${danglingRefs} 处；前置环 ${cycles} 个；有效名碰撞 ${nameCollisions} 起。`,
  );
  return { errors, warnings, infos, nameCollisions };
}

// ---------- 主流程 ----------

function resolveTargets(argv) {
  const args = argv.slice(2);
  if (args.length > 0) return args;
  // 无参数：扫描脚本同级 worldbooks/ 中含「世界书」的 json。
  // 不跟随当前工作目录，避免从子目录调用时误扫历史备份或漏掉现行真源。
  const worldbooksDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'worldbooks');
  if (!fs.existsSync(worldbooksDir)) return [];
  return fs.readdirSync(worldbooksDir)
    .filter((f) => f.toLowerCase().endsWith('.json') && f.includes('世界书'))
    .map((f) => path.join(worldbooksDir, f));
}

function main() {
  const targets = resolveTargets(process.argv);
  if (targets.length === 0) {
    console.error('用法：node 校验世界书.mjs 文件1.json [文件2.json ...]');
    console.error('（未在脚本同级 worldbooks/ 找到含「世界书」的 .json 文件）');
    process.exit(2);
  }

  let anyError = false;
  let pacingViolations = 0;
  const allBlocks = [];
  for (const t of targets) {
    const { errors, warnings, infos, dataBlocks, pacingViolations: pv } = validateFile(t);
    if (Array.isArray(dataBlocks)) allBlocks.push(...dataBlocks);
    if (typeof pv === 'number') pacingViolations += pv;
    const name = path.basename(t);
    console.log('\n' + '═'.repeat(60));
    console.log(`📖 ${name}`);
    console.log('═'.repeat(60));
    for (const i of infos) console.log(`  · ${i}`);
    if (errors.length) {
      anyError = true;
      console.log(`\n  ❌ 错误 ${errors.length} 项（会导致导入失败或明显异常，必须修）：`);
      errors.forEach((e) => console.log(`     ✗ ${e}`));
    }
    if (warnings.length) {
      console.log(`\n  ⚠️  警告 ${warnings.length} 项（可导入，但建议确认）：`);
      warnings.forEach((w) => console.log(`     ! ${w}`));
    }
    if (!errors.length && !warnings.length) {
      console.log('\n  ✅ 结构与字段校验通过，未发现问题。');
    } else if (!errors.length) {
      console.log('\n  ✅ 无阻断性错误，可以导入（请留意上面的警告）。');
    }
  }

  // 跨书 <数据> 块全局校验（唯一性 / 有效名碰撞 / 悬空引用 / 前置环）
  const g = validateDataBlocksGlobal(allBlocks);
  console.log('\n' + '═'.repeat(60));
  console.log('🔗 跨书 <数据> 块校验（唯一性 / 有效名碰撞 / 引用 / 前置环）');
  console.log('═'.repeat(60));
  for (const i of g.infos) console.log(`  · ${i}`);
  if (g.errors.length) {
    anyError = true;
    console.log(`\n  ❌ 跨书错误 ${g.errors.length} 项：`);
    g.errors.forEach((e) => console.log(`     ✗ ${e}`));
  }
  if (g.warnings.length) {
    console.log(`\n  ⚠️  跨书警告 ${g.warnings.length} 项（存量已知债，报告不阻塞）：`);
    g.warnings.forEach((w) => console.log(`     ! ${w}`));
  }
  if (!g.errors.length && !g.warnings.length) {
    console.log('\n  ✅ 跨书唯一性 / 引用 / 前置环校验通过。');
  }

  console.log('\n' + '─'.repeat(60));
  // B9 口径（驾驶员裁定 2026-10）：基础科技 = 有效零科技前置——requirements 树不含任何已落库 research 原子且 prereqs 无落库科技（纯建筑门控型计入）。
const walkHasResearchRef = (c) => {
  if (!c || typeof c !== 'object') return false;
  if (c.kind === 'research') return true;
  if (c.op && Array.isArray(c.conditions)) return c.conditions.some(walkHasResearchRef);
  return false;
};
const basicTechCount = (() => {
  const names = new Set();
  for (const b of allBlocks) { if (b.data && b.data.type === 'research') names.add(b.data.name || b.data.id); }
  let n = 0;
  for (const b of allBlocks) {
    const d = b.data;
    if (!d || d.type !== 'research') continue;
    const hasTech = walkHasResearchRef(d.requirements) || (Array.isArray(d.prereqs) && d.prereqs.some((x) => names.has(x)));
    if (!hasTech) n++;
  }
  return n;
})();
console.log(`计数摘要：文件 ${targets.length} 本；<数据> 块 ${allBlocks.length} 个；跨书错误 ${g.errors.length} 项；跨书警告 ${g.warnings.length} 项；有效名碰撞 ${g.nameCollisions} 起；工期规则违例 ${pacingViolations} 起；基础科技（B9口径·有效零科技前置）${basicTechCount} 项。`);
  console.log(anyError
    ? '结果：存在阻断性错误，请先修复再导入。'
    : '结果：全部文件无阻断性错误。');
  console.log('提醒：静态校验不能替代真机验证——激活/递归/分组竞争等运行时行为仍须在真实 SillyTavern 导入后确认。');
  console.log('─'.repeat(60));

  process.exit(anyError ? 1 : 0);
}

main();
