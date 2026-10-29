import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildExpansionDossierCardDom,
  buildTacticalIntelCardDom,
  buildTacticalQuestCardDom,
  buildTacticalSituationCardDom,
  hydrateFloorCardHost,
  mountExpansionDossierCard,
  mountTacticalIntelCard,
  mountTacticalQuestCard,
  parseExpansionDossierPayload,
  parseTacticalIntelPayload,
  parseTacticalQuestPayload,
  parseTacticalSituationPayload,
} from '../cards/floorCardHydrator';
import {
  SYSTEM_TAVERN_REGEX_REGISTRY,
  TACTICAL_INTEL_REGEX_ID,
  TACTICAL_QUEST_REGEX_ID,
} from '../../红警指挥系统/worldbook/tavernRegexPipeline';

class MockElement {
  tagName: string;
  id = '';
  className = '';
  type = '';
  value = '';
  textContent = '';
  innerHTML = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> & { setProperty: (k: string, v: string) => void } = Object.assign(
    {},
    {
      setProperty(k: string, v: string) {
        this[k] = v;
      },
    },
  );
  children: MockElement[] = [];
  parentNode: MockElement | null = null;
  ownerDocument: MockDocument;
  private attrs = new Map<string, string>();
  private listeners = new Map<string, Array<(evt?: unknown) => void>>();

  constructor(tag: string, doc: MockDocument) {
    this.tagName = tag.toLowerCase();
    this.ownerDocument = doc;
  }

  setAttribute(name: string, val: string): void {
    const str = String(val);
    this.attrs.set(name, str);
    if (name === 'id') this.id = str;
    if (name === 'class') this.className = str;
    if (name.startsWith('data-')) {
      const camel = name
        .slice(5)
        .replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
      this.dataset[camel] = str;
    }
  }

  getAttribute(name: string): string | null {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    if (this.attrs.has(name)) return this.attrs.get(name)!;
    if (name.startsWith('data-')) {
      const camel = name
        .slice(5)
        .replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
      return this.dataset[camel] ?? null;
    }
    return null;
  }

  appendChild(child: MockElement): MockElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addEventListener(evt: string, cb: (e?: unknown) => void): void {
    const arr = this.listeners.get(evt) ?? [];
    arr.push(cb);
    this.listeners.set(evt, arr);
  }

  dispatchEvent(evt: { type?: string }): boolean {
    const type = evt?.type ?? 'input';
    for (const cb of this.listeners.get(type) ?? []) {
      cb(evt);
    }
    return true;
  }

  focus(): void {
    for (const cb of this.listeners.get('focus') ?? []) {
      cb();
    }
  }

  click(): void {
    for (const cb of this.listeners.get('click') ?? []) {
      cb();
    }
  }

  private matches(selector: string): boolean {
    if (selector.startsWith('#')) {
      return this.id === selector.slice(1);
    }
    const attrMatch = selector.match(/^\[([a-zA-Z0-9_-]+)="([^"]+)"\]$/);
    if (attrMatch) {
      return this.getAttribute(attrMatch[1]) === attrMatch[2];
    }
    const tagCls = selector.match(/^([a-zA-Z0-9_-]+)?\.([a-zA-Z0-9_-]+)$/);
    if (tagCls) {
      const [, t, c] = tagCls;
      if (t && this.tagName !== t.toLowerCase()) return false;
      return this.className.split(/\s+/).includes(c);
    }
    return this.tagName === selector.toLowerCase();
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const out: MockElement[] = [];
    const walk = (n: MockElement) => {
      for (const ch of n.children) {
        if (ch.matches(selector)) out.push(ch);
        walk(ch);
      }
    };
    walk(this);
    return out;
  }

  collectText(): string {
    if (this.children.length === 0) return this.textContent;
    return this.textContent + this.children.map(c => c.collectText()).join(' ');
  }
}

