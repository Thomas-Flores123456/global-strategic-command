/**
 * scripts/tt-build-extension.mjs —— TauriTavern 原生第三方扩展双栖构建组装器（TT-DevKit Layer 2）
 *
 * 职责：
 * 1. 将中控悬浮窗构建产物组装输出至 `mvu指挥系统/dist/tauritavern-extension/`；
 * 2. 生成符合 TauriTavern 规范的 `manifest.json`（含 `hooks.activate = "activate"` 与 `minimum_client_version = "SillyTavern::TauriTavern"`）；
 * 3. 生成符合 ESM `hooks.activate` 契约的 `index.js` 与 `style.css`；
 * 4. 导出 `buildTauriTavernExtensionBundle` 供 Vitest 单测调用，支持直接 CLI 执行并打印 JSON 摘要。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, '..');

export const DEFAULT_TT_EXTENSION_MANIFEST = Object.freeze({
  display_name: '全域作战指挥系统 (TavernWeave Command)',
  loading_order: 50,
  js: 'index.js',
  css: 'style.css',
  author: 'GHQ-ST-Engineering',
  version: '2.0.0',
  minimum_client_version: 'SillyTavern::TauriTavern',
  hooks: {
    activate: 'activate',
  },
});

const DEFAULT_SURFACE_STYLE_CSS = `/* Toàn域作战指挥系统 · TauriTavern 原生扩展安全区与软键盘几何契约样式 */
:root {
  --tw-tt-safe-top: var(--tt-inset-top, 0px);
  --tw-tt-safe-right: var(--tt-inset-right, 0px);
  --tw-tt-safe-bottom: var(--tt-inset-bottom, 0px);
  --tw-tt-safe-left: var(--tt-inset-left, 0px);
  --tw-tt-ime-bottom: var(--tt- viewport-bottom-inset, var(--tt-ime-bottom, 0px));
}

[data-tt-mobile-surface="backdrop"] {
  inset: 0;
}

[data-tt-mobile-surface="fullscreen-window"] {
  padding-top: var(--tt-inset-top, 0px);
  padding-bottom: var(--tt-viewport-bottom-inset, var(--tt-inset-bottom, 0px));
  box-sizing: border-box;
}
`;

function createExtensionEntryEsmSource({ hasConsoleBundle }) {
  const bundleImportLine = hasConsoleBundle
    ? `if (options.standalone === true || (typeof window !== 'undefined' && window.frameElement)) {\n      await import('./console.bundle.js');\n    }`
    : `// Standalone mode: console.bundle.js not prebuilt in this directory`;

  return `/**
 * 全域作战指挥系统 (TavernWeave Command) —— TauriTavern third-party 扩展 ESM 入口
 * 自动生成自 scripts/tt-build-extension.mjs
 */

let _active = false;
let _cleanup = null;

const GHQ_PROFILE = {
  schemaVersion: 4,
  kind: 'tauritavern.agentProfile',
  id: 'ghq-tactical-staff',
  displayName: 'GHQ 战区总参谋部',
  description: '负责战区科研建议推导、工程日程排产规划、战局简报归档与战术随机检定的后台参谋运行配置。',
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
    agentSystemPrompt: '你是全域作战指挥系统战区总参谋部 AI 参谋，严格依据激活世界书与战局数据提供结构化参谋推演。',
  },
  tools: {
    allow: [
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
    ],
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
    visibleRoots: ['output', 'scratch', 'plan', 'summaries', 'persist'],
    writableRoots: ['output', 'scratch', 'plan', 'summaries', 'persist'],
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

const GHQ_SKILLS = [
  {
    kind: 'inlineFiles',
    files: [
      {
        path: 'SKILL.md',
        content: [
          '---',
          'name: ghq-worldbook-style-guide',
          'description: "《世界书文风与受控质感编写规范》摘要与 <数据> 块结构红线"',
          '---',
          '',
          '# 世界书文风与受控质感编写规范（战区条令摘要）',
          '- 每个机制词条末尾的 <数据>...</数据> 块为唯一机器可读真源，严禁破坏闭合标签或混入非协议注释。',
        ].join('\\n'),
      },
    ],
  },
  {
    kind: 'inlineFiles',
    files: [
      {
        path: 'SKILL.md',
        content: [
          '---',
          'name: ghq-r20-production-audit',
          'description: "R20 生产对账、六大战略资源与双轨代偿核算规约"',
          '---',
          '',
          '# R20 生产对账与战略资源双轨代偿核算规约',
          '- 每轮工程日程推进与产线交割必须满足 R20 对账不变量：期初库存 + 本期产出 - 本期消耗 - 代偿折算 = 期末库存。',
        ].join('\\n'),
      },
    ],
  },
];

async function waitForHostReady(win) {
  const target = win || (typeof window !== 'undefined' ? window : globalThis);
  const tt = target && target.__TAURITAVERN__;
  const ready = (tt && tt.ready) || (target && target.__TAURITAVERN_MAIN_READY__);
  if (ready && typeof ready.then === 'function') {
    try {
      await ready;
      return true;
    } catch {
      return false;
    }
  }
  return Boolean(tt);
}

async function seedHostCapabilities(win) {
  const target = win || (typeof window !== 'undefined' ? window : globalThis);
  const api = target && target.__TAURITAVERN__ && target.__TAURITAVERN__.api;
  if (!api) return;
  try {
    const profilesApi = api.agent && api.agent.profiles;
    if (profilesApi && typeof profilesApi.load === 'function' && typeof profilesApi.save === 'function') {
      const loaded = await profilesApi.load(GHQ_PROFILE.id);
      const existing = loaded && typeof loaded === 'object' && 'profile' in loaded ? loaded.profile : loaded;
      if (!existing) {
        await profilesApi.save(GHQ_PROFILE);
      }
    }
  } catch (err) {
    console.warn('[全域作战指挥系统 · TT 扩展] 参谋部 Agent Profile 预注册跳过:', err);
  }
  try {
    if (api.skill && typeof api.skill.installImport === 'function') {
      for (const skill of GHQ_SKILLS) {
        await api.skill.installImport({
          input: skill,
          conflictStrategy: 'skip',
        });
      }
    }
  } catch (err) {
    console.warn('[全域作战指挥系统 · TT 扩展] 战区条令 .ttskill 预同步跳过:', err);
  }
}

export async function activate(options = {}) {
  if (_active && !options.forceReinit) {
    return _cleanup;
  }
  const targetWin = options.win || (typeof window !== 'undefined' ? window : globalThis);
  const isTauriReady = await waitForHostReady(targetWin);
  if (targetWin && typeof targetWin === 'object') {
    targetWin.__TW_TT_NATIVE_EXTENSION_ACTIVE__ = true;
  }
  if (isTauriReady) {
    await seedHostCapabilities(targetWin);
  }
  if (typeof options.mountConsole === 'function') {
    const customCleanup = await options.mountConsole({ isTauriReady });
    _cleanup = typeof customCleanup === 'function' ? customCleanup : () => {};
  } else {
    ${bundleImportLine}
    _cleanup = () => {};
  }
  _active = true;
  const dispose = () => {
    if (!_active) return;
    _active = false;
    if (typeof _cleanup === 'function') {
      try {
        _cleanup();
      } catch {
        // Ignore cleanup errors
      }
    }
    _cleanup = null;
  };
  dispose.dispose = dispose;
  dispose.isTauriReady = isTauriReady;
  return dispose;
}

export function deactivate() {
  if (!_active) return;
  _active = false;
  if (typeof _cleanup === 'function') {
    try {
      _cleanup();
    } catch {
      // Ignore cleanup errors
    }
  }
  _cleanup = null;
}

export default { activate, deactivate };
`;
}

