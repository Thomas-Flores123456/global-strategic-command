/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读 SFC 源码进行静态契约断言 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThEntry } from '../worldbook/girlFiler';
import {
  applyDataPatchToEntries,
  applyPatchToDataBlock,
  AUTO_APPLY_KEY,
  calculateDataDiff,
  DATA_BLOCK_REGEX,
  fileDataPatch,
  findTargetEntry,
  FORBIDDEN_PATCH_KEYS,
  describeQuarantine,
  getAutoApplyPreference,
  pickQuarantineCandidate,
  QUARANTINE_SUGGESTIONS,
  renderDataBlock,
  setAutoApplyPreference,
  validatePatchPayload,
} from '../worldbook/worldbookDataFiler';
import type { DataPatch } from '../core/schema';
import * as sysCheck from '../parse/systemCheck';
import * as useCat from '../composables/useCatalog';
import type { ChatBookGatewayLike } from '../worldbook/chatBookBinding';
import { GuardError } from '../worldbook/chatBookBinding';

// 真实条目测试夹具：红警 04·战车工厂
function makeWarFactoryEntry(): ThEntry {
  const content = `[通用·主建筑 | 战车工厂]
建造2000 · 耗电50 · 周期T2级（数周）· 前置研究：装甲载具工学。
核心功能：生产装甲载具、机动平台、运输载具及大型工程机械。
附加功能：基础维修泊位——可对受损载具慢速修复，效率约为专用维修所四成。
解锁下游：战地维修工程学研究资质。

<数据>
{
  "schema_version": 1,
  "type": "building",
  "id": "战车工厂",
  "cost": 2000,
  "power": 50,
  "tier": 1,
  "tags": [
    "主建筑",
    "载具建造",
    "重型装甲",
    "陆军核心"
  ],
  "research": "装甲载具工学",
  "prereqs": [
    "装甲载具工学"
  ],
  "need_buildings": [],
  "outputs": {
    "virtual": {
      "repair_rate": 20
    }
  }
}
</数据>`;

  return {
    uid: 3,
    name: '04·战车工厂',
    comment: '04·战车工厂',
    key: ['战车工厂', '采矿车'],
    order: 40003,
    enabled: true,
    position: { type: 'before_character_definition', order: 40003 },
    strategy: { type: 'selective', keys: ['战车工厂', '采矿车'] },
    content,
  };
}

describe('worldbookDataFiler · 安全红线校验（validatePatchPayload）', () => {
  it('合规 Schema 字段顺利通过', () => {
    const payload = {
      outputs: {
        resources: { 标准纳米工料: 10 },
      },
      tags: ['纳米喷涂', '快速维修'],
      power: 60,
    };
    const res = validatePatchPayload(payload);
    expect(res.valid).toBe(true);
    expect(res.violations).toHaveLength(0);
  });

  it('严禁注入 uid 字段（硬性拦截）', () => {
    const res = validatePatchPayload({ uid: 999, cost: 1000 });
    expect(res.valid).toBe(false);
    expect(res.violations).toContain('uid');
  });

  it('严禁注入 key / keys / order / comment / content / 正文 / 自然叙述', () => {
    for (const forbidden of FORBIDDEN_PATCH_KEYS) {
      const res = validatePatchPayload({ [forbidden]: '恶意注入', cost: 1000 });
      expect(res.valid).toBe(false);
      expect(res.violations).toContain(forbidden);
    }
  });

  it('容忍大小写与全半角变体拦截（如 UID、ＣＯＭＭＥＮＴ）', () => {
    const res = validatePatchPayload({ UID: 123, ｃｏｍｍｅｎｔ: '测试' });
    expect(res.valid).toBe(false);
    expect(res.violations).toHaveLength(2);
  });

  it('非对象或空载荷安全拒绝', () => {
    expect(validatePatchPayload(null).valid).toBe(false);
    expect(validatePatchPayload('string').valid).toBe(false);
    expect(validatePatchPayload([1, 2, 3]).valid).toBe(false);
  });
});

