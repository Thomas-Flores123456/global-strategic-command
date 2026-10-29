/**
 * PdaTabIntel.test.ts —— 战术 PDA 战区情报暂存门 @adopt-lore / @save-memo 接线 + FD-35 明牌 <情报> 职责分离单测
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h, type Component } from 'vue';
import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import * as floorVarWriteMod from '../host/floorVarWrite';
import * as pendingLoreGateMod from '../../红警指挥系统/worldbook/pendingLoreGate';
import { createPdaShell, type PdaStorageLike } from '../pda/pdaState';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PDA_DIR = join(TEST_DIR, '../pda');

interface CompiledEntry {
  sfcPath: string;
  compiledPath: string;
  id: string;
}

const COMPILED_ENTRIES: Record<'events' | 'chains' | 'intel' | 'frame', CompiledEntry> = {
  events: {
    sfcPath: join(PDA_DIR, 'PdaTabEvents.vue'),
    compiledPath: join(PDA_DIR, 'PdaTabEvents.__fix_p1_05_intel__.mts'),
    id: 'pda-tab-events-fix-p1-05-intel',
  },
  chains: {
    sfcPath: join(PDA_DIR, 'PdaTabChains.vue'),
    compiledPath: join(PDA_DIR, 'PdaTabChains.__fix_p1_05_intel__.mts'),
    id: 'pda-tab-chains-fix-p1-05-intel',
  },
  intel: {
    sfcPath: join(PDA_DIR, 'PdaTabIntel.vue'),
    compiledPath: join(PDA_DIR, 'PdaTabIntel.__fix_p1_05_intel__.mts'),
    id: 'pda-tab-intel-fix-p1-05-intel',
  },
  frame: {
    sfcPath: join(PDA_DIR, 'PdaWindowFrame.vue'),
    compiledPath: join(PDA_DIR, 'PdaWindowFrame.__fix_p1_05_intel__.mts'),
    id: 'pda-window-frame-fix-p1-05-intel',
  },
};

let PdaTabIntelComp: Component;
let PdaWindowFrameComp: Component;

async function compileSfc(entry: CompiledEntry, rewriteMap: Record<string, string> = {}): Promise<Component> {
  const src = readFileSync(entry.sfcPath, 'utf8');
  const { descriptor } = parse(src, { filename: entry.sfcPath });
  const compiled = compileScript(descriptor, {
    id: entry.id,
    inlineTemplate: true,
  });
  let js = compiled.content
    .replace(/^import\s+type\s[\s\S]*?from\s+['"][^'"]+['"];?[\t ]*$/gm, '')
    .replace(/^import\s+type\s[^;]*;?[\t ]*$/gm, '')
    .replace(/,\s*type\s+[A-Za-z0-9_$]+/g, '');
  for (const [from, to] of Object.entries(rewriteMap)) {
    js = js.split(from).join(to);
  }
  if (!descriptor.scriptSetup && descriptor.template) {
    const tpl = compileTemplate({
      source: descriptor.template.content,
      filename: entry.sfcPath,
      id: entry.id,
    });
    writeFileSync(entry.compiledPath, `// @ts-nocheck\n${js}\n${tpl.code}\nexport { render };\n`, 'utf8');
  } else {
    writeFileSync(entry.compiledPath, `// @ts-nocheck\n${js}`, 'utf8');
  }
  const mod = (await import(pathToFileURL(entry.compiledPath).href)) as { default: Component };
  return mod.default;
}

function makeTestShell(activeTab: 'events' | 'chains' | 'intel' = 'intel') {
  const map = new Map<string, string>();
  const storage: PdaStorageLike = {
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
  const shell = createPdaShell({
    storage,
    viewport: () => ({ width: 1280, height: 720 }),
  });
  shell.setCollapsed(false);
  shell.setActiveTab(activeTab);
  return shell;
}

beforeAll(async () => {
  await compileSfc(COMPILED_ENTRIES.events);
  await compileSfc(COMPILED_ENTRIES.chains);
  PdaTabIntelComp = await compileSfc(COMPILED_ENTRIES.intel);
  PdaWindowFrameComp = await compileSfc(COMPILED_ENTRIES.frame, {
    "'./PdaTabEvents.vue'": "'./PdaTabEvents.__fix_p1_05_intel__.mts'",
    "'./PdaTabChains.vue'": "'./PdaTabChains.__fix_p1_05_intel__.mts'",
    "'./PdaTabIntel.vue'": "'./PdaTabIntel.__fix_p1_05_intel__.mts'",
  });
});

afterAll(() => {
  for (const entry of Object.values(COMPILED_ENTRIES)) {
    if (existsSync(entry.compiledPath)) {
      try {
        unlinkSync(entry.compiledPath);
      } catch {
        // ignore cleanup race
      }
    }
  }
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('FIX-P1-05 · PdaTabIntel 与 PdaWindowFrame 暂存门接线 (@adopt-lore / @save-memo)', () => {
  it('PdaTabIntel 自动过滤混在 pending_lore 中的未入档机娘（isGirlDossierEntry），仅展示新势力/实体暂存项', async () => {
    const pendingLore = [
      {
        id: 'lore_铁幕重工残部',
        kind: '势力',
        name: '铁幕重工残部',
        summary: '掌控旧工业区重型车间的军工残部',
      },
      {
        name: '苏离',
        model: 'F-47首台',
        keys: ['静默电行'],
        shell: '绣坊帮工',
      },
    ];

    const app = createSSRApp({
      render: () => h(PdaTabIntelComp, { pendingLore }),
    });
    const html = await renderToString(app);
    expect(html).toContain('铁幕重工残部');
    expect(html).not.toContain('苏离');
  });

  it('在 PdaWindowFrame 情报 Tab 触发采纳（@adopt-lore）与保存速记（@save-memo）时，调用 confirmAndCommitPendingLore 与 updateFloorVars 并保留未入档机娘', async () => {
    const shell = makeTestShell('intel');

    const unfiledGirl = {
      name: '苏离',
      model: 'F-47首台',
      keys: ['静默电行'],
      shell: '绣坊帮工',
    };
    const factionLore = {
      id: 'lore_铁幕重工残部',
      kind: '势力',
      name: '铁幕重工残部',
      summary: '掌控旧工业区重型车间的军工残部',
      source_floor: 6,
      source_swipe: 0,
      created_day: 12,
    };

    let floorVars: Record<string, unknown> = {
      stat_data: {
        factions: [{ name: '北坡自治会', attitude: '友好', intel: '本地盟友', risk: '低' }],
        pending_lore: [unfiledGirl, factionLore],
      },
    };

    const confirmSpy = vi.spyOn(pendingLoreGateMod, 'confirmAndCommitPendingLore');
    const updateVarsSpy = vi
      .spyOn(floorVarWriteMod, 'updateFloorVars')
      .mockImplementation(async (_floorId, updater) => {
        floorVars = updater(floorVars);
      });

    let frameExposed: {
      onAdoptLore: (item: { id: string; kind: string; name: string; summary: string }) => Promise<void>;
      onSaveMemo: (text: string) => Promise<void>;
    } | null = null;

    const FrameComp = PdaWindowFrameComp as Component & {
      setup?: (props: Record<string, unknown>, ctx: { expose: (exp: unknown) => void; emit: () => void }) => unknown;
    };

    FrameComp.setup?.(
      {
        shell,
        floorId: 6,
        snapshot: floorVars.stat_data as Record<string, unknown>,
      },
      {
        expose: exp => {
          frameExposed = exp as typeof frameExposed;
        },
        emit: () => {},
      },
    );

    expect(frameExposed).not.toBeNull();

    // 1. 触发 @adopt-lore
    await frameExposed!.onAdoptLore({
      id: 'lore_铁幕重工残部',
      kind: '势力',
      name: '铁幕重工残部',
      summary: '掌控旧工业区重型车间的军工残部',
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(updateVarsSpy).toHaveBeenCalledTimes(1);

    const updatedSd = floorVars.stat_data as {
      factions: Array<{ name: string; intel: string }>;
      pending_lore: unknown[];
      memo?: string;
    };
    expect(updatedSd.factions.map(f => f.name)).toEqual(['北坡自治会', '铁幕重工残部']);
    // 未入档机娘完好保留，已采纳的新势力从 pending_lore 移除
    expect(updatedSd.pending_lore).toEqual([unfiledGirl]);

    // 2. 触发 @save-memo
    await frameExposed!.onSaveMemo('重点布防北境矿道，提防铁幕重工突袭。');
    expect(updateVarsSpy).toHaveBeenCalledTimes(2);
    expect((floorVars.stat_data as { memo?: string }).memo).toBe('重点布防北境矿道，提防铁幕重工突袭。');
  });
});

describe('FD-35 PKG-C · PdaTabIntel 明牌 <情报> 职责分离与幕后 <世界演变> 静默脱敏', () => {
  const MIXED_INTEL_FEED = [
    {
      id: 'intel_radar_01',
      title: '北坡东翼发现热源集结',
      src: '雷达侦察',
      src_kind: '雷达侦察',
      content: '在第三矿区东北方向 12 公里处侦测到装甲集群低频引擎震动。',
      date: 'D12 18:30',
      cred: '高',
      status: '已证实',
      evolves_from: '东翼不明履带痕迹传闻',
      scope: 'tactical',
      pinned: false,
    },
    {
      id: 'intel_radio_02',
      title: '荒坂远东分部秘密押运车队异动',
      src: '电讯截获',
      src_kind: '电讯截获',
      content: '截获新西伯利亚南线加密电讯，证实48小时内经三号隧道押运超导核心。',
      date: 'D12 19:15',
      cred: '中',
      status: '待核实',
      scope: 'tactical',
      pinned: true,
    },
    {
      id: 'evo_world_01',
      title: '极北冻土裂隙高能潮汐',
      src: '宏观广播',
      content: '西伯利亚边缘空间裂隙辐射读数连续三日攀升，多国科考队紧急撤离。',
      date: 'D12 20:00',
      cred: '中',
      scope: 'world',
      evo_domain: '位面异象',
      stage: '发酵',
      ttl_floors: 4,
      hook: '若派遣特种勘探分队前往采集裂隙样本，或可加速超时空/相位科技突破。',
      pinned: false,
    },
    {
      id: 'evo_world_02',
      title: '欧陆黑市钨芯穿甲弹紧缺',
      src: '暗网流言',
      content: '自由商团上调重型弹药基准报价 20%。',
      scope: 'world',
      evo_domain: '社会黑市',
      stage: '高潮',
      ttl_floors: 2,
      pinned: true,
    },
  ];

  it('1. 仅渲染我方已截获的六源明牌 <情报> 卡片，移除 pda-intel-pulse-section 且绝不剧透 <世界演变> 具体卡片内容，仅展示 pda-world-evo-stealth-hint 加密统计角标', async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(PdaTabIntelComp, {
            snapshot: {
              intel: MIXED_INTEL_FEED,
              codex: [],
              factions: [],
              pending_lore: [],
            },
          }),
      }),
    );

    // 1) 已移除 pda-intel-pulse-section，聚焦 pda-tactical-intel-section
    expect(html).not.toContain('data-testid="pda-intel-pulse-section"');
    expect(html).toContain('data-testid="pda-tactical-intel-section"');
    expect(html).toContain('TACTICAL INTEL // 战区明牌情报');

    // 2) 标题栏右侧仅显示不剧透标题的加密状态角标 pda-world-evo-stealth-hint
    expect(html).toContain('data-testid="pda-world-evo-stealth-hint"');
    expect(html).toContain('🌐 幕后暗流×2（详见设置·世界演变）');

    // 3) 仅渲染 2 张明牌 <情报> 卡片（含六大来源渠道徽章、可信度条、核实状态、演进自与「▶ 派遣侦察/介入」按钮）
    expect(html.match(/data-testid="pda-intel-feed-card"/g)?.length).toBe(2);
    expect(html).toContain('📡 雷达侦察');
    expect(html).toContain('📻 电讯截获');
    expect(html).toContain('北坡东翼发现热源集结');
    expect(html).toContain('荒坂远东分部秘密押运车队异动');
    expect(html).toContain('高 · 已证实');
    expect(html).toContain('中 · 待核实');
    expect(html).toContain('data-testid="pda-intel-cred-bar"');
    expect(html).toContain('🔗 演进自: 东翼不明履带痕迹传闻');
    expect(html).toContain('▶ 派遣侦察/介入');

    // 4) 严禁在 PDA 中剧透任何 <世界演变> 的具体卡片内容
    expect(html).not.toContain('极北冻土裂隙高能潮汐');
    expect(html).not.toContain('欧陆黑市钨芯穿甲弹紧缺');
    expect(html).not.toContain('西伯利亚边缘空间裂隙辐射读数连续三日攀升');
    expect(html).not.toContain('[🌍 世界演变]');
    expect(html).not.toContain('data-testid="pda-evo-domain"');
    expect(html).not.toContain('data-testid="pda-evo-stage"');
    expect(html).not.toContain('data-testid="pda-evo-ttl"');
    expect(html).not.toContain('data-testid="pda-evo-hook"');
  });

  it('2. 验证明牌 <情报> 过滤切换（全部/战区情报/已置顶）、「▶ 派遣侦察/介入」点击填入 #send_textarea、置顶锁定与沉淀入书交互', async () => {
    const dispatchedEvents: string[] = [];
    const fakeTextarea = {
      value: '',
      dispatchEvent: vi.fn((ev: Event) => {
        dispatchedEvents.push(ev.type);
        return true;
      }),
      focus: vi.fn(),
    };
    const prevWindow = (globalThis as Record<string, unknown>).window;
    const prevDocument = (globalThis as Record<string, unknown>).document;
    const fakeDoc = {
      querySelector: vi.fn((sel: string) => (sel === '#send_textarea' ? fakeTextarea : null)),
    };
    (globalThis as Record<string, unknown>).document = fakeDoc;
    (globalThis as Record<string, unknown>).window = {
      parent: { document: fakeDoc },
      document: fakeDoc,
    };

    try {
      const onActEmit = vi.fn();
      const onPinEmit = vi.fn();
      const onArchiveEmit = vi.fn();

      const SetupComp = PdaTabIntelComp as Component & {
        setup?: (
          props: Record<string, unknown>,
          ctx: { expose: (exp: unknown) => void; emit: (event: string, ...args: unknown[]) => void },
        ) => unknown;
      };
      let exposed: {
        intelFilter: { value: 'all' | 'tactical' | 'pinned' };
        intelList: { value: typeof MIXED_INTEL_FEED };
        filteredIntelList: { value: typeof MIXED_INTEL_FEED };
        activeWorldEvoCount: { value: number };
        visiblePendingLore: { value: Array<{ id: string; name: string }> };
        archivedIntelKeys: { value: Set<string> };
        isIntelPinned: (item: (typeof MIXED_INTEL_FEED)[number]) => boolean;
        onActIntel: (item: (typeof MIXED_INTEL_FEED)[number]) => string;
        onTogglePinIntel: (item: (typeof MIXED_INTEL_FEED)[number]) => boolean;
        onArchiveIntelToWorldbook: (item: (typeof MIXED_INTEL_FEED)[number]) => { id: string; name: string };
      } | null = null;

      const snapshotData = {
        intel: structuredClone(MIXED_INTEL_FEED),
        codex: [],
        factions: [],
        pending_lore: [],
      };

      SetupComp.setup?.(
        {
          snapshot: snapshotData,
        },
        {
          expose: exp => {
            exposed = exp as typeof exposed;
          },
          emit: (event, ...args) => {
            if (event === 'act-intel') onActEmit(args[0], args[1]);
            if (event === 'toggle-pin-intel') onPinEmit(args[0], args[1]);
            if (event === 'archive-intel-lore') onArchiveEmit(args[0], args[1]);
          },
        },
      );

      expect(exposed).not.toBeNull();
      expect(exposed!.activeWorldEvoCount.value).toBe(2);
      expect(exposed!.intelList.value.map(i => i.id)).toEqual(['intel_radar_01', 'intel_radio_02']);

      // 1) 子过滤切换验证（仅含明牌战区情报）
      exposed!.intelFilter.value = 'all';
      expect(exposed!.filteredIntelList.value.map(i => i.id)).toEqual(['intel_radar_01', 'intel_radio_02']);

      exposed!.intelFilter.value = 'pinned';
      expect(exposed!.filteredIntelList.value.map(i => i.id)).toEqual(['intel_radio_02']);

      // 2) 点击战区情报「▶ 派遣侦察/介入」填入 #send_textarea
      const tacticalCmd = exposed!.onActIntel(snapshotData.intel[0]);
      expect(tacticalCmd).toBe(
        '调遣侦察与情报部门核查【雷达侦察】线报：「北坡东翼发现热源集结」，查明真伪与具体坐标。',
      );
      expect(fakeTextarea.value).toBe(tacticalCmd);
      expect(dispatchedEvents).toContain('input');
      expect(onActEmit).toHaveBeenCalledWith(snapshotData.intel[0], tacticalCmd);

      // 3) 点击「📌 置顶锁定」切换 pinned 状态
      expect(exposed!.isIntelPinned(snapshotData.intel[0])).toBe(false);
      const nextPinned = exposed!.onTogglePinIntel(snapshotData.intel[0]);
      expect(nextPinned).toBe(true);
      expect(exposed!.isIntelPinned(snapshotData.intel[0])).toBe(true);
      expect(onPinEmit).toHaveBeenCalledWith(snapshotData.intel[0], true);
      expect(exposed!.filteredIntelList.value.map(i => i.id)).toEqual(['intel_radar_01', 'intel_radio_02']);

      // 4) 点击「📥 沉淀入书」将明牌情报转入 pending_lore 暂存门
      expect(exposed!.visiblePendingLore.value.length).toBe(0);
      const staged = exposed!.onArchiveIntelToWorldbook(snapshotData.intel[0]);
      expect(staged.name).toBe('北坡东翼发现热源集结');
      expect(exposed!.visiblePendingLore.value.some(e => e.name === '北坡东翼发现热源集结')).toBe(true);
      expect(exposed!.archivedIntelKeys.value.has('intel_radar_01')).toBe(true);
      expect(onArchiveEmit).toHaveBeenCalledTimes(1);
    } finally {
      (globalThis as Record<string, unknown>).window = prevWindow;
      (globalThis as Record<string, unknown>).document = prevDocument;
    }
  });
});
