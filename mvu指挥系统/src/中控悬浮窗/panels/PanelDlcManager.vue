<template>
  <!--
    DLC 管理 · Packages（自 PanelSystem 迁入中控台设置弹窗；CTRL-SETTINGS-MIGRATE-07 压轴末枪）
    已装 DLC 列表 / 补种子 / 卸载确认门 + 万能口导入流水线（选文件/拖拽/粘贴 → 嗅探分流：DLC 包走
    预检确认门 → installDlc；裸 ST 世界书走直接导书队列 → installRawBooks）。逻辑复用 dlcInstaller.ts
    的 installDlc / uninstallDlc / installRawBooks / parseManifest / precheckManifest / readUninstallPlan /
    renderDataCardEntry / replayCodexSeeds / sniffRawWorldbook / bookNameFromFile 与类型 DlcManifest /
    InstallReceipt / UninstallPlan / DlcCodexTransaction、systemCheck.ts 的 lintBookContent / checkEnv /
    CheckIssue、useCatalog.ts 的 useCatalogStore、store.ts 的 useDataStore / in_tavern。
    只搬 UI 壳、不重写安装/卸载/导入逻辑，不改任何底层导出签名。

    ◆ 方案 A 单文件 + page prop 分流（驾驶员裁决 D-CTRL-SETTINGS-NEXT-06 ②）：
      本组件由 page prop（'installed' | 'import'）决定渲染「已装/卸载」子页还是「导入」子页。
      ModalSettings 里两个 slot（#panel-dlc-installed / #panel-dlc-import）各 mount 一次本组件，
      分别传 page="installed" / page="import"。两实例各自持有的 overlays / catalog / store 都来自模块级
      单例（useCatalogStore / useDataStore 均为 pinia 单例，overlays=catalog.overlays 亦为共享响应式），
      故两子页天然一致，安装/卸载事务读写不因组件双实例而割裂。

    ◆ 跨区联动取舍（承 MIGRATE-04/05/06 先例，与楼层 PanelSystem 的差异，本组件刻意不搬两句）：
      楼层 doInstall / doUninstall / doReplaySeeds / doInstallRaw 末尾有 `ran.value = false`
      （作废「内容体检」区旧报告）与 `void refreshBooks()`（B7 安装/卸载/导入改变书单绑定后刷新
      「世界书」总开关列表）。二者属跨区联动：体检态归「内容体检」组独立组件、世界书总开关态归
      「世界书」组独立组件，中控台各组件间不共享该状态，故本组件不含这两句。安装/卸载/导入后由用户
      手动去「世界书」组点「刷新书单」即可，体检旧报告作废责任在体检组。
      ◆ 必须保留 `catalog.init()`（安装/卸载后重读 $dlc 让 overlay 即刻在已装列表生效）——属 DLC 区
      自身状态（本组件的 overlays 就来自 catalog.overlays），非跨区联动，逐字保留。
      其余安装/卸载/导入/预检逻辑逐字同源。
  -->
  <section class="ra-dlc card px-3 py-2.5">
    <!-- ══ DLC 系统暂未开放占位展示（方案 A：冻结「已装/卸载」与「导入」两子页 UI 入口） ══ -->
    <div
      data-test="dlc-coming-soon-placeholder"
      class="flex flex-col items-center justify-center rounded-[2px] border border-[var(--rac-dim)] bg-[var(--rac-bg)] px-4 py-12 text-center"
    >
      <span class="text-[var(--rac-muted)]"><Icon name="book" :size="20" /></span>
      <p class="mt-2.5 text-[13px] font-bold tracking-wide text-[var(--rac-hi)]">
        系统暂未开放，敬请期待
      </p>
      <p class="mt-1 font-mono text-[11px] text-[var(--rac-muted)]">
        {{ page === 'installed' ? '已装扩展包管理功能正在整备中' : '扩展包导入功能正在整备中' }}
      </p>
    </div>

    <!-- ══ 子页①：已装/卸载（底层实现保留，待开放后恢复） ══ -->
    <template v-if="false && page === 'installed'">
      <div class="flex items-center justify-between">
        <span class="micro flex items-center gap-1.5">
          <Icon name="gear" :size="12" />
          已装扩展包管理
        </span>
        <span class="num micro">{{ overlays.length }} 已装</span>
      </div>
      <div v-if="!overlays.length" class="mt-2" style="color: var(--t-faint); font-size: 12px">
        尚未安装 DLC 内容包 · 原生内容运行中
      </div>
      <template v-for="o in overlays" :key="o.id">
        <div
          class="mt-1.5 flex items-center justify-between gap-2 border-b pb-1.5 last:border-b-0"
          style="border-color: var(--line)"
        >
          <span class="flex min-w-0 items-center gap-2">
            <span style="color: var(--t-hi); font-size: 13px">{{ o.faction?.name ?? o.id }}</span>
            <span class="num flex-none" style="color: var(--t-faint); font-size: 11px">{{ o.id }}</span>
          </span>
          <span class="flex flex-none items-center gap-2">
            <span class="num" style="color: var(--t-faint); font-size: 11px">
              研究{{ (o.researches ?? []).length }} · 建筑{{ (o.buildings ?? []).length }} · 生产{{
                (o.productions ?? []).length
              }}
            </span>
            <button
              v-if="seedMissingOf(o).length"
              class="sysbtn"
              style="padding: 2px 8px; color: var(--warn); border-color: var(--warn)"
              :disabled="seedBusy"
              :title="`因回退楼层导致 ${seedMissingOf(o).length} 条扩展图鉴缺失，点击重新补齐`"
              @click="doReplaySeeds(o.id)"
            >
              补齐图鉴 {{ seedMissingOf(o).length }}
            </button>
            <button class="sysbtn" style="padding: 2px 8px" @click="askUninstall(o.id)">卸载</button>
            <span v-if="seedErr" style="color: var(--danger); font-size: 12px">{{ seedErr }}</span>
          </span>
        </div>
        <!-- 卸载确认门 -->
        <div
          v-if="uninstallTarget === o.id"
          class="mt-1.5 rounded-sm border px-2.5 py-2"
          style="border-color: var(--danger)"
        >
          <template v-if="uninstallPlan">
            <div style="color: var(--t-low); font-size: 12px; line-height: 1.6">
              将删除世界书：{{ uninstallPlan.books.join('、') || '（无）' }}<br />
              恢复被覆盖的原条目 {{ uninstallPlan.backupCount }} 条 · 清理扩展图鉴
              {{ uninstallPlan.codexSeeds.length }} 条 · 解除角色卡绑定
            </div>
            <div class="mt-1.5 flex items-center gap-2">
              <button class="sysbtn sysbtn--danger" :disabled="uninstalling" @click="doUninstall(o.id)">
                {{ uninstalling ? '卸载中…' : '确认卸载' }}
              </button>
              <button class="sysbtn" @click="uninstallTarget = null">取消</button>
              <span v-if="uninstallError" style="color: var(--danger); font-size: 12px">{{ uninstallError }}</span>
            </div>
          </template>
          <div v-else style="color: var(--warn); font-size: 12px">
            无法读取已装扩展包记录（仅酒馆内可卸载）
          </div>
        </div>
      </template>
    </template>

    <!-- ══ 子页②：导入（底层实现保留，待开放后恢复） ══ -->
    <template v-if="false && page === 'import'">
      <div class="flex items-center justify-between">
        <span class="micro flex items-center gap-1.5">
          <Icon name="gear" :size="12" />
          导入扩展包或世界书
        </span>
      </div>

      <!-- 导入流水线（万能口）：选文件/拖拽可多选 → 嗅探分流（DLC 包→预检确认门；裸世界书→直接导书队列） -->
      <div class="mt-2">
        <div class="flex items-center gap-2">
          <button class="sysbtn sysbtn--go" @click="fileInput?.click()">选择文件（可多选）…</button>
          <input
            ref="fileInput"
            type="file"
            accept=".json,application/json"
            multiple
            class="hidden"
            @change="onFileChange"
          />
          <span v-if="pickedFileName" class="num" style="color: var(--t-low); font-size: 11px">{{
            pickedFileName
          }}</span>
          <span v-else style="color: var(--t-faint); font-size: 12px"
            >DLC 包与 ST 原生世界书 .json 混选均可，自动识别分流；或拖拽/粘贴到下方</span
          >
        </div>
        <textarea
          v-model="manifestText"
          class="systa mt-1.5"
          rows="5"
          placeholder='拖拽 .json 文件（可多个：DLC 包 / ST 原生世界书）到这里，或粘贴 DLC manifest JSON：{"dlc":{...},"data":{...},"worldbooks":[...]}'
          @dragover.prevent
          @drop.prevent="onDrop"
        />
        <div class="mt-1.5 flex items-center gap-2">
          <button class="sysbtn sysbtn--go" :disabled="!manifestText.trim()" @click="doPrecheck">解析并预检</button>
          <span v-if="parseError" style="color: var(--danger); font-size: 12px">{{ parseError }}</span>
        </div>

        <!-- 裸世界书直接导入队列（第二通道） -->
        <div
          v-if="rawBooks.length || rawReceipt.length"
          class="mt-2 rounded-sm border px-2.5 py-2"
          style="border-color: var(--line)"
        >
          <div class="micro">世界书直接导入</div>
          <div v-for="b in rawBooks" :key="b.name" class="mt-1 flex items-start gap-1.5">
            <span class="min-w-0 flex-1" style="font-size: 12px; line-height: 1.5">
              <span style="color: var(--t-hi)">《{{ b.name }}》</span>
              <span class="num" style="color: var(--t-faint)"> {{ b.entryCount }} 条</span>
              <span v-if="b.issues.length" style="color: var(--warn)">
                · 格式检查发现 {{ b.issues.length }} 项问题：{{ b.issues[0].rule }} {{ b.issues[0].message
                }}{{ b.issues.length > 1 ? ' 等' : '' }}</span
              >
              <span v-else style="color: var(--ok)"> · 格式检查通过</span>
            </span>
            <button
              class="sysbtn flex-none"
              style="padding: 0 6px"
              @click="rawBooks = rawBooks.filter(x => x.name !== b.name)"
            >
              移除
            </button>
          </div>
          <template v-if="rawBooks.length">
            <label
              class="mt-1.5 flex items-center gap-1.5"
              style="color: var(--t-low); font-size: 12px; cursor: pointer"
            >
              <input v-model="rawBind" type="checkbox" />
              导入后自动绑定到当前角色卡（不重复绑定）
            </label>
            <div class="mt-1" style="color: var(--warn); font-size: 12px">同名世界书将被整本覆盖（重拖即更新）</div>
            <div class="mt-1.5 flex items-center gap-2">
              <button
                class="sysbtn sysbtn--danger"
                :disabled="!env.inTavern || rawBusy"
                :title="env.inTavern ? '执行导入（写操作）' : '仅酒馆内可执行；独立预览只展示清单'"
                @click="doInstallRaw"
              >
                {{ rawBusy ? '导入中…' : `确认导入 ${rawBooks.length} 本` }}
              </button>
              <span v-if="!env.inTavern" style="color: var(--t-faint); font-size: 12px">独立预览：止步于清单</span>
            </div>
          </template>
          <div v-if="rawError" class="mt-1.5" style="color: var(--danger); font-size: 12px">
            导入失败：{{ rawError }}
          </div>
          <div v-if="rawReceipt.length" class="mt-1.5" style="color: var(--ok); font-size: 12px">
            ◆ 导入完成：{{ rawReceipt.join('、') }}{{ rawBindDone ? ' · 已绑定角色卡' : '' }} — 建议重新体检
          </div>
        </div>

        <template v-if="parsed && precheckRan">
          <div class="mt-2 flex items-center gap-3">
            <span style="color: var(--t-hi); font-size: 12px">{{ parsed.dlc.name }}</span>
            <span class="num" style="color: var(--t-faint); font-size: 11px"
              >{{ parsed.dlc.id }} · v{{ parsed.dlc.version }} · {{ parsed.dlc.kind }}</span
            >
          </div>
          <div class="mt-1 flex items-center gap-3">
            <span class="num" :style="{ color: preCounts.error ? 'var(--danger)' : 'var(--t-faint)', fontSize: '11px' }"
              >错误 {{ preCounts.error }}</span
            >
            <span class="num" :style="{ color: preCounts.warn ? 'var(--warn)' : 'var(--t-faint)', fontSize: '11px' }"
              >警告 {{ preCounts.warn }}</span
            >
            <span class="num" style="color: var(--t-faint); font-size: 11px">提示 {{ preCounts.info }}</span>
            <span v-if="!preCounts.error" class="num" style="color: var(--ok); font-size: 11px">◆ 预检可行</span>
          </div>
          <div v-for="(issue, i) in precheckIssues" :key="i" class="mt-1 flex items-start gap-1.5">
            <span
              class="num flex-none"
              :style="{
                color: lvColor(issue.level),
                border: `1px solid ${lvColor(issue.level)}`,
                borderRadius: '3px',
                padding: '0 3px',
                fontSize: '11px',
                marginTop: '1px',
              }"
              >{{ issue.rule }}</span
            >
            <span class="min-w-0" style="font-size: 12px; line-height: 1.5">
              <span style="color: var(--t-low)">{{ issue.target }}</span>
              <span style="color: var(--t-faint)"> — {{ issue.message }}</span>
            </span>
          </div>

          <!-- 确认门：动作预览 -->
          <div v-if="!preCounts.error" class="mt-2 rounded-sm border px-2.5 py-2" style="border-color: var(--warn)">
            <div class="micro">安装内容预览</div>
            <div class="mt-1" style="color: var(--t-low); font-size: 12px; line-height: 1.7">
              创建世界书 {{ (parsed.worldbooks ?? []).length }} 本：{{
                (parsed.worldbooks ?? []).map(w => w.name).join('、') || '（无）'
              }}<br />
              绑定至当前角色卡 · 覆盖同名条目 {{ takeoverEntryCount }} 条（自动备份原条目） · 初始图鉴
              {{ (parsed.data?.codex ?? []).length }} 条<br />
              <template v-if="dataCardPreview"
                >生成数据卡 1 条→《{{ dataCardPreview.book }}》（触发词 {{ dataCardPreview.keys }} 个，AI
                可读精确数值）</template
              >
              <template v-else>数据卡：已关闭或无 data 内容</template>
            </div>
            <div class="mt-1.5 flex items-center gap-2">
              <button
                class="sysbtn sysbtn--danger"
                :disabled="!env.inTavern || installing"
                :title="env.inTavern ? '执行安装（写操作）' : '仅酒馆内可执行；独立预览只能预检'"
                @click="doInstall"
              >
                {{ installing ? '安装中…' : '确认执行安装' }}
              </button>
              <span v-if="!env.inTavern" style="color: var(--t-faint); font-size: 12px">独立预览：止步于预检</span>
            </div>
          </div>
          <div v-if="installError" class="mt-1.5" style="color: var(--danger); font-size: 12px">
            安装失败：{{ installError }}
          </div>
          <div v-if="receipt" class="mt-1.5" style="color: var(--ok); font-size: 12px">
            ◆ 安装完成：{{ receipt.books.join('、') || '（无书）' }} · takeover {{ receipt.takeoverCount }} 条 · 种子
            {{ receipt.codexSeeds.length }} 条 — 建议重新体检
          </div>
        </template>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import {
  bookNameFromFile,
  installDlc,
  installRawBooks,
  parseManifest,
  precheckManifest,
  readUninstallPlan,
  renderDataCardEntry,
  replayCodexSeeds,
  sniffRawWorldbook,
  uninstallDlc,
  type DlcCodexTransaction,
  type DlcManifest,
  type InstallReceipt,
  type UninstallPlan,
} from '../../红警指挥系统/worldbook/dlcInstaller';
import { in_tavern, useDataStore } from '../../红警指挥系统/composables/store';
import { checkEnv, lintBookContent, type CheckIssue } from '../../红警指挥系统/parse/systemCheck';
import { useCatalogStore } from '../../红警指挥系统/composables/useCatalog';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';
import { updateFloorVars } from '../host/floorVarWrite';

