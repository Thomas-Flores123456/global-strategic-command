/**
 * ModalCardUpdate.test.ts —— FD-47 / FD-48 (W4) 强制备份拦截弹窗、设置面板与外壳受控热更新单测
 *
 * 覆盖：
 * 1. Gate 1 静态视觉五项清零门禁与 FD-46 / FD-48 零机器味文案纪律；
 * 2. ModalCardUpdate.vue 顶部展示「系统已默认关闭自动更新（仅检测新版本）」提示，并在 hasBreakingSaveChange === true 时渲染高危横幅与 breakingWarnings；
 * 3. 第一步战局全量备份（btn-backup-full / btn-backup-only）完成后点亮 badge-backup-completed (hasCompletedBackup = true)，解锁第二步 btn-trigger-local-update；
 * 4. 第二步点击 btn-trigger-local-update（或一键串联 btn-backup-and-update）优先调用 triggerLocalServerUpdate({ confirmBackupCompleted: true }) 并展示热更新步骤回执；本地服务离线时展示【一键更新.bat】友好指引；
 * 5. 未备份且未勾选 chk-force-update-ack 时，高危更新按钮处于 disabled 状态；勾选后可解锁执行；
 * 6. PanelExportSave.vue 移除静默自动更新开关，展示「更新策略：仅检测新版本（已关闭自动覆盖）」与「本地启动服务（端口 5500）：在线 / 待连接」徽标，支持 checkCardUpdateViaLocalOrRemote 与一键备份并通知本地服务更新；
 * 7. FloatingApp.vue 接入 runStartupUpdateFlow 与 handleConfirmCardUpdate 本地服务优先热更新闭环。
 */

/* eslint-disable import-x/no-nodejs-modules -- 测试中读取并即时编译 SFC */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules */
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRenderer, h, nextTick, reactive, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import type { UpdateCheckResult } from '../host/cardUpdateEngine';

const callOrder: string[] = [];

const mockBuildCurrentSavePack = vi.fn();
const mockDownloadSavePackAsFile = vi.fn();
const mockBackupBoundWorldbooks = vi.fn();
const mockExecuteOneClickBackup = vi.fn();
const mockRestoreSavePackInPlace = vi.fn();
const mockReadCurrentChatSaveSchema = vi.fn(() => 2);

const mockCardUpdateState = reactive<{
  busy: boolean;
  stage: string;
  stageDetail: string;
  lastError: string | null;
  lastCheck: UpdateCheckResult | null;
  shouldPromptModal: boolean;
  localServerOnline?: boolean;
  modalOpen?: boolean;
}>({
  busy: false,
  stage: 'idle',
  stageDetail: '',
  lastError: null,
  lastCheck: null,
  shouldPromptModal: false,
  localServerOnline: true,
});

const mockPrefs = reactive({
  manifestUrl: 'https://testingcf.jsdelivr.net/gh/example/card@main/manifest-v1.json',
  checkOnStartup: true,
  autoUpdateSilent: false,
  ignoredVersion: '',
});

const mockGetCardUpdatePreferences = vi.fn(() => ({ ...mockPrefs }));
const mockSetCardUpdatePreferences = vi.fn((patch: Record<string, unknown>) => {
  Object.assign(mockPrefs, patch);
  return { ...mockPrefs };
});
const mockCheckCardUpdate = vi.fn();
const mockCheckCardUpdateViaLocalOrRemote = vi.fn();
const mockTriggerLocalServerUpdate = vi.fn();
const mockProbeLocalServerVersionStatus = vi.fn();
const mockPerformSafeCardUpdate = vi.fn();
const mockDismissCardUpdatePrompt = vi.fn();
const mockFloatingRefresh = vi.fn().mockResolvedValue(undefined);

