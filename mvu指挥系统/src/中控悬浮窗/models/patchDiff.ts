/**
 * patchDiff.ts —— 数据补丁审核弹窗的 Diff 计算（纯函数，F5 修复抽出以便单测）
 *
 * F5 根因：PanelDataPatches 曾读取不存在的 `catalogStore.catalogEffective`（useCatalog 导出为
 * `effectiveCatalog`/`catalog`），以及 EffectiveCatalog 上不存在的 `tech` 字段（真实为 `researches`），
 * render 抛错导致宿主全屏覆盖层空挂。此处按 EffectiveCatalog 真实形状取值，并对缺省目录防御。
 */
import type { EffectiveCatalog } from '../../红警指挥系统/core/catalogEffective';
import type { DataPatch } from '../../红警指挥系统/core/schema';
import { calculateDataDiff, type DiffChange } from '../../红警指挥系统/worldbook/worldbookDataFiler';

export type PatchDiffCatalog =
  | (Partial<
      Pick<
        EffectiveCatalog,
        'buildings' | 'researches' | 'productions' | 'retrofits' | 'projects' | 'protocols'
      >
    > & {
      units?: unknown[];
      defenses?: unknown[];
    })
  | null
  | undefined;

type CatalogItem = { name: string; cost?: number } & Record<string, unknown>;

const catalogItemLookupCache = new WeakMap<
  object,
  { sig: string; map: Map<string, CatalogItem> }
>();

function getCatalogLookupMap(cat: PatchDiffCatalog): Map<string, CatalogItem> {
  if (!cat || typeof cat !== 'object') return new Map();
  const pools = [
    cat.buildings,
    cat.researches,
    cat.productions,
    cat.retrofits,
    cat.projects,
    cat.protocols,
    cat.units,
    cat.defenses,
  ];
  const sig = pools.map(p => (Array.isArray(p) ? p.length : 0)).join(':');
  const cached = catalogItemLookupCache.get(cat);
  if (cached && cached.sig === sig) {
    return cached.map;
  }
  const map = new Map<string, CatalogItem>();
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue;
    for (const raw of pool) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as CatalogItem;
      if (typeof item.id === 'string' && item.id && !map.has(item.id)) {
        map.set(item.id, item);
      }
      if (typeof item.name === 'string' && item.name && !map.has(item.name)) {
        map.set(item.name, item);
      }
    }
  }
  catalogItemLookupCache.set(cat, { sig, map });
  return map;
}

export function buildPatchDiffList(
  cat: PatchDiffCatalog,
  patch: Pick<DataPatch, 'target'> & { patch?: Record<string, unknown>; changes?: Record<string, unknown> },
): DiffChange[] {
  const lookup = getCatalogLookupMap(cat);
  const matched = lookup.get(patch.target);

  const payload = patch.patch ?? patch.changes ?? {};
  const oldData: Record<string, unknown> = {};

  if (matched) {
    for (const key of Object.keys(payload)) {
      if (key in matched && matched[key] !== undefined) {
        oldData[key] = matched[key];
      }
    }
  }

  const diff = calculateDataDiff(oldData, payload, patch.target);
  if (diff.changes.length > 0 || matched) return diff.changes;

  // 若对比老数据未找到（如新项），直接展示 patch 载荷所有字段为 added
  return Object.entries(payload).map(([k, v]) => ({
    path: k,
    type: 'added' as const,
    newValue: v,
  }));
}
