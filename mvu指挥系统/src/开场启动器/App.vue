<template>
  <div ref="launcherRootRef" class="launcher-shell" :data-theme="activeTheme">
    <!-- ══════════ 顶部战术铭牌栏 ══════════ -->
    <header class="head">
      <div class="head-left">
        <div class="sig">
          <span>▚▚ RED ALERT // TACTICAL DEPLOYMENT TERMINAL</span>
          <span
            class="theme-pill cursor-pointer select-none"
            role="button"
            tabindex="0"
            data-testid="launcher-theme-pill"
            title="点击切换阵营终端配色（实时联动右侧中控台与战地 PDA）"
            @click="cycleLauncherTheme"
            >{{ activeThemeLabel }}</span
          >
        </div>
        <div class="title-row">
          <h1>{{ boot.confirmed ? '战区部署档案铭牌' : '战区开场启动器' }}</h1>
          <span class="status-badge" :class="{ confirmed: boot.confirmed }">
            {{ boot.confirmed ? '● 指挥系统已接管战局' : `● 部署向导 STEP 0${step}/05` }}
          </span>
        </div>
      </div>

      <div class="head-actions">
        <template v-if="!boot.confirmed">
          <button
            v-if="choices.importedStat"
            type="button"
            class="btn sm warn-btn"
            @click="clearImportedSave"
          >
            ✕ 清除存档继承
          </button>
          <button
            type="button"
            class="btn sm"
            :class="{ active: topImportOpen || Boolean(choices.importedStat) }"
            data-testid="top-import-toggle"
            @click="topImportOpen = !topImportOpen"
          >
            {{ choices.importedStat ? '✓ 已载入存档继承' : '📥 导入存档继承' }}
          </button>
        </template>
        <template v-else>
          <button type="button" class="btn sm" @click="dossierCollapsed = !dossierCollapsed">
            {{ dossierCollapsed ? '▾ 展开档案详情' : '▴ 极简折叠' }}
          </button>
          <button
            type="button"
            class="btn sm"
            :class="{ active: maintenanceOpen }"
            data-testid="maintenance-toggle"
            @click="maintenanceOpen = !maintenanceOpen"
          >
            ⚙ 维护舱
          </button>
        </template>
      </div>
    </header>

    <!-- ══════════ 首屏前置：存档继承抽屉（未开局时可随时呼出） ══════════ -->
    <section v-if="!boot.confirmed && topImportOpen" class="card top-import-drawer" data-testid="top-import-drawer">
      <div class="drawer-head">
        <div>
          <strong>📥 跨战局档案继承</strong>
          <div class="drawer-sub">
            粘贴红警指挥系统「系统 → 导出存档到剪贴板」生成的 JSON，一键继承机娘、基地建筑、科技与图鉴进度。
          </div>
        </div>
        <button type="button" class="btn sm" @click="topImportOpen = false">收起</button>
      </div>
      <textarea
        v-model="topImportText"
        class="wiz-textarea"
        placeholder="在此粘贴从指挥系统「系统 → 导出存档到剪贴板」复制的完整存档内容……"
      ></textarea>
      <div class="drawer-foot">
        <input
          ref="topImportFileInputRef"
          type="file"
          accept=".json,application/json"
          style="display: none"
          data-testid="top-import-file-input"
          @change="onTopImportFileChange"
        />
        <button
          type="button"
          class="btn sm"
          data-testid="top-import-file-btn"
          @click="triggerTopImportFileSelect"
        >
          选择备份文件 (.json) 导入
        </button>
        <button type="button" class="btn go sm" :disabled="!topImportText.trim()" @click="applyTopImport">
          解析并载入存档
        </button>
        <span v-if="topImportInfo" class="wb-ok">{{ topImportInfo }}</span>
        <span v-if="topImportErr" class="wb-bad">✗ {{ topImportErr }}</span>
      </div>
      <div v-for="w in topImportWarnings" :key="w" class="wb-warn">⚠ {{ w }}</div>
    </section>

    <!-- ══════════ 已开局：第 0 楼 · 战区部署档案铭牌（Mission Dossier Card） ══════════ -->
    <template v-if="boot.confirmed">
      <section class="card dossier-card" data-testid="mission-dossier-card">
        <div class="dossier-banner">
          <div class="dossier-primary">
            <span class="wiz-chip rec">{{ confirmedWorldLabel }}</span>
            <span class="wiz-chip accent">{{ confirmedFactionLabel }}</span>
            <span class="dossier-coord">{{ confirmedLocationLabel }}</span>
          </div>
          <span class="dossier-date">{{ confirmedDateLabel }}</span>
        </div>

        <div v-if="!dossierCollapsed" class="dossier-grid">
          <div v-for="row in summaryRows" :key="row.k" class="dossier-cell">
            <span class="k">{{ row.k }}</span>
            <span class="v">{{ row.v }}</span>
          </div>
        </div>
      </section>

      <!-- 低调收纳的维护舱抽屉（世界书体检 + 二次确认重置） -->
      <section v-if="maintenanceOpen" class="card maintenance-drawer" data-testid="maintenance-drawer">
        <div class="wb-head">
          <div class="micro">战区世界书排他状态体检（{{ confirmedManifest?.label ?? '未注册世界' }}）</div>
          <button type="button" class="btn sm" :disabled="worldbookBusy" @click="runConfirmedWorldbookCheck">
            重新检查
          </button>
        </div>

        <template v-if="confirmedWorldbookCheck">
          <div v-if="confirmedWorldbookCheck.ok" class="wb-ok">✓ 当前世界书排他挂载状态正常</div>
          <div v-if="confirmedWorldbookCheck.missing.length" class="wb-warn">
            未启用必需书：{{ confirmedWorldbookCheck.missing.join('、') }}
          </div>
          <div v-if="confirmedWorldbookCheck.conflicting.length" class="wb-warn">
            误启用其他世界专属书：{{ confirmedWorldbookCheck.conflicting.join('、') }}
          </div>
          <div v-if="confirmedWorldbookCheck.unavailable.length" class="wb-bad">
            酒馆尚未导入以下世界书，无法切换战区档案：{{ confirmedWorldbookCheck.unavailable.join('、') }}
          </div>
          <button
            v-if="confirmedWorldbookCheck.missing.length || confirmedWorldbookCheck.conflicting.length"
            type="button"
            class="btn go wb-fix"
            :disabled="worldbookBusy || confirmedWorldbookCheck.unavailable.length > 0"
            @click="repairConfirmedWorldbooks"
          >
            {{ worldbookBusy ? '同步中…' : '⚡ 一键修复当前世界书' }}
          </button>
        </template>
        <div v-if="worldbookError" class="wb-bad">✗ {{ worldbookError }}</div>

        <div class="maint-divider"></div>

        <div class="reset-zone">
          <div class="reset-info">
            <strong>重新配置开局向导</strong>
            <span>仅在需要重新设定首楼参数时使用；清除开局确认标记后将返回五步向导。</span>
          </div>
          <div v-if="!confirmingReset">
            <button type="button" class="btn danger sm" :disabled="busy" @click="confirmingReset = true">
              重置开局向导…
            </button>
          </div>
          <div v-else class="reset-confirm-btns">
            <button type="button" class="btn danger sm" :disabled="busy" @click="resetBoot">
              确认重置
            </button>
            <button type="button" class="btn sm" :disabled="busy" @click="confirmingReset = false">
              取消
            </button>
          </div>
        </div>
      </section>
    </template>

    <!-- ══════════ 未开局：五步战术配置向导 + 实时战区遥测双栏 HUD ══════════ -->
    <template v-else>
      <!-- 可自由点击跳步的五步导航条 -->
      <nav class="stepper" aria-label="开局配置步骤">
        <button
          v-for="(item, i) in stepItems"
          :key="item.label"
          type="button"
          class="step-dot"
          :class="{ cur: step === i + 1, done: step > i + 1 }"
          :aria-current="step === i + 1 ? 'step' : undefined"
          @click="step = i + 1"
        >
          <span class="num">0{{ i + 1 }}</span>
          <span class="step-text">
            <span class="lbl">{{ item.label }}</span>
            <span class="step-sub">{{ item.summary }}</span>
          </span>
        </button>
      </nav>

      <div class="wizard-layout">
        <!-- 左/主栏：当前步骤配置面板 -->
        <div class="wizard-main">
          <section class="card step-card">
            <Step0World v-if="step === 1" />
            <Step1Identity v-else-if="step === 2" />
            <Step2Resources v-else-if="step === 3" />
            <Step3Commander v-else-if="step === 4" />
            <Step4Launch v-else @launched="onLaunched" />
          </section>

          <div class="nav-btns">
            <button type="button" class="btn" :disabled="step === 1" @click="step--">← 上一步</button>
            <div class="nav-right">
              <button v-if="step < 5" type="button" class="btn" @click="step = 5">直达发射检阅 ⏭</button>
              <button v-if="step < 5" type="button" class="btn go" @click="step++">下一步：{{ stepLabels[step] }} →</button>
            </div>
          </div>
        </div>

        <!-- 右/侧栏：常驻实时战区遥测栏（Live Telemetry） -->
        <aside class="telemetry-aside" aria-label="实时战区遥测">
          <div class="card telemetry-card">
            <div class="telem-head">
              <span>▚ 实时战区遥测 · TELEMETRY</span>
              <span class="wiz-chip rec">{{ choices.importedStat ? '存档继承' : findPreset(choices.preset).label }}</span>
            </div>

            <div class="telem-kv-list">
              <div class="telem-row">
                <span class="tk">目标世界</span>
                <span class="tv highlight">{{ currentWorldManifest?.display_name ?? choices.worldId }}</span>
              </div>
              <div class="telem-row">
                <span class="tk">作战纪年</span>
                <span class="tv mono">{{ choices.date || '未指定' }}</span>
              </div>
              <div class="telem-row">
                <span class="tk">参战阵营</span>
                <span class="tv">{{ telemetryFactionNames }}</span>
              </div>
              <div class="telem-row">
                <span class="tk">首发载具</span>
                <span class="tv">{{ telemetryMcvSummary }}</span>
              </div>
              <div class="telem-row">
                <span class="tk">切入模式</span>
                <span class="tv">{{ findEntryMode(choices.entryMode).label.replace('（默认）', '') }}</span>
              </div>
              <div class="telem-row">
                <span class="tk">系统通联</span>
                <span class="tv">{{ findSystemLinkMode(resolveSystemLinkMode(choices), choices.entryMode).label.replace(/（.*?）/g, '') }}</span>
              </div>
              <div class="telem-row">
                <span class="tk">机娘孵化</span>
                <span class="tv">{{ findMaidenIncubationMode(resolveMaidenIncubationMode(choices)).label.replace(/（.*?）/g, '') }}</span>
              </div>
              <div class="telem-row">
                <span class="tk">拟定坐标</span>
                <span class="tv">{{ telemetryLocationLabel }}</span>
              </div>
              <div class="telem-row">
                <span class="tk">初始基地</span>
                <span class="tv mono">{{ choices.importedStat ? `${choices.importedStat.bases.length} 座（继承）` : '0 座（待 MCV 展开）' }}</span>
              </div>
            </div>

            <div class="telem-metrics">
              <div class="metric-box">
                <span class="mk">初始资金 (×{{ multiImpact.creditsMultiplier }})</span>
                <span class="mv ok">{{ effectiveDifficulty.credits }}</span>
              </div>
              <div class="metric-box">
                <span class="mk">初始暴露度</span>
                <span class="mv" :class="effectiveDifficulty.exposure >= 15 ? 'warn' : ''">
                  {{ effectiveDifficulty.exposure }}
                </span>
              </div>
              <div class="metric-box">
                <span class="mk">副官总日薪</span>
                <span class="mv" :class="telemetryDailyUpkeep > 0 ? 'warn' : ''">
                  {{ telemetryDailyUpkeep }}/日
                </span>
              </div>
              <div class="metric-box">
                <span class="mk">已解锁科技</span>
                <span class="mv">{{ effectiveDifficulty.techDone.length }} 项</span>
              </div>
            </div>

            <div class="telem-foot-block">
              <div class="tf-label">合法结算货币</div>
              <div class="tf-tags">
                <span v-for="cur in currentWorldManifest?.currencies ?? []" :key="cur" class="wiz-chip">
                  {{ cur }}
                </span>
              </div>
            </div>

            <div v-if="multiImpact.breakInPenalties.length > 0" class="telem-foot-block warn-block">
              <div class="tf-label">⚠ 15日跨系磨合代价</div>
              <div class="tf-text">
                {{ multiImpact.breakInPenalties.map(p => p.name).join('、') }}
              </div>
            </div>

            <div class="telem-foot-block">
              <div class="tf-label">待挂载核心世界书（{{ telemetryBookCount }} 本）</div>
              <div class="tf-text">
                通用军工图谱 9 卷 + 统帅条令 2 卷 + {{ telemetryFactionNames }}专属四卷 + 《{{ currentWorldManifest?.display_name }}》
              </div>
            </div>
          </div>
        </aside>
      </div>
    </template>

    <div v-if="msg" class="msg">{{ msg }}</div>
    <div v-if="err" class="err">{{ err }}</div>
  </div>
