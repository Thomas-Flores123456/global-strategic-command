/**
 * armoryPanelHelpers.ts —— 军备管理面板类型定义、作用域过滤、机娘档案/载具/队列归一化辅助
 */
import {
  parseGirlDossierData,
  stripDossierMachineBlocks,
  type GirlDossierDetailResult,
  type GirlSpecialEquipment,
  type GirlSpecialSkill,
} from './archiveIndex';

export type { GirlSpecialEquipment, GirlSpecialSkill };

export type ArmoryTabId = 'girls' | 'personnel' | 'vehicles' | 'equipment';
export type ArmoryScope = 'ALL' | string;

export interface ArmoryGirlLike {
  name: string;
  model?: string;
  hp?: string;
  status?: string;
  duty?: string;
  base?: string;
  affection?: number;
  obedience?: number;
  traits?: string[];
  tags?: string[];
  keys?: string[];
  weapons?: string;
  skills?: string;
  exposure?: string;
  shell?: string;
  alias?: string;
  form_mech?: string;
  flaws?: string;
  personality?: string;
  serial?: string;
  callsign?: string;
  seq?: string;
  faction?: string;
  body?: string;
  unchristened?: boolean;
  rename_from?: string;
  编号?: string;
  出厂编号?: string;
  代号?: string;
  战术代号?: string;
  序列?: string;
  机体序列?: string;
  阵营?: string;
  躯体特征?: string;
  身子?: string;
  体态特征?: string;
  [key: string]: unknown;
}

export interface ArmoryForcesLike {
  girls?: ArmoryGirlLike[];
  infantry?: Record<string, number>;
  troops?: Record<string, number>;
  vehicles?: ReadonlyArray<string | Record<string, unknown>> | Record<string, number>;
  aircraft?: ReadonlyArray<string | Record<string, unknown>> | Record<string, number>;
  equipment?: Record<string, number>;
  ammo?: Record<string, string>;
  command_cap?: string;
}

export interface ArmoryBaseLike {
  id?: string;
  name?: string;
  location?: string;
  status?: string;
  power?: { gen?: number; use?: number };
  buildings?: ReadonlyArray<{ name: string; state?: string }>;
  forces?: ArmoryForcesLike;
}

export interface ArmoryQueueLike {
  type: string;
  item: string;
  base?: string;
  progress?: number;
  eta?: string;
  status?: string;
  qty?: number;
  qty_done?: number;
  lane?: string;
}

export interface ArmoryPendingTransferLike {
  id?: string;
  unit: string;
  category?: 'girls' | 'troops' | 'vehicles' | 'equipment' | string;
  qty?: number;
  from_base?: string;
  to_base?: string;
  total_minutes?: number;
  remaining_minutes?: number;
  method?: string;
  reason?: string;
  started_at?: string;
}

export interface ArmoryTransferItem {
  id: string;
  unit: string;
  category: 'girls' | 'troops' | 'vehicles' | 'equipment';
  qty: number;
  fromBase: string;
  toBase: string;
  totalMinutes: number;
  remainingMinutes: number;
  progress: number;
  etaText: string;
  method: string;
  reason: string;
  startedAt: string;
}

export interface ArmorySnapshotLike {
  girls?: ArmoryGirlLike[];
  forces?: ArmoryForcesLike;
  bases?: ReadonlyArray<ArmoryBaseLike> | Record<string, ArmoryBaseLike>;
  queues?: ReadonlyArray<ArmoryQueueLike>;
  pending_transfers?: ReadonlyArray<ArmoryPendingTransferLike>;
  pending_lore?: ReadonlyArray<unknown>;
  codex?: ReadonlyArray<{
    name: string;
    kind: string;
    desc?: string;
    params?: Record<string, string>;
  }>;
  command?: {
    adjutants?: ReadonlyArray<{
      id?: string;
      name: string;
      role?: string;
      faction?: string;
      identity?: string;
      title?: string;
      buff_preset?: string;
      daily_upkeep?: number;
      note?: string;
      base?: string;
      status?: string;
      attitude?: string;
      trust?: string | number;
      callsign?: string;
    }>;
  };
  economy?: {
    resources?: {
      nanites?: Record<string, number | null>;
      munitions?: Record<string, number | null>;
    };
  };
}

export type ArmoryDossierInput = Partial<GirlDossierDetailResult> & {
  content?: string;
  data?: Record<string, string>;
};

