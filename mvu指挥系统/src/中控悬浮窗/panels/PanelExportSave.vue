<template>
  <!--
    G1 · 战局备份导出 + .json 原位恢复 + 版本检测与本地服务同步设置 三合一面板
    保留原有根类名 ra-expsave card ob-panel 与「导出存档到剪贴板」按钮及降级路径，100% 向下兼容既有测试。
  -->
  <section class="ra-expsave card ob-panel space-y-3 px-3 py-2.5">
    <!-- ══ 第一区 · 战局快照备份与导出 ══ -->
    <div
      data-test="section-save-backup"
      class="space-y-2 rounded-[2px] border p-2.5"
      style="border-color: var(--rac-dim); background: var(--rac-panel)"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="font-mono text-[12px] font-bold tracking-wide" style="color: var(--rac-hi)">
          ◆ 第一区 · 战局快照备份与导出
        </span>
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="ob-tag font-mono text-[11px]" data-test="tag-card-version">
            角色卡 v{{ currentCardVersion }}
          </span>
          <span class="ob-tag font-mono text-[11px]" data-test="tag-save-schema">
            战局存档格式代数 · 第 {{ currentSaveSchema }} 代
          </span>
        </div>
      </div>

      <!-- 旧版存档格式代数提醒条 -->
      <div
        v-if="isLegacyChatSchema"
        data-test="legacy-chat-schema-alert"
        class="rounded-[2px] border px-2.5 py-1.5 font-mono text-[12px]"
        style="border-color: var(--warn); color: var(--warn); background: var(--rac-panel-2)"
      >
        {{ STAR }} 当前战局为旧版格式存档，建议先导出备份文件
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          class="sysbtn"
          :disabled="!env.inTavern || expBusy"
          :title="env.inTavern ? '读取最新楼层战况存档并复制到剪贴板' : '仅酒馆内可导出；独立预览不可用'"
          @click="doExportSave"
        >
          {{ expBusy ? '导出中…' : '导出存档到剪贴板' }}
        </button>

        <button
          type="button"
          class="sysbtn"
          data-test="btn-download-save-json"
          :disabled="expBusy"
          title="打包当前战局快照并下载为本地 .json 备份文件"
          @click="doDownloadSaveJson"
        >
          下载战局备份 (.json)
        </button>

        <button
          type="button"
          class="sysbtn sysbtn--highlight"
          data-test="btn-full-backup-with-wb"
          :disabled="expBusy"
          title="同时下载 .json 战局备份、复制到剪贴板，并在酒馆内克隆绑定世界书副本"
          @click="doFullBackupWithWb"
        >
          {{ STAR }} 一键全量备份 (含克隆世界书)
        </button>
      </div>

      <div style="color: var(--rac-muted); font-size: 12px">
        新聊天楼 0 开场启动器→导入存档→粘贴即可继承进度，或直接从本地备份文件 (.json) 恢复
      </div>

      <div v-if="expMsg" data-test="export-save-msg" class="mt-1.5" style="color: var(--ok); font-size: 12px">
        {{ expMsg }}
      </div>
      <div v-if="expErr" data-test="export-save-err" class="mt-1.5" style="color: var(--danger); font-size: 12px">
        {{ expErr }}
      </div>
      <textarea v-if="expJson" class="systa mt-1.5" rows="4" readonly :value="expJson" @focus="selectAllText" />
    </div>

    <!-- ══ 第二区 · 从本地备份文件 (.json) 或剪贴板原位恢复战局 ══ -->
    <div
      data-test="section-save-restore"
      class="space-y-2 rounded-[2px] border p-2.5"
      style="border-color: var(--rac-dim); background: var(--rac-panel)"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="font-mono text-[12px] font-bold tracking-wide" style="color: var(--rac-hi)">
          ◆ 第二区 · 从本地备份文件 (.json) 恢复当前战局
        </span>
        <button
          type="button"
          class="sysbtn text-[11px]"
          data-test="btn-toggle-restore-paste"
          @click="restorePasteExpanded = !restorePasteExpanded"
        >
          {{ restorePasteExpanded ? '▾ 收起粘贴恢复框' : '▸ 展开粘贴恢复框' }}
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <input
          ref="restoreFileInput"
          type="file"
          accept=".json,application/json"
          data-test="restore-file-input"
          class="hidden"
          @change="onRestoreFileSelected"
        />
        <button
          type="button"
          class="sysbtn sysbtn--highlight"
          data-test="btn-select-restore-file"
          :disabled="restoreBusy"
          @click="triggerRestoreFileSelect"
        >
          选择备份文件 (.json) 恢复
        </button>
        <span v-if="selectedRestoreFileName" class="font-mono text-[11px]" style="color: var(--rac-accent)">
          已选文件：{{ selectedRestoreFileName }}
        </span>
      </div>

      <div v-if="restorePasteExpanded" class="space-y-2 pt-1">
        <textarea
          :value="restoreRawJson"
          data-test="textarea-restore-json"
          class="systa"
          rows="3"
          placeholder="在此粘贴战局备份 (.json) 文本内容，或点击上方按钮直接选择本地 .json 备份文件…"
          @input="onRestoreTextareaInput"
        />
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="sysbtn sysbtn--highlight"
            data-test="btn-confirm-restore-inplace"
            :disabled="restoreBusy"
            @click="doConfirmRestoreInPlace"
          >
            {{ restoreBusy ? '恢复中…' : '确认恢复至当前战局' }}
          </button>
          <span class="text-[11px]" style="color: var(--rac-muted)">
            将备份中的战局状态、时间线账本与绑定世界书词条原位写回当前聊天并刷新中控台
          </span>
        </div>
      </div>

      <div
        v-if="restoreMsg"
        data-test="restore-save-msg"
        class="mt-1"
        style="color: var(--ok); font-size: 12px"
      >
        {{ restoreMsg }}
      </div>
      <div
        v-if="restoreErr"
        data-test="restore-save-err"
        class="mt-1"
        style="color: var(--danger); font-size: 12px"
      >
        {{ restoreErr }}
      </div>
    </div>

    <!-- ══ 第三区 · 版本检测与本地服务同步设置 ══ -->
    <div
      data-test="section-card-update"
      class="space-y-2.5 rounded-[2px] border p-2.5"
      style="border-color: var(--rac-dim); background: var(--rac-panel)"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="font-mono text-[12px] font-bold tracking-wide" style="color: var(--rac-hi)">
          ◆ 第三区 · 版本检测与本地服务同步设置
        </span>
        <div class="flex flex-wrap items-center gap-1.5">
          <span
            class="ob-tag font-mono text-[11px]"
            data-test="badge-update-policy"
            style="color: var(--rac-accent)"
          >
            更新策略：仅检测新版本（已关闭自动覆盖）
          </span>
          <span
            class="ob-tag font-mono text-[11px]"
            data-test="badge-local-server-status"
            :style="{ color: isLocalServerOnline ? 'var(--ok)' : 'var(--warn)' }"
          >
            本地启动服务（端口 5500）：{{ isLocalServerOnline ? '在线' : '待连接' }}
          </span>
        </div>
      </div>

      <!-- 远端版本清单地址输入 -->
      <div class="space-y-1">
        <label class="block font-mono text-[11px]" style="color: var(--rac-muted)">
          远端版本清单地址（可选，默认优先通过本地启动服务探测）
        </label>
        <input
          :value="prefs.manifestUrl"
          type="text"
          data-test="input-manifest-url"
          class="sysinput"
          placeholder="输入远端版本清单地址（支持多节点自动备援）"
          @input="onManifestUrlInput"
          @change="onSaveUpdatePrefs"
        />
      </div>

      <!-- 启动时自动检测新版本开关（只检不更） -->
      <div class="space-y-1 pt-0.5">
        <label class="flex cursor-pointer items-center gap-2 text-[12px]" style="color: var(--rac-text)">
          <input
            :checked="prefs.checkOnStartup"
            type="checkbox"
            data-test="chk-check-on-startup"
            @change="onToggleCheckOnStartup"
          />
          <span>启动时自动检测新版本（仅提示版本变动，绝不自动覆盖本地文件）</span>
        </label>
        <div class="pl-5 text-[11px]" style="color: var(--rac-muted)">
          检测到版本更新后，请先备份当前战局档案，再通知本地启动服务拉取更新并重编译
        </div>
      </div>

      <!-- 立即检测新版本与结果摘要 -->
      <div class="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          class="sysbtn sysbtn--highlight"
          data-test="btn-check-card-update"
          :disabled="updateCheckBusy"
          @click="doCheckCardUpdateNow"
        >
          {{ updateCheckBusy ? '正在检测新版本…' : '立即检测新版本' }}
        </button>

        <span v-if="updateCheckMsg" data-test="update-check-msg" class="text-[12px]" style="color: var(--ok)">
          {{ updateCheckMsg }}
        </span>
        <span v-if="updateCheckErr" data-test="update-check-err" class="text-[12px]" style="color: var(--danger)">
          {{ updateCheckErr }}
        </span>
      </div>

      <!-- 检测到新版本时的版本对比摘要、打开向导与一键备份并通知本地服务更新入口 -->
      <div
        v-if="detectedUpdate && detectedUpdate.hasUpdate"
        data-test="detected-update-summary-box"
        class="flex flex-wrap items-center justify-between gap-2 rounded-[2px] border p-2.5"
        :style="{
          borderColor: detectedUpdate.hasBreakingSaveChange ? 'var(--warn)' : 'var(--rac-accent)',
          background: 'var(--rac-panel-2)',
        }"
      >
        <div class="space-y-0.5 text-[12px]">
          <div class="font-mono font-bold" style="color: var(--rac-hi)">
            {{ detectedUpdate.hasBreakingSaveChange ? `${STAR} 发现涉及存档结构的版本更新` : '◆ 发现可用新版本' }}
            · v{{ detectedUpdate.localVersion }} ▸ v{{ detectedUpdate.latestVersion }}
          </div>
          <div class="text-[11px]" style="color: var(--rac-muted)">
            战局档案版本：第 {{ detectedUpdate.localSaveSchema }} 代 ▸ 第 {{ detectedUpdate.remoteSaveSchema }} 代
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="sysbtn sysbtn--highlight font-mono text-[11px]"
            data-test="btn-open-update-wizard"
            @click="openUpdateWizard"
          >
            打开版本详情与战局备份向导
          </button>

          <button
            type="button"
            class="sysbtn font-mono text-[11px]"
            data-test="btn-backup-and-local-update"
            :disabled="updateCheckBusy"
            @click="doBackupAndNotifyLocalServer"
          >
            {{ STAR }} 先备份战局并通知本地服务更新
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script lang="ts">
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';
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

