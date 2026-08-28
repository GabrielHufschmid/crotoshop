export interface PanelPosition {
  x: number;
  y: number;
}

export interface PanelSize {
  width: number;
  height: number;
}

export interface PanelBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PanelSnapLines {
  vertical: readonly number[];
  horizontal: readonly number[];
}

export interface PanelSnapResult {
  position: PanelPosition;
  guides: { x: number | null; y: number | null };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(min, value), Math.max(min, max));
}

function snapAxis(
  rawStart: number,
  size: number,
  minEdge: number,
  maxEdge: number,
  lines: readonly number[],
  threshold: number,
): { start: number; guide: number | null } {
  const maxStart = Math.max(minEdge, maxEdge - size);
  let bestStart = clamp(rawStart, minEdge, maxStart);
  let bestGuide: number | null = null;
  let bestDistance = Math.max(0, threshold) + Number.EPSILON;

  for (const line of lines) {
    for (const candidate of [line, line - size]) {
      if (candidate < minEdge || candidate > maxStart) continue;
      const distance = Math.abs(rawStart - candidate);
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      bestStart = candidate;
      bestGuide = line;
    }
  }

  return { start: bestStart, guide: bestGuide };
}

/** Keeps a floating panel on-screen and magnetically aligns either edge. */
export function snapPanelPosition(
  raw: PanelPosition,
  size: PanelSize,
  bounds: PanelBounds,
  lines: PanelSnapLines,
  threshold = 14,
): PanelSnapResult {
  const horizontal = snapAxis(raw.x, size.width, bounds.left, bounds.right, lines.vertical, threshold);
  const vertical = snapAxis(raw.y, size.height, bounds.top, bounds.bottom, lines.horizontal, threshold);
  return {
    position: { x: Math.round(horizontal.start), y: Math.round(vertical.start) },
    guides: { x: horizontal.guide, y: vertical.guide },
  };
}
