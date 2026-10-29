/**
 * ENG-UI-03 预览脚手架入口（证据采集专用，非产品代码）：
 * - ModalEngineering：open=true 直开，快照含四状态工程实例（在建/暂停/规划中/完工）演示状态门矩阵；
 *   eng-info 容器底部立项令按钮（基地=snapshot 主基地 bases[0]「北坡主基地」）；
 * - DetailDrawer：三态卡片 openProjectDetail 携带 eng 载荷 → 四令按钮组 + 取消二次确认弹层（结算文案）；
 * - 页面底部模拟宿主 #send_textarea：点击按钮后指令文本填入（DOM 证据，截图与断言用）。
 * catalog.init() 离线平稳降级为静态基线（23 块 retrofit 目录）。
 */
import { createPinia } from 'pinia';
import { createApp, h } from 'vue';
import DetailDrawer from '../src/红警指挥系统/ui/DetailDrawer.vue';
import { Schema } from '../src/红警指挥系统/core/schema';
import { useCatalogStore } from '../src/红警指挥系统/composables/useCatalog';
import '../src/红警指挥系统/ui/tailwind.entry.css';
import '../src/红警指挥系统/ui/global.css';
import ModalEngineering from '../src/中控悬浮窗/modals/ModalEngineering.vue';

/** 演示快照：四状态工程实例（状态门矩阵演示：在建可注资/暂停/取消；暂停可恢复/取消；规划中全禁；完工终态全禁） */
const snapshot = Schema.parse({
  meta: { world_id: 'preview', date: '2042-03-14', day_count: 47, location: '预览' },
  bases: [
    { id: 'beipo', name: '北坡主基地' },
    { id: 'yunxi', name: '云溪镇联络点' },
  ],
  projects: [
    {
      id: 'proj:灰熊坦克现代化改装工程@beipo',
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
      id: 'proj:布拉德利现代化改装工程@beipo',
      ref: '布拉德利现代化改装工程',
      scope: 'base',
      bases: ['beipo'],
      lead_base: 'beipo',
      grade: '中改',
      status: '暂停',
      phases: [
        { idx: 0, name: '动力包换装', status: '完工', queue_index: null },
        { idx: 1, name: '全车数字化', status: '暂停', queue_index: null },
        { idx: 2, name: '归族同批验收', status: '未启动', queue_index: null },
      ],
      outcome: { type: 'mark' },
      schema_version: 1,
    },
    {
      id: 'proj:多功能步兵车现代化改装工程@yunxi',
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

const app = createApp({
  render() {
    return [h(ModalEngineering, { open: true, snapshot, onClose: () => {} }), h(DetailDrawer)];
  },
});
app.use(pinia);
app.mount(document.getElementById('app') ?? document.body);

const catalog = useCatalogStore(pinia);
void catalog.init();

/* ══ 证据采集自动驱动（仅预览脚手架，?demo=<场景>；真实点击链路，零捷径） ══
 * - initiate：点击 eng-info 底部立项令按钮 → 指令填入模拟宿主 #send_textarea；
 * - drawer：点击「进行中」灰熊工程卡片 → DetailDrawer 四令按钮组（注资/暂停/取消可用，恢复禁用）；
 * - confirm：drawer 基础上点击「取消工程」→ 二次确认弹层（§3.3 结算文案）；
 * - cancel-fill：confirm 基础上点击「确认下达取消令」→ 取消令填入输入栏、抽屉关闭；
 * - fund-fill：drawer 基础上点击「注资下一阶段」→ 注资令填入输入栏。
 */
const demo = new URLSearchParams(location.search).get('demo');

function clickByText(selector: string, text: string): boolean {
  const el = [...document.querySelectorAll<HTMLElement>(selector)].find(e =>
    (e.textContent ?? '').includes(text),
  );
  el?.click();
  return !!el;
}

if (demo) {
  // 无头截图确定性：演示模式禁用过渡动画（避免截图落在 Transition 中间态）
  const st = document.createElement('style');
  st.textContent = '* { transition: none !important; animation: none !important; }';
  document.head.appendChild(st);
  const steps: Record<string, Array<() => boolean | undefined>> = {
    initiate: [() => clickByText('.eng-initiate-btn', '立项指令')],
    drawer: [() => clickByText('.eng-card', '灰熊坦克现代化改装工程')],
    confirm: [
      () => clickByText('.eng-card', '灰熊坦克现代化改装工程'),
      () => clickByText('.eng-cmd-btn', '取消工程'),
    ],
    'cancel-fill': [
      () => clickByText('.eng-card', '灰熊坦克现代化改装工程'),
      () => clickByText('.eng-cmd-btn', '取消工程'),
      () => clickByText('.eng-cmd-btn', '确认下达取消令'),
    ],
    'fund-fill': [
      () => clickByText('.eng-card', '灰熊坦克现代化改装工程'),
      () => clickByText('.eng-cmd-btn', '注资下一阶段'),
    ],
  };
  const chain = steps[demo] ?? [];
  chain.forEach((run, i) => {
    setTimeout(run, 1200 + i * 600); // 等目录初始化与各段渲染
  });
  // DOM 断言摘要写入 title，供无头采集核对（证据文本化）
  setTimeout(() => {
    const ta = document.querySelector<HTMLTextAreaElement>('#send_textarea');
    document.title = `ENG-UI-03 demo=${demo} textarea=${JSON.stringify(ta?.value ?? '')}`;
  }, 1200 + chain.length * 600 + 400);
}
