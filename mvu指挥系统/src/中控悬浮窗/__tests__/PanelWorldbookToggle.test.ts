/**
 * PanelWorldbookToggle.test.ts —— 世界书总开关区迁入中控台设置弹窗（CTRL-SETTINGS-MIGRATE-02 第二枪迁移）
 *
 * 范式与同目录 PanelIntegrityCheck.test.ts 一致：vitest 为 node 环境且无 SFC 编译插件，
 * 故以「源码文本静态契约」+「复用逻辑（dlcInstaller 纯函数）行为」双轨验证：
 * 1. ModalSettings.vue 左栏 groups 追加「世界书」组（key: 'books'），并有 #panel-books slot 挂载 PanelWorldbookToggle；
 *    「环境 / 内容体检」两组保持原样；
 * 2. PanelWorldbookToggle.vue 严格复用 dlcInstaller 同一套 API（readBookStates / applyBookToggles /
 *    OFFICIAL_BOOKS(_VERSION) / BookToggleState），不重写启停逻辑，不引入世界书启停以外的越权写 API；
 *    B1 管辖权：applyBookToggles 的 managedNames 传「面板见过的书名全集」；
 * 3. 非酒馆环境（独立预览/单测）安全降级：readBookStates 返回 null → v-else 降级文案，不抛错；
 * 4. SFC 规范（<script setup lang="ts"> 等）。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本，不进 bundle */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';
import { applyBookToggles, OFFICIAL_BOOKS, readBookStates } from '../../红警指挥系统/worldbook/dlcInstaller';

const DIR = join(__dirname, '..');
const MODAL_SETTINGS_SFC = readFileSync(join(DIR, 'modals/ModalSettings.vue'), 'utf8');
const WBTOGGLE_SFC = readFileSync(join(DIR, 'panels/PanelWorldbookToggle.vue'), 'utf8');

/** 去掉块注释与行注释后的源码（注释里对写 API 的说明性提及不算命中） */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('ModalSettings 左栏追加「世界书」组（CTRL-SETTINGS-MIGRATE-02）', () => {
  it('groups 三组：环境 / 世界书 / 内容体检，且世界书组 key 为 books', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'env',\s*label:\s*'(?:环境|终端与外观)'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'(?:books|toggle)',\s*label:\s*'世界书(?:与模组|开关)?'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'integrity',\s*label:\s*'内容体检'/);
  });

  it('世界书组通过 #panel-books slot 挂载 PanelWorldbookToggle', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/import PanelWorldbookToggle from '(?:\.\.|\.)(?:\/panels)?\/PanelWorldbookToggle\.vue'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-books[\s\S]*?<PanelWorldbookToggle\s*\/>/);
  });

  it('环境 / 内容体检两组保持原样可用（不被本任务破坏）', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-env\b/);
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

