/**
 * summaryRunner.ts —— 方案 C（委托主 LLM 顺带输出 `<中摘要>` / `<大摘要>`）前馈提示词注入运行器
 *
 * 职责：
 * 1. 当生成通道 `SummaryChannel === 'delegate_main'` 时：
 *    - 支持由管理面板手动排队委托任务（Meso 中摘要 / Macro 大摘要）；
 *    - 或在 `SummaryTrigger === 'auto'` 且满 N=20 楼（中摘要）/ 满 4 段中摘要（大摘要）时自动构造委托任务；
 * 2. 将区间内已沉淀的 `micro_summaries`（小摘要流水）或待归并的 `meso` 段落浓缩组装为高密度上下文，
 *    经 `injectPrompts`（id: `redalert_summary_delegation_feed`, depth: 0, role: 'system'）注入下一轮提示词，
 *    指示主 LLM 在本楼战报末尾额外输出 `<中摘要 区间="...">...</中摘要>` 或 `<大摘要 区间="...">...</大摘要>`；
 * 3. 一旦对应区间的草稿已进入 `stat_data.pending_summaries`（或通道切回 `generate_raw`），立即 `uninjectPrompts` 卸载。
 */
import type { StatData } from '../../红警指挥系统/parse/parsePipeline';
import { tav } from '../../红警指挥系统/parse/systemCheck';
import {
  DEFAULT_SUMMARY_BUDGET_CONFIG,
  DEFAULT_SUMMARY_N,
  buildMacroSummarySourceDigest,
  buildMesoSummarySourceDigest,
  extractSummaryRanges,
  formatFloor,
  formatMicroSummariesForPrompt,
  getSummaryBudgetConfig,
  getSummaryChannel,
  getSummaryTrigger,
  nextMacroSummaryCandidate,
  nextSummaryRange,
  type GetChatMessagesForSummaryFn,
} from '../../红警指挥系统/worldbook/summaryFiler';
import type { ThEntry } from '../../红警指挥系统/worldbook/girlFiler';

export const SUMMARY_DELEGATION_PROMPT_ID = 'redalert_summary_delegation_feed';
export const SUMMARY_DELEGATION_QUEUE_KEY = 'redalert_summary_delegation_queue';

export interface SummaryDelegationTask {
  tier: 'meso' | 'macro';
  from: number;
  to: number;
  /** 浓缩输入源（中摘要为逐楼小摘要流水；大摘要为多段中摘要正文） */
  sourceDigest: string;
  createdAt: string;
}

type InjectPromptsFn = (
  prompts: Array<{
    id: string;
    position: 'in_chat' | 'none';
    depth: number;
    role: 'system' | 'user' | 'assistant';
    content: string;
    should_scan?: boolean;
  }>,
  opts?: { once?: boolean },
) => void;

type UninjectPromptsFn = (ids: string[]) => void;

function resolveStorage(custom?: Storage): Storage | null {
  if (custom) return custom;
  if (typeof localStorage !== 'undefined') return localStorage;
  const g = globalThis as Record<string, unknown>;
  return (g.localStorage as Storage) ?? null;
}

