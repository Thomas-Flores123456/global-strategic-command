/**
 * PanelArchive.test.ts —— 动态归档区迁入中控台设置弹窗（CTRL-SETTINGS-MIGRATE-04 第四枪迁移）
 *
 * 范式与同目录 PanelWorldbookToggle.test.ts / PanelExportSave.test.ts 一致：vitest 为 node 环境
 * 且无 SFC 编译插件，故以「源码文本静态契约」+「底层纯函数导出存在性」双轨验证：
 * ① ModalSettings.vue 左栏 groups 追加「归档」组（key: 'archive'），并有 #panel-archive slot 挂载
 *    PanelArchive；「环境 / 世界书 / 存档 / 内容体检」四组保持原样；
 * ② PanelArchive.vue 复用 archiveCodexEntries / resolveOrphan（import 自 dlcInstaller）、readArchive
 *    （import 自 systemCheck），不引入归档/孤儿以外的越权写 API；
 * ③ archCandidates 过滤语义（kind !== '阵营' && !(name in archRegistry)）在源码里存在；
 * ④ 非酒馆降级：readArchive() 返回 null → archReady=false → 降级文案「独立预览环境不可用」，
 *    按钮以 env.inTavern 门控；
 * ⑤ 不搬体检态/总开关联动（stripComments 后不出现 ran.value 与 refreshBooks）；
 * ⑥ SFC 规范。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本，不进 bundle */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';
import { archiveCodexEntries, resolveOrphan, type ArchiveCandidate } from '../../红警指挥系统/worldbook/dlcInstaller';
import { readArchive, type ArchiveRecord } from '../../红警指挥系统/parse/systemCheck';

const DIR = join(__dirname, '..');
const MODAL_SETTINGS_SFC = readFileSync(join(DIR, 'modals/ModalSettings.vue'), 'utf8');
const ARCHIVE_SFC = readFileSync(join(DIR, 'panels/PanelArchive.vue'), 'utf8');

/**
 * 去掉 HTML 注释、块注释与行注释后的源码。
 * 本组件在模板顶部与脚本内以注释形式说明「不搬 ran.value / refreshBooks 两句联动」的取舍，
 * 这些说明性提及属文档、非可执行代码，剥离后再断言真实代码里不含该联动。
 */
function stripComments(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('ModalSettings 左栏追加「归档」组（CTRL-SETTINGS-MIGRATE-04）', () => {
  it('groups 五组：环境 / 世界书 / 存档 / 归档 / 内容体检，且归档组 key 为 archive', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'env',\s*label:\s*'(?:环境|终端与外观)'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'(?:books|toggle)',\s*label:\s*'世界书(?:与模组|开关)?'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'save',\s*label:\s*'存档(?:导出)?'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'archive',\s*label:\s*'(?:动态)?归档'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'integrity',\s*label:\s*'内容体检'/);
  });

  it('归档组通过 #panel-archive slot 挂载 PanelArchive（与「存档」独立成组、不合并）', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/import PanelArchive from '(?:\.\.|\.)(?:\/panels)?\/PanelArchive\.vue'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-archive[\s\S]*?<PanelArchive\s*\/>/);
  });

  it('环境 / 世界书 / 存档 / 内容体检四组保持原样可用（不被本任务破坏）', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-env\b/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-books[\s\S]*?<PanelWorldbookToggle\s*\/>/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-save[\s\S]*?<PanelExportSave\s*\/>/);
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
  });
});

