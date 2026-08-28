import type { Adjustments, Doc, Layer } from '../types';
import { isNeutral } from '../types';
import { canvasVersion, createCanvas, ctx2d } from './canvasUtils';
import { getFilter } from './glFilter';
import { effectiveLayerBounds } from './layerGeometry';
import { effectiveLayerMask } from './layerMask';

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
const maskCache = new WeakMap<HTMLCanvasElement, {
  source: HTMLCanvasElement;
  sourceVersion: number;
  adjustmentKey: string;
  mask: HTMLCanvasElement;
  maskVersion: number;
  maskDensity: number;
  maskFeather: number;
  out: HTMLCanvasElement;
}>();
const groupCanvasCache = new Map<string, HTMLCanvasElement>();

function adjustmentsKey(a: Adjustments): string {
  const recolor = a.recolor;
  return [
    a.brightness,
    a.contrast,
    a.saturation,
    a.gamma,
    a.hue,
    a.invert,
    recolor.enabled ? 1 : 0,
    recolor.color[0],
    recolor.color[1],
    recolor.color[2],
    recolor.preserveLuma ? 1 : 0,
  ].join(':');
}

/** Returns the pixels to draw for a layer, baking adjustments when needed.
 *  Falls back to the raw canvas if the GPU filter is unavailable/fails so a
 *  filter error can never blank the whole editor. */
export function renderLayerSource(layer: Layer): HTMLCanvasElement {
  if (isNeutral(layer.adjustments)) return layer.canvas;
  const key = `${adjustmentsKey(layer.adjustments)}@${canvasVersion(layer.canvas)}`;
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
  const sourceVersion = canvasVersion(layer.canvas);
  const maskVersion = canvasVersion(layer.mask.canvas);
  const maskDensity = layer.mask.density ?? 1;
  const maskFeather = layer.mask.feather ?? 0;
  const adjustmentKey = adjustmentsKey(layer.adjustments);
  const hit = maskCache.get(layer.canvas);
  if (
    hit
    && hit.source === src
    && hit.sourceVersion === sourceVersion
    && hit.adjustmentKey === adjustmentKey
    && hit.mask === layer.mask.canvas
    && hit.maskVersion === maskVersion
    && hit.maskDensity === maskDensity
    && hit.maskFeather === maskFeather
  ) return hit.out;
  const out = hit?.out && hit.out.width === src.width && hit.out.height === src.height
    ? hit.out
    : createCanvas(src.width, src.height);
  const g = ctx2d(out);
  g.clearRect(0, 0, out.width, out.height);
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(effectiveLayerMask(layer.mask), 0, 0, out.width, out.height);
  g.globalCompositeOperation = 'source-over';
  maskCache.set(layer.canvas, {
    source: src,
    sourceVersion,
    adjustmentKey,
    mask: layer.mask.canvas,
    maskVersion,
    maskDensity,
    maskFeather,
    out,
  });
  return out;
}

/** Returns the final local pixels for one layer, including adjustments and its mask. */
export function renderLayerSourceWithMask(layer: Layer): HTMLCanvasElement {
  return renderMaskedLayerSource(layer);
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

/** Draws source pixels using the layer's document-space transform. */
export function drawLayerSourceAt(
  g: CanvasRenderingContext2D,
  layer: Layer,
  src: CanvasImageSource,
): void {
  const w = layer.w ?? layer.canvas.width;
  const h = layer.h ?? layer.canvas.height;
  g.imageSmoothingEnabled = layer.interpolation !== 'nearest';
  if (g.imageSmoothingEnabled) g.imageSmoothingQuality = 'high';
  if (layer.rotation || layer.flipX || layer.flipY) {
    g.translate(layer.x + w / 2, layer.y + h / 2);
    g.rotate(layer.rotation ?? 0);
    g.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
    g.drawImage(src, -w / 2, -h / 2, w, h);
  } else {
    g.drawImage(src, layer.x, layer.y, w, h);
  }
}

function drawRasterLayer(target: HTMLCanvasElement, layer: Layer): void {
  const g = ctx2d(target);
  const src = renderMaskedLayerSource(layer);
  g.save();
  g.globalAlpha = layer.opacity;
  g.globalCompositeOperation = layer.blendMode ?? 'source-over';
  drawLayerSourceAt(g, layer, src);
  g.restore();
}

function groupCanvas(id: string, width: number, height: number): HTMLCanvasElement {
  let canvas = groupCanvasCache.get(id);
  if (!canvas || canvas.width !== width || canvas.height !== height) {
    canvas = createCanvas(width, height);
    groupCanvasCache.set(id, canvas);
  } else {
    ctx2d(canvas).clearRect(0, 0, width, height);
  }
  return canvas;
}

function compositeLevel(
  target: HTMLCanvasElement,
  doc: Doc,
  parentId: string | null,
  ancestors: Set<string>,
  children: Map<string | null, Layer[]>,
): void {
  for (const layer of children.get(parentId) ?? []) {
    if (!layer.visible || layer.opacity <= 0) continue;
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
    const nestedCanvas = groupCanvas(layer.id, doc.width, doc.height);
    compositeLevel(nestedCanvas, doc, layer.id, nested, children);
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
      g.drawImage(nestedCanvas, -cx, -cy);
    } else {
      g.drawImage(nestedCanvas, 0, 0);
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
  const groupIds = new Set(doc.layers.filter((layer) => layer.kind === 'group').map((layer) => layer.id));
  const children = new Map<string | null, Layer[]>();
  for (const layer of doc.layers) {
    const parentId = layer.parentId && groupIds.has(layer.parentId) ? layer.parentId : null;
    const list = children.get(parentId);
    if (list) list.push(layer);
    else children.set(parentId, [layer]);
  }
  for (const id of groupCanvasCache.keys()) {
    if (!groupIds.has(id)) groupCanvasCache.delete(id);
  }
  compositeLevel(target, doc, null, new Set(), children);
}

/** Produces a fresh flattened canvas of the whole document (for export). */
export function flatten(doc: Doc): HTMLCanvasElement {
  const out = createCanvas(doc.width, doc.height);
  composite(out, doc);
  return out;
}
