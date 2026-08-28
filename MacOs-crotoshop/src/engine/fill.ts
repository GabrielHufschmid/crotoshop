import type { Layer, Pt, RGB, Selection } from '../types';
import { bumpCanvasVersion, ctx2d } from './canvasUtils';
import { renderLayerSource } from './compositor';
import { floodMatch, selectionContains } from './selection';
import { documentToLayerPoint, layerToDocumentPoint } from './layerGeometry';

/**
 * Paint-bucket fill: flood-matches from the clicked pixel (same tolerance
 * semantics as the magic wand) and paints the matched region with `color`.
 * When a selection exists the fill is clipped to it, using the mask alpha as
 * per-pixel coverage so smoothed/feathered selections blend at the edges.
 * Mutates the layer canvas in place. Returns false when nothing was painted.
 */
export function bucketFill(
  layer: Layer,
  docPt: Pt,
  color: RGB,
  tolerance: number,
  contiguous: boolean,
  sel: Selection | null,
): boolean {
  const local = documentToLayerPoint(layer, docPt);
  const lx = Math.floor(local.x);
  const ly = Math.floor(local.y);
  const w = layer.canvas.width;
  const h = layer.canvas.height;
  if (lx < 0 || ly < 0 || lx >= w || ly >= h) return false;
  if (sel && !selectionContains(sel, docPt)) return false;

  // El match de tolerancia usa la apariencia con ajustes aplicados (lo que
  // el usuario ve en pantalla), no los píxeles crudos — mismo criterio que
  // la varita mágica. El pintado sigue leyendo/escribiendo la capa real.
  const sample = ctx2d(renderLayerSource(layer)).getImageData(0, 0, w, h).data;
  const { selected } = floodMatch(sample, w, h, lx, ly, tolerance, contiguous);

  const g = ctx2d(layer.canvas);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;

  let mask: Uint8ClampedArray | null = null;
  let mw = 0;
  let mh = 0;
  if (sel) {
    mw = sel.mask.width;
    mh = sel.mask.height;
    mask = ctx2d(sel.mask).getImageData(0, 0, mw, mh).data;
  }

  const [r, gr, b] = color;
  let painted = 0;
  for (let i = 0; i < w * h; i++) {
    if (!selected[i]) continue;
    let cov = 255;
    if (mask) {
      const projected = layerToDocumentPoint(layer, { x: (i % w) + 0.5, y: Math.floor(i / w) + 0.5 });
      const dx = Math.floor(projected.x);
      const dy = Math.floor(projected.y);
      if (dx < 0 || dy < 0 || dx >= mw || dy >= mh) continue;
      cov = mask[(dy * mw + dx) * 4 + 3];
      if (cov === 0) continue;
    }
    const j = i * 4;
    // Composite the fill source-over with `cov` as source coverage.
    const t = cov / 255;
    const oldA = d[j + 3] / 255;
    const outA = t + oldA * (1 - t);
    if (outA <= 0) continue;
    d[j] = Math.round((r * t + d[j] * oldA * (1 - t)) / outA);
    d[j + 1] = Math.round((gr * t + d[j + 1] * oldA * (1 - t)) / outA);
    d[j + 2] = Math.round((b * t + d[j + 2] * oldA * (1 - t)) / outA);
    d[j + 3] = Math.round(outA * 255);
    painted++;
  }
  if (!painted) return false;
  g.putImageData(img, 0, 0);
  bumpCanvasVersion(layer.canvas);
  return true;
}
