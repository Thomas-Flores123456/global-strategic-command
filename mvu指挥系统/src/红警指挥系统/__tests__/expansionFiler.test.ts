import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../parse/parsePipeline', async () => {
  const { canon, extractConceptCanonicalStem } = await import('../parse/parseTypesAndCanon');
  return { canon, extractConceptCanonicalStem };
});
import type { ChatBookGatewayLike, WriteTxn } from '../worldbook/chatBookBinding';
import { GuardError } from '../worldbook/chatBookBinding';
import type { ExpansionKind, PromotionIO } from '../worldbook/expansionFiler';
import {
  deriveCodexFromExpansion,
  detectHalfStates,
  expansionKeys,
  extractDependencies,
  fileExpansion,
  linkExpansionGraph,
  makeExpansionComment,
  nextExpansionOrder,
  persistedEntriesOf,
  promoteEntry,
  promotedRecordStatus,
  renderExpansionContent,
  retryDeleteOriginalEntry,
  stripExpansionCommentPrefix,
  upsertCodexList,
  upsertExpansionEntry,
} from '../worldbook/expansionFiler';
import type { ThEntry } from '../worldbook/girlFiler';
import type { CodexEntry, ExpansionDossier } from '../core/schema';
import * as sysCheck from '../parse/systemCheck';

function makeMockExpansion(overrides?: Partial<ExpansionDossier>): ExpansionDossier {
  return {
    name: '等离子脉冲炮',
    kind: '科技' as ExpansionKind,
    desc: '突破性重型能量武器。',
    params: { 造价: '3500', 耗电: '120' },
    detail: '利用磁约束等离子体进行高能脉冲射击，具备极强破甲穿透力。',
    keys: ['脉冲炮', '等离子武器'],
    ...overrides,
  };
}

