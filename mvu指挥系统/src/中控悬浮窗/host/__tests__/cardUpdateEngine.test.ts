import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CARD_UPDATE_PREFS_STORAGE_KEY,
  DEFAULT_UPDATE_CONFIG,
  PNG_SIGNATURE,
  cardUpdateState,
  checkCardUpdate,
  checkCardUpdateViaLocalOrRemote,
  computeCrc32,
  createPngTextChunk,
  deriveCdnFallbackUrls,
  dismissCardUpdatePrompt,
  evaluateUpdatePlan,
  extractCardDataFromPngBuffer,
  extractVersionFromCardBlob,
  fetchWithCdnFallback,
  getCardUpdatePreferences,
  getCurrentChatSaveSchema,
  getLocalCardVersion,
  isPngBytes,
  loadUpdateConfig,
  performSafeCardUpdate,
  probeLocalServerVersionStatus,
  resetCardUpdateState,
  resolveCurrentAvatarFile,
  runStartupUpdateFlow,
  safeCompareVersion,
  saveUpdateConfig,
  setCardUpdatePreferences,
  triggerLocalServerUpdate,
  verifyDownloadedCardPngVersion,
  wrapJsonCardIntoPng,
  type CardUpdateManifest,
  type LocalServerVersionStatus,
} from '../cardUpdateEngine';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

function createRawChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.byteLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength, false);
  for (let i = 0; i < 4; i++) {
    chunk[4 + i] = type.charCodeAt(i);
  }
  chunk.set(data, 8);
  const crc = computeCrc32(chunk.subarray(4, 8 + data.byteLength));
  view.setUint32(8 + data.byteLength, crc, false);
  return chunk;
}

