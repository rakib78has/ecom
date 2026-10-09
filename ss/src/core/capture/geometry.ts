import type { Rect } from '../../shared/messages.js';

export interface PixelRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Converts a CSS-pixel selection rect into a source rect in the captured
 * image's device-pixel space, clamped to the image bounds.
 *
 * Returns null when the clamped rect has no area — a selection entirely
 * outside the captured viewport. Callers must treat that as a user-visible
 * error rather than handing zero dimensions to a canvas constructor.
 */
export function toSourcePixelRect(
  rect: Rect,
  dpr: number,
  imageWidth: number,
  imageHeight: number
): PixelRect | null {
  const sx = Math.max(0, Math.min(imageWidth, Math.round(rect.x * dpr)));
  const sy = Math.max(0, Math.min(imageHeight, Math.round(rect.y * dpr)));
  const sw = Math.min(imageWidth - sx, Math.round(rect.width * dpr));
  const sh = Math.min(imageHeight - sy, Math.round(rect.height * dpr));

  if (sw < 1 || sh < 1) return null;
  return { sx, sy, sw, sh };
}

/** Normalises two drag endpoints into a positive-area rect, regardless of
 *  which direction the user dragged. */
export function rectFromPoints(
  start: { x: number; y: number },
  end: { x: number; y: number }
): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}
