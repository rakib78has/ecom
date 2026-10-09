import { AnnotationHistory } from '../core/annotate/history.js';
import { onAsync } from '../shared/async-handler.js';
import { drawSelectionPreview, drawShape } from '../core/annotate/render.js';
import { isShapeTool, type Annotation, type Point, type Tool } from '../core/annotate/types.js';
import { rectFromPoints } from '../core/capture/geometry.js';
import { timestampedFilename } from '../core/export/filename.js';
import { buildPdfBytes } from '../core/export/pdf.js';
import { downloadBlob } from '../infra/downloads.js';
import { isExportFormat, readPreferredFormat, writePreferredFormat } from '../infra/settings.js';
import {
  ANNOTATION_COLORS,
  JPEG_QUALITY,
  MIN_DRAG_PX,
  TEXT_FONT_FAMILY,
  TEXT_FONT_SIZE,
  type ExportFormat,
} from '../shared/constants.js';
import { CanvasRenderer } from './canvas-renderer.js';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const statusEl = document.getElementById('status') as HTMLElement;
const toolbar = document.getElementById('toolbar') as HTMLElement;
const undoBtn = document.getElementById('undo-btn') as HTMLButtonElement;
const redoBtn = document.getElementById('redo-btn') as HTMLButtonElement;
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
const downloadBtn = document.getElementById('download-btn') as HTMLButtonElement;
const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
const formatSelect = document.getElementById('format-select') as HTMLSelectElement;
const colorGroup = document.querySelector('.color-group') as HTMLElement;
const toolButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.tool-btn'));

const history = new AnnotationHistory();

let renderer: CanvasRenderer | null = null;
let currentTool: Tool = 'arrow';
let currentColor: string = ANNOTATION_COLORS[0].value;
let dragStart: Point | null = null;
let pendingCrop: { x: number; y: number; width: number; height: number } | null = null;
let pendingTextInput: { element: HTMLInputElement; position: Point } | null = null;

function setStatus(message: string): void {
  statusEl.textContent = message;
}

function rerender(): void {
  renderer?.render(history.annotations);
  undoBtn.disabled = !history.canUndo;
  redoBtn.disabled = !history.canRedo;
}

function commit(annotation: Annotation): void {
  history.push(annotation);
  rerender();
}

// --- Colour swatches -------------------------------------------------------
// Built in script rather than markup so each one carries a real accessible
// name; the original empty button elements announced as "button" only.

for (const { value, label } of ANNOTATION_COLORS) {
  const button = document.createElement('button');
  button.className = 'color-btn';
  button.dataset.color = value;
  button.style.setProperty('--swatch', value);
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(value === currentColor));
  if (value === currentColor) button.classList.add('active');

  button.addEventListener('click', () => {
    currentColor = value;
    colorGroup.querySelectorAll<HTMLButtonElement>('.color-btn').forEach((other) => {
      const selected = other === button;
      other.classList.toggle('active', selected);
      other.setAttribute('aria-pressed', String(selected));
    });
  });

  colorGroup.appendChild(button);
}

// --- Capture handoff -------------------------------------------------------

async function loadCapture(): Promise<ImageBitmap | null> {
  const captureId = new URLSearchParams(location.search).get('cid');
  if (!captureId) return null;

  const response = await chrome.runtime.sendMessage<
    object,
    { ok: true; dataUrl: string } | { ok: false; error: string } | undefined
  >({ type: 'FETCH_CAPTURE', captureId });

  if (!response?.ok) return null;

  const blob = await (await fetch(response.dataUrl)).blob();
  return createImageBitmap(blob);
}

// --- Tool selection --------------------------------------------------------

