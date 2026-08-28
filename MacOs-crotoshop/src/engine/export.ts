import type { Artboard, Doc, Layer } from '../types';
import { isNeutral } from '../types';
import { createCanvas, ctx2d } from './canvasUtils';
import { flatten, renderLayerSourceWithMask } from './compositor';
import { embedDpi } from './dpi';
import { canvasLimitMessage, isCanvasSizeAllowed } from './canvasLimits';
import { vectorSvgBody } from './vectorPath';

export type ExportFormat = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';

export interface ExportOptions {
  format: ExportFormat;
  quality: number;   // 0..1 (ignored for png)
  matte: string;     // background fill for formats without alpha (jpeg)
  /** Output dimensions; when set and ≠ doc size, the flat image is resampled. */
  width?: number;
  height?: number;
  /** Physical resolution to embed in the file metadata (PNG/JPEG). */
  ppi?: number;
  /** Output resampling independent from each layer's viewport interpolation. */
  resampling?: 'smooth' | 'nearest';
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
      type,
      quality,
    );
  });
}

/** Flattens the document, resampled to the requested output size. */
function flattenResampled(doc: Doc, opts: ExportOptions): HTMLCanvasElement {
  let flat = flatten(doc);
  const outW = Math.max(1, Math.round(opts.width ?? flat.width));
  const outH = Math.max(1, Math.round(opts.height ?? flat.height));
  if (!isCanvasSizeAllowed(outW, outH)) throw new Error(canvasLimitMessage(outW, outH));
  if (outW !== flat.width || outH !== flat.height) {
    const scaled = createCanvas(outW, outH);
    const g = ctx2d(scaled);
    g.imageSmoothingEnabled = opts.resampling !== 'nearest';
    if (g.imageSmoothingEnabled) g.imageSmoothingQuality = 'high';
    g.drawImage(flat, 0, 0, outW, outH);
    flat = scaled;
  }
  return flat;
}

/** Flattens the document and encodes it, applying a matte for opaque formats. */
export async function exportDoc(doc: Doc, opts: ExportOptions): Promise<Blob> {
  if (opts.format === 'image/svg+xml') return exportDocumentSvg(doc, opts);
  let flat = flattenResampled(doc, opts);
  if (opts.format === 'image/jpeg') {
    const bg = createCanvas(flat.width, flat.height);
    const g = ctx2d(bg);
    g.fillStyle = opts.matte;
    g.fillRect(0, 0, bg.width, bg.height);
    g.drawImage(flat, 0, 0);
    flat = bg;
  }
  const quality = opts.format === 'image/png' ? undefined : opts.quality;
  const blob = await canvasToBlob(flat, opts.format, quality);
  if (opts.ppi) return embedDpi(blob, opts.format, opts.ppi);
  return blob;
}

/** Exports one layer at its own bounds, preserving its blend/mask/adjustments. */
export async function exportLayer(layer: Layer, opts: ExportOptions): Promise<Blob> {
  if (opts.format === 'image/svg+xml') return exportVectorLayerSvg(layer, opts);
  const w = Math.max(1, Math.round(layer.w ?? layer.canvas.width));
  const h = Math.max(1, Math.round(layer.h ?? layer.canvas.height));
  const isolated: Doc = {
    width: w, height: h, activeId: layer.id,
    layers: [{ ...layer, x: 0, y: 0, rotation: undefined, parentId: undefined }],
  };
  return exportDoc(isolated, { ...opts, width: opts.width ?? w, height: opts.height ?? h });
}

/** Crops the composited document to an artboard before encoding. */
export async function exportArtboard(doc: Doc, board: Artboard, opts: ExportOptions): Promise<Blob> {
  if (opts.format === 'image/svg+xml') return exportDocumentSvg(doc, opts, board);
  const flat = flatten(doc);
  const crop = createCanvas(Math.max(1, Math.round(board.w)), Math.max(1, Math.round(board.h)));
  ctx2d(crop).drawImage(flat, -Math.round(board.x), -Math.round(board.y));
  const local: Doc = { width: crop.width, height: crop.height, activeId: 'artboard', layers: [{
    id: 'artboard', name: board.name, visible: true, opacity: 1, x: 0, y: 0, canvas: crop,
    adjustments: { brightness: 0, contrast: 0, saturation: 0, gamma: 1, hue: 0, invert: 0, recolor: { enabled: false, color: [255, 255, 255], preserveLuma: false } }, thumb: '',
  }] };
  return exportDoc(local, { ...opts, width: opts.width ?? crop.width, height: opts.height ?? crop.height });
}

// ── Estimación de peso off-main-thread ───────────────────────────────
// El encodeo (toBlob) de un documento grande tarda cientos de ms; para la
// estimación en vivo del diálogo de exportar se hace en un worker con
// OffscreenCanvas. El flatten queda en el main thread (necesita los canvas
// del DOM) pero es barato gracias al cache de filtros del compositor.

let encodeWorker: Worker | null | undefined;
let encodeReqId = 0;
interface PendingEncode {
  finish: (result: { size?: number; error?: string }) => void;
  timer: ReturnType<typeof setTimeout>;
}
const pendingEncodes = new Map<number, PendingEncode>();

