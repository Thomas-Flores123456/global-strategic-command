import { describe, expect, it } from 'vitest';
import { Schema } from '../core/schema';
import * as parseCommon from '../parse/parseCommon';
import * as resourceMerge from '../parse/resourceMerge';
import * as engAndDeployOrders from '../parse/engAndDeployOrders';
import * as eventDoor from '../parse/eventDoor';
import {
  ENG_VERBS,
  parseMessageText,
  parseCommon as reExportedParseCommon,
  resourceMerge as reExportedResourceMerge,
  engAndDeployOrders as reExportedEngAndDeployOrders,
  eventDoor as reExportedEventDoor,
} from '../parse/parsePipeline';

describe('DEC-PARSE-01 parsePipeline 四子模块解耦与指派/天气契约单测', () => {
  describe('1. 四子模块独立导入与核心纯函数契约', () => {
    it('parse/parseCommon 核心纯函数正常工作且被 parsePipeline 重导出', () => {
      expect(reExportedParseCommon).toBeDefined();
      expect(parseCommon.canon('  ＡＢＣ １２３  ')).toBe('abc123');
      expect(parseCommon.splitKeyVal('- "模块"： 「反射镜面A」')).toEqual({
        key: '模块',
        value: '反射镜面A',
      });
      expect(parseCommon.stripQuotes('《高压超导电网协议》')).toBe('高压超导电网协议');
      expect(parseCommon.parseNum('+1,200点')).toBe(1200);
      expect(parseCommon.extractParenQty('犀牛坦克（3辆）')).toEqual({
        name: '犀牛坦克',
        qty: 3,
      });
      expect(parseCommon.normalizeTagLine(' - 展开：基地车 ｜ 基地：北极基地 ')).toBe(
        '展开: 基地车 | 基地: 北极基地',
      );
      const ai = parseCommon.buildAlignIndex({
        names: ['太阳帆阵列'],
        aliases: { 太阳帆: '太阳帆阵列' },
      });
      expect(parseCommon.alignName('太阳帆', ai)).toEqual({
        name: '太阳帆阵列',
        hit: 'alias',
      });
    });

    it('parse/resourceMerge 资源合并与三色门校验正常工作', () => {
      expect(reExportedResourceMerge).toBeDefined();
      expect(resourceMerge.RESOURCE_PILLAR_KEYS).toContain('nanites');
      const data = Schema.parse({});
      const ctx: parseCommon.ParseCtxLike = {
        events: [],
        issues: [],
        quarantine: [],
        appliedCount: 0,
      };
      resourceMerge.applyResources(
        {
          纳米机械: { 工业纳米虫群: 120 },
          矿产: { 铁矿: -5 },
        },
        data,
        ctx,
      );
      expect(data.economy.resources?.nanites?.['工业纳米虫群']).toBe(120);
      expect(ctx.appliedCount).toBe(1);
      expect(ctx.quarantine.length).toBe(1);
    });

    it('parse/engAndDeployOrders 部署与工程令收集纯函数正常工作', () => {
      expect(reExportedEngAndDeployOrders).toBeDefined();
      expect(engAndDeployOrders.ENG_VERBS).toContain('指派');
      const data = Schema.parse({
        bases: [{ id: 'base_arctic', name: '北极基地' }],
        projects: [
          {
            id: 'proj:solar_1',
            ref: '太阳帆阵列',
            grade: '巨构',
            status: '在建',
            schema_version: 2,
            modules: [{ id: 'mod_mirror_a', name: '反射镜面A' }],
          },
        ],
      });
      const ctx: engAndDeployOrders.EngParseCtxLike = {
        events: [],
        issues: [],
        quarantine: [],
        appliedCount: 0,
        engOrders: [],
      };
      engAndDeployOrders.collectEngOrders(
        {
          指派: {
            id: '太阳帆阵列',
            模块: '反射镜面A',
            承建基地: '北极基地',
          },
        },
        data,
        ctx,
      );
      expect(ctx.quarantine).toHaveLength(0);
      expect(ctx.engOrders).toHaveLength(1);
      expect(ctx.engOrders[0]).toMatchObject({
        verb: '指派',
        id: 'proj:solar_1',
        module: '反射镜面A',
        base: 'base_arctic',
      });
    });

    it('parse/eventDoor 事件门辅助与协议索引同源归一化正常工作', () => {
      expect(reExportedEventDoor).toBeDefined();
      expect(eventDoor.EVENT_VERBS).toContain('协议发现');
      expect(eventDoor.normalizeProtocolEventLookupKey('《44·高壓超導電網協議（一）》')).toBe(
        '高压超导电网协议(一',
      );
      const res = eventDoor.resolveProtocolEventTarget('高压超导电网协议', {
        catalog: [{ id: 'proto.grid', name: '高压超导电网协议', aliases: ['超导电网'] }],
      });
      expect(res).toEqual({
        ok: true,
        protocolId: 'proto.grid',
        protocolName: '高压超导电网协议',
        aligned: false,
      });
    });
  });

  describe('2. SIM-WEATHER-01 <战况> 天气/气象字段写入 meta.weather', () => {
    it('解析 <战况> 中的 天气: "暴风雪" 正确写入 res.data.meta.weather', () => {
      const raw = [
        '<战况>',
        '日期: 1941年12月5日',
        '地点: 莫斯科北郊',
        '天气: "暴风雪"',
        '</战况>',
      ].join('\n');

      const res = parseMessageText(raw, {});
      expect(res.applied).toBe(true);
      expect(res.quarantine).toHaveLength(0);
      expect(res.data.meta.weather).toBe('暴风雪');
      expect(res.data.meta.location).toBe('莫斯科北郊');
    });

    it('兼容 气象 / 天候 / weather 别名字段写入 meta.weather', () => {
      const res1 = parseMessageText('<战况>\n气象: 极寒暴雪\n</战况>', {});
      expect(res1.data.meta.weather).toBe('极寒暴雪');

      const res2 = parseMessageText('<战况>\n天候: 晴朗\n</战况>', {});
      expect(res2.data.meta.weather).toBe('晴朗');
    });
  });

  describe('3. UTO-ALLOC-01 <工程> 指派指令解析', () => {
    const baseline = {
      bases: [
        { id: 'base_arctic', name: '北极基地' },
        { id: 'base_siberia', name: '西伯利亚基地' },
      ],
      projects: [
        {
          id: 'proj:solar_array',
          ref: '太阳帆阵列',
          grade: '巨构',
          status: '在建',
          schema_version: 2,
          modules: [{ id: 'mod_mirror_a', name: '反射镜面A', status: '未启动', base: 'base_siberia' }],
        },
      ],
    };

    it('ENG_VERBS 包含 指派 动词', () => {
      expect(ENG_VERBS).toEqual(['立项', '注资', '暂停', '恢复', '取消', '驳回', '指派']);
    });

    it('支持嵌套指派对象、顶层扁平对象与动作: 指派形态', () => {
      const raw1 = [
        '<工程>',
        '指派: 太阳帆阵列',
        '模块: 反射镜面A',
        '基地: 北极基地',
        '</工程>',
      ].join('\n');
      const res1 = parseMessageText(raw1, baseline);
      expect(res1.quarantine).toHaveLength(0);
      expect(res1.engOrders).toHaveLength(1);
      expect(res1.engOrders[0]).toMatchObject({
        verb: '指派',
        action: 'allocate',
        id: 'proj:solar_array',
        instanceId: 'proj:solar_array',
        rawName: '太阳帆阵列',
        module: '反射镜面A',
        base: 'base_arctic',
      });

      const raw2 = [
        '<工程>',
        '项目: 太阳帆阵列',
        '动作: 指派',
        '模块: 反射镜面A',
        '承建基地: 北极基地',
        '</工程>',
      ].join('\n');
      const res2 = parseMessageText(raw2, baseline);
      expect(res2.quarantine).toHaveLength(0);
      expect(res2.engOrders).toHaveLength(1);
      expect(res2.engOrders[0]).toMatchObject({
        verb: '指派',
        action: 'allocate',
        id: 'proj:solar_array',
        instanceId: 'proj:solar_array',
        rawName: '太阳帆阵列',
        module: '反射镜面A',
        base: 'base_arctic',
      });

      const raw3 = [
        '<工程>',
        '指派:',
        '  项目: 太阳帆阵列',
        '  目标模块: 反射镜面A',
        '  目标基地: 北极基地',
        '  理由: 北极电力充沛',
        '</工程>',
      ].join('\n');
      const res3 = parseMessageText(raw3, baseline);
      expect(res3.quarantine).toHaveLength(0);
      expect(res3.engOrders).toHaveLength(1);
      expect(res3.engOrders[0]).toMatchObject({
        verb: '指派',
        action: 'allocate',
        id: 'proj:solar_array',
        instanceId: 'proj:solar_array',
        rawName: '太阳帆阵列',
        module: '反射镜面A',
        base: 'base_arctic',
        reason: '北极电力充沛',
      });
    });

    it('支持简写形态并在缺字段时进入隔离区', () => {
      const rawShort = '<工程>\n指派: "太阳帆阵列 | 反射镜面A -> 北极基地"\n</工程>';
      const resShort = parseMessageText(rawShort, baseline);
      expect(resShort.quarantine).toHaveLength(0);
      expect(resShort.engOrders).toHaveLength(1);
      expect(resShort.engOrders[0]).toMatchObject({
        verb: '指派',
        action: 'allocate',
        instanceId: 'proj:solar_array',
        module: '反射镜面A',
        base: 'base_arctic',
      });

      const rawBad = '<工程>\n指派:\n  项目: 太阳帆阵列\n  模块: 反射镜面A\n</工程>';
      const resBad = parseMessageText(rawBad, baseline);
      expect(resBad.engOrders).toHaveLength(0);
      expect(resBad.quarantine).toHaveLength(1);
    });
  });
});