/**
 * 方案 A 单文件 + page prop 分流：本组件同时承载「已装/卸载」与「导入」两子页，由 page 决定渲染哪段
 * template；ModalSettings 两 slot 各 mount 一次并分别传 page="installed" / page="import"，两实例共享
 * 同一 pinia 单例 store（catalog / data），状态天然一致。
 */
defineProps<{ page: 'installed' | 'import' }>();

const store = useDataStore();
const catalog = useCatalogStore();
const floating = useFloatingStore();
const overlays = computed(() => catalog.overlays);
const env = checkEnv(in_tavern);

function clonePlain<T>(val: T): T {
  if (val === undefined || val === null) return val;
  return JSON.parse(JSON.stringify(val)) as T;
}

/**
 * DLC codex 事务（逐字同源）：安装/卸载对 codex 的读写通过此适配器落到楼层变量 store.data.codex，
 * 底层 installDlc / uninstallDlc 只依赖此接口，不直接触碰 store。
 */
const dlcCodexTransaction: DlcCodexTransaction = {
  read: () => clonePlain(store.data.codex),
  write: async items => {
    const nextCodex = clonePlain(items) as typeof store.data.codex;
    store.data.codex = nextCodex;
    if (floating.floorId !== null) {
      await updateFloorVars(floating.floorId, vars => {
        const sd = (vars.stat_data ?? {}) as Record<string, unknown>;
        return { ...vars, stat_data: { ...sd, codex: clonePlain(nextCodex) } };
      });
      await floating.refresh();
    }
  },
};

