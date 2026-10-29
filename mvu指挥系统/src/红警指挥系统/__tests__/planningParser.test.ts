import { describe, it, expect } from 'vitest';
import {
  computePlanFingerprint,
  extractPlanningIntent,
  detectLegacyQueueConflict,
} from '../planning/planningParser';
import { parseMessageText } from '../parse/parsePipeline';
import { Schema } from '../core/schema';

describe('PLAN-PARSE-01: planningParser & parsePipeline L1 seam', () => {
  it('1. 支持解析 JSON 格式（含 ```json 代码围栏）的 <排产计划>', () => {
    const rawJson = `
\`\`\`json
{
  "request_ref": "req_2026_01",
  "snapshot_ref": "snap_f12",
  "mode": "advisory",
  "budget_cap_credits": 3500,
  "protected_task_refs": ["task_power_1", "task_miner_2"],
  "reason": "前线装甲损耗补充",
  "actions": [
    {
      "op": "enqueue",
      "base_ref": "一号基地",
      "catalog_ref": "犀牛坦克",
      "quantity": 3,
      "kind": "生产"
    },
    {
      "op": "promote",
      "base_ref": "一号基地",
      "task_ref": "task_rhino_01"
    }
  ]
}
\`\`\`
`;
    const res = extractPlanningIntent(rawJson);
    expect(res.quarantine).toHaveLength(0);
    expect(res.intent).not.toBeNull();
    expect(res.intent?.version).toBe(1);
    expect(res.intent?.request_ref).toBe('req_2026_01');
    expect(res.intent?.snapshot_ref).toBe('snap_f12');
    expect(res.intent?.mode).toBe('advisory');
    expect(res.intent?.budget_cap_credits).toBe(3500);
    expect(res.intent?.protected_task_refs).toEqual(['task_power_1', 'task_miner_2']);
    expect(res.intent?.reason).toBe('前线装甲损耗补充');
    expect(res.intent?.actions).toEqual([
      {
        op: 'enqueue',
        base_ref: '一号基地',
        catalog_ref: '犀牛坦克',
        quantity: 3,
        kind: '生产',
      },
      {
        op: 'promote',
        base_ref: '一号基地',
        task_ref: 'task_rhino_01',
        quantity: 1,
      },
    ]);
    expect(res.intent?.fingerprint).toMatch(/^plan_[0-9a-f]{8}$/);
  });

  it('2. 支持解析 YAML 格式并完成中英文同义键名与动作动词归一', () => {
    const rawYaml = `
\`\`\`yaml
请求号: plan_cn_002
快照: snap_09
模式: 单次委托
预算上限: 5000
保护任务:
  - 磁暴线圈#1
  - 矿石精炼厂#2
理由: 优先保障防空与电力
计划:
  - 动作: 建造
    基地: 主基地
    项目: 磁暴反应炉
    数量: 2
  - 操作: 加急
    基地: 主基地
    项目: 防空炮
  - 操作: 降级
    任务: 动员兵批次3
  - 操作: 暂缓
    目标: 基洛夫空艇#1
  - 操作: 恢复
    目标: 武装采矿车#2
\`\`\`
`;
    const res = extractPlanningIntent(rawYaml);
    expect(res.quarantine).toHaveLength(0);
    expect(res.intent).not.toBeNull();
    expect(res.intent?.request_ref).toBe('plan_cn_002');
    expect(res.intent?.snapshot_ref).toBe('snap_09');
    expect(res.intent?.mode).toBe('delegate_once');
    expect(res.intent?.budget_cap_credits).toBe(5000);
    expect(res.intent?.protected_task_refs).toEqual(['磁暴线圈#1', '矿石精炼厂#2']);
    expect(res.intent?.reason).toBe('优先保障防空与电力');
    expect(res.intent?.actions).toEqual([
      {
        op: 'enqueue',
        base_ref: '主基地',
        catalog_ref: '磁暴反应炉',
        quantity: 2,
        kind: '建造',
      },
      {
        op: 'promote',
        base_ref: '主基地',
        task_ref: '防空炮',
        quantity: 1,
      },
      {
        op: 'demote',
        task_ref: '动员兵批次3',
        quantity: 1,
      },
      {
        op: 'hold',
        task_ref: '基洛夫空艇#1',
        quantity: 1,
      },
      {
        op: 'resume',
        task_ref: '武装采矿车#2',
        quantity: 1,
      },
    ]);
  });

  it('3. 越权写账红线拦截：动作或顶层包含账本/进度/审批字段时打入 quarantine 并拒绝越权动作', () => {
    const rawWithForbiddenActions = `
请求号: req_forbid_1
模式: 建议
动作:
  - 操作: 入队
    项目: 犀牛坦克
    数量: 2
  - 操作: 入队
    项目: 天启坦克
    数量: 1
    spent_minutes: 60
  - 操作: 置顶
    任务: 磁暴步兵
    状态: 已完成
  - 操作: 恢复
    任务: 矿车
    已批准: true
`;
    const res = extractPlanningIntent(rawWithForbiddenActions);
    expect(res.quarantine).toHaveLength(3);
    for (const q of res.quarantine) {
      expect(q.scope).toBe('field');
      expect(q.tag).toBe('排产计划');
    }
    // 仅保留第 1 条合法动作，其余 3 条越权动作均被拒绝
    expect(res.intent).not.toBeNull();
    expect(res.intent?.actions).toHaveLength(1);
    expect(res.intent?.actions[0].catalog_ref).toBe('犀牛坦克');

    // 顶层包含越权字段（如 credits / 资金 / approved）同样打入 quarantine 并拒收
    const rawRootForbidden = `
request_ref: req_forbid_root
credits: 999999
approved: true
actions:
  - op: enqueue
    item: 动员兵
    qty: 5
`;
    const rootRes = extractPlanningIntent(rawRootForbidden);
    expect(rootRes.quarantine.length).toBeGreaterThanOrEqual(2);
    expect(rootRes.quarantine.every(q => q.scope === 'field' && q.tag === '排产计划')).toBe(true);
    expect(rootRes.intent).toBeNull();
  });

  it('4. 非法数量（0, -2, 1.5, NaN, 1000）与未知动作动词拦截进 quarantine', () => {
    const rawInvalid = `
request_ref: req_invalid_qty_op
mode: advisory
actions:
  - op: enqueue
    item: 动员兵
    qty: 0
  - op: enqueue
    item: 防空步兵
    qty: -2
  - op: enqueue
    item: 磁暴步兵
    qty: 1.5
  - op: enqueue
    item: 工程师
    qty: 1000
  - op: destroy_all
    item: 战车工厂
    qty: 1
  - op: enqueue
    item: 恐怖机器人
    qty: 4
`;
    const res = extractPlanningIntent(rawInvalid);
    // 4 个非法数量 + 1 个未知动词 = 5 条 quarantine
    expect(res.quarantine).toHaveLength(5);
    expect(res.quarantine.every(q => q.scope === 'field' && q.tag === '排产计划')).toBe(true);
    expect(res.intent).not.toBeNull();
    expect(res.intent?.actions).toEqual([
      {
        op: 'enqueue',
        catalog_ref: '恐怖机器人',
        quantity: 4,
      },
    ]);
  });

  it('5. 幂等指纹稳定性：不同格式/中英文键名归一后指纹完全一致，内容变化后指纹改变', () => {
    const jsonVer = extractPlanningIntent(
      JSON.stringify({
        request_ref: 'r1',
        mode: 'delegate_once',
        budget_cap_credits: 2000,
        actions: [
          { op: 'enqueue', base_ref: '主基地', catalog_ref: '犀牛坦克', quantity: 2, kind: '生产' },
          { op: 'hold', base_ref: '主基地', task_ref: '基洛夫空艇', quantity: 1 },
        ],
      })
    );

    const yamlCnVer = extractPlanningIntent(`
请求号: r2_different_id
模式: 单次委托
预算: 2000
计划:
  - 动作: 生产
    基地: " 主基地 "
    项目: "犀牛 坦克"
    数量: 2
  - 动作: 暂缓
    基地: 主基地
    条目: 基洛夫空艇
`);

    expect(jsonVer.intent).not.toBeNull();
    expect(yamlCnVer.intent).not.toBeNull();
    expect(jsonVer.intent?.fingerprint).toBe(yamlCnVer.intent?.fingerprint);

    const diffFp = computePlanFingerprint({
      mode: 'advisory',
      budget_cap_credits: 2000,
      actions: jsonVer.intent!.actions,
    });
    expect(diffFp).not.toBe(jsonVer.intent?.fingerprint);
  });

  it('6. detectLegacyQueueConflict 单元测试：检测旧队列与调度令同名项目冲突', () => {
    const { intent } = extractPlanningIntent(`
模式: 建议
动作:
  - 操作: 入队
    基地: 一号基地
    项目: 犀牛坦克
    数量: 2
`);
    expect(intent).not.toBeNull();
    expect(
      detectLegacyQueueConflict(intent!, [{ item: '动员兵', base: '一号基地' }], [])
    ).toBe(false);

    expect(
      detectLegacyQueueConflict(intent!, [{ 项目: '犀牛坦克', 基地: '一号基地' }], [])
    ).toBe(true);
    expect(intent?.conflict_with_legacy_queue).toBe(true);

    const { intent: intent2 } = extractPlanningIntent(`
模式: 建议
动作:
  - 操作: 加急
    任务: 磁暴步兵
`);
    expect(
      detectLegacyQueueConflict(intent2!, [], [{ target: '磁暴步兵', base: '一号基地' }])
    ).toBe(true);
  });

  it('7. 通过 parseMessageText 完整提取 planningDecls（支持 <排产计划> 与同义标签 <排产>）', () => {
    const baseData = Schema.parse({});
    const msg = `
前线报告完毕，以下为参谋部拟定的排产方案：
<排产计划>
请求号: req_pipe_01
快照: snap_10
模式: 参谋建议
预算上限: 3000
动作:
  - 操作: 生产
    基地: 主基地
    项目: 犀牛坦克
    数量: 2
  - 操作: 入队
    项目: 非法进度坦克
    数量: 1
    已耗时: 15
</排产计划>
<排产>
{
  "request_ref": "req_pipe_02",
  "mode": "delegate_once",
  "actions": [
    { "op": "promote", "task_ref": "防空步兵批次1" }
  ]
}
</排产>
`;
    const res = parseMessageText(msg, baseData);
    expect(res.planningDecls).toHaveLength(2);
    expect(res.planningDecls[0].request_ref).toBe('req_pipe_01');
    expect(res.planningDecls[0].mode).toBe('advisory');
    expect(res.planningDecls[0].actions).toHaveLength(1);
    expect(res.planningDecls[0].actions[0].catalog_ref).toBe('犀牛坦克');
    expect(res.planningDecls[0].conflict_with_legacy_queue).toBeUndefined();

    expect(res.planningDecls[1].request_ref).toBe('req_pipe_02');
    expect(res.planningDecls[1].mode).toBe('delegate_once');
    expect(res.planningDecls[1].actions[0].op).toBe('promote');
    expect(res.planningDecls[1].actions[0].task_ref).toBe('防空步兵批次1');

    // 越权字段被并入 res.quarantine
    expect(res.quarantine.some(q => q.tag === '排产计划' && q.scope === 'field')).toBe(true);
  });

  it('8. parseMessageText 同楼同时存在旧 <战况> 队列写入与 <排产计划> 时自动标记 conflict_with_legacy_queue', () => {
    const baseData = Schema.parse({});
    const msg = `
<战况>
队列:
  - 项目: 犀牛坦克
    数量: 2
    状态: 生产中
</战况>
<排产计划>
请求号: req_conflict_01
模式: 委托
动作:
  - 操作: 入队
    项目: 犀牛坦克
    数量: 2
</排产计划>
`;
    const res = parseMessageText(msg, baseData);
    expect(res.planningDecls).toHaveLength(1);
    expect(res.planningDecls[0].request_ref).toBe('req_conflict_01');
    expect(res.planningDecls[0].conflict_with_legacy_queue).toBe(true);
  });

  it('9. BUG-LIVE-22a（#68楼实机复现）：支持 <排产计划> 分域子队列（建筑队列 / 作战单位队列 / 研究队列）与 批准状态: 已批准 + 单位/数量/基地 字段别名', () => {
    const raw68 = `
批准状态: 已批准
建筑队列: []
作战单位队列:
  - 单位: 犀牛主战坦克族
    数量: 2
    基地: 铁砧重矿前哨分基地
  - 单位: 动员兵
    数量: 10
    基地: 铁砧重矿前哨分基地
研究队列: []
`;
    const res = extractPlanningIntent(raw68);
    expect(res.quarantine).toEqual([]);
    expect(res.intent).not.toBeNull();
    expect(res.intent?.mode).toBe('delegate_once');
    expect(res.intent?.actions).toEqual([
      {
        op: 'enqueue',
        base_ref: '铁砧重矿前哨分基地',
        catalog_ref: '犀牛主战坦克族',
        quantity: 2,
        kind: '生产',
      },
      {
        op: 'enqueue',
        base_ref: '铁砧重矿前哨分基地',
        catalog_ref: '动员兵',
        quantity: 10,
        kind: '生产',
      },
    ]);
  });
});