</template>

<script setup lang="ts">
import { WORLD_MANIFESTS } from '../红警指挥系统/core/worlds';
import { emptyBoot, readBootFrom, type BootState } from './boot';
import { clearLastParsedSavePack, packToChoices, parseSavePack } from './importSave';
import {
  getHostAdapter,
  resolveDifficulty,
  resolveLaunchLocation,
  syncWorldbooksForWorld,
} from './pipeline';
import {
  computeMultiFactionLaunchImpact,
  defaultRecommendedChoices,
  findEntryMode,
  findFaction,
  findLocation,
  findMaidenIncubationMode,
  findPreset,
  findSystemLinkMode,
  findTone,
  formatLocationLabel,
  HUMAN_ADJUTANT_DAILY_UPKEEP,
  resolveMaidenIncubationMode,
  resolveSelectedFactions,
  resolveStarterMcvInfo,
  resolveSystemLinkMode,
  type LaunchChoices,
} from './presets';
import Step0World from './steps/Step0World.vue';
import Step1Identity from './steps/Step1Identity.vue';
import Step2Resources from './steps/Step2Resources.vue';
import Step3Commander from './steps/Step3Commander.vue';
import Step4Launch from './steps/Step4Launch.vue';
import {
  playTacticalStagger,
  scheduleNextFrame,
  useTacticalModalMotion,
} from '../红警指挥系统/ui/motion/useGsapMotion';
import {
  normalizeThemeKey,
  onThemeChange,
  setTheme,
  type ThemeKey,
} from '../红警指挥系统/ui/ui';
import { checkWorldbookActivation, getWorldManifest, type WorldbookCheckResult } from './worldbookManifest';