describe('expansionFiler · 纯函数层（渲染、键名、续号、防串段、E7e）', () => {
  it('renderExpansionContent 自动添加标准中括号标题（若未包含）', () => {
    const d = makeMockExpansion();
    const content = renderExpansionContent(d);
    expect(content).toContain('[红警扩展·科技 | 等离子脉冲炮]');
    expect(content).toContain('利用磁约束等离子体进行高能脉冲射击');
  });

  it('renderExpansionContent detail 自带中括号标题时不重复添加', () => {
    const d = makeMockExpansion({ detail: '[自定义标题 | 等离子脉冲炮]\n正文叙述。' });
    const content = renderExpansionContent(d);
    expect(content.startsWith('[自定义标题 | 等离子脉冲炮]')).toBe(true);
    expect(content).not.toContain('[红警扩展·科技');
  });

  it('renderExpansionContent 附带合规 data 块时以标准 <数据> 格式追加于正文末', () => {
    const d = makeMockExpansion({
      data: { type: 'technology', tier: 3, power_demand: 120 },
    });
    const content = renderExpansionContent(d);
    expect(content).toContain('<数据>');
    expect(content).toContain('"type": "technology"');
    expect(content).toContain('"tier": 3');
    expect(content).toContain('</数据>');
  });

  it('renderExpansionContent 附带含红线字段的 data 块时被硬性拦截抛错', () => {
    const d = makeMockExpansion({
      data: { uid: 999, cost: 2000 },
    });
    expect(() => renderExpansionContent(d)).toThrow('安全红线拦截：data 包含禁止字段 [uid]');
  });

  it('expansionKeys 整合实体名与建议触发词，去重去空', () => {
    const d = makeMockExpansion({
      name: '等离子脉冲炮',
      keys: ['脉冲炮', '等离子脉冲炮', ' ', '能量武器'],
    });
    expect(expansionKeys(d)).toEqual(['等离子脉冲炮', '脉冲炮', '能量武器']);
  });

  it('makeExpansionComment 与 stripExpansionCommentPrefix 前缀命名与剥离互逆', () => {
    const d = makeMockExpansion({ kind: '载具', name: '猛犸重型坦克' });
    const comment = makeExpansionComment(d);
    expect(comment).toBe('载具·猛犸重型坦克·设定');
    expect(stripExpansionCommentPrefix(comment)).toBe('猛犸重型坦克');
    expect(stripExpansionCommentPrefix('猛犸重型坦克')).toBe('猛犸重型坦克');
  });

  it('upsertExpansionEntry 遵循 E7e 与零外溢纪律：绿灯 selective、精确 key、按类别分带续号（科技 71001）、prevent_incoming 与 prevent_outgoing', () => {
    const entries: ThEntry[] = [];
    const d = makeMockExpansion();
    const res = upsertExpansionEntry(entries, d);

    expect(res.action).toBe('created');
    expect(res.entryName).toBe('科技·等离子脉冲炮·设定');
    expect(entries).toHaveLength(1);

    const entry = entries[0];
    expect(entry.name).toBe('科技·等离子脉冲炮·设定');
    expect(entry.enabled).toBe(true);
    expect(entry.strategy?.type).toBe('selective');
    expect(entry.strategy?.keys).toEqual(['等离子脉冲炮', '脉冲炮', '等离子武器']);
    expect(entry.position?.order).toBe(71001);
    expect(entry.recursion?.prevent_incoming).toBe(true);
    expect(entry.recursion?.prevent_outgoing).toBe(true);
  });

  it('upsertExpansionEntry 基于 findInSegment 段位定位防串段（同名不同类别互不覆盖）', () => {
    const entries: ThEntry[] = [];
    const tech = makeMockExpansion({ kind: '科技', name: '磁暴线圈', detail: '科技理论。' });
    const bld = makeMockExpansion({ kind: '建筑', name: '磁暴线圈', detail: '防御建筑。' });

    upsertExpansionEntry(entries, tech);
    upsertExpansionEntry(entries, bld);

    expect(entries).toHaveLength(2);
    expect(entries[0].name).toBe('科技·磁暴线圈·设定');
    expect(entries[1].name).toBe('建筑·磁暴线圈·设定');
    expect(entries[0].content).toContain('科技理论。');
    expect(entries[1].content).toContain('防御建筑。');
  });

  it('upsertExpansionEntry 同类别同名实体幂等更新，保留原条目名', () => {
    const entries: ThEntry[] = [];
    const d1 = makeMockExpansion({ detail: '初版设计。' });
    const d2 = makeMockExpansion({ detail: '二版改进设计。' });

    const r1 = upsertExpansionEntry(entries, d1);
    expect(r1.action).toBe('created');
    expect(entries).toHaveLength(1);

    const r2 = upsertExpansionEntry(entries, d2);
    expect(r2.action).toBe('updated');
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toContain('二版改进设计。');
  });

  it('deriveCodexFromExpansion 与 upsertCodexList 自动派生 codex 索引且幂等', () => {
    const d = makeMockExpansion();
    const codexEntry = deriveCodexFromExpansion(d);
    expect(codexEntry).toEqual({
      name: '等离子脉冲炮',
      kind: '科技',
      desc: '突破性重型能量武器。',
      params: { 造价: '3500', 耗电: '120' },
    });

    const codexList: CodexEntry[] = [];
    const r1 = upsertCodexList(codexList, codexEntry);
    expect(r1.action).toBe('created');
    expect(codexList).toHaveLength(1);

    // 再次派生更新
    const r2 = upsertCodexList(codexList, { ...codexEntry, desc: '更新后的描述' });
    expect(r2.action).toBe('updated');
    expect(codexList).toHaveLength(1);
    expect(codexList[0].desc).toBe('更新后的描述');
  });

  it('G08-07：同名但不同分类的造物在解析暂存、入档世界书与 codex 索引中独立并存不互顶；同分类同名幂等更新；旧无分类/其他索引向后兼容', async () => {
    const { upsertExpansion } = await import('../parse/parseDomainAppliers');
    const pendingExpansions: Record<string, unknown>[] = [];
    const codexList: CodexEntry[] = [
      { name: '旧世代模块', kind: '其他', desc: '旧索引', params: { 旧参数: '1' } },
    ];
    const ctx = {
      events: [],
      issues: [],
      quarantine: [],
      appliedCount: 0,
      engOrders: [],
    };

    // 1. 解析阶段：同名「曙光」分别以「人物」与「装备」提交，并更新一次「装备·曙光」
    upsertExpansion(
      pendingExpansions,
      [
        { 名称: '曙光', 类别: '人物', 代号: '破晓', 态度: '友好', 简介: '前线联络官', 设定: '独立NPC设定' },
        { 名称: '曙光', 类别: '装备', 简介: '战术激光步枪初版', 设定: '步枪初版设定', 参数: { 射程: '600m' } },
        { 名称: '曙光', 类别: '装备', 简介: '战术激光步枪改进型', 设定: '步枪改进设定', 参数: { 功率: '45kW' } },
      ],
      ctx as never,
      codexList as unknown as Record<string, unknown>[],
    );

    expect(pendingExpansions).toHaveLength(2);
    const npcPending = pendingExpansions.find(e => e.kind === '人物') as unknown as ExpansionDossier;
    const equipPending = pendingExpansions.find(e => e.kind === '装备') as unknown as ExpansionDossier;
    expect(npcPending).toBeDefined();
    expect(equipPending).toBeDefined();
    expect(npcPending.desc).toBe('前线联络官');
    expect(equipPending.desc).toBe('战术激光步枪改进型');
    expect(equipPending.params).toEqual({ 射程: '600m', 功率: '45kW' });

    // 2. 世界书与 codex 索引层：两者入档后在世界书与 codexList 中均独立存在、不互顶
    const wbEntries: ThEntry[] = [];
    upsertExpansionEntry(wbEntries, npcPending);
    upsertExpansionEntry(wbEntries, equipPending);
    expect(wbEntries.map(e => e.name)).toEqual(['人物·曙光·设定', '装备·曙光·设定']);

    upsertCodexList(codexList, deriveCodexFromExpansion(npcPending));
    const equipCodexRes1 = upsertCodexList(codexList, deriveCodexFromExpansion(equipPending));
    expect(equipCodexRes1.action).toBe('created');
    expect(codexList.filter(c => c.name === '曙光').map(c => c.kind)).toEqual(['人物', '装备']);

    // 同分类同名更新保持幂等
    const equipCodexRes2 = upsertCodexList(codexList, {
      ...deriveCodexFromExpansion(equipPending),
      desc: '战术激光步枪定型版',
    });
    expect(equipCodexRes2.action).toBe('updated');
    expect(codexList.filter(c => c.name === '曙光')).toHaveLength(2);
    expect(codexList.find(c => c.name === '曙光' && c.kind === '装备')?.desc).toBe('战术激光步枪定型版');
    expect(codexList.find(c => c.name === '曙光' && c.kind === '人物')?.desc).toBe('前线联络官');

    // 3. 旧索引兼容：旧 kind='其他' 条目被新具体分类同名条目幂等升级，不产生重复残留
    const legacyRes = upsertCodexList(codexList, {
      name: '旧世代模块',
      kind: '科技',
      desc: '升级为科技分类',
      params: { 新参数: '2' },
    });
    expect(legacyRes.action).toBe('updated');
    const upgraded = codexList.filter(c => c.name === '旧世代模块');
    expect(upgraded).toHaveLength(1);
    expect(upgraded[0]).toEqual({
      name: '旧世代模块',
      kind: '科技',
      desc: '升级为科技分类',
      params: { 旧参数: '1', 新参数: '2' },
    });
  });

  it('BUG-LIVE-15a：同名异类（人物·铁砧 + 地点·铁砧）在 upsertExpansion、世界书入档与 applyFiledToStatData 核销中独立并存零丢失', async () => {
    const { upsertExpansion } = await import('../parse/parseDomainAppliers');
    const { applyFiledToStatData } = await import('../../中控悬浮窗/host/expansionAutoFiler');
    const pendingExpansions: Record<string, unknown>[] = [];
    const codexList: CodexEntry[] = [];
    const ctx = {
      events: [],
      issues: [],
      quarantine: [],
      appliedCount: 0,
      engOrders: [],
    };

    upsertExpansion(
      pendingExpansions,
      [
        {
          名称: '铁砧',
          类别: '人物',
          代号: '铁砧',
          所属势力: '达科塔恶土中间人网络',
          身份: '重装军火掮客',
          态度: '友善',
          信任度: 65,
          简介: '常年活跃于红峰荒原的退伍义体改装师与重型军火中间人。',
          触发词: ['铁砧', '军火掮客铁砧'],
        },
        {
          名称: '铁砧',
          类别: '地点',
          简介: '红峰荒原北麓的一处废弃露天铁矿坑与地下黑市交易聚落，因形似巨型铁砧而得名。',
          触发词: ['铁砧矿坑', '铁砧聚落'],
        },
      ],
      ctx as never,
      codexList as unknown as Record<string, unknown>[],
    );

    expect(ctx.quarantine).toHaveLength(0);
    expect(pendingExpansions).toHaveLength(2);
    const typedPending = pendingExpansions as unknown as ExpansionDossier[];
    expect(typedPending.map(e => `${e.kind}·${e.name}`)).toEqual(['人物·铁砧', '地点·铁砧']);

    const wbEntries: ThEntry[] = [];
    for (const d of typedPending) {
      upsertExpansionEntry(wbEntries, d);
    }
    expect(wbEntries.map(e => e.name)).toEqual(['人物·铁砧·设定', '地点·铁砧·设定']);

    // applyFiledToStatData 按复合键核销时，仅核销已成功入档的分类，不误删同名异类未入档项
    const partialAfter = applyFiledToStatData(
      { pending_expansions: typedPending, codex: codexList },
      ['人物::铁砧'],
      [deriveCodexFromExpansion(typedPending[0])],
    );
    expect(
      (partialAfter.pending_expansions as ExpansionDossier[]).map(e => `${e.kind}·${e.name}`),
    ).toEqual(['地点·铁砧']);
  });
});

