/**
 * floorCardMounts.ts —— 楼层卡片 DOM 构建与样式注入辅助（阵营解锁 / 航天合同 / 机娘卷宗 / 机娘状态）
 */
import {
  isMaidenShellDeferred,
  type ParsedFactionUnlock,
  type ParsedMaidenDossierCard,
  type ParsedMaidenStatusCard,
  type ParsedSpaceContract,
} from './floorCardParsers';
import { fillHostSendInput } from '../../红警指挥系统/worldbook/hostSendInput';
import { attachCompactRackHeader } from './floorCardExtraMounts';
import {
  ensureCardStyleInDoc,
  FACTION_AND_SPACE_CARD_CSS,
  MAIDEN_DOSSIER_STYLE_CSS,
  MAIDEN_STATUS_STYLE_CSS,
} from './floorCardStyles';

export function buildFactionUnlockCardDom(
  doc: Document,
  parsed: ParsedFactionUnlock,
  onToggleHeightSync?: () => void,
): HTMLElement {
  ensureCardStyleInDoc(doc, 'tw-faction-and-space-card-styles', FACTION_AND_SPACE_CARD_CSS);
  const root = doc.createElement('article');
  root.className = 'tw-faction-unlock-card';
  root.setAttribute('data-test', 'faction-unlock-card');
  root.setAttribute('data-faction', parsed.faction);
  root.style.setProperty('--card-primary', parsed.primaryColor);
  root.style.setProperty('--card-accent', parsed.accentColor);
  root.style.setProperty('--card-bg', parsed.bgColor);

  attachCompactRackHeader(doc, root, {
    code: `${parsed.faction.toUpperCase()} // 阵营启封`,
    title: parsed.title,
    summary: `首发核心：${parsed.starterGirlName}（${parsed.starterGirlModel}）· 初始授权 ${parsed.initialGrants.length} 项`,
    accentColor: parsed.accentColor,
    onToggle: onToggleHeightSync,
  });

  // 0. 顶部机密电传眉头状态轨
  const telemetryStrip = doc.createElement('div');
  telemetryStrip.className = 'tw-faction-telemetry-strip';
  const stripLeft = doc.createElement('span');
  stripLeft.textContent = `CLASSIFIED // SUPREME COMMAND DECREE · FACTION:${parsed.faction.toUpperCase()}`;
  const stripRight = doc.createElement('span');
  stripRight.textContent = 'CLEARANCE: OMEGA-1 // SEALED';
  telemetryStrip.appendChild(stripLeft);
  telemetryStrip.appendChild(stripRight);
  root.appendChild(telemetryStrip);

  // 1. 头部：徽章、徽标、主标题、副标题
  const header = doc.createElement('header');
  header.className = 'tw-faction-unlock-header';

  const badgeRow = doc.createElement('div');
  badgeRow.className = 'tw-faction-unlock-badge-row';

  const badgeEl = doc.createElement('span');
  badgeEl.className = 'tw-faction-unlock-badge';
  badgeEl.setAttribute('data-test', 'faction-badge');
  badgeEl.textContent = parsed.badge;

  const emblemEl = doc.createElement('span');
  emblemEl.className = 'tw-faction-unlock-emblem';
  emblemEl.setAttribute('data-test', 'faction-emblem');
  emblemEl.textContent = parsed.emblem;

  badgeRow.appendChild(badgeEl);
  badgeRow.appendChild(emblemEl);

  const titleEl = doc.createElement('h3');
  titleEl.className = 'tw-faction-unlock-title';
  titleEl.setAttribute('data-test', 'faction-title');
  titleEl.textContent = parsed.title;

  const subtitleEl = doc.createElement('p');
  subtitleEl.className = 'tw-faction-unlock-subtitle';
  subtitleEl.setAttribute('data-test', 'faction-subtitle');
  subtitleEl.textContent = parsed.subtitle;

  header.appendChild(badgeRow);
  header.appendChild(titleEl);
  header.appendChild(subtitleEl);
  root.appendChild(header);

  // 2. 首发 MCV 机娘档案卡
  const girlCard = doc.createElement('section');
  girlCard.className = 'tw-starter-girl-card';
  girlCard.setAttribute('data-test', 'starter-girl-card');

  const girlMeta = doc.createElement('div');
  girlMeta.className = 'tw-starter-girl-meta';

  const girlTag = doc.createElement('span');
  girlTag.className = 'tw-starter-girl-tag';
  girlTag.textContent = 'MCV CORE // 首发机动基地车机娘';

  const girlIdentity = doc.createElement('div');
  girlIdentity.className = 'tw-starter-girl-identity';

  const girlName = doc.createElement('strong');
  girlName.className = 'tw-starter-girl-name';
  girlName.setAttribute('data-test', 'starter-girl-name');
  girlName.textContent = parsed.starterGirlName;

  const girlModel = doc.createElement('span');
  girlModel.className = 'tw-starter-girl-model';
  girlModel.setAttribute('data-test', 'starter-girl-model');
  girlModel.textContent = parsed.starterGirlModel;

  girlIdentity.appendChild(girlName);
  girlIdentity.appendChild(girlModel);
  girlMeta.appendChild(girlTag);
  girlMeta.appendChild(girlIdentity);

  const girlQuote = doc.createElement('blockquote');
  girlQuote.className = 'tw-starter-girl-quote';
  girlQuote.setAttribute('data-test', 'starter-girl-quote');
  girlQuote.textContent = `“${parsed.starterGirlQuote}”`;

  girlCard.appendChild(girlMeta);
  girlCard.appendChild(girlQuote);
  root.appendChild(girlCard);

  // 3. 可折叠「阵营工业与并网详情」手风琴
  const detailsSection = doc.createElement('section');
  detailsSection.className = 'tw-faction-details-section';
  detailsSection.setAttribute('data-test', 'faction-details-section');

  const toggleBtn = doc.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'tw-faction-details-toggle';
  toggleBtn.setAttribute('data-test', 'toggle-details');
  toggleBtn.setAttribute('aria-expanded', 'false');

  const toggleTitle = doc.createElement('span');
  toggleTitle.className = 'tw-faction-details-toggle-title';
  toggleTitle.textContent = '阵营工业与并网详情';

  const toggleIndicator = doc.createElement('span');
  toggleIndicator.className = 'tw-faction-details-toggle-indicator';
  toggleIndicator.setAttribute('data-test', 'toggle-details-indicator');
  toggleIndicator.textContent = `▶ 展开卷宗 (${parsed.details.length})`;

  toggleBtn.appendChild(toggleTitle);
  toggleBtn.appendChild(toggleIndicator);
  detailsSection.appendChild(toggleBtn);

  let isExpanded = false;
  let detailsPanel: HTMLElement | null = null;

  const renderDetailsPanel = () => {
    if (isExpanded) {
      if (!detailsPanel) {
        detailsPanel = doc.createElement('div');
        detailsPanel.className = 'tw-faction-details-panel';
        detailsPanel.setAttribute('data-test', 'details-panel');

        const dl = doc.createElement('dl');
        dl.className = 'tw-faction-details-list';

        for (const item of parsed.details) {
          const row = doc.createElement('div');
          row.className = 'tw-faction-details-item';
          row.setAttribute('data-test', 'detail-item');

          const dt = doc.createElement('dt');
          dt.className = 'tw-faction-details-label';
          dt.textContent = item.label;

          const dd = doc.createElement('dd');
          dd.className = 'tw-faction-details-value';
          dd.textContent = item.value;

          row.appendChild(dt);
          row.appendChild(dd);
          dl.appendChild(row);
        }

        detailsPanel.appendChild(dl);
      }
      detailsSection.appendChild(detailsPanel);
      toggleBtn.setAttribute('aria-expanded', 'true');
      toggleIndicator.textContent = `▼ 收起卷宗 (${parsed.details.length})`;
    } else {
      if (detailsPanel && detailsPanel.parentNode === detailsSection) {
        detailsSection.removeChild(detailsPanel);
      }
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleIndicator.textContent = `▶ 展开卷宗 (${parsed.details.length})`;
    }
    onToggleHeightSync?.();
  };

  toggleBtn.addEventListener('click', () => {
    isExpanded = !isExpanded;
    renderDetailsPanel();
  });

  root.appendChild(detailsSection);

  // 4. 初始战区授权回执绿灯列表
  const grantsFooter = doc.createElement('footer');
  grantsFooter.className = 'tw-initial-grants-section';
  grantsFooter.setAttribute('data-test', 'initial-grants');

  const grantsHeader = doc.createElement('div');
  grantsHeader.className = 'tw-initial-grants-header';

  const grantLed = doc.createElement('span');
  grantLed.className = 'tw-grant-led';
  grantLed.textContent = '●';

  const grantsTitle = doc.createElement('span');
  grantsTitle.className = 'tw-initial-grants-title';
  grantsTitle.textContent = '初始战区授权回执';

  grantsHeader.appendChild(grantLed);
  grantsHeader.appendChild(grantsTitle);

  const grantsList = doc.createElement('ul');
  grantsList.className = 'tw-initial-grants-list';

  for (const grant of parsed.initialGrants) {
    const li = doc.createElement('li');
    li.className = 'tw-initial-grant-item';
    li.setAttribute('data-test', 'grant-item');

    const dot = doc.createElement('span');
    dot.className = 'tw-grant-item-dot';
    dot.textContent = '🟢';

    const text = doc.createElement('span');
    text.className = 'tw-grant-item-text';
    text.textContent = grant;

    li.appendChild(dot);
    li.appendChild(text);
    grantsList.appendChild(li);
  }

  grantsFooter.appendChild(grantsHeader);
  grantsFooter.appendChild(grantsList);
  root.appendChild(grantsFooter);

  return root;
}

