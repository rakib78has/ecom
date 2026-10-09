import { onAsync } from '../shared/async-handler.js';
import type { Response } from '../shared/messages.js';

const elements = {
  captureVisible: document.getElementById('capture-visible') as HTMLButtonElement,
  captureFullPage: document.getElementById('capture-full-page') as HTMLButtonElement,
  captureArea: document.getElementById('capture-area') as HTMLButtonElement,
  captureDelayed: document.getElementById('capture-delayed') as HTMLButtonElement,
  delaySelect: document.getElementById('delay-select') as HTMLSelectElement,
  recordScreen: document.getElementById('record-screen') as HTMLButtonElement,
  status: document.getElementById('home-status') as HTMLParagraphElement,
};

const allButtons = [
  elements.captureVisible,
  elements.captureFullPage,
  elements.captureArea,
  elements.captureDelayed,
  elements.recordScreen,
];

function setStatus(message: string): void {
  elements.status.textContent = message;
}

function setBusy(busy: boolean): void {
  allButtons.forEach((button) => {
    button.disabled = busy;
  });
}

/** Chrome's own error strings are the most useful thing to show, except on
 *  restricted pages where the raw text is cryptic. */
function friendlyError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (message.includes('chrome://') || message.includes('Cannot access')) {
    return "Can't capture this page — Chrome blocks extensions on browser pages.";
  }
  return message || fallback;
}

async function send<T extends object = object>(message: object, fallbackError: string): Promise<T> {
  const response = await chrome.runtime.sendMessage<object, Response<T> | undefined>(message);
  if (!response?.ok) {
    throw new Error(response?.ok === false ? response.error : fallbackError);
  }
  return response as unknown as T;
}

/** Runs a capture action, keeping the popup open only long enough to report a
 *  failure the user would otherwise never see. */
async function run(
  action: () => Promise<void>,
  busyMessage: string,
  fallbackError: string
): Promise<void> {
  setBusy(true);
  setStatus(busyMessage);
  try {
    await action();
    window.close();
  } catch (error) {
    console.error(error);
    setStatus(friendlyError(error, fallbackError));
    setBusy(false);
  }
}

elements.captureVisible.addEventListener(
  'click',
  onAsync(() =>
    run(
      async () => {
        await send({ type: 'CAPTURE_VISIBLE' }, 'Capture failed.');
      },
      'Capturing…',
      'Capture failed. Try again.'
    )
  )
);

elements.captureFullPage.addEventListener(
  'click',
  onAsync(() =>
    run(
      async () => {
        const result = await send<{ truncated?: boolean }>(
          { type: 'CAPTURE_FULL_PAGE' },
          'Full-page capture failed.'
        );
        if (result.truncated) {
          // The editor tab is already opening, so this is informational only.
          console.info('Page was too long to capture completely; image is truncated.');
        }
      },
      'Capturing…',
      'Full-page capture failed. Try again.'
    )
  )
);

elements.captureArea.addEventListener(
  'click',
  onAsync(() =>
    run(
      async () => {
        await send({ type: 'START_AREA_SELECTION' }, "Couldn't start area selection.");
      },
      'Draw a selection on the page…',
      "Couldn't start area selection."
    )
  )
);

elements.captureDelayed.addEventListener(
  'click',
  onAsync(() => {
    const delaySeconds = Number.parseInt(elements.delaySelect.value, 10) || 5;
    return run(
      async () => {
        await send(
          { type: 'START_DELAYED_CAPTURE', delaySeconds },
          "Couldn't start delayed capture."
        );
      },
      `Get ready — capturing in ${delaySeconds}s…`,
      "Couldn't start delayed capture."
    );
  })
);

elements.recordScreen.addEventListener(
  'click',
  onAsync(() =>
    run(
      async () => {
        await chrome.tabs.create({ url: chrome.runtime.getURL('recorder/recorder.html') });
      },
      'Opening recorder…',
      "Couldn't open the recorder."
    )
  )
);

chrome.runtime.onMessage.addListener((raw: unknown) => {
  const message = raw as { type?: string; current?: number; total?: number };
  if (message?.type === 'FULL_PAGE_PROGRESS') {
    setStatus(`Capturing… slice ${message.current}/${message.total}`);
  }
});
