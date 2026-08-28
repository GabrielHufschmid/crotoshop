import type { Artboard, Doc, Layer } from '../types';
import { createCanvas, ctx2d } from './canvasUtils';
import { flatten } from './compositor';
import { embedDpi } from './dpi';

export type ExportFormat = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ExportOptions {
  format: ExportFormat;
  quality: number;   // 0..1 (ignored for png)
  matte: string;     // background fill for formats without alpha (jpeg)
  /** Output dimensions; when set and ≠ doc size, the flat image is resampled. */
  width?: number;
  height?: number;
  /** Physical resolution to embed in the file metadata (PNG/JPEG). */
  ppi?: number;
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
  if (outW !== flat.width || outH !== flat.height) {
    const scaled = createCanvas(outW, outH);
    const g = ctx2d(scaled);
    g.imageSmoothingQuality = 'high';
    g.drawImage(flat, 0, 0, outW, outH);
    flat = scaled;
  }
  return flat;
}

/** Flattens the document and encodes it, applying a matte for opaque formats. */
export async function exportDoc(doc: Doc, opts: ExportOptions): Promise<Blob> {
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
const pendingEncodes = new Map<number, (r: { size?: number; error?: string }) => void>();

function getEncodeWorker(): Worker | null {
  if (encodeWorker !== undefined) return encodeWorker;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    encodeWorker = null;
    return null;
  }
  try {
    encodeWorker = new Worker(new URL('./encodeWorker.ts', import.meta.url), { type: 'module' });
    encodeWorker.onmessage = (e: MessageEvent<{ id: number; size?: number; error?: string }>) => {
      const cb = pendingEncodes.get(e.data.id);
      if (cb) {
        pendingEncodes.delete(e.data.id);
        cb(e.data);
      }
    };
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
  const worker = getEncodeWorker();
  if (!worker) return (await exportDoc(doc, opts)).size;
  const flat = flattenResampled(doc, opts);
  const bitmap = await createImageBitmap(flat);
  const id = ++encodeReqId;
  return new Promise<number>((resolve, reject) => {
    pendingEncodes.set(id, (r) => {
      if (r.size != null) resolve(r.size);
      else reject(new Error(r.error ?? 'encode failed'));
    });
    worker.postMessage(
      { id, bitmap, format: opts.format, quality: opts.quality, matte: opts.matte },
      [bitmap],
    );
  });
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
