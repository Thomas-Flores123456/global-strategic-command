<template>
  <!-- ── 内容体检 · Integrity（自 PanelSystem 迁入中控台设置弹窗；逻辑复用 systemCheck.ts 纯函数） ── -->
  <section class="ra-integrity card px-3 py-2.5">
    <div class="flex items-center justify-between">
      <span class="micro flex items-center gap-1.5">
        <Icon name="flask" :size="11" />
        内容体检 · Integrity
      </span>
      <button class="sysbtn sysbtn--go" :disabled="running" @click="runCheck">
        {{ running ? '体检中…' : ran ? '重新体检' : '开始体检' }}
      </button>
    </div>

    <template v-if="ran">
      <!-- 汇总 -->
      <div class="mt-2 flex items-center gap-3">
        <span class="num" :style="{ color: counts.error ? 'var(--danger)' : 'var(--t-faint)', fontSize: '11px' }"
          >错误 {{ counts.error }}</span
        >
        <span class="num" :style="{ color: counts.warn ? 'var(--warn)' : 'var(--t-faint)', fontSize: '11px' }"
          >警告 {{ counts.warn }}</span
        >
        <span class="num" style="color: var(--t-faint); font-size: 11px">提示 {{ counts.info }}</span>
        <span v-if="!counts.error && !counts.warn" class="num" style="color: var(--ok); font-size: 11px"
          >◆ 无阻断问题</span
        >
      </div>
      <!-- 分维度 -->
      <div v-for="dim in dims" :key="dim.label" class="mt-2 border-t pt-1.5" style="border-color: var(--line)">
        <div class="flex items-center justify-between">
          <span style="color: var(--t-hi); font-size: 12px; letter-spacing: 0.04em">{{ dim.label }}</span>
          <span class="num" style="color: var(--t-faint); font-size: 11px">{{ dim.sub }}</span>
        </div>
        <div v-if="!dim.issues.length" class="mt-1" style="color: var(--ok); font-size: 12px">通过 · 无问题</div>
        <div v-for="(issue, i) in dim.issues" :key="i" class="mt-1 flex items-start gap-1.5">
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
      </div>
    </template>
    <div v-else class="mt-2" style="color: var(--t-faint); font-size: 12px">
      自动检查：世界书格式与常驻预算 · 图鉴与世界书同步状态 · 扩展包注册记录
    </div>

    <!-- ── 宿主环境与平台接口状态（PKG-D） ── -->
    <div
      class="mt-2.5 border-t pt-2"
      style="border-color: var(--line)"
      data-test="tt-host-diagnostics"
    >
      <div class="flex items-center justify-between gap-2">
        <span style="color: var(--t-hi); font-size: 12px; letter-spacing: 0.04em">
          宿主环境与平台接口状态
        </span>
        <span
          class="num"
          :style="{
            color: hostDiag.isTauriTavern ? 'var(--ok)' : 'var(--t-low)',
            fontSize: '11px',
          }"
        >
          {{
            hostDiag.isTauriTavern
              ? `TauriTavern 客户端 (ABI v${hostDiag.abiVersion ?? 1})`
              : '传统 SillyTavern 宿主'
          }}
        </span>
      </div>
      <div class="mt-1.5 flex flex-wrap gap-1.5">
        <span
          v-for="item in hostCapabilities"
          :key="item.label"
          class="num"
          :style="{
            color: item.ready ? 'var(--ok)' : 'var(--t-faint)',
            border: `1px solid ${item.ready ? 'var(--ok)' : 'var(--line)'}`,
            borderRadius: '3px',
            padding: '1px 5px',
            fontSize: '11px',
          }"
        >
          {{ item.label }} · {{ item.ready ? '已支持' : '兼容模式' }}
        </span>
      </div>
      <div
        v-if="hostDiag.isTauriTavern"
        class="mt-1 num"
        style="color: var(--t-faint); font-size: 11px"
      >
        安全视口：{{ hostDiag.safeFrameSummary }}
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import { RESEARCHES } from '../../红警指挥系统/core/catalog'; // base 层对照（体检需对比 base vs overlay，属合法特例）
import { checkPromotedBooks } from '../../红警指挥系统/engines/promotionAudit';
import { useDataStore } from '../../红警指挥系统/composables/store';
import { dynamicCatalogSnapshot, useCatalogStore } from '../../红警指挥系统/composables/useCatalog';
import {
  checkArchiveSync,
  checkLedger,
  checkVariables,
  checkWorldbooks,
  type CheckIssue,
} from '../../红警指挥系统/parse/systemCheck';
import { diagnoseTauriTavernHost } from '../host/ttHostBridge';

