import type { Layer, Pt, Selection, SelectionShape } from '../types';
import { bumpCanvasVersion, createCanvas, ctx2d } from './canvasUtils';
import { renderLayerSource } from './compositor';

export type SelectionCombineMode = 'replace' | 'add' | 'subtract' | 'intersect';

/** Builds a Path2D for a parametric selection shape (doc space). */
export function shapePath(shape: SelectionShape): Path2D {
  const p = new Path2D();
  if (shape.kind === 'rect') {
    p.rect(shape.x, shape.y, shape.w, shape.h);
  } else if (shape.kind === 'ellipse') {
    p.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, Math.PI * 2);
  } else {
    const pts = shape.points;
    if (pts.length) {
      p.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
      p.closePath();
    }
  }
  return p;
}

export function shapeBounds(shape: SelectionShape): { x: number; y: number; w: number; h: number } {
  if (shape.kind === 'rect') return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  if (shape.kind === 'ellipse') {
    return { x: shape.cx - shape.rx, y: shape.cy - shape.ry, w: shape.rx * 2, h: shape.ry * 2 };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of shape.points) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Builds a doc-sized alpha mask from a parametric shape. */
export function selectionFromShape(
  shape: SelectionShape,
  docW: number,
  docH: number,
): Selection {
  const mask = createCanvas(docW, docH);
  const g = ctx2d(mask);
  g.fillStyle = '#fff';
  g.fill(shapePath(shape));
  const b = shapeBounds(shape);
  const bounds = clampBounds(b, docW, docH);
  return { mask, bounds, shape };
}

function clampBounds(
  b: { x: number; y: number; w: number; h: number },
  docW: number,
  docH: number,
): { x: number; y: number; w: number; h: number } {
  const x = Math.max(0, Math.min(docW, b.x));
  const y = Math.max(0, Math.min(docH, b.y));
  const x2 = Math.max(0, Math.min(docW, b.x + b.w));
  const y2 = Math.max(0, Math.min(docH, b.y + b.h));
  return { x, y, w: x2 - x, h: y2 - y };
}

function boundsFromMask(mask: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | null {
  const w = mask.width;
  const h = mask.height;
  const data = ctx2d(mask).getImageData(0, 0, w, h).data;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function selectionFromMask(mask: HTMLCanvasElement): Selection | null {
  const bounds = boundsFromMask(mask);
  if (!bounds) return null;
  return { mask, bounds, shape: null };
}

/** Full-document selection. */
export function selectAll(docW: number, docH: number): Selection {
  return selectionFromShape({ kind: 'rect', x: 0, y: 0, w: docW, h: docH }, docW, docH);
}

/** Combines an existing selection with a new one using Photoshop-like modifiers. */
export function combineSelections(
  base: Selection | null,
  next: Selection | null,
  mode: SelectionCombineMode,
): Selection | null {
  if (!next) return base;
  if (!base || mode === 'replace') return next;
  const mask = createCanvas(base.mask.width, base.mask.height);
  const g = ctx2d(mask);
  g.drawImage(base.mask, 0, 0);
  if (mode === 'add') {
    g.globalCompositeOperation = 'source-over';
    g.drawImage(next.mask, 0, 0);
  } else if (mode === 'subtract') {
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(next.mask, 0, 0);
  } else {
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(next.mask, 0, 0);
  }
  return selectionFromMask(mask);
}

function morphBinaryMask(mask: HTMLCanvasElement, radius: number, grow: boolean): HTMLCanvasElement {
  const w = mask.width;
  const h = mask.height;
  const src = ctx2d(mask).getImageData(0, 0, w, h).data;
  const bin = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) bin[i] = src[i * 4 + 3] > 0 ? 1 : 0;

  const horiz = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ok = grow ? 0 : 1;
      for (let dx = -radius; dx <= radius; dx++) {
        const xx = x + dx;
        const v = xx >= 0 && xx < w ? bin[y * w + xx] : 0;
        if (grow && v) { ok = 1; break; }
        if (!grow && !v) { ok = 0; break; }
      }
      horiz[y * w + x] = ok;
    }
  }

  const outData = ctx2d(createCanvas(w, h)).createImageData(w, h);
  const dst = outData.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ok = grow ? 0 : 1;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        const v = yy >= 0 && yy < h ? horiz[yy * w + x] : 0;
        if (grow && v) { ok = 1; break; }
        if (!grow && !v) { ok = 0; break; }
      }
      if (ok) {
        const i = (y * w + x) * 4;
        dst[i] = 255;
        dst[i + 1] = 255;
        dst[i + 2] = 255;
        dst[i + 3] = 255;
      }
    }
  }
  const out = createCanvas(w, h);
  ctx2d(out).putImageData(outData, 0, 0);
  return out;
}

