/**
 * The contract between the popup, the injected selection overlay, the editor
 * page and the service worker.
 *
 * Every message that crosses a trust boundary is validated at runtime, not
 * just typed. `chrome.runtime.onMessage` cannot be reached by page scripts
 * (there is no `externally_connectable` entry in the manifest), but the
 * selection overlay runs inside an arbitrary web page's tab, and a malformed
 * or hostile payload from there must not reach canvas-sizing arithmetic — a
 * NaN or negative rect produces an opaque allocation failure rather than a
 * clean error.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Message =
  | { type: 'CAPTURE_VISIBLE' }
  | { type: 'CAPTURE_FULL_PAGE' }
  | { type: 'START_AREA_SELECTION' }
  | { type: 'START_DELAYED_CAPTURE'; delaySeconds: number }
  | { type: 'AREA_SELECTED'; rect: Rect; dpr: number }
  | { type: 'AREA_SELECTION_CANCELLED' }
  | { type: 'FETCH_CAPTURE'; captureId: string }
  | { type: 'FULL_PAGE_PROGRESS'; current: number; total: number };

export type MessageType = Message['type'];

/** A response to a request-style message. Never throws across the boundary —
 *  failures travel as data so the sender can show them. */
export type Response<T = undefined> =
  ({ ok: true } & (T extends undefined ? object : T)) | { ok: false; error: string };

export interface FetchCaptureResult {
  dataUrl: string;
}

/** Upper bound on a sane capture rect, generous enough for an 8K display at
 *  a 3x device pixel ratio. Anything larger is a bug or an attack. */
const MAX_DIMENSION_CSS_PX = 32_767;
const MAX_DPR = 8;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isValidRect(value: unknown): value is Rect {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  if (!isFiniteNumber(r.x) || !isFiniteNumber(r.y)) return false;
  if (!isFiniteNumber(r.width) || !isFiniteNumber(r.height)) return false;
  if (r.x < 0 || r.y < 0) return false;
  if (r.width <= 0 || r.height <= 0) return false;
  if (r.width > MAX_DIMENSION_CSS_PX || r.height > MAX_DIMENSION_CSS_PX) return false;
  if (r.x > MAX_DIMENSION_CSS_PX || r.y > MAX_DIMENSION_CSS_PX) return false;
  return true;
}

export function isValidDpr(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0 && value <= MAX_DPR;
}

/** Narrows an untrusted `onMessage` payload to a known message shape.
 *  Returns null for anything unrecognised so the router can ignore it. */
export function parseMessage(value: unknown): Message | null {
  if (typeof value !== 'object' || value === null) return null;
  const m = value as Record<string, unknown>;

  switch (m.type) {
    case 'CAPTURE_VISIBLE':
    case 'CAPTURE_FULL_PAGE':
    case 'START_AREA_SELECTION':
    case 'AREA_SELECTION_CANCELLED':
      return { type: m.type };

    case 'START_DELAYED_CAPTURE':
      return isFiniteNumber(m.delaySeconds)
        ? { type: 'START_DELAYED_CAPTURE', delaySeconds: m.delaySeconds }
        : null;

    case 'AREA_SELECTED':
      return isValidRect(m.rect) && isValidDpr(m.dpr)
        ? { type: 'AREA_SELECTED', rect: m.rect, dpr: m.dpr }
        : null;

    case 'FETCH_CAPTURE':
      return typeof m.captureId === 'string' && m.captureId.length > 0
        ? { type: 'FETCH_CAPTURE', captureId: m.captureId }
        : null;

    case 'FULL_PAGE_PROGRESS':
      return isFiniteNumber(m.current) && isFiniteNumber(m.total)
        ? { type: 'FULL_PAGE_PROGRESS', current: m.current, total: m.total }
        : null;

    default:
      return null;
  }
}

/** Clamps a requested capture delay into the range the UI offers. */
export function clampDelaySeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return 5;
  return Math.max(1, Math.min(30, Math.round(seconds)));
}
