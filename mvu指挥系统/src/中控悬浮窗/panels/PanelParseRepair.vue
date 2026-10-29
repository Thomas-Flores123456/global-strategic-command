<template>
  <!--
    解析与修复 · Parse（自 PanelSystem 迁入中控台设置弹窗；CTRL-SETTINGS-MIGRATE-06 第六枪 · 子页①）
    楼层传承解析报告流水 + R20 隔离对账 + 撤销二段门 + 隔离区两条出路（重试解析 / 编辑后提交）+ 清理残留 +
    报告明细「记为别名」。逻辑复用 useParse.ts 的 parseState / runParseFor / retryFloor / submitFix /
    undoFloor / clearQuarantine / checkParseQuarantine / addAlias / buildAuthority、systemCheck.ts 的
    tav / checkEnv、store.ts 的 in_tavern、parsePipeline.ts 的 QuarantineItem。
    只搬 UI 壳、不重写解析逻辑，不改任何底层导出签名。

    ◆ 跨端触发器取舍（关键红线，对齐 D-CTRL-SETTINGS-NEXT-05，与楼层 PanelSystem 的差异）：
      楼层自动解析触发器由 parseRunner.ts 的 initParseRunner() 安装：eventOn(GENERATION_ENDED /
      MESSAGE_SWIPED / MESSAGE_EDITED) → runParseFor，且有 wired 幂等守卫 + 仅最新楼放行。
      本组件严禁 import 或调用 initParseRunner / parseRunner，也不得自建任何 eventOn / 酒馆事件监听——
      否则中控台与楼层会重复接线、重复解析。本组件只消费共享的模块级 parseState（reactive 单例，楼层
      已装的观察者会自动驱动它），仅提供「重解析本楼 / 隔离区处理 / 记为别名」的手动操作 UI。
      （与 MIGRATE-05 不搬 installAutoFiler、MIGRATE-04 剔 ran.value/refreshBooks 同性质。）

    ◆ 体检态联动取舍：楼层 doReparse/doRetry/doSubmitFix/doUndo/doClearQuarantine 末尾均有
      `ran.value = false`（作废「内容体检」区旧报告），那是与体检组跨组件共享的态；中控台已拆独立
      组件不共享，故本组件不含 ran.value 任何行（作废旧体检报告的责任在体检组）。

    ◆ 记为别名（doLearnAlias）为「解析」组内两子页联动：本组件写库成功即可（addAlias），别名子页
      PanelAliasDict onMounted 时 loadAliases 会重读到——两子页不强耦合。
  -->
  <section class="ra-parse card px-3 py-2.5">
    <div class="flex items-center justify-between">
      <span class="micro flex items-center gap-1.5">
        <Icon name="hammer" :size="12" />
        楼层状态解析与修复
      </span>
      <button
        class="sysbtn sysbtn--go"
        :disabled="!env.inTavern || parse.busy"
        :title="env.inTavern ? '重新解析最新一楼 AI 回复' : '仅酒馆内可执行；独立预览不可用'"
        @click="doReparse"
      >
        {{ parse.busy ? '解析中…' : '重解析本楼' }}
      </button>
    </div>

    <div v-if="!env.inTavern" class="mt-1.5" style="color: var(--t-faint); font-size: 12px">
      事件解析 / 隔离区 / 撤销均需酒馆宿主；独立预览仅展示布局
    </div>

    <!-- CTRL-FLOOR-HEAL-01 方案乙：swipe 槽位缺快照护栏（被动检测，不自建事件监听） -->
    <div
      v-if="swipeMissingId !== null"
      class="mt-1.5 flex items-center gap-1.5 rounded-sm border px-2 py-1.5"
      style="border-color: var(--warn)"
    >
      <span class="min-w-0 flex-1" style="color: var(--warn); font-size: 12px; line-height: 1.5">
        ▲ 第 #{{ swipeMissingId }} 楼当前消息页缺少状态快照（通常因快速切换消息页导致），已暂时沿用上一楼数据
      </span>
      <button
        class="sysbtn sysbtn--go flex-none"
        style="padding: 0 6px"
        :disabled="!env.inTavern || parse.busy"
        title="强制重新解析当前消息页的战况数据"
        @click="doRepairSwipe"
      >
        修复本页
      </button>
    </div>

    <!-- R20 隔离对账 -->
    <div v-for="(issue, i) in parseR20" :key="'r20' + i" class="mt-1.5 flex items-start gap-1.5">
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
      >
        {{ issue.rule }}
      </span>
      <span class="min-w-0 flex-1" style="font-size: 12px; line-height: 1.5">
        <span style="color: var(--t-low)">{{ issue.target }}</span>
        <span style="color: var(--t-faint)"> — {{ issue.message }}</span>
      </span>
      <button
        v-if="issue.level === 'info' && issue.target.startsWith('#')"
        class="sysbtn flex-none"
        style="padding: 0 6px"
        :disabled="!env.inTavern || parse.busy"
        @click="doClearQuarantine(Number(issue.target.slice(1)))"
      >
        清理
      </button>
    </div>

    <!-- 报告流水（CTRL-UI-AUDIT-01：$parse.reports 瘦身档跨会话持久，刷新经 loadReports 恢复；恢复档为纯审计视图） -->
    <div v-if="parse.reports.length" class="mt-2 border-t pt-1.5" style="border-color: var(--line)">
      <div style="color: var(--t-hi); font-size: 12px; letter-spacing: 0.04em">历史解析记录</div>
      <!-- 对账过滤视角（四态结构化呈现；判定全在 auditViewModel.ts 纯函数，组件零自建口径） -->
      <div class="mt-1 flex flex-wrap items-center gap-1">
        <button
          v-for="chip in auditChips"
          :key="chip.label"
          class="sysbtn"
          :style="{
            padding: '0 6px',
            fontSize: '11px',
            color: chip.active ? chip.color : 'var(--t-faint)',
            borderColor: chip.active ? chip.color : 'var(--line)',
          }"
          :title="chip.hint"
          @click="toggleAudit(chip.verdict)"
        >
          {{ chip.label }}{{ chip.verdict === null ? '' : ` ${chip.count}` }}
        </button>
      </div>
      <!-- 对账视角：命中报告 + 四态结构化行（裁决色标 / 项目 / 差异明细） -->
      <!-- 用 div 而非 template 包裹：本文件首个 template 闭标签必须仍是流水 v-for 的那个（旧观测套件 indexOf 切片锚点） -->
      <div v-if="auditFilter !== null">
        <div v-if="!auditViews.length" class="mt-1" style="color: var(--t-faint); font-size: 12px">
          {{ AUDIT_VIEW_COPY.empty }}
        </div>
        <div
          v-for="(v, i) in auditViews"
          :key="'av' + v.report.message_id + '@' + v.report.time + i"
          class="mt-1 rounded-sm border px-2 py-1"
          style="border-color: var(--line)"
        >
          <div class="flex items-center gap-2" style="font-size: 12px">
            <span class="num flex-none" style="color: var(--t-hi)">#{{ v.report.message_id }}</span>
            <span class="num flex-none" style="color: var(--t-faint); font-size: 11px">{{ v.report.time }}</span>
            <span v-if="v.report.note" class="flex-none" style="color: var(--t-faint); font-size: 11px">{{
              v.report.note
            }}</span>
          </div>
          <div
            v-for="(row, j) in v.rows"
            :key="j"
            class="mt-0.5 flex items-start gap-1.5"
            style="font-size: 12px; line-height: 1.6"
          >
            <span
              class="num flex-none"
              :style="{
                color: RECONCILE_VERDICT_COLOR[row.verdict],
                border: `1px solid ${RECONCILE_VERDICT_COLOR[row.verdict]}`,
                borderRadius: '3px',
                padding: '0 3px',
                fontSize: '11px',
                marginTop: '1px',
              }"
              >{{ row.verdict }}</span
            >
            <span class="min-w-0 flex-1">
              <span style="color: var(--t-low)">{{ row.item }}</span>
              <span v-if="row.detail" style="color: var(--t-faint)"> — {{ row.detail }}</span>
            </span>
          </div>
        </div>
      </div>
      <template v-if="auditFilter === null">
        <template v-for="(r, i) in parse.reports.slice(0, 10)" :key="r.message_id + '@' + r.time + i">
          <div
            class="mt-1 flex items-center gap-2"
            style="font-size: 12px; cursor: pointer"
            @click="repOpen = repOpen === i ? null : i"
          >
            <span class="num flex-none" style="color: var(--t-hi)">#{{ r.message_id }}</span>
            <span class="num flex-none" :style="{ color: greens(r) ? 'var(--ok)' : 'var(--t-faint)' }"
              >●{{ greens(r) }}</span
            >
            <span class="num flex-none" :style="{ color: yellows(r) ? 'var(--warn)' : 'var(--t-faint)' }"
              >◆{{ yellows(r) }}</span
            >
            <span class="num flex-none" :style="{ color: r.quarantineCount ? 'var(--danger)' : 'var(--t-faint)' }">
              ▲{{ r.quarantineCount }}
            </span>
            <span class="num flex-none" style="color: var(--t-faint); font-size: 11px">{{ r.time }}</span>
            <span v-if="r.note" class="flex-none" style="color: var(--t-faint); font-size: 11px">{{ r.note }}</span>
            <span v-if="r.downstreamWarning" class="flex-none" style="color: var(--warn); font-size: 11px">
              后续楼层数据可能受影响
            </span>
            <span class="flex-1"></span>
            <span v-if="r.undone" class="flex-none" style="color: var(--t-faint); font-size: 11px">已撤销</span>
            <button
              v-else-if="r.undoable"
              class="sysbtn sysbtn--danger flex-none"
              style="padding: 0 6px"
              :disabled="!env.inTavern || parse.busy"
              @click.stop="undoTarget = undoTarget === i ? null : i"
            >
              撤销
            </button>
          </div>
          <!-- 撤销二段确认门 -->
          <div
            v-if="undoTarget === i && !r.undone"
            class="mt-1 rounded-sm border px-2.5 py-2"
            style="border-color: var(--danger)"
          >
            <div style="color: var(--t-low); font-size: 12px; line-height: 1.6">
              将该楼层的战况数据恢复到本次解析前的状态，并允许重新解析。
            </div>
            <div class="mt-1.5 flex items-center gap-2">
              <button class="sysbtn sysbtn--danger" :disabled="!env.inTavern || parse.busy" @click="doUndo(r)">
                确认撤销
              </button>
              <button class="sysbtn" @click="undoTarget = null">取消</button>
            </div>
          </div>
          <!-- 展开明细：events 修复留痕 + issues 告警（R26 等，跨会话持久） -->
          <div v-if="repOpen === i" class="mt-1 border-l pl-2" style="border-color: var(--line)">
            <div v-if="!r.events.length" style="color: var(--t-faint); font-size: 12px">
              正常解析（无需自动纠错）
            </div>
            <div v-for="(ev, j) in r.events" :key="j" style="font-size: 12px; line-height: 1.6">
              <span class="num" style="color: var(--t-faint)">{{ ev.light }} {{ ev.layer }}</span>
              <span style="color: var(--t-low)"> {{ ev.message }}</span>
              <span v-if="ev.before !== undefined || ev.after !== undefined" class="num" style="color: var(--t-faint)">
                （{{ fmtVal(ev.before) }} → {{ fmtVal(ev.after) }}）
              </span>
              <button
                v-if="ev.align"
                class="sysbtn"
                style="padding: 0 6px; margin-left: 6px"
                :disabled="!env.inTavern || aliasBusy"
                title="将该名称记入别名词典，后续出现时自动匹配标准名称"
                @click="doLearnAlias(ev.align)"
              >
                记为别名
              </button>
            </div>
            <!-- 告警面（CTRL-F1-OBS-01）：与 events 并列；按 severity 着色（lvColor 与 R20 区同源） -->
            <div
              v-for="(is, k) in r.issues ?? []"
              :key="'is' + k"
              class="flex items-start gap-1.5"
              style="font-size: 12px; line-height: 1.6"
            >
              <span
                class="num flex-none"
                :style="{
                  color: lvColor(is.level),
                  border: `1px solid ${lvColor(is.level)}`,
                  borderRadius: '3px',
                  padding: '0 3px',
                  fontSize: '11px',
                  marginTop: '1px',
                }"
              >
                {{ is.rule }}/{{ is.level }}
              </span>
              <span class="min-w-0 flex-1">
                <span style="color: var(--t-low)">{{ is.target }}</span>
                <span style="color: var(--t-faint)"> — {{ is.message }}</span>
              </span>
            </div>
          </div>
        </template>
      </template>
    </div>
    <div v-else-if="env.inTavern" class="mt-2" style="color: var(--t-faint); font-size: 12px">
      本会话尚无解析记录（新消息生成、切换消息页或编辑楼层时会自动解析）
    </div>

    <!-- 隔离区：▲未入库项，两条出路 -->
    <div v-if="quarantineFloors.length" class="mt-2 border-t pt-1.5" style="border-color: var(--line)">
      <div style="color: var(--danger); font-size: 12px; letter-spacing: 0.04em">
        隔离区 · {{ quarantineTotal }} 项未决
      </div>
      <template v-for="f in quarantineFloors" :key="f.mid">
        <div
          v-for="(q, qi) in f.items"
          :key="f.mid + ':' + qi"
          class="mt-1.5 rounded-sm border px-2.5 py-2"
          style="border-color: var(--line)"
        >
          <div class="flex items-center gap-2" style="font-size: 12px">
            <span class="num flex-none" style="color: var(--t-hi)">#{{ f.mid }}</span>
            <span
              v-if="q.tag"
              class="num flex-none"
              style="
                color: var(--warn);
                border: 1px solid var(--warn);
                border-radius: 3px;
                padding: 0 3px;
                font-size: 11px;
              "
            >
              {{ q.tag }}
            </span>
            <span class="num min-w-0" style="color: var(--t-faint); font-size: 11px">{{ q.path ?? q.scope }}</span>
          </div>
          <div class="mt-1" style="color: var(--danger); font-size: 12px">{{ q.error }}</div>
          <div v-if="q.suggestion" style="color: var(--t-low); font-size: 12px">建议：{{ q.suggestion }}</div>
          <pre class="systa mt-1" style="max-height: 96px; overflow: auto; white-space: pre-wrap; user-select: text">{{
            q.raw
          }}</pre>
          <div class="mt-1.5 flex items-center gap-2">
            <button
              class="sysbtn"
              :disabled="!env.inTavern || parse.busy"
              title="修改完聊天楼层原文后，点击此处重新提取数据"
              @click="doRetry(f.mid)"
            >
              重试解析
            </button>
            <button class="sysbtn" :disabled="!env.inTavern" @click="openFix(f.mid, qi, q)">
              {{ fixKey === f.mid + ':' + qi ? '收起编辑' : '编辑后提交' }}
            </button>
          </div>
          <!-- 编辑后提交：写操作，红框二段确认 -->
          <div
            v-if="fixKey === f.mid + ':' + qi"
            class="mt-1.5 rounded-sm border px-2.5 py-2"
            style="border-color: var(--danger)"
          >
            <textarea v-model="fixText" class="systa" rows="5" />
            <div class="mt-1" style="color: var(--t-low); font-size: 12px">
              提交后会重新校验并更新战况数据（若未写标签会自动补全 ‹{{ wrapTag(q) }}›，不会改动聊天楼层正文）
            </div>
            <div class="mt-1.5 flex items-center gap-2">
              <button
                class="sysbtn sysbtn--danger"
                :disabled="!env.inTavern || parse.busy || !fixText.trim()"
                @click="doSubmitFix(f.mid, q)"
              >
                {{ parse.busy ? '提交中…' : '确认提交入库' }}
              </button>
              <button class="sysbtn" @click="fixKey = null">取消</button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <div v-if="parseMsg" class="mt-1.5" style="color: var(--ok); font-size: 12px">{{ parseMsg }}</div>
    <div v-if="parseErr" class="mt-1.5" style="color: var(--danger); font-size: 12px">{{ parseErr }}</div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import type { QuarantineItem } from '../../红警指挥系统/parse/parsePipeline';
