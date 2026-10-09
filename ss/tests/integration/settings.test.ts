import { beforeEach, describe, expect, it } from 'vitest';
import {
  isExportFormat,
  readPreferredFormat,
  writePreferredFormat,
} from '../../src/infra/settings.js';
import type { ChromeMock } from '../helpers/chrome-mock.js';

function mock(): ChromeMock {
  return globalThis.__chromeMock;
}

beforeEach(() => {
  // The shared setup installs a fresh mock per test.
});

describe('isExportFormat', () => {
  it.each(['png', 'jpg', 'pdf'])('accepts %s', (value) => {
    expect(isExportFormat(value)).toBe(true);
  });

  it.each(['PNG', 'gif', 'webp', '', null, undefined, 42, {}])('rejects %s', (value) => {
    expect(isExportFormat(value)).toBe(false);
  });
});

describe('readPreferredFormat', () => {
  it('defaults to PNG on a fresh install', async () => {
    expect(await readPreferredFormat()).toBe('png');
  });

  it('returns a previously saved format', async () => {
    await writePreferredFormat('pdf');

    expect(await readPreferredFormat()).toBe('pdf');
  });

  it('round-trips every supported format', async () => {
    for (const format of ['png', 'jpg', 'pdf'] as const) {
      await writePreferredFormat(format);
      expect(await readPreferredFormat()).toBe(format);
    }
  });

  // Corrupted or forward-incompatible storage must not break the editor.
  describe('resilience', () => {
    it.each([
      ['a format from a future version', 'avif'],
      ['an empty string', ''],
      ['a number', 7],
      ['null', null],
      ['an object', { format: 'png' }],
    ])('falls back to PNG for %s', async (_label, stored) => {
      mock().storage.local.__data.preferredFormat = stored;

      expect(await readPreferredFormat()).toBe('png');
    });

    it('falls back to PNG when storage throws', async () => {
      mock().storage.local.__failNext = true;

      expect(await readPreferredFormat()).toBe('png');
    });

    it('does not throw when a write fails', async () => {
      mock().storage.local.__failNext = true;

      await expect(writePreferredFormat('jpg')).resolves.toBeUndefined();
    });
  });

  it('reads from the single documented storage key', async () => {
    await readPreferredFormat();

    expect(mock().storage.local.get).toHaveBeenCalledWith('preferredFormat');
  });
});