// 保留契约导出符号引用，防止构建摇树或未使用告警
void downloadSavePackAsFile;
void backupBoundWorldbooks;
void performSafeCardUpdate;
void dismissCardUpdatePrompt;
</script>

<script setup lang="ts">
import { ref } from 'vue';
import { in_tavern } from '../../红警指挥系统/composables/store';
import { checkEnv, tav } from '../../红警指挥系统/parse/systemCheck';

const STAR = '\u2605';
const CHECK = '\u2713';

const env = checkEnv(in_tavern);

/* ── 第一区状态：战局快照备份与导出 ── */
const expBusy = ref(false);
const expMsg = ref('');
const expErr = ref('');
/** clipboard 失败降级：内联 textarea 供手动复制 */
const expJson = ref('');

const currentSaveSchema = ref<number>(
  typeof CURRENT_SAVE_SCHEMA === 'number' ? CURRENT_SAVE_SCHEMA : 2,
);
const chatSaveSchema = ref<number>(
  typeof readCurrentChatSaveSchema === 'function'
    ? readCurrentChatSaveSchema()
    : currentSaveSchema.value,
);
const isLegacyChatSchema = ref<boolean>(chatSaveSchema.value < currentSaveSchema.value);
const currentCardVersion = ref<string>('1.0.0');

