/**
 * branchClonerAndSaveV2.test.ts —— 17号方案A · SEAM-04 / SEAM-05 / SEAM-06 综合单元测试
 *
 * 覆盖：
 * 1. SEAM-04：`rollbackWorldbookMutations`（删楼/切 Swipe 后新建机娘/扩展词条逆向删除、更新词条恢复 `beforeEntry`、花名册追加行回退）；
 * 2. SEAM-04：`ensureBranchWorldbookIsolation`（`currentChatId !== originChatId` 时自动按 `branchMaxFloor` 裁剪高层词条并克隆绑定新分支专属世界书）；
 * 3. SEAM-04：`girlAutoFiler` 与 `expansionAutoFiler` 入档前后自动采集快照并写入 `$timeline` 的 `wbJournal`；
 * 4. SEAM-05：`prunePdaStateAboveFloor`、`clonePdaStateForBranch`、`pruneNotificationsAboveFloor`、`clonePatchFailFingerprints`；
 * 5. SEAM-06：`parseSavePack` 对 `SavePack V2` 扩展字段与 `v1` 旧档的双重兼容，以及 `restoreSavePackExtendedState` 恢复聊天变量与档案世界书词条。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../worldbook/chatBookBinding', async importOriginal => {
  const actual = await importOriginal<typeof import('../worldbook/chatBookBinding')>();
  return {
    ...actual,
    generateArchiveBookName:
      (actual as { generateArchiveBookName?: typeof actual.makeCanonicalBookName }).generateArchiveBookName ??
      actual.makeCanonicalBookName,
    ROSTER_ENTRY_NAME:
      (actual as { ROSTER_ENTRY_NAME?: string }).ROSTER_ENTRY_NAME ?? '01·机娘阵容与社会外壳总览',
  };
});

import {
  expansionFilerState,
  fileAllPendingExpansions,
} from '../../中控悬浮窗/host/expansionAutoFiler';
import {
  fileAllPendingGirls,
  filerState,
} from '../../中控悬浮窗/host/girlAutoFiler';
import {
  clonePatchFailFingerprints,
  findFailRecord,
  recordFailure,
} from '../../中控悬浮窗/models/patchFailFingerprint';
import { pruneNotificationsAboveFloor } from '../../中控悬浮窗/pda/notificationQueue';
import {
  clonePdaStateForBranch,
  loadPdaState,
  prunePdaStateAboveFloor,
  savePdaState,
  type PdaState,
  type StorageLike,
} from '../../中控悬浮窗/pda/pdaState';
import { packToChoices, parseSavePack } from '../../开场启动器/importSave';
import { createMockHostAdapter, restoreSavePackExtendedState } from '../../开场启动器/pipeline';
import { defaultChoices } from '../../开场启动器/presets';
import {
  captureAndRecordWorldbookMutations,
  computeBranchClonedEntries,
  ensureBranchWorldbookIsolation,
  reapplyWorldbookMutations,
  reconcileSwipeWorldbookTransition,
  recordWorldbookMutationsFromDiff,
  rollbackWorldbookMutations,
  snapshotWorldbookEntriesBeforeWrite,
} from '../worldbook/branchBookCloner';
import type { ChatBookGatewayLike, WorldbookEntry } from '../worldbook/chatBookBinding';
import { ROSTER_ENTRY_NAME } from '../worldbook/chatBookBinding';
import { migrateV1toV2, Schema } from '../core/schema';
import {
  appendWorldbookMutation,
  collectActiveWorldbookMutationsFromFloor,
  getSwipeWorldbookMutations,
  normalizeTimelineLedger,
  readTimelineLedger,
  resetMemoryTimelineLedgerForTest,
  writeTimelineLedger,
} from '../core/timelineLedger';

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike & { dump(): Record<string, string> } {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    dump: () => Object.fromEntries(store.entries()),
  };
}

function createFakeWorldbookGateway(initialBooks: Record<string, WorldbookEntry[]>, initialBound = '') {
  const books = new Map<string, WorldbookEntry[]>();
  for (const [k, v] of Object.entries(initialBooks)) {
    books.set(k, structuredClone(v));
  }
  let currentBoundBook = initialBound;
  let currentCharName = '测试角色';

  const gateway: ChatBookGatewayLike & {
    books: Map<string, WorldbookEntry[]>;
    getBoundBook(): string;
    getChatWorldbookName(target?: string): string | null;
    getWorldbookNames(): string[];
    getWorldbook(name: string): Promise<WorldbookEntry[]>;
    updateWorldbookWith(name: string, updater: (entries: WorldbookEntry[]) => WorldbookEntry[]): Promise<WorldbookEntry[]>;
    createWorldbook(name: string, entries: WorldbookEntry[]): Promise<boolean>;
    rebindChatWorldbook(target: string, name: string): Promise<void>;
    getCurrentCharacterName(): string;
  } = {
    books,
    getBoundBook: () => currentBoundBook,
    begin: () => ({ chatId: 'chat_main' }),
    guardedBook: async () => currentBoundBook,
    getChatWorldbookName: () => currentBoundBook || null,
    getWorldbookNames: () => [...books.keys()],
    getWorldbook: async (name: string) => structuredClone(books.get(name) ?? []),
    updateWorldbookWith: async (name: string, updater: (entries: WorldbookEntry[]) => WorldbookEntry[]) => {
      const prev = structuredClone(books.get(name) ?? []);
      const next = updater(prev);
      books.set(name, structuredClone(next));
      return next;
    },
    createWorldbook: async (name: string, entries: WorldbookEntry[]) => {
      books.set(name, structuredClone(entries));
      return true;
    },
    rebindChatWorldbook: async (_target: string, name: string) => {
      currentBoundBook = name;
    },
    getCurrentCharacterName: () => currentCharName,
  };

  return gateway;
}

beforeEach(() => {
  resetMemoryTimelineLedgerForTest();
  filerState.busy = false;
  filerState.auto = true;
  filerState.receipts.splice(0);
  expansionFilerState.busy = false;
  expansionFilerState.auto = true;
  expansionFilerState.receipts.splice(0);
});

describe('SEAM-04 · rollbackWorldbookMutations 与入档逆向日志 wbJournal', () => {
  it('删楼后逆向回滚：新建机娘/扩展词条被删除、更新词条恢复 beforeEntry、花名册追加行回退', async () => {
    const bookName = '红警档案·测试角色·20261016T0800';
    const rosterKey = ROSTER_ENTRY_NAME || '01·机娘阵容与社会外壳总览';
    const gw = createFakeWorldbookGateway(
      {
        [bookName]: [
          {
            name: rosterKey,
            content: '[本聊天机娘阵容总览]\n| 白凌 |\n| 苏离 |',
            enabled: true,
          },
          {
            name: '档案·白凌',
            content: '白凌 Lv.2 升级后档案',
            enabled: true,
            keys: ['白凌', '纳米核心'],
          },
          {
            name: '档案·苏离',
            content: '苏离 新建档案',
            enabled: true,
            keys: ['苏离'],
          },
          {
            name: '剧情·苏离',
            content: '苏离 新建剧情',
            enabled: true,
            keys: ['苏离'],
          },
          {
            name: '装备·静默伪装网·设定',
            content: '静默伪装网 新建扩展词条',
            enabled: true,
            keys: ['静默伪装网'],
          },
        ],
      },
      bookName,
    );

    const res = await rollbackWorldbookMutations(
      [
        {
          ts: 1000,
          floorId: 6,
          swipeId: 0,
          bookName,
          entryName: '档案·白凌',
          op: 'update',
          beforeEntry: {
            name: '档案·白凌',
            content: '白凌 Lv.1 初始档案',
            enabled: true,
            keys: ['白凌'],
          },
        },
        {
          ts: 2000,
          floorId: 7,
          swipeId: 0,
          bookName,
          entryName: '档案·苏离',
          op: 'create',
          beforeEntry: null,
          rosterLineAdded: '| 苏离 |',
        },
        {
          ts: 2001,
          floorId: 7,
          swipeId: 0,
          bookName,
          entryName: '剧情·苏离',
          op: 'create',
          beforeEntry: null,
        },
        {
          ts: 3000,
          floorId: 8,
          swipeId: 0,
          bookName,
          entryName: '装备·静默伪装网·设定',
          op: 'create',
          beforeEntry: null,
        },
      ],
      gw,
    );

    expect(res.errors).toEqual([]);
    expect(res.rolledBackCount).toBe(4);
    expect(res.booksTouched).toEqual([bookName]);

    const entriesAfter = await gw.getWorldbook(bookName);
    const names = entriesAfter.map(e => e.name);
    // 新建词条已删除
    expect(names).not.toContain('档案·苏离');
    expect(names).not.toContain('剧情·苏离');
    expect(names).not.toContain('装备·静默伪装网·设定');
    // 更新词条已恢复 beforeEntry
    const bailing = entriesAfter.find(e => e.name === '档案·白凌');
    expect(bailing?.content).toBe('白凌 Lv.1 初始档案');
    expect(bailing?.keys).toEqual(['白凌']);
    // 花名册追加行已移除
    const roster = entriesAfter.find(e => e.name === rosterKey);
    expect(roster?.content).toBe('[本聊天机娘阵容总览]\n| 白凌 |');
  });

  it('snapshotWorldbookEntriesBeforeWrite + recordWorldbookMutationsFromDiff 正确区分 create 与 update', async () => {
    const bookName = '红警档案·测试角色·20261016T0800';
    const gw = createFakeWorldbookGateway(
      {
        [bookName]: [
          {
            name: '档案·白凌',
            content: '旧档案内容',
            enabled: true,
            keys: ['白凌'],
          },
        ],
      },
      bookName,
    );

    const before = await snapshotWorldbookEntriesBeforeWrite(['档案·白凌', '剧情·白凌'], gw);
    expect(before.bookName).toBe(bookName);
    expect(before.snapshots.get('档案·白凌')?.content).toBe('旧档案内容');
    expect(before.snapshots.get('剧情·白凌')).toBeNull();

    const ledger = recordWorldbookMutationsFromDiff({
      floorId: 4,
      swipeId: 0,
      bookName: before.bookName,
      entryNames: ['档案·白凌', '剧情·白凌'],
      beforeSnapshots: before.snapshots,
      rosterLineAdded: '| 白凌 |',
    });

    const journal = ledger.floors.f_4?.swipes.s_0?.wbJournal ?? [];
    expect(journal).toHaveLength(2);
    expect(journal[0]).toMatchObject({
      entryName: '档案·白凌',
      op: 'update',
      rosterLineAdded: '| 白凌 |',
    });
    expect(journal[0].beforeEntry?.content).toBe('旧档案内容');
    expect(journal[1]).toMatchObject({
      entryName: '剧情·白凌',
      op: 'create',
      beforeEntry: null,
    });
  });

  it('girlAutoFiler 与 expansionAutoFiler 入档成功后自动记录 wbJournal（且异常不影响主流程）', async () => {
    const girl = {
      name: '红珊',
      model: '防空型',
      keys: ['红珊'],
      shell: '医学生',
    };
    let vars: Record<string, unknown> = { stat_data: { pending_lore: [girl], codex: [] } };
    const girlOut = await fileAllPendingGirls(
      { floorId: 5, pending: [girl] },
      {
        fileOne: async d => ({
          girl: d.name,
          dossier: { book: '聊天档案书A', action: 'created', entryName: `档案·${d.name}` },
          story: { book: '聊天档案书A', action: 'created', entryName: `剧情·${d.name}`, rosterAction: 'appended' },
        }),
        updateFloorVars: async (_id, updater) => {
          vars = updater(vars);
        },
        readChatId: () => 'chat_1',
        now: () => new Date('2026-10-16T08:00:00Z'),
      },
    );

    expect(girlOut.filed).toEqual(['红珊']);
    expect(girlOut.wroteVars).toBe(true);
    const ledgerAfterGirl = readTimelineLedger();
    const f5Journal = ledgerAfterGirl.floors.f_5?.swipes.s_0?.wbJournal ?? [];
    expect(f5Journal.map(j => j.entryName)).toEqual(['档案·红珊', '剧情·红珊']);
    expect(f5Journal[0].rosterLineAdded).toBe('· 红珊——防空型。对外：医学生。');

    const expItem = {
      name: '磁暴线圈塔',
      kind: '建筑' as const,
      desc: '磁暴防御塔',
      params: {},
      detail: '高压放电防御建筑',
      keys: ['磁暴线圈塔'],
    };
    const fakeGw = createFakeWorldbookGateway({ 聊天档案书A: [] }, '聊天档案书A');
    const expOut = await fileAllPendingExpansions(
      { floorId: 6, pending: [expItem] },
      {
        fileOne: async (d, _gw, sink) => {
          sink.push({ name: d.name, kind: d.kind, desc: d.desc, params: {} });
          return {
            name: d.name,
            kind: d.kind,
            book: '聊天档案书A',
            action: 'created',
            entryName: `${d.kind}·${d.name}·设定`,
          };
        },
        updateFloorVars: async (_id, updater) => {
          vars = updater(vars);
        },
        readChatId: () => 'chat_1',
        gateway: fakeGw,
        now: () => new Date('2026-10-16T08:05:00Z'),
      },
    );

    expect(expOut.filed).toEqual(['磁暴线圈塔']);
    const ledgerAfterExp = readTimelineLedger();
    const f6Journal = ledgerAfterExp.floors.f_6?.swipes.s_0?.wbJournal ?? [];
    expect(f6Journal).toHaveLength(1);
    expect(f6Journal[0]).toMatchObject({
      bookName: '聊天档案书A',
      entryName: '建筑·磁暴线圈塔·设定',
      op: 'create',
    });
  });
});

describe('SEAM-04 · ensureBranchWorldbookIsolation（分支检测与档案世界书自动克隆）', () => {
  it('当 currentChatId !== originChatId 时按 branchMaxFloor 剥离高层词条变更并克隆绑定新分支专属世界书', async () => {
    const mainBook = '红警档案·测试角色·20261016T0700';
    const gw = createFakeWorldbookGateway(
      {
        [mainBook]: [
          { name: '档案·白凌', content: '白凌在主线 #8 被升级后的内容', enabled: true, keys: ['白凌'] },
          { name: '档案·苏离', content: '主线 #5 入档的苏离', enabled: true, keys: ['苏离'] },
          { name: '档案·岚翎', content: '主线 #9 入档的岚翎（分叉点 #6 之后新增）', enabled: true, keys: ['岚翎'] },
        ],
      },
      mainBook,
    );

    writeTimelineLedger(draft => {
      draft.originChatId = 'chat_main_001';
      draft.boundBookName = mainBook;
      draft.maxFloorWatermark = 9;
    });
    // #5 楼新增苏离（<= branchMaxFloor 6，应保留）
    appendWorldbookMutation(5, 0, {
      bookName: mainBook,
      entryName: '档案·苏离',
      op: 'create',
      beforeEntry: null,
    });
    // #8 楼更新白凌（> branchMaxFloor 6，应回退到 Lv.1）
    appendWorldbookMutation(8, 0, {
      bookName: mainBook,
      entryName: '档案·白凌',
      op: 'update',
      beforeEntry: {
        name: '档案·白凌',
        content: '白凌在 #6 分叉时刻的 Lv.1 内容',
        enabled: true,
        keys: ['白凌'],
      },
    });
    // #9 楼新增岚翎（> branchMaxFloor 6，应从分支书中剔除）
    appendWorldbookMutation(9, 0, {
      bookName: mainBook,
      entryName: '档案·岚翎',
      op: 'create',
      beforeEntry: null,
    });

    const branchCallback = vi.fn();
    const res = await ensureBranchWorldbookIsolation({
      currentChatId: 'chat_branch_from_6',
      branchMaxFloor: 6,
      gateway: gw,
      now: new Date('2026-10-16T09:30:00Z'),
      onBranchDetected: branchCallback,
    });

    expect(res.branched).toBe(true);
    expect(res.previousChatId).toBe('chat_main_001');
    expect(res.currentChatId).toBe('chat_branch_from_6');
    expect(res.sourceBookName).toBe(mainBook);
    expect(branchCallback).toHaveBeenCalledWith({
      fromChatId: 'chat_main_001',
      toChatId: 'chat_branch_from_6',
      branchMaxFloor: 6,
    });

    // 验证账本已裁剪 >6 的楼层且更新了 originChatId 与 boundBookName
    const nextLedger = readTimelineLedger();
    expect(nextLedger.originChatId).toBe('chat_branch_from_6');
    expect(nextLedger.floors.f_5).toBeDefined();
    expect(nextLedger.floors.f_8).toBeUndefined();
    expect(nextLedger.floors.f_9).toBeUndefined();

    // 验证克隆书词条精确停留在 #6 分叉点并已自动重绑
    expect(res.clonedBookName).not.toBe(mainBook);
    expect(res.clonedBookName).toContain('红警档案·测试角色·');
    expect(gw.getBoundBook()).toBe(res.clonedBookName);
    const clonedEntries = await gw.getWorldbook(res.clonedBookName);
    expect(clonedEntries.map(e => e.name)).toEqual(['档案·白凌', '档案·苏离']);
    expect(clonedEntries.find(e => e.name === '档案·白凌')?.content).toBe('白凌在 #6 分叉时刻的 Lv.1 内容');

    // 纯函数 computeBranchClonedEntries 独立验证
    const sourceEntries = await gw.getWorldbook(mainBook);
    expect(sourceEntries).toHaveLength(3); // 原主线世界书未被破坏
    const computed = computeBranchClonedEntries(sourceEntries, [
      {
        ts: 2,
        floorId: 9,
        swipeId: 0,
        bookName: mainBook,
        entryName: '档案·岚翎',
        op: 'create',
        beforeEntry: null,
      },
    ]);
    expect(computed.map(e => e.name)).toEqual(['档案·白凌', '档案·苏离']);
  });
});

describe('SEAM-05 · PDA 作用域分桶水位线修剪与补丁失败指纹克隆', () => {
  it('prunePdaStateAboveFloor 移除高于 maxFloor 的已读事件 ID，保留低楼层与无楼层事件 ID', () => {
    const storage = createMemoryStorage();
    const initial: PdaState = {
      x: 100,
      y: 100,
      collapsed: true,
      pinned: false,
      dockSide: 'right',
      activeTab: 'events',
      hidden: false,
      readEventIds: ['floor:3:evt_a', 'evt_f5_b', 'floor:8:evt_high', 'evt_f10_high', 'global_notice'],
      highlightEventId: null,
    };
    savePdaState(storage, initial, 'chat_alpha');

    prunePdaStateAboveFloor(5, 'chat_alpha', storage);

    const loaded = loadPdaState(storage, 'chat_alpha');
    expect(loaded?.readEventIds).toEqual(['floor:3:evt_a', 'evt_f5_b', 'global_notice']);
  });

  it('clonePdaStateForBranch 将父聊天分桶克隆到子分支分桶并按分叉楼层裁剪 readEventIds', () => {
    const storage = createMemoryStorage();
    const parentState: PdaState = {
      x: 240,
      y: 160,
      collapsed: false,
      pinned: true,
      dockSide: 'left',
      activeTab: 'intel',
      hidden: false,
      readEventIds: ['floor:2:init', 'floor:6:mid', 'floor:9:future'],
      highlightEventId: null,
    };
    savePdaState(storage, parentState, 'chat_parent');

    clonePdaStateForBranch('chat_parent', 'chat_child', 6, storage);

    const childLoaded = loadPdaState(storage, 'chat_child');
    expect(childLoaded?.activeTab).toBe('intel');
    expect(childLoaded?.readEventIds).toEqual(['floor:2:init', 'floor:6:mid']);
  });

  it('pruneNotificationsAboveFloor 过滤掉 sourceFloor > maxFloor 的高楼层通知', () => {
    const queue = [
      { id: 'n1', title: '低层事件', sourceFloor: 3 },
      { id: 'n2', title: '边界事件', sourceFloor: 6 },
      { id: 'n3', title: '高层事件', sourceFloor: 7 },
      { id: 'n4', title: '全局无楼层事件' },
    ];
    const pruned = pruneNotificationsAboveFloor(queue, 6);
    expect(pruned.map(n => n.id)).toEqual(['n1', 'n2', 'n4']);
  });

  it('clonePatchFailFingerprints 将父聊天的失败指纹克隆至新分支聊天桶', () => {
    const storage = createMemoryStorage();
    recordFailure('chat_parent', 'fp_bad_patch_01', '禁止修改顶层键', storage, 1000);
    recordFailure('chat_parent', 'fp_bad_patch_02', '实体未找到', storage, 2000);

    clonePatchFailFingerprints('chat_parent', 'chat_branch', storage);

    expect(findFailRecord('chat_branch', 'fp_bad_patch_01', storage)?.msg).toBe('禁止修改顶层键');
    expect(findFailRecord('chat_branch', 'fp_bad_patch_02', storage)?.msg).toBe('实体未找到');
  });
});

describe('SEAM-06 · SavePack V2 全量存档包解析、V1 兼容与扩展状态恢复', () => {
  function makeValidStatData() {
    return Schema.parse(migrateV1toV2({ meta: { world_id: 'xiuzhen', date: '秋·九月初五' } }));
  }

  it('parseSavePack 同时兼容 version:1 旧档与 version:2 扩展字段（parse_state / dlc_registry / timeline_ledger / chat_worldbook_entries）', () => {
    const stat = makeValidStatData();

    // 1. V1 旧档兼容
    const v1Json = JSON.stringify({
      version: 1,
      kind: 'redalert-save',
      exportedAt: '2026-10-16T07:00:00.000Z',
      source: { chat: '旧主线聊天', message_id: 5 },
      stat_data: stat,
    });
    const v1Res = parseSavePack(v1Json);
    expect(v1Res.ok).toBe(true);
    if (v1Res.ok) {
      expect(v1Res.pack.version).toBe(1);
      expect(v1Res.pack.parse_state).toBeUndefined();
      expect(v1Res.pack.chat_worldbook_entries).toBeUndefined();
    }

    // 2. V2 全量存档解析与透传
    const v2Json = JSON.stringify({
      version: 2,
      kind: 'redalert-save',
      exportedAt: '2026-10-16T08:00:00.000Z',
      source: { chat: 'V2主线聊天', message_id: 12 },
      stat_data: stat,
      parse_state: { aliases: { 电厂: '磁能反应堆' }, done: { f_12: { hash: 'abc', swipe_id: 0 } } },
      dlc_registry: [{ id: 'dlc_soviet_pack', name: '苏联重工扩展包' }],
      timeline_ledger: {
        version: 1,
        originChatId: 'V2主线聊天',
        boundBookName: '红警档案·测试·20261016',
        maxFloorWatermark: 12,
        floors: {},
      },
      chat_worldbook_entries: [
        { name: '档案·白凌', content: '白凌完整档案', enabled: true, keys: ['白凌'] },
        { name: '科技·超导电容·设定', content: '超导电容设定', enabled: true, keys: ['超导电容'] },
      ],
    });

    const v2Res = parseSavePack(v2Json);
    expect(v2Res.ok).toBe(true);
    if (!v2Res.ok) return;

    expect(v2Res.pack.version).toBe(2);
    expect(v2Res.pack.parse_state).toEqual({
      aliases: { 电厂: '磁能反应堆' },
      done: { f_12: { hash: 'abc', swipe_id: 0 } },
    });
    expect(v2Res.pack.dlc_registry).toEqual([{ id: 'dlc_soviet_pack', name: '苏联重工扩展包' }]);
    expect(v2Res.pack.timeline_ledger?.originChatId).toBe('V2主线聊天');
    expect(v2Res.pack.chat_worldbook_entries).toHaveLength(2);
  });

  it('restoreSavePackExtendedState 自动将 $parse、$dlc、$timeline 写回聊天变量，并将 chat_worldbook_entries 写入聊天绑定档案书', async () => {
    const stat = makeValidStatData();
    const v2Res = parseSavePack(
      JSON.stringify({
        version: 2,
        kind: 'redalert-save',
        exportedAt: '2026-10-16T08:30:00.000Z',
        source: { chat: 'V2导出源', message_id: 10 },
        stat_data: stat,
        parse_state: { aliases: { 矿车: '武装采矿车' } },
        dlc_registry: [{ id: 'dlc_01' }],
        timeline_ledger: {
          version: 1,
          originChatId: 'V2导出源',
          boundBookName: '红警档案·原书',
          maxFloorWatermark: 10,
          floors: {},
        },
        chat_worldbook_entries: [
          { name: '档案·白凌', content: '白凌档案内容', enabled: true, keys: ['白凌'] },
        ],
      }),
    );
    expect(v2Res.ok).toBe(true);
    if (!v2Res.ok) return;

    const adapter = createMockHostAdapter(0);
    const fakeGw = createFakeWorldbookGateway({}, '');

    const { choices } = packToChoices(v2Res.pack, defaultChoices());
    expect(choices.importedStat).toBeDefined();

    const restoreOut = await restoreSavePackExtendedState(v2Res.pack, {
      adapter,
      gateway: fakeGw,
    });

    expect(restoreOut.restoredVars).toEqual(['$parse', '$dlc', '$timeline']);
    expect(restoreOut.restoredWorldbookEntries).toBe(1);
    expect(restoreOut.boundBookName).toContain('红警档案·');

    expect(adapter.chatVars['$parse']).toEqual({ aliases: { 矿车: '武装采矿车' } });
    expect(adapter.chatVars['$dlc']).toEqual([{ id: 'dlc_01' }]);
    expect((adapter.chatVars['$timeline'] as { maxFloorWatermark?: number })?.maxFloorWatermark).toBe(10);

    const restoredBookEntries = await fakeGw.getWorldbook(restoreOut.boundBookName);
    expect(restoredBookEntries).toEqual([
      { name: '档案·白凌', content: '白凌档案内容', enabled: true, keys: ['白凌'] },
    ]);
  });

  it('FD-37 · BUG-SAVE-02 & BUG-SAVE-03：restoreSavePackExtendedState 完整恢复 position/strategy/recursion/extra/comment 并重锚定 $timeline，首次触发 ensureBranchWorldbookIsolation({ branchMaxFloor: 0 }) 绝不误删恢复的词条', async () => {
    const stat = makeValidStatData();
    const v2Res = parseSavePack(
      JSON.stringify({
        version: 2,
        kind: 'redalert-save',
        exportedAt: '2026-10-22T05:00:00.000Z',
        source: { chat: '旧主线聊天_01', message_id: 8 },
        stat_data: stat,
        timeline_ledger: {
          version: 1,
          originChatId: '旧主线聊天_01',
          boundBookName: '红警档案·旧书',
          maxFloorWatermark: 8,
          floors: {
            f_5: {
              floorId: 5,
              activeSwipeId: 0,
              swipes: {
                s_0: {
                  floorId: 5,
                  swipeId: 0,
                  textHash: 'h5',
                  opLog: [{ kind: 'COMMIT_PLANNING', ts: 1000, planId: 'plan_01' }],
                  wbJournal: [
                    {
                      ts: 1001,
                      floorId: 5,
                      swipeId: 0,
                      bookName: '红警档案·旧书',
                      entryName: '档案·白凌',
                      op: 'create',
                      beforeEntry: null,
                    },
                  ],
                  updatedAt: 1001,
                },
              },
            },
            f_8: {
              floorId: 8,
              activeSwipeId: 0,
              swipes: {
                s_0: {
                  floorId: 8,
                  swipeId: 0,
                  textHash: 'h8',
                  opLog: [],
                  wbJournal: [
                    {
                      ts: 2001,
                      floorId: 8,
                      swipeId: 0,
                      bookName: '红警档案·旧书',
                      entryName: '科技·超导电容·设定',
                      op: 'create',
                      beforeEntry: null,
                    },
                  ],
                  updatedAt: 2001,
                },
              },
            },
          },
        },
        chat_worldbook_entries: [
          {
            name: '档案·白凌',
            comment: '白凌核心档案',
            content: '白凌 Lv.2 完整设定',
            enabled: true,
            keys: ['白凌', '纳米核心'],
            position: { type: 'after_character_definition', order: 210, depth: 4 },
            strategy: { type: 'selective', keys: ['白凌'], scanDepth: 2 },
            recursion: { prevent_incoming: false, prevent_outgoing: true, delay_until: null },
            extra: { floor: 5, swipe: 0 },
          },
          {
            name: '科技·超导电容·设定',
            comment: '超导电容',
            content: '超导电容详细设定',
            enabled: true,
            keys: ['超导电容'],
            position: { type: 'before_character_definition', order: 130 },
            recursion: { prevent_outgoing: true },
          },
          {
            name: '摘要·001-008',
            content: '前8层阶段摘要',
            enabled: true,
            extra: { from: 1, to: 8 },
          },
        ],
      }),
    );
    expect(v2Res.ok).toBe(true);
    if (!v2Res.ok) return;

    const adapter = createMockHostAdapter(0);
    const fakeGw = createFakeWorldbookGateway({}, '');

    const restoreOut = await restoreSavePackExtendedState(v2Res.pack, {
      adapter,
      gateway: fakeGw,
    });

    expect(restoreOut.restoredWorldbookEntries).toBe(3);
    const entriesBeforeIso = await fakeGw.getWorldbook(restoreOut.boundBookName);
    expect(entriesBeforeIso).toHaveLength(3);
    expect(entriesBeforeIso[0]).toMatchObject({
      name: '档案·白凌',
      comment: '白凌核心档案',
      position: { type: 'after_character_definition', order: 210, depth: 4 },
      strategy: { type: 'selective', keys: ['白凌'], scanDepth: 2 },
      recursion: { prevent_incoming: false, prevent_outgoing: true, delay_until: null },
      extra: { floor: 5, swipe: 0 },
    });

    // 验证高于 #0 楼的 wbJournal 已清空（保留 opLog）
    const ledgerAfterRestore = readTimelineLedger();
    expect(ledgerAfterRestore.boundBookName).toBe(restoreOut.boundBookName);
    expect(ledgerAfterRestore.floors.f_5.swipes.s_0.opLog).toHaveLength(1);
    expect(ledgerAfterRestore.floors.f_5.swipes.s_0.wbJournal).toEqual([]);
    expect(ledgerAfterRestore.floors.f_8.swipes.s_0.wbJournal).toEqual([]);

    // 模拟新聊天首次触发 CHAT_CHANGED -> ensureBranchWorldbookIsolation({ branchMaxFloor: 0 })
    const isoRes = await ensureBranchWorldbookIsolation({
      currentChatId: '新导入聊天_02',
      branchMaxFloor: 0,
      gateway: fakeGw,
    });
    expect(isoRes.branched).toBe(false);

    const activeBook = fakeGw.getBoundBook();
    const entriesAfterIso = await fakeGw.getWorldbook(activeBook);
    expect(entriesAfterIso.map(e => e.name)).toEqual([
      '档案·白凌',
      '科技·超导电容·设定',
      '摘要·001-008',
    ]);
  });
});

describe('CHATBOOK-MVCC-CORE-01 · Swipe 双向 Undo/Redo、前缀容错匹配与分支越界摘要裁剪', () => {
  it('reconcileSwipeWorldbookTransition 在 Swipe #0（词条 A）⇄ Swipe #1（词条 B）之间往返切换时双向 Undo/Redo 100% 幂等无残留', async () => {
    const bookName = '红警档案·测试角色·20261019T1200';
    const rosterKey = ROSTER_ENTRY_NAME || '01·机娘阵容与社会外壳总览';
    const gw = createFakeWorldbookGateway(
      {
        [bookName]: [
          {
            name: rosterKey,
            content: '[本聊天机娘阵容总览]\n| 白凌 |',
            enabled: true,
          },
        ],
      },
      bookName,
    );

    // 1. 在 #5 楼 Swipe #0 入档词条 A（苏离）
    const beforeS0 = await snapshotWorldbookEntriesBeforeWrite(['档案·苏离', '剧情·苏离'], gw);
    await gw.updateWorldbookWith(bookName, entries => [
      ...entries.map(e =>
        e.name === rosterKey ? { ...e, content: `${e.content}\n| 苏离 |` } : e,
      ),
      {
        name: '档案·苏离',
        comment: '档案·苏离',
        content: '苏离 F-47 制空机娘档案',
        enabled: true,
        keys: ['苏离', 'F-47'],
        position: { type: 'after_character_definition', order: 210 },
        extra: { floor: 5, swipe: 0 },
      },
      {
        name: '剧情·苏离',
        content: '苏离入列剧情',
        enabled: true,
        keys: ['苏离'],
      },
    ]);
    await captureAndRecordWorldbookMutations({
      floorId: 5,
      swipeId: 0,
      bookName,
      entryNames: ['档案·苏离', '剧情·苏离'],
      beforeSnapshots: beforeS0.snapshots,
      rosterLineAdded: '| 苏离 |',
      gateway: gw,
    });

    const s0Journal = getSwipeWorldbookMutations(readTimelineLedger(), 5, 0);
    expect(s0Journal).toHaveLength(2);
    expect(s0Journal[0].afterEntry?.content).toBe('苏离 F-47 制空机娘档案');
    expect(s0Journal[0].afterEntry?.position).toEqual({ type: 'after_character_definition', order: 210 });

    // 2. 首次切换到新生成的 Swipe #1：应自动卸载 Swipe #0 的苏离与花名册行
    const toS1First = await reconcileSwipeWorldbookTransition({
      floorId: 5,
      newSwipeId: 1,
      gateway: gw,
    });
    expect(toS1First).toEqual({
      switched: true,
      prevSwipeId: 0,
      rolledBackCount: 2,
      reappliedCount: 0,
    });
    let entries = await gw.getWorldbook(bookName);
    expect(entries.map(e => e.name)).toEqual([rosterKey]);
    expect(entries.find(e => e.name === rosterKey)?.content).toBe('[本聊天机娘阵容总览]\n| 白凌 |');

    // 3. 在 #5 楼 Swipe #1 入档词条 B（赤星）
    const beforeS1 = await snapshotWorldbookEntriesBeforeWrite(['档案·赤星'], gw);
    await gw.updateWorldbookWith(bookName, prev => [
      ...prev.map(e =>
        e.name === rosterKey ? { ...e, content: `${e.content}\n| 赤星 |` } : e,
      ),
      {
        name: '档案·赤星',
        content: '赤星 犀牛重装机娘档案',
        enabled: true,
        keys: ['赤星', '犀牛'],
      },
    ]);
    await captureAndRecordWorldbookMutations({
      floorId: 5,
      swipeId: 1,
      bookName,
      entryNames: ['档案·赤星'],
      beforeSnapshots: beforeS1.snapshots,
      rosterLineAdded: '| 赤星 |',
      gateway: gw,
    });

    entries = await gw.getWorldbook(bookName);
    expect(entries.map(e => e.name)).toEqual([rosterKey, '档案·赤星']);

    // 4. 切回 Swipe #0：自动卸载 B（赤星），并 Redo 恢复 A（苏离）与花名册行！
    const backToS0 = await reconcileSwipeWorldbookTransition({
      floorId: 5,
      newSwipeId: 0,
      gateway: gw,
    });
    expect(backToS0).toEqual({
      switched: true,
      prevSwipeId: 1,
      rolledBackCount: 1,
      reappliedCount: 2,
    });
    entries = await gw.getWorldbook(bookName);
    expect(entries.map(e => e.name)).toEqual([rosterKey, '档案·苏离', '剧情·苏离']);
    expect(entries.find(e => e.name === '档案·苏离')?.position).toEqual({
      type: 'after_character_definition',
      order: 210,
    });
    expect(entries.find(e => e.name === rosterKey)?.content).toBe('[本聊天机娘阵容总览]\n| 白凌 |\n| 苏离 |');

    // 5. 再次切回 Swipe #1：自动卸载 A（苏离），并 Redo 恢复 B（赤星）！
    const backToS1 = await reconcileSwipeWorldbookTransition({
      floorId: 5,
      newSwipeId: 1,
      gateway: gw,
    });
    expect(backToS1).toEqual({
      switched: true,
      prevSwipeId: 0,
      rolledBackCount: 2,
      reappliedCount: 1,
    });
    entries = await gw.getWorldbook(bookName);
    expect(entries.map(e => e.name)).toEqual([rosterKey, '档案·赤星']);
    expect(entries.find(e => e.name === rosterKey)?.content).toBe('[本聊天机娘阵容总览]\n| 白凌 |\n| 赤星 |');

    // 6. 同一 Swipe 重复调用保持幂等无操作
    const noOp = await reconcileSwipeWorldbookTransition({
      floorId: 5,
      newSwipeId: 1,
      gateway: gw,
    });
    expect(noOp.switched).toBe(false);
    expect(noOp.rolledBackCount).toBe(0);
    expect(noOp.reappliedCount).toBe(0);

    // 验证 sanitizeWbJournal 在 normalizeTimelineLedger 中完整保留 beforeEntry / afterEntry
    const normalized = normalizeTimelineLedger(readTimelineLedger());
    expect(normalized.floors.f_5.swipes.s_0.wbJournal[0].afterEntry?.extra).toEqual({ floor: 5, swipe: 0 });
    expect(collectActiveWorldbookMutationsFromFloor(normalized, 5)).toHaveLength(1);
  });

  it('前缀容错匹配与回滚：传入 档案·赤星 可正确采集、更新与回滚 档案·赤星·犀牛主战坦克', async () => {
    const bookName = '红警档案·测试角色·20261019T1230';
    const gw = createFakeWorldbookGateway(
      {
        [bookName]: [
          {
            name: '档案·赤星·犀牛主战坦克',
            content: '赤星 初始 Lv.1 档案',
            enabled: true,
            keys: ['赤星'],
          },
          {
            name: '档案·苏离·F-47首台',
            content: '苏离 新建带后缀词条',
            enabled: true,
            keys: ['苏离'],
          },
        ],
      },
      bookName,
    );

    // 1. 快照采集前缀容错：传入 '档案·赤星' 命中 '档案·赤星·犀牛主战坦克'
    const before = await snapshotWorldbookEntriesBeforeWrite(['档案·赤星'], gw);
    const snap = before.snapshots.get('档案·赤星');
    expect(snap).not.toBeNull();
    expect(snap?.name).toBe('档案·赤星·犀牛主战坦克');
    expect(snap?.content).toBe('赤星 初始 Lv.1 档案');

    // 模拟更新词条内容
    await gw.updateWorldbookWith(bookName, entries =>
      entries.map(e =>
        e.name === '档案·赤星·犀牛主战坦克' ? { ...e, content: '赤星 升级 Lv.2 档案' } : e,
      ),
    );

    // 2. 回滚时：entryName 为 '档案·赤星'（update）与 '档案·苏离'（create）均通过前缀容错命中带型号后缀的词条
    await rollbackWorldbookMutations(
      [
        {
          ts: 100,
          floorId: 6,
          swipeId: 0,
          bookName,
          entryName: '档案·赤星',
          op: 'update',
          beforeEntry: snap!,
        },
        {
          ts: 200,
          floorId: 7,
          swipeId: 0,
          bookName,
          entryName: '档案·苏离',
          op: 'create',
          beforeEntry: null,
        },
      ],
      gw,
    );

    const afterEntries = await gw.getWorldbook(bookName);
    expect(afterEntries.map(e => e.name)).toEqual(['档案·赤星·犀牛主战坦克']);
    expect(afterEntries[0].content).toBe('赤星 初始 Lv.1 档案');

    // 3. Redo 重放时同样支持前缀匹配覆盖
    await reapplyWorldbookMutations(
      [
        {
          ts: 100,
          floorId: 6,
          swipeId: 0,
          bookName,
          entryName: '档案·赤星',
          op: 'update',
          beforeEntry: snap!,
          afterEntry: {
            name: '档案·赤星·犀牛主战坦克',
            content: '赤星 升级 Lv.2 档案',
            enabled: true,
            keys: ['赤星', '重装'],
          },
        },
      ],
      gw,
    );
    const reappliedEntries = await gw.getWorldbook(bookName);
    expect(reappliedEntries[0].content).toBe('赤星 升级 Lv.2 档案');
  });

  it('computeBranchClonedEntries 与 ensureBranchWorldbookIsolation 在 branchMaxFloor = 12 时自动剔除 摘要·001-020 越界未来摘要并保留 摘要·001-010', async () => {
    const mainBook = '红警档案·测试角色·20261019T1300';
    const sourceEntries: WorldbookEntry[] = [
      { name: '档案·白凌', content: '白凌档案', enabled: true, keys: ['白凌'] },
      { name: '摘要·001-010', content: '前10层阶段摘要', enabled: true, extra: { from: 1, to: 10 } },
      { name: '摘要·001-020', content: '1至20层越界大摘要', enabled: true },
      { name: '摘要·大·001-020', content: '大摘要越界条目', enabled: true },
      { name: '摘要·中·011-015', content: '中摘要越界条目', enabled: true },
      { name: '摘要·自定义标记', content: '通过 extra.to 标记的越界摘要', enabled: true, extra: { to: 16 } },
    ];

    // 纯函数验证
    const clonedPure = computeBranchClonedEntries(sourceEntries, [], 12);
    expect(clonedPure.map(e => e.name)).toEqual(['档案·白凌', '摘要·001-010']);

    // ensureBranchWorldbookIsolation 端到端验证
    const gw = createFakeWorldbookGateway({ [mainBook]: sourceEntries }, mainBook);
    writeTimelineLedger(draft => {
      draft.originChatId = 'chat_main_summary_test';
      draft.boundBookName = mainBook;
      draft.maxFloorWatermark = 20;
    });

    const res = await ensureBranchWorldbookIsolation({
      currentChatId: 'chat_branch_at_12',
      branchMaxFloor: 12,
      gateway: gw,
      now: new Date('2026-10-19T13:10:00Z'),
    });

    expect(res.branched).toBe(true);
    const branchEntries = await gw.getWorldbook(res.clonedBookName);
    expect(branchEntries.map(e => e.name)).toEqual(['档案·白凌', '摘要·001-010']);
  });
});
