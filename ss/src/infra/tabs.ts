/** Resolves the tab the user is currently looking at, which every capture
 *  path needs before it can do anything. */
export async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found.');
  return tab;
}

/** Runs a self-contained function inside a page and returns its result.
 *  Injected functions cannot close over service-worker scope, so everything
 *  they need must arrive through `args`. */
export async function execInPage<Args extends unknown[], Result>(
  tabId: number,
  func: (...args: Args) => Result,
  args: Args = [] as unknown as Args
): Promise<Result> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: func as (...a: unknown[]) => unknown,
    args,
  });
  return injection?.result as Result;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
