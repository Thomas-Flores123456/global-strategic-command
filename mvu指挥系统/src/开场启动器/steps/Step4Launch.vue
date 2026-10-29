<template>
  <div class="step4-launch">
    <!-- ══════════ 0. 开场切入模式（三种开局姿态） ══════════ -->
    <section class="wiz-section">
      <div class="wiz-sec-head">
        <div class="wiz-label">开场切入模式（决定首幕叙事起点 · MCV 展开前零预设基地）</div>
        <span class="wiz-chip rec">{{ activeEntryMode.label }}</span>
      </div>

      <div class="opt-grid entry-mode-grid" data-testid="entry-mode-grid">
        <button
          v-for="m in OPENING_ENTRY_MODES"
          :key="m.id"
          type="button"
          class="opt-card entry-mode-card"
          :class="{ sel: (choices.entryMode || 'field_drop') === m.id }"
          :data-entry-mode="m.id"
          :disabled="launching"
          :aria-pressed="(choices.entryMode || 'field_drop') === m.id"
          @click="selectEntryMode(m.id)"
        >
          <div class="entry-mode-chips">
            <span class="wiz-chip" :class="m.recommended ? 'rec' : 'accent'">{{ m.shortTag }}</span>
          </div>
          <div class="opt-title">{{ m.label }}</div>
          <div class="opt-flavor">{{ m.summary }}</div>
        </button>
      </div>
    </section>

    <!-- ══════════ 0.5. 系统觉醒与机娘通联时机（可选项 · 随切入模式智能联动默认） ══════════ -->
    <section class="wiz-section">
      <div class="wiz-sec-head">
        <div class="wiz-label">系统觉醒与机娘通联时机（决定开场是否已绑定系统及白凌等机娘能否主动联系主角）</div>
        <span class="wiz-chip rec">{{ activeSystemLinkMode.label }}</span>
      </div>

      <div class="opt-grid entry-mode-grid" data-testid="system-link-mode-grid">
        <button
          v-for="s in OPENING_SYSTEM_LINK_MODES"
          :key="s.id"
          type="button"
          class="opt-card entry-mode-card"
          :class="{ sel: activeSystemLinkMode.id === s.id }"
          :data-system-link-mode="s.id"
          :disabled="launching"
          :aria-pressed="activeSystemLinkMode.id === s.id"
          @click="choices.systemLinkMode = s.id"
        >
          <div class="entry-mode-chips">
            <span class="wiz-chip" :class="s.recommended ? 'rec' : 'accent'">{{ s.shortTag }}</span>
          </div>
          <div class="opt-title">{{ s.label }}</div>
          <div class="opt-flavor">{{ s.summary }}</div>
        </button>
      </div>
    </section>

    <!-- ══════════ 0.8. 机娘孵化与命名模式（方案 B 三档切换） ══════════ -->
    <section class="wiz-section">
      <div class="wiz-sec-head">
        <div class="wiz-label">机娘孵化与命名模式（预设机娘档案 VS 战地自由盲盒赐名）</div>
        <span class="wiz-chip rec">{{ activeMaidenIncubationMode.label }}</span>
      </div>

      <div class="opt-grid entry-mode-grid" data-testid="maiden-incubation-mode-grid">
        <button
          v-for="inc in OPENING_MAIDEN_INCUBATION_MODES"
          :key="inc.id"
          type="button"
          class="opt-card entry-mode-card"
          :class="{ sel: activeMaidenIncubationMode.id === inc.id }"
          :data-maiden-incubation-mode="inc.id"
          :disabled="launching"
          :aria-pressed="activeMaidenIncubationMode.id === inc.id"
          @click="choices.maidenIncubationMode = inc.id"
        >
          <div class="entry-mode-chips">
            <span class="wiz-chip" :class="inc.recommended ? 'rec' : 'accent'">{{ inc.shortTag }}</span>
          </div>
          <div class="opt-title">{{ inc.label }}</div>
          <div class="opt-flavor">{{ inc.summary }}</div>
        </button>
      </div>
    </section>

    <!-- ══════════ 1. 叙事基调 ══════════ -->
    <section class="wiz-section">
      <div class="wiz-sec-head">
        <div class="wiz-label">战役叙事基调（决定战役笔触与临场氛围）</div>
        <span class="wiz-chip accent">{{ activeTone.label }}</span>
      </div>

      <div class="opt-grid tone-grid">
        <button
          v-for="t in TONES"
          :key="t.id"
          type="button"
          class="opt-card tone-card"
          :class="{ sel: choices.toneId === t.id }"
          :disabled="launching"
          :aria-pressed="choices.toneId === t.id"
          @click="choices.toneId = t.id"
        >
          <div class="opt-title">{{ t.label }}</div>
          <div class="opt-flavor">{{ t.instruction }}</div>
        </button>
      </div>
    </section>

    <!-- ══════════ 2. 指挥官附加指示 ══════════ -->
    <section class="wiz-section">
      <div class="wiz-label">指挥官附加作战指示（补充至开局作战简报，可留空）</div>
      <textarea
        v-model="choices.customPrompt"
        class="wiz-textarea"
        :disabled="launching"
        placeholder="对开局环境、首轮侦察重点或叙事细节的补充指令……"
      ></textarea>
    </section>

    <!-- ══════════ 3. 首楼发射指令报文实时预览（折叠） ══════════ -->
    <section class="wiz-section">
      <button
        type="button"
        class="fold-btn"
        :disabled="launching"
        data-testid="toggle-message-preview"
        @click="previewOpen = !previewOpen"
      >
        <span>{{ previewOpen ? '▾ 收起开局作战简报预览' : '▸ 预览开局作战简报（含时代态势与拟定部署坐标）' }}</span>
        <span class="wiz-chip">{{ messagePreview.length }} 字符</span>
      </button>
      <pre v-if="previewOpen" class="wiz-desc-preview msg-preview-box" data-testid="launch-message-preview">{{ messagePreview }}</pre>
    </section>

    <!-- ══════════ 4. G2 · 跨战局档案继承状态提示 ══════════ -->
    <section class="wiz-section import-status-card">
      <div class="import-status-row">
        <div>
          <div v-if="choices.importedStat" class="import-ok">
            ✓ 已载入跨战局继承档案（来源：{{ choices.importedFrom || '剪贴板存档' }}）
          </div>
          <div v-else class="wb-info" style="margin-top: 0">
            如需继承旧战局进度，请点击顶部导航栏「📥 导入存档继承」或直接选择备份文件
          </div>
        </div>
        <div class="import-file-actions">
          <input
            ref="step4FileInputRef"
            type="file"
            accept=".json,application/json"
            style="display: none"
            data-testid="step4-import-file-input"
            @change="onStep4FileChange"
          />
          <button
            type="button"
            class="mini-btn"
            :disabled="launching"
            data-testid="step4-import-file-btn"
            @click="triggerStep4FileSelect"
          >
            选择本地备份文件 (.json) 载入
          </button>
        </div>
      </div>
      <div v-for="w in step4ImportWarnings" :key="w" class="import-warn">⚠ {{ w }}</div>
      <div v-if="step4ImportErr" class="import-err">✗ {{ step4ImportErr }}</div>
    </section>

    <!-- ══════════ 5. G3 · 开局前世界书排他体检 ══════════ -->
    <section class="wiz-section wb-check-panel">
      <div class="wiz-sec-head">
        <div class="wiz-label" style="margin-bottom: 0">
          战前世界书排他体检 · {{ manifest?.label ?? '未注册世界' }}
        </div>
        <button type="button" class="mini-btn" :disabled="wbBusy" @click="runWbCheck">重新核验</button>
      </div>
      <template v-if="wbCheck">
        <div v-if="wbCheck.ok" class="wb-ok">
          ✓ 必需世界书 {{ requiredEnabled }}/{{ requiredTotal }} 本已就绪，无跨世界冲突书
        </div>
        <template v-else>
          <div v-if="wbCheck.missing.length" class="wb-warn">
            ⚠ 尚未启用的必需世界书（{{ wbCheck.missing.length }} 本）：{{ wbCheck.missing.join('、') }}
          </div>
          <div v-if="wbCheck.conflicting.length" class="wb-warn">
            ⚠ 当前仍开启的其他战区专属世界书（{{ wbCheck.conflicting.length }} 本）：{{ wbCheck.conflicting.join('、') }}
          </div>
          <button
            v-if="wbCheck.missing.length || wbCheck.conflicting.length"
            type="button"
            class="mini-btn go"
            :disabled="wbBusy || launching || wbCheck.unavailable.length > 0"
            @click="repairWorldbooks"
          >
            {{ wbBusy ? '正在同步世界书…' : '⚡ 一键排他同步当前世界书' }}
          </button>
          <div v-if="wbCheck.unavailable.length" class="wb-bad">
            ✗ 酒馆缺失以下必需世界书文件，请先导入酒馆后再发射：{{ wbCheck.unavailable.join('、') }}
          </div>
        </template>
        <div v-if="wbCheck.optionalMissing.length" class="wb-info">
          可选战史档案未启用：{{ wbCheck.optionalMissing.join('、') }}（随战局推进自动归档，不影响开局）
        </div>
      </template>
      <div v-if="wbErr" class="wb-bad">✗ {{ wbErr }}</div>
    </section>

    <!-- ══════════ 6. 发射主按钮 ══════════ -->
    <section class="wiz-section">
      <button type="button" class="launch-btn" :disabled="launching || !manifest" @click="launch">
        <span class="launch-icon">▚▚</span>
        <span>{{
          launching
            ? '正在执行五工序发射序列…'
            : failed
              ? '↻ 重试发射序列'
              : '发射开局指令 · 启动战役（MCV 待命）'
        }}</span>
      </button>
    </section>

    <!-- ══════════ 7. 五工序脉冲进度仪 ══════════ -->
    <section v-if="progress.length > 0" class="wiz-section prog-panel">
      <div class="wiz-label">发射组装线遥测 · LAUNCH PIPELINE</div>
      <div v-for="p in progress" :key="p.name" class="prog-row" :class="p.status">
        <span class="prog-mark">{{ markOf(p.status) }}</span>
        <span class="prog-label">{{ p.label }}</span>
        <span v-if="p.error" class="prog-err">{{ p.error }}</span>
      </div>
    </section>

    <div v-if="errorMsg" class="launch-err">✗ {{ errorMsg }}</div>
  </div>
