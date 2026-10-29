<template>
  <div
    class="pda-tab-quests flex h-full flex-1 flex-col overflow-y-auto px-2.5 py-2 font-mono text-xs text-(--text,#d9e5ed) select-none"
    :data-active-count="activeQuests.length"
    :data-done-count="doneCount"
    :data-history-count="historyQuests.length"
    data-test="pda-tab-quests"
    data-testid="pda-tab-quests"
  >
    <!-- ══ 一、在途作战任务列表 (Active Quests) ══ -->
    <section
      class="mb-2.5 flex flex-col gap-1.5 rounded-sm border border-white/10 bg-black/30 p-2"
      data-test="pda-quests-section"
      data-testid="pda-quests-section"
    >
      <header
        class="flex items-center justify-between"
        data-test="pda-quests-header"
        data-testid="pda-quests-header"
      >
        <div class="flex items-center gap-1.5">
          <span
            class="size-2 rounded-full"
            :class="
              activeQuests.length > 0
                ? 'animate-pulse bg-(--ice,#8bc3e7) shadow-[0_0_6px_var(--ice,#8bc3e7)]'
                : 'bg-(--safe,#78b69b)'
            "
          />
          <span class="text-[11px] font-bold tracking-wide text-(--ice,#8bc3e7)">
            QUESTS // 作战任务指令板
          </span>
        </div>

        <div class="flex items-center gap-1.5 text-[10px]">
          <span
            class="rounded-xs bg-white/10 px-1.5 py-0.5 font-bold text-(--ice,#8bc3e7)"
            data-test="pda-quests-active-count"
            data-testid="pda-quests-active-count"
          >
            在途: {{ activeQuests.length }}
          </span>
          <span
            class="rounded-xs bg-(--safe,#78b69b)/20 px-1.5 py-0.5 font-bold text-(--safe,#78b69b)"
            data-test="pda-quests-done-count"
            data-testid="pda-quests-done-count"
          >
            已达成: {{ doneCount }}
          </span>
        </div>
      </header>

      <div
        v-if="activeQuests.length === 0"
        class="py-3 text-center text-[10px] text-(--text-3,#7a8e9a)"
        data-test="pda-quests-empty"
        data-testid="pda-quests-empty"
      >
        当前战区暂无在途作战任务指令
      </div>

      <div v-else class="flex flex-col gap-2" data-test="pda-quests-list" data-testid="pda-quests-list">
        <article
          v-for="(quest, idx) in activeQuests"
          :key="quest.name || idx"
          class="pda-quest-card flex flex-col gap-1.5 rounded-xs border border-(--line,rgba(141,180,207,0.22)) bg-black/45 p-2 transition-colors hover:border-(--line-hot,rgba(145,201,239,0.54))"
          :data-quest-name="quest.name"
          :data-quest-category="resolveQuestCategory(quest.category)"
          data-test="pda-quest-card"
          data-testid="pda-quest-card"
        >
          <!-- 顶栏：分类徽章 + 任务名称 + 进度 + 推进按钮 -->
          <div class="flex items-center justify-between gap-1.5">
            <div class="flex min-w-0 items-center gap-1.5">
              <span
                class="shrink-0 rounded-xs border px-1 py-0.5 text-[9px] leading-none font-bold"
                :class="questCategoryBadgeClass(quest.category)"
                :data-category="resolveQuestCategory(quest.category)"
                data-test="pda-quest-category"
                data-testid="pda-quest-category"
              >
                {{ resolveQuestCategory(quest.category) }}
              </span>
              <span
                v-if="getQuestSeries(quest) || getQuestChainStep(quest)"
                class="shrink-0 rounded-xs border border-(--amber,#d2ad69)/45 bg-(--amber,#d2ad69)/15 px-1 py-0.5 text-[9px] leading-none font-bold text-(--amber,#d2ad69)"
                :data-quest-series="getQuestSeries(quest) || '系列'"
                :data-quest-chain-step="getQuestChainStep(quest) || undefined"
                data-test="pda-quest-series"
                data-testid="pda-quest-series"
              >
                [{{ getQuestSeries(quest) || '系列' }}{{ getQuestChainStep(quest) ? ' · ' + getQuestChainStep(quest) : '' }}]
              </span>
              <span
                class="truncate text-[11px] font-bold text-(--text,#d9e5ed)"
                data-test="pda-quest-name"
                data-testid="pda-quest-name"
              >
                {{ quest.name }}
              </span>
            </div>

            <div class="flex shrink-0 items-center gap-1">
              <span
                v-if="quest.progress"
                class="shrink-0 rounded-xs bg-(--amber,#d2ad69)/20 px-1.5 py-0.5 text-[10px] leading-none font-bold text-(--amber,#d2ad69)"
                data-test="pda-quest-progress"
                data-testid="pda-quest-progress"
              >
                {{ quest.progress }}
              </span>
              <button
                type="button"
                class="shrink-0 cursor-pointer rounded-xs border border-(--line-hot,rgba(145,201,239,0.45)) bg-(--ice,#8bc3e7)/12 px-1.5 py-0.5 text-[10px] leading-none font-bold text-(--ice,#8bc3e7) transition-colors hover:bg-(--ice,#8bc3e7)/25 active:scale-95"
                data-test="pda-quest-advance-btn"
                data-testid="pda-quest-advance-btn"
                @click="onAdvanceQuest(quest)"
              >
                ▶ 推进
              </button>
            </div>
          </div>

          <!-- 发包方与推进填入视觉反馈行 -->
          <div
            v-if="hasText(quest.issuer) || advancedQuestName === quest.name"
            class="flex flex-wrap items-center justify-between gap-1 text-[10px]"
          >
            <span
              v-if="hasText(quest.issuer)"
              class="text-(--text-3,#7a8e9a)"
              data-test="pda-quest-issuer"
              data-testid="pda-quest-issuer"
            >
              发包: {{ quest.issuer?.trim() }}
            </span>
            <span
              v-if="advancedQuestName === quest.name"
              class="ml-auto font-bold text-(--safe,#78b69b)"
              data-test="pda-quest-advance-feedback"
              data-testid="pda-quest-advance-feedback"
            >
              ✓ 已填入指令框
            </span>
          </div>

          <p
            v-if="quest.note"
            class="text-[10px] leading-snug text-(--text-2,#8fa3b1)"
            data-test="pda-quest-note"
            data-testid="pda-quest-note"
          >
            {{ quest.note }}
          </p>

          <p
            v-if="quest.detail"
            class="border-t border-white/5 pt-1 text-[10px] leading-relaxed text-(--text-3,#7a8e9a)"
            data-test="pda-quest-detail"
            data-testid="pda-quest-detail"
          >
            {{ quest.detail }}
          </p>

          <div
            v-if="getQuestNextHook(quest)"
            class="rounded-xs border-l-2 border-(--ice,#8bc3e7) bg-(--ice,#8bc3e7)/10 px-1.5 py-1 text-[10px] leading-snug text-(--ice,#8bc3e7)"
            :data-quest-next="getQuestNextHook(quest)"
            data-test="pda-quest-next-hook"
            data-testid="pda-quest-next-hook"
          >
            下一环线索: {{ getQuestNextHook(quest) }}
          </div>

          <!-- 悬赏奖励胶囊预览 -->
          <div
            v-if="extractRewardPills(quest.rewards).length > 0"
            class="flex flex-wrap items-center gap-1 border-t border-white/5 pt-1"
            data-test="pda-quest-rewards"
            data-testid="pda-quest-rewards"
          >
            <span class="text-[9px] text-(--text-3,#7a8e9a)">悬赏:</span>
            <span
              v-for="pill in extractRewardPills(quest.rewards)"
              :key="pill.key"
              class="rounded-xs border px-1 py-0.5 text-[9px] leading-none font-bold"
              :class="rewardPillClass(pill.kind)"
              :data-reward-kind="pill.kind"
              data-test="pda-quest-reward-pill"
              data-testid="pda-quest-reward-pill"
            >
              {{ pill.label }}
            </span>
          </div>
        </article>
      </div>
    </section>

    <!-- ══ 二、已归档作战卷宗 (Archived / History Quests) ══ -->
    <section
      v-if="historyQuests.length > 0"
      class="mb-2.5 flex flex-col gap-1.5 rounded-sm border border-white/10 bg-black/30 p-2"
      data-test="pda-quests-history-section"
      data-testid="pda-quests-history-section"
    >
      <header
        class="flex cursor-pointer items-center justify-between"
        data-test="pda-quests-history-toggle"
        data-testid="pda-quests-history-toggle"
        @click="showHistory = !showHistory"
      >
        <div class="flex items-center gap-1.5">
          <span class="text-[10px] text-(--text-2,#8fa3b1)">{{ showHistory ? '▾' : '▸' }}</span>
          <span class="text-[11px] font-bold tracking-wide text-(--text-2,#8fa3b1)">
            ARCHIVED // 已归档作战卷宗
          </span>
        </div>
        <span
          class="rounded-xs bg-white/8 px-1.5 py-0.5 text-[10px] font-bold text-(--text-2,#8fa3b1)"
          data-test="pda-quests-history-count"
          data-testid="pda-quests-history-count"
        >
          归档: {{ historyQuests.length }}
        </span>
      </header>

      <div
        v-if="showHistory"
        class="flex flex-col gap-1.5"
        data-test="pda-quests-history-list"
        data-testid="pda-quests-history-list"
      >
        <article
          v-for="(item, idx) in historyQuests"
          :key="item.name || idx"
          class="flex flex-col gap-1 rounded-xs border border-white/10 bg-black/35 p-2"
          :data-quest-name="item.name"
          :data-quest-status="resolveHistoryStatusLabel(item.status)"
          data-test="pda-quest-history-card"
          data-testid="pda-quest-history-card"
        >
          <div class="flex flex-wrap items-center justify-between gap-1">
            <div class="flex min-w-0 items-center gap-1.5">
              <span
                class="shrink-0 rounded-xs border px-1 py-0.5 text-[9px] leading-none font-bold"
                :class="questCategoryBadgeClass(item.category)"
              >
                {{ resolveQuestCategory(item.category) }}
              </span>
              <span
                v-if="getQuestSeries(item) || getQuestChainStep(item)"
                class="shrink-0 rounded-xs border border-(--amber,#d2ad69)/45 bg-(--amber,#d2ad69)/15 px-1 py-0.5 text-[9px] leading-none font-bold text-(--amber,#d2ad69)"
                :data-quest-series="getQuestSeries(item) || '系列'"
                :data-quest-chain-step="getQuestChainStep(item) || undefined"
                data-test="pda-quest-series"
                data-testid="pda-quest-series"
              >
                [{{ getQuestSeries(item) || '系列' }}{{ getQuestChainStep(item) ? ' · ' + getQuestChainStep(item) : '' }}]
              </span>
              <span
                class="truncate text-[11px] font-bold text-(--text,#d9e5ed)"
                data-test="pda-quest-history-name"
                data-testid="pda-quest-history-name"
              >
                {{ item.name }}
              </span>
            </div>

            <div class="flex shrink-0 items-center gap-1 text-[9px]">
              <span
                class="rounded-xs border px-1.5 py-0.5 leading-none font-bold"
                :class="
                  isFailedOrCancelledStatus(item.status)
                    ? 'border-(--alert-bright,#ff5a36)/45 bg-(--alert-bright,#ff5a36)/15 text-(--alert-bright,#ff5a36)'
                    : 'border-(--safe,#78b69b)/45 bg-(--safe,#78b69b)/18 text-(--safe,#78b69b)'
                "
                data-test="pda-quest-history-status"
                data-testid="pda-quest-history-status"
              >
                {{ resolveHistoryStatusBadge(item.status) }}
              </span>
              <span
                v-if="!isFailedOrCancelledStatus(item.status) && item.reward_claimed !== false"
                class="rounded-xs border border-(--safe,#78b69b)/45 bg-(--safe,#78b69b)/20 px-1.5 py-0.5 leading-none font-bold text-(--safe,#78b69b)"
                data-test="pda-quest-history-claimed"
                data-testid="pda-quest-history-claimed"
              >
                悬赏已交割
              </span>
            </div>
          </div>

          <p
            v-if="item.note || item.progress || item.detail"
            class="text-[10px] leading-snug text-(--text-2,#8fa3b1)"
            data-test="pda-quest-history-note"
            data-testid="pda-quest-history-note"
          >
            {{ item.note || item.progress || item.detail }}
          </p>

          <div
            v-if="getQuestNextHook(item)"
            class="rounded-xs border-l-2 border-(--ice,#8bc3e7) bg-(--ice,#8bc3e7)/10 px-1.5 py-1 text-[10px] leading-snug text-(--ice,#8bc3e7)"
            :data-quest-next="getQuestNextHook(item)"
            data-test="pda-quest-next-hook"
            data-testid="pda-quest-next-hook"
          >
            下一环线索: {{ getQuestNextHook(item) }}
          </div>

          <div
            v-if="extractRewardPills(item.rewards).length > 0"
            class="flex flex-wrap items-center gap-1 border-t border-white/5 pt-1"
            data-test="pda-quest-history-rewards"
            data-testid="pda-quest-history-rewards"
          >
            <span class="text-[9px] text-(--text-3,#7a8e9a)">已领奖励:</span>
            <span
              v-for="pill in extractRewardPills(item.rewards)"
              :key="pill.key"
              class="rounded-xs border px-1 py-0.5 text-[9px] leading-none font-bold"
              :class="rewardPillClass(pill.kind)"
              :data-reward-kind="pill.kind"
              data-test="pda-quest-history-reward-pill"
              data-testid="pda-quest-history-reward-pill"
            >
              {{ pill.label }}
            </span>
          </div>
        </article>
      </div>
    </section>

    <!-- ══ 三、本地战术备忘录输入框 (Tactical Memo) ══ -->
    <section
      class="flex flex-col gap-1.5 rounded-sm border border-white/10 bg-black/30 p-2"
      data-test="pda-quests-memo-section"
      data-testid="pda-quests-memo-section"
    >
      <header class="flex items-center justify-between">
        <span class="text-[11px] font-bold tracking-wide text-(--ice,#8bc3e7)">
          TACTICAL MEMO // 战术备忘录
        </span>
        <button
          type="button"
          class="cursor-pointer rounded-xs border border-(--line-hot,rgba(145,201,239,0.45)) bg-white/5 px-1.5 py-0.5 text-[10px] leading-none text-(--ice,#8bc3e7) transition-colors hover:bg-white/15 active:scale-95"
          data-test="pda-quests-memo-save"
          data-testid="pda-quests-memo-save"
          @click="onSaveMemo"
        >
          保存备忘
        </button>
      </header>

      <textarea
        v-model="memoDraft"
        rows="3"
        placeholder="记录当前作战任务推进要点、兵力部署或阶段目标备忘..."
        class="w-full resize-none rounded-xs border border-white/10 bg-black/50 p-1.5 font-mono text-[11px] leading-relaxed text-(--text,#d9e5ed) select-text placeholder:text-(--text-4,#354957) focus:border-(--line-hot,rgba(145,201,239,0.54)) focus:outline-none"
        data-test="pda-quests-memo-input"
        data-testid="pda-quests-memo-input"
      />

      <div
        v-if="memoSavedNotice"
        class="text-right text-[10px] text-(--safe,#78b69b)"
        data-test="pda-quests-memo-saved"
        data-testid="pda-quests-memo-saved"
      >
        ✓ 战术备忘录已同步至掌上缓存
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { getActivePinia } from 'pinia';
import { computed, getCurrentInstance, onUnmounted, ref, watch } from 'vue';
import type { Quest, Schema } from '../../红警指挥系统/core/schema';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';
import { fillHostSendInput } from '../../红警指挥系统/worldbook/hostSendInput';