const adapter = getHostAdapter();

const launcherRootRef = ref<HTMLElement | null>(null);
useTacticalModalMotion(launcherRootRef);

const boot = ref<BootState>(emptyBoot());
const step = ref(1);
const busy = ref(false);
const msg = ref('');
const err = ref('');
const confirmedWorldbookCheck = ref<WorldbookCheckResult | null>(null);
const worldbookBusy = ref(false);
const worldbookError = ref('');
const dossierCollapsed = ref(false);
const maintenanceOpen = ref(false);
const confirmingReset = ref(false);

const stepLabels = ['世界战区', '阵营与部署', '资源与科技', '统帅与参谋', '检阅与发射'];

/** 单一 reactive choices 贯穿五步（默认首选推荐：具象世界·赛博朋克2077 · 2042 恶土深处） */
const choices = reactive<LaunchChoices>(defaultRecommendedChoices());
provide('launchChoices', choices);

/* ── 顶部前置存档导入抽屉 ── */
const topImportOpen = ref(false);
const topImportText = ref('');
const topImportInfo = ref('');
const topImportErr = ref('');
const topImportWarnings = ref<string[]>([]);
const topImportFileInputRef = ref<HTMLInputElement | null>(null);

function triggerTopImportFileSelect() {
  topImportFileInputRef.value?.click();
}

