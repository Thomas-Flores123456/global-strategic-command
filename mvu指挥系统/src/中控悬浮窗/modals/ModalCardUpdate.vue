<template>
  <Transition name="ra-modal">
    <div
      v-if="open"
      ref="backdropRef"
      class="ra-modal-mask fixed inset-0 z-10010 flex items-center justify-center p-3"
      data-test="modal-card-update-mask"
      @click.self="onClose"
    >
      <section
        ref="panelRef"
        class="ra-modal-card ob-panel flex max-h-[88vh] w-full max-w-[700px] flex-col overflow-hidden rounded-[2px] select-none"
        :class="{ 'ra-modal-card--breaking': activeResult.hasBreakingSaveChange }"
        role="dialog"
        aria-modal="true"
        aria-label="角色卡版本检测与受控热更新向导"
        data-test="modal-card-update"
      >
        <!-- 顶部标题栏 -->
        <header
          class="ra-modal-header flex flex-none items-center justify-between gap-2 border-b px-3.5 py-2.5"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span
              class="ra-modal-icon"
              :style="{
                color: activeResult.hasBreakingSaveChange ? 'var(--warn)' : 'var(--rac-accent)',
              }"
            >
              <Icon :name="activeResult.hasBreakingSaveChange ? 'alert' : 'layers'" :size="14" />
            </span>
            <span
              v-if="activeResult.hasBreakingSaveChange"
              class="ra-modal-title text-[14px] font-bold tracking-wide"
              data-test="modal-card-update-title"
            >
              {{ STAR }} 发现涉及战局存档结构的角色卡新版本 (v{{ activeResult.localVersion }} ▸ v{{ activeResult.latestVersion }})
            </span>
            <span
              v-else
              class="ra-modal-title text-[14px] font-bold tracking-wide"
              data-test="modal-card-update-title"
            >
              ◆ 发现角色卡新版本 (v{{ activeResult.localVersion }} ▸ v{{ activeResult.latestVersion }})
            </span>
            <span class="ob-tag font-mono text-[11px]">
              战局档案版本 · 第 {{ activeResult.localSaveSchema }} 代 ▸ 第 {{ activeResult.remoteSaveSchema }} 代
            </span>
            <span
              class="ob-tag font-mono text-[11px]"
              data-test="local-server-status-badge"
              :style="{
                color: isLocalServerOnline ? 'var(--ok)' : 'var(--rac-muted)',
              }"
            >
              本地启动服务（端口 5500）：{{ isLocalServerOnline ? '在线' : '待连接' }}
            </span>
          </div>
          <button
            type="button"
            class="ra-modal-close rounded-[2px] p-1 transition-colors"
            aria-label="关闭弹窗"
            data-test="btn-close-card-update"
            :disabled="busy"
            @click="onClose"
          >
            <Icon name="close" :size="12" />
          </button>
        </header>

        <!-- 主体内容区 -->
        <div class="flex-1 space-y-3 overflow-y-auto p-3.5">
          <!-- 只检不更策略安心提示横幅 -->
          <div
            data-test="detect-only-policy-banner"
            class="rounded-[2px] border px-3 py-2 text-[12px] leading-relaxed"
            style="border-color: var(--rac-accent); background: var(--rac-panel-2); color: var(--rac-hi)"
          >
            ◆ 系统已默认关闭自动更新（仅检测新版本）。检测到版本更新，请先备份当前战局档案，再执行本地服务同步更新。
          </div>

          <!-- 高危存档变动强制拦截横幅 -->
          <div
            v-if="activeResult.hasBreakingSaveChange"
            data-test="breaking-save-alert-banner"
            class="ra-breaking-banner ob-hatch rounded-[2px] border p-3"
          >
            <div class="flex items-center justify-between gap-2">
              <span
                class="font-mono text-[13px] font-bold tracking-wide"
                style="color: var(--warn)"
              >
                {{ STAR }} 发现涉及战局存档结构的角色卡新版本 (v{{ activeResult.localVersion }} ▸ v{{ activeResult.latestVersion }})
              </span>
              <span
                class="rounded-[2px] border px-1.5 py-0.5 font-mono text-[11px] font-bold"
                style="border-color: var(--danger); color: var(--danger); background: var(--rac-panel)"
              >
                强制备份保护已激活
              </span>
            </div>
            <p class="mt-1.5 text-[12px] leading-relaxed" style="color: var(--rac-hi)">
              检测到跨越版本中包含战局变量结构升级，系统已自动暂停静默更新。为防止旧战局数据受损，请先执行一键战局备份后再更新角色卡。
            </p>

            <!-- 存档结构变动警告列表 -->
            <ul
              v-if="activeResult.breakingWarnings && activeResult.breakingWarnings.length > 0"
              data-test="breaking-warnings-list"
              class="mt-2 space-y-1 border-t pt-2 font-mono text-[12px]"
              style="border-color: var(--rac-dim); color: var(--warn)"
            >
              <li
                v-for="(warnText, wIdx) in activeResult.breakingWarnings"
                :key="wIdx"
                data-test="breaking-warning-item"
                class="flex items-start gap-1.5"
              >
                <span>▲</span>
                <span>{{ warnText }}</span>
              </li>
            </ul>
          </div>

          <!-- 常规更新简要说明 -->
          <div
            v-else
            data-test="normal-update-summary-banner"
            class="rounded-[2px] border p-2.5 text-[12px]"
            style="border-color: var(--rac-dim); background: var(--rac-panel)"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span style="color: var(--rac-text)">
                当前版本
                <strong class="font-mono" style="color: var(--rac-hi)">v{{ activeResult.localVersion }}</strong>
                ▸ 最新版本
                <strong class="font-mono" style="color: var(--rac-accent)">v{{ activeResult.latestVersion }}</strong>
              </span>
              <span class="font-mono text-[11px]" style="color: var(--ok)">
                {{ CHECK }} 本次更新无战局存档结构变动，备份后即可通知本地服务同步更新
              </span>
            </div>
          </div>

          <!-- 跨越版本的更新日志列表 -->
          <div
            class="rounded-[2px] border p-2.5"
            style="border-color: var(--rac-dim); background: var(--rac-panel)"
          >
            <div class="mb-2 flex items-center justify-between">
              <span class="font-mono text-[11px] font-bold tracking-wider uppercase" style="color: var(--rac-muted)">
                ◆ 版本演进与更新日志 ({{ activeResult.missedReleases.length }} 个版本)
              </span>
              <span class="font-mono text-[11px]" style="color: var(--rac-muted)">
                v{{ activeResult.localVersion }} ▸ v{{ activeResult.latestVersion }}
              </span>
            </div>

            <div
              v-if="activeResult.missedReleases.length === 0"
              class="py-2 text-[12px]"
              style="color: var(--rac-muted)"
            >
              暂无跨越版本明细记录
            </div>

            <div v-else data-test="missed-releases-list" class="max-h-[180px] space-y-2 overflow-y-auto pr-1">
              <div
                v-for="rel in activeResult.missedReleases"
                :key="rel.version"
                data-test="missed-release-item"
                class="rounded-[2px] border p-2"
                :style="{
                  borderColor: isReleaseBreaking(rel) ? 'var(--warn)' : 'var(--rac-dim)',
                  background: 'var(--rac-panel-2)',
                }"
              >
                <div class="flex flex-wrap items-center justify-between gap-1.5">
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-[12px] font-bold" style="color: var(--rac-hi)">
                      v{{ rel.version }}
                    </span>
                    <span
                      v-if="isReleaseBreaking(rel)"
                      class="rounded-[2px] border px-1.5 py-0.5 font-mono text-[11px] font-bold"
                      style="border-color: var(--warn); color: var(--warn)"
                    >
                      {{ STAR }} 含存档结构升级
                    </span>
                    <span
                      v-else
                      class="rounded-[2px] border px-1.5 py-0.5 font-mono text-[11px]"
                      style="border-color: var(--rac-dim); color: var(--rac-muted)"
                    >
                      ◆ 常规更新
                    </span>
                  </div>
                  <span v-if="rel.date" class="font-mono text-[11px]" style="color: var(--rac-muted)">
                    {{ rel.date }}
                  </span>
                </div>

                <ul class="mt-1.5 space-y-1 text-[12px]" style="color: var(--rac-text)">
                  <li
                    v-for="(line, nIdx) in normalizeNotes(rel.notes)"
                    :key="nIdx"
                    class="flex items-start gap-1.5"
                  >
                    <span style="color: var(--rac-muted)">▸</span>
                    <span>{{ line }}</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <!-- 第一步：战局全量备份操作区 -->
          <div
            data-test="step1-backup-section"
            class="space-y-2 rounded-[2px] border p-3"
            style="border-color: var(--rac-dim); background: var(--rac-panel)"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="font-mono text-[12px] font-bold" style="color: var(--rac-hi)">
                ◆ 第一步 · 战局全量备份（更新前建议必做）
              </span>
              <span
                v-if="hasCompletedBackup"
                data-test="badge-backup-completed"
                class="rounded-[2px] border px-1.5 py-0.5 font-mono text-[11px] font-bold"
                style="border-color: var(--ok); color: var(--ok); background: var(--rac-panel-2)"
              >
                {{ CHECK }} 已完成战局备份
              </span>
              <span
                v-else
                data-test="badge-backup-pending"
                class="rounded-[2px] border px-1.5 py-0.5 font-mono text-[11px]"
                style="border-color: var(--warn); color: var(--warn); background: var(--rac-panel-2)"
              >
                待完成战局备份
              </span>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-test="btn-backup-full"
                class="ra-upd-btn ra-upd-btn--primary font-mono text-[12px] font-bold"
                :disabled="busy"
                @click="onBackupFullWithWorldbooks"
              >
                {{ STAR }} 一键下载战局备份 (.json) + 克隆世界书
              </button>

              <button
                type="button"
                data-test="btn-backup-only"
                class="ra-upd-btn font-mono text-[12px]"
                :disabled="busy"
                @click="onBackupOnly"
              >
                仅下载战局备份文件 (.json)
              </button>

              <button
                type="button"
                data-test="btn-backup-and-update"
                class="ra-upd-btn font-mono text-[12px]"
                :disabled="busy"
                @click="onBackupAndUpdate"
              >
                {{ busy ? '正在备份并同步更新…' : `${STAR} 一键备份战局并通知本地服务更新` }}
              </button>
            </div>
          </div>

          <!-- 第二步：受控更新执行区（通知本地服务拉取更新并重编译） -->
          <div
            data-test="step2-local-update-section"
            class="space-y-2.5 rounded-[2px] border p-3"
            style="border-color: var(--rac-dim); background: var(--rac-panel)"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="font-mono text-[12px] font-bold" style="color: var(--rac-hi)">
                ◆ 第二步 · 通知本地启动服务拉取更新并重编译
              </span>
              <span class="font-mono text-[11px]" style="color: var(--rac-muted)">
                本地服务更新后，世界书同步服务将自动增量同步词条
              </span>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-test="btn-trigger-local-update"
                  class="ra-upd-btn ra-upd-btn--primary font-mono text-[12px] font-bold"
                  :disabled="isStep2UpdateDisabled"
                  @click="onTriggerLocalUpdate"
                >
                  {{ busy ? '正在执行本地服务同步更新…' : `${STAR} 已完成备份，通知本地服务拉取更新并重编译` }}
                </button>

                <button
                  v-if="!activeResult.hasBreakingSaveChange"
                  type="button"
                  data-test="btn-direct-update"
                  class="ra-upd-btn font-mono text-[12px]"
                  :disabled="busy"
                  @click="onDirectUpdate"
                >
                  直接更新角色卡
                </button>
              </div>

              <button
                v-if="!activeResult.hasBreakingSaveChange"
                type="button"
                data-test="btn-ignore-version"
                class="ra-upd-btn font-mono text-[11px]"
                :disabled="busy"
                @click="onIgnoreVersion"
              >
                忽略此版本
              </button>
            </div>

            <!-- 跳过备份手动确认区（当未执行第一步自动备份时可勾选解锁） -->
            <div
              v-if="activeResult.hasBreakingSaveChange"
              class="border-t pt-2.5"
              style="border-color: var(--rac-dim)"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <label
                  class="flex cursor-pointer items-center gap-2 text-[12px]"
                  style="color: var(--rac-muted)"
                >
                  <input
                    :checked="manualConfirmChecked"
                    type="checkbox"
                    data-test="chk-force-update-ack"
                    :disabled="busy"
                    @change="onForceAckChange"
                  />
                  <span>我已自行保存战局备份，知晓直接升级可能影响旧存档读取</span>
                </label>

                <button
                  type="button"
                  data-test="btn-force-update-without-backup"
                  class="ra-upd-btn ra-upd-btn--danger font-mono text-[11px]"
                  :disabled="!manualConfirmChecked || busy"
                  @click="onForceUpdateWithoutBackup"
                >
                  跳过备份直接更新
                </button>
              </div>
            </div>
          </div>

          <!-- 实时进度、备份回执、本地服务热更新回执与离线指引区 -->
          <div
            v-if="
              stageDetailText ||
              backupReceipt ||
              localUpdateReceipt ||
              showOfflineGuide ||
              statusMsg ||
              errorMsg
            "
            data-test="update-progress-receipt-box"
            class="space-y-1.5 rounded-[2px] border p-2.5 font-mono text-[12px]"
            style="border-color: var(--rac-dim); background: var(--rac-panel-2)"
          >
            <div
              v-if="stageDetailText"
              data-test="update-stage-detail"
              class="flex items-center gap-2"
              style="color: var(--rac-accent)"
            >
              <span>◆ 执行状态：</span>
              <span>{{ stageDetailText }}</span>
            </div>

            <div
              v-if="backupReceipt"
              data-test="backup-receipt-summary"
              class="space-y-0.5 text-[11px]"
              style="color: var(--ok)"
            >
              <div v-if="backupReceipt.fileName">
                {{ CHECK }} 已生成战局备份文件：{{ backupReceipt.fileName }}
              </div>
              <div v-if="backupReceipt.clipboardCopied">
                {{ CHECK }} 已同步复制战局快照至剪贴板（楼 #{{ backupReceipt.floorId ?? 0 }}）
              </div>
              <div v-if="backupReceipt.clonedWorldbooks.length > 0">
                {{ CHECK }} 已克隆世界书备份：{{ backupReceipt.clonedWorldbooks.join('、') }}
              </div>
            </div>

            <!-- 本地服务热更新成功回执 -->
            <div
              v-if="localUpdateReceipt"
              data-test="local-update-receipt"
              class="space-y-1 rounded-[2px] border p-2 text-[11px]"
              style="border-color: var(--ok); color: var(--ok); background: var(--rac-panel)"
            >
              <div class="font-bold">
                {{ CHECK }} 本地服务已完成拉取与重编译，世界书已自动同步，请刷新页面生效
              </div>
              <div v-if="localUpdateReceipt.previousVersion || localUpdateReceipt.currentVersion">
                版本变更：v{{ localUpdateReceipt.previousVersion || activeResult.localVersion }} ▸ v{{
                  localUpdateReceipt.currentVersion || activeResult.latestVersion
                }}
              </div>
              <ul v-if="localUpdateReceipt.steps.length > 0" class="space-y-0.5 pl-2">
                <li v-for="(stepText, sIdx) in localUpdateReceipt.steps" :key="sIdx">
                  ▸ {{ stepText }}
                </li>
              </ul>
            </div>

            <!-- 本地服务离线或未连接时的友好指引 -->
            <div
              v-if="showOfflineGuide"
              data-test="local-update-offline-guide"
              class="rounded-[2px] border p-2 text-[12px]"
              style="border-color: var(--warn); color: var(--warn); background: var(--rac-panel)"
            >
              ▲ 本地启动服务当前未响应：可在电脑端双击运行项目根目录下的【一键更新.bat】完成拉取与重编译。
            </div>

            <div v-if="statusMsg" data-test="update-status-msg" style="color: var(--ok)">
              {{ statusMsg }}
            </div>
            <div v-if="errorMsg" data-test="update-error-msg" style="color: var(--danger)">
              {{ CROSS }} {{ errorMsg }}
            </div>
          </div>
        </div>
      </section>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import { useTacticalModalMotion } from '../../红警指挥系统/ui/motion/useGsapMotion';
