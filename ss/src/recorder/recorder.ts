import { timestampedFilename } from '../core/export/filename.js';
import { onAsync } from '../shared/async-handler.js';
import {
  formatDuration,
  pickSupportedMimeType,
  startFrameClock,
  type FrameClock,
} from '../core/record/frame-clock.js';
import { downloadBlob } from '../infra/downloads.js';
import { ANNOTATION_COLORS, STROKE_WIDTH } from '../shared/constants.js';

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  color: string;
  width: number;
  points: Point[];
}

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Phase = 'idle' | 'selecting' | 'recording' | 'result';

const views = {
  idle: document.getElementById('idle-view') as HTMLElement,
  stage: document.getElementById('stage-view') as HTMLElement,
  result: document.getElementById('result-view') as HTMLElement,
};

const selectToolbar = document.getElementById('select-toolbar') as HTMLElement;
const recordToolbar = document.getElementById('record-toolbar') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const fullFrameBtn = document.getElementById('full-frame-btn') as HTMLButtonElement;
const confirmAreaBtn = document.getElementById('confirm-area-btn') as HTMLButtonElement;
const annotateToggle = document.getElementById('annotate-toggle') as HTMLButtonElement;
const undoStrokeBtn = document.getElementById('undo-stroke-btn') as HTMLButtonElement;
const clearAnnotationsBtn = document.getElementById('clear-annotations-btn') as HTMLButtonElement;
const colorGroup = document.querySelector('.color-group') as HTMLElement;
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
const timerEl = document.getElementById('timer') as HTMLElement;
const previewVideo = document.getElementById('preview-video') as HTMLVideoElement;
const downloadBtn = document.getElementById('download-btn') as HTMLButtonElement;
const againBtn = document.getElementById('again-btn') as HTMLButtonElement;

const canvas = document.getElementById('stage-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

let phase: Phase = 'idle';
let rawStream: MediaStream | null = null;
let composedStream: MediaStream | null = null;
let sourceVideo: HTMLVideoElement | null = null;
let mediaRecorder: MediaRecorder | null = null;
let frameClock: FrameClock | null = null;
let recordedChunks: Blob[] = [];
let recordedBlob: Blob | null = null;
let recordedUrl: string | null = null;
let timerInterval: number | null = null;
let startedAt = 0;

let cropRect: CropRect | null = null;

let isDraggingSelect = false;
let selectStart: Point = { x: 0, y: 0 };
let selectCurrent: Point = { x: 0, y: 0 };
let pendingSelection: CropRect | null = null;

let annotateMode = false;
let annotationColor: string = ANNOTATION_COLORS[0].value;
let strokes: Stroke[] = [];
let activeStroke: Stroke | null = null;

function setStatus(message: string): void {
  statusEl.textContent = message;
}

function showView(view: HTMLElement): void {
  Object.values(views).forEach((v) => v.classList.add('hidden'));
  view.classList.remove('hidden');
}

// --- Colour swatches -------------------------------------------------------

for (const { value, label } of ANNOTATION_COLORS) {
  const button = document.createElement('button');
  button.className = 'color-btn';
  button.style.setProperty('--swatch', value);
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(value === annotationColor));
  if (value === annotationColor) button.classList.add('active');

  button.addEventListener('click', () => {
    annotationColor = value;
    colorGroup.querySelectorAll<HTMLButtonElement>('.color-btn').forEach((other) => {
      const selected = other === button;
      other.classList.toggle('active', selected);
      other.setAttribute('aria-pressed', String(selected));
    });
  });

  colorGroup.appendChild(button);
}

// --- Capture setup ---------------------------------------------------------

/** Distinguishes a user cancelling the share picker from a real failure.
 *  Treating every rejection as a cancellation left policy blocks and device
 *  errors completely silent. */
function describeDisplayMediaError(error: unknown): string | null {
  if (!(error instanceof DOMException)) {
    return error instanceof Error ? error.message : 'Could not start screen capture.';
  }
  switch (error.name) {
    case 'NotAllowedError':
      // Also raised when policy blocks capture, but the user-cancelled case
      // is by far the common one and needs no message.
      return error.message.toLowerCase().includes('permission denied by system')
        ? 'Your system blocked screen recording. Grant Chrome screen-recording permission and try again.'
        : null;
    case 'NotFoundError':
      return 'No screen or window was available to record.';
    case 'NotReadableError':
      return 'Another application is using the screen capture device.';
    case 'AbortError':
      return null; // picker dismissed
    default:
      return `Could not start screen capture (${error.name}).`;
  }
}

