import { vi } from 'vitest';
import type { DrawingContext } from '../../src/core/annotate/render.js';

export interface RecordedCall {
  method: string;
  args: unknown[];
}

export interface RecordingContext {
  ctx: DrawingContext;
  calls: RecordedCall[];
  /** Every call to the named method, in order. */
  callsTo(method: string): RecordedCall[];
  /** Property values captured at the moment each draw call was made, so a
   *  test can assert on the colour a shape was actually painted with rather
   *  than on whatever the final state happened to be. */
  stateAt(method: string): Array<Record<string, unknown>>;
}

const TRACKED_PROPERTIES = [
  'strokeStyle',
  'fillStyle',
  'lineWidth',
  'globalAlpha',
  'font',
  'textBaseline',
  'imageSmoothingEnabled',
] as const;

const DRAW_METHODS = [
  'beginPath',
  'closePath',
  'moveTo',
  'lineTo',
  'stroke',
  'fill',
  'strokeRect',
  'fillRect',
  'clearRect',
  'ellipse',
  'fillText',
  'drawImage',
  'setLineDash',
  'save',
  'restore',
] as const;

/**
 * A canvas 2D context that records what was drawn instead of rasterising it.
 *
 * Node has no canvas, and installing one purely to assert that an arrow has
 * three line segments would add a native dependency to a project that
 * otherwise has none. Recording the call sequence tests the drawing logic —
 * which is what can actually be wrong — without that cost.
 */
export function createRecordingContext(): RecordingContext {
  const calls: RecordedCall[] = [];
  const stateByCall: Array<Record<string, unknown>> = [];

  const state: Record<string, unknown> = {
    strokeStyle: '#000000',
    fillStyle: '#000000',
    lineWidth: 1,
    globalAlpha: 1,
    font: '10px sans-serif',
    textBaseline: 'alphabetic',
    imageSmoothingEnabled: true,
    lineJoin: 'miter',
    lineCap: 'butt',
  };

  const target: Record<string, unknown> = { ...state };

  for (const method of DRAW_METHODS) {
    target[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args });
      stateByCall.push(Object.fromEntries(TRACKED_PROPERTIES.map((p) => [p, target[p]])));
    });
  }

  const ctx = target as unknown as DrawingContext;

  return {
    ctx,
    calls,
    callsTo: (method) => calls.filter((call) => call.method === method),
    stateAt: (method) => stateByCall.filter((_, index) => calls[index]?.method === method),
  };
}

/** Minimal scratch surface for the pixelation path. */
export function createScratch() {
  const recording = createRecordingContext();
  return {
    canvas: { width: 0, height: 0 } as HTMLCanvasElement,
    ctx: recording.ctx,
    recording,
  };
}