export interface ArmoryGirlItem {
  name: string;
  model: string;
  affection: number | null;
  obedience: number | null;
  status: string;
  hp: string;
  duty: string;
  base: string;
  rawBase: string;
  traits: string[];
  weapons: string;
  skills: string;
  exposure: string;
  shell: string;
  alias: string;
  form_mech: string;
  flaws: string;
  personality: string;
  appearance: string;
  dossierContent: string;
  storyContent: string;
  cleanDossierContent: string;
  cleanStoryContent: string;
  loadouts: string[];
  isPending: boolean;
  dossier: ArmoryDossierInput | null;
  serial: string;
  callsign: string;
  seq: string;
  faction: string;
  body: string;
  unchristened: boolean;
  specialSkills: GirlSpecialSkill[];
  specialEquipment: GirlSpecialEquipment[];
  temperamentSpectrum: string;
  activeTransfer?: ArmoryTransferItem | null;
}

export type ArmoryGirlRecord = ArmoryGirlItem;

export interface ArmoryCommandOfficer {
  name: string;
  callsign: string;
  title: string;
  faction: string;
  origin: string;
  roleLabel: string;
  appearance: string;
  personality: string;
  desc: string;
  dailyUpkeep: number;
}

export interface ArmoryNotableCharacter {
  name: string;
  roleOrIdentity: string;
  faction: string;
  attitude: string;
  trust: string;
  statusOrBase: string;
  desc: string;
  callsign?: string;
  source?: 'adjutant' | 'npc';
}

export interface ArmoryPersonnelRow {
  unitType: string;
  total: number;
  byBase: Array<{ base: string; count: number }>;
}

export interface ArmoryVehicleGroup {
  model: string;
  category: 'vehicle' | 'aircraft';
  total: number;
  intact: number;
  damaged: number;
  byBase: Array<{ base: string; count: number; intact: number; damaged: number }>;
  rawStatuses: string[];
  assignedGirls?: string[];
}

export interface ArmoryEquipmentItem {
  name: string;
  count: number;
  source: 'inventory' | 'munitions' | 'loadout';
  byBase: Array<{ base: string; count: number }>;
}

export interface ArmoryLoadoutEntry {
  girl: string;
  base: string;
  item: string;
}

export interface ArmoryQueueEntry {
  type: string;
  item: string;
  base: string;
  progress: number;
  eta: string;
  status: string;
  qty: number;
}

export interface ArmoryBaseMeta {
  id: string;
  name: string;
  location: string;
  status: string;
  powerGen: number;
  powerUse: number;
}

export interface ArmoryViewModel {
  scope: ArmoryScope;
  baseOptions: string[];
  basesMeta: ArmoryBaseMeta[];
  unassignedPersonnelCount: number;
  unassignedVehicleCount: number;
  notableCharacters: ArmoryNotableCharacter[];
  pendingTransfers: ArmoryTransferItem[];
  summary: {
    girlsCount: number;
    personnelCount: number;
    vehiclesCount: number;
    aircraftCount: number;
    vehiclesAndAircraftCount: number;
    equipmentCount: number;
    unassignedPersonnelCount: number;
    unassignedVehicleCount: number;
    pendingTransfersCount?: number;
  };
  girls: {
    items: ArmoryGirlItem[];
    isEmpty: boolean;
    totalInTheater: number;
    pendingTransfers?: ArmoryTransferItem[];
  };
  personnel: {
    rows: ArmoryPersonnelRow[];
    officers: ArmoryCommandOfficer[];
    notableCharacters: ArmoryNotableCharacter[];
    totalCount: number;
    unassignedCount: number;
    unassignedPersonnelCount: number;
    commandCap: string;
    trainingQueues: ArmoryQueueEntry[];
    pendingTransfers?: ArmoryTransferItem[];
    isEmpty: boolean;
  };
  vehicles: {
    groups: ArmoryVehicleGroup[];
    vehicleGroups: ArmoryVehicleGroup[];
    aircraftGroups: ArmoryVehicleGroup[];
    totalVehicles: number;
    totalAircraft: number;
    totalCount: number;
    unassignedCount: number;
    unassignedVehicleCount: number;
    intactCount: number;
    damagedCount: number;
    productionQueues: ArmoryQueueEntry[];
    pendingTransfers?: ArmoryTransferItem[];
    isEmpty: boolean;
  };
  equipment: {
    items: ArmoryEquipmentItem[];
    inventoryItems: ArmoryEquipmentItem[];
    girlLoadouts: ArmoryLoadoutEntry[];
    ammoStatus: Array<{ name: string; status: string }>;
    activeQueues: ArmoryQueueEntry[];
    pendingTransfers?: ArmoryTransferItem[];
    totalCount: number;
    isEmpty: boolean;
  };
}

