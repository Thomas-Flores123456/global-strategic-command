/**
 * floorCardExtraMounts.ts —— 全系卡片「默认精简折叠机架导轨（Compact Rack Bar）」控制器
 * 与 7 类扩展协议标签（<图鉴>/<事件>/<工程>/<排产计划>/<扩展档案>/<数据更新>/<timePast>）方案 C 渲染器
 */
import type {
  DeploymentOrderCardPayload,
  EconomyChainsCardPayload,
  ParsedChronoStepCard,
  ParsedCodexCard,
  ParsedDataPatchCard,
  ParsedEngineeringOrderCard,
  ParsedExpansionDossierCard,
  ParsedIntelDossierCard,
  ParsedProductionScheduleCard,
  ParsedTacticalEventCard,
  ParsedTacticalIntelCard,
  ParsedTacticalOptionsCard,
  ParsedTacticalQuestCard,
  ParsedTacticalSituationCard,
  WorldEvolutionCardPayload,
} from './floorCardExtraParsers';
import {
  parseExpansionDossierPayload,
  parseTacticalIntelPayload,
  parseTacticalIntelRaw,
  parseTacticalQuestPayload,
  parseWorldEvolutionPayload,
} from './floorCardExtraParsers';
import { ensureCardStyleInDoc } from './floorCardStyles';

export interface CompactRackOptions {
  code: string;
  title: string;
  summary: string;
  accentColor?: string;
  defaultCollapsed?: boolean;
  onToggle?: () => void;
}

export const EXTRA_PROTOCOL_CARDS_CSS = `
/* ═══ 宿主阵营终端色全局联动默认令牌 ═══ */
:root, html, body, html[data-ra-theme='allied'], body[data-ra-theme='allied'] {
  --tw-theme-accent: var(--rac-accent, #38bdf8);
  --tw-theme-primary: var(--rac-primary, #2563eb);
  --tw-theme-bg: var(--rac-bg, #070c16);
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

/* ═══ 全系楼层卡片：默认精简折叠机架导轨（Compact Rack Bar · 随阵营终端色实时联动） ═══ */
.tw-card-collapsible.is-collapsed > :not(.tw-compact-rack-bar) { display: none !important; }
.tw-card-collapsible.is-collapsed::before,
.tw-card-collapsible.is-collapsed::after { display: none !important; }
.tw-compact-rack-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 6px 12px;
  background: color-mix(in srgb, var(--tw-theme-panel, #080d17) 85%, #050811);
  border-bottom: 1px solid color-mix(in srgb, var(--rack-accent, var(--tw-theme-accent, #38bdf8)) 20%, transparent);
  cursor: pointer; user-select: none;
  font-family: 'JetBrains Mono', 'Share Tech Mono', 'Noto Sans SC', 'Microsoft YaHei', monospace;
  transition: background 120ms ease, border-color 120ms ease;
}
.tw-card-collapsible.is-collapsed .tw-compact-rack-bar { border-bottom: none; }
.tw-compact-rack-bar:hover {
  background: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 12%, var(--tw-theme-panel, #0d1626));
}
.tw-compact-rack-left {
  display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 auto; overflow: hidden;
}
.tw-compact-rack-led {
  display: inline-block; width: 5px; height: 5px; flex: 0 0 5px;
  background: color-mix(in srgb, var(--rack-accent, var(--tw-theme-accent, #38bdf8)) 78%, #0f172a);
  box-shadow: 0 0 4px color-mix(in srgb, var(--rack-accent, var(--tw-theme-accent, #38bdf8)) 45%, transparent);
}
.tw-compact-rack-code {
  display: inline-block; padding: 1px 7px; font-size: 9.5px; font-weight: 800;
  letter-spacing: 0.08em;
  color: color-mix(in srgb, var(--rack-accent, var(--tw-theme-accent, #38bdf8)) 82%, #cbd5e1);
  background: color-mix(in srgb, var(--rack-accent, var(--tw-theme-accent, #38bdf8)) 13%, var(--tw-theme-bg, rgba(8, 14, 26, 0.95)));
  border: 1px solid color-mix(in srgb, var(--rack-accent, var(--tw-theme-accent, #38bdf8)) 36%, transparent);
  flex-shrink: 0; text-transform: uppercase;
}
.tw-compact-rack-title {
  font-size: 12px; font-weight: 700; color: #f1f5f9; white-space: nowrap; flex-shrink: 0;
}
.tw-compact-rack-summary {
  font-size: 11px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  min-width: 0; padding-left: 6px; border-left: 1px solid rgba(148, 163, 184, 0.18);
}
.tw-compact-rack-toggle {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px;
  font-family: inherit; font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
  color: #94a3b8;
  background: color-mix(in srgb, var(--tw-theme-bg, #0f172a) 75%, #000000);
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 0; cursor: pointer; flex-shrink: 0;
}
.tw-compact-rack-toggle:hover {
  background: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 16%, var(--tw-theme-panel, #1e293b));
  color: #f8fafc;
  border-color: color-mix(in srgb, var(--rack-accent, var(--tw-theme-accent, #38bdf8)) 45%, transparent);
}

/* ═══ 01. <timePast> 战术时钟步进横幅（随阵营终端色实时联动） ═══ */
.tw-chrono-step-card {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 5px 12px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--tw-theme-bg, #070d18) 96%, #000000) 0%, color-mix(in srgb, var(--tw-theme-panel, #0a1221) 92%, #000000) 100%);
  border: 1px solid color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 24%, transparent);
  border-left: 3px solid color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 65%, #0f172a);
  border-radius: 0;
  color: #cbd5e1; font-family: 'JetBrains Mono', 'Share Tech Mono', 'Noto Sans SC', monospace;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.38);
  transition: background 180ms ease, border-color 180ms ease;
}
.tw-chrono-step-left { display: flex; align-items: center; gap: 8px; }
.tw-chrono-step-tag {
  padding: 1px 7px; font-size: 9.5px; font-weight: 800; letter-spacing: 0.1em;
  color: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 85%, #ffffff);
  background: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 36%, transparent);
}
.tw-chrono-step-code {
  font-size: 12.5px; font-weight: 800; letter-spacing: 0.08em;
  color: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 78%, #ffffff);
}
.tw-chrono-step-label {
  font-size: 11px; font-weight: 600; color: #94a3b8; padding-left: 8px;
  border-left: 1px solid color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 24%, transparent);
}
.tw-chrono-step-ticks {
  font-size: 9.5px; letter-spacing: 0.12em;
  color: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 52%, transparent);
}

/* ═══ 02~07. 扩展协议标签通用方案 C 骨架（随阵营终端色实时联动） ═══ */
.tw-extra-protocol-card {
  position: relative;
  background-color: var(--tw-theme-bg, #070c16);
  background-image: repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.01) 0px, rgba(255, 255, 255, 0.01) 1px, transparent 1px, transparent 3px);
  border: 1px solid color-mix(in srgb, var(--rack-accent, var(--tw-theme-accent, #38bdf8)) 26%, rgba(30, 41, 59, 0.85));
  border-left: 3px solid color-mix(in srgb, var(--rack-accent, var(--tw-theme-accent, #38bdf8)) 65%, #0f172a);
  border-radius: 0; color: #cbd5e1;
  font-family: 'JetBrains Mono', 'Share Tech Mono', 'Noto Sans SC', 'Microsoft YaHei', monospace;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45); overflow: hidden;
  transition: background-color 180ms ease, border-color 180ms ease;
}
.tw-extra-telemetry-strip {
  display: flex; align-items: center; justify-content: space-between; padding: 4px 12px;
  font-size: 9px; font-weight: 700; letter-spacing: 0.14em;
  color: color-mix(in srgb, var(--rack-accent, var(--tw-theme-accent, #38bdf8)) 75%, #94a3b8);
  background: color-mix(in srgb, var(--tw-theme-bg, #040810) 85%, #000000);
  border-bottom: 1px solid rgba(148, 163, 184, 0.12); text-transform: uppercase;
}
.tw-extra-card-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 1px; background: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 14%, rgba(51, 65, 85, 0.28));
}
.tw-extra-card-slot {
  display: flex; flex-direction: column; gap: 6px; padding: 9px 12px;
  background: color-mix(in srgb, var(--tw-theme-panel, #070d18) 92%, #050811);
}
.tw-extra-slot-header {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding-bottom: 5px; border-bottom: 1px solid rgba(148, 163, 184, 0.12);
}
.tw-extra-slot-title-group { display: flex; align-items: center; gap: 7px; min-width: 0; }
.tw-extra-slot-code {
  padding: 1px 6px; font-size: 9px; font-weight: 800; letter-spacing: 0.08em;
  color: color-mix(in srgb, var(--slot-accent, var(--rack-accent, var(--tw-theme-accent, #38bdf8))) 82%, #cbd5e1);
  background: color-mix(in srgb, var(--slot-accent, var(--rack-accent, var(--tw-theme-accent, #38bdf8))) 14%, var(--tw-theme-bg, rgba(8, 15, 28, 0.95)));
  border: 1px solid color-mix(in srgb, var(--slot-accent, var(--rack-accent, var(--tw-theme-accent, #38bdf8))) 35%, transparent);
  flex-shrink: 0;
}
.tw-extra-slot-name { font-size: 12.5px; font-weight: 700; color: #f1f5f9; }
.tw-extra-slot-badge {
  padding: 1px 7px; font-size: 9.5px; font-weight: 600;
  color: #94a3b8;
  background: color-mix(in srgb, var(--tw-theme-bg, #0f172a) 75%, #000000);
  border: 1px solid rgba(148, 163, 184, 0.2); flex-shrink: 0;
}
.tw-extra-slot-summary { margin: 0; font-size: 11px; line-height: 1.5; color: #94a3b8; }
.tw-extra-kv-table {
  display: grid; gap: 1px; background: rgba(51, 65, 85, 0.3); border: 1px solid rgba(51, 65, 85, 0.45);
}
.tw-extra-kv-row {
  display: grid; grid-template-columns: minmax(90px, 130px) 1fr; font-size: 11px;
  background: color-mix(in srgb, var(--tw-theme-bg, #060b14) 94%, #000000);
}
.tw-extra-kv-key {
  padding: 4px 8px; font-weight: 600; color: #64748b;
  background: color-mix(in srgb, var(--tw-theme-panel, #0f172a) 45%, transparent);
  border-right: 1px solid rgba(51, 65, 85, 0.35);
}
.tw-extra-kv-val { padding: 4px 10px; color: #cbd5e1; }
.tw-extra-tag-row { display: flex; flex-wrap: wrap; gap: 5px; }
.tw-extra-tag-chip {
  padding: 1px 6px; font-size: 9.5px; color: #64748b;
  background: rgba(15, 23, 42, 0.55); border: 1px solid rgba(148, 163, 184, 0.18);
}
.tw-extra-tag-chip[data-reward-kind="tier-s"] {
  color: #fde047; background: rgba(161, 98, 7, 0.22); border-color: rgba(250, 204, 21, 0.45); font-weight: 700;
}
.tw-extra-tag-chip[data-reward-kind="tier-a"] {
  color: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 85%, #ffffff);
  background: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 18%, transparent);
  border-color: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 42%, transparent);
  font-weight: 700;
}
.tw-extra-tag-chip[data-reward-kind="tier-b"] {
  color: #86efac; background: rgba(20, 83, 45, 0.24); border-color: rgba(74, 222, 128, 0.38);
}
.tw-extra-tag-chip[data-reward-kind="girl"] {
  color: #f9a8d4; background: rgba(131, 24, 67, 0.22); border-color: rgba(244, 114, 182, 0.38);
}
.tw-extra-tag-chip[data-reward-kind="tech"],
.tw-extra-tag-chip[data-reward-kind="protocol"] {
  color: #c4b5fd; background: rgba(76, 29, 149, 0.22); border-color: rgba(167, 139, 250, 0.38);
}
.tw-extra-tag-chip[data-reward-kind="chain"],
.tw-extra-tag-chip[data-reward-kind="wallet"] {
  color: #fcd34d; background: rgba(120, 53, 15, 0.22); border-color: rgba(245, 158, 11, 0.38);
}
.tw-extra-tag-chip[data-reward-kind="faction"] {
  color: #67e8f9; background: rgba(22, 78, 99, 0.22); border-color: rgba(6, 182, 212, 0.38);
}
/* ═══ FD-31: <态势> 参谋席建议区块（STAFF ADVISORY） ═══ */
.tw-situation-staff-advice {
  border-top: 1px solid color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 20%, transparent);
  background: color-mix(in srgb, var(--tw-theme-bg, #050a14) 94%, #000000);
  padding: 8px 12px 10px;
  display: flex; flex-direction: column; gap: 6px;
}
.tw-situation-advice-header-bar {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 9.5px; font-weight: 800; letter-spacing: 0.12em;
  color: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 85%, #ffffff); text-transform: uppercase;
  padding-bottom: 4px; border-bottom: 1px dashed color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 22%, transparent);
}
.tw-situation-advice-list {
  display: flex; flex-direction: column; gap: 6px;
}
.tw-situation-advice-item {
  display: flex; flex-direction: column; gap: 5px;
  padding: 7px 10px;
  background: color-mix(in srgb, var(--tw-theme-panel, #0b1424) 88%, #050811);
  border: 1px solid color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 24%, transparent);
  border-left: 3px solid var(--tw-theme-accent, #38bdf8);
}
.tw-situation-advice-top {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.tw-situation-advice-badges {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
}
.tw-situation-advice-advisor {
  padding: 1px 7px; font-size: 10.5px; font-weight: 700;
  color: #fde047; background: rgba(161, 98, 7, 0.22);
  border: 1px solid rgba(250, 204, 21, 0.4);
}
.tw-situation-advice-focus {
  padding: 1px 6px; font-size: 9.5px; font-weight: 600;
  color: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 85%, #ffffff);
  background: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 36%, transparent);
}
.tw-situation-advice-adopt-btn {
  padding: 3px 9px; font-family: inherit; font-size: 10.5px; font-weight: 700;
  color: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 88%, #ffffff);
  background: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 38%, transparent); cursor: pointer;
}
.tw-situation-advice-adopt-btn:hover {
  background: color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 28%, transparent); color: #ffffff;
}
.tw-situation-advice-text {
  margin: 0; font-size: 11.5px; line-height: 1.5; color: #e2e8f0;
}
`;

