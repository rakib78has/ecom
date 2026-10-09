/**
 * Functions injected into the inspected page via `chrome.scripting`.
 *
 * Each must be entirely self-contained: they are serialised and re-evaluated
 * in the page's isolated world, so they cannot reference imports, module
 * scope, or any value that is not passed through `args`.
 */

import type { PageMetrics } from '../core/capture/full-page-plan.js';

export function pageGetMetrics(): PageMetrics {
  const doc = document.documentElement;
  const body = document.body;
  return {
    scrollHeight: Math.max(doc.scrollHeight, body ? body.scrollHeight : 0),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    originalScrollX: window.scrollX,
    originalScrollY: window.scrollY,
    originalOverflow: doc.style.overflow,
  };
}

/** Hides the scrollbar so it does not appear in every stitched slice. */
export function pagePrepare(): void {
  document.documentElement.style.overflow = 'hidden';
}

export function pageScrollTo(y: number): void {
  window.scrollTo(0, y);
}

/**
 * Hides fixed and sticky elements so headers and cookie banners do not repeat
 * down the stitched image.
 *
 * Re-run before every slice rather than once: pages add sticky elements as
 * the user scrolls (lazy-mounted toolbars, scroll-triggered banners), and a
 * single pass at the start misses all of them.
 */
export function pageHideFixedElements(): void {
  document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
    if (el.dataset.snapcaptureHidden) return;
    const position = window.getComputedStyle(el).position;
    if (position === 'fixed' || position === 'sticky') {
      el.dataset.snapcaptureHidden = '1';
      el.dataset.snapcaptureOldVisibility = el.style.visibility;
      el.style.visibility = 'hidden';
    }
  });
}

export function pageRestore(scrollX: number, scrollY: number, overflow: string): void {
  document.querySelectorAll<HTMLElement>('[data-snapcapture-hidden]').forEach((el) => {
    el.style.visibility = el.dataset.snapcaptureOldVisibility || '';
    delete el.dataset.snapcaptureHidden;
    delete el.dataset.snapcaptureOldVisibility;
  });
  document.documentElement.style.overflow = overflow || '';
  window.scrollTo(scrollX, scrollY);
}

export function pageShowCountdown(seconds: number): void {
  const id = '__snapcapture_countdown';
  document.getElementById(id)?.remove();

  const el = document.createElement('div');
  el.id = id;
  el.setAttribute('role', 'status');
  Object.assign(el.style, {
    position: 'fixed',
    top: '16px',
    right: '16px',
    zIndex: '2147483647',
    background: '#0f172a',
    color: '#fff',
    font: '13px -apple-system, BlinkMacSystemFont, sans-serif',
    padding: '8px 14px',
    borderRadius: '20px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
    pointerEvents: 'none',
  });
  document.documentElement.appendChild(el);

  let remaining = seconds;
  el.textContent = `Capturing in ${remaining}…`;
  const interval = window.setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      window.clearInterval(interval);
      el.remove();
      return;
    }
    el.textContent = `Capturing in ${remaining}…`;
  }, 1000);

  // Stash the handle so the capture can cancel the countdown if it is torn
  // down early; otherwise the interval outlives the element it updates.
  (window as unknown as Record<string, number>).__snapcaptureCountdownInterval = interval;
}

export function pageRemoveCountdown(): void {
  const handle = (window as unknown as Record<string, number | undefined>)
    .__snapcaptureCountdownInterval;
  if (typeof handle === 'number') {
    window.clearInterval(handle);
    delete (window as unknown as Record<string, number | undefined>).__snapcaptureCountdownInterval;
  }
  document.getElementById('__snapcapture_countdown')?.remove();
}
