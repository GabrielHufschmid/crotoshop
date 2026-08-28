import { describe, expect, it } from 'vitest';
import { createWarpMesh, sampleWarpSurface } from './warpMesh';

describe('createWarpMesh', () => {
  it('creates an evenly spaced editable grid', () => {
    const mesh = createWarpMesh({ x: 10, y: 20, w: 120, h: 60 }, 4, 3);
    expect(mesh.columns).toBe(4);
    expect(mesh.rows).toBe(3);
    expect(mesh.points).toHaveLength(12);
    expect(mesh.points[0]).toEqual({ x: 10, y: 20 });
    expect(mesh.points[11]).toEqual({ x: 130, y: 80 });
    expect(mesh.points[5]).toEqual({ x: 50, y: 50 });
    expect(mesh.points).not.toBe(mesh.source);
  });

  it('keeps at least two control points per axis', () => {
    const mesh = createWarpMesh({ x: 0, y: 0, w: 10, h: 10 }, 1, 1);
    expect(mesh.columns).toBe(2);
    expect(mesh.rows).toBe(2);
    expect(mesh.points).toHaveLength(4);
  });

  it('does not bend an untouched regular mesh', () => {
    const mesh = createWarpMesh({ x: 10, y: 20, w: 120, h: 60 }, 4, 3);
    const point = sampleWarpSurface(mesh, 0.125, 0.8, 1);
    expect(point.x).toBeCloseTo(25, 6);
    expect(point.y).toBeCloseTo(68, 6);
  });

  it('creates a continuous organic curve around a displaced control point', () => {
    const mesh = createWarpMesh({ x: 0, y: 0, w: 100, h: 100 }, 3, 3);
    mesh.points[4] = { x: 50, y: 15 };
    expect(sampleWarpSurface(mesh, 0.5, 0.5, 1)).toEqual({ x: 50, y: 15 });
    const linear = sampleWarpSurface(mesh, 0.25, 0.5, 0);
    const organic = sampleWarpSurface(mesh, 0.25, 0.5, 1);
    expect(organic.y).toBeLessThan(linear.y);
    const before = sampleWarpSurface(mesh, 0.5 - 1e-4, 0.5, 1);
    const after = sampleWarpSurface(mesh, 0.5 + 1e-4, 0.5, 1);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.1);
  });
});
