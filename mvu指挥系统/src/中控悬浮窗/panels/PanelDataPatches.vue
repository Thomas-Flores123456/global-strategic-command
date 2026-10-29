<template>
  <Transition name="ra-modal">
    <div
      v-if="embedded || open"
      :class="
        embedded
          ? 'contents'
          : 'ra-modal-mask fixed inset-0 z-10010 flex items-center justify-center p-3'
      "
      @click.self="!embedded && $emit('close')"
    >
      <!-- FD-43 G1：嵌入式外框收束为 bg-(--rac-panel) border border-(--rac-dim)（请主线同步 ModalSettings.test.ts 第 64 行类名断言） -->
      <section
        :class="
          embedded
            ? 'ra-patches-embedded ob-panel flex flex-col w-full min-h-[420px] max-h-[68vh] bg-(--rac-panel) border border-(--rac-dim) rounded-[2px] overflow-hidden select-none'
            : 'ra-modal-card ob-panel flex max-h-[86vh] w-full max-w-[820px] flex-col overflow-hidden rounded-[2px] select-none'
        "
        :role="embedded ? 'region' : 'dialog'"
        :aria-modal="embedded ? undefined : 'true'"
        aria-label="数据补丁审核"
      >
        <!-- 弹窗标题栏 -->
        <header class="flex items-center justify-between border-b border-(--rac-dim) bg-(--rac-panel-2) px-3.5 py-2.5">
          <div class="flex items-center gap-2">
            <span class="text-(--rac-warn)"><Icon name="status" :size="14" /></span>
            <span class="text-[13px] font-bold tracking-wide text-(--rac-hi)">
              世界书数据改动审核
            </span>
            <span
              v-if="pendingList.length > 0"
              class="ob-num rounded-[2px] border border-(--rac-warn) bg-(--rac-bg) px-1.5 py-0.5 font-mono text-[11px] text-(--rac-warn)"
            >
              {{ pendingList.length }} 待审核
            </span>
          </div>

          <div class="flex items-center gap-3">
            <!-- 全自动热应用开关 -->
            <label
              class="flex cursor-pointer items-center gap-1.5 font-mono text-[12px] text-(--rac-muted) transition-colors hover:text-(--rac-hi)"
              title="开启后，合规补丁将自动写入世界书，跳过人工审核（默认关闭，推荐人工把关）"
            >
              <span>自动生效</span>
              <input
                v-model="autoApply"
                type="checkbox"
                class="cursor-pointer accent-(--rac-accent)"
                @change="onToggleAutoApply"
              />
            </label>

            <button
              v-if="!embedded"
              class="rounded-[2px] p-1 text-(--rac-muted) transition-colors hover:text-(--rac-hi)"
              aria-label="关闭弹窗"
              @click="$emit('close')"
            >
              <Icon name="close" :size="12" />
            </button>
          </div>
        </header>

        <!-- 主内容区 -->
        <div class="ra-modal-body flex-1 space-y-4 overflow-y-auto bg-(--rac-bg) p-4">
          <!-- 顶部状态提示 -->
          <div
            class="flex items-center justify-between rounded-[2px] border border-(--rac-dim) bg-(--rac-panel) p-2.5 font-mono text-[12px]"
          >
            <div class="text-(--rac-muted)">
              说明：仅更新目标条目内的 <span class="text-(--rac-accent)">&lt;数据&gt;</span> 数值块，条目名称、触发词与设定正文保持不变。
            </div>
            <div class="text-[12px]" :class="autoApply ? 'text-(--rac-warn)' : 'text-(--rac-muted)'">
              当前模式: {{ autoApply ? '自动生效 (Auto-Apply)' : '手动审核 (Manual)' }}
            </div>
          </div>

          <!-- 空状态 -->
          <div
            v-if="pendingList.length === 0"
            class="flex flex-col items-center justify-center space-y-2 rounded-[2px] border border-dashed border-(--rac-dim) bg-(--rac-panel) py-12 text-center"
          >
            <div class="text-(--rac-line)"><Icon name="status" :size="28" /></div>
            <div class="font-mono text-[13px] font-bold text-(--rac-text)">暂无待审核数据更新补丁</div>
            <div class="text-[12px] text-(--rac-muted)">
              AI 输出 &lt;数据更新&gt; 时，会在此列出修改前后的数值对比供你确认。
            </div>
          </div>

          <!-- 待审核补丁卡片列表 -->
          <div v-else class="space-y-4">
            <article
              v-for="(patch, idx) in pendingList"
              :key="patch.id || idx"
              class="overflow-hidden rounded-[2px] border transition-all"
              :class="
                patch.status === 'deferred'
                  ? 'border-(--rac-dim) bg-(--rac-panel)'
                  : 'border-(--rac-line) bg-(--rac-panel-2)'
              "
            >
              <!-- 卡片顶栏 -->
              <div class="flex items-center justify-between border-b border-(--rac-dim) bg-(--rac-panel) px-3 py-2">
                <div class="flex items-center gap-2">
                  <span class="text-[13px] font-bold tracking-wide text-(--rac-hi)">
                    {{ patch.target }}
                  </span>
                  <span
                    class="ob-num rounded-[2px] px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase"
                    :class="
                      patch.operation === 'replace'
                        ? 'border border-(--rac-warn) bg-(--rac-bg) text-(--rac-warn)'
                        : 'border border-(--rac-accent) bg-(--rac-bg) text-(--rac-accent)'
                    "
                  >
                    {{ patch.operation }}
                  </span>
                  <span
                    v-if="patch.status === 'deferred'"
                    class="ob-num rounded-[2px] border border-(--rac-dim) bg-(--rac-bg) px-1.5 py-0.5 font-mono text-[11px] text-(--rac-muted)"
                  >
                    已暂缓
                  </span>
                </div>

                <div class="ob-num font-mono text-[11px] text-(--rac-muted)">ID: {{ patch.id }}</div>
              </div>

              <!-- 隔离提示（CTRL-PATCH-UX-01：失败指纹命中时展示原因与去处，不再自动重试） -->
              <div
                v-if="failRecordOf(patch)"
                class="ra-patch-quarantine border-b border-(--rac-warn) px-3.5 py-2 text-[12px] leading-relaxed text-(--rac-text)"
                role="status"
              >
                <span class="mr-1 font-mono font-bold text-(--rac-warn)">已隔离 · 不再自动重试:</span>
                {{ failRecordOf(patch)!.msg }}
                <span class="ml-1 text-(--rac-muted)">（可点「立即生效」手动重试）</span>
              </div>

              <!-- 理由与上下文 -->
              <div
                v-if="patch.reason"
                class="border-b border-(--rac-dim) bg-(--rac-panel) px-3.5 py-2 text-[12px] leading-relaxed text-(--rac-text)"
              >
                <span class="mr-1 font-mono font-bold text-(--rac-accent)">改装理由:</span>
                {{ patch.reason }}
              </div>

              <!-- Diff 差异对比区 -->
              <div class="space-y-2 bg-(--rac-bg) p-3">
                <div class="flex items-center justify-between font-mono text-[12px] text-(--rac-muted)">
                  <span class="font-bold text-(--rac-hi)">数值改动对比</span>
                  <button class="text-(--rac-accent) hover:underline" @click="toggleRaw(patch.id)">
                    {{ showRawMap[patch.id] ? '显示改动对比' : '查看原始 JSON' }}
                  </button>
                </div>

                <!-- 原始 JSON 模式 -->
                <div
                  v-if="showRawMap[patch.id]"
                  class="overflow-x-auto rounded-[2px] border border-(--rac-dim) bg-(--rac-panel) p-2.5 font-mono text-[11px] text-(--rac-text)"
                >
                  <pre class="m-0">{{ JSON.stringify(patch.patch, null, 2) }}</pre>
                </div>

                <!-- 结构化 Diff 模式 -->
                <div v-else class="space-y-1 font-mono text-[11px]">
                  <div
                    v-for="(diffItem, dIdx) in getDiffList(patch)"
                    :key="dIdx"
                    class="flex items-start gap-2 rounded-[2px] p-1.5"
                    :class="{
                      'ra-diff-item--added': diffItem.type === 'added',
                      'ra-diff-item--modified': diffItem.type === 'modified',
                      'ra-diff-item--deleted': diffItem.type === 'deleted',
                    }"
                  >
                    <span class="w-4 flex-none text-center font-bold">
                      {{ diffItem.type === 'added' ? '+' : diffItem.type === 'modified' ? '~' : '-' }}
                    </span>
                    <span class="flex-none font-bold text-(--rac-hi)"> {{ diffItem.path }}: </span>
                    <div class="flex-1 break-all">
                      <template v-if="diffItem.type === 'modified'">
                        <span class="mr-1 text-(--rac-alert) line-through opacity-80">{{
                          formatVal(diffItem.oldValue)
                        }}</span>
                        <span class="font-bold text-(--rac-ok)">→ {{ formatVal(diffItem.newValue) }}</span>
                      </template>
                      <template v-else-if="diffItem.type === 'added'">
                        <span class="font-bold text-(--rac-ok)">{{ formatVal(diffItem.newValue) }}</span>
                      </template>
                      <template v-else>
                        <span class="text-(--rac-alert) line-through">{{ formatVal(diffItem.oldValue) }}</span>
                      </template>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 三通道裁决按钮栏 -->
              <footer class="flex items-center justify-between border-t border-(--rac-dim) bg-(--rac-panel) p-2.5">
                <div class="font-mono text-[12px] text-(--rac-muted)">
                  更新方式: {{ patch.operation === 'patch' ? '仅修改变动字段' : '整块替换数值' }}
                </div>

                <div class="flex items-center gap-2">
                  <!-- 废弃驳回 -->
                  <button
                    class="ra-patch-btn ra-patch-btn--reject flex items-center gap-1 rounded-[2px] px-2.5 py-1 font-mono text-[12px] font-bold transition-colors"
                    :disabled="busyId === patch.id"
                    @click="rejectPatch(patch)"
                  >
                    <Icon name="close" :size="11" />
                    <span>废弃驳回</span>
                  </button>

                  <!-- 暂存推迟 -->
                  <button
                    class="ra-patch-btn ra-patch-btn--defer rounded-[2px] px-2.5 py-1 font-mono text-[12px] font-bold transition-colors"
                    :disabled="busyId === patch.id"
                    @click="deferPatch(patch)"
                  >
                    <span>暂存推迟</span>
                  </button>

                  <!-- 立即生效 -->
                  <button
                    class="ra-patch-btn ra-patch-btn--apply flex items-center gap-1 rounded-[2px] px-3 py-1 font-mono text-[12px] font-bold transition-colors"
                    :disabled="busyId === patch.id"
                    @click="applyPatch(patch, 'manual')"
                  >
                    <Icon name="check" :size="11" />
                    <span>{{ busyId === patch.id ? '写入中…' : '立即生效' }}</span>
                  </button>
                </div>
              </footer>
            </article>
          </div>
        </div>
      </section>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import type { DataPatch, Schema } from '../../红警指挥系统/core/schema';