async function onTopImportFileChange(e: Event) {
  const input = e.target as HTMLInputElement | null;
  const file = input?.files?.[0];
  if (!file) return;
  try {
    let text = '';
    if (typeof file.text === 'function') {
      text = await file.text();
    } else if (typeof FileReader !== 'undefined') {
      text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(reader.error ?? new Error('读取备份文件失败'));
        reader.readAsText(file, 'utf-8');
      });
    }
    topImportText.value = text;
    applyTopImport();
  } catch (err) {
    topImportErr.value = `读取备份文件失败：${err instanceof Error ? err.message : String(err)}`;
  } finally {
    if (input) input.value = '';
  }
}

watch(step, () => {
  msg.value = '';
  err.value = '';
});

watch([step, topImportOpen, maintenanceOpen], () => {
  scheduleNextFrame(() =>
    playTacticalStagger(launcherRootRef.value, '.card, .wiz-card, .dossier-cell', {
      maxItems: 16,
      duration: 0.18,
    }),
  );
});

function applyTopImport() {
  topImportErr.value = '';
  topImportInfo.value = '';
  topImportWarnings.value = [];
  const res = parseSavePack(topImportText.value);
  if (!res.ok) {
    topImportErr.value = res.error;
    return;
  }
  const { choices: next, warnings } = packToChoices(res.pack, { ...choices });
  Object.assign(choices, next);
  topImportWarnings.value = warnings;
  topImportInfo.value = `✓ 已载入存档（来源：${res.pack.source.chat || '未知聊天'}），可随时跳至第 5 步发射`;
}

function clearImportedSave() {
  clearLastParsedSavePack();
  choices.importedStat = null;
  choices.importedFrom = '';
  choices.preset = 'normal';
  choices.customCredits = 2000;
  choices.customExposure = 0;
  choices.customTech = [];
  topImportText.value = '';
  topImportInfo.value = '';
  topImportErr.value = '';
  topImportWarnings.value = [];
}

/* ── 动态三阵营主题双向同步（#app[data-theme] <-> 中控台 / PDA / 楼层终端） ── */
const factionPrimaryTheme = computed<ThemeKey>(() => {
  if (boot.value.confirmed) {
    const c = (boot.value.choices ?? {}) as Partial<LaunchChoices>;
    const list = resolveSelectedFactions({
      factionId: c.factionId || 'allied',
      selectedFactions: c.selectedFactions,
    });
    return normalizeThemeKey(list[0]) ?? 'allied';
  }
  return normalizeThemeKey(resolveSelectedFactions(choices)[0]) ?? 'allied';
});

