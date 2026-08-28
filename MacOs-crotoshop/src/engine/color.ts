import type { RGB } from '../types';

export function rgbToHex([r, g, b]: RGB): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Loose hex validation (#rgb or #rrggbb, hash optional). */
export function isValidHex(hex: string): boolean {
  return /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex.trim());
}

/** Normalizes #rgb / rrggbb / #RRGGBB to lowercase #rrggbb. */
export function normalizeHex(hex: string): string {
  let h = hex.trim().replace(/^#/, '').toLowerCase();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `#${h}`;
}

interface Hsl { h: number; s: number; l: number; }

function hexToHsl(hex: string): Hsl {
  const [rr, gg, bb] = hexToRgb(hex);
  const r = rr / 255; const g = gg / 255; const b = bb / 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  return { h: (h + 360) % 360, s: max === min ? 0 : delta / (1 - Math.abs(2 * ((max + min) / 2) - 1)), l: (max + min) / 2 };
}

function hslToHex({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex([Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]);
}

/** Applies a small HSL tuning delta. All amounts are percentages except hue (degrees). */
export function tuneHexColor(hex: string, adjustment: { saturation?: number; brightness?: number; contrast?: number; hue?: number }): string {
  const hsl = hexToHsl(hex);
  if (adjustment.hue) hsl.h = (hsl.h + adjustment.hue + 360) % 360;
  if (adjustment.saturation) hsl.s = Math.max(0, Math.min(1, hsl.s + adjustment.saturation / 100));
  if (adjustment.brightness) hsl.l = Math.max(0, Math.min(1, hsl.l + adjustment.brightness / 100));
  if (adjustment.contrast) hsl.l = Math.max(0, Math.min(1, .5 + (hsl.l - .5) * (1 + adjustment.contrast / 100)));
  return hslToHex(hsl);
}
