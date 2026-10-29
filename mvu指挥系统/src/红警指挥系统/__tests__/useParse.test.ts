/**
 * useParse 纯函数片段测试（批 B）：hash 幂等指纹 / 基线扫描判定 / 编辑提交包裹。
 * 酒馆 IO 编排（runParseFor 等）属真机验证边界，不在 node 测。
 */
import { describe, expect, it, vi } from 'vitest';
import { Schema } from '../core/schema';
import {
  buildAuthority,
  codexNamesOf,
  hashText,
  normalizeParseRoot,
  scanBaseline,
  wrapFixText,
  type FloorView,
} from '../composables/useParse';

describe('normalizeParseRoot（$parse 形状自愈：真机踩坑回归）', () => {
  it('稀疏数组形态（lodash 数字键踩坑 + JSON 往返 null 空洞）归一成纯对象', () => {
    const damaged = {
      done: [null, { hash: 'aabbccdd' }],
      quarantine: [null, null, [{ scope: 'block', tag: '图鉴', raw: 'x', error: 'e' }]],
      log: [{ message_id: 0 }],
    };
    const p = normalizeParseRoot(damaged);
    expect(Array.isArray(p.done)).toBe(false);
    expect(Array.isArray(p.quarantine)).toBe(false);
    expect(p.done).toEqual({ '1': { hash: 'aabbccdd' } });
    expect(Object.keys(p.quarantine)).toEqual(['2']);
    expect(p.quarantine['2']).toHaveLength(1);
    expect(p.log).toHaveLength(1);
  });
  it('对象形态透传，空项/非法项丢弃，aliases 等未知键保留（批 C 预留）', () => {
    const p = normalizeParseRoot({
      done: { '3': { hash: 'ffffffff' }, '4': null, '5': {} },
      quarantine: { '3': [], '6': [{ raw: 'r', error: 'e' }] },
      aliases: { 歐盟聯合防務學: '欧盟联合防务学' },
    });
    expect(p.done).toEqual({ '3': { hash: 'ffffffff' } });
    expect(Object.keys(p.quarantine)).toEqual(['6']);
    expect(p.aliases).toEqual({ 歐盟聯合防務學: '欧盟联合防务学' });
  });
  it('非对象/undefined 输入落空壳', () => {
    // CTRL-F1-OBS-01：根形状新增 issues 面（与 quarantine 同构，空壳含空对象）
    expect(normalizeParseRoot(undefined)).toEqual({ done: {}, log: [], quarantine: {}, issues: {} });
    expect(normalizeParseRoot('bad')).toEqual({ done: {}, log: [], quarantine: {}, issues: {} });
  });
});

