import type { Adjustments, Artboard, BlendMode, Doc, Guide, Layer, TextData, VectorData } from '../types';
import { cloneAdjustments, createCanvas, ctx2d } from './canvasUtils';
import { loadRasterUrl } from './import/raster';
import { svgSourceFromText } from './import/svg';

interface ProjectLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  x: number;
  y: number;
  w?: number;
  h?: number;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
  canvas: string;
  adjustments: Adjustments;
  text?: TextData;
  vector?: {
    sourceType?: 'svg' | 'eps' | 'pdf';
    baseWidth: number;
    baseHeight: number;
    svgText?: string;
  };
  kind?: 'raster' | 'group' | 'adjustment';
  parentId?: string;
  blendMode?: BlendMode;
  adjustmentLayer?: Adjustments;
  mask?: { canvas: string; enabled: boolean };
  locked?: boolean;
  lockPixels?: boolean;
  colorTag?: string;
}

interface ProjectFile {
  format: 'crotoshop-project';
  version: 1;
  name: string;
  doc: { width: number; height: number; activeId: string | null; layers: ProjectLayer[]; artboards?: Artboard[] };
  guides: Guide[];
  view: { zoom: number; panX: number; panY: number };
}

function thumb(src: HTMLCanvasElement): string {
  const scale = Math.min(68 / src.width, 68 / src.height, 1);
  const c = createCanvas(Math.max(1, src.width * scale), Math.max(1, src.height * scale));
  ctx2d(c).drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

function vectorFromProject(v: ProjectLayer['vector']): VectorData | undefined {
  if (!v) return undefined;
  if (v.sourceType === 'svg' && v.svgText) {
    const src = svgSourceFromText(v.svgText);
    return {
      kind: 'placed',
      sourceType: 'svg',
      svgText: v.svgText,
      baseWidth: src.baseWidth,
      baseHeight: src.baseHeight,
      rasterize: src.rasterize,
    };
  }
  return undefined;
}

export function serializeProject(
  name: string,
  doc: Doc,
  guides: Guide[],
  view: { zoom: number; panX: number; panY: number },
): string {
  const project: ProjectFile = {
    format: 'crotoshop-project',
    version: 1,
    name,
    doc: {
      width: doc.width,
      height: doc.height,
      activeId: doc.activeId,
      layers: doc.layers.map((l) => ({
        id: l.id,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        x: l.x,
        y: l.y,
        w: l.w,
        h: l.h,
        rotation: l.rotation,
        flipX: l.flipX,
        flipY: l.flipY,
        canvas: l.canvas.toDataURL('image/png'),
        adjustments: l.adjustments,
        text: l.text,
        vector: l.vector
          ? {
              sourceType: l.vector.sourceType,
              baseWidth: l.vector.baseWidth,
              baseHeight: l.vector.baseHeight,
              svgText: l.vector.svgText,
            }
          : undefined,
        kind: l.kind,
        parentId: l.parentId,
        blendMode: l.blendMode,
        adjustmentLayer: l.adjustmentLayer,
        mask: l.mask ? { canvas: l.mask.canvas.toDataURL('image/png'), enabled: l.mask.enabled } : undefined,
        locked: l.locked,
        lockPixels: l.lockPixels,
        colorTag: l.colorTag,
      })),
      artboards: doc.artboards,
    },
    guides,
    view,
  };
  return JSON.stringify(project);
}

// ── Validation ───────────────────────────────────────────────────────
// Project files travel between users, so every field is untrusted input:
// clamp numbers, require exact types, and cap sizes before allocating
// canvases. A hostile file must fail with an error, never hang the tab.

const MAX_DOC_DIM = 16384;   // matches common browser canvas limits
const MAX_LAYERS = 200;
const MAX_TEXT_LEN = 20000;
const MAX_SVG_LEN = 4 * 1024 * 1024;
const MAX_DATAURL_LEN = 128 * 1024 * 1024;

class InvalidProject extends Error {
  constructor(detail: string) {
    super(`Proyecto crotoshop inválido (${detail})`);
  }
}

function num(v: unknown, field: string, min: number, max: number, fallback?: number): number {
  if (v == null && fallback !== undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new InvalidProject(field);
  return Math.min(max, Math.max(min, v));
}

/** Como num(), pero fuera de rango es rechazo, no clamp (dimensiones). */
function numStrict(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw new InvalidProject(field);
  }
  return v;
}

function optNum(v: unknown, field: string, min: number, max: number): number | undefined {
  if (v == null) return undefined;
  return num(v, field, min, max);
}

function str(v: unknown, field: string, maxLen: number, fallback?: string): string {
  if (v == null && fallback !== undefined) return fallback;
  if (typeof v !== 'string') throw new InvalidProject(field);
  return v.length > maxLen ? v.slice(0, maxLen) : v;
}

function validAdjustments(v: unknown): Adjustments {
  const a = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const rec = (typeof a.recolor === 'object' && a.recolor !== null ? a.recolor : {}) as Record<string, unknown>;
  const col = Array.isArray(rec.color) ? rec.color : [255, 255, 255];
  return {
    brightness: num(a.brightness, 'brightness', -1, 1, 0),
    contrast: num(a.contrast, 'contrast', -1, 1, 0),
    saturation: num(a.saturation, 'saturation', -1, 1, 0),
    gamma: num(a.gamma, 'gamma', 0.2, 3, 1),
    hue: num(a.hue, 'hue', -180, 180, 0),
    invert: num(a.invert, 'invert', 0, 1, 0),
    recolor: {
      enabled: rec.enabled === true,
      color: [
        num(col[0], 'recolor.color', 0, 255, 255),
        num(col[1], 'recolor.color', 0, 255, 255),
        num(col[2], 'recolor.color', 0, 255, 255),
      ],
      preserveLuma: rec.preserveLuma === true,
    },
  };
}

function validText(v: unknown): TextData | undefined {
  if (v == null) return undefined;
  if (typeof v !== 'object') throw new InvalidProject('text');
  const t = v as Record<string, unknown>;
  const align = t.align === 'center' || t.align === 'right' ? t.align : 'left';
  return {
    text: str(t.text, 'text.text', MAX_TEXT_LEN, ''),
    family: str(t.family, 'text.family', 200, 'Arial'),
    googleFont: t.googleFont === true,
    size: num(t.size, 'text.size', 1, 2000, 64),
    color: /^#[0-9a-fA-F]{3,8}$/.test(String(t.color)) ? String(t.color) : '#ffffff',
    align,
    lineHeight: num(t.lineHeight, 'text.lineHeight', 0.5, 5, 1.2),
    letterSpacing: num(t.letterSpacing, 'text.letterSpacing', -100, 500, 0),
    bold: t.bold === true,
    italic: t.italic === true,
  };
}

function validVector(v: unknown): ProjectLayer['vector'] {
  if (v == null) return undefined;
  if (typeof v !== 'object') throw new InvalidProject('vector');
  const d = v as Record<string, unknown>;
  if (d.sourceType !== 'svg' || typeof d.svgText !== 'string') return undefined;
  return {
    sourceType: 'svg',
    baseWidth: num(d.baseWidth, 'vector.baseWidth', 1, MAX_DOC_DIM, 1024),
    baseHeight: num(d.baseHeight, 'vector.baseHeight', 1, MAX_DOC_DIM, 1024),
    svgText: str(d.svgText, 'vector.svgText', MAX_SVG_LEN),
  };
}

const BLEND_MODES = new Set<BlendMode>([
  'source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
  'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
]);

function validArtboards(v: unknown, width: number, height: number): Artboard[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 50).flatMap((raw) => {
    if (typeof raw !== 'object' || raw === null) return [];
    const b = raw as Record<string, unknown>;
    try {
      return [{
        id: str(b.id, 'artboard.id', 64, 'ab'), name: str(b.name, 'artboard.name', 120, 'Mesa'),
        x: num(b.x, 'artboard.x', -width * 4, width * 4, 0), y: num(b.y, 'artboard.y', -height * 4, height * 4, 0),
        w: num(b.w, 'artboard.w', 1, MAX_DOC_DIM * 4, width), h: num(b.h, 'artboard.h', 1, MAX_DOC_DIM * 4, height),
      }];
    } catch { return []; }
  });
}