describe('worldbookDataFiler · 差异计算引擎（calculateDataDiff）', () => {
  it('识别字段的新增、修改与删除', () => {
    const oldData = {
      cost: 2000,
      power: 50,
      deprecatedField: 'old',
      outputs: {
        virtual: { repair_rate: 20 },
      },
    };
    const newData = {
      cost: 2200, // modified
      power: 50, // unchanged
      newField: 'fresh', // added
      outputs: {
        virtual: { repair_rate: 25 }, // modified
        resources: { 铁矿石: 10 }, // added
      },
      // deprecatedField deleted
    };

    const diff = calculateDataDiff(oldData, newData, '战车工厂');
    expect(diff.hasChanges).toBe(true);

    const changes = diff.changes;
    expect(changes.find(c => c.path === 'cost')).toEqual({
      path: 'cost',
      type: 'modified',
      oldValue: 2000,
      newValue: 2200,
    });
    expect(changes.find(c => c.path === 'deprecatedField')).toEqual({
      path: 'deprecatedField',
      type: 'deleted',
      oldValue: 'old',
    });
    expect(changes.find(c => c.path === 'newField')).toEqual({
      path: 'newField',
      type: 'added',
      newValue: 'fresh',
    });
    expect(changes.find(c => c.path === 'outputs.virtual.repair_rate')).toEqual({
      path: 'outputs.virtual.repair_rate',
      type: 'modified',
      oldValue: 20,
      newValue: 25,
    });
    expect(changes.find(c => c.path === 'outputs.resources')).toEqual({
      path: 'outputs.resources',
      type: 'added',
      newValue: { 铁矿石: 10 },
    });
  });

  it('无任何变更时 hasChanges 为 false', () => {
    const data = { cost: 1000, tags: ['A', 'B'] };
    const diff = calculateDataDiff(data, { cost: 1000, tags: ['A', 'B'] });
    expect(diff.hasChanges).toBe(false);
    expect(diff.changes).toHaveLength(0);
  });
});

describe('worldbookDataFiler · patch 合并纯函数（applyPatchToDataBlock）', () => {
  it('增量 patch 操作：深度递归合并对象，保留未被修改的既有字段', () => {
    const original = {
      id: '战车工厂',
      cost: 2000,
      power: 50,
      outputs: {
        virtual: { repair_rate: 20 },
      },
    };
    const patch = {
      power: 40,
      outputs: {
        resources: { 标准纳米工料: 10 },
      },
    };
    const merged = applyPatchToDataBlock(original, patch, 'patch');
    expect(merged.id).toBe('战车工厂');
    expect(merged.cost).toBe(2000);
    expect(merged.power).toBe(40);
    expect(merged.outputs).toEqual({
      virtual: { repair_rate: 20 },
      resources: { 标准纳米工料: 10 },
    });
  });

  it('标签数组（tags）联合去重合并', () => {
    const original = {
      id: '战车工厂',
      tags: ['主建筑', '载具建造', '重型装甲'],
    };
    const patch = {
      tags: ['载具建造', '纳米喷涂', '快速维修'],
    };
    const merged = applyPatchToDataBlock(original, patch, 'patch');
    expect(merged.tags).toEqual(['主建筑', '载具建造', '重型装甲', '纳米喷涂', '快速维修']);
  });

  it('配方列表（recipes）按 recipe.id upsert（已有修改、新配方追加）', () => {
    const original = {
      id: '战车工厂',
      recipes: [
        { id: 'r1', name: '标准配方', is_default: true, inputs: { credits: 100 } },
        { id: 'r2', name: '重载配方', is_default: false, inputs: { credits: 200 } },
      ],
    };
    const patch = {
      recipes: [
        { id: 'r1', inputs: { credits: 80 } }, // update r1
        { id: 'r3', name: '快速代偿配方', is_default: false, inputs: { credits: 50 } }, // insert r3
      ],
    };
    const merged = applyPatchToDataBlock(original, patch, 'patch');
    const recipes = merged.recipes as any[];
    expect(recipes).toHaveLength(3);
    expect(recipes.find(r => r.id === 'r1')).toEqual({
      id: 'r1',
      name: '标准配方',
      is_default: true,
      inputs: { credits: 80 },
    });
    expect(recipes.find(r => r.id === 'r2').inputs.credits).toBe(200);
    expect(recipes.find(r => r.id === 'r3').name).toBe('快速代偿配方');
  });

  it('工况列表（conditions）按 trigger upsert', () => {
    const original = {
      id: '发电厂',
      operation: {
        conditions: [{ trigger: 'low_power', behavior: 'degraded', efficiency: 0.5, desc: '低电降频' }],
      },
    };
    const patch = {
      operation: {
        conditions: [
          { trigger: 'low_power', efficiency: 0.2, desc: '极度低电' },
          { trigger: 'night', behavior: 'idle', desc: '夜间怠速' },
        ],
      },
    };
    const merged = applyPatchToDataBlock(original, patch, 'patch');
    const conds = (merged.operation as any).conditions;
    expect(conds).toHaveLength(2);
    expect(conds.find((c: any) => c.trigger === 'low_power')).toEqual({
      trigger: 'low_power',
      behavior: 'degraded',
      efficiency: 0.2,
      desc: '极度低电',
    });
    expect(conds.find((c: any) => c.trigger === 'night')).toEqual({
      trigger: 'night',
      behavior: 'idle',
      desc: '夜间怠速',
    });
  });

  it('replace 操作：保留 id / type / schema_version，其余字段全量覆盖', () => {
    const original = {
      schema_version: 1,
      type: 'building',
      id: '战车工厂',
      name: '战车工厂',
      cost: 2000,
      power: 50,
      tags: ['旧标签'],
      outputs: { virtual: { repair_rate: 20 } },
    };
    const patch = {
      cost: 2500,
      power: 80,
      tags: ['新全量标签'],
    };
    const replaced = applyPatchToDataBlock(original, patch, 'replace');
    expect(replaced.id).toBe('战车工厂');
    expect(replaced.type).toBe('building');
    expect(replaced.cost).toBe(2500);
    expect(replaced.power).toBe(80);
    expect(replaced.tags).toEqual(['新全量标签']);
    expect(replaced.outputs).toBeUndefined(); // 被替换清除
  });
});

