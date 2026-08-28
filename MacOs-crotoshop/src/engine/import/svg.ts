import { createCanvas, ctx2d } from '../canvasUtils';

interface SvgSource {
  baseWidth: number;
  baseHeight: number;
  svgText: string;
  rasterize: (scale: number) => Promise<HTMLCanvasElement>;
}

function readIntrinsicSize(svgText: string): { w: number; h: number } {
  try {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const svg = doc.documentElement;
    const wAttr = parseFloat(svg.getAttribute('width') || '');
    const hAttr = parseFloat(svg.getAttribute('height') || '');
    if (Number.isFinite(wAttr) && Number.isFinite(hAttr) && wAttr > 0 && hAttr > 0) {
      return { w: wAttr, h: hAttr };
    }
    const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { w: vb[2], h: vb[3] };
  } catch {
    /* fall through */
  }
  return { w: 1024, h: 1024 };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('SVG inválido o no soportado'));
    img.src = url;
  });
}

export async function loadSvg(file: Blob): Promise<SvgSource> {
  const text = await file.text();
  return svgSourceFromText(text);
}

export function svgSourceFromText(text: string): SvgSource {
  const { w, h } = readIntrinsicSize(text);
  const url = URL.createObjectURL(
    new Blob([text], { type: 'image/svg+xml;charset=utf-8' }),
  );

  return {
    baseWidth: Math.round(w),
    baseHeight: Math.round(h),
    svgText: text,
    async rasterize(scale: number) {
      const img = await loadImage(url);
      const outW = Math.max(1, Math.round(w * scale));
      const outH = Math.max(1, Math.round(h * scale));
      const c = createCanvas(outW, outH);
      const g = ctx2d(c);
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, outW, outH);
      return c;
    },
  };
}

export function recolorSvgText(svgText: string, fill?: string, stroke?: string): string {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement;
  const nodes = svg.querySelectorAll('*');
  nodes.forEach((el) => {
    if (fill) el.setAttribute('fill', fill);
    if (stroke) el.setAttribute('stroke', stroke);
    const style = el.getAttribute('style');
    if (style) {
      let next = style;
      if (fill) next = next.replace(/fill\s*:\s*[^;]+/g, `fill:${fill}`);
      if (stroke) next = next.replace(/stroke\s*:\s*[^;]+/g, `stroke:${stroke}`);
      el.setAttribute('style', next);
    }
  });
  return new XMLSerializer().serializeToString(svg);
}
