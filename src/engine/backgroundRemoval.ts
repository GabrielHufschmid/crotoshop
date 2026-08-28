import { removeBackground } from '@imgly/background-removal';
import { createCanvas, ctx2d } from './canvasUtils';
import { canvasToBlob } from './export';

export interface BgProgress {
  stage: string;   // human-friendly label
  fraction: number; // 0..1 (may be indeterminate -> -1)
}

/**
 * Runs in-browser AI background removal on a canvas and returns a new canvas
 * with the background made transparent. Model assets download on first use and
 * are cached by the browser afterwards.
 */
export async function removeBg(
  src: HTMLCanvasElement,
  onProgress: (p: BgProgress) => void,
): Promise<HTMLCanvasElement> {
  const inputBlob = await canvasToBlob(src, 'image/png');

  const outBlob = await removeBackground(inputBlob, {
    // Assets servidos desde nuestro origen (ver scripts/fetch-imgly-data.mjs):
    // la librería no verifica integridad de lo que baja, así que no fetcheamos
    // nada de su CDN en runtime. El modelo queda pineado a "medium" porque es
    // el único espejado.
    publicPath: new URL('imgly-data/', document.baseURI).href,
    model: 'isnet_fp16', // = "medium", el único modelo espejado

    output: { format: 'image/png' },
    progress: (key: string, current: number, total: number) => {
      const isFetch = key.startsWith('fetch');
      onProgress({
        stage: isFetch ? 'Descargando modelo de IA…' : 'Procesando imagen…',
        fraction: total > 0 ? current / total : -1,
      });
    },
  });

  const bmp = await createImageBitmap(outBlob);
  const out = createCanvas(bmp.width, bmp.height);
  ctx2d(out).drawImage(bmp, 0, 0);
  bmp.close();
  return out;
}