async function startCapture(): Promise<void> {
  setStatus('');
  startBtn.disabled = true;

  try {
    rawStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: true,
    });
  } catch (error) {
    const message = describeDisplayMediaError(error);
    if (message) setStatus(message);
    startBtn.disabled = false;
    return;
  }

  try {
    sourceVideo = document.createElement('video');
    sourceVideo.muted = true;
    sourceVideo.playsInline = true;
    sourceVideo.srcObject = rawStream;
    await sourceVideo.play();

    if (!sourceVideo.videoWidth) {
      await new Promise<void>((resolve) =>
        sourceVideo!.addEventListener('loadedmetadata', () => resolve(), { once: true })
      );
    }

    rawStream.getVideoTracks()[0].addEventListener('ended', () => {
      if (phase === 'recording') stopRecording();
      else if (phase === 'selecting') cancelAndReset();
    });

    enterSelectPhase();
  } catch (error) {
    console.error(error);
    setStatus('Could not read the shared screen.');
    teardownStreams();
    startBtn.disabled = false;
  }
}

function enterSelectPhase(): void {
  phase = 'selecting';
  pendingSelection = null;
  isDraggingSelect = false;
  canvas.width = sourceVideo!.videoWidth;
  canvas.height = sourceVideo!.videoHeight;

  confirmAreaBtn.classList.add('hidden');
  recordToolbar.classList.add('hidden');
  selectToolbar.classList.remove('hidden');
  showView(views.stage);

  frameClock = startFrameClock(sourceVideo!, drawSelectFrame);
}

function currentDragRect(): CropRect {
  return {
    x: Math.min(selectStart.x, selectCurrent.x),
    y: Math.min(selectStart.y, selectCurrent.y),
    w: Math.abs(selectCurrent.x - selectStart.x),
    h: Math.abs(selectCurrent.y - selectStart.y),
  };
}

function drawSelectFrame(): void {
  if (phase !== 'selecting' || !sourceVideo) return;
  ctx.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);

  const selection = isDraggingSelect ? currentDragRect() : pendingSelection;
  if (!selection) return;

  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = '#2563eb';
  ctx.fillStyle = 'rgba(37, 99, 235, 0.12)';
  ctx.fillRect(selection.x, selection.y, selection.w, selection.h);
  ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);
  ctx.restore();
}

// --- Recording -------------------------------------------------------------

function beginRecording(): void {
  if (!cropRect || !sourceVideo) return;

  frameClock?.stop();
  phase = 'recording';
  canvas.width = cropRect.w;
  canvas.height = cropRect.h;

  strokes = [];
  activeStroke = null;
  annotateMode = false;
  updateAnnotateUi();

  selectToolbar.classList.add('hidden');
  recordToolbar.classList.remove('hidden');

  const canvasStream = canvas.captureStream(30);
  composedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...rawStream!.getAudioTracks(),
  ]);

  recordedChunks = [];
  const mimeType = pickSupportedMimeType();
  mediaRecorder = new MediaRecorder(composedStream, mimeType ? { mimeType } : undefined);
  mediaRecorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) recordedChunks.push(event.data);
  });
  mediaRecorder.addEventListener('stop', handleRecordingStopped);
  mediaRecorder.addEventListener('error', (event) => {
    console.error('Recorder error:', event);
    setStatus('Recording stopped unexpectedly.');
    stopRecording();
  });
  mediaRecorder.start(1000);

  startedAt = Date.now();
  timerEl.textContent = '00:00';
  timerInterval = window.setInterval(() => {
    timerEl.textContent = formatDuration(Date.now() - startedAt);
  }, 500);

  frameClock = startFrameClock(sourceVideo, drawRecordFrame);
  if (frameClock.kind === 'interval') {
    setStatus(
      'Keep this tab visible — your browser cannot deliver full frame rate in the background.'
    );
  }
}

function drawRecordFrame(): void {
  if (phase !== 'recording' || !sourceVideo || !cropRect) return;
  ctx.drawImage(
    sourceVideo,
    cropRect.x,
    cropRect.y,
    cropRect.w,
    cropRect.h,
    0,
    0,
    canvas.width,
    canvas.height
  );
  drawStrokes();
}

function drawStrokes(): void {
  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue;
    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function updateAnnotateUi(): void {
  annotateToggle.classList.toggle('active', annotateMode);
  annotateToggle.setAttribute('aria-pressed', String(annotateMode));
  undoStrokeBtn.disabled = strokes.length === 0;
  canvas.style.cursor = phase === 'recording' && annotateMode ? 'crosshair' : 'default';
}

function stopRecording(): void {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  } else {
    stopClocks();
  }
}

