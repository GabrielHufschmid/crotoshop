import type { Pt } from '../types';

export interface Bounds { x: number; y: number; w: number; h: number }
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export function normalizeRect(ax: number, ay: number, bx: number, by: number): Bounds {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    w: Math.abs(bx - ax),
    h: Math.abs(by - ay),
  };
}

export function constrainBoundsSize(bounds: Bounds, maxDimension: number): Bounds {
  return {
    ...bounds,
    w: Math.max(1, Math.min(maxDimension, bounds.w)),
    h: Math.max(1, Math.min(maxDimension, bounds.h)),
  };
}

/** Axis-aligned extent of a center-rotated rectangle. */
export function rotatedBounds(bounds: Bounds, angle: number): Bounds {
  if (!angle) return { ...bounds };
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.w, y: bounds.y },
    { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
    { x: bounds.x, y: bounds.y + bounds.h },
  ].map((point) => rotatePoint(point, bounds, angle));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function rotatePoint(point: Pt, bounds: Bounds, angle: number): Pt {
  const centerX = bounds.x + bounds.w / 2;
  const centerY = bounds.y + bounds.h / 2;
  const dx = point.x - centerX;
  const dy = point.y - centerY;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: centerX + dx * cos - dy * sin, y: centerY + dx * sin + dy * cos };
}

/** Resizes from an edge/corner. Shift means symmetric edges or fixed-ratio corners. */
export function resizeBounds(
  bounds: Bounds,
  handle: HandleId,
  pointerDx: number,
  pointerDy: number,
  shift: boolean,
): Bounds {
  const dx = handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0;
  const dy = handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0;
  const isCorner = dx !== 0 && dy !== 0;
  let { x, y, w, h } = bounds;

  if (!isCorner && shift) {
    if (dx === 1) { x = bounds.x - pointerDx; w = bounds.w + 2 * pointerDx; }
    if (dx === -1) { x = bounds.x + pointerDx; w = bounds.w - 2 * pointerDx; }
    if (dy === 1) { y = bounds.y - pointerDy; h = bounds.h + 2 * pointerDy; }
    if (dy === -1) { y = bounds.y + pointerDy; h = bounds.h - 2 * pointerDy; }
  } else {
    if (dx === 1) w = bounds.w + pointerDx;
    if (dx === -1) { x = bounds.x + pointerDx; w = bounds.w - pointerDx; }
    if (dy === 1) h = bounds.h + pointerDy;
    if (dy === -1) { y = bounds.y + pointerDy; h = bounds.h - pointerDy; }
    if (isCorner && shift && bounds.w > 0 && bounds.h > 0) {
      const ratio = bounds.w / bounds.h;
      if (Math.abs(w / bounds.w - 1) >= Math.abs(h / bounds.h - 1)) {
        const nextHeight = w / ratio;
        if (dy === -1) y = bounds.y + bounds.h - nextHeight;
        h = nextHeight;
      } else {
        const nextWidth = h * ratio;
        if (dx === -1) x = bounds.x + bounds.w - nextWidth;
        w = nextWidth;
      }
    }
  }

  if (w < 1) {
    if (dx === -1) x = bounds.x + bounds.w - 1;
    w = 1;
  }
  if (h < 1) {
    if (dy === -1) y = bounds.y + bounds.h - 1;
    h = 1;
  }
  return { x, y, w, h };
}
