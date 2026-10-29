import { describe, expect, it } from 'vitest';
import { Schema } from '../../红警指挥系统/core/schema';
import { readBootFrom } from '../boot';
import {
  buildStatData,
  composeLaunchMessage,
  createLaunchSteps,
  createMockHostAdapter,
  LaunchPipelineError,
  resolveDifficulty,
  runLaunchPipeline,
  type LaunchCtx,
  type LaunchStep,
  type StepProgress,
} from '../pipeline';
import {
  defaultChoices,
  defaultDateForWorld,
  DIFFICULTY_PRESETS,
  findLocation,
  findPreset,
  locationsForWorld,
  POWER_TECH,
  type LaunchChoices,
} from '../presets';

function choicesWith(patch: Partial<LaunchChoices>): LaunchChoices {
  return { ...defaultChoices(), ...patch };
}

// ─────────────────────────────── presets ───────────────────────────────

describe('presets · 难度参数包与世界默认值', () => {
  it('默认 choices 保持修真正史开局；赛博默认值来自世界契约', () => {
    expect(defaultChoices()).toMatchObject({ worldId: 'xiuzhen', locationId: 'beipo', date: '秋·九月初一' });
    expect(defaultDateForWorld('cyber2042')).toBe('2042-03-14');
    expect(locationsForWorld('cyber2042').map(location => location.id)).toEqual(['cyber-entry']);
    expect(findLocation('', 'cyber2042')).toMatchObject({ id: 'cyber-entry', location: '（自创城市·首铺时定）' });
    expect(locationsForWorld('unknown-world')).toEqual([]);
    expect(() => findLocation('', 'unknown-world')).toThrow('没有可用部署地点');
  });

  it('四档数值符合总设计案 §6', () => {
    expect(findPreset('easy')).toMatchObject({ credits: 3000, techDone: [POWER_TECH], exposure: 0 });
    expect(findPreset('normal')).toMatchObject({ credits: 2000, techDone: [POWER_TECH], exposure: 0 });
    expect(findPreset('hard')).toMatchObject({ credits: 1200, techDone: [], exposure: 0 });
    expect(findPreset('custom')).toMatchObject({ credits: 2000, techDone: [], exposure: 0, narrativeSeed: '' });
    expect(DIFFICULTY_PRESETS.map(p => p.id)).toEqual(['easy', 'normal', 'hard', 'custom']);
  });

  it('resolveDifficulty：easy 附加自选 T1；custom 走全量覆写', () => {
    const easy = resolveDifficulty(choicesWith({ preset: 'easy', easyBonusTech: '风光发电学' }));
    expect(easy.credits).toBe(3000);
    expect(easy.techDone).toEqual([POWER_TECH, '风光发电学']);
    // 自选与赠送重复时不重复计入
    const dup = resolveDifficulty(choicesWith({ preset: 'easy', easyBonusTech: POWER_TECH }));
    expect(dup.techDone).toEqual([POWER_TECH]);
    const custom = resolveDifficulty(
      choicesWith({
        preset: 'custom',
        customCredits: 8800,
        customTech: ['石油勘探学'],
        customExposure: 3,
        customSeed: '自定态势',
      }),
    );
    expect(custom).toEqual({ credits: 8800, techDone: ['石油勘探学'], exposure: 3, narrativeSeed: '自定态势' });
  });
});

// ─────────────────────────────── buildStatData ───────────────────────────────

