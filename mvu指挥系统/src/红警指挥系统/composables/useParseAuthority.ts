import { buildEntityCredibilityIndex, type EntityCredibilityIndex } from '../core/entityCredibility';
import type { AuthorityInput, QuarantineItem } from '../parse/parsePipeline';
import { tav, type CheckIssue } from '../parse/systemCheck';
import { chatBookGateway } from '../worldbook/chatBookBinding';

export const FALLBACK_ROSTER_MARK = '机娘阵容与社会外壳总览';

export function ensureChatBookGatewayMethods(): void {
  const gw = chatBookGateway as unknown as Record<string, unknown>;
  if (typeof gw.getChatWorldbookName !== 'function') {
    gw.getChatWorldbookName = (target = 'current') =>
      tav<(t: string) => string | null>('getChatWorldbookName')?.(target) ?? null;
  }
  if (typeof gw.getWorldbookNames !== 'function') {
    gw.getWorldbookNames = () => tav<() => string[]>('getWorldbookNames')?.() ?? [];
  }
  if (typeof gw.getWorldbook !== 'function') {
    gw.getWorldbook = async (name: string) =>
      (await tav<(n: string) => Promise<unknown[]>>('getWorldbook')?.(name)) ?? [];
  }
  if (typeof gw.updateWorldbookWith !== 'function') {
    gw.updateWorldbookWith = async (name: string, updater: (entries: unknown[]) => unknown[]) => {
      const fn = tav<(n: string, u: (entries: unknown[]) => unknown[]) => Promise<unknown>>('updateWorldbookWith');
      if (fn) await fn(name, updater);
    };
  }
  if (typeof gw.getCurrentCharacterName !== 'function') {
    gw.getCurrentCharacterName = () =>
      tav<() => string>('getCurrentCharacterName')?.() ??
      ((globalThis as Record<string, any>).SillyTavern?.name2 as string | undefined) ??
      '未命名角色';
  }
  if (typeof gw.createWorldbook !== 'function') {
    gw.createWorldbook = async (name: string, entries: unknown[]) => {
      const fn = tav<(n: string, e: unknown[]) => Promise<unknown>>('createWorldbook');
      if (fn) await fn(name, entries);
    };
  }
  if (typeof gw.rebindChatWorldbook !== 'function') {
    gw.rebindChatWorldbook = async (target: string, name: string) => {
      const fn = tav<(t: string, n: string) => Promise<unknown>>('rebindChatWorldbook');
      if (fn) await fn(target, name);
    };
  }
}
ensureChatBookGatewayMethods();

/* ═══════════════ 纯函数（可独立测试） ═══════════════ */

/** FNV-1a 32bit 文本 hash（幂等指纹，轻量自写不引依赖） */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** 基线扫描的单楼视图（由注入的 reader 提供，便于纯函数测试） */
export interface FloorView {
  role: string;
  is_hidden: boolean;
  /** 本楼 message 变量中的 stat_data；无则 undefined */
  stat_data: unknown;
  has_stat_data: boolean;
}

/**
 * 从 fromId 楼向下（递减到 0）扫第一个"AI 楼且含 stat_data"的楼作基线。
 * 跳过：user 楼 / 隐藏楼 / 无 stat_data 楼 / reader 读取失败的楼。
 * 全扫不到 → undefined（parseMessageText 会落归零基线）。
 */
export function scanBaseline(
  fromId: number,
  readFloor: (id: number) => FloorView | null,
): { stat_data: unknown; message_id: number } | undefined {
  for (let i = fromId; i >= 0; i--) {
    const f = readFloor(i);
    if (!f) continue;
    if (f.role === 'user' || f.is_hidden || !f.has_stat_data) continue;
    return { stat_data: f.stat_data, message_id: i };
  }
  return undefined;
}

const VOCAB_TAGS = ['战况', '态势', '选项', '图鉴', '初始状态', '工程'];