function selectTool(tool: Tool): void {
  commitPendingText();
  if (tool !== 'crop') cancelPendingCrop();

  currentTool = tool;
  toolButtons.forEach((button) => {
    const selected = button.dataset.tool === tool;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

toolButtons.forEach((button) => {
  button.addEventListener('click', () => selectTool(button.dataset.tool as Tool));
});

// --- Text tool -------------------------------------------------------------

function cancelPendingText(): void {
  pendingTextInput?.element.remove();
  pendingTextInput = null;
}

function commitPendingText(): void {
  if (!pendingTextInput) return;
  const { element, position } = pendingTextInput;
  pendingTextInput = null;

  const text = element.value.trim();
  element.remove();
  if (!text) return;

  commit({ kind: 'text', color: currentColor, position, text });
}

function startTextInput(position: Point): void {
  commitPendingText();

  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / canvas.width;
  const scaleY = rect.height / canvas.height;

  const input = document.createElement('input');
  input.type = 'text';
  input.setAttribute('aria-label', 'Annotation text');
  Object.assign(input.style, {
    position: 'fixed',
    left: `${rect.left + position.x * scaleX}px`,
    top: `${rect.top + position.y * scaleY}px`,
    font: `${TEXT_FONT_SIZE * scaleY}px ${TEXT_FONT_FAMILY}`,
    color: currentColor,
    background: 'rgba(255, 255, 255, 0.92)',
    border: '1px dashed #2563eb',
    padding: '1px 4px',
    zIndex: '20',
    minWidth: '140px',
  });

  document.body.appendChild(input);
  pendingTextInput = { element: input, position };
  input.focus();

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitPendingText();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelPendingText();
    }
  });
  input.addEventListener('blur', () => commitPendingText());
}

// --- Crop tool -------------------------------------------------------------

function removeCropUi(): void {
  document.getElementById('crop-overlay')?.remove();
  document.getElementById('crop-controls')?.remove();
}

function cancelPendingCrop(): void {
  if (!pendingCrop) return;
  pendingCrop = null;
  removeCropUi();
  rerender();
}

function applyPendingCrop(): void {
  if (!pendingCrop) return;
  const crop = pendingCrop;
  pendingCrop = null;
  removeCropUi();
  commit({ kind: 'crop', ...crop });
}

function showCropUi(crop: { x: number; y: number; width: number; height: number }): void {
  removeCropUi();
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / canvas.width;
  const scaleY = rect.height / canvas.height;

  const overlay = document.createElement('div');
  overlay.id = 'crop-overlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    left: `${rect.left + crop.x * scaleX}px`,
    top: `${rect.top + crop.y * scaleY}px`,
    width: `${crop.width * scaleX}px`,
    height: `${crop.height * scaleY}px`,
    border: '2px dashed #2563eb',
    background: 'rgba(37, 99, 235, 0.08)',
    pointerEvents: 'none',
    zIndex: '10',
  });
  document.body.appendChild(overlay);

  const controls = document.createElement('div');
  controls.id = 'crop-controls';
  Object.assign(controls.style, {
    position: 'fixed',
    left: `${rect.left + crop.x * scaleX}px`,
    top: `${rect.top + (crop.y + crop.height) * scaleY + 8}px`,
    display: 'flex',
    gap: '6px',
    zIndex: '11',
  });

  const apply = document.createElement('button');
  apply.textContent = 'Apply Crop';
  apply.className = 'primary';
  apply.addEventListener('click', applyPendingCrop);

  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', cancelPendingCrop);

  controls.append(apply, cancel);
  document.body.appendChild(controls);
  apply.focus();
}

// --- Pointer interaction ---------------------------------------------------

function canvasPosition(event: MouseEvent): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height),
  };
}

canvas.addEventListener('mousedown', (event) => {
  // A canvas is not focusable, so the default mousedown behaviour moves focus
  // to body - which would immediately blur and discard a text input that was
  // only just created.
  event.preventDefault();
  if (pendingCrop) return; // waiting on Apply / Cancel

  const position = canvasPosition(event);
  if (currentTool === 'text') {
    startTextInput(position);
    return;
  }
  dragStart = position;
});

canvas.addEventListener('mousemove', (event) => {
  const start = dragStart;
  if (!start || !renderer) return;
  const position = canvasPosition(event);

  rerender();
  renderer.preview((ctx) => {
    if (currentTool === 'crop' || currentTool === 'blur') {
      drawSelectionPreview(ctx, start, position, currentTool);
    } else if (isShapeTool(currentTool)) {
      drawShape(ctx, {
        kind: 'shape',
        tool: currentTool,
        color: currentColor,
        start,
        end: position,
      });
    }
  });
});

