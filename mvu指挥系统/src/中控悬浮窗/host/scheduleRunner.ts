/**
 * scheduleRunner.ts —— 《当前工程日程》前馈注入的事件接线（CTRL-RECONCILE-01 标准① · 案A 平行管线）
 *
 * 时序（与 advisoryRunner 完全同构）：
 * 1. `GENERATION_STARTED`：记录一次性"核心生成令牌"，并清掉上一轮注入；
 * 2. `GENERATION_AFTER_COMMANDS(type, options, dryRun)`：消费令牌 → 拼 GenerationDescriptor →
 *    `planScheduleInjection`（纯推导，任一环节 fail-closed → null；无在编事务 → 零注入）→
 *    非 null 则 `injectPrompts`；
 *    Helper 自定义 `generate()` 只发 AFTER_COMMANDS 且 options 为 `{}`，在 §3.5 判定中被排除；
 * 3. 清理四路：`GENERATION_STOPPED` / `GENERATION_ENDED` / 下次 `GENERATION_STARTED` / `stop()`（pagehide）
 *    → `uninjectPrompts([SCHEDULE_INJECT_ID])`。
 *
 * fail-closed 纪律：读不到最新有效楼 stat_data（bases/queues/clock）或推导任一环节失败 → 本轮不注入，
 * 绝不阻塞生成。宿主 API 全部经 deps 注入（默认取全局），`start()` / `stop()` 幂等。
 *
 * R3 世界书动态目录接线：`planScheduleInjection` 的 dynamicWb 来自 useCatalog 模块级缓存
 * （`dynamicCatalogSnapshot()`，本入口由 FloatingApp 挂载时的 catalog.init() 异步填充）。
 * init() 完成前缓存为 null → 本轮退化为「静态基线 + DLC overlay」，属已知预期（与 useParse 同口径）；
 * 该时序窗口只在脚本挂载后的头几轮生成内存在，init 完成后自动生效，无需重挂接线。
 */
import { readDlcOverlaysFromRegistry, type DlcOverlay, type DynamicWorldbookCatalog } from '../../红警指挥系统/core/catalogEffective';
import type { FloorCandidate } from '../../红警指挥系统/parse/floorScanner';
import { planScheduleInjection, SCHEDULE_INJECT_ID, type ScheduleInjection } from '../../红警指挥系统/planning/scheduleText';
import type { GenerationDescriptor } from '../../红警指挥系统/planning/researchAdvisory';
import { dynamicCatalogSnapshot } from '../../红警指挥系统/composables/useCatalog';
import type { ParsedWorldbookCatalog } from '../models/worldbookCatalogParser';

type Listener = (...args: any[]) => void;

export interface ScheduleEventNames {
  GENERATION_STARTED: string;
  GENERATION_AFTER_COMMANDS: string;
  GENERATION_STOPPED: string;
  GENERATION_ENDED: string;
}

export interface ScheduleDeps {
  eventOn: (event: string, listener: Listener) => unknown;
  eventRemoveListener: (event: string, listener: Listener) => void;
  injectPrompts: (prompts: ScheduleInjection[]) => unknown;
  uninjectPrompts: (ids: string[]) => void;
  getLastMessageId: () => number;
  getChatMessages: (id: number) => Array<Pick<ChatMessage, 'role' | 'is_hidden'> & { data?: Record<string, any> }>;
  getVariables: (option: { type: 'chat' }) => Record<string, unknown> | undefined;
  /** R3：世界书动态目录取件（可选注入，便于测试与宿主替换；缺省读 useCatalog 模块级缓存） */
  readDynamicCatalog?: () => ParsedWorldbookCatalog | DynamicWorldbookCatalog | null;
  events: ScheduleEventNames;
}

export interface ScheduleRunner {
  start(): void;
  stop(): void;
  isStarted(): boolean;
}

/** 真机默认依赖：各函数仅在被调用时才触碰酒馆助手全局（模块加载 / 构造不依赖宿主） */
export function defaultScheduleDeps(): Omit<ScheduleDeps, 'events'> {
  return {
    eventOn: (event, listener) => eventOn(event, listener),
    eventRemoveListener: (event, listener) => eventRemoveListener(event, listener),
    injectPrompts: prompts => injectPrompts(prompts),
    uninjectPrompts: ids => uninjectPrompts(ids),
    getLastMessageId: () => getLastMessageId(),
    getChatMessages: id => getChatMessages(id),
    getVariables: option => getVariables(option),
    readDynamicCatalog: defaultReadDynamicCatalog,
  };
}

