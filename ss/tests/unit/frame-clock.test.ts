import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatDuration,
  pickSupportedMimeType,
  startFrameClock,
} from '../../src/core/record/frame-clock.js';

/** Stands in for a <video> that supports requestVideoFrameCallback. */
function videoWithFrameCallback() {
  const callbacks = new Map<number, (now: number) => void>();
  let nextHandle = 1;

  return {
    element: {
      requestVideoFrameCallback: vi.fn((callback: (now: number) => void) => {
        const handle = nextHandle++;
        callbacks.set(handle, callback);
        return handle;
      }),
      cancelVideoFrameCallback: vi.fn((handle: number) => callbacks.delete(handle)),
    } as unknown as HTMLVideoElement,
    /** Delivers one frame to whichever callback is currently registered. */
    emitFrame() {
      const [handle, callback] = [...callbacks.entries()].pop() ?? [];
      if (handle === undefined || !callback) return false;
      callbacks.delete(handle);
      callback(performance.now());
      return true;
    },
    get pending() {
      return callbacks.size;
    },
  };
}

function videoWithoutFrameCallback(): HTMLVideoElement {
  return {} as HTMLVideoElement;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('startFrameClock', () => {
  // --- BUG-004 regression --------------------------------------------------
  // The recorder composites each frame into a canvas and records that canvas.
  // requestAnimationFrame stops firing entirely while a page is hidden, so an
  // rAF-driven loop froze the recording the moment the user switched tabs —
  // which is the normal case, since the feature exists to record *another*
  // window. The timer kept counting and the UI still said "recording".
  describe('regression: does not depend on page visibility (BUG-004)', () => {
    it('drives frames from the video pipeline when available', () => {
      const video = videoWithFrameCallback();
      const onFrame = vi.fn();

      const clock = startFrameClock(video.element, onFrame);

      expect(clock.kind).toBe('video-frame-callback');
      expect(video.element.requestVideoFrameCallback).toHaveBeenCalled();
      clock.stop();
    });

    it('never calls requestAnimationFrame', () => {
      const rafSpy = vi.fn();
      vi.stubGlobal('requestAnimationFrame', rafSpy);

      const video = videoWithFrameCallback();
      const clock = startFrameClock(video.element, vi.fn());
      video.emitFrame();
      video.emitFrame();

      expect(rafSpy).not.toHaveBeenCalled();
      clock.stop();
      vi.unstubAllGlobals();
    });

    it('keeps requesting frames for as long as it runs', () => {
      const video = videoWithFrameCallback();
      const onFrame = vi.fn();
      const clock = startFrameClock(video.element, onFrame);

      video.emitFrame();
      video.emitFrame();
      video.emitFrame();

      expect(onFrame).toHaveBeenCalledTimes(3);
      expect(video.pending).toBe(1); // still armed for the next frame
      clock.stop();
    });

    it('falls back to an interval when the video pipeline hook is missing', () => {
      vi.useFakeTimers();
      const onFrame = vi.fn();

      const clock = startFrameClock(videoWithoutFrameCallback(), onFrame, 30);

      expect(clock.kind).toBe('interval');
      vi.advanceTimersByTime(100);
      expect(onFrame).toHaveBeenCalled();
      clock.stop();
    });

    it('reports which mechanism is driving it so the UI can warn', () => {
      vi.useFakeTimers();
      const fallback = startFrameClock(videoWithoutFrameCallback(), vi.fn());
      expect(fallback.kind).toBe('interval');
      fallback.stop();

      const video = videoWithFrameCallback();
      const preferred = startFrameClock(video.element, vi.fn());
      expect(preferred.kind).toBe('video-frame-callback');
      preferred.stop();
    });
  });

  describe('stop', () => {
    it('stops delivering frames after stop()', () => {
      const video = videoWithFrameCallback();
      const onFrame = vi.fn();
      const clock = startFrameClock(video.element, onFrame);

      video.emitFrame();
      expect(onFrame).toHaveBeenCalledTimes(1);

      clock.stop();
      video.emitFrame();

      expect(onFrame).toHaveBeenCalledTimes(1);
    });

    it('cancels the outstanding frame request', () => {
      const video = videoWithFrameCallback();
      const clock = startFrameClock(video.element, vi.fn());

      clock.stop();

      expect(video.element.cancelVideoFrameCallback).toHaveBeenCalled();
    });

    it('stops the interval fallback', () => {
      vi.useFakeTimers();
      const onFrame = vi.fn();
      const clock = startFrameClock(videoWithoutFrameCallback(), onFrame, 30);

      vi.advanceTimersByTime(100);
      const callsBefore = onFrame.mock.calls.length;
      clock.stop();
      vi.advanceTimersByTime(1000);

      expect(onFrame).toHaveBeenCalledTimes(callsBefore);
    });

    it('is safe to call twice', () => {
      const video = videoWithFrameCallback();
      const clock = startFrameClock(video.element, vi.fn());

      expect(() => {
        clock.stop();
        clock.stop();
      }).not.toThrow();
    });
  });
});

describe('pickSupportedMimeType', () => {
  it('prefers VP9 when available', () => {
    expect(pickSupportedMimeType(() => true)).toBe('video/webm;codecs=vp9,opus');
  });

  it('falls back to VP8 when VP9 is unsupported', () => {
    const supported = (type: string) => !type.includes('vp9');
    expect(pickSupportedMimeType(supported)).toBe('video/webm;codecs=vp8,opus');
  });

  it('falls back to plain WebM when no codec is listed', () => {
    const supported = (type: string) => type === 'video/webm';
    expect(pickSupportedMimeType(supported)).toBe('video/webm');
  });

  it('returns an empty string so MediaRecorder can pick its own default', () => {
    expect(pickSupportedMimeType(() => false)).toBe('');
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '00:00'],
    [999, '00:00'],
    [1000, '00:01'],
    [59_000, '00:59'],
    [60_000, '01:00'],
    [599_000, '09:59'],
    [3_599_000, '59:59'],
  ])('formats %sms as %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it('switches to hours past the hour mark', () => {
    expect(formatDuration(3_600_000)).toBe('01:00:00');
    expect(formatDuration(3_661_000)).toBe('01:01:01');
  });

  it('never renders a negative duration from a clock adjustment', () => {
    expect(formatDuration(-5000)).toBe('00:00');
  });
});
