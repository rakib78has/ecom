const MIN_CAPTURE_GAP_MS = 750; // stays under Chrome's captureVisibleTab rate limit (2/sec)
const SETTLE_DELAY_MS = 300; // time for scroll repaint + lazy-loaded content
const MAX_SLICES = 60; // safety cap for pathologically long / infinite-scroll pages

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Functions injected into the page (must be self-contained, no outer closures) ---

function pageGetMetrics() {
  const doc = document.documentElement;
  const body = document.body;
  return {
    scrollHeight: Math.max(doc.scrollHeight, body ? body.scrollHeight : 0),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    originalScrollX: window.scrollX,
    originalScrollY: window.scrollY,
    originalOverflow: doc.style.overflow,
  };
}

function pagePrepare() {
  document.documentElement.style.overflow = "hidden"; // hide scrollbar during capture
}

function pageScrollTo(y) {
  window.scrollTo(0, y);
}

function pageHideFixedElements() {
  const all = document.querySelectorAll("body *");
  all.forEach((el) => {
    if (el.dataset.snapcaptureHidden) return;
    const style = window.getComputedStyle(el);
    if (style.position === "fixed" || style.position === "sticky") {
      el.dataset.snapcaptureHidden = "1";
      el.dataset.snapcaptureOldVisibility = el.style.visibility;
      el.style.visibility = "hidden";
    }
  });
}

function pageRestore(originalScrollX, originalScrollY, originalOverflow) {
  document.querySelectorAll("[data-snapcapture-hidden]").forEach((el) => {
    el.style.visibility = el.dataset.snapcaptureOldVisibility || "";
    delete el.dataset.snapcaptureHidden;
    delete el.dataset.snapcaptureOldVisibility;
  });
  document.documentElement.style.overflow = originalOverflow || "";
  window.scrollTo(originalScrollX, originalScrollY);
}

function pageShowCountdown(seconds) {
  const id = "__snapcapture_countdown";
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    Object.assign(el.style, {
      position: "fixed",
      top: "16px",
      right: "16px",
      zIndex: "2147483647",
      background: "#0f172a",
      color: "#fff",
      font: "13px -apple-system, BlinkMacSystemFont, sans-serif",
      padding: "8px 14px",
      borderRadius: "20px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
      pointerEvents: "none",
    });
    document.documentElement.appendChild(el);
  }
  let remaining = seconds;
  el.textContent = `Capturing in ${remaining}…`;
  const interval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(interval);
      el.remove();
      return;
    }
    el.textContent = `Capturing in ${remaining}…`;
  }, 1000);
}

function pageRemoveCountdown() {
  const el = document.getElementById("__snapcapture_countdown");
  if (el) el.remove();
}

// --- Helpers ---

async function execInPage(tabId, func, args = []) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
  });
  return result;
}

async function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function sendProgress(current, total) {
  chrome.runtime.sendMessage({
    type: "FULL_PAGE_PROGRESS",
    current,
    total,
  }).catch(() => {}); // popup may be closed — ignore
}

async function captureFullPage(tab) {
  const tabId = tab.id;
  const metrics = await execInPage(tabId, pageGetMetrics);

  const slicesNeeded = Math.max(
    1,
    Math.min(MAX_SLICES, Math.ceil(metrics.scrollHeight / metrics.viewportHeight))
  );

  // Whole page already fits in one viewport — same as a visible-area capture.
  if (slicesNeeded === 1) {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    return dataUrl;
  }

  await execInPage(tabId, pagePrepare);

  // Evenly space the scroll stops across the full [0, maxScroll] range —
  // not i * viewportHeight — so that when a page needs more slices than
  // MAX_SLICES allows, coverage still reaches the bottom of the page
  // (spread thinner) instead of stopping dead partway down and leaving
  // the rest of the stitched canvas blank.
  const maxScroll = metrics.scrollHeight - metrics.viewportHeight;
  const positions = [];
  for (let i = 0; i < slicesNeeded; i++) {
    const y = slicesNeeded === 1 ? 0 : Math.round((maxScroll * i) / (slicesNeeded - 1));
    if (positions.length === 0 || positions[positions.length - 1] !== y) {
      positions.push(y);
    }
  }

  const bitmaps = [];
  let lastCaptureAt = 0;

  try {
    for (let i = 0; i < positions.length; i++) {
      await execInPage(tabId, pageScrollTo, [positions[i]]);

      if (i === 1) {
        // Hide fixed/sticky headers only after the first (natural) slice
        // so they don't repeat down the stitched image.
        await execInPage(tabId, pageHideFixedElements);
      }

      await sleep(SETTLE_DELAY_MS);

      const gap = Date.now() - lastCaptureAt;
      if (gap < MIN_CAPTURE_GAP_MS) {
        await sleep(MIN_CAPTURE_GAP_MS - gap);
      }

      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      lastCaptureAt = Date.now();

      const blob = await (await fetch(dataUrl)).blob();
      const bitmap = await createImageBitmap(blob);
      bitmaps.push({ bitmap, y: positions[i] });

      sendProgress(i + 1, positions.length);
    }
  } finally {
    await execInPage(tabId, pageRestore, [
      metrics.originalScrollX,
      metrics.originalScrollY,
      metrics.originalOverflow,
    ]);
  }

  const dpr = metrics.devicePixelRatio;
  const width = bitmaps[0].bitmap.width;
  const totalHeight = Math.round(metrics.scrollHeight * dpr);

  const canvas = new OffscreenCanvas(width, totalHeight);
  const ctx = canvas.getContext("2d");
  for (const { bitmap, y } of bitmaps) {
    ctx.drawImage(bitmap, 0, Math.round(y * dpr));
  }

  const outBlob = await canvas.convertToBlob({ type: "image/png" });
  return blobToDataURL(outBlob);
}

