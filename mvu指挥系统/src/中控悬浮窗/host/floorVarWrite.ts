/**
 * floorVarWrite.ts —— 中控台变量写入唯一定义点（D-RAC-FLOAT-READONLY-01 修订落地）
 *
 * 驾驶员裁决（2026-09-24）：
 * 授权修订 D-RAC-FLOAT-READONLY-01：中控可写 = 解析落盘（本楼 stat_data + 聊天 $parse，只经 useParse）
 * + 入档观察者的限定写（pending_lore / pending_expansions / codex）。
 * 发消息、triggerSlash、世界书结构写入照旧全禁。
 * 变量写入收口到单一文件 中控悬浮窗/floorVarWrite.ts，FloatingApp 只读守卫白名单改指向它。
 */
import { tav } from '../../红警指挥系统/parse/systemCheck';

export type VarUpdater = (vars: Record<string, unknown>) => Record<string, unknown>;

export async function updateFloorVars(messageId: number, updater: VarUpdater): Promise<void> {
  const uvw =
    tav<(u: VarUpdater, o: { type: 'message'; message_id: number }) => Promise<unknown>>('updateVariablesWith');
  if (!uvw) throw new Error('酒馆 API updateVariablesWith 不可用');
  await uvw(updater, { type: 'message', message_id: messageId });
}
