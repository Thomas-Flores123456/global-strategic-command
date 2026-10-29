/**
 * resourcePanelModel.test.ts —— CTRL-UI-RES-01 验收测试
 *
 * 覆盖（对照卡面与 schema 语义锚点）：
 * ① 三态语义钉死：null→locked 横杠「未解锁」（严禁降级为 0）/ 0→depleted「告罄」/ >0→flow 数值直呈；
 * ② 六柱注册表序＝schema 声明序，柱名/副标同源 schema 注释，数据键直呈；
 * ③ 动态小类键（LLM 剧情新增）直呈不丢；
 * ④ resources 整体缺席 → 未探明降级（surveyed=false，pillars 空，降级文案照实）；
 * ⑤ 资金条：credits/credits_daily 直呈＋日均净入三 tone 与符号化文本；
 * ⑥ 流水摘要降级：ledger.available=false＋说明文案（stat_data 无逐笔账本）；
 * ⑦ 纯函数纪律：不原地修改入参（冻结输入不抛错、内容不变）；
 * ⑧ 缺柱防御：未过 Schema.parse 的粗输入缺柱降级为空柱不抛错。
 */
import { describe, expect, it } from 'vitest';
import { EconomyResources } from '../../红警指挥系统/core/schema';
import { RESOURCE_COPY, RESOURCE_PILLARS, resourcePanelModel, type ResourcePanelInput } from '../models/resourcePanelModel';

/* ═══════════════ 夹具（经 Schema 子树 parse，与真机 snapshot 同形） ═══════════════ */

function mkEconomy(over: Partial<ResourcePanelInput> = {}): ResourcePanelInput {
  return {
    credits: 1500,
    credits_daily: 120,
    resources: EconomyResources.parse({
      nanites: { 标准纳米工料: 120, 机娘修复凝胶: 0 },
      minerals: { 铁矿石: 25, 铜矿砂: null },
      munitions: { 步兵制式弹药: 4000 },
    }),
    ...over,
  };
}

/* ═══════════════ ① 三态语义钉死 ═══════════════ */

describe('三态语义钉死（null≠0，严禁降级）', () => {
  const m = resourcePanelModel(mkEconomy());
  const nanites = m.pillars.find(p => p.key === 'nanites')!;
  const minerals = m.pillars.find(p => p.key === 'minerals')!;

  it('null → locked：横杠＋「未解锁」标签，原值保真为 null', () => {
    const row = minerals.items.find(i => i.name === '铜矿砂')!;
    expect(row.value).toBeNull();
    expect(row.tone).toBe('locked');
    expect(row.valueText).toBe('—');
    expect(row.tag).toBe('未解锁');
  });

  it('0 → depleted：数值 0 直呈＋「告罄」标签（不等同未解锁）', () => {
    const row = nanites.items.find(i => i.name === '机娘修复凝胶')!;
    expect(row.value).toBe(0);
    expect(row.tone).toBe('depleted');
    expect(row.valueText).toBe('0');
    expect(row.tag).toBe('告罄');
  });

  it('>0 → flow：数值直呈、无标签', () => {
    const row = minerals.items.find(i => i.name === '铁矿石')!;
    expect(row.value).toBe(25);
    expect(row.tone).toBe('flow');
    expect(row.valueText).toBe('25');
    expect(row.tag).toBeUndefined();
  });

  it('柱级计数：已解锁/告罄/全柱未解锁口径（zod 记录缺省不合并键——显式写键才入库）', () => {
    expect(nanites.unlockedCount).toBe(2); // 120 与 0 均已解锁
    expect(nanites.depletedCount).toBe(1);
    expect(nanites.totalCount).toBe(2); // parse 输入仅两键（record default 整体替换语义）
    expect(nanites.allLocked).toBe(false);
    const fuel = m.pillars.find(p => p.key === 'fuel')!;
    expect(fuel.allLocked).toBe(true); // 预置全 null
    expect(fuel.unlockedCount).toBe(0);
  });
});

/* ═══════════════ ②③ 六柱序・同源名・动态键 ═══════════════ */

describe('六柱注册表序与显示名同源', () => {
  it('柱序＝schema 声明序（nanites→logistics），数据键直呈', () => {
    const m = resourcePanelModel(mkEconomy());
    expect(m.pillars.map(p => p.key)).toEqual(['nanites', 'minerals', 'materials', 'fuel', 'munitions', 'logistics']);
    expect(RESOURCE_PILLARS.length).toBe(6);
  });

  it('柱名/副标＝schema 注释同源（抽验 nanites 与 munitions）', () => {
    const m = resourcePanelModel(mkEconomy());
    expect(m.pillars[0].name).toBe('纳米机械储备');
    expect(m.pillars[0].desc).toContain('建造厂或纳米工坊');
    expect(m.pillars[4].name).toBe('军械与弹药');
  });

  it('动态小类键（剧情新增物料）数据键直呈不丢', () => {
    const m = resourcePanelModel(mkEconomy({ resources: EconomyResources.parse({ minerals: { 紫幽玄铁: 100 } }) }));
    const minerals = m.pillars.find(p => p.key === 'minerals')!;
    const dyn = minerals.items.find(i => i.name === '紫幽玄铁')!;
    expect(dyn.value).toBe(100);
    expect(dyn.tone).toBe('flow');
    // 未显式写入的柱仍得 schema 预置 null（柱级 default 生效）
    const fuel = m.pillars.find(p => p.key === 'fuel')!;
    expect(fuel.items.some(i => i.name === '精炼柴油' && i.tone === 'locked')).toBe(true);
  });
});