describe('worldbookDataFiler · 条目定位（findTargetEntry）', () => {
  it('通过 <数据>.id 精确定位条目', () => {
    const entries = [makeWarFactoryEntry()];
    const found = findTargetEntry(entries, '战车工厂');
    expect(found.entry).toBeDefined();
    expect(found.dataJson?.id).toBe('战车工厂');
    expect(found.error).toBeUndefined();
  });

  it('通过条目标题 name 或 comment 模糊定位', () => {
    const entry = makeWarFactoryEntry();
    entry.content = entry.content?.replace('"id": "战车工厂"', '"id": "soviet_war_factory"');
    const entries = [entry];

    const found = findTargetEntry(entries, '04·战车工厂');
    expect(found.entry).toBeDefined();
    expect(found.dataJson?.id).toBe('soviet_war_factory');
  });

  it('目标未命中安全返回错误对象', () => {
    const entries = [makeWarFactoryEntry()];
    const found = findTargetEntry(entries, '不存在的建筑');
    expect(found.entry).toBeUndefined();
    expect(found.error).toContain('未能在世界书条目中定位到目标');
  });

  it('条目存在但缺少 <数据> 块安全返回隔离错误', () => {
    const entries: ThEntry[] = [
      {
        uid: 10,
        name: '空建筑',
        content: '这是纯文本条目，没有数据标签。',
      },
    ];
    const found = findTargetEntry(entries, '空建筑');
    expect(found.entry).toBeDefined();
    expect(found.dataJson).toBeUndefined();
    expect(found.error).toContain('未包含标准 <数据> 块');
  });

  it('条目 <数据> 块 JSON 损坏时安全隔离', () => {
    const entries: ThEntry[] = [
      {
        uid: 11,
        name: '损坏建筑',
        content: '介绍...\n<数据>\n{ 非法 JSON 语法\n</数据>',
      },
    ];
    const found = findTargetEntry(entries, '损坏建筑');
    expect(found.entry).toBeDefined();
    expect(found.dataJson).toBeUndefined();
    expect(found.error).toContain('JSON 解析损坏');
  });
});

