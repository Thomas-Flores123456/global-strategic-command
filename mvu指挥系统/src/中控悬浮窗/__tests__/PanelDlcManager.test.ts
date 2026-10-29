/**
 * PanelDlcManager.test.ts —— DLC 管理区迁入中控台设置弹窗（CTRL-SETTINGS-MIGRATE-07 压轴末枪）
 *
 * 范式与同目录 PanelArchive.test.ts / PanelParseRepair.test.ts 一致：vitest 为 node 环境且无 SFC
 * 编译插件，故以「源码文本静态契约」+「底层纯函数导出降级/契约」双轨验证：
 * ① ModalSettings.vue 左栏 groups 追加「DLC」组（key: 'dlc'，pages=[installed, import]，放在 parse
 *    之后、integrity 之前），两 slot #panel-dlc-installed / #panel-dlc-import 各挂载 PanelDlcManager
 *    并以 page prop 分流；既有六组保持原样；不新增 props/emits；
 * ② PanelDlcManager.vue 复用 dlcInstaller 的安装/卸载/导入/预检导出（不重写逻辑、不改签名），
 *    未 import 用不到的 OFFICIAL_BOOKS；page prop 用 defineProps 分流 v-if；
 * ③ 保留 catalog.init()（DLC 区自身状态）；不搬 ran.value / refreshBooks（跨区联动，带取舍注释）；
 * ④ dlcInstaller 纯函数降级/契约：parseManifest 非法输入报错、sniffRawWorldbook 判定、
 *    非酒馆 readUninstallPlan 返回 null、bookNameFromFile 去后缀。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本，不进 bundle */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';
import {
  bookNameFromFile,
  installDlc,
  installRawBooks,
  parseManifest,
  precheckManifest,
  readUninstallPlan,
  renderDataCardEntry,
  replayCodexSeeds,
  sniffRawWorldbook,
  uninstallDlc,
  type DlcManifest,
} from '../../红警指挥系统/worldbook/dlcInstaller';

const DIR = join(__dirname, '..');
const MODAL_SETTINGS_SFC = readFileSync(join(DIR, 'modals/ModalSettings.vue'), 'utf8');
const DLC_SFC = readFileSync(join(DIR, 'panels/PanelDlcManager.vue'), 'utf8');

/**
 * 去掉 HTML 注释、块注释与行注释后的源码。本组件在模板顶部与脚本内以注释形式说明「不搬 ran.value /
 * refreshBooks 两句联动」的取舍——这些属文档而非可执行代码，剥离后再断言真实代码里确无该联动。
 */
