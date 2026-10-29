/**
 * armoryPanelModel.ts —— 四维「军备管理」模态框纯函数投影模型（ARM-03 · D-05 / UX-12）
 *
 * 维度设计：
 * - 作用域轴（Scope）：'ALL'（战区全局） | 具体基地名（或基地 ID）
 * - 分类轴（Category Tabs）：
 *   1. 机娘（girls）：真实 stat_data.girls / forces.girls + pending_lore 待入档机娘，按驻地 base 过滤，
 *      结合世界书详情缓存（dossierMap）还原机体型号、技能、武装、暴露分档与社会外壳；
 *      真实列表为空时标记 isEmpty: true。
 *   2. 人员（personnel / infantry）：汇总作用域下各基地 forces.infantry（及战区 forces.troops）兵种人数、
 *      各基地分布明细与在训步兵队列。
 *   3. 载具（vehicles & aircraft）：解析 "天启坦克(正常)" / "犀牛坦克(受损)" 等条目，按型号归并统计
 *      总台数、完好数、受损/待修数及所属基地，并汇总空军 aircraft 与在产载具队列。
 *   4. 装备（equipment）：汇总各基地 forces.equipment 制式装备库存、机娘已挂载武装（源自档案 <数据> 块）
 *      及处于「生产 / 改装」中的军备队列。
 *
 * 纯函数铁律：零 IO、零宿主 API、零 Vue/Pinia 响应式副作用，不修改任何入参。
 */
import { isGirlDossierEntry } from '../../红警指挥系统/worldbook/girlFiler';
import {
  baseMatchesScope,
  canonKey,
  classifyProductionQueueItem,
  doesGirlMatchVehicleModel,
  isAllScope,
  normalizeBases,
  normalizeGirlRecord,
  notableCharacterMatchesScope,
  parseVehicleToken,
  rawBaseMatchesScope,
  resolveFocusedGirlProfile,
  type ArmoryBaseMeta,
  type ArmoryCommandOfficer,
  type ArmoryDossierInput,
  type ArmoryEquipmentItem,
  type ArmoryForcesLike,
  type ArmoryGirlItem,
  type ArmoryGirlLike,
  type ArmoryLoadoutEntry,
  type ArmoryNotableCharacter,
  type ArmoryPersonnelRow,
  type ArmoryQueueEntry,
  type ArmoryScope,
  type ArmorySnapshotLike,
  type ArmoryVehicleGroup,
  type ArmoryViewModel,
  type NormalizedBaseRecord,
} from './armoryPanelHelpers';

export * from './armoryPanelHelpers';

/**
 * 构建四维「军备管理」归一化视图模型（全局战区 ALL / 单个基地 × 机娘 / 人员 / 载具 / 装备）
 */
