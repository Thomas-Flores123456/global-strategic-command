/**
 * PdaTabQuests.test.ts —— FD-29 (PKG-C) 战术 PDA 第 4 页签 PdaTabQuests.vue 全面升级单测
 *
 * 覆盖：
 * 1. 100% 保留既有 data-test / data-testid 契约、空态提示与战术备忘录保存交互；
 * 2. 在途任务卡（activeQuests）扩展字段渲染：
 *    - 分类徽章（data-test="pda-quest-category"）：主线（琥珀金）/ 紧急（告警红）/ 支线（冰蓝，默认）/ 指令 / 日常；
 *    - 发包方标签（data-test="pda-quest-issuer"）：发包: {{ quest.issuer }}；
 *    - 悬赏奖励胶囊预览（data-test="pda-quest-rewards"）：credits / intel_points / resources 各小类 / items / text；
 * 3. 「▶ 推进」快捷行动按钮（data-test="pda-quest-advance-btn"）：
 *    - 点击后向宿主 #send_textarea 写入标准推进指令并派发 input 事件；
 *    - 触发 @advance-quest emit 并在卡片展示「✓ 已填入指令框」视觉反馈；
 * 4. 「已归档作战卷宗（historyQuests）」可折叠区块（data-test="pda-quests-history-section"）：
 *    - 支持 props.quests.history 与 snapshot.quests.history 读取；
 *    - 展示已完成（✓ 已完成 + 悬赏已交割 绿标）与已失败/已取消（✕ 已失败 / ✕ 已取消 灰红标）归档卡片、完成要点与已领奖励摘要；
 *    - 支持点击标题栏折叠/展开切换。
 */

/* eslint-disable import-x/no-nodejs-modules -- 测试即时编译 SFC 临时产物 */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import { EXPANSION_KINDS, groupChatBookEntries, KIND_BADGE_CLASS, suggestPromotion } from '../models/expansionView';
import type { PdaQuestItem, PdaQuestsPayload, QuestRewardLike } from '../pda/PdaTabQuests.vue';

const QUESTS_SFC_PATH = join(__dirname, '../pda/PdaTabQuests.vue');
const QUESTS_COMPILED_PATH = join(__dirname, '../pda/PdaTabQuests.__fd29_test_ssr__.mts');
const INTEL_SFC_PATH = join(__dirname, '../pda/PdaTabIntel.vue');
const INTEL_COMPILED_PATH = join(__dirname, '../pda/PdaTabIntel.__fd32_test_ssr__.mts');

function stripTypeImports(code: string): string {
  return code
    .replace(/^import\s+type\s[\s\S]*?from\s+['"][^'"]+['"];?[\t ]*$/gm, '')
    .replace(/,\s*type\s+[A-Za-z0-9_$]+/g, '');
}

let questsCompPromise: Promise<Component> | undefined;

function loadTabQuests(): Promise<Component> {
  questsCompPromise ??= (async () => {
    const source = readFileSync(QUESTS_SFC_PATH, 'utf8');
    const { descriptor, errors } = parse(source, { filename: QUESTS_SFC_PATH });
    if (errors.length > 0) {
      throw new Error(`${QUESTS_SFC_PATH} 解析失败：${errors.map(String).join('; ')}`);
    }
    const compiled = compileScript(descriptor, {
      id: 'pdatabquestsfd29test',
      inlineTemplate: true,
      templateOptions: {
        id: 'pdatabquestsfd29test',
        scoped: descriptor.styles.some(s => s.scoped),
      },
    });
    writeFileSync(QUESTS_COMPILED_PATH, `// @ts-nocheck\n${stripTypeImports(compiled.content)}`, 'utf8');
    const mod = (await import(pathToFileURL(QUESTS_COMPILED_PATH).href)) as { default: Component };
    return mod.default;
  })();
  return questsCompPromise;
}

let intelCompPromise: Promise<Component> | undefined;

function loadTabIntel(): Promise<Component> {
  intelCompPromise ??= (async () => {
    const source = readFileSync(INTEL_SFC_PATH, 'utf8');
    const { descriptor, errors } = parse(source, { filename: INTEL_SFC_PATH });
    if (errors.length > 0) {
      throw new Error(`${INTEL_SFC_PATH} 解析失败：${errors.map(String).join('; ')}`);
    }
    const compiled = compileScript(descriptor, {
      id: 'pdatabintelfd32test',
      inlineTemplate: true,
      templateOptions: {
        id: 'pdatabintelfd32test',
        scoped: descriptor.styles.some(s => s.scoped),
      },
    });
    writeFileSync(INTEL_COMPILED_PATH, `// @ts-nocheck\n${stripTypeImports(compiled.content)}`, 'utf8');
    const mod = (await import(pathToFileURL(INTEL_COMPILED_PATH).href)) as { default: Component };
    return mod.default;
  })();
  return intelCompPromise;
}

