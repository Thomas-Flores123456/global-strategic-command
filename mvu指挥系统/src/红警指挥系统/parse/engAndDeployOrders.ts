/**
 * parse/engAndDeployOrders.ts —— E3 <部署> 标签提取与 <工程> 指令收集纯函数（DEC-PARSE-01 / UTO-ALLOC-01）
 *
 * 约束：零 IO / 零酒馆 API / 零 Vue 依赖。
 */
import { parseString } from '@util/common';
import { resolveBaseReference, type RuntimeBaseLike } from '../core/catalogRuntimeContext';
import { resolveMcvVehicleAliases } from '../engines/deploymentEngine';
import {
  normalizeBaseSiteType,
  normalizeCanonicalWeather,
  parseTimezoneOffset,
} from '../engines/timezoneWeatherEngine';
import {
  applyAlign,
  asArray,
  canon,
  green,
  isUsable,
  keyIndex,
  preprocess,
  quarantineLeftovers,
  readAliasValue,
  splitTagField,
  toNum,
  yellow,
  type ParseCtxLike,
  type StatData,
} from './parseCommon';

export { splitTagField };

/* ═══════════════ 部署令两段式（E3a · CTRL-DEPLOY-PARSE-01，仿 CTRL-DISPATCH-PARSE-01） ═══════════════ */

/** deploy 块机读形（结构视图，与 deploymentEngine DeployBlock 兼容；解析层不 import 引擎保持单向依赖） */
export interface DeployBlockLike {
  into: string;
  capabilities?: readonly string[];
  duration_min?: number;
  reverse?: boolean;
  capacity_ratio?: number;
  deploy_limit?: number;
  /** E3c 案甲：前沿工地可建造建筑实名白名单（capabilities 含 'build.whitelist' 时生效；缺席＝不启用挂载校验） */
  whitelist?: readonly string[];
}

/** deploy 目录索引（纯函数注入；由 deploymentEngine.deployBlockIndexFromCatalog 构建或测试合成） */
export interface DeployCatalogIndexLike {
  byVehicle(vehicleName: string): DeployBlockLike | undefined;
  byInto(buildingName: string): { vehicle: string; block: DeployBlockLike } | undefined;
}

/** E3a：部署令（解析层只构造、不执行；执行归 deploymentEngine.requestDeployment/settleDeployments） */
export interface DeployOrder {
  /** 展开＝车队在账载具名（账本原文）；收起＝反查 deploy.into 回填的载具原名 */
  vehicle: string;
  action: '展开' | '收起';
  /** 目标基地（Base.id；当场建新基地时＝新基地名） */
  base: string;
  /** 展开＝deploy.into 建筑名；收起＝在场建筑名（账本原文） */
  into: string;
  /** 仅「当场建新基地」的展开携带 */
  new_base?: {
    name: string;
    location: string;
    tz_offset?: number;
    weather?: string;
    site_type?: string;
  };
  /** deploy.duration_min（收起同块对称，D6；缺席为 0＝首次 Δt>0 即翻转） */
  duration_min: number;
}

/** 部署声明（段一收集；段二基于战况增量后状态解析） */
export interface DeployDecl {
  verb: '展开' | '收起';
  /** 展开＝载具名原文；收起＝在场建筑名原文 */
  target: string;
  base?: string;
  newBaseName?: string;
  location?: string;
  tz_offset?: number;
  weather?: string;
  site_type?: string;
  mode?: string;
  hasExplicitActionKey?: boolean;
  raw: string;
  path: string;
}

/** 部署指令解析所需的上下文视图 */
export interface DeployParseCtxLike extends ParseCtxLike {
  deployOrders: DeployOrder[];
  deployIndex?: DeployCatalogIndexLike;
}

export const DEPLOY_EXPAND_KEYS = ['展开', 'deploy'] as const;
export const DEPLOY_FOLD_KEYS = ['收起', 'undeploy'] as const;
export const DEPLOY_BASE_KEYS = ['基地', 'base'] as const;
export const DEPLOY_NEW_BASE_KEYS = ['新基地', 'new_base', 'newbase'] as const;
export const DEPLOY_LOCATION_KEYS = ['位置', 'location'] as const;
export const DEPLOY_TIMEZONE_KEYS = ['时区', '标准时差', '时差', 'tz_offset', 'timezone'] as const;
export const DEPLOY_WEATHER_KEYS = ['天气', '局部天气', '气象', '天候', 'weather'] as const;
export const DEPLOY_SITE_TYPE_KEYS = ['选址', '地形', '环境', 'site_type', 'terrain'] as const;
export const DEPLOY_MODE_KEYS = ['模式', '展开模式', '部署模式', 'mode'] as const;

/**
 * 剥离基地引用末尾携带的括号位置修饰或中圆点/横杠子区域后缀（FD-38 · PKG-C）
 * 如："1号主基地（大厅西侧）" -> "1号主基地"、"1号主基地·地下大厅" -> "1号主基地"
 */
export function stripBaseLocationModifier(rawBase: string): string {
  let s = String(rawBase ?? '').trim();
  if (!s) return '';
  let prev = '';
  while (s && s !== prev) {
    prev = s;
    s = s
      .replace(/\s*[（(][^（）()]*[）)]\s*$/u, '')
      .replace(/\s*[·•｜|/—－-]\s*[^·•｜|/—－-]+$/u, '')
      .trim();
  }
  return s;
}

/**
 * 部署目标基地引用解析（FD-38 · PKG-C）：
 * 1. 先按原名执行 resolveBaseReference 精确匹配；
 * 2. 再按 canon 归一匹配；
 * 3. 若未命中，逐层剥离末尾括号（如「（西侧大厅）」）或中圆点修饰（如「·地下大厅」）后匹配既有基地；
 * 4. 支持前缀方位修饰匹配（如「1号主基地西侧大厅」->「1号主基地」）。
 */
export function resolveExistingBaseForDeploy(
  bases: readonly RuntimeBaseLike[],
  rawRef: string | undefined,
): ReturnType<typeof resolveBaseReference> {
  const trimmed = String(rawRef ?? '').trim();
  if (!trimmed) return { status: 'missing', reference: '' };

  const direct = resolveBaseReference(bases, trimmed);
  if (direct.status !== 'missing') return direct;

  const targetCanon = canon(trimmed);
  const canonMatches = bases.filter(
    b => canon(b.id) === targetCanon || canon(b.name) === targetCanon,
  );
  if (canonMatches.length === 1) {
    return { status: 'resolved', baseId: String(canonMatches[0].id || canonMatches[0].name).trim() };
  }
  if (canonMatches.length > 1) {
    return { status: 'ambiguous', reference: trimmed };
  }

  const candidates: string[] = [];
  const noBracket = trimmed.replace(/\s*[（(][^（）()]*[）)]\s*$/u, '').trim();
  if (noBracket && noBracket !== trimmed) candidates.push(noBracket);
  const fullyStripped = stripBaseLocationModifier(trimmed);
  if (fullyStripped && fullyStripped !== trimmed && !candidates.includes(fullyStripped)) {
    candidates.push(fullyStripped);
  }

  for (const cand of candidates) {
    const res = resolveBaseReference(bases, cand);
    if (res.status !== 'missing') return res;
    const candCanon = canon(cand);
    const cHits = bases.filter(b => canon(b.id) === candCanon || canon(b.name) === candCanon);
    if (cHits.length === 1) {
      return { status: 'resolved', baseId: String(cHits[0].id || cHits[0].name).trim() };
    }
    if (cHits.length > 1) {
      return { status: 'ambiguous', reference: trimmed };
    }
  }

  const prefixHits = bases.filter(b => {
    const bName = String(b.name ?? b.id ?? '').trim();
    if (bName.length < 2 || !trimmed.startsWith(bName)) return false;
    const rest = trimmed.slice(bName.length).trim();
    return /^(?:内|中|旁|东|西|南|北|地下|地面|大厅|空地|侧翼|区域|防区|合署)/.test(rest);
  });
  if (prefixHits.length === 1) {
    return { status: 'resolved', baseId: String(prefixHits[0].id || prefixHits[0].name).trim() };
  }

  return { status: 'missing', reference: trimmed };
}