function syncSchemaReadout() {
  if (typeof CURRENT_SAVE_SCHEMA === 'number') {
    currentSaveSchema.value = CURRENT_SAVE_SCHEMA;
  }
  if (typeof readCurrentChatSaveSchema === 'function') {
    try {
      chatSaveSchema.value = readCurrentChatSaveSchema();
    } catch {
      chatSaveSchema.value = currentSaveSchema.value;
    }
  }
  isLegacyChatSchema.value = chatSaveSchema.value < currentSaveSchema.value;
  if (typeof cardUpdateState !== 'undefined' && cardUpdateState) {
    const st = cardUpdateState as unknown as Record<string, unknown>;
    const lastRes = (st.lastCheck ?? st.lastCheckResult ?? st.checkResult) as
      | UpdateCheckResult
      | null
      | undefined;
    if (lastRes?.localVersion) {
      currentCardVersion.value = lastRes.localVersion;
    }
  }
}

syncSchemaReadout();

function selectAllText(e: FocusEvent) {
  (e.target as HTMLTextAreaElement).select();
}

type ChatMsgLite = { role?: string; is_hidden?: boolean };

/**
 * 中控悬浮窗是全局脚本 iframe：Tavern Helper 禁止在此调用 getCurrentMessageId（会抛
 * 「不要对全局脚本 iframe 调用 getMessageId」）。对齐 PanelParseRepair.vue 优先从
 * getLastMessageId 向前定位最新有效楼层；仅在无 getLastMessageId 时安全回退探测。
 */
