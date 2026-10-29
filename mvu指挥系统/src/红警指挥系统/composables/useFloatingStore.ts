/**
 * useFloatingStore.ts —— 悬浮窗专用响应式数据层（RAC-FLOAT-01，任务包 §3.9）
 *
 * 与楼层 UI 的 store.ts（defineMvuDataStore：单楼读写 + 写回）完全独立：
 * 本 store 只读——每次 refresh() 用 floorScanner 逆序扫描最近一个 Schema 合法的 AI 楼，
 * 把归一后的数据放进 snapshot；无有效楼 / reader 抛异常 → snapshot = null（UI 降级"无数据"）。
 *
 * 红线：
 * - 零变量写入（不调用 updateVariablesWith / replaceVariables / insertVariables）；
 * - 不直接 eventOn——四事件（GENERATION_ENDED / MESSAGE_SWIPED / MESSAGE_EDITED / CHAT_CHANGED）
 *   由入口层（RAC-ENTRY-01）接线后调用 refresh()，刷新完成通过 onRefresh(cb) 回调通知；
 * - 楼层读取走注入式 FloorReader：真机默认 tavernFloorReader（getChatMessages + getLastMessageId），
 *   测试 / 预览可通过 setReader() 或 refresh(reader) 替换。
 */
import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import { resolveScanStart, scanLatestValidFloor, type FloorCandidate, type FloorSnapshot } from '../parse/floorScanner';
import { SCHEMA_VERSION, type Schema } from '../core/schema';
import { hydrateZeroFloorFromBoot } from './useParseAuthority';

/** 楼层读取器：lastMessageId 允许异步（为未来异步源预留），readFloor 必须同步（扫描器约束） */
export interface FloorReader {
  lastMessageId(): number | Promise<number>;
  readFloor(id: number): FloorCandidate | null;
  /** 读取 chat 域 $boot.confirmed（true=已确认开局；false=未确认开局；null/缺省=无宿主变量环境） */
  readBootConfirmed?(): boolean | null;
}

/** 刷新完成回调：result 为本次扫描快照（无有效楼 / 异常时为 null） */
export type RefreshListener = (result: FloorSnapshot | null) => void;

/** 真机默认 reader：仅在被调用时才触碰酒馆助手全局，模块加载不依赖宿主 */
export const tavernFloorReader: FloorReader = {
  lastMessageId: () => getLastMessageId(),
  readFloor: id => {
    const msg = getChatMessages(id)[0];
    if (!msg) return null;
    let statData = msg.data?.stat_data;
    try {
      const gv = (
        globalThis as { getVariables?: (o: { type: string; message_id?: number }) => Record<string, unknown> }
      ).getVariables;
      if (typeof gv === 'function') {
        const fromVars = gv({ type: 'message', message_id: id })?.stat_data;
        if (fromVars !== undefined) statData = fromVars as typeof statData;
        if (id === 0) {
          const chatVars = gv({ type: 'chat' });
          const hydrated = hydrateZeroFloorFromBoot(statData, chatVars);
          if (hydrated.has_stat_data) {
            statData = hydrated.stat_data as typeof statData;
          }
        }
      }
    } catch {
      /* ignore */
    }
    return { role: msg.role, is_hidden: msg.is_hidden, stat_data: statData };
  },
  readBootConfirmed: () => {
    try {
      const gv = (
        globalThis as { getVariables?: (o: { type: string; message_id?: number }) => Record<string, unknown> }
      ).getVariables;
      if (typeof gv === 'function') {
        const chatVars = gv({ type: 'chat' });
        const rawBoot = chatVars?.['$boot'];
        if (typeof rawBoot === 'object' && rawBoot !== null && !Array.isArray(rawBoot)) {
          return (rawBoot as Record<string, unknown>).confirmed === true;
        }
        return false;
      }
    } catch {
      /* ignore */
    }
    return null;
  },
};

