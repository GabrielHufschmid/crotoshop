import { describe, expect, it } from 'vitest';
import type { Doc, Layer, VectorShape } from '../types';
import { DEFAULT_ADJUSTMENTS } from '../types';
import { buildSnapCandidates, snapBoundsToCandidates } from './snapping';
import { makeEditableVector } from './vectorPath';

function layer(id: string, x: number): Layer {
  return {
    id,
    name: id,
    visible: true,
    opacity: 1,
    x,
    y: 10,
    canvas: { width: 20, height: 20 } as HTMLCanvasElement,
    adjustments: DEFAULT_ADJUSTMENTS,
    thumb: '',
  };
}

const doc: Doc = { width: 300, height: 180, activeId: 'a', layers: [layer('a', 10), layer('b', 200)] };

describe('snapping', () => {
  it('includes document edges, thirds and center', () => {
    const candidates = buildSnapCandidates(doc, [], new Set());
    expect(candidates.some((candidate) => candidate.axis === 'x' && candidate.pos === 0)).toBe(true);
    expect(candidates.some((candidate) => candidate.axis === 'x' && candidate.pos === 100)).toBe(true);
    expect(candidates.some((candidate) => candidate.axis === 'x' && candidate.pos === 150)).toBe(true);
  });

  it('excludes layers being transformed', () => {
    const candidates = buildSnapCandidates(doc, [], new Set(['b']));
    expect(candidates.some((candidate) => candidate.priority === 3 && candidate.pos === 200)).toBe(false);
  });

  it('prefers a manual guide when distances tie', () => {
    const result = snapBoundsToCandidates(
      { x: 96, y: 0, w: 10, h: 10 },
      [{ axis: 'x', pos: 95, priority: 3 }, { axis: 'x', pos: 97, priority: 0 }],
      4,
    );
    expect(result.bounds.x).toBe(97);
    expect(result.x).toBe(97);
  });

  it('includes anchors and Bezier segment midpoints from other vectors', () => {
    const vectorShape: VectorShape = {
      id: 'shape',
      style: { fill: null, stroke: '#fff', strokeWidth: 1, opacity: 1, fillRule: 'nonzero', lineCap: 'round', lineJoin: 'round', miterLimit: 4 },
      subpaths: [{
        id: 'path',
        closed: false,
        nodes: [
          { id: 'left', x: 10, y: 25, inX: 0, inY: 0, outX: 0, outY: 0, kind: 'corner' },
          { id: 'right', x: 90, y: 25, inX: 0, inY: 0, outX: 0, outY: 0, kind: 'corner' },
        ],
      }],
    };
    const vectorLayer: Layer = {
      ...layer('vector', 50),
      y: 20,
      canvas: { width: 100, height: 100 } as HTMLCanvasElement,
      vector: makeEditableVector([vectorShape], 100, 100),
    };
    const vectorDoc: Doc = { width: 400, height: 300, activeId: vectorLayer.id, layers: [vectorLayer] };
    const candidates = buildSnapCandidates(vectorDoc, [], new Set());
    expect(candidates.some((candidate) => candidate.priority === 2 && candidate.axis === 'x' && candidate.pos === 60)).toBe(true);
    expect(candidates.some((candidate) => candidate.priority === 2 && candidate.axis === 'x' && candidate.pos === 100)).toBe(true);
    const excluded = buildSnapCandidates(vectorDoc, [], new Set([vectorLayer.id]));
    expect(excluded.some((candidate) => candidate.priority === 2 && candidate.axis === 'x' && candidate.pos === 60)).toBe(false);
  });
});
