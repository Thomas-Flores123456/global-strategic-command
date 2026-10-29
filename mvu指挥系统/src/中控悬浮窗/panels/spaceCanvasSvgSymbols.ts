/**
 * spaceCanvasSvgSymbols.ts —— 天基交互式节点画布军工蓝图风 SVG 图元库（PKG-B）
 *
 * 职责：
 * 1. 为空间站（12种）、轨道星座（6种）、月球基地（10种）共 28 枚天基构件提供高精度内联 SVG 矢量路径；
 * 2. 兼容多种 svgSymbolId / assetId 命名风格（如 `st_core`、`sym_st_core`、`asset.st.core`、`st-core`）；
 * 3. 暴露 `registerCustomSvgSymbol(symbolId, paths)` 接口供未来 DLC / 世界书自定义资产动态注册图元，并提供通用兜底图元。
 */

export interface SpaceSvgSymbolDef {
  /** 标准图元键名 */
  id: string;
  /** 图元中文说明 */
  title: string;
  /** 默认 viewBox（统一采用 -24 -24 48 48 中心锚点坐标系，方便在节点中心直接渲染或缩放） */
  viewBox: string;
  /** 主结构线条 SVG path d 数组（stroke 渲染） */
  paths: string[];
  /** 辅助装饰/发光填充或细部线条 SVG path d 数组（可选） */
  accentPaths?: string[];
  /** 主题强调色（十六进制或 CSS 颜色） */
  accentColor?: string;
}

const CUSTOM_SYMBOL_REGISTRY = new Map<string, SpaceSvgSymbolDef>();

/**
 * 归一化图元 ID：将 `asset.st.core` / `sym_st_core` / `svg_st_core` / `st-core` 统一转为 `st_core`
 */
export function normalizeSvgSymbolKey(rawId?: string | null): string {
  if (!rawId) return '';
  return rawId
    .trim()
    .toLowerCase()
    .replace(/^(sym_|sym-|svg_|svg-|icon_|icon-|asset\.)/, '')
    .replace(/[.\-\s]+/g, '_');
}

/**
 * 28 枚正典天基工程军工蓝图风 SVG 图元定义（中心原点 `0,0`，范围约 `-20..20`）
 */
