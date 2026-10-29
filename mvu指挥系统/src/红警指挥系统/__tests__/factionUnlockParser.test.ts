import { describe, expect, it } from 'vitest';
import {
  isSafeCssColor,
  parseFactionUnlockPayload,
  resolveFactionCardTheme,
} from '../parse/factionUnlockParser';
import { extractEvents, parseMessageText } from '../parse/parsePipeline';
import { Schema } from '../core/schema';

describe('CMD-PARSE-01 · factionUnlockParser & <事件> 副官指派三色门', () => {
  describe('isSafeCssColor & resolveFactionCardTheme', () => {
    it('允许安全的 Hex / RGB / RGBA / HSL / HSLA 颜色格式', () => {
      expect(isSafeCssColor('#f00')).toBe(true);
      expect(isSafeCssColor('#c93b2b')).toBe(true);
      expect(isSafeCssColor('#c93b2bff')).toBe(true);
      expect(isSafeCssColor('rgb(201, 59, 43)')).toBe(true);
      expect(isSafeCssColor('rgba(201, 59, 43, 0.85)')).toBe(true);
      expect(isSafeCssColor('hsl(210, 80%, 50%)')).toBe(true);
      expect(isSafeCssColor('hsla(210, 80%, 50%, 0.5)')).toBe(true);
    });

    it('严厉拦截包含注入字符或危险函数的恶意 CSS 色值', () => {
      expect(isSafeCssColor('#c93b2b; background: url(javascript:alert(1))')).toBe(false);
      expect(isSafeCssColor('red} body { display: none')).toBe(false);
      expect(isSafeCssColor('url(https://evil.example/x.png)')).toBe(false);
      expect(isSafeCssColor('expression(alert(1))')).toBe(false);
      expect(isSafeCssColor('var(--evil-token)')).toBe(false);
      expect(isSafeCssColor('<script>alert(1)</script>')).toBe(false);
      expect(isSafeCssColor('javascript:alert(1)')).toBe(false);
      expect(isSafeCssColor('')).toBe(false);
      expect(isSafeCssColor(null)).toBe(false);
    });

    it('resolveFactionCardTheme 对三大阵营返回默认色板，并对非法自定义色值安全回退', () => {
      const sov = resolveFactionCardTheme('苏联');
      expect(sov).toEqual({ primary: '#c93b2b', accent: '#d4a84f', bg: '#140c0c' });

      const allied = resolveFactionCardTheme('allied', {
        primary: '#1d4ed8',
        accent: 'url(javascript:evil)',
        bg: '#0b1324; position:fixed',
      });
      expect(allied).toEqual({
        primary: '#1d4ed8',
        accent: '#38bdf8',
        bg: '#0b1324',
      });

      const yuri = resolveFactionCardTheme('尤里');
      expect(yuri).toEqual({ primary: '#7e22ce', accent: '#c084fc', bg: '#160b24' });
    });
  });

  describe('parseFactionUnlockPayload', () => {
    it('完整解析 YAML 格式的 <阵营解锁> 载荷', () => {
      const raw = `
阵营: 苏联
标题: 苏维埃钢铁洪流启封
副标题: 重装工业与高压电网体系已接入指挥网
配色:
  主色: "#c93b2b"
  辉光色: "#f59e0b"
  背景色: "#140c0c"
徽章: 红星重装徽记
首发机娘: 喀秋莎
机娘型号: MCV（苏联）
机娘寄语: 指挥官同志，重工车间随时待命！
阵营详情:
  核心教范: 装甲集群突击
  电力特征: 高压谐振并网
初始授权:
  - 苏联建造场
  - 磁能反应炉
  - 苏联矿石精炼厂
`;
      const res = parseFactionUnlockPayload(raw);
      expect(res).not.toBeNull();
      expect(res!.factionId).toBe('soviet');
      expect(res!.factionLabel).toBe('苏联');
      expect(res!.title).toBe('苏维埃钢铁洪流启封');
      expect(res!.subtitle).toBe('重装工业与高压电网体系已接入指挥网');
      expect(res!.theme).toEqual({
        primary: '#c93b2b',
        accent: '#f59e0b',
        bg: '#140c0c',
      });
      expect(res!.badge).toBe('红星重装徽记');
      expect(res!.starterGirlName).toBe('喀秋莎');
      expect(res!.starterGirlModel).toBe('MCV（苏联）');
      expect(res!.starterGirlQuote).toBe('指挥官同志，重工车间随时待命！');
      expect(res!.details).toEqual({
        核心教范: '装甲集群突击',
        电力特征: '高压谐振并网',
      });
      expect(res!.initialGrants).toEqual(['苏联建造场', '磁能反应炉', '苏联矿石精炼厂']);
    });

    it('缺省字段自动用 resolveStarterMcvInfo 回填，且拦截恶意 CSS 色值', () => {
      const raw = `
阵营: 盟军
配色:
  主色: "expression(alert(1))"
  辉光色: "#60a5fa"
初始授权: 盟军建造场、发电厂、矿石精炼厂
`;
      const res = parseFactionUnlockPayload(raw);
      expect(res).not.toBeNull();
      expect(res!.factionId).toBe('allied');
      expect(res!.factionLabel).toBe('盟军');
      expect(res!.starterGirlName).toBe('白凌');
      expect(res!.starterGirlModel).toBe('MCV（盟军）');
      expect(res!.theme.primary).toBe('#2563eb'); // 非法色值回退默认
      expect(res!.theme.accent).toBe('#60a5fa'); // 合法自定义色值保留
      expect(res!.theme.bg).toBe('#0b1324');
      expect(res!.initialGrants).toEqual(['盟军建造场', '发电厂', '矿石精炼厂']);
    });

    it('空内容或无法识别阵营时返回 null', () => {
      expect(parseFactionUnlockPayload('')).toBeNull();
      expect(parseFactionUnlockPayload('   ')).toBeNull();
      expect(parseFactionUnlockPayload('阵营: 赛博坦星人\n标题: 未知')).toBeNull();
    });
  });

  describe('parseMessageText · <阵营解锁> 提取与隔离', () => {
    it('从楼层文本提取 <阵营解锁> 及同义标签 <阵营启封> 到 factionUnlocks，非法块记入 quarantine', () => {
      const base = Schema.parse({});
      const text = `
正文叙事……
<阵营解锁>
阵营: 苏联
标题: 苏联阵营启封
</阵营解锁>
<阵营启封>
首发机娘: 尤里卡
</阵营启封>
<faction_unlock>
阵营: 未知外星阵营
</faction_unlock>
`;
      const res = parseMessageText(text, base);
      expect(res.factionUnlocks).toHaveLength(2);
      expect(res.factionUnlocks[0].factionId).toBe('soviet');
      expect(res.factionUnlocks[1].factionId).toBe('yuri');
      expect(res.factionUnlocks[1].starterGirlName).toBe('尤里卡');
      expect(res.quarantine.some(q => q.tag === '阵营解锁')).toBe(true);
    });
  });

  describe('<事件> 副官指派 · 三色裁决门', () => {
    it('🟢 绿灯：标准预设（MCV 机娘 / 人类参谋 / 主指挥官兼任）通过并由引擎锁定 upkeep_daily', () => {
      const raw = `
- 类型: 副官指派
  席位类型: 阵营主责
  所属阵营: 苏联
  副官身份: MCV机娘
  副官姓名: 喀秋莎
  副官头衔: 苏联MCV移动基地车核心
  专长预设: 重工催产督导
  代价预设: 苏式高压并网冲击
  理由: 喀秋莎出任苏联阵营主责副官
- 类型: 副官指派
  席位类型: 参谋增益
  所属阵营: 盟军
  副官身份: 人类
  副官姓名: 维拉
  副官头衔: 后勤精算参谋
  专长预设: 战区后勤精算
  理由: 聘任人类后勤参谋
- 类型: 副官指派
  席位类型: 阵营主责
  所属阵营: 尤里
  副官身份: 主指挥官兼任
  副官姓名: 主指挥官兼任
  理由: 暂由指挥官直辖兼任
`;
      const gate = extractEvents(raw);
      expect(gate.quarantineEvents).toHaveLength(0);
      expect(gate.yellowEvents).toHaveLength(0);
      expect(gate.greenEvents).toHaveLength(3);

      const mcvAdj = gate.greenEvents[0].adjutant!;
      expect(mcvAdj).toEqual({
        role: 'faction',
        faction: 'soviet',
        identity: 'mcv_girl',
        name: '喀秋莎',
        title: '苏联MCV移动基地车核心',
        buff_preset: 'heavy_industry_drive',
        buff_name: '重工催产督导',
        upkeep_daily: 0,
        penalty_preset: 'pen_sov_grid_surge',
        penalty_name: '苏式高压并网冲击',
        reason: '喀秋莎出任苏联阵营主责副官',
      });

      const humanAdj = gate.greenEvents[1].adjutant!;
      expect(humanAdj.role).toBe('staff');
      expect(humanAdj.identity).toBe('human');
      expect(humanAdj.buff_preset).toBe('logistics_actuary');
      expect(humanAdj.upkeep_daily).toBe(80);

      const selfAdj = gate.greenEvents[2].adjutant!;
      expect(selfAdj.identity).toBe('commander_self');
      expect(selfAdj.buff_preset).toBe('');
      expect(selfAdj.upkeep_daily).toBe(0);
    });

    it('🟡 黄灯：动词别名（任命副官/参谋指派/委任副官）与专长/代价别名自动归一并记录 repairs', () => {
      const raw = `
- 类型: 任命副官
  所属阵营: 苏联
  副官身份: MCV机娘
  副官姓名: 喀秋莎
  专长预设: 重工催产
  代价预设: 高压并网冲击
  理由: 别名测试
`;
      const gate = extractEvents(raw);
      expect(gate.quarantineEvents).toHaveLength(0);
      expect(gate.greenEvents).toHaveLength(0);
      expect(gate.yellowEvents).toHaveLength(1);

      const y = gate.yellowEvents[0];
      expect(y.declaration.verb).toBe('副官指派');
      expect(y.declaration.kind).toBe('adjutant');
      expect(y.declaration.adjutant?.buff_preset).toBe('heavy_industry_drive');
      expect(y.declaration.adjutant?.penalty_preset).toBe('pen_sov_grid_surge');
      expect(y.repairs.some(r => r.includes('任命副官'))).toBe(true);
      expect(y.repairs.some(r => r.includes('重工催产'))).toBe(true);
      expect(y.repairs.some(r => r.includes('高压并网冲击'))).toBe(true);
    });

    it('🔴 红灯隔离：越权篡改资金/手写自由倍率/日薪或未知预设直接打入 quarantineEvents', () => {
      const raw = `
- 类型: 副官指派
  所属阵营: 苏联
  副官身份: 人类
  副官姓名: 贪婪参谋
  专长预设: 重工催产督导
  资金: 99999
- 类型: 副官指派
  所属阵营: 盟军
  副官身份: 人类
  副官姓名: 魔改参谋
  专长预设: 高压电网调谐
  倍率: 2.5
- 类型: 副官指派
  所属阵营: 盟军
  副官身份: 人类
  副官姓名: 逃薪参谋
  专长预设: 高压电网调谐
  upkeep_daily: 0
- 类型: 副官指派
  所属阵营: 苏联
  副官身份: 人类
  副官姓名: 幻想参谋
  专长预设: 全图秒杀光环
- 类型: 副官指派
  所属阵营: 苏联
  副官身份: MCV机娘
  副官姓名: 喀秋莎
  专长预设: 重工催产督导
  代价预设: 虚空代价预设
`;
      const gate = extractEvents(raw);
      expect(gate.greenEvents).toHaveLength(0);
      expect(gate.yellowEvents).toHaveLength(0);
      expect(gate.quarantineEvents).toHaveLength(5);
      expect(gate.quarantineEvents[0].error).toContain('资金');
      expect(gate.quarantineEvents[1].error).toContain('倍率');
      expect(gate.quarantineEvents[2].error).toContain('upkeep_daily');
      expect(gate.quarantineEvents[3].error).toContain('未知专长预设');
      expect(gate.quarantineEvents[4].error).toContain('未知磨合代价预设');
    });
  });
});
