<template>
  <div class="step1-identity">
    <!-- ══════════ 1. 参战阵营编成（紧凑横向三席） ══════════ -->
    <section class="wiz-section compact-sec">
      <div class="wiz-sec-head">
        <div class="wiz-label">参战阵营编成（可多选 1~3 席，第 1 顺位为主阵营并决定 HUD 主题色）</div>
        <span class="wiz-chip accent">已选 {{ selectedList.length }} / 3 席</span>
      </div>

      <div class="opt-grid faction-grid">
        <button
          v-for="f in FACTION_OPTIONS"
          :key="f.id"
          type="button"
          class="opt-card faction-card"
          :class="{ sel: isFactionSelected(f.id), dis: !f.available }"
          :data-faction-id="f.id"
          :aria-pressed="isFactionSelected(f.id)"
          @click="toggleFaction(f)"
        >
          <div class="opt-title">
            <span>{{ f.name }}</span>
            <span v-if="factionOrderLabel(f.id)" class="wiz-chip" :class="isPrimaryFaction(f.id) ? 'rec' : 'warn'">
              {{ factionOrderLabel(f.id) }}
            </span>
            <span v-if="!f.available" class="opt-note">{{ f.note }}</span>
          </div>
          <div class="opt-flavor faction-flavor">{{ f.flavor }}</div>
          <div class="faction-mcv-line">
            <span>{{ starterMcv(f.id)?.vehicleName ?? `MCV（${f.name}）` }}</span>
            <span v-if="starterMcv(f.id)?.girlName">· 机娘：{{ starterMcv(f.id)?.girlName }}</span>
          </div>
        </button>
      </div>

      <!-- 多阵营并线高压代价预警横幅（紧凑条 + 可展开明细） -->
      <div v-if="selectedList.length >= 2" class="multi-faction-banner" data-testid="multi-faction-warning">
        <div class="banner-top-row">
          <div class="banner-head">
            ⚠ {{ selectedList.length === 2 ? '双阵营并线高压预警' : '三阵营全开极限高压预警' }}
          </div>
          <div class="banner-kpis">
            <span class="wiz-chip warn">资金 ×{{ impact.creditsMultiplier }}（{{ impact.credits }}）</span>
            <span class="wiz-chip warn">暴露 +{{ impact.exposureDelta }}（终值 {{ impact.exposure }}）</span>
            <button type="button" class="banner-fold-btn" @click="showPenaltyDetail = !showPenaltyDetail">
              {{ showPenaltyDetail ? '▴ 收起磨合明细' : '▾ 查看 15 日磨合明细' }}
            </button>
          </div>
        </div>
        <div v-if="showPenaltyDetail" class="banner-detail">
          <div><strong>15日跨系磨合代价：</strong>{{ penaltySummaryText }}</div>
          <div><strong>联合作战档案：</strong>同步启用 {{ selectedFactionNames }} 阵营军工图谱与最高统帅部条令库</div>
        </div>
      </div>
    </section>

    <!-- ══════════ 2 & 3. 战区落点 / 纪年时间点 子视图切换器 ══════════ -->
    <div class="subview-bar" role="tablist" aria-label="部署坐标与纪年切换">
      <button
        type="button"
        class="subview-tab"
        :class="{ active: subTab === 'location' }"
        role="tab"
        :aria-selected="subTab === 'location'"
        @click="subTab = 'location'"
      >
        <span class="subview-k">📍 拟定战区落点</span>
        <span class="subview-v">{{ currentLocationObj.name }}</span>
      </button>
      <button
        type="button"
        class="subview-tab"
        :class="{ active: subTab === 'era' }"
        role="tab"
        :aria-selected="subTab === 'era'"
        @click="subTab = 'era'"
      >
        <span class="subview-k">⏱ 开局时间与时代态势</span>
        <span class="subview-v">{{ choices.date || datePlaceholder }}</span>
      </button>
      <button
        type="button"
        class="subview-mode-btn"
        :class="{ active: subTab === 'both' }"
        title="同屏展开落点与纪年"
        @click="subTab = subTab === 'both' ? 'location' : 'both'"
      >
        {{ subTab === 'both' ? '⊟ 分页聚焦' : '⊞ 同屏展开' }}
      </button>
    </div>

    <!-- ══════════ 2. 全球与战区部署地点（左紧凑坐标芯片 + 右选中落点战术简报 Master-Detail） ══════════ -->
    <section v-if="subTab === 'location' || subTab === 'both'" class="wiz-section compact-sec">
      <div v-if="regionOptions.length > 1" class="wiz-pill-bar compact-pills" role="tablist" aria-label="全球战区筛选">
        <button
          type="button"
          class="wiz-pill"
          :class="{ active: activeRegion === 'ALL' }"
          @click="activeRegion = 'ALL'"
        >
          全部 ({{ locations.length }})
        </button>
        <button
          v-for="reg in regionOptions"
          :key="reg"
          type="button"
          class="wiz-pill"
          :class="{ active: activeRegion === reg }"
          @click="activeRegion = reg"
        >
          {{ reg }}
        </button>
      </div>

      <div class="loc-master-detail">
        <!-- 左栏：高密度紧凑坐标名录（点击即在右侧预览完整地貌与态势） -->
        <div class="loc-compact-grid" role="listbox" aria-label="可选战区落点列表">
          <button
            v-for="l in filteredLocations"
            :key="l.id"
            type="button"
            class="loc-chip-btn"
            :class="{ sel: choices.locationId === l.id }"
            :data-location-id="l.id"
            :aria-selected="choices.locationId === l.id"
            @click="selectLocation(l.id)"
          >
            <div class="loc-chip-top">
              <span class="loc-chip-name">{{ l.name }}</span>
              <span v-if="l.recommended" class="mini-tag rec">★推荐</span>
              <span v-else-if="l.isCustom" class="mini-tag accent">✎自定</span>
            </div>
            <div class="loc-chip-sub">
              <span>{{ l.region || '全球战区' }}</span>
              <span v-if="l.densityTag" class="loc-chip-density">· {{ l.densityTag }}</span>
            </div>
          </button>
        </div>

        <!-- 右栏：当前锁定落点战术简报 / 自定义坐标录入 -->
        <div class="loc-detail-pane">
          <div class="loc-detail-head">
            <div class="loc-chips">
              <span v-if="currentLocationObj.recommended" class="wiz-chip rec">★ 默认推荐</span>
              <span v-if="currentLocationObj.isCustom" class="wiz-chip accent">✎ 自由勘定</span>
              <span v-if="currentLocationObj.region" class="wiz-chip">{{ currentLocationObj.region }}</span>
              <span v-if="currentLocationObj.densityTag" class="wiz-chip">{{ currentLocationObj.densityTag }}</span>
            </div>
            <div class="loc-detail-title">{{ currentLocationObj.name }}</div>
            <div class="loc-coord">{{ currentLocationObj.location }}</div>
          </div>

          <p class="loc-detail-flavor">{{ currentLocationObj.flavor }}</p>

          <!-- 自定义部署点输入框组 -->
          <div v-if="choices.locationId === 'custom'" class="custom-loc-box" data-testid="custom-location-panel">
            <div class="custom-loc-title">✎ 自定义部署点勘定档案（待 MCV 展开后正式建基地）</div>
            <div class="custom-loc-grid">
              <label class="custom-field">
                <span>基地代号 / 名称</span>
                <input
                  v-model="choices.customLocationName"
                  class="wiz-input"
                  type="text"
                  placeholder="如：第七极地前哨 / 内罗毕外围掩体"
                />
              </label>
              <label class="custom-field">
                <span>所在全球区域 / 地理坐标</span>
                <input
                  v-model="choices.customLocationRegion"
                  class="wiz-input"
                  type="text"
                  placeholder="如：南极洲·麦克默多解冻谷地"
                />
              </label>
            </div>
            <label class="custom-field" style="margin-top: 6px">
              <span>周边环境、掩护条件与当地势力态势（可选）</span>
              <textarea
                v-model="choices.customLocationFlavor"
                class="wiz-textarea compact-textarea"
                placeholder="描述该部署点的地形掩护、资源分布与周边潜伏风险……"
              ></textarea>
            </label>
          </div>
          <div v-else class="loc-detail-foot">
            <span>📍 开局 MCV 车载待命 · 展开后于此坐标正式建立首座基地</span>
            <button
              v-if="subTab === 'location'"
              type="button"
              class="link-step-btn"
              @click="subTab = 'era'"
            >
              下一步：确认开局纪年 ({{ choices.date || datePlaceholder }}) →
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- ══════════ 3. 开局纪年预设与精确日期（横向时间轴 + 单卡态势简报，消除重复文本） ══════════ -->
    <section v-if="subTab === 'era' || subTab === 'both'" class="wiz-section compact-sec">
      <div class="era-top-layout">
        <div v-if="eraPresets.length > 0" class="era-timeline-bar" role="radiogroup" aria-label="时代预设">
          <button
            v-for="era in eraPresets"
            :key="era.id"
            type="button"
            class="era-pill-card"
            :class="{ sel: activeEraId === era.id }"
            :data-era-id="era.id"
            :aria-pressed="activeEraId === era.id"
            @click="selectEraPreset(era.id)"
          >
            <div class="era-pill-top">
              <span class="wiz-chip" :class="era.recommended ? 'rec' : 'accent'">{{ era.shortTag }}</span>
              <span class="era-pill-date">{{ era.defaultDate }}</span>
            </div>
            <div class="era-pill-title">{{ era.label }}</div>
          </button>
        </div>

        <label class="custom-field date-inline-field">
          <span>精确开局历法 / 日期（可自由微调年月日）</span>
          <input v-model="choices.date" class="wiz-input" type="text" :placeholder="datePlaceholder" />
        </label>
      </div>

      <!-- 单一联动时代态势档案框（合并纪年摘要与态势基准，不再上下重复两遍） -->
      <div v-if="activeEraObj || eraDirectivePreview" class="wiz-desc-preview era-directive-box">
        <div v-if="activeEraObj" class="era-box-head">
          <strong>{{ activeEraObj.label }}</strong>
          <span>{{ activeEraObj.summary }}</span>
        </div>
        <div v-if="eraDirectivePreview" class="era-box-directive">{{ eraDirectivePreview }}</div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import {
  computeMultiFactionLaunchImpact,
  defaultDateForWorld,
  defaultFactionAdjutantFor,
  eraPresetsForWorld,
  FACTION_OPTIONS,
  findEraPreset,
  findFaction,
  findLocation,
  findPreset,
  locationsForWorld,
  resolveEraDirectiveForChoices,
  resolveSelectedFactions,
  resolveStarterMcvInfo,
  type FactionOption,
  type LaunchChoices,
} from '../presets';