async function captureAndCropArea(tab, rect, dpr) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);

  const sx = Math.max(0, Math.round(rect.x * dpr));
  const sy = Math.max(0, Math.round(rect.y * dpr));
  const sw = Math.min(bitmap.width - sx, Math.round(rect.width * dpr));
  const sh = Math.min(bitmap.height - sy, Math.round(rect.height * dpr));

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);

  const outBlob = await canvas.convertToBlob({ type: "image/png" });
  return blobToDataURL(outBlob);
}

// Screenshots are handed to the editor tab over runtime messaging rather
// than chrome.storage.session — session storage caps out at a 10MB total
// quota, which a full-page capture (especially at 2x device pixel ratio on
// a tall page) can exceed as a base64 PNG. Messaging has no such limit.
const pendingCaptures = new Map();

async function openResultTab(dataUrl) {
  const captureId = crypto.randomUUID();
  pendingCaptures.set(captureId, dataUrl);
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`editor.html?cid=${captureId}`),
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CAPTURE_VISIBLE") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) throw new Error("No active tab found.");
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
        await openResultTab(dataUrl);
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || "Capture failed." });
      }
    })();
    return true;
  }

  if (message.type === "CAPTURE_FULL_PAGE") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) throw new Error("No active tab found.");
        const dataUrl = await captureFullPage(tab);
        await openResultTab(dataUrl);
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || "Full-page capture failed." });
      }
    })();
    return true; // keep the message channel open for the async response
  }

  if (message.type === "START_AREA_SELECTION") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) throw new Error("No active tab found.");
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["selection.js"],
        });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || "Couldn't start area selection." });
      }
    })();
    return true;
  }

  if (message.type === "START_DELAYED_CAPTURE") {
    (async () => {
      let tab;
      try {
        [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) throw new Error("No active tab found.");
        const delaySeconds = Math.max(1, Math.min(30, message.delaySeconds || 5));
        await execInPage(tab.id, pageShowCountdown, [delaySeconds]);
        sendResponse({ ok: true });

        await sleep(delaySeconds * 1000);
        await execInPage(tab.id, pageRemoveCountdown);
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
        await openResultTab(dataUrl);
      } catch (err) {
        // Popup that would show this error has almost certainly closed by now
        // (that's the point of the delay), so just log it.
        console.error("Delayed capture failed:", err);
        if (!tab) sendResponse({ ok: false, error: err?.message || "Delayed capture failed." });
      }
    })();
    return true;
  }

  if (message.type === "AREA_SELECTED") {
    (async () => {
      const tab = sender.tab;
      if (!tab) return;
      try {
        const dataUrl = await captureAndCropArea(tab, message.rect, message.dpr);
        await openResultTab(dataUrl);
      } catch (err) {
        console.error("Area capture failed:", err);
      }
    })();
    return false;
  }

  if (message.type === "FETCH_CAPTURE") {
    const dataUrl = pendingCaptures.get(message.captureId);
    pendingCaptures.delete(message.captureId); // one-time handoff
    sendResponse({ ok: Boolean(dataUrl), dataUrl });
    return false;
  }

  return false;
});
