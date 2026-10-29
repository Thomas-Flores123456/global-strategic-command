/**
 * $boot 状态机 · 纯函数层（可 vitest，零宿主依赖）
 *
 * $boot 是 chat 域 `$` 前缀变量：AI 不可见（酒馆助手宏忽略 $ 开头键）、
 * 不在 stat_data 内故不受 schema 轮询归一化剥除。
 *
 * 写入惯例（批 B 血泪，与 $parse 相同）：
 *  - 一律 `await updateVariablesWith(v => _.set(v, '$boot', next), { type: 'chat' })`
 *  - 严禁对 $boot 内使用 lodash 数字字符串路径直写（会把容器创建成稀疏数组）
 */

export interface BootState {
  /** 是否已确认开局（true 后启动器永不再进向导） */
  confirmed: boolean;
  /** 难度档位 'easy' | 'normal' | 'hard' | 'custom'（F 阶段填充） */
  preset?: string;
  /** 用户选择快照（资金/科技/地点/日期/阵营/叙事基调等，F 阶段填充） */
  choices?: Record<string, unknown>;
  /** 应用的 persona 名称或 id（F 阶段填充） */
  personaId?: string | null;
  /** 导入源标识（G 阶段填充） */
  importedFrom?: string | null;
  /** 确认时间戳 ISO */
  confirmedAt?: string;
}

/** 归零 BootState（未开局） */
export function emptyBoot(): BootState {
  return { confirmed: false };
}

/**
 * 从 chat 域变量根对象安全提取并归一化 $boot。
 * 任何损坏形态（数组/字符串/null/缺失）一律落回未开局空壳——
 * 启动器宁可多显示一次向导，也不能因脏数据把玩家锁在向导外。
 */
export function readBootFrom(chatVars: unknown): BootState {
  if (typeof chatVars !== 'object' || chatVars === null) return emptyBoot();
  const raw = (chatVars as Record<string, unknown>)['$boot'];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return emptyBoot();
  const r = raw as Record<string, unknown>;
  const out: BootState = { confirmed: r.confirmed === true };
  if (typeof r.preset === 'string') out.preset = r.preset;
  if (typeof r.choices === 'object' && r.choices !== null && !Array.isArray(r.choices)) {
    out.choices = r.choices as Record<string, unknown>;
  }
  if (typeof r.personaId === 'string') out.personaId = r.personaId;
  if (typeof r.importedFrom === 'string') out.importedFrom = r.importedFrom;
  if (typeof r.confirmedAt === 'string') out.confirmedAt = r.confirmedAt;
  return out;
}

/** 生成"已确认"的下一状态（不可变，供写入方 _.set 整棵落盘） */
export function confirmBoot(prev: BootState, patch?: Partial<BootState>): BootState {
  return {
    ...prev,
    ...patch,
    confirmed: true,
    confirmedAt: new Date().toISOString(),
  };
}
