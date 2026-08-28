import type { Doc } from '../types';

export const DEFAULT_MAX_HISTORY_ENTRIES = 25;
export const DEFAULT_MAX_HISTORY_BYTES = 256 * 1024 * 1024;

export interface DocumentSnapshot {
  doc: Doc | null;
}

/** Copy-on-write document shell used by undo/redo snapshots. */
export function cloneDocumentSnapshot(doc: Doc | null): Doc | null {
  if (!doc) return null;
  return {
    ...doc,
    layers: [...doc.layers],
    savedSelections: doc.savedSelections ? [...doc.savedSelections] : undefined,
  };
}

/** Counts unique pixel buffers, not references shared by copy-on-write. */
export function estimateHistoryBytes(entries: readonly DocumentSnapshot[]): number {
  const seen = new Set<HTMLCanvasElement>();
  let total = 0;
  for (const entry of entries) {
    for (const layer of entry.doc?.layers ?? []) {
      for (const canvas of [layer.canvas, layer.mask?.canvas]) {
        if (!canvas || seen.has(canvas)) continue;
        seen.add(canvas);
        total += canvas.width * canvas.height * 4;
      }
    }
    for (const channel of entry.doc?.savedSelections ?? []) {
      if (seen.has(channel.mask)) continue;
      seen.add(channel.mask);
      total += channel.mask.width * channel.mask.height * 4;
    }
  }
  return total;
}

export function trimHistoryEntries<T extends DocumentSnapshot>(
  entries: readonly T[],
  maxEntries = DEFAULT_MAX_HISTORY_ENTRIES,
  maxBytes = DEFAULT_MAX_HISTORY_BYTES,
): T[] {
  const trimmed = entries.length > maxEntries ? entries.slice(-maxEntries) : [...entries];
  while (trimmed.length > 1 && estimateHistoryBytes(trimmed) > maxBytes) trimmed.shift();
  return trimmed;
}