/* ═══════════════ E3b · <部署> 标签块预提取（设计稿§三） ═══════════════ */

/** <部署> 标签块名别名（canon 比对，大小写/全半角按既有惯例；与段一 YAML 键别名同源） */
export const DEPLOY_TAG_NAMES = ['部署', '展开', 'deploy'] as const;

/** 行级标签识别：独占一行的 <部署> / ＜deploy＞ / </部署>（容忍全角括号/斜杠/空白/属性垃圾）；非部署标签返回 null */
export function matchDeployTagLine(line: string): { close: boolean } | null {
  const m = /^[<\uFF1C]\s*([/\uFF0F])?\s*([^\s<>\uFF1C\uFF1E|=/]+)(?:[\s|=/][^<>\uFF1C\uFF1E]*)?[>\uFF1E]\s*$/.exec(
    line.trim(),
  );
  if (!m) return null;
  if (!DEPLOY_TAG_NAMES.some(n => canon(n) === canon(m[2]))) return null;
  return { close: !!m[1] };
}

/**
 * 块内按行解析声明：首字段为动词（展开/收起，别名同 DEPLOY_EXPAND_KEYS/DEPLOY_FOLD_KEYS），
 * 管道「|/｜」切分后续字段（基地/新基地/位置，别名同既有 *_KEYS 表）。
 * 产出与段一 YAML 键形完全同形的记录（原样保留键名拼写）：
 * 残键（如 LLM 重复申报的 耗时）原样带入，由 applyDeployments 既有 leftovers 纪律隔离；
 * 畸形行/未知动词不静默吞——逐条键级隔离留痕，不拖累同块其余声明。
 */
export const DEPLOY_ACTION_KEYS = ['动作', '类型', '指令', '操作', '动词', 'action', 'type', 'op', 'verb'] as const;
export const DEPLOY_VEHICLE_TARGET_KEYS = [
  '车辆',
  '载具',
  '单位',
  '目标',
  '名称',
  '对象',
  'vehicle',
  'unit',
  'target',
  'name',
] as const;
export const DEPLOY_BUILDING_TARGET_KEYS = [
  '建筑',
  '目标',
  '设施',
  '车辆',
  '载具',
  '单位',
  '名称',
  '对象',
  'building',
  'into',
  'target',
  'vehicle',
  'unit',
  'name',
] as const;

function inferMcvDeployBlock(vehicleOrTarget: string): DeployBlockLike | undefined {
  const s = String(vehicleOrTarget ?? '').trim();
  if (!s) return undefined;
  if (resolveMcvVehicleAliases(s).length <= 1 && !/mcv|基地车/i.test(s)) return undefined;
  if (/苏联|苏军|soviet/i.test(s)) return { into: '苏联建造厂', duration_min: 0, reverse: true };
  if (/尤里|yuri/i.test(s)) return { into: '尤里建造厂', duration_min: 0, reverse: true };
  return { into: '盟军建造厂', duration_min: 0, reverse: true };
}

function inferConyardFoldHit(buildingName: string): { vehicle: string; block: DeployBlockLike } | undefined {
  const b = String(buildingName ?? '').trim();
  if (!b) return undefined;
  if (b === '苏联建造厂') return { vehicle: 'MCV（苏联）', block: { into: '苏联建造厂', duration_min: 0, reverse: true } };
  if (b === '尤里建造厂') return { vehicle: 'MCV（尤里）', block: { into: '尤里建造厂', duration_min: 0, reverse: true } };
  if (b === '盟军建造厂' || b === '建造厂') {
    return { vehicle: 'MCV（盟军）', block: { into: b, duration_min: 0, reverse: true } };
  }
  return undefined;
}

export function parseDeployTagBody(body: string[], decls: Record<string, unknown>[], ctx: ParseCtxLike): void {
  const lines = body.map(l => l.trim()).filter(l => l.length > 0);
  if (!lines.length) {
    ctx.quarantine.push({
      scope: 'block',
      tag: '部署',
      raw: '(空块)',
      error: '部署标签块为空（无声明行）',
      suggestion: '块内每行应为「展开/收起: 目标 | 基地/新基地/位置: 值」',
    });
    return;
  }
  const hasPipe = lines.some(l => /[|\uFF5C]/.test(l));
  const hasInlineCommaKv = lines.some(l => !/[|\uFF5C]/.test(l) && /[,，]\s*[^\s:：,，]+\s*[:：]/.test(l));
  const looksLikeYaml = lines.some(l => /^-\s+/.test(l)) || hasInlineCommaKv || (!hasPipe && lines.length > 1);
  if (looksLikeYaml) {
    try {
      const normalizedYamlLines = body.map(rawLine => {
        if (/[|\uFF5C]/.test(rawLine) || !/[,，]\s*[^\s:：,，]+\s*[:：]/.test(rawLine)) {
          return rawLine;
        }
        const trimmed = rawLine.trim();
        const isListItem = /^-\s+/.test(trimmed);
        const content = isListItem ? trimmed.replace(/^-\s+/, '') : trimmed;
        const parts = content
          .split(/[,，](?=\s*[^\s:：,，]+\s*[:：])/)
          .map(p => p.trim())
          .filter(Boolean);
        if (parts.length <= 1) return rawLine;
        return `- ${parts[0]}\n  ${parts.slice(1).join('\n  ')}`;
      });
      const parsedYaml = parseString(preprocess(normalizedYamlLines.join('\n')));
      if (Array.isArray(parsedYaml)) {
        for (const item of parsedYaml) {
          if (isUsable(item) && !Array.isArray(item)) {
            decls.push(item as Record<string, unknown>);
          }
        }
        if (decls.length > 0) return;
      } else if (isUsable(parsedYaml) && !Array.isArray(parsedYaml)) {
        decls.push(parsedYaml as Record<string, unknown>);
        return;
      }
    } catch {
      // fall through to line-by-line parser
    }
  }
  for (const line of lines) {
    const segments = line
      .split(/[|\uFF5C]/)
      .map(s => s.trim())
      .filter(Boolean);
    const first = segments.length ? splitTagField(segments[0]) : null;
    if (!first) {
      ctx.quarantine.push({ scope: 'key', path: '部署', raw: line, error: '声明行畸形（缺「动词: 目标」首字段）' });
      continue;
    }
    const verbCanon = canon(first.key);
    const isVerb =
      DEPLOY_EXPAND_KEYS.some(k => canon(k) === verbCanon) || DEPLOY_FOLD_KEYS.some(k => canon(k) === verbCanon);
    if (!isVerb) {
      ctx.quarantine.push({ scope: 'key', path: '部署', raw: line, error: '未知部署动词（仅支持 展开/收起）' });
      continue;
    }
    const source: Record<string, unknown> = { [first.key]: first.value };
    let malformed = false;
    for (const seg of segments.slice(1)) {
      const kv = splitTagField(seg);
      if (!kv) {
        ctx.quarantine.push({ scope: 'key', path: '部署', raw: line, error: `字段「${seg}」畸形（应为 键: 值）` });
        malformed = true;
        break;
      }
      source[kv.key] = kv.value;
    }
    if (!malformed) decls.push(source);
  }
}

/**
 * E3b · 段一前标签块预提取：从战况/初始状态原始文本（YAML 预处理之前）剥离 <部署>…</部署> 块，
 * 声明与 take 认领的 YAML 键形两路并存、汇入同一 deployDecls 流进既有段二（宽进严出零改动）；
 * 剥离后的文本才进 YAML 预处理，防标签行被绞成「战况.<部署> 展开」垃圾键误隔离；
 * 只认独占一行的标签（同 L0 行首纪律），非部署标签与正文一律不动；
 * 未闭合块黄灯留痕且原文保留（交 YAML 路径隔离），不静默吞。
 */