vi.mock('../host/saveBackupService', () => ({
  CURRENT_SAVE_SCHEMA: 2,
  buildCurrentSavePack: (...args: unknown[]) => {
    callOrder.push('buildCurrentSavePack');
    return mockBuildCurrentSavePack(...args);
  },
  downloadSavePackAsFile: (...args: unknown[]) => {
    callOrder.push('downloadSavePackAsFile');
    return mockDownloadSavePackAsFile(...args);
  },
  backupBoundWorldbooks: (...args: unknown[]) => {
    callOrder.push('backupBoundWorldbooks');
    return mockBackupBoundWorldbooks(...args);
  },
  executeOneClickBackup: (...args: unknown[]) => {
    callOrder.push('executeOneClickBackup');
    return mockExecuteOneClickBackup(...args);
  },
  restoreSavePackInPlace: (...args: unknown[]) => {
    callOrder.push('restoreSavePackInPlace');
    return mockRestoreSavePackInPlace(...args);
  },
  readCurrentChatSaveSchema: () => mockReadCurrentChatSaveSchema(),
}));

vi.mock('../host/cardUpdateEngine', () => ({
  cardUpdateState: mockCardUpdateState,
  getCardUpdatePreferences: () => mockGetCardUpdatePreferences(),
  setCardUpdatePreferences: (patch: Record<string, unknown>) => mockSetCardUpdatePreferences(patch),
  checkCardUpdate: (...args: unknown[]) => {
    callOrder.push('checkCardUpdate');
    return mockCheckCardUpdate(...args);
  },
  checkCardUpdateViaLocalOrRemote: (...args: unknown[]) => {
    callOrder.push('checkCardUpdateViaLocalOrRemote');
    return mockCheckCardUpdateViaLocalOrRemote(...args);
  },
  triggerLocalServerUpdate: (...args: unknown[]) => {
    callOrder.push('triggerLocalServerUpdate');
    return mockTriggerLocalServerUpdate(...args);
  },
  probeLocalServerVersionStatus: (...args: unknown[]) => {
    callOrder.push('probeLocalServerVersionStatus');
    return mockProbeLocalServerVersionStatus(...args);
  },
  performSafeCardUpdate: (...args: unknown[]) => {
    callOrder.push('performSafeCardUpdate');
    return mockPerformSafeCardUpdate(...args);
  },
  dismissCardUpdatePrompt: (...args: unknown[]) => {
    callOrder.push('dismissCardUpdatePrompt');
    return mockDismissCardUpdatePrompt(...args);
  },
}));

vi.mock('../../红警指挥系统/composables/store', () => ({
  in_tavern: true,
  useDataStore: () => ({ stat: {} }),
}));

vi.mock('../../红警指挥系统/composables/useFloatingStore', () => ({
  useFloatingStore: () => ({
    snapshot: null,
    refresh: mockFloatingRefresh,
  }),
}));

vi.mock('../../红警指挥系统/ui/motion/useGsapMotion', () => ({
  useTacticalModalMotion: () => undefined,
}));

vi.mock('../../红警指挥系统/ui/Icon.vue', async () => {
  const { h: hh } = await import('vue');
  return { default: { name: 'Icon', props: ['name', 'size'], render: () => hh('span') } };
});

const DIR = join(__dirname, '..');
const MODAL_SFC_PATH = join(DIR, 'modals/ModalCardUpdate.vue');
const MODAL_COMPILED_PATH = join(DIR, 'modals/ModalCardUpdate.__fd48_test__.mts');
const PANEL_SFC_PATH = join(DIR, 'panels/PanelExportSave.vue');
const PANEL_COMPILED_PATH = join(DIR, 'panels/PanelExportSave.__fd48_test__.mts');
const FLOATING_APP_SFC_PATH = join(DIR, 'console/FloatingApp.vue');

function stripTypeImports(code: string): string {
  return code
    .replace(/^import\s+type\s[\s\S]*?from\s+['"][^'"]+['"];?[\t ]*$/gm, '')
    .replace(/,\s*type\s+[A-Za-z0-9_$]+/g, '');
}

let modalCompPromise: Promise<Component> | undefined;
let panelCompPromise: Promise<Component> | undefined;

