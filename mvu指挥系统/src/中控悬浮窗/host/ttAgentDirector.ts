/**
 * ttAgentDirector.ts —— 战区总参谋部后台 Agent 编排器（PKG-D）
 *
 * 架构文档：docs/Architecture/TaruiTavern/README.md (§4.4)
 * 实施任务包：docs/Architecture/Future Developments/30-TauriTavern宿主适配与专属开发脚手架实施任务包.md (PKG-D)
 *
 * 核心职责：
 * 1. 基于 ttHostBridge 的 agent API 封装战区总参谋部后台 Agent 编排器；
 * 2. 幂等注册 `ghq-tactical-staff` 参谋 Profile（开放世界书激活读取、聊天检索、技能查阅、受控工作区读写、掷骰检定与子代理委派）；
 * 3. 支持科研建议推导、工程日程规划、战局简报归档与战术随机检定四类后台任务，通过 subscribe 收集事件流并经 readWorkspaceFile 取回产物；
 * 4. 在传统 SillyTavern 宿主或调用异常时平滑降级至 fallbackRunner 或返回结构化诊断结果，零未捕获异常。
 */

import {
  getTauriTavernBridge,
  ttHostBridge,
  type AgentProfileDefinition,
  type AgentRunEvent,
  type AgentRunStatus,
  type TauriTavernBridge,
  type TauriTavernHostUnsubscribe,
} from './ttHostBridge';

export const GHQ_TACTICAL_STAFF_PROFILE_ID = 'ghq-tactical-staff';

export const GHQ_TACTICAL_STAFF_ALLOWED_TOOLS: readonly string[] = [
  'worldinfo.read_activated',
  'chat.read_messages',
  'chat.search',
  'skill.list',
  'skill.search',
  'skill.read',
  'workspace.list_files',
  'workspace.read_file',
  'workspace.write_file',
  'workspace.apply_patch',
  'workspace.commit',
  'workspace.finish',
  'dice.roll',
  'agent.list',
  'agent.delegate',
  'agent.await',
];

export const GHQ_TACTICAL_STAFF_WORKSPACE_ROOTS: readonly string[] = [
  'output',
  'scratch',
  'plan',
  'summaries',
  'persist',
];

export type TacticalStaffTaskKind =
  | 'research-advisory'
  | 'schedule-planning'
  | 'battle-summary'
  | 'tactical-dice-check';

