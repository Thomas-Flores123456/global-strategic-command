/**
 * 批 C（$parse.issues 治理）测试
 *
 * 钉住六点：
 * ① capIssuesFloors 纯函数：超帽按楼号数值裁最旧、无法归一为非负整数的脏键优先裁、恰帽原样；
 * ② persistParse 集成（真 runParseFor 热路径）：留档-裁汰顺序——新楼入档后裁最旧键；
 * ③ 空 issues 删键后不误裁（删键使键数回落，存量最旧键保留）；
 * ④ 读侧存量兼容：normalizeParseRoot 对超帽存量档不裁（由写侧滚动收敛）；
 * ⑤ undoFloor 连带清 issues：chat $parse.issues 键删除＋内存报告清空，done 键删除/stat_data 写回既有行为不变；
 * ⑥ undoFloor 幂等与守卫：undone/非 undoable 返回 false 且零 uvw、issues 不动。
 *
 * 热路径 mock 体例复刻 parseIssuesObservability.test.ts（setupRun 方案甲）。
 */
import { describe, expect, it, vi } from 'vitest';
import { Schema } from '../core/schema';
import type { CheckIssue } from '../parse/systemCheck';
import {
  capIssuesFloors,
  MAX_ISSUES_FLOORS,
  normalizeParseRoot,
  parseState,
  runParseFor,
  undoFloor,
  type ParseReport,
} from '../composables/useParse';

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

/** R26 触发基线：tech.done 在账 × 同项队列 active（复刻 parseIssuesObservability.test.ts） */
const TRIGGER_STAT = mkStat({
  queues: [{ type: '研究', item: '低可观测技术工学', base: '北坡主基地', progress: 45, status: 'active' }],
  tech: { done: ['低可观测技术工学'] },
});

type Globals = Record<string, unknown>;

/** 装全局酒馆 mock（体例同 parseIssuesObservability.test.ts）：floor0 = baselineStat，floor mid = 无标签 AI 楼 */
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
    uvwMock,
    restore() {
      g.getChatMessages = saved.gcm;
      g.getVariables = saved.gv;
      g.updateVariablesWith = saved.uvw;
      g.SillyTavern = saved.st;
    },
  };
}

/** undoFloor mock：message 侧写入捕获进 msgWrites，chat 侧直改 chatVars */
function setupUndo(chatVars: Record<string, unknown>) {
  const g = globalThis as Globals;
  const saved = { gcm: g.getChatMessages, gv: g.getVariables, uvw: g.updateVariablesWith, st: g.SillyTavern };
  const msgWrites: Record<string, unknown>[] = [];
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
      const mv: Record<string, unknown> = {};
      msgWrites.push(mv);
      return updater(mv);
    },
  );
  g.getChatMessages = () => [];
  g.getVariables = () => ({});
  g.updateVariablesWith = uvwMock;
  delete g.SillyTavern;
  return {
    chatVars,
    uvwMock,
    msgWrites,
    restore() {
      g.getChatMessages = saved.gcm;
      g.getVariables = saved.gv;
      g.updateVariablesWith = saved.uvw;
      g.SillyTavern = saved.st;
    },
  };
}

function mkUndoReport(overrides: Partial<ParseReport> = {}): ParseReport {
  return {
    message_id: 8,
    time: '2042-03-14T10:00:00.000Z',
    applied: true,
    events: [],
    issues: [{ ...R26_ISSUE }],
    quarantineCount: 0,
    undoable: true,
    undoBaseline: mkStat(),
    ...overrides,
  };
}

/** 造 n 个连续楼号键（start..start+n-1），各挂一条合法 CheckIssue */
function mkIssuesKeys(start: number, n: number): Record<string, CheckIssue[]> {
  const out: Record<string, CheckIssue[]> = {};
  for (let i = 0; i < n; i++) out[String(start + i)] = [{ ...R26_ISSUE }];
  return out;
}

/* ═══════════════ ① capIssuesFloors 纯函数 ═══════════════ */