export interface QuestRewardLike {
  credits?: number;
  intel_points?: number;
  resources?: Record<string, Record<string, number>>;
  items?: readonly string[];
  text?: string;
  unlock_factions?: readonly string[];
  unlock_units?: readonly {
    name: string;
    kind?: string;
    producer?: string;
    cost?: number;
    desc?: string;
    faction?: string;
  }[];
  troops?: Record<string, number>;
  vehicles?: readonly string[];
  chains?: readonly {
    id?: string;
    name: string;
    rate_daily: number;
    capacity?: number;
  }[];
  protocols?: readonly string[];
  factions?: readonly {
    name: string;
    attitude?: string;
    intel?: string;
  }[];
  wallet?: Record<string, number>;
  girl_rewards?: readonly {
    name: string;
    affection_delta?: number;
    obedience_delta?: number;
    traits?: readonly string[];
  }[];
  tech_boost?: {
    name: string;
    progress_delta: number;
  } | null;
}

export type PdaQuestReward = QuestRewardLike;

export type PdaQuestItem = Quest & {
  category?: string;
  status?: string;
  issuer?: string;
  series?: string;
  chain_step?: string;
  next_quest?: string;
  rewards?: QuestRewardLike;
  reward_claimed?: boolean;
  updated_floor?: number;
};