const choices = inject<LaunchChoices>('launchChoices')!;
const locations = computed(() => locationsForWorld(choices.worldId));
const eraPresets = computed(() => eraPresetsForWorld(choices.worldId));
const datePlaceholder = computed(() => defaultDateForWorld(choices.worldId));

const subTab = ref<'location' | 'era' | 'both'>('location');
const showPenaltyDetail = ref(false);
const activeRegion = ref<string>('ALL');

watch(
  () => choices.worldId,
  () => {
    activeRegion.value = 'ALL';
  },
);

const regionOptions = computed(() => {
  const set = new Set<string>();
  for (const loc of locations.value) {
    if (loc.region) set.add(loc.region);
  }
  return [...set];
});

const filteredLocations = computed(() => {
  if (activeRegion.value === 'ALL') return locations.value;
  return locations.value.filter(l => l.region === activeRegion.value || l.id === choices.locationId);
});

const currentLocationObj = computed(() => findLocation(choices.locationId, choices.worldId));

const activeEraId = computed(() => {
  const dateStr = (choices.date ?? '').trim();
  const m = /^(\d{4})\b/.exec(dateStr);
  if (m) {
    const y = Number(m[1]);
    if (y <= 2043) return '2042';
    if (y <= 2059) return '2045';
    if (y <= 2072) return '2069';
    return '2077';
  }
  return choices.eraPresetId || '2042';
});