function resolveLatestExportFloor(
  gv: (o: { type: string; message_id?: number }) => Record<string, unknown> | undefined,
): { mid: number | null; statData: unknown } {
  const glmi = tav<() => number>('getLastMessageId');
  const gcm = tav<(id: number) => ChatMsgLite[]>('getChatMessages');
  if (glmi) {
    const lastId = glmi();
    if (typeof lastId === 'number' && lastId >= 0) {
      let fallbackMid: number | null = null;
      for (let id = lastId; id >= 0; id--) {
        if (gcm) {
          const m = gcm(id)?.[0];
          if (m && (m.role === 'user' || m.is_hidden)) continue;
        }
        if (fallbackMid === null) fallbackMid = id;
        const statData = (gv({ type: 'message', message_id: id }) ?? {})['stat_data'];
        if (statData !== undefined) {
          return { mid: id, statData };
        }
      }
      return { mid: fallbackMid ?? lastId, statData: undefined };
    }
    return { mid: null, statData: undefined };
  }
  const gcmi = tav<() => number>('getCurrentMessageId');
  if (gcmi) {
    try {
      const mid = gcmi();
      if (typeof mid === 'number' && mid >= 0) {
        const statData = (gv({ type: 'message', message_id: mid }) ?? {})['stat_data'];
        return { mid, statData };
      }
    } catch {
      return { mid: null, statData: undefined };
    }
  }
  return { mid: null, statData: undefined };
}

