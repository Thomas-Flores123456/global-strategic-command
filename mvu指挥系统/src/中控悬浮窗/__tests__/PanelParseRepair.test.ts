/**
 * PanelParseRepair.test.ts —— 解析与修复子页迁入中控台设置弹窗（CTRL-SETTINGS-MIGRATE-06 第六枪 · 子页①）
 *
 * 范式与同目录 PanelArchive.test.ts / PanelGirlFiling.test.ts 一致：vitest 为 node 环境且无 SFC
 * 编译插件，故以「源码文本静态契约」+「底层导出存在性」双轨验证：
 * ① ModalSettings.vue 左栏 groups 追加「解析」组（key: 'parse'）并声明 pages 两子页（repair/alias），
 *    有 #panel-parse-repair / #panel-parse-alias 两 slot 分别挂 PanelParseRepair / PanelAliasDict；
 *    「环境 / 世界书 / 存档 / 归档 / 机娘 / 内容体检」六组保持原样（共七组）；
 * ② PanelParseRepair.vue 复用 useParse 同源 API（parseState / runParseFor / retryFloor / submitFix /
 *    undoFloor / clearQuarantine / checkParseQuarantine / addAlias / buildAuthority / loadQuarantine）、
 *    systemCheck（tav / checkEnv）、store（in_tavern）、parsePipeline（QuarantineItem）；
 * ③ 负向断言（关键红线）：源码（剥注释后）不含 initParseRunner、不含 parseRunner、不含 eventOn(、不含 ran.value；
 * ④ 非酒馆降级：env.inTavern=false 时重解析/重试/提交/撤销按钮禁用，空态文案存在；
 * ⑤ 不引入解析/别名以外的越权写 API；
 * ⑥ SFC 规范。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本，不进 bundle */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';
import type { QuarantineItem } from '../../红警指挥系统/parse/parsePipeline';
import { checkEnv } from '../../红警指挥系统/parse/systemCheck';
import {
  addAlias,
  buildAuthority,
  checkParseQuarantine,
  clearQuarantine,
  loadQuarantine,
  parseState,
  retryFloor,
  runParseFor,
  submitFix,
  undoFloor,
} from '../../红警指挥系统/composables/useParse';

const DIR = join(__dirname, '..');
const MODAL_SETTINGS_SFC = readFileSync(join(DIR, 'modals/ModalSettings.vue'), 'utf8');
const PARSE_SFC = readFileSync(join(DIR, 'panels/PanelParseRepair.vue'), 'utf8');

/**
 * 去掉 HTML 注释、块注释与行注释后的源码。
 * 本组件在模板顶部与脚本内以注释形式说明「不搬 initParseRunner/parseRunner/eventOn/ran.value」的取舍，
 * 这些说明性提及属文档、非可执行代码，剥离后再断言真实代码里不含该触发器/联动。
 */
function stripComments(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('ModalSettings 左栏追加「解析」组并首次启用子页（CTRL-SETTINGS-MIGRATE-06）', () => {
  it('groups 第七组「解析」key 为 parse，且声明 pages 两子页 repair/alias', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'parse',\s*\n?\s*label:\s*'解析'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'repair',\s*label:\s*'解析与修复'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'alias',\s*label:\s*'别名词典'/);
    // pages 数组形态存在
    expect(MODAL_SETTINGS_SFC).toMatch(/pages:\s*\[/);
  });

  it('两子页 slot 命名遵循 panel-<组>-<子页>：#panel-parse-repair / #panel-parse-alias 挂对应组件', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/import PanelParseRepair from '(?:\.\.|\.)(?:\/panels)?\/PanelParseRepair\.vue'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/import PanelAliasDict from '(?:\.\.|\.)(?:\/panels)?\/PanelAliasDict\.vue'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-parse-repair[\s\S]*?<PanelParseRepair\s*\/>/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-parse-alias[\s\S]*?<PanelAliasDict\s*\/>/);
  });

  it('环境 / 世界书 / 存档 / 归档 / 机娘 / 内容体检六组保持原样可用（不被本任务破坏）', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'env',\s*label:\s*'环境'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'books',\s*label:\s*'世界书'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'save',\s*label:\s*'存档'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'archive',\s*label:\s*'归档'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'girls',\s*label:\s*'机娘'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'integrity',\s*label:\s*'内容体检'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-env\b/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-books[\s\S]*?<PanelWorldbookToggle\s*\/>/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-save[\s\S]*?<PanelExportSave\s*\/>/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-archive[\s\S]*?<PanelArchive\s*\/>/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-girls[\s\S]*?<PanelGirlFiling\s*\/>/);
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

