import { loadRasterFile } from './raster';
import { loadSvg } from './svg';

// pdf.js y GhostPDL son pesados: se cargan recién al importar el primer
// PDF/EPS para que no entren al bundle inicial.
const loadPdf = async (file: Blob) => (await import('./pdf')).loadPdf(file);
const loadEps = async (file: Blob) => (await import('./eps')).loadEps(file);

export type Imported =
  | { kind: 'raster'; name: string; canvas: HTMLCanvasElement }
  | {
      kind: 'vector';
      name: string;
      baseWidth: number;
      baseHeight: number;
      svgText?: string;
      rasterize: (scale: number) => Promise<HTMLCanvasElement>;
    }
  | {
      kind: 'pdf';
      name: string;
      numPages: number;
      pageSize: (page: number) => Promise<{ w: number; h: number }>;
      renderPage: (page: number, scale: number) => Promise<HTMLCanvasElement>;
    };

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '') || name;
}

function extOf(name: string): string {
  const m = /\.([^.]+)$/.exec(name.toLowerCase());
  return m ? m[1] : '';
}

export const ACCEPT =
  'image/*,.svg,.pdf,.eps,.ps,.ai,application/pdf,application/postscript,image/svg+xml';

/** True when the file content is actually a PDF (modern .ai files embed one). */
async function sniffPdf(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  return new TextDecoder('latin1').decode(head).includes('%PDF');
}

export async function importFile(file: File): Promise<Imported> {
  const name = baseName(file.name);
  const ext = extOf(file.name);
  const type = file.type;

  if (ext === 'svg' || type === 'image/svg+xml') {
    const src = await loadSvg(file);
    return { kind: 'vector', name, ...src };
  }
  if (ext === 'pdf' || type === 'application/pdf') {
    const src = await loadPdf(file);
    return { kind: 'pdf', name, ...src };
  }
  if (ext === 'eps' || ext === 'ps' || ext === 'ai' || type === 'application/postscript') {
    // Modern Illustrator .ai files are PDF-based; legacy ones are PostScript.
    // Route by real content, not extension: Ghostscript's EPS path would
    // otherwise misparse the bounding box (no DSC header in PDF).
    if (await sniffPdf(file)) {
      const src = await loadPdf(file);
      return { kind: 'pdf', name, ...src };
    }
    const src = await loadEps(file);
    return { kind: 'vector', name, ...src };
  }
  const canvas = await loadRasterFile(file);
  return { kind: 'raster', name, canvas };
}