const manualThemeOverride = ref<ThemeKey | null>(null);

const activeTheme = computed<ThemeKey>(() => manualThemeOverride.value ?? factionPrimaryTheme.value);

const activeThemeLabel = computed(() => {
  if (activeTheme.value === 'soviet') return 'SOVIET · 苏维埃深红';
  if (activeTheme.value === 'yuri') return 'YURI · 尤里暗紫';
  return 'ALLIED · 盟军冰蓝';
});

function cycleLauncherTheme() {
  const order: ThemeKey[] = ['allied', 'soviet', 'yuri'];
  const idx = order.indexOf(activeTheme.value);
  const next = order[(idx + 1) % order.length] ?? 'allied';
  manualThemeOverride.value = next;
  setTheme(next);
}

watch(
  factionPrimaryTheme,
  nextFactionTheme => {
    manualThemeOverride.value = null;
    setTheme(nextFactionTheme);
  },
  { immediate: true },
);

const stopExternalThemeSync = onThemeChange(nextTheme => {
  if (nextTheme !== activeTheme.value) {
    manualThemeOverride.value = nextTheme;
  }
});

onBeforeUnmount(() => {
  stopExternalThemeSync();
});

watch(
  activeTheme,
  theme => {
    if (typeof document !== 'undefined') {
      const appEl = document.getElementById('app');
      if (appEl) {
        if (theme === 'allied') appEl.removeAttribute('data-theme');
        else appEl.setAttribute('data-theme', theme);
      }
    }
  },
  { immediate: true },
);

/* ── 实时遥测衍生计算 ── */
const currentWorldManifest = computed(() => WORLD_MANIFESTS[choices.worldId]);
const selectedFactions = computed(() => resolveSelectedFactions(choices));
const effectiveDifficulty = computed(() => resolveDifficulty(choices));

const multiImpact = computed(() => {
  const preset = findPreset(choices.preset);
  const baseCredits = preset.id === 'custom' ? choices.customCredits : preset.credits;
  const baseExposure = preset.id === 'custom' ? choices.customExposure : preset.exposure;
  return computeMultiFactionLaunchImpact(
    selectedFactions.value,
    baseCredits,
    baseExposure,
    choices.factionAdjutants,
  );
});

const telemetryFactionNames = computed(() =>
  selectedFactions.value.map(id => findFaction(id).name).join(' + '),
);

const telemetryMcvSummary = computed(() =>
  selectedFactions.value
    .map(id => {
      const s = resolveStarterMcvInfo(id);
      return s ? `${s.vehicleName}·${s.girlName}` : `MCV（${findFaction(id).name}）`;
    })
    .join(' / '),
);

const telemetryLocationLabel = computed(() => {
  try {
    return formatLocationLabel(resolveLaunchLocation(choices));
  } catch {
    return choices.locationId;
  }
});

const telemetryDailyUpkeep = computed(() => {
  let sum = 0;
  for (const fid of selectedFactions.value) {
    if (choices.factionAdjutants?.[fid]?.identity === 'human') {
      sum += HUMAN_ADJUTANT_DAILY_UPKEEP;
    }
  }
  if (choices.staffAdjutant?.enabled) sum += HUMAN_ADJUTANT_DAILY_UPKEEP;
  return sum;
});

const telemetryBookCount = computed(() => {
  const baseCount = currentWorldManifest.value?.worldbook_group.filter(b => b.required).length ?? 12;
  const extraFactions = Math.max(0, selectedFactions.value.length - 1);
  return baseCount + extraFactions * 4 + 1;
});

const stepItems = computed(() => [
  {
    label: '世界战区',
    summary: currentWorldManifest.value?.display_name ?? choices.worldId,
  },
  {
    label: '阵营与部署',
    summary: `${telemetryFactionNames.value} · ${resolveLaunchLocation(choices).name}`,
  },
  {
    label: '资源与科技',
    summary: `${findPreset(choices.preset).label} · ${effectiveDifficulty.value.credits} 资金`,
  },
  {
    label: '统帅与参谋',
    summary:
      choices.personaMode === 'skip'
        ? `当前身份 · 日薪${telemetryDailyUpkeep.value}`
        : `${choices.personaName.trim() || '待填统帅'} · 日薪${telemetryDailyUpkeep.value}`,
  },
  {
    label: '检阅与发射',
    summary: `${findEntryMode(choices.entryMode).label.split('·')[0]} · ${findTone(choices.toneId).label.replace('（默认）', '')}`,
  },
]);