/** 编辑后提交：若玩家文本不含已知 tag，则按隔离项 tag（非词表时兜底〈战况〉）包裹后走同管道 */
export function wrapFixText(text: string, tag?: string): string {
  if (/[<\uFF1C]\s*\/?\s*(战况|态势|选项|图鉴|初始状态|工程)/.test(text)) return text;
  const t = tag && VOCAB_TAGS.includes(tag) ? tag : '战况';
  return `<${t}>\n${text}\n</${t}>`;
}

/* ═══════════════ 酒馆 API 薄封装（tav 探测降级） ═══════════════ */

export interface MsgLike {
  message_id: number;
  role: string;
  is_hidden: boolean;
  message: string;
  /** TH getChatMessages 兼容字段：当前 swipe 页号（缺省按 0 计） */
  swipe_id?: number;
}
export type GetChatMessages = (id: number | string) => MsgLike[];
export type GetVariables = (o: { type: string; message_id?: number }) => Record<string, unknown>;
export type UpdateVariablesWith = (
  updater: (v: Record<string, unknown>) => Record<string, unknown>,
  o: { type: string; message_id?: number },
) => Promise<unknown>;

export function apis() {
  const gcm = tav<GetChatMessages>('getChatMessages');
  const gv = tav<GetVariables>('getVariables');
  const uvw = tav<UpdateVariablesWith>('updateVariablesWith');
  if (!gcm || !gv || !uvw) return null;
  return { gcm, gv, uvw };
}

/** 真机 reader：getChatMessages + getVariables → FloorView（异常楼返回 null 跳过） */
export function readFloorLive(gcm: GetChatMessages, gv: GetVariables): (id: number) => FloorView | null {
  return (id: number) => {
    try {
      const msg = gcm(id)[0];
      if (!msg) return null;
      const vars = gv({ type: 'message', message_id: id });
      let statData = _.get(vars, 'stat_data');
      let hasStatData = _.has(vars, 'stat_data');
      if (id === 0) {
        try {
          const chatVars = gv({ type: 'chat' });
          const hydrated = hydrateZeroFloorFromBoot(statData, chatVars);
          statData = hydrated.stat_data;
          hasStatData = hydrated.has_stat_data;
        } catch {
          /* ignore chat var read error */
        }
      }
      return {
        role: msg.role,
        is_hidden: msg.is_hidden,
        stat_data: statData,
        has_stat_data: hasStatData,
      };
    } catch {
      return null;
    }
  };
}

/**
 * #0 楼开局基线自愈兜底：
 * 当 #0 楼 stat_data 曾被旧版 runParseFor(0) 的 scanBaseline(-1) 归零树洗白（credits=0 / tech.done=[]），
 * 而 chat 域变量 $boot.confirmed === true 仍保有开局设定快照（choices.effective）时，
 * 在尚未产生任何建造/排产消费的初态下自动将开局资金与初始科技回填至 #0 楼基线。
 */
