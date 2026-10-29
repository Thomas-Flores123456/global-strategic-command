/**
 * CTRL-UI-CHRONO-01 · 时序冲突横幅与 A′ 顺延接缝测试
 *
 * 覆盖：
 * ① settleFloor extraDeltaMinutes（A′ 顺延补票）：与三来源 Δt 相加、base=0 时单独生效、
 *    非法/缺席零行为变化、事件注记「驾驶员顺延」、clock 随总 Δt 推进；
 * ② ChronoMismatchBanner.vue 静态契约（PanelIntegrityCheck.test.ts 同模式 readSource 断言）：
 *    role=alert、三键＋忽略、A′ 推荐高亮绑定、不自建 eventOn、逃生舱 confirm 二次门、
 *    已验证 TH 原语（deleteChatMessages + /trigger）；
 * ③ FloatingApp.vue 集成点：挂载 + onRefresh 防陈旧安全网。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本，不进 bundle */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';
import { Schema } from '../红警指挥系统/core/schema';
import { settleFloor } from '../红警指挥系统/engines/settleFloor';
import type { TransactionItem } from '../红警指挥系统/engines/transactionEngine';

/* ═══════════════ 工具（对齐 settleFloor.test.ts 夹具惯例） ═══════════════ */

function mkTxn(partial: Partial<TransactionItem> & Pick<TransactionItem, 'type' | 'item'>): TransactionItem {
  return {
    base: '',
    progress: 0,
    eta: '',
    status: 'active',
    started_at: '',
    total_minutes: 0,
    spent_minutes: 0,
    qty: 1,
    qty_done: 0,
    cost_paid: true,
    min_days_lock: 0,
    hold: false,
    ...partial,
  };
}

function mkStat(overrides: Record<string, unknown> = {}) {
  return Schema.parse({
    meta: { world_id: 'cyber2042', date: '2042-03-14', day_count: 1, location: '锈蚀低壑' },
    ...overrides,
  });
}

/* ═══════════════ ① settleFloor extraDeltaMinutes（A′ 顺延补票） ═══════════════ */

describe('CTRL-UI-CHRONO-01 · settleFloor extraDeltaMinutes（A′ 顺延补票接缝）', () => {
  const prev = mkStat();
  const mkNext = () => mkStat({ queues: [mkTxn({ type: '生产', item: '犀牛主战坦克', total_minutes: 1000 })] });

  it('三来源 Δt ＋ 顺延相加：timePast 60 分 ＋ 顺延 120 分 → 总 180 分推进', () => {
    const r = settleFloor(prev, mkNext(), '<timePast>0 D 1 H 0 M</timePast>', { extraDeltaMinutes: 120 });
    expect(r.deltaMinutes).toBe(180);
    expect(r.deltaSource).toBe('timePast');
    expect(r.data.queues[0].spent_minutes).toBe(180);
    expect(r.data.queues[0].progress).toBe(18);
    expect(r.events[0].message).toContain('Δt=180 分钟');
    expect(r.events[0].message).toContain('驾驶员顺延120分');
  });

  it('base Δt=0（无标签同日期）时顺延单独生效，clock 照常推进', () => {
    const r = settleFloor(prev, mkNext(), '纯叙述无标签', { extraDeltaMinutes: 720 });
    expect(r.deltaMinutes).toBe(720);
    expect(r.deltaSource).toBe('none');
    expect(r.data.queues[0].spent_minutes).toBe(720);
    expect(r.data.clock).toBeDefined();
    expect(r.events[0].message).toContain('驾驶员顺延720分');
  });

  it('缺席/零/负/NaN → 零行为变化（不加注记、不推进）', () => {
    for (const extra of [undefined, 0, -100, Number.NaN]) {
      const r = settleFloor(prev, mkNext(), '纯叙述无标签', { extraDeltaMinutes: extra });
      expect(r.deltaMinutes).toBe(0);
      expect(r.data.queues[0].spent_minutes).toBe(0);
      expect(r.events[0].message).not.toContain('顺延');
    }
  });

  it('顺延使物理完工的事务走正常 settling 通道（铁律3：done 仍需对账门）', () => {
    const r = settleFloor(prev, mkNext(), '纯叙述无标签', { extraDeltaMinutes: 1200 });
    expect(r.data.queues[0].status).toBe('settling');
    expect(r.data.queues[0].progress).toBe(100);
    // 引擎语义钉死：settling 候审期间 qty_done 不由引擎回填（保持裁决前物理计数），
    // 认领回填是三色门 MATCH/UNDERRUN 的专属动作；spent 记录实际投入燃料（可超 total），progress 封顶 100
    expect(r.data.queues[0].qty_done).toBe(0);
    expect(r.data.queues[0].spent_minutes).toBe(1200);
  });

  it('顺延分钟数取整（小数分钟归整，与引擎 round 口径一致）', () => {
    const r = settleFloor(prev, mkNext(), '纯叙述无标签', { extraDeltaMinutes: 90.6 });
    expect(r.deltaMinutes).toBe(91);
  });

  it('BUG-LIVE-23a（#70楼 Swipe 1 实机复现）：仅含 <time_Anchor>... timePast:2 D</time_Anchor> 时 settleFloor 识别 Δt=2880 分钟（source=timePast）并推进队列至 settling', () => {
    const raw70 =
      '<正文>\n<time_Anchor>date:2078-01-29 time:20:00:00 time_zone:UTC-8 timePast:2 D</time_Anchor>\n2辆犀牛与10名动员兵列装完毕。\n</正文>';
    const r = settleFloor(prev, mkNext(), raw70);
    expect(r.deltaMinutes).toBe(2880);
    expect(r.deltaSource).toBe('timePast');
    expect(r.data.queues[0].status).toBe('settling');
    expect(r.data.queues[0].progress).toBe(100);
  });
});

