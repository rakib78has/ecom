import { expect, extensionUrl, test } from './fixtures.js';

/**
 * The smoke suite: proves the built artifact is a loadable extension.
 *
 * Everything else assumes this, so when it fails the cause is almost always a
 * broken build or a manifest path that no longer matches the output layout —
 * not the feature a downstream test was checking.
 */

test.describe('extension loading', () => {
  test('registers a service worker', ({ serviceWorker }) => {
    expect(serviceWorker.url()).toContain('service-worker.js');
  });

  test('exposes a stable extension id', ({ extensionId }) => {
    expect(extensionId).toMatch(/^[a-p]{32}$/);
  });

  test('popup renders every capture action', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(extensionUrl(extensionId, 'popup/popup.html'));

    await expect(page.getByRole('button', { name: 'Capture Visible Area' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Capture Full Page' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Select Area' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delayed Capture' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record Screen' })).toBeVisible();

    await page.close();
  });

  test('recorder page loads in its idle state', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(extensionUrl(extensionId, 'recorder/recorder.html'));

    await expect(page.getByRole('button', { name: 'Start Recording' })).toBeVisible();
    await expect(page.locator('#stage-view')).toHaveClass(/hidden/);
    await expect(page.locator('#result-view')).toHaveClass(/hidden/);

    await page.close();
  });

  test('no page logs an error on load', async ({ context, extensionId }) => {
    const errors: string[] = [];

    for (const path of ['popup/popup.html', 'recorder/recorder.html']) {
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(`${path}: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`${path}: ${message.text()}`);
      });
      await page.goto(extensionUrl(extensionId, path));
      await page.waitForLoadState('networkidle');
      await page.close();
    }

    expect(errors).toEqual([]);
  });
});

test.describe('editor without a capture', () => {
  // --- BUG-005 related -----------------------------------------------------
  // Opening the editor with no capture id, or one the store has already
  // consumed, must degrade cleanly instead of throwing.
  test('shows a recoverable message when the capture is gone', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(extensionUrl(extensionId, 'editor/editor.html?cid=does-not-exist'));

    await expect(page.locator('#status')).toContainText('no longer available');
    await expect(page.getByRole('button', { name: 'Download' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Copy to Clipboard' })).toBeDisabled();

    await page.close();
  });

  test('shows the same message when opened with no capture id at all', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(extensionUrl(extensionId, 'editor/editor.html'));

    await expect(page.locator('#status')).toContainText('no longer available');

    await page.close();
  });
});
