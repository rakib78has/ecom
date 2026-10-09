import { MAX_CANVAS_DIMENSION, MAX_SLICES } from '../../shared/constants.js';

export interface PageMetrics {
  scrollHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  originalScrollX: number;
  originalScrollY: number;
  originalOverflow: string;
}

export interface CapturePlan {
  /** Scroll offsets (CSS px) to stop at, ascending and de-duplicated. */
  positions: number[];
  /** Height of the stitched canvas in device pixels. */
  canvasHeight: number;
  /** Page height actually covered, in CSS px. Less than `scrollHeight` when
   *  the page was too tall to capture completely. */
  capturedHeight: number;
  /** True when the page exceeded what one canvas can hold and the capture
   *  stops partway down. The UI must tell the user when this happens. */
  truncated: boolean;
}

/**
 * Decides where to scroll and how big the stitched canvas must be.
 *
 * Two hard limits apply, and the original implementation respected neither:
 *
 *   1. A canvas dimension cannot exceed `MAX_CANVAS_DIMENSION` device pixels.
 *      A 60-slice capture of a 900px viewport at dpr 2 wants 108,000px of
 *      height, well past the ceiling, and the resulting canvas is unusable.
 *
 *   2. Consecutive scroll stops must be no more than one viewport apart.
 *      Spacing them further "to reach the bottom" does not thin out coverage
 *      — each capture paints exactly one viewport, so anything beyond that
 *      stride is simply never painted and shows up as a transparent band.
 *
 * So rather than stretching a fixed slice count over the whole page, this
 * keeps a full-viewport stride and truncates honestly when the page is longer
 * than one canvas can represent.
 */
export function planFullPageCapture(metrics: PageMetrics): CapturePlan {
  const { scrollHeight, viewportHeight, devicePixelRatio: dpr } = metrics;

  if (viewportHeight <= 0 || scrollHeight <= 0 || dpr <= 0) {
    throw new RangeError('Page metrics must be positive.');
  }

  // Each stop paints exactly one viewport, so the stride can never exceed it.
  const sliceStride = viewportHeight;

  const slicesForPage = Math.ceil(scrollHeight / sliceStride);
  const slicesForCanvas = Math.max(1, Math.floor(MAX_CANVAS_DIMENSION / dpr / sliceStride));
  const sliceCount = Math.max(1, Math.min(slicesForPage, slicesForCanvas, MAX_SLICES));
  const truncated = sliceCount < slicesForPage;

  const maxScroll = Math.max(0, scrollHeight - viewportHeight);
  const positions: number[] = [];
  for (let i = 0; i < sliceCount; i++) {
    const y = Math.min(maxScroll, Math.round(i * sliceStride));
    if (positions.length === 0 || positions[positions.length - 1] !== y) {
      positions.push(y);
    }
  }

  // The last slice paints from its scroll offset down a full viewport, which
  // is what bounds the canvas — not `scrollHeight`, which overshoots once the
  // capture is truncated and would leave empty space at the bottom.
  const lastPosition = positions[positions.length - 1];
  const capturedHeight = Math.min(scrollHeight, lastPosition + viewportHeight);

  return {
    positions,
    canvasHeight: Math.round(capturedHeight * dpr),
    capturedHeight,
    truncated,
  };
}
