/**
 * timezoneWeatherAndBuffs.test.ts —— FD-26 多基地局部天气与标准时区体系及全系统 Buff/Debuff 硬数值约束专项测试
 *
 * 覆盖：
 * 1. 首基地恒定标准时区 0，第 2/3 基地通过 <事件> MCV展开 或 <态势> 设定 时区: +3 / -5 后的本地时间、跨日与昼夜相位推导；
 * 2. 12 项标准预设天气白名单归一化、LLM 在 <态势> 按需更新单基地天气（未提及基地保持原天气）、月球/轨道基地恒定 真空无气象、局部天气对资金链的独立折减；
 * 3. 副官 6 大专长与磨合 8 大惩罚在 settleFloor 中的硬数值生效及 base vs theater 作用域隔离。
 */

import { describe, expect, it } from 'vitest';
import { Schema, type StatData } from '../core/schema';
import {
  CANONICAL_WEATHER_PRESETS,
  inferBaseSiteType,
  normalizeCanonicalWeather,
  parseTimezoneOffset,
  resolveBaseLocalClock,
  resolveEffectiveBaseWeather,
} from '../engines/timezoneWeatherEngine';
import { withWeatherView } from '../engines/operationEngine';
import { evaluateCommandHQModifiers } from '../engines/settleFloorPhases';
import { makeTxnEffFor, resolveEffectiveBasePower } from '../engines/settleFloorHelpers';
import { settleFloor } from '../engines/settleFloor';
import { parseMessageText } from '../parse/parsePipeline';

function makeBaseState(overrides: Partial<StatData> = {}): StatData {
  return Schema.parse({
    meta: {
      date: '1972年10月3日',
      weather: '晴',
      location: '北极圈',
      phase: '基地建设',
      day_count: 10,
    },
    clock: {
      day: 10,
      time: '08:00',
    },
    economy: {
      credits: 10000,
      credits_daily: 0,
      chains: [],
    },
    bases: [
      {
        id: 'base_north',
        name: '北坡主基地',
        location: '北极圈内陆峡谷',
        status: '运转中',
        power: { gen: 200, use: 100 },
        buildings: [
          { name: '苏联建造厂', state: '运转' },
          { name: '苏联战车工厂', state: '运转' },
          { name: '苏联维修工坊', state: '运转' },
          { name: '苏联作战实验室', state: '运转' },
        ],
        defenses: [],
        garrison: [],
      },
      {
        id: 'base_east',
        name: '东海前哨',
        location: '赤道滨海文昌滩头',
        status: '运转中',
        tz_offset: 3,
        weather: '晴',
        site_type: 'equatorial_coastal',
        power: { gen: 200, use: 100 },
        buildings: [
          { name: '盟军建造厂', state: '运转' },
          { name: '盟军战车工厂', state: '运转' },
        ],
        defenses: [],
        garrison: [],
      },
      {
        id: 'base_moon',
        name: '广寒宫月面基地',
        location: '月球南极沙克尔顿环形山',
        status: '运转中',
        site_type: 'lunar_surface',
        power: { gen: 300, use: 100 },
        buildings: [{ name: '月面建造厂', state: '运转' }],
        defenses: [],
        garrison: [],
      },
    ],
    forces: {
      girls: [
        {
          name: '米샤',
          model: '苏联MCV',
          hp: '完好',
          mood: 80,
          bond: '信赖',
          location: '北坡主基地',
          traits: [],
        },
        { name: '伊娃', hp: '完好' },
        { name: '百合子', hp: '完好' },
        { name: '谭雅', hp: '完好' },
        { name: '演训副官', hp: '完好' },
      ],
      troops: {},
      vehicles: ['MCV（盟军）', 'MCV（盟军）'],
    },
    tech: {
      unlocked_factions: ['苏联', '盟军'],
      done: ['建造厂', '发电厂', '战车工厂', '作战实验室'],
    },
    protocol_points: 10,
    protocols: [],
    queues: [],
    ...overrides,
  });
}