export interface PdaQuestsPayload {
  active?: readonly PdaQuestItem[];
  history?: readonly PdaQuestItem[];
  done_count?: number;
}

export type PdaQuestRewardPillKind =
  | 'credits'
  | 'intel'
  | 'resource'
  | 'unlock_faction'
  | 'unlock_unit'
  | 'troop'
  | 'vehicle'
  | 'chain'
  | 'protocol'
  | 'faction'
  | 'wallet'
  | 'girl'
  | 'tech_boost'
  | 'item'
  | 'text';

export interface PdaQuestRewardPill {
  key: string;
  label: string;
  kind: PdaQuestRewardPillKind;
}

export interface PdaTabQuestsProps {
  snapshot?: (Partial<Schema> & { quests?: PdaQuestsPayload }) | null;
  quests?: PdaQuestsPayload | readonly PdaQuestItem[];
  memo?: string;
}

const props = withDefaults(defineProps<PdaTabQuestsProps>(), {
  snapshot: undefined,
  quests: undefined,
  memo: '',
});

const emit = defineEmits<{
  (e: 'update:memo', text: string): void;
  (e: 'save-memo', text: string): void;
  (e: 'advance-quest', quest: PdaQuestItem, commandText: string): void;
}>();

const memoDraft = ref<string>(props.memo);
const memoSavedNotice = ref(false);
const showHistory = ref(true);
const advancedQuestName = ref<string | null>(null);
let advanceFeedbackTimer: ReturnType<typeof setTimeout> | null = null;

