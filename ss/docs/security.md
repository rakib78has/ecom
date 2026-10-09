# Security

Written for: reviewers, and whoever fills in the Chrome Web Store permission
justifications.

## Data handling

The extension **collects nothing and transmits nothing**. There are no network
requests, no analytics, no telemetry, no accounts, no remote configuration.
Screenshots and recordings never leave the browser.

The only persisted data is one string — the preferred export format — in
`chrome.storage.local`. Captures pass through IndexedDB for seconds during the
handoff from the service worker to the editor tab, and are deleted as soon as
the editor claims one. Unclaimed captures are swept after five minutes.

## Permissions

Four, with no `host_permissions`. The build fails if this set grows without a
matching change to `ALLOWED_PERMISSIONS` in
[scripts/validate-build.mjs](../scripts/validate-build.mjs), so permission
creep cannot happen quietly.

### `activeTab`

Grants temporary access to the tab the user invoked the extension on, and only
because of that click. This is what makes `captureVisibleTab` and the page
scripts work.

**Why not `<all_urls>`:** it would grant standing access to every page the user
ever visits. `activeTab` gives exactly the same capability for the one tab the
user pointed at, for as long as that interaction lasts. For a screenshot tool
there is no functional difference and a large difference in what the user is
being asked to trust. It is also the single biggest factor in a smooth Web Store
review.

The trade-off is that an automated browser can never be granted it, which is why
capture cannot be covered by E2E — see [testing.md](testing.md).

### `scripting`

Runs three kinds of short, self-contained function in the active tab:

1. Read page metrics (`scrollHeight`, viewport size, device pixel ratio).
2. Scroll, hide the scrollbar, and hide fixed/sticky elements during full-page
   capture, then restore all of it.
3. Inject the selection overlay and the countdown badge.

Scoped by `activeTab`, so it only ever reaches a tab the user acted on. All
injected code is in [src/background/page-scripts.ts](../src/background/page-scripts.ts)
and [src/content/selection-overlay.ts](../src/content/selection-overlay.ts) —
no remote code, no `eval`.

### `downloads`

Saves the exported PNG/JPG/PDF or the recorded WebM. Used only in response to a
click on Download, always with an extension-generated filename, never with
`saveAs` forced.

### `storage`

Stores exactly one key, `preferredFormat`, so the editor opens on the format you
last chose. Reads are validated — an unrecognised or corrupted value falls back
to PNG rather than propagating.

## Trust boundaries

| Boundary | Risk | Mitigation |
|---|---|---|
| Injected overlay → service worker | A hostile or buggy page's isolated world sends a malformed `AREA_SELECTED` | `parseMessage()` validates every field before any handler runs; a bad rect is dropped, not clamped into a broken canvas |
| Web page → extension | A page script calls into the extension | No `externally_connectable`, so page scripts cannot reach `chrome.runtime.onMessage` at all |
| Stored settings → editor | Corrupted or forward-incompatible storage | `isExportFormat()` validates on read; falls back to PNG |
| Capture store → editor | A stale or unknown capture id | Returns a clean "no longer available" state, not an exception |

## Content Security Policy

Declared explicitly in the manifest, rather than relying on the MV3 default:

```
script-src 'self'; object-src 'self'; frame-ancestors 'none'
```

MV3's defaults already forbid inline script and remote code. Stating it makes
the intent reviewable and adds `frame-ancestors 'none'`, so extension pages
cannot be framed.

## Code-level practices

- **No `eval`, no `new Function`, no remote script.** Every byte that runs is in
  the package.
- **No `innerHTML` with untrusted data.** The overlay and badge are built with
  `createElement` and `textContent`.
- **Text annotations go through `ctx.fillText`**, onto a canvas — user text is
  never interpreted as markup, so there is no XSS path.
- **No secrets.** There is nothing to authenticate to.
- **No runtime dependencies.** The PDF writer is hand-rolled
  ([src/core/export/pdf.ts](../src/core/export/pdf.ts)) specifically to keep the
  shipped supply chain at zero. Build-time dependencies are audited in CI at
  `--audit-level=high`.

## Review checklist for a change

1. Does it add a permission? Justify it here and update `ALLOWED_PERMISSIONS`.
2. Does it add a message? Add a `parseMessage()` case and validation tests.
3. Does it add a network call? There are none today — that is a product
   decision, not an oversight. Raise it explicitly.
4. Does it store anything new? Document it here and validate it on read.
5. Does it add a dependency? Weigh it against zero runtime dependencies.
6. Does it render user-supplied or page-supplied content into the DOM?
7. Run `npm audit` and `npm run validate:manifest`.

## Reporting a vulnerability

Open a private security advisory on the repository rather than a public issue.
