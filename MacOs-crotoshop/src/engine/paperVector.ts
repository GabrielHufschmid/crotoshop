import type { PathfinderOperation, Pt, VectorData, VectorGradient, VectorNode, VectorShape, VectorStyle, VectorSubpath } from '../types';
import { cloneVectorStyle, DEFAULT_VECTOR_STYLE, makeEditableVector } from './vectorPath';
import { uid } from './canvasUtils';

type CoordinateTransform = (point: Pt) => Pt;

export interface PathfinderInput {
  vector: VectorData;
  transform: CoordinateTransform;
}

async function scopeFor(width = 1, height = 1): Promise<paper.PaperScope> {
  const module = await import('paper');
  const paperApi = module.default;
  const scope = new paperApi.PaperScope();
  scope.setup(new scope.Size(Math.max(1, width), Math.max(1, height)));
  scope.settings.insertItems = false;
  scope.settings.applyMatrix = true;
  return scope;
}

function point(scope: paper.PaperScope, value: Pt): paper.Point {
  return new scope.Point(value.x, value.y);
}

function paperPath(
  scope: paper.PaperScope,
  subpath: VectorSubpath,
  transform: CoordinateTransform = (value) => value,
): paper.Path {
  const segments = subpath.nodes.map((node) => {
    const anchor = transform(node);
    const incoming = transform({ x: node.x + node.inX, y: node.y + node.inY });
    const outgoing = transform({ x: node.x + node.outX, y: node.y + node.outY });
    return new scope.Segment(
      point(scope, anchor),
      point(scope, { x: incoming.x - anchor.x, y: incoming.y - anchor.y }),
      point(scope, { x: outgoing.x - anchor.x, y: outgoing.y - anchor.y }),
    );
  });
  const path = new scope.Path(segments);
  path.closed = subpath.closed;
  return path;
}

function shapeItem(
  scope: paper.PaperScope,
  shape: VectorShape,
  transform: CoordinateTransform,
): paper.PathItem | null {
  const paths = shape.subpaths
    .filter((subpath) => subpath.nodes.length >= (subpath.closed ? 3 : 2))
    .map((subpath) => paperPath(scope, subpath, transform));
  if (!paths.length) return null;
  if (paths.length === 1) return paths[0];
  return new scope.CompoundPath({ children: paths, fillRule: shape.style.fillRule });
}

function artworkItem(scope: paper.PaperScope, input: PathfinderInput): paper.PathItem | null {
  const items = (input.vector.shapes ?? [])
    .flatMap((shape) => {
      const item = shapeItem(scope, shape, input.transform);
      return item ? [item] : [];
    });
  if (!items.length) return null;
  let result = items[0];
  for (let index = 1; index < items.length; index += 1) {
    const next = result.unite(items[index], { insert: false });
    result.remove();
    items[index].remove();
    result = next;
  }
  return result;
}

function inferNodeKind(incoming: Pt, outgoing: Pt): VectorNode['kind'] {
  const inLength = Math.hypot(incoming.x, incoming.y);
  const outLength = Math.hypot(outgoing.x, outgoing.y);
  if (inLength < 1e-5 || outLength < 1e-5) return 'corner';
  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
  const collinear = Math.abs(cross) <= inLength * outLength * 1e-4;
  if (!collinear) return 'corner';
  return Math.abs(inLength - outLength) <= Math.max(inLength, outLength) * 1e-3 ? 'symmetric' : 'smooth';
}

function pathToSubpath(path: paper.Path): VectorSubpath {
  const nodes = path.segments.map((segment) => {
    const anchor = path.localToGlobal(segment.point);
    const incomingPoint = path.localToGlobal(segment.point.add(segment.handleIn));
    const outgoingPoint = path.localToGlobal(segment.point.add(segment.handleOut));
    const incoming = { x: incomingPoint.x - anchor.x, y: incomingPoint.y - anchor.y };
    const outgoing = { x: outgoingPoint.x - anchor.x, y: outgoingPoint.y - anchor.y };
    return {
      id: uid(),
      x: anchor.x,
      y: anchor.y,
      inX: incoming.x,
      inY: incoming.y,
      outX: outgoing.x,
      outY: outgoing.y,
      kind: inferNodeKind(incoming, outgoing),
    } satisfies VectorNode;
  });
  return { id: uid(), nodes, closed: path.closed };
}