export type ArmoryPanelViewModel = ArmoryViewModel;

export interface NormalizedBaseRecord {
  id: string;
  name: string;
  location: string;
  status: string;
  powerGen: number;
  powerUse: number;
  forces: ArmoryForcesLike;
}

export function canonKey(s: string | undefined | null): string {
  return String(s ?? '').trim().toLowerCase();
}

export function isAllScope(scope: string | undefined | null): boolean {
  const c = canonKey(scope);
  return !c || c === 'all' || c === '全局' || c === '战区全局';
}

export function normalizeBases(snapshot: ArmorySnapshotLike | null | undefined): NormalizedBaseRecord[] {
  if (!snapshot?.bases) return [];
  const out: NormalizedBaseRecord[] = [];
  if (Array.isArray(snapshot.bases)) {
    for (const b of snapshot.bases) {
      if (!b || typeof b !== 'object') continue;
      const name = String(b.name || b.id || '').trim();
      const id = String(b.id || b.name || '').trim();
      if (!name && !id) continue;
      out.push({
        id: id || name,
        name: name || id,
        location: typeof b.location === 'string' ? b.location : '',
        status: typeof b.status === 'string' ? b.status : '运转',
        powerGen: Number(b.power?.gen ?? 0),
        powerUse: Number(b.power?.use ?? 0),
        forces: (b.forces ?? {}) as ArmoryForcesLike,
      });
    }
    return out;
  }
  if (typeof snapshot.bases === 'object') {
    for (const [key, raw] of Object.entries(snapshot.bases as Record<string, ArmoryBaseLike>)) {
      if (!raw || typeof raw !== 'object') continue;
      const name = String(raw.name || key).trim();
      const id = String(raw.id || key).trim();
      if (!name) continue;
      out.push({
        id,
        name,
        location: typeof raw.location === 'string' ? raw.location : '',
        status: typeof raw.status === 'string' ? raw.status : '运转',
        powerGen: Number(raw.power?.gen ?? 0),
        powerUse: Number(raw.power?.use ?? 0),
        forces: (raw.forces ?? {}) as ArmoryForcesLike,
      });
    }
  }
  return out;
}

export function baseMatchesScope(base: NormalizedBaseRecord, scope: string): boolean {
  if (isAllScope(scope)) return true;
  const target = canonKey(scope);
  return canonKey(base.name) === target || canonKey(base.id) === target;
}

export function rawBaseMatchesScope(
  rawBase: string | undefined,
  scope: string,
  bases: readonly NormalizedBaseRecord[],
  allowEmptyAsGlobal = false,
): boolean {
  if (isAllScope(scope)) return true;
  const trimmed = String(rawBase ?? '').trim();
  if (!trimmed) return allowEmptyAsGlobal;
  const target = canonKey(scope);
  if (canonKey(trimmed) === target) return true;
  const matchedBase = bases.find(b => canonKey(b.name) === target || canonKey(b.id) === target);
  if (matchedBase) {
    return canonKey(trimmed) === canonKey(matchedBase.name) || canonKey(trimmed) === canonKey(matchedBase.id);
  }
  return false;
}

export function splitLoadoutTokens(raw: string): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(/[；;、,，\n/]+/)
    .map(s => s.replace(/^(?:[-*·•]\s*)?(?:主武器|副武器|底牌|挂载|专属挂载|制式武装|武器|武装|装备)\s*[:：]?\s*/, '').trim())
    .filter(Boolean);
}

