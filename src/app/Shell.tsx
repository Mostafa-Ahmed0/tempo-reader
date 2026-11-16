import { NavLink, Outlet } from 'react-router-dom';
import { Icon, type IconName } from '../ui';

const TABS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Library', icon: 'library', end: true },
  { to: '/stats', label: 'Stats', icon: 'stats' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
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
          {TABS.map((t) => (
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