export function fillChatInputBox(doc: Document, text: string): boolean {
  const parentDoc =
    typeof window !== 'undefined' && window.parent && window.parent !== window
      ? window.parent.document
      : undefined;
  const ta =
    (doc.querySelector?.('#send_textarea') as HTMLTextAreaElement | null) ??
    (parentDoc?.querySelector?.('#send_textarea') as HTMLTextAreaElement | null) ??
    (typeof document !== 'undefined'
      ? (document.querySelector?.('#send_textarea') as HTMLTextAreaElement | null)
      : null) ??
    null;
  if (!ta) return false;
  ta.value = text;
  if (typeof ta.dispatchEvent === 'function' && typeof Event === 'function') {
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (typeof ta.focus === 'function') {
    ta.focus();
  }
  return true;
}

function setCollapsedStateOnElement(
  rootEl: HTMLElement,
  toggleBtn: HTMLElement,
  collapsed: boolean,
): void {
  const baseClasses = (rootEl.className || '')
    .split(/\s+/)
    .filter(c => c && c !== 'is-collapsed' && c !== 'is-expanded' && c !== 'tw-card-collapsible');
  baseClasses.push('tw-card-collapsible');
  baseClasses.push(collapsed ? 'is-collapsed' : 'is-expanded');
  rootEl.className = baseClasses.join(' ');
  rootEl.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
  toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  toggleBtn.textContent = collapsed ? '▶ 展开卷宗' : '▴ 折叠收起';
}

/**
 * 为任意楼层卡片挂载顶部「精简折叠机架导轨（Compact Rack Bar）」，默认处于折叠态 (`is-collapsed`)。
 */
export function attachCompactRackHeader(
  doc: Document,
  rootEl: HTMLElement,
  options: CompactRackOptions,
): HTMLElement {
  ensureCardStyleInDoc(doc, 'tw-extra-protocol-card-styles', EXTRA_PROTOCOL_CARDS_CSS);

  if (options.accentColor) {
    const normalized = options.accentColor.trim().toLowerCase();
    const effectiveAccent =
      normalized === '#38bdf8'
        ? 'var(--tw-theme-accent, var(--rac-accent, #38bdf8))'
        : options.accentColor;
    rootEl.style.setProperty('--rack-accent', effectiveAccent);
  } else {
    rootEl.style.setProperty('--rack-accent', 'var(--tw-theme-accent, var(--rac-accent, #38bdf8))');
  }

  const rackBar = doc.createElement('div');
  rackBar.className = 'tw-compact-rack-bar';
  rackBar.setAttribute('data-test', 'compact-rack-bar');

  const left = doc.createElement('div');
  left.className = 'tw-compact-rack-left';

  const led = doc.createElement('span');
  led.className = 'tw-compact-rack-led';

  const codeBadge = doc.createElement('span');
  codeBadge.className = 'tw-compact-rack-code';
  codeBadge.setAttribute('data-test', 'compact-rack-code');
  codeBadge.textContent = options.code;

  const titleEl = doc.createElement('strong');
  titleEl.className = 'tw-compact-rack-title';
  titleEl.setAttribute('data-test', 'compact-rack-title');
  titleEl.textContent = options.title;

  const summaryEl = doc.createElement('span');
  summaryEl.className = 'tw-compact-rack-summary';
  summaryEl.setAttribute('data-test', 'compact-rack-summary');
  summaryEl.textContent = options.summary;

  left.appendChild(led);
  left.appendChild(codeBadge);
  left.appendChild(titleEl);
  left.appendChild(summaryEl);

  const toggleBtn = doc.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'tw-compact-rack-toggle';
  toggleBtn.setAttribute('data-test', 'compact-rack-toggle');

  let isCollapsed = options.defaultCollapsed ?? true;
  setCollapsedStateOnElement(rootEl, toggleBtn, isCollapsed);

  const handleToggle = (evt?: Event) => {
    if (evt && typeof evt.stopPropagation === 'function') {
      evt.stopPropagation();
    }
    isCollapsed = !isCollapsed;
    setCollapsedStateOnElement(rootEl, toggleBtn, isCollapsed);
    options.onToggle?.();
  };

  toggleBtn.addEventListener('click', handleToggle as () => void);
  rackBar.addEventListener('click', handleToggle as () => void);

  rackBar.appendChild(left);
  rackBar.appendChild(toggleBtn);
  rootEl.appendChild(rackBar);

  return rackBar;
}

/**
 * 1. 构建 `<timePast>` 战术时钟步进标尺（常驻单行 36px，无需二次折叠）
 */
export function buildChronoStepCardDom(
  doc: Document,
  parsed: ParsedChronoStepCard,
  onLayoutChange?: () => void,
): HTMLElement {
  ensureCardStyleInDoc(doc, 'tw-extra-protocol-card-styles', EXTRA_PROTOCOL_CARDS_CSS);

  const root = doc.createElement('section');
  root.className = 'tw-chrono-step-card';
  root.setAttribute('data-test', 'chrono-step-card');

  const left = doc.createElement('div');
  left.className = 'tw-chrono-step-left';

  const tag = doc.createElement('span');
  tag.className = 'tw-chrono-step-tag';
  tag.textContent = 'CHRONO // 时钟步进';

  const code = doc.createElement('strong');
  code.className = 'tw-chrono-step-code';
  code.setAttribute('data-test', 'chrono-step-code');
  code.textContent = parsed.formattedCode;

  const label = doc.createElement('span');
  label.className = 'tw-chrono-step-label';
  label.setAttribute('data-test', 'chrono-step-label');
  label.textContent = parsed.humanLabel;

  left.appendChild(tag);
  left.appendChild(code);
  left.appendChild(label);

  const ticks = doc.createElement('span');
  ticks.className = 'tw-chrono-step-ticks';
  ticks.textContent = `▮▮▮▮▯▯ // ${parsed.raw}`;

  root.appendChild(left);
  root.appendChild(ticks);

  onLayoutChange?.();
  return root;
}

/**
 * 2. 构建 `<图鉴>` 总参装备与科技列装图鉴卡
 */
export function buildCodexEntryCardDom(
  doc: Document,
  parsed: ParsedCodexCard,
  onLayoutChange?: () => void,
): HTMLElement {
  const root = doc.createElement('section');
  root.className = 'tw-extra-protocol-card tw-codex-card';
  root.setAttribute('data-test', 'codex-entry-card');

  attachCompactRackHeader(doc, root, {
    code: 'CODEX // 图鉴归档',
    title: `新解锁装备与科技图鉴 (${parsed.items.length})`,
    summary: parsed.compactSummary,
    accentColor: parsed.items[0]?.accentColor || '#38bdf8',
    onToggle: onLayoutChange,
  });

  const strip = doc.createElement('div');
  strip.className = 'tw-extra-telemetry-strip';
  const s1 = doc.createElement('span');
  s1.textContent = 'CENTRAL CODEX DATABASE // TACTICAL ARCHIVE';
  const s2 = doc.createElement('span');
  s2.textContent = `RECORDS: ${parsed.items.length}`;
  strip.appendChild(s1);
  strip.appendChild(s2);
  root.appendChild(strip);

  const grid = doc.createElement('div');
  grid.className = 'tw-extra-card-grid';

  for (const item of parsed.items) {
    const slot = doc.createElement('article');
    slot.className = 'tw-extra-card-slot';
    slot.setAttribute('data-test', 'codex-item');
    slot.style.setProperty('--slot-accent', item.accentColor);

    const header = doc.createElement('div');
    header.className = 'tw-extra-slot-header';

    const titleGroup = doc.createElement('div');
    titleGroup.className = 'tw-extra-slot-title-group';

    const codeEl = doc.createElement('span');
    codeEl.className = 'tw-extra-slot-code';
    codeEl.textContent = item.code;

    const nameEl = doc.createElement('strong');
    nameEl.className = 'tw-extra-slot-name';
    nameEl.setAttribute('data-test', 'codex-item-name');
    nameEl.textContent = item.name;

    titleGroup.appendChild(codeEl);
    titleGroup.appendChild(nameEl);

    const catEl = doc.createElement('span');
    catEl.className = 'tw-extra-slot-badge';
    catEl.setAttribute('data-test', 'codex-item-category');
    catEl.textContent = item.category;

    header.appendChild(titleGroup);
    header.appendChild(catEl);
    slot.appendChild(header);

    const descEl = doc.createElement('p');
    descEl.className = 'tw-extra-slot-summary';
    descEl.setAttribute('data-test', 'codex-item-summary');
    descEl.textContent = item.summary;
    slot.appendChild(descEl);

    if (item.tags.length > 0) {
      const tagRow = doc.createElement('div');
      tagRow.className = 'tw-extra-tag-row';
      for (const t of item.tags) {
        const chip = doc.createElement('span');
        chip.className = 'tw-extra-tag-chip';
        chip.textContent = `#${t}`;
        tagRow.appendChild(chip);
      }
      slot.appendChild(tagRow);
    }

    if (item.extraFields.length > 0) {
      const kv = doc.createElement('div');
      kv.className = 'tw-extra-kv-table';
      for (const f of item.extraFields) {
        const row = doc.createElement('div');
        row.className = 'tw-extra-kv-row';
        const k = doc.createElement('span');
        k.className = 'tw-extra-kv-key';
        k.textContent = f.label;
        const v = doc.createElement('span');
        v.className = 'tw-extra-kv-val';
        v.textContent = f.value;
        row.appendChild(k);
        row.appendChild(v);
        kv.appendChild(row);
      }
      slot.appendChild(kv);
    }

    grid.appendChild(slot);
  }

  root.appendChild(grid);
  onLayoutChange?.();
  return root;
}

/**
 * 直接在宿主元素挂载 `<任务>` 卡片（FD-29 / FD-48）
 */
export function mountTacticalQuestCard(host: HTMLElement, rawContent: string): void {
  if (!host || typeof host !== 'object') return;
  const doc =
    host.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.createElement !== 'function') return;

  const parsed = parseTacticalQuestPayload(rawContent);
  const cardDom = buildTacticalQuestCardDom(doc, parsed);

  const mountWrap = doc.createElement('div');
  mountWrap.className = 'tw-floor-card-mount';
  mountWrap.setAttribute('data-test', 'floor-card-mount');
  mountWrap.appendChild(cardDom);
  host.appendChild(mountWrap);

  if (host.dataset) {
    host.dataset.twHydrated = 'true';
  }
  host.setAttribute?.('data-tw-hydrated', 'true');
}

/**
 * 10. 构建 `<任务>` 战区作战任务指令书卡片（MISSION // 作战指令，支持一键填入 #send_textarea）
 */
