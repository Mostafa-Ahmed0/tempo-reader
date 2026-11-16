/**
 * Service worker registration (vite-plugin-pwa, "prompt" mode) for the web build.
 * A new version is never activated behind the user's back: we show a sticky toast with a
 * Reload action, and while a book is open in the reader we hold the toast until they leave it.
 * Not used in the Android app (assets are bundled in the APK) nor in `npm run dev`.
 */
import { registerSW } from 'virtual:pwa-register';
import { toast } from '../ui';
import { isNativePlatform } from './env';

const UPDATE_CHECK_MS = 60 * 60 * 1000;
const isReading = () => window.location.hash.startsWith('#/read/');

function whenNotReading(fn: () => void): void {
  if (!isReading()) return fn();
  const onHash = () => {
    if (isReading()) return;
    window.removeEventListener('hashchange', onHash);
    fn();
  };
  window.addEventListener('hashchange', onHash);
}

let started = false;
export function initPwa(): void {
  if (started || typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (isNativePlatform() || import.meta.env.DEV || import.meta.env.MODE === 'test') return;
  started = true;
  const updateSW = registerSW({
    onNeedRefresh() {
      whenNotReading(() =>
        toast('A new version of Tempo is available.', {
          duration: 0,
          action: { label: 'Reload', onClick: () => void updateSW(true) },
        }),
      );
    },
    onOfflineReady() {
      toast('Tempo is ready to work offline.', { kind: 'success' });
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      setInterval(() => {
        if (navigator.onLine !== false) void registration.update().catch(() => {});
      }, UPDATE_CHECK_MS);
    },
  });
}
