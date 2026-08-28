import type { Font, Path as OpenTypePath, PathCommand } from 'opentype.js';
import type { TextData, VectorNode, VectorShape, VectorSubpath } from '../types';
import { desktop, ownedBuffer } from '../desktop/native';
import { makeEditableVector } from './vectorPath';
import { uid } from './canvasUtils';

interface LocalFontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  blob: () => Promise<Blob>;
}

interface LocalFontsWindow {
  queryLocalFonts?: () => Promise<LocalFontData[]>;
}

const fontCache = new Map<string, Promise<Font>>();

function fontStyleScore(font: LocalFontData, text: TextData): number {
  const style = `${font.style} ${font.fullName} ${font.postscriptName}`.toLowerCase();
  const hasBold = /bold|semibold|demibold|black|heavy/.test(style);
  const hasItalic = /italic|oblique/.test(style);
  return (hasBold === text.bold ? 4 : 0) + (hasItalic === text.italic ? 3 : 0)
    + (/regular|normal|book/.test(style) && !text.bold && !text.italic ? 1 : 0);
}

async function localFontBytes(text: TextData): Promise<ArrayBuffer> {
  const query = (window as unknown as LocalFontsWindow).queryLocalFonts;
  if (!query) throw new Error('Esta versión de Chromium no permite acceder a las fuentes locales');
  const fonts = await query.call(window);
  const family = text.family.trim().toLocaleLowerCase();
  const matches = fonts
    .filter((font) => font.family.trim().toLocaleLowerCase() === family)
    .sort((left, right) => fontStyleScore(right, text) - fontStyleScore(left, text));
  if (!matches.length) throw new Error(`No se encontró el archivo OpenType de “${text.family}”`);
  return matches[0].blob().then((blob) => blob.arrayBuffer());
}

async function fontForText(text: TextData): Promise<Font> {
  const key = `${text.googleFont ? 'google' : 'local'}:${text.family}:${text.bold ? 700 : 400}:${text.italic ? 1 : 0}`;
  let pending = fontCache.get(key);
  if (!pending) {
    pending = (async () => {
      const buffer = text.googleFont && desktop
        ? ownedBuffer(await desktop.googleFont({ family: text.family, bold: text.bold, italic: text.italic }))
        : await localFontBytes(text);
      try {
        const { parse } = await import('opentype.js');
        return parse(buffer);
      } catch {
        throw new Error(`La variante de “${text.family}” no se pudo interpretar como OpenType`);
      }
    })();
    fontCache.set(key, pending);
    void pending.catch(() => fontCache.delete(key));
  }
  return pending;
}

function node(x: number, y: number): VectorNode {
  return { id: uid(), x, y, inX: 0, inY: 0, outX: 0, outY: 0, kind: 'corner' };
}

function finishSubpath(output: VectorSubpath[], nodes: VectorNode[], closed: boolean): void {
  if (closed && nodes.length > 2) {
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-5) {
      first.inX = last.inX;
      first.inY = last.inY;
      nodes.pop();
    }
  }
  if (nodes.length >= 2) output.push({ id: uid(), nodes, closed });
}

export function openTypeCommandsToSubpaths(commands: readonly PathCommand[]): VectorSubpath[] {
  const output: VectorSubpath[] = [];
  let nodes: VectorNode[] = [];
  let current: VectorNode | null = null;
  for (const command of commands) {
    if (command.type === 'M') {
      if (nodes.length) finishSubpath(output, nodes, false);
      current = node(command.x, command.y);
      nodes = [current];
    } else if (command.type === 'L' && current) {
      current = node(command.x, command.y);
      nodes.push(current);
    } else if (command.type === 'C' && current) {
      current.outX = command.x1 - current.x;
      current.outY = command.y1 - current.y;
      const next = node(command.x, command.y);
      next.inX = command.x2 - command.x;
      next.inY = command.y2 - command.y;
      current.kind = 'smooth';
      next.kind = 'smooth';
      nodes.push(next);
      current = next;
    } else if (command.type === 'Q' && current) {
      const cp1 = {
        x: current.x + (command.x1 - current.x) * 2 / 3,
        y: current.y + (command.y1 - current.y) * 2 / 3,
      };
      const cp2 = {
        x: command.x + (command.x1 - command.x) * 2 / 3,
        y: command.y + (command.y1 - command.y) * 2 / 3,
      };
      current.outX = cp1.x - current.x;
      current.outY = cp1.y - current.y;
      const next = node(command.x, command.y);
      next.inX = cp2.x - command.x;
      next.inY = cp2.y - command.y;
      current.kind = 'smooth';
      next.kind = 'smooth';
      nodes.push(next);
      current = next;
    } else if (command.type === 'Z') {
      finishSubpath(output, nodes, true);
      nodes = [];
      current = null;
    }
  }
  if (nodes.length) finishSubpath(output, nodes, false);
  return output;
}