/** Expands (positive px) or contracts (negative px) a selection mask. */
export function adjustSelection(sel: Selection, px: number): Selection | null {
  const radius = Math.abs(Math.round(px));
  if (radius === 0) return sel;
  return selectionFromMask(morphBinaryMask(sel.mask, radius, px > 0));
}

/**
 * Smooths jagged (aliased) selection edges: blurs the mask, then re-thresholds
 * with a soft ramp around 50% so the edge stays where it was but gets an
 * anti-aliased alpha gradient instead of a hard staircase. Downstream
 * consumers (extract/clear/floating) already honor partial alpha.
 */
export function smoothSelection(sel: Selection, radius: number): Selection | null {
  const r = Math.max(0.5, radius);
  const w = sel.mask.width;
  const h = sel.mask.height;
  const blurred = createCanvas(w, h);
  const g = ctx2d(blurred);
  g.filter = `blur(${r}px)`;
  g.drawImage(sel.mask, 0, 0);
  g.filter = 'none';

  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  // Soft threshold: ramp 96..160 (centered on 128) → anti-aliased edge that
  // still lands on the original contour.
  const LO = 96;
  const HI = 160;
  for (let i = 3; i < d.length; i += 4) {
    const a = d[i];
    const t = a <= LO ? 0 : a >= HI ? 255 : Math.round(((a - LO) / (HI - LO)) * 255);
    d[i] = t;
    if (t > 0) { d[i - 3] = 255; d[i - 2] = 255; d[i - 1] = 255; }
  }
  g.putImageData(img, 0, 0);
  return selectionFromMask(blurred);
}

/** Softens the selection alpha without thresholding it back to a hard edge. */
export function featherSelection(sel: Selection, radius: number): Selection | null {
  const r = Math.max(0.5, radius);
  const out = createCanvas(sel.mask.width, sel.mask.height);
  const g = ctx2d(out);
  g.filter = `blur(${r}px)`;
  g.drawImage(sel.mask, 0, 0);
  g.filter = 'none';
  return selectionFromMask(out);
}

export function selectionContains(sel: Selection, pt: Pt): boolean {
  if (
    pt.x < sel.bounds.x || pt.y < sel.bounds.y ||
    pt.x >= sel.bounds.x + sel.bounds.w || pt.y >= sel.bounds.y + sel.bounds.h
  ) return false;
  const x = Math.floor(pt.x);
  const y = Math.floor(pt.y);
  const pixel = ctx2d(sel.mask).getImageData(x, y, 1, 1).data;
  return pixel[3] > 0;
}

export function cropMask(sel: Selection): HTMLCanvasElement {
  const c = createCanvas(sel.bounds.w, sel.bounds.h);
  ctx2d(c).drawImage(sel.mask, -sel.bounds.x, -sel.bounds.y);
  return c;
}

function drawTransformed(
  g: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  target: { x: number; y: number; w: number; h: number },
  angle: number,
): void {
  g.save();
  g.translate(target.x + target.w / 2, target.y + target.h / 2);
  g.rotate(angle);
  g.drawImage(src, -target.w / 2, -target.h / 2, target.w, target.h);
  g.restore();
}

