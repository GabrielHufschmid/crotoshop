import { describe, expect, it } from 'vitest';
import { strokeRegion } from './brush';

describe('strokeRegion', () => {
  it('limits scratch space to the touched segment', () => {
    expect(strokeRegion(8000, 6000, { x: 100, y: 120 }, { x: 140, y: 160 }, 20)).toEqual({
      x: 90,
      y: 110,
      width: 60,
      height: 60,
    });
  });

  it('clips regions at canvas edges and includes filter padding', () => {
    expect(strokeRegion(100, 80, { x: 2, y: 3 }, { x: 6, y: 7 }, 10, 4)).toEqual({
      x: 0,
      y: 0,
      width: 15,
      height: 16,
    });
  });

  it('ignores a segment entirely outside the canvas', () => {
    expect(strokeRegion(100, 80, { x: -30, y: -30 }, { x: -20, y: -20 }, 4)).toBeNull();
  });
});