describe('expansionFiler · 副作用落地层（fileExpansion、守卫拦截、分叉警示）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function makeMockGateway(boundBook = '红警档案·红警指挥系统·20260923T1000'): ChatBookGatewayLike {
    return {
      begin: () => ({ chatId: 'test-chat-01' }),
      guardedBook: async (_txn: WriteTxn, _opts: { createIfMissing: boolean }) => boundBook,
    };
  }

  it('正常流程：经守卫落地聊天书并自动派生 codex 索引', async () => {
    const chatBook = '红警档案·红警指挥系统·20260923T1000';
    const gateway = makeMockGateway(chatBook);

    const storeEntries: Record<string, ThEntry[]> = { [chatBook]: [] };
    const mockUpdateWb = vi.fn(async (bookName: string, updater: (e: ThEntry[]) => ThEntry[]) => {
      const cur = storeEntries[bookName] ?? [];
      const next = updater(cur);
      storeEntries[bookName] = next;
      return next;
    });

    vi.spyOn(sysCheck, 'tav').mockImplementation(((name: string) => {
      if (name === 'updateWorldbookWith') return mockUpdateWb;
      return undefined;
    }) as any);

    const d = makeMockExpansion();
    const codexSink: CodexEntry[] = [];
    const receipt = await fileExpansion(d, gateway, { codexSink });

    expect(receipt.action).toBe('created');
    expect(receipt.book).toBe(chatBook);
    expect(receipt.name).toBe('等离子脉冲炮');
    expect(receipt.codexAction).toBe('created');
    expect(receipt.forkWarning).toBe(false);
    expect(storeEntries[chatBook]).toHaveLength(1);
    expect(codexSink).toHaveLength(1);
    expect(codexSink[0].name).toBe('等离子脉冲炮');
  });

  it('守卫失败（如 chat-id-drift）：抛出 GuardError fail-closed，绝不清空暂存', async () => {
    const failingGateway: ChatBookGatewayLike = {
      begin: () => ({ chatId: 'test-chat-01' }),
      guardedBook: async () => {
        throw new GuardError({
          guard: 1,
          rule: 'chat-id-drift',
          expected: 'chatId=test-chat-01',
          actual: 'chatId=test-chat-02',
        });
      },
    };

    const mockUpdateWb = vi.fn();
    vi.spyOn(sysCheck, 'tav').mockImplementation(((name: string) => {
      if (name === 'updateWorldbookWith') return mockUpdateWb;
      return undefined;
    }) as any);

    const d = makeMockExpansion();
    await expect(fileExpansion(d, failingGateway)).rejects.toThrow('chat-id-drift');
    expect(mockUpdateWb).not.toHaveBeenCalled();
  });

  it('$promoted 命中已提升实体时打分叉警示标记（forkWarning: true）', async () => {
    const chatBook = '红警档案·红警指挥系统·20260923T1000';
    const gateway = makeMockGateway(chatBook);

    vi.spyOn(sysCheck, 'tav').mockImplementation(((name: string) => {
      if (name === 'updateWorldbookWith') {
        return async (_b: string, updater: (e: ThEntry[]) => ThEntry[]) => updater([]);
      }
      return undefined;
    }) as any);

    const d = makeMockExpansion({ name: '等离子脉冲炮' });
    const mockPromoted = {
      等离子脉冲炮: {
        targetBook: '红警扩展·等离子脉冲炮',
        promotedAt: '2026-09-23T10:00:00.000Z',
      },
    };

    const receipt = await fileExpansion(d, gateway, {
      readPromotedFn: async () => mockPromoted,
    });

    expect(receipt.forkWarning).toBe(true);
    expect(receipt.forkPromotedBook).toBe('红警扩展·等离子脉冲炮');
  });

  it('$promoted 注册表缺失或异常时，入档照常进行（advisory 降级）', async () => {
    const chatBook = '红警档案·红警指挥系统·20260923T1000';
    const gateway = makeMockGateway(chatBook);

    vi.spyOn(sysCheck, 'tav').mockImplementation(((name: string) => {
      if (name === 'updateWorldbookWith') {
        return async (_b: string, updater: (e: ThEntry[]) => ThEntry[]) => updater([]);
      }
      return undefined;
    }) as any);

    const d = makeMockExpansion({ name: '等离子脉冲炮' });
    const receipt = await fileExpansion(d, gateway, {
      readPromotedFn: async () => {
        throw new Error('变量读取失败');
      },
    });

    expect(receipt.action).toBe('created');
    expect(receipt.forkWarning).toBe(false);
  });
});

