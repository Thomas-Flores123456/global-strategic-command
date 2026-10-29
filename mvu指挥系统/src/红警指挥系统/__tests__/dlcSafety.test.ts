import euMini from '../../../../samples/dlc/DLC测试包_欧盟mini.json' with { type: 'json' };
import euTemplate from '../../../../samples/dlc/DLC样板_欧盟.json' with { type: 'json' };
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  installDlc,
  parseManifest,
  precheckManifest,
  readUninstallPlan,
  replayCodexSeeds,
  uninstallDlc,
  validateManifestShape,
  type DlcManifest,
} from '../worldbook/dlcInstaller';
import { isCatalogOverlayUsable } from '../composables/useCatalog';

const samples: Record<string, unknown> = {
  'DLC样板_欧盟.json': euTemplate,
  'DLC测试包_欧盟mini.json': euMini,
};
const sample = (name: string): string => JSON.stringify(samples[name]);

type RawBook = { entries: Record<string, Record<string, unknown>> };

function installHost(initialBooks: Record<string, RawBook> = {}) {
  const books = new Map(Object.entries(structuredClone(initialBooks)));
  const variables: Record<string, unknown> = {};
  let charBooks: { primary: string | null; additional: string[] } = { primary: null, additional: [] };
  const writes = {
    create: vi.fn(async (name: string) => {
      const existed = books.has(name);
      books.set(name, { entries: {} }); // 对齐 createOrReplaceWorldbook：同名时也是清空语义。
      return !existed;
    }),
    import: vi.fn(async (name: string, json: string): Promise<boolean | Response> => {
      books.set(name, JSON.parse(json) as RawBook);
      return true;
    }),
    updateBook: vi.fn(
      async (name: string, updater: (entries: Record<string, unknown>[]) => Record<string, unknown>[]) => {
        const raw = books.get(name);
        if (!raw) throw new Error('not found');
        const entries = Object.values(raw.entries).map(entry => ({
          ...entry,
          name: String(entry.comment ?? entry.name ?? ''),
        }));
        const updated = await updater(entries);
        raw.entries = Object.fromEntries(
          updated.map((entry, index) => [
            String(entry.uid ?? index),
            { ...entry, comment: String(entry.name ?? entry.comment ?? '') },
          ]),
        );
        return updated;
      },
    ),
    updateVariables: vi.fn(async (updater: (value: Record<string, unknown>) => Record<string, unknown>) => {
      const updated = updater(variables);
      Object.assign(variables, updated);
      return variables;
    }),
    rebind: vi.fn(async (_character: string, next: { primary: string | null; additional: string[] }) => {
      charBooks = structuredClone(next);
    }),
    delete: vi.fn(async (name: string) => books.delete(name)),
  };

  vi.stubGlobal('SillyTavern', {
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    updateWorldInfoList: vi.fn(async () => undefined),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string }) => {
      if (url === '/api/files/sanitize-filename') {
        const fileName = JSON.parse(init?.body ?? '{}').fileName as string;
        return { ok: true, status: 200, json: async () => ({ fileName }) };
      }
      if (url === '/api/worldinfo/list') {
        return {
          ok: true,
          status: 200,
          json: async () => [...books.keys()].map(file_id => ({ file_id, name: file_id })),
        };
      }
      if (url === '/api/worldinfo/get') {
        const name = JSON.parse(init?.body ?? '{}').name as string;
        const raw = books.get(name);
        return raw
          ? { ok: true, status: 200, json: async () => structuredClone(raw) }
          : { ok: true, status: 200, json: async () => ({ entries: {} }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  (globalThis as Record<string, unknown>).getWorldbookNames = () => [...books.keys()];
  (globalThis as Record<string, unknown>).getWorldbook = async (name: string) => {
    const raw = books.get(name);
    if (!raw) throw new Error('not found');
    return Object.values(raw.entries);
  };
  (globalThis as Record<string, unknown>).getVariables = () => variables;
  (globalThis as Record<string, unknown>).createOrReplaceWorldbook = writes.create;
  (globalThis as Record<string, unknown>).importRawWorldbook = writes.import;
  (globalThis as Record<string, unknown>).updateWorldbookWith = writes.updateBook;
  (globalThis as Record<string, unknown>).updateVariablesWith = writes.updateVariables;
  (globalThis as Record<string, unknown>).getCharWorldbookNames = () => structuredClone(charBooks);
  (globalThis as Record<string, unknown>).rebindCharWorldbooks = writes.rebind;
  (globalThis as Record<string, unknown>).deleteWorldbook = writes.delete;

  return {
    books,
    variables,
    writes,
    get charBooks() {
      return structuredClone(charBooks);
    },
  };
}

const validManifest = (): DlcManifest => ({
  dlc: { id: 'safe-mini', name: '安全最小包', kind: 'addon', version: '1.0' },
  data: {
    researches: [
      {
        name: '安全研究',
        cost: 100,
        eta: '约1日',
        line: '测试',
        tier: 1,
        unlocks: '安全建筑',
        prereq: '——',
        prereqs: [],
        desc: '测试',
      },
    ],
    buildings: [
      {
        name: '安全建筑',
        cost: 100,
        power: 10,
        research: '安全研究',
        prereqs: ['安全研究'],
        need_buildings: [],
        desc: '测试',
      },
    ],
    productions: [
      {
        name: '安全单位',
        cost: 100,
        need_building: '安全建筑',
        need_buildings: ['安全建筑'],
        desc: '测试',
      },
    ],
  },
});

describe('S1-B DLC fail-closed 边界', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as Record<string, unknown>).getWorldbookNames;
    delete (globalThis as Record<string, unknown>).getVariables;
    for (const name of [
      'getWorldbook',
      'createOrReplaceWorldbook',
      'importRawWorldbook',
      'updateWorldbookWith',
      'updateVariablesWith',
      'rebindCharWorldbooks',
      'getCharWorldbookNames',
      'deleteWorldbook',
    ]) {
      delete (globalThis as Record<string, unknown>)[name];
    }
    vi.restoreAllMocks();
  });
  it('现行两份 samples/dlc 样板可解析且 catalog 数据无 R3 阻断', () => {
    for (const file of ['DLC样板_欧盟.json', 'DLC测试包_欧盟mini.json']) {
      const parsed = parseManifest(sample(file));
      expect(parsed.error).toBeUndefined();
      expect(parsed.manifest).toBeDefined();
      expect(
        precheckManifest(parsed.manifest!, []).filter(issue => issue.rule === 'R3' && issue.level === 'error'),
      ).toEqual([]);
    }
  });

  it('parseManifest 拒绝非数组集合、非对象条目和非法主键', () => {
    const cases = [
      { ...validManifest(), data: { researches: {} } },
      { ...validManifest(), data: { buildings: [null] } },
      { ...validManifest(), dlc: { ...validManifest().dlc, id: ' bad ' } },
      { ...validManifest(), worldbooks: {} },
      {
        ...validManifest(),
        worldbooks: [
          { name: '重复书', book: { entries: {} } },
          { name: '重复书', book: { entries: {} } },
        ],
      },
      { ...validManifest(), patch: { takeover: [{ from: 'A', to: 'B', entries: [null] }] } },
      { ...validManifest(), data: { faction: { mcv: 'MCV', lab: '实验室', labResearch: { bad: true } } } },
      {
        ...validManifest(),
        data: { codex: [{ name: '坏种子', kind: '科技', desc: '测试', params: { 造价: 123 } }] },
      },
    ];
    for (const value of cases) {
      expect(validateManifestShape(value)).toBeTypeOf('string');
      const parsed = parseManifest(JSON.stringify(value));
      expect(parsed.manifest).toBeUndefined();
      expect(parsed.error).toBeTruthy();
    }
  });

  it('precheckManifest 对绕过 parser 的畸形对象返回 R3，不抛异常', () => {
    const malformed = {
      ...validManifest(),
      data: { researches: [null], buildings: {}, productions: '坏集合' },
    } as unknown as DlcManifest;
    expect(() => precheckManifest(malformed, [])).not.toThrow();
    expect(precheckManifest(malformed, [])).toEqual([
      expect.objectContaining({ rule: 'R3', level: 'error', target: '(manifest)' }),
    ]);
  });

  it('未知 core 语法、过高版本和研究前置环均为硬阻断', () => {
    const unknownCore = validManifest();
    unknownCore.dlc.requires = { core: '^2.0' };
    expect(precheckManifest(unknownCore, [])).toContainEqual(expect.objectContaining({ rule: 'REQ', level: 'error' }));

    const futureCore = validManifest();
    futureCore.dlc.requires = { core: '>=9.9' };
    expect(precheckManifest(futureCore, [])).toContainEqual(expect.objectContaining({ rule: 'REQ', level: 'error' }));

    const cycle = validManifest();
    cycle.data!.researches = [
      { ...cycle.data!.researches![0], name: '研究A', prereqs: ['研究B'] },
      {
        ...cycle.data!.researches![0],
        name: '研究B',
        prereqs: [],
        requirements: { kind: 'research', name: '研究A' },
      },
    ];
    expect(precheckManifest(cycle, [])).toContainEqual(
      expect.objectContaining({ rule: 'R3', level: 'error', target: '(research graph)' }),
    );

    const crossPackage = validManifest();
    crossPackage.data!.researches = [{ ...crossPackage.data!.researches![0], name: '研究A', prereqs: ['研究B'] }];
    const installed = [
      {
        id: 'installed',
        researches: [{ ...validManifest().data!.researches![0], name: '研究B', prereqs: ['研究A'] }],
      },
    ];
    expect(precheckManifest(crossPackage, installed)).toContainEqual(
      expect.objectContaining({ rule: 'R3', level: 'error', target: '(research graph)' }),
    );

    const replacement = validManifest();
    replacement.data!.researches = [{ ...replacement.data!.researches![0], name: '新研究A', prereqs: ['旧研究B'] }];
    const oldSameId = [
      {
        id: replacement.dlc.id,
        researches: [{ ...validManifest().data!.researches![0], name: '旧研究B', prereqs: ['新研究A'] }],
      },
    ];
    expect(precheckManifest(replacement, oldSameId).filter(issue => issue.target === '(research graph)')).toEqual([]);
  });

  it('预检所有权必须带资产指纹；新加书撞手工书阻断且 install 零写入', async () => {
    const host = installHost({ 手工书: { entries: {} } });
    const installed = [
      {
        id: 'safe-mini',
        books: ['旧包书'],
        bookAssets: { 旧包书: { fingerprint: 'a'.repeat(64), installedVersion: '1.0' } },
      },
    ];
    const ownBook = validManifest();
    ownBook.worldbooks = [{ name: '旧包书', book: { entries: {} } }];
    expect(precheckManifest(ownBook, installed).filter(issue => issue.rule === 'R10')).toEqual([]);

    const legacyOnly = [{ id: 'safe-mini', books: ['旧包书'] }];
    // UI 预检在清单无此书时只能给非阻断预览；执行门会用实时书体 + registry 指纹硬拒绝。
    expect(precheckManifest(ownBook, legacyOnly).filter(issue => issue.rule === 'R10')).toEqual([]);

    const newCollision = validManifest();
    newCollision.worldbooks = [{ name: '手工书', book: { entries: {} } }];
    await expect(installDlc(newCollision, () => undefined, [])).rejects.toThrow('同名世界书');
    for (const write of Object.values(host.writes)) expect(write).not.toHaveBeenCalled();
  });

  it('installDlc 执行时实时注册表优先于 UI 缓存，旧缓存不能伪造书所有权', async () => {
    installHost({ 手工书: { entries: {} } });
    const collision = validManifest();
    collision.worldbooks = [{ name: '手工书', book: { entries: {} } }];
    const stale = [
      {
        id: 'safe-mini',
        books: ['手工书'],
        bookAssets: { 手工书: { fingerprint: 'a'.repeat(64), installedVersion: '1.0' } },
      },
    ];
    await expect(installDlc(collision, () => undefined, stale)).rejects.toThrow('同名世界书');
  });

  it('涉及世界书但实时读接口缺失时，执行门零写入拒绝', async () => {
    const manifest = validManifest();
    manifest.worldbooks = [{ name: '新包书', book: { entries: {} } }];
    const write = vi.fn();
    (globalThis as Record<string, unknown>).getVariables = () => ({});
    (globalThis as Record<string, unknown>).createOrReplaceWorldbook = write;
    await expect(installDlc(manifest, () => undefined)).rejects.toThrow('实时世界书读取接口不可用');
    expect(write).not.toHaveBeenCalled();
  });

  it('实时清单可读但目标书读取 reject 时为 unreadable，所有写 API 保持零调用', async () => {
    const host = installHost({ 手工书: { entries: {} } });
    const baseFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/worldinfo/get') throw new Error('temporary read failure');
        return baseFetch(url, init);
      }),
    );
    const manifest = validManifest();
    manifest.worldbooks = [{ name: '手工书', book: { entries: {} } }];
    await expect(installDlc(manifest, () => undefined)).rejects.toThrow('temporary read failure');
    for (const write of Object.values(host.writes)) expect(write).not.toHaveBeenCalled();
  });

  it('服务端会清洗改名的世界书名在任何写 API 前阻断，避免文件主键碰撞', async () => {
    const host = installHost();
    const baseFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/files/sanitize-filename') {
          return { ok: true, status: 200, json: async () => ({ fileName: '危险书名' }) };
        }
        return baseFetch(url, init);
      }),
    );
    const manifest = validManifest();
    manifest.worldbooks = [{ name: '危险/书名', book: { entries: {} } }];
    await expect(installDlc(manifest, () => undefined)).rejects.toThrow('非法文件字符');
    for (const write of Object.values(host.writes)) expect(write).not.toHaveBeenCalled();
  });

  it('目标书在实时 list/get/list 探测期间消失时为 unreadable，零写入', async () => {
    const host = installHost({ 瞬态书: { entries: {} } });
    let listReads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/files/sanitize-filename') {
          return { ok: true, status: 200, json: async () => ({ fileName: '瞬态书' }) };
        }
        if (url === '/api/worldinfo/list') {
          listReads++;
          return {
            ok: true,
            status: 200,
            json: async () => (listReads === 1 ? [{ file_id: '瞬态书', name: '瞬态书' }] : []),
          };
        }
        if (url === '/api/worldinfo/get') {
          return { ok: true, status: 200, json: async () => ({ entries: {} }) };
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    const manifest = validManifest();
    manifest.worldbooks = [{ name: '瞬态书', book: { entries: {} } }];
    await expect(installDlc(manifest, () => undefined)).rejects.toThrow('清单在读取期间变化');
    for (const write of Object.values(host.writes)) expect(write).not.toHaveBeenCalled();
  });

  it('importRawWorldbook 的失败 Response/boolean 都判失败，且新建空书会清理', async () => {
    for (const failure of [false, new Response(null, { status: 500 })]) {
      const host = installHost();
      host.writes.import.mockResolvedValueOnce(failure);
      const manifest = validManifest();
      manifest.worldbooks = [{ name: '失败包书', book: { entries: {} } }];
      await expect(installDlc(manifest, () => undefined)).rejects.toThrow('importRawWorldbook 返回失败状态');
      expect(host.books.has('失败包书')).toBe(false);
      expect(host.writes.updateVariables).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    }
  });

  it('覆盖既有包资产时导入失败会按快照回滚，并重新核验原始指纹', async () => {
    const host = installHost();
    const manifest = validManifest();
    manifest.worldbooks = [
      {
        name: '回滚包书',
        book: { entries: { '0': { uid: 0, key: ['A'], comment: 'A', content: 'v1', constant: false } } },
      },
    ];
    await installDlc(manifest, () => undefined);
    const v2 = structuredClone(manifest);
    v2.dlc.version = '2.0';
    v2.worldbooks![0].book.entries['0'].content = 'v2';
    host.writes.import.mockImplementationOnce(async (name: string, json: string) => {
      host.books.set(name, JSON.parse(json) as RawBook);
      return false;
    });
    await expect(installDlc(v2, () => undefined)).rejects.toThrow('importRawWorldbook 返回失败状态');
    expect(host.books.get('回滚包书')?.entries['0'].content).toBe('v1');
    expect((host.variables.$dlc as Record<string, Record<string, unknown>>)['safe-mini'].version).toBe('1.0');
  });

  it('安装登记内容指纹；书体被手工替换后重装与卸载均零覆盖零删除', async () => {
    const host = installHost();
    const manifest = validManifest();
    manifest.worldbooks = [
      {
        name: '包资产书',
        book: {
          entries: {
            '0': { uid: 0, key: ['包资产'], comment: '包资产', content: '包内容', constant: false },
          },
        },
      },
    ];
    await installDlc(manifest, () => undefined);
    const registered = (host.variables.$dlc as Record<string, Record<string, unknown>>)['safe-mini'];
    expect(registered.bookAssets).toEqual({
      包资产书: expect.objectContaining({
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        installedVersion: '1.0',
      }),
    });
    expect(readUninstallPlan('safe-mini')).not.toBeNull();

    host.books.set('包资产书', {
      entries: {
        '0': { uid: 0, key: ['手工'], comment: '手工', content: '用户重建的同名书', constant: false },
      },
    });
    const importCalls = host.writes.import.mock.calls.length;
    const deleteCalls = host.writes.delete.mock.calls.length;
    await expect(installDlc(manifest, () => undefined)).rejects.toThrow('内容已漂移');
    await expect(uninstallDlc('safe-mini', () => undefined)).rejects.toThrow('内容已漂移');
    expect(host.writes.import).toHaveBeenCalledTimes(importCalls);
    expect(host.writes.delete).toHaveBeenCalledTimes(deleteCalls);
    expect(host.books.get('包资产书')?.entries['0'].content).toBe('用户重建的同名书');
  });

  it('指纹匹配的包可正常卸载，删除资产并清理注册表', async () => {
    const host = installHost();
    const manifest = validManifest();
    manifest.worldbooks = [{ name: '可卸载包书', book: { entries: {} } }];
    await installDlc(manifest, () => undefined);
    expect(readUninstallPlan('safe-mini')).toEqual(expect.objectContaining({ id: 'safe-mini', books: ['可卸载包书'] }));

    await uninstallDlc('safe-mini', () => undefined);
    expect(host.books.has('可卸载包书')).toBe(false);
    expect((host.variables.$dlc as Record<string, unknown>)?.['safe-mini']).toBeUndefined();
  });

  it('同一 manifest 的包体书不能同时作为 takeover 源书', async () => {
    const host = installHost({ 冲突书: { entries: {} } });
    const manifest = validManifest();
    manifest.worldbooks = [{ name: '冲突书', book: { entries: {} } }];
    manifest.patch = { takeover: [{ from: '冲突书', entries: [], to: '冲突书' }] };
    await expect(installDlc(manifest, () => undefined)).rejects.toThrow('不能同时作为包体和 takeover 源书');
    for (const write of Object.values(host.writes)) expect(write).not.toHaveBeenCalled();
  });

  it('不同 DLC 不得重复接管或认领同一本源书，冲突时零新增写入', async () => {
    const host = installHost({
      共享原生书: {
        entries: {
          '0': { uid: 0, key: ['共享条目'], comment: '共享条目', content: '原始正文', constant: false },
        },
      },
    });
    const first = validManifest();
    first.patch = { takeover: [{ from: '共享原生书', entries: ['共享条目'], to: '第一包档案' }] };
    await installDlc(first, () => undefined);
    const writeCounts = Object.fromEntries(
      Object.entries(host.writes).map(([name, spy]) => [name, spy.mock.calls.length]),
    );

    const rival = validManifest();
    rival.dlc = { ...rival.dlc, id: 'rival', name: '竞争包' };
    rival.data = {};
    rival.patch = { takeover: [{ from: '共享原生书', entries: ['共享条目'], to: '竞争包档案' }] };
    await expect(installDlc(rival, () => undefined)).rejects.toThrow('已由包 safe-mini 接管');
    for (const [name, spy] of Object.entries(host.writes)) {
      expect(spy).toHaveBeenCalledTimes(writeCounts[name]);
    }
  });

  it('takeover 登记独立指纹：未漂移可恢复原文，漂移后卸载零回写', async () => {
    const source = {
      原生书: {
        entries: {
          '0': { uid: 0, key: ['原条目'], comment: '原条目', content: '原始正文', constant: false },
        },
      },
    };
    const manifest = validManifest();
    manifest.patch = { takeover: [{ from: '原生书', entries: ['原条目'], to: 'DLC档案书' }] };

    const cleanHost = installHost(source);
    await installDlc(manifest, () => undefined);
    expect(cleanHost.books.get('原生书')?.entries['0'].content).toContain('型号主权已由 DLC');
    await uninstallDlc('safe-mini', () => undefined);
    expect(cleanHost.books.get('原生书')?.entries['0'].content).toBe('原始正文');

    vi.unstubAllGlobals();
    const driftHost = installHost(source);
    await installDlc(manifest, () => undefined);
    driftHost.books.get('原生书')!.entries['0'].content = '用户后续手工修改';
    const updateCalls = driftHost.writes.updateBook.mock.calls.length;
    await expect(uninstallDlc('safe-mini', () => undefined)).rejects.toThrow('内容已漂移');
    expect(driftHost.writes.updateBook).toHaveBeenCalledTimes(updateCalls);
    expect(driftHost.books.get('原生书')?.entries['0'].content).toBe('用户后续手工修改');
  });

  it('严格合法的 registry codex/faction 可正常重放缺失种子', async () => {
    installHost();
    (globalThis as Record<string, unknown>).getVariables = () => ({
      $dlc: {
        valid: {
          version: '1.0',
          name: '合法阵营包',
          kind: 'faction',
          installedAt: '2026-09-03T00:00:00Z',
          books: [],
          backups: {},
          codexSeeds: ['合法阵营'],
          data: {
            faction: { name: '合法阵营', mcv: '合法MCV', lab: '合法实验室', labResearch: null },
            codex: [
              { name: '合法阵营', kind: '阵营', desc: '合法种子', params: { MCV: '合法MCV', 实验室: '合法实验室' } },
            ],
          },
        },
      },
    });
    const push = vi.fn();
    await expect(replayCodexSeeds('valid', [], push)).resolves.toEqual(['合法阵营']);
    expect(push).toHaveBeenCalledWith([
      expect.objectContaining({ name: '合法阵营', params: { MCV: '合法MCV', 实验室: '合法实验室' } }),
    ]);
  });

  it('损坏注册表和旧式仅书名所有权均不能生成卸载计划或删除世界书', async () => {
    const host = installHost({ 手工书: { entries: {} } });
    host.variables.$dlc = {
      broken: { data: 'BROKEN', books: ['手工书'], backups: {}, codexSeeds: [] },
    };
    expect(readUninstallPlan('broken')).toBeNull();
    await expect(uninstallDlc('broken', () => undefined)).rejects.toThrow('$dlc 注册表损坏');
    expect(host.writes.delete).not.toHaveBeenCalled();

    host.variables.$dlc = {
      legacy: {
        version: '1.0',
        name: '旧包',
        kind: 'addon',
        installedAt: '2026-09-03T00:00:00Z',
        data: {},
        books: ['手工书'],
        backups: {},
        codexSeeds: [],
      },
    };
    expect(readUninstallPlan('legacy')).toBeNull();
    await expect(uninstallDlc('legacy', () => undefined)).rejects.toThrow('缺少可核验所有权指纹');
    expect(host.writes.delete).not.toHaveBeenCalled();
  });

  it('installDlc 自身重复完整硬预检，不兼容包在探测酒馆写 API 前即拒绝', async () => {
    const malformed = {
      ...validManifest(),
      data: { ...validManifest().data, researches: [{ ...validManifest().data!.researches![0], name: ' 坏研究 ' }] },
    } as DlcManifest;
    await expect(installDlc(malformed, () => undefined)).rejects.toThrow('DLC 预检失败，未执行安装');

    const incompatible = validManifest();
    incompatible.dlc.requires = { core: '>=9.9' };
    await expect(installDlc(incompatible, () => undefined)).rejects.toThrow('DLC 预检失败，未执行安装');
  });

  it('安装末步注册表写入失败时恢复新书与角色卡绑定，不留下半安装状态', async () => {
    const host = installHost();
    const manifest = validManifest();
    manifest.worldbooks = [{ name: '事务安装书', book: { entries: {} } }];
    host.writes.updateVariables.mockRejectedValueOnce(new Error('registry write failed'));

    await expect(installDlc(manifest, () => undefined)).rejects.toThrow('DLC 安装失败');
    expect(host.books.has('事务安装书')).toBe(false);
    expect(host.charBooks.additional).toEqual([]);
    expect(host.variables.$dlc).toBeUndefined();
  });

  it('卸载末步注册表写入失败时恢复已删书与角色卡绑定，保留原注册表', async () => {
    const host = installHost();
    const manifest = validManifest();
    manifest.worldbooks = [{ name: '事务卸载书', book: { entries: {} } }];
    await installDlc(manifest, () => undefined);
    host.writes.updateVariables.mockRejectedValueOnce(new Error('registry delete failed'));

    await expect(uninstallDlc('safe-mini', () => undefined)).rejects.toThrow('DLC 卸载失败');
    expect(host.books.has('事务卸载书')).toBe(true);
    expect(host.charBooks.additional).toEqual(['事务卸载书']);
    expect((host.variables.$dlc as Record<string, unknown>)['safe-mini']).toBeDefined();
  });

  it('同一坏嵌套样本在 parse/precheck/install/runtime overlay 四层均 fail-closed', async () => {
    const nestedCases = [
      {
        ...validManifest(),
        data: { faction: { mcv: 'MCV', lab: '实验室', labResearch: { bad: true } } },
      },
      {
        ...validManifest(),
        data: { codex: [{ name: '坏种子', kind: '科技', desc: '测试', params: { 造价: 123 } }] },
      },
    ];
    for (const value of nestedCases) {
      expect(parseManifest(JSON.stringify(value)).manifest).toBeUndefined();
      const malformed = value as unknown as DlcManifest;
      expect(precheckManifest(malformed, [])).toContainEqual(expect.objectContaining({ rule: 'R3', level: 'error' }));
      await expect(installDlc(malformed, () => undefined)).rejects.toThrow('DLC 预检失败，未执行安装');
      expect(isCatalogOverlayUsable({ id: 'nested-bad', ...(value.data as object) })).toBe(false);
    }
  });

  it('损坏注册表或 faction 嵌套字段拒绝重放，不向 MVU 推送', async () => {
    (globalThis as Record<string, unknown>).getVariables = () => ({
      $dlc: {
        broken: {
          codexSeeds: ['坏种子'],
          data: { codex: [{ name: '坏种子', kind: '科技', desc: '测试', params: { 造价: 123 } }] },
        },
      },
    });
    const push = vi.fn();
    await expect(replayCodexSeeds('broken', [], push)).rejects.toThrow('$dlc 注册表损坏');
    expect(push).not.toHaveBeenCalled();

    (globalThis as Record<string, unknown>).getVariables = () => ({
      $dlc: {
        badFaction: {
          version: '1.0',
          name: '坏阵营包',
          kind: 'faction',
          installedAt: '2026-09-03T00:00:00Z',
          books: [],
          backups: {},
          codexSeeds: ['坏阵营'],
          data: {
            faction: { name: '坏阵营', mcv: { bad: true }, lab: '实验室', labResearch: { bad: true } },
          },
        },
      },
    });
    await expect(replayCodexSeeds('badFaction', [], push)).rejects.toThrow('$dlc 注册表损坏');
    expect(push).not.toHaveBeenCalled();
  });

  it('运行时有效目录只接受零 error overlay，损坏包仍可留给体检显示', () => {
    const valid = { id: 'valid-overlay', ...(validManifest().data ?? {}) };
    const malformed = { id: 'bad-overlay', researches: {}, buildings: [null] };
    const badFaction = {
      id: 'bad-faction',
      faction: { mcv: 'MCV', lab: '实验室', labResearch: { bad: true } },
    };
    expect(isCatalogOverlayUsable(valid)).toBe(true);
    expect(isCatalogOverlayUsable(malformed)).toBe(false);
    expect(isCatalogOverlayUsable(badFaction)).toBe(false);
    expect(isCatalogOverlayUsable({ id: 'bad-registry-entry', dataError: '注册表条目必须是对象' })).toBe(false);
    expect(isCatalogOverlayUsable({ id: 'bad-registry-data', dataError: '注册表 data 必须是对象' })).toBe(false);
  });
});