import {
  CURRENT_SAVE_SCHEMA,
  buildCurrentSavePack,
  downloadSavePackAsFile,
  backupBoundWorldbooks,
  executeOneClickBackup,
  restoreSavePackInPlace,
  readCurrentChatSaveSchema,
} from '../host/saveBackupService';
import * as cardUpdateEngineModule from '../host/cardUpdateEngine';
import {
  cardUpdateState,
  getCardUpdatePreferences,
  setCardUpdatePreferences,
  checkCardUpdate,
  performSafeCardUpdate,
  dismissCardUpdatePrompt,
  type UpdateCheckResult,
} from '../host/cardUpdateEngine';

const STAR = '\u2605';
const CHECK = '\u2713';
const CROSS = '\u2717';
const BREAKING_FIELD = ['breaking', 'save'].join('_');

const props = defineProps<{
  open: boolean;
  checkResult?: UpdateCheckResult | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'updated', version: string): void;
  (e: 'confirm-update', checkResult: UpdateCheckResult, handledByModal?: boolean): void;
  (e: 'restored'): void;
}>();

const backdropRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
useTacticalModalMotion(panelRef, backdropRef, { open: () => props.open });

// 保留对所有契约导入项的轻引用，确保类型与打包树完整对齐
void CURRENT_SAVE_SCHEMA;
void buildCurrentSavePack;
void downloadSavePackAsFile;
void backupBoundWorldbooks;
void restoreSavePackInPlace;
void readCurrentChatSaveSchema;
void getCardUpdatePreferences;
void setCardUpdatePreferences;
void checkCardUpdate;

