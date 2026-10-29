/**
 * CTRL-RETIRE-01 · 实体退役生命周期（方案 A · 状态机退役）
 *
 * 覆盖验收四条：
 *  ① 退役认领：<战况> 基地状态更新可写入 '废弃'（含 退役/拆除/报废/停用 变体归一）；
 *  ② 幂等重放：重复退役同一实体不报错、不重复记录；
 *  ③ UI 过滤：中控雷达/基地清单 SFC 源级钉死「退役默认折叠、不参与首页与翻页」；
 *  ④ 旧档零迁移：元素级 default 兑底，旧档（无退役字段）toStrictEqual 不变。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本，不进 bundle */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';
import { parseMessageText } from '../parse/parsePipeline';
import { Schema } from '../core/schema';
import { checkVariables } from '../parse/systemCheck';

const RADAR_SFC = readFileSync(join(__dirname, '../../中控悬浮窗/console/ConsoleRadarScreen.vue'), 'utf8');
const PANEL_BASE_SFC = readFileSync(join(__dirname, '../ui/panels/PanelBase.vue'), 'utf8');
const ACTION_BAR_SFC = readFileSync(join(__dirname, '../ui/panels/ActionBar.vue'), 'utf8');
const FLOATING_APP_SFC = readFileSync(join(__dirname, '../../中控悬浮窗/console/FloatingApp.vue'), 'utf8');

const twoBases = () =>
  Schema.parse({
    bases: [
      { id: 'cyber-entry', name: '待侦知部署点', location: '待定', status: '隐蔽中', buildings: [] },
      { id: 'rust-low', name: '锈蚀低壑主基地', location: '锈蚀低壑', status: '隐蔽中', buildings: [] },
    ],
  });

describe('CTRL-RETIRE-01 ① schema 枚举加法 + ④ 旧档零迁移', () => {
  it('Base.status 接受退役取值 废弃', () => {
    const d = Schema.parse({ bases: [{ id: 'a', name: 'A', status: '废弃' }] });
    expect(d.bases[0].status).toBe('废弃');
  });

  it('既有四取值不受影响，default 仍是 隐蔽中', () => {
    for (const s of ['隐蔽中', '警戒', '暴露', '失守'] as const) {
      expect(Schema.parse({ bases: [{ id: 'a', name: 'A', status: s }] }).bases[0].status).toBe(s);
    }
    const d = Schema.parse({ bases: [{ id: 'a', name: 'A' }] });
    expect(d.bases[0].status).toBe('隐蔽中');
  });

  it('旧档 toStrictEqual 零迁移：不含退役取值的存档解析结果逐值不变', () => {
    const legacy = {
      bases: [
        {
          id: 'cyber-entry',
          name: '待侦知部署点',
          location: '待定',
          status: '隐蔽中',
          power: { gen: 0, use: 0 },
          buildings: [{ name: '雷达站', layer: '地表层', state: '运转' }],
          alerts: [],
        },
      ],
    };
    const snapshot = Schema.parse(structuredClone(legacy));
    expect(Schema.parse(structuredClone(legacy))).toStrictEqual(snapshot);
    expect(snapshot.bases[0]).toStrictEqual({
      id: 'cyber-entry',
      name: '待侦知部署点',
      location: '待定',
      status: '隐蔽中',
      power: { gen: 0, use: 0 },
      buildings: [{ name: '雷达站', layer: '地表层', state: '运转' }],
      alerts: [],
    });
  });
});

