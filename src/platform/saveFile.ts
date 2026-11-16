/**
 * Save a generated file (e.g. the backup .json).
 *  - Web: a normal download via <a download>.
 *  - Android app: <a download> does nothing in a WebView, so the file is written to the app's cache
 *    with @capacitor/filesystem and handed to the system share sheet (@capacitor/share), from which
 *    the user can save it to Drive, Files, e-mail it, etc.
 */
import { isNativePlatform } from './env';

export type SaveResult = 'downloaded' | 'shared' | 'cancelled';

export async function saveFile(blob: Blob, fileName: string): Promise<SaveResult> {
  if (isNativePlatform()) {
    const { saveFileNative } = await import('./native');
    return saveFileNative(blob, fileName);
  }
  downloadBlob(blob, fileName);
  return 'downloaded';
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
