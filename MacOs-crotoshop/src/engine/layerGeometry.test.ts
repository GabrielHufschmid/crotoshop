import { describe, expect, it } from 'vitest';
import type { Doc, Layer } from '../types';
import { DEFAULT_ADJUSTMENTS } from '../types';
import { alignSelectedLayers, distributeSelectedLayers, documentToLayerPoint, layerToDocumentPoint } from './layerGeometry';

function layer(id: string, x: number, y: number, w: number, h: number, patch: Partial<Layer> = {}): Layer {
  return {
    id,
    name: id,
    visible: true,
    opacity: 1,
    x,
    y,
    canvas: { width: w, height: h } as HTMLCanvasElement,
    adjustments: DEFAULT_ADJUSTMENTS,
    thumb: '',
    ...patch,
  };
}

function doc(layers: Layer[]): Doc {
  return { width: 200, height: 100, layers, activeId: layers[0]?.id ?? null };
}

describe('layer geometry', () => {
  it('aligns only selected layers', () => {
    const source = doc([layer('a', 10, 0, 10, 10), layer('b', 50, 0, 20, 10), layer('c', 90, 0, 10, 10)]);
    const result = alignSelectedLayers(source, ['a', 'b'], 'left');
    expect(result.find((item) => item.id === 'a')?.x).toBe(10);
    expect(result.find((item) => item.id === 'b')?.x).toBe(10);
    expect(result.find((item) => item.id === 'c')?.x).toBe(90);
  });

  it('distributes selected layers with equal gaps', () => {
    const source = doc([layer('a', 0, 0, 10, 10), layer('b', 40, 0, 20, 10), layer('c', 100, 0, 10, 10)]);
    const result = distributeSelectedLayers(source, ['a', 'b', 'c'], 'x');
    expect(result.find((item) => item.id === 'b')?.x).toBe(45);
  });

  it('moves a group and its children as one unit', () => {
    const source = doc([
      layer('child-a', 20, 10, 20, 20, { parentId: 'group' }),
      layer('child-b', 50, 10, 10, 20, { parentId: 'group' }),
      layer('group', 0, 0, 1, 1, { kind: 'group' }),
    ]);
    const result = alignSelectedLayers(source, ['group'], 'centerH');
    expect(result.find((item) => item.id === 'child-a')?.x).toBe(80);
    expect(result.find((item) => item.id === 'child-b')?.x).toBe(110);
  });

  it('leaves locked layers untouched', () => {
    const source = doc([
      layer('free', 20, 10, 20, 20),
      layer('locked', 80, 10, 20, 20, { locked: true }),
    ]);
    const result = alignSelectedLayers(source, ['free', 'locked'], 'right');
    expect(result.find((item) => item.id === 'free')?.x).toBe(180);
    expect(result.find((item) => item.id === 'locked')?.x).toBe(80);
  });

  it('maps points through scale, rotation and flips in both directions', () => {
    const transformed = layer('a', 30, 40, 100, 50, {
      w: 240,
      h: 120,
      rotation: Math.PI / 3,
      flipX: true,
    });
    const source = { x: 17.25, y: 31.5 };
    const documentPoint = layerToDocumentPoint(transformed, source);
    const roundTrip = documentToLayerPoint(transformed, documentPoint);
    expect(roundTrip.x).toBeCloseTo(source.x, 8);
    expect(roundTrip.y).toBeCloseTo(source.y, 8);
  });
});