async function doExportSave() {
  expBusy.value = true;
  expMsg.value = '';
  expErr.value = '';
  expJson.value = '';
  try {
    if (typeof buildCurrentSavePack === 'function') {
      const built = await buildCurrentSavePack();
      if (built && built.ok && typeof built.jsonText === 'string') {
        const json = built.jsonText;
        const mid = built.floorId ?? 0;
        if (built.cardVersion) {
          currentCardVersion.value = built.cardVersion;
        }
        try {
          await navigator.clipboard.writeText(json);
          expMsg.value = `\u2713 已复制存档（${json.length} 字符，楼 #${mid}）`;
        } catch {
          expJson.value = json;
          expErr.value = '剪贴板不可用——请点击下方文本框全选后手动复制';
        }
        return;
      }
    }

    const gv = tav<(o: { type: string; message_id?: number }) => Record<string, unknown> | undefined>('getVariables');
    const hasFloorApi = Boolean(tav('getLastMessageId') || tav('getCurrentMessageId'));
    if (!gv || !hasFloorApi) {
      expErr.value = '仅酒馆内可导出（变量 API 不可用）';
      return;
    }
    const { mid, statData } = resolveLatestExportFloor(gv);
    if (mid === null || statData === undefined) {
      expErr.value = '当前楼层无有效战况数据（本楼无变量数据）';
      return;
    }
    const getChatName = tav<() => string>('getCurrentChatName');
    const chatVars = (gv({ type: 'chat' }) ?? {}) as Record<string, unknown>;
    const parseState =
      chatVars.$parse && typeof chatVars.$parse === 'object' && !Array.isArray(chatVars.$parse)
        ? (chatVars.$parse as Record<string, unknown>)
        : undefined;
    const dlcRegistry = Array.isArray(chatVars.$dlc) ? (chatVars.$dlc as unknown[]) : undefined;
    const timelineLedger =
      chatVars.$timeline && typeof chatVars.$timeline === 'object' && !Array.isArray(chatVars.$timeline)
        ? (chatVars.$timeline as Record<string, unknown>)
        : undefined;

    let chatWorldbookEntries:
      | {
          name: string;
          content: string;
          enabled?: boolean;
          comment?: string;
          keys?: string[];
          position?: Record<string, unknown>;
          strategy?: Record<string, unknown>;
          recursion?: Record<string, unknown>;
          extra?: Record<string, unknown>;
        }[]
      | undefined;
    try {
      const getChatWbName = tav<(target?: string) => string | null>('getChatWorldbookName');
      const getWb = tav<(name: string) => Promise<Record<string, unknown>[]>>('getWorldbook');
      const boundBook = getChatWbName ? (getChatWbName('current') ?? '').trim() : '';
      if (boundBook && getWb) {
        const rawEntries = await getWb(boundBook);
        if (Array.isArray(rawEntries)) {
          chatWorldbookEntries = rawEntries
            .filter(e => e && typeof e === 'object' && typeof e.name === 'string')
            .map(e => {
              const strategy = e.strategy as { keys?: unknown[] } | undefined;
              const rawKeys = Array.isArray(e.keys)
                ? e.keys
                : Array.isArray(strategy?.keys)
                  ? strategy.keys
                  : undefined;
              return {
                name: String(e.name),
                content: typeof e.content === 'string' ? e.content : '',
                ...(typeof e.enabled === 'boolean' ? { enabled: e.enabled } : {}),
                ...(typeof e.comment === 'string' && e.comment ? { comment: e.comment } : {}),
                ...(rawKeys ? { keys: rawKeys.map(k => String(k)) } : {}),
                ...(e.position && typeof e.position === 'object' && !Array.isArray(e.position)
                  ? { position: JSON.parse(JSON.stringify(e.position)) }
                  : {}),
                ...(e.strategy && typeof e.strategy === 'object' && !Array.isArray(e.strategy)
                  ? { strategy: JSON.parse(JSON.stringify(e.strategy)) }
                  : {}),
                ...(e.recursion && typeof e.recursion === 'object' && !Array.isArray(e.recursion)
                  ? { recursion: JSON.parse(JSON.stringify(e.recursion)) }
                  : {}),
                ...(e.extra && typeof e.extra === 'object' && !Array.isArray(e.extra)
                  ? { extra: JSON.parse(JSON.stringify(e.extra)) }
                  : {}),
              };
            });
        }
      }
    } catch {
      /* 异步读取世界书失败时省略 chat_worldbook_entries，不阻断导出 */
    }

    const basePack = {
      version: 1,
      kind: 'redalert-save',
      exportedAt: new Date().toISOString(),
      source: { chat: getChatName ? getChatName() : '', message_id: mid },
      stat_data: statData,
    };
    const pack = {
      ...basePack,
      version: 2,
      ...(parseState !== undefined ? { parse_state: parseState } : {}),
      ...(dlcRegistry !== undefined ? { dlc_registry: dlcRegistry } : {}),
      ...(timelineLedger !== undefined ? { timeline_ledger: timelineLedger } : {}),
      ...(chatWorldbookEntries !== undefined ? { chat_worldbook_entries: chatWorldbookEntries } : {}),
    };
    const json = JSON.stringify(pack);
    try {
      await navigator.clipboard.writeText(json);
      expMsg.value = `\u2713 已复制存档（${json.length} 字符，楼 #${mid}）`;
    } catch {
      expJson.value = json;
      expErr.value = '剪贴板不可用——请点击下方文本框全选后手动复制';
    }
  } catch (e) {
    expErr.value = e instanceof Error ? e.message : String(e);
  } finally {
    expBusy.value = false;
  }
}

async function doDownloadSaveJson() {
  if (typeof executeOneClickBackup !== 'function') return;
  expBusy.value = true;
  expMsg.value = '';
  expErr.value = '';
  try {
    const res = await executeOneClickBackup({
      downloadFile: true,
      copyToClipboard: true,
      cloneWorldbooks: false,
    });
    if (!res || !res.ok) {
      expErr.value = res?.error || '下载战局备份失败';
      return;
    }
    expMsg.value = `${CHECK} 已下载战局备份文件 ${res.fileName || '(.json)'}（楼 #${res.floorId ?? 0}）`;
  } catch (e) {
    expErr.value = e instanceof Error ? e.message : String(e);
  } finally {
    expBusy.value = false;
  }
}

