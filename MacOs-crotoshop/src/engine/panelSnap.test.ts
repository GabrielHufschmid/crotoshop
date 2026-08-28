import { describe, expect, it } from 'vitest';
import { snapPanelPosition } from './panelSnap';

const bounds = { left: 8, right: 1200, top: 54, bottom: 760 };
const size = { width: 300, height: 240 };
const lines = { vertical: [8, 72, 936, 1200], horizontal: [54, 82, 712, 760] };

describe('snapPanelPosition', () => {
  it('snaps the leading edge to an interface boundary', () => {
    expect(snapPanelPosition({ x: 66, y: 200 }, size, bounds, lines).position.x).toBe(72);
  });

  it('snaps the trailing edge to an interface boundary', () => {
    const result = snapPanelPosition({ x: 642, y: 200 }, size, bounds, lines);
    expect(result.position.x).toBe(636);
    expect(result.guides.x).toBe(936);
  });

  it('snaps each axis independently', () => {
    const result = snapPanelPosition({ x: 400, y: 477 }, size, bounds, lines);
    expect(result.position).toEqual({ x: 400, y: 472 });
    expect(result.guides).toEqual({ x: null, y: 712 });
  });

  it('clamps the panel when it is moved outside the usable interface', () => {
    expect(snapPanelPosition({ x: -500, y: 900 }, size, bounds, lines, 0).position)
      .toEqual({ x: 8, y: 520 });
  });
});
