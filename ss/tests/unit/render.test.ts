import { describe, expect, it } from 'vitest';
import {
  cropOffsetAt,
  drawArrow,
  drawPixelation,
  drawSelectionPreview,
  drawShape,
  drawText,
  finalSize,
} from '../../src/core/annotate/render.js';
import {
  isShapeTool,
  type Annotation,
  type ShapeAnnotation,
  type ShapeTool,
} from '../../src/core/annotate/types.js';
import { HIGHLIGHT_ALPHA, PIXELATE_BLOCK, STROKE_WIDTH } from '../../src/shared/constants.js';
import { createRecordingContext, createScratch } from '../helpers/recording-context.js';

function shape(tool: ShapeTool, overrides: Partial<ShapeAnnotation> = {}): ShapeAnnotation {
  return {
    kind: 'shape',
    tool,
    color: '#ef4444',
    start: { x: 10, y: 20 },
    end: { x: 110, y: 120 },
    ...overrides,
  };
}

describe('isShapeTool', () => {
  it.each(['arrow', 'rectangle', 'ellipse', 'highlight', 'blur'] as const)(
    'treats %s as a shape tool',
    (tool) => {
      expect(isShapeTool(tool)).toBe(true);
    }
  );

  it.each(['text', 'crop'] as const)('does not treat %s as a shape tool', (tool) => {
    expect(isShapeTool(tool)).toBe(false);
  });
});

describe('drawArrow', () => {
  it('draws a shaft and a filled three-point head', () => {
    const { ctx, callsTo } = createRecordingContext();

    drawArrow(ctx, { x: 0, y: 0 }, { x: 100, y: 0 });

    expect(callsTo('stroke')).toHaveLength(1);
    expect(callsTo('fill')).toHaveLength(1);
    expect(callsTo('closePath')).toHaveLength(1);
    // One shaft segment plus the two barbs of the head.
    expect(callsTo('lineTo')).toHaveLength(3);
  });

  it('draws the shaft between the two endpoints', () => {
    const { ctx, callsTo } = createRecordingContext();

    drawArrow(ctx, { x: 10, y: 20 }, { x: 110, y: 220 });

    expect(callsTo('moveTo')[0].args).toEqual([10, 20]);
    expect(callsTo('lineTo')[0].args).toEqual([110, 220]);
  });

  it('points the head back along the shaft regardless of direction', () => {
    for (const end of [
      { x: 100, y: 0 },
      { x: -100, y: 0 },
      { x: 0, y: 100 },
      { x: -70, y: -70 },
    ]) {
      const { ctx, callsTo } = createRecordingContext();
      drawArrow(ctx, { x: 0, y: 0 }, end);

      const barbs = callsTo('lineTo').slice(1);
      const headLength = Math.max(12, STROKE_WIDTH * 3);
      const shaftLength = Math.hypot(end.x, end.y);

      for (const barb of barbs) {
        const [bx, by] = barb.args as [number, number];
        // Each barb sits roughly one head-length back from the tip.
        const distanceFromTip = Math.hypot(bx - end.x, by - end.y);
        expect(distanceFromTip).toBeCloseTo(headLength, 5);
        // And closer to the origin than the tip is.
        expect(Math.hypot(bx, by)).toBeLessThan(shaftLength + headLength);
      }
    }
  });
});

describe('drawShape', () => {
  it('applies the annotation colour and stroke width', () => {
    const { ctx, stateAt } = createRecordingContext();

    drawShape(ctx, shape('rectangle', { color: '#2563eb' }));

    const [state] = stateAt('strokeRect');
    expect(state.strokeStyle).toBe('#2563eb');
    expect(state.lineWidth).toBe(STROKE_WIDTH);
  });

  it('normalises a rect drawn right-to-left', () => {
    const { ctx, callsTo } = createRecordingContext();

    drawShape(ctx, shape('rectangle', { start: { x: 110, y: 120 }, end: { x: 10, y: 20 } }));

    expect(callsTo('strokeRect')[0].args).toEqual([10, 20, 100, 100]);
  });

  it('centres an ellipse within the dragged bounds', () => {
    const { ctx, callsTo } = createRecordingContext();

    drawShape(ctx, shape('ellipse'));

    const [cx, cy, rx, ry] = callsTo('ellipse')[0].args as number[];
    expect([cx, cy, rx, ry]).toEqual([60, 70, 50, 50]);
  });

  it('draws a highlight as a translucent fill and restores full opacity', () => {
    const { ctx, stateAt, calls } = createRecordingContext();

    drawShape(ctx, shape('highlight'));

    expect(stateAt('fillRect')[0].globalAlpha).toBe(HIGHLIGHT_ALPHA);
    // Opacity must not leak into whatever is drawn next.
    const restoreIndex = calls.findIndex((c) => c.method === 'restore');
    expect(restoreIndex).toBeGreaterThan(-1);
  });

  it('balances every save with a restore', () => {
    for (const tool of ['arrow', 'rectangle', 'ellipse', 'highlight'] as const) {
      const { ctx, callsTo } = createRecordingContext();
      drawShape(ctx, shape(tool));
      expect(callsTo('save')).toHaveLength(callsTo('restore').length);
    }
  });

  it('delegates blur to the caller that owns the scratch surface', () => {
    const { ctx } = createRecordingContext();
    const regions: unknown[] = [];

    drawShape(ctx, shape('blur'), (rect) => regions.push(rect));

    expect(regions).toEqual([{ x: 10, y: 20, w: 100, h: 100 }]);
  });

  it('does not throw when blur is drawn with no pixelation handler', () => {
    const { ctx } = createRecordingContext();

    expect(() => drawShape(ctx, shape('blur'))).not.toThrow();
  });
});