describe('FD-26 · 一、首座基地标准时区与多基地本地时钟推导（D-TZ-1）', () => {
  it('parseTimezoneOffset：第一座基地恒定返回 0，其余基地支持正负数字与中英文时差表达并夹紧在 [-12, 14]', () => {
    expect(parseTimezoneOffset('+8', true)).toBe(0);
    expect(parseTimezoneOffset(-5, true)).toBe(0);
    expect(parseTimezoneOffset(undefined, true)).toBe(0);

    expect(parseTimezoneOffset(3, false)).toBe(3);
    expect(parseTimezoneOffset('-5', false)).toBe(-5);
    expect(parseTimezoneOffset('UTC+3', false)).toBe(3);
    expect(parseTimezoneOffset('标准时-4h', false)).toBe(-4);
    expect(parseTimezoneOffset('东三区', false)).toBe(3);
    expect(parseTimezoneOffset('西五区', false)).toBe(-5);
    expect(parseTimezoneOffset(99, false)).toBe(14);
    expect(parseTimezoneOffset(-99, false)).toBe(-12);
  });

  it('resolveBaseLocalClock：推导首基地标准时、跨日偏移（dayShift）与四档昼夜相位（含太空恒照与夜间暴露减免）', () => {
    // 1. 首基地：忽略传入的 tzOffsetHours，恒定 标准时 (±0h)
    const firstClock = resolveBaseLocalClock({ day: 10, time: '08:30' }, 5, { isFirstBase: true });
    expect(firstClock.effectiveOffset).toBe(0);
    expect(firstClock.localTimeText).toBe('08:30');
    expect(firstClock.dayShift).toBe(0);
    expect(firstClock.tzBadgeText).toBe('标准时 (±0h)');
    expect(firstClock.daylightPhase).toBe('day');
    expect(firstClock.daylightLabel).toBe('☀️ 白昼');
    expect(firstClock.nightExposureMultiplier).toBe(1.0);

    // 2. 东海基地（+3h）：全局 22:30 -> 本地次日 01:30（夜间，暴露增量 ×0.85）
    const eastNight = resolveBaseLocalClock({ day: 10, time: '22:30' }, 3, { isFirstBase: false });
    expect(eastNight.effectiveOffset).toBe(3);
    expect(eastNight.localTimeText).toBe('01:30');
    expect(eastNight.dayShift).toBe(1);
    expect(eastNight.tzBadgeText).toBe('标准时 +3h');
    expect(eastNight.daylightPhase).toBe('night');
    expect(eastNight.daylightLabel).toBe('🌙 夜间');
    expect(eastNight.nightExposureMultiplier).toBe(0.85);

    // 3. 西线基地（-5h）：全局 02:15 -> 本地前一日 21:15（dayShift = -1，夜间）
    const westPrevDay = resolveBaseLocalClock({ day: 10, time: '02:15' }, -5, { isFirstBase: false });
    expect(westPrevDay.localTimeText).toBe('21:15');
    expect(westPrevDay.dayShift).toBe(-1);
    expect(westPrevDay.tzBadgeText).toBe('标准时 -5h');
    expect(westPrevDay.daylightPhase).toBe('night');

    // 4. 晨昏相位（06:00~07:59 / 18:00~19:59）
    const dawnClock = resolveBaseLocalClock({ day: 10, time: '06:45' }, 0, { isFirstBase: true });
    expect(dawnClock.daylightPhase).toBe('dawn_dusk');
    expect(dawnClock.daylightLabel).toBe('🌅 晨昏');

    // 5. 月球/轨道基地：恒为 space_eternal ☀️ 太空恒照
    const lunarClock = resolveBaseLocalClock({ day: 10, time: '02:00' }, 0, {
      isFirstBase: false,
      siteType: 'lunar_surface',
    });
    expect(lunarClock.daylightPhase).toBe('space_eternal');
    expect(lunarClock.daylightLabel).toBe('☀️ 太空恒照');
    expect(lunarClock.nightExposureMultiplier).toBe(1.0);
  });

  it('<事件> MCV展开 与 <态势>：首基地强制 tz_offset=0，第 2/3 基地写入 tz_offset / weather / site_type，旧档零多余键', () => {
    // 场景 A：空基地列表下首座基地 MCV 展开即使声明 时区: +5 也强制锁定为 0
    const emptyBasesState = makeBaseState({ bases: [] });
    const rawFirstDeploy = `
<事件>
- {类型: MCV展开, 载具: MCV（盟军）, 新基地: 首座标准基地, 位置: 乌拉尔山脉, 时区: +5, 天气: 大雾, 选址: 内陆峡谷}
</事件>
<timePast>1 H</timePast>
`;
    const parsedFirst = parseMessageText(rawFirstDeploy, emptyBasesState);
    const settledFirst = settleFloor(emptyBasesState, parsedFirst.data, rawFirstDeploy, {
      deployOrders: parsedFirst.deployOrders,
      eventDeclarations: parsedFirst.eventDeclarations,
    });
    expect(settledFirst.data.bases.length).toBe(1);
    expect(settledFirst.data.bases[0].name).toBe('首座标准基地');
    expect(settledFirst.data.bases[0].tz_offset).toBe(0);
    expect(settledFirst.data.bases[0].weather).toBe('大雾');
    expect(settledFirst.data.bases[0].site_type).toBe('inland_canyon');

    // 场景 B：已有首基地时，第 2 座基地通过 <事件> MCV展开 设定 时区: -5, 天气: 雷暴, 选址: 海基平台
    const rawSecondDeploy = `
<事件>
- {类型: MCV展开, 载具: MCV（盟军）, 新基地: 大西洋海基前哨, 位置: 北大西洋公海, 时区: -5, 天气: 雷雨, 选址: 海基平台}
</事件>
<timePast>1 H</timePast>
`;
    const parsedSecond = parseMessageText(rawSecondDeploy, settledFirst.data);
    const settledSecond = settleFloor(settledFirst.data, parsedSecond.data, rawSecondDeploy, {
      deployOrders: parsedSecond.deployOrders,
      eventDeclarations: parsedSecond.eventDeclarations,
    });
    expect(settledSecond.data.bases.length).toBe(2);
    const secondBase = settledSecond.data.bases[1];
    expect(secondBase.name).toBe('大西洋海基前哨');
    expect(secondBase.tz_offset).toBe(-5);
    expect(secondBase.weather).toBe('雷暴');
    expect(secondBase.site_type).toBe('sea_platform');
  });
});

