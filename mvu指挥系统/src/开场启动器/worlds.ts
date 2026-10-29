/**
 * 开场启动器 · 多阵营四书与《协议_世界书》注册同步真源（CMD-LAUNCH-01）
 *
 * 在复用 `../红警指挥系统/worlds` 世界契约的基础上，定义：
 * - 协议常备世界书常量 `PROTOCOL_WORLDBOOK`（`'协议_世界书'`，随任何开局或阵营同步自动启用）
 * - 盟军专属四书组 `ALLIED_WORLDBOOK_GROUP`
 * - 苏联专属四书组 `SOVIET_WORLDBOOK_GROUP`
 * - 第三阵营（尤里）扩展四书组 `YURI_WORLDBOOK_GROUP`
 */

import { normalizeFactionId } from '../红警指挥系统/core/commandPresets';
import {
  allWorldExclusiveBooks as rawAllWorldExclusiveBooks,
  getWorldManifest as getRawWorldManifest,
  isLegalCurrency,
  WORLD_IDS,
  WORLD_MANIFESTS as RAW_WORLD_MANIFESTS,
  type WorldAffinity,
  type WorldbookRef,
  type WorldCategory,
  type WorldManifest,
} from '../红警指挥系统/core/worlds';

export {
  isLegalCurrency,
  WORLD_IDS,
  type WorldAffinity,
  type WorldbookRef,
  type WorldCategory,
  type WorldManifest,
};

/** 协议常备世界书（以世界书同步服务.mjs 目标书名为基准，随任何开局或阵营同步自动启用） */
export const PROTOCOL_WORLDBOOK = '协议' as const;

/** 机娘能力档案常备世界书（三大首发 MCV 机娘与在编机娘能力设定真源） */
export const MAIDEN_DOSSIER_WORLDBOOK = '机娘·能力档案' as const;

/** 通用工程与巨构世界书（以世界书同步服务.mjs 目标书名为基准，随工程系统开关联动启停） */
export const ENGINEERING_COMMON_WORLDBOOK = '工程·通用' as const;

/** 各阵营专属工程世界书映射表（随工程系统开关 + 阵营解锁双门联动） */
export const FACTION_ENGINEERING_WORLDBOOKS: Readonly<Record<string, string>> = Object.freeze({
  allied: '工程·盟军',
  soviet: '工程·苏联',
  yuri: '工程·尤里',
});

/** 全部受管工程与巨构世界书列表（无 _世界书 后缀） */
export const ENGINEERING_WORLDBOOKS = [
  ENGINEERING_COMMON_WORLDBOOK,
  '工程·盟军',
  '工程·苏联',
  '工程·尤里',
] as const;

/** 盟军专属四书组常量（无 _世界书 后缀，对齐世界书同步服务目标名） */
export const ALLIED_WORLDBOOK_GROUP = [
  '武备·盟军',
  '特色建筑·盟军',
  '特色科技·盟军',
  '工程·盟军',
] as const;

/** 苏联专属四书组常量（无 _世界书 后缀，对齐世界书同步服务目标名） */
export const SOVIET_WORLDBOOK_GROUP = [
  '武备·苏联',
  '特色建筑·苏联',
  '特色科技·苏联',
  '工程·苏联',
] as const;

/** 第三阵营（尤里）专属四书组常量（无 _世界书 后缀，对齐世界书同步服务目标名） */
export const YURI_WORLDBOOK_GROUP = [
  '武备·尤里',
  '特色建筑·尤里',
  '特色科技·尤里',
  '工程·尤里',
] as const;

/** 通用核心必选书列表（含《机娘·能力档案》与《协议》，无 _世界书 后缀） */
export const CORE_REQUIRED_WORLDBOOKS = [
  '通用·主建筑',
  '通用·人员',
  '通用·工业基础',
  '通用·装备',
  '通用·防御辅助',
  '通用·陆地载具',
  '通用·空中载具',
  '通用·水面舰艇',
  '通用·航天工业',
  '机娘·能力档案',
  PROTOCOL_WORLDBOOK,
] as const;

