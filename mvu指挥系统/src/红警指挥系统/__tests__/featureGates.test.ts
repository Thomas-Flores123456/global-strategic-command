/**
 * D6 · 未完工玩法统一开关（featureGates）回归：
 * 关闭（生产构建）时 settleFloor 跳过工程/航天结算、亮提示、存档数据不变；打开（开发环境）时照常结算。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseWorldbookEntries } from '../../中控悬浮窗/models/worldbookCatalogParser';
import { worldbookProjectToDef } from '../core/catalogEffective';
import { isFeatureEnabled } from '../core/featureGates';
import { Schema } from '../core/schema';
import { startProjectV2 } from '../engines/projectEngine';
import { settleFloor } from '../engines/settleFloor';

const ONE_DAY = '<timePast>1 D 0 H 0 M</timePast>';

function mkSpaceStat() {
  return Schema.parse({
    meta: { world_id: 'cyber2042', date: '2042-03-14', day_count: 1, location: '锈蚀低壑' },
    space: {
      contracts: [{ id: 'sc-1', title: '测试合同', status: 'in_progress', duration_days: 10, elapsed_days: 0 }],
    },
  });
}

const [miniDef] = parseWorldbookEntries(
  [
    {
      name: '测试工程',
      content:
        '<数据>{"type":"project","schema_version":2,"id":"测试工程","modules":[{"id":"m1","workload":{"days":2,"min_days":1}}]}</数据>\n',
    },
  ],
  { silent: true },
).projects.map(worldbookProjectToDef);

function mkEngStat(queueStatus: 'active' | 'done') {
  const base = Schema.parse({
    meta: { world_id: 'cyber2042', date: '2042-03-14', day_count: 1, location: '锈蚀低壑' },
    economy: { credits: 1000000 },
    bases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '航天发射中心', state: '运转' }] }],
  });
  const started = startProjectV2(base, miniDef, { base: 'beipo' });
  if (!started.ok) throw new Error(started.message);
  const next = started.next as typeof base;
  if (queueStatus === 'active') return next;
  return {
    ...next,
    queues: next.queues.map(q => ({ ...q, status: 'done' as const, progress: 100, spent_minutes: q.total_minutes, qty_done: 1 })),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('D6 featureGates · 生产/开发环境开关', () => {
  it('开发环境开启、生产环境关闭', () => {
    expect(isFeatureEnabled('engineering')).toBe(true);
    expect(isFeatureEnabled('space')).toBe(true);
    vi.stubEnv('DEV', false);
    expect(isFeatureEnabled('engineering')).toBe(false);
    expect(isFeatureEnabled('space')).toBe(false);
  });

  it('航天：关闭时跳过合同计时并提示，存档不变；打开时照常推进', () => {
    const on = settleFloor(mkSpaceStat(), mkSpaceStat(), ONE_DAY);
    expect(on.data.space.contracts[0].elapsed_days).toBe(1);

    vi.stubEnv('DEV', false);
    const off = settleFloor(mkSpaceStat(), mkSpaceStat(), ONE_DAY);
    expect(off.data.space).toEqual(mkSpaceStat().space);
    expect(off.events.some(e => e.message.includes('[航天] 玩法开发中'))).toBe(true);
  });

  it('工程：关闭时跳过里程碑回写并提示，projects 不变；打开时照常回写', () => {
    const prev = mkEngStat('active');
    const state = mkEngStat('done');
    const on = settleFloor(prev, mkEngStat('done'), '');
    expect(on.data.projects?.[0]?.status).toBe('完工');
    expect(on.events.some(e => e.message.includes('[工程] 玩法开发中'))).toBe(false);

    vi.stubEnv('DEV', false);
    const off = settleFloor(prev, mkEngStat('done'), '');
    expect(off.data.projects).toEqual(state.projects);
    expect(off.events.some(e => e.message.includes('[工程] 玩法开发中'))).toBe(true);
  });
});
