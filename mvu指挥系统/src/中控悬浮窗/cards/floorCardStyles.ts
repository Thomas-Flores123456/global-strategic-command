/**
 * floorCardStyles.ts —— 楼层内嵌战术卷宗卡片样式表（方案 C：机密钢印电报 / MCC 发射遥测屏骨架 + EVA 锐角准星与方形 LED 矩阵）
 */

const injectedStyleMap = new WeakMap<object, Set<string>>();

export function ensureCardStyleInDoc(doc: Document, styleId: string, cssText: string): void {
  let docSet = injectedStyleMap.get(doc);
  if (!docSet) {
    docSet = new Set<string>();
    injectedStyleMap.set(doc, docSet);
  }
  const existing =
    typeof doc.getElementById === 'function'
      ? doc.getElementById(styleId)
      : (doc.querySelector?.(`#${styleId}`) ?? null);
  if (existing) {
    if (docSet.has(styleId)) {
      return;
    }
    if (existing.textContent !== cssText) {
      existing.textContent = cssText;
    }
    docSet.add(styleId);
    return;
  }

  const styleEl = doc.createElement('style');
  styleEl.id = styleId;
  styleEl.setAttribute?.('id', styleId);
  styleEl.textContent = cssText;
  const target = (doc as unknown as { head?: HTMLElement }).head ?? doc.body ?? doc.documentElement;
  if (target && typeof target.appendChild === 'function') {
    target.appendChild(styleEl);
    docSet.add(styleId);
  }
}