export function buildTacticalQuestCardDom(
  doc: Document,
  parsed: ParsedTacticalQuestCard,
  onLayoutChange?: () => void,
): HTMLElement {
  ensureCardStyleInDoc(doc, 'tw-extra-protocol-cards-style', EXTRA_PROTOCOL_CARDS_CSS);
  const root = doc.createElement('section');
  root.className = 'tw-extra-protocol-card tw-tactical-quest-card';
  root.setAttribute('data-test', 'tactical-quest-card');

  const hasUrgent = parsed.items.some(i => i.category === '紧急');
  const hasCompleted = parsed.items.some(i => i.status === '已完成');
  const hasMain = parsed.items.some(i => i.category === '主线');
  const accentColor = hasUrgent
    ? '#ef4444'
    : hasCompleted
      ? '#4ade80'
      : hasMain
        ? '#f59e0b'
        : '#38bdf8';

  attachCompactRackHeader(doc, root, {
    code: 'MISSION // 作战指令',
    title: `战区作战任务指令书 (${parsed.items.length}项)`,
    summary: parsed.compactSummary,
    accentColor,
    defaultCollapsed: false,
    onToggle: onLayoutChange,
  });

  const strip = doc.createElement('div');
  strip.className = 'tw-extra-telemetry-strip';
  const s1 = doc.createElement('span');
  s1.textContent = 'TACTICAL MISSION DIRECTIVE // 战区作战任务指令与悬赏交割回执';
  const s2 = doc.createElement('span');
  s2.textContent = `MISSIONS: ${parsed.items.length}`;
  strip.appendChild(s1);
  strip.appendChild(s2);
  root.appendChild(strip);

  const grid = doc.createElement('div');
  grid.className = 'tw-extra-card-grid';

  for (const item of parsed.items) {
    const slot = doc.createElement('article');
    slot.className = 'tw-extra-card-slot';
    slot.setAttribute('data-test', 'tactical-quest-item');

    const header = doc.createElement('div');
    header.className = 'tw-extra-slot-header';

    const titleGroup = doc.createElement('div');
    titleGroup.className = 'tw-extra-slot-title-group';

    const codeEl = doc.createElement('span');
    codeEl.className = 'tw-extra-slot-code';
    codeEl.setAttribute('data-test', 'tactical-quest-category');
    codeEl.textContent = `[${item.category}]`;

    const nameEl = doc.createElement('strong');
    nameEl.className = 'tw-extra-slot-name';
    nameEl.setAttribute('data-test', 'tactical-quest-name');
    nameEl.textContent = item.name;

    titleGroup.appendChild(codeEl);
    titleGroup.appendChild(nameEl);

    const seriesText = typeof item.series === 'string' ? item.series.trim() : '';
    const chainStepText = typeof item.chainStep === 'string' ? item.chainStep.trim() : '';
    if (seriesText || chainStepText) {
      const seriesEl = doc.createElement('span');
      seriesEl.className = 'tw-extra-slot-badge tw-quest-series-badge';
      seriesEl.setAttribute('data-test', 'tactical-quest-series');
      seriesEl.setAttribute('data-quest-series', seriesText || '任务链');
      if (chainStepText) {
        seriesEl.setAttribute('data-quest-chain-step', chainStepText);
      }
      seriesEl.style.cssText =
        'color:#fbbf24;background:rgba(120,53,15,0.28);border:1px solid rgba(245,158,11,0.45);font-weight:700;';
      seriesEl.textContent = `系列：${seriesText || '任务链'}${chainStepText ? ' · ' + chainStepText : ''}`;
      titleGroup.appendChild(seriesEl);
    }

    const statusEl = doc.createElement('span');
    statusEl.className = 'tw-extra-slot-badge';
    statusEl.setAttribute('data-test', 'tactical-quest-status');
    statusEl.textContent =
      item.status === '已完成'
        ? '✓ 已完成·悬赏已交割'
        : item.status === '已失败'
          ? '✕ 已失败'
          : item.status === '已取消'
            ? '✕ 已取消'
            : item.status || '进行中';

    header.appendChild(titleGroup);
    header.appendChild(statusEl);
    slot.appendChild(header);

    const kv = doc.createElement('div');
    kv.className = 'tw-extra-kv-table';
    const pairs = [
      { label: '发包方', value: item.issuer || '战区联席参谋部' },
      { label: '当前进度', value: item.progress || '待推进' },
      { label: '任务要点', value: item.note || '按作战指令执行' },
      { label: '任务详情', value: item.detail || '暂无补充战术说明' },
    ];
    for (const p of pairs) {
      const row = doc.createElement('div');
      row.className = 'tw-extra-kv-row';
      const k = doc.createElement('span');
      k.className = 'tw-extra-kv-key';
      k.textContent = p.label;
      const v = doc.createElement('span');
      v.className = 'tw-extra-kv-val';
      v.textContent = p.value;
      row.appendChild(k);
      row.appendChild(v);
      kv.appendChild(row);
    }
    slot.appendChild(kv);

    if (item.rewardBadges.length > 0) {
      const rewardRow = doc.createElement('div');
      rewardRow.className = 'tw-extra-tag-row';
      rewardRow.setAttribute('data-test', 'tactical-quest-rewards');
      for (const badge of item.rewardBadges) {
        const chip = doc.createElement('span');
        chip.className = 'tw-extra-tag-chip';
        chip.setAttribute('data-test', 'tactical-quest-reward');
        const rewardKind = badge.startsWith('🎖️')
          ? 'tier-s'
          : badge.startsWith('🏭')
            ? 'tier-a'
            : badge.startsWith('🪖') || badge.startsWith('🚜')
              ? 'tier-b'
              : badge.startsWith('💰')
                ? 'chain'
                : badge.startsWith('📡')
                  ? 'protocol'
                  : badge.startsWith('🤝')
                    ? 'faction'
                    : badge.startsWith('🪙')
                      ? 'wallet'
                      : badge.startsWith('💖')
                        ? 'girl'
                        : badge.startsWith('🔬')
                          ? 'tech'
                          : 'standard';
        chip.setAttribute('data-reward-kind', rewardKind);
        chip.textContent = badge;
        rewardRow.appendChild(chip);
      }
      slot.appendChild(rewardRow);
    }

    const nextQuestText = typeof item.nextQuest === 'string' ? item.nextQuest.trim() : '';
    if (nextQuestText) {
      const nextEl = doc.createElement('div');
      nextEl.className = 'tw-quest-next-hook';
      nextEl.setAttribute('data-test', 'tactical-quest-next');
      nextEl.setAttribute('data-quest-next', nextQuestText);
      nextEl.style.cssText =
        'padding:5px 8px;background:rgba(14,116,144,0.2);border-left:2px solid #38bdf8;font-size:11px;color:#bae6fd;';
      nextEl.textContent = `▸ 下一环线索：${nextQuestText}`;
      slot.appendChild(nextEl);
    }

    const isOngoing =
      item.status !== '已完成' && item.status !== '已失败' && item.status !== '已取消';
    if (isOngoing) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'tw-quest-advance-btn';
      btn.setAttribute('data-test', 'tactical-quest-advance-btn');
      btn.style.cssText =
        'margin-top:4px;align-self:flex-start;padding:4px 10px;background:color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 16%, transparent);border:1px solid color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 38%, transparent);color:color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 88%, #ffffff);font-family:inherit;font-size:11px;font-weight:700;cursor:pointer;';
      btn.textContent = '▶ 推进此任务';

      btn.addEventListener('click', () => {
        const parentDoc =
          typeof window !== 'undefined' && window.parent && window.parent !== window
            ? window.parent.document
            : undefined;
        const ta =
          (doc.querySelector('#send_textarea') as HTMLTextAreaElement | null) ??
          (parentDoc?.querySelector?.('#send_textarea') as HTMLTextAreaElement | null) ??
          null;
        if (ta) {
          ta.value = `【推进作战任务：${item.name}】调配战区兵力与资源执行阶段目标——${item.progress || item.note || item.detail || '按指令推进'}`;
          if (typeof ta.dispatchEvent === 'function' && typeof Event === 'function') {
            ta.dispatchEvent(new Event('input', { bubbles: true }));
          }
          if (typeof ta.focus === 'function') {
            ta.focus();
          }
        }
      });

      slot.appendChild(btn);
    }

    grid.appendChild(slot);
  }

  root.appendChild(grid);
  onLayoutChange?.();
  return root;
}

/**
 * 8. 构建 `<态势>` 战区环境与态势汇总卡片（Compact Rack Bar 风格 + FD-31 参谋席建议区块）
 */
export function buildTacticalSituationCardDom(
  doc: Document,
  parsed: ParsedTacticalSituationCard,
  onLayoutChange?: () => void,
): HTMLElement {
  ensureCardStyleInDoc(doc, 'tw-extra-protocol-cards-style', EXTRA_PROTOCOL_CARDS_CSS);
  const root = doc.createElement('section');
  root.className = 'tw-extra-protocol-card tw-tactical-situation-card';
  root.setAttribute('data-test', 'tactical-situation-card');

  const adviceList = Array.isArray(parsed.staffAdvice) ? parsed.staffAdvice : [];

  attachCompactRackHeader(doc, root, {
    code: 'SIT // 战场态势',
    title: `${parsed.location} · 环境态势`,
    summary: parsed.compactSummary,
    accentColor: '#38bdf8',
    defaultCollapsed: adviceList.length === 0,
    onToggle: onLayoutChange,
  });

  const strip = doc.createElement('div');
  strip.className = 'tw-extra-telemetry-strip';
  const s1 = doc.createElement('span');
  s1.textContent = 'THEATER SITUATION MONITOR // 战区环境与暴露民心遥测';

  const metricsGroup = doc.createElement('div');
  metricsGroup.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';

  const expBadge = doc.createElement('span');
  expBadge.setAttribute('data-test', 'tactical-situation-exposure');
  const expLevelStr = parsed.exposureLevel || 'EL-0 日常隐蔽';
  expBadge.textContent = `暴露 ${parsed.exposureDelta} · ${expLevelStr}`;
  metricsGroup.appendChild(expBadge);

  if (parsed.morale !== undefined || parsed.moraleDelta) {
    const moraleBadge = doc.createElement('span');
    moraleBadge.setAttribute('data-test', 'tactical-situation-morale');
    moraleBadge.style.cssText = 'color:#f472b6;font-weight:700;';
    const stageStr = parsed.moraleStage || '观望顺从';
    if (parsed.morale !== undefined && parsed.moraleDelta) {
      moraleBadge.textContent = `❤️ 民心 ${parsed.morale}/10 (${parsed.moraleDelta} · ${stageStr})`;
    } else if (parsed.morale !== undefined) {
      moraleBadge.textContent = `❤️ 民心 ${parsed.morale}/10 (${stageStr})`;
    } else {
      moraleBadge.textContent = `❤️ 民心 ${parsed.moraleDelta} · ${stageStr}`;
    }
    metricsGroup.appendChild(moraleBadge);
  }

  strip.appendChild(s1);
  strip.appendChild(metricsGroup);
  root.appendChild(strip);

  const grid = doc.createElement('div');
  grid.className = 'tw-extra-card-grid';

  const slot = doc.createElement('article');
  slot.className = 'tw-extra-card-slot';

  const kv = doc.createElement('div');
  kv.className = 'tw-extra-kv-table';
  for (const f of parsed.fields) {
    const row = doc.createElement('div');
    row.className = 'tw-extra-kv-row';
    const k = doc.createElement('span');
    k.className = 'tw-extra-kv-key';
    k.textContent = f.label;
    const v = doc.createElement('span');
    v.className = 'tw-extra-kv-val';
    v.textContent = f.value;
    row.appendChild(k);
    row.appendChild(v);
    kv.appendChild(row);
  }
  slot.appendChild(kv);
  grid.appendChild(slot);
  root.appendChild(grid);

  if (adviceList.length > 0) {
    const adviceSec = doc.createElement('div');
    adviceSec.className = 'tw-situation-staff-advice';
    adviceSec.setAttribute('data-test', 'tactical-situation-staff-advice');

    const headerBar = doc.createElement('div');
    headerBar.className = 'tw-situation-advice-header-bar';
    const hLeft = doc.createElement('span');
    hLeft.textContent = 'STAFF ADVISORY // 参谋席建议';
    const hRight = doc.createElement('span');
    hRight.textContent = `ADVISORS: ${adviceList.length}`;
    headerBar.appendChild(hLeft);
    headerBar.appendChild(hRight);
    adviceSec.appendChild(headerBar);

    const listEl = doc.createElement('div');
    listEl.className = 'tw-situation-advice-list';

    for (const item of adviceList) {
      const cardEl = doc.createElement('article');
      cardEl.className = 'tw-situation-advice-item';
      cardEl.setAttribute('data-test', 'tactical-situation-advice-item');

      const topRow = doc.createElement('div');
      topRow.className = 'tw-situation-advice-top';

      const badgesWrap = doc.createElement('div');
      badgesWrap.className = 'tw-situation-advice-badges';

      const advisorEl = doc.createElement('span');
      advisorEl.className = 'tw-situation-advice-advisor';
      advisorEl.setAttribute('data-test', 'tactical-situation-advice-advisor');
      advisorEl.textContent = `🎙️ ${item.advisor}`;

      const focusEl = doc.createElement('span');
      focusEl.className = 'tw-situation-advice-focus';
      focusEl.setAttribute('data-test', 'tactical-situation-advice-focus');
      focusEl.textContent = item.focus;

      badgesWrap.appendChild(advisorEl);
      badgesWrap.appendChild(focusEl);

      const adoptBtn = doc.createElement('button');
      adoptBtn.type = 'button';
      adoptBtn.className = 'tw-situation-advice-adopt-btn';
      adoptBtn.setAttribute('data-test', 'tactical-situation-advice-adopt-btn');
      adoptBtn.textContent = '▶ 采纳指令';

      adoptBtn.addEventListener('click', () => {
        fillChatInputBox(doc, item.commandText);
        adoptBtn.textContent = '✓ 已填入行动框';
        if (typeof setTimeout === 'function') {
          setTimeout(() => {
            adoptBtn.textContent = '▶ 采纳指令';
          }, 1600);
        }
      });

      topRow.appendChild(badgesWrap);
      topRow.appendChild(adoptBtn);

      const textEl = doc.createElement('p');
      textEl.className = 'tw-situation-advice-text';
      textEl.setAttribute('data-test', 'tactical-situation-advice-text');
      textEl.textContent = item.advice;

      cardEl.appendChild(topRow);
      cardEl.appendChild(textEl);
      listEl.appendChild(cardEl);
    }

    adviceSec.appendChild(listEl);
    root.appendChild(adviceSec);
  }

  onLayoutChange?.();
  return root;
}

/**
 * 9. 构建 `<选项>` 战区指挥部战术决策行动选项卡片（默认展开，点击填入 #send_textarea）
 */
