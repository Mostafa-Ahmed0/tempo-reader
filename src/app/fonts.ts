/**
 * Bundled reading fonts (all SIL Open Font License 1.1), so they work offline and in the Android app.
 * Each @font-face uses font-display: swap and a unicode-range per script subset, so the browser only
 * downloads the subsets a page actually uses. Only the upright axes/weights the UI uses are included
 * (variable fonts cover the 400–700 weights the CSS uses in one file per subset; no italics).
 * Family names are wired into the --font-* stacks in src/styles/theme.css.
 */
import '@fontsource-variable/inter/wght.css'; // 'Inter Variable'          → --font-sans (UI + reader)
import '@fontsource-variable/literata/wght.css'; // 'Literata Variable'    → --font-serif
import '@fontsource-variable/jetbrains-mono/wght.css'; // 'JetBrains Mono Variable' → --font-mono
import '@fontsource/opendyslexic/400.css'; // 'OpenDyslexic' (static)     → --font-dyslexic
import '@fontsource/opendyslexic/700.css';
