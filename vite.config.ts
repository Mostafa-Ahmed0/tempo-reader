/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const THEME_BG = '#111214'; // --bg of the dark theme (src/styles/theme.css)

/** Book formats the OS may hand to the installed PWA (file_handlers / share_target). Keep in sync with src/parsers. */
const FILE_TYPES: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'application/epub+zip': ['.epub'],
  'application/x-mobipocket-ebook': ['.mobi', '.azw', '.azw3', '.prc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/msword': ['.doc'],
  'application/vnd.oasis.opendocument.text': ['.odt'],
  'application/rtf': ['.rtf'],
  'application/x-fictionbook+xml': ['.fb2'],
  'text/plain': ['.txt', '.text'],
  'text/markdown': ['.md', '.markdown'],
};

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      // We register from src/platform/pwa.ts (prompt-to-reload toast, disabled in the Android app).
      injectRegister: false,
      registerType: 'prompt',
      strategies: 'generateSW',
      // public/ and the icons are picked up by globPatterns below.
      includeManifestIcons: false,
      manifest: {
        id: './',
        name: 'Tempo',
        short_name: 'Tempo',
        description: 'Speed reading, one word at a time. Import PDF, EPUB, MOBI, Word or text files; everything stays on your device.',
        lang: 'en',
        dir: 'ltr',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        theme_color: THEME_BG,
        background_color: THEME_BG,
        categories: ['books', 'education', 'productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
        // Long-press / right-click on the app icon. start_url is Home; these jump straight in.
        shortcuts: [
          { name: 'Library', short_name: 'Library', url: './#/library', icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'Stats', short_name: 'Stats', url: './#/stats', icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
        ],
        // Desktop Chromium: "Open with → Tempo" for book files; handled in src/platform/webLaunch.ts.
        file_handlers: [{ action: './', accept: FILE_TYPES }],
        launch_handler: { client_mode: ['focus-existing', 'auto'] },
        // Android (installed PWA): "Share → Tempo"; the POST is handled by public/share-target-sw.js.
        share_target: {
          action: './share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [{ name: 'files', accept: [...Object.keys(FILE_TYPES), ...Object.values(FILE_TYPES).flat(), 'application/octet-stream'] }],
          },
        },
      },
      workbox: {
        // App shell + every lazy chunk (parsers, reader, stats, settings), the pdf.js worker (.mjs,
        // ~1.3 MB) and the bundled fonts, so any format can be imported offline after the first visit.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,webmanifest}'],
        globIgnores: ['**/*.map', 'sw.js', 'workbox-*.js'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        importScripts: ['share-target-sw.js'],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
    // pdf.js (lazy, only when a PDF is imported) is ~500 kB on its own; everything else is far below.
    chunkSizeWarningLimit: 550,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // One jsdom per worker instead of per file (files stay isolated in their own VM context): ~2.5x faster.
    pool: 'vmThreads',
  },
});
