import type { Doc, Guide } from '../types';
import { effectiveLayerBounds, layerToDocumentPoint } from './layerGeometry';
import type { Bounds } from './transformGeometry';
import { cubicPoint } from './vectorPath';

export interface SnapCandidate {
  axis: 'x' | 'y';
  pos: number;
  priority: number;
}

export interface SnapResult {
  bounds: Bounds;
  x?: number;
  y?: number;
}

function addBounds(candidates: SnapCandidate[], bounds: Bounds, priority: number): void {
  candidates.push(
    { axis: 'x', pos: bounds.x, priority },
    { axis: 'x', pos: bounds.x + bounds.w / 2, priority },
    { axis: 'x', pos: bounds.x + bounds.w, priority },
    { axis: 'y', pos: bounds.y, priority },
    { axis: 'y', pos: bounds.y + bounds.h / 2, priority },
    { axis: 'y', pos: bounds.y + bounds.h, priority },
  );
}

function addPoint(candidates: SnapCandidate[], point: { x: number; y: number }, priority: number): void {
  candidates.push(
    { axis: 'x', pos: point.x, priority },
    { axis: 'y', pos: point.y, priority },
  );
}

export function buildSnapCandidates(doc: Doc, guides: readonly Guide[], excludedIds: ReadonlySet<string>): SnapCandidate[] {
  const candidates: SnapCandidate[] = guides.map((guide) => ({ axis: guide.axis, pos: guide.pos, priority: 0 }));
  addBounds(candidates, { x: 0, y: 0, w: doc.width, h: doc.height }, 1);
  candidates.push(
    { axis: 'x', pos: doc.width / 3, priority: 1 },
    { axis: 'x', pos: doc.width * 2 / 3, priority: 1 },
    { axis: 'y', pos: doc.height / 3, priority: 1 },
    { axis: 'y', pos: doc.height * 2 / 3, priority: 1 },
  );
  for (const artboard of doc.artboards ?? []) addBounds(candidates, artboard, 2);
  for (const layer of doc.layers) {
    if (!layer.visible || layer.kind === 'adjustment' || excludedIds.has(layer.id)) continue;
    addBounds(candidates, effectiveLayerBounds(doc, layer), 3);
  }
  let vectorPoints = 0;
  const maxVectorPoints = 12_000;
  vectorLayers: for (const layer of doc.layers) {
    const vector = layer.vector;
    if (!layer.visible || excludedIds.has(layer.id) || vector?.kind !== 'editable' || !vector.shapes) continue;
    const transform = (point: { x: number; y: number }) => layerToDocumentPoint(layer, point, vector.baseWidth, vector.baseHeight);
    for (const shape of vector.shapes) {
      for (const subpath of shape.subpaths) {
        for (const node of subpath.nodes) {
          addPoint(candidates, transform(node), 2);
          vectorPoints += 1;
          if (vectorPoints >= maxVectorPoints) break vectorLayers;
        }
        const segmentCount = subpath.closed ? subpath.nodes.length : subpath.nodes.length - 1;
        for (let index = 0; index < segmentCount; index += 1) {
          const from = subpath.nodes[index];
          const to = subpath.nodes[(index + 1) % subpath.nodes.length];
          const midpoint = cubicPoint(
            from,
            { x: from.x + from.outX, y: from.y + from.outY },
            { x: to.x + to.inX, y: to.y + to.inY },
            to,
            0.5,
          );
          addPoint(candidates, transform(midpoint), 2);
          vectorPoints += 1;
          if (vectorPoints >= maxVectorPoints) break vectorLayers;
        }
      }
    }
  }
  return candidates;
}

export function snapBoundsToCandidates(
  bounds: Bounds,
  candidates: readonly SnapCandidate[],
  threshold: number,
): SnapResult {
  const xs = [bounds.x, bounds.x + bounds.w / 2, bounds.x + bounds.w];
  const ys = [bounds.y, bounds.y + bounds.h / 2, bounds.y + bounds.h];
  let bestX: { delta: number; pos: number; priority: number } | null = null;
  let bestY: { delta: number; pos: number; priority: number } | null = null;

  for (const candidate of candidates) {
    const anchors = candidate.axis === 'x' ? xs : ys;
    for (const anchor of anchors) {
      const delta = candidate.pos - anchor;
      if (Math.abs(delta) > threshold) continue;
      const best = candidate.axis === 'x' ? bestX : bestY;
      if (
        !best
        || Math.abs(delta) < Math.abs(best.delta)
        || (Math.abs(delta) === Math.abs(best.delta) && candidate.priority < best.priority)
      ) {
        const next = { delta, pos: candidate.pos, priority: candidate.priority };
        if (candidate.axis === 'x') bestX = next;
        else bestY = next;
      }
    }
  }

  return {
    bounds: { ...bounds, x: bounds.x + (bestX?.delta ?? 0), y: bounds.y + (bestY?.delta ?? 0) },
    x: bestX?.pos,
    y: bestY?.pos,
  };
}
