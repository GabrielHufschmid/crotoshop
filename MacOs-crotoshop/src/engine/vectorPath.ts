import type {
  Pt,
  VectorData,
  VectorGradient,
  VectorNode,
  VectorNodeKind,
  VectorShape,
  VectorStyle,
  VectorSubpath,
} from '../types';
import { createCanvas, ctx2d, uid } from './canvasUtils';

const EPSILON = 1e-7;

export const DEFAULT_VECTOR_STYLE: VectorStyle = {
  fill: '#1473e6',
  stroke: null,
  strokeWidth: 1,
  strokeAlign: 'center',
  opacity: 1,
  fillRule: 'nonzero',
  lineCap: 'round',
  lineJoin: 'round',
  miterLimit: 4,
};

export function createVectorNode(point: Pt, kind: VectorNodeKind = 'corner'): VectorNode {
  return {
    id: uid(),
    x: point.x,
    y: point.y,
    inX: 0,
    inY: 0,
    outX: 0,
    outY: 0,
    kind,
  };
}

function cloneGradient(gradient: VectorGradient | undefined): VectorGradient | undefined {
  return gradient ? {
    ...gradient,
    from: { ...gradient.from },
    to: { ...gradient.to },
    highlight: gradient.highlight ? { ...gradient.highlight } : undefined,
    stops: gradient.stops.map((stop) => ({ ...stop })),
  } : undefined;
}

export function cloneVectorStyle(style: VectorStyle): VectorStyle {
  return {
    ...style,
    dashArray: style.dashArray ? [...style.dashArray] : undefined,
    fillGradient: cloneGradient(style.fillGradient),
    strokeGradient: cloneGradient(style.strokeGradient),
  };
}

export function mapVectorStyleGradients(style: VectorStyle, transform: (point: Pt) => Pt): VectorStyle {
  const mapGradient = (gradient: VectorGradient | undefined): VectorGradient | undefined => gradient ? {
    ...gradient,
    from: transform(gradient.from),
    to: transform(gradient.to),
    highlight: gradient.highlight ? transform(gradient.highlight) : undefined,
    stops: gradient.stops.map((stop) => ({ ...stop })),
  } : undefined;
  return {
    ...style,
    fillGradient: mapGradient(style.fillGradient),
    strokeGradient: mapGradient(style.strokeGradient),
  };
}

export function cloneVectorShapes(shapes: readonly VectorShape[]): VectorShape[] {
  return shapes.map((shape) => ({
    ...shape,
    primitive: shape.primitive ? { ...shape.primitive, bounds: { ...shape.primitive.bounds } } : undefined,
    style: cloneVectorStyle(shape.style),
    subpaths: shape.subpaths.map((subpath) => ({
      ...subpath,
      nodes: subpath.nodes.map((node) => ({ ...node })),
    })),
  }));
}

export function makeEditableVector(
  shapes: readonly VectorShape[],
  baseWidth: number,
  baseHeight: number,
  svgText?: string,
): VectorData {
  const vector: VectorData = {
    kind: 'editable',
    baseWidth: Math.max(1, baseWidth),
    baseHeight: Math.max(1, baseHeight),
    sourceType: svgText ? 'svg' : undefined,
    svgText,
    shapes: cloneVectorShapes(shapes),
    rasterize: async () => createCanvas(1, 1),
  };
  vector.rasterize = async (scale) => renderEditableVector(vector, scale);
  return vector;
}

export function cloneEditableVector(vector: VectorData): VectorData {
  if (vector.kind !== 'editable' || !vector.shapes) return vector;
  return makeEditableVector(vector.shapes, vector.baseWidth, vector.baseHeight, vector.svgText);
}

function addSubpathToPath(path: Path2D, subpath: VectorSubpath): void {
  const nodes = subpath.nodes;
  if (!nodes.length) return;
  path.moveTo(nodes[0].x, nodes[0].y);
  const segmentCount = subpath.closed ? nodes.length : nodes.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const from = nodes[index];
    const to = nodes[(index + 1) % nodes.length];
    const cp1x = from.x + from.outX;
    const cp1y = from.y + from.outY;
    const cp2x = to.x + to.inX;
    const cp2y = to.y + to.inY;
    if (
      Math.abs(from.outX) < EPSILON
      && Math.abs(from.outY) < EPSILON
      && Math.abs(to.inX) < EPSILON
      && Math.abs(to.inY) < EPSILON
    ) {
      path.lineTo(to.x, to.y);
    } else {
      path.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, to.x, to.y);
    }
  }
  if (subpath.closed) path.closePath();
}