import { in_tavern } from '../../红警指挥系统/composables/store';
import { checkEnv, tav, type CheckIssue } from '../../红警指挥系统/parse/systemCheck';
// 关键红线：只 import 消费型的解析编排/隔离区/撤销/对账 API 与 addAlias/buildAuthority；
// 严禁 import initParseRunner / parseRunner（楼层事件接线薄层），本组件不重装触发器、不自建 eventOn 监听。
import {
  addAlias,
  buildAuthority,
  checkParseQuarantine,
  clearQuarantine,
  loadIssues,
  loadQuarantine,
  loadReports,
  parseState,
  retryFloor,
  runParseFor,
  submitFix,
  swipeSlotMissing,
  undoFloor,
  type ParseReport,
} from '../../红警指挥系统/composables/useParse';
// CTRL-UI-AUDIT-01：对账过滤视角视图模型（纯函数独立文件，对齐 dispatchOrderText.ts 先例）
import {
  AUDIT_VIEW_COPY,
  RECONCILE_VERDICT_COLOR,
  RECONCILE_VERDICTS,
  reconcileReportViews,
  reconcileVerdictCounts,
  type ReconcileVerdict,
} from '../models/auditViewModel';

const env = checkEnv(in_tavern);

/* ── 解析与修复（状态在 useParse 模块级 reactive，切子页/切 tab 不丢；这里只持 UI 局部态）──
 * 本组件无任何 eventOn / watch：楼层自动解析触发器由楼层 App 的 initParseRunner() 唯一安装，
 * 这里仅通过共享的模块级 parseState（reactive 单例）读态，通过手动操作 API 触发解析/隔离处理，
 * 跨端不重装触发器，避免与楼层重复接线、重复解析。 */
