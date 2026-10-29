/**
 * useSvgPanZoomCanvas.ts —— 天基交互式 SVG 蓝图画布平移缩放控制器（PKG-B · D5-A+PZ）
 *
 * 职责：
 * 1. 管理 SVG 视口平移（panX, panY）、缩放（zoom: 0.5 ~ 2.5）与拖拽状态（isDragging）；
 * 2. 提供 `transformAttr` 计算属性：`translate(panX, panY) scale(zoom)`；
 * 3. 提供 `zoomIn`、`zoomOut`、`setZoom`、`resetView`、`focusPoint` 及指针拖拽/滚轮事件处理器。
 */

import { computed, ref } from 'vue';

export const MIN_CANVAS_ZOOM = 0.5;
export const MAX_CANVAS_ZOOM = 2.5;
export const DEFAULT_ZOOM_STEP = 0.2;
export const DEFAULT_VIEWPORT_CENTER_X = 400;
export const DEFAULT_VIEWPORT_CENTER_Y = 230;

export interface SvgPanZoomOptions {
  minZoom?: number;
  maxZoom?: number;
  zoomStep?: number;
  centerX?: number;
  centerY?: number;
}

export function clampCanvasZoom(value: number, min = MIN_CANVAS_ZOOM, max = MAX_CANVAS_ZOOM): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(max, Math.max(min, Number(value.toFixed(3))));
}

