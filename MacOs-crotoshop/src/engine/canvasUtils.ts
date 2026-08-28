import type { Adjustments, Layer } from '../types';
import { DEFAULT_ADJUSTMENTS } from '../types';

let idCounter = 0;
export function uid(prefix = 'l'): string {
  idCounter += 1;
  return `${prefix}${Date.now().toString(36)}${idCounter}`;
}

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d');
  if (!g) throw new Error('No 2D context');
  return g;
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = createCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

/** Draw a source image/canvas into a fresh canvas of the given size. */
export function toCanvas(
  src: CanvasImageSource,
  w: number,
  h: number,
): HTMLCanvasElement {
  const c = createCanvas(w, h);
  ctx2d(c).drawImage(src, 0, 0, w, h);
  return c;
}

export function makeThumb(src: HTMLCanvasElement, max = 68): string {
  const scale = Math.min(max / src.width, max / src.height, 1);
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const c = createCanvas(w, h);
  const g = ctx2d(c);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  // WEBP pesa ~3× menos que PNG para thumbs; los navegadores sin encoder
  // (Safari viejo) devuelven PNG automáticamente ante un type no soportado.
  return c.toDataURL('image/webp', 0.8);
}

// ── Versionado de canvas ─────────────────────────────────────────────
// Con el historial copy-on-write los snapshots comparten canvases, y el
// compositor cachea resultados de filtro por identidad de canvas. Las pocas
// operaciones que mutan píxeles in-place (borrador, balde, borrar selección)
// bumpean la versión para invalidar ese cache.

const canvasVersions = new WeakMap<HTMLCanvasElement, number>();

export function bumpCanvasVersion(c: HTMLCanvasElement): void {
  canvasVersions.set(c, (canvasVersions.get(c) ?? 0) + 1);
}

export function canvasVersion(c: HTMLCanvasElement): number {
  return canvasVersions.get(c) ?? 0;
}

export function cloneAdjustments(a: Adjustments): Adjustments {
  return {
    ...a,
    recolor: { ...a.recolor, color: [...a.recolor.color] as [number, number, number] },
  };
}

export function makeLayer(
  canvas: HTMLCanvasElement,
  name: string,
  x = 0,
  y = 0,
): Layer {
  return {
    id: uid(),
    name,
    visible: true,
    opacity: 1,
    x,
    y,
    canvas,
    adjustments: cloneAdjustments(DEFAULT_ADJUSTMENTS),
    thumb: makeThumb(canvas),
  };
}

/** Deep-ish clone of a layer, copying its raster into a new canvas (for history). */
export function cloneLayer(l: Layer): Layer {
  return {
    ...l,
    canvas: cloneCanvas(l.canvas),
    mask: l.mask ? { ...l.mask, canvas: cloneCanvas(l.mask.canvas) } : undefined,
    adjustments: cloneAdjustments(l.adjustments),
  };
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
