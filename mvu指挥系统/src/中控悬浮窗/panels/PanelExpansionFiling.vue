<template>
  <!--
    扩展档案入档与提升（F1 · CTRL-CHATBOOK-02 §2 / §4 / §6 信息合同 & FD-32 人物分支，中控台设置弹窗「扩展」组）
    ① 扩展入档：pending_expansions 列表 + 自动入档开关（rts-expansion-autofile，默认开）+ 手动入档 + 回执；
       自动观察者由中控 index.ts 的 installExpansionAutoFiler 唯一安装，本组件不自建观察者。
    ② 手动新建扩展档案：支持 类别: 人物（NPC人物）便捷填写与预览代号/所属势力/身份/态度/信任度/状态/性格与口吻。
    ③ 聊天书条目：按 §2.4 前缀分组列出当前聊天档案书条目；扩展段（人物/科技/建筑/载具/人员/装备/地点/势力）逐条「提升」。
    ④ 提升对话框：预填建议书名 `红警扩展·{条目名}` + 撞名即时校验 +「加入全局启用」默认勾选（§4.1）。
    ⑤ 提升历史（$promoted）+ 半程态警示 + 重试删除。
  -->
  <section class="ra-expansion card ob-panel px-3 py-2.5">
    <div class="flex items-center justify-between">
      <span class="micro flex items-center gap-1.5 text-[12px] text-(--rac-hi)">
        <Icon name="archive" :size="12" />
        扩展设定建档
      </span>
      <div class="flex items-center gap-1.5">
        <button
          class="sysbtn"
          data-test="expansion-toggle-create-btn"
          @click="showCreateForm = !showCreateForm"
        >
          {{ showCreateForm ? '收起新建' : '+ 手动建档' }}
        </button>
        <button
          class="sysbtn"
          :style="{
            color: expansionFilerState.auto ? 'var(--ok)' : 'var(--t-faint)',
            borderColor: expansionFilerState.auto ? 'var(--ok)' : 'var(--line)',
          }"
          @click="setExpansionAutoFile(!expansionFilerState.auto)"
        >
          自动入档 {{ expansionFilerState.auto ? '开' : '关' }}
        </button>
      </div>
    </div>

    <!-- 手动新建扩展档案（支持 类别: 人物 立体属性便捷填写与预览） -->
    <div
      v-if="showCreateForm"
      class="mt-2 rounded-[2px] border p-2"
      style="border-color: var(--rac-dim)"
      data-test="expansion-manual-create-form"
    >
      <div class="flex flex-wrap items-center gap-1.5">
        <span style="color: var(--rac-text); font-size: 12px">类别:</span>
        <button
          v-for="k in EXPANSION_KINDS"
          :key="k"
          type="button"
          class="kind-pill"
          :class="[KIND_BADGE_CLASS[k] ?? '', { 'is-active': draftKind === k }]"
          :data-kind="k"
          @click="draftKind = k"
        >
          {{ k === '人物' ? '人物 (NPC)' : k }}
        </button>
      </div>

      <div class="mt-1.5 grid grid-cols-2 gap-1.5" style="font-size: 12px">
        <label style="color: var(--rac-text)">
          名称
          <input v-model="draftName" class="ra-input mt-0.5 w-full" placeholder="如：阿列克谢 / 磁暴线圈" />
        </label>
        <label style="color: var(--rac-text)">
          简述
          <input v-model="draftDesc" class="ra-input mt-0.5 w-full" placeholder="1~2 句档案摘要" />
        </label>
      </div>

      <!-- 当选择 类别: 人物 时展示 NPC 专属立体属性快捷填写与预览 -->
      <div v-if="draftKind === '人物'" class="mt-1.5 grid grid-cols-2 gap-1.5" data-test="expansion-npc-fields" style="font-size: 12px">
        <label style="color: var(--rac-text)">
          代号/头衔
          <input v-model="npcCallsign" class="ra-input mt-0.5 w-full" placeholder="如：凛冬铁锤" />
        </label>
        <label style="color: var(--rac-text)">
          所属势力
          <input v-model="npcFaction" class="ra-input mt-0.5 w-full" placeholder="如：铁道幸存者同盟" />
        </label>
        <label style="color: var(--rac-text)">
          身份/职务
          <input v-model="npcRole" class="ra-input mt-0.5 w-full" placeholder="如：战地军需联络官" />
        </label>
        <label style="color: var(--rac-text)">
          态度/立场
          <select v-model="npcAttitude" class="ra-input mt-0.5 w-full">
            <option value="效忠">效忠</option>
            <option value="友善">友善</option>
            <option value="合作">合作</option>
            <option value="中立">中立</option>
            <option value="警觉">警觉</option>
            <option value="敌对">敌对</option>
          </select>
        </label>
        <label style="color: var(--rac-text)">
          信任度 (0~100)
          <input v-model.number="npcTrust" type="number" min="0" max="100" class="ra-input mt-0.5 w-full" />
        </label>
        <label style="color: var(--rac-text)">
          当前状态/驻地
          <input v-model="npcStatus" class="ra-input mt-0.5 w-full" placeholder="如：北坡火车站驻防" />
        </label>
        <label class="col-span-2" style="color: var(--rac-text)">
          性格与口吻
          <input v-model="npcPersonality" class="ra-input mt-0.5 w-full" placeholder="如：言辞干练，重诺守信" />
        </label>
        <div
          v-if="draftName.trim()"
          class="col-span-2 rounded-[2px] border p-1.5 font-mono text-[11px]"
          style="border-color: color-mix(in srgb, var(--rac-warn) 38%, transparent); color: var(--rac-warn); background: color-mix(in srgb, var(--rac-warn) 10%, transparent)"
          data-test="expansion-npc-preview"
        >
          [人物档案 | {{ draftName.trim() }}] 势力:{{ npcFaction || '未明' }} · 身份:{{ npcRole || '未明' }} · 态度:{{ npcAttitude }} · 信任度:{{ npcTrust }}% · 状态:{{ npcStatus || '在册' }}
        </div>
      </div>

      <label class="mt-1.5 block" style="color: var(--rac-text); font-size: 12px">
        详细设定
        <textarea v-model="draftDetail" rows="2" class="ra-input mt-0.5 w-full" placeholder="完整背景、能力或技术参数描述..." />
      </label>

      <div class="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          class="sysbtn"
          :disabled="!draftName.trim()"
          data-test="expansion-stage-draft-btn"
          @click="stageManualDraft"
        >
          加入待入档队列
        </button>
      </div>
    </div>

    <div v-if="!pending.length" class="mt-2" style="color: var(--rac-muted); font-size: 12px">
      暂无待入档扩展设定 · AI 输出 &lt;扩展档案&gt; 后会自动汇总至此
    </div>
    <div
      v-for="d in pending"
      :key="d.name"
      class="mt-1.5 flex flex-col gap-1 border-b pb-1.5"
      style="border-color: var(--rac-dim)"
    >
      <div class="flex items-center justify-between gap-2">
        <span class="flex min-w-0 items-center gap-2">
          <span style="color: var(--rac-hi); font-size: 13px">{{ d.name }}</span>
          <span
            class="num flex-none kind-pill"
            :class="KIND_BADGE_CLASS[d.kind] ?? ''"
            style="font-size: 11px"
          >
            {{ d.kind }}
          </span>
        </span>
      </div>
      <div
        v-if="(d.kind === '人物' || d.kind === '势力') && d.params && Object.keys(d.params).length"
        class="flex flex-wrap gap-1.5 text-[11px]"
        style="color: var(--rac-warn)"
      >
        <span v-if="d.params['所属势力'] || d.params['势力'] || d.params['所属阵营']">势力: {{ d.params['所属势力'] || d.params['势力'] || d.params['所属阵营'] }}</span>
        <span v-if="d.params['首领'] || d.params['领袖']">首领: {{ d.params['首领'] || d.params['领袖'] }}</span>
        <span v-if="d.params['身份'] || d.params['职务']">身份: {{ d.params['身份'] || d.params['职务'] }}</span>
        <span v-if="d.params['态度'] || d.params['立场']">态度: {{ d.params['态度'] || d.params['立场'] }}</span>
        <span v-if="d.params['风险'] || d.params['威胁']">风险: {{ d.params['风险'] || d.params['威胁'] }}</span>
        <span v-if="d.params['信任度'] || d.params['好感']">信任度: {{ d.params['信任度'] || d.params['好感'] }}%</span>
        <span v-if="d.params['状态'] || d.params['驻地'] || d.params['总部']">状态: {{ d.params['状态'] || d.params['驻地'] || d.params['总部'] }}</span>
      </div>
    </div>
    <button
      v-if="pending.length"
      class="sysbtn mt-1.5"
      :disabled="expansionFilerState.busy || !inTavern"
      @click="manualFile"
    >
      {{ expansionFilerState.busy ? '入档中…' : inTavern ? '全部入当前聊天书' : '预览环境不可写' }}
    </button>
    <div
      v-for="r in expansionFilerState.receipts"
      :key="r.time + r.name"
      class="mt-1 flex gap-2"
      style="font-size: 12px"
    >
      <span :style="{ color: r.ok ? (r.fork ? 'var(--warn)' : 'var(--ok)') : 'var(--danger)' }">{{
        r.ok ? (r.fork ? '▲' : '◆') : '×'
      }}</span>
      <span style="color: var(--rac-text)">{{ r.name }}</span>
      <span class="num min-w-0 break-all" style="color: var(--rac-muted)">{{ r.note }}</span>
    </div>
  </section>

  <section class="ra-expansion card ob-panel mt-2 px-3 py-2.5">
    <div class="flex items-center justify-between">
      <span class="micro flex items-center gap-1.5 text-[12px] text-(--rac-hi)">
        <Icon name="pin" :size="12" />
        聊天专属条目 · 转为独立世界书
      </span>
      <button class="sysbtn" :disabled="listBusy || !inTavern" @click="refreshBook">刷新</button>
    </div>
    <div class="mt-1" style="color: var(--rac-muted); font-size: 12px">
      当前聊天 ·
      {{
        bookName ?? '（未绑定档案书）'
      }}。可将本局聊天专属条目拆出保存为独立世界书（跨卡复用），并从原聊天书中移除。
    </div>
    <div v-if="errorMsg" class="mt-1" style="color: var(--danger); font-size: 12px">{{ errorMsg }}</div>
    <div v-if="infoMsg" class="mt-1" style="color: var(--ok); font-size: 12px">{{ infoMsg }}</div>

    <template v-for="g in groupedEntries" :key="g.prefix">
      <div class="mt-2 flex items-center gap-1.5" style="color: var(--rac-text); font-size: 12px">
        <span class="kind-pill" :class="KIND_BADGE_CLASS[g.prefix] ?? ''">{{ g.prefix }}</span>
        <span>· {{ g.items.length }}</span>
      </div>
      <div
        v-for="e in g.items"
        :key="e.uid ?? e.name"
        class="mt-1 flex items-center justify-between gap-2 border-b pb-1"
        style="border-color: var(--rac-dim)"
      >
        <span class="min-w-0 truncate" style="color: var(--rac-hi); font-size: 12px">{{ e.name }}</span>
        <span class="flex flex-none items-center gap-1.5">
          <span v-if="forkNames.has(baseName(e.name))" style="color: var(--warn); font-size: 11px">已转出（内容有更新）</span>
          <span v-else-if="staleNames.has(baseName(e.name))" style="color: var(--rac-muted); font-size: 11px"
            >曾提升·目标书已删</span
          >
          <button v-if="g.promotable" class="sysbtn" :disabled="listBusy || !inTavern" @click="openPromote(e)">
            提升
          </button>
        </span>
      </div>
    </template>

    <!-- 提升对话框（内联） -->
    <div v-if="dialog" class="ra-promote mt-2 rounded-[2px] border p-2" style="border-color: var(--rac-accent)">
      <div style="color: var(--rac-hi); font-size: 13px">提升「{{ dialog.sourceName }}」</div>
      <label class="mt-1.5 block" style="color: var(--rac-text); font-size: 12px">
        新书名
        <input v-model="dialog.bookName" class="ra-input mt-0.5 w-full" />
      </label>
      <div v-if="bookNameConflict" style="color: var(--danger); font-size: 12px">
        该书名已存在，请换名（禁止覆盖既有书）
      </div>
      <label class="mt-1.5 block" style="color: var(--rac-text); font-size: 12px">
        条目名
        <input v-model="dialog.entryName" class="ra-input mt-0.5 w-full" />
      </label>
      <label class="mt-1.5 flex items-center gap-1.5" style="color: var(--rac-text); font-size: 12px">
        <input v-model="dialog.enableGlobal" type="checkbox" />
        加入全局启用列表（取消＝暂不启用）
      </label>
      <div class="mt-2 flex gap-2">
        <button
          class="sysbtn"
          :disabled="listBusy || bookNameConflict || !dialog.bookName.trim() || !dialog.entryName.trim()"
          @click="confirmPromote"
        >
          确认提升
        </button>
        <button class="sysbtn" :disabled="listBusy" @click="dialog = null">取消</button>
      </div>
    </div>

    <!-- 提升历史 + 半程态 -->
    <div v-if="promotedList.length" class="mt-2" style="color: var(--rac-text); font-size: 12px">提升历史</div>
    <div v-for="p in promotedList" :key="p.name" class="mt-0.5 flex gap-2" style="font-size: 12px">
      <span style="color: var(--rac-hi)">{{ p.name }}</span>
      <span class="num" style="color: var(--rac-muted)">→ {{ p.targetBook }} · {{ p.promotedAt }}</span>
      <span v-if="p.dangling" style="color: var(--warn)">目标世界书已删除</span>
    </div>
    <div
      v-for="h in halfStates"
      :key="'half-' + h.entryName"
      class="mt-1 flex items-center justify-between gap-2"
      style="font-size: 12px"
    >
      <span style="color: var(--danger)"
        >未完成清理：「{{ h.entryName }}」已写入《{{ h.targetBook }}》，但原聊天书条目尚未移除</span
      >
      <button class="sysbtn sysbtn--danger" :disabled="listBusy" @click="retryDelete(h)">重试删除</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import type { ExpansionDossier } from '../../红警指挥系统/core/schema';
