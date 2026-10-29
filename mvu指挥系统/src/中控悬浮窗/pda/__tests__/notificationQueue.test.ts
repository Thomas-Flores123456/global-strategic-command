/**
 * notificationQueue.test.ts —— PDA-CAPSULE-01 严重度通知队列、28px 挂起胶囊、风琴抽屉与会话分桶隔离单测
 *
 * 覆盖：
 * 1. MAX_FLOOR_NOTIFICATIONS = 5 与 buildNotificationQueue 过滤未读、critical > warning > info 稳定排序与溢出截断；
 * 2. getScopedPdaStorageKey 与 setPdaSessionScope 会话分桶隔离（修复 09 [P3-1]）；
 * 3. PdaFanoutStack.vue 风琴层叠卡片、+N 条更多战情溢出提示、[ 全部已读 ] 与单条点击直达页签；
 * 4. PdaNotificationPill.vue 28px 胶囊渲染与 TacticalPdaHost.vue 联动。
 */

/* eslint-disable import-x/no-nodejs-modules -- 测试即时编译 SFC 临时产物 */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import type { PdaEventItem } from '../PdaTabEvents.vue';
import {
  buildNotificationQueue,
  MAX_FLOOR_NOTIFICATIONS,
  normalizeNotificationSeverity,
} from '../notificationQueue';
import {
  createPdaShell,
  getScopedPdaStorageKey,
  PDA_STORAGE_KEY,
  setPdaSessionScope,
  type StorageLike,
  type Viewport,
} from '../pdaState';

const VIEWPORT_DESKTOP: Viewport = { width: 1440, height: 900 };

const DIR = fileURLToPath(new URL('..', import.meta.url));
const FANOUT_SFC_PATH = join(DIR, 'PdaFanoutStack.vue');
const FANOUT_COMPILED_PATH = join(DIR, 'PdaFanoutStack.__ssr__.mts');
const PILL_SFC_PATH = join(DIR, 'PdaNotificationPill.vue');
const PILL_COMPILED_PATH = join(DIR, 'PdaNotificationPill.__capsule_ssr__.mts');

function compileSfc(sfcPath: string, compiledPath: string, id: string): Promise<Component> {
  return (async () => {
    const source = readFileSync(sfcPath, 'utf8');
    const { descriptor, errors } = parse(source, { filename: sfcPath });
    if (errors.length > 0) throw new Error(`${sfcPath} 解析失败：${errors.map(String).join('; ')}`);
    const compiled = compileScript(descriptor, {
      id,
      inlineTemplate: true,
      templateOptions: { id, scoped: descriptor.styles.some(s => s.scoped) },
    });
    const js = compiled.content
      .replace(/^import\s+type\s[^;]*;?[\t ]*$/gm, '')
      .replace(/,\s*type\s+[A-Za-z0-9_$]+/g, '');
    writeFileSync(compiledPath, js, 'utf8');
    const mod = (await import(pathToFileURL(compiledPath).href)) as { default: Component };
    return mod.default;
  })();
}

let fanoutPromise: Promise<Component> | undefined;
const loadFanoutStack = () =>
  (fanoutPromise ??= compileSfc(FANOUT_SFC_PATH, FANOUT_COMPILED_PATH, 'pdafanoutstackssr'));

let pillPromise: Promise<Component> | undefined;
const loadPill = () => (pillPromise ??= compileSfc(PILL_SFC_PATH, PILL_COMPILED_PATH, 'pdapillcapsulessr'));

afterAll(() => {
  try {
    unlinkSync(FANOUT_COMPILED_PATH);
  } catch {
    // ignore
  }
  try {
    unlinkSync(PILL_COMPILED_PATH);
  } catch {
    // ignore
  }
});

function createFakeStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  const storage: StorageLike = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
  return { storage, map };
}

