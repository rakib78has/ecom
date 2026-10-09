import type { Annotation } from './types.js';

/**
 * Undo history for the annotation editor.
 *
 * The previous implementation pushed a full-canvas `ImageData` snapshot per
 * operation and kept fifteen of them. On a full-page capture of a long page
 * at a 2x device pixel ratio — say 2880 x 20000 device px — one snapshot is
 * 2880 * 20000 * 4 bytes, about 230 MB. Fifteen is roughly 3.4 GB and the tab
 * dies long before the user reaches the limit.
 *
 * Storing the *operations* instead makes memory proportional to how much the
 * user drew (a few hundred bytes each) rather than to the size of the image,
 * so the depth limit can be generous instead of dangerously small. Undo
 * re-renders from the original bitmap, which also makes it exact rather than
 * dependent on whatever happened to be on the canvas at push time.
 */
export class AnnotationHistory {
  #annotations: Annotation[] = [];
  #redoStack: Annotation[] = [];

  get annotations(): readonly Annotation[] {
    return this.#annotations;
  }

  get canUndo(): boolean {
    return this.#annotations.length > 0;
  }

  get canRedo(): boolean {
    return this.#redoStack.length > 0;
  }

  get size(): number {
    return this.#annotations.length;
  }

  /** Appends an operation. Any redo history is discarded, which is the
   *  conventional behaviour after a new edit. */
  push(annotation: Annotation): void {
    this.#annotations.push(annotation);
    this.#redoStack.length = 0;
  }

  undo(): Annotation | null {
    const popped = this.#annotations.pop();
    if (!popped) return null;
    this.#redoStack.push(popped);
    return popped;
  }

  redo(): Annotation | null {
    const restored = this.#redoStack.pop();
    if (!restored) return null;
    this.#annotations.push(restored);
    return restored;
  }

  /** Clears every annotation, returning the canvas to the captured image. */
  reset(): void {
    this.#annotations.length = 0;
    this.#redoStack.length = 0;
  }
}
