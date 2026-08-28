import type { Adjustments, Artboard, BlendMode, Doc, Guide, Layer, SelectionChannel, TextData, VectorData, VectorGradient, VectorShape } from '../types';
import { canvasVersion, cloneAdjustments, ctx2d, makeThumb } from './canvasUtils';
import { loadRasterFile, loadRasterUrl } from './import/raster';
import { svgSourceFromText } from './import/svg';
import { normalizeLegacyMask } from './layerMask';
import { decodeProjectArchive, encodeProjectArchive, InvalidProject } from './projectArchive';
import { makeEditableVector } from './vectorPath';

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
  canvas: string | number;
  adjustments: Adjustments;
  text?: TextData;
  vector?: {
    kind?: 'placed' | 'editable';
    sourceType?: 'svg' | 'eps' | 'pdf';
    baseWidth: number;
    baseHeight: number;
    svgText?: string;
    shapes?: VectorShape[];
  };
  kind?: 'raster' | 'group' | 'adjustment';
  parentId?: string;
  blendMode?: BlendMode;
  interpolation?: 'smooth' | 'nearest';
  adjustmentLayer?: Adjustments;
  mask?: { canvas: string | number; enabled: boolean; density?: number; feather?: number };
  locked?: boolean;
  lockPixels?: boolean;
  colorTag?: string;
}

interface ProjectFile {
  format: 'crotoshop-project';
  version: 1 | 2 | 3;
  name: string;
  doc: {
    width: number;
    height: number;
    activeId: string | null;
    layers: ProjectLayer[];
    artboards?: Artboard[];
    savedSelections?: Array<{ id: string; name: string; mask: string | number }>;
  };
  guides: Guide[];
  view: { zoom: number; panX: number; panY: number };
}

const pngCache = new WeakMap<HTMLCanvasElement, { version: number; promise: Promise<Blob> }>();

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(values[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, worker));
  return output;
}

function pngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const version = canvasVersion(canvas);
  const cached = pngCache.get(canvas);
  if (cached?.version === version) return cached.promise;
  const promise = new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('No se pudo comprimir una capa del proyecto'));
    }, 'image/png');
  });
  pngCache.set(canvas, { version, promise });
  void promise.catch(() => {
    if (pngCache.get(canvas)?.promise === promise) pngCache.delete(canvas);
  });
  return promise;
}

function vectorFromProject(v: ProjectLayer['vector']): VectorData | undefined {
  if (!v) return undefined;
  if (v.kind === 'editable' && v.shapes?.length) {
    return makeEditableVector(v.shapes, v.baseWidth, v.baseHeight, v.svgText);
  }
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

export async function serializeProject(
  name: string,
  doc: Doc,
  guides: Guide[],
  view: { zoom: number; panX: number; panY: number },
): Promise<Blob> {
  const assetIndexes = new Map<HTMLCanvasElement, number>();
  const assetCanvases: HTMLCanvasElement[] = [];
  const addAsset = (canvas: HTMLCanvasElement): number => {
    const existing = assetIndexes.get(canvas);
    if (existing !== undefined) return existing;
    const index = assetCanvases.length;
    assetIndexes.set(canvas, index);
    assetCanvases.push(canvas);
    return index;
  };
  const project: ProjectFile = {
    format: 'crotoshop-project',
    version: 3,
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
        canvas: addAsset(l.canvas),
        adjustments: l.adjustments,
        text: l.text,
        vector: l.vector
          ? {
              kind: l.vector.kind,
              sourceType: l.vector.sourceType,
              baseWidth: l.vector.baseWidth,
              baseHeight: l.vector.baseHeight,
              svgText: l.vector.svgText,
              shapes: l.vector.kind === 'editable' ? l.vector.shapes : undefined,
            }
          : undefined,
        kind: l.kind,
        parentId: l.parentId,
        blendMode: l.blendMode,
        interpolation: l.interpolation,
        adjustmentLayer: l.adjustmentLayer,
        mask: l.mask ? {
          canvas: addAsset(l.mask.canvas),
          enabled: l.mask.enabled,
          density: l.mask.density ?? 1,
          feather: l.mask.feather ?? 0,
        } : undefined,
        locked: l.locked,
        lockPixels: l.lockPixels,
        colorTag: l.colorTag,
      })),
      artboards: doc.artboards,
      savedSelections: doc.savedSelections?.slice(0, 100).map((channel) => ({
        id: channel.id,
        name: channel.name,
        mask: addAsset(channel.mask),
      })),
    },
    guides,
    view,
  };
  // Canvas encoders are memory hungry. Two concurrent PNGs keep multicore
  // throughput without briefly holding every large layer in an encoder.
  const assets = await mapWithConcurrency(assetCanvases, 2, pngBlob);
  const manifest = new TextEncoder().encode(JSON.stringify(project));
  return encodeProjectArchive(manifest, assets);
}