afterAll(() => {
  for (const p of [QUESTS_COMPILED_PATH, INTEL_COMPILED_PATH]) {
    try {
      unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
});

describe('FD-29 PKG-C · PdaTabQuests 战术 PDA 第 4 页签全面升级', () => {
  const SAMPLE_ACTIVE_QUESTS: PdaQuestItem[] = [
    {
      name: '铁幕前哨·废弃货场清剿',
      category: '主线',
      status: '进行中',
      issuer: '盟军战区联席参谋部 / 白凌',
      progress: '1/3 · 已完成外围工兵侦察',
      note: '清除盘踞在废弃货运站内的游荡武装，夺取完整铁轨调度控制室',
      detail: '货运站存有可回收高纯度工业钢材与柴油储备，打通后可建立稳定的废料回收点。',
      rewards: {
        credits: 1500,
        intel_points: 15,
        resources: {
          建材: { 钢材: 300 },
          燃油: { 军用柴油: 150 },
        },
        items: ['废弃货场控制权', '区域铁轨拓扑图'],
        text: '额外解锁北坡货运支线',
      },
    },
    {
      name: '北坡防空网紧急抢修',
      category: '紧急',
      status: '进行中',
      issuer: '基地防空指挥所',
      progress: '0/2 · 待派遣工程师',
      note: '恢复东侧爱国者飞弹阵列供电回路',
      detail: '',
      rewards: {
        credits: 800,
      },
    },
    {
      name: '外围废铁例行搜集',
      progress: '进行中',
      note: '未显式指定 category 时默认回退为支线',
      detail: '',
    },
  ];

  const SAMPLE_HISTORY_QUESTS: PdaQuestItem[] = [
    {
      name: '建立一号矿石精炼厂',
      category: '主线',
      status: '已完成',
      issuer: '工程参谋部',
      progress: '1/1 · 已竣工投产',
      note: '主精炼炉已点火并接入北坡矿脉直销通道',
      detail: '',
      reward_claimed: true,
      rewards: {
        credits: 2000,
        intel_points: 10,
        resources: {
          建材: { 合金装甲板: 120 },
        },
      },
    },
    {
      name: '拦截夜幕走私车队',
      category: '支线',
      status: '已失败',
      progress: '车队已脱离战区边界',
      note: '因防空警报牵制未能及时出动快速反应部队',
      detail: '',
      reward_claimed: false,
    },
    {
      name: '旧城区临时侦察哨',
      category: '日常',
      status: '已取消',
      progress: '',
      note: '战区防线调整，侦察计划撤销',
      detail: '',
      reward_claimed: false,
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. 100% 保留既有 data-test / data-testid 契约、空态提示与备忘录交互', async () => {
    const QuestsComp = await loadTabQuests();

    // 空态验证
    const emptyHtml = await renderToString(
      createSSRApp({
        render: () =>
          h(QuestsComp, {
            quests: { active: [], done_count: 0 },
            memo: '初始战术备忘',
          }),
      }),
    );

    expect(emptyHtml).toContain('data-test="pda-tab-quests"');
    expect(emptyHtml).toContain('data-testid="pda-tab-quests"');
    expect(emptyHtml).toContain('data-test="pda-quests-section"');
    expect(emptyHtml).toContain('data-test="pda-quests-header"');
    expect(emptyHtml).toContain('data-test="pda-quests-active-count"');
    expect(emptyHtml).toContain('在途: 0');
    expect(emptyHtml).toContain('data-test="pda-quests-done-count"');
    expect(emptyHtml).toContain('已达成: 0');
    expect(emptyHtml).toContain('data-test="pda-quests-empty"');
    expect(emptyHtml).toContain('当前战区暂无在途作战任务指令');
    expect(emptyHtml).toContain('data-test="pda-quests-memo-section"');
    expect(emptyHtml).toContain('data-test="pda-quests-memo-save"');
    expect(emptyHtml).toContain('data-test="pda-quests-memo-input"');
    expect(emptyHtml).toContain('初始战术备忘');
    // 无归档任务时不渲染归档区块
    expect(emptyHtml).not.toContain('data-test="pda-quests-history-section"');

    // 验证备忘录保存事件与提示
    const onSaveMemo = vi.fn();
    const onUpdateMemo = vi.fn();
    const SetupComp = QuestsComp as Component & {
      setup?: (
        props: Record<string, unknown>,
        ctx: { expose: (exp: unknown) => void; emit: (event: string, ...args: unknown[]) => void },
      ) => unknown;
    };
    let exposed: {
      memoDraft: { value: string };
      onSaveMemo: () => void;
    } | null = null;

    SetupComp.setup?.(
      {
        quests: { active: [], done_count: 2 },
        memo: '原备忘',
      },
      {
        expose: exp => {
          exposed = exp as typeof exposed;
        },
        emit: (event, ...args) => {
          if (event === 'save-memo') onSaveMemo(args[0]);
          if (event === 'update:memo') onUpdateMemo(args[0]);
        },
      },
    );

    expect(exposed).not.toBeNull();
    exposed!.memoDraft.value = '更新后的作战备忘';
    exposed!.onSaveMemo();
    expect(onUpdateMemo).toHaveBeenCalledWith('更新后的作战备忘');
    expect(onSaveMemo).toHaveBeenCalledWith('更新后的作战备忘');
  });

  it('2. 在途任务卡渲染分类色标徽章（主线/紧急/支线）、发包方标签与悬赏奖励胶囊预览', async () => {
    const QuestsComp = await loadTabQuests();
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(QuestsComp, {
            snapshot: {
              quests: {
                active: SAMPLE_ACTIVE_QUESTS,
                done_count: 3,
              } satisfies PdaQuestsPayload,
            },
          }),
      }),
    );

    // 顶栏计数
    expect(html).toContain('在途: 3');
    expect(html).toContain('已达成: 3');
    expect(html.match(/data-test="pda-quest-card"/g)?.length).toBe(3);

    // 分类徽章与军事色标区分（主线琥珀金、紧急告警红、默认支线冰蓝）
    expect(html.match(/data-test="pda-quest-category"/g)?.length).toBe(3);
    expect(html).toContain('data-category="主线"');
    expect(html).toContain('data-category="紧急"');
    expect(html).toContain('data-category="支线"');
    expect(html).toContain('--amber');
    expect(html).toContain('--alert-bright');
    expect(html).toContain('--ice');

    // 发包方标签
    expect(html.match(/data-test="pda-quest-issuer"/g)?.length).toBe(2);
    expect(html).toContain('发包: 盟军战区联席参谋部 / 白凌');
    expect(html).toContain('发包: 基地防空指挥所');

    // 悬赏奖励胶囊预览（credits / intel_points / resources 各小类 / items / text）
    expect(html.match(/data-test="pda-quest-rewards"/g)?.length).toBe(2);
    expect(html).toContain('资金 +1500');
    expect(html).toContain('机密点 +15');
    expect(html).toContain('钢材 +300');
    expect(html).toContain('军用柴油 +150');
    expect(html).toContain('废弃货场控制权');
    expect(html).toContain('区域铁轨拓扑图');
    expect(html).toContain('额外解锁北坡货运支线');
    expect(html).toContain('资金 +800');

    // 每张在途任务卡均具备「▶ 推进」按钮
    expect(html.match(/data-test="pda-quest-advance-btn"/g)?.length).toBe(3);
    expect(html).toContain('▶ 推进');
  });

  it('3. 点击「▶ 推进」按钮将标准推进指令写入宿主 #send_textarea 并派发 input 事件，同时触发 @advance-quest 与卡片视觉反馈', async () => {
    const QuestsComp = await loadTabQuests();

    const dispatchedEvents: string[] = [];
    const fakeTextarea = {
      value: '',
      dispatchEvent: vi.fn((ev: Event) => {
        dispatchedEvents.push(ev.type);
        return true;
      }),
      focus: vi.fn(),
    };

    const prevWindow = (globalThis as Record<string, unknown>).window;
    const prevDocument = (globalThis as Record<string, unknown>).document;

    const fakeDoc = {
      querySelector: vi.fn((sel: string) => (sel === '#send_textarea' ? fakeTextarea : null)),
    };
    (globalThis as Record<string, unknown>).document = fakeDoc;
    (globalThis as Record<string, unknown>).window = {
      parent: { document: fakeDoc },
      document: fakeDoc,
    };

    try {
      const onAdvanceEmit = vi.fn();
      const SetupComp = QuestsComp as Component & {
        setup?: (
          props: Record<string, unknown>,
          ctx: { expose: (exp: unknown) => void; emit: (event: string, ...args: unknown[]) => void },
        ) => unknown;
      };
      let exposed: {
        activeQuests: { value: readonly PdaQuestItem[] };
        advancedQuestName: { value: string | null };
        onAdvanceQuest: (quest: PdaQuestItem) => string;
      } | null = null;

      SetupComp.setup?.(
        {
          quests: {
            active: SAMPLE_ACTIVE_QUESTS,
            done_count: 3,
          },
        },
        {
          expose: exp => {
            exposed = exp as typeof exposed;
          },
          emit: (event, ...args) => {
            if (event === 'advance-quest') {
              onAdvanceEmit(args[0], args[1]);
            }
          },
        },
      );

      expect(exposed).not.toBeNull();
      const targetQuest = exposed!.activeQuests.value[0];
      const commandText = exposed!.onAdvanceQuest(targetQuest);

      const expectedCommand =
        '【推进作战任务：铁幕前哨·废弃货场清剿】调配战区兵力与资源执行阶段目标——1/3 · 已完成外围工兵侦察';
      expect(commandText).toBe(expectedCommand);
      expect(fakeTextarea.value).toBe(expectedCommand);
      expect(dispatchedEvents).toContain('input');
      expect(fakeTextarea.focus).toHaveBeenCalled();

      expect(onAdvanceEmit).toHaveBeenCalledTimes(1);
      expect(onAdvanceEmit).toHaveBeenCalledWith(targetQuest, expectedCommand);
      expect(exposed!.advancedQuestName.value).toBe('铁幕前哨·废弃货场清剿');

      // 验证当 progress/note/detail 均为空时回退至「按指令推进」
      const bareQuest: PdaQuestItem = {
        name: '幽灵侦察行动',
        progress: '',
        note: '',
        detail: '',
      };
      const fallbackCmd = exposed!.onAdvanceQuest(bareQuest);
      expect(fallbackCmd).toBe('【推进作战任务：幽灵侦察行动】调配战区兵力与资源执行阶段目标——按指令推进');
      expect(fakeTextarea.value).toBe(fallbackCmd);
    } finally {
      (globalThis as Record<string, unknown>).window = prevWindow;
      (globalThis as Record<string, unknown>).document = prevDocument;
    }
  });

  it('4. 渲染「已归档作战卷宗（historyQuests）」可折叠区块：展示已完成（✓ 已完成 + 悬赏已交割）与已失败/已取消任务及折叠切换', async () => {
    const QuestsComp = await loadTabQuests();

    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(QuestsComp, {
            quests: {
              active: SAMPLE_ACTIVE_QUESTS.slice(0, 1),
              history: SAMPLE_HISTORY_QUESTS,
              done_count: 1,
            },
          }),
      }),
    );

    expect(html).toContain('data-test="pda-quests-history-section"');
    expect(html).toContain('ARCHIVED // 已归档作战卷宗');
    expect(html).toContain('归档: 3');
    expect(html.match(/data-test="pda-quest-history-card"/g)?.length).toBe(3);

    // 已完成任务：名称、✓ 已完成、悬赏已交割、完成要点、已领奖励摘要
    expect(html).toContain('建立一号矿石精炼厂');
    expect(html).toContain('✓ 已完成');
    expect(html).toContain('悬赏已交割');
    expect(html).toContain('data-test="pda-quest-history-claimed"');
    expect(html).toContain('主精炼炉已点火并接入北坡矿脉直销通道');
    expect(html).toContain('资金 +2000');
    expect(html).toContain('机密点 +10');
    expect(html).toContain('合金装甲板 +120');

    // 已失败与已取消任务：✕ 已失败 / ✕ 已取消，且仅已完成的 1 条展示悬赏已交割
    expect(html).toContain('拦截夜幕走私车队');
    expect(html).toContain('✕ 已失败');
    expect(html).toContain('旧城区临时侦察哨');
    expect(html).toContain('✕ 已取消');
    expect(html.match(/data-test="pda-quest-history-claimed"/g)?.length).toBe(1);

    // 验证 showHistory 折叠状态切换
    const SetupComp = QuestsComp as Component & {
      setup?: (
        props: Record<string, unknown>,
        ctx: { expose: (exp: unknown) => void; emit: (event: string, ...args: unknown[]) => void },
      ) => unknown;
    };
    let exposed: {
      historyQuests: { value: readonly PdaQuestItem[] };
      showHistory: { value: boolean };
    } | null = null;

    SetupComp.setup?.(
      {
        snapshot: {
          quests: {
            active: [],
            history: SAMPLE_HISTORY_QUESTS,
            done_count: 1,
          },
        },
      },
      {
        expose: exp => {
          exposed = exp as typeof exposed;
        },
        emit: () => {},
      },
    );

    expect(exposed).not.toBeNull();
    expect(exposed!.historyQuests.value.length).toBe(3);
    expect(exposed!.showHistory.value).toBe(true);
    exposed!.showHistory.value = false;
    expect(exposed!.showHistory.value).toBe(false);
  });

  it('5. FD-30 全域奖励池胶囊渲染：在途任务与归档任务均支持阵营启封、兵营/车厂解锁、兵力/载具整备、资金链、协议线索、势力、钱袋、机娘与科研助力', async () => {
    const QuestsComp = await loadTabQuests();

    const fd30ActiveQuest: PdaQuestItem = {
      name: '凛冬回响·重工车库破译与整备',
      category: '主线',
      status: '进行中',
      issuer: '联席参谋部 / 白凌',
      progress: '2/3 · 正在破译重工车库主控气闸',
      note: '夺取重工车库控制权并回收全套苏式重工资产',
      detail: '',
      rewards: {
        credits: 2000,
        intel_points: 20,
        resources: {
          建材: { 钢材: 400 },
        },
        unlock_factions: ['苏联'],
        unlock_units: [
          { name: '荒坂改装重型巡逻车', kind: '载具', producer: '战车工厂', cost: 750 },
          { name: '极地防寒突击兵', kind: '人员' },
        ],
        troops: {
          战斗工程师: 2,
        },
        vehicles: ['多功能步兵车'],
        chains: [{ name: '废弃支线废钢外运协议', rate_daily: 300 }],
        protocols: ['冰冻协议'],
        factions: [{ name: '铁道幸存者同盟', attitude: '友善' }],
        wallet: { 欧元: 1500 },
        girl_rewards: [{ name: '白凌', affection_delta: 5, traits: ['铁道调度专家', '凛冬先锋'] }],
        tech_boost: { name: '基础步兵训练学', progress_delta: 30 },
        items: ['工业支线接轨控制权'],
      } satisfies QuestRewardLike,
    };

    const fd30HistoryQuest: PdaQuestItem = {
      ...fd30ActiveQuest,
      name: '凛冬回响·先遣铁道肃清（已归档）',
      status: '已完成',
      reward_claimed: true,
    };

    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(QuestsComp, {
            quests: {
              active: [fd30ActiveQuest],
              history: [fd30HistoryQuest],
              done_count: 4,
            },
          }),
      }),
    );

    const expectedCapsuleLabels = [
      '资金 +2000',
      '机密点 +20',
      '钢材 +400',
      '🎖️ 阵营启封: 苏联',
      '🏭 战车工厂解锁: 荒坂改装重型巡逻车',
      '🏭 兵营解锁: 极地防寒突击兵',
      '🪖 兵营整备: 战斗工程师 +2',
      '🚜 车厂整备: 多功能步兵车',
      '💰 资金链: 废弃支线废钢外运协议(+300/日)',
      '📡 协议线索: 冰冻协议',
      '🤝 势力: 铁道幸存者同盟(友善)',
      '🪙 欧元 +1500',
      '💖 白凌 好感+5 [铁道调度专家/凛冬先锋]',
      '🔬 科研助力: 基础步兵训练学 +30%',
      '工业支线接轨控制权',
    ];

    for (const label of expectedCapsuleLabels) {
      expect(html).toContain(label);
    }

    // 验证在途任务与归档任务均渲染了全部 15 枚胶囊
    expect(html.match(/data-test="pda-quest-reward-pill"/g)?.length).toBe(expectedCapsuleLabels.length);
    expect(html.match(/data-test="pda-quest-history-reward-pill"/g)?.length).toBe(expectedCapsuleLabels.length);

    // 验证 expose 的 extractRewardPills 函数直接调用返回结构
    const SetupComp = QuestsComp as Component & {
      setup?: (
        props: Record<string, unknown>,
        ctx: { expose: (exp: unknown) => void; emit: (event: string, ...args: unknown[]) => void },
      ) => unknown;
    };
    let exposed: {
      extractRewardPills: (rewards?: QuestRewardLike) => { key: string; label: string; kind: string }[];
    } | null = null;

    SetupComp.setup?.(
      { quests: { active: [], done_count: 0 } },
      {
        expose: exp => {
          exposed = exp as typeof exposed;
        },
        emit: () => {},
      },
    );

    expect(exposed).not.toBeNull();
    const extracted = exposed!.extractRewardPills(fd30ActiveQuest.rewards);
    expect(extracted.map(p => p.label)).toEqual(expectedCapsuleLabels);
  });

  it('6. FD-48 PKG-C 多环系列任务链：在途任务卡与已归档历史卷宗同步渲染 [系列 · 环数] 徽章与下一环线索', async () => {
    const QuestsComp = await loadTabQuests();

    const chainActiveQuest: PdaQuestItem = {
      name: '铁幕回响·高压并网破障',
      category: '主线',
      status: '进行中',
      issuer: '联席参谋部 / 白凌',
      series: '铁幕回响',
      chain_step: '2/3',
      next_quest: '突入地下三层主控掩体唤醒休眠苏联 MCV',
      progress: '1/2 · 正在清理变电站外围警戒',
      note: '打通北郊高压并网回路，恢复重工气闸供电',
      detail: '',
      rewards: {
        credits: 2000,
      },
    };

    const chainHistoryQuest: PdaQuestItem = {
      name: '铁幕回响·冻土信标溯源',
      category: '主线',
      status: '已完成',
      issuer: '联席参谋部 / 白凌',
      series: '铁幕回响',
      chain_step: '1/3',
      next_quest: '前往北郊变电站恢复重工气闸高压并网',
      progress: '1/1 · 已破译信标坐标',
      note: '锁定地下重工掩体方位',
      detail: '',
      reward_claimed: true,
      rewards: {
        intel_points: 25,
      },
    };

    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(QuestsComp, {
            quests: {
              active: [chainActiveQuest],
              history: [chainHistoryQuest],
              done_count: 1,
            },
          }),
      }),
    );

    expect(html.match(/data-test="pda-quest-series"/g)?.length).toBe(2);
    expect(html).toContain('[铁幕回响 · 2/3]');
    expect(html).toContain('[铁幕回响 · 1/3]');

    expect(html.match(/data-test="pda-quest-next-hook"/g)?.length).toBe(2);
    expect(html).toContain('下一环线索: 突入地下三层主控掩体唤醒休眠苏联 MCV');
    expect(html).toContain('下一环线索: 前往北郊变电站恢复重工气闸高压并网');
  });
});


