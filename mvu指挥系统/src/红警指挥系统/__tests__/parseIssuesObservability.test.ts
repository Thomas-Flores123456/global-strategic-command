/**
 * CTRL-F1-OBS-01（R26/issues 观测链接线）测试
 *
 * 钉住五点：
 * ① persistParse 把本楼 issues 持久化进 $parse.issues[message_id]（与 quarantine 同构）；
 * ② 恢复路径：loadIssues 把 $parse.issues 恢复进内存 parseState.reports（刷新后历史告警可见）；
 * ③ 明细渲染契约：PanelParseRepair.vue 展开明细中 issues 与 events 并列渲染、按 severity 着色；
 * ④ 空 issues 不写键（delete 语义，含清除该楼陈旧告警）；
 * ⑤ normalizeParseRoot 对存量损坏 issues 形态自愈（稀疏数组/空洞/脏项）。
 *
 * ①④ 走真 runParseFor 热路径（全局酒馆 API 以 mock 注入，体例同 useParse.test.ts 方案甲套件）；
 * R26 触发构造直接复刻 assetQueueCross.test.ts 的「tech.done 在账 × 队列 active」基线。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it, vi } from 'vitest';
import { Schema } from '../core/schema';
import type { CheckIssue } from '../parse/systemCheck';
import { loadIssues, normalizeParseRoot, parseState, runParseFor } from '../composables/useParse';

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

/** R26 触发基线：tech.done 在账 × 同项队列 active（复刻 assetQueueCross.test.ts 触发态） */
const TRIGGER_STAT = mkStat({
  queues: [{ type: '研究', item: '低可观测技术工学', base: '北坡主基地', progress: 45, status: 'active' }],
  tech: { done: ['低可观测技术工学'] },
});

type Globals = Record<string, unknown>;

/**
 * 装全局酒馆 mock：floor0 = baselineStat 的 AI 楼，floor mid = 无标签 AI 楼。
 * 聊天变量走共享 chatVars（uvw 的 updater 直接读写它），返回捕获器供断言。
 */
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

/* ═══════════════ ① issues 持久化写入 $parse 形态 ═══════════════ */

describe('persistParse · issues 落 $parse（CTRL-F1-OBS-01）', () => {
  it('R26 告警随解析落盘：$parse.issues[mid] 与 quarantine 同构，done/log 形态不动', async () => {
    const s = setupRun({ mid: 5, baselineStat: TRIGGER_STAT });
    try {
      expect(await runParseFor(5)).toBe('parsed');
      const $parse = s.chatVars.$parse as Record<string, unknown>;
      expect($parse).toBeDefined();
      // 新字段：按楼字符串键留档，项为 CheckIssue 四字段
      const issues = $parse.issues as Record<string, CheckIssue[]>;
      expect(Array.isArray(issues)).toBe(false); // 纯对象，非稀疏数组
      expect(Object.keys(issues)).toEqual(['5']);
      const r26 = issues['5'].filter(i => i.rule === 'R26');
      expect(r26.length).toBeGreaterThanOrEqual(1);
      expect(r26[0]).toMatchObject({ level: 'warn', target: '队列[低可观测技术工学]' });
      expect(typeof r26[0].message).toBe('string');
      // 既有字段形态逐字不动
      const done = $parse.done as Record<string, { hash: string; swipe_id: number }>;
      expect(done['5']).toMatchObject({ swipe_id: 0 });
      expect(typeof done['5'].hash).toBe('string');
      expect(Array.isArray($parse.log)).toBe(true);
      expect(($parse.log as unknown[]).length).toBe(1);
      const quarantine = $parse.quarantine as Record<string, unknown>;
      expect('5' in quarantine).toBe(false); // 本楼无隔离 → 无键
      // 内存流水同步带 issues
      const rep = parseState.reports.find(r => r.message_id === 5);
      expect(rep?.issues.some(i => i.rule === 'R26')).toBe(true);
    } finally {
      s.restore();
    }
  });
});