/* ═══════════════ ④ 整体未探明降级 ═══════════════ */

describe('resources 整体缺席 → 未探明降级', () => {
  it('surveyed=false、pillars 空、降级文案照实；资金条不受影响', () => {
    const m = resourcePanelModel({ credits: 800, credits_daily: -30 });
    expect(m.surveyed).toBe(false);
    expect(m.pillars).toEqual([]);
    expect(m.unsurveyedText).toBe(RESOURCE_COPY.unsurveyedText);
    expect(m.unsurveyedText).toContain('尚未建立物资仓库');
    expect(m.creditsBar.credits).toBe(800);
  });

  it('resources 在场 → surveyed=true（哪怕全柱未解锁）', () => {
    const m = resourcePanelModel({ resources: EconomyResources.parse({}) });
    expect(m.surveyed).toBe(true);
    expect(m.pillars.length).toBe(6);
    expect(m.pillars.every(p => p.allLocked)).toBe(true);
  });
});

/* ═══════════════ ⑤⑥ 资金条与流水摘要降级 ═══════════════ */

describe('资金条（credits/credits_daily 直呈）', () => {
  it('标签同源 schema 注释；现值直呈', () => {
    const m = resourcePanelModel(mkEconomy());
    expect(m.creditsBar.creditsLabel).toBe('战备资金');
    expect(m.creditsBar.creditsDailyLabel).toBe('每日净收支');
    expect(m.creditsBar.credits).toBe(1500);
    expect(m.creditsBar.creditsText).toBe('1500');
  });

  it('日均净入三 tone：正→surplus 补「+」；负→deficit 原文；零→balance', () => {
    const pos = resourcePanelModel(mkEconomy()).creditsBar;
    expect(pos.creditsDailyText).toBe('+120');
    expect(pos.dailyTone).toBe('surplus');
    const neg = resourcePanelModel({ credits: 0, credits_daily: -45 }).creditsBar;
    expect(neg.creditsDailyText).toBe('-45');
    expect(neg.dailyTone).toBe('deficit');
    const zero = resourcePanelModel({}).creditsBar;
    expect(zero.creditsDailyText).toBe('0');
    expect(zero.dailyTone).toBe('balance');
    expect(zero.credits).toBe(0); // 缺省 0（schema 默认语义）
  });

  it('流水摘要降级：ledger.available=false＋说明文案（stat_data 无逐笔账本）', () => {
    const m = resourcePanelModel(mkEconomy());
    expect(m.ledger.available).toBe(false);
    expect(m.ledger.note).toBe(RESOURCE_COPY.ledgerNote);
    expect(m.ledger.note).toContain('当前按日统计总资金与每日净收支');
  });
});

/* ═══════════════ ⑦⑧ 纯函数纪律与防御 ═══════════════ */

describe('纯函数纪律与粗输入防御', () => {
  it('不原地修改入参：冻结输入不抛错、内容不变', () => {
    const resources = EconomyResources.parse({ minerals: { 铁矿石: 10 } });
    const input = Object.freeze({ credits: 1, credits_daily: 2, resources }) as ResourcePanelInput;
    const snapshotBefore = JSON.stringify(input);
    expect(() => resourcePanelModel(input)).not.toThrow();
    expect(JSON.stringify(input)).toBe(snapshotBefore);
  });

  it('缺柱防御：未过 parse 的粗输入缺柱降级为空柱（allLocked、零小类）', () => {
    const m = resourcePanelModel({ resources: { minerals: { 铁矿石: 3 } } });
    expect(m.surveyed).toBe(true);
    const nanites = m.pillars.find(p => p.key === 'nanites')!;
    expect(nanites.items).toEqual([]);
    expect(nanites.allLocked).toBe(true);
    const minerals = m.pillars.find(p => p.key === 'minerals')!;
    expect(minerals.items.map(i => i.name)).toEqual(['铁矿石']);
  });

  it('FIX-P1-04：库存负值防负钳制（Math.max(0, value)），置为 0 告罄态', () => {
    const m = resourcePanelModel({ resources: { materials: { 高强工程钢材: -25 } } });
    const materials = m.pillars.find(p => p.key === 'materials')!;
    expect(materials.items[0]).toMatchObject({
      name: '高强工程钢材',
      value: 0,
      tone: 'depleted',
      valueText: '0',
      tag: '告罄',
    });
  });
});
