import { describe, expect, it, vi } from 'vitest';
import { onAsync } from '../../src/shared/async-handler.js';

describe('onAsync', () => {
  it('returns a function that does not return a promise', () => {
    const wrapped = onAsync(async () => undefined);

    expect(wrapped()).toBeUndefined();
  });

  it('forwards every argument to the handler', async () => {
    const handler = vi.fn(async (..._args: [string, number, object]) => undefined);
    const wrapped = onAsync<[string, number, object]>(handler);

    wrapped('a', 1, { b: true });
    await Promise.resolve();

    expect(handler).toHaveBeenCalledWith('a', 1, { b: true });
  });

  // The whole reason this exists: an async function handed straight to
  // addEventListener leaves a rejection nobody holds, so the failure surfaces
  // as a bare unhandled rejection with no clue which interaction caused it.
  it('routes a rejection to the error handler instead of leaving it unhandled', async () => {
    const onError = vi.fn();
    const failure = new Error('boom');

    onAsync(async () => {
      throw failure;
    }, onError)();
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('logs to the console when no error handler is given', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error('boom');

    onAsync(async () => {
      throw failure;
    })();
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleError).toHaveBeenCalledWith(failure);
    consoleError.mockRestore();
  });

  it('does not invoke the error handler when the handler resolves', async () => {
    const onError = vi.fn();

    onAsync(async () => undefined, onError)();
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
  });
});
