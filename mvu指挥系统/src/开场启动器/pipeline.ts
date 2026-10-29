/**
 * 阶段 F + CMD-LAUNCH-01 · 组装线：纯函数（buildStatData / composeLaunchMessage）+ 工序引擎 + 五工序。
 *
 * 可测性关键：宿主 API（getVariables/updateVariablesWith/triggerSlash/createChatMessages/
 * createOrReplacePersona/getPersonaNames/getPersona/getCurrentPersonaName/_）在酒馆 iframe
 * 是全局；非宿主（vite 预览 / vitest）必须走注入的 mock——所有宿主调用收敛到 HostAdapter，
 * 纯函数与引擎不直接碰全局。
 */

import type { ChatBookGatewayLike } from '../红警指挥系统/worldbook/chatBookBinding';
import {
  HUMAN_ADJUTANT_DAILY_UPKEEP,
  resolveAdjutantBuffPreset,
  resolveStarterMcvInfo,
} from '../红警指挥系统/core/commandPresets';
import { migrateV1toV2, Schema, type Adjutant } from '../红警指挥系统/core/schema';
import { confirmBoot, readBootFrom, type BootState } from './boot';
import { getSavePackForImportedStat, type SavePack } from './importSave';
import {
  computeMultiFactionLaunchImpact,
  defaultDateForWorld,
  findEntryMode,
  findFaction,
  findHumanOrigin,
  findLocation,
  findMaidenIncubationMode,
  findPreset,
  findSystemLinkMode,
  findTone,
  formatLocationLabel,
  POWER_TECH,
  resolveEraDirectiveForChoices,
  resolveMaidenIncubationMode,
  resolveSelectedFactions,
  resolveSystemLinkMode,
  STARTING_VEHICLES,
  type LaunchChoices,
  type LocationDef,
  type OpeningMaidenIncubationMode,
  type OpeningSystemLinkMode,
} from './presets';
import {
  hasSameManagedWorldbooks,
  managedWorldbookNames,
  planManagedWorldbookRecovery,
  planWorldbookSync,
  WORLD_BOOK_MANIFESTS,
  type WorldbookSyncPlan,
} from './worldbookManifest';
import { getWorldManifest } from './worlds';

// ─────────────────────────────── 难度归算 ───────────────────────────────

export interface EffectiveDifficulty {
  credits: number;
  techDone: string[];
  exposure: number;
  narrativeSeed: string;
}

/** 把"档位 + 附加选择/自定义覆写 + 多阵营开局折算"归算成最终数值（单一真源，statData 与首条消息共用） */
export function resolveDifficulty(choices: LaunchChoices): EffectiveDifficulty {
  const preset = findPreset(choices.preset);
  let baseCredits: number;
  let techDone: string[];
  let baseExposure: number;
  let narrativeSeed: string;

  if (preset.id === 'custom') {
    baseCredits = choices.customCredits;
    techDone = [...choices.customTech];
    baseExposure = choices.customExposure;
    narrativeSeed = choices.customSeed.trim();
  } else {
    baseCredits = preset.credits;
    techDone = [...preset.techDone];
    if (preset.id === 'easy' && choices.easyBonusTech && choices.easyBonusTech !== POWER_TECH) {
      techDone.push(choices.easyBonusTech);
    }
    baseExposure = preset.exposure;
    narrativeSeed = preset.narrativeSeed;
  }

  const selectedFactions = resolveSelectedFactions(choices);
  const impact = computeMultiFactionLaunchImpact(
    selectedFactions,
    baseCredits,
    baseExposure,
    choices.factionAdjutants,
  );

  return {
    credits: impact.credits,
    techDone,
    exposure: impact.exposure,
    narrativeSeed,
  };
}

// ─────────────────────────────── 纯函数：statData ───────────────────────────────

export function resolveLaunchLocation(choices: LaunchChoices): LocationDef {
  const importedBase = choices.importedStat?.bases[0];
  if (importedBase?.id === choices.locationId) {
    return {
      id: importedBase.id,
      name: importedBase.name,
      location: importedBase.location || choices.importedStat?.meta.location || importedBase.id,
      flavor: '导入存档中的既有基地',
    };
  }
  if (choices.locationId === 'custom') {
    const customName = choices.customLocationName?.trim() || '自定义前哨基地';
    const customRegion = choices.customLocationRegion?.trim() || '自主勘定战区';
    const customFlavor =
      choices.customLocationFlavor?.trim() || '指挥官自主勘定的法外隐蔽部署点，远离常规监控网络';
    return {
      id: 'custom',
      name: customName,
      location: customRegion,
      flavor: customFlavor,
      region: '自定义战区',
      densityTag: '自由定义',
      isCustom: true,
    };
  }
  return findLocation(choices.locationId, choices.worldId);
}

function buildInitialAdjutants(choices: LaunchChoices, selectedFactions: readonly string[]): Adjutant[] {
  const adjutants: Adjutant[] = [];
  const commanderName = choices.personaMode !== 'skip' ? choices.personaName.trim() : '';

  for (const factionId of selectedFactions) {
    const starter = resolveStarterMcvInfo(factionId);
    const factionLabel = findFaction(factionId).name;
    const cfg = choices.factionAdjutants?.[factionId];
    const identity = cfg?.identity ?? 'mcv_girl';

    if (identity === 'mcv_girl') {
      const name = cfg?.name?.trim() || starter?.girlName || `${factionLabel}机娘`;
      const title = cfg?.title?.trim() || starter?.girlDuty || `${factionLabel}MCV移动基地车核心`;
      const buffId =
        resolveAdjutantBuffPreset(cfg?.buffPreset || starter?.defaultBuffPreset || '')?.id ??
        starter?.defaultBuffPreset ??
        'grid_harmonic_tuning';
      adjutants.push({
        id: `adj_${factionId}_mcv_girl`,
        role: 'faction',
        faction: factionId,
        identity: 'mcv_girl',
        name,
        title,
        buff_preset: buffId,
        upkeep_daily: 0,
        status: 'active',
        note: '开局首发MCV机娘兼任阵营主责副官',
      });
    } else if (identity === 'human') {
      const name = cfg?.name?.trim() || `${factionLabel}参谋官`;
      const title = cfg?.title?.trim() || `${factionLabel}前线副官`;
      const buffId =
        resolveAdjutantBuffPreset(cfg?.buffPreset || starter?.defaultBuffPreset || '')?.id ??
        starter?.defaultBuffPreset ??
        'logistics_actuary';
      adjutants.push({
        id: `adj_${factionId}_human`,
        role: 'faction',
        faction: factionId,
        identity: 'human',
        name,
        title,
        buff_preset: buffId,
        upkeep_daily: HUMAN_ADJUTANT_DAILY_UPKEEP,
        status: 'active',
        note: '开局委任人类阵营主责副官',
      });
    } else if (identity === 'commander_self') {
      adjutants.push({
        id: `adj_${factionId}_commander`,
        role: 'faction',
        faction: factionId,
        identity: 'commander_self',
        name: commanderName || '最高统帅',
        title: '主指挥官直辖',
        buff_preset: '',
        upkeep_daily: 0,
        status: 'active',
        note: '开局主指挥官亲自直辖',
      });
    }
  }

  if (choices.staffAdjutant?.enabled) {
    const staffName = choices.staffAdjutant.name?.trim() || '首席作战参谋';
    const staffTitle = choices.staffAdjutant.title?.trim() || '战区联席参谋官';
    const staffBuff =
      resolveAdjutantBuffPreset(choices.staffAdjutant.buffPreset || '')?.id ?? 'logistics_actuary';
    adjutants.push({
      id: 'adj_staff_initial',
      role: 'staff',
      faction: '',
      identity: 'human',
      name: staffName,
      title: staffTitle,
      buff_preset: staffBuff,
      upkeep_daily: HUMAN_ADJUTANT_DAILY_UPKEEP,
      status: 'active',
      note: '开局初始参谋增益席副官',
    });
  }

  return adjutants;
}

/**
 * FD-37 · BUG-SAVE-04：导入存档并在向导中更改主基地部署点时，
 * 级联更新全变量树中对旧主基地（oldId / oldName）的引用。
 */
export function remapBaseReferencesInStat(
  stat: Schema,
  oldId: string,
  oldName: string,
  newId: string,
  newName: string,
): void {
  const trimOldId = oldId.trim();
  const trimOldName = oldName.trim();
  if (!trimOldId && !trimOldName) return;
  if (trimOldId === newId && trimOldName === newName) return;

  const matchesOld = (val: unknown): val is string =>
    typeof val === 'string' &&
    Boolean(val.trim()) &&
    ((Boolean(trimOldId) && val.trim() === trimOldId) ||
      (Boolean(trimOldName) && val.trim() === trimOldName));

  const remapVal = (val: string): string => {
    const v = val.trim();
    if (trimOldName && v === trimOldName && trimOldName !== trimOldId) {
      return newName || newId;
    }
    return newId;
  };

  if (Array.isArray(stat.forces?.girls)) {
    for (const g of stat.forces.girls) {
      if (g && matchesOld(g.base)) {
        g.base = remapVal(g.base);
      }
    }
  }

  if (Array.isArray(stat.queues)) {
    for (const q of stat.queues) {
      if (q && matchesOld(q.base)) {
        q.base = remapVal(q.base);
      }
    }
  }

  if (Array.isArray(stat.pending_mode_switches)) {
    for (const m of stat.pending_mode_switches) {
      if (m && matchesOld(m.base)) {
        m.base = remapVal(m.base);
      }
    }
  }

  if (Array.isArray(stat.pending_deployments)) {
    for (const d of stat.pending_deployments) {
      if (d && matchesOld(d.base)) {
        d.base = remapVal(d.base);
      }
    }
  }

  if (Array.isArray(stat.projects)) {
    for (const p of stat.projects) {
      if (!p) continue;
      if (matchesOld(p.lead_base)) {
        p.lead_base = remapVal(p.lead_base);
      }
      if (Array.isArray(p.bases)) {
        p.bases = p.bases.map(b => (matchesOld(b) ? remapVal(b) : b));
      }
      if ('modules' in p && Array.isArray(p.modules)) {
        for (const mod of p.modules) {
          if (mod && matchesOld(mod.base)) {
            mod.base = remapVal(mod.base);
          }
        }
      }
    }
  }

  if (stat.space) {
    if (Array.isArray(stat.space.launch_centers)) {
      for (const lc of stat.space.launch_centers) {
        if (lc && matchesOld(lc.base)) {
          lc.base = remapVal(lc.base);
        }
      }
    }
    if (Array.isArray(stat.space.contracts)) {
      for (const c of stat.space.contracts) {
        if (!c) continue;
        if (matchesOld(c.base)) {
          c.base = remapVal(c.base);
        }
        if (matchesOld(c.target_base)) {
          c.target_base = remapVal(c.target_base);
        }
      }
    }
    if (Array.isArray(stat.space.orbital_assets)) {
      for (const oa of stat.space.orbital_assets) {
        if (!oa) continue;
        if (matchesOld(oa.target_base)) {
          oa.target_base = remapVal(oa.target_base);
        }
        const oaWithBase = oa as { base?: unknown };
        if (matchesOld(oaWithBase.base)) {
          oaWithBase.base = remapVal(oaWithBase.base);
        }
      }
    }
  }

  if (Array.isArray(stat.economy?.chains)) {
    for (const ch of stat.economy.chains) {
      if (!ch) continue;
      const chWithBase = ch as { base?: unknown };
      if (matchesOld(chWithBase.base)) {
        chWithBase.base = remapVal(chWithBase.base);
      }
      if (ch.deps) {
        if (matchesOld(ch.deps.base_id)) {
          ch.deps.base_id = remapVal(ch.deps.base_id);
        }
        if (matchesOld(ch.deps.base)) {
          ch.deps.base = remapVal(ch.deps.base);
        }
      }
    }
  }
}

/**
 * 归零基线（Schema.parse({})）→ 覆写开局键 → 再 parse 归一。
 * forces.vehicles 是 string[]；Base 必填 id/name（schema.ts 23-27 行契约）。
 */
