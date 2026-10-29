/**
 * useArchiveIndex 测试（RAC-FLOAT-02）：上一有效楼扫描起点 = floorId - 1、floorId null / 0 → previous null、
 * onRefresh 后重扫并使世界书缓存失效、reader 抛错 fail-closed、stop 注销。
 * pinia + 注入 reader，无酒馆全局依赖。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { FloorCandidate } from '../../红警指挥系统/parse/floorScanner';
import { Schema } from '../../红警指挥系统/core/schema';
import { useFloatingStore, type FloorReader } from '../../红警指挥系统/composables/useFloatingStore';
import { useArchiveIndex } from '../models/useArchiveIndex';
import type { WorldbookReader } from '../host/worldbookReader';

function ai(codex: Array<{ name: string; kind?: string }>): FloorCandidate {
  return { role: 'assistant', is_hidden: false, stat_data: Schema.parse({ codex }) };
}
const USER: FloorCandidate = { role: 'user', is_hidden: false, stat_data: undefined };

function readerOf(floors: Array<FloorCandidate | null>): FloorReader & { readFloor: Mock<(id: number) => FloorCandidate | null> } {
  return {
    lastMessageId: () => floors.length - 1,
    readFloor: vi.fn((id: number) => floors[id] ?? null),
  };
}

function fakeWorldbook(): WorldbookReader & { invalidate: Mock<() => void> } {
  return { read: vi.fn(async () => null), invalidate: vi.fn<() => void>() };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('useArchiveIndex', () => {
  it('previous 从 floorId - 1 逆序扫描最近有效 AI 楼；index 标记 new / kept', async () => {
    // #0 AI(雷达) · #1 user · #2 AI(损坏) · #3 user · #4 AI(雷达, 新堡)
    const reader = readerOf([
      ai([{ name: '雷达' }]),
      USER,
      { role: 'assistant', is_hidden: false, stat_data: { schema_version: 99 } },
      USER,
      ai([{ name: '雷达' }, { name: '新堡', kind: '建筑' }]),
    ]);
    const floating = useFloatingStore();
    await floating.refresh(reader);
    expect(floating.floorId).toBe(4);

    reader.readFloor.mockClear();
    const { previous, index } = useArchiveIndex({ reader, worldbook: fakeWorldbook() });
    // 扫描起点 = 3（不含本楼 #4）；#3 user、#2 损坏被跳过，#0 命中
    expect(reader.readFloor.mock.calls[0][0]).toBe(3);
    expect(reader.readFloor.mock.calls.map(c => c[0])).toEqual([3, 2, 1, 0]);
    expect(previous.value?.floorId).toBe(0);
    // 雷达 未指定 kind → 其他（排序在 建筑 之后）
    const flat = index.value.groups.flatMap(g => g.items).map(i => [i.name, i.status]);
    expect(flat).toEqual([
      ['新堡', 'new'],
      ['雷达', 'kept'],
    ]);
  });

  it('floorId 为 null（无数据）或 0（首楼）→ previous null，index 全部 new / 空', () => {
    const reader = readerOf([ai([{ name: 'x' }])]);
    const floating = useFloatingStore();
    const a = useArchiveIndex({ reader, worldbook: fakeWorldbook() });
    expect(floating.floorId).toBeNull();
    expect(a.previous.value).toBeNull();
    expect(a.index.value).toEqual({ groups: [], pending: [] });
    expect(reader.readFloor).not.toHaveBeenCalled();
  });

  it('floorId = 0 → 不扫描（无上一楼），本楼全部 new', async () => {
    const reader = readerOf([ai([{ name: 'x' }])]);
    const floating = useFloatingStore();
    await floating.refresh(reader);
    expect(floating.floorId).toBe(0);
    reader.readFloor.mockClear();
    const a = useArchiveIndex({ reader, worldbook: fakeWorldbook() });
    expect(reader.readFloor).not.toHaveBeenCalled();
    expect(a.previous.value).toBeNull();
    expect(a.index.value.groups[0].items[0].status).toBe('new');
  });

  it('onRefresh：刷新完成后重扫 previous 并 invalidate 世界书缓存；stop 后不再响应', async () => {
    const floors = [ai([{ name: 'a' }]), USER, ai([{ name: 'a' }, { name: 'b' }])];
    const reader = readerOf(floors);
    const floating = useFloatingStore();
    await floating.refresh(reader);
    const wb = fakeWorldbook();
    const a = useArchiveIndex({ reader, worldbook: wb });
    expect(a.previous.value?.floorId).toBe(0);
    expect(wb.invalidate).not.toHaveBeenCalled();

    // 新增 #3 user、#4 AI(a,b,c) → 刷新后本楼 #4，previous 应变为 #2
    floors.push(USER, ai([{ name: 'a' }, { name: 'b' }, { name: 'c' }]));
    await floating.refresh(reader);
    expect(floating.floorId).toBe(4);
    expect(a.previous.value?.floorId).toBe(2);
    expect(wb.invalidate).toHaveBeenCalledTimes(1);
    expect(a.index.value.groups[0].items.map(i => i.status)).toEqual(['kept', 'kept', 'new']);

    a.stop();
    await floating.refresh(reader);
    expect(wb.invalidate).toHaveBeenCalledTimes(1);
  });

  it('reader 在扫描上一楼时抛错 → previous null（fail-closed，不抛）', async () => {
    const good = readerOf([ai([{ name: 'a' }]), USER, ai([{ name: 'a' }])]);
    const floating = useFloatingStore();
    await floating.refresh(good);
    const bad: FloorReader = {
      lastMessageId: () => 2,
      readFloor: () => {
        throw new Error('boom');
      },
    };
    const a = useArchiveIndex({ reader: bad, worldbook: fakeWorldbook() });
    expect(a.previous.value).toBeNull();
    expect(a.index.value.groups[0].items[0].status).toBe('new');
  });

  it('ARM-01：useArchiveIndex 接入聊天绑定书并支持 resolveItemDetail 合并读取机娘双条目', async () => {
    const reader = readerOf([ai([{ name: '苏离', kind: '人员' }])]);
    const floating = useFloatingStore();
    await floating.refresh(reader);

    const wb: WorldbookReader & { invalidate: Mock<() => void> } = {
      read: vi.fn(async (bookName: string) => {
        if (bookName === 'RA_ChatBook_42') {
          return [
            {
              name: '档案·苏离·F-47首台',
              enabled: true,
              content: '[机娘·能力档案 | 苏离——F-47首台]\n\n能力：\n· 静默电行\n\n【⚔ 武器与暴露分档】\n· 武器：机载激光',
            },
            {
              name: '剧情·苏离·人格与现状',
              enabled: true,
              content: '[剧情·北坡纪事 | 苏离——F-47首台]\n\n社会外壳：绣坊帮工。\n\n当前状态：完好。',
            },
          ];
        }
        return [];
      }),
      invalidate: vi.fn<() => void>(),
    };

    const a = useArchiveIndex({
      reader,
      worldbook: wb,
      chatBook: () => 'RA_ChatBook_42',
    });

    expect(a.booksForItem('girl')[0]).toBe('RA_ChatBook_42');
    const detail = await a.resolveItemDetail(a.index.value.groups[0].items[0]);
    expect(detail.note).toBe('正史 · 《RA_ChatBook_42》');
    expect(detail.desc).toContain('静默电行');
    expect(detail.desc).toContain('社会外壳：绣坊帮工。');
  });

  it('FD-49 PKG-A：ModalArchive 复位为只读战况档案与在册人员总览（接入 useArchiveIndex 与 openDetail）', () => {
    const modalArchiveSfc = readFileSync(join(__dirname, '..', 'modals/ModalArchive.vue'), 'utf8');
    expect(modalArchiveSfc).toMatch(/import\s*\{\s*useArchiveIndex\s*\}\s*from\s*['"]\.\.\/models\/useArchiveIndex['"]/);
    expect(modalArchiveSfc).toMatch(/import\s*\{\s*openDetail\s*\}\s*from\s*['"]\.\.\/\.\.\/红警指挥系统\/composables\/useDetail['"]/);
    expect(modalArchiveSfc).toContain('countArchiveIndex(index.value)');
    expect(modalArchiveSfc).toContain('await resolveItemDetail(item)');
    expect(modalArchiveSfc).toContain('openDetail(detailData)');
    expect(modalArchiveSfc).toContain('data-test="archive-modal-categories"');
    expect(modalArchiveSfc).toContain('data-test="archive-modal-search"');
    expect(modalArchiveSfc).toContain('data-test="archive-modal-refresh"');
    expect(modalArchiveSfc).toContain('NEW · 本楼新增');
    expect(modalArchiveSfc).toContain('data-test="archive-legacy-toggle"');
    expect(modalArchiveSfc).toMatch(/z-10010/);
    expect(modalArchiveSfc).toMatch(/\.ra-modal-mask\s*\{[^}]*z-index:\s*10010/);
  });
});

