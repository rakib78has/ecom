import { MIN_DRAG_PX } from '../shared/constants.js';
import { rectFromPoints } from '../core/capture/geometry.js';

/**
 * Drag-to-select overlay, injected into the page on demand.
 *
 * Built as a self-contained IIFE bundle because `chrome.scripting.executeScript`
 * with `files` injects a classic script, not a module.
 */
(function mountSelectionOverlay() {
  const OVERLAY_ID = '__snapcapture_overlay';
  if (document.getElementById(OVERLAY_ID)) return; // already active

  const ACCENT = '#2563eb';
  const FONT = '-apple-system, BlinkMacSystemFont, sans-serif';
  const TOP_LAYER = '2147483647';

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: TOP_LAYER,
    cursor: 'crosshair',
    background: 'rgba(15, 23, 42, 0.25)',
  });

  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed',
    border: `1.5px dashed ${ACCENT}`,
    background: 'rgba(37, 99, 235, 0.15)',
    display: 'none',
    zIndex: TOP_LAYER,
    pointerEvents: 'none',
  });

  const label = document.createElement('div');
  Object.assign(label.style, {
    position: 'fixed',
    background: ACCENT,
    color: '#fff',
    font: `11px ${FONT}`,
    padding: '2px 6px',
    borderRadius: '4px',
    zIndex: TOP_LAYER,
    display: 'none',
    pointerEvents: 'none',
  });

  const hint = document.createElement('div');
  hint.textContent = 'Drag to select an area — Esc to cancel';
  Object.assign(hint.style, {
    position: 'fixed',
    top: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#0f172a',
    color: '#fff',
    font: `12px ${FONT}`,
    padding: '6px 12px',
    borderRadius: '6px',
    zIndex: TOP_LAYER,
    pointerEvents: 'none',
  });

  const elements = [overlay, box, label, hint];
  elements.forEach((el) => document.documentElement.appendChild(el));

  let start = { x: 0, y: 0 };
  let dragging = false;

  function cleanup(): void {
    elements.forEach((el) => el.remove());
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('blur', onWindowBlur);
  }

  function cancel(): void {
    cleanup();
    void chrome.runtime.sendMessage({ type: 'AREA_SELECTION_CANCELLED' }).catch(() => undefined);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  }

  // Leaving the window mid-drag strands the overlay on the page with no way
  // to dismiss it other than a reload.
  function onWindowBlur(): void {
    if (!dragging) cancel();
  }

  function onMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return;
    dragging = true;
    start = { x: event.clientX, y: event.clientY };
    Object.assign(box.style, {
      left: `${start.x}px`,
      top: `${start.y}px`,
      width: '0px',
      height: '0px',
      display: 'block',
    });
    label.style.display = 'block';
  }

  function onMouseMove(event: MouseEvent): void {
    if (!dragging) return;
    const rect = rectFromPoints(start, { x: event.clientX, y: event.clientY });
    Object.assign(box.style, {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    label.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    label.style.left = `${rect.x}px`;
    label.style.top = `${Math.max(0, rect.y - 20)}px`;
  }

  function onMouseUp(event: MouseEvent): void {
    if (!dragging) return;
    dragging = false;

    const rect = rectFromPoints(start, { x: event.clientX, y: event.clientY });
    cleanup();

    if (rect.width < MIN_DRAG_PX || rect.height < MIN_DRAG_PX) {
      void chrome.runtime.sendMessage({ type: 'AREA_SELECTION_CANCELLED' }).catch(() => undefined);
      return;
    }

    // Two frames, so the overlay is actually off-screen before the background
    // captures the tab — otherwise the dashed box lands in the screenshot.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void chrome.runtime
          .sendMessage({
            type: 'AREA_SELECTED',
            rect,
            dpr: window.devicePixelRatio || 1,
          })
          .catch(() => undefined);
      });
    });
  }

  overlay.addEventListener('mousedown', onMouseDown);
  overlay.addEventListener('mousemove', onMouseMove);
  overlay.addEventListener('mouseup', onMouseUp);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('blur', onWindowBlur);
})();