export function buildStatData(choices: LaunchChoices): Schema {
  const eff = resolveDifficulty(choices);
  const world = getWorldManifest(choices.worldId);
  if (!world) throw new Error(`未注册世界「${choices.worldId || '空'}」，不能安全初始化`);
  const loc = resolveLaunchLocation(choices);

  // ── G2 修正：导入开局以存档全量为基线（机娘/建筑/图鉴/队列/情报等无缝继承），
  //    表单可调字段（日期/资金/暴露/科技/地点）以向导终值覆写（回填后未改则等值无害）。
  //    真机血泪：旧版从归零基线重建，导致导入存档的白凌（girls）、建造厂、codex 全部丢失。
  if (choices.importedStat) {
    // JSON 克隆而非 structuredClone：真机上 choices 是 Vue reactive，importedStat 是 Proxy，
    // structuredClone 对 Proxy 直接抛 DataCloneError（纯对象测试测不出，真机血泪）
    const imported = JSON.parse(JSON.stringify(choices.importedStat)) as unknown;
    const base = Schema.parse(migrateV1toV2(imported));
    if (base.meta.world_id !== world.world_id) {
      throw new Error(`导入存档属于「${base.meta.world_id}」，不能以「${world.world_id}」发射`);
    }
    base.meta.date = choices.date.trim() || base.meta.date || defaultDateForWorld(world.world_id);
    base.economy.credits = eff.credits;
    // Schema.parse 要求 exposure.value <= 10，parse 通过后再写入多阵营折算后的真实暴露度
    base.exposure.value = Math.min(10, Math.max(0, eff.exposure));
    base.tech.done = [...eff.techDone];
    // 地点：与存档主基地一致则全量保留 bases；用户主动改址则换标识但保留建筑/状态/电力，并级联更新全树基地引用
    if (base.bases[0] && (base.bases[0].id !== loc.id || base.bases[0].name !== loc.name)) {
      const oldId = base.bases[0].id;
      const oldName = base.bases[0].name;
      base.bases[0] = { ...base.bases[0], id: loc.id, name: loc.name, location: loc.location };
      base.meta.location = loc.location;
      remapBaseReferencesInStat(base, oldId, oldName, loc.id, loc.name);
    }
    // forces 全量保留（不重塞 STARTING_VEHICLES——存档里 MCV 可能已展开成建造厂）
    const normalizedExp =
      eff.exposure > 10 && eff.exposure <= 100
        ? Math.min(10, Math.round((eff.exposure / 10) * 100) / 100)
        : Math.min(10, Math.max(0, eff.exposure));
    base.exposure.value = normalizedExp;
    const parsedImported = Schema.parse(base);
    return parsedImported;
  }

  const selectedFactions = resolveSelectedFactions(choices);
  const preset = findPreset(choices.preset);
  const baseCredits = preset.id === 'custom' ? choices.customCredits : preset.credits;
  const baseExposure = preset.id === 'custom' ? choices.customExposure : preset.exposure;
  const impact = computeMultiFactionLaunchImpact(
    selectedFactions,
    baseCredits,
    baseExposure,
    choices.factionAdjutants,
  );

  const vehicles: string[] = [];
  const girls: Array<{
    name: string;
    duty: string;
    hp: '完好';
    base: string;
    serial?: string;
    model?: string;
    faction?: string;
  }> = [];
  const incubationModeId = resolveMaidenIncubationMode(choices);
  for (const factionId of selectedFactions) {
    const starter = resolveStarterMcvInfo(factionId);
    if (starter) {
      if (!vehicles.includes(starter.vehicleName)) {
        vehicles.push(starter.vehicleName);
      }
      const starterGirlName =
        incubationModeId === 'full_blindbox' ? `待授名·${starter.unitSerial}` : starter.girlName;
      if (!girls.some(g => g.name === starterGirlName)) {
        girls.push({
          name: starterGirlName,
          duty: starter.girlDuty,
          hp: '完好',
          base: '',
          ...(incubationModeId === 'full_blindbox'
            ? {
                serial: starter.unitSerial,
                model: starter.vehicleName,
                faction: starter.factionLabel,
              }
            : {}),
        });
      }
    } else {
      const factionLabel = findFaction(factionId).name;
      const vName = `MCV（${factionLabel}）`;
      if (!vehicles.includes(vName)) vehicles.push(vName);
    }
  }
  if (vehicles.length === 0) {
    vehicles.push(...STARTING_VEHICLES);
  }

  const commanderName = choices.personaMode !== 'skip' ? choices.personaName.trim() : '';
  const adjutants = buildInitialAdjutants(choices, selectedFactions);

  const zero = Schema.parse({});
  const initialCodex = [...zero.codex];

  // 将每位已选阵营的首发 MCV 机娘立体档案写入 initialCodex（不重名）
  for (const factionId of selectedFactions) {
    const starter = resolveStarterMcvInfo(factionId);
    if (!starter) continue;
    const starterCodexName =
      incubationModeId === 'full_blindbox' ? `待授名·${starter.unitSerial}` : starter.girlName;
    if (initialCodex.some(c => c.name === starterCodexName)) continue;
    initialCodex.push({
      name: starterCodexName,
      kind: '人员',
      desc: [
        `核心意象：${starter.archetypeTag}`,
        `工业专精与搭档：${starter.specialtyAndBond}`,
        `性格与口吻：${starter.personality}`,
        `外貌着装：${starter.appearance}`,
      ].join('｜'),
      params: {
        阵营归属: starter.factionLabel,
        机体序列: `${starter.unitSerial} · ${starter.vehicleName}首台核心`,
        编号: starter.unitSerial,
        型号: starter.vehicleName,
        代号: starter.callsign,
        开局职务: starter.girlTitle,
        核心意象: starter.archetypeTag,
        外貌着装: starter.appearance,
        性格与口吻: starter.personality,
        工业专精与搭档: starter.specialtyAndBond,
        标志性台词: starter.quote,
      },
    });
  }

  for (const m of choices.humanRoster ?? []) {
    const hName = m.name.trim();
    if (!hName || initialCodex.some(c => c.name === hName)) continue;
    const roleLabel =
      m.assignment === 'staff'
        ? '联席参谋部专职参谋'
        : m.assignment.startsWith('faction:')
          ? `${findFaction(m.assignment.slice('faction:'.length)).name}首席副官`
          : '己方随行核心人员';
    const originObj = findHumanOrigin(m.origin);
    const descParts = [
      m.bio.trim(),
      m.personality?.trim() ? `性格与作风：${m.personality.trim()}` : '',
      m.appearance?.trim() ? `外貌特征：${m.appearance.trim()}` : '',
    ].filter(Boolean);
    const params: Record<string, string> = {
      阵营归属: m.faction === 'common' ? '统帅部直属' : findFaction(m.faction).name,
      随行渊源: originObj.label,
      开局职务: m.title.trim() || roleLabel,
      席位任命: roleLabel,
    };
    if (m.callsign?.trim()) params['代号'] = m.callsign.trim();
    if (m.appearance?.trim()) params['外貌着装'] = m.appearance.trim();
    if (m.personality?.trim()) params['性格与口吻'] = m.personality.trim();
    if (m.bio.trim()) params['履历与绝活'] = m.bio.trim();

    initialCodex.push({
      name: hName,
      kind: '人员',
      desc: descParts.join('｜') || `${m.title.trim() || '战区随行人员'}（${roleLabel}）`,
      params,
    });
  }

  const next = {
    ...zero,
    codex: initialCodex,
    meta: {
      ...zero.meta,
      world_id: world.world_id,
      date: choices.date.trim() || defaultDateForWorld(world.world_id),
      location: loc.location,
    },
    economy: {
      ...zero.economy,
      credits: eff.credits,
      wallet: Object.fromEntries(world.currencies.map(name => [name, 0])),
    },
    exposure: { ...zero.exposure, value: Math.min(10, Math.max(0, eff.exposure)) },
    tech: { ...zero.tech, done: [...eff.techDone] },
    // MCV-ZERO-BASE-01：开局零预设基地铁律——MCV 尚未选点展开前，在役基地严格为空数组 []；
    // 拟定预选区域仅保存在 meta.location 与 $boot.choices 中，待剧情中下达 MCV 展开指令后再正式奠基建立首座基地。
    bases: [],
    forces: {
      ...zero.forces,
      vehicles,
      girls,
    },
    command: {
      ...zero.command,
      commander_name: commanderName,
      commander_title: '战区最高统帅',
      unlocked_factions: [...selectedFactions],
      mcv_granted_factions: [...selectedFactions],
      adjutants,
      break_in_penalties: impact.breakInPenalties,
    },
  };
  const normalizedExp =
    eff.exposure > 10 && eff.exposure <= 100
      ? Math.min(10, Math.round((eff.exposure / 10) * 100) / 100)
      : Math.min(10, Math.max(0, eff.exposure));
  next.exposure.value = normalizedExp;
  const parsed = Schema.parse(next);
  return parsed;
}

export const buildInitialStatData = buildStatData;

// ─────────────────────────────── 纯函数：首条消息（三段式沉浸开场电文） ───────────────────────────────

