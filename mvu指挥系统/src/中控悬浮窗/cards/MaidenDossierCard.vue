<template>
  <article
    ref="cardRootRef"
    class="tw-maiden-dossier-card"
    data-test="maiden-dossier-card"
    :data-maiden-name="resolved.name"
    :data-maiden-serial="resolved.serial"
    :data-maiden-seq="resolved.seq"
    :style="rootCssVars"
  >
    <header class="tw-maiden-dossier-header">
      <span class="tw-maiden-dossier-seal">
        MAIDEN DOSSIER // 战区机娘正式入列档案
      </span>
      <span class="tw-maiden-dossier-seq" data-test="maiden-seq-badge">
        {{ resolved.seq }}
      </span>
    </header>

    <div class="tw-maiden-dossier-identity">
      <strong class="tw-maiden-dossier-name" data-test="maiden-dossier-name">
        【{{ displayName }}】
      </strong>
      <span class="tw-maiden-dossier-stamp" data-test="maiden-dossier-serial">
        出厂钢印 #{{ resolved.serial }}
      </span>
      <span class="tw-maiden-dossier-stamp" data-test="maiden-dossier-model">
        机体型号：{{ resolved.model }}
      </span>
      <span class="tw-maiden-dossier-stamp" data-test="maiden-dossier-faction">
        所属阵营：{{ resolved.factionLabel }}
      </span>
    </div>

    <section class="tw-maiden-dossier-section" data-test="maiden-dossier-body-section">
      <div class="tw-maiden-dossier-section-title">【机体与外貌特征】</div>
      <div class="tw-maiden-dossier-section-body" data-test="maiden-dossier-body">
        {{ bodyAndAppearanceText }}
      </div>
    </section>

    <section class="tw-maiden-dossier-section" data-test="maiden-dossier-mind-section">
      <div class="tw-maiden-dossier-section-title">【心智性格与现状】</div>
      <div class="tw-maiden-dossier-section-body" data-test="maiden-dossier-personality">
        {{ personalityAndStatusText }}
      </div>
    </section>

    <section class="tw-maiden-dossier-section" data-test="maiden-dossier-shell-section">
      <div class="tw-maiden-dossier-section-title">【对外伪装身份】</div>
      <div
        v-if="shellDeferred"
        class="tw-maiden-shell-deferred"
        data-test="maiden-shell-deferred"
      >
        🔒 基地内勤 · 尚未安排对外伪装身份（执行外勤时解锁）
      </div>
      <div
        v-else
        class="tw-maiden-shell-woven"
        data-test="maiden-shell-woven"
      >
        {{ wovenShellText }}
      </div>
    </section>

    <section class="tw-maiden-dossier-accordion">
      <button
        type="button"
        class="tw-maiden-dossier-toggle"
        data-test="maiden-dossier-toggle"
        :aria-expanded="detailsOpen ? 'true' : 'false'"
        @click="toggleDetails"
      >
        {{ detailsOpen ? '▼ 收起战术卷宗' : '▶ 展开战术能力与武装暴露分档' }}
      </button>

      <div
        v-if="detailsOpen"
        class="tw-maiden-dossier-details"
        data-test="maiden-dossier-details"
      >
        <div class="tw-maiden-dossier-spec-row" data-test="maiden-form-mech">
          形态机制：{{ resolved.form_mech || '常规纳米重构' }}
        </div>
        <div class="tw-maiden-dossier-spec-row" data-test="maiden-skills">
          专属能力：{{ resolved.skills || '制式协同作战' }}
        </div>
        <div class="tw-maiden-dossier-spec-row" data-test="maiden-flaws">
          结构短板：{{ resolved.flaws || '暂无显著短板记录' }}
        </div>
        <div class="tw-maiden-dossier-spec-row" data-test="maiden-weapons">
          制式武装：{{ resolved.weapons || '车载主武器系统' }}
        </div>
        <div class="tw-maiden-dossier-spec-row" data-test="maiden-exposure">
          暴露分档：{{ resolved.exposure || 'EL-0 ~ EL-4 标准分级' }}
        </div>
        <div class="tw-maiden-dossier-spec-row" data-test="maiden-balance">
          平衡位置：{{ resolved.balance || '战区主力节点' }}
        </div>
      </div>
    </section>
  </article>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  playTacticalModalEnter,
  scheduleNextFrame,
  useTacticalModalMotion,
} from '../../红警指挥系统/ui/motion/useGsapMotion';
import {
  FACTION_DEFAULT_THEMES,
  isMaidenShellDeferred,
  normalizeFactionKey,
  parseMaidenDossierPayload,
  sanitizeCardColor,
  type FactionColorPalette,
  type ParsedMaidenDossierCard,
} from './floorCardHydrator';

const props = defineProps<{
  payload?: string | Record<string, unknown> | ParsedMaidenDossierCard | null;
  dossier?: ParsedMaidenDossierCard;
  name?: string;
  callsign?: string;
  serial?: string;
  model?: string;
  seq?: string;
  faction?: string;
  body?: string;
  appearance?: string;
  personality?: string;
  form_mech?: string;
  skills?: string;
  flaws?: string;
  weapons?: string;
  exposure?: string;
  balance?: string;
  alias?: string;
  shell?: string;
  status?: string;
  triggers?: string[];
  colors?: Partial<FactionColorPalette>;
  initialExpanded?: boolean;
}>();

const emit = defineEmits<{
  (e: 'toggle-expand', open: boolean): void;
}>();

