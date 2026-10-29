/**
 * buildingFlowLayout.ts
 * 基于 @dagrejs/dagre + @vue-flow/core 契约的基地建筑五大体系自动 DAG 拓扑排布引擎（FD-36）
 * 纯函数、零副作用，支持 cluster（骨干聚簇视图）与 expanded（全分支子建筑展开视图）。
 */
import { graphlib, layout as dagreLayout } from '@dagrejs/dagre';
import type { Edge as VueFlowEdge, Node as VueFlowNode } from '@vue-flow/core';
import {
  normalizeBuildingFactionFilter,
  type BuildingBlueprintNode,
  type BuildingNodeState,
  type BuildingSystemView,
  type SystemCatalogEntry,
} from './buildingSystemHelpers';

export type BuildingTopologyViewMode = 'cluster' | 'expanded';

export const FLOW_NODE_WIDTH = 172;
export const FLOW_NODE_HEIGHT = 58;
export const FLOW_CHILD_NODE_WIDTH = 160;
export const FLOW_CHILD_NODE_HEIGHT = 50;

export interface ComputedBlueprintLayoutNode {
  id: string;
  parentNodeId?: string;
  isExpandedChild?: boolean;
  displayName: string;
  displayShortLabel: string;
  laneLabel: string;
  faction: string;
  factionBadge?: string;
  dimmedByFaction: boolean;
  state: BuildingNodeState;
  builtCount: number;
  runningCount: number;
  offlineCount: number;
  productionModeCount: number;
  accelModeCount: number;
  dualModeCapable?: boolean;
  isOriginConyard?: boolean;
  buildingProgress?: number;
  statusText: string;
  hint: string;
  cost?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  clusterItems: SystemCatalogEntry[];
  rawNode?: BuildingBlueprintNode;
}

export interface ComputedBlueprintLayoutEdge {
  id: string;
  from: string;
  to: string;
  path: string;
  stroke: string;
  active: boolean;
  feedback?: boolean;
  marker: string;
  label?: string;
  labelX?: number;
  labelY?: number;
}

export interface ComputedSystemDagreLayout {
  width: number;
  height: number;
  nodes: ComputedBlueprintLayoutNode[];
  edges: ComputedBlueprintLayoutEdge[];
  flowNodes: VueFlowNode<ComputedBlueprintLayoutNode>[];
  flowEdges: VueFlowEdge<ComputedBlueprintLayoutEdge>[];
}

export interface ComputeSystemDagreLayoutOptions {
  viewMode?: BuildingTopologyViewMode;
  factionFilter?: string;
  hideOtherFactionExclusive?: boolean;
}

function buildCubicEdgePath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  feedback: boolean,
): { path: string; labelX: number; labelY: number } {
  if (feedback) {
    const midX = (sx + tx) / 2;
    const bottomY = Math.max(sy, ty) + 56;
    return {
      path: `M ${sx} ${sy} C ${sx + 36} ${bottomY}, ${tx - 36} ${bottomY}, ${tx} ${ty}`,
      labelX: midX,
      labelY: bottomY - 12,
    };
  }
  const dx = Math.max(36, Math.abs(tx - sx) * 0.45);
  return {
    path: `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`,
    labelX: (sx + tx) / 2,
    labelY: (sy + ty) / 2 - 8,
  };
}

function resolveFactionShortBadge(faction: string): string | undefined {
  if (faction === 'allied') return '盟';
  if (faction === 'soviet') return '苏';
  if (faction === 'yuri') return '尤';
  if (faction === 'rising_sun') return '升';
  if (faction === 'foehn') return '焚';
  if (faction && faction !== 'common' && faction !== 'all') {
    return faction.slice(0, 1).toUpperCase();
  }
  return undefined;
}

/**
 * 计算单套建筑体系的自动 DAG 拓扑布局：
 * - cluster 模式：使用 Dagre 自动排布体系骨干节点（可按阵营过滤排他未建节点并桥接连线）
 * - expanded 模式：将拥有多个同簇世界书建筑的骨干节点自动展开为子级拓扑卡片，消除多建筑折叠盲区
 */
