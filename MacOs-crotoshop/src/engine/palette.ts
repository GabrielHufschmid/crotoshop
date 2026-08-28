export type PaletteHarmony = 'analogous' | 'complementary' | 'triad' | 'split' | 'monochrome';

export interface GeneratedPalette {
  harmony: PaletteHarmony;
  label: string;
  colors: string[];
}

interface Hsl { h: number; s: number; l: number; }

function clamp(v: number, min = 0, max = 1): number { return Math.max(min, Math.min(max, v)); }
function wrapHue(h: number): number { return ((h % 360) + 360) % 360; }

function hexToHsl(hex: string): Hsl {
  const raw = hex.replace('#', '');
  const n = Number.parseInt(raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  return { h: wrapHue(h), s: max === min ? 0 : delta / (1 - Math.abs(2 * ((max + min) / 2) - 1)), l: (max + min) / 2 };
}

function hslToHex({ h, s, l }: Hsl): string {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - chroma / 2;
  const [r, g, b] = h < 60 ? [chroma, x, 0] : h < 120 ? [x, chroma, 0] : h < 180 ? [0, chroma, x] : h < 240 ? [0, x, chroma] : h < 300 ? [x, 0, chroma] : [chroma, 0, x];
  const channel = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function color(base: Hsl, hueShift: number, sat = base.s, light = base.l): string {
  return hslToHex({ h: wrapHue(base.h + hueShift), s: clamp(sat), l: clamp(light) });
}

export const HARMONIES: { id: PaletteHarmony; label: string; description: string }[] = [
  { id: 'analogous', label: 'Análoga', description: 'Cercana y cohesionada' },
  { id: 'complementary', label: 'Complementaria', description: 'Contraste equilibrado' },
  { id: 'triad', label: 'Triádica', description: 'Tres puntos de tensión' },
  { id: 'split', label: 'Complementaria dividida', description: 'Contraste más suave' },
  { id: 'monochrome', label: 'Monocromática', description: 'Una familia tonal' },
];

export function generatePalette(primary: string, harmony: PaletteHarmony): GeneratedPalette {
  const base = hexToHsl(primary);
  const l = base.l;
  const s = Math.max(base.s, 0.42);
  let colors: string[];
  switch (harmony) {
    case 'complementary':
      colors = [color(base, 0, s, clamp(l - .22)), color(base, 0, s, clamp(l + .11)), color(base, 180, s, clamp(l + .12)), color(base, 180, s, clamp(l - .14)), color(base, 150, clamp(s - .12), clamp(l + .22))];
      break;
    case 'triad':
      colors = [color(base, 0, s, clamp(l - .2)), color(base, 0, s, clamp(l + .12)), color(base, 120, s, clamp(l + .04)), color(base, 240, s, clamp(l + .08)), color(base, 240, clamp(s - .15), clamp(l - .15))];
      break;
    case 'split':
      colors = [color(base, 0, s, clamp(l - .2)), color(base, 0, s, clamp(l + .12)), color(base, 150, s, clamp(l + .06)), color(base, 210, s, clamp(l + .08)), color(base, 180, clamp(s - .15), clamp(l - .13))];
      break;
    case 'monochrome':
      colors = [color(base, 0, s, .2), color(base, 0, s, .36), color(base, 0, s, clamp(l)), color(base, 0, clamp(s - .08), .67), color(base, 0, clamp(s - .18), .86)];
      break;
    default:
      colors = [color(base, -42, s, clamp(l - .12)), color(base, -20, s, clamp(l + .08)), color(base, 0, s, l), color(base, 22, s, clamp(l + .04)), color(base, 44, clamp(s - .06), clamp(l - .05))];
  }
  const meta = HARMONIES.find((entry) => entry.id === harmony)!;
  return { harmony, label: meta.label, colors };
}
