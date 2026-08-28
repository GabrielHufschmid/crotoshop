import type { Adjustments, Doc, Layer } from '../types';
import { isNeutral } from '../types';
import { canvasVersion, createCanvas, ctx2d } from './canvasUtils';
import { getFilter } from './glFilter';
import { effectiveLayerBounds } from './layerGeometry';

/**
 * Cache del filtro por capa: sin esto, cada recomposición re-sube la textura
 * y corre el shader para TODAS las capas con ajustes, aunque lo que cambió
 * sea otra capa (mover, opacidad, pan del historial…). La clave combina la
 * identidad del canvas (el COW lo reemplaza cuando cambian los píxeles), la
 * versión (mutaciones in-place la bumpean) y los ajustes serializados.
 * El GLFilter devuelve siempre su canvas interno, así que el resultado se
 * copia a un canvas propio por capa (reutilizado entre corridas).
 */
const filterCache = new WeakMap<HTMLCanvasElement, { key: string; out: HTMLCanvasElement }>();

/** Returns the pixels to draw for a layer, baking adjustments when needed.
 *  Falls back to the raw canvas if the GPU filter is unavailable/fails so a
 *  filter error can never blank the whole editor. */
export function renderLayerSource(layer: Layer): HTMLCanvasElement {
  if (isNeutral(layer.adjustments)) return layer.canvas;
  const key = `${JSON.stringify(layer.adjustments)}@${canvasVersion(layer.canvas)}`;
  const hit = filterCache.get(layer.canvas);
  if (hit && hit.key === key) return hit.out;
  try {
    const filtered = getFilter().apply(layer.canvas, layer.adjustments);
    let out = hit?.out;
    if (!out || out.width !== filtered.width || out.height !== filtered.height) {
      out = createCanvas(filtered.width, filtered.height);
    } else {
      ctx2d(out).clearRect(0, 0, out.width, out.height);
    }
    ctx2d(out).drawImage(filtered, 0, 0);
    filterCache.set(layer.canvas, { key, out });
    return out;
  } catch (err) {
    console.error('Filter failed, drawing raw layer:', err);
    return layer.canvas;
  }
}

function renderMaskedLayerSource(layer: Layer): HTMLCanvasElement {
  const src = renderLayerSource(layer);
  if (!layer.mask?.enabled) return src;
  const out = createCanvas(src.width, src.height);
  const g = ctx2d(out);
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(layer.mask.canvas, 0, 0, out.width, out.height);
  g.globalCompositeOperation = 'source-over';
  return out;
}

function applyStackAdjustment(target: HTMLCanvasElement, adjustments: Adjustments): void {
  if (isNeutral(adjustments)) return;
  try {
    const filtered = getFilter().apply(target, adjustments);
    const g = ctx2d(target);
    g.clearRect(0, 0, target.width, target.height);
    g.drawImage(filtered, 0, 0);
  } catch (err) {
    console.error('Adjustment layer failed:', err);
  }
}

function drawRasterLayer(target: HTMLCanvasElement, layer: Layer): void {
  const g = ctx2d(target);
  const src = renderMaskedLayerSource(layer);
  const w = layer.w ?? layer.canvas.width;
  const h = layer.h ?? layer.canvas.height;
  g.save();
  g.globalAlpha = layer.opacity;
  g.globalCompositeOperation = layer.blendMode ?? 'source-over';
  if (layer.rotation || layer.flipX || layer.flipY) {
    g.translate(layer.x + w / 2, layer.y + h / 2);
    g.rotate(layer.rotation ?? 0);
    g.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
    g.drawImage(src, -w / 2, -h / 2, w, h);
  } else {
    g.drawImage(src, layer.x, layer.y, w, h);
  }
  g.restore();
}

function compositeLevel(target: HTMLCanvasElement, doc: Doc, parentId: string | undefined, ancestors: Set<string>): void {
  const groupIds = new Set(doc.layers.filter((layer) => layer.kind === 'group').map((layer) => layer.id));
  const belongsHere = (layer: Layer) => parentId
    ? layer.parentId === parentId
    : !layer.parentId || !groupIds.has(layer.parentId);

  for (const layer of doc.layers) {
    if (!belongsHere(layer) || !layer.visible || layer.opacity <= 0) continue;
    if (layer.kind === 'adjustment' && layer.adjustmentLayer) {
      applyStackAdjustment(target, layer.adjustmentLayer);
      continue;
    }
    if (layer.kind !== 'group') {
      drawRasterLayer(target, layer);
      continue;
    }
    if (ancestors.has(layer.id)) continue;
    const nested = new Set(ancestors);
    nested.add(layer.id);
    const groupCanvas = createCanvas(doc.width, doc.height);
    compositeLevel(groupCanvas, doc, layer.id, nested);
    const g = ctx2d(target);
    const bounds = effectiveLayerBounds(doc, layer);
    g.save();
    g.globalAlpha = layer.opacity;
    g.globalCompositeOperation = layer.blendMode ?? 'source-over';
    if (layer.rotation || layer.flipX || layer.flipY) {
      const cx = bounds.x + bounds.w / 2;
      const cy = bounds.y + bounds.h / 2;
      g.translate(cx, cy);
      g.rotate(layer.rotation ?? 0);
      g.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
      g.drawImage(groupCanvas, -cx, -cy);
    } else {
      g.drawImage(groupCanvas, 0, 0);
    }
    g.restore();
  }
}

/** Composites all visible layers of `doc` onto `target` (sized to the document). */
export function composite(target: HTMLCanvasElement, doc: Doc): void {
  if (target.width !== doc.width || target.height !== doc.height) {
    target.width = doc.width;
    target.height = doc.height;
  }
  const g = ctx2d(target);
  g.clearRect(0, 0, target.width, target.height);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  compositeLevel(target, doc, undefined, new Set());
}

/** Produces a fresh flattened canvas of the whole document (for export). */
export function flatten(doc: Doc): HTMLCanvasElement {
  const out = createCanvas(doc.width, doc.height);
  composite(out, doc);
  return out;
}