function resetEncodeWorker(reason: string): void {
  encodeWorker?.terminate();
  encodeWorker = undefined;
  for (const pending of pendingEncodes.values()) {
    clearTimeout(pending.timer);
    pending.finish({ error: reason });
  }
  pendingEncodes.clear();
}

function getEncodeWorker(): Worker | null {
  if (encodeWorker !== undefined) return encodeWorker;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    encodeWorker = null;
    return null;
  }
  try {
    encodeWorker = new Worker(new URL('./encodeWorker.ts', import.meta.url), { type: 'module' });
    encodeWorker.onmessage = (e: MessageEvent<{ id: number; size?: number; error?: string }>) => {
      const pending = pendingEncodes.get(e.data.id);
      if (pending) {
        pendingEncodes.delete(e.data.id);
        clearTimeout(pending.timer);
        pending.finish(e.data);
      }
    };
    encodeWorker.onerror = () => resetEncodeWorker('Falló el proceso de estimación');
    encodeWorker.onmessageerror = () => resetEncodeWorker('El proceso de estimación devolvió datos inválidos');
  } catch {
    encodeWorker = null;
  }
  return encodeWorker;
}

/**
 * Estimated encoded size in bytes. Ignores the ~20 bytes of DPI metadata.
 * Falls back to encoding on the main thread if workers/OffscreenCanvas are
 * unavailable.
 */
export async function estimateExportSize(doc: Doc, opts: ExportOptions): Promise<number> {
  if (opts.format === 'image/svg+xml') return (await exportDocumentSvg(doc, opts)).size;
  const worker = getEncodeWorker();
  if (!worker) return (await exportDoc(doc, opts)).size;
  const flat = flattenResampled(doc, opts);
  const bitmap = await createImageBitmap(flat);
  const id = ++encodeReqId;
  try {
    return await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => resetEncodeWorker('La estimación excedió el tiempo esperado'), 30_000);
      pendingEncodes.set(id, {
        timer,
        finish: (r) => {
          if (r.size != null) resolve(r.size);
          else reject(new Error(r.error ?? 'Falló la estimación'));
        },
      });
      try {
        worker.postMessage(
          { id, bitmap, format: opts.format, quality: opts.quality, matte: opts.matte },
          [bitmap],
        );
      } catch (error) {
        const pending = pendingEncodes.get(id);
        if (pending) clearTimeout(pending.timer);
        pendingEncodes.delete(id);
        bitmap.close();
        reject(error);
      }
    });
  } catch {
    return (await exportDoc(doc, opts)).size;
  }
}

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

function number(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function placedSvgBody(svgText: string): string {
  return svgText
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!doctype[\s\S]*?>/gi, '')
    .trim();
}

function svgId(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9_-]/g, '-');
  return /^[a-zA-Z_]/.test(normalized) ? normalized : `layer-${normalized}`;
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo incrustar la imagen'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function layerSvgTransform(layer: Layer, sourceWidth: number, sourceHeight: number): string {
  const width = Math.max(1e-5, layer.w ?? sourceWidth);
  const height = Math.max(1e-5, layer.h ?? sourceHeight);
  const degrees = (layer.rotation ?? 0) * 180 / Math.PI;
  const scaleX = (layer.flipX ? -1 : 1) * width / Math.max(1e-5, sourceWidth);
  const scaleY = (layer.flipY ? -1 : 1) * height / Math.max(1e-5, sourceHeight);
  return [
    `translate(${number(layer.x + width / 2)} ${number(layer.y + height / 2)})`,
    Math.abs(degrees) > 1e-7 ? `rotate(${number(degrees)})` : '',
    `scale(${number(scaleX)} ${number(scaleY)})`,
    `translate(${number(-sourceWidth / 2)} ${number(-sourceHeight / 2)})`,
  ].filter(Boolean).join(' ');
}

function layerGroupAttributes(layer: Layer): string {
  const blend = layer.blendMode && layer.blendMode !== 'source-over' ? ` style="mix-blend-mode:${layer.blendMode}"` : '';
  return `opacity="${number(layer.opacity)}"${blend}`;
}

async function rasterLayerSvg(layer: Layer): Promise<string> {
  const source = renderLayerSourceWithMask(layer);
  const url = await blobDataUrl(await canvasToBlob(source, 'image/png'));
  const transform = layerSvgTransform(layer, source.width, source.height);
  const rendering = layer.interpolation === 'nearest' ? ' image-rendering="pixelated"' : '';
  return `<g ${layerGroupAttributes(layer)} transform="${transform}"><title>${xml(layer.name)}</title><image width="${number(source.width)}" height="${number(source.height)}" href="${url}" preserveAspectRatio="none"${rendering}/></g>`;
}

