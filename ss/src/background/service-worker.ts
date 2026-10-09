import { captureArea, captureFullPage, captureVisible } from './capture-engine.js';
import { pageRemoveCountdown, pageShowCountdown } from './page-scripts.js';
import { saveCapture, sweepExpiredCaptures, takeCapture } from '../infra/capture-store.js';
import { execInPage, getActiveTab, sleep } from '../infra/tabs.js';
import { clampDelaySeconds, parseMessage, type Message } from '../shared/messages.js';

/**
 * Message router. Deliberately thin: every handler resolves the active tab,
 * delegates to the capture engine, and converts failures into a response the
 * sender can display. No imaging logic lives here.
 */

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** Progress is advisory — the popup is usually closed by the time a long
 *  capture finishes, and a missing receiver is not a failure. */
function reportProgress(current: number, total: number): void {
  chrome.runtime.sendMessage({ type: 'FULL_PAGE_PROGRESS', current, total }).catch(() => undefined);
}

async function openEditorTab(dataUrl: string): Promise<void> {
  const captureId = crypto.randomUUID();
  // Persist *before* the tab exists, so the editor can always find its image
  // even if this worker is evicted between the two steps.
  await saveCapture(captureId, dataUrl);
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`editor/editor.html?cid=${captureId}`),
  });
}

async function handleCaptureVisible(): Promise<void> {
  const tab = await getActiveTab();
  await openEditorTab(await captureVisible(tab.windowId));
}

async function handleCaptureFullPage(): Promise<{ truncated: boolean }> {
  const tab = await getActiveTab();
  const result = await captureFullPage(tab, reportProgress);
  await openEditorTab(result.dataUrl);
  return { truncated: result.truncated === true };
}

async function handleStartAreaSelection(): Promise<void> {
  const tab = await getActiveTab();
  await chrome.scripting.executeScript({
    target: { tabId: tab.id! },
    files: ['selection-overlay.js'],
  });
}

async function handleAreaSelected(
  message: Extract<Message, { type: 'AREA_SELECTED' }>,
  sender: chrome.runtime.MessageSender
): Promise<void> {
  const tab = sender.tab;
  if (!tab?.windowId) return;
  await openEditorTab(await captureArea(tab.windowId, message.rect, message.dpr));
}

/** Runs the countdown, then captures. The popup is gone long before this
 *  resolves — that is the point of the delay — so it answers immediately and
 *  reports any later failure through a notification-free console path. */
async function handleDelayedCapture(delaySeconds: number): Promise<void> {
  const tab = await getActiveTab();
  const seconds = clampDelaySeconds(delaySeconds);
  await execInPage(tab.id!, pageShowCountdown, [seconds]);

  await sleep(seconds * 1000);
  try {
    await execInPage(tab.id!, pageRemoveCountdown);
  } catch {
    // Page may have navigated; the capture below will fail with a clearer
    // message if the tab is genuinely gone.
  }
  await openEditorTab(await captureVisible(tab.windowId));
}

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  const message = parseMessage(raw);
  if (!message) return false;

  switch (message.type) {
    case 'CAPTURE_VISIBLE':
      void handleCaptureVisible()
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) =>
          sendResponse({ ok: false, error: errorMessage(error, 'Capture failed.') })
        );
      return true;

    case 'CAPTURE_FULL_PAGE':
      void handleCaptureFullPage()
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error: unknown) =>
          sendResponse({ ok: false, error: errorMessage(error, 'Full-page capture failed.') })
        );
      return true;

    case 'START_AREA_SELECTION':
      void handleStartAreaSelection()
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) =>
          sendResponse({ ok: false, error: errorMessage(error, "Couldn't start area selection.") })
        );
      return true;

    case 'START_DELAYED_CAPTURE': {
      // Answer now so the popup can close; the capture continues afterwards.
      const started = handleDelayedCapture(message.delaySeconds);
      sendResponse({ ok: true });
      void started.catch((error: unknown) => {
        console.error('Delayed capture failed:', errorMessage(error, 'Unknown error.'));
      });
      return false;
    }

    case 'AREA_SELECTED':
      void handleAreaSelected(message, sender).catch((error: unknown) => {
        console.error('Area capture failed:', errorMessage(error, 'Unknown error.'));
      });
      return false;

    case 'AREA_SELECTION_CANCELLED':
      // Nothing to clean up in the worker; the overlay removes itself.
      return false;

    case 'FETCH_CAPTURE':
      void takeCapture(message.captureId)
        .then((dataUrl) =>
          dataUrl
            ? sendResponse({ ok: true, dataUrl })
            : sendResponse({ ok: false, error: 'That screenshot is no longer available.' })
        )
        .catch((error: unknown) =>
          sendResponse({ ok: false, error: errorMessage(error, 'Could not load the screenshot.') })
        );
      return true;

    default:
      return false;
  }
});

// Discard captures the editor never claimed — a tab closed before it loaded
// would otherwise leave its image behind indefinitely.
chrome.runtime.onStartup.addListener(() => void sweepExpiredCaptures());
chrome.runtime.onInstalled.addListener(() => void sweepExpiredCaptures());
