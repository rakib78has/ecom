import { describe, expect, it } from 'vitest';
import { AnnotationHistory } from '../../src/core/annotate/history.js';
import type { Annotation } from '../../src/core/annotate/types.js';

function shape(color = '#ef4444'): Annotation {
  return {
    kind: 'shape',
    tool: 'arrow',
    color,
    start: { x: 0, y: 0 },
    end: { x: 10, y: 10 },
  };
}

describe('AnnotationHistory', () => {
  it('starts empty with nothing to undo or redo', () => {
    const history = new AnnotationHistory();

    expect(history.size).toBe(0);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it('records annotations in order', () => {
    const history = new AnnotationHistory();
    history.push(shape('#ef4444'));
    history.push(shape('#2563eb'));

    expect(history.annotations.map((a) => (a as { color: string }).color)).toEqual([
      '#ef4444',
      '#2563eb',
    ]);
  });

  it('undoes the most recent annotation', () => {
    const history = new AnnotationHistory();
    history.push(shape('#ef4444'));
    history.push(shape('#2563eb'));

    const undone = history.undo();

    expect((undone as { color: string }).color).toBe('#2563eb');
    expect(history.size).toBe(1);
    expect(history.canRedo).toBe(true);
  });

  it('redoes an undone annotation back into place', () => {
    const history = new AnnotationHistory();
    history.push(shape('#ef4444'));
    history.undo();
    history.redo();

    expect(history.size).toBe(1);
    expect(history.canRedo).toBe(false);
  });

  it('discards redo history once a new annotation is made', () => {
    const history = new AnnotationHistory();
    history.push(shape('#ef4444'));
    history.undo();
    expect(history.canRedo).toBe(true);

    history.push(shape('#22c55e'));

    expect(history.canRedo).toBe(false);
    expect(history.size).toBe(1);
  });

  it('returns null when there is nothing to undo or redo', () => {
    const history = new AnnotationHistory();

    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
  });

  it('clears everything on reset', () => {
    const history = new AnnotationHistory();
    history.push(shape());
    history.push(shape());
    history.undo();

    history.reset();

    expect(history.size).toBe(0);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  // --- BUG-001 regression --------------------------------------------------
  // The original editor pushed a full-canvas ImageData per operation. On a
  // 2880 x 20000 device-pixel capture that is ~230 MB each, and the fifteen
  // it retained came to roughly 3.4 GB — the tab died first.
  //
  // This asserts the structural property that prevents it: history cost is a
  // function of how many edits were made, never of the image's pixel area.
  describe('regression: memory is independent of image size (BUG-001)', () => {
    it('stores operations, not pixel buffers', () => {
      const history = new AnnotationHistory();
      for (let i = 0; i < 200; i++) history.push(shape());

      for (const annotation of history.annotations) {
        for (const value of Object.values(annotation)) {
          expect(ArrayBuffer.isView(value)).toBe(false);
          expect(value).not.toBeInstanceOf(ArrayBuffer);
        }
      }
    });

    it('keeps a deep history cheap enough to retain', () => {
      const history = new AnnotationHistory();
      for (let i = 0; i < 500; i++) history.push(shape());

      // A rough but meaningful ceiling: 500 vector operations serialise to a
      // few tens of kilobytes. The old design would be several gigabytes.
      const bytes = JSON.stringify(history.annotations).length;
      expect(history.size).toBe(500);
      expect(bytes).toBeLessThan(100_000);
    });

    it('imposes no depth limit that would silently drop the user’s earliest work', () => {
      const history = new AnnotationHistory();
      for (let i = 0; i < 100; i++) history.push(shape(`#00000${i % 10}`));

      // The old MAX_HISTORY of 15 shifted entries off the front, so undoing
      // past the sixteenth edit silently did nothing.
      expect(history.size).toBe(100);
      for (let i = 0; i < 100; i++) expect(history.undo()).not.toBeNull();
      expect(history.canUndo).toBe(false);
    });
  });
});