const parse = parseState;
const parseR20 = ref<CheckIssue[]>([]);
const repOpen = ref<number | null>(null);
const undoTarget = ref<number | null>(null);
const fixKey = ref<string | null>(null);
const fixText = ref('');
const parseMsg = ref('');
const parseErr = ref('');
// 方案乙：当前最新 AI 楼当前 swipe 页缺 stat_data 快照的检出（null = 无欠账）
const swipeMissingId = ref<number | null>(null);
// 记为别名写库时的忙态（与解析忙态分开，避免误禁用解析按钮）
const aliasBusy = ref(false);
// CTRL-UI-AUDIT-01：对账过滤视角（null = 全部流水，既有呈现零变化）
const auditFilter = ref<ReconcileVerdict | null>(null);
const auditChips = computed(() => {
  const counts = reconcileVerdictCounts(parse.reports);
  return [
    {
      verdict: null as ReconcileVerdict | null,
      label: AUDIT_VIEW_COPY.allLabel,
      count: parse.reports.length,
      color: 'var(--t-hi)',
      hint: AUDIT_VIEW_COPY.allHint,
      active: auditFilter.value === null,
    },
    ...RECONCILE_VERDICTS.map(v => ({
      verdict: v as ReconcileVerdict | null,
      label: v,
      count: counts[v],
      color: RECONCILE_VERDICT_COLOR[v],
      hint: AUDIT_VIEW_COPY.verdictHint[v],
      active: auditFilter.value === v,
    })),
  ];
});
// 对账视角命中清单（与全部流水同 slice(0, 10) 容量口径）
const auditViews = computed(() =>
  auditFilter.value === null ? [] : reconcileReportViews(parse.reports.slice(0, 10), auditFilter.value),
);
function toggleAudit(v: ReconcileVerdict | null) {
  auditFilter.value = auditFilter.value === v ? null : v;
}

