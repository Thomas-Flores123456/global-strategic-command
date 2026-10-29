/**
 * queueDisplayModel.ts —— 队列五态展示模型（CTRL-UI-QUEUE-01 · Phase 8.5 止血第一枪）
 *
 * 真源与纪律：
 * - 只读消费 QueueItem v2（status/started_at/spent_minutes/total_minutes/eta/hold/qty/qty_done），零写路径；
 * - 谓语文案同源：进度/批次/排队/待收讫句式一律经 scheduleText.predicateFor（SCHEDULE_COPY 冻结稿），
 *   本模块不另立谓语体系；展示侧短标集中于 QUEUE_DISPLAY_COPY（对齐 scheduleCopy 集中管理先例）；
 * - 产线名同源：laneName 由调用方经 productionLanes（laneDefFromKey/makeProdLaneKeyFor）供给，
 *   本模块不自建分类；
 * - 面板为静态快照口径：eff 恒 1（基础工期投影），不读实时工况——「尚需 T」＝(total−spent) 基础分钟。
 */
import { SCHEDULE_COPY, SCHEDULE_QUEUED_VERB } from '../../红警指挥系统/planning/scheduleCopy';
import { predicateFor } from '../../红警指挥系统/planning/scheduleText';
import type { QueueItem } from '../../红警指挥系统/core/schema';
import type { TransactionItem } from '../../红警指挥系统/engines/transactionEngine';

/** 五态＋hold 子态色调键（组件映射到 global.css 既有主题变量：--warn/--ice/--t-low/--t-faint/--ok/--bad） */
export type QueueTone = 'run' | 'idle' | 'hold' | 'ready' | 'ok' | 'dead';

/** 展示侧短标文案集（谓语长句一律走 SCHEDULE_COPY，此处仅卡片徽标/提示级短文案） */
export const QUEUE_DISPLAY_COPY = {
  /** 在制徽标动词（与 SCHEDULE_QUEUED_VERB 待产/待研/待建/待改 镜像） */
  activeVerb: { 生产: '在产', 研究: '在研', 建造: '在建', 改装: '在改' } as Readonly<Record<string, string>>,
  activeFallback: '在制',
  /** 暂缓徽标前缀（谓语尾「；奉令暂缓」由 SCHEDULE_COPY.holdSuffix 供给） */
  holdBadgePrefix: '暂缓·',
  /** settling 短标；悬停/点击提示用 SCHEDULE_COPY.settling 原文（同源一档力度） */
  settlingBadge: '待收讫',
  doneBadge: '已完成',
  cancelledBadge: '已取消',
  /** tooltip 行标签 */
  tipLane: '产线',
  tipStartedAt: '开工',
  tipEta: '时限',
} as const;

export interface QueueDisplayModel {
  /** 引擎五态原值（queued/active/settling/done/cancelled；非法值按 queued 兜底展示） */
  status: QueueItem['status'];
  /** 卡片徽标短文案（五态可区分；hold 加「暂缓·」前缀） */
  badge: string;
  /** 色调键（组件 → CSS 类后缀） */
  tone: QueueTone;
  /** 进度光条百分比（钳制 [0,100]；done 恒 100） */
  progress: number;
  /** 是否播放在建脉冲动画（仅 active；done/cancelled 不再顶着在建动画） */
  pulsing: boolean;
  /** 状态谓语长句（与《当前工程日程》同源：进度X%；尚需T／已下线n/N台；节拍t／待收讫冻结档） */
  predicate: string;
  /** settling 悬停提示（SCHEDULE_COPY.settling 原文；非 settling 为 undefined） */
  settlingHint?: string;
  /** v2 展示缓存直呈（有值才给）：开工时刻 / 时限缓存 / 产线显示名 */
  startedAt?: string;
  eta?: string;
  laneName?: string;
}

const KNOWN_STATUS = new Set(['queued', 'active', 'settling', 'done', 'cancelled']);

/**
 * QueueItem v2 → 五态展示模型（纯函数）。
 * prevInLane 面板场景不可得（单卡片视图），排队谓语取「已立项待X」无「列于」段——与日程口径同函数同文案。
 */
export function queueDisplayModel(q: QueueItem, opts: { laneName?: string } = {}): QueueDisplayModel {
  const status = (KNOWN_STATUS.has(q.status) ? q.status : 'queued') as QueueItem['status'];
  const progress = status === 'done' ? 100 : Math.min(100, Math.max(0, Math.round(q.progress)));
  const predicate = predicateFor(q as unknown as TransactionItem, undefined, () => 1);

  let badge: string;
  let tone: QueueTone;
  switch (status) {
    case 'active': {
      badge = QUEUE_DISPLAY_COPY.activeVerb[q.type] ?? QUEUE_DISPLAY_COPY.activeFallback;
      tone = 'run';
      break;
    }
    case 'settling': {
      badge = QUEUE_DISPLAY_COPY.settlingBadge;
      tone = 'ready';
      break;
    }
    case 'done': {
      badge = QUEUE_DISPLAY_COPY.doneBadge;
      tone = 'ok';
      break;
    }
    case 'cancelled': {
      badge = QUEUE_DISPLAY_COPY.cancelledBadge;
      tone = 'dead';
      break;
    }
    default: {
      const verb = SCHEDULE_QUEUED_VERB[q.type] ?? '待办';
      badge = q.hold ? `${QUEUE_DISPLAY_COPY.holdBadgePrefix}${verb}` : verb;
      tone = q.hold ? 'hold' : 'idle';
      break;
    }
  }

  return {
    status,
    badge,
    tone,
    progress,
    pulsing: status === 'active',
    predicate,
    settlingHint: status === 'settling' ? SCHEDULE_COPY.settling : undefined,
    startedAt: q.started_at || undefined,
    eta: q.eta || undefined,
    laneName: opts.laneName,
  };
}