describe('PanelArchive 复用底层归档/孤儿导出（不重写逻辑，不改签名）', () => {
  it('复用 dlcInstaller.archiveCodexEntries / resolveOrphan（import 存在且为函数）', () => {
    expect(ARCHIVE_SFC).toMatch(
      /import\s*\{\s*archiveCodexEntries,\s*resolveOrphan\s*\}\s*from '(?:\.\.\/)?\.\.\/红警指挥系统\/worldbook\/dlcInstaller'/,
    );
    expect(typeof archiveCodexEntries).toBe('function');
    expect(typeof resolveOrphan).toBe('function');
  });

  it('复用 systemCheck.readArchive（import 存在且为函数）与 ArchiveRecord 类型', () => {
    expect(ARCHIVE_SFC).toMatch(
      /import\s*\{\s*checkEnv,\s*readArchive,\s*type ArchiveRecord\s*\}\s*from '(?:\.\.\/)?\.\.\/红警指挥系统\/parse\/systemCheck'/,
    );
    expect(typeof readArchive).toBe('function');
  });

  it('复用 store.useDataStore / in_tavern 与 checkEnv(in_tavern)', () => {
    expect(ARCHIVE_SFC).toMatch(/import\s*\{\s*in_tavern,\s*useDataStore\s*\}\s*from '(?:\.\.\/)?\.\.\/红警指挥系统\/composables\/store'/);
    expect(ARCHIVE_SFC).toMatch(/checkEnv\(in_tavern\)/);
    expect(ARCHIVE_SFC).toMatch(/useDataStore\(\)/);
  });

  it('归档/孤儿调用逐字同源：archiveCodexEntries(items) / resolveOrphan(name, action)', () => {
    expect(ARCHIVE_SFC).toMatch(/await archiveCodexEntries\(items\)/);
    expect(ARCHIVE_SFC).toMatch(/await resolveOrphan\(name, action\)/);
    // restore 幂等 push codex（已存在则不重复）
    expect(ARCHIVE_SFC).toMatch(/if \(!store\.data\.codex\.some\(c => c\.name === name\)\)/);
    expect(ARCHIVE_SFC).toMatch(/store\.data\.codex\.push\(/);
  });
});

describe('archCandidates 过滤语义（非阵营 && 未入 $archive）', () => {
  it('源码保留 kind !== 阵营 且 !(name in archRegistry) 派生自 useDataStore().data.codex', () => {
    expect(ARCHIVE_SFC).toMatch(
      /const archCandidates = computed\(\(\) =>\s*store\.data\.codex\.filter\(c => c\.kind !== '阵营' && !\(c\.name in archRegistry\.value\)\),?\s*\)/,
    );
  });

  it('refreshArchive：readArchive → 计算孤儿（正史有、变量无）', () => {
    expect(ARCHIVE_SFC).toMatch(/const arch = await readArchive\(\)/);
    expect(ARCHIVE_SFC).toMatch(/archOrphans\.value = Object\.keys\(arch\)\.filter\(n => !codexNames\.has\(n\)\)/);
  });
});

describe('非酒馆环境安全降级', () => {
  it('readArchive() 返回 null → archReady=false → 降级文案「独立预览环境不可用」', () => {
    expect(ARCHIVE_SFC).toMatch(/if \(arch === null\)\s*\{\s*archReady\.value = false;\s*return;\s*\}/);
    expect(ARCHIVE_SFC).toMatch(/v-else[\s\S]*独立预览环境不可用/);
    expect(ARCHIVE_SFC).toMatch(/变量→世界书晋升管道/);
  });

  it('归档按钮以 env.inTavern 门控 disabled', () => {
    expect(ARCHIVE_SFC).toMatch(/:disabled="!env\.inTavern \|\| !archSel\.size \|\| archBusy"/);
  });

  it('复用 sysbtn / card / sysbtn--danger 等既有样式类与阵营 CSS 变量', () => {
    expect(ARCHIVE_SFC).toMatch(/class="ra-archive card/);
    expect(ARCHIVE_SFC).toMatch(/class="sysbtn/);
    expect(ARCHIVE_SFC).toMatch(/sysbtn--danger/);
    expect(ARCHIVE_SFC).toMatch(/var\(--warn\)|var\(--danger\)|var\(--ok\)/);
  });
});

describe('不搬体检态/总开关跨区联动（本任务刻意取舍）', () => {
  it('stripComments 后不出现 ran.value（体检态联动）', () => {
    const code = stripComments(ARCHIVE_SFC);
    expect(code).not.toMatch(/ran\.value/);
  });

  it('stripComments 后不出现 refreshBooks（世界书总开关联动）', () => {
    const code = stripComments(ARCHIVE_SFC);
    expect(code).not.toMatch(/refreshBooks/);
  });
});

describe('不引入归档/孤儿以外的越权写 API', () => {
  it('无 setChatMessages / replaceWorldbook / rebindGlobalWorldbooks / applyBookToggles / navigator.clipboard 等', () => {
    const code = stripComments(ARCHIVE_SFC);
    expect(code).not.toMatch(/navigator\.clipboard/);
    expect(code).not.toMatch(/from '[^']*\/send'/);
    expect(code).not.toMatch(/sendAction/);
    expect(code).not.toMatch(
      /setChatMessages|createChatMessages|triggerSlash|updateWorldbookWith|createWorldbook|replaceWorldbook|deleteWorldbook|rebindGlobalWorldbooks|rebindCharWorldbooks|insertOrAssignVariables|replaceVariables|deleteVariable|applyBookToggles/,
    );
  });
});

describe('SFC 规范', () => {
  it('<script setup lang="ts">、<template>、<style scoped>', () => {
    expect(ARCHIVE_SFC).toMatch(/<script setup lang="ts">/);
    expect(ARCHIVE_SFC).toMatch(/<template>/);
    expect(ARCHIVE_SFC).toMatch(/<style scoped>/);
  });
});

/** 让 ArchiveCandidate 类型 import 参与类型检查（结构对齐 dlcInstaller 导出） */
const _candidateShape: ArchiveCandidate = { name: 'x', kind: '科技' };
void _candidateShape;
void (null as unknown as ArchiveRecord);

describe('FIX-P0-01 · PanelArchive.doOrphan(restore) 接入 updateFloorVars 与 floating.refresh()', () => {
  it('引入 updateFloorVars 与 useFloatingStore', () => {
    expect(ARCHIVE_SFC).toMatch(/import\s*\{\s*updateFloorVars\s*\}\s*from\s*['"](?:\.\.|\.)(?:\/host)?\/floorVarWrite['"]/);
    expect(ARCHIVE_SFC).toMatch(/import\s*\{\s*useFloatingStore\s*\}\s*from\s*['"](?:\.\.\/)?\.\.\/红警指挥系统\/composables\/useFloatingStore['"]/);
    expect(ARCHIVE_SFC).toMatch(/const\s+floating\s*=\s*useFloatingStore\(\)/);
  });

  it('doOrphan(restore) 在更新本地 codex 后，当 floating.floorId !== null 时调用 updateFloorVars 写回楼层 stat_data.codex 并刷新 floating', () => {
    expect(ARCHIVE_SFC).toMatch(/if\s*\(floating\.floorId\s*!==\s*null\)/);
    expect(ARCHIVE_SFC).toMatch(/await\s+updateFloorVars\(floating\.floorId/);
    expect(ARCHIVE_SFC).toMatch(/if\s*\(!codex\.some\(c\s*=>\s*c\.name\s*===\s*name\)\)/);
    expect(ARCHIVE_SFC).toMatch(/return\s*\{\s*\.\.\.vars,\s*stat_data:\s*\{\s*\.\.\.sd,\s*codex\s*\}\s*\}/);
    expect(ARCHIVE_SFC).toMatch(/await\s+floating\.refresh\(\)/);
  });
});

describe('FD-49 PKG-A · PanelArchive 排除已入册核心人员与已入档派生索引', () => {
  it('声明 isAlreadyRosteredOrCanonical 与 unfiledArchCandidates，自动排除首发MCV机娘与开局随行人员', () => {
    expect(ARCHIVE_SFC).toContain('CANONICAL_STARTER_GIRLS');
    expect(ARCHIVE_SFC).toContain('CANONICAL_STARTER_HUMANS');
    for (const name of ['白凌', '喀秋莎', '尤里卡', '凛冬妮娅', '妮娅', '薇拉', '萧栖雪', '杜月欣', '陆玉凝', '林晚', '苏晓']) {
      expect(ARCHIVE_SFC).toContain(`'${name}'`);
    }
    expect(ARCHIVE_SFC).toContain("name.startsWith('待授名·')");
    expect(ARCHIVE_SFC).toContain("c.params?.['随行渊源'] || c.params?.['席位任命']");
    expect(ARCHIVE_SFC).toContain('store.data.forces?.girls');
    expect(ARCHIVE_SFC).toContain('完整技能档案见《机娘·能力档案》');
  });

  it('archKindCounts、filteredArchCandidates 与模板总数基于 unfiledArchCandidates 派生', () => {
    expect(ARCHIVE_SFC).toMatch(/const unfiledArchCandidates = computed\(\(\) =>\s*archCandidates\.value\.filter\(c => !isAlreadyRosteredOrCanonical\(c\)\)/);
    expect(ARCHIVE_SFC).toContain('for (const c of unfiledArchCandidates.value)');
    expect(ARCHIVE_SFC).toContain('if (selectedKind.value === \'all\') return unfiledArchCandidates.value;');
    expect(ARCHIVE_SFC).toContain('全部 ({{ unfiledArchCandidates.length }})');
  });
});