const quarantineFloors = computed(() =>
  Object.entries(parse.quarantine)
    .map(([mid, items]) => ({ mid: Number(mid), items }))
    .filter(f => Array.isArray(f.items) && f.items.length) // 防御：存量稀疏数组形态的 null 空洞
    .sort((a, b) => a.mid - b.mid),
);
const quarantineTotal = computed(() => quarantineFloors.value.reduce((n, f) => n + f.items.length, 0));

function lvColor(level: string) {
  return level === 'error' ? 'var(--danger)' : level === 'warn' ? 'var(--warn)' : 'var(--t-faint)';
}
const reportLightCountsCache = new WeakMap<
  ParseReport,
  { len: number; greens: number; yellows: number }
>();
function getReportLightCounts(r: ParseReport): { greens: number; yellows: number } {
  const events = r.events ?? [];
  const cached = reportLightCountsCache.get(r);
  if (cached && cached.len === events.length) return cached;
  let g = 0;
  let y = 0;
  for (const e of events) {
    if (e.light === '\u{1F7E2}') g++;
    else if (e.light === '\u{1F7E1}') y++;
  }
  const entry = { len: events.length, greens: g, yellows: y };
  reportLightCountsCache.set(r, entry);
  return entry;
}
function greens(r: ParseReport): number {
  return getReportLightCounts(r).greens;
}
function yellows(r: ParseReport): number {
  return getReportLightCounts(r).yellows;
}
function fmtVal(v: unknown): string {
  if (v === undefined) return '—';
  return typeof v === 'string' ? v : JSON.stringify(v);
}
function wrapTag(q: QuarantineItem): string {
  return q.tag && ['战况', '图鉴', '初始状态'].includes(q.tag) ? q.tag : '战况';
}