export const FACTION_AND_SPACE_CARD_CSS = `
/* ═══ 宿主阵营终端色全局联动默认令牌（单卡特定阵营内联 --card-* 仍可覆盖） ═══ */
:root, html, body, html[data-ra-theme='allied'], body[data-ra-theme='allied'] {
  --tw-theme-accent: var(--rac-accent, #38bdf8);
  --tw-theme-primary: var(--rac-primary, #2563eb);
  --tw-theme-bg: var(--rac-bg, #070c15);
  --tw-theme-panel: var(--rac-panel-bg, #0b1324);
  --tw-theme-border: var(--rac-border, rgba(56, 189, 248, 0.22));
}
html[data-ra-theme='soviet'], body[data-ra-theme='soviet'] {
  --tw-theme-accent: var(--rac-accent, #e25555);
  --tw-theme-primary: var(--rac-primary, #b91c1c);
  --tw-theme-bg: var(--rac-bg, #12080a);
  --tw-theme-panel: var(--rac-panel-bg, #1a0b0e);
  --tw-theme-border: var(--rac-border, rgba(226, 85, 85, 0.26));
}
html[data-ra-theme='yuri'], body[data-ra-theme='yuri'] {
  --tw-theme-accent: var(--rac-accent, #b892e5);
  --tw-theme-primary: var(--rac-primary, #7e22ce);
  --tw-theme-bg: var(--rac-bg, #0f0918);
  --tw-theme-panel: var(--rac-panel-bg, #150d20);
  --tw-theme-border: var(--rac-border, rgba(184, 146, 229, 0.26));
}

/* 覆盖楼层宿主容器的历史硬编码内联蓝边与深蓝底 */
.tw-floor-card-host,
.custom-tw-floor-card-host {
  background: var(--tw-theme-bg, #070c15) !important;
  border-color: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 22%, transparent) !important;
  transition: background-color 180ms ease, border-color 180ms ease;
}

/* ═══ 方案 C：机密钢印电报 + EVA 锐角准星 ═══ */
.tw-faction-unlock-card {
  position: relative;
  background-color: color-mix(in srgb, var(--card-bg, var(--tw-theme-bg, #0b1324)) 45%, var(--rac-bg, #070d18));
  background-image:
    repeating-linear-gradient(
      0deg,
      rgba(255, 255, 255, 0.01) 0px,
      rgba(255, 255, 255, 0.01) 1px,
      transparent 1px,
      transparent 3px
    );
  border: 1px solid color-mix(in srgb, var(--card-primary, var(--tw-theme-primary, #2563eb)) 28%, rgba(30, 41, 59, 0.85));
  border-left: 3px solid color-mix(in srgb, var(--card-accent, var(--tw-theme-accent, #38bdf8)) 65%, #0f172a);
  border-radius: 0;
  color: #cbd5e1;
  font-family: 'JetBrains Mono', 'Share Tech Mono', 'Noto Sans SC', 'Microsoft YaHei', monospace;
  padding: 0;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.48);
  overflow: hidden;
}

/* 顶部斜切防伪警戒导轨（暗蓝低眩光） */
.tw-faction-unlock-card::before {
  content: '';
  display: block;
  height: 3px;
  width: 100%;
  background: repeating-linear-gradient(
    -45deg,
    color-mix(in srgb, var(--card-primary, #2563eb) 38%, #070d18),
    color-mix(in srgb, var(--card-primary, #2563eb) 38%, #070d18) 8px,
    color-mix(in srgb, var(--card-accent, #38bdf8) 32%, #070d18) 8px,
    color-mix(in srgb, var(--card-accent, #38bdf8) 32%, #070d18) 12px,
    rgba(6, 11, 20, 0.92) 12px,
    rgba(6, 11, 20, 0.92) 18px
  );
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
}

/* 右下角 EVA 准星刻度装饰 */
.tw-faction-unlock-card::after {
  content: 'SYS.DOSSIER // VERIFIED';
  position: absolute;
  right: 10px;
  bottom: 4px;
  font-size: 9px;
  letter-spacing: 0.16em;
  color: rgba(148, 163, 184, 0.38);
  pointer-events: none;
}

.tw-faction-telemetry-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 14px;
  background: rgba(0, 0, 0, 0.48);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  color: #94a3b8;
  text-transform: uppercase;
}

.tw-faction-telemetry-strip span:last-child {
  color: var(--card-accent, #38bdf8);
  font-weight: 700;
}

.tw-faction-unlock-header {
  position: relative;
  padding: 14px 16px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.14);
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.03) 0%, transparent 75%);
}

.tw-faction-unlock-badge-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.tw-faction-unlock-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  background: color-mix(in srgb, var(--card-primary, #2563eb) 18%, rgba(8, 14, 26, 0.95));
  color: color-mix(in srgb, var(--card-accent, #38bdf8) 82%, #cbd5e1);
  border: 1px solid color-mix(in srgb, var(--card-accent, #38bdf8) 36%, transparent);
  border-radius: 0;
  text-transform: uppercase;
}

/* 右上角倾斜双线机密钢印戳记 */
.tw-faction-unlock-emblem {
  display: inline-block;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 900;
  color: var(--card-accent, #38bdf8);
  letter-spacing: 0.14em;
  border: 2px solid var(--card-accent, #38bdf8);
  outline: 1px solid rgba(255, 255, 255, 0.18);
  outline-offset: 2px;
  background: rgba(0, 0, 0, 0.42);
  transform: rotate(-2.5deg);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
  text-transform: uppercase;
}

.tw-faction-unlock-title {
  margin: 0 0 5px;
  font-size: 18px;
  font-weight: 900;
  letter-spacing: 0.06em;
  color: #f8fafc;
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.8);
}

.tw-faction-unlock-subtitle {
  margin: 0;
  font-size: 11.5px;
  letter-spacing: 0.04em;
  color: var(--card-accent, #38bdf8);
  opacity: 0.9;
}

/* 首发 MCV 机娘核心锚定槽 */
.tw-starter-girl-card {
  position: relative;
  margin: 12px 16px;
  background: rgba(0, 0, 0, 0.42);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-left: 3px solid var(--card-accent, #38bdf8);
  border-radius: 0;
  padding: 0;
}

.tw-starter-girl-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 12px;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.tw-starter-girl-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 700;
  color: var(--card-accent, #38bdf8);
  letter-spacing: 0.12em;
  margin: 0;
}

.tw-starter-girl-tag::before {
  content: '■';
  font-size: 8px;
  color: var(--card-primary, #2563eb);
}

.tw-starter-girl-identity {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}

.tw-starter-girl-name {
  font-size: 13.5px;
  font-weight: 800;
  letter-spacing: 0.05em;
  color: #ffffff;
  background: var(--card-primary, #2563eb);
  padding: 1px 8px;
  border: 1px solid rgba(255, 255, 255, 0.25);
}

.tw-starter-girl-model {
  font-size: 11px;
  color: #cbd5e1;
  background: rgba(0, 0, 0, 0.45);
  padding: 1px 7px;
  border: 1px solid rgba(255, 255, 255, 0.14);
}

.tw-starter-girl-quote {
  position: relative;
  margin: 0;
  padding: 9px 12px 9px 26px;
  font-size: 12px;
  font-style: normal;
  line-height: 1.55;
  color: #e2e8f0;
  background: rgba(0, 0, 0, 0.28);
}

.tw-starter-girl-quote::before {
  content: '»';
  position: absolute;
  left: 10px;
  top: 7px;
  font-size: 14px;
  font-weight: 900;
  color: var(--card-accent, #38bdf8);
}

/* 阵营工业与并网详情电传表 */
.tw-faction-details-section {
  margin: 0 16px 12px;
}

.tw-faction-details-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 12px;
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--card-accent, #38bdf8);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-left: 3px solid var(--card-primary, #2563eb);
  border-radius: 0;
  cursor: pointer;
  transition: background 120ms ease;
}

.tw-faction-details-toggle:hover {
  background: rgba(255, 255, 255, 0.09);
}

.tw-faction-details-toggle-title::before {
  content: '[GRID] ';
  opacity: 0.7;
  font-size: 10px;
}

.tw-faction-details-toggle-indicator {
  font-size: 10.5px;
  padding: 1px 6px;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: #f8fafc;
}

.tw-faction-details-panel {
  margin-top: -1px;
  padding: 0;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 0;
}

.tw-faction-details-list {
  margin: 0;
  display: grid;
  gap: 1px;
  background: rgba(255, 255, 255, 0.12);
}

.tw-faction-details-item {
  display: grid;
  grid-template-columns: minmax(120px, 165px) 1fr;
  align-items: stretch;
  font-size: 11.5px;
  background: rgba(8, 12, 20, 0.92);
}

.tw-faction-details-label {
  padding: 6px 10px;
  color: var(--card-accent, #38bdf8);
  font-weight: 700;
  background: rgba(255, 255, 255, 0.04);
  border-right: 1px solid rgba(255, 255, 255, 0.12);
  display: flex;
  align-items: center;
}

.tw-faction-details-value {
  margin: 0;
  padding: 6px 12px;
  color: #f1f5f9;
  text-align: left;
  font-family: inherit;
  display: flex;
  align-items: center;
}

/* 初始战区授权回执方形 LED 矩阵 */
.tw-initial-grants-section {
  padding: 10px 16px 14px;
  background: rgba(0, 0, 0, 0.34);
  border-top: 1px solid rgba(255, 255, 255, 0.14);
}

.tw-initial-grants-header {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.12em;
  color: #4ade80;
  margin-bottom: 8px;
  text-transform: uppercase;
}

.tw-grant-led {
  display: inline-block;
  width: 7px;
  height: 7px;
  background: #22c55e;
  box-shadow: 0 0 8px #22c55e;
  color: transparent;
  font-size: 0;
}

.tw-initial-grants-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 6px;
}

.tw-initial-grant-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 11.5px;
  color: #e2e8f0;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(74, 222, 128, 0.28);
  border-left: 3px solid #22c55e;
  border-radius: 0;
}

/* 将原先的 Emoji 圆点转为硬核方形军工 LED 块 */
.tw-grant-item-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  background: #4ade80;
  box-shadow: 0 0 6px rgba(74, 222, 128, 0.85);
  font-size: 0;
  line-height: 0;
  color: transparent;
  overflow: hidden;
}

.tw-grant-item-text::before {
  content: 'AUTH // ';
  font-size: 9.5px;
  font-weight: 700;
  color: #4ade80;
  letter-spacing: 0.06em;
}

/* ═══ 方案 C：MCC 航天发射控制中心遥测终端（随阵营终端色实时联动） ═══ */
.tw-space-contract-card {
  position: relative;
  background-color: var(--tw-theme-bg, #060b15);
  background-image:
    linear-gradient(color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 4%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 4%, transparent) 1px, transparent 1px);
  background-size: 18px 18px;
  border: 1px solid color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 26%, transparent);
  border-left: 3px solid color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 65%, #0f172a);
  border-radius: 0;
  color: #cbd5e1;
  font-family: 'JetBrains Mono', 'Share Tech Mono', 'Noto Sans SC', 'Microsoft YaHei', monospace;
  padding: 0;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.48);
  overflow: hidden;
}

.tw-space-contract-card::before {
  content: 'MCC FLIGHT TELEMETRY // ORBITAL DISPATCH TERMINAL';
  display: block;
  padding: 4px 14px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 82%, #e2e8f0);
  background: color-mix(in srgb, var(--tw-theme-bg, #040912) 85%, #000000);
  border-bottom: 1px solid color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 18%, transparent);
}

.tw-space-contract-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: color-mix(in srgb, var(--tw-theme-panel, #0a111e) 82%, #050811);
  border-bottom: 1px solid color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 18%, transparent);
  margin: 0;
}

.tw-space-contract-id {
  display: inline-block;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  background: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 16%, transparent);
  color: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 85%, #ffffff);
  border: 1px solid color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 38%, transparent);
  border-radius: 0;
}

.tw-space-contract-title {
  margin: 0;
  flex: 1 1 220px;
  font-size: 15px;
  font-weight: 900;
  letter-spacing: 0.04em;
  color: #f8fafc;
}

.tw-space-contract-kind {
  padding: 3px 9px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 85%, #ffffff);
  background: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 40%, transparent);
  border-radius: 0;
}

.tw-space-contract-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #4ade80;
  background: rgba(22, 163, 74, 0.16);
  border: 1px solid rgba(74, 222, 128, 0.55);
  border-radius: 0;
  text-transform: uppercase;
}

.tw-space-contract-status::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  background: #4ade80;
  box-shadow: 0 0 6px #4ade80;
}

.tw-space-contract-card.has-weather-hold .tw-space-contract-status {
  color: #fbbf24;
  background: rgba(217, 119, 6, 0.18);
  border-color: rgba(251, 191, 36, 0.6);
}

.tw-space-contract-card.has-weather-hold .tw-space-contract-status::before {
  background: #f59e0b;
  box-shadow: 0 0 6px #f59e0b;
}

/* 1px 精密相连 5 通道遥测仪表盘 */
.tw-space-contract-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
  gap: 1px;
  background: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 22%, transparent);
  margin: 0;
}

.tw-space-contract-field {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 4px;
  padding: 9px 12px;
  background: color-mix(in srgb, var(--tw-theme-panel, #070e1c) 92%, #050811);
  border: none;
  border-radius: 0;
}

.tw-space-contract-field-label,
.tw-space-contract-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #64748b;
  text-transform: uppercase;
}

.tw-space-contract-field:nth-child(1) .tw-space-contract-field-label::after { content: 'CH-01'; color: var(--tw-theme-accent, #38bdf8); opacity: 0.55; }
.tw-space-contract-field:nth-child(2) .tw-space-contract-field-label::after { content: 'CH-02'; color: var(--tw-theme-accent, #38bdf8); opacity: 0.55; }
.tw-space-contract-field:nth-child(3) .tw-space-contract-field-label::after { content: 'CH-03'; color: var(--tw-theme-accent, #38bdf8); opacity: 0.55; }
.tw-space-contract-field:nth-child(4) .tw-space-contract-field-label::after { content: 'CR-04'; color: #fbbf24; opacity: 0.75; }
.tw-space-contract-field:nth-child(5) .tw-space-contract-field-label::after { content: 'STG-1'; color: var(--tw-theme-accent, #38bdf8); opacity: 0.55; }

.tw-space-contract-field-value,
.tw-space-contract-value {
  font-size: 12.5px;
  font-weight: 700;
  line-height: 1.4;
  color: #f1f5f9;
}

.tw-space-contract-field[data-test="space-contract-reward"] .tw-space-contract-field-value,
.tw-space-contract-field[data-test="space-contract-reward"] .tw-space-contract-value {
  font-size: 15px;
  font-weight: 900;
  color: #fbbf24;
  letter-spacing: 0.04em;
}

.tw-space-contract-field[data-test="space-contract-booster"] .tw-space-contract-field-value,
.tw-space-contract-field[data-test="space-contract-booster"] .tw-space-contract-value {
  color: var(--tw-theme-accent, #38bdf8);
}

.tw-space-contract-weather,
.tw-space-contract-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 8px 14px;
  font-size: 11.5px;
  font-weight: 700;
  color: #fde68a;
  background:
    repeating-linear-gradient(
      -45deg,
      rgba(245, 158, 11, 0.16),
      rgba(245, 158, 11, 0.16) 10px,
      rgba(15, 23, 42, 0.9) 10px,
      rgba(15, 23, 42, 0.9) 20px
    );
  border-top: 1px solid rgba(251, 191, 36, 0.45);
  border-left: 4px solid #f59e0b;
  border-radius: 0;
}

.tw-space-contract-weather::before {
  content: 'METEO HOLD';
  display: inline-block;
  padding: 1px 6px;
  font-size: 9.5px;
  font-weight: 900;
  letter-spacing: 0.1em;
  color: #0f172a;
  background: #fbbf24;
  flex-shrink: 0;
}

.tw-space-contract-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 14px;
  background: color-mix(in srgb, var(--tw-theme-bg, #080f1d) 92%, #000000);
  border-top: 1px solid color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 24%, transparent);
}

.tw-space-contract-action-hint {
  font-size: 10.5px;
  color: #94a3b8;
  letter-spacing: 0.04em;
}

.tw-space-contract-dispatch-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-family: inherit;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #f8fafc;
  background: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 20%, transparent);
  border: 1px solid color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 55%, transparent);
  border-left: 3px solid var(--tw-theme-accent, #38bdf8);
  border-radius: 0;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}

.tw-space-contract-dispatch-btn:hover {
  color: #ffffff;
  background: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 34%, transparent);
  border-color: var(--tw-theme-accent, #38bdf8);
}

.tw-space-contract-dispatch-btn[data-dispatched="true"] {
  color: #86efac;
  background: rgba(22, 163, 74, 0.22);
  border-color: rgba(74, 222, 128, 0.6);
  border-left-color: #4ade80;
}
`;