function stripComments(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('ModalSettings 左栏追加「DLC」组（CTRL-SETTINGS-MIGRATE-07）', () => {
  it('groups 追加 dlc 组：key=dlc，label=DLC，声明 pages=[installed, import]', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'dlc',\s*\n?\s*label:\s*'DLC'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'installed',\s*label:\s*'已装\/卸载'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'import',\s*label:\s*'导入'/);
  });

  it('dlc 组顺序位于 parse 之后、integrity 之前', () => {
    const iParse = MODAL_SETTINGS_SFC.indexOf("key: 'parse'");
    const iDlc = MODAL_SETTINGS_SFC.indexOf("key: 'dlc'");
    const iIntegrity = MODAL_SETTINGS_SFC.indexOf("key: 'integrity'");
    expect(iParse).toBeGreaterThan(-1);
    expect(iDlc).toBeGreaterThan(iParse);
    expect(iIntegrity).toBeGreaterThan(iDlc);
  });

  it('两 slot #panel-dlc-installed / #panel-dlc-import 各挂载 PanelDlcManager 并以 page prop 分流', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/import PanelDlcManager from '(?:\.\.|\.)(?:\/panels)?\/PanelDlcManager\.vue'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-dlc-installed[\s\S]*?<PanelDlcManager page="installed"\s*\/>/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-dlc-import[\s\S]*?<PanelDlcManager page="import"\s*\/>/);
  });

  it('既有六组保持原样可用（不被本任务破坏）', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-env\b/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-books[\s\S]*?<PanelWorldbookToggle\s*\/>/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-save[\s\S]*?<PanelExportSave\s*\/>/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-archive[\s\S]*?<PanelArchive\s*\/>/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-girls[\s\S]*?<PanelGirlFiling\s*\/>/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-parse-repair[\s\S]*?<PanelParseRepair\s*\/>/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-parse-alias[\s\S]*?<PanelAliasDict\s*\/>/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-integrity[\s\S]*?<PanelIntegrityCheck\s*\/>/);
  });

  it('本任务不新增 props/emits：对外契约向后兼容（FloatingApp 零改动唤起）', () => {
    for (const p of ['open', 'floorId', 'schemaVersion', 'lastError', 'currentDock']) {
      expect(MODAL_SETTINGS_SFC, p).toMatch(new RegExp(`${p}`));
    }
    expect(MODAL_SETTINGS_SFC).toMatch(/\(e:\s*'close'\)/);
    expect(MODAL_SETTINGS_SFC).toMatch(/\(e:\s*'dock-left'\)/);
    expect(MODAL_SETTINGS_SFC).toMatch(/\(e:\s*'dock-right'\)/);
    expect(MODAL_SETTINGS_SFC).toMatch(/\(e:\s*'dock-free'\)/);
    // props 结构未增删（仍是 open/floorId/schemaVersion/lastError/currentDock 五项）
    const propsBlock = MODAL_SETTINGS_SFC.match(/defineProps<\{([\s\S]*?)\}>\(\)/)?.[1] ?? '';
    expect(propsBlock).not.toMatch(/dlc/i);
  });
});

