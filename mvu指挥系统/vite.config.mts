import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import AutoImport from 'unplugin-auto-import/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'vite-preview'),
  plugins: [
    vue(),
    AutoImport({
      imports: [
        'vue',
        'pinia',
        '@vueuse/core',
        { lodash: [['default', '_']] },
        { zod: ['z'] },
      ],
      dts: false,
    }),
  ],
  resolve: {
    alias: {
      '@util': fileURLToPath(new URL('./util', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  test: {
    setupFiles: [path.resolve(import.meta.dirname, 'src/红警指挥系统/fixtures/vitestCatalogSetup.ts')],
  },
  clearScreen: false,
});
