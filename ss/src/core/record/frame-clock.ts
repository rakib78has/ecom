/**
 * Drives the recorder's compositing loop.
 *
 * `requestAnimationFrame` stops firing entirely while a page is hidden. The
 * recorder composites every frame into a canvas and records that canvas, so
 * an rAF-driven loop silently freezes the moment the user switches tabs — and
 * switching away is the normal case, since the feature exists to record
 * *another* window or screen. The timer keeps counting and the UI still says
 * "recording", so the failure is invisible until playback.
 *
 * `requestVideoFrameCallback` on the source <video> is tied to the media
 * pipeline rather than the page's render loop, so it keeps delivering frames
 * while hidden. `setInterval` is the fallback; background throttling clamps
 * it to roughly 1 Hz in a hidden tab, which is degraded but not frozen, so
 * the recording still shows motion.
 */

export interface FrameClock {
  stop(): void;
  /** Which mechanism is driving frames — surfaced so the UI can warn when it
   *  has fallen back to the throttled path. */
  readonly kind: 'video-frame-callback' | 'interval';
}

/** `requestVideoFrameCallback` is widely supported but not universal, so the
 *  interval fallback has to stay. */
function supportsVideoFrameCallback(video: HTMLVideoElement): boolean {
  return typeof video.requestVideoFrameCallback === 'function';
}

/**
 * Calls `onFrame` for each new frame of `video` until `stop()` is called.
 *
 * @param fallbackFps Frame rate for the interval fallback.
 */
export function startFrameClock(
  video: HTMLVideoElement,
  onFrame: () => void,
  fallbackFps = 30
): FrameClock {
  let stopped = false;

  if (supportsVideoFrameCallback(video)) {
    let handle = 0;
    const tick = () => {
      if (stopped) return;
      onFrame();
      handle = video.requestVideoFrameCallback(tick);
    };
    handle = video.requestVideoFrameCallback(tick);

    return {
      kind: 'video-frame-callback',
      stop() {
        stopped = true;
        video.cancelVideoFrameCallback(handle);
      },
    };
  }

  const interval = setInterval(
    () => {
      if (stopped) return;
      onFrame();
    },
    Math.round(1000 / fallbackFps)
  );

  return {
    kind: 'interval',
    stop() {
      stopped = true;
      clearInterval(interval);
    },
  };
}

/** Picks the best container/codec the browser will actually record. */
export function pickSupportedMimeType(
  isSupported: (type: string) => boolean = (t) => MediaRecorder.isTypeSupported(t)
): string {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return candidates.find(isSupported) ?? '';
}

/** Formats elapsed milliseconds as MM:SS, or HH:MM:SS past an hour. */
export function formatDuration(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}