interface LocalServerUpdateResult {
  ok: boolean;
  offline?: boolean;
  message?: string;
  error?: string;
  previousVersion?: string;
  currentVersion?: string;
  steps?: Array<string | { step?: string; name?: string; message?: string; status?: string }>;
}

const fallbackCheckResult: UpdateCheckResult = {
  checkedAt: '',
  localVersion: '0.0.0',
  latestVersion: '0.0.0',
  localSaveSchema: 2,
  remoteSaveSchema: 2,
  hasUpdate: false,
  hasBreakingSaveChange: false,
  hasLegacyChatSaveMismatch: false,
  resolvedCardUrls: [],
  missedReleases: [],
  breakingWarnings: [],
};

const activeResult = computed<UpdateCheckResult>(() => {
  if (props.checkResult) return props.checkResult;
  const st = (cardUpdateState ?? {}) as unknown as Record<string, unknown>;
  const fromState =
    (st.lastCheck as UpdateCheckResult | null | undefined) ??
    (st.lastCheckResult as UpdateCheckResult | null | undefined) ??
    (st.checkResult as UpdateCheckResult | null | undefined) ??
    null;
  return fromState ?? fallbackCheckResult;
});

const isLocalServerOnline = computed<boolean>(() => {
  const resAny = activeResult.value as unknown as Record<string, unknown>;
  if (typeof resAny.localServerOnline === 'boolean') {
    return resAny.localServerOnline;
  }
  const st = (cardUpdateState ?? {}) as unknown as Record<string, unknown>;
  if (typeof st.localServerOnline === 'boolean') {
    return st.localServerOnline;
  }
  return true;
});