export function buildTacticalOptionsCardDom(
  doc: Document,
  parsed: ParsedTacticalOptionsCard,
  onLayoutChange?: () => void,
): HTMLElement {
  ensureCardStyleInDoc(doc, 'tw-extra-protocol-cards-style', EXTRA_PROTOCOL_CARDS_CSS);
  const root = doc.createElement('section');
  root.className = 'tw-extra-protocol-card tw-tactical-options-card';
  root.setAttribute('data-test', 'tactical-options-card');

  attachCompactRackHeader(doc, root, {
    code: 'OPT // 战术决策',
    title: `指挥部行动预案 (${parsed.items.length}项)`,
    summary: parsed.compactSummary,
    accentColor: '#38bdf8',
    defaultCollapsed: false,
    onToggle: onLayoutChange,
  });

  const strip = doc.createElement('div');
  strip.className = 'tw-extra-telemetry-strip';
  const s1 = doc.createElement('span');
  s1.textContent = 'TACTICAL ACTION DIRECTIVES // 点击任意预案直接填入行动指令框';
  const s2 = doc.createElement('span');
  s2.textContent = `OPTIONS: ${parsed.items.length}`;
  strip.appendChild(s1);
  strip.appendChild(s2);
  root.appendChild(strip);

  const listWrap = doc.createElement('div');
  listWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:8px 12px 10px;';

  parsed.items.forEach((opt, idx) => {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-test', 'tactical-option-btn');
    btn.style.cssText =
      'display:grid;grid-template-columns:22px 1fr auto;align-items:center;gap:8px;width:100%;text-align:left;padding:7px 10px;background:color-mix(in srgb, var(--tw-theme-panel, #0f172a) 82%, #050811);border:1px solid color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 22%, transparent);border-radius:2px;color:#e2e8f0;cursor:pointer;font-family:inherit;font-size:12px;';

    const numSpan = doc.createElement('span');
    numSpan.style.cssText = 'color:var(--tw-theme-accent, #38bdf8);font-weight:800;font-size:11px;';
    numSpan.textContent = String(idx + 1);

    const mainSpan = doc.createElement('span');
    const txtSpan = doc.createElement('span');
    txtSpan.style.cssText = 'display:block;color:#e2e8f0;line-height:1.45;';
    txtSpan.textContent = opt.text;
    mainSpan.appendChild(txtSpan);

    if (opt.cost) {
      const costSpan = doc.createElement('span');
      costSpan.style.cssText = 'display:block;color:#f59e0b;font-size:10px;margin-top:2px;';
      costSpan.textContent = `预计代价: ${opt.cost}`;
      mainSpan.appendChild(costSpan);
    }

    btn.appendChild(numSpan);
    btn.appendChild(mainSpan);

    if (opt.tag) {
      const tagSpan = doc.createElement('span');
      tagSpan.style.cssText =
        'padding:2px 6px;background:color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 14%, transparent);border:1px solid color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 32%, transparent);color:color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 85%, #ffffff);font-size:10px;white-space:nowrap;';
      tagSpan.textContent = opt.tag;
      btn.appendChild(tagSpan);
    }

    btn.addEventListener('click', () => {
      const ta = doc.querySelector('#send_textarea') as HTMLTextAreaElement | null;
      if (ta) {
        ta.value = opt.text;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.focus();
      }
    });

    listWrap.appendChild(btn);
  });

  root.appendChild(listWrap);
  onLayoutChange?.();
  return root;
}


/**
 * 3. 构建 `<事件>` 战区最高统帅部加密电报回执
 */
export function buildTacticalEventCardDom(
  doc: Document,
  parsed: ParsedTacticalEventCard,
  onLayoutChange?: () => void,
): HTMLElement {
  const root = doc.createElement('section');
  root.className = 'tw-extra-protocol-card tw-tactical-event-card';
  root.setAttribute('data-test', 'tactical-event-card');

  const topLevel = parsed.items[0]?.level || 'INFO';
  const accent = topLevel === 'FLASH' ? '#ef4444' : topLevel === 'WARN' ? '#f59e0b' : '#38bdf8';

  attachCompactRackHeader(doc, root, {
    code: 'FLASH // 战区电报',
    title: parsed.items[0]?.title || '战区突发态势通报',
    summary: parsed.compactSummary,
    accentColor: accent,
    onToggle: onLayoutChange,
  });

  const strip = doc.createElement('div');
  strip.className = 'tw-extra-telemetry-strip';
  const s1 = doc.createElement('span');
  s1.textContent = 'SUPREME COMMAND FLASH TELEGRAM // TACTICAL DISPATCH';
  const s2 = doc.createElement('span');
  s2.textContent = `LEVEL: ${topLevel}`;
  strip.appendChild(s1);
  strip.appendChild(s2);
  root.appendChild(strip);

  const grid = doc.createElement('div');
  grid.className = 'tw-extra-card-grid';

  for (const item of parsed.items) {
    const slot = doc.createElement('article');
    slot.className = 'tw-extra-card-slot';
    slot.setAttribute('data-test', 'tactical-event-item');

    const header = doc.createElement('div');
    header.className = 'tw-extra-slot-header';

    const titleGroup = doc.createElement('div');
    titleGroup.className = 'tw-extra-slot-title-group';

    const codeEl = doc.createElement('span');
    codeEl.className = 'tw-extra-slot-code';
    codeEl.textContent = item.level;

    const nameEl = doc.createElement('strong');
    nameEl.className = 'tw-extra-slot-name';
    nameEl.setAttribute('data-test', 'tactical-event-title');
    nameEl.textContent = item.title;

    titleGroup.appendChild(codeEl);
    titleGroup.appendChild(nameEl);

    const locEl = doc.createElement('span');
    locEl.className = 'tw-extra-slot-badge';
    locEl.textContent = item.location;

    header.appendChild(titleGroup);
    header.appendChild(locEl);
    slot.appendChild(header);

    const kv = doc.createElement('div');
    kv.className = 'tw-extra-kv-table';
    for (const f of item.fields) {
      const row = doc.createElement('div');
      row.className = 'tw-extra-kv-row';
      const k = doc.createElement('span');
      k.className = 'tw-extra-kv-key';
      k.textContent = f.label;
      const v = doc.createElement('span');
      v.className = 'tw-extra-kv-val';
      v.textContent = f.value;
      row.appendChild(k);
      row.appendChild(v);
      kv.appendChild(row);
    }
    slot.appendChild(kv);
    grid.appendChild(slot);
  }

  root.appendChild(grid);
  onLayoutChange?.();
  return root;
}

/**
 * 4. 构建 `<工程>` 总参重工基建蓝图终端
 */
export function buildEngineeringOrderCardDom(
  doc: Document,
  parsed: ParsedEngineeringOrderCard,
  onLayoutChange?: () => void,
): HTMLElement {
  const root = doc.createElement('section');
  root.className = 'tw-extra-protocol-card tw-engineering-order-card';
  root.setAttribute('data-test', 'engineering-order-card');

  attachCompactRackHeader(doc, root, {
    code: 'ENG // 基建蓝图',
    title: `总参工程立项与施工调度 (${parsed.items.length})`,
    summary: parsed.compactSummary,
    accentColor: '#06b6d4',
    onToggle: onLayoutChange,
  });

  const strip = doc.createElement('div');
  strip.className = 'tw-extra-telemetry-strip';
  const s1 = doc.createElement('span');
  s1.textContent = 'CHIEF ENGINEERING DIRECTORATE // INFRASTRUCTURE BLUEPRINT';
  const s2 = doc.createElement('span');
  s2.textContent = `PROJECTS: ${parsed.items.length}`;
  strip.appendChild(s1);
  strip.appendChild(s2);
  root.appendChild(strip);

  const grid = doc.createElement('div');
  grid.className = 'tw-extra-card-grid';

  for (const item of parsed.items) {
    const slot = doc.createElement('article');
    slot.className = 'tw-extra-card-slot';
    slot.setAttribute('data-test', 'engineering-order-item');

    const header = doc.createElement('div');
    header.className = 'tw-extra-slot-header';

    const titleGroup = doc.createElement('div');
    titleGroup.className = 'tw-extra-slot-title-group';

    const codeEl = doc.createElement('span');
    codeEl.className = 'tw-extra-slot-code';
    codeEl.textContent = 'ENG';

    const nameEl = doc.createElement('strong');
    nameEl.className = 'tw-extra-slot-name';
    nameEl.setAttribute('data-test', 'engineering-order-name');
    nameEl.textContent = item.name;

    titleGroup.appendChild(codeEl);
    titleGroup.appendChild(nameEl);

    const statusEl = doc.createElement('span');
    statusEl.className = 'tw-extra-slot-badge';
    statusEl.textContent = item.status;

    header.appendChild(titleGroup);
    header.appendChild(statusEl);
    slot.appendChild(header);

    const kv = doc.createElement('div');
    kv.className = 'tw-extra-kv-table';
    const pairs = [
      { label: '所属基地', value: item.base },
      { label: '预计工期', value: item.duration },
      { label: '资源投入', value: item.cost },
      { label: '工程效用', value: item.effect },
    ];
    for (const p of pairs) {
      const row = doc.createElement('div');
      row.className = 'tw-extra-kv-row';
      const k = doc.createElement('span');
      k.className = 'tw-extra-kv-key';
      k.textContent = p.label;
      const v = doc.createElement('span');
      v.className = 'tw-extra-kv-val';
      v.textContent = p.value;
      row.appendChild(k);
      row.appendChild(v);
      kv.appendChild(row);
    }
    slot.appendChild(kv);
    grid.appendChild(slot);
  }

  root.appendChild(grid);
  onLayoutChange?.();
  return root;
}

/**
 * 5. 构建 `<排产计划>` 兵工流水线排产调度终端
 */
export function buildProductionScheduleCardDom(
  doc: Document,
  parsed: ParsedProductionScheduleCard,
  onLayoutChange?: () => void,
): HTMLElement {
  const root = doc.createElement('section');
  root.className = 'tw-extra-protocol-card tw-production-schedule-card';
  root.setAttribute('data-test', 'production-schedule-card');

  attachCompactRackHeader(doc, root, {
    code: 'PROD // 兵工排产',
    title: `军工流水线批次排产单 (${parsed.items.length}批)`,
    summary: parsed.compactSummary,
    accentColor: '#4ade80',
    onToggle: onLayoutChange,
  });

  const strip = doc.createElement('div');
  strip.className = 'tw-extra-telemetry-strip';
  const s1 = doc.createElement('span');
  s1.textContent = 'MILITARY PRODUCTION SCHEDULE // ASSEMBLY LINE DISPATCH';
  const s2 = doc.createElement('span');
  s2.textContent = `BATCHES: ${parsed.items.length}`;
  strip.appendChild(s1);
  strip.appendChild(s2);
  root.appendChild(strip);

  const grid = doc.createElement('div');
  grid.className = 'tw-extra-card-grid';

  for (const item of parsed.items) {
    const slot = doc.createElement('article');
    slot.className = 'tw-extra-card-slot';
    slot.setAttribute('data-test', 'production-batch-item');

    const header = doc.createElement('div');
    header.className = 'tw-extra-slot-header';

    const titleGroup = doc.createElement('div');
    titleGroup.className = 'tw-extra-slot-title-group';

    const codeEl = doc.createElement('span');
    codeEl.className = 'tw-extra-slot-code';
    codeEl.textContent = item.count;

    const nameEl = doc.createElement('strong');
    nameEl.className = 'tw-extra-slot-name';
    nameEl.setAttribute('data-test', 'production-batch-unit');
    nameEl.textContent = item.unit;

    titleGroup.appendChild(codeEl);
    titleGroup.appendChild(nameEl);

    const statusEl = doc.createElement('span');
    statusEl.className = 'tw-extra-slot-badge';
    statusEl.textContent = item.status;

    header.appendChild(titleGroup);
    header.appendChild(statusEl);
    slot.appendChild(header);

    const kv = doc.createElement('div');
    kv.className = 'tw-extra-kv-table';
    const pairs = [
      { label: '部署阵位', value: item.base },
      { label: '承制产线', value: item.line },
      { label: '交付周期', value: item.eta },
    ];
    for (const p of pairs) {
      const row = doc.createElement('div');
      row.className = 'tw-extra-kv-row';
      const k = doc.createElement('span');
      k.className = 'tw-extra-kv-key';
      k.textContent = p.label;
      const v = doc.createElement('span');
      v.className = 'tw-extra-kv-val';
      v.textContent = p.value;
      row.appendChild(k);
      row.appendChild(v);
      kv.appendChild(row);
    }
    slot.appendChild(kv);
    grid.appendChild(slot);
  }

  root.appendChild(grid);
  onLayoutChange?.();
  return root;
}

/**
 * 6. 构建 `<扩展档案>` 战区机密人物与势力情报卷宗
 */
export function buildIntelDossierCardDom(
  doc: Document,
  parsed: ParsedIntelDossierCard,
  onLayoutChange?: () => void,
): HTMLElement {
  const root = doc.createElement('section');
  root.className = 'tw-extra-protocol-card tw-intel-dossier-card';
  root.setAttribute('data-test', 'intel-dossier-card');

  attachCompactRackHeader(doc, root, {
    code: 'INTEL // 机密卷宗',
    title: parsed.items[0]?.name || '战区机密情报卷宗',
    summary: parsed.compactSummary,
    accentColor: '#c084fc',
    onToggle: onLayoutChange,
  });

  const strip = doc.createElement('div');
  strip.className = 'tw-extra-telemetry-strip';
  const s1 = doc.createElement('span');
  s1.textContent = 'THEATER INTELLIGENCE BUREAU // CLASSIFIED DOSSIER';
  const s2 = doc.createElement('span');
  s2.textContent = 'CLEARANCE: EYES ONLY';
  strip.appendChild(s1);
  strip.appendChild(s2);
  root.appendChild(strip);

  const grid = doc.createElement('div');
  grid.className = 'tw-extra-card-grid';

  for (const item of parsed.items) {
    const slot = doc.createElement('article');
    slot.className = 'tw-extra-card-slot';
    slot.setAttribute('data-test', 'intel-dossier-item');

    const header = doc.createElement('div');
    header.className = 'tw-extra-slot-header';

    const titleGroup = doc.createElement('div');
    titleGroup.className = 'tw-extra-slot-title-group';

    const codeEl = doc.createElement('span');
    codeEl.className = 'tw-extra-slot-code';
    codeEl.textContent = item.kind;

    const nameEl = doc.createElement('strong');
    nameEl.className = 'tw-extra-slot-name';
    nameEl.setAttribute('data-test', 'intel-dossier-name');
    nameEl.textContent = item.name;

    titleGroup.appendChild(codeEl);
    titleGroup.appendChild(nameEl);

    const threatEl = doc.createElement('span');
    threatEl.className = 'tw-extra-slot-badge';
    threatEl.textContent = `${item.affiliation} · ${item.threat}`;

    header.appendChild(titleGroup);
    header.appendChild(threatEl);
    slot.appendChild(header);

    const descEl = doc.createElement('p');
    descEl.className = 'tw-extra-slot-summary';
    descEl.textContent = item.summary;
    slot.appendChild(descEl);

    if (item.fields.length > 0) {
      const kv = doc.createElement('div');
      kv.className = 'tw-extra-kv-table';
      for (const f of item.fields) {
        const row = doc.createElement('div');
        row.className = 'tw-extra-kv-row';
        const k = doc.createElement('span');
        k.className = 'tw-extra-kv-key';
        k.textContent = f.label;
        const v = doc.createElement('span');
        v.className = 'tw-extra-kv-val';
        v.textContent = f.value;
        row.appendChild(k);
        row.appendChild(v);
        kv.appendChild(row);
      }
      slot.appendChild(kv);
    }

    grid.appendChild(slot);
  }

  root.appendChild(grid);
  onLayoutChange?.();
  return root;
}