export function buildSpaceContractCardOrderText(parsed: ParsedSpaceContract): string {
  const boosterText = parsed.recoverBooster ? '回收复用' : '一次性消耗';
  return [
    `【航天指令】批准执行航天发射合同「${parsed.title}」（编号：${parsed.id}，发射场：${parsed.base}，运载火箭：${parsed.rocket}，有效载荷：${parsed.payload}，一级助推器：${boosterText}）。请参谋部核对发射窗口并组织点火升空。`,
    '<航天合同>',
    `编号: ${parsed.id}`,
    `名称: ${parsed.title}`,
    `类型: ${parsed.kind}`,
    `运载火箭: ${parsed.rocket}`,
    `有效载荷: ${parsed.payload}`,
    `发射场: ${parsed.base}`,
    `报酬: ${parsed.rewardCredits}`,
    `回收助推器: ${parsed.recoverBooster ? '是' : '否'}`,
    '状态: launching',
    '</航天合同>',
  ].join('\n');
}

export function buildSpaceContractCardDom(
  doc: Document,
  parsed: ParsedSpaceContract,
  onLayoutChange?: () => void,
): HTMLElement {
  ensureCardStyleInDoc(doc, 'tw-faction-and-space-card-styles', FACTION_AND_SPACE_CARD_CSS);
  const card = doc.createElement('section');
  const isHold = Boolean(parsed.weatherHoldReason) || /顺延|hold|delay|延误/i.test(parsed.status);
  card.className = isHold
    ? 'tw-space-contract-card has-weather-hold'
    : 'tw-space-contract-card';
  card.setAttribute('data-test', 'space-contract-card');
  card.setAttribute('data-contract-id', parsed.id);

  attachCompactRackHeader(doc, card, {
    code: `${parsed.id} // 航天发射`,
    title: parsed.title,
    summary: `${parsed.kind} · ${parsed.rocket} · 报酬 $${parsed.rewardCredits} · ${parsed.status}`,
    accentColor: isHold ? '#f59e0b' : 'var(--tw-theme-accent, #38bdf8)',
    onToggle: onLayoutChange,
  });

  const header = doc.createElement('header');
  header.className = 'tw-space-contract-header';

  const idBadge = doc.createElement('span');
  idBadge.className = 'tw-space-contract-id';
  idBadge.textContent = parsed.id;

  const titleEl = doc.createElement('h3');
  titleEl.className = 'tw-space-contract-title';
  titleEl.textContent = parsed.title;

  const kindBadge = doc.createElement('span');
  kindBadge.className = 'tw-space-contract-kind';
  kindBadge.setAttribute('data-test', 'space-contract-kind');
  kindBadge.textContent = parsed.kind;

  const statusBadge = doc.createElement('span');
  statusBadge.className = 'tw-space-contract-status';
  statusBadge.setAttribute('data-test', 'space-contract-status');
  statusBadge.textContent = parsed.status;

  header.appendChild(idBadge);
  header.appendChild(titleEl);
  header.appendChild(kindBadge);
  header.appendChild(statusBadge);
  card.appendChild(header);

  const grid = doc.createElement('div');
  grid.className = 'tw-space-contract-grid';

  const fields: Array<{ label: string; value: string; testId: string }> = [
    { label: '运载火箭', value: parsed.rocket, testId: 'space-contract-rocket' },
    { label: '有效载荷', value: parsed.payload, testId: 'space-contract-payload' },
    { label: '发射场', value: parsed.base, testId: 'space-contract-base' },
    { label: '里程碑报酬', value: `$${parsed.rewardCredits}`, testId: 'space-contract-reward' },
    {
      label: '一级助推器',
      value: parsed.recoverBooster ? '可回收复用' : '一次性消耗',
      testId: 'space-contract-booster',
    },
  ];

  for (const field of fields) {
    const item = doc.createElement('div');
    item.className = 'tw-space-contract-field';
    item.setAttribute('data-test', field.testId);

    const labelEl = doc.createElement('span');
    labelEl.className = 'tw-space-contract-field-label';
    labelEl.textContent = field.label;

    const valEl = doc.createElement('strong');
    valEl.className = 'tw-space-contract-field-value';
    valEl.textContent = field.value;

    item.appendChild(labelEl);
    item.appendChild(valEl);
    grid.appendChild(item);
  }

  card.appendChild(grid);

  if (parsed.weatherHoldReason) {
    const weatherEl = doc.createElement('div');
    weatherEl.className = 'tw-space-contract-weather';
    weatherEl.setAttribute('data-test', 'space-contract-weather');
    weatherEl.textContent = `气象窗口提示：${parsed.weatherHoldReason}`;
    card.appendChild(weatherEl);
  }

  const isFinished = /^(completed|已完成|完成|in_orbit|在轨|已入轨|运转|运转中|在轨运行|正常)$/i.test(
    String(parsed.status ?? '').trim(),
  );
  if (!isFinished) {
    const actionsEl = doc.createElement('div');
    actionsEl.className = 'tw-space-contract-actions';
    actionsEl.setAttribute('data-test', 'space-contract-actions');

    const hintEl = doc.createElement('span');
    hintEl.className = 'tw-space-contract-action-hint';
    hintEl.textContent = '指令将填入下方聊天输入框，确认后手动发送';

    const dispatchBtn = doc.createElement('button');
    dispatchBtn.type = 'button';
    dispatchBtn.className = 'tw-space-contract-dispatch-btn';
    dispatchBtn.setAttribute('data-test', 'space-contract-dispatch-btn');
    dispatchBtn.textContent = isHold ? '🌤️ 填入窗口候命指令' : '🚀 签署并填入点火指令';
    dispatchBtn.addEventListener('click', () => {
      fillHostSendInput(buildSpaceContractCardOrderText(parsed));
      dispatchBtn.textContent = '✓ 已填入指令栏';
      dispatchBtn.setAttribute('data-dispatched', 'true');
    });

    actionsEl.appendChild(hintEl);
    actionsEl.appendChild(dispatchBtn);
    card.appendChild(actionsEl);
  }

  onLayoutChange?.();
  return card;
}

