'use strict';

(() => {
  if (window.__snapOCRActive) {
    // Already active on this page (e.g. the user activated Snap OCR again
    // while a previous box was still sitting there unconfirmed). Instead of
    // silently doing nothing - which left the old box/handles/toolbar
    // looking like they'd "appeared automatically" - reset it to a clean
    // drag-to-draw state.
    if (typeof window.__snapOCRReset === 'function') window.__snapOCRReset();
    return;
  }
  window.__snapOCRActive = true;

  const MIN_SIZE = 16;
  const HANDLE_SIZE = 12;

  const host = document.createElement('div');
  host.id = 'snapocr-host';
  host.style.all = 'initial';
  host.style.position = 'fixed';
  host.style.top = '0';
  host.style.left = '0';
  host.style.width = '0';
  host.style.height = '0';
  host.style.zIndex = '2147483647';

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    .overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.25);
      cursor: crosshair;
      z-index: 2147483647;
    }
    .hint {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(20, 20, 20, 0.85);
      color: #fff;
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 8px 14px;
      border-radius: 6px;
      pointer-events: none;
      white-space: nowrap;
    }
    .selection {
      position: fixed;
      border: 2px solid #2563eb;
      background: rgba(37, 99, 235, 0.12);
      box-shadow: 0 0 0 2000px rgba(0, 0, 0, 0.25);
      display: none;
    }
    .selection.adjusting {
      cursor: move;
    }
    .dims {
      position: fixed;
      background: rgba(20, 20, 20, 0.85);
      color: #fff;
      font: 11px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 2px 6px;
      border-radius: 4px;
      pointer-events: none;
      display: none;
      white-space: nowrap;
    }
    .handle {
      position: fixed;
      width: ${HANDLE_SIZE}px;
      height: ${HANDLE_SIZE}px;
      background: #fff;
      border: 2px solid #2563eb;
      border-radius: 50%;
      display: none;
      box-sizing: border-box;
    }
    .handle.nw, .handle.se { cursor: nwse-resize; }
    .handle.ne, .handle.sw { cursor: nesw-resize; }
    .handle.n, .handle.s { cursor: ns-resize; }
    .handle.e, .handle.w { cursor: ew-resize; }
    .toolbar {
      position: fixed;
      display: none;
      gap: 8px;
      background: rgba(20, 20, 20, 0.9);
      padding: 8px;
      border-radius: 8px;
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .toolbar button {
      font: inherit;
      border: none;
      border-radius: 6px;
      padding: 6px 14px;
      cursor: pointer;
    }
    .toolbar button.capture {
      background: #2563eb;
      color: #fff;
    }
    .toolbar button.recapture {
      background: #4b5563;
      color: #fff;
    }
    .toolbar button.cancel {
      background: #374151;
      color: #fff;
    }
  `;

  const overlay = document.createElement('div');
  overlay.className = 'overlay';

  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'Drag to select an area — Esc to cancel';

  const selection = document.createElement('div');
  selection.className = 'selection';

  const dims = document.createElement('div');
  dims.className = 'dims';

  const HANDLE_NAMES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const handles = {};
  HANDLE_NAMES.forEach((name) => {
    const h = document.createElement('div');
    h.className = `handle ${name}`;
    handles[name] = h;
    overlay.appendChild(h);
  });

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  const captureBtn = document.createElement('button');
  captureBtn.className = 'capture';
  captureBtn.textContent = 'Capture';
  const recaptureBtn = document.createElement('button');
  recaptureBtn.className = 'recapture';
  recaptureBtn.textContent = 'Recapture';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'cancel';
  cancelBtn.textContent = 'Cancel';
  toolbar.appendChild(captureBtn);
  toolbar.appendChild(recaptureBtn);
  toolbar.appendChild(cancelBtn);

  shadow.appendChild(style);
  shadow.appendChild(overlay);
  overlay.appendChild(hint);
  overlay.appendChild(selection);
  overlay.appendChild(dims);
  overlay.appendChild(toolbar);
  document.documentElement.appendChild(host);

  // mode: 'idle' (waiting for the first mousedown, no box yet)
  //       | 'drawing' (actively dragging out the initial box)
  //       | 'adjusting' (box exists, waiting) | 'resizing' (dragging a handle)
  //       | 'moving' (dragging the whole box)
  let mode = 'idle';
  let rect = { x: 0, y: 0, width: 0, height: 0 };
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartRect = null;
  let activeHandle = null;

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function viewportSize() {
    return { w: window.innerWidth, h: window.innerHeight };
  }

  function render() {
    const isBoxMode = mode === 'adjusting' || mode === 'resizing' || mode === 'moving';
    const hasBox = rect.width > 0 && rect.height > 0;
    selection.style.display = hasBox ? 'block' : 'none';
    selection.style.left = `${rect.x}px`;
    selection.style.top = `${rect.y}px`;
    selection.style.width = `${rect.width}px`;
    selection.style.height = `${rect.height}px`;
    selection.classList.toggle('adjusting', isBoxMode);

    const showHandles = isBoxMode && hasBox;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const half = HANDLE_SIZE / 2;
    const positions = {
      nw: [rect.x, rect.y],
      n: [cx, rect.y],
      ne: [rect.x + rect.width, rect.y],
      e: [rect.x + rect.width, cy],
      se: [rect.x + rect.width, rect.y + rect.height],
      s: [cx, rect.y + rect.height],
      sw: [rect.x, rect.y + rect.height],
      w: [rect.x, cy],
    };
    HANDLE_NAMES.forEach((name) => {
      const h = handles[name];
      h.style.display = showHandles ? 'block' : 'none';
      const [px, py] = positions[name];
      h.style.left = `${px - half}px`;
      h.style.top = `${py - half}px`;
    });

    if (hasBox) {
      dims.style.display = 'block';
      dims.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
      const { w: vw } = viewportSize();
      let dimsLeft = rect.x;
      let dimsTop = rect.y - 22;
      if (dimsTop < 0) dimsTop = rect.y + rect.height + 6;
      dimsLeft = clamp(dimsLeft, 4, vw - 4);
      dims.style.left = `${dimsLeft}px`;
      dims.style.top = `${dimsTop}px`;
    } else {
      dims.style.display = 'none';
    }

    if (mode === 'adjusting') {
      toolbar.style.display = 'flex';
      const { w: vw, h: vh } = viewportSize();
      let top = rect.y + rect.height + 10;
      let left = clamp(rect.x, 8, Math.max(8, vw - 260));
      if (top > vh - 50) top = Math.max(8, rect.y - 46);
      toolbar.style.left = `${left}px`;
      toolbar.style.top = `${top}px`;
    } else {
      toolbar.style.display = 'none';
    }

    hint.textContent = isBoxMode
      ? 'Drag corners/edges to resize, drag the box to move — Enter to capture, Esc to cancel'
      : 'Drag to select an area — Esc to cancel';
  }

  function resetSelection() {
    mode = 'idle';
    activeHandle = null;
    dragStartRect = null;
    rect = { x: 0, y: 0, width: 0, height: 0 };
    render();
  }

  function cleanup() {
    window.__snapOCRActive = false;
    window.__snapOCRReset = undefined;
    document.removeEventListener('keydown', onKeyDown, true);
    if (host.parentNode) host.parentNode.removeChild(host);
  }

  function confirmCapture() {
    if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) return;
    const finalRect = { ...rect };
    cleanup();
    chrome.runtime.sendMessage({
      type: 'SNAPOCR_REGION_SELECTED',
      rect: finalRect,
      devicePixelRatio: window.devicePixelRatio || 1,
    });
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      cleanup();
    } else if (e.key === 'Enter' && mode === 'adjusting') {
      confirmCapture();
    }
  }

  function startDrawing(e) {
    mode = 'drawing';
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    rect = { x: dragStartX, y: dragStartY, width: 0, height: 0 };
    render();
  }

  function onOverlayMouseDown(e) {
    if (e.button !== 0) return; // left mouse button only
    // Selection box and handles stopPropagation on their own mousedown, so
    // reaching here means the click was on the backdrop - start a fresh box.
    startDrawing(e);
    e.preventDefault();
  }

  function onHandleMouseDown(handleName, e) {
    if (e.button !== 0) return;
    mode = 'resizing';
    activeHandle = handleName;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartRect = { ...rect };
    e.preventDefault();
    e.stopPropagation();
  }

  function onSelectionMouseDown(e) {
    if (e.button !== 0) return;
    if (mode !== 'adjusting') return;
    mode = 'moving';
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartRect = { ...rect };
    e.preventDefault();
    e.stopPropagation();
  }

  function onDocumentMouseMove(e) {
    const { w: vw, h: vh } = viewportSize();

    if (mode === 'drawing') {
      const x = Math.min(dragStartX, e.clientX);
      const y = Math.min(dragStartY, e.clientY);
      const width = Math.abs(e.clientX - dragStartX);
      const height = Math.abs(e.clientY - dragStartY);
      rect = { x, y, width, height };
      render();
      return;
    }

    if (mode === 'resizing') {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      let left = dragStartRect.x;
      let top = dragStartRect.y;
      let right = dragStartRect.x + dragStartRect.width;
      let bottom = dragStartRect.y + dragStartRect.height;

      if (activeHandle.includes('w')) left = clamp(dragStartRect.x + dx, 0, right - MIN_SIZE);
      if (activeHandle.includes('e')) right = clamp(right + dx, left + MIN_SIZE, vw);
      if (activeHandle.includes('n')) top = clamp(dragStartRect.y + dy, 0, bottom - MIN_SIZE);
      if (activeHandle.includes('s')) bottom = clamp(bottom + dy, top + MIN_SIZE, vh);

      rect = { x: left, y: top, width: right - left, height: bottom - top };
      render();
      return;
    }

    if (mode === 'moving') {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      const x = clamp(dragStartRect.x + dx, 0, Math.max(0, vw - dragStartRect.width));
      const y = clamp(dragStartRect.y + dy, 0, Math.max(0, vh - dragStartRect.height));
      rect = { ...rect, x, y };
      render();
    }
  }

  function onDocumentMouseUp() {
    if (mode === 'drawing') {
      if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) {
        mode = 'idle';
        rect = { x: 0, y: 0, width: 0, height: 0 };
        render();
        return;
      }
      mode = 'adjusting';
      render();
    } else if (mode === 'resizing' || mode === 'moving') {
      mode = 'adjusting';
      activeHandle = null;
      dragStartRect = null;
      render();
    }
  }

  overlay.addEventListener('mousedown', onOverlayMouseDown);
  selection.addEventListener('mousedown', onSelectionMouseDown);
  HANDLE_NAMES.forEach((name) => {
    handles[name].addEventListener('mousedown', (e) => onHandleMouseDown(name, e));
  });
  document.addEventListener('mousemove', onDocumentMouseMove);
  document.addEventListener('mouseup', onDocumentMouseUp);
  document.addEventListener('keydown', onKeyDown, true);

  toolbar.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  captureBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  captureBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); confirmCapture(); });
  recaptureBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  recaptureBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); resetSelection(); });
  cancelBtn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  cancelBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); cleanup(); });

  window.__snapOCRReset = resetSelection;

  render();
})();
