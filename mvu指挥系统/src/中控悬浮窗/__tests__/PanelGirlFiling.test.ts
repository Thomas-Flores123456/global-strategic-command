/**
 * PanelGirlFiling.test.ts —— 机娘入档区迁入中控台设置弹窗（CTRL-SETTINGS-MIGRATE-05 第五枪迁移）
 *
 * 范式与同目录 PanelArchive.test.ts / PanelWorldbookToggle.test.ts / PanelExportSave.test.ts 一致：
 * vitest 为 node 环境且无 SFC 编译插件，故以「源码文本静态契约」+「底层导出存在性」双轨验证：
 * ① ModalSettings.vue 左栏 groups 追加「机娘」组（key: 'girls'），并有 #panel-girls slot 挂载
 *    PanelGirlFiling；「环境 / 世界书 / 存档 / 归档 / 内容体检」五组保持原样（共六组）；
 * ② PanelGirlFiling.vue 复用 filerState / setAutoFile / fileAllPending（import 自 useGirlFiler）、
 *    useDataStore / in_tavern（store）、checkEnv（systemCheck）；
 * ③ 负向断言（关键红线）：组件源码不 import 也不调用 installAutoFiler，且不自建监听 pending_lore 的 watch；
 * ④ 非酒馆降级：env.inTavern=false 时「入档双书」按钮禁用并显示「预览环境不可写」，pending_lore 空态
 *    显示「暂无待入档档案」；
 * ⑤ 不引入入档以外的越权写 API；
 * ⑥ SFC 规范。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本，不进 bundle */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';
import { checkEnv } from '../../红警指挥系统/parse/systemCheck';
import { setAutoFile } from '../../红警指挥系统/composables/useGirlFiler';
import { filerState, runGirlFromFloating } from '../host/girlAutoFiler';

const DIR = join(__dirname, '..');
const MODAL_SETTINGS_SFC = readFileSync(join(DIR, 'modals/ModalSettings.vue'), 'utf8');
const GIRL_SFC = readFileSync(join(DIR, 'panels/PanelGirlFiling.vue'), 'utf8');

/**
 * 去掉 HTML 注释、块注释与行注释后的源码。
 * 本组件在模板顶部与脚本内以注释形式说明「不搬 installAutoFiler / 不自建 watch」的取舍，
 * 这些说明性提及属文档、非可执行代码，剥离后再断言真实代码里不含该观察者。
 */
function stripComments(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('ModalSettings 左栏追加「机娘」组（CTRL-SETTINGS-MIGRATE-05）', () => {
  it('groups 六组：环境 / 世界书 / 存档 / 归档 / 机娘 / 内容体检，且机娘组 key 为 girls', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'env',\s*label:\s*'(?:环境|终端与外观)'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'(?:books|toggle)',\s*label:\s*'世界书(?:与模组|开关)?'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'save',\s*label:\s*'存档(?:导出)?'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'archive',\s*label:\s*'(?:动态)?归档'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'girls',\s*label:\s*'机娘(?:入档)?'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'integrity',\s*label:\s*'内容体检'/);
  });

  it('机娘组通过 #panel-girls slot 挂载 PanelGirlFiling', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/import PanelGirlFiling from '(?:\.\.|\.)(?:\/panels)?\/PanelGirlFiling\.vue'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-girls[\s\S]*?<PanelGirlFiling\s*\/>/);
  });

  it('环境 / 世界书 / 存档 / 归档 / 内容体检五组保持原样可用（不被本任务破坏）', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-env\b/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-books[\s\S]*?<PanelWorldbookToggle\s*\/>/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-save[\s\S]*?<PanelExportSave\s*\/>/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-archive[\s\S]*?<PanelArchive\s*\/>/);
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