export const buildAerospaceContractCardDom = buildSpaceContractCardDom;

export function buildMaidenDossierCardDom(
  doc: Document,
  payload: ParsedMaidenDossierCard,
  onToggleExpand?: () => void,
): HTMLElement {
  ensureCardStyleInDoc(doc, 'tw-maiden-dossier-card-style', MAIDEN_DOSSIER_STYLE_CSS);

  const root = doc.createElement('article');
  root.className = 'tw-maiden-dossier-card';
  root.setAttribute('data-test', 'maiden-dossier-card');
  root.setAttribute('data-maiden-name', payload.name);
  root.setAttribute('data-maiden-serial', payload.serial);
  root.setAttribute('data-maiden-seq', payload.seq);
  const isDefaultBlue =
    payload.colors.accent.trim().toLowerCase() === '#38bdf8' &&
    payload.colors.primary.trim().toLowerCase() === '#2563eb';
  root.style.setProperty(
    '--card-primary',
    isDefaultBlue ? 'var(--tw-theme-primary, #2563eb)' : payload.colors.primary,
  );
  root.style.setProperty(
    '--card-accent',
    isDefaultBlue ? 'var(--tw-theme-accent, #38bdf8)' : payload.colors.accent,
  );
  root.style.setProperty(
    '--card-bg',
    isDefaultBlue ? 'var(--tw-theme-panel, #0b1324)' : payload.colors.bg,
  );

  const displayName =
    payload.callsign && payload.callsign !== payload.name
      ? `${payload.callsign}（${payload.name}）`
      : payload.name || payload.callsign;

  attachCompactRackHeader(doc, root, {
    code: `DOSSIER // #${payload.serial}`,
    title: `【${displayName}】${payload.model}`,
    summary: `${payload.factionLabel} · ${payload.seq || '首台原型'} · ${payload.status || '心智核心已锚定'}`,
    accentColor: isDefaultBlue ? 'var(--tw-theme-accent, #38bdf8)' : payload.colors.accent,
    onToggle: onToggleExpand,
  });

  // 1. 顶部火漆与抬头
  const header = doc.createElement('header');
  header.className = 'tw-maiden-dossier-header';

  const sealEl = doc.createElement('span');
  sealEl.className = 'tw-maiden-dossier-seal';
  sealEl.textContent = 'MAIDEN DOSSIER // 战区机娘正式入列档案';

  const seqBadge = doc.createElement('span');
  seqBadge.className = 'tw-maiden-dossier-seq';
  seqBadge.setAttribute('data-test', 'maiden-seq-badge');
  seqBadge.textContent = payload.seq || '首台原型';

  header.appendChild(sealEl);
  header.appendChild(seqBadge);
  root.appendChild(header);

  // 2. 身份铭牌区
  const identityRow = doc.createElement('div');
  identityRow.className = 'tw-maiden-dossier-identity';

  const nameEl = doc.createElement('strong');
  nameEl.className = 'tw-maiden-dossier-name';
  nameEl.setAttribute('data-test', 'maiden-dossier-name');
  nameEl.textContent = `【${displayName}】`;

  const serialEl = doc.createElement('span');
  serialEl.className = 'tw-maiden-dossier-stamp';
  serialEl.setAttribute('data-test', 'maiden-dossier-serial');
  serialEl.textContent = `出厂钢印 #${payload.serial}`;

  const modelEl = doc.createElement('span');
  modelEl.className = 'tw-maiden-dossier-stamp';
  modelEl.setAttribute('data-test', 'maiden-dossier-model');
  modelEl.textContent = `机体型号：${payload.model}`;

  const factionEl = doc.createElement('span');
  factionEl.className = 'tw-maiden-dossier-stamp';
  factionEl.setAttribute('data-test', 'maiden-dossier-faction');
  factionEl.textContent = `所属阵营：${payload.factionLabel}`;

  identityRow.appendChild(nameEl);
  identityRow.appendChild(serialEl);
  identityRow.appendChild(modelEl);
  identityRow.appendChild(factionEl);
  root.appendChild(identityRow);

  // 3. 常驻主视区
  // 3.1 【纳米躯壳与外观（身子）】
  const bodySec = doc.createElement('section');
  bodySec.className = 'tw-maiden-dossier-section';
  bodySec.setAttribute('data-test', 'maiden-dossier-body-section');

  const bodyTitle = doc.createElement('div');
  bodyTitle.className = 'tw-maiden-dossier-section-title';
  bodyTitle.textContent = '【机体与外貌特征】';

  const bodyContent = doc.createElement('div');
  bodyContent.className = 'tw-maiden-dossier-section-body';
  bodyContent.setAttribute('data-test', 'maiden-dossier-body');
  const bodyParts = [
    payload.body ? `躯体特征：${payload.body}` : '',
    payload.appearance ? `外观外貌：${payload.appearance}` : '',
  ].filter(Boolean);
  bodyContent.textContent = bodyParts.join(' ｜ ') || '标准纳米人形构造体';

  bodySec.appendChild(bodyTitle);
  bodySec.appendChild(bodyContent);
  root.appendChild(bodySec);

  // 3.2 【心智性格与现状】
  const mindSec = doc.createElement('section');
  mindSec.className = 'tw-maiden-dossier-section';
  mindSec.setAttribute('data-test', 'maiden-dossier-mind-section');

  const mindTitle = doc.createElement('div');
  mindTitle.className = 'tw-maiden-dossier-section-title';
  mindTitle.textContent = '【心智性格与现状】';

  const mindContent = doc.createElement('div');
  mindContent.className = 'tw-maiden-dossier-section-body';
  mindContent.setAttribute('data-test', 'maiden-dossier-personality');
  const mindParts = [
    payload.personality ? `性格特质：${payload.personality}` : '',
    payload.status ? `当前现状：${payload.status}` : '',
  ].filter(Boolean);
  mindContent.textContent = mindParts.join(' ｜ ') || '心智核心已锚定';

  mindSec.appendChild(mindTitle);
  mindSec.appendChild(mindContent);
  root.appendChild(mindSec);

  // 3.3 【对外社会外壳】
  const shellSec = doc.createElement('section');
  shellSec.className = 'tw-maiden-dossier-section';
  shellSec.setAttribute('data-test', 'maiden-dossier-shell-section');

  const shellTitle = doc.createElement('div');
  shellTitle.className = 'tw-maiden-dossier-section-title';
  shellTitle.textContent = '【对外伪装身份】';
  shellSec.appendChild(shellTitle);

  if (isMaidenShellDeferred(payload.shell, payload.alias)) {
    const deferredEl = doc.createElement('div');
    deferredEl.className = 'tw-maiden-shell-deferred';
    deferredEl.setAttribute('data-test', 'maiden-shell-deferred');
    deferredEl.textContent = '[LOCKED] 基地内勤 · 尚未安排对外伪装身份（执行外勤时解锁）';
    shellSec.appendChild(deferredEl);
  } else {
    const wovenEl = doc.createElement('div');
    wovenEl.className = 'tw-maiden-shell-woven';
    wovenEl.setAttribute('data-test', 'maiden-shell-woven');
    const shellText = [payload.alias, payload.shell].filter(Boolean).join(' · ');
    wovenEl.textContent = shellText;
    shellSec.appendChild(wovenEl);
  }
  root.appendChild(shellSec);

  // 4. 可折叠手风琴
  const accordionWrap = doc.createElement('section');
  accordionWrap.className = 'tw-maiden-dossier-accordion';

  const toggleBtn = doc.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'tw-maiden-dossier-toggle';
  toggleBtn.setAttribute('data-test', 'maiden-dossier-toggle');
  toggleBtn.setAttribute('aria-expanded', 'false');
  toggleBtn.textContent = '▶ 展开战术能力与武装暴露分档';
  accordionWrap.appendChild(toggleBtn);

  let expanded = false;
  let detailsPanel: HTMLElement | null = null;

  const syncAccordionDom = () => {
    if (expanded) {
      if (!detailsPanel) {
        detailsPanel = doc.createElement('div');
        detailsPanel.className = 'tw-maiden-dossier-details';
        detailsPanel.setAttribute('data-test', 'maiden-dossier-details');

        const specEntries: Array<{ label: string; value: string; testId: string }> = [
          { label: '形态机制', value: payload.form_mech || '常规纳米重构', testId: 'maiden-form-mech' },
          { label: '专属能力', value: payload.skills || '制式协同作战', testId: 'maiden-skills' },
          { label: '结构短板', value: payload.flaws || '暂无显著短板记录', testId: 'maiden-flaws' },
          { label: '制式武装', value: payload.weapons || '车载主武器系统', testId: 'maiden-weapons' },
          { label: '暴露分档', value: payload.exposure || 'EL-0 ~ EL-4 标准分级', testId: 'maiden-exposure' },
          { label: '平衡位置', value: payload.balance || '战区主力节点', testId: 'maiden-balance' },
        ];

        for (const entry of specEntries) {
          const row = doc.createElement('div');
          row.className = 'tw-maiden-dossier-spec-row';
          row.setAttribute('data-test', entry.testId);
          row.textContent = `${entry.label}：${entry.value}`;
          detailsPanel.appendChild(row);
        }
      }
      accordionWrap.appendChild(detailsPanel);
      toggleBtn.setAttribute('aria-expanded', 'true');
      toggleBtn.textContent = '▼ 收起战术卷宗';
    } else {
      if (detailsPanel && detailsPanel.parentNode === accordionWrap) {
        accordionWrap.removeChild(detailsPanel);
      }
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.textContent = '▶ 展开战术能力与武装暴露分档';
    }
    onToggleExpand?.();
  };

  toggleBtn.addEventListener('click', () => {
    expanded = !expanded;
    syncAccordionDom();
  });

  root.appendChild(accordionWrap);
  return root;
}

