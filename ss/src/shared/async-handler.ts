/**
 * Adapts an async function for an API that expects a void-returning callback.
 *
 * Passing an `async` function straight to `addEventListener` returns a promise
 * nobody holds, so a rejection becomes an unhandled rejection with no context
 * about which interaction caused it. Routing through here guarantees every
 * failure reaches somewhere a developer will actually see it.
 */
export function onAsync<Args extends unknown[]>(
  handler: (...args: Args) => Promise<void>,
  onError: (error: unknown) => void = (error) => console.error(error)
): (...args: Args) => void {
  return (...args: Args) => {
    handler(...args).catch(onError);
  };
}