function lvColor(level: string) {
  return level === 'error' ? 'var(--danger)' : level === 'warn' ? 'var(--warn)' : 'var(--t-faint)';
}

/* ── 导入流水线（逐字搬自 PanelSystem） ── */
const manifestText = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const pickedFileName = ref('');

/* 裸世界书队列（第二通道） */
const rawBooks = ref<{ name: string; entryCount: number; json: string; issues: CheckIssue[] }[]>([]);
const rawBind = ref(true);
const rawBusy = ref(false);
const rawError = ref('');
const rawReceipt = ref<string[]>([]);
const rawBindDone = ref(false);

/** 多文件读取 → 逐个嗅探分流（万能口主路径，粘贴为备） */
function loadFiles(files: FileList | undefined | null) {
  if (!files?.length) return;
  for (const f of Array.from(files)) {
    const reader = new FileReader();
    reader.onload = () => routeFile(f.name, String(reader.result ?? ''));
    reader.readAsText(f);
  }
}

/** 嗅探分流：裸 ST 世界书 → 直接导书队列（附 lint）；否则作 DLC manifest 走预检通道 */
function routeFile(fileName: string, text: string) {
  const raw = sniffRawWorldbook(text);
  if (raw) {
    const name = bookNameFromFile(fileName);
    const entries = Object.values(raw.entries);
    const issues = entries.flatMap(e =>
      lintBookContent(name, String(e.comment ?? e.uid ?? '?'), String(e.content ?? '')),
    );
    const item = { name, entryCount: entries.length, json: text, issues };
    const i = rawBooks.value.findIndex(b => b.name === name);
    if (i >= 0) rawBooks.value[i] = item;
    else rawBooks.value.push(item);
    rawReceipt.value = [];
    rawError.value = '';
  } else {
    pickedFileName.value = fileName;
    manifestText.value = text;
    doPrecheck();
  }
}
function onFileChange(e: Event) {
  loadFiles((e.target as HTMLInputElement).files);
  (e.target as HTMLInputElement).value = ''; // 允许重选同一批文件
}
function onDrop(e: DragEvent) {
  loadFiles(e.dataTransfer?.files);
}

