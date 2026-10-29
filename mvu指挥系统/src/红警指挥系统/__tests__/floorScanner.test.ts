/**
 * floorScanner 纯函数测试（RAC-SCAN-01）：起点矩阵 + 逆序 Schema 校验扫描。
 * 楼层读取（getChatMessages）属真机边界，此处全部用注入 reader 模拟。
 */
import { describe, expect, it } from 'vitest';
import {
  resolveScanStart,
  scanLatestFloorPair,
  scanLatestValidFloor,
  type FloorCandidate,
} from '../parse/floorScanner';
import { SCHEMA_VERSION } from '../core/schema';

const ai = (stat_data: unknown, is_hidden = false): FloorCandidate => ({ role: 'assistant', stat_data, is_hidden });
const user = (stat_data?: unknown): FloorCandidate => ({ role: 'user', stat_data, is_hidden: false });

const validV2 = (location: string) => ({ schema_version: 2, meta: { location } });
/** morale.value 超出 [0,10] → Schema 拒收 */
const broken = { schema_version: 2, morale: { value: 99 } };

function readerOf(floors: (FloorCandidate | null)[]) {
  return (id: number) => floors[id] ?? null;
}

describe('resolveScanStart（生成入口→起点矩阵 §3.4）', () => {
  it('normal / actionbar / continue 含末尾楼：起点 = lastMessageId', () => {
    expect(resolveScanStart('normal', 7)).toBe(7);
    expect(resolveScanStart('actionbar', 7)).toBe(7);
    expect(resolveScanStart('continue', 7)).toBe(7);
  });
  it('regenerate / swipe 排除末尾目标楼：起点 = lastMessageId - 1', () => {
    expect(resolveScanStart('regenerate', 7)).toBe(6);
    expect(resolveScanStart('swipe', 7)).toBe(6);
    expect(resolveScanStart('swipe', 0)).toBe(-1);
  });
  it('空聊天 / 非法 lastMessageId → -1', () => {
    expect(resolveScanStart('normal', -1)).toBe(-1);
    expect(resolveScanStart('normal', Number.NaN)).toBe(-1);
    expect(resolveScanStart('normal', 2.5)).toBe(-1);
  });
});

describe('scanLatestValidFloor（逆序 Schema 校验扫描 §3.6）', () => {
  it('最近楼合法 → 直接返回该楼，带 floorId 与 schemaVersion', () => {
    const snap = scanLatestValidFloor(2, readerOf([user(), ai(validV2('A')), ai(validV2('B'))]));
    expect(snap).not.toBeNull();
    expect(snap!.floorId).toBe(2);
    expect(snap!.schemaVersion).toBe(SCHEMA_VERSION);
    expect(snap!.data.meta.location).toBe('B');
    expect(snap!.data.schema_version).toBe(2);
  });

  it('最近楼损坏、次近楼合法 → 跳过损坏楼返回次近', () => {
    const snap = scanLatestValidFloor(2, readerOf([user(), ai(validV2('A')), ai(broken)]));
    expect(snap?.floorId).toBe(1);
    expect(snap?.data.meta.location).toBe('A');
  });

  it('全部损坏 → null（fail-closed）', () => {
    expect(scanLatestValidFloor(2, readerOf([ai(broken), ai('not-an-object'), ai(broken)]))).toBeNull();
  });

  it('无 stat_data（undefined / null）→ null', () => {
    expect(scanLatestValidFloor(1, readerOf([ai(undefined), ai(null)]))).toBeNull();
  });

  it('v1 旧档迁移后合法：world_id 补 xiuzhen、钱袋转中文键、schema_version 升 2', () => {
    const v1 = { schema_version: 1, meta: { date: '三月初一' }, economy: { wallet: { copper: 12, silver: 3 } } };
    const snap = scanLatestValidFloor(0, readerOf([ai(v1)]));
    expect(snap?.floorId).toBe(0);
    expect(snap?.data.schema_version).toBe(2);
    expect(snap?.data.meta.world_id).toBe('xiuzhen');
    expect(snap?.data.meta.date).toBe('三月初一');
    expect(snap?.data.economy.wallet['铜钱']).toBe(12);
    expect(snap?.data.economy.wallet['银两']).toBe(3);
  });

  it('未来版本 schema_version 拒收，不静默降级', () => {
    const future = { schema_version: 3, meta: { location: 'X' } };
    expect(scanLatestValidFloor(0, readerOf([ai(future)]))).toBeNull();
    // 前一楼合法时越过未来版本楼取前一楼
    expect(scanLatestValidFloor(1, readerOf([ai(validV2('A')), ai(future)]))?.floorId).toBe(0);
  });

  it('user 楼跳过（即使携带合法 stat_data，actionbar 场景）', () => {
    const snap = scanLatestValidFloor(2, readerOf([ai(validV2('A')), ai(validV2('B')), user(validV2('U'))]));
    expect(snap?.floorId).toBe(1);
    expect(snap?.data.meta.location).toBe('B');
  });

  it('隐藏楼跳过', () => {
    const snap = scanLatestValidFloor(1, readerOf([ai(validV2('A')), ai(validV2('H'), true)]));
    expect(snap?.floorId).toBe(0);
  });

  it('reader 返回 null 或抛异常的楼跳过', () => {
    const floors = [ai(validV2('A')), null, ai(validV2('C'))];
    const throwing = (id: number) => {
      if (id === 2) throw new Error('read failure');
      return floors[id] ?? null;
    };
    expect(scanLatestValidFloor(2, throwing)?.floorId).toBe(0);
  });

  it('起点为 -1 / 非整数 → null，不调用 reader', () => {
    let calls = 0;
    const counting = () => {
      calls++;
      return ai(validV2('A'));
    };
    expect(scanLatestValidFloor(-1, counting)).toBeNull();
    expect(scanLatestValidFloor(Number.NaN, counting)).toBeNull();
    expect(calls).toBe(0);
  });

  it('与起点函数联用：regenerate 排除末尾目标楼', () => {
    const floors = [user(), ai(validV2('old')), user(), ai(validV2('target'))];
    const start = resolveScanStart('regenerate', 3);
    expect(scanLatestValidFloor(start, readerOf(floors))?.data.meta.location).toBe('old');
    expect(scanLatestValidFloor(resolveScanStart('continue', 3), readerOf(floors))?.data.meta.location).toBe('target');
  });
});

