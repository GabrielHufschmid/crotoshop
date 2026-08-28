import { describe, expect, it } from 'vitest';
import type { Layer, VectorShape } from '../types';
import { DEFAULT_ADJUSTMENTS } from '../types';
import { makeEditableVector } from './vectorPath';
import { exportDocumentSvg, exportVectorLayerSvg } from './export';

const shape: VectorShape = {
  id: 'shape',
  name: 'Curve',
  style: {
    fill: '#ff006e', stroke: '#111111', strokeWidth: 2, opacity: 0.8,
    fillRule: 'nonzero', lineCap: 'round', lineJoin: 'round', miterLimit: 4,
  },
  subpaths: [{
    id: 'path',
    closed: true,
    nodes: [
      { id: 'a', x: 0, y: 0, inX: 0, inY: 0, outX: 12, outY: 0, kind: 'smooth' },
      { id: 'b', x: 40, y: 0, inX: -12, inY: 0, outX: 0, outY: 0, kind: 'smooth' },
      { id: 'c', x: 20, y: 30, inX: 0, inY: 0, outX: 0, outY: 0, kind: 'corner' },
    ],
  }],
};

function vectorLayer(): Layer {
  return {
    id: 'vector',
    name: 'Logo & mark',
    visible: true,
    opacity: 0.75,
    x: 20,
    y: 30,
    w: 100,
    h: 60,
    rotation: Math.PI / 2,
    flipX: true,
    canvas: { width: 50, height: 40 } as HTMLCanvasElement,
    vector: makeEditableVector([shape], 50, 40),
    adjustments: DEFAULT_ADJUSTMENTS,
    thumb: '',
  };
}

describe('SVG vector export', () => {
  it('keeps paths, appearance and non-destructive layer transforms', async () => {
    const blob = exportVectorLayerSvg(vectorLayer());
    const svg = await blob.text();
    expect(blob.type).toContain('image/svg+xml');
    expect(svg).toContain('<path d="M 0 0 C 12 0 28 0 40 0');
    expect(svg).toContain('fill="#ff006e"');
    expect(svg).toContain('rotate(90)');
    expect(svg).toContain('scale(-2 1.5)');
    expect(svg).toContain('<title>Logo &amp; mark</title>');
    expect(svg).toContain('opacity="0.75"');
  });

  it('lets the SVG viewport be resized without flattening its geometry', async () => {
    const svg = await exportVectorLayerSvg(vectorLayer(), { width: 800, height: 600 }).text();
    expect(svg).toContain('width="800" height="600"');
    expect(svg).toContain('<path');
    expect(svg).not.toContain('<image');
  });

  it('serializes editable linear gradients instead of flattening them', async () => {
    const layer = vectorLayer();
    layer.rotation = 0;
    layer.flipX = false;
    layer.vector = makeEditableVector([{
      ...shape,
      style: {
        ...shape.style,
        fillGradient: {
          type: 'linear',
          from: { x: 2, y: 3 },
          to: { x: 38, y: 27 },
          stops: [{ offset: 0, color: '#4c8dff' }, { offset: 1, color: '#8b5cf6' }],
        },
      },
    }], 50, 40);
    const svg = await exportVectorLayerSvg(layer).text();
    expect(svg).toContain('<linearGradient');
    expect(svg).toContain('gradientUnits="userSpaceOnUse"');
    expect(svg).toContain('stop-color="#4c8dff"');
    expect(svg).toContain('fill="url(#vector-fill-0)"');
  });

  it('preserves professional stroke settings in SVG', async () => {
    const layer = vectorLayer();
    layer.vector = makeEditableVector([{
      ...shape,
      style: {
        ...shape.style,
        lineCap: 'square',
        lineJoin: 'bevel',
        dashArray: [12, 5, 2, 5],
        dashOffset: 3.5,
      },
    }], 50, 40);
    const svg = await exportVectorLayerSvg(layer).text();
    expect(svg).toContain('stroke-linecap="square"');
    expect(svg).toContain('stroke-linejoin="bevel"');
    expect(svg).toContain('stroke-dasharray="12 5 2 5"');
    expect(svg).toContain('stroke-dashoffset="3.5"');
  });

  it('exports a multi-layer logo without flattening or colliding gradient ids', async () => {
    const first = vectorLayer();
    first.id = 'logo-left';
    first.rotation = 0;
    first.flipX = false;
    first.x = 10;
    const second = vectorLayer();
    second.id = 'logo-right';
    second.rotation = 0;
    second.flipX = false;
    second.x = 130;
    const withGradient = (from: string, to: string) => makeEditableVector([{
      ...shape,
      style: {
        ...shape.style,
        fillGradient: {
          type: 'linear' as const,
          from: { x: 0, y: 0 },
          to: { x: 40, y: 30 },
          stops: [{ offset: 0, color: from }, { offset: 1, color: to }],
        },
      },
    }], 50, 40);
    first.vector = withGradient('#ff006e', '#ffbe0b');
    second.vector = withGradient('#3a86ff', '#8338ec');
    const svg = await exportDocumentSvg({ width: 320, height: 180, activeId: second.id, layers: [first, second] }).then((blob) => blob.text());
    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(svg).toContain('id="logo-left-fill-0"');
    expect(svg).toContain('id="logo-right-fill-0"');
    expect(svg).toContain('translate(60 60)');
    expect(svg).toContain('translate(180 60)');
    expect(svg).not.toContain('<image');
  });
});
