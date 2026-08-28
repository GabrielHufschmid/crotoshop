/**
 * Worker de encodeo para la estimación de peso en vivo del diálogo de
 * exportar: toBlob de un PNG grande tarda cientos de ms y congelaba el main
 * thread en cada ajuste de slider. Recibe un ImageBitmap (transferido) y
 * devuelve el tamaño del blob encodeado.
 */

interface EncodeRequest {
  id: number;
  bitmap: ImageBitmap;
  format: string;
  quality: number;
  matte: string;
}

self.onmessage = async (e: MessageEvent<EncodeRequest>) => {
  const { id, bitmap, format, quality, matte } = e.data;
  try {
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = c.getContext('2d');
    if (!g) throw new Error('No 2D context in worker');
    if (format === 'image/jpeg') {
      g.fillStyle = matte;
      g.fillRect(0, 0, c.width, c.height);
    }
    g.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await c.convertToBlob({
      type: format,
      quality: format === 'image/png' ? undefined : quality,
    });
    self.postMessage({ id, size: blob.size });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