/** 从世界书条目正文的 `<数据>...</数据>` 块中提取简单键值对（同时兼容 JSON 与 key: value 格式） */
export function parseDossierDataBlock(rawText: string | undefined): Record<string, string> {
  if (!rawText || typeof rawText !== 'string') return {};
  const m = rawText.match(/<数据>([\s\S]*?)<\/数据>/);
  const body = (m ? m[1] : rawText).trim();
  const out: Record<string, string> = {};
  if (body.startsWith('{') && body.endsWith('}')) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        if (v !== undefined && v !== null) {
          out[k] = typeof v === 'string' ? v : JSON.stringify(v);
        }
      }
      if (typeof parsed.exposure_grade === 'string' && !out['暴露分档']) {
        out['暴露分档'] = parsed.exposure_grade;
      }
      if (typeof parsed.balance_slot === 'string' && !out['平衡总纲位置']) {
        out['平衡总纲位置'] = parsed.balance_slot;
      }
      if (typeof parsed.temperament_spectrum === 'string' && !out['机魂光谱']) {
        out['机魂光谱'] = parsed.temperament_spectrum;
      }
      if (Array.isArray(parsed.special_equipment) && !out['武器']) {
        const eqNames = parsed.special_equipment
          .map(e => (e && typeof e === 'object' ? String((e as Record<string, unknown>).name ?? '').trim() : ''))
          .filter(Boolean);
        if (eqNames.length) out['武器'] = eqNames.join('；');
      }
      if (Array.isArray(parsed.special_skills) && !out['技能']) {
        const skLines = parsed.special_skills
          .map(s => {
            if (!s || typeof s !== 'object') return '';
            const rec = s as Record<string, unknown>;
            const sName = String(rec.name ?? '').trim();
            const sKind = String(rec.kind ?? '核心权能').trim();
            const sDesc = String(rec.desc ?? '').trim();
            return sName && sDesc ? `· 【${sName}（${sKind}）】${sDesc}` : '';
          })
          .filter(Boolean);
        if (skLines.length) out['技能'] = skLines.join('\n');
      }
      return out;
    } catch {
      /* 非标准 JSON 回退行解析 */
    }
  }
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^[-*·•]\s*/, '');
    if (!trimmed || trimmed.startsWith('#') || /^<\/?数据>$/i.test(trimmed)) continue;
    const kv = trimmed.match(/^([^:：]+?)[ \t]*[:：][ \t]*([^\r\n]+)$/);
    if (kv) {
      const k = kv[1].trim();
      const v = kv[2].trim().replace(/<\/?数据>/gi, '').trim();
      if (k && v) out[k] = v;
    }
  }
  return out;
}

export function extractGirlLoadouts(
  girl: ArmoryGirlLike,
  dossier: ArmoryDossierInput | null,
  parsedData: Record<string, string>,
): string[] {
  const tokens: string[] = [];
  if (Array.isArray(dossier?.special_equipment)) {
    for (const eq of dossier.special_equipment) {
      if (eq?.name && eq.name.trim()) {
        tokens.push(eq.name.trim());
      }
    }
  }
  const mergedData = { ...parsedData, ...(dossier?.data ?? {}) };
  for (const key of ['武器', '武装', '制式武装', '专属挂载', '挂载', '装备', 'weapons', 'loadout']) {
    const val = mergedData[key];
    if (typeof val === 'string' && val.trim() && !val.trim().startsWith('[')) {
      tokens.push(...splitLoadoutTokens(val));
    }
  }
  const weaponStr = dossier?.weapons || girl.weapons || '';
  if (weaponStr && !weaponStr.trim().startsWith('[')) {
    tokens.push(...splitLoadoutTokens(weaponStr));
  }
  return [...new Set(tokens)];
}

export function checkIsUnchristened(
  name: string,
  duty: string,
  status: string,
  traits: readonly string[],
): boolean {
  if (name.includes('待授名') || name.includes('未授名')) return true;
  if (duty.includes('待授名') || status.includes('待授名')) return true;
  if (traits.some(t => t.includes('待授名') || t.includes('未授名'))) return true;
  return false;
}

