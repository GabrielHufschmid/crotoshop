import { describe, expect, it } from 'vitest';
import { parsePaletteFile, serializePaletteFile } from './paletteFile';

describe('palette files', () => {
  it('round-trips a generated harmony', () => {
    const text = serializePaletteFile({ name: 'Prueba', primary: '#336699', harmony: 'triad', colors: [] });
    const parsed = parsePaletteFile(text);
    expect(parsed.name).toBe('Prueba');
    expect(parsed.primary).toBe('#336699');
    expect(parsed.colors).toHaveLength(5);
  });

  it('rejects invalid primary colours', () => {
    expect(() => parsePaletteFile(JSON.stringify({ format: 'crotopalette', version: 1, primary: 'red' }))).toThrow(/color primario/);
  });
});
