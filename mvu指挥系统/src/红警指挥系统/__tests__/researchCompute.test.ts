import { describe, expect, it } from 'vitest';
import {
  aggregateCompute,
  computeOverview,
  computeUsage,
  type ComputeBaseLike,
  type ComputeCatalogBuilding,
  type ComputeCatalogResearch,
} from '../engines/researchCompute';

/* ── 构造夹具 ─────────────────────────────── */

const mkBase = (over: Partial<ComputeBaseLike> = {}): ComputeBaseLike => ({
  id: 'beipo',
  name: '北坡主基地',
  status: '隐蔽中',
  buildings: [],
  ...over,
});

const mkCatalogBuildings = (): ComputeCatalogBuilding[] => [
  { id: '超算中心', outputs: { virtual: { compute: { tflops: 50, tops: 30 } } } },
  { id: '量子超算中心', outputs: { virtual: { compute: { tflops: 120, tops: 60 } } } },
  { id: '战斗实验室', outputs: { virtual: { compute: { tflops: 50, tops: 30 } } } },
  { id: '发电厂' }, // 无 compute 声明
];

const mkResearches = (): ComputeCatalogResearch[] => [
  { name: '超时空位移工学', workload: { tflops: 40, tops: 10 } },
  { name: '动态研究X' }, // 无 workload
];

describe('researchCompute 算力聚合（静态口径）', () => {
  it('态一·无算力建筑：sources 空、总额 0、undeclared 不误报', () => {
    const overview = computeOverview(
      [mkBase({ buildings: [{ name: '发电厂', state: '运转' }] })],
      [],
      mkCatalogBuildings(),
      mkResearches(),
    );
    expect(overview.sources).toHaveLength(0);
    expect(overview.tflops).toBe(0);
    expect(overview.tops).toBe(0);
    expect(overview.deficit).toBe(false);
  });

  it('态二·充足：超算中心 50/30 明细成行，含所属基地，富余为正', () => {
    const overview = computeOverview(
      [mkBase({ buildings: [{ name: '超算中心', state: '运转' }] })],
      [{ type: '研究', item: '超时空位移工学' }],
      mkCatalogBuildings(),
      mkResearches(),
    );
    expect(overview.sources).toEqual([
      { baseId: 'beipo', baseName: '北坡主基地', building: '超算中心', tflops: 50, tops: 30 },
    ]);
    expect(overview.tflops).toBe(50);
    expect(overview.usedTflops).toBe(40);
    expect(overview.freeTflops).toBe(10);
    expect(overview.deficit).toBe(false);
    expect(overview.usage[0]).toMatchObject({ item: '超时空位移工学', tflops: 40, tops: 10, declared: true });
  });

  it('态三·缺口：占用超供给时 deficit 翻真、富余为负', () => {
    const overview = computeOverview(
      [mkBase({ buildings: [{ name: '战斗实验室', state: '运转' }] })],
      [{ type: '研究', item: '超时空位移工学' }],
      // 仅战斗实验室 50 tflops，人为把需求顶到 60
      mkCatalogBuildings(),
      [{ name: '超时空位移工学', workload: { tflops: 60, tops: 40 } }],
    );
    expect(overview.tflops).toBe(50);
    expect(overview.freeTflops).toBe(-10);
    expect(overview.freeTops).toBe(-10);
    expect(overview.deficit).toBe(true);
  });

  it('在场口径：建造中/受损/停机建筑不计入；废弃或失守基地整座剔除（FIX-P0-04）', () => {
    const sources = aggregateCompute(
      [
        mkBase({
          buildings: [
            { name: '超算中心', state: '建造中' },
            { name: '超算中心', state: '受损' },
            { name: '量子超算中心', state: '停机' },
          ],
        }),
        mkBase({ id: 'old', name: '旧基地', status: '废弃', buildings: [{ name: '量子超算中心', state: '运转' }] }),
        mkBase({ id: 'fallen', name: '陷落基地', status: '失守', buildings: [{ name: '超算中心', state: '运转' }] }),
      ],
      mkCatalogBuildings(),
    );
    expect(sources).toHaveLength(0);
  });

  it('消耗口径：queued 不算在研；无 workload 的动态研究计 undeclared 且不动总额', () => {
    const usage = computeUsage(
      [
        { type: '研究', item: '超时空位移工学', status: 'queued' },
        { type: '研究', item: '动态研究X' },
        { type: '建造', item: '发电厂' },
      ],
      mkResearches(),
    );
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ item: '动态研究X', tflops: 0, tops: 0, declared: false });
  });

  it('名匹配：歧义 includes 不误中（「超算中心」撞上「量子超算中心」时精确优先）', () => {
    const [ambiguous] = aggregateCompute(
      [mkBase({ buildings: [{ name: '超算中心', state: '运转' }] })],
      mkCatalogBuildings(),
    );
    expect(ambiguous.building).toBe('超算中心');
    expect(ambiguous.tflops).toBe(50);
  });
});
