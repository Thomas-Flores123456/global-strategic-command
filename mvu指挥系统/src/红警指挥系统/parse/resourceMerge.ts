/**
 * parse/resourceMerge.ts —— 六大战略资源字段合并与三色门校验纯函数（DEC-PARSE-01）
 *
 * 约束：零 IO / 零酒馆 API / 零 Vue 依赖。
 */
import {
  canon,
  isUsable,
  keyIndex,
  quarantineLeftovers,
  take,
  toNum,
  yellow,
  type Ctx as ParseCtxLike,
  type StatData,
} from './parseTypesAndCanon';

/** 六大战略资源柱标准英文键 */
export const RESOURCE_PILLAR_KEYS = [
  'nanites',
  'minerals',
  'materials',
  'fuel',
  'munitions',
  'logistics',
] as const;

export type ResourcePillarKey = (typeof RESOURCE_PILLAR_KEYS)[number];

/** 六柱柱名别名（canon 比对）：中文主名与 schema.ts EconomyResources 注释同源，另容短称与英文键 */
export const RESOURCE_PILLAR_ALIASES: Record<string, string[]> = {
  nanites: [
    '纳米',
    '纳米机械',
    '纳米机械储备',
    '纳米工料',
    '纳米材料',
    '纳米原料',
    '纳米耗材',
    '纳米储量',
    '纳米工料储量',
    'nanites',
    'nanite',
  ],
  minerals: ['原矿', '矿物', '矿产', '矿石', '原材料', '矿产与原矿', 'minerals', 'mineral', 'ore', 'ores'],
  materials: [
    '工业材料',
    '材料',
    '建材',
    '工业品',
    '工业建材',
    '精加工材料',
    '大宗常规建材与化工材料',
    'materials',
    'material',
  ],
  fuel: ['能源', '燃料', '电力', '燃油', '油料', '燃油与能源介质', 'fuel', 'energy', 'power'],
  munitions: ['弹药', '军火', '军械', '战术军械弹药', '军械弹药', 'munitions', 'ammo', 'ammunition'],
  logistics: [
    '农产品',
    '粮食',
    '食品',
    '补给',
    '农产',
    '食物',
    '后勤',
    '生活物资',
    '后勤物资',
    '基地维生与水文后勤',
    'logistics',
    'food',
    'supplies',
  ],
};

const NANITE_SUBKEY_ALIASES: Readonly<Record<string, string>> = {
  通用纳米: '通用纳米工料',
  通用纳米工料: '通用纳米工料',
  军工纳米: '军工纳米工料',
  军工纳米工料: '军工纳米工料',
  特种纳米: '特种纳米工料',
  特种纳米工料: '特种纳米工料',
  高能纳米: '高能纳米工料',
  高能纳米工料: '高能纳米工料',
  标准纳米: '标准纳米工料',
  标准纳米工料: '标准纳米工料',
  高精纳米: '高精构造型纳米',
  高精构型纳米: '高精构造型纳米',
  高精构造型纳米: '高精构造型纳米',
  修复凝胶: '机娘修复凝胶',
  机娘修复凝胶: '机娘修复凝胶',
};

function normalizeNaniteSubkey(rawKey: string): string | null {
  const trimmed = rawKey.trim();
  if (!trimmed) return null;
  const hit = NANITE_SUBKEY_ALIASES[canon(trimmed)];
  if (hit) return hit;
  if (/纳米|凝胶/.test(trimmed)) return trimmed;
  return null;
}

