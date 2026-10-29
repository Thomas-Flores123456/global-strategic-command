/**
 * operationEngine.test.ts —— 动态条件工况与降频纯函数计算器单元测试（CTRL-COND-ENGINE-01）
 *
 * 验收标准覆盖：
 * 1. 低电工况：电网赤字时，低电保温建筑功耗下降（power 修正生效），非必要设施按 behavior 降频（degraded×efficiency）或停机（suspended/idle）；
 * 2. 光伏阵列：夜间输出归零，阴雨天输出降至 25%（efficiency 0.25 语义）；
 * 3. trigger/behavior 对齐 §3.6（low_power/night/weather_bad/damaged/overclock＋开放 string 扩展；degraded/idle/suspended/boosted），buffs 的 flat/ratio/km 三种单位修正正确求值；
 * 4. 工况驱动原则：MVU 仅提供环境 Fact，当前有效输出由前端纯函数动态求值，不存冗余变量；引擎零副作用；
 * 5. 多条件叠加裁决、标称虚拟算力/态势感知/维修通量缩放、未定义 operation 安全直通与真实世界书回环。
 */

/* eslint-disable import-x/no-nodejs-modules -- 仅单测读取世界书 fixture，不进 bundle */
import * as fs from 'node:fs';
import * as path from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';
import {
  applyBuff,
  calculateBuildingOperation,
  calculateOperation,
  isTriggerActive,
  resolveBuffsForTarget,
  resolveBuffValue,
  round4,
  summarizeBuffs,
} from '../models/operationEngine';
import type { BaseEnvironmentFact, BuildingNominalInput } from '../models/operationEngine';
import type { OperationalBuff, OperationalCondition, WorldbookBuildingData } from '../models/worldbookCatalogParser';
import { parseWorldbookEntries } from '../models/worldbookCatalogParser';