import {
  detectHalfStates,
  promoteEntry,
  promotedRecordStatus,
  readPromoted,
  retryDeleteOriginalEntry,
  stripExpansionCommentPrefix,
  type HalfStateRecord,
  type PromotedRegistry,
} from '../../红警指挥系统/worldbook/expansionFiler';
import type { ThEntry } from '../../红警指挥系统/worldbook/girlFiler';
import { in_tavern } from '../../红警指挥系统/composables/store';
import { tav } from '../../红警指挥系统/parse/systemCheck';
import { useCatalogStore } from '../../红警指挥系统/composables/useCatalog';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';
import { updateFloorVars } from '../host/floorVarWrite';
import {
  collectPendingExpansionsFromSnapshot,
  expansionFilerState,
  runFromFloating,
  setExpansionAutoFile,
} from '../host/expansionAutoFiler';
import {
  EXPANSION_KINDS,
  groupChatBookEntries,
  KIND_BADGE_CLASS,
  suggestPromotion,
  type ExpansionKindType,
} from '../models/expansionView';

const floating = useFloatingStore();
const catalogStore = useCatalogStore();
const inTavern = in_tavern;

const showCreateForm = ref(false);
const draftKind = ref<ExpansionKindType>('人物');
const draftName = ref('');
const draftDesc = ref('');
const draftDetail = ref('');
const npcCallsign = ref('');
const npcFaction = ref('');
const npcRole = ref('');
const npcAttitude = ref('友善');
const npcTrust = ref(60);
const npcStatus = ref('');
const npcPersonality = ref('');
const localStagedDrafts = ref<ExpansionDossier[]>([]);