export const BUILTIN_SPACE_SVG_SYMBOLS: Record<string, SpaceSvgSymbolDef> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // 🛰️ 一、空间站图元（12 枚）
  // ═══════════════════════════════════════════════════════════════════════════
  st_core: {
    id: 'st_core',
    title: '天枢核心控制舱（十字多向对接口 + 遥测天线）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -6 -16 L 6 -16 L 6 -6 L 16 -6 L 16 6 L 6 6 L 6 16 L -6 16 L -6 6 L -16 6 L -16 -6 L -6 -6 Z',
      'M -9 -3 L -9 3 M 9 -3 L 9 3 M -3 -9 L 3 -9 M -3 9 L 3 9',
      'M 0 -16 L 0 -21 M -4 -20 L 4 -20',
    ],
    accentPaths: [
      'M -4 -4 L 4 -4 L 4 4 L -4 4 Z',
      'M -19 -3 L -16 -3 M 16 -3 L 19 -3 M -3 -19 L -3 -16 M -3 16 L -3 19',
    ],
    accentColor: '#38bdf8',
  },

  st_node_hub: {
    id: 'st_node_hub',
    title: '六向扩展节点舱（六边形球体对接环）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M 0 -16 L 14 -8 L 14 8 L 0 16 L -14 8 L -14 -8 Z',
      'M 0 -16 L 0 -20 M 14 -8 L 18 -10 M 14 8 L 18 10 M 0 16 L 0 20 M -14 8 L -18 10 M -14 -8 L -18 -10',
      'M -6 -6 L 6 -6 L 6 6 L -6 6 Z',
    ],
    accentPaths: [
      'M 0 -9 L 8 -4.5 L 8 4.5 L 0 9 L -8 4.5 L -8 -4.5 Z',
      'M -2 0 L 2 0 M 0 -2 L 0 2',
    ],
    accentColor: '#c084fc',
  },

  st_heavy_truss: {
    id: 'st_heavy_truss',
    title: '重型扩展桁架（交叉钢桁架结构件）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -18 -7 L 18 -7 L 18 7 L -18 7 Z',
      'M -18 -7 L -6 7 L 6 -7 L 18 7',
      'M -18 7 L -6 -7 L 6 7 L 18 -7',
      'M -6 -7 L -6 7 M 6 -7 L 6 7',
    ],
    accentPaths: [
      'M -21 -3 L -18 -3 M -21 3 L -18 3 M 18 -3 L 21 -3 M 18 3 L 21 3',
    ],
    accentColor: '#a855f7',
  },

  st_hab: {
    id: 'st_hab',
    title: '常驻乘员居住生活舱（带舷窗圆柱加压舱）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -14 -9 L 14 -9 L 17 -5 L 17 5 L 14 9 L -14 9 L -17 5 L -17 -5 Z',
      'M -10 -9 L -10 9 M 10 -9 L 10 9',
      'M -7 -2 L -3 -2 L -3 2 L -7 2 Z',
      'M 3 -2 L 7 -2 L 7 2 L 3 2 Z',
    ],
    accentPaths: [
      'M -1 0 L 1 0 M -14 -4 L -10 -4 M 10 -4 L 14 -4',
    ],
    accentColor: '#34d399',
  },

  st_lab: {
    id: 'st_lab',
    title: '微重力高精实验舱（圆柱实验舱 + 外部暴露载荷架）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -15 -8 L 9 -8 L 9 8 L -15 8 Z',
      'M 9 -5 L 18 -5 L 18 5 L 9 5',
      'M 12 -5 L 12 5 M 15 -5 L 15 5',
      'M -10 -8 L -10 8 M -3 -8 L -3 8',
    ],
    accentPaths: [
      'M -7 -3 L 0 -3 L 3 0 L 0 3 L -7 3 Z',
      'M 13 -9 L 17 -9 L 17 -5',
    ],
    accentColor: '#38bdf8',
  },

  st_solar: {
    id: 'st_solar',
    title: '标准太阳翼与供配电组件（双侧深蓝光伏翼阵列）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -3 -4 L 3 -4 L 3 4 L -3 4 Z',
      'M 0 -4 L 0 -19 M 0 4 L 0 19',
      'M -15 -18 L -2 -18 L -2 -6 L -15 -6 Z',
      'M 2 -18 L 15 -18 L 15 -6 L 2 -6 Z',
      'M -15 6 L -2 6 L -2 18 L -15 18 Z',
      'M 2 6 L 15 6 L 15 18 L 2 18 Z',
    ],
    accentPaths: [
      'M -8.5 -18 L -8.5 -6 M 8.5 -18 L 8.5 -6 M -8.5 6 L -8.5 18 M 8.5 6 L 8.5 18',
      'M -15 -12 L -2 -12 M 2 -12 L 15 -12 M -15 12 L -2 12 M 2 12 L 15 12',
    ],
    accentColor: '#fbbf24',
  },

  st_reactor: {
    id: 'st_reactor',
    title: '千瓦级轨道核反应堆（辐射警示标志 + 防护屏蔽锥 + 散热管）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -10 -12 L 10 -12 L 14 4 L -14 4 Z',
      'M -6 4 L 6 4 L 6 14 L -6 14 Z',
      'M -16 7 L -6 7 M -16 11 L -6 11 M 6 7 L 16 7 M 6 11 L 16 11',
      'M 0 -12 L 0 -18 M -5 -16 L 5 -16',
    ],
    accentPaths: [
      'M 0 -5 L -4 -9 L 4 -9 Z',
      'M 0 -5 L -6 -1 L -2 2 Z',
      'M 0 -5 L 6 -1 L 2 2 Z',
    ],
    accentColor: '#f59e0b',
  },

  st_radiator_ep: {
    id: 'st_radiator_ep',
    title: '大功率电推散热翼（梯形液滴散热翼板 + 霍尔电推尾喷）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -5 -6 L 5 -6 L 7 6 L -7 6 Z',
      'M -5 -4 L -18 -12 L -18 4 L -6 4 Z',
      'M 5 -4 L 18 -12 L 18 4 L 6 4 Z',
      'M -4 6 L -6 13 L 6 13 L 4 6',
    ],
    accentPaths: [
      'M -12 -6 L -12 2 M 12 -6 L 12 2',
      'M -3 14 L -5 19 M 0 14 L 0 20 M 3 14 L 5 19',
    ],
    accentColor: '#22d3ee',
  },

  st_fuel_depot: {
    id: 'st_fuel_depot',
    title: '在轨低温燃料补给站（双联球形低温液氢液氧储罐）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -15 -12 L 15 -12 M -15 12 L 15 12 M 0 -12 L 0 12',
      'M -12 -8 L -4 -8 L -2 -4 L -2 4 L -4 8 L -12 8 L -14 4 L -14 -4 Z',
      'M 4 -8 L 12 -8 L 14 -4 L 14 4 L 12 8 L 4 8 L 2 4 L 2 -4 Z',
    ],
    accentPaths: [
      'M -10 -3 L -6 -3 M -10 3 L -6 3 M 6 -3 L 10 -3 M 6 3 L 10 3',
      'M -2 0 L 2 0',
    ],
    accentColor: '#38bdf8',
  },

  st_recon_array: {
    id: 'st_recon_array',
    title: '轨道侦察预警阵列（大孔径光学反射镜 + 相控阵雷达板）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -8 -10 L 8 -10 L 11 2 L -11 2 Z',
      'M -16 2 L 16 2 L 14 8 L -14 8 Z',
      'M -6 8 L 0 17 L 6 8',
      'M 0 2 L 0 15',
    ],
    accentPaths: [
      'M -5 -5 L 5 -5 L 5 -1 L -5 -1 Z',
      'M -8 18 L 8 18 M -12 21 L 12 21',
    ],
    accentColor: '#38bdf8',
  },

  st_kinetic_rod: {
    id: 'st_kinetic_rod',
    title: '轨道钨合金动能武器挂架（六联装天基权杖发射巢）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -13 -14 L 13 -14 L 13 6 L -13 6 Z',
      'M -9 -14 L -9 16 M -3 -14 L -3 18 M 3 -14 L 3 18 M 9 -14 L 9 16',
      'M -16 -6 L 16 -6 M -16 2 L 16 2',
    ],
    accentPaths: [
      'M -9 16 L -9 20 M -3 18 L -3 22 M 3 18 L 3 22 M 9 16 L 9 20',
    ],
    accentColor: '#f87171',
  },

  st_orbital_dock: {
    id: 'st_orbital_dock',
    title: '轨道船坞总装臂（龙门桁架 + 双机械臂）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -17 -14 L 17 -14 L 17 -8 L -17 -8 Z',
      'M -15 -8 L -15 15 M 15 -8 L 15 15',
      'M -15 2 L -7 8 L -4 3',
      'M 15 2 L 7 8 L 4 3',
    ],
    accentPaths: [
      'M -6 -2 L 6 -2 L 8 4 L -8 4 Z',
      'M -11 -14 L -11 -8 M 0 -14 L 0 -8 M 11 -14 L 11 -8',
    ],
    accentColor: '#fbbf24',
  },

  // 额外兼容：地月转运飞船母港
  st_ship_hub: {
    id: 'st_ship_hub',
    title: '地月转运飞船母港（深空泊位对接环 + 导航灯标）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -16 -12 L 16 -12 L 12 12 L -12 12 Z',
      'M -8 -6 L 8 -6 L 6 6 L -6 6 Z',
      'M 0 -18 L 0 -12 M 0 12 L 0 18',
    ],
    accentPaths: ['M -3 0 L 3 0 M 0 -3 L 0 3'],
    accentColor: '#38bdf8',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 🌐 二、轨道星座卫星图元（6 枚）
  // ═══════════════════════════════════════════════════════════════════════════
  sat_opt_recon: {
    id: 'sat_opt_recon',
    title: '低轨高分光学侦察星（精密光学镜筒 + 双太阳翼）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -5 -9 L 5 -9 L 4 9 L -4 9 Z',
      'M -18 -4 L -5 -4 L -5 4 L -18 4 Z',
      'M 5 -4 L 18 -4 L 18 4 L 5 4 Z',
      'M -3 9 L -6 15 L 6 15 L 3 9',
    ],
    accentPaths: [
      'M -2 -3 L 2 -3 L 2 3 L -2 3 Z',
      'M 0 15 L 0 20',
    ],
    accentColor: '#38bdf8',
  },

  sat_sar_radar: {
    id: 'sat_sar_radar',
    title: '全天候 SAR 合成孔径雷达星（长平板合成孔径雷达阵 + 太阳翼）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -4 -5 L 4 -5 L 4 5 L -4 5 Z',
      'M -18 -11 L 18 -11 L 18 -6 L -18 -6 Z',
      'M -16 8 L 16 8 L 14 14 L -14 14 Z',
      'M 0 -5 L 0 -11 M -6 5 L -8 8 M 6 5 L 8 8',
    ],
    accentPaths: [
      'M -10 11 L 10 11 M -6 17 L 6 17 M -11 20 L 11 20',
    ],
    accentColor: '#22d3ee',
  },

  sat_geo_survey: {
    id: 'sat_geo_survey',
    title: '天基重磁与地质勘探星（长磁力梯度伸杆 + 传感器吊舱）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -6 -6 L 6 -6 L 6 6 L -6 6 Z',
      'M -18 -3 L -6 -3 L -6 3 L -18 3 Z',
      'M 6 -3 L 18 -3 L 18 3 L 6 3 Z',
      'M 0 6 L 0 18',
      'M -3 16 L 3 16 L 3 21 L -3 21 Z',
    ],
    accentPaths: [
      'M 0 -6 L 0 -15 M -3 -15 L 3 -15',
      'M -3 11 L 3 11',
    ],
    accentColor: '#34d399',
  },

  sat_comm_relay: {
    id: 'sat_comm_relay',
    title: '量子宽带通信中继星（双抛物面天线 + 激光中继器）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -4 -6 L 4 -6 L 4 6 L -4 6 Z',
      'M -4 0 L -11 0 M 4 0 L 11 0',
      'M -11 -8 C -17 -6 -17 6 -11 8',
      'M 11 -8 C 17 -6 17 6 11 8',
      'M 0 -6 L 0 -17 M 0 6 L 0 17',
    ],
    accentPaths: [
      'M -15 0 L -19 -3 M -15 0 L -19 3',
      'M 15 0 L 19 -3 M 15 0 L 19 3',
    ],
    accentColor: '#fbbf24',
  },

  sat_nav_timing: {
    id: 'sat_nav_timing',
    title: '全球天基导航授时星（环形阵列天线 + 斜置太阳翼）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -5 -5 L 5 -5 L 5 5 L -5 5 Z',
      'M -17 -14 L -6 -5 M 6 -5 L 17 -14',
      'M -17 14 L -6 5 M 6 5 L 17 14',
      'M -4 9 L 4 9 M -7 13 L 7 13 M 0 5 L 0 15',
    ],
    accentPaths: [
      'M -2 -2 L 2 -2 L 2 2 L -2 2 Z',
      'M -10 17 L 10 17',
    ],
    accentColor: '#a855f7',
  },

  sat_early_warn: {
    id: 'sat_early_warn',
    title: '高轨红外弹道导弹预警星（大型遮光罩红外望远镜 + 高增益天线）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -6 -12 L 6 -12 L 9 4 L -9 4 Z',
      'M -9 4 L -13 13 L 13 13 L 9 4 Z',
      'M -19 -4 L -7 -4 L -7 2 L -19 2 Z',
      'M 7 -4 L 19 -4 L 19 2 L 7 2 Z',
    ],
    accentPaths: [
      'M -5 13 L 0 20 L 5 13',
      'M 0 -12 L 0 -18 M -4 -18 L 4 -18',
    ],
    accentColor: '#f97316',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 🌕 三、月球基地图元（10 枚 + 2 枚外环扩展兼容）
  // ═══════════════════════════════════════════════════════════════════════════
  ln_core: {
    id: 'ln_core',
    title: '坑底半埋式防辐射核心堡垒（八角装甲穹顶 + 月壤覆层 + 通信塔）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -8 -14 L 8 -14 L 15 -7 L 15 7 L 8 14 L -8 14 L -15 7 L -15 -7 Z',
      'M -19 10 L 19 10',
      'M 0 -14 L 0 -20 M -5 -18 L 5 -18',
    ],
    accentPaths: [
      'M -5 -6 L 5 -6 L 8 0 L 5 6 L -5 6 L -8 0 Z',
      'M -3 0 L 3 0 M 0 -3 L 0 3',
    ],
    accentColor: '#38bdf8',
  },

  ln_tunnel_hub: {
    id: 'ln_tunnel_hub',
    title: '月表加压管廊延伸枢纽（四向气闸穹顶 + 延伸管廊接口）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -7 -7 L 7 -7 L 7 7 L -7 7 Z',
      'M -4 -18 L 4 -18 L 4 -7 L -4 -7 Z',
      'M -4 7 L 4 7 L 4 18 L -4 18 Z',
      'M -18 -4 L -7 -4 L -7 4 L -18 4 Z',
      'M 7 -4 L 18 -4 L 18 4 L 7 4 Z',
    ],
    accentPaths: [
      'M -3 -3 L 3 -3 L 3 3 L -3 3 Z',
      'M 0 -18 L 0 -21 M 0 18 L 0 21 M -18 0 L -21 0 M 18 0 L 21 0',
    ],
    accentColor: '#c084fc',
  },

  ln_landing_pad: {
    id: 'ln_landing_pad',
    title: '月面软着陆信标坪（八角起降坪 + 助航信标灯 + H 靶标）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -7 -16 L 7 -16 L 16 -7 L 16 7 L 7 16 L -7 16 L -16 7 L -16 -7 Z',
      'M -5 -7 L -5 7 M 5 -7 L 5 7 M -5 0 L 5 0',
    ],
    accentPaths: [
      'M -12 -12 L -9 -9 M 12 -12 L 9 -9 M -12 12 L -9 9 M 12 12 L 9 9',
    ],
    accentColor: '#38bdf8',
  },

  ln_solar_peak: {
    id: 'ln_solar_peak',
    title: '环形山永昼峰太阳翼塔（高耸桁架塔 + 双层追日光伏板）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -8 16 L 0 -16 L 8 16 M -14 16 L 14 16',
      'M -16 -12 L 16 -12 L 16 -6 L -16 -6 Z',
      'M -14 -2 L 14 -2 L 14 4 L -14 4 Z',
    ],
    accentPaths: [
      'M -8 -12 L -8 -6 M 8 -12 L 8 -6 M -7 -2 L -7 4 M 7 -2 L 7 4',
    ],
    accentColor: '#fbbf24',
  },

  ln_fission_plant: {
    id: 'ln_fission_plant',
    title: '月表核裂变电站（反应堆安全壳穹顶 + 翼式辐射散热塔）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -9 14 L -9 0 C -9 -10 9 -10 9 0 L 9 14 Z',
      'M -18 -6 L -9 -2 L -9 10 L -18 12 Z',
      'M 18 -6 L 9 -2 L 9 10 L 18 12 Z',
      'M -16 14 L 16 14',
    ],
    accentPaths: [
      'M 0 -2 L -4 4 L 4 4 Z',
      'M 0 -12 L 0 -17',
    ],
    accentColor: '#f59e0b',
  },

  ln_bio_dome: {
    id: 'ln_bio_dome',
    title: '闭环生态农业温室（半透明蜂窝植物穹顶 + 水气循环管）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -16 12 C -16 -10 16 -10 16 12 Z',
      'M -18 12 L 18 12',
      'M -8 12 L -4 -2 L 4 -2 L 8 12',
      'M -12 5 L 12 5',
    ],
    accentPaths: [
      'M 0 10 L 0 1 M -4 6 L 0 2 L 4 6',
    ],
    accentColor: '#34d399',
  },

  ln_rover_bay: {
    id: 'ln_rover_bay',
    title: '月面探测车与机娘整备车库（车库门 + 六轮月球勘探车）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -16 12 L -16 -6 L -8 -13 L 8 -13 L 16 -6 L 16 12 Z',
      'M -10 4 L 10 4 L 12 9 L -12 9 Z',
      'M -9 12 L -7 12 M -1 12 L 1 12 M 7 12 L 9 12',
    ],
    accentPaths: [
      'M -6 4 L -6 -3 L 2 -3 M -8 -5 L -4 -5',
      'M -19 14 L 19 14',
    ],
    accentColor: '#38bdf8',
  },

  ln_ice_electrolysis: {
    id: 'ln_ice_electrolysis',
    title: '极地水冰钻探电解站（深井钻塔 + 氢氧分离储罐）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -14 12 L -8 -15 L -2 12',
      'M -11 -2 L -5 -2 M -8 -15 L -8 18',
      'M 3 -4 L 15 -4 L 15 12 L 3 12 Z',
      'M -18 12 L 18 12',
    ],
    accentPaths: [
      'M 6 -8 L 12 -8 L 12 -4 M 5 2 L 13 2 M 5 7 L 13 7',
    ],
    accentColor: '#22d3ee',
  },

  ln_he3_refinery: {
    id: 'ln_he3_refinery',
    title: '月壤氦-3同位素分离厂（回转煅烧炉 + 同位素分馏塔）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -16 2 L 2 2 L 2 12 L -16 12 Z',
      'M 5 -14 L 14 -14 L 14 12 L 5 12 Z',
      'M -12 2 L -12 -8 L -4 -8 L -4 2',
      'M -18 12 L 18 12',
    ],
    accentPaths: [
      'M 7 -8 L 12 -8 M 7 -2 L 12 -2 M 7 4 L 12 4',
      'M -12 7 L -2 7',
    ],
    accentColor: '#a855f7',
  },

  ln_mass_driver: {
    id: 'ln_mass_driver',
    title: '月表电磁质量投射器（超长直线电磁加速导轨 + 脉冲电容阵）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -18 12 L 14 -12 M -14 16 L 18 -8',
      'M -14 9 L -10 13 M -6 3 L -2 7 M 2 -3 L 6 1 M 10 -9 L 14 -5',
      'M -18 14 L -6 14 L -6 18 L -18 18 Z',
    ],
    accentPaths: [
      'M 13 -14 L 20 -14 L 20 -7',
    ],
    accentColor: '#f97316',
  },

  // 额外兼容：月壤钛铁原位冶炼厂 & 月背超长波深空射电阵
  ln_smelter: {
    id: 'ln_smelter',
    title: '月壤钛铁原位冶炼厂（高温电弧炉 + 锭模线）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -14 -6 L 4 -6 L 6 12 L -16 12 Z',
      'M 8 -14 L 14 -14 L 14 12 L 8 12 Z',
    ],
    accentPaths: ['M -9 2 L -1 2 M -9 7 L -1 7'],
    accentColor: '#f59e0b',
  },

  ln_deep_array: {
    id: 'ln_deep_array',
    title: '月背超长波深空射电与防天激光阵',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -16 4 C -10 -12 10 -12 16 4',
      'M -6 4 L 0 14 L 6 4 M -14 14 L 14 14',
      'M 0 2 L 0 -14',
    ],
    accentPaths: ['M -4 -10 L 0 -16 L 4 -10'],
    accentColor: '#38bdf8',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 🚀 四、地面与母港发射中心及航天城小巨构图元（14 枚）
  // ═══════════════════════════════════════════════════════════════════════════
  lc_pad_std: {
    id: 'lc_pad_std',
    title: '1# 标准常温起竖发射工位（发射台基座 + 脐带勤务塔 + 垂直箭体）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -18 14 L 18 14 L 15 18 L -15 18 Z',
      'M -12 14 L -12 -14 L -6 -14 L -6 14',
      'M -12 -6 L -6 0 M -12 2 L -6 8',
      'M 3 14 L 3 -8 L 6 -15 L 9 -8 L 9 14 Z',
    ],
    accentPaths: [
      'M -6 -9 L 3 -9 M -6 -2 L 3 -2 M -6 5 L 3 5',
      'M 6 -15 L 6 -19',
    ],
    accentColor: '#38bdf8',
  },

  lc_hif_horiz: {
    id: 'lc_hif_horiz',
    title: '水平分段总装测试厂房（大跨度卧式总装车间 + 卧姿箭体吊装轨）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -18 12 L -18 -6 L -10 -12 L 10 -12 L 18 -6 L 18 12 Z',
      'M -20 12 L 20 12',
      'M -12 2 L 8 2 L 13 5 L 8 8 L -12 8 Z',
    ],
    accentPaths: [
      'M -14 -5 L 14 -5 M -6 -5 L -6 2 M 4 -5 L 4 2',
    ],
    accentColor: '#38bdf8',
  },

  lc_vab_vertical: {
    id: 'lc_vab_vertical',
    title: '垂直总装测试厂房 VAB（百米级高层方体巨型厂房 + 垂直高门 + 桥式天车）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -15 16 L -15 -15 L 15 -15 L 15 16 Z',
      'M -19 16 L 19 16',
      'M -5 16 L -5 -10 L 5 -10 L 5 16',
      'M -15 -5 L -5 -5 M 5 -5 L 15 -5 M -15 5 L -5 5 M 5 5 L 15 5',
    ],
    accentPaths: [
      'M 0 -15 L 0 -20 M -6 -18 L 6 -18',
      'M -2 12 L -2 -6 L 0 -9 L 2 -6 L 2 12',
    ],
    accentColor: '#c084fc',
  },

  lc_prop_depot: {
    id: 'lc_prop_depot',
    title: '推进剂储罐与加注区（双联高压球罐群 + 防爆围堰与加注管廊）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -18 14 L 18 14',
      'M -14 0 C -14 -8 -2 -8 -2 0 C -2 8 -14 8 -14 0 Z',
      'M 2 0 C 2 -8 14 -8 14 0 C 14 8 2 8 2 0 Z',
      'M -11 6 L -13 14 M -5 6 L -3 14 M 5 6 L 3 14 M 11 6 L 13 14',
    ],
    accentPaths: [
      'M -8 -6 L -8 -12 L 8 -12 L 8 -6',
      'M -2 0 L 2 0',
    ],
    accentColor: '#34d399',
  },

  lc_sat_mfg_center: {
    id: 'lc_sat_mfg_center',
    title: '卫星制造中心（百级超净光学大厅 + 相控阵微波暗室 + 遥测抛物面）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -17 14 L -17 -2 L -7 -10 L 7 -10 L 17 -2 L 17 14 Z',
      'M -19 14 L 19 14',
      'M -3 1 L 3 1 L 3 9 L -3 9 Z',
      'M -11 3 L -3 3 L -3 7 L -11 7 Z M 3 3 L 11 3 L 11 7 L 3 7 Z',
    ],
    accentPaths: [
      'M -8 -14 C -4 -19 4 -19 8 -14',
      'M 0 -10 L 0 -17',
    ],
    accentColor: '#22d3ee',
  },

  lc_pad_cryo: {
    id: 'lc_pad_cryo',
    title: '2# 低温重型脐带发射塔架（双侧勤务回转塔 + 多级深冷摆杆 + 导流深槽）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -19 13 L 19 13 L 14 18 L -14 18 Z',
      'M -15 13 L -15 -14 L -10 -14 L -10 13',
      'M 10 13 L 10 -12 L 15 -12 L 15 13',
      'M -3 13 L -3 -10 L 0 -17 L 3 -10 L 3 13 Z',
      'M -6 13 L -6 4 L -3 4 M 6 13 L 6 4 L 3 4',
    ],
    accentPaths: [
      'M -10 -8 L -3 -8 M -10 -1 L -3 -1 M 10 -5 L 3 -5',
      'M -6 18 L -10 21 M 6 18 L 10 21',
    ],
    accentColor: '#38bdf8',
  },

  lc_crawler_std: {
    id: 'lc_crawler_std',
    title: '重型双轨履带转运车与导流枢纽（四履带重载底盘 + 活动发射平台 MLP）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -18 4 L 18 4 L 16 10 L -16 10 Z',
      'M -17 10 L -7 10 L -5 15 L -19 15 Z',
      'M 5 10 L 17 10 L 19 15 L 7 15 Z',
      'M -10 4 L -10 -12 L -5 -12 L -5 4',
      'M 2 4 L 2 -8 L 5 -14 L 8 -8 L 8 4',
    ],
    accentPaths: [
      'M -20 18 L 20 18',
      'M -5 -6 L 2 -6 M -5 0 L 2 0',
    ],
    accentColor: '#fbbf24',
  },

  lc_crawler_super_base: {
    id: 'lc_crawler_super_base',
    title: '超重型双轨转运与航天城流水线基座（双层万吨履带矩阵 + 地下脉动管廊枢纽）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -19 2 L 19 2 L 17 9 L -17 9 Z',
      'M -19 9 L -6 9 L -4 15 L -20 15 Z',
      'M 4 9 L 19 9 L 20 15 L 6 15 Z',
      'M -13 2 L -13 -13 L -7 -13 L -7 2',
      'M 0 2 L 0 -11 L 4 -17 L 8 -11 L 8 2',
    ],
    accentPaths: [
      'M -21 18 L 21 18 M -16 21 L 16 21',
      'M -7 -9 L 0 -9 M -7 -3 L 0 -3 M 13 -6 L 19 -6',
    ],
    accentColor: '#c084fc',
  },

  lc_lz_recovery: {
    id: 'lc_lz_recovery',
    title: '助推器垂直回收着陆坪 / 海上船坞（八角着陆靶圈 + 着陆支腿箭体 + 制导信标）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -16 10 L 16 10 L 19 16 L -19 16 Z',
      'M -3 -12 L 3 -12 L 3 6 L -3 6 Z',
      'M -3 2 L -10 10 M 3 2 L 10 10',
      'M -6 -12 L -3 -9 M 6 -12 L 3 -9',
    ],
    accentPaths: [
      'M -2 6 L 0 12 L 2 6',
      'M -13 13 L -6 13 M 6 13 L 13 13',
    ],
    accentColor: '#34d399',
  },

  lc_weather_laser_tower: {
    id: 'lc_weather_laser_tower',
    title: '全天候防雷与深空测控阵（高耸激光引雷尖塔 + 大口径深空抛物面天线）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -18 15 L 18 15',
      'M -13 15 L -9 -12 L -5 15',
      'M -11 4 L -7 4 M -9 -12 L -9 -19',
      'M 1 4 C 5 -6 15 -6 17 4',
      'M 6 4 L 9 15 L 12 4',
    ],
    accentPaths: [
      'M -9 -19 L -13 -15 M -9 -19 L -5 -15',
      'M 9 0 L 13 -8',
    ],
    accentColor: '#22d3ee',
  },

  lc_mechazilla_tower: {
    id: 'lc_mechazilla_tower',
    title: '3# 百米级超重型机械臂捕获塔架 Mechazilla（百米巨塔 + 筷子捕获双臂 + 超重型星舰）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -19 15 L 19 15',
      'M -15 15 L -15 -18 L -8 -18 L -8 15',
      'M -15 -10 L -8 -3 L -15 4 L -8 11',
      'M -8 -6 L 12 -6 M -8 -2 L 12 -2',
      'M 2 15 L 2 -11 L 5 -18 L 8 -11 L 8 15 Z',
    ],
    accentPaths: [
      'M 0 -6 L 0 -2 M 10 -6 L 10 -2',
      'M -12 -18 L -12 -21 M 5 -18 L 5 -21',
    ],
    accentColor: '#f59e0b',
  },

  lc_rocket_mega_fab: {
    id: 'lc_rocket_mega_fab',
    title: '火箭制造厂·地下洞库旋压总厂（地下装甲洞库拱顶 + 数控旋压巨筒 + 发动机试车喷口）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -19 14 C -19 -14 19 -14 19 14 Z',
      'M -21 14 L 21 14',
      'M -12 2 L 6 2 L 6 10 L -12 10 Z',
      'M 6 3 L 13 0 L 13 12 L 6 9',
    ],
    accentPaths: [
      'M -8 2 L -8 10 M -2 2 L -2 10',
      'M 13 6 L 18 4 M 13 6 L 18 8',
    ],
    accentColor: '#f97316',
  },

  lc_spacecraft_ait_hall: {
    id: 'lc_spacecraft_ait_hall',
    title: '大型航天器与空间站舱段总装中心（高大无尘联调厅 + 热真空模拟巨罐 + 飞船总成）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -18 15 L -18 -10 L -10 -15 L 10 -15 L 18 -10 L 18 15 Z',
      'M -20 15 L 20 15',
      'M -11 12 L -11 -3 C -11 -9 -1 -9 -1 -3 L -1 12 Z',
      'M 3 12 L 6 -2 L 12 -2 L 15 12 Z',
    ],
    accentPaths: [
      'M -14 -8 L 14 -8',
      'M -8 2 L -4 2 M -8 7 L -4 7 M 6 5 L 12 5',
    ],
    accentColor: '#a855f7',
  },

  lc_cryo_methalox_plant: {
    id: 'lc_cryo_methalox_plant',
    title: '深冷液氧甲烷原位合成化工厂（深冷空分精馏高塔 + 萨巴蒂尔反应器 + 保温管网）',
    viewBox: '-24 -24 48 48',
    paths: [
      'M -19 15 L 19 15',
      'M -15 15 L -15 -14 L -7 -14 L -7 15 Z',
      'M -3 15 L -3 -8 L 4 -8 L 4 15 Z',
      'M 7 6 C 7 0 17 0 17 6 C 17 12 7 12 7 6 Z',
    ],
    accentPaths: [
      'M -13 -8 L -9 -8 M -13 -2 L -9 -2 M -13 4 L -9 4',
      'M -7 -4 L -3 -4 M 4 6 L 7 6',
    ],
    accentColor: '#38bdf8',
  },
};

