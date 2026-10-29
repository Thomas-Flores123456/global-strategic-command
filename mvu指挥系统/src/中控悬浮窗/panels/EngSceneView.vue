<template>
  <div class="eng-scene-view" :class="{ 'eng-scene-view--rm': reducedMotion }">
    <div class="eng-scene-toolbar">
      <span class="eng-scene-title">{{ scene.title }}</span>
      <span class="eng-scene-source font-mono">{{ scene.source === 'worldbook' ? '世界书资产' : '内置通用场景' }}</span>
      <div class="eng-scene-views" role="tablist" aria-label="场景视角切换">
        <button
          v-for="v in views"
          :key="v.id"
          role="tab"
          class="eng-scene-view-tab"
          :class="{ 'eng-scene-view-tab--active': currentView === v.id }"
          :aria-selected="currentView === v.id"
          @click="currentView = v.id"
        >
          {{ v.label }}
        </button>
      </div>
    </div>
    <!-- 场景画布：v-html 挂载 renderSceneSvg 产出（资产条目已过 engScene fail-closed 消毒）；点击/键盘走事件代理 -->
    <div
      class="eng-scene-stage"
      @click="onSceneActivate"
      @keydown.enter.prevent="onSceneActivate"
      @keydown.space.prevent="onSceneActivate"
    >
      <!-- eslint-disable-next-line vue/no-v-html -- 场景 SVG 由 engScene.ts 消毒产出生成，热点交互零写操作 -->
      <div class="eng-scene-canvas" v-html="svgHtml" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import type { ProjectDef, RetrofitDef } from '../../红警指挥系统/core/catalog';
import type { Project } from '../../红警指挥系统/core/schema';
import { isProjectV1, isProjectV2 } from '../../红警指挥系统/core/schema';
import {
  defaultSceneId,
  hotspotFromDomTarget,
  hotspotStates,
  listViews,
  renderSceneSvg,
  resolveScene,
  type EngSceneDef,
  type EngSceneHotspotEvent,
} from '../models/engScene';
import { loadSceneAsset } from '../models/engSceneAsset';

/**
 * EngSceneView.vue —— ENG-UI-02 SVG 场景引擎组件（D18v2 / D22 / D23 / D24 / V2-06）
 * - 数据驱动：输入 { def.scene（场景 id，V2-06 接通 catalog project def.scene 透传）, project.phases|modules }，输出渲染；
 * - 世界书禁用资产条目（⚠SVG资产·<工程名>·勿启用）优先（按 scene id 跨书路由，V2-06），
 *   读不到 → 注册表兑底解析（resolveScene，未配内置 → 通用车间，fail-closed）；
 * - 多视角 = 单 SVG 分层 <g data-view>，视角切换纯 UI 状态；热点点击 emit hotspot-info 给父级弹信息（纯读取，D24）；
 * - V2 工程实例（schema_version=2）传入时模块热点按 modules[].status 同 phase 色板着色（V2-06）。
 */

const props = defineProps<{
  def: RetrofitDef | ProjectDef;
  /** 选中工程的驱动实例（V1=phases / V2=modules 点亮热点）；null = 全中立 idle */
  project: Project | null;
  /** 预览证据钩子：强制 reduced-motion 降级态（真机由 matchMedia 自动探测） */
  forceReducedMotion?: boolean;
  /** 初始/偏好视角 id（存在于当前场景 views 中时优先采用，未传或未知时回退首个视角） */
  initialView?: string;
}>();

const emit = defineEmits<{
  (e: 'hotspot-info', payload: EngSceneHotspotEvent): void;
}>();

const sceneId = computed(() => defaultSceneId(props.def.scene));

function resolveToBuiltin(): EngSceneDef {
  // 注册表兑底解析（V2-06 接通 def.scene）：未注册/未配内置 → 通用车间（fail-closed，D23）
  return resolveScene(sceneId.value);
}

function pickInitialView(target: EngSceneDef, preferred = props.initialView): string {
  if (preferred && target.views.some(v => v.id === preferred)) {
    return preferred;
  }
  return target.views[0]?.id ?? 'overview';
}

/** 首帧同步给内置场景（SSR/预览零闪烁），世界书资产异步到位后热替换 */
const scene = shallowRef<EngSceneDef>(resolveToBuiltin());
const currentView = ref(pickInitialView(scene.value));

const views = computed(() => listViews(scene.value));
const states = computed(() => {
  const project = props.project;
  // V2 实例（schema_version=2）：模块热点按 modules[].status 着色；V1/无实例：phases 驱动（同旧口径）
  if (project && isProjectV2(project)) return hotspotStates(scene.value, [], project.modules);
  return hotspotStates(scene.value, project && isProjectV1(project) ? project.phases : []);
});
const svgHtml = computed(() => renderSceneSvg(scene.value, currentView.value, states.value));

/* 世界书资产加载：fail-closed，条目缺失/畸形/API 不可用 → 保持内置回退，零报错；V2-06 按 scene id 跨书路由探测 */
let loadToken = 0;
async function tryLoadAsset() {
  const token = ++loadToken;
  const asset = await loadSceneAsset(props.def.name, undefined, sceneId.value);
  if (token !== loadToken || !asset) return; // 竞态守卫：选中项已切换则丢弃
  scene.value = asset;
  currentView.value = pickInitialView(asset);
}

