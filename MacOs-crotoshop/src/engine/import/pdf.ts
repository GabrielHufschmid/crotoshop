import * as pdfjs from 'pdfjs-dist';
// Vite resolves this to a hashed URL for the pdf.js worker.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createCanvas, ctx2d } from '../canvasUtils';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfSource {
  numPages: number;
  /** Base (scale-1) dimensions of a given page, for sizing hints. */
  pageSize: (page: number) => Promise<{ w: number; h: number }>;
  renderPage: (page: number, scale: number) => Promise<HTMLCanvasElement>;
}

export async function loadPdf(file: Blob): Promise<PdfSource> {
  const data = await file.arrayBuffer();
  // Nota de seguridad: un PDF es input hostil por definición acá. pdf.js ≥ 5
  // eliminó por completo el path de eval de fuentes Type1 (CVE-2024-4367 y la
  // vieja opción isEvalSupported); si alguna vez se baja de major, volver a
  // pasar { isEvalSupported: false }.
  const pdf = await pdfjs.getDocument({ data }).promise;

  return {
    numPages: pdf.numPages,
    async pageSize(page: number) {
      const p = await pdf.getPage(page);
      const vp = p.getViewport({ scale: 1 });
      return { w: Math.round(vp.width), h: Math.round(vp.height) };
    },
    async renderPage(page: number, scale: number) {
      const p = await pdf.getPage(page);
      const viewport = p.getViewport({ scale });
      const canvas = createCanvas(viewport.width, viewport.height);
      const canvasContext = ctx2d(canvas);
      await p.render({ canvas, canvasContext, viewport }).promise;
      return canvas;
    },
  };
}
