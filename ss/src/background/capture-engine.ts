import { planFullPageCapture, type CapturePlan } from '../core/capture/full-page-plan.js';
import { toSourcePixelRect } from '../core/capture/geometry.js';
import { MIN_CAPTURE_GAP_MS, SETTLE_DELAY_MS } from '../shared/constants.js';
import type { Rect } from '../shared/messages.js';
import { execInPage, sleep } from '../infra/tabs.js';
import {
  pageGetMetrics,
  pageHideFixedElements,
  pagePrepare,
  pageRestore,
  pageScrollTo,
} from './page-scripts.js';

export interface CaptureResult {
  dataUrl: string;
  /** Set when the page was longer than one canvas could hold. */
  truncated?: boolean;
}

async function dataUrlToBitmap(dataUrl: string): Promise<ImageBitmap> {
  const blob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(blob);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not encode image.'));
    reader.readAsDataURL(blob);
  });
}

export async function captureVisible(windowId: number): Promise<string> {
  return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
}

export async function captureArea(windowId: number, rect: Rect, dpr: number): Promise<string> {
  const bitmap = await dataUrlToBitmap(await captureVisible(windowId));
  try {
    const source = toSourcePixelRect(rect, dpr, bitmap.width, bitmap.height);
    if (!source) {
      throw new Error('That selection falls outside the visible page area.');
    }

    const canvas = new OffscreenCanvas(source.sw, source.sh);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create a drawing surface.');
    ctx.drawImage(bitmap, source.sx, source.sy, source.sw, source.sh, 0, 0, source.sw, source.sh);

    return blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
  } finally {
    bitmap.close();
  }
}

export async function captureFullPage(
  tab: chrome.tabs.Tab,
  onProgress?: (current: number, total: number) => void
): Promise<CaptureResult> {
  const tabId = tab.id!;
  const windowId = tab.windowId;

  // Measure, hide the scrollbar, then measure again. Removing the scrollbar
  // reflows the page: the content gets wider and can therefore get shorter.
  // Planning against the pre-reflow height overshoots and leaves dead space
  // at the bottom of the stitched image.
  const initial = await execInPage(tabId, pageGetMetrics);
  await execInPage(tabId, pagePrepare);
  const metrics = { ...(await execInPage(tabId, pageGetMetrics)), ...pickOriginals(initial) };

  let plan: CapturePlan;
  try {
    plan = planFullPageCapture(metrics);
  } catch (error) {
    await restore(tabId, metrics);
    throw error;
  }

  if (plan.positions.length === 1) {
    await restore(tabId, metrics);
    return { dataUrl: await captureVisible(windowId) };
  }

  const bitmaps: Array<{ bitmap: ImageBitmap; y: number }> = [];
  let lastCaptureAt = 0;

  try {
    for (let i = 0; i < plan.positions.length; i++) {
      await execInPage(tabId, pageScrollTo, [plan.positions[i]]);

      // Everything after the first slice gets fixed/sticky elements hidden,
      // and it runs every iteration because pages mount new ones as you
      // scroll. The first slice keeps them so the header appears once.
      if (i >= 1) await execInPage(tabId, pageHideFixedElements);

      await sleep(SETTLE_DELAY_MS);

      const sinceLast = Date.now() - lastCaptureAt;
      if (sinceLast < MIN_CAPTURE_GAP_MS) await sleep(MIN_CAPTURE_GAP_MS - sinceLast);

      const dataUrl = await captureVisible(windowId);
      lastCaptureAt = Date.now();

      bitmaps.push({ bitmap: await dataUrlToBitmap(dataUrl), y: plan.positions[i] });
      onProgress?.(i + 1, plan.positions.length);
    }

    return {
      dataUrl: await stitch(bitmaps, plan, metrics.devicePixelRatio),
      truncated: plan.truncated,
    };
  } finally {
    // Free the decoded frames explicitly; a 60-slice capture holds a lot of
    // GPU-backed memory that the worker may not collect promptly.
    for (const { bitmap } of bitmaps) bitmap.close();
    await restore(tabId, metrics);
  }
}

function pickOriginals(metrics: {
  originalScrollX: number;
  originalScrollY: number;
  originalOverflow: string;
}) {
  return {
    originalScrollX: metrics.originalScrollX,
    originalScrollY: metrics.originalScrollY,
    originalOverflow: metrics.originalOverflow,
  };
}

async function restore(
  tabId: number,
  metrics: { originalScrollX: number; originalScrollY: number; originalOverflow: string }
): Promise<void> {
  try {
    await execInPage(tabId, pageRestore, [
      metrics.originalScrollX,
      metrics.originalScrollY,
      metrics.originalOverflow,
    ]);
  } catch (error) {
    // The tab may have navigated or closed mid-capture. Nothing to restore,
    // and it must not mask the original failure.
    console.warn('Could not restore page state after capture.', error);
  }
}

async function stitch(
  bitmaps: Array<{ bitmap: ImageBitmap; y: number }>,
  plan: CapturePlan,
  dpr: number
): Promise<string> {
  const width = bitmaps[0].bitmap.width;
  const canvas = new OffscreenCanvas(width, plan.canvasHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a drawing surface for the stitched image.');

  for (const { bitmap, y } of bitmaps) {
    ctx.drawImage(bitmap, 0, Math.round(y * dpr));
  }

  return blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
}
