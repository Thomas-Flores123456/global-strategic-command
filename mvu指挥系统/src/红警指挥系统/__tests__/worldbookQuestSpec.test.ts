import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface WorldbookEntry {
  uid: number;
  comment: string;
  content: string;
}

interface WorldbookJson {
  entries: Record<string, WorldbookEntry>;
}

describe('FD-29 ~ FD-36 PKG-D: 世界书 uid=18, uid=19 & uid=21 规约校验', () => {
  const wbPath = path.resolve(
    __dirname,
    '../../../../worldbooks/全域战略指挥系统_世界书.json',
  );

  it('worldbooks/全域战略指挥系统_世界书.json 是合法 JSON 且存在 uid=18、uid=19 与 uid=21', () => {
    const rawJson = fs.readFileSync(wbPath, 'utf8');
    let parsed: WorldbookJson | undefined;
    expect(() => {
      parsed = JSON.parse(rawJson) as WorldbookJson;
    }).not.toThrow();

    expect(parsed).toBeDefined();
    expect(parsed?.entries).toBeDefined();

    const uid18 =
      parsed!.entries['18'] ?? Object.values(parsed!.entries).find(e => e.uid === 18);
    expect(uid18).toBeDefined();
    expect(uid18?.uid).toBe(18);
    expect(uid18?.comment).toContain('91·战报输出规约');

    const uid19 =
      parsed!.entries['19'] ?? Object.values(parsed!.entries).find(e => e.uid === 19);
    expect(uid19).toBeDefined();
    expect(uid19?.uid).toBe(19);
    expect(uid19?.comment).toContain('92·战报字段细则');

    const uid21 =
      parsed!.entries['21'] ?? Object.values(parsed!.entries).find(e => e.uid === 21);
    expect(uid21).toBeDefined();
    expect(uid21?.uid).toBe(21);
    expect(uid21?.comment).toContain('93·扩展档案输出规约');
  });

  it('uid=18 包含 <任务>、</任务>、状态: 进行中、奖励: 以及按需输出与自动交割铁律说明', () => {
    const rawJson = fs.readFileSync(wbPath, 'utf8');
    const parsed = JSON.parse(rawJson) as WorldbookJson;
    const uid18 =
      parsed.entries['18'] ?? Object.values(parsed.entries).find(e => e.uid === 18);

    expect(uid18.content).toContain('<任务>');
    expect(uid18.content).toContain('</任务>');
    expect(uid18.content).toContain('状态: 进行中');
    expect(uid18.content).toContain('奖励:');
    expect(uid18.content).toContain('废弃货场清剿');
    expect(uid18.content).toMatch(/按需输出/);
    expect(uid18.content).toMatch(/已完成.*自动/);
    expect(uid18.content).toContain(
      '⚠️ <任务> 仅在任务新发布、阶段推进、达成或失败时按需输出；状态设为「已完成」时系统将自动按奖励字段结算资金（上限10000）、战略资源与机密点，严禁在无任务变化轮次重复输出在途任务表。',
    );
  });

  it('FD-30: uid=18 包含三阶单位/MCV 准入铁律（解锁阵营/解锁蓝图/收编兵力/缴获载具/兵营/战车工厂）与五大跨系统联动奖励说明', () => {
    const rawJson = fs.readFileSync(wbPath, 'utf8');
    const parsed = JSON.parse(rawJson) as WorldbookJson;
    const uid18 =
      parsed.entries['18'] ?? Object.values(parsed.entries).find(e => e.uid === 18);

    // 三阶单位/MCV 准入铁律
    expect(uid18.content).toContain('【全域奖励池与三阶单位/MCV 准入铁律】');
    expect(uid18.content).toContain('解锁阵营');
    expect(uid18.content).toContain('MCV');
    expect(uid18.content).toContain('Tier S');
    expect(uid18.content).toContain('解锁蓝图');
    expect(uid18.content).toContain('兵营');
    expect(uid18.content).toContain('战车工厂');
    expect(uid18.content).toContain('Tier A');
    expect(uid18.content).toContain('收编兵力');
    expect(uid18.content).toContain('缴获载具');
    expect(uid18.content).toContain('Tier B');
    expect(uid18.content).toContain('T3');

    // 五大跨系统联动奖励
    expect(uid18.content).toContain('五大跨系统联动奖励');
    expect(uid18.content).toContain('资金链');
    expect(uid18.content).toContain('协议线索');
    expect(uid18.content).toContain('势力');
    expect(uid18.content).toContain('钱袋');
    expect(uid18.content).toContain('机娘奖励');
    expect(uid18.content).toContain('科研助力');
  });

  it('FD-31: uid=18 的 <态势> 章节包含 参谋建议、白凌、焦点、指令 及结合全局态势/组合诊断输出建议的规范说明', () => {
    const rawJson = fs.readFileSync(wbPath, 'utf8');
    const parsed = JSON.parse(rawJson) as WorldbookJson;
    const uid18 =
      parsed.entries['18'] ?? Object.values(parsed.entries).find(e => e.uid === 18);

    expect(uid18.content).toContain('参谋建议');
    expect(uid18.content).toContain('白凌');
    expect(uid18.content).toContain('凛冬妮娅');
    expect(uid18.content).toContain('薇拉');
    expect(uid18.content).toContain('焦点');
    expect(uid18.content).toContain('建议');
    expect(uid18.content).toContain('指令');
    expect(uid18.content).toContain('[战区全局态势与参谋部八维组合诊断]');
  });

  it('FD-32: uid=21 与 uid=18 包含 <扩展档案> 六大类别、类别: 人物 与 人员 边界、立体设定与动态信任度追踪规范', () => {
    const rawJson = fs.readFileSync(wbPath, 'utf8');
    const parsed = JSON.parse(rawJson) as WorldbookJson;
    const uid18 =
      parsed.entries['18'] ?? Object.values(parsed.entries).find(e => e.uid === 18);
    const uid21 =
      parsed.entries['21'] ?? Object.values(parsed.entries).find(e => e.uid === 21);

    // uid=18 第 ⑭ 槽位说明
    expect(uid18.content).toContain('<扩展档案>');
    expect(uid18.content).toContain('类别: 人物');
    expect(uid18.content).toContain('信任度');

    // uid=21 六大合法类别与人物规范体例
    expect(uid21.content).toContain('科技 | 建筑 | 载具 | 人员 | 装备 | 人物');
    expect(uid21.content).toContain('类别: 人物');
    expect(uid21.content).toContain('类别: 人员');
    expect(uid21.content).toContain('维克托·科尔萨科夫');
    expect(uid21.content).toContain('所属势力');
    expect(uid21.content).toContain('态度');
    expect(uid21.content).toContain('信任度');
    expect(uid21.content).toContain('信任变化');
    expect(uid21.content).toContain('外貌特征');
    expect(uid21.content).toContain('性格与口吻');
    expect(uid21.content).toContain('近期交集');
    expect(uid21.content).toContain('[-25, +25]');
  });

  it('FD-33: uid=18 包含 <情报> 与 <世界演变>、六大情报渠道、可信度跨轮演进、四大演变象限与四阶段 5 轮 TTL 衰减法则', () => {
    const rawJson = fs.readFileSync(wbPath, 'utf8');
    const parsed = JSON.parse(rawJson) as WorldbookJson;
    const uid18 =
      parsed.entries['18'] ?? Object.values(parsed.entries).find(e => e.uid === 18);

    expect(uid18.content).toContain('<情报>');
    expect(uid18.content).toContain('</情报>');
    expect(uid18.content).toContain('<世界演变>');
    expect(uid18.content).toContain('</世界演变>');

    // 六大情报来源渠道
    for (const channel of [
      '雷达侦察',
      '渗透内线',
      '暗网流言',
      '电讯截获',
      '前线目视',
      '宏观广播',
    ]) {
      expect(uid18.content).toContain(channel);
    }

    // 可信度分档与跨轮演进
    expect(uid18.content).toContain('待核实 | 已证实 | 已证伪 | 演进中');
    expect(uid18.content).toContain('演进自');

    // 四大演变象限与五维法则
    for (const domain of ['远方地缘', '位面异象', '暗流科技', '社会黑市']) {
      expect(uid18.content).toContain(domain);
    }
    expect(uid18.content).toContain('萌芽 -> 发酵 -> 高潮 -> 平息');
    expect(uid18.content).toContain('伏笔');
    expect(uid18.content).toContain('太平洋环流异常磁暴与远洋航线断绝');
  });

  it('FD-34: uid=18 包含基地建筑相对于 MCV 原点 (0, 0) 的 坐标 / 方位 及三环布防规约说明', () => {
    const rawJson = fs.readFileSync(wbPath, 'utf8');
    const parsed = JSON.parse(rawJson) as WorldbookJson;
    const uid18 =
      parsed.entries['18'] ?? Object.values(parsed.entries).find(e => e.uid === 18);

    expect(uid18.content).toContain('【基地建筑相对 MCV 原点 (0, 0) 坐标与三环布防规约】');
    expect(uid18.content).toContain('(0, 0)');
    expect(uid18.content).toContain('100m');
    expect(uid18.content).toContain('坐标: [-2, 1]');
    expect(uid18.content).toContain('方位: 西北侧 200米');
    expect(uid18.content).toContain('内环（100~300m）');
    expect(uid18.content).toContain('中环（300~600m）');
    expect(uid18.content).toContain('外环（600~900m）');
    expect(uid18.content).toContain('空间纵深');
  });

  it('FD-36: uid=18 与 uid=19 包含暴露度双驱（[-1.5, +2.0] / floor / EL-1/EL-2 自然冷却）与民心指数（0.0～10.0）五阶法定状态及联动规范', () => {
    const rawJson = fs.readFileSync(wbPath, 'utf8');
    const parsed = JSON.parse(rawJson) as WorldbookJson;
    const uid18 =
      parsed.entries['18'] ?? Object.values(parsed.entries).find(e => e.uid === 18);
    const uid19 =
      parsed.entries['19'] ?? Object.values(parsed.entries).find(e => e.uid === 19);

    // uid=18 暴露度双驱与民心变化/民心事件规约
    expect(uid18.content).toContain('【暴露度双驱规则与民心变化按需输出】');
    expect(uid18.content).toContain('[-1.5, +2.0]');
    expect(uid18.content).toContain('floor');
    expect(uid18.content).toContain('EL-1/EL-2');
    expect(uid18.content).toContain('民心变化');
    expect(uid18.content).toContain('民心事件');
    expect(uid18.content).toContain('[-1.5, +1.5]');

    // uid=19 无人在意
    expect(uid19.content).toContain('四、民心指数（第 0 态「无人在意」+ 0.0～10.0 五阶法定状态）与联动规范');
    expect(uid19.content).toContain('[0.0, 2.0) 沸反盈天（资金链收益 -25%，民众告密每轮暴露 +0.10）');
    expect(uid19.content).toContain('[2.0, 4.0) 人心惶惶（资金链收益 -10%，流言每轮暴露 +0.05）');
    expect(uid19.content).toContain('[4.0, 6.5) 观望顺从（默认基线 5.0，社会秩序平稳）');
    expect(uid19.content).toContain('[6.5, 8.5) 安居归心（资金链收益 +10%，民众协作掩护加速暴露自然冷却 -0.08/轮）');
    expect(uid19.content).toContain('[8.5, 10.0] 万众一心（资金链收益 +20%，人民汪洋铁壁掩护加速暴露自然冷却 -0.12/轮）');
  });

  it('uid=18 保留既有 <态势>、<排产计划>、<事件>、<图鉴>、<选项> 及禁复读标准科技铁律，且全书零 <战况> 标签', () => {
    const rawJson = fs.readFileSync(wbPath, 'utf8');
    const parsed = JSON.parse(rawJson) as WorldbookJson;
    const uid18 =
      parsed.entries['18'] ?? Object.values(parsed.entries).find(e => e.uid === 18);

    expect(uid18.content).toContain('<态势>');
    expect(uid18.content).toContain('<排产计划>');
    expect(uid18.content).toContain('<事件>');
    expect(uid18.content).toContain('<图鉴>');
    expect(uid18.content).toContain('<选项>');
    expect(uid18.content).toContain('⚠️ 严禁复读系统已有标准科技/建筑/单位');
    expect(uid18.content).not.toContain('<战况>');
    expect(uid18.content).not.toContain('</战况>');

    for (const entry of Object.values(parsed.entries)) {
      expect(entry.content).not.toContain('<战况>');
      expect(entry.content).not.toContain('</战况>');
    }
  });

  it('BUG-R2-20: uid=18/23/29 明确约束正常按期推进队列由系统自动完工入库，<生产> 标签请尽可能少用', () => {
    const rawJson = fs.readFileSync(wbPath, 'utf8');
    const parsed = JSON.parse(rawJson) as WorldbookJson;
    const byUid = (u: number) =>
      parsed.entries[String(u)] ?? Object.values(parsed.entries).find(e => e.uid === u);

    for (const uid of [18, 23, 29]) {
      const entry = byUid(uid);
      expect(entry.content).toContain(
        '【重要原则】正常按期推进（工时跑满）的建造、生产、研究、工程队列由系统底层根据 <timePast> 自动完工入库，平时无需输出 <生产> 标签！<生产> 标签请尽可能少用',
      );
    }
  });

  it('uid=0/1/18/23/28 强化玩家节奏主权、适度发挥边界、禁止跨阶段抢跑与慢热模拟经营发育规约', () => {
    const rawJson = fs.readFileSync(wbPath, 'utf8');
    const parsed = JSON.parse(rawJson) as WorldbookJson;
    const byUid = (u: number) =>
      parsed.entries[String(u)] ?? Object.values(parsed.entries).find(e => e.uid === u);

    const uid0 = byUid(0);
    const uid1 = byUid(1);
    const uid18 = byUid(18);
    const uid23 = byUid(23);
    const uid28 = byUid(28);

    expect(uid0?.content).toContain('玩家节奏主权核验');
    expect(uid0?.content).toContain('严禁严重超出指挥官给定的指令范围跨阶段抢跑');
    expect(uid1?.content).toContain('指挥决断权与叙事节奏主权唯一且不可让渡');
    expect(uid1?.content).toContain('严守策略模拟经营的慢热发育质感');
    expect(uid18?.content).toContain('将步幅控制权交予指挥官');
    expect(uid23?.content).toContain('因果协同与步幅受控');
    expect(uid28?.content).toContain('严禁越权擅自触发 MCV展开');
  });

  it('任务2定版收口：uid=18 包含 ⑤ <阵营解锁> 锁死三大阵营规约与 ⑦ <工程> / ⑨ <航天合同> 开发态实验特性门禁，且专项条目完整保留', () => {
    const rawJson = fs.readFileSync(wbPath, 'utf8');
    const parsed = JSON.parse(rawJson) as WorldbookJson;
    const byUid = (u: number) =>
      parsed.entries[String(u)] ?? Object.values(parsed.entries).find(e => e.uid === u);

    const uid18 = byUid(18);
    const uid24 = byUid(24);
    const uid32 = byUid(32);

    expect(uid18?.content).toContain(
      '⑤ <阵营解锁>（严格锁死三大官方阵营：盟军 / 苏联 / 尤里，严禁 LLM 自创任何新阵营或野生基地车！战区外围财阀与地方组织请使用第5层 <扩展档案> 的 类别: 势力 记录）',
    );
    expect(uid18?.content).toContain(
      '⑦ <工程>（⚠️ 开发态实验特性·生产环境默认关闭：除非指挥官在输入中明确下达【工程】或【航天】指令，否则常规轮次严禁主动输出 <工程> 与 <航天合同> 标签！）',
    );
    expect(uid18?.content).toContain(
      '⑨ <航天合同>（⚠️ 开发态实验特性·生产环境默认关闭：除非指挥官在输入中明确下达【工程】或【航天】指令，否则常规轮次严禁主动输出 <工程> 与 <航天合同> 标签！）',
    );
    expect(uid24?.comment).toContain('25·工程指令响应协议');
    expect(uid24?.content.length).toBeGreaterThan(100);
    expect(uid32?.comment).toContain('28·天基航天合同上报规约');
    expect(uid32?.content.length).toBeGreaterThan(100);
  });

  it('FD-47: uid=18 包含五阶战役任务分发原则、六大预设任务系列与在途悬赏保真交割规范', () => {
    const rawJson = fs.readFileSync(wbPath, 'utf8');
    const parsed = JSON.parse(rawJson) as WorldbookJson;
    const uid18 =
      parsed.entries['18'] ?? Object.values(parsed.entries).find(e => e.uid === 18);

    // 五阶战役任务分发原则与六大预设任务系列
    expect(uid18.content).toContain('【五阶战役任务分发原则与六大预设任务系列】');
    expect(uid18.content).toContain('阶段0（原世界序章）与阶段1（被动静默待机）严禁派发任何系统 `<任务>`');
    expect(uid18.content).toContain('★ [参谋部候选派发任务提案]');
    expect(uid18.content).toContain('任务线索');
    expect(uid18.content).toContain('白凌/凛冬妮娅/薇拉/喀秋莎/尤里卡');
    expect(uid18.content).toContain('>= 3');

    for (const seriesAndArchetype of [
      '开局踏勘与首基立脚',
      '勘界定址',
      '破障通电',
      '耳目初张',
      '经济命脉与资金链开拓',
      '废铁回流',
      '黑市暗桩',
      '紧缺寻源',
      '军工蓝图破译与战地收编',
      '重工遗珍',
      '残部收容',
      '逆向攻关',
      '情报溯源与隐蔽战线',
      '线报核查',
      '电磁静默',
      '雪中送炭',
      '暗流截击',
      '机娘羁绊与人物折冲',
      '机魂试炼',
      '势力折冲',
      '战略跃迁与跨阵营MCV启封',
      '铁幕回响',
      '心灵暗涌',
    ]) {
      expect(uid18.content).toContain(seriesAndArchetype);
    }

    // 在途悬赏保真与完结交割规范
    expect(uid18.content).toContain('【在途悬赏保真与完结交割规范】');
    expect(uid18.content).toContain('承诺悬赏');
    expect(uid18.content).toContain('战利品');
    expect(uid18.content).toContain('严禁结案时漏写或缩水原定奖励');
  });

  it('FD-48: uid=18 包含多环系列任务链（系列/环数/后续任务）规约与「预设仅作参考、按现场态势自主发挥」铁律', () => {
    const rawJson = fs.readFileSync(wbPath, 'utf8');
    const parsed = JSON.parse(rawJson) as WorldbookJson;
    const uid18 =
      parsed.entries['18'] ?? Object.values(parsed.entries).find(e => e.uid === 18);

    // 多环系列任务链（系列 / 环数 / 后续任务）与渐进铺垫规约
    expect(uid18.content).toContain('【多环系列任务链（系列 / 环数 / 后续任务）与渐进铺垫规约】');
    expect(uid18.content).toContain('`系列`');
    expect(uid18.content).toContain('`环数`');
    expect(uid18.content).toContain('`后续任务`');
    expect(uid18.content).toContain('1/3');
    expect(uid18.content).toContain('2/3');
    expect(uid18.content).toContain('3/3');
    expect(uid18.content).toContain('系列任务链');
    expect(uid18.content).toContain('★ [系列任务下一环续接契机]');

    // 预设原型仅作参考·严禁机械照抄·按现场态势自主发挥铁律
    expect(uid18.content).toContain('【预设原型仅作参考·严禁机械照抄·按现场态势自主发挥铁律】');
    expect(uid18.content).toContain('参考骨架');
    expect(uid18.content).toContain('严禁机械照抄参考标题或生搬硬套固定地名');
    expect(uid18.content).toContain('自主发挥拟定鲜活的任务名称、系列主题、具体阶段目标与后续演进线索');

    // <任务> 示例块字段展示
    expect(uid18.content).toContain('系列: 北郊工业动脉复苏');
    expect(uid18.content).toContain('环数: 1/2');
    expect(uid18.content).toContain('后续任务: 修复货场编组支线并打通废钢外运通道');
  });

  it('FD-49: uid=21 包含「六、文风语域与受控质感铁律」与「七、触发词（keys）精确专名铁律」，且控制字段保持不变', () => {
    const rawJson = fs.readFileSync(wbPath, 'utf8');
    const parsed = JSON.parse(rawJson) as {
      entries: Record<string, WorldbookEntry & Record<string, unknown>>;
    };
    const uid21 =
      parsed.entries['21'] ?? Object.values(parsed.entries).find(e => e.uid === 21);

    expect(uid21).toBeDefined();
    expect(uid21.order).toBe(89025);
    expect(uid21.position).toBe(4);
    expect(uid21.depth).toBe(1);
    expect(uid21.role).toBe(0);

    // 第六条：文风语域与受控质感铁律
    expect(uid21.content).toContain('六、文风语域与受控质感铁律');
    expect(uid21.content).toContain(
      '世界内冷峻军工技术备忘录体或总参谋部人物卷宗体',
    );
    expect(uid21.content).toContain(
      '严禁出现“生态位”、“T1电力语言”、“不叠加百分比”、“触发词说明”等策划免责黑话或管线元语言',
    );
    expect(uid21.content).toContain(
      '既有装备改装升级一律走 <数据更新>，在编机娘日常状态与好感变动一律走 <机娘>',
    );

    // 第七条：触发词（keys）精确专名铁律
    expect(uid21.content).toContain('七、触发词（keys）精确专名铁律');
    expect(uid21.content).toContain('触发词列表仅限填写 2~4 个高区分度专有名词');
    expect(uid21.content).toContain(
      '严禁填写功能泛词（如 防御、侦察、装甲、科技、建筑、基地、盟军 等）或裸单字母（如 R、T1 等）',
    );

    // 系统映射尾注保持不变
    expect(uid21.content).toContain(
      '*系统映射：kind=meta-rule | tier=T0 | slot=protocol.core.extended_archive_doctrine*',
    );
  });

  it('FD-50: uid=18 <情报> 包含多阶情报链（情报链/阶数/下一阶线索）、三阶溯源递进（捕风捉影/交叉印证/水落石出）、终局派生 <任务>/<扩展档案>/<协议> 转化闭环与「严禁机械照抄/结合现场态势自主发挥」最高铁律', () => {
    const rawJson = fs.readFileSync(wbPath, 'utf8');
    const parsed = JSON.parse(rawJson) as WorldbookJson;
    const uid18 =
      parsed.entries['18'] ?? Object.values(parsed.entries).find(e => e.uid === 18);

    // 多阶情报链 / 侦察溯源链（Intel Chain）三字段与别名
    expect(uid18.content).toContain('【多阶情报链 / 侦察溯源链（Intel Chain）与终局战略转化规约】');
    expect(uid18.content).toContain('`情报链`');
    expect(uid18.content).toContain('侦察链 / 溯源链 / 案卷');
    expect(uid18.content).toContain('`阶数`');
    expect(uid18.content).toContain('`下一阶线索`');
    expect(uid18.content).toContain('下一步核查 / 任务线索');

    // 三阶溯源递进与同链原地升阶
    expect(uid18.content).toContain('第 1/3 阶·捕风捉影');
    expect(uid18.content).toContain('第 2/3 阶·交叉印证');
    expect(uid18.content).toContain('第 3/3 阶·水落石出');
    expect(uid18.content).toContain('原位升阶更新该情报并串联 `演进自`');

    // 终局水落石出战略转化闭环
    expect(uid18.content).toContain('终局水落石出战略转化闭环');
    expect(uid18.content).toContain('顺势派生关联 `<任务>`');
    expect(uid18.content).toContain('新增/更新 `<扩展档案>`（类别: 人物/势力）');
    expect(uid18.content).toContain('解锁战略 `<协议>` 线索');

    // 「参考不绑死·按现场态势自主发挥」最高铁律
    expect(uid18.content).toContain('🔴【参考不绑死·按现场态势自主发挥最高铁律】');
    expect(uid18.content).toContain('仅作「三阶递进节奏 + 渠道接力 + 终局转化钩子」的参考骨架');
    expect(uid18.content).toContain('严禁机械照抄参考标题或生搬硬套固定地名');
    expect(uid18.content).toContain('紧密结合当前战区真实地貌、敌我态势、在场机娘/NPC 与前文伏笔');
    expect(uid18.content).toContain('顺延你在上一阶自己写下的 `情报链` 与 `下一阶线索`');

    // <情报> YAML 示例字段
    expect(uid18.content).toContain('情报链: 东郊地下能源中继溯源');
    expect(uid18.content).toContain('阶数: 1/3');
    expect(uid18.content).toContain(
      '下一阶线索: 调动雷达侦察或派遣先遣侦察班抵近核查东郊变电站地下频段',
    );
  });

  it('FD-51: uid=18/uid=19 包含多轨物资与货币链网、五大链条物理三要素前置及本土商路禁直印系统币铁律', () => {
    const rawJson = fs.readFileSync(wbPath, 'utf8');
    const parsed = JSON.parse(rawJson) as WorldbookJson;
    const uid18 =
      parsed.entries['18'] ?? Object.values(parsed.entries).find(e => e.uid === 18);
    const uid19 =
      parsed.entries['19'] ?? Object.values(parsed.entries).find(e => e.uid === 19);

    // uid=18 & uid=19 FD-51 规约标题与五大链条物理类型
    expect(uid18.content).toContain('【多轨物资与货币链网及物理三要素硬前置铁律（FD-51）】');
    expect(uid19.content).toContain('【多轨物资与货币链网及物理三要素硬前置铁律（FD-51）】');

    for (const kind of [
      '采矿精炼',
      '废料回收',
      '油气化工',
      '本土商路',
      '工业转化',
      '后勤维护',
    ]) {
      expect(uid18.content).toContain(kind);
      expect(uid19.content).toContain(kind);
    }

    // 物理三要素硬前置与三轨收支隔离铁律
    expect(uid19.content).toContain('链条类型');
    expect(uid19.content).toContain('矿石精炼厂');
    expect(uid19.content).toContain('采矿车');
    expect(uid19.content).toContain('依赖载具');
    expect(uid19.content).toContain('依赖资源');
    expect(uid19.content).toContain('严禁无精炼厂或无矿车时凭空建采矿链');
    expect(uid19.content).toContain('`本土商路` 严禁直接产出系统资金 `Credits`');
    expect(uid19.content).toContain('外币日收支');
    expect(uid19.content).toContain('wallet_daily');
    expect(uid19.content).toContain('货物日收支');
    expect(uid19.content).toContain('resources_daily');

    // PdaTabChains.vue 多轨绑定与既有 testid 兼容核验
    const pdaChainsPath = path.resolve(
      __dirname,
      '../../中控悬浮窗/pda/PdaTabChains.vue',
    );
    const pdaChainsVue = fs.readFileSync(pdaChainsPath, 'utf8');
    for (const testId of [
      'pda-tab-chains',
      'pda-chains-summary-bar',
      'pda-chains-daily-net',
      'pda-chain-card',
      'pda-chain-flow',
      'pda-chain-name',
      'pda-chain-status',
      'pda-chain-rate',
      'pda-chain-eff',
      'pda-chain-reason-alert',
      'pda-chain-capacity',
      'pda-chain-kind',
      'pda-chain-multitrack',
      'pda-chain-deps',
    ]) {
      expect(pdaChainsVue).toContain(testId);
    }
    expect(pdaChainsVue).toContain('chain_kind');
    expect(pdaChainsVue).toContain('wallet_daily');
    expect(pdaChainsVue).toContain('resources_daily');
  });
});