export function extractDeployTagBlocks(
  inner: string,
  ctx: ParseCtxLike,
): { cleaned: string; decls: Record<string, unknown>[] } {
  if (!/[<\uFF1C]/.test(inner)) return { cleaned: inner, decls: [] };
  const decls: Record<string, unknown>[] = [];
  const out: string[] = [];
  const lines = inner.split('\n');
  let i = 0;
  while (i < lines.length) {
    const open = matchDeployTagLine(lines[i]);
    if (!open || open.close) {
      out.push(lines[i]);
      i++;
      continue;
    }
    const body: string[] = [];
    let j = i + 1;
    let closed = false;
    while (j < lines.length) {
      const t = matchDeployTagLine(lines[j]);
      if (t) {
        closed = t.close;
        break;
      }
      body.push(lines[j]);
      j++;
    }
    if (!closed) {
      yellow(
        ctx,
        { layer: 'L1', message: '<部署> 标签块未闭合，原文保留交由 YAML 路径隔离', snippet: lines[i].trim() },
        { rule: 'R17', target: '部署', message: '<部署> 标签块未闭合，未预提取' },
      );
      out.push(lines[i]);
      i++;
      continue;
    }
    parseDeployTagBody(body, decls, ctx);
    i = j + 1;
  }
  return { cleaned: out.join('\n'), decls };
}

/** 部署令拒收（宽进严出：🟡 事件＋R18 warn，声明不进 deployOrders 槽） */
export function rejectDeploy(ctx: ParseCtxLike, decl: DeployDecl, reason: string): void {
  yellow(
    ctx,
    { layer: 'instruction', path: decl.path, message: `部署令「${decl.verb}: ${decl.target}」拒收：${reason}` },
    { rule: 'R18', target: decl.path, message: `部署令拒收（${reason}）` },
  );
}

/**
 * 段一·声明收集：战况「部署/展开/deploy」键 → deployDecls[]（跳过账本直写）；
 * 段二·延迟解析：逐条 resolveDeployOrder（基于战况增量后状态，同楼新建基地亦可被本楼部署）。
 */
export function applyDeployments(deploys: unknown, data: StatData, ctx: DeployParseCtxLike): void {
  const deployDecls: DeployDecl[] = [];
  for (const rawItem of asArray(deploys)) {
    if (!isUsable(rawItem) || Array.isArray(rawItem)) {
      ctx.quarantine.push({
        scope: 'element',
        tag: '部署',
        path: '部署',
        raw: JSON.stringify(rawItem),
        error: '部署元素非对象',
      });
      continue;
    }
    const source = rawItem as Record<string, unknown>;
    const index = keyIndex(source);
    const consumed = new Set<string>();
    const markKeys = (aliases: readonly string[]) => {
      for (const alias of aliases) {
        const key = index.get(canon(alias));
        if (key !== undefined) consumed.add(key);
      }
    };
    const expandRaw = readAliasValue(source, index, [...DEPLOY_EXPAND_KEYS]);
    const foldRaw = readAliasValue(source, index, [...DEPLOY_FOLD_KEYS]);
    const actionRaw = readAliasValue(source, index, [...DEPLOY_ACTION_KEYS]);
    let verb: '展开' | '收起' | null = null;
    let target = '';
    if (actionRaw !== undefined && String(actionRaw ?? '').trim()) {
      const actToken = canon(String(actionRaw).trim());
      markKeys(DEPLOY_ACTION_KEYS);
      if (DEPLOY_EXPAND_KEYS.some(k => canon(k) === actToken)) {
        verb = '展开';
        const tRaw = readAliasValue(source, index, [...DEPLOY_VEHICLE_TARGET_KEYS]);
        markKeys(DEPLOY_VEHICLE_TARGET_KEYS);
        target = tRaw !== undefined && String(tRaw ?? '').trim() ? String(tRaw).trim() : 'MCV';
      } else if (DEPLOY_FOLD_KEYS.some(k => canon(k) === actToken) || actToken === '撤收' || actToken === '转移') {
        verb = '收起';
        const tRaw = readAliasValue(source, index, [...DEPLOY_BUILDING_TARGET_KEYS]);
        markKeys(DEPLOY_BUILDING_TARGET_KEYS);
        target = tRaw !== undefined && String(tRaw ?? '').trim() ? String(tRaw).trim() : '建造厂';
      }
    } else if (expandRaw !== undefined && String(expandRaw ?? '').trim()) {
      verb = '展开';
      target = String(expandRaw).trim();
      markKeys(DEPLOY_EXPAND_KEYS);
    } else if (foldRaw !== undefined && String(foldRaw ?? '').trim()) {
      verb = '收起';
      target = String(foldRaw).trim();
      markKeys(DEPLOY_FOLD_KEYS);
    }
    if (!verb) {
      ctx.quarantine.push({
        scope: 'key',
        path: '部署',
        raw: JSON.stringify(source),
        error: '未知部署动词（仅支持 展开/收起）',
      });
      continue;
    }
    const baseRaw = readAliasValue(source, index, [...DEPLOY_BASE_KEYS]);
    const newBaseRaw = readAliasValue(source, index, [...DEPLOY_NEW_BASE_KEYS]);
    const locationRaw = readAliasValue(source, index, [...DEPLOY_LOCATION_KEYS]);
    const tzRaw = readAliasValue(source, index, [...DEPLOY_TIMEZONE_KEYS]);
    const weatherRaw = readAliasValue(source, index, [...DEPLOY_WEATHER_KEYS]);
    const siteRaw = readAliasValue(source, index, [...DEPLOY_SITE_TYPE_KEYS]);
    const modeRaw = readAliasValue(source, index, [...DEPLOY_MODE_KEYS]);
    markKeys(DEPLOY_BASE_KEYS);
    markKeys(DEPLOY_NEW_BASE_KEYS);
    markKeys(DEPLOY_LOCATION_KEYS);
    markKeys(DEPLOY_TIMEZONE_KEYS);
    markKeys(DEPLOY_WEATHER_KEYS);
    markKeys(DEPLOY_SITE_TYPE_KEYS);
    markKeys(DEPLOY_MODE_KEYS);
    const decl: DeployDecl = { verb, target, raw: JSON.stringify(source), path: `部署[${target}]` };
    if (actionRaw !== undefined && String(actionRaw ?? '').trim()) decl.hasExplicitActionKey = true;
    if (modeRaw !== undefined && String(modeRaw).trim()) decl.mode = String(modeRaw).trim();
    if (baseRaw !== undefined && String(baseRaw).trim()) decl.base = String(baseRaw).trim();
    if (newBaseRaw !== undefined && String(newBaseRaw).trim()) decl.newBaseName = String(newBaseRaw).trim();
    if (locationRaw !== undefined && String(locationRaw).trim()) decl.location = String(locationRaw).trim();
    if (tzRaw !== undefined && String(tzRaw).trim() !== '') {
      decl.tz_offset = parseTimezoneOffset(tzRaw, false);
    }
    if (weatherRaw !== undefined && String(weatherRaw).trim() !== '') {
      const normW = normalizeCanonicalWeather(weatherRaw);
      if (normW) decl.weather = normW;
    }
    if (siteRaw !== undefined && String(siteRaw).trim() !== '') {
      const rawSite = String(siteRaw).trim();
      decl.site_type = normalizeBaseSiteType(rawSite) || rawSite;
    }
    deployDecls.push(decl);
    quarantineLeftovers(source, consumed, ctx, `部署[${target}]`);
  }

  // 段二：延迟解析（宽进严出）
  for (const decl of deployDecls) resolveDeployOrder(decl, data, ctx);
}