// ── Validation ───────────────────────────────────────────────────────
// Project files travel between users, so every field is untrusted input:
// clamp numbers, require exact types, and cap sizes before allocating
// canvases. A hostile file must fail with an error, never hang the tab.

const MAX_DOC_DIM = 16384;   // matches common browser canvas limits
const MAX_LAYERS = 200;
const MAX_SELECTION_CHANNELS = 100;
const MAX_TEXT_LEN = 20000;
const MAX_SVG_LEN = 4 * 1024 * 1024;
const MAX_VECTOR_SHAPES = 1000;
const MAX_VECTOR_SUBPATHS = 10000;
const MAX_VECTOR_NODES = 200000;
const MAX_DATAURL_LEN = 128 * 1024 * 1024;

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
    underline: t.underline === true,
    strikethrough: t.strikethrough === true,
  };
}

function vectorColor(v: unknown, field: string): string | null {
  if (v == null) return null;
  const value = str(v, field, 80);
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return value;
  if (/^rgba?\([\d\s.,%+-]+\)$/.test(value)) return value;
  if (/^hsla?\([\d\s.,%+-]+\)$/.test(value)) return value;
  throw new InvalidProject(field);
}

function validVectorGradient(value: unknown, field: string): VectorGradient | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'object') throw new InvalidProject(field);
  const gradient = value as Record<string, unknown>;
  const point = (raw: unknown, pointField: string) => {
    if (typeof raw !== 'object' || raw === null) throw new InvalidProject(pointField);
    const candidate = raw as Record<string, unknown>;
    return {
      x: num(candidate.x, `${pointField}.x`, -MAX_DOC_DIM * 16, MAX_DOC_DIM * 16, 0),
      y: num(candidate.y, `${pointField}.y`, -MAX_DOC_DIM * 16, MAX_DOC_DIM * 16, 0),
    };
  };
  if (!Array.isArray(gradient.stops) || gradient.stops.length < 1 || gradient.stops.length > 64) {
    throw new InvalidProject(`${field}.stops`);
  }
  const rawStops = gradient.stops;
  const stops = rawStops.map((rawStop, index) => {
    if (typeof rawStop !== 'object' || rawStop === null) throw new InvalidProject(`${field}.stops[${index}]`);
    const stop = rawStop as Record<string, unknown>;
    const color = vectorColor(stop.color, `${field}.stops[${index}].color`);
    if (!color) throw new InvalidProject(`${field}.stops[${index}].color`);
    return {
      offset: num(stop.offset, `${field}.stops[${index}].offset`, 0, 1, index / Math.max(1, rawStops.length - 1)),
      color,
    };
  });
  return {
    type: gradient.type === 'radial' ? 'radial' : 'linear',
    from: point(gradient.from, `${field}.from`),
    to: point(gradient.to, `${field}.to`),
    highlight: gradient.highlight == null ? undefined : point(gradient.highlight, `${field}.highlight`),
    stops,
  };
}