function stopClocks(): void {
  frameClock?.stop();
  frameClock = null;
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function teardownStreams(): void {
  rawStream?.getTracks().forEach((track) => track.stop());
  composedStream?.getTracks().forEach((track) => track.stop());
  rawStream = null;
  composedStream = null;

  if (sourceVideo) {
    sourceVideo.pause();
    sourceVideo.srcObject = null;
    sourceVideo = null;
  }
}

function handleRecordingStopped(): void {
  stopClocks();
  const mimeType = mediaRecorder?.mimeType || 'video/webm';
  teardownStreams();

  recordedBlob = new Blob(recordedChunks, { type: mimeType });
  recordedChunks = [];

  if (recordedUrl) URL.revokeObjectURL(recordedUrl);
  recordedUrl = URL.createObjectURL(recordedBlob);
  previewVideo.src = recordedUrl;

  phase = 'result';
  recordToolbar.classList.add('hidden');
  showView(views.result);
  setStatus('');
}

function cancelAndReset(): void {
  stopClocks();
  teardownStreams();
  phase = 'idle';
  selectToolbar.classList.add('hidden');
  recordToolbar.classList.add('hidden');
  startBtn.disabled = false;
  showView(views.idle);
}

function resetToIdle(): void {
  if (recordedUrl) {
    URL.revokeObjectURL(recordedUrl);
    recordedUrl = null;
  }
  recordedBlob = null;
  previewVideo.removeAttribute('src');
  previewVideo.load();
  setStatus('');
  startBtn.disabled = false;
  phase = 'idle';
  showView(views.idle);
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
  if (event.button !== 0) return;
  event.preventDefault();
  const position = canvasPosition(event);

  if (phase === 'selecting') {
    isDraggingSelect = true;
    selectStart = position;
    selectCurrent = position;
    return;
  }

  if (phase === 'recording' && annotateMode) {
    activeStroke = { color: annotationColor, width: STROKE_WIDTH, points: [position] };
    strokes.push(activeStroke);
    updateAnnotateUi();
  }
});

canvas.addEventListener('mousemove', (event) => {
  const position = canvasPosition(event);
  if (phase === 'selecting' && isDraggingSelect) {
    selectCurrent = position;
    return;
  }
  activeStroke?.points.push(position);
});

window.addEventListener('mouseup', () => {
  if (phase === 'selecting' && isDraggingSelect) {
    isDraggingSelect = false;
    const rect = currentDragRect();
    const tooSmall = rect.w < 20 || rect.h < 20;
    pendingSelection = tooSmall ? null : rect;
    confirmAreaBtn.classList.toggle('hidden', tooSmall);
    return;
  }
  activeStroke = null;
});

// --- Toolbar wiring --------------------------------------------------------

startBtn.addEventListener('click', () => void startCapture());

fullFrameBtn.addEventListener('click', () => {
  if (!sourceVideo) return;
  cropRect = { x: 0, y: 0, w: sourceVideo.videoWidth, h: sourceVideo.videoHeight };
  beginRecording();
});

confirmAreaBtn.addEventListener('click', () => {
  if (!pendingSelection) return;
  cropRect = pendingSelection;
  beginRecording();
});

annotateToggle.addEventListener('click', () => {
  annotateMode = !annotateMode;
  updateAnnotateUi();
});

undoStrokeBtn.addEventListener('click', () => {
  strokes.pop();
  activeStroke = null;
  updateAnnotateUi();
});

clearAnnotationsBtn.addEventListener('click', () => {
  strokes = [];
  activeStroke = null;
  updateAnnotateUi();
});

stopBtn.addEventListener('click', stopRecording);
againBtn.addEventListener('click', resetToIdle);

downloadBtn.addEventListener(
  'click',
  onAsync(async () => {
    if (!recordedBlob) return;
    downloadBtn.disabled = true;
    try {
      await downloadBlob(recordedBlob, timestampedFilename('webm'));
      setStatus('Saved to Downloads.');
    } catch (error) {
      console.error(error);
      setStatus('Download failed.');
    } finally {
      downloadBtn.disabled = false;
    }
  })
);

// Leaving the page mid-recording must release the capture, or the browser
// keeps showing the "sharing your screen" indicator after the tab is gone.
window.addEventListener('pagehide', () => {
  if (phase === 'recording') stopRecording();
  teardownStreams();
});