describe('expansionFiler · 提升操作层（promoteEntry 五步流与半程态）', () => {
  const sourceChatBook = '红警档案·红警指挥系统·20260923T1000';
  const targetBookName = '红警扩展·等离子脉冲炮';

  function makeMockPromotionIO(initialBooks: Record<string, ThEntry[]> = {}): PromotionIO & {
    store: Record<string, ThEntry[]>;
    globals: string[];
    promoted: Record<string, any>;
  } {
    const store = { ...initialBooks };
    const globals: string[] = [];
    const promoted: Record<string, any> = {};

    return {
      store,
      globals,
      promoted,
      getWorldbookNames: () => Object.keys(store),
      getWorldbook: async (name: string) => {
        if (!store[name]) throw new Error(`世界书不存在: ${name}`);
        return [...store[name]];
      },
      createWorldbook: async (name: string, entries?: ThEntry[]) => {
        if (store[name]) return false; // 撞名则按 createWorldbook 规范返回 false
        store[name] = entries ? [...entries] : [];
        return true;
      },
      getGlobalWorldbookNames: () => [...globals],
      rebindGlobalWorldbooks: async (names: string[]) => {
        globals.length = 0;
        globals.push(...names);
      },
      deleteWorldbookEntries: async (bookName: string, predicate: (e: ThEntry) => boolean) => {
        const cur = store[bookName] ?? [];
        const kept: ThEntry[] = [];
        const deleted: ThEntry[] = [];
        for (const e of cur) {
          if (predicate(e)) deleted.push(e);
          else kept.push(e);
        }
        store[bookName] = kept;
        return { worldbook: kept, deleted_entries: deleted };
      },
      readChatId: () => 'chat-session-001',
      now: () => new Date('2026-09-23T12:00:00.000Z'),
      recordPromoted: async (name: string, rec: any) => {
        promoted[name] = rec;
        return true;
      },
    };
  }

  function makeMockGateway(verifiedBook = sourceChatBook): ChatBookGatewayLike {
    return {
      begin: () => ({ chatId: 'chat-session-001' }),
      guardedBook: async () => verifiedBook,
    };
  }

  it('步① 预检：目标世界书名已存在时 fail-closed 拒绝并要求换名（绝不静默覆盖既有书）', async () => {
    const sourceEntry: ThEntry = {
      name: '科技·等离子脉冲炮·设定',
      comment: '科技·等离子脉冲炮·设定',
      content: '完整技术设定散文。',
    };
    const io = makeMockPromotionIO({
      [sourceChatBook]: [sourceEntry],
      [targetBookName]: [], // 已存在同名书！
    });

    await expect(
      promoteEntry(
        {
          sourceChatBook,
          entryIdentifier: '等离子脉冲炮',
          targetBookName,
          gateway: makeMockGateway(),
        },
        io,
      ),
    ).rejects.toThrow('目标世界书名「红警扩展·等离子脉冲炮」已存在，禁止覆盖既有书，请换名');
  });

  it('步① 预检：在聊天书未检索到原条目时拒绝', async () => {
    const io = makeMockPromotionIO({
      [sourceChatBook]: [],
    });

    await expect(
      promoteEntry(
        {
          sourceChatBook,
          entryIdentifier: '不存在的条目',
          targetBookName,
          gateway: makeMockGateway(),
        },
        io,
      ),
    ).rejects.toThrow('未找到条目');
  });

  it('提升五步流完整成功：正文逐字节搬迁、comment换名、extra记来源、追加全局、删聊天书原条目、登记 $promoted', async () => {
    const exactContent =
      '[红警扩展·科技 | 等离子脉冲炮]\n\n完整技术设定散文，包含特殊符号与换行。\n\n<数据>\n{\n  "tier": 3\n}\n</数据>';
    const sourceEntry: ThEntry = {
      uid: 101,
      name: '科技·等离子脉冲炮·设定',
      comment: '科技·等离子脉冲炮·设定',
      enabled: true,
      strategy: { type: 'selective', keys: ['等离子脉冲炮'] },
      content: exactContent,
      extra: { tag: 'origin' },
    };

    const io = makeMockPromotionIO({
      [sourceChatBook]: [sourceEntry],
    });

    const receipt = await promoteEntry(
      {
        sourceChatBook,
        entryIdentifier: '等离子脉冲炮',
        targetBookName,
        newEntryComment: '等离子脉冲炮',
        gateway: makeMockGateway(),
      },
      io,
    );

    expect(receipt.success).toBe(true);
    expect(receipt.deletedFromSource).toBe(true);
    expect(receipt.targetBook).toBe(targetBookName);
    expect(receipt.entryName).toBe('等离子脉冲炮');

    // 1. 新书建立且条目正文逐字节搬迁
    expect(io.store[targetBookName]).toHaveLength(1);
    const promoted = io.store[targetBookName][0];
    expect(promoted.name).toBe('等离子脉冲炮');
    expect(promoted.content).toBe(exactContent); // 逐字节相等！
    expect(promoted.extra?.provenance).toEqual({
      sourceChatId: 'chat-session-001',
      sourceBook: sourceChatBook,
      sourceComment: '科技·等离子脉冲炮·设定',
      promotedAt: '2026-09-23T12:00:00.000Z',
    });

    // 2. 默认追加到全局开启列表
    expect(io.globals).toContain(targetBookName);

    // 3. 原聊天书条目已删除
    expect(io.store[sourceChatBook]).toHaveLength(0);

    // 4. $promoted 注册表已记录
    expect(io.promoted['等离子脉冲炮']).toEqual({
      targetBook: targetBookName,
      promotedAt: '2026-09-23T12:00:00.000Z',
      sourceComment: '科技·等离子脉冲炮·设定',
    });
  });

  it('步④ 复验失败时不删原条目（形成已建未删半程态，绝不先删后建）', async () => {
    const sourceEntry: ThEntry = {
      name: '科技·等离子脉冲炮·设定',
      comment: '科技·等离子脉冲炮·设定',
      content: '设定散文。',
    };
    const io = makeMockPromotionIO({
      [sourceChatBook]: [sourceEntry],
    });

    // 模拟复验故障：createWorldbook 返回 true 但实际上 getWorldbook 查不到
    io.createWorldbook = async (_n, _es) => true; // 未写入 io.store

    await expect(
      promoteEntry(
        {
          sourceChatBook,
          entryIdentifier: '等离子脉冲炮',
          targetBookName,
          gateway: makeMockGateway(),
        },
        io,
      ),
    ).rejects.toThrow('[提升复验失败]');

    // 原条目完好保留
    expect(io.store[sourceChatBook]).toHaveLength(1);
    expect(io.store[sourceChatBook][0].name).toBe('科技·等离子脉冲炮·设定');
  });

  it('步⑤ 守卫失败（如聊天身份漂移）中止删除原条目，保留半程态', async () => {
    const sourceEntry: ThEntry = {
      name: '科技·等离子脉冲炮·设定',
      comment: '科技·等离子脉冲炮·设定',
      content: '设定散文。',
    };
    const io = makeMockPromotionIO({
      [sourceChatBook]: [sourceEntry],
    });

    // 守卫在步骤⑤返回漂移后的书名
    const driftingGateway: ChatBookGatewayLike = {
      begin: () => ({ chatId: 'chat-session-001' }),
      guardedBook: async () => '红警档案·另一聊天·20260923T1111',
    };

    await expect(
      promoteEntry(
        {
          sourceChatBook,
          entryIdentifier: '等离子脉冲炮',
          targetBookName,
          gateway: driftingGateway,
        },
        io,
      ),
    ).rejects.toThrow('[提升守卫失败] 聊天档案书已漂移');

    // 新书已建，原条目未删（已建未删半程态），且已在步⑤前登记 $promoted，可立即被 detectHalfStates 检出
    expect(io.store[targetBookName]).toHaveLength(1);
    expect(io.store[sourceChatBook]).toHaveLength(1);
    expect(io.promoted['等离子脉冲炮']).toEqual({
      targetBook: targetBookName,
      promotedAt: '2026-09-23T12:00:00.000Z',
      sourceComment: '科技·等离子脉冲炮·设定',
    });
    const detected = await detectHalfStates(sourceChatBook, io.promoted, io);
    expect(detected).toHaveLength(1);
    expect(detected[0].entryName).toBe('等离子脉冲炮');
  });

  it('FIX-WB-01：步⑤ deleteWorldbookEntries 抛错时 $promoted 已提前登记，detectHalfStates 可检出且 retryDeleteOriginalEntry 补调 flushWorldbook', async () => {
    const sourceEntry: ThEntry = {
      name: '科技·等离子脉冲炮·设定',
      comment: '科技·等离子脉冲炮·设定',
      content: '设定散文。',
    };
    const io = makeMockPromotionIO({
      [sourceChatBook]: [sourceEntry],
    });
    const origDelete = io.deleteWorldbookEntries.bind(io);
    let failOnce = true;
    io.deleteWorldbookEntries = async (book, pred) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('delete-boom');
      }
      return origDelete(book, pred);
    };
    const flushedBooks: string[] = [];
    io.flushWorldbook = async name => {
      flushedBooks.push(name);
    };

    await expect(
      promoteEntry(
        {
          sourceChatBook,
          entryIdentifier: '等离子脉冲炮',
          targetBookName,
          gateway: makeMockGateway(),
        },
        io,
      ),
    ).rejects.toThrow('delete-boom');

    // 步⑤删除抛错中断，但步④后已登记 $promoted，故 detectHalfStates 立即可检出半程态
    const half = await detectHalfStates(sourceChatBook, io.promoted, io);
    expect(half).toHaveLength(1);
    expect(half[0].entryName).toBe('等离子脉冲炮');

    // retryDeleteOriginalEntry 删除成功后补调 flushWorldbook(sourceChatBook)
    flushedBooks.length = 0;
    const ok = await retryDeleteOriginalEntry(sourceChatBook, '等离子脉冲炮', makeMockGateway(), io);
    expect(ok).toBe(true);
    expect(flushedBooks).toEqual([sourceChatBook]);
    expect(await detectHalfStates(sourceChatBook, io.promoted, io)).toHaveLength(0);
  });

  it('G08-05：提升复制 V1 期间源条目被并发更新为 V2 时，步⑤不删除 V2（保留源 V2 与目标 V1）；源未变时正常删除', async () => {
    const v1: ThEntry = {
      uid: 42,
      name: '科技·等离子脉冲炮·设定',
      comment: '科技·等离子脉冲炮·设定',
      content: 'V1 初始设定。',
    };
    const io = makeMockPromotionIO({
      [sourceChatBook]: [v1],
    });
    io.flushWorldbook = async name => {
      if (name === targetBookName) {
        io.store[sourceChatBook] = [{ ...v1, content: 'V2 并发更新后的最新设定。' }];
      }
    };

    const r1 = await promoteEntry(
      {
        sourceChatBook,
        entryIdentifier: 42,
        targetBookName,
        gateway: makeMockGateway(),
      },
      io,
    );

    expect(r1.deletedFromSource).toBe(false);
    expect(io.store[targetBookName]).toHaveLength(1);
    expect(io.store[targetBookName][0].content).toBe('V1 初始设定。');
    expect(io.store[sourceChatBook]).toHaveLength(1);
    expect(io.store[sourceChatBook][0].content).toBe('V2 并发更新后的最新设定。');
    expect(await detectHalfStates(sourceChatBook, io.promoted, io)).toHaveLength(1);

    const targetBookV2 = '红警扩展·等离子脉冲炮V2';
    io.flushWorldbook = async () => {};
    const r2 = await promoteEntry(
      {
        sourceChatBook,
        entryIdentifier: 42,
        targetBookName: targetBookV2,
        gateway: makeMockGateway(),
      },
      io,
    );
    expect(r2.deletedFromSource).toBe(true);
    expect(io.store[targetBookV2][0].content).toBe('V2 并发更新后的最新设定。');
    expect(io.store[sourceChatBook]).toHaveLength(0);
  });

  it('detectHalfStates 可检出「已建未删」半程态，retryDeleteOriginalEntry 可安全重试清除', async () => {
    const sourceEntry: ThEntry = {
      name: '科技·等离子脉冲炮·设定',
      comment: '科技·等离子脉冲炮·设定',
      content: '设定散文。',
    };
    const io = makeMockPromotionIO({
      [sourceChatBook]: [sourceEntry],
      [targetBookName]: [{ name: '等离子脉冲炮', content: '设定散文。' }],
    });

    const reg = {
      等离子脉冲炮: {
        targetBook: targetBookName,
        promotedAt: '2026-09-23T12:00:00.000Z',
        sourceComment: '科技·等离子脉冲炮·设定',
      },
    };

    const halfStates = await detectHalfStates(sourceChatBook, reg, io);
    expect(halfStates).toHaveLength(1);
    expect(halfStates[0].entryName).toBe('等离子脉冲炮');
    expect(halfStates[0].targetBook).toBe(targetBookName);

    // 执行重试删除
    const deleted = await retryDeleteOriginalEntry(sourceChatBook, '等离子脉冲炮', makeMockGateway(), io);
    expect(deleted).toBe(true);
    expect(io.store[sourceChatBook]).toHaveLength(0);

    // 再次检出已无半程态
    const recheck = await detectHalfStates(sourceChatBook, reg, io);
    expect(recheck).toHaveLength(0);
  });
});

