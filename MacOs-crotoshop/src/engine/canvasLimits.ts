export const MAX_CANVAS_DIMENSION = 16_384;
export const MAX_CANVAS_PIXELS = 100_000_000;

export function isCanvasSizeAllowed(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) &&
    width >= 1 && height >= 1 &&
    width <= MAX_CANVAS_DIMENSION && height <= MAX_CANVAS_DIMENSION &&
    width * height <= MAX_CANVAS_PIXELS;
}

export function canvasLimitMessage(width: number, height: number): string {
  return `El tamaño de ${Math.round(width)} × ${Math.round(height)} px es demasiado grande.`;
}
