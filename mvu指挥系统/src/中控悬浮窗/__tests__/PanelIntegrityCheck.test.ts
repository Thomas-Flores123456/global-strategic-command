/**
 * PanelIntegrityCheck.test.ts —— 内容体检区迁入中控台设置弹窗（CTRL-SETTINGS-MIGRATE-01 试水第一枪）
 *
 * 注：CTRL-SETTINGS-SHELL-01 将 ModalSettings 重构为标准 VSCode/浏览器设置范式：
 * 左栏「只放一级分组」（环境 / 内容体检），右侧内容区顶部为「可选的横向子页 tab 栏」（仅当某组声明多个子页时出现）。
 * 返工后：左栏不再嵌套子页列表；子页 tab 栏统一位于右侧内容区顶部；「环境」组内容不多，不拆子页，右侧直接平铺
 * 配色/停靠/Auto-Apply/诊断四块（pages 机制预留给后续内容量大的分组，本任务两组均不启用）。
 * 本文件对 ModalSettings 的断言随之更新；PanelIntegrityCheck 的复用与只读契约不变。
 *
 * vitest 为 node 环境且无 SFC 编译插件，这里以「源码文本静态契约」+「复用逻辑行为」双轨验证：
 * 1. 设置弹窗 ModalSettings.vue 用 SettingsShell 承载「环境 / 内容体检」两组，环境组不拆子页、右侧平铺
 *    配色/停靠/Auto-Apply/诊断四块，内容体检组的 slot 内挂载 PanelIntegrityCheck；
 * 2. PanelIntegrityCheck.vue 严格复用 systemCheck.ts 同一套纯函数（checkVariables/checkWorldbooks/
 *    checkLedger/checkArchiveSync）与 useDataStore/useCatalogStore，不重写体检逻辑，不引入写入 API；
 * 3. 非酒馆环境（独立预览/单测）安全降级：世界书/对账维度显示「不可用/未扫描」，不抛错；
 * 4. 复用 .ra-modal-* 样式与阵营 CSS 变量，弹窗统一挂载 10010 层级，不破坏 z-index 层级。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本，不进 bundle */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkArchiveSync, checkLedger, checkVariables, checkWorldbooks } from '../../红警指挥系统/parse/systemCheck';
import { getHostViewportWidth, getHostWindow } from '../host/modalHost';

const DIR = join(__dirname, '..');
const MODAL_SETTINGS_SFC = readFileSync(join(DIR, 'modals/ModalSettings.vue'), 'utf8');
const INTEGRITY_SFC = readFileSync(join(DIR, 'panels/PanelIntegrityCheck.vue'), 'utf8');

