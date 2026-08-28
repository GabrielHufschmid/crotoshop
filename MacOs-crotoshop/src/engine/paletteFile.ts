import type { PaletteHarmony } from './palette';
import { HARMONIES, generatePalette } from './palette';

export const PALETTE_FILE_EXT = '.crotopalette';

export interface PaletteFileData {
  name: string;
  primary: string;
  harmony?: PaletteHarmony;
  colors: string[];
}

class InvalidPaletteFile extends Error {
  constructor(detail: string) {
    super(`Archivo de paleta inválido (${detail})`);
  }
}

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
const MAX_NAME_LEN = 120;
const MAX_COLORS = 12;

function normalizeHex(v: unknown): string | null {
  return typeof v === 'string' && HEX_RE.test(v) ? v : null;
}

/** Filesystem-safe filename for a palette, e.g. "Mi paleta.crotopalette". */
export function paletteFileName(name: string): string {
  const safe = name.trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, MAX_NAME_LEN) || 'paleta';
  return `${safe}${PALETTE_FILE_EXT}`;
}

/**
 * Serializes a palette to JSON. The primary color is the single source of
 * truth; `colors` (the harmony derivations) travel along only as an
 * informative snapshot — on import they're regenerated from `primary` +
 * `harmony` whenever possible, never trusted as-is.
 */
export function serializePaletteFile(data: PaletteFileData): string {
  return JSON.stringify(
    {
      format: 'crotopalette',
      version: 1,
      name: data.name,
      primary: data.primary,
      harmony: data.harmony,
      colors: data.colors,
    },
    null,
    2,
  );
}

export function parsePaletteFile(text: string): PaletteFileData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new InvalidPaletteFile('JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new InvalidPaletteFile('raíz');
  const p = parsed as Record<string, unknown>;
  if (p.format !== 'crotopalette' || p.version !== 1) throw new InvalidPaletteFile('formato');

  const primary = normalizeHex(p.primary);
  if (!primary) throw new InvalidPaletteFile('color primario');

  const harmony = HARMONIES.some((h) => h.id === p.harmony) ? (p.harmony as PaletteHarmony) : undefined;
  const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, MAX_NAME_LEN) : 'Paleta importada';

  // El programa siempre puede regenerar los derivados desde el primario: si
  // el archivo trae una armonía reconocida, se regeneran acá mismo (ignorando
  // los "colors" guardados, que son solo un respaldo informativo). Si no,
  // se usan los colores del archivo cuando son válidos, y en último caso se
  // deriva una armonía por defecto a partir del primario.
  const fileColors = Array.isArray(p.colors)
    ? p.colors.filter((c): c is string => normalizeHex(c) !== null).slice(0, MAX_COLORS)
    : [];
  const colors = harmony
    ? generatePalette(primary, harmony).colors
    : fileColors.length
      ? fileColors
      : generatePalette(primary, 'analogous').colors;

  return { name, primary, harmony, colors };
}
