/**
 * patchFailFingerprint.test.ts —— CTRL-PATCH-UX-01 ②：失败指纹与 PanelDataPatches 源码契约
 *
 * 1. 指纹按内容计算：id / timestamp / status 变化不改变指纹；target / operation / patch / reason 任一变化则改变；
 * 2. 同一内容的补丁换了 id 以后仍不会被自动重试；
 * 3. 手动「应用」路径不查指纹（仍可重试），成功后清除指纹；
 * 4. 存储按聊天分桶、有上限、损坏数据容错；
 * 5. PanelDataPatches 源码没有阻塞式 alert 调用。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';
import type { DataPatch } from '../../红警指挥系统/core/schema';
import {
  clearFailure,
  FAIL_FP_KEY,
  findFailRecord,
  FP_BUCKET_CAP,
  patchFingerprint,
  recordFailure,
  shouldAutoRetry,
  stableStringify,
} from '../models/patchFailFingerprint';

const PANEL_SFC = readFileSync(join(__dirname, '..', 'panels/PanelDataPatches.vue'), 'utf8');

function memStorage() {
  const m: Record<string, string> = {};
  return {
    m,
    getItem: (k: string) => m[k] ?? null,
    setItem: (k: string, v: string) => {
      m[k] = v;
    },
    removeItem: (k: string) => {
      delete m[k];
    },
  };
}

// 会话三真机观测：同一楼重解析后 id / timestamp 变化，内容完全相同
const bailingA: DataPatch = {
  id: 'patch_1790161718230_tdykl',
  target: '白凌',
  operation: 'patch',
  patch: { 现场修复距离: 15, 技能: { 维修: 2, 侦测: 1 } },
  reason: '战地改装',
  timestamp: 1790161718230,
  status: 'pending',
};
const bailingB: DataPatch = {
  ...bailingA,
  id: 'patch_1790177223412_xql62',
  timestamp: 1790177223412,
  patch: { 技能: { 侦测: 1, 维修: 2 }, 现场修复距离: 15 }, // 键序不同，内容相同
};

describe('PATCH-UX-01 · patchFingerprint 按内容计算', () => {
  it('id / timestamp / 键序不同但内容相同 → 指纹相同', () => {
    expect(patchFingerprint(bailingB)).toBe(patchFingerprint(bailingA));
  });

  it('target / operation / patch / reason 任一变化 → 指纹不同', () => {
    const base = patchFingerprint(bailingA);
    expect(patchFingerprint({ ...bailingA, target: '黑凌' })).not.toBe(base);
    expect(patchFingerprint({ ...bailingA, operation: 'replace' })).not.toBe(base);
    expect(patchFingerprint({ ...bailingA, patch: { 现场修复距离: 16 } })).not.toBe(base);
    expect(patchFingerprint({ ...bailingA, reason: '另一理由' })).not.toBe(base);
  });

  it('stableStringify：对象键排序，数组保持顺序', () => {
    expect(stableStringify({ b: 1, a: [2, 1] })).toBe('{"a":[2,1],"b":1}');
    expect(stableStringify([{ y: 1, x: 2 }])).toBe('[{"x":2,"y":1}]');
  });
});

describe('PATCH-UX-01 · 自动重试判定', () => {
  it('隔离后记指纹：同一内容换了 id 仍不自动重试', () => {
    const s = memStorage();
    expect(shouldAutoRetry('chat-B', bailingA, s)).toBe(true);
    recordFailure('chat-B', patchFingerprint(bailingA), '[命中但无数据块] …', s);
    expect(shouldAutoRetry('chat-B', bailingA, s)).toBe(false);
    expect(shouldAutoRetry('chat-B', bailingB, s)).toBe(false);
    expect(findFailRecord('chat-B', patchFingerprint(bailingB), s)?.msg).toContain('命中但无数据块');
  });

  it('内容变化后的新补丁会自动尝试', () => {
    const s = memStorage();
    recordFailure('chat-B', patchFingerprint(bailingA), 'x', s);
    expect(shouldAutoRetry('chat-B', { ...bailingB, patch: { 现场修复距离: 20 } }, s)).toBe(true);
  });

  it('deferred 补丁一律不自动应用（保持原行为）', () => {
    expect(shouldAutoRetry('c', { ...bailingA, status: 'deferred' }, memStorage())).toBe(false);
  });

  it('按聊天分桶：其他聊天不受影响', () => {
    const s = memStorage();
    recordFailure('chat-B', patchFingerprint(bailingA), 'x', s);
    expect(shouldAutoRetry('chat-C', bailingA, s)).toBe(true);
  });

  it('手动成功后 clearFailure → 恢复自动资格', () => {
    const s = memStorage();
    const fp = patchFingerprint(bailingA);
    recordFailure('chat-B', fp, 'x', s);
    clearFailure('chat-B', fp, s);
    expect(shouldAutoRetry('chat-B', bailingB, s)).toBe(true);
    expect(JSON.parse(s.m[FAIL_FP_KEY])).toEqual({});
  });

  it('每桶上限 FP_BUCKET_CAP，超出淘汰最旧', () => {
    const s = memStorage();
    for (let i = 0; i < FP_BUCKET_CAP + 5; i++) recordFailure('c', `fp${i}`, 'x', s, i);
    expect(findFailRecord('c', 'fp0', s)).toBeNull();
    expect(findFailRecord('c', `fp${FP_BUCKET_CAP + 4}`, s)).not.toBeNull();
    expect(JSON.parse(s.m[FAIL_FP_KEY]).c).toHaveLength(FP_BUCKET_CAP);
  });

  it('存储损坏或不可用时容错（视为无记录，不抛错）', () => {
    const s = memStorage();
    s.m[FAIL_FP_KEY] = '{bad json';
    expect(shouldAutoRetry('c', bailingA, s)).toBe(true);
    expect(() => recordFailure('c', 'fp', 'x', null)).not.toThrow();
    expect(shouldAutoRetry('c', bailingA, null)).toBe(true);
  });
});

describe('PATCH-UX-01 · PanelDataPatches 源码契约', () => {
  const script = PANEL_SFC.slice(PANEL_SFC.indexOf('<script setup'), PANEL_SFC.indexOf('</script>'));
  const fnBody = (name: string) => {
    const start = script.indexOf(`function ${name}(`);
    const next = script.indexOf('\nfunction ', start + 1);
    const nextAsync = script.indexOf('\nasync function ', start + 1);
    const ends = [next, nextAsync].filter(i => i > 0);
    return script.slice(start, ends.length ? Math.min(...ends) : undefined);
  };

  it('源码里没有 alert(', () => {
    expect(PANEL_SFC).not.toMatch(/\balert\s*\(/);
  });

  it('提示改用 toastr（非阻塞）', () => {
    expect(script).toMatch(/toastr/);
  });

  it('Auto-Apply 批处理经 shouldAutoRetry 过滤，并以 auto 模式调用', () => {
    const body = fnBody('processAutoApply');
    expect(body).toMatch(/shouldAutoRetry\(chatId, patch\)/);
    expect(body).toMatch(/applyPatch\(patch, 'auto'\)/);
  });

  it('手动「立即生效」按钮走 manual 模式，applyPatch 本身不查指纹（手动可重试）', () => {
    expect(PANEL_SFC).toMatch(/@click="applyPatch\(patch, 'manual'\)"/);
    const body = fnBody('applyPatch');
    expect(body).not.toMatch(/shouldAutoRetry|findFailRecord/);
    expect(body).toMatch(/clearFailure\(chatId, fp\)/);
    expect(body).toMatch(/recordFailure\(chatId, fp, msg\)/);
  });

  it('失败指纹不写 status（不改 schema 语义）：applyPatch 不赋值 patch.status', () => {
    expect(fnBody('applyPatch')).not.toMatch(/\.status\s*=/);
  });
});