export const MAIDEN_DOSSIER_STYLE_CSS = `
.tw-maiden-dossier-card {
  border: 1px solid color-mix(in srgb, var(--tw-theme-primary, var(--card-primary, #2563eb)) 28%, rgba(30, 41, 59, 0.85));
  border-left: 3px solid color-mix(in srgb, var(--tw-theme-accent, var(--card-accent, #38bdf8)) 65%, #0f172a);
  background: color-mix(in srgb, var(--tw-theme-panel, var(--card-bg, #0b1324)) 55%, var(--tw-theme-bg, #070d18));
  color: #cbd5e1;
  border-radius: 0;
  padding: 0;
  font-family: 'JetBrains Mono', 'Noto Sans SC', 'Microsoft YaHei', sans-serif;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.48);
  overflow: hidden;
  transition: background-color 180ms ease, border-color 180ms ease;
}
.tw-maiden-dossier-card > :not(.tw-compact-rack-bar) {
  margin-left: 14px;
  margin-right: 14px;
}
.tw-maiden-dossier-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
  padding: 10px 0 8px;
  margin-bottom: 10px;
}
.tw-maiden-dossier-seal {
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--tw-theme-accent, var(--card-accent, #d4a84f));
  font-weight: 800;
}
.tw-maiden-dossier-seq {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 0;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--tw-theme-accent, var(--card-accent, #d4a84f));
  color: var(--tw-theme-accent, var(--card-accent, #d4a84f));
}
.tw-maiden-dossier-identity {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
}
.tw-maiden-dossier-name {
  font-size: 19px;
  font-weight: 900;
  color: #ffffff;
}
.tw-maiden-dossier-stamp {
  font-family: ui-monospace, monospace;
  font-size: 11.5px;
  color: var(--tw-theme-accent, var(--card-accent, #d4a84f));
}
.tw-maiden-dossier-section {
  background: rgba(0, 0, 0, 0.34);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-left: 3px solid var(--tw-theme-primary, var(--card-primary, #c93b2b));
  padding: 8px 10px;
  margin-bottom: 8px;
  border-radius: 0;
}
.tw-maiden-dossier-section-title {
  font-size: 11.5px;
  font-weight: 800;
  color: var(--tw-theme-accent, var(--card-accent, #d4a84f));
  margin-bottom: 4px;
}
.tw-maiden-dossier-toggle {
  width: 100%;
  text-align: left;
  background: rgba(255, 255, 255, 0.05);
  color: var(--tw-theme-accent, var(--card-accent, #d4a84f));
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-left: 3px solid var(--tw-theme-primary, var(--card-primary, #c93b2b));
  padding: 7px 10px;
  border-radius: 0;
  cursor: pointer;
  font-size: 11.5px;
  font-weight: 700;
  margin-top: 6px;
}
.tw-maiden-dossier-details {
  margin-top: -1px;
  padding: 10px;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 0;
}
`;