/**
 * R3 默认动态目录取件：读 useCatalog 模块级缓存（不触发 pinia / 不读世界书 IO）。
 * catalog.init() 完成前为 null → 退化静态基线（已知预期，与 useParse buildAuthority 同口径）；
 * 模块求值异常等极端环境同样降级为 null，绝不阻断日程推导。
 */
function defaultReadDynamicCatalog(): ParsedWorldbookCatalog | DynamicWorldbookCatalog | null {
  try {
    return dynamicCatalogSnapshot();
  } catch {
    return null;
  }
}

/** 真机事件名：读取全局 tavern_events，故只在未注入 events 时求值 */
export function defaultScheduleEventNames(): ScheduleEventNames {
  return {
    GENERATION_STARTED: tavern_events.GENERATION_STARTED,
    GENERATION_AFTER_COMMANDS: tavern_events.GENERATION_AFTER_COMMANDS,
    GENERATION_STOPPED: tavern_events.GENERATION_STOPPED,
    GENERATION_ENDED: tavern_events.GENERATION_ENDED,
  };
}

export function createScheduleRunner(overrides: Partial<ScheduleDeps> = {}): ScheduleRunner {
  const deps: ScheduleDeps = {
    ...defaultScheduleDeps(),
    ...overrides,
    events: overrides.events ?? defaultScheduleEventNames(),
  };
  let started = false;
  /** §3.5 核心生成令牌：STARTED 置位，AFTER_COMMANDS 一次性消费 */
  let token = false;
  /** 当前是否存在本模块的注入（用于清理幂等） */
  let injected = false;

  function clearInjection() {
    if (!injected) return;
    injected = false;
    deps.uninjectPrompts([SCHEDULE_INJECT_ID]);
  }

  const readFloor = (id: number): FloorCandidate | null => {
    const msg = deps.getChatMessages(id)[0];
    if (!msg) return null;
    return { role: msg.role, is_hidden: msg.is_hidden, stat_data: msg.data?.stat_data };
  };

  function readOverlays(): DlcOverlay[] {
    try {
      return readDlcOverlaysFromRegistry(deps.getVariables({ type: 'chat' })?.$dlc);
    } catch {
      return [];
    }
  }

  const onStarted: Listener = () => {
    token = true;
    clearInjection();
  };

  const onAfterCommands: Listener = (type?: string, options?: unknown, dryRun?: boolean) => {
    const hasStartedToken = token;
    token = false; // 一次性消费
    const generation: GenerationDescriptor = {
      type,
      options: typeof options === 'object' && options !== null ? (options as Record<string, unknown>) : {},
      dryRun: Boolean(dryRun),
      hasStartedToken,
    };
    try {
      // R3：动态目录读取独立容错——异常只降级为静态基线，不影响本轮注入
      let dynamicWb: ParsedWorldbookCatalog | DynamicWorldbookCatalog | null = null;
      try {
        dynamicWb = deps.readDynamicCatalog?.() ?? null;
      } catch {
        dynamicWb = null;
      }
      const plan = planScheduleInjection({
        generation,
        lastMessageId: deps.getLastMessageId(),
        readFloor,
        overlays: readOverlays(),
        dynamicWb,
      });
      if (!plan) return;
      clearInjection();
      deps.injectPrompts([plan.injection]);
      injected = true;
      console.info(`[中控悬浮窗] 工程日程已注入（入口 ${plan.entry}，来源第 ${plan.snapshot.floorId} 楼）`);
    } catch (e) {
      console.warn('[中控悬浮窗] 工程日程推导失败，本轮不注入', e);
    }
  };

  const onStopped: Listener = () => clearInjection();
  const onEnded: Listener = () => clearInjection();

  const bindings: Array<[string, Listener]> = [
    [deps.events.GENERATION_STARTED, onStarted],
    [deps.events.GENERATION_AFTER_COMMANDS, onAfterCommands],
    [deps.events.GENERATION_STOPPED, onStopped],
    [deps.events.GENERATION_ENDED, onEnded],
  ];

  return {
    start() {
      if (started) return;
      started = true;
      for (const [event, listener] of bindings) deps.eventOn(event, listener);
    },
    stop() {
      if (!started) return;
      started = false;
      for (const [event, listener] of bindings) deps.eventRemoveListener(event, listener);
      token = false;
      // pagehide 兜底：无论本地状态如何都显式清一次（Helper 也会自动清理，这里显式做）
      injected = false;
      deps.uninjectPrompts([SCHEDULE_INJECT_ID]);
    },
    isStarted: () => started,
  };
}
