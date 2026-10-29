import { describe, expect, it } from 'vitest';
import type { ThEntry } from '../worldbook/girlFiler';
import {
  ROSTER_MARK,
  fileSingleGirlToWorldbook,
  formatCapabilityContent,
  formatPlotContent,
  upsertDossierEntry,
  upsertStoryEntry,
} from '../worldbook/girlFiler';
import { parseMessageText } from '../parse/parsePipeline';
import { Girl, GirlDossier, Schema } from '../core/schema';

describe('MAIDEN-CORE-01 · 同型次生机娘三步生命周期、原地认亲与聊天书入档', () => {
  it('Schema 向后兼容：旧档 Girl 与 GirlDossier 缺省字段 100% 自动默认值水合', () => {
    const legacyGirl = Girl.parse({ name: '凌波' });
    expect(legacyGirl).toMatchObject({
      name: '凌波',
      duty: '',
      hp: '完好',
      base: '',
      serial: '',
      callsign: '',
      model: '',
      seq: '',
      faction: '',
      body: '',
      personality: '',
      appearance: '',
      shell: '',
      alias: '',
      status: '',
      affection: 50,
      obedience: 50,
      traits: [],
    });

    const legacyDossier = GirlDossier.parse({ name: '赤星' });
    expect(legacyDossier).toMatchObject({
      name: '赤星',
      serial: '',
      callsign: '',
      rename_from: '',
      seq: '',
      faction: '',
      body: '',
    });
  });

  it('Step 1 · 初诞待授名登场：顶层 <机娘> 标签解析入账（含身子、初生性格、编号、序列，0 隔离）', () => {
    const baseline = Schema.parse({
      forces: {
        girls: [
          {
            name: '铁壁',
            callsign: '铁壁',
            serial: '犀牛-01',
            model: '犀牛主战坦克',
            seq: '首台原型',
            faction: '苏联',
            hp: '完好',
            base: '北坡主基地',
            duty: '重装正面推进',
            body: '175cm高挑丰满御姐型纳米躯体',
            personality: '沉稳豪迈的大姐头',
          },
        ],
      },
    });

    const raw = `
<机娘>
名称: 待授名
编号: 犀牛-02
型号: 犀牛主战坦克
序列: 次生二号机
阵营: 苏联
状态: 完好
驻地: 北坡主基地
职务: 重装突击待命（待指挥官赐予代号）
躯体特征: 158cm娇小紧致型纳米躯体，银白短发带赤红挑染，锁骨与脊椎浮现暗红散热微流道
性格: 沉默执拗、极度护短，对指挥官有本能的雏鸟依恋，面对一号机大姐头时略带较劲心理
好感: 60
服从: 85
特征标签: [次生异构, 极限过载, 待授名]
</机娘>`;

    const res = parseMessageText(raw, baseline);
    expect(res.quarantine).toEqual([]);
    expect(res.data.forces.girls).toHaveLength(2);
    expect(res.data.forces.girls[0].name).toBe('铁壁');
    expect(res.data.forces.girls[1]).toMatchObject({
      name: '待授名',
      serial: '犀牛-02',
      model: '犀牛主战坦克',
      seq: '次生二号机',
      faction: '苏联',
      hp: '完好',
      base: '北坡主基地',
      duty: '重装突击待命（待指挥官赐予代号）',
      body: expect.stringContaining('158cm娇小紧致型纳米躯体'),
      personality: expect.stringContaining('沉默执拗、极度护短'),
      shell: '',
      alias: '',
      affection: 60,
      obedience: 85,
      traits: ['次生异构', '极限过载', '待授名'],
    });
  });

  it('Step 1 变体 · 未写名称仅提供编号且「状态」为非枚举描述时，自动补齐定位名并将状态转为 status（0 隔离）', () => {
    const raw = `
<maiden>
编号: 犀牛-02
原型: 犀牛主战坦克
身子: 158cm娇小紧致型
状态: 待授名（刚从纳米母网苏醒）
</maiden>`;

    const res = parseMessageText(raw, {});
    expect(res.quarantine).toEqual([]);
    expect(res.data.forces.girls).toHaveLength(1);
    expect(res.data.forces.girls[0]).toMatchObject({
      name: '待授名·犀牛-02',
      serial: '犀牛-02',
      model: '犀牛主战坦克',
      body: '158cm娇小紧致型',
      hp: '完好',
      status: '待授名（刚从纳米母网苏醒）',
    });
  });

  it('Step 2 路径 A · 通过 <机娘> 赐名：按原名/编号原地认亲改名，绝不产生待授名幽灵记录', () => {
    const step1 = parseMessageText(
      `<机娘>
名称: 待授名
编号: 犀牛-02
型号: 犀牛主战坦克
序列: 次生二号机
阵营: 苏联
好感: 60
服从: 85
特征标签: 次生异构、极限过载、待授名
</机娘>`,
      {},
    );
    expect(step1.data.forces.girls).toHaveLength(1);

    const step2 = parseMessageText(
      `<机娘>
名称: 赤星
代号: 赤星
编号: 犀牛-02
原名: 待授名
当前状态: 已获指挥官赐名「赤星」，核心完成锚定
</机娘>`,
      step1.data,
    );

    expect(step2.quarantine).toEqual([]);
    expect(step2.data.forces.girls).toHaveLength(1);
    expect(step2.data.forces.girls[0]).toMatchObject({
      name: '赤星',
      callsign: '赤星',
      serial: '犀牛-02',
      model: '犀牛主战坦克',
      seq: '次生二号机',
      faction: '苏联',
      status: expect.stringContaining('已获指挥官赐名「赤星」'),
      affection: 60,
      obedience: 85,
      traits: ['次生异构', '极限过载'],
    });
  });

  it('Step 2 路径 B · 通过 <机娘档案> 赐名：支持原型/外貌/背景/阵营/身子全别名 0 隔离，且自动同步转正 forces.girls', () => {
    const baseline = Schema.parse({
      forces: {
        girls: [
          {
            name: '铁壁',
            callsign: '铁壁',
            serial: '犀牛-01',
            model: '犀牛主战坦克',
            seq: '首台原型',
            faction: '苏联',
            hp: '完好',
          },
          {
            name: '待授名',
            serial: '犀牛-02',
            model: '犀牛主战坦克',
            seq: '次生二号机',
            faction: '苏联',
            hp: '完好',
            affection: 60,
            obedience: 85,
            traits: ['次生异构', '极限过载', '待授名'],
          },
        ],
      },
    });

    const raw = `
<机娘档案>
名称: 赤星
代号: 赤星
编号: 犀牛-02
原名: 待授名
原型: 犀牛主战坦克
序列: 次生二号机
阵营: 苏联
身子: 158cm娇小紧致型纳米躯体，银白短发带赤红挑染，锁骨与脊椎浮现暗红散热微流道
外貌: 黑红短款苏式装甲束腰与高筒防爆战靴，肩披印有02钢印的防弹披风
性格: 平时寡言乖巧，听见指挥官呼唤代号「赤星」时会耳尖发烫并立刻挺直腰板
形态机制: 纳米武装展开 / 舰装化 / 载具完全体三态切换
能力: 125mm滑膛炮极限过载连射、反应装甲定向爆破格挡
结构短板: 极限过载后散热微流道需冷却液直冷
武器: 125mm纳米滑膛炮、7.62mm同轴机枪
暴露分档: EL-0 常服隐匿 / EL-2 纳米半展开 / EL-4 犀牛完全体
平衡位置: T1陆战主战装甲（与一号机总战力拉平，偏重爆发与机动过载）
化名: 暂未编织
社会外壳: 暂未编织（基地内勤）
背景: 已由指挥官赐予代号「赤星」，心智核心完成锚定，编入北坡装甲突击群
触发词: 赤星, 犀牛-02, 犀牛二号机
</机娘档案>`;

    const res = parseMessageText(raw, baseline);
    expect(res.quarantine).toEqual([]);
    expect(res.data.pending_lore).toHaveLength(1);
    const dossier = res.data.pending_lore[0];
    expect(dossier).toMatchObject({
      name: '赤星',
      callsign: '赤星',
      serial: '犀牛-02',
      rename_from: '待授名',
      model: '犀牛主战坦克',
      seq: '次生二号机',
      faction: '苏联',
      body: expect.stringContaining('158cm娇小紧致型纳米躯体'),
      appearance: expect.stringContaining('黑红短款苏式装甲束腰与高筒防爆战靴'),
      status: expect.stringContaining('已由指挥官赐予代号「赤星」'),
      keys: ['赤星', '犀牛-02', '犀牛二号机'],
    });

    // forces.girls 中的「待授名」已被原地认亲转正为「赤星」，且一号机「铁壁」完好保留
    expect(res.data.forces.girls).toHaveLength(2);
    expect(res.data.forces.girls.map(g => g.name)).toEqual(['铁壁', '赤星']);
    expect(res.data.forces.girls[1]).toMatchObject({
      name: '赤星',
      callsign: '赤星',
      serial: '犀牛-02',
      model: '犀牛主战坦克',
      seq: '次生二号机',
      faction: '苏联',
      body: expect.stringContaining('158cm娇小紧致型纳米躯体'),
      appearance: expect.stringContaining('黑红短款苏式装甲束腰与高筒防爆战靴'),
      personality: expect.stringContaining('平时寡言乖巧'),
      affection: 60,
      obedience: 85,
      traits: ['次生异构', '极限过载'],
    });
  });

  it('Step 3 · 延迟编织社会外壳与日常好感/服从增量更新（支持单对象与键值字典形态）', () => {
    const init = Schema.parse({
      forces: {
        girls: [
          {
            name: '赤星',
            callsign: '赤星',
            serial: '犀牛-02',
            model: '犀牛主战坦克',
            seq: '次生二号机',
            faction: '苏联',
            hp: '完好',
            affection: 60,
            obedience: 85,
            traits: ['次生异构', '极限过载'],
          },
        ],
      },
    });

    const step3 = parseMessageText(
      `<机娘>
名称: 赤星
编号: 犀牛-02
化名: 林星
社会外壳: 北坡矿业重型机械见习调度员（持全套合规工牌与社保记录）
好感变化: +8
服从变化: +20
当前状态: 首次换上矿业调度员制服随指挥官外出勘探，对人类社会的便服略感局促
特征标签: [次生异构, 极限过载, 外勤便装]
</机娘>`,
      init,
    );

    expect(step3.quarantine).toEqual([]);
    expect(step3.data.forces.girls).toHaveLength(1);
    expect(step3.data.forces.girls[0]).toMatchObject({
      name: '赤星',
      alias: '林星',
      shell: '北坡矿业重型机械见习调度员（持全套合规工牌与社保记录）',
      affection: 68,
      obedience: 100, // 85 + 20 clamp 到 100
      status: expect.stringContaining('首次换上矿业调度员制服随指挥官外出勘探'),
      traits: ['次生异构', '极限过载', '外勤便装'],
    });

    // 验证键值字典形态：<机娘> 赤星: { 状态: 轻伤, affection_delta: 5 }
    const step3Dict = parseMessageText(
      `<机娘>
赤星:
  状态: 轻伤
  affection_delta: 5
</机娘>`,
      step3.data,
    );
    expect(step3Dict.quarantine).toEqual([]);
    expect(step3Dict.data.forces.girls[0]).toMatchObject({
      name: '赤星',
      hp: '轻伤',
      affection: 73,
    });
  });

  it('Step 4 · girlFiler：同型号一号机与次生二号机分立并存，且二号机从待授名改名时原地覆写世界书条目', () => {
    const unit1 = GirlDossier.parse({
      name: '铁壁',
      callsign: '铁壁',
      serial: '犀牛-01',
      model: '犀牛主战坦克',
      seq: '首台原型',
      faction: '苏联',
      body: '175cm高挑丰满御姐型纳米躯体',
      weapons: '125mm滑膛炮',
      exposure: 'EL-0 ~ EL-4',
      alias: '铁大姐',
      shell: '重型农机站站长',
      personality: '豪爽沉稳',
      status: '北坡主基地驻防',
    });

    const unit2Pending = GirlDossier.parse({
      name: '待授名',
      serial: '犀牛-02',
      model: '犀牛主战坦克',
      seq: '次生二号机',
      faction: '苏联',
      body: '158cm娇小紧致型纳米躯体，银白短发带赤红挑染',
      personality: '沉默执拗、极度护短',
      status: '初诞待指挥官赐名',
    });

    // 验证 formatCapabilityContent 与 formatPlotContent 输出
    const capText = formatCapabilityContent(unit2Pending);
    expect(capText).toContain('[出厂编号] 犀牛-02');
    expect(capText).toContain('[机体序列] 次生二号机');
    expect(capText).toContain('[所属阵营] 苏联');
    expect(capText).toContain('[躯体特征] 158cm娇小紧致型纳米躯体，银白短发带赤红挑染');
    expect(capText).toContain('<数据>');
    expect(capText).toContain('类型: 机娘');
    expect(capText).toContain('编号: 犀牛-02');
    expect(capText).toContain('型号: 犀牛主战坦克');

    const plotText = formatPlotContent(unit2Pending);
    expect(plotText).toContain('社会外壳：暂未编织（基地内勤）');

    // 1. 一号机与待授名二号机入档同一本聊天世界书
    const entries: ThEntry[] = [];
    fileSingleGirlToWorldbook(entries, unit1);
    fileSingleGirlToWorldbook(entries, unit2Pending);

    expect(entries.map(e => e.name).sort()).toEqual(
      [
        `总览·${ROSTER_MARK}`,
        '档案·铁壁·犀牛主战坦克',
        '剧情·铁壁·人格与现状',
        '档案·待授名·犀牛主战坦克',
        '剧情·待授名·人格与现状',
      ].sort(),
    );

    // 2. 指挥官赐名二号机为「赤星」（通过 rename_from 与 serial 双重锚定）
    const unit2Christened = GirlDossier.parse({
      name: '赤星',
      callsign: '赤星',
      serial: '犀牛-02',
      rename_from: '待授名',
      model: '犀牛主战坦克',
      seq: '次生二号机',
      faction: '苏联',
      body: '158cm娇小紧致型纳米躯体，银白短发带赤红挑染，过载时眼瞳亮起赤金十字火控纹',
      skills: '125mm滑膛炮极限过载连射',
      weapons: '125mm纳米滑膛炮',
      exposure: 'EL-0 ~ EL-4',
      alias: '',
      shell: '',
      personality: '平时寡言乖巧，听见指挥官呼唤代号「赤星」时会耳尖发烫',
      status: '已由指挥官赐予代号「赤星」，心智核心完成锚定',
      keys: ['赤星', '犀牛-02', '犀牛二号机'],
    });

    const dRes = upsertDossierEntry(entries, unit2Christened);
    const sRes = upsertStoryEntry(entries, unit2Christened);

    expect(dRes.action).toBe('updated');
    expect(sRes.action).toBe('updated');

    // 验证世界书中无「待授名」残留，且「铁壁」与「赤星」同型号两台机娘分立并存
    expect(entries.map(e => e.name).sort()).toEqual(
      [
        `总览·${ROSTER_MARK}`,
        '档案·铁壁·犀牛主战坦克',
        '剧情·铁壁·人格与现状',
        '档案·赤星·犀牛主战坦克',
        '剧情·赤星·人格与现状',
      ].sort(),
    );

    const chugokuDossier = entries.find(e => e.name === '档案·赤星·犀牛主战坦克')!;
    expect(chugokuDossier.comment).toBe('档案·赤星·犀牛主战坦克');
    expect(chugokuDossier.key).toEqual(['赤星', '犀牛-02', '犀牛二号机']);
    expect(chugokuDossier.content).toContain('[专属代号] 赤星');
    expect(chugokuDossier.content).toContain('[出厂编号] 犀牛-02');
    expect(chugokuDossier.content).toContain('代号: 赤星');

    const chugokuStory = entries.find(e => e.name === '剧情·赤星·人格与现状')!;
    expect(chugokuStory.comment).toBe('剧情·赤星·人格与现状');
    expect(chugokuStory.content).toContain('社会外壳：暂未编织（基地内勤）');

    const roster = entries.find(e => e.name.includes(ROSTER_MARK))!;
    expect(roster.content).toContain('· 铁壁——犀牛主战坦克。');
    expect(roster.content).toContain('· 赤星——犀牛主战坦克。对外：暂未编织（基地内勤）。');
    expect(roster.content).not.toContain('· 待授名——');

    // 3. 验证仅凭 serial（不传 rename_from）回扫 [出厂编号] 也能原地更新
    const unit2RenamedAgain = GirlDossier.parse({
      ...unit2Christened,
      name: '红星',
      callsign: '红星',
      rename_from: '',
      serial: '犀牛-02',
    });
    fileSingleGirlToWorldbook(entries, unit2RenamedAgain);
    expect(entries.some(e => e.name === '档案·红星·犀牛主战坦克')).toBe(true);
    expect(entries.some(e => e.name === '档案·赤星·犀牛主战坦克')).toBe(false);
    expect(entries.some(e => e.name === '档案·铁壁·犀牛主战坦克')).toBe(true);
  });

  it('Step 5 · <机娘档案> 与世界书 <数据> 块 1:1 同构解析、codex 原地转正去重与 JSON <数据> 块入档闭环', () => {
    const baseline = Schema.parse({
      forces: {
        girls: [
          {
            name: '待授名·CM-A01',
            serial: 'CM-A01',
            model: '超时空采矿车',
            seq: '首台原型',
            faction: '盟军',
            hp: '完好',
            traits: ['待授名'],
          },
        ],
      },
      codex: [
        {
          name: '待授名·CM-A01',
          kind: '人员',
          desc: '初诞待授名超时空采矿车机娘',
          params: { 编号: 'CM-A01', 型号: '超时空采矿车' },
        },
      ],
    });

    const raw = `
<机娘档案>
schema_version: 1
type: maiden
id: maiden.allied.chrono_miner_01
name: 白霜
callsign: Chrono-01
serial: CM-A01
rename_from: 待授名·CM-A01
model: 超时空采矿车
seq: 首台原型
faction: 盟军
tier: 1
incubation_mode: blindbox_christen
preset_name: 柳翠
body: 165cm精干型纳米躯体，浅金麻花辫配蓝白防尘工装
appearance: 盟军重工高可视度反光背心与相位锚定腰带
personality: 精打细算、护食惜物的战地后勤管家，对每一克矿石损耗都记在心上
temperament_spectrum: 精打细算、护食惜物的战地后勤大管家
form_mech: 人车一体（重型相位矿石精炼底盘 / 跃迁锚定核心）
special_skills:
  - name: 相位折跃回流
    kind: 核心权能
    desc: 锁定基地精炼厂信标发起短距空间折跃，瞬间脱出敌方火力包夹并完成满载矿石卸料。
  - name: 高密矿脉谐振勘探
    kind: 战术专精
    desc: 利用车载引力波探针扫描地下浅层富集矿脉，提高单次采掘纯度。
special_equipment:
  - name: 重型相位采掘铲
    slot: 核心挂载
    desc: 兼顾高硬度矿脉剥离与近距防卫撞击的工程总成。
  - name: 空间信标锚定仪
    slot: 战术套件
    desc: 与基地矿石精炼厂维持量子纠缠锁定的折跃定位模块。
flaws: 跃迁冷却期间相位电容器处于高敏充能态，一旦遭受强电磁脉冲易引发护盾过载。
exposure_grade: 🟡 中危（作业与折跃瞬间伴随蓝白切伦科夫闪光）
balance_slot: T1 战略经济与后勤核心
alias: 暂未编织
shell: 暂未编织（基地内勤）
status: 已获指挥官赐名「白霜」，正执行首轮矿脉采掘
keys: [白霜, Chrono-01, CM-A01, 相位折跃回流]
</机娘档案>`;

    const res = parseMessageText(raw, baseline);
    expect(res.quarantine).toEqual([]);
    expect(res.data.forces.girls).toHaveLength(1);
    expect(res.data.forces.girls[0].name).toBe('白霜');
    expect(res.data.codex).toHaveLength(1);
    expect(res.data.codex[0].name).toBe('白霜');

    const dossier = res.data.pending_lore[0] as unknown as ReturnType<typeof GirlDossier.parse>;
    expect(dossier.special_skills).toHaveLength(2);
    expect(dossier.special_equipment).toHaveLength(2);
    expect(dossier.exposure_grade).toContain('🟡 中危');

    const entries: ThEntry[] = [];
    fileSingleGirlToWorldbook(entries, dossier);
    const dEntry = entries.find(e => e.name === '档案·白霜·超时空采矿车')!;
    expect(dEntry).toBeDefined();
    expect(dEntry.content).toContain('"type": "maiden"');
    expect(dEntry.content).toContain('"id": "maiden.allied.chrono_miner_01"');
    expect(dEntry.content).toContain('"special_skills"');
    expect(dEntry.content).toContain('"special_equipment"');
  });

  it('BUG-LIVE-18b · #52楼 <机娘档案> 兼容 基础性格/阶段: 待命名 0 隔离，同步 personality 与 data.pending_girls 并在后续赐名转正后自动核销', () => {
    const raw52 = `
<机娘档案>
名称: 待授名·RHT-S01
编号: RHT-S01
型号: 犀牛主战坦克族
序列: 次生原型
阵营: 苏联
躯体特征: 170cm高挑丰腴型重装躯体，银灰长发束成单侧麻花辫
基础性格: 爽朗直率、悍勇守纪，对炮塔膛压与履带张力有近乎偏执的直觉
阶段: "待命名"
</机娘档案>`;

    const step52 = parseMessageText(raw52, {});
    expect(step52.quarantine).toEqual([]);
    expect(step52.data.forces.girls).toHaveLength(1);
    expect(step52.data.forces.girls[0]).toMatchObject({
      name: '待授名·RHT-S01',
      serial: 'RHT-S01',
      model: '犀牛主战坦克族',
      personality: expect.stringContaining('爽朗直率、悍勇守纪'),
      status: '待命名',
    });
    expect(step52.data.pending_girls).toHaveLength(1);
    expect(step52.data.pending_girls?.[0]).toMatchObject({
      name: '待授名·RHT-S01',
      serial: 'RHT-S01',
      model: '犀牛主战坦克族',
      personality: expect.stringContaining('爽朗直率、悍勇守纪'),
      stage: '待命名',
    });

    const raw54 = `
<机娘档案>
名称: 娜塔莎
代号: 娜塔莎
编号: RHT-S01
原名: 待授名·RHT-S01
型号: 犀牛主战坦克族
性格描述: 爽朗直率、悍勇守纪，获赐名「娜塔莎」后自豪地将钢印擦得雪亮
档案阶段: 已归档
</机娘档案>`;

    const step54 = parseMessageText(raw54, step52.data);
    expect(step54.quarantine).toEqual([]);
    expect(step54.data.forces.girls).toHaveLength(1);
    expect(step54.data.forces.girls[0]).toMatchObject({
      name: '娜塔莎',
      callsign: '娜塔莎',
      serial: 'RHT-S01',
      personality: expect.stringContaining('获赐名「娜塔莎」后自豪地将钢印擦得雪亮'),
      status: '已归档',
    });
    expect(step54.data.pending_girls).toEqual([]);
  });

  it('BUG-LIVE-19a/19b · #54楼 <机娘档案> 专属代号/外在着装/能力特征/对外身份/对外代号/现状备注 0 隔离且白凌/喀秋莎(callsign="")不误入 pending_girls', () => {
    const baseline52 = Schema.parse({
      forces: {
        girls: [
          {
            name: '白凌',
            callsign: '',
            serial: 'MCV-A01',
            model: '盟军基地车',
            faction: '盟军',
            status: '',
          },
          {
            name: '喀秋莎',
            callsign: '',
            serial: 'MCV-S01',
            model: '苏联基地车',
            faction: '苏联',
            status: '',
          },
          {
            name: '待授名·RHT-S01',
            callsign: '',
            serial: 'RHT-S01',
            model: '犀牛主战坦克族',
            faction: '苏联',
            status: '待命名',
          },
        ],
      },
      pending_girls: [
        {
          name: '待授名·RHT-S01',
          callsign: '',
          serial: 'RHT-S01',
          model: '犀牛主战坦克族',
          faction: '苏联',
          status: '待命名',
          stage: '待命名',
        },
      ],
    });

    const raw54 = `
<机娘档案>
名称: 娜塔莉亚
专属代号: "娜塔莉亚"
出厂编号: RHT-S01
原名: 待授名·RHT-S01
机体型号: 犀牛主战坦克族
机体序列: 首台原型
所属阵营: 苏联
躯体特征: 170cm高挑丰腴型重装躯体，银灰长发束成单侧麻花辫
外在着装: "苏式深黑防寒装甲乘员皮夹克与高筒战术战靴"
基础性格: "爽朗直率、悍勇守纪"
能力特征: ["大纵深正面突击与125mm滑膛炮火控母板"]
对外身份: "铁砧重工重型矿山机械试车员"
对外代号: "娜塔"
现状备注: "获赐真名「娜塔莉亚」，编入铁砧主基地重装装甲连"
阶段: "已授名"
</机娘档案>`;

    const step54 = parseMessageText(raw54, baseline52);
    expect(step54.quarantine).toEqual([]);
    expect(step54.data.forces.girls).toHaveLength(3);
    const natalia = step54.data.forces.girls.find(g => g.name === '娜塔莉亚')!;
    expect(natalia).toBeDefined();
    expect(natalia).toMatchObject({
      name: '娜塔莉亚',
      callsign: '娜塔莉亚',
      serial: 'RHT-S01',
      model: '犀牛主战坦克族',
      seq: '首台原型',
      faction: '苏联',
      appearance: '苏式深黑防寒装甲乘员皮夹克与高筒战术战靴',
      personality: expect.stringContaining('爽朗直率、悍勇守纪'),
      shell: '铁砧重工重型矿山机械试车员',
      alias: '娜塔',
      status: expect.stringContaining('获赐真名「娜塔莉亚」'),
      traits: ['大纵深正面突击与125mm滑膛炮火控母板'],
    });
    // 白凌、喀秋莎虽 callsign==="" 但已有正式个人真名且 status 不为待命名，绝不误判入 pending_girls
    expect(step54.data.pending_girls).toEqual([]);
  });
});