/**
 * 常见别名映射表（覆盖可能的不同 svgSymbolId 写法）
 */
const SYMBOL_ALIAS_MAP: Record<string, string> = {
  // 空间站
  core: 'st_core',
  station_core: 'st_core',
  node_hub: 'st_node_hub',
  hub: 'st_node_hub',
  heavy_truss: 'st_heavy_truss',
  truss: 'st_heavy_truss',
  hab: 'st_hab',
  lab: 'st_lab',
  solar: 'st_solar',
  reactor: 'st_reactor',
  radiator_ep: 'st_radiator_ep',
  radiator: 'st_radiator_ep',
  fuel_depot: 'st_fuel_depot',
  recon_array: 'st_recon_array',
  kinetic_rod: 'st_kinetic_rod',
  orbital_dock: 'st_orbital_dock',
  ship_hub: 'st_ship_hub',
  // 星座卫星
  opt_recon: 'sat_opt_recon',
  sar_radar: 'sat_sar_radar',
  geo_survey: 'sat_geo_survey',
  comm_relay: 'sat_comm_relay',
  nav_timing: 'sat_nav_timing',
  early_warn: 'sat_early_warn',
  // 月球基地
  lunar_core: 'ln_core',
  tunnel_hub: 'ln_tunnel_hub',
  landing_pad: 'ln_landing_pad',
  solar_peak: 'ln_solar_peak',
  fission_plant: 'ln_fission_plant',
  bio_dome: 'ln_bio_dome',
  rover_bay: 'ln_rover_bay',
  ice_electrolysis: 'ln_ice_electrolysis',
  he3_refinery: 'ln_he3_refinery',
  mass_driver: 'ln_mass_driver',
  // 地面与母港发射中心
  pad_std: 'lc_pad_std',
  hif_horiz: 'lc_hif_horiz',
  vab_vertical: 'lc_vab_vertical',
  prop_depot: 'lc_prop_depot',
  sat_mfg_center: 'lc_sat_mfg_center',
  pad_cryo: 'lc_pad_cryo',
  crawler_std: 'lc_crawler_std',
  crawler_super_base: 'lc_crawler_super_base',
  lz_recovery: 'lc_lz_recovery',
  weather_laser_tower: 'lc_weather_laser_tower',
  mechazilla_tower: 'lc_mechazilla_tower',
  rocket_mega_fab: 'lc_rocket_mega_fab',
  spacecraft_ait_hall: 'lc_spacecraft_ait_hall',
  cryo_methalox_plant: 'lc_cryo_methalox_plant',
};