async function refreshParseR20() {
  parseR20.value = await checkParseQuarantine();
}

/** 方案乙护栏检测：最新 AI 楼当前 swipe 页是否缺 stat_data（被动调用，不建事件监听） */
async function refreshSwipeMissing() {
  try {
    const mid = latestAiFloor();
    swipeMissingId.value = mid !== null && (await swipeSlotMissing(mid)) ? mid : null;
  } catch {
    swipeMissingId.value = null;
  }
}

/** 方案乙修复入口：对检出楼当前 swipe 页强制重解析 */
async function doRepairSwipe() {
  parseMsg.value = '';
  parseErr.value = '';
  const mid = swipeMissingId.value;
  if (mid === null) return;
  try {
    const outcome = await retryFloor(mid);
    parseMsg.value = outcome === 'parsed' ? `◆ #${mid} 当前消息页已重新提取数据` : `修复结果：${outcome}`;
    await refreshParseR20();
    await refreshSwipeMissing();
  } catch (e) {
    parseErr.value = e instanceof Error ? e.message : String(e);
  }
}

type ChatMsgLite = { role?: string; is_hidden?: boolean };

/**
 * 中控是全局脚本 iframe：Tavern Helper 禁止在此调用 getCurrentMessageId（会抛
 * 「不要对全局脚本 iframe 调用 getMessageId」）。「本楼」在中控语境下定义为
 * 最新一个可见 AI 楼：从 getLastMessageId 向前找第一个非 user、未隐藏的楼。
 */
