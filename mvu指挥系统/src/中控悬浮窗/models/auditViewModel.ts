/**
 * auditViewModel.ts —— 报告流水「对账」过滤视角视图模型（CTRL-UI-AUDIT-01 · 卡面②）
 *
 * 真源与纪律：
 * - 四态语义只读参照 productionReconciliation.ts L11-18 三色裁决冻结表
 *   （MATCH 吻合入役 / UNDERRUN 按实认领 / OVERRUN 拦截挂起 / NOOP 幂等出口）；色标对齐 §4 三色语义；
 * - 对账事件以 ParseEvent 形态在报告流水中流动（reconcileEventToParseEvent：message 前缀「[对账] 」、
 *   path 'queues'），本模块只做过滤与结构化呈现，引擎零改动；
 * - 标签口径镜像 productionReconciliation EVENT_LABELS（只读参照）：引擎标签文本若改动，解析 fail-soft
 *   回退 null——事件仍留在「全部流水」视角，不丢信息（登记项随收工报告同步）；
 * - declaration_rejected / force_commission 非对账四态（门内安全出口 / 驾驶员逃生舱），本视角不收录；
 * - 🔴 纯函数：零 IO / 零 DOM / 零 vue·pinia / 零酒馆 API；不原地修改入参。
 */
import type { ParseEvent } from '../../红警指挥系统/parse/parsePipeline';

/** 对账四态（productionReconciliation GateVerdict 的呈现子集；REJECTED/force_commission 不收录） */
export type ReconcileVerdict = 'MATCH' | 'UNDERRUN' | 'OVERRUN' | 'NOOP';
export const RECONCILE_VERDICTS: readonly ReconcileVerdict[] = ['MATCH', 'UNDERRUN', 'OVERRUN', 'NOOP'];

/** 四态色标（对齐三色门语义：MATCH=ok、UNDERRUN=warn、OVERRUN=danger；NOOP=中性安全出口） */
export const RECONCILE_VERDICT_COLOR: Readonly<Record<ReconcileVerdict, string>> = {
  MATCH: 'var(--ok)',
  UNDERRUN: 'var(--warn)',
  OVERRUN: 'var(--danger)',
  NOOP: 'var(--t-faint)',
};

/** 对账视角文案集（对齐 dispatchOrderText.DISPATCH_ORDER_COPY 前端就地集中管理先例，组件零自建文案） */
export const AUDIT_VIEW_COPY = {
  /** 「全部流水」chip 标签（退出对账视角，回到既有呈现） */
  allLabel: '全部流水',
  allHint: '显示全部解析报告（既有呈现）',
  /** 对账视角空态 */
  empty: '该对账态暂无命中报告',
  /** 四态语义提示（chip title，逐义压缩自裁决冻结表 L11-18） */
  verdictHint: {
    MATCH: '声明数与在册吻合：settling→done，资产入账',
    UNDERRUN: '按实认领部分入役，余量退回/留在 active',
    OVERRUN: '超产/时序冲突拦截：事务原地不动（挂起留痕）',
    NOOP: '仅命中 done：幂等跳过，不重复入账',
  } as Readonly<Record<ReconcileVerdict, string>>,
} as const;

/** 一条对账事件的结构化行（verdict 色标 + 项目 + 差异明细） */
export interface ReconcileRow {
  verdict: ReconcileVerdict;
  item: string;
  detail: string;
}

// 报文形态锚点：reconcileEventToParseEvent → `[对账] <标签>「<item>」[：<detail>]`
// 三色标签自带英文态名前缀；NOOP 标签为「对账幂等跳过」（无 NOOP 字样，单列匹配）
const TRI_STATE_RE = /^\[对账\] (MATCH|UNDERRUN|OVERRUN) [^「]*「([^」]+)」(?:：([\s\S]*))?$/;
const NOOP_RE = /^\[对账\] 对账幂等跳过「([^」]+)」(?:：([\s\S]*))?$/;

/**
 * 单事件 → 对账结构化行（纯函数）。
 * 非对账事件 / 非四态对账事件（declaration_rejected、force_commission）/ 标签漂移 → null（fail-soft）。
 */
export function reconcileRowOf(event: ParseEvent): ReconcileRow | null {
  if (typeof event.message !== 'string') return null;
  const tri = TRI_STATE_RE.exec(event.message);
  if (tri) return { verdict: tri[1] as ReconcileVerdict, item: tri[2], detail: tri[3] ?? '' };
  const noop = NOOP_RE.exec(event.message);
  if (noop) return { verdict: 'NOOP', item: noop[1], detail: noop[2] ?? '' };
  return null;
}

/** 报告事件序 → 全部四态对账行（保持原顺序） */
export function reconcileRowsOf(events: readonly ParseEvent[]): ReconcileRow[] {
  const out: ReconcileRow[] = [];
  for (const e of events) {
    const row = reconcileRowOf(e);
    if (row) out.push(row);
  }
  return out;
}

/** 一份命中报告 + 其目标态对账行 */
export interface ReconcileReportView<R> {
  report: R;
  rows: ReconcileRow[];
}

/**
 * 四态过滤视角（纯函数）：仅保留含目标态对账事件的报告，且每份报告只呈现目标态行。
 * 入参零突变（rows 为新数组，report 原样引用）。
 */
export function reconcileReportViews<R extends { events: readonly ParseEvent[] }>(
  reports: readonly R[],
  verdict: ReconcileVerdict,
): ReconcileReportView<R>[] {
  const out: ReconcileReportView<R>[] = [];
  for (const report of reports) {
    const rows = reconcileRowsOf(report.events).filter(r => r.verdict === verdict);
    if (rows.length) out.push({ report, rows });
  }
  return out;
}

/** 各态命中报告计数（chip 角标；同报告同态多行只计 1） */
export function reconcileVerdictCounts<R extends { events: readonly ParseEvent[] }>(
  reports: readonly R[],
): Record<ReconcileVerdict, number> {
  const counts: Record<ReconcileVerdict, number> = { MATCH: 0, UNDERRUN: 0, OVERRUN: 0, NOOP: 0 };
  for (const report of reports) {
    const hit = new Set<ReconcileVerdict>();
    for (const row of reconcileRowsOf(report.events)) hit.add(row.verdict);
    for (const v of hit) counts[v]++;
  }
  return counts;
}
