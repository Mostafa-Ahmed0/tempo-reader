import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSettings } from '../core/settings';
import { useImports } from '../library/importer';
import { isNativePlatform } from '../platform/env';
import { onIncomingFiles } from '../platform/incomingFiles';
import { requestPersistentStorage } from '../platform/storage';
import { initWebLaunch } from '../platform/webLaunch';
import { toast } from '../ui';
import { ROUTES } from './routes';

/**
 * Connects the platform layer (src/platform) to the app. Renders nothing.
 *  - files opened/shared from other apps → the library's import queue
 *  - first successful import → navigator.storage.persist()
 *  - web: service worker + update prompt (production only), launchQueue / share target
 *  - Android: back button, system bar style per theme, splash screen
 */
export function PlatformBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const navRef = useRef(navigate);
  navRef.current = navigate;
  const theme = useSettings((s) => s.theme);
  const native = isNativePlatform();

  // Files from outside → existing import pipeline (useImports.enqueue is the library's public API).
  useEffect(
    () =>
      onIncomingFiles((files) => {
        // Show the library, where the import panel reports progress (also leaves the reader, which saves on exit).
        if (pathRef.current !== ROUTES.library) navRef.current(ROUTES.library);
        useImports.getState().enqueue(files, (added) => {
          if (added.length === 1) {
            const book = added[0];
            toast(`Added "${book.title}"`, {
              kind: 'success',
              duration: 7000,
              action: { label: 'Read now', onClick: () => navRef.current(ROUTES.read(book.id)) },
            });
          } else if (added.length > 1) toast(`Added ${added.length} books`, { kind: 'success' });
        });
      }),
    [],
  );

  // Ask for persistent storage once something was actually imported.
  useEffect(
    () =>
      useImports.subscribe((s) => {
        if (s.items.some((it) => it.status === 'done')) void requestPersistentStorage();
      }),
    [],
  );

  useEffect(() => {
    if (native) return;
    initWebLaunch();
    if (import.meta.env.PROD) void import('../platform/pwa').then((m) => m.initPwa()).catch(() => {});
  }, [native]);

  useEffect(() => {
    if (!native) return;
    let disposed = false;
    const handles: { remove: () => Promise<void> }[] = [];
    void import('../platform/native').then(async (n) => {
      if (disposed) return;
      handles.push(
        await n.initBackButton({
          pathname: () => pathRef.current,
          navigateToLibrary: () => navRef.current(ROUTES.library),
          navigateHome: () => navRef.current(ROUTES.home),
        }),
      );
      const h = await n.initIncomingFiles();
      if (h) handles.push(h);
      void n.hideSplash();
      if (disposed) handles.forEach((x) => void x.remove());
    });
    return () => {
      disposed = true;
      handles.forEach((x) => void x.remove());
    };
  }, [native]);

  useEffect(() => {
    if (!native) return;
    void import('../platform/native').then((n) => n.applySystemBars(theme === 'dark' || theme === 'black'));
  }, [native, theme]);

  return null;
}
