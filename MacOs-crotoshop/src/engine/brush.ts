import { createCanvas, ctx2d } from './canvasUtils';

export type BrushMode = 'paint' | 'erase' | 'blur' | 'sharpen';

interface StrokeRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Limits temporary brush buffers to the pixels touched by the segment. A
 * selected stroke on an 8K layer should allocate a small tile, not another
 * full 8K canvas for every pointer event.
 */
export function strokeRegion(
  width: number,
  height: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number,
  padding = 0,
): StrokeRegion | null {
  const radius = Math.max(1, size / 2) + Math.max(0, padding);
  const x = Math.max(0, Math.floor(Math.min(from.x, to.x) - radius));
  const y = Math.max(0, Math.floor(Math.min(from.y, to.y) - radius));
  const right = Math.min(width, Math.ceil(Math.max(from.x, to.x) + radius));
  const bottom = Math.min(height, Math.ceil(Math.max(from.y, to.y) + radius));
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function dot(g: CanvasRenderingContext2D, x: number, y: number, size: number, hardness: number): void {
  const r = Math.max(1, size / 2);
  const inner = Math.max(0, Math.min(r, r * hardness));
  const gradient = g.createRadialGradient(x, y, inner, x, y, r);
  gradient.addColorStop(0, '#fff');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gradient;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function strokeMask(
  region: StrokeRegion,
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number,
  hardness: number,
  steps: number,
  clipMask?: HTMLCanvasElement | null,
): HTMLCanvasElement {
  const mask = createCanvas(region.width, region.height);
  const context = ctx2d(mask);
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    dot(
      context,
      from.x + (to.x - from.x) * t - region.x,
      from.y + (to.y - from.y) * t - region.y,
      size,
      hardness,
    );
  }
  if (clipMask) {
    context.globalCompositeOperation = 'destination-in';
    context.drawImage(
      clipMask,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      region.width,
      region.height,
    );
    context.globalCompositeOperation = 'source-over';
  }
  return mask;
}

/** Paints one continuous stamp sequence. The caller owns copy-on-write. */
export function brushStroke(
  canvas: HTMLCanvasElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number,
  hardness: number,
  color: string,
  mode: BrushMode,
  clipMask?: HTMLCanvasElement | null,
): void {
  const g = ctx2d(canvas);
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(distance / Math.max(1, size * 0.16)));
  if (mode === 'paint' || mode === 'erase') {
    if (clipMask) {
      const region = strokeRegion(canvas.width, canvas.height, from, to, size);
      if (!region) return;
      const stamps = strokeMask(region, from, to, size, hardness, steps, clipMask);
      g.save();
      if (mode === 'erase') {
        g.globalCompositeOperation = 'destination-out';
        g.drawImage(stamps, region.x, region.y);
      } else {
        const colored = ctx2d(stamps);
        colored.globalCompositeOperation = 'source-in';
        colored.fillStyle = color;
        colored.fillRect(0, 0, stamps.width, stamps.height);
        colored.globalCompositeOperation = 'source-over';
        g.drawImage(stamps, region.x, region.y);
      }
      g.restore();
      return;
    }
    g.save();
    if (mode === 'erase') g.globalCompositeOperation = 'destination-out';
    else g.fillStyle = color;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      if (mode === 'paint') {
        const r = Math.max(1, size / 2);
        const inner = Math.max(0, Math.min(r, r * hardness));
        const gradient = g.createRadialGradient(x, y, inner, x, y, r);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, color + '00');
        g.fillStyle = gradient;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      } else dot(g, x, y, size, hardness);
    }
    g.restore();
    return;
  }

  // Retouching works from a frozen copy to avoid feeding the filtered pixels
  // back into the same stroke. The blur needs a small sampling margin around
  // the stamp; both buffers still remain local to the touched segment.
  const blurRadius = mode === 'blur' ? Math.max(1, size / 14) : 0;
  const region = strokeRegion(canvas.width, canvas.height, from, to, size, Math.ceil(blurRadius * 3));
  if (!region) return;
  const source = createCanvas(region.width, region.height);
  ctx2d(source).drawImage(
    canvas,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    region.width,
    region.height,
  );
  const filtered = createCanvas(region.width, region.height);
  const filteredContext = ctx2d(filtered);
  filteredContext.filter = mode === 'blur' ? `blur(${blurRadius}px)` : 'contrast(1.35) saturate(1.12)';
  filteredContext.drawImage(source, 0, 0);
  filteredContext.filter = 'none';
  const mask = strokeMask(region, from, to, size, hardness, steps, clipMask);
  filteredContext.globalCompositeOperation = 'destination-in';
  filteredContext.drawImage(mask, 0, 0);
  filteredContext.globalCompositeOperation = 'source-over';
  g.drawImage(filtered, region.x, region.y);
}