/* ═══════════════ ② ChronoMismatchBanner.vue 静态契约 ═══════════════ */

const bannerSrc = readFileSync(join(__dirname, '../中控悬浮窗/console/ChronoMismatchBanner.vue'), 'utf8');

describe('CTRL-UI-CHRONO-01 · ChronoMismatchBanner.vue 静态契约', () => {
  it('可访问性：role=alert 战术警报语义 + aria-label', () => {
    expect(bannerSrc).toContain('role="alert"');
    expect(bannerSrc).toContain('aria-label="时序冲突战术警报"');
  });

  it('三键纠偏＋忽略四动作齐备（任务卡验收②）', () => {
    expect(bannerSrc).toContain('重新生成');
    expect(bannerSrc).toContain('自动顺延时间');
    expect(bannerSrc).toContain('强制特批入役');
    expect(bannerSrc).toContain('忽略');
  });

  it('A′ 增补：消费 autoAdvanceDeltaFor 与宽容档常量，推荐态高亮绑定', () => {
    expect(bannerSrc).toContain('autoAdvanceDeltaFor');
    expect(bannerSrc).toContain('AUTO_ADVANCE_TOLERANCE_MINUTES');
    expect(bannerSrc).toContain('chrono-btn--recommend');
    expect(bannerSrc).toContain('差距 ≤1 日带宽');
  });

  it('差异数据呈现（任务卡验收①）：overrunKind 五类标签 + 声明/物理/剩余差距行', () => {
    for (const kind of ['over_qty', 'time_conflict', 'not_started', 'no_txn', 'cancelled']) {
      expect(bannerSrc).toContain(`'${kind}'`);
    }
    expect(bannerSrc).toContain('declaredQty');
    expect(bannerSrc).toContain('physicalDoneQty');
    expect(bannerSrc).toContain('remainingMinutes');
  });

  it('消费 parseState.chrono + useParse 三动作；严禁自建 eventOn（跨端触发器红线）', () => {
    expect(bannerSrc).toContain('parseState');
    expect(bannerSrc).toContain('autoAdvanceChrono');
    expect(bannerSrc).toContain('forceCommissionChrono');
    expect(bannerSrc).toContain('dismissChrono');
    expect(bannerSrc).not.toContain('eventOn(');
    expect(bannerSrc).not.toContain('initParseRunner');
  });

  it('破坏性与逃生舱动作均有 confirm 二次门；写 API 收口宿主层（中控只读红线钉死）', () => {
    expect(bannerSrc.match(/window\.confirm\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(bannerSrc).toContain('regenerateChronoFloor');
    // 中控悬浮窗源码 0 命中写 API（FloatingApp.test.ts 守卫同口径，此处双保险）
    expect(bannerSrc).not.toContain('triggerSlash(');
    expect(bannerSrc).not.toContain('deleteChatMessages(');
    expect(bannerSrc).not.toContain('updateVariablesWith');
  });

  it('useParse 宿主层持有已验证 TH 原语（deleteChatMessages + /trigger）与撤回守卫', () => {
    const hostSrc = readFileSync(join(__dirname, '../红警指挥系统/composables/useParse.ts'), 'utf8');
    expect(hostSrc).toContain('regenerateChronoFloor');
    expect(hostSrc).toContain("tav<() => number>('getLastMessageId')");
    expect(hostSrc).toContain("'deleteChatMessages'");
    expect(hostSrc).toContain("trig('/trigger')");
    expect(hostSrc).toContain('不是最新楼');
  });

  it('状态不靠颜色单独传达：类型标签文字化 + 推荐态带文字提示行', () => {
    expect(bannerSrc).toContain('chrono-tag');
    expect(bannerSrc).toContain('chrono-banner__hint');
  });

  it('BUG-LIVE-23b：窄宽度防挤压排版契约（head/row 支持 flex-wrap，按钮与标签设置 flex-shrink: 0 + white-space: nowrap，diff 具备合理 flex-basis）', () => {
    expect(bannerSrc).toContain('flex-shrink: 0;');
    expect(bannerSrc).toContain('white-space: nowrap;');
    expect(bannerSrc).toContain('flex: 1 1 180px;');
  });
});

/* ═══════════════ ③ FloatingApp.vue 集成点 ═══════════════ */

const appSrc = readFileSync(join(__dirname, '../中控悬浮窗/console/FloatingApp.vue'), 'utf8');

describe('CTRL-UI-CHRONO-01 · FloatingApp.vue 集成契约', () => {
  it('横幅导入并挂载于展开态顶部（ConsoleTopNav 之下）', () => {
    expect(appSrc).toContain("import ChronoMismatchBanner from './ChronoMismatchBanner.vue';");
    expect(appSrc).toContain('<ChronoMismatchBanner />');
  });

  it('onRefresh 防陈旧安全网：落点楼号 ≠ 暂存楼号 → dismissChrono，并在卸载时注销', () => {
    expect(appSrc).toContain('floating.onRefresh');
    expect(appSrc).toContain('dismissChrono()');
    expect(appSrc).toContain('offChronoGuard?.()');
  });
});