const activeEraObj = computed(() => findEraPreset(activeEraId.value, choices.worldId));
const eraDirectivePreview = computed(() => resolveEraDirectiveForChoices(choices));

function selectLocation(locationId: string) {
  choices.locationId = locationId;
}

function selectEraPreset(eraId: string) {
  const preset = findEraPreset(eraId, choices.worldId);
  if (!preset) return;
  choices.eraPresetId = preset.id;
  choices.date = preset.defaultDate;
}

function starterMcv(factionId: string) {
  return resolveStarterMcvInfo(factionId);
}

const selectedList = computed(() => resolveSelectedFactions(choices));

const baseDifficultyCredits = computed(() => {
  const preset = findPreset(choices.preset);
  return preset.id === 'custom' ? choices.customCredits : preset.credits;
});

const baseDifficultyExposure = computed(() => {
  const preset = findPreset(choices.preset);
  return preset.id === 'custom' ? choices.customExposure : preset.exposure;
});

const impact = computed(() =>
  computeMultiFactionLaunchImpact(
    selectedList.value,
    baseDifficultyCredits.value,
    baseDifficultyExposure.value,
    choices.factionAdjutants,
  ),
);

const penaltySummaryText = computed(
  () => impact.value.breakInPenalties.map(p => `${p.name}（${p.reason}）`).join('；') || '无',
);

