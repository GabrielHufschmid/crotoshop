import type { Unit } from '../types';

export const CM_PER_INCH = 2.54;

/** Converts a pixel length to the given unit at `ppi` pixels per inch. */
export function pxToUnit(px: number, unit: Unit, ppi: number): number {
  if (unit === 'px') return px;
  return (px / ppi) * CM_PER_INCH;
}

/** Converts a length in `unit` back to pixels at `ppi`. */
export function unitToPx(value: number, unit: Unit, ppi: number): number {
  if (unit === 'px') return value;
  return (value / CM_PER_INCH) * ppi;
}

/** Formats a pixel length in the given unit, with a sensible precision. */
export function formatDim(px: number, unit: Unit, ppi: number): string {
  if (unit === 'px') return `${Math.round(px)}`;
  return pxToUnit(px, unit, ppi).toFixed(2);
}

export function unitLabel(unit: Unit): string {
  return unit;
}