describe('worldbookDataFiler · 纯函数原子替换（applyDataPatchToEntries）与不变性断言', () => {
  it('真实回环验证：按 §3.12 规范写入战车工厂改装补丁', () => {
    const entry = makeWarFactoryEntry();
    const originalContent = entry.content!;
    const entries = [entry];

    const patch: DataPatch = {
      id: 'patch_test_01',
      target: '战车工厂',
      operation: 'patch',
      patch: {
        outputs: {
          resources: {
            标准纳米工料: 10,
          },
        },
        tags: ['纳米喷涂', '快速维修'],
      },
      reason: '指挥官与白凌现场对战车工厂进行了技术改装，加装纳米喷涂泊位',
      timestamp: Date.now(),
      status: 'pending',
    };

    const res = applyDataPatchToEntries(entries, patch);
    expect(res.success).toBe(true);
    expect(res.action).toBe('patched');
    expect(res.target).toBe('战车工厂');

    // 1. 元数据 100% 逐字不变
    expect(entry.uid).toBe(3);
    expect(entry.name).toBe('04·战车工厂');
    expect(entry.comment).toBe('04·战车工厂');
    expect(entry.order).toBe(40003);
    expect(entry.key).toEqual(['战车工厂', '采矿车']);

    // 2. 正文自然叙述逐字不变
    const originalNarrative = originalContent.split('<数据>')[0];
    const newNarrative = entry.content!.split('<数据>')[0];
    expect(newNarrative).toBe(originalNarrative);

    // 3. 仅 <数据> 块被原子更新
    const m = entry.content!.match(DATA_BLOCK_REGEX);
    expect(m).not.toBeNull();
    const updatedData = JSON.parse(m![1]);
    expect(updatedData.id).toBe('战车工厂');
    expect(updatedData.cost).toBe(2000); // 保留
    expect(updatedData.power).toBe(50); // 保留
    expect(updatedData.outputs).toEqual({
      virtual: { repair_rate: 20 }, // 既有保留
      resources: { 标准纳米工料: 10 }, // 增量并入
    });
    expect(updatedData.tags).toEqual(['主建筑', '载具建造', '重型装甲', '陆军核心', '纳米喷涂', '快速维修']);
  });

  it('安全红线违背：尝试注入 uid / comment 时拒绝合入并标记隔离，条目内容完全不被修改', () => {
    const entry = makeWarFactoryEntry();
    const originalContent = entry.content!;
    const entries = [entry];

    const evilPatch: DataPatch = {
      id: 'evil_patch_01',
      target: '战车工厂',
      operation: 'patch',
      patch: {
        uid: 9999, // 试图篡改 uid
        comment: '篡改注释',
        power: 10,
      },
      reason: '恶意注入',
      timestamp: Date.now(),
      status: 'pending',
    };

    const res = applyDataPatchToEntries(entries, evilPatch);
    expect(res.success).toBe(false);
    expect(res.action).toBe('quarantined');
    expect(res.error).toContain('安全红线拦截');

    // 条目必须保持原封不动
    expect(entry.content).toBe(originalContent);
  });

  it('目标未命中安全隔离，条目内容完全不被修改', () => {
    const entry = makeWarFactoryEntry();
    const originalContent = entry.content!;
    const entries = [entry];

    const missingPatch: DataPatch = {
      id: 'missing_01',
      target: '不存在的基地',
      operation: 'patch',
      patch: { power: 10 },
      reason: '无目标测试',
      timestamp: Date.now(),
      status: 'pending',
    };

    const res = applyDataPatchToEntries(entries, missingPatch);
    expect(res.success).toBe(false);
    expect(res.action).toBe('quarantined');
    expect(entry.content).toBe(originalContent);
  });

  it('CHATBOOK-GRAPH-01：补丁包含新 name / upgraded_name / aliases 时自动幂等同步至 strategy.keys 并返回前后快照', async () => {
    const entry = makeWarFactoryEntry();
    const originalContent = entry.content!;
    const entries = [entry];

    const patch: DataPatch = {
      id: 'patch_alias_sync_01',
      target: '战车工厂',
      operation: 'patch',
      patch: {
        name: '战车工厂·改',
        upgraded_name: '重装纳米机甲总厂',
        aliases: ['纳米车厂', '重工二厂', '采矿车', ' '],
      },
      reason: '完成二期重装纳米产线升级并授予新呼号',
      timestamp: Date.now(),
      status: 'pending',
    };

    const res = applyDataPatchToEntries(entries, patch);
    expect(res.success).toBe(true);
    expect(res.beforeEntrySnapshot).toEqual({
      name: '04·战车工厂',
      content: originalContent,
      enabled: true,
      keys: ['战车工厂', '采矿车'],
    });
    expect(res.afterEntrySnapshot).toBeDefined();
    expect(res.afterEntrySnapshot?.name).toBe('04·战车工厂');
    expect(res.afterEntrySnapshot?.enabled).toBe(true);
    expect(res.afterEntrySnapshot?.keys).toEqual([
      '战车工厂',
      '采矿车',
      '战车工厂·改',
      '重装纳米机甲总厂',
      '纳米车厂',
      '重工二厂',
    ]);
    expect(entry.strategy?.keys).toEqual([
      '战车工厂',
      '采矿车',
      '战车工厂·改',
      '重装纳米机甲总厂',
      '纳米车厂',
      '重工二厂',
    ]);
    expect(entry.key).toEqual([
      '战车工厂',
      '采矿车',
      '战车工厂·改',
      '重装纳米机甲总厂',
      '纳米车厂',
      '重工二厂',
    ]);

    // 验证 fileDataPatch 回执同样透传 beforeEntrySnapshot / afterEntrySnapshot
    const freshEntry = makeWarFactoryEntry();
    vi.spyOn(sysCheck, 'tav').mockImplementation(((name: string) => {
      if (name === 'updateWorldbookWith') {
        return async (_bookName: string, updater: (e: ThEntry[]) => ThEntry[]) => updater([freshEntry]);
      }
      return undefined;
    }) as any);
    vi.spyOn(useCat, 'resolveActiveWorldbookNames').mockReturnValue(['通用·主建筑_世界书']);

    const receipt = await fileDataPatch(patch);
    expect(receipt.success).toBe(true);
    expect(receipt.beforeEntrySnapshot?.keys).toEqual(['战车工厂', '采矿车']);
    expect(receipt.afterEntrySnapshot?.keys).toContain('重装纳米机甲总厂');
    expect(receipt.afterEntrySnapshot?.keys).toContain('纳米车厂');
  });
});

