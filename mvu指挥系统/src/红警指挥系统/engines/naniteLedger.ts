/**
 * naniteLedger.ts —— 纳米工料读数与扣减（零依赖，供工程引擎与航天引擎共用，避免 parse 链循环引用）
 */

type NaniteValue = number | Record<string, number | null | undefined> | null | undefined;

export interface NaniteEconomyView {
  credits?: number;
  resources?: { nanites?: NaniteValue; [k: string]: unknown };
  [k: string]: unknown;
}

/** 可用纳米库存（全小类有限数求和，兼容数值型 nanites；null=未探明按 0） */
export function availableNanites(state: { economy?: NaniteEconomyView | null }): number {
  const nanites = state.economy?.resources?.nanites as unknown;
  if (typeof nanites === 'number') {
    return Number.isFinite(nanites) ? Math.max(0, nanites) : 0;
  }
  if (!nanites || typeof nanites !== 'object') return 0;
  return Object.values(nanites as Record<string, unknown>).reduce<number>(
    (sum, v) => sum + (typeof v === 'number' && Number.isFinite(v) ? v : 0),
    0,
  );
}

const NANITE_DEDUCT_PRIORITY: readonly string[] = [
  '通用纳米工料',
  '标准纳米工料',
  '军工纳米工料',
  '特种纳米工料',
  '高精构造型纳米',
  '高能纳米工料',
  '机娘修复凝胶',
];

/** 真实从 economy.resources.nanites 扣减指定纳米数（兼容数值与分小类对象，按低阶→高阶优先级扣减，不扣至负数） */
export function deductEconomyNanites<E extends NaniteEconomyView>(
  economy: E | null | undefined,
  naniteCost: number,
  nextCredits: number,
): E {
  const baseEconomy = { ...(economy ?? {}), credits: nextCredits } as E;
  if (!Number.isFinite(naniteCost) || naniteCost <= 0 || !baseEconomy.resources) {
    return baseEconomy;
  }
  const rawNanites = baseEconomy.resources.nanites as unknown;
  if (typeof rawNanites === 'number' && Number.isFinite(rawNanites)) {
    return {
      ...baseEconomy,
      resources: { ...baseEconomy.resources, nanites: Math.max(0, rawNanites - naniteCost) },
    };
  }
  if (!rawNanites || typeof rawNanites !== 'object') {
    return baseEconomy;
  }
  const nextNanites: Record<string, number | null | undefined> = {
    ...(rawNanites as Record<string, number | null | undefined>),
  };
  const prioritySet = new Set(NANITE_DEDUCT_PRIORITY);
  const orderedKeys = [
    ...NANITE_DEDUCT_PRIORITY.filter(k => Object.prototype.hasOwnProperty.call(nextNanites, k)),
    ...Object.keys(nextNanites).filter(k => !prioritySet.has(k)),
  ];
  let remaining = naniteCost;
  for (const k of orderedKeys) {
    if (remaining <= 0) break;
    const v = nextNanites[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      const take = Math.min(v, remaining);
      nextNanites[k] = Math.max(0, v - take);
      remaining -= take;
    }
  }
  return {
    ...baseEconomy,
    resources: { ...baseEconomy.resources, nanites: nextNanites },
  };
}