/**
 * 部署声明 → DeployOrder（E3a · 宽进严出，设计稿§四）：
 * - deploy 目录索引未注入 → fail-closed 拒收（防幻影建筑/幻影载具；注入接线归 E3b 指令面批）；
 * - 展开：车 ∈ vehicles（canon 比对采账本原文）；catalog 存在以该车为 production 的 deploy 块；
 *   基地存在（resolveBaseReference）或 new_base 字段齐（两者同时申报/均缺席 → 拒收）；
 *   deploy_limit / capacity_ratio 满 → 拒收（只约束在场部署建筑，既有完工建筑不占容量）；
 * - 收起：基地存在＋建筑在场；反查 deploy.into 命中 → 回填载具原名；reverse=false → 拒收；
 * - 接受 → deployOrders 槽＋🟢 事件（解析层只构造，执行归引擎）。
 */
export function resolveDeployOrder(decl: DeployDecl, data: StatData, ctx: DeployParseCtxLike): void {
  const deployIndex = ctx.deployIndex;
  const allowMcvFallback = Boolean(decl.hasExplicitActionKey);
  if (!deployIndex && !allowMcvFallback) {
    rejectDeploy(ctx, decl, 'deploy 目录索引未注入，无法校验/解析（fail-closed 防幻影）');
    return;
  }

  // 基地引用消歧（收起必需；展开二选一；支持剥离括号/圆点位置修饰匹配既有基地）
  const resolveBase = (): { ok: true; baseId: string } | { ok: false } => {
    if (!decl.base) return { ok: false };
    const resolved = resolveExistingBaseForDeploy(data.bases as RuntimeBaseLike[], decl.base);
    if (resolved.status === 'resolved') return { ok: true, baseId: resolved.baseId };
    // 若展开指令指定的基地名尚未存在，但当前仅有 1 座未展开的初始占位基地（0 建筑），原地重命名认亲
    if (resolved.status === 'missing' && decl.verb === '展开' && data.bases.length > 0) {
      const placeholder = data.bases.find(
        b =>
          (b.buildings?.length ?? 0) === 0 &&
          (b.name === '待侦知部署点' ||
            b.id === 'cyber-entry' ||
            String(b.name ?? '').includes('待侦知') ||
            (data.bases.length === 1 && b.status === '隐蔽中')),
      );
      if (placeholder) {
        placeholder.name = decl.base;
        placeholder.id = decl.base;
        return { ok: true, baseId: placeholder.id };
      }
      // 若场上仅有 1 座基地，展开指令默认指向该唯一基地
      if (data.bases.length === 1) {
        return { ok: true, baseId: data.bases[0].id || data.bases[0].name };
      }
    }
    rejectDeploy(
      ctx,
      decl,
      resolved.status === 'ambiguous' ? `基地引用「${decl.base}」不唯一` : `基地引用「${decl.base}」不存在`,
    );
    return { ok: false };
  };

  if (decl.verb === '展开') {
    let vehicle = data.forces.vehicles.find(v => canon(v) === canon(decl.target));
    const aliases = resolveMcvVehicleAliases(decl.target);
    if (!vehicle && aliases.length > 1) {
      vehicle = data.forces.vehicles.find(v => aliases.some(a => canon(v) === canon(a)));
    }
    // 首发未展开基地兜底：若目标是 MCV，且全场所有基地均尚无建造厂（<初始状态> 漏写初始 MCV 载具），自动补入车队后展开
    if (!vehicle && aliases.length > 1) {
      const anyBaseHasConyard = data.bases.some(base =>
        (base.buildings ?? []).some(b =>
          ['建造厂', '盟军建造厂', '苏联建造厂', '尤里建造厂', '前沿工地', '作战前哨站'].includes(b.name.trim()),
        ),
      );
      if (!anyBaseHasConyard) {
        vehicle = aliases[0];
        data.forces.vehicles.push(vehicle);
      }
    }
    if (!vehicle) {
      rejectDeploy(ctx, decl, `载具「${decl.target}」不在车队（vehicles）`);
      return;
    }
    let block = deployIndex?.byVehicle(vehicle) ?? deployIndex?.byVehicle(decl.target);
    if (!block && deployIndex) {
      for (const alias of resolveMcvVehicleAliases(vehicle)) {
        block = deployIndex.byVehicle(alias);
        if (block) break;
      }
    }
    if (!block && allowMcvFallback) {
      block = inferMcvDeployBlock(vehicle) ?? inferMcvDeployBlock(decl.target);
    }
    if (!block) {
      rejectDeploy(ctx, decl, `catalog 无以「${vehicle}」为 production 的 deploy 块`);
      return;
    }
    const isExplicitNewOutpost = Boolean(decl.mode && /新辟|分基地|新建|异地/i.test(decl.mode));
    const isExplicitCoLocate = Boolean(
      decl.mode && /合署|同址|并入|扩建/i.test(decl.mode) && !isExplicitNewOutpost,
    );
    if (isExplicitNewOutpost && decl.base && !decl.newBaseName) {
      decl.newBaseName = decl.base;
      decl.base = undefined;
    }
    if (decl.base && decl.newBaseName) {
      if (
        canon(decl.base) === canon(decl.newBaseName) ||
        canon(stripBaseLocationModifier(decl.base)) === canon(stripBaseLocationModifier(decl.newBaseName))
      ) {
        const existingCheck = resolveExistingBaseForDeploy(data.bases as RuntimeBaseLike[], decl.base);
        if (existingCheck.status === 'resolved' && !isExplicitNewOutpost) {
          decl.base = existingCheck.baseId;
          decl.newBaseName = undefined;
        } else {
          decl.base = undefined;
        }
      } else {
        rejectDeploy(ctx, decl, '基地与新基地同时申报，目标歧义');
        return;
      }
    }
    const isMcvOrEventExpand =
      decl.path.startsWith('事件[MCV展开') ||
      block.into.includes('建造厂') ||
      (block.capabilities ?? []).includes('build.conyard');
    if (!decl.base && !decl.newBaseName) {
      if (data.bases.length === 0 && isMcvOrEventExpand) {
        decl.newBaseName = '前沿第一基地';
      } else {
        rejectDeploy(ctx, decl, '缺少目标（基地 或 新基地 二选一）');
        return;
      }
    }
    const buildNewBasePayload = (name: string, location: string): NonNullable<DeployOrder['new_base']> => {
      const isFirstBase = data.bases.length === 0;
      return {
        name,
        location,
        ...(decl.tz_offset !== undefined
          ? { tz_offset: isFirstBase ? 0 : parseTimezoneOffset(decl.tz_offset, false) }
          : {}),
        ...(decl.weather ? { weather: normalizeCanonicalWeather(decl.weather) || decl.weather } : {}),
        ...(decl.site_type ? { site_type: normalizeBaseSiteType(decl.site_type) || decl.site_type } : {}),
      };
    };

    let order: DeployOrder;
    if (decl.newBaseName) {
      const effectiveLoc = decl.location?.trim() || data.meta.location?.trim() || '';
      order = {
        vehicle,
        action: '展开',
        base: decl.newBaseName,
        into: block.into,
        new_base: buildNewBasePayload(decl.newBaseName, effectiveLoc),
        duration_min: block.duration_min ?? 0,
      };
    } else {
      // 零基地开局（bases=[]）或 MCV 展开指向尚不存在的新基地名时：自动按新建基地奠基处理；
      // 若剥离括号/圆点位置修饰后命中既有基地（或显式声明合署扩建），则走既有基地同址合署扩建
      const rawPreCheck = decl.base
        ? resolveExistingBaseForDeploy(data.bases as RuntimeBaseLike[], decl.base)
        : ({ status: 'missing' as const } as ReturnType<typeof resolveBaseReference>);
      const preCheck =
        rawPreCheck.status === 'missing' && isExplicitCoLocate && data.bases.length === 1
          ? { status: 'resolved' as const, baseId: data.bases[0].id || data.bases[0].name }
          : rawPreCheck;
      const hasPlaceholderToRename =
        preCheck.status === 'missing' &&
        data.bases.some(
          b =>
            (b.buildings?.length ?? 0) === 0 &&
            (b.name === '待侦知部署点' ||
              b.id === 'cyber-entry' ||
              String(b.name ?? '').includes('待侦知') ||
              (data.bases.length === 1 && b.status === '隐蔽中')),
        );
      if (
        preCheck.status === 'missing' &&
        !hasPlaceholderToRename &&
        decl.base &&
        (data.bases.length === 0 || isMcvOrEventExpand)
      ) {
        const effectiveLoc = decl.location?.trim() || data.meta.location?.trim() || '';
        order = {
          vehicle,
          action: '展开',
          base: decl.base,
          into: block.into,
          new_base: buildNewBasePayload(decl.base, effectiveLoc),
          duration_min: block.duration_min ?? 0,
        };
      } else {
        const resolved = resolveBase();
        if (!resolved.ok) return;
        const base = data.bases.find(b => b.id === resolved.baseId);
        if (base && !base.location?.trim()) {
          const fallbackLoc = decl.location?.trim() || data.meta.location?.trim() || '';
          if (fallbackLoc) base.location = fallbackLoc;
        }
        if (base) {
          const isFirstBase = data.bases[0] === base;
          if (decl.tz_offset !== undefined) {
            base.tz_offset = isFirstBase ? 0 : parseTimezoneOffset(decl.tz_offset, false);
          }
          if (decl.weather) {
            const normW = normalizeCanonicalWeather(decl.weather);
            if (normW) base.weather = normW;
          }
          if (decl.site_type) {
            base.site_type = normalizeBaseSiteType(decl.site_type) || decl.site_type;
          }
        }
        // 容量护栏（只约束在场部署建筑；经建造队列完工移交的建筑不占部署容量，§五）
        if (base && block.deploy_limit !== undefined) {
          const count = base.buildings.filter(b => canon(b.name) === canon(block.into)).length;
          if (count >= block.deploy_limit) {
            rejectDeploy(ctx, decl, `基地「${decl.base}」在场「${block.into}」已达 deploy_limit=${block.deploy_limit}`);
            return;
          }
        }
        if (base && block.capacity_ratio !== undefined) {
          let used = 0;
          for (const b of base.buildings) used += deployIndex?.byInto(b.name)?.block.capacity_ratio ?? 0;
          if (used + block.capacity_ratio > 1) {
            rejectDeploy(ctx, decl, `基地「${decl.base}」部署容量占比 ${used}+${block.capacity_ratio}>1 已满`);
            return;
          }
        }
        order = {
          vehicle,
          action: '展开',
          base: resolved.baseId,
          into: block.into,
          duration_min: block.duration_min ?? 0,
        };
      }
    }
    ctx.deployOrders.push(order);
    if (decl.hasExplicitActionKey) {
      const pending = [...(data.pending_deployments ?? [])].filter(p => p.vehicle !== order.vehicle);
      pending.push({
        vehicle: order.vehicle,
        action: order.action,
        base: order.base,
        into: order.into,
        remaining_minutes: order.duration_min,
        ...(order.new_base ? { new_base: order.new_base } : {}),
      });
      data.pending_deployments = pending;
    }
    green(ctx, {
      layer: 'instruction',
      path: 'pending_deployments',
      message: `部署令「展开」→「${order.vehicle}」@ ${order.base} 已解析（目标建筑 ${order.into}，耗时 ${order.duration_min} 分钟），随本楼结算由引擎裁决执行`,
    });
    return;
  }

  // 收起：LLM 写建筑名，反查 deploy.into 命中 → 回填载具原名
  if (decl.newBaseName) {
    rejectDeploy(ctx, decl, '收起不支持新基地字段');
    return;
  }
  const resolved = resolveBase();
  if (!resolved.ok) return;
  const base = data.bases.find(b => b.id === resolved.baseId);
  let building = base?.buildings.find(b => canon(b.name) === canon(decl.target));
  if (!building && base) {
    const conyardAliases = ['盟军建造厂', '苏联建造厂', '尤里建造厂', '建造厂'];
    if (
      conyardAliases.some(c => canon(c) === canon(decl.target)) ||
      resolveMcvVehicleAliases(decl.target).length > 1 ||
      /mcv|基地车/i.test(decl.target)
    ) {
      building = base.buildings.find(b => conyardAliases.some(c => canon(b.name) === canon(c)));
    }
  }
  if (!base || !building) {
    rejectDeploy(ctx, decl, `建筑「${decl.target}」不在基地「${decl.base}」在场清单`);
    return;
  }
  const hit =
    deployIndex?.byInto(building.name) ??
    deployIndex?.byInto(decl.target) ??
    (allowMcvFallback ? inferConyardFoldHit(building.name) ?? inferConyardFoldHit(decl.target) : undefined);
  if (!hit) {
    rejectDeploy(ctx, decl, `建筑「${building.name}」非任何载具的 deploy.into，无法反查载具`);
    return;
  }
  if (hit.block.reverse !== true) {
    rejectDeploy(ctx, decl, `「${building.name}」deploy.reverse=false，不支持收起`);
    return;
  }
  const order: DeployOrder = {
    vehicle: hit.vehicle,
    action: '收起',
    base: resolved.baseId,
    into: building.name,
    duration_min: hit.block.duration_min ?? 0, // D6：收起耗时＝同块 duration_min
  };
  ctx.deployOrders.push(order);
  if (decl.hasExplicitActionKey) {
    const pending = [...(data.pending_deployments ?? [])].filter(p => p.vehicle !== order.vehicle);
    pending.push({
      vehicle: order.vehicle,
      action: order.action,
      base: order.base,
      into: order.into,
      remaining_minutes: order.duration_min,
    });
    data.pending_deployments = pending;
  }
  green(ctx, {
    layer: 'instruction',
    path: 'pending_deployments',
    message: `部署令「收起」→「${order.into}」@ ${order.base} 已解析（回填载具 ${order.vehicle}，耗时 ${order.duration_min} 分钟），随本楼结算由引擎裁决执行`,
  });
}