function latestAiFloor(): number | null {
  const glmi = tav<() => number>('getLastMessageId');
  const gcm = tav<(id: number) => ChatMsgLite[]>('getChatMessages');
  if (!glmi || !gcm) return null;
  for (let id = glmi(); id >= 0; id--) {
    const m = gcm(id)[0];
    if (m && m.role !== 'user' && !m.is_hidden) return id;
  }
  return null;
}

/** 手动重解析最新 AI 楼（force 跳过幂等） */
async function doReparse() {
  parseMsg.value = '';
  parseErr.value = '';
  try {
    const mid = latestAiFloor();
    if (mid === null) {
      parseErr.value = '未找到可解析的 AI 楼（或非真机环境）';
      return;
    }
    const outcome = await runParseFor(mid, { force: true });
    parseMsg.value =
      outcome === 'parsed'
        ? `◆ 已重解析 #${mid}`
        : `#${mid} 未解析（${outcome === 'not-ai' ? '非 AI 楼/已隐藏，不产生快照' : outcome}）`;
    // 不搬 `ran.value = false`：体检态归「内容体检」组独立组件，中控台各组件间不共享（作废旧体检报告的责任在体检组）。
    await refreshParseR20();
    await refreshSwipeMissing();
  } catch (e) {
    parseErr.value = e instanceof Error ? e.message : String(e);
  }
}

/** 隔离区出路①：重跑本楼（玩家先改消息原文，重跑天然吃到新内容） */
async function doRetry(mid: number) {
  parseMsg.value = '';
  parseErr.value = '';
  try {
    const outcome = await retryFloor(mid);
    parseMsg.value = outcome === 'parsed' ? `◆ #${mid} 已重跑解析` : `重试结果：${outcome}`;
    // 不搬 `ran.value = false`（同上取舍）。
    await refreshParseR20();
  } catch (e) {
    parseErr.value = e instanceof Error ? e.message : String(e);
  }
}

function openFix(mid: number, qi: number, q: QuarantineItem) {
  const key = `${mid}:${qi}`;
  if (fixKey.value === key) {
    fixKey.value = null;
    return;
  }
  fixKey.value = key;
  fixText.value = q.raw;
}