function notifyConsoleBootState(confirmed: boolean) {
  try {
    const payload = { type: 'ra-boot-state-changed', confirmed };
    window.postMessage(payload, '*');
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(payload, '*');
      const frames = window.parent.frames;
      for (let i = 0; i < frames.length; i++) {
        try {
          frames[i]?.postMessage(payload, '*');
        } catch {
          /* cross-frame guard */
        }
      }
    }
  } catch {
    /* ignore postMessage errors in non-browser test env */
  }
}

function reload() {
  err.value = '';
  try {
    boot.value = readBootFrom(adapter.getChatVars());
    notifyConsoleBootState(boot.value.confirmed);
    void nextTick(runConfirmedWorldbookCheck);
  } catch (e) {
    err.value = `读取开局状态失败：${e instanceof Error ? e.message : String(e)}`;
  }
}

function onLaunched() {
  msg.value = '✓ 发射序列执行完毕，指挥系统已接管战局';
  reload();
}

async function resetBoot() {
  busy.value = true;
  err.value = '';
  try {
    await adapter.setBoot(undefined);
    confirmingReset.value = false;
    maintenanceOpen.value = false;
    reload();
    step.value = 1;
    msg.value = '✓ 已重置开局标记，返回部署向导';
  } catch (e) {
    err.value = `重置失败：${e instanceof Error ? e.message : String(e)}`;
  } finally {
    busy.value = false;
  }
}

/** 已确认聊天的世界：优先 $boot 快照；旧确认聊天回读 #0 楼；v1/无版本旧档固定归修真。 */
const confirmedWorldId = computed(() => {
  const bootWorld = (boot.value.choices as { worldId?: unknown } | undefined)?.worldId;
  if (typeof bootWorld === 'string' && bootWorld) return bootWorld;
  const raw = adapter.getStatData();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return '';
  const record = raw as { schema_version?: unknown; meta?: { world_id?: unknown } };
  if (typeof record.meta?.world_id === 'string' && record.meta.world_id) return record.meta.world_id;
  return record.schema_version === undefined || record.schema_version === 1 ? 'xiuzhen' : '';
});

const confirmedManifest = computed(() => getWorldManifest(confirmedWorldId.value));

const confirmedChoices = computed(
  () =>
    (boot.value.choices ?? {}) as Partial<LaunchChoices> & {
      effective?: { credits?: number; techDone?: string[]; exposure?: number };
    },
);

const confirmedWorldLabel = computed(
  () => confirmedManifest.value?.label ?? `未注册世界（${confirmedWorldId.value || '未知'}）`,
);

const confirmedFactionLabel = computed(() => {
  const c = confirmedChoices.value;
  const list = resolveSelectedFactions({
    factionId: c.factionId || 'allied',
    selectedFactions: c.selectedFactions,
  });
  return list.map(id => findFaction(id).name).join(' + ');
});

const confirmedLocationLabel = computed(() => {
  const c = confirmedChoices.value;
  if (c.locationId === 'custom') {
    const name = c.customLocationName?.trim() || '自定义前哨基地';
    const reg = c.customLocationRegion?.trim() || '自主勘定战区';
    return `${name}（${reg}）`;
  }
  if (c.locationId) {
    try {
      const loc = findLocation(c.locationId, c.worldId ?? 'xiuzhen');
      return formatLocationLabel(loc);
    } catch {
      return c.locationId;
    }
  }
  return '默认战区坐标';
});

const confirmedDateLabel = computed(() => confirmedChoices.value.date || '默认历法纪年');

function runConfirmedWorldbookCheck() {
  confirmedWorldbookCheck.value = null;
  worldbookError.value = '';
  if (!boot.value.confirmed) return;
  try {
    if (!confirmedManifest.value) {
      throw new Error(`world_id「${confirmedWorldId.value || '空'}」未注册`);
    }
    const c = confirmedChoices.value;
    const factions = resolveSelectedFactions({
      factionId: c.factionId || 'allied',
      selectedFactions: c.selectedFactions,
    });
    confirmedWorldbookCheck.value = checkWorldbookActivation(
      confirmedManifest.value,
      adapter.globalWorldbookNames(),
      adapter.allWorldbookNames(),
      factions,
    );
  } catch (e) {
    worldbookError.value = `体检失败：${e instanceof Error ? e.message : String(e)}`;
  }
}

async function repairConfirmedWorldbooks() {
  if (!confirmedManifest.value) return;
  worldbookBusy.value = true;
  worldbookError.value = '';
  try {
    const c = confirmedChoices.value;
    const factions = resolveSelectedFactions({
      factionId: c.factionId || 'allied',
      selectedFactions: c.selectedFactions,
    });
    await syncWorldbooksForWorld(adapter, confirmedWorldId.value, factions);
    runConfirmedWorldbookCheck();
  } catch (e) {
    worldbookError.value = `修复失败：${e instanceof Error ? e.message : String(e)}`;
  } finally {
    worldbookBusy.value = false;
  }
}

