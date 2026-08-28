import { describe, expect, it } from 'vitest';
import {
  isCanvasSizeAllowed,
  MAX_CANVAS_DIMENSION,
  MAX_CANVAS_PIXELS,
} from './canvasLimits';

describe('canvas limits', () => {
  it('accepts common production sizes', () => {
    expect(isCanvasSizeAllowed(3840, 2160)).toBe(true);
    expect(isCanvasSizeAllowed(8192, 8192)).toBe(true);
  });

  it('rejects invalid or overlong dimensions', () => {
    expect(isCanvasSizeAllowed(0, 1080)).toBe(false);
    expect(isCanvasSizeAllowed(Number.NaN, 1080)).toBe(false);
    expect(isCanvasSizeAllowed(MAX_CANVAS_DIMENSION + 1, 1)).toBe(false);
  });

  it('rejects dimensions whose total allocation is too large', () => {
    const side = Math.floor(Math.sqrt(MAX_CANVAS_PIXELS)) + 1;
    expect(isCanvasSizeAllowed(side, side)).toBe(false);
  });
});
