import { describe, expect, it } from 'vitest';
import type { Doc, Layer } from '../types';
import { DEFAULT_ADJUSTMENTS } from '../types';
import { cloneDocumentSnapshot, estimateHistoryBytes, trimHistoryEntries } from './history';

function canvas(width: number, height: number): HTMLCanvasElement {
  return { width, height } as HTMLCanvasElement;
}

function layer(id: string, pixels: HTMLCanvasElement, mask?: HTMLCanvasElement): Layer {
  return {
    id,
    name: id,
    visible: true,
    opacity: 1,
    x: 0,
    y: 0,
    canvas: pixels,
    adjustments: DEFAULT_ADJUSTMENTS,
    mask: mask ? { canvas: mask, enabled: true } : undefined,
    thumb: '',
  };
}

function doc(layers: Layer[]): Doc {
  return { width: 100, height: 100, activeId: layers[0]?.id ?? null, layers };
}

describe('history memory policy', () => {
  it('counts shared canvases once across snapshots', () => {
    const shared = canvas(100, 50);
    const entries = [{ doc: doc([layer('a', shared)]) }, { doc: doc([layer('a', shared)]) }];
    expect(estimateHistoryBytes(entries)).toBe(100 * 50 * 4);
  });

  it('includes masks and saved selections in the memory budget', () => {
    const pixels = canvas(10, 10);
    const mask = canvas(10, 10);
    const channel = canvas(20, 10);
    const value = doc([layer('a', pixels, mask)]);
    value.savedSelections = [{ id: 's', name: 'S', mask: channel, bounds: { x: 0, y: 0, w: 20, h: 10 } }];
    expect(estimateHistoryBytes([{ doc: value }])).toBe((100 + 100 + 200) * 4);
  });

  it('drops oldest entries until both limits are respected', () => {
    const entries = [1, 2, 3, 4].map((id) => ({ id, doc: doc([layer(String(id), canvas(10, 10))]) }));
    expect(trimHistoryEntries(entries, 3, 900).map((entry) => entry.id)).toEqual([3, 4]);
  });

  it('clones document collections while retaining copy-on-write pixels', () => {
    const pixels = canvas(10, 10);
    const source = doc([layer('a', pixels)]);
    source.savedSelections = [{ id: 's', name: 'S', mask: pixels, bounds: { x: 0, y: 0, w: 10, h: 10 } }];
    const cloned = cloneDocumentSnapshot(source)!;
    expect(cloned).not.toBe(source);
    expect(cloned.layers).not.toBe(source.layers);
    expect(cloned.layers[0].canvas).toBe(pixels);
    expect(cloned.savedSelections).not.toBe(source.savedSelections);
  });
});