const selectedFactionNames = computed(() =>
  selectedList.value.map(id => findFaction(id).name).join(' + '),
);

function isFactionSelected(factionId: string): boolean {
  return selectedList.value.includes(factionId);
}

function isPrimaryFaction(factionId: string): boolean {
  return selectedList.value[0] === factionId;
}

function factionOrderLabel(factionId: string): string {
  const idx = selectedList.value.indexOf(factionId);
  if (idx === 0) return '主阵营 · 主题基准';
  if (idx > 0) return `辅阵营 #${idx}`;
  return '';
}

function toggleFaction(f: FactionOption) {
  if (!f.available) return;
  const current = [...selectedList.value];
  const idx = current.indexOf(f.id);
  if (idx >= 0) {
    if (current.length <= 1) return;
    current.splice(idx, 1);
  } else {
    if (current.length >= 3) return;
    current.push(f.id);
    if (!choices.factionAdjutants) {
      choices.factionAdjutants = {};
    }
    if (!choices.factionAdjutants[f.id]) {
      choices.factionAdjutants[f.id] = defaultFactionAdjutantFor(f.id);
    }
  }
  choices.selectedFactions = current;
  choices.factionId = current[0] ?? 'allied';
}
</script>

<style scoped>
.compact-sec {
  margin-bottom: 10px;
}