export interface TacticalStaffTaskRequest {
  kind: TacticalStaffTaskKind;
  objective?: string;
  /** 兼容 prompt 字段别名 */
  prompt?: string;
  outputPath?: string;
  presentation?: 'foreground' | 'background';
  profileId?: string;
  stableChatId?: string;
  generateOptions?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface TacticalStaffTaskResult {
  ok: boolean;
  mode: 'tauritavern-agent' | 'legacy-fallback' | 'unavailable';
  runId?: string;
  status?: AgentRunStatus;
  outputPath?: string;
  outputText?: string;
  events?: AgentRunEvent[];
  fallbackReason?: string;
}

export interface TacticalAgentDirectorDeps {
  hostWindow?: unknown;
  fallbackRunner?: (task: TacticalStaffTaskRequest) => Promise<TacticalStaffTaskResult>;
}

export interface EnsureStaffProfileResult {
  registered: boolean;
  profileId: string;
  fallbackReason?: string;
}

export interface CancelStaffRunResult {
  cancelled: boolean;
  runId: string;
  status?: AgentRunStatus;
  fallbackReason?: string;
}

export interface TacticalAgentDirector {
  isAvailable(): boolean;
  ensureStaffProfile(): Promise<EnsureStaffProfileResult>;
  /** 兼容别名 */
  ensureTacticalStaffProfile(): Promise<EnsureStaffProfileResult>;
  runStaffTask(request: TacticalStaffTaskRequest): Promise<TacticalStaffTaskResult>;
  /** 兼容别名 */
  runBackgroundStaffTask(request: TacticalStaffTaskRequest): Promise<TacticalStaffTaskResult>;
  cancelRun(runId: string): Promise<CancelStaffRunResult>;
}

const TRACKED_AGENT_EVENT_TYPES = new Set<string>([
  'tool_call_completed',
  'workspace_file_written',
  'run_completed',
  'run_failed',
  'run_cancelled',
]);

/**
 * 构造符合 TauriTavern AgentProfileDefinition 规范的战区总参谋部 Profile
 */
export function buildTacticalStaffProfile(
  overrides?: Partial<AgentProfileDefinition>,
): AgentProfileDefinition {
  return {
    schemaVersion: 1,
    kind: 'tauritavern.agentProfile',
    id: overrides?.id ?? GHQ_TACTICAL_STAFF_PROFILE_ID,
    displayName: overrides?.displayName ?? 'GHQ 战区总参谋部',
    description:
      overrides?.description ??
      '负责战区科研建议推导、工程日程排产规划、战局简报归档与战术随机检定的后台参谋运行配置。',
    callable: overrides?.callable ?? true,
    allowAsSubagent: overrides?.allowAsSubagent ?? true,
    preset: overrides?.preset ?? { mode: 'currentPromptSnapshot' },
    model: overrides?.model ?? { mode: 'currentPromptSnapshot' },
    run: {
      presentation: overrides?.run?.presentation ?? 'background',
      modelRetry: overrides?.run?.modelRetry ?? { maxRetries: 2, intervalMs: 2000 },
    },
    instructions: {
      agentSystemPrompt:
        overrides?.instructions?.agentSystemPrompt !== undefined
          ? overrides.instructions.agentSystemPrompt
          : '你是战区总参谋部后台战术参谋。请依据当前激活的世界书条令、战报上下文与技能包规范完成推演，并将结果写入工作区指定产物路径。',
    },
    tools: {
      allow: overrides?.tools?.allow
        ? [...overrides.tools.allow]
        : [...GHQ_TACTICAL_STAFF_ALLOWED_TOOLS],
      deny: overrides?.tools?.deny ? [...overrides.tools.deny] : [],
      maxRounds: overrides?.tools?.maxRounds ?? 8,
      maxCallsPerRun: overrides?.tools?.maxCallsPerRun ?? 24,
    },
    skills: {
      visible: overrides?.skills?.visible
        ? [...overrides.skills.visible]
        : ['ghq-worldbook-style-guide', 'ghq-r20-production-audit'],
      deny: overrides?.skills?.deny ? [...overrides.skills.deny] : [],
      maxReadCharsPerCall: overrides?.skills?.maxReadCharsPerCall ?? 16000,
      maxReadCharsPerRun: overrides?.skills?.maxReadCharsPerRun ?? 64000,
    },
    workspace: {
      visibleRoots: overrides?.workspace?.visibleRoots
        ? [...overrides.workspace.visibleRoots]
        : [...GHQ_TACTICAL_STAFF_WORKSPACE_ROOTS],
      writableRoots: overrides?.workspace?.writableRoots
        ? [...overrides.workspace.writableRoots]
        : [...GHQ_TACTICAL_STAFF_WORKSPACE_ROOTS],
    },
    plan: overrides?.plan ?? { mode: 'none' },
    output: overrides?.output ?? {
      artifacts: [
        {
          id: 'main-report',
          path: 'output/main.md',
          kind: 'markdown',
          target: 'workspaceOnly',
          required: false,
          assemblyOrder: 1,
        },
        {
          id: 'schedule-plan',
          path: 'plan/schedule.json',
          kind: 'json',
          target: 'workspaceOnly',
          required: false,
          assemblyOrder: 2,
        },
      ],
    },
  } as AgentProfileDefinition;
}

export const GHQ_TACTICAL_STAFF_V4_BUILTIN_TOOLS: readonly string[] = [
  'builtin:worldinfo.read_activated',
  'builtin:chat.read_messages',
  'builtin:chat.search',
  'builtin:workspace.list_files',
  'builtin:workspace.search_files',
  'builtin:workspace.read_file',
  'builtin:workspace.write_file',
  'builtin:workspace.apply_patch',
  'builtin:workspace.commit',
  'builtin:workspace.finish',
  'builtin:dice.roll',
  'builtin:agent.delegate',
  'builtin:agent.await',
];

export function buildTacticalStaffProfileV4(): Record<string, unknown> {
  return {
    schemaVersion: 4,
    kind: 'tauritavern.agentProfile',
    id: GHQ_TACTICAL_STAFF_PROFILE_ID,
    displayName: 'GHQ 战区总参谋部',
    description:
      '负责战区科研建议推导、工程日程排产规划、战局简报归档与战术随机检定的后台参谋运行配置。',
    preset: { mode: 'currentPromptSnapshot', required: false },
    model: { mode: 'currentPromptSnapshot' },
    run: {
      presentation: 'background',
      stream: false,
      directRunnable: true,
      modelRetry: { maxRetries: 2, intervalMs: 2000 },
    },
    context: {
      initialChatHistoryMessages: 16,
      includeActivatedWorldInfo: true,
    },
    delegation: {
      canDelegate: true,
      canHandoff: false,
      callable: true,
      allowAsSubagent: true,
      allowAsHandoffTarget: false,
      allowNestedDelegation: false,
      allowedCallers: ['*'],
      descriptionForAgents: 'GHQ 战区总参谋部后台战术推演参谋',
      maxConcurrentInvocations: 2,
      maxInvocationsPerRun: 4,
      resultBudgetTokens: 4096,
      maxHandoffDepth: 1,
    },
    instructions: {
      agentSystemPrompt:
        '你是战区总参谋部后台战术参谋。请依据当前激活的世界书条令、战报上下文与技能包规范完成推演，并将结果写入工作区指定产物路径。',
    },
    tools: {
      allow: [...GHQ_TACTICAL_STAFF_V4_BUILTIN_TOOLS],
      deny: [],
      toolDescriptions: {},
      maxRounds: 8,
      maxCallsPerRun: 24,
      externalResultInlineCharLimit: 16000,
      maxCallsPerTool: {},
    },
    skills: {
      visible: ['ghq-worldbook-style-guide', 'ghq-r20-production-audit'],
      deny: [],
    },
    workspace: {
      visibleRoots: [...GHQ_TACTICAL_STAFF_WORKSPACE_ROOTS],
      writableRoots: [...GHQ_TACTICAL_STAFF_WORKSPACE_ROOTS],
    },
    plan: { mode: 'none', beta: true, nodes: [] },
    output: {
      artifacts: [
        {
          id: 'main-report',
          path: 'output/main.md',
          kind: 'markdown',
          target: 'messageBody',
          required: false,
          assemblyOrder: 0,
        },
      ],
    },
  };
}
function defaultOutputPathForKind(kind: TacticalStaffTaskKind): string {
  return kind === 'schedule-planning' ? 'plan/schedule.json' : 'output/main.md';
}

async function safeInvokeUnsubscribe(unsub: TauriTavernHostUnsubscribe | null | undefined): Promise<void> {
  if (typeof unsub !== 'function') return;
  try {
    await unsub();
  } catch {
    // Ignore unsubscribe errors
  }
}

export function createTacticalAgentDirector(
  deps?: TacticalAgentDirectorDeps,
): TacticalAgentDirector {
  function resolveBridge(): TauriTavernBridge {
    return deps && 'hostWindow' in deps
      ? getTauriTavernBridge(deps.hostWindow)
      : ttHostBridge;
  }

  async function invokeFallbackOrUnavailable(
    request: TacticalStaffTaskRequest,
    fallbackReason: string,
    extra?: { runId?: string; status?: AgentRunStatus; events?: AgentRunEvent[] },
  ): Promise<TacticalStaffTaskResult> {
    if (typeof deps?.fallbackRunner === 'function') {
      try {
        const res = await deps.fallbackRunner(request);
        return {
          ...res,
          mode: 'legacy-fallback',
          runId: res.runId ?? extra?.runId,
          status: res.status ?? extra?.status,
          events: res.events ?? extra?.events,
          fallbackReason: res.fallbackReason ?? fallbackReason,
        };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          mode: 'legacy-fallback',
          runId: extra?.runId,
          status: extra?.status,
          events: extra?.events,
          fallbackReason: `${fallbackReason}; fallbackRunner failed: ${reason}`,
        };
      }
    }
    return {
      ok: false,
      mode: 'unavailable',
      runId: extra?.runId,
      status: extra?.status,
      events: extra?.events,
      fallbackReason,
    };
  }