</template>

<script setup lang="ts">
import { getSavePackForImportedStat, packToChoices, readSavePackFromFile } from '../importSave';
import {
  composeLaunchMessage,
  createLaunchSteps,
  getHostAdapter,
  runLaunchPipeline,
  syncWorldbooksForWorld,
  type StepProgress,
  type StepStatus,
} from '../pipeline';
import {
  defaultSystemLinkModeForEntry,
  findEntryMode,
  findMaidenIncubationMode,
  findSystemLinkMode,
  findTone,
  OPENING_ENTRY_MODES,
  OPENING_MAIDEN_INCUBATION_MODES,
  OPENING_SYSTEM_LINK_MODES,
  resolveMaidenIncubationMode,
  resolveSelectedFactions,
  resolveSystemLinkMode,
  TONES,
  type LaunchChoices,
  type OpeningEntryMode,
} from '../presets';
import { checkWorldbookActivation, getWorldManifest, type WorldbookCheckResult } from '../worldbookManifest';

const choices = inject<LaunchChoices>('launchChoices')!;
const adapter = getHostAdapter();

const step4FileInputRef = ref<HTMLInputElement | null>(null);
const step4ImportErr = ref('');
const step4ImportWarnings = ref<string[]>([]);

function triggerStep4FileSelect() {
  step4FileInputRef.value?.click();
}