/**
 * 7. 构建 `<数据更新>` 纳米固件量化重构 Diff 终端
 */
export function buildDataPatchCardDom(
  doc: Document,
  parsed: ParsedDataPatchCard,
  onLayoutChange?: () => void,
): HTMLElement {
  const root = doc.createElement('section');
  root.className = 'tw-extra-protocol-card tw-data-patch-card';
  root.setAttribute('data-test', 'data-patch-card');

  attachCompactRackHeader(doc, root, {
    code: 'PATCH // 固件重构',
    title: `世界书量化数据热补丁 (${parsed.items.length}项)`,
    summary: parsed.compactSummary,
    accentColor: '#10b981',
    onToggle: onLayoutChange,
  });

  const strip = doc.createElement('div');
  strip.className = 'tw-extra-telemetry-strip';
  const s1 = doc.createElement('span');
  s1.textContent = 'NANITE FIRMWARE COMPILER // WORLDBOOK DATA PATCH DIFF';
  const s2 = doc.createElement('span');
  s2.textContent = `PATCHES: ${parsed.items.length}`;
  strip.appendChild(s1);
  strip.appendChild(s2);
  root.appendChild(strip);

  const grid = doc.createElement('div');
  grid.className = 'tw-extra-card-grid';

  for (const item of parsed.items) {
    const slot = doc.createElement('article');
    slot.className = 'tw-extra-card-slot';
    slot.setAttribute('data-test', 'data-patch-item');

    const header = doc.createElement('div');
    header.className = 'tw-extra-slot-header';

    const titleGroup = doc.createElement('div');
    titleGroup.className = 'tw-extra-slot-title-group';

    const codeEl = doc.createElement('span');
    codeEl.className = 'tw-extra-slot-code';
    codeEl.textContent = item.op;

    const nameEl = doc.createElement('strong');
    nameEl.className = 'tw-extra-slot-name';
    nameEl.setAttribute('data-test', 'data-patch-target');
    nameEl.textContent = item.target;

    titleGroup.appendChild(codeEl);
    titleGroup.appendChild(nameEl);

    const bookEl = doc.createElement('span');
    bookEl.className = 'tw-extra-slot-badge';
    bookEl.textContent = item.book;

    header.appendChild(titleGroup);
    header.appendChild(bookEl);
    slot.appendChild(header);

    const kv = doc.createElement('div');
    kv.className = 'tw-extra-kv-table';
    for (const c of item.changes) {
      const row = doc.createElement('div');
      row.className = 'tw-extra-kv-row';
      const k = doc.createElement('span');
      k.className = 'tw-extra-kv-key';
      k.textContent = c.field;
      const v = doc.createElement('span');
      v.className = 'tw-extra-kv-val';
      v.textContent = c.value;
      row.appendChild(k);
      row.appendChild(v);
      kv.appendChild(row);
    }
    slot.appendChild(kv);
    grid.appendChild(slot);
  }

  root.appendChild(grid);
  onLayoutChange?.();
  return root;
}

function resolveAttitudeColor(attitude: string): {
  color: string;
  bg: string;
  border: string;
} {
  if (/效忠|友善|合作/.test(attitude)) {
    return {
      color: '#4ade80',
      bg: 'rgba(20, 83, 45, 0.28)',
      border: 'rgba(74, 222, 128, 0.45)',
    };
  }
  if (/警觉/.test(attitude)) {
    return {
      color: '#f59e0b',
      bg: 'rgba(120, 53, 15, 0.28)',
      border: 'rgba(245, 158, 11, 0.45)',
    };
  }
  if (/敌对/.test(attitude)) {
    return {
      color: '#ef4444',
      bg: 'rgba(127, 29, 29, 0.28)',
      border: 'rgba(239, 68, 68, 0.45)',
    };
  }
  return {
    color: '#38bdf8',
    bg: 'rgba(14, 116, 144, 0.24)',
    border: 'rgba(56, 189, 248, 0.4)',
  };
}

/**
 * 11. 构建 `<扩展档案>` 战区人物档案与扩展设定建档卡片（FD-32：PERSONNEL DOSSIER & EXPANSION DOSSIER）
 */
export function buildExpansionDossierCardDom(
  doc: Document,
  parsed: ParsedExpansionDossierCard,
  onLayoutChange?: () => void,
): HTMLElement {
  ensureCardStyleInDoc(doc, 'tw-extra-protocol-cards-style', EXTRA_PROTOCOL_CARDS_CSS);
  const root = doc.createElement('section');
  root.className = 'tw-extra-protocol-card tw-expansion-dossier-card';
  root.setAttribute('data-test', 'expansion-dossier-card');

  const headerBanner =
    parsed.hasNpc && parsed.hasOther
      ? 'PERSONNEL & EXPANSION DOSSIER // 战区人物与扩展建档'
      : parsed.hasNpc
        ? 'PERSONNEL DOSSIER // 战区人物档案'
        : 'EXPANSION DOSSIER // 战区扩展建档';

  const rackCode = parsed.hasNpc ? 'PERSONNEL // 人物档案' : 'DOSSIER // 扩展建档';
  const rackTitle = `${headerBanner} (${parsed.items.length}份)`;

  attachCompactRackHeader(doc, root, {
    code: rackCode,
    title: rackTitle,
    summary: parsed.compactSummary,
    accentColor: parsed.hasNpc ? '#38bdf8' : '#c084fc',
    defaultCollapsed: false,
    onToggle: onLayoutChange,
  });

  const strip = doc.createElement('div');
  strip.className = 'tw-extra-telemetry-strip';
  strip.setAttribute('data-test', 'expansion-dossier-banner');
  const s1 = doc.createElement('span');
  s1.textContent = headerBanner;
  const s2 = doc.createElement('span');
  s2.textContent = `ENTRIES: ${parsed.items.length}`;
  strip.appendChild(s1);
  strip.appendChild(s2);
  root.appendChild(strip);

  const grid = doc.createElement('div');
  grid.className = 'tw-extra-card-grid';

  for (const item of parsed.items) {
    if (item.kind === '人物') {
      const slot = doc.createElement('article');
      slot.className = 'tw-extra-card-slot tw-expansion-npc-slot';
      slot.setAttribute('data-test', 'expansion-npc-card');

      // 1. 头部：徽章、姓名、代号/头衔、所属势力、立场态度色标
      const header = doc.createElement('div');
      header.className = 'tw-extra-slot-header';

      const titleGroup = doc.createElement('div');
      titleGroup.className = 'tw-extra-slot-title-group';

      const codeEl = doc.createElement('span');
      codeEl.className = 'tw-extra-slot-code';
      codeEl.textContent = '[人物档案]';
      titleGroup.appendChild(codeEl);

      const nameEl = doc.createElement('strong');
      nameEl.className = 'tw-extra-slot-name';
      nameEl.setAttribute('data-test', 'expansion-npc-name');
      nameEl.textContent = item.name;
      titleGroup.appendChild(nameEl);

      if (item.title) {
        const callsignEl = doc.createElement('span');
        callsignEl.className = 'tw-extra-slot-badge';
        callsignEl.setAttribute('data-test', 'expansion-npc-title');
        callsignEl.textContent = `「${item.title}」`;
        titleGroup.appendChild(callsignEl);
      }

      const rightBadges = doc.createElement('div');
      rightBadges.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';

      const factionEl = doc.createElement('span');
      factionEl.className = 'tw-extra-slot-badge';
      factionEl.setAttribute('data-test', 'expansion-npc-faction');
      factionEl.textContent = item.faction || '独立/待甄别';
      rightBadges.appendChild(factionEl);

      const attitudeText = item.attitude || '中立';
      const attMeta = resolveAttitudeColor(attitudeText);
      const attitudeEl = doc.createElement('span');
      attitudeEl.className = 'tw-extra-slot-badge';
      attitudeEl.setAttribute('data-test', 'expansion-npc-attitude');
      attitudeEl.setAttribute('data-attitude', attitudeText);
      attitudeEl.style.cssText = `color:${attMeta.color};background:${attMeta.bg};border:1px solid ${attMeta.border};font-weight:700;`;
      attitudeEl.textContent = attitudeText;
      rightBadges.appendChild(attitudeEl);

      header.appendChild(titleGroup);
      header.appendChild(rightBadges);
      slot.appendChild(header);

      // 2. 动态关系与状态栏：信任度进度条 (0~100%) + 增量 + 当前状态/驻地
      const statusBar = doc.createElement('div');
      statusBar.style.cssText =
        'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 8px;background:rgba(15,23,42,0.65);border:1px solid rgba(56,189,248,0.16);font-size:11px;';

      const trustVal = typeof item.trust === 'number' ? item.trust : 50;
      const trustWrap = doc.createElement('div');
      trustWrap.setAttribute('data-test', 'expansion-npc-trust');
      trustWrap.setAttribute('data-trust', String(trustVal));
      trustWrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex:1 1 auto;';

      const trustLabel = doc.createElement('span');
      trustLabel.textContent = `信任度 ${trustVal}%`;
      trustWrap.appendChild(trustLabel);

      const barTrack = doc.createElement('div');
      barTrack.style.cssText =
        'width:72px;height:6px;background:rgba(30,41,59,0.9);border:1px solid rgba(148,163,184,0.25);overflow:hidden;';
      const barFill = doc.createElement('div');
      barFill.setAttribute('data-test', 'expansion-npc-trust-bar');
      barFill.style.cssText = `width:${trustVal}%;height:100%;background:${attMeta.color};`;
      barTrack.appendChild(barFill);
      trustWrap.appendChild(barTrack);

      if (item.trustDelta) {
        const deltaEl = doc.createElement('span');
        deltaEl.setAttribute('data-test', 'expansion-npc-trust-delta');
        deltaEl.style.cssText = `font-weight:700;color:${item.trustDelta.startsWith('-') ? '#ef4444' : '#4ade80'};`;
        deltaEl.textContent = `(${item.trustDelta})`;
        trustWrap.appendChild(deltaEl);
      }

      const statusEl = doc.createElement('span');
      statusEl.setAttribute('data-test', 'expansion-npc-status');
      statusEl.style.cssText = 'color:#94a3b8;font-size:10.5px;';
      statusEl.textContent = `状态/驻地: ${item.status || '战区在册'}`;

      statusBar.appendChild(trustWrap);
      statusBar.appendChild(statusEl);
      slot.appendChild(statusBar);

      // 3. 主体：简介 + 立体属性行 + 可折叠详细设定
      if (item.desc) {
        const descEl = doc.createElement('p');
        descEl.className = 'tw-extra-slot-summary';
        descEl.setAttribute('data-test', 'expansion-npc-desc');
        descEl.textContent = item.desc;
        slot.appendChild(descEl);
      }

      const npcFields: Array<{ label: string; value: string }> = [];
      if (item.role) npcFields.push({ label: '身份职务', value: item.role });
      if (item.appearance) npcFields.push({ label: '外貌特征', value: item.appearance });
      if (item.personality) npcFields.push({ label: '性格与口吻', value: item.personality });
      if (item.skills) npcFields.push({ label: '能力专长', value: item.skills });
      if (item.background) npcFields.push({ label: '背景履历', value: item.background });
      if (item.recentNote) npcFields.push({ label: '近期交集', value: item.recentNote });

      if (npcFields.length > 0) {
        const kv = doc.createElement('div');
        kv.className = 'tw-extra-kv-table';
        for (const f of npcFields) {
          const row = doc.createElement('div');
          row.className = 'tw-extra-kv-row';
          const k = doc.createElement('span');
          k.className = 'tw-extra-kv-key';
          k.textContent = f.label;
          const v = doc.createElement('span');
          v.className = 'tw-extra-kv-val';
          v.textContent = f.value;
          row.appendChild(k);
          row.appendChild(v);
          kv.appendChild(row);
        }
        slot.appendChild(kv);
      }

      if (item.detail) {
        const detailWrap = doc.createElement('div');
        detailWrap.setAttribute('data-test', 'expansion-npc-detail');
        detailWrap.style.cssText =
          'padding:6px 8px;background:rgba(6,11,20,0.85);border:1px dashed rgba(148,163,184,0.2);font-size:11px;color:#cbd5e1;line-height:1.5;';
        detailWrap.textContent = item.detail;
        slot.appendChild(detailWrap);
      }

      // 4. 底部交互：「▶ 约谈/联络此人」按钮
      const contactBtn = doc.createElement('button');
      contactBtn.type = 'button';
      contactBtn.className = 'tw-npc-contact-btn';
      contactBtn.setAttribute('data-test', 'expansion-npc-contact-btn');
      contactBtn.style.cssText =
        'margin-top:4px;align-self:flex-start;padding:4px 10px;background:rgba(56,189,248,0.14);border:1px solid rgba(56,189,248,0.35);color:#7dd3fc;font-family:inherit;font-size:11px;font-weight:700;cursor:pointer;';
      contactBtn.textContent = '▶ 约谈/联络此人';

      contactBtn.addEventListener('click', () => {
        fillChatInputBox(doc, `联络并约谈【${item.name}】，就当前战区局势交换意见。`);
        contactBtn.textContent = '✓ 已填入指令框';
        if (typeof setTimeout === 'function') {
          setTimeout(() => {
            contactBtn.textContent = '▶ 约谈/联络此人';
          }, 1600);
        }
      });

      slot.appendChild(contactBtn);
      grid.appendChild(slot);
    } else {
      // 非人物扩展条目（科技 / 建筑 / 载具 / 人员 / 装备）
      const slot = doc.createElement('article');
      slot.className = 'tw-extra-card-slot tw-expansion-item-slot';
      slot.setAttribute('data-test', 'expansion-item-card');

      const header = doc.createElement('div');
      header.className = 'tw-extra-slot-header';

      const titleGroup = doc.createElement('div');
      titleGroup.className = 'tw-extra-slot-title-group';

      const codeEl = doc.createElement('span');
      codeEl.className = 'tw-extra-slot-code';
      codeEl.setAttribute('data-test', 'expansion-item-kind');
      codeEl.textContent = `[${item.kind}]`;

      const nameEl = doc.createElement('strong');
      nameEl.className = 'tw-extra-slot-name';
      nameEl.setAttribute('data-test', 'expansion-item-name');
      nameEl.textContent = item.name;

      titleGroup.appendChild(codeEl);
      titleGroup.appendChild(nameEl);
      header.appendChild(titleGroup);
      slot.appendChild(header);

      if (item.desc) {
        const descEl = doc.createElement('p');
        descEl.className = 'tw-extra-slot-summary';
        descEl.setAttribute('data-test', 'expansion-item-desc');
        descEl.textContent = item.desc;
        slot.appendChild(descEl);
      }

      const paramEntries = Object.entries(item.params);
      if (paramEntries.length > 0) {
        const paramRow = doc.createElement('div');
        paramRow.className = 'tw-extra-tag-row';
        paramRow.setAttribute('data-test', 'expansion-item-params');
        for (const [pk, pv] of paramEntries) {
          const chip = doc.createElement('span');
          chip.className = 'tw-extra-tag-chip';
          chip.setAttribute('data-test', 'expansion-item-param');
          chip.textContent = `${pk}: ${pv}`;
          paramRow.appendChild(chip);
        }
        slot.appendChild(paramRow);
      }

      if (item.detail) {
        const detailEl = doc.createElement('div');
        detailEl.setAttribute('data-test', 'expansion-item-detail');
        detailEl.style.cssText =
          'padding:6px 8px;background:rgba(6,11,20,0.85);border:1px dashed rgba(148,163,184,0.2);font-size:11px;color:#cbd5e1;line-height:1.5;';
        detailEl.textContent = item.detail;
        slot.appendChild(detailEl);
      }

      grid.appendChild(slot);
    }
  }

  root.appendChild(grid);
  onLayoutChange?.();
  return root;
}

