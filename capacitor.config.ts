import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor (Android) configuration. `npm run build` writes the web app to dist/,
 * `npx cap sync` copies it into android/app/src/main/assets/public.
 */
const config: CapacitorConfig = {
  appId: 'app.tempo.reader',
  appName: 'Tempo',
  webDir: 'dist',
  android: {
    // The dark theme's background, shown behind the WebView before the first paint.
    backgroundColor: '#111214',
    // Only allow http:// content in debug builds (none is used; this keeps release builds strict).
    allowMixedContent: false,
  },
  plugins: {
    SystemBars: {
      // Edge-to-edge: the WebView draws behind the status and navigation bars and the
      // CSS reads env(safe-area-inset-*) (index.html has viewport-fit=cover).
      insetsHandling: 'native',
      initialViewportFitValue: 'cover',
      style: 'DARK',
    },
    SplashScreen: {
      // Hidden from JS as soon as React has mounted (src/platform/native.ts); this is only the fallback.
      launchAutoHide: true,
      launchShowDuration: 3000,
      backgroundColor: '#111214',
      showSpinner: false,
    },
  },
};

export default config;