/** 归一化单条机娘原始记录（提取 serial / callsign / seq / faction / body / unchristened 等） */
export function normalizeGirlRecord(
  raw: ArmoryGirlLike | Record<string, unknown>,
  isPending = false,
): ArmoryGirlRecord {
  const rec = (raw ?? {}) as ArmoryGirlLike & Record<string, unknown>;
  const name = String(rec.name ?? '').trim();
  const rawBase = typeof rec.base === 'string' ? rec.base.trim() : '';
  const status = String(rec.status || rec.hp || '完好').trim();
  const duty = String(rec.duty || '战区战备待命').trim();
  const model = String(rec.model || rec['型号'] || rec['原型'] || '型号待定').trim();
  const traitsSource = rec.traits ?? rec.tags ?? rec.keys ?? [];
  const traits = Array.isArray(traitsSource)
    ? traitsSource.map(t => String(t).trim()).filter(Boolean)
    : [];

  const serial = String(rec.serial ?? rec['编号'] ?? rec['出厂编号'] ?? '').trim();
  const callsign = String(rec.callsign ?? rec['代号'] ?? rec['战术代号'] ?? '').trim();
  const seq = String(rec.seq ?? rec['序列'] ?? rec['机体序列'] ?? '').trim();
  const faction = String(rec.faction ?? rec['阵营'] ?? '').trim();
  const body = String(rec.body ?? rec['躯体特征'] ?? rec['身子'] ?? rec['体态特征'] ?? '').trim();
  const unchristened =
    typeof rec.unchristened === 'boolean'
      ? rec.unchristened
      : checkIsUnchristened(name, duty, status, traits);

  const weapons = String(rec.weapons ?? rec['武器'] ?? '').trim();
  const loadouts = splitLoadoutTokens(weapons);

  return {
    name,
    model,
    affection: typeof rec.affection === 'number' && Number.isFinite(rec.affection) ? rec.affection : null,
    obedience: typeof rec.obedience === 'number' && Number.isFinite(rec.obedience) ? rec.obedience : null,
    status,
    hp: status,
    duty,
    base: rawBase || '战区直属',
    rawBase,
    traits,
    weapons,
    skills: String(rec.skills ?? rec['能力'] ?? rec['技能'] ?? '').trim(),
    exposure: String(rec.exposure ?? rec['暴露分档'] ?? '').trim(),
    shell: String(rec.shell ?? rec['社会外壳'] ?? '').trim(),
    alias: String(rec.alias ?? rec['化名'] ?? '').trim(),
    form_mech: String(rec.form_mech ?? rec['形态机制'] ?? '').trim(),
    flaws: String(rec.flaws ?? rec['结构短板'] ?? rec['结构性短板'] ?? '').trim(),
    personality: String(rec.personality ?? rec['性格'] ?? '').trim(),
    appearance: String(rec.appearance ?? rec['外观'] ?? '').trim(),
    dossierContent: '',
    storyContent: '',
    cleanDossierContent: '',
    cleanStoryContent: '',
    loadouts,
    isPending,
    dossier: null,
    serial,
    callsign,
    seq,
    faction,
    body,
    unchristened,
    specialSkills: [],
    specialEquipment: [],
    temperamentSpectrum: '',
  };
}