const pending = computed(() => [
  ...collectPendingExpansionsFromSnapshot(floating.snapshot),
  ...localStagedDrafts.value,
]);

async function stageManualDraft() {
  const name = draftName.value.trim();
  if (!name) return;
  const params: Record<string, string> = {};
  if (draftKind.value === '人物') {
    if (npcCallsign.value.trim()) params['代号'] = npcCallsign.value.trim();
    if (npcFaction.value.trim()) params['所属势力'] = npcFaction.value.trim();
    if (npcRole.value.trim()) params['身份'] = npcRole.value.trim();
    if (npcAttitude.value.trim()) params['态度'] = npcAttitude.value.trim();
    params['信任度'] = String(Math.max(0, Math.min(100, Number.isFinite(npcTrust.value) ? Math.round(npcTrust.value) : 50)));
    if (npcStatus.value.trim()) params['状态'] = npcStatus.value.trim();
    if (npcPersonality.value.trim()) params['性格与口吻'] = npcPersonality.value.trim();
  }
  const newEntry: ExpansionDossier = {
    name,
    kind: draftKind.value,
    desc: draftDesc.value.trim() || `${name}（${draftKind.value}档案）`,
    params,
    detail: draftDetail.value.trim(),
    keys: [name],
  };
  if (floating.snapshot && Array.isArray(floating.snapshot.pending_expansions)) {
    floating.snapshot.pending_expansions.push(newEntry);
  } else {
    localStagedDrafts.value.push(newEntry);
  }
  draftName.value = '';
  draftDesc.value = '';
  draftDetail.value = '';
  showCreateForm.value = false;

  const targetFloorId = floating.floorId ?? 0;
  try {
    await updateFloorVars(targetFloorId, vars => {
      const sd = (vars.stat_data ?? {}) as Record<string, unknown>;
      const prev = Array.isArray(sd.pending_expansions)
        ? [...(sd.pending_expansions as ExpansionDossier[])]
        : [];
      const existIdx = prev.findIndex(e => e && e.name === newEntry.name);
      if (existIdx >= 0) {
        prev[existIdx] = newEntry;
      } else {
        prev.push(newEntry);
      }
      return {
        ...vars,
        stat_data: {
          ...sd,
          pending_expansions: prev,
        },
      };
    });
  } catch {
    /* 预览环境或楼层变量写回失败时保留本地暂存态 */
  }
}