async function doFullBackupWithWb() {
  if (typeof executeOneClickBackup !== 'function') return;
  expBusy.value = true;
  expMsg.value = '';
  expErr.value = '';
  try {
    const res = await executeOneClickBackup({
      downloadFile: true,
      copyToClipboard: true,
      cloneWorldbooks: true,
    });
    if (!res || !res.ok) {
      expErr.value = res?.error || '一键全量备份失败';
      return;
    }
    const wbNote =
      Array.isArray(res.clonedWorldbooks) && res.clonedWorldbooks.length > 0
        ? `，已克隆世界书：${res.clonedWorldbooks.join('、')}`
        : '';
    expMsg.value = `${CHECK} 已完成全量备份 ${res.fileName || '(.json)'}（楼 #${res.floorId ?? 0}${wbNote}）`;
  } catch (e) {
    expErr.value = e instanceof Error ? e.message : String(e);
  } finally {
    expBusy.value = false;
  }
}

/* ── 第二区状态：从本地备份文件 (.json) 或剪贴板原位恢复战局 ── */
const restoreFileInput = ref<HTMLInputElement | null>(null);
const restorePasteExpanded = ref(true);
const restoreRawJson = ref('');
const selectedRestoreFileName = ref('');
const restoreBusy = ref(false);
const restoreMsg = ref('');
const restoreErr = ref('');

function triggerRestoreFileSelect() {
  restoreFileInput.value?.click();
}

function onRestoreTextareaInput(e: Event) {
  const target = e.target as HTMLTextAreaElement | null;
  if (target && typeof target.value === 'string') {
    restoreRawJson.value = target.value;
  }
}

async function executeRestoreWithJson(rawJson: string) {
  if (typeof restoreSavePackInPlace !== 'function') return;
  const trimmed = rawJson.trim();
  if (!trimmed) {
    restoreErr.value = '请先选择本地备份文件 (.json) 或粘贴备份内容';
    return;
  }
  restoreBusy.value = true;
  restoreMsg.value = '';
  restoreErr.value = '';
  try {
    const res = await restoreSavePackInPlace(trimmed);
    if (!res || !res.ok) {
      restoreErr.value = res?.error || '原位恢复失败，请检查备份文件格式';
      return;
    }
    if (typeof useFloatingStore === 'function') {
      try {
        const floating = useFloatingStore();
        await floating?.refresh?.();
      } catch {
        /* ignore store refresh error in isolated test */
      }
    }
    syncSchemaReadout();
    const floorId = res.restoredFloorId ?? 0;
    const wbCount = res.restoredWorldbookEntriesCount ?? 0;
    restoreMsg.value = `${CHECK} 已成功恢复至当前战局（楼层 #${floorId}，恢复世界书词条 ${wbCount} 条）`;
  } catch (e) {
    restoreErr.value = e instanceof Error ? e.message : String(e);
  } finally {
    restoreBusy.value = false;
  }
}

async function onRestoreFileSelected(e: Event) {
  const input = e.target as HTMLInputElement | null;
  const file = input?.files?.[0];
  if (!file) return;
  selectedRestoreFileName.value = file.name || 'backup.json';
  try {
    const text =
      typeof file.text === 'function'
        ? await file.text()
        : await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ''));
            reader.onerror = () => reject(new Error('读取本地备份文件失败'));
            reader.readAsText(file, 'utf-8');
          });
    restoreRawJson.value = text;
    await executeRestoreWithJson(text);
  } catch (err) {
    restoreErr.value = err instanceof Error ? err.message : String(err);
  }
}

async function doConfirmRestoreInPlace() {
  await executeRestoreWithJson(restoreRawJson.value);
}

/* ── 第三区状态：版本检测与本地服务同步设置 ── */
interface UpdatePrefsView {
  manifestUrl: string;
  checkOnStartup: boolean;
  autoUpdateSilent: boolean;
}

const initialPrefs: UpdatePrefsView =
  typeof getCardUpdatePreferences === 'function'
    ? {
        manifestUrl: '',
        checkOnStartup: true,
        autoUpdateSilent: false,
        ...getCardUpdatePreferences(),
        autoUpdateSilent: false,
      }
    : {
        manifestUrl: '',
        checkOnStartup: true,
        autoUpdateSilent: false,
      };