async function doInstallRaw() {
  if (!rawBooks.value.length) return;
  rawBusy.value = true;
  rawError.value = '';
  try {
    rawReceipt.value = await installRawBooks(
      rawBooks.value.map(b => ({ name: b.name, json: b.json, entryCount: b.entryCount })),
      rawBind.value,
    );
    rawBindDone.value = rawBind.value;
    rawBooks.value = [];
    // 不搬 `ran.value = false`：体检态归「内容体检」组独立组件，本组件不共享（作废旧体检报告的责任在体检组）。
    // 不搬 `void refreshBooks()`：世界书总开关态归「世界书」组独立组件；导入改变书单/绑定后由用户手动去「世界书」组点「刷新书单」。
  } catch (e) {
    rawError.value = e instanceof Error ? e.message : String(e);
  } finally {
    rawBusy.value = false;
  }
}

const parseError = ref('');
const parsed = ref<DlcManifest | null>(null);
const precheckIssues = ref<CheckIssue[]>([]);
const precheckRan = ref(false);
const installing = ref(false);
const installError = ref('');
const receipt = ref<InstallReceipt | null>(null);

function doPrecheck() {
  parseError.value = '';
  parsed.value = null;
  precheckRan.value = false;
  receipt.value = null;
  installError.value = '';
  // 粘贴的是裸世界书（无文件名可取书名）→ 引导走文件通道
  if (sniffRawWorldbook(manifestText.value)) {
    parseError.value = '检测到 ST 原生世界书导出件（非 DLC 包）——请用「选择文件」或拖拽导入，书名将取自文件名';
    return;
  }
  const { manifest, error } = parseManifest(manifestText.value);
  if (error || !manifest) {
    parseError.value = error ?? '未知解析错误';
    return;
  }
  parsed.value = manifest;
  precheckIssues.value = precheckManifest(manifest, catalog.overlays);
  precheckRan.value = true;
}