  function isAvailable(): boolean {
    return resolveBridge().agent !== null;
  }

  async function ensureStaffProfile(): Promise<EnsureStaffProfileResult> {
    const agent = resolveBridge().agent;
    if (!agent || !agent.profiles || typeof agent.profiles.load !== 'function') {
      return {
        registered: false,
        profileId: GHQ_TACTICAL_STAFF_PROFILE_ID,
        fallbackReason: 'TauriTavern Agent Profiles API unavailable',
      };
    }

    try {
      const loaded = await agent.profiles.load(GHQ_TACTICAL_STAFF_PROFILE_ID);
      const existing =
        loaded && typeof loaded === 'object' && 'profile' in loaded
          ? loaded.profile
          : (loaded as AgentProfileDefinition | null);

      if (!existing) {
        const profile = buildTacticalStaffProfile();
        try {
          await agent.profiles.save(profile);
        } catch {
          await agent.profiles.save(
            buildTacticalStaffProfileV4() as unknown as AgentProfileDefinition,
          );
        }
      }
      return {
        registered: true,
        profileId: GHQ_TACTICAL_STAFF_PROFILE_ID,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        registered: false,
        profileId: GHQ_TACTICAL_STAFF_PROFILE_ID,
        fallbackReason: `Failed to ensure tactical staff profile: ${reason}`,
      };
    }
  }

