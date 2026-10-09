import {
  cropOffsetAt,
  drawPixelation,
  drawShape,
  drawText,
  type DrawingContext,
} from '../core/annotate/render.js';
import type { Annotation, Point, ShapeAnnotation } from '../core/annotate/types.js';

/**
 * Replays the annotation list onto a canvas, starting from the original
 * capture every time.
 *
 * Re-rendering from source is what makes a command-based undo possible: the
 * canvas is derived state, so dropping the last operation and redrawing is
 * exact, and memory stays proportional to the number of edits rather than to
 * the pixel area of the screenshot.
 */
export class CanvasRenderer {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  readonly #source: ImageBitmap;
  readonly #scratchCanvas = document.createElement('canvas');
  readonly #scratchCtx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement, source: ImageBitmap) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const scratchCtx = this.#scratchCanvas.getContext('2d');
    if (!ctx || !scratchCtx) throw new Error('Could not create a drawing surface.');

    this.#canvas = canvas;
    this.#ctx = ctx;
    this.#source = source;
    this.#scratchCtx = scratchCtx;
  }

  get context(): CanvasRenderingContext2D {
    return this.#ctx;
  }

  get sourceWidth(): number {
    return this.#source.width;
  }

  get sourceHeight(): number {
    return this.#source.height;
  }

  /** Draws the capture plus every committed annotation. */
  render(annotations: readonly Annotation[]): void {
    this.#canvas.width = this.#source.width;
    this.#canvas.height = this.#source.height;
    this.#ctx.drawImage(this.#source, 0, 0);

    for (let i = 0; i < annotations.length; i++) {
      const annotation = annotations[i];

      if (annotation.kind === 'crop') {
        this.#applyCrop(annotation.x, annotation.y, annotation.width, annotation.height);
        continue;
      }

      // Annotations are recorded in whatever coordinate space was current when
      // the user drew them. Replaying a crop shifts that origin, so later
      // annotations must be offset back by the crops that preceded them.
      const offset = cropOffsetAt(annotations, i);
      this.#drawAnnotation(annotation, offset);
    }
  }

  /** Draws a transient preview on top of the already-rendered canvas. */
  preview(draw: (ctx: DrawingContext) => void): void {
    draw(this.#ctx);
  }

  #drawAnnotation(annotation: Exclude<Annotation, { kind: 'crop' }>, offset: Point): void {
    if (annotation.kind === 'text') {
      drawText(this.#ctx, {
        ...annotation,
        position: { x: annotation.position.x - offset.x, y: annotation.position.y - offset.y },
      });
      return;
    }

    const shifted: ShapeAnnotation = {
      ...annotation,
      start: { x: annotation.start.x - offset.x, y: annotation.start.y - offset.y },
      end: { x: annotation.end.x - offset.x, y: annotation.end.y - offset.y },
    };

    drawShape(this.#ctx, shifted, (rect) =>
      drawPixelation(
        this.#ctx,
        this.#canvas,
        { canvas: this.#scratchCanvas, ctx: this.#scratchCtx },
        rect
      )
    );
  }

  #applyCrop(x: number, y: number, width: number, height: number): void {
    const safeX = Math.max(0, Math.min(this.#canvas.width - 1, Math.round(x)));
    const safeY = Math.max(0, Math.min(this.#canvas.height - 1, Math.round(y)));
    const safeW = Math.max(1, Math.min(this.#canvas.width - safeX, Math.round(width)));
    const safeH = Math.max(1, Math.min(this.#canvas.height - safeY, Math.round(height)));

    const cropped = this.#ctx.getImageData(safeX, safeY, safeW, safeH);
    this.#canvas.width = safeW;
    this.#canvas.height = safeH;
    this.#ctx.putImageData(cropped, 0, 0);
  }
}