/* ════ 工程令收集槽（CTRL-ENG-PROTO-01 · DIR-9 D-R9-b/D-R9-c；UTO-ALLOC-01 扩充指派） ════ */

/** <工程> 顶层动词键（canon 比对；YAML 对象键序＝声明序，接缝按序结转；UTO-ALLOC-01 扩充「指派」） */
export const ENG_VERBS = ['立项', '注资', '暂停', '恢复', '取消', '驳回', '指派'] as const;

/** 工程令动词键（DIR-9 D-R9-b / UTO-ALLOC-01；<工程> 容器标签 YAML 内容的顶层键） */
export type EngOrderVerb = (typeof ENG_VERBS)[number];

/**
 * 工程令（解析层只构造、不执行；执行归 useParse 接缝 → projectEngine，V2-05 起按实例 schema_version 分流）：
 * - 立项：name+base 必填；base 唯一解析归一 Base.id（歧义→隔离区），不可解析引用原样携带由引擎门拒收；
 *   不认 module 键（工程级操作，出现即整令隔离，V2-05）；
 * - 注资/暂停/恢复/取消：实例标识双通道——proj:* 实例 id 直通；工程名唯一匹配归一为实例 id
 *   （零命中原样携带由引擎拒 not_found；歧义→隔离区，对齐 resolveDispatchOrder 宽进严出消歧哲学）；
 * - 注资：定位维度二选一——phase（V1 线性工程，ProjectPhase.idx 0 起）XOR module（V2 仓段化工程，
 *   模块 id 或模块名，同现即隔离，V2-05）；解析层不知实例版本，维度与实例版本的错配归接缝拒收；
 * - 暂停/恢复：module 键缺席＝工程级；携带＝模块级（V2 专用，模块解析归接缝 id 优先/name 兜底唯一匹配）；
 * - 取消：恒工程级，不认 module 键（出现即整令隔离，V2-05）；
 * - 驳回：reason 必填（DIR-9 D-R9-d：驳回必须给叙事理由）；账本不动，接缝仅登记回执事件；
 * - 指派（UTO-ALLOC-01）：跨基地工程模块承建指派，解析工程实例（id/instance_id/projectRef）、
 *   模块名（module/module_id）与目标承建基地（base/target_base）。
 */