async function manualFile() {
  const outcome = await runFromFloating(floating);
  if (outcome.filed.length) {
    localStagedDrafts.value = localStagedDrafts.value.filter(d => !outcome.filed.includes(d.name));
    try {
      await catalogStore.refresh();
    } catch {
      /* 目录刷新失败不阻断主流程 */
    }
    await refreshBook();
  }
}

const listBusy = ref(false);
const errorMsg = ref('');
const infoMsg = ref('');
const bookName = ref<string | null>(null);
const entries = ref<ThEntry[]>([]);
const promoted = ref<PromotedRegistry>({});
const halfStates = ref<HalfStateRecord[]>([]);
const allBookNames = ref<string[]>([]);

const groupedEntries = computed(() => groupChatBookEntries(entries.value));
const promotedList = computed(() =>
  Object.entries(promoted.value).map(([name, r]) => ({
    name,
    ...r,
    dangling: promotedRecordStatus(r, allBookNames.value.length ? allBookNames.value : null) === 'dangling',
  })),
);
/** 分叉警示只对目标书在册的记录；目标书已删的悬挂记录降级为提示（F8 治理） */
const forkNames = computed(() => new Set(promotedList.value.filter(p => !p.dangling).map(p => p.name)));
const staleNames = computed(() => new Set(promotedList.value.filter(p => p.dangling).map(p => p.name)));

