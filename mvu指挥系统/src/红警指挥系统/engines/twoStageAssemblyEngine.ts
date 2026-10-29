/**
 * twoStageAssemblyEngine.ts —— 两阶段装配进度积分策略（CTRL-2STAGE-PROD-01）
 *
 * 真源：docs/design/systems/系统事务与时间推进总设计案.md §3.3/§4（事务地基）；
 *       docs/project/plans/中控台版本迭代任务包.md §3.8（两阶段生产法则·冻结公式）：
 *       T_total = T_mat×(1−Used/Req) + max(T_min, T_asm/(1+α·TFLOPS+β·TOPS))
 *
 * 冻结决策（驾驶员 2026-09-22 拍板，不得偏离）：
 * - Q1=B 阶段分界按 t_mat/(t_mat+t_asm) 比例；数据块缺声明退化 50/50
 *   （§3.8「100% 抵扣→从 50% 起跑」即 t_mat=t_asm 等分特例）；进度积分全程匀速无突变，
 *   抵扣的效果＝跳过阶段一对应的 spent_minutes 份额；
 * - Q2=A 纳米抵扣于升格 active 时一次判定：足额（库存≥req_nanites）全跳阶段一；
 *   不足按现有库存比例抵扣（一次扣完现有库存）；零负库存、零欠账（与 Null/0 状态机
 *   红线零摩擦；null 未探明视为 0 可用，不抵扣不报错）；
 * - Q3=B 双算力需求归一满足度：加速比 = 1 + w_f·min(可用F/需求F, CAP) + w_t·min(可用T/需求T, CAP)，
 *   研究/建造偏物理仿真 w=0.7/0.3，生产/改装偏张量控制 w=0.3/0.7；未声明需求恒 1；
 *   加速只作用于阶段二（配料是物质流，不吃算力）；
 * - Q4=A 算力池/纳米库存/装配数据块全部经回调注入（computeFor/nanitesFor/assemblyFor），
 *   default 恒零——不注入时无抵扣无加速；本模块零 import schema/operationEngine
 *   （对齐 transactionEngine 零依赖先例），工况效率与算力加速为两个正交乘子叠乘。
 *
 * min_days_lock 钳制（验收三 · 🔴）：双轨语义按事务类型分流——
 * - 生产/建造/改装：§3.8 冻结式 max(T_min, ·) 仅作用于阶段二项——
 *   阶段二墙钟耗时 ≥ min_days_lock×1440 分钟，乘子钳制为 min(raw, phase2Minutes/lockMinutes)；
 *   当阶段二标称工期本身短于锁值时乘子可 <1（「排热与微观自组织硬化」强制减速）。
 * - 研究（09 工期约定·驾驶员 2026-10-09 裁决 A）：workload.min_days 为「总工期地板」——
 *   算力可压缩阶段二，但总墙钟 ≥ lock；乘子上限 = phase2Minutes/(lockMinutes − phase1Minutes)，
 *   lock ≤ 阶段一标称时永不钳制，lock ≥ 总工期时自然封顶 1（不加速也不减速）。
 *   背景：97 块 workload 研究内容的 min_days 全部按总地板语义撰写（eta ≥ min_days 为校验红规），
 *   若套用阶段二地板会导致 86 块无算力也被强制减速、0 块能吃到加速（2026-10-09 全量盘点证据）。
 *
 * 🔴 红线：零 Pinia、零 Vue、零宿主 API；不原地修改入参；transactionEngine 的状态机
 * 白名单/结算四步/调度令四动词零改动——本模块仅经既有 options.effFor 接缝＋
 * 结算前后的纯函数处理接入（不新增引擎接缝）。
 *
 * 诚实边界（实现级离散化，测试与集成层须知）：
 * 1. 单楼 Δt 跨越阶段一/二边界时，整楼按「楼层起点所在阶段」的乘子积分（楼层粒度离散化）；
 * 2. 升格判定＝「spent_minutes=0 且 progress=0 的 active 事务」——若升格楼库存为 0 且
 *    后续楼 Δt=0（进度仍为零），库存到货后仍会补做一次抵扣（窗口仅存在于零进度期间，
 *    一旦有任何进度即永久关闭，不会重复扣账）；
 * 3. promoted 事件按 base+item 匹配——同 base 同名多条事务同楼升格时均会各自判定
 *    （applyNaniteDeduction 的零进度守卫防重复注入）。
 */

