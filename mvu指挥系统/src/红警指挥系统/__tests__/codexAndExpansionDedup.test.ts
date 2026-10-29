import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setCachedDynamicCatalog } from '../composables/useCatalog';
import type { RetrofitDef } from '../core/catalog';
import {
  buildEntityCredibilityIndex,
  type EntityCredibilityIndex,
} from '../core/entityCredibility';
import { Schema } from '../core/schema';
import { applyEngOrders } from '../engines/engOrderBridge';
import { parseMessageText, type AlignIndex, type AuthorityInput } from '../parse/parsePipeline';
import { precheckManifest, type DlcManifest } from '../worldbook/dlcManifestHelpers';
import {
  filterSystemCatalogExpansions,
  isDuplicateOfSystemCatalog,
} from '../worldbook/expansionFiler';
import type { ParsedWorldbookCatalog } from '../../中控悬浮窗/models/worldbookCatalogParser';

function createMockWorldbookCatalog(): ParsedWorldbookCatalog {
  return {
    researches: [
      {
        id: 'tech_stealth',
        name: '低可观测技术工学',
        line: '特种隐身线',
        tier: 2,
        cost_credits: 1500,
        duration_days: 3,
        prerequisites: [],
        unlocks: ['幻影坦克'],
        description: '利用吸波材料与外形折角降低雷达反射截面积。',
      },
      {
        id: 'tech_smr',
        name: '小型模块化核能工学',
        line: '能源工业线',
        tier: 2,
        cost_credits: 1800,
        duration_days: 4,
        prerequisites: [],
        unlocks: ['小型核反应堆'],
        description: '紧凑型模块化核裂变供能工程。',
      },
    ],
    buildings: [
      {
        id: 'bld_prism_tower',
        name: '光棱塔',
        category: '防御',
        faction: '盟军',
        cost_credits: 1500,
        power_delta: -75,
        duration_days: 2,
        prerequisites: ['低可观测技术工学'],
        description: '盟军高能光谱折射防御塔。',
      },
    ],
    productions: [
      {
        id: 'unit_mirage',
        name: '幻影坦克',
        category: '装甲',
        faction: '盟军',
        cost_credits: 1000,
        duration_days: 1,
        lane: '战车工厂',
        prerequisites: ['低可观测技术工学'],
        description: '具备光学迷彩伪装能力的反装甲战车。',
      },
    ],
    retrofits: [
      {
        id: 'ret_prism_upgrade',
        name: '光棱塔升级',
        research: '低可观测技术工学',
        grade: '中改',
        cost: 800,
        desc: '升级光棱聚焦晶体阵列。',
        phases: [
          { name: '晶体换装', workload: { days: 2, min_days: 1 }, cost: 800 },
        ],
        scope: 'base',
      },
    ],
    projects: [],
    protocols: [],
    warnings: [],
    errors: [],
  } as unknown as ParsedWorldbookCatalog;
}