describe('drawPixelation', () => {
  it('downscales by the block size and draws back without smoothing', () => {
    const { ctx, stateAt, callsTo } = createRecordingContext();
    const scratch = createScratch();
    const source = {} as CanvasImageSource;

    drawPixelation(ctx, source, scratch, { x: 0, y: 0, w: 140, h: 280 });

    expect(scratch.canvas.width).toBe(140 / PIXELATE_BLOCK);
    expect(scratch.canvas.height).toBe(280 / PIXELATE_BLOCK);
    expect(stateAt('drawImage')[0].imageSmoothingEnabled).toBe(false);
    expect(callsTo('drawImage')).toHaveLength(1);
  });

  it('never downscales below a single pixel', () => {
    const { ctx } = createRecordingContext();
    const scratch = createScratch();

    drawPixelation(ctx, {} as CanvasImageSource, scratch, { x: 0, y: 0, w: 3, h: 2 });

    expect(scratch.canvas.width).toBe(1);
    expect(scratch.canvas.height).toBe(1);
  });

  it('restores smoothing so later draws are not aliased', () => {
    const { ctx, callsTo } = createRecordingContext();

    drawPixelation(ctx, {} as CanvasImageSource, createScratch(), { x: 0, y: 0, w: 50, h: 50 });

    expect(callsTo('restore')).toHaveLength(1);
  });
});

describe('drawText', () => {
  it('draws the text at the recorded position in the annotation colour', () => {
    const { ctx, callsTo, stateAt } = createRecordingContext();

    drawText(ctx, { kind: 'text', color: '#22c55e', position: { x: 40, y: 60 }, text: 'Hello' });

    expect(callsTo('fillText')[0].args).toEqual(['Hello', 40, 60]);
    expect(stateAt('fillText')[0].fillStyle).toBe('#22c55e');
    expect(stateAt('fillText')[0].textBaseline).toBe('top');
  });
});

describe('drawSelectionPreview', () => {
  it.each(['crop', 'blur'] as const)('draws a dashed outline for %s', (variant) => {
    const { ctx, callsTo } = createRecordingContext();

    drawSelectionPreview(ctx, { x: 0, y: 0 }, { x: 50, y: 50 }, variant);

    expect(callsTo('setLineDash')[0].args[0]).toEqual(expect.any(Array));
    expect(callsTo('strokeRect')).toHaveLength(1);
    expect(callsTo('fillRect')).toHaveLength(1);
  });

  it('distinguishes crop from blur visually', () => {
    const crop = createRecordingContext();
    const blur = createRecordingContext();

    drawSelectionPreview(crop.ctx, { x: 0, y: 0 }, { x: 10, y: 10 }, 'crop');
    drawSelectionPreview(blur.ctx, { x: 0, y: 0 }, { x: 10, y: 10 }, 'blur');

    expect(crop.stateAt('strokeRect')[0].strokeStyle).not.toBe(
      blur.stateAt('strokeRect')[0].strokeStyle
    );
  });

  it('confines its state changes to a save/restore pair', () => {
    const { ctx, callsTo } = createRecordingContext();

    drawSelectionPreview(ctx, { x: 0, y: 0 }, { x: 10, y: 10 }, 'crop');

    expect(callsTo('save')).toHaveLength(1);
    expect(callsTo('restore')).toHaveLength(1);
  });
});

// Crops change the coordinate space mid-session. Annotations are recorded in
// whatever space was current when the user drew them, so replaying the list
// from the original bitmap has to shift later annotations back.
describe('cropOffsetAt', () => {
  const annotations: Annotation[] = [
    { kind: 'shape', tool: 'arrow', color: '#000', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
    { kind: 'crop', x: 100, y: 50, width: 400, height: 300 },
    { kind: 'shape', tool: 'arrow', color: '#000', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
    { kind: 'crop', x: 20, y: 10, width: 200, height: 150 },
    { kind: 'text', color: '#000', position: { x: 5, y: 5 }, text: 'x' },
  ];

  it('is zero before any crop', () => {
    expect(cropOffsetAt(annotations, 0)).toEqual({ x: 0, y: 0 });
    expect(cropOffsetAt(annotations, 1)).toEqual({ x: 0, y: 0 });
  });

  it('accumulates the first crop for annotations that follow it', () => {
    expect(cropOffsetAt(annotations, 2)).toEqual({ x: 100, y: 50 });
  });

  it('accumulates successive crops', () => {
    expect(cropOffsetAt(annotations, 4)).toEqual({ x: 120, y: 60 });
  });

  it('is zero for a list with no crops', () => {
    expect(cropOffsetAt([annotations[0]], 1)).toEqual({ x: 0, y: 0 });
  });
});

describe('finalSize', () => {
  it('returns the base size when nothing was cropped', () => {
    expect(finalSize([], 1440, 900)).toEqual({ width: 1440, height: 900 });
  });

  it('returns the dimensions of the last crop', () => {
    const annotations: Annotation[] = [
      { kind: 'crop', x: 0, y: 0, width: 800, height: 600 },
      { kind: 'crop', x: 10, y: 10, width: 400, height: 300 },
    ];

    expect(finalSize(annotations, 1440, 900)).toEqual({ width: 400, height: 300 });
  });

  it('ignores non-crop annotations', () => {
    const annotations: Annotation[] = [
      { kind: 'text', color: '#000', position: { x: 0, y: 0 }, text: 'hi' },
    ];

    expect(finalSize(annotations, 1440, 900)).toEqual({ width: 1440, height: 900 });
  });
});