export function hydrateZeroFloorFromBoot(
  statData: unknown,
  chatVars: Record<string, unknown> | null | undefined,
): { stat_data: unknown; has_stat_data: boolean } {
  const hasOriginal = statData !== undefined && statData !== null && _.isPlainObject(statData);
  if (!chatVars || !_.isPlainObject(chatVars)) {
    return { stat_data: statData, has_stat_data: hasOriginal };
  }
  const rawBoot = chatVars['$boot'];
  if (!_.isPlainObject(rawBoot)) {
    return { stat_data: statData, has_stat_data: hasOriginal };
  }
  const boot = rawBoot as Record<string, unknown>;
  if (boot.confirmed !== true || !_.isPlainObject(boot.choices)) {
    return { stat_data: statData, has_stat_data: hasOriginal };
  }
  const choices = boot.choices as Record<string, unknown>;
  const eff = _.isPlainObject(choices.effective) ? (choices.effective as Record<string, unknown>) : null;

  const bootCredits =
    typeof eff?.credits === 'number' && Number.isFinite(eff.credits) && eff.credits >= 0
      ? eff.credits
      : typeof choices.customCredits === 'number' && Number.isFinite(choices.customCredits) && choices.customCredits >= 0
        ? choices.customCredits
        : null;
  const rawTechList = Array.isArray(eff?.techDone)
    ? eff.techDone
    : Array.isArray(choices.customTech)
      ? choices.customTech
      : [];
  const bootTechDone = rawTechList
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map(t => t.trim());
  const bootWorldId = typeof choices.worldId === 'string' && choices.worldId.trim() ? choices.worldId.trim() : '';

  if (!hasOriginal) {
    if (bootCredits === null && bootTechDone.length === 0 && !bootWorldId) {
      return { stat_data: statData, has_stat_data: false };
    }
    const seeded: Record<string, unknown> = {
      economy: { credits: bootCredits ?? 0, credits_daily: 0 },
      tech: { done: [...new Set(bootTechDone)] },
      ...(bootWorldId ? { meta: { world_id: bootWorldId } } : {}),
    };
    return { stat_data: seeded, has_stat_data: true };
  }

  const sd = statData as Record<string, unknown>;
  const queuesEmpty = !Array.isArray(sd.queues) || sd.queues.length === 0;
  const noBuildings =
    !Array.isArray(sd.bases) ||
    sd.bases.every(
      b => !_.isPlainObject(b) || !Array.isArray((b as Record<string, unknown>).buildings) || ((b as Record<string, unknown>).buildings as unknown[]).length === 0,
    );
  if (!queuesEmpty || !noBuildings) {
    return { stat_data: statData, has_stat_data: true };
  }

  const eco = _.isPlainObject(sd.economy) ? (sd.economy as Record<string, unknown>) : {};
  const curCredits = typeof eco.credits === 'number' ? eco.credits : 0;
  const needCreditsRestore = bootCredits !== null && bootCredits > 0 && curCredits === 0;

  const techObj = _.isPlainObject(sd.tech) ? (sd.tech as Record<string, unknown>) : {};
  const curDone = Array.isArray(techObj.done)
    ? techObj.done.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    : [];
  const missingTechs = bootTechDone.filter(t => !curDone.includes(t));
  const needTechRestore = missingTechs.length > 0;

  const metaObj = _.isPlainObject(sd.meta) ? (sd.meta as Record<string, unknown>) : {};
  const curWorldId = typeof metaObj.world_id === 'string' ? metaObj.world_id.trim() : '';
  const needWorldRestore = Boolean(bootWorldId && !curWorldId);

  if (!needCreditsRestore && !needTechRestore && !needWorldRestore) {
    return { stat_data: statData, has_stat_data: true };
  }

  const cloned = structuredClone(sd);
  if (needCreditsRestore && bootCredits !== null) {
    const nextEco = _.isPlainObject(cloned.economy) ? (cloned.economy as Record<string, unknown>) : {};
    nextEco.credits = bootCredits;
    cloned.economy = nextEco;
  }
  if (needTechRestore) {
    const nextTech = _.isPlainObject(cloned.tech) ? (cloned.tech as Record<string, unknown>) : {};
    nextTech.done = [...curDone, ...missingTechs];
    cloned.tech = nextTech;
  }
  if (needWorldRestore) {
    const nextMeta = _.isPlainObject(cloned.meta) ? (cloned.meta as Record<string, unknown>) : {};
    nextMeta.world_id = bootWorldId;
    cloned.meta = nextMeta;
  }
  return { stat_data: cloned, has_stat_data: true };
}

/* ═══════════════ $parse 留痕（逐字仿 $archive 记帐段：读改写合并 + await） ═══════════════ */