export function shapePath2D(shape: VectorShape): Path2D {
  const path = new Path2D();
  for (const subpath of shape.subpaths) addSubpathToPath(path, subpath);
  return path;
}

function gradientPaint(context: CanvasRenderingContext2D, gradient: VectorGradient): CanvasGradient {
  const paint = gradient.type === 'radial'
    ? context.createRadialGradient(
        gradient.highlight?.x ?? gradient.from.x,
        gradient.highlight?.y ?? gradient.from.y,
        0,
        gradient.from.x,
        gradient.from.y,
        Math.max(1e-5, Math.hypot(gradient.to.x - gradient.from.x, gradient.to.y - gradient.from.y)),
      )
    : context.createLinearGradient(gradient.from.x, gradient.from.y, gradient.to.x, gradient.to.y);
  for (const stop of gradient.stops) paint.addColorStop(Math.max(0, Math.min(1, stop.offset)), stop.color);
  return paint;
}

/** Paints one editable shape, including Illustrator-style stroke alignment. */
export function paintVectorShape(context: CanvasRenderingContext2D, shape: VectorShape): void {
  const path = shapePath2D(shape);
  const style = shape.style;
  context.save();
  context.globalAlpha *= style.opacity;
  if (style.fill || style.fillGradient) {
    context.fillStyle = style.fillGradient ? gradientPaint(context, style.fillGradient) : style.fill!;
    context.fill(path, style.fillRule);
  }
  if ((style.stroke || style.strokeGradient) && style.strokeWidth > 0) {
    const closed = shape.subpaths.length > 0 && shape.subpaths.every((subpath) => subpath.closed);
    const alignment = closed ? style.strokeAlign ?? 'center' : 'center';
    context.save();
    if (alignment === 'inside') {
      context.clip(path, style.fillRule);
      context.lineWidth = style.strokeWidth * 2;
    } else if (alignment === 'outside') {
      const inverse = new Path2D();
      inverse.rect(-1_000_000, -1_000_000, 2_000_000, 2_000_000);
      inverse.addPath(path);
      context.clip(inverse, 'evenodd');
      context.lineWidth = style.strokeWidth * 2;
    } else {
      context.lineWidth = style.strokeWidth;
    }
    context.strokeStyle = style.strokeGradient ? gradientPaint(context, style.strokeGradient) : style.stroke!;
    context.lineCap = style.lineCap;
    context.lineJoin = style.lineJoin;
    context.miterLimit = style.miterLimit;
    context.setLineDash(style.dashArray ?? []);
    context.lineDashOffset = style.dashOffset ?? 0;
    context.stroke(path);
    context.restore();
  }
  context.restore();
}

export function renderEditableVector(vector: VectorData, scale = 1): HTMLCanvasElement {
  const safeScale = Math.max(0.01, Math.min(32, scale));
  const canvas = createCanvas(
    Math.max(1, Math.ceil(vector.baseWidth * safeScale)),
    Math.max(1, Math.ceil(vector.baseHeight * safeScale)),
  );
  const context = ctx2d(canvas);
  context.scale(safeScale, safeScale);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  for (const shape of vector.shapes ?? []) paintVectorShape(context, shape);
  return canvas;
}

