import { describe, expect, it } from 'vitest';
import {
  clampDelaySeconds,
  isValidDpr,
  isValidRect,
  parseMessage,
} from '../../src/shared/messages.js';

describe('isValidRect', () => {
  it('accepts a normal selection', () => {
    expect(isValidRect({ x: 10, y: 20, width: 100, height: 50 })).toBe(true);
  });

  it('accepts a selection anchored at the origin', () => {
    expect(isValidRect({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
  });

  // --- BUG-007 regression --------------------------------------------------
  // These values previously flowed straight into `new OffscreenCanvas(w, h)`
  // and surfaced as an opaque allocation failure rather than a clear error.
  describe('regression: rejects values that would break canvas allocation (BUG-007)', () => {
    it.each([
      ['NaN width', { x: 0, y: 0, width: Number.NaN, height: 10 }],
      ['Infinite height', { x: 0, y: 0, width: 10, height: Number.POSITIVE_INFINITY }],
      ['negative origin', { x: -5, y: 0, width: 10, height: 10 }],
      ['zero width', { x: 0, y: 0, width: 0, height: 10 }],
      ['negative height', { x: 0, y: 0, width: 10, height: -10 }],
      ['absurd width', { x: 0, y: 0, width: 1e9, height: 10 }],
      ['string dimensions', { x: '0', y: '0', width: '10', height: '10' }],
      ['missing fields', { x: 0, y: 0 }],
      ['null', null],
      ['array', []],
      ['string', 'not a rect'],
    ])('rejects %s', (_label, value) => {
      expect(isValidRect(value)).toBe(false);
    });
  });
});

describe('isValidDpr', () => {
  it.each([1, 1.5, 2, 3])('accepts a realistic ratio of %s', (value) => {
    expect(isValidDpr(value)).toBe(true);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 100, '2', null, undefined])(
    'rejects %s',
    (value) => {
      expect(isValidDpr(value)).toBe(false);
    }
  );
});

describe('parseMessage', () => {
  it.each([
    'CAPTURE_VISIBLE',
    'CAPTURE_FULL_PAGE',
    'START_AREA_SELECTION',
    'AREA_SELECTION_CANCELLED',
  ])('accepts the parameterless message %s', (type) => {
    expect(parseMessage({ type })).toEqual({ type });
  });

  it('accepts a well-formed AREA_SELECTED message', () => {
    const message = {
      type: 'AREA_SELECTED',
      rect: { x: 1, y: 2, width: 3, height: 4 },
      dpr: 2,
    };
    expect(parseMessage(message)).toEqual(message);
  });

  it('rejects AREA_SELECTED carrying a malformed rect', () => {
    expect(
      parseMessage({ type: 'AREA_SELECTED', rect: { x: 0, y: 0, width: -1, height: 4 }, dpr: 2 })
    ).toBeNull();
  });

  it('rejects AREA_SELECTED carrying an implausible device pixel ratio', () => {
    expect(
      parseMessage({ type: 'AREA_SELECTED', rect: { x: 0, y: 0, width: 4, height: 4 }, dpr: 0 })
    ).toBeNull();
  });

  it('requires a non-empty capture id', () => {
    expect(parseMessage({ type: 'FETCH_CAPTURE', captureId: 'abc' })).toEqual({
      type: 'FETCH_CAPTURE',
      captureId: 'abc',
    });
    expect(parseMessage({ type: 'FETCH_CAPTURE', captureId: '' })).toBeNull();
    expect(parseMessage({ type: 'FETCH_CAPTURE' })).toBeNull();
  });

  it.each([
    ['an unknown type', { type: 'DROP_TABLES' }],
    ['no type at all', { payload: 1 }],
    ['null', null],
    ['a string', 'CAPTURE_VISIBLE'],
    ['a number', 42],
    ['undefined', undefined],
  ])('returns null for %s', (_label, value) => {
    expect(parseMessage(value)).toBeNull();
  });

  it('does not pass unexpected extra fields through', () => {
    const parsed = parseMessage({ type: 'CAPTURE_VISIBLE', evil: 'payload' });
    expect(parsed).toEqual({ type: 'CAPTURE_VISIBLE' });
    expect(parsed).not.toHaveProperty('evil');
  });
});

describe('clampDelaySeconds', () => {
  it.each([
    [3, 3],
    [5, 5],
    [10, 10],
  ])('keeps the offered value %s', (input, expected) => {
    expect(clampDelaySeconds(input)).toBe(expected);
  });

  it.each([
    [0, 1],
    [-10, 1],
    [31, 30],
    [99999, 30],
  ])('clamps %s to %s', (input, expected) => {
    expect(clampDelaySeconds(input)).toBe(expected);
  });

  it('falls back to the default for non-finite input', () => {
    expect(clampDelaySeconds(Number.NaN)).toBe(5);
    expect(clampDelaySeconds(Number.POSITIVE_INFINITY)).toBe(5);
  });

  it('rounds fractional delays', () => {
    expect(clampDelaySeconds(4.6)).toBe(5);
  });
});
