/**
 * CTRL-UI-AUDIT-01 · 卡面②（报告流水「对账」过滤视角视图模型）测试
 *
 * 钉住四点：
 * ① 四态覆盖：MATCH/UNDERRUN/OVERRUN/NOOP 全部经引擎真出口 reconcileEventToParseEvent 产文后解析回
 *    结构化行（verdict/item/detail）——标签口径与引擎同源，不手写镜像字符串；
 * ② 非四态对账事件（declaration_rejected / force_commission）与非对账事件 → null（fail-soft）；
 * ③ reconcileReportViews 过滤语义 + reconcileVerdictCounts 角标计数（同报告同态多行只计 1）；
 * ④ PanelParseRepair.vue 呈现契约：chip 行 / 色标 / 结构化字段渲染挂载。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';
import type { ParseEvent } from '../../红警指挥系统/parse/parsePipeline';
import { reconcileEventToParseEvent, type ReconcileEvent } from '../../红警指挥系统/engines/productionReconciliation';
import {
  AUDIT_VIEW_COPY,
  RECONCILE_VERDICT_COLOR,
  RECONCILE_VERDICTS,
  reconcileReportViews,
  reconcileRowOf,
  reconcileRowsOf,
  reconcileVerdictCounts,
} from '../models/auditViewModel';

/* ═══════════════ 工具：经引擎真出口产对账事件（标签同源，零手写镜像） ═══════════════ */

function evOf(type: ReconcileEvent['type'], level: 'info' | 'warn', detail?: string): ParseEvent {
  return reconcileEventToParseEvent({ type, level, item: '矿车', base: '北坡主基地', detail });
}

const PLAIN_EVENT: ParseEvent = { light: '🟢', layer: 'L1', message: '普通解析事件', path: 'bases' };

/* ═══════════════ ① 四态覆盖 ═══════════════ */

describe('reconcileRowOf · 对账四态结构化解析（事件经引擎真出口产文）', () => {
  it('MATCH：吻合入役', () => {
    const row = reconcileRowOf(evOf('reconcile_match', 'info', '声明 2 台吻合，settling→done 入役'));
    expect(row).toEqual({ verdict: 'MATCH', item: '矿车', detail: '声明 2 台吻合，settling→done 入役' });
  });

  it('UNDERRUN：按实认领', () => {
    const row = reconcileRowOf(evOf('reconcile_underrun', 'info', '声明 1 台按实认领，余量退回 active'));
    expect(row).toEqual({ verdict: 'UNDERRUN', item: '矿车', detail: '声明 1 台按实认领，余量退回 active' });
  });

  it('OVERRUN：拦截挂起（warn 灯不影响四态判定）', () => {
    const row = reconcileRowOf(evOf('reconcile_overrun', 'warn', '声明 3 台超产拦截，事务原地不动'));
    expect(row).toEqual({ verdict: 'OVERRUN', item: '矿车', detail: '声明 3 台超产拦截，事务原地不动' });
  });

  it('NOOP：幂等跳过（标签无 NOOP 字样，单列匹配口径）', () => {
    const row = reconcileRowOf(evOf('reconcile_noop', 'info', '仅命中 done，重复声明不重复入账'));
    expect(row).toEqual({ verdict: 'NOOP', item: '矿车', detail: '仅命中 done，重复声明不重复入账' });
  });

  it('无 detail 的对账事件 → detail 空串', () => {
    expect(reconcileRowOf(evOf('reconcile_match', 'info'))).toEqual({ verdict: 'MATCH', item: '矿车', detail: '' });
  });

  it('四态色标齐备且语义对齐三色门', () => {
    expect(RECONCILE_VERDICTS).toEqual(['MATCH', 'UNDERRUN', 'OVERRUN', 'NOOP']);
    expect(RECONCILE_VERDICT_COLOR.MATCH).toBe('var(--ok)');
    expect(RECONCILE_VERDICT_COLOR.UNDERRUN).toBe('var(--warn)');
    expect(RECONCILE_VERDICT_COLOR.OVERRUN).toBe('var(--danger)');
    expect(RECONCILE_VERDICT_COLOR.NOOP).toBe('var(--t-faint)');
    for (const v of RECONCILE_VERDICTS) expect(typeof AUDIT_VIEW_COPY.verdictHint[v]).toBe('string');
  });
});

/* ═══════════════ ② 非四态 / 非对账 fail-soft ═══════════════ */

