import type {
  Pt,
  VectorNode,
  VectorPrimitiveKind,
  VectorShape,
  VectorStyle,
  VectorSubpath,
} from '../types';
import { uid } from './canvasUtils';

export interface PrimitiveOptions {
  sides?: number;
  cornerRadius?: number;
  style: VectorStyle;
  id?: string;
  name?: string;
}

const KAPPA = 0.5522847498307936;
const EPSILON = 1e-6;

function node(point: Pt, patch: Partial<VectorNode> = {}): VectorNode {
  return {
    id: uid('node'),
    x: point.x,
    y: point.y,
    inX: 0,
    inY: 0,
    outX: 0,
    outY: 0,
    kind: 'corner',
    ...patch,
  };
}

function distance(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function normalized(from: Pt, to: Pt): Pt {
  const length = Math.max(EPSILON, distance(from, to));
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

/** Converts polygon corners to tangent cubic arcs while keeping straight edges. */
export function roundedPolygonNodes(vertices: readonly Pt[], requestedRadius: number): VectorNode[] {
  const radius = Math.max(0, requestedRadius);
  if (vertices.length < 3 || radius < EPSILON) return vertices.map((point) => node(point));

  const output: VectorNode[] = [];
  for (let index = 0; index < vertices.length; index += 1) {
    const previous = vertices[(index - 1 + vertices.length) % vertices.length];
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    const towardPrevious = normalized(current, previous);
    const towardNext = normalized(current, next);
    const incoming = normalized(previous, current);
    const outgoing = normalized(current, next);
    const cosine = Math.max(-1, Math.min(1, towardPrevious.x * towardNext.x + towardPrevious.y * towardNext.y));
    const interior = Math.acos(cosine);
    const tangentFactor = Math.max(EPSILON, Math.tan(interior / 2));
    const maxTangent = Math.min(distance(previous, current), distance(current, next)) * 0.49;
    const tangent = Math.min(maxTangent, radius / tangentFactor);
    if (tangent < EPSILON) {
      output.push(node(current));
      continue;
    }
    const effectiveRadius = tangent * tangentFactor;
    const sweep = Math.PI - interior;
    const handleLength = Math.min(tangent, (4 / 3) * effectiveRadius * Math.tan(sweep / 4));
    const start = {
      x: current.x + towardPrevious.x * tangent,
      y: current.y + towardPrevious.y * tangent,
    };
    const end = {
      x: current.x + towardNext.x * tangent,
      y: current.y + towardNext.y * tangent,
    };
    output.push(node(start, {
      outX: incoming.x * handleLength,
      outY: incoming.y * handleLength,
      kind: 'corner',
    }));
    output.push(node(end, {
      inX: -outgoing.x * handleLength,
      inY: -outgoing.y * handleLength,
      kind: 'corner',
    }));
  }
  return output;
}

function ellipseNodes(bounds: { x: number; y: number; w: number; h: number }): VectorNode[] {
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  const rx = bounds.w / 2;
  const ry = bounds.h / 2;
  return [
    node({ x: cx, y: bounds.y }, { inX: -rx * KAPPA, outX: rx * KAPPA, kind: 'smooth' }),
    node({ x: bounds.x + bounds.w, y: cy }, { inY: -ry * KAPPA, outY: ry * KAPPA, kind: 'smooth' }),
    node({ x: cx, y: bounds.y + bounds.h }, { inX: rx * KAPPA, outX: -rx * KAPPA, kind: 'smooth' }),
    node({ x: bounds.x, y: cy }, { inY: ry * KAPPA, outY: -ry * KAPPA, kind: 'smooth' }),
  ];
}

function primitiveVertices(
  kind: Exclude<VectorPrimitiveKind, 'ellipse'>,
  bounds: { x: number; y: number; w: number; h: number },
  sides: number,
): Pt[] {
  if (kind === 'rectangle') {
    return [
      { x: bounds.x, y: bounds.y },
      { x: bounds.x + bounds.w, y: bounds.y },
      { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
      { x: bounds.x, y: bounds.y + bounds.h },
    ];
  }
  if (kind === 'triangle') {
    return [
      { x: bounds.x + bounds.w / 2, y: bounds.y },
      { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
      { x: bounds.x, y: bounds.y + bounds.h },
    ];
  }
  const count = Math.max(3, Math.min(64, Math.round(sides)));
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  const rx = bounds.w / 2;
  const ry = bounds.h / 2;
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
    return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
  });
}

export function primitiveName(kind: VectorPrimitiveKind): string {
  if (kind === 'rectangle') return 'Rectángulo';
  if (kind === 'ellipse') return 'Elipse';
  if (kind === 'triangle') return 'Triángulo';
  return 'Polígono';
}

export function createVectorPrimitive(
  kind: VectorPrimitiveKind,
  bounds: { x: number; y: number; w: number; h: number },
  options: PrimitiveOptions,
): VectorShape {
  const normalizedBounds = {
    x: Math.min(bounds.x, bounds.x + bounds.w),
    y: Math.min(bounds.y, bounds.y + bounds.h),
    w: Math.abs(bounds.w),
    h: Math.abs(bounds.h),
  };
  const sides = kind === 'triangle' ? 3 : Math.max(3, Math.min(64, Math.round(options.sides ?? 6)));
  const cornerRadius = kind === 'ellipse' ? 0 : Math.max(0, options.cornerRadius ?? 0);
  const nodes = kind === 'ellipse'
    ? ellipseNodes(normalizedBounds)
    : roundedPolygonNodes(primitiveVertices(kind, normalizedBounds, sides), cornerRadius);
  return {
    id: options.id ?? uid('shape'),
    name: options.name ?? primitiveName(kind),
    style: { ...options.style },
    primitive: { kind, bounds: normalizedBounds, sides, cornerRadius },
    subpaths: [{ id: uid('path'), nodes, closed: true }],
  };
}

export function rebuildVectorPrimitive(
  shape: VectorShape,
  patch: Partial<NonNullable<VectorShape['primitive']>>,
): VectorShape {
  if (!shape.primitive) return shape;
  const primitive = { ...shape.primitive, ...patch, bounds: { ...shape.primitive.bounds, ...(patch.bounds ?? {}) } };
  return createVectorPrimitive(primitive.kind, primitive.bounds, {
    id: shape.id,
    name: shape.name,
    style: shape.style,
    sides: primitive.sides,
    cornerRadius: primitive.cornerRadius,
  });
}

export function hasRoundableVectorCorners(shape: VectorShape): boolean {
  return shape.subpaths.some((subpath) => subpath.closed && subpath.nodes.length >= 3 && subpath.nodes.every((item) => (
    Math.hypot(item.inX, item.inY) < EPSILON && Math.hypot(item.outX, item.outY) < EPSILON
  )));
}

/** Rounds straight closed paths. Existing curved subpaths are left untouched. */
export function roundVectorShapeCorners(shape: VectorShape, radius: number): VectorShape {
  return {
    ...shape,
    primitive: undefined,
    subpaths: shape.subpaths.map((subpath): VectorSubpath => {
      const straight = subpath.closed && subpath.nodes.length >= 3 && subpath.nodes.every((item) => (
        Math.hypot(item.inX, item.inY) < EPSILON && Math.hypot(item.outX, item.outY) < EPSILON
      ));
      return straight
        ? { ...subpath, nodes: roundedPolygonNodes(subpath.nodes, radius) }
        : { ...subpath, nodes: subpath.nodes.map((item) => ({ ...item })) };
    }),
  };
}