/** 构建战地初抵序幕的时空与地貌镜头段（收束宏观远景至荒芜落脚点的微观地表与工程肌理） */
function buildWorldAndLocationScene(choices: LaunchChoices, worldId: string, date: string, loc: LocationDef): string {
  if (worldId === 'xiuzhen') {
    return `修真历${date}，${loc.location}（${loc.name}）。层叠山峦与山涧冷雾交织成隔绝尘世的天然屏障，${loc.flavor}。高空云海间偶有修真宗门巡山修士的剑光掠过，而在凡俗灵觉与宗门阵法未曾细查的幽谷深处，眼前唯有未经平整的湿滑山岩、枯木荒草与阴冷山涧——没有一段硬化路面，也没有一处现成工事，来自异界的钢铁火种正悄然蛰伏于这片荒僻谷地。`;
  }
  if (worldId === 'cyber2042') {
    return `公历 ${date}，${loc.location}（${loc.name}）。霓虹雨幕下的巨型都市被城市天网、金融监管与物流监控网络层层包裹；而在高架桥底与断水断电的废弃工业管廊交错的灰区盲点内，四周尽是锈蚀钢梁、积水坑洼与报废线缆，数据身份与物理行踪的双重隐匿屏障刚刚在这片无人问津的荒芜死角架起。`;
  }

  // cyber2077：按年份匹配时代气象 + 12 全球部署点实地镜头 + 脚下荒芜落脚点的微观工程视角
  const yearMatch = /^(\d{4})\b/.exec(date);
  const year = yearMatch ? Number(yearMatch[1]) : 2042;
  let eraLead = '';
  if (year <= 2043) {
    eraLead = `公历 ${date}，第四次企业战争停火后的第十七个年头。旧网尚未被“黑墙”彻底封死，夜之城核爆的真相仍掩埋在废墟之下，各大巨型企业正忙于舔舐伤口、争夺战后断代供应链。`;
  } else if (year <= 2059) {
    eraLead = `公历 ${date}，血色纪元（Time of the Red）正值沸点。苍穹残留着核战与轨道尘埃的暗红余晖，黑墙刚刚将旧网深渊隔绝，破碎的洲际物流与地下夜市正在废墟上野蛮生长。`;
  } else if (year <= 2072) {
    eraLead = `公历 ${date}，统一战争的钢铁风暴前夜。新美利坚（NUSA）与军用科技的装甲集群正在自由州边境集结，荒坂海外舰队在暗潮中伺机重返，整片大陆的加密频段里充斥着战前戒严的电波。`;
  } else {
    eraLead = `公历 ${date}，巨型企业寡头统治的暗黑巅峰。荒坂超级航母的轮廓笼罩科罗纳多海湾，企业轨道卫星与市政天网将都市每一寸霓虹照得纤毫毕现，而阴影深处的第五次企业战争已暗流汹涌。`;
  }

  const sceneMap: Record<string, string> = {
    badlands_deep:
      '在远离夜之城市政天网的恶土落基岭与红峰荒原深处，干燥的狂风裹挟着锈红色砂砾，抽打着半掩在废弃地热矿道与风化岩壁间的重型伪装网。远方洲际公路上偶有流浪者改装车队的引擎低鸣与乱刀会武装皮卡的探照灯掠过天际。',
    west_australia:
      '南半球西澳大利亚皮尔巴拉矿带深处，炙热干燥的陆风卷过赤铁矿露天巨坑与早已停摆的百米级自动掘进机残骸。珀斯外围的荒坂海运护航队与西澳分离主义矿业私军正在海岸线与矿山铁路网间暗中角力，而这片远离欧美主战场的富矿腹地，恰处于企业天基侦察网交替的静默盲区。',
    mideast_meltdown:
      '中东核熔毁废土与波斯湾边缘，1997年核交火留下的黑曜石状玻璃化沙丘在热浪中泛着死寂的冷光。高浓度电离尘暴天然屏蔽了高空侦察卫星的红外锁定，而在干涸盐沼与废弃输油管网之下，苏油（SovOil）与军用科技的武装勘探队仍在为封存的战前黑金与军火库暗中交火。',
    nc_combat_zone:
      '夜之城东南缘，老战区与圣多明哥重工业带的交界处。浓重的酸雾与化工厂尾气笼罩着连片的破产制造厂与排污暗渠，头顶高压变电站的电弧嗡鸣与六街帮、企业清道夫的零星枪声在钢筋废墟间回荡。',
    pacifica_coast:
      '太平洲德尔科罗纳多湾南岸，烂尾的豪华度假村巨构与半沉入海的废弃深水干船坞构成了天然的钢筋迷宫。海浪拍打着锈蚀的龙门吊桩基，隔街便是巫毒帮控制的暗网节点与海地难民社区，NCPD 的巡逻浮空车早已不再踏足这片法外海岸。',
    siberia_frontier:
      '新苏维埃西伯利亚与远东重工冻土带，漫长的极寒风雪掩盖了冷战时期的废弃导弹发射井与深井重金属矿场。1520毫米宽轨装甲列车在冰原林海间轰鸣穿行，苏油（SovOil）的输油管线与重型冶金厂在冻土深处吐出滚滚白烟。',
    east_asia_ghost_sea:
      '东亚南海航道北缘，第四次企业战争生化袭击后被百米隔离墙彻底封死的香港无人鬼城外围。隔离墙内是奥特·坎宁安率领流窜AI盘踞的算力迷城，外海则是康陶（Kang Tao）与荒坂东亚舰队交错巡航的废弃深海钻井平台与集装箱墓地。',
    south_asia_monsoon:
      '南亚与东南亚季风交汇带，新孟买外海绵延十余公里的巨型拆船滩涂与马六甲海盗暗礁群。热带暴雨冲刷着堆积如山的退役货轮钢板与高密度生物代工厂排污口，私掠船团、走私潜艇与企业护航艇在浑浊的水道间昼夜穿行。',
    africa_kilimanjaro:
      '东非大裂谷高地，乞力马扎罗与内罗毕赤道空天发射场的外围稀土矿带。极远处的天际线上，贯通地表与近地轨道的太空天梯索道如银色巨柱般刺入云层，泛非联盟与轨道航空（Orbital Air）的高空防卫网在稀土矿谷上方交织。',
    latam_panama_amazon:
      '中南美洲巴拿马运河交火带与亚马逊密林北缘。浓密的热带雨林华盖遮蔽了冷战时期的地下掩体与废弃水电站，北方是旧美军残部与中美联邦拉锯的运河防线，南方则是美洲国家组织（OAS）与生物技术公司（Biotechnica）封闭的基因造林试验区。',
    polar_antarctica_arctic:
      '极地高纬冰缘，全球温室效应消融冰盖后裸露出的解冻岩谷与冰海大陆架。极夜寒风呼啸着掠过废弃的深海可燃冰钻井平台与地热裂隙，唯有跨国企业规避国际公约的秘密实验室与破冰勘探船在冰山阴影间出没。',
  };

  const locScene = loc.isCustom
    ? `在指挥官自主勘定的「${loc.name}」（${loc.location}），${loc.flavor.trim() || '复杂地貌与废弃基建构成了天然的隐蔽屏障，整片区域正处于外界侦察网络的视觉盲区。'}`
    : (sceneMap[loc.id] ?? `在「${loc.name}」（${loc.location}），${loc.flavor}`);

  const groundMicroLens =
    '然而那些席卷大陆的高层博弈此刻仍在远方；将视线收束回眼前的临时落脚点，伪装网外只有未经平整的荒芜地表、断水断电的旧时代残垣与尚未散去的地形迷雾，连一段硬化施工便道或一根外围警戒桩都尚未铺设。';

  return `${eraLead}${locScene}${groundMicroLens}`;
}

/** 构建车舱内 MCV 载具、半迷雾沙盘与机娘/副官在场汇报段 */
function buildCabinAndOfficersScene(
  choices: LaunchChoices,
  selectedFactions: string[],
  systemLinkModeId: OpeningSystemLinkMode = 'commander_initiate',
): {
  cabinParagraph: string;
  vehiclesText: string;
  rosterSummary: string;
  presentOfficersText: string;
  commanderCallsign: string;
  maidenNamesText: string;
} {
  const commanderName = choices.personaMode !== 'skip' ? choices.personaName.trim() : '';
  const commanderCallsign = commanderName ? `指挥官「${commanderName}」` : '指挥官';

  const vehicles: string[] = [];
  const maidenLabels: string[] = [];
  const maidenShortNames: string[] = [];
  const officerLabels: string[] = [];

  for (const fid of selectedFactions) {
    const starter = resolveStarterMcvInfo(fid);
    const factionName = findFaction(fid).name;
    const vName = starter?.vehicleName ?? `MCV（${factionName}）`;
    vehicles.push(vName);
    if (starter) {
      maidenLabels.push(`${factionName} MCV 核心机娘「${starter.girlName}」`);
      maidenShortNames.push(starter.girlName);
    }
    const adjCfg = choices.factionAdjutants?.[fid];
    const identity = adjCfg?.identity ?? 'mcv_girl';
    if (identity === 'mcv_girl' && starter) {
      officerLabels.push(`${factionName} MCV 核心机娘「${starter.girlName}」`);
    } else if (identity === 'human') {
      const hName = adjCfg?.name?.trim() || `${factionName}首席副官`;
      const hTitle = adjCfg?.title?.trim() || `${factionName}战区协调官`;
      officerLabels.push(`${hTitle}「${hName}」${starter ? `与核心机娘「${starter.girlName}」` : ''}`);
    } else if (identity === 'commander_self') {
      if (starter) officerLabels.push(`${factionName} MCV 核心机娘「${starter.girlName}」（统帅直辖）`);
    }
  }

  if (choices.staffAdjutant?.enabled) {
    const sName = choices.staffAdjutant.name?.trim() || '首席作战参谋';
    const sTitle = choices.staffAdjutant.title?.trim() || '战区联席参谋官';
    officerLabels.push(`${sTitle}「${sName}」`);
  }

  for (const m of choices.humanRoster ?? []) {
    const hName = m.name.trim();
    if (!hName) continue;
    // 若仅作为随行同伴（未占用阵营副官或联席参谋席），同样作为在场己方人员写入首幕
    if (!m.assignment) {
      const hTitle = m.title.trim() || '随行军官';
      const label = `随行${hTitle}「${hName}」`;
      if (!officerLabels.includes(label)) {
        officerLabels.push(label);
      }
    }
  }

  const presentOfficersText =
    officerLabels.length > 0
      ? officerLabels.join('、')
      : maidenLabels.length > 0
        ? maidenLabels.join('、')
        : '车载战术终端';
  const maidenNamesText = maidenShortNames.length > 0 ? maidenShortNames.join('、') : '白凌';

  let hullLead = '';
  if (selectedFactions.length === 1) {
    const primary = selectedFactions[0];
    if (primary === 'soviet') {
      hullLead =
        '重型伪装网下，苏维埃重型移动基地车（MCV）庞大的多轴履带底盘深深压入松软土层，车载柴油辅机维持着最低转速的怠速低鸣，液压驻锄与重工锻造母机仍处于锁死收拢态，车舱仪表盘泛着暗红的待机微光。';
    } else if (primary === 'yuri') {
      hullLead =
        '阴影掩映下，尤里移动基地车（MCV）悄然蛰伏于掩体死角，车载生物工程舱与心灵谐振回路维持着最低功耗的静默循环，折叠式液压驻锄尚未落锁，幽紫色的指示波纹在主控屏上缓缓律动。';
    } else {
      hullLead =
        '重型光学伪装网下，盟军移动基地车（MCV）已熄火驻泊于掩体阴影间，车载纳米制造母机与折叠式工程龙门架处于冷休眠锁死态，仅靠辅助电容维持着座舱环控与红外热抑制，车舱主控台泛着冷冽的冰蓝微光。';
    }
  } else {
    hullLead = `伪装阵地内，${vehicles.join('、')}已呈战术掎角之势并列隐蔽驻泊，车载纳米与重工母机均维持冷休眠与低功耗红外静默；跨阵营多制式联合作战网络已完成初段握手，正处于首阶段 15 日工程磨合期。`;
  }

  let statusTail = '';
  if (systemLinkModeId === 'post_transmigration_bind') {
    statusTail = `此时红警最高统帅系统与核心机娘（${maidenNamesText}）尚未与${commanderCallsign}绑定，车载主控链路处于完全静默封存态，绝不会提前向${commanderCallsign}发起通联。`;
  } else if (systemLinkModeId === 'commander_initiate') {
    statusTail = `主控台与加密信道内，${presentOfficersText}已完成初期物资账单与近距轮廓备查，但核心机娘（${maidenNamesText}）严格遵循被动静默待机纪律——在${commanderCallsign}亲自主动发起呼叫或接入主控台前，绝不主动弹窗或越权发声打断现场节奏。`;
  } else {
    statusTail = `主控台前，${presentOfficersText}正对照着近距初扫轮廓与车载初期物资账单逐项核验，静候${commanderCallsign}下达首轮实地踏勘、掩体平地或落桩选址的开荒决断。`;
  }

  const cabinParagraph = `${hullLead}受限于车载被动传感器的静默功率与地形遮蔽，主控全息沙盘上仅点亮了掩体周遭近距的表层地貌回波，更外围的深层矿脉品位、地下水源走向、地基承重极限以及远方势力的巡逻盲区，仍笼罩在未勘明的战术迷雾之中。${statusTail}`;

  return {
    cabinParagraph,
    vehiclesText: vehicles.join('、'),
    rosterSummary: `${commanderCallsign}｜${presentOfficersText}`,
    presentOfficersText,
    commanderCallsign,
    maidenNamesText,
  };
}

/**
 * 构建【初期家底与工程爬坡处境】受控质感段（遵循《世界书文风与受控质感编写规范》：
 * 将初始资金、已解锁科技、暴露度与多阵营磨合因果化转译为世界内参谋精算现状，0 非法数值臆造）
 */
