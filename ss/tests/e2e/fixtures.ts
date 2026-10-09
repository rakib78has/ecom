import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';

/**
 * Playwright fixtures for testing a loaded Chrome extension.
 *
 * An extension cannot be loaded into the default browser Playwright provides.
 * It requires `chromium.launchPersistentContext` with `--load-extension`
 * pointed at a built directory, and MV3 service workers only start in a
 * headed context or the new headless mode — the old headless mode silently
 * loads no extensions at all, which looks like a test bug rather than a
 * configuration one.
 */

const EXTENSION_PATH = resolve(import.meta.dirname, '../../dist');

export interface ExtensionFixtures {
  context: BrowserContext;
  /** The extension's generated id, needed to build chrome-extension:// URLs. */
  extensionId: string;
  /** The MV3 background service worker. */
  serviceWorker: Worker;
  /** Directory Chromium is configured to download into. */
  downloadsPath: string;
}

export const test = base.extend<ExtensionFixtures>({
  // Playwright derives a fixture's dependencies from this destructuring
  // pattern, so the empty one is required even though this fixture has none.
  // eslint-disable-next-line no-empty-pattern
  downloadsPath: async ({}, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'snapcapture-downloads-'));
    await use(dir);
    await rm(dir, { recursive: true, force: true });
  },

  context: async ({ downloadsPath }, use) => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'snapcapture-profile-'));

    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true, // the new headless mode, which does support extensions
      downloadsPath,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        // Without this, the share picker blocks getDisplayMedia forever.
        '--auto-accept-this-tab-capture',
      ],
    });

    await use(context);
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  },

  serviceWorker: async ({ context }, use) => {
    // The worker may already have started before the fixture runs.
    const existing = context.serviceWorkers();
    const worker = existing[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    const id = new URL(serviceWorker.url()).host;
    await use(id);
  },
});

export const expect = test.expect;

/** Builds a URL for a page inside the extension. */
export function extensionUrl(extensionId: string, path: string): string {
  return `chrome-extension://${extensionId}/${path}`;
}
