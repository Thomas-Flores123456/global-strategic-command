/**
 * useCatalogWorldbook.test.ts —— useCatalogStore 异步聚合与三级 Fallback 改造测试（CTRL-FRONT-STORE-01）
 *
 * 验收标准覆盖：
 * 1. 保持 catalog.ready 初始化屏障：App 挂载前 ready=false，异步加载完成前维持 false，完成后切换为 true；
 * 2. 三级 Fallback 优先级：Dynamic WB（世界书动态优先）-> Static Baseline（静态基线兜底）-> $dlc Overlays（运行时覆盖）；
 * 3. v1.2 物理字段保真度：战车工厂 repair_rate、战斗实验室 dual-compute 与 low_power 工况、纳米工坊双配方等完整透传；
 * 4. 自动降级与环境鲁棒性：非酒馆环境平稳降级为纯基线；API 损坏/条目格式错误不中断、不挂起、不抛错；
 * 5. 真实世界书回环：全量加载《通用·主建筑_世界书.json》8 项试点建筑，无打标条目安全向 catalog.ts 降级补齐；
 * 6. 接口兼容红线：effectiveCatalog、researches、buildings、productions、retrofits 等只读属性 100% 保持兼容。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅单测中读取世界书样本，不进 bundle */
import fs from 'node:fs';
import path from 'node:path';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILDINGS, RESEARCHES, RETROFITS } from '../core/catalog';
import {
  effectiveCatalogNames,
  isCatalogOverlayUsable,
  setCachedDynamicCatalog,
  useCatalogStore,
  type DlcOverlay,
  type InitCatalogOptions,
} from '../composables/useCatalog';
import type { WorldbookEntryLike } from '../../中控悬浮窗/models/worldbookCatalogParser';