import { useDataStore } from '../../红警指挥系统/composables/store';
import { appendFloorProcessOp } from '../../红警指挥系统/core/timelineLedger';
import { useCatalogStore } from '../../红警指挥系统/composables/useCatalog';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';
import {
  type DiffChange,
  fileDataPatch,
  getAutoApplyPreference,
  setAutoApplyPreference,
} from '../../红警指挥系统/worldbook/worldbookDataFiler';
import { updateFloorVars } from '../host/floorVarWrite';
import { buildPatchDiffList } from '../models/patchDiff';
import {
  clearFailure,
  type FailRecord,
  findFailRecord,
  patchFingerprint,
  readCurrentChatId,
  recordFailure,
  shouldAutoRetry,
} from '../models/patchFailFingerprint';

const props = defineProps<{
  open?: boolean;
  snapshot?: Schema | null;
  embedded?: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const store = useDataStore();
const catalogStore = useCatalogStore();
const floating = useFloatingStore();

const autoApply = ref(getAutoApplyPreference());
const busyId = ref<string | null>(null);
const showRawMap = ref<Record<string, boolean>>({});

const pendingList = computed<DataPatch[]>(() => {
  // 优先从 store 响应式读取，兜底 snapshot
  const fromStore = store.data?.pending_data_patches;
  if (Array.isArray(fromStore)) return fromStore;
  if (Array.isArray(props.snapshot?.pending_data_patches)) return props.snapshot!.pending_data_patches;
  return [];
});

function toggleRaw(id: string) {
  showRawMap.value[id] = !showRawMap.value[id];
}

function formatVal(v: unknown): string {
  if (typeof v === 'object' && v !== null) {
    return JSON.stringify(v);
  }
  return String(v);
}

const patchDiffMap = computed<Map<DataPatch, DiffChange[]>>(() => {
  const map = new Map<DataPatch, DiffChange[]>();
  const cat = catalogStore.effectiveCatalog;
  for (const patch of pendingList.value) {
    map.set(patch, buildPatchDiffList(cat, patch));
  }
  return map;
});

/**
 * 为单个 patch 计算可视化的 Diff 变更列表
 */
function getDiffList(patch: DataPatch): DiffChange[] {
  // 尝试从 catalogStore 寻找原建筑或科技（F5：useCatalog 导出名为 effectiveCatalog，科技字段为 researches）
  const cached = patchDiffMap.value.get(patch);
  if (cached) return cached;
  return buildPatchDiffList(catalogStore.effectiveCatalog, patch);
}

function onToggleAutoApply() {
  setAutoApplyPreference(autoApply.value);
  if (autoApply.value) {
    void processAutoApply();
  }
}

/**
 * 非阻塞提示（CTRL-PATCH-UX-01：禁用阻塞式弹窗，改 toastr；toastr 不可用时仅记控制台）
 */
function notify(level: 'warning' | 'error' | 'success', msg: string) {
  const t = (globalThis as { toastr?: Record<string, (m: string, title?: string) => void> }).toastr;
  if (t && typeof t[level] === 'function') t[level](msg, '数据补丁');
  else console.warn(`[数据补丁] ${msg}`);
}

/** 失败指纹记录变更计数（让模板里的 failRecordOf 响应式刷新） */
const failTick = ref(0);

const patchFailRecordMap = computed<Map<DataPatch, FailRecord | null>>(() => {
  void failTick.value;
  const map = new Map<DataPatch, FailRecord | null>();
  const chatId = readCurrentChatId();
  for (const patch of pendingList.value) {
    map.set(patch, findFailRecord(chatId, patchFingerprint(patch)));
  }
  return map;
});

function failRecordOf(patch: DataPatch): FailRecord | null {
  if (patchFailRecordMap.value.has(patch)) {
    return patchFailRecordMap.value.get(patch) ?? null;
  }
  void failTick.value;
  return findFailRecord(readCurrentChatId(), patchFingerprint(patch));
}

/**
 * 通道 1：【立即生效】
 * mode='manual'：驾驶员手动点按，不受失败指纹限制，照常重试；
 * mode='auto'：Auto-Apply 批处理调用，调用前已由 shouldAutoRetry 过滤。
 */
async function applyPatch(
  patch: DataPatch,
  mode: 'manual' | 'auto' = 'manual',
  options?: { skipRefresh?: boolean },
): Promise<boolean> {
  if (busyId.value !== null || (mode === 'manual' && autoRunning)) return false;
  busyId.value = patch.id;
  const chatId = readCurrentChatId();
  const fp = patchFingerprint(patch);
  let refreshedNeeded = false;
  try {
    const res = await fileDataPatch(patch);
    if (res.success) {
      // 成功：从 pending 列表中移除，并清除该内容的失败指纹
      clearFailure(chatId, fp);
      const list = store.data.pending_data_patches;
      const idx = list.findIndex(p => p.id === patch.id);
      if (idx >= 0) list.splice(idx, 1);
      if (floating.floorId !== null && readCurrentChatId() === chatId) {
        const floorId = floating.floorId;
        await updateFloorVars(floating.floorId, vars => {
          const sd = (vars.stat_data ?? {}) as Record<string, unknown>;
          const raw = Array.isArray(sd.pending_data_patches) ? (sd.pending_data_patches as DataPatch[]) : [];
          const appliedRaw = Array.isArray(sd.applied_data_patches) ? [...(sd.applied_data_patches as DataPatch[])] : [];
          const appliedIdx = appliedRaw.findIndex(p => p.id === patch.id);
          const appliedItem = { ...patch, status: 'applied' as const };
          if (appliedIdx >= 0) appliedRaw[appliedIdx] = appliedItem;
          else appliedRaw.push(appliedItem);
          return {
            ...vars,
            stat_data: {
              ...sd,
              pending_data_patches: raw.filter(p => p.id !== patch.id),
              applied_data_patches: appliedRaw,
            },
          };
        });
        appendFloorProcessOp(floorId, 0, {
          kind: 'PATCH_DECISION',
          ts: Date.now(),
          patchId: patch.id,
          patchTarget: patch.target,
          decision: 'approve',
          patchSnapshot: patch,
        });
        refreshedNeeded = true;
        if (!options?.skipRefresh) {
          await floating.refresh();
        }
      }
      if (mode === 'manual') notify('success', `「${patch.target}」已写入《${res.worldbook}》`);
    } else {
      // 隔离：按内容记失败指纹，同一内容（即使重解析换了 id）不再自动重试
      const msg = res.error || '未知原因';
      recordFailure(chatId, fp, msg);
      notify('warning', `补丁「${patch.target}」已隔离${mode === 'auto' ? '，不再自动重试' : ''}：${msg}`);
    }
  } catch (err) {
    notify('error', `补丁「${patch.target}」写入异常：${String(err)}`);
  } finally {
    failTick.value++;
    busyId.value = null;
  }
  return refreshedNeeded;
}

/**
 * 通道 2：【暂存推迟】
 */
async function deferPatch(patch: DataPatch) {
  if (busyId.value !== null || autoRunning) return;
  const chatId = readCurrentChatId();
  patch.status = 'deferred';
  try {
    if (floating.floorId !== null && readCurrentChatId() === chatId) {
      const floorId = floating.floorId;
      await updateFloorVars(floating.floorId, vars => {
        const sd = (vars.stat_data ?? {}) as Record<string, unknown>;
        const raw = Array.isArray(sd.pending_data_patches) ? (sd.pending_data_patches as DataPatch[]) : [];
        return {
          ...vars,
          stat_data: {
            ...sd,
            pending_data_patches: raw.map(p => (p.id === patch.id ? { ...p, status: 'deferred' as const } : p)),
          },
        };
      });
      appendFloorProcessOp(floorId, 0, {
        kind: 'PATCH_DECISION',
        ts: Date.now(),
        patchId: patch.id,
        patchTarget: patch.target,
        decision: 'defer',
        patchSnapshot: patch,
      });
      await floating.refresh();
    }
  } catch (err) {
    notify('error', `补丁「${patch.target}」推迟落盘失败：${String(err)}`);
  }
}

/**
 * 通道 3：【废弃驳回】
 */
async function rejectPatch(patch: DataPatch) {
  if (busyId.value !== null || autoRunning) return;
  const chatId = readCurrentChatId();
  const list = store.data.pending_data_patches;
  const idx = list.findIndex(p => p.id === patch.id);
  if (idx >= 0) {
    list.splice(idx, 1);
  }
  try {
    if (floating.floorId !== null && readCurrentChatId() === chatId) {
      const floorId = floating.floorId;
      await updateFloorVars(floating.floorId, vars => {
        const sd = (vars.stat_data ?? {}) as Record<string, unknown>;
        const raw = Array.isArray(sd.pending_data_patches) ? (sd.pending_data_patches as DataPatch[]) : [];
        return { ...vars, stat_data: { ...sd, pending_data_patches: raw.filter(p => p.id !== patch.id) } };
      });
      appendFloorProcessOp(floorId, 0, {
        kind: 'PATCH_DECISION',
        ts: Date.now(),
        patchId: patch.id,
        patchTarget: patch.target,
        decision: 'reject',
        patchSnapshot: patch,
      });
      await floating.refresh();
    }
  } catch (err) {
    notify('error', `补丁「${patch.target}」驳回落盘失败：${String(err)}`);
  }
}

/**
 * 自动热应用批处理
 */
let autoRunning = false;
async function processAutoApply() {
  if (!autoApply.value || autoRunning) return;
  autoRunning = true;
  try {
    const chatId = readCurrentChatId();
    const list = [...pendingList.value];
    let needRefresh = false;
    for (const patch of list) {
      // 已推迟或命中失败指纹（同一内容曾被隔离）→ 跳过，不再自动重试（自动通道 applyPatch(patch, 'auto') 批处理合并刷新）
      if (shouldAutoRetry(chatId, patch)) {
        const applied = await applyPatch(patch, 'auto', { skipRefresh: true });
        if (applied) needRefresh = true;
      }
    }
    if (needRefresh) {
      await floating.refresh();
    }
  } finally {
    autoRunning = false;
  }
}

// 监听新补丁到达
watch(
  () => pendingList.value.length,
  n => {
    if (n > 0 && autoApply.value) {
      void processAutoApply();
    }
  },
);

onMounted(() => {
  if (autoApply.value && pendingList.value.length > 0) {
    void processAutoApply();
  }
});
</script>

<style scoped>
.ra-modal-mask {
  z-index: 10010;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(4px);
}

.ra-modal-card {
  background: var(--rac-panel);
  border: 1px solid var(--rac-line);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.8),
    0 0 0 1px var(--rac-dim);
}