if (getCurrentInstance()) {
  onUnmounted(() => {
    if (advanceFeedbackTimer !== null) {
      clearTimeout(advanceFeedbackTimer);
      advanceFeedbackTimer = null;
    }
  });
}

watch(
  () => props.memo,
  next => {
    if (next !== undefined) {
      memoDraft.value = next;
    }
  },
);

const storeSnapshot = computed<(Partial<Schema> & { quests?: PdaQuestsPayload }) | null>(() => {
  if (props.snapshot !== undefined) return props.snapshot;
  try {
    const pinia = getActivePinia();
    if (!pinia) return null;
    const floating = useFloatingStore(pinia);
    return floating.snapshot as (Partial<Schema> & { quests?: PdaQuestsPayload }) | null;
  } catch {
    return null;
  }
});

const activeQuests = computed<readonly PdaQuestItem[]>(() => {
  if (Array.isArray(props.quests)) {
    return props.quests;
  }
  if (props.quests && typeof props.quests === 'object' && 'active' in props.quests && Array.isArray(props.quests.active)) {
    return props.quests.active;
  }
  return (storeSnapshot.value?.quests as PdaQuestsPayload | undefined)?.active ?? [];
});

const historyQuests = computed<readonly PdaQuestItem[]>(() => {
  if (
    props.quests &&
    !Array.isArray(props.quests) &&
    typeof props.quests === 'object' &&
    'history' in props.quests &&
    Array.isArray(props.quests.history)
  ) {
    return props.quests.history;
  }
  const snapshotHistory = (storeSnapshot.value?.quests as PdaQuestsPayload | undefined)?.history;
  return Array.isArray(snapshotHistory) ? snapshotHistory : [];
});

