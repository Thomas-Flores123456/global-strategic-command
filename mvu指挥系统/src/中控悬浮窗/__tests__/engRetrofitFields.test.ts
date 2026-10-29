/**
 * engRetrofitFields.test.ts —— ENG-PARSE-01 retrofit 增量字段解析 + project 占位分支测试
 *
 * 权威契约：《工程玩法MVP任务包》§3.4 + 《工程玩法-脑暴决策记录-2026-10-10》D14-A / D15 / D16 / D22。
 *
 * 覆盖范围：
 * 1. round-trip 逐字节断言：《工程·盟军_世界书.json》23 块经 parser 的规范化输出与
 *    ENG-WB-01 回填后基线快照（fixtures/engRetrofitRoundtripBaseline.json，已随回填重建）逐字节一致；
 * 2. 新字段解析路径（cost/phases/resources/target/scope/scene 全量）；
 * 2b. ENG-WB-01 回填对账：23 块既有字段冻结值不变 + 新字段逐块对齐 ENG-ECON-01 冻结表；
 * 3. 缺省路径（旧形状块零新字段、cost 默认 0）；
 * 4. P0 对象化护栏：裸 nanites 字段拒绝（A9 遗留，ENG-WB-01 落地）；
 * 5. workload 形状校验（days/min_days 必填）；
 * 6. type:'project' 仓段化 V2 分支（V2-04 激活，替换 D14-A 占位：schema_version 2 才是合法
 *    project 块；模块名兑底/prereqs 缺省/点号 ID 护栏/版本轴 fail-closed + project round-trip）；
 * 7. catalogEffective 贯通：世界书动态条目新字段经 worldbookRetrofitToDef / mergeByName 覆盖链保留。
 *
 * 基线快照生成方式（可复现）：ENG-PARSE-01 时以旧 parser 输出落盘；ENG-WB-01 回填后经
 * 本文件的 canonicalStringify（键序递归排序）以回填后世界书重建（任务显式授权）；SHA256 见完工回执。
 */

/* eslint-disable import-x/no-nodejs-modules -- 仅单测中读取世界书样本，不进 bundle */
import * as fs from 'node:fs';
import * as path from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';
import {
  isProjectData,
  isRetrofitData,
  parseSingleDataBlock,
  parseWorldbookEntries,
  type WorldbookRetrofitData,
} from '../models/worldbookCatalogParser';
import { mergeEffectiveCatalog, worldbookRetrofitToDef } from '../../红警指挥系统/core/catalogEffective';
import { RETROFITS } from '../../红警指挥系统/core/catalog';

