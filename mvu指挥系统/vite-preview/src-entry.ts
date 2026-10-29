/**
 * Vite 预览多入口：?entry=开场启动器 切启动器，默认红警指挥系统。
 * 动态 import 保证未选中的入口完全不加载（启动器不引 pinia/store）。
 */
const entry = new URLSearchParams(window.location.search).get('entry');

if (entry === '开场启动器') {
  document.title = '开场启动器 · Vite预览';
  await import('../src/开场启动器/index');
} else {
  await import('../src/红警指挥系统/index');
}