export interface EngOrder {
  verb: EngOrderVerb;
  /** 立项：工程名（retrofit/project 静态定义名，接缝按 canon 名解析 RetrofitDef/ProjectDef） */
  name?: string;
  /** 立项：牵头基地；指派：目标承建基地（已解析 Base.id 或原样引用，引擎侧 id/name 双通道再匹配） */
  base?: string;
  /** 注资/暂停/恢复/取消/驳回/指派：实例定位（proj:* 直通或唯一匹配归一后的实例 id） */
  id?: string;
  /** 注资：阶段序号（ProjectPhase.idx，0 起；V1 线性工程定位维度） */
  phase?: number;
  /** 注资/暂停/恢复/指派：模块定位（V2 仓段化；模块 id 或模块名原样携带，接缝 id 优先/name 兜底唯一解析；与 phase 互斥） */
  module?: string;
  /** 驳回/指派：叙事理由（驳回强制非空，缺 → 隔离区；指派可选） */
  reason?: string;
}

/** 工程令解析所需的上下文视图 */
export interface EngParseCtxLike extends ParseCtxLike {
  engOrders: EngOrder[];
}

export const ENG_NAME_KEYS = [
  'name',
  '名称',
  '工程名',
  '工程',
  '项目',
  '工程项目',
  'project',
  'project_name',
  'projectName',
  '目标',
  'target',
  'ref',
] as const;
export const ENG_BASE_KEYS = ['base', '基地', '牵头基地'] as const;
/** UTO-ALLOC-01：跨基地模块指派目标承建基地键（兼容 base / target_base / targetBase / 目标基地 / 承建基地） */
export const ENG_ASSIGN_BASE_KEYS = [
  'base',
  'target_base',
  'targetBase',
  '基地',
  '目标基地',
  '承建基地',
  '牵头基地',
] as const;
export const ENG_ID_KEYS = ['id', '实例', '实例id', 'instance_id', 'instanceId', 'projectRef', 'project_ref'] as const;
export const ENG_PHASE_KEYS = ['phase', '阶段', '阶段号'] as const;
/** V2-05 / UTO-ALLOC-01：模块定位键（仓段化 module 维度；兼容 module_id / moduleId） */
export const ENG_MODULE_KEYS = ['module', 'module_id', 'moduleId', '模块', '模块id', '模块名', '仓段', '舱段'] as const;
export const ENG_REASON_KEYS = ['reason', '理由', '原因'] as const;

const ENG_VERB_ALIASES: Readonly<Record<string, EngOrderVerb>> = {
  分配: '指派',
  allocate: '指派',
  assign: '指派',
  指派模块: '指派',
  模块指派: '指派',
  分配模块: '指派',
  模块分配: '指派',
  assignmodule: '指派',
  assign_module: '指派',
  allocatemodule: '指派',
  allocate_module: '指派',
  立项工程: '立项',
  工程立项: '立项',
  启动: '立项',
  启动工程: '立项',
  注资模块: '注资',
  模块注资: '注资',
  注资阶段: '注资',
  阶段注资: '注资',
  暂停模块: '暂停',
  模块暂停: '暂停',
  暂停工程: '暂停',
  恢复模块: '恢复',
  模块恢复: '恢复',
  恢复工程: '恢复',
  工程恢复: '恢复',
  继续: '恢复',
  继续施工: '恢复',
  施工继续: '恢复',
  继续工程: '恢复',
  工程继续: '恢复',
  继续模块: '恢复',
  模块继续: '恢复',
  重新启动: '恢复',
  复工: '恢复',
  恢复施工: '恢复',
  停工: '暂停',
  暂停施工: '暂停',
  取消工程: '取消',
  工程取消: '取消',
  驳回工程: '驳回',
};

const ENG_ACTION_DISPATCH_KEYS = ['操作', '动作', '指令', 'verb', 'action', 'op'] as const;

function resolveEngVerb(rawKey: unknown): EngOrderVerb | undefined {
  const c = canon(rawKey);
  if (!c) return undefined;
  return ENG_VERBS.find(v => canon(v) === c) ?? ENG_VERB_ALIASES[c];
}

/**
 * 归一化 <工程> 块顶层载荷（BUG-LIVE-07）：
 * - 若顶层已是普通对象，当其存在形如 `{ 立项: "工程名", 基地: "基地名" }` 的同级简写键值时，
 *   将同级非动词附属字段合入动词载荷对象；
 * - 若顶层是 YAML 数组（如 `- 立项: 布拉德利现代化改装工程\n  基地: 恶土前哨主基地` 或 `- 立项:\n    名称: ...`），
 *   当所有元素均为对象且包含可识别的工程动词时，归并为标准 `{ [verb]: [...] }` 映射；
 *   若数组为空或含标量元素（如 `['立项', '注资']`），返回 null 交由上层按非键值映射整块隔离。
 */
