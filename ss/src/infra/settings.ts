import { EXPORT_FORMATS, type ExportFormat } from '../shared/constants.js';

const DEFAULT_FORMAT: ExportFormat = 'png';
const KEY = 'preferredFormat';

export function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === 'string' && (EXPORT_FORMATS as readonly string[]).includes(value);
}

/** Reads the saved export format, falling back to PNG when storage is empty,
 *  corrupted, or holds a format from a future version of the extension. */
export async function readPreferredFormat(): Promise<ExportFormat> {
  try {
    const stored = await chrome.storage.local.get(KEY);
    return isExportFormat(stored[KEY]) ? stored[KEY] : DEFAULT_FORMAT;
  } catch (error) {
    console.warn('Could not read preferred format.', error);
    return DEFAULT_FORMAT;
  }
}

export async function writePreferredFormat(format: ExportFormat): Promise<void> {
  try {
    await chrome.storage.local.set({ [KEY]: format });
  } catch (error) {
    console.warn('Could not save preferred format.', error);
  }
}