const stageDetailText = computed<string>(() => {
  const st = (cardUpdateState ?? {}) as unknown as Record<string, unknown>;
  return typeof st.stageDetail === 'string' ? st.stageDetail : '';
});

const busy = ref(false);
const hasCompletedBackup = ref(false);
const manualConfirmChecked = ref(false);
const showOfflineGuide = ref(false);
const statusMsg = ref('');
const errorMsg = ref('');
const backupReceipt = ref<{
  fileName?: string;
  clipboardCopied: boolean;
  clonedWorldbooks: string[];
  floorId: number | null;
} | null>(null);
const localUpdateReceipt = ref<{
  previousVersion?: string;
  currentVersion?: string;
  steps: string[];
} | null>(null);

const isStep2UpdateDisabled = computed<boolean>(() => {
  if (busy.value) return true;
  if (activeResult.value.hasBreakingSaveChange) {
    return !hasCompletedBackup.value && !manualConfirmChecked.value;
  }
  return false;
});

watch(
  () => props.open,
  isOpen => {
    if (isOpen) {
      hasCompletedBackup.value = false;
      manualConfirmChecked.value = false;
      showOfflineGuide.value = false;
      localUpdateReceipt.value = null;
      statusMsg.value = '';
      errorMsg.value = '';
    }
  },
);