const preCounts = computed(() => ({
  error: precheckIssues.value.filter(i => i.level === 'error').length,
  warn: precheckIssues.value.filter(i => i.level === 'warn').length,
  info: precheckIssues.value.filter(i => i.level === 'info').length,
}));
const takeoverEntryCount = computed(() =>
  (parsed.value?.patch?.takeover ?? []).reduce((n, t) => n + t.entries.length, 0),
);
/** 数据卡预览（与安装时同一渲染函数，确认门展示） */
const dataCardPreview = computed(() => {
  if (!parsed.value) return null;
  const card = renderDataCardEntry(parsed.value);
  if (!card) return null;
  const book =
    ((parsed.value.worldbooks ?? []).find(wb => wb.name.startsWith('特色科技·')) ?? (parsed.value.worldbooks ?? [])[0])
      ?.name ?? '(无书)';
  return { book, keys: card.keys.length };
});

async function doInstall() {
  if (!parsed.value) return;
  installing.value = true;
  installError.value = '';
  try {
    receipt.value = await installDlc(parsed.value, dlcCodexTransaction, catalog.overlays);
    catalog.init(); // 保留：重读 $dlc → overlay 即刻在已装列表生效（DLC 区自身状态，非跨区联动）
    // 不搬 `ran.value = false`：体检态归「内容体检」组独立组件（作废旧体检报告的责任在体检组）。
    // 不搬 `void refreshBooks()`：世界书总开关态归「世界书」组独立组件；安装建新书并绑卡后由用户手动去「世界书」组点「刷新书单」。
  } catch (e) {
    installError.value = e instanceof Error ? e.message : String(e);
  } finally {
    installing.value = false;
  }
}

