/**
 * buildingCoordEngine.ts —— 基地建筑相对于 MCV 原点 (0, 0) 的双模坐标折算与三环确定性布防引擎（FD-34 · PKG-A）
 *
 * 核心职责：
 * 1. 以本基地 MCV / 建造厂为绝对原点 `(0, 0)`（东 `+x`，北 `+y`，范围 `-10 ~ +10` 战术格，每 `1` 格 `= 100m`）；
 * 2. `parseRelativeBuildingCoord`：支持结构化相对坐标（`[-2, 3]`、`"-2, +3"`、`{x:-2, y:3}`、`"+200m, -100m"`、`"E2, N3"`）
 *    与战术方位描述（`"西北侧 300米"`、`"MCV东翼 200m"`、`"正北内环"`）双向自动折算；
 * 3. `classifyBuildingRing` & `resolveBuildingRelativeCoord`：当旧档或 AI 未提供坐标时，按建筑职能三环
 *    （核心 `(0,0)` MCV ➔ 内环 `r=1.5~3` 能源科研 ➔ 中环 `r=3.5~6` 产线母体 ➔ 外环 `r=6.5~9` 防御工事）
 *    确定性生成相对坐标与标准方位标签，确保同一建筑跨轮次坐标恒定不跳变。
 *
 * 🔴 纯函数铁律：零 IO / 零 DOM / 零 Vue·Pinia / 零酒馆 API。
 */

export type BuildingRing = 'core' | 'inner' | 'mid' | 'outer';

export interface RelativeCoord {
  x: number;
  y: number;
}

export interface ResolvedBuildingSpatial {
  coord: RelativeCoord;
  ring: BuildingRing;
  ringLabel: '核心' | '内环' | '中环' | '外环';
  compass: '原点' | 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
  compassCn: 'MCV原点' | '正北' | '东北' | '正东' | '东南' | '正南' | '西南' | '正西' | '西北';
  distanceMeters: number;
  bearingLabel: string;
}

const CONYARD_RE = /建造厂|基地车|MCV|前沿工地|作战前哨站|指挥中枢/i;
const INNER_RING_RE =
  /发电厂|磁能反应炉|生物反应炉|核子反应堆|核电|实验室|作战实验室|战斗实验室|心灵研究|超维暗网|暗网中继|纳米核心|心灵感应器|裂缝产生器|雷达|通讯中心|科技中心/i;
const OUTER_RING_RE =
  /碉堡|机枪|光棱塔|磁暴线圈|特斯拉|爱国者|防空|哨戒炮|巨炮|心灵控制塔|心灵信标|基因突变|天气控制|铁幕|核弹发射井|围墙|闸门|雷区|探照灯|岸防|鱼雷发射/i;

