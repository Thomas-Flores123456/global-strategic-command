/**
 * FD-47 · W1 专项单元测试：
 * 覆盖 `saveBackupService.ts`、`importSave.ts`（`save_schema` / `card_meta` / `readSavePackFromFile`）
 * 以及 `App.vue` / `Step4Launch.vue` 本地 `.json` 备份文件选择导入接线。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  parseSavePack,
  readSavePackFromFile,
  type SavePackWorldbookEntry,
} from '../../../开场启动器/importSave';
import { migrateV1toV2, Schema } from '../../../红警指挥系统/core/schema';
import {
  backupBoundWorldbooks,
  buildCurrentSavePack,
  CURRENT_SAVE_SCHEMA,
  downloadSavePackAsFile,
  executeOneClickBackup,
  readCurrentChatSaveSchema,
   resolveLatestExportFloor,
  restoreSavePackInPlace,
  writeCurrentChatSaveSchema,
} from '../saveBackupService';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_VUE_SRC = readFileSync(resolve(__dirname, '../../../开场启动器/App.vue'), 'utf8');
const STEP4_VUE_SRC = readFileSync(
  resolve(__dirname, '../../../开场启动器/steps/Step4Launch.vue'),
  'utf8',
);

const TAVERN_GLOBALS = [
  'getVariables',
  'updateVariablesWith',
  'insertOrAssignVariables',
  'replaceVariables',
  'getLastMessageId',
  'getCurrentMessageId',
  'getChatMessages',
  'getCurrentChatName',
  'getCurrentCharacterName',
  'getCharacter',
  'getCharWorldbookNames',
  'getChatWorldbookName',
  'getOrCreateChatWorldbook',
  'getWorldbook',
  'createOrReplaceWorldbook',
  'replaceWorldbook',
  'updateWorldbookWith',
  'createWorldbook',
  'SillyTavern',
] as const;

function clearTavernGlobals() {
  const g = globalThis as Record<string, unknown>;
  for (const k of TAVERN_GLOBALS) {
    delete g[k];
  }
}

function makeSampleStatData(credits = 3500) {
  return Schema.parse(
    migrateV1toV2({
      meta: { world_id: 'cyber2042', date: '2042-05-12', location: '恶土前哨' },
      economy: { credits },
      bases: [{ id: 'badlands_outpost', name: '恶土一号基地', location: '夜之城外围' }],
      tech: { done: ['化石燃料发电学', '风光发电学'] },
    }),
  );
}

function installMockDom() {
  const clickedAnchors: { href: string; download: string; style: Record<string, string> }[] = [];
  const appendedNodes: unknown[] = [];
  const removedNodes: unknown[] = [];

  const mockDoc = {
    body: {
      appendChild(node: { parentNode?: unknown }) {
        node.parentNode = mockDoc.body;
        appendedNodes.push(node);
        return node;
      },
      removeChild(node: { parentNode?: unknown }) {
        node.parentNode = null;
        removedNodes.push(node);
        return node;
      },
    },
    createElement(tag: string) {
      if (tag === 'a') {
        const anchor = {
          href: '',
          download: '',
          style: {} as Record<string, string>,
          parentNode: null as unknown,
          click() {
            clickedAnchors.push({
              href: anchor.href,
              download: anchor.download,
              style: { ...anchor.style },
            });
          },
        };
        return anchor;
      }
      return {};
    },
  };

  const g = globalThis as Record<string, unknown>;
  g.document = mockDoc;
  g.window = {
    document: mockDoc,
  };
  return { clickedAnchors, appendedNodes, removedNodes };
}

describe('FD-47 · W1 saveBackupService & importSave 全链路单测', () => {
  beforeEach(() => {
    clearTavernGlobals();
  });

  afterEach(() => {
    clearTavernGlobals();
    const g = globalThis as Record<string, unknown>;
    delete g.document;
    delete g.window;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('1. 最新楼为无 stat_data 的 User 楼时，buildCurrentSavePack 向上回溯提取最近有效 AI 楼层 stat_data 并附带 save_schema: 2 与全保真 chat_worldbook_entries', async () => {
    const g = globalThis as Record<string, unknown>;
    const aiStat = makeSampleStatData(4800);
    const fullWbEntry: SavePackWorldbookEntry = {
      name: '档案·白凌',
      comment: '机娘核心档案',
      content: '白凌 Lv.3 战术记录',
      enabled: true,
      keys: ['白凌', '基地车'],
      position: { type: 'after_character_definition', order: 210, depth: 4 },
      strategy: { type: 'selective', keys: ['白凌'], scanDepth: 2 },
      recursion: { prevent_incoming: false, prevent_outgoing: true, delay_until: null },
      extra: { tier: 3 },
    };

    // 楼层布局：#5 为刚发出的 User 楼（无 stat_data），#4 为隐藏系统楼，#3 为有效 AI 楼层
    g.getLastMessageId = () => 5;
    g.getChatMessages = (id: number) => {
      if (id === 5) return [{ role: 'user', is_hidden: false }];
      if (id === 4) return [{ role: 'assistant', is_hidden: true }];
      return [{ role: 'assistant', is_hidden: false }];
    };
    g.getVariables = (o: { type: string; message_id?: number }) => {
      if (o.type === 'chat') {
        return {
          $parse: { lastParsedFloor: 3 },
          $dlc: [{ id: 'dlc_01', name: '测试扩展包' }],
          $timeline: { version: 1, originChatId: 'chat_old', boundBookName: '红警档案_chat_old', floors: {} },
        };
      }
      if (o.type === 'message' && o.message_id === 3) {
        return { stat_data: aiStat };
      }
      return {};
    };
    g.getCurrentChatName = () => '夜之城战役_01';
    g.SillyTavern = {
      characterId: 0,
      characters: [
        {
          name: '全域战略指挥系统',
          avatar: '全域战略指挥系统1.png',
          data: { character_version: '1.2.0' },
        },
      ],
    };
    g.getChatWorldbookName = () => '红警档案_夜之城战役_01';
    g.getWorldbook = async (name: string) => {
      expect(name).toBe('红警档案_夜之城战役_01');
      return [fullWbEntry];
    };

    const floorProbe = resolveLatestExportFloor();
    expect(floorProbe.mid).toBe(3);

    const res = await buildCurrentSavePack();
    expect(res.ok).toBe(true);
    expect(res.floorId).toBe(3);
    expect(res.charName).toBe('全域战略指挥系统');
    expect(res.cardVersion).toBe('1.2.0');
    expect(res.pack).toBeDefined();
    expect(res.pack!.version).toBe(2);
    expect(res.pack!.kind).toBe('redalert-save');
    expect(res.pack!.save_schema).toBe(CURRENT_SAVE_SCHEMA);
    expect(res.pack!.card_meta).toEqual({
      name: '全域战略指挥系统',
      version: '1.2.0',
      avatar: '全域战略指挥系统1.png',
    });
    expect(res.pack!.stat_data.economy.credits).toBe(4800);
    expect(res.pack!.chat_worldbook_entries).toEqual([fullWbEntry]);

    // 验证导出的 JSON 字符串可被 parseSavePack 无损解析还原
    const parsed = parseSavePack(res.jsonText!);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.pack.save_schema).toBe(2);
      expect(parsed.pack.card_meta).toEqual({
        name: '全域战略指挥系统',
        version: '1.2.0',
        avatar: '全域战略指挥系统1.png',
      });
      expect(parsed.pack.chat_worldbook_entries).toEqual([fullWbEntry]);
    }
  });

  it('2. downloadSavePackAsFile 触发 <a download> 且在 10 秒前未提前调用 URL.revokeObjectURL（TRAP-05 防护）', () => {
    vi.useFakeTimers();
    const { clickedAnchors } = installMockDom();

    const createObjectURLSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:https://tavern.local/mock-save-pack-id');
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const samplePack = {
      version: 2 as const,
      kind: 'redalert-save' as const,
      exportedAt: '2026-10-28T08:00:00.000Z',
      source: { chat: '测试/聊天:A*1', message_id: 8 },
      stat_data: makeSampleStatData(2000),
      save_schema: 2,
      card_meta: {
        name: '红警系统:测试卡',
        version: 'v1.3.0',
      },
    };

    const dl = downloadSavePackAsFile(samplePack);
    expect(dl.ok).toBe(true);
    expect(dl.fileName).toMatch(
      /^红警战局备份_红警系统_测试卡_测试_聊天_A_1_v1\.3\.0_楼8_\d{8}-\d{6}\.json$/,
    );
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(clickedAnchors).toHaveLength(1);
    expect(clickedAnchors[0].href).toBe('blob:https://tavern.local/mock-save-pack-id');
    expect(clickedAnchors[0].download).toBe(dl.fileName);

    // 关键断言：点击后以及 9,999ms 时绝不能提前调用 revokeObjectURL
    expect(revokeObjectURLSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(9_999);
    expect(revokeObjectURLSpy).not.toHaveBeenCalled();

    // 到达 10,000ms 时才释放 Blob URL
    vi.advanceTimersByTime(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:https://tavern.local/mock-save-pack-id');
  });

  it('3. backupBoundWorldbooks 正确克隆 primary 主世界书与 chat 绑定世界书', async () => {
    const g = globalThis as Record<string, unknown>;
    const createdBooks: Record<string, unknown[]> = {};

    g.getCharWorldbookNames = () => ({
      primary: '红警核心设定集',
      additional: ['修真世界扩展'],
    });
    g.getChatWorldbookName = () => '红警战史档案_当前会话';
    g.getWorldbook = async (name: string) => {
      if (name === '红警核心设定集') {
        return [{ name: '核心规则', content: '主书内容', enabled: true }];
      }
      if (name === '红警战史档案_当前会话') {
        return [{ name: '机娘·白凌', content: '聊天档案内容', enabled: true }];
      }
      return [];
    };
    g.createOrReplaceWorldbook = async (name: string, entries: unknown[]) => {
      createdBooks[name] = entries;
    };

    const res = await backupBoundWorldbooks('v1.2.0');
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.clonedWorldbooks).toEqual([
      '红警核心设定集_v1.2.0备份',
      '红警战史档案_当前会话_v1.2.0备份',
    ]);
    expect(createdBooks['红警核心设定集_v1.2.0备份']).toEqual([
      { name: '核心规则', content: '主书内容', enabled: true },
    ]);
    expect(createdBooks['红警战史档案_当前会话_v1.2.0备份']).toEqual([
      { name: '机娘·白凌', content: '聊天档案内容', enabled: true },
    ]);
  });

  it('4. restoreSavePackInPlace 原位恢复 stat_data、重锚定 $timeline.originChatId、写入 $save_schema 并恢复世界书词条', async () => {
    const g = globalThis as Record<string, unknown>;
    const messageVarsStore: Record<number, Record<string, unknown>> = {
      0: {},
      4: { stat_data: makeSampleStatData(1000) },
    };
    let chatVarsStore: Record<string, unknown> = {
      $save_schema: 1,
    };
    const replacedWorldbooks: Record<string, unknown[]> = {};

    g.getLastMessageId = () => 4;
    g.getChatMessages = () => [{ role: 'assistant', is_hidden: false }];
    g.getCurrentChatName = () => '新开战局_20261028';
    g.getVariables = (o: { type: string; message_id?: number }) => {
      if (o.type === 'chat') return chatVarsStore;
      if (o.type === 'message' && typeof o.message_id === 'number') {
        return messageVarsStore[o.message_id] ?? {};
      }
      return {};
    };
    g.updateVariablesWith = async (
      updater: (v: Record<string, unknown>) => Record<string, unknown>,
      o: { type: string; message_id?: number },
    ) => {
      if (o.type === 'chat') {
        chatVarsStore = updater(chatVarsStore);
      } else if (o.type === 'message' && typeof o.message_id === 'number') {
        messageVarsStore[o.message_id] = updater(messageVarsStore[o.message_id] ?? {});
      }
    };
    g.getChatWorldbookName = () => '当前聊天专属档案书';
    g.replaceWorldbook = async (name: string, entries: unknown[]) => {
      replacedWorldbooks[name] = entries;
    };

    expect(readCurrentChatSaveSchema()).toBe(1);

    const backupPack = {
      version: 2,
      kind: 'redalert-save' as const,
      exportedAt: '2026-10-28T09:00:00.000Z',
      source: { chat: '旧战局_A', message_id: 12 },
      stat_data: makeSampleStatData(9200),
      save_schema: 2,
      parse_state: { floor: 12, status: 'ok' },
      dlc_registry: [{ id: 'dlc_ra3', name: '日升帝国' }],
      timeline_ledger: {
        version: 1,
        originChatId: '旧战局_A',
        boundBookName: '旧聊天档案书',
        maxFloorWatermark: 12,
        floors: {},
      },
      chat_worldbook_entries: [
        {
          name: '档案·百合子',
          content: '超能力特种兵档案',
          enabled: true,
          keys: ['百合子'],
        },
      ],
    };

    const restoreRes = await restoreSavePackInPlace(JSON.stringify(backupPack));
    expect(restoreRes.ok).toBe(true);
    expect(restoreRes.restoredFloorId).toBe(4);
    expect(restoreRes.restoredWorldbookEntriesCount).toBe(1);
    expect(restoreRes.saveSchema).toBe(2);

    // 验证楼层 #4 的 stat_data 已被覆写为 9200 资金
    const restoredStat = messageVarsStore[4]?.stat_data as Schema;
    expect(restoredStat.economy.credits).toBe(9200);

    // 验证 chatVars 中的 $timeline.originChatId 已重锚定为当前聊天名称，且 $save_schema 已更新为 2
    expect(chatVarsStore.$save_schema).toBe(2);
    expect(chatVarsStore.$parse).toEqual({ floor: 12, status: 'ok' });
    expect(chatVarsStore.$dlc).toEqual([{ id: 'dlc_ra3', name: '日升帝国' }]);
    const restoredTimeline = chatVarsStore.$timeline as Record<string, unknown>;
    expect(restoredTimeline.originChatId).toBe('新开战局_20261028');
    expect(restoredTimeline.boundBookName).toBe('当前聊天专属档案书');

    // 验证世界书词条已写回
    expect(replacedWorldbooks['当前聊天专属档案书']).toHaveLength(1);
    expect(replacedWorldbooks['当前聊天专属档案书'][0]).toMatchObject({
      name: '档案·百合子',
      content: '超能力特种兵档案',
      enabled: true,
      keys: ['百合子'],
    });

    // 验证 writeCurrentChatSaveSchema 辅助函数
    writeCurrentChatSaveSchema(3);
    expect(readCurrentChatSaveSchema()).toBe(3);
  });

  it('5. readSavePackFromFile 解析 .json 文件对象（支持 File.text() 与 FileReader 降级）及 executeOneClickBackup 串联', async () => {
    const samplePack = {
      version: 2,
      kind: 'redalert-save',
      exportedAt: '2026-10-28T10:00:00.000Z',
      source: { chat: '战局快照_99', message_id: 6 },
      stat_data: makeSampleStatData(6600),
      save_schema: 2,
      card_meta: {
        name: '红警指挥系统',
        version: '1.5.0',
      },
    };
    const jsonStr = JSON.stringify(samplePack);
    const file = new File([jsonStr], 'backup.json', { type: 'application/json' });

    const fileRes = await readSavePackFromFile(file);
    expect(fileRes.ok).toBe(true);
    if (fileRes.ok) {
      expect(fileRes.pack.stat_data.economy.credits).toBe(6600);
      expect(fileRes.pack.save_schema).toBe(2);
      expect(fileRes.pack.card_meta?.version).toBe('1.5.0');
    }

    // 验证损坏 JSON 文件不抛异常，返回 ok: false
    const badFile = new File(['{not-valid-json'], 'broken.json', { type: 'application/json' });
    const badRes = await readSavePackFromFile(badFile);
    expect(badRes.ok).toBe(false);

    // 验证 App.vue 与 Step4Launch.vue 已包含要求的文件选择上传 testid 与接线
    expect(APP_VUE_SRC).toContain('data-testid="top-import-file-input"');
    expect(APP_VUE_SRC).toContain('选择备份文件 (.json) 导入');
    expect(STEP4_VUE_SRC).toContain('data-testid="step4-import-file-btn"');
    expect(STEP4_VUE_SRC).toContain('data-testid="step4-import-file-input"');
    expect(STEP4_VUE_SRC).toContain('readSavePackFromFile');

    // 验证 executeOneClickBackup 串联执行
    const { clickedAnchors } = installMockDom();
    const g = globalThis as Record<string, unknown>;
    g.getLastMessageId = () => 2;
    g.getChatMessages = () => [{ role: 'assistant', is_hidden: false }];
    g.getVariables = (o: { type: string }) =>
      o.type === 'message' ? { stat_data: makeSampleStatData(7700) } : {};
    g.getCharWorldbookNames = () => ({ primary: '主设定书' });
    g.getWorldbook = async () => [{ name: '条目1', content: '内容1' }];
    g.createOrReplaceWorldbook = async () => {};

    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-one-click');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const oneClick = await executeOneClickBackup({
      downloadFile: true,
      copyToClipboard: false,
      cloneWorldbooks: true,
      versionTag: '1.5.0',
    });
    expect(oneClick.ok).toBe(true);
    expect(oneClick.fileDownloaded).toBe(true);
    expect(clickedAnchors).toHaveLength(1);
    expect(oneClick.clonedWorldbooks).toEqual(['主设定书_v1.5.0备份']);
    expect(oneClick.floorId).toBe(2);
  });
});