describe('buildStatData · 归零基线 + 开局覆写', () => {
  it('产物能再次通过 Schema.parse（键结构契约）', () => {
    const sd = buildStatData(defaultChoices());
    expect(() => Schema.parse(sd)).not.toThrow();
    expect(sd.schema_version).toBe(2);
  });

  it('normal 档：credits/tech.done/exposure/meta 正确', () => {
    const sd = buildStatData(defaultChoices());
    expect(sd.economy.credits).toBe(2000);
    expect(sd.tech.done).toEqual([POWER_TECH]);
    expect(sd.exposure.value).toBe(0);
    expect(sd.meta.date).toBe('秋·九月初一');
    expect(sd.meta.location).toBe('青岚山北坡');
    expect(sd.meta.world_id).toBe('xiuzhen');
  });

  it('MCV 展开前零预设基地铁律：bases 为空数组 []，拟定坐标写入 meta.location；forces.vehicles 是 string[]（MCV）', () => {
    const sd = buildStatData(choicesWith({ locationId: 'yunxi' }));
    expect(sd.bases).toEqual([]);
    expect(sd.forces.vehicles).toEqual(['MCV（盟军）']);
    expect(sd.meta.location).toBe('云溪谷地');
  });

  it('三种开场切入模式（field_drop / pre_transmigration / dormant_infiltration）：bases 恒为 []，首发 MCV 与机娘就位待命', () => {
    const fieldDrop = buildStatData(choicesWith({ entryMode: 'field_drop' }));
    expect(fieldDrop.bases).toEqual([]);
    expect(fieldDrop.forces.vehicles).toEqual(['MCV（盟军）']);
    expect(fieldDrop.command.mcv_granted_factions).toEqual(['allied']);

    const prologue = buildStatData(choicesWith({ entryMode: 'pre_transmigration' }));
    expect(prologue.bases).toEqual([]);
    expect(prologue.forces.vehicles).toEqual(['MCV（盟军）']);
    expect(prologue.command.mcv_granted_factions).toEqual(['allied']);

    const stealth = buildStatData(choicesWith({ entryMode: 'dormant_infiltration' }));
    expect(stealth.bases).toEqual([]);
    expect(stealth.forces.vehicles).toEqual(['MCV（盟军）']);
    expect(stealth.command.mcv_granted_factions).toEqual(['allied']);
  });

  it('未触碰键保持归零态', () => {
    const sd = buildStatData(defaultChoices());
    const zero = Schema.parse({});
    expect(sd.queues).toEqual(zero.queues);
    expect(sd.factions).toEqual(zero.factions);
    expect(sd.intel).toEqual(zero.intel);
    expect(sd.quests).toEqual(zero.quests);
    expect(zero.economy.wallet).toEqual({});
    expect(sd.economy.wallet).toEqual({ 铜钱: 0, 银两: 0, 下品灵石: 0, 中品灵石: 0, 上品灵石: 0 });
    expect(sd.forces.girls).toMatchObject([{ name: '白凌', duty: '盟军MCV移动基地车核心', hp: '完好', base: '' }]);
    expect(sd.command.unlocked_factions).toEqual(['allied']);
    expect(sd.command.mcv_granted_factions).toEqual(['allied']);
    expect(sd.options).toEqual([]);
  });

  it('赛博开局按 manifest 写 world_id、日期、占位地点与两种合法货币，bases 遵守零预设基地铁律', () => {
    const sd = buildStatData(choicesWith({ worldId: 'cyber2042', locationId: 'cyber-entry', date: '' }));
    expect(sd.meta).toMatchObject({ world_id: 'cyber2042', date: '2042-03-14', location: '（自创城市·首铺时定）' });
    expect(sd.economy.wallet).toEqual({ 标准信用币: 0, 加密币: 0 });
    expect(sd.bases).toEqual([]);
  });

  it('未注册世界 fail-closed，不回落修真', () => {
    expect(() => buildStatData(choicesWith({ worldId: 'unknown-world' }))).toThrow('未注册世界');
  });

  it('hard 档零科技；custom 档全量覆写；空日期回退默认', () => {
    const hard = buildStatData(choicesWith({ preset: 'hard', date: '  ' }));
    expect(hard.economy.credits).toBe(1200);
    expect(hard.tech.done).toEqual([]);
    expect(hard.meta.date).toBe('秋·九月初一');
    const custom = buildStatData(
      choicesWith({
        preset: 'custom',
        customCredits: 500,
        customTech: ['石油勘探学', '合成燃料学'],
        customExposure: 7,
      }),
    );
    expect(custom.economy.credits).toBe(500);
    expect(custom.tech.done).toEqual(['石油勘探学', '合成燃料学']);
    expect(custom.exposure.value).toBe(7);
  });
});

// ─────────────────────────────── composeLaunchMessage ───────────────────────────────