import type { SettleEvent, SettleOptions, TransactionItem } from './transactionEngine';
import { applyDispatchOrders, settleTransactions } from './transactionEngine';

/* ═══════════════ 类型定义 ═══════════════ */

/**
 * 两阶段装配数据块视图（对齐世界书 <数据> 块 assembly/workload 字段名；
 * 本模块不 import worldbookCatalogParser，保持零依赖）
 */
export interface TwoStageSpec {
  /** 阶段一（配料）标称耗时权重；与 t_asm 联合决定阶段分界比例（Q1=B） */
  t_mat?: number;
  /** 阶段二（组装）标称耗时权重 */
  t_asm?: number;
  /** 阶段一全跳所需纳米量；缺席或 ≤0 = 本条目不吃纳米抵扣 */
  req_nanites?: number;
  /** 阶段二 TFLOPS（双精度浮点·物理仿真）需求；缺席 = 不吃 TFLOPS 加速 */
  tflops?: number;
  /** 阶段二 TOPS（张量算力·控制灌装）需求；缺席 = 不吃 TOPS 加速 */
  tops?: number;
}

/** 基地可用算力预算（operationEngine effectiveVirtual.compute 形状，经回调注入） */
export interface ComputeBudget {
  tflops: number;
  tops: number;
}

/** 纳米扣减事件（Q2：引擎不写 economy.resources，上层凭此事件落账） */
export interface NanitesDeductedEvent {
  type: 'nanites_deducted';
  item: string;
  base: string;
  /** 实际扣减量 = min(可用库存, req_nanites)，🔴 永不为负 */
  amount: number;
  /** 阶段一被跳过的份额比例 = min(1, 可用/需求)，1=全跳 */
  skippedRatio: number;
  detail?: string;
}

/** 两段式结算事件流水 = 引擎原生事件 ∪ 纳米扣减事件 */
export type TwoStageEvent = SettleEvent | NanitesDeductedEvent;

/** 两段式结算选项：在 SettleOptions 之上增补三个回调（default 全恒零，不注入行为恒等） */
export interface TwoStageSettleOptions extends SettleOptions {
  /** 条目装配数据块查询（default 恒 undefined = 无 spec：50/50 分界、无抵扣、无加速） */
  assemblyFor?: (txn: TransactionItem) => TwoStageSpec | undefined;
  /** 基地纳米可用库存查询（default 恒 0；null=未探明视为 0，Q2） */
  nanitesFor?: (txn: TransactionItem) => number | null;
  /** 基地可用算力池查询（default 恒 {0,0}；集成层自 operationEngine effectiveVirtual 汇总） */
  computeFor?: (txn: TransactionItem) => ComputeBudget;
  /**
   * 严格纳米准入门（SIM-NANITE-01）：当 true 时，若候列 queued 排产项声明 req_nanites > 0
   * 且当前批内剩余可用纳米 remainingNanites < req_nanites，则保持 queued 等待后续补给，绝不透支升格。
   */
  strictNanitePromotionGate?: boolean;
}

export interface TwoStageSettleResult<S extends { queues: TransactionItem[] }> {
  next: S;
  events: TwoStageEvent[];
  /** 本批次累计消耗/抵扣的纳米总量（SIM-NANITE-01） */
  nanitesConsumed: number;
  /** 本批次递减扣减后的剩余纳米库存（SIM-NANITE-01） */
  remainingNanites: number;
}

/* ═══════════════ 冻结常量（Q3） ═══════════════ */

/** 游戏内一日分钟数（min_days_lock 天→分钟换算） */
export const MINUTES_PER_DAY = 1440;

