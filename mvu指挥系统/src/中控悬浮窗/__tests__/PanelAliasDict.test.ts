/**
 * PanelAliasDict.test.ts —— 别名词典子页迁入中控台设置弹窗（CTRL-SETTINGS-MIGRATE-06 第六枪 · 子页②）
 *
 * 范式与同目录 PanelArchive.test.ts / PanelGirlFiling.test.ts 一致：vitest 为 node 环境且无 SFC
 * 编译插件，故以「源码文本静态契约」+「底层导出存在性」双轨验证：
 * ① PanelAliasDict.vue 复用 useParse 的别名 CRUD 同源 API（loadAliases / addAlias / removeAlias /
 *    buildAuthority / refreshAuthorityBooks）、systemCheck.checkEnv、store.in_tavern；
 * ② 权威名校验逐字同源：不在名单时首次 warn / 二次强加（aliasForce）；
 * ③ 负向断言（关键红线）：源码（剥注释后）不含 initParseRunner、不含 parseRunner、不含 eventOn(、不含 ran.value；
 * ④ 非酒馆降级：env.inTavern=false 时增删/刷新按钮禁用，空态文案存在；
 * ⑤ onMounted loadAliases（两子页联动：解析子页记为别名后切来重读）；
 * ⑥ 不引入别名以外的越权写 API；SFC 规范。
 *
 * ModalSettings 子页装配契约（第七组「解析」+ 两 slot）在 PanelParseRepair.test.ts 中集中断言，此处不重复。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本，不进 bundle */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';
import { checkEnv } from '../../红警指挥系统/parse/systemCheck';
import { addAlias, buildAuthority, loadAliases, refreshAuthorityBooks, removeAlias } from '../../红警指挥系统/composables/useParse';

const DIR = join(__dirname, '..');
const ALIAS_SFC = readFileSync(join(DIR, 'panels/PanelAliasDict.vue'), 'utf8');

