import type { TextData } from '../types';
import { createCanvas, ctx2d } from './canvasUtils';

export const SYSTEM_FONTS = [
  'Arial', 'Helvetica Neue', 'Verdana', 'Tahoma', 'Trebuchet MS',
  'Times New Roman', 'Georgia', 'Palatino', 'Garamond',
  'Courier New', 'Menlo', 'Monaco',
  'Impact', 'Comic Sans MS', 'Brush Script MT',
];

export const GOOGLE_FONTS = [
  'Abril Fatface', 'Anton', 'Bebas Neue', 'Bitter', 'Caveat',
  'Dancing Script', 'DM Sans', 'Fira Sans', 'Inter', 'Josefin Sans',
  'Karla', 'Lato', 'Lobster', 'Merriweather', 'Montserrat',
  'Noto Sans', 'Nunito', 'Open Sans', 'Oswald', 'Pacifico',
  'Playfair Display', 'Poppins', 'PT Sans', 'Quicksand', 'Raleway',
  'Roboto', 'Roboto Slab', 'Rubik', 'Shadows Into Light', 'Source Sans 3',
  'Space Grotesk', 'Ubuntu', 'Work Sans',
];

const loadedGoogleFonts = new Set<string>();

const GF_BASE = 'https://fonts.googleapis.com/css2?family=';

function gfUrl(family: string, axes: string): string {
  const fam = encodeURIComponent(family).replace(/%20/g, '+');
  return `${GF_BASE}${fam}${axes}&display=swap`;
}

/** Waits for the browser to actually have the family available. */
async function awaitFontFaces(family: string): Promise<void> {
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load(`16px "${family}"`),
        document.fonts.load(`bold 16px "${family}"`),
        document.fonts.load(`italic 16px "${family}"`),
      ]),
      new Promise((resolve) => setTimeout(resolve, 6000)),
    ]);
  } catch {
    // Render anyway with fallback; the recomposite after load will fix it.
  }
}

function injectCss(family: string, css: string): void {
  const id = `gf-${family.replace(/\s+/g, '-')}`;
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}

/** Injects the Google Fonts stylesheet for a family and waits for the font. */
export async function loadGoogleFont(family: string): Promise<void> {
  if (loadedGoogleFonts.has(family)) return;
  const id = `gf-${family.replace(/\s+/g, '-')}`;
  if (!document.getElementById(id)) {
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    // crossorigin: con COEP require-corp activo (ver .htaccess) los recursos
    // externos deben llegar vía CORS; Google Fonts responde ACAO:* siempre.
    link.crossOrigin = 'anonymous';
    link.href = gfUrl(family, ':ital,wght@0,400;0,700;1,400;1,700');
    document.head.appendChild(link);
  }
  await awaitFontFaces(family);
  loadedGoogleFonts.add(family);
}

/**
 * On-demand loader for any typed Google Fonts family name.
 * Validates against the css2 API (a 400 means the family doesn't exist),
 * tolerates lowercase input, and loads the richest style set the family
 * supports (variable weights + italics → fixed 400/700 → regular only).
 * Returns the canonical family name on success, or null.
 */
export async function tryLoadGoogleFont(query: string): Promise<string | null> {
  const typed = query.trim().replace(/\s+/g, ' ');
  if (!typed) return null;
  const titleCased = typed.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  // Google uses all-caps two-letter prefixes: DM Sans, PT Serif, EB Garamond…
  const shortCaps = titleCased.replace(/\b\w{1,2}\b/g, (w) => w.toUpperCase());

  // Resolve the canonical family. The css2 API is case-sensitive, and its
  // 400 responses lack CORS headers, so fetch *throws* on a wrong name —
  // treat a throw like "this candidate doesn't exist" and try the next.
  let family: string | null = null;
  for (const candidate of [...new Set([typed, titleCased, shortCaps])]) {
    if (loadedGoogleFonts.has(candidate)) return candidate;
    try {
      const res = await fetch(gfUrl(candidate, ''));
      if (res.ok) { family = candidate; break; }
    } catch { /* wrong name (400 w/o CORS) or network down — try next */ }
  }
  if (!family) return null;

  // Load the richest supported style set (unsupported tiers 400 → throw).
  const TIERS = [
    ':ital,wght@0,100..900;1,100..900', // variable + italics
    ':ital,wght@0,400;0,700;1,400;1,700', // static 4
    ':wght@400;700',
    '',
  ];
  for (const axes of TIERS) {
    try {
      const res = await fetch(gfUrl(family, axes));
      if (!res.ok) continue;
      injectCss(family, await res.text());
      await awaitFontFaces(family);
      loadedGoogleFonts.add(family);
      return family;
    } catch { /* tier not supported by this family — try the next one */ }
  }
  return null;
}