function loadModalCardUpdate(): Promise<Component> {
  modalCompPromise ??= (async () => {
    const source = readFileSync(MODAL_SFC_PATH, 'utf8');
    const { descriptor, errors } = parse(source, { filename: MODAL_SFC_PATH });
    if (errors.length > 0) {
      throw new Error(`${MODAL_SFC_PATH} 解析失败：${errors.map(String).join('; ')}`);
    }
    const compiled = compileScript(descriptor, {
      id: 'modalcardupdatefd48',
      inlineTemplate: true,
      templateOptions: {
        id: 'modalcardupdatefd48',
        scoped: descriptor.styles.some(s => s.scoped),
      },
    });
    writeFileSync(MODAL_COMPILED_PATH, `// @ts-nocheck\n${stripTypeImports(compiled.content)}`, 'utf8');
    const mod = (await import(pathToFileURL(MODAL_COMPILED_PATH).href)) as { default: Component };
    return mod.default;
  })();
  return modalCompPromise;
}

function loadPanelExportSave(): Promise<Component> {
  panelCompPromise ??= (async () => {
    const source = readFileSync(PANEL_SFC_PATH, 'utf8');
    const { descriptor, errors } = parse(source, { filename: PANEL_SFC_PATH });
    if (errors.length > 0) {
      throw new Error(`${PANEL_SFC_PATH} 解析失败：${errors.map(String).join('; ')}`);
    }
    const compiled = compileScript(descriptor, {
      id: 'panelexportsavefd48',
      inlineTemplate: true,
      templateOptions: {
        id: 'panelexportsavefd48',
        scoped: descriptor.styles.some(s => s.scoped),
      },
    });
    writeFileSync(PANEL_COMPILED_PATH, `// @ts-nocheck\n${stripTypeImports(compiled.content)}`, 'utf8');
    const mod = (await import(pathToFileURL(PANEL_COMPILED_PATH).href)) as { default: Component };
    return mod.default;
  })();
  return panelCompPromise;
}