describe('worldbookDataFiler · 酒馆落地层（fileDataPatch）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('成功调用 updateWorldbookWith 并触发 useCatalogStore 热重算', async () => {
    const entry = makeWarFactoryEntry();
    const entries = [entry];

    const mockUpdateWb = vi.fn(async (bookName: string, updater: (e: ThEntry[]) => ThEntry[]) => {
      updater(entries);
      return entries;
    });

    vi.spyOn(sysCheck, 'tav').mockImplementation(((name: string) => {
      if (name === 'updateWorldbookWith') return mockUpdateWb;
      return undefined;
    }) as any);

    vi.spyOn(useCat, 'resolveActiveWorldbookNames').mockReturnValue(['通用·主建筑_世界书']);
    const mockRefresh = vi.fn(async () => {});
    vi.spyOn(useCat, 'useCatalogStore').mockReturnValue({
      refresh: mockRefresh,
    } as any);

    const patch: DataPatch = {
      id: 'patch_test_落地',
      target: '战车工厂',
      operation: 'patch',
      patch: { power: 30 },
      reason: '节能改造',
      timestamp: Date.now(),
      status: 'pending',
    };

    const receipt = await fileDataPatch(patch);
    expect(receipt.success).toBe(true);
    expect(receipt.action).toBe('patched');
    expect(receipt.worldbook).toBe('通用·主建筑_世界书');
    expect(mockUpdateWb).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('API 不可用时抛出明确异常', async () => {
    vi.spyOn(sysCheck, 'tav').mockReturnValue(undefined);

    const patch: DataPatch = {
      id: 'patch_test_no_api',
      target: '战车工厂',
      operation: 'patch',
      patch: { power: 30 },
      reason: '测试',
      timestamp: Date.now(),
      status: 'pending',
    };

    await expect(fileDataPatch(patch)).rejects.toThrow('酒馆 API updateWorldbookWith 不可用');
  });
});