/** 去掉块注释与行注释后的源码（注释里对写 API 的说明性提及不算命中） */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('ModalSettings VSCode 左栏范式壳（CTRL-SETTINGS-SHELL-01）', () => {
  it('用 SettingsShell 承载「环境 / 内容体检」两组，默认结构可扩展', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/import SettingsShell(?:,\s*\{[^}]*\})? from '(?:\.\.|\.)(?:\/panels)?\/SettingsShell\.vue'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/<SettingsShell\s+:groups="groups"/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'env',\s*label:\s*'环境'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'integrity',\s*label:\s*'内容体检'/);
  });

  it('环境组不拆子页：env 组自身不声明 pages，右侧四块平铺在组级 #panel-env slot（子页 tab 栏对环境组不启用）', () => {
    // 返工要求：环境组内容不多，不强拆子页——env 组自身不出现 pages 字段。
    // 注：CTRL-SETTINGS-MIGRATE-06 起「解析」组首次启用 SettingsShell.pages 子页机制，故不再对整份源码做
    //     file-wide「绝不出现 pages:」断言（那会与合法的 parse 组子页配置冲突）；此处只锚定 env 组不拆子页。
    const envGroup = /\{\s*key:\s*'env',[^}]*\}/.exec(MODAL_SETTINGS_SFC)?.[0] ?? '';
    expect(envGroup).toMatch(/key:\s*'env'/);
    expect(envGroup).not.toMatch(/\bpages\s*:/);
    // 因此环境组不应再出现按子页拆分的具名子页 slot
    expect(MODAL_SETTINGS_SFC).not.toMatch(/#panel-env-appearance/);
    expect(MODAL_SETTINGS_SFC).not.toMatch(/#panel-env-layout/);
    expect(MODAL_SETTINGS_SFC).not.toMatch(/#panel-env-policy/);
    expect(MODAL_SETTINGS_SFC).not.toMatch(/#panel-env-diagnostics/);
  });

  it('环境组四块内容平铺在单一组级 slot（#panel-env）内，逐一保留', () => {
    // 环境组用组级 slot（不带子页后缀），四块内容全部平铺其中
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-env\b/);
    expect(MODAL_SETTINGS_SFC).toMatch(/THEME/); // 阵营配色
    expect(MODAL_SETTINGS_SFC).toMatch(/DOCK MODE/); // 停靠模式
    expect(MODAL_SETTINGS_SFC).toMatch(/Auto-Apply/); // 动态补丁审核
    expect(MODAL_SETTINGS_SFC).toMatch(/运行模式:/); // 诊断状态
  });

  it('停靠三事件与 Auto-Apply 处理逐一保留可用', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/@click="\$emit\('dock-right'\)"/);
    expect(MODAL_SETTINGS_SFC).toMatch(/@click="\$emit\('dock-left'\)"/);
    expect(MODAL_SETTINGS_SFC).toMatch(/@click="\$emit\('dock-free'\)"/);
    expect(MODAL_SETTINGS_SFC).toMatch(/@change="onToggleAutoApply"/);
    expect(MODAL_SETTINGS_SFC).toMatch(/getAutoApplyPreference|setAutoApplyPreference/);
  });

  it('内容体检组 slot 内挂载 PanelIntegrityCheck', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/import PanelIntegrityCheck from '(?:\.\.|\.)(?:\/panels)?\/PanelIntegrityCheck\.vue'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-integrity[\s\S]*?<PanelIntegrityCheck\s*\/>/);
  });

  it('对外 props/emits 契约向后兼容（FloatingApp 零改动唤起）', () => {
    for (const p of ['open', 'floorId', 'schemaVersion', 'lastError', 'currentDock']) {
      expect(MODAL_SETTINGS_SFC, p).toMatch(new RegExp(`${p}`));
    }
    expect(MODAL_SETTINGS_SFC).toMatch(/\(e:\s*'close'\)/);
    expect(MODAL_SETTINGS_SFC).toMatch(/\(e:\s*'dock-left'\)/);
    expect(MODAL_SETTINGS_SFC).toMatch(/\(e:\s*'dock-right'\)/);
    expect(MODAL_SETTINGS_SFC).toMatch(/\(e:\s*'dock-free'\)/);
  });

  it('弹窗仍统一挂载 10010 主模态层级，复用 .ra-modal-* 样式，不破坏 z-index 层级', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/(?:z-10010|z-\[10010\])/);
    expect(MODAL_SETTINGS_SFC).toMatch(/\.ra-modal-mask\s*\{[^}]*z-index:\s*10010/);
    expect(MODAL_SETTINGS_SFC).toMatch(/class="ra-modal-mask/);
    expect(MODAL_SETTINGS_SFC).toMatch(/class="ra-modal-card/);
  });

  it('narrow 依据宿主视口宽度（getHostViewportWidth）而非脚本 iframe 自身 window.innerWidth', () => {
    const code = stripComments(MODAL_SETTINGS_SFC);
    // 必须从 modalHost 引入宿主视口取宽/取窗函数
    expect(code).toMatch(/import\s*\{[^}]*getHostViewportWidth[^}]*\}\s*from\s*'(?:\.\.|\.)(?:\/host)?\/modalHost\.ts'/);
    // narrow 由宿主视口宽度 ref computed，不再直接读脚本自身 window.innerWidth
    expect(code).toMatch(/const\s+hostViewportWidth\s*=\s*ref\(getHostViewportWidth\(\)\)/);
    expect(code).toMatch(/narrow\s*=\s*computed\(\(\)\s*=>\s*hostViewportWidth\.value\s*<\s*NARROW_BREAKPOINT\)/);
    // 关键回归：不得再用脚本自身 window.innerWidth 直接判定 narrow
    expect(code).not.toMatch(/narrow\s*=\s*computed\([^)]*window\.innerWidth\s*<\s*NARROW_BREAKPOINT/);
  });

  it('narrow 随宿主视口 resize 重算：宿主 window 上挂/卸 resize 监听', () => {
    const code = stripComments(MODAL_SETTINGS_SFC);
    expect(code).toMatch(/import\s*\{[^}]*getHostWindow[^}]*\}\s*from\s*'(?:\.\.|\.)(?:\/host)?\/modalHost\.ts'/);
    // onMounted 拿宿主 window 并挂 resize；onUnmounted 移除
    expect(code).toMatch(/onMounted\(/);
    expect(code).toMatch(/getHostWindow\(\)/);
    expect(code).toMatch(/addEventListener\('resize'/);
    expect(code).toMatch(/onUnmounted\(/);
    expect(code).toMatch(/removeEventListener\('resize'/);
  });
});