/** 剥注释后再断言真实代码不含被禁触发器/联动（注释里说明取舍是允许的） */
function stripComments(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('PanelAliasDict 复用底层别名 CRUD 导出（不重写逻辑，不改签名）', () => {
  it('复用 useParse 别名 CRUD 同源 API（import 存在且运行时可用）', () => {
    expect(ALIAS_SFC).toMatch(
      /import\s*\{\s*addAlias,\s*buildAuthority,\s*loadAliases,\s*refreshAuthorityBooks,\s*removeAlias\s*\}\s*from '(?:\.\.\/)?\.\.\/红警指挥系统\/composables\/useParse'/,
    );
    expect(typeof loadAliases).toBe('function');
    expect(typeof addAlias).toBe('function');
    expect(typeof removeAlias).toBe('function');
    expect(typeof buildAuthority).toBe('function');
    expect(typeof refreshAuthorityBooks).toBe('function');
  });

  it('复用 systemCheck.checkEnv、store.in_tavern', () => {
    expect(ALIAS_SFC).toMatch(/import\s*\{\s*checkEnv\s*\}\s*from '(?:\.\.\/)?\.\.\/红警指挥系统\/parse\/systemCheck'/);
    expect(ALIAS_SFC).toMatch(/import\s*\{\s*in_tavern\s*\}\s*from '(?:\.\.\/)?\.\.\/红警指挥系统\/composables\/store'/);
    expect(ALIAS_SFC).toMatch(/checkEnv\(in_tavern\)/);
    expect(typeof checkEnv).toBe('function');
  });

  it('别名调用逐字同源：loadAliases / addAlias / removeAlias / refreshAuthorityBooks', () => {
    expect(ALIAS_SFC).toMatch(/aliasMap\.value = await loadAliases\(\)/);
    expect(ALIAS_SFC).toMatch(/await addAlias\(v,\s*c\)/);
    expect(ALIAS_SFC).toMatch(/await removeAlias\(variant\)/);
    expect(ALIAS_SFC).toMatch(/await refreshAuthorityBooks\(\)/);
  });

  it('权威名校验逐字同源：不在名单首次 warn / 二次强加（aliasForce + buildAuthority）', () => {
    expect(ALIAS_SFC).toMatch(/const auth = await buildAuthority\(\)/);
    expect(ALIAS_SFC).toMatch(/if \(!auth\.names\.includes\(c\)\)/);
    expect(ALIAS_SFC).toMatch(/aliasForce\.value = true/);
    expect(ALIAS_SFC).toMatch(/aliasForce \? '强制添加' : '添加'/);
  });

  it('onMounted 重读 loadAliases（两子页联动：解析子页「记为别名」后切来重读到最新词典）', () => {
    expect(ALIAS_SFC).toMatch(/onMounted\([\s\S]*?refreshAliases\(\)/);
  });
});

describe('关键红线：不搬也不重装楼层自动解析触发器 / 不搬体检态联动', () => {
  it('组件源码（剥注释后）不含 initParseRunner / parseRunner', () => {
    const code = stripComments(ALIAS_SFC);
    expect(code).not.toMatch(/initParseRunner/);
    expect(code).not.toMatch(/parseRunner/);
  });

  it('组件源码（剥注释后）不自建任何 eventOn( 酒馆事件监听，且不含 ran.value', () => {
    const code = stripComments(ALIAS_SFC);
    expect(code).not.toMatch(/eventOn\(/);
    expect(code).not.toMatch(/ran\.value/);
  });
});

describe('非酒馆环境安全降级', () => {
  it('env.inTavern=false 时增删/添加/刷新按钮以 env.inTavern 门控 disabled', () => {
    expect(ALIAS_SFC).toMatch(/:disabled="!env\.inTavern \|\| aliasBusy"/);
    expect(ALIAS_SFC).toMatch(
      /:disabled="!env\.inTavern \|\| aliasBusy \|\| !aliasVar\.trim\(\) \|\| !aliasCanon\.trim\(\)"/,
    );
    expect(ALIAS_SFC).toMatch(/独立预览仅展示布局/);
  });

  it('空态文案存在：暂无别名', () => {
    expect(ALIAS_SFC).toMatch(/v-if="!aliasList\.length"/);
    expect(ALIAS_SFC).toMatch(/暂无别名/);
  });

  it('复用 sysbtn / card / sysbtn--go / systa 等既有样式类与阵营 CSS 变量', () => {
    expect(ALIAS_SFC).toMatch(/class="ra-alias card/);
    expect(ALIAS_SFC).toMatch(/class="sysbtn"/);
    expect(ALIAS_SFC).toMatch(/sysbtn--go/);
    expect(ALIAS_SFC).toMatch(/class="systa/);
    expect(ALIAS_SFC).toMatch(/var\(--ok\)|var\(--warn\)|var\(--line\)|var\(--t-faint\)/);
  });
});

describe('不引入别名以外的越权写 API', () => {
  it('无 navigator.clipboard / setChatMessages / replaceWorldbook / 归档 / 入档写入等', () => {
    const code = stripComments(ALIAS_SFC);
    expect(code).not.toMatch(/navigator\.clipboard/);
    expect(code).not.toMatch(/from '[^']*\/send'/);
    expect(code).not.toMatch(/sendAction/);
    expect(code).not.toMatch(
      /setChatMessages|createChatMessages|triggerSlash|updateWorldbookWith|createWorldbook|replaceWorldbook|deleteWorldbook|rebindGlobalWorldbooks|rebindCharWorldbooks|insertOrAssignVariables|replaceVariables|deleteVariable|applyBookToggles|archiveCodexEntries|resolveOrphan|fileAllPending|setAutoFile|runParseFor|submitFix|undoFloor|clearQuarantine/,
    );
  });
});

describe('SFC 规范', () => {
  it('<script setup lang="ts">、<template>、<style scoped>', () => {
    expect(ALIAS_SFC).toMatch(/<script setup lang="ts">/);
    expect(ALIAS_SFC).toMatch(/<template>/);
    expect(ALIAS_SFC).toMatch(/<style scoped>/);
  });
});