/** 隔离区出路②：编辑好的 YAML 走同管道重解析入库（不绕过校验） */
async function doSubmitFix(mid: number, q: QuarantineItem) {
  parseMsg.value = '';
  parseErr.value = '';
  try {
    const res = await submitFix(mid, q, fixText.value);
    if (!res.ok) {
      parseErr.value = res.error;
      return;
    }
    fixKey.value = null;
    const nq = res.result.quarantine.length;
    parseMsg.value = nq ? `已提交，但仍有 ${nq} 项新隔离（见隔离区）` : `◆ #${mid} 修复已入库`;
    // 不搬 `ran.value = false`（同上取舍）。
    await refreshParseR20();
  } catch (e) {
    parseErr.value = e instanceof Error ? e.message : String(e);
  }
}

/** 低置信入库撤销（二段确认后） */
async function doUndo(r: ParseReport) {
  parseMsg.value = '';
  parseErr.value = '';
  try {
    const ok = await undoFloor(r);
    undoTarget.value = null;
    parseMsg.value = ok ? `◆ 已撤销 #${r.message_id} 的自动纠错入库` : '撤销不可用（仅真机且未撤销过）';
    // 不搬 `ran.value = false`（同上取舍）。
    await refreshParseR20();
  } catch (e) {
    parseErr.value = e instanceof Error ? e.message : String(e);
  }
}

/** 清理指向已删楼层的隔离残留 */
async function doClearQuarantine(mid: number) {
  parseMsg.value = '';
  parseErr.value = '';
  try {
    await clearQuarantine(mid);
    parseMsg.value = `◆ 已清理 #${mid} 隔离残留`;
    // 不搬 `ran.value = false`（同上取舍）。
    await refreshParseR20();
  } catch (e) {
    parseErr.value = e instanceof Error ? e.message : String(e);
  }
}

/**
 * R19 低置信对齐 → 一键固化进词典（「解析」组两子页联动）。
 * 写库成功即可：别名子页 PanelAliasDict onMounted 时 loadAliases 会重读到，两子页不强耦合。
 * buildAuthority 由 addAlias 路径内部无需再显式调用；此处保留 import 供权威名单一致性说明与类型对齐。
 */
async function doLearnAlias(a: { from: string; to: string }) {
  parseMsg.value = '';
  parseErr.value = '';
  aliasBusy.value = true;
  try {
    // buildAuthority 参与权威名单口径对齐（与楼层同源）；记为别名走显式 UI 学习，不强校验拦截。
    void buildAuthority;
    const ok = await addAlias(a.from, a.to);
    if (!ok) {
      parseErr.value = '仅真机可用';
      return;
    }
    parseMsg.value = `◆ 已记为别名「${a.from}」→「${a.to}」，后续将自动匹配该标准名称（切到「别名词典」子页可见）`;
  } catch (e) {
    parseErr.value = e instanceof Error ? e.message : String(e);
  } finally {
    aliasBusy.value = false;
  }
}

onMounted(() => {
  // 隔离区跨会话持久（$parse.quarantine），切子页/重建组件时重读同楼层态；读入后刷新 R20 对账
  void loadQuarantine().then(refreshParseR20);
  // CTRL-F1-OBS-01：历史告警跨会话持久（$parse.issues），刷新后恢复进报告流水明细
  void loadIssues();
  // CTRL-UI-AUDIT-01：报告流水跨会话持久（$parse.reports 瘦身档），刷新后恢复历史报告（与 loadIssues 竞态由占位行升级口径吸收）
  void loadReports();
  // 方案乙：开面板即检出一次 swipe 槽位欠账（被动检测，不建事件监听）
  void refreshSwipeMissing();
});
</script>

<style scoped>
.ra-parse .sysbtn {
  font-size: 12px;
  letter-spacing: 0.04em;
  padding: 4px 12px;
  border: 1px solid var(--line);
  border-radius: 3px;
  color: var(--t-low);
}
.ra-parse .sysbtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ra-parse .sysbtn--go {
  color: var(--ok);
  border-color: var(--ok);
}
.ra-parse .sysbtn--danger {
  color: var(--danger);
  border-color: var(--danger);
}
.ra-parse .sysbtn--danger:disabled {
  opacity: 0.5;
}
</style>