const cardRootRef = ref<HTMLElement | null>(null);
useTacticalModalMotion(cardRootRef, undefined, { duration: 0.2 });

const detailsOpen = ref(Boolean(props.initialExpanded));

function toggleDetails(): void {
  detailsOpen.value = !detailsOpen.value;
  if (detailsOpen.value) {
    scheduleNextFrame(() => playTacticalModalEnter(cardRootRef.value, null, { duration: 0.18 }));
  }
  emit('toggle-expand', detailsOpen.value);
}

const resolved = computed<ParsedMaidenDossierCard>(() => {
  if (props.dossier) {
    return props.dossier;
  }
  if (props.payload) {
    if (
      typeof props.payload === 'object' &&
      'colors' in props.payload &&
      'factionLabel' in props.payload
    ) {
      return props.payload as ParsedMaidenDossierCard;
    }
    const fromPayload = parseMaidenDossierPayload(
      props.payload as string | Record<string, unknown>,
    );
    if (fromPayload) return fromPayload;
  }

  const factionKey = normalizeFactionKey(props.faction, `${props.model ?? ''} ${props.serial ?? ''}`);
  const palette = FACTION_DEFAULT_THEMES[factionKey];
  const factionLabel =
    props.faction?.trim() ||
    (factionKey === 'soviet' ? '苏联' : factionKey === 'yuri' ? '尤里' : '盟军');

  return {
    name: props.name || props.callsign || '未命名机娘',
    callsign: props.callsign || props.name || '待授名',
    serial: props.serial || 'UNASSIGNED',
    model: props.model || '标准战术机娘',
    seq: props.seq || '首台原型',
    faction: factionKey,
    factionLabel,
    body: props.body || '',
    appearance: props.appearance || '',
    personality: props.personality || '',
    form_mech: props.form_mech || '',
    skills: props.skills || '',
    flaws: props.flaws || '',
    weapons: props.weapons || '',
    exposure: props.exposure || '',
    balance: props.balance || '',
    alias: props.alias || '',
    shell: props.shell || '',
    status: props.status || '',
    triggers: props.triggers ?? [],
    colors: {
      primary: sanitizeCardColor(props.colors?.primary, palette.primary),
      accent: sanitizeCardColor(props.colors?.accent, palette.accent),
      bg: sanitizeCardColor(props.colors?.bg, palette.bg),
    },
  };
});

const rootCssVars = computed(() => ({
  '--card-primary': resolved.value.colors.primary,
  '--card-accent': resolved.value.colors.accent,
  '--card-bg': resolved.value.colors.bg,
}));

const displayName = computed(() => {
  const c = resolved.value.callsign;
  const n = resolved.value.name;
  return c && c !== n ? `${c}（${n}）` : n || c;
});

const bodyAndAppearanceText = computed(() => {
  const parts = [
    resolved.value.body ? `躯体特征：${resolved.value.body}` : '',
    resolved.value.appearance ? `外观外貌：${resolved.value.appearance}` : '',
  ].filter(Boolean);
  return parts.join(' ｜ ') || '标准纳米人形构造体';
});

const personalityAndStatusText = computed(() => {
  const parts = [
    resolved.value.personality ? `性格特质：${resolved.value.personality}` : '',
    resolved.value.status ? `当前现状：${resolved.value.status}` : '',
  ].filter(Boolean);
  return parts.join(' ｜ ') || '心智核心已锚定';
});

const shellDeferred = computed(() =>
  isMaidenShellDeferred(resolved.value.shell, resolved.value.alias),
);

const wovenShellText = computed(() =>
  [resolved.value.alias, resolved.value.shell].filter(Boolean).join(' · '),
);

defineExpose({
  detailsOpen,
  toggleDetails,
  resolved,
});
</script>

<style scoped>
.tw-maiden-dossier-card {
  border: 1px solid var(--card-primary, #c93b2b);
  background: var(--card-bg, #140c0c);
  color: #f1f5f9;
  border-radius: 6px;
  padding: 14px 16px;
  font-family: "Noto Serif SC", "Microsoft YaHei", sans-serif;
}
.tw-maiden-dossier-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.14);
  padding-bottom: 8px;
  margin-bottom: 10px;
}
.tw-maiden-dossier-seal {
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--card-accent, #d4a84f);
  font-weight: 700;
}
.tw-maiden-dossier-seq {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 3px;
  border: 1px solid var(--card-accent, #d4a84f);
  color: var(--card-accent, #d4a84f);
}
.tw-maiden-dossier-identity {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
}
.tw-maiden-dossier-name {
  font-size: 20px;
  font-weight: 800;
  color: #ffffff;
}
.tw-maiden-dossier-stamp {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: var(--card-accent, #d4a84f);
}
.tw-maiden-dossier-section {
  background: rgba(0, 0, 0, 0.28);
  border-left: 3px solid var(--card-primary, #c93b2b);
  padding: 8px 10px;
  margin-bottom: 8px;
  border-radius: 2px;
}
.tw-maiden-dossier-section-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--card-accent, #d4a84f);
  margin-bottom: 4px;
}
.tw-maiden-dossier-toggle {
  width: 100%;
  text-align: left;
  background: rgba(255, 255, 255, 0.06);
  color: var(--card-accent, #d4a84f);
  border: 1px solid rgba(255, 255, 255, 0.16);
  padding: 7px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  margin-top: 6px;
}
.tw-maiden-dossier-details {
  margin-top: 8px;
  padding: 10px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px dashed rgba(255, 255, 255, 0.18);
  border-radius: 4px;
}
</style>