function pathItemSubpaths(item: paper.PathItem): VectorSubpath[] {
  if (item.className === 'Path') return [pathToSubpath(item as paper.Path)];
  if (item.className === 'CompoundPath') {
    return (item.children ?? [])
      .filter((child) => child.className === 'Path')
      .map((child) => pathToSubpath(child as paper.Path));
  }
  return [];
}

function colorCss(color: paper.Color | null | undefined): string | null {
  if (!color) return null;
  if (color.type === 'gradient' && color.gradient?.stops?.length) {
    const stops = [...color.gradient.stops].sort((left, right) => left.offset - right.offset);
    const target = 0.5;
    const rightIndex = stops.findIndex((stop) => stop.offset >= target);
    const right = stops[rightIndex < 0 ? stops.length - 1 : rightIndex];
    const left = stops[Math.max(0, rightIndex <= 0 ? 0 : rightIndex - 1)];
    const span = Math.max(1e-7, right.offset - left.offset);
    const amount = Math.max(0, Math.min(1, (target - left.offset) / span));
    const channel = (from: number, to: number) => Math.round((from + (to - from) * amount) * 255);
    const alpha = left.color.alpha + (right.color.alpha - left.color.alpha) * amount;
    return `rgba(${channel(left.color.red, right.color.red)}, ${channel(left.color.green, right.color.green)}, ${channel(left.color.blue, right.color.blue)}, ${Number(alpha.toFixed(4))})`;
  }
  return color.toCSS(true);
}

function gradientData(color: paper.Color | null | undefined): VectorGradient | undefined {
  if (!color || color.type !== 'gradient' || !color.gradient?.stops?.length) return undefined;
  const positioned = color as paper.Color & { origin?: paper.Point; destination?: paper.Point };
  const from = positioned.origin;
  const to = positioned.destination;
  if (!from || !to) return undefined;
  const stopCount = color.gradient.stops.length;
  const stops = color.gradient.stops.flatMap((stop, index) => {
    const css = colorCss(stop.color);
    if (!css) return [];
    return [{
      offset: Number.isFinite(stop.offset) ? Math.max(0, Math.min(1, stop.offset)) : index / Math.max(1, stopCount - 1),
      color: css,
    }];
  });
  if (!stops.length) return undefined;
  return {
    type: color.gradient.radial ? 'radial' : 'linear',
    from: { x: from.x, y: from.y },
    to: { x: to.x, y: to.y },
    highlight: color.gradient.radial && color.highlight
      ? { x: color.highlight.x, y: color.highlight.y }
      : undefined,
    stops,
  };
}

function itemStyle(item: paper.PathItem): VectorStyle {
  const fillGradient = gradientData(item.fillColor);
  const strokeGradient = gradientData(item.strokeColor);
  return {
    fill: colorCss(item.fillColor),
    stroke: colorCss(item.strokeColor),
    fillGradient,
    strokeGradient,
    strokeWidth: Math.max(0, item.strokeWidth || 0),
    opacity: Math.max(0, Math.min(1, item.opacity ?? 1)),
    fillRule: item.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
    lineCap: item.strokeCap === 'square' || item.strokeCap === 'butt' ? item.strokeCap : 'round',
    lineJoin: item.strokeJoin === 'miter' || item.strokeJoin === 'bevel' ? item.strokeJoin : 'round',
    miterLimit: Math.max(1, item.miterLimit || 4),
    dashArray: item.dashArray?.length ? [...item.dashArray] : undefined,
    dashOffset: item.dashOffset || 0,
  };
}