describe('capIssuesFloors · 楼号键上限纯函数', () => {
  it('键数 ≤ 帽 → 原样返回（同引用，零裁汰）', () => {
    const at30 = mkIssuesKeys(1, MAX_ISSUES_FLOORS);
    expect(capIssuesFloors(at30)).toBe(at30);
    const under = mkIssuesKeys(1, 5);
    expect(capIssuesFloors(under)).toBe(under);
    expect(capIssuesFloors({})).toEqual({});
  });

  it('超帽 → 按楼号数值截最近，裁汰最旧键', () => {
    const src = mkIssuesKeys(1, MAX_ISSUES_FLOORS + 2); // '1'..'32'
    const out = capIssuesFloors(src);
    expect(Object.keys(out)).toHaveLength(MAX_ISSUES_FLOORS);
    expect('1' in out).toBe(false); // 最旧两键被裁
    expect('2' in out).toBe(false);
    for (let i = 3; i <= 32; i++) expect(out[String(i)]).toBeDefined();
    expect(out['32'][0].rule).toBe('R26'); // 值原样保留
  });

  it('非楼号脏键（非整数/负数）视为最旧、优先裁汰', () => {
    const src: Record<string, CheckIssue[]> = {
      ...mkIssuesKeys(1, MAX_ISSUES_FLOORS),
      abc: [{ ...R26_ISSUE }],
      '-5': [{ ...R26_ISSUE }],
    };
    const out = capIssuesFloors(src);
    expect(Object.keys(out)).toHaveLength(MAX_ISSUES_FLOORS);
    expect('abc' in out).toBe(false);
    expect('-5' in out).toBe(false);
    for (let i = 1; i <= MAX_ISSUES_FLOORS; i++) expect(out[String(i)]).toBeDefined();
  });

  it('不改动入参（纯函数，返回新对象）', () => {
    const src = mkIssuesKeys(1, MAX_ISSUES_FLOORS + 1);
    const before = Object.keys(src).length;
    capIssuesFloors(src);
    expect(Object.keys(src)).toHaveLength(before);
  });
});

/* ═══════════════ ②③ persistParse 集成：留档-裁汰顺序 ═══════════════ */

describe('persistParse · issues 楼号键超帽裁汰（热路径）', () => {
  it('30 存量键＋本楼告警入档 → 恰 30 键：新楼保留、最旧键裁汰', async () => {
    const s = setupRun({
      mid: 31,
      baselineStat: TRIGGER_STAT,
      chatVars: { $parse: { issues: mkIssuesKeys(1, 30) } }, // '1'..'30' 满帽存量
    });
    try {
      expect(await runParseFor(31)).toBe('parsed');
      const $parse = s.chatVars.$parse as Record<string, unknown>;
      const issues = $parse.issues as Record<string, CheckIssue[]>;
      expect(Object.keys(issues)).toHaveLength(MAX_ISSUES_FLOORS);
      expect('1' in issues).toBe(false); // 最旧键被裁
      for (let i = 2; i <= 30; i++) expect(issues[String(i)]).toBeDefined(); // 其余存量保留
      expect(issues['31'].some(i => i.rule === 'R26')).toBe(true); // 本楼新档入列（先留档后裁汰）
      // 既有字段形态不动
      const done = $parse.done as Record<string, { hash: string; swipe_id: number }>;
      expect(done['31']).toMatchObject({ swipe_id: 0 });
      expect(($parse.log as unknown[]).length).toBe(1);
    } finally {
      s.restore();
    }
  });

  it('本楼空 issues 删键使键数回落 → 不误裁存量最旧键', async () => {
    const clean = mkStat({
      queues: [{ type: '研究', item: '低可观测技术工学', status: 'active' }], // tech.done 空 → 不触发 R26
    });
    const s = setupRun({
      mid: 6,
      baselineStat: clean,
      chatVars: { $parse: { issues: { ...mkIssuesKeys(1, 30), '6': [{ ...R26_ISSUE }] } } }, // 30 键含本楼陈旧告警
    });
    try {
      expect(await runParseFor(6)).toBe('parsed');
      const $parse = s.chatVars.$parse as Record<string, unknown>;
      const issues = $parse.issues as Record<string, CheckIssue[]>;
      expect('6' in issues).toBe(false); // 空则删键（陈旧告警清除）
      expect(Object.keys(issues)).toHaveLength(29); // 回落后低于帽
      expect('1' in issues).toBe(true); // 最旧键未被误裁
    } finally {
      s.restore();
    }
  });
});

/* ═══════════════ ④ 读侧存量兼容（不裁） ═══════════════ */

describe('normalizeParseRoot · issues 读侧不裁（存量兼容）', () => {
  it('超帽存量档（40 键）原样保留，由写侧滚动收敛', () => {
    const p = normalizeParseRoot({ issues: mkIssuesKeys(1, MAX_ISSUES_FLOORS + 10) });
    expect(Object.keys(p.issues)).toHaveLength(MAX_ISSUES_FLOORS + 10);
    expect(p.issues['1'][0].rule).toBe('R26');
  });
});

/* ═══════════════ ⑤⑥ undoFloor 连带清 issues ═══════════════ */

