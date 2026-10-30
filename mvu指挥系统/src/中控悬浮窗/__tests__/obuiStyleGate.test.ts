import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = path.resolve(__dirname, '../..');

/**
 * FD-42 · G1 静态视觉门禁（Oblivion 实用化视觉体系首版范围）
 *
 * 检查项：
 * 1. 裸十六进制色值（#[0-9a-fA-F]{3,8}\b）为 0（含 var() 回退值）
 * 2. 非黑字面 rgba（除 rgba(0, 0, 0, x) 阴影/遮罩外）为 0
 * 3. Tailwind 调色板类（text/bg/border/ring/fill/stroke/from/to/via-<palette>-<shade>）为 0
 * 4. 小于 11px 的字号（text-[<=10.x px] 与 font-size: <=10.x px）为 0
 * 5. Emoji 与彩色象形符（/\p{Extended_Pictographic}/u 与 /[\u2600-\u27BF]/u）为 0
 */
const FIRST_PLAYABLE_FILES = [
  '红警指挥系统/ui/ObState.vue',
  '红警指挥系统/ui/Icon.vue',
  '中控悬浮窗/console/FloatingApp.vue',
  '中控悬浮窗/console/ConsoleTopNav.vue',
  '中控悬浮窗/console/ConsoleRadarScreen.vue',
  '中控悬浮窗/console/ConsolePowerBar.vue',
  '中控悬浮窗/console/ConsoleBuildGrid.vue',
  '中控悬浮窗/console/consoleBuildGridHelpers.ts',
  '中控悬浮窗/console/ConsoleQuickActions.vue',
  '中控悬浮窗/console/ConsoleDockHandle.vue',
  '中控悬浮窗/console/ChronoMismatchBanner.vue',
  '中控悬浮窗/console/TagFilterBar.vue',
  '中控悬浮窗/modals/ModalBuildings.vue',
  '中控悬浮窗/modals/modalBuildingsHelpers.ts',
  // FD-43 · 设置面板外壳与全部 16 个子面板
  '中控悬浮窗/modals/ModalSettings.vue',
  '中控悬浮窗/panels/SettingsShell.vue',
  '中控悬浮窗/panels/PanelFeedforwardSettings.vue',
  '中控悬浮窗/panels/PanelArchive.vue',
  '中控悬浮窗/panels/PanelGirlFiling.vue',
  '中控悬浮窗/panels/PanelExpansionFiling.vue',
  '中控悬浮窗/panels/PanelDataPatches.vue',
  '中控悬浮窗/panels/PanelWorldbookToggle.vue',
  '中控悬浮窗/panels/PanelExportSave.vue',
  '红警指挥系统/ui/panels/PanelSummaries.vue',
  '中控悬浮窗/panels/PanelWorldEvolution.vue',
  '中控悬浮窗/panels/PanelParseRepair.vue',
  '中控悬浮窗/panels/PanelAliasDict.vue',
  '中控悬浮窗/panels/PanelDlcManager.vue',
  '中控悬浮窗/panels/PanelIntegrityCheck.vue',
  '中控悬浮窗/panels/PanelDebugSandbox.vue',
  '中控悬浮窗/panels/PanelDataFlowInspector.vue',
  '中控悬浮窗/panels/PanelPerfMonitor.vue',
  // FD-44 · 战时战术科研中心与统帅部条令面板
  '中控悬浮窗/modals/ModalTechTree.vue',
  '中控悬浮窗/panels/PanelProtocol.vue',
  '中控悬浮窗/panels/panelProtocolHelpers.ts',
  '红警指挥系统/ui/panels/PanelTech.vue',
  '红警指挥系统/ui/panels/panelTechHelpers.ts',
  // FD-47 · 角色卡版本感知与存档变动强制备份拦截弹窗
  '中控悬浮窗/modals/ModalCardUpdate.vue',
  // 工务日程战术网格块面甘特图与调度辅助模块
  '中控悬浮窗/modals/ModalSchedule.vue',
  '中控悬浮窗/modals/modalScheduleHelpers.ts',
] as const;