export const MAIDEN_STATUS_STYLE_CSS = `
.tw-maiden-status-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--tw-theme-bg, #070d18);
  border: 1px solid color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 24%, transparent);
  border-left: 3px solid color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 62%, #0f172a);
  border-radius: 0;
  font-family: 'JetBrains Mono', 'Microsoft YaHei', sans-serif;
  overflow: hidden;
  transition: background-color 180ms ease, border-color 180ms ease;
}
.tw-maiden-status-item {
  border-radius: 0;
  padding: 10px 14px;
  background: color-mix(in srgb, var(--tw-theme-panel, #0b1324) 88%, #050811);
  border-top: 1px solid rgba(148, 163, 184, 0.12);
  color: #cbd5e1;
}
.tw-maiden-status-item.is-unchristened {
  background: linear-gradient(145deg, rgba(42, 28, 8, 0.96), rgba(24, 16, 6, 0.96));
  border: 1px solid #f59e0b;
  border-left: 4px solid #fbbf24;
  box-shadow: 0 0 16px rgba(245, 158, 11, 0.25);
}
.tw-maiden-unchristened-banner {
  background: rgba(245, 158, 11, 0.18);
  border: 1px solid rgba(251, 191, 36, 0.55);
  color: #fbbf24;
  font-size: 11.5px;
  font-weight: 800;
  padding: 6px 10px;
  border-radius: 0;
  margin-bottom: 10px;
  letter-spacing: 0.06em;
}
.tw-maiden-metric-delta {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 0;
  background: rgba(34, 197, 94, 0.2);
  border: 1px solid rgba(74, 222, 128, 0.45);
  color: #4ade80;
  font-weight: 700;
  font-size: 11px;
}
.tw-maiden-trait-chip {
  display: inline-block;
  margin-right: 6px;
  padding: 2px 7px;
  border-radius: 0;
  background: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 38%, transparent);
  color: var(--tw-theme-accent, #38bdf8);
  font-size: 11px;
}
`;