describe('FD-32 PKG-C · PdaTabIntel 人物名录与 expansionView 人物分支升级', () => {
  it('1. expansionView 支持 人物 分支、badge-npc 色标与聊天书条目提升分组', () => {
    expect(EXPANSION_KINDS).toEqual(['人物', '科技', '建筑', '载具', '人员', '装备', '地点', '势力']);
    expect(KIND_BADGE_CLASS['人物']).toBe('badge-npc');

    const groups = groupChatBookEntries([
      { name: '人物·阿列克谢·设定' },
      { name: '人员·磁暴步兵·设定' },
      { name: '档案·白凌·MCV' },
    ]);
    expect(groups.map(g => [g.prefix, g.promotable])).toEqual([
      ['人物', true],
      ['人员', true],
      ['档案', false],
    ]);
    expect(suggestPromotion('人物·阿列克谢·设定')).toEqual({
      bookName: '红警扩展·阿列克谢',
      entryName: '阿列克谢',
    });
  });

  it('2. PdaTabIntel 支持 kind="人物" 与 "人员" 联合过滤、势力/态度徽章、信任度进度条与 ▶ 约谈/联络此人 填入 #send_textarea', async () => {
    const IntelComp = await loadTabIntel();

    const sampleCodex = [
      {
        name: '阿列克谢',
        kind: '人物' as const,
        desc: '前苏军铁道装甲列车长，现负责北坡货运支线联络。',
        params: {
          代号: '凛冬铁锤',
          所属势力: '铁道幸存者同盟',
          身份: '战地军需联络官',
          态度: '友善',
          信任度: '78',
          状态: '北坡火车站驻防',
          性格与口吻: '言辞干练，重诺守信',
        },
      },
      {
        name: '林夏',
        kind: '人员' as const,
        desc: '随行战术通信参谋。',
        params: {
          开局职务: '战术通信官',
          信任度: '90',
          驻地: '指挥车二号席',
        },
      },
      {
        name: '相位伪装网',
        kind: '科技' as const,
        desc: '降低前哨热信号特征的光学折射涂层。',
        params: {},
      },
    ];

    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(IntelComp, {
            snapshot: {
              codex: sampleCodex,
              factions: [],
              pending_lore: [],
            },
          }),
      }),
    );

    // 过滤按钮文案升级为「人物/随行 (2)」与「图鉴/其他 (1)」
    expect(html).toContain('人物/随行 (2)');
    expect(html).toContain('图鉴/其他 (1)');

    // 人物徽章 [人物] 与 [人员]
    expect(html).toContain('[人物]');
    expect(html).toContain('[人员]');
    expect(html).toContain('阿列克谢');
    expect(html).toContain('「凛冬铁锤」');
    expect(html).toContain('战地军需联络官');

    // 势力微章、态度色标徽章、信任度进度条、当前状态/驻地
    expect(html).toContain('data-testid="pda-codex-faction"');
    expect(html).toContain('铁道幸存者同盟');
    expect(html).toContain('data-testid="pda-codex-attitude"');
    expect(html).toContain('友善');
    expect(html).toContain('data-testid="pda-codex-trust-bar"');
    expect(html).toContain('width:78%');
    expect(html).toContain('78%');
    expect(html).toContain('data-testid="pda-codex-status"');
    expect(html).toContain('北坡火车站驻防');

    // ▶ 约谈/联络此人 按钮渲染（仅人物与人员渲染，科技不渲染）
    expect(html.match(/data-testid="pda-codex-contact-btn"/g)?.length).toBe(2);
    expect(html).toContain('▶ 约谈/联络此人');

    // 验证过滤逻辑与点击联络按钮写入 #send_textarea
    const dispatchedEvents: string[] = [];
    const fakeTextarea = {
      value: '',
      dispatchEvent: vi.fn((ev: Event) => {
        dispatchedEvents.push(ev.type);
        return true;
      }),
      focus: vi.fn(),
    };
    const prevWindow = (globalThis as Record<string, unknown>).window;
    const prevDocument = (globalThis as Record<string, unknown>).document;
    const fakeDoc = {
      querySelector: vi.fn((sel: string) => (sel === '#send_textarea' ? fakeTextarea : null)),
    };
    (globalThis as Record<string, unknown>).document = fakeDoc;
    (globalThis as Record<string, unknown>).window = {
      parent: { document: fakeDoc },
      document: fakeDoc,
    };

    try {
      const onContactEmit = vi.fn();
      const SetupComp = IntelComp as Component & {
        setup?: (
          props: Record<string, unknown>,
          ctx: { expose: (exp: unknown) => void; emit: (event: string, ...args: unknown[]) => void },
        ) => unknown;
      };
      let exposed: {
        codexFilter: { value: 'all' | '人员' | 'other' };
        filteredCodexList: { value: typeof sampleCodex };
        contactedPersonName: { value: string | null };
        onContactPerson: (name: string) => string;
      } | null = null;

      SetupComp.setup?.(
        {
          snapshot: {
            codex: sampleCodex,
            factions: [],
            pending_lore: [],
          },
        },
        {
          expose: exp => {
            exposed = exp as typeof exposed;
          },
          emit: (event, ...args) => {
            if (event === 'contact-person') onContactEmit(args[0], args[1]);
          },
        },
      );

      expect(exposed).not.toBeNull();
      // 切换过滤到 '人员'（人物/随行）应同时匹配 '人物' 与 '人员'
      exposed!.codexFilter.value = '人员';
      expect(exposed!.filteredCodexList.value.map(c => c.name)).toEqual(['阿列克谢', '林夏']);
      // 切换过滤到 'other' 应仅匹配非人物/非人员
      exposed!.codexFilter.value = 'other';
      expect(exposed!.filteredCodexList.value.map(c => c.name)).toEqual(['相位伪装网']);

      // 点击联络阿列克谢
      const cmd = exposed!.onContactPerson('阿列克谢');
      const expectedCmd = '联络并约谈【阿列克谢】，就当前战区局势交换意见。';
      expect(cmd).toBe(expectedCmd);
      expect(fakeTextarea.value).toBe(expectedCmd);
      expect(dispatchedEvents).toContain('input');
      expect(dispatchedEvents).toContain('change');
      expect(exposed!.contactedPersonName.value).toBe('阿列克谢');
      expect(onContactEmit).toHaveBeenCalledWith('阿列克谢', expectedCmd);
    } finally {
      (globalThis as Record<string, unknown>).window = prevWindow;
      (globalThis as Record<string, unknown>).document = prevDocument;
    }
  });
});