function buildInitialFootingParagraph(
  choices: LaunchChoices,
  eff: EffectiveDifficulty,
  selectedFactions: string[],
): string {
  let creditClause = '';
  if (choices.preset === 'hard' || eff.credits <= 1500) {
    creditClause = `车载高能物质储备箱处于紧缺水位（可用启动资金 ${eff.credits}），仅勉强够支撑基地车液压落桩展开与首座基础发电设施的初装，后续矿脉采掘与车间排产没有任何挥霍余地，每一度电、每一吨建材都必须精打细算`;
  } else if (choices.preset === 'easy' || eff.credits >= 2800) {
    creditClause = `车载高能物质储备箱较为充实（可用启动资金 ${eff.credits}），足以稳妥支撑基地车展开、首期电力并网与第一条采掘产线的初装铺设；但在打通本地矿脉与稳定财源前，仍属坐吃山空的初期启动家底，容不得盲目铺摊`;
  } else {
    creditClause = `车载标准高能物质储备处于常规起步水位（可用启动资金 ${eff.credits}），仅够支撑基地车落桩展开、首座基础发电设施并网及初期勘探设备运转；在首座矿场投产回血前，每一笔工程排产与电力分配都必须掐算成本`;
  }

  let techClause = '';
  if (eff.techDone.length === 0) {
    techClause =
      '工程数据库内尚未解锁任何初期应用技术图纸，连基础电力并网与工业工程均需从头立项攻关，属于彻头彻尾的白手起家状态';
  } else if (eff.techDone.length === 1 && eff.techDone[0] === POWER_TECH) {
    techClause = `工程数据库当前仅解锁了「${POWER_TECH}」一项起步技术，矿石精炼、重工装配与环境保障等后续工序图纸均处于封存待研态，必须沿着“先通电、再探矿、后建厂”的工业阶梯逐级爬坡`;
  } else {
    techClause = `工程数据库当前已就绪的起步技术仅有「${eff.techDone.join('、')}」，绝大部分中高级军工与重型底盘图纸仍处于封存待研态，产线扩张必须遵循电力冗余、基础冶金与工程制造的前置因果链条逐步爬坡`;
  }

  let stealthClause = '';
  if (selectedFactions.length >= 2) {
    const joinedNames = selectedFactions.map(id => findFaction(id).name).join('＋');
    stealthClause = `此外，多阵营并线（${joinedNames}）带来了首阶段 15 日跨制式工程磨合期（当前暴露度 ${eff.exposure}），不同制式的电网频率、公差标准与后勤接口亟待现场调校，一旦贸然大功率施工极易放大频谱与热源特征。`;
  } else {
    stealthClause = `当前暴露度维持在 ${eff.exposure} 全赖车载光学伪装网与冷休眠静默；一旦下令基地车液压打桩展开，重型构件变形的机械震动、电站并网的废热羽流与电磁特征都将打破静默，因此落桩前的地质踏勘与掩体遮蔽尤为关键。`;
  }

  return `${creditClause}；${techClause}。${stealthClause}`;
}