describe('worldbookDataFiler · 双轨分流三规则（CTRL-CHATBOOK-02 §3.1）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const chatBook = '红警档案·红警指挥系统·20260923T1000';
  const globalBook = '通用·主建筑_世界书';

  function makeMockGateway(boundBook: string = chatBook): ChatBookGatewayLike {
    return {
      begin: () => ({ chatId: 'chat-test-01' }),
      guardedBook: async () => boundBook,
    };
  }

  it('规则①：目标在当前聊天档案书时，走聊天轨落地（经守卫写入聊天书）', async () => {
    const chatEntry = makeWarFactoryEntry();
    chatEntry.content = chatEntry.content?.replace('战车工厂', '聊天线改装战车工厂');
    chatEntry.name = '04·聊天线改装战车工厂';

    const books: Record<string, ThEntry[]> = {
      [chatBook]: [chatEntry],
      [globalBook]: [makeWarFactoryEntry()],
    };

    const mockUpdateWb = vi.fn(async (bookName: string, updater: (e: ThEntry[]) => ThEntry[]) => {
      const cur = books[bookName] ?? [];
      const next = updater(cur);
      books[bookName] = next;
      return next;
    });

    vi.spyOn(sysCheck, 'tav').mockImplementation(((name: string) => {
      if (name === 'updateWorldbookWith') return mockUpdateWb;
      return undefined;
    }) as any);
    vi.spyOn(useCat, 'resolveActiveWorldbookNames').mockReturnValue([globalBook]);

    const patch: DataPatch = {
      id: 'patch_chat_01',
      target: '聊天线改装战车工厂',
      operation: 'patch',
      patch: { power: 35 },
      reason: '本线轻量化改装',
      timestamp: Date.now(),
      status: 'pending',
    };

    const receipt = await fileDataPatch(patch, undefined, makeMockGateway(chatBook));
    expect(receipt.success).toBe(true);
    expect(receipt.worldbook).toBe(chatBook);
    expect(receipt.action).toBe('patched');
    expect(books[chatBook][0].content).toContain('"power": 35');
    // 全局书未被修改
    expect(books[globalBook][0].content).toContain('"power": 50');
  });

  it('先聊天后全局遮蔽顺序断言：同名实体在聊天书与全局书皆有时，仅修改聊天书，全局书零改动', async () => {
    const chatEntry = makeWarFactoryEntry();
    const globalEntry = makeWarFactoryEntry();

    const books: Record<string, ThEntry[]> = {
      [chatBook]: [chatEntry],
      [globalBook]: [globalEntry],
    };

    const mockUpdateWb = vi.fn(async (bookName: string, updater: (e: ThEntry[]) => ThEntry[]) => {
      const cur = books[bookName] ?? [];
      const next = updater(cur);
      books[bookName] = next;
      return next;
    });

    vi.spyOn(sysCheck, 'tav').mockImplementation(((name: string) => {
      if (name === 'updateWorldbookWith') return mockUpdateWb;
      return undefined;
    }) as any);
    vi.spyOn(useCat, 'resolveActiveWorldbookNames').mockReturnValue([globalBook]);

    const patch: DataPatch = {
      id: 'patch_shadow_test',
      target: '战车工厂',
      operation: 'patch',
      patch: { power: 25 },
      reason: '本线特化升级',
      timestamp: Date.now(),
      status: 'pending',
    };

    const receipt = await fileDataPatch(patch, undefined, makeMockGateway(chatBook));
    expect(receipt.success).toBe(true);
    expect(receipt.worldbook).toBe(chatBook);

    // 聊天书条目成功被修改
    expect(books[chatBook][0].content).toContain('"power": 25');
    // 全局书条目逐字节保持不变（完全被遮蔽，零写入）
    expect(books[globalBook][0].content).toContain('"power": 50');
    expect(mockUpdateWb).toHaveBeenCalledTimes(1);
    expect(mockUpdateWb).toHaveBeenCalledWith(chatBook, expect.any(Function));
  });

  it('规则②：聊天书查无但全局书有时，走全局轨落地（保持现行行为恒等）', async () => {
    const globalEntry = makeWarFactoryEntry();
    const books: Record<string, ThEntry[]> = {
      [chatBook]: [],
      [globalBook]: [globalEntry],
    };

    const mockUpdateWb = vi.fn(async (bookName: string, updater: (e: ThEntry[]) => ThEntry[]) => {
      const cur = books[bookName] ?? [];
      const next = updater(cur);
      books[bookName] = next;
      return next;
    });

    vi.spyOn(sysCheck, 'tav').mockImplementation(((name: string) => {
      if (name === 'updateWorldbookWith') return mockUpdateWb;
      return undefined;
    }) as any);
    vi.spyOn(useCat, 'resolveActiveWorldbookNames').mockReturnValue([globalBook]);

    const patch: DataPatch = {
      id: 'patch_global_fallback',
      target: '战车工厂',
      operation: 'patch',
      patch: { power: 40 },
      reason: '全局设定演化',
      timestamp: Date.now(),
      status: 'pending',
    };

    const receipt = await fileDataPatch(patch, undefined, makeMockGateway(chatBook));
    expect(receipt.success).toBe(true);
    expect(receipt.worldbook).toBe(globalBook);
    expect(books[globalBook][0].content).toContain('"power": 40');
  });

  it('规则③：两处查无时，quarantined 留痕并提示「新实体请走扩展档案通道」', async () => {
    const books: Record<string, ThEntry[]> = {
      [chatBook]: [],
      [globalBook]: [makeWarFactoryEntry()],
    };

    const mockUpdateWb = vi.fn(async (bookName: string, updater: (e: ThEntry[]) => ThEntry[]) => {
      const cur = books[bookName] ?? [];
      const next = updater(cur);
      books[bookName] = next;
      return next;
    });

    vi.spyOn(sysCheck, 'tav').mockImplementation(((name: string) => {
      if (name === 'updateWorldbookWith') return mockUpdateWb;
      return undefined;
    }) as any);
    vi.spyOn(useCat, 'resolveActiveWorldbookNames').mockReturnValue([globalBook]);

    const patch: DataPatch = {
      id: 'patch_missing_entity',
      target: '全新神秘科技武器',
      operation: 'patch',
      patch: { power: 100 },
      reason: '剧情突发新造物',
      timestamp: Date.now(),
      status: 'pending',
    };

    const receipt = await fileDataPatch(patch, undefined, makeMockGateway(chatBook));
    expect(receipt.success).toBe(false);
    expect(receipt.action).toBe('quarantined');
    expect(receipt.error).toContain('新实体请走扩展档案通道');
  });

  it('聊天轨守卫失败（如 chat-id-drift）fail-closed 抛错，绝不降级写全局轨', async () => {
    const globalEntry = makeWarFactoryEntry();
    const books: Record<string, ThEntry[]> = {
      [globalBook]: [globalEntry],
    };

    const mockUpdateWb = vi.fn();
    vi.spyOn(sysCheck, 'tav').mockImplementation(((name: string) => {
      if (name === 'updateWorldbookWith') return mockUpdateWb;
      return undefined;
    }) as any);
    vi.spyOn(useCat, 'resolveActiveWorldbookNames').mockReturnValue([globalBook]);

    const driftingGateway: ChatBookGatewayLike = {
      begin: () => ({ chatId: 'chat-A' }),
      guardedBook: async () => {
        throw new GuardError({
          guard: 1,
          rule: 'chat-id-drift',
          expected: 'chatId=chat-A',
          actual: 'chatId=chat-B',
        });
      },
    };

    const patch: DataPatch = {
      id: 'patch_drift_fail',
      target: '战车工厂',
      operation: 'patch',
      patch: { power: 99 },
      reason: '漂移测试',
      timestamp: Date.now(),
      status: 'pending',
    };

    await expect(fileDataPatch(patch, undefined, driftingGateway)).rejects.toThrow('chat-id-drift');
    // 全局设定书未被执行任何写入
    expect(mockUpdateWb).not.toHaveBeenCalled();
    expect(books[globalBook][0].content).toContain('"power": 50');
  });
});