function esc(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

function fmt(value: number): string {
  return Number(value.toFixed(4)).toString();
}

export function subpathToPathData(subpath: VectorSubpath): string {
  if (!subpath.nodes.length) return '';
  const nodes = subpath.nodes;
  let data = `M ${fmt(nodes[0].x)} ${fmt(nodes[0].y)}`;
  const segmentCount = subpath.closed ? nodes.length : nodes.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const from = nodes[index];
    const to = nodes[(index + 1) % nodes.length];
    if (
      Math.abs(from.outX) < EPSILON
      && Math.abs(from.outY) < EPSILON
      && Math.abs(to.inX) < EPSILON
      && Math.abs(to.inY) < EPSILON
    ) {
      data += ` L ${fmt(to.x)} ${fmt(to.y)}`;
    } else {
      data += ` C ${fmt(from.x + from.outX)} ${fmt(from.y + from.outY)} ${fmt(to.x + to.inX)} ${fmt(to.y + to.inY)} ${fmt(to.x)} ${fmt(to.y)}`;
    }
  }
  if (subpath.closed) data += ' Z';
  return data;
}

function gradientSvg(gradient: VectorGradient, id: string): string {
  const stops = gradient.stops
    .map((stop) => `<stop offset="${fmt(stop.offset * 100)}%" stop-color="${esc(stop.color)}"/>`)
    .join('');
  if (gradient.type === 'radial') {
    const radius = Math.max(1e-5, Math.hypot(gradient.to.x - gradient.from.x, gradient.to.y - gradient.from.y));
    const focus = gradient.highlight ?? gradient.from;
    return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${fmt(gradient.from.x)}" cy="${fmt(gradient.from.y)}" r="${fmt(radius)}" fx="${fmt(focus.x)}" fy="${fmt(focus.y)}">${stops}</radialGradient>`;
  }
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmt(gradient.from.x)}" y1="${fmt(gradient.from.y)}" x2="${fmt(gradient.to.x)}" y2="${fmt(gradient.to.y)}">${stops}</linearGradient>`;
}

export function vectorSvgBody(vector: VectorData, idPrefix = 'vector'): string {
  const definitions: string[] = [];
  const paths = (vector.shapes ?? []).map((shape, index) => {
    const style = shape.style;
    const d = shape.subpaths.map(subpathToPathData).filter(Boolean).join(' ');
    const fillId = `${idPrefix}-fill-${index}`;
    const strokeId = `${idPrefix}-stroke-${index}`;
    if (style.fillGradient) definitions.push(gradientSvg(style.fillGradient, fillId));
    if (style.strokeGradient) definitions.push(gradientSvg(style.strokeGradient, strokeId));
    const fill = style.fillGradient ? `url(#${fillId})` : style.fill ? esc(style.fill) : 'none';
    const stroke = style.strokeGradient ? `url(#${strokeId})` : style.stroke ? esc(style.stroke) : 'none';
    const closed = shape.subpaths.length > 0 && shape.subpaths.every((subpath) => subpath.closed);
    const alignment = closed ? style.strokeAlign ?? 'center' : 'center';
    const dash = style.dashArray?.length
      ? ` stroke-dasharray="${style.dashArray.map(fmt).join(' ')}" stroke-dashoffset="${fmt(style.dashOffset ?? 0)}"`
      : '';
    const common = `stroke-linecap="${style.lineCap}" stroke-linejoin="${style.lineJoin}" stroke-miterlimit="${fmt(style.miterLimit)}"${dash}`;
    if (stroke !== 'none' && style.strokeWidth > 0 && alignment !== 'center') {
      const alignId = `${idPrefix}-stroke-align-${index}`;
      if (alignment === 'inside') {
        definitions.push(`<clipPath id="${alignId}"><path d="${d}" fill-rule="${style.fillRule}"/></clipPath>`);
      } else {
        definitions.push(`<mask id="${alignId}" maskUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000"><rect x="-100000" y="-100000" width="200000" height="200000" fill="white"/><path d="${d}" fill="black" fill-rule="${style.fillRule}"/></mask>`);
      }
      const fillPath = fill === 'none' ? '' : `<path d="${d}" fill="${fill}" fill-rule="${style.fillRule}"/>`;
      const clip = alignment === 'inside' ? `clip-path="url(#${alignId})"` : `mask="url(#${alignId})"`;
      const strokePath = `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${fmt(style.strokeWidth * 2)}" ${common} ${clip}/>`;
      return `<g opacity="${fmt(style.opacity)}">${fillPath}${strokePath}</g>`;
    }
    return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${fmt(style.strokeWidth)}" opacity="${fmt(style.opacity)}" fill-rule="${style.fillRule}" ${common}/>`;
  }).join('');
  return `${definitions.length ? `<defs>${definitions.join('')}</defs>` : ''}${paths}`;
}