/** 已开局摘要行 */
const summaryRows = computed(() => {
  const rows: { k: string; v: string }[] = [];
  const c = confirmedChoices.value;
  rows.push({ k: '战役难度', v: findPreset(boot.value.preset ?? String(c.preset ?? 'normal')).label });
  rows.push({ k: '所属世界', v: confirmedWorldLabel.value });
  rows.push({ k: '参战阵营', v: confirmedFactionLabel.value });
  rows.push({ k: '切入模式', v: findEntryMode(c.entryMode).label });
  rows.push({
    k: '系统通联',
    v: findSystemLinkMode(resolveSystemLinkMode(c), c.entryMode).label,
  });
  rows.push({ k: '拟定坐标', v: confirmedLocationLabel.value });
  if (c.date) rows.push({ k: '作战纪年', v: c.date });
  if (c.effective) {
    if (typeof c.effective.credits === 'number') rows.push({ k: '初始资金', v: String(c.effective.credits) });
    if (Array.isArray(c.effective.techDone)) {
      rows.push({ k: '首发科技', v: c.effective.techDone.length > 0 ? c.effective.techDone.join('、') : '无' });
    }
    if (typeof c.effective.exposure === 'number') rows.push({ k: '初始暴露度', v: String(c.effective.exposure) });
  }
  if (c.toneId) rows.push({ k: '叙事基调', v: findTone(c.toneId).label });
  rows.push({ k: '统帅档案', v: boot.value.personaId ?? '沿用当前身份' });
  if (boot.value.importedFrom) rows.push({ k: '继承来源', v: boot.value.importedFrom });
  return rows;
});

onMounted(reload);
</script>

<style scoped>
.launcher-shell {
  max-width: 1040px;
  margin: 0 auto;
  padding: 16px 14px 28px;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding-bottom: 8px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--rac-dim);
}

.sig {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  color: var(--rac-muted);
}

.theme-pill {
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid var(--rac-accent);
  color: var(--rac-hi);
  letter-spacing: 0.06em;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 4px;
}

h1 {
  margin: 0;
  font-size: 17.5px;
  letter-spacing: 0.06em;
  color: var(--rac-hi);
}

.status-badge {
  font-family: var(--mono);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--rac-dim);
  background: var(--rac-panel-2);
  color: var(--rac-accent);
}

.status-badge.confirmed {
  border-color: rgba(70, 209, 154, 0.5);
  color: var(--rac-ok);
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.card {
  background: var(--glass);
  border: 1px solid var(--rac-dim);
  border-radius: 8px;
  padding: 11px 12px;
  margin-bottom: 9px;
}

/* ── 顶部导入抽屉 ── */
.top-import-drawer {
  border-color: var(--rac-accent);
}

.drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.drawer-sub {
  font-size: 11px;
  color: var(--rac-muted);
  margin-top: 2px;
}

.drawer-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 8px;
}

/* ── 五步可点击导航条 ── */
.stepper {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
  margin-bottom: 10px;
}

.step-dot {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 9px;
  border: 1px solid var(--rac-dim);
  border-radius: 6px;
  background: var(--rac-panel);
  color: var(--rac-muted);
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}

.step-dot:hover {
  border-color: var(--rac-line);
  color: var(--rac-hi);
}

.step-dot .num {
  width: 24px;
  height: 24px;
  line-height: 22px;
  text-align: center;
  border-radius: 4px;
  border: 1px solid var(--rac-dim);
  font-family: var(--mono);
  font-size: 11px;
  flex-shrink: 0;
}

.step-dot.cur {
  border-color: var(--rac-accent);
  background: var(--rac-panel-2);
  color: var(--rac-hi);
  box-shadow: inset 0 2px 0 0 var(--rac-accent);
}

.step-dot.cur .num {
  border-color: var(--rac-accent);
  color: var(--rac-accent);
  font-weight: 700;
}

.step-dot.done {
  border-color: rgba(70, 209, 154, 0.38);
  color: var(--rac-text);
}

.step-dot.done .num {
  border-color: rgba(70, 209, 154, 0.55);
  color: var(--rac-ok);
}

.step-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.step-dot .lbl {
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.step-sub {
  font-size: 10px;
  color: var(--rac-muted);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* ── 双栏自适应布局 ── */
.wizard-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 290px;
  gap: 14px;
  align-items: start;
}

.wizard-main {
  min-width: 0;
}

.telemetry-aside {
  position: sticky;
  top: 12px;
  min-width: 0;
}

.telemetry-card {
  padding: 12px;
  margin-bottom: 0;
  background: var(--rac-panel);
}

.telem-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--rac-hi);
  padding-bottom: 8px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--rac-dim);
}