/**
 * 满足度封顶（Q3）：可用/需求比值封顶为 1——需求满足即满速，超配不再无界加速。
 * 取舍：加速上界由权重和决定（1+w_f+w_t=2，即算力齐备最多倍速），把「无界加速」
 * 的防线交给确定性常量而非 min_days 单点兜底；min_days_lock 仍是最终物理硬下限。
 */
export const SATISFACTION_CAP = 1;

/** 研究/建造权重：偏物理仿真（TFLOPS 主导晶格自组织成型，§3.8） */
export const WEIGHT_SIMULATION = { tflops: 0.7, tops: 0.3 } as const;

/** 生产/改装权重：偏张量控制（TOPS 主导火控灌装与产线调度，§3.8） */
export const WEIGHT_TENSOR = { tflops: 0.3, tops: 0.7 } as const;

/** 未知事务类型的中性权重（v1 四类之外的防御性兜底，正常不触达） */
export const WEIGHT_NEUTRAL = { tflops: 0.5, tops: 0.5 } as const;

/** 按事务类型取双算力权重（Q3 冻结映射） */
export function weightsForType(type: string): { readonly tflops: number; readonly tops: number } {
  if (type === '研究' || type === '建造') return WEIGHT_SIMULATION;
  if (type === '生产' || type === '改装') return WEIGHT_TENSOR;
  // D25（驾驶员 2026-10-10 授权）：工程投影项沿用改装档——工程施工偏张量控制（灌装/调度语义同改装）
  if (type === '工程') return WEIGHT_TENSOR;
  return WEIGHT_NEUTRAL;
}

/* ═══════════════ 阶段分界（Q1=B） ═══════════════ */

/**
 * 阶段占比：phase1 = t_mat/(t_mat+t_asm)，phase2 = 其余；
 * spec 缺席、字段缺席、非法（负数/双零）一律退化 50/50。
 */
export function phaseSplit(spec?: TwoStageSpec): { phase1: number; phase2: number } {
  const tMat = spec?.t_mat;
  const tAsm = spec?.t_asm;
  if (
    typeof tMat === 'number' &&
    typeof tAsm === 'number' &&
    Number.isFinite(tMat) &&
    Number.isFinite(tAsm) &&
    tMat >= 0 &&
    tAsm >= 0 &&
    tMat + tAsm > 0
  ) {
    return { phase1: tMat / (tMat + tAsm), phase2: tAsm / (tMat + tAsm) };
  }
  return { phase1: 0.5, phase2: 0.5 };
}

/* ═══════════════ 双算力加速比（Q3=B） ═══════════════ */

/**
 * 未钳制加速比 = 1 + w_f·min(可用F/需求F, CAP) + w_t·min(可用T/需求T, CAP)。
 * 未声明需求（字段缺席或 ≤0）的轨不参与；两轨都未声明 → 恒 1（不吃算力加速）。
 */
export function rawSpeedup(type: string, spec: TwoStageSpec | undefined, budget: ComputeBudget): number {
  if (!spec) return 1;
  const w = weightsForType(type);
  let speedup = 1;
  if (typeof spec.tflops === 'number' && spec.tflops > 0) {
    speedup += w.tflops * Math.min(SATISFACTION_CAP, Math.max(0, budget.tflops) / spec.tflops);
  }
  if (typeof spec.tops === 'number' && spec.tops > 0) {
    speedup += w.tops * Math.min(SATISFACTION_CAP, Math.max(0, budget.tops) / spec.tops);
  }
  return speedup;
}

/**
 * 阶段二实效乘子（验收三 · 🔴 · 双轨语义）：
 * - 生产/建造/改装（§3.8 冻结式）：min(rawSpeedup, phase2Minutes/lockMinutes)——阶段二墙钟 ≥ lock；
 *   阶段二标称短于锁值时乘子 <1（强制减速）。
 * - 研究（09 工期约定）：lock 为总工期地板——min(rawSpeedup, phase2Minutes/(lockMinutes − phase1Minutes))；
 *   lock ≤ 阶段一标称或 lock=0、total_minutes≤0 时不钳制。
 */