export function useSvgPanZoomCanvas(options: SvgPanZoomOptions = {}) {
  const minZoom = options.minZoom ?? MIN_CANVAS_ZOOM;
  const maxZoom = options.maxZoom ?? MAX_CANVAS_ZOOM;
  const zoomStep = options.zoomStep ?? DEFAULT_ZOOM_STEP;
  const centerX = options.centerX ?? DEFAULT_VIEWPORT_CENTER_X;
  const centerY = options.centerY ?? DEFAULT_VIEWPORT_CENTER_Y;

  const panX = ref(0);
  const panY = ref(0);
  const zoom = ref(1);
  const isDragging = ref(false);

  const dragStartClientX = ref(0);
  const dragStartClientY = ref(0);
  const dragOriginPanX = ref(0);
  const dragOriginPanY = ref(0);
  const activePointerId = ref<number | null>(null);

  let cachedSvgRect: { left: number; top: number; width: number; height: number } | null = null;
  let cachedRectTimestamp = 0;
  const RECT_CACHE_TTL_MS = 250;

  function readCachedOrFreshRect(
    el: SVGSVGElement | HTMLElement | Element | null,
    forceRefresh = false,
  ): { left: number; top: number; width: number; height: number } | null {
    if (!el || typeof el.getBoundingClientRect !== 'function') return null;
    const now = Date.now();
    if (!forceRefresh && cachedSvgRect && now - cachedRectTimestamp < RECT_CACHE_TTL_MS) {
      return cachedSvgRect;
    }
    const r = el.getBoundingClientRect();
    cachedSvgRect = { left: r.left, top: r.top, width: r.width, height: r.height };
    cachedRectTimestamp = now;
    return cachedSvgRect;
  }

  const transformAttr = computed(
    () => `translate(${panX.value.toFixed(1)}, ${panY.value.toFixed(1)}) scale(${zoom.value.toFixed(3)})`,
  );

  const zoomPercent = computed(() => Math.round(zoom.value * 100));

  function setZoom(targetZoom: number, pivotX = centerX, pivotY = centerY): void {
    const prevZoom = zoom.value || 1;
    const nextZoom = clampCanvasZoom(targetZoom, minZoom, maxZoom);
    if (Math.abs(nextZoom - prevZoom) < 1e-4) {
      zoom.value = nextZoom;
      return;
    }
    const stageX = (pivotX - panX.value) / prevZoom;
    const stageY = (pivotY - panY.value) / prevZoom;
    panX.value = Number((pivotX - stageX * nextZoom).toFixed(1));
    panY.value = Number((pivotY - stageY * nextZoom).toFixed(1));
    zoom.value = nextZoom;
  }

  function zoomIn(pivotX = centerX, pivotY = centerY): void {
    setZoom(zoom.value + zoomStep, pivotX, pivotY);
  }

  function zoomOut(pivotX = centerX, pivotY = centerY): void {
    setZoom(zoom.value - zoomStep, pivotX, pivotY);
  }

  function resetView(): void {
    panX.value = 0;
    panY.value = 0;
    zoom.value = 1;
    isDragging.value = false;
    activePointerId.value = null;
    cachedSvgRect = null;
  }

  function focusPoint(svgX: number, svgY: number, targetZoom = 1.35): void {
    const nextZoom = clampCanvasZoom(targetZoom, minZoom, maxZoom);
    zoom.value = nextZoom;
    panX.value = Number((centerX - svgX * nextZoom).toFixed(1));
    panY.value = Number((centerY - svgY * nextZoom).toFixed(1));
  }

  function onPointerDown(event: PointerEvent | MouseEvent): void {
    if ('button' in event && typeof event.button === 'number' && event.button !== 0) {
      return;
    }
    const targetEl = event.target as HTMLElement | SVGElement | null;
    if (targetEl?.closest?.('[data-canvas-no-drag="true"]')) {
      return;
    }
    isDragging.value = true;
    dragStartClientX.value = event.clientX ?? 0;
    dragStartClientY.value = event.clientY ?? 0;
    dragOriginPanX.value = panX.value;
    dragOriginPanY.value = panY.value;
    const currentTarget = event.currentTarget as Element | null;
    readCachedOrFreshRect(currentTarget, true);
    if ('pointerId' in event && typeof event.pointerId === 'number') {
      activePointerId.value = event.pointerId;
      if (currentTarget && typeof currentTarget.setPointerCapture === 'function') {
        try {
          currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // 忽略测试环境或非活动指针下的捕获异常
        }
      }
    }
  }

  function onPointerMove(event: PointerEvent | MouseEvent): void {
    if (!isDragging.value) return;
    if (
      activePointerId.value !== null &&
      'pointerId' in event &&
      typeof event.pointerId === 'number' &&
      event.pointerId !== activePointerId.value
    ) {
      return;
    }
    const dx = (event.clientX ?? 0) - dragStartClientX.value;
    const dy = (event.clientY ?? 0) - dragStartClientY.value;
    panX.value = Number((dragOriginPanX.value + dx).toFixed(1));
    panY.value = Number((dragOriginPanY.value + dy).toFixed(1));
  }

  function onPointerUp(event?: PointerEvent | MouseEvent): void {
    if (!isDragging.value) return;
    if (
      event &&
      activePointerId.value !== null &&
      'pointerId' in event &&
      typeof event.pointerId === 'number'
    ) {
      const currentTarget = event.currentTarget as Element | null;
      if (currentTarget && typeof currentTarget.releasePointerCapture === 'function') {
        try {
          currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          // 忽略无捕获状态释放异常
        }
      }
    }
    isDragging.value = false;
    activePointerId.value = null;
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault?.();
    const deltaY = event.deltaY ?? 0;
    if (deltaY === 0) return;

    let pivotX = centerX;
    let pivotY = centerY;
    const currentTarget = event.currentTarget as SVGSVGElement | HTMLElement | null;
    const rect = readCachedOrFreshRect(currentTarget, false);
    if (rect && rect.width > 0 && rect.height > 0 && typeof event.clientX === 'number' && typeof event.clientY === 'number') {
      pivotX = ((event.clientX - rect.left) / rect.width) * (centerX * 2);
      pivotY = ((event.clientY - rect.top) / rect.height) * (centerY * 2);
    }

    const factor = deltaY < 0 ? 1 : -1;
    setZoom(zoom.value + factor * (zoomStep * 0.75), pivotX, pivotY);
  }

  return {
    panX,
    panY,
    zoom,
    zoomPercent,
    isDragging,
    transformAttr,
    setZoom,
    zoomIn,
    zoomOut,
    resetView,
    focusPoint,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
  };
}
