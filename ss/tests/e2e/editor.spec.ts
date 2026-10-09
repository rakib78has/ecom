import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, extensionUrl, test } from './fixtures.js';
import type { Page, Worker } from '@playwright/test';

/**
 * Drives the annotation editor against a real capture in a real browser.
 *
 * The capture is seeded straight into the handoff store rather than taken
 * from a page, because `activeTab` is only granted when the user clicks the
 * toolbar icon and Playwright cannot click it (see docs/testing.md). Seeding
 * covers everything downstream of the handoff — image decode, annotation,
 * undo, crop and export — which is where the editor's logic actually lives.
 */

const CAPTURE_WIDTH = 400;
const CAPTURE_HEIGHT = 300;

/** Writes a capture into the same IndexedDB store the service worker reads. */
async function seedCapture(serviceWorker: Worker, captureId: string): Promise<void> {
  await serviceWorker.evaluate(
    async ({ id, width, height }) => {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#2563eb';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(20, 20, 100, 100);

      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });

      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('snapcapture', 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains('captures')) {
            const store = database.createObjectStore('captures', { keyPath: 'captureId' });
            store.createIndex('createdAt', 'createdAt');
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(request.error ?? new Error('Could not open the capture store.'));
      });

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('captures', 'readwrite');
        const put = tx
          .objectStore('captures')
          .put({ captureId: id, dataUrl, createdAt: Date.now() });
        put.onsuccess = () => resolve();
        put.onerror = () => reject(put.error ?? new Error('Could not seed the capture.'));
      });
      db.close();
    },
    { id: captureId, width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT }
  );
}

async function openEditor(
  context: { newPage(): Promise<Page> },
  serviceWorker: Worker,
  extensionId: string,
  captureId: string
): Promise<Page> {
  await seedCapture(serviceWorker, captureId);
  const page = await context.newPage();
  await page.goto(extensionUrl(extensionId, `editor/editor.html?cid=${captureId}`));
  await expect
    .poll(() => page.evaluate(() => (document.getElementById('canvas') as HTMLCanvasElement).width))
    .toBe(CAPTURE_WIDTH);
  return page;
}

/** Drags across the canvas in CSS pixels relative to its top-left corner. */
async function dragOnCanvas(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number }
): Promise<void> {
  const box = (await page.locator('#canvas').boundingBox())!;
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 8 });
  await page.mouse.up();
}

/** Counts non-background pixels, as a proxy for "something was drawn". */
async function drawnPixelCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      // The seeded capture is #2563eb with a white square; anything else is
      // an annotation.
      const isBackground = data[i] === 0x25 && data[i + 1] === 0x63 && data[i + 2] === 0xeb;
      const isWhiteSquare = data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255;
      if (!isBackground && !isWhiteSquare) count++;
    }
    return count;
  });
}

/** Samples a rectangular region so a test can prove it changed. */
async function regionSignature(
  page: Page,
  rect: { x: number; y: number; w: number; h: number }
): Promise<string> {
  return page.evaluate((r) => {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    const { data } = canvas.getContext('2d')!.getImageData(r.x, r.y, r.w, r.h);
    let signature = '';
    // Every 97th pixel: dense enough to detect a change, cheap to compare.
    for (let i = 0; i < data.length; i += 4 * 97) {
      signature += `${data[i]},${data[i + 1]},${data[i + 2]};`;
    }
    return signature;
  }, rect);
}

test.describe('editor with a capture', () => {
  test('loads the captured image at its native size', async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    const editor = await openEditor(context, serviceWorker, extensionId, 'seed-load');

    const size = await editor.evaluate(() => {
      const canvas = document.getElementById('canvas') as HTMLCanvasElement;
      return { width: canvas.width, height: canvas.height };
    });
    expect(size).toEqual({ width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT });
    await expect(editor.locator('#toolbar')).toBeVisible();
  });

  test('consumes the capture exactly once', async ({ context, serviceWorker, extensionId }) => {
    await openEditor(context, serviceWorker, extensionId, 'seed-once');

    // Reopening the same id must find nothing — the handoff is one-shot.
    const second = await context.newPage();
    await second.goto(extensionUrl(extensionId, 'editor/editor.html?cid=seed-once'));
    await expect(second.locator('#status')).toContainText('no longer available');
  });

  test('enables the format select only once the preference has loaded', async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    // BUG-013: a slow storage read used to overwrite a choice already made.
    const editor = await openEditor(context, serviceWorker, extensionId, 'seed-format');
    await expect(editor.locator('#format-select')).toBeEnabled();
  });

  test('offers PNG, JPG and PDF', async ({ context, serviceWorker, extensionId }) => {
    const editor = await openEditor(context, serviceWorker, extensionId, 'seed-formats');

    const options = await editor.locator('#format-select option').allTextContents();
    expect(options).toEqual(['PNG', 'JPG', 'PDF']);
  });
});

