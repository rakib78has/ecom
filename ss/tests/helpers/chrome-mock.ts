import { vi } from 'vitest';

/**
 * Minimal in-memory stand-in for the Chrome extension APIs this project uses.
 *
 * Deliberately hand-written rather than pulled from a library: the surface is
 * four namespaces, and a fake we control lets a test assert on exactly what
 * was called without the indirection of a mocking framework's own semantics.
 */

export interface ChromeMock {
  storage: {
    local: {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
      __data: Record<string, unknown>;
      __failNext: boolean;
    };
  };
  downloads: { download: ReturnType<typeof vi.fn> };
  runtime: {
    sendMessage: ReturnType<typeof vi.fn>;
    getURL: ReturnType<typeof vi.fn>;
    id: string;
  };
  tabs: {
    query: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    captureVisibleTab: ReturnType<typeof vi.fn>;
  };
  scripting: { executeScript: ReturnType<typeof vi.fn> };
}

export function createChromeMock(): ChromeMock {
  const storageData: Record<string, unknown> = {};

  const local = {
    __data: storageData,
    __failNext: false,
    get: vi.fn(async (key: string | string[] | null) => {
      if (local.__failNext) {
        local.__failNext = false;
        throw new Error('Storage unavailable');
      }
      if (key === null || key === undefined) return { ...storageData };
      const keys = Array.isArray(key) ? key : [key];
      return Object.fromEntries(
        keys.filter((k) => k in storageData).map((k) => [k, storageData[k]])
      );
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      if (local.__failNext) {
        local.__failNext = false;
        throw new Error('Storage unavailable');
      }
      Object.assign(storageData, items);
    }),
  };

  return {
    storage: { local },
    downloads: { download: vi.fn(async () => 1) },
    runtime: {
      id: 'test-extension-id',
      sendMessage: vi.fn(async () => ({ ok: true })),
      getURL: vi.fn((path: string) => `chrome-extension://test-extension-id/${path}`),
    },
    tabs: {
      query: vi.fn(async () => [{ id: 1, windowId: 10, active: true }]),
      create: vi.fn(async () => ({ id: 2 })),
      captureVisibleTab: vi.fn(async () => 'data:image/png;base64,AAAA'),
    },
    scripting: { executeScript: vi.fn(async () => [{ result: undefined }]) },
  };
}

export function installChromeMock(): ChromeMock {
  const mock = createChromeMock();
  (globalThis as unknown as { chrome: ChromeMock }).chrome = mock;
  return mock;
}