export function vectorToSvg(vector: VectorData): string {
  if (vector.kind === 'placed' && vector.svgText) return vector.svgText;
  const body = vectorSvgBody(vector);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(vector.baseWidth)} ${fmt(vector.baseHeight)}" width="${fmt(vector.baseWidth)}" height="${fmt(vector.baseHeight)}">${body}</svg>`;
}

export function cubicPoint(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x: p0.x * uu * u + 3 * p1.x * uu * t + 3 * p2.x * u * tt + p3.x * tt * t,
    y: p0.y * uu * u + 3 * p1.y * uu * t + 3 * p2.y * u * tt + p3.y * tt * t,
  };
}

function cubicExtrema(a: number, b: number, c: number, d: number): number[] {
  const qa = -a + 3 * b - 3 * c + d;
  const qb = 2 * (a - 2 * b + c);
  const qc = b - a;
  if (Math.abs(qa) < EPSILON) {
    if (Math.abs(qb) < EPSILON) return [];
    const t = -qc / qb;
    return t > 0 && t < 1 ? [t] : [];
  }
  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return [];
  const root = Math.sqrt(disc);
  return [(-qb + root) / (2 * qa), (-qb - root) / (2 * qa)].filter((t) => t > 0 && t < 1);
}

export interface VectorBounds { x: number; y: number; w: number; h: number }