/** 自动推导旧版带 `_世界书` 后缀的冗余世界书名列表（用于同步时自动剔除旧名） */
export const LEGACY_DUPLICATE_WORLDBOOK_NAMES: readonly string[] = Object.freeze([
  ...CORE_REQUIRED_WORLDBOOKS.map(name => `${name}_世界书`),
  ...ALLIED_WORLDBOOK_GROUP.map(name => `${name}_世界书`),
  ...SOVIET_WORLDBOOK_GROUP.map(name => `${name}_世界书`),
  ...YURI_WORLDBOOK_GROUP.map(name => `${name}_世界书`),
  `${ENGINEERING_COMMON_WORLDBOOK}_世界书`,
  '全域战略指挥系统_世界书',
  '异能穿越模拟器v1.0',
  '异能穿越模拟器v1.0_世界书',
]);

function ensureMaidenBookInManifest(manifest: WorldManifest): WorldManifest {
  const hasMaidenBook = manifest.worldbook_group.some(
    b => b.name === '机娘·能力档案' || b.name === '机娘·能力档案_世界书',
  );
  if (hasMaidenBook) return manifest;
  return {
    ...manifest,
    worldbook_group: [
      ...manifest.worldbook_group,
      { name: '机娘·能力档案', required: true },
    ],
  };
}

export const WORLD_MANIFESTS: Record<string, WorldManifest> = Object.freeze(
  Object.fromEntries(
    Object.entries(RAW_WORLD_MANIFESTS).map(([k, v]) => [k, ensureMaidenBookInManifest(v)]),
  ),
);

export function getWorldManifest(worldId: string): WorldManifest | undefined {
  const found = WORLD_MANIFESTS[worldId] ?? getRawWorldManifest(worldId);
  return found ? ensureMaidenBookInManifest(found) : undefined;
}

/** 全部世界专属书并集（《机娘·能力档案》已升级为全战区核心常备书，不再作为单世界排他书被卸载） */
export function allWorldExclusiveBooks(): string[] {
  return rawAllWorldExclusiveBooks().filter(
    name => name !== '机娘·能力档案' && name !== '机娘·能力档案_世界书',
  );
}

/** 已注册阵营专属四书映射表 */
export const FACTION_WORLDBOOK_GROUPS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  allied: ALLIED_WORLDBOOK_GROUP,
  soviet: SOVIET_WORLDBOOK_GROUP,
  yuri: YURI_WORLDBOOK_GROUP,
});

/** 去掉 `_世界书` 后缀以兼容酒馆无后缀书名 */
export function stripWorldbookSuffix(name: string): string {
  return name.endsWith('_世界书') ? name.slice(0, -4) : name;
}

/** 补齐 `_世界书` 后缀 */
export function ensureWorldbookSuffix(name: string): string {
  return name.endsWith('_世界书') ? name : `${name}_世界书`;
}

/** 按阵营 ID（或中文名/别名）获取专属四书组 */
export function getFactionWorldbookGroup(factionId: string): readonly string[] {
  const normalized = normalizeFactionId(factionId);
  return FACTION_WORLDBOOK_GROUPS[normalized] ?? [];
}

/** 获取全部受管阵营专属四书集合（同时包含无后缀标准名与带 `_世界书` 后缀兼容形态） */
export function allManagedFactionBooks(): string[] {
  const result = new Set<string>();
  for (const group of Object.values(FACTION_WORLDBOOK_GROUPS)) {
    for (const book of group) {
      result.add(stripWorldbookSuffix(book));
      result.add(ensureWorldbookSuffix(book));
    }
  }
  return [...result];
}

/** 判定某世界书名是否属于工程与巨构受管书（含无后缀与 `_世界书` 后缀双形态） */
export function isEngineeringWorldbookName(name: string): boolean {
  const bare = stripWorldbookSuffix((name || '').trim());
  return (ENGINEERING_WORLDBOOKS as readonly string[]).includes(bare);
}

/** 获取全部受管工程与巨构世界书集合（同时包含无后缀标准名与带 `_世界书` 后缀兼容形态） */
export function allManagedEngineeringBooks(): string[] {
  const result = new Set<string>();
  for (const book of ENGINEERING_WORLDBOOKS) {
    result.add(stripWorldbookSuffix(book));
    result.add(ensureWorldbookSuffix(book));
  }
  return [...result];
}