export function phase2Multiplier(txn: TransactionItem, spec: TwoStageSpec | undefined, budget: ComputeBudget): number {
  const raw = rawSpeedup(txn.type, spec, budget);
  const lockMinutes = txn.min_days_lock > 0 ? txn.min_days_lock * MINUTES_PER_DAY : 0;
  if (lockMinutes <= 0 || txn.total_minutes <= 0) return raw;
  const { phase1, phase2 } = phaseSplit(spec);
  const phase2Minutes = txn.total_minutes * phase2;
  if (phase2Minutes <= 0) return raw;
  // 研究路径（09 工期约定）：min_days_lock = 总工期地板——总墙钟 ≥ lock
  // ⇔ 阶段二墙钟 ≥ lock − 阶段一标称；lock 不超过阶段一标称时地板天然满足，不钳制
  if (txn.type === '研究') {
    const roomMinutes = lockMinutes - txn.total_minutes * phase1;
    if (roomMinutes <= 0) return raw;
    return Math.min(raw, phase2Minutes / roomMinutes);
  }
  // 生产/建造/改装路径：§3.8 冻结式——阶段二墙钟 ≥ lock
  return Math.min(raw, phase2Minutes / lockMinutes);
}

/* ═══════════════ 纳米抵扣（Q2=A · 升格时一次判定） ═══════════════ */

export interface DeductionResult {
  /** 抵扣后的事务（未触发时原对象引用原样返回） */
  txn: TransactionItem;
  /** 扣减事件；未触发（无 spec/无需求/无库存/已有进度）时缺席 */
  event?: NanitesDeductedEvent;
}

/**
 * 对单条事务做一次纳米抵扣判定（纯函数，🔴 不写库存——扣减量凭事件由上层落账）：
 * - 仅零进度事务（spent_minutes=0 且 progress=0）可触发——一旦有进度永久关闭，防重复扣账；
 * - 足额 → skippedRatio=1，阶段一全额份额直接记入 spent_minutes（等效跳段起跑）；
 * - 不足 → skippedRatio=可用/需求，一次扣完现有库存，余下阶段一按剩余比例正常耗时；
 * - 可用库存 null（未探明）/≤0、req_nanites 缺席/≤0、total_minutes≤0 → 不触发不报错。
 */
export function applyNaniteDeduction(
  txn: TransactionItem,
  spec: TwoStageSpec | undefined,
  availableRaw: number | null | undefined,
): DeductionResult {
  const req = spec?.req_nanites;
  if (!spec || typeof req !== 'number' || !Number.isFinite(req) || req <= 0) return { txn };
  if (txn.total_minutes <= 0) return { txn };
  if (txn.spent_minutes !== 0 || txn.progress !== 0) return { txn };
  const available = typeof availableRaw === 'number' && Number.isFinite(availableRaw) ? Math.max(0, availableRaw) : 0;
  if (available <= 0) return { txn };

  const skippedRatio = Math.min(1, available / req);
  const amount = Math.min(available, req);
  const phase1Minutes = txn.total_minutes * phaseSplit(spec).phase1;
  const injected = phase1Minutes * skippedRatio;
  const stage1_remaining_hours = Math.max(0, (phase1Minutes - injected) / 60);
  void stage1_remaining_hours;
  const next: TransactionItem = {
    ...txn,
    spent_minutes: injected,
    progress: Math.min(100, (injected / txn.total_minutes) * 100),
    qty_done: 0,
  };
  return {
    txn: next,
    event: {
      type: 'nanites_deducted',
      item: txn.item,
      base: txn.base,
      amount,
      skippedRatio,
      detail: `纳米抵扣 ${amount}/${req}（跳过阶段一 ${Math.round(skippedRatio * 100)}% 份额，注入 ${injected} 分钟）`,
    },
  };
}

