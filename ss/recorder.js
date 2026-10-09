(function () {
  const idleView = document.getElementById("idle-view");
  const stageView = document.getElementById("stage-view");
  const resultView = document.getElementById("result-view");
  const selectToolbar = document.getElementById("select-toolbar");
  const recordToolbar = document.getElementById("record-toolbar");
  const statusEl = document.getElementById("status");

  const startBtn = document.getElementById("start-btn");
  const fullFrameBtn = document.getElementById("full-frame-btn");
  const confirmAreaBtn = document.getElementById("confirm-area-btn");
  const annotateToggle = document.getElementById("annotate-toggle");
  const clearAnnotationsBtn = document.getElementById("clear-annotations-btn");
  const colorButtons = Array.from(document.querySelectorAll(".color-btn"));
  const stopBtn = document.getElementById("stop-btn");
  const timerEl = document.getElementById("timer");
  const previewVideo = document.getElementById("preview-video");
  const downloadBtn = document.getElementById("download-btn");
  const againBtn = document.getElementById("again-btn");

  const canvas = document.getElementById("stage-canvas");
  const ctx = canvas.getContext("2d");

  const STROKE_WIDTH = 4;

  let phase = "idle"; // idle | selecting | recording | result
  let rawStream = null;
  let sourceVideo = null;
  let composedStream = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordedBlob = null;
  let recordedUrl = null;
  let rafId = null;
  let timerInterval = null;
  let startedAt = 0;

  let cropRect = null; // {x, y, w, h} in native captured-video pixel space

  // Drag-to-select state (selecting phase)
  let isDraggingSelect = false;
  let selectStart = { x: 0, y: 0 };
  let selectCurrent = { x: 0, y: 0 };
  let pendingSelection = null;

  // Live annotation state (recording phase)
  let annotateMode = false;
  let annotationColor = "#ef4444";
  let strokes = [];
  let activeStroke = null;

  function setStatus(message) {
    statusEl.textContent = message || "";
  }

  function showView(view) {
    [idleView, stageView, resultView].forEach((v) => v.classList.add("hidden"));
    view.classList.remove("hidden");
  }

  function timestampedFilename(ext) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
      d.getHours()
    )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `snapcapture-${stamp}.${ext}`;
  }

  function pickSupportedMimeType() {
    const candidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }

  function updateTimer() {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const ss = String(elapsed % 60).padStart(2, "0");
    timerEl.textContent = `${mm}:${ss}`;
  }

  function getCanvasPos(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (evt.clientX - rect.left) * scaleX,
      y: (evt.clientY - rect.top) * scaleY,
    };
  }

  function stopAllTracks() {
    if (rawStream) rawStream.getTracks().forEach((t) => t.stop());
    if (composedStream) composedStream.getTracks().forEach((t) => t.stop());
    rawStream = null;
    composedStream = null;
  }

  // --- Capture setup ---

  async function startCapture() {
    setStatus("");
    try {
      rawStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });
    } catch (err) {
      // User dismissed the "choose what to share" picker — not an error.
      return;
    }

    sourceVideo = document.createElement("video");
    sourceVideo.muted = true;
    sourceVideo.srcObject = rawStream;
    await sourceVideo.play();
    if (!sourceVideo.videoWidth) {
      await new Promise((resolve) =>
        sourceVideo.addEventListener("loadedmetadata", resolve, { once: true })
      );
    }

    rawStream.getVideoTracks()[0].addEventListener("ended", () => {
      if (phase === "recording") {
        stopRecording();
      } else if (phase === "selecting") {
        cancelAndReset();
      }
    });

    enterSelectPhase();
  }

  function enterSelectPhase() {
    phase = "selecting";
    pendingSelection = null;
    isDraggingSelect = false;
    canvas.width = sourceVideo.videoWidth;
    canvas.height = sourceVideo.videoHeight;
    confirmAreaBtn.classList.add("hidden");
    recordToolbar.classList.add("hidden");
    selectToolbar.classList.remove("hidden");
    showView(stageView);
    rafId = requestAnimationFrame(selectTick);
  }

  function selectTick() {
    if (phase !== "selecting") return;
    ctx.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);

    const sel = isDraggingSelect ? currentDragRect() : pendingSelection;
    if (sel) {
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = "#2563eb";
      ctx.fillStyle = "rgba(37, 99, 235, 0.12)";
      ctx.fillRect(sel.x, sel.y, sel.w, sel.h);
      ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
      ctx.restore();
    }
    rafId = requestAnimationFrame(selectTick);
  }

  function currentDragRect() {
    return {
      x: Math.min(selectStart.x, selectCurrent.x),
      y: Math.min(selectStart.y, selectCurrent.y),
      w: Math.abs(selectCurrent.x - selectStart.x),
      h: Math.abs(selectCurrent.y - selectStart.y),
    };
  }

  function beginRecording() {
    cancelAnimationFrame(rafId);
    phase = "recording";
    canvas.width = cropRect.w;
    canvas.height = cropRect.h;
    strokes = [];
    activeStroke = null;
    annotateMode = false;
    updateAnnotateUI();

    selectToolbar.classList.add("hidden");
    recordToolbar.classList.remove("hidden");

    const canvasStream = canvas.captureStream(30);
    const audioTracks = rawStream.getAudioTracks();
    composedStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);

    recordedChunks = [];
    const mimeType = pickSupportedMimeType();
    mediaRecorder = new MediaRecorder(composedStream, mimeType ? { mimeType } : undefined);
    mediaRecorder.addEventListener("dataavailable", (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    });
    mediaRecorder.addEventListener("stop", handleRecordingStopped);
    mediaRecorder.start(1000);

    startedAt = Date.now();
    timerEl.textContent = "00:00";
    timerInterval = setInterval(updateTimer, 500);

    rafId = requestAnimationFrame(recordTick);
  }

  function recordTick() {
    if (phase !== "recording") return;
    ctx.drawImage(
      sourceVideo,
      cropRect.x,
      cropRect.y,
      cropRect.w,
      cropRect.h,
      0,
      0,
      canvas.width,
      canvas.height
    );
    drawStrokes();
    rafId = requestAnimationFrame(recordTick);
  }

  function drawStrokes() {
    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue;
      ctx.save();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  function updateAnnotateUI() {
    annotateToggle.classList.toggle("active", annotateMode);
    canvas.style.cursor = phase === "recording" && annotateMode ? "crosshair" : "default";
  }

  // --- Pointer interaction (shared by select-drag and annotate-draw) ---

  function onCanvasPointerDown(e) {
    e.preventDefault();
    const pos = getCanvasPos(e);

    if (phase === "selecting") {
      isDraggingSelect = true;
      selectStart = pos;
      selectCurrent = pos;
      return;
    }

    if (phase === "recording" && annotateMode) {
      activeStroke = { color: annotationColor, width: STROKE_WIDTH, points: [pos] };
      strokes.push(activeStroke);
    }
  }

  function onCanvasPointerMove(e) {
    const pos = getCanvasPos(e);
    if (phase === "selecting" && isDraggingSelect) {
      selectCurrent = pos;
      return;
    }
    if (phase === "recording" && activeStroke) {
      activeStroke.points.push(pos);
    }
  }

  function onCanvasPointerUp() {
    if (phase === "selecting" && isDraggingSelect) {
      isDraggingSelect = false;
      const rect = currentDragRect();
      if (rect.w < 20 || rect.h < 20) {
        pendingSelection = null;
        confirmAreaBtn.classList.add("hidden");
      } else {
        pendingSelection = rect;
        confirmAreaBtn.classList.remove("hidden");
      }
      return;
    }
    activeStroke = null;
  }

  canvas.addEventListener("mousedown", onCanvasPointerDown);
  canvas.addEventListener("mousemove", onCanvasPointerMove);
  window.addEventListener("mouseup", onCanvasPointerUp);

  // --- Toolbar wiring ---

  fullFrameBtn.addEventListener("click", () => {
    cropRect = { x: 0, y: 0, w: sourceVideo.videoWidth, h: sourceVideo.videoHeight };
    beginRecording();
  });

  confirmAreaBtn.addEventListener("click", () => {
    if (!pendingSelection) return;
    cropRect = pendingSelection;
    beginRecording();
  });

  annotateToggle.addEventListener("click", () => {
    annotateMode = !annotateMode;
    updateAnnotateUI();
  });

  clearAnnotationsBtn.addEventListener("click", () => {
    strokes = [];
    activeStroke = null;
  });

  colorButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      colorButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      annotationColor = btn.dataset.color;
    });
  });

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    } else {
      finishStop();
    }
  }

  function finishStop() {
    cancelAnimationFrame(rafId);
    clearInterval(timerInterval);
  }

  function handleRecordingStopped() {
    finishStop();
    stopAllTracks();
    recordedBlob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "video/webm" });
    recordedUrl = URL.createObjectURL(recordedBlob);
    previewVideo.src = recordedUrl;
    phase = "result";
    recordToolbar.classList.add("hidden");
    showView(resultView);
  }

  function cancelAndReset() {
    finishStop();
    stopAllTracks();
    phase = "idle";
    selectToolbar.classList.add("hidden");
    recordToolbar.classList.add("hidden");
    showView(idleView);
  }

  function resetToIdle() {
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
      recordedUrl = null;
    }
    recordedBlob = null;
    previewVideo.src = "";
    setStatus("");
    showView(idleView);
    phase = "idle";
  }

  startBtn.addEventListener("click", startCapture);
  stopBtn.addEventListener("click", stopRecording);
  againBtn.addEventListener("click", resetToIdle);

  downloadBtn.addEventListener("click", async () => {
    if (!recordedBlob) return;
    try {
      const url = URL.createObjectURL(recordedBlob);
      await chrome.downloads.download({
        url,
        filename: timestampedFilename("webm"),
        saveAs: false,
      });
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setStatus("Saved to Downloads.");
    } catch (err) {
      console.error(err);
      setStatus("Download failed.");
    }
  });
})();
