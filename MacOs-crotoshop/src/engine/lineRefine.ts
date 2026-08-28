import { createCanvas, ctx2d } from './canvasUtils';

/**
 * Cleans anti-aliased type and line edges without sharpening the alpha mask.
 * Semi-transparent pixels inherit a weighted local foreground color while
 * retaining their original coverage, which removes color fringing instead of
 * creating hard, stair-stepped edges.
 */
export function refineTextAndLines(source: HTMLCanvasElement): HTMLCanvasElement {
  const w = source.width;
  const h = source.height;
  const input = ctx2d(source).getImageData(0, 0, w, h);
  const out = new ImageData(new Uint8ClampedArray(input.data), w, h);
  const src = input.data;
  const dst = out.data;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const alpha = src[i + 3];
      if (alpha < 6 || alpha > 249) continue;

      let weight = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const ni = ((y + oy) * w + x + ox) * 4;
          const neighborAlpha = src[ni + 3];
          if (neighborAlpha < alpha) continue;
          const spatial = ox === 0 && oy === 0 ? 2 : 1;
          const neighborWeight = spatial * neighborAlpha;
          r += src[ni] * neighborWeight;
          g += src[ni + 1] * neighborWeight;
          b += src[ni + 2] * neighborWeight;
          weight += neighborWeight;
        }
      }
      if (!weight) continue;
      // A partial blend keeps subtle intentional color transitions intact.
      const mix = 0.58;
      dst[i] = Math.round(src[i] * (1 - mix) + (r / weight) * mix);
      dst[i + 1] = Math.round(src[i + 1] * (1 - mix) + (g / weight) * mix);
      dst[i + 2] = Math.round(src[i + 2] * (1 - mix) + (b / weight) * mix);
    }
  }

  const result = createCanvas(w, h);
  ctx2d(result).putImageData(out, 0, 0);
  return result;
}