describe('reconcileRowOf · 非收录面回退 null', () => {
  it('declaration_rejected / force_commission 非四态 → null', () => {
    expect(reconcileRowOf(evOf('declaration_rejected', 'warn', '在册候选不唯一'))).toBeNull();
    expect(reconcileRowOf(evOf('force_commission', 'warn', '驾驶员强制特批'))).toBeNull();
  });

  it('非对账事件 / 非字符串 message → null', () => {
    expect(reconcileRowOf(PLAIN_EVENT)).toBeNull();
    expect(reconcileRowOf({ light: '🟢', layer: 'instruction', message: '[对账] 标签漂移「x」' })).toBeNull();
    expect(reconcileRowOf({ light: '🟢', layer: 'L0', message: undefined as unknown as string })).toBeNull();
  });
});

/* ═══════════════ ③ 过滤与计数 ═══════════════ */

interface FakeReport {
  message_id: number;
  events: ParseEvent[];
}

function fakeReports(): FakeReport[] {
  return [
    {
      message_id: 9,
      events: [evOf('reconcile_match', 'info', 'd1'), evOf('reconcile_overrun', 'warn', 'd2'), PLAIN_EVENT],
    },
    { message_id: 8, events: [evOf('reconcile_overrun', 'warn', 'd3'), evOf('reconcile_overrun', 'warn', 'd4')] },
    { message_id: 7, events: [PLAIN_EVENT] }, // 无对账事件
    { message_id: 6, events: [evOf('reconcile_noop', 'info', 'd5')] },
  ];
}

describe('reconcileReportViews / reconcileVerdictCounts', () => {
  it('过滤：仅保留含目标态的报告，且只呈现目标态行；入参零突变', () => {
    const reports = fakeReports();
    const views = reconcileReportViews(reports, 'OVERRUN');
    expect(views.map(v => v.report.message_id)).toEqual([9, 8]);
    expect(views[0].rows).toEqual([{ verdict: 'OVERRUN', item: '矿车', detail: 'd2' }]);
    expect(views[1].rows.map(r => r.detail)).toEqual(['d3', 'd4']); // 同态多行皆呈现
    expect(reports[0].events).toHaveLength(3); // 入参未被裁剪
    expect(reconcileReportViews(reports, 'UNDERRUN')).toEqual([]); // 无命中 → 空
    expect(reconcileReportViews(reports, 'NOOP').map(v => v.report.message_id)).toEqual([6]);
  });

  it('计数：同报告同态多行只计 1；无对账事件的报告不计入任何态', () => {
    expect(reconcileVerdictCounts(fakeReports())).toEqual({ MATCH: 1, UNDERRUN: 0, OVERRUN: 2, NOOP: 1 });
  });

  it('reconcileRowsOf 保序收录全部四态行', () => {
    const rows = reconcileRowsOf(fakeReports()[0].events);
    expect(rows.map(r => r.verdict)).toEqual(['MATCH', 'OVERRUN']);
  });
});

/* ═══════════════ ④ 面板呈现契约（SFC 源码面） ═══════════════ */

describe('PanelParseRepair.vue · 对账过滤视角呈现契约', () => {
  const SFC = readFileSync(join(__dirname, '../panels/PanelParseRepair.vue'), 'utf8');

  it('视图模型导入 + 过滤态/视图/切换接线', () => {
    expect(SFC).toMatch(/import\s*\{[^}]*reconcileReportViews[^}]*\}\s*from\s*'(?:\.\.|\.)(?:\/models)?\/auditViewModel'/);
    expect(SFC).toContain('reconcileVerdictCounts');
    expect(SFC).toContain('auditFilter');
    expect(SFC).toContain('auditViews');
    expect(SFC).toContain('toggleAudit');
  });

  it('chip 行 + 四态结构化字段呈现（色标 / 项目 / 明细）', () => {
    expect(SFC).toContain('v-for="chip in auditChips"');
    expect(SFC).toContain('RECONCILE_VERDICT_COLOR[row.verdict]');
    expect(SFC).toContain('{{ row.verdict }}');
    expect(SFC).toContain('{{ row.item }}');
    expect(SFC).toContain('{{ row.detail }}');
    expect(SFC).toContain('AUDIT_VIEW_COPY.empty'); // 空态文案
  });

  it('全部流水视角为默认且既有呈现保留（v-if 互斥两视角）', () => {
    expect(SFC).toContain('v-if="auditFilter === null"');
    expect(SFC).toContain('v-if="auditFilter !== null"');
    expect(SFC).toContain('v-for="(r, i) in parse.reports.slice(0, 10)"'); // 既有流水渲染未动
  });
});