/** 合并焦点机娘完整档案（优先取 dossierData / pendingMatch / base 中的非空值） */
export function resolveFocusedGirlProfile(
  baseInput: ArmoryGirlItem | ArmoryGirlLike,
  dossier?: ArmoryDossierInput | null,
  pendingRaw?: ArmoryGirlLike | Record<string, unknown> | null,
): ArmoryGirlItem {
  const base: ArmoryGirlItem =
    'unchristened' in baseInput && 'loadouts' in baseInput
      ? (baseInput as ArmoryGirlItem)
      : normalizeGirlRecord(baseInput, false);

  const pendingMatch = pendingRaw ? normalizeGirlRecord(pendingRaw, true) : null;
  const dossierContent = String(dossier?.dossierContent || dossier?.content || base.dossierContent || '').trim();
  const storyContent = String(dossier?.storyContent || base.storyContent || '').trim();
  const parsedFromText =
    dossierContent || storyContent ? parseGirlDossierData(dossierContent, storyContent) : null;
  const parsedData = parseDossierDataBlock(dossierContent);
  const mergedData: Record<string, string> = {
    ...(parsedFromText?.data ?? {}),
    ...parsedData,
    ...(dossier?.data ?? {}),
  };

  const dossierSerial = String(
    dossier?.serial || parsedFromText?.serial || mergedData['编号'] || mergedData['出厂编号'] || mergedData['serial'] || '',
  ).trim();
  const dossierCallsign = String(
    dossier?.callsign || parsedFromText?.callsign || mergedData['代号'] || mergedData['专属代号'] || mergedData['callsign'] || '',
  ).trim();
  const dossierSeq = String(
    dossier?.seq || parsedFromText?.seq || mergedData['序列'] || mergedData['机体序列'] || mergedData['seq'] || '',
  ).trim();
  const dossierFaction = String(
    dossier?.faction || parsedFromText?.faction || mergedData['阵营'] || mergedData['所属阵营'] || mergedData['faction'] || '',
  ).trim();
  const dossierBody = String(
    dossier?.body ||
      parsedFromText?.body ||
      mergedData['躯体特征'] ||
      mergedData['纳米躯体'] ||
      mergedData['身子'] ||
      mergedData['body'] ||
      '',
  ).trim();

  const finalName =
    pendingMatch?.name && !pendingMatch.name.includes('待授名') && base.name.includes('待授名')
      ? pendingMatch.name
      : base.name;

  const model =
    [
      dossier?.model,
      parsedFromText?.model,
      mergedData['型号'],
      pendingMatch?.model !== '型号待定' ? pendingMatch?.model : '',
      base.model !== '型号待定' ? base.model : '',
    ]
      .map(v => String(v ?? '').trim())
      .find(Boolean) || '型号待定';

  const serial = dossierSerial || pendingMatch?.serial || base.serial || '';
  const callsign = dossierCallsign || pendingMatch?.callsign || base.callsign || '';
  const seq = dossierSeq || pendingMatch?.seq || base.seq || '';
  const faction = dossierFaction || pendingMatch?.faction || base.faction || '';
  const body = dossierBody || pendingMatch?.body || base.body || '';

  const status =
    String(
      base.status !== '完好'
        ? base.status
        : pendingMatch?.status || dossier?.status || parsedFromText?.status || mergedData['当前状态'] || base.status || '完好',
    ).trim() || '完好';
  const duty = String(base.duty || pendingMatch?.duty || '战区战备待命').trim();
  const traits = base.traits.length > 0 ? base.traits : (pendingMatch?.traits ?? []);

  // 若已获正式名字且产生了 callsign / 正式名，重新评估待授名标志；否则沿用合并判断
  const hasBeenChristened =
    !finalName.includes('待授名') &&
    !finalName.includes('未授名') &&
    Boolean(callsign || (pendingMatch && !pendingMatch.unchristened));
  const unchristened = hasBeenChristened
    ? false
    : Boolean(base.unchristened || pendingMatch?.unchristened || checkIsUnchristened(finalName, duty, status, traits));

  const weapons = String(
    dossier?.weapons || parsedFromText?.weapons || pendingMatch?.weapons || base.weapons || mergedData['武器'] || mergedData['制式武装'] || '',
  ).trim();
  const skills = String(
    dossier?.skills || parsedFromText?.skills || pendingMatch?.skills || base.skills || mergedData['技能'] || mergedData['能力'] || '',
  ).trim();
  const rawExposure = String(
    dossier?.exposure || parsedFromText?.exposure || pendingMatch?.exposure || base.exposure || mergedData['暴露分档'] || '',
  ).trim();
  const exposure = /^<\/?数据>$/i.test(rawExposure) || rawExposure.startsWith('</') ? '' : rawExposure;
  const shell = String(
    dossier?.shell || parsedFromText?.shell || pendingMatch?.shell || base.shell || mergedData['社会外壳'] || '',
  ).trim();
  const alias = String(pendingMatch?.alias || base.alias || mergedData['化名'] || '').trim();
  const form_mech = String(
    dossier?.form_mech || parsedFromText?.form_mech || pendingMatch?.form_mech || base.form_mech || mergedData['形态机制'] || '',
  ).trim();
  const flaws = String(
    dossier?.flaws || parsedFromText?.flaws || pendingMatch?.flaws || base.flaws || mergedData['结构性短板'] || '',
  ).trim();
  const personality = String(
    dossier?.personality || parsedFromText?.personality || pendingMatch?.personality || base.personality || mergedData['性格'] || '',
  ).trim();
  const appearance = String(
    dossier?.appearance || parsedFromText?.appearance || pendingMatch?.appearance || base.appearance || mergedData['外观'] || '',
  ).trim();

  const cleanDossierContent = stripDossierMachineBlocks(dossierContent);
  const cleanStoryContent = stripDossierMachineBlocks(storyContent);

  const specialSkills: GirlSpecialSkill[] =
    (Array.isArray(dossier?.special_skills) && dossier.special_skills.length > 0
      ? dossier.special_skills
      : parsedFromText?.special_skills) ??
    base.specialSkills ??
    [];
  const specialEquipment: GirlSpecialEquipment[] =
    (Array.isArray(dossier?.special_equipment) && dossier.special_equipment.length > 0
      ? dossier.special_equipment
      : parsedFromText?.special_equipment) ??
    base.specialEquipment ??
    [];
  const temperamentSpectrum = String(
    dossier?.temperament_spectrum ||
      parsedFromText?.temperament_spectrum ||
      mergedData['机魂光谱'] ||
      mergedData['temperament_spectrum'] ||
      base.temperamentSpectrum ||
      '',
  ).trim();

  const loadouts = extractGirlLoadouts(
    { ...base, weapons } as ArmoryGirlLike,
    dossier ??
      (parsedFromText
        ? { ...parsedFromText, dossierContent, storyContent }
        : { special_equipment: specialEquipment }),
    mergedData,
  );

  return {
    ...base,
    name: finalName,
    model,
    status,
    hp: status,
    duty,
    traits,
    weapons,
    skills,
    exposure,
    shell,
    alias,
    form_mech,
    flaws,
    personality,
    appearance,
    dossierContent,
    storyContent,
    cleanDossierContent,
    cleanStoryContent,
    loadouts,
    dossier: dossier ?? base.dossier,
    serial,
    callsign,
    seq,
    faction,
    body,
    unchristened,
    specialSkills,
    specialEquipment,
    temperamentSpectrum,
  };
}

