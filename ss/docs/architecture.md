# Architecture

Written for: developers adding features to or reviewing this extension.

## The one rule

**`src/core/` must never import `chrome.*`.**

Everything else follows from that. The logic that can actually be wrong — slice
planning, image stitching, undo history, PDF byte layout, frame timing — lives
in `core/` as pure functions. They run in Node, in milliseconds, with no browser
and no mocking. Everything that touches a browser API lives in `infra/` behind a
small interface.

Before the refactor, all of this was mixed into two large files that could only
be exercised by hand in a loaded extension. That is why the defects in
[CHANGELOG.md](../CHANGELOG.md) survived: nothing could observe them.

## Layers

| Layer | Directory | Imports `chrome.*`? | Tested by |
|---|---|---|---|
| Core | `src/core/` | **Never** | Unit |
| Infrastructure | `src/infra/` | Yes — exclusively | Integration |
| Shared | `src/shared/` | No | Unit |
| Background | `src/background/` | Via `infra/` | Integration + E2E |
| Content | `src/content/` | `chrome.runtime` only | E2E |
| UI | `src/popup/`, `src/editor/`, `src/recorder/` | Via `infra/` | E2E |

Dependencies point one way: UI and background depend on core, infra and shared.
Core depends on shared only. Nothing in `core/` or `shared/` imports upward, so
there are no cycles to break.

## Component map

```
┌──────────────┐  CAPTURE_VISIBLE / CAPTURE_FULL_PAGE
│    popup     │  START_AREA_SELECTION / START_DELAYED_CAPTURE
└──────┬───────┘ ─────────────────────────────┐
       ▲  FULL_PAGE_PROGRESS                  ▼
       └───────────────────────────── ┌──────────────────┐
                                      │  service-worker  │
┌──────────────────┐  AREA_SELECTED   │  (message router)│
│ selection-overlay│ ────────────────▶│                  │
│  (injected)      │◀── scripting ────│  capture-engine  │
└──────────────────┘    .executeScript└────────┬─────────┘
                                               │
                        ┌──────────────────────┴───────────┐
                        ▼                                  ▼
                 ┌─────────────┐  FETCH_CAPTURE   ┌─────────────────┐
                 │   editor    │◀────────────────▶│  capture-store  │
                 └─────────────┘                  │  (IndexedDB)    │
                                                  └─────────────────┘

┌──────────────┐  Standalone: talks to chrome.downloads only.
│   recorder   │  Never contacts the service worker.
└──────────────┘
```

## Key flows

### Capture → editor handoff

1. The popup sends a capture message.
2. The service worker resolves the active tab and calls into `capture-engine`.
3. The resulting data URL is written to `capture-store` (IndexedDB) under a
   fresh UUID — **before** the editor tab is created.
4. The worker opens `editor/editor.html?cid=<uuid>`.
5. The editor sends `FETCH_CAPTURE`; the worker reads the image out, deletes it,
   and responds.

**Why IndexedDB and not `chrome.storage.session`:** session storage caps at
10 MB in total, and a full-page capture at a 2× device pixel ratio easily
exceeds that as a base64 PNG. **Why not an in-memory `Map`:** MV3 terminates
service workers aggressively, and an eviction between steps 4 and 5 lost the
capture permanently. IndexedDB has no comparable quota ceiling, survives
restarts, and supports the TTL sweep that stops unclaimed captures accumulating.

### Full-page capture

`planFullPageCapture()` ([src/core/capture/full-page-plan.ts](../src/core/capture/full-page-plan.ts))
decides where to scroll and how large the canvas must be. Two hard limits shape it:

- **A canvas dimension cannot exceed 65,535 device pixels.** The plan is bounded
  by that limit and sets `truncated` when the page did not fit.
- **The scroll stride cannot exceed one viewport.** Each capture paints exactly
  one viewport of pixels, so a larger stride does not spread coverage thinner —
  it leaves bands that are never painted at all.

The engine then scrolls, settles, captures (respecting Chrome's ~2/second rate
limit on `captureVisibleTab`), and stitches. Fixed and sticky elements are
hidden from the second slice onward, re-run every iteration because pages mount
new sticky elements as you scroll.

### Recorder frame timing

The recorder composites each frame into a canvas and records that canvas with
`MediaRecorder`. The frame source is `requestVideoFrameCallback`, falling back to
`setInterval` — deliberately **not** `requestAnimationFrame`, which stops firing
entirely while a page is hidden. Since the whole point of the feature is
recording *another* window, an rAF loop froze the recording as soon as the user
switched away, while the timer kept counting and the UI still said "recording".

## Messaging

Every message is a member of the `Message` union in
[src/shared/messages.ts](../src/shared/messages.ts), and every one is validated
at runtime by `parseMessage()` before it reaches a handler.

Typing alone is not enough. The selection overlay runs inside an arbitrary web
page's tab, and a malformed payload from there used to reach canvas-sizing
arithmetic, where a `NaN` or negative dimension produced an opaque allocation
failure instead of a clean error. `parseMessage()` returns `null` for anything it
does not recognise, and the router ignores it.

Adding a message means: extend the union, add a case to `parseMessage()`, add a
case to the router, and add validation tests.

## Build

Two Vite passes, because the outputs are different kinds of script:

| Pass | Config | Output |
|---|---|---|
| Pages + worker | [vite.config.ts](../vite.config.ts) | ES modules; the worker at a fixed `service-worker.js` because the manifest names it |
| Overlay | [vite.content.config.ts](../vite.content.config.ts) | A single IIFE — `executeScript({ files })` evaluates a **classic** script, so module syntax would fail silently at runtime |

`public/` (manifest and icons) is copied verbatim. The manifest is hand-written
rather than generated, so what ships is what you can read in review.

`npm run validate:manifest` then checks the built output: manifest validity,
that the permission set has not grown, that every referenced path was emitted,
that the worker's imports resolve, and that the overlay really is module-free.

## Where to add a feature

| Adding… | Goes in | Also update |
|---|---|---|
| A new annotation tool | `core/annotate/render.ts` + `types.ts` | editor UI, unit tests |
| A new export format | `core/export/` | `EXPORT_FORMATS`, editor UI, tests |
| A new capture mode | `core/capture/` + `background/capture-engine.ts` | message union, router, popup |
| Anything touching `chrome.*` | `infra/` | integration tests |
| A new message | `shared/messages.ts` | router, `parseMessage` tests |

If a new feature needs a permission, it needs an entry in `ALLOWED_PERMISSIONS`
in [scripts/validate-build.mjs](../scripts/validate-build.mjs) and a
justification in [security.md](security.md). The build fails otherwise — that is
deliberate, so permission growth is always a visible, reviewed decision.
