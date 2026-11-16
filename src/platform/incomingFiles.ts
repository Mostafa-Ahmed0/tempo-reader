/**
 * Files handed to Tempo from outside the page: "Open with Tempo" / "Share to Tempo" on Android,
 * file_handlers (launchQueue) and share_target in the installed PWA.
 *
 * Producers call pushIncomingFiles(); one consumer (src/app/PlatformBridge.tsx) passes them to the
 * library's import queue. Files that arrive before the consumer subscribes are held, not dropped.
 */
type Listener = (files: File[]) => void;

let queue: File[] = [];
let listener: Listener | null = null;

export function pushIncomingFiles(files: File[]): void {
  const list = files.filter((f) => f && f.size >= 0);
  if (!list.length) return;
  if (listener) listener(list);
  else queue.push(...list);
}

/** Subscribe the single consumer. Anything queued is delivered immediately. Returns an unsubscribe. */
export function onIncomingFiles(cb: Listener): () => void {
  listener = cb;
  if (queue.length) {
    const held = queue;
    queue = [];
    cb(held);
  }
  return () => {
    if (listener === cb) listener = null;
  };
}

/** Test helper. */
export function __resetIncomingFilesForTests(): void {
  queue = [];
  listener = null;
}