describe('PanelGirlFiling 复用中控 girlAutoFiler 与 useGirlFiler（FIX-P0-01 写回楼层变量闭环）', () => {
  it('复用 girlAutoFiler.filerState / runGirlFromFloating 与 useGirlFiler.setAutoFile（不再调楼层只读 fileAllPending）', () => {
    expect(GIRL_SFC).toMatch(
      /import\s*\{\s*filerState,\s*runGirlFromFloating\s*\}\s*from '(?:\.\.|\.)(?:\/host)?\/girlAutoFiler'/,
    );
    expect(GIRL_SFC).toMatch(
      /import\s*\{\s*setAutoFile\s*\}\s*from '(?:\.\.\/)?\.\.\/红警指挥系统\/composables\/useGirlFiler'/,
    );
    expect(GIRL_SFC).toMatch(
      /import\s*\{\s*useFloatingStore\s*\}\s*from '(?:\.\.\/)?\.\.\/红警指挥系统\/composables\/useFloatingStore'/,
    );
    expect(stripComments(GIRL_SFC)).not.toMatch(/fileAllPending/);
    expect(typeof runGirlFromFloating).toBe('function');
    expect(typeof setAutoFile).toBe('function');
    expect(typeof filerState).toBe('object');
    // filerState 是共享的模块级 reactive 单例，暴露 auto / busy / receipts
    expect(filerState).toHaveProperty('auto');
    expect(filerState).toHaveProperty('busy');
    expect(Array.isArray(filerState.receipts)).toBe(true);
  });

  it('复用 store.useDataStore / in_tavern、useFloatingStore 与 checkEnv(in_tavern)', () => {
    expect(GIRL_SFC).toMatch(/import\s*\{\s*in_tavern,\s*useDataStore\s*\}\s*from '(?:\.\.\/)?\.\.\/红警指挥系统\/composables\/store'/);
    expect(GIRL_SFC).toMatch(/import\s*\{\s*checkEnv\s*\}\s*from '(?:\.\.\/)?\.\.\/红警指挥系统\/parse\/systemCheck'/);
    expect(GIRL_SFC).toMatch(/checkEnv\(in_tavern\)/);
    expect(GIRL_SFC).toMatch(/useDataStore\(\)/);
    expect(GIRL_SFC).toMatch(/const\s+floating\s*=\s*useFloatingStore\(\)/);
    expect(typeof checkEnv).toBe('function');
  });

  it('入档调用绑定中控专属通道：setAutoFile(!filerState.auto) / runGirlFromFloating(floating) / 读 store.data.pending_lore', () => {
    expect(GIRL_SFC).toMatch(/setAutoFile\(!filerState\.auto\)/);
    expect(GIRL_SFC).toMatch(/@click="runGirlFromFloating\(floating\)"/);
    expect(GIRL_SFC).toMatch(/store\.data\.pending_lore/);
    // 回执流水读 filerState.receipts（ok/girl/note）
    expect(GIRL_SFC).toMatch(/filerState\.receipts/);
    expect(GIRL_SFC).toMatch(/r\.ok/);
    expect(GIRL_SFC).toMatch(/r\.girl/);
    expect(GIRL_SFC).toMatch(/r\.note/);
    // 自动开关态展示 filerState.auto 开/关
    expect(GIRL_SFC).toMatch(/filerState\.auto \? '开' : '关'/);
  });
});

describe('关键红线：不搬跨端观察者 installAutoFiler / 不自建 pending_lore watch', () => {
  it('组件源码（剥注释后）不 import 也不调用 installAutoFiler', () => {
    const code = stripComments(GIRL_SFC);
    expect(code).not.toMatch(/installAutoFiler/);
  });

  it('组件源码（剥注释后）不自建任何 watch/watchEffect（避免与楼层观察者双写 pending_lore）', () => {
    const code = stripComments(GIRL_SFC);
    expect(code).not.toMatch(/\bwatch\s*\(/);
    expect(code).not.toMatch(/\bwatchEffect\s*\(/);
  });
});

describe('非酒馆环境安全降级', () => {
  it('env.inTavern=false 时「入档双书」按钮禁用并显示「预览环境不可写」文案', () => {
    expect(GIRL_SFC).toMatch(/:disabled="filerState\.busy \|\| !env\.inTavern"/);
    expect(GIRL_SFC).toMatch(/env\.inTavern \? '入档双书' : '预览环境不可写'/);
    expect(GIRL_SFC).toMatch(/filerState\.busy \? '入档中…'/);
  });

  it('pending_lore 空态显示「暂无待入档档案」，且使用 isGirlDossierEntry 过滤非机娘项（BUG-R2-13）', () => {
    expect(GIRL_SFC).toMatch(/import\s*\{\s*isGirlDossierEntry\s*\}\s*from '(?:\.\.\/)?\.\.\/红警指挥系统\/worldbook\/girlFiler'/);
    expect(GIRL_SFC).toMatch(/const\s+pending\s*=\s*computed\(\(\)\s*=>\s*\(store\.data\.pending_lore\s*\?\?\s*\[\]\)\.filter\(isGirlDossierEntry\)\)/);
    expect(GIRL_SFC).toMatch(/v-if="!pending\.length"/);
    expect(GIRL_SFC).toMatch(/v-for="d in pending"/);
    expect(GIRL_SFC).toMatch(/暂无待入档档案/);
  });

  it('复用 sysbtn / card 等既有样式类与阵营 CSS 变量', () => {
    expect(GIRL_SFC).toMatch(/class="ra-girlfiling card/);
    expect(GIRL_SFC).toMatch(/class="sysbtn"/);
    expect(GIRL_SFC).toMatch(/var\(--ok\)|var\(--danger\)|var\(--line\)|var\(--t-faint\)/);
  });
});

describe('不引入入档以外的越权写 API', () => {
  it('无 navigator.clipboard / setChatMessages / replaceWorldbook / 变量写入等', () => {
    const code = stripComments(GIRL_SFC);
    expect(code).not.toMatch(/navigator\.clipboard/);
    expect(code).not.toMatch(/from '[^']*\/send'/);
    expect(code).not.toMatch(/sendAction/);
    expect(code).not.toMatch(
      /setChatMessages|createChatMessages|triggerSlash|updateWorldbookWith|createWorldbook|replaceWorldbook|deleteWorldbook|rebindGlobalWorldbooks|rebindCharWorldbooks|insertOrAssignVariables|replaceVariables|updateVariablesWith|deleteVariable|applyBookToggles|archiveCodexEntries|resolveOrphan/,
    );
  });
});

describe('SFC 规范', () => {
  it('<script setup lang="ts">、<template>、<style scoped>', () => {
    expect(GIRL_SFC).toMatch(/<script setup lang="ts">/);
    expect(GIRL_SFC).toMatch(/<template>/);
    expect(GIRL_SFC).toMatch(/<style scoped>/);
  });
});
