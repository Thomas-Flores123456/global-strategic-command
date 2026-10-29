/**
 * floorVarWrite.test.ts —— 中控变量写入唯一定义点单元测试（D-RAC-FLOAT-READONLY-01 修订）
 *
 * 验收要求：
 * 1. updateFloorVars 正确调用酒馆 updateVariablesWith；
 * 2. API 缺失时抛出明确异常；
 * 3. 唯一定义点契约：中控目录下仅本文件包含 updateVariablesWith 可执行调用。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it, vi } from 'vitest';
import { updateFloorVars } from '../host/floorVarWrite';

const FLOATING_DIR = join(__dirname, '..');

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__') continue;
      out.push(...listSources(full));
    } else if (/\.(ts|vue)$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('floorVarWrite 唯一定义点契约', () => {
  it('updateFloorVars 在 API 可用时正确向指定楼层写入', async () => {
    const g = globalThis as Record<string, unknown>;
    const origUvw = g.updateVariablesWith;
    const uvwMock = vi.fn(async (updater, opts) => {
      updater({ stat_data: { foo: 'bar' } });
    });
    try {
      g.updateVariablesWith = uvwMock;
      const updater = vi.fn(vars => ({ ...vars, touched: true }));
      await updateFloorVars(12, updater);
      expect(uvwMock).toHaveBeenCalledWith(updater, { type: 'message', message_id: 12 });
      expect(updater).toHaveBeenCalled();
    } finally {
      g.updateVariablesWith = origUvw;
    }
  });

  it('updateVariablesWith 不可用时抛出错误', async () => {
    const g = globalThis as Record<string, unknown>;
    const origUvw = g.updateVariablesWith;
    delete g.updateVariablesWith;
    try {
      await expect(updateFloorVars(1, v => v)).rejects.toThrow('updateVariablesWith 不可用');
    } finally {
      g.updateVariablesWith = origUvw;
    }
  });

  it('源码契约：floorVarWrite.ts 是 src/中控悬浮窗/ 内唯一包含 updateVariablesWith 的源文件', () => {
    const files = listSources(FLOATING_DIR);
    expect(files.length).toBeGreaterThan(0);
    const matches: string[] = [];
    for (const f of files) {
      const code = stripComments(readFileSync(f, 'utf8'));
      if (code.includes('updateVariablesWith')) {
        matches.push(f);
      }
    }
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatch(/[\\/]floorVarWrite\.ts$/);
  });
});
