import { CAPTURE_TTL_MS } from '../shared/constants.js';

/**
 * Hands a captured screenshot from the service worker to the editor tab.
 *
 * Three constraints shape this:
 *
 *   - `chrome.storage.session` has a 10 MB total quota. A full-page capture
 *     at a 2x device pixel ratio easily exceeds that as a base64 PNG, so it
 *     cannot be the transport.
 *   - An in-memory Map does not survive service-worker termination, which MV3
 *     performs aggressively. If the worker is evicted between opening the
 *     editor tab and the tab asking for its image, the capture is gone and
 *     the user sees "No screenshot found" with no way back.
 *   - Entries must not accumulate. Closing the editor tab before it loads
 *     previously leaked a multi-hundred-megabyte string for the lifetime of
 *     the worker.
 *
 * IndexedDB has no comparable quota ceiling, survives worker restarts, and
 * supports a TTL sweep. The in-memory map stays in front of it as a cache for
 * the common case where the worker is still alive.
 */

const DB_NAME = 'snapcapture';
const DB_VERSION = 1;
const STORE = 'captures';

interface CaptureRecord {
  captureId: string;
  dataUrl: string;
  createdAt: number;
}

const memoryCache = new Map<string, string>();

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'captureId' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open capture store.'));
  });
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Capture store request failed.'));
  });
}

export async function saveCapture(captureId: string, dataUrl: string): Promise<void> {
  memoryCache.set(captureId, dataUrl);
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE, 'readwrite');
    const record: CaptureRecord = { captureId, dataUrl, createdAt: Date.now() };
    await promisify(tx.objectStore(STORE).put(record));
    db.close();
  } catch (error) {
    // The in-memory copy still works for the common path, so a persistence
    // failure degrades rather than breaks the capture.
    console.warn('Could not persist capture; falling back to memory only.', error);
  }
}

export async function takeCapture(captureId: string): Promise<string | null> {
  const cached = memoryCache.get(captureId);
  if (cached) {
    memoryCache.delete(captureId);
    void deleteCapture(captureId);
    return cached;
  }

  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const record = await promisify(store.get(captureId) as IDBRequest<CaptureRecord | undefined>);
    if (record) await promisify(store.delete(captureId));
    db.close();
    return record?.dataUrl ?? null;
  } catch (error) {
    console.warn('Could not read capture from store.', error);
    return null;
  }
}

async function deleteCapture(captureId: string): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE, 'readwrite');
    await promisify(tx.objectStore(STORE).delete(captureId));
    db.close();
  } catch {
    // Nothing actionable — the sweep will collect it.
  }
}

/** Discards captures the editor never claimed. Run on worker startup. */
export async function sweepExpiredCaptures(now: number = Date.now()): Promise<number> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const records = await promisify(store.getAll() as IDBRequest<CaptureRecord[]>);
    let removed = 0;
    for (const record of records) {
      if (now - record.createdAt > CAPTURE_TTL_MS) {
        await promisify(store.delete(record.captureId));
        removed++;
      }
    }
    db.close();
    return removed;
  } catch (error) {
    console.warn('Capture sweep failed.', error);
    return 0;
  }
}

/** Test seam: clears the in-process cache between cases. */
export function __clearMemoryCache(): void {
  memoryCache.clear();
}
