<template>
  <div class="step0-world">
    <!-- ══════════ 1. 战区选择矩阵（具象世界 + 经典战区紧凑同屏） ══════════ -->
    <section class="wiz-section compact-sec">
      <div class="wiz-sec-head">
        <div class="wiz-label">具象世界 · CONCRETE WORLDS（全景设定 · 全球战区 · 多时代演进）</div>
        <span class="wiz-chip rec">★ 首选推荐</span>
      </div>

      <div class="concrete-grid">
        <button
          v-for="world in concreteWorlds"
          :key="world.world_id"
          type="button"
          class="opt-card world-card concrete-card"
          :class="{ sel: choices.worldId === world.world_id }"
          :disabled="importLocked"
          :aria-pressed="choices.worldId === world.world_id"
          :data-world-id="world.world_id"
          @click="selectWorld(world.world_id)"
        >
          <div class="world-top-bar">
            <span class="wiz-chip rec">{{ world.badge || '具象世界 · 首选推荐' }}</span>
            <span class="wiz-chip accent">63条全景世界书 · 11+1全球部署区</span>
          </div>

          <div class="opt-title world-hero-title">
            <span>{{ world.display_name }}</span>
            <span v-if="choices.worldId === world.world_id" class="sel-indicator">● 当前锁定战区</span>
          </div>

          <p class="opt-flavor world-baseline">{{ world.technology_baseline }}</p>
        </button>
      </div>
    </section>

    <section class="wiz-section compact-sec">
      <div class="wiz-sec-head">
        <div class="wiz-label">经典与平行战区 · CLASSIC THEATRES</div>
        <span class="wiz-chip">独立战区档案 · 存档兼容</span>
      </div>

      <div class="opt-grid classic-grid">
        <button
          v-for="world in classicWorlds"
          :key="world.world_id"
          type="button"
          class="opt-card world-card classic-card"
          :class="{ sel: choices.worldId === world.world_id }"
          :disabled="importLocked"
          :aria-pressed="choices.worldId === world.world_id"
          :data-world-id="world.world_id"
          @click="selectWorld(world.world_id)"
        >
          <div class="world-top-bar">
            <span class="wiz-chip">{{ world.badge || '经典战区' }}</span>
            <span class="wiz-chip">{{ world.calendar.sample }}</span>
          </div>
          <div class="opt-title">
            <span>{{ world.display_name }}</span>
            <span v-if="choices.worldId === world.world_id" class="sel-indicator">● 已选</span>
          </div>
          <p class="opt-flavor classic-flavor">{{ world.technology_baseline }}</p>
        </button>
      </div>
    </section>

    <!-- ══════════ 2. 当前锁定战区深度情报档案（Master-Detail 联动） ══════════ -->
    <section v-if="currentWorld" class="world-dossier-box">
      <div class="dossier-head">
        <span>▚ 当前锁定战区参数 · {{ currentWorld.display_name }}</span>
        <span class="wiz-chip accent">{{ currentWorld.calendar.label }}</span>
      </div>

      <div class="world-feature-strip">
        <div class="wf-item">
          <span class="wf-k">默认开局纪年</span>
          <span class="wf-v">
            {{
              currentWorld.category === 'concrete'
                ? '2042 · 血色拓荒与静默渗透（支持 2042 / 2045 / 2069 / 2077 四档切换）'
                : currentWorld.calendar.sample
            }}
          </span>
        </div>
        <div class="wf-item">
          <span class="wf-k">合法结算货币</span>
          <span class="wf-v">{{ currentWorld.currencies.join(' / ') }}</span>
        </div>
        <div class="wf-item">
          <span class="wf-k">本土特色技术</span>
          <span class="wf-v">{{ currentWorld.local_import_tracks.join(' · ') || '待勘探' }}</span>
        </div>
        <div class="wf-item">
          <span class="wf-k">主要观察者</span>
          <span class="wf-v">{{ currentWorld.observers.join('、') }}</span>
        </div>
      </div>
    </section>

    <div v-if="importLocked" class="wiz-desc-preview world-lock">
      🔒 已载入继承存档：世界锁定为「{{ currentWorld?.display_name ?? choices.worldId }}」。如需另选世界，请在顶部状态条点击「✕ 清除存档继承」。
    </div>
  </div>
</template>

<script setup lang="ts">
import { WORLD_MANIFESTS } from '../../红警指挥系统/core/worlds';
import {
  defaultDateForWorld,
  eraPresetsForWorld,
  findLocation,
  type LaunchChoices,
} from '../presets';

const choices = inject<LaunchChoices>('launchChoices')!;
const allWorlds = Object.values(WORLD_MANIFESTS);
const concreteWorlds = computed(() => allWorlds.filter(w => w.category === 'concrete'));
const classicWorlds = computed(() => allWorlds.filter(w => w.category !== 'concrete'));
const importLocked = computed(() => choices.importedStat !== null);
const currentWorld = computed(() => WORLD_MANIFESTS[choices.worldId]);

function selectWorld(worldId: string) {
  if (importLocked.value || worldId === choices.worldId) return;
  const firstLocation = findLocation('', worldId);
  const firstEra = eraPresetsForWorld(worldId)[0];
  choices.worldId = worldId;
  choices.locationId = firstLocation.id;
  choices.eraPresetId = firstEra?.id ?? '';
  choices.date = firstEra?.defaultDate ?? defaultDateForWorld(worldId);
}
</script>

<style scoped>
.compact-sec {
  margin-bottom: 10px;
}

.world-card {
  width: 100%;
  color: inherit;
  font: inherit;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.concrete-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}

.concrete-card {
  padding: 10px 12px;
}

.classic-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.classic-card {
  padding: 8px 10px;
}

.classic-flavor {
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.world-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
}

.world-hero-title {
  font-size: 14.5px;
  letter-spacing: 0.03em;
}

.sel-indicator {
  font-size: 11px;
  font-family: var(--mono);
  color: var(--rac-ok);
  font-weight: 600;
}

.world-baseline {
  margin: 0;
  color: var(--rac-text);
  font-size: 11.5px;
  line-height: 1.45;
}

.world-dossier-box {
  padding: 9px 12px;
  border-radius: 6px;
  border: 1px solid var(--rac-dim);
  background: var(--rac-panel-2);
}

.dossier-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  font-family: var(--mono);
  font-weight: 700;
  color: var(--rac-hi);
  padding-bottom: 6px;
  margin-bottom: 6px;
  border-bottom: 1px dashed var(--rac-dim);
}

.world-feature-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 6px 12px;
}

.wf-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
}

.wf-k {
  color: var(--rac-muted);
  font-size: 10px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.wf-v {
  color: var(--rac-hi);
  line-height: 1.4;
}

.world-lock {
  margin-top: 8px;
  color: var(--rac-warn);
  border-color: rgba(210, 173, 105, 0.45);
}

@media (max-width: 760px) {
  .classic-grid {
    grid-template-columns: 1fr;
  }
}
</style>