.telem-kv-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 10px;
}

.telem-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
}

.tk {
  color: var(--rac-muted);
  flex-shrink: 0;
}

.tv {
  text-align: right;
  color: var(--rac-text);
  overflow: hidden;
  text-overflow: ellipsis;
}

.tv.highlight {
  color: var(--rac-hi);
  font-weight: 600;
}

.tv.mono {
  font-family: var(--mono);
}

.telem-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  margin-bottom: 10px;
}

.metric-box {
  padding: 6px 8px;
  border: 1px solid var(--rac-dim);
  border-radius: 5px;
  background: var(--rac-panel-2);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mk {
  font-size: 10px;
  color: var(--rac-muted);
}

.mv {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  font-weight: 700;
  color: var(--rac-hi);
}

.mv.ok {
  color: var(--rac-ok);
}

.mv.warn {
  color: var(--rac-warn);
}

.telem-foot-block {
  padding-top: 8px;
  margin-top: 8px;
  border-top: 1px dashed var(--rac-dim);
}

.tf-label {
  font-size: 10px;
  color: var(--rac-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 4px;
}

.tf-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tf-text {
  font-size: 11px;
  color: var(--rac-text);
  line-height: 1.45;
}

.warn-block .tf-label,
.warn-block .tf-text {
  color: var(--rac-warn);
}

/* ── 已开局：第 0 楼战区部署档案铭牌 ── */
.dossier-card {
  border-color: var(--rac-line);
}

.dossier-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.dossier-primary {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.dossier-coord {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--rac-hi);
}

.dossier-date {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--rac-accent);
}

.dossier-grid {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--rac-dim);
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 6px 14px;
}

.dossier-cell {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
  border-bottom: 1px dashed rgba(141, 180, 207, 0.1);
}

.k {
  color: var(--rac-muted);
  flex-shrink: 0;
}

.v {
  text-align: right;
  color: var(--rac-hi);
}

.maintenance-drawer {
  border-color: var(--rac-dim);
  background: var(--rac-panel);
}

.micro {
  font-size: 11px;
  color: var(--rac-muted);
  letter-spacing: 0.06em;
}

.wb-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.wb-ok,
.wb-warn,
.wb-bad {
  font-size: 12px;
  line-height: 1.55;
}

.wb-ok {
  color: var(--rac-ok);
}

.wb-warn {
  color: var(--rac-warn);
}

.wb-bad {
  color: var(--rac-alert);
}

.wb-fix {
  width: 100%;
  margin-top: 8px;
}

.maint-divider {
  height: 1px;
  background: var(--rac-dim);
  margin: 12px 0;
}

.reset-zone {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.reset-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11.5px;
  color: var(--rac-muted);
}

.reset-info strong {
  color: var(--rac-text);
}

.reset-confirm-btns {
  display: flex;
  gap: 6px;
}

/* ── 底部导航与通用按钮（贴底吸附，无需长滚） ── */
.nav-btns {
  position: sticky;
  bottom: 0;
  z-index: 10;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border-radius: 7px;
  border: 1px solid var(--rac-dim);
  background: rgba(9, 14, 20, 0.92);
  backdrop-filter: blur(8px);
}

.nav-right {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.nav-btns .btn {
  min-height: 42px;
}

.btn {
  background: var(--rac-panel-2);
  border: 1px solid var(--rac-dim);
  color: var(--rac-text);
  border-radius: 6px;
  padding: 7px 14px;
  font-size: 12.5px;
  cursor: pointer;
  transition: all 0.14s ease;
}

.btn:hover:not(:disabled) {
  border-color: var(--rac-line);
  color: var(--rac-hi);
}

.btn.active {
  border-color: var(--rac-accent);
  color: var(--rac-hi);
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn.go {
  border-color: rgba(70, 209, 154, 0.55);
  background: rgba(70, 209, 154, 0.14);
  color: var(--rac-ok);
  font-weight: 600;
}

.btn.danger {
  border-color: rgba(255, 90, 54, 0.45);
  color: var(--rac-alert);
}

.btn.warn-btn {
  border-color: rgba(210, 173, 105, 0.5);
  color: var(--rac-warn);
}

.btn.sm {
  padding: 5px 10px;
  font-size: 11.5px;
}

.msg {
  margin-top: 10px;
  font-size: 12px;
  color: var(--rac-ok);
}

.err {
  margin-top: 10px;
  font-size: 12px;
  color: var(--rac-alert);
}

@media (max-width: 900px) {
  .stepper {
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  }
  .wizard-layout {
    grid-template-columns: 1fr;
  }
  .telemetry-aside {
    position: static;
  }
}
</style>