describe('FD-33 PKG-C · PdaTabIntel 战区情报与世界暗流看板重塑', () => {
  const SAMPLE_INTEL_FEED = [
    {
      id: 'intel_radar_01',
      title: '北坡东翼发现热源集结',
      src: '雷达侦察',
      src_kind: '雷达侦察',
      content: '在第三矿区东北方向 12 公里处侦测到装甲集群低频引擎震动。',
      date: 'D12 18:30',
      cred: '高',
      status: '已证实',
      evolves_from: '东翼不明履带痕迹传闻',
      scope: 'tactical',
      pinned: false,
    },
    {
      id: 'evo_world_01',
      title: '极北冻土裂隙高能潮汐',
      src: '宏观广播',
      content: '西伯利亚边缘空间裂隙辐射读数连续三日攀升，多国科考队紧急撤离。',
      date: 'D12 20:00',
      cred: '中',
      scope: 'world',
      evo_domain: '位面异象',
      stage: '发酵',
      ttl_floors: 4,
      hook: '若派遣特种勘探分队前往采集裂隙样本，或可加速超时空/相位科技突破。',
      pinned: false,
    },
    {
      id: 'evo_world_02',
      title: '欧陆黑市钨芯穿甲弹紧缺',
      src: '暗网流言',
      content: '自由商团上调重型弹药基准报价 20%。',
      scope: 'world',
      evo_domain: '社会黑市',
      stage: '高潮',
      ttl_floors: 2,
      pinned: true,
    },
  ];

  it('1. 渲染 TACTICAL INTEL 战区明牌情报看板、幕后暗流计数角标、3 类子过滤器与战区情报六源/可信度/演进自', async () => {
    const IntelComp = await loadTabIntel();

    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(IntelComp, {
            snapshot: {
              intel: SAMPLE_INTEL_FEED,
              codex: [],
              factions: [],
              pending_lore: [],
            },
          }),
      }),
    );

    expect(html).toContain('data-testid="pda-tactical-intel-section"');
    expect(html).toContain('TACTICAL INTEL // 战区明牌情报');
    expect(html).toContain('data-testid="pda-world-evo-stealth-hint"');
    expect(html).toContain('🌐 幕后暗流×2（详见设置·世界演变）');
    expect(html.match(/data-testid="pda-intel-filter-tab"/g)?.length).toBe(3);
    expect(html).toContain('全部 (1)');
    expect(html).toContain('战区情报 (1)');
    expect(html).toContain('📌已置顶 (0)');

    // 1 张明牌战区情报卡片
    expect(html.match(/data-testid="pda-intel-feed-card"/g)?.length).toBe(1);

    // 战区情报：来源渠道、可信度与状态、演进自
    expect(html).toContain('data-testid="pda-intel-src-kind"');
    expect(html).toContain('📡 雷达侦察');
    expect(html).toContain('北坡东翼发现热源集结');
    expect(html).toContain('data-testid="pda-intel-cred"');
    expect(html).toContain('高 · 已证实');
    expect(html).toContain('🔗 演进自: 东翼不明履带痕迹传闻');

    // 三合一操作栏按钮
    expect(html.match(/data-testid="pda-intel-act-btn"/g)?.length).toBe(1);
    expect(html).toContain('▶ 派遣侦察/介入');
    expect(html.match(/data-testid="pda-intel-pin-btn"/g)?.length).toBe(1);
    expect(html).toContain('📌 置顶锁定');
    expect(html.match(/data-testid="pda-intel-archive-wb-btn"/g)?.length).toBe(1);
    expect(html).toContain('📥 沉淀入书');
  });

  it('2. 验证子过滤切换、点击 pda-intel-act-btn 填入 #send_textarea、点击 pda-intel-pin-btn 切换置顶锁定、点击 pda-intel-archive-wb-btn 沉淀入暂存门', async () => {
    const IntelComp = await loadTabIntel();

    const dispatchedEvents: string[] = [];
    const fakeTextarea = {
      value: '',
      dispatchEvent: vi.fn((ev: Event) => {
        dispatchedEvents.push(ev.type);
        return true;
      }),
      focus: vi.fn(),
    };
    const prevWindow = (globalThis as Record<string, unknown>).window;
    const prevDocument = (globalThis as Record<string, unknown>).document;
    const fakeDoc = {
      querySelector: vi.fn((sel: string) => (sel === '#send_textarea' ? fakeTextarea : null)),
    };
    (globalThis as Record<string, unknown>).document = fakeDoc;
    (globalThis as Record<string, unknown>).window = {
      parent: { document: fakeDoc },
      document: fakeDoc,
    };

    try {
      const onActEmit = vi.fn();
      const onPinEmit = vi.fn();
      const onArchiveEmit = vi.fn();

      const SetupComp = IntelComp as Component & {
        setup?: (
          props: Record<string, unknown>,
          ctx: { expose: (exp: unknown) => void; emit: (event: string, ...args: unknown[]) => void },
        ) => unknown;
      };
      let exposed: {
        intelFilter: { value: 'all' | 'tactical' | 'pinned' };
        filteredIntelList: { value: typeof SAMPLE_INTEL_FEED };
        worldEvolutionsList: { value: typeof SAMPLE_INTEL_FEED };
        visiblePendingLore: { value: Array<{ id: string; name: string }> };
        archivedIntelKeys: { value: Set<string> };
        isIntelPinned: (item: (typeof SAMPLE_INTEL_FEED)[number]) => boolean;
        onActIntel: (item: (typeof SAMPLE_INTEL_FEED)[number]) => string;
        onTogglePinIntel: (item: (typeof SAMPLE_INTEL_FEED)[number]) => boolean;
        onArchiveIntelToWorldbook: (item: (typeof SAMPLE_INTEL_FEED)[number]) => { id: string; name: string };
      } | null = null;

      const snapshotData = {
        intel: structuredClone(SAMPLE_INTEL_FEED),
        codex: [],
        factions: [],
        pending_lore: [],
      };

      SetupComp.setup?.(
        {
          snapshot: snapshotData,
        },
        {
          expose: exp => {
            exposed = exp as typeof exposed;
          },
          emit: (event, ...args) => {
            if (event === 'act-intel') onActEmit(args[0], args[1]);
            if (event === 'toggle-pin-intel') onPinEmit(args[0], args[1]);
            if (event === 'archive-intel-lore') onArchiveEmit(args[0], args[1]);
          },
        },
      );

      expect(exposed).not.toBeNull();

      // 1) 子过滤与幕后世界演变分离验证
      exposed!.intelFilter.value = 'tactical';
      expect(exposed!.filteredIntelList.value.map(i => i.id)).toEqual(['intel_radar_01']);
      expect(exposed!.worldEvolutionsList.value.map(i => i.id)).toEqual(['evo_world_01', 'evo_world_02']);

      exposed!.intelFilter.value = 'pinned';
      expect(exposed!.filteredIntelList.value.map(i => i.id)).toEqual([]);

      // 2) 点击战区情报「▶ 派遣侦察/介入」与世界演变「→ 转化为前线侦察指令」填入 #send_textarea
      const tacticalCmd = exposed!.onActIntel(snapshotData.intel[0]);
      expect(tacticalCmd).toBe(
        '调遣侦察与情报部门核查【雷达侦察】线报：「北坡东翼发现热源集结」，查明真伪与具体坐标。',
      );
      expect(fakeTextarea.value).toBe(tacticalCmd);
      expect(dispatchedEvents).toContain('input');
      expect(onActEmit).toHaveBeenCalledWith(snapshotData.intel[0], tacticalCmd);

      const worldCmd = exposed!.onActIntel(snapshotData.intel[1]);
      expect(worldCmd).toBe(
        '密切关注并派员介入远方动向【极北冻土裂隙高能潮汐】（位面异象·发酵），评估我方切入时机。',
      );
      expect(fakeTextarea.value).toBe(worldCmd);

      // 3) 点击「📌 置顶锁定」切换 pinned 状态
      expect(exposed!.isIntelPinned(snapshotData.intel[0])).toBe(false);
      const nextPinned = exposed!.onTogglePinIntel(snapshotData.intel[0]);
      expect(nextPinned).toBe(true);
      expect(exposed!.isIntelPinned(snapshotData.intel[0])).toBe(true);
      expect(onPinEmit).toHaveBeenCalledWith(snapshotData.intel[0], true);
      expect(exposed!.filteredIntelList.value.map(i => i.id)).toEqual(['intel_radar_01']);

      // 4) 点击「📥 沉淀入书」将情报转入 pending_lore 暂存门
      expect(exposed!.visiblePendingLore.value.length).toBe(0);
      const staged = exposed!.onArchiveIntelToWorldbook(snapshotData.intel[1]);
      expect(staged.name).toBe('极北冻土裂隙高能潮汐');
      expect(exposed!.visiblePendingLore.value.some(e => e.name === '极北冻土裂隙高能潮汐')).toBe(true);
      expect(exposed!.archivedIntelKeys.value.has('evo_world_01')).toBe(true);
      expect(onArchiveEmit).toHaveBeenCalledTimes(1);
    } finally {
      (globalThis as Record<string, unknown>).window = prevWindow;
      (globalThis as Record<string, unknown>).document = prevDocument;
    }
  });

  it('3. FD-50 PKG-C：PdaTabIntel 渲染 pda-intel-chain 胶囊徽章、pda-intel-next-lead 下一步核查线索及深挖情报链指令', async () => {
    const IntelComp = await loadTabIntel();

    const chainIntelFeed = [
      {
        id: 'intel_chain_01',
        title: '灰区黑市联络人密电截获',
        src: '电讯截获',
        src_kind: '电讯截获',
        content: '定向监听锁定黑市中间人在东区旧冷库与潜伏桩脚交接物资。',
        date: 'D14 22:15',
        cred: '中',
        status: '演进中',
        evolves_from: '黑市流传针对我方防区的悬赏询价',
        chain: '灰区反渗透甄别链',
        chain_step: '2/3',
        next_lead: '派遣内线或突击班组夜袭东区旧冷库，查获完整渗透名单',
        scope: 'tactical',
        pinned: false,
      },
    ];

    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(IntelComp, {
            snapshot: {
              intel: chainIntelFeed,
              codex: [],
              factions: [],
              pending_lore: [],
            },
          }),
      }),
    );

    expect(html).toContain('data-testid="pda-intel-chain"');
    expect(html).toContain('[情报链: 灰区反渗透甄别链 · 2/3]');
    expect(html).toContain('data-testid="pda-intel-next-lead"');
    expect(html).toContain('▸ 下一步核查线索: 派遣内线或突击班组夜袭东区旧冷库，查获完整渗透名单');

    const fakeTextarea = {
      value: '',
      dispatchEvent: vi.fn(() => true),
      focus: vi.fn(),
    };
    const prevWindow = (globalThis as Record<string, unknown>).window;
    const prevDocument = (globalThis as Record<string, unknown>).document;
    const fakeDoc = {
      querySelector: vi.fn((sel: string) => (sel === '#send_textarea' ? fakeTextarea : null)),
    };
    (globalThis as Record<string, unknown>).document = fakeDoc;
    (globalThis as Record<string, unknown>).window = {
      parent: { document: fakeDoc },
      document: fakeDoc,
    };

    try {
      const SetupComp = IntelComp as Component & {
        setup?: (
          props: Record<string, unknown>,
          ctx: { expose: (exp: unknown) => void; emit: (event: string, ...args: unknown[]) => void },
        ) => unknown;
      };
      let exposed: {
        onActIntel: (item: (typeof chainIntelFeed)[number]) => string;
      } | null = null;

      SetupComp.setup?.(
        {
          snapshot: {
            intel: chainIntelFeed,
            codex: [],
            factions: [],
            pending_lore: [],
          },
        },
        {
          expose: exp => {
            exposed = exp as typeof exposed;
          },
          emit: () => {},
        },
      );

      expect(exposed).not.toBeNull();
      const cmd = exposed!.onActIntel(chainIntelFeed[0]);
      expect(cmd).toBe(
        '【深挖情报链：灰区反渗透甄别链】调遣侦察与情报部门核查【电讯截获】线报：「灰区黑市联络人密电截获」（当前阶数：2/3），重点追查：派遣内线或突击班组夜袭东区旧冷库，查获完整渗透名单。',
      );
      expect(fakeTextarea.value).toBe(cmd);
    } finally {
      (globalThis as Record<string, unknown>).window = prevWindow;
      (globalThis as Record<string, unknown>).document = prevDocument;
    }
  });
});
