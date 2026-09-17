'use strict';

const PENDING_IMAGE_KEY = 'snapocr_pending_image';
const LAST_LANG_KEY = 'snapocr_last_lang';
const THEME_KEY = 'snapocr_theme';
const DEFAULT_LANG = 'eng';
const THEME_ORDER = ['system', 'light', 'dark'];
const THEME_LABELS = { system: '🖥️ System', light: '☀️ Light', dark: '🌙 Dark' };

const themeToggleEl = document.getElementById('themeToggle');

const previewEl = document.getElementById('preview');
const progressLabelEl = document.getElementById('progressLabel');
const progressFillEl = document.getElementById('progressFill');
const outputEl = document.getElementById('output');
const copyBtn = document.getElementById('copyBtn');
const docsBtn = document.getElementById('docsBtn');
const statusTextEl = document.getElementById('statusText');
const errorTextEl = document.getElementById('errorText');
const langSelectEl = document.getElementById('langSelect');
const langHintEl = document.getElementById('langHint');

let capturedDataUrl = null;
let isRunning = false;

function showError(message) {
  errorTextEl.textContent = message;
  errorTextEl.hidden = false;
  progressLabelEl.textContent = 'Failed';
}

function clearError() {
  errorTextEl.hidden = true;
  errorTextEl.textContent = '';
}

function setProgress(label, fraction) {
  progressLabelEl.textContent = label;
  progressFillEl.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

function populateLanguageDropdown(selected) {
  langSelectEl.innerHTML = '';
  TESSERACT_LANGUAGES.forEach(({ code, name }) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = TESSERACT_BUNDLED_LANGUAGES.has(code) ? `${name} (offline)` : name;
    langSelectEl.appendChild(opt);
  });
  langSelectEl.value = selected;
}

function updateLangHint(lang) {
  langHintEl.textContent = TESSERACT_BUNDLED_LANGUAGES.has(lang)
    ? ''
    : 'First use downloads this language once, then it works offline.';
}

async function runOCR(lang) {
  if (!capturedDataUrl || isRunning) return;
  isRunning = true;
  clearError();
  copyBtn.disabled = true;
  docsBtn.disabled = true;
  langSelectEl.disabled = true;
  statusTextEl.textContent = '';
  setProgress('Starting OCR...', 0);

  const isBundled = TESSERACT_BUNDLED_LANGUAGES.has(lang);
  const workerOptions = {
    workerPath: chrome.runtime.getURL('lib/worker.min.js'),
    corePath: chrome.runtime.getURL('lib/tesseract-core.wasm.js'),
    workerBlobURL: false,
    logger: (m) => {
      if (typeof m.progress === 'number') {
        setProgress(m.status || 'Working...', m.progress);
      }
    },
  };

  if (isBundled) {
    workerOptions.langPath = chrome.runtime.getURL('lib');
    workerOptions.gzip = false;
  }
  // Non-bundled languages: leave langPath/gzip unset so Tesseract.js falls
  // back to its default public CDN, and caches the result in IndexedDB for
  // next time.

  let worker;
  try {
    worker = await Tesseract.createWorker(lang, Tesseract.OEM.LSTM_ONLY, workerOptions);
    const { data } = await worker.recognize(capturedDataUrl);
    outputEl.value = (data && data.text) ? data.text.trim() : '';
    setProgress('Done', 1);
    statusTextEl.textContent = outputEl.value ? '' : 'No text detected in this region.';
    copyBtn.disabled = false;
    docsBtn.disabled = false;
  } catch (err) {
    console.error('Snap OCR: recognition failed', err);
    showError(`OCR failed: ${err && err.message ? err.message : err}`);
  } finally {
    if (worker) {
      try { await worker.terminate(); } catch (_) { /* ignore */ }
    }
    isRunning = false;
    langSelectEl.disabled = false;
  }
}

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  themeToggleEl.textContent = THEME_LABELS[theme] || THEME_LABELS.system;
}

async function initTheme() {
  const { [THEME_KEY]: stored } = await chrome.storage.local.get(THEME_KEY);
  applyTheme(THEME_ORDER.includes(stored) ? stored : 'system');
}

themeToggleEl.addEventListener('click', async () => {
  const { [THEME_KEY]: stored } = await chrome.storage.local.get(THEME_KEY);
  const current = THEME_ORDER.includes(stored) ? stored : 'system';
  const next = THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
  await chrome.storage.local.set({ [THEME_KEY]: next });
  applyTheme(next);
});

initTheme();

async function init() {
  const stored = await chrome.storage.session.get(PENDING_IMAGE_KEY);
  capturedDataUrl = stored[PENDING_IMAGE_KEY];

  if (!capturedDataUrl) {
    showError('No captured image found. Please select a region again from the page.');
    return;
  }

  previewEl.src = capturedDataUrl;
  chrome.storage.session.remove(PENDING_IMAGE_KEY);

  const { [LAST_LANG_KEY]: lastLang } = await chrome.storage.local.get(LAST_LANG_KEY);
  const initialLang = lastLang || DEFAULT_LANG;

  populateLanguageDropdown(initialLang);
  updateLangHint(initialLang);
  await runOCR(initialLang);
}

langSelectEl.addEventListener('change', async () => {
  const lang = langSelectEl.value;
  updateLangHint(lang);
  chrome.storage.local.set({ [LAST_LANG_KEY]: lang });
  await runOCR(lang);
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(outputEl.value);
    statusTextEl.textContent = 'Copied!';
    setTimeout(() => { statusTextEl.textContent = ''; }, 1500);
  } catch (err) {
    statusTextEl.textContent = 'Copy failed - select the text manually.';
  }
});

docsBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(outputEl.value);
    statusTextEl.textContent = 'Copied - paste with Ctrl+V in the new doc.';
  } catch (err) {
    statusTextEl.textContent = '';
  }
  window.open('https://docs.new', '_blank');
});

init();