describe('FD-26 · 二、12 项标准天气预设白名单、按需局部更新与资金链分基地独立折减（D-WTH-1）', () => {
  it('normalizeCanonicalWeather：12 项白名单全覆盖且同义词精准归一', () => {
    expect(CANONICAL_WEATHER_PRESETS).toEqual([
      '晴',
      '多云',
      '阴',
      '小雨',
      '大雾',
      '暴雨',
      '雷暴',
      '暴风雪',
      '强台风',
      '沙尘暴',
      '强磁暴',
      '真空无气象',
    ]);
    expect(normalizeCanonicalWeather('晴朗')).toBe('晴');
    expect(normalizeCanonicalWeather('少云')).toBe('多云');
    expect(normalizeCanonicalWeather('阴沉')).toBe('阴');
    expect(normalizeCanonicalWeather('阵雨')).toBe('小雨');
    expect(normalizeCanonicalWeather('浓雾')).toBe('大雾');
    expect(normalizeCanonicalWeather('强降雨')).toBe('暴雨');
    expect(normalizeCanonicalWeather('强雷暴')).toBe('雷暴');
    expect(normalizeCanonicalWeather('极寒暴雪')).toBe('暴风雪');
    expect(normalizeCanonicalWeather('超强台风')).toBe('强台风');
    expect(normalizeCanonicalWeather('黑风暴')).toBe('沙尘暴');
    expect(normalizeCanonicalWeather('辐射风暴')).toBe('强磁暴');
    expect(normalizeCanonicalWeather('月面真空')).toBe('真空无气象');
    expect(normalizeCanonicalWeather('')).toBe('');
  });

  it('inferBaseSiteType：按基地显式 site_type 或名称+位置智能推导选址类型', () => {
    expect(inferBaseSiteType({ name: '广寒宫', location: '月球南极沙克尔顿环形山' })).toBe('lunar_surface');
    expect(inferBaseSiteType({ name: '天穹一号', location: '近地轨道空间站船坞' })).toBe('orbital_dock');
    expect(inferBaseSiteType({ name: '深蓝前哨', location: '太平洋半潜平台' })).toBe('sea_platform');
    expect(inferBaseSiteType({ name: '南海基地', location: '文昌赤道滨海发射场' })).toBe('equatorial_coastal');
    expect(inferBaseSiteType({ name: '凛冬要塞', location: '勘察加极地冻土带' })).toBe('high_latitude');
    expect(inferBaseSiteType({ name: '内陆指挥所', location: '乌拉尔山谷' })).toBe('inland_canyon');
  });

  it('<态势> 按需更新单基地天气：未提及天气的基地保持原天气，未设新字段的旧档基地零新增键', () => {
    const prev = makeBaseState({
      bases: [
        {
          id: 'base_north',
          name: '北坡主基地',
          location: '北极圈',
          status: '运转中',
          weather: '暴风雪',
          power: { gen: 100, use: 50 },
          buildings: [],
          defenses: [],
          garrison: [],
        },
        {
          id: 'base_east',
          name: '东海前哨',
          location: '东海滩头',
          status: '运转中',
          weather: '晴',
          tz_offset: 3,
          power: { gen: 100, use: 50 },
          buildings: [],
          defenses: [],
          garrison: [],
        },
        {
          id: 'base_legacy',
          name: '旧档基地',
          location: '腹地',
          status: '运转中',
          power: { gen: 80, use: 40 },
          buildings: [],
          defenses: [],
          garrison: [],
        },
      ],
    });

    // LLM 在本楼只更新 北坡主基地 为「大雾」，未提 东海前哨 的天气，也未给 旧档基地 传任何新字段
    const raw = `
<态势>
bases:
  - {id: base_north, 名称: 北坡主基地, 天气: 浓雾}
  - {id: base_east, 名称: 东海前哨, 电力: 120/60}
  - {id: base_legacy, 名称: 旧档基地, 电力: 90/40}
</态势>
`;
    const parsed = parseMessageText(raw, prev);
    const north = parsed.data.bases.find(b => b.id === 'base_north')!;
    const east = parsed.data.bases.find(b => b.id === 'base_east')!;
    const legacy = parsed.data.bases.find(b => b.id === 'base_legacy')!;

    expect(north.weather).toBe('大雾');
    // 东海前哨未提及天气，保持原 '晴' 与 tz_offset=3
    expect(east.weather).toBe('晴');
    expect(east.tz_offset).toBe(3);
    // 旧档基地未传 weather/tz_offset/site_type，保持零新增键
    expect('weather' in legacy).toBe(false);
    expect('tz_offset' in legacy).toBe(false);
    expect('site_type' in legacy).toBe(false);
  });

  it('resolveEffectiveBaseWeather & withWeatherView：局部天气独立折减资金链，月球基地恒为真空无气象（×1.0）', () => {
    const state = makeBaseState({
      meta: {
        date: '1972年10月3日',
        weather: '暴风雪', // 全局暴风雪
        location: '北极圈',
        phase: '基地建设',
        day_count: 10,
      },
      bases: [
        {
          id: 'base_north',
          name: '北坡主基地',
          location: '北极圈',
          status: '运转中',
          weather: '暴风雪',
          power: { gen: 200, use: 100 },
          buildings: [],
          defenses: [],
          garrison: [],
        },
        {
          id: 'base_east',
          name: '东海前哨',
          location: '文昌滨海',
          status: '运转中',
          weather: '大雾',
          tz_offset: 3,
          power: { gen: 200, use: 100 },
          buildings: [],
          defenses: [],
          garrison: [],
        },
        {
          id: 'base_south',
          name: '南海晴空岛',
          location: '赤道礁盘',
          status: '运转中',
          weather: '晴',
          tz_offset: 2,
          power: { gen: 200, use: 100 },
          buildings: [],
          defenses: [],
          garrison: [],
        },
        {
          id: 'base_moon',
          name: '广寒宫月面基地',
          location: '月球沙克尔顿环形山',
          status: '运转中',
          site_type: 'lunar_surface',
          power: { gen: 300, use: 100 },
          buildings: [],
          defenses: [],
          garrison: [],
        },
      ],
      economy: {
        credits: 1000,
        credits_daily: 0,
        chains: [
          {
            id: 'chain_north',
            name: '北坡矿场',
            flow: '收入',
            rate_daily: 1000,
            status: 'active',
            eff: 1,
            deps: { base_id: 'base_north', buildings: [], world_resource: '' },
            capacity: { total_yield: null, extracted: 0 },
            reason: '',
            updated_at_day: 10,
          },
          {
            id: 'chain_east',
            name: '东海航运',
            flow: '收入',
            rate_daily: 1000,
            status: 'active',
            eff: 1,
            deps: { base_id: 'base_east', buildings: [], world_resource: '' },
            capacity: { total_yield: null, extracted: 0 },
            reason: '',
            updated_at_day: 10,
          },
          {
            id: 'chain_south',
            name: '南海渔业',
            flow: '收入',
            rate_daily: 1000,
            status: 'active',
            eff: 1,
            deps: { base_id: 'base_south', buildings: [], world_resource: '' },
            capacity: { total_yield: null, extracted: 0 },
            reason: '',
            updated_at_day: 10,
          },
          {
            id: 'chain_moon',
            name: '月面氦3开采',
            flow: '收入',
            rate_daily: 1000,
            status: 'active',
            eff: 1,
            deps: { base_id: 'base_moon', buildings: [], world_resource: '' },
            capacity: { total_yield: null, extracted: 0 },
            reason: '',
            updated_at_day: 10,
          },
        ],
      },
    });

    // 验证 resolveEffectiveBaseWeather
    const moonWeather = resolveEffectiveBaseWeather(state.bases[3], '暴风雪');
    expect(moonWeather.effectiveWeather).toBe('真空无气象');
    expect(moonWeather.source).toBe('extraterrestrial');
    expect(moonWeather.economyMultiplier).toBe(1.0);
    expect(moonWeather.isSevereForLaunch).toBe(false);

    // 验证 withWeatherView 分基地独立折减
    const viewChains = withWeatherView(state.economy.chains, '暴风雪', state.bases);
    expect(viewChains.find(c => c.id === 'chain_north')!.eff).toBeCloseTo(0.5, 5);
    expect(viewChains.find(c => c.id === 'chain_east')!.eff).toBeCloseTo(0.85, 5);
    expect(viewChains.find(c => c.id === 'chain_south')!.eff).toBeCloseTo(1.0, 5);
    expect(viewChains.find(c => c.id === 'chain_moon')!.eff).toBeCloseTo(1.0, 5);

    // 验证 settleFloor 推进 1 天（1440 分钟）：500 + 850 + 1000 + 1000 = 3350
    const settled = settleFloor(state, state, '<timePast>1 D</timePast>');
    expect(settled.data.economy.credits).toBe(1000 + 3350);
  });
});