describe('scanLatestFloorPair（FD-45 · 前后两楼双快照扫描 §2.1）', () => {
  it('存在 #N 与 #N-1 两层有效楼 → 同时返回 current 与 previous', () => {
    const floors = [ai(validV2('F0')), ai(validV2('F1')), ai(validV2('F2'))];
    const pair = scanLatestFloorPair(2, readerOf(floors));
    expect(pair).not.toBeNull();
    expect(pair!.current.floorId).toBe(2);
    expect(pair!.current.data.meta.location).toBe('F2');
    expect(pair!.previous).not.toBeNull();
    expect(pair!.previous!.floorId).toBe(1);
    expect(pair!.previous!.data.meta.location).toBe('F1');
  });

  it('跳过中间隐藏楼 / user 楼 / 损坏楼 → 精准定位上一有效 AI 楼', () => {
    const floors = [
      ai(validV2('BaseFloor')),
      user(validV2('UserInput')),
      ai(validV2('HiddenAI'), true),
      ai(broken),
      ai(validV2('LatestAI')),
    ];
    const pair = scanLatestFloorPair(4, readerOf(floors));
    expect(pair).not.toBeNull();
    expect(pair!.current.floorId).toBe(4);
    expect(pair!.current.data.meta.location).toBe('LatestAI');
    expect(pair!.previous).not.toBeNull();
    expect(pair!.previous!.floorId).toBe(0);
    expect(pair!.previous!.data.meta.location).toBe('BaseFloor');
  });

  it('仅有 #0 楼（或 current 前方无有效楼）时 previous 为 null', () => {
    const onlyZero = scanLatestFloorPair(0, readerOf([ai(validV2('Init'))]));
    expect(onlyZero).not.toBeNull();
    expect(onlyZero!.current.floorId).toBe(0);
    expect(onlyZero!.current.data.meta.location).toBe('Init');
    expect(onlyZero!.previous).toBeNull();

    const noPrevValid = scanLatestFloorPair(2, readerOf([user(), ai(broken), ai(validV2('OnlyValid'))]));
    expect(noPrevValid).not.toBeNull();
    expect(noPrevValid!.current.floorId).toBe(2);
    expect(noPrevValid!.previous).toBeNull();
  });

  it('全空或无任何有效楼时返回 null', () => {
    expect(scanLatestFloorPair(-1, readerOf([]))).toBeNull();
    expect(scanLatestFloorPair(2, readerOf([user(), ai(broken), ai(null)]))).toBeNull();
  });
});

