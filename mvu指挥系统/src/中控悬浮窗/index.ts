/**
 * 中控悬浮窗 —— 长驻角色脚本入口（RAC-ENTRY-01，script-only：本目录无 index.html）
 *
 * 职责：
 * 1. shell：把自身脚本 iframe（`window.frameElement`）从 Helper 的 display:none 改为悬浮可见；
 * 2. 只读页签（档案 / 科技 / 武备 / 建筑，D-RAC-FLOAT-ARCHIVE-01 → A）挂载：档案与建筑为本目录自有面板，
 *    科技 / 武备复用楼层 UI panels；数据源 = useFloatingStore（只读，经 storeAdapter alias）；不挂 ActionBar / PanelIntel；
 * 3. §3.9 事件驱动刷新：GENERATION_ENDED / MESSAGE_SWIPED / MESSAGE_EDITED / CHAT_CHANGED → store.refresh()；
 *    CHAT_CHANGED 选 refresh 而非整页 reload——脚本 iframe 由 Helper 托管，reload 会绕过其生命周期，
 *    且本 store 本就为"换聊天后重扫最近有效楼"设计；
 * 4. advisoryRunner：研究建议注入接线（§3.5 令牌 / §3.8 配置 / 四路清理）；
 * 5. scheduleRunner：《当前工程日程》前馈注入接线（CTRL-RECONCILE-01 标准① · 案A 平行管线，同构四路清理）。
 *
 * 加载 / 卸载遵循 AGENTS.md：`$(() => ...)` 与 `$(window).on('pagehide', ...)`，禁用 DOMContentLoaded。
 */
import { createPinia } from 'pinia';
import { createApp, type App } from 'vue';
import '../红警指挥系统/ui/tailwind.entry.css';
import '../红警指挥系统/ui/global.css';
import { useFloatingStore } from '../红警指挥系统/composables/useFloatingStore';
import { ensureSystemRegexRegistry } from '../红警指挥系统/worldbook/tavernRegexPipeline';
import {
  createAdvisoryRunner,
  createStrategicFeedforwardRunner,
  type AdvisoryRunner,
} from './host/advisoryRunner';
import { installFloorCardHydrator } from './cards/floorCardHydrator';
import { installRegexInspector } from './host/regexInspector';
import { createScheduleRunner, type ScheduleRunner } from './host/scheduleRunner';
import { createSummaryRunner, type SummaryRunner } from './host/summaryRunner';
import {
  getSharedPresetPromptManager,
  type PresetPromptManager,
} from './host/presetPromptManager';
import { createTacticalAgentDirector } from './host/ttAgentDirector';
import { waitForTauriTavernReady } from './host/ttHostBridge';
import { createTacticalSkillManager } from './host/ttSkillBundle';
import { installExpansionAutoFiler } from './host/expansionAutoFiler';
import { installFloorObservers } from './host/floorObservers';
import { installGirlAutoFiler } from './host/girlAutoFiler';
import FloatingApp from './console/FloatingApp.vue';
import { createShell, defaultShellDeps, type Shell } from './host/shell';

let app: App | null = null;
let shell: Shell | null = null;
let runner: AdvisoryRunner | null = null;
let strategicFeedforwardRunner: AdvisoryRunner | null = null;
let scheduleRunner: ScheduleRunner | null = null;
let summaryRunner: SummaryRunner | null = null;
let presetPromptManager: PresetPromptManager | null = null;
let stopFloorObservers: (() => void) | null = null;
let stopExpansionFiler: (() => void) | null = null;
let stopGirlFiler: (() => void) | null = null;
let stopFloorCardHydrator: (() => void) | null = null;
let stopRegexInspector: (() => void) | null = null;

/** 脚本 iframe 的 srcdoc 不保证有 #app：缺失则自建 */
function ensureAppRoot(): HTMLElement {
  const existing = document.getElementById('app');
  if (existing) return existing;
  const root = document.createElement('div');
  root.id = 'app';
  document.body.appendChild(root);
  return root;
}

