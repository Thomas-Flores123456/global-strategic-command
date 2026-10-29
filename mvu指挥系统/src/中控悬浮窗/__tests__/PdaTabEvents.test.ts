/**
 * PdaTabEvents.test.ts —— 战术 PDA 动态事件真实绑定与空状态/过滤清理专项单测（FIX-P1-05 · 09 [P1-2]）
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSSRApp, defineComponent, h, type Component } from 'vue';
import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import '../../红警指挥系统/composables/useFloatingStore';
import {
  buildNotificationQueue,
  derivePdaEventsFromSnapshot,
  pruneNotificationsAboveFloor,
} from '../pda/notificationQueue';
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
    compiledPath: join(PDA_DIR, 'PdaTabEvents.__fix_p1_05_evt__.mts'),
    id: 'pda-tab-events-fix-p1-05',
  },
  chains: {
    sfcPath: join(PDA_DIR, 'PdaTabChains.vue'),
    compiledPath: join(PDA_DIR, 'PdaTabChains.__fix_p1_05_evt__.mts'),
    id: 'pda-tab-chains-fix-p1-05',
  },
  intel: {
    sfcPath: join(PDA_DIR, 'PdaTabIntel.vue'),
    compiledPath: join(PDA_DIR, 'PdaTabIntel.__fix_p1_05_evt__.mts'),
    id: 'pda-tab-intel-fix-p1-05',
  },
  frame: {
    sfcPath: join(PDA_DIR, 'PdaWindowFrame.vue'),
    compiledPath: join(PDA_DIR, 'PdaWindowFrame.__fix_p1_05_evt__.mts'),
    id: 'pda-window-frame-fix-p1-05',
  },
};

let PdaTabEventsComp: Component;
let PdaWindowFrameComp: Component;

async function compileSfc(entry: CompiledEntry, rewriteMap: Record<string, string> = {}): Promise<Component> {
  const src = readFileSync(entry.sfcPath, 'utf8');
  const { descriptor } = parse(src, { filename: entry.sfcPath });
  const compiled = compileScript(descriptor, {
    id: entry.id,
    inlineTemplate: true,
  });
  let js = compiled.content
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
    writeFileSync(entry.compiledPath, `${js}\n${tpl.code}\nexport { render };\n`, 'utf8');
  } else {
    writeFileSync(entry.compiledPath, js, 'utf8');
  }
  const mod = (await import(pathToFileURL(entry.compiledPath).href)) as { default: Component };
  return mod.default;
}

function makeTestShell(activeTab: 'events' | 'chains' | 'intel' = 'events') {
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
  PdaTabEventsComp = await compileSfc(COMPILED_ENTRIES.events);
  await compileSfc(COMPILED_ENTRIES.chains);
  await compileSfc(COMPILED_ENTRIES.intel);
  PdaWindowFrameComp = await compileSfc(COMPILED_ENTRIES.frame, {
    "'./PdaTabEvents.vue'": "'./PdaTabEvents.__fix_p1_05_evt__.mts'",
    "'./PdaTabChains.vue'": "'./PdaTabChains.__fix_p1_05_evt__.mts'",
    "'./PdaTabIntel.vue'": "'./PdaTabIntel.__fix_p1_05_evt__.mts'",
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

describe('FIX-P1-05 · PdaTabEvents 与 PdaWindowFrame 真实动态事件绑定', () => {
  it('当传入空数组 [] 或空快照且非 demoMode 时，渲染「当前战区暂无突发动态事件」，不回退硬编码 evt-supply-shock', async () => {
    const shell = makeTestShell('events');
    const app = createSSRApp({
      render: () => h(PdaTabEventsComp, { shell, events: [] }),
    });
    const html = await renderToString(app);
    expect(html).toContain('data-testid="pda-events-empty"');
    expect(html).toContain('当前战区暂无突发动态事件');
    expect(html).not.toContain('evt-supply-shock');
    expect(html).not.toContain('北坡精炼厂遭磁暴波及');
  });

  it('挂载 PdaWindowFrame.vue 时，事件 Tab 反映传入的真实 stat_data 资金链异动与新势力接触，而非硬编码 evt-supply-shock', async () => {
    const shell = makeTestShell('events');

    const liveStatData = {
      economy: {
        credits: 2400,
        credits_daily: 320,
        wallet: {},
        chains: [
          {
            id: 'chain-iron-convoy',
            name: '极北铁矿陆运专线',
            flow: '进项',
            rate_daily: 350,
            eff: 0.4,
            status: 'distressed',
            reason: '暴风雪阻断公铁联运咽喉',
            updated_at_day: 9,
          },
        ],
      },
      pending_lore: [
        {
          id: 'lore_凛冬守望团',
          kind: '势力',
          name: '凛冬守望团',
          summary: '盘踞冻港的自治武装船队',
          source_floor: 9,
        },
        // 混入未入档机娘，不应出现在战地事件流中
        {
          name: '苏离',
          model: 'F-47首台',
          keys: ['静默电行'],
          shell: '绣坊帮工',
        },
      ],
    };

    const app = createSSRApp({
      render: () => h(PdaWindowFrameComp, { shell, snapshot: liveStatData }),
    });
    const html = await renderToString(app);

    expect(html).toContain('极北铁矿陆运专线');
    expect(html).toContain('暴风雪阻断公铁联运咽喉');
    expect(html).toContain('新探明势力：凛冬守望团');
    expect(html).not.toContain('evt-supply-shock');
    expect(html).not.toContain('苏离');
  });

  it('当过滤条件变化导致当前选中的 selectedDirectiveId 不在可见列表中时，自动清理过期选择', async () => {
    const shell = makeTestShell('events');
    const Comp = PdaTabEventsComp as Component & {
      setup?: (props: Record<string, unknown>, ctx: { expose: (exp: unknown) => void; emit: () => void }) => unknown;
    };
    let exposed: {
      selectedDirectiveId: { value: string | null };
      setFilter: (f: 'all' | 'critical' | 'warn' | 'info') => void;
      onSelectEvent: (item: { id: string; targetTab: 'chains' }) => void;
    } | null = null;

    const events = [
      {
        id: 'evt-warn-1',
        level: 'warn' as const,
        verb: '资金链变动',
        title: '矿车护航线受阻',
        summary: '护航效率下降',
        targetTab: 'chains' as const,
      },
      {
        id: 'evt-crit-1',
        level: 'critical' as const,
        verb: '工况异常',
        title: '主反应堆停摆',
        summary: '全基地断电',
        targetTab: 'chains' as const,
      },
    ];

    Comp.setup?.(
      {
        shell,
        events,
        filter: 'all',
        selectedDirectiveId: 'evt-warn-1',
      },
      {
        expose: exp => {
          exposed = exp as typeof exposed;
        },
        emit: () => {},
      },
    );

    expect(exposed).not.toBeNull();
    expect(exposed!.selectedDirectiveId.value).toBe('evt-warn-1');

    // 切到 critical 过滤，evt-warn-1 不在可见列表中，selectedDirectiveId 自动清空
    exposed!.setFilter('critical');
    expect(exposed!.selectedDirectiveId.value).toBeNull();
  });

  it('G04-04：已读商路建立通知后链条变为受挫/断裂重新作为未读入队，同状态重解析幂等不重复未读', () => {
    const establishedSnap = {
      economy: {
        credits: 1000,
        credits_daily: 600,
        wallet: {},
        chains: [
          {
            id: 'chain_smuggle',
            name: '灵石走私走廊',
            flow: '收入' as const,
            rate_daily: 600,
            eff: 1,
            status: 'active' as const,
            reason: '新开辟资金链',
            updated_at_day: 1,
          },
        ],
      },
    };
    const establishedEvents = derivePdaEventsFromSnapshot(establishedSnap);
    expect(establishedEvents).toHaveLength(1);
    const readIds = new Set<string>([establishedEvents[0].id]);

    // 同状态同原因重解析：ID 保持幂等，通知队列仍为已读（0 未读）
    const reparsedEvents = derivePdaEventsFromSnapshot(establishedSnap);
    expect(reparsedEvents[0].id).toBe(establishedEvents[0].id);
    expect(buildNotificationQueue(reparsedEvents, readIds).totalUnread).toBe(0);

    // 同日链条变为受挫/断裂：生成新的确定性事件身份，重新作为未读进入通知队列
    for (const next of [
      { status: 'distressed' as const, eff: 0.5, reason: '商路遭遇伏击降效', updated_at_day: 1 },
      { status: 'broken' as const, eff: 0, reason: '分拣厂被毁停摆', updated_at_day: 2 },
    ]) {
      const shiftedEvents = derivePdaEventsFromSnapshot({
        economy: {
          ...establishedSnap.economy,
          chains: [{ ...establishedSnap.economy.chains[0], ...next }],
        },
      });
      expect(shiftedEvents[0].id).not.toBe(establishedEvents[0].id);
      const queue = buildNotificationQueue(shiftedEvents, readIds);
      expect(queue.totalUnread).toBe(1);
      expect(queue.visible[0].id).toBe(shiftedEvents[0].id);
    }
  });

  it('G04-04：情报列表前置插入新项后，原已读情报保持已读不串读', () => {
    const initialIntel = [
      { src: '无线电监听', content: '敌军三日后换防', date: '03-14', cred: '高' as const, read: false },
    ];
    const initialEvents = derivePdaEventsFromSnapshot({ intel: initialIntel });
    expect(initialEvents).toHaveLength(1);
    const readIds = new Set<string>([initialEvents[0].id]);
    expect(buildNotificationQueue(initialEvents, readIds).totalUnread).toBe(0);

    // 前置插入一条同来源新情报，原情报下移到下标 1：原情报仍应保持已读，新情报为未读
    const prependedEvents = derivePdaEventsFromSnapshot({
      intel: [
        { src: '无线电监听', content: '北坡发现装甲集结', date: '03-15', cred: '中' as const, read: false },
        ...initialIntel,
      ],
    });
    const queue = buildNotificationQueue(prependedEvents, readIds);
    expect(queue.totalUnread).toBe(1);
    expect(queue.visible).toHaveLength(1);
    expect(queue.visible[0].summary).toBe('北坡发现装甲集结');
  });

  it('G04-05：资金链 updated_at_day 作为游戏日不伪装为通知 floor 楼层号，且不误导楼层裁剪与展示', async () => {
    const snap = {
      economy: {
        credits: 1200,
        credits_daily: 0,
        wallet: {},
        chains: [
          {
            id: 'chain_north_ore',
            name: '北坡精炼外销线',
            flow: '收入' as const,
            rate_daily: 500,
            eff: 0,
            status: 'broken' as const,
            reason: '遭遇炮火袭扰断裂',
            updated_at_day: 8,
          },
        ],
      },
      pending_lore: [
        {
          id: 'lore_灰烬商团',
          kind: '势力',
          name: '灰烬商团',
          summary: '活跃于废墟带的走私武装',
          source_floor: 3,
        },
      ],
    };

    const events = derivePdaEventsFromSnapshot(snap);
    expect(events).toHaveLength(2);
    expect(events[0].floor).toBeUndefined();
    expect(events[0].time).toBe('第8天');
    expect(events[1].floor).toBe(3);

    // 当前聊天在 #3 楼但游戏日已到第 8 天时，pruneNotificationsAboveFloor(3) 不应误删该资金链事件
    expect(pruneNotificationsAboveFloor(events, 3)).toHaveLength(2);

    const shell = makeTestShell('events');
    const html = await renderToString(
      createSSRApp({
        render: () => h(PdaTabEventsComp, { shell, snapshot: snap }),
      }),
    );
    expect(html).not.toContain('#8 ·');
    expect(html).toContain('#-- · 第8天');
    expect(html).toContain('#3 · --:--');
  });

  it('G04-06：快照中带 read: true 的情报/事件在顶栏角标与事件列表中一致计为已读，点击未读事件后通过 readEventIds 变为已读', async () => {
    const shell = makeTestShell('events');
    const snap = {
      intel: [
        { src: '无线电监听', content: '已核销历史情报', date: '03-14', cred: '高' as const, read: true },
        { src: '前线侦察', content: '待处理紧急敌情', date: '03-15', cred: '高' as const, read: false },
      ],
    };

    const html1 = await renderToString(
      createSSRApp({
        render: () => h(PdaWindowFrameComp, { shell, snapshot: snap }),
      }),
    );
    // 1 条 read: true + 1 条 read: false → 顶栏 events 页签角标与列表未读徽标均应为 1（而非顶栏虚报 2）
    expect(html1).toMatch(/data-testid="pda-tab-btn-events"[\s\S]*?>\s*1\s*<\/span>\s*<\/button>/);
    expect(html1).toContain('未读 1');

    // 将唯一未读情报经 readEventIds 标为已读后，顶栏 events 页签角标消失且列表未读归零
    const unreadEvent = derivePdaEventsFromSnapshot(snap).find(e => !e.read)!;
    shell.markEventRead(unreadEvent.id);

    const html2 = await renderToString(
      createSSRApp({
        render: () => h(PdaWindowFrameComp, { shell, snapshot: snap }),
      }),
    );
    expect(html2).toMatch(/data-testid="pda-tab-btn-events"><span>[^<]*<\/span><!--v-if--><\/button>/);
    expect(html2).not.toContain('data-testid="pda-events-unread-badge"');
  });
});
