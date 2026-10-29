/**
 * CTRL-UI-AUDIT-01（报告流水跨会话持久化）测试
 *
 * 钉住六点：
 * ① toPersistedReport 瘦身口径：事件 slice(-20) 截最近、字段裁剪（before/after/snippet/align 不落档）、
 *    消息截长 300、note/downstreamWarning 透传；
 * ② persistParse 把报告瘦身档滚入 $parse.reports（真 runParseFor 热路径，mock 体例同 parseIssuesObservability）；
 * ③ 容量自律：$parse.reports 截最近 MAX_PERSISTED_REPORTS=30 条（存量 35 条自愈）；
 * ④ 恢复路径：loadReports 把 $parse.reports 恢复进内存 parseState.reports（undoable=false、
 *    persistedAt=time、issues=[] 待 loadIssues 补挂）；persistedAt 指纹去重；「历史告警」占位行竞态升级；
 * ⑤ normalizePersistedReports 对存量损坏形态自愈（脏项/坏楼号/坏事件丢弃）；
 * ⑥ PanelParseRepair.vue 接线契约：loadReports 导入 + onMounted 挂载。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Schema } from '../core/schema';
import type { CheckIssue } from '../parse/systemCheck';
import {
  loadIssues,
  loadReports,
  MAX_PERSISTED_REPORT_EVENTS,
  MAX_PERSISTED_REPORTS,
  normalizePersistedReports,
  parseState,
  runParseFor,
  toPersistedReport,
  type ParseReport,
  type PersistedReport,
} from '../composables/useParse';
import type { ParseEvent } from '../parse/parsePipeline';

/* ═══════════════ 工具 ═══════════════ */

const R26_ISSUE: CheckIssue = {
  rule: 'R26',
  level: 'warn',
  target: '队列[低可观测技术工学]',
  message: '科技已在账但队列条目仍 active',
};

function mkStat(overrides: Record<string, unknown> = {}) {
  return Schema.parse({
    meta: { world_id: 'cyber2042', date: '2042-03-14', day_count: 1, location: '锈蚀低壑' },
    ...overrides,
  });
}

function mkEvent(i: number, extra: Partial<ParseEvent> = {}): ParseEvent {
  return { light: '🟢', layer: 'instruction', message: `事件${i}`, path: 'queues', ...extra };
}

function mkReport(overrides: Partial<ParseReport> = {}): ParseReport {
  return {
    message_id: 7,
    time: '12:00:00',
    applied: true,
    events: [mkEvent(0)],
    issues: [],
    quarantineCount: 0,
    undoable: false,
    ...overrides,
  };
}

type Globals = Record<string, unknown>;

/** 装全局酒馆 mock（体例逐字仿 parseIssuesObservability.test.ts setupRun） */
function setupRun(opts: { mid: number; baselineStat: unknown; chatVars?: Record<string, unknown> }) {
  const g = globalThis as Globals;
  const saved = { gcm: g.getChatMessages, gv: g.getVariables, uvw: g.updateVariablesWith, st: g.SillyTavern };
  const chatVars: Record<string, unknown> = opts.chatVars ?? {};
  const uvwMock = vi.fn(
    async (
      updater: (v: Record<string, unknown>) => Record<string, unknown>,
      o: { type: string; message_id?: number },
    ) => {
      if (o.type === 'chat') {
        const next = updater(chatVars);
        if (next !== chatVars) {
          for (const k of Object.keys(chatVars)) delete chatVars[k];
          Object.assign(chatVars, next);
        }
        return next;
      }
      return updater({});
    },
  );
  g.getChatMessages = (id: number) => {
    if (id === 0) return [{ role: 'assistant', is_hidden: false, message: '基线楼', swipe_id: 0 }];
    if (id === opts.mid) return [{ role: 'assistant', is_hidden: false, message: '无时间推进标签', swipe_id: 0 }];
    return [];
  };
  g.getVariables = (o: { type: string; message_id?: number }) => {
    if (o.type === 'chat') return chatVars;
    if (o.type === 'message' && o.message_id === 0) return { stat_data: opts.baselineStat };
    return {};
  };
  g.updateVariablesWith = uvwMock;
  delete g.SillyTavern;
  return {
    chatVars,
    restore() {
      g.getChatMessages = saved.gcm;
      g.getVariables = saved.gv;
      g.updateVariablesWith = saved.uvw;
      g.SillyTavern = saved.st;
    },
  };
}