const prefs = ref<UpdatePrefsView>(initialPrefs);
const updateCheckBusy = ref(false);
const updateCheckMsg = ref('');
const updateCheckErr = ref('');
const isLocalServerOnline = ref<boolean>(false);
const detectedUpdate = ref<UpdateCheckResult | null>(
  typeof cardUpdateState !== 'undefined' && cardUpdateState
    ? (((cardUpdateState as unknown as Record<string, unknown>).lastCheck ??
        (cardUpdateState as unknown as Record<string, unknown>).lastCheckResult ??
        (cardUpdateState as unknown as Record<string, unknown>).checkResult ??
        null) as UpdateCheckResult | null)
    : null,
);

function syncLocalServerStatusFromResult(res?: UpdateCheckResult | null) {
  const target = res ?? detectedUpdate.value;
  if (target && typeof (target as unknown as Record<string, unknown>).localServerOnline === 'boolean') {
    isLocalServerOnline.value = Boolean((target as unknown as Record<string, unknown>).localServerOnline);
    return;
  }
  if (typeof cardUpdateState !== 'undefined' && cardUpdateState) {
    const st = cardUpdateState as unknown as Record<string, unknown>;
    if (typeof st.localServerOnline === 'boolean') {
      isLocalServerOnline.value = Boolean(st.localServerOnline);
    }
  }
}

async function probeLocalServerOnInit() {
  syncLocalServerStatusFromResult();
  if (typeof cardUpdateEngineModule === 'undefined' || !cardUpdateEngineModule) return;
  const modAny = cardUpdateEngineModule as unknown as Record<string, unknown>;
  const probeFn = modAny.probeLocalServerVersionStatus as
    | (() => Promise<{ ok?: boolean; online?: boolean; local?: { version?: string } } | null>)
    | undefined;
  if (typeof probeFn === 'function') {
    try {
      const probeRes = await probeFn();
      if (probeRes && (probeRes.ok || probeRes.online)) {
        isLocalServerOnline.value = true;
        if (probeRes.local?.version) {
          currentCardVersion.value = probeRes.local.version;
        }
      }
    } catch {
      /* ignore probe failure */
    }
  }
}

void probeLocalServerOnInit();

function persistPrefs(patch: Partial<UpdatePrefsView>) {
  prefs.value = { ...prefs.value, ...patch, autoUpdateSilent: false };
  if (typeof setCardUpdatePreferences === 'function') {
    setCardUpdatePreferences({ ...prefs.value, autoUpdateSilent: false });
  }
}

function onManifestUrlInput(e: Event) {
  const target = e.target as HTMLInputElement | null;
  if (target && typeof target.value === 'string') {
    prefs.value.manifestUrl = target.value;
  }
}

function onSaveUpdatePrefs() {
  persistPrefs({ manifestUrl: prefs.value.manifestUrl });
}

function onToggleCheckOnStartup(e?: Event) {
  const target = e?.target as HTMLInputElement | undefined;
  const nextVal =
    target && typeof target.checked === 'boolean' ? target.checked : !prefs.value.checkOnStartup;
  persistPrefs({ checkOnStartup: nextVal });
}

async function doCheckCardUpdateNow() {
  updateCheckBusy.value = true;
  updateCheckMsg.value = '';
  updateCheckErr.value = '';
  try {
    onSaveUpdatePrefs();
    const modAny =
      typeof cardUpdateEngineModule !== 'undefined' && cardUpdateEngineModule
        ? (cardUpdateEngineModule as unknown as Record<string, unknown>)
        : {};
    const checkLocalOrRemote = modAny.checkCardUpdateViaLocalOrRemote as
      | ((opts?: Record<string, unknown>) => Promise<UpdateCheckResult | null>)
      | undefined;

    let res: UpdateCheckResult | null = null;
    if (typeof checkLocalOrRemote === 'function') {
      res = await checkLocalOrRemote({
        manifestUrl: prefs.value.manifestUrl,
        forcePopupOnNormalUpdate: true,
        triggerAutoUpdateIfSafe: false,
      });
    } else if (typeof checkCardUpdate === 'function') {
      res = await checkCardUpdate({
        manifestUrl: prefs.value.manifestUrl,
        forcePopupOnNormalUpdate: true,
        triggerAutoUpdateIfSafe: false,
      });
    }

    if (res) {
      detectedUpdate.value = res;
      syncLocalServerStatusFromResult(res);
      currentCardVersion.value = res.localVersion || currentCardVersion.value;
      if (res.hasUpdate) {
        updateCheckMsg.value = `${STAR} 检测到新版本 v${res.latestVersion}（当前 v${res.localVersion}）`;
      } else {
        updateCheckMsg.value = `${CHECK} 当前已是最新版本 (v${res.localVersion})`;
      }
    }
  } catch (e) {
    updateCheckErr.value = e instanceof Error ? e.message : String(e);
  } finally {
    updateCheckBusy.value = false;
  }
}

