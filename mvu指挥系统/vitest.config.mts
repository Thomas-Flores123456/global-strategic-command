import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// 批 A 纯函数管道回归：无酒馆依赖，仅 node 环境。
// setup.ts 在测试模块加载前注入全局 z/_/YAML（schema.ts、parsePipeline.ts 依赖这些 auto-import 全局）。
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@util': fileURLToPath(new URL('./util', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    setupFiles: [
      path.resolve(import.meta.dirname, 'src/红警指挥系统/__tests__/setup.ts'),
      path.resolve(import.meta.dirname, 'src/红警指挥系统/fixtures/vitestCatalogSetup.ts'),
    ],
    include: ['src/**/*.test.ts'],
  },
});

