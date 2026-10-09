import { describe, expect, it } from 'vitest';
import { rectFromPoints, toSourcePixelRect } from '../../src/core/capture/geometry.js';

describe('rectFromPoints', () => {
  it('normalises a top-left to bottom-right drag', () => {
    expect(rectFromPoints({ x: 10, y: 20 }, { x: 60, y: 90 })).toEqual({
      x: 10,
      y: 20,
      width: 50,
      height: 70,
    });
  });

  it.each([
    ['bottom-right to top-left', { x: 60, y: 90 }, { x: 10, y: 20 }],
    ['top-right to bottom-left', { x: 60, y: 20 }, { x: 10, y: 90 }],
    ['bottom-left to top-right', { x: 10, y: 90 }, { x: 60, y: 20 }],
  ])('produces the same positive-area rect dragging %s', (_label, start, end) => {
    expect(rectFromPoints(start, end)).toEqual({ x: 10, y: 20, width: 50, height: 70 });
  });

  it('yields a zero-area rect for a click without movement', () => {
    expect(rectFromPoints({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0,
    });
  });
});

describe('toSourcePixelRect', () => {
  it('scales a CSS rect into device pixels', () => {
    const result = toSourcePixelRect({ x: 10, y: 20, width: 100, height: 50 }, 2, 2880, 1800);

    expect(result).toEqual({ sx: 20, sy: 40, sw: 200, sh: 100 });
  });

  it('passes through unchanged at a ratio of 1', () => {
    const result = toSourcePixelRect({ x: 10, y: 20, width: 100, height: 50 }, 1, 1440, 900);

    expect(result).toEqual({ sx: 10, sy: 20, sw: 100, sh: 50 });
  });

  it('clamps a selection that runs past the right edge', () => {
    const result = toSourcePixelRect({ x: 1400, y: 0, width: 200, height: 50 }, 1, 1440, 900);

    expect(result).toEqual({ sx: 1400, sy: 0, sw: 40, sh: 50 });
  });

  it('clamps a selection that runs past the bottom edge', () => {
    const result = toSourcePixelRect({ x: 0, y: 880, width: 100, height: 200 }, 1, 1440, 900);

    expect(result).toEqual({ sx: 0, sy: 880, sw: 100, sh: 20 });
  });

  // --- BUG-007 regression --------------------------------------------------
  // Returning null here is what stops a zero-dimension OffscreenCanvas being
  // constructed further down the call chain.
  it('returns null when the selection is entirely outside the image', () => {
    expect(toSourcePixelRect({ x: 2000, y: 0, width: 100, height: 100 }, 1, 1440, 900)).toBeNull();
    expect(toSourcePixelRect({ x: 0, y: 2000, width: 100, height: 100 }, 1, 1440, 900)).toBeNull();
  });

  it('returns null when scaling leaves less than one pixel', () => {
    expect(toSourcePixelRect({ x: 1439, y: 0, width: 0.2, height: 50 }, 1, 1440, 900)).toBeNull();
  });

  it('handles a fractional device pixel ratio', () => {
    const result = toSourcePixelRect({ x: 10, y: 10, width: 100, height: 100 }, 1.5, 2160, 1350);

    expect(result).toEqual({ sx: 15, sy: 15, sw: 150, sh: 150 });
  });
});