function baseName(name: string): string {
  return stripExpansionCommentPrefix(name);
}

async function refreshBook() {
  if (!in_tavern) return;
  listBusy.value = true;
  errorMsg.value = '';
  try {
    const getBound = tav<(c: 'current') => string | null>('getChatWorldbookName');
    const getWb = tav<(n: string) => Promise<ThEntry[]>>('getWorldbook');
    const getNames = tav<() => string[]>('getWorldbookNames');
    allBookNames.value = getNames ? getNames() : [];
    bookName.value = getBound ? getBound('current') : null;
    entries.value = bookName.value && getWb ? await getWb(bookName.value) : [];
    promoted.value = (await readPromoted()) ?? {};
    halfStates.value = bookName.value ? await detectHalfStates(bookName.value, promoted.value) : [];
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e);
  } finally {
    listBusy.value = false;
  }
}

interface PromoteDialog {
  source: ThEntry;
  sourceName: string;
  bookName: string;
  entryName: string;
  enableGlobal: boolean;
}
const dialog = ref<PromoteDialog | null>(null);
const bookNameConflict = computed(() => !!dialog.value && allBookNames.value.includes(dialog.value.bookName.trim()));

function openPromote(e: ThEntry) {
  const s = suggestPromotion(e.name);
  dialog.value = { source: e, sourceName: e.name, bookName: s.bookName, entryName: s.entryName, enableGlobal: true };
  infoMsg.value = '';
  errorMsg.value = '';
}