export function selectionFromTransformedMask(
  maskSrc: HTMLCanvasElement,
  target: { x: number; y: number; w: number; h: number },
  angle: number,
  docW: number,
  docH: number,
): Selection | null {
  const mask = createCanvas(docW, docH);
  drawTransformed(ctx2d(mask), maskSrc, target, angle);
  return selectionFromMask(mask);
}

export function createTransformedSelectionLayer(
  source: HTMLCanvasElement,
  maskSrc: HTMLCanvasElement,
  target: { x: number; y: number; w: number; h: number },
  angle: number,
  docW: number,
  docH: number,
): { canvas: HTMLCanvasElement; x: number; y: number; selection: Selection } | null {
  const selection = selectionFromTransformedMask(maskSrc, target, angle, docW, docH);
  if (!selection) return null;
  const full = createCanvas(docW, docH);
  drawTransformed(ctx2d(full), source, target, angle);
  const out = createCanvas(selection.bounds.w, selection.bounds.h);
  ctx2d(out).drawImage(full, -selection.bounds.x, -selection.bounds.y);
  return {
    canvas: out,
    x: selection.bounds.x,
    y: selection.bounds.y,
    selection,
  };
}

/**
 * Commits a floating selection transform to a layer. The layer is expanded to
 * document size so moved/rotated pixels are not clipped by the old layer bounds.
 */
export function applySelectionTransformToLayer(
  layer: Layer,
  docW: number,
  docH: number,
  source: HTMLCanvasElement,
  target: { x: number; y: number; w: number; h: number },
  angle: number,
): void {
  const base = createCanvas(docW, docH);
  const g = ctx2d(base);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(layer.canvas, layer.x, layer.y);
  drawTransformed(g, source, target, angle);
  layer.canvas = base;
  layer.x = 0;
  layer.y = 0;
  layer.w = undefined;
  layer.h = undefined;
}

/**
 * Magic wand: flood-fills from a doc-space point over the layer's pixels
 * with the given color tolerance (0..255). Returns null if the point misses
 * the layer. `contiguous: false` selects every matching pixel in the layer.
 */
/**
 * Marks the pixels similar to the one at (lx,ly) within `tolerance`
 * (contiguous scanline flood or global match). Shared by the magic wand
 * and the bucket fill tool.
 */
export function floodMatch(
  d: Uint8ClampedArray,
  w: number,
  h: number,
  lx: number,
  ly: number,
  tolerance: number,
  contiguous: boolean,
  includeAlpha = true,
): { selected: Uint8Array; minX: number; minY: number; maxX: number; maxY: number } {
  const idx0 = (ly * w + lx) * 4;
  const r0 = d[idx0], g0 = d[idx0 + 1], b0 = d[idx0 + 2], a0 = d[idx0 + 3];
  const tol2 = tolerance * tolerance * 4; // squared distance over 4 channels

  const matches = (i: number): boolean => {
    const dr = d[i] - r0, dg = d[i + 1] - g0, db = d[i + 2] - b0;
    const da = includeAlpha ? d[i + 3] - a0 : 0;
    return dr * dr + dg * dg + db * db + da * da <= tol2;
  };

  const selected = new Uint8Array(w * h);
  let minX = lx, minY = ly, maxX = lx, maxY = ly;

  if (contiguous) {
    // Scanline flood fill.
    const stack: number[] = [ly * w + lx];
    selected[ly * w + lx] = 1;
    while (stack.length) {
      const pos = stack.pop()!;
      const py = Math.floor(pos / w);
      const px = pos - py * w;
      // expand run left/right
      let x1 = px;
      while (x1 > 0 && !selected[pos - (px - x1) - 1] && matches((pos - (px - x1) - 1) * 4)) x1--;
      let x2 = px;
      while (x2 < w - 1 && !selected[py * w + x2 + 1] && matches((py * w + x2 + 1) * 4)) x2++;
      for (let x = x1; x <= x2; x++) {
        const i = py * w + x;
        selected[i] = 1;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
        for (const ny of [py - 1, py + 1]) {
          if (ny < 0 || ny >= h) continue;
          const ni = ny * w + x;
          if (!selected[ni] && matches(ni * 4)) {
            selected[ni] = 1;
            stack.push(ni);
          }
        }
      }
    }
  } else {
    for (let i = 0; i < w * h; i++) {
      if (matches(i * 4)) {
        selected[i] = 1;
        const py = Math.floor(i / w), px = i - py * w;
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
      }
    }
  }
  return { selected, minX, minY, maxX, maxY };
}