describe('PanelDlcManager 复用底层安装/卸载/导入/预检导出（不重写逻辑、不改签名）', () => {
  it('import dlcInstaller：installDlc/uninstallDlc/installRawBooks/parseManifest/precheckManifest 等均在', () => {
    for (const sym of [
      'bookNameFromFile',
      'installDlc',
      'installRawBooks',
      'parseManifest',
      'precheckManifest',
      'readUninstallPlan',
      'renderDataCardEntry',
      'replayCodexSeeds',
      'sniffRawWorldbook',
      'uninstallDlc',
    ]) {
      expect(DLC_SFC, sym).toMatch(new RegExp(`\\b${sym}\\b`));
    }
    // 类型 import
    for (const t of ['DlcCodexTransaction', 'DlcManifest', 'InstallReceipt', 'UninstallPlan']) {
      expect(DLC_SFC, t).toMatch(new RegExp(`type ${t}`));
    }
    // 单一 import 语句来源正确
    expect(DLC_SFC).toMatch(/from '(?:\.\.\/)?\.\.\/红警指挥系统\/worldbook\/dlcInstaller'/);
  });

  it('底层导出均为函数（签名存在、可纯跑或存在性可断言）', () => {
    for (const fn of [
      bookNameFromFile,
      installDlc,
      installRawBooks,
      parseManifest,
      precheckManifest,
      readUninstallPlan,
      renderDataCardEntry,
      replayCodexSeeds,
      sniffRawWorldbook,
      uninstallDlc,
    ]) {
      expect(typeof fn).toBe('function');
    }
  });

  it('不 import 用不到的 OFFICIAL_BOOKS（任务明确要求）', () => {
    expect(DLC_SFC).not.toMatch(/OFFICIAL_BOOKS/);
  });

  it('systemCheck.lintBookContent/CheckIssue、useCatalog.useCatalogStore、store 复用同源', () => {
    expect(DLC_SFC).toMatch(
      /import\s*\{\s*checkEnv,\s*lintBookContent,\s*type CheckIssue\s*\}\s*from '(?:\.\.\/)?\.\.\/红警指挥系统\/parse\/systemCheck'/,
    );
    expect(DLC_SFC).toMatch(/import\s*\{\s*useCatalogStore\s*\}\s*from '(?:\.\.\/)?\.\.\/红警指挥系统\/composables\/useCatalog'/);
    expect(DLC_SFC).toMatch(/import\s*\{\s*in_tavern,\s*useDataStore\s*\}\s*from '(?:\.\.\/)?\.\.\/红警指挥系统\/composables\/store'/);
    expect(DLC_SFC).toMatch(/checkEnv\(in_tavern\)/);
  });

  it('调用逐字同源：installDlc(parsed, txn, overlays) / uninstallDlc(id, txn) / installRawBooks(...)', () => {
    expect(DLC_SFC).toMatch(/await installDlc\(parsed\.value, dlcCodexTransaction, catalog\.overlays\)/);
    expect(DLC_SFC).toMatch(/await uninstallDlc\(id, dlcCodexTransaction\)/);
    expect(DLC_SFC).toMatch(/await installRawBooks\(/);
    expect(DLC_SFC).toMatch(/precheckManifest\(manifest, catalog\.overlays\)/);
    expect(DLC_SFC).toMatch(/const \{ manifest, error \} = parseManifest\(manifestText\.value\)/);
    expect(DLC_SFC).toMatch(/readUninstallPlan\(id\)/);
  });
});

describe('page prop 分流（方案 A 单文件双子页 + 系统暂未开放占位）', () => {
  it('defineProps<{ page: installed | import }>()', () => {
    expect(DLC_SFC).toMatch(/defineProps<\{\s*page:\s*'installed'\s*\|\s*'import'\s*\}>\(\)/);
  });

  it('两子页统一渲染「系统暂未开放，敬请期待」占位提示，底层 page 分支保留', () => {
    expect(DLC_SFC).toContain('data-test="dlc-coming-soon-placeholder"');
    expect(DLC_SFC).toContain('系统暂未开放，敬请期待');
    expect(DLC_SFC).toMatch(/page === 'installed'/);
    expect(DLC_SFC).toMatch(/page === 'import'/);
  });
});

describe('保留 catalog.init（DLC 区自身状态）', () => {
  it('doInstall / doUninstall 后均保留 catalog.init()（overlay 即刻生效）', () => {
    const code = stripComments(DLC_SFC);
    expect(code).toMatch(/catalog\.init\(\)/);
    // 至少两处（安装后 + 卸载后）
    expect(code.match(/catalog\.init\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

describe('不搬体检态/总开关跨区联动（本任务刻意取舍，带注释）', () => {
  it('stripComments 后不出现 ran.value（体检态联动）', () => {
    expect(stripComments(DLC_SFC)).not.toMatch(/ran\.value/);
  });

  it('stripComments 后不出现 refreshBooks（世界书总开关联动）', () => {
    expect(stripComments(DLC_SFC)).not.toMatch(/refreshBooks/);
  });

  it('取舍注释在源码中显式说明（承 MIGRATE-04/05/06 风格）', () => {
    expect(DLC_SFC).toMatch(/不搬[\s\S]*ran\.value/);
    expect(DLC_SFC).toMatch(/不搬[\s\S]*refreshBooks/);
  });
});

describe('SFC 规范与样式复用', () => {
  it('<script setup lang="ts">、<template>、<style scoped>', () => {
    expect(DLC_SFC).toMatch(/<script setup lang="ts">/);
    expect(DLC_SFC).toMatch(/<template>/);
    expect(DLC_SFC).toMatch(/<style scoped>/);
  });

  it('外层 section 带 ra-dlc class，且自带 sysbtn/sysbtn--go/sysbtn--danger/systa 样式', () => {
    expect(DLC_SFC).toMatch(/class="ra-dlc card/);
    expect(DLC_SFC).toMatch(/\.ra-dlc \.sysbtn\b/);
    expect(DLC_SFC).toMatch(/\.ra-dlc \.sysbtn--go\b/);
    expect(DLC_SFC).toMatch(/\.ra-dlc \.sysbtn--danger\b/);
    expect(DLC_SFC).toMatch(/\.ra-dlc \.systa\b/);
  });
});

/* ═══════════════ dlcInstaller 纯函数降级/契约（可在 node 环境纯跑，不依赖真机宿主 API） ═══════════════ */

describe('dlcInstaller 纯函数降级/契约', () => {
  it('parseManifest：非 JSON 文本 → 返回 error、无 manifest', () => {
    const r = parseManifest('这不是 json{');
    expect(r.manifest).toBeUndefined();
    expect(typeof r.error).toBe('string');
    expect(r.error).toMatch(/JSON 解析失败/);
  });

  it('parseManifest：合法 JSON 但结构不合规 → 返回 error', () => {
    const r = parseManifest(JSON.stringify({ foo: 'bar' }));
    expect(r.manifest).toBeUndefined();
    expect(typeof r.error).toBe('string');
  });

  it('sniffRawWorldbook：有 entries 且无 dlc → 判定为裸世界书', () => {
    const raw = sniffRawWorldbook(JSON.stringify({ entries: { '0': { content: 'x' } } }));
    expect(raw).not.toBeNull();
    expect(raw?.entries).toBeDefined();
  });

  it('sniffRawWorldbook：含 dlc 字段（DLC 包）→ 返回 null（走 manifest 通道）', () => {
    const raw = sniffRawWorldbook(JSON.stringify({ dlc: { id: 'x' }, entries: {} }));
    expect(raw).toBeNull();
  });

  it('sniffRawWorldbook：非 JSON → 返回 null', () => {
    expect(sniffRawWorldbook('not json')).toBeNull();
  });

  it('bookNameFromFile：去 .json 与 _世界书 后缀', () => {
    expect(bookNameFromFile('北坡纪事_世界书.json')).toBe('北坡纪事');
    expect(bookNameFromFile('Foehn.JSON')).toBe('Foehn');
  });

  it('readUninstallPlan：非酒馆环境（getVariables 不可用）→ 返回 null', () => {
    // node 测试环境无 window.TavernHelper.getVariables，tav('getVariables') 取不到 → 直接 null
    expect(readUninstallPlan('any-id')).toBeNull();
  });

  it('renderDataCardEntry：无 data 内容的 manifest → 返回 null（数据卡关闭）', () => {
    const m = { dlc: { id: 'x', name: 'X', version: '1', kind: 'faction' } } as unknown as DlcManifest;
    // renderDataCardEntry 对无 data 的清单应安全返回 null，不抛
    expect(renderDataCardEntry(m)).toBeNull();
  });
});

describe('FIX-P0-01 · PanelDlcManager 接入 updateFloorVars 与 floating.refresh()', () => {
  it('引入 updateFloorVars 与 useFloatingStore', () => {
    expect(DLC_SFC).toMatch(/import\s*\{\s*updateFloorVars\s*\}\s*from\s*['"](?:\.\.|\.)(?:\/host)?\/floorVarWrite['"]/);
    expect(DLC_SFC).toMatch(/import\s*\{\s*useFloatingStore\s*\}\s*from\s*['"](?:\.\.\/)?\.\.\/红警指挥系统\/composables\/useFloatingStore['"]/);
    expect(DLC_SFC).toMatch(/const\s+floating\s*=\s*useFloatingStore\(\)/);
  });

  it('dlcCodexTransaction.write 与 doReplaySeeds 均在 floating.floorId !== null 时调用 updateFloorVars 写回楼层 stat_data.codex 并刷新 floating', () => {
    expect(DLC_SFC).toMatch(/write:\s*async\s+items\s*=>[\s\S]*?await\s+updateFloorVars\(floating\.floorId/);
    expect(DLC_SFC).toMatch(/write:\s*async\s+items\s*=>[\s\S]*?await\s+floating\.refresh\(\)/);
    expect(DLC_SFC).toMatch(/if\s*\(replayed\.length\s*&&\s*floating\.floorId\s*!==\s*null\)[\s\S]*?await\s+updateFloorVars\(floating\.floorId/);
    expect(DLC_SFC).toMatch(/if\s*\(replayed\.length\s*&&\s*floating\.floorId\s*!==\s*null\)[\s\S]*?await\s+floating\.refresh\(\)/);
  });
});