/* ── R16 种子重放（删楼回滚后 DLC codex 种子丢失的一键修复）── */
const seedBusy = ref(false);
const seedErr = ref('');
const seedMissingByOverlayId = computed<Map<string, string[]>>(() => {
  const codexNameSet = new Set(store.data.codex.map(c => c.name));
  const map = new Map<string, string[]>();
  for (const o of overlays.value) {
    const seeds = (o as { codexSeeds?: string[] }).codexSeeds ?? [];
    map.set(
      o.id,
      seeds.filter(s => !codexNameSet.has(s)),
    );
  }
  return map;
});
function seedMissingOf(o: (typeof catalog.overlays)[number]): string[] {
  const cached = seedMissingByOverlayId.value.get(o.id);
  if (cached) return cached;
  const seeds = (o as { codexSeeds?: string[] }).codexSeeds ?? [];
  return seeds.filter(s => !store.data.codex.some(c => c.name === s));
}
async function doReplaySeeds(id: string) {
  seedBusy.value = true;
  seedErr.value = '';
  try {
    const replayed = await replayCodexSeeds(
      id,
      store.data.codex.map(c => c.name),
      seeds => {
        for (const s of seeds) {
          if (!store.data.codex.some(c => c.name === s.name))
            store.data.codex.push(s as (typeof store.data.codex)[number]);
        }
      },
    );
    if (replayed.length && floating.floorId !== null) {
      const nextCodex = clonePlain(store.data.codex);
      await updateFloorVars(floating.floorId, vars => {
        const sd = (vars.stat_data ?? {}) as Record<string, unknown>;
        return { ...vars, stat_data: { ...sd, codex: clonePlain(nextCodex) } };
      });
      await floating.refresh();
    }
    if (!replayed.length) seedErr.value = '注册表无可重建的种子数据（早期安装包且非阵营种子）——可卸载重装修复';
    // 不搬 `ran.value = false`：体检态归「内容体检」组独立组件（同上取舍）。
  } catch (e) {
    seedErr.value = e instanceof Error ? e.message : String(e);
  } finally {
    seedBusy.value = false;
  }
}