describe('PDA-CAPSULE-01: notificationQueue 严重度排序与溢出截断 (UX-06)', () => {
  it('MAX_FLOOR_NOTIFICATIONS 常量为 5，normalizeNotificationSeverity 正确归一化', () => {
    expect(MAX_FLOOR_NOTIFICATIONS).toBe(5);
    expect(normalizeNotificationSeverity('critical')).toBe('critical');
    expect(normalizeNotificationSeverity('alert')).toBe('critical');
    expect(normalizeNotificationSeverity('warning')).toBe('warning');
    expect(normalizeNotificationSeverity('warn')).toBe('warning');
    expect(normalizeNotificationSeverity('info')).toBe('info');
    expect(normalizeNotificationSeverity(undefined)).toBe('info');
  });

  it('过滤已读事件并按 critical > warning > info 稳定排序，截断前 5 条并计算 overflowCount', () => {
    const events: PdaEventItem[] = [
      { id: 'e-info-1', level: 'info', title: '常规巡逻简报 1', targetTab: 'events' },
      { id: 'e-warn-1', level: 'warn', title: '荒原商路效率下降', targetTab: 'chains' },
      { id: 'e-crit-1', level: 'critical', title: '主反应堆过载停机', targetTab: 'chains' },
      { id: 'e-read-crit', level: 'critical', title: '已读警报不应出现', targetTab: 'events' },
      { id: 'e-info-2', level: 'info', title: '新势力信号接触', targetTab: 'intel' },
      { id: 'e-crit-2', severity: 'alert', title: '防空阵地遭袭', targetTab: 'events' },
      { id: 'e-warn-2', severity: 'warning', title: '弹药储备偏低', targetTab: 'quests' },
      { id: 'e-info-3', level: 'info', title: '后勤补给抵达', targetTab: 'events' },
    ];

    const readIds = new Set<string>(['e-read-crit']);
    const queue = buildNotificationQueue(events, readIds);

    expect(queue.totalUnread).toBe(7);
    expect(queue.visible).toHaveLength(5);
    expect(queue.overflowCount).toBe(2);
    expect(queue.highestSeverity).toBe('critical');

    // 验证排序：2 条 critical -> 2 条 warning -> 第 1 条 info
    expect(queue.visible.map(e => e.id)).toEqual([
      'e-crit-1',
      'e-crit-2',
      'e-warn-1',
      'e-warn-2',
      'e-info-1',
    ]);
  });

  it('全部已读或空事件列表时返回空队列且 highestSeverity 为 null', () => {
    const events: PdaEventItem[] = [{ id: 'e-1', level: 'warn', title: '单条预警' }];
    const queue = buildNotificationQueue(events, new Set(['e-1']));
    expect(queue.visible).toEqual([]);
    expect(queue.overflowCount).toBe(0);
    expect(queue.totalUnread).toBe(0);
    expect(queue.highestSeverity).toBeNull();
  });
});

describe('PDA-CAPSULE-01: pdaState 会话分桶隔离 (修复 09 [P3-1])', () => {
  it('getScopedPdaStorageKey 对非空 scopeId 生成分桶键名，空值兜底默认键名', () => {
    expect(getScopedPdaStorageKey('cardA_chat01')).toBe('tavernweave.pda.state.cardA_chat01');
    expect(getScopedPdaStorageKey('  session-42  ')).toBe('tavernweave.pda.state.session-42');
    expect(getScopedPdaStorageKey('')).toBe(PDA_STORAGE_KEY);
    expect(getScopedPdaStorageKey('   ')).toBe(PDA_STORAGE_KEY);
    expect(getScopedPdaStorageKey(null)).toBe(PDA_STORAGE_KEY);
    expect(getScopedPdaStorageKey(undefined)).toBe(PDA_STORAGE_KEY);
  });

  it('setPdaSessionScope 切换不同会话分桶并独立隔离 readEventIds', () => {
    const { storage, map } = createFakeStorage();
    const shell = createPdaShell({
      storage,
      viewport: () => VIEWPORT_DESKTOP,
      scopeId: 'session-alpha',
    });

    shell.markEventRead('evt-alpha-1');
    expect(shell.state.readEventIds).toEqual(['evt-alpha-1']);
    expect(map.has('tavernweave.pda.state.session-alpha')).toBe(true);

    // 切换到全新会话分桶 session-beta，已读集合应清空隔离
    setPdaSessionScope('session-beta', shell);
    expect(shell.getSessionScope()).toBe('session-beta');
    expect(shell.state.readEventIds).toEqual([]);

    shell.markEventRead('evt-beta-9');
    expect(shell.state.readEventIds).toEqual(['evt-beta-9']);
    expect(map.has('tavernweave.pda.state.session-beta')).toBe(true);

    // 切回 session-alpha，自动恢复 alpha 桶的已读记录
    shell.setPdaSessionScope('session-alpha');
    expect(shell.state.readEventIds).toEqual(['evt-alpha-1']);

    setPdaSessionScope(null);
    shell.destroy();
  });
});

