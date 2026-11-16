import { NavLink, Outlet } from 'react-router-dom';
import { Icon, type IconName } from '../ui';
import { ROUTES } from './routes';

// A function, not a constant: routes.tsx imports this module, so ROUTES is not ready at load time.
const tabs = (): { to: string; label: string; icon: IconName; end?: boolean }[] => [
  { to: ROUTES.home, label: 'Home', icon: 'home', end: true },
  { to: ROUTES.library, label: 'Library', icon: 'library' },
  { to: ROUTES.stats, label: 'Stats', icon: 'stats' },
  { to: ROUTES.settings, label: 'Settings', icon: 'settings' },
];

/**
 * Layout for the tab pages: bottom tab bar on phones, left rail from 768px.
 * The reader route is rendered outside this shell (full-screen, no nav).
 */
export function Shell() {
  return (
    <div className="shell">
      <nav className="shell__nav" aria-label="Main">
        <div className="shell__brand" aria-hidden="true">
          t<span>e</span>
        </div>
        <ul className="shell__tabs">
          {tabs().map((t) => (
            <li key={t.to}>
              <NavLink to={t.to} end={t.end} className={({ isActive }) => `shell__tab${isActive ? ' is-active' : ''}`}>
                <span className="shell__tab-icon">
                  <Icon name={t.icon} size={22} />
                </span>
                <span className="shell__tab-label">{t.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main className="shell__main" id="main">
        <Outlet />
      </main>
    </div>
  );
}