/**
 * $parse 形状自愈（真机踩坑）：lodash 对数字型字符串路径键（如 done['2']）会把容器**创建成稀疏数组**而非对象，
 * JSON 持久化往返后空洞变 null；下游 isPlainObject 判定/遗历 .length 全部遭殃。
 * 读写两侧统一过此函数归一成纯对象（丢 null/空项）；写入时整棵重建，存量损坏形态自动修复。
 * aliases 等未知键透传（批 C 预留）。
 */
export function normalizeParseRoot(p: unknown): {
  done: Record<string, { hash: string; swipe_id?: number }>;
  log: unknown[];
  quarantine: Record<string, QuarantineItem[]>;
  /** CTRL-F1-OBS-01：按楼留档的告警（R26 等 CheckIssue），键为 message_id 字符串 */
  issues: Record<string, CheckIssue[]>;
  [k: string]: unknown;
} {
  const src = _.isObject(p) ? (p as Record<string, unknown>) : {};
  const done: Record<string, { hash: string; swipe_id?: number }> = {};
  const dSrc = src.done;
  if (Array.isArray(dSrc) || _.isPlainObject(dSrc)) {
    for (const [k, v] of Object.entries(dSrc as object)) {
      const hash = (v as { hash?: unknown } | null)?.hash;
      if (typeof hash !== 'string') continue;
      // CTRL-FLOOR-HEAL-01 方案甲③：done 键升级 per-swipe；旧格式无 swipe_id 原样保留（惰性迁移，读取侧视为不匹配）
      const sid = (v as { swipe_id?: unknown } | null)?.swipe_id;
      done[k] = typeof sid === 'number' && Number.isInteger(sid) ? { hash, swipe_id: sid } : { hash };
    }
  }
  const quarantine: Record<string, QuarantineItem[]> = {};
  const qSrc = src.quarantine;
  if (Array.isArray(qSrc) || _.isPlainObject(qSrc)) {
    for (const [k, v] of Object.entries(qSrc as object)) {
      if (Array.isArray(v) && v.length) quarantine[k] = v as QuarantineItem[];
    }
  }
  // CTRL-F1-OBS-01：issues 按 quarantine 同体例归一（稀疏数组/空洞自愈），
  // 项级加形状校验：四字段齐全的 CheckIssue 才保留（防存量脏数据污染渲染面）
  const issues: Record<string, CheckIssue[]> = {};
  const iSrc = src.issues;
  if (Array.isArray(iSrc) || _.isPlainObject(iSrc)) {
    for (const [k, v] of Object.entries(iSrc as object)) {
      if (!Array.isArray(v)) continue;
      const list = (v as unknown[]).filter(
        (it): it is CheckIssue =>
          _.isPlainObject(it) &&
          typeof (it as CheckIssue).rule === 'string' &&
          ['error', 'warn', 'info'].includes((it as CheckIssue).level) &&
          typeof (it as CheckIssue).target === 'string' &&
          typeof (it as CheckIssue).message === 'string',
      );
      if (list.length) issues[k] = list;
    }
  }
  // 批 C：读侧不强制裁汰——超帽存量档在恢复面（loadIssues）仍可见，由写侧 persistParse 滚动收敛（防误伤存量档）
  const out: ReturnType<typeof normalizeParseRoot> = {
    ..._.omit(src, ['done', 'log', 'quarantine', 'issues']),
    done,
    log: Array.isArray(src.log) ? src.log : [],
    quarantine,
    issues,
  };
  return out;
}

/* ═══════════════ 权威名单 + 别名记忆（批 C） ═══════════════ */

/** $parse.aliases 归一读取（变体名→权威名，丢非字符串项） */
export function readAliases(p: ReturnType<typeof normalizeParseRoot>): Record<string, string> {
  const out: Record<string, string> = {};
  const a = p.aliases;
  if (_.isPlainObject(a)) {
    for (const [k, v] of Object.entries(a as Record<string, unknown>)) {
      if (k.trim() && typeof v === 'string' && v.trim()) out[k.trim()] = v.trim();
    }
  }
  return out;
}

