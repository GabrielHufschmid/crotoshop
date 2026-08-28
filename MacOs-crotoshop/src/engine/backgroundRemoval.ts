import { createCanvas, ctx2d } from './canvasUtils';
import { desktop, ownedBuffer } from '../desktop/native';

export interface BgProgress {
  stage: string;   // human-friendly label
  fraction: number; // 0..1 (may be indeterminate -> -1)
}

/**
 * Sends raw RGBA pixels to the local Python sidecar and returns its transparent result.
 * No image leaves the computer.
 */
export async function removeBg(
  src: HTMLCanvasElement,
  onProgress: (p: BgProgress) => void,
): Promise<HTMLCanvasElement> {
  if (!desktop) throw new Error('El backend local de IA solo está disponible en la app de escritorio');
  onProgress({ stage: 'Procesando localmente con Python…', fraction: -1 });
  const imageData = ctx2d(src).getImageData(0, 0, src.width, src.height);
  const result = await desktop.removeBackground({
    width: src.width,
    height: src.height,
    pixels: new Uint8Array(imageData.data.buffer),
  });
  const pixels = new Uint8ClampedArray(ownedBuffer(result.pixels));
  const out = createCanvas(result.width, result.height);
  ctx2d(out).putImageData(new ImageData(pixels, result.width, result.height), 0, 0);
  return out;
}
