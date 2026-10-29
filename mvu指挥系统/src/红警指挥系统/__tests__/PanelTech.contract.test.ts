import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { FACTION_DEFS, deriveFactionTiers } from '../core/catalog';

/**
 * PanelTech.vue SFC 契约测试（数据源标记口径，对齐 TagFilterBar 先例）
 * 不挂载组件、不触 MVU；只钉住 20 号裁决要求的功能面：
 * 1. 科研槽总览区块存在，且数据源为 slotBoard（与日程线同口径）
 * 2. 算力卡区块存在，数据源为 computeOverview 纯函数
 * 3. 旧功能标记不回退：阵营层级、各科技线目录、完成度块阵
 */
const PANEL_SFC = readFileSync(path.resolve(__dirname, '../ui/panels/PanelTech.vue'), 'utf-8');
const DRAWER_SFC = readFileSync(path.resolve(__dirname, '../ui/DetailDrawer.vue'), 'utf-8');

describe('PanelTech.vue 契约：科研槽 + 算力 + 旧功能保留', () => {
  it('科研槽区块存在：标题和激活板渲染接线', () => {
    expect(PANEL_SFC).toMatch(/data-tech-slots/);
    expect(PANEL_SFC).toMatch(/研究课题组 · Slots/);
    expect(PANEL_SFC).toMatch(/slotBoard\(/);
    expect(PANEL_SFC).toMatch(/lineIndexFromCatalog/);
    expect(PANEL_SFC).toMatch(/deployIndexFromCatalog/);
  });

  it('算力卡区块存在：computeOverview 接线、缺口徽标、明细折叠', () => {
    expect(PANEL_SFC).toMatch(/data-tech-compute/);
    expect(PANEL_SFC).toMatch(/科研算力 · Compute/);
    expect(PANEL_SFC).toMatch(/computeOverview\(/);
    expect(PANEL_SFC).toMatch(/compute\.deficit/);
    expect(PANEL_SFC).toMatch(/showComputeDetail/);
  });

  it('旧视图标记不回退：阵营层级阶梯、各线目录块阵、ORPHAN 兜底', () => {
    expect(PANEL_SFC).toMatch(/科技代际 · Tier/);
    expect(PANEL_SFC).toMatch(/byLine/);
    expect(PANEL_SFC).toMatch(/blk--on/);
    expect(PANEL_SFC).toMatch(/orphanActives/);
  });

  it('FIX-P1-02：PanelTech.vue 区分 queued（排队中）与 locked（未解锁），并提供排队筛选与 blk--queued 视觉态', () => {
    expect(PANEL_SFC).toContain("q.status === 'queued' ? 'queued' : 'active'");
    expect(PANEL_SFC).toContain('tech-card--queued');
    expect(PANEL_SFC).toContain('blk--queued');
    expect(PANEL_SFC).toContain('排队中 · 第');
  });

  it('FIX-P1-02：deriveFactionTiers 识别苏联「红星实验设计局综合体」推导 T2、国家战略工程综合体推导 T3', () => {
    const t1 = deriveFactionTiers(FACTION_DEFS, [{ name: '苏联建造厂', state: '运转' }], []);
    expect(t1.find(f => f.faction === '苏联')?.tier).toBe(1);

    const t2 = deriveFactionTiers(
      FACTION_DEFS,
      [
        { name: '苏联建造厂', state: '运转' },
        { name: '红星实验设计局综合体', state: '运转' },
      ],
      [],
    );
    expect(t2.find(f => f.faction === '苏联')?.tier).toBe(2);

    const t3 = deriveFactionTiers(
      FACTION_DEFS,
      [
        { name: '苏联建造厂', state: '运转' },
        { name: '红星实验设计局综合体', state: '运转' },
        { name: '国家战略工程综合体', state: '运转' },
      ],
      [],
    );
    expect(t3.find(f => f.faction === '苏联')?.tier).toBe(3);
  });

  it('FIX-P1-01 / FIX-P1-02：DetailDrawer.vue 生产列装支持数量与基地选择（含 数量: N），研发立项具备前置科技/协议守卫', () => {
    expect(DRAWER_SFC).toContain('produceQty');
    expect(DRAWER_SFC).toContain('selectedBaseName');
    expect(DRAWER_SFC).toContain('数量: ${qty}');
    expect(DRAWER_SFC).toContain('researchGate');
    expect(DRAWER_SFC).toContain('buildCompletedTechAndProtocolSet');
  });
});
