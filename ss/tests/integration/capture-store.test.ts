import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  __clearMemoryCache,
  saveCapture,
  sweepExpiredCaptures,
  takeCapture,
} from '../../src/infra/capture-store.js';
import { CAPTURE_TTL_MS } from '../../src/shared/constants.js';

const DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

/**
 * Simulates the service worker being evicted: everything held in worker
 * memory is gone, but anything written to IndexedDB survives.
 */
function simulateServiceWorkerRestart(): void {
  __clearMemoryCache();
}

beforeEach(async () => {
  __clearMemoryCache();
  // Each case starts from an empty store.
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase('snapcapture');
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

describe('capture store', () => {
  it('hands a saved capture back to the editor', async () => {
    await saveCapture('abc', DATA_URL);

    expect(await takeCapture('abc')).toBe(DATA_URL);
  });

  it('returns null for an unknown id', async () => {
    expect(await takeCapture('never-existed')).toBeNull();
  });

  it('is a one-time handoff — a second read finds nothing', async () => {
    await saveCapture('abc', DATA_URL);

    expect(await takeCapture('abc')).toBe(DATA_URL);
    expect(await takeCapture('abc')).toBeNull();
  });

  it('keeps separate captures independent', async () => {
    await saveCapture('first', 'data:image/png;base64,AAA=');
    await saveCapture('second', 'data:image/png;base64,BBB=');

    expect(await takeCapture('second')).toBe('data:image/png;base64,BBB=');
    expect(await takeCapture('first')).toBe('data:image/png;base64,AAA=');
  });

  // --- BUG-005 regression --------------------------------------------------
  // The capture used to live only in a Map in service-worker memory. MV3
  // evicts workers aggressively, so a restart between opening the editor tab
  // and the tab requesting its image lost the screenshot permanently; the
  // user saw "No screenshot found" with no way to recover it.
  describe('regression: survives service worker eviction (BUG-005)', () => {
    it('returns the capture after the worker restarts', async () => {
      await saveCapture('survivor', DATA_URL);

      simulateServiceWorkerRestart();

      expect(await takeCapture('survivor')).toBe(DATA_URL);
    });

    it('still consumes the capture exactly once after a restart', async () => {
      await saveCapture('survivor', DATA_URL);
      simulateServiceWorkerRestart();

      expect(await takeCapture('survivor')).toBe(DATA_URL);
      expect(await takeCapture('survivor')).toBeNull();
    });

    it('handles a capture large enough to exceed the storage.session quota', async () => {
      // storage.session caps at 10 MB total, which is why it could not be the
      // transport. IndexedDB has no comparable ceiling.
      const large = `data:image/png;base64,${'A'.repeat(12 * 1024 * 1024)}`;
      await saveCapture('large', large);

      simulateServiceWorkerRestart();

      expect(await takeCapture('large')).toBe(large);
    });
  });

  // --- BUG-005 (second defect) ---------------------------------------------
  // Entries were only deleted on a successful fetch, so closing the editor
  // tab before it loaded leaked a multi-hundred-megabyte string for the
  // lifetime of the worker.
  describe('regression: unclaimed captures do not accumulate (BUG-005)', () => {
    it('sweeps captures older than the TTL', async () => {
      await saveCapture('stale', DATA_URL);
      simulateServiceWorkerRestart();

      const removed = await sweepExpiredCaptures(Date.now() + CAPTURE_TTL_MS + 1000);

      expect(removed).toBe(1);
      expect(await takeCapture('stale')).toBeNull();
    });

    it('leaves captures that are still within the TTL', async () => {
      await saveCapture('fresh', DATA_URL);
      simulateServiceWorkerRestart();

      const removed = await sweepExpiredCaptures(Date.now() + 1000);

      expect(removed).toBe(0);
      expect(await takeCapture('fresh')).toBe(DATA_URL);
    });

    it('sweeps only the expired entries in a mixed store', async () => {
      await saveCapture('old', DATA_URL);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const cutoff = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 5));
      await saveCapture('new', DATA_URL);
      simulateServiceWorkerRestart();

      await sweepExpiredCaptures(cutoff + CAPTURE_TTL_MS);

      expect(await takeCapture('old')).toBeNull();
      expect(await takeCapture('new')).toBe(DATA_URL);
    });

    it('reports zero rather than throwing when the store is empty', async () => {
      expect(await sweepExpiredCaptures()).toBe(0);
    });

    it('removes the persisted copy when the memory cache serves the read', async () => {
      await saveCapture('cached', DATA_URL);

      // Served from memory, which must also clear the IndexedDB row.
      expect(await takeCapture('cached')).toBe(DATA_URL);

      // Let the fire-and-forget delete settle, then prove nothing is left.
      await new Promise((resolve) => setTimeout(resolve, 20));
      simulateServiceWorkerRestart();
      expect(await takeCapture('cached')).toBeNull();
    });
  });
});
