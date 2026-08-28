import { describe, expect, it } from 'vitest';
import { normalizeRect, resizeBounds, rotatePoint, rotatedBounds } from './transformGeometry';

describe('transform geometry', () => {
  it('normalizes a rectangle drawn in any direction', () => {
    expect(normalizeRect(20, 30, 5, 10)).toEqual({ x: 5, y: 10, w: 15, h: 20 });
  });

  it('keeps aspect ratio from the opposite corner', () => {
    expect(resizeBounds({ x: 10, y: 10, w: 100, h: 50 }, 'se', 20, 2, true)).toEqual({ x: 10, y: 10, w: 120, h: 60 });
  });

  it('does not let a west handle cross its anchor', () => {
    expect(resizeBounds({ x: 10, y: 10, w: 20, h: 20 }, 'w', 30, 0, false)).toEqual({ x: 29, y: 10, w: 1, h: 20 });
  });

  it('rotates points and computes the enclosing bounds', () => {
    const bounds = { x: 0, y: 0, w: 100, h: 50 };
    const point = rotatePoint({ x: 0, y: 0 }, bounds, Math.PI);
    expect(point.x).toBeCloseTo(100);
    expect(point.y).toBeCloseTo(50);
    const rotated = rotatedBounds(bounds, Math.PI / 2);
    expect(rotated.x).toBeCloseTo(25);
    expect(rotated.y).toBeCloseTo(-25);
    expect(rotated.w).toBeCloseTo(50);
    expect(rotated.h).toBeCloseTo(100);
  });
});