function validVectorShapes(value: unknown): VectorShape[] {
  if (!Array.isArray(value)) throw new InvalidProject('vector.shapes');
  if (value.length > MAX_VECTOR_SHAPES) throw new InvalidProject('demasiadas formas vectoriales');
  let subpathCount = 0;
  let nodeCount = 0;
  return value.map((rawShape, shapeIndex) => {
    if (typeof rawShape !== 'object' || rawShape === null) throw new InvalidProject(`vector.shapes[${shapeIndex}]`);
    const shape = rawShape as Record<string, unknown>;
    if (!Array.isArray(shape.subpaths)) throw new InvalidProject('vector.subpaths');
    subpathCount += shape.subpaths.length;
    if (subpathCount > MAX_VECTOR_SUBPATHS) throw new InvalidProject('demasiados subtrazados vectoriales');
    const styleRaw = typeof shape.style === 'object' && shape.style !== null ? shape.style as Record<string, unknown> : {};
    const subpaths = shape.subpaths.map((rawSubpath, subpathIndex) => {
      if (typeof rawSubpath !== 'object' || rawSubpath === null) throw new InvalidProject(`vector.subpath[${subpathIndex}]`);
      const subpath = rawSubpath as Record<string, unknown>;
      if (!Array.isArray(subpath.nodes)) throw new InvalidProject('vector.nodes');
      nodeCount += subpath.nodes.length;
      if (nodeCount > MAX_VECTOR_NODES) throw new InvalidProject('demasiados nodos vectoriales');
      const nodes = subpath.nodes.map((rawNode, nodeIndex) => {
        if (typeof rawNode !== 'object' || rawNode === null) throw new InvalidProject(`vector.node[${nodeIndex}]`);
        const node = rawNode as Record<string, unknown>;
        return {
          id: str(node.id, 'vector.node.id', 64, `n${nodeIndex}`),
          x: num(node.x, 'vector.node.x', -MAX_DOC_DIM * 16, MAX_DOC_DIM * 16, 0),
          y: num(node.y, 'vector.node.y', -MAX_DOC_DIM * 16, MAX_DOC_DIM * 16, 0),
          inX: num(node.inX, 'vector.node.inX', -MAX_DOC_DIM * 16, MAX_DOC_DIM * 16, 0),
          inY: num(node.inY, 'vector.node.inY', -MAX_DOC_DIM * 16, MAX_DOC_DIM * 16, 0),
          outX: num(node.outX, 'vector.node.outX', -MAX_DOC_DIM * 16, MAX_DOC_DIM * 16, 0),
          outY: num(node.outY, 'vector.node.outY', -MAX_DOC_DIM * 16, MAX_DOC_DIM * 16, 0),
          kind: node.kind === 'smooth' || node.kind === 'symmetric' ? node.kind : 'corner',
        } as const;
      });
      return {
        id: str(subpath.id, 'vector.subpath.id', 64, `p${subpathIndex}`),
        closed: subpath.closed === true,
        nodes,
      };
    });
    return {
      id: str(shape.id, 'vector.shape.id', 64, `s${shapeIndex}`),
      name: typeof shape.name === 'string' ? shape.name.slice(0, 200) : undefined,
      subpaths,
      primitive: (() => {
        if (typeof shape.primitive !== 'object' || shape.primitive === null) return undefined;
        const primitive = shape.primitive as Record<string, unknown>;
        const kind = primitive.kind;
        if (kind !== 'rectangle' && kind !== 'ellipse' && kind !== 'triangle' && kind !== 'polygon') return undefined;
        const bounds = typeof primitive.bounds === 'object' && primitive.bounds !== null
          ? primitive.bounds as Record<string, unknown>
          : {};
        return {
          kind,
          bounds: {
            x: num(bounds.x, 'vector.primitive.bounds.x', -MAX_DOC_DIM * 16, MAX_DOC_DIM * 16, 0),
            y: num(bounds.y, 'vector.primitive.bounds.y', -MAX_DOC_DIM * 16, MAX_DOC_DIM * 16, 0),
            w: num(bounds.w, 'vector.primitive.bounds.w', 0, MAX_DOC_DIM * 16, 1),
            h: num(bounds.h, 'vector.primitive.bounds.h', 0, MAX_DOC_DIM * 16, 1),
          },
          sides: Math.round(num(primitive.sides, 'vector.primitive.sides', 3, 64, kind === 'triangle' ? 3 : 6)),
          cornerRadius: num(primitive.cornerRadius, 'vector.primitive.cornerRadius', 0, MAX_DOC_DIM, 0),
        } as const;
      })(),
      style: {
        fill: vectorColor(styleRaw.fill, 'vector.style.fill'),
        stroke: vectorColor(styleRaw.stroke, 'vector.style.stroke'),
        fillGradient: validVectorGradient(styleRaw.fillGradient, 'vector.style.fillGradient'),
        strokeGradient: validVectorGradient(styleRaw.strokeGradient, 'vector.style.strokeGradient'),
        strokeWidth: num(styleRaw.strokeWidth, 'vector.style.strokeWidth', 0, 10000, 1),
        strokeAlign: styleRaw.strokeAlign === 'inside' || styleRaw.strokeAlign === 'outside' ? styleRaw.strokeAlign : 'center',
        opacity: num(styleRaw.opacity, 'vector.style.opacity', 0, 1, 1),
        fillRule: styleRaw.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
        lineCap: styleRaw.lineCap === 'butt' || styleRaw.lineCap === 'square' ? styleRaw.lineCap : 'round',
        lineJoin: styleRaw.lineJoin === 'miter' || styleRaw.lineJoin === 'bevel' ? styleRaw.lineJoin : 'round',
        miterLimit: num(styleRaw.miterLimit, 'vector.style.miterLimit', 1, 1000, 4),
        dashArray: Array.isArray(styleRaw.dashArray)
          ? styleRaw.dashArray.slice(0, 32).map((value, index) => num(value, `vector.style.dashArray[${index}]`, 0, 10000, 0))
          : undefined,
        dashOffset: num(styleRaw.dashOffset, 'vector.style.dashOffset', -100000, 100000, 0),
      },
    };
  });
}