describe('PanelParseRepair 复用底层解析导出（不重写逻辑，不改签名）', () => {
  it('复用 useParse 同源 API（import 存在且运行时可用）', () => {
    expect(PARSE_SFC).toMatch(
      /import\s*\{[\s\S]*?addAlias,[\s\S]*?buildAuthority,[\s\S]*?checkParseQuarantine,[\s\S]*?clearQuarantine,[\s\S]*?loadQuarantine,[\s\S]*?parseState,[\s\S]*?retryFloor,[\s\S]*?runParseFor,[\s\S]*?submitFix,[\s\S]*?undoFloor,[\s\S]*?\}\s*from '(?:\.\.\/)?\.\.\/红警指挥系统\/composables\/useParse'/,
    );
    expect(typeof runParseFor).toBe('function');
    expect(typeof retryFloor).toBe('function');
    expect(typeof submitFix).toBe('function');
    expect(typeof undoFloor).toBe('function');
    expect(typeof clearQuarantine).toBe('function');
    expect(typeof checkParseQuarantine).toBe('function');
    expect(typeof addAlias).toBe('function');
    expect(typeof buildAuthority).toBe('function');
    expect(typeof loadQuarantine).toBe('function');
    // parseState 是共享的模块级 reactive 单例，暴露 reports / quarantine / busy
    expect(typeof parseState).toBe('object');
    expect(Array.isArray(parseState.reports)).toBe(true);
    expect(parseState).toHaveProperty('quarantine');
    expect(parseState).toHaveProperty('busy');
  });

  it('复用 systemCheck.tav / checkEnv、store.in_tavern、parsePipeline.QuarantineItem', () => {
    expect(PARSE_SFC).toMatch(
      /import\s*\{\s*checkEnv,\s*tav,\s*type CheckIssue\s*\}\s*from '(?:\.\.\/)?\.\.\/红警指挥系统\/parse\/systemCheck'/,
    );
    expect(PARSE_SFC).toMatch(/import\s*\{\s*in_tavern\s*\}\s*from '(?:\.\.\/)?\.\.\/红警指挥系统\/composables\/store'/);
    expect(PARSE_SFC).toMatch(/import type \{ QuarantineItem \} from '(?:\.\.\/)?\.\.\/红警指挥系统\/parse\/parsePipeline'/);
    expect(PARSE_SFC).toMatch(/checkEnv\(in_tavern\)/);
    expect(typeof checkEnv).toBe('function');
  });

  it('解析调用逐字同源：runParseFor(...,{force:true}) / retryFloor / submitFix / undoFloor / clearQuarantine', () => {
    // 中控是全局脚本 iframe，禁用 getCurrentMessageId（Helper 抛错）；目标楼 = 最新可见 AI 楼
    expect(PARSE_SFC).toMatch(/runParseFor\(mid,\s*\{\s*force:\s*true\s*\}\)/);
    expect(PARSE_SFC).toMatch(/tav<[^\n]*>\('getLastMessageId'\)/);
    expect(PARSE_SFC.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')).not.toMatch(/getCurrentMessageId/);
    expect(PARSE_SFC).toMatch(/await retryFloor\(mid\)/);
    expect(PARSE_SFC).toMatch(/await submitFix\(mid, q, fixText\.value\)/);
    expect(PARSE_SFC).toMatch(/await undoFloor\(r\)/);
    expect(PARSE_SFC).toMatch(/await clearQuarantine\(mid\)/);
    // 报告流水读 parseState.reports；R20 对账读 checkParseQuarantine
    expect(PARSE_SFC).toMatch(/parse\.reports/);
    expect(PARSE_SFC).toMatch(/await checkParseQuarantine\(\)/);
    // onMounted 同楼层态：loadQuarantine().then(refreshParseR20)
    expect(PARSE_SFC).toMatch(/loadQuarantine\(\)\.then\(refreshParseR20\)/);
    // 记为别名走 addAlias（两子页联动）
    expect(PARSE_SFC).toMatch(/await addAlias\(a\.from,\s*a\.to\)/);
  });
});

describe('关键红线：不搬也不重装楼层自动解析触发器 / 不搬体检态联动', () => {
  it('组件源码（剥注释后）不含 initParseRunner / parseRunner', () => {
    const code = stripComments(PARSE_SFC);
    expect(code).not.toMatch(/initParseRunner/);
    expect(code).not.toMatch(/parseRunner/);
  });

  it('组件源码（剥注释后）不自建任何 eventOn( 酒馆事件监听', () => {
    const code = stripComments(PARSE_SFC);
    expect(code).not.toMatch(/eventOn\(/);
  });

  it('组件源码（剥注释后）不含 ran.value（体检态跨区联动，本任务刻意不搬）', () => {
    const code = stripComments(PARSE_SFC);
    expect(code).not.toMatch(/ran\.value/);
  });
});

describe('非酒馆环境安全降级', () => {
  it('env.inTavern=false 时重解析/重试/提交/撤销/清理按钮以 env.inTavern 门控 disabled', () => {
    expect(PARSE_SFC).toMatch(/:disabled="!env\.inTavern \|\| parse\.busy"/);
    // 重解析本楼按钮忙态文案
    expect(PARSE_SFC).toMatch(/parse\.busy \? '解析中…' : '重解析本楼'/);
    // 非酒馆降级文案存在
    expect(PARSE_SFC).toMatch(/独立预览仅展示布局/);
  });

  it('空态文案存在：无解析记录 / 隔离区未决', () => {
    expect(PARSE_SFC).toMatch(/本会话尚无解析记录/);
    expect(PARSE_SFC).toMatch(/隔离区 · /);
  });

  it('复用 sysbtn / card / sysbtn--go / sysbtn--danger / systa 等既有样式类与阵营 CSS 变量', () => {
    expect(PARSE_SFC).toMatch(/class="ra-parse card/);
    expect(PARSE_SFC).toMatch(/class="sysbtn sysbtn--go"/);
    expect(PARSE_SFC).toMatch(/sysbtn--danger/);
    expect(PARSE_SFC).toMatch(/class="systa/);
    expect(PARSE_SFC).toMatch(/var\(--ok\)|var\(--warn\)|var\(--danger\)|var\(--line\)|var\(--t-faint\)/);
  });
});

describe('不引入解析/别名以外的越权写 API', () => {
  it('无 navigator.clipboard / setChatMessages / replaceWorldbook / 世界书总开关 / 归档写入等', () => {
    const code = stripComments(PARSE_SFC);
    expect(code).not.toMatch(/navigator\.clipboard/);
    expect(code).not.toMatch(/from '[^']*\/send'/);
    expect(code).not.toMatch(/sendAction/);
    expect(code).not.toMatch(
      /setChatMessages|createChatMessages|triggerSlash|updateWorldbookWith|createWorldbook|replaceWorldbook|deleteWorldbook|rebindGlobalWorldbooks|rebindCharWorldbooks|insertOrAssignVariables|replaceVariables|updateVariablesWith|deleteVariable|applyBookToggles|archiveCodexEntries|resolveOrphan|fileAllPending|setAutoFile/,
    );
  });
});

describe('SFC 规范', () => {
  it('<script setup lang="ts">、<template>、<style scoped>', () => {
    expect(PARSE_SFC).toMatch(/<script setup lang="ts">/);
    expect(PARSE_SFC).toMatch(/<template>/);
    expect(PARSE_SFC).toMatch(/<style scoped>/);
  });
});

/** 让 QuarantineItem 类型 import 参与类型检查（结构对齐 parsePipeline 导出） */
void (null as unknown as QuarantineItem);
