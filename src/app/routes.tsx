import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import HomePage from '../home/HomePage';
import LibraryPage from '../library/LibraryPage';
import { Shell } from './Shell';

// Home is the first paint and the library the next tap (it also receives opened/shared files), so
// both stay in the main chunk; neither pulls in the parsers or the stats charts. Everything else is
// its own chunk: the reader is the heaviest screen, stats (charts) and settings are rarely first.
const loadReader = () => import('../reader/ReaderPage');
const loadStats = () => import('../stats/StatsPage');
const loadSettings = () => import('../settings/SettingsPage');
const ReaderPage = lazy(loadReader);
const StatsPage = lazy(loadStats);
const SettingsPage = lazy(loadSettings);

/** Route paths, for links: `ROUTES.read(book.id)` etc. */
export const ROUTES = {
  home: '/',
  library: '/library',
  stats: '/stats',
  settings: '/settings',
  read: (bookId: string) => `/read/${encodeURIComponent(bookId)}`,
} as const;

function RouteFallback({ inline = false }: { inline?: boolean }) {
  return (
    <div className={`route-fallback${inline ? ' route-fallback--inline' : ''}`} role="status" aria-live="polite">
      <span className="route-fallback__dot" />
      <span className="visually-hidden">Loading…</span>
    </div>
  );
}

const tab = (node: ReactNode) => <Suspense fallback={<RouteFallback inline />}>{node}</Suspense>;

/** Warm the lazy chunks once the first screen is idle, so switching tabs never waits on the network. */
function usePrefetchRoutes() {
  useEffect(() => {
    if (import.meta.env.MODE === 'test') return;
    const run = () => {
      for (const load of [loadStats, loadSettings, loadReader]) load().catch(() => {});
    };
    // Safari has no requestIdleCallback.
    if (typeof window.requestIdleCallback !== 'function') {
      const t = window.setTimeout(run, 1500);
      return () => clearTimeout(t);
    }
    const id = window.requestIdleCallback(run, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }, []);
}

export function AppRoutes() {
  usePrefetchRoutes();
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<HomePage />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="stats" element={tab(<StatsPage />)} />
        <Route path="settings" element={tab(<SettingsPage />)} />
      </Route>
      <Route
        path="read/:bookId"
        element={
          <Suspense fallback={<RouteFallback />}>
            <ReaderPage />
          </Suspense>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
