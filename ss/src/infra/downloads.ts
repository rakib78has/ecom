/** Saves a blob to the user's Downloads folder, always revoking the object
 *  URL afterwards so a long editor session does not retain every export. */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    // Chrome needs the URL to stay alive until the download has actually been
    // handed off; revoking synchronously cancels it.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}