async function vectorLayerSvg(layer: Layer, prefix: string): Promise<string> {
  const vector = layer.vector!;
  const sourceWidth = Math.max(1, vector.baseWidth);
  const sourceHeight = Math.max(1, vector.baseHeight);
  const body = vector.kind === 'editable'
    ? vectorSvgBody(vector, prefix)
    : vector.svgText
      ? placedSvgBody(vector.svgText)
      : '';
  if (!body) return rasterLayerSvg(layer);
  return `<g ${layerGroupAttributes(layer)} transform="${layerSvgTransform(layer, sourceWidth, sourceHeight)}"><title>${xml(layer.name)}</title>${body}</g>`;
}

/** Exports a complete mixed document. Editable vector layers remain paths; raster/text layers are embedded PNGs. */
export async function exportDocumentSvg(
  doc: Doc,
  opts: Pick<ExportOptions, 'width' | 'height'> = {},
  viewport?: Pick<Artboard, 'x' | 'y' | 'w' | 'h'>,
): Promise<Blob> {
  const area = viewport ?? { x: 0, y: 0, w: doc.width, h: doc.height };
  const outputWidth = Math.max(1, Math.round(opts.width ?? area.w));
  const outputHeight = Math.max(1, Math.round(opts.height ?? area.h));
  const visibleAdjustment = doc.layers.some((layer) => layer.visible && layer.kind === 'adjustment');
  let body: string;
  if (visibleAdjustment) {
    const flat = flatten(doc);
    const url = await blobDataUrl(await canvasToBlob(flat, 'image/png'));
    body = `<image width="${number(doc.width)}" height="${number(doc.height)}" href="${url}" preserveAspectRatio="none"/>`;
  } else {
    const children = new Map<string | null, Layer[]>();
    for (const layer of doc.layers) {
      const parent = layer.parentId && doc.layers.some((candidate) => candidate.id === layer.parentId && candidate.kind === 'group')
        ? layer.parentId
        : null;
      children.set(parent, [...(children.get(parent) ?? []), layer]);
    }
    const renderLevel = async (parentId: string | null, ancestors: ReadonlySet<string>): Promise<string> => {
      const markup = await Promise.all((children.get(parentId) ?? []).map(async (layer) => {
        if (!layer.visible || layer.opacity <= 0 || layer.kind === 'adjustment') return '';
        if (layer.kind === 'group') {
          if (ancestors.has(layer.id)) return '';
          const next = new Set(ancestors);
          next.add(layer.id);
          const contents = await renderLevel(layer.id, next);
          return contents ? `<g ${layerGroupAttributes(layer)}><title>${xml(layer.name)}</title>${contents}</g>` : '';
        }
        const canStayVector = !!layer.vector && !layer.mask?.enabled && isNeutral(layer.adjustments);
        return canStayVector ? vectorLayerSvg(layer, svgId(layer.id)) : rasterLayerSvg(layer);
      }));
      return markup.join('');
    };
    body = await renderLevel(null, new Set());
  }
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${outputWidth}" height="${outputHeight}" viewBox="${number(area.x)} ${number(area.y)} ${number(area.w)} ${number(area.h)}"><title>Crotoshop</title>${body}</svg>`;
  return new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
}

/** Exports a vector layer without flattening its paths. Layer scale, mirrors and rotation stay editable. */
export function exportVectorLayerSvg(layer: Layer, opts: Pick<ExportOptions, 'width' | 'height'> = {}): Blob {
  const vector = layer.vector;
  if (!vector) throw new Error('La capa activa no es vectorial');
  const sourceWidth = Math.max(1, vector.baseWidth);
  const sourceHeight = Math.max(1, vector.baseHeight);
  const displayWidth = Math.max(1, layer.w ?? sourceWidth);
  const displayHeight = Math.max(1, layer.h ?? sourceHeight);
  const angle = layer.rotation ?? 0;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const naturalWidth = Math.max(1, displayWidth * cos + displayHeight * sin);
  const naturalHeight = Math.max(1, displayWidth * sin + displayHeight * cos);
  const outputWidth = Math.max(1, Math.round(opts.width ?? naturalWidth));
  const outputHeight = Math.max(1, Math.round(opts.height ?? naturalHeight));
  const degrees = angle * 180 / Math.PI;
  const scaleX = (layer.flipX ? -1 : 1) * displayWidth / sourceWidth;
  const scaleY = (layer.flipY ? -1 : 1) * displayHeight / sourceHeight;
  const body = vector.kind === 'editable'
    ? vectorSvgBody(vector)
    : vector.svgText
      ? placedSvgBody(vector.svgText)
      : '';
  if (!body) throw new Error('La capa vectorial no contiene trazados exportables');
  const title = xml(layer.name || 'Vector');
  const transform = [
    `translate(${number(naturalWidth / 2)} ${number(naturalHeight / 2)})`,
    Math.abs(degrees) > 1e-7 ? `rotate(${number(degrees)})` : '',
    `scale(${number(scaleX)} ${number(scaleY)})`,
    `translate(${number(-sourceWidth / 2)} ${number(-sourceHeight / 2)})`,
  ].filter(Boolean).join(' ');
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${outputWidth}" height="${outputHeight}" viewBox="0 0 ${number(naturalWidth)} ${number(naturalHeight)}"><title>${title}</title><g opacity="${number(layer.opacity)}" transform="${transform}">${body}</g></svg>`;
  return new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
