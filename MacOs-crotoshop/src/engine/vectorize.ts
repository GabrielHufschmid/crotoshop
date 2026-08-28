import type { VectorData, VectorShape, VectorizeOptions } from '../types';
import { createCanvas, ctx2d } from './canvasUtils';
import { editableVectorFromSvg, simplifyVectorShapes } from './paperVector';
import { makeEditableVector } from './vectorPath';

function parseHex(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function silhouetteImage(image: ImageData, threshold: number, color: string): ImageData {
  const output = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
  const [red, green, blue] = parseHex(color);
  let transparent = false;
  for (let index = 3; index < output.data.length; index += 4) {
    if (output.data[index] < 250) { transparent = true; break; }
  }
  for (let index = 0; index < output.data.length; index += 4) {
    const alpha = output.data[index + 3];
    const luma = output.data[index] * 0.2126 + output.data[index + 1] * 0.7152 + output.data[index + 2] * 0.0722;
    const inside = transparent ? alpha >= threshold : alpha > 0 && luma <= threshold;
    output.data[index] = inside ? red : 255;
    output.data[index + 1] = inside ? green : 255;
    output.data[index + 2] = inside ? blue : 255;
    // ImageTracer quantizes RGB more reliably than transparent pixels. Keep
    // the trace plate opaque and discard its white contour after expansion.
    output.data[index + 3] = 255;
  }
  return output;
}

function nearlyWhite(color: string | null): boolean {
  if (!color) return false;
  const values = color.match(/[\d.]+/g)?.map(Number) ?? [];
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    const expanded = color.length === 4
      ? color.slice(1).split('').map((digit) => digit + digit).join('')
      : color.slice(1);
    return parseInt(expanded.slice(0, 2), 16) > 247
      && parseInt(expanded.slice(2, 4), 16) > 247
      && parseInt(expanded.slice(4, 6), 16) > 247;
  }
  return values.length >= 3 && values[0] > 247 && values[1] > 247 && values[2] > 247;
}

function visibleShapes(shapes: readonly VectorShape[], ignoreWhite: boolean): VectorShape[] {
  return shapes.filter((shape) => {
    if (!shape.style.fill && !shape.style.stroke) return false;
    return !ignoreWhite || !nearlyWhite(shape.style.fill);
  });
}

function scaledCanvas(source: HTMLCanvasElement, maxDimension: number): { canvas: HTMLCanvasElement; scaleX: number; scaleY: number } {
  const factor = Math.min(1, maxDimension / Math.max(source.width, source.height));
  if (factor === 1) return { canvas: source, scaleX: 1, scaleY: 1 };
  const canvas = createCanvas(Math.max(1, Math.round(source.width * factor)), Math.max(1, Math.round(source.height * factor)));
  const context = ctx2d(canvas);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { canvas, scaleX: source.width / canvas.width, scaleY: source.height / canvas.height };
}

/** Image Trace with bounded working resolution and editable cubic output. */
export async function vectorizeCanvas(
  source: HTMLCanvasElement,
  options: VectorizeOptions,
  silhouetteColor = '#111111',
): Promise<VectorData> {
  const maxDimension = Math.round(1400 + options.detail * 26);
  const scaled = scaledCanvas(source, Math.min(4096, maxDimension));
  let image = ctx2d(scaled.canvas).getImageData(0, 0, scaled.canvas.width, scaled.canvas.height);
  if (options.mode === 'silhouette') image = silhouetteImage(image, options.threshold, silhouetteColor);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const inverseDetail = 1 - options.detail / 100;
  const { default: imageTracer } = await import('imagetracerjs');
  const svg = imageTracer.imagedataToSVG(image, {
    ltres: 0.08 + inverseDetail * 2.2,
    qtres: 0.08 + options.smoothing / 100 * 2.8,
    pathomit: Math.round(inverseDetail * 18),
    rightangleenhance: options.smoothing < 45,
    colorsampling: 2,
    numberofcolors: options.mode === 'silhouette' ? 2 : Math.max(2, Math.min(32, Math.round(options.colors))),
    mincolorratio: 0,
    colorquantcycles: 3,
    layering: 0,
    strokewidth: 0,
    linefilter: true,
    scale: 1,
    roundcoords: 3,
    viewbox: true,
    desc: false,
    blurradius: Math.round(options.smoothing / 30),
    blurdelta: 24,
  });
  const traced = await editableVectorFromSvg(svg, scaled.canvas.width, scaled.canvas.height);
  const visible = visibleShapes(traced.shapes ?? [], options.ignoreWhite || options.mode === 'silhouette');
  const tolerance = 0.15 + options.smoothing / 100 * 1.6 + (100 - options.detail) / 100 * 0.65;
  const simplified = await simplifyVectorShapes(visible, tolerance);
  const shapes = simplified
    .map((shape) => ({
      ...shape,
      style: {
        ...shape.style,
        fill: options.mode === 'silhouette' ? silhouetteColor : shape.style.fill,
        stroke: null,
      },
      subpaths: shape.subpaths.map((subpath) => ({
        ...subpath,
        nodes: subpath.nodes.map((node) => ({
          ...node,
          x: node.x * scaled.scaleX,
          y: node.y * scaled.scaleY,
          inX: node.inX * scaled.scaleX,
          inY: node.inY * scaled.scaleY,
          outX: node.outX * scaled.scaleX,
          outY: node.outY * scaled.scaleY,
        })),
      })),
    }));
  if (!shapes.length) throw new Error('No se encontraron contornos con estos ajustes');
  return makeEditableVector(shapes, source.width, source.height);
}