/** 组装首条 user 消息（战地初抵序幕 + 开局设定与初期家底处境 + 慢热模拟经营准则 + 首幕推演与现场请示） */
export function composeLaunchMessage(choices: LaunchChoices): string {
  const eff = resolveDifficulty(choices);
  const world = getWorldManifest(choices.worldId);
  if (!world) throw new Error(`未注册世界「${choices.worldId || '空'}」，不能组装开局消息`);
  const loc = resolveLaunchLocation(choices);
  const selectedFactions = resolveSelectedFactions(choices);
  const factionNames = selectedFactions.map(id => findFaction(id).name).join('、');
  const preset = findPreset(choices.preset);
  const tone = findTone(choices.toneId);
  const entryMode = findEntryMode(choices.entryMode);
  const systemLinkModeId = resolveSystemLinkMode(choices);
  const systemLinkMode = findSystemLinkMode(systemLinkModeId, entryMode.id);
  const maidenIncubationMode = findMaidenIncubationMode(resolveMaidenIncubationMode(choices));
  const date = choices.date.trim() || defaultDateForWorld(world.world_id);
  const techText = eff.techDone.length > 0 ? eff.techDone.join('、') : '无';

  const sceneParagraph = buildWorldAndLocationScene(choices, world.world_id, date, loc);
  const {
    cabinParagraph,
    vehiclesText,
    rosterSummary,
    presentOfficersText,
    commanderCallsign,
    maidenNamesText,
  } = buildCabinAndOfficersScene(choices, selectedFactions, systemLinkModeId);
  const initialFootingParagraph = buildInitialFootingParagraph(choices, eff, selectedFactions);

  const activeHumans = (choices.humanRoster ?? []).filter(m => m.name.trim());
  const activeHumanNames = activeHumans.map(m => m.name.trim()).join('、');

  const prologueParagraphs: string[] = [];
  if (entryMode.id === 'pre_transmigration') {
    const humanPresenceClause = activeHumanNames
      ? `${commanderCallsign}与随行核心人员（${activeHumanNames}）正身处原世界穿越发生前的现实第一现场。`
      : `${commanderCallsign}正身处原世界穿越发生前的现实第一现场。`;
    if (systemLinkMode.id === 'post_transmigration_bind') {
      prologueParagraphs.push(
        `【穿越前夕·位面帷幕裂变】当前位置仍处于原世界（跨界穿越尚未启动，且红警最高统帅系统此时尚未与指挥官绑定）。${humanPresenceClause}此时${commanderCallsign}脑海中没有任何系统提示音、神经视界微光或跨界缓冲舱感知，更不知道移动基地车（${vehiclesText}）与核心机娘（${maidenNamesText}）的存在，${maidenNamesText}等核心机娘也绝不可能跨越位面提前联系${commanderCallsign}。远端异界「${world.display_name}」的拟定落点「${loc.location}」与统帅系统仅作为“待正式完成跨界穿越后才会激活绑定”的远期设定静默蛰伏——在原世界做何种行动筹备、如何与身边人员互动、以及何时正式触发跨界穿越，完全听凭${commanderCallsign}按自身节奏全权决断。`,
        `【远端信标遥测·待跨界目标战区预演】本局预设的远端跨界目标坐标为「${world.display_name} · ${formatLocationLabel(loc)}」（拟定目标纪年：${date}；待穿越后绑定的编制为：${vehiclesText}｜${presentOfficersText}）。【未穿越前零系统铁律】在${commanderCallsign}正式完成跨界穿越并降临目标世界之前，上述系统、移动基地车、核心机娘（${maidenNamesText}）与初期物资账单均处于“尚未绑定、完全不可感知、不可通联”状态，严禁在原世界序章中提前觉醒系统或让核心机娘联系主角！`,
      );
    } else if (systemLinkMode.id === 'commander_initiate') {
      prologueParagraphs.push(
        `【穿越前夕·位面帷幕裂变】当前位置仍处于原世界（跨界穿越尚未启动）。${humanPresenceClause}随行移动基地车（${vehiclesText}）与核心机娘（${maidenNamesText}）虽已在系统跨界缓冲舱内封存待命，但严格处于被动静默待机态——在${commanderCallsign}亲自主动发起意识呼叫前，绝不会主动弹窗或越权发声打扰原世界现场。远端异界「${world.display_name}」的拟定落点「${loc.location}」处于待命状态，何时联系系统、何时正式触发跨界穿越，完全听凭${commanderCallsign}按自身节奏全权决断。`,
        `【远端信标遥测·待跨界目标战区预演】跨界信标锁定的目标坐标为「${world.display_name} · ${formatLocationLabel(loc)}」（拟定目标纪年：${date}）。跨界缓冲链路内，${vehiclesText}与${presentOfficersText}已完成封存自检，在${commanderCallsign}亲自发起联系前将全程维持静默，绝不主动干扰原世界现场行动。`,
      );
    } else {
      prologueParagraphs.push(
        `【穿越前夕·位面帷幕裂变】当前位置仍处于原世界（跨界穿越尚未启动）。${humanPresenceClause}与此同时，红警最高统帅部核心链路已在意识深处完成初醒，随行移动基地车（${vehiclesText}）与核心机娘正于系统跨界缓冲舱内封存待命。远端异界「${world.display_name}」的拟定落点「${loc.location}」已由跨界信标完成锚定，但跨界投射通道仍处于未激发待命态——在原世界做何种行动筹备以及何时正式触发跨界穿越，完全听凭${commanderCallsign}按自身节奏全权决断。`,
        `【远端信标遥测·待跨界目标战区预演】跨界信标远端锁定的目标坐标为「${world.display_name} · ${formatLocationLabel(loc)}」（拟定目标纪年：${date}）。跨界缓冲链路内，${vehiclesText}与${presentOfficersText}已完成封存自检并备妥初期物资账单，静候${commanderCallsign}下达跨界指令。`,
      );
    }
  } else if (entryMode.id === 'dormant_infiltration') {
    if (systemLinkMode.id === 'post_transmigration_bind') {
      prologueParagraphs.push(
        `【潜行唤醒·统帅链路并网】${commanderCallsign}正以本土伪装身份潜伏于「${world.display_name}」日常环境之中；此时最高统帅系统与远端预选隐蔽区「${loc.location}」内的移动基地车（${vehiclesText}）尚未与${commanderCallsign}完成觉醒绑定，核心机娘（${maidenNamesText}）尚无法联系主角，静候后续觉醒契机触发。`,
        sceneParagraph,
        cabinParagraph,
      );
    } else if (systemLinkMode.id === 'commander_initiate') {
      prologueParagraphs.push(
        `【潜行唤醒·统帅链路并网】${commanderCallsign}正以本土伪装身份潜伏于「${world.display_name}」日常环境之中；远端预选隐蔽区「${loc.location}」内封存待命的移动基地车（${vehiclesText}）与核心机娘（${maidenNamesText}）处于底层被动静默待机态，在${commanderCallsign}亲自打开加密终端主动发起呼叫前，绝不会主动弹窗或越权发声打断${commanderCallsign}眼下的本土处境。`,
        sceneParagraph,
        cabinParagraph,
      );
    } else {
      prologueParagraphs.push(
        `【潜行唤醒·统帅链路并网】潜伏于「${world.display_name}」日常伪装下的寂静被视网膜微光打破，加密战术链路内传来最高统帅部100%同步完毕的提示音；远端预选隐蔽区「${loc.location}」内封存待命的移动基地车（${vehiclesText}）已解除休眠锁死，${presentOfficersText}正式接入指挥频道，静候${commanderCallsign}按自身节奏处理眼下本土处境。`,
        sceneParagraph,
        cabinParagraph,
      );
    }
  } else {
    prologueParagraphs.push(sceneParagraph, cabinParagraph);
  }

  const locationStatusSuffix =
    entryMode.id === 'pre_transmigration'
      ? '（远端信标拟定坐标 · 当前仍处原世界尚未穿越，MCV 封存待命）'
      : '（拟定预选战区 · MCV 车载待命尚未展开）';

  const lines: string[] = [
    '【战地初抵序幕】',
    ...prologueParagraphs,
    '',
    '【开局设定】',
    `- 世界：${world.display_name}`,
    `- 开场切入模式：${entryMode.label}`,
    `- 系统与机娘通联：${systemLinkMode.label}`,
    `- 机娘孵化模式：${maidenIncubationMode.label}`,
    `- 阵营：${factionNames}（首发载具：${vehiclesText}）`,
    `- 部署地点：${formatLocationLabel(loc)}${locationStatusSuffix}`,
    `- 初始基地状态：无在役基地（MCV 未展开前禁止预设基地）`,
    `- 日期：${date}`,
    `- 在场统帅与参谋：${rosterSummary}`,
    `- 初始资金：${eff.credits}`,
    `- 已解锁科技：${techText}`,
    `- 初始暴露度：${eff.exposure}`,
    `- 难度：${preset.label}`,
    '',
    '【初期家底与工程爬坡处境】',
    initialFootingParagraph,
    '',
    `【世界开局侧写】${world.opening_profile.presetHint}`,
    entryMode.directive,
    systemLinkMode.directive,
    maidenIncubationMode.directive,
  ];
  const eraDirective = resolveEraDirectiveForChoices(choices);
  if (eraDirective) {
    lines.push(eraDirective);
  }
  if (loc.isCustom && loc.flavor.trim()) {
    lines.push(`【自定义部署点环境】${loc.flavor.trim()}`);
  }
  if (activeHumans.length > 0) {
    lines.push('', '【随行己方人物档案】');
    for (const m of activeHumans) {
      const hName = m.name.trim();
      const callsignStr = m.callsign?.trim() ? `（代号「${m.callsign.trim()}」）` : '';
      const originLabel = findHumanOrigin(m.origin).label;
      const roleLabel =
        m.assignment === 'staff'
          ? '现任联席参谋部专职参谋'
          : m.assignment.startsWith('faction:')
            ? `现任${findFaction(m.assignment.slice('faction:'.length)).name}主责副官`
            : '随行核心人员';
      const detailSegs = [
        `随行渊源：${originLabel}`,
        m.appearance?.trim() ? `外貌着装：${m.appearance.trim()}` : '',
        m.personality?.trim() ? `性格与说话风格：${m.personality.trim()}` : '',
        m.bio.trim() ? `履历与绝活：${m.bio.trim()}` : '',
      ].filter(Boolean);
      lines.push(`- ${hName}${callsignStr}｜${m.title.trim() || '随行军官'}（${roleLabel}）：${detailSegs.join('；')}`);
    }
  }

  const selectedStarters = selectedFactions
    .map(fid => resolveStarterMcvInfo(fid))
    .filter((s): s is NonNullable<ReturnType<typeof resolveStarterMcvInfo>> => Boolean(s));
  if (selectedStarters.length > 0) {
    lines.push('', '【首发核心机娘差异化人设锚点（严禁写得像同质化播报机器）】');
    for (const starter of selectedStarters) {
      lines.push(
        `- ${starter.girlName}（${starter.factionLabel} · ${starter.unitSerial} · 代号「${starter.callsign}」｜${starter.girlTitle}｜核心意象：${starter.archetypeTag}）：外貌着装：${starter.appearance}性格反差与口吻：${starter.personality}工业专精与搭档：${starter.specialtyAndBond}标志性台词：${starter.quote}`,
      );
    }
    if (selectedStarters.length >= 2) {
      lines.push(
        '- 统帅部“内务铁三角”化学反应：白凌（微米级公差洁癖的冰瓷长姊，嘴硬心软熬夜兜底）、喀秋莎（嗓门洪亮的烈火重工大姐头，嫌白凌磨叽却会塞滚烫红菜汤、抢着给统帅座驾多焊装甲）与尤里卡（端着安神花茶保温杯的慵懒毒舌御医，最爱冷不丁报出两人飙升的心率让她们红脸闭嘴）之间具有极强的性格张力与同袍温度。',
      );
    }
    lines.push(
      `- 通联时机与演绎铁律（当前通联模式：${systemLinkMode.id}）：若当前通联时机为 post_transmigration_bind 或 commander_initiate，在未绑定/未通联前核心机娘必须严格保持静默不出场；一旦后续完成绑定或由指挥官亲自唤醒通联，必须严格按此鲜明人设、外貌细节与口吻台词演绎，严禁写成千篇一律的冰冷电子音！`,
    );
  }

  lines.push(`【叙事基调】${tone.instruction}`);
  if (eff.narrativeSeed) {
    lines.push(`态势基调：${eff.narrativeSeed}`);
  }
  lines.push(
    '',
    '【慢热模拟经营与渐进发育准则】',
    '- 玩家节奏主权（最高优先级）：全流程必须将行动节奏与阶段推进的决定权 100% 交还指挥官（玩家）。若指挥官在附加指示或输入中设定了特定情境、身份细节或行动安排，必须无条件顺应玩家给定的步幅展开；严禁 AI 抢跑、严禁替指挥官越权做决定、严禁在同一回合内把“前夕→过程→结果”或“勘探→展开→建厂→交火”一口气快进演完。',
    '- 系统觉醒与机娘通联边界：严格遵守上方设定的「系统与机娘通联」时机！若为「穿越/契机后才绑定系统」，在正式完成穿越前主角完全未绑定系统、脑海中无任何系统微光或提示音，核心机娘（如白凌等）绝不可能跨位面联系主角或在 <态势>/<选项> 中出现；若为「由指挥官亲自联系」，在指挥官主动开口呼叫或亲自接入终端前，核心机娘必须保持绝对静默，严禁主动弹窗或抢先搭话汇报。',
    '- 阶段边界硬锁（零越权转场）：若为「原世界序章·穿越前夕」，首幕必须严格停留在原世界穿越发生前的现场，绝对禁止一口气进入穿越过程或直接写出落地异界后的结果；若为「异世潜行·待机觉醒」，首幕必须停留在指挥官当下的本土潜伏现场，禁止擅自替玩家瞬移至远端基地车；若为「战地直降·初抵待命」，首幕必须停留在车舱静默待命与近距半迷雾状态，禁止擅自展开基地车或强行制造遭遇战。',
    '- 叙事步幅与时间流速：本局为长线策略模拟经营与基建拓荒战役，首幕及开荒初期必须放慢时间流速，聚焦眼前掩体周遭的生存隐蔽、近距地形踏勘、岩土承重与水源核验、场地平整以及第一笔电力与建材的精打细算。',
    '- 战争迷雾与渐进探索：严禁在开局首幕替指挥官一键扫清全图或跳过勘探过程；外围深层矿脉品位、本土势力暗哨与复杂地貌必须通过后续派出人员/侦察单位实地踏勘、架设雷达或逐步推进来一层层揭开。',
    '- 工业爬坡与因果质感：严禁快进式“一回合建成庞大基地群”或开局直接刷出成建制重装大军交火；从移动基地车落桩展开、首座基础发电厂并网、第一条矿石精炼线运转到车间扩建，每一步都必须体现工程工期、后勤消耗与冷峻的工业物理质感。',
  );
  const custom = choices.customPrompt.trim();
  if (custom) {
    lines.push('', '【指挥官附加指示】', custom);
  }

  let openingLeadLine = '';
  let closingGuidance = '';
  if (entryMode.id === 'pre_transmigration') {
    const companionSceneHint = activeHumanNames
      ? `以及${commanderCallsign}与身边随行核心人员（${activeHumanNames}）在原世界现场的动作、神态与对手戏`
      : `以及${commanderCallsign}在原世界现场的动作与处境细节`;
    if (systemLinkMode.id === 'post_transmigration_bind') {
      openingLeadLine = `当前坐标仍位于原世界（跨界穿越尚未启动 · 红警系统与核心机娘尚未绑定，须待正式穿越后方能绑定激活），请指挥官按自身节奏掌控原世界现场行动。`;
      closingGuidance = `请严格从${commanderCallsign}在原世界（穿越尚未发生前）的当下现场慢镜头切入（若上方附有指挥官附加指示，须以附加指示所描绘的原世界场景、载具与人物行动为唯一主舞台），100% 纯粹地描摹原世界身边的真实物理环境${companionSceneHint}。【核心铁律】1. 严禁抢跑穿越：本轮正文严禁进入穿越通道穿梭过程，绝对禁止出现时空裂隙当场吞没众人或直接写出已经抵达「${world.display_name}（${loc.location}）」后的落地结果！2. 严禁提前觉醒系统或通联机娘：当前处于未穿越前的「穿越后才绑定系统」状态，${commanderCallsign}此时尚未绑定红警系统，脑海中严禁出现任何系统提示音、神经视界微光、底层信道涟漪或核心机娘（${maidenNamesText}）的声音，${maidenNamesText}她们也绝不可能在穿越前联系到主角！3. 标签严格对齐原世界无系统状态：本轮 <态势>/<战况> 中严禁输出 基地: 字段，且 <态势> 的「参谋建议」严禁出现${maidenNamesText}等尚未绑定的机娘或统帅部系统（仅允许由原世界现场的随行人类同伴如${activeHumanNames || '身边队友'}以当前现实行动视角提出建议）；<事件> 与 <情报> 严禁跨时空编造目标世界敌情；<选项> 必须 100% 围绕原世界当下现场的下一步行动（如登机/进入驾驶室、检查装备、小队交谈等）生成，严禁出现“在意识链路中呼唤白凌/查看跨界缓冲舱”等超前选项！`;
    } else if (systemLinkMode.id === 'commander_initiate') {
      openingLeadLine = `当前坐标仍位于原世界（跨界信标已锚定远端目标「${loc.location}」· 系统与核心机娘处于被动静默待机态，须由指挥官亲自发起联系），请指挥官按自身节奏掌控穿越前夕的行动。`;
      closingGuidance = `请严格从${commanderCallsign}在原世界（穿越尚未发生前）的当下现场慢镜头切入（若上方附有指挥官附加指示，须以附加指示所描绘的原世界场景、载具与人物行动为唯一主舞台），细腻描摹原世界身边的真实物理环境${companionSceneHint}。【核心铁律】1. 严禁抢跑穿越：本轮正文严禁进入穿越通道穿梭过程，绝对禁止写出已经抵达「${world.display_name}（${loc.location}）」后的落地结果！2. 严禁机娘主动联系：在${commanderCallsign}亲自主动发起呼叫前，核心机娘（${maidenNamesText}）与系统必须保持绝对静默，正文中严禁机娘主动发声或弹窗打断现场；3. 标签严格对齐：本轮 <态势>/<战况> 中严禁输出 基地: 字段，<态势> 的「参谋建议」仅由原世界现场随行人类同伴（${activeHumanNames || '身边队友'}）给出，严禁尚未被指挥官联系的机娘越权汇报；<选项> 围绕原世界现场行动生成（可附带一项由指挥官亲自呼叫系统的备选）。`;
    } else {
      openingLeadLine = `当前坐标仍位于原世界（跨界信标已锚定远端目标「${loc.location}」· MCV 处于跨界封存待命态），请指挥官按自身节奏掌控穿越前夕的行动与跨界时机。`;
      closingGuidance = `请严格从${commanderCallsign}在原世界（穿越尚未发生前）的当下现场慢镜头切入（若上方附有指挥官附加指示，须以附加指示所描绘的原世界场景、载具与人物行动为唯一主舞台），细腻描摹原世界身边的真实物理环境${companionSceneHint}；此时移动基地车（${vehiclesText}）与核心机娘仍处于系统跨界缓冲舱封存待命态，尚未启动跨界投射，更未落地展开任何固定基地（本轮 <态势>/<战况> 中严禁输出 基地: 字段）。【核心铁律】1. 本轮正文严禁一口气进入穿越通道穿梭过程，绝对禁止直接写出已经抵达「${world.display_name}（${loc.location}）」后的落地结果！2. 本轮文末 <事件> 与 <情报> 严禁跨时空提前编造目标世界的本地敌情；<选项> 必须围绕原世界当下现场的下一步行动生成，将节奏控制权完全交由指挥官把控。`;
    }
  } else if (entryMode.id === 'dormant_infiltration') {
    if (systemLinkMode.id === 'commander_initiate') {
      openingLeadLine = `当前指挥官正以本土身份潜伏于「${world.display_name}」，远端预选掩体「${loc.location}」内的 MCV 与核心机娘处于被动静默待机态（须由指挥官亲自发起联系），请指挥官按自身节奏下达首步指令。`;
      closingGuidance = `请从${commanderCallsign}在「${world.display_name}」的本土潜伏现场与日常生计切入，细腻描摹周围市井或荒原的环境肌理${activeHumanNames ? `以及身边随行人员（${activeHumanNames}）的现场互动` : ''}；此时移动基地车（${vehiclesText}）与核心机娘（${maidenNamesText}）隐蔽蛰伏于远端预选区「${loc.location}」保持被动静默，在${commanderCallsign}亲自打开加密终端主动呼叫前，严禁核心机娘主动弹窗或越权发声汇报（本轮 <战况> 中严禁输出 基地: 字段，<态势> 参谋建议不由未通联的机娘越权呈报）。严禁替指挥官擅自转场瞬移至基地车旁，请在 <选项> 中将“继续处理眼下本土事务、亲自发起加密通联联系核心机娘、或动身前往预选掩体”的决定权完全交给指挥官。`;
    } else if (systemLinkMode.id === 'post_transmigration_bind') {
      openingLeadLine = `当前指挥官正以本土身份潜伏于「${world.display_name}」（系统与远端 MCV 尚处于未觉醒绑定态，须待后续契机触发绑定），请指挥官按自身节奏掌控当前行动。`;
      closingGuidance = `请从${commanderCallsign}在「${world.display_name}」的本土潜伏现场切入，100% 聚焦眼下现实处境${activeHumanNames ? `与身边随行人员（${activeHumanNames}）的互动` : ''}；当前红警统帅系统与核心机娘（${maidenNamesText}）尚未觉醒绑定，正文中严禁出现任何系统提示音或机娘通联（本轮 <战况> 中严禁输出 基地: 字段，<态势> 参谋建议严禁出现未绑定机娘）。`;
    } else {
      openingLeadLine = `当前指挥官正以本土身份潜伏于「${world.display_name}」，远端预选掩体「${loc.location}」内的 MCV 已完成静默唤醒（车载待命 · 外围尚处战术迷雾），请指挥官按自身节奏下达首步指令。`;
      closingGuidance = `请从${commanderCallsign}在「${world.display_name}」的本土潜伏现场与日常生计切入，细腻描摹周围市井或荒原的环境肌理，以及战术终端内${presentOfficersText}刚刚完成静默并网后的低声汇报；此时移动基地车（${vehiclesText}）仍隐蔽蛰伏于预选区「${loc.location}」待命，尚未展开为固定建造厂（本轮 <战况> 中严禁输出 基地: 字段），外围深层地质、水源与安全窗口尚处于待踏勘的半迷雾态。严禁替指挥官擅自转场瞬移至基地车旁，请将后续行程与节奏控制权完全交给指挥官。`;
    }
  } else {
    openingLeadLine = `MCV 已隐蔽驻泊于${loc.location}临时掩体（车载静默待命 · 外围尚处战术迷雾），请指挥官审阅初期家底并下达首步开荒指令。`;
    if (systemLinkMode.id === 'commander_initiate') {
      closingGuidance = `请从掩体现场与车舱内外的近距实地风貌切入，细腻描摹初抵「${loc.name}」时的气候光影、脚下未经平整的荒芜地表、车载母机低功耗静默的机械质感${activeHumanNames ? `，以及${commanderCallsign}与身边随行人员（${activeHumanNames}）的现场互动` : ''}；此时移动基地车（${vehiclesText}）仍处于车载伪装静默待命状态，尚未就地展开为固定建造厂，战区无任何在役基地（本轮 <战况> 中严禁输出 基地: 字段）。【由指挥官亲自联系铁律】核心机娘（${maidenNamesText}）与车载主控系统当前处于被动静默待机态，在${commanderCallsign}亲自开口呼叫或主动接入主控终端前，严禁核心机娘主动弹窗或抢先搭话汇报（本轮 <态势> 参谋建议优先由在场随行人类同伴给出，或仅作终端静默待机记录）；请在 <选项> 中提供由指挥官亲自唤醒主控终端联系${maidenNamesText}、派员近距踏勘周边地形迷雾、或筹备场地平整的慢节奏行动选项，将通联与开荒的主动权 100% 交由指挥官下达。`;
    } else if (systemLinkMode.id === 'post_transmigration_bind') {
      closingGuidance = `请从初抵「${loc.name}」的第一现场切入，描摹脚下未经平整的荒芜地表与周围半迷雾环境${activeHumanNames ? `以及${commanderCallsign}与身边随行人员（${activeHumanNames}）的现场互动` : ''}；当前红警统帅系统与核心机娘（${maidenNamesText}）尚处于待绑定激活态（本轮 <战况> 中严禁输出 基地: 字段），在${commanderCallsign}触发绑定契机前，严禁机娘主动发声或在 <态势> 参谋建议中越权出现，将何时激活绑定与首步探索的节奏完全交由指挥官把控。`;
    } else {
      closingGuidance = `请从车舱内的第一现场视角与伪装网外的近距实地风貌切入，细腻描摹初抵「${loc.name}」时的气候光影、脚下未经平整的荒芜地表、车载母机低功耗静默的机械质感，以及近距掩体外尚未散去的战术迷雾；此时移动基地车（${vehiclesText}）仍处于车载伪装静默待命状态，尚未就地展开为固定建造厂，战区无任何在役基地（本轮 <战况> 中严禁输出 基地: 字段）。请写出${presentOfficersText}在主控台前向${commanderCallsign}呈报车载自检、盘点手头紧巴的初期启动物资与已解锁技术台阶、指出近处待实地核验的地质承重/水源/矿苗疑点，并当面请示「是先车内整备、派出人手或侦察设备出舱摸清周边地形与安全盲区，还是先在掩体就地平整场地、筹备基地车落桩与首座电站并网」的慢节奏现场互动，将开荒节奏与第一步决断完全交由指挥官下达。`;
    }
  }

  lines.push(
    '',
    '【首幕推演与现场请示】',
    openingLeadLine,
    closingGuidance,
  );
  return lines.join('\n');
}

