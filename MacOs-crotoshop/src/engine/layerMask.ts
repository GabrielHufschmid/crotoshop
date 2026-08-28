import type { LayerMask } from '../types';
import { bumpCanvasVersion, canvasVersion, cloneCanvas, createCanvas, ctx2d } from './canvasUtils';

interface MaskCacheEntry {
  version: number;
  density: number;
  feather: number;
  canvas: HTMLCanvasElement;
}

const effectiveMaskCache = new WeakMap<HTMLCanvasElement, MaskCacheEntry>();

function clamp01(value: number | undefined): number {
  return Math.max(0, Math.min(1, value ?? 1));
}

function featherRadius(value: number | undefined): number {
  return Math.max(0, Math.min(250, value ?? 0));
}

/**
 * Converts legacy black/white RGB masks to the alpha representation used by
 * the compositor. New masks are already alpha-only, but projects created by
 * older builds painted opaque black and would otherwise reveal everything.
 */
export function normalizeLegacyMask(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const context = ctx2d(canvas);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  let changed = false;
  for (let index = 0; index < image.data.length; index += 4) {
    const alpha = image.data[index + 3];
    if (!alpha) continue;
    const luminance = Math.round(
      image.data[index] * 0.2126
      + image.data[index + 1] * 0.7152
      + image.data[index + 2] * 0.0722,
    );
    if (luminance < 255) {
      image.data[index + 3] = Math.round(alpha * luminance / 255);
      changed = true;
    }
    if (image.data[index] !== 255 || image.data[index + 1] !== 255 || image.data[index + 2] !== 255) {
      image.data[index] = 255;
      image.data[index + 1] = 255;
      image.data[index + 2] = 255;
      changed = true;
    }
  }
  if (changed) {
    context.putImageData(image, 0, 0);
    bumpCanvasVersion(canvas);
  }
  return canvas;
}

/** Returns an alpha mask with density and feather applied, cached by version. */
export function effectiveLayerMask(mask: LayerMask): HTMLCanvasElement {
  const density = clamp01(mask.density);
  const feather = featherRadius(mask.feather);
  if (density === 1 && feather === 0) return mask.canvas;

  const version = canvasVersion(mask.canvas);
  const hit = effectiveMaskCache.get(mask.canvas);
  if (hit && hit.version === version && hit.density === density && hit.feather === feather) return hit.canvas;

  // `hidden` is the inverse alpha of the user mask. Blurring this map gives
  // feathered concealment without dark RGB values leaking into the result.
  const hidden = createCanvas(mask.canvas.width, mask.canvas.height);
  const hiddenContext = ctx2d(hidden);
  hiddenContext.fillStyle = '#fff';
  hiddenContext.fillRect(0, 0, hidden.width, hidden.height);
  hiddenContext.globalCompositeOperation = 'destination-out';
  hiddenContext.drawImage(mask.canvas, 0, 0);
  hiddenContext.globalCompositeOperation = 'source-over';

  let concealment = hidden;
  if (feather > 0) {
    concealment = createCanvas(hidden.width, hidden.height);
    const feathered = ctx2d(concealment);
    feathered.filter = `blur(${feather}px)`;
    feathered.drawImage(hidden, 0, 0);
    feathered.filter = 'none';
  }

  const output = hit?.canvas && hit.canvas.width === mask.canvas.width && hit.canvas.height === mask.canvas.height
    ? hit.canvas
    : createCanvas(mask.canvas.width, mask.canvas.height);
  const outputContext = ctx2d(output);
  outputContext.clearRect(0, 0, output.width, output.height);
  outputContext.fillStyle = '#fff';
  outputContext.fillRect(0, 0, output.width, output.height);
  outputContext.globalAlpha = density;
  outputContext.globalCompositeOperation = 'destination-out';
  outputContext.drawImage(concealment, 0, 0);
  outputContext.globalAlpha = 1;
  outputContext.globalCompositeOperation = 'source-over';

  effectiveMaskCache.set(mask.canvas, { version, density, feather, canvas: output });
  return output;
}

export function invertLayerMaskCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const output = createCanvas(source.width, source.height);
  const context = ctx2d(output);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, output.width, output.height);
  context.globalCompositeOperation = 'destination-out';
  context.drawImage(source, 0, 0);
  context.globalCompositeOperation = 'source-over';
  return output;
}

export function applyLayerMaskCanvas(source: HTMLCanvasElement, mask: LayerMask): HTMLCanvasElement {
  const output = cloneCanvas(source);
  const context = ctx2d(output);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(effectiveLayerMask(mask), 0, 0, output.width, output.height);
  context.globalCompositeOperation = 'source-over';
  return output;
}