function mockChat($parse: unknown) {
  const g = globalThis as Globals;
  const savedGv = g.getVariables;
  g.getVariables = (o: { type: string }) => (o.type === 'chat' ? { $parse } : {});
  return () => {
    g.getVariables = savedGv;
  };
}

beforeEach(() => {
  parseState.reports.length = 0; // 模块级单例，用例间清零防串扰
});

/* ═══════════════ ① 瘦身口径（纯函数） ═══════════════ */

describe('toPersistedReport · 瘦身口径（容量自律登记项）', () => {
  it('事件 slice(-20) 截最近：对账/结算事件在事件序尾部优先保住', () => {
    const events = Array.from({ length: 25 }, (_, i) => mkEvent(i));
    const p = toPersistedReport(mkReport({ events }), '2026-10-01T00:00:00.000Z');
    expect(p.events).toHaveLength(MAX_PERSISTED_REPORT_EVENTS);
    expect(p.events[0].message).toBe('事件5'); // 最早的 5 条被截掉
    expect(p.events[19].message).toBe('事件24');
  });

  it('字段裁剪：before/after/snippet/align 一律不落档，仅留 light/layer/message/path', () => {
    const p = toPersistedReport(
      mkReport({
        events: [
          mkEvent(0, { before: 1, after: 2, snippet: 's', align: { from: '甲', to: '乙' } }),
          { light: '🟡', layer: 'L1', message: '无 path' },
        ],
        note: '编辑后提交',
        downstreamWarning: true,
        quarantineCount: 3,
      }),
      'T1',
    );
    expect(p.time).toBe('T1');
    expect(p.note).toBe('编辑后提交');
    expect(p.downstreamWarning).toBe(true);
    expect(p.quarantineCount).toBe(3);
    expect(Object.keys(p.events[0]).sort()).toEqual(['layer', 'light', 'message', 'path']);
    expect(Object.keys(p.events[1]).sort()).toEqual(['layer', 'light', 'message']);
    expect(JSON.stringify(p)).not.toContain('甲'); // align 不落档（恢复档无「记为别名」）
  });

  it('单条消息截长 300 字符（防御性）', () => {
    const p = toPersistedReport(mkReport({ events: [mkEvent(0, { message: 'x'.repeat(400) })] }), 'T');
    expect(p.events[0].message).toHaveLength(300);
  });

  it('空 note / 非有限 quarantineCount 归一；undoBaseline 永不落档', () => {
    const p = toPersistedReport(
      mkReport({ note: undefined, quarantineCount: Number.NaN, undoable: true, undoBaseline: { big: 'state' } }),
      'T',
    );
    expect('note' in p).toBe(false);
    expect('downstreamWarning' in p).toBe(false);
    expect(p.quarantineCount).toBe(0);
    expect(JSON.stringify(p)).not.toContain('big');
  });
});

/* ═══════════════ ⑤ 读侧归一自愈 ═══════════════ */