describe('FD-27 PKG-B · 动态入档防污染（Codex / Expansion）与工程/DLC 世界书对齐门禁', () => {
  beforeEach(() => {
    setCachedDynamicCatalog(createMockWorldbookCatalog());
  });

  afterEach(() => {
    setCachedDynamicCatalog(null);
  });

  it('① 世界书已有科技（精确名「低可观测技术工学」或变体「模块化小型核能技术」）通过 <图鉴> 输入时不污染 stat_data.codex，并清除历史同名残留', () => {
    const pollutedBaseline = Schema.parse({
      codex: [
        {
          name: '低可观测技术工学',
          kind: '科技',
          desc: '旧存档中误入的 EVA 增补克隆项',
          params: {},
        },
        {
          name: '小型模块化核能工学',
          kind: '科技',
          desc: '旧存档中残留的另一条系统科技污染项',
          params: {},
        },
      ],
    });

    const raw = [
      '<图鉴>',
      '- 名称: 低可观测技术工学',
      '  类别: 科技',
      '  简介: 世界书标准隐身科技。',
      '- 名称: 模块化小型核能技术',
      '  类别: 科技',
      '  简介: 语序与壳词改写的世界书核能科技。',
      '</图鉴>',
    ].join('\n');

    const res = parseMessageText(raw, pollutedBaseline, {
      authority: {
        names: ['低可观测技术工学', '小型模块化核能工学'],
        aliases: {},
      },
    });

    expect(res.applied).toBe(true);
    // 两条世界书自有科技均不得留在 codex 中，且历史污染被彻底清除
    expect(res.data.codex).toEqual([]);
    expect(
      res.events.some(
        e =>
          e.light === '🟢' &&
          e.path === 'codex.低可观测技术工学' &&
          e.message.includes('[图鉴] 「低可观测技术工学」属于世界书既有科技目录，跳过动态重复建档'),
      ),
    ).toBe(true);
    expect(
      res.events.some(
        e =>
          e.light === '🟢' &&
          e.message.includes('属于世界书既有科技目录，跳过动态重复建档'),
      ),
    ).toBe(true);
  });

  it('② 真正的自创科技（如「幽能裂隙折跃学」）通过 <图鉴> 输入时正常进入 stat_data.codex，与同批被拦截的世界书科技互不干扰', () => {
    const base = Schema.parse({});
    const raw = [
      '<图鉴>',
      '- 名称: 低可观测技术工学',
      '  类别: 科技',
      '  简介: 系统自有科技（应被拦截）。',
      '- 名称: 幽能裂隙折跃学',
      '  类别: 科技',
      '  简介: EVA 战地推演自创的高维空间折跃理论。',
      '  参数:',
      '    造价: 3200',
      '    工期: 5日',
      '</图鉴>',
    ].join('\n');

    const res = parseMessageText(raw, base, {
      authority: {
        names: ['低可观测技术工学', '小型模块化核能工学'],
        aliases: {},
      },
    });

    expect(res.applied).toBe(true);
    expect(res.data.codex).toHaveLength(1);
    expect(res.data.codex[0].name).toBe('幽能裂隙折跃学');
    expect(res.data.codex[0].kind).toBe('科技');
    expect(res.data.codex[0].params).toEqual({ 造价: '3200', 工期: '5日' });
  });

  it('③ <扩展档案> 申报世界书既有科技/建筑/单位时跳过重复入档，自创扩展词条正常入 pending_expansions', () => {
    const base = Schema.parse({});
    const raw = [
      '<扩展档案>',
      '- 名称: 低可观测技术工学',
      '  类别: 科技',
      '  简介: 世界书自有科技被重复申报扩展档案。',
      '  设定: 不应进入 pending_expansions。',
      '- 名称: 泰伯利亚晶化生物装甲学',
      '  类别: 科技',
      '  简介: 全新自创扩展科技。',
      '  设定: 利用晶化共生体强化的复合生物反应装甲。',
      '</扩展档案>',
    ].join('\n');

    const res = parseMessageText(raw, base, {});

    expect(res.applied).toBe(true);
    expect(res.data.pending_expansions).toHaveLength(1);
    expect(res.data.pending_expansions[0].name).toBe('泰伯利亚晶化生物装甲学');
    expect(
      res.events.some(
        e => e.light === '🟢' && e.path === '扩展档案.低可观测技术工学',
      ),
    ).toBe(true);

    // 校验 expansionFiler 导出的辅助过滤函数
    expect(
      isDuplicateOfSystemCatalog({ name: '低可观测技术工学', kind: '科技' }),
    ).toBe(true);
    expect(
      isDuplicateOfSystemCatalog({ name: '泰伯利亚晶化生物装甲学', kind: '科技' }),
    ).toBe(false);
    const filtered = filterSystemCatalogExpansions([
      { name: '低可观测技术工学', kind: '科技' as const },
      { name: '泰伯利亚晶化生物装甲学', kind: '科技' as const },
    ]);
    expect(filtered).toEqual([{ name: '泰伯利亚晶化生物装甲学', kind: '科技' }]);
  });

  it('④ engOrderBridge 对工程名称变体（如「光棱塔现代化改造」vs「光棱塔升级」）能高可信对齐并立项成功', () => {
    const retrofits: RetrofitDef[] = [
      {
        kind: 'retrofit',
        name: '光棱塔升级',
        research: '低可观测技术工学',
        grade: '中改',
        desc: '升级光棱聚焦晶体阵列',
        cost: 800,
        phases: [
          { name: '第一阶段：晶体校准', workload: { days: 2, min_days: 1 }, cost: 800 },
        ],
        scope: 'base',
      },
    ];

    const state = Schema.parse({
      economy: { credits: 4000 },
      tech: { done: ['低可观测技术工学'] },
      bases: [
        {
          id: 'base_alpha',
          name: '阿尔法基地',
          status: '警戒',
          buildings: [
            { name: '建造厂核心', state: '运转' },
            { name: '光棱塔', state: '运转' },
          ],
        },
      ],
      projects: [],
    });

    const bridgeRes = applyEngOrders(
      state,
      [{ verb: '立项', name: '光棱塔现代化改造', base: 'base_alpha' }],
      retrofits,
      [],
    );

    expect(bridgeRes.quarantine).toEqual([]);
    expect(bridgeRes.next.projects).toHaveLength(1);
    expect(bridgeRes.next.projects[0].ref).toBe('光棱塔升级');
    expect(
      bridgeRes.events.some(
        ev =>
          ev.light === '🟢' &&
          ev.layer === 'instruction' &&
          ev.path === 'projects' &&
          ev.message === '[工程] 名称对齐：「光棱塔现代化改造」→「光棱塔升级」',
      ),
    ).toBe(true);
  });

  it('⑤ dlcManifestHelpers 在静态 RESEARCHES 为空时基于世界书目录拦截覆盖系统基础科技（R12）', () => {
    const manifest: DlcManifest = {
      dlc: {
        id: 'test-dlc-conflict',
        name: '冲突测试包',
        kind: 'addon',
        version: '1.0',
      },
      data: {
        researches: [
          {
            name: '低可观测技术工学',
            cost: 1000,
            eta: '约2日',
            line: '测试线',
            tier: 1,
            unlocks: '——',
            prereq: '——',
            prereqs: [],
            desc: '试图覆盖世界书同名科技',
          },
        ],
      },
    };

    const issues = precheckManifest(manifest, []);
    expect(
      issues.some(i => i.rule === 'R12' && i.target === '低可观测技术工学'),
    ).toBe(true);
  });

  it('⑥ 当 ctx.align 直接注入 credibilityIndex 时 upsertCodex 同样精准识别世界书目录并去重', () => {
    setCachedDynamicCatalog(null);
    const credIndex: EntityCredibilityIndex = buildEntityCredibilityIndex({
      researches: [{ name: '低可观测技术工学' }, { name: '小型模块化核能工学' }],
    });
    const customAuthority: AuthorityInput & { credibilityIndex?: EntityCredibilityIndex } = {
      names: ['低可观测技术工学', '小型模块化核能工学'],
      aliases: {},
      credibilityIndex: credIndex,
    };

    const raw = [
      '<图鉴>',
      '- 名称: 模块化小型核能技术',
      '  类别: 科技',
      '  简介: 仅通过 credibilityIndex 注入时的变体拦截测试。',
      '</图鉴>',
    ].join('\n');

    const res = parseMessageText(raw, Schema.parse({}), {
      authority: customAuthority as AuthorityInput,
    });
    expect(res.data.codex).toEqual([]);
    expect(
      res.events.some(
        e => e.light === '🟢' && e.message.includes('属于世界书既有科技目录，跳过动态重复建档'),
      ),
    ).toBe(true);
  });
});
