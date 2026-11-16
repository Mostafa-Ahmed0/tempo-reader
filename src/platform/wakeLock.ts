/**
 * Keep the screen on while reading.
 *
 *  - Browsers: the Screen Wake Lock API (navigator.wakeLock), re-acquired when the tab becomes visible
 *    again (the browser drops the lock whenever the page is hidden).
 *  - Android app: the system WebView does not implement the Wake Lock API (navigator.wakeLock is
 *    undefined there), so we use @capacitor-community/keep-awake, which sets FLAG_KEEP_SCREEN_ON on
 *    the activity window. The flag only applies while the app is in the foreground, so no
 *    re-acquire is needed.
 *
 * Usage (React):  useEffect(() => (active ? keepScreenOn() : undefined), [active]);
 * keepScreenOn() returns the release function. Never throws; unsupported → no-op.
 */
import { isNativePlatform } from './env';

type Sentinel = { release(): Promise<void>; released?: boolean };
type WakeLockNav = Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } };

export function keepScreenOn(): () => void {
  if (typeof window === 'undefined') return () => {};
  return isNativePlatform() ? keepScreenOnNative() : keepScreenOnWeb();
}

let nativeHolders = 0;
let nativePlugin: Promise<typeof import('@capacitor-community/keep-awake').KeepAwake> | null = null;

function keepScreenOnNative(): () => void {
  nativePlugin ??= import('@capacitor-community/keep-awake').then((m) => m.KeepAwake);
  const plugin = nativePlugin;
  let released = false;
  // Calls are queued on the same promise, so keepAwake/allowSleep reach the bridge in call order.
  if (++nativeHolders === 1) plugin.then((k) => k.keepAwake()).catch(() => {});
  return () => {
    if (released) return;
    released = true;
    if (--nativeHolders === 0) plugin.then((k) => k.allowSleep()).catch(() => {});
  };
}

function keepScreenOnWeb(): () => void {
  const nav = navigator as WakeLockNav;
  if (!nav.wakeLock) return () => {};
  let lock: Sentinel | null = null;
  let disposed = false;
  const acquire = () => {
    if (disposed || document.visibilityState !== 'visible' || (lock && !lock.released)) return;
    nav
      .wakeLock!.request('screen')
      .then((l) => {
        if (disposed) void l.release().catch(() => {});
        else lock = l;
      })
      .catch(() => {});
  };
  const onVis = () => {
    if (document.visibilityState === 'visible') acquire();
  };
  acquire();
  document.addEventListener('visibilitychange', onVis);
  return () => {
    disposed = true;
    document.removeEventListener('visibilitychange', onVis);
    if (lock) void lock.release().catch(() => {});
  };
}