const DAMAGED_STATUS_RE = /受损|轻损|重损|战损|待修|故障|停机|瘫痪|大修|破损|damaged|broken/i;

/**
 * 解析单条载具/战机描述（如 `"天启坦克(正常)"`、`"犀牛坦克(受损) ×2"`、`"基洛夫空艇"`）
 */
export function parseVehicleToken(raw: unknown): {
  model: string;
  count: number;
  intact: number;
  damaged: number;
  statusLabel: string;
} | null {
  if (typeof raw === 'string') {
    let text = raw.trim();
    if (!text) return null;

    let count = 1;
    const countMatch = text.match(/\s*[×xX*]\s*(\d+)\s*$/);
    if (countMatch) {
      count = Math.max(1, Number.parseInt(countMatch[1], 10) || 1);
      text = text.slice(0, countMatch.index).trim();
    }

    let statusLabel = '正常';
    const parenMatch = text.match(/(?:\(([^()]+)\)|（([^（）]+)）)\s*$/);
    if (parenMatch) {
      const inner = (parenMatch[1] || parenMatch[2] || '').trim();
      const countInParen = inner.match(/^(\d+)\s*[台架辆艘]?$/);
      if (countInParen) {
        count = Math.max(1, Number.parseInt(countInParen[1], 10) || 1);
      } else if (inner) {
        statusLabel = inner;
      }
      text = text.slice(0, parenMatch.index).trim();
    }

    const model = text.trim();
    if (!model) return null;
    const isDamaged = DAMAGED_STATUS_RE.test(statusLabel);
    return {
      model,
      count,
      intact: isDamaged ? 0 : count,
      damaged: isDamaged ? count : 0,
      statusLabel,
    };
  }

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const rec = raw as Record<string, unknown>;
    const model = String(rec.model ?? rec.name ?? '').trim();
    if (!model) return null;
    const count = Math.max(1, Number(rec.count ?? rec.qty ?? 1) || 1);
    const statusLabel = String(rec.status ?? rec.state ?? '正常').trim() || '正常';
    const isDamaged = DAMAGED_STATUS_RE.test(statusLabel);
    return {
      model,
      count,
      intact: isDamaged ? 0 : count,
      damaged: isDamaged ? count : 0,
      statusLabel,
    };
  }

  return null;
}

const INFANTRY_ITEM_RE = /兵|步兵|动员|工程师|警犬|狙击|特工|谭雅|鲍里斯|军医|卫队|小队|蛙人|尤里/i;
const VEHICLE_ITEM_RE = /坦克|战车|基地车|MCV|采矿车|矿车|火炮|V3|防空车|履带|机甲|摩托|气垫|潜艇|驱逐舰|航母|无畏|海豚|乌贼|空艇|战机|米格|黑鹰|入侵者|夜鹰|直升机|飞碟|载具/i;
const EQUIPMENT_ITEM_RE = /弹|外骨骼|挂载|套件|装甲|护盾|凝胶|芯片|模块|插件|武器|火控|装备|补给/i;
const MCV_SYNONYM_RE = /(?:基地车|机动建设车|\bmcv\b)/i;

