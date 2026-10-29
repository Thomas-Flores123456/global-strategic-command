import { waitUntil } from 'async-wait-until';
import App from './ui/App.vue';
import './ui/tailwind.entry.css';
import './ui/global.css';
import { in_tavern } from './composables/store';

function mount() {
  createApp(App).use(createPinia()).mount('#app');
}

async function init() {
  if (in_tavern) {
    // 状态栏 store（util/mvu 的 defineMvuDataStore）不依赖 MVU 本体框架，
    // 只用 getVariables + schema.parse：stat_data 缺失时 schema 的 .default() 会补全整套数据。
    // 因此这里【不再硬等 window.Mvu】——那会在未装 MVU 的宿主里永久挂起、导致 #app 永不挂载（高度塌成 2px）。
    // 若当前楼已有 stat_data 则短暂等待其就位以避免初值闪烁；等不到（如空楼/纯实验环境）就直接用默认值挂载。
    await waitUntil(() => _.has(getVariables({ type: 'message' }), 'stat_data'), { timeout: 3000 }).catch(() => {
      // 超时属正常路径：无 stat_data 时用 schema 默认值挂载，store 之后会自动同步真实变量。
    });
  }
  mount();
}

if (in_tavern) {
  // Tavern Helper 通过动态加载HTML，不依赖 DOMContentLoaded；遵循宿主的 jQuery 就绪链。
  $(errorCatched(init));
} else {
  // Vite 开发预览：无酒馆宿主，直接使用 schema 默认假数据挂载。
  init().catch(error => console.error('[红警指挥系统] Vite预览挂载失败', error));
}