/* ═══════════════ CTRL-PROMOTE-PERSIST-01 · F8 持久化回归 ═══════════════ */

describe('expansionFiler · F8 提升条目持久化（ST 全局单例防抖 last-args-wins 模型）', () => {
  const sourceChatBook = '红警档案·红警系统·测试·20260925T1144';
  const targetBookName = '红警扩展·F8回归座';
  const exactContent = '[红警扩展·装备 | F8回归座]\n\n回归夹具。\n\n<数据>\n{\n  "cost": 760\n}\n</数据>';
  const sourceEntry: ThEntry = {
    uid: 889585,
    name: '装备·F8回归座·设定',
    comment: '装备·F8回归座·设定',
    enabled: true,
    content: exactContent,
  };
  const otherEntry: ThEntry = {
    uid: 602348,
    name: '科技·观测算力工学·设定',
    comment: '科技·观测算力工学·设定',
    content: 'x',
  };

  /**
   * 忠实模拟真机（ST 1.18.0 + TH 4.9.5）保存语义：
   * - createWorldbook：createNewWorldInfo 立即落盘「空书」，条目仅进缓存＋排入全局单例防抖；
   * - deleteWorldbookEntries / 其它写入：进缓存＋排入同一防抖槽（覆盖前一待存参数）；
   * - flushWorldbook：立即落盘该书缓存并取消防抖（对应 _save 的 cancelDebounce）；
   * - settle()：防抖到期，只落盘槽内最后一次参数；reload()：丢弃缓存，只剩磁盘。
   */
  function makeDebouncedIO(opts: { withFlush: boolean; withReadback: boolean }) {
    const disk: Record<string, ThEntry[]> = { [sourceChatBook]: [sourceEntry, otherEntry] };
    const cache: Record<string, ThEntry[]> = { [sourceChatBook]: [sourceEntry, otherEntry] };
    let pending: { name: string; data: ThEntry[] } | null = null;
    const globals: string[] = [];
    const promoted: Record<string, any> = {};
    const log: string[] = [];
    const io: PromotionIO = {
      getWorldbookNames: () => Object.keys(disk),
      getWorldbook: async n => {
        if (!(n in cache) && !(n in disk)) throw new Error(`世界书不存在: ${n}`);
        return [...(cache[n] ?? disk[n])];
      },
      createWorldbook: async (n, es) => {
        if (n in disk) return false;
        disk[n] = []; // 立即存空书
        cache[n] = es ? [...es] : [];
        pending = { name: n, data: cache[n] }; // 条目走防抖
        log.push(`create:${n}`);
        return true;
      },
      getGlobalWorldbookNames: () => [...globals],
      rebindGlobalWorldbooks: async ns => {
        globals.length = 0;
        globals.push(...ns);
        log.push('rebind');
      },
      deleteWorldbookEntries: async (b, pred) => {
        const cur = cache[b] ?? disk[b] ?? [];
        const kept = cur.filter(e => !pred(e));
        const deleted = cur.filter(e => pred(e));
        cache[b] = kept;
        pending = { name: b, data: kept }; // 覆盖同一防抖槽
        log.push(`delete:${b}`);
        return { worldbook: kept, deleted_entries: deleted };
      },
      readChatId: () => '红警系统·测试 - 2026-09-24@21h57m32s584ms',
      now: () => new Date('2026-09-25T12:00:00.000Z'),
      recordPromoted: async (n, r) => {
        promoted[n] = r;
        return true;
      },
    };
    if (opts.withFlush) {
      io.flushWorldbook = async n => {
        disk[n] = [...(cache[n] ?? [])];
        pending = null; // cancelDebounce
        log.push(`flush:${n}`);
      };
    }
    if (opts.withReadback) {
      io.readPersistedWorldbook = async n => [...(disk[n] ?? [])];
    }
    return {
      io,
      disk,
      globals,
      promoted,
      log,
      settle() {
        if (pending) disk[pending.name] = [...pending.data];
        pending = null;
      },
      reload() {
        this.settle();
        for (const k of Object.keys(cache)) delete cache[k];
      },
    };
  }

  const gw = (): ChatBookGatewayLike => ({
    begin: () => ({ chatId: 'c' }),
    guardedBook: async () => sourceChatBook,
  });

  it('F8 复现基线：无立即落盘、无回读时，整页刷新后新书变空壳书（锁定根因模型）', async () => {
    const h = makeDebouncedIO({ withFlush: false, withReadback: false });
    const r = await promoteEntry({ sourceChatBook, entryIdentifier: 'F8回归座', targetBookName, gateway: gw() }, h.io);
    expect(r.success).toBe(true); // 当场“全符”——缓存命中骗过了原复验
    h.reload();
    expect(h.disk[targetBookName]).toEqual([]); // 书名在册、条目丢失
    expect(h.disk[sourceChatBook].map(e => e.uid)).toEqual([602348]); // 聊天书删除却已落盘
  });

  it('修复后：提升→整页刷新，新书条目仍在磁盘、聊天书原条目已删、全局/$promoted 四方一致', async () => {
    const h = makeDebouncedIO({ withFlush: true, withReadback: true });
    const r = await promoteEntry({ sourceChatBook, entryIdentifier: 'F8回归座', targetBookName, gateway: gw() }, h.io);
    expect(r.success).toBe(true);
    h.reload();
    expect(h.disk[targetBookName]).toHaveLength(1);
    expect(h.disk[targetBookName][0].content).toBe(exactContent);
    expect(h.disk[targetBookName][0].comment).toBe('F8回归座');
    expect((h.disk[targetBookName][0].extra as { provenance?: { sourceBook?: string } })?.provenance?.sourceBook).toBe(
      sourceChatBook,
    );
    expect(h.disk[sourceChatBook].map(e => e.uid)).toEqual([602348]);
    expect(h.globals).toContain(targetBookName);
    expect(h.promoted['F8回归座']?.targetBook).toBe(targetBookName);
    // 再刷新一次：幂等
    h.reload();
    expect(h.disk[targetBookName]).toHaveLength(1);
    expect(h.disk[sourceChatBook]).toHaveLength(1);
  });

  it('时序：新书立即落盘紧随 createWorldbook、先于任何他书写入；删除后聊天书也立即落盘', async () => {
    const h = makeDebouncedIO({ withFlush: true, withReadback: true });
    await promoteEntry({ sourceChatBook, entryIdentifier: 'F8回归座', targetBookName, gateway: gw() }, h.io);
    expect(h.log).toEqual([
      `create:${targetBookName}`,
      `flush:${targetBookName}`,
      'rebind',
      `delete:${sourceChatBook}`,
      `flush:${sourceChatBook}`,
    ]);
  });

  it('复验补强：条目未落盘（回读缺失）时 fail-closed 中止步⑤，聊天书原条目保留', async () => {
    const h = makeDebouncedIO({ withFlush: false, withReadback: true });
    await expect(
      promoteEntry({ sourceChatBook, entryIdentifier: 'F8回归座', targetBookName, gateway: gw() }, h.io),
    ).rejects.toThrow('条目未落盘');
    h.reload();
    expect(h.disk[sourceChatBook].map(e => e.uid)).toContain(889585);
    expect(h.promoted['F8回归座']).toBeUndefined();
  });

  it('立即落盘失败：抛「提升落盘失败」且不删原条目、不登记 $promoted', async () => {
    const h = makeDebouncedIO({ withFlush: true, withReadback: true });
    h.io.flushWorldbook = async () => {
      throw new Error('boom');
    };
    await expect(
      promoteEntry({ sourceChatBook, entryIdentifier: 'F8回归座', targetBookName, gateway: gw() }, h.io),
    ).rejects.toThrow('提升落盘失败');
    expect(h.log).not.toContain(`delete:${sourceChatBook}`);
    expect(h.promoted['F8回归座']).toBeUndefined();
  });

  it('回读 HTTP 失败：按复验失败 fail-closed', async () => {
    const h = makeDebouncedIO({ withFlush: true, withReadback: true });
    h.io.readPersistedWorldbook = async () => {
      throw new Error('HTTP 500');
    };
    await expect(
      promoteEntry({ sourceChatBook, entryIdentifier: 'F8回归座', targetBookName, gateway: gw() }, h.io),
    ).rejects.toThrow('落盘回读失败');
    expect(h.log).not.toContain(`delete:${sourceChatBook}`);
  });

  it('回读返回 null（环境不支持）时跳过磁盘复验，保持原四步语义', async () => {
    const h = makeDebouncedIO({ withFlush: true, withReadback: false });
    h.io.readPersistedWorldbook = async () => null;
    const r = await promoteEntry({ sourceChatBook, entryIdentifier: 'F8回归座', targetBookName, gateway: gw() }, h.io);
    expect(r.success).toBe(true);
  });

  it('persistedEntriesOf：ST 原生 entries map → 复验视图', () => {
    expect(persistedEntriesOf({ entries: { '7': { uid: 7, comment: 'A', content: 'c' } } })).toEqual([
      { uid: 7, name: 'A', comment: 'A', content: 'c' },
    ]);
    expect(persistedEntriesOf(null)).toEqual([]);
  });
});