function formatMetricDeltaText(delta: number | undefined): string {
  if (delta === undefined || !Number.isFinite(delta) || delta === 0) return '';
  return delta > 0 ? `+${delta}` : `${delta}`;
}

export function buildMaidenStatusCardDom(
  doc: Document,
  payload: ParsedMaidenStatusCard,
  onToggleExpand?: () => void,
): HTMLElement {
  ensureCardStyleInDoc(doc, 'tw-maiden-status-card-style', MAIDEN_STATUS_STYLE_CSS);

  const root = doc.createElement('section');
  root.className = 'tw-maiden-status-card';
  root.setAttribute('data-test', 'maiden-status-card');

  const firstItem = payload.items[0];
  const hasUnchristened = payload.items.some(i => i.unchristened);
  const rackSummary = payload.items
    .map(i =>
      i.unchristened
        ? `#${i.serial || 'NEW'} 待授名 (${i.model || '初诞构造体'})`
        : `${i.callsign || i.name} (HP:${i.hp} 好感:${i.affection}/服从:${i.obedience})`,
    )
    .join(' ｜ ');

  attachCompactRackHeader(doc, root, {
    code: hasUnchristened ? 'EMERGENCE // 初诞待授名' : 'MAIDEN // 状态同步',
    title:
      payload.items.length === 1 && firstItem
        ? firstItem.unchristened
          ? `初诞机娘 #${firstItem.serial || 'UNASSIGNED'} · 待赐代号`
          : `机娘状态同步 · ${firstItem.callsign || firstItem.name}`
        : `机娘战列状态同步 (${payload.items.length}名)`,
    summary: rackSummary || '机娘心智遥测同步就绪',
    accentColor: hasUnchristened ? '#f59e0b' : 'var(--tw-theme-accent, #38bdf8)',
    onToggle: onToggleExpand,
  });

  for (const item of payload.items) {
    const itemEl = doc.createElement('article');
    itemEl.className = item.unchristened
      ? 'tw-maiden-status-item is-unchristened'
      : 'tw-maiden-status-item is-christened';
    itemEl.setAttribute('data-test', 'maiden-status-item');
    itemEl.setAttribute('data-unchristened', item.unchristened ? 'true' : 'false');

    if (item.unchristened) {
      // 初诞待授名态
      const banner = doc.createElement('div');
      banner.className = 'tw-maiden-unchristened-banner';
      banner.setAttribute('data-test', 'maiden-unchristened-banner');
      banner.textContent = '[NANITE EMERGENCE] // 新生机娘唤醒 · 等待指挥官命名';
      itemEl.appendChild(banner);

      const metaRow = doc.createElement('div');
      metaRow.className = 'tw-maiden-unchristened-meta';

      const serialEl = doc.createElement('strong');
      serialEl.setAttribute('data-test', 'maiden-serial');
      serialEl.textContent = `出厂编号：${item.serial || 'UNASSIGNED'}`;

      const modelSeqEl = doc.createElement('span');
      modelSeqEl.setAttribute('data-test', 'maiden-model-seq');
      modelSeqEl.textContent = ` ｜ 机体型号：${item.model || '未知型号'} · ${item.seq || '初诞个体'}`;

      metaRow.appendChild(serialEl);
      metaRow.appendChild(modelSeqEl);
      itemEl.appendChild(metaRow);

      const bodyBlock = doc.createElement('div');
      bodyBlock.className = 'tw-maiden-unchristened-field';
      bodyBlock.setAttribute('data-test', 'maiden-body');
      bodyBlock.textContent = `【机体与外貌特征】：${item.body || item.appearance || '刚脱离纳米温床的初生构造体'}`;
      itemEl.appendChild(bodyBlock);

      const personalityBlock = doc.createElement('div');
      personalityBlock.className = 'tw-maiden-unchristened-field';
      personalityBlock.setAttribute('data-test', 'maiden-personality');
      personalityBlock.textContent = `【初生性格与姿态】：${item.personality || item.status || '懵懂待命，目光追随指挥官'}`;
      itemEl.appendChild(personalityBlock);

      const hintFooter = doc.createElement('footer');
      hintFooter.className = 'tw-maiden-unchristened-hint';
      hintFooter.setAttribute('data-test', 'maiden-unchristened-hint');
      hintFooter.textContent =
        '[COMMAND] 请在下一轮对话中为她赐予【专属名字】，完成正式入列登记';
      itemEl.appendChild(hintFooter);
    } else {
      // 日常状态同步态
      const header = doc.createElement('header');
      header.className = 'tw-maiden-status-header';

      const nameEl = doc.createElement('strong');
      nameEl.className = 'tw-maiden-status-name';
      nameEl.setAttribute('data-test', 'maiden-name');
      nameEl.textContent = item.callsign || item.name;

      const metaEl = doc.createElement('span');
      metaEl.className = 'tw-maiden-status-meta';
      metaEl.setAttribute('data-test', 'maiden-meta');
      const metaParts = [item.serial ? `#${item.serial}` : '', item.model, item.seq].filter(Boolean);
      metaEl.textContent = metaParts.join(' · ');

      const hpBadge = doc.createElement('span');
      hpBadge.className = 'tw-maiden-status-hp';
      hpBadge.setAttribute('data-test', 'maiden-hp');
      hpBadge.textContent = `HP: ${item.hp}`;

      header.appendChild(nameEl);
      header.appendChild(metaEl);
      header.appendChild(hpBadge);
      itemEl.appendChild(header);

      // 好感度与服从度进度条
      const metricsRow = doc.createElement('div');
      metricsRow.className = 'tw-maiden-status-metrics';

      const affBox = doc.createElement('div');
      affBox.className = 'tw-maiden-metric-box';
      affBox.setAttribute('data-test', 'maiden-affection');
      const affLabel = doc.createElement('span');
      affLabel.textContent = `好感度 ${item.affection}/100`;
      affBox.appendChild(affLabel);
      const affDeltaText = formatMetricDeltaText(item.affectionDelta);
      if (affDeltaText) {
        const affDeltaBadge = doc.createElement('span');
        affDeltaBadge.className = 'tw-maiden-metric-delta';
        affDeltaBadge.setAttribute('data-test', 'affection-delta');
        affDeltaBadge.textContent = affDeltaText;
        affBox.appendChild(affDeltaBadge);
      }

      const obeBox = doc.createElement('div');
      obeBox.className = 'tw-maiden-metric-box';
      obeBox.setAttribute('data-test', 'maiden-obedience');
      const obeLabel = doc.createElement('span');
      obeLabel.textContent = `服从度 ${item.obedience}/100`;
      obeBox.appendChild(obeLabel);
      const obeDeltaText = formatMetricDeltaText(item.obedienceDelta);
      if (obeDeltaText) {
        const obeDeltaBadge = doc.createElement('span');
        obeDeltaBadge.className = 'tw-maiden-metric-delta';
        obeDeltaBadge.setAttribute('data-test', 'obedience-delta');
        obeDeltaBadge.textContent = obeDeltaText;
        obeBox.appendChild(obeDeltaBadge);
      }

      metricsRow.appendChild(affBox);
      metricsRow.appendChild(obeBox);
      itemEl.appendChild(metricsRow);

      // 动态字段更新区（身子 / 性格 / 当前状态 / 社会外壳）
      const updatesList = doc.createElement('div');
      updatesList.className = 'tw-maiden-status-updates';
      updatesList.setAttribute('data-test', 'maiden-updates');

      if (item.body) {
        const row = doc.createElement('div');
        row.setAttribute('data-test', 'maiden-body');
        row.textContent = `身子特征：${item.body}`;
        updatesList.appendChild(row);
      }
      if (item.personality) {
        const row = doc.createElement('div');
        row.setAttribute('data-test', 'maiden-personality');
        row.textContent = `性格表现：${item.personality}`;
        updatesList.appendChild(row);
      }
      if (item.status || item.duty) {
        const row = doc.createElement('div');
        row.setAttribute('data-test', 'maiden-current-status');
        row.textContent = `当前状态：${[item.duty, item.status].filter(Boolean).join(' · ')}`;
        updatesList.appendChild(row);
      }
      if (item.shell || item.alias) {
        const row = doc.createElement('div');
        row.setAttribute('data-test', 'maiden-shell');
        row.textContent = `社会外壳：${[item.alias, item.shell].filter(Boolean).join(' · ')}`;
        updatesList.appendChild(row);
      }
      itemEl.appendChild(updatesList);

      // #特征标签 芯片
      if (item.traits.length > 0) {
        const traitsRow = doc.createElement('div');
        traitsRow.className = 'tw-maiden-status-traits';
        traitsRow.setAttribute('data-test', 'maiden-traits');
        for (const t of item.traits) {
          const chip = doc.createElement('span');
          chip.className = 'tw-maiden-trait-chip';
          chip.setAttribute('data-test', 'maiden-trait-chip');
          chip.textContent = `#${t.replace(/^#/, '')}`;
          traitsRow.appendChild(chip);
        }
        itemEl.appendChild(traitsRow);
      }
    }

    root.appendChild(itemEl);
  }

  onToggleExpand?.();
  return root;
}
