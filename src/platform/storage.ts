/**
 * Ask the browser not to evict the library (IndexedDB) under storage pressure.
 * Called after the first successful import; Chrome decides silently (installed PWAs and
 * engaged sites are granted), Firefox may show a prompt. Never throws.
 */
let asked = false;

export async function requestPersistentStorage(): Promise<boolean> {
  if (asked) return false;
  asked = true;
  try {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!storage?.persist) return false;
    if (await storage.persisted?.()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}

/** Test helper. */
export function __resetPersistForTests(): void {
  asked = false;
}