  async function cancelRun(runId: string): Promise<CancelStaffRunResult> {
    const agent = resolveBridge().agent;
    if (!agent || typeof agent.cancel !== 'function') {
      return {
        cancelled: false,
        runId,
        fallbackReason: 'TauriTavern Agent API unavailable',
      };
    }
    try {
      const handle = await agent.cancel(runId);
      return {
        cancelled: true,
        runId: handle?.runId ?? runId,
        status: handle?.status ?? 'cancelled',
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        cancelled: false,
        runId,
        fallbackReason: `Failed to cancel agent run: ${reason}`,
      };
    }
  }

  async function runStaffTask(
    request: TacticalStaffTaskRequest,
  ): Promise<TacticalStaffTaskResult> {
    const agent = resolveBridge().agent;
    if (!agent) {
      return invokeFallbackOrUnavailable(
        request,
        'TauriTavern Agent API unavailable in current host',
      );
    }

    const profileRes = await ensureStaffProfile();
    if (!profileRes.registered) {
      return invokeFallbackOrUnavailable(
        request,
        profileRes.fallbackReason ?? 'Failed to ensure tactical staff profile',
      );
    }

    const presentation = request.presentation ?? 'background';
    const profileId = request.profileId ?? profileRes.profileId;
    const objective = request.objective ?? request.prompt ?? '';
    const outputPath = request.outputPath ?? defaultOutputPathForKind(request.kind);
    const events: AgentRunEvent[] = [];

    let runId: string | undefined;

    try {
      const handle = await agent.startRunFromLegacyGenerate({
        generationType: 'normal',
        profileId,
        stableChatId: request.stableChatId,
        generateOptions: request.generateOptions,
        presentation,
        generationIntent: {
          kind: request.kind,
          objective,
        },
        options: {
          presentation,
          stream: false,
        },
      });

      runId = handle.runId;
      let writtenWorkspacePath: string | null = null;

      const terminalOutcome = await new Promise<{
        status: 'completed' | 'failed' | 'cancelled';
        reason?: string;
      }>(resolve => {
        let settled = false;
        let unsub: TauriTavernHostUnsubscribe | null = null;

        const finish = (
          status: 'completed' | 'failed' | 'cancelled',
          reason?: string,
        ) => {
          if (settled) return;
          settled = true;
          if (request.signal && onAbort) {
            request.signal.removeEventListener('abort', onAbort);
          }
          void safeInvokeUnsubscribe(unsub);
          resolve({ status, reason });
        };

        const handleEvent = (ev: AgentRunEvent) => {
          if (!ev || typeof ev !== 'object') return;
          if (TRACKED_AGENT_EVENT_TYPES.has(ev.type)) {
            events.push(ev);
          }
          if (
            ev.type === 'workspace_file_written' &&
            ev.payload &&
            typeof ev.payload === 'object' &&
            typeof (ev.payload as Record<string, unknown>).path === 'string'
          ) {
            writtenWorkspacePath = (ev.payload as { path: string }).path;
          }
          if (ev.type === 'run_completed') {
            finish('completed');
          } else if (ev.type === 'run_failed') {
            const errMsg =
              ev.payload &&
              typeof ev.payload === 'object' &&
              typeof (ev.payload as Record<string, unknown>).message === 'string'
                ? (ev.payload as { message: string }).message
                : 'Agent run failed';
            finish('failed', errMsg);
          } else if (ev.type === 'run_cancelled') {
            finish('cancelled', 'Agent run cancelled');
          }
        };

        const onAbort = () => {
          if (runId && typeof agent.cancel === 'function') {
            void Promise.resolve(agent.cancel(runId)).catch(() => {});
          }
          finish('cancelled', 'Agent run aborted by caller');
        };

        if (request.signal) {
          if (request.signal.aborted) {
            onAbort();
            return;
          }
          request.signal.addEventListener('abort', onAbort, { once: true });
        }

        if (typeof agent.subscribe === 'function') {
          unsub = agent.subscribe(runId!, handleEvent, {
            onError: err => {
              const msg = err instanceof Error ? err.message : String(err);
              finish('failed', `Agent subscription error: ${msg}`);
            },
          });
          if (settled) {
            void safeInvokeUnsubscribe(unsub);
            return;
          }
        }

        // 若 startRunFromLegacyGenerate 返回时已处于终态且 subscribe 未同步触发终态事件，微任务兜底检查
        if (
          handle.status === 'completed' ||
          handle.status === 'failed' ||
          handle.status === 'cancelled'
        ) {
          const initialStatus = handle.status;
          void Promise.resolve().then(async () => {
            if (settled) return;
            if (typeof agent.readEvents === 'function') {
              try {
                const batch = await agent.readEvents({ runId: runId! });
                if (Array.isArray(batch?.events)) {
                  for (const ev of batch.events) {
                    handleEvent(ev);
                  }
                }
              } catch {
                // Ignore readEvents fallback errors
              }
            }
            if (!settled) {
              finish(
                initialStatus,
                initialStatus === 'completed'
                  ? undefined
                  : `Agent run ended with status: ${initialStatus}`,
              );
            }
          });
        }
      });

      if (terminalOutcome.status !== 'completed') {
        return invokeFallbackOrUnavailable(
          request,
          terminalOutcome.reason ?? `Agent run ${terminalOutcome.status}`,
          {
            runId,
            status: terminalOutcome.status,
            events,
          },
        );
      }

      const resolvedOutputPath =
        request.outputPath ?? writtenWorkspacePath ?? outputPath;
      let outputText = '';

      if (resolvedOutputPath && typeof agent.readWorkspaceFile === 'function') {
        const wf = await agent.readWorkspaceFile({
          runId,
          path: resolvedOutputPath,
        });
        outputText = typeof wf?.text === 'string' ? wf.text : '';
      }

      return {
        ok: true,
        mode: 'tauritavern-agent',
        runId,
        status: 'completed',
        outputPath: resolvedOutputPath,
        outputText,
        events,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return invokeFallbackOrUnavailable(
        request,
        `Agent execution failed: ${reason}`,
        {
          runId,
          status: 'failed',
          events: events.length > 0 ? events : undefined,
        },
      );
    }
  }

  return {
    isAvailable,
    ensureStaffProfile,
    ensureTacticalStaffProfile: ensureStaffProfile,
    runStaffTask,
    runBackgroundStaffTask: runStaffTask,
    cancelRun,
  };
}