/** 世界书条目名模块级缓存（async 源；失败降级空数组；UI 可 refreshAuthorityBooks 手动刷新） */
let bookNamesCache: string[] | null = null;

/** 重拉角色卡绑定世界书的条目名（读法仿 systemCheck.checkWorldbooks） */
export async function refreshAuthorityBooks(): Promise<string[]> {
  const getNames = tav<(target?: string) => { primary: string | null; additional: string[] }>('getCharWorldbookNames');
  const getBook = tav<(n: string) => Promise<{ name: string }[]>>('getWorldbook');
  if (!getNames || !getBook) {
    bookNamesCache = [];
    return bookNamesCache;
  }
  try {
    const cw = getNames('current');
    const bound = [cw.primary, ...cw.additional].filter((x): x is string => !!x);
    const names: string[] = [];
    for (const bookName of bound) {
      try {
        for (const e of await getBook(bookName)) {
          const rawName = String(e?.name ?? '').trim();
          if (!rawName) continue;
          if (/^(?:00|99)\s*[·.、．-]/.test(rawName) || /总纲|校验回执/.test(rawName)) continue;
          const stripped = rawName.replace(/^\d+\s*[·.、．-]\s*/, '').trim();
          if (stripped) names.push(stripped);
        }
      } catch {
        /* 单书拉取失败跳过（R10 归体检管） */
      }
    }
    bookNamesCache = names;
  } catch {
    bookNamesCache = [];
  }
  return bookNamesCache;
}

/** 从 stat_data 形状中提 codex 名（baseline 传入 buildAuthority 用；容错任意形状） */
export function codexNamesOf(sd: unknown): string[] {
  const arr = _.get(sd, 'codex');
  if (!Array.isArray(arr)) return [];
  return (arr as unknown[]).map((c: unknown) => String(_.get(c, 'name') ?? '').trim()).filter((n: string) => !!n);
}

/**
 * 组装权威名单（FD-27 世界书 SSOT 收口）：
 * 1. 先调用 `ensureWorldbookCatalogLoaded()` 预热世界书 `<数据>` 块目录（全局 + 角色 + 聊天世界书）；
 * 2. 从 `effectiveCatalogSnapshot()` 获取完整世界书六大域（researches / buildings / productions / retrofits / projects / protocols）
 *    的所有标准名与 `aliases`；
 * 3. 基于纯世界书系统目录（不含 extraNames / codex 动态自创项）构建 `credibilityIndex`；
 * 4. 叠加 extraNames（baseline codex 名）、pinia codex 兜底、世界书条目标题与 `$parse.aliases`。
 * 任一源失败单独降级，不阻断解析。
 */