const HEX_COLOR_RE = /#[0-9a-fA-F]{3,8}\b/g;
const RGBA_COLOR_RE = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,[^)]+\)/g;
const TW_PALETTE_RE =
  /\b(?:text|bg|border|ring|fill|stroke|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;
const SMALL_FONT_RE =
  /text-\[(?:[0-9]|10)(?:\.\d+)?px\]|font-size:\s*(?:[0-9]|10)(?:\.\d+)?px/g;
const EMOJI_RE = /(?![◆◇▲▼●○▸▾★])(?:\p{Extended_Pictographic}|[\u2600-\u27BF])/gu;

function readRel(relPath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), 'utf8');
}

describe('FD-42 G1 · Oblivion 实用化视觉体系静态门禁', () => {
  it('global.css 声明新增 Oblivion 令牌与 .ob-* 基元，且三阵营具备完整的五层立体金属令牌矩阵', () => {
    const css = readRel('红警指挥系统/ui/global.css');
    expect(css).toContain('--rac-dot:');
    expect(css).toContain('--rac-hatch-alert:');
    expect(css).toContain('--rac-hatch-dim:');
    expect(css).toContain('--rac-font-num:');
    expect(css).toContain('--rac-glow:');
    expect(css).toContain('--rac-rail:');
    expect(css).toContain('--rac-surface-tint:');
    expect(css).toContain('--rac-header-stripe:');
    expect(css).toContain('.ob-panel');
    expect(css).toContain('.ob-tag');
    expect(css).toContain('.ob-rule');
    expect(css).toContain('.ob-readout');
    expect(css).toContain('.ob-seg');
    expect(css).toContain('.ob-dotgrid');
    expect(css).toContain('.ob-enter');
    expect(css).toContain('prefers-reduced-motion: reduce');

    const sovietBlock = css.match(/#app\[data-theme='soviet'\]\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const yuriBlock = css.match(/#app\[data-theme='yuri'\]\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    for (const token of [
      '--rac-bg:',
      '--rac-panel:',
      '--rac-panel-2:',
      '--rac-dim:',
      '--rac-line:',
      '--rac-hi:',
      '--rac-text:',
      '--rac-muted:',
      '--rac-accent:',
      '--rac-focus:',
      '--rac-dot:',
      '--rac-header-stripe:',
    ]) {
      expect(sovietBlock).toContain(token);
      expect(yuriBlock).toContain(token);
    }
  });

  for (const relPath of FIRST_PLAYABLE_FILES) {
    describe(relPath, () => {
      it('裸十六进制色值为 0', () => {
        const content = readRel(relPath);
        const matches = content.match(HEX_COLOR_RE) ?? [];
        expect(matches, `${relPath} 残留裸 hex: ${matches.slice(0, 10).join(', ')}`).toEqual([]);
      });

      it('非黑色字面 rgba 为 0', () => {
        const content = readRel(relPath);
        const badRgba: string[] = [];
        for (const m of content.matchAll(RGBA_COLOR_RE)) {
          const r = Number(m[1]);
          const g = Number(m[2]);
          const b = Number(m[3]);
          if (r !== 0 || g !== 0 || b !== 0) {
            badRgba.push(m[0]);
          }
        }
        expect(badRgba, `${relPath} 残留彩色 rgba: ${badRgba.slice(0, 10).join(', ')}`).toEqual([]);
      });

      it('Tailwind 调色板类为 0', () => {
        const content = readRel(relPath);
        const matches = content.match(TW_PALETTE_RE) ?? [];
        expect(matches, `${relPath} 残留调色板类: ${matches.slice(0, 10).join(', ')}`).toEqual([]);
      });

      it('小于 11px 的字号为 0', () => {
        const content = readRel(relPath);
        const matches = content.match(SMALL_FONT_RE) ?? [];
        expect(matches, `${relPath} 残留 <11px 字号: ${matches.slice(0, 10).join(', ')}`).toEqual([]);
      });

      it('Emoji 与彩色象形符为 0', () => {
        const content = readRel(relPath);
        const matches = content.match(EMOJI_RE) ?? [];
        expect(matches, `${relPath} 残留 Emoji: ${matches.slice(0, 10).join(', ')}`).toEqual([]);
      });
    });
  }
});
