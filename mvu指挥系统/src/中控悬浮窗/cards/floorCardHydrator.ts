/**
 * floorCardHydrator.ts —— 双轨楼层卡片水合器 (CMD-CARD-01 & PKG-C)
 *
 * 职责：
 * 1. 扫描宿主聊天区或虚拟列表提交节点中的 `.tw-floor-card-host, .custom-tw-floor-card-host` 占位容器；
 * 2. 提取 `<script type="text/plain" class="tw-raw-payload">` 原始载荷（或经 `mesid` 回退从 `getChatMessages(mesid)` / `chat[mesid]` 提取）并执行安全解析与颜色白名单消毒；
 * 3. 单份 DOM 挂载（`mountHostCard`）：直接在宿主容器内挂载 1 份 `.tw-floor-card-mount` 子树并标记 `data-tw-hydrated="true"` 保证严格幂等；
 * 4. 双轨自动路由 `installFloorCardHydrator(targetDoc?, options?)`：
 *    - 当 `ttHostBridge.isChatSurfaceManaged()` 为 `true` 时：仅注册 TauriTavern `ChatSurfaceParticipantV1`（`id: 'tavernweave/floor-cards'`），绝不启动 `MutationObserver`；
 *    - 当为 `false`（传统 SillyTavern）时：执行首次扫描并启动批次去重合并的 `MutationObserver`。
 */
import { stripThinking } from '../../红警指挥系统/parse/floorSanitize';
import { indexFloorProtocols, type FloorProtocolTag } from '../../红警指挥系统/parse/floorProtocolIndex';
import { SYSTEM_TAVERN_REGEX_REGISTRY } from '../../红警指挥系统/worldbook/tavernRegexPipeline';
import { getHostDocument } from '../host/modalHost';
import {
  getTauriTavernBridge,
  isChatSurfaceManaged,
  ttHostBridge,
  type TauriTavernChatSurfaceApi,
} from '../host/ttHostBridge';
import { nowPerfMs, recordPerfSample } from '../models/perfMonitor';
import {
  buildChronoStepCardDom,
  buildCodexEntryCardDom,
  buildDataPatchCardDom,
  buildDeploymentOrderCardDom,
  buildEconomyChainsCardDom,
  buildEngineeringOrderCardDom,
  buildExpansionDossierCardDom,
  buildIntelDossierCardDom,
  buildProductionScheduleCardDom,
  buildTacticalEventCardDom,
  buildTacticalIntelCardDom,
  buildTacticalOptionsCardDom,
  buildWorldEvolutionCardDom,
  getWorldEvolutionFloorMode,
  mountWorldEvolutionStealthHost,
  buildTacticalQuestCardDom,
  buildTacticalSituationCardDom,
} from './floorCardExtraMounts';
import {
  parseChronoStepPayload,
  parseCodexPayload,
  parseDataPatchPayload,
  parseDeploymentOrderPayload,
  parseEconomyChainsPayload,
  parseEngineeringOrderPayload,
  parseExpansionDossierPayload,
  parseIntelDossierPayload,
  parseProductionSchedulePayload,
  parseTacticalEventPayload,
  parseTacticalIntelPayload,
  parseTacticalOptionsPayload,
  parseTacticalQuestPayload,
  parseTacticalSituationPayload,
  parseWorldEvolutionPayload,
} from './floorCardExtraParsers';
import {
  buildAerospaceContractCardDom,
  buildFactionUnlockCardDom,
  buildMaidenDossierCardDom,
  buildMaidenStatusCardDom,
  buildSpaceContractCardDom,
} from './floorCardMounts';
import {
  parseAerospaceContractPayload,
  parseFactionUnlockPayload,
  parseMaidenDossierPayload,
  parseMaidenStatusPayload,
  parseSpaceContractPayload,
} from './floorCardParsers';
import {
  buildDarknetTerminalCardDom,
  parseDarknetTerminalPayload,
} from './floorCardDarknet';
import {
  buildStorySummaryCardDom,
  parseStorySummaryPayload,
} from './floorCardSummary';
import {
  createFloorCardChatSurfaceParticipant,
  FLOOR_CARD_PARTICIPANT_ID,
  FLOOR_CARD_PARTICIPANT_PROTOCOL_VERSION,
  installChatSurfaceCardParticipant,
  type FloorCardChatSurfaceParticipantOptions,
} from './ttChatSurfaceParticipant';

export * from './floorCardParsers';
export * from './floorCardMounts';
export * from './floorCardExtraParsers';
export * from './floorCardExtraMounts';
export * from './floorCardDarknet';
export * from './floorCardSummary';
export {
  createFloorCardChatSurfaceParticipant,
  FLOOR_CARD_PARTICIPANT_ID,
  FLOOR_CARD_PARTICIPANT_PROTOCOL_VERSION,
  installChatSurfaceCardParticipant,
  type FloorCardChatSurfaceParticipantOptions,
};

export interface FloorCardHydrateContext {
  mesid?: number;
  mesElement?: HTMLElement | null;
}

export interface FloorCardHydratorOptions extends FloorCardChatSurfaceParticipantOptions {
  /** 显式传入 ChatSurface API 实例（用于单测或扩展入口注入） */
  chatSurface?: TauriTavernChatSurfaceApi | null;
  /** 是否在传统模式下使用 requestAnimationFrame 跨帧合并 Mutation 批次（默认 false 以保持同步确定性） */
  coalesceWithRaf?: boolean;
}

const FLOOR_CARD_UNHYDRATED_SELECTOR =
  '.tw-floor-card-host:not([data-tw-hydrated="true"]), .custom-tw-floor-card-host:not([data-tw-hydrated="true"])';

const FLOOR_CARD_HOST_SELECTORS = [
  '.tw-floor-card-host',
  '.custom-tw-floor-card-host',
] as const;