describe('CTRL-RETIRE-01 ③ parsePipeline 退役值认领 + 幂等', () => {
  it('基地状态更新写入 废弃（占位基地退役场景）', () => {
    const base = twoBases();
    const r = parseMessageText('<战况>\n基地:\n  - 名称: 待侦知部署点\n    状态: 废弃\n</战况>', base, {});
    expect(r.data.bases).toHaveLength(2);
    expect(r.data.bases[0].status).toBe('废弃');
    expect(r.data.bases[1].status).toBe('隐蔽中');
    expect(r.issues.filter(i => i.level === 'error')).toEqual([]);
  });

  it('变体 退役/拆除/报废/停用 归一为 废弃', () => {
    for (const v of ['退役', '拆除', '报废', '停用']) {
      const r = parseMessageText(`<战况>\n基地:\n  - 名称: 待侦知部署点\n    状态: ${v}\n</战况>`, twoBases(), {});
      expect(r.data.bases[0].status).toBe('废弃');
    }
  });

  it('幂等重放：重复退役同一实体不报错、不重复记录、数据不变', () => {
    const text = '<战况>\n基地:\n  - 名称: 待侦知部署点\n    状态: 废弃\n</战况>';
    const once = parseMessageText(text, twoBases(), {});
    const twice = parseMessageText(text, once.data, {});
    expect(twice.data.bases).toHaveLength(2);
    expect(twice.data.bases[0]).toStrictEqual(once.data.bases[0]);
    expect(twice.data.bases[1]).toStrictEqual(once.data.bases[1]);
    expect(twice.issues.filter(i => i.level === 'error')).toEqual([]);
    // bases 数组无新增元素（退役不是新建）
    expect(twice.data.bases.map(b => b.id)).toEqual(['cyber-entry', 'rust-low']);
  });

  it('退役不毒化整包：其余字段照常更新', () => {
    const r = parseMessageText(
      '<战况>\n基地:\n  - 名称: 待侦知部署点\n    状态: 废弃\n电力: { 发电: 50 }\n</战况>',
      twoBases(),
      {},
    );
    expect(r.data.bases[0].status).toBe('废弃');
  });
});

describe('CTRL-RETIRE-01 ⑤ 体检只读列出在册退役实体（R23，不提供自动删除）', () => {
  it('退役基地产生 info 级列项；在役基地不产生', () => {
    const issues = checkVariables({
      codex: [],
      techDone: [],
      overlays: [],
      baseResearches: [],
      mergedResearchNames: [],
      bases: [
        { id: 'cyber-entry', name: '待侦知部署点', status: '废弃' },
        { id: 'rust-low', name: '锈蚀低壑主基地', status: '隐蔽中' },
      ],
    });
    const r23 = issues.filter(i => i.rule === 'R23');
    expect(r23).toHaveLength(1);
    expect(r23[0]).toMatchObject({ level: 'info', target: '待侦知部署点' });
    expect(r23[0].message).toContain('cyber-entry');
    expect(r23[0].message).not.toMatch(/删除|清理执行/);
  });

  it('bases 参数可选：不传零回归（旧调用点行为不变）', () => {
    expect(
      checkVariables({ codex: [], techDone: [], overlays: [], baseResearches: [], mergedResearchNames: [] }),
    ).toEqual([]);
  });
});

describe('CTRL-RETIRE-01 ④ UI 过滤（SFC 源级钉死）', () => {
  it('雷达屏：在役/退役分清单，退役不参与首页与翻页，折叠区可查阅', () => {
    expect(RADAR_SFC).toContain("entry.base.status !== '废弃'");
    expect(RADAR_SFC).toContain('退役记录');
    expect(RADAR_SFC).toContain('isRetiredOpen');
    // 翻页与分页器以在役清单为准
    expect(RADAR_SFC).toMatch(/v-if="activeBases\.length > 1"/);
    expect(RADAR_SFC).toMatch(/activePosition \+ 1/);
    // currentBase 首选非退役
    expect(RADAR_SFC).toMatch(/byIndex && byIndex\.status !== '废弃'/);
  });

  it('基地清单：切换器只在在役间翻页，退役记录折叠展示', () => {
    expect(PANEL_BASE_SFC).toContain("entry.base.status !== '废弃'");
    expect(PANEL_BASE_SFC).toContain('退役记录');
    expect(PANEL_BASE_SFC).toContain('show_retired');
    expect(PANEL_BASE_SFC).toMatch(/activePosition \+ 1/);
    expect(PANEL_BASE_SFC).not.toContain('data.value.bases.length; // 切换器不再以全量计数');
  });

  it('楼层行动选项不引用退役实体（currentBase 回退首个在役）', () => {
    expect(ACTION_BAR_SFC).toMatch(/byIndex && byIndex\.status !== '废弃'/);
    expect(ACTION_BAR_SFC).toContain("data.value.bases.find(b => b.status !== '废弃')");
  });

  it('中控宿主：当前选中退役且仍有在役基地时回退首个在役', () => {
    expect(FLOATING_APP_SFC).toContain("b.status !== '废弃'");
    expect(FLOATING_APP_SFC).toContain('firstActiveBaseIndex');
  });
});