const doneCount = computed<number>(() => {
  if (
    props.quests &&
    !Array.isArray(props.quests) &&
    typeof props.quests === 'object' &&
    'done_count' in props.quests &&
    typeof props.quests.done_count === 'number'
  ) {
    return props.quests.done_count;
  }
  return storeSnapshot.value?.quests?.done_count ?? 0;
});

function hasText(val?: string | null): boolean {
  return typeof val === 'string' && val.trim().length > 0;
}

function getQuestSeries(quest?: PdaQuestItem | Record<string, unknown> | null): string {
  if (!quest || typeof quest !== 'object') return '';
  const rec = quest as Record<string, unknown>;
  const raw = rec.series ?? rec['系列'] ?? rec.chain ?? rec['任务链'];
  return typeof raw === 'string' ? raw.trim() : '';
}

function getQuestChainStep(quest?: PdaQuestItem | Record<string, unknown> | null): string {
  if (!quest || typeof quest !== 'object') return '';
  const rec = quest as Record<string, unknown>;
  const raw = rec.chain_step ?? rec.chainStep ?? rec['环数'] ?? rec['阶段环'];
  return typeof raw === 'string' ? raw.trim() : '';
}

function getQuestNextHook(quest?: PdaQuestItem | Record<string, unknown> | null): string {
  if (!quest || typeof quest !== 'object') return '';
  const rec = quest as Record<string, unknown>;
  const raw =
    rec.next_quest ?? rec.nextQuest ?? rec['后续任务'] ?? rec['下一环'] ?? rec['后续线索'];
  return typeof raw === 'string' ? raw.trim() : '';
}

