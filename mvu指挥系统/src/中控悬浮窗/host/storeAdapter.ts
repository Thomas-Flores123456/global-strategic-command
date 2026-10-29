/**
 * storeAdapter.ts —— 悬浮窗入口的 `红警指挥系统/store` 只读替身（D-RAC-ENTRY-STORE-01 → A）
 *
 * webpack 仅对 `src/中控悬浮窗/` 入口把 `src/红警指挥系统/store.ts` 精确 alias 到本文件，
 * 使 `panels/**`、`send.ts`、`useCatalog.ts` 的 `import { useDataStore, in_tavern } from '../store'` 零修改复用。
 *
 * 与 store.ts 的差异：
 * - store.ts 在酒馆内于模块加载时求值 `getCurrentMessageId()`（Helper 4.9.3 对 `TH-script--*` iframe 抛错），
 *   且 `defineMvuDataStore` 含 2s 轮询 + `updateVariablesWith` 写回；本文件两者皆无；
 * - `data` 派生自 `useFloatingStore().snapshot`（最近有效 AI 楼的 Schema 归一数据），
 *   snapshot 为 null 时回退 `Schema.parse({})` 归零态，面板永不因空数据崩溃；
 * - **只读**：`data` 是 snapshot 的深拷贝，复用面板（当前为 PanelTech / PanelForces；PanelIntel 未挂载）若有局部改写只影响本地视图，
 *   下次 refresh 被整体替换，零变量写入（不调用 updateVariablesWith / replaceVariables / insertVariables）。
 */
import { klona } from 'klona';
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { Schema } from '@/红警指挥系统/core/schema';
import { useFloatingStore } from '@/红警指挥系统/composables/useFloatingStore';

/** 与 store.ts 同判定：是否运行在酒馆（Tavern Helper）iframe 环境中 */
export const in_tavern = typeof (window as any).TavernHelper !== 'undefined';

/** 归零态：Schema 默认值（D1 归零后不含演示数据） */
export function emptyData(): Schema {
  return Schema.parse({});
}

export const useDataStore = defineStore('mvu_data.floating-adapter', () => {
  const floating = useFloatingStore();
  const data = ref<Schema>(emptyData());

  watch(
    () => floating.snapshot,
    snapshot => {
      // klona 去掉 pinia/vue 的 proxy 层并做深拷贝：面板改写不会污染 useFloatingStore.snapshot
      data.value = snapshot ? klona(snapshot) : emptyData();
    },
    { immediate: true },
  );

  return { data };
});
