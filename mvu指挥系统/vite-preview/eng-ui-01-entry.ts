/**
 * ENG-UI-01 预览脚手架入口（证据采集专用，非产品代码）：
 * - ConsoleQuickActions：带 projects 的快照 → 「工程」入口 + 在建计数徽标；
 * - ModalEngineering：open=true 直开，三态实例来自快照 projects（覆盖组件内 mock 分支）；
 * - DetailDrawer：挂载全局抽屉，点击实例卡片可截图二级详情；
 * - catalog.init() 离线平稳降级为静态基线（23 块 retrofit 目录）。
 */
import { createPinia } from 'pinia';
import { createApp, h } from 'vue';
import DetailDrawer from '../src/红警指挥系统/ui/DetailDrawer.vue';
import { Schema } from '../src/红警指挥系统/core/schema';
import { useCatalogStore } from '../src/红警指挥系统/composables/useCatalog';
import '../src/红警指挥系统/ui/tailwind.entry.css';
import '../src/红警指挥系统/ui/global.css';
import ConsoleQuickActions from '../src/中控悬浮窗/console/ConsoleQuickActions.vue';
import ModalEngineering from '../src/中控悬浮窗/modals/ModalEngineering.vue';

/** 演示快照：三态 projects 各一（在建 2 → 徽标计数 2） */
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
      id: 'proj:demo-paladin',
      ref: '帕拉丁现代化改装工程',
      scope: 'base',
      bases: ['yunxi'],
      lead_base: 'yunxi',
      grade: '大改',
      status: '在建',
      phases: [
        { idx: 0, name: '底盘通用件换装', status: '进行中', queue_index: null },
        { idx: 1, name: '电传驱动集成', status: '未启动', queue_index: null },
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
    {
      id: 'proj:demo-ifv',
      ref: '多功能步兵车现代化改装工程',
      scope: 'base',
      bases: ['yunxi'],
      lead_base: 'yunxi',
      grade: '小改',
      status: '完工',
      phases: [{ idx: 0, name: '模块化接口升级', status: '完工', queue_index: null }],
      outcome: { type: 'mark' },
      schema_version: 1,
    },
  ],
});

const pinia = createPinia();

// 快捷动作条独立挂载到 #quick-actions-host，模态与抽屉挂载 #app（双 app 共享同一 pinia）
const quickApp = createApp({
  render() {
    return h(ConsoleQuickActions, {
      snapshot,
      activeModal: 'engineering',
      onOpenModal: () => {},
    });
  },
});
quickApp.use(pinia);
quickApp.mount(document.getElementById('quick-actions-host') ?? document.body);

const app = createApp({
  render() {
    return [h(ModalEngineering, { open: true, snapshot, onClose: () => {} }), h(DetailDrawer)];
  },
});
app.use(pinia);
app.mount(document.getElementById('app') ?? document.body);

const catalog = useCatalogStore(pinia);
void catalog.init();