/** 读取当前排队中的主模型委托摘要任务 */
export function getQueuedSummaryDelegationTask(storage?: Storage): SummaryDelegationTask | null {
  const s = resolveStorage(storage);
  const raw = s?.getItem(SUMMARY_DELEGATION_QUEUE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SummaryDelegationTask>;
    if (
      (parsed.tier === 'meso' || parsed.tier === 'macro') &&
      typeof parsed.from === 'number' &&
      typeof parsed.to === 'number' &&
      parsed.from <= parsed.to
    ) {
      return {
        tier: parsed.tier,
        from: parsed.from,
        to: parsed.to,
        sourceDigest: typeof parsed.sourceDigest === 'string' ? parsed.sourceDigest : '',
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** 写入或覆盖一条主模型委托摘要任务 */
export function queueSummaryDelegationTask(task: SummaryDelegationTask, storage?: Storage): void {
  const s = resolveStorage(storage);
  s?.setItem(SUMMARY_DELEGATION_QUEUE_KEY, JSON.stringify(task));
}

/** 清空排队中的主模型委托摘要任务 */
export function clearSummaryDelegationTask(storage?: Storage): void {
  const s = resolveStorage(storage);
  s?.removeItem(SUMMARY_DELEGATION_QUEUE_KEY);
}

/** 构造注入给主 LLM 的前馈委托指令文本 */
export function buildSummaryDelegationFeedText(task: SummaryDelegationTask, storage?: Storage): string {
  const rangeStr = `${formatFloor(task.from)}-${formatFloor(task.to)}`;
  const budgetCfg = getSummaryBudgetConfig(storage);
  if (task.tier === 'macro') {
    const targetTok = budgetCfg.macroSingleTargetTokens || DEFAULT_SUMMARY_BUDGET_CONFIG.macroSingleTargetTokens;
    const minChars = Math.max(150, Math.round(targetTok * 0.8));
    const maxChars = Math.max(minChars + 100, Math.round(targetTok * 1.2));
    const spanText =
      targetTok === DEFAULT_SUMMARY_BUDGET_CONFIG.macroSingleTargetTokens ? '400~600' : `${minChars}~${maxChars}`;
    return [
      `【参谋部战史编纂委托 · 大摘要（#${rangeStr}）】`,
      `请在完成本楼常规《正文》《摘要》《timePast》《战况》等全部输出后，于回复最末尾额外附带一个平级顶层标签 \`<大摘要 区间="${rangeStr}">\`，将以下阶段中摘要、逐楼微纪要与目标楼层记录归并提炼为 ${spanText} 字（约 ${targetTok} token 预算）的「四维立体战役卷宗总纲」（兼顾宏观历史转折与核心角色长期群像弧光，严防扁平化）：`,
      task.sourceDigest ? `\n${task.sourceDigest}\n` : '',
      `输出格式严格如下（严禁嵌套在 <战况> 或 <正文> 内）：`,
      `<大摘要 区间="${rangeStr}">`,
      `区间: ${rangeStr}`,
      `标题: <简短且具史诗感的战役卷宗标题>`,
      `纪要:`,
      `【战役主线与时代转折】<跨阶段的核心战略冲突演进、重大抉择与决定战局走向的标志性场面>`,
      `【核心群像与羁绊演进】<主要机娘与关键人物在长周期内的性格蜕变、核心关系定位、共同经历的生死节点与长期承诺/心结>`,
      `【势力版图与军工体系】<基地群落版图、科技与军工能级跃迁、战区各方本土势力的友敌格局演变>`,
      `【远期暗流与终局伏笔】<贯穿全卷尚未揭晓的深层谜团、长线约定向背与战略级潜在威胁>`,
      `关键词: [核心实体1, 核心实体2, 核心实体3]`,
      `</大摘要>`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  const targetTok = budgetCfg.mesoSingleTargetTokens || DEFAULT_SUMMARY_BUDGET_CONFIG.mesoSingleTargetTokens;
  const minChars = Math.max(100, Math.round(targetTok * 0.7));
  const maxChars = Math.max(minChars + 80, Math.round(targetTok * 1.15));
  const spanText =
    targetTok === DEFAULT_SUMMARY_BUDGET_CONFIG.mesoSingleTargetTokens ? '250~450' : `${minChars}~${maxChars}`;
  return [
    `【参谋部阶段归档委托 · 中摘要（#${rangeStr}）】`,
    `请在完成本楼常规《正文》《摘要》《timePast》《战况》等全部输出后，于回复最末尾额外附带一个平级顶层标签 \`<中摘要 区间="${rangeStr}">\`，结合以下逐楼微纪要与目标楼层原始剧情记录，对第 ${task.from} 楼至第 ${task.to} 楼的剧情进行 ${spanText} 字（约 ${targetTok} token 预算）的「四维立体阶段摘要」（严禁写成干瘪流水账，必须保留事件因果博弈与人物鲜活弧光）：`,
    task.sourceDigest
      ? task.sourceDigest.includes('【逐楼微纪要') || task.sourceDigest.includes('【目标楼层')
        ? `\n${task.sourceDigest}\n`
        : `\n【该区间已记录的逐楼微纪要（小摘要流水）】\n${task.sourceDigest}\n`
      : '',
    `输出格式严格如下（严禁嵌套在 <战况> 或 <正文> 内）：`,
    `<中摘要 区间="${rangeStr}">`,
    `区间: ${rangeStr}`,
    `标题: <简短且具画面感的阶段标题>`,
    `纪要:`,
    `【事件脉络与关键抉择】<按“困境导火索→指挥官破局抉择→关键转折与战果/代价”串联主线，保留1~2处名场面细节>`,
    `【人物弧光与互动锚点】<点名记录本阶段核心机娘与重要人物的态度/心境转变、鲜活言行切面及与指挥官的关键互动或约定，严防人物扁平化>`,
    `【战区格局与实力演进】<基地扩建、科技/军工/部队成型、资源命脉与外部势力态势消长>`,
    `【暗线伏笔与待决钩子】<本阶段埋下但尚未收束的悬念、未兑现承诺或潜在危机>`,
    `关键词: [关键实体1, 关键实体2, 关键实体3]`,
    `</中摘要>`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** 清理已注入的委托摘要提示词 */
export function clearSummaryDelegationPrompt(): void {
  const uninject = tav<UninjectPromptsFn>('uninjectPrompts');
  if (uninject) {
    try {
      uninject([SUMMARY_DELEGATION_PROMPT_ID]);
    } catch {
      /* ignore */
    }
  }
}

/**
 * 同步方案 C 主模型委托摘要前馈提示词：
 * - 若当前已有排队任务，但 `stat_data.pending_summaries` 中已存在同 tier + [from, to] 的草稿，自动消解队列并卸载提示词；
 * - 若 `getSummaryChannel() === 'delegate_main'` 且 `getSummaryTrigger() === 'auto'`，当无排队任务时可基于 `worldbookEntries` 与 `currentFloor` 自动检测是否满 N 楼可委托；
 * - 将有效委托任务注入 `SUMMARY_DELEGATION_PROMPT_ID`。
 */
export function syncSummaryDelegationPrompt(
  stat: StatData | null | undefined,
  opts?: {
    currentFloor?: number;
    worldbookEntries?: ThEntry[];
    getChatMessagesFn?: GetChatMessagesForSummaryFn;
    storage?: Storage;
  },
): SummaryDelegationTask | null {
  const inject = tav<InjectPromptsFn>('injectPrompts');
  const uninject = tav<UninjectPromptsFn>('uninjectPrompts');
  const storage = opts?.storage;

  const pendingList = stat?.pending_summaries ?? [];
  const archivedRanges = opts?.worldbookEntries ? extractSummaryRanges(opts.worldbookEntries) : [];
  let task = getQueuedSummaryDelegationTask(storage);

  // 1. 若排队任务已被主模型完成（已进入 pending_summaries 或已自动确认归档入世界书），自动核销任务
  if (task) {
    const inPending = pendingList.some(
      d => (d.tier ?? 'meso') === task!.tier && d.from === task!.from && d.to === task!.to && d.status === 'pending',
    );
    const inWorldbook = archivedRanges.some(
      r => (r.tier ?? 'meso') === task!.tier && r.from <= task!.from && r.to >= task!.to,
    );
    if (inPending || inWorldbook) {
      clearSummaryDelegationTask(storage);
      task = null;
    }
  }

  // 2. 若无显式排队任务，检查是否开启了 delegate_main + auto 自动触发
  const channel = getSummaryChannel(storage);
  const trigger = getSummaryTrigger(storage);
  if (!task && channel === 'delegate_main' && trigger === 'auto' && stat && opts?.worldbookEntries) {
    const currentFloor = opts.currentFloor ?? 0;
    const budgetCfg = getSummaryBudgetConfig(storage);
    const nextRange = nextSummaryRange(opts.worldbookEntries, currentFloor, budgetCfg.tailReserveFloors, {
      maxSpan: DEFAULT_SUMMARY_N,
    });
    if (nextRange) {
      const [from, to] = nextRange;
      const span = to - from + 1;
      const existsInPending = pendingList.some(
        d => (d.tier ?? 'meso') === 'meso' && d.from === from && d.to === to && d.status === 'pending',
      );
      if (span >= DEFAULT_SUMMARY_N && !existsInPending) {
        const digest =
          buildMesoSummarySourceDigest(from, to, {
            microSummaries: stat.micro_summaries,
            getChatMessagesFn: opts.getChatMessagesFn,
          }) || formatMicroSummariesForPrompt(stat.micro_summaries, from, to);
        task = {
          tier: 'meso',
          from,
          to,
          sourceDigest: digest,
          createdAt: new Date().toISOString(),
        };
        queueSummaryDelegationTask(task, storage);
      }
    }
    if (!task) {
      const macroCand = nextMacroSummaryCandidate(opts.worldbookEntries);
      if (macroCand) {
        const existsMacro = pendingList.some(
          d => d.tier === 'macro' && d.from === macroCand.from && d.to === macroCand.to && d.status === 'pending',
        );
        if (!existsMacro) {
          const digest = buildMacroSummarySourceDigest(macroCand.mesoSegments, {
            microSummaries: stat.micro_summaries,
            getChatMessagesFn: opts.getChatMessagesFn,
          });
          task = {
            tier: 'macro',
            from: macroCand.from,
            to: macroCand.to,
            sourceDigest: digest,
            createdAt: new Date().toISOString(),
          };
          queueSummaryDelegationTask(task, storage);
        }
      }
    }
  }

  if (!task) {
    if (uninject) {
      try {
        uninject([SUMMARY_DELEGATION_PROMPT_ID]);
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  const content = buildSummaryDelegationFeedText(task, storage);
  if (inject) {
    try {
      inject(
        [
          {
            id: SUMMARY_DELEGATION_PROMPT_ID,
            position: 'in_chat',
            depth: 0,
            role: 'system',
            content,
            should_scan: false,
          },
        ],
        { once: false },
      );
    } catch (e) {
      console.warn('[Floating:summary] 注入委托摘要提示词异常：', e);
    }
  }
  return task;
}

export interface SummaryRunner {
  start(): void;
  stop(): void;
  isStarted(): boolean;
}

/**
 * 创建方案 C 主模型委托摘要运行器：
 * - 在 GENERATION_AFTER_COMMANDS 与 GENERATION_ENDED 时同步检查委托任务队列与 pending_summaries；
 * - 在 stop / pagehide 时清理注入提示词。
 */
export function createSummaryRunner(
  getStat?: () => StatData | Record<string, unknown> | null | undefined,
  opts?: { storage?: Storage },
): SummaryRunner {
  let started = false;
  let cachedWorldbookEntries: ThEntry[] | undefined = undefined;
  const eventOnFn = tav<(ev: string, fn: (...args: unknown[]) => void) => void>('eventOn');
  const eventRemoveFn = tav<(ev: string, fn: (...args: unknown[]) => void) => void>('eventRemoveListener');
  const getLastMsgId = tav<() => number>('getLastMessageId');

  const resolveCurrentFloor = (): number => {
    const fn = getLastMsgId ?? tav<() => number>('getLastMessageId');
    return fn ? fn() : 0;
  };

  const refreshWorldbookEntriesAsync = async (): Promise<void> => {
    try {
      const getChatWbName = tav<(target?: string) => string | null | Promise<string | null>>(
        'getChatWorldbookName',
      );
      const getWb = tav<(name: string) => Promise<ThEntry[]> | ThEntry[]>('getWorldbook');
      let entries: ThEntry[] = [];
      if (getChatWbName && getWb) {
        const wbName = await getChatWbName('current');
        if (wbName && typeof wbName === 'string') {
          const loaded = await getWb(wbName);
          if (Array.isArray(loaded)) {
            entries = loaded;
          }
        }
      }
      cachedWorldbookEntries = entries;
      if (started) {
        const stat = (getStat?.() ?? null) as StatData | null;
        const currentFloor = resolveCurrentFloor();
        syncSummaryDelegationPrompt(stat, {
          currentFloor,
          worldbookEntries: cachedWorldbookEntries,
          storage: opts?.storage,
        });
      }
    } catch (e) {
      console.warn('[中控悬浮窗] summaryRunner 异步加载聊天世界书异常', e);
    }
  };

  const syncNow = () => {
    try {
      const stat = (getStat?.() ?? null) as StatData | null;
      const currentFloor = resolveCurrentFloor();
      syncSummaryDelegationPrompt(stat, {
        currentFloor,
        worldbookEntries: cachedWorldbookEntries,
        storage: opts?.storage,
      });
      void refreshWorldbookEntriesAsync();
    } catch (e) {
      console.warn('[中控悬浮窗] summaryRunner 同步异常', e);
    }
  };

  const evNames = (): string[] => {
    const te = (globalThis as Record<string, unknown>).tavern_events as Record<string, string> | undefined;
    return [
      te?.GENERATION_AFTER_COMMANDS ?? 'generation_after_commands',
      te?.GENERATION_ENDED ?? 'generation_ended',
      te?.CHAT_CHANGED ?? 'chat_id_changed',
    ];
  };

  return {
    start() {
      if (started) return;
      started = true;
      if (eventOnFn) {
        for (const ev of evNames()) {
          eventOnFn(ev, syncNow);
        }
      }
      syncNow();
    },
    stop() {
      if (!started) return;
      started = false;
      if (eventRemoveFn) {
        for (const ev of evNames()) {
          eventRemoveFn(ev, syncNow);
        }
      }
      clearSummaryDelegationPrompt();
    },
    isStarted: () => started,
  };
}

