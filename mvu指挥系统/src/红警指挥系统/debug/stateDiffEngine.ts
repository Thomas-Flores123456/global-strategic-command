/**
 * stateDiffEngine.ts —— StatData 结构化路径 Diff 与字段反向溯源引擎（DBG41-02）
 *
 * 职责：
 * 1. diffStatData：利用不可变更新的结构共享特性，在每一层通过 Object.is O(1) 短路跳过未变更引用，
 *    产出精确到点分/下标路径的扁平化变更条目 FieldDiffEntry[] 及数值差值 numericDelta。
 * 2. traceFieldMutations：按路径关键词（不区分大小写）单遍检索楼层各阶段（优先下钻 S2a..S2i 子阶段）
 *    对目标字段的逐步修改轨迹。
 */

export interface FieldDiffEntry {
  /** 点分/下标路径，如 "economy.credits"、"queues[0].spent_minutes"、"bases[0].buildings[1].state" */
  path: string;
  /** 变更类型 */
  kind: 'added' | 'modified' | 'removed';
  /** 变更前值（精简可序列化标量或紧凑摘要，避免直接挂载巨型可变引用） */
  before: unknown;
  /** 变更后值 */
  after: unknown;
  /** 若前后均为有限数字（typeof === 'number' && Number.isFinite），直接给出差值 after - before（保留最多 4 位小数消除浮点毛刺，如 Math.round((after - before) * 10000) / 10000） */
  numericDelta?: number;
}

export interface StageLikeForTrace {
  stageId: string;
  stageLabel: string;
  diffs: readonly FieldDiffEntry[];
  substages?: readonly StageLikeForTrace[];
}

export interface StageFieldMutationHit {
  stageId: string;
  stageLabel: string;
  diffs: FieldDiffEntry[];
}

/**
 * 将记录到 Diff 条目中的值与外部可变状态/响应式代理脱离：
 * - 原始标量直接原样返回（零额外分配）；
 * - 数组或对象递归转为纯数据克隆，仅在发生新增/删除/非标量替换的子树上触发。
 */
function detachValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(detachValue);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v !== undefined && typeof v !== 'function') {
      out[k] = detachValue(v);
    }
  }
  return out;
}

function diffNode(
  before: unknown,
  after: unknown,
  prefix: string,
  out: FieldDiffEntry[],
): void {
  if (Object.is(before, after)) {
    return;
  }

  if (before === undefined) {
    out.push({
      path: prefix,
      kind: 'added',
      before: undefined,
      after: detachValue(after),
    });
    return;
  }

  if (after === undefined) {
    out.push({
      path: prefix,
      kind: 'removed',
      before: detachValue(before),
      after: undefined,
    });
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const maxLen = Math.max(before.length, after.length);
    for (let i = 0; i < maxLen; i += 1) {
      const itemPath = `${prefix}[${i}]`;
      if (i >= before.length) {
        out.push({
          path: itemPath,
          kind: 'added',
          before: undefined,
          after: detachValue(after[i]),
        });
      } else if (i >= after.length) {
        out.push({
          path: itemPath,
          kind: 'removed',
          before: detachValue(before[i]),
          after: undefined,
        });
      } else {
        diffNode(before[i], after[i], itemPath, out);
      }
    }
    return;
  }

  if (
    typeof before === 'object' &&
    before !== null &&
    !Array.isArray(before) &&
    typeof after === 'object' &&
    after !== null &&
    !Array.isArray(after)
  ) {
    const beforeObj = before as Record<string, unknown>;
    const afterObj = after as Record<string, unknown>;
    const keySet = new Set<string>(Object.keys(beforeObj));
    for (const key of Object.keys(afterObj)) {
      keySet.add(key);
    }
    const keys = Array.from(keySet).sort();
    for (const key of keys) {
      const nextPath = prefix ? `${prefix}.${key}` : key;
      diffNode(beforeObj[key], afterObj[key], nextPath, out);
    }
    return;
  }

  const entry: FieldDiffEntry = {
    path: prefix,
    kind: 'modified',
    before: detachValue(before),
    after: detachValue(after),
  };
  if (
    typeof before === 'number' &&
    typeof after === 'number' &&
    Number.isFinite(before) &&
    Number.isFinite(after)
  ) {
    entry.numericDelta = Math.round((after - before) * 10000) / 10000;
  }
  out.push(entry);
}

export function diffStatData(before: unknown, after: unknown): FieldDiffEntry[] {
  const out: FieldDiffEntry[] = [];
  diffNode(before, after, '', out);
  return out;
}

export function traceFieldMutations(
  traceOrStages: { stages: readonly StageLikeForTrace[] } | readonly StageLikeForTrace[],
  pathQuery: string,
): StageFieldMutationHit[] {
  const stages = 'stages' in traceOrStages ? traceOrStages.stages : traceOrStages;
  const q = pathQuery.trim().toLowerCase();
  const hits: StageFieldMutationHit[] = [];

  for (const stage of stages) {
    let substageHit = false;
    if (stage.substages && stage.substages.length > 0) {
      for (const sub of stage.substages) {
        const subDiffs = q
          ? sub.diffs.filter(d => d.path.toLowerCase().includes(q))
          : sub.diffs.slice();
        if (subDiffs.length > 0) {
          hits.push({
            stageId: sub.stageId,
            stageLabel: sub.stageLabel,
            diffs: subDiffs,
          });
          substageHit = true;
        }
      }
    }
    if (!substageHit) {
      const stageDiffs = q
        ? stage.diffs.filter(d => d.path.toLowerCase().includes(q))
        : stage.diffs.slice();
      if (stageDiffs.length > 0) {
        hits.push({
          stageId: stage.stageId,
          stageLabel: stage.stageLabel,
          diffs: stageDiffs,
        });
      }
    }
  }

  return hits;
}
