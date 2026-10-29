import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RAC_CONSOLE_GLOBAL_GUARD_NAME,
  RAC_COT_AUGMENT_PROMPT_ID,
  RAC_GLOBAL_WATCHDOG_SCRIPT_ID,
  RAC_TT_AGENT_FOUR_PHASE_PROMPT_ID,
  applyPresetPromptManagementToPreset,
  buildGlobalPresetWatchdogScriptSource,
  buildIncrementalCotPromptContent,
  buildKeminiDramatronCotPromptContent,
  createPresetPromptManager,
  deactivateManagedPromptsInPreset,
  detectPresetScenarioTag,
  findCotInsertIndex,
  isRegularPerTurnSummaryEntry,
  isSummaryPromptEntry,
  loadPresetManagerState,
  type PresetObject,
  type PresetPromptItem,
} from '../host/presetPromptManager';

function createKeminiFixturePreset(): PresetObject {
  const prompts: PresetPromptItem[] = [
    {
      id: '133b8d3a-d1a9-4a86-9602-c47631a08c23',
      name: '➡️故事设定',
      enabled: true,
      role: 'system',
      position: { type: 'relative' },
      content: '<info_settings>',
    },
    {
      id: '7ff09a80-0c4c-49e3-b05c-d0c8871523a4',
      name: '🎺大总结放置',
      enabled: false,
      role: 'system',
      position: { type: 'relative' },
      content: '<Previoushistory_summary>\n\n</Previoushistory_summary>',
    },
    {
      id: 'chatHistory',
      name: 'Chat History',
      enabled: true,
      role: 'system',
      position: { type: 'relative' },
      content: '',
    },
    {
      id: '5c2f90c2-a712-4c71-a18d-f977d69f9f36',
      name: '🌐思维链',
      enabled: true,
      role: 'system',
      position: { type: 'relative' },
      content:
        '<think_format>\n在正式创作正文前，需要使用**法语**进行以下思考\n<think>...</think>\n</think_format>',
    },
    {
      id: '2b4c7081-7c85-4462-8caf-9daf0bb6a84e',
      name: '⚙️正文添加标签',
      enabled: true,
      role: 'system',
      position: { type: 'relative' },
      content:
        '<content_format>\n正文必须前后由<正文> </正文>标签包裹，标签内正文使用简体中文\n</content_format>',
    },
    {
      id: 'fe674292-f640-4a41-9ed3-69adfae7be53',
      name: '📑摘要',
      enabled: true,
      role: 'system',
      position: { type: 'relative' },
      content:
        '<summary_format>\n每次正文结束后，紧跟着进行一段对于本次互动的正文的摘要\n<summary>...</summary>\n</summary_format>',
    },
    {
      id: '917f2343-5a05-4ce4-9cd9-bb5aa18bb10a',
      name: '⚡️不重复',
      enabled: false,
      role: 'system',
      position: { type: 'relative' },
      content: '避免重复。在思考后直接输出正文。',
    },
    {
      id: '73e632f2-e3c3-485c-89ae-87a281d63725',
      name: '⚡️卡思维链',
      enabled: false,
      role: 'assistant',
      position: { type: 'relative' },
      content:
        'Je vais procéder à la création du roman interactif, en débutant par une phase de réflexion.\n<think><|no-trans|>',
    },
    {
      id: '66da9636-4f39-4f32-ab72-4547e42c8d8c',
      name: '🎺总结前文（用完关）',
      enabled: false,
      role: 'assistant',
      position: { type: 'relative' },
      content:
        '<|no-trans|>执行总结任务\n</think>\n\n[TASK CHANGED]\n<summary_rules>...</summary_rules>',
    },
  ];
  return { prompts };
}

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