export function computeSystemDagreLayout(
  systemView: BuildingSystemView,
  options: ComputeSystemDagreLayoutOptions = {},
): ComputedSystemDagreLayout {
  const viewMode: BuildingTopologyViewMode = options.viewMode ?? 'cluster';
  const normFilter = normalizeBuildingFactionFilter(options.factionFilter ?? 'all');
  const hideOther = Boolean(options.hideOtherFactionExclusive) && normFilter !== 'all' && normFilter !== 'common';

  // 1. 筛选可见骨干节点
  const visibleBackboneNodes = systemView.nodes.filter(node => {
    if (!hideOther) return true;
    if (node.builtCount > 0 || node.state === 'building') return true;
    const nodeFac = node.faction ?? 'common';
    if (nodeFac === 'common' || nodeFac === normFilter) return true;
    if (node.factionVariants?.[normFilter]) return true;
    return false;
  });
  const visibleBackboneIds = new Set(visibleBackboneNodes.map(n => n.id));

  // 2. 初始化 Dagre 有向图
  const g = new graphlib.Graph({ multigraph: false, compound: false });
  g.setGraph({
    rankdir: 'LR',
    nodesep: viewMode === 'expanded' ? 22 : 28,
    ranksep: viewMode === 'expanded' ? 58 : 72,
    marginx: 36,
    marginy: 36,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const rawLayoutNodes: ComputedBlueprintLayoutNode[] = [];
  const rawEdges: Array<{
    id: string;
    from: string;
    to: string;
    label?: string;
    feedback?: boolean;
  }> = [];

  for (const node of visibleBackboneNodes) {
    const layoutNode: ComputedBlueprintLayoutNode = {
      id: node.id,
      displayName: node.displayName,
      displayShortLabel: node.displayShortLabel,
      laneLabel: node.laneLabel,
      faction: node.faction ?? 'common',
      factionBadge: node.factionBadge,
      dimmedByFaction: node.dimmedByFaction,
      state: node.state,
      builtCount: node.builtCount,
      runningCount: node.runningCount,
      offlineCount: node.offlineCount,
      productionModeCount: node.productionModeCount,
      accelModeCount: node.accelModeCount,
      dualModeCapable: node.dualModeCapable,
      isOriginConyard: node.isOriginConyard,
      buildingProgress: node.buildingProgress,
      statusText: node.statusText,
      hint: node.hint,
      x: node.x,
      y: node.y,
      width: FLOW_NODE_WIDTH,
      height: FLOW_NODE_HEIGHT,
      clusterItems: node.clusterItems,
      rawNode: node,
    };
    rawLayoutNodes.push(layoutNode);
    g.setNode(node.id, { width: FLOW_NODE_WIDTH, height: FLOW_NODE_HEIGHT });

    // 在 expanded 模式下展开同簇子建筑（排除与母节点同名的首项，避免重复卡片）
    if (viewMode === 'expanded' && node.clusterItems.length > 1) {
      const expandableChildren = node.clusterItems.filter(item => {
        if (item.name === node.displayName || item.name === node.name) return false;
        if (normFilter !== 'all' && normFilter !== 'common') {
          if (item.faction !== 'common' && item.faction !== normFilter) return false;
        }
        return true;
      });
      expandableChildren.forEach((child, idx) => {
        const childId = `${node.id}__sub__${idx}`;
        const childLayoutNode: ComputedBlueprintLayoutNode = {
          id: childId,
          parentNodeId: node.id,
          isExpandedChild: true,
          displayName: child.name,
          displayShortLabel: child.name,
          laneLabel: child.subGroup || node.laneLabel,
          faction: child.faction,
          factionBadge: resolveFactionShortBadge(child.faction),
          dimmedByFaction:
            normFilter !== 'all' &&
            normFilter !== 'common' &&
            child.faction !== 'common' &&
            child.faction !== normFilter,
          state: child.state,
          builtCount: child.builtCount,
          runningCount: child.builtCount,
          offlineCount: 0,
          productionModeCount: child.builtCount,
          accelModeCount: 0,
          statusText: child.statusText,
          hint: child.prereqText,
          cost: child.cost,
          x: node.x + 180,
          y: node.y,
          width: FLOW_CHILD_NODE_WIDTH,
          height: FLOW_CHILD_NODE_HEIGHT,
          clusterItems: [child],
          rawNode: node,
        };
        rawLayoutNodes.push(childLayoutNode);
        g.setNode(childId, { width: FLOW_CHILD_NODE_WIDTH, height: FLOW_CHILD_NODE_HEIGHT });
        const edgeId = `e_exp_${node.id}_${idx}`;
        rawEdges.push({
          id: edgeId,
          from: node.id,
          to: childId,
        });
        g.setEdge(node.id, childId, { weight: 2 });
      });
    }
  }

  // 3. 添加骨干边（若中间排他节点被隐藏，自动桥接前驱与后继）
  for (const edge of systemView.edges) {
    if (visibleBackboneIds.has(edge.from) && visibleBackboneIds.has(edge.to)) {
      rawEdges.push(edge);
      if (!edge.feedback) {
        g.setEdge(edge.from, edge.to, { weight: 1 });
      }
    }
  }
  if (hideOther) {
    for (const hiddenNode of systemView.nodes) {
      if (visibleBackboneIds.has(hiddenNode.id)) continue;
      const incoming = systemView.edges.filter(e => !e.feedback && e.to === hiddenNode.id && visibleBackboneIds.has(e.from));
      const outgoing = systemView.edges.filter(e => !e.feedback && e.from === hiddenNode.id && visibleBackboneIds.has(e.to));
      for (const inc of incoming) {
        for (const out of outgoing) {
          const bridgeId = `e_bridge_${inc.from}_${out.to}`;
          if (!rawEdges.some(e => e.from === inc.from && e.to === out.to)) {
            rawEdges.push({ id: bridgeId, from: inc.from, to: out.to });
            g.setEdge(inc.from, out.to, { weight: 1 });
          }
        }
      }
    }
  }

  // 4. 运行 Dagre 自动分层排布
  dagreLayout(g);

  let maxRight = 960;
  let maxBottom = 460;
  const nodeMap = new Map<string, ComputedBlueprintLayoutNode>();

  for (const node of rawLayoutNodes) {
    const dagreNode = g.node(node.id) as { x?: number; y?: number } | undefined;
    if (dagreNode && Number.isFinite(dagreNode.x) && Number.isFinite(dagreNode.y)) {
      node.x = Math.round(dagreNode.x!);
      node.y = Math.round(dagreNode.y!);
    }
    maxRight = Math.max(maxRight, node.x + node.width / 2 + 44);
    maxBottom = Math.max(maxBottom, node.y + node.height / 2 + 44);
    nodeMap.set(node.id, node);
  }

  // 5. 生成平滑贝塞尔边与 VueFlow 兼容结构
  const computedEdges: ComputedBlueprintLayoutEdge[] = [];
  for (const e of rawEdges) {
    const src = nodeMap.get(e.from);
    const dst = nodeMap.get(e.to);
    if (!src || !dst) continue;
    const sx = e.feedback ? src.x : src.x + src.width / 2;
    const sy = e.feedback ? src.y + src.height / 2 : src.y;
    const tx = e.feedback ? dst.x : dst.x - dst.width / 2;
    const ty = e.feedback ? dst.y + dst.height / 2 : dst.y;
    const { path, labelX, labelY } = buildCubicEdgePath(sx, sy, tx, ty, Boolean(e.feedback));

    const active = src.state === 'built' && (dst.state === 'built' || dst.state === 'unlocked' || dst.state === 'building');
    const stroke = e.feedback ? '#10b981' : active ? '#38bdf8' : '#334155';
    const marker = e.feedback ? 'url(#arrow-feedback)' : active ? 'url(#arrow-active)' : 'url(#arrow-muted)';

    computedEdges.push({
      id: e.id,
      from: e.from,
      to: e.to,
      path,
      stroke,
      active,
      feedback: e.feedback,
      marker,
      label: e.label,
      labelX,
      labelY,
    });
  }

  const flowNodes: VueFlowNode<ComputedBlueprintLayoutNode>[] = rawLayoutNodes.map(n => ({
    id: n.id,
    type: n.isExpandedChild ? 'sub-building' : 'backbone-building',
    position: {
      x: Math.round(n.x - n.width / 2),
      y: Math.round(n.y - n.height / 2),
    },
    data: n,
  }));

  const flowEdges: VueFlowEdge<ComputedBlueprintLayoutEdge>[] = computedEdges.map(e => ({
    id: e.id,
    source: e.from,
    target: e.to,
    animated: e.active || Boolean(e.feedback),
    label: e.label,
    data: e,
  }));

  return {
    width: Math.max(960, Math.round(maxRight)),
    height: Math.max(460, Math.round(maxBottom)),
    nodes: rawLayoutNodes,
    edges: computedEdges,
    flowNodes,
    flowEdges,
  };
}