/**
 * 直接在宿主元素挂载 `<扩展档案>` 卡片（FD-32）
 */
export function mountExpansionDossierCard(host: HTMLElement, rawContent: string): void {
  if (!host || typeof host !== 'object') return;
  const doc =
    host.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.createElement !== 'function') return;

  const parsed = parseExpansionDossierPayload(rawContent);
  const cardDom = buildExpansionDossierCardDom(doc, parsed);

  const mountWrap = doc.createElement('div');
  mountWrap.className = 'tw-floor-card-mount';
  mountWrap.setAttribute('data-test', 'floor-card-mount');
  mountWrap.appendChild(cardDom);
  host.appendChild(mountWrap);

  if (host.dataset) {
    host.dataset.twHydrated = 'true';
  }
  host.setAttribute?.('data-tw-hydrated', 'true');
}

function formatSrcKindBadge(srcKind: string): string {
  switch (srcKind) {
    case '雷达侦察':
      return '📡 雷达侦察';
    case '渗透内线':
      return '🕵️ 渗透内线';
    case '暗网流言':
      return '🕸️ 暗网流言';
    case '电讯截获':
      return '📻 电讯截获';
    case '前线目视':
      return '🔭 前线目视';
    case '宏观广播':
      return '🌍 宏观广播';
    default:
      return `📡 ${srcKind || '前线目视'}`;
  }
}

function formatWorldEvoDomainBadge(domain: string): string {
  switch (domain) {
    case '远方地缘':
      return '🌐 远方地缘';
    case '位面异象':
      return '⚡ 位面异象';
    case '暗流科技':
      return '🔬 暗流科技';
    case '社会黑市':
      return '🏙️ 社会黑市';
    default:
      return `🌐 ${domain || '远方地缘'}`;
  }
}

function resolveIntelCredMeta(
  cred: '高' | '中' | '低',
  status: '待核实' | '已证实' | '已证伪' | '演进中',
): { text: string; style: string } {
  if (status === '已证伪') {
    return {
      text: '已证伪',
      style:
        'color:#fca5a5;background:rgba(127,29,29,0.28);border:1px solid rgba(239,68,68,0.45);text-decoration:line-through;font-weight:700;',
    };
  }
  if (cred === '高' || status === '已证实') {
    return {
      text: `${cred}·已证实`,
      style:
        'color:#4ade80;background:rgba(20,83,45,0.28);border:1px solid rgba(74,222,128,0.45);font-weight:700;',
    };
  }
  if (cred === '低') {
    const label = status === '待核实' ? '低·流言' : `低·${status}`;
    return {
      text: label,
      style:
        'color:#fbbf24;background:rgba(120,53,15,0.28);border:1px solid rgba(245,158,11,0.45);font-weight:700;',
    };
  }
  return {
    text: `${cred}·${status}`,
    style:
      'color:#38bdf8;background:rgba(14,116,144,0.25);border:1px solid rgba(56,189,248,0.42);font-weight:700;',
  };
}

/**
 * 12. 构建 `<情报>` / `<世界演变>` 战区情报与世界暗流卡片（FD-33）
 */
export function buildTacticalIntelCardDom(
  doc: Document,
  parsed: ParsedTacticalIntelCard,
  onLayoutChange?: () => void,
): HTMLElement {
  ensureCardStyleInDoc(doc, 'tw-extra-protocol-cards-style', EXTRA_PROTOCOL_CARDS_CSS);
  const root = doc.createElement('section');
  root.className = 'tw-extra-protocol-card tw-tactical-intel-card';
  root.setAttribute('data-test', 'tactical-intel-card');

  const bannerText =
    parsed.hasTactical && parsed.hasWorld
      ? 'INTEL & WORLD PULSE // 战区情报与世界暗流'
      : parsed.hasWorld
        ? 'WORLD EVOLUTION // 宏观世界暗流'
        : 'TACTICAL INTEL // 战区情报电讯';

  const rackCode =
    parsed.hasTactical && parsed.hasWorld
      ? 'INTEL & PULSE // 情报暗流'
      : parsed.hasWorld
        ? 'WORLD EVO // 世界演变'
        : 'INTEL // 战区情报';

  attachCompactRackHeader(doc, root, {
    code: rackCode,
    title: `${bannerText} (${parsed.items.length}条)`,
    summary: parsed.compactSummary,
    accentColor: parsed.hasWorld ? '#a855f7' : '#38bdf8',
    defaultCollapsed: false,
    onToggle: onLayoutChange,
  });

  const strip = doc.createElement('div');
  strip.className = 'tw-extra-telemetry-strip';
  strip.setAttribute('data-test', 'tactical-intel-banner');
  const s1 = doc.createElement('span');
  s1.textContent = bannerText;
  const s2 = doc.createElement('span');
  s2.textContent = `DISPATCHES: ${parsed.items.length}`;
  strip.appendChild(s1);
  strip.appendChild(s2);
  root.appendChild(strip);

  const grid = doc.createElement('div');
  grid.className = 'tw-extra-card-grid';

  const STAGES = ['萌芽', '发酵', '高潮', '平息'] as const;

  for (const item of parsed.items) {
    if (item.scope === 'world') {
      const slot = doc.createElement('article');
      slot.className = 'tw-extra-card-slot tw-world-evo-slot';
      slot.setAttribute('data-test', 'world-evo-item');

      // 1. 头部：[🌍 世界演变] 标签 + 四象限徽章 + 标题
      const header = doc.createElement('div');
      header.className = 'tw-extra-slot-header';

      const titleGroup = doc.createElement('div');
      titleGroup.className = 'tw-extra-slot-title-group';

      const tagEl = doc.createElement('span');
      tagEl.className = 'tw-extra-slot-code';
      tagEl.textContent = '[🌍 世界演变]';
      titleGroup.appendChild(tagEl);

      const domainEl = doc.createElement('span');
      domainEl.className = 'tw-extra-slot-badge';
      domainEl.setAttribute('data-test', 'world-evo-domain');
      domainEl.textContent = formatWorldEvoDomainBadge(item.evoDomain);
      titleGroup.appendChild(domainEl);

      const titleEl = doc.createElement('strong');
      titleEl.className = 'tw-extra-slot-name';
      titleEl.setAttribute('data-test', 'world-evo-title');
      titleEl.textContent = item.title;
      titleGroup.appendChild(titleEl);

      header.appendChild(titleGroup);
      slot.appendChild(header);

      // 2. 演化阶段与 TTL 热度栏
      const metaBar = doc.createElement('div');
      metaBar.style.cssText =
        'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:4px 8px;background:rgba(15,23,42,0.65);border:1px solid rgba(168,85,247,0.22);font-size:10.5px;';

      const stageWrap = doc.createElement('span');
      stageWrap.setAttribute('data-test', 'world-evo-stage');
      stageWrap.setAttribute('data-stage', item.stage);
      stageWrap.textContent = STAGES.map(s => (s === item.stage ? `[${s}]` : s)).join(' ➔ ');

      const ttlWrap = doc.createElement('span');
      ttlWrap.setAttribute('data-test', 'world-evo-ttl');
      ttlWrap.style.cssText = 'color:#c084fc;font-weight:700;';
      ttlWrap.textContent = `热度余量: ${item.ttlFloors}/5 轮`;

      metaBar.appendChild(stageWrap);
      metaBar.appendChild(ttlWrap);
      slot.appendChild(metaBar);

      if (item.evolvesFrom) {
        const evoFromEl = doc.createElement('div');
        evoFromEl.setAttribute('data-test', 'intel-evolves-from');
        evoFromEl.style.cssText = 'font-size:10.5px;color:#38bdf8;';
        evoFromEl.textContent = `🔗 演进自：「${item.evolvesFrom}」`;
        slot.appendChild(evoFromEl);
      }

      // 3. 正文与伏笔
      const contentEl = doc.createElement('p');
      contentEl.className = 'tw-extra-slot-summary';
      contentEl.setAttribute('data-test', 'world-evo-content');
      contentEl.textContent = item.content;
      slot.appendChild(contentEl);

      if (item.hook) {
        const hookEl = doc.createElement('div');
        hookEl.setAttribute('data-test', 'world-evo-hook');
        hookEl.style.cssText =
          'padding:5px 8px;background:rgba(88,28,135,0.2);border-left:2px solid #c084fc;font-size:11px;color:#e9d5ff;';
        hookEl.textContent = `💡 潜在切入点：${item.hook}`;
        slot.appendChild(hookEl);
      }

      // 4. 底部按钮：「▶ 关注/介入此动向」
      const actBtn = doc.createElement('button');
      actBtn.type = 'button';
      actBtn.className = 'tw-intel-act-btn';
      actBtn.setAttribute('data-test', 'tactical-intel-act-btn');
      actBtn.style.cssText =
        'margin-top:4px;align-self:flex-start;padding:4px 10px;background:rgba(168,85,247,0.16);border:1px solid rgba(168,85,247,0.4);color:#d8b4fe;font-family:inherit;font-size:11px;font-weight:700;cursor:pointer;';
      actBtn.textContent = '▶ 关注/介入此动向';

      actBtn.addEventListener('click', () => {
        fillChatInputBox(
          doc,
          `密切关注并派员介入远方动向【${item.title}】（${item.evoDomain}·${item.stage}），评估我方切入时机。`,
        );
        actBtn.textContent = '✓ 已填入指令框';
        if (typeof setTimeout === 'function') {
          setTimeout(() => {
            actBtn.textContent = '▶ 关注/介入此动向';
          }, 1600);
        }
      });

      slot.appendChild(actBtn);
      grid.appendChild(slot);
    } else {
      // scope === 'tactical' 战区情报条目
      const slot = doc.createElement('article');
      slot.className = 'tw-extra-card-slot tw-tactical-intel-slot';
      slot.setAttribute('data-test', 'tactical-intel-item');

      const header = doc.createElement('div');
      header.className = 'tw-extra-slot-header';

      const titleGroup = doc.createElement('div');
      titleGroup.className = 'tw-extra-slot-title-group';

      const srcKindEl = doc.createElement('span');
      srcKindEl.className = 'tw-extra-slot-code';
      srcKindEl.setAttribute('data-test', 'intel-src-kind');
      srcKindEl.textContent = formatSrcKindBadge(item.srcKind);
      titleGroup.appendChild(srcKindEl);

      const srcEl = doc.createElement('span');
      srcEl.className = 'tw-extra-slot-badge';
      srcEl.setAttribute('data-test', 'intel-src');
      srcEl.textContent = item.src || item.srcKind;
      titleGroup.appendChild(srcEl);

      const titleEl = doc.createElement('strong');
      titleEl.className = 'tw-extra-slot-name';
      titleEl.setAttribute('data-test', 'intel-title');
      titleEl.textContent = item.title;
      titleGroup.appendChild(titleEl);

      const chainText = typeof item.chain === 'string' ? item.chain.trim() : '';
      const chainStepText = typeof item.chainStep === 'string' ? item.chainStep.trim() : '';
      if (chainText || chainStepText) {
        const chainEl = doc.createElement('span');
        chainEl.className = 'tw-extra-slot-badge tw-intel-chain-badge';
        chainEl.setAttribute('data-test', 'intel-chain-badge');
        if (chainText) {
          chainEl.setAttribute('data-intel-chain', chainText);
        }
        if (chainStepText) {
          chainEl.setAttribute('data-intel-chain-step', chainStepText);
        }
        chainEl.style.cssText =
          'color:#fbbf24;background:rgba(120,53,15,0.28);border:1px solid rgba(245,158,11,0.45);font-weight:700;';
        if (chainText && chainStepText) {
          const stepLabel = /[第阶环]/.test(chainStepText)
            ? chainStepText
            : `第 ${chainStepText} 阶`;
          chainEl.textContent = `情报链：${chainText} · ${stepLabel}`;
        } else if (chainText) {
          chainEl.textContent = `情报链：${chainText}`;
        } else {
          chainEl.textContent = `侦察阶数：${chainStepText}`;
        }
        titleGroup.appendChild(chainEl);
      }

      const credMeta = resolveIntelCredMeta(item.cred, item.status);
      const credEl = doc.createElement('span');
      credEl.className = 'tw-extra-slot-badge';
      credEl.setAttribute('data-test', 'intel-cred-badge');
      credEl.style.cssText = credMeta.style;
      credEl.textContent = credMeta.text;

      header.appendChild(titleGroup);
      header.appendChild(credEl);
      slot.appendChild(header);

      if (item.evolvesFrom) {
        const evoFromEl = doc.createElement('div');
        evoFromEl.setAttribute('data-test', 'intel-evolves-from');
        evoFromEl.style.cssText = 'font-size:10.5px;color:var(--tw-theme-accent, #38bdf8);';
        evoFromEl.textContent = `🔗 演进自：「${item.evolvesFrom}」`;
        slot.appendChild(evoFromEl);
      }

      const contentEl = doc.createElement('p');
      contentEl.className = 'tw-extra-slot-summary';
      contentEl.setAttribute('data-test', 'intel-content');
      contentEl.textContent = item.content;
      slot.appendChild(contentEl);

      const nextLeadText = (item.nextLead || item.hook || '').trim();
      if (nextLeadText) {
        const nextLeadEl = doc.createElement('div');
        nextLeadEl.className = 'tw-intel-next-lead';
        nextLeadEl.setAttribute('data-test', 'intel-next-lead');
        nextLeadEl.setAttribute('data-intel-next-lead', nextLeadText);
        nextLeadEl.style.cssText =
          'padding:5px 8px;background:rgba(14,116,144,0.2);border-left:2px solid #38bdf8;font-size:11px;color:#bae6fd;';
        nextLeadEl.textContent = `▸ 下一步核查线索：${nextLeadText}`;
        slot.appendChild(nextLeadEl);
      }

      const actBtn = doc.createElement('button');
      actBtn.type = 'button';
      actBtn.className = 'tw-intel-act-btn';
      actBtn.setAttribute('data-test', 'tactical-intel-act-btn');
      actBtn.style.cssText =
        'margin-top:4px;align-self:flex-start;padding:4px 10px;background:color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 16%, transparent);border:1px solid color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 38%, transparent);color:color-mix(in srgb, var(--tw-theme-accent, #38bdf8) 88%, #ffffff);font-family:inherit;font-size:11px;font-weight:700;cursor:pointer;';
      actBtn.textContent = '▶ 派遣侦察/核查';

      actBtn.addEventListener('click', () => {
        const hasChainCtx = Boolean(chainText || chainStepText || (item.nextLead && item.nextLead.trim()));
        const commandText = hasChainCtx
          ? `【深挖情报链：${chainText || item.title}】调遣侦察与情报部门核查【${item.src || item.srcKind}】线报：「${item.title}」${chainStepText ? `（当前阶数：${chainStepText}）` : ''}${nextLeadText ? `，重点追查：${nextLeadText}` : '，查明真伪与具体坐标'}。`
          : `调遣侦察与情报部门核查【${item.src || item.srcKind}】线报：「${item.title}」，查明真伪与具体坐标。`;
        fillChatInputBox(doc, commandText);
        actBtn.textContent = '✓ 已填入指令框';
        if (typeof setTimeout === 'function') {
          setTimeout(() => {
            actBtn.textContent = '▶ 派遣侦察/核查';
          }, 1600);
        }
      });

      slot.appendChild(actBtn);
      grid.appendChild(slot);
    }
  }

  root.appendChild(grid);
  onLayoutChange?.();
  return root;
}

