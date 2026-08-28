import type { Layer, Selection } from '../types';
import { createCanvas, ctx2d } from './canvasUtils';

/** Projects the document-sized selection mask into the active layer's pixels. */
export function selectionMaskForLayer(
  selection: Selection,
  layer: Layer,
  _docWidth: number,
  _docHeight: number,
  pixelWidth = layer.canvas.width,
  pixelHeight = layer.canvas.height,
): HTMLCanvasElement {
  const mask = createCanvas(pixelWidth, pixelHeight);
  const drawnW = layer.w ?? layer.canvas.width;
  const drawnH = layer.h ?? layer.canvas.height;
  const scaleX = drawnW / pixelWidth;
  const scaleY = drawnH / pixelHeight;
  const centerX = layer.x + drawnW / 2;
  const centerY = layer.y + drawnH / 2;
  const angle = layer.rotation ?? 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const flipX = layer.flipX ? -1 : 1;
  const flipY = layer.flipY ? -1 : 1;
  const context = ctx2d(mask);
  context.imageSmoothingEnabled = true;
  const a = flipX * cos / scaleX;
  const b = -flipY * sin / scaleY;
  const c = flipX * sin / scaleX;
  const d = flipY * cos / scaleY;
  const e = pixelWidth / 2 - a * centerX - c * centerY;
  const f = pixelHeight / 2 - b * centerX - d * centerY;
  context.setTransform(a, b, c, d, e, f);
  context.drawImage(selection.mask, 0, 0);
  return mask;
}

/**
 * Fast local contextual fill for a selection. A boundary-first queue grows
 * surrounding pixels into the hole using a weighted neighbourhood. This keeps
 * edges and local colour variation substantially better than a global blur.
 * Keeping it in a separate layer makes the action reversible and editable.
 */
export function contextualFill(source: HTMLCanvasElement, mask: HTMLCanvasElement): HTMLCanvasElement {
  const w = source.width;
  const h = source.height;
  const sourceData = ctx2d(source).getImageData(0, 0, w, h);
  const maskData = ctx2d(mask).getImageData(0, 0, w, h).data;
  const pixels = sourceData.data;
  const unknown = new Uint8Array(w * h);
  const queued = new Uint8Array(w * h);
  const queue: number[] = [];
  let minX = w, minY = h, maxX = -1, maxY = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (maskData[i * 4 + 3] > 24) {
        unknown[i] = 1;
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < minX) return createCanvas(w, h);

  const neighbours = [-1, 1, -w, w];
  const hasKnownNeighbour = (x: number, y: number) =>
    (x > 0 && !unknown[y * w + x - 1]) || (x + 1 < w && !unknown[y * w + x + 1]) ||
    (y > 0 && !unknown[(y - 1) * w + x]) || (y + 1 < h && !unknown[(y + 1) * w + x]);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = y * w + x;
      if (unknown[i] && hasKnownNeighbour(x, y)) { queue.push(i); queued[i] = 1; }
    }
  }

  for (let head = 0; head < queue.length; head++) {
    const index = queue[head];
    if (!unknown[index]) continue;
    const x = index % w;
    const y = Math.floor(index / w);
    let totalWeight = 0;
    const rgba = [0, 0, 0, 0];
    for (let oy = -2; oy <= 2; oy++) {
      for (let ox = -2; ox <= 2; ox++) {
        if ((!ox && !oy) || x + ox < 0 || x + ox >= w || y + oy < 0 || y + oy >= h) continue;
        const ni = (y + oy) * w + x + ox;
        if (unknown[ni]) continue;
        const weight = 1 / (1 + ox * ox + oy * oy);
        for (let channel = 0; channel < 4; channel++) rgba[channel] += pixels[ni * 4 + channel] * weight;
        totalWeight += weight;
      }
    }
    if (!totalWeight) continue;
    for (let channel = 0; channel < 4; channel++) pixels[index * 4 + channel] = Math.round(rgba[channel] / totalWeight);
    unknown[index] = 0;
    for (const offset of neighbours) {
      const next = index + offset;
      if (next < 0 || next >= unknown.length || queued[next] || !unknown[next]) continue;
      if ((offset === -1 && x === 0) || (offset === 1 && x === w - 1)) continue;
      queued[next] = 1;
      queue.push(next);
    }
  }

  const working = createCanvas(w, h);
  ctx2d(working).putImageData(sourceData, 0, 0);
  const patch = createCanvas(w, h);
  const pg = ctx2d(patch);
  pg.drawImage(working, 0, 0);
  pg.globalCompositeOperation = 'destination-in';
  pg.drawImage(mask, 0, 0);
  pg.globalCompositeOperation = 'source-over';
  return patch;
}