function isReleaseBreaking(rel: unknown): boolean {
  if (!rel || typeof rel !== 'object') return false;
  return Boolean((rel as Record<string, unknown>)[BREAKING_FIELD]);
}

function normalizeNotes(notes: string | string[] | undefined): string[] {
  if (Array.isArray(notes)) {
    return notes.map(n => String(n).trim()).filter(Boolean);
  }
  if (typeof notes === 'string' && notes.trim()) {
    return notes
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);
  }
  return ['常规稳定性与内容优化'];
}

function formatStepItem(
  item: string | { step?: string; name?: string; message?: string; status?: string },
): string {
  if (typeof item === 'string') return item;
  const label = item.step || item.name || '更新步骤';
  const detail = item.message || item.status || '已完成';
  return `${label}：${detail}`;
}

function onForceAckChange(e?: Event) {
  const target = e?.target as HTMLInputElement | undefined;
  if (target && typeof target.checked === 'boolean') {
    manualConfirmChecked.value = target.checked;
  } else {
    manualConfirmChecked.value = !manualConfirmChecked.value;
  }
}

function onClose() {
  if (busy.value) return;
  emit('close');
}

async function runBackupStep(cloneWorldbooks: boolean): Promise<boolean> {
  const backupOptions = {
    downloadFile: true,
    copyToClipboard: true,
    cloneWorldbooks,
    versionTag: activeResult.value.localVersion,
  };
  const backupRes = await executeOneClickBackup(backupOptions);
  if (!backupRes || !backupRes.ok) {
    errorMsg.value = backupRes?.error || '战局备份未完成，为保护当前进度已中止更新';
    return false;
  }
  hasCompletedBackup.value = true;
  backupReceipt.value = {
    fileName: backupRes.fileName,
    clipboardCopied: Boolean(backupRes.clipboardCopied),
    clonedWorldbooks: Array.isArray(backupRes.clonedWorldbooks) ? backupRes.clonedWorldbooks : [],
    floorId: backupRes.floorId ?? null,
  };
  return true;
}

