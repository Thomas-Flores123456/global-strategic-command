/**
 * floorScanner.ts —— 最近有效楼 Schema 校验扫描器（长驻脚本共享层，RAC-SCAN-01）
 *
 * 与 useParse.ts 的 scanBaseline() 相互独立：后者只检查 stat_data 存在性；
 * 本扫描器逐楼执行 migrateV1toV2 → Schema.safeParse，损坏楼跳过继续向前，
 * 首个合法者作为快照返回；全部失败 → null（fail-closed）。
 *
 * 纯函数、reader 注入式：零 IO、零酒馆 API、零 vue/pinia 依赖。
 * 读取楼层（getChatMessages 等）与生成类型判断属于调用方（RAC-ADV-01 / RAC-FLOAT-01）。
 */
import { migrateV1toV2, Schema, SCHEMA_VERSION } from '../core/schema';

/** 单楼候选视图（由注入的 reader 提供） */
export interface FloorCandidate {
  role: 'user' | 'assistant' | 'system';
  is_hidden: boolean;
  /** 本楼 message 变量中的 stat_data；无则 undefined / null */
  stat_data: unknown;
}

/** 扫描结果快照：含来源楼号与 schema 版本，供 advisory 输出溯源 */
export interface FloorSnapshot {
  floorId: number;
  schemaVersion: typeof SCHEMA_VERSION;
  /** Schema.safeParse 归一产物（已迁移、已补默认值） */
  data: Schema;
}

/**
 * FD-45：前后两楼双快照视图（current 为最新有效楼 #N，previous 为 #N 之前的上一有效楼 #N-1；无前序有效楼时 previous 为 null）
 */
export interface FloorSnapshotPair {
  current: FloorSnapshot;
  previous: FloorSnapshot | null;
}

/** 核心生成入口（quiet / dry_run / impersonate / Helper 自定义 generate 的 fail-closed 由调用方判断） */
export type GenerationEntry = 'normal' | 'actionbar' | 'regenerate' | 'swipe' | 'continue';

/**
 * 按生成入口计算逆序扫描起点（任务包 §3.4 矩阵）。输入为事件时刻的 lastMessageId。
 * - normal / actionbar / continue：含末尾楼 → lastMessageId（actionbar 的 user 楼由跳过规则自然排除）
 * - regenerate / swipe：排除当前末尾目标 assistant → lastMessageId - 1
 * 空聊天或非法输入 → -1（扫描器直接返回 null）。
 */
export function resolveScanStart(entry: GenerationEntry, lastMessageId: number): number {
  if (!Number.isInteger(lastMessageId) || lastMessageId < 0) return -1;
  return entry === 'regenerate' || entry === 'swipe' ? lastMessageId - 1 : lastMessageId;
}

/**
 * 从 startId 楼逆序扫到 0 楼，返回首个通过 Schema 校验的 AI 楼快照。
 * 跳过：user 楼 / 隐藏楼 / 无 stat_data 楼 / reader 返回 null 或抛异常的楼 / 迁移后仍不合法的楼。
 */
export function scanLatestValidFloor(
  startId: number,
  readFloor: (id: number) => FloorCandidate | null,
): FloorSnapshot | null {
  if (!Number.isInteger(startId)) return null;
  for (let i = startId; i >= 0; i--) {
    let floor: FloorCandidate | null;
    try {
      floor = readFloor(i);
    } catch {
      continue;
    }
    if (!floor || floor.role === 'user' || floor.is_hidden) continue;
    if (floor.stat_data === undefined || floor.stat_data === null) continue;

    const parsed = Schema.safeParse(migrateV1toV2(floor.stat_data));
    if (!parsed.success) continue;
    return { floorId: i, schemaVersion: SCHEMA_VERSION, data: parsed.data };
  }
  return null;
}

/**
 * FD-45：从 startId 楼逆序扫描最新有效楼 `current`（#N），并继续从 `N - 1` 逆序扫描上一有效楼 `previous`（#N-1）。
 * - 若连最新有效楼都不存在，返回 null；
 * - 若最新有效楼为 #0 或其前方无合法 AI 楼，则 `previous` 为 null。
 */
export function scanLatestFloorPair(
  startId: number,
  readFloor: (id: number) => FloorCandidate | null,
): FloorSnapshotPair | null {
  const current = scanLatestValidFloor(startId, readFloor);
  if (!current) return null;
  const previous =
    current.floorId > 0 ? scanLatestValidFloor(current.floorId - 1, readFloor) : null;
  return { current, previous };
}

