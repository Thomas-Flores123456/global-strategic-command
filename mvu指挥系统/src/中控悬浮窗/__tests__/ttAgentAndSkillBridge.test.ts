/**
 * ttAgentAndSkillBridge.test.ts —— PKG-D 专项单元测试
 *
 * 覆盖范围：
 * 1. ttAgentDirector.ts：Profile 规范构造、ensureStaffProfile 幂等注册、后台 Agent Run 启动、
 *    subscribe 事件流收集（tool_call_completed / workspace_file_written / run_completed / run_failed / run_cancelled）、
 *    readWorkspaceFile 产物读取、cancelRun / AbortSignal 取消、fallbackRunner 降级回退与 unavailable 兜底；
 * 2. ttSkillBundle.ts：内置战区条令技能包 YAML frontmatter 校验、ensureBundledSkillsInstalled 冲突策略（skip/replace）、
 *    readTacticalSkillFile、listInstalledTacticalSkills 过滤与不可用降级；
 * 3. worldbookReader.ts：WorldInfo API 扩展（getLastActivatedEntries / subscribeActivations / openWorldbookEntry）与向后兼容；
 * 4. PanelIntegrityCheck.vue：tt-host-diagnostics 诊断区块契约与第 23 号任务包禁用词红线校验。
 */