function buildTestPngBytes(textChunks: Array<{ keyword: string; jsonObj: Record<string, unknown> }> = []): Uint8Array {
  // 构造带合法 IHDR (13 bytes) + 可选 tEXt + IEND 的真实 PNG 二进制结构
  const ihdrData = new Uint8Array([
    0x00, 0x00, 0x00, 0x10, // width = 16
    0x00, 0x00, 0x00, 0x10, // height = 16
    0x08, // bit depth = 8
    0x06, // color type = RGBA
    0x00, // compression
    0x00, // filter
    0x00, // interlace
  ]);
  const ihdrChunk = createRawChunk('IHDR', ihdrData);
  const tEXtChunks = textChunks.map(item => {
    const base64 = Buffer.from(JSON.stringify(item.jsonObj), 'utf-8').toString('base64');
    return createPngTextChunk(item.keyword, base64);
  });
  const iendChunk = createRawChunk('IEND', new Uint8Array(0));

  const parts = [PNG_SIGNATURE, ihdrChunk, ...tEXtChunks, iendChunk];
  const totalLen = parts.reduce((acc, p) => acc + p.byteLength, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

describe('FD-47 · W2 cardUpdateEngine 远端清单检测与生产级安全写卡引擎', () => {
  const g = globalThis as Record<string, unknown>;

  beforeEach(() => {
    resetCardUpdateState();
    vi.stubGlobal('localStorage', createMemoryStorage());
    delete g.SillyTavern;
    delete g.getCharacter;
    delete g.getCurrentCharacterName;
    delete g.getCharWorldbookNames;
    delete g.getVariables;
    delete g.importRawCharacter;
    delete g.initializeGlobal;
    delete g.eventEmit;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('1. safeCompareVersion：支持带前导 v/V 的标准 semver 比对，且遇到非标版本号（如 "新春版"）绝不抛异常', () => {
    expect(safeCompareVersion('v1.0.0', '1.2.0', '<')).toBe(true);
    expect(safeCompareVersion('V1.2.0', 'v1.2.0', '=')).toBe(true);
    expect(safeCompareVersion('1.10.0', '1.2.0', '>')).toBe(true);
    expect(safeCompareVersion('1.2.0-beta.1', '1.2.0', '<')).toBe(true);

    // 非标版本号安全回退：不抛错
    expect(() => safeCompareVersion('新春版', '1.2.0', '<')).not.toThrow();
    expect(() => safeCompareVersion('1.0.0', '新春特别版', '<')).not.toThrow();
    expect(safeCompareVersion('新春版', '新春版', '=')).toBe(true);
    expect(safeCompareVersion('新春版', '中秋版', '=')).toBe(false);

    // 本地为 0.0.0 而远端为非空非标版本号时，判定本地 < 远端
    expect(safeCompareVersion('0.0.0', '新春贺岁版', '<')).toBe(true);
    expect(safeCompareVersion('新春贺岁版', '0.0.0', '>')).toBe(true);
  });

  it('2. evaluateUpdatePlan：跨版本 1.0.0 -> 1.2.0（中间 1.1.0 含 breaking_save: true）精准拦截并聚合警告，且支持 save_schema 代数提升与旧聊天代差检测', () => {
    const manifest: CardUpdateManifest = {
      card_name: '红警系统·测试',
      latest_version: '1.2.0',
      save_schema: 2,
      card_url: 'https://testingcf.jsdelivr.net/gh/author/repo@v{version}/card.png',
      releases: [
        {
          version: '1.2.0',
          date: '2026-10-28',
          breaking_save: false,
          notes: ['优化雷达小地图帧率'],
        },
        {
          version: '1.1.0',
          date: '2026-10-20',
          breaking_save: true,
          save_schema: 2,
          save_warning: '重构了分基地驻防字段结构，直接覆盖将导致旧驻防队列丢失',
          notes: ['重构分基地驻防账本'],
        },
        {
          version: '1.0.0',
          date: '2026-10-01',
          breaking_save: false,
          notes: ['初始发布'],
        },
      ],
    };

    const plan = evaluateUpdatePlan('1.0.0', 2, manifest);
    expect(plan.hasUpdate).toBe(true);
    expect(plan.missedReleases.map(r => r.version)).toEqual(['1.2.0', '1.1.0']);
    expect(plan.hasBreakingSaveChange).toBe(true);
    expect(plan.breakingWarnings).toEqual([
      '[v1.1.0] 重构了分基地驻防字段结构，直接覆盖将导致旧驻防队列丢失',
    ]);

    // 测试仅由 save_schema 代数提升（2 -> 3）触发的高危判定及默认警告生成
    const schemaBumpManifest: CardUpdateManifest = {
      card_name: '红警系统·测试',
      latest_version: '1.3.0',
      save_schema: 3,
      card_url: 'https://cdn.jsdelivr.net/gh/author/repo@v{version}/card.png',
      releases: [
        {
          version: '1.3.0',
          breaking_save: false,
          notes: ['升级第 3 代存档结构'],
        },
      ],
    };
    const schemaPlan = evaluateUpdatePlan('1.2.0', 2, schemaBumpManifest, 2);
    expect(schemaPlan.hasUpdate).toBe(true);
    expect(schemaPlan.hasBreakingSaveChange).toBe(true);
    expect(schemaPlan.hasLegacyChatSaveMismatch).toBe(true);
    expect(schemaPlan.breakingWarnings[0]).toContain('第 2 代 ▸ 第 3 代');
  });

  it('3. deriveCdnFallbackUrls & fetchWithCdnFallback：自动替换 {version} 并在 testingcf.jsdelivr.net 与 cdn.jsdelivr.net 之间双源备援', async () => {
    const urlsFromTestingCf = deriveCdnFallbackUrls(
      'https://testingcf.jsdelivr.net/gh/StageDog/redalert@v{version}/card.png',
      'v1.2.0',
    );
    expect(urlsFromTestingCf).toEqual([
      'https://testingcf.jsdelivr.net/gh/StageDog/redalert@v1.2.0/card.png',
      'https://cdn.jsdelivr.net/gh/StageDog/redalert@v1.2.0/card.png',
    ]);

    const urlsFromCdn = deriveCdnFallbackUrls(
      'https://cdn.jsdelivr.net/gh/StageDog/redalert@{version}/manifest.json',
      '1.2.0',
    );
    expect(urlsFromCdn).toEqual([
      'https://cdn.jsdelivr.net/gh/StageDog/redalert@1.2.0/manifest.json',
      'https://testingcf.jsdelivr.net/gh/StageDog/redalert@1.2.0/manifest.json',
    ]);

    // 验证主源 502 时自动回退至备源成功返回
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('testingcf.jsdelivr.net')) {
        return new Response('Bad Gateway', { status: 502, statusText: 'Bad Gateway' });
      }
      return new Response(JSON.stringify({ ok: true, source: 'cdn' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const data = await fetchWithCdnFallback<{ ok: boolean; source: string }>(
      'https://testingcf.jsdelivr.net/gh/StageDog/redalert@main/manifest.json',
      'json',
      5000,
    );
    expect(data).toEqual({ ok: true, source: 'cdn' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('4. extractVersionFromCardBlob & wrapJsonCardIntoPng：解析 PNG ccv3/chara tEXt 块版本号，并将 JSON 卡封装入真实头像 PNG', async () => {
    const pngBytes = buildTestPngBytes([
      {
        keyword: 'chara',
        jsonObj: { name: '红警系统·测试', data: { character_version: '1.1.0' } },
      },
      {
        keyword: 'ccv3',
        jsonObj: { name: '红警系统·测试', data: { character_version: '1.2.0' } },
      },
    ]);
    expect(isPngBytes(pngBytes)).toBe(true);

    // ccv3 优先级高于 chara
    const pngBlob = new Blob([pngBytes], { type: 'image/png' });
    const extractedVer = await extractVersionFromCardBlob(pngBlob);
    expect(extractedVer).toBe('1.2.0');

    // 将新版 JSON 角色卡封装进现有 PNG 头像，验证移除旧块并写入新版本 1.3.0
    const updatedCardJson = JSON.stringify({
      name: '红警系统·测试',
      data: {
        name: '红警系统·测试',
        character_version: '1.3.0',
      },
    });
    const wrappedBlob = await wrapJsonCardIntoPng('红警系统·测试', updatedCardJson, pngBytes);
    const wrappedBytes = new Uint8Array(await wrappedBlob.arrayBuffer());
    expect(isPngBytes(wrappedBytes)).toBe(true);
    expect(await extractVersionFromCardBlob(wrappedBlob)).toBe('1.3.0');
  });

  it('5. CDN 缓存不一致拒止门禁（TRAP-03）：当 manifest.latest_version 为 1.2.0 但下载到的 PNG 内部版本为 1.1.0 时，立即中止且 importRawCharacter 调用次数为 0', async () => {
    const stalePngBytes = buildTestPngBytes([
      {
        keyword: 'ccv3',
        jsonObj: {
          name: '红警系统·测试',
          data: { character_version: '1.1.0' },
        },
      },
    ]);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob([stalePngBytes], { type: 'image/png' }), { status: 200 })),
    );
    const importRawCharacterMock = vi.fn();
    g.importRawCharacter = importRawCharacterMock;

    const checkResult = evaluateUpdatePlan('1.0.0', 2, {
      card_name: '红警系统·测试',
      latest_version: '1.2.0',
      save_schema: 2,
      card_url: 'https://testingcf.jsdelivr.net/gh/author/repo@v{version}/card.png',
      releases: [{ version: '1.2.0', breaking_save: false, notes: 'update' }],
    });

    const updateRes = await performSafeCardUpdate(checkResult);
    expect(updateRes.ok).toBe(false);
    expect(updateRes.error).toContain('1.1.0');
    expect(updateRes.error).toContain('1.2.0');
    expect(importRawCharacterMock).toHaveBeenCalledTimes(0);
    expect(cardUpdateState.stage).toBe('error');
  });

  it('6. 重名卡 卡名1.png 的 finishImport 补救闭环（TRAP-02）+ autoUpdateSilent 遇 breaking_save 强制拦截', async () => {
    const validPngBytes = buildTestPngBytes([
      {
        keyword: 'ccv3',
        jsonObj: {
          name: '红警系统·测试',
          data: {
            character_version: '1.2.0',
            character_book: {
              name: '红警世界书',
              entries: { 0: { comment: '核心规则', content: 'test' } },
            },
          },
        },
      },
    ]);

    const getCharactersMock = vi.fn(async () => {});
    const getOneCharacterMock = vi.fn(async () => {});
    const saveWorldInfoMock = vi.fn(async () => {});
    const reloadWorldInfoEditorMock = vi.fn();
    const convertCharacterBookMock = vi.fn((book: unknown) => ({ converted: true, book }));
    const reloadCurrentChatMock = vi.fn(async () => {});

    g.SillyTavern = {
      characterId: '0',
      characters: [
        {
          name: '红警系统·测试',
          avatar: '红警系统·测试1.png',
          data: {
            name: '红警系统·测试',
            character_version: '1.2.0',
            character_book: {
              name: '红警世界书',
              entries: { 0: { comment: '核心规则', content: 'test' } },
            },
          },
        },
      ],
      getCharacters: getCharactersMock,
      getOneCharacter: getOneCharacterMock,
      saveWorldInfo: saveWorldInfoMock,
      reloadWorldInfoEditor: reloadWorldInfoEditorMock,
      convertCharacterBook: convertCharacterBookMock,
      reloadCurrentChat: reloadCurrentChatMock,
    };

    expect(resolveCurrentAvatarFile('红警系统·测试')).toBe('红警系统·测试1.png');
    expect(await getLocalCardVersion('红警系统·测试')).toBe('1.2.0');

    // 模拟 importRawCharacter 抛出「角色卡 '红警系统·测试1' 不存在」伪异常
    const importRawCharacterMock = vi.fn(async (filename: string) => {
      throw new Error(`角色卡 '${filename}' 不存在`);
    });
    g.importRawCharacter = importRawCharacterMock;
    g.initializeGlobal = vi.fn();
    g.eventEmit = vi.fn();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob([validPngBytes], { type: 'image/png' }), { status: 200 })),
    );

    const checkResult = evaluateUpdatePlan('1.0.0', 2, {
      card_name: '红警系统·测试',
      latest_version: '1.2.0',
      save_schema: 2,
      card_url: 'https://testingcf.jsdelivr.net/gh/author/repo@v{version}/card.png',
      releases: [{ version: '1.2.0', breaking_save: false, notes: '常规更新' }],
    });

    const stages: string[] = [];
    const res = await performSafeCardUpdate(checkResult, stage => stages.push(stage));
    expect(res).toEqual({ ok: true, updatedVersion: '1.2.0' });
    expect(importRawCharacterMock).toHaveBeenCalledWith('红警系统·测试1', expect.any(Blob));
    expect(stages).toContain('finishing_worldbook');
    expect(getCharactersMock).toHaveBeenCalledTimes(1);
    expect(getOneCharacterMock).toHaveBeenCalledWith('红警系统·测试1.png');
    expect(saveWorldInfoMock).toHaveBeenCalledWith(
      '红警世界书',
      expect.objectContaining({ converted: true }),
      true,
    );
    expect(reloadWorldInfoEditorMock).toHaveBeenCalledWith('红警世界书');
    expect(reloadCurrentChatMock).toHaveBeenCalledTimes(1);
    expect(g.initializeGlobal).toHaveBeenCalledWith('RacCardUpdateState', expect.any(Object));
    expect(g.eventEmit).toHaveBeenCalledWith('rac:card_update_status', expect.any(Object));

    // 验证 autoUpdateSilent: true 遇到 breaking_save: true 时强制拦截，绝不调用 importRawCharacter
    importRawCharacterMock.mockClear();
    setCardUpdatePreferences({
      checkOnStartup: true,
      autoUpdateSilent: true,
      manifestUrl: 'https://testingcf.jsdelivr.net/gh/author/repo@main/manifest.json',
      ignoredVersion: '',
    });
    expect(localStorage.getItem(CARD_UPDATE_PREFS_STORAGE_KEY)).toBeTruthy();
    expect(getCardUpdatePreferences().autoUpdateSilent).toBe(true);

    const breakingManifest: CardUpdateManifest = {
      card_name: '红警系统·测试',
      latest_version: '1.3.0',
      save_schema: 3,
      card_url: 'https://testingcf.jsdelivr.net/gh/author/repo@v{version}/card.png',
      releases: [
        {
          version: '1.3.0',
          breaking_save: true,
          save_schema: 3,
          save_warning: '第 3 代存档结构调整，必须先备份当前战局',
          notes: ['新增指挥官天赋树结构'],
        },
      ],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(breakingManifest), { status: 200 })),
    );

    const checkRes = await checkCardUpdate({ localVersion: '1.2.0', localSaveSchema: 2 });
    expect(checkRes).not.toBeNull();
    expect(checkRes?.hasUpdate).toBe(true);
    expect(checkRes?.hasBreakingSaveChange).toBe(true);
    expect(cardUpdateState.shouldPromptModal).toBe(true);
    expect(importRawCharacterMock).toHaveBeenCalledTimes(0);

    // 验证 dismissCardUpdatePrompt(true) 可关闭弹窗并记录 ignoredVersion
    dismissCardUpdatePrompt(true);
    expect(cardUpdateState.shouldPromptModal).toBe(false);
    expect(getCardUpdatePreferences().ignoredVersion).toBe('1.3.0');
  });

  it('7. FD-48 默认只检不更铁律：DEFAULT_UPDATE_CONFIG.autoUpdateSilent 为 false，且 runStartupUpdateFlow 即使在 autoUpdateSilent=true 下也只返回 notify-normal-update、绝不调用写卡', async () => {
    expect(DEFAULT_UPDATE_CONFIG.autoUpdateSilent).toBe(false);
    expect(DEFAULT_UPDATE_CONFIG.localServerUrl).toBe('http://127.0.0.1:5500');

    // 未配置 manifestUrl 且本地服务未启动时，checkCardUpdate 静默返回 null
    saveUpdateConfig({ manifestUrl: '' });
    const emptyRes = await checkCardUpdate();
    expect(emptyRes).toBeNull();
    expect(cardUpdateState.lastError).toBeNull();

    const importRawCharacterMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    g.importRawCharacter = importRawCharacterMock;

    saveUpdateConfig({
      checkOnStartup: true,
      autoUpdateSilent: true,
      manifestUrl: 'https://testingcf.jsdelivr.net/gh/author/repo@main/manifest.json',
      ignoredVersion: '',
    });
    expect(loadUpdateConfig().autoUpdateSilent).toBe(true);

    const normalManifest: CardUpdateManifest = {
      card_name: '红警系统·测试',
      latest_version: '1.2.1',
      save_schema: 2,
      card_url: 'https://testingcf.jsdelivr.net/gh/author/repo@v{version}/card.png',
      releases: [
        {
          version: '1.2.1',
          breaking_save: false,
          notes: ['修复细节问题'],
        },
      ],
    };

    const fetchMock = vi.fn(async () => new Response(JSON.stringify(normalManifest), { status: 200 }));

    // 启动期流程：即使 autoUpdateSilent=true，也只检不更，返回 notify-normal-update 且绝不写卡
    const flowRes = await runStartupUpdateFlow({
      manifestUrl: 'https://testingcf.jsdelivr.net/gh/author/repo@main/manifest.json',
      localVersion: '1.2.0',
      localSaveSchema: 2,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(flowRes.action).toBe('notify-normal-update');
    expect(flowRes.checkResult?.hasUpdate).toBe(true);
    expect(flowRes.checkResult?.hasBreakingSaveChange).toBe(false);
    expect(importRawCharacterMock).toHaveBeenCalledTimes(0);

    // 破坏性更新启动检测：返回 prompt-breaking-backup
    const breakingManifest: CardUpdateManifest = {
      card_name: '红警系统·测试',
      latest_version: '1.3.0',
      save_schema: 3,
      card_url: 'https://testingcf.jsdelivr.net/gh/author/repo@v{version}/card.png',
      releases: [
        {
          version: '1.3.0',
          breaking_save: true,
          save_schema: 3,
          save_warning: '存档结构第 3 代升级',
          notes: ['重整基地结构'],
        },
      ],
    };
    const breakingFlowRes = await runStartupUpdateFlow({
      manifestUrl: 'https://testingcf.jsdelivr.net/gh/author/repo@main/manifest.json',
      localVersion: '1.2.0',
      localSaveSchema: 2,
      fetchImpl: vi.fn(
        async () => new Response(JSON.stringify(breakingManifest), { status: 200 }),
      ) as unknown as typeof fetch,
    });
    expect(breakingFlowRes.action).toBe('prompt-breaking-backup');
    expect(cardUpdateState.shouldPromptModal).toBe(true);
    expect(importRawCharacterMock).toHaveBeenCalledTimes(0);
  });

  it('8. FD-48 本地服务 (:5500) 探测与 checkCardUpdateViaLocalOrRemote：覆盖在线有更新、在线未配置远端、离线回退远端 manifest 三大路径', async () => {
    const mockLocalStatusPayload: LocalServerVersionStatus = {
      ok: true,
      mode: 'pc-local-server',
      autoUpdateEnabled: false,
      local: {
        version: '2.4.0',
        saveSchema: 2,
        distReady: true,
        gitBranch: 'main',
        gitCommitShort: 'a1b2c3d',
      },
      check: {
        status: 'update-available',
        checkedAt: '2026-10-28T16:00:00.000Z',
        localVersion: '2.4.0',
        latestVersion: '2.5.0',
        localSaveSchema: 2,
        remoteSaveSchema: 3,
        hasUpdate: true,
        hasBreakingSaveChange: false,
        missedReleases: [
          {
            version: '2.5.0',
            date: '2026-10-28',
            breaking_save: false,
            save_schema: 3,
            notes: ['新增战区联合指挥中心'],
          },
        ],
        breakingWarnings: [],
      },
    };

    // 模拟当前聊天存档格式代数为 2，而远端 save_schema 为 3 -> 二次校验自动升级为 breaking-update-available
    g.getVariables = vi.fn(() => ({ $save_schema: 2 }));
    expect(getCurrentChatSaveSchema()).toBe(2);

    const onlineFetchMock = vi.fn(
      async () => new Response(JSON.stringify(mockLocalStatusPayload), { status: 200 }),
    );
    const probed = await probeLocalServerVersionStatus({
      localServerUrl: 'http://127.0.0.1:5500',
      fetchImpl: onlineFetchMock as unknown as typeof fetch,
    });
    expect(probed?.mode).toBe('pc-local-server');
    expect(probed?.local.version).toBe('2.4.0');

    const checkOnline = await checkCardUpdateViaLocalOrRemote({
      localServerUrl: 'http://127.0.0.1:5500',
      fetchImpl: onlineFetchMock as unknown as typeof fetch,
    });
    expect(checkOnline.localServerOnline).toBe(true);
    expect(checkOnline.localDistReady).toBe(true);
    expect(checkOnline.localGitBranch).toBe('main');
    expect(checkOnline.localGitCommitShort).toBe('a1b2c3d');
    expect(checkOnline.hasUpdate).toBe(true);
    expect(checkOnline.hasBreakingSaveChange).toBe(true);
    expect(checkOnline.status).toBe('breaking-update-available');
    expect(checkOnline.breakingWarnings[0]).toContain('第 2 代 ▸ 第 3 代');

    // 路径 B：本地服务在线但 status === 'unconfigured' 且未传 manifestUrl -> 返回 up-to-date + localServerOnline: true
    const unconfiguredPayload: LocalServerVersionStatus = {
      ...mockLocalStatusPayload,
      check: {
        status: 'unconfigured',
        checkedAt: '2026-10-28T16:00:00.000Z',
        localVersion: '2.4.0',
        latestVersion: '2.4.0',
        hasUpdate: false,
        hasBreakingSaveChange: false,
        missedReleases: [],
        breakingWarnings: [],
      },
    };
    saveUpdateConfig({ manifestUrl: '' });
    const checkUnconfigured = await checkCardUpdateViaLocalOrRemote({
      fetchImpl: vi.fn(
        async () => new Response(JSON.stringify(unconfiguredPayload), { status: 200 }),
      ) as unknown as typeof fetch,
    });
    expect(checkUnconfigured.localServerOnline).toBe(true);
    expect(checkUnconfigured.localDistReady).toBe(true);
    expect(checkUnconfigured.status).toBe('up-to-date');
    expect(checkUnconfigured.hasUpdate).toBe(false);
    expect(checkUnconfigured.localVersion).toBe('2.4.0');

    // 路径 C：本地服务离线（抛网错）但传入了 manifestUrl -> 回退拉取远端 manifest 并标记 localServerOnline: false
    const remoteManifest: CardUpdateManifest = {
      card_name: '红警系统·测试',
      latest_version: '2.6.0',
      save_schema: 2,
      card_url: 'https://testingcf.jsdelivr.net/gh/author/repo@v{version}/card.png',
      releases: [
        {
          version: '2.6.0',
          breaking_save: false,
          notes: ['远端更新测试'],
        },
      ],
    };
    const fallbackFetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('127.0.0.1:5500')) {
        throw new Error('ECONNREFUSED');
      }
      return new Response(JSON.stringify(remoteManifest), { status: 200 });
    });
    vi.stubGlobal('fetch', fallbackFetchMock);

    const checkOfflineFallback = await checkCardUpdateViaLocalOrRemote({
      manifestUrl: 'https://testingcf.jsdelivr.net/gh/author/repo@main/manifest.json',
      localVersion: '2.4.0',
      localSaveSchema: 2,
      fetchImpl: fallbackFetchMock as unknown as typeof fetch,
    });
    expect(checkOfflineFallback.localServerOnline).toBe(false);
    expect(checkOfflineFallback.hasUpdate).toBe(true);
    expect(checkOfflineFallback.latestVersion).toBe('2.6.0');
  });

  it('9. FD-48 triggerLocalServerUpdate：支持成功更新、脏工作区拦截与本地服务离线降级提示，以及 PNG 兼容辅助函数校验', async () => {
    // 1. 成功受控更新
    const okUpdateRes = await triggerLocalServerUpdate({
      confirmBackupCompleted: true,
      fetchImpl: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              status: 'updated',
              message: '已完成代码拉取与前端重编译',
              previousVersion: '2.4.0',
              currentVersion: '2.5.0',
              distReady: true,
              steps: [
                { step: 'git-pull', ok: true, detail: 'Fast-forward' },
                { step: 'vite-build', ok: true, detail: 'dist/ 构建完成' },
              ],
            }),
            { status: 200 },
          ),
      ) as unknown as typeof fetch,
    });
    expect(okUpdateRes.ok).toBe(true);
    expect(okUpdateRes.status).toBe('updated');
    expect(okUpdateRes.currentVersion).toBe('2.5.0');
    expect(okUpdateRes.steps).toHaveLength(2);

    // 2. 脏工作区安全拦截
    const dirtyRes = await triggerLocalServerUpdate({
      confirmBackupCompleted: true,
      fetchImpl: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: false,
              status: 'dirty-worktree',
              message: '检测到本地仓库存在未提交的自定义修改，已中止自动拉取',
              previousVersion: '2.4.0',
              currentVersion: '2.4.0',
            }),
            { status: 409 },
          ),
      ) as unknown as typeof fetch,
    });
    expect(dirtyRes.ok).toBe(false);
    expect(dirtyRes.status).toBe('dirty-worktree');
    expect(dirtyRes.message).toContain('未提交');

    // 3. 本地服务离线降级友好指引
    const offlineRes = await triggerLocalServerUpdate({
      fetchImpl: vi.fn(async () => {
        throw new Error('Failed to fetch');
      }) as unknown as typeof fetch,
    });
    expect(offlineRes.ok).toBe(false);
    expect(offlineRes.status).toBe('error');
    expect(offlineRes.message).toContain('一键更新.bat');

    // 4. 兼容辅助函数 extractCardDataFromPngBuffer & verifyDownloadedCardPngVersion
    const samplePng = buildTestPngBytes([
      { keyword: 'ccv3', jsonObj: { data: { character_version: '2.5.0' } } },
    ]);
    expect(extractCardDataFromPngBuffer(samplePng).version).toBe('2.5.0');
    const verifyOk = await verifyDownloadedCardPngVersion(samplePng, '2.5.0');
    expect(verifyOk.ok).toBe(true);
    const verifyMismatch = await verifyDownloadedCardPngVersion(samplePng, '2.6.0');
    expect(verifyMismatch.ok).toBe(false);
  });
});