export function vectorGeometryBounds(shapes: readonly VectorShape[]): VectorBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (point: Pt) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };
  for (const shape of shapes) {
    for (const subpath of shape.subpaths) {
      const nodes = subpath.nodes;
      if (!nodes.length) continue;
      include(nodes[0]);
      const segmentCount = subpath.closed ? nodes.length : nodes.length - 1;
      for (let index = 0; index < segmentCount; index += 1) {
        const from = nodes[index];
        const to = nodes[(index + 1) % nodes.length];
        const p0 = { x: from.x, y: from.y };
        const p1 = { x: from.x + from.outX, y: from.y + from.outY };
        const p2 = { x: to.x + to.inX, y: to.y + to.inY };
        const p3 = { x: to.x, y: to.y };
        include(p3);
        const candidates = new Set([
          ...cubicExtrema(p0.x, p1.x, p2.x, p3.x),
          ...cubicExtrema(p0.y, p1.y, p2.y, p3.y),
        ]);
        for (const t of candidates) include(cubicPoint(p0, p1, p2, p3, t));
      }
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
}

export function vectorPaintBounds(shapes: readonly VectorShape[]): VectorBounds | null {
  const geometry = vectorGeometryBounds(shapes);
  if (!geometry) return null;
  const stroke = Math.max(0, ...shapes.map((shape) => {
    if (!(shape.style.stroke || shape.style.strokeGradient)) return 0;
    const closed = shape.subpaths.length > 0 && shape.subpaths.every((subpath) => subpath.closed);
    const alignment = closed ? shape.style.strokeAlign ?? 'center' : 'center';
    return alignment === 'inside' ? 0 : alignment === 'outside' ? shape.style.strokeWidth : shape.style.strokeWidth / 2;
  }));
  return {
    x: geometry.x - stroke,
    y: geometry.y - stroke,
    w: geometry.w + stroke * 2,
    h: geometry.h + stroke * 2,
  };
}

export function normalizeVectorShapes(
  shapes: readonly VectorShape[],
  padding = 2,
): { shapes: VectorShape[]; width: number; height: number; offset: Pt } {
  const cloned = cloneVectorShapes(shapes);
  const bounds = vectorPaintBounds(cloned) ?? { x: 0, y: 0, w: 1, h: 1 };
  const offset = { x: bounds.x - padding, y: bounds.y - padding };
  for (const shape of cloned) {
    shape.style = mapVectorStyleGradients(shape.style, (point) => ({
      x: point.x - offset.x,
      y: point.y - offset.y,
    }));
    for (const subpath of shape.subpaths) {
      for (const node of subpath.nodes) {
        node.x -= offset.x;
        node.y -= offset.y;
      }
    }
    if (shape.primitive) {
      shape.primitive = {
        ...shape.primitive,
        bounds: {
          ...shape.primitive.bounds,
          x: shape.primitive.bounds.x - offset.x,
          y: shape.primitive.bounds.y - offset.y,
        },
      };
    }
  }
  return {
    shapes: cloned,
    width: Math.max(1, Math.ceil(bounds.w + padding * 2)),
    height: Math.max(1, Math.ceil(bounds.h + padding * 2)),
    offset,
  };
}

function distanceSquared(a: Pt, b: Pt): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export interface VectorSegmentHit {
  shapeId: string;
  subpathId: string;
  segmentIndex: number;
  t: number;
  point: Pt;
  distance: number;
}

export function nearestVectorSegment(
  shapes: readonly VectorShape[],
  point: Pt,
  maxDistance = Infinity,
): VectorSegmentHit | null {
  let best: VectorSegmentHit | null = null;
  for (const shape of shapes) {
    for (const subpath of shape.subpaths) {
      const nodes = subpath.nodes;
      const count = subpath.closed ? nodes.length : nodes.length - 1;
      for (let index = 0; index < count; index += 1) {
        const from = nodes[index];
        const to = nodes[(index + 1) % nodes.length];
        const p0 = { x: from.x, y: from.y };
        const p1 = { x: from.x + from.outX, y: from.y + from.outY };
        const p2 = { x: to.x + to.inX, y: to.y + to.inY };
        const p3 = { x: to.x, y: to.y };
        let sample = 0;
        let sampleDistance = Infinity;
        for (let step = 0; step <= 32; step += 1) {
          const t = step / 32;
          const d = distanceSquared(cubicPoint(p0, p1, p2, p3, t), point);
          if (d < sampleDistance) {
            sampleDistance = d;
            sample = t;
          }
        }
        let left = Math.max(0, sample - 1 / 32);
        let right = Math.min(1, sample + 1 / 32);
        for (let pass = 0; pass < 12; pass += 1) {
          const t1 = left + (right - left) / 3;
          const t2 = right - (right - left) / 3;
          if (distanceSquared(cubicPoint(p0, p1, p2, p3, t1), point) <= distanceSquared(cubicPoint(p0, p1, p2, p3, t2), point)) right = t2;
          else left = t1;
        }
        const t = (left + right) / 2;
        const nearest = cubicPoint(p0, p1, p2, p3, t);
        const distance = Math.sqrt(distanceSquared(nearest, point));
        if (distance <= maxDistance && (!best || distance < best.distance)) {
          best = { shapeId: shape.id, subpathId: subpath.id, segmentIndex: index, t, point: nearest, distance };
        }
      }
    }
  }
  return best;
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Splits a cubic exactly with De Casteljau, preserving the original curve. */
export function splitVectorSegment(subpath: VectorSubpath, segmentIndex: number, t: number): VectorSubpath {
  const count = subpath.closed ? subpath.nodes.length : subpath.nodes.length - 1;
  if (segmentIndex < 0 || segmentIndex >= count) return subpath;
  const nodes = subpath.nodes.map((node) => ({ ...node }));
  const nextIndex = (segmentIndex + 1) % nodes.length;
  const from = nodes[segmentIndex];
  const to = nodes[nextIndex];
  const p0 = { x: from.x, y: from.y };
  const p1 = { x: from.x + from.outX, y: from.y + from.outY };
  const p2 = { x: to.x + to.inX, y: to.y + to.inY };
  const p3 = { x: to.x, y: to.y };
  const q0 = lerp(p0, p1, t);
  const q1 = lerp(p1, p2, t);
  const q2 = lerp(p2, p3, t);
  const r0 = lerp(q0, q1, t);
  const r1 = lerp(q1, q2, t);
  const anchor = lerp(r0, r1, t);
  from.outX = q0.x - p0.x;
  from.outY = q0.y - p0.y;
  to.inX = q2.x - p3.x;
  to.inY = q2.y - p3.y;
  const inserted: VectorNode = {
    id: uid(),
    x: anchor.x,
    y: anchor.y,
    inX: r0.x - anchor.x,
    inY: r0.y - anchor.y,
    outX: r1.x - anchor.x,
    outY: r1.y - anchor.y,
    kind: 'smooth',
  };
  nodes.splice(segmentIndex + 1, 0, inserted);
  return { ...subpath, nodes };
}

function normalized(vector: Pt): Pt {
  const length = Math.hypot(vector.x, vector.y);
  return length < EPSILON ? { x: 1, y: 0 } : { x: vector.x / length, y: vector.y / length };
}

export function convertVectorNode(subpath: VectorSubpath, nodeId: string): VectorSubpath {
  const index = subpath.nodes.findIndex((node) => node.id === nodeId);
  if (index < 0) return subpath;
  const nodes = subpath.nodes.map((node) => ({ ...node }));
  const node = nodes[index];
  const nextKind: VectorNodeKind = node.kind === 'corner' ? 'smooth' : node.kind === 'smooth' ? 'symmetric' : 'corner';
  node.kind = nextKind;
  if (nextKind === 'corner') {
    node.inX = 0;
    node.inY = 0;
    node.outX = 0;
    node.outY = 0;
    return { ...subpath, nodes };
  }
  const previous = nodes[index === 0 ? (subpath.closed ? nodes.length - 1 : 0) : index - 1];
  const next = nodes[index === nodes.length - 1 ? (subpath.closed ? 0 : nodes.length - 1) : index + 1];
  const direction = normalized({ x: next.x - previous.x, y: next.y - previous.y });
  const inLength = Math.max(1, Math.hypot(node.x - previous.x, node.y - previous.y) / 3);
  const outLength = Math.max(1, Math.hypot(next.x - node.x, next.y - node.y) / 3);
  const commonLength = nextKind === 'symmetric' ? (inLength + outLength) / 2 : 0;
  node.inX = -direction.x * (commonLength || inLength);
  node.inY = -direction.y * (commonLength || inLength);
  node.outX = direction.x * (commonLength || outLength);
  node.outY = direction.y * (commonLength || outLength);
  return { ...subpath, nodes };
}

export function setVectorNodeHandle(
  node: VectorNode,
  side: 'in' | 'out',
  handle: Pt,
  breakPair = false,
): VectorNode {
  const next = { ...node };
  if (breakPair) next.kind = 'corner';
  if (side === 'in') {
    next.inX = handle.x;
    next.inY = handle.y;
  } else {
    next.outX = handle.x;
    next.outY = handle.y;
  }
  if (breakPair || next.kind === 'corner') return next;
  const length = Math.hypot(handle.x, handle.y);
  if (length < EPSILON) return next;
  const oppositeLength = next.kind === 'symmetric'
    ? length
    : Math.hypot(side === 'in' ? next.outX : next.inX, side === 'in' ? next.outY : next.inY);
  const factor = -(oppositeLength || length) / length;
  if (side === 'in') {
    next.outX = handle.x * factor;
    next.outY = handle.y * factor;
  } else {
    next.inX = handle.x * factor;
    next.inY = handle.y * factor;
  }
  return next;
}

export function findVectorNode(
  shapes: readonly VectorShape[],
  nodeId: string,
): { shape: VectorShape; subpath: VectorSubpath; node: VectorNode; nodeIndex: number } | null {
  for (const shape of shapes) {
    for (const subpath of shape.subpaths) {
      const nodeIndex = subpath.nodes.findIndex((node) => node.id === nodeId);
      if (nodeIndex >= 0) return { shape, subpath, node: subpath.nodes[nodeIndex], nodeIndex };
    }
  }
  return null;
}

export function mapVectorNodes(
  shapes: readonly VectorShape[],
  nodeIds: ReadonlySet<string>,
  mapper: (node: VectorNode, subpath: VectorSubpath) => VectorNode,
): VectorShape[] {
  return shapes.map((shape) => ({
    ...shape,
    style: { ...shape.style },
    subpaths: shape.subpaths.map((subpath) => ({
      ...subpath,
      nodes: subpath.nodes.map((node) => nodeIds.has(node.id) ? mapper({ ...node }, subpath) : { ...node }),
    })),
  }));
}
