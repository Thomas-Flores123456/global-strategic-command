/**
 * worldbookCatalogParser.test.ts —— 世界书单一事实源解析器单元测试（CTRL-FRONT-CAT-01）
 *
 * 覆盖范围：
 * 1. 基础数据块提取与鲁棒性（前后换行、缩进、空白兼容）；
 * 2. 字段映射与类型体系（building/research/production/retrofit）；
 * 3. v1.2 扩展字段支持（tags、operation、compute、c4isr、repair_rate、storage、recipes）；
 * 4. 真实世界书回环解析（《通用·主建筑_世界书.json》18 项建筑真实回环：8 项 T1 试点 + 2a 扩建 6 项含算力设施 + D3 Tier0 补块 4 项）；
 * 5. 异常损坏隔离（损坏 JSON / 脏对象不中断整体，诊断记录完备）；
 * 6. 描述字段智能提炼（剥离首行标题、剥离标签、提取首段）；
 * 7. 多形态输入兼容（数组、entries 字典、嵌套对象、null/undefined 边界）。
 */

/* eslint-disable import-x/no-nodejs-modules -- 仅单测中读取世界书样本，不进 bundle */
import * as fs from 'node:fs';
import * as path from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';
import {
  defaultExperimentCostCreditsByTier,
  extractDataBlockString,
  extractDescriptionFromContent,
  isBuildingData,
  isProductionData,
  isProjectData,
  isProtocolData,
  isResearchData,
  isRetrofitData,
  parseSingleDataBlock,
  parseWorldbookEntries,
} from '../models/worldbookCatalogParser';