describe('PDA-CAPSULE-01: PdaFanoutStack.vue 与 PdaNotificationPill.vue 渲染与交互', () => {
  const SAMPLE_QUEUE_ITEMS: PdaEventItem[] = [
    { id: 'evt-c1', level: 'critical', verb: '工况异常', title: '核反应堆冷却失效', targetTab: 'chains' },
    { id: 'evt-w1', level: 'warn', verb: '资金链变动', title: '北方矿车遭袭减产', targetTab: 'chains' },
    { id: 'evt-i1', level: 'info', verb: '作战任务', title: '侦察铁幕前哨站', targetTab: 'quests' },
  ];

  it('PdaNotificationPill 渲染 28px 挂起胶囊并展示溢出角标与风琴开关', async () => {
    const PillComp = await loadPill();
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(PillComp, {
            items: SAMPLE_QUEUE_ITEMS.map(item => ({
              id: item.id,
              level: item.level ?? 'info',
              title: item.title ?? item.id,
              targetTab: item.targetTab,
            })),
            overflowCount: 3,
            fanoutOpen: true,
          }),
      }),
    );

    expect(html).toContain('data-test="pda-notification-pill"');
    expect(html).toContain('min-h-[28px]');
    expect(html).toContain('核反应堆冷却失效');
    expect(html).toContain('1/3+3');
    expect(html).toContain('data-test="pda-pill-fanout-toggle"');
  });

  it('PdaFanoutStack 渲染风琴层叠卡片、+N 条更多战情提示与 [ 全部已读 ]，支持单条直达与批量已读', async () => {
    const FanoutComp = await loadFanoutStack();
    const shell = createPdaShell({
      storage: null,
      viewport: () => VIEWPORT_DESKTOP,
    });

    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(FanoutComp, {
            visible: SAMPLE_QUEUE_ITEMS,
            overflowCount: 4,
            shell,
          }),
      }),
    );

    expect(html).toContain('data-test="pda-fanout-stack"');
    expect(html).toContain('[ 全部已读 ]');
    expect(html).toContain('+4 条更多战情');
    expect(html).toContain('核反应堆冷却失效');
    expect(html).toContain('北方矿车遭袭减产');
    expect(html).toContain('侦察铁幕前哨站');
    expect(html.match(/data-test="pda-fanout-item"/g)?.length).toBe(3);

    // 验证 setup 暴露的 select(event) 与 markAllRead() 动作
    const onSelect = vi.fn();
    const onMarkAllRead = vi.fn();
    const SetupComp = FanoutComp as Component & {
      setup?: (
        props: Record<string, unknown>,
        ctx: { expose: (exp: unknown) => void; emit: (e: string, ...args: unknown[]) => void },
      ) => unknown;
    };
    let exposed: {
      select: (ev: PdaEventItem) => void;
      markAllRead: () => void;
    } | null = null;

    SetupComp.setup?.(
      {
        visible: SAMPLE_QUEUE_ITEMS,
        overflowCount: 4,
        shell,
      },
      {
        expose: exp => {
          exposed = exp as typeof exposed;
        },
        emit: (evName, payload) => {
          if (evName === 'select') onSelect(payload);
          if (evName === 'mark-all-read') onMarkAllRead();
        },
      },
    );

    expect(exposed).not.toBeNull();

    // 点击第 3 条（targetTab: 'quests'）直达展开 PDA 对应页签并标为已读
    exposed!.select(SAMPLE_QUEUE_ITEMS[2]);
    expect(onSelect).toHaveBeenCalledWith(SAMPLE_QUEUE_ITEMS[2]);
    expect(shell.state.collapsed).toBe(false);
    expect(shell.state.activeTab).toBe('quests');
    expect(shell.state.highlightEventId).toBe('evt-i1');
    expect(shell.state.readEventIds).toContain('evt-i1');

    // 点击 [ 全部已读 ] 批量标记所有可见项为已读
    exposed!.markAllRead();
    expect(onMarkAllRead).toHaveBeenCalledTimes(1);
    expect(shell.state.readEventIds).toEqual(expect.arrayContaining(['evt-c1', 'evt-w1', 'evt-i1']));

    shell.destroy();
  });
});
