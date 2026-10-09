const captureBtn = document.getElementById("capture-visible");
const captureFullPageBtn = document.getElementById("capture-full-page");
const captureAreaBtn = document.getElementById("capture-area");
const captureDelayedBtn = document.getElementById("capture-delayed");
const delaySelect = document.getElementById("delay-select");
const recordScreenBtn = document.getElementById("record-screen");
const homeStatusEl = document.getElementById("home-status");

function setHomeStatus(message) {
  homeStatusEl.textContent = message || "";
}

function setCapturing(isCapturing) {
  captureBtn.disabled = isCapturing;
  captureFullPageBtn.disabled = isCapturing;
  captureAreaBtn.disabled = isCapturing;
  captureDelayedBtn.disabled = isCapturing;
  recordScreenBtn.disabled = isCapturing;
}

function friendlyError(err, fallback) {
  const msg = err?.message || "";
  if (msg.includes("chrome://") || msg.includes("cannot")) {
    return "Can't do that on this page (browser-restricted).";
  }
  // Show the real reason instead of a generic string — makes it possible to
  // tell what actually went wrong without opening DevTools.
  return msg || fallback;
}

async function captureVisibleArea() {
  setCapturing(true);
  setHomeStatus("Capturing…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE" });
    if (!response?.ok) throw new Error(response?.error || "Capture failed.");
    window.close();
  } catch (err) {
    console.error(err);
    setHomeStatus(friendlyError(err, "Capture failed. Try again."));
    setCapturing(false);
  }
}

async function captureFullPage() {
  setCapturing(true);
  setHomeStatus("Capturing…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "CAPTURE_FULL_PAGE" });
    if (!response?.ok) throw new Error(response?.error || "Full-page capture failed.");
    window.close();
  } catch (err) {
    console.error(err);
    setHomeStatus(friendlyError(err, "Full-page capture failed. Try again."));
    setCapturing(false);
  }
}

async function captureArea() {
  setHomeStatus("Draw a selection on the page…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "START_AREA_SELECTION" });
    if (!response?.ok) throw new Error(response?.error || "Couldn't start area selection.");
    // The overlay now lives on the page; the background script finishes the
    // job and opens a results tab once the user finishes dragging.
    window.close();
  } catch (err) {
    console.error(err);
    setHomeStatus(friendlyError(err, "Couldn't start area selection."));
  }
}

async function captureDelayed() {
  const delaySeconds = parseInt(delaySelect.value, 10) || 5;
  setHomeStatus(`Get ready — capturing in ${delaySeconds}s…`);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "START_DELAYED_CAPTURE",
      delaySeconds,
    });
    if (!response?.ok) throw new Error(response?.error || "Couldn't start delayed capture.");
    // A countdown badge is now showing on the page; the background script
    // captures once it finishes and opens a results tab.
    window.close();
  } catch (err) {
    console.error(err);
    setHomeStatus(friendlyError(err, "Couldn't start delayed capture."));
  }
}

async function recordScreen() {
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL("recorder.html") });
    window.close();
  } catch (err) {
    console.error(err);
    setHomeStatus("Couldn't open the recorder.");
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "FULL_PAGE_PROGRESS") {
    setHomeStatus(`Capturing… slice ${message.current}/${message.total}`);
  }
});

captureBtn.addEventListener("click", captureVisibleArea);
captureFullPageBtn.addEventListener("click", captureFullPage);
captureAreaBtn.addEventListener("click", captureArea);
captureDelayedBtn.addEventListener("click", captureDelayed);
recordScreenBtn.addEventListener("click", recordScreen);