function validVector(v: unknown): ProjectLayer['vector'] {
  if (v == null) return undefined;
  if (typeof v !== 'object') throw new InvalidProject('vector');
  const d = v as Record<string, unknown>;
  if (d.kind === 'editable' && Array.isArray(d.shapes)) {
    return {
      kind: 'editable',
      sourceType: d.sourceType === 'svg' ? 'svg' : undefined,
      baseWidth: num(d.baseWidth, 'vector.baseWidth', 1, MAX_DOC_DIM, 1024),
      baseHeight: num(d.baseHeight, 'vector.baseHeight', 1, MAX_DOC_DIM, 1024),
      svgText: typeof d.svgText === 'string' ? str(d.svgText, 'vector.svgText', MAX_SVG_LEN) : undefined,
      shapes: validVectorShapes(d.shapes),
    };
  }
  if (d.sourceType !== 'svg' || typeof d.svgText !== 'string') return undefined;
  return {
    kind: 'placed',
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

async function readProjectPayload(input: string | Blob | ArrayBuffer): Promise<{ parsed: unknown; assets: Blob[] | null }> {
  if (typeof input === 'string') {
    try {
      return { parsed: JSON.parse(input), assets: null };
    } catch {
      throw new InvalidProject('JSON');
    }
  }
  const blob = input instanceof Blob ? input : new Blob([input]);
  const archive = await decodeProjectArchive(blob);
  if (archive) {
    try {
      return { parsed: JSON.parse(archive.manifest), assets: archive.assets };
    } catch {
      throw new InvalidProject('manifiesto JSON');
    }
  }
  try {
    return { parsed: JSON.parse(await blob.text()), assets: null };
  } catch {
    throw new InvalidProject('JSON');
  }
}

async function loadProjectCanvas(
  value: unknown,
  field: string,
  version: 1 | 2 | 3,
  assets: Blob[] | null,
): Promise<HTMLCanvasElement> {
  if (version === 1) {
    const dataUrl = str(value, field, MAX_DATAURL_LEN);
    if (!dataUrl.startsWith('data:image/')) throw new InvalidProject(`${field} dataURL`);
    return loadRasterUrl(dataUrl);
  }
  if (!Number.isInteger(value) || (value as number) < 0 || !assets?.[value as number]) {
    throw new InvalidProject(`${field} recurso`);
  }
  return loadRasterFile(assets[value as number]);
}

export async function parseProject(input: string | Blob | ArrayBuffer): Promise<{
  name: string;
  doc: Doc;
  guides: Guide[];
  view: { zoom: number; panX: number; panY: number };
}> {
  const { parsed, assets } = await readProjectPayload(input);
  if (typeof parsed !== 'object' || parsed === null) throw new InvalidProject('raíz');
  const p = parsed as Record<string, unknown>;
  if (p.format !== 'crotoshop-project' || (p.version !== 1 && p.version !== 2 && p.version !== 3)) throw new InvalidProject('formato');
  const version = p.version;
  if (version >= 2 && !assets) throw new InvalidProject('recursos');
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
    const canvas = await loadProjectCanvas(l.canvas, 'canvas', version, assets);
    if (canvas.width > MAX_DOC_DIM || canvas.height > MAX_DOC_DIM) {
      throw new InvalidProject('capa demasiado grande');
    }
    const vector = vectorFromProject(validVector(l.vector));
    let mask: Layer['mask'];
    if (typeof l.mask === 'object' && l.mask !== null) {
      const m = l.mask as Record<string, unknown>;
      const maskCanvas = normalizeLegacyMask(await loadProjectCanvas(m.canvas, 'mask.canvas', version, assets));
      mask = {
        canvas: maskCanvas,
        enabled: m.enabled !== false,
        density: num(m.density, 'mask.density', 0, 1, 1),
        feather: num(m.feather, 'mask.feather', 0, 250, 0),
      };
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
      interpolation: l.interpolation === 'nearest' ? 'nearest' : 'smooth',
      adjustmentLayer: l.kind === 'adjustment' ? cloneAdjustments(validAdjustments(l.adjustmentLayer)) : undefined,
      mask,
      locked: l.locked === true,
      lockPixels: l.lockPixels === true,
      colorTag: /^#[0-9a-fA-F]{6}$/.test(String(l.colorTag)) ? String(l.colorTag) : undefined,
      thumb: makeThumb(canvas),
    });
  }

  const savedSelections: SelectionChannel[] = [];
  if (Array.isArray(pdoc.savedSelections)) {
    for (const raw of pdoc.savedSelections.slice(0, MAX_SELECTION_CHANNELS)) {
      if (typeof raw !== 'object' || raw === null) continue;
      const channel = raw as Record<string, unknown>;
      const mask = await loadProjectCanvas(channel.mask, 'savedSelection.mask', version, assets);
      if (mask.width !== width || mask.height !== height) throw new InvalidProject('dimensiones de selección guardada');
      const pixels = ctx2d(mask).getImageData(0, 0, width, height).data;
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (pixels[(y * width + x) * 4 + 3] === 0) continue;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      if (maxX < minX || maxY < minY) continue;
      savedSelections.push({
        id: str(channel.id, 'savedSelection.id', 64, 'selection'),
        name: str(channel.name, 'savedSelection.name', 120, 'Selección'),
        mask,
        bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
      });
    }
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
      savedSelections,
    },
    guides: validGuides(p.guides),
    view: {
      zoom: num(view.zoom, 'zoom', 0.02, 32, 1),
      panX: num(view.panX, 'panX', -1e6, 1e6, 0),
      panY: num(view.panY, 'panY', -1e6, 1e6, 0),
    },
  };
}