async function onStep4FileChange(e: Event) {
  const input = e.target as HTMLInputElement | null;
  const file = input?.files?.[0];
  if (!file) return;
  step4ImportErr.value = '';
  step4ImportWarnings.value = [];
  try {
    const res = await readSavePackFromFile(file);
    if (!res.ok) {
      step4ImportErr.value = res.error;
      return;
    }
    const { choices: next, warnings } = packToChoices(res.pack, { ...choices });
    Object.assign(choices, next);
    if (!choices.importedFrom) {
      choices.importedFrom = file.name || '本地备份文件';
    }
    step4ImportWarnings.value = warnings;
  } finally {
    if (input) input.value = '';
  }
}

const activeEntryMode = computed(() => findEntryMode(choices.entryMode));
const activeSystemLinkMode = computed(() =>
  findSystemLinkMode(resolveSystemLinkMode(choices), activeEntryMode.value.id),
);
const activeMaidenIncubationMode = computed(() =>
  findMaidenIncubationMode(resolveMaidenIncubationMode(choices)),
);
const activeTone = computed(() => findTone(choices.toneId));

function selectEntryMode(modeId: OpeningEntryMode) {
  choices.entryMode = modeId;
  choices.systemLinkMode = defaultSystemLinkModeForEntry(modeId);
}
const previewOpen = ref(false);
const messagePreview = computed(() => {
  try {
    return composeLaunchMessage(choices);
  } catch (e) {
    return `预览生成失败：${e instanceof Error ? e.message : String(e)}`;
  }
});