export async function buildAuthority(
  extraNames: string[] = [],
  preloadedCatalog?: import('../core/catalogEffective').EffectiveCatalog | null,
): Promise<AuthorityInput> {
  const names = new Set<string>();
  for (const n of extraNames) if (n && n.trim()) names.add(n.trim());
  /** 世界书全六大域条目的 alias → 标准显示名 映射（在 $parse.aliases 之前兜底，不覆盖驾驶员手维护别名） */
  const wbAliasMap: Record<string, string> = {};
  let systemCatalog: import('../core/catalogEffective').EffectiveCatalog | null = null;

  // 世界书 SSOT 动态目录 + DLC overlay：不依赖 pinia，mount 前的后台解析也能预热拿到完整世界书 `<数据>` 目录
  try {
    let catalog = preloadedCatalog ?? null;
    if (!catalog) {
      const { ensureWorldbookCatalogLoaded, effectiveCatalogSnapshot } = await import('./useCatalog');
      await ensureWorldbookCatalogLoaded();
      catalog = effectiveCatalogSnapshot();
    }
    systemCatalog = catalog;

    for (const f of catalog.factionDefs ?? []) {
      if (f?.faction && f.faction.trim()) names.add(f.faction.trim());
    }

    const allDomains: ReadonlyArray<readonly { name?: string; aliases?: unknown }[]> = [
      catalog.researches ?? [],
      catalog.buildings ?? [],
      catalog.productions ?? [],
      catalog.retrofits ?? [],
      catalog.projects ?? [],
      catalog.protocols ?? [],
    ];
    for (const domainItems of allDomains) {
      for (const item of domainItems) {
        const itemName = typeof item?.name === 'string' ? item.name.trim() : '';
        if (!itemName) continue;
        names.add(itemName);
        const list = item.aliases;
        if (!Array.isArray(list)) continue;
        for (const raw of list) {
          if (typeof raw !== 'string' || !raw.trim()) continue;
          const alias = raw.trim();
          names.add(alias);
          if (!(alias in wbAliasMap)) wbAliasMap[alias] = itemName;
        }
      }
    }
  } catch {
    /* 模块加载异常：降级 */
  }
  // codex 兜底：pinia 就绪时补当前楼（UI 别名校验等场景）；解析场景已由 extraNames 覆盖
  // 注意：codex 动态项仅加入 names 列表，绝不混入 systemCatalog / credibilityIndex！
  try {
    const { useDataStore } = await import('./store');
    for (const c of useDataStore().data.codex) {
      if (c?.name && c.name.trim()) names.add(c.name.trim());
    }
  } catch {
    /* mount 前正常降级：baseline codex 已从 extraNames 进入 */
  }
  if (bookNamesCache === null) await refreshAuthorityBooks();
  for (const n of bookNamesCache ?? []) names.add(n);

  let aliases: Record<string, string> = { ...wbAliasMap };
  const gv = tav<GetVariables>('getVariables');
  if (gv) {
    try {
      const chat = await gv({ type: 'chat' });
      // $parse.aliases（驾驶员/运行时手维护）优先于世界书别名映射
      aliases = { ...wbAliasMap, ...readAliases(normalizeParseRoot(_.get(chat, '$parse'))) };
    } catch {
      /* 降级：保留世界书别名映射 */
    }
  }

  const credibilityIndex: EntityCredibilityIndex = buildEntityCredibilityIndex(systemCatalog, aliases);

  return {
    names: [...names].filter(n => !!n && !!n.trim()),
    aliases,
    credibilityIndex,
  };
}

/** 读当前别名词典（UI 展示用；预览/异常返回空） */
export async function loadAliases(): Promise<Record<string, string>> {
  const gv = tav<GetVariables>('getVariables');
  if (!gv) return {};
  try {
    return readAliases(normalizeParseRoot(_.get(await gv({ type: 'chat' }), '$parse')));
  } catch {
    return {};
  }
}

/** 写入别名（变体名→权威名）；normalizeParseRoot 惯例：读改写 + 整棵 set + await */
export async function addAlias(variant: string, canonical: string): Promise<boolean> {
  const uvw = tav<UpdateVariablesWith>('updateVariablesWith');
  const v0 = variant.trim();
  const c0 = canonical.trim();
  if (!uvw || !v0 || !c0) return false;
  await uvw(
    v => {
      const p = normalizeParseRoot(_.get(v, '$parse'));
      const aliases = readAliases(p);
      aliases[v0] = c0;
      p.aliases = aliases;
      _.set(v, '$parse', p); // '$parse' 非数字键，整棵 set 安全；绝不用动态键路径直写
      return v;
    },
    { type: 'chat' },
  );
  return true;
}

/** 删除别名（可逆低危，单击即删） */
export async function removeAlias(variant: string): Promise<boolean> {
  const uvw = tav<UpdateVariablesWith>('updateVariablesWith');
  if (!uvw) return false;
  await uvw(
    v => {
      const p = normalizeParseRoot(_.get(v, '$parse'));
      const aliases = readAliases(p);
      delete aliases[variant.trim()];
      p.aliases = aliases;
      _.set(v, '$parse', p);
      return v;
    },
    { type: 'chat' },
  );
  return true;
}