test.describe('annotation', () => {
  test('draws a shape onto the canvas', async ({ context, serviceWorker, extensionId }) => {
    const editor = await openEditor(context, serviceWorker, extensionId, 'seed-draw');
    expect(await drawnPixelCount(editor)).toBe(0);

    await editor.getByRole('button', { name: '▭ Box' }).click();
    await dragOnCanvas(editor, { x: 150, y: 150 }, { x: 300, y: 250 });

    expect(await drawnPixelCount(editor)).toBeGreaterThan(0);
  });

  test('ignores a click that is not a drag', async ({ context, serviceWorker, extensionId }) => {
    const editor = await openEditor(context, serviceWorker, extensionId, 'seed-click');

    await editor.getByRole('button', { name: '▭ Box' }).click();
    await dragOnCanvas(editor, { x: 150, y: 150 }, { x: 151, y: 151 });

    expect(await drawnPixelCount(editor)).toBe(0);
    await expect(editor.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  });

  // --- BUG-001 regression, in a real browser -------------------------------
  // The old raster undo stack capped at fifteen entries and allocated a
  // full-canvas ImageData per edit. This draws well past that cap and then
  // undoes every single one, which the old implementation could not do.
  test('undoes an arbitrary number of annotations exactly', async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    const editor = await openEditor(context, serviceWorker, extensionId, 'seed-undo-depth');
    await editor.getByRole('button', { name: '▭ Box' }).click();

    const EDITS = 25; // deliberately past the old MAX_HISTORY of 15
    for (let i = 0; i < EDITS; i++) {
      const offset = i * 4;
      await dragOnCanvas(editor, { x: 20 + offset, y: 150 }, { x: 60 + offset, y: 200 });
    }
    expect(await drawnPixelCount(editor)).toBeGreaterThan(0);

    const undo = editor.getByRole('button', { name: 'Undo', exact: true });
    for (let i = 0; i < EDITS; i++) await undo.click();

    await expect(undo).toBeDisabled();
    // Every edit is gone: the canvas is byte-identical to the original.
    expect(await drawnPixelCount(editor)).toBe(0);
  });

  test('redoes an undone annotation', async ({ context, serviceWorker, extensionId }) => {
    const editor = await openEditor(context, serviceWorker, extensionId, 'seed-redo');
    await editor.getByRole('button', { name: '◯ Ellipse' }).click();
    await dragOnCanvas(editor, { x: 150, y: 150 }, { x: 300, y: 250 });

    const drawn = await drawnPixelCount(editor);
    await editor.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(await drawnPixelCount(editor)).toBe(0);

    await editor.getByRole('button', { name: 'Redo', exact: true }).click();
    expect(await drawnPixelCount(editor)).toBe(drawn);
  });

  test('supports keyboard undo and redo', async ({ context, serviceWorker, extensionId }) => {
    // BUG-012: the editor previously had no keyboard support at all.
    const editor = await openEditor(context, serviceWorker, extensionId, 'seed-keys');
    await editor.getByRole('button', { name: '▭ Box' }).click();
    await dragOnCanvas(editor, { x: 150, y: 150 }, { x: 300, y: 250 });
    const drawn = await drawnPixelCount(editor);

    await editor.keyboard.press('Control+z');
    expect(await drawnPixelCount(editor)).toBe(0);

    await editor.keyboard.press('Control+Shift+z');
    expect(await drawnPixelCount(editor)).toBe(drawn);
  });

  test('reset discards every annotation at once', async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    const editor = await openEditor(context, serviceWorker, extensionId, 'seed-reset');
    await editor.getByRole('button', { name: '▭ Box' }).click();
    await dragOnCanvas(editor, { x: 100, y: 100 }, { x: 200, y: 200 });
    await dragOnCanvas(editor, { x: 220, y: 100 }, { x: 320, y: 200 });

    await editor.getByRole('button', { name: 'Reset' }).click();

    expect(await drawnPixelCount(editor)).toBe(0);
    await expect(editor.locator('#status')).toContainText('original');
  });

  test('pixelates a region with the blur tool', async ({ context, serviceWorker, extensionId }) => {
    const editor = await openEditor(context, serviceWorker, extensionId, 'seed-blur');
    const region = { x: 70, y: 70, w: 120, h: 120 };
    const before = await regionSignature(editor, region);

    await editor.getByRole('button', { name: '▦ Blur' }).click();
    // The drag must straddle the white square's edge *and* land the edge
    // inside a pixelation block rather than on a block boundary — an aligned
    // boundary pixelates to an identical image and would prove nothing.
    await dragOnCanvas(editor, { x: 70, y: 70 }, { x: 190, y: 190 });

    expect(await regionSignature(editor, region)).not.toBe(before);
  });

  test('blur is undoable like any other annotation', async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    const editor = await openEditor(context, serviceWorker, extensionId, 'seed-blur-undo');
    const region = { x: 70, y: 70, w: 120, h: 120 };
    const before = await regionSignature(editor, region);

    await editor.getByRole('button', { name: '▦ Blur' }).click();
    await dragOnCanvas(editor, { x: 70, y: 70 }, { x: 190, y: 190 });
    expect(await regionSignature(editor, region)).not.toBe(before);

    await editor.getByRole('button', { name: 'Undo', exact: true }).click();

    expect(await regionSignature(editor, region)).toBe(before);
  });

  test('crops the canvas to the selected region', async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    const editor = await openEditor(context, serviceWorker, extensionId, 'seed-crop');

    await editor.getByRole('button', { name: '⛶ Crop' }).click();
    await dragOnCanvas(editor, { x: 50, y: 50 }, { x: 250, y: 200 });
    await editor.getByRole('button', { name: 'Apply Crop' }).click();

    const size = await editor.evaluate(() => {
      const canvas = document.getElementById('canvas') as HTMLCanvasElement;
      return { width: canvas.width, height: canvas.height };
    });
    expect(size.width).toBeLessThan(CAPTURE_WIDTH);
    expect(size.height).toBeLessThan(CAPTURE_HEIGHT);
  });

  test('cancelling a crop leaves the canvas untouched', async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    const editor = await openEditor(context, serviceWorker, extensionId, 'seed-crop-cancel');

    await editor.getByRole('button', { name: '⛶ Crop' }).click();
    await dragOnCanvas(editor, { x: 50, y: 50 }, { x: 250, y: 200 });
    await editor.getByRole('button', { name: 'Cancel' }).click();

    const width = await editor.evaluate(
      () => (document.getElementById('canvas') as HTMLCanvasElement).width
    );
    expect(width).toBe(CAPTURE_WIDTH);
  });
});