export function normalizeVehicleModelKey(raw: string | undefined | null): string {
  return canonKey(raw)
    .replace(/(?:\([^()]*\)|（[^（）]*）)/g, '')
    .replace(/[\s·•\-_]/g, '')
    .replace(/主战(?=(?:坦克|战车|机甲))/g, '')
    .trim();
}

export function doesGirlMatchVehicleModel(
  girl: Pick<ArmoryGirlItem, 'name' | 'model'>,
  rawGirl: ArmoryGirlLike | null | undefined,
  vehicleModel: string,
): boolean {
  const vRaw = canonKey(vehicleModel);
  const vCore = normalizeVehicleModelKey(vehicleModel);
  if (!vRaw || !vCore) return false;

  const gModelRaw = girl.model && girl.model !== '型号待定' ? canonKey(girl.model) : '';
  const gModelCore = gModelRaw ? normalizeVehicleModelKey(girl.model) : '';

  if (gModelRaw && (gModelRaw === vRaw || gModelRaw.includes(vRaw) || vRaw.includes(gModelRaw))) {
    return true;
  }
  if (
    gModelCore &&
    gModelCore.length >= 2 &&
    vCore.length >= 2 &&
    (gModelCore === vCore || gModelCore.includes(vCore) || vCore.includes(gModelCore))
  ) {
    return true;
  }
  if (MCV_SYNONYM_RE.test(gModelRaw) && MCV_SYNONYM_RE.test(vRaw)) {
    return true;
  }

  const vStem = vCore
    .replace(/(?:主战)?(?:坦克|战车|战机|空艇|直升机|采矿车|矿车|防空车|步兵车|基地车|机动建设车)$/i, '')
    .trim();

  const candidateNames = [
    girl.name,
    rawGirl?.name,
    typeof rawGirl?.rename_from === 'string' ? rawGirl.rename_from : '',
    typeof rawGirl?.['原名'] === 'string' ? String(rawGirl['原名']) : '',
  ]
    .map(s => canonKey(s))
    .filter(Boolean);

  for (const cand of candidateNames) {
    if (vRaw.length >= 2 && cand.includes(vRaw)) return true;
    if (vCore.length >= 2 && cand.includes(vCore)) return true;
    if (vStem.length >= 2 && cand.includes(vStem) && (cand.includes('待授名') || /[-_·]\d+/.test(cand))) {
      return true;
    }
  }
  return false;
}

export function notableCharacterMatchesScope(
  rawLocOrBase: string | undefined,
  scope: string,
  bases: readonly NormalizedBaseRecord[],
  isGlobalAdjutant = false,
): boolean {
  if (isAllScope(scope)) return true;
  const trimmed = String(rawLocOrBase ?? '').trim();
  if (!trimmed || trimmed === '战区指挥部' || trimmed === '统帅部直属' || isAllScope(trimmed)) {
    return isGlobalAdjutant;
  }
  if (rawBaseMatchesScope(trimmed, scope, bases, false)) return true;
  const target = canonKey(scope);
  const cLoc = canonKey(trimmed);
  if (target && cLoc.includes(target)) return true;
  const matchedBase = bases.find(b => baseMatchesScope(b, scope));
  if (matchedBase) {
    const bName = canonKey(matchedBase.name);
    const bId = canonKey(matchedBase.id);
    const bLoc = canonKey(matchedBase.location);
    if ((bName && cLoc.includes(bName)) || (bId && cLoc.includes(bId))) return true;
    if (bLoc && bLoc.length >= 2 && cLoc.includes(bLoc)) return true;
  }
  return false;
}

export function classifyProductionQueueItem(q: ArmoryQueueLike): 'personnel' | 'vehicles' | 'equipment' {
  const lane = String(q.lane ?? '').toLowerCase();
  const item = String(q.item ?? '');
  if (q.type === '改装') return 'equipment';
  if (lane.includes('personnel') || lane.includes('兵营')) return 'personnel';
  if (lane.includes('equipment') || lane.includes('装备')) return 'equipment';
  if (lane.includes('land') || lane.includes('air') || lane.includes('naval') || lane.includes('战车') || lane.includes('空军')) {
    return 'vehicles';
  }
  if (EQUIPMENT_ITEM_RE.test(item)) return 'equipment';
  if (VEHICLE_ITEM_RE.test(item)) return 'vehicles';
  if (INFANTRY_ITEM_RE.test(item)) return 'personnel';
  return 'equipment';
}