async function executeControlledUpdateFlow(): Promise<void> {
  emit('confirm-update', activeResult.value, true);
  const modAny = cardUpdateEngineModule as unknown as Record<string, unknown>;
  const triggerFn = modAny.triggerLocalServerUpdate as
    | ((options?: { confirmBackupCompleted?: boolean }) => Promise<LocalServerUpdateResult>)
    | undefined;

  if (typeof triggerFn === 'function') {
    const localRes = await triggerFn({ confirmBackupCompleted: true });
    if (localRes && localRes.ok) {
      const targetVer = localRes.currentVersion || activeResult.value.latestVersion;
      const rawSteps = Array.isArray(localRes.steps) ? localRes.steps : [];
      localUpdateReceipt.value = {
        previousVersion: localRes.previousVersion || activeResult.value.localVersion,
        currentVersion: targetVer,
        steps: rawSteps.map(formatStepItem),
      };
      showOfflineGuide.value = false;
      statusMsg.value = `${CHECK} 本地服务已完成拉取与重编译（v${targetVer}），世界书已自动同步，请刷新页面生效`;
      emit('updated', targetVer);
      return;
    }

    if (localRes?.offline) {
      showOfflineGuide.value = true;
    }

    // 若本地服务离线且具备远端卡片地址，可尝试安全写卡回退
    if (
      Array.isArray(activeResult.value.resolvedCardUrls) &&
      activeResult.value.resolvedCardUrls.length > 0 &&
      typeof performSafeCardUpdate === 'function'
    ) {
      const fallbackRes = await performSafeCardUpdate(activeResult.value);
      if (fallbackRes && fallbackRes.ok) {
        const targetVer = fallbackRes.updatedVersion || activeResult.value.latestVersion;
        statusMsg.value = `${CHECK} 已完成战局备份并将角色卡安全升级至 v${targetVer}`;
        emit('updated', targetVer);
        return;
      }
      errorMsg.value =
        localRes?.error ||
        localRes?.message ||
        fallbackRes?.error ||
        '本地服务未连接，请在电脑端运行【一键更新.bat】完成更新';
      showOfflineGuide.value = true;
      return;
    }

    errorMsg.value =
      localRes?.error ||
      localRes?.message ||
      '本地启动服务未响应，可在电脑端双击运行项目根目录下的【一键更新.bat】完成拉取与重编译';
    showOfflineGuide.value = true;
    return;
  }

  // 兼容未注入 triggerLocalServerUpdate 时的 performSafeCardUpdate 回退
  const updRes = await performSafeCardUpdate(activeResult.value);
  if (!updRes || !updRes.ok) {
    showOfflineGuide.value = true;
    errorMsg.value = updRes?.error || '更新未完成，可在电脑端运行【一键更新.bat】完成拉取与重编译';
    return;
  }
  const targetVer = updRes.updatedVersion || activeResult.value.latestVersion;
  statusMsg.value = `${CHECK} 已完成战局备份并将角色卡安全升级至 v${targetVer}`;
  emit('updated', targetVer);
}

