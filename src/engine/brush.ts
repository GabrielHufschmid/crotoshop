import { createCanvas, ctx2d } from './canvasUtils';

export type BrushMode = 'paint' | 'erase' | 'blur' | 'sharpen';

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

/** Paints one continuous stamp sequence. The caller owns copy-on-write. */
export function brushStroke(
  canvas: HTMLCanvasElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number,
  hardness: number,
  color: string,
  mode: BrushMode,
): void {
  const g = ctx2d(canvas);
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(distance / Math.max(1, size * 0.16)));
  if (mode === 'paint' || mode === 'erase') {
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
  // back into the same stroke.
  const source = createCanvas(canvas.width, canvas.height);
  ctx2d(source).drawImage(canvas, 0, 0);
  g.save();
  g.filter = mode === 'blur' ? `blur(${Math.max(1, size / 14)}px)` : 'contrast(1.35) saturate(1.12)';
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    g.save();
    g.beginPath(); g.arc(x, y, Math.max(1, size / 2), 0, Math.PI * 2); g.clip();
    g.drawImage(source, 0, 0);
    g.restore();
  }
  g.restore();
}
