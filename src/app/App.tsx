import { HashRouter } from 'react-router-dom';
import { Toaster } from '../ui';
import { PlatformBridge } from './PlatformBridge';
import { AppRoutes } from './routes';
import { useThemeSync } from './useThemeSync';
import './fonts';
import '../styles/theme.css';
import '../styles/base.css';
import './app.css';

/** Root component: theme sync, router, toasts. HashRouter is required for Capacitor (file://-style) hosting. */
export default function App() {
  useThemeSync();
  return (
    <HashRouter>
      <AppRoutes />
      <PlatformBridge />
      <Toaster />
    </HashRouter>
  );
}