class MockDocument {
  body: MockElement;
  documentElement: MockElement;
  head: MockElement;
  constructor() {
    this.documentElement = new MockElement('html', this);
    this.head = new MockElement('head', this);
    this.body = new MockElement('body', this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }
  createElement(tag: string): MockElement {
    return new MockElement(tag, this);
  }
  querySelector(selector: string): MockElement | null {
    return this.documentElement.querySelector(selector);
  }
  querySelectorAll(selector: string): MockElement[] {
    return this.documentElement.querySelectorAll(selector);
  }
}

function makeHost(doc: MockDocument, cardType: string, payload: string): MockElement {
  const host = doc.createElement('div');
  host.className = 'tw-floor-card-host';
  host.setAttribute('data-tw-card', cardType);
  const script = doc.createElement('script');
  script.className = 'tw-raw-payload';
  script.textContent = payload;
  host.appendChild(script);
  doc.body.appendChild(host);
  return host;
}

describe('FD-29 PKG-B · <任务> 战区作战任务指令书解析与楼层卡片水合', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).getChatMessages;
  });

  it('SYSTEM_TAVERN_REGEX_REGISTRY 注册 TACTICAL_QUEST_REGEX_ID 并准确替换 <任务> 标签', () => {
    const spec = SYSTEM_TAVERN_REGEX_REGISTRY.find(r => r.id === TACTICAL_QUEST_REGEX_ID);
    expect(spec).toBeDefined();
    expect(spec?.script_name).toBe('系统·战区作战任务指令书卡片挂载');

    const raw = '<任务>\n- 名称: 铁幕前哨·废弃货场清剿\n  状态: 进行中\n</任务>';
    const replaced = raw.replace(new RegExp(spec!.find_regex, 'g'), spec!.replace_string);
    expect(replaced).toContain('data-tw-card="tactical-quest"');
    expect(replaced).toContain('data-tw-title="战区作战任务指令与悬赏回执"');
    expect(replaced).toContain('- 名称: 铁幕前哨·废弃货场清剿\n  状态: 进行中');
  });

  it('parseTacticalQuestPayload 支持结构化 YAML 奖励对象与纯文本奖励字符串双形态解析', () => {
    const yamlInput = `
<任务>
- 名称: 铁幕前哨·废弃货场清剿
  类别: 主线
  状态: 进行中
  发包方: 盟军战区联席参谋部 / 白凌
  进度: 1/3 · 已完成外围工兵侦察
  要点: 清除盘踞在废弃货运站内的游荡武装，夺取完整铁轨调度控制室
  详情: 货运站存有可回收高纯度工业钢材与柴油储备，打通后可建立稳定的废料回收点。
  奖励:
    资金: 1500
    机密点: 15
    资源:
      建材:
        钢材: 300
      燃油:
        军用柴油: 150
    战利品: [废弃货场控制权, 区域铁轨拓扑图]
</任务>
`;
    const parsed = parseTacticalQuestPayload(yamlInput);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.compactSummary).toBe('[主线] 铁幕前哨·废弃货场清剿(进行中) · 共 1 项任务');

    const item = parsed.items[0];
    expect(item.name).toBe('铁幕前哨·废弃货场清剿');
    expect(item.category).toBe('主线');
    expect(item.status).toBe('进行中');
    expect(item.issuer).toBe('盟军战区联席参谋部 / 白凌');
    expect(item.progress).toBe('1/3 · 已完成外围工兵侦察');
    expect(item.note).toBe('清除盘踞在废弃货运站内的游荡武装，夺取完整铁轨调度控制室');
    expect(item.detail).toContain('货运站存有可回收高纯度工业钢材与柴油储备');
    expect(item.rewardBadges).toEqual([
      '资金 +1500',
      '机密点 +15',
      '钢材 +300',
      '军用柴油 +150',
      '废弃货场控制权',
      '区域铁轨拓扑图',
    ]);
    expect(item.rewardSummary).toContain('资金 +1500 · 机密点 +15 · 钢材 +300');

    // 字符串简写奖励解析
    const strRewardInput = `
- 名称: 紧急空投物资护航
  类别: 紧急
  状态: 已完成
  奖励: 资金+1500，钢材+300，防空警戒权限
`;
    const parsedStr = parseTacticalQuestPayload(strRewardInput);
    expect(parsedStr.items).toHaveLength(1);
    expect(parsedStr.items[0].category).toBe('紧急');
    expect(parsedStr.items[0].status).toBe('已完成');
    expect(parsedStr.items[0].rewardBadges).toEqual(['资金 +1500', '钢材 +300', '防空警戒权限']);
  });

  it('水合 tactical-quest 卡片：渲染任务槽位、状态徽章、奖励胶囊，并支持点击「▶ 推进此任务」填入 #send_textarea', () => {
    const doc = new MockDocument();
    const textarea = doc.createElement('textarea');
    textarea.setAttribute('id', 'send_textarea');
    doc.body.appendChild(textarea);

    const inputSpy = vi.fn();
    const focusSpy = vi.fn();
    textarea.addEventListener('input', inputSpy);
    textarea.addEventListener('focus', focusSpy);

    const payload = `
- 名称: 铁幕前哨·废弃货场清剿
  类别: 主线
  状态: 进行中
  发包方: 盟军战区联席参谋部 / 白凌
  进度: 1/3 · 已完成外围工兵侦察
  要点: 夺取铁轨调度控制室
  详情: 打通后可建立稳定的废料回收点
  奖励:
    资金: 1500
    机密点: 15
    资源:
      建材:
        钢材: 300
    战利品: [废弃货场控制权]
- 名称: 北坡哨站通电测试
  类别: 支线
  状态: 已完成
  进度: 1/1 · 并网成功
  奖励: 资金+500
- 名称: 旧雷达站抢修
  类别: 紧急
  状态: 已失败
  进度: 超时损毁
`;

    const host = makeHost(doc, 'tactical-quest', payload);
    expect(hydrateFloorCardHost(host as unknown as HTMLElement)).toBe(true);

    const card = host.querySelector('[data-test="tactical-quest-card"]')!;
    expect(card).not.toBeNull();
    expect(card.querySelector('[data-test="compact-rack-code"]')?.textContent).toBe(
      'MISSION // 作战指令',
    );
    expect(card.querySelector('[data-test="compact-rack-title"]')?.textContent).toBe(
      '战区作战任务指令书 (3项)',
    );

    const items = card.querySelectorAll('[data-test="tactical-quest-item"]');
    expect(items).toHaveLength(3);

    // 第 1 项：进行中
    expect(items[0].querySelector('[data-test="tactical-quest-name"]')?.textContent).toBe(
      '铁幕前哨·废弃货场清剿',
    );
    expect(items[0].querySelector('[data-test="tactical-quest-status"]')?.textContent).toBe(
      '进行中',
    );
    const rewards0 = items[0]
      .querySelectorAll('[data-test="tactical-quest-reward"]')
      .map(el => el.textContent);
    expect(rewards0).toEqual(['资金 +1500', '机密点 +15', '钢材 +300', '废弃货场控制权']);

    const advanceBtn0 = items[0].querySelector('[data-test="tactical-quest-advance-btn"]');
    expect(advanceBtn0).not.toBeNull();

    // 第 2 项：已完成（无推进按钮，状态显示 ✓ 已完成·悬赏已交割）
    expect(items[1].querySelector('[data-test="tactical-quest-status"]')?.textContent).toBe(
      '✓ 已完成·悬赏已交割',
    );
    expect(items[1].querySelector('[data-test="tactical-quest-advance-btn"]')).toBeNull();

    // 第 3 项：已失败（无推进按钮，状态显示 ✕ 已失败）
    expect(items[2].querySelector('[data-test="tactical-quest-status"]')?.textContent).toBe(
      '✕ 已失败',
    );
    expect(items[2].querySelector('[data-test="tactical-quest-advance-btn"]')).toBeNull();

    // 点击第 1 项的「▶ 推进此任务」按钮
    advanceBtn0!.click();
    expect(textarea.value).toBe(
      '【推进作战任务：铁幕前哨·废弃货场清剿】调配战区兵力与资源执行阶段目标——1/3 · 已完成外围工兵侦察',
    );
    expect(inputSpy).toHaveBeenCalledTimes(1);
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it('当 <script class="tw-raw-payload"> 被剥离时，支持通过 mesid 从楼层原文 <任务> 标签回退提取并水合', () => {
    const doc = new MockDocument();
    (globalThis as Record<string, unknown>).getChatMessages = vi.fn(() => [
      {
        message:
          '战报正文\n<任务>\n- 名称: 灰熊装甲集群火力侦察\n  类别: 指令\n  状态: 进行中\n  要点: 试探北侧防线火力配置\n  奖励: 机密点+20\n</任务>',
      },
    ]);

    const host = doc.createElement('div');
    host.className = 'tw-floor-card-host';
    host.setAttribute('data-tw-card', 'tactical-quest');
    doc.body.appendChild(host);

    expect(hydrateFloorCardHost(host as unknown as HTMLElement, { mesid: 5 })).toBe(true);
    const card = host.querySelector('[data-test="tactical-quest-card"]')!;
    expect(card).not.toBeNull();
    expect(card.querySelector('[data-test="tactical-quest-name"]')?.textContent).toBe(
      '灰熊装甲集群火力侦察',
    );

    const textarea = doc.createElement('textarea');
    textarea.setAttribute('id', 'send_textarea');
    doc.body.appendChild(textarea);

    // 当 progress 为空时自动回退使用 note
    const advanceBtn = card.querySelector('[data-test="tactical-quest-advance-btn"]')!;
    advanceBtn.click();
    expect(textarea.value).toBe(
      '【推进作战任务：灰熊装甲集群火力侦察】调配战区兵力与资源执行阶段目标——试探北侧防线火力配置',
    );
  });

  it('buildTacticalQuestCardDom 直接调用可返回挂载完整结构的 DOM 节点', () => {
    const doc = new MockDocument();
    const parsed = parseTacticalQuestPayload('名称: 基地防空网巡检\n类别: 日常\n状态: 进行中');
    const dom = buildTacticalQuestCardDom(doc as unknown as Document, parsed);
    expect(dom.getAttribute('data-test')).toBe('tactical-quest-card');
  });

  it('FD-30 全域奖励池：支持解析与渲染三阶单位/MCV（解锁阵营/解锁蓝图/收编兵力/缴获载具）及五大跨系统奖励（资金链/协议线索/势力/钱袋/机娘奖励/科研助力）', () => {
    const doc = new MockDocument();
    const fullPoolPayload = `
<任务>
- 名称: 凛冬回响·重工车库破译与整备
  类别: 主线
  状态: 已完成
  发包方: 联席参谋部 / 白凌
  进度: 3/3 · 车库气闸已开启，图纸与设备交割完毕
  要点: 控制废弃重工车库，回收战地改装图纸并整备幸存工程班组
  奖励:
    资金: 2000
    机密点: 20
    资源:
      建材:
        钢材: 400
    解锁阵营: [苏联]
    解锁蓝图:
      - 名称: 荒坂改装重型巡逻车
        类别: 载具
        生产建筑: 战车工厂
        造价: 750
      - 名称: 极地防寒突击兵
        类别: 人员
    收编兵力:
      战斗工程师: 2
    缴获载具: [多功能步兵车]
    资金链:
      - 名称: 废弃支线废钢外运
        日收益: 300
        总额度: 9000
    协议线索: [冰冻协议]
    势力:
      - 名称: 铁道幸存者同盟
        态度: 友善
    钱袋:
      欧元: 1500
    机娘奖励:
      - 名称: 白凌
        好感变化: +5
        特质: [铁道调度专家]
    科研助力:
      项目: 基础步兵训练学
      进度变化: 30
    战利品: [工业支线接轨控制权]
</任务>
`;

    const parsed = parseTacticalQuestPayload(fullPoolPayload);
    expect(parsed.items).toHaveLength(1);
    const item = parsed.items[0];
    expect(item.rewardBadges).toEqual([
      '资金 +2000',
      '机密点 +20',
      '钢材 +400',
      '工业支线接轨控制权',
      '🎖️ 阵营启封: 苏联',
      '🏭 战车工厂解锁: 荒坂改装重型巡逻车',
      '🏭 兵营解锁: 极地防寒突击兵',
      '🪖 兵营整备: 战斗工程师 +2',
      '🚜 车厂整备: 多功能步兵车',
      '💰 资金链: 废弃支线废钢外运(+300/日)',
      '📡 协议线索: 冰冻协议',
      '🤝 势力: 铁道幸存者同盟(友善)',
      '🪙 欧元 +1500',
      '💖 白凌: 好感+5 · [铁道调度专家]',
      '🔬 科研助力: 基础步兵训练学 +30%',
    ]);

    const cardDom = buildTacticalQuestCardDom(doc as unknown as Document, parsed);
    const chipEls = cardDom.querySelectorAll('[data-test="tactical-quest-reward"]');
    expect(chipEls.map(el => el.textContent)).toEqual(item.rewardBadges);

    // 验证分类 data-reward-kind 属性准确注入
    const findKind = (prefix: string) =>
      chipEls.find(el => el.textContent.startsWith(prefix))?.getAttribute('data-reward-kind');
    expect(findKind('🎖️ 阵营启封')).toBe('tier-s');
    expect(findKind('🏭 战车工厂解锁')).toBe('tier-a');
    expect(findKind('🪖 兵营整备')).toBe('tier-b');
    expect(findKind('🚜 车厂整备')).toBe('tier-b');
    expect(findKind('💰 资金链')).toBe('chain');
    expect(findKind('📡 协议线索')).toBe('protocol');
    expect(findKind('🤝 势力')).toBe('faction');
    expect(findKind('🪙 欧元')).toBe('wallet');
    expect(findKind('💖 白凌')).toBe('girl');
    expect(findKind('🔬 科研助力')).toBe('tech');
  });

  it('FD-31 参谋席建议：parseTacticalSituationPayload 支持对象数组、联席字典映射、单字符串及仅含参谋建议的 <态势> 解析', () => {
    // 1. 单席白凌对象数组（含显式指令与自动生成指令）
    const singleYaml = `
<态势>
日期: 秋·九月二十
地点: 青岚山北坡
天气: 晴
暴露度变化: +0.5
参谋建议:
  - 参谋: 白凌
    焦点: 产线扩建
    建议: "指挥官，主基地目前仅有兵营、尚无【盟军战车工厂】，建议立即拨款立项建造。"
    指令: "采纳白凌参谋建议：立即在前沿第一基地立项建造【盟军战车工厂】。"
  - 参谋: 白凌
    焦点: 新兵种列装
    建议: "建议先排产 2 批防寒突击兵加强北坡外围警戒。"
</态势>
`;
    const parsedSingle = parseTacticalSituationPayload(singleYaml);
    expect(parsedSingle).not.toBeNull();
    expect(parsedSingle.date).toBe('秋·九月二十');
    expect(parsedSingle.location).toBe('青岚山北坡');
    expect(parsedSingle.staffAdvice).toHaveLength(2);
    expect(parsedSingle.staffAdvice[0]).toEqual({
      advisor: '白凌',
      focus: '产线扩建',
      advice: '指挥官，主基地目前仅有兵营、尚无【盟军战车工厂】，建议立即拨款立项建造。',
      commandText: '采纳白凌参谋建议：立即在前沿第一基地立项建造【盟军战车工厂】。',
    });
    expect(parsedSingle.staffAdvice[1]).toEqual({
      advisor: '白凌',
      focus: '新兵种列装',
      advice: '建议先排产 2 批防寒突击兵加强北坡外围警戒。',
      commandText: '采纳白凌参谋建议：建议先排产 2 批防寒突击兵加强北坡外围警戒。',
    });

    // 2. 多席联席字典映射 & 字符串带括号焦点形态（仅含参谋建议的 <态势> 同样返回有效数据）
    const jointYaml = `
<态势>
参谋建议:
  白凌（基建后勤）: 建议立即立项建造盟军战车工厂
  凛冬妮娅（重装火力）: 建议增派犀牛坦克封锁北侧隘口
</态势>
`;
    const parsedJoint = parseTacticalSituationPayload(jointYaml);
    expect(parsedJoint).not.toBeNull();
    expect(parsedJoint.staffAdvice).toHaveLength(2);
    expect(parsedJoint.staffAdvice[0]).toEqual({
      advisor: '白凌',
      focus: '基建后勤',
      advice: '建议立即立项建造盟军战车工厂',
      commandText: '采纳白凌参谋建议：建议立即立项建造盟军战车工厂',
    });
    expect(parsedJoint.staffAdvice[1]).toEqual({
      advisor: '凛冬妮娅',
      focus: '重装火力',
      advice: '建议增派犀牛坦克封锁北侧隘口',
      commandText: '采纳凛冬妮娅参谋建议：建议增派犀牛坦克封锁北侧隘口',
    });

    // 3. 字符串数组形态
    const strListYaml = `
<态势>
地点: 北方前哨
副官建议:
  - 白凌（基建）：建议立即立项建造盟军战车工厂
  - 薇拉（电子情报）：建议启动静默侦察协议降低暴露度
</态势>
`;
    const parsedStrList = parseTacticalSituationPayload(strListYaml);
    expect(parsedStrList.staffAdvice).toHaveLength(2);
    expect(parsedStrList.staffAdvice[0].advisor).toBe('白凌');
    expect(parsedStrList.staffAdvice[0].focus).toBe('基建');
    expect(parsedStrList.staffAdvice[1].advisor).toBe('薇拉');
    expect(parsedStrList.staffAdvice[1].focus).toBe('电子情报');
  });

  it('FD-31 参谋席建议 DOM 水合与交互：渲染 STAFF ADVISORY 区块并支持点击「▶ 采纳指令」一键填入 #send_textarea', () => {
    vi.useFakeTimers();
    try {
      const doc = new MockDocument();
      const textarea = doc.createElement('textarea');
      textarea.setAttribute('id', 'send_textarea');
      doc.body.appendChild(textarea);

      const inputSpy = vi.fn();
      const focusSpy = vi.fn();
      textarea.addEventListener('input', inputSpy);
      textarea.addEventListener('focus', focusSpy);

      const sitPayload = `
日期: 秋·九月二十
地点: 青岚山北坡
天气: 晴
暴露度变化: +0.5
参谋建议:
  - 参谋: 白凌
    焦点: 产线扩建
    建议: 建议立即在主基地立项建造盟军战车工厂
    指令: 采纳白凌参谋建议：立即在前沿第一基地立项建造【盟军战车工厂】。
  - 参谋: 凛冬妮娅
    焦点: 重装防线
    建议: 建议调遣重装装甲集群前出至货场北口构筑防线
`;

      const host = makeHost(doc, 'tactical-situation', sitPayload);
      expect(hydrateFloorCardHost(host as unknown as HTMLElement)).toBe(true);

      const sitCard = host.querySelector('[data-test="tactical-situation-card"]')!;
      expect(sitCard).not.toBeNull();

      const staffSec = sitCard.querySelector('[data-test="tactical-situation-staff-advice"]');
      expect(staffSec).not.toBeNull();

      const adviceItems = sitCard.querySelectorAll('[data-test="tactical-situation-advice-item"]');
      expect(adviceItems).toHaveLength(2);

      // 验证第 1 条（白凌）
      expect(
        adviceItems[0].querySelector('[data-test="tactical-situation-advice-advisor"]')?.textContent,
      ).toBe('🎙️ 白凌');
      expect(
        adviceItems[0].querySelector('[data-test="tactical-situation-advice-focus"]')?.textContent,
      ).toBe('产线扩建');
      expect(
        adviceItems[0].querySelector('[data-test="tactical-situation-advice-text"]')?.textContent,
      ).toBe('建议立即在主基地立项建造盟军战车工厂');

      const adoptBtn0 = adviceItems[0].querySelector(
        '[data-test="tactical-situation-advice-adopt-btn"]',
      )!;
      expect(adoptBtn0.textContent).toBe('▶ 采纳指令');

      // 点击采纳第 1 条建议
      adoptBtn0.click();
      expect(textarea.value).toBe('采纳白凌参谋建议：立即在前沿第一基地立项建造【盟军战车工厂】。');
      expect(adoptBtn0.textContent).toBe('✓ 已填入行动框');
      expect(inputSpy).toHaveBeenCalledTimes(1);
      expect(focusSpy).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1600);
      expect(adoptBtn0.textContent).toBe('▶ 采纳指令');

      // 验证并点击采纳第 2 条建议（凛冬妮娅，自动生成 commandText）
      expect(
        adviceItems[1].querySelector('[data-test="tactical-situation-advice-advisor"]')?.textContent,
      ).toBe('🎙️ 凛冬妮娅');
      const adoptBtn1 = adviceItems[1].querySelector(
        '[data-test="tactical-situation-advice-adopt-btn"]',
      )!;
      adoptBtn1.click();
      expect(textarea.value).toBe(
        '采纳凛冬妮娅参谋建议：建议调遣重装装甲集群前出至货场北口构筑防线',
      );
      expect(inputSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('FD-32 扩展档案解析：parseExpansionDossierPayload 支持 类别:人物 立体设定、动态信任度/增量及态度默认信任度映射', () => {
    const npcYaml = `
<扩展档案>
- 名称: 沈墨
  类别: 人物
  代号: 铁轨孤狼
  所属势力: 铁道幸存者同盟
  身份: 北段货场守备队长
  态度: 友善
  信任度: 78
  信任变化: +10
  状态: 驻守废弃货运站主控室
  简介: 熟悉整条北方工业支线道岔与地下掩体的老牌铁道技师兼民兵指挥官。
  外貌特征: 身披打满补丁的深灰铁道防寒大衣，左肩挂着改装步话机
  性格与口吻: 沉稳寡言、重诺守信，说话直奔主题
  能力: 铁道网络调度、机车抢修与夜间阵地防守
  背景: 原北方铁路局高级调度长，灾变后收拢沿线工人组建守备队
  近期交集: 协助盟军工兵排清除了货场外围诡雷，并移交了铁轨拓扑图
  设定: 沈墨掌握着通往北方红星重工车库的唯一一条隐蔽支线隧道钥匙。
  触发词: [沈墨, 铁轨孤狼, 货场守备队长]
- 名称: 叶琳娜
  类别: NPC
  参数:
    所属势力: 黑曜石防务财团
    职务: 战区特派观察员
    态度: 警觉
    状态: 游走于北坡中立集市
</扩展档案>
`;

    const parsed = parseExpansionDossierPayload(npcYaml);
    expect(parsed.hasNpc).toBe(true);
    expect(parsed.hasOther).toBe(false);
    expect(parsed.items).toHaveLength(2);

    const npc1 = parsed.items[0];
    expect(npc1.name).toBe('沈墨');
    expect(npc1.kind).toBe('人物');
    expect(npc1.title).toBe('铁轨孤狼');
    expect(npc1.faction).toBe('铁道幸存者同盟');
    expect(npc1.role).toBe('北段货场守备队长');
    expect(npc1.attitude).toBe('友善');
    expect(npc1.trust).toBe(78);
    expect(npc1.trustDelta).toBe('+10');
    expect(npc1.status).toBe('驻守废弃货运站主控室');
    expect(npc1.appearance).toContain('深灰铁道防寒大衣');
    expect(npc1.personality).toContain('沉稳寡言');
    expect(npc1.skills).toContain('铁道网络调度');
    expect(npc1.background).toContain('北方铁路局');
    expect(npc1.recentNote).toContain('移交了铁轨拓扑图');
    expect(npc1.detail).toContain('隐蔽支线隧道钥匙');
    expect(npc1.keys).toEqual(['沈墨', '铁轨孤狼', '货场守备队长']);

    // 第 2 个人物从 params 提取且根据「警觉」自动映射默认信任度 30
    const npc2 = parsed.items[1];
    expect(npc2.name).toBe('叶琳娜');
    expect(npc2.kind).toBe('人物');
    expect(npc2.faction).toBe('黑曜石防务财团');
    expect(npc2.role).toBe('战区特派观察员');
    expect(npc2.attitude).toBe('警觉');
    expect(npc2.trust).toBe(30);
    expect(npc2.status).toBe('游走于北坡中立集市');
  });

  it('FD-32 人物档案 DOM 渲染：mountExpansionDossierCard 渲染 PERSONNEL DOSSIER 立体卡片、信任度进度条与态度色标', () => {
    const doc = new MockDocument();
    const host = doc.createElement('div');
    host.className = 'tw-floor-card-host';
    host.setAttribute('data-tw-card', 'expansion-dossier');
    doc.body.appendChild(host);

    const raw = `
- 名称: 沈墨
  类别: 人物
  头衔: 铁轨孤狼
  所属势力: 铁道幸存者同盟
  身份: 北段货场守备队长
  态度: 友善
  信任度: 82
  信任变化: +12
  状态: 驻守北坡货运站
  简介: 北方工业支线老牌铁道技师。
  性格与口吻: 沉稳寡言
  近期交集: 移交货场铁轨控制室
  设定: 熟悉周边全部地下掩体分布。
`;

    mountExpansionDossierCard(host as unknown as HTMLElement, raw);
    expect(host.getAttribute('data-tw-hydrated')).toBe('true');

    const card = host.querySelector('[data-test="expansion-dossier-card"]')!;
    expect(card).not.toBeNull();
    expect(card.querySelector('[data-test="expansion-dossier-banner"]')?.collectText()).toContain(
      'PERSONNEL DOSSIER // 战区人物档案',
    );

    const npcCard = card.querySelector('[data-test="expansion-npc-card"]')!;
    expect(npcCard).not.toBeNull();
    expect(npcCard.querySelector('[data-test="expansion-npc-name"]')?.textContent).toBe('沈墨');
    expect(npcCard.querySelector('[data-test="expansion-npc-title"]')?.textContent).toBe(
      '「铁轨孤狼」',
    );
    expect(npcCard.querySelector('[data-test="expansion-npc-faction"]')?.textContent).toBe(
      '铁道幸存者同盟',
    );
    expect(npcCard.querySelector('[data-test="expansion-npc-attitude"]')?.textContent).toBe('友善');

    const trustEl = npcCard.querySelector('[data-test="expansion-npc-trust"]')!;
    expect(trustEl.getAttribute('data-trust')).toBe('82');
    expect(trustEl.collectText()).toContain('信任度 82%');
    expect(
      npcCard.querySelector('[data-test="expansion-npc-trust-delta"]')?.textContent,
    ).toBe('(+12)');
    expect(npcCard.querySelector('[data-test="expansion-npc-status"]')?.textContent).toContain(
      '驻守北坡货运站',
    );
    expect(npcCard.querySelector('[data-test="expansion-npc-detail"]')?.textContent).toContain(
      '熟悉周边全部地下掩体分布',
    );
  });

  it('FD-32 人物档案交互：点击「▶ 约谈/联络此人」自动向 #send_textarea 填入联络指令并短暂切换按钮文案', () => {
    vi.useFakeTimers();
    try {
      const doc = new MockDocument();
      const textarea = doc.createElement('textarea');
      textarea.setAttribute('id', 'send_textarea');
      doc.body.appendChild(textarea);

      const inputSpy = vi.fn();
      const focusSpy = vi.fn();
      textarea.addEventListener('input', inputSpy);
      textarea.addEventListener('focus', focusSpy);

      const host = makeHost(
        doc,
        'expansion-dossier',
        `
- 名称: 沈墨
  类别: 人物
  所属势力: 铁道幸存者同盟
  态度: 合作
  信任度: 68
`,
      );

      expect(hydrateFloorCardHost(host as unknown as HTMLElement)).toBe(true);
      const contactBtn = host.querySelector('[data-test="expansion-npc-contact-btn"]')!;
      expect(contactBtn).not.toBeNull();
      expect(contactBtn.textContent).toBe('▶ 约谈/联络此人');

      contactBtn.click();
      expect(textarea.value).toBe('联络并约谈【沈墨】，就当前战区局势交换意见。');
      expect(contactBtn.textContent).toBe('✓ 已填入指令框');
      expect(inputSpy).toHaveBeenCalledTimes(1);
      expect(focusSpy).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1600);
      expect(contactBtn.textContent).toBe('▶ 约谈/联络此人');
    } finally {
      vi.useRealTimers();
    }
  });

  it('FD-32 常规扩展设定与混排卡片：准确渲染 [科技/建筑/载具] 参数胶囊与 EXPANSION DOSSIER 标题', () => {
    const doc = new MockDocument();
    const techPayload = `
- 名称: 极地防寒复合装甲挂板
  类别: 科技
  简介: 针对北坡严寒气候研制的步兵与轻型载具保温防弹插板。
  参数:
    造价: 600
    耗电: 0
    前置: 盟军兵营
  设定: 采用双层气凝胶与高硬度陶瓷复合压制，显著降低严寒环境非战斗减员。
`;
    const host = makeHost(doc, 'expansion-dossier', techPayload);
    expect(hydrateFloorCardHost(host as unknown as HTMLElement)).toBe(true);

    const card = host.querySelector('[data-test="expansion-dossier-card"]')!;
    expect(card.querySelector('[data-test="expansion-dossier-banner"]')?.collectText()).toContain(
      'EXPANSION DOSSIER // 战区扩展建档',
    );

    const itemCard = card.querySelector('[data-test="expansion-item-card"]')!;
    expect(itemCard).not.toBeNull();
    expect(itemCard.querySelector('[data-test="expansion-item-kind"]')?.textContent).toBe('[科技]');
    expect(itemCard.querySelector('[data-test="expansion-item-name"]')?.textContent).toBe(
      '极地防寒复合装甲挂板',
    );
    const paramTexts = itemCard
      .querySelectorAll('[data-test="expansion-item-param"]')
      .map(el => el.textContent);
    expect(paramTexts).toEqual(['造价: 600', '耗电: 0', '前置: 盟军兵营']);
    expect(itemCard.querySelector('[data-test="expansion-item-detail"]')?.textContent).toContain(
      '双层气凝胶与高硬度陶瓷复合压制',
    );

    // 验证人物+建筑混排时顶栏标题为 PERSONNEL & EXPANSION DOSSIER
    const mixedParsed = parseExpansionDossierPayload(`
- 名称: 沈墨
  类别: 人物
- 名称: 野战加热信标
  类别: 建筑
`);
    const mixedDom = buildExpansionDossierCardDom(doc as unknown as Document, mixedParsed);
    expect(
      mixedDom.querySelector('[data-test="expansion-dossier-banner"]')?.collectText(),
    ).toContain('PERSONNEL & EXPANSION DOSSIER // 战区人物与扩展建档');
  });

  it('FD-33 正则与解析：TACTICAL_INTEL_REGEX_ID 匹配 <情报>/<世界演变>，parseTacticalIntelPayload 准确解析六源渠道、演进溯源与五维世界演变', () => {
    const spec = SYSTEM_TAVERN_REGEX_REGISTRY.find(r => r.id === TACTICAL_INTEL_REGEX_ID);
    expect(spec).toBeDefined();
    expect(spec?.script_name).toBe('系统内建·战区情报与世界演变卡片');

    const rawIntel = '<情报>\n- 标题: 远东环海磁暴潮汐异常\n  渠道: 雷达侦察\n</情报>';
    const replacedIntel = rawIntel.replace(new RegExp(spec!.find_regex, 'g'), spec!.replace_string);
    expect(replacedIntel).toContain('data-tw-card="tactical-intel"');
    expect(replacedIntel).toContain('- 标题: 远东环海磁暴潮汐异常');

    const mixedYaml = `
<情报>
- 标题: 北坡废弃中继站高频密电
  来源: 前沿通讯中心监听班
  渠道: 电讯截获
  可信度: 高
  演进自: 北坡夜间不明无线电杂音
  内容: 截获苏军残部与黑市武装关于柴油转运的加密坐标电报。
- 标题: 地下黑市特种钨芯弹药走私潮
  范畴: 世界演变
  象限: 社会黑市
  阶段: 发酵
  剩余热度: 4
  伏笔: 可派遣特工接触自由商团截留该批特种弹药
  内容: 环太平洋多处自由港近期涌入大批无编号特种穿甲弹药。
</情报>
`;

    const parsed = parseTacticalIntelPayload(mixedYaml);
    expect(parsed.hasTactical).toBe(true);
    expect(parsed.hasWorld).toBe(true);
    expect(parsed.items).toHaveLength(2);

    const tacItem = parsed.items[0];
    expect(tacItem.scope).toBe('tactical');
    expect(tacItem.title).toBe('北坡废弃中继站高频密电');
    expect(tacItem.src).toBe('前沿通讯中心监听班');
    expect(tacItem.srcKind).toBe('电讯截获');
    expect(tacItem.cred).toBe('高');
    expect(tacItem.status).toBe('已证实');
    expect(tacItem.evolvesFrom).toBe('北坡夜间不明无线电杂音');

    const worldItem = parsed.items[1];
    expect(worldItem.scope).toBe('world');
    expect(worldItem.title).toBe('地下黑市特种钨芯弹药走私潮');
    expect(worldItem.evoDomain).toBe('社会黑市');
    expect(worldItem.stage).toBe('发酵');
    expect(worldItem.ttlFloors).toBe(4);
    expect(worldItem.hook).toBe('可派遣特工接触自由商团截留该批特种弹药');
  });

  it('FD-33 双轨 DOM 渲染与交互：mountTacticalIntelCard 渲染战区情报与世界演变并支持点击「▶ 派遣侦察/核查」与「▶ 关注/介入此动向」填入 #send_textarea', () => {
    vi.useFakeTimers();
    try {
      const doc = new MockDocument();
      const textarea = doc.createElement('textarea');
      textarea.setAttribute('id', 'send_textarea');
      doc.body.appendChild(textarea);

      const inputSpy = vi.fn();
      const focusSpy = vi.fn();
      textarea.addEventListener('input', inputSpy);
      textarea.addEventListener('focus', focusSpy);

      const host = doc.createElement('div');
      host.className = 'tw-floor-card-host';
      host.setAttribute('data-tw-card', 'tactical-intel');
      doc.body.appendChild(host);

      const payload = `
- 标题: 灰熊巡逻队目击北侧装甲车辙
  来源: 北坡前哨侦察排
  渠道: 前线目视
  可信度: 中
  状态: 待核实
  演进自: 货场外围异常引擎声
  内容: 发现多组重型履带向东北山谷延伸。
- 标题: 极地高空电离层磁暴前兆
  范畴: 世界演变
  象限: 位面异象
  阶段: 高潮
  剩余热度: 2
  伏笔: 远程雷达与空军出击窗口将在未来 48 小时受限
  内容: 极地电离层出现周期性强烈扰动，广域无线电通讯面临中断风险。
`;

      mountTacticalIntelCard(host as unknown as HTMLElement, payload);
      expect(host.getAttribute('data-tw-hydrated')).toBe('true');

      const card = host.querySelector('[data-test="tactical-intel-card"]')!;
      expect(card).not.toBeNull();
      expect(card.querySelector('[data-test="tactical-intel-banner"]')?.collectText()).toContain(
        'INTEL & WORLD PULSE // 战区情报与世界暗流',
      );

      // 1. 验证战区情报条目 DOM
      const tacSlot = card.querySelector('[data-test="tactical-intel-item"]')!;
      expect(tacSlot).not.toBeNull();
      expect(tacSlot.querySelector('[data-test="intel-src-kind"]')?.textContent).toBe(
        '🔭 前线目视',
      );
      expect(tacSlot.querySelector('[data-test="intel-cred-badge"]')?.textContent).toBe(
        '中·待核实',
      );
      expect(tacSlot.querySelector('[data-test="intel-evolves-from"]')?.textContent).toBe(
        '🔗 演进自：「货场外围异常引擎声」',
      );

      const tacBtn = tacSlot.querySelector('[data-test="tactical-intel-act-btn"]')!;
      expect(tacBtn.textContent).toBe('▶ 派遣侦察/核查');
      tacBtn.click();
      expect(textarea.value).toBe(
        '调遣侦察与情报部门核查【北坡前哨侦察排】线报：「灰熊巡逻队目击北侧装甲车辙」，查明真伪与具体坐标。',
      );
      expect(tacBtn.textContent).toBe('✓ 已填入指令框');
      expect(inputSpy).toHaveBeenCalledTimes(1);
      expect(focusSpy).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1600);
      expect(tacBtn.textContent).toBe('▶ 派遣侦察/核查');

      // 2. 验证世界演变条目 DOM
      const worldSlot = card.querySelector('[data-test="world-evo-item"]')!;
      expect(worldSlot).not.toBeNull();
      expect(worldSlot.querySelector('[data-test="world-evo-domain"]')?.textContent).toBe(
        '⚡ 位面异象',
      );
      expect(worldSlot.querySelector('[data-test="world-evo-stage"]')?.textContent).toBe(
        '萌芽 ➔ 发酵 ➔ [高潮] ➔ 平息',
      );
      expect(worldSlot.querySelector('[data-test="world-evo-ttl"]')?.textContent).toBe(
        '热度余量: 2/5 轮',
      );
      expect(worldSlot.querySelector('[data-test="world-evo-hook"]')?.textContent).toBe(
        '💡 潜在切入点：远程雷达与空军出击窗口将在未来 48 小时受限',
      );

      const worldBtn = worldSlot.querySelector('[data-test="tactical-intel-act-btn"]')!;
      expect(worldBtn.textContent).toBe('▶ 关注/介入此动向');
      worldBtn.click();
      expect(textarea.value).toBe(
        '密切关注并派员介入远方动向【极地高空电离层磁暴前兆】（位面异象·高潮），评估我方切入时机。',
      );
      expect(worldBtn.textContent).toBe('✓ 已填入指令框');
      expect(inputSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('FD-36 暴露度 EL 等级与民心五阶徽标：parseTacticalSituationPayload 与 buildTacticalSituationCardDom 准确渲染 [data-test="tactical-situation-exposure"] 与 [data-test="tactical-situation-morale"]', () => {
    const doc = new MockDocument();
    const sitWithMorale = `
<态势>
日期: 秋·九月二十二
地点: 青岚山北坡主基地
天气: 小雪
暴露度变化: +0.8
暴露底线: 1.2
民心: 7.2
民心变化: +1.2
民心事件: 北坡供暖管网并网通暖，周边幸存者聚落归心
</态势>
`;

    const parsed = parseTacticalSituationPayload(sitWithMorale);
    expect(parsed.exposureDelta).toBe('+0.8');
    expect(parsed.exposureFloor).toBe(1.2);
    expect(parsed.exposureLevel).toBe('EL-1 轻微可疑');
    expect(parsed.morale).toBe(7.2);
    expect(parsed.moraleDelta).toBe('+1.2');
    expect(parsed.moraleStage).toBe('安居归心');

    const host = makeHost(doc, 'tactical-situation', sitWithMorale);
    expect(hydrateFloorCardHost(host as unknown as HTMLElement)).toBe(true);

    const card = host.querySelector('[data-test="tactical-situation-card"]')!;
    const expBadge = card.querySelector('[data-test="tactical-situation-exposure"]');
    expect(expBadge).not.toBeNull();
    expect(expBadge?.textContent).toBe('暴露 +0.8 · EL-1 轻微可疑');

    const moraleBadge = card.querySelector('[data-test="tactical-situation-morale"]');
    expect(moraleBadge).not.toBeNull();
    expect(moraleBadge?.textContent).toBe('❤️ 民心 7.2/10 (+1.2 · 安居归心)');
  });

  it('FD-48 PKG-C 多环系列任务链：parseTacticalQuestPayload 与 mountTacticalQuestCard 解析并渲染「系列 · 环数」胶囊徽章与下一环线索', () => {
    const doc = new MockDocument();
    const chainPayload = `
<任务>
- 名称: 冻土余音·截获加密信标
  类别: 主线
  状态: 已完成
  发包方: 联席参谋部 / 白凌
  系列: 铁幕回响
  环数: 1/3
  后续任务: 破拆北郊高压变电站气闸并恢复重工车库供电
  进度: 1/1 · 信标已破译
  要点: 锁定旧工业区地底休眠重工车库坐标
  奖励:
    机密点: 25
    协议线索: [铁幕频率校准]
- 名称: 常规外围巡逻
  类别: 日常
  状态: 进行中
  进度: 0/1 · 巡检中
</任务>
`;

    const parsed = parseTacticalQuestPayload(chainPayload);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0].series).toBe('铁幕回响');
    expect(parsed.items[0].chainStep).toBe('1/3');
    expect(parsed.items[0].nextQuest).toBe('破拆北郊高压变电站气闸并恢复重工车库供电');
    expect(parsed.items[1].series).toBe('');
    expect(parsed.items[1].chainStep).toBe('');
    expect(parsed.items[1].nextQuest).toBe('');

    const host = doc.createElement('div');
    host.className = 'tw-floor-card-host';
    host.setAttribute('data-tw-card', 'tactical-quest');
    doc.body.appendChild(host);

    mountTacticalQuestCard(host as unknown as HTMLElement, chainPayload);
    expect(host.getAttribute('data-tw-hydrated')).toBe('true');

    const slots = host.querySelectorAll('[data-test="tactical-quest-item"]');
    expect(slots).toHaveLength(2);

    // 第 1 项带系列、环数与下一环线索
    const seriesBadge = slots[0].querySelector('[data-test="tactical-quest-series"]');
    expect(seriesBadge).not.toBeNull();
    expect(seriesBadge?.getAttribute('data-quest-series')).toBe('铁幕回响');
    expect(seriesBadge?.getAttribute('data-quest-chain-step')).toBe('1/3');
    expect(seriesBadge?.textContent).toBe('系列：铁幕回响 · 1/3');

    const nextHook = slots[0].querySelector('[data-test="tactical-quest-next"]');
    expect(nextHook).not.toBeNull();
    expect(nextHook?.getAttribute('data-quest-next')).toBe(
      '破拆北郊高压变电站气闸并恢复重工车库供电',
    );
    expect(nextHook?.textContent).toContain(
      '下一环线索：破拆北郊高压变电站气闸并恢复重工车库供电',
    );

    // 第 2 项无系列与下一环线索时不渲染对应节点
    expect(slots[1].querySelector('[data-test="tactical-quest-series"]')).toBeNull();
    expect(slots[1].querySelector('[data-test="tactical-quest-next"]')).toBeNull();
  });

  it('FD-50 PKG-C 战区情报多阶溯源链：parseTacticalIntelPayload 与 mountTacticalIntelCard 解析并渲染 intel-chain-badge、intel-next-lead 及深挖情报链核查指令', () => {
    const doc = new MockDocument();
    const textarea = doc.createElement('textarea');
    textarea.setAttribute('id', 'send_textarea');
    doc.body.appendChild(textarea);

    const intelChainPayload = `
<情报>
- 标题: 北郊废弃变电站断续脉冲与车辙印证
  来源: 前沿遥感雷达站
  渠道: 雷达侦察
  可信度: 中
  状态: 演进中
  演进自: 冻土暗网流传旧工业区地下电网余波
  情报链: 北郊休眠重工溯源
  阶数: 2/3
  下一阶线索: 派遣渗透内线或破译班组锁定核心掩体气闸频段与坐标
  内容: 遥感扫描确认北郊变电站地底 30 米存在周期性热源与屏蔽空腔。
- 标题: 常规外围夜间野兽活动目击
  来源: 南侧哨所
  渠道: 前线目视
  可信度: 低
  内容: 南侧林带边缘发现少量变异狼群足迹。
</情报>
`;

    const parsed = parseTacticalIntelPayload(intelChainPayload);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0].chain).toBe('北郊休眠重工溯源');
    expect(parsed.items[0].chainStep).toBe('2/3');
    expect(parsed.items[0].nextLead).toBe('派遣渗透内线或破译班组锁定核心掩体气闸频段与坐标');
    expect(parsed.items[0].hook).toBe('派遣渗透内线或破译班组锁定核心掩体气闸频段与坐标');
    expect(parsed.compactSummary).toContain('北郊休眠重工溯源(2/3)');

    expect(parsed.items[1].chain).toBe('');
    expect(parsed.items[1].chainStep).toBe('');
    expect(parsed.items[1].nextLead).toBe('');

    const host = doc.createElement('div');
    host.className = 'tw-floor-card-host';
    host.setAttribute('data-tw-card', 'tactical-intel');
    doc.body.appendChild(host);

    mountTacticalIntelCard(host as unknown as HTMLElement, intelChainPayload);
    const slots = host.querySelectorAll('[data-test="tactical-intel-item"]');
    expect(slots).toHaveLength(2);

    // 第 1 项带情报链徽章与下一步核查线索
    const chainBadge = slots[0].querySelector('[data-test="intel-chain-badge"]');
    expect(chainBadge).not.toBeNull();
    expect(chainBadge?.getAttribute('data-intel-chain')).toBe('北郊休眠重工溯源');
    expect(chainBadge?.getAttribute('data-intel-chain-step')).toBe('2/3');
    expect(chainBadge?.textContent).toBe('情报链：北郊休眠重工溯源 · 第 2/3 阶');

    const nextLeadEl = slots[0].querySelector('[data-test="intel-next-lead"]');
    expect(nextLeadEl).not.toBeNull();
    expect(nextLeadEl?.textContent).toBe(
      '▸ 下一步核查线索：派遣渗透内线或破译班组锁定核心掩体气闸频段与坐标',
    );

    const actBtn0 = slots[0].querySelector('[data-test="tactical-intel-act-btn"]')!;
    actBtn0.click();
    expect(textarea.value).toBe(
      '【深挖情报链：北郊休眠重工溯源】调遣侦察与情报部门核查【前沿遥感雷达站】线报：「北郊废弃变电站断续脉冲与车辙印证」（当前阶数：2/3），重点追查：派遣渗透内线或破译班组锁定核心掩体气闸频段与坐标。',
    );

    // 第 2 项无情报链字段，不渲染徽章且保持原有核查指令
    expect(slots[1].querySelector('[data-test="intel-chain-badge"]')).toBeNull();
    expect(slots[1].querySelector('[data-test="intel-next-lead"]')).toBeNull();
    const actBtn1 = slots[1].querySelector('[data-test="tactical-intel-act-btn"]')!;
    actBtn1.click();
    expect(textarea.value).toBe(
      '调遣侦察与情报部门核查【南侧哨所】线报：「常规外围夜间野兽活动目击」，查明真伪与具体坐标。',
    );
  });
});