describe('hashText（FNV-1a 幂等指纹）', () => {
  it('同文同 hash，异文异 hash', () => {
    expect(hashText('abc')).toBe(hashText('abc'));
    expect(hashText('abc')).not.toBe(hashText('abd'));
    expect(hashText('')).toBe(hashText(''));
  });
  it('中文与 emoji 稳定', () => {
    const a = hashText('<战况>\n资金变化: +120\n</战况>');
    expect(a).toBe(hashText('<战况>\n资金变化: +120\n</战况>'));
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('scanBaseline（楼层传承基线扫描）', () => {
  const mk = (role: string, is_hidden: boolean, stat?: unknown): FloorView => ({
    role,
    is_hidden,
    stat_data: stat,
    has_stat_data: stat !== undefined,
  });

  it('跳过 user 楼 / 隐藏楼 / 无 stat_data 楼，取第一个有效 AI 楼', () => {
    const floors: Record<number, FloorView> = {
      0: mk('assistant', false, { tag: 'floor0' }),
      1: mk('assistant', false, { tag: 'floor1' }),
      2: mk('user', false, { tag: 'user-floor' }), // user 楼即使有变量也跳过
      3: mk('assistant', true, { tag: 'hidden' }), // 隐藏楼跳过
      4: mk('assistant', false, undefined), // 无 stat_data 跳过
    };
    const r = scanBaseline(4, id => floors[id] ?? null);
    expect(r).toEqual({ stat_data: { tag: 'floor1' }, message_id: 1 });
  });

  it('0 楼向下（fromId=-1）与全无变量 → undefined（落归零基线）', () => {
    expect(scanBaseline(-1, () => null)).toBeUndefined();
    const noVar: FloorView = mk('assistant', false, undefined);
    expect(scanBaseline(3, () => noVar)).toBeUndefined();
  });

  it('reader 读取失败（null）的楼被跳过而不中断扫描', () => {
    const floors: Record<number, FloorView | null> = {
      0: mk('assistant', false, { ok: true }),
      1: null, // 楼不存在/读失败
    };
    expect(scanBaseline(1, id => floors[id] ?? null)).toEqual({ stat_data: { ok: true }, message_id: 0 });
  });
});

describe('wrapFixText（编辑后提交的 tag 包裹）', () => {
  it('无 tag 文本按隔离项 tag 包裹；非词表 tag 兜底〈战况〉', () => {
    expect(wrapFixText('名称: 湍流护盾', '图鉴')).toBe('<图鉴>\n名称: 湍流护盾\n</图鉴>');
    expect(wrapFixText('资金: 100', '队列')).toBe('<战况>\n资金: 100\n</战况>');
    expect(wrapFixText('资金: 100')).toBe('<战况>\n资金: 100\n</战况>');
  });
  it('已含已知 tag（含全角）则原样通过', () => {
    expect(wrapFixText('<战况>\n资金: 1\n</战况>')).toBe('<战况>\n资金: 1\n</战况>');
    expect(wrapFixText('＜图鉴＞\n- 名称: x\n＜/图鉴＞', '图鉴')).toBe('＜图鉴＞\n- 名称: x\n＜/图鉴＞');
  });
});

describe('buildAuthority（真机时序 bug 回归：mount 前 pinia 未激活）', () => {
  // node 测试环境天然无 pinia/无酒馆全局，等价于 init 兑底解析的时序现场。
  // 旧版 catalog 源走 useCatalogStore() 在此静默降级为空 → fuzzy 对齐形同虚设（真机 #5/#7 楼实测命中）。
  it('无 pinia 环境下 catalog 静态源仍完整（effectiveCatalogNames 纯函数路径）', async () => {
    const a = await buildAuthority();
    expect(a.names).toContain('纳米精密合成学'); // catalog.RESEARCHES 静态名
    expect(a.names.length).toBeGreaterThan(100); // 全目录百余项起步，不应被降级剪空
  });
  it('extraNames（baseline codex 名）进入名单；codexNamesOf 容错任意形状', async () => {
    expect(codexNamesOf({ codex: [{ name: '湍流护盾' }, { name: '  ' }, {}, null] })).toEqual(['湍流护盾']);
    expect(codexNamesOf(undefined)).toEqual([]);
    expect(codexNamesOf({ codex: 'bad' })).toEqual([]);
    const a = await buildAuthority(['湍流护盾']);
    expect(a.names).toContain('湍流护盾');
  });
});

describe('runParseFor swipe 事务化（CTRL-FLOOR-HEAL-01 方案甲）', () => {
  const RAW = '<战况>\n资金: 100\n</战况>';
  const HASH = hashText(RAW);
  type Globals = Record<string, unknown>;

  /** 装全局酒馆 mock；swipeSeq 逐次返回的 swipe_id（越界后钉在末位） */
  function setup(opts: { swipeSeq: number[]; done?: unknown }) {
    const g = globalThis as Globals;
    const saved = { gcm: g.getChatMessages, gv: g.getVariables, uvw: g.updateVariablesWith, st: g.SillyTavern };
    let i = 0;
    const uvwMock = vi.fn(async (updater: (v: Record<string, unknown>) => Record<string, unknown>) => updater({}));
    g.getChatMessages = () => [
      {
        role: 'assistant',
        is_hidden: false,
        message: RAW,
        swipe_id: opts.swipeSeq[Math.min(i++, opts.swipeSeq.length - 1)],
      },
    ];
    g.getVariables = (o: { type: string }) =>
      o.type === 'chat' ? (opts.done ? { $parse: { done: opts.done } } : {}) : {};
    g.updateVariablesWith = uvwMock;
    delete g.SillyTavern;
    return {
      uvwMock,
      restore() {
        g.getChatMessages = saved.gcm;
        g.getVariables = saved.gv;
        g.updateVariablesWith = saved.uvw;
        g.SillyTavern = saved.st;
      },
    };
  }

  it('done 双因子匹配（hash + swipe_id）才幂等跳过', async () => {
    const s = setup({ swipeSeq: [0, 0], done: { '0': { hash: HASH, swipe_id: 0 } } });
    try {
      const { resetMemoryTimelineLedgerForTest } = await import('../core/timelineLedger');
      resetMemoryTimelineLedgerForTest();
      const { runParseFor } = await import('../composables/useParse');
      expect(await runParseFor(0)).toBe('skipped');
      expect(s.uvwMock).not.toHaveBeenCalled();
    } finally {
      s.restore();
    }
  });

  it('hash 匹配但 swipe_id 不同 → 不跳过（重解析该页并入账，done 记双因子）', async () => {
    const s = setup({ swipeSeq: [1, 1], done: { '0': { hash: HASH, swipe_id: 0 } } });
    try {
      const { runParseFor } = await import('../composables/useParse');
      expect(await runParseFor(0)).toBe('parsed');
      expect(s.uvwMock).toHaveBeenCalled();
      const chatWrite = s.uvwMock.mock.calls.findIndex(c => (c[1] as { type: string }).type === 'chat');
      expect(chatWrite).toBeGreaterThanOrEqual(0);
      const out = (s.uvwMock.mock.calls[chatWrite][0] as (v: Record<string, unknown>) => Record<string, unknown>)({});
      expect((out.$parse as { done: Record<string, unknown> }).done['0']).toEqual({ hash: HASH, swipe_id: 1 });
    } finally {
      s.restore();
    }
  });

  it('旧格式 done（无 swipe_id）→ 惰性视为不匹配，重解析一次顺带升级格式', async () => {
    const s = setup({ swipeSeq: [0, 0], done: { '0': { hash: HASH } } });
    try {
      const { runParseFor } = await import('../composables/useParse');
      expect(await runParseFor(0)).toBe('parsed');
      expect(s.uvwMock).toHaveBeenCalled();
    } finally {
      s.restore();
    }
  });

  it('写前 swipe 漂移 → fail-closed 弃写并返回 swipe-drifted（方案甲②）', async () => {
    const s = setup({ swipeSeq: [0, 1] }); // 入口读到 swipe 0，写前复核已切到 swipe 1
    try {
      const { runParseFor } = await import('../composables/useParse');
      // _swipeRetry 拉满抑制自动重排定时器，单测只看本次行为
      expect(await runParseFor(0, { _swipeRetry: 3 })).toBe('swipe-drifted');
      expect(s.uvwMock).not.toHaveBeenCalled(); // 不落盘、不入账
    } finally {
      s.restore();
    }
  });

  it('normalizeParseRoot 保留 done.swipe_id（非法值丢弃）', () => {
    const p = normalizeParseRoot({
      done: {
        '1': { hash: 'aabbccdd', swipe_id: 2 },
        '2': { hash: 'bbccddee', swipe_id: 'x' },
        '3': { hash: 'ccddee00' },
      },
    });
    expect(p.done['1']).toEqual({ hash: 'aabbccdd', swipe_id: 2 });
    expect(p.done['2']).toEqual({ hash: 'bbccddee' });
    expect(p.done['3']).toEqual({ hash: 'ccddee00' });
  });

  it('swipeSlotMissing：槽缺 stat_data → true；有 → false；user 楼/无 API → false', async () => {
    const g = globalThis as Globals;
    const saved = { gcm: g.getChatMessages, gv: g.getVariables, uvw: g.updateVariablesWith };
    try {
      const { swipeSlotMissing } = await import('../composables/useParse');
      g.getChatMessages = () => [{ role: 'assistant', is_hidden: false, message: RAW, swipe_id: 0 }];
      g.getVariables = () => ({});
      g.updateVariablesWith = async () => ({});
      expect(await swipeSlotMissing(0)).toBe(true);
      g.getVariables = () => ({ stat_data: { ok: 1 } });
      expect(await swipeSlotMissing(0)).toBe(false);
      g.getChatMessages = () => [{ role: 'user', is_hidden: false, message: RAW, swipe_id: 0 }];
      g.getVariables = () => ({});
      expect(await swipeSlotMissing(0)).toBe(false);
    } finally {
      g.getChatMessages = saved.gcm;
      g.getVariables = saved.gv;
      g.updateVariablesWith = saved.uvw;
    }
    const g2 = globalThis as Globals;
    const savedAll = { gcm: g2.getChatMessages, gv: g2.getVariables, uvw: g2.updateVariablesWith };
    delete g2.getChatMessages;
    delete g2.getVariables;
    delete g2.updateVariablesWith;
    try {
      const { swipeSlotMissing } = await import('../composables/useParse');
      expect(await swipeSlotMissing(0)).toBe(false);
    } finally {
      g2.getChatMessages = savedAll.gcm;
      g2.getVariables = savedAll.gv;
      g2.updateVariablesWith = savedAll.uvw;
    }
  });
});

describe('runParseFor expectChatId 漂移守卫（CTRL-FLOOR-SLIM-01）', () => {
  it('未提供酒馆 API 时返回 unavailable', async () => {
    const outcome = await import('../composables/useParse').then(m => m.runParseFor(0));
    expect(outcome).toBe('unavailable');
  });

  it('expectChatId 漂移时 fail-closed 拒写并返回 chat-changed', async () => {
    const g = globalThis as Record<string, unknown>;
    const origGcm = g.getChatMessages;
    const origGv = g.getVariables;
    const origUvw = g.updateVariablesWith;
    const origSt = g.SillyTavern;
    const uvwMock = vi.fn();
    try {
      g.getChatMessages = () => [{ role: 'assistant', is_hidden: false, message: 'test' }];
      g.getVariables = () => ({});
      g.updateVariablesWith = uvwMock;
      g.SillyTavern = {
        getCurrentChatId: () => 'chat-current',
      };
      const { runParseFor } = await import('../composables/useParse');
      const outcome = await runParseFor(1, { expectChatId: 'chat-expected-different' });
      expect(outcome).toBe('chat-changed');
      expect(uvwMock).not.toHaveBeenCalled();
    } finally {
      g.getChatMessages = origGcm;
      g.getVariables = origGv;
      g.updateVariablesWith = origUvw;
      g.SillyTavern = origSt;
    }
  });
});

/* ═══════════════ E3b 部署双槽接线（CTRL-DEPLOY-PARSE-01 生产链路集成链） ═══════════════ */

/** undefined=走真实 effectiveCatalogSnapshot；null=模拟 catalog 缺席；对象=合成 catalog */
const deploySnapshotSlot = vi.hoisted(() => ({ override: undefined as unknown }));

vi.mock('../composables/useCatalog', async importOriginal => {
  const orig = await importOriginal<typeof import('../composables/useCatalog')>();
  return {
    ...orig,
    effectiveCatalogSnapshot: () =>
      (deploySnapshotSlot.override === undefined
        ? orig.effectiveCatalogSnapshot()
        : deploySnapshotSlot.override) as ReturnType<typeof orig.effectiveCatalogSnapshot>,
  };
});

describe('E3b 部署双槽接线（runParseFor：deployIndex 注入 → deployOrders 结算入账）', () => {
  const VEHICLE = '前沿基地建设车';
  const BASE = '北坡主基地';
  const INTO = '前沿工地';
  const DEPLOY_RAW = `<战况>\n部署:\n  - 展开: ${VEHICLE}\n    基地: ${BASE}\n</战况>`;
  type Globals = Record<string, unknown>;

  const syntheticCatalog = () =>
    ({
      researches: [],
      buildings: [],
      productions: [{ name: VEHICLE, deploy: { into: INTO, duration_min: 600, reverse: true } }],
      retrofits: [],
      factionDefs: [],
    }) as unknown as import('../core/catalogEffective').EffectiveCatalog;

  const mkBaseline = () =>
    Schema.parse({
      meta: { world_id: 'cyber2042', date: '2042-03-14', day_count: 1 },
      bases: [{ id: BASE, name: BASE, location: '青岚山北坡', buildings: [{ name: '盟军建造厂' }] }],
      forces: { vehicles: [VEHICLE] },
    });

  /** 装全局酒馆 mock：0 楼为基线楼（含 stat_data），1 楼为待解析楼（原文 raw） */
  function setup(raw: string) {
    const g = globalThis as Globals;
    const saved = { gcm: g.getChatMessages, gv: g.getVariables, uvw: g.updateVariablesWith, st: g.SillyTavern };
    const uvwMock = vi.fn(async (updater: (v: Record<string, unknown>) => Record<string, unknown>) => updater({}));
    g.getChatMessages = (id: number) =>
      id === 1
        ? [{ role: 'assistant', is_hidden: false, message: raw, swipe_id: 0 }]
        : [{ role: 'assistant', is_hidden: false, message: '<战况>\n资金: 100\n</战况>', swipe_id: 0 }];
    g.getVariables = (o: { type: string; message_id?: number }) =>
      o.type === 'message' && o.message_id === 0 ? { stat_data: mkBaseline() } : {};
    g.updateVariablesWith = uvwMock;
    delete g.SillyTavern;
    return {
      /** 首笔 uvw 即本楼 stat_data 落盘（persistParse 在其后） */
      async writtenStat(): Promise<Record<string, unknown>> {
        const first = (await uvwMock.mock.results[0].value) as Record<string, unknown>;
        return first.stat_data as Record<string, unknown>;
      },
      restore() {
        g.getChatMessages = saved.gcm;
        g.getVariables = saved.gv;
        g.updateVariablesWith = saved.uvw;
        g.SillyTavern = saved.st;
      },
    };
  }

  it('接线到达：部署声明经 parseMessageText(deployIndex)→settleFloor(deployOrders) 入账 pending_deployments', async () => {
    deploySnapshotSlot.override = syntheticCatalog();
    const s = setup(DEPLOY_RAW);
    try {
      const { runParseFor, parseState } = await import('../composables/useParse');
      expect(await runParseFor(1)).toBe('parsed');
      const stat = await s.writtenStat();
      expect(stat.pending_deployments).toEqual([
        { vehicle: VEHICLE, action: '展开', base: BASE, into: INTO, remaining_minutes: 600 },
      ]);
      expect((stat.forces as { vehicles: string[] }).vehicles).toContain(VEHICLE); // Δt=0 不翻转
      expect(parseState.reports[0].events.some(e => e.light === '🟢' && e.message.includes('部署令「展开」'))).toBe(
        true,
      );
    } finally {
      s.restore();
      deploySnapshotSlot.override = undefined;
    }
  });

  it('catalog 缺席降级：deployIndex=undefined → 部署令 fail-closed 拒收留痕，落盘不阻断、不入账', async () => {
    deploySnapshotSlot.override = null;
    const s = setup(DEPLOY_RAW);
    try {
      const { runParseFor, parseState } = await import('../composables/useParse');
      expect(await runParseFor(1)).toBe('parsed');
      const stat = await s.writtenStat();
      expect(stat.pending_deployments).toBeUndefined();
      expect(parseState.reports[0].events.some(e => e.light === '🟡' && e.message.includes('部署令'))).toBe(true);
      expect(
        parseState.reports[0].issues.some(
          i => i.rule === 'R18' && i.level === 'warn' && i.message.includes('部署令拒收'),
        ),
      ).toBe(true);
    } finally {
      s.restore();
      deploySnapshotSlot.override = undefined;
    }
  });

  it('零注入零回归：原文无部署声明 → 无 pending_deployments、无部署事件，战况增量照常入库', async () => {
    deploySnapshotSlot.override = syntheticCatalog();
    const s = setup('<战况>\n资金: 100\n</战况>');
    try {
      const { runParseFor, parseState } = await import('../composables/useParse');
      expect(await runParseFor(1)).toBe('parsed');
      const stat = await s.writtenStat();
      expect(stat.pending_deployments).toBeUndefined();
      expect((stat.economy as { credits: number }).credits).toBe(100); // 常规增量不受接线影响
      expect((stat.forces as { vehicles: string[] }).vehicles).toContain(VEHICLE);
      expect(parseState.reports[0].events.some(e => e.message.includes('部署'))).toBe(false);
    } finally {
      s.restore();
      deploySnapshotSlot.override = undefined;
    }
  });
});

describe('ENG03-02 submitFix 隔离区工程令修复闭环', () => {
  const RETROFIT: import('../core/catalog').RetrofitDef = {
    kind: 'retrofit',
    name: '灰熊坦克现代化改装工程',
    research: '重装机甲理论',
    grade: '中改',
    desc: '测试用定义',
    cost: 1200,
    scope: 'base',
    phases: [
      { name: '方案与备料', cost: 400, workload: { days: 3, min_days: 1 }, resources: { nanites: 20 } },
      { name: '总装与调校', cost: 800, workload: { days: 4, min_days: 2 }, resources: { nanites: 30 } },
    ],
  };

  type Globals = Record<string, unknown>;

  function setupFloor(initialStat: Record<string, unknown>, initialQuarantine: import('../parse/parsePipeline').QuarantineItem) {
    const g = globalThis as Globals;
    const saved = { gcm: g.getChatMessages, gv: g.getVariables, uvw: g.updateVariablesWith, st: g.SillyTavern };
    let floorStat = initialStat;
    let chatVars: Record<string, unknown> = { $parse: { quarantine: { '1': [initialQuarantine] } } };
    const uvwMock = vi.fn(async (updater: (v: Record<string, unknown>) => Record<string, unknown>, opts: { type: string }) => {
      if (opts.type === 'message') {
        const next = updater({ stat_data: floorStat });
        floorStat = next.stat_data as Record<string, unknown>;
        return next;
      }
      chatVars = updater(chatVars);
      return chatVars;
    });
    g.getChatMessages = () => [{ role: 'assistant', is_hidden: false, message: '<工程>\n</工程>', swipe_id: 0 }];
    g.getVariables = (o: { type: string }) => (o.type === 'message' ? { stat_data: floorStat } : chatVars);
    g.updateVariablesWith = uvwMock;
    delete g.SillyTavern;
    return {
      getStat: () => floorStat,
      restore() {
        g.getChatMessages = saved.gcm;
        g.getVariables = saved.gv;
        g.updateVariablesWith = saved.uvw;
        g.SillyTavern = saved.st;
      },
    };
  }

  it('修复立项/注资/取消令真实生效且仅扣款一次；资金不足保留业务拒收隔离；本楼时钟与进度不重复推进', async () => {
    deploySnapshotSlot.override = {
      researches: [],
      buildings: [],
      productions: [],
      retrofits: [RETROFIT],
      projects: [],
      factionDefs: [],
    };
    const baseStat = Schema.parse({
      meta: { world_id: 'cyber2042', date: '2042-03-14', day_count: 2 },
      clock: { day: 2, time: '14:30' },
      tech: { done: ['重装机甲理论'] },
      economy: { credits: 1000, resources: { nanites: { 标准纳米工料: 100 } } },
      bases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '盟军建造厂', state: '运转' }] }],
      queues: [
        {
          type: '生产',
          item: '灰熊主战坦克',
          base: 'beipo',
          status: 'active',
          total_minutes: 1440,
          spent_minutes: 360,
          progress: 25,
          qty: 1,
          qty_done: 0,
          cost_paid: true,
          min_days_lock: 0,
          hold: false,
        },
      ],
      projects: [],
    }) as unknown as Record<string, unknown>;

    const qInit = {
      scope: 'element' as const,
      tag: '工程',
      path: '工程.立项',
      raw: '{"verb":"立项"}',
      error: '立项令缺必填字段（name/base）',
    };
    const s = setupFloor(baseStat, qInit);
    try {
      const { submitFix, parseState } = await import('../composables/useParse');
      parseState.quarantine['1'] = [qInit];

      // 1. 修复立项令：扣首期 400（1000 → 600），生成工程与投影，移除原隔离项，不推进 clock 和既有生产队列
      const r1 = await submitFix(1, qInit, '立项:\n  name: 灰熊坦克现代化改装工程\n  base: beipo');
      expect(r1.ok).toBe(true);
      const stat1 = s.getStat();
      expect((stat1.economy as { credits: number }).credits).toBe(600);
      expect((stat1.projects as unknown[]).length).toBe(1);
      expect((stat1.queues as { spent_minutes: number }[])[0].spent_minutes).toBe(360);
      expect(stat1.clock).toEqual({ day: 2, time: '14:30' });
      expect(parseState.quarantine['1']).toBeUndefined();

      // 2. 首期完工后修复阶段 #1 注资令，但当前资金 600 < 800：不扣款，业务拒收新隔离项保留在 quarantine
      const projects1 = stat1.projects as { id: string; phases: { status: string; queue_index: number | null }[] }[];
      projects1[0].phases[0] = { ...projects1[0].phases[0], status: '完工', queue_index: null };
      (stat1.queues as { status: string }[])[1].status = 'done';
      const qPhase = {
        scope: 'element' as const,
        tag: '工程',
        path: '工程.注资',
        raw: '{"verb":"注资"}',
        error: '注资令缺定位维度',
      };
      parseState.quarantine['1'] = [qPhase];
      const r2 = await submitFix(1, qPhase, `注资:\n  id: ${projects1[0].id}\n  phase: 1`);
      expect(r2.ok).toBe(true);
      const stat2 = s.getStat();
      expect((stat2.economy as { credits: number }).credits).toBe(600);
      expect(parseState.quarantine['1']).toHaveLength(1);
      expect(parseState.quarantine['1'][0].path).toBe('工程.注资');

      // 3. 补足资金到 1000 后再次修复同一注资令：扣 800（1000 → 200），阶段 #1 入队，隔离区清空
      (stat2.economy as { credits: number }).credits = 1000;
      const qPhaseRetry = parseState.quarantine['1'][0];
      const r3 = await submitFix(1, qPhaseRetry, `注资:\n  id: ${projects1[0].id}\n  phase: 1`);
      expect(r3.ok).toBe(true);
      const stat3 = s.getStat();
      expect((stat3.economy as { credits: number }).credits).toBe(200);
      expect((stat3.projects as { phases: { status: string }[] }[])[0].phases[1].status).toBe('进行中');
      expect(parseState.quarantine['1']).toBeUndefined();

      // 4. 修复取消令：工程置取消，在途阶段投影置 cancelled，资金保持 200 不退
      const qCancel = {
        scope: 'element' as const,
        tag: '工程',
        path: '工程.取消',
        raw: '{"verb":"取消"}',
        error: '工程令「取消」缺实例定位',
      };
      parseState.quarantine['1'] = [qCancel];
      const r4 = await submitFix(1, qCancel, `取消:\n  id: ${projects1[0].id}`);
      expect(r4.ok).toBe(true);
      const stat4 = s.getStat();
      expect((stat4.projects as { status: string }[])[0].status).toBe('取消');
      expect((stat4.queues as { status: string }[])[2].status).toBe('cancelled');
      expect((stat4.economy as { credits: number }).credits).toBe(200);
      expect(parseState.quarantine['1']).toBeUndefined();
    } finally {
      s.restore();
      deploySnapshotSlot.override = undefined;
    }
  });
});