/**
 * 构建/组装 TauriTavern 第三方扩展目录产物
 * @param {object} [options]
 * @param {string} [options.projectRoot] 默认 `mvu指挥系统` 目录
 * @param {string} [options.outDir] 默认 `<projectRoot>/dist/tauritavern-extension`
 * @param {string} [options.sourceBundlePath] 默认 `<projectRoot>/dist/中控悬浮窗/index.js`
 * @param {string} [options.sourceCssPath] 默认 `<projectRoot>/dist/中控悬浮窗/style.css`
 */
export function buildTauriTavernExtensionBundle(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? DEFAULT_PROJECT_ROOT);
  const outDir = path.resolve(
    options.outDir ?? path.join(projectRoot, 'dist', 'tauritavern-extension'),
  );
  const sourceBundlePath = path.resolve(
    options.sourceBundlePath ?? path.join(projectRoot, 'dist', '中控悬浮窗', 'index.js'),
  );
  const sourceCssPath = path.resolve(
    options.sourceCssPath ?? path.join(projectRoot, 'dist', '中控悬浮窗', 'style.css'),
  );

  fs.mkdirSync(outDir, { recursive: true });

  const hasSourceBundle = fs.existsSync(sourceBundlePath);
  let bundleCopyPath = null;
  if (hasSourceBundle) {
    bundleCopyPath = path.join(outDir, 'console.bundle.js');
    fs.copyFileSync(sourceBundlePath, bundleCopyPath);
  }

  const manifest = structuredClone(DEFAULT_TT_EXTENSION_MANIFEST);
  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const jsPath = path.join(outDir, 'index.js');
  const entrySource = createExtensionEntryEsmSource({
    hasConsoleBundle: hasSourceBundle,
  });
  fs.writeFileSync(jsPath, entrySource, 'utf8');

  const cssPath = path.join(outDir, 'style.css');
  let cssContent = DEFAULT_SURFACE_STYLE_CSS;
  if (fs.existsSync(sourceCssPath)) {
    const extraCss = fs.readFileSync(sourceCssPath, 'utf8');
    cssContent = `${DEFAULT_SURFACE_STYLE_CSS}\n${extraCss}`;
  }
  fs.writeFileSync(cssPath, cssContent, 'utf8');

  return {
    ok: true,
    projectRoot,
    outDir,
    manifestPath,
    jsPath,
    cssPath,
    bundleCopyPath,
    hasSourceBundle,
    manifest,
  };
}

const isCliMain =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === path.resolve(__filename).toLowerCase();

if (isCliMain) {
  const result = buildTauriTavernExtensionBundle();
  console.log(JSON.stringify(result, null, 2));
}
