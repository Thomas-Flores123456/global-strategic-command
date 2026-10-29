import { readRegexInventory, type RegexReader, type VerifiedRegexPolicy } from '../../红警指挥系统/parse/regexInventory';

export const REGEX_INSPECTOR_KEY = '__twRegexInspectorV1';

/** 仅发布在本脚本 iframe；按需重读，避免缓存跨聊天/预设污染。
 * 不在控制台输出表达式、替换内容或消息正文，也不安装轮询与宿主事件监听。
 */
export function installRegexInspector(
  target: Record<string, unknown>,
  deps: { read: RegexReader; characterEnabled: () => boolean },
  policies: readonly VerifiedRegexPolicy[] = [],
): () => void {
  const previous = Object.getOwnPropertyDescriptor(target, REGEX_INSPECTOR_KEY);
  if (previous && !previous.configurable) return () => {};
  let active = true;
  const api = Object.freeze({
    version: 1,
    inspect(depth?: number) {
      if (!active) return { available: false as const, reason: 'disposed' };
      let characterEnabled = false;
      try { characterEnabled = deps.characterEnabled() === true; } catch { /* fail closed */ }
      const inventory = readRegexInventory(deps.read, policies, { depth, characterEnabled });
      return {
        available: true as const,
        complete: inventory.unavailable.length === 0,
        crossScopeOrder: inventory.crossScopeOrder,
        unavailable: inventory.unavailable,
        diagnostics: inventory.diagnostics,
        // 内容签名包含完整正则与替换模板，不通过公共诊断入口返回。
        entries: inventory.entries.map(({ signature: _signature, ...entry }) => entry),
      };
    },
  });
  Object.defineProperty(target, REGEX_INSPECTOR_KEY, { configurable: true, value: api });
  return () => {
    active = false;
    if (target[REGEX_INSPECTOR_KEY] !== api) return;
    if (previous) Object.defineProperty(target, REGEX_INSPECTOR_KEY, previous);
    else delete target[REGEX_INSPECTOR_KEY];
  };
}
