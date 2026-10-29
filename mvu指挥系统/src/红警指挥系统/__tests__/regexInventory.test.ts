import { describe, expect, it, vi } from 'vitest';
import { readRegexInventory, regexContentSignature, type VerifiedRegexPolicy } from '../parse/regexInventory';

function rule(overrides: Partial<TavernRegex> = {}): TavernRegex {
  return {
    id: 'fixture-cleaner', script_name: '任意名字', enabled: true,
    find_regex: '/<thinking>[\\s\\S]*?<\\/thinking>/gi', replace_string: '', trim_strings: [],
    source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false }, run_on_edit: true,
    min_depth: null, max_depth: null, ...overrides,
  };
}
function policy(r: TavernRegex): VerifiedRegexPolicy {
  return { scope: 'global', id: r.id, signature: regexContentSignature(r), purpose: 'verified-cleaner' };
}

describe('只读正则清单', () => {
  it('正式 type API 分别读取三域，保留域内顺序，不宣称跨域顺序', () => {
    const r = rule();
    const before = JSON.stringify(r);
    const read = vi.fn(() => [r, rule({ id: 'second' })]);
    const result = readRegexInventory(read);
    expect(read.mock.calls).toEqual([[{ type: 'global' }], [{ type: 'character', name: 'current' }], [{ type: 'preset', name: 'in_use' }]]);
    expect(result.entries.map(e => [e.scope, e.index])).toEqual([
      ['global', 0], ['global', 1], ['character', 0], ['character', 1], ['preset', 0], ['preset', 1],
    ]);
    expect(result.crossScopeOrder).toBe('unverified');
    expect(JSON.stringify(r)).toBe(before);
    expect(result.entries.every(e => !e.candidate)).toBe(true);
  });

  it('名称变化不改变验证身份，同ID表达式变更则失去批准', () => {
    const r = rule();
    const approved = [policy(r)];
    const renamed = rule({ script_name: '换名' });
    expect(readRegexInventory(() => [renamed], approved).entries[0].candidate).toBe(true);
    const changed = rule({ find_regex: '/[\\s\\S]*/g' });
    expect(readRegexInventory(() => [changed], approved).entries[0].classification).toBe('unknown');
  });

  it('空替换、系统式ID、清洗名称均不能自动获得信任', () => {
    const r = rule({ id: 'tavernweave.system.fake', script_name: '思考清理' });
    expect(readRegexInventory(() => [r]).entries.every(e => e.classification === 'unknown')).toBe(true);
  });

  it('禁用、非显示、未确认角色总开关及深度缺失均不可作为候选', () => {
    for (const r of [rule({ enabled: false }), rule({ destination: { display: false, prompt: true } }), rule({ min_depth: 1 })]) {
      expect(readRegexInventory(() => [r], [policy(r)]).entries[0].candidate).toBe(false);
    }
    const r = rule();
    const p = { ...policy(r), scope: 'character' as const };
    expect(readRegexInventory(() => [r], [p]).entries[1].candidate).toBe(false);
    expect(readRegexInventory(() => [r], [p], { characterEnabled: true }).entries[1].candidate).toBe(true);
  });

  it('深度边界生效且显示规则不进入业务清洗', () => {
    const r = rule({ min_depth: 1, max_depth: 3 });
    expect(readRegexInventory(() => [r], [policy(r)], { depth: 2 }).entries[0].candidate).toBe(true);
    expect(readRegexInventory(() => [r], [policy(r)], { depth: 4 }).entries[0].candidate).toBe(false);
    expect(readRegexInventory(() => [r], [{ ...policy(r), purpose: 'system-render' }], { depth: 2 }).entries[0].candidate).toBe(false);
  });

  it('域读取失败显式返回不完整，不回退私有设置、不泄露异常文本', () => {
    const result = readRegexInventory(o => {
      if (o.type === 'preset') throw new Error('private-detail');
      return [rule()];
    });
    expect(result.unavailable).toEqual(['preset']);
    expect(result.entries).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain('private-detail');
  });

  it('互相矛盾的批准用途 fail-closed', () => {
    const r = rule();
    const result = readRegexInventory(() => [r], [policy(r), { ...policy(r), purpose: 'display-only' }]);
    expect(result.entries[0].candidate).toBe(false);
    expect(result.entries[0].reasons).toContain('conflicting-policy');
  });
});