/* ═══════════════ ④ 空 issues 不写键（delete 语义） ═══════════════ */

describe('persistParse · 空 issues 删键语义', () => {
  it('本楼无告警 → $parse.issues 无该楼键；同楼陈旧告警键被清除', async () => {
    const clean = mkStat({
      queues: [{ type: '研究', item: '低可观测技术工学', status: 'active' }], // tech.done 空 → 不触发 R26
    });
    const s = setupRun({
      mid: 6,
      baselineStat: clean,
      chatVars: { $parse: { issues: { '6': [{ ...R26_ISSUE }] } } }, // 存量陈旧告警
    });
    try {
      expect(await runParseFor(6)).toBe('parsed');
      const $parse = s.chatVars.$parse as Record<string, unknown>;
      const issues = $parse.issues as Record<string, CheckIssue[]>;
      expect('6' in issues).toBe(false); // 空则 delete：陈旧键被清，不新写
    } finally {
      s.restore();
    }
  });
});

/* ═══════════════ ② 恢复路径（$parse → 内存 reports） ═══════════════ */

describe('loadIssues · 刷新后历史告警恢复', () => {
  function mockChat($parse: unknown) {
    const g = globalThis as Globals;
    const savedGv = g.getVariables;
    g.getVariables = (o: { type: string }) => (o.type === 'chat' ? { $parse } : {});
    return () => {
      g.getVariables = savedGv;
    };
  }

  it('楼号不在本会话流水 → 追加「历史告警」报告，issues 完整恢复', async () => {
    const restore = mockChat({ issues: { '42': [{ ...R26_ISSUE }] } });
    try {
      const before = parseState.reports.filter(r => r.message_id === 42).length;
      expect(before).toBe(0);
      await loadIssues();
      const rep = parseState.reports.find(r => r.message_id === 42);
      expect(rep).toBeDefined();
      expect(rep?.issues).toHaveLength(1);
      expect(rep?.issues[0]).toMatchObject({ rule: 'R26', level: 'warn' });
      expect(rep?.events).toEqual([]); // 历史档无 events 面
      expect(rep?.note).toContain('历史告警');
    } finally {
      restore();
    }
  });

  it('楼号已在流水且 issues 为空 → 补齐；已有 issues 不覆盖（会话态更新鲜）', async () => {
    parseState.reports.unshift({
      message_id: 43,
      time: '会话',
      applied: true,
      events: [],
      issues: [],
      quarantineCount: 0,
      undoable: false,
    });
    parseState.reports.unshift({
      message_id: 44,
      time: '会话',
      applied: true,
      events: [],
      issues: [{ ...R26_ISSUE, message: '会话内新告警' }],
      quarantineCount: 0,
      undoable: false,
    });
    const restore = mockChat({
      issues: { '43': [{ ...R26_ISSUE }], '44': [{ ...R26_ISSUE, message: '历史旧告警' }] },
    });
    try {
      await loadIssues();
      const r43 = parseState.reports.filter(r => r.message_id === 43);
      expect(r43).toHaveLength(1); // 不重复追加
      expect(r43[0].issues).toHaveLength(1); // 空则补齐
      const r44 = parseState.reports.filter(r => r.message_id === 44);
      expect(r44).toHaveLength(1);
      expect(r44[0].issues[0].message).toBe('会话内新告警'); // 会话态不被历史档覆盖
    } finally {
      restore();
    }
  });

  it('无酒馆 API / 无 $parse.issues → 静默降级不炸', async () => {
    const g = globalThis as Globals;
    const savedGv = g.getVariables;
    delete g.getVariables;
    try {
      await expect(loadIssues()).resolves.toBeUndefined();
    } finally {
      g.getVariables = savedGv;
    }
    const restore = mockChat({}); // 无 issues 字段
    try {
      const n = parseState.reports.length;
      await loadIssues();
      expect(parseState.reports.length).toBe(n);
    } finally {
      restore();
    }
  });
});