describe('composeLaunchMessage · 首条 user 消息', () => {
  it('含地点/资金/基调指令/半迷雾慢热开荒引导（摒弃遭遇战催促口号）', () => {
    const message = composeLaunchMessage(defaultChoices());
    expect(message).toContain('北坡主基地（青岚山北坡）');
    expect(message).toContain('初始资金：2000');
    expect(message).toContain('军事简报风');
    expect(message).toContain(
      'MCV 已隐蔽驻泊于青岚山北坡临时掩体（车载静默待命 · 外围尚处战术迷雾），请指挥官审阅初期家底并下达首步开荒指令。',
    );
    expect(message).not.toContain('作战正式开始');
    expect(message).toContain('未勘明的战术迷雾');
    expect(message).toContain('【初期家底与工程爬坡处境】');
    expect(message).toContain('【慢热模拟经营与渐进发育准则】');
  });

  it('【初期家底与工程爬坡处境】随难度/科技/多阵营动态转译受控工程因果', () => {
    const normalMsg = composeLaunchMessage(defaultChoices());
    expect(normalMsg).toContain('可用启动资金 2000');
    expect(normalMsg).toContain('仅解锁了「化石燃料发电学」一项起步技术');
    expect(normalMsg).toContain('先通电、再探矿、后建厂');

    const hardMsg = composeLaunchMessage(choicesWith({ preset: 'hard' }));
    expect(hardMsg).toContain('可用启动资金 1200');
    expect(hardMsg).toContain('尚未解锁任何初期应用技术图纸');
    expect(hardMsg).toContain('白手起家');

    const dualMsg = composeLaunchMessage(
      choicesWith({
        selectedFactions: ['allied', 'soviet'],
      }),
    );
    expect(dualMsg).toContain('多阵营并线（盟军＋苏联）带来了首阶段 15 日跨制式工程磨合期');
  });

  it('赛博消息包含世界名、世界侧写、日期与占位地点', () => {
    const message = composeLaunchMessage(choicesWith({ worldId: 'cyber2042', locationId: 'cyber-entry', date: '' }));
    expect(message).toContain('世界：赛博朋克2042');
    expect(message).toContain('日期：2042-03-14');
    expect(message).toContain('待侦知部署点（自创城市·首铺时定）');
    expect(message).toContain('数据身份+资金流+物流双重隐匿');
  });

  it('自定义提示词拼入；空提示词不留孤行', () => {
    const withPrompt = composeLaunchMessage(choicesWith({ customPrompt: '多写机娘互动' }));
    expect(withPrompt).toContain('【指挥官附加指示】');
    expect(withPrompt).toContain('多写机娘互动');
    const noPrompt = composeLaunchMessage(choicesWith({ customPrompt: '   ' }));
    expect(noPrompt).not.toContain('【指挥官附加指示】');
    expect(noPrompt).not.toMatch(/\n{3,}/); // 无连续空行孤行
  });

  it('hard 档含 narrativeSeed', () => {
    const message = composeLaunchMessage(choicesWith({ preset: 'hard' }));
    expect(message).toContain('资源紧张，敌情主动，AI 不应放水');
    expect(message).toContain('难度：困难');
  });
});

// ─────────────────────────────── 工序引擎（假 steps + mock adapter）───────────────────────────────

function fakeCtx(): LaunchCtx {
  return { adapter: createMockHostAdapter(), choices: defaultChoices() };
}

function fakeStep(name: string, patch?: Partial<LaunchStep>): LaunchStep {
  return { name, label: `工序${name}`, critical: false, run: async () => {}, ...patch };
}