window.addEventListener('mouseup', (event) => {
  const start = dragStart;
  if (!start) return;
  dragStart = null;

  const position = canvasPosition(event);
  const rect = rectFromPoints(start, position);

  if (rect.width < MIN_DRAG_PX || rect.height < MIN_DRAG_PX) {
    rerender(); // discard the preview; a click is not an annotation
    return;
  }

  if (currentTool === 'crop') {
    pendingCrop = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    rerender();
    showCropUi(pendingCrop);
    return;
  }

  if (isShapeTool(currentTool)) {
    commit({ kind: 'shape', tool: currentTool, color: currentColor, start, end: position });
  }
});

// --- History controls ------------------------------------------------------

undoBtn.addEventListener('click', () => {
  history.undo();
  rerender();
});

redoBtn.addEventListener('click', () => {
  history.redo();
  rerender();
});

resetBtn.addEventListener('click', () => {
  cancelPendingText();
  cancelPendingCrop();
  history.reset();
  rerender();
  setStatus('Reverted to the original screenshot.');
});

document.addEventListener('keydown', (event) => {
  if (pendingTextInput) return; // typing, not issuing shortcuts

  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) history.redo();
    else history.undo();
    rerender();
    return;
  }
  if (modifier && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    history.redo();
    rerender();
    return;
  }
  if (event.key === 'Escape' && pendingCrop) {
    event.preventDefault();
    cancelPendingCrop();
  }
});

// --- Export ----------------------------------------------------------------

function canvasToBlob(source: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    source.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image.'))),
      type,
      quality
    );
  });
}

/** JPEG and PDF have no alpha channel, so transparency would render as black.
 *  Screenshots are opaque anyway; flattening onto white is the safe default. */
function toOpaqueCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const output = document.createElement('canvas');
  output.width = source.width;
  output.height = source.height;
  const ctx = output.getContext('2d');
  if (!ctx) throw new Error('Could not create a drawing surface.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, output.width, output.height);
  ctx.drawImage(source, 0, 0);
  return output;
}

async function buildExportBlob(format: ExportFormat): Promise<Blob> {
  if (format === 'png') return canvasToBlob(canvas, 'image/png');

  const opaque = toOpaqueCanvas(canvas);
  const jpeg = await canvasToBlob(opaque, 'image/jpeg', JPEG_QUALITY);
  if (format === 'jpg') return jpeg;

  return buildPdfBytes(new Uint8Array(await jpeg.arrayBuffer()), opaque.width, opaque.height);
}

formatSelect.addEventListener('change', () => {
  const value = formatSelect.value;
  if (isExportFormat(value)) void writePreferredFormat(value);
});

downloadBtn.addEventListener(
  'click',
  onAsync(async () => {
    commitPendingText();
    const value = formatSelect.value;
    if (!isExportFormat(value)) return;

    downloadBtn.disabled = true;
    try {
      await downloadBlob(await buildExportBlob(value), timestampedFilename(value));
      setStatus(`Saved as ${value.toUpperCase()}.`);
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : 'Download failed.');
    } finally {
      downloadBtn.disabled = false;
    }
  })
);

copyBtn.addEventListener(
  'click',
  onAsync(async () => {
    commitPendingText();
    try {
      const blob = await canvasToBlob(canvas, 'image/png');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setStatus('Copied to clipboard.');
    } catch (error) {
      console.error(error);
      setStatus('Copy failed - the browser blocked clipboard access.');
    }
  })
);

// --- Startup ---------------------------------------------------------------

async function start(): Promise<void> {
  const source = await loadCapture();

  if (!source) {
    setStatus('That screenshot is no longer available. Capture a new one from the toolbar icon.');
    toolbar.style.display = 'none';
    downloadBtn.disabled = true;
    copyBtn.disabled = true;
    return;
  }

  renderer = new CanvasRenderer(canvas, source);
  rerender();

  // The select stays disabled until the stored preference has been applied,
  // so a slow read cannot overwrite a choice the user already made.
  formatSelect.value = await readPreferredFormat();
  formatSelect.disabled = false;
}

void start();