/**
 * 通用兜底天基构件图元（供未显式注册 path 的未来自定义资产使用）
 */
export const DEFAULT_FALLBACK_SVG_SYMBOL: SpaceSvgSymbolDef = {
  id: 'generic_space_module',
  title: '标准天基工程模块',
  viewBox: '-24 -24 48 48',
  paths: [
    'M -12 -12 L 12 -12 L 16 0 L 12 12 L -12 12 L -16 0 Z',
    'M -7 -7 L 7 -7 L 7 7 L -7 7 Z',
  ],
  accentPaths: ['M -18 0 L -16 0 M 16 0 L 18 0 M 0 -16 L 0 -12 M 0 12 L 0 16'],
  accentColor: '#38bdf8',
};

/**
 * 动态注册或覆写自定义 SVG 图元（供未来 DLC / 世界书扩展资产调用）
 */
export function registerCustomSvgSymbol(
  symbolId: string,
  paths: string[],
  options?: { title?: string; accentPaths?: string[]; accentColor?: string; viewBox?: string },
): SpaceSvgSymbolDef {
  const cleanId = symbolId.trim();
  const normalized = normalizeSvgSymbolKey(cleanId);
  const def: SpaceSvgSymbolDef = {
    id: cleanId,
    title: options?.title ?? cleanId,
    viewBox: options?.viewBox ?? '-24 -24 48 48',
    paths: Array.isArray(paths) && paths.length > 0 ? [...paths] : [...DEFAULT_FALLBACK_SVG_SYMBOL.paths],
    accentPaths: options?.accentPaths ? [...options.accentPaths] : undefined,
    accentColor: options?.accentColor ?? '#38bdf8',
  };
  CUSTOM_SYMBOL_REGISTRY.set(cleanId, def);
  if (normalized) {
    CUSTOM_SYMBOL_REGISTRY.set(normalized, def);
  }
  return def;
}

