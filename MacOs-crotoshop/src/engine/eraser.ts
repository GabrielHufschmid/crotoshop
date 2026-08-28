import { bumpCanvasVersion, ctx2d } from './canvasUtils';

export interface Pt { x: number; y: number; }

function stamp(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  hardness: number,
): void {
  const inner = Math.max(0, Math.min(0.99, hardness)) * radius;
  const grad = g.createRadialGradient(x, y, inner, x, y, radius);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, radius, 0, Math.PI * 2);
  g.fill();
}

/**
 * Erases (destination-out) a soft-brush stroke from `from` to `to`, in the
 * canvas's own pixel coordinates.
 */
export function eraseStroke(
  target: HTMLCanvasElement,
  from: Pt,
  to: Pt,
  size: number,
  hardness: number,
): void {
  const g = ctx2d(target);
  const radius = size / 2;
  g.save();
  g.globalCompositeOperation = 'destination-out';
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / (radius * 0.4)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    stamp(g, from.x + dx * t, from.y + dy * t, radius, hardness);
  }
  g.restore();
  bumpCanvasVersion(target);
}
