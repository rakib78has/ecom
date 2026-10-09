(async function () {
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const statusEl = document.getElementById("status");
  const undoBtn = document.getElementById("undo-btn");
  const resetBtn = document.getElementById("reset-btn");
  const downloadBtn = document.getElementById("download-btn");
  const copyBtn = document.getElementById("copy-btn");
  const formatSelect = document.getElementById("format-select");
  const toolButtons = Array.from(document.querySelectorAll(".tool-btn"));
  const colorButtons = Array.from(document.querySelectorAll(".color-btn"));

  const STROKE_WIDTH = 4;
  const HIGHLIGHT_ALPHA = 0.4;
  const PIXELATE_BLOCK = 14;
  const MAX_HISTORY = 15;

  let currentTool = "arrow";
  let currentColor = "#ef4444";
  let originalImageData = null;
  let historyStack = [];
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };
  let dragStartSnapshot = null;
  let cropSelection = null;
  let textInputState = null;

  function setStatus(message) {
    statusEl.textContent = message || "";
  }

  function timestampedFilename(ext) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
      d.getHours()
    )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `snapcapture-${stamp}.${ext}`;
  }

  // --- Load the captured screenshot ---
  // Handed over via runtime messaging (not chrome.storage) since a
  // full-page screenshot's data URL can exceed storage.session's 10MB quota.

  const captureId = new URLSearchParams(location.search).get("cid");
  const fetchResponse = captureId
    ? await chrome.runtime.sendMessage({ type: "FETCH_CAPTURE", captureId })
    : null;

  if (!fetchResponse?.ok) {
    setStatus("No screenshot found. Capture one from the extension popup.");
    document.getElementById("toolbar").style.display = "none";
    downloadBtn.disabled = true;
    copyBtn.disabled = true;
    return;
  }

  await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      resolve();
    };
    img.onerror = reject;
    img.src = fetchResponse.dataUrl;
  });

  // --- History (undo) ---

  function pushHistory() {
    historyStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (historyStack.length > MAX_HISTORY) historyStack.shift();
    undoBtn.disabled = false;
  }

  function popHistoryDiscard() {
    historyStack.pop();
    undoBtn.disabled = historyStack.length === 0;
  }

  function undo() {
    if (!historyStack.length) return;
    const prev = historyStack.pop();
    canvas.width = prev.width;
    canvas.height = prev.height;
    ctx.putImageData(prev, 0, 0);
    undoBtn.disabled = historyStack.length === 0;
  }

  function resetToOriginal() {
    if (!originalImageData) return;
    cancelPendingText();
    cancelCrop();
    pushHistory();
    canvas.width = originalImageData.width;
    canvas.height = originalImageData.height;
    ctx.putImageData(originalImageData, 0, 0);
  }

  // --- Coordinate helpers ---

  function getCanvasPos(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (evt.clientX - rect.left) * scaleX,
      y: (evt.clientY - rect.top) * scaleY,
    };
  }

  // --- Shape drawing ---

  function drawArrow(start, end) {
    const headlen = Math.max(12, STROKE_WIDTH * 3);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const angle = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - headlen * Math.cos(angle - Math.PI / 6), end.y - headlen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(end.x - headlen * Math.cos(angle + Math.PI / 6), end.y - headlen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  function drawShapePreview(tool, start, pos) {
    const x = Math.min(start.x, pos.x);
    const y = Math.min(start.y, pos.y);
    const w = Math.abs(pos.x - start.x);
    const h = Math.abs(pos.y - start.y);

    ctx.save();
    ctx.strokeStyle = currentColor;
    ctx.fillStyle = currentColor;
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    switch (tool) {
      case "arrow":
        drawArrow(start, pos);
        break;
      case "rectangle":
        ctx.strokeRect(x, y, w, h);
        break;
      case "ellipse":
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case "highlight":
        ctx.globalAlpha = HIGHLIGHT_ALPHA;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;
        break;
      case "crop":
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = "#2563eb";
        ctx.fillStyle = "rgba(37, 99, 235, 0.12)";
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        break;
      case "blur":
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = "#475569";
        ctx.fillStyle = "rgba(71, 85, 105, 0.25)";
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        break;
    }
    ctx.restore();
  }

  function applyPixelation(x, y, w, h) {
    const smallW = Math.max(1, Math.round(w / PIXELATE_BLOCK));
    const smallH = Math.max(1, Math.round(h / PIXELATE_BLOCK));

    const tmp = document.createElement("canvas");
    tmp.width = smallW;
    tmp.height = smallH;
    const tmpCtx = tmp.getContext("2d");
    tmpCtx.drawImage(canvas, x, y, w, h, 0, 0, smallW, smallH);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, smallW, smallH, x, y, w, h);
    ctx.restore();
  }

  // --- Text tool ---

  function cancelPendingText() {
    if (!textInputState) return;
    const { el } = textInputState;
    textInputState = null;
    el.remove();
  }

  function commitPendingText() {
    if (!textInputState) return;
    const { el, pos } = textInputState;
    textInputState = null;
    const value = el.value.trim();
    el.remove();
    if (!value) return;
    pushHistory();
    ctx.save();
    ctx.fillStyle = currentColor;
    ctx.font = "28px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(value, pos.x, pos.y);
    ctx.restore();
  }

  function startTextInput(pos) {
    commitPendingText();
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;

    const input = document.createElement("input");
    input.type = "text";
    Object.assign(input.style, {
      position: "fixed",
      left: `${rect.left + pos.x * scaleX}px`,
      top: `${rect.top + pos.y * scaleY}px`,
      font: `${28 * scaleY}px -apple-system, BlinkMacSystemFont, sans-serif`,
      color: currentColor,
      background: "rgba(255, 255, 255, 0.92)",
      border: "1px dashed #2563eb",
      padding: "1px 4px",
      zIndex: "20",
      minWidth: "140px",
    });
    document.body.appendChild(input);
    textInputState = { el: input, pos };
    input.focus();

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commitPendingText();
      if (e.key === "Escape") cancelPendingText();
    });
    input.addEventListener("blur", () => commitPendingText());
  }

  // --- Crop tool ---

  function removeCropOverlay() {
    document.getElementById("crop-overlay")?.remove();
    document.getElementById("crop-controls")?.remove();
  }

  function cancelCrop() {
    if (!cropSelection) return;
    cropSelection = null;
    removeCropOverlay();
    popHistoryDiscard();
  }

  function applyCrop() {
    if (!cropSelection) return;
    const { x, y, w, h } = cropSelection;
    const cropped = ctx.getImageData(x, y, w, h);
    cropSelection = null;
    removeCropOverlay();
    canvas.width = w;
    canvas.height = h;
    ctx.putImageData(cropped, 0, 0);
  }

  function showCropOverlay(sel) {
    removeCropOverlay();
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / canvas.width;
    const scaleY = rect.height / canvas.height;

    const overlay = document.createElement("div");
    overlay.id = "crop-overlay";
    Object.assign(overlay.style, {
      position: "fixed",
      left: `${rect.left + sel.x * scaleX}px`,
      top: `${rect.top + sel.y * scaleY}px`,
      width: `${sel.w * scaleX}px`,
      height: `${sel.h * scaleY}px`,
      border: "2px dashed #2563eb",
      background: "rgba(37, 99, 235, 0.08)",
      pointerEvents: "none",
      zIndex: "10",
    });
    document.body.appendChild(overlay);

    const controls = document.createElement("div");
    controls.id = "crop-controls";
    Object.assign(controls.style, {
      position: "fixed",
      left: `${rect.left + sel.x * scaleX}px`,
      top: `${rect.top + sel.y * scaleY + sel.h * scaleY + 8}px`,
      display: "flex",
      gap: "6px",
      zIndex: "11",
    });

    const applyBtn = document.createElement("button");
    applyBtn.textContent = "Apply Crop";
    applyBtn.className = "primary";
    applyBtn.addEventListener("click", applyCrop);

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", cancelCrop);

    controls.append(applyBtn, cancelBtn);
    document.body.appendChild(controls);
  }

  // --- Pointer interaction ---

  function onPointerDown(e) {
    // Canvas isn't a focusable element, so its default mousedown behavior is
    // to shift focus to <body> right after this handler runs — which would
    // instantly blur (and thus discard) a freshly-focused text input.
    e.preventDefault();

    if (cropSelection) return; // waiting on Apply/Cancel from a previous selection
    const pos = getCanvasPos(e);

    if (currentTool === "text") {
      startTextInput(pos);
      return;
    }

    isDragging = true;
    dragStart = pos;
    pushHistory();
    dragStartSnapshot = historyStack[historyStack.length - 1];
  }

  function onPointerMove(e) {
    if (!isDragging) return;
    const pos = getCanvasPos(e);
    ctx.putImageData(dragStartSnapshot, 0, 0);
    drawShapePreview(currentTool, dragStart, pos);
  }

  function onPointerUp(e) {
    if (!isDragging) return;
    isDragging = false;
    const pos = getCanvasPos(e);
    const w = Math.abs(pos.x - dragStart.x);
    const h = Math.abs(pos.y - dragStart.y);

    ctx.putImageData(dragStartSnapshot, 0, 0);

    if (w < 4 || h < 4) {
      popHistoryDiscard(); // click without dragging — nothing to commit
      return;
    }

    if (currentTool === "crop") {
      cropSelection = {
        x: Math.round(Math.min(dragStart.x, pos.x)),
        y: Math.round(Math.min(dragStart.y, pos.y)),
        w: Math.round(w),
        h: Math.round(h),
      };
      showCropOverlay(cropSelection);
      return;
    }

    if (currentTool === "blur") {
      applyPixelation(
        Math.round(Math.min(dragStart.x, pos.x)),
        Math.round(Math.min(dragStart.y, pos.y)),
        Math.round(w),
        Math.round(h)
      );
      return;
    }

    drawShapePreview(currentTool, dragStart, pos);
  }

  canvas.addEventListener("mousedown", onPointerDown);
  canvas.addEventListener("mousemove", onPointerMove);
  window.addEventListener("mouseup", onPointerUp);

  // --- Toolbar wiring ---

  toolButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      toolButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentTool = btn.dataset.tool;
      cancelPendingText();
      if (currentTool !== "crop") cancelCrop();
    });
  });

  colorButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      colorButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentColor = btn.dataset.color;
    });
  });

  undoBtn.addEventListener("click", undo);
  resetBtn.addEventListener("click", resetToOriginal);

  // --- Export ---

  const VALID_FORMATS = ["png", "jpg", "pdf"];

  chrome.storage.local.get("preferredFormat").then(({ preferredFormat }) => {
    if (VALID_FORMATS.includes(preferredFormat)) {
      formatSelect.value = preferredFormat;
    }
  });

  formatSelect.addEventListener("change", () => {
    chrome.storage.local.set({ preferredFormat: formatSelect.value });
  });

  function getCanvasBlob() {
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  // Canvas -> Blob loses any transparency to black when saved as JPEG, so
  // flatten onto a white background first (screenshots are opaque anyway).
  function toOpaqueCanvas(sourceCanvas) {
    const out = document.createElement("canvas");
    out.width = sourceCanvas.width;
    out.height = sourceCanvas.height;
    const outCtx = out.getContext("2d");
    outCtx.fillStyle = "#ffffff";
    outCtx.fillRect(0, 0, out.width, out.height);
    outCtx.drawImage(sourceCanvas, 0, 0);
    return out;
  }

  function getJpegBlob(sourceCanvas, quality = 0.92) {
    return new Promise((resolve) => sourceCanvas.toBlob(resolve, "image/jpeg", quality));
  }

  // Hand-rolled single-page PDF: a JPEG XObject drawn full-bleed on a page
  // sized to the image's pixel dimensions. No library, no network fetch —
  // keeps the extension dependency-free and lightweight.
  async function buildPdfBlob(sourceCanvas) {
    const jpegBlob = await getJpegBlob(sourceCanvas);
    const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
    const width = sourceCanvas.width;
    const height = sourceCanvas.height;

    const encoder = new TextEncoder();
    const chunks = [];
    const offsets = {};
    let offset = 0;

    function push(bytes) {
      chunks.push(bytes);
      offset += bytes.length;
    }
    function pushText(str) {
      push(encoder.encode(str));
    }

    pushText("%PDF-1.4\n");

    offsets[1] = offset;
    pushText("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

    offsets[2] = offset;
    pushText("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

    offsets[3] = offset;
    pushText(
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
        `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
    );

    offsets[4] = offset;
    pushText(
      `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
    );
    push(jpegBytes);
    pushText("\nendstream\nendobj\n");

    const contentStr = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
    const contentBytes = encoder.encode(contentStr);
    offsets[5] = offset;
    pushText(`5 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
    push(contentBytes);
    pushText("\nendstream\nendobj\n");

    const xrefStart = offset;
    let xref = "xref\n0 6\n0000000000 65535 f \n";
    for (let i = 1; i <= 5; i++) {
      xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    }
    pushText(xref);
    pushText(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

    return new Blob(chunks, { type: "application/pdf" });
  }

  async function getExportBlob(format) {
    if (format === "png") return getCanvasBlob();
    const opaque = toOpaqueCanvas(canvas);
    if (format === "jpg") return getJpegBlob(opaque);
    if (format === "pdf") return buildPdfBlob(opaque);
    throw new Error("Unsupported export format.");
  }

  downloadBtn.addEventListener("click", async () => {
    const format = formatSelect.value;
    try {
      const blob = await getExportBlob(format);
      const url = URL.createObjectURL(blob);
      await chrome.downloads.download({
        url,
        filename: timestampedFilename(format),
        saveAs: false,
      });
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setStatus(`Saved as ${format.toUpperCase()}.`);
    } catch (err) {
      console.error(err);
      setStatus("Download failed.");
    }
  });

  copyBtn.addEventListener("click", async () => {
    try {
      const blob = await getCanvasBlob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setStatus("Copied to clipboard.");
    } catch (err) {
      console.error(err);
      setStatus("Copy failed.");
    }
  });
})();