function collectImportedShapes(item: paper.Item, inheritedStyle?: VectorStyle): VectorShape[] {
  if (item.className === 'CompoundPath') {
    const pathItem = item as paper.CompoundPath;
    const subpaths = pathItemSubpaths(pathItem);
    return subpaths.length ? [{ id: uid(), subpaths, style: itemStyle(pathItem) }] : [];
  }
  if (item.className === 'Path') {
    const pathItem = item as paper.Path;
    return [{ id: uid(), subpaths: [pathToSubpath(pathItem)], style: inheritedStyle ?? itemStyle(pathItem) }];
  }
  if (item.className === 'Shape') {
    const converted = (item as paper.Shape).toPath(false);
    const result = collectImportedShapes(converted, inheritedStyle);
    converted.remove();
    return result;
  }
  return (item.children ?? []).flatMap((child) => collectImportedShapes(child, inheritedStyle));
}

/** Expands every SVG primitive Paper.js understands into editable cubic paths. */
export async function editableVectorFromSvg(
  svgText: string,
  baseWidth: number,
  baseHeight: number,
): Promise<VectorData> {
  const scope = await scopeFor(baseWidth, baseHeight);
  try {
    const imported = scope.project.importSVG(svgText, {
      insert: false,
      expandShapes: true,
      applyMatrix: true,
    });
    const shapes = collectImportedShapes(imported).filter((shape) => shape.subpaths.some((path) => path.nodes.length >= 2));
    if (!shapes.length) throw new Error('El archivo no contiene trazados vectoriales expandibles');
    return makeEditableVector(shapes, baseWidth, baseHeight, svgText);
  } finally {
    scope.project.remove();
  }
}

/** Reduces noisy traced contours while staying within a document-pixel tolerance. */
export async function simplifyVectorShapes(
  shapes: readonly VectorShape[],
  tolerance: number,
): Promise<VectorShape[]> {
  const scope = await scopeFor();
  try {
    return shapes.map((shape) => ({
      ...shape,
      primitive: undefined,
      style: cloneVectorStyle(shape.style),
      subpaths: shape.subpaths.map((subpath) => {
        if (subpath.nodes.length < 3) return { ...subpath, nodes: subpath.nodes.map((node) => ({ ...node })) };
        const path = paperPath(scope, subpath);
        path.simplify(Math.max(0.01, tolerance));
        const simplified = pathToSubpath(path);
        path.remove();
        return simplified.nodes.length >= (subpath.closed ? 3 : 2) ? simplified : subpath;
      }),
    }));
  } finally {
    scope.project.remove();
  }
}

function operationResult(
  left: paper.PathItem,
  right: paper.PathItem,
  operation: PathfinderOperation,
): paper.PathItem {
  if (operation === 'unite') return left.unite(right, { insert: false });
  if (operation === 'subtract') return left.subtract(right, { insert: false });
  if (operation === 'intersect') return left.intersect(right, { insert: false });
  return left.exclude(right, { insert: false });
}

/** Executes true Bezier boolean operations in document coordinates. */
export async function runPathfinder(
  inputs: readonly PathfinderInput[],
  operation: PathfinderOperation,
  resultStyle?: VectorStyle,
): Promise<VectorShape[]> {
  if (inputs.length < 2) throw new Error('Seleccioná al menos dos capas vectoriales editables');
  const scope = await scopeFor();
  try {
    const items = inputs.map((input) => artworkItem(scope, input));
    if (items.some((item) => !item)) throw new Error('Una capa no contiene áreas vectoriales válidas');
    let result = items[0]!;
    for (let index = 1; index < items.length; index += 1) {
      const right = items[index]!;
      const next = operationResult(result, right, operation);
      result.remove();
      right.remove();
      result = next;
    }
    const subpaths = pathItemSubpaths(result).filter((path) => path.nodes.length >= 2);
    if (!subpaths.length) throw new Error('La operación no produjo ninguna forma visible');
    return [{
      id: uid(),
      name: operation === 'unite' ? 'Unión' : operation === 'subtract' ? 'Resta' : operation === 'intersect' ? 'Intersección' : 'Exclusión',
      subpaths,
      style: { ...(resultStyle ?? DEFAULT_VECTOR_STYLE), fillRule: 'nonzero' },
    }];
  } finally {
    scope.project.remove();
  }
}