describe('undoFloor · 连带清该楼 issues（批 C）', () => {
  it('撤销成功：chat $parse.done 与 $parse.issues 双键删除＋内存报告 issues 清空，stat_data 写回基线', async () => {
    const baseline = mkStat({ meta: { world_id: 'cyber2042', date: '2042-03-13', day_count: 0, location: '撤销前' } });
    const report = mkUndoReport({ undoBaseline: baseline });
    const s = setupUndo({
      $parse: {
        done: { '8': { hash: 'aabbccdd', swipe_id: 0 } },
        issues: { '7': [{ ...R26_ISSUE }], '8': [{ ...R26_ISSUE }] },
        log: [],
        quarantine: {},
      },
    });
    try {
      expect(await undoFloor(report)).toBe(true);
      // message 侧：stat_data 写回入库前基线（既有行为不变）
      expect(s.msgWrites).toHaveLength(1);
      expect(s.msgWrites[0].stat_data).toBe(baseline);
      // chat 侧：done 键删除（既有）＋本楼 issues 键连带删除（批 C）
      const $parse = s.chatVars.$parse as Record<string, unknown>;
      expect('8' in ($parse.done as Record<string, unknown>)).toBe(false);
      expect('8' in ($parse.issues as Record<string, unknown>)).toBe(false);
      expect('7' in ($parse.issues as Record<string, unknown>)).toBe(true); // 邻楼告警不受影响
      // 内存侧：该楼报告 issues 清空＋undone 标记（既有）
      expect(report.issues).toEqual([]);
      expect(report.undone).toBe(true);
      expect(s.uvwMock).toHaveBeenCalledTimes(2);
    } finally {
      s.restore();
    }
  });

  it('undone 幂等：二次撤销返回 false、零新增 uvw、issues 保持清空', async () => {
    const report = mkUndoReport();
    const s = setupUndo({
      $parse: { done: { '8': { hash: 'aabbccdd', swipe_id: 0 } }, issues: { '8': [{ ...R26_ISSUE }] } },
    });
    try {
      expect(await undoFloor(report)).toBe(true);
      expect(report.issues).toEqual([]);
      const calls = s.uvwMock.mock.calls.length;
      expect(await undoFloor(report)).toBe(false);
      expect(s.uvwMock.mock.calls.length).toBe(calls); // 零新增写入
      expect(report.issues).toEqual([]);
      expect(report.undone).toBe(true);
    } finally {
      s.restore();
    }
  });

  it('非 undoable 路径零影响：返回 false、零 uvw、内存 issues 不动', async () => {
    const report = mkUndoReport({ undoable: false, undoBaseline: undefined });
    const s = setupUndo({ $parse: { issues: { '8': [{ ...R26_ISSUE }] } } });
    try {
      expect(await undoFloor(report)).toBe(false);
      expect(s.uvwMock).not.toHaveBeenCalled();
      expect(report.issues).toHaveLength(1);
      expect(report.undone).toBeUndefined();
      const $parse = s.chatVars.$parse as Record<string, unknown>;
      expect('8' in ($parse.issues as Record<string, unknown>)).toBe(true); // chat 侧零触碰
    } finally {
      s.restore();
    }
  });

  it('undoBaseline=undefined（入库前无 stat_data）→ 删 stat_data 键，issues 连带清不变', async () => {
    const report = mkUndoReport({ undoBaseline: undefined });
    const s = setupUndo({
      $parse: { done: { '8': { hash: 'aabbccdd' } }, issues: { '8': [{ ...R26_ISSUE }] } },
    });
    try {
      expect(await undoFloor(report)).toBe(true);
      expect(s.msgWrites).toHaveLength(1);
      expect('stat_data' in s.msgWrites[0]).toBe(false); // _.unset 语义（既有行为）
      const $parse = s.chatVars.$parse as Record<string, unknown>;
      expect('8' in ($parse.issues as Record<string, unknown>)).toBe(false);
      expect(report.issues).toEqual([]);
    } finally {
      s.restore();
    }
  });
});

/* ═══════════════ parseState 引用钉住（防测试间串扰自查） ═══════════════ */

describe('批 C 改动不触碰 parseState 既有结构', () => {
  it('reports/quarantine/busy/loaded/chrono 字段形态不变', () => {
    expect(Array.isArray(parseState.reports)).toBe(true);
    expect(typeof parseState.busy).toBe('boolean');
    expect(parseState).toHaveProperty('quarantine');
    expect(parseState).toHaveProperty('loaded');
    expect(parseState).toHaveProperty('chrono');
  });
});