/* ═══════════════ ⑤ 存量损坏形态自愈 ═══════════════ */

describe('normalizeParseRoot · issues 形状自愈', () => {
  it('稀疏数组形态归一成纯对象；脏项/空数组丢弃；既有字段不动', () => {
    const damaged = {
      done: [null, { hash: 'aabbccdd' }],
      quarantine: [null, null, [{ scope: 'block', tag: '图鉴', raw: 'x', error: 'e' }]],
      log: [{ message_id: 0 }],
      issues: [
        null,
        [{ ...R26_ISSUE }, { rule: 'R26' }, null, 'bad'], // 楼1：1 合法 + 3 脏项
        [], // 楼2：空数组 → 丢键
        [{ rule: 'R9', level: 'error', target: 't', message: 'm' }], // 楼3：单条合法
        { rule: 'R9', level: 'error', target: 't', message: 'm' }, // 楼4：裸对象非数组 → 丢键
      ],
      aliases: { 甲: '乙' },
    };
    const p = normalizeParseRoot(damaged);
    expect(Array.isArray(p.issues)).toBe(false);
    expect(Object.keys(p.issues).sort()).toEqual(['1', '3']);
    expect(p.issues['1']).toHaveLength(1);
    expect(p.issues['1'][0]).toMatchObject({ rule: 'R26', level: 'warn' });
    expect(p.issues['3']).toHaveLength(1);
    // level 非法值丢弃
    const p2 = normalizeParseRoot({ issues: { '7': [{ rule: 'R1', level: 'fatal', target: 't', message: 'm' }] } });
    expect(p2.issues).toEqual({});
    // 既有字段形态不变（回归钉住）
    expect(p.done).toEqual({ '1': { hash: 'aabbccdd' } });
    expect(Object.keys(p.quarantine)).toEqual(['2']);
    expect(p.log).toHaveLength(1);
    expect(p.aliases).toEqual({ 甲: '乙' });
  });

  it('非对象/缺失输入落空壳（含 issues 空对象）', () => {
    expect(normalizeParseRoot(undefined)).toEqual({ done: {}, log: [], quarantine: {}, issues: {} });
    expect(normalizeParseRoot('bad').issues).toEqual({});
  });
});

/* ═══════════════ ③ 明细渲染契约（SFC 源码面，体例同 floorContract/retireLifecycle） ═══════════════ */

describe('PanelParseRepair.vue · 报告明细 issues 渲染契约', () => {
  const SFC = readFileSync(join(__dirname, '../../中控悬浮窗/panels/PanelParseRepair.vue'), 'utf8');
  // 展开明细区块（repOpen === i）全文切片
  const detail = SFC.slice(SFC.indexOf('repOpen === i'), SFC.indexOf('</template>'));

  it('明细区块内 issues 与 events 并列渲染', () => {
    expect(detail).toContain('v-for="(ev, j) in r.events"'); // 既有 events 面未动
    expect(detail).toMatch(/v-for="\(is, k\) in r\.issues/); // 新 issues 面
    expect(detail).toContain('{{ is.rule }}/{{ is.level }}');
    expect(detail).toContain('{{ is.target }}');
    expect(detail).toContain('{{ is.message }}');
  });

  it('按 severity/light 着色（lvColor 与 R20 区同源）', () => {
    expect(detail).toContain('lvColor(is.level)');
  });

  it('onMounted 挂 loadIssues 恢复历史告警（与 loadQuarantine 并列）', () => {
    expect(SFC).toMatch(/import\s*\{[^}]*loadIssues[^}]*\}\s*from\s*'(?:\.\.\/)?\.\.\/红警指挥系统\/composables\/useParse'/);
    expect(SFC).toContain('void loadIssues();');
    expect(SFC).toContain('void loadQuarantine().then(refreshParseR20);');
  });
});