export const buildFirstMessage = composeLaunchMessage;

// ─────────────────────────────── HostAdapter ───────────────────────────────

/** 宿主动词层：真实现走酒馆全局，mock 实现走内存（vite 预览 / vitest） */
export interface HostAdapter {
  readonly inTavern: boolean;
  getChatVars(): Record<string, unknown>;
  /** #0 楼 message 域整棵写入 stat_data */
  setStatData(statData: Schema): Promise<void>;
  /** 读回 #0 楼 stat_data（写后核验用；不存在返回 undefined） */
  getStatData(): unknown;
  /** chat 域整棵写入/清除 $boot（undefined = 清除） */
  setBoot(next: BootState | undefined): Promise<void>;
  switchPersona(name: string): Promise<void>;
  currentPersonaName(): string | null;
  createPersona(name: string, description: string): Promise<void>;
  personaNames(): string[];
  personaDescription(name: string): string;
  sendUserMessage(content: string): Promise<void>;
  /** /trigger 触发 AI 生成 */
  triggerGeneration(): Promise<void>;
  /** 全局启用列表（World Info Active）——启用判据（驾驶员铁律：绑卡 ≠ 启用） */
  globalWorldbookNames(): string[];
  /** 酒馆全部书文件名（存在性判据） */
  allWorldbookNames(): string[];
  /** P6 兼容接口：只增不减，并集启用指定书 */
  activateWorldbooks(names: string[]): Promise<void>;
  /** P7 原语：替换给定受管书成员资格；调用时即时保留现场全部清单外书 */
  replaceWorldbooks(names: string[]): Promise<void>;
}

/** 真实现：仅在酒馆 iframe 内调用（宿主全局由 @types 声明、auto-import/宿主注入提供） */
export function createRealHostAdapter(): HostAdapter {
  return {
    inTavern: true,
    getChatVars: () => (getVariables({ type: 'chat' }) ?? {}) as Record<string, unknown>,
    setStatData: async statData => {
      // 惯例：整棵 _.set + await；严禁数字字符串路径直写
      await updateVariablesWith(v => _.set(v, 'stat_data', statData), { type: 'message', message_id: 0 });
    },
    getStatData: () =>
      (getVariables({ type: 'message', message_id: 0 }) as Record<string, unknown> | undefined)?.['stat_data'],
    setBoot: async next => {
      await updateVariablesWith(
        v => {
          if (next === undefined) _.unset(v, '$boot');
          else _.set(v, '$boot', next);
          return v;
        },
        { type: 'chat' },
      );
    },
    switchPersona: async name => {
      await triggerSlash('/persona ' + name);
    },
    currentPersonaName: () => getCurrentPersonaName(),
    createPersona: async (name, description) => {
      await createOrReplacePersona(name, { description });
    },
    personaNames: () => getPersonaNames(),
    personaDescription: name => {
      try {
        return getPersona(name)?.description ?? '';
      } catch {
        return '';
      }
    },
    sendUserMessage: async content => {
      // 宿主 API 契约字段名为 message（@types/function/chat_message.d.ts:155-159）
      await createChatMessages([{ role: 'user', message: content }]);
    },
    triggerGeneration: async () => {
      await triggerSlash('/trigger');
    },
    globalWorldbookNames: () => getGlobalWorldbookNames(),
    allWorldbookNames: () => getWorldbookNames(),
    activateWorldbooks: async names => {
      // 兼容 P6：rebindGlobalWorldbooks 是全量替换语义，故先并入当前列表
      await rebindGlobalWorldbooks([...new Set([...getGlobalWorldbookNames(), ...names])]);
    },
    replaceWorldbooks: async names => {
      const managed = managedWorldbookNames();
      const currentUnmanaged = getGlobalWorldbookNames().filter(name => !managed.has(name));
      const requestedManaged = names.filter(name => managed.has(name));
      await rebindGlobalWorldbooks([...new Set([...currentUnmanaged, ...requestedManaged])]);
    },
  };
}

/** mock 实现的可观测内脏（测试/预览断言用） */
export interface MockHostAdapter extends HostAdapter {
  chatVars: Record<string, unknown>;
  /** #0 楼 message 域（stat_data 落点） */
  messageVars: Record<string, unknown>;
  sentMessages: string[];
  generateCount: number;
  personas: Record<string, string>;
  callLog: string[];
  /** 酒馆全部书文件（可注入缺书场景） */
  tavernBooks: string[];
  /** 全局启用列表（可注入缺书/他卡书场景） */
  globalBooks: string[];
}

/** mock 实现：内存态 + 两个假 persona；delayMs>0 时每个动词加延迟（预览进度行可见性） */
export function createMockHostAdapter(delayMs = 0): MockHostAdapter {
  const wait = () => (delayMs > 0 ? new Promise<void>(r => setTimeout(r, delayMs)) : Promise.resolve());
  let current: string | null = null;
  // 预览默认书单场景：书文件齐全，但两本必需书未进全局启用列表（体检→一键启用可走通）；
  // 全局列表里预埋一本清单外的「他卡书」，验证并集写入不误杀
  const requiredBooks = WORLD_BOOK_MANIFESTS.xiuzhen.books.filter(b => b.required).map(b => b.name);
  const availableBooks = [
    ...new Set(Object.values(WORLD_BOOK_MANIFESTS).flatMap(manifest => manifest.books.map(book => book.name))),
  ];
  const mockMissing = ['武备·盟军', '通用·人员'];
  const adapter: MockHostAdapter = {
    inTavern: false,
    chatVars: {},
    messageVars: {},
    sentMessages: [],
    generateCount: 0,
    tavernBooks: availableBooks,
    globalBooks: ['预览·他卡自有书', ...requiredBooks.filter(n => !mockMissing.includes(n))],
    personas: {
      林岚少校: '预备指挥官档案：装甲兵出身，沉稳务实，习惯以简报体下达命令。',
      夜莺: '预备指挥官档案：前情报军官，偏好隐蔽行动与信息战，话少而准。',
    },
    callLog: [],
    getChatVars: () => adapter.chatVars,
    setStatData: async statData => {
      await wait();
      adapter.callLog.push('setStatData');
      adapter.messageVars['stat_data'] = statData;
    },
    getStatData: () => adapter.messageVars['stat_data'],
    setBoot: async next => {
      await wait();
      adapter.callLog.push('setBoot');
      if (next === undefined) delete adapter.chatVars['$boot'];
      else adapter.chatVars['$boot'] = next;
    },
    switchPersona: async name => {
      await wait();
      adapter.callLog.push(`switchPersona:${name}`);
      // 与真机 /persona 同语义：名字不存在则切换不生效（由工序侧验证抛错）
      if (name in adapter.personas) current = name;
    },
    currentPersonaName: () => current,
    createPersona: async (name, description) => {
      await wait();
      adapter.callLog.push(`createPersona:${name}`);
      adapter.personas[name] = description;
    },
    personaNames: () => Object.keys(adapter.personas),
    personaDescription: name => adapter.personas[name] ?? '',
    sendUserMessage: async content => {
      await wait();
      adapter.callLog.push('sendUserMessage');
      adapter.sentMessages.push(content);
    },
    triggerGeneration: async () => {
      await wait();
      adapter.callLog.push('triggerGeneration');
      adapter.generateCount += 1;
    },
    globalWorldbookNames: () => [...adapter.globalBooks],
    allWorldbookNames: () => [...adapter.tavernBooks],
    activateWorldbooks: async names => {
      await wait();
      adapter.callLog.push(`activateWorldbooks:${names.join('|')}`);
      // 与真实现同语义：当前全局 ∪ 目标，去重保序（他卡书原样保留）
      adapter.globalBooks = [...new Set([...adapter.globalBooks, ...names])];
    },
    replaceWorldbooks: async names => {
      await wait();
      const managed = managedWorldbookNames();
      const currentUnmanaged = adapter.globalBooks.filter(name => !managed.has(name));
      const requestedManaged = names.filter(name => managed.has(name));
      const next = [...new Set([...currentUnmanaged, ...requestedManaged])];
      adapter.callLog.push(`replaceWorldbooks:${next.join('|')}`);
      adapter.globalBooks = next;
    },
  };
  return adapter;
}