function openUpdateWizard() {
  if (typeof cardUpdateState !== 'undefined' && cardUpdateState) {
    const st = cardUpdateState as unknown as Record<string, unknown>;
    st.shouldPromptModal = true;
    st.modalOpen = true;
  }
}

async function doBackupAndNotifyLocalServer() {
  if (typeof executeOneClickBackup !== 'function') return;
  updateCheckBusy.value = true;
  updateCheckMsg.value = '';
  updateCheckErr.value = '';
  try {
    const backupRes = await executeOneClickBackup({
      downloadFile: true,
      copyToClipboard: true,
      cloneWorldbooks: true,
      versionTag: detectedUpdate.value?.localVersion || currentCardVersion.value,
    });
    if (!backupRes || !backupRes.ok) {
      updateCheckErr.value = backupRes?.error || '战局备份未完成，已中止通知本地服务更新';
      return;
    }
    const modAny =
      typeof cardUpdateEngineModule !== 'undefined' && cardUpdateEngineModule
        ? (cardUpdateEngineModule as unknown as Record<string, unknown>)
        : {};
    const triggerFn = modAny.triggerLocalServerUpdate as
      | ((opts?: { confirmBackupCompleted?: boolean }) => Promise<{
          ok?: boolean;
          currentVersion?: string;
          message?: string;
          error?: string;
        }>)
      | undefined;
    if (typeof triggerFn === 'function') {
      const updRes = await triggerFn({ confirmBackupCompleted: true });
      if (updRes && updRes.ok) {
        isLocalServerOnline.value = true;
        updateCheckMsg.value = `${CHECK} 已完成战局备份并由本地服务完成拉取与重编译（v${
          updRes.currentVersion || detectedUpdate.value?.latestVersion || currentCardVersion.value
        }）`;
        return;
      }
      updateCheckErr.value =
        updRes?.error ||
        updRes?.message ||
        '本地启动服务未响应，可在电脑端双击运行项目根目录下的【一键更新.bat】完成更新';
      return;
    }
    openUpdateWizard();
  } catch (e) {
    updateCheckErr.value = e instanceof Error ? e.message : String(e);
  } finally {
    updateCheckBusy.value = false;
  }
}
</script>

<style scoped>
.ra-expsave .sysbtn {
  font-size: 12px;
  letter-spacing: 0.04em;
  padding: 4px 12px;
  border: 1px solid var(--rac-dim);
  border-radius: 2px;
  background: var(--rac-panel-2);
  color: var(--rac-text);
  cursor: pointer;
}
.ra-expsave .sysbtn:hover:not(:disabled) {
  border-color: var(--rac-line);
  color: var(--rac-hi);
}
.ra-expsave .sysbtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ra-expsave .sysbtn--highlight {
  border-color: var(--rac-accent);
  color: var(--rac-hi);
}
.ra-expsave .sysbtn--highlight:hover:not(:disabled) {
  border-color: var(--warn);
}
.ra-expsave .systa {
  width: 100%;
  background: var(--rac-bg);
  border: 1px solid var(--rac-dim);
  border-radius: 2px;
  color: var(--rac-text);
  font-size: 12px;
  font-family: inherit;
  padding: 6px 8px;
  resize: vertical;
}
.ra-expsave .systa:focus {
  outline: none;
  border-color: var(--warn);
}
.ra-expsave .sysinput {
  width: 100%;
  background: var(--rac-bg);
  border: 1px solid var(--rac-dim);
  border-radius: 2px;
  color: var(--rac-text);
  font-size: 12px;
  font-family: var(--rac-font-num);
  padding: 5px 8px;
}
.ra-expsave .sysinput:focus {
  outline: none;
  border-color: var(--rac-accent);
}
</style>