describe('worldbookDataFiler · 规则③隔离原因三分与去处建议（CTRL-PATCH-UX-01 ①）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const chatBook = '红警档案·红警指挥系统·20260923T1000';
  const girlBook = '全域战略指挥系统';
  const lastBook = '通用·主建筑_世界书';

  // 白凌式机娘档案：条目命中（标题含目标名），但正文没有 <数据> 块
  function makeGirlEntry(): ThEntry {
    return {
      uid: 88,
      name: '机娘·白凌',
      comment: '机娘·白凌',
      key: ['白凌'],
      content: '[机娘档案 | 白凌]\n战术分体态维修型机娘，擅长现场修复。',
    };
  }
  function makeCorruptEntry(): ThEntry {
    return {
      uid: 9,
      name: '05·磁能反应炉',
      comment: '05·磁能反应炉',
      content: '<数据>{ "id": "磁能反应炉", 损坏 </数据>',
    };
  }

  function wire(books: Record<string, ThEntry[]>, active: string[]) {
    const snapshot = JSON.stringify(books);
    const mockUpdateWb = vi.fn(async (bookName: string, updater: (e: ThEntry[]) => ThEntry[]) => {
      if (!books[bookName]) throw new Error(`世界书「${bookName}」不存在`);
      return (books[bookName] = updater(books[bookName]));
    });
    vi.spyOn(sysCheck, 'tav').mockImplementation(((name: string) =>
      name === 'updateWorldbookWith' ? mockUpdateWb : undefined) as any);
    vi.spyOn(useCat, 'resolveActiveWorldbookNames').mockReturnValue(active);
    return { unchanged: () => JSON.stringify(books) === snapshot };
  }
  const gw: ChatBookGatewayLike = { begin: () => ({ chatId: 'c1' }), guardedBook: async () => chatBook };
  const mk = (target: string): DataPatch => ({
    id: `patch_${target}`,
    target,
    operation: 'patch',
    patch: { 现场修复距离: 15 },
    reason: '剧情改装',
    timestamp: 1,
    status: 'pending',
  });

  it('未命中：任何书都找不到 → [未命中] + 建议「新实体请走扩展档案通道」', async () => {
    const env = wire({ [chatBook]: [], [lastBook]: [makeWarFactoryEntry()] }, [lastBook]);
    const r = await fileDataPatch(mk('全新神秘科技武器'), undefined, gw);
    expect(r.success).toBe(false);
    expect(r.quarantineReason).toBe('not-found');
    expect(r.suggestion).toBe('新实体请走扩展档案通道');
    expect(r.error).toContain('[未命中]');
    expect(r.error).toContain('建议：新实体请走扩展档案通道');
    expect(env.unchanged()).toBe(true);
  });

  it('命中但无数据块（白凌式）：即使命中书不是最后一本，也不被后续书的「未命中」覆盖', async () => {
    const env = wire({ [chatBook]: [], [girlBook]: [makeGirlEntry()], [lastBook]: [makeWarFactoryEntry()] }, [
      girlBook,
      lastBook,
    ]);
    const r = await fileDataPatch(mk('白凌'), undefined, gw);
    expect(r.success).toBe(false);
    expect(r.action).toBe('quarantined');
    expect(r.quarantineReason).toBe('no-data-block');
    expect(r.worldbook).toBe(girlBook);
    expect(r.suggestion).toBe('目标条目未结构化，改走机娘档案或人工处理');
    expect(r.error).toContain('[命中但无数据块]');
    expect(r.error).toContain(`《${girlBook}》`);
    expect(r.error).toContain('建议：目标条目未结构化，改走机娘档案或人工处理');
    expect(r.error).not.toContain('均未定位');
    expect(r.error).not.toContain('扩展档案通道');
    expect(env.unchanged()).toBe(true);
  });

  it('命中但无数据块在聊天书：路由不变（仍查全局书），原因不丢失', async () => {
    const env = wire({ [chatBook]: [makeGirlEntry()], [lastBook]: [makeWarFactoryEntry()] }, [lastBook]);
    const r = await fileDataPatch(mk('白凌'), undefined, gw);
    expect(r.quarantineReason).toBe('no-data-block');
    expect(r.worldbook).toBe(chatBook);
    expect(env.unchanged()).toBe(true);
  });

  it('数据块损坏：JSON 解析失败 → [数据块损坏] + 建议「修复条目数据块后重试」', async () => {
    const env = wire({ [chatBook]: [], [lastBook]: [makeCorruptEntry()] }, [lastBook]);
    const r = await fileDataPatch(mk('磁能反应炉'), undefined, gw);
    expect(r.quarantineReason).toBe('data-corrupt');
    expect(r.suggestion).toBe('修复条目数据块后重试');
    expect(r.error).toContain('[数据块损坏]');
    expect(r.error).toContain('JSON 解析损坏');
    expect(r.error).toContain('建议：修复条目数据块后重试');
    expect(env.unchanged()).toBe(true);
  });

  it('候选书不存在（写入抛错）不掩盖其他书里「命中但无数据块」的原因', async () => {
    wire({ [chatBook]: [], [girlBook]: [makeGirlEntry()] }, ['已删除的书', girlBook]);
    const r = await fileDataPatch(mk('白凌'), undefined, gw);
    expect(r.quarantineReason).toBe('no-data-block');
  });

  it('pickQuarantineCandidate：损坏 > 无数据块 > 写入异常 > 未命中；同级取先出现者', () => {
    const c = (reason: any, book: string) => ({ reason, book, detail: '' });
    expect(pickQuarantineCandidate([])).toBeNull();
    expect(pickQuarantineCandidate([c('not-found', 'A'), c('no-data-block', 'B'), c('not-found', 'C')])?.book).toBe(
      'B',
    );
    expect(pickQuarantineCandidate([c('no-data-block', 'A'), c('data-corrupt', 'B')])?.book).toBe('B');
    expect(pickQuarantineCandidate([c('write-error', 'A'), c('not-found', 'B')])?.reason).toBe('write-error');
    expect(pickQuarantineCandidate([c('no-data-block', 'A'), c('no-data-block', 'B')])?.book).toBe('A');
  });

  it('describeQuarantine：三种原因的建议与 QUARANTINE_SUGGESTIONS 一致', () => {
    expect(describeQuarantine('X', ['A'], null).suggestion).toBe(QUARANTINE_SUGGESTIONS['not-found']);
    const m = describeQuarantine('白凌', ['A'], { reason: 'no-data-block', book: 'A', detail: 'd' });
    expect(m.message).toBe('[命中但无数据块] 《A》：d。建议：目标条目未结构化，改走机娘档案或人工处理');
  });
});