function resolveQuestCategory(category?: string): string {
  const raw = typeof category === 'string' ? category.trim() : '';
  return raw || '支线';
}

function questCategoryBadgeClass(category?: string): string {
  const cat = resolveQuestCategory(category);
  if (cat === '主线') {
    return 'border-(--amber,#d2ad69)/50 bg-(--amber,#d2ad69)/20 text-(--amber,#d2ad69)';
  }
  if (cat === '紧急') {
    return 'border-(--alert-bright,#ff5a36)/50 bg-(--alert-bright,#ff5a36)/20 text-(--alert-bright,#ff5a36)';
  }
  if (cat === '指令') {
    return 'border-(--safe,#78b69b)/50 bg-(--safe,#78b69b)/20 text-(--safe,#78b69b)';
  }
  if (cat === '日常') {
    return 'border-white/20 bg-white/10 text-(--text-2,#8fa3b1)';
  }
  return 'border-(--ice,#8bc3e7)/45 bg-(--ice,#8bc3e7)/15 text-(--ice,#8bc3e7)';
}

function extractRewardPills(rewards?: QuestRewardLike): PdaQuestRewardPill[] {
  if (!rewards || typeof rewards !== 'object') return [];
  const pills: PdaQuestRewardPill[] = [];

  if (typeof rewards.credits === 'number' && rewards.credits > 0) {
    pills.push({
      key: 'credits',
      label: `资金 +${rewards.credits}`,
      kind: 'credits',
    });
  }

  if (typeof rewards.intel_points === 'number' && rewards.intel_points > 0) {
    pills.push({
      key: 'intel_points',
      label: `机密点 +${rewards.intel_points}`,
      kind: 'intel',
    });
  }

  if (rewards.resources && typeof rewards.resources === 'object') {
    for (const [pillar, subRecord] of Object.entries(rewards.resources)) {
      if (!subRecord || typeof subRecord !== 'object') continue;
      for (const [subName, qty] of Object.entries(subRecord)) {
        if (typeof qty === 'number' && qty > 0) {
          pills.push({
            key: `res-${pillar}-${subName}`,
            label: `${subName} +${qty}`,
            kind: 'resource',
          });
        }
      }
    }
  }

  if (Array.isArray(rewards.unlock_factions)) {
    for (const f of rewards.unlock_factions) {
      const name = typeof f === 'string' ? f.trim() : '';
      if (name) {
        pills.push({
          key: `unlock-faction-${name}`,
          label: `🎖️ 阵营启封: ${name}`,
          kind: 'unlock_faction',
        });
      }
    }
  }

  if (Array.isArray(rewards.unlock_units)) {
    for (const u of rewards.unlock_units) {
      if (!u || typeof u !== 'object') continue;
      const unitName = typeof u.name === 'string' ? u.name.trim() : '';
      if (!unitName) continue;
      const producer =
        (typeof u.producer === 'string' && u.producer.trim()) ||
        (u.kind === '人员' ? '兵营' : '战车工厂');
      pills.push({
        key: `unlock-unit-${producer}-${unitName}`,
        label: `🏭 ${producer}解锁: ${unitName}`,
        kind: 'unlock_unit',
      });
    }
  }

  if (rewards.troops && typeof rewards.troops === 'object') {
    for (const [k, v] of Object.entries(rewards.troops)) {
      const troopName = k.trim();
      if (troopName && typeof v === 'number' && v > 0) {
        pills.push({
          key: `troop-${troopName}`,
          label: `🪖 兵营整备: ${troopName} +${v}`,
          kind: 'troop',
        });
      }
    }
  }

  if (Array.isArray(rewards.vehicles)) {
    rewards.vehicles.forEach((v, idx) => {
      const vehName = typeof v === 'string' ? v.trim() : '';
      if (vehName) {
        pills.push({
          key: `vehicle-${idx}-${vehName}`,
          label: `🚜 车厂整备: ${vehName}`,
          kind: 'vehicle',
        });
      }
    });
  }

  if (Array.isArray(rewards.chains)) {
    for (const c of rewards.chains) {
      if (!c || typeof c !== 'object') continue;
      const chainName = typeof c.name === 'string' ? c.name.trim() : '';
      if (chainName && typeof c.rate_daily === 'number') {
        pills.push({
          key: `chain-${chainName}`,
          label: `💰 资金链: ${chainName}(+${c.rate_daily}/日)`,
          kind: 'chain',
        });
      }
    }
  }

  if (Array.isArray(rewards.protocols)) {
    for (const p of rewards.protocols) {
      const protoName = typeof p === 'string' ? p.trim() : '';
      if (protoName) {
        pills.push({
          key: `protocol-${protoName}`,
          label: `📡 协议线索: ${protoName}`,
          kind: 'protocol',
        });
      }
    }
  }

  if (Array.isArray(rewards.factions)) {
    for (const f of rewards.factions) {
      if (!f || typeof f !== 'object') continue;
      const facName = typeof f.name === 'string' ? f.name.trim() : '';
      if (!facName) continue;
      const attitude = typeof f.attitude === 'string' && f.attitude.trim() ? f.attitude.trim() : '';
      pills.push({
        key: `faction-${facName}`,
        label: `🤝 势力: ${facName}${attitude ? `(${attitude})` : ''}`,
        kind: 'faction',
      });
    }
  }

  if (rewards.wallet && typeof rewards.wallet === 'object') {
    for (const [k, v] of Object.entries(rewards.wallet)) {
      const currency = k.trim();
      if (currency && typeof v === 'number' && v > 0) {
        pills.push({
          key: `wallet-${currency}`,
          label: `🪙 ${currency} +${v}`,
          kind: 'wallet',
        });
      }
    }
  }

  if (Array.isArray(rewards.girl_rewards)) {
    for (const g of rewards.girl_rewards) {
      if (!g || typeof g !== 'object') continue;
      const girlName = typeof g.name === 'string' ? g.name.trim() : '';
      if (!girlName) continue;
      const traits = Array.isArray(g.traits) ? g.traits.map(t => String(t).trim()).filter(Boolean) : [];
      pills.push({
        key: `girl-${girlName}`,
        label: `💖 ${girlName}${g.affection_delta ? ` 好感+${g.affection_delta}` : ''}${g.obedience_delta ? ` 服从+${g.obedience_delta}` : ''}${traits.length ? ` [${traits.join('/')}]` : ''}`,
        kind: 'girl',
      });
    }
  }

  if (rewards.tech_boost && typeof rewards.tech_boost === 'object') {
    const tb = rewards.tech_boost;
    const techName = typeof tb.name === 'string' ? tb.name.trim() : '';
    if (techName && typeof tb.progress_delta === 'number') {
      pills.push({
        key: `tech-boost-${techName}`,
        label: `🔬 科研助力: ${techName} +${tb.progress_delta}%`,
        kind: 'tech_boost',
      });
    }
  }

  if (Array.isArray(rewards.items)) {
    for (const item of rewards.items) {
      const text = typeof item === 'string' ? item.trim() : '';
      if (text) {
        pills.push({
          key: `item-${text}`,
          label: text,
          kind: 'item',
        });
      }
    }
  }

  if (typeof rewards.text === 'string' && rewards.text.trim().length > 0) {
    pills.push({
      key: 'text',
      label: rewards.text.trim(),
      kind: 'text',
    });
  }

  return pills;
}