function validGuides(v: unknown): Guide[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 200).flatMap((g) => {
    if (typeof g !== 'object' || g === null) return [];
    const d = g as Record<string, unknown>;
    if (d.axis !== 'x' && d.axis !== 'y') return [];
    if (typeof d.pos !== 'number' || !Number.isFinite(d.pos)) return [];
    return [{ id: str(d.id, 'guide.id', 64, 'g'), axis: d.axis, pos: d.pos }];
  });
}

export async function parseProject(text: string): Promise<{
  name: string;
  doc: Doc;
  guides: Guide[];
  view: { zoom: number; panX: number; panY: number };
}> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new InvalidProject('JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new InvalidProject('raíz');
  const p = parsed as Record<string, unknown>;
  if (p.format !== 'crotoshop-project' || p.version !== 1) throw new InvalidProject('formato');
  if (typeof p.doc !== 'object' || p.doc === null) throw new InvalidProject('doc');
  const pdoc = p.doc as Record<string, unknown>;
  if (!Array.isArray(pdoc.layers)) throw new InvalidProject('layers');
  if (pdoc.layers.length > MAX_LAYERS) throw new InvalidProject(`más de ${MAX_LAYERS} capas`);

  const width = Math.round(numStrict(pdoc.width, 'width', 1, MAX_DOC_DIM));
  const height = Math.round(numStrict(pdoc.height, 'height', 1, MAX_DOC_DIM));

  const layers: Layer[] = [];
  for (const raw of pdoc.layers) {
    if (typeof raw !== 'object' || raw === null) throw new InvalidProject('capa');
    const l = raw as Record<string, unknown>;
    const dataUrl = str(l.canvas, 'canvas', MAX_DATAURL_LEN);
    if (!dataUrl.startsWith('data:image/')) throw new InvalidProject('canvas dataURL');
    const canvas = await loadRasterUrl(dataUrl);
    if (canvas.width > MAX_DOC_DIM || canvas.height > MAX_DOC_DIM) {
      throw new InvalidProject('capa demasiado grande');
    }
    const vector = vectorFromProject(validVector(l.vector));
    let mask: Layer['mask'];
    if (typeof l.mask === 'object' && l.mask !== null) {
      const m = l.mask as Record<string, unknown>;
      const dataUrl = str(m.canvas, 'mask.canvas', MAX_DATAURL_LEN, '');
      if (dataUrl.startsWith('data:image/')) {
        const maskCanvas = await loadRasterUrl(dataUrl);
        mask = { canvas: maskCanvas, enabled: m.enabled !== false };
      }
    }
    layers.push({
      id: str(l.id, 'id', 64, 'l'),
      name: str(l.name, 'name', 200, 'Capa'),
      visible: l.visible !== false,
      opacity: num(l.opacity, 'opacity', 0, 1, 1),
      x: num(l.x, 'x', -MAX_DOC_DIM * 4, MAX_DOC_DIM * 4, 0),
      y: num(l.y, 'y', -MAX_DOC_DIM * 4, MAX_DOC_DIM * 4, 0),
      w: optNum(l.w, 'w', 1, MAX_DOC_DIM * 4),
      h: optNum(l.h, 'h', 1, MAX_DOC_DIM * 4),
      rotation: optNum(l.rotation, 'rotation', -Math.PI * 2, Math.PI * 2),
      flipX: l.flipX === true,
      flipY: l.flipY === true,
      canvas,
      adjustments: cloneAdjustments(validAdjustments(l.adjustments)),
      text: validText(l.text),
      vector,
      kind: l.kind === 'group' || l.kind === 'adjustment' ? l.kind : 'raster',
      parentId: typeof l.parentId === 'string' ? l.parentId.slice(0, 64) : undefined,
      blendMode: typeof l.blendMode === 'string' && BLEND_MODES.has(l.blendMode as BlendMode) ? l.blendMode as BlendMode : 'source-over',
      adjustmentLayer: l.kind === 'adjustment' ? cloneAdjustments(validAdjustments(l.adjustmentLayer)) : undefined,
      mask,
      locked: l.locked === true,
      lockPixels: l.lockPixels === true,
      colorTag: /^#[0-9a-fA-F]{6}$/.test(String(l.colorTag)) ? String(l.colorTag) : undefined,
      thumb: thumb(canvas),
    });
  }

  const view = (typeof p.view === 'object' && p.view !== null ? p.view : {}) as Record<string, unknown>;
  const activeId = typeof pdoc.activeId === 'string' ? pdoc.activeId : null;
  return {
    name: str(p.name, 'name', 200, 'Proyecto') || 'Proyecto',
    doc: {
      width,
      height,
      activeId: layers.some((l) => l.id === activeId) ? activeId : (layers[layers.length - 1]?.id ?? null),
      layers,
      artboards: validArtboards(pdoc.artboards, width, height),
    },
    guides: validGuides(p.guides),
    view: {
      zoom: num(view.zoom, 'zoom', 0.02, 32, 1),
      panX: num(view.panX, 'panX', -1e6, 1e6, 0),
      panY: num(view.panY, 'panY', -1e6, 1e6, 0),
    },
  };
}
