import type { Doc, Layer, Pt } from '../types';

export interface LayerBounds { x: number; y: number; w: number; h: number }

export function layerBounds(layer: Layer): LayerBounds {
  return {
    x: layer.x,
    y: layer.y,
    w: layer.w ?? layer.canvas.width,
    h: layer.h ?? layer.canvas.height,
  };
}

/** Maps a document-space point back into a layer's source pixel space. */
export function documentToLayerPoint(
  layer: Layer,
  point: Pt,
  pixelWidth = layer.canvas.width,
  pixelHeight = layer.canvas.height,
): Pt {
  const displayWidth = layer.w ?? layer.canvas.width;
  const displayHeight = layer.h ?? layer.canvas.height;
  const centerX = layer.x + displayWidth / 2;
  const centerY = layer.y + displayHeight / 2;
  const angle = layer.rotation ?? 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - centerX;
  const dy = point.y - centerY;
  const unrotatedX = dx * cos + dy * sin;
  const unrotatedY = -dx * sin + dy * cos;
  const displayX = unrotatedX * (layer.flipX ? -1 : 1) + displayWidth / 2;
  const displayY = unrotatedY * (layer.flipY ? -1 : 1) + displayHeight / 2;
  return {
    x: displayX * pixelWidth / Math.max(0.0001, displayWidth),
    y: displayY * pixelHeight / Math.max(0.0001, displayHeight),
  };
}

/** Maps a source pixel point through the layer's scale/flip/rotation. */
export function layerToDocumentPoint(
  layer: Layer,
  point: Pt,
  pixelWidth = layer.canvas.width,
  pixelHeight = layer.canvas.height,
): Pt {
  const displayWidth = layer.w ?? layer.canvas.width;
  const displayHeight = layer.h ?? layer.canvas.height;
  const localX = (point.x * displayWidth / Math.max(1, pixelWidth) - displayWidth / 2) * (layer.flipX ? -1 : 1);
  const localY = (point.y * displayHeight / Math.max(1, pixelHeight) - displayHeight / 2) * (layer.flipY ? -1 : 1);
  const angle = layer.rotation ?? 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: layer.x + displayWidth / 2 + localX * cos - localY * sin,
    y: layer.y + displayHeight / 2 + localX * sin + localY * cos,
  };
}

/** Converts a document-space brush diameter to the layer's source scale. */
export function documentSizeToLayerPixels(
  layer: Layer,
  size: number,
  pixelWidth = layer.canvas.width,
  pixelHeight = layer.canvas.height,
): number {
  const scaleX = pixelWidth / Math.max(0.0001, layer.w ?? layer.canvas.width);
  const scaleY = pixelHeight / Math.max(0.0001, layer.h ?? layer.canvas.height);
  return size * Math.sqrt(scaleX * scaleY);
}

function union(bounds: LayerBounds[]): LayerBounds | null {
  if (!bounds.length) return null;
  const left = Math.min(...bounds.map((b) => b.x));
  const top = Math.min(...bounds.map((b) => b.y));
  const right = Math.max(...bounds.map((b) => b.x + b.w));
  const bottom = Math.max(...bounds.map((b) => b.y + b.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function effectiveLayerBounds(doc: Doc, layer: Layer, seen = new Set<string>()): LayerBounds {
  if (layer.kind !== 'group' || seen.has(layer.id)) return layerBounds(layer);
  seen.add(layer.id);
  const childBounds = doc.layers
    .filter((candidate) => candidate.parentId === layer.id)
    .map((child) => effectiveLayerBounds(doc, child, seen));
  return union(childBounds) ?? layerBounds(layer);
}

function descendants(doc: Doc, id: string, seen = new Set<string>()): string[] {
  if (seen.has(id)) return [];
  seen.add(id);
  const children = doc.layers.filter((layer) => layer.parentId === id);
  return children.flatMap((child) => [child.id, ...(child.kind === 'group' ? descendants(doc, child.id, seen) : [])]);
}

function topLevelSelection(doc: Doc, ids: string[]): Layer[] {
  const selected = new Set(ids);
  return doc.layers.filter((layer) => selected.has(layer.id) && (!layer.parentId || !selected.has(layer.parentId)) && layer.kind !== 'adjustment' && !layer.locked);
}

function translatedIds(doc: Doc, layer: Layer): Set<string> {
  return new Set([layer.id, ...(layer.kind === 'group' ? descendants(doc, layer.id) : [])]);
}

function translate(layers: Layer[], ids: Set<string>, dx: number, dy: number): Layer[] {
  return layers.map((layer) => ids.has(layer.id) ? { ...layer, x: layer.x + dx, y: layer.y + dy } : layer);
}

export function alignSelectedLayers(
  doc: Doc,
  ids: string[],
  mode: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom',
): Layer[] {
  const selected = topLevelSelection(doc, ids);
  if (!selected.length) return doc.layers;
  const bounds = selected.map((layer) => effectiveLayerBounds(doc, layer));
  const selectionBounds = union(bounds)!;
  const target = selected.length === 1 ? { x: 0, y: 0, w: doc.width, h: doc.height } : selectionBounds;
  let layers = doc.layers;
  selected.forEach((layer, index) => {
    const b = bounds[index];
    let dx = 0;
    let dy = 0;
    if (mode === 'left') dx = target.x - b.x;
    else if (mode === 'centerH') dx = target.x + (target.w - b.w) / 2 - b.x;
    else if (mode === 'right') dx = target.x + target.w - b.w - b.x;
    else if (mode === 'top') dy = target.y - b.y;
    else if (mode === 'centerV') dy = target.y + (target.h - b.h) / 2 - b.y;
    else dy = target.y + target.h - b.h - b.y;
    layers = translate(layers, translatedIds(doc, layer), Math.round(dx), Math.round(dy));
  });
  return layers;
}

export function distributeSelectedLayers(doc: Doc, ids: string[], axis: 'x' | 'y'): Layer[] {
  const selected = topLevelSelection(doc, ids);
  if (selected.length < 3) return doc.layers;
  const items = selected.map((layer) => ({ layer, bounds: effectiveLayerBounds(doc, layer) }))
    .sort((a, b) => axis === 'x' ? a.bounds.x - b.bounds.x : a.bounds.y - b.bounds.y);
  const start = axis === 'x' ? items[0].bounds.x : items[0].bounds.y;
  const end = axis === 'x'
    ? items[items.length - 1].bounds.x + items[items.length - 1].bounds.w
    : items[items.length - 1].bounds.y + items[items.length - 1].bounds.h;
  const occupied = items.reduce((sum, item) => sum + (axis === 'x' ? item.bounds.w : item.bounds.h), 0);
  const gap = (end - start - occupied) / (items.length - 1);
  let cursor = start;
  let layers = doc.layers;
  items.forEach(({ layer, bounds }, index) => {
    if (index > 0 && index < items.length - 1) {
      const delta = cursor - (axis === 'x' ? bounds.x : bounds.y);
      layers = translate(layers, translatedIds(doc, layer), axis === 'x' ? Math.round(delta) : 0, axis === 'y' ? Math.round(delta) : 0);
    }
    cursor += (axis === 'x' ? bounds.w : bounds.h) + gap;
  });
  return layers;
}

export function movableSelectionIds(doc: Doc, ids: string[]): Set<string> {
  const selected = topLevelSelection(doc, ids);
  return new Set(selected.flatMap((layer) => [...translatedIds(doc, layer)]));
}