describe('modalHost 宿主视口宽度探测（narrow 判定的正确来源）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as Record<string, unknown>).frameElement;
  });

  it('宽宿主：脚本 iframe 仅 340px，但宿主 overlay 视口 2560px → 取宿主宽 2560（非窄屏）', () => {
    // 模拟：脚本自身 window.innerWidth=340（停靠脚本 iframe），宿主 defaultView.innerWidth=2560
    const hostView = { innerWidth: 2560 };
    const hostDoc = { defaultView: hostView, body: {}, getElementById: () => null, createElement: () => ({}) };
    vi.stubGlobal('window', { innerWidth: 340, frameElement: { ownerDocument: hostDoc } });
    vi.stubGlobal('document', hostDoc);
    (globalThis as Record<string, unknown>).frameElement = { ownerDocument: hostDoc };

    // 取到的是宿主视口宽度 2560，而非脚本自身 340
    expect(getHostViewportWidth()).toBe(2560);
    // 640 阈值下判为非窄屏
    expect(getHostViewportWidth() < 640).toBe(false);
    expect(getHostWindow()).toBe(hostView);
  });

  it('窄宿主：宿主 overlay 视口 480px → 取宿主宽 480（窄屏）', () => {
    const hostView = { innerWidth: 480 };
    const hostDoc = { defaultView: hostView, body: {}, getElementById: () => null, createElement: () => ({}) };
    vi.stubGlobal('window', { innerWidth: 340, frameElement: { ownerDocument: hostDoc } });
    vi.stubGlobal('document', hostDoc);
    (globalThis as Record<string, unknown>).frameElement = { ownerDocument: hostDoc };

    expect(getHostViewportWidth()).toBe(480);
    expect(getHostViewportWidth() < 640).toBe(true);
    expect(getHostWindow()).toBe(hostView);
  });

  it('退化环境：拿不到宿主 defaultView 时回退脚本自身 window.innerWidth（不误判窄屏）', () => {
    // 无 frameElement、document 即脚本自身，defaultView 缺失 → 回退 window.innerWidth
    const selfDoc = { getElementById: () => null, createElement: () => ({}) } as unknown as Document;
    vi.stubGlobal('window', { innerWidth: 1280 });
    vi.stubGlobal('document', selfDoc);
    delete (globalThis as Record<string, unknown>).frameElement;

    expect(getHostViewportWidth()).toBe(1280);
    // 退化时 getHostWindow 回退脚本 window（非 null），调用方仍可挂监听
    expect(getHostWindow()).not.toBeNull();
  });
});