.faction-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.faction-card {
  width: 100%;
  font: inherit;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.faction-flavor {
  font-size: 11px;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.faction-card:hover .faction-flavor,
.faction-card.sel .faction-flavor {
  -webkit-line-clamp: 2;
}

.faction-mcv-line {
  margin-top: 2px;
  padding-top: 4px;
  border-top: 1px dashed var(--rac-dim);
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 10.5px;
  font-family: var(--mono);
  color: var(--rac-accent);
}

/* ── 多阵营紧凑预警横幅 ── */
.multi-faction-banner {
  margin-top: 8px;
  padding: 7px 10px;
  border: 1px solid rgba(210, 173, 105, 0.55);
  border-left: 3px solid var(--rac-warn);
  border-radius: 6px;
  background: rgba(210, 173, 105, 0.08);
  font-size: 11.5px;
}

.banner-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.banner-head {
  font-weight: 700;
  color: var(--rac-warn);
  font-size: 12px;
}

.banner-kpis {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.banner-fold-btn {
  background: transparent;
  border: 1px solid rgba(210, 173, 105, 0.45);
  color: var(--rac-warn);
  border-radius: 4px;
  padding: 2px 7px;
  font-size: 10.5px;
  cursor: pointer;
}

.banner-detail {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed rgba(210, 173, 105, 0.35);
  color: var(--rac-text);
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

/* ── 子视图切换器（落点 ↔ 纪年） ── */
.subview-bar {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 7px;
  margin-bottom: 10px;
}

.subview-tab {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 11px;
  border-radius: 6px;
  border: 1px solid var(--rac-dim);
  background: var(--rac-panel);
  color: var(--rac-muted);
  cursor: pointer;
  text-align: left;
  transition: all 0.14s ease;
}

.subview-tab:hover {
  border-color: var(--rac-line);
  color: var(--rac-hi);
}

.subview-tab.active {
  border-color: var(--rac-accent);
  background: var(--rac-panel-2);
  color: var(--rac-hi);
  box-shadow: inset 0 2px 0 0 var(--rac-accent);
}

.subview-k {
  font-size: 11.5px;
  font-weight: 600;
}

.subview-v {
  font-size: 11px;
  font-family: var(--mono);
  color: var(--rac-accent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subview-mode-btn {
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--rac-dim);
  background: var(--rac-panel);
  color: var(--rac-muted);
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}

.subview-mode-btn.active,
.subview-mode-btn:hover {
  border-color: var(--rac-accent);
  color: var(--rac-hi);
}

/* ── 落点 Master-Detail 主从双栏 ── */
.compact-pills {
  margin-bottom: 8px;
}

.loc-master-detail {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(240px, 0.85fr);
  gap: 10px;
  align-items: stretch;
}

.loc-compact-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  max-height: 236px;
  overflow-y: auto;
  padding-right: 3px;
  align-content: start;
}

.loc-chip-btn {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 9px;
  border-radius: 5px;
  border: 1px solid var(--rac-dim);
  background: var(--rac-panel);
  color: var(--rac-text);
  text-align: left;
  cursor: pointer;
  transition: all 0.12s ease;
}

.loc-chip-btn:hover {
  border-color: var(--rac-line);
  background: var(--rac-panel-2);
}

.loc-chip-btn.sel {
  border-color: var(--rac-accent);
  background: var(--rac-panel-2);
  box-shadow: inset 3px 0 0 0 var(--rac-accent);
}

.loc-chip-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.loc-chip-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--rac-hi);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mini-tag {
  font-size: 9.5px;
  padding: 0 4px;
  border-radius: 3px;
  flex-shrink: 0;
}

.mini-tag.rec {
  color: var(--rac-ok);
  background: rgba(70, 209, 154, 0.14);
}

.mini-tag.accent {
  color: var(--rac-accent);
  background: rgba(99, 179, 237, 0.14);
}

.loc-chip-sub {
  font-size: 10px;
  color: var(--rac-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.loc-chip-density {
  color: var(--rac-accent);
}

.loc-detail-pane {
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid var(--rac-line);
  background: var(--rac-panel-2);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 8px;
}

.loc-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
}

.loc-detail-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--rac-hi);
}

.loc-coord {
  font-size: 11px;
  font-family: var(--mono);
  color: var(--rac-accent);
  margin-top: 2px;
}

.loc-detail-flavor {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--rac-text);
}

.loc-detail-foot {
  padding-top: 6px;
  border-top: 1px dashed var(--rac-dim);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 10.5px;
  color: var(--rac-muted);
}

.link-step-btn {
  background: transparent;
  border: 1px solid var(--rac-accent);
  color: var(--rac-accent);
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 11px;
  cursor: pointer;
}

.link-step-btn:hover {
  background: rgba(99, 179, 237, 0.14);
  color: var(--rac-hi);
}

.custom-loc-box {
  padding: 8px 10px;
  border: 1px dashed var(--rac-accent);
  border-radius: 6px;
  background: var(--rac-panel);
}

.custom-loc-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--rac-hi);
  margin-bottom: 6px;
}

.custom-loc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 6px;
}

.custom-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
  color: var(--rac-muted);
}

.compact-textarea {
  min-height: 46px;
}

/* ── 纪年横向时间轴 ── */
.era-top-layout {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.era-timeline-bar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(155px, 1fr));
  gap: 6px;
}

.era-pill-card {
  padding: 7px 9px;
  border-radius: 6px;
  border: 1px solid var(--rac-dim);
  background: var(--rac-panel);
  color: var(--rac-text);
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
  transition: all 0.12s ease;
}

.era-pill-card:hover {
  border-color: var(--rac-line);
}

.era-pill-card.sel {
  border-color: var(--rac-accent);
  background: var(--rac-panel-2);
  box-shadow: inset 0 2px 0 0 var(--rac-accent);
}

.era-pill-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.era-pill-date {
  font-size: 10.5px;
  font-family: var(--mono);
  color: var(--rac-muted);
}

.era-pill-title {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--rac-hi);
}

.date-inline-field {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 5px 9px;
  border-radius: 5px;
  border: 1px solid var(--rac-dim);
  background: var(--rac-panel);
}

.date-inline-field .wiz-input {
  max-width: 180px;
  padding: 4px 8px;
}

.era-directive-box {
  margin-top: 8px;
  padding: 8px 10px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--rac-text);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.era-box-head {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--rac-hi);
}

.era-box-directive {
  color: var(--rac-muted);
  font-size: 11px;
}

@media (max-width: 760px) {
  .faction-grid,
  .loc-master-detail,
  .subview-bar {
    grid-template-columns: 1fr;
  }
}
</style>