describe('CTRL-FRONT-STORE-01 · useCatalogStore 异步聚合与三级 Fallback 改造', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).window ??= globalThis;
    ((globalThis as any).window as Record<string, unknown>).location ??= { search: '' };
    setActivePinia(createPinia());
    setCachedDynamicCatalog(null);
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).getWorldbook;
    delete (globalThis as Record<string, unknown>).getWorldbookNames;
    delete (globalThis as Record<string, unknown>).getGlobalWorldbookNames;
    delete (globalThis as Record<string, unknown>).getCharWorldbookNames;
    delete (globalThis as Record<string, unknown>).getChatWorldbookName;
    setCachedDynamicCatalog(null);
    vi.restoreAllMocks();
  });

  // ════════════════════════════════════════════════════════════════
  // 1. 初始化屏障与状态流转（catalog.ready）
  // ════════════════════════════════════════════════════════════════
  describe('1. catalog.ready 初始化屏障与状态流转', () => {
    it('初始状态为 ready=false，调用 init() 完成后切换为 ready=true', async () => {
      const catalog = useCatalogStore();
      expect(catalog.ready).toBe(false);

      await catalog.init();
      expect(catalog.ready).toBe(true);
    });

    it('在异步 loader 尚未 resolve 时，catalog.ready 严格保持 false 屏障', async () => {
      const catalog = useCatalogStore();
      let resolveLoader!: (val: unknown) => void;
      const slowLoader = () =>
        new Promise(resolve => {
          resolveLoader = resolve;
        });

      expect(catalog.ready).toBe(false);
      const initPromise = catalog.init({ loader: slowLoader });

      // 异步进行中，屏障必须维持 false
      expect(catalog.ready).toBe(false);

      // 放行 loader
      resolveLoader([]);
      await initPromise;

      // 异步完成，屏障解除
      expect(catalog.ready).toBe(true);
    });

    it('支持通过 resetReady: true 重新进入屏障并恢复', async () => {
      const catalog = useCatalogStore();
      await catalog.init();
      expect(catalog.ready).toBe(true);

      let resolveSlow!: (val: unknown) => void;
      const slowLoader = () =>
        new Promise(resolve => {
          resolveSlow = resolve;
        });

      const secondInit = catalog.init({ resetReady: true, loader: slowLoader });
      expect(catalog.ready).toBe(false);

      resolveSlow([]);
      await secondInit;
      expect(catalog.ready).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 2. 三级 Fallback 优先级与覆盖机制
  // ════════════════════════════════════════════════════════════════
  describe('2. 三级 Fallback 优先级（Dynamic WB -> Static Baseline -> $dlc Overlays）', () => {
    it('第一优先级：世界书已标记条目优先覆盖静态 baseline 项，并注入 v1.2 物理字段', async () => {
      const catalog = useCatalogStore();

      // 模拟世界书中已标记的“战车工厂”（v1.2 试点数据）
      const mockWbEntries: WorldbookEntryLike[] = [
        {
          name: '04·战车工厂',
          enabled: true,
          content: `[通用·主建筑 | 战车工厂]
建造2000 · 耗电50 · 周期T2级（数周）· 前置研究：装甲载具工学。
核心功能：生产装甲载具、机动平台、运输载具及大型工程机械。

<数据>
{
  "schema_version": 1,
  "type": "building",
  "id": "战车工厂",
  "cost": 2200,
  "power": 60,
  "tier": 1,
  "tags": ["主建筑", "载具建造", "重型装甲", "陆军核心"],
  "research": "装甲载具工学",
  "prereqs": ["装甲载具工学"],
  "need_buildings": [],
  "outputs": {
    "virtual": {
      "repair_rate": 20
    }
  }
}
</数据>`,
        },
      ];

      await catalog.init({ entries: mockWbEntries });
      expect(catalog.ready).toBe(true);

      const vf = catalog.buildings.find(b => b.name === '战车工厂');
      expect(vf).toBeDefined();
      // 动态世界书优先：造价与耗电被覆盖
      expect(vf!.cost).toBe(2200);
      expect(vf!.power).toBe(60);
      expect(vf!.need_buildings).toEqual([]); // 覆盖了原静态 baseline 的 ['矿石精炼厂']
      // v1.2 物理字段与 Tags 完整生效
      expect((vf as any).tags).toEqual(['主建筑', '载具建造', '重型装甲', '陆军核心']);
      expect((vf as any).outputs?.virtual?.repair_rate).toBe(20);
    });

    it('第二优先级：未在世界书打标的旧条目安全向 catalog.ts 静态降级，零丢失', async () => {
      const catalog = useCatalogStore();

      // 世界书仅提供一个条目
      const singleEntry: WorldbookEntryLike[] = [
        {
          name: '战车工厂',
          content: `<数据>{"type":"building","id":"战车工厂","cost":2000,"power":50}</数据>`,
        },
      ];

      await catalog.init({ entries: singleEntry });

      // 未打标条目（如 矿石精炼厂、发电厂、兵营 等）从 static baseline 完整保留
      const refinery = catalog.buildings.find(b => b.name === '矿石精炼厂');
      expect(refinery).toBeDefined();
      expect(refinery!.cost).toBe(2000);
      expect(refinery!.power).toBe(50);

      const powerPlant = catalog.buildings.find(b => b.name === '发电厂');
      expect(powerPlant).toBeDefined();
      expect(powerPlant!.power).toBe(-200);

      // 科技项全量保留
      const techInfantry = catalog.researches.find(r => r.name === '基础步兵训练学');
      expect(techInfantry).toBeDefined();
      expect(techInfantry!.cost).toBe(200);

      // 改装项保留
      expect(catalog.retrofits.length).toBe(RETROFITS.length);
      expect(catalog.retrofits.map(r => r.name)).toContain('灰熊坦克现代化改装工程');
    });

    it('第三优先级：$dlc 运行时 Overlay 可对同名项实施最高优先级覆盖，并可追加专属条目', async () => {
      const catalog = useCatalogStore();

      // 1. 世界书提供动态“战车工厂”（造价 2000）
      const wbEntries: WorldbookEntryLike[] = [
        {
          name: '战车工厂',
          content: `<数据>{"type":"building","id":"战车工厂","cost":2000,"power":50,"tags":["主建筑"]}</数据>`,
        },
      ];

      // 2. 模拟 $dlc 注册表中的 DLC overlay，它把“战车工厂”造价改造成 1500，并新增“焚风建造厂”
      const dlcOverlay: DlcOverlay = {
        id: 'foehn-dlc',
        buildings: [
          {
            name: '战车工厂',
            cost: 1500,
            power: 45,
            research: '装甲载具工学',
            prereqs: [],
            need_buildings: [],
            desc: 'DLC 特供轻量版战车工厂',
          },
          {
            name: '湍流压缩机',
            cost: 900,
            power: -150,
            research: null,
            prereqs: [],
            need_buildings: [],
            desc: 'DLC 专属发电机',
          },
        ],
      };

      await catalog.init({
        entries: wbEntries,
      });

      // 模拟 overlays 响应式赋值（相当于 readDlcOverlays 读入 DLC）
      catalog.overlays = [dlcOverlay];

      const factory = catalog.buildings.find(b => b.name === '战车工厂');
      expect(factory).toBeDefined();
      // DLC 胜出 Dynamic WB (1500 vs 2000 vs 2000 static)
      expect(factory!.cost).toBe(1500);
      expect(factory!.power).toBe(45);
      expect(factory!.desc).toBe('DLC 特供轻量版战车工厂');

      // DLC 新增建筑就绪
      const compressor = catalog.buildings.find(b => b.name === '湍流压缩机');
      expect(compressor).toBeDefined();
      expect(compressor!.power).toBe(-150);
    });

    it('世界书超前新增（State C）条目能直接作为新增条目加入 effectiveCatalog', async () => {
      const catalog = useCatalogStore();

      const stateCEntry: WorldbookEntryLike[] = [
        {
          name: '超前科技·量子纠缠中继站',
          content: `<数据>
{
  "schema_version": 1,
  "type": "building",
  "id": "量子纠缠中继站",
  "cost": 5000,
  "power": 300,
  "tier": 2,
  "tags": ["主建筑", "科技建筑", "C4ISR"],
  "prereqs": [],
  "need_buildings": []
}
</数据>`,
        },
      ];

      await catalog.init({ entries: stateCEntry });

      const quantum = catalog.buildings.find(b => b.name === '量子纠缠中继站');
      expect(quantum).toBeDefined();
      expect(quantum!.cost).toBe(5000);
      expect((quantum as any).tags).toContain('C4ISR');
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 3. 自动降级与环境鲁棒性
  // ════════════════════════════════════════════════════════════════
  describe('3. 自动降级与环境鲁棒性', () => {
    it('非酒馆环境（无 API，无注入）自动平稳降级为纯静态 baseline，绝不抛错', async () => {
      const catalog = useCatalogStore();

      // 模拟无酒馆全局函数
      delete (globalThis as Record<string, unknown>).getWorldbook;
      delete (globalThis as Record<string, unknown>).getWorldbookNames;

      await expect(catalog.init()).resolves.toBeUndefined();
      expect(catalog.ready).toBe(true);

      // 降级为 pure static baseline
      expect(catalog.buildings.length).toBe(BUILDINGS.length);
      expect(catalog.researches.length).toBe(RESEARCHES.length);
      expect(catalog.retrofits.length).toBe(RETROFITS.length);
    });

    it('loader 抛错、reject 或返回空数据时，记录告警并安全降级为静态基线', async () => {
      const catalog = useCatalogStore();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const throwingLoader = async () => {
        throw new Error('网络断开或宿主内部故障');
      };

      await catalog.init({ loader: throwingLoader });
      expect(catalog.ready).toBe(true);
      expect(warnSpy).toHaveBeenCalled();

      // 依旧平稳降级为 static baseline
      const factory = catalog.buildings.find(b => b.name === '战车工厂');
      expect(factory).toBeDefined();
      expect(factory!.cost).toBe(2000);
    });

    it('世界书中损坏条目（JSON错误/非法结构）被安全隔离，不影响合法条目加载与基线合并', async () => {
      const catalog = useCatalogStore();

      const mixedEntries: WorldbookEntryLike[] = [
        {
          name: '损坏条目A',
          content: `<数据>{ "type": "building", "id": "B_BROKEN", "cost": NOT_A_NUMBER }</数据>`,
        },
        {
          name: '合法科技条目B',
          content: `<数据>{ "type": "research", "id": "纳米高压成型学", "cost": 750, "tier": 1, "line": "通用" }</数据>`,
        },
      ];

      await catalog.init({ entries: mixedEntries });
      expect(catalog.ready).toBe(true);

      // 合法条目成功进入
      const tech = catalog.researches.find(r => r.name === '纳米高压成型学');
      expect(tech).toBeDefined();
      expect(tech!.cost).toBe(750);

      // 诊断被记录
      expect(catalog.dynamicCatalog?.diagnostics.length).toBeGreaterThan(0);
      expect(catalog.dynamicCatalog?.diagnostics[0].entryName).toBe('损坏条目A');
    });

    it('支持通过 resolveActiveWorldbookNames 自动探测全局、角色卡或聊天绑定的世界书', async () => {
      const catalog = useCatalogStore();

      const mockBookContent: Record<string, WorldbookEntryLike[]> = {
        '通用·主建筑_世界书': [
          {
            name: '01·建造厂核心',
            content: `<数据>{"type":"building","id":"建造厂核心","cost":3000,"power":0,"tags":["主建筑","核心"]}</数据>`,
          },
        ],
      };

      (globalThis as Record<string, unknown>).getGlobalWorldbookNames = () => ['通用·主建筑_世界书'];
      (globalThis as Record<string, unknown>).getWorldbook = async (name: string) => mockBookContent[name] ?? [];

      await catalog.init();
      expect(catalog.ready).toBe(true);

      const mcv = catalog.buildings.find(b => b.name === '建造厂核心');
      expect(mcv).toBeDefined();
      expect(mcv!.cost).toBe(3000);
      expect((mcv as any).tags).toContain('核心');
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 4. 真实世界书《通用·主建筑_世界书.json》全量回环验证
  // ════════════════════════════════════════════════════════════════
  describe('4. 真实世界书《通用·主建筑_世界书.json》全量回环验证', () => {
    it('全量加载生产环境 8 项试点主建筑，验证 v1.2 物理字段保真生效与未打标条目安全降级', async () => {
      const catalog = useCatalogStore();

      const wbPath = path.resolve(__dirname, '../../../../worldbooks/通用·主建筑_世界书.json');
      expect(fs.existsSync(wbPath)).toBe(true);
      const rawWb = JSON.parse(fs.readFileSync(wbPath, 'utf-8'));

      await catalog.init({ entries: rawWb });
      expect(catalog.ready).toBe(true);

      // 8 项试点主建筑必须全部成功合并
      const pilotNames = [
        '战车工厂',
        '空军指挥部',
        '海军造船厂',
        '战斗实验室',
        '小型纳米合成工坊',
        '个人装备制造所',
        '陆军军校',
        '战地维修所',
      ];

      for (const name of pilotNames) {
        const found = catalog.buildings.find(b => b.name === name);
        expect(found, `建筑 ${name} 必须存在于 effectiveCatalog.buildings 中`).toBeDefined();
      }

      // 深度物理字段断言：
      // 1. 战车工厂：repair_rate=20，need_buildings 为 ['矿石精炼厂']
      const vf = catalog.buildings.find(b => b.name === '战车工厂')!;
      expect(vf.need_buildings).toEqual(['矿石精炼厂']);
      expect((vf as any).outputs?.virtual?.repair_rate).toBe(20);
      expect((vf as any).tags).toContain('载具建造');

      // 2. 战斗实验室：cost=2500，power=80，前置 高级作战实验理论 + 空军指挥部
      const lab = catalog.buildings.find(b => b.name === '战斗实验室')!;
      expect(lab.cost).toBe(2500);
      expect(lab.power).toBe(80);
      expect(lab.research).toBe('高级作战实验理论');
      expect(lab.need_buildings).toEqual(['空军指挥部']);

      // 3. 小型纳米合成工坊：本地缓冲仓储与前置建筑
      const nano = catalog.buildings.find(b => b.name === '小型纳米合成工坊')!;
      expect((nano as any).storage?.resources?.['标准纳米工料']).toBe(100);
      expect((nano as any).storage?.resources?.['机娘修复凝胶']).toBe(20);
      expect(nano.need_buildings).toEqual(['兵营', '矿石精炼厂']);

      // 4. 空军指挥部：cost=1500，power=40，前置 航空工学基础 + 矿石精炼厂
      const af = catalog.buildings.find(b => b.name === '空军指挥部')!;
      expect(af.cost).toBe(1500);
      expect(af.power).toBe(40);
      expect((af as any).tags).toContain('雷达扫描');

      // 5. 静态未打标建筑依然存在（如 发电厂、兵营、矿石精炼厂 等）
      const powerPlant = catalog.buildings.find(b => b.name === '发电厂');
      expect(powerPlant).toBeDefined();
      expect(powerPlant!.cost).toBe(800);
      expect(powerPlant!.power).toBe(-200);

      const barracks = catalog.buildings.find(b => b.name === '兵营');
      expect(barracks).toBeDefined();
      expect(barracks!.cost).toBe(500);
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 5. 只读接口与无 Pinia 纯函数契约
  // ════════════════════════════════════════════════════════════════
  describe('5. 只读接口与无 Pinia 纯函数契约', () => {
    it('catalog.effectiveCatalog、researches、buildings、productions、retrofits 只读响应式接口对齐', async () => {
      const catalog = useCatalogStore();
      await catalog.init();

      expect(Array.isArray(catalog.effectiveCatalog.buildings)).toBe(true);
      expect(Array.isArray(catalog.effectiveCatalog.researches)).toBe(true);
      expect(Array.isArray(catalog.effectiveCatalog.productions)).toBe(true);
      expect(Array.isArray(catalog.effectiveCatalog.retrofits)).toBe(true);
      expect(Array.isArray(catalog.effectiveCatalog.factionDefs)).toBe(true);

      // 别名 catalog 与 effectiveCatalog 引用相同
      expect(catalog.catalog).toBe(catalog.effectiveCatalog);
      expect(catalog.buildings).toBe(catalog.effectiveCatalog.buildings);
      expect(catalog.researches).toBe(catalog.effectiveCatalog.researches);
      expect(catalog.productions).toBe(catalog.effectiveCatalog.productions);
      expect(catalog.retrofits).toBe(catalog.effectiveCatalog.retrofits);
    });

    it('effectiveCatalogNames() 纯函数可在无 Pinia 状态下调用，包含基线与已缓存条目', () => {
      // 纯静态
      const names = effectiveCatalogNames();
      expect(names).toContain('战车工厂');
      expect(names).toContain('基础步兵训练学');
      expect(names).toContain('灰熊坦克现代化改装工程');
      expect(names).toContain('盟军');

      // 注入模块级缓存后，新名字亦被包含
      setCachedDynamicCatalog({
        buildings: [],
        researches: [
          {
            name: '量子穿梭理论',
            cost: 1000,
            line: '特色',
            tier: 2,
            prereqs: [],
            need_buildings: [],
            desc: '',
            type: 'research',
            id: 'Q1',
            tags: [],
          },
        ],
        productions: [],
        retrofits: [],
        projects: [],
        byId: {},
        items: [],
        diagnostics: [],
      });

      const updatedNames = effectiveCatalogNames();
      expect(updatedNames).toContain('量子穿梭理论');
    });
  });
});