/** Best-effort list of locally installed fonts (Chrome only, needs permission). */
export async function queryLocalFontFamilies(): Promise<string[] | null> {
  const q = (window as unknown as {
    queryLocalFonts?: () => Promise<{ family: string }[]>;
  }).queryLocalFonts;
  if (!q) return null;
  try {
    const fonts = await q.call(window);
    const fams = [...new Set(fonts.map((f) => f.family))];
    fams.sort((a, b) => a.localeCompare(b));
    return fams;
  } catch {
    return null;
  }
}

function fontString(t: TextData): string {
  const style = t.italic ? 'italic ' : '';
  const weight = t.bold ? '700 ' : '400 ';
  return `${style}${weight}${t.size}px "${t.family}"`;
}

const PAD = 8; // px around the text so antialiasing/descenders never clip

interface Measured {
  lines: string[];
  widths: number[];
  maxWidth: number;
  lineStep: number;
  totalHeight: number;
}

function measure(g: CanvasRenderingContext2D, t: TextData): Measured {
  const lines = t.text.split('\n');
  g.font = fontString(t);
  applyLetterSpacing(g, t.letterSpacing);
  const widths = lines.map((l) => g.measureText(l || ' ').width);
  const maxWidth = Math.max(1, ...widths);
  const lineStep = t.size * t.lineHeight;
  return { lines, widths, maxWidth, lineStep, totalHeight: lineStep * lines.length };
}

function applyLetterSpacing(g: CanvasRenderingContext2D, px: number): void {
  // letterSpacing is supported in all current Chrome/Safari/Firefox; the cast
  // keeps TS happy on older lib.dom versions.
  (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${px}px`;
}

/** Renders text data to a tight canvas. Fonts must already be loaded. */
export function renderText(t: TextData): HTMLCanvasElement {
  const probe = ctx2d(createCanvas(1, 1));
  const m = measure(probe, t);

  const w = Math.ceil(m.maxWidth + PAD * 2);
  const h = Math.ceil(m.totalHeight + PAD * 2);
  const c = createCanvas(w, h);
  const g = ctx2d(c);
  g.font = fontString(t);
  applyLetterSpacing(g, t.letterSpacing);
  g.fillStyle = t.color;
  g.textBaseline = 'alphabetic';

  // Baseline of the first line: cap top at PAD, ascent ≈ 0.8em.
  const ascent = t.size * 0.8;
  m.lines.forEach((line, i) => {
    const y = PAD + ascent + i * m.lineStep;
    let x = PAD;
    if (t.align === 'center') x = PAD + (m.maxWidth - m.widths[i]) / 2;
    else if (t.align === 'right') x = PAD + (m.maxWidth - m.widths[i]);
    g.fillText(line, x, y);
    if (line && (t.underline || t.strikethrough)) {
      const thickness = Math.max(1, t.size * 0.055);
      if (t.underline) g.fillRect(x, y + t.size * 0.1, m.widths[i], thickness);
      if (t.strikethrough) g.fillRect(x, y - t.size * 0.3, m.widths[i], thickness);
    }
  });
  return c;
}

export const DEFAULT_TEXT: TextData = {
  text: 'Texto',
  family: 'Arial',
  googleFont: false,
  size: 64,
  color: '#ffffff',
  align: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
};