/**
 * P7 排他同步事务：缺 required 时零写入；写后严格核验；失败时恢复调用前快照。
 * 返回纯计划供 UI/测试展示。该事务只管理已注册世界专属书，清单外哨兵由 plan 保留。
 */
const worldbookSyncLocks = new WeakMap<HostAdapter, Promise<void>>();

async function withWorldbookSyncLock<T>(adapter: HostAdapter, task: () => Promise<T>): Promise<T> {
  const previous = worldbookSyncLocks.get(adapter) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  worldbookSyncLocks.set(adapter, tail);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (worldbookSyncLocks.get(adapter) === tail) worldbookSyncLocks.delete(adapter);
  }
}

async function syncWorldbooksUnlocked(
  adapter: HostAdapter,
  worldId: string,
  unlockedFactions?: readonly string[],
): Promise<WorldbookSyncPlan> {
  const manifest = WORLD_BOOK_MANIFESTS[worldId];
  if (!manifest) throw new Error(`world_id「${worldId || '空'}」未注册，不能切换世界书`);

  // 在真正写入前即时重读并重新规划，避免拿 UI 体检时的陈旧快照覆盖现场。
  const plan = planWorldbookSync(
    manifest,
    adapter.globalWorldbookNames(),
    adapter.allWorldbookNames(),
    unlockedFactions,
  );
  if (plan.unavailableRequired.length > 0) {
    throw new Error(`必需世界书文件缺失：${plan.unavailableRequired.join('、')}`);
  }
  if (!plan.changed) return plan;

  try {
    await adapter.replaceWorldbooks(plan.next);
    const actual = adapter.globalWorldbookNames();
    // 宿主列表顺序没有契约；只核验 P7 受管书成员资格，并允许并发新增清单外哨兵。
    if (!hasSameManagedWorldbooks(actual, plan.next)) {
      throw new Error(`写后核验不一致：当前世界的受管书集合未达到目标状态`);
    }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    try {
      const recoveryBase = adapter.globalWorldbookNames();
      const recovery = planManagedWorldbookRecovery(plan.previous, recoveryBase);
      if (!hasSameManagedWorldbooks(recoveryBase, plan.previous)) {
        await adapter.replaceWorldbooks(recovery);
      }
      const restored = adapter.globalWorldbookNames();
      if (!hasSameManagedWorldbooks(restored, plan.previous)) {
        throw new Error(`恢复核验不一致：原受管书集合未恢复`, { cause });
      }
    } catch (restoreCause) {
      const restoreDetail = restoreCause instanceof Error ? restoreCause.message : String(restoreCause);
      throw new Error(`世界书排他切换失败：${detail}；恢复原受管书集合也失败：${restoreDetail}`, {
        cause: restoreCause,
      });
    }
    throw new Error(`世界书排他切换失败，已恢复原受管书集合：${detail}`, { cause });
  }
  return plan;
}

/**
 * 同一启动器实例内串行同步；宿主 UI、其他 iframe 或扩展无法共享此锁，仍需真实 F2 验证。
 */
export function syncWorldbooksForWorld(
  adapter: HostAdapter,
  worldId: string,
  unlockedFactions?: readonly string[],
): Promise<WorldbookSyncPlan> {
  return withWorldbookSyncLock(adapter, () => syncWorldbooksUnlocked(adapter, worldId, unlockedFactions));
}

let singleton: HostAdapter | undefined;

/** 按 in_tavern 选择真/mock 适配器（模块级单例：App 与 Step 组件共享同一内存态） */
export function getHostAdapter(): HostAdapter {
  if (!singleton) {
    const inTavern = typeof (window as { TavernHelper?: unknown }).TavernHelper !== 'undefined';
    singleton = inTavern ? createRealHostAdapter() : createMockHostAdapter(250);
  }
  return singleton;
}

// ─────────────────────────────── 工序引擎 ───────────────────────────────

export interface LaunchCtx {
  adapter: HostAdapter;
  choices: LaunchChoices;
  /** 可选：导入开局时的完整 SavePack（用于恢复 V2 扩展载荷） */
  importedPack?: SavePack;
  /** 工序间传递（writeStatData 产出 statData，composeAndSend 产出 message） */
  statData?: Schema;
  message?: string;
}

export type StepStatus = 'running' | 'done' | 'skipped' | 'warning' | 'error';

export interface StepProgress {
  name: string;
  label: string;
  status: StepStatus;
  error?: string;
}

export interface LaunchStep {
  name: string;
  label: string;
  critical: boolean;
  skip?: (ctx: LaunchCtx) => boolean;
  run: (ctx: LaunchCtx) => Promise<void>;
}

/** critical 工序失败时中止整线抛出的错误（UI 停错误态显示"重试发射"） */
export class LaunchPipelineError extends Error {
  readonly stepName: string;
  readonly stepLabel: string;
  readonly causeError: unknown;
  constructor(step: LaunchStep, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`工序「${step.label}」失败：${detail}`);
    this.name = 'LaunchPipelineError';
    this.stepName = step.name;
    this.stepLabel = step.label;
    this.causeError = cause;
  }
}

/**
 * 顺序 await 执行工序：skip 记 'skipped'；critical 失败 → 中止整线抛 LaunchPipelineError；
 * 非 critical 失败 → 记 'warning' 继续。onProgress 按状态变化逐事件回调。
 * P7 策略：bind 成功后若下游工序失败，不回切旧世界书；保留目标态供同一按钮原地重试。
 */
