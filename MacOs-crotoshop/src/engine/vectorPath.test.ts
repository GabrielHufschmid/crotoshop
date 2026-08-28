import { describe, expect, it } from 'vitest';
import type { VectorNode, VectorShape, VectorSubpath } from '../types';
import {
  cubicPoint,
  setVectorNodeHandle,
  splitVectorSegment,
  subpathToPathData,
  vectorGeometryBounds,
} from './vectorPath';

function anchor(id: string, x: number, y: number, patch: Partial<VectorNode> = {}): VectorNode {
  return { id, x, y, inX: 0, inY: 0, outX: 0, outY: 0, kind: 'corner', ...patch };
}

function pointOnSegment(path: VectorSubpath, index: number, t: number) {
  const from = path.nodes[index];
  const to = path.nodes[(index + 1) % path.nodes.length];
  return cubicPoint(
    from,
    { x: from.x + from.outX, y: from.y + from.outY },
    { x: to.x + to.inX, y: to.y + to.inY },
    to,
    t,
  );
}

describe('editable vector geometry', () => {
  it('splits a cubic with De Casteljau without changing its geometry', () => {
    const original: VectorSubpath = {
      id: 'path',
      closed: false,
      nodes: [
        anchor('a', 10, 20, { outX: 60, outY: -40, kind: 'smooth' }),
        anchor('b', 180, 90, { inX: -20, inY: 80, kind: 'smooth' }),
      ],
    };
    const splitAt = 0.37;
    const split = splitVectorSegment(original, 0, splitAt);
    expect(split.nodes).toHaveLength(3);
    for (let step = 0; step <= 40; step += 1) {
      const t = step / 40;
      const expected = pointOnSegment(original, 0, t);
      const actual = t <= splitAt
        ? pointOnSegment(split, 0, t / splitAt)
        : pointOnSegment(split, 1, (t - splitAt) / (1 - splitAt));
      expect(actual.x).toBeCloseTo(expected.x, 8);
      expect(actual.y).toBeCloseTo(expected.y, 8);
    }
  });

  it('uses exact interior extrema for cubic bounds', () => {
    const shape: VectorShape = {
      id: 'shape',
      style: { fill: null, stroke: '#000', strokeWidth: 1, opacity: 1, fillRule: 'nonzero', lineCap: 'round', lineJoin: 'round', miterLimit: 4 },
      subpaths: [{
        id: 'path',
        closed: false,
        nodes: [anchor('a', 0, 0, { outY: 100 }), anchor('b', 100, 0, { inY: 100 })],
      }],
    };
    const bounds = vectorGeometryBounds([shape]);
    expect(bounds).not.toBeNull();
    expect(bounds?.x).toBeCloseTo(0, 8);
    expect(bounds?.w).toBeCloseTo(100, 8);
    expect(bounds?.h).toBeCloseTo(75, 8);
  });

  it('keeps symmetric and smooth handle constraints predictable', () => {
    const symmetric = setVectorNodeHandle(anchor('a', 0, 0, {
      kind: 'symmetric', inX: -10, inY: 0, outX: 10, outY: 0,
    }), 'out', { x: 6, y: 8 });
    expect(symmetric.inX).toBeCloseTo(-6, 8);
    expect(symmetric.inY).toBeCloseTo(-8, 8);

    const smooth = setVectorNodeHandle(anchor('b', 0, 0, {
      kind: 'smooth', inX: -20, inY: 0, outX: 10, outY: 0,
    }), 'out', { x: 0, y: 5 });
    expect(Math.hypot(smooth.inX, smooth.inY)).toBeCloseTo(20, 8);
    expect(smooth.inX).toBeCloseTo(0, 8);
    expect(smooth.inY).toBeCloseTo(-20, 8);
  });

  it('serializes open and closed cubic paths as SVG path data', () => {
    const path: VectorSubpath = {
      id: 'path',
      closed: true,
      nodes: [anchor('a', 0, 0, { outX: 10 }), anchor('b', 20, 0, { inX: -10 }), anchor('c', 10, 20)],
    };
    expect(subpathToPathData(path)).toBe('M 0 0 C 10 0 10 0 20 0 L 10 20 L 0 0 Z');
  });
});
