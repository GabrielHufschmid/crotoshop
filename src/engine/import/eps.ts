import { loadRasterFile } from './raster';

/**
 * EPS / PostScript import via GhostPDL (Ghostscript) compiled to WebAssembly.
 *
 * The WASM build is heavy (~10 MB), so it is loaded on demand — only when the
 * user actually imports an EPS — and cached by the browser afterwards. Each
 * conversion uses a fresh Emscripten instance because callMain is single-shot.
 */
interface EpsSource {
  baseWidth: number;
  baseHeight: number;
  rasterize: (scale: number) => Promise<HTMLCanvasElement>;
}

/** Parse "%%BoundingBox: x0 y0 x1 y1" from the EPS header (PostScript points). */
function parseBoundingBox(text: string): { w: number; h: number } | null {
  const m = /^%%BoundingBox:\s*(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/m.exec(text);
  if (!m) return null;
  const w = parseInt(m[3], 10) - parseInt(m[1], 10);
  const h = parseInt(m[4], 10) - parseInt(m[2], 10);
  return w > 0 && h > 0 ? { w, h } : null;
}

async function gsEpsToPng(input: Uint8Array, dpi: number): Promise<Uint8Array> {
  let loadWASM: (opts: object) => Promise<{
    FS: {
      writeFile: (path: string, data: Uint8Array) => void;
      readFile: (path: string, opts: { encoding: 'binary' }) => Uint8Array;
    };
    callMain: (args: string[]) => number;
  }>;
  let wasmUrl: string;
  try {
    const [mod, wasm] = await Promise.all([
      import('@okathira/ghostpdl-wasm'),
      import('@okathira/ghostpdl-wasm/gs.wasm?url'),
    ]);
    loadWASM = mod.default;
    wasmUrl = wasm.default;
  } catch {
    throw new Error('No se pudo cargar el conversor de EPS (Ghostscript WASM).');
  }

  const logs: string[] = [];
  const Module = await loadWASM({
    locateFile: () => wasmUrl,
    print: (s: string) => logs.push(s),
    printErr: (s: string) => logs.push(s),
  });

  Module.FS.writeFile('in.eps', input);
  let code: number;
  try {
    code = Module.callMain([
      '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET',
      '-dEPSCrop', '-sDEVICE=pngalpha', `-r${dpi}`,
      '-sOutputFile=out.png', 'in.eps',
    ]);
  } catch (err) {
    console.error('Ghostscript error:', err, logs);
    throw new Error('Ghostscript no pudo procesar este EPS.');
  }
  if (code !== 0) {
    console.error('Ghostscript exit code', code, logs);
    throw new Error(`El EPS no se pudo convertir (código ${code}).`);
  }
  return Module.FS.readFile('out.png', { encoding: 'binary' });
}

export async function loadEps(file: Blob): Promise<EpsSource> {
  const buf = await file.arrayBuffer();
  const input = new Uint8Array(buf);
  // Read the DSC header as latin1 text to find the bounding box.
  const header = new TextDecoder('latin1').decode(input.slice(0, 4096));
  const bbox = parseBoundingBox(header) ?? { w: 612, h: 792 }; // fallback: US Letter

  return {
    baseWidth: bbox.w,
    baseHeight: bbox.h,
    async rasterize(scale: number) {
      const dpi = Math.max(9, Math.round(72 * scale));
      const png = await gsEpsToPng(input, dpi);
      const copy = new Uint8Array(png); // detach from the Emscripten heap
      return loadRasterFile(new Blob([copy], { type: 'image/png' }));
    },
  };
}