describe('presetPromptManager', () => {
  let memStorage: Storage;

  beforeEach(() => {
    memStorage = createMemoryStorage();
    (globalThis as unknown as Record<string, unknown>).localStorage =
      memStorage;
  });

  it('精准识别总结/摘要条目，并区分常规随文摘要与单次强制总结任务', () => {
    const preset = createKeminiFixturePreset();
    const summaryItems = preset.prompts.filter(isSummaryPromptEntry);
    expect(summaryItems.map(p => p.name)).toEqual([
      '🎺大总结放置',
      '📑摘要',
      '🎺总结前文（用完关）',
    ]);

    const regularItems = preset.prompts.filter(isRegularPerTurnSummaryEntry);
    expect(regularItems.map(p => p.name)).toEqual(['📑摘要']);
  });

  it('自适应探测预设中的 <正文> 与 <scenario> 包裹标签', () => {
    const kemini = createKeminiFixturePreset();
    const zhengwenSpec = detectPresetScenarioTag(kemini.prompts);
    expect(zhengwenSpec.mode).toBe('zhengwen');
    expect(zhengwenSpec.openTag).toBe('<正文>');
    expect(zhengwenSpec.closeTag).toBe('</正文>');

    const scenarioPrompts: PresetPromptItem[] = [
      {
        id: 'norm-1',
        name: '正文规范',
        enabled: true,
        role: 'system',
        content: '<scenario_norm>正文由 <scenario> </scenario> 包裹</scenario_norm>',
      },
    ];
    const scenarioSpec = detectPresetScenarioTag(scenarioPrompts);
    expect(scenarioSpec.mode).toBe('scenario');
    expect(scenarioSpec.openTag).toBe('<scenario>');
    expect(scenarioSpec.closeTag).toBe('</scenario>');
  });

  it('将增量思维链条目紧随 🌐思维链 插入（不插到末尾 assistant 卡思维链之后），并在传统酒馆与 TT Agent 模式间正确切换四阶段规约', () => {
    const preset = createKeminiFixturePreset();
    const state = loadPresetManagerState();

    // 1. 传统酒馆下：自动关闭 📑摘要，启用增量思维链，禁用 TT-Agent 四阶段规约
    const { preset: p1, receipt: r1 } = applyPresetPromptManagementToPreset(
      preset,
      {
        presetName: 'Kemini Aether-fr-3.3 (1)',
        preferences: state.preferences,
        isTauriTavern: false,
        ttAgentModeEnabled: false,
        persistedState: state,
      },
    );

    expect(r1.cotPromptEnabled).toBe(true);
    expect(r1.ttAgentPromptEnabled).toBe(false);
    // 🌐思维链 在下标 3，因此增量思维链应插在下标 4，TT-Agent 条目在下标 5
    expect(findCotInsertIndex(preset.prompts)).toBe(4);
    expect(p1.prompts[3]?.name).toBe('🌐思维链');
    expect(p1.prompts[4]?.id).toBe(RAC_COT_AUGMENT_PROMPT_ID);
    expect(p1.prompts[4]?.enabled).toBe(true);
    expect(p1.prompts[4]?.content).toContain('补充增加');
    expect(p1.prompts[4]?.content).toContain('<正文> </正文>');
    expect(p1.prompts[5]?.id).toBe(RAC_TT_AGENT_FOUR_PHASE_PROMPT_ID);
    expect(p1.prompts[5]?.enabled).toBe(false);

    // 📑摘要 已被自动关闭，且其 ID 已记入快照
    const summaryInP1 = p1.prompts.find(p => p.name === '📑摘要');
    expect(summaryInP1?.enabled).toBe(false);
    expect(state.disabledSummaryIdsByPreset['Kemini Aether-fr-3.3 (1)']).toEqual([
      'fe674292-f640-4a41-9ed3-69adfae7be53',
    ]);

    // 2. 切换到 TauriTavern 且开启 Agent 模式：自动启用 TT-Agent 四阶段规约，且内容自适应 <正文> </正文>
    const { preset: p2, receipt: r2 } = applyPresetPromptManagementToPreset(p1, {
      presetName: 'Kemini Aether-fr-3.3 (1)',
      preferences: state.preferences,
      isTauriTavern: true,
      ttAgentModeEnabled: true,
      persistedState: state,
    });
    expect(r2.ttAgentPromptEnabled).toBe(true);
    const agentInP2 = p2.prompts.find(
      p => p.id === RAC_TT_AGENT_FOUR_PHASE_PROMPT_ID,
    );
    expect(agentInP2?.enabled).toBe(true);
    expect(agentInP2?.content).toContain('scratch/plan.md');
    expect(agentInP2?.content).toContain('workspace_apply_patch');
    expect(agentInP2?.content).toContain('<正文> </正文>');
  });

  it('跨角色卡守护（cross_card_guard）在切换到其他角色卡时自动关闭中控条目并恢复开启常规 📑摘要（不误开 🎺总结前文（用完关））', () => {
    const preset = createKeminiFixturePreset();
    // 假设进入前 📑摘要 已经是关闭状态（无历史快照），但中控条目处于开启状态
    preset.prompts.find(p => p.name === '📑摘要')!.enabled = false;
    const state = loadPresetManagerState();

    const { preset: managed } = applyPresetPromptManagementToPreset(preset, {
      presetName: 'Kemini Aether-fr-3.3 (1)',
      preferences: state.preferences,
      isTauriTavern: true,
      ttAgentModeEnabled: true,
      persistedState: state,
    });

    const restored = deactivateManagedPromptsInPreset(managed, {
      presetName: 'Kemini Aether-fr-3.3 (1)',
      persistedState: state,
      mode: 'cross_card_guard',
    });

    expect(restored.changed).toBe(true);
    expect(
      restored.preset.prompts.find(p => p.id === RAC_COT_AUGMENT_PROMPT_ID)
        ?.enabled,
    ).toBe(false);
    expect(
      restored.preset.prompts.find(
        p => p.id === RAC_TT_AGENT_FOUR_PHASE_PROMPT_ID,
      )?.enabled,
    ).toBe(false);
    // 常规 📑摘要 被恢复开启
    expect(
      restored.preset.prompts.find(p => p.name === '📑摘要')?.enabled,
    ).toBe(true);
    // 用完关的强制总结任务与大总结放置绝不会被误开
    expect(
      restored.preset.prompts.find(p => p.name === '🎺总结前文（用完关）')
        ?.enabled,
    ).toBe(false);
    expect(
      restored.preset.prompts.find(p => p.name === '🎺大总结放置')?.enabled,
    ).toBe(false);
  });

  it('createPresetPromptManager 注册全局存活句柄、自动安装无 UI 全局守护脚本，并响应 TT Agent 模式实时切换', async () => {
    let activePreset = createKeminiFixturePreset();
    let globalScripts: Array<Record<string, unknown>> = [];
    let ttAgentMode = false;
    let ttAgentSubscriber: ((enabled: boolean) => void) | null = null;
    const initializedGlobals: Record<string, unknown> = {};
    const hostWin: Record<string, unknown> = { localStorage };

    const manager = createPresetPromptManager({
      getLoadedPresetName: () => 'Kemini Aether-fr-3.3 (1)',
      getPreset: () => activePreset,
      updatePresetWith: async (_name, updater) => {
        activePreset = await updater(activePreset);
        return activePreset;
      },
      getScriptTrees: () => globalScripts,
      updateScriptTreesWith: updater => {
        globalScripts = updater(globalScripts);
        return globalScripts;
      },
      initializeGlobal: (name, value) => {
        initializedGlobals[name] = value;
      },
      eventOn: vi.fn(),
      eventRemoveListener: vi.fn(),
      isTauriTavern: () => true,
      isTtAgentModeEnabled: async () => ttAgentMode,
      subscribeTtAgentMode: handler => {
        ttAgentSubscriber = handler;
        return () => {
          ttAgentSubscriber = null;
        };
      },
      hostWindow: hostWin,
    });

    const receipt = await manager.start();
    expect(receipt?.cotPromptEnabled).toBe(true);
    expect(receipt?.ttAgentPromptEnabled).toBe(false);
    expect(receipt?.globalWatchdogInstalled).toBe(true);

    // 验证无 UI 全局守护脚本已注册进 global script tree
    expect(globalScripts).toHaveLength(1);
    expect(globalScripts[0]?.id).toBe(RAC_GLOBAL_WATCHDOG_SCRIPT_ID);
    expect(globalScripts[0]?.enabled).toBe(true);
    expect(
      (globalScripts[0]?.button as { enabled?: boolean })?.enabled,
    ).toBe(false);
    expect(buildGlobalPresetWatchdogScriptSource()).toContain(
      RAC_COT_AUGMENT_PROMPT_ID,
    );

    // 验证中控台全局存活函数已注册
    const guard = initializedGlobals[RAC_CONSOLE_GLOBAL_GUARD_NAME] as {
      isActive: () => boolean;
    };
    expect(guard?.isActive()).toBe(true);
    expect(
      (hostWin.__RAC_CONSOLE_GUARD__ as { isActive: () => boolean })?.isActive(),
    ).toBe(true);

    // 模拟用户在 TauriTavern 界面开启 Agent Mode
    ttAgentMode = true;
    ttAgentSubscriber?.(true);
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(
      activePreset.prompts.find(p => p.id === RAC_TT_AGENT_FOUR_PHASE_PROMPT_ID)
        ?.enabled,
    ).toBe(true);

    // 卸载中控台后，全局存活函数返回 false
    manager.stop();
    expect(guard.isActive()).toBe(false);
    expect(hostWin.__RAC_CONSOLE_GUARD__).toBeNull();
  });

  it('针对 Kemini_Dramatron_v3.1 与 Kemini_UAU_OutputTool_Grep_v3.5：精准识别子方案、注入三段式 <thinking_format> 骨架与 <SUOT> 隔离锁、自动禁用【夏瑾】冲突正则并支持切卡还原', () => {
    const uauPreset: PresetObject = {
      prompts: [
        {
          id: 'fd9adcfd-bbbe-447e-8be6-4f1d87e50da7',
          name: '📽️ICOT（三段）',
          enabled: true,
          role: 'system',
          position: { type: 'relative' },
          content:
            '<Interleaved_thinking>\n<Interleaving>\n{{日文思考内容}}\n</Interleaving>\nNOTE: 思考内容由<thinking> </thinking>进行包裹\n</Interleaved_thinking>',
        },
        {
          id: 'c127ada4-2a95-4cb6-a5dd-ca7eed0b3080',
          name: '📽️COT（格式友好型）',
          enabled: false,
          role: 'system',
          position: { type: 'relative' },
          content: '<thinking_format><thinking>...</thinking></thinking_format>',
        },
        {
          id: 'ate-uau-toggle-effort-zero',
          name: '🔒【开关】EFFORT LEVEL: 0.00. (物理禁思，默认关闭以保留原生思维链)',
          enabled: true,
          role: 'system',
          position: { type: 'relative' },
          content: '【ToolCall引导】开关_EFFORT_ZERO',
        },
        {
          id: 'ate-uau-guide-act',
          name: '🥪【UAU引导3】User滚木自毁闭合块 (thought:true + 64词稀释)',
          enabled: true,
          role: 'user',
          position: { type: 'relative' },
          content: 'stop_condition = CLOSE_SUOT_TAG\npost_close_emission = FORBIDDEN',
        },
      ],
      extensions: {
        regex_scripts: [
          {
            id: '955823fa-3866-4f8b-b04d-684fdbf32d2e',
            scriptName: '思维链内部标签剥尖括号',
            disabled: false,
          },
          {
            id: 'df7c0375-248a-4585-930b-ef30be16a9f6',
            scriptName: '【夏瑾】行动选项2',
            disabled: false,
          },
          {
            id: 'cd7d963f-e7e1-417f-a018-44f8e34a9339',
            scriptName: '【夏瑾】行动选项1',
            disabled: false,
          },
        ],
      },
    };

    expect(findCotInsertIndex(uauPreset.prompts)).toBe(1);
    const state = loadPresetManagerState();
    const { preset: updatedUau, receipt: uauReceipt } =
      applyPresetPromptManagementToPreset(uauPreset, {
        presetName: 'Kemini_UAU_OutputTool_Grep_v3.5',
        preferences: state.preferences,
        isTauriTavern: false,
        ttAgentModeEnabled: false,
        persistedState: state,
      });

    expect(uauReceipt.detectedProfile).toBe('kemini_dramatron_uau');
    expect(uauReceipt.detectedTagSpec.mode).toBe('adaptive');
    expect(updatedUau.prompts[1]?.id).toBe(RAC_COT_AUGMENT_PROMPT_ID);
    expect(updatedUau.prompts[1]?.content).toContain('<thinking_format>');
    expect(updatedUau.prompts[1]?.content).toContain(
      '严禁在最外层先写 `<thinking>` 再写 `<Interleaving>`',
    );
    expect(updatedUau.prompts[1]?.content).toContain(
      '严禁第 2 段、第 3 段漏写 `<thinking>...</thinking>` 标签',
    );
    expect(updatedUau.prompts[1]?.content).toContain(
      '严禁将 `<摘要>`~`<选项>` 任何战报协议标签写进 `<SUOT>...</SUOT>` 内部',
    );
    expect(updatedUau.prompts[1]?.content).not.toContain('<正文>');

    // 冲突的【夏瑾】行动选项1/2 预设正则已被自动禁用，且非冲突正则保持启用
    const updatedRegexes = updatedUau.extensions?.regex_scripts as Array<
      Record<string, unknown>
    >;
    expect(updatedRegexes[0]?.disabled).toBe(false);
    expect(updatedRegexes[1]?.disabled).toBe(true);
    expect(updatedRegexes[2]?.disabled).toBe(true);
    expect(uauReceipt.disabledPresetRegexes).toHaveLength(2);

    // 模拟切换到其他角色卡（cross_card_guard）：自动恢复【夏瑾】行动选项1/2 为启用状态
    const restored = deactivateManagedPromptsInPreset(updatedUau, {
      presetName: 'Kemini_UAU_OutputTool_Grep_v3.5',
      persistedState: state,
      mode: 'cross_card_guard',
    });
    const restoredRegexes = restored.preset.extensions?.regex_scripts as Array<
      Record<string, unknown>
    >;
    expect(restoredRegexes[1]?.disabled).toBe(false);
    expect(restoredRegexes[2]?.disabled).toBe(false);

    // 验证 Kemini_Dramatron_v3.1（无 UAU 引导块）识别为 kemini_dramatron
    const dramatronOnlyPreset: PresetObject = {
      prompts: uauPreset.prompts.slice(0, 2),
      extensions: uauPreset.extensions,
    };
    const { receipt: dramatronReceipt } = applyPresetPromptManagementToPreset(
      dramatronOnlyPreset,
      {
        presetName: 'Kemini_Dramatron_v3.1',
        preferences: state.preferences,
        isTauriTavern: false,
        ttAgentModeEnabled: false,
        persistedState: state,
      },
    );
    expect(dramatronReceipt.detectedProfile).toBe('kemini_dramatron');
  });

  it('FD-45：buildIncrementalCotPromptContent 与 buildKeminiDramatronCotPromptContent 均包含 ★ [待交割收讫]、[本轮刚竣工入账] 里程碑与防重复报账核对要求', () => {
    const kemini = createKeminiFixturePreset();
    const tagSpec = detectPresetScenarioTag(kemini.prompts);
    const genericCot = buildIncrementalCotPromptContent(tagSpec, 'generic');

    expect(genericCot).toContain('2. 【阶段二：战区硬约束与叙事边界前置核对】');
    expect(genericCot).toContain('★ [待交割收讫]');
    expect(genericCot).toContain('[本轮刚竣工入账]');
    expect(genericCot).toContain('待收讫项须在正文描写交付并输出收讫声明');
    expect(genericCot).toContain('严禁重复输出 <生产> 报账标签');

    for (const profile of ['kemini_dramatron', 'kemini_dramatron_uau'] as const) {
      const dramatronCot = buildKeminiDramatronCotPromptContent(profile);
      expect(dramatronCot).toContain('★ [待交割收讫]');
      expect(dramatronCot).toContain('[本轮刚竣工入账]');
      expect(dramatronCot).toContain('重大工程阶段进度');
      expect(dramatronCot).toContain('严禁重复输出 <生产> 报账标签');
    }
  });

  it('FD-47：buildIncrementalCotPromptContent 与 buildKeminiDramatronCotPromptContent 均包含 <任务> 进度推进/完结交割（按承诺悬赏兑现）及 ★ [参谋部候选派发任务提案] 核对锚点', () => {
    const kemini = createKeminiFixturePreset();
    const tagSpec = detectPresetScenarioTag(kemini.prompts);

    for (const profile of ['generic', 'kemini_aether'] as const) {
      const cot = buildIncrementalCotPromptContent(tagSpec, profile);
      expect(cot).toContain('核对前馈视图【五、作战任务与外交势力】');
      expect(cot).toContain(
        '若指挥官本轮行动推进或达成了在途 <任务>，须输出 <任务> 更新进度或设为「已完成」兑现原定承诺悬赏',
      );
      expect(cot).toContain('★ [参谋部候选派发任务提案]');
      expect(cot).toContain('无任务变动轮次严禁复读在途任务表');
    }

    for (const profile of ['kemini_dramatron', 'kemini_dramatron_uau'] as const) {
      const dramatronCot = buildKeminiDramatronCotPromptContent(profile);
      expect(dramatronCot).toContain(
        '在途 <任务> 进度推进/完结交割（按承诺悬赏兑现）及前馈 ★ [参谋部候选派发任务提案] 按需发布',
      );
      expect(dramatronCot).toContain('设为「已完成」兑现原定承诺悬赏');
      expect(dramatronCot).toContain('按需输出 <任务> 发布新任务');
    }
  });

  it('FD-47：PanelFeedforwardSettings.vue 预览统计栏（ff-preview-stats）联动展示在途任务数与候选任务提案数（含安全回退 0）', () => {
    const panelSfc = readFileSync(
      join(__dirname, '..', 'panels/PanelFeedforwardSettings.vue'),
      'utf8',
    );
    expect(panelSfc).toContain('data-test="ff-preview-stats"');
    expect(panelSfc).toContain('data-test="ff-preview-quests"');
    expect(panelSfc).toContain('effectiveStatData.quests?.active?.length ?? 0');
    expect(panelSfc).toContain(
      '(previewFeedforward as { questRecommendations?: unknown[] })?.questRecommendations?.length ?? 0',
    );
  });

  it('FD-49：buildIncrementalCotPromptContent 与 buildKeminiDramatronCotPromptContent 均包含 <扩展档案>/<图鉴> 防乱写自检提示与触发词禁填泛词/裸字母约束', () => {
    const kemini = createKeminiFixturePreset();
    const tagSpec = detectPresetScenarioTag(kemini.prompts);

    for (const profile of ['generic', 'kemini_aether'] as const) {
      const cot = buildIncrementalCotPromptContent(tagSpec, profile);
      expect(cot).toContain('若本轮拟输出 <扩展档案> 或 <图鉴>');
      expect(cot).toContain(
        '既有标准科技/建筑/兵种严禁写入 <图鉴>/<扩展档案>',
      );
      expect(cot).toContain('既有装备改装走 <数据更新>');
      expect(cot).toContain('在编机娘日常变动走 <机娘>');
      expect(cot).toContain('扩展档案触发词仅填专名、禁填泛词与裸字母');
    }

    for (const profile of ['kemini_dramatron', 'kemini_dramatron_uau'] as const) {
      const dramatronCot = buildKeminiDramatronCotPromptContent(profile);
      expect(dramatronCot).toContain('若本轮拟输出 <扩展档案> 或 <图鉴>');
      expect(dramatronCot).toContain(
        '既有标准科技/建筑/兵种严禁写入 <图鉴>/<扩展档案>',
      );
      expect(dramatronCot).toContain('既有装备改装走 <数据更新>');
      expect(dramatronCot).toContain('在编机娘日常变动走 <机娘>');
      expect(dramatronCot).toContain('扩展档案触发词仅填专名、禁填泛词与裸字母');
    }
  });

  it('FD-50：buildIncrementalCotPromptContent 与 buildKeminiDramatronCotPromptContent 均包含在途 <情报> 多阶溯源链跨渠道印证升阶、水落石出转化与预设方向仅作参考自检锚点', () => {
    const kemini = createKeminiFixturePreset();
    const tagSpec = detectPresetScenarioTag(kemini.prompts);

    for (const profile of ['generic', 'kemini_aether'] as const) {
      const cot = buildIncrementalCotPromptContent(tagSpec, profile);
      expect(cot).toContain('同步核对在途 <情报> 多阶溯源链');
      expect(cot).toContain('可通过异源渠道交叉印证升阶更新');
      expect(cot).toContain('终阶水落石出（已证实）时可顺势派生关联 <任务>');
      expect(cot).toContain('所有预设任务/情报链方向仅作参考、严禁机械照抄标题，须结合现场态势自主发挥');
    }

    for (const profile of ['kemini_dramatron', 'kemini_dramatron_uau'] as const) {
      const dramatronCot = buildKeminiDramatronCotPromptContent(profile);
      expect(dramatronCot).toContain('在途 <情报> 多阶溯源链可通过异源渠道交叉印证升阶更新');
      expect(dramatronCot).toContain('终阶水落石出（已证实）时可顺势派生关联 <任务>/<扩展档案>/<协议> 线索');
      expect(dramatronCot).toContain('所有预设任务/情报链方向仅作参考、严禁机械照抄标题，须结合现场态势自主发挥');
    }
  });
});
