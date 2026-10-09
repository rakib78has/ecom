/** Builds a sortable, collision-resistant download name: snapcapture-YYYYMMDD-HHMMSS.ext */
export function timestampedFilename(extension: string, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `snapcapture-${stamp}.${extension}`;
}