const CARD_TYPE_TAG_MAP: Readonly<Record<string, RegExp>> = {
  'faction-unlock': /(?<![`'"（(、，])<阵营解锁>(?![`'"）)、，])\s*((?:(?!<阵营解锁>)[\s\S])*?)\s*<\/阵营解锁>(?![`'"])/gi,
  'space-contract':
    /(?<![`'"（(、，])<(?:航天合同|航天|发射中心)(?:\s+[^>]*)?>(?![`'"）)、，])\s*((?:(?!<(?:航天合同|航天|发射中心)[>\s])[\s\S])*?)\s*<\/(?:航天合同|航天|发射中心)>(?![`'"])/gi,
  'aerospace-contract':
    /(?<![`'"（(、，])<(?:航天合同|航天|发射中心)(?:\s+[^>]*)?>(?![`'"）)、，])\s*((?:(?!<(?:航天合同|航天|发射中心)[>\s])[\s\S])*?)\s*<\/(?:航天合同|航天|发射中心)>(?![`'"])/gi,
  'maiden-dossier': /(?<![`'"（(、，])<机娘档案>(?![`'"）)、，])\s*((?:(?!<机娘档案>)[\s\S])*?)\s*<\/机娘档案>(?![`'"])/gi,
  'maiden-status': /(?<![`'"（(、，])<机娘>(?![`'"）)、，])\s*((?:(?!<机娘>)[\s\S])*?)\s*<\/机娘>(?![`'"])/gi,
  'codex-entry': /(?<![`'"（(、，])<图鉴>(?![`'"）)、，])\s*((?:(?!<图鉴>)[\s\S])*?)\s*<\/图鉴>(?![`'"])/gi,
  'tactical-event': /(?<![`'"（(、，])<事件>(?![`'"）)、，])\s*((?:(?!<事件>)[\s\S])*?)\s*<\/事件>(?![`'"])/gi,
  'engineering-order': /(?<![`'"（(、，])<工程>(?![`'"）)、，])\s*((?:(?!<工程>)[\s\S])*?)\s*<\/工程>(?![`'"])/gi,
  'production-schedule':
    /(?<![`'"（(、，])<(?:排产计划|生产)(?:\s+[^>]*)?>(?![`'"）)、，])\s*((?:(?!<(?:排产计划|生产)[>\s])[\s\S])*?)\s*<\/(?:排产计划|生产)>(?![`'"])/gi,
  'deployment-order':
    /(?<![`'"（(、，])<(?:部署|展开|deploy)(?:\s+[^>]*)?>(?![`'"）)、，])\s*((?:(?!<(?:部署|展开|deploy)[>\s])[\s\S])*?)\s*<\/(?:部署|展开|deploy)>(?![`'"])/gi,
  'economy-chains':
    /(?<![`'"（(、，])<资金链(?:\s+[^>]*)?>(?![`'"）)、，])\s*((?:(?!<资金链[>\s])[\s\S])*?)\s*<\/资金链>(?![`'"])/gi,
  'intel-dossier': /(?<![`'"（(、，])<扩展档案>(?![`'"）)、，])\s*((?:(?!<扩展档案>)[\s\S])*?)\s*<\/扩展档案>(?![`'"])/gi,
  'expansion-dossier': /(?<![`'"（(、，])<扩展档案>(?![`'"）)、，])\s*((?:(?!<扩展档案>)[\s\S])*?)\s*<\/扩展档案>(?![`'"])/gi,
  'data-patch': /(?<![`'"（(、，])<数据更新>(?![`'"）)、，])\s*((?:(?!<数据更新>)[\s\S])*?)\s*<\/数据更新>(?![`'"])/gi,
  'chrono-step': /(?:^|(?<=[\r\n>]))[ \t]*<timePast>\s*((?:(?!<timePast>)[\s\S])*?)\s*<\/timePast>[ \t]*(?=$|[\r\n<])/gi,
  'darknet-terminal': /(?<![`'"（(、，])<暗网>(?![`'"）)、，])\s*((?:(?!<暗网>)[\s\S])*?)\s*<\/暗网>(?![`'"])/gi,
  'story-summary':
    /(?<![`'"（(、，])<(?:(?:摘要|中摘要|大摘要)(?=\s|>)[^>]*|(?<!<details[^>]*>\s*)summary)>(?![`'"）)、，])\s*((?:(?!<(?:摘要|中摘要|大摘要|summary)[>\s])[\s\S])*?)\s*<\/(?:摘要|summary|中摘要|大摘要)>(?![`'"])/gi,
  'tactical-situation':
    /(?<![`'"（(、，])<(?:态势|初始状态|战况|战区态势|环境态势)(?:\s+[^>]*)?>(?![`'"）)、，])\s*((?:(?!<(?:态势|初始状态|战况|战区态势|环境态势)[>\s])[\s\S])*?)\s*<\/(?:态势|初始状态|战况|战区态势|环境态势)>(?![`'"])/gi,
  'tactical-options': /(?<![`'"（(、，])<选项>(?![`'"）)、，])\s*((?:(?!<选项>)[\s\S])*?)\s*<\/选项>(?![`'"])/gi,
  'tactical-quest': /(?<![`'"（(、，])<任务>(?![`'"）)、，])\s*((?:(?!<任务>)[\s\S])*?)\s*<\/任务>(?![`'"])/gi,
  'tactical-intel': /((?<![`'"（(、，])<情报>(?![`'"）)、，])(?:(?!<情报>)[\s\S])*?<\/情报>(?![`'"]))/gi,
  'world-evolution-stealth': /((?<![`'"（(、，])<世界演变>(?![`'"）)、，])(?:(?!<世界演变>)[\s\S])*?<\/世界演变>(?![`'"]))/gi,
};

function isFloorCardHostElement(el: HTMLElement | null | undefined): boolean {
  if (!el || typeof el !== 'object') return false;
  if (el.tagName?.toLowerCase() === 'iframe') return false;
  if (typeof el.matches === 'function') {
    try {
      if (FLOOR_CARD_HOST_SELECTORS.some(sel => el.matches(sel))) {
        return true;
      }
    } catch {
      /* fallback to className check */
    }
  }
  const cls = typeof el.className === 'string' ? el.className.split(/\s+/) : [];
  return cls.includes('tw-floor-card-host') || cls.includes('custom-tw-floor-card-host');
}

/**
 * 收集指定根节点下的全部楼层卡片宿主元素（兼容标准 DOM 与单测轻量 MockDOM）
 */
export function collectFloorCardHosts(
  root: ParentNode | HTMLElement | null | undefined,
): HTMLElement[] {
  if (!root || typeof root !== 'object') return [];
  const results: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  const maybeEl = root as HTMLElement;
  if (isFloorCardHostElement(maybeEl)) {
    seen.add(maybeEl);
    results.push(maybeEl);
  }

  if (typeof root.querySelectorAll === 'function') {
    for (const sel of FLOOR_CARD_HOST_SELECTORS) {
      let matched: ArrayLike<Element> = [];
      try {
        matched = root.querySelectorAll(sel);
      } catch {
        matched = [];
      }
      for (const item of Array.from(matched)) {
        const host = item as HTMLElement;
        if (!host || host.tagName?.toLowerCase() === 'iframe') continue;
        if (!seen.has(host)) {
          seen.add(host);
          results.push(host);
        }
      }
    }
  }

  return results;
}

function findAncestorWithMesId(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null;
  if (typeof el.closest === 'function') {
    try {
      const found = el.closest('.mes[mesid], [mesid], [data-tw-mesid]') as HTMLElement | null;
      if (found) return found;
    } catch {
      /* fallback to parentNode walk */
    }
  }
  let cur: HTMLElement | null = el;
  while (cur) {
    const attr =
      cur.getAttribute?.('mesid') ??
      cur.getAttribute?.('data-tw-mesid') ??
      cur.dataset?.twMesid;
    if (attr !== null && attr !== undefined && attr !== '') {
      return cur;
    }
    cur = (cur.parentNode as HTMLElement | null) ?? null;
  }
  return null;
}

const INDEXED_CARD_TAGS: Readonly<Record<string, readonly FloorProtocolTag[]>> = {
  'story-summary': ['摘要', 'summary', '中摘要', '大摘要'],
  'chrono-step': ['timepast'],
  'tactical-situation': ['态势'],
  'tactical-event': ['事件'],
};

interface MesPayloadCacheEntry {
  rawMsg: string;
  byType: Map<string, string[]>;
}

let activeMesPayloadCacheById: Map<number, MesPayloadCacheEntry> | null = null;

function getMesPayloadCacheById(): Map<number, MesPayloadCacheEntry> {
  if (!activeMesPayloadCacheById) {
    const map = new Map<number, MesPayloadCacheEntry>();
    activeMesPayloadCacheById = map;
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(() => {
        if (activeMesPayloadCacheById === map) {
          activeMesPayloadCacheById = null;
        }
      });
    }
  }
  return activeMesPayloadCacheById;
}

function readRawFloorMessageById(mesId: number): string {
  const g = globalThis as unknown as {
    getChatMessages?: (id: number) => Array<{ message?: string; mes?: string }>;
    TavernHelper?: {
      getChatMessages?: (id: number) => Array<{ message?: string; mes?: string }>;
    };
    parent?: {
      getChatMessages?: (id: number) => Array<{ message?: string; mes?: string }>;
      TavernHelper?: {
        getChatMessages?: (id: number) => Array<{ message?: string; mes?: string }>;
      };
      SillyTavern?: {
        getContext?: () => { chat?: Array<{ mes?: string; message?: string }> };
      };
      chat?: Array<{ mes?: string; message?: string }>;
    };
    SillyTavern?: {
      getContext?: () => { chat?: Array<{ mes?: string; message?: string }> };
    };
    chat?: Array<{ mes?: string; message?: string }>;
  };

  const getter =
    g.getChatMessages ??
    g.TavernHelper?.getChatMessages ??
    g.parent?.getChatMessages ??
    g.parent?.TavernHelper?.getChatMessages;

  if (typeof getter === 'function') {
    const msgs = getter(mesId);
    if (Array.isArray(msgs) && msgs[0]) {
      const text = String(msgs[0].message ?? msgs[0].mes ?? '');
      if (text) return text;
    }
  }

  const chatArr =
    g.SillyTavern?.getContext?.()?.chat ??
    g.parent?.SillyTavern?.getContext?.()?.chat ??
    g.chat ??
    g.parent?.chat;

  if (Array.isArray(chatArr) && chatArr[mesId]) {
    const item = chatArr[mesId];
    return String(item.mes ?? item.message ?? '');
  }

  return '';
}

function resolveMesIdAndElement(
  hostEl: HTMLElement,
  context?: FloorCardHydrateContext,
): { mesId: number; mesEl: HTMLElement | null } {
  const ancestorEl = findAncestorWithMesId(hostEl);
  const mesEl = context?.mesElement ?? ancestorEl;

  if (typeof context?.mesid === 'number' && Number.isFinite(context.mesid) && context.mesid >= 0) {
    return { mesId: context.mesid, mesEl };
  }

  const rawFromHost =
    hostEl.dataset?.twMesid ??
    hostEl.getAttribute?.('data-tw-mesid') ??
    hostEl.getAttribute?.('mesid');
  if (rawFromHost !== null && rawFromHost !== undefined && String(rawFromHost).trim() !== '') {
    const parsed = Number(rawFromHost);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return { mesId: parsed, mesEl };
    }
  }

  const rawFromMesEl =
    mesEl?.getAttribute?.('mesid') ??
    mesEl?.getAttribute?.('data-tw-mesid') ??
    mesEl?.dataset?.twMesid ??
    ancestorEl?.getAttribute?.('mesid') ??
    ancestorEl?.getAttribute?.('data-tw-mesid') ??
    ancestorEl?.dataset?.twMesid;
  if (rawFromMesEl !== null && rawFromMesEl !== undefined && String(rawFromMesEl).trim() !== '') {
    const parsed = Number(rawFromMesEl);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return { mesId: parsed, mesEl };
    }
  }

  return { mesId: -1, mesEl };
}

/**
 * 当酒馆 DOMPurify 剥离了局部正则中的 `<script class="tw-raw-payload">` 时，
 * 通过 `context.mesid`、`hostEl.dataset.twMesid` 或 `.mes[mesid]` 祖先从 `getChatMessages(mesId)` / `chat[mesId]` 原文中按同型卡片序号提取原始标签载荷。
 */
function resolvePayloadFromFloorMessage(
  hostEl: HTMLElement,
  cardType: string,
  context?: FloorCardHydrateContext,
): string {
  try {
    const { mesId, mesEl } = resolveMesIdAndElement(hostEl, context);
    if (!Number.isFinite(mesId) || mesId < 0) return '';

    const tagPattern = CARD_TYPE_TAG_MAP[cardType];
    if (!tagPattern) return '';

    const cache = getMesPayloadCacheById();
    let entry = cache.get(mesId);
    if (!entry) {
      // DOMPurify 移除载荷节点后会绕过显示正则：原文回退也必须先经过
      // 与解析管线共用的 L0 思考区清洗，否则思考中的伪标签会抢占卡片序号。
      // 仅清洗读取副本，不写回楼层，也不调用带全局/预设副作用的显示格式化。
      const rawMsg = readRawFloorMessageById(mesId);
      entry = { rawMsg, byType: new Map<string, string[]>() };
      cache.set(mesId, entry);
    }

    if (!entry.rawMsg) return '';

    const indexedTags = INDEXED_CARD_TAGS[cardType];
    if (indexedTags) {
      const indexed = indexFloorProtocols(entry.rawMsg).filter(b => indexedTags.includes(b.tag));
      if (cardType === 'story-summary') {
        if (indexed.length === 0) {
          hostEl.setAttribute?.('data-tw-payload-error', 'missing-block');
          return '';
        }
        const invalidBlock = indexed.find(b => b.status !== 'valid');
        if (invalidBlock) {
          hostEl.setAttribute?.('data-tw-payload-error', invalidBlock.status);
          return '';
        }
        const hasMidOrGrand = indexed.some(b => b.tag === '中摘要' || b.tag === '大摘要');
        if (hasMidOrGrand) {
          return indexed
            .map(b => {
              const trimmedPayload = b.payload.trim();
              if (/^\s*<(?:摘要|summary|中摘要|大摘要)\b/i.test(trimmedPayload)) {
                return trimmedPayload;
              }
              const tagName = b.tag === '中摘要' || b.tag === '大摘要' ? b.tag : '摘要';
              return `<${tagName}>\n${trimmedPayload}\n</${tagName}>`;
            })
            .join('\n\n');
        }
      }
      const siblings = mesEl && mesEl !== hostEl && typeof mesEl.querySelectorAll === 'function'
        ? Array.from(mesEl.querySelectorAll(`[data-tw-card="${cardType}"]`))
          .filter(el => el.tagName?.toLowerCase() !== 'iframe') : [hostEl];
      const position = siblings.indexOf(hostEl);
      const block = position >= 0 ? indexed[position] : undefined;
      if (!block || block.status !== 'valid') {
        hostEl.setAttribute?.('data-tw-payload-error', block?.status ?? 'missing-block');
        return '';
      }
      return block.payload;
    }

    let matches = entry.byType.get(cardType);
    if (!matches) {
      const regex = new RegExp(tagPattern.source, tagPattern.flags);
      matches = [];
      let m: RegExpExecArray | null;
      const cleanText = stripThinking(entry.rawMsg).text;
      while ((m = regex.exec(cleanText)) !== null) {
        matches.push((m[1] ?? '').trim());
      }
      entry.byType.set(cardType, matches);
    }
    if (matches.length === 0) return '';

    const scopeRoot =
      mesEl ??
      (hostEl.parentNode &&
      typeof (hostEl.parentNode as ParentNode).querySelectorAll === 'function'
        ? (hostEl.parentNode as ParentNode)
        : null);

    if (scopeRoot && typeof scopeRoot.querySelectorAll === 'function') {
      const siblings = Array.from(
        scopeRoot.querySelectorAll(`[data-tw-card="${cardType}"]`),
      ).filter(el => el.tagName?.toLowerCase() !== 'iframe');
      const idx = siblings.indexOf(hostEl);
      if (idx >= 0 && idx < matches.length) {
        return matches[idx];
      }
    }
    return matches[0];
  } catch {
    return '';
  }
}

/**
 * 水合单个 `.tw-floor-card-host` 容器：
 * - 若 `hostEl.dataset.twHydrated === 'true'` 则幂等跳过并返回 `false`；
 * - 读取 `data-tw-card`、`script.tw-raw-payload`（或 DOMPurify 清洗后的楼层原文回退）；
 * - 单份宿主挂载（`mountHostCard`）：在宿主容器内构建 1 份 `.tw-floor-card-mount` DOM，隐藏遗留 `iframe.tw-floor-card` 并标记 `data-tw-hydrated="true"`。
 */
export function hydrateFloorCardHost(
  hostEl: HTMLElement,
  context?: FloorCardHydrateContext,
): boolean {
  if (!hostEl || typeof hostEl !== 'object') return false;
  if (hostEl.tagName?.toLowerCase() === 'iframe') return false;

  if (typeof context?.mesid === 'number' && Number.isFinite(context.mesid) && context.mesid >= 0) {
    const mesidStr = String(context.mesid);
    if (hostEl.dataset) {
      hostEl.dataset.twMesid = mesidStr;
    }
    hostEl.setAttribute?.('data-tw-mesid', mesidStr);
  }

  const hydratedAttr = hostEl.dataset?.twHydrated ?? hostEl.getAttribute?.('data-tw-hydrated');
  const alreadyHydrated = hydratedAttr === 'true' || hydratedAttr === '1';
  if (alreadyHydrated) {
    return false;
  }

  const cardType =
    (
      hostEl.dataset?.twCard ??
      hostEl.getAttribute?.('data-tw-card') ??
      hostEl.dataset?.cardType ??
      hostEl.getAttribute?.('data-card-type') ??
      'faction-unlock'
    ).trim() || 'faction-unlock';
  if (!(cardType in CARD_TYPE_TAG_MAP)) {
    return false;
  }

  const scriptEl =
    (hostEl.querySelector?.('script.tw-raw-payload') as HTMLElement | null) ??
    (hostEl.querySelector?.('script.tw-floor-raw') as HTMLElement | null) ??
    (hostEl.querySelector?.('.tw-raw-payload') as HTMLElement | null) ??
    (hostEl.querySelector?.('.tw-floor-raw') as HTMLElement | null) ??
    (hostEl.querySelector?.('.custom-tw-raw-payload') as HTMLElement | null);
  let rawPayload = (
    scriptEl?.textContent ??
    hostEl.dataset?.twPayload ??
    hostEl.dataset?.twRaw ??
    hostEl.getAttribute?.('data-tw-raw') ??
    ''
  ).trim();
  if (!rawPayload) {
    rawPayload = resolvePayloadFromFloorMessage(hostEl, cardType, context);
  }
  if (hostEl.getAttribute?.('data-tw-payload-error')) {
    hostEl.textContent = '协议载荷缺失或跨区损坏，已停止渲染默认卡片；请检查本楼原文。';
    hostEl.setAttribute?.('role', 'status');
    hostEl.setAttribute?.('data-tw-hydrated', 'true');
    return true;
  }

  const ownerDoc =
    hostEl.ownerDocument ??
    getHostDocument() ??
    (typeof document !== 'undefined' ? document : null);
  if (!ownerDoc) return false;

  const iframeEl = hostEl.querySelector?.('iframe.tw-floor-card') as HTMLIFrameElement | null;

  const syncIframeHeight = () => {
    if (!iframeEl) return;
    try {
      const iframeDoc = iframeEl.contentDocument;
      const scrollHeight =
        iframeDoc?.body?.scrollHeight ?? iframeDoc?.documentElement?.scrollHeight ?? 0;
      const resolvedHeight = scrollHeight > 0 ? Math.max(scrollHeight, 38) : 220;
      iframeEl.style.height = `${resolvedHeight}px`;
    } catch {
      iframeEl.style.height = '240px';
    }
  };

  const mountHostCard = (buildForDoc: (doc: Document) => HTMLElement): boolean => {
    if (hostEl.style && typeof hostEl.style.setProperty === 'function') {
      hostEl.style.setProperty('background', 'var(--tw-theme-bg, var(--rac-bg, #070c15))');
      hostEl.style.setProperty(
        'border',
        '1px solid color-mix(in srgb, var(--tw-theme-accent, var(--rac-accent, #38bdf8)) 22%, transparent)',
      );
    }
    if (typeof ownerDoc.createElement === 'function' && typeof hostEl.appendChild === 'function') {
      if (iframeEl) {
        syncIframeHeight();
        iframeEl.style.display = 'none';
        (iframeEl as { removeAttribute?: (attr: string) => void }).removeAttribute?.('srcdoc');
      }
      const hostMount = ownerDoc.createElement('div');
      hostMount.className = 'tw-floor-card-mount';
      hostMount.setAttribute('data-test', 'floor-card-mount');
      const hostCard = buildForDoc(ownerDoc);
      hostMount.appendChild(hostCard);
      hostEl.appendChild(hostMount);
    } else if (iframeEl?.contentDocument?.body) {
      const iframeDoc = iframeEl.contentDocument;
      const hostTheme =
        ownerDoc.documentElement?.getAttribute?.('data-ra-theme') ||
        ownerDoc.body?.getAttribute?.('data-ra-theme');
      if (hostTheme) {
        iframeDoc.documentElement?.setAttribute?.('data-ra-theme', hostTheme);
        iframeDoc.body?.setAttribute?.('data-ra-theme', hostTheme);
      }
      iframeDoc.body.innerHTML = '';
      const iframeCard = buildForDoc(iframeDoc);
      iframeDoc.body.appendChild(iframeCard);
      syncIframeHeight();
    } else {
      return false;
    }

    if (hostEl.dataset) {
      hostEl.dataset.twHydrated = 'true';
    }
    hostEl.setAttribute?.('data-tw-hydrated', 'true');
    return true;
  };

  if (cardType === 'space-contract' || cardType === 'aerospace-contract') {
    const parsedSpace = parseAerospaceContractPayload(rawPayload);
    return mountHostCard(doc => buildAerospaceContractCardDom(doc, parsedSpace, syncIframeHeight));
  }

  if (cardType === 'deployment-order') {
    const parsedDeploy = parseDeploymentOrderPayload(rawPayload);
    if (!parsedDeploy) return false;
    return mountHostCard(doc => buildDeploymentOrderCardDom(doc, parsedDeploy, syncIframeHeight));
  }

  if (cardType === 'economy-chains') {
    const parsedChains = parseEconomyChainsPayload(rawPayload);
    if (!parsedChains) return false;
    return mountHostCard(doc => buildEconomyChainsCardDom(doc, parsedChains, syncIframeHeight));
  }

  if (cardType === 'maiden-dossier') {
    const parsedDossier = parseMaidenDossierPayload(rawPayload);
    if (!parsedDossier) return false;
    return mountHostCard(doc => buildMaidenDossierCardDom(doc, parsedDossier, syncIframeHeight));
  }

  if (cardType === 'maiden-status') {
    const parsedStatus = parseMaidenStatusPayload(rawPayload);
    if (!parsedStatus) return false;
    return mountHostCard(doc => buildMaidenStatusCardDom(doc, parsedStatus, syncIframeHeight));
  }

  if (cardType === 'codex-entry') {
    const parsedCodex = parseCodexPayload(rawPayload);
    if (!parsedCodex) return false;
    return mountHostCard(doc => buildCodexEntryCardDom(doc, parsedCodex, syncIframeHeight));
  }

  if (cardType === 'tactical-event') {
    const parsedEvent = parseTacticalEventPayload(rawPayload);
    if (!parsedEvent) return false;
    return mountHostCard(doc => buildTacticalEventCardDom(doc, parsedEvent, syncIframeHeight));
  }

  if (cardType === 'engineering-order') {
    const parsedEng = parseEngineeringOrderPayload(rawPayload);
    if (!parsedEng) return false;
    return mountHostCard(doc => buildEngineeringOrderCardDom(doc, parsedEng, syncIframeHeight));
  }

  if (cardType === 'production-schedule') {
    const parsedProd = parseProductionSchedulePayload(rawPayload);
    if (!parsedProd) return false;
    return mountHostCard(doc =>
      buildProductionScheduleCardDom(doc, parsedProd, syncIframeHeight),
    );
  }

  if (cardType === 'intel-dossier') {
    const parsedIntel = parseIntelDossierPayload(rawPayload);
    if (!parsedIntel) return false;
    return mountHostCard(doc => buildIntelDossierCardDom(doc, parsedIntel, syncIframeHeight));
  }

  if (cardType === 'expansion-dossier') {
    const parsedExp = parseExpansionDossierPayload(rawPayload);
    if (!parsedExp) return false;
    return mountHostCard(doc => buildExpansionDossierCardDom(doc, parsedExp, syncIframeHeight));
  }

  if (cardType === 'data-patch') {
    const parsedPatch = parseDataPatchPayload(rawPayload);
    if (!parsedPatch) return false;
    return mountHostCard(doc => buildDataPatchCardDom(doc, parsedPatch, syncIframeHeight));
  }

  if (cardType === 'chrono-step') {
    const parsedChrono = parseChronoStepPayload(rawPayload);
    if (!parsedChrono) return false;
    return mountHostCard(doc => buildChronoStepCardDom(doc, parsedChrono, syncIframeHeight));
  }

  if (cardType === 'darknet-terminal') {
    const parsedDarknet = parseDarknetTerminalPayload(rawPayload);
    if (!parsedDarknet) return false;
    return mountHostCard(doc => buildDarknetTerminalCardDom(doc, parsedDarknet, syncIframeHeight));
  }

  if (cardType === 'story-summary') {
    const { mesId, mesEl } = resolveMesIdAndElement(hostEl, context);
    const scopeContainer =
      (hostEl.closest?.('.mes_text') as HTMLElement | null) ??
      mesEl ??
      ((hostEl.parentNode as HTMLElement | null) ?? null);
    if (
      scopeContainer &&
      scopeContainer.getAttribute?.('data-tw-rescuing-bare') !== 'true'
    ) {
      scopeContainer.setAttribute?.('data-tw-rescuing-bare', 'true');
      try {
        rescueBareProtocolBlocksInDom(scopeContainer, context);
      } finally {
        scopeContainer.removeAttribute?.('data-tw-rescuing-bare');
      }
    }
    const summarySiblings =
      scopeContainer && typeof scopeContainer.querySelectorAll === 'function'
        ? (Array.from(
            scopeContainer.querySelectorAll(
              '[data-tw-card="story-summary"], [data-card-type="story-summary"]',
            ),
          ) as HTMLElement[]).filter(el => el.tagName?.toLowerCase() !== 'iframe')
        : [hostEl];
    const siblingIdx = summarySiblings.indexOf(hostEl);

    if (siblingIdx > 0) {
      const primaryHost = summarySiblings[0];
      if (rawPayload && primaryHost && primaryHost !== hostEl) {
        appendSummaryPayloadToHost(primaryHost, rawPayload, context);
      }
      if (iframeEl?.style) {
        iframeEl.style.display = 'none';
      }
      if (hostEl.style) {
        hostEl.style.display = 'none';
      }
      if (hostEl.dataset) {
        hostEl.dataset.twHydrated = 'true';
        hostEl.dataset.twMergedSummary = 'true';
      }
      hostEl.setAttribute?.('data-tw-hydrated', 'true');
      hostEl.setAttribute?.('data-tw-merged-summary', 'true');
      return true;
    }

    const wrapAsSummaryTagBlock = (segment: string, fallbackTag = '摘要'): string => {
      const s = segment.trim();
      if (!s) return '';
      const head = s.match(/^[<＜](摘要|summary|中摘要|大摘要)(\s+[^＞>]*)?[>＞]([\s\S]*)$/i);
      if (head) {
        const tName = head[1];
        const attrs = head[2] ?? '';
        const body = head[3] ?? '';
        const closeRe = new RegExp(`[<＜]\\/${tName}[>＞]\\s*$`, 'i');
        const cleanBody = closeRe.test(body) ? body.replace(closeRe, '').trim() : body.trim();
        return `<${tName}${attrs}>\n${cleanBody}\n</${tName}>`;
      }
      return `<${fallbackTag}>\n${s}\n</${fallbackTag}>`;
    };

    const stripSummaryBodyForCompare = (segment: string): string => {
      const s = segment.trim();
      if (!s) return '';
      const head = s.match(/^[<＜](摘要|summary|中摘要|大摘要)(\s+[^＞>]*)?[>＞]([\s\S]*)$/i);
      const body = head ? (head[3] ?? '') : s;
      return body
        .replace(/[<＜]\/(?:摘要|summary|中摘要|大摘要)[>＞]\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    };

    // 第一个 story-summary 宿主：当楼层原文存在 <中摘要>/<大摘要> 或同楼存在第 2+ 个摘要宿主时，合署全部摘要载荷
    if (Number.isFinite(mesId) && mesId >= 0) {
      const rawFloorText = readRawFloorMessageById(mesId);
      if (rawFloorText && /<(?:中摘要|大摘要)\b/i.test(rawFloorText)) {
        const mergedFromFloor = resolvePayloadFromFloorMessage(hostEl, 'story-summary', context);
        if (hostEl.getAttribute?.('data-tw-payload-error')) {
          hostEl.textContent = '协议载荷缺失或跨区损坏，已停止渲染默认卡片；请检查本楼原文。';
          hostEl.setAttribute?.('role', 'status');
          hostEl.setAttribute?.('data-tw-hydrated', 'true');
          return true;
        }
        if (mergedFromFloor) {
          rawPayload = mergedFromFloor;
        }
      }
    }

    for (let i = 1; i < summarySiblings.length; i++) {
      const sib = summarySiblings[i];
      const sibScript =
        (sib.querySelector?.('script.tw-raw-payload') as HTMLElement | null) ??
        (sib.querySelector?.('script.tw-floor-raw') as HTMLElement | null) ??
        (sib.querySelector?.('.tw-raw-payload') as HTMLElement | null);
      const sibRaw = (
        sibScript?.textContent ??
        sib.dataset?.twPayload ??
        sib.dataset?.twRaw ??
        sib.getAttribute?.('data-tw-raw') ??
        ''
      ).trim();
      if (sibRaw) {
        const wrappedPrimary = wrapAsSummaryTagBlock(rawPayload, '摘要');
        const wrappedSib = wrapAsSummaryTagBlock(sibRaw, '摘要');
        const normPrimary = rawPayload.replace(/\s+/g, ' ').trim();
        const normSibBody = stripSummaryBodyForCompare(sibRaw);
        if (
          normSibBody &&
          !normPrimary.includes(normSibBody) &&
          !wrappedPrimary.includes(sibRaw) &&
          !wrappedPrimary.includes(wrappedSib)
        ) {
          rawPayload = wrappedPrimary ? `${wrappedPrimary}\n\n${wrappedSib}` : wrappedSib;
        }
      }
      const sibIframe = sib.querySelector?.('iframe.tw-floor-card') as HTMLElement | null;
      if (sibIframe?.style) sibIframe.style.display = 'none';
      if (sib.style) sib.style.display = 'none';
      if (sib.dataset) {
        sib.dataset.twMergedSummary = 'true';
      }
      sib.setAttribute?.('data-tw-merged-summary', 'true');
    }

    const extraMerged = (
      hostEl.dataset?.twMergedExtraSummary ??
      hostEl.getAttribute?.('data-tw-merged-extra-summary') ??
      ''
    ).trim();
    if (extraMerged) {
      const wrappedPrimary = wrapAsSummaryTagBlock(rawPayload, '摘要');
      const wrappedExtra = wrapAsSummaryTagBlock(extraMerged, '中摘要');
      const normPrimary = rawPayload.replace(/\s+/g, ' ').trim();
      const normExtraBody = stripSummaryBodyForCompare(extraMerged);
      if (
        normExtraBody &&
        !normPrimary.includes(normExtraBody) &&
        !rawPayload.includes(extraMerged) &&
        !wrappedPrimary.includes(wrappedExtra)
      ) {
        rawPayload = wrappedPrimary ? `${wrappedPrimary}\n\n${wrappedExtra}` : wrappedExtra;
      } else if (!/^\s*<(?:摘要|summary|中摘要|大摘要)\b/i.test(rawPayload)) {
        rawPayload = wrappedPrimary;
      }
    }
    if (scriptEl && rawPayload) {
      scriptEl.textContent = rawPayload;
    }

    const parsedSummary = parseStorySummaryPayload(rawPayload);
    if (!parsedSummary) return false;

    if (Array.isArray(parsedSummary.extraSections) && parsedSummary.extraSections.length > 0) {
      const makeSectionFingerprint = (sec: {
        tier?: string;
        range?: string;
        title?: string;
        summary?: string;
      }): string =>
        `${(sec.tier ?? '').trim()}|${(sec.range ?? '').trim()}|${(sec.title ?? '').trim()}|${(sec.summary ?? '').replace(/\s+/g, ' ').trim()}`;

      const seenSectionKeys = new Set<string>([makeSectionFingerprint(parsedSummary)]);
      const dedupedExtras = parsedSummary.extraSections.filter(sec => {
        const key = makeSectionFingerprint(sec);
        if (seenSectionKeys.has(key)) return false;
        seenSectionKeys.add(key);
        return true;
      });
      parsedSummary.extraSections = dedupedExtras.length > 0 ? dedupedExtras : undefined;
    }

    return mountHostCard(doc => buildStorySummaryCardDom(doc, parsedSummary, syncIframeHeight));
  }

  if (cardType === 'tactical-situation') {
    const parsedSit = parseTacticalSituationPayload(rawPayload);
    if (!parsedSit) return false;
    return mountHostCard(doc => buildTacticalSituationCardDom(doc, parsedSit, syncIframeHeight));
  }

  if (cardType === 'tactical-options') {
    const parsedOpts = parseTacticalOptionsPayload(rawPayload);
    if (!parsedOpts) return false;
    return mountHostCard(doc => buildTacticalOptionsCardDom(doc, parsedOpts, syncIframeHeight));
  }

  if (cardType === 'tactical-quest') {
    const parsedQuest = parseTacticalQuestPayload(rawPayload);
    if (!parsedQuest) return false;
    return mountHostCard(doc => buildTacticalQuestCardDom(doc, parsedQuest, syncIframeHeight));
  }

  if (cardType === 'tactical-intel') {
    const legacyMount = hostEl.querySelector?.('.tw-floor-mount') as HTMLElement | null;
    if (legacyMount && legacyMount.style) {
      legacyMount.style.display = 'none';
    }
    const parsedIntelCard = parseTacticalIntelPayload(rawPayload);
    if (!parsedIntelCard) return false;
    return mountHostCard(doc => buildTacticalIntelCardDom(doc, parsedIntelCard, syncIframeHeight));
  }

  if (cardType === 'world-evolution-stealth') {
    const mode = getWorldEvolutionFloorMode();
    if (mode === 'visible') {
      if (hostEl.style) hostEl.style.display = '';
      if (hostEl.dataset) hostEl.dataset.rawWevo = rawPayload;
      hostEl.setAttribute?.('data-raw-wevo', rawPayload);
      const legacyMount = hostEl.querySelector?.('.tw-floor-mount') as HTMLElement | null;
      if (legacyMount && legacyMount.style) {
        legacyMount.style.display = 'none';
      }
      const parsedWevo = parseWorldEvolutionPayload(rawPayload);
      if (!parsedWevo || parsedWevo.items.length === 0) {
        if (hostEl.style) hostEl.style.display = 'none';
        if (iframeEl?.style) iframeEl.style.display = 'none';
        return false;
      }
      return mountHostCard(doc => buildWorldEvolutionCardDom(doc, parsedWevo, syncIframeHeight));
    }
    if (iframeEl) {
      if (iframeEl.style) iframeEl.style.display = 'none';
      (iframeEl as { removeAttribute?: (attr: string) => void }).removeAttribute?.('srcdoc');
    }
    const mountTarget =
      (hostEl.querySelector?.('.tw-floor-mount') as HTMLElement | null) ?? hostEl;
    const mounted = mountWorldEvolutionStealthHost(mountTarget, rawPayload, ownerDoc);
    if (hostEl.dataset) {
      hostEl.dataset.twHydrated = '1';
    }
    hostEl.setAttribute?.('data-tw-hydrated', '1');
    return mounted;
  }

  const parsed = parseFactionUnlockPayload(rawPayload);
  return mountHostCard(doc => buildFactionUnlockCardDom(doc, parsed, syncIframeHeight));
}

function measureHostCardHeight(hostEl: HTMLElement): number {
  const candidates: Array<number | undefined> = [];
  const mountEl = hostEl.querySelector?.('.tw-floor-card-mount') as HTMLElement | null;
  const firstCardEl = (mountEl?.children?.[0] as HTMLElement | undefined) ?? null;
  const iframeEl = hostEl.querySelector?.('iframe.tw-floor-card') as HTMLIFrameElement | null;

  candidates.push(
    (hostEl as { offsetHeight?: number }).offsetHeight,
    (hostEl as { scrollHeight?: number }).scrollHeight,
    (mountEl as { offsetHeight?: number } | null)?.offsetHeight,
    (mountEl as { scrollHeight?: number } | null)?.scrollHeight,
    (firstCardEl as { offsetHeight?: number } | null)?.offsetHeight,
    (firstCardEl as { scrollHeight?: number } | null)?.scrollHeight,
  );

  if (typeof hostEl.getBoundingClientRect === 'function') {
    try {
      candidates.push(hostEl.getBoundingClientRect().height);
    } catch {
      /* ignore */
    }
  }
  if (mountEl && typeof mountEl.getBoundingClientRect === 'function') {
    try {
      candidates.push(mountEl.getBoundingClientRect().height);
    } catch {
      /* ignore */
    }
  }

  if (iframeEl) {
    const styleHeight = Number.parseFloat(String(iframeEl.style?.height ?? ''));
    if (Number.isFinite(styleHeight) && styleHeight > 0) {
      candidates.push(styleHeight);
    }
    const iframeScroll =
      iframeEl.contentDocument?.body?.scrollHeight ??
      iframeEl.contentDocument?.documentElement?.scrollHeight;
    if (typeof iframeScroll === 'number' && iframeScroll > 0) {
      candidates.push(iframeScroll);
    }
  }

  const prevLastHeight = Number.parseFloat(
    String(hostEl.dataset?.twLastHeight ?? hostEl.getAttribute?.('data-tw-last-height') ?? ''),
  );
  if (Number.isFinite(prevLastHeight) && prevLastHeight > 0) {
    candidates.push(prevLastHeight);
  }

  for (const val of candidates) {
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
      return Math.round(val);
    }
  }

  const wasHydrated =
    hostEl.dataset?.twHydrated === 'true' ||
    hostEl.getAttribute?.('data-tw-hydrated') === 'true' ||
    Boolean(mountEl);
  return wasHydrated ? 38 : 0;
}

function removeElementNode(el: HTMLElement | null | undefined): void {
  if (!el) return;
  const parent = el.parentNode as (HTMLElement & { children?: unknown[] }) | null;
  if (parent && typeof parent.removeChild === 'function') {
    try {
      parent.removeChild(el);
      return;
    } catch {
      /* fallback */
    }
  }
  if (typeof el.remove === 'function') {
    try {
      el.remove();
      return;
    } catch {
      /* fallback */
    }
  }
  if (parent && Array.isArray(parent.children)) {
    const idx = parent.children.indexOf(el);
    if (idx >= 0) {
      parent.children.splice(idx, 1);
      (el as { parentNode?: unknown }).parentNode = null;
    }
  }
}

/**
 * 卸载回收单个楼层卡片宿主（供 TauriTavern `ChatSurface` 虚拟滚动滚出视口或重绘时调用）：
 * 1. 记录当前卡片高度至 `hostEl.dataset.twLastHeight` 与 `min-height`；
 * 2. 移除已挂载的 `.tw-floor-card-mount` 子树；
 * 3. 重置 `data-tw-hydrated` 属性，确保下次滚回视口 100% 可重新水合。
 */
export function dehydrateFloorCardHost(hostEl: HTMLElement): number {
  if (!hostEl || typeof hostEl !== 'object') return 0;

  const heightPx = measureHostCardHeight(hostEl);
  if (heightPx > 0) {
    const heightStr = String(heightPx);
    if (hostEl.dataset) {
      hostEl.dataset.twLastHeight = heightStr;
    }
    hostEl.setAttribute?.('data-tw-last-height', heightStr);
    if (hostEl.style) {
      hostEl.style.minHeight = `${heightPx}px`;
      hostEl.style.setProperty?.('min-height', `${heightPx}px`);
    }
  }

  if (typeof hostEl.querySelectorAll === 'function') {
    const mounts = Array.from(hostEl.querySelectorAll('.tw-floor-card-mount')) as HTMLElement[];
    for (const mount of mounts) {
      removeElementNode(mount);
    }
  }

  if (typeof hostEl.removeAttribute === 'function') {
    hostEl.removeAttribute('data-tw-hydrated');
  } else if (typeof hostEl.setAttribute === 'function') {
    hostEl.setAttribute('data-tw-hydrated', 'false');
  }
  if (hostEl.dataset) {
    try {
      hostEl.dataset.twHydrated = undefined as unknown as string;
      delete hostEl.dataset.twHydrated;
    } catch {
      /* ignore */
    }
  }

  return heightPx;
}

const BARE_PROTOCOL_TAG_MAP: Readonly<Record<string, string>> = {
  摘要: 'story-summary',
  summary: 'story-summary',
  中摘要: 'story-summary',
  大摘要: 'story-summary',
  部署: 'deployment-order',
  展开: 'deployment-order',
  deploy: 'deployment-order',
  生产: 'production-schedule',
  排产计划: 'production-schedule',
  资金链: 'economy-chains',
  发射中心: 'aerospace-contract',
  航天合同: 'aerospace-contract',
  航天: 'aerospace-contract',
  态势: 'tactical-situation',
  初始状态: 'tactical-situation',
  战况: 'tactical-situation',
  战区态势: 'tactical-situation',
  环境态势: 'tactical-situation',
  事件: 'tactical-event',
  情报: 'tactical-intel',
  世界演变: 'world-evolution-stealth',
  任务: 'tactical-quest',
  工程: 'engineering-order',
  暗网: 'darknet-terminal',
  机娘档案: 'maiden-dossier',
  机娘: 'maiden-status',
  图鉴: 'codex-entry',
  扩展档案: 'expansion-dossier',
  数据更新: 'data-patch',
  选项: 'tactical-options',
  timepast: 'chrono-step',
  阵营解锁: 'faction-unlock',
};

const BARE_TAG_NAMES_PATTERN =
  '中摘要|大摘要|摘要|summary|部署|展开|deploy|生产|资金链|发射中心|态势|初始状态|战况|战区态势|环境态势|事件|情报|战区情报|情报电讯|世界演变|世界暗流|任务|工程|排产计划|航天合同|航天|暗网|机娘档案|机娘|图鉴|扩展档案|数据更新|选项|timePast|阵营解锁';

const BARE_PROTOCOL_HEAD_RE = new RegExp(
  `^\\s*[<＜](${BARE_TAG_NAMES_PATTERN})(\\s+[^＞>]*)?[>＞]([\\s\\S]*)$`,
  'i',
);

function normalizeBareProtocolBlockText(tagName: string, rawText: string): string {
  const trimmed = rawText.trim();
  const headMatch = trimmed.match(BARE_PROTOCOL_HEAD_RE);
  const attrs = headMatch?.[2] ?? '';
  const bodyAfterOpen = headMatch ? headMatch[3] : trimmed;
  const closeRe = new RegExp(`[<＜]\\/${tagName}[>＞]\\s*$`, 'i');
  const cleanBody = closeRe.test(bodyAfterOpen)
    ? bodyAfterOpen.replace(closeRe, '').trim()
    : bodyAfterOpen.trim();
  return `<${tagName}${attrs}>\n${cleanBody}\n</${tagName}>`;
}

function isLikelyStructuredBareProtocolBody(tagName: string, bodyText: string): boolean {
  const clean = bodyText.trim();
  if (!clean) return false;
  if (tagName.toLowerCase() === 'timepast') {
    return /\d+\s*[dDhHmM天日时時分]/.test(clean);
  }
  // 包含换行符、键值冒号、YAML 列表项或方括号标签，即可确认为协议块载荷而非普通叙事句
  return /[\r\n]/.test(clean) || /[:：]/.test(clean) || /^[-*•\[]/.test(clean);
}

function insertHostBeforeElement(
  container: HTMLElement,
  newHost: HTMLElement,
  refNode: HTMLElement,
): void {
  if (typeof container.insertBefore === 'function') {
    try {
      container.insertBefore(newHost, refNode);
      return;
    } catch {
      /* fallback */
    }
  }
  const anyContainer = container as unknown as { children?: HTMLElement[] };
  if (Array.isArray(anyContainer.children)) {
    const idx = anyContainer.children.indexOf(refNode);
    if (idx >= 0) {
      (newHost as unknown as { parentNode?: HTMLElement }).parentNode = container;
      anyContainer.children.splice(idx, 0, newHost);
      return;
    }
  }
  if (typeof container.appendChild === 'function') {
    container.appendChild(newHost);
  }
}

function appendSummaryPayloadToHost(
  primaryHost: HTMLElement,
  extraPayload: string,
  context?: FloorCardHydrateContext,
): void {
  const cleanExtra = extraPayload.trim();
  if (!cleanExtra) return;

  const prevExtra = (
    primaryHost.dataset?.twMergedExtraSummary ??
    primaryHost.getAttribute?.('data-tw-merged-extra-summary') ??
    ''
  ).trim();
  const nextExtra = prevExtra
    ? prevExtra.includes(cleanExtra)
      ? prevExtra
      : `${prevExtra}\n\n${cleanExtra}`
    : cleanExtra;

  if (primaryHost.dataset) {
    primaryHost.dataset.twMergedExtraSummary = nextExtra;
  }
  primaryHost.setAttribute?.('data-tw-merged-extra-summary', nextExtra);

  const scriptEl =
    (primaryHost.querySelector?.('script.tw-raw-payload') as HTMLElement | null) ??
    (primaryHost.querySelector?.('script.tw-floor-raw') as HTMLElement | null) ??
    (primaryHost.querySelector?.('.tw-raw-payload') as HTMLElement | null);
  if (scriptEl) {
    const curScriptText = (scriptEl.textContent ?? '').trim();
    const wrappedCur =
      curScriptText && !/^\s*<(?:摘要|summary|中摘要|大摘要)\b/i.test(curScriptText)
        ? `<摘要>\n${curScriptText}\n</摘要>`
        : curScriptText;
    if (!wrappedCur.includes(cleanExtra)) {
      scriptEl.textContent = wrappedCur ? `${wrappedCur}\n\n${cleanExtra}` : cleanExtra;
    } else if (wrappedCur !== curScriptText) {
      scriptEl.textContent = wrappedCur;
    }
  }

  const wasHydrated =
    primaryHost.dataset?.twHydrated === 'true' ||
    primaryHost.getAttribute?.('data-tw-hydrated') === 'true';
  if (wasHydrated) {
    dehydrateFloorCardHost(primaryHost);
    hydrateFloorCardHost(primaryHost, context);
  }
}

/**
 * 通用裸协议标签 DOM 兜底水合（Bare Protocol Tag Rescue）：
 * 扫描 `.mes_text` 子元素，将残留的 `<p>&lt;部署&gt;...</p>`、`<p>&lt;中摘要&gt; 范围: 82-100 ...</p>` 等
 * 以顶层协议开标签开头的裸块（兼容末尾有 `</Tag>` 闭标签或闭标签已被 DOMPurify 剥离两种真机形态）
 * 原地转换为楼层卡片宿主，或隐藏并合署进同楼的 `story-summary` 主卡片。
 * 严守边界：普通叙事段落（非以 `<Tag>` 开头）100% 跳过，绝不误伤正文。
 */
export function rescueBareProtocolBlocksInDom(
  root: ParentNode,
  context?: FloorCardHydrateContext,
): number {
  if (!root || typeof root !== 'object') return 0;
  let rescued = 0;

  try {
    const containers: HTMLElement[] = [];
    const seenContainers = new Set<HTMLElement>();
    const addContainer = (el: HTMLElement | null | undefined) => {
      if (!el || typeof el !== 'object' || seenContainers.has(el)) return;
      seenContainers.add(el);
      containers.push(el);
    };

    const rootEl = root as HTMLElement;
    if (typeof rootEl.className === 'string' && rootEl.className.includes('mes_text')) {
      addContainer(rootEl);
    }
    if (typeof root.querySelectorAll === 'function') {
      try {
        const mesTexts = Array.from(root.querySelectorAll('.mes_text')) as HTMLElement[];
        for (const mt of mesTexts) addContainer(mt);
      } catch {
        /* ignore selector fallback */
      }
    }
    if (containers.length === 0) {
      const fallbackBody = (root as Document).body ?? rootEl;
      if (fallbackBody) addContainer(fallbackBody);
    }

    for (const container of containers) {
      const ownerDoc =
        container.ownerDocument ??
        getHostDocument() ??
        (typeof document !== 'undefined' ? document : null);
      if (!ownerDoc || typeof ownerDoc.createElement !== 'function') continue;

      const children = Array.from(
        (container as unknown as { children?: HTMLElement[] }).children ?? [],
      ) as HTMLElement[];
      let i = 0;

      while (i < children.length) {
        const cur = children[i];
        if (!cur || isFloorCardHostElement(cur)) {
          i += 1;
          continue;
        }
        const curTag = cur.tagName?.toLowerCase() ?? '';
        if (curTag !== 'p' && curTag !== 'div' && curTag !== 'pre') {
          i += 1;
          continue;
        }
        if (
          cur.style?.display === 'none' ||
          cur.getAttribute?.('data-tw-merged-summary') === 'true' ||
          cur.getAttribute?.('data-tw-rescued-bare') === 'true'
        ) {
          i += 1;
          continue;
        }

        const txt = (cur.textContent ?? '').trim();
        if (!txt.startsWith('<') && !txt.startsWith('＜')) {
          i += 1;
          continue;
        }

        const headMatch = txt.match(BARE_PROTOCOL_HEAD_RE);
        if (!headMatch) {
          i += 1;
          continue;
        }

        const candidateTag = headMatch[1];
        const bodyAfterOpen = (headMatch[3] ?? '').trim();

        // 若是孤立 <选项> 后跟 <ul> 且无闭标签，交由 hydrateBareOptionsBlocks 处理
        if (
          candidateTag === '选项' &&
          !bodyAfterOpen &&
          children[i + 1]?.tagName?.toLowerCase() === 'ul'
        ) {
          i += 1;
          continue;
        }

        const closeRe = new RegExp(`[<＜]\\/${candidateTag}[>＞]\\s*$`, 'i');
        let matchedTag = '';
        let fullBlockText = '';
        let nodesToHide: HTMLElement[] = [];

        if (closeRe.test(txt)) {
          // 情况 1：单元素内部自带 </Tag> 闭标签
          matchedTag = candidateTag;
          fullBlockText = normalizeBareProtocolBlockText(candidateTag, txt);
          nodesToHide = [cur];
        } else {
          // 情况 2：向后扫描兄弟节点寻找 </Tag> 闭标签
          const runNodes: HTMLElement[] = [cur];
          const runTexts: string[] = [txt];
          let foundClose = false;
          const maxLookahead = Math.min(children.length, i + 12);

          for (let j = i + 1; j < maxLookahead; j++) {
            const sib = children[j];
            if (!sib || isFloorCardHostElement(sib)) break;
            const sibTxt = (sib.textContent ?? '').trim();
            // 若遇到下一个独立协议开标签，停止向后寻找闭标签
            if (BARE_PROTOCOL_HEAD_RE.test(sibTxt)) break;
            runNodes.push(sib);
            runTexts.push(sibTxt);
            if (closeRe.test(sibTxt)) {
              foundClose = true;
              break;
            }
          }

          if (foundClose) {
            matchedTag = candidateTag;
            fullBlockText = normalizeBareProtocolBlockText(candidateTag, runTexts.join('\n'));
            nodesToHide = runNodes;
          } else if (isLikelyStructuredBareProtocolBody(candidateTag, bodyAfterOpen)) {
            // 情况 3（真机核心场景）：DOMPurify 剥离了末尾 </Tag> 闭标签，协议键值内容就在当前 <p> 内
            const stripCloseNodes: HTMLElement[] = [cur];
            const stripCloseTexts: string[] = [txt];
            const nextSib = children[i + 1];
            const nextSibTag = nextSib?.tagName?.toLowerCase() ?? '';
            if (
              nextSib &&
              !isFloorCardHostElement(nextSib) &&
              (nextSibTag === 'ul' || nextSibTag === 'ol')
            ) {
              stripCloseNodes.push(nextSib);
              stripCloseTexts.push((nextSib.textContent ?? '').trim());
            }
            matchedTag = candidateTag;
            fullBlockText = normalizeBareProtocolBlockText(
              candidateTag,
              stripCloseTexts.join('\n'),
            );
            nodesToHide = stripCloseNodes;
          } else if (!bodyAfterOpen && children[i + 1] && !isFloorCardHostElement(children[i + 1])) {
            // 情况 4：<p>&lt;中摘要&gt;</p> 独占一行，协议正文在紧随其后的下一个兄弟节点，且末尾闭标签被 DOMPurify 剥离
            const nextSib = children[i + 1];
            const nextSibTxt = (nextSib.textContent ?? '').trim();
            if (
              !BARE_PROTOCOL_HEAD_RE.test(nextSibTxt) &&
              isLikelyStructuredBareProtocolBody(candidateTag, nextSibTxt)
            ) {
              matchedTag = candidateTag;
              fullBlockText = normalizeBareProtocolBlockText(
                candidateTag,
                `${txt}\n${nextSibTxt}`,
              );
              nodesToHide = [cur, nextSib];
            }
          }
        }

        if (!matchedTag || nodesToHide.length === 0) {
          i += 1;
          continue;
        }

        const cardType =
          BARE_PROTOCOL_TAG_MAP[matchedTag.toLowerCase()] ??
          (matchedTag === '战区情报' || matchedTag === '情报电讯'
            ? 'tactical-intel'
            : matchedTag === '世界暗流'
              ? 'world-evolution-stealth'
              : undefined);
        if (!cardType) {
          i += 1;
          continue;
        }

        if (cardType === 'story-summary') {
          const existingSummaryHosts = collectFloorCardHosts(container).filter(h => {
            const ct = (
              h.dataset?.twCard ??
              h.getAttribute?.('data-tw-card') ??
              h.dataset?.cardType ??
              h.getAttribute?.('data-card-type') ??
              ''
            ).trim();
            return ct === 'story-summary';
          });

          if (existingSummaryHosts.length > 0) {
            for (const n of nodesToHide) {
              if (n.style) n.style.display = 'none';
              if (n.dataset) n.dataset.twMergedSummary = 'true';
              n.setAttribute?.('data-tw-merged-summary', 'true');
            }
            appendSummaryPayloadToHost(existingSummaryHosts[0], fullBlockText, context);
            rescued += 1;
            i += nodesToHide.length;
            continue;
          }
        }

        const newHost = ownerDoc.createElement('div');
        newHost.className = 'custom-tw-floor-card-host';
        newHost.setAttribute?.('data-tw-card', cardType);
        if (newHost.dataset) {
          newHost.dataset.twCard = cardType;
        }
        const scriptEl = ownerDoc.createElement('script');
        scriptEl.type = 'text/plain';
        scriptEl.className = 'tw-raw-payload';
        scriptEl.textContent = fullBlockText;
        newHost.appendChild(scriptEl);

        insertHostBeforeElement(container, newHost, nodesToHide[0]);
        for (const n of nodesToHide) {
          if (n.style) n.style.display = 'none';
          if (n.dataset) n.dataset.twRescuedBare = 'true';
          n.setAttribute?.('data-tw-rescued-bare', 'true');
        }
        rescued += 1;
        i += nodesToHide.length;
      }
    }
  } catch {
    /* ignore bare protocol rescue errors */
  }

  return rescued;
}

function hydrateBareOptionsBlocks(root: ParentNode): number {
  if (!root || typeof root.querySelectorAll !== 'function') return 0;
  let hydrated = 0;
  try {
    const paragraphs = Array.from(root.querySelectorAll('.mes_text > p, p')) as HTMLElement[];
    for (const p of paragraphs) {
      const txt = (p.textContent ?? '').trim();
      if (txt === '<选项>' || txt === '＜选项＞') {
        const nextEl = p.nextElementSibling as HTMLElement | null;
        if (nextEl && nextEl.tagName?.toLowerCase() === 'ul' && !nextEl.dataset?.twOptionsHydrated) {
          nextEl.dataset.twOptionsHydrated = 'true';
          p.style.display = 'none';
          const ownerDoc = p.ownerDocument ?? document;
          const lis = Array.from(nextEl.querySelectorAll('li')) as HTMLElement[];
          const parsedOpts: Array<{ text: string; tag: string; cost: string }> = [];
          for (const li of lis) {
            const rawLines = (li.innerText || li.textContent || '')
              .split(/\r?\n/)
              .map(l => l.trim())
              .filter(Boolean);
            let optText = '';
            let optTag = '';
            let optCost = '';
            for (const line of rawLines) {
              const m = line.match(/^(文本|内容|描述|行动|标记|标签|类型|代价|消耗|成本|text|tag|cost)[:：]\s*(.*)$/i);
              if (!m) {
                if (!optText) optText = line;
                continue;
              }
              const k = m[1].toLowerCase();
              const v = m[2].trim();
              if (k === '文本' || k === '内容' || k === '描述' || k === '行动' || k === 'text') optText = v;
              else if (k === '标记' || k === '标签' || k === '类型' || k === 'tag') optTag = v;
              else if (k === '代价' || k === '消耗' || k === '成本' || k === 'cost') optCost = v;
            }
            if (optText) parsedOpts.push({ text: optText, tag: optTag, cost: optCost });
          }
          if (parsedOpts.length > 0 && typeof ownerDoc.createElement === 'function') {
            const box = ownerDoc.createElement('div');
            box.className = 'tw-floor-options-box';
            box.setAttribute('data-test', 'tw-floor-options-box');
            box.style.cssText =
              'margin:10px 0 4px;padding:10px 12px;background:var(--tw-theme-bg,var(--rac-bg,#070c15));border:1px solid color-mix(in srgb,var(--tw-theme-accent,var(--rac-accent,#38bdf8)) 22%,transparent);border-radius:6px;font-family:monospace,sans-serif;';
            const header = ownerDoc.createElement('div');
            header.style.cssText =
              'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;font-size:10.5px;color:var(--tw-theme-accent,var(--rac-accent,#38bdf8));letter-spacing:0.08em;';
            header.innerHTML = '<span>TACTICAL OPTIONS // 战术决策行动选项</span><span style="color:#64748b;font-size:9.5px;">点击填入行动指令</span>';
            box.appendChild(header);

            parsedOpts.forEach((opt, idx) => {
              const btn = ownerDoc.createElement('button');
              btn.type = 'button';
              btn.style.cssText =
                'display:grid;grid-template-columns:22px 1fr auto;align-items:center;gap:8px;width:100%;text-align:left;padding:7px 10px;margin-top:5px;background:color-mix(in srgb,var(--tw-theme-panel,var(--rac-panel-bg,#0f172a)) 80%,#050811);border:1px solid color-mix(in srgb,var(--tw-theme-accent,var(--rac-accent,#38bdf8)) 18%,transparent);border-radius:4px;color:#e2e8f0;cursor:pointer;font-size:12px;';
              const numSpan = ownerDoc.createElement('span');
              numSpan.style.cssText = 'color:var(--tw-theme-accent,var(--rac-accent,#38bdf8));font-weight:bold;font-size:11px;';
              numSpan.textContent = String(idx + 1);
              const mainSpan = ownerDoc.createElement('span');
              const txtSpan = ownerDoc.createElement('span');
              txtSpan.style.cssText = 'display:block;color:#e2e8f0;line-height:1.45;';
              txtSpan.textContent = opt.text;
              mainSpan.appendChild(txtSpan);
              if (opt.cost) {
                const costSpan = ownerDoc.createElement('span');
                costSpan.style.cssText = 'display:block;color:#f59e0b;font-size:10px;margin-top:2px;';
                costSpan.textContent = `预计代价: ${opt.cost}`;
                mainSpan.appendChild(costSpan);
              }
              btn.appendChild(numSpan);
              btn.appendChild(mainSpan);
              if (opt.tag) {
                const tagSpan = ownerDoc.createElement('span');
                tagSpan.style.cssText =
                  'padding:2px 6px;background:color-mix(in srgb,var(--tw-theme-accent,var(--rac-accent,#38bdf8)) 14%,transparent);border:1px solid color-mix(in srgb,var(--tw-theme-accent,var(--rac-accent,#38bdf8)) 30%,transparent);border-radius:3px;color:color-mix(in srgb,var(--tw-theme-accent,var(--rac-accent,#38bdf8)) 85%,#ffffff);font-size:10px;white-space:nowrap;';
                tagSpan.textContent = opt.tag;
                btn.appendChild(tagSpan);
              }
              btn.addEventListener('click', () => {
                const ta = ownerDoc.querySelector('#send_textarea') as HTMLTextAreaElement | null;
                if (ta) {
                  ta.value = opt.text;
                  ta.dispatchEvent(new Event('input', { bubbles: true }));
                  ta.focus();
                }
              });
              box.appendChild(btn);
            });
            nextEl.style.display = 'none';
            nextEl.parentNode?.insertBefore(box, nextEl);
            hydrated += 1;
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  return hydrated;
}

/**
 * 救援被外部预设标签（如 `<SUOT>` 触发的 `.TH-render` Iframe 代码块、或 `<p>`/`<small>`/`<SUOT>` 等外层容器）
 * 意外包裹吞噬的 `.tw-floor-card-host` 节点，将其解包还原为 `.mes_text` 下的顶层平级块。
 */
export function rescueWrappedFloorCardHosts(root: ParentNode): number {
  if (!root || typeof root.querySelectorAll !== 'function') return 0;
  let rescued = 0;
  try {
    // 1. 救援被预设代码块渲染器（.TH-render）吞入 <pre><code> / <template id="raw-data"> 内部的 .tw-floor-card-host
    const thRenders = Array.from(root.querySelectorAll('.TH-render')) as HTMLElement[];
    for (const th of thRenders) {
      const codeEl = th.querySelector?.('pre code, code') as HTMLElement | null;
      const templateEl = th.querySelector?.('template#raw-data, template') as HTMLTemplateElement | HTMLElement | null;
      const rawCode =
        (codeEl?.textContent || codeEl?.innerHTML || '') ||
        (templateEl?.innerHTML || templateEl?.textContent || '');
      if (!rawCode || !rawCode.includes('tw-floor-card-host')) continue;

      const ownerDoc = th.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
      if (!ownerDoc || typeof ownerDoc.createElement !== 'function') continue;

      const hostMatches = rawCode.match(
        /<div class="(?:custom-)?tw-floor-card-host"[\s\S]*?(?:<\/iframe><\/div>|<div class="tw-floor-mount"[^>]*><\/div><\/div>)/gi,
      );
      if (!hostMatches || hostMatches.length === 0) continue;

      const tempContainer = ownerDoc.createElement('div');
      tempContainer.innerHTML = hostMatches.join('\n');

      let extractedHosts = Array.from(
        tempContainer.querySelectorAll('.tw-floor-card-host, .custom-tw-floor-card-host'),
      ) as HTMLElement[];
      if (extractedHosts.length === 0) {
        extractedHosts = hostMatches.map(rawHost => {
          const cardMatch = /data-tw-card="([^"]+)"/i.exec(rawHost);
          const payloadMatch = /<script[^>]*class="[^"]*tw-(?:raw-payload|floor-raw)[^"]*"[^>]*>([\s\S]*?)<\/script>/i.exec(rawHost);
          const h = ownerDoc.createElement('div');
          h.className = 'tw-floor-card-host';
          const ct = cardMatch?.[1] ?? 'faction-unlock';
          h.setAttribute('data-tw-card', ct);
          if (h.dataset) h.dataset.twCard = ct;
          const s = ownerDoc.createElement('script');
          s.type = 'text/plain';
          s.className = 'tw-raw-payload';
          s.textContent = payloadMatch?.[1] ?? '';
          h.appendChild(s);
          return h;
        });
      }
      if (extractedHosts.length === 0) continue;

      const parent = th.parentNode;
      if (!parent || typeof parent.insertBefore !== 'function') continue;

      for (const host of extractedHosts) {
        parent.insertBefore(host, th);
        rescued += 1;
      }
      removeElementNode(th);
    }

    // 2. 若 .tw-floor-card-host 被包裹在非预期的行内或预设自定义标签（如 <p>, <small>, <suot>, <interleaving>, <content>）内，提至外层
    const hosts = Array.from(
      root.querySelectorAll('.tw-floor-card-host, .custom-tw-floor-card-host'),
    ) as HTMLElement[];
    for (const host of hosts) {
      const parent = host.parentElement;
      if (!parent) continue;
      const parentTag = parent.tagName?.toLowerCase() ?? '';
      if (
        parentTag === 'p' ||
        parentTag === 'small' ||
        parentTag === 'span' ||
        parentTag === 'suot' ||
        parentTag === 'interleaving' ||
        parentTag === 'content'
      ) {
        const grandParent = parent.parentNode;
        if (grandParent && typeof grandParent.insertBefore === 'function') {
          grandParent.insertBefore(host, parent);
          rescued += 1;
          if ((parent.textContent ?? '').trim().length === 0 && parent.children.length === 0) {
            removeElementNode(parent);
          }
        }
      }
    }
  } catch {
    /* ignore DOM rescue errors */
  }
  return rescued;
}

/**
 * 恢复被外部预设正则（如 `【夏瑾】行动选项2` 在 `depth >= 1` 历史楼层直接将 `<SUOT>...</SUOT>` 替换为空串，
 * 或 `【夏瑾】行动选项1` 在最新楼层将 `<SUOT>...</SUOT>` 吞入 `.TH-render`）抹除的楼层协议卡片宿主节点。
 * 零副作用原则：不修改用户预设正则与提示词，仅从当前楼层 `chat[mesId]` 原文 `<SUOT>` 块中按序补齐缺失的 `.tw-floor-card-host`。
 */
export function recoverStrippedExternalWrappedCards(
  root: ParentNode,
  context?: FloorCardHydrateContext,
): number {
  if (!root || typeof root.querySelectorAll !== 'function') return 0;
  let recovered = 0;
  try {
    const mesElements: HTMLElement[] = [];
    const seenMes = new Set<HTMLElement>();
    const addMesEl = (el: HTMLElement | null | undefined) => {
      // data-tw-mesid 只是卡片的载荷归属标记，不代表它是整层消息容器。
      // 观察器会再次扫描刚恢复的卡片：必须越过卡片祖先，回到楼层范围去重。
      while (el && isFloorCardHostElement(el)) {
        el = findAncestorWithMesId((el.parentNode as HTMLElement | null) ?? null);
      }
      if (!el || seenMes.has(el)) return;
      seenMes.add(el);
      mesElements.push(el);
    };

    if (context?.mesElement) {
      addMesEl(context.mesElement);
    }
    const maybeRootEl = root as HTMLElement;
    if (maybeRootEl && typeof maybeRootEl === 'object') {
      const ancestorMes = findAncestorWithMesId(maybeRootEl);
      if (ancestorMes) addMesEl(ancestorMes);
    }
    try {
      const foundMes = Array.from(root.querySelectorAll('.mes[mesid], [mesid], .mes')) as HTMLElement[];
      for (const el of foundMes) {
        addMesEl(el);
      }
    } catch {
      /* ignore selector fallback */
    }

    const displaySpecs = SYSTEM_TAVERN_REGEX_REGISTRY.filter(spec => spec.destination.display);

    for (const mesEl of mesElements) {
      const rawId =
        (mesEl === context?.mesElement && typeof context?.mesid === 'number'
          ? String(context.mesid)
          : null) ??
        mesEl.getAttribute?.('mesid') ??
        mesEl.getAttribute?.('data-tw-mesid') ??
        mesEl.dataset?.twMesid;
      if (rawId === null || rawId === undefined || String(rawId).trim() === '') continue;
      const mesId = Number(rawId);
      if (!Number.isFinite(mesId) || mesId < 0) continue;

      const rawMsg = readRawFloorMessageById(mesId);
      if (!rawMsg || !/<SUOT\b/i.test(rawMsg)) continue;

      const suotMatches = Array.from(rawMsg.matchAll(/<SUOT\b[^>]*>([\s\S]*?)<\/SUOT>/gi));
      if (suotMatches.length === 0) continue;
      const suotContent = suotMatches.map(m => m[1] ?? '').join('\n\n');

      const matchedItems: Array<{ index: number; cardType: string; payload: string }> = [];
      for (const spec of displaySpecs) {
        const cardTypeMatch = /data-tw-card="([^"]+)"/.exec(spec.replace_string);
        const cardType = cardTypeMatch?.[1] ?? '';
        if (!cardType) continue;
        const globalRe = new RegExp(spec.find_regex, 'g');
        let m: RegExpExecArray | null;
        while ((m = globalRe.exec(suotContent)) !== null) {
          matchedItems.push({
            index: m.index,
            cardType,
            payload: (m[1] ?? m[0] ?? '').trim(),
          });
        }
      }

      if (matchedItems.length === 0) continue;
      matchedItems.sort((a, b) => a.index - b.index);

      const mesTextEl =
        (mesEl.matches?.('.mes_text') ? mesEl : null) ??
        (mesEl.querySelector?.('.mes_text') as HTMLElement | null) ??
        mesEl;
      const ownerDoc =
        mesTextEl.ownerDocument ??
        getHostDocument() ??
        (typeof document !== 'undefined' ? document : null);
      if (!ownerDoc || typeof ownerDoc.createElement !== 'function' || typeof mesTextEl.appendChild !== 'function') {
        continue;
      }

      // 若 .mes_text 中残留了由【夏瑾】行动选项1 針對 <SUOT> 生成的空白/失效 .TH-render 容器，将其清理
      const leftoverThRenders = Array.from(mesTextEl.querySelectorAll?.('.TH-render') ?? []) as HTMLElement[];
      for (const th of leftoverThRenders) {
        removeElementNode(th);
      }

      const existingCountByType = new Map<string, number>();
      const existingHosts = collectFloorCardHosts(mesTextEl);
      for (const h of existingHosts) {
        const ct = (
          h.dataset?.twCard ??
          h.getAttribute?.('data-tw-card') ??
          h.dataset?.cardType ??
          h.getAttribute?.('data-card-type') ??
          ''
        ).trim();
        if (ct) {
          existingCountByType.set(ct, (existingCountByType.get(ct) ?? 0) + 1);
        }
      }

      const seenCountByType = new Map<string, number>();
      for (const item of matchedItems) {
        const nextSeen = (seenCountByType.get(item.cardType) ?? 0) + 1;
        seenCountByType.set(item.cardType, nextSeen);
        const alreadyHave = existingCountByType.get(item.cardType) ?? 0;
        if (nextSeen <= alreadyHave) continue;

        const host = ownerDoc.createElement('div');
        host.className = 'tw-floor-card-host';
        host.setAttribute?.('data-tw-card', item.cardType);
        host.setAttribute?.('data-tw-mesid', String(mesId));
        if (host.dataset) {
          host.dataset.twCard = item.cardType;
          host.dataset.twMesid = String(mesId);
        }
        const scriptEl = ownerDoc.createElement('script');
        scriptEl.type = 'text/plain';
        scriptEl.className = 'tw-raw-payload';
        scriptEl.textContent = item.payload;
        host.appendChild(scriptEl);
        mesTextEl.appendChild(host);
        recovered += 1;
      }
    }
  } catch {
    /* ignore recovery errors */
  }
  return recovered;
}

export const FLOOR_TAG_REPAIR_STORAGE_KEY = 'rac_floor_tag_repair_enabled_v1';

let floorTagRepairMemoryFallback = false;

/**
 * 读取「楼层协议标签兼容修补」开关状态（默认关闭 `false`）。
 */
export function getFloorTagRepairEnabled(): boolean {
  try {
    const ls = typeof localStorage !== 'undefined' ? localStorage : null;
    if (ls && typeof ls.getItem === 'function') {
      const val = ls.getItem(FLOOR_TAG_REPAIR_STORAGE_KEY);
      if (val === 'true' || val === '1') return true;
      if (val === 'false' || val === '0') return false;
    }
  } catch {
    /* ignore storage errors */
  }
  return floorTagRepairMemoryFallback;
}

/**
 * 设置「楼层协议标签兼容修补」开关状态（默认关闭 `false`；开启时立即对当前宿主文档执行一次扫描修补与水合）。
 */
export function setFloorTagRepairEnabled(enabled: boolean): void {
  const next = Boolean(enabled);
  floorTagRepairMemoryFallback = next;
  try {
    const ls = typeof localStorage !== 'undefined' ? localStorage : null;
    if (ls && typeof ls.setItem === 'function') {
      ls.setItem(FLOOR_TAG_REPAIR_STORAGE_KEY, next ? 'true' : 'false');
    }
  } catch {
    /* ignore storage errors */
  }
  if (next) {
    try {
      const doc = getHostDocument() ?? (typeof document !== 'undefined' ? document : null);
      if (doc) {
        scanAndHydrateFloorCards(doc);
      }
    } catch {
      /* ignore immediate scan errors */
    }
  }
}

/**
 * 针对 Kemini_Dramatron_v3.1 / Kemini_UAU_OutputTool_Grep_v3.5 三段式交错思考（ICOT）的 DOM 级标签修补与自动折叠：
 * 1. 当首段写反为 `<thinking>\n<Interleaving>` 被预设 `思维链内部标签剥尖括号` 剥为裸词 `Interleaving` 时，自动清理首段折叠框内的冗余 `Interleaving` 行；
 * 2. 当第 2、3 段日语思考漏写 `<thinking>...</thinking>` 标签导致直接裸露在 `.mes_text` 顶层时，自动将其归拢包裹为标准 `<details class="custom-st_custom_reasoning">` 折叠框；
 * 3. 若楼层末尾残留 `【夏瑾】行动选项1` 将 `<SUOT>done</SUOT>` 渲染出的空哨兵代码块（`<pre>` 或 `.TH-render`），静默隐藏该空壳。
 */
export function foldLeakedKeminiIcotThinkingInDom(root: ParentNode): number {
  if (!root || typeof root.querySelectorAll !== 'function') return 0;
  let repaired = 0;

  try {
    // 1. 清理首段折叠框内因 `<thinking>\n<Interleaving>` 倒置残留的裸 `Interleaving` 段落
    const reasoningBodies = Array.from(
      root.querySelectorAll('.st_reasoning_body, .custom-st_reasoning_body'),
    ) as HTMLElement[];
    for (const body of reasoningBodies) {
      const firstChild = body.firstElementChild as HTMLElement | null;
      if (
        firstChild &&
        firstChild.tagName?.toLowerCase() === 'p' &&
        /^(?:<\/?Interleaving>|Interleaving)$/i.test((firstChild.textContent ?? '').trim())
      ) {
        removeElementNode(firstChild);
        repaired += 1;
      }
    }

    // 2. 隐藏楼层底部被 `【夏瑾】行动选项1` 渲染出的 `<SUOT>done</SUOT>` 哨兵 `<pre>` / `.TH-render`
    const preAndThNodes = Array.from(
      root.querySelectorAll('.mes_text > pre, .mes_text > .TH-render, pre, .TH-render'),
    ) as HTMLElement[];
    for (const node of preAndThNodes) {
      if (node.style?.display === 'none') continue;
      const rawTxt = node.textContent ?? '';
      if (
        rawTxt.includes('夏瑾 · 回应选项') &&
        /const\s+rawContent\s*=\s*`[\s\r\n]*(?:done|ok|finish|completed)?[\s\r\n]*`/i.test(rawTxt)
      ) {
        node.style.display = 'none';
        repaired += 1;
      }
    }

    // 3. 自动将 `.mes_text` 下漏写 `<thinking>` 的第 2、3 段日语 Dramatron 思考块折叠进 `<details>`
    const mesTexts: HTMLElement[] = [];
    const rootEl = root as HTMLElement;
    if (
      typeof rootEl.className === 'string' &&
      rootEl.className.includes('mes_text')
    ) {
      mesTexts.push(rootEl);
    }
    const foundMesTexts = Array.from(root.querySelectorAll('.mes_text')) as HTMLElement[];
    for (const m of foundMesTexts) {
      if (!mesTexts.includes(m)) mesTexts.push(m);
    }

    const isKeminiIcotStartParagraph = (el: HTMLElement): boolean => {
      if (el.tagName?.toLowerCase() !== 'p') return false;
      const txt = (el.textContent ?? '').trim();
      return (
        txt.startsWith('回到 Dramatron，继续。') ||
        txt.includes('已经切换到日本語进行思考啦！我会严格逐条按照日语思考的')
      );
    };

    const isKeminiIcotContinuationNode = (el: HTMLElement): boolean => {
      const tag = el.tagName?.toLowerCase();
      const txt = (el.textContent ?? '').trim();
      if (tag === 'ul' || tag === 'ol') {
        return /段中思考|情景回顾|墨守成规|第[123]段|正文输出必须是简体中文|如何严禁结尾升华|结尾の制約|禁止語|対白|角色知道哪些信息/.test(
          txt,
        );
      }
      if (tag === 'p') {
        if (txt === '：' || txt === ':' || txt.startsWith('{{getvar')) return true;
        if (/^(?:- |\* |回到 Dramatron|我应该摒弃所有可能影响文学创作质量)/.test(txt)) return true;
        // 含大量日文假名的思考段落（非中文「」对白段落）
        if (!txt.startsWith('「') && /[\u3040-\u309f\u30a0-\u30ff]/.test(txt)) {
          return true;
        }
      }
      return false;
    };

    for (const mesText of mesTexts) {
      const ownerDoc = mesText.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
      if (!ownerDoc || typeof ownerDoc.createElement !== 'function') continue;

      const children = Array.from(mesText.children) as HTMLElement[];
      let i = 0;
      while (i < children.length) {
        const cur = children[i];
        if (!cur || !isKeminiIcotStartParagraph(cur)) {
          i += 1;
          continue;
        }

        const run: HTMLElement[] = [cur];
        let j = i + 1;
        while (j < children.length && isKeminiIcotContinuationNode(children[j])) {
          run.push(children[j]);
          j += 1;
        }

        const details = ownerDoc.createElement('details');
        details.className = 'custom-st_custom_reasoning';
        details.setAttribute('data-tw-kemini-icot-folded', 'true');
        details.style.cssText =
          'display: block; margin: 8px 0; border: none; background: transparent;';

        const summary = ownerDoc.createElement('summary');
        summary.className = 'custom-st_reasoning_header';
        summary.style.cssText =
          'display: inline-flex; align-items: center; gap: 6px; padding: 3px 6px; cursor: pointer; user-select: none; color: rgba(128, 128, 128, 0.7); font-family: inherit; font-size: 0.85em; font-weight: normal; list-style: none; outline: none; border-radius: 4px;';
        summary.innerHTML = '<span>思考了一会</span>';

        const body = ownerDoc.createElement('div');
        body.className = 'custom-st_reasoning_body';
        body.style.cssText =
          'margin-top: 6px; padding: 4px 0 4px 12px; border-left: 2px solid rgba(128, 128, 128, 0.2); color: rgba(128, 128, 128, 0.65); font-size: 0.85em; line-height: 1.6; overflow-x: auto;';

        mesText.insertBefore(details, cur);
        for (const node of run) {
          body.appendChild(node);
        }
        details.appendChild(summary);
        details.appendChild(body);

        repaired += 1;
        i = j;
      }
    }
  } catch {
    /* ignore DOM repair errors */
  }

  return repaired;
}

/**
 * 扫描根节点下所有 `.tw-floor-card-host` 并逐个执行水合，返回本次新水合的卡片数量。
 */
export function hydrateFloorCardsInElement(
  root: ParentNode | null | undefined = typeof document !== 'undefined' ? document : undefined,
  context?: FloorCardHydrateContext,
): number {
  return scanAndHydrateFloorCards(root, context);
}

export function scanAndHydrateFloorCards(
  root: ParentNode | null | undefined = typeof document !== 'undefined' ? document : undefined,
  context?: FloorCardHydrateContext,
): number {
  if (!root || typeof root.querySelectorAll !== 'function') return 0;
  const t0 = nowPerfMs();

  let count = 0;
  rescueBareProtocolBlocksInDom(root, context);
  if (getFloorTagRepairEnabled()) {
    foldLeakedKeminiIcotThinkingInDom(root);
    rescueWrappedFloorCardHosts(root);
    recoverStrippedExternalWrappedCards(root, context);
    count += hydrateBareOptionsBlocks(root);
  }
  const maybeElement = root as HTMLElement;
  if (
    isFloorCardHostElement(maybeElement) &&
    maybeElement.dataset?.twHydrated !== 'true' &&
    maybeElement.getAttribute?.('data-tw-hydrated') !== 'true'
  ) {
    if (hydrateFloorCardHost(maybeElement, context)) {
      count += 1;
    }
  }

  // 在原生浏览器/标准 DOM 下直接用单条 :not([data-tw-hydrated="true"]) 选择器跳过已水合节点；
  // 在无 nodeType 的轻量单测 MockDocument 下回退简单类选择器以保持 100% 兼容
  const isNativeDom = typeof (root as Node).nodeType === 'number';
  if (isNativeDom) {
    try {
      const hosts = Array.from(
        root.querySelectorAll(FLOOR_CARD_UNHYDRATED_SELECTOR),
      ) as HTMLElement[];
      for (const host of hosts) {
        if (hydrateFloorCardHost(host, context)) {
          count += 1;
        }
      }
      if (count > 0) {
        recordPerfSample('card.hydrate', nowPerfMs() - t0, { detail: `hydrated=${count}` });
      }
      return count;
    } catch {
      /* fallback to basic selectors */
    }
  }

  const seen = new Set<HTMLElement>();
  for (const sel of FLOOR_CARD_HOST_SELECTORS) {
    const hosts = Array.from(root.querySelectorAll(sel)) as HTMLElement[];
    for (const host of hosts) {
      if (seen.has(host)) continue;
      seen.add(host);
      if (
        host.dataset?.twHydrated === 'true' ||
        host.getAttribute?.('data-tw-hydrated') === 'true'
      ) {
        continue;
      }
      if (hydrateFloorCardHost(host, context)) {
        count += 1;
      }
    }
  }

  if (count > 0) {
    recordPerfSample('card.hydrate', nowPerfMs() - t0, { detail: `hydrated=${count}` });
  }
  return count;
}

function isDocumentLike(val: unknown): val is Document {
  if (!val || typeof val !== 'object') return false;
  const rec = val as Record<string, unknown>;
  return (
    typeof rec.createElement === 'function' ||
    typeof rec.querySelectorAll === 'function' ||
    rec.body !== undefined ||
    rec.documentElement !== undefined
  );
}

function resolveManagedChatSurface(
  doc: Document | null,
  options?: FloorCardHydratorOptions,
): TauriTavernChatSurfaceApi | null {
  if (options?.chatSurface) {
    const cs = options.chatSurface;
    if (
      cs.protocolVersion === 1 &&
      typeof cs.registerParticipant === 'function' &&
      cs.isManagedOwnershipRequired?.() === true
    ) {
      return cs;
    }
    return null;
  }

  if (options?.hostWindow !== undefined) {
    if (isChatSurfaceManaged(options.hostWindow)) {
      return getTauriTavernBridge(options.hostWindow).chatSurface;
    }
    return null;
  }

  if (doc?.defaultView && isChatSurfaceManaged(doc.defaultView)) {
    return getTauriTavernBridge(doc.defaultView).chatSurface;
  }

  if (ttHostBridge.isChatSurfaceManaged()) {
    return ttHostBridge.chatSurface;
  }

  return null;
}

/**
 * 安装楼层卡片水合器（双轨自动切换）：
 * 1. 若检测到 TauriTavern `ChatSurface` 托管模式（`isChatSurfaceManaged() === true`）：
 *    - 仅启动 `installChatSurfaceCardParticipant(chatSurface, options)`；
 *    - 严禁启动 `MutationObserver`，返回 participant 注销函数；
 * 2. 若为传统 SillyTavern 或普通 DOM 环境：
 *    - 立即执行一次 `scanAndHydrateFloorCards(doc)`；
 *    - 注册经批次合并优化的 `MutationObserver` 监听新增节点并自动水合；
 *    - 返回 `stop()` 清理函数。
 */
export function installFloorCardHydrator(
  targetDocOrOptions?: Document | FloorCardHydratorOptions | null,
  maybeOptions?: FloorCardHydratorOptions,
): () => void {
  const targetDoc = isDocumentLike(targetDocOrOptions) ? targetDocOrOptions : undefined;
  const options = isDocumentLike(targetDocOrOptions)
    ? maybeOptions
    : ((targetDocOrOptions as FloorCardHydratorOptions | null | undefined) ?? maybeOptions);

  const doc =
    targetDoc ??
    getHostDocument() ??
    (typeof document !== 'undefined' ? document : null);

  // 轨道 A：TauriTavern ChatSurface 虚拟列表托管模式（Exclusive Surface Ownership）
  const managedChatSurface = resolveManagedChatSurface(doc, options);
  if (managedChatSurface) {
    return installChatSurfaceCardParticipant(managedChatSurface, options);
  }

  // 轨道 B：传统 SillyTavern 单份 DOM MutationObserver 模式
  if (!doc) {
    return () => {};
  }

  scanAndHydrateFloorCards(doc);

  const ObserverCtor =
    (doc.defaultView as (Window & { MutationObserver?: typeof MutationObserver }) | null)
      ?.MutationObserver ??
    (typeof MutationObserver !== 'undefined' ? MutationObserver : undefined);

  const observeTarget = doc.body ?? doc.documentElement ?? (doc as unknown as Node);
  if (!ObserverCtor || !observeTarget) {
    return () => {};
  }

  const pendingRoots = new Set<ParentNode>();
  let rafId: number | null = null;
  let stopped = false;

  const flushPendingMutations = () => {
    rafId = null;
    if (stopped || pendingRoots.size === 0) {
      pendingRoots.clear();
      return;
    }
    const batch = Array.from(pendingRoots);
    pendingRoots.clear();
    for (const root of batch) {
      scanAndHydrateFloorCards(root);
    }
  };

  const winView = doc.defaultView as
    | (Window & {
        requestAnimationFrame?: (cb: FrameRequestCallback) => number;
        cancelAnimationFrame?: (id: number) => void;
      })
    | null;

  const observer = new ObserverCtor(mutations => {
    if (stopped) return;
    for (const mutation of mutations) {
      if (!mutation.addedNodes || mutation.addedNodes.length === 0) continue;
      for (const node of Array.from(mutation.addedNodes)) {
        if (!node || typeof (node as ParentNode).querySelectorAll !== 'function') continue;
        const el = node as HTMLElement;
        const tag = el.tagName?.toLowerCase();
        if (tag === 'style' || tag === 'script' || tag === 'link') continue;
        const cls = typeof el.className === 'string' ? el.className : '';
        if (cls.includes('tw-floor-card-mount')) continue;
        pendingRoots.add(node as ParentNode);
      }
    }

    if (pendingRoots.size === 0) return;

    if (options?.coalesceWithRaf && typeof winView?.requestAnimationFrame === 'function') {
      if (rafId === null) {
        rafId = winView.requestAnimationFrame(() => flushPendingMutations());
      }
    } else {
      flushPendingMutations();
    }
  });

  try {
    observer.observe(observeTarget, {
      childList: true,
      subtree: true,
    });
  } catch {
    return () => {};
  }

  return () => {
    if (stopped) return;
    stopped = true;
    if (rafId !== null && typeof winView?.cancelAnimationFrame === 'function') {
      winView.cancelAnimationFrame(rafId);
      rafId = null;
    }
    pendingRoots.clear();
    observer.disconnect();
  };
}