/* ── 卸载确认门 ── */
const uninstallTarget = ref<string | null>(null);
const uninstallPlan = ref<UninstallPlan | null>(null);
const uninstalling = ref(false);
const uninstallError = ref('');

function askUninstall(id: string) {
  uninstallTarget.value = uninstallTarget.value === id ? null : id;
  uninstallPlan.value = uninstallTarget.value ? readUninstallPlan(id) : null;
  uninstallError.value = '';
}

async function doUninstall(id: string) {
  uninstalling.value = true;
  uninstallError.value = '';
  try {
    await uninstallDlc(id, dlcCodexTransaction);
    uninstallTarget.value = null;
    catalog.init(); // 保留：重读 $dlc → overlay 即刻从已装列表移除（DLC 区自身状态，非跨区联动）
    // 不搬 `ran.value = false`：体检态归「内容体检」组独立组件（同上取舍）。
    // 不搬 `void refreshBooks()`：世界书总开关态归「世界书」组独立组件；卸载删书解绑后由用户手动去「世界书」组点「刷新书单」。
  } catch (e) {
    uninstallError.value = e instanceof Error ? e.message : String(e);
  } finally {
    uninstalling.value = false;
  }
}
</script>

<style scoped>
.ra-dlc .sysbtn {
  font-size: 12px;
  letter-spacing: 0.04em;
  padding: 4px 12px;
  border: 1px solid var(--line);
  border-radius: 3px;
  color: var(--t-low);
}
.ra-dlc .sysbtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ra-dlc .sysbtn--go {
  color: var(--warn);
  border-color: var(--warn);
}
.ra-dlc .sysbtn--go:disabled {
  opacity: 0.6;
}
.ra-dlc .sysbtn--danger {
  color: var(--danger);
  border-color: var(--danger);
}
.ra-dlc .systa {
  width: 100%;
  background: transparent;
  border: 1px solid var(--line);
  border-radius: 3px;
  color: var(--t-low);
  font-size: 12px;
  font-family: inherit;
  padding: 6px 8px;
  resize: vertical;
}
.ra-dlc .systa:focus {
  outline: none;
  border-color: var(--warn);
}
</style>