/**
 * 清空动态注册的自定义 SVG 图元（主要供单测隔离使用）
 */
export function clearCustomSvgSymbols(): void {
  CUSTOM_SYMBOL_REGISTRY.clear();
}

/**
 * 根据 svgSymbolId 或备选 assetId 解析对应的 SVG 图元配置，始终返回合法图元（带通用 fallback）
 */
export function getSvgSymbolDef(symbolId?: string | null, fallbackAssetId?: string | null): SpaceSvgSymbolDef {
  const candidates = [symbolId, fallbackAssetId].filter((x): x is string => Boolean(x && x.trim()));
  for (const raw of candidates) {
    const trimmed = raw.trim();
    const customDirect = CUSTOM_SYMBOL_REGISTRY.get(trimmed);
    if (customDirect) return customDirect;

    const norm = normalizeSvgSymbolKey(trimmed);
    const customNorm = CUSTOM_SYMBOL_REGISTRY.get(norm);
    if (customNorm) return customNorm;

    if (BUILTIN_SPACE_SVG_SYMBOLS[trimmed]) {
      return BUILTIN_SPACE_SVG_SYMBOLS[trimmed];
    }
    if (BUILTIN_SPACE_SVG_SYMBOLS[norm]) {
      return BUILTIN_SPACE_SVG_SYMBOLS[norm];
    }
    const aliased = SYMBOL_ALIAS_MAP[norm];
    if (aliased && BUILTIN_SPACE_SVG_SYMBOLS[aliased]) {
      return BUILTIN_SPACE_SVG_SYMBOLS[aliased];
    }
  }
  return DEFAULT_FALLBACK_SVG_SYMBOL;
}

export const getSpaceSvgSymbolById = getSvgSymbolDef;

/**
 * 便捷获取图元的主路径数组（paths + accentPaths）
 */
export function getSvgSymbolPaths(symbolId?: string | null, fallbackAssetId?: string | null): string[] {
  const def = getSvgSymbolDef(symbolId, fallbackAssetId);
  return [...def.paths, ...(def.accentPaths ?? [])];
}