/* ═══════════════ effFor 组合器（经既有接缝喂入） ═══════════════ */

/**
 * 组合工况效率与阶段二算力加速为单一 effFor（喂给 settleTransactions 既有接缝）：
 * - 阶段一（spent < total×phase1Ratio）：仅基础工况 eff（配料不吃算力）；
 * - 阶段二：基础工况 eff × phase2Multiplier（含 min_days_lock 钳制）——两正交乘子叠乘；
 * - 不注入任何回调时对 min_days_lock=0 的事务恒等于基础 eff（行为恒等）。
 */
export function makeTwoStageEffFor(options: TwoStageSettleOptions = {}, deltaMinutes = 0): (txn: TransactionItem) => number {
  const baseEffFor = options.effFor ?? (() => 1);
  const assemblyFor = options.assemblyFor ?? (() => undefined);
  const computeFor = options.computeFor ?? (() => ({ tflops: 0, tops: 0 }));
  return txn => {
    const base = baseEffFor(txn);
    if (txn.total_minutes <= 0) return base;
    const spec = assemblyFor(txn);
    const phase1End = txn.total_minutes * phaseSplit(spec).phase1;
    if (txn.spent_minutes < phase1End) {
      if (deltaMinutes > 0 && base > 0) {
        const phase1Remain = phase1End - txn.spent_minutes;
        if (deltaMinutes * base > phase1Remain) {
          const p2 = phase2Multiplier(txn, spec, computeFor(txn));
          return (phase1Remain + (deltaMinutes * base - phase1Remain) * p2) / deltaMinutes;
        }
      }
      return base;
    }
    return base * phase2Multiplier(txn, spec, computeFor(txn));
  };
}

/* ═══════════════ 两段式结算主函数（对 settleTransactions 的策略包装） ═══════════════ */

/** promoted 事件与队列条目的匹配键（同引擎 laneKey 风格的 base+item 复合键） */
function promotedKey(base: string, item: string): string {
  return `${base}\u0000${item}`;
}

/**
 * settleWithTwoStage —— 在事务地基之上叠加两段式进度积分策略（纯函数）。
 *
 * 执行顺序：
 * ① 执行本楼调度，再对仍 active 且零进度的事务补做纳米抵扣判定
 *    （覆盖旧档/LLM 叙述立项 default active、未经升格门的事务——Q2「升格时」的等效时刻）；
 * ② 主结算：settleTransactions 执行 Δt 积分/settling/升格，不重放调度令，
 *    effFor 经 makeTwoStageEffFor 组合（工况 × 阶段二算力加速，含 min_days 钳制）；
 * ③ 后处理：本楼经带宽门新升格（promoted 事件）的事务在升格时刻做一次纳米抵扣
 *    （升格发生在积分之后，本楼不吃 Δt——注入份额即为下楼积分起点）。
 *
 * 🔴 不原地修改入参；不注入 assemblyFor/nanitesFor/computeFor 且事务无 min_days_lock 时，
 * next/events 与裸 settleTransactions 逐字段恒等。
 */
