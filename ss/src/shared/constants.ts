/** Shared tuning constants. Kept separate from logic so tests can reason about
 *  them directly and so a single edit changes every call site. */

/** Chrome rate-limits `tabs.captureVisibleTab` to roughly 2 calls/second.
 *  Staying above this gap avoids MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND. */
export const MIN_CAPTURE_GAP_MS = 750;

/** Time allowed after a scroll for repaint and lazy-loaded content. */
export const SETTLE_DELAY_MS = 300;

/** Chrome's hard ceiling on a single canvas dimension. Exceeding it yields an
 *  unusable (blank or allocation-failed) canvas rather than an exception, so
 *  slice planning must stay under it explicitly. */
export const MAX_CANVAS_DIMENSION = 65535;

/** Absolute cap on slices for a pathological / infinite-scroll page, applied
 *  on top of the canvas-height limit. */
export const MAX_SLICES = 60;

/** Minimum drag distance (CSS px) before a drag counts as a selection rather
 *  than a stray click. */
export const MIN_DRAG_PX = 4;

/** Annotation stroke width in canvas pixels. */
export const STROKE_WIDTH = 4;
export const HIGHLIGHT_ALPHA = 0.4;
export const PIXELATE_BLOCK = 14;
export const TEXT_FONT_SIZE = 28;
export const TEXT_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, sans-serif';

/** How long an unclaimed capture stays in the handoff store before the
 *  startup sweep discards it. */
export const CAPTURE_TTL_MS = 5 * 60 * 1000;

export const EXPORT_FORMATS = ['png', 'jpg', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const JPEG_QUALITY = 0.92;

export const ANNOTATION_COLORS = [
  { value: '#ef4444', label: 'Red' },
  { value: '#2563eb', label: 'Blue' },
  { value: '#facc15', label: 'Yellow' },
  { value: '#22c55e', label: 'Green' },
  { value: '#0f172a', label: 'Black' },
] as const;