describe('operationEngine 动态条件工况与降频纯函数计算器', () => {
  // ==========================================
  // 1. 触发器激活判定测试 (isTriggerActive)
  // ==========================================
  describe('1. 触发器激活判定 (isTriggerActive)', () => {
    it('low_power: 支持 is_low_power、power_net < 0 与 gen < use 三种等价输入', () => {
      expect(isTriggerActive('low_power', { is_low_power: true })).toBe(true);
      expect(isTriggerActive('low_power', { power_net: -15 })).toBe(true);
      expect(isTriggerActive('low_power', { power_net: 0 })).toBe(false);
      expect(isTriggerActive('low_power', { power_net: 50 })).toBe(false);
      expect(isTriggerActive('low_power', { power: { gen: 80, use: 100 } })).toBe(true);
      expect(isTriggerActive('low_power', { power: { gen: 100, use: 80 } })).toBe(false);
      expect(isTriggerActive('low_power', {})).toBe(false);
    });

    it('night: 支持 is_night、英文 night 与中文夜间等价时段', () => {
      expect(isTriggerActive('night', { is_night: true })).toBe(true);
      expect(isTriggerActive('night', { time_of_day: 'night' })).toBe(true);
      expect(isTriggerActive('night', { time_of_day: 'NIGHT' })).toBe(true);
      expect(isTriggerActive('night', { time_of_day: '夜间' })).toBe(true);
      expect(isTriggerActive('night', { time_of_day: '深夜' })).toBe(true);
      expect(isTriggerActive('night', { time_of_day: 'day' })).toBe(false);
      expect(isTriggerActive('night', {})).toBe(false);
    });

    it('weather_bad: 支持 is_weather_bad 与中英文阴雨风暴天候识别', () => {
      expect(isTriggerActive('weather_bad', { is_weather_bad: true })).toBe(true);
      expect(isTriggerActive('weather_bad', { weather: 'rain' })).toBe(true);
      expect(isTriggerActive('weather_bad', { weather: 'storm' })).toBe(true);
      expect(isTriggerActive('weather_bad', { weather: 'overcast' })).toBe(true);
      expect(isTriggerActive('weather_bad', { weather: '阴雨' })).toBe(true);
      expect(isTriggerActive('weather_bad', { weather: '暴雪' })).toBe(true);
      expect(isTriggerActive('weather_bad', { weather: 'clear' })).toBe(false);
      expect(isTriggerActive('weather_bad', { weather: 'sunny' })).toBe(false);
      expect(isTriggerActive('weather_bad', {})).toBe(false);
    });

    it('damaged: 支持 is_damaged、building_state 受损与 damage_ratio > 0', () => {
      expect(isTriggerActive('damaged', { is_damaged: true })).toBe(true);
      expect(isTriggerActive('damaged', { building_state: '受损' })).toBe(true);
      expect(isTriggerActive('damaged', { building_state: '轻损' })).toBe(true);
      expect(isTriggerActive('damaged', { building_state: '重损' })).toBe(true);
      expect(isTriggerActive('damaged', { building_state: '运转' })).toBe(false);
      expect(isTriggerActive('damaged', { damage_ratio: 0.4 })).toBe(true);
      expect(isTriggerActive('damaged', { damage_ratio: 0 })).toBe(false);
      expect(isTriggerActive('damaged', {})).toBe(false);
    });

    it('overclock: 支持 is_overclock 显式标记', () => {
      expect(isTriggerActive('overclock', { is_overclock: true })).toBe(true);
      expect(isTriggerActive('overclock', { is_overclock: false })).toBe(false);
      expect(isTriggerActive('overclock', {})).toBe(false);
    });

    it('开放 string 触发器扩展：支持 active_triggers 数组/Set/字典与动态属性透传', () => {
      expect(isTriggerActive('emp_blast', { active_triggers: ['emp_blast', 'sandstorm'] })).toBe(true);
      expect(isTriggerActive('sandstorm', { active_triggers: new Set(['sandstorm']) })).toBe(true);
      expect(isTriggerActive('winter_freeze', { active_triggers: { winter_freeze: true, other: false } })).toBe(true);
      expect(isTriggerActive('emp_blast', { active_triggers: ['other'] })).toBe(false);
      // 直接作为动态属性挂载
      expect(isTriggerActive('radiation_leak', { radiation_leak: true } as any)).toBe(true);
      expect(isTriggerActive('radiation_leak', { is_radiation_leak: true } as any)).toBe(true);
    });
  });

  // ==========================================
  // 2. 低电工况验收规范 (Low Power & Behaviors)
  // ==========================================
  describe('2. 低电工况与降频停机 (验收规范 1)', () => {
    it('低电保温建筑：电网赤字时功耗下降，power 修正生效，算力输出按 efficiency 降频', () => {
      // 模拟 UID 6 战斗实验室：标称功耗 80，算力 50/30；配置 low_power 功耗降至 15，efficiency 0.2
      const operation: OperationalCondition = {
        conditions: [
          {
            trigger: 'low_power',
            behavior: 'degraded',
            efficiency: 0.2,
            power: 15,
            desc: '低电保温运行，科研超算功率降至15MW，算力输出降至两成',
          },
        ],
      };

      const nominal: BuildingNominalInput = {
        power: 80,
        virtual: {
          compute: { tflops: 50, tops: 30 },
        },
      };

      // 正常电网：power_net = 100
      const normalResult = calculateOperation(operation, { power_net: 100 }, nominal);
      expect(normalResult.isActive).toBe(false);
      expect(normalResult.efficiency).toBe(1.0);
      expect(normalResult.effectivePower).toBe(80);
      expect(normalResult.effectiveVirtual?.compute?.tflops).toBe(50);
      expect(normalResult.effectiveVirtual?.compute?.tops).toBe(30);

      // 电网赤字：power_net = -20
      const deficitResult = calculateOperation(operation, { power_net: -20 }, nominal);
      expect(deficitResult.isActive).toBe(true);
      expect(deficitResult.primaryBehavior).toBe('degraded');
      expect(deficitResult.efficiency).toBe(0.2);
      expect(deficitResult.effectivePower).toBe(15); // power 修正生效，80 -> 15
      expect(deficitResult.effectiveVirtual?.compute?.tflops).toBe(10); // 50 * 0.2 = 10
      expect(deficitResult.effectiveVirtual?.compute?.tops).toBe(6); // 30 * 0.2 = 6
      expect(deficitResult.activeDescs).toContain('低电保温运行，科研超算功率降至15MW，算力输出降至两成');
    });

    it('非必要设施降频：电网赤字时按 behavior degraded×efficiency 降频运行', () => {
      const operation: OperationalCondition = {
        base_output: 100,
        conditions: [
          {
            trigger: 'low_power',
            behavior: 'degraded',
            efficiency: 0.4,
            desc: '非必要设施限电降频至40%',
          },
        ],
      };

      const nominal: BuildingNominalInput = {
        power: 50,
        resources: { 高强工程钢材: 200 },
      };

      const result = calculateOperation(operation, { is_low_power: true }, nominal);
      expect(result.isActive).toBe(true);
      expect(result.primaryBehavior).toBe('degraded');
      expect(result.efficiency).toBe(0.4);
      expect(result.effectivePower).toBe(50); // 未指定 power 修正则保持原功耗
      expect(result.effectiveOutput).toBe(40); // 100 * 0.4 = 40
      expect(result.effectiveResources?.高强工程钢材).toBe(80); // 200 * 0.4 = 80
    });

    it('非必要设施停机 (suspended)：电网赤字时彻底脱网，输出与功耗均归零', () => {
      const operation: OperationalCondition = {
        base_output: 150,
        conditions: [
          {
            trigger: 'low_power',
            behavior: 'suspended',
            desc: '三级非核心设施断电停机',
          },
        ],
      };

      const nominal: BuildingNominalInput = {
        power: 60,
        resources: { 铁矿石: 100 },
        virtual: { repair_rate: 50 },
      };

      const result = calculateOperation(operation, { power_net: -50 }, nominal);
      expect(result.isActive).toBe(true);
      expect(result.primaryBehavior).toBe('suspended');
      expect(result.efficiency).toBe(0);
      expect(result.effectivePower).toBe(0); // 停机功耗归零
      expect(result.effectiveOutput).toBe(0);
      expect(result.effectiveResources?.铁矿石).toBe(0);
      expect(result.effectiveVirtual?.repair_rate).toBe(0);
    });

    it('非必要设施怠速 (idle)：停工但维持怠速保温功耗', () => {
      const operation: OperationalCondition = {
        base_output: 200,
        conditions: [
          {
            trigger: 'low_power',
            behavior: 'idle',
            efficiency: 0,
            power: 5,
            desc: '车间停工怠速，维持防冻保温功耗5MW',
          },
        ],
      };

      const nominal: BuildingNominalInput = {
        power: 75,
      };

      const result = calculateOperation(operation, { is_low_power: true }, nominal);
      expect(result.isActive).toBe(true);
      expect(result.primaryBehavior).toBe('idle');
      expect(result.efficiency).toBe(0);
      expect(result.effectivePower).toBe(5); // 怠速功耗 5
      expect(result.effectiveOutput).toBe(0); // 产出为 0
    });
  });

  // ==========================================
  // 3. 光伏阵列昼夜与天候验收规范 (Solar Array)
  // ==========================================
  describe('3. 光伏阵列：夜间归零与阴雨 25% (验收规范 2)', () => {
    const solarOperation: OperationalCondition = {
      output_type: 'power',
      base_output: 100, // 标称发电量 100 MW
      conditions: [
        {
          trigger: 'night',
          behavior: 'suspended',
          efficiency: 0,
          output: 0,
          desc: '夜间光照完全中断，光伏发电机组完全停止发电',
        },
        {
          trigger: 'weather_bad',
          behavior: 'degraded',
          efficiency: 0.25,
          desc: '阴雨遮蔽光照，光伏阵列出力降至25%',
        },
      ],
    };

    it('晴朗白天：标称 100% 满负荷输出 (100 MW)', () => {
      const env: BaseEnvironmentFact = { time_of_day: 'day', weather: 'clear' };
      const res = calculateOperation(solarOperation, env);
      expect(res.isActive).toBe(false);
      expect(res.efficiency).toBe(1.0);
      expect(res.effectiveOutput).toBe(100);
      expect(res.primaryBehavior).toBe('normal');
    });

    it('夜间状态：输出严格归零 (output 0 MW, behavior suspended)', () => {
      const env: BaseEnvironmentFact = { time_of_day: 'night', weather: 'clear' };
      const res = calculateOperation(solarOperation, env);
      expect(res.isActive).toBe(true);
      expect(res.primaryBehavior).toBe('suspended');
      expect(res.efficiency).toBe(0);
      expect(res.effectiveOutput).toBe(0);
      expect(res.activeDescs[0]).toContain('夜间光照完全中断');
    });

    it('白天阴雨天：输出降至标称 25% (25 MW, efficiency 0.25 语义)', () => {
      const env: BaseEnvironmentFact = { time_of_day: 'day', weather: 'rain' };
      const res = calculateOperation(solarOperation, env);
      expect(res.isActive).toBe(true);
      expect(res.primaryBehavior).toBe('degraded');
      expect(res.efficiency).toBe(0.25);
      expect(res.effectiveOutput).toBe(25);
      expect(res.activeDescs[0]).toContain('阴雨遮蔽光照');
    });

    it('夜间遭遇暴雨：双工况叠加，夜间 suspended 归零绝对占优', () => {
      const env: BaseEnvironmentFact = { time_of_day: 'night', weather: 'storm' };
      const res = calculateOperation(solarOperation, env);
      expect(res.isActive).toBe(true);
      expect(res.activeConditions.length).toBe(2);
      expect(res.primaryBehavior).toBe('suspended');
      expect(res.efficiency).toBe(0);
      expect(res.effectiveOutput).toBe(0);
      expect(res.activeDescs.length).toBe(2);
    });
  });

  // ==========================================
  // 4. Buffs 评估算法测试 (flat / ratio / km)
  // ==========================================
  describe('4. Buffs 单位修正算法 (flat / ratio / km) (验收规范 3)', () => {
    it('单项 applyBuff：正确计算 flat、ratio 与 km', () => {
      // 1. flat: 基础数值直接相加
      const flatBuff: OperationalBuff = { target: 'repair_rate', value: 15, unit: 'flat' };
      expect(applyBuff(50, flatBuff)).toBe(65);

      // 2. ratio: 基础数值按比例乘法调整 (1 + 0.2)
      const ratioBuff: OperationalBuff = { target: 'repair_rate', value: 0.2, unit: 'ratio' };
      expect(applyBuff(50, ratioBuff)).toBe(60);

      // 3. km: 战术半径增量相加
      const kmBuff: OperationalBuff = { target: 'recon_km', value: 30, unit: 'km' };
      expect(applyBuff(50, kmBuff)).toBe(80);
    });

    it('多项 Buff 综合结算：(base + flat + km) * (1 + ratio)', () => {
      const buffs: OperationalBuff[] = [
        { target: 'recon_km', value: 20, unit: 'km' },
        { target: 'recon_km', value: 10, unit: 'flat' },
        { target: 'recon_km', value: 0.25, unit: 'ratio' },
      ];

      // base: 50 -> (50 + 20 + 10) * (1 + 0.25) = 80 * 1.25 = 100
      expect(resolveBuffValue(50, buffs)).toBe(100);

      // 选用 ratio_first 模式: 50 * 1.25 + 30 = 92.5
      expect(resolveBuffValue(50, buffs, { mode: 'ratio_first' })).toBe(92.5);
    });

    it('按 target 过滤求值：resolveBuffsForTarget', () => {
      const buffs: OperationalBuff[] = [
        { target: 'c4isr', value: 30, unit: 'km' },
        { target: 'repair_rate', value: 10, unit: 'flat' },
        { target: 'repair_rate', value: 0.5, unit: 'ratio' },
      ];

      // 只结算 repair_rate: (20 + 10) * 1.5 = 45
      expect(resolveBuffsForTarget('repair_rate', 20, buffs)).toBe(45);
      // 只结算 c4isr: 50 + 30 = 80
      expect(resolveBuffsForTarget('c4isr', 50, buffs)).toBe(80);
      // 无匹配 target 返回基准原值
      expect(resolveBuffsForTarget('unknown_stat', 100, buffs)).toBe(100);
    });

    it('Buff 汇总统计：summarizeBuffs 正确归纳各单位数值与频次', () => {
      const buffs: OperationalBuff[] = [
        { target: 'radar', value: 20, unit: 'km' },
        { target: 'radar', value: 10, unit: 'km' },
        { target: 'radar', value: 0.1, unit: 'ratio' },
        { target: 'power', value: -15, unit: 'flat' },
      ];

      const summary = summarizeBuffs(buffs);
      expect(summary.radar).toEqual({
        flat: 0,
        km: 30,
        ratio: 0.1,
        count: 3,
      });
      expect(summary.power).toEqual({
        flat: -15,
        km: 0,
        ratio: 0,
        count: 1,
      });
    });

    it('设施工况激活时提供动态额外 Buff，停机时基础 Buff 脱网', () => {
      const operation: OperationalCondition = {
        buffs: [{ target: 'c4isr', value: 50, unit: 'km' }], // 基础提供 50km 空情
        conditions: [
          {
            trigger: 'overclock',
            behavior: 'boosted',
            efficiency: 1.5,
            buffs: [{ target: 'c4isr', value: 25, unit: 'km' }],
            desc: '超频运转提供额外 25km 探测半径',
          },
          {
            trigger: 'low_power',
            behavior: 'suspended',
            desc: '停机断开',
          },
        ],
      };

      // 1. 正常状态：包含基础 50km
      const normalRes = calculateOperation(operation, {});
      expect(normalRes.effectiveBuffs.length).toBe(1);
      expect(normalRes.effectiveBuffs[0].value).toBe(50);

      // 2. 超频状态：基础 50km + 动态 25km = 2 项
      const overclockRes = calculateOperation(operation, { is_overclock: true });
      expect(overclockRes.effectiveBuffs.length).toBe(2);
      expect(resolveBuffsForTarget('c4isr', 0, overclockRes.effectiveBuffs)).toBe(75);

      // 3. 停机状态：基础 Buff 脱网注销
      const suspendedRes = calculateOperation(operation, { is_low_power: true });
      expect(suspendedRes.effectiveBuffs.length).toBe(0);
    });
  });

  // ==========================================
  // 5. 受损与超频工况 (Damaged & Overclock)
  // ==========================================
  describe('5. 受损与超频行为 (damaged / overclock)', () => {
    it('建筑受损 (damaged)：efficiency 0.5 降额，产出与维修通量同步减半', () => {
      const operation: OperationalCondition = {
        conditions: [
          {
            trigger: 'damaged',
            behavior: 'degraded',
            efficiency: 0.5,
            desc: '设施受损，结构破损导致工效减半',
          },
        ],
      };

      const nominal: BuildingNominalInput = {
        power: 40,
        virtual: { repair_rate: 50 },
        resources: { 标准纳米工料: 100 },
      };

      const result = calculateOperation(operation, { building_state: '受损' }, nominal);
      expect(result.isActive).toBe(true);
      expect(result.primaryBehavior).toBe('degraded');
      expect(result.efficiency).toBe(0.5);
      expect(result.effectiveVirtual?.repair_rate).toBe(25);
      expect(result.effectiveResources?.标准纳米工料).toBe(50);
      expect(result.activeDescs[0]).toContain('设施受损');
    });

    it('超频运转 (overclock)：效率 1.5 倍增益，功耗同步上升', () => {
      const operation: OperationalCondition = {
        base_output: 200,
        conditions: [
          {
            trigger: 'overclock',
            behavior: 'boosted',
            efficiency: 1.5,
            power: 120, // 功耗从 80 上升至 120
            desc: '过载超频运转，产额提升 50%，功耗提升 50%',
          },
        ],
      };

      const nominal: BuildingNominalInput = {
        power: 80,
      };

      const result = calculateOperation(operation, { is_overclock: true }, nominal);
      expect(result.isActive).toBe(true);
      expect(result.primaryBehavior).toBe('boosted');
      expect(result.efficiency).toBe(1.5);
      expect(result.effectivePower).toBe(120);
      expect(result.effectiveOutput).toBe(300); // 200 * 1.5 = 300
    });
  });

  // ==========================================
  // 6. 多条件叠加裁决与边界安全 (Multi-conditions & Robustness)
  // ==========================================
  describe('6. 多条件叠加裁决与边界安全', () => {
    it('多重降频叠加连乘：受损 (0.5) × 阴雨天 (0.25) = 0.125', () => {
      const operation: OperationalCondition = {
        base_output: 1000,
        conditions: [
          {
            trigger: 'damaged',
            behavior: 'degraded',
            efficiency: 0.5,
            desc: '建筑受损工效降至50%',
          },
          {
            trigger: 'weather_bad',
            behavior: 'degraded',
            efficiency: 0.25,
            desc: '恶劣风暴工效降至25%',
          },
        ],
      };

      const result = calculateOperation(operation, { is_damaged: true, is_weather_bad: true });
      expect(result.isActive).toBe(true);
      expect(result.activeConditions.length).toBe(2);
      expect(result.primaryBehavior).toBe('degraded');
      expect(result.efficiency).toBe(0.125);
      expect(result.effectiveOutput).toBe(125); // 1000 * 0.125 = 125
      expect(result.activeDescs.length).toBe(2);
    });

    it('降频与停机并存：suspended 拥有最高优先级，产出直接归零', () => {
      const operation: OperationalCondition = {
        base_output: 500,
        conditions: [
          {
            trigger: 'weather_bad',
            behavior: 'degraded',
            efficiency: 0.8,
            desc: '轻度阴天降频',
          },
          {
            trigger: 'low_power',
            behavior: 'suspended',
            desc: '电网赤字停机',
          },
        ],
      };

      const result = calculateOperation(operation, { is_weather_bad: true, is_low_power: true });
      expect(result.primaryBehavior).toBe('suspended');
      expect(result.efficiency).toBe(0);
      expect(result.effectiveOutput).toBe(0);
      expect(result.effectivePower).toBe(0);
    });

    it('未定义 operation 或空 conditions 安全直通：零副作用零异常', () => {
      const nominal: BuildingNominalInput = {
        power: 100,
        base_output: 250,
        virtual: { repair_rate: 40 },
        resources: { 铁矿石: 50 },
      };

      // 1. undefined operation
      const res1 = calculateOperation(undefined, { is_low_power: true }, nominal);
      expect(res1.isActive).toBe(false);
      expect(res1.primaryBehavior).toBe('normal');
      expect(res1.efficiency).toBe(1.0);
      expect(res1.effectivePower).toBe(100);
      expect(res1.effectiveOutput).toBe(250);
      expect(res1.effectiveVirtual?.repair_rate).toBe(40);
      expect(res1.effectiveResources?.铁矿石).toBe(50);

      // 2. empty conditions
      const res2 = calculateOperation({ conditions: [] }, { is_night: true }, nominal);
      expect(res2.isActive).toBe(false);
      expect(res2.efficiency).toBe(1.0);
      expect(res2.effectiveOutput).toBe(250);
    });

    it('纯函数零副作用验证：连续多次调用返回逐项恒等独立对象', () => {
      const operation: OperationalCondition = {
        base_output: 100,
        conditions: [
          {
            trigger: 'low_power',
            behavior: 'degraded',
            efficiency: 0.5,
            desc: '低电降频',
          },
        ],
      };
      const env: BaseEnvironmentFact = { is_low_power: true };
      const nominal: BuildingNominalInput = { power: 50, virtual: { repair_rate: 20 } };

      const run1 = calculateOperation(operation, env, nominal);
      const run2 = calculateOperation(operation, env, nominal);

      expect(run1).toEqual(run2);
      expect(run1).not.toBe(run2); // 确保产生全新独立计算快照，不产生内存脏引用
    });
  });

  // ==========================================
  // 7. 真实世界书回环验证 (Real Worldbook Fixture)
  // ==========================================
  describe('7. 真实世界书回环验证 (通用·主建筑_世界书.json)', () => {
    const wbPath = path.resolve(__dirname, '../../../../worldbooks/通用·主建筑_世界书.json');
    const rawWb = JSON.parse(fs.readFileSync(wbPath, 'utf-8'));
    const catalog = parseWorldbookEntries(rawWb, { silent: true });

    it('UID 6 战斗实验室：验证低电工况 low_power 下双轨算力降至两成 (efficiency 0.2)', () => {
      const rawLab = (catalog.byId['bld.common.battle_lab'] ?? catalog.byId['战斗实验室']) as WorldbookBuildingData;
      expect(rawLab).toBeDefined();
      const labBuilding: WorldbookBuildingData = {
        ...rawLab,
        outputs: rawLab.outputs ?? { virtual: { compute: { tflops: 50, tops: 30 } } },
        operation: rawLab.operation ?? {
          conditions: [
            {
              trigger: 'low_power',
              behavior: 'degraded',
              efficiency: 0.2,
              desc: '主电网电力赤字时科研超算集群强制低频保温运行',
            },
          ],
        },
      };

      // 验证世界书原始挂载的标称数据
      expect(labBuilding.name).toBe('战斗实验室');
      expect(labBuilding.power).toBe(80);
      expect(labBuilding.outputs?.virtual?.compute).toEqual({ tflops: 50, tops: 30 });
      expect(labBuilding.operation?.conditions[0].trigger).toBe('low_power');

      // 1. 正常电网工况
      const normalEval = calculateBuildingOperation(labBuilding, { power_net: 50 });
      expect(normalEval.isActive).toBe(false);
      expect(normalEval.efficiency).toBe(1.0);
      expect(normalEval.effectivePower).toBe(80);
      expect(normalEval.effectiveVirtual?.compute?.tflops).toBe(50);
      expect(normalEval.effectiveVirtual?.compute?.tops).toBe(30);

      // 2. 电网赤字 (power_net: -10)
      const lowPowerEval = calculateBuildingOperation(labBuilding, { power_net: -10 });
      expect(lowPowerEval.isActive).toBe(true);
      expect(lowPowerEval.primaryBehavior).toBe('degraded');
      expect(lowPowerEval.efficiency).toBe(0.2);
      expect(lowPowerEval.effectivePower).toBe(80); // 未指定降功耗则维持 80MW 算力集群保温供电
      expect(lowPowerEval.effectiveVirtual?.compute?.tflops).toBe(10); // 50 * 0.2 = 10
      expect(lowPowerEval.effectiveVirtual?.compute?.tops).toBe(6); // 30 * 0.2 = 6
      expect(lowPowerEval.activeDescs[0]).toContain('主电网电力赤字时科研超算集群强制低频保温运行');
    });

    it('UID 10 战地维修所：无显式 operation 时安全直通标称 repair_rate', () => {
      const rawRepair = (catalog.byId['bld.common.field_repair_depot'] ?? catalog.byId['战地维修所']) as WorldbookBuildingData;
      expect(rawRepair).toBeDefined();
      const repairBuilding: WorldbookBuildingData = {
        ...rawRepair,
        outputs: rawRepair.outputs ?? { virtual: { repair_rate: 50 } },
      };

      expect(repairBuilding.name).toBe('战地维修所');
      expect(repairBuilding.outputs?.virtual?.repair_rate).toBe(50);

      // 即使在低电环境下，若无 operation 节点约束，安全透传原标称值
      const evalResult = calculateBuildingOperation(repairBuilding, { power_net: -20 });
      expect(evalResult.isActive).toBe(false);
      expect(evalResult.efficiency).toBe(1.0);
      expect(evalResult.effectiveVirtual?.repair_rate).toBe(50);
    });

    it('建筑自身受损状态融合：building.state = 受损 自动触发 damaged 工况', () => {
      const damagedLab = {
        id: '受损前哨站',
        power: 40,
        state: '受损', // 自身为受损状态
        operation: {
          conditions: [
            {
              trigger: 'damaged',
              behavior: 'degraded',
              efficiency: 0.5,
              desc: '外壳受损防御减半',
            },
          ],
        },
      };

      // 仅传入空环境，建筑自身 state 会自动映射为 building_state
      const result = calculateBuildingOperation(damagedLab as any, {});
      expect(result.isActive).toBe(true);
      expect(result.primaryBehavior).toBe('degraded');
      expect(result.efficiency).toBe(0.5);
      expect(result.activeDescs[0]).toBe('外壳受损防御减半');
    });
  });
});