describe('FD-26 · 三、副官 6 大专长与阵营磨合 8 大惩罚硬数值闭环及 base/theater 作用域隔离（D-SCOPE-1 / D-WIRE-1）', () => {
  it('evaluateCommandHQModifiers & makeTxnEffFor：重工催产督导、前线机匣抢修与磨合产线迟滞严格按 base vs theater 作用域隔离生效', () => {
    const state = makeBaseState({
      command: {
        staff_slot_cap: 2,
        adjutants: [
          {
            id: 'adj_faction_soviet',
            role: 'faction',
            faction: 'soviet',
            identity: 'mcv_girl',
            name: '米샤',
            title: '重工督导',
            buff_preset: 'heavy_industry_drive', // 机娘 +0.18
            upkeep_daily: 0,
            status: 'active',
            note: '',
            base: 'base_north', // 仅驻扎北坡主基地
          },
          {
            id: 'adj_staff_1',
            role: 'staff',
            faction: 'common',
            identity: 'human',
            name: '林工',
            title: '前线机匣抢修主任',
            buff_preset: '前线机匣抢修', // 人类 +0.15
            upkeep_daily: 200,
            status: 'active',
            note: '',
            // 未设 base -> theater 全局生效
          },
        ],
        break_in_penalties: [
          {
            id: 'pen_sov_rough_tolerance',
            faction: 'soviet',
            name: '公差粗放磨合',
            effect_kind: 'prod_slowdown',
            magnitude: 0.1, // -10%
            total_minutes: 21600,
            remaining_minutes: 21600,
            reason: '',
            base: 'base_north', // 仅限北坡主基地
          },
        ],
      },
    });

    const northMods = evaluateCommandHQModifiers(state, 'base_north');
    const eastMods = evaluateCommandHQModifiers(state, 'base_east');

    // 北坡主基地同时吃局部重工督导(+0.18)、局部产线迟滞(0.10)与全局抢修(+0.15)
    expect(northMods.heavyVehicleProdRateBonus).toBeCloseTo(0.18, 4);
    expect(northMods.prodSlowdownRatio).toBeCloseTo(0.1, 4);
    expect(northMods.repairThroughputBonus).toBeCloseTo(0.15, 4);

    // 东海前哨不受北坡局部副官与局部惩罚影响，仅享全局参谋抢修(+0.15)
    expect(eastMods.heavyVehicleProdRateBonus).toBe(0);
    expect(eastMods.prodSlowdownRatio).toBe(0);
    expect(eastMods.repairThroughputBonus).toBeCloseTo(0.15, 4);

    // 验证 makeTxnEffFor 工期效率倍率：
    const effFn = makeTxnEffFor(null, state);
    // 北坡生产队列：(1 + 0.18) * (1 - 0.10) = 1.062
    const northProdEff = effFn({
      id: 'q1',
      type: '生产',
      item: '天启坦克',
      qty: 1,
      base: 'base_north',
      status: 'active',
      total_minutes: 100,
      progress_minutes: 0,
    });
    expect(northProdEff).toBeCloseTo(1.062, 4);

    // 东海生产队列：1.0（不受北坡重工督导与北坡迟滞影响）
    const eastProdEff = effFn({
      id: 'q2',
      type: '生产',
      item: '灰熊坦克',
      qty: 1,
      base: 'base_east',
      status: 'active',
      total_minutes: 100,
      progress_minutes: 0,
    });
    expect(eastProdEff).toBeCloseTo(1.0, 4);

    // 东海改装队列：享全局机匣抢修 1 + 0.15 = 1.15
    const eastRetrofitEff = effFn({
      id: 'q3',
      type: '改装',
      item: '灰熊反应装甲改装',
      qty: 1,
      base: 'base_east',
      status: 'active',
      total_minutes: 100,
      progress_minutes: 0,
    });
    expect(eastRetrofitEff).toBeCloseTo(1.15, 4);
  });

  it('电网调谐副官（powerOutputBonus）与并网冲击掉电（power_loss）硬数值联动：真实改变供电充足率与资金链断供判定', () => {
    // 北坡基地标称电力 gen=100, use=95（原本充足），但挂上 power_loss=0.12 后有效发电降为 88 < 95 触发电网断供！
    const stateWithLoss = makeBaseState({
      bases: [
        {
          id: 'base_north',
          name: '北坡主基地',
          location: '北极圈',
          status: '运转中',
          power: { gen: 100, use: 95 },
          buildings: [],
          defenses: [],
          garrison: [],
        },
      ],
      economy: {
        credits: 1000,
        credits_daily: 0,
        chains: [
          {
            id: 'chain_north',
            name: '北坡重工矿脉',
            flow: '收入',
            rate_daily: 1000,
            status: 'active',
            eff: 1,
            deps: { base_id: 'base_north', buildings: [], world_resource: '' },
            capacity: { total_yield: null, extracted: 0 },
            reason: '',
            updated_at_day: 10,
          },
        ],
      },
      command: {
        staff_slot_cap: 1,
        adjutants: [],
        break_in_penalties: [
          {
            id: 'pen_sov_grid_surge',
            faction: 'soviet',
            name: '高压并网冲击',
            effect_kind: 'power_loss',
            magnitude: 0.12,
            total_minutes: 21600,
            remaining_minutes: 21600,
            reason: '',
            base: 'base_north',
          },
        ],
      },
    });

    const effPowerLoss = resolveEffectiveBasePower(stateWithLoss.bases[0], stateWithLoss);
    expect(effPowerLoss.gen).toBeCloseTo(88, 4);
    expect(effPowerLoss.use).toBe(95);

    const settledOutage = settleFloor(stateWithLoss, stateWithLoss, '<timePast>1 D</timePast>');
    expect(settledOutage.data.economy.chains[0].status).toBe('distressed');
    expect(settledOutage.data.economy.credits).toBe(1000); // 断供停产，0 收益

    // 派驻高压电网调谐机娘副官（powerOutputBonus = +0.14）：有效发电 = 100 * (1 + 0.14 - 0.12) = 102 >= 95，恢复供电！
    const stateWithTuning = makeBaseState({
      ...stateWithLoss,
      command: {
        staff_slot_cap: 1,
        adjutants: [
          {
            id: 'adj_faction_allied',
            role: 'faction',
            faction: 'allied',
            identity: 'mcv_girl',
            name: '伊娃',
            title: '电网调谐官',
            buff_preset: 'grid_harmonic_tuning',
            upkeep_daily: 0,
            status: 'active',
            note: '',
            base: 'base_north',
          },
        ],
        break_in_penalties: stateWithLoss.command!.break_in_penalties,
      },
    });

    const effPowerTuned = resolveEffectiveBasePower(stateWithTuning.bases[0], stateWithTuning);
    expect(effPowerTuned.gen).toBeCloseTo(102, 4);

    const settledNormal = settleFloor(stateWithTuning, stateWithTuning, '<timePast>1 D</timePast>');
    expect(settledNormal.data.economy.chains[0].status).toBe('active');
    expect(settledNormal.data.economy.credits).toBe(2000);
  });

  it('战区后勤精算（positiveChainBonus + breakInUpkeepReduction）、条令演训主任（protocolDailyRateBonus）、反侦察欺骗（exposureGainReduction）与暴露底线（exposure_floor）闭环生效', () => {
    const prevState = makeBaseState({
      exposure: { value: 2, level: '安全' },
    });

    const nextState = makeBaseState({
      // 本楼暴露度从 2 涨到 6（正向增量 +4）
      exposure: { value: 6, level: '高危' },
      economy: {
        credits: 5000,
        credits_daily: 0,
        chains: [
          {
            id: 'chain_main',
            name: '战区主矿脉',
            flow: '收入',
            rate_daily: 1000,
            status: 'active',
            eff: 1,
            deps: { base_id: 'base_north', buildings: [], world_resource: '' },
            capacity: { total_yield: null, extracted: 0 },
            reason: '',
            updated_at_day: 10,
          },
        ],
      },
      command: {
        staff_slot_cap: 3,
        adjutants: [
          {
            id: 'adj_faction_allied',
            role: 'faction',
            faction: 'allied',
            identity: 'mcv_girl',
            name: '伊娃',
            title: '后勤精算总监',
            buff_preset: 'logistics_actuary', // 机娘：正向资金链 +12%，磨合维持费减免 40%
            upkeep_daily: 0,
            status: 'active',
            note: '',
          },
          {
            id: 'adj_staff_drill',
            role: 'staff',
            faction: 'common',
            identity: 'mcv_girl',
            name: '百合子',
            title: '条令演训主任',
            buff_preset: 'protocol_drill_director', // 机娘：协议点日产 +12%
            upkeep_daily: 0,
            status: 'active',
            note: '',
          },
          {
            id: 'adj_staff_recon',
            role: 'staff',
            faction: 'common',
            identity: 'mcv_girl',
            name: '谭雅',
            title: '电子欺骗参谋',
            buff_preset: 'counter_recon_screen', // 机娘：正向暴露增量减免 40%
            upkeep_daily: 0,
            status: 'active',
            note: '',
          },
        ],
        break_in_penalties: [
          {
            id: 'pen_sov_broad_gauge',
            faction: 'soviet',
            name: '宽轨物资转运损耗',
            effect_kind: 'daily_upkeep',
            magnitude: 500, // 每日额外维持费 500，经 40% 减免后实扣 300
            total_minutes: 21600,
            remaining_minutes: 21600,
            reason: '',
          },
          {
            id: 'pen_all_em_beacon',
            faction: 'allied',
            name: '高频信标辐射底噪',
            effect_kind: 'exposure_floor',
            magnitude: 5, // 暴露底线 5
            total_minutes: 21600,
            remaining_minutes: 21600,
            reason: '',
          },
        ],
      },
    });

    // 无副官时基准协议点日产率对照
    const baselineRes = settleFloor(prevState, prevState, '<timePast>1 D</timePast>');
    const baseProtocolRate = baselineRes.protocolSettlement!.dailyRate;

    // 推进 1 天（1440 分钟）
    const settled = settleFloor(prevState, nextState, '<timePast>1 D</timePast>');

    // 1. 资金链：1000 * (1 + 0.12) = +1120；磨合维持费：500 * (1 - 0.40) = -300；最终 5000 + 1120 - 300 = 5820
    expect(settled.data.economy.credits).toBe(5820);
    // 持久化链条标称 rate_daily 保持 1000 不被污染
    expect(settled.data.economy.chains[0].rate_daily).toBe(1000);

    // 2. 协议点日产率：乘以 (1 + 0.12)
    expect(settled.protocolSettlement!.dailyRate).toBeCloseTo(baseProtocolRate * 1.12, 3);

    // 3. 暴露度：prev=2 -> next=6（增量 +4），经 40% 减免后为 2 + 4 * 0.6 = 4.4，再受 exposure_floor=5 托底 -> 5
    expect(settled.data.exposure.value).toBe(5);
  });
});