const store = useDataStore();
const catalog = useCatalogStore();

const running = ref(false);
const ran = ref(false);
const varIssues = ref<CheckIssue[]>([]);
const wbIssues = ref<CheckIssue[]>([]);
const wbScanned = ref<string[]>([]);
const ledgerIssues = ref<CheckIssue[]>([]);
const hostDiag = ref(diagnoseTauriTavernHost());

const hostCapabilities = computed(() => [
  { label: 'ChatSurface 虚拟列表托管', ready: hostDiag.value.chatSurfaceManaged },
  { label: 'Layout 安全区视口', ready: hostDiag.value.hasLayoutApi },
  { label: 'ExtensionStore 本地存储', ready: hostDiag.value.hasExtensionStoreApi },
  { label: 'WorldInfo 激活接口', ready: hostDiag.value.hasWorldInfoApi },
  { label: 'Agent 参谋运行时', ready: hostDiag.value.hasAgentApi },
  { label: 'Skill 技能包接口', ready: hostDiag.value.hasSkillApi },
]);

/** 三维体检：变量（同步）＋世界书/对账（async，需酒馆 API；非酒馆环境经 systemCheck.tav() 探测自动降级为"不可用/未扫描"） */
async function runCheck() {
  running.value = true;
  try {
    hostDiag.value = diagnoseTauriTavernHost();
    const baseResearches =
      RESEARCHES.length > 0
        ? RESEARCHES
        : (catalog.dynamicCatalog?.researches ?? dynamicCatalogSnapshot()?.researches ?? catalog.researches);
    varIssues.value = checkVariables({
      codex: store.data.codex,
      techDone: store.data.tech.done,
      overlays: catalog.overlays,
      baseResearches,
      mergedResearchNames: catalog.researches.map(r => r.name),
      bases: store.data.bases,
    });
    const wb = await checkWorldbooks();
    wbIssues.value = wb.issues;
    wbScanned.value = wb.scanned;
    ledgerIssues.value = [
      ...(await checkLedger(
        catalog.overlays,
        catalog.factionDefs.map(d => d.faction),
      )),
      ...(await checkArchiveSync(store.data.codex)), // R14 未归档 / R15 回溯孤儿
      ...(await checkPromotedBooks()), // R24 空壳书 / R25 $promoted 悬挂（只读）
    ];
    ran.value = true;
  } finally {
    running.value = false;
  }
}

const counts = computed(() => {
  const all = [...varIssues.value, ...wbIssues.value, ...ledgerIssues.value];
  return {
    error: all.filter(i => i.level === 'error').length,
    warn: all.filter(i => i.level === 'warn').length,
    info: all.filter(i => i.level === 'info').length,
  };
});

const dims = computed(() => [
  {
    label: '变量',
    sub: `codex ${store.data.codex.length} 条 · 已研 ${store.data.tech.done.length} · 包 ${catalog.overlays.length}`,
    issues: varIssues.value,
  },
  {
    label: '世界书',
    sub: wbScanned.value.length ? `扫描 ${wbScanned.value.length} 本` : '不可用/未扫描',
    issues: wbIssues.value,
  },
  { label: '对账', sub: `注册表 ${catalog.overlays.length} 包`, issues: ledgerIssues.value },
]);

function lvColor(level: string) {
  return level === 'error' ? 'var(--danger)' : level === 'warn' ? 'var(--warn)' : 'var(--t-faint)';
}
</script>

<style scoped>
.ra-integrity .sysbtn {
  font-size: 12px;
  letter-spacing: 0.04em;
  padding: 4px 12px;
  border: 1px solid var(--line);
  border-radius: 3px;
  color: var(--t-low);
}
.ra-integrity .sysbtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ra-integrity .sysbtn--go {
  color: var(--warn);
  border-color: var(--warn);
}
.ra-integrity .sysbtn--go:disabled {
  opacity: 0.6;
}
</style>