describe('runLaunchPipeline · 工序引擎', () => {
  it('顺序 await 执行', async () => {
    const order: string[] = [];
    const steps = ['a', 'b', 'c'].map(n =>
      fakeStep(n, {
        run: async () => {
          await new Promise(r => setTimeout(r, 5));
          order.push(n);
        },
      }),
    );
    await runLaunchPipeline(steps, fakeCtx());
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('skip 记 skipped 且 run 不执行', async () => {
    let ran = false;
    const steps = [
      fakeStep('s', {
        skip: () => true,
        run: async () => {
          ran = true;
        },
      }),
    ];
    const results = await runLaunchPipeline(steps, fakeCtx());
    expect(ran).toBe(false);
    expect(results).toEqual([{ name: 's', label: '工序s', status: 'skipped' }]);
  });

  it('critical 失败 → 中止整线抛 LaunchPipelineError，后续不跑', async () => {
    const order: string[] = [];
    const steps = [
      fakeStep('a', {
        run: async () => {
          order.push('a');
        },
      }),
      fakeStep('boom', {
        critical: true,
        run: async () => {
          throw new Error('炸了');
        },
      }),
      fakeStep('c', {
        run: async () => {
          order.push('c');
        },
      }),
    ];
    await expect(runLaunchPipeline(steps, fakeCtx())).rejects.toThrow(LaunchPipelineError);
    expect(order).toEqual(['a']); // c 未执行
  });

  it('非 critical 失败 → 记 warning 继续', async () => {
    const order: string[] = [];
    const steps = [
      fakeStep('soft', {
        run: async () => {
          throw new Error('小问题');
        },
      }),
      fakeStep('next', {
        run: async () => {
          order.push('next');
        },
      }),
    ];
    const results = await runLaunchPipeline(steps, fakeCtx());
    expect(order).toEqual(['next']);
    expect(results.find(r => r.name === 'soft' && r.status === 'warning')?.error).toContain('小问题');
  });

  it('onProgress 回调序列正确（running/done/skipped/warning 逐事件）', async () => {
    const events: string[] = [];
    const steps = [
      fakeStep('a'),
      fakeStep('skipMe', { skip: () => true }),
      fakeStep('soft', {
        run: async () => {
          throw new Error('x');
        },
      }),
    ];
    await runLaunchPipeline(steps, fakeCtx(), (p: StepProgress) => events.push(`${p.name}:${p.status}`));
    expect(events).toEqual(['a:running', 'a:done', 'skipMe:skipped', 'soft:running', 'soft:warning']);
  });
});

// ─────────────────────────────── 真实发射工序 × mock adapter ───────────────────────────────

describe('createLaunchSteps · 完整发射', () => {
  it('全线成功：先排他同步世界书，再落 stat_data/$boot、发消息并触发生成', async () => {
    const adapter = createMockHostAdapter();
    const choices = choicesWith({ preset: 'hard', customPrompt: '保持紧张感' });
    const ctx: LaunchCtx = { adapter, choices };
    const results = await runLaunchPipeline(createLaunchSteps(), ctx, undefined);

    const statuses = Object.fromEntries(results.filter(r => r.status !== 'running').map(r => [r.name, r.status]));
    expect(statuses).toEqual({
      validateWorld: 'done',
      writeStatData: 'done',
      markBoot: 'done',
      applyPersona: 'skipped', // 默认 personaMode=skip
      bindWorldBooks: 'done',
      composeAndSend: 'done',
    });

    const sd = adapter.messageVars['stat_data'] as Schema;
    expect(sd.economy.credits).toBe(1200);
    expect(sd.bases).toEqual([]);
    expect(sd.meta.location).toBe('青岚山北坡');

    const boot = readBootFrom(adapter.chatVars);
    expect(boot.confirmed).toBe(true);
    expect(boot.preset).toBe('hard');
    expect((boot.choices as { locationId?: string }).locationId).toBe('beipo');
    expect((boot.choices as { worldId?: string }).worldId).toBe('xiuzhen');
    expect(boot.confirmedAt).toBeTruthy();

    expect(adapter.sentMessages).toHaveLength(1);
    expect(adapter.sentMessages[0]).toContain('保持紧张感');
    expect(adapter.generateCount).toBe(1);
    expect(adapter.globalBooks).toContain('修真·世界适配');
    expect(adapter.globalBooks).not.toContain('赛博朋克2042·世界适配');
    // 排他同步在 persona/stat/$boot 等业务副作用之前；发消息在触发生成之前
    expect(adapter.callLog.findIndex(call => call.startsWith('replaceWorldbooks:'))).toBeLessThan(
      adapter.callLog.indexOf('setStatData'),
    );
    expect(adapter.callLog.indexOf('sendUserMessage')).toBeLessThan(adapter.callLog.indexOf('triggerGeneration'));
  });

  it('未注册世界在首个工序 fail-closed，persona/stat/$boot/消息均无副作用', async () => {
    const adapter = createMockHostAdapter();
    const choices = choicesWith({
      worldId: 'unknown-world',
      personaMode: 'create',
      personaName: '不应创建',
      personaDescription: 'x',
    });
    await expect(runLaunchPipeline(createLaunchSteps(), { adapter, choices })).rejects.toThrow('未注册');
    expect(adapter.callLog).toEqual([]);
    expect(adapter.personas['不应创建']).toBeUndefined();
    expect(adapter.messageVars['stat_data']).toBeUndefined();
    expect(adapter.chatVars['$boot']).toBeUndefined();
    expect(adapter.sentMessages).toEqual([]);
  });

  it('导入档世界与 choices 不一致时在首个工序拒绝，零宿主副作用', async () => {
    const adapter = createMockHostAdapter();
    const importedStat = Schema.parse({ meta: { world_id: 'xiuzhen' } });
    const choices = choicesWith({ worldId: 'cyber2042', locationId: 'cyber-entry', importedStat });
    await expect(runLaunchPipeline(createLaunchSteps(), { adapter, choices })).rejects.toThrow('导入存档属于');
    expect(adapter.callLog).toEqual([]);
  });

  it('必需世界书文件缺失时在 bind 工序 fail-closed，persona/stat/$boot/消息均无副作用', async () => {
    const adapter = createMockHostAdapter();
    adapter.tavernBooks = adapter.tavernBooks.filter(name => name !== '赛博朋克2042·世界适配');
    const choices = choicesWith({
      worldId: 'cyber2042',
      locationId: 'cyber-entry',
      personaMode: 'create',
      personaName: '不应创建',
      personaDescription: 'x',
    });
    await expect(runLaunchPipeline(createLaunchSteps(), { adapter, choices })).rejects.toThrow('必需世界书文件缺失');
    expect(adapter.callLog).toEqual([]);
    expect(adapter.messageVars['stat_data']).toBeUndefined();
    expect(adapter.chatVars['$boot']).toBeUndefined();
    expect(adapter.sentMessages).toEqual([]);
    expect(adapter.generateCount).toBe(0);
  });

  it('排他同步写入失败且已恢复时，仍在 persona/stat/$boot/消息之前中止', async () => {
    const adapter = createMockHostAdapter();
    const original = [...adapter.globalBooks];
    const baseReplace = adapter.replaceWorldbooks.bind(adapter);
    let writes = 0;
    adapter.replaceWorldbooks = async names => {
      writes += 1;
      if (writes === 1) throw new Error('首次 rebind 失败');
      await baseReplace(names);
    };
    const choices = choicesWith({ personaMode: 'create', personaName: '不应创建', personaDescription: 'x' });
    await expect(runLaunchPipeline(createLaunchSteps(), { adapter, choices })).rejects.toThrow('已恢复原受管书集合');
    expect(adapter.globalBooks).toEqual(original);
    expect(adapter.personas['不应创建']).toBeUndefined();
    expect(adapter.messageVars['stat_data']).toBeUndefined();
    expect(adapter.chatVars['$boot']).toBeUndefined();
    expect(adapter.sentMessages).toEqual([]);
  });

  it('applyPersona existing：切换成功验证通过；切换不存在者记 warning 但整线继续', async () => {
    const ok = createMockHostAdapter();
    const okCtx: LaunchCtx = { adapter: ok, choices: choicesWith({ personaMode: 'existing', personaName: '夜莺' }) };
    const okResults = await runLaunchPipeline(createLaunchSteps(), okCtx);
    expect(okResults.find(r => r.name === 'applyPersona' && r.status === 'done')).toBeTruthy();
    expect(ok.currentPersonaName()).toBe('夜莺');
    expect(readBootFrom(ok.chatVars).personaId).toBe('夜莺');

    const bad = createMockHostAdapter();
    const badCtx: LaunchCtx = {
      adapter: bad,
      choices: choicesWith({ personaMode: 'existing', personaName: '不存在的人' }),
    };
    const badResults = await runLaunchPipeline(createLaunchSteps(), badCtx);
    const warn = badResults.find(r => r.name === 'applyPersona' && r.status === 'warning');
    expect(warn?.error).toContain('切换未生效');
    // 非 critical：发射不中止
    expect(bad.sentMessages).toHaveLength(1);
  });

  it('applyPersona create：先创建再切换并验证', async () => {
    const adapter = createMockHostAdapter();
    const ctx: LaunchCtx = {
      adapter,
      choices: choicesWith({ personaMode: 'create', personaName: '顾沉', personaDescription: '陆战指挥官' }),
    };
    const results = await runLaunchPipeline(createLaunchSteps(), ctx);
    expect(results.find(r => r.name === 'applyPersona')?.status).not.toBe('warning');
    expect(adapter.personas['顾沉']).toBe('陆战指挥官');
    expect(adapter.currentPersonaName()).toBe('顾沉');
    expect(adapter.callLog.indexOf('createPersona:顾沉')).toBeLessThan(adapter.callLog.indexOf('switchPersona:顾沉'));
  });

  it('critical 工序（写变量）失败 → 整线中止，$boot 不落盘、消息不发', async () => {
    const adapter = createMockHostAdapter();
    adapter.setStatData = async () => {
      throw new Error('宿主写入被拒');
    };
    const ctx: LaunchCtx = { adapter, choices: defaultChoices() };
    await expect(runLaunchPipeline(createLaunchSteps(), ctx)).rejects.toThrow('宿主写入被拒');
    expect(adapter.chatVars['$boot']).toBeUndefined();
    expect(adapter.sentMessages).toHaveLength(0);
  });
});

// ─────────── 写后核验双保险（真机 #0 楼写入蒸发事故的回归钉）───────────

describe('writeStatData 写后核验 + 末位复核（蒸发防御）', () => {
  it('首次写入蒸发 → 自动重试后 done，setStatData 共调 2 次', async () => {
    const adapter = createMockHostAdapter();
    const origSet = adapter.setStatData.bind(adapter);
    let writes = 0;
    adapter.setStatData = async sd => {
      writes++;
      await origSet(sd);
      if (writes === 1) delete adapter.messageVars['stat_data']; // 模拟写入后瞬间蒸发
    };
    const ctx: LaunchCtx = { adapter, choices: defaultChoices() };
    const results = await runLaunchPipeline(createLaunchSteps(), ctx);
    expect(results.filter(r => r.status !== 'running').find(r => r.name === 'writeStatData')?.status).toBe('done');
    expect(writes).toBe(2);
    expect(adapter.messageVars['stat_data']).toBeDefined();
  });

  it('连续 3 次蒸发 → critical 抱错中止，错误含核验失败', async () => {
    const adapter = createMockHostAdapter();
    const origSet = adapter.setStatData.bind(adapter);
    adapter.setStatData = async sd => {
      await origSet(sd);
      delete adapter.messageVars['stat_data']; // 永远蒸发
    };
    const ctx: LaunchCtx = { adapter, choices: defaultChoices() };
    await expect(runLaunchPipeline(createLaunchSteps(), ctx)).rejects.toThrow('写入后核验失败');
    expect(adapter.sentMessages).toHaveLength(0);
  });

  it('中途蒸发（markBoot 后丢失）→ composeAndSend 末位复核重写后才发送', async () => {
    const adapter = createMockHostAdapter();
    const origBoot = adapter.setBoot.bind(adapter);
    adapter.setBoot = async next => {
      await origBoot(next);
      delete adapter.messageVars['stat_data']; // 模拟中途被冲掉
    };
    const ctx: LaunchCtx = { adapter, choices: defaultChoices() };
    const results = await runLaunchPipeline(createLaunchSteps(), ctx);
    expect(results.filter(r => r.status !== 'running').find(r => r.name === 'composeAndSend')?.status).toBe('done');
    expect(adapter.messageVars['stat_data']).toBeDefined(); // 发送前已重写
    expect(adapter.sentMessages).toHaveLength(1);
    // 重写发生在发送之前
    const log = adapter.callLog;
    expect(log.lastIndexOf('setStatData')).toBeLessThan(log.indexOf('sendUserMessage'));
  });

  it('工序顺序：applyPersona 前置于 writeStatData（缩小变量暴露窗口）', async () => {
    const adapter = createMockHostAdapter();
    const ctx: LaunchCtx = {
      adapter,
      choices: choicesWith({ personaMode: 'create', personaName: '顾沉', personaDescription: 'x' }),
    };
    await runLaunchPipeline(createLaunchSteps(), ctx);
    const log = adapter.callLog;
    expect(log.findIndex(call => call.startsWith('replaceWorldbooks:'))).toBeLessThan(
      log.indexOf('createPersona:顾沉'),
    );
    expect(log.indexOf('createPersona:顾沉')).toBeLessThan(log.indexOf('setStatData'));
    expect(log.indexOf('switchPersona:顾沉')).toBeLessThan(log.indexOf('setStatData'));
  });
});