describe('G02-01 · 副官产点与自动候列账本净值', () => {
  for (const [identity, earned, upkeep] of [
    ['human', 0.108, 80],
    ['mcv_girl', 0.112, 0],
  ] as const) {
    it.each([
      { name: '无候列', queued: false, hold: false, points: 2, manual: false, spent: 0 },
      { name: '全hold', queued: true, hold: true, points: 2, manual: false, spent: 0 },
      { name: '点数不足', queued: true, hold: false, points: 0, manual: false, spent: 0 },
      { name: '手动后自动不双扣', queued: true, hold: false, points: 2, manual: true, spent: 1 },
      { name: '自动执行', queued: true, hold: false, points: 2, manual: false, spent: 1 },
    ])(`${identity} · $name：最终余额等于原余额＋有效产点－实验成本`, scenario => {
      const ref = 'sov.protocol.ra3.sputnik_one_way_deployment';
      const state = Schema.parse({
        ...makeBaseState(),
        bases: [], // 战地基础日产 0.10；T1 实验不要求高级院所。
        protocol_points: scenario.points,
        protocols: [
          {
            ref,
            status: 'available',
            attempts: 0,
            exp: 0,
            auto_queued: scenario.queued,
            hold: scenario.hold,
            queue_order: 1,
          },
        ],
        command: {
          staff_slot_cap: 1,
          adjutants: [
            {
              id: 'adj_drill',
              role: 'staff',
              faction: 'common',
              identity,
              name: '演训副官',
              title: '条令演训主任',
              buff_preset: 'protocol_drill_director',
              upkeep_daily: upkeep,
              status: 'active',
              note: '',
            },
          ],
        },
      });
      const raw =
        '<timePast>1 D</timePast>' +
        (scenario.manual ? '<事件>\n- 类型: 协议实验\n  对象: Sputnik一次展开前沿节点协议\n</事件>' : '');
      const parsed = parseMessageText(raw, state);
      const settled = settleFloor(state, parsed.data, raw, { eventDeclarations: parsed.eventDeclarations });
      const instance = settled.data.protocols!.find(p => p.ref === ref)!;

      expect(settled.protocolSettlement!.deltaPoints).toBeCloseTo(earned, 4);
      expect(settled.data.protocol_points).toBeCloseTo(scenario.points + earned - scenario.spent, 4);
      expect(settled.data.economy.credits).toBe(state.economy.credits - upkeep - scenario.spent * 500);
      expect(instance.attempts).toBe(scenario.spent);
      expect(instance.points_spent).toBe(scenario.spent);
      expect(instance.credits_spent).toBe(scenario.spent * 500);
      expect(settled.protocolSettlement!.autoExecuted).toBe(scenario.spent === 1 && !scenario.manual);
    });
  }
});