function lineWidth(font: Font, text: string, data: TextData): number {
  if (!text) return 0;
  const glyphs = font.stringToGlyphs(text);
  const scale = data.size / font.unitsPerEm;
  let width = 0;
  glyphs.forEach((glyph, index) => {
    width += (glyph.advanceWidth ?? font.unitsPerEm) * scale;
    if (index < glyphs.length - 1) {
      width += font.getKerningValue(glyph, glyphs[index + 1]) * scale + data.letterSpacing;
    }
  });
  return width;
}

function glyphPaths(font: Font, text: string, x: number, baseline: number, data: TextData): OpenTypePath[] {
  const glyphs = font.stringToGlyphs(text);
  const scale = data.size / font.unitsPerEm;
  let cursor = x;
  return glyphs.map((glyph, index) => {
    const path = glyph.getPath(cursor, baseline, data.size, font.defaultRenderOptions, font);
    cursor += (glyph.advanceWidth ?? font.unitsPerEm) * scale;
    if (index < glyphs.length - 1) {
      cursor += font.getKerningValue(glyph, glyphs[index + 1]) * scale + data.letterSpacing;
    }
    return path;
  });
}

function rectangleSubpath(x: number, y: number, width: number, height: number): VectorSubpath {
  return {
    id: uid(),
    closed: true,
    nodes: [node(x, y), node(x + width, y), node(x + width, y + height), node(x, y + height)],
  };
}

/** Converts the exact font outlines while preserving the text layer's box. */
export async function textToEditableVector(
  data: TextData,
  width: number,
  height: number,
): Promise<ReturnType<typeof makeEditableVector>> {
  const font = await fontForText(data);
  const lines = data.text.split('\n');
  const widths = lines.map((line) => lineWidth(font, line, data));
  const maxWidth = Math.max(1, ...widths);
  const lineStep = data.size * data.lineHeight;
  const subpaths: VectorSubpath[] = [];
  lines.forEach((line, lineIndex) => {
    let x = 8;
    if (data.align === 'center') x += (maxWidth - widths[lineIndex]) / 2;
    if (data.align === 'right') x += maxWidth - widths[lineIndex];
    const baseline = 8 + data.size * 0.8 + lineIndex * lineStep;
    for (const path of glyphPaths(font, line, x, baseline, data)) {
      subpaths.push(...openTypeCommandsToSubpaths(path.commands));
    }
    if (line && (data.underline || data.strikethrough)) {
      const thickness = Math.max(1, data.size * 0.055);
      if (data.underline) subpaths.push(rectangleSubpath(x, baseline + data.size * 0.1, widths[lineIndex], thickness));
      if (data.strikethrough) subpaths.push(rectangleSubpath(x, baseline - data.size * 0.3, widths[lineIndex], thickness));
    }
  });
  if (!subpaths.length) throw new Error('El texto no contiene contornos visibles');
  const shape: VectorShape = {
    id: uid(),
    name: 'Texto convertido',
    subpaths,
    style: {
      fill: data.color,
      stroke: null,
      strokeWidth: 1,
      opacity: 1,
      fillRule: 'nonzero',
      lineCap: 'round',
      lineJoin: 'round',
      miterLimit: 4,
    },
  };
  return makeEditableVector([shape], width, height);
}