describe('normalizePersistedReports · 存量损坏形态自愈', () => {
  it('非数组输入落空数组；脏项/坏楼号/缺 time 丢弃；事件逐项形状校验', () => {
    expect(normalizePersistedReports(undefined)).toEqual([]);
    expect(normalizePersistedReports('bad')).toEqual([]);
    expect(normalizePersistedReports({})).toEqual([]);
    const out = normalizePersistedReports([
      null,
      'junk',
      { message_id: -1, time: 'T' }, // 负楼号
      { message_id: 1.5, time: 'T' }, // 非整数
      { message_id: 2 }, // 缺 time
      {
        message_id: 3,
        time: 'T3',
        applied: true,
        quarantineCount: 2,
        events: [
          { light: '🟢', layer: 'instruction', message: 'ok', path: 'queues', before: 1 }, // 合法（before 裁掉）
          { light: '🔴', layer: 'instruction', message: 'bad light' }, // 非法灯
          { light: '🟢', layer: 'L9', message: 'bad layer' }, // 非法层
          { light: '🟢', layer: 'L0' }, // 缺 message
          null,
        ],
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ message_id: 3, time: 'T3', applied: true, quarantineCount: 2 });
    expect(out[0].events).toHaveLength(1);
    expect(Object.keys(out[0].events[0]).sort()).toEqual(['layer', 'light', 'message', 'path']);
  });

  it('条数截 MAX_PERSISTED_REPORTS=30', () => {
    const src = Array.from({ length: 40 }, (_, i) => ({ message_id: i, time: `T${i}`, events: [] }));
    expect(normalizePersistedReports(src)).toHaveLength(MAX_PERSISTED_REPORTS);
  });
});

/* ═══════════════ ②③ 热路径落盘 + 容量自律 ═══════════════ */

describe('persistParse · 报告瘦身档滚入 $parse.reports', () => {
  it('解析落盘：$parse.reports[0] 为瘦身档；内存档 persistedAt 与落档 time 同指纹；既有字段形态不动', async () => {
    const s = setupRun({ mid: 5, baselineStat: mkStat() });
    try {
      expect(await runParseFor(5)).toBe('parsed');
      const $parse = s.chatVars.$parse as Record<string, unknown>;
      const reports = $parse.reports as PersistedReport[];
      expect(Array.isArray(reports)).toBe(true);
      expect(reports).toHaveLength(1);
      expect(reports[0].message_id).toBe(5);
      expect(reports[0].applied).toBe(false); // 无 tag 楼 applied=false，照实落档
      expect(typeof reports[0].time).toBe('string');
      expect(reports[0].time).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 时间
      for (const ev of reports[0].events) {
        for (const k of Object.keys(ev)) expect(['light', 'layer', 'message', 'path']).toContain(k);
      }
      // 内存档与落档同指纹（恢复去重锚点）
      const rep = parseState.reports.find(r => r.message_id === 5);
      expect(rep?.persistedAt).toBe(reports[0].time);
      // 既有字段形态逐字不动（回归钉住）
      const done = $parse.done as Record<string, { hash: string; swipe_id: number }>;
      expect(done['5']).toMatchObject({ swipe_id: 0 });
      expect(Array.isArray($parse.log)).toBe(true);
      expect(($parse.log as unknown[]).length).toBe(1);
    } finally {
      s.restore();
    }
  });

  it('容量自律：存量 35 条 + 新入 1 条 → 截最近 30 条，新档在首', async () => {
    const legacy = Array.from({ length: 35 }, (_, i) => ({ message_id: i, time: `L${i}`, events: [] }));
    const s = setupRun({ mid: 6, baselineStat: mkStat(), chatVars: { $parse: { reports: legacy } } });
    try {
      expect(await runParseFor(6)).toBe('parsed');
      const reports = (s.chatVars.$parse as Record<string, unknown>).reports as PersistedReport[];
      expect(reports).toHaveLength(MAX_PERSISTED_REPORTS);
      expect(reports[0].message_id).toBe(6); // 新档在首
      expect(reports[29].time).toBe('L28'); // 最旧的 L29..L34 被截掉
    } finally {
      s.restore();
    }
  });

  it('滚动去重自保：同楼重解析产生新档（时间指纹不同，两条皆留）', async () => {
    const s = setupRun({ mid: 5, baselineStat: mkStat() });
    try {
      expect(await runParseFor(5)).toBe('parsed');
      expect(await runParseFor(5, { force: true })).toBe('parsed');
      const reports = (s.chatVars.$parse as Record<string, unknown>).reports as PersistedReport[];
      expect(reports).toHaveLength(2);
      expect(reports[0].time >= reports[1].time).toBe(true); // 新的在前
    } finally {
      s.restore();
    }
  });
});

/* ═══════════════ ④ 恢复路径（$parse.reports → 内存 reports） ═══════════════ */

describe('loadReports · 刷新后历史报告恢复', () => {
  const SAVED: PersistedReport[] = [
    {
      message_id: 41,
      time: '2026-09-30T10:00:00.000Z',
      applied: true,
      events: [{ light: '🟢', layer: 'instruction', message: '[对账] MATCH 吻合入役「矿车」', path: 'queues' }],
      quarantineCount: 1,
      note: '编辑旧楼重解析',
    },
    {
      message_id: 42,
      time: '2026-09-30T11:00:00.000Z',
      applied: false,
      events: [],
      quarantineCount: 0,
    },
  ];

  it('恢复档入账：undoable=false / issues=[] / persistedAt=time；按楼号倒序', async () => {
    const restore = mockChat({ reports: SAVED });
    try {
      await loadReports();
      expect(parseState.reports).toHaveLength(2);
      expect(parseState.reports.map(r => r.message_id)).toEqual([42, 41]); // 楼号倒序
      const r41 = parseState.reports.find(r => r.message_id === 41)!;
      expect(r41.undoable).toBe(false);
      expect(r41.issues).toEqual([]);
      expect(r41.persistedAt).toBe('2026-09-30T10:00:00.000Z');
      expect(r41.events).toHaveLength(1); // 对账事件随档恢复（过滤视角数据源）
      expect(r41.note).toBe('编辑旧楼重解析');
      expect(r41.quarantineCount).toBe(1);
    } finally {
      restore();
    }
  });

  it('persistedAt 指纹去重：会话内已持同指纹档不重复入账，异指纹旧档仍恢复', async () => {
    parseState.reports.push(mkReport({ message_id: 41, persistedAt: '2026-09-30T10:00:00.000Z' }));
    const restore = mockChat({ reports: SAVED });
    try {
      await loadReports();
      const r41 = parseState.reports.filter(r => r.message_id === 41);
      expect(r41).toHaveLength(1); // 会话态不覆盖、不重复
      expect(parseState.reports.filter(r => r.message_id === 42)).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('竞态升级：loadIssues 先到的「历史告警」占位行原地换恢复档，issues 保留、不重复加行', async () => {
    const restore = mockChat({ reports: SAVED, issues: { '41': [{ ...R26_ISSUE }] } });
    try {
      await loadIssues(); // 先到：建占位行
      expect(parseState.reports.find(r => r.message_id === 41)?.note).toBe('历史告警（$parse 恢复）');
      await loadReports(); // 后到：原地升级
      const r41 = parseState.reports.filter(r => r.message_id === 41);
      expect(r41).toHaveLength(1);
      expect(r41[0].events).toHaveLength(1); // 恢复档事件已挂上
      expect(r41[0].issues[0].rule).toBe('R26'); // 已挂 issues 保留
      expect(r41[0].persistedAt).toBe('2026-09-30T10:00:00.000Z');
    } finally {
      restore();
    }
  });

  it('顺序联动：loadReports → loadIssues，告警按楼补挂进恢复档（不产生占位行）', async () => {
    const restore = mockChat({ reports: SAVED, issues: { '41': [{ ...R26_ISSUE }] } });
    try {
      await loadReports();
      await loadIssues();
      const r41 = parseState.reports.filter(r => r.message_id === 41);
      expect(r41).toHaveLength(1);
      expect(r41[0].issues[0].rule).toBe('R26');
      expect(r41[0].events).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('无酒馆 API / 无 $parse.reports → 静默降级不炸', async () => {
    const g = globalThis as Globals;
    const savedGv = g.getVariables;
    delete g.getVariables;
    try {
      await expect(loadReports()).resolves.toBeUndefined();
    } finally {
      g.getVariables = savedGv;
    }
    const restore = mockChat({}); // 无 reports 字段
    try {
      await loadReports();
      expect(parseState.reports).toHaveLength(0);
    } finally {
      restore();
    }
  });
});

/* ═══════════════ ⑥ 面板接线契约（SFC 源码面） ═══════════════ */

describe('PanelParseRepair.vue · loadReports 接线契约', () => {
  const SFC = readFileSync(join(__dirname, '../../中控悬浮窗/panels/PanelParseRepair.vue'), 'utf8');

  it('loadReports 导入 + onMounted 挂载（与 loadIssues 并列）', () => {
    expect(SFC).toMatch(/import\s*\{[^}]*loadReports[^}]*\}\s*from\s*'(?:\.\.\/)?\.\.\/红警指挥系统\/composables\/useParse'/);
    expect(SFC).toContain('void loadReports();');
    expect(SFC).toContain('void loadIssues();'); // 既接先例未动
  });

  it('流水区口径更新：不再宣称「本会话有效」', () => {
    expect(SFC).toContain('报告流水（跨会话持久）');
    expect(SFC).not.toContain('报告流水（本会话）');
  });
});