const formatQuestRewardPills = extractRewardPills;

function rewardPillClass(kind: PdaQuestRewardPill['kind']): string {
  if (kind === 'credits' || kind === 'chain' || kind === 'wallet') {
    return 'border-(--amber,#d2ad69)/45 bg-(--amber,#d2ad69)/15 text-(--amber,#d2ad69)';
  }
  if (kind === 'unlock_faction') {
    return 'border-(--alert-bright,#ff5a36)/50 bg-(--alert-bright,#ff5a36)/18 text-(--alert-bright,#ff5a36)';
  }
  if (kind === 'intel' || kind === 'protocol' || kind === 'tech_boost' || kind === 'unlock_unit') {
    return 'border-(--ice,#8bc3e7)/45 bg-(--ice,#8bc3e7)/15 text-(--ice,#8bc3e7)';
  }
  if (kind === 'resource' || kind === 'troop' || kind === 'vehicle' || kind === 'faction') {
    return 'border-(--safe,#78b69b)/45 bg-(--safe,#78b69b)/15 text-(--safe,#78b69b)';
  }
  if (kind === 'girl') {
    return 'border-pink-400/45 bg-pink-400/15 text-pink-300';
  }
  return 'border-white/20 bg-white/8 text-(--text-2,#8fa3b1)';
}

