import { describe, expect, it } from 'vitest';
import type { VectorShape, VectorStyle } from '../types';
import { vectorPaintBounds, vectorSvgBody, makeEditableVector } from './vectorPath';
import {
  createVectorPrimitive,
  hasRoundableVectorCorners,
  rebuildVectorPrimitive,
  roundVectorShapeCorners,
} from './vectorPrimitives';

const style: VectorStyle = {
  fill: '#ff3366',
  stroke: '#ffffff',
  strokeWidth: 10,
  strokeAlign: 'center',
  opacity: 1,
  fillRule: 'nonzero',
  lineCap: 'round',
  lineJoin: 'round',
  miterLimit: 4,
};

describe('vector primitives', () => {
  it('creates parametrically rounded rectangles with cubic handles', () => {
    const rectangle = createVectorPrimitive('rectangle', { x: 10, y: 20, w: 200, h: 100 }, {
      style,
      cornerRadius: 18,
    });
    expect(rectangle.primitive).toMatchObject({ kind: 'rectangle', cornerRadius: 18 });
    expect(rectangle.subpaths[0].nodes).toHaveLength(8);
    expect(rectangle.subpaths[0].nodes.some((node) => Math.hypot(node.inX, node.inY) > 0)).toBe(true);
    expect(rectangle.subpaths[0].nodes.some((node) => Math.hypot(node.outX, node.outY) > 0)).toBe(true);
  });

  it('keeps regular polygon sides editable', () => {
    const polygon = createVectorPrimitive('polygon', { x: 0, y: 0, w: 120, h: 120 }, { style, sides: 5 });
    const octagon = rebuildVectorPrimitive(polygon, { sides: 8 });
    expect(polygon.subpaths[0].nodes).toHaveLength(5);
    expect(octagon.primitive?.sides).toBe(8);
    expect(octagon.subpaths[0].nodes).toHaveLength(8);
  });

  it('rounds straight custom vectors without touching curved paths', () => {
    const polygon = createVectorPrimitive('triangle', { x: 0, y: 0, w: 100, h: 80 }, { style });
    const detached: VectorShape = { ...polygon, primitive: undefined };
    expect(hasRoundableVectorCorners(detached)).toBe(true);
    const rounded = roundVectorShapeCorners(detached, 12);
    expect(rounded.subpaths[0].nodes).toHaveLength(6);
    expect(rounded.primitive).toBeUndefined();
  });
});

describe('vector stroke alignment', () => {
  const square = (strokeAlign: VectorStyle['strokeAlign']): VectorShape => createVectorPrimitive(
    'rectangle',
    { x: 20, y: 20, w: 100, h: 80 },
    { style: { ...style, strokeAlign } },
  );

  it('accounts for inside, centered and outside paint bounds', () => {
    expect(vectorPaintBounds([square('inside')])).toEqual({ x: 20, y: 20, w: 100, h: 80 });
    expect(vectorPaintBounds([square('center')])).toEqual({ x: 15, y: 15, w: 110, h: 90 });
    expect(vectorPaintBounds([square('outside')])).toEqual({ x: 10, y: 10, w: 120, h: 100 });
  });

  it('preserves non-centered stroke appearance in SVG output', () => {
    const vector = makeEditableVector([square('outside')], 160, 140);
    const svg = vectorSvgBody(vector);
    expect(svg).toContain('<mask id="vector-stroke-align-0"');
    expect(svg).toContain('stroke-width="20"');
    expect(svg).toContain('mask="url(#vector-stroke-align-0)"');
  });
});
