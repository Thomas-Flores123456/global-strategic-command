/**
 * floorContract.test.ts —— 楼层终端瘦身契约测试（CTRL-FLOOR-SLIM-01）
 *
 * 验收要求：
 * 1. 楼层入口 index.ts 不含 initParseRunner、不含 runParseFor、不含 eventOn；
 * 2. 楼层 App.vue 不含 installAutoFiler、不含 eventOn；
 * 3. 楼层所有 Vue SFC 源码（剥除注释后）零 eventOn 调用；
 * 4. 楼层 UI 回归纯行动选项与状态展示，不再负责驱动解析与入档观察者。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';

const FLOOR_DIR = join(__dirname, '..');
const INDEX_SRC = readFileSync(join(FLOOR_DIR, 'index.ts'), 'utf8');
const APP_SRC = readFileSync(join(FLOOR_DIR, 'ui', 'App.vue'), 'utf8');

function stripComments(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function listVueFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__') continue;
      out.push(...listVueFiles(full));
    } else if (name.endsWith('.vue')) {
      out.push(full);
    }
  }
  return out;
}

describe('楼层终端瘦身契约（CTRL-FLOOR-SLIM-01）', () => {
  it('楼层入口 index.ts（剥注释后）不含 initParseRunner、runParseFor、eventOn', () => {
    const code = stripComments(INDEX_SRC);
    expect(code).not.toMatch(/initParseRunner/);
    expect(code).not.toMatch(/runParseFor/);
    expect(code).not.toMatch(/eventOn/);
  });

  it('楼层 App.vue（剥注释后）不含 installAutoFiler、eventOn', () => {
    const code = stripComments(APP_SRC);
    expect(code).not.toMatch(/installAutoFiler/);
    expect(code).not.toMatch(/eventOn/);
  });

  it('楼层目录内所有 Vue 组件源码（剥注释后）零 eventOn 调用', () => {
    const vueFiles = listVueFiles(FLOOR_DIR);
    expect(vueFiles.length).toBeGreaterThan(0);
    for (const file of vueFiles) {
      const code = stripComments(readFileSync(file, 'utf8'));
      expect(code, file).not.toMatch(/\beventOn\s*\(/);
    }
  });

  it('楼层入口 index.ts 源码（剥注释后）零 eventOn 调用', () => {
    const code = stripComments(INDEX_SRC);
    expect(code).not.toMatch(/\beventOn\s*\(/);
  });
});