describe('SettingsShell 左栏（仅一级分组）+ 右侧内容区（顶部子页栏）骨架', () => {
  const SHELL_SFC = readFileSync(join(DIR, 'panels/SettingsShell.vue'), 'utf8');

  it('按 groups 渲染左栏导航条目，点击切换选中组', () => {
    expect(SHELL_SFC).toMatch(/v-for="group in groups"/);
    expect(SHELL_SFC).toMatch(/@click="selectGroup\(group\.key\)"/);
    expect(SHELL_SFC).toMatch(/activeGroup\s*===\s*group\.key/);
  });

  it('左栏只放一级分组：不在左栏内嵌套子页列表', () => {
    // 提取 <nav> ... </nav> 段（左栏），断言其中没有基于 pages 的次级列表渲染
    const navMatch = SHELL_SFC.match(/<nav[\s\S]*?<\/nav>/);
    expect(navMatch, '应存在左栏 <nav>').not.toBeNull();
    const nav = navMatch?.[0] ?? '';
    expect(nav).not.toMatch(/group\.pages/); // 左栏不得引用/渲染子页
    expect(nav).not.toMatch(/selectPage/); // 左栏不得含子页切换按钮
  });

  it('子页 tab 栏渲染在「右侧内容区」顶部（非左栏），仅当组声明多个子页时出现', () => {
    // 提取右侧内容区 <div class="ra-settings-body"> 段
    const bodyMatch = SHELL_SFC.match(/ra-settings-body[\s\S]*?<\/div>\s*<\/div>\s*<\/template>/);
    expect(bodyMatch, '应存在右侧内容区 ra-settings-body').not.toBeNull();
    const body = bodyMatch?.[0] ?? '';
    // 子页栏出现在右侧内容区，且以 pages.length 条件门控
    expect(body).toMatch(/activeGroupPages\.length/);
    expect(body).toMatch(/@click="selectPage\(page\.key\)"/);
    expect(body).toMatch(/activePage\s*===\s*page\.key/);
    // 子页栏位于主内容之上（sticky top-0），桌面/窄屏一致（不再以 narrow 门控子页栏显隐）
    expect(SHELL_SFC).not.toMatch(/v-if="narrow && activeGroupPages\.length"/);
  });

  it('右侧内容区按选中组渲染具名 slot（子页优先，回退组级）', () => {
    expect(SHELL_SFC).toMatch(/:name="activePageSlot"/);
    expect(SHELL_SFC).toMatch(/:name="`panel-\$\{activeGroup\}`"/);
  });

  it('保留子页能力（pages 机制）供后续内容量大的分组启用', () => {
    expect(SHELL_SFC).toMatch(/group\.pages|activeGroupPages/);
    expect(SHELL_SFC).toMatch(/@click="selectPage\(page\.key\)"/);
  });

  it('窄屏（narrow）左栏折叠为顶部横向条，不截断内容', () => {
    expect(SHELL_SFC).toMatch(/narrow\s*\?\s*'flex-col'\s*:\s*'flex-row'/);
    expect(SHELL_SFC).toMatch(/defineProps<\{[\s\S]*?narrow\?:\s*boolean/);
  });
});

describe('PanelIntegrityCheck 复用 systemCheck 契约', () => {
  it('复用 systemCheck.ts 同一套纯函数，不重写体检逻辑', () => {
    expect(INTEGRITY_SFC).toMatch(/from '(?:\.\.\/)?\.\.\/红警指挥系统\/parse\/systemCheck'/);
    for (const fn of ['checkVariables', 'checkWorldbooks', 'checkLedger', 'checkArchiveSync']) {
      expect(INTEGRITY_SFC, fn).toMatch(new RegExp(`${fn}\\(`));
    }
  });

  it('数据源用 useDataStore（store）与 useCatalogStore（useCatalog）', () => {
    expect(INTEGRITY_SFC).toMatch(/useDataStore\(\)/);
    expect(INTEGRITY_SFC).toMatch(/useCatalogStore\(\)/);
    expect(INTEGRITY_SFC).toMatch(/from '(?:\.\.\/)?\.\.\/红警指挥系统\/composables\/store'/);
    expect(INTEGRITY_SFC).toMatch(/from '(?:\.\.\/)?\.\.\/红警指挥系统\/composables\/useCatalog'/);
  });

  it('展示三维汇总（错误/警告/提示）与分维度问题清单', () => {
    expect(INTEGRITY_SFC).toMatch(/错误 \{\{ counts\.error \}\}/);
    expect(INTEGRITY_SFC).toMatch(/警告 \{\{ counts\.warn \}\}/);
    expect(INTEGRITY_SFC).toMatch(/提示 \{\{ counts\.info \}\}/);
    // 三维：变量 / 世界书 / 对账
    expect(INTEGRITY_SFC).toMatch(/label: '变量'/);
    expect(INTEGRITY_SFC).toMatch(/label: '世界书'/);
    expect(INTEGRITY_SFC).toMatch(/label: '对账'/);
    expect(INTEGRITY_SFC).toMatch(/v-for="dim in dims"/);
  });

  it('世界书维度无扫描结果时显示「不可用/未扫描」降级文案', () => {
    expect(INTEGRITY_SFC).toMatch(/wbScanned\.value\.length\s*\?[^:]*:\s*'不可用\/未扫描'/);
  });

  it('只读区块：不引入 send / 变量·世界书写入 API', () => {
    const code = stripComments(INTEGRITY_SFC);
    expect(code).not.toMatch(/from '[^']*\/send'/);
    expect(code).not.toMatch(/sendAction/);
    expect(code).not.toMatch(
      /createChatMessages|triggerSlash|updateWorldbookWith|createWorldbook|replaceWorldbook|deleteWorldbook|insertOrAssignVariables|replaceVariables|updateVariablesWith|deleteVariable/,
    );
  });
});

describe('非酒馆环境安全降级（复用 systemCheck.tav 探测，不抛错）', () => {
  it('checkVariables 纯同步：非酒馆环境无 API 依赖，正常返回 issue 数组', () => {
    const issues = checkVariables({
      codex: [],
      techDone: [],
      overlays: [],
      baseResearches: [],
      mergedResearchNames: [],
    });
    expect(Array.isArray(issues)).toBe(true);
  });

  it('checkWorldbooks 无世界书 API 时降级为 ENV 提示且 scanned 为空，不抛错', async () => {
    const result = await checkWorldbooks();
    expect(result.scanned).toEqual([]);
    expect(result.issues.some(i => i.rule === 'ENV')).toBe(true);
  });

  it('checkLedger 无世界书 API 时降级为 ENV 提示，不抛错', async () => {
    const issues = await checkLedger([], []);
    expect(issues.some(i => i.rule === 'ENV')).toBe(true);
  });

  it('checkArchiveSync 无 getVariables 时安全返回空数组（readArchive 降级 null），不抛错', async () => {
    const issues = await checkArchiveSync([{ name: 'x', kind: '科技' }]);
    expect(issues).toEqual([]);
  });
});
