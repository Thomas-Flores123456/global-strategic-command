import { describe, expect, it, vi } from 'vitest';
import { installRegexInspector, REGEX_INSPECTOR_KEY } from '../host/regexInspector';

function fixture(): TavernRegex {
  return {
    id: 'test', script_name: '测试', enabled: true, run_on_edit: true,
    find_regex: 'PRIVATE_EXPRESSION', replace_string: 'PRIVATE_TEMPLATE', trim_strings: [],
    source: { ai_output: true, user_input: false, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false }, min_depth: null, max_depth: null,
  };
}
function api(target: Record<string, unknown>) {
  return target[REGEX_INSPECTOR_KEY] as { inspect: (depth?: number) => any };
}

describe('iframe 只读正则诊断入口', () => {
  it('安装不读取；每次诊断重新读取三域且不返回表达式和替换文本', () => {
    const target = {};
    let rules = [fixture()];
    const read = vi.fn(() => rules);
    const stop = installRegexInspector(target, { read, characterEnabled: () => true });
    expect(read).not.toHaveBeenCalled();
    const result = api(target).inspect();
    expect(result.complete).toBe(true);
    expect(result.entries).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    rules = [];
    expect(api(target).inspect().entries).toHaveLength(0);
    expect(read).toHaveBeenCalledTimes(6);
    stop();
  });

  it('卸载后移除入口，旧引用不可继续读取', () => {
    const target = {};
    const read = vi.fn(() => []);
    const stop = installRegexInspector(target, { read, characterEnabled: () => true });
    const oldApi = api(target);
    stop();
    stop();
    expect(target).not.toHaveProperty(REGEX_INSPECTOR_KEY);
    expect(oldApi.inspect()).toEqual({ available: false, reason: 'disposed' });
    expect(read).not.toHaveBeenCalled();
  });

  it('保留原属性；卸载不删除后来者的入口', () => {
    const original = { marker: true };
    const target: Record<string, unknown> = { [REGEX_INSPECTOR_KEY]: original };
    const stop = installRegexInspector(target, { read: () => [], characterEnabled: () => true });
    stop();
    expect(target[REGEX_INSPECTOR_KEY]).toBe(original);
    const stop2 = installRegexInspector(target, { read: () => [], characterEnabled: () => true });
    Object.defineProperty(target, REGEX_INSPECTOR_KEY, { configurable: true, value: 'new-owner' });
    stop2();
    expect(target[REGEX_INSPECTOR_KEY]).toBe('new-owner');
  });

  it('API或角色开关读取异常时可诊断且不抛出私有错误', () => {
    const target = {};
    const stop = installRegexInspector(target, {
      read: () => { throw new Error('PRIVATE_ERROR'); },
      characterEnabled: () => { throw new Error('PRIVATE_ERROR'); },
    });
    const result = api(target).inspect();
    expect(result.complete).toBe(false);
    expect(result.unavailable).toEqual(['global', 'character', 'preset']);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_ERROR');
    stop();
  });
});