async function confirmPromote() {
  const d = dialog.value;
  if (!d || !bookName.value) return;
  listBusy.value = true;
  try {
    const receipt = await promoteEntry({
      sourceChatBook: bookName.value,
      entryIdentifier: d.source.uid ?? d.source.name,
      targetBookName: d.bookName.trim(),
      newEntryComment: d.entryName.trim(),
      skipGlobalRebind: !d.enableGlobal,
    });
    infoMsg.value = `已提升为《${receipt.targetBook}》·${receipt.entryName}${d.enableGlobal ? '（已加入全局启用）' : '（暂不启用）'}`;
    dialog.value = null;
    try {
      await catalogStore.refresh();
    } catch {
      /* 目录刷新失败不阻断主流程 */
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e);
  } finally {
    listBusy.value = false;
  }
  await refreshBook();
}

async function retryDelete(h: HalfStateRecord) {
  listBusy.value = true;
  try {
    const id = promoted.value[h.entryName]?.sourceComment ?? h.entryName;
    await retryDeleteOriginalEntry(h.sourceBook, id);
    infoMsg.value = `已清理聊天书残留条目「${h.entryName}」`;
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e);
  } finally {
    listBusy.value = false;
  }
  await refreshBook();
}

onMounted(() => {
  void refreshBook();
});
</script>

<style scoped>
.ra-expansion .sysbtn {
  font-size: 12px;
  letter-spacing: 0.04em;
  padding: 3px 10px;
  border: 1px solid var(--rac-dim);
  border-radius: 2px;
  background: var(--rac-panel-2);
  color: var(--rac-text);
}
.ra-expansion .sysbtn:hover:not(:disabled) {
  border-color: var(--rac-line);
  color: var(--rac-hi);
}
.ra-expansion .sysbtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ra-expansion .sysbtn--danger {
  color: var(--rac-alert);
  border-color: var(--rac-alert);
}
.ra-expansion .ra-input {
  background: var(--rac-bg);
  border: 1px solid var(--rac-dim);
  border-radius: 2px;
  padding: 4px 8px;
  color: var(--rac-hi);
  font-size: 12px;
}
.kind-pill {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 2px;
  border: 1px solid var(--rac-dim);
  color: var(--rac-text);
}
.kind-pill.is-active {
  border-color: var(--rac-accent);
  color: var(--rac-hi);
  background: color-mix(in srgb, var(--rac-accent) 14%, transparent);
}
.badge-npc {
  color: var(--rac-warn);
  border-color: color-mix(in srgb, var(--rac-warn) 45%, transparent);
  background: color-mix(in srgb, var(--rac-warn) 14%, transparent);
}
</style>
