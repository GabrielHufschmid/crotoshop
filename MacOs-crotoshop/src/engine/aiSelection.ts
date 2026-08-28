import type { Doc, Layer, Pt, Selection } from '../types';
import { canvasVersion, createCanvas, ctx2d } from './canvasUtils';
import { desktop, ownedBuffer } from '../desktop/native';
import { selectionComponentAt, selectionFromTransformedMask } from './selection';
import { documentToLayerPoint } from './layerGeometry';

interface CachedMask {
  version: number;
  result: Promise<HTMLCanvasElement>;
}

const maskCache = new WeakMap<HTMLCanvasElement, CachedMask>();

async function layerAiMask(source: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  if (!desktop) throw new Error('La máscara IA solo está disponible en la app de escritorio');
  const version = canvasVersion(source);
  const cached = maskCache.get(source);
  if (cached?.version === version) return cached.result;

  const result = (async () => {
    const image = ctx2d(source).getImageData(0, 0, source.width, source.height);
    const response = await desktop.createAiMask({
      width: source.width,
      height: source.height,
      pixels: new Uint8Array(image.data.buffer),
    });
    const alpha = new Uint8Array(ownedBuffer(response.alpha));
    if (alpha.length !== response.width * response.height) throw new Error('La IA devolvió una máscara inválida');
    const mask = createCanvas(response.width, response.height);
    const pixels = ctx2d(mask).createImageData(response.width, response.height);
    for (let i = 0; i < alpha.length; i++) {
      const offset = i * 4;
      pixels.data[offset] = 255;
      pixels.data[offset + 1] = 255;
      pixels.data[offset + 2] = 255;
      pixels.data[offset + 3] = alpha[i];
    }
    ctx2d(mask).putImageData(pixels, 0, 0);
    return mask;
  })();
  maskCache.set(source, { version, result });
  try {
    return await result;
  } catch (error) {
    if (maskCache.get(source)?.result === result) maskCache.delete(source);
    throw error;
  }
}

function pointInLayer(layer: Layer, point: Pt): Pt | null {
  const local = documentToLayerPoint(layer, point);
  if (
    local.x < 0 || local.y < 0 ||
    local.x >= layer.canvas.width || local.y >= layer.canvas.height
  ) return null;
  return local;
}

export async function selectObjectWithAi(
  layer: Layer,
  doc: Doc,
  point: Pt,
  confidence: number,
): Promise<Selection | null> {
  const localPoint = pointInLayer(layer, point);
  if (!localPoint) return null;
  const mask = await layerAiMask(layer.canvas);
  const local = selectionComponentAt(mask, localPoint, confidence * 2.55);
  if (!local) return null;
  return selectionFromTransformedMask(
    local.mask,
    { x: layer.x, y: layer.y, w: layer.w ?? layer.canvas.width, h: layer.h ?? layer.canvas.height },
    layer.rotation ?? 0,
    doc.width,
    doc.height,
    layer.flipX,
    layer.flipY,
  );
}
