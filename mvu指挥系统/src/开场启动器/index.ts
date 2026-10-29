import App from './App.vue';
import './tailwind.entry.css';
import './global.css';

/**
 * 开场启动器入口（阶段 E 骨架）。
 *
 * 与红警指挥系统的关键差异：
 *  - 不等待 stat_data（启动器面向"未开局/归零"场景，无数据即正常态）
 *  - 不接解析管道事件（AI 回楼后由指挥系统 iframe 接管）
 *  - E 阶段不引入 pinia（空壳无跨组件状态；F 阶段按需评估）
 */

const in_tavern = typeof (window as { TavernHelper?: unknown }).TavernHelper !== 'undefined';

function mount() {
  createApp(App).mount('#app');
}

if (in_tavern) {
  // Tavern Helper 动态加载 HTML，遵循宿主 jQuery 就绪链（与指挥系统同惯例）
  $(errorCatched(mount));
} else {
  // Vite 开发预览：无酒馆宿主，直接挂载（App 内走模拟态）
  mount();
}