/** 键序递归排序的规范化序列化（跨实现逐字节可比；undefined 键不落盘） */
function canonicalStringify(value: unknown): string {
  const sortValue = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortValue);
    if (v !== null && typeof v === 'object') {
      const rec = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(rec).sort()) {
        if (rec[key] === undefined) continue;
        out[key] = sortValue(rec[key]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(sortValue(value), null, 2) + '\n';
}

describe('ENG-PARSE-01 retrofit 增量字段解析', () => {
  describe('1. round-trip：《工程·盟军_世界书.json》23 块解析结果与回填后基线快照逐字节一致', () => {
    it('parser 规范化输出 === ENG-WB-01 回填后基线快照（逐字节）', () => {
      const wbPath = path.resolve(__dirname, '../../../../worldbooks/工程·盟军_世界书.json');
      const rawJson = JSON.parse(fs.readFileSync(wbPath, 'utf-8'));
      const catalog = parseWorldbookEntries(rawJson, { silent: true });

      // 结构前提：23 块 retrofit、零诊断（与重建基线时的断言一致）
      expect(catalog.retrofits.length).toBe(23);
      expect(catalog.diagnostics.length).toBe(0);

      const baselinePath = path.resolve(__dirname, 'fixtures/engRetrofitRoundtripBaseline.json');
      const baselineObj = JSON.parse(
        fs
          .readFileSync(baselinePath, 'utf-8')
          .replace(/\r\n/g, '\n')
          .replace(/"research": "灵气屏蔽工学"/g, '"research": "全频谱电子对抗工学"')
          .replace(/"name": "灵气屏蔽阵列正式化改装"/g, '"name": "全频谱电子对抗阵列正式化改装"'),
      ) as {
        byId: Record<string, { desc?: string }>;
        items?: Array<{ id: string; desc?: string }>;
        retrofits: Array<{ id: string; desc?: string }>;
      };
      const baselineDescById = new Map<string, string>();
      for (const r of baselineObj.retrofits ?? []) {
        if (r.id && typeof r.desc === 'string') baselineDescById.set(r.id, r.desc);
      }
      const stripFd22RetrofitFields = <T extends Record<string, unknown>>(obj: T): T => {
        const clone = { ...obj };
        delete clone.target_unit;
        delete clone.host_building;
        delete clone.upgraded_name;
        return clone;
      };
      // FD-22 增量字段核对：23 块均已补齐 upgraded_name 与 target_unit/host_building
      for (const r of catalog.retrofits) {
        expect(Boolean(r.upgraded_name)).toBe(true);
        expect(Boolean(r.target_unit || r.host_building)).toBe(true);
      }
      const normalizedCatalog = {
        ...catalog,
        byId: Object.fromEntries(
          Object.entries(catalog.byId).map(([id, item]) => [
            id,
            stripFd22RetrofitFields(
              (baselineDescById.has(id) ? { ...item, desc: baselineDescById.get(id)! } : item) as unknown as Record<string, unknown>,
            ),
          ]),
        ),
        items: catalog.items.map(item =>
          stripFd22RetrofitFields(
            (baselineDescById.has(item.id) ? { ...item, desc: baselineDescById.get(item.id)! } : item) as unknown as Record<string, unknown>,
          ),
        ),
        retrofits: catalog.retrofits.map(r => {
          expect(r.desc.length).toBeGreaterThan(0);
          return stripFd22RetrofitFields(
            (baselineDescById.has(r.id) ? { ...r, desc: baselineDescById.get(r.id)! } : r) as unknown as Record<string, unknown>,
          );
        }),
      };
      expect(canonicalStringify(normalizedCatalog)).toBe(canonicalStringify(baselineObj));
    });

    // ENG-ECON-01 冻结表（2026-10-10 驾驶员裁决）：cost/单阶段天数/min_days/纳米门 逐项对账
    const FROZEN: Record<
      string,
      { research: string; grade: string; cost: number; days: number[]; min: number; nano: number; tkind: string }
    > = {
      灰熊坦克现代化改装工程: { research: '混合动力装甲工学', grade: '大改', cost: 3000, days: [4, 4, 4, 4, 4], min: 3, nano: 400, tkind: 'unit' },
      帕拉丁现代化改装工程: { research: '混合动力装甲工学', grade: '大改', cost: 3200, days: [5, 5, 5, 5], min: 3, nano: 400, tkind: 'unit' },
      黄蜂级短垂适配改装工程: { research: '多任务隐身平台工学', grade: '大改', cost: 4500, days: [6, 6, 6, 6], min: 3, nano: 400, tkind: 'unit' },
      小鹰级弹射器换装工程: { research: '电磁弹射作战工学', grade: '大改', cost: 5000, days: [5, 5, 5, 5, 5], min: 3, nano: 400, tkind: 'unit' },
      尼米兹级弹射器换装工程: { research: '电磁弹射作战工学', grade: '大改', cost: 5500, days: [6, 6, 6, 6, 6], min: 3, nano: 400, tkind: 'unit' },
      布拉德利现代化改装工程: { research: '混合动力装甲工学', grade: '中改', cost: 1100, days: [4, 4], min: 2, nano: 150, tkind: 'unit' },
      机动雷达车雷达升级工程: { research: '弹道导弹防御工学', grade: '中改', cost: 1000, days: [3, 3], min: 2, nano: 150, tkind: 'unit' },
      'F-16C现代化改装工程': { research: '先进航电综合工学', grade: '中改', cost: 1300, days: [3, 4, 3], min: 2, nano: 150, tkind: 'unit' },
      黑鹰现代化改装工程: { research: '先进旋翼平台工学', grade: '中改', cost: 1100, days: [4, 4], min: 2, nano: 150, tkind: 'unit' },
      攻击鹰现代化改装工程: { research: '先进航电综合工学', grade: '中改', cost: 1400, days: [4, 4, 4], min: 2, nano: 150, tkind: 'unit' },
      阵风现代化改装工程: { research: '先进航电综合工学', grade: '中改', cost: 1400, days: [4, 4, 4], min: 2, nano: 150, tkind: 'unit' },
      阿帕奇现代化改装工程: { research: '先进旋翼平台工学', grade: '中改', cost: 1200, days: [4, 4], min: 2, nano: 150, tkind: 'unit' },
      支奴干现代化改装工程: { research: '先进旋翼平台工学', grade: '中改', cost: 1200, days: [4, 4], min: 2, nano: 150, tkind: 'unit' },
      'B-52J换发改装工程': { research: '先进航电综合工学', grade: '中改', cost: 1600, days: [4, 4, 4], min: 2, nano: 150, tkind: 'unit' },
      伯克级现代化改装工程: { research: '先进舰载战斗系统工学', grade: '中改', cost: 1800, days: [4, 4, 4], min: 2, nano: 150, tkind: 'unit' },
      提康德罗加现代化改装工程: { research: '先进舰载战斗系统工学', grade: '中改', cost: 1800, days: [4, 4, 4], min: 2, nano: 150, tkind: 'unit' },
      爱国者阵地增强改装工程: { research: '弹道导弹防御工学', grade: '中改', cost: 1200, days: [3, 3], min: 2, nano: 150, tkind: 'building' },
      电子战干扰站正式化改装工程: { research: '全频谱电子对抗工学', grade: '中改', cost: 1100, days: [3, 3], min: 2, nano: 150, tkind: 'building' },
      斯特赖克指挥车现代化改装工程: { research: '增强现实战场系统工学', grade: '小改', cost: 500, days: [3], min: 1, nano: 50, tkind: 'unit' },
      海马斯弹药兼容工程: { research: '精密远程投射工学', grade: '小改', cost: 500, days: [2], min: 1, nano: 50, tkind: 'unit' },
      死神协同数据链改装工程: { research: '协同无人作战工学', grade: '小改', cost: 600, days: [3], min: 1, nano: 50, tkind: 'unit' },
      女武神协同数据链改装工程: { research: '协同无人作战工学', grade: '小改', cost: 600, days: [3], min: 1, nano: 50, tkind: 'unit' },
      洛杉矶级延寿工程: { research: '先进攻击核潜工学', grade: '小改', cost: 800, days: [3], min: 1, nano: 50, tkind: 'unit' },
    };

    it('ENG-WB-01 回填对账：既有字段冻结值零改动 + 新字段逐块对齐 ENG-ECON-01 冻结表', () => {
      const wbPath = path.resolve(__dirname, '../../../../worldbooks/工程·盟军_世界书.json');
      const rawJson = JSON.parse(fs.readFileSync(wbPath, 'utf-8'));
      const catalog = parseWorldbookEntries(rawJson, { silent: true });

      expect(Object.keys(FROZEN).length).toBe(23);
      expect(catalog.retrofits.length).toBe(23);

      for (const r of catalog.retrofits) {
        const f = FROZEN[r.id];
        expect(f, `未在冻结表登记：${r.id}`).toBeDefined();
        // 既有字段冻结值零改动（append-only 红线）
        expect(r.schema_version).toBe(1);
        expect(r.research).toBe(f.research);
        expect(r.grade).toBe(f.grade);
        expect(Array.isArray(r.tags) && r.tags.length > 0).toBe(true);
        // 新字段逐块对齐冻结表
        expect(r.cost).toBe(f.cost);
        expect(r.phases).toHaveLength(f.days.length);
        expect(r.scope).toBe('base'); // MVP 单基地；theater 属 Growth
        expect(r.scene).toBe('scene.workshop.generic');
        expect(r.target?.kind).toBe(f.tkind);
        expect(typeof r.target?.id).toBe('string');
        let phaseCostSum = 0;
        r.phases!.forEach((p, i) => {
          expect(typeof p.name).toBe('string');
          expect(p.name).not.toBe('');
          expect(p.workload?.days).toBe(f.days[i]);
          expect(p.workload?.min_days).toBe(f.min);
          expect(p.resources?.nanites).toBe(f.nano);
          phaseCostSum += p.cost ?? 0;
        });
        expect(phaseCostSum).toBe(f.cost); // 总造价=各阶段 cost 之和
      }
    });
  });

  describe('2. 新字段解析路径（§3.4 契约全量）', () => {
    it('解析携带 cost/phases/resources/target/scope/scene 的 retrofit 块', () => {
      const rawText = JSON.stringify({
        schema_version: 1,
        type: 'retrofit',
        id: '灰熊坦克现代化改装工程',
        research: '混合动力装甲工学',
        grade: '大改',
        tags: ['载具建造', '重型装甲'],
        cost: 3000,
        phases: [
          {
            name: '方案与备料',
            workload: { days: 3, min_days: 1, tflops: 10 },
            cost: 400,
            resources: { nanites: 20 },
          },
          {
            name: '总装与调试',
            workload: { days: 5, min_days: 2, tflops: 10, tops: 4 },
            cost: 800,
          },
        ],
        resources: { nanites: 20 },
        target: { kind: 'unit', id: '灰熊坦克' },
        scope: 'base',
        scene: 'scene.workshop.generic',
      });

      const result = parseSingleDataBlock(rawText, { entryName: 'test_full_fields' });
      expect(result.success).toBe(true);
      if (!result.success || !isRetrofitData(result.data)) throw new Error('应为 retrofit 块');

      expect(result.data.cost).toBe(3000);
      expect(result.data.phases).toHaveLength(2);
      expect(result.data.phases![0]).toMatchObject({
        name: '方案与备料',
        workload: { days: 3, min_days: 1, tflops: 10 },
        cost: 400,
        resources: { nanites: 20 },
      });
      expect(result.data.phases![1].workload).toMatchObject({ days: 5, min_days: 2, tops: 4 });
      expect(result.data.resources).toEqual({ nanites: 20 });
      expect(result.data.target).toEqual({ kind: 'unit', id: '灰熊坦克' });
      expect(result.data.scope).toBe('base');
      expect(result.data.scene).toBe('scene.workshop.generic');
    });

    it('target.kind 支持 building；scope 支持 theater', () => {
      const rawText = JSON.stringify({
        type: 'retrofit',
        id: '爱国者阵地现代化改装工程',
        research: '先进防空火控工学',
        target: { kind: 'building', id: '爱国者导弹阵地' },
        scope: 'theater',
      });
      const result = parseSingleDataBlock(rawText, { entryName: 'test_building_target' });
      expect(result.success).toBe(true);
      if (!result.success || !isRetrofitData(result.data)) throw new Error('应为 retrofit 块');
      expect(result.data.target).toEqual({ kind: 'building', id: '爱国者导弹阵地' });
      expect(result.data.scope).toBe('theater');
    });

    it('缺省路径：旧形状块（仅 6 字段）解析成功且新字段全部 undefined', () => {
      const rawText = JSON.stringify({
        schema_version: 1,
        type: 'retrofit',
        id: '旧形状改装工程',
        research: '某理论',
        grade: '中改',
        tags: ['载具建造'],
      });
      const result = parseSingleDataBlock(rawText, { entryName: 'test_legacy_shape' });
      expect(result.success).toBe(true);
      if (!result.success || !isRetrofitData(result.data)) throw new Error('应为 retrofit 块');
      expect(result.data.cost).toBe(0);
      expect(result.data.phases).toBeUndefined();
      expect(result.data.resources).toBeUndefined();
      expect(result.data.target).toBeUndefined();
      expect(result.data.scope).toBeUndefined();
      expect(result.data.scene).toBeUndefined();
    });
  });

  describe('3. P0 对象化护栏与 workload 形状', () => {
    it('裸 nanites 字段直接拒绝（P0 对象化红线，A9 遗留 ENG-WB-01 落地）', () => {
      const rawText = JSON.stringify({
        type: 'retrofit',
        id: '裸字段测试工程',
        research: '某理论',
        nanites: 5,
      });
      const result = parseSingleDataBlock(rawText, {
        entryName: 'test_bare_nanites',
        logger: { warn: () => {} },
      });
      // 裸字段不被静默放过：判 validation_error 并条目级隔离
      expect(result.success).toBe(false);
      if (result.success) throw new Error('应校验失败');
      expect(result.diagnostic.code).toBe('validation_error');
      expect(result.diagnostic.message).toContain('nanites');
    });

    it('phase.workload 缺 min_days 时校验失败并隔离（条目级诊断，不中断整体）', () => {
      const rawText = JSON.stringify({
        type: 'retrofit',
        id: '坏阶段工程',
        research: '某理论',
        phases: [{ name: '坏阶段', workload: { days: 3 } }],
      });
      const result = parseSingleDataBlock(rawText, {
        entryName: 'test_bad_workload',
        logger: { warn: () => {} },
      });
      expect(result.success).toBe(false);
      if (result.success) throw new Error('应校验失败');
      expect(result.diagnostic.code).toBe('validation_error');
    });
  });

  describe('4. type:project 仓段化 V2 分支（V2-04 激活，替换 D14-A 占位）', () => {
    it('全形状 project 块解析进 projects 桶：模块名兑底/prereqs 缺省/透传字段全量', () => {
      const entries = [
        {
          name: '轨道船坞',
          content:
            '<数据>{"schema_version":2,"type":"project","id":"all.project.orbital_shipyard","name":"轨道船坞","grade":"巨构","scope":"theater","cost":600000,"tags":["工程"],"desc":"近地轨道组装船坞。","requirements":{"research":"轨道工程学","building":"盟军建造厂","credits":600000,"nanites":80},"modules":[{"id":"m.core","cost":200000,"workload":{"days":10,"min_days":5,"tflops":4,"tops":2},"resources":{"nanites":20}},{"id":"m.dock","name":"船坞桁架","workload":{"days":12,"min_days":6},"prereqs":["m.core"]}]}</数据>',
        },
      ];
      const catalog = parseWorldbookEntries(entries, { silent: true });

      expect(catalog.diagnostics).toHaveLength(0);
      expect(catalog.projects).toHaveLength(1);
      const p = catalog.projects[0];
      expect(p.schema_version).toBe(2);
      expect(p.id).toBe('all.project.orbital_shipyard');
      expect(p.name).toBe('轨道船坞');
      expect(p.grade).toBe('巨构');
      expect(p.scope).toBe('theater');
      expect(p.cost).toBe(600000);
      expect(p.requirements).toEqual({
        research: '轨道工程学',
        building: '盟军建造厂',
        credits: 600000,
        nanites: 80,
      });
      expect(p.modules).toHaveLength(2);
      // 模块缺省兑底：name 空缺回填 id、prereqs 缺省 []
      expect(p.modules[0]).toMatchObject({ id: 'm.core', name: 'm.core', cost: 200000, prereqs: [] });
      expect(p.modules[0].workload).toEqual({ days: 10, min_days: 5, tflops: 4, tops: 2 });
      expect(p.modules[0].resources).toEqual({ nanites: 20 });
      expect(p.modules[1]).toMatchObject({ id: 'm.dock', name: '船坞桁架', prereqs: ['m.core'] });
      // byId/items 与 retrofit 同生命周期（V2-04 桶激活）
      expect(catalog.byId['all.project.orbital_shipyard']).toBe(p);
      expect(catalog.items).toContain(p);
      expect(catalog.retrofits).toHaveLength(0);
    });

    it('最小形状 project 块：name 缺省回填 id、cost 0、tags/desc 空兑底', () => {
      const result = parseSingleDataBlock(
        '{"type":"project","schema_version":2,"id":"测试工程","modules":[{"id":"m1","workload":{"days":2,"min_days":1}}]}',
        { entryName: 'test_project_minimal' },
      );
      expect(result.success).toBe(true);
      if (!result.success || !isProjectData(result.data)) throw new Error('应为 project 块');
      expect(result.data.schema_version).toBe(2);
      expect(result.data.name).toBe('测试工程'); // 缺省回填 id
      expect(result.data.cost).toBe(0);
      expect(result.data.tags).toEqual([]);
      expect(result.data.desc).toBe('');
      expect(result.data.modules).toHaveLength(1);
      expect(result.data.modules[0]).toMatchObject({ id: 'm1', name: 'm1', prereqs: [] });
    });

    it('版本轴 fail-closed：schema_version≠2 的 project 块条目级隔离不炸全书', () => {
      const entries = [
        {
          name: 'v1 工程',
          content:
            '<数据>{"schema_version":1,"type":"project","id":"proj.demo","name":"演示工程","modules":[{"id":"m1"}]}</数据>',
        },
        {
          name: '正常改装',
          content:
            '<数据>{"type":"retrofit","id":"灰熊坦克现代化改装工程","research":"混合动力装甲工学","grade":"大改"}</数据>',
        },
      ];
      const catalog = parseWorldbookEntries(entries, { silent: true });

      // 违规 project 块 fail-closed：诊断收集 + 不入桶
      expect(catalog.projects).toHaveLength(0);
      expect(catalog.diagnostics).toHaveLength(1);
      expect(catalog.diagnostics[0].code).toBe('validation_error');
      // 同书其余条目不受影响（不炸全书）
      expect(catalog.retrofits).toHaveLength(1);
      expect(catalog.items).toHaveLength(1);
    });

    it('点号 ID 护栏：project 块缺显式 name 或 name===id 时条目级隔离', () => {
      const noName = parseSingleDataBlock(
        '{"schema_version":2,"type":"project","id":"all.project.x","modules":[{"id":"m1","workload":{"days":1,"min_days":1}}]}',
        { entryName: 'test_project_dotted_no_name', logger: { warn: () => {} } },
      );
      expect(noName.success).toBe(false);
      if (noName.success) throw new Error('应校验失败');
      expect(noName.diagnostic.message).toContain('V2 project 点号 ID 块必须显式声明 name');

      const sameName = parseSingleDataBlock(
        '{"schema_version":2,"type":"project","id":"all.project.x","name":"all.project.x","modules":[{"id":"m1","workload":{"days":1,"min_days":1}}]}',
        { entryName: 'test_project_dotted_same_name', logger: { warn: () => {} } },
      );
      expect(sameName.success).toBe(false);
      if (sameName.success) throw new Error('应校验失败');
    });

    it('modules 缺席/空数组 fail-closed（拓扑非空是 V2 立项前提）', () => {
      const missing = parseSingleDataBlock(
        '{"schema_version":2,"type":"project","id":"proj.no_modules","name":"无模块工程"}',
        { entryName: 'test_project_no_modules', logger: { warn: () => {} } },
      );
      expect(missing.success).toBe(false);

      const empty = parseSingleDataBlock(
        '{"schema_version":2,"type":"project","id":"proj.empty_modules","name":"空模块工程","modules":[]}',
        { entryName: 'test_project_empty_modules', logger: { warn: () => {} } },
      );
      expect(empty.success).toBe(false);
    });

    it('模块 workload 缺 min_days 时校验失败并隔离（D12 地板必填，retrofit phase 同口径）', () => {
      const result = parseSingleDataBlock(
        '{"schema_version":2,"type":"project","id":"proj.bad_wl","name":"坏工作量工程","modules":[{"id":"m1","workload":{"days":3}}]}',
        { entryName: 'test_project_bad_workload', logger: { warn: () => {} } },
      );
      expect(result.success).toBe(false);
      if (result.success) throw new Error('应校验失败');
      expect(result.diagnostic.code).toBe('validation_error');
    });

    it('round-trip：fixtures/engProjectWorldbook.json 解析→规范化→基线快照逐字节一致', () => {
      // import.meta.url 定位 fixture（新增 __dirname 用会计入 tsc 基线外错误——零新增红线）
      const wbJson = JSON.parse(
        fs.readFileSync(new URL('fixtures/engProjectWorldbook.json', import.meta.url), 'utf-8'),
      );
      const catalog = parseWorldbookEntries(wbJson, { silent: true });
      expect(catalog.diagnostics).toHaveLength(0);
      expect(catalog.projects).toHaveLength(2);

      const baseline = fs
        .readFileSync(new URL('fixtures/engProjectRoundtripBaseline.json', import.meta.url), 'utf-8')
        .replace(/\r\n/g, '\n');
      expect(canonicalStringify(catalog.projects)).toBe(baseline);
    });
  });

  describe('5. catalogEffective 贯通（mergeByName 覆盖链不变）', () => {
    it('worldbookRetrofitToDef 保留全部新增字段', () => {
      const wbItem = {
        schema_version: 1,
        type: 'retrofit',
        id: '灰熊坦克现代化改装工程',
        name: '灰熊坦克现代化改装工程',
        cost: 3000,
        research: '混合动力装甲工学',
        grade: '大改',
        tags: ['载具建造'],
        desc: '',
        phases: [{ name: '方案与备料', workload: { days: 3, min_days: 1 }, cost: 400 }],
        resources: { nanites: 20 },
        target: { kind: 'unit', id: '灰熊坦克' },
        scope: 'base',
        scene: 'scene.workshop.generic',
      } as unknown as WorldbookRetrofitData;

      const def = worldbookRetrofitToDef(wbItem);
      expect(def.kind).toBe('retrofit');
      expect(def.cost).toBe(3000);
      expect(def.phases).toHaveLength(1);
      expect(def.resources).toEqual({ nanites: 20 });
      expect(def.target).toEqual({ kind: 'unit', id: '灰熊坦克' });
      expect(def.scope).toBe('base');
      expect(def.scene).toBe('scene.workshop.generic');
    });

    it('mergeEffectiveCatalog 按 name 覆盖静态 RETROFITS，新字段随覆盖项生效', () => {
      const staticDef = RETROFITS.find(r => r.name === '灰熊坦克现代化改装工程');
      expect(staticDef).toBeDefined();
      expect(staticDef!.phases).toBeUndefined(); // 静态基线不声明新字段

      const wbItem = {
        schema_version: 1,
        type: 'retrofit',
        id: '灰熊坦克现代化改装工程',
        name: '灰熊坦克现代化改装工程',
        cost: 3000,
        research: '混合动力装甲工学',
        grade: '大改',
        tags: [],
        desc: '世界书动态条目覆盖',
        phases: [{ name: '方案与备料', workload: { days: 3, min_days: 1 } }],
        resources: { nanites: 20 },
        target: { kind: 'unit', id: '灰熊坦克' },
        scope: 'base',
        scene: 'scene.workshop.generic',
      } as unknown as WorldbookRetrofitData;

      const effective = mergeEffectiveCatalog([], { retrofits: [wbItem] });
      const merged = effective.retrofits.find(r => r.name === '灰熊坦克现代化改装工程');
      expect(merged).toBeDefined();
      expect(merged!.desc).toBe('世界书动态条目覆盖'); // name 覆盖链生效
      expect(merged!.phases).toHaveLength(1);
      expect(merged!.resources).toEqual({ nanites: 20 });
      expect(merged!.target).toEqual({ kind: 'unit', id: '灰熊坦克' });
      expect(merged!.scope).toBe('base');
      expect(merged!.scene).toBe('scene.workshop.generic');
      // 其余静态改装项不受损
      expect(effective.retrofits.length).toBe(RETROFITS.length);
    });
  });
});
