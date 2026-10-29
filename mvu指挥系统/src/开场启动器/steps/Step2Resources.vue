<template>
  <div class="step2-resources">
    <!-- ══════════ 1. 难度档位 ══════════ -->
    <section class="wiz-section">
      <div class="wiz-sec-head">
        <div class="wiz-label">战役难度与资源配给档位</div>
        <span class="wiz-chip accent">
          折算后资金：{{ effective.credits }} · 暴露度：{{ effective.exposure }}
        </span>
      </div>

      <div class="opt-grid">
        <button
          v-for="p in DIFFICULTY_PRESETS"
          :key="p.id"
          type="button"
          class="opt-card preset-card"
          :class="{ sel: choices.preset === p.id }"
          :data-preset-id="p.id"
          :aria-pressed="choices.preset === p.id"
          @click="choices.preset = p.id"
        >
          <div class="opt-title">
            <span>{{ p.label }}</span>
            <span class="wiz-chip" :class="p.id === 'normal' ? 'rec' : ''">
              {{ p.id === 'custom' ? '自由调配' : `${p.credits} 资金` }}
            </span>
          </div>
          <div class="opt-flavor">
            {{
              p.id === 'custom'
                ? '初始资金 / 先发科技 / 暴露度 / 敌情态势均可自由调配'
                : p.techDone.length > 0
                  ? `开局赠送：${p.techDone.join('、')}${p.id === 'easy' ? ' + 1项自选T1' : ''}`
                  : '无开局赠送科技（硬核白手起家）'
            }}
          </div>
          <div v-if="p.narrativeSeed" class="preset-seed">态势：{{ p.narrativeSeed }}</div>
        </button>
      </div>
    </section>

    <!-- ══════════ 2. 轻松档额外福利 ══════════ -->
    <section v-if="choices.preset === 'easy'" class="wiz-section">
      <div class="wiz-sec-head">
        <div class="wiz-label">轻松档福利：自选一项 T1 研究（{{ POWER_TECH }} 之外）</div>
        <span class="wiz-chip rec">{{ choices.easyBonusTech || '暂未选择' }}</span>
      </div>
      <select v-model="choices.easyBonusTech" class="wiz-select">
        <option value="">—— 暂不选择 ——</option>
        <option v-for="name in bonusTechOptions" :key="name" :value="name">{{ name }}</option>
      </select>
    </section>

    <!-- ══════════ 3. 自定义档全量控制台 ══════════ -->
    <template v-if="choices.preset === 'custom'">
      <section class="wiz-section">
        <div class="wiz-sec-head">
          <div class="wiz-label">初始指挥部资金（基准值，多阵营并线时自动按倍率折算）</div>
          <div class="wiz-pill-bar" style="margin-bottom: 0">
            <button
              v-for="val in [1200, 2000, 3000, 5000, 10000]"
              :key="val"
              type="button"
              class="wiz-pill"
              :class="{ active: choices.customCredits === val }"
              @click="choices.customCredits = val"
            >
              {{ val }}
            </button>
          </div>
        </div>
        <div class="wiz-slider-row">
          <input v-model.number="choices.customCredits" type="range" min="0" max="10000" step="100" />
          <input
            v-model.number="choices.customCredits"
            type="number"
            min="0"
            max="50000"
            step="100"
            class="wiz-input num-direct"
          />
        </div>
      </section>

      <section class="wiz-section">
        <div class="wiz-sec-head">
          <div class="wiz-label">已解锁 T1 科技库（已选 {{ choices.customTech.length }} / {{ t1TechNames.length }} 项）</div>
          <div class="tech-toolbar">
            <input
              v-model="techQuery"
              type="text"
              class="wiz-input tech-search"
              placeholder="检索 T1 科技…"
            />
            <button type="button" class="wiz-pill" @click="selectOnlyPowerTech">仅选发电</button>
            <button type="button" class="wiz-pill" @click="selectAllT1Tech">全选</button>
            <button type="button" class="wiz-pill" @click="clearT1Tech">清空</button>
          </div>
        </div>
        <div class="wiz-check-list">
          <label
            v-for="name in filteredTechNames"
            :key="name"
            :title="name"
            :class="{ 'tech-checked': choices.customTech.includes(name) }"
          >
            <input v-model="choices.customTech" type="checkbox" :value="name" />
            <span>{{ name }}</span>
          </label>
        </div>
      </section>

      <section class="wiz-section">
        <div class="wiz-sec-head">
          <div class="wiz-label">初始暴露度基线（0 = 完全隐蔽，10 = 高危锁定）</div>
          <span class="wiz-chip" :class="choices.customExposure >= 5 ? 'warn' : 'rec'">
            基线 {{ choices.customExposure }} · 终值 {{ effective.exposure }}
          </span>
        </div>
        <div class="wiz-slider-row">
          <input v-model.number="choices.customExposure" type="range" min="0" max="10" step="1" />
          <span class="wiz-slider-val">{{ choices.customExposure }}</span>
        </div>
      </section>

      <section class="wiz-section">
        <div class="wiz-label">战区敌情与环境态势补充（可选）</div>
        <textarea
          v-model="choices.customSeed"
          class="wiz-textarea"
          placeholder="如：周边荒坂巡逻队活动频繁，初期资源补给线受阻……"
        ></textarea>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { RESEARCHES, T1_RESEARCH_NAMES } from '../../红警指挥系统/core/catalog';
