# Testing

Written for: developers and reviewers working on this extension.

## Strategy

Risk-based, not coverage-chasing. The split follows where defects actually live:

| Layer | Tool | Count | What it covers |
|---|---|---|---|
| Unit | Vitest | 193 (with integration) | Pure logic in `core/` and `shared/` — slice planning, undo history, geometry, PDF bytes, frame timing, message validation |
| Integration | Vitest + a hand-written `chrome.*` fake | included above | Storage behaviour, the IndexedDB capture handoff, service-worker restart |
| E2E | Playwright + real Chromium | 29 | The built extension actually loading, the full editor flow, exports, accessibility |

```bash
npm test              # unit + integration
npm run test:coverage # with thresholds
npm run test:e2e      # Playwright, against dist/ — run `npm run build` first
```

## Coverage

Thresholds apply to `src/core/`, `src/shared/` and `src/infra/settings.ts` —
the layers where a number means something:

| Metric | Threshold | Current |
|---|---|---|
| Lines | 85% | 98.7% |
| Statements | 85% | 97.7% |
| Functions | 85% | 97.7% |
| Branches | 80% | 89.0% |

UI wiring is deliberately excluded. Including it would raise the reported
figure while lowering what it tells you; the UI is covered by E2E instead.
Coverage is a diagnostic, not evidence of correctness.

## End-to-end tests

A Chrome extension cannot be loaded by an ordinary Playwright `page` test. It
needs `chromium.launchPersistentContext` with `--load-extension`, which
[tests/e2e/fixtures.ts](../tests/e2e/fixtures.ts) sets up. Specs import `test`
and `expect` from those fixtures, not from `@playwright/test`.

The MV3 service worker only starts under the **new** headless mode. The old one
loads no extensions at all, which presents as a mysterious test failure rather
than a configuration error.

### What E2E cannot reach, and why

**`activeTab` is never granted in an automated browser.** Chrome grants it only
when the user clicks the extension's toolbar icon, and that icon is browser
chrome — Playwright cannot click it. Verified empirically: with the extension
loaded, `chrome.tabs.captureVisibleTab` fails with *"Either the `<all_urls>` or
`activeTab` permission is required"* and `chrome.scripting.executeScript` fails
with *"Cannot access contents of the page."*

So these paths are **not** covered by automated E2E:

- taking any real screenshot (visible, full page, area, delayed)
- injecting the selection overlay into a web page
- hiding sticky headers and restoring scroll position

The alternative would be giving the test build `<all_urls>`, which would mean
testing something other than what ships and claiming coverage that does not
exist. Instead the capture logic is covered exhaustively by unit tests against
`planFullPageCapture` and `toSourcePixelRect`, and the paths above are covered
by the manual checklist below.

The editor **is** covered end to end, by seeding a capture directly into the
IndexedDB handoff store and opening the editor against it. That exercises image
decode, every annotation tool, undo depth, crop, and all three export formats in
a real browser.

**Download filenames are also not assertable.** When `downloadsPath` is set,
Playwright intercepts downloads over CDP and stores each under a GUID, so
neither the name passed to `chrome.downloads.download` nor `suggestedFilename()`
survives. The E2E tests assert the downloaded file's *bytes* instead — PNG, JPEG
and PDF magic numbers, plus the PDF's structure — which is a stronger check.
Naming is covered by unit tests on `timestampedFilename`.

## Regression tests

Every fixed defect has a test that fails against the old behaviour. They are
tagged in-file so the reason survives:

| ID | Defect | Test |
|---|---|---|
| BUG-001 | Undo stack held a full-canvas `ImageData` per edit (~3.4 GB at 15 edits on a tall 2× capture) | [history.test.ts](../tests/unit/history.test.ts), [editor.spec.ts](../tests/e2e/editor.spec.ts) |
| BUG-002 | Slice plan exceeded the 65,535 px canvas limit | [full-page-plan.test.ts](../tests/unit/full-page-plan.test.ts) |
| BUG-003 | Scroll stride larger than a viewport left unpainted bands | [full-page-plan.test.ts](../tests/unit/full-page-plan.test.ts) |
| BUG-004 | `requestAnimationFrame` froze recordings in a hidden tab | [frame-clock.test.ts](../tests/unit/frame-clock.test.ts) |
| BUG-005 | Capture lost on service-worker eviction; unclaimed entries leaked | [capture-store.test.ts](../tests/integration/capture-store.test.ts) |
| BUG-007 | Unvalidated rect reached canvas sizing | [messages.test.ts](../tests/unit/messages.test.ts), [geometry.test.ts](../tests/unit/geometry.test.ts) |
| BUG-008 | Colour swatches had no accessible name | [editor.spec.ts](../tests/e2e/editor.spec.ts) |
| BUG-012 | No keyboard undo/redo | [editor.spec.ts](../tests/e2e/editor.spec.ts) |
| BUG-013 | Slow storage read overwrote the user's format choice | [editor.spec.ts](../tests/e2e/editor.spec.ts) |