/* ── G3/P6 · 开局体检 ── */
const manifest = computed(() => getWorldManifest(choices.worldId));
const wbCheck = ref<WorldbookCheckResult | null>(null);
const wbBusy = ref(false);
const wbErr = ref('');

const requiredTotal = computed(() => {
  const baseCount = manifest.value?.books.filter(book => book.required).length ?? 0;
  if (baseCount === 0) return 0;
  const extraFactions = Math.max(0, resolveSelectedFactions(choices).length - 1);
  return baseCount + extraFactions * 4 + 1;
});
const requiredEnabled = computed(() =>
  wbCheck.value
    ? Math.max(0, requiredTotal.value - wbCheck.value.missing.length - wbCheck.value.unavailable.length)
    : 0,
);

function runWbCheck() {
  wbErr.value = '';
  try {
    if (!manifest.value) throw new Error(`world_id「${choices.worldId || '空'}」未注册`);
    wbCheck.value = checkWorldbookActivation(
      manifest.value,
      adapter.globalWorldbookNames(),
      adapter.allWorldbookNames(),
      resolveSelectedFactions(choices),
    );
  } catch (e) {
    wbCheck.value = null;
    wbErr.value = `体检失败：${e instanceof Error ? e.message : String(e)}`;
  }
}

async function repairWorldbooks() {
  if (!wbCheck.value || (!wbCheck.value.missing.length && !wbCheck.value.conflicting.length)) return;
  wbBusy.value = true;
  wbErr.value = '';
  try {
    await syncWorldbooksForWorld(adapter, choices.worldId, resolveSelectedFactions(choices));
    runWbCheck();
  } catch (e) {
    wbErr.value = `修复失败：${e instanceof Error ? e.message : String(e)}`;
  } finally {
    wbBusy.value = false;
  }
}

watch(() => [choices.worldId, ...resolveSelectedFactions(choices)], runWbCheck, { immediate: true });

const emit = defineEmits<{ launched: [] }>();

const launching = ref(false);
const failed = ref(false);
const errorMsg = ref('');
const progress = ref<StepProgress[]>([]);

function markOf(status: StepStatus): string {
  switch (status) {
    case 'done':
      return '✓';
    case 'skipped':
      return '－';
    case 'warning':
      return '⚠';
    case 'error':
      return '✗';
    default:
      return '…';
  }
}

function onProgress(p: StepProgress) {
  const idx = progress.value.findIndex(row => row.name === p.name);
  if (idx >= 0) progress.value.splice(idx, 1, p);
  else progress.value.push(p);
}

async function launch() {
  launching.value = true;
  failed.value = false;
  errorMsg.value = '';
  progress.value = [];
  try {
    const importedPack = choices.importedStat ? getSavePackForImportedStat(choices.importedStat) : undefined;
    await runLaunchPipeline(createLaunchSteps(), { adapter, choices, importedPack }, onProgress);
    emit('launched');
  } catch (e) {
    failed.value = true;
    errorMsg.value = e instanceof Error ? e.message : String(e);
  } finally {
    launching.value = false;
  }
}
</script>