export const useFloatingStore = defineStore('mvu_data.floating', () => {
  /** 最近有效楼的 Schema 归一数据；null = 无数据 */
  const snapshot = shallowRef<Schema | null>(null);
  /** snapshot 的来源楼号；null = 无数据 */
  const floorId = ref<number | null>(null);
  /** 开局向导确认状态（true=已发射开局，false=仍在 #0 楼向导中，null=未显式指定） */
  const bootConfirmed = ref<boolean | null>(null);
  /** 刷新进行中 */
  const busy = ref(false);
  /** 最近一次刷新的异常信息；成功时清空 */
  const lastError = ref<string | null>(null);
  const schemaVersion = SCHEMA_VERSION;

  /**
   * 未开局锁死门控（Stage I3 · PRE-LAUNCH LOCKED）：
   * - 当处于 #0 楼（或尚未扫到有效高楼层）且开局向导未确认（bootConfirmed===false，或归零态无世界/无基地/无载具）时为 true；
   * - 一旦楼层推进至 >=1 楼、或 $boot.confirmed===true、或存档含有效战区/基地/载具，立即解锁为 false。
   */
  const isPreLaunchLocked = computed<boolean>(() => {
    const fId = floorId.value;
    if (fId !== null && fId > 0) return false;
    if (bootConfirmed.value === true) return false;
    if (bootConfirmed.value === false) return true;
    const snap = snapshot.value;
    if (!snap) return false;
    const hasWorld = Boolean(snap.meta?.world_id?.trim());
    const hasBases = (snap.bases?.length ?? 0) > 0;
    const hasVehicles = (snap.forces?.vehicles?.length ?? 0) > 0;
    return !hasWorld && !hasBases && !hasVehicles;
  });

  let activeReader: FloorReader = tavernFloorReader;
  let inflight: Promise<FloorSnapshot | null> | null = null;
  const listeners = new Set<RefreshListener>();

  /** 替换默认 reader（测试 / 预览注入） */
  function setReader(reader: FloorReader) {
    activeReader = reader;
  }

  /** 显式更新开局确认状态（供跨帧 postMessage `ra-boot-state-changed` 或单测直接同步） */
  function setBootConfirmed(confirmed: boolean | null) {
    bootConfirmed.value = confirmed;
  }

  /** 注册刷新完成回调；返回注销函数 */
  function onRefresh(cb: RefreshListener): () => void {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }

  function notify(result: FloorSnapshot | null) {
    for (const cb of listeners) {
      try {
        cb(result);
      } catch (e) {
        console.warn('[floating] onRefresh 回调异常', e);
      }
    }
  }

  async function scan(reader: FloorReader): Promise<FloorSnapshot | null> {
    let result: FloorSnapshot | null;
    try {
      const lastId = await reader.lastMessageId();
      result = scanLatestValidFloor(resolveScanStart('normal', lastId), id => reader.readFloor(id));
      lastError.value = null;
    } catch (e) {
      result = null;
      lastError.value = e instanceof Error ? e.message : String(e);
      console.warn('[floating] 刷新失败，snapshot 置空', e);
    }
    snapshot.value = result?.data ?? null;
    floorId.value = result?.floorId ?? null;
    try {
      if (typeof reader.readBootConfirmed === 'function') {
        const readFlag = reader.readBootConfirmed();
        if (readFlag !== null) {
          bootConfirmed.value = readFlag;
        }
      }
    } catch {
      /* ignore boot read errors */
    }
    return result;
  }

  /**
   * 手动 / 事件触发刷新。刷新进行中再次调用 → 复用同一次进行中的 Promise（不叠加、结果一致）。
   * @param reader 本次刷新使用的 reader；缺省用 setReader() 设定的或真机默认
   */
  function refresh(reader: FloorReader = activeReader): Promise<FloorSnapshot | null> {
    if (inflight) return inflight;
    busy.value = true;
    inflight = scan(reader).then(
      result => {
        inflight = null;
        busy.value = false;
        notify(result);
        return result;
      },
      // scan 内部已 catch 全部异常；此分支仅为防御，确保 busy 必定回落
      () => {
        inflight = null;
        busy.value = false;
        snapshot.value = null;
        floorId.value = null;
        notify(null);
        return null;
      },
    );
    return inflight;
  }

  return {
    snapshot,
    floorId,
    bootConfirmed,
    isPreLaunchLocked,
    busy,
    lastError,
    schemaVersion,
    refresh,
    setReader,
    setBootConfirmed,
    onRefresh,
  };
});
