'use strict';

const PENDING_IMAGE_KEY = 'snapocr_pending_image';

async function notify(message) {
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Snap OCR',
      message,
    });
  } catch (err) {
    console.warn('Snap OCR: could not show notification', err);
  }
}

async function startSelection(tab) {
  if (!tab || !tab.id) return;

  const url = tab.url || '';
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://') || url.startsWith('about:')) {
    notify("Snap OCR can't run on this page (browser internal pages are restricted). Try it on a regular webpage, PDF, or video tab.");
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });
  } catch (err) {
    console.error('Snap OCR: failed to inject content script', err);
    notify("Snap OCR couldn't start on this page. Some pages (like the Chrome Web Store or internal pages) block extensions.");
  }
}

chrome.action.onClicked.addListener((tab) => {
  startSelection(tab);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'activate-selection') return;
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  startSelection(activeTab);
});

function dataUrlToArrayBuffer(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function blobToDataURL(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);
  return `data:image/png;base64,${base64}`;
}

async function cropCapture(tab, rect, devicePixelRatio) {
  const fullDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });

  const arrayBuffer = dataUrlToArrayBuffer(fullDataUrl);
  const blob = new Blob([arrayBuffer], { type: 'image/png' });
  const bitmap = await createImageBitmap(blob);

  const sx = Math.max(0, Math.round(rect.x * devicePixelRatio));
  const sy = Math.max(0, Math.round(rect.y * devicePixelRatio));
  const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(rect.width * devicePixelRatio)));
  const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(rect.height * devicePixelRatio)));

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);

  const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
  return blobToDataURL(croppedBlob);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'SNAPOCR_REGION_SELECTED') return undefined;

  const tab = sender.tab;
  if (!tab) return undefined;

  (async () => {
    try {
      const croppedDataUrl = await cropCapture(tab, message.rect, message.devicePixelRatio);
      await chrome.storage.session.set({ [PENDING_IMAGE_KEY]: croppedDataUrl });
      await chrome.tabs.create({ url: chrome.runtime.getURL('result.html') });
    } catch (err) {
      console.error('Snap OCR: capture failed', err);
      notify('Snap OCR failed to capture that region. Please try again.');
    }
  })();

  return false;
});
