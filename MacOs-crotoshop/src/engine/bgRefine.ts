import { createCanvas, ctx2d } from './canvasUtils';

export interface RefineOptions {
  /** 0..255 — alpha below this becomes fully transparent; above is rescaled. */
  threshold: number;
  /** 0..20 px — gaussian blur applied to the alpha edge before thresholding. */
  feather: number;
}

export const DEFAULT_REFINE: RefineOptions = { threshold: 0, feather: 0 };

/**
 * Post-processes the alpha channel of a background-removal result: optional
 * edge feathering (blur) followed by a threshold remap. Colors are kept from
 * the original, so repeated tweaks don't degrade the image.
 */
export function refineAlpha(src: HTMLCanvasElement, opts: RefineOptions): HTMLCanvasElement {
  const { width: w, height: h } = src;
  const out = createCanvas(w, h);
  const g = ctx2d(out);

  if (opts.feather <= 0 && opts.threshold <= 0) {
    g.drawImage(src, 0, 0);
    return out;
  }

  // Blurred copy provides the feathered alpha edge.
  let alphaSource = src;
  if (opts.feather > 0) {
    const blurred = createCanvas(w, h);
    const bg = ctx2d(blurred);
    bg.filter = `blur(${opts.feather}px)`;
    bg.drawImage(src, 0, 0);
    alphaSource = blurred;
  }

  const colorData = ctx2d(src === alphaSource ? src : src).getImageData(0, 0, w, h);
  const alphaData =
    alphaSource === src ? colorData : ctx2d(alphaSource).getImageData(0, 0, w, h);

  const cd = colorData.data;
  const ad = alphaData.data;
  const t = Math.max(0, Math.min(254, opts.threshold));
  const scale = 255 / (255 - t);
  for (let i = 3; i < cd.length; i += 4) {
    const a = ad[i];
    cd[i] = a <= t ? 0 : Math.min(255, Math.round((a - t) * scale));
  }
  g.putImageData(colorData, 0, 0);
  return out;
}