describe('SH40-02 · 时序裁决与跨聊天/跨Swipe身份守卫', () => {
  type Globals = Record<string, unknown>;

  it('聊天A推进到#20后切换到聊天B解析#3正常通过，切到同号已解析末楼清空旧暂存且拒删聊天B末楼；同聊天逆序旧楼#2仍被拦截', async () => {
    const g = globalThis as Globals;
    const saved = {
      gcm: g.getChatMessages,
      gv: g.getVariables,
      uvw: g.updateVariablesWith,
      glmi: g.getLastMessageId,
      del: g.deleteChatMessages,
      trig: g.triggerSlash,
      st: g.SillyTavern,
    };
    let currentChat = 'chat-A';
    let lastId = 20;
    const raw3 = '<战况>\n资金: 300\n</战况>';
    const hash3 = hashText(raw3);
    let chatVarsB: Record<string, unknown> = {};
    const delMock = vi.fn(async () => {});
    const trigMock = vi.fn(async () => '');

    g.SillyTavern = { getCurrentChatId: () => currentChat };
    g.getLastMessageId = () => lastId;
    g.deleteChatMessages = delMock;
    g.triggerSlash = trigMock;
    g.getChatMessages = () => [{ role: 'assistant', is_hidden: false, message: raw3, swipe_id: 0 }];
    g.getVariables = (o: { type: string }) => (o.type === 'chat' && currentChat === 'chat-B' ? chatVarsB : {});
    g.updateVariablesWith = vi.fn(async (updater: (v: Record<string, unknown>) => Record<string, unknown>, o: { type: string }) => {
      if (o.type === 'chat' && currentChat === 'chat-B') {
        chatVarsB = updater(chatVarsB);
        return chatVarsB;
      }
      return updater({});
    });

    try {
      const { makeSwipeScopedKey, parseState, regenerateChronoFloor, runParseFor } = await import(
        '../composables/useParse'
      );

      // 1. 同聊天 A 内，非最新旧楼 #2（最新楼 #20）触发重生成被严格拦截
      parseState.chrono = {
        message_id: 2,
        chatId: 'chat-A',
        swipe_id: 0,
        swipeKey: makeSwipeScopedKey(2, 0),
        hash: hash3,
        at: new Date().toISOString(),
        verdicts: [
          {
            verdict: 'OVERRUN',
            overrunKind: 'time_conflict',
            item: '天启坦克',
            declaredQty: 1,
            physicalDoneQty: 0,
            remainingMinutes: 600,
          },
        ],
      };
      const outOfOrderRegen = await regenerateChronoFloor();
      expect(outOfOrderRegen.ok).toBe(false);
      expect(outOfOrderRegen.error).toContain('不是最新楼');
      expect(delMock).not.toHaveBeenCalled();

      // 2. 聊天 A 已推进到 #20，切换到聊天 B（最新楼 #3）解析 #3 不被误拒
      parseState.chrono = { ...parseState.chrono!, message_id: 20, swipeKey: makeSwipeScopedKey(20, 0) };
      currentChat = 'chat-B';
      lastId = 3;
      expect(await runParseFor(3)).toBe('parsed');
      expect(parseState.chrono).toBeNull();

      // 3. 若聊天 A 的冲突暂存恰好也在 #3，切到聊天 B 已解析的 #3（幂等 skipped）时暂存失效，且重生成拒删聊天 B #3
      parseState.chrono = {
        message_id: 3,
        chatId: 'chat-A',
        swipe_id: 0,
        swipeKey: makeSwipeScopedKey(3, 0),
        hash: hash3,
        at: new Date().toISOString(),
        verdicts: [
          {
            verdict: 'OVERRUN',
            overrunKind: 'time_conflict',
            item: '天启坦克',
            declaredQty: 1,
            physicalDoneQty: 0,
            remainingMinutes: 600,
          },
        ],
      };
      const crossChatRegen = await regenerateChronoFloor();
      expect(crossChatRegen.ok).toBe(false);
      expect(delMock).not.toHaveBeenCalled();

      parseState.chrono = {
        message_id: 3,
        chatId: 'chat-A',
        swipe_id: 0,
        swipeKey: makeSwipeScopedKey(3, 0),
        hash: hash3,
        at: new Date().toISOString(),
        verdicts: [
          {
            verdict: 'OVERRUN',
            overrunKind: 'time_conflict',
            item: '天启坦克',
            declaredQty: 1,
            physicalDoneQty: 0,
            remainingMinutes: 600,
          },
        ],
      };
      expect(await runParseFor(3)).toBe('skipped');
      expect(parseState.chrono).toBeNull();
    } finally {
      g.getChatMessages = saved.gcm;
      g.getVariables = saved.gv;
      g.updateVariablesWith = saved.uvw;
      g.getLastMessageId = saved.glmi;
      g.deleteChatMessages = saved.del;
      g.triggerSlash = saved.trig;
      g.SillyTavern = saved.st;
    }
  });

  it('同楼从 Swipe 0 切换到 Swipe 1 后，旧 Swipe 0 的特批与顺延均被拒绝且不篡改 Swipe 1', async () => {
    const g = globalThis as Globals;
    const saved = { gcm: g.getChatMessages, gv: g.getVariables, uvw: g.updateVariablesWith, st: g.SillyTavern };
    let currentSwipe = 0;
    const raw = '<战况>\n资金: 500\n</战况>';
    const uvwMock = vi.fn(async (updater: (v: Record<string, unknown>) => Record<string, unknown>) => updater({}));

    g.SillyTavern = { getCurrentChatId: () => 'chat-A' };
    g.getChatMessages = () => [{ role: 'assistant', is_hidden: false, message: raw, swipe_id: currentSwipe }];
    g.getVariables = (o: { type: string }) =>
      o.type === 'message'
        ? {
            stat_data: Schema.parse({
              queues: [
                {
                  type: '生产',
                  item: '犀牛坦克',
                  base: 'B1',
                  status: 'active',
                  total_minutes: 1000,
                  spent_minutes: 0,
                  progress: 0,
                  qty: 1,
                  qty_done: 0,
                },
              ],
            }),
          }
        : {};
    g.updateVariablesWith = uvwMock;

    try {
      const { autoAdvanceChrono, forceCommissionChrono, makeSwipeScopedKey, parseState } = await import(
        '../composables/useParse'
      );
      const stashSwipe0 = {
        message_id: 5,
        chatId: 'chat-A',
        swipe_id: 0,
        swipeKey: makeSwipeScopedKey(5, 0),
        hash: hashText(raw),
        at: new Date().toISOString(),
        verdicts: [
          {
            verdict: 'OVERRUN' as const,
            overrunKind: 'time_conflict' as const,
            item: '犀牛坦克',
            base: 'B1',
            declaredQty: 1,
            physicalDoneQty: 0,
            remainingMinutes: 600,
          },
        ],
      };

      // 切换到 Swipe 1 后执行特批与顺延，均因 Swipe 身份不匹配被拒绝
      currentSwipe = 1;
      parseState.chrono = { ...stashSwipe0 };
      const commRes = await forceCommissionChrono();
      expect(commRes.ok).toBe(false);
      expect(uvwMock).not.toHaveBeenCalled();
      expect(parseState.chrono).toBeNull();

      parseState.chrono = { ...stashSwipe0 };
      const advRes = await autoAdvanceChrono();
      expect(advRes.ok).toBe(false);
      expect(uvwMock).not.toHaveBeenCalled();
      expect(parseState.chrono).toBeNull();
    } finally {
      g.getChatMessages = saved.gcm;
      g.getVariables = saved.gv;
      g.updateVariablesWith = saved.uvw;
      g.SillyTavern = saved.st;
    }
  });
});

