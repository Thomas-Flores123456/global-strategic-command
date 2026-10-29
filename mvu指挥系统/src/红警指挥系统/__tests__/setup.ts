/**
 * vitest 全局注入：真机 iframe 由 unplugin-auto-import 把 z/_/YAML 提供为全局，
 * node 测试环境需在任何业务模块（schema.ts / parsePipeline.ts / util/common.ts）加载前手动挂载。
 * setupFiles 先于测试模块求值，故此处赋值后，全局 z/_/YAML 均就绪。
 */
import _ from 'lodash';
import { createPinia, defineStore } from 'pinia';
import { computed, reactive, ref, watch } from 'vue';
import * as YAML from 'yaml';
import { z } from 'zod';

(globalThis as Record<string, unknown>).z = z;
(globalThis as Record<string, unknown>)._ = _;
(globalThis as Record<string, unknown>).YAML = YAML;

// unplugin-auto-import 宏（真机构建时自动注入）：store.ts/useCatalog.ts 模块级依赖
(globalThis as Record<string, unknown>).defineStore = defineStore;
(globalThis as Record<string, unknown>).createPinia = createPinia;
(globalThis as Record<string, unknown>).ref = ref;
(globalThis as Record<string, unknown>).computed = computed;
(globalThis as Record<string, unknown>).reactive = reactive;
(globalThis as Record<string, unknown>).watch = watch;

// 最小 window 桩：模拟“浏览器但无酒馆宿主”（in_tavern=false）。
// store.ts:7 的 typeof (window).TavernHelper 不受 typeof 保护，node 裸环境下
// import('./store') / import('./useCatalog') 会整体抛——buildAuthority 回归依赖此桩。
// 注意：window.location 故意不提供，readDlcOverlays 非酒馆分支的 TypeError 属降级语义本身。
(globalThis as Record<string, unknown>).window ??= globalThis;