export function buildArmoryViewModel(
  snapshot: ArmorySnapshotLike | null | undefined,
  scope: ArmoryScope = 'ALL',
  dossierMap: Record<string, ArmoryDossierInput> = {},
): ArmoryViewModel {
  const normalizedBases = normalizeBases(snapshot);
  const baseOptions = ['ALL', ...new Set(normalizedBases.map(b => b.name))];
  const basesMeta: ArmoryBaseMeta[] = normalizedBases.map(b => ({
    id: b.id,
    name: b.name,
    location: b.location,
    status: b.status,
    powerGen: b.powerGen,
    powerUse: b.powerUse,
  }));

  const activeBases = isAllScope(scope)
    ? normalizedBases
    : normalizedBases.filter(b => baseMatchesScope(b, scope));

  /* ─────────────── 1. 维度一：机娘（girls） ─────────────── */
  type MergedGirlBucket = {
    girl: ArmoryGirlLike;
    pendingMatch: ArmoryGirlLike | null;
    isPending: boolean;
    serial: string;
  };
  const rawGirlList: MergedGirlBucket[] = [];
  const seenGirls = new Set<string>();
  const byNameMap = new Map<string, MergedGirlBucket>();
  const bySerialMap = new Map<string, MergedGirlBucket>();

  const extractRawSerial = (g: Record<string, unknown>): string =>
    String(g.serial ?? g['编号'] ?? g['出厂编号'] ?? '').trim();

  const extractRenameFrom = (g: Record<string, unknown>): string =>
    String(g.rename_from ?? g['原名'] ?? g['旧名'] ?? '').trim();

  const registerGirlEntry = (girl: ArmoryGirlLike, isPending: boolean) => {
    const name = girl.name.trim();
    const serial = extractRawSerial(girl as Record<string, unknown>);
    const bucket: MergedGirlBucket = { girl, pendingMatch: null, isPending, serial };
    rawGirlList.push(bucket);
    byNameMap.set(name, bucket);
    if (serial && !bySerialMap.has(serial)) {
      bySerialMap.set(serial, bucket);
    }
  };

  for (const g of snapshot?.girls ?? []) {
    if (!g || typeof g.name !== 'string' || !g.name.trim()) continue;
    const name = g.name.trim();
    if (seenGirls.has(name)) continue;
    seenGirls.add(name);
    registerGirlEntry(g, false);
  }
  for (const g of snapshot?.forces?.girls ?? []) {
    if (!g || typeof g.name !== 'string' || !g.name.trim()) continue;
    const name = g.name.trim();
    if (seenGirls.has(name)) continue;
    seenGirls.add(name);
    registerGirlEntry(g, false);
  }
  for (const raw of snapshot?.pending_lore ?? []) {
    if (!isGirlDossierEntry(raw)) continue;
    const pendingGirl = raw as unknown as ArmoryGirlLike;
    const pendingName = pendingGirl.name.trim();
    const pendingSerial = extractRawSerial(pendingGirl as Record<string, unknown>);
    const renameFrom = extractRenameFrom(pendingGirl as Record<string, unknown>);

    // 查找是否与已在 forces.girls / girls 中的机娘属于同一人（同名、同非空 serial 或 rename_from 命中）
    const existingEntry =
      byNameMap.get(pendingName) ??
      (pendingSerial ? bySerialMap.get(pendingSerial) : undefined) ??
      (renameFrom && renameFrom !== '待授名' ? byNameMap.get(renameFrom) : undefined) ??
      rawGirlList.find(entry => {
        const existingName = entry.girl.name.trim();
        if (pendingSerial && existingName.includes(pendingSerial)) return true;
        if (renameFrom === '待授名' && existingName.startsWith('待授名')) return true;
        return false;
      });

    if (existingEntry) {
      existingEntry.pendingMatch = pendingGirl;
      if (pendingName && !pendingName.includes('待授名') && !pendingName.includes('未授名')) {
        seenGirls.add(pendingName);
      }
      continue;
    }

    if (seenGirls.has(pendingName)) continue;
    seenGirls.add(pendingName);
    registerGirlEntry(pendingGirl, true);
  }

  const totalGirlsInTheater = rawGirlList.length;

  // 先执行轻量 normalizeGirlRecord 并按当前基地 scope 过滤，再仅对匹配 scope 的机娘执行昂贵的档案解析
  const scopedGirls: ArmoryGirlItem[] = [];
  const scopedGirlSources: Array<{
    item: ArmoryGirlItem;
    raw: ArmoryGirlLike;
    pendingMatch: ArmoryGirlLike | null;
  }> = [];
  for (const { girl, pendingMatch, isPending } of rawGirlList) {
    const baseRecord = normalizeGirlRecord(girl, isPending);
    if (!rawBaseMatchesScope(baseRecord.rawBase, scope, normalizedBases, true)) {
      continue;
    }
    const pendingName = pendingMatch?.name?.trim() || '';
    const dossier =
      (pendingName ? dossierMap[pendingName] : undefined) ??
      dossierMap[baseRecord.name] ??
      (baseRecord.serial ? dossierMap[baseRecord.serial] : undefined) ??
      null;
    const resolvedGirl = resolveFocusedGirlProfile(baseRecord, dossier, pendingMatch);
    scopedGirls.push(resolvedGirl);
    scopedGirlSources.push({ item: resolvedGirl, raw: girl, pendingMatch });
  }
  const girlsIsEmpty = scopedGirls.length === 0;

  /* ─────────────── 2. 维度二：人员（personnel / infantry · 差额守恒） ─────────────── */
  const personnelMap = new Map<string, { total: number; byBase: Map<string, number> }>();
  const addPersonnel = (unitType: string, count: number, baseLabel: string) => {
    const cleanUnit = unitType.trim();
    const n = Number(count);
    if (!cleanUnit || !Number.isFinite(n) || n <= 0) return;
    let entry = personnelMap.get(cleanUnit);
    if (!entry) {
      entry = { total: 0, byBase: new Map() };
      personnelMap.set(cleanUnit, entry);
    }
    entry.total += n;
    entry.byBase.set(baseLabel, (entry.byBase.get(baseLabel) ?? 0) + n);
  };

  // 1) 先遍历全部基地，统计各兵种在分基地的已分配驻军总数，并将匹配当前 scope 的基地驻军录入
  const allocatedPersonnelByUnit = new Map<string, number>();
  for (const b of normalizedBases) {
    const inf = b.forces?.infantry ?? b.forces?.troops;
    if (!inf || typeof inf !== 'object') continue;
    for (const [unit, count] of Object.entries(inf)) {
      const cleanUnit = unit.trim();
      const n = Number(count);
      if (!cleanUnit || !Number.isFinite(n) || n <= 0) continue;
      const uKey = canonKey(cleanUnit);
      allocatedPersonnelByUnit.set(uKey, (allocatedPersonnelByUnit.get(uKey) ?? 0) + n);
      if (baseMatchesScope(b, scope)) {
        addPersonnel(cleanUnit, n, b.name);
      }
    }
  }

  // 2) 再遍历战区全局 forces.infantry / forces.troops，按「全局总账 = 各基地驻军 + 战区机动直属」核算未分配余量
  const globalTroops = snapshot?.forces?.infantry ?? snapshot?.forces?.troops ?? {};
  const remainingAllocatedPersonnel = new Map(allocatedPersonnelByUnit);
  let unassignedPersonnelCount = 0;
  for (const [unit, count] of Object.entries(globalTroops)) {
    const cleanUnit = unit.trim();
    const globalCount = Number(count);
    if (!cleanUnit || !Number.isFinite(globalCount) || globalCount <= 0) continue;
    const uKey = canonKey(cleanUnit);
    const alloc = remainingAllocatedPersonnel.get(uKey) ?? 0;
    const usedAlloc = Math.min(globalCount, alloc);
    remainingAllocatedPersonnel.set(uKey, alloc - usedAlloc);
    const unassigned = Math.max(0, globalCount - usedAlloc);
    if (unassigned > 0) {
      unassignedPersonnelCount += unassigned;
      if (isAllScope(scope)) {
        addPersonnel(cleanUnit, unassigned, '战区机动直属');
      }
    }
  }

  const personnelRows: ArmoryPersonnelRow[] = [...personnelMap.entries()].map(([unitType, info]) => ({
    unitType,
    total: info.total,
    byBase: [...info.byBase.entries()].map(([base, count]) => ({ base, count })),
  }));
  const personnelTotalCount = personnelRows.reduce((sum, r) => sum + r.total, 0);

  // 提取战区指挥部在编军官与随行核心人员（合并 command.adjutants 人类副官与 codex 人员档案）
  const officers: ArmoryCommandOfficer[] = [];
  const officerMap = new Map<string, ArmoryCommandOfficer>();
  const notableCharacters: ArmoryNotableCharacter[] = [];
  const notableMap = new Map<string, ArmoryNotableCharacter>();

  for (const adj of snapshot?.command?.adjutants ?? []) {
    if (!adj || typeof adj.name !== 'string' || !adj.name.trim()) continue;
    if (adj.identity && adj.identity !== 'human') continue;
    const oName = adj.name.trim();
    const rawAdjBase = String(adj.base ?? '').trim();
    const roleLabel =
      adj.role === 'staff' ? '联席参谋部专职参谋' : `${adj.faction || '战区'}主责副官`;

    if (notableCharacterMatchesScope(rawAdjBase || adj.status, scope, normalizedBases, !rawAdjBase)) {
      const item: ArmoryCommandOfficer = {
        name: oName,
        callsign: String(adj.callsign ?? '').trim(),
        title: adj.title || roleLabel,
        faction: adj.faction || '统帅部直属',
        origin: '统帅部在编',
        roleLabel,
        appearance: '',
        personality: '',
        desc: adj.note || '',
        dailyUpkeep: Number(adj.daily_upkeep ?? 80),
      };
      officers.push(item);
      officerMap.set(oName, item);

      const notableItem: ArmoryNotableCharacter = {
        name: oName,
        roleOrIdentity: adj.title || roleLabel,
        faction: adj.faction || '统帅部直属',
        attitude: String(adj.attitude || '效忠').trim(),
        trust: String(adj.trust ?? '核心幕僚').trim(),
        statusOrBase: rawAdjBase || String(adj.status || '战区指挥部').trim(),
        desc: adj.note || '',
        callsign: String(adj.callsign ?? '').trim(),
        source: 'adjutant',
      };
      notableCharacters.push(notableItem);
      notableMap.set(oName, notableItem);
    }
  }
  for (const c of snapshot?.codex ?? []) {
    if (!c || typeof c.name !== 'string' || !c.name.trim()) continue;
    const oName = c.name.trim();
    const params = c.params ?? {};

    if (c.kind === '人员') {
      const existing = officerMap.get(oName);
      if (existing) {
        existing.callsign = params['代号'] || existing.callsign;
        existing.title = params['开局职务'] || existing.title;
        existing.faction = params['阵营归属'] || existing.faction;
        existing.origin = params['随行渊源'] || existing.origin;
        existing.roleLabel = params['席位任命'] || existing.roleLabel;
        existing.appearance = params['外貌着装'] || existing.appearance;
        existing.personality = params['性格与口吻'] || existing.personality;
        existing.desc = params['履历与绝活'] || c.desc || existing.desc;
      } else {
        const rawStaffBase = params['驻地'] || params['基地'] || '';
        if (notableCharacterMatchesScope(rawStaffBase, scope, normalizedBases, !rawStaffBase)) {
          const item: ArmoryCommandOfficer = {
            name: oName,
            callsign: params['代号'] || '',
            title: params['开局职务'] || '随行军官',
            faction: params['阵营归属'] || '统帅部直属',
            origin: params['随行渊源'] || '随行核心人员',
            roleLabel: params['席位任命'] || '己方随行核心人员',
            appearance: params['外貌着装'] || '',
            personality: params['性格与口吻'] || '',
            desc: params['履历与绝活'] || c.desc || '',
            dailyUpkeep: 0,
          };
          officers.push(item);
          officerMap.set(oName, item);
        }
      }

      const existingNotable = notableMap.get(oName);
      if (existingNotable) {
        existingNotable.callsign = params['代号'] || existingNotable.callsign;
        existingNotable.roleOrIdentity = params['开局职务'] || params['席位任命'] || existingNotable.roleOrIdentity;
        existingNotable.faction = params['阵营归属'] || existingNotable.faction;
        existingNotable.desc = params['履历与绝活'] || c.desc || existingNotable.desc;
      }
      continue;
    }

    if (c.kind === '人物') {
      const rawLoc =
        params['驻地'] ||
        params['基地'] ||
        params['所在地'] ||
        params['状态'] ||
        '';
      if (!notableCharacterMatchesScope(rawLoc, scope, normalizedBases, false)) {
        continue;
      }
      const roleOrIdentity = (
        params['身份'] ||
        params['职务'] ||
        params['开局职务'] ||
        params['定位'] ||
        '重要人物'
      ).trim();
      const faction = (
        params['所属势力'] ||
        params['阵营归属'] ||
        params['势力'] ||
        params['阵营'] ||
        '中立/地方'
      ).trim();
      const attitude = (params['态度'] || params['立场'] || '中立').trim();
      const trust = (params['信任度'] || params['好感'] || params['关系'] || '—').trim();
      const statusOrBase = (rawLoc || '活动于战区').trim();
      const desc = (
        c.desc ||
        params['近期交集'] ||
        params['背景'] ||
        params['能力'] ||
        params['履历与绝活'] ||
        ''
      ).trim();
      const callsign = (params['代号'] || '').trim();

      const existingNotable = notableMap.get(oName);
      if (existingNotable) {
        existingNotable.roleOrIdentity = roleOrIdentity || existingNotable.roleOrIdentity;
        existingNotable.faction = faction || existingNotable.faction;
        existingNotable.attitude = attitude || existingNotable.attitude;
        existingNotable.trust = trust !== '—' ? trust : existingNotable.trust;
        existingNotable.statusOrBase = rawLoc ? statusOrBase : existingNotable.statusOrBase;
        existingNotable.desc = desc || existingNotable.desc;
        existingNotable.callsign = callsign || existingNotable.callsign;
      } else {
        const npcItem: ArmoryNotableCharacter = {
          name: oName,
          roleOrIdentity,
          faction,
          attitude,
          trust,
          statusOrBase,
          desc,
          callsign,
          source: 'npc',
        };
        notableCharacters.push(npcItem);
        notableMap.set(oName, npcItem);
      }
    }
  }

  /* ─────────────── 3. 维度三：载具与空军（vehicles & aircraft · 差额守恒） ─────────────── */
  const vehicleGroupMap = new Map<
    string,
    {
      model: string;
      category: 'vehicle' | 'aircraft';
      total: number;
      intact: number;
      damaged: number;
      byBase: Map<string, { count: number; intact: number; damaged: number }>;
      rawStatuses: Set<string>;
    }
  >();

  const extractParsedVehicles = (col: ArmoryForcesLike['vehicles']) => {
    const out: Array<{
      model: string;
      count: number;
      intact: number;
      damaged: number;
      statusLabel: string;
    }> = [];
    if (!col) return out;
    if (Array.isArray(col)) {
      for (const item of col) {
        const parsed = parseVehicleToken(item);
        if (parsed) out.push(parsed);
      }
    } else if (typeof col === 'object') {
      for (const [model, count] of Object.entries(col as Record<string, number>)) {
        const n = Number(count);
        if (Number.isFinite(n) && n > 0) {
          const parsed = parseVehicleToken({ model, count: n, status: '正常' });
          if (parsed) out.push(parsed);
        }
      }
    }
    return out;
  };

  const recordVehicleToGroup = (
    model: string,
    category: 'vehicle' | 'aircraft',
    count: number,
    intact: number,
    damaged: number,
    statuses: Iterable<string>,
    baseLabel: string,
  ) => {
    if (count <= 0) return;
    const key = `${category}::${canonKey(model)}`;
    let group = vehicleGroupMap.get(key);
    if (!group) {
      group = {
        model,
        category,
        total: 0,
        intact: 0,
        damaged: 0,
        byBase: new Map(),
        rawStatuses: new Set(),
      };
      vehicleGroupMap.set(key, group);
    }
    group.total += count;
    group.intact += intact;
    group.damaged += damaged;
    for (const st of statuses) {
      if (st) group.rawStatuses.add(st);
    }

    const baseStat = group.byBase.get(baseLabel) ?? { count: 0, intact: 0, damaged: 0 };
    baseStat.count += count;
    baseStat.intact += intact;
    baseStat.damaged += damaged;
    group.byBase.set(baseLabel, baseStat);
  };

  type VehicleAllocBucket = {
    model: string;
    category: 'vehicle' | 'aircraft';
    count: number;
    intact: number;
    damaged: number;
    rawStatuses: Set<string>;
  };
  const allocatedVehiclesMap = new Map<string, VehicleAllocBucket>();

  const ingestVehicleCollection = (
    col: ArmoryForcesLike['vehicles'],
    category: 'vehicle' | 'aircraft',
    base: NormalizedBaseRecord,
  ) => {
    for (const parsed of extractParsedVehicles(col)) {
      const key = `${category}::${canonKey(parsed.model)}`;
      let alloc = allocatedVehiclesMap.get(key);
      if (!alloc) {
        alloc = {
          model: parsed.model,
          category,
          count: 0,
          intact: 0,
          damaged: 0,
          rawStatuses: new Set(),
        };
        allocatedVehiclesMap.set(key, alloc);
      }
      alloc.count += parsed.count;
      alloc.intact += parsed.intact;
      alloc.damaged += parsed.damaged;
      alloc.rawStatuses.add(parsed.statusLabel);

      if (baseMatchesScope(base, scope)) {
        recordVehicleToGroup(
          parsed.model,
          category,
          parsed.count,
          parsed.intact,
          parsed.damaged,
          [parsed.statusLabel],
          base.name,
        );
      }
    }
  };

  // 1) 先遍历所有基地，统计各型号已分配的驻防数量，并对匹配当前 scope 的基地录入
  for (const b of normalizedBases) {
    ingestVehicleCollection(b.forces?.vehicles, 'vehicle', b);
    ingestVehicleCollection(b.forces?.aircraft, 'aircraft', b);
  }

  // 2) 再统计全局 snapshot.forces.vehicles / aircraft 超出各基地已分配之和的未分配余量
  const globalVehiclesMap = new Map<string, VehicleAllocBucket>();
  const collectGlobalVehicles = (
    col: ArmoryForcesLike['vehicles'],
    category: 'vehicle' | 'aircraft',
  ) => {
    for (const parsed of extractParsedVehicles(col)) {
      const key = `${category}::${canonKey(parsed.model)}`;
      let gBucket = globalVehiclesMap.get(key);
      if (!gBucket) {
        gBucket = {
          model: parsed.model,
          category,
          count: 0,
          intact: 0,
          damaged: 0,
          rawStatuses: new Set(),
        };
        globalVehiclesMap.set(key, gBucket);
      }
      gBucket.count += parsed.count;
      gBucket.intact += parsed.intact;
      gBucket.damaged += parsed.damaged;
      gBucket.rawStatuses.add(parsed.statusLabel);
    }
  };

  collectGlobalVehicles(snapshot?.forces?.vehicles, 'vehicle');
  collectGlobalVehicles(snapshot?.forces?.aircraft, 'aircraft');

  let unassignedVehicleCount = 0;
  for (const [key, gBucket] of globalVehiclesMap.entries()) {
    const alloc = allocatedVehiclesMap.get(key);
    const allocCount = alloc?.count ?? 0;
    const allocDamaged = alloc?.damaged ?? 0;
    const unassignedCount = Math.max(0, gBucket.count - allocCount);
    if (unassignedCount <= 0) continue;

    const unassignedDamaged = Math.min(
      unassignedCount,
      Math.max(0, gBucket.damaged - allocDamaged),
    );
    const unassignedIntact = unassignedCount - unassignedDamaged;
    unassignedVehicleCount += unassignedCount;

    if (isAllScope(scope)) {
      const statuses: string[] = [];
      if (unassignedIntact > 0) statuses.push('正常');
      if (unassignedDamaged > 0) {
        const dmgStatus = [...gBucket.rawStatuses].find(s => s !== '正常') ?? '受损';
        statuses.push(dmgStatus);
      }
      recordVehicleToGroup(
        gBucket.model,
        gBucket.category,
        unassignedCount,
        unassignedIntact,
        unassignedDamaged,
        statuses.length > 0 ? statuses : gBucket.rawStatuses,
        '战区机动直属',
      );
    }
  }

  const allVehicleGroups: ArmoryVehicleGroup[] = [...vehicleGroupMap.values()].map(g => {
    const assignedGirls: string[] = [];
    for (const gs of scopedGirlSources) {
      if (
        doesGirlMatchVehicleModel(gs.item, gs.raw, g.model) ||
        (gs.pendingMatch && doesGirlMatchVehicleModel(gs.item, gs.pendingMatch, g.model))
      ) {
        if (!assignedGirls.includes(gs.item.name)) {
          assignedGirls.push(gs.item.name);
        }
      }
    }
    return {
      model: g.model,
      category: g.category,
      total: g.total,
      intact: g.intact,
      damaged: g.damaged,
      byBase: [...g.byBase.entries()].map(([base, stat]) => ({ base, ...stat })),
      rawStatuses: [...g.rawStatuses],
      assignedGirls,
    };
  });

  const vehicleGroups = allVehicleGroups.filter(g => g.category === 'vehicle');
  const aircraftGroups = allVehicleGroups.filter(g => g.category === 'aircraft');
  const totalVehicles = vehicleGroups.reduce((s, g) => s + g.total, 0);
  const totalAircraft = aircraftGroups.reduce((s, g) => s + g.total, 0);
  const totalVehiclesAndAircraft = totalVehicles + totalAircraft;
  const intactCount = allVehicleGroups.reduce((s, g) => s + g.intact, 0);
  const damagedCount = allVehicleGroups.reduce((s, g) => s + g.damaged, 0);

  /* ─────────────── 4. 维度四：装备（equipment & loadouts） ─────────────── */
  const equipmentMap = new Map<
    string,
    { count: number; source: ArmoryEquipmentItem['source']; byBase: Map<string, number> }
  >();
  const addEquipment = (
    name: string,
    count: number,
    baseLabel: string,
    source: ArmoryEquipmentItem['source'] = 'inventory',
  ) => {
    const clean = name.trim();
    const n = Number(count);
    if (!clean || !Number.isFinite(n) || n <= 0) return;
    let entry = equipmentMap.get(clean);
    if (!entry) {
      entry = { count: 0, source, byBase: new Map() };
      equipmentMap.set(clean, entry);
    }
    entry.count += n;
    entry.byBase.set(baseLabel, (entry.byBase.get(baseLabel) ?? 0) + n);
  };

  const allocatedEquipmentByKey = new Map<string, number>();
  for (const b of normalizedBases) {
    const eq = b.forces?.equipment;
    if (!eq || typeof eq !== 'object') continue;
    for (const [eqName, count] of Object.entries(eq)) {
      const clean = eqName.trim();
      const n = Number(count);
      if (!clean || !Number.isFinite(n) || n <= 0) continue;
      const eKey = canonKey(clean);
      allocatedEquipmentByKey.set(eKey, (allocatedEquipmentByKey.get(eKey) ?? 0) + n);
      if (baseMatchesScope(b, scope)) {
        addEquipment(clean, n, b.name, 'inventory');
      }
    }
  }

  if (snapshot?.forces?.equipment) {
    const remainingAllocEq = new Map(allocatedEquipmentByKey);
    for (const [eqName, count] of Object.entries(snapshot.forces.equipment)) {
      const clean = eqName.trim();
      const globalCount = Number(count);
      if (!clean || !Number.isFinite(globalCount) || globalCount <= 0) continue;
      const eKey = canonKey(clean);
      const alloc = remainingAllocEq.get(eKey) ?? 0;
      const usedAlloc = Math.min(globalCount, alloc);
      remainingAllocEq.set(eKey, alloc - usedAlloc);
      const unassigned = Math.max(0, globalCount - usedAlloc);
      if (isAllScope(scope) && unassigned > 0) {
        addEquipment(clean, unassigned, '战区机动直属', 'inventory');
      }
    }
  }

  // 战区弹药与修复凝胶库存（全局或无单基地装备时补充展示）
  if (isAllScope(scope)) {
    const munitions = snapshot?.economy?.resources?.munitions ?? {};
    for (const [mName, mVal] of Object.entries(munitions)) {
      if (typeof mVal === 'number' && mVal > 0 && !equipmentMap.has(mName)) {
        addEquipment(mName, mVal, '战区弹药库', 'munitions');
      }
    }
    const gel = snapshot?.economy?.resources?.nanites?.['机娘修复凝胶'];
    if (typeof gel === 'number' && gel > 0 && !equipmentMap.has('机娘修复凝胶')) {
      addEquipment('机娘修复凝胶', gel, '战区卫勤库', 'munitions');
    }
  }

  const girlLoadouts: ArmoryLoadoutEntry[] = [];
  for (const g of scopedGirls) {
    for (const item of g.loadouts) {
      girlLoadouts.push({
        girl: g.name,
        base: g.base,
        item,
      });
    }
  }

  const equipmentItems: ArmoryEquipmentItem[] = [...equipmentMap.entries()].map(([name, info]) => ({
    name,
    count: info.count,
    source: info.source,
    byBase: [...info.byBase.entries()].map(([base, count]) => ({ base, count })),
  }));
  const inventoryItems = equipmentItems.filter(i => i.source === 'inventory');
  const equipmentTotalCount =
    equipmentItems.reduce((s, i) => s + i.count, 0) + girlLoadouts.length;

  const ammoStatus: Array<{ name: string; status: string }> = Object.entries(snapshot?.forces?.ammo ?? {}).map(
    ([name, status]) => ({ name, status: String(status) }),
  );

  /* ─────────────── 5. 队列归类（在训步兵 / 在产载具 / 生产与改装军备） ─────────────── */
  const trainingQueues: ArmoryQueueEntry[] = [];
  const vehicleQueues: ArmoryQueueEntry[] = [];
  const equipmentQueues: ArmoryQueueEntry[] = [];

  for (const q of snapshot?.queues ?? []) {
    if (!q || typeof q.item !== 'string' || !q.item.trim()) continue;
    if (q.status === 'done' || q.status === 'cancelled') continue;
    if (q.type !== '生产' && q.type !== '改装') continue;
    if (!rawBaseMatchesScope(q.base, scope, normalizedBases, true)) continue;

    const entry: ArmoryQueueEntry = {
      type: q.type,
      item: q.item.trim(),
      base: String(q.base || (activeBases[0]?.name ?? '战区总装线')).trim(),
      progress: Number(q.progress ?? 0),
      eta: String(q.eta ?? ''),
      status: String(q.status ?? 'active'),
      qty: Math.max(1, Number(q.qty ?? 1) || 1),
    };

    const cat = classifyProductionQueueItem(q);
    if (cat === 'personnel') {
      trainingQueues.push(entry);
    } else if (cat === 'vehicles') {
      vehicleQueues.push(entry);
    } else {
      equipmentQueues.push(entry);
    }
  }

  return {
    scope,
    baseOptions,
    basesMeta,
    unassignedPersonnelCount,
    unassignedVehicleCount,
    notableCharacters,
    summary: {
      girlsCount: scopedGirls.length,
      personnelCount: personnelTotalCount + officers.length,
      vehiclesCount: totalVehicles,
      aircraftCount: totalAircraft,
      vehiclesAndAircraftCount: totalVehiclesAndAircraft,
      equipmentCount: equipmentTotalCount,
      unassignedPersonnelCount,
      unassignedVehicleCount,
    },
    girls: {
      items: scopedGirls,
      isEmpty: girlsIsEmpty,
      totalInTheater: totalGirlsInTheater,
    },
    personnel: {
      rows: personnelRows,
      officers,
      notableCharacters,
      totalCount: personnelTotalCount,
      unassignedCount: unassignedPersonnelCount,
      unassignedPersonnelCount,
      commandCap: String(snapshot?.forces?.command_cap ?? ''),
      trainingQueues,
      isEmpty:
        personnelRows.length === 0 &&
        trainingQueues.length === 0 &&
        officers.length === 0 &&
        notableCharacters.length === 0,
    },
    vehicles: {
      groups: allVehicleGroups,
      vehicleGroups,
      aircraftGroups,
      totalVehicles,
      totalAircraft,
      totalCount: totalVehiclesAndAircraft,
      unassignedCount: unassignedVehicleCount,
      unassignedVehicleCount,
      intactCount,
      damagedCount,
      productionQueues: vehicleQueues,
      isEmpty: allVehicleGroups.length === 0 && vehicleQueues.length === 0,
    },
    equipment: {
      items: equipmentItems,
      inventoryItems,
      girlLoadouts,
      ammoStatus,
      activeQueues: equipmentQueues,
      totalCount: equipmentTotalCount,
      isEmpty:
        equipmentItems.length === 0 &&
        girlLoadouts.length === 0 &&
        equipmentQueues.length === 0 &&
        ammoStatus.length === 0,
    },
  };
}

export const buildArmoryMasterView = buildArmoryViewModel;