/** Matches pixels in an already-composited document-sized canvas. */
export function magicWandCanvas(
  source: HTMLCanvasElement,
  docPt: Pt,
  tolerance: number,
  contiguous: boolean,
  includeAlpha = true,
): Selection | null {
  const w = source.width;
  const h = source.height;
  const x = Math.floor(docPt.x);
  const y = Math.floor(docPt.y);
  if (x < 0 || y < 0 || x >= w || y >= h) return null;
  const src = ctx2d(source).getImageData(0, 0, w, h);
  const { selected, minX, minY, maxX, maxY } = floodMatch(src.data, w, h, x, y, tolerance, contiguous, includeAlpha);
  const mask = createCanvas(w, h);
  const data = ctx2d(mask).createImageData(w, h);
  for (let i = 0; i < selected.length; i++) {
    if (selected[i]) data.data[i * 4 + 3] = 255;
  }
  ctx2d(mask).putImageData(data, 0, 0);
  const bounds = clampBounds({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }, w, h);
  return bounds.w > 0 && bounds.h > 0 ? { mask, bounds, shape: null } : null;
}

export function magicWand(
  layer: Layer,
  docPt: Pt,
  docW: number,
  docH: number,
  tolerance: number,
  contiguous: boolean,
  includeAlpha = true,
): Selection | null {
  const lx = Math.floor(docPt.x - layer.x);
  const ly = Math.floor(docPt.y - layer.y);
  const w = layer.canvas.width;
  const h = layer.canvas.height;
  if (lx < 0 || ly < 0 || lx >= w || ly >= h) return null;

  // Samplear la apariencia con ajustes aplicados (brillo/hue/recolor…), no
  // los píxeles crudos de la capa — si no, la tolerancia de color no
  // coincide con lo que el usuario efectivamente ve en pantalla.
  const src = ctx2d(renderLayerSource(layer)).getImageData(0, 0, w, h);
  const { selected, minX, minY, maxX, maxY } = floodMatch(
    src.data, w, h, lx, ly, tolerance, contiguous, includeAlpha,
  );

  // Paint the selected pixels into a doc-sized mask, offset by the layer position.
  const mask = createCanvas(docW, docH);
  const mg = ctx2d(mask);
  const maskData = mg.createImageData(w, h);
  const md = maskData.data;
  for (let i = 0; i < w * h; i++) {
    if (selected[i]) {
      md[i * 4] = 255; md[i * 4 + 1] = 255; md[i * 4 + 2] = 255; md[i * 4 + 3] = 255;
    }
  }
  // putImageData ignores clipping/transform; draw via temp canvas to offset.
  const tmp = createCanvas(w, h);
  ctx2d(tmp).putImageData(maskData, 0, 0);
  mg.drawImage(tmp, layer.x, layer.y);

  const bounds = clampBounds(
    { x: layer.x + minX, y: layer.y + minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    docW, docH,
  );
  if (bounds.w <= 0 || bounds.h <= 0) return null;
  return { mask, bounds, shape: null };
}

/**
 * Extracts the pixels of `layer` inside the selection, as a tight canvas.
 * Returns null when the intersection is empty.
 */
export function extractSelection(
  layer: Layer,
  sel: Selection,
): { canvas: HTMLCanvasElement; x: number; y: number } | null {
  const b = sel.bounds;
  if (b.w < 1 || b.h < 1) return null;
  const out = createCanvas(b.w, b.h);
  const g = ctx2d(out);
  g.drawImage(layer.canvas, layer.x - b.x, layer.y - b.y);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(sel.mask, -b.x, -b.y);
  return { canvas: out, x: b.x, y: b.y };
}

/** Clears (makes transparent) the selected pixels of `layer` in place. */
export function clearSelectionPixels(layer: Layer, sel: Selection): void {
  const rawW = layer.canvas.width;
  const rawH = layer.canvas.height;
  const displayW = layer.w ?? rawW;
  const displayH = layer.h ?? rawH;
  const angle = layer.rotation ?? 0;
  const scaleX = displayW / rawW;
  const scaleY = displayH / rawH;
  const centerX = layer.x + displayW / 2;
  const centerY = layer.y + displayH / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const flipX = layer.flipX ? -1 : 1;
  const flipY = layer.flipY ? -1 : 1;

  // Project the document-space selection back into the layer's source pixels.
  const mask = createCanvas(rawW, rawH);
  const mg = ctx2d(mask);
  const a = flipX * cos / scaleX;
  const b = -flipY * sin / scaleY;
  const c = flipX * sin / scaleX;
  const d = flipY * cos / scaleY;
  const e = rawW / 2 - a * centerX - c * centerY;
  const f = rawH / 2 - b * centerX - d * centerY;
  mg.setTransform(a, b, c, d, e, f);
  mg.drawImage(sel.mask, 0, 0);

  const g = ctx2d(layer.canvas);
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.drawImage(mask, 0, 0);
  g.restore();
  bumpCanvasVersion(layer.canvas);
}

/** Scales/translates a selection to a new bounds rectangle. */
export function transformSelection(
  sel: Selection,
  nb: { x: number; y: number; w: number; h: number },
  docW: number,
  docH: number,
): Selection {
  const ob = sel.bounds;
  if (ob.w < 1 || ob.h < 1 || nb.w < 1 || nb.h < 1) return sel;
  const sx = nb.w / ob.w;
  const sy = nb.h / ob.h;

  if (sel.shape) {
    let shape: SelectionShape;
    const s = sel.shape;
    if (s.kind === 'rect') {
      shape = { kind: 'rect', x: nb.x, y: nb.y, w: nb.w, h: nb.h };
    } else if (s.kind === 'ellipse') {
      shape = { kind: 'ellipse', cx: nb.x + nb.w / 2, cy: nb.y + nb.h / 2, rx: nb.w / 2, ry: nb.h / 2 };
    } else {
      shape = {
        kind: 'poly',
        points: s.points.map((p) => ({ x: nb.x + (p.x - ob.x) * sx, y: nb.y + (p.y - ob.y) * sy })),
      };
    }
    return selectionFromShape(shape, docW, docH);
  }

  // Mask-only selection: rescale the mask region.
  const mask = createCanvas(docW, docH);
  const g = ctx2d(mask);
  g.imageSmoothingEnabled = false;
  g.drawImage(sel.mask, ob.x, ob.y, ob.w, ob.h, nb.x, nb.y, nb.w, nb.h);
  return { mask, bounds: clampBounds(nb, docW, docH), shape: null };
}

/**
 * Flattens a cubic-bezier chain (nodes with symmetric handles) into a polygon.
 * Each node: point + outgoing handle offset (hx, hy); incoming is mirrored.
 */
export interface BezierNode { x: number; y: number; hx: number; hy: number; }

export function flattenBezier(nodes: BezierNode[], samplesPerSeg = 24): Pt[] {
  if (nodes.length < 2) return nodes.map((n) => ({ x: n.x, y: n.y }));
  const pts: Pt[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];
    const c1x = a.x + a.hx, c1y = a.y + a.hy;
    const c2x = b.x - b.hx, c2y = b.y - b.hy;
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg;
      const mt = 1 - t;
      pts.push({
        x: mt * mt * mt * a.x + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * b.x,
        y: mt * mt * mt * a.y + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * b.y,
      });
    }
  }
  return pts;
}
