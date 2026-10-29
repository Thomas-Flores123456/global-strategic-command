/**
 * ENG-UI-02 预览脚手架入口（证据采集专用，非产品代码）：
 * - ModalEngineering：open=true 直开，快照含在建灰熊工程（phases 驱动场景热点点亮：完工×2/进行中/未启动×2）；
 * - DetailDrawer：热点点击 → emit hotspot-info → 父级 openDetail 弹纯读取信息（截图证据）；
 * - #rm-host 独立 EngSceneView：forceReducedMotion prop 演示 reduced-motion 降级（脉冲归零）。
 * catalog.init() 离线平稳降级为静态基线（23 块 retrofit 目录）；世界书 API 离线缺失 → 场景引擎恒走内置回退。
 */
import { createPinia } from 'pinia';
import { createApp, h } from 'vue';
import DetailDrawer from '../src/红警指挥系统/ui/DetailDrawer.vue';
import type { RetrofitDef } from '../src/红警指挥系统/core/catalog';
import { Schema, type Project } from '../src/红警指挥系统/core/schema';
import { useCatalogStore } from '../src/红警指挥系统/composables/useCatalog';
import '../src/红警指挥系统/ui/tailwind.entry.css';
import '../src/红警指挥系统/ui/global.css';
import EngSceneView from '../src/中控悬浮窗/panels/EngSceneView.vue';
import ModalEngineering from '../src/中控悬浮窗/modals/ModalEngineering.vue';

/** 演示快照：在建灰熊工程（5 阶段，点亮热点：chassis/power=done、defense=active、其余 pending） */
const snapshot = Schema.parse({
  meta: { world_id: 'preview', date: '2042-03-14', day_count: 47, location: '预览' },
  bases: [
    { id: 'beipo', name: '北坡主基地' },
    { id: 'yunxi', name: '云溪镇联络点' },
  ],
  projects: [
    {
      id: 'proj:demo-grizzly',
      ref: '灰熊坦克现代化改装工程',
      scope: 'base',
      bases: ['beipo'],
      lead_base: 'beipo',
      grade: '大改',
      status: '在建',
      phases: [
        { idx: 0, name: '底盘拆解', status: '完工', queue_index: null },
        { idx: 1, name: '混动APU换装', status: '完工', queue_index: null },
        { idx: 2, name: '主动防御集成', status: '进行中', queue_index: null },
        { idx: 3, name: '车际网络联调', status: '未启动', queue_index: null },
        { idx: 4, name: '出厂验收', status: '未启动', queue_index: null },
      ],
      outcome: { type: 'mark' },
      schema_version: 1,
    },
    {
      id: 'proj:demo-bradley',
      ref: '布拉德利现代化改装工程',
      scope: 'base',
      bases: ['beipo'],
      lead_base: 'beipo',
      grade: '中改',
      status: '规划中',
      phases: [
        { idx: 0, name: '动力包换装', status: '未启动', queue_index: null },
        { idx: 1, name: '全车数字化', status: '未启动', queue_index: null },
        { idx: 2, name: '归族同批验收', status: '未启动', queue_index: null },
      ],
      outcome: { type: 'mark' },
      schema_version: 1,
    },
  ],
});

const pinia = createPinia();

const app = createApp({
  render() {
    return [h(ModalEngineering, { open: true, snapshot, onClose: () => {} }), h(DetailDrawer)];
  },
});
app.use(pinia);
app.mount(document.getElementById('app') ?? document.body);

/* reduced-motion 降级对照面板（独立挂载，forceReducedMotion prop 强制） */
const RM_DEF: RetrofitDef = {
  kind: 'retrofit',
  name: '灰熊坦克现代化改装工程',
  research: '混合动力装甲工学',
  grade: '大改',
  desc: '混动APU+主动防御系统+车际数据网络。',
};
const RM_PROJECT: Project = snapshot.projects![0];

const rmApp = createApp({
  render() {
    return h(EngSceneView, {
      def: RM_DEF,
      project: RM_PROJECT,
      forceReducedMotion: true,
      onHotspotInfo: () => {},
    });
  },
});
rmApp.use(pinia);
rmApp.mount(document.getElementById('rm-host') ?? document.body);

const catalog = useCatalogStore(pinia);
void catalog.init();
