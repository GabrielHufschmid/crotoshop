import { describe, expect, it } from 'vitest';
import { resolvePixelStretchSample, samplePixelStretchPath, type PixelStretchNode } from './pixelStretch';

describe('pixel stretch bezier path', () => {
  it('starts and ends at its nodes', () => {
    const nodes: PixelStretchNode[] = [
      { x: 0, y: 0, inX: 0, inY: 0, outX: 40, outY: 0 },
      { x: 100, y: 100, inX: -40, inY: 0, outX: 0, outY: 0 },
    ];
    const points = samplePixelStretchPath(nodes);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)).toEqual({ x: 100, y: 100 });
    expect(points.length).toBeGreaterThan(12);
  });

  it('creates a smooth automatic curve through uneven anchors without invalid points', () => {
    const nodes: PixelStretchNode[] = [
      { x: 0, y: 20, inX: 0, inY: 0, outX: 0, outY: 0 },
      { x: 80, y: 10, inX: 0, inY: 0, outX: 0, outY: 0 },
      { x: 105, y: 90, inX: 0, inY: 0, outX: 0, outY: 0 },
      { x: 220, y: 70, inX: 0, inY: 0, outX: 0, outY: 0 },
    ];
    const points = samplePixelStretchPath(nodes, 'auto', 0.82);
    expect(points[0]).toEqual({ x: 0, y: 20 });
    expect(points.at(-1)).toEqual({ x: 220, y: 70 });
    expect(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    expect(points.some((point) => point.x > 80 && point.x < 105 && point.y > 10 && point.y < 90)).toBe(true);
  });

  it('keeps a manually positioned sample independent from the path', () => {
    const nodes: PixelStretchNode[] = [
      { x: 10, y: 20, inX: 0, inY: 0, outX: 0, outY: 0 },
      { x: 100, y: 20, inX: 0, inY: 0, outX: 0, outY: 0 },
    ];
    const manual = { origin: { x: 50, y: 70 }, angle: Math.PI / 3, manual: true };
    expect(resolvePixelStretchSample(nodes, manual, 'auto')).toBe(manual);
    const automatic = resolvePixelStretchSample(nodes, null, 'auto');
    expect(automatic?.origin).toEqual({ x: 10, y: 20 });
    expect(automatic?.angle).toBeCloseTo(Math.PI / 2, 5);
  });
});