function isFailedOrCancelledStatus(status?: string): boolean {
  const s = typeof status === 'string' ? status.trim().toLowerCase() : '';
  return (
    s === '已失败' ||
    s === '已取消' ||
    s === '失败' ||
    s === '取消' ||
    s === '终止' ||
    s === 'failed' ||
    s === 'cancelled' ||
    s === 'aborted'
  );
}

function resolveHistoryStatusLabel(status?: string): string {
  const raw = typeof status === 'string' ? status.trim() : '';
  if (!raw) return '已完成';
  return raw;
}

function resolveHistoryStatusBadge(status?: string): string {
  const label = resolveHistoryStatusLabel(status);
  if (isFailedOrCancelledStatus(label)) {
    return `✕ ${label}`;
  }
  return `✓ ${label}`;
}

function buildAdvanceQuestCommand(quest: PdaQuestItem): string {
  const targetDesc =
    (typeof quest.progress === 'string' && quest.progress.trim()) ||
    (typeof quest.note === 'string' && quest.note.trim()) ||
    (typeof quest.detail === 'string' && quest.detail.trim()) ||
    '按指令推进';
  return `【推进作战任务：${quest.name}】调配战区兵力与资源执行阶段目标——${targetDesc}`;
}

function fillHostTextareaWithCommand(commandText: string): boolean {
  let filled = false;
  try {
    const parentDoc = typeof window !== 'undefined' ? window.parent?.document : undefined;
    const selfDoc = typeof document !== 'undefined' ? document : undefined;
    const frameDoc =
      typeof window !== 'undefined'
        ? (window.frameElement as HTMLElement | null | undefined)?.ownerDocument
        : undefined;
    const textarea = (
      parentDoc?.querySelector?.('#send_textarea') ??
      selfDoc?.querySelector?.('#send_textarea') ??
      frameDoc?.querySelector?.('#send_textarea') ??
      null
    ) as HTMLTextAreaElement | null;

    if (textarea) {
      textarea.value = commandText;
      if (typeof Event !== 'undefined' && typeof textarea.dispatchEvent === 'function') {
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
      textarea.focus?.();
      filled = true;
    }
  } catch {
    // 忽略跨域或非浏览器环境异常，继续走统一通道兜底
  }

  if (!filled) {
    try {
      filled = fillHostSendInput(commandText) !== 'failed';
    } catch {
      filled = false;
    }
  }
  return filled;
}

function onAdvanceQuest(quest: PdaQuestItem): string {
  const commandText = buildAdvanceQuestCommand(quest);
  fillHostTextareaWithCommand(commandText);
  advancedQuestName.value = quest.name;
  if (advanceFeedbackTimer !== null) {
    clearTimeout(advanceFeedbackTimer);
  }
  advanceFeedbackTimer = setTimeout(() => {
    if (advancedQuestName.value === quest.name) {
      advancedQuestName.value = null;
    }
    advanceFeedbackTimer = null;
  }, 2200);
  emit('advance-quest', quest, commandText);
  return commandText;
}

function onSaveMemo() {
  memoSavedNotice.value = true;
  emit('update:memo', memoDraft.value);
  emit('save-memo', memoDraft.value);
}

defineExpose({
  activeQuests,
  historyQuests,
  doneCount,
  showHistory,
  advancedQuestName,
  memoDraft,
  getQuestSeries,
  getQuestChainStep,
  getQuestNextHook,
  extractRewardPills,
  formatQuestRewardPills,
  buildAdvanceQuestCommand,
  onAdvanceQuest,
  onSaveMemo,
});
</script>

<style scoped>
.pda-tab-quests {
  box-sizing: border-box;
}
</style>