test.describe('accessibility', () => {
  // --- BUG-008 regression --------------------------------------------------
  // The colour swatches were empty <button> elements, announced as just
  // "button" with no way to tell them apart.
  test('every colour swatch has an accessible name', async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    const editor = await openEditor(context, serviceWorker, extensionId, 'seed-a11y');

    const swatches = editor.locator('.color-btn');
    await expect(swatches).toHaveCount(5);

    for (const name of ['Red', 'Blue', 'Yellow', 'Green', 'Black']) {
      await expect(editor.getByRole('button', { name, exact: true })).toBeVisible();
    }
  });

  test('swatches expose their selected state', async ({ context, serviceWorker, extensionId }) => {
    const editor = await openEditor(context, serviceWorker, extensionId, 'seed-a11y-state');

    await expect(editor.getByRole('button', { name: 'Red', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    await editor.getByRole('button', { name: 'Green', exact: true }).click();

    await expect(editor.getByRole('button', { name: 'Green', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(editor.getByRole('button', { name: 'Red', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  test('tool buttons expose their selected state', async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    const editor = await openEditor(context, serviceWorker, extensionId, 'seed-a11y-tools');

    await expect(editor.getByRole('button', { name: '➚ Arrow' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    await editor.getByRole('button', { name: '▦ Blur' }).click();

    await expect(editor.getByRole('button', { name: '▦ Blur' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(editor.getByRole('button', { name: '➚ Arrow' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });
});

test.describe('export', () => {
  /**
   * Returns the bytes of the single file Chromium downloaded.
   *
   * The on-disk *name* is not assertable here: Playwright takes over
   * downloads via CDP when `downloadsPath` is set and stores each one under a
   * GUID, so neither the name passed to `chrome.downloads.download` nor
   * `suggestedFilename()` survives. Naming is covered by the unit tests for
   * `timestampedFilename`, and by a manual case in docs/testing.md.
   *
   * The content is far more worth asserting anyway: it proves the real
   * browser produced a valid file in the requested format, including the
   * hand-rolled PDF writer.
   */
  async function readDownload(downloadsPath: string): Promise<Buffer | null> {
    // Must not throw: expect.poll abandons a predicate that throws, and a
    // download is routinely still in flight on the first attempt.
    try {
      const names = await readdir(downloadsPath);
      const complete = names.filter((name) => !name.endsWith('.crdownload'));
      if (complete.length !== 1) return null;
      return await readFile(join(downloadsPath, complete[0]));
    } catch {
      return null;
    }
  }

  /** Waits for the download to land, then returns its bytes. */
  async function downloadedBytes(downloadsPath: string): Promise<Buffer> {
    await expect
      .poll(async () => (await readDownload(downloadsPath))?.length ?? 0, { timeout: 20_000 })
      .toBeGreaterThan(0);
    const bytes = await readDownload(downloadsPath);
    if (!bytes) throw new Error('Download never appeared.');
    return bytes;
  }

  const SIGNATURES = {
    png: { magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], label: 'PNG' },
    jpg: { magic: [0xff, 0xd8, 0xff], label: 'JPG' },
    pdf: { magic: [0x25, 0x50, 0x44, 0x46], label: 'PDF' },
  } as const;

  for (const extension of ['png', 'jpg', 'pdf'] as const) {
    const { magic, label } = SIGNATURES[extension];

    test(`exports a real ${label} file`, async ({
      context,
      serviceWorker,
      extensionId,
      downloadsPath,
    }) => {
      const editor = await openEditor(
        context,
        serviceWorker,
        extensionId,
        `seed-export-${extension}`
      );
      await editor.getByRole('button', { name: '▭ Box' }).click();
      await dragOnCanvas(editor, { x: 100, y: 100 }, { x: 250, y: 200 });

      await editor.locator('#format-select').selectOption(extension);
      await editor.getByRole('button', { name: 'Download' }).click();
      await expect(editor.locator('#status')).toContainText(label);

      const bytes = await downloadedBytes(downloadsPath);
      expect([...bytes.subarray(0, magic.length)]).toEqual([...magic]);
    });
  }

  // The PDF writer is hand-rolled, so a structural check in a real browser is
  // worth more than a byte-count assertion.
  test('the exported PDF is structurally complete', async ({
    context,
    serviceWorker,
    extensionId,
    downloadsPath,
  }) => {
    const editor = await openEditor(context, serviceWorker, extensionId, 'seed-pdf-structure');
    await editor.locator('#format-select').selectOption('pdf');
    await editor.getByRole('button', { name: 'Download' }).click();
    await expect(editor.locator('#status')).toContainText('PDF');

    const text = (await downloadedBytes(downloadsPath)).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain(`/MediaBox [0 0 ${CAPTURE_WIDTH} ${CAPTURE_HEIGHT}]`);
  });

  test('remembers the chosen format for the next capture', async ({
    context,
    serviceWorker,
    extensionId,
  }) => {
    const first = await openEditor(context, serviceWorker, extensionId, 'seed-pref-1');
    await first.locator('#format-select').selectOption('pdf');
    await first.close();

    const second = await openEditor(context, serviceWorker, extensionId, 'seed-pref-2');
    await expect(second.locator('#format-select')).toHaveValue('pdf');
  });
});