describe('expansionFiler · $promoted 悬挂记录降级（目标书已删）', () => {
  const chatBook = '红警档案·红警指挥系统·20260923T1000';
  const gateway: ChatBookGatewayLike = { begin: () => ({ chatId: 'c' }), guardedBook: async () => chatBook };
  const reg = { 观测哨戒炮座: { targetBook: '红警扩展·观测哨戒炮座', promotedAt: '2026-09-25T04:24:50.123Z' } };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(sysCheck, 'tav').mockImplementation(((name: string) => {
      if (name === 'updateWorldbookWith') return async (_b: string, u: (e: ThEntry[]) => ThEntry[]) => u([]);
      return undefined;
    }) as any);
  });

  it('promotedRecordStatus：在册 live / 已删 dangling / 名单不可用 unknown', () => {
    expect(promotedRecordStatus(reg.观测哨戒炮座, ['红警扩展·观测哨戒炮座'])).toBe('live');
    expect(promotedRecordStatus(reg.观测哨戒炮座, [])).toBe('dangling');
    expect(promotedRecordStatus(reg.观测哨戒炮座, null)).toBe('unknown');
    expect(promotedRecordStatus(undefined, [])).toBe('unknown');
  });

  it('目标书已删：forkWarning 降级为 false，打 forkStale 提示，入档照常', async () => {
    const d = makeMockExpansion({ name: '观测哨戒炮座', kind: '装备' as ExpansionKind });
    const r = await fileExpansion(d, gateway, { readPromotedFn: async () => reg, worldbookNamesFn: () => [chatBook] });
    expect(r.action).toBe('created');
    expect(r.forkWarning).toBe(false);
    expect(r.forkStale).toBe(true);
    expect(r.forkPromotedBook).toBe('红警扩展·观测哨戒炮座');
  });

  it('目标书在册：保持既有 forkWarning 语义，无 forkStale', async () => {
    const d = makeMockExpansion({ name: '观测哨戒炮座', kind: '装备' as ExpansionKind });
    const r = await fileExpansion(d, gateway, {
      readPromotedFn: async () => reg,
      worldbookNamesFn: () => [chatBook, '红警扩展·观测哨戒炮座'],
    });
    expect(r.forkWarning).toBe(true);
    expect(r.forkStale).toBeUndefined();
  });

  it('名单读取抛错：按 unknown 保持既有 forkWarning 语义', async () => {
    const d = makeMockExpansion({ name: '观测哨戒炮座', kind: '装备' as ExpansionKind });
    const r = await fileExpansion(d, gateway, {
      readPromotedFn: async () => reg,
      worldbookNamesFn: () => {
        throw new Error('x');
      },
    });
    expect(r.forkWarning).toBe(true);
  });
});