When fixing a defect: reproduce it, find the root cause, **write the failing
test first**, make the smallest fix, then run the suite. A code change without a
test that would have caught it is not a fix.

## Manual QA checklist

Run before any release. Everything here is either outside what automation can
reach or genuinely needs human judgement.

### Installation and upgrade

| ID | Scenario | Steps | Expected | Pri |
|---|---|---|---|---|
| M-01 | Fresh install | Load unpacked into a clean profile | Icon appears; popup opens; no console errors | High |
| M-02 | Upgrade keeps settings | Set format to PDF, rebuild, reload the extension | Format is still PDF | High |
| M-03 | Corrupted storage | Set `preferredFormat` to `"avif"` in DevTools, open the editor | Falls back to PNG, no error | Med |
| M-04 | Browser restart | Capture, close Chrome, reopen | Extension works; no stale captures | Med |

### Capture — the paths E2E cannot reach

| ID | Scenario | Steps | Expected | Pri |
|---|---|---|---|---|
| M-10 | Visible area | Open any site, capture visible | Editor opens with the viewport image at the right size | High |
| M-11 | Full page, sticky header | Capture a long page with a fixed header | Header appears **once**, at the top; no repeats, no blank bands | High |
| M-12 | Full page restores state | Scroll to the middle, capture full page | Page returns to the same scroll position; scrollbar returns | High |
| M-13 | Very long page | Capture a page over ~55,000 px tall | Capture succeeds and is truncated cleanly — no blank region, no crash | Med |
| M-14 | Area selection | Select Area, drag a region | Overlay appears; dimensions track the drag; cropped image matches | High |
| M-15 | Area selection cancel | Select Area, press Escape | Overlay disappears; no editor tab opens | Med |
| M-16 | Tiny selection | Select Area, click without dragging | Treated as a cancel, not a 1 px capture | Low |
| M-17 | Delayed capture | Choose 5s, start, switch content | Countdown badge shows and disappears before the shot | Med |
| M-18 | Restricted page | Try to capture on `chrome://extensions` | Clear message about browser pages; no crash | High |
| M-19 | HiDPI | Capture on a 2× display | Image is at native resolution, not blurry or half-size | High |
| M-20 | Rapid clicks | Click Capture repeatedly | Buttons disable while busy; no rate-limit error | Med |
| M-21 | Two tabs | Capture in one window, then another | Each opens its own editor with the right image | Med |
| M-22 | Navigation during delay | Start a 10s delay, navigate away | Fails gracefully; no stuck countdown badge | Low |

### Editor

| ID | Scenario | Steps | Expected | Pri |
|---|---|---|---|---|
| M-30 | Clipboard copy | Annotate, Copy to Clipboard, paste into another app | The annotated image pastes | High |
| M-31 | Download filename | Download a PNG | Saved as `snapcapture-YYYYMMDD-HHMMSS.png` | High |
| M-32 | PDF opens | Download a PDF, open in a reader | Single page, image fills it, correct dimensions | High |
| M-33 | Text annotation | Type text, press Enter | Text renders in the chosen colour at the click point | Med |
| M-34 | Text cancel | Type text, press Escape | Nothing is drawn | Low |
| M-35 | Large capture | Annotate a very tall full-page capture | Stays responsive; no tab crash *(this is BUG-001)* | High |
| M-36 | Keyboard-only | Tab through the editor | Every control reachable and labelled | Med |
| M-37 | Screen reader | Navigate with a screen reader | Colour swatches announce Red/Blue/… with pressed state | Med |

### Recorder — needs real screen sharing

| ID | Scenario | Steps | Expected | Pri |
|---|---|---|---|---|
| M-40 | Record a tab | Start, share a tab, record ~10s, stop | Playback shows ~10s of motion | High |
| M-41 | **Hidden tab** | Start recording **another window**, switch away from the recorder tab for ~10s, return, stop | Video shows motion throughout — **not** a frozen frame *(this is BUG-004)* | High |
| M-42 | Picker cancelled | Start, then dismiss the share picker | Returns to idle silently; button re-enables | Med |
| M-43 | Permission denied | Deny Chrome screen recording at OS level, start | A specific message, not silence | Med |
| M-44 | Area recording | Drag a region, confirm, record | Output is cropped to that region | Med |
| M-45 | Live annotation | Enable Annotate, draw while recording | Strokes appear in the recording | Med |
| M-46 | Stop via browser bar | Click Chrome's "Stop sharing" | Recording finalises; preview appears | High |
| M-47 | Close mid-recording | Close the recorder tab while recording | Sharing indicator disappears | Med |
| M-48 | Download WebM | Download and open the result | Plays with audio in a video player | High |

### Record the result

Log each run with ID, date, build version, pass/fail, and a defect reference for
anything that failed. A failed high-priority case blocks the release.