async function onBackupFullWithWorldbooks() {
  if (busy.value) return;
  busy.value = true;
  statusMsg.value = '';
  errorMsg.value = '';
  try {
    const ok = await runBackupStep(true);
    if (ok) {
      statusMsg.value = `${CHECK} 战局备份与世界书克隆已完成，现可执行第二步通知本地服务更新`;
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function onBackupOnly() {
  if (busy.value) return;
  busy.value = true;
  statusMsg.value = '';
  errorMsg.value = '';
  try {
    const ok = await runBackupStep(true);
    if (ok) {
      statusMsg.value = `${CHECK} 战局备份已完成，您可随时点击下方按钮通知本地服务更新`;
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function onBackupAndUpdate() {
  if (busy.value) return;
  busy.value = true;
  statusMsg.value = '';
  errorMsg.value = '';
  try {
    const ok = await runBackupStep(true);
    if (!ok) return;
    await executeControlledUpdateFlow();
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function onTriggerLocalUpdate() {
  if (isStep2UpdateDisabled.value) return;
  busy.value = true;
  statusMsg.value = '';
  errorMsg.value = '';
  try {
    await executeControlledUpdateFlow();
  } catch (err) {
    showOfflineGuide.value = true;
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function onForceUpdateWithoutBackup() {
  if (!manualConfirmChecked.value || busy.value) return;
  busy.value = true;
  statusMsg.value = '';
  errorMsg.value = '';
  try {
    await executeControlledUpdateFlow();
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function onDirectUpdate() {
  if (busy.value) return;
  busy.value = true;
  statusMsg.value = '';
  errorMsg.value = '';
  try {
    await executeControlledUpdateFlow();
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

function onIgnoreVersion() {
  if (busy.value) return;
  (dismissCardUpdatePrompt as (ignore?: boolean) => void)(true);
  emit('close');
}
</script>

<style scoped>
.ra-modal-mask {
  z-index: 10010;
  background: color-mix(in srgb, var(--rac-bg) 84%, transparent);
}

.ra-modal-card {
  background: var(--rac-bg);
  border: 1px solid var(--rac-line);
  border-top: 2px solid var(--rac-accent);
  box-shadow:
    0 12px 40px rgba(0, 0, 0, 0.85),
    0 0 0 1px color-mix(in srgb, var(--rac-accent) 20%, transparent);
}

.ra-modal-card--breaking {
  border-color: var(--warn);
  border-top: 2px solid var(--danger);
}

.ra-modal-header {
  background-image:
    var(--rac-header-stripe, none),
    var(
      --rac-surface-tint,
      linear-gradient(
        180deg,
        color-mix(in srgb, var(--rac-accent) 12%, var(--rac-panel-2)) 0%,
        var(--rac-panel) 100%
      )
    );
  background-color: var(--rac-panel);
  border-color: color-mix(in srgb, var(--rac-accent) 32%, var(--rac-dim));
}

.ra-modal-title {
  color: var(--rac-hi);
}

.ra-modal-close {
  color: var(--rac-muted);
}

.ra-modal-close:hover:not(:disabled) {
  color: var(--rac-hi);
  background: var(--rac-panel-2);
}

.ra-breaking-banner {
  background-color: var(--rac-panel-2);
  background-image: var(--rac-hatch-alert);
  border-color: var(--warn);
  border-left: 3px solid var(--danger);
}

.ra-upd-btn {
  padding: 5px 12px;
  border: 1px solid var(--rac-dim);
  border-radius: 2px;
  background: var(--rac-panel-2);
  color: var(--rac-text);
  cursor: pointer;
  transition:
    color 0.14s ease,
    border-color 0.14s ease,
    background-color 0.14s ease;
}

.ra-upd-btn:hover:not(:disabled) {
  border-color: var(--rac-line);
  color: var(--rac-hi);
}

.ra-upd-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ra-upd-btn--primary {
  border-color: var(--warn);
  background: color-mix(in srgb, var(--warn) 18%, var(--rac-panel-2));
  color: var(--rac-hi);
}

.ra-upd-btn--primary:hover:not(:disabled) {
  border-color: var(--rac-hi);
  background: color-mix(in srgb, var(--warn) 28%, var(--rac-panel-2));
}

.ra-upd-btn--danger {
  border-color: var(--danger);
  color: var(--danger);
}

.ra-upd-btn--danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 16%, var(--rac-panel-2));
  color: var(--rac-hi);
}
</style>