describe('expansionFiler · CHATBOOK-GRAPH-01（四段因果分带续号、增强触发词与科技↔建筑↔载具双向图谱缝合）', () => {
  it('nextExpansionOrder 按类别分带续号：科技/建筑 [71001,71999]、载具/人员/装备 [72001,72999]、人物 [75001,75999]、未知兜底 [70001,70999]', () => {
    const entries: ThEntry[] = [];

    // 空书默认起始值
    expect(nextExpansionOrder(entries, '科技')).toBe(71001);
    expect(nextExpansionOrder(entries, '建筑')).toBe(71001);
    expect(nextExpansionOrder(entries, '载具')).toBe(72001);
    expect(nextExpansionOrder(entries, '人员')).toBe(72001);
    expect(nextExpansionOrder(entries, '装备')).toBe(72001);
    expect(nextExpansionOrder(entries, '人物')).toBe(75001);
    expect(nextExpansionOrder(entries, '其他未知类别')).toBe(70001);
    expect(nextExpansionOrder(entries)).toBe(70001);

    // 写入不同频段条目后各自带内独立续号，互不干扰
    upsertExpansionEntry(entries, makeMockExpansion({ kind: '科技', name: '高能磁暴学' }));
    upsertExpansionEntry(entries, makeMockExpansion({ kind: '建筑', name: '重型磁暴反应炉' }));
    upsertExpansionEntry(entries, makeMockExpansion({ kind: '载具', name: '磁暴巡洋坦克' }));
    upsertExpansionEntry(entries, makeMockExpansion({ kind: '装备', name: '便携磁暴步枪' }));
    upsertExpansionEntry(entries, makeMockExpansion({ kind: '人物', name: '伊万·莫洛佐夫' }));

    expect(entries.find(e => e.name.includes('高能磁暴学'))?.position?.order).toBe(71001);
    expect(entries.find(e => e.name.includes('重型磁暴反应炉'))?.position?.order).toBe(71002);
    expect(entries.find(e => e.name.includes('磁暴巡洋坦克'))?.position?.order).toBe(72001);
    expect(entries.find(e => e.name.includes('便携磁暴步枪'))?.position?.order).toBe(72002);
    expect(entries.find(e => e.name.includes('伊万·莫洛佐夫'))?.position?.order).toBe(75001);

    expect(nextExpansionOrder(entries, '科技')).toBe(71003);
    expect(nextExpansionOrder(entries, '人员')).toBe(72003);
    expect(nextExpansionOrder(entries, '人物')).toBe(75002);
    expect(nextExpansionOrder(entries, '未知')).toBe(70001);
  });

  it('expansionKeys 自动提取 data.name / data.upgraded_name / data.aliases 以及人物有效代号', () => {
    const vehicleDossier = makeMockExpansion({
      kind: '载具',
      name: '天启重型坦克',
      keys: ['天启'],
      data: {
        name: '天启重型坦克',
        upgraded_name: '天启Mk.II核能攻城坦',
        aliases: ['双管猛犸', '末日天启', ' ', '天启'],
      },
    });
    expect(expansionKeys(vehicleDossier)).toEqual([
      '天启重型坦克',
      '天启',
      '天启Mk.II核能攻城坦',
      '双管猛犸',
      '末日天启',
    ]);

    const npcWithValidCallsign = makeMockExpansion({
      kind: '人物',
      name: '叶卡捷琳娜',
      params: { 代号: '霜狼少校' },
      keys: ['叶卡'],
    });
    expect(expansionKeys(npcWithValidCallsign)).toEqual(['叶卡捷琳娜', '叶卡', '霜狼少校']);

    for (const placeholder of ['无', '暂无', '未知', '-']) {
      const npcWithPlaceholder = makeMockExpansion({
        kind: '人物',
        name: '列昂尼德',
        params: { 代号: placeholder },
        keys: [],
      });
      expect(expansionKeys(npcWithPlaceholder)).toEqual(['列昂尼德']);
    }
  });

  it('extractDependencies 从 prerequisites / tech_prereq / producer / building_prereq 提取全部非空依赖名', () => {
    expect(
      extractDependencies({
        prerequisites: ['高能等离子理论', '超导电容阵列'],
        tech_prereq: '重型底盘工程',
        producer: ['重型战车工厂', '实验装配车间'],
        building_prereq: '磁能反应炉',
      }),
    ).toEqual(['高能等离子理论', '超导电容阵列', '重型底盘工程', '重型战车工厂', '实验装配车间', '磁能反应炉']);
  });

  it('linkExpansionGraph 正序缝合：先入档新科技与新建筑，再入档新载具时，父条目自动获得子触发词与衍生列装索引行', () => {
    const entries: ThEntry[] = [];

    const techDossier = makeMockExpansion({
      kind: '科技',
      name: '磁流体推进学',
      detail: '深海静默磁流体推进核心技术。',
      keys: ['磁流体'],
      data: { type: 'research', id: 'tech_mhd', name: '磁流体推进学' },
    });
    const bldDossier = makeMockExpansion({
      kind: '建筑',
      name: '深海潜艇船坞',
      detail: '专用于组装静默核潜艇的深水坞舱。',
      keys: ['潜艇坞'],
      data: {
        type: 'building',
        id: 'bld_sub_dock',
        name: '深海潜艇船坞',
        tech_prereq: '磁流体推进学',
      },
    });
    const unitDossier = makeMockExpansion({
      kind: '载具',
      name: '北风之神攻击潜艇',
      detail: '搭载超空泡鱼雷的静默猎杀潜艇。',
      keys: ['北风潜艇'],
      data: {
        type: 'production',
        id: 'unit_borei',
        name: '北风之神攻击潜艇',
        prerequisites: ['磁流体推进学'],
        producer: '深海潜艇船坞',
      },
    });

    upsertExpansionEntry(entries, techDossier);
    const bldRes = upsertExpansionEntry(entries, bldDossier);
    expect(bldRes.linkedParents).toEqual(['磁流体推进学']);

    const unitRes = upsertExpansionEntry(entries, unitDossier);
    expect(unitRes.linkedParents).toEqual(['磁流体推进学', '深海潜艇船坞']);

    const techEntry = entries.find(e => e.name === '科技·磁流体推进学·设定')!;
    const bldEntry = entries.find(e => e.name === '建筑·深海潜艇船坞·设定')!;
    const unitEntry = entries.find(e => e.name === '载具·北风之神攻击潜艇·设定')!;

    // 1. 因果分带 order：科技(71001) < 建筑(71002) < 载具(72001)
    expect(techEntry.position?.order).toBe(71001);
    expect(bldEntry.position?.order).toBe(71002);
    expect(unitEntry.position?.order).toBe(72001);

    // 2. 正向伴随唤醒：父条目 keys 包含子实体名称
    expect(techEntry.strategy?.keys).toContain('深海潜艇船坞');
    expect(techEntry.strategy?.keys).toContain('北风之神攻击潜艇');
    expect(bldEntry.strategy?.keys).toContain('北风之神攻击潜艇');

    // 3. 逆向派生索引：父条目正文在 <数据> 块前登记衍生解锁实体
    expect(techEntry.content).toContain(
      '· 衍生解锁实体：建筑「深海潜艇船坞」、载具「北风之神攻击潜艇」',
    );
    expect(techEntry.content!.indexOf('· 衍生解锁实体：')).toBeLessThan(techEntry.content!.indexOf('<数据>'));
    expect(bldEntry.content).toContain('· 衍生解锁实体：载具「北风之神攻击潜艇」');
    expect(bldEntry.content!.indexOf('· 衍生解锁实体：')).toBeLessThan(bldEntry.content!.indexOf('<数据>'));

    // 4. 重复执行 linkExpansionGraph 保持幂等，不重复追加
    linkExpansionGraph(entries, unitDossier);
    expect(bldEntry.strategy?.keys?.filter(k => k === '北风之神攻击潜艇')).toHaveLength(1);
    expect(bldEntry.content?.match(/「北风之神攻击潜艇」/g)).toHaveLength(1);
  });

  it('linkExpansionGraph 逆序缝合：先入档下游新载具，后补入档上游新科技时，新科技自动反向认领子载具', () => {
    const entries: ThEntry[] = [];

    const unitFirst = makeMockExpansion({
      kind: '载具',
      name: '耀斑轨道轰炸机',
      detail: '亚轨道高超音速战术轰炸平台。',
      keys: ['耀斑轰炸机'],
      data: {
        type: 'production',
        name: '耀斑轨道轰炸机',
        tech_prereq: '超燃冲压推进理论',
      },
    });
    const techLater = makeMockExpansion({
      kind: '科技',
      name: '超燃冲压推进理论',
      detail: '突破高超音速巡航热障与推力瓶颈。',
      keys: ['超燃冲压'],
      data: {
        type: 'research',
        name: '超燃冲压推进理论',
      },
    });

    const unitRes = upsertExpansionEntry(entries, unitFirst);
    expect(unitRes.linkedParents).toEqual([]);

    const techRes = upsertExpansionEntry(entries, techLater);
    expect(techRes.linkedChildren).toEqual(['耀斑轨道轰炸机']);

    const techEntry = entries.find(e => e.name === '科技·超燃冲压推进理论·设定')!;
    expect(techEntry.strategy?.keys).toContain('耀斑轨道轰炸机');
    expect(techEntry.content).toContain('· 衍生解锁实体：载具「耀斑轨道轰炸机」');
    expect(techEntry.recursion?.prevent_outgoing).toBe(true);
  });
});