afterAll(() => {
  for (const p of [MODAL_COMPILED_PATH, PANEL_COMPILED_PATH]) {
    try {
      unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
});

interface VElement {
  kind: 'element';
  tag: string;
  attrs: Record<string, string>;
  listeners: Record<string, (...args: unknown[]) => unknown>;
  children: VNodeItem[];
  parent: VElement | null;
}
interface VText {
  kind: 'text';
  text: string;
  parent: VElement | null;
}
type VNodeItem = VElement | VText;

function makeElement(tag: string): VElement {
  return { kind: 'element', tag, attrs: {}, listeners: {}, children: [], parent: null };
}

function getText(node: VNodeItem): string {
  if (node.kind === 'text') return node.text;
  return node.children.map(getText).join('');
}

function findByDataTest(root: VElement, dataTest: string): VElement | undefined {
  let found: VElement | undefined;
  const walk = (el: VElement) => {
    if (found) return;
    if (el.attrs['data-test'] === dataTest || el.attrs['data-testid'] === dataTest) {
      found = el;
      return;
    }
    for (const c of el.children) {
      if (c.kind === 'element') walk(c);
    }
  };
  walk(root);
  return found;
}

function findAllByDataTest(root: VElement, dataTest: string): VElement[] {
  const list: VElement[] = [];
  const walk = (el: VElement) => {
    if (el.attrs['data-test'] === dataTest || el.attrs['data-testid'] === dataTest) {
      list.push(el);
    }
    for (const c of el.children) {
      if (c.kind === 'element') walk(c);
    }
  };
  walk(root);
  return list;
}

function mountComponent(Comp: Component, props: Record<string, unknown> = {}) {
  const renderer = createRenderer<VNodeItem, VElement>({
    createElement: tag => makeElement(tag),
    createText: text => ({ kind: 'text', text, parent: null }),
    createComment: text => ({ kind: 'text', text: `<!--${text}-->`, parent: null }),
    setText: (node, text) => {
      if (node.kind === 'text') node.text = text;
    },
    setElementText: (el, text) => {
      el.children = [{ kind: 'text', text, parent: el }];
    },
    insert: (child, parent, anchor) => {
      child.parent = parent;
      const idx = anchor ? parent.children.indexOf(anchor) : -1;
      if (idx >= 0) parent.children.splice(idx, 0, child);
      else parent.children.push(child);
    },
    remove: child => {
      if (!child.parent) return;
      const idx = child.parent.children.indexOf(child);
      if (idx >= 0) child.parent.children.splice(idx, 1);
      child.parent = null;
    },
    parentNode: node => node.parent,
    nextSibling: node => {
      if (!node.parent) return null;
      const idx = node.parent.children.indexOf(node);
      return node.parent.children[idx + 1] ?? null;
    },
    patchProp: (el, key, _prev, next) => {
      if (key.startsWith('on') && key.length > 2) {
        if (typeof next === 'function') {
          el.listeners[key] = next as (...args: unknown[]) => unknown;
        } else if (Array.isArray(next)) {
          el.listeners[key] = (...args: unknown[]) => {
            for (const fn of next) {
              if (typeof fn === 'function') fn(...args);
            }
          };
        } else {
          delete el.listeners[key];
        }
        return;
      }
      if (next === null || next === undefined || next === false) {
        delete el.attrs[key];
      } else {
        el.attrs[key] = String(next);
      }
    },
  });

  const root = makeElement('div');
  const app = renderer.createApp({
    render: () => h(Comp, props),
  });
  app.mount(root);
  return { root, app };
}

function makeBreakingCheckResult(): UpdateCheckResult {
  return {
    checkedAt: '2026-10-28T10:00:00.000Z',
    localVersion: '1.0.0',
    latestVersion: '1.2.0',
    localSaveSchema: 2,
    remoteSaveSchema: 3,
    hasUpdate: true,
    hasBreakingSaveChange: true,
    hasLegacyChatSaveMismatch: false,
    resolvedCardUrls: [],
    missedReleases: [
      {
        version: '1.2.0',
        date: '2026-10-28',
        breaking_save: false,
        save_schema: 3,
        notes: ['新增超视距雷达巡航模式', '优化多基地电力调配响应'],
      },
      {
        version: '1.1.0',
        date: '2026-10-20',
        breaking_save: true,
        save_schema: 3,
        save_warning: '基地驻防字段升级为多维账本，旧战局请务必先备份再升级',
        notes: '重构分基地驻防与后勤补给数据结构',
      },
    ],
    breakingWarnings: [
      '[v1.1.0] 基地驻防字段升级为多维账本，旧战局请务必先备份再升级',
      '新版存档结构已由第 2 代升级至第 3 代，请先导出战局备份',
    ],
  };
}

function makeNormalCheckResult(): UpdateCheckResult {
  return {
    checkedAt: '2026-10-28T10:00:00.000Z',
    localVersion: '1.1.0',
    latestVersion: '1.2.0',
    localSaveSchema: 2,
    remoteSaveSchema: 2,
    hasUpdate: true,
    hasBreakingSaveChange: false,
    hasLegacyChatSaveMismatch: false,
    resolvedCardUrls: [],
    missedReleases: [
      {
        version: '1.2.0',
        date: '2026-10-28',
        breaking_save: false,
        save_schema: 2,
        notes: ['修复战区天气播报显示细节'],
      },
    ],
    breakingWarnings: [],
  };
}

describe('FD-48 W4 · Gate 1 静态视觉五项清零与零机器味文案门禁', () => {
  const HEX_COLOR_RE = /#[0-9a-fA-F]{3,8}\b/g;
  const RGBA_COLOR_RE = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,[^)]+\)/g;
  const TW_PALETTE_RE =
    /\b(?:text|bg|border|ring|fill|stroke|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;
  const SMALL_FONT_RE =
    /text-\[(?:[0-9]|10)(?:\.\d+)?px\]|font-size:\s*(?:[0-9]|10)(?:\.\d+)?px/g;
  const EMOJI_RE = /\p{Extended_Pictographic}|[\u2600-\u27BF]/gu;
  const FORBIDDEN_JARGON_RE =
    /save_schema|breaking_save|manifest\.json|ccv3|tEXt|finishImport|revokeObjectURL|git pull|porcelain|StatData|Schema v2|WeakMap|水合|幂等/g;

  for (const [label, filePath] of [
    ['ModalCardUpdate.vue', MODAL_SFC_PATH],
    ['PanelExportSave.vue', PANEL_SFC_PATH],
    ['FloatingApp.vue', FLOATING_APP_SFC_PATH],
  ] as const) {
    it(`${label} 通过 obuiStyleGate 五项清零与 FD-48 禁用机器词静态检查`, () => {
      const content = readFileSync(filePath, 'utf8');
      expect(content.match(HEX_COLOR_RE) ?? []).toEqual([]);

      const badRgba: string[] = [];
      for (const m of content.matchAll(RGBA_COLOR_RE)) {
        if (Number(m[1]) !== 0 || Number(m[2]) !== 0 || Number(m[3]) !== 0) {
          badRgba.push(m[0]);
        }
      }
      expect(badRgba).toEqual([]);
      expect(content.match(TW_PALETTE_RE) ?? []).toEqual([]);
      expect(content.match(SMALL_FONT_RE) ?? []).toEqual([]);
      expect(content.match(EMOJI_RE) ?? []).toEqual([]);

      if (label !== 'FloatingApp.vue') {
        expect(content.match(FORBIDDEN_JARGON_RE) ?? []).toEqual([]);
      } else {
        const templatePart = content.match(/<template>[\s\S]*<\/template>/)?.[0] ?? '';
        expect(templatePart.match(FORBIDDEN_JARGON_RE) ?? []).toEqual([]);
      }
    });
  }
});

describe('FD-48 W4 · ModalCardUpdate.vue 只检不更提示、两步走备份与本地服务受控热更新', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    callOrder.length = 0;
    mockCardUpdateState.busy = false;
    mockCardUpdateState.stage = 'idle';
    mockCardUpdateState.stageDetail = '';
    mockCardUpdateState.lastError = null;
    mockCardUpdateState.lastCheck = null;
    mockCardUpdateState.shouldPromptModal = false;
    mockCardUpdateState.localServerOnline = true;
    vi.clearAllMocks();
  });

  it('1. 渲染只检不更策略横幅 detect-only-policy-banner，并在 hasBreakingSaveChange === true 时展示高危横幅与全部警告', async () => {
    const Comp = await loadModalCardUpdate();
    const checkResult = makeBreakingCheckResult();
    const { root } = mountComponent(Comp, {
      open: true,
      checkResult,
    });

    const policyBanner = findByDataTest(root, 'detect-only-policy-banner');
    expect(policyBanner).toBeDefined();
    expect(getText(policyBanner!)).toContain(
      '系统已默认关闭自动更新（仅检测新版本）。检测到版本更新，请先备份当前战局档案，再执行本地服务同步更新。',
    );

    const banner = findByDataTest(root, 'breaking-save-alert-banner');
    expect(banner).toBeDefined();
    expect(getText(banner!)).toContain(
      '★ 发现涉及战局存档结构的角色卡新版本 (v1.0.0 ▸ v1.2.0)',
    );

    const warnList = findByDataTest(root, 'breaking-warnings-list');
    expect(warnList).toBeDefined();
    expect(findAllByDataTest(root, 'breaking-warning-item')).toHaveLength(2);

    // 未完成第一步备份且未勾选确认前，第二步主更新按钮处于禁用状态
    const triggerLocalBtn = findByDataTest(root, 'btn-trigger-local-update')!;
    expect(triggerLocalBtn.attrs.disabled).toBe('true');
  });

  it('2. 第一步完成备份后点亮 badge-backup-completed 并解锁第二步，点击通知本地服务更新展示热更新回执；离线时展示【一键更新.bat】指引', async () => {
    const Comp = await loadModalCardUpdate();
    const checkResult = makeBreakingCheckResult();
    const onUpdated = vi.fn();

    mockExecuteOneClickBackup.mockResolvedValueOnce({
      ok: true,
      fileName: '红警战局备份_v1.0.0_楼4.json',
      fileDownloaded: true,
      clipboardCopied: true,
      clonedWorldbooks: ['红警主世界书_v1.0.0备份'],
      floorId: 4,
    });

    const { root } = mountComponent(Comp, {
      open: true,
      checkResult,
      onUpdated,
    });

    // 第一步：点击「一键下载战局备份 (.json) + 克隆世界书」
    const backupFullBtn = findByDataTest(root, 'btn-backup-full')!;
    await backupFullBtn.listeners.onClick?.();
    await nextTick();

    expect(mockExecuteOneClickBackup).toHaveBeenCalledWith({
      downloadFile: true,
      copyToClipboard: true,
      cloneWorldbooks: true,
      versionTag: '1.0.0',
    });
    expect(findByDataTest(root, 'badge-backup-completed')).toBeDefined();

    // 第二步按钮已自动解锁
    const triggerLocalBtn = findByDataTest(root, 'btn-trigger-local-update')!;
    expect(triggerLocalBtn.attrs.disabled).toBeUndefined();

    // 点击第二步「已完成备份，通知本地服务拉取更新并重编译」
    mockTriggerLocalServerUpdate.mockResolvedValueOnce({
      ok: true,
      previousVersion: '1.0.0',
      currentVersion: '1.2.0',
      steps: ['本地工作区检查通过', '已拉取最新代码并完成前端重编译'],
    });
    await triggerLocalBtn.listeners.onClick?.();
    await nextTick();

    expect(mockTriggerLocalServerUpdate).toHaveBeenCalledWith({ confirmBackupCompleted: true });
    expect(onUpdated).toHaveBeenCalledWith('1.2.0');
    const localReceipt = findByDataTest(root, 'local-update-receipt');
    expect(localReceipt).toBeDefined();
    expect(getText(localReceipt!)).toContain(
      '本地服务已完成拉取与重编译，世界书已自动同步，请刷新页面生效',
    );
    expect(getText(localReceipt!)).toContain('v1.0.0 ▸ v1.2.0');

    // 当本地服务返回离线时，展示【一键更新.bat】友好指引
    mockTriggerLocalServerUpdate.mockResolvedValueOnce({
      ok: false,
      offline: true,
      message: '本地启动服务未连接',
    });
    await triggerLocalBtn.listeners.onClick?.();
    await nextTick();

    const offlineGuide = findByDataTest(root, 'local-update-offline-guide');
    expect(offlineGuide).toBeDefined();
    expect(getText(offlineGuide!)).toContain('【一键更新.bat】');
  });

  it('3. 点击 btn-backup-and-update 一键串联时先执行备份再调用 triggerLocalServerUpdate；备份失败则中止且绝不触发更新', async () => {
    const Comp = await loadModalCardUpdate();
    const checkResult = makeBreakingCheckResult();
    const onUpdated = vi.fn();

    mockExecuteOneClickBackup.mockResolvedValueOnce({
      ok: true,
      fileName: '红警战局备份_v1.0.0_楼4.json',
      fileDownloaded: true,
      clipboardCopied: true,
      clonedWorldbooks: ['红警主世界书_v1.0.0备份'],
      floorId: 4,
    });
    mockTriggerLocalServerUpdate.mockResolvedValueOnce({
      ok: true,
      previousVersion: '1.0.0',
      currentVersion: '1.2.0',
      steps: ['编译完成'],
    });

    const { root } = mountComponent(Comp, {
      open: true,
      checkResult,
      onUpdated,
    });

    const backupAndUpdateBtn = findByDataTest(root, 'btn-backup-and-update')!;
    await backupAndUpdateBtn.listeners.onClick?.();
    await nextTick();

    expect(callOrder).toEqual(['executeOneClickBackup', 'triggerLocalServerUpdate']);
    expect(onUpdated).toHaveBeenCalledWith('1.2.0');

    // 验证当 executeOneClickBackup 返回 { ok: false } 时，绝不调用 triggerLocalServerUpdate
    callOrder.length = 0;
    vi.clearAllMocks();
    mockExecuteOneClickBackup.mockResolvedValueOnce({
      ok: false,
      error: '当前楼层无有效战局数据，无法生成备份',
      fileDownloaded: false,
      clipboardCopied: false,
      clonedWorldbooks: [],
      floorId: null,
    });

    await backupAndUpdateBtn.listeners.onClick?.();
    await nextTick();

    expect(callOrder).toEqual(['executeOneClickBackup']);
    expect(mockTriggerLocalServerUpdate).not.toHaveBeenCalled();
    expect(mockPerformSafeCardUpdate).not.toHaveBeenCalled();
    expect(getText(findByDataTest(root, 'update-error-msg')!)).toContain(
      '当前楼层无有效战局数据，无法生成备份',
    );
  });

  it('4. 未勾选 chk-force-update-ack 时 btn-force-update-without-backup 处于 disabled；勾选后解锁并可触发受控更新', async () => {
    const Comp = await loadModalCardUpdate();
    const checkResult = makeBreakingCheckResult();
    const onUpdated = vi.fn();

    mockTriggerLocalServerUpdate.mockResolvedValueOnce({
      ok: true,
      previousVersion: '1.0.0',
      currentVersion: '1.2.0',
      steps: [],
    });

    const { root } = mountComponent(Comp, {
      open: true,
      checkResult,
      onUpdated,
    });

    const chk = findByDataTest(root, 'chk-force-update-ack')!;
    const forceBtn = findByDataTest(root, 'btn-force-update-without-backup')!;
    expect(forceBtn.attrs.disabled).toBe('true');

    await chk.listeners.onChange?.({ target: { checked: true } });
    await nextTick();

    const forceBtnAfter = findByDataTest(root, 'btn-force-update-without-backup')!;
    expect(forceBtnAfter.attrs.disabled).toBeUndefined();

    await forceBtnAfter.listeners.onClick?.();
    await nextTick();
    expect(mockTriggerLocalServerUpdate).toHaveBeenCalledWith({ confirmBackupCompleted: true });
    expect(onUpdated).toHaveBeenCalledWith('1.2.0');
  });

  it('5. 常规更新模式 (hasBreakingSaveChange === false) 支持直接更新与忽略此版本', async () => {
    const Comp = await loadModalCardUpdate();
    const checkResult = makeNormalCheckResult();
    const onClose = vi.fn();
    const onUpdated = vi.fn();

    mockTriggerLocalServerUpdate.mockResolvedValueOnce({
      ok: true,
      previousVersion: '1.1.0',
      currentVersion: '1.2.0',
      steps: [],
    });

    const { root } = mountComponent(Comp, {
      open: true,
      checkResult,
      onClose,
      onUpdated,
    });

    expect(findByDataTest(root, 'breaking-save-alert-banner')).toBeUndefined();
    const directBtn = findByDataTest(root, 'btn-direct-update')!;
    await directBtn.listeners.onClick?.();
    await nextTick();
    expect(mockTriggerLocalServerUpdate).toHaveBeenCalledWith({ confirmBackupCompleted: true });
    expect(onUpdated).toHaveBeenCalledWith('1.2.0');

    const ignoreBtn = findByDataTest(root, 'btn-ignore-version')!;
    await ignoreBtn.listeners.onClick?.();
    expect(mockDismissCardUpdatePrompt).toHaveBeenCalledWith(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('FD-48 W4 · PanelExportSave.vue 三大分区与本地服务版本检测设置联动测试', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    callOrder.length = 0;
    mockReadCurrentChatSaveSchema.mockReturnValue(1);
    mockProbeLocalServerVersionStatus.mockResolvedValue({
      ok: true,
      online: true,
      local: { version: '2.4.0' },
    });
    vi.clearAllMocks();
  });

  it('渲染三大分区、只检不更策略徽标与本地服务端口 5500 状态徽标，且备份、恢复、本地服务检测与更新正常', async () => {
    const Comp = await loadPanelExportSave();
    const { root } = mountComponent(Comp);
    await nextTick();

    expect(findByDataTest(root, 'section-save-backup')).toBeDefined();
    expect(findByDataTest(root, 'section-save-restore')).toBeDefined();
    expect(findByDataTest(root, 'section-card-update')).toBeDefined();

    // 验证已移除旧的静默自动更新开关，并展示「仅检测新版本」与「本地启动服务（端口 5500）」徽标
    expect(findByDataTest(root, 'chk-auto-update-silent')).toBeUndefined();
    const policyBadge = findByDataTest(root, 'badge-update-policy');
    expect(policyBadge).toBeDefined();
    expect(getText(policyBadge!)).toContain('更新策略：仅检测新版本（已关闭自动覆盖）');

    const serverBadge = findByDataTest(root, 'badge-local-server-status');
    expect(serverBadge).toBeDefined();
    expect(getText(serverBadge!)).toContain('本地启动服务（端口 5500）：在线');

    // 点击「立即检测新版本」调用 checkCardUpdateViaLocalOrRemote
    const checkRes = {
      ...makeBreakingCheckResult(),
      localServerOnline: true,
    } as UpdateCheckResult;
    mockCheckCardUpdateViaLocalOrRemote.mockResolvedValueOnce(checkRes);

    const checkBtn = findByDataTest(root, 'btn-check-card-update')!;
    await checkBtn.listeners.onClick?.();
    await nextTick();

    expect(mockCheckCardUpdateViaLocalOrRemote).toHaveBeenCalledWith(
      expect.objectContaining({
        forcePopupOnNormalUpdate: true,
        triggerAutoUpdateIfSafe: false,
      }),
    );

    const summaryBox = findByDataTest(root, 'detected-update-summary-box');
    expect(summaryBox).toBeDefined();
    expect(getText(summaryBox!)).toContain('v1.0.0 ▸ v1.2.0');

    // 点击「先备份战局并通知本地服务更新」
    mockExecuteOneClickBackup.mockResolvedValueOnce({
      ok: true,
      fileName: '红警战局备份_楼6.json',
      fileDownloaded: true,
      clipboardCopied: true,
      clonedWorldbooks: ['主世界书备份'],
      floorId: 6,
    });
    mockTriggerLocalServerUpdate.mockResolvedValueOnce({
      ok: true,
      currentVersion: '1.2.0',
    });

    const backupAndLocalBtn = findByDataTest(root, 'btn-backup-and-local-update')!;
    await backupAndLocalBtn.listeners.onClick?.();
    await nextTick();

    expect(mockExecuteOneClickBackup).toHaveBeenCalledTimes(1);
    expect(mockTriggerLocalServerUpdate).toHaveBeenCalledWith({ confirmBackupCompleted: true });
    expect(getText(findByDataTest(root, 'update-check-msg')!)).toContain(
      '已完成战局备份并由本地服务完成拉取与重编译',
    );
  });

  it('FloatingApp.vue 外壳接线接入 runStartupUpdateFlow 与 handleConfirmCardUpdate 本地服务优先热更新', () => {
    const sfc = readFileSync(FLOATING_APP_SFC_PATH, 'utf8');
    expect(sfc).toContain('runStartupUpdateFlow');
    expect(sfc).toContain('handleConfirmCardUpdate');
    expect(sfc).toContain('triggerLocalServerUpdate({ confirmBackupCompleted: true })');
    expect(sfc).toContain('@confirm-update="handleConfirmCardUpdate"');
  });
});