export function normalizeEngBlockPayload(parsed: unknown): Record<string, unknown> | null {
  if (Array.isArray(parsed)) {
    if (parsed.length === 0 || parsed.some(item => !isUsable(item) || Array.isArray(item))) {
      return null;
    }
    const grouped: Record<string, unknown[]> = {};
    const pendingUnknownItems: Array<{ key: string; payload: unknown }> = [];
    let recognizedAny = false;
    for (const rawItem of parsed) {
      const item = rawItem as Record<string, unknown>;
      const entries = Object.entries(item);
      const verbEntry = entries.find(([k]) => resolveEngVerb(k) !== undefined);
      if (verbEntry) {
        const [vKey, vVal] = verbEntry;
        const verb = resolveEngVerb(vKey)!;
        const rest: Record<string, unknown> = {};
        for (const [k, val] of entries) {
          if (k !== vKey) rest[k] = val;
        }
        const hasRest = Object.keys(rest).length > 0;
        if (isUsable(vVal) && !Array.isArray(vVal)) {
          (grouped[verb] ??= []).push(hasRest ? { ...rest, ...(vVal as Record<string, unknown>) } : vVal);
        } else if (Array.isArray(vVal)) {
          for (const sub of vVal) {
            if (isUsable(sub) && !Array.isArray(sub) && hasRest) {
              (grouped[verb] ??= []).push({ ...rest, ...(sub as Record<string, unknown>) });
            } else {
              (grouped[verb] ??= []).push(sub);
            }
          }
        } else if ((typeof vVal === 'string' || typeof vVal === 'number') && String(vVal).trim() !== '') {
          const targetField = verb === '立项' ? 'name' : 'id';
          (grouped[verb] ??= []).push({ [targetField]: String(vVal).trim(), ...rest });
        } else {
          (grouped[verb] ??= []).push(vVal);
        }
        recognizedAny = true;
        continue;
      }

      const actionEntry = entries.find(([k]) => ENG_ACTION_DISPATCH_KEYS.some(ak => canon(ak) === canon(k)));
      if (actionEntry) {
        const verb = resolveEngVerb(actionEntry[1]);
        const rest: Record<string, unknown> = {};
        for (const [k, val] of entries) {
          if (k !== actionEntry[0]) rest[k] = val;
        }
        if (verb) {
          (grouped[verb] ??= []).push(rest);
          recognizedAny = true;
        } else {
          const rawActionKey = String(actionEntry[1] ?? '').trim() || actionEntry[0];
          pendingUnknownItems.push({ key: rawActionKey, payload: rest });
        }
        continue;
      }

      pendingUnknownItems.push({ key: entries[0]?.[0] ?? '未知工程项', payload: item });
    }
    if (!recognizedAny) return null;
    for (const u of pendingUnknownItems) {
      (grouped[u.key] ??= []).push(u.payload);
    }
    return grouped;
  }

  if (!isUsable(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const entries = Object.entries(obj);
  const verbEntries = entries.filter(([k]) => resolveEngVerb(k) !== undefined);
  const nonVerbEntries = entries.filter(([k]) => resolveEngVerb(k) === undefined);
  if (
    verbEntries.length === 1 &&
    nonVerbEntries.length > 0 &&
    (typeof verbEntries[0][1] === 'string' || typeof verbEntries[0][1] === 'number') &&
    String(verbEntries[0][1]).trim() !== ''
  ) {
    const [vKey, vVal] = verbEntries[0];
    const verb = resolveEngVerb(vKey)!;
    const rest = Object.fromEntries(nonVerbEntries);
    const targetField = verb === '立项' ? 'name' : 'id';
    return {
      [verb]: [{ [targetField]: String(vVal).trim(), ...rest }],
    };
  }
  if (verbEntries.length === 0) {
    const actionEntry = entries.find(([k]) => ENG_ACTION_DISPATCH_KEYS.some(ak => canon(ak) === canon(k)));
    if (actionEntry) {
      const verb = resolveEngVerb(actionEntry[1]);
      if (verb) {
        const rest: Record<string, unknown> = {};
        for (const [k, val] of entries) {
          if (k !== actionEntry[0]) rest[k] = val;
        }
        return { [verb]: [rest] };
      }
    }
  }
  return obj;
}

/** 工程令载荷隔离（fail-closed：畸形/缺字段/歧义载荷绝不动账本） */
export function quarantineEngElement(
  ctx: ParseCtxLike,
  path: string,
  source: unknown,
  error: string,
  suggestion?: string,
): void {
  ctx.quarantine.push({
    scope: 'element',
    tag: '工程',
    path,
    raw: JSON.stringify(source),
    error,
    ...(suggestion !== undefined ? { suggestion } : {}),
  });
}

/**
 * 实例标识双通道（DIR-9 D-R9-b）：proj:* 实例 id 直通（存在性由引擎裁决 not_found）；
 * 工程名 canon 唯一匹配归一为实例 id；多义 → null（调用方隔离）；零命中原样携带（引擎拒 not_found）。
 */
export function resolveEngInstanceId(data: StatData, raw: string): { id: string } | null {
  const trimmed = raw.trim();
  if (/^proj:/i.test(trimmed)) return { id: trimmed };
  const projects = (data.projects ?? []) as readonly { id?: unknown; ref?: unknown }[];
  const hits = projects.filter(p => canon(p.ref) === canon(trimmed));
  if (hits.length > 1) return null;
  if (hits.length === 1) return { id: String(hits[0].id ?? '').trim() || trimmed };
  return { id: trimmed };
}

/**
 * <工程> 块 → EngOrder 收集槽（CTRL-ENG-PROTO-01；V2-05 增 module 维度；UTO-ALLOC-01 增 指派 动词）：
 * 块内容为 YAML 键值映射，顶层键＝动词（立项/注资/暂停/恢复/取消/驳回/指派），值＝载荷对象或载荷数组；
 * 只构造不执行（账本零写入、不计 appliedCount，对齐调度令/部署令收集槽先例）；
 * 畸形/缺字段/歧义 → 元素级隔离 fail-closed；未知顶层键归 leftovers 纪律。
 * module 键（V2-05 / UTO-ALLOC-01）：注资/暂停/恢复/指派合法定位维度（与 phase 互斥）；立项/取消不认（出现即整令隔离）。
 */
export function collectEngOrders(w: Record<string, unknown>, data: StatData, ctx: EngParseCtxLike): void {
  const consumed = new Set<string>();
  for (const [key, value] of Object.entries(w)) {
    const verb = ENG_VERBS.find(v => canon(v) === canon(key)) ?? ENG_VERB_ALIASES[canon(key)];
    if (!verb) continue; // 未知键不消费，归块尾 leftovers 隔离
    consumed.add(key);
    const path = `工程.${verb}`;
    const isScalarShorthandAllowed =
      Array.isArray(value) &&
      (verb === '暂停' || verb === '恢复' || verb === '取消' || verb === '注资');
    for (const rawElement of asArray(value)) {
      const element =
        isScalarShorthandAllowed &&
        (typeof rawElement === 'string' || typeof rawElement === 'number') &&
        String(rawElement).trim() !== ''
          ? { id: String(rawElement).trim() }
          : rawElement;
      if (!isUsable(element) || Array.isArray(element)) {
        quarantineEngElement(
          ctx,
          path,
          element,
          `工程令「${verb}」载荷非对象（应为 {…} 键值映射）`,
          '示例：注资: {id: proj:xxx, phase: 1}',
        );
        continue;
      }
      const source = element as Record<string, unknown>;
      const index = keyIndex(source);
      const elemConsumed = new Set<string>();
      const takeField = (aliases: readonly string[]): unknown => {
        for (const alias of aliases) {
          const k = index.get(canon(alias));
          if (k !== undefined) {
            elemConsumed.add(k);
            return source[k];
          }
        }
        return undefined;
      };

      if (verb === '立项') {
        const name = String(takeField(ENG_NAME_KEYS) ?? '').trim();
        const baseText = String(takeField(ENG_BASE_KEYS) ?? '').trim();
        // V2-05：立项不认 module 键（工程级操作；出现即整令隔离，防模块粒度意图被误当工程级执行）
        if (takeField(ENG_MODULE_KEYS) !== undefined) {
          quarantineEngElement(
            ctx,
            path,
            source,
            '立项令不认 module 键（立项是工程级操作，模块在注资/暂停/恢复令上定位）',
            '示例：立项: {name: <工程名>, base: <牵头基地>}；仓段化工程立项后由系统注资首个根模块，后续模块用 注资: {id, module: <模块>}',
          );
          continue;
        }
        if (!name || !baseText) {
          quarantineEngElement(
            ctx,
            path,
            source,
            '立项令缺必填字段（name/base）',
            '示例：立项: {name: <工程名>, base: <牵头基地>}',
          );
          continue;
        }
        const aligned = applyAlign(name, ctx, `工程.立项[${name}]`, 'tech');
        const resolvedBase = resolveBaseReference(data.bases as RuntimeBaseLike[], baseText);
        if (resolvedBase.status === 'ambiguous') {
          quarantineEngElement(ctx, path, source, `立项令基地引用「${baseText}」不唯一，请改用 Base.id`);
          continue;
        }
        // 不可解析基地引用原样携带（宽进严出：引擎侧 id/name 双通道再匹配，失败由容量门拒收留痕）
        const order: EngOrder = {
          verb,
          name: aligned,
          base: resolvedBase.status === 'resolved' ? resolvedBase.baseId : baseText,
        };
        quarantineLeftovers(source, elemConsumed, ctx, `工程.立项[${aligned}]`);
        ctx.engOrders.push(order);
        green(ctx, {
          layer: 'instruction',
          path: 'projects',
          message: `工程令「立项」→「${order.name}」@ ${order.base} 已解析，由接缝结转 projectEngine.startProject（解析层不动账本）`,
        });
        continue;
      }

      if (verb === '驳回') {
        const idText = String(takeField(ENG_ID_KEYS) ?? takeField(ENG_NAME_KEYS) ?? '').trim();
        const reason = String(takeField(ENG_REASON_KEYS) ?? '').trim();
        if (!reason) {
          quarantineEngElement(
            ctx,
            path,
            source,
            '驳回令缺叙事理由（reason 必填，DIR-9 D-R9-d）',
            '示例：驳回: {id: proj:xxx, reason: 预算不足}',
          );
          continue;
        }
        const order: EngOrder = { verb, reason };
        if (idText) {
          const resolved = resolveEngInstanceId(data, idText);
          if (resolved === null) {
            quarantineEngElement(ctx, path, source, `驳回令工程名「${idText}」匹配多个实例，请改用 proj:* 实例 id`);
            continue;
          }
          order.id = resolved.id;
        }
        quarantineLeftovers(source, elemConsumed, ctx, '工程.驳回');
        ctx.engOrders.push(order);
        green(ctx, {
          layer: 'instruction',
          path: 'projects',
          message: `工程令「驳回」${order.id !== undefined ? `→「${order.id}」` : ''}已解析（理由：${reason}；账本不动，仅登记回执）`,
        });
        continue;
      }

      if (verb === '指派') {
        // UTO-ALLOC-01：跨基地模块指派，解析工程实例（instance_id/projectRef/id/name）、模块名（module_id/module）与目标承建基地（base/target_base）
        const rawIdField = takeField(ENG_ID_KEYS) ?? takeField(ENG_NAME_KEYS);
        const idText = String(rawIdField ?? '').trim();
        if (!idText) {
          quarantineEngElement(
            ctx,
            path,
            source,
            '工程令「指派」缺实例定位（id / instance_id / projectRef 必填）',
            '示例：指派: {id: proj:xxx, module: <模块>, base: <目标承建基地>}',
          );
          continue;
        }
        const resolved = resolveEngInstanceId(data, idText);
        if (resolved === null) {
          quarantineEngElement(
            ctx,
            path,
            source,
            `工程令「指派」工程名「${idText}」匹配多个实例，请改用 proj:* 实例 id（歧义违令进隔离区）`,
          );
          continue;
        }
        if (takeField(ENG_PHASE_KEYS) !== undefined) {
          quarantineEngElement(
            ctx,
            path,
            source,
            '指派令不认 phase 键（跨基地承建指派仅适用于仓段化工程模块 module）',
          );
          continue;
        }
        const moduleRaw = takeField(ENG_MODULE_KEYS);
        const moduleText = moduleRaw === undefined ? '' : String(moduleRaw).trim();
        if (!moduleText) {
          quarantineEngElement(
            ctx,
            path,
            source,
            '指派令缺模块定位（module / module_id 必填，应为模块 id 或模块名非空字符串）',
            '示例：指派: {id: proj:xxx, module: <模块>, base: <目标承建基地>}',
          );
          continue;
        }
        const baseRaw = takeField(ENG_ASSIGN_BASE_KEYS);
        const baseText = baseRaw === undefined ? '' : String(baseRaw).trim();
        if (!baseText) {
          quarantineEngElement(
            ctx,
            path,
            source,
            '指派令缺目标承建基地（base / target_base 必填）',
            '示例：指派: {id: proj:xxx, module: <模块>, base: <目标承建基地>}',
          );
          continue;
        }
        const resolvedBase = resolveBaseReference(data.bases as RuntimeBaseLike[], baseText);
        if (resolvedBase.status === 'ambiguous') {
          quarantineEngElement(ctx, path, source, `指派令基地引用「${baseText}」不唯一，请改用 Base.id`);
          continue;
        }
        const reasonRaw = takeField(ENG_REASON_KEYS);
        const reasonText = reasonRaw === undefined ? '' : String(reasonRaw).trim();
        const order: EngOrder = {
          verb: '指派',
          id: resolved.id,
          module: moduleText,
          base: resolvedBase.status === 'resolved' ? resolvedBase.baseId : baseText,
          ...(reasonText ? { reason: reasonText } : {}),
        };
        quarantineLeftovers(source, elemConsumed, ctx, `工程.指派[${order.id}]`);
        ctx.engOrders.push(order);
        green(ctx, {
          layer: 'instruction',
          path: 'projects',
          message: `工程令「指派」→「${order.id}」模块「${order.module}」@ ${order.base} 已解析，由接缝结转 projectEngine.assignModuleBase（解析层不动账本）`,
        });
        continue;
      }

      // 注资 / 暂停 / 恢复 / 取消：实例定位必填（兼容 ENG_NAME_KEYS 工程名兜底）
      const idText = String(takeField(ENG_ID_KEYS) ?? takeField(ENG_NAME_KEYS) ?? '').trim();
      if (!idText) {
        quarantineEngElement(
          ctx,
          path,
          source,
          `工程令「${verb}」缺实例定位（id 必填）`,
          '实例 id 形如 proj:<工程名>@<基地>，或写唯一工程名兜底',
        );
        continue;
      }
      const resolved = resolveEngInstanceId(data, idText);
      if (resolved === null) {
        quarantineEngElement(
          ctx,
          path,
          source,
          `工程令「${verb}」工程名「${idText}」匹配多个实例，请改用 proj:* 实例 id（歧义违令进隔离区）`,
        );
        continue;
      }
      const order: EngOrder = { verb, id: resolved.id };
      // V2-05：module 键收集（字符串，模块 id 或模块名原样携带；接缝按实例版本分流解析）
      const moduleRaw = takeField(ENG_MODULE_KEYS);
      const moduleText = moduleRaw === undefined ? '' : String(moduleRaw).trim();
      if (verb === '取消') {
        // 取消恒工程级：不认 module 键（V2-05；模块级取消不存在，出现即整令隔离）
        if (moduleRaw !== undefined) {
          quarantineEngElement(
            ctx,
            path,
            source,
            '取消令不认 module 键（取消是工程级操作；模块级停工请用 暂停: {id, module: <模块>}）',
          );
          continue;
        }
      } else if (moduleRaw !== undefined && moduleText === '') {
        // module 键在场但空值：模块粒度意图明确却无法定位，fail-closed 整令隔离
        quarantineEngElement(ctx, path, source, `工程令「${verb}」module 键为空（应为模块 id 或模块名非空字符串）`);
        continue;
      } else if (moduleText !== '') {
        order.module = moduleText;
      }
      if (verb === '注资') {
        const baseRaw = takeField(ENG_BASE_KEYS);
        const baseText = baseRaw === undefined ? '' : String(baseRaw).trim();
        if (baseText) {
          const resolvedBase = resolveBaseReference(data.bases as RuntimeBaseLike[], baseText);
          if (resolvedBase.status === 'ambiguous') {
            quarantineEngElement(ctx, path, source, `注资令基地引用「${baseText}」不唯一，请改用 Base.id`);
            continue;
          }
          order.base = resolvedBase.status === 'resolved' ? resolvedBase.baseId : baseText;
        }
        const phaseRaw = takeField(ENG_PHASE_KEYS);
        // V2-05：phase 与 module 互斥（V1 线性阶段 vs V2 仓段模块；同现即整令隔离）
        if (phaseRaw !== undefined && moduleRaw !== undefined) {
          quarantineEngElement(
            ctx,
            path,
            source,
            '注资令同时携带 phase 与 module（两者互斥：V1 线性工程用 phase，V2 仓段化工程用 module，只能取一）',
          );
          continue;
        }
        if (moduleRaw === undefined && phaseRaw !== undefined) {
          // 显式携带 phase 时校验非负整数；若 phase 与 module 均省略，结转至 engOrderBridge 自动推导（BUG-LIVE-20a）
          const phaseNum = String(phaseRaw ?? '').trim() === '' ? null : toNum(phaseRaw);
          if (phaseNum === null || !Number.isInteger(phaseNum) || phaseNum < 0) {
            quarantineEngElement(
              ctx,
              path,
              source,
              `注资令阶段号非法（应为 ≥0 整数，ProjectPhase.idx 口径），收到 ${JSON.stringify(phaseRaw)}`,
            );
            continue;
          }
          order.phase = phaseNum;
        }
      }
      quarantineLeftovers(source, elemConsumed, ctx, `工程.${verb}[${order.id}]`);
      ctx.engOrders.push(order);
      green(ctx, {
        layer: 'instruction',
        path: 'projects',
        message:
          `工程令「${verb}」→「${order.id}」` +
          `${order.phase !== undefined ? ` 阶段 #${order.phase}` : ''}` +
          `${order.module !== undefined ? ` 模块「${order.module}」` : ''}` +
          ' 已解析，由接缝结转 projectEngine（解析层不动账本）',
      });
    }
  }
  quarantineLeftovers(w, consumed, ctx, '工程');
}
