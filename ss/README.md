# SnapCapture

A Chrome extension (Manifest V3) for screenshots and screen recording.

- **Capture** the visible area, the full page, a dragged selection, or on a delay.
- **Annotate** with arrows, boxes, ellipses, highlighter, pixelation and text; crop; undo/redo.
- **Export** as PNG, JPG or PDF, or copy straight to the clipboard.
- **Record** your screen, a window or a tab, with live annotation, and save as WebM.

Everything runs locally. The extension makes no network requests, collects nothing,
and ships **zero runtime dependencies**.

## Requirements

| Tool | Version | Why |
|---|---|---|
| Node.js | 20.19+ (see [.nvmrc](.nvmrc)) | Build and test toolchain |
| npm | 10+ | Ships with Node |
| Chrome / Chromium | 116+ | Declared as `minimum_chrome_version` |

## Getting started

```bash
npm ci        # install exactly what the lockfile pins
npm run build # emit dist/
```

Then load it into Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `dist/` folder.

`npm run dev` rebuilds on change. Chrome does not hot-reload extensions — click
the reload icon on the extension card after a rebuild, and reopen any editor or
recorder tab.

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Production build into `dist/` |
| `npm run dev` | Rebuild on change |
| `npm test` | Unit + integration tests |
| `npm run test:watch` | Tests in watch mode |
| `npm run test:coverage` | Tests with a coverage report and thresholds |
| `npm run test:e2e` | Playwright tests against a real Chromium |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run format` | Rewrite with Prettier |
| `npm run validate:manifest` | Check the built manifest and its referenced files |
| `npm run package` | Build a Chrome Web Store zip |
| `npm run verify` | Everything CI runs, except the E2E suite |

Run `npm run verify` before opening a pull request.

## Project layout

```text
src/
├── core/        Pure logic. Never imports chrome.* — this is what unit tests cover.
├── infra/       The only place chrome.* is called.
├── shared/      Message contract, constants, small helpers.
├── background/  Service worker: message routing and the capture engine.
├── content/     The injected area-selection overlay.
├── popup/ editor/ recorder/   The three UI surfaces.
tests/
├── unit/ integration/ e2e/    See docs/testing.md
public/          manifest.json and icons, copied verbatim into dist/
```

The rule that keeps this testable: **`core/` must never import `chrome.*`**.
Everything hard — slice planning, stitching, undo history, PDF bytes, frame
timing — is a pure function with no browser in sight. [docs/architecture.md](docs/architecture.md)
explains the layering and where to add a new feature.

## Permissions

Four, each doing one job, and **no host permissions**:

| Permission | Why |
|---|---|
| `activeTab` | Capture the tab the user invoked the extension on — granted only by that click |
| `scripting` | Measure the page, hide sticky headers, inject the selection overlay |
| `downloads` | Save the exported file |
| `storage` | Remember one preference: the chosen export format |

[docs/security.md](docs/security.md) justifies each in detail.

## Documentation

- [Architecture](docs/architecture.md) — layers, message flow, where features go
- [Testing](docs/testing.md) — strategy, the manual QA checklist, known limitations
- [Security](docs/security.md) — permissions, trust boundaries, threat notes
- [Release process](docs/release-process.md) — versioning, publication, rollback
- [Changelog](CHANGELOG.md)

## Known limitations

- **Very long pages are truncated.** A canvas cannot exceed 65,535 px in one
  dimension, so extremely tall pages are captured as far as that allows and the
  capture reports that it was cut short.
- **Scroll containers are not captured.** Full-page capture scrolls the window;
  content inside an inner scrolling element is captured only as it appears.
- **Restricted pages cannot be captured.** Chrome blocks extensions on
  `chrome://`, the Web Store, and other extensions' pages.
- **Recording needs its tab to stay open.** Frames are composited in the
  recorder tab; closing it stops the recording.
- Recordings export as WebM only.

## License

[MIT](LICENSE)