export async function runLaunchPipeline(
  steps: LaunchStep[],
  ctx: LaunchCtx,
  onProgress?: (progress: StepProgress) => void,
): Promise<StepProgress[]> {
  const results: StepProgress[] = [];
  const report = (p: StepProgress) => {
    results.push(p);
    onProgress?.(p);
  };
  for (const step of steps) {
    if (step.skip?.(ctx)) {
      report({ name: step.name, label: step.label, status: 'skipped' });
      continue;
    }
    report({ name: step.name, label: step.label, status: 'running' });
    try {
      await step.run(ctx);
      report({ name: step.name, label: step.label, status: 'done' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (step.critical) {
        report({ name: step.name, label: step.label, status: 'error', error: msg });
        throw new LaunchPipelineError(step, e);
      }
      report({ name: step.name, label: step.label, status: 'warning', error: msg });
    }
  }
  return results;
}

// ─────────────────────────────── 发射工序 ───────────────────────────────

/** choices 的纯数据快照（去 reactive 代理，附归算后的最终难度值）。
 *  importedStat 全量树不进 $boot（防快照膨胀），只留 imported 布尔标记。 */
export function snapshotChoices(choices: LaunchChoices): Record<string, unknown> {
  const { importedStat, ...rest } = choices;
  const plain = JSON.parse(JSON.stringify(rest)) as Record<string, unknown>;
  plain.imported = importedStat !== null;
  plain.effective = resolveDifficulty(choices);
  return plain;
}

function tav<T = (...args: never[]) => unknown>(name: string): T | undefined {
  const fn = (globalThis as Record<string, unknown>)[name];
  return typeof fn === 'function' ? (fn as T) : undefined;
}

function makeCanonicalBookName(charName: string, now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}T${p(now.getHours())}${p(now.getMinutes())}`;
  return `红警档案·${charName.trim() || '未知角色'}·${stamp}`;
}

export interface RestoreSavePackExtendedResult {
  restoredVars: string[];
  restoredWorldbookEntries: number;
  boundBookName: string;
}

export interface RestoreWorldbookEntry {
  name: string;
  content: string;
  enabled: boolean;
  comment?: string;
  keys?: string[];
  position?: Record<string, unknown>;
  strategy?: Record<string, unknown>;
  recursion?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

export interface RestoreGatewayLike {
  getChatWorldbookName?(target?: string): string | null;
  getWorldbookNames?(): string[];
  updateWorldbookWith?(
    bookName: string,
    updater: (entries: RestoreWorldbookEntry[]) => RestoreWorldbookEntry[],
  ): Promise<unknown>;
  createWorldbook?(bookName: string, entries: RestoreWorldbookEntry[]): Promise<unknown>;
  rebindChatWorldbook?(target: string, bookName: string): Promise<unknown>;
  getCurrentCharacterName?(): string;
}

/**
 * FD-37 · BUG-SAVE-03：跨聊天导入存档时重锚定 $timeline 账本基线。
 * - 若可读到非空 currentChatId，则覆盖 originChatId = currentChatId；否则置空 originChatId 待新聊天首次锚定；
 * - 若本次恢复绑定了 boundBookName，则覆盖 boundBookName；
 * - 清空高于 #0 楼的所有历史 wbJournal（保留 opLog 与 maxFloorWatermark），
 *   确保新聊天首次触发 ensureBranchWorldbookIsolation({ branchMaxFloor: 0 }) 时绝不会把刚恢复的世界书词条逆向删掉。
 */
export function reanchorTimelineForImportedChat(
  ledger: Record<string, unknown>,
  currentChatId?: string,
  boundBookName?: string,
): Record<string, unknown> {
  const next = JSON.parse(JSON.stringify(ledger)) as Record<string, unknown>;
  const trimmedChatId = typeof currentChatId === 'string' ? currentChatId.trim() : '';
  next.originChatId = trimmedChatId;
  const trimmedBook = typeof boundBookName === 'string' ? boundBookName.trim() : '';
  if (trimmedBook) {
    next.boundBookName = trimmedBook;
  }
  if (next.floors && typeof next.floors === 'object' && !Array.isArray(next.floors)) {
    const floors = next.floors as Record<string, Record<string, unknown>>;
    for (const [floorKey, floorRec] of Object.entries(floors)) {
      if (!floorRec || typeof floorRec !== 'object' || Array.isArray(floorRec)) continue;
      const parsedKeyFloor = floorKey.startsWith('f_') ? Number.parseInt(floorKey.slice(2), 10) : Number.NaN;
      const floorId =
        typeof floorRec.floorId === 'number' && Number.isFinite(floorRec.floorId)
          ? Math.trunc(floorRec.floorId)
          : Number.isFinite(parsedKeyFloor)
            ? parsedKeyFloor
            : 0;
      if (floorId <= 0) continue;
      if (floorRec.swipes && typeof floorRec.swipes === 'object' && !Array.isArray(floorRec.swipes)) {
        const swipes = floorRec.swipes as Record<string, Record<string, unknown>>;
        for (const slot of Object.values(swipes)) {
          if (slot && typeof slot === 'object' && !Array.isArray(slot) && Array.isArray(slot.wbJournal)) {
            slot.wbJournal = [];
          }
        }
      }
    }
  }
  return next;
}

/**
 * SEAM-06 / FD-37：恢复 SavePack V2 扩展状态（`$parse`、`$dlc`、`$timeline` 与聊天绑定档案世界书词条）
 */
export async function restoreSavePackExtendedState(
  pack: SavePack,
  options?: {
    adapter?: HostAdapter;
    gateway?: ChatBookGatewayLike & RestoreGatewayLike;
    currentChatId?: string;
  },
): Promise<RestoreSavePackExtendedResult> {
  const restoredVars: string[] = [];
  const hasParse = pack.parse_state !== undefined;
  const hasDlc = pack.dlc_registry !== undefined;
  const hasTimeline = pack.timeline_ledger !== undefined;

  if (hasParse) restoredVars.push('$parse');
  if (hasDlc) restoredVars.push('$dlc');
  if (hasTimeline) restoredVars.push('$timeline');

  let restoredWorldbookEntries = 0;
  let boundBookName = '';

  if (Array.isArray(pack.chat_worldbook_entries) && pack.chat_worldbook_entries.length > 0) {
    const rawGw = (options?.gateway ?? {}) as ChatBookGatewayLike & RestoreGatewayLike;
    const getChatWbName =
      typeof rawGw.getChatWorldbookName === 'function'
        ? (t?: string) => rawGw.getChatWorldbookName!(t)
        : tav<(t?: string) => string | null>('getChatWorldbookName');
    const getWbNames =
      typeof rawGw.getWorldbookNames === 'function'
        ? () => rawGw.getWorldbookNames!()
        : tav<() => string[]>('getWorldbookNames');
    const updateWbWith =
      typeof rawGw.updateWorldbookWith === 'function'
        ? (b: string, u: (e: RestoreWorldbookEntry[]) => RestoreWorldbookEntry[]) => rawGw.updateWorldbookWith!(b, u)
        : tav<(b: string, u: (e: RestoreWorldbookEntry[]) => RestoreWorldbookEntry[]) => Promise<unknown>>(
            'updateWorldbookWith',
          );
    const createWb =
      typeof rawGw.createWorldbook === 'function'
        ? (b: string, e: RestoreWorldbookEntry[]) => rawGw.createWorldbook!(b, e)
        : tav<(b: string, e: RestoreWorldbookEntry[]) => Promise<unknown>>('createWorldbook');
    const rebindChatWb =
      typeof rawGw.rebindChatWorldbook === 'function'
        ? (t: string, b: string) => rawGw.rebindChatWorldbook!(t, b)
        : tav<(t: string, b: string) => Promise<unknown>>('rebindChatWorldbook');
    const getCharName =
      typeof rawGw.getCurrentCharacterName === 'function'
        ? () => rawGw.getCurrentCharacterName!()
        : () =>
            ((globalThis as { SillyTavern?: { name2?: string } }).SillyTavern?.name2 ?? '').trim() || '未命名角色';

    const isPlainRecord = (v: unknown): v is Record<string, unknown> =>
      typeof v === 'object' && v !== null && !Array.isArray(v);

    const entriesToWrite: RestoreWorldbookEntry[] = pack.chat_worldbook_entries.map(e => ({
      name: e.name,
      content: e.content,
      enabled: e.enabled ?? true,
      ...(typeof e.comment === 'string' && e.comment ? { comment: e.comment } : {}),
      ...(Array.isArray(e.keys) ? { keys: [...e.keys] } : {}),
      ...(isPlainRecord(e.position) ? { position: JSON.parse(JSON.stringify(e.position)) } : {}),
      ...(isPlainRecord(e.strategy) ? { strategy: JSON.parse(JSON.stringify(e.strategy)) } : {}),
      ...(isPlainRecord(e.recursion) ? { recursion: JSON.parse(JSON.stringify(e.recursion)) } : {}),
      ...(isPlainRecord(e.extra) ? { extra: JSON.parse(JSON.stringify(e.extra)) } : {}),
    }));
    try {
      let targetBook = (getChatWbName?.('current') ?? '').trim();
      const allBooks = getWbNames?.() ?? [];
      if (targetBook && allBooks.includes(targetBook) && updateWbWith) {
        await updateWbWith(targetBook, existing => {
          const next = Array.isArray(existing) ? [...existing] : [];
          for (const item of entriesToWrite) {
            const idx = next.findIndex(x => x?.name === item.name);
            if (idx >= 0) {
              next[idx] = { ...next[idx], ...item };
            } else {
              next.push({ ...item });
            }
          }
          return next;
        });
        boundBookName = targetBook;
        restoredWorldbookEntries = entriesToWrite.length;
      } else if (createWb) {
        if (!targetBook) {
          targetBook = makeCanonicalBookName(getCharName(), new Date());
        }
        await createWb(targetBook, entriesToWrite);
        if (rebindChatWb) {
          await rebindChatWb('current', targetBook);
        }
        boundBookName = targetBook;
        restoredWorldbookEntries = entriesToWrite.length;
      }
    } catch {
      /* 非酒馆环境或世界书 API 不可用时安全降级 */
    }
  }

  let effectiveTimeline: Record<string, unknown> | undefined;
  if (hasTimeline && pack.timeline_ledger) {
    let resolvedChatId = (options?.currentChatId ?? '').trim();
    if (!resolvedChatId) {
      try {
        const { readCurrentHostChatId } = await import('../红警指挥系统/core/timelineLedger');
        resolvedChatId = readCurrentHostChatId();
      } catch {
        /* ignore */
      }
    }
    effectiveTimeline = reanchorTimelineForImportedChat(
      pack.timeline_ledger,
      resolvedChatId,
      boundBookName,
    );
    try {
      const { normalizeTimelineLedger, writeTimelineLedger } = await import(
        '../红警指挥系统/core/timelineLedger'
      );
      writeTimelineLedger(() => normalizeTimelineLedger(effectiveTimeline));
    } catch {
      /* ignore in non-host environments */
    }
  }

  if (options?.adapter) {
    const cv = options.adapter.getChatVars();
    if (hasParse) cv['$parse'] = structuredClone(pack.parse_state);
    if (hasDlc) cv['$dlc'] = structuredClone(pack.dlc_registry);
    if (hasTimeline && effectiveTimeline) cv['$timeline'] = structuredClone(effectiveTimeline);
  }

  if (restoredVars.length > 0) {
    const uv = tav<
      (fn: (v: Record<string, unknown>) => Record<string, unknown>, o: { type: string }) => Promise<void> | void
    >('updateVariablesWith');
    const ia = tav<(v: Record<string, unknown>, o: { type: string }) => Promise<void> | void>(
      'insertOrAssignVariables',
    );
    if (uv) {
      try {
        await uv(
          vars => {
            if (hasParse) vars.$parse = structuredClone(pack.parse_state);
            if (hasDlc) vars.$dlc = structuredClone(pack.dlc_registry);
            if (hasTimeline && effectiveTimeline) vars.$timeline = structuredClone(effectiveTimeline);
            return vars;
          },
          { type: 'chat' },
        );
      } catch {
        /* fallback below */
      }
    } else if (ia) {
      try {
        const patch: Record<string, unknown> = {};
        if (hasParse) patch.$parse = structuredClone(pack.parse_state);
        if (hasDlc) patch.$dlc = structuredClone(pack.dlc_registry);
        if (hasTimeline && effectiveTimeline) patch.$timeline = structuredClone(effectiveTimeline);
        await ia(patch, { type: 'chat' });
      } catch {
        /* ignore */
      }
    }
  }

  return {
    restoredVars,
    restoredWorldbookEntries,
    boundBookName,
  };
}

/**
 * 写后核验 + 重试：真机曾观察到发射时序下 #0 楼写入蒸发（六轮受控复现均阴性，
 * 唯一无法复现变量为真实 /trigger 生成）。防御性双保险：
 * 1. 写后立即读回核验，MISS 则重试（最多 3 次，间隔 300ms）；
 * 2. composeAndSend 发送前末位复核，丢失则用 ctx.statData 重写。
 */
async function writeStatDataVerified(ctx: LaunchCtx, attempts = 3): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    await ctx.adapter.setStatData(ctx.statData!);
    if (ctx.adapter.getStatData() !== undefined) return;
    if (i < attempts) await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`#0 楼 stat_data 写入后核验失败（重试 ${attempts} 次）`);
}

export function createLaunchSteps(): LaunchStep[] {
  return [
    {
      name: 'validateWorld',
      label: '核验战区坐标与编制',
      critical: true,
      run: async ctx => {
        const world = getWorldManifest(ctx.choices.worldId);
        if (!world) throw new Error(`world_id「${ctx.choices.worldId || '空'}」未注册`);
        resolveLaunchLocation(ctx.choices);
        if (ctx.choices.importedStat && ctx.choices.importedStat.meta.world_id !== world.world_id) {
          throw new Error(`导入存档属于「${ctx.choices.importedStat.meta.world_id}」，不能以「${world.world_id}」发射`);
        }
      },
    },
    {
      name: 'bindWorldBooks',
      label: '同步战区世界书档案',
      critical: true,
      run: async ctx => {
        await syncWorldbooksForWorld(
          ctx.adapter,
          ctx.choices.worldId,
          resolveSelectedFactions(ctx.choices),
        );
      },
    },
    {
      // persona/stat/$boot 均在排他同步通过后执行，缺书或切换失败时保持零业务副作用
      // persona 的重操作（建档/切换可能触发宿主刷新）先做完，
      // 变量写入靠近发射末端，缩小被冲窗口
      name: 'applyPersona',
      label: '登记最高统帅身份档案',
      critical: false,
      skip: ctx => ctx.choices.personaMode === 'skip',
      run: async ctx => {
        const name = ctx.choices.personaName.trim();
        if (!name) throw new Error('persona 名称为空');
        if (ctx.choices.personaMode === 'create') {
          await ctx.adapter.createPersona(name, ctx.choices.personaDescription);
        }
        await ctx.adapter.switchPersona(name);
        const actual = ctx.adapter.currentPersonaName();
        if (actual !== name) {
          throw new Error(`persona 切换未生效：期望「${name}」，实际「${actual ?? '无'}」`);
        }
      },
    },
    {
      name: 'writeStatData',
      label: '初始化战区后勤与指挥网络',
      critical: true,
      run: async ctx => {
        ctx.statData = buildStatData(ctx.choices);
        await writeStatDataVerified(ctx);
      },
    },
    {
      name: 'markBoot',
      label: '锁定战区部署铭牌',
      critical: true,
      run: async ctx => {
        const prev = readBootFrom(ctx.adapter.getChatVars());
        const next = confirmBoot(prev, {
          preset: ctx.choices.preset,
          choices: snapshotChoices(ctx.choices),
          personaId: ctx.choices.personaMode === 'skip' ? null : ctx.choices.personaName.trim(),
          // G2：导入开局记录来源聊天名（非导入开局为 null）；快照内 choices.importedFrom 同步透传
          importedFrom: ctx.choices.importedFrom.trim() ? ctx.choices.importedFrom.trim() : null,
        });
        await ctx.adapter.setBoot(next);
        const importedPack = ctx.importedPack ?? getSavePackForImportedStat(ctx.choices.importedStat);
        if (importedPack) {
          await restoreSavePackExtendedState(importedPack, { adapter: ctx.adapter });
        }
        // 锁定开局铭牌后立即跨 frame 广播 ra-boot-state-changed，不必等 triggerGeneration 跑完，
        // 使中控悬浮窗在点击发射瞬间即刻解锁并读取 #0 楼的开局资金与已解锁科技。
        try {
          if (typeof window !== 'undefined') {
            const selectedFactions = resolveSelectedFactions(ctx.choices);
            const payload = {
              type: 'ra-boot-state-changed',
              confirmed: true,
              theme: selectedFactions[0] || ctx.choices.factionId || 'allied',
            };
            window.postMessage(payload, '*');
            if (window.parent && window.parent !== window) {
              window.parent.postMessage(payload, '*');
              const frames = window.parent.frames;
              for (let i = 0; i < frames.length; i++) {
                try {
                  frames[i]?.postMessage(payload, '*');
                } catch {
                  /* cross-frame guard */
                }
              }
            }
          }
        } catch {
          /* ignore postMessage errors in non-browser test env */
        }
      },
    },
    {
      name: 'composeAndSend',
      label: '下达首道作战简报并启动推演',
      critical: true,
      run: async ctx => {
        // 末位复核：发送前确认 #0 楼 stat_data 仍在且未被归零洗白，丢失或洗白则重写（双保险第二道）
        if (ctx.statData !== undefined) {
          const currentStat = ctx.adapter.getStatData() as
            | { economy?: { credits?: number }; tech?: { done?: string[] } }
            | undefined;
          const isMissing = currentStat === undefined || currentStat === null;
          const isCreditsWiped =
            !isMissing &&
            ctx.statData.economy.credits > 0 &&
            (currentStat.economy?.credits ?? 0) === 0;
          const isTechWiped =
            !isMissing &&
            ctx.statData.tech.done.length > 0 &&
            (currentStat.tech?.done?.length ?? 0) < ctx.statData.tech.done.length;
          if (isMissing || isCreditsWiped || isTechWiped) {
            await writeStatDataVerified(ctx);
          }
        }
        ctx.message = composeLaunchMessage(ctx.choices);
        await ctx.adapter.sendUserMessage(ctx.message);
        await ctx.adapter.triggerGeneration();
      },
    },
  ];
}