/**
 * 直接在宿主元素挂载 `<情报>` / `<世界演变>` 卡片（FD-33）
 */
export function mountTacticalIntelCard(
  host: HTMLElement,
  rawContent: string,
  defaultScope?: 'tactical' | 'world',
): void {
  if (!host || typeof host !== 'object') return;
  const doc =
    host.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.createElement !== 'function') return;

  const parsed = parseTacticalIntelPayload(rawContent, defaultScope);
  const cardDom = buildTacticalIntelCardDom(doc, parsed);

  const mountWrap = doc.createElement('div');
  mountWrap.className = 'tw-floor-card-mount';
  mountWrap.setAttribute('data-test', 'floor-card-mount');
  mountWrap.appendChild(cardDom);
  host.appendChild(mountWrap);

  if (host.dataset) {
    host.dataset.twHydrated = 'true';
  }
  host.setAttribute?.('data-tw-hydrated', 'true');
}

export type WorldEvolutionFloorMode = 'hidden' | 'pulse' | 'visible';

export const WORLD_EVO_FLOOR_MODE_STORAGE_KEY = 'rac_world_evo_floor_mode_v1';

let memoryWorldEvoFloorMode: WorldEvolutionFloorMode = 'hidden';
const trackedStealthHosts = new Set<HTMLElement>();

export function getWorldEvolutionFloorMode(): WorldEvolutionFloorMode {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (ls && typeof ls.getItem === 'function') {
      const val = ls.getItem(WORLD_EVO_FLOOR_MODE_STORAGE_KEY);
      if (val === 'visible') return 'visible';
      if (val === 'pulse') return 'pulse';
      if (val === 'hidden') return 'hidden';
    }
  } catch {
    /* ignore storage errors */
  }
  return memoryWorldEvoFloorMode;
}

export function setWorldEvolutionFloorMode(
  mode: WorldEvolutionFloorMode,
  rootDoc?: Document,
): void {
  const normalized: WorldEvolutionFloorMode =
    mode === 'visible' ? 'visible' : mode === 'pulse' ? 'pulse' : 'hidden';
  memoryWorldEvoFloorMode = normalized;
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (ls && typeof ls.setItem === 'function') {
      ls.setItem(WORLD_EVO_FLOOR_MODE_STORAGE_KEY, normalized);
    }
  } catch {
    /* ignore storage errors */
  }
  refreshAllWorldEvolutionStealthHosts(rootDoc);
}

/**
 * 13. 构建 `<部署>` / `<展开>` / `<deploy>` 战区部署与基地展开回执卡片
 */
export function buildDeploymentOrderCardDom(
  doc: Document,
  parsed: DeploymentOrderCardPayload,
  onLayoutChange?: () => void,
): HTMLElement {
  ensureCardStyleInDoc(doc, 'tw-extra-protocol-cards-style', EXTRA_PROTOCOL_CARDS_CSS);
  const root = doc.createElement('section');
  root.className = 'tw-extra-protocol-card tw-deployment-order-card';
  root.setAttribute('data-test', 'deployment-order-card');

  attachCompactRackHeader(doc, root, {
    code: 'DEPLOY // 战区部署与基地展开回执',
    title: `战区部署与基地展开 (${parsed.items.length}项)`,
    summary: parsed.compactSummary,
    accentColor: '#10b981',
    onToggle: onLayoutChange,
  });

  const strip = doc.createElement('div');
  strip.className = 'tw-extra-telemetry-strip';
  const s1 = doc.createElement('span');
  s1.textContent = 'DEPLOY // 战区部署与基地展开回执';
  const s2 = doc.createElement('span');
  s2.textContent = `ITEMS: ${parsed.items.length} | LINES: ${parsed.lineCount}`;
  strip.appendChild(s1);
  strip.appendChild(s2);
  root.appendChild(strip);

  const grid = doc.createElement('div');
  grid.className = 'tw-extra-card-grid';

  for (const item of parsed.items) {
    const slot = doc.createElement('article');
    slot.className = 'tw-extra-card-slot';
    slot.setAttribute('data-test', 'deployment-order-item');

    const header = doc.createElement('div');
    header.className = 'tw-extra-slot-header';

    const titleGroup = doc.createElement('div');
    titleGroup.className = 'tw-extra-slot-title-group';

    const actionEl = doc.createElement('span');
    actionEl.className = 'tw-extra-slot-code';
    actionEl.setAttribute('data-test', 'deployment-order-action');
    actionEl.textContent = item.action;

    const unitEl = doc.createElement('strong');
    unitEl.className = 'tw-extra-slot-name';
    unitEl.setAttribute('data-test', 'deployment-order-unit');
    unitEl.textContent = `${item.unit} ➔ ${item.base}`;

    titleGroup.appendChild(actionEl);
    titleGroup.appendChild(unitEl);

    const statusEl = doc.createElement('span');
    statusEl.className = 'tw-extra-slot-badge';
    statusEl.setAttribute('data-test', 'deployment-order-status');
    statusEl.textContent = item.status;

    header.appendChild(titleGroup);
    header.appendChild(statusEl);
    slot.appendChild(header);

    const descEl = doc.createElement('p');
    descEl.className = 'tw-extra-slot-summary';
    descEl.textContent = item.summary;
    slot.appendChild(descEl);

    const kv = doc.createElement('div');
    kv.className = 'tw-extra-kv-table';
    const basePairs: Array<{ label: string; value: string }> = [
      { label: '目标基地', value: item.base },
      { label: '机动单位', value: item.unit },
    ];
    if (item.location) {
      basePairs.push({ label: '选址方位', value: item.location });
    }
    if (item.sectors.length > 0) {
      basePairs.push({ label: '防区布设', value: item.sectors.join('、') });
    }
    if (item.buildings.length > 0) {
      basePairs.push({ label: '并网建筑', value: item.buildings.join('、') });
    }
    for (const f of item.fields.slice(0, 4)) {
      if (!basePairs.some(bp => bp.label === f.label)) {
        basePairs.push(f);
      }
    }
    for (const p of basePairs) {
      const row = doc.createElement('div');
      row.className = 'tw-extra-kv-row';
      const k = doc.createElement('span');
      k.className = 'tw-extra-kv-key';
      k.textContent = p.label;
      const v = doc.createElement('span');
      v.className = 'tw-extra-kv-val';
      v.textContent = p.value;
      row.appendChild(k);
      row.appendChild(v);
      kv.appendChild(row);
    }
    slot.appendChild(kv);
    grid.appendChild(slot);
  }

  root.appendChild(grid);
  onLayoutChange?.();
  return root;
}

/**
 * 14. 构建 `<资金链>` 战区多元资金链态势卡片
 */
export function buildEconomyChainsCardDom(
  doc: Document,
  parsed: EconomyChainsCardPayload,
  onLayoutChange?: () => void,
): HTMLElement {
  ensureCardStyleInDoc(doc, 'tw-extra-protocol-cards-style', EXTRA_PROTOCOL_CARDS_CSS);
  const root = doc.createElement('section');
  root.className = 'tw-extra-protocol-card tw-economy-chains-card';
  root.setAttribute('data-test', 'economy-chains-card');

  attachCompactRackHeader(doc, root, {
    code: 'CHAIN // 战区多元资金链态势',
    title: `多元资金链与后勤流转 (${parsed.items.length}条)`,
    summary: parsed.compactSummary,
    accentColor: '#f59e0b',
    onToggle: onLayoutChange,
  });

  const strip = doc.createElement('div');
  strip.className = 'tw-extra-telemetry-strip';
  const s1 = doc.createElement('span');
  s1.textContent = 'CHAIN // 战区多元资金链态势';
  const s2 = doc.createElement('span');
  s2.textContent = `CHAINS: ${parsed.items.length}`;
  strip.appendChild(s1);
  strip.appendChild(s2);
  root.appendChild(strip);

  const grid = doc.createElement('div');
  grid.className = 'tw-extra-card-grid';

  for (const item of parsed.items) {
    const slot = doc.createElement('article');
    slot.className = 'tw-extra-card-slot';
    slot.setAttribute('data-test', 'economy-chain-item');

    const header = doc.createElement('div');
    header.className = 'tw-extra-slot-header';

    const titleGroup = doc.createElement('div');
    titleGroup.className = 'tw-extra-slot-title-group';

    const rateEl = doc.createElement('span');
    rateEl.className = 'tw-extra-slot-code';
    rateEl.setAttribute('data-test', 'economy-chain-rate');
    rateEl.textContent = item.dailyRate;

    const nameEl = doc.createElement('strong');
    nameEl.className = 'tw-extra-slot-name';
    nameEl.setAttribute('data-test', 'economy-chain-name');
    nameEl.textContent = item.name;

    titleGroup.appendChild(rateEl);
    titleGroup.appendChild(nameEl);

    const statusEl = doc.createElement('span');
    statusEl.className = 'tw-extra-slot-badge';
    statusEl.setAttribute('data-test', 'economy-chain-status');
    statusEl.textContent = `${item.status} · 效率 ${item.efficiency}`;

    header.appendChild(titleGroup);
    header.appendChild(statusEl);
    slot.appendChild(header);

    if (item.desc) {
      const descEl = doc.createElement('p');
      descEl.className = 'tw-extra-slot-summary';
      descEl.textContent = item.desc;
      slot.appendChild(descEl);
    }

    const kv = doc.createElement('div');
    kv.className = 'tw-extra-kv-table';
    const pairs = [
      { label: '日均流转', value: `${item.dailyRate} (${item.flow})` },
      { label: '运转效率', value: item.efficiency },
      { label: '容量储量', value: item.capacity },
      { label: '挂靠基地', value: item.base },
    ];
    for (const p of pairs) {
      const row = doc.createElement('div');
      row.className = 'tw-extra-kv-row';
      const k = doc.createElement('span');
      k.className = 'tw-extra-kv-key';
      k.textContent = p.label;
      const v = doc.createElement('span');
      v.className = 'tw-extra-kv-val';
      v.textContent = p.value;
      row.appendChild(k);
      row.appendChild(v);
      kv.appendChild(row);
    }
    slot.appendChild(kv);
    grid.appendChild(slot);
  }

  root.appendChild(grid);
  onLayoutChange?.();
  return root;
}

