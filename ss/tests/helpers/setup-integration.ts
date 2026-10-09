import { afterEach, beforeEach, vi } from 'vitest';
import { installChromeMock } from './chrome-mock.js';

declare global {
  var __chromeMock: ReturnType<typeof installChromeMock>;
}

beforeEach(() => {
  globalThis.__chromeMock = installChromeMock();
});

afterEach(() => {
  vi.restoreAllMocks();
});