export function settleWithTwoStage<S extends { queues: TransactionItem[] }>(
  state: S,
  deltaMinutes: number,
  options: TwoStageSettleOptions = {},
): TwoStageSettleResult<S> {
  const assemblyFor = options.assemblyFor ?? (() => undefined);
  const nanitesFor = options.nanitesFor ?? (() => 0);
  const events: TwoStageEvent[] = [];

  // 本楼调度先且仅执行一次；预扣只消费调度后仍 active 的任务。
  const dispatch = applyDispatchOrders(state.queues, options.orders ?? [], options);
  for (const rej of dispatch.rejected) {
    events.push({
      type: 'dispatch_rejected', item: rej.order.item, base: rej.order.base ?? '', detail: rej.detail,
    });
  }
  for (const demotion of dispatch.demotions) {
    events.push({
      type: demotion.cause === 'preempt' ? 'preempted' : 'demoted',
      item: demotion.item, base: demotion.base,
      detail: `active 退回 queued（进度保留，cause=${demotion.cause}）`,
    });
  }

  // ① 预处理：调度后 active 零进度事务的抵扣判定
  let initialNanitesSnapshot = 0;
  let hasInitialSnapshot = false;
  const observeInitialNanites = (raw: number | null) => {
    if (!hasInitialSnapshot && typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      initialNanitesSnapshot = raw;
      hasInitialSnapshot = true;
    }
  };
  let deductedSoFar = 0;
  const naniteDeductedKeys = new Set<string>();
  const primedQueues = dispatch.next.map(txn => {
    if (txn.status !== 'active') return txn;
    const rawAvail = nanitesFor(txn);
    observeInitialNanites(rawAvail);
    const adjAvail =
      typeof rawAvail === 'number' && Number.isFinite(rawAvail) ? Math.max(0, rawAvail - deductedSoFar) : rawAvail;
    const result = applyNaniteDeduction(txn, assemblyFor(txn), adjAvail);
    if (result.event) {
      events.push(result.event);
      deductedSoFar += result.event.amount;
      naniteDeductedKeys.add(promotedKey(txn.base, txn.item));
    }
    return result.txn;
  });

  // SIM-NANITE-01：strictNanitePromotionGate 下，先按确定性队列顺序扫描 queued 排产项，
  // 若 remainingNanites < req_nanites 则挂起升格（保持 queued 不透支）。
  const blockedFromPromotionIndices = new Set<number>();
  if (options.strictNanitePromotionGate) {
    let previewDeducted = deductedSoFar;
    primedQueues.forEach((txn, idx) => {
      if (txn.status !== 'queued' || txn.hold) return;
      const spec = assemblyFor(txn);
      const req = spec && typeof spec.req_nanites === 'number' && spec.req_nanites > 0 ? spec.req_nanites : 0;
      if (req <= 0) return;
      const rawAvail = nanitesFor(txn);
      observeInitialNanites(rawAvail);
      const rem = typeof rawAvail === 'number' && Number.isFinite(rawAvail) ? Math.max(0, rawAvail - previewDeducted) : 0;
      if (rem < req) {
        blockedFromPromotionIndices.add(idx);
      } else {
        previewDeducted += req;
      }
    });
  }

  const queuesForSettle =
    blockedFromPromotionIndices.size > 0
      ? primedQueues.map((txn, idx) => (blockedFromPromotionIndices.has(idx) ? { ...txn, hold: true } : txn))
      : primedQueues;

  // ② 主结算（组合 effFor 经既有接缝喂入，引擎语义零改动）
  const settled = settleTransactions({ ...state, queues: queuesForSettle }, deltaMinutes, {
    ...options,
    orders: [], // 已在预扣前执行，不重放调度令。
    effFor: makeTwoStageEffFor(options, deltaMinutes),
  });

  // 还原因纳米不足临时阻断升格的 hold 标记（保持原始 hold: false 与 status: 'queued'）
  const unblockedQueues =
    blockedFromPromotionIndices.size > 0
      ? settled.next.queues.map((txn, idx) =>
          blockedFromPromotionIndices.has(idx) ? { ...txn, hold: dispatch.next[idx].hold, status: 'queued' as const } : txn,
        )
      : settled.next.queues;

  // 修正两阶段带纳米配料批次（qty > 1 且声明 req_nanites > 0）的已完成台数 qty_done：
  // 阶段一备料期（spent_minutes <= phase1End）仅缩短备料工时，不产出已完成实车（qty_done = 0）；
  // 阶段二组装期按阶段二已推进工时占阶段二总工时比例折算下线台数（FIX-P1-01）。
  // 同时按结算扫描顺序记录每个产生裸 qty_progress 的任务在修正后的真实下线变化（G01-04：绝不用 base+item.find 串读同名其他批次）。
  const correctedQtyProgressDetails: Array<string | null> = [];
  const correctedQueues = unblockedQueues.map((txn, idx) => {
    const prevTxn = queuesForSettle[idx];
    const bareEmitted =
      (prevTxn.status === 'active' || txn.status === 'active' || txn.status === 'settling') &&
      prevTxn.total_minutes > 0 &&
      deltaMinutes > 0 &&
      txn.qty > 1 &&
      txn.qty_done !== prevTxn.qty_done;
    if (txn.qty <= 1 || txn.total_minutes <= 0) {
      if (bareEmitted) correctedQtyProgressDetails.push(`批次流水 ${txn.qty_done}/${txn.qty}`);
      return txn;
    }
    const spec = assemblyFor(txn);
    if (!spec || typeof spec.req_nanites !== 'number' || spec.req_nanites <= 0) {
      if (bareEmitted) correctedQtyProgressDetails.push(`批次流水 ${txn.qty_done}/${txn.qty}`);
      return txn;
    }
    const { phase1, phase2 } = phaseSplit(spec);
    const phase1End = txn.total_minutes * phase1;
    const phase2Minutes = txn.total_minutes * phase2;
    const asmSpent = Math.max(0, txn.spent_minutes - phase1End);
    const doneNow =
      phase2Minutes > 0
        ? Math.min(txn.qty, Math.floor((asmSpent / (phase2Minutes / txn.qty)) + 1e-9))
        : txn.qty;
    const finalDone = Math.max(prevTxn.qty_done, doneNow);
    if (bareEmitted) {
      correctedQtyProgressDetails.push(finalDone !== prevTxn.qty_done ? `批次流水 ${finalDone}/${txn.qty}` : null);
    }
    if (finalDone === txn.qty_done) return txn;
    return { ...txn, qty_done: finalDone };
  });

  let qtyProgressCursor = 0;
  for (const ev of settled.events) {
    if (ev.type === 'qty_progress') {
      const detail = correctedQtyProgressDetails[qtyProgressCursor++];
      if (detail !== null) {
        events.push({ ...ev, detail });
      }
      continue;
    }
    events.push(ev);
  }

  // ③ 后处理：本楼 promoted 事务的升格时刻抵扣
  const promoted = new Set(
    settled.events.filter(event => event.type === 'promoted').map(event => promotedKey(event.base, event.item)),
  );
  let queues = correctedQueues;
  if (promoted.size > 0) {
    queues = queues.map(txn => {
      if (txn.status !== 'active' || !promoted.has(promotedKey(txn.base, txn.item))) return txn;
      const rawAvail = nanitesFor(txn);
      observeInitialNanites(rawAvail);
      const adjAvail =
        typeof rawAvail === 'number' && Number.isFinite(rawAvail) ? Math.max(0, rawAvail - deductedSoFar) : rawAvail;
      const result = applyNaniteDeduction(txn, assemblyFor(txn), adjAvail);
      if (result.event) {
        events.push(result.event);
        deductedSoFar += result.event.amount;
      }
      return result.txn;
    });
  }

  if (!hasInitialSnapshot && state.queues.length > 0) {
    observeInitialNanites(nanitesFor(state.queues[0]));
  }
  const remainingNanites = Math.max(0, initialNanitesSnapshot - deductedSoFar);

  return {
    next: { ...settled.next, queues },
    events,
    nanitesConsumed: deductedSoFar,
    remainingNanites,
  };
}

/**
 * 批内递减游标驱动的两阶段生产推进包装函数（SIM-NANITE-01）：
 * 默认开启 `strictNanitePromotionGate: true`，当 `remainingNanites < req_nanites` 时
 * 保持 `queued` 等待后续补给（绝不透支库存），并按确定性顺序递减 `remainingNanites`。
 */
export function advanceTwoStageProduction<S extends { queues: TransactionItem[] }>(
  state: S,
  deltaMinutes: number,
  options: TwoStageSettleOptions = {},
): TwoStageSettleResult<S> {
  return settleWithTwoStage(state, deltaMinutes, {
    strictNanitePromotionGate: true,
    ...options,
  });
}
