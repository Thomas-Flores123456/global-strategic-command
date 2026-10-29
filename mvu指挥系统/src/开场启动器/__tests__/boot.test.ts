import { describe, expect, it } from 'vitest';
import { confirmBoot, emptyBoot, readBootFrom } from '../boot';

describe('readBootFrom · $boot 归一化防御', () => {
  it('缺失 $boot → 未开局空壳', () => {
    expect(readBootFrom({})).toEqual({ confirmed: false });
    expect(readBootFrom(undefined)).toEqual({ confirmed: false });
    expect(readBootFrom(null)).toEqual({ confirmed: false });
  });

  it('损坏形态（数组/字符串/数字）→ 未开局空壳，不锁死玩家', () => {
    expect(readBootFrom({ $boot: [] })).toEqual({ confirmed: false });
    expect(readBootFrom({ $boot: 'yes' })).toEqual({ confirmed: false });
    expect(readBootFrom({ $boot: 42 })).toEqual({ confirmed: false });
  });

  it('confirmed 非严格 true 一律按 false（"true"/1 不算确认）', () => {
    expect(readBootFrom({ $boot: { confirmed: 'true' } }).confirmed).toBe(false);
    expect(readBootFrom({ $boot: { confirmed: 1 } }).confirmed).toBe(false);
    expect(readBootFrom({ $boot: { confirmed: true } }).confirmed).toBe(true);
  });

  it('合法字段透传，非法字段剥除', () => {
    const out = readBootFrom({
      $boot: {
        confirmed: true,
        preset: 'normal',
        choices: { credits: 2000 },
        personaId: 'p1',
        confirmedAt: '2026-09-01T00:00:00Z',
        preset2: '不认识的键',
        choices_bad: [1, 2],
      },
    });
    expect(out).toEqual({
      confirmed: true,
      preset: 'normal',
      choices: { credits: 2000 },
      personaId: 'p1',
      confirmedAt: '2026-09-01T00:00:00Z',
    });
  });

  it('choices 为数组时剥除（防稀疏数组类事故）', () => {
    const out = readBootFrom({ $boot: { confirmed: true, choices: [1] } });
    expect(out.choices).toBeUndefined();
  });
});

describe('confirmBoot · 确认态生成', () => {
  it('置 confirmed=true 并带时间戳，patch 合并', () => {
    const next = confirmBoot(emptyBoot(), { preset: 'hard' });
    expect(next.confirmed).toBe(true);
    expect(next.preset).toBe('hard');
    expect(typeof next.confirmedAt).toBe('string');
    expect(new Date(next.confirmedAt!).toString()).not.toBe('Invalid Date');
  });

  it('patch 无法压掉 confirmed=true（confirmed 在展开之后强制）', () => {
    const next = confirmBoot(emptyBoot(), { confirmed: false } as never);
    expect(next.confirmed).toBe(true);
  });

  it('不可变：不修改入参', () => {
    const prev = emptyBoot();
    confirmBoot(prev);
    expect(prev).toEqual({ confirmed: false });
  });
});