describe('G01-01 · runParseFor 串联 <排产计划>：拒绝/待批时不遗留队列或建筑占位，核准时唯一提交且新任务 spent_minutes=0', () => {
  type Globals = Record<string, unknown>;

  it('runParseFor 对余额不足的 delegate_once 建造计划返回 rejected 回执，且落盘 stat_data 的 queues、buildings、credits、nanites 零污染', async () => {
    deploySnapshotSlot.override = {
      researches: [],
      buildings: [
        {
          name: '磁能反应炉',
          cost: 600,
          days: 1,
          power: 150,
          category: '电力',
          need_buildings: ['苏联建造厂'],
        },
      ],
      productions: [],
      retrofits: [],
      projects: [],
      protocols: [],
      girls: [],
      factionDefs: [{ faction: '苏联', mcv: '苏联建造厂', lab: '作战实验室' }],
    } as unknown as import('../core/catalogEffective').EffectiveCatalog;

    const baseline = Schema.parse({
      command: { unlocked_factions: ['苏联'] },
      economy: { credits: 200, credits_daily: 0, resources: { nanites: { 标准纳米工料: 30 } } },
      bases: [
        {
          id: 'base_north',
          name: '北坡主基地',
          status: '警戒',
          buildings: [{ name: '苏联建造厂', state: '运转' }],
        },
      ],
      queues: [],
    });

    const raw = `<排产计划>
模式: 委托
请求号: req-g01-01-reject
预算上限: 2000
动作:
  - 操作: 入队
    类型: 建造
    项目: 磁能反应炉
    基地: 北坡主基地
    数量: 1
</排产计划>`;

    const g = globalThis as Globals;
    const saved = { gcm: g.getChatMessages, gv: g.getVariables, uvw: g.updateVariablesWith, st: g.SillyTavern };
    let chatVars: Record<string, unknown> = {};
    const uvwMock = vi.fn(
      async (
        updater: (v: Record<string, unknown>) => Record<string, unknown>,
        opts?: { type: string; message_id?: number },
      ) => {
        if (opts?.type === 'chat') {
          chatVars = updater(chatVars);
          return chatVars;
        }
        return updater({});
      },
    );
    g.getChatMessages = (id: number) =>
      id === 2
        ? [{ role: 'assistant', is_hidden: false, message: raw, swipe_id: 0 }]
        : [{ role: 'assistant', is_hidden: false, message: '<战况>\n</战况>', swipe_id: 0 }];
    g.getVariables = (o: { type: string; message_id?: number }) =>
      o.type === 'message' && o.message_id === 0 ? { stat_data: baseline } : o.type === 'chat' ? chatVars : {};
    g.updateVariablesWith = uvwMock;
    delete g.SillyTavern;

    try {
      const { runParseFor } = await import('../composables/useParse');
      expect(await runParseFor(2)).toBe('parsed');
      const msgWriteIdx = uvwMock.mock.calls.findIndex(
        c => (c[1] as { type?: string } | undefined)?.type === 'message',
      );
      const firstWrite = (await uvwMock.mock.results[msgWriteIdx].value) as {
        stat_data: import('../core/schema').StatData;
      };
      const stat = firstWrite.stat_data;
      expect(stat.planning.latest_receipt?.status).toBe('rejected');
      expect(stat.queues).toEqual([]);
      expect(stat.bases[0].buildings).toEqual([{ name: '苏联建造厂', layer: '', state: '运转' }]);
      expect(stat.economy.credits).toBe(200);
      expect(stat.economy.resources.nanites).toEqual({ 标准纳米工料: 30 });
    } finally {
      g.getChatMessages = saved.gcm;
      g.getVariables = saved.gv;
      g.updateVariablesWith = saved.uvw;
      g.SillyTavern = saved.st;
      deploySnapshotSlot.override = undefined;
    }
  });

  it('BUG-LIVE-02a/02b, 08, 10：awaiting_approval 研究不偷跑入队；获批排产/工程在 S4_BRIDGES 落盘即升格为 active；阵营解锁不洗白 vehicles 数组', async () => {
    deploySnapshotSlot.override = {
      buildings: [
        { name: '盟军建造厂', cost: 2500, power: -50, prereqs: [], need_buildings: [], desc: '' },
        { name: '兵营', cost: 500, power: 20, prereqs: [], need_buildings: ['盟军建造厂'], desc: '' },
      ],
      productions: [
        {
          name: '美国大兵',
          cost: 200,
          category: 'infantry',
          prereqs: [],
          need_buildings: ['兵营'],
          desc: '',
          workload: { days: 0.5, min_days: 0.25 },
        },
      ],
      researches: [
        {
          name: '战地急救学',
          line: '人员',
          tier: 1,
          cost: 500,
          prereqs: [],
          need_buildings: ['兵营'],
          desc: '',
          workload: { days: 1, min_days: 0.5 },
        },
      ],
      retrofits: [],
      projects: [],
      protocols: [],
      girls: [],
      factionDefs: [{ faction: '盟军', mcv: '盟军建造厂', lab: '战斗实验室' }],
    } as unknown as import('../core/catalogEffective').EffectiveCatalog;

    const baseline = Schema.parse({
      meta: { date: '1972-05-01', day_count: 1 },
      command: { unlocked_factions: ['盟军'] },
      bases: [
        {
          id: 'base_north',
          name: '北坡主基地',
          status: '隐蔽中',
          power: { gen: 250, use: 20 },
          buildings: [
            { name: '盟军建造厂', layer: '', state: '运转' },
            { name: '兵营', layer: '', state: '运转' },
          ],
        },
      ],
      forces: {
        troops: {},
        vehicles: ['MCV（苏联）', 'M2A3布拉德利步兵战车'],
      },
      economy: { credits: 2000 },
      queues: [],
    });

    // 1) 超预算降级为 awaiting_approval 时，研究项「战地急救学」绝不在 S1_PARSE 偷跑入队；且同楼 <阵营解锁> 不洗白 vehicles 数组
    const rawUnapproved = `<阵营解锁>
阵营: 苏联
解锁方式: 捕获苏联基地车
</阵营解锁>
<排产计划>
模式: 委托
请求号: req-bug-live-02-unapproved
基地: 北坡主基地
预算上限: 100
动作:
  - 操作: 入队
    类型: 研究
    项目: 战地急救学
    基地: 北坡主基地
</排产计划>`;

    // 2) 预算充足获批时，研究项与生产项在 S4_BRIDGES 落盘即经 0 分钟升格门转为 active（spent_minutes=0）
    const rawApproved = `<排产计划>
模式: 委托
请求号: req-bug-live-02-approved
基地: 北坡主基地
预算上限: 2000
动作:
  - 操作: 入队
    类型: 研究
    项目: 战地急救学
    基地: 北坡主基地
  - 操作: 入队
    类型: 生产
    项目: 美国大兵
    基地: 北坡主基地
    数量: 1
</排产计划>`;

    const g = globalThis as Globals;
    const saved = { gcm: g.getChatMessages, gv: g.getVariables, uvw: g.updateVariablesWith, st: g.SillyTavern };
    let chatVars: Record<string, unknown> = {};
    const msgStore: Record<number, Record<string, unknown>> = { 0: { stat_data: baseline } };
    const uvwMock = vi.fn(
      async (
        updater: (v: Record<string, unknown>) => Record<string, unknown>,
        opts?: { type: string; message_id?: number },
      ) => {
        if (opts?.type === 'chat') {
          chatVars = updater(chatVars);
          return chatVars;
        }
        const mid = opts?.message_id ?? 0;
        msgStore[mid] = updater(msgStore[mid] ?? {});
        return msgStore[mid];
      },
    );
    g.getChatMessages = (id: number) => {
      if (id === 10) return [{ role: 'assistant', is_hidden: false, message: rawUnapproved, swipe_id: 0 }];
      if (id === 11) return [{ role: 'assistant', is_hidden: false, message: rawApproved, swipe_id: 0 }];
      return [{ role: 'assistant', is_hidden: false, message: '<战况>\n</战况>', swipe_id: 0 }];
    };
    g.getVariables = (o: { type: string; message_id?: number }) =>
      o.type === 'message' ? (msgStore[o.message_id ?? 0] ?? {}) : o.type === 'chat' ? chatVars : {};
    g.updateVariablesWith = uvwMock;
    delete g.SillyTavern;

    try {
      const { runParseFor } = await import('../composables/useParse');
      expect(await runParseFor(10)).toBe('parsed');
      const stat1 = msgStore[10].stat_data as import('../core/schema').StatData;
      expect(stat1.planning.latest_receipt?.status).toBe('awaiting_approval');
      expect(stat1.queues).toEqual([]); // 研究项未偷跑入队
      expect(stat1.forces.vehicles).toEqual(['MCV（苏联）', 'M2A3布拉德利步兵战车']); // BUG-LIVE-08：载具数组完好保留

      expect(await runParseFor(11)).toBe('parsed');
      const stat2 = msgStore[11].stat_data as import('../core/schema').StatData;
      expect(stat2.planning.latest_receipt?.status).toBe('committed');
      expect(stat2.queues).toHaveLength(2);
      expect(stat2.queues.map(q => ({ item: q.item, status: q.status, spent: q.spent_minutes }))).toEqual([
        { item: '战地急救学', status: 'active', spent: 0 },
        { item: '美国大兵', status: 'active', spent: 0 },
      ]);
    } finally {
      g.getChatMessages = saved.gcm;
      g.getVariables = saved.gv;
      g.updateVariablesWith = saved.uvw;
      g.SillyTavern = saved.st;
      deploySnapshotSlot.override = undefined;
    }
  });
});
