import { klona } from 'klona';
import { correctlyMerge } from '@util/common';
import { defineMvuDataStore } from '@util/mvu';
import { previewBaseline } from '../core/previewData';
import { migrateV1toV2, Schema } from '../core/schema';
import { useFloatingStore } from './useFloatingStore';

/** 是否运行在酒馆 iframe 环境中（独立浏览器预览时为 false） */
export const in_tavern = typeof (window as any).TavernHelper !== 'undefined';

/** 是否运行在酒馆全局脚本 iframe（TH-script--*，如中控悬浮窗）中：禁止在此调用 getCurrentMessageId() */
const in_script_iframe =
  typeof window !== 'undefined' &&
  typeof window.frameElement?.id === 'string' &&
  window.frameElement.id.startsWith('TH-script--');

/** 独立预览用测试场景（?scenario=t2 / multi / dlc）：仅预览分支使用，酒馆内无效
 * dlc 场景配合 useCatalog 的焚风 mock overlay，验证合并管道全链路 */
function previewScenario(): Record<string, unknown> {
  const s = new URLSearchParams(window.location.search).get('scenario');
  if (s !== 't2' && s !== 'multi' && s !== 'dlc') return {};
  const base = {
    id: 'beipo',
    name: '北坡主基地',
    location: '青岚山北坡',
    power: { gen: 320, use: 260 },
    buildings: [
      { name: '发电厂', layer: '地下层', state: '运转' },
      { name: '建造厂核心', layer: '地下层', state: '运转' },
      { name: '兵营', layer: '地下层', state: '运转' },
      { name: '矿石精炼厂', layer: '地下层', state: '运转' },
      { name: '战车工厂', layer: '空腔层', state: '运转' },
      { name: '空军指挥部', layer: '空腔层', state: '运转' },
      { name: '战斗实验室', layer: '地下层', state: '运转' },
      ...(s === 'multi' || s === 'dlc' ? [{ name: '苏联建造厂核心', layer: '空腔层', state: '运转' }] : []),
      ...(s === 'dlc' ? [{ name: '焚风建造厂核心', layer: '空腔层', state: '运转' }] : []),
    ],
    alerts: [],
  };
  return {
    tech: { done: ['基础步兵训练学', '纳米精密合成学', '个人装备工程学', '装甲载具工学', '航空工学基础', '高级作战实验理论', '拟态全息工学'] },
    bases: [base],
    queues: [{ type: '研究', item: '超时空位移工学', base: 'beipo', progress: 42, eta: '余4日' }],
    codex:
      s === 'multi' || s === 'dlc'
        ? [
            { name: '磁暴线圈工学', kind: '科技', desc: '苏联磁暴重工体系的入门理论，解锁磁暴线圈防御。', params: { 科技线: '苏联特色', 层级: 'T2', 造价: '1200', 工期: '约6日' } },
            { name: '灵气共振弹头学', kind: '科技', desc: '灵气活性组分与弹药战斗部耦合的实验理论。', params: { 层级: 'T2' } },
          ]
        : [],
  };
}

/** 独立预览用 store：富演示基底（previewData.ts，D1 归零后 schema 默认值不再含演示数据）+ scenario 覆盖片段 */
const usePreviewStore = defineStore('mvu_data.preview', () => {
  const data = ref(Schema.parse(correctlyMerge(structuredClone(previewBaseline), previewScenario())));
  return { data };
});

/** 全局脚本 iframe（TH-script--*）只读适配兜底：等价于 storeAdapter.ts，防止旧 watch 进程未命中 alias 时在顶层调用 getCurrentMessageId() 崩溃 */
const useFloatingAdapterStore = defineStore('mvu_data.floating-adapter', () => {
  const floating = useFloatingStore();
  const data = ref<Schema>(Schema.parse({}));
  watch(
    () => floating.snapshot,
    snapshot => {
      data.value = snapshot ? klona(snapshot) : Schema.parse({});
    },
    { immediate: true },
  );
  return { data };
});

function createFloorOrAdapterStore() {
  if (!in_tavern) return usePreviewStore;
  if (in_script_iframe) return useFloatingAdapterStore;
  try {
    return defineMvuDataStore(Schema, { type: 'message', message_id: getCurrentMessageId() }, undefined, migrateV1toV2);
  } catch {
    return useFloatingAdapterStore;
  }
}

export const useDataStore = createFloorOrAdapterStore();