import {
  dynamicCatalogSnapshot,
  ensureWorldbookCatalogLoaded,
  useCatalogStore,
} from '../../红警指挥系统/composables/useCatalog';
import { resolveDifficulty } from '../pipeline';
import {
  DIFFICULTY_PRESETS,
  FALLBACK_T1_TECH_NAMES,
  POWER_TECH,
  type LaunchChoices,
} from '../presets';

const choices = inject<LaunchChoices>('launchChoices')!;

let catalogStore: ReturnType<typeof useCatalogStore> | null = null;
try {
  catalogStore = useCatalogStore();
} catch {
  catalogStore = null;
}

const dynamicT1Names = ref<string[]>([]);

onMounted(async () => {
  try {
    const snap = await ensureWorldbookCatalogLoaded();
    if (snap?.researches?.length) {
      const list = snap.researches.filter(r => r.tier === 1).map(r => r.name);
      if (list.length > 0) dynamicT1Names.value = [...new Set(list)];
    }
  } catch {
    /* fallback to static T1 list */
  }
});

/** 全量 T1 研究名（优先从 ensureWorldbookCatalogLoaded / useCatalogStore 世界书动态目录筛选 tier === 1，其次回退 FALLBACK_T1_TECH_NAMES） */
const t1TechNames = computed<string[]>(() => {
  if (dynamicT1Names.value.length > 0) {
    return dynamicT1Names.value;
  }
  const storeResearches = catalogStore?.researches ?? dynamicCatalogSnapshot()?.researches ?? [];
  if (storeResearches.length > 0) {
    const t1FromStore = storeResearches.filter(r => r.tier === 1).map(r => r.name);
    if (t1FromStore.length > 0) return [...new Set(t1FromStore)];
  }
  if (RESEARCHES.length > 0) {
    const t1Static = RESEARCHES.filter(r => r.tier === 1).map(r => r.name);
    if (t1Static.length > 0) return t1Static;
  }
  if (T1_RESEARCH_NAMES.length > 0) {
    return [...T1_RESEARCH_NAMES];
  }
  return [...FALLBACK_T1_TECH_NAMES];
});

/** easy 自选下拉：排除已赠的 POWER_TECH */
const bonusTechOptions = computed(() => t1TechNames.value.filter(name => name !== POWER_TECH));

const techQuery = ref('');
const filteredTechNames = computed(() => {
  const q = techQuery.value.trim().toLowerCase();
  if (!q) return t1TechNames.value;
  return t1TechNames.value.filter(name => name.toLowerCase().includes(q));
});

const effective = computed(() => resolveDifficulty(choices));

function selectOnlyPowerTech() {
  choices.customTech = [POWER_TECH];
}

function selectAllT1Tech() {
  choices.customTech = [...t1TechNames.value];
}

function clearT1Tech() {
  choices.customTech = [];
}
</script>

<style scoped>
.preset-card {
  width: 100%;
  font: inherit;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.preset-seed {
  margin-top: 2px;
  font-size: 10.5px;
  font-family: var(--mono);
  color: var(--rac-accent);
}

.num-direct {
  width: 84px;
  text-align: right;
  font-family: var(--mono);
  padding: 5px 8px;
}

.tech-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.tech-search {
  width: 150px;
  padding: 4px 8px;
  font-size: 11.5px;
}

.tech-checked {
  border-color: var(--rac-accent) !important;
  background: rgba(56, 189, 248, 0.12) !important;
  color: var(--rac-hi);
}
</style>
