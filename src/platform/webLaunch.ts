/**
 * Installed-PWA entry points for files from the operating system:
 *  - manifest `file_handlers` → window.launchQueue (Chromium desktop: "Open with → Tempo")
 *  - manifest `share_target`  → the service worker (src/sw.ts) stores the POSTed files in a Cache
 *    and redirects to ./?share-target ; we pick them up here.
 */
import { pushIncomingFiles } from './incomingFiles';

/** Must match src/sw.ts. */
export const SHARE_CACHE = 'tempo-share-target';
export const SHARE_QUERY = 'share-target';

interface LaunchParams {
  files?: readonly { kind?: string; getFile(): Promise<File> }[];
}

function initLaunchQueue(): void {
  const lq = (window as unknown as { launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void } }).launchQueue;
  if (!lq?.setConsumer) return;
  lq.setConsumer(async (params) => {
    if (!params.files?.length) return;
    const files: File[] = [];
    for (const handle of params.files) {
      try {
        if (handle.kind === undefined || handle.kind === 'file') files.push(await handle.getFile());
      } catch {
        /* permission denied or file gone: skip it */
      }
    }
    pushIncomingFiles(files);
  });
}

/** Read files the service worker stashed from a share, then forget them. */
export async function collectSharedFiles(): Promise<File[]> {
  if (typeof caches === 'undefined') return [];
  const cache = await caches.open(SHARE_CACHE);
  const files: File[] = [];
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    await cache.delete(req);
    if (!res) continue;
    const name = decodeURIComponent(res.headers.get('X-File-Name') ?? '') || 'Shared file';
    const blob = await res.blob();
    files.push(new File([blob], name, { type: res.headers.get('Content-Type') ?? blob.type, lastModified: Date.now() }));
  }
  return files;
}

async function initShareTarget(): Promise<void> {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(SHARE_QUERY)) return;
  url.searchParams.delete(SHARE_QUERY);
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  try {
    pushIncomingFiles(await collectSharedFiles());
  } catch {
    /* nothing to import */
  }
}

let started = false;
export function initWebLaunch(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  initLaunchQueue();
  void initShareTarget();
}