/** 六大战略资源（§3.7）：按柱深合并——未提及柱/小类保持原值，null=未解锁严禁降级为 0 */
export function applyResources(src: Record<string, unknown>, data: StatData, ctx: ParseCtxLike): void {
  const idx = keyIndex(src);
  const consumed = new Set<string>();
  const eco = data.economy as unknown as Record<string, unknown>;
  for (const [pillar, aliases] of Object.entries(RESOURCE_PILLAR_ALIASES)) {
    const t = take(src, idx, consumed, aliases);
    if (!t) continue;
    if (!isUsable(t.value) || Array.isArray(t.value)) {
      ctx.quarantine.push({
        scope: 'key',
        path: `资源.${t.key}`,
        raw: JSON.stringify(t.value),
        error: '资源柱必须为键值映射对象',
        suggestion: `写法：资源: {${t.key}: {小类名: 数值}}`,
      });
      continue;
    }
    // 首次落账才建记录；缺席柱由终末 Schema.parse 的 zod default 补 null 预置小类
    const res = (eco.resources ??= {}) as Record<string, unknown>;
    const target = (res[pillar] ??= {}) as Record<string, unknown>;
    mergeResourceRecord(target, t.value as Record<string, unknown>, ctx, `资源.${pillar}`);
    if (pillar === 'nanites') {
      eco.nanites = target;
    }
  }

  // 兼容在 <态势>.资源 下直接平铺四类纳米工料及简称（如 通用纳米工料 / 军工纳米工料 / 特种纳米工料 / 高能纳米工料 及 通用纳米 等）
  const flatNanitePatch: Record<string, unknown> = {};
  for (const [rawKey, rawVal] of Object.entries(src)) {
    if (consumed.has(rawKey) || isUsable(rawVal)) continue;
    const trimmed = rawKey.trim();
    const isDelta = trimmed.endsWith('变化');
    const baseKey = isDelta ? trimmed.slice(0, -2).trim() : trimmed;
    const normalizedSubkey = normalizeNaniteSubkey(baseKey);
    if (!normalizedSubkey) continue;
    consumed.add(rawKey);
    flatNanitePatch[isDelta ? `${normalizedSubkey}变化` : normalizedSubkey] = rawVal;
  }
  if (Object.keys(flatNanitePatch).length > 0) {
    const res = (eco.resources ??= {}) as Record<string, unknown>;
    const target = (res.nanites ??= {}) as Record<string, unknown>;
    mergeResourceRecord(target, flatNanitePatch, ctx, '资源.nanites');
    eco.nanites = target;
  }

  quarantineLeftovers(src, consumed, ctx, '资源');
}

/** 单柱小类合并：null（未解锁）/0（告罄）/>0（流转）逐字透传；负数与非数值键级🔴隔离 */
export function mergeResourceRecord(
  target: Record<string, unknown>,
  src: Record<string, unknown>,
  ctx: ParseCtxLike,
  path: string,
): void {
  const isNanitePillar = path.endsWith('.nanites');
  for (const [k, v] of Object.entries(src)) {
    const rawTrimmed = k.trim();
    if (!rawTrimmed) {
      ctx.quarantine.push({ scope: 'key', path, raw: JSON.stringify(src[k]), error: '资源小类名为空' });
      continue;
    }
    const isDelta = rawTrimmed.endsWith('变化');
    const rawBase = isDelta ? rawTrimmed.slice(0, -2).trim() : rawTrimmed;
    const normBase = isNanitePillar ? (normalizeNaniteSubkey(rawBase) ?? rawBase) : rawBase;
    const name = isDelta ? `${normBase}变化` : normBase;
    if (v === null || (typeof v === 'string' && canon(v) === 'null')) {
      if (typeof target[name] === 'number')
        yellow(
          ctx,
          {
            layer: 'merge',
            path: `${path}.${name}`,
            message: '数值回写为 null（重新锁定为未解锁），请确认是否有意',
            before: target[name],
            after: null,
          },
          { rule: 'R18', target: `${path}.${name}`, message: '资源数值被回写为 null' },
        );
      target[name] = null;
      ctx.appliedCount++;
      continue;
    }
    if (isDelta) {
      const baseName = normBase;
      if (!baseName) {
        ctx.quarantine.push({ scope: 'key', path, raw: JSON.stringify(src[k]), error: '资源小类名为空' });
        continue;
      }
      const d = toNum(v);
      if (d == null) {
        ctx.quarantine.push({ scope: 'key', path: `${path}.${name}`, raw: String(v), error: '非数字值' });
        continue;
      }
      const cur =
        typeof target[baseName] === 'number' && Number.isFinite(target[baseName] as number)
          ? (target[baseName] as number)
          : 0;
      target[baseName] = Math.max(0, cur + d);
      ctx.appliedCount++;
      continue;
    }
    const n = toNum(v);
    if (n == null || n < 0) {
      ctx.quarantine.push({
        scope: 'key',
        path: `${path}.${name}`,
        raw: String(v),
        error: n == null ? '非数字值' : '资源库存不得为负',
      });
      continue;
    }
    target[name] = n;
    ctx.appliedCount++;
  }
}