.ra-patch-quarantine {
  background: color-mix(in srgb, var(--rac-warn) 12%, var(--rac-bg));
}

.ra-diff-item--added {
  border: 1px solid color-mix(in srgb, var(--rac-ok) 45%, transparent);
  background: color-mix(in srgb, var(--rac-ok) 12%, var(--rac-bg));
  color: var(--rac-ok);
}

.ra-diff-item--modified {
  border: 1px solid color-mix(in srgb, var(--rac-warn) 45%, transparent);
  background: color-mix(in srgb, var(--rac-warn) 12%, var(--rac-bg));
  color: var(--rac-warn);
}

.ra-diff-item--deleted {
  border: 1px solid color-mix(in srgb, var(--rac-alert) 45%, transparent);
  background: color-mix(in srgb, var(--rac-alert) 12%, var(--rac-bg));
  color: var(--rac-alert);
}

.ra-patch-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ra-patch-btn--reject {
  border: 1px solid color-mix(in srgb, var(--rac-alert) 55%, transparent);
  background: color-mix(in srgb, var(--rac-alert) 14%, var(--rac-bg));
  color: var(--rac-alert);
}
.ra-patch-btn--reject:hover:not(:disabled) {
  border-color: var(--rac-alert);
  background: color-mix(in srgb, var(--rac-alert) 26%, var(--rac-bg));
  color: var(--rac-hi);
}

.ra-patch-btn--defer {
  border: 1px solid var(--rac-dim);
  background: var(--rac-panel-2);
  color: var(--rac-text);
}
.ra-patch-btn--defer:hover:not(:disabled) {
  border-color: var(--rac-line);
  color: var(--rac-hi);
}

.ra-patch-btn--apply {
  border: 1px solid color-mix(in srgb, var(--rac-ok) 65%, transparent);
  background: color-mix(in srgb, var(--rac-ok) 18%, var(--rac-bg));
  color: var(--rac-ok);
}
.ra-patch-btn--apply:hover:not(:disabled) {
  border-color: var(--rac-ok);
  background: color-mix(in srgb, var(--rac-ok) 30%, var(--rac-bg));
  color: var(--rac-hi);
}

.ra-modal-enter-active,
.ra-modal-leave-active {
  transition:
    opacity 0.16s ease-out,
    transform 0.16s ease-out;
}

.ra-modal-enter-from,
.ra-modal-leave-to {
  opacity: 0;
  transform: scale(0.98);
}

@media (prefers-reduced-motion: reduce) {
  .ra-modal-enter-active,
  .ra-modal-leave-active {
    transition: none !important;
  }
}
</style>