/* eslint-disable import-x/no-nodejs-modules -- 单测读取 SFC 源码文本进行静态契约断言 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it, vi } from 'vitest';
import {
  buildTacticalStaffProfile,
  createTacticalAgentDirector,
  GHQ_TACTICAL_STAFF_ALLOWED_TOOLS,
  GHQ_TACTICAL_STAFF_PROFILE_ID,
  GHQ_TACTICAL_STAFF_WORKSPACE_ROOTS,
} from '../host/ttAgentDirector';
import {
  BUNDLED_TACTICAL_SKILLS,
  createTacticalSkillManager,
  GHQ_SKILL_SOURCE,
} from '../host/ttSkillBundle';
import { makeWorldbookReader } from '../host/worldbookReader';
import type {
  AgentProfileDefinition,
  AgentRunEvent,
  TauriTavernAgentApi,
  TauriTavernSkillApi,
  TauriTavernWorldInfoApi,
  WorldInfoActivationBatch,
} from '../host/ttHostBridge';

const DIR = join(__dirname, '..');
const INTEGRITY_SFC = readFileSync(join(DIR, 'panels/PanelIntegrityCheck.vue'), 'utf8');

function createMockHostWindow(apis: {
  agent?: Partial<TauriTavernAgentApi>;
  skill?: Partial<TauriTavernSkillApi>;
  worldInfo?: Partial<TauriTavernWorldInfoApi>;
}) {
  return {
    __TAURITAVERN__: {
      abiVersion: 1,
      ready: Promise.resolve(),
      api: {
        ...apis,
      },
    },
  };
}

describe('PKG-D · ttAgentDirector 战区总参谋部后台 Agent 编排器', () => {
  it('buildTacticalStaffProfile 构造符合 TauriTavern AgentProfileDefinition 规范的配置', () => {
    const profile = buildTacticalStaffProfile();
    expect(profile.schemaVersion).toBe(1);
    expect(profile.kind).toBe('tauritavern.agentProfile');
    expect(profile.id).toBe(GHQ_TACTICAL_STAFF_PROFILE_ID);
    expect(profile.preset).toEqual({ mode: 'currentPromptSnapshot' });
    expect(profile.model).toEqual({ mode: 'currentPromptSnapshot' });
    expect(profile.run).toEqual({
      presentation: 'background',
      modelRetry: { maxRetries: 2, intervalMs: 2000 },
    });

    const expectedTools = [
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
    expect(GHQ_TACTICAL_STAFF_ALLOWED_TOOLS).toEqual(expectedTools);
    expect(profile.tools.allow).toEqual(expectedTools);

    const expectedRoots = ['output', 'scratch', 'plan', 'summaries', 'persist'];
    expect(GHQ_TACTICAL_STAFF_WORKSPACE_ROOTS).toEqual(expectedRoots);
    expect(profile.workspace.visibleRoots).toEqual(expectedRoots);
    expect(profile.workspace.writableRoots).toEqual(expectedRoots);

    const overridden = buildTacticalStaffProfile({
      displayName: '自定义参谋席',
      run: { presentation: 'foreground', modelRetry: { maxRetries: 1, intervalMs: 1000 } },
    });
    expect(overridden.displayName).toBe('自定义参谋席');
    expect(overridden.run.presentation).toBe('foreground');
  });

  it('ensureStaffProfile 幂等检查：不存在时调用 save()，已存在时直接复用不重复保存', async () => {
    let savedProfile: AgentProfileDefinition | null = null;
    const load = vi.fn(async () => ({ profile: savedProfile }));
    const save = vi.fn(async (input: AgentProfileDefinition | { profile: AgentProfileDefinition }) => {
      savedProfile = 'profile' in input ? input.profile : input;
    });

    const hostWindow = createMockHostWindow({
      agent: {
        startRunFromLegacyGenerate: vi.fn(),
        profiles: {
          list: vi.fn(async () => ({ profiles: [] })),
          load,
          save,
          delete: vi.fn(async () => {}),
        },
      },
    });

    const director = createTacticalAgentDirector({ hostWindow });
    expect(director.isAvailable()).toBe(true);

    const first = await director.ensureStaffProfile();
    expect(first).toEqual({
      registered: true,
      profileId: GHQ_TACTICAL_STAFF_PROFILE_ID,
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);

    const second = await director.ensureStaffProfile();
    expect(second).toEqual({
      registered: true,
      profileId: GHQ_TACTICAL_STAFF_PROFILE_ID,
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('runStaffTask：完整执行后台参谋推演、订阅事件流并从 Workspace 取回产物文本', async () => {
    const startRunFromLegacyGenerate = vi.fn(async () => ({
      runId: 'run-advisory-01',
      status: 'running',
      workspaceId: 'ws-01',
      stableChatId: 'chat-01',
    }));

    const unsubSpy = vi.fn();
    const subscribe = vi.fn((runId: string, handler: (event: AgentRunEvent) => void) => {
      queueMicrotask(() => {
        handler({
          seq: 1,
          id: 'ev-1',
          runId,
          timestamp: '2026-10-19T08:00:00Z',
          level: 'info',
          type: 'tool_call_completed',
          payload: { tool: 'worldinfo.read_activated' },
        });
        handler({
          seq: 2,
          id: 'ev-2',
          runId,
          timestamp: '2026-10-19T08:00:01Z',
          level: 'info',
          type: 'workspace_file_written',
          payload: { path: 'output/main.md' },
        });
        handler({
          seq: 3,
          id: 'ev-3',
          runId,
          timestamp: '2026-10-19T08:00:02Z',
          level: 'info',
          type: 'run_completed',
          payload: {},
        });
      });
      return unsubSpy;
    });

    const readWorkspaceFile = vi.fn(async ({ runId, path }: { runId: string; path: string }) => ({
      path,
      text: `# 参谋推演报告 (${runId})\n优先研发重型装甲冶金。`,
      bytes: 64,
      sha256: 'abc123',
    }));

    const hostWindow = createMockHostWindow({
      agent: {
        startRunFromLegacyGenerate,
        subscribe,
        readWorkspaceFile,
        profiles: {
          list: vi.fn(async () => ({ profiles: [] })),
          load: vi.fn(async () => ({ profile: buildTacticalStaffProfile() })),
          save: vi.fn(async () => {}),
          delete: vi.fn(async () => {}),
        },
      },
    });

    const director = createTacticalAgentDirector({ hostWindow });
    const res = await director.runStaffTask({
      kind: 'research-advisory',
      objective: '分析下一阶段重工业科技优先级',
    });

    expect(startRunFromLegacyGenerate).toHaveBeenCalledWith({
      generationType: 'normal',
      profileId: GHQ_TACTICAL_STAFF_PROFILE_ID,
      stableChatId: undefined,
      generateOptions: undefined,
      presentation: 'background',
      generationIntent: {
        kind: 'research-advisory',
        objective: '分析下一阶段重工业科技优先级',
      },
      options: {
        presentation: 'background',
        stream: false,
      },
    });
    expect(readWorkspaceFile).toHaveBeenCalledWith({
      runId: 'run-advisory-01',
      path: 'output/main.md',
    });
    expect(unsubSpy).toHaveBeenCalled();
    expect(res.ok).toBe(true);
    expect(res.mode).toBe('tauritavern-agent');
    expect(res.runId).toBe('run-advisory-01');
    expect(res.outputText).toContain('优先研发重型装甲冶金');
    expect(res.events?.map(e => e.type)).toEqual([
      'tool_call_completed',
      'workspace_file_written',
      'run_completed',
    ]);
  });

  it('runStaffTask：schedule-planning 默认读取 plan/schedule.json，且支持自定义 outputPath', async () => {
    const readWorkspaceFile = vi.fn(async ({ path }: { runId: string; path: string }) => ({
      path,
      text: JSON.stringify({ queue: ['T-80U', 'Kirov'] }),
      bytes: 32,
      sha256: 'def456',
    }));

    const hostWindow = createMockHostWindow({
      agent: {
        startRunFromLegacyGenerate: vi.fn(async () => ({
          runId: 'run-sched-01',
          status: 'running',
          workspaceId: 'ws-01',
          stableChatId: 'chat-01',
        })),
        subscribe: vi.fn((runId: string, handler: (event: AgentRunEvent) => void) => {
          handler({
            seq: 1,
            id: 'ev-done',
            runId,
            timestamp: '2026-10-19T08:01:00Z',
            level: 'info',
            type: 'run_completed',
            payload: {},
          });
          return () => {};
        }),
        readWorkspaceFile,
        profiles: {
          list: vi.fn(async () => ({ profiles: [] })),
          load: vi.fn(async () => ({ profile: buildTacticalStaffProfile() })),
          save: vi.fn(async () => {}),
          delete: vi.fn(async () => {}),
        },
      },
    });

    const director = createTacticalAgentDirector({ hostWindow });
    const resDefault = await director.runStaffTask({
      kind: 'schedule-planning',
      objective: '生成两周排产计划',
    });
    expect(resDefault.ok).toBe(true);
    expect(readWorkspaceFile).toHaveBeenCalledWith({
      runId: 'run-sched-01',
      path: 'plan/schedule.json',
    });

    const resCustom = await director.runStaffTask({
      kind: 'battle-summary',
      objective: '归档第 12 轮战报',
      outputPath: 'summaries/round-12.md',
    });
    expect(resCustom.ok).toBe(true);
    expect(readWorkspaceFile).toHaveBeenCalledWith({
      runId: 'run-sched-01',
      path: 'summaries/round-12.md',
    });
  });

  it('取消与异常降级：支持 cancelRun、run_cancelled 事件、fallbackRunner 回退及无回退时 unavailable 诊断', async () => {
    // 1. 宿主不支持 api.agent 且配置了 fallbackRunner -> 走 legacy-fallback
    const fallbackRunner = vi.fn(async () => ({
      ok: true,
      mode: 'legacy-fallback' as const,
      outputText: '传统主对话回退结果',
    }));
    const legacyDirector = createTacticalAgentDirector({
      hostWindow: {},
      fallbackRunner,
    });
    expect(legacyDirector.isAvailable()).toBe(false);
    const fallbackRes = await legacyDirector.runStaffTask({
      kind: 'tactical-dice-check',
      objective: '暗网竞拍检定',
    });
    expect(fallbackRunner).toHaveBeenCalledTimes(1);
    expect(fallbackRes.ok).toBe(true);
    expect(fallbackRes.mode).toBe('legacy-fallback');
    expect(fallbackRes.fallbackReason).toContain('unavailable');

    // 2. 宿主不支持 api.agent 且未配置 fallbackRunner -> 返回 unavailable 且不抛错
    const bareDirector = createTacticalAgentDirector({ hostWindow: {} });
    const unavailRes = await bareDirector.runStaffTask({
      kind: 'research-advisory',
      objective: '无 Agent 环境测试',
    });
    expect(unavailRes).toEqual({
      ok: false,
      mode: 'unavailable',
      runId: undefined,
      status: undefined,
      events: undefined,
      fallbackReason: 'TauriTavern Agent API unavailable in current host',
    });

    // 3. cancelRun 与 run_cancelled 事件处理
    const cancel = vi.fn(async (runId: string) => ({
      runId,
      status: 'cancelled',
      workspaceId: 'ws-01',
      stableChatId: 'chat-01',
    }));
    const hostWindowCancel = createMockHostWindow({
      agent: {
        startRunFromLegacyGenerate: vi.fn(async () => ({
          runId: 'run-cancel-01',
          status: 'running',
          workspaceId: 'ws-01',
          stableChatId: 'chat-01',
        })),
        subscribe: vi.fn((runId: string, handler: (event: AgentRunEvent) => void) => {
          handler({
            seq: 1,
            id: 'ev-cancel',
            runId,
            timestamp: '2026-10-19T08:02:00Z',
            level: 'warn',
            type: 'run_cancelled',
            payload: {},
          });
          return () => {};
        }),
        cancel,
        profiles: {
          list: vi.fn(async () => ({ profiles: [] })),
          load: vi.fn(async () => ({ profile: buildTacticalStaffProfile() })),
          save: vi.fn(async () => {}),
          delete: vi.fn(async () => {}),
        },
      },
    });

    const cancelDirector = createTacticalAgentDirector({ hostWindow: hostWindowCancel });
    const cancelCall = await cancelDirector.cancelRun('run-cancel-01');
    expect(cancelCall).toEqual({
      cancelled: true,
      runId: 'run-cancel-01',
      status: 'cancelled',
    });

    const cancelledRunRes = await cancelDirector.runStaffTask({
      kind: 'battle-summary',
      objective: '被取消的战报摘要任务',
    });
    expect(cancelledRunRes.ok).toBe(false);
    expect(cancelledRunRes.status).toBe('cancelled');
    expect(cancelledRunRes.events?.map(e => e.type)).toEqual(['run_cancelled']);
  });
});

describe('PKG-D · ttSkillBundle 战区条令 .ttskill 技能包管理器', () => {
  it('BUNDLED_TACTICAL_SKILLS 包含核心条令技能包且 SKILL.md 具备合规 YAML frontmatter', () => {
    expect(GHQ_SKILL_SOURCE).toBe('extension:tavernweave-command-system');
    const names = BUNDLED_TACTICAL_SKILLS.map(s => s.name);
    expect(names).toContain('ghq-worldbook-style-guide');
    expect(names).toContain('ghq-r20-production-audit');

    for (const skill of BUNDLED_TACTICAL_SKILLS) {
      expect(skill.source).toBe(GHQ_SKILL_SOURCE);
      const skillMd = skill.files.find(f => f.path === 'SKILL.md');
      expect(skillMd).toBeDefined();
      expect(skillMd!.content).toMatch(/^---\nname:\s*\S+\ndescription:\s*.+\n---/);
    }
  });

  it('ensureBundledSkillsInstalled 支持 skip 与 replace 冲突策略，并分类统计 installed / skipped / failed', async () => {
    const installImport = vi.fn(async ({ input, conflictStrategy }) => {
      if (input.name === 'ghq-worldbook-style-guide') {
        return {
          name: input.name,
          action: conflictStrategy === 'replace' ? ('replaced' as const) : ('skipped' as const),
        };
      }
      return {
        name: input.name ?? 'unknown',
        action: 'installed' as const,
      };
    });

    const hostWindow = createMockHostWindow({
      skill: {
        installImport,
        readFile: vi.fn(),
      },
    });

    const manager = createTacticalSkillManager({ hostWindow });
    expect(manager.isAvailable()).toBe(true);

    const skipRes = await manager.ensureBundledSkillsInstalled('skip');
    expect(skipRes.available).toBe(true);
    expect(skipRes.skipped).toEqual(['ghq-worldbook-style-guide']);
    expect(skipRes.installed).toEqual(['ghq-r20-production-audit']);
    expect(skipRes.failed).toEqual([]);

    const replaceRes = await manager.ensureBundledSkillsInstalled('replace');
    expect(replaceRes.available).toBe(true);
    expect(replaceRes.installed).toEqual([
      'ghq-worldbook-style-guide',
      'ghq-r20-production-audit',
    ]);
    expect(replaceRes.skipped).toEqual([]);
  });

  it('readTacticalSkillFile 与 listInstalledTacticalSkills 正确读取和过滤，不可用时安全降级', async () => {
    const readFile = vi.fn(async ({ name, path, maxChars }) => ({
      name,
      path,
      content: `# ${name} (${path}, max=${maxChars})`,
      chars: 32,
      totalChars: 32,
      startChar: 0,
      endChar: 32,
      totalLines: 1,
      startLine: 1,
      endLine: 1,
      bytes: 32,
      sha256: 'sha-skill',
      truncated: false,
      resourceRef: `skill://${name}/${path}`,
    }));

    const list = vi.fn(async () => ({
      skills: [
        {
          name: 'ghq-worldbook-style-guide',
          description: '文风规范',
          source: GHQ_SKILL_SOURCE,
        },
        {
          name: 'ghq-r20-production-audit',
          description: 'R20 生产对账',
          source: GHQ_SKILL_SOURCE,
        },
        {
          name: 'external-unrelated-skill',
          description: '其他插件技能',
          source: 'user:custom',
        },
      ],
    }));

    const hostWindow = createMockHostWindow({
      skill: {
        installImport: vi.fn(),
        readFile,
        list,
      },
    });

    const manager = createTacticalSkillManager({ hostWindow });
    const text = await manager.readTacticalSkillFile('ghq-worldbook-style-guide', 'SKILL.md', 8000);
    expect(text).toBe('# ghq-worldbook-style-guide (SKILL.md, max=8000)');

    const installed = await manager.listInstalledTacticalSkills();
    expect(installed.map(s => s.name)).toEqual([
      'ghq-worldbook-style-guide',
      'ghq-r20-production-audit',
    ]);

    // 传统宿主不可用降级
    const legacyManager = createTacticalSkillManager({ hostWindow: {} });
    expect(legacyManager.isAvailable()).toBe(false);
    expect(await legacyManager.ensureBundledSkillsInstalled()).toEqual({
      available: false,
      installed: [],
      skipped: [],
      failed: [],
    });
    expect(await legacyManager.readTacticalSkillFile('ghq-worldbook-style-guide')).toBeNull();
    expect(await legacyManager.listInstalledTacticalSkills()).toEqual([]);
  });
});

describe('PKG-D · worldbookReader WorldInfo API 扩展方法', () => {
  it('TauriTavern WorldInfo API 可用时正确桥接 getLastActivatedEntries / subscribeActivations / openWorldbookEntry', async () => {
    const sampleBatch: WorldInfoActivationBatch = {
      timestampMs: 1700000000000,
      trigger: 'normal',
      entries: [
        {
          world: '00_核心系统',
          uid: 101,
          displayName: '科技·重型装甲冶金',
          constant: false,
          content: '<数据>...</数据>',
        },
      ],
    };

    let subHandler: ((batch: WorldInfoActivationBatch) => void) | null = null;
    const unsubSpy = vi.fn();

    const hostWindow = createMockHostWindow({
      worldInfo: {
        getLastActivation: vi.fn(async () => sampleBatch),
        subscribeActivations: vi.fn(handler => {
          subHandler = handler;
          return unsubSpy;
        }),
        openEntry: vi.fn(async ({ world, uid }) => ({
          opened: world === '00_核心系统' && uid === 101,
        })),
      },
    });

    const reader = makeWorldbookReader({
      hostWindow,
      getWorldbook: async name => [{ name: `条目·${name}`, enabled: true, content: 'ok' }],
    });

    // 原有 read / invalidate 行为 100% 保持
    expect(await reader.read('测试书')).toEqual([
      { name: '条目·测试书', enabled: true, content: 'ok' },
    ]);

    // getLastActivatedEntries
    const activated = await reader.getLastActivatedEntries();
    expect(activated).toEqual(sampleBatch.entries);

    // subscribeActivations
    const received: WorldInfoActivationBatch[] = [];
    const unsubscribe = await reader.subscribeActivations(batch => {
      received.push(batch);
    });
    expect(subHandler).not.toBeNull();
    subHandler!(sampleBatch);
    expect(received).toEqual([sampleBatch]);
    unsubscribe();
    expect(unsubSpy).toHaveBeenCalledTimes(1);

    // openWorldbookEntry
    const openOk = await reader.openWorldbookEntry({ world: '00_核心系统', uid: 101 });
    expect(openOk).toEqual({ opened: true, mode: 'tauritavern' });
  });

  it('传统 SillyTavern 宿主下 WorldInfo 扩展方法安全回退，零异常', async () => {
    const reader = makeWorldbookReader({ hostWindow: {} });
    expect(await reader.getLastActivatedEntries()).toEqual([]);

    const unsub = await reader.subscribeActivations(() => {});
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();

    const openRes = await reader.openWorldbookEntry({ world: '00_核心系统', uid: 1 });
    expect(openRes).toEqual({ opened: false, mode: 'unsupported' });
  });
});

describe('PKG-D · PanelIntegrityCheck 宿主环境与平台接口诊断区块', () => {
  it('导入 diagnoseTauriTavernHost 并渲染 data-test="tt-host-diagnostics" 区块与六大接口徽标', () => {
    expect(INTEGRITY_SFC).toMatch(
      /import\s*\{[^}]*diagnoseTauriTavernHost[^}]*\}\s*from\s*'\.\.\/host\/ttHostBridge'/,
    );
    expect(INTEGRITY_SFC).toContain('data-test="tt-host-diagnostics"');
    expect(INTEGRITY_SFC).toContain('宿主环境与平台接口状态');
    expect(INTEGRITY_SFC).toContain('TauriTavern 原生宿主');
    expect(INTEGRITY_SFC).toContain('传统 SillyTavern 宿主');

    const expectedBadges = [
      'ChatSurface 虚拟列表托管',
      'Layout 安全区视口',
      'ExtensionStore 本地存储',
      'WorldInfo 激活接口',
      'Agent 参谋运行时',
      'Skill 技能包接口',
    ];
    for (const label of expectedBadges) {
      expect(INTEGRITY_SFC).toContain(label);
    }
  });

  it('遵守静态门禁：不直接访问裸全局对象，不包含第 23 号任务包禁用词', () => {
    expect(INTEGRITY_SFC).not.toContain('__TAURITAVERN__');

    const forbiddenWords = [
      '六柱',
      '战略柱',
      '柱域',
      '协议轨道',
      'X 轨',
      '同源面板',
      '同源投影',
      '零注入语义',
      '直呈',
      '三态实例',
      '无实例驱动',
      '未投影',
      '抽象槽',
      '通用底座',
      '暂存门',
      '审核门',
      '待落盘',
      '原子热重算',
      '作用域',
    ];
    for (const word of forbiddenWords) {
      expect(INTEGRITY_SFC).not.toContain(word);
    }
  });
});