onMounted(tryLoadAsset);
watch(
  () => [props.def.name, sceneId.value] as const,
  () => {
    scene.value = resolveToBuiltin();
    currentView.value = pickInitialView(scene.value);
    void tryLoadAsset();
  },
);
watch(
  () => props.initialView,
  nextView => {
    if (nextView && scene.value.views.some(v => v.id === nextView)) {
      currentView.value = nextView;
    }
  },
);

/** reduced-motion：prop 强制（预览证据）或系统偏好自动探测（SSR 安全） */
const reducedMotion = computed(
  () =>
    props.forceReducedMotion === true ||
    (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches),
);

/** 事件代理：点击/键盘命中最近命名热点节点 → emit 纯读取信息（解析路径与测试 DOM shim 同构，D24；场景内写操作走 §3.8 指令闭环，归 ENG-UI-03） */
function onSceneActivate(e: Event) {
  const payload = hotspotFromDomTarget(e.target as Element | null, scene.value, states.value);
  if (payload) emit('hotspot-info', payload);
}
</script>

<style scoped>
.eng-scene-view {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.eng-scene-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--rac-dim, #2c3b40);
  background: var(--rac-panel, #0c1113);
}

.eng-scene-title {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--rac-text, #cfdde0);
}

.eng-scene-source {
  font-size: 8.5px;
  letter-spacing: 0.08em;
  color: var(--rac-muted, #8aa1a7);
}

.eng-scene-views {
  margin-left: auto;
  display: inline-flex;
  gap: 2px;
}

.eng-scene-view-tab {
  padding: 2px 8px;
  font-size: 9.5px;
  letter-spacing: 0.05em;
  color: var(--rac-muted, #8aa1a7);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 2px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.eng-scene-view-tab:hover {
  color: var(--rac-hi, #d4e3e6);
  background: var(--rac-panel-2, #0f1619);
}

.eng-scene-view-tab--active {
  color: var(--rac-hi, #d4e3e6);
  border-color: var(--rac-line, #5f7c84);
  background: var(--rac-panel-2, #0f1619);
}

.eng-scene-view-tab:focus-visible {
  outline: 1px solid var(--rac-focus, var(--rac-accent));
  outline-offset: 1px;
}

.eng-scene-stage {
  background: var(--rac-bg, #080a0b);
}

.eng-scene-canvas {
  line-height: 0;
}

@media (prefers-reduced-motion: reduce) {
  .eng-scene-view-tab {
    transition: none;
  }
}
</style>

<!-- 注入 SVG 的内部样式（v-html 内容不受 scoped 覆盖；全部以 .eng-scene-view 前缀限域） -->
<style>
.eng-scene-view .eng-scene-svg {
  display: block;
  width: 100%;
  height: auto;
}

.eng-scene-view .sc-title {
  fill: #5f7c84;
  font-size: 11px;
  letter-spacing: 0.12em;
}

.eng-scene-view .sc-label {
  fill: #8aa1a7;
  font-size: 9px;
}

.eng-scene-view .sc-dim-label {
  fill: #2c3b40;
  font-size: 8.5px;
  letter-spacing: 0.08em;
}

/* ── 热点状态着色（点亮/置灰由 projects[].phases 驱动，class 由 renderSceneSvg 注入） ── */
.eng-scene-view .eng-hs {
  cursor: pointer;
  outline: none;
}

.eng-scene-view .hs-halo {
  stroke: #5f7c84;
}

.eng-scene-view .hs-core {
  fill: #5f7c84;
}

.eng-scene-view .hs-label {
  fill: #8aa1a7;
  font-size: 9.5px;
}

.eng-scene-view .eng-hs--idle {
  opacity: 0.6;
}

.eng-scene-view .eng-hs--pending {
  opacity: 0.4;
}

.eng-scene-view .eng-hs--active .hs-halo {
  stroke: #d2ad69;
  animation: eng-hs-pulse 2s ease-in-out infinite;
}

.eng-scene-view .eng-hs--active .hs-core {
  fill: #d2ad69;
}

.eng-scene-view .eng-hs--active .hs-label {
  fill: #d2ad69;
}

.eng-scene-view .eng-hs--paused .hs-halo {
  stroke: #d2ad69;
  stroke-dasharray: 3 3;
}

.eng-scene-view .eng-hs--paused .hs-core {
  fill: #d2ad69;
}

.eng-scene-view .eng-hs--done .hs-halo {
  stroke: #78b69b;
}

.eng-scene-view .eng-hs--done .hs-core {
  fill: #78b69b;
}

.eng-scene-view .eng-hs--done .hs-label {
  fill: #78b69b;
}

.eng-scene-view .eng-hs:hover .hs-halo,
.eng-scene-view .eng-hs:focus-visible .hs-halo {
  stroke: #38bdf8;
  stroke-width: 2.5;
}

@keyframes eng-hs-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

/* 动效降级（§3.7 红线）：系统偏好 + prop 强制双通道 */
@media (prefers-reduced-motion: reduce) {
  .eng-scene-view .hs-halo {
    animation: none !important;
  }

  .eng-scene-view .eng-scene-svg * {
    transition: none !important;
  }
}

.eng-scene-view--rm .hs-halo {
  animation: none !important;
}

.eng-scene-view--rm .eng-scene-svg * {
  transition: none !important;
}
</style>