function init() {
  if (app) return;
  shell = createShell(defaultShellDeps());
  if (!window.frameElement) {
    console.warn('[中控悬浮窗] 未在 iframe 内运行，跳过 iframe 可见化（壳退化为纯状态机）');
  }

  const pinia = createPinia();
  app = createApp(FloatingApp, { shell });
  app.use(pinia).mount(ensureAppRoot());

  const store = useFloatingStore(pinia);

  // 只读诊断按需调用正式 API，不改变现有正则注册/渲染链。
  stopRegexInspector = installRegexInspector(globalThis as unknown as Record<string, unknown>, {
    read: option => {
      if (typeof getTavernRegexes !== 'function') throw new Error('regex-api-unavailable');
      return getTavernRegexes(option as TavernRegexOption);
    },
    characterEnabled: () => typeof isCharacterTavernRegexesEnabled === 'function'
      && isCharacterTavernRegexesEnabled(),
  });

  // ① 楼层解析与悬浮窗刷新观察者（中控台唯一安装点：GENERATION_ENDED / MESSAGE_SWIPED / MESSAGE_EDITED 串成 runParseFor → floating.refresh，CHAT_CHANGED 与 init 补解析）
  stopFloorObservers = installFloorObservers(store);
  // ② 扩展档案自动入档观察者（F1 · 受控例外·限定写）
  stopExpansionFiler = installExpansionAutoFiler(store);
  // ③ 机娘档案自动入档观察者（受控例外·限定写）
  stopGirlFiler = installGirlAutoFiler(store);

  void ensureSystemRegexRegistry().catch(err =>
    console.warn('[中控悬浮窗] 系统正则注册表自愈失败', err),
  );
  stopFloorCardHydrator = installFloorCardHydrator();

  void waitForTauriTavernReady().then(isTt => {
    if (!isTt) return;
    void createTacticalAgentDirector()
      .ensureStaffProfile()
      .catch(err => console.warn('[中控悬浮窗] TauriTavern 参谋部 Agent Profile 注册失败', err));
    void createTacticalSkillManager()
      .ensureBundledSkillsInstalled()
      .catch(err => console.warn('[中控悬浮窗] TauriTavern 技能包同步失败', err));
  });

  runner = createAdvisoryRunner();
  runner.start();
  strategicFeedforwardRunner = createStrategicFeedforwardRunner();
  strategicFeedforwardRunner.start();
  scheduleRunner = createScheduleRunner();
  scheduleRunner.start();
  summaryRunner = createSummaryRunner(
    () => (store.snapshot ?? (store as { data?: unknown }).data) as Record<string, unknown> | null,
  );
  summaryRunner.start();
  presetPromptManager = getSharedPresetPromptManager();
  void presetPromptManager.start().catch(err =>
    console.warn('[中控悬浮窗] 预设提示词托管器启动异常', err),
  );
  console.info('[中控悬浮窗] 已挂载：面板子集 + 研究建议接线 + 工程日程接线 + 三层摘要接线 + 预设托管与跨卡守护');
}

function teardown() {
  stopRegexInspector?.();
  stopRegexInspector = null;
  presetPromptManager?.stop();
  presetPromptManager = null;
  summaryRunner?.stop();
  summaryRunner = null;
  scheduleRunner?.stop();
  scheduleRunner = null;
  strategicFeedforwardRunner?.stop();
  strategicFeedforwardRunner = null;
  runner?.stop();
  runner = null;
  stopFloorCardHydrator?.();
  stopFloorCardHydrator = null;
  stopGirlFiler?.();
  stopGirlFiler = null;
  stopExpansionFiler?.();
  stopExpansionFiler = null;
  stopFloorObservers?.();
  stopFloorObservers = null;
  app?.unmount();
  app = null;
  shell?.destroy();
  shell = null;
  console.info('[中控悬浮窗] 已卸载');
}

const safeInit = typeof errorCatched === 'function' ? errorCatched(init) : init;
if (typeof $ === 'function') {
  $(() => safeInit());
  $(window).on('pagehide', teardown);
} else {
  safeInit();
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', teardown);
  }
}
