/**
 * PanelExportSave.test.ts —— 导出存档区迁入中控台设置弹窗（CTRL-SETTINGS-MIGRATE-03 第三枪迁移 · 方案 A 最小）
 *
 * 范式与同目录 PanelWorldbookToggle.test.ts 一致：vitest 为 node 环境且无 SFC 编译插件，
 * 故以「源码文本静态契约」+「底层纯函数行为」双轨验证：
 * 1. ModalSettings.vue 左栏 groups 追加「存档」组（key: 'save'），并有 #panel-save slot 挂载 PanelExportSave；
 *    「环境 / 世界书 / 内容体检」三组保持原样；
 * 2. PanelExportSave.vue 的导出包字段契约（version / kind:'redalert-save' / source / stat_data）与
 *    开场启动器/importSave.ts 的 parseSavePack 对齐——用一个按此契约组装的合法 pack 文本反向喂 parseSavePack
 *    验证 ok===true，证明契约对齐（不改 importSave）；
 * 3. 非酒馆降级（!env.inTavern → 按钮 disabled、「仅酒馆内可导出」文案）与剪贴板失败降级（catch→expJson→textarea）
 *    路径在源码里存在；
 * 4. 不引入导出以外的越权写 API（setChatMessages / replaceWorldbook / rebindGlobalWorldbooks 等）；
 * 5. SFC 规范（<script setup lang="ts"> 等）。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本，不进 bundle */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';
import { parseSavePack } from '../../开场启动器/importSave';
import { migrateV1toV2, Schema } from '../../红警指挥系统/core/schema';

const DIR = join(__dirname, '..');
const MODAL_SETTINGS_SFC = readFileSync(join(DIR, 'modals/ModalSettings.vue'), 'utf8');
const EXPSAVE_SFC = readFileSync(join(DIR, 'panels/PanelExportSave.vue'), 'utf8');

/** 去掉块注释与行注释后的源码（注释里对写 API 的说明性提及不算命中） */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('ModalSettings 左栏追加「存档」组（CTRL-SETTINGS-MIGRATE-03）', () => {
  it('groups 四组：环境 / 世界书 / 存档 / 内容体检，且存档组 key 为 save', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'env',\s*label:\s*'(?:环境|终端与外观)'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'(?:books|toggle)',\s*label:\s*'世界书(?:与模组|开关)?'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'save',\s*label:\s*'存档(?:导出)?'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'integrity',\s*label:\s*'内容体检'/);
  });

  it('存档组通过 #panel-save slot 挂载 PanelExportSave', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/import PanelExportSave from '(?:\.\.|\.)(?:\/panels)?\/PanelExportSave\.vue'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-save[\s\S]*?<PanelExportSave\s*\/>/);
  });

  it('环境 / 世界书 / 内容体检三组保持原样可用（不被本任务破坏）', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-env\b/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-books[\s\S]*?<PanelWorldbookToggle\s*\/>/);
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

