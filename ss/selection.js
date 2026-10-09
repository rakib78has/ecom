(function () {
  if (document.getElementById("__snapcapture_overlay")) return; // already active

  const overlay = document.createElement("div");
  overlay.id = "__snapcapture_overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    cursor: "crosshair",
    background: "rgba(15, 23, 42, 0.25)",
  });

  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "fixed",
    border: "1.5px dashed #2563eb",
    background: "rgba(37, 99, 235, 0.15)",
    display: "none",
    zIndex: "2147483647",
    pointerEvents: "none",
  });

  const label = document.createElement("div");
  Object.assign(label.style, {
    position: "fixed",
    background: "#2563eb",
    color: "#fff",
    font: "11px -apple-system, BlinkMacSystemFont, sans-serif",
    padding: "2px 6px",
    borderRadius: "4px",
    zIndex: "2147483647",
    display: "none",
    pointerEvents: "none",
  });

  const hint = document.createElement("div");
  hint.textContent = "Drag to select an area — Esc to cancel";
  Object.assign(hint.style, {
    position: "fixed",
    top: "12px",
    left: "50%",
    transform: "translateX(-50%)",
    background: "#0f172a",
    color: "#fff",
    font: "12px -apple-system, BlinkMacSystemFont, sans-serif",
    padding: "6px 12px",
    borderRadius: "6px",
    zIndex: "2147483647",
    pointerEvents: "none",
  });

  document.documentElement.appendChild(overlay);
  document.documentElement.appendChild(box);
  document.documentElement.appendChild(label);
  document.documentElement.appendChild(hint);

  let startX = 0;
  let startY = 0;
  let dragging = false;

  function cleanup() {
    overlay.remove();
    box.remove();
    label.remove();
    hint.remove();
    document.removeEventListener("keydown", onKeyDown, true);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      cleanup();
      chrome.runtime.sendMessage({ type: "AREA_SELECTION_CANCELLED" });
    }
  }

  function onMouseDown(e) {
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    box.style.left = startX + "px";
    box.style.top = startY + "px";
    box.style.width = "0px";
    box.style.height = "0px";
    box.style.display = "block";
    label.style.display = "block";
  }

  function onMouseMove(e) {
    if (!dragging) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    box.style.left = x + "px";
    box.style.top = y + "px";
    box.style.width = w + "px";
    box.style.height = h + "px";
    label.textContent = `${Math.round(w)} x ${Math.round(h)}`;
    label.style.left = x + "px";
    label.style.top = Math.max(0, y - 20) + "px";
  }

  function onMouseUp(e) {
    if (!dragging) return;
    dragging = false;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);

    cleanup();

    if (w < 4 || h < 4) {
      chrome.runtime.sendMessage({ type: "AREA_SELECTION_CANCELLED" });
      return;
    }

    // Wait two frames so the overlay is fully gone before the background
    // captures the tab, otherwise the dashed box shows up in the screenshot.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        chrome.runtime.sendMessage({
          type: "AREA_SELECTED",
          rect: { x, y, width: w, height: h },
          dpr: window.devicePixelRatio || 1,
        });
      });
    });
  }

  overlay.addEventListener("mousedown", onMouseDown);
  overlay.addEventListener("mousemove", onMouseMove);
  overlay.addEventListener("mouseup", onMouseUp);
  document.addEventListener("keydown", onKeyDown, true);
})();
