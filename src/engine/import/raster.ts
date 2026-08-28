import { createCanvas, ctx2d } from '../canvasUtils';

/** Loads a raster image file (png/jpg/webp/gif/bmp…) into a canvas. */
export async function loadRasterFile(file: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  const c = createCanvas(bmp.width, bmp.height);
  ctx2d(c).drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}

/** Loads a raster image from a data/blob URL into a canvas. */
export function loadRasterUrl(url: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = createCanvas(img.naturalWidth, img.naturalHeight);
      ctx2d(c).drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = url;
  });
}
