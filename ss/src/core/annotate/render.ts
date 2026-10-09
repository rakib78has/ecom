import {
  HIGHLIGHT_ALPHA,
  PIXELATE_BLOCK,
  STROKE_WIDTH,
  TEXT_FONT_FAMILY,
  TEXT_FONT_SIZE,
} from '../../shared/constants.js';
import type {
  Annotation,
  CropAnnotation,
  Point,
  ShapeAnnotation,
  TextAnnotation,
} from './types.js';

/** The 2D context operations this module needs. Narrowing the dependency to an
 *  interface keeps these functions testable against a recording stub instead
 *  of requiring a real canvas. */
export type DrawingContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function rectOf(start: Point, end: Point) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  };
}

export function drawArrow(ctx: DrawingContext, start: Point, end: Point): void {
  const headLength = Math.max(12, STROKE_WIDTH * 3);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);

  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(
    end.x - headLength * Math.cos(angle - Math.PI / 6),
    end.y - headLength * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    end.x - headLength * Math.cos(angle + Math.PI / 6),
    end.y - headLength * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
}

/**
 * Pixelates a region by downscaling it into a scratch canvas and drawing it
 * back with smoothing disabled.
 *
 * The scratch canvas is supplied by the caller because a window and a worker
 * create one differently; the maths is identical either way.
 */
export function drawPixelation(
  ctx: DrawingContext,
  source: CanvasImageSource,
  scratch: { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: DrawingContext },
  rect: { x: number; y: number; w: number; h: number }
): void {
  const smallW = Math.max(1, Math.round(rect.w / PIXELATE_BLOCK));
  const smallH = Math.max(1, Math.round(rect.h / PIXELATE_BLOCK));

  scratch.canvas.width = smallW;
  scratch.canvas.height = smallH;
  scratch.ctx.clearRect(0, 0, smallW, smallH);
  scratch.ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, smallW, smallH);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch.canvas, 0, 0, smallW, smallH, rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

export function drawShape(
  ctx: DrawingContext,
  annotation: ShapeAnnotation,
  pixelate?: (rect: { x: number; y: number; w: number; h: number }) => void
): void {
  const { x, y, w, h } = rectOf(annotation.start, annotation.end);

  ctx.save();
  ctx.strokeStyle = annotation.color;
  ctx.fillStyle = annotation.color;
  ctx.lineWidth = STROKE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  switch (annotation.tool) {
    case 'arrow':
      drawArrow(ctx, annotation.start, annotation.end);
      break;
    case 'rectangle':
      ctx.strokeRect(x, y, w, h);
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'highlight':
      ctx.globalAlpha = HIGHLIGHT_ALPHA;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      break;
    case 'blur':
      // Pixelation reads back from the canvas, so it is delegated to the
      // caller that owns the scratch surface.
      pixelate?.({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
      break;
  }

  ctx.restore();
}

export function drawText(ctx: DrawingContext, annotation: TextAnnotation): void {
  ctx.save();
  ctx.fillStyle = annotation.color;
  ctx.font = `${TEXT_FONT_SIZE}px ${TEXT_FONT_FAMILY}`;
  ctx.textBaseline = 'top';
  ctx.fillText(annotation.text, annotation.position.x, annotation.position.y);
  ctx.restore();
}

/** Draws the dashed preview used while dragging a crop or blur region, which
 *  is transient UI rather than a committed annotation. */
export function drawSelectionPreview(
  ctx: DrawingContext,
  start: Point,
  end: Point,
  variant: 'crop' | 'blur'
): void {
  const { x, y, w, h } = rectOf(start, end);
  const style =
    variant === 'crop'
      ? { stroke: '#2563eb', fill: 'rgba(37, 99, 235, 0.12)', dash: [8, 6] }
      : { stroke: '#475569', fill: 'rgba(71, 85, 105, 0.25)', dash: [6, 4] };

  ctx.save();
  ctx.setLineDash(style.dash);
  ctx.strokeStyle = style.stroke;
  ctx.fillStyle = style.fill;
  ctx.lineWidth = STROKE_WIDTH / 2;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

/** Returns the accumulated crop offset so later annotations, recorded in the
 *  coordinate space that was current when they were drawn, still land in the
 *  right place after a re-render replays earlier crops. */
export function cropOffsetAt(annotations: readonly Annotation[], index: number): Point {
  let x = 0;
  let y = 0;
  for (let i = 0; i < index; i++) {
    const a = annotations[i];
    if (a.kind === 'crop') {
      x += a.x;
      y += a.y;
    }
  }
  return { x, y };
}

/** Final canvas size after replaying every crop in the list. */
export function finalSize(
  annotations: readonly Annotation[],
  baseWidth: number,
  baseHeight: number
): { width: number; height: number } {
  let width = baseWidth;
  let height = baseHeight;
  for (const a of annotations) {
    if (a.kind === 'crop') {
      width = a.width;
      height = a.height;
    }
  }
  return { width, height };
}

export type { Annotation, CropAnnotation, ShapeAnnotation, TextAnnotation };
