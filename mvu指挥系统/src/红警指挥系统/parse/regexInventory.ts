/** 正则清单仅做只读诊断，不执行表达式，也不改写宿主配置。
 * API: Tavern Helper 4.9.5，type/global|character|preset 已经真机核验。
 * 三个域各自保留顺序；不得将返回顺序解释为跨域宿主执行顺序。
 */
export const REGEX_SCOPES = ['global', 'character', 'preset'] as const;
export type RegexScope = (typeof REGEX_SCOPES)[number];
export type RegexReader = (option: { type: RegexScope; name?: string }) => TavernRegex[];
export type RegexPurpose = 'system-render' | 'verified-cleaner' | 'display-only';

export interface VerifiedRegexPolicy {
  scope: RegexScope;
  id: string;
  signature: string;
  purpose: RegexPurpose;
}
export interface RegexInventoryEntry {
  scope: RegexScope;
  index: number;
  id: string;
  name: string;
  signature: string;
  classification: RegexPurpose | 'unknown';
  candidate: boolean;
  reasons: string[];
}
export interface RegexInventory {
  entries: RegexInventoryEntry[];
  unavailable: RegexScope[];
  /** 不保存宿主错误对象，以免意外带出设置或文本。 */
  diagnostics: string[];
  crossScopeOrder: 'unverified';
}

/** 确定性内容签名：直接保留规范序列，避免短哈希碰撞被当作信任依据。
 * 名称不参与身份；所有影响执行的已声明字段参与签名。
 */
export function regexContentSignature(rule: TavernRegex): string {
  return JSON.stringify([
    rule.find_regex, rule.replace_string, rule.trim_strings,
    rule.enabled, rule.run_on_edit,
    rule.source.user_input, rule.source.ai_output, rule.source.slash_command,
    rule.source.world_info, rule.source.reasoning,
    rule.destination.display, rule.destination.prompt,
    rule.min_depth, rule.max_depth,
  ]);
}

export function readRegexInventory(
  read: RegexReader,
  policies: readonly VerifiedRegexPolicy[] = [],
  context: { depth?: number; characterEnabled?: boolean } = {},
): RegexInventory {
  const result: RegexInventory = {
    entries: [], unavailable: [], diagnostics: [], crossScopeOrder: 'unverified',
  };
  for (const scope of REGEX_SCOPES) {
    try {
      const rules = read(scope === 'global' ? { type: scope } : {
        type: scope, name: scope === 'character' ? 'current' : 'in_use',
      });
      if (!Array.isArray(rules)) throw new Error('invalid-list');
      const entries = rules.map((rule, index): RegexInventoryEntry => {
        const signature = regexContentSignature(rule);
        const matching = policies.filter(p => p.scope === scope && p.id === rule.id && p.signature === signature);
        const purposes = new Set(matching.map(p => p.purpose));
        const policy = purposes.size === 1 ? matching[0] : undefined;
        const reasons: string[] = [];
        if (!policy) reasons.push(purposes.size > 1 ? 'conflicting-policy' : 'unverified-content');
        if (!rule.enabled) reasons.push('disabled');
        if (!rule.source.ai_output || !rule.destination.display) reasons.push('not-ai-display');
        if (scope === 'character' && context.characterEnabled !== true) reasons.push('character-scope-not-confirmed');
        if (rule.min_depth !== null || rule.max_depth !== null) {
          if (context.depth === undefined || !Number.isFinite(context.depth) || context.depth < 0) {
            reasons.push('depth-unavailable');
          } else if ((rule.min_depth !== null && context.depth < rule.min_depth)
            || (rule.max_depth !== null && context.depth > rule.max_depth)) {
            reasons.push('outside-depth');
          }
        }
        if (policy && policy.purpose !== 'verified-cleaner') reasons.push('not-business-cleaner');
        return {
          scope, index, id: rule.id, name: rule.script_name, signature,
          classification: policy?.purpose ?? 'unknown',
          candidate: reasons.length === 0, reasons,
        };
      });
      result.entries.push(...entries);
    } catch {
      // 一个域读取失败时保留其他域，但明确标记清单不完整，不回退读取私有配置。
      result.unavailable.push(scope);
      result.diagnostics.push(`regex-scope-unavailable:${scope}`);
    }
  }
  return result;
}
