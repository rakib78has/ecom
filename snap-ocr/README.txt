SNAP OCR - Chrome Extension
============================

Snap OCR lets you drag-select any area of your screen and instantly get
back editable text. It runs 100% offline in your browser using Tesseract.js
- no accounts, no API keys, no cost, and nothing is ever sent over the
internet. All OCR processing happens locally on your machine.


1. HOW TO INSTALL (load as an "unpacked" extension)
-----------------------------------------------------
Chrome extensions that aren't from the Web Store are installed in
"Developer Mode" as an "unpacked" extension. This is completely safe for
extensions you build yourself.

  1. Open Chrome and go to:  chrome://extensions
  2. In the top-right corner, turn on the "Developer mode" toggle.
  3. Click the "Load unpacked" button that appears on the top-left.
  4. In the file picker, select this folder (the one containing
     manifest.json - i.e. the "snap-ocr" folder). Click "Select Folder".
  5. Snap OCR should now appear in your extensions list with a blue "S"
     icon. Click the puzzle-piece icon in Chrome's toolbar and "pin" Snap
     OCR so its icon is always visible.

That's it - no build step, no internet connection required after this
point. All the OCR files are already bundled inside the "lib" folder.

Optional but recommended: if you want to use Snap OCR on PDF files opened
directly from your hard drive (file:// URLs), go to chrome://extensions,
click "Details" under Snap OCR, and turn on "Allow access to file URLs".


2. DAY-TO-DAY USAGE
---------------------
  1. Go to any webpage, PDF (opened in Chrome's built-in PDF viewer), or
     a video that's playing/paused on screen.
  2. Activate Snap OCR either by:
       - Clicking the Snap OCR toolbar icon, OR
       - Pressing the keyboard shortcut  Ctrl+Shift+U  (Cmd+Shift+U on Mac)
  3. Your screen dims slightly and the cursor turns into a crosshair.
     Click and hold the left mouse button and drag a rough rectangle around
     the text you want to capture.
  4. Release the mouse - the box doesn't capture yet. Small round handles
     appear on its corners and edges so you can fine-tune it:
       - Drag any handle to resize that edge/corner.
       - Drag inside the box to move the whole thing.
       - Click outside the box to throw it away and draw a new one.
  5. A small toolbar appears below/above the box with three buttons:
       - "Capture"   - runs OCR on the current box (Enter does the same)
       - "Recapture" - clears the box so you can drag a brand new one
                       without having to click outside it first
       - "Cancel"    - backs out entirely (Escape does the same)
  6. A new tab opens showing:
       - A preview of the image you selected
       - A "Language" dropdown (see below)
       - A progress bar while OCR is running (first run is a bit slower
         while the OCR engine spins up; later runs are faster)
       - A text box containing the extracted, editable text
  7. Use the buttons at the bottom of that tab:
       - "Copy text"        - copies the extracted text to your clipboard
       - "Open Google Docs"  - copies the text and opens a blank Google
                                 Doc (docs.new) so you can paste it in
                                 with Ctrl+V


2b. USING OTHER LANGUAGES
---------------------------
Snap OCR ships with English built in, so it works fully offline out of the
box with no setup. The "Language" dropdown on the result tab lists every
language Tesseract supports (100+).

  - English is marked "(offline)" - it never needs the internet.
  - Any other language you pick is downloaded once (a single small file
    from the public Tesseract project's data servers) the first time you
    use it, then your browser caches it, so using that same language
    again later also works offline.
  - Only the language model itself is downloaded. Your screenshots and
    extracted text are never uploaded anywhere, no matter which language
    you pick.
  - Your last-used language is remembered for next time you open Snap OCR.
  - If you're offline and pick a language you haven't used before, that
    download will fail - switch back to a previously-used language (or
    English) or reconnect to the internet and try again.


2c. LIGHT / DARK THEME
-------------------------
The result tab (where your extracted text shows up) has a theme button
next to the "Snap OCR" title, top-right. Click it to cycle through:

  System (follows your OS/browser dark mode setting) -> Light -> Dark -> ...

Your choice is remembered for next time. This only affects the result tab
itself - the dimmed selection overlay you draw on stays the same on every
page, since it's meant to work over arbitrary websites of any color.


3. TROUBLESHOOTING
---------------------
- "Nothing happens when I click the icon or press the shortcut."
  Chrome blocks extensions from running on its own internal pages, such
  as chrome://extensions, chrome://settings, the Chrome Web Store, or
  other browser/extension pages. Try Snap OCR on a normal webpage, a PDF,
  or a video instead. You'll get a small notification if this happens.

- "It doesn't work on a PDF I opened from a file on my computer."
  Make sure "Allow access to file URLs" is turned on for Snap OCR (see
  the installation steps above, under extension Details).

- "The keyboard shortcut doesn't do anything / conflicts with something
  else."
  Go to chrome://extensions/shortcuts and check/change the shortcut for
  Snap OCR there.

- "The extracted text is wrong or missing some words."
  Tesseract (the OCR engine) works best on clear, reasonably large,
  horizontal text with good contrast. Try dragging a slightly larger or
  tighter box, zooming the page in first (Ctrl + '+') before selecting,
  or making sure the text isn't blurry (e.g. pause a video fully before
  selecting rather than capturing it mid-motion).

- "The first capture after installing feels slow."
  This is expected - the first time Snap OCR runs, your browser loads
  and initializes the OCR engine and language data (all still 100% local,
  no internet needed). Later captures reuse the cached engine and run
  noticeably faster.

- "I get a permission / blocked page warning."
  Snap OCR only ever asks for access to the current tab you're using it
  on (when you click the icon or press the shortcut) - it does not run in
  the background on every page and does not need "read your browsing
  history" style permissions.

- Something looks broken after editing the extension's files: go to
  chrome://extensions and click the refresh/reload icon on the Snap OCR
  card, then reload the page you were testing on.


That's it - enjoy never retyping screenshotted text again.