/**
 * 15. 构建 `<世界演变>` 世界演变暗流显化卡片
 */
export function buildWorldEvolutionCardDom(
  doc: Document,
  parsed: WorldEvolutionCardPayload,
  onLayoutChange?: () => void,
): HTMLElement {
  ensureCardStyleInDoc(doc, 'tw-extra-protocol-cards-style', EXTRA_PROTOCOL_CARDS_CSS);
  const root = doc.createElement('section');
  root.className = 'tw-extra-protocol-card tw-world-evolution-card';
  root.setAttribute('data-test', 'world-evolution-card');

  attachCompactRackHeader(doc, root, {
    code: 'WORLD EVO // 世界演变暗流',
    title: `世界演变暗流 (${parsed.items.length}道)`,
    summary: parsed.compactSummary,
    accentColor: '#a855f7',
    defaultCollapsed: false,
    onToggle: onLayoutChange,
  });

  const strip = doc.createElement('div');
  strip.className = 'tw-extra-telemetry-strip';
  strip.setAttribute('data-test', 'world-evolution-banner');
  const s1 = doc.createElement('span');
  s1.textContent = 'WORLD EVO // 世界演变暗流';
  const s2 = doc.createElement('span');
  s2.textContent = `STREAMS: ${parsed.items.length}`;
  strip.appendChild(s1);
  strip.appendChild(s2);
  root.appendChild(strip);

  const grid = doc.createElement('div');
  grid.className = 'tw-extra-card-grid';
  const STAGES = ['萌芽', '发酵', '高潮', '平息'] as const;

  for (const item of parsed.items) {
    const slot = doc.createElement('article');
    slot.className = 'tw-extra-card-slot tw-world-evo-slot';
    slot.setAttribute('data-test', 'world-evo-item');

    const header = doc.createElement('div');
    header.className = 'tw-extra-slot-header';

    const titleGroup = doc.createElement('div');
    titleGroup.className = 'tw-extra-slot-title-group';

    const domainEl = doc.createElement('span');
    domainEl.className = 'tw-extra-slot-code';
    domainEl.setAttribute('data-test', 'world-evo-domain');
    domainEl.textContent = formatWorldEvoDomainBadge(item.domain);

    const titleEl = doc.createElement('strong');
    titleEl.className = 'tw-extra-slot-name';
    titleEl.setAttribute('data-test', 'world-evo-title');
    titleEl.textContent = item.title;

    titleGroup.appendChild(domainEl);
    titleGroup.appendChild(titleEl);

    const regionEl = doc.createElement('span');
    regionEl.className = 'tw-extra-slot-badge';
    regionEl.setAttribute('data-test', 'world-evo-region');
    regionEl.textContent = item.region;

    header.appendChild(titleGroup);
    header.appendChild(regionEl);
    slot.appendChild(header);

    const metaBar = doc.createElement('div');
    metaBar.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:4px 8px;background:rgba(15,23,42,0.65);border:1px solid rgba(168,85,247,0.22);font-size:10.5px;';

    const stageWrap = doc.createElement('span');
    stageWrap.setAttribute('data-test', 'world-evo-stage');
    stageWrap.setAttribute('data-stage', item.stage);
    stageWrap.textContent = STAGES.map(s => (s === item.stage ? `[${s}]` : s)).join(' ➔ ');

    const ttlWrap = doc.createElement('span');
    ttlWrap.setAttribute('data-test', 'world-evo-ttl');
    ttlWrap.style.cssText = 'color:#c084fc;font-weight:700;';
    ttlWrap.textContent = `影响区域: ${item.region} ｜ 热度: ${item.ttlFloors}/5轮`;

    metaBar.appendChild(stageWrap);
    metaBar.appendChild(ttlWrap);
    slot.appendChild(metaBar);

    const contentEl = doc.createElement('p');
    contentEl.className = 'tw-extra-slot-summary';
    contentEl.setAttribute('data-test', 'world-evo-situation');
    contentEl.textContent = item.situation;
    slot.appendChild(contentEl);

    if (item.hook) {
      const hookEl = doc.createElement('div');
      hookEl.setAttribute('data-test', 'world-evo-hook');
      hookEl.style.cssText =
        'padding:5px 8px;background:rgba(88,28,135,0.2);border-left:2px solid #c084fc;font-size:11px;color:#e9d5ff;';
      hookEl.textContent = `💡 潜在切入点：${item.hook}`;
      slot.appendChild(hookEl);
    }

    grid.appendChild(slot);
  }

  root.appendChild(grid);
  onLayoutChange?.();
  return root;
}

function clearElementChildren(el: HTMLElement): void {
  el.innerHTML = '';
  const anyEl = el as unknown as { children?: unknown[]; textContent?: string };
  if (Array.isArray(anyEl.children)) {
    anyEl.children.length = 0;
  }
  anyEl.textContent = '';
}

function isStealthHostContainer(el: HTMLElement | null | undefined): boolean {
  if (!el || typeof el !== 'object') return false;
  const cls = typeof el.className === 'string' ? el.className.split(/\s+/) : [];
  if (cls.includes('tw-floor-card-host') || cls.includes('custom-tw-floor-card-host')) {
    return true;
  }
  const cardType =
    el.dataset?.cardType ??
    el.getAttribute?.('data-card-type') ??
    el.dataset?.twCard ??
    el.getAttribute?.('data-tw-card');
  return cardType === 'world-evolution-stealth';
}

export function mountWorldEvolutionStealthHost(
  mountEl: HTMLElement,
  rawText: string,
  doc?: Document,
): boolean {
  if (!mountEl || typeof mountEl !== 'object') return false;
  const ownerDoc =
    doc ??
    mountEl.ownerDocument ??
    (typeof document !== 'undefined' ? document : null);
  if (!ownerDoc || typeof ownerDoc.createElement !== 'function') return false;

  const isHostItself = isStealthHostContainer(mountEl);
  const hostEl: HTMLElement = isHostItself
    ? mountEl
    : ((mountEl.parentNode as HTMLElement | null) ?? mountEl);

  let targetMount: HTMLElement = mountEl;
  if (isHostItself) {
    const existingMount =
      (mountEl.querySelector?.('.tw-floor-mount') as HTMLElement | null) ??
      (mountEl.querySelector?.('.tw-floor-card-mount') as HTMLElement | null);
    if (existingMount) {
      targetMount = existingMount;
    } else {
      const created = ownerDoc.createElement('div');
      created.className = 'tw-floor-mount';
      mountEl.appendChild(created);
      targetMount = created;
    }
  }

  const effectiveRaw = (
    rawText ||
    mountEl.dataset?.rawWevo ||
    mountEl.getAttribute?.('data-raw-wevo') ||
    hostEl.dataset?.rawWevo ||
    hostEl.getAttribute?.('data-raw-wevo') ||
    ''
  ).trim();

  if (mountEl.dataset) mountEl.dataset.rawWevo = effectiveRaw;
  mountEl.setAttribute?.('data-raw-wevo', effectiveRaw);
  if (hostEl.dataset) hostEl.dataset.rawWevo = effectiveRaw;
  hostEl.setAttribute?.('data-raw-wevo', effectiveRaw);
  if (targetMount.dataset) targetMount.dataset.rawWevo = effectiveRaw;
  targetMount.setAttribute?.('data-raw-wevo', effectiveRaw);

  trackedStealthHosts.add(hostEl);

  const parsedItems = parseTacticalIntelRaw(effectiveRaw, 'world');
  const count = parsedItems.length;
  const iframeEl = hostEl.querySelector?.('iframe.tw-floor-card') as HTMLIFrameElement | null;
  if (iframeEl) {
    if (iframeEl.style) iframeEl.style.display = 'none';
    (iframeEl as { removeAttribute?: (attr: string) => void }).removeAttribute?.('srcdoc');
  }

  clearElementChildren(targetMount);

  if (count === 0) {
    if (targetMount.style) targetMount.style.display = 'none';
    if (mountEl.style) mountEl.style.display = 'none';
    if (hostEl.style) hostEl.style.display = 'none';
    return false;
  }

  const mode = getWorldEvolutionFloorMode();
  if (mode === 'hidden') {
    if (targetMount.style) targetMount.style.display = 'none';
    if (mountEl.style) mountEl.style.display = 'none';
    if (hostEl.style) hostEl.style.display = 'none';

    const hiddenMarker = ownerDoc.createElement('div');
    hiddenMarker.setAttribute('data-test', 'world-evolution-stealth-hidden');
    hiddenMarker.setAttribute('data-count', String(count));
    if (hiddenMarker.style) hiddenMarker.style.display = 'none';
    targetMount.appendChild(hiddenMarker);
  } else if (mode === 'visible') {
    if (targetMount.style) targetMount.style.display = '';
    if (mountEl.style) mountEl.style.display = '';
    if (hostEl.style) hostEl.style.display = '';
    targetMount.className = 'tw-floor-card-mount tw-floor-mount';
    targetMount.setAttribute('data-test', 'floor-card-mount');
    const parsedWevo = parseWorldEvolutionPayload(effectiveRaw);
    const cardDom = buildWorldEvolutionCardDom(ownerDoc, parsedWevo);
    targetMount.appendChild(cardDom);
  } else {
    if (targetMount.style) targetMount.style.display = '';
    if (mountEl.style) mountEl.style.display = '';
    if (hostEl.style) hostEl.style.display = '';

    const pulseBar = ownerDoc.createElement('div');
    pulseBar.className = 'tw-world-evo-stealth-pulse';
    pulseBar.setAttribute('data-test', 'world-evolution-stealth-pulse');
    pulseBar.setAttribute('data-count', String(count));
    pulseBar.style.cssText =
      'padding:3px 10px;font-family:monospace;font-size:10.5px;color:rgba(192,132,252,0.78);background:rgba(15,23,42,0.55);border:1px dashed rgba(168,85,247,0.28);letter-spacing:0.04em;';
    pulseBar.textContent = `🌐 [WORLD STREAM // 监测到 ${count} 道世界暗流静默推演 · 详情见设置面板「世界演变」]`;
    targetMount.appendChild(pulseBar);
  }

  if (hostEl.dataset) hostEl.dataset.twHydrated = '1';
  hostEl.setAttribute?.('data-tw-hydrated', '1');
  return true;
}

export function refreshAllWorldEvolutionStealthHosts(rootDoc?: Document): void {
  const candidates = new Set<HTMLElement>();
  for (const h of trackedStealthHosts) {
    if (h) candidates.add(h);
  }
  const docs: Document[] = [];
  if (rootDoc) docs.push(rootDoc);
  if (typeof document !== 'undefined' && document !== rootDoc) docs.push(document);
  try {
    if (typeof window !== 'undefined' && window.parent?.document && !docs.includes(window.parent.document)) {
      docs.push(window.parent.document);
    }
    if (typeof window !== 'undefined' && window.top?.document && !docs.includes(window.top.document)) {
      docs.push(window.top.document);
    }
  } catch {
    /* ignore cross-origin */
  }

  for (const d of docs) {
    if (!d || typeof d.querySelectorAll !== 'function') continue;
    for (const sel of [
      '[data-card-type="world-evolution-stealth"]',
      '[data-tw-card="world-evolution-stealth"]',
    ]) {
      try {
        const list = d.querySelectorAll(sel);
        for (const el of Array.from(list)) {
          candidates.add(el as HTMLElement);
        }
      } catch {
        /* ignore selector error in mock dom */
      }
    }
  }

  for (const hostEl of candidates) {
    const rawScript =
      (hostEl.querySelector?.('script.tw-floor-raw') as HTMLElement | null) ??
      (hostEl.querySelector?.('script.tw-raw-payload') as HTMLElement | null) ??
      (hostEl.querySelector?.('.tw-floor-raw') as HTMLElement | null);
    const mountChild =
      (hostEl.querySelector?.('.tw-floor-mount') as HTMLElement | null) ?? hostEl;
    const raw =
      hostEl.dataset?.rawWevo ??
      hostEl.getAttribute?.('data-raw-wevo') ??
      mountChild.dataset?.rawWevo ??
      mountChild.getAttribute?.('data-raw-wevo') ??
      rawScript?.textContent ??
      '';
    mountWorldEvolutionStealthHost(
      mountChild,
      raw,
      hostEl.ownerDocument ?? rootDoc,
    );
  }
}
