import { useEffect } from 'react';
import { useSettings } from '../core/settings';

/**
 * Mirrors theme-related settings onto <html>:
 *  - data-theme            ← settings.theme
 *  - --focus               ← settings.highlightColor (RSVP highlight)
 *  - --font-reader         ← settings.fontFamily (RSVP word font)
 *  - --reader-font-size    ← settings.fontSize (px)
 *  - <meta name="theme-color"> follows --bg so the Android status bar matches.
 */
export function useThemeSync(): void {
  const theme = useSettings((s) => s.theme);
  const highlightColor = useSettings((s) => s.highlightColor);
  const fontFamily = useSettings((s) => s.fontFamily);
  const fontSize = useSettings((s) => s.fontSize);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta && bg) meta.content = bg;
  }, [theme]);

  useEffect(() => {
    const style = document.documentElement.style;
    style.setProperty('--focus', highlightColor);
    style.setProperty('--font-reader', `var(--font-${fontFamily})`);
    style.setProperty('--reader-font-size', `${fontSize}px`);
  }, [highlightColor, fontFamily, fontSize]);
}