describe('worldbookDataFiler · Auto-Apply 开关持久化', () => {
  const store: Record<string, string> = {};
  const mockStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  };

  it('默认状态为 false (OFF)', () => {
    mockStorage.removeItem(AUTO_APPLY_KEY);
    expect(getAutoApplyPreference(mockStorage)).toBe(false);
  });

  it('可持久化存储至 Storage', () => {
    setAutoApplyPreference(true, mockStorage);
    expect(getAutoApplyPreference(mockStorage)).toBe(true);
    expect(mockStorage.getItem(AUTO_APPLY_KEY)).toBe('on');

    setAutoApplyPreference(false, mockStorage);
    expect(getAutoApplyPreference(mockStorage)).toBe(false);
    expect(mockStorage.getItem(AUTO_APPLY_KEY)).toBe('off');
  });
});

describe('PanelDataPatches.vue · SFC 契约与三通道审核门', () => {
  const sfcPath = join(__dirname, '../../中控悬浮窗/panels/PanelDataPatches.vue');
  const sfcContent = readFileSync(sfcPath, 'utf8');

  it('具备三通道裁决按钮：【立即生效】/【暂存推迟】/【废弃驳回】', () => {
    expect(sfcContent).toContain('立即生效');
    expect(sfcContent).toContain('暂存推迟');
    expect(sfcContent).toContain('废弃驳回');
    expect(sfcContent).toContain('applyPatch');
    expect(sfcContent).toContain('deferPatch');
    expect(sfcContent).toContain('rejectPatch');
  });

  it('具备全自动热应用（Auto-Apply）设置项与持久化方法', () => {
    expect(sfcContent).toContain('Auto-Apply');
    expect(sfcContent).toContain('autoApply');
    expect(sfcContent).toContain('getAutoApplyPreference');
    expect(sfcContent).toContain('setAutoApplyPreference');
  });

  it('具备 Diff 差异可视化与原始载荷查看能力', () => {
    expect(sfcContent).toContain('DIFF 变更预览');
    expect(sfcContent).toContain('getDiffList');
    expect(sfcContent).toContain("diffItem.type === 'added'");
    expect(sfcContent).toContain("diffItem.type === 'modified'");
    expect(sfcContent).toContain("diffItem.type === 'deleted'");
    expect(sfcContent).toContain('查看原始 JSON');
  });

  it('接入 fileDataPatch 纯函数原子落地层', () => {
    expect(sfcContent).toContain("from '../../红警指挥系统/worldbook/worldbookDataFiler'");
    expect(sfcContent).toContain('fileDataPatch(patch)');
  });
});