export function clampCoordVal(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const clamped = Math.max(-10, Math.min(10, v));
  const rounded = Math.round(clamped * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** 判定建筑所属基地防务圈层 */
export function classifyBuildingRing(name: string): BuildingRing {
  const s = String(name ?? '').trim();
  if (!s) return 'mid';
  if (CONYARD_RE.test(s)) return 'core';
  if (OUTER_RING_RE.test(s)) return 'outer';
  if (INNER_RING_RE.test(s)) return 'inner';
  return 'mid';
}

export function ringToCnLabel(ring: BuildingRing): '核心' | '内环' | '中环' | '外环' {
  if (ring === 'core') return '核心';
  if (ring === 'inner') return '内环';
  if (ring === 'outer') return '外环';
  return '中环';
}

/** 由 (x, y) 计算八方位缩写与中文名 */
export function coordToCompass(coord: RelativeCoord): {
  compass: ResolvedBuildingSpatial['compass'];
  compassCn: ResolvedBuildingSpatial['compassCn'];
  distanceMeters: number;
} {
  const { x, y } = coord;
  const distGrid = Math.hypot(x, y);
  if (distGrid < 0.25) {
    return { compass: '原点', compassCn: 'MCV原点', distanceMeters: 0 };
  }
  const distanceMeters = Math.round((distGrid * 100) / 10) * 10;
  // atan2(y, x): 0 = E, 90 = N, 180/-180 = W, -90 = S
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  if (deg >= 337.5 || deg < 22.5) return { compass: 'E', compassCn: '正东', distanceMeters };
  if (deg >= 22.5 && deg < 67.5) return { compass: 'NE', compassCn: '东北', distanceMeters };
  if (deg >= 67.5 && deg < 112.5) return { compass: 'N', compassCn: '正北', distanceMeters };
  if (deg >= 112.5 && deg < 157.5) return { compass: 'NW', compassCn: '西北', distanceMeters };
  if (deg >= 157.5 && deg < 202.5) return { compass: 'W', compassCn: '正西', distanceMeters };
  if (deg >= 202.5 && deg < 247.5) return { compass: 'SW', compassCn: '西南', distanceMeters };
  if (deg >= 247.5 && deg < 292.5) return { compass: 'S', compassCn: '正南', distanceMeters };
  return { compass: 'SE', compassCn: '东南', distanceMeters };
}

export function formatCoordPair(coord: RelativeCoord): string {
  const fx = coord.x > 0 ? `+${coord.x}` : `${coord.x}`;
  const fy = coord.y > 0 ? `+${coord.y}` : `${coord.y}`;
  return `(${fx},${fy})`;
}

export function formatBuildingCoordLabel(coord: RelativeCoord, buildingName?: string): string {
  const { compass, compassCn, distanceMeters } = coordToCompass(coord);
  if (compass === '原点' || (buildingName && classifyBuildingRing(buildingName) === 'core' && distanceMeters === 0)) {
    return 'MCV原点 (0,0)';
  }
  return `${compassCn}·${distanceMeters}m ${formatCoordPair(coord)}`;
}

const DIRECTION_UNIT_VECTORS: ReadonlyArray<{ re: RegExp; ux: number; uy: number }> = [
  { re: /东北|NE|北偏东|东偏北/i, ux: 0.7071, uy: 0.7071 },
  { re: /西北|NW|北偏西|西偏北/i, ux: -0.7071, uy: 0.7071 },
  { re: /东南|SE|南偏东|东偏南/i, ux: 0.7071, uy: -0.7071 },
  { re: /西南|SW|南偏西|西偏南/i, ux: -0.7071, uy: -0.7071 },
  { re: /正北|北侧|北翼|北面|北坡|北端|\bN\b/i, ux: 0, uy: 1 },
  { re: /正南|南侧|南翼|南面|南坡|南端|\bS\b/i, ux: 0, uy: -1 },
  { re: /正东|东侧|东翼|东面|东坡|东端|\bE\b/i, ux: 1, uy: 0 },
  { re: /正西|西侧|西翼|西面|西坡|西端|\bW\b/i, ux: -1, uy: 0 },
];

function scaleRawNumberToGrid(val: number, hasMeterUnit: boolean): number {
  if (hasMeterUnit || Math.abs(val) > 15) {
    return clampCoordVal(val / 100);
  }
  return clampCoordVal(val);
}

/**
 * 解析双模相对坐标输入：
 * - 数组：`[-2, 3]`
 * - 对象：`{ x: -2, y: 3 }`
 * - 字符串：`"-2, +3"`、`"(+200m, -100m)"`、`"E2, N3"`、`"西北侧 300米"`、`"MCV原点"`
 */
export function parseRelativeBuildingCoord(
  raw: unknown,
  buildingName?: string,
): { coord: RelativeCoord; bearing: string } | null {
  if (raw == null) return null;

  // 1. 数组 [x, y]
  if (Array.isArray(raw) && raw.length >= 2) {
    const nx = Number(raw[0]);
    const ny = Number(raw[1]);
    if (Number.isFinite(nx) && Number.isFinite(ny)) {
      const coord = {
        x: scaleRawNumberToGrid(nx, false),
        y: scaleRawNumberToGrid(ny, false),
      };
      return { coord, bearing: formatBuildingCoordLabel(coord, buildingName) };
    }
  }

  // 2. 对象 { x, y }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const nx = Number(obj.x ?? obj.dx ?? obj.东 ?? 0);
    const ny = Number(obj.y ?? obj.dy ?? obj.北 ?? 0);
    if (('x' in obj || 'y' in obj || 'dx' in obj || 'dy' in obj) && Number.isFinite(nx) && Number.isFinite(ny)) {
      const coord = {
        x: scaleRawNumberToGrid(nx, false),
        y: scaleRawNumberToGrid(ny, false),
      };
      return { coord, bearing: formatBuildingCoordLabel(coord, buildingName) };
    }
  }

  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;

  if (/^(?:MCV)?(?:原点|中心|核心|0\s*[,，]\s*0|\(\s*0\s*[,，]\s*0\s*\))$/i.test(text)) {
    const coord = { x: 0, y: 0 };
    return { coord, bearing: 'MCV原点 (0,0)' };
  }

  // 3. E2, N3 / W1.5 S2 格式
  const enMatch = /\b([EW])\s*([+-]?\d+(?:\.\d+)?)\s*[,，/\s]\s*([NS])\s*([+-]?\d+(?:\.\d+)?)/i.exec(text);
  if (enMatch) {
    const ew = enMatch[1].toUpperCase() === 'W' ? -1 : 1;
    const ns = enMatch[3].toUpperCase() === 'S' ? -1 : 1;
    const x = scaleRawNumberToGrid(ew * Number(enMatch[2]), false);
    const y = scaleRawNumberToGrid(ns * Number(enMatch[4]), false);
    const coord = { x, y };
    return { coord, bearing: formatBuildingCoordLabel(coord, buildingName) };
  }

  // 4. 括号或逗号成对数字：(-2, +3) 或 "+200m, -150m"
  const pairMatch = /([+-]?\d+(?:\.\d+)?)\s*(m|米)?\s*[,，]\s*([+-]?\d+(?:\.\d+)?)\s*(m|米)?/i.exec(text);
  if (pairMatch) {
    const x = scaleRawNumberToGrid(Number(pairMatch[1]), Boolean(pairMatch[2]));
    const y = scaleRawNumberToGrid(Number(pairMatch[3]), Boolean(pairMatch[4]));
    const coord = { x, y };
    return { coord, bearing: formatBuildingCoordLabel(coord, buildingName) };
  }

  // 5. 自然语言战术方位："西北侧 300米" / "MCV正东 200m" / "东南外环"
  for (const dir of DIRECTION_UNIT_VECTORS) {
    if (dir.re.test(text)) {
      const distMatch = /(\d+(?:\.\d+)?)\s*(km|千米|公里|m|米|格)?/i.exec(text);
      let radiusGrid = 3.5;
      if (distMatch) {
        const val = Number(distMatch[1]);
        const unit = (distMatch[2] || '').toLowerCase();
        if (unit === 'km' || unit === '千米' || unit === '公里') {
          radiusGrid = val * 10;
        } else if (unit === 'm' || unit === '米' || val > 15) {
          radiusGrid = val / 100;
        } else {
          radiusGrid = val;
        }
      } else if (/内环|近处|核心旁/.test(text)) {
        radiusGrid = 2.0;
      } else if (/外环|外围|前哨|前沿|远端/.test(text)) {
        radiusGrid = 7.5;
      } else {
        const ring = classifyBuildingRing(buildingName ?? '');
        radiusGrid = ring === 'inner' ? 2.2 : ring === 'outer' ? 7.5 : 4.5;
      }
      const coord = {
        x: clampCoordVal(dir.ux * radiusGrid),
        y: clampCoordVal(dir.uy * radiusGrid),
      };
      return { coord, bearing: formatBuildingCoordLabel(coord, buildingName) };
    }
  }

  return null;
}

function deterministicHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

/**
 * 确定性推导建筑相对于本基地 MCV 原点 (0, 0) 的空间信息：
 * - 若建筑已带有显式 `coord` 或 `bearing`，优先采用并补全；
 * - 若未带坐标，则按建筑职能三环（核心 `(0,0)` / 内环 `1.5~3` / 中环 `3.5~6` / 外环 `6.5~9`）
 *   结合 `baseId + buildingName + index` 确定性分配扇区坐标。
 */
export function resolveBuildingRelativeCoord(
  building: { name: string; coord?: { x: number; y: number }; bearing?: string },
  index = 0,
  baseId = 'base-0',
): ResolvedBuildingSpatial {
  const name = String(building?.name ?? '').trim();
  const ring = classifyBuildingRing(name);

  if (
    building?.coord &&
    typeof building.coord.x === 'number' &&
    typeof building.coord.y === 'number' &&
    Number.isFinite(building.coord.x) &&
    Number.isFinite(building.coord.y)
  ) {
    const coord = {
      x: clampCoordVal(building.coord.x),
      y: clampCoordVal(building.coord.y),
    };
    const { compass, compassCn, distanceMeters } = coordToCompass(coord);
    const bearingLabel =
      typeof building.bearing === 'string' && building.bearing.trim()
        ? building.bearing.trim()
        : formatBuildingCoordLabel(coord, name);
    return {
      coord,
      ring,
      ringLabel: ringToCnLabel(ring),
      compass,
      compassCn,
      distanceMeters,
      bearingLabel,
    };
  }

  if (typeof building?.bearing === 'string' && building.bearing.trim()) {
    const parsedFromBearing = parseRelativeBuildingCoord(building.bearing, name);
    if (parsedFromBearing) {
      const { compass, compassCn, distanceMeters } = coordToCompass(parsedFromBearing.coord);
      return {
        coord: parsedFromBearing.coord,
        ring,
        ringLabel: ringToCnLabel(ring),
        compass,
        compassCn,
        distanceMeters,
        bearingLabel: parsedFromBearing.bearing,
      };
    }
  }

  // MCV / 建造厂恒定位于 (0, 0) 原点
  if (ring === 'core') {
    const coord = { x: 0, y: 0 };
    return {
      coord,
      ring: 'core',
      ringLabel: '核心',
      compass: '原点',
      compassCn: 'MCV原点',
      distanceMeters: 0,
      bearingLabel: 'MCV原点 (0,0)',
    };
  }

  // 按三环确定性哈希分配角度与半径（使用黄金角偏移防止多建筑重叠）
  const hash = deterministicHash(`${baseId}::${name}::${index}`);
  const goldenAngleRad = index * 2.399963229728653 + ((hash % 360) * Math.PI) / 180;
  const radiusRange: [number, number] =
    ring === 'inner' ? [1.8, 3.0] : ring === 'outer' ? [6.5, 8.8] : [3.6, 5.8];
  const radiusFrac = ((hash >>> 8) % 100) / 100;
  const r = radiusRange[0] + radiusFrac * (radiusRange[1] - radiusRange[0]);

  let x = clampCoordVal(Math.cos(goldenAngleRad) * r);
  let y = clampCoordVal(Math.sin(goldenAngleRad) * r);
  if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) {
    x = 1.5;
    y = 1.0;
  }

  const coord = { x, y };
  const { compass, compassCn, distanceMeters } = coordToCompass(coord);
  const bearingLabel = formatBuildingCoordLabel(coord, name);

  return {
    coord,
    ring,
    ringLabel: ringToCnLabel(ring),
    compass,
    compassCn,
    distanceMeters,
    bearingLabel,
  };
}
