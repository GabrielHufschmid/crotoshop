import { describe, expect, it } from 'vitest';
import { defaultDocumentFileName, fileBaseName, safeFileName } from './fileNames';

const date = new Date(2026, 7, 3, 15, 9, 7);

describe('document file names', () => {
  it('names a new document with a timestamp', () => {
    expect(defaultDocumentFileName(undefined, date)).toBe('Nueva imagen - 2026-08-03 15-09-07');
  });

  it('preserves an opened file base name', () => {
    expect(defaultDocumentFileName('Foto final.png', date)).toBe('Foto final - 2026-08-03 15-09-07');
  });

  it('removes extensions and unsafe cross-platform characters', () => {
    expect(fileBaseName('diseño.v2.psd')).toBe('diseño.v2');
    expect(safeFileName('A:B/C*')).toBe('A-B-C-');
    expect(safeFileName('../mesa/final')).toBe('..-mesa-final');
  });
});
