import { describe, expect, it } from 'vitest';
import { embedDpi } from './dpi';

function chunk(type: string, size: number): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(new ArrayBuffer(12 + size));
  output[3] = size;
  output.set(Array.from(type, (char) => char.charCodeAt(0)), 4);
  return output;
}

function minimalPng(): Blob {
  const signature = new Uint8Array(new ArrayBuffer(8));
  signature.set([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Blob([signature, chunk('IHDR', 13), chunk('IEND', 0)], { type: 'image/png' });
}

function pngChunkTypes(bytes: Uint8Array): string[] {
  const types: string[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    types.push(String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]));
    offset += 12 + length;
  }
  return types;
}

describe('image metadata', () => {
  it('adds physical resolution and an explicit sRGB declaration to PNG', async () => {
    const output = await embedDpi(minimalPng(), 'image/png', 300);
    expect(pngChunkTypes(new Uint8Array(await output.arrayBuffer()))).toEqual(['IHDR', 'sRGB', 'pHYs', 'IEND']);
  });

  it('replaces pHYs without duplicating metadata on repeated exports', async () => {
    const first = await embedDpi(minimalPng(), 'image/png', 72);
    const second = await embedDpi(first, 'image/png', 144);
    const types = pngChunkTypes(new Uint8Array(await second.arrayBuffer()));
    expect(types.filter((type) => type === 'pHYs')).toHaveLength(1);
    expect(types.filter((type) => type === 'sRGB')).toHaveLength(1);
  });
});