describe('PanelExportSave 导出逻辑复用底层探针（不重写导出逻辑）', () => {
  it('复用 systemCheck.tav（宿主 API 探针）与 store.in_tavern + checkEnv', () => {
    expect(EXPSAVE_SFC).toMatch(/import\s*\{\s*checkEnv,\s*tav\s*\}\s*from '(?:\.\.\/)?\.\.\/红警指挥系统\/parse\/systemCheck'/);
    expect(EXPSAVE_SFC).toMatch(/import\s*\{\s*in_tavern\s*\}\s*from '(?:\.\.\/)?\.\.\/红警指挥系统\/composables\/store'/);
    expect(EXPSAVE_SFC).toMatch(/checkEnv\(in_tavern\)/);
  });

  it('doExportSave 逐字同源：getCurrentMessageId → getVariables({type:message}) 取 stat_data', () => {
    expect(EXPSAVE_SFC).toMatch(/tav<[\s\S]*?>\('getVariables'\)/);
    expect(EXPSAVE_SFC).toMatch(/tav<[\s\S]*?>\('getCurrentMessageId'\)/);
    expect(EXPSAVE_SFC).toMatch(/type:\s*'message',\s*message_id:\s*mid/);
    expect(EXPSAVE_SFC).toMatch(/\['stat_data'\]/);
    expect(EXPSAVE_SFC).toMatch(/navigator\.clipboard\.writeText/);
  });

  it('导出包字段与顺序（version→kind→exportedAt→source→stat_data）逐字照楼层', () => {
    expect(EXPSAVE_SFC).toMatch(
      /version:\s*1,\s*kind:\s*'redalert-save',\s*exportedAt:[\s\S]*?source:\s*\{\s*chat:[^}]*message_id:\s*mid\s*\},\s*stat_data:\s*statData,/,
    );
  });

  it('复用 sysbtn / card / systa 等既有样式类与阵营 CSS 变量', () => {
    expect(EXPSAVE_SFC).toMatch(/class="ra-expsave card/);
    expect(EXPSAVE_SFC).toMatch(/class="sysbtn/);
    expect(EXPSAVE_SFC).toMatch(/class="systa/);
    expect(EXPSAVE_SFC).toMatch(/var\(--warn\)|var\(--danger\)|var\(--ok\)/);
  });

  it('非酒馆降级：按钮以 env.inTavern 门控 disabled，「仅酒馆内可导出」文案存在', () => {
    expect(EXPSAVE_SFC).toMatch(/:disabled="!env\.inTavern \|\| expBusy"/);
    expect(EXPSAVE_SFC).toMatch(/仅酒馆内可导出/);
    // 引导文案存在
    expect(EXPSAVE_SFC).toMatch(/导入存档→粘贴即可继承进度/);
  });

  it('剪贴板失败降级：catch → expJson → readonly textarea（focus 全选）', () => {
    expect(EXPSAVE_SFC).toMatch(/expJson\.value = json/);
    expect(EXPSAVE_SFC).toMatch(/<textarea[\s\S]*readonly[\s\S]*:value="expJson"[\s\S]*@focus="selectAllText"/);
    expect(EXPSAVE_SFC).toMatch(/\(e\.target as HTMLTextAreaElement\)\.select\(\)/);
    // 本楼无变量数据降级提示
    expect(EXPSAVE_SFC).toMatch(/本楼无变量数据/);
  });

  it('不引入导出以外的越权写 API', () => {
    const code = stripComments(EXPSAVE_SFC);
    expect(code).not.toMatch(/from '[^']*\/send'/);
    expect(code).not.toMatch(/sendAction/);
    expect(code).not.toMatch(
      /setChatMessages|createChatMessages|triggerSlash|updateWorldbookWith|createWorldbook|replaceWorldbook|deleteWorldbook|rebindGlobalWorldbooks|rebindCharWorldbooks|insertOrAssignVariables|replaceVariables|updateVariablesWith|deleteVariable|applyBookToggles/,
    );
  });

  it('SFC 规范：<script setup lang="ts">、<template>、<style scoped>', () => {
    expect(EXPSAVE_SFC).toMatch(/<script setup lang="ts">/);
    expect(EXPSAVE_SFC).toMatch(/<template>/);
    expect(EXPSAVE_SFC).toMatch(/<style scoped>/);
  });
});

describe('导出包契约与 importSave.parseSavePack 反向对齐（证明契约对齐，不改 importSave）', () => {
  /** 按 PanelExportSave.doExportSave 相同字段/顺序组装一个合法 pack（stat_data 用 Schema 归一；world_id 取已注册世界以过 parseSavePack 的 world 校验） */
  function buildPack() {
    const statData = Schema.parse(migrateV1toV2({ meta: { world_id: 'xiuzhen' } }));
    return {
      version: 1,
      kind: 'redalert-save',
      exportedAt: new Date().toISOString(),
      source: { chat: '测试聊天', message_id: 7 },
      stat_data: statData,
    };
  }

  it('按导出契约组装的合法 pack 文本可被 parseSavePack 接受（ok===true）', () => {
    const json = JSON.stringify(buildPack());
    const res = parseSavePack(json);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.pack.kind).toBe('redalert-save');
      expect(res.pack.version).toBe(1);
      expect(res.pack.source.message_id).toBe(7);
    }
  });

  it('缺 kind:redalert-save 时 parseSavePack 拒收（反证字段契约是判据）', () => {
    const bad = { ...buildPack(), kind: 'not-redalert' };
    const res = parseSavePack(JSON.stringify(bad));
    expect(res.ok).toBe(false);
  });

  it('FD-37 · BUG-SAVE-02：PanelExportSave 导出世界书词条时完整克隆 comment / position / strategy / recursion / extra 且被 parseSavePack 无损保留', () => {
    expect(EXPSAVE_SFC).toMatch(/e\.comment/);
    expect(EXPSAVE_SFC).toMatch(/e\.position/);
    expect(EXPSAVE_SFC).toMatch(/e\.strategy/);
    expect(EXPSAVE_SFC).toMatch(/e\.recursion/);
    expect(EXPSAVE_SFC).toMatch(/e\.extra/);

    const fullEntry = {
      name: '档案·白凌',
      comment: '白凌核心档案',
      content: '白凌 Lv.2 完整设定',
      enabled: true,
      keys: ['白凌', '纳米核心'],
      position: { type: 'after_character_definition', order: 210, depth: 4 },
      strategy: { type: 'selective', keys: ['白凌'], scanDepth: 2 },
      recursion: { prevent_incoming: false, prevent_outgoing: true, delay_until: null },
      extra: { from: 1, to: 10 },
    };
    const v2Pack = {
      ...buildPack(),
      version: 2,
      chat_worldbook_entries: [fullEntry],
    };
    const res = parseSavePack(JSON.stringify(v2Pack));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.pack.chat_worldbook_entries).toEqual([fullEntry]);
    }
  });
});