<style scoped>
.entry-mode-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.tone-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.entry-mode-card,
.tone-card {
  width: 100%;
  font: inherit;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

@media (max-width: 760px) {
  .entry-mode-grid,
  .tone-grid {
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }
}

.entry-mode-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.fold-btn,
.mini-btn {
  background: var(--rac-panel);
  border: 1px solid var(--rac-dim);
  color: var(--rac-text);
  border-radius: 5px;
  padding: 7px 11px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.14s ease;
}

.fold-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  text-align: left;
  color: var(--rac-hi);
}

.fold-btn:hover:not(:disabled),
.mini-btn:hover:not(:disabled) {
  border-color: var(--rac-line);
}

.mini-btn:disabled,
.fold-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.mini-btn.go {
  margin-top: 6px;
  border-color: rgba(70, 209, 154, 0.55);
  background: rgba(70, 209, 154, 0.12);
  color: var(--rac-ok);
}

.msg-preview-box {
  margin-top: 6px;
  max-height: 170px;
  overflow-y: auto;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--rac-hi);
}

.import-status-card {
  padding: 9px 12px;
  border: 1px dashed var(--rac-dim);
  border-radius: 6px;
  background: rgba(9, 14, 19, 0.55);
}

.import-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.import-file-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.import-ok {
  font-size: 12px;
  color: var(--rac-ok);
}

.import-warn {
  margin-top: 4px;
  font-size: 11px;
  color: var(--rac-warn);
}

.import-err {
  margin-top: 4px;
  font-size: 12px;
  color: var(--rac-alert);
}

.wb-check-panel {
  padding: 11px 13px;
  border: 1px solid var(--rac-dim);
  border-radius: 6px;
  background: rgba(9, 14, 19, 0.72);
}

.wb-ok {
  margin-top: 6px;
  font-size: 12px;
  color: var(--rac-ok);
}

.wb-warn {
  margin-top: 6px;
  font-size: 12px;
  color: var(--rac-warn);
  line-height: 1.55;
}

.wb-bad {
  margin-top: 6px;
  font-size: 12px;
  color: var(--rac-alert);
  line-height: 1.55;
}

.wb-info {
  margin-top: 5px;
  font-size: 11px;
  color: var(--rac-muted);
}

.launch-btn {
  width: 100%;
  min-height: 48px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 14.5px;
  font-weight: 700;
  letter-spacing: 0.12em;
  border-radius: 6px;
  border: 1px solid var(--rac-ok);
  background: linear-gradient(135deg, rgba(70, 209, 154, 0.2), rgba(56, 189, 248, 0.12));
  color: var(--rac-hi);
  cursor: pointer;
  box-shadow: 0 4px 18px rgba(70, 209, 154, 0.15);
  transition: all 0.16s ease;
}

.launch-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(70, 209, 154, 0.3), rgba(56, 189, 248, 0.2));
  transform: translateY(-1px);
}

.launch-btn:disabled {
  opacity: 0.45;
  cursor: wait;
}

.launch-icon {
  color: var(--rac-ok);
  font-family: var(--mono);
}

.prog-panel {
  padding: 10px 12px;
  border: 1px solid var(--rac-dim);
  border-radius: 6px;
  background: var(--rac-panel);
}

.prog-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 5px 0;
  font-size: 12.5px;
  border-bottom: 1px dashed var(--rac-dim);
}

.prog-row:last-child {
  border-bottom: none;
}

.prog-mark {
  width: 18px;
  text-align: center;
  font-family: var(--mono);
}

.prog-row.done .prog-mark {
  color: var(--rac-ok);
}

.prog-row.skipped {
  color: var(--rac-muted);
}

.prog-row.warning .prog-mark {
  color: var(--rac-warn);
}

.prog-row.error .prog-mark {
  color: var(--rac-alert);
}

.prog-err {
  font-size: 11px;
  color: var(--rac-warn);
}

.prog-row.error .prog-err {
  color: var(--rac-alert);
}

.launch-err {
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 90, 54, 0.45);
  border-radius: 5px;
  background: rgba(255, 90, 54, 0.1);
  font-size: 12px;
  color: var(--rac-alert);
}
</style>