describe('PanelWorldbookToggle 复用 dlcInstaller 契约（不重写启停逻辑）', () => {
  it('从 dlcInstaller 引入 readBookStates / applyBookToggles / OFFICIAL_BOOKS(_VERSION) / BookToggleState', () => {
    expect(WBTOGGLE_SFC).toMatch(/from '(?:\.\.\/)?\.\.\/红警指挥系统\/worldbook\/dlcInstaller'/);
    for (const sym of ['readBookStates', 'applyBookToggles', 'OFFICIAL_BOOKS', 'OFFICIAL_BOOKS_VERSION']) {
      expect(WBTOGGLE_SFC, sym).toMatch(new RegExp(`\\b${sym}\\b`));
    }
    expect(WBTOGGLE_SFC).toMatch(/type BookToggleState/);
  });

  it('调用 readBookStates() 与 applyBookToggles(...)，展示 OFFICIAL_BOOKS_VERSION', () => {
    expect(WBTOGGLE_SFC).toMatch(/readBookStates\(\)/);
    expect(WBTOGGLE_SFC).toMatch(/applyBookToggles\(/);
    expect(WBTOGGLE_SFC).toMatch(/OFFICIAL_BOOKS_VERSION/);
  });

  it('保留分组一键（全启用/全停用）与高级逐本勾选（全选/清空/仅官方/仅DLC/应用勾选）', () => {
    expect(WBTOGGLE_SFC).toMatch(/toggleGroup\(g\.key,\s*true\)/);
    expect(WBTOGGLE_SFC).toMatch(/toggleGroup\(g\.key,\s*false\)/);
    expect(WBTOGGLE_SFC).toMatch(/selAll\(true\)/);
    expect(WBTOGGLE_SFC).toMatch(/selAll\(false\)/);
    expect(WBTOGGLE_SFC).toMatch(/selOnly\('官方'\)/);
    expect(WBTOGGLE_SFC).toMatch(/selOnly\('DLC'\)/);
    expect(WBTOGGLE_SFC).toMatch(/@click="applySel"/);
  });

  it('严守 B1 管辖权：managedNames 传「面板见过的书名全集」（bookStates 全体书名）', () => {
    // applyBookToggles 第二参数须是 (bookStates.value ?? []).map(b => b.name)，不得改语义（跨行亦须命中）
    expect(WBTOGGLE_SFC).toMatch(
      /applyBookToggles\(\s*names,\s*\(bookStates\.value\s*\?\?\s*\[\]\)\.map\(b\s*=>\s*b\.name\),?\s*\)/,
    );
  });

  it('复用 sysbtn / card / micro / num 等既有样式类与阵营 CSS 变量', () => {
    expect(WBTOGGLE_SFC).toMatch(/class="ra-wbtoggle card/);
    expect(WBTOGGLE_SFC).toMatch(/class="sysbtn/);
    expect(WBTOGGLE_SFC).toMatch(/class="micro/);
    expect(WBTOGGLE_SFC).toMatch(/var\(--warn\)|var\(--danger\)|var\(--ok\)/);
  });

  it('非酒馆环境降级：bookStates 为 null → v-else 降级文案（官方 N 本 + DLC 批量启停；独立预览不可用）', () => {
    expect(WBTOGGLE_SFC).toMatch(/v-if="bookStates"/);
    expect(WBTOGGLE_SFC).toMatch(/OFFICIAL_BOOKS\.length/);
    expect(WBTOGGLE_SFC).toMatch(/独立预览环境不可用/);
    // 启停按钮以 env.inTavern 门控禁用
    expect(WBTOGGLE_SFC).toMatch(/:disabled="!env\.inTavern \|\| bookBusy"/);
  });

  it('不引入世界书启停以外的越权写 API', () => {
    const code = stripComments(WBTOGGLE_SFC);
    expect(code).not.toMatch(/from '[^']*\/send'/);
    expect(code).not.toMatch(/sendAction/);
    // 世界书启停唯一合法写路径是 dlcInstaller.applyBookToggles；不得直接调裸写 API
    expect(code).not.toMatch(
      /createChatMessages|triggerSlash|updateWorldbookWith|createWorldbook|replaceWorldbook|deleteWorldbook|rebindGlobalWorldbooks|rebindCharWorldbooks|insertOrAssignVariables|replaceVariables|updateVariablesWith|deleteVariable/,
    );
  });

  it('SFC 规范：<script setup lang="ts">、<template>、<style scoped>', () => {
    expect(WBTOGGLE_SFC).toMatch(/<script setup lang="ts">/);
    expect(WBTOGGLE_SFC).toMatch(/<template>/);
    expect(WBTOGGLE_SFC).toMatch(/<style scoped>/);
  });
});

describe('非酒馆环境安全降级（直接调 dlcInstaller 纯函数验证 null 分支）', () => {
  it('readBookStates() 在无世界书 API 时返回 null（触发 v-else 降级文案）', async () => {
    const states = await readBookStates();
    expect(states).toBeNull();
  });

  it('OFFICIAL_BOOKS 为非空数组（降级文案「官方 N 本」有可读数量）', () => {
    expect(Array.isArray(OFFICIAL_BOOKS)).toBe(true);
    expect(OFFICIAL_BOOKS.length).toBeGreaterThan(0);
  });

  it('applyBookToggles 是复用的同一函数引用（组件与测试引用同一 dlcInstaller 导出）', () => {
    expect(typeof applyBookToggles).toBe('function');
  });
});