describe('worldbookCatalogParser 纯函数解析模块', () => {
  describe('1. 文本提取与首尾鲁棒性 (extractDataBlockString)', () => {
    it('标准提取：成功提取 <数据> 标签包裹的 JSON 字符串', () => {
      const content = `[通用·主建筑 | 战车工厂]\n正文叙述\n\n<数据>\n{\n  "schema_version": 1,\n  "type": "building",\n  "id": "战车工厂"\n}\n</数据>`;
      const raw = extractDataBlockString(content);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!)).toEqual({
        schema_version: 1,
        type: 'building',
        id: '战车工厂',
      });
    });

    it('空白与缩进兼容：容忍标签与大括号之间的任意换行、空格与制表符', () => {
      const content = `前置文本 <数据>   \n\t  {\n\t\t"type": "research",\n\t\t"id": "装甲载具工学"\n\t  }   \n  </数据> 后置文本`;
      const raw = extractDataBlockString(content);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.id).toBe('装甲载具工学');
    });

    it('无标签安全返回：纯设定条目不含 <数据> 标签时返回 null', () => {
      const content = `[总则 | 科技线说明]\n本条目没有任何机器数据块。`;
      expect(extractDataBlockString(content)).toBeNull();
      expect(extractDataBlockString('')).toBeNull();
      expect(extractDataBlockString(null as unknown as string)).toBeNull();
    });
  });

  describe('2. 描述字段智能提炼 (extractDescriptionFromContent)', () => {
    it('剥离首行中括号标题并提取第一段自然语言', () => {
      const content = `[通用·主建筑 | 战车工厂]\n建造2000 · 耗电50 · 周期T2级。\n核心功能：生产装甲载具。\n\n特殊约束：需要平坦地形。\n\n<数据>\n{"type":"building","id":"战车工厂"}\n</数据>`;
      const desc = extractDescriptionFromContent(content);
      expect(desc).toBe('建造2000 · 耗电50 · 周期T2级。\n核心功能：生产装甲载具。');
      expect(desc).not.toContain('[通用·主建筑');
      expect(desc).not.toContain('<数据>');
      expect(desc).not.toContain('特殊约束');
    });

    it('兼容中文六角/粗方括号【...】首行标题', () => {
      const content = `【特色科技·苏联 | 重型装甲冶金学】\n全面提升装甲钢屈服韧性与抗弹极限。\n\n第二段叙述。\n<数据>\n{"type":"research","id":"重型装甲冶金学"}\n</数据>`;
      const desc = extractDescriptionFromContent(content);
      expect(desc).toBe('全面提升装甲钢屈服韧性与抗弹极限。');
      expect(desc).not.toContain('【特色科技');
    });

    it('无中括号标题时直接提取首段', () => {
      const content = `这是直接开始的正文第一段。\n\n这是第二段。\n<数据>{}</数据>`;
      const desc = extractDescriptionFromContent(content);
      expect(desc).toBe('这是直接开始的正文第一段。');
    });

    it('支持根据 maxLength 截断简介', () => {
      const content = `[标题]\n一二三四五六七八九十一二三四五\n\n次段`;
      const desc = extractDescriptionFromContent(content, 10);
      expect(desc).toBe('一二三四五六七八九十');
      expect(desc.length).toBe(10);
    });

    it('空正文或纯数据块返回空字符串', () => {
      expect(extractDescriptionFromContent('')).toBe('');
      expect(extractDescriptionFromContent('[标题]\n<数据>{}</数据>')).toBe('');
    });
  });

  describe('3. 单条数据块解析与字段映射 (parseSingleDataBlock)', () => {
    it('解析建筑数据块：name 缺省时自动对齐 id，desc 缺省时自动从 content 提取', () => {
      const content = `[通用·主建筑 | 战车工厂]\n陆地载具核心制造基地。\n<数据>\n{\n  "schema_version": 1,\n  "type": "building",\n  "id": "战车工厂",\n  "cost": 2000,\n  "power": 50,\n  "tier": 1,\n  "tags": ["主建筑", "载具建造"],\n  "research": "装甲载具工学",\n  "prereqs": ["装甲载具工学"],\n  "need_buildings": ["矿石精炼厂"]\n}\n</数据>`;
      const rawText = extractDataBlockString(content)!;
      const res = parseSingleDataBlock(rawText, { entryName: '战车工厂', content });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(isBuildingData(res.data)).toBe(true);
        if (!isBuildingData(res.data)) throw new Error('应为建筑块');
        expect(res.data.id).toBe('战车工厂');
        expect(res.data.name).toBe('战车工厂');
        expect(res.data.cost).toBe(2000);
        expect(res.data.power).toBe(50);
        expect(res.data.tier).toBe(1);
        expect(res.data.tags).toEqual(['主建筑', '载具建造']);
        expect(res.data.desc).toBe('陆地载具核心制造基地。');
      }
    });

    it('若数据块内显式定义 desc，优先保留数据块中的定制 desc', () => {
      const content = `[通用·主建筑 | 战车工厂]\n外部自然语言叙述\n<数据>\n{\n  "type": "building",\n  "id": "战车工厂",\n  "cost": 2000,\n  "power": 50,\n  "desc": "数据块显式定制简介"\n}\n</数据>`;
      const rawText = extractDataBlockString(content)!;
      const res = parseSingleDataBlock(rawText, { content });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.desc).toBe('数据块显式定制简介');
      }
    });

    it('解析科技数据块 (type: research)', () => {
      const json = JSON.stringify({
        schema_version: 1,
        type: 'research',
        id: '装甲载具工学',
        cost: 300,
        eta: '约3日',
        line: '主建筑',
        tier: 1,
        unlocks: '战车工厂',
        prereqs: [],
        need_buildings: ['矿石精炼厂'],
        workload: { tflops: 10, tops: 5, days: 3 },
      });
      const res = parseSingleDataBlock(json);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(isResearchData(res.data)).toBe(true);
        if (!isResearchData(res.data)) throw new Error('应为研究块');
        expect(res.data.type).toBe('research');
        expect(res.data.id).toBe('装甲载具工学');
        expect(res.data.cost).toBe(300);
        expect(res.data.workload).toEqual({ tflops: 10, tops: 5, days: 3 });
      }
    });

    it('解析生产与单位数据块 (type: production)', () => {
      const json = JSON.stringify({
        type: 'production',
        id: 'M1A1灰熊坦克',
        cost: 800,
        need_building: '战车工厂',
        need_buildings: ['战车工厂'],
        category: 'vehicle',
        tags: ['主战坦克', '重型装甲'],
        assembly: { t_mat: 2, t_asm: 4, req_nanites: 50, min_days: 0.5 },
      });
      const res = parseSingleDataBlock(json);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(isProductionData(res.data)).toBe(true);
        expect(res.data.category).toBe('vehicle');
        expect(res.data.assembly?.req_nanites).toBe(50);
      }
    });

    it('解析改装工程数据块 (type: retrofit)', () => {
      const json = JSON.stringify({
        type: 'retrofit',
        id: '灰熊坦克现代化改装工程',
        research: '混合动力装甲工学',
        grade: '大改',
        desc: '混动APU+主动防御系统。',
      });
      const res = parseSingleDataBlock(json);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(isRetrofitData(res.data)).toBe(true);
        expect(res.data.grade).toBe('大改');
        expect(res.data.research).toBe('混合动力装甲工学');
      }
    });
  });

  describe('4. v1.2 扩展物理字段全量解析', () => {
    it('完整支持 operation（动态工况）、VirtualOutputs（双轨算力/C4ISR/抢修）、storage、recipes', () => {
      const complexBuilding = {
        type: 'building',
        id: '复合型高阶科研枢纽',
        cost: 3000,
        power: 100,
        tier: 2,
        tags: ['科技建筑', 'C4ISR', '前沿实验'],
        operation: {
          output_type: 'buff',
          base_output: 100,
          conditions: [
            {
              trigger: 'low_power',
              behavior: 'degraded',
              efficiency: 0.25,
              desc: '低电量降频运行',
            },
            {
              trigger: 'overclock',
              behavior: 'boosted',
              efficiency: 1.5,
              power: 150,
              desc: '超频运作加速仿真',
            },
          ],
        },
        inputs: {
          resources: {
            高精构造型纳米: 2,
            精炼柴油: 5,
          },
        },
        outputs: {
          resources: {
            机娘修复凝胶: 1,
          },
          virtual: {
            compute: {
              tflops: 120,
              tops: 80,
            },
            c4isr: {
              recon_km: 150,
              c2_slots: 8,
              ew_rating: 65,
            },
            grid_buffer: {
              storage_mwh: 50,
              max_discharge_mw: 10,
            },
            repair_rate: 35,
          },
        },
        storage: {
          resources: {
            高精构造型纳米: 50,
            机娘修复凝胶: 30,
          },
        },
        recipes: [
          {
            id: 'system_purchase',
            name: '系统资金直购',
            is_default: true,
            inputs: { credits: 500 },
            outputs: {
              resources: { 高精构造型纳米: 10 },
            },
            desc: '直接由系统资金结算',
          },
          {
            id: 'indigenous_synthesis',
            name: '本地原料精炼',
            inputs: {
              resources: { 铜矿砂: 10, 化工装药原料: 5 },
            },
            outputs: {
              resources: { 高精构造型纳米: 15 },
              virtual: { repair_rate: 10 },
            },
            desc: '本地工业自主精炼',
          },
        ],
      };

      const res = parseSingleDataBlock(JSON.stringify(complexBuilding));
      expect(res.success).toBe(true);
      if (res.success && isBuildingData(res.data)) {
        // operation 断言
        expect(res.data.operation?.conditions.length).toBe(2);
        expect(res.data.operation?.conditions[0].trigger).toBe('low_power');
        expect(res.data.operation?.conditions[0].efficiency).toBe(0.25);

        // inputs / outputs / storage 断言
        expect(res.data.inputs?.resources?.['高精构造型纳米']).toBe(2);
        expect(res.data.outputs?.virtual?.compute?.tflops).toBe(120);
        expect(res.data.outputs?.virtual?.compute?.tops).toBe(80);
        expect(res.data.outputs?.virtual?.c4isr?.recon_km).toBe(150);
        expect(res.data.outputs?.virtual?.grid_buffer?.storage_mwh).toBe(50);
        expect(res.data.outputs?.virtual?.repair_rate).toBe(35);
        expect(res.data.storage?.resources?.['机娘修复凝胶']).toBe(30);

        // recipes 断言
        expect(res.data.recipes?.length).toBe(2);
        expect(res.data.recipes?.[0].id).toBe('system_purchase');
        expect(res.data.recipes?.[0].inputs?.credits).toBe(500);
        expect(res.data.recipes?.[1].outputs?.virtual?.repair_rate).toBe(10);
      }
    });
  });

  describe('5. 真实世界书回环解析 (通用·主建筑_世界书.json 18 项建筑：8 项 T1 试点 + 2a 扩建 6 项 + D3 补块 4 项)', () => {
    it('读取真实世界书文件，解析出全部 18 项主建筑并准确提取 v1.2 物理字段', () => {
      const filePath = path.resolve(__dirname, '../../../../worldbooks/通用·主建筑_世界书.json');
      expect(fs.existsSync(filePath)).toBe(true);

      const rawJson = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const catalog = parseWorldbookEntries(rawJson, { silent: true });

      // 1. 整体数量断言：全书共 48 条（含未打标总则与其它条目），成功识别全部 41 项主建筑
      expect(catalog.buildings.length).toBe(41);
      expect(catalog.items.length).toBe(41);
      expect(catalog.diagnostics.length).toBe(0);

      // 2. 验证 14 项主建筑清单全部就位
      const expectedBuildingIds = [
        '战车工厂',
        '空军指挥部',
        '海军造船厂',
        '战斗实验室',
        '小型纳米合成工坊',
        '个人装备制造所',
        '陆军军校',
        '战地维修所',
        '超算中心',
        '量子超算中心',
        '建造厂核心',
        '发电厂',
        '兵营',
        '矿石精炼厂',
        '区域物流枢纽',
        '地下高速管道枢纽',
        '大型航天发射综合体',
        '深层地下综合体',
      ];
      const findBuilding = (nameOrId: string) =>
        catalog.byId[nameOrId] ?? catalog.buildings.find(b => b.name === nameOrId);
      for (const id of expectedBuildingIds) {
        const bld = findBuilding(id);
        expect(bld).toBeDefined();
        expect(bld!.type).toBe('building');
        expect(bld!.name).toBe(id);
        // desc 自动从外部正文提炼，不为空且不含标题
        expect(bld!.desc).toBeTruthy();
        expect(bld!.desc).not.toContain('[通用·主建筑');
        expect(bld!.desc).not.toContain('<数据>');
      }

      // 3. 详细断言 v1.2 试点核心增补字段：
      // (a) UID 3 战车工厂：outputs.virtual.repair_rate = 20
      const tankFactory = findBuilding('战车工厂')!;
      if (isBuildingData(tankFactory)) {
        expect(tankFactory.cost).toBe(2000);
        expect(tankFactory.power).toBe(50);
        expect(tankFactory.tags).toContain('重型装甲');
        expect(tankFactory.tags).toContain('陆军核心');
        expect(tankFactory.outputs?.virtual?.repair_rate).toBe(20);
      }

      // (b) UID 4 空军指挥部
      const airCommand = findBuilding('空军指挥部')!;
      if (isBuildingData(airCommand)) {
        expect(airCommand.cost).toBe(1500);
        expect(airCommand.power).toBe(40);
        expect(airCommand.tags).toContain('雷达扫描');
        expect(airCommand.tags).toContain('航空枢纽');
      }

      // (c) UID 6 战斗实验室（含默认算力 outputs.virtual.compute = 50/30）
      const battleLab = findBuilding('战斗实验室')!;
      if (isBuildingData(battleLab)) {
        expect(battleLab.cost).toBe(2500);
        expect(battleLab.power).toBe(80);
        expect(battleLab.tags).toContain('前沿科研');
        expect(battleLab.tags).toContain('T2入口');
        expect(battleLab.need_buildings).toContain('空军指挥部');
        expect(battleLab.outputs?.virtual?.compute).toEqual({ tflops: 50, tops: 30 });
      }

      // (d) UID 7 小型纳米合成工坊：仓储缓冲
      const nanoWorkshop = findBuilding('小型纳米合成工坊')!;
      if (isBuildingData(nanoWorkshop)) {
        expect(nanoWorkshop.cost).toBe(600);
        expect(nanoWorkshop.power).toBe(20);
        expect(nanoWorkshop.tags).toContain('纳米制造');
        expect(nanoWorkshop.tags).toContain('应急储能');
        expect(nanoWorkshop.storage?.resources).toEqual({
          标准纳米工料: 100,
          机娘修复凝胶: 20,
        });
      }

      // (e) UID 10 战地维修所
      const repairDepot = findBuilding('战地维修所')!;
      if (isBuildingData(repairDepot)) {
        expect(repairDepot.cost).toBe(700);
        expect(repairDepot.power).toBe(20);
        expect(repairDepot.tags).toContain('野战抢修');
        expect(repairDepot.need_buildings).toContain('战车工厂');
      }

      // (f) 2a/B1 扩建 · 算力设施：超算中心/量子超算中心（含默认算力 outputs.virtual.compute）
      const superCompute = findBuilding('超算中心')!;
      if (isBuildingData(superCompute)) {
        expect(superCompute.cost).toBe(4000);
        expect(superCompute.tier).toBe(2);
        expect(superCompute.research).toBe('高性能计算工学');
        expect(superCompute.tags).toContain('算力枢纽');
        expect(superCompute.tags).toContain('科研支持');
        expect(superCompute.outputs?.virtual?.compute).toEqual({ tflops: 50, tops: 30 });
      }
      const quantumCompute = findBuilding('量子超算中心')!;
      if (isBuildingData(quantumCompute)) {
        expect(quantumCompute.cost).toBe(15000);
        expect(quantumCompute.tier).toBe(3);
        expect(quantumCompute.research).toBe('量子计算工学');
        expect(quantumCompute.need_buildings).toContain('超算中心');
        expect(quantumCompute.tags).toContain('量子计算');
        expect(quantumCompute.outputs?.virtual?.compute).toEqual({ tflops: 120, tops: 60 });
      }
    });
  });

  describe('6. 异常容错与隔离性 (Fault Tolerance & Isolation)', () => {
    it('JSON 语法损坏或必填字段缺失时，记录诊断信息并安全跳过，绝不崩溃', () => {
      const entries = [
        {
          name: '正常建筑',
          content: `[建筑 | 正常建筑]\n正常简介\n<数据>\n{"type":"building","id":"正常建筑","cost":500,"power":10}\n</数据>`,
        },
        {
          name: '损坏建筑A_JSON语法错',
          content: `[建筑 | 损坏建筑A]\n损坏简介\n<数据>\n{"type":"building","id":"损坏建筑A", "cost": 500, \n</数据>`,
        },
        {
          name: '损坏建筑B_字段校验失败',
          content: `[建筑 | 损坏建筑B]\n<数据>\n{"type":"building"}\n</数据>`, // 缺少 id
        },
        {
          name: '损坏条目C_非法类型',
          content: `[建筑 | 损坏条目C]\n<数据>\n{"type":"alien_weapon","id":"外星武器"}\n</数据>`,
        },
        {
          name: '纯设定条目_无数据',
          content: `[总则 | 纯设定]\n没有数据块`,
        },
        {
          name: '空数据块',
          content: `[建筑 | 空数据块]\n<数据>  \n </数据>`,
        },
        {
          name: '后置正常建筑',
          content: `[建筑 | 后置正常建筑]\n后置简介\n<数据>\n{"type":"building","id":"后置正常建筑","cost":800,"power":20}\n</数据>`,
        },
      ];

      const catalog = parseWorldbookEntries(entries, { silent: true });

      // 两个正常建筑顺利入库
      expect(catalog.buildings.length).toBe(2);
      expect(catalog.byId['正常建筑']).toBeDefined();
      expect(catalog.byId['后置正常建筑']).toBeDefined();

      // 诊断数组包含 4 个异常条目（JSON语法错、字段校验错、非法类型、空数据块）
      expect(catalog.diagnostics.length).toBe(4);
      const errorEntryNames = catalog.diagnostics.map(d => d.entryName);
      expect(errorEntryNames).toContain('损坏建筑A_JSON语法错');
      expect(errorEntryNames).toContain('损坏建筑B_字段校验失败');
      expect(errorEntryNames).toContain('损坏条目C_非法类型');
      expect(errorEntryNames).toContain('空数据块');
    });
  });

  describe('7. 多形态数据源与边界输入兼容', () => {
    it('支持标准 WorldbookEntry[] 数组输入', () => {
      const arr = [
        {
          name: '建筑1',
          content: `<数据>{"type":"building","id":"B1","cost":100,"power":10}</数据>`,
        },
      ];
      const res = parseWorldbookEntries(arr, { silent: true });
      expect(res.buildings.length).toBe(1);
      expect(res.byId['B1']).toBeDefined();
    });

    it('支持包含 entries 字典的世界书原生导出 JSON 对象', () => {
      const rawExport = {
        entries: {
          '0': {
            name: '科技1',
            content: `<数据>{"type":"research","id":"T1","cost":200}</数据>`,
          },
          '1': {
            name: '建筑1',
            content: `<数据>{"type":"building","id":"B1","cost":300,"power":15}</数据>`,
          },
        },
      };
      const res = parseWorldbookEntries(rawExport, { silent: true });
      expect(res.researches.length).toBe(1);
      expect(res.buildings.length).toBe(1);
    });

    it('支持 entries 为数组的世界书对象', () => {
      const rawExport = {
        entries: [
          {
            name: '科技1',
            content: `<数据>{"type":"research","id":"T1","cost":200}</数据>`,
          },
        ],
      };
      const res = parseWorldbookEntries(rawExport, { silent: true });
      expect(res.researches.length).toBe(1);
    });

    it('极端空值安全边界：null、undefined、空字符串、非对象输入安全返回空目录', () => {
      expect(parseWorldbookEntries(null).items).toEqual([]);
      expect(parseWorldbookEntries(undefined).items).toEqual([]);
      expect(parseWorldbookEntries('').items).toEqual([]);
      expect(parseWorldbookEntries(12345).items).toEqual([]);
      expect(parseWorldbookEntries([]).items).toEqual([]);
      expect(parseWorldbookEntries({}).items).toEqual([]);
      expect(parseWorldbookEntries([]).protocols).toEqual([]);
    });
  });

  describe('8. PRT-PARSE-01：protocol 第四分支与存量集合 round-trip 逐字节不变断言', () => {
    it('验收 ①：存量集合（buildings / productions / researches / retrofits / projects）round-trip 逐字节不变', () => {
      const mixedLegacyEntries = [
        {
          name: '战车工厂',
          content: `[通用·主建筑 | 战车工厂]\n陆地载具核心制造基地。\n<数据>{"schema_version":1,"type":"building","id":"战车工厂","cost":2000,"power":50,"tier":1,"prereqs":["装甲载具工学"],"need_buildings":["矿石精炼厂"]}</数据>`,
        },
        {
          name: 'M1A1灰熊坦克',
          content: `[武备·盟军 | M1A1灰熊坦克]\n盟军制式主战坦克。\n<数据>{"schema_version":1,"type":"production","id":"M1A1灰熊坦克","cost":800,"need_building":"战车工厂","need_buildings":["战车工厂"],"category":"vehicle"}</数据>`,
        },
        {
          name: '装甲载具工学',
          content: `[通用·科技 | 装甲载具工学]\n装甲车辆设计制造理论。\n<数据>{"schema_version":1,"type":"research","id":"装甲载具工学","cost":300,"eta":"约3日","line":"主建筑","tier":1,"unlocks":"战车工厂","prereqs":[],"need_buildings":["矿石精炼厂"]}</数据>`,
        },
        {
          name: '灰熊坦克现代化改装工程',
          content: `[工程·盟军 | 灰熊坦克现代化改装工程]\n混动APU改装。\n<数据>{"schema_version":1,"type":"retrofit","id":"灰熊坦克现代化改装工程","research":"混合动力装甲工学","grade":"大改","cost":3000}</数据>`,
        },
        {
          name: '轨道船坞',
          content: `[工程·通用 | 轨道船坞]\n近地轨道组装船坞。\n<数据>{"schema_version":2,"type":"project","id":"all.project.orbital_shipyard","name":"轨道船坞","modules":[{"id":"m.core","name":"核心舱","workload":{"days":10,"min_days":5}}]}</数据>`,
        },
      ];

      const catalogWithoutProtocol = parseWorldbookEntries(mixedLegacyEntries, { silent: true });
      const protocolEntry = {
        name: '战斗工兵—预制战斗碉堡协议',
        content: `[协议 | 战斗工兵—预制战斗碉堡协议]\n授权战斗工兵构筑预制碉堡。\n<数据>{"schema_version":2,"type":"protocol","id":"sov.protocol.ra3.combat_engineer_prefab_bunker","name":"战斗工兵—预制战斗碉堡协议","scope":"faction","faction":"苏联","track":"钢铁基干与国家动员","tier":1}</数据>`,
      };
      const catalogWithProtocol = parseWorldbookEntries([...mixedLegacyEntries, protocolEntry], { silent: true });

      expect(catalogWithoutProtocol.buildings).toHaveLength(1);
      expect(catalogWithoutProtocol.productions).toHaveLength(1);
      expect(catalogWithoutProtocol.researches).toHaveLength(1);
      expect(catalogWithoutProtocol.retrofits).toHaveLength(1);
      expect(catalogWithoutProtocol.projects).toHaveLength(1);
      expect(isProjectData(catalogWithoutProtocol.projects[0])).toBe(true);
      expect(catalogWithoutProtocol.protocols).toEqual([]);

      // 加入 protocol 条目后，存量集合逐字节完全一致
      expect(JSON.stringify(catalogWithProtocol.buildings)).toBe(JSON.stringify(catalogWithoutProtocol.buildings));
      expect(JSON.stringify(catalogWithProtocol.productions)).toBe(JSON.stringify(catalogWithoutProtocol.productions));
      expect(JSON.stringify(catalogWithProtocol.researches)).toBe(JSON.stringify(catalogWithoutProtocol.researches));
      expect(JSON.stringify(catalogWithProtocol.retrofits)).toBe(JSON.stringify(catalogWithoutProtocol.retrofits));
      expect(JSON.stringify(catalogWithProtocol.projects)).toBe(JSON.stringify(catalogWithoutProtocol.projects));
      expect(catalogWithProtocol.protocols).toHaveLength(1);
    });

    it('验收 ②-A：protocol 数据块完整字段解析路径（含 discovery、reveals、exclusive_with、requirements 三原子树）', () => {
      const fullProtocol = {
        schema_version: 2,
        type: 'protocol',
        id: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
        name: '战斗工兵—预制战斗碉堡协议',
        scope: 'faction',
        faction: '苏联',
        track: '钢铁基干与国家动员',
        tier: 1,
        cost_points: 1,
        experiment_cost_credits: 500,
        reveals: ['sov.research.t2.prefab_fortification'],
        discovery: {
          kind: 'experiment',
          building_any: ['红星实验设计局综合体', '战斗实验室'],
          research_all: ['高级作战实验理论'],
        },
        exclusive_with: ['sov.protocol.ra3.alt_bunker'],
        requirements: {
          op: 'all',
          conditions: [
            { kind: 'research', name: '基础步兵训练学' },
            { kind: 'building', name: '兵营', scope: 'global', state: 'completed' },
            { kind: 'unit_present', name: '战斗工兵', min: 1, scope: 'global' },
          ],
        },
        pack: 'base',
        status: 'active',
        desc: '授权前线战斗工兵快速构筑模块化预制钢筋混凝土战斗碉堡。',
      };

      const res = parseSingleDataBlock(JSON.stringify(fullProtocol), {
        entryName: '01·战斗工兵—预制战斗碉堡协议',
      });
      expect(res.success).toBe(true);
      if (!res.success || !isProtocolData(res.data)) throw new Error('应成功解析为 protocol 块');

      expect(res.data.schema_version).toBe(2);
      expect(res.data.type).toBe('protocol');
      expect(res.data.id).toBe('sov.protocol.ra3.combat_engineer_prefab_bunker');
      expect(res.data.name).toBe('战斗工兵—预制战斗碉堡协议');
      expect(res.data.scope).toBe('faction');
      expect(res.data.faction).toBe('苏联');
      expect(res.data.track).toBe('钢铁基干与国家动员');
      expect(res.data.tier).toBe(1);
      expect(res.data.cost_points).toBe(1);
      expect(res.data.experiment_cost_credits).toBe(500);
      expect(res.data.reveals).toEqual(['sov.research.t2.prefab_fortification']);
      expect(res.data.discovery).toEqual({
        kind: 'experiment',
        building_any: ['红星实验设计局综合体', '战斗实验室'],
        research_all: ['高级作战实验理论'],
      });
      expect(res.data.exclusive_with).toEqual(['sov.protocol.ra3.alt_bunker']);
      expect(res.data.requirements).toEqual(fullProtocol.requirements);
      expect(res.data.pack).toBe('base');
      expect(res.data.status).toBe('active');
      expect(res.data.desc).toBe('授权前线战斗工兵快速构筑模块化预制钢筋混凝土战斗碉堡。');
    });

    it('验收 ②-B：protocol 数据块可选字段缺省回填路径（cost_points=1、按 Tier 缺省 500/1500/4000、reveals=[]、discovery 可选）', () => {
      expect(defaultExperimentCostCreditsByTier(1)).toBe(500);
      expect(defaultExperimentCostCreditsByTier(2)).toBe(1500);
      expect(defaultExperimentCostCreditsByTier(3)).toBe(4000);

      const entries = [
        {
          name: '01·战斗工兵—预制战斗碉堡协议',
          content: `[协议 | 战斗工兵—预制战斗碉堡协议]\n前线模块化预制战斗碉堡条令。\n\n<数据>\n${JSON.stringify({
            type: 'protocol',
            id: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
            track: '钢铁基干与国家动员',
            tier: 1,
          })}\n</数据>`,
        },
        {
          name: '09·铁幕紧急过载协议',
          content: `[协议 | 铁幕紧急过载协议]\n紧急过载铁幕装置。\n\n<数据>\n${JSON.stringify({
            schema_version: 2,
            type: 'protocol',
            id: 'sov.research.t2.iron_curtain_emergency_overload',
            name: '铁幕紧急过载协议',
            faction: '苏联',
            track: '过载工程与战区拒止',
            tier: 2,
            discovery: { kind: 'event' },
          })}\n</数据>`,
        },
        {
          name: '16·核指挥接替与态势重建规程',
          content: `[协议 | 核指挥接替与态势重建规程]\n极端核打击下指挥链重建规程。\n\n<数据>\n${JSON.stringify({
            schema_version: 2,
            type: 'protocol',
            id: 'sov.research.t3.nuclear_command_succession_rebuild',
            name: '核指挥接替与态势重建规程',
            faction: '苏联',
            track: '战略授权与核管控',
            tier: 3,
          })}\n</数据>`,
        },
      ];

      const catalog = parseWorldbookEntries(entries, { silent: true });
      expect(catalog.diagnostics).toHaveLength(0);
      expect(catalog.protocols).toHaveLength(3);

      const [t1, t2, t3] = catalog.protocols;
      // T1 缺省回填断言
      expect(t1.schema_version).toBe(2);
      expect(t1.name).toBe('战斗工兵—预制战斗碉堡协议');
      expect(t1.faction).toBe('苏联');
      expect(t1.scope).toBe('faction');
      expect(t1.cost_points).toBe(1);
      expect(t1.experiment_cost_credits).toBe(500);
      expect(t1.reveals).toEqual([]);
      expect(t1.exclusive_with).toEqual([]);
      expect(t1.discovery).toBeUndefined();
      expect(t1.pack).toBe('base');
      expect(t1.status).toBe('active');
      expect(t1.desc).toBe('前线模块化预制战斗碉堡条令。');

      // T2 缺省回填断言
      expect(t2.tier).toBe(2);
      expect(t2.cost_points).toBe(1);
      expect(t2.experiment_cost_credits).toBe(1500);
      expect(t2.reveals).toEqual([]);
      expect(t2.discovery).toEqual({ kind: 'event' });

      // T3 缺省回填断言
      expect(t3.tier).toBe(3);
      expect(t3.cost_points).toBe(1);
      expect(t3.experiment_cost_credits).toBe(4000);
      expect(t3.reveals).toEqual([]);
      expect(t3.discovery).toBeUndefined();
    });

    it('protocol 块非法 discovery.kind 或非法 requirements 原子（如 kind: protocol）条目级隔离', () => {
      const badDiscovery = parseSingleDataBlock(
        JSON.stringify({
          schema_version: 2,
          type: 'protocol',
          id: 'sov.protocol.bad_discovery',
          name: '错误启封协议',
          tier: 1,
          discovery: { kind: 'magic' },
        }),
        { entryName: 'bad_discovery', logger: { warn: () => {} } },
      );
      expect(badDiscovery.success).toBe(false);
      if (!badDiscovery.success) {
        expect(badDiscovery.diagnostic.code).toBe('validation_error');
      }

      const badRequirementsAtom = parseSingleDataBlock(
        JSON.stringify({
          schema_version: 2,
          type: 'protocol',
          id: 'sov.protocol.bad_req',
          name: '越权原子协议',
          tier: 1,
          requirements: { kind: 'protocol', name: '前置协议' },
        }),
        { entryName: 'bad_req', logger: { warn: () => {} } },
      );
      expect(badRequirementsAtom.success).toBe(false);
      if (!badRequirementsAtom.success) {
        expect(badRequirementsAtom.diagnostic.code).toBe('validation_error');
        expect(badRequirementsAtom.diagnostic.message).toContain('未知条件原子：protocol');
      }
    });
  });

  describe('9. HERO-UNIT-01：production 数量上限 max_count / limit 归一与盟苏传奇英雄真实世界书解析', () => {
    it('支持 production 条目声明 max_count 正整数与 limit 同义归一，非法值触发诊断隔离', () => {
      const directMax = parseSingleDataBlock(
        JSON.stringify({
          schema_version: 2,
          type: 'production',
          id: 'ally.unit.infantry.tanya',
          name: '盟军传奇特战员·谭雅',
          cost: 1500,
          max_count: 1,
          need_building: '兵营',
        }),
        { entryName: 'tanya', logger: { warn: () => {} } },
      );
      expect(directMax.success).toBe(true);
      if (directMax.success && directMax.data.type === 'production') {
        expect(directMax.data.max_count).toBe(1);
      }

      const aliasLimit = parseSingleDataBlock(
        JSON.stringify({
          schema_version: 2,
          type: 'production',
          id: '苏维埃传奇战斗英雄·鲍里斯',
          name: '苏维埃传奇战斗英雄·鲍里斯',
          cost: 1500,
          limit: 1,
          need_building: '兵营',
        }),
        { entryName: 'boris', logger: { warn: () => {} } },
      );
      expect(aliasLimit.success).toBe(true);
      if (aliasLimit.success && aliasLimit.data.type === 'production') {
        expect(aliasLimit.data.max_count).toBe(1);
      }

      const badMax = parseSingleDataBlock(
        JSON.stringify({
          schema_version: 2,
          type: 'production',
          id: 'bad.hero',
          name: '非法上限单位',
          cost: 1500,
          max_count: 0,
        }),
        { entryName: 'bad_hero', logger: { warn: () => {} } },
      );
      expect(badMax.success).toBe(false);
    });

    it('读取真实《武备·盟军_世界书.json》与《武备·苏联_世界书.json》，准确解析谭雅与鲍里斯（max_count=1）', () => {
      const alliedPath = path.resolve(__dirname, '../../../../worldbooks/武备·盟军_世界书.json');
      const sovietPath = path.resolve(__dirname, '../../../../worldbooks/武备·苏联_世界书.json');
      expect(fs.existsSync(alliedPath)).toBe(true);
      expect(fs.existsSync(sovietPath)).toBe(true);

      const alliedCatalog = parseWorldbookEntries(JSON.parse(fs.readFileSync(alliedPath, 'utf-8')), { silent: true });
      const sovietCatalog = parseWorldbookEntries(JSON.parse(fs.readFileSync(sovietPath, 'utf-8')), { silent: true });
      expect(alliedCatalog.diagnostics).toEqual([]);
      expect(sovietCatalog.diagnostics).toEqual([]);

      const tanya = alliedCatalog.productions.find(p => p.id === 'ally.unit.infantry.tanya' || p.name === '盟军传奇特战员·谭雅');
      expect(tanya).toBeDefined();
      expect(tanya?.max_count).toBe(1);
      expect(tanya?.cost).toBe(1500);
      expect(tanya?.aliases).toContain('谭雅');

      const boris = sovietCatalog.productions.find(p => p.id === '苏维埃传奇战斗英雄·鲍里斯' || p.name === '苏维埃传奇战斗英雄·鲍里斯');
      expect(boris).toBeDefined();
      expect(boris?.max_count).toBe(1);
      expect(boris?.cost).toBe(1500);
      expect(boris?.aliases).toContain('鲍里斯');
    });
  });
});
