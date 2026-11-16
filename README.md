# Tempo

Tempo is a speed-reading app. It shows a book **one word at a time** in the same spot on the screen,
with one highlighted "focus" letter so your eyes never have to move, at a speed you choose
(words per minute). This way of reading is called RSVP (rapid serial visual presentation).

You import your own files into a library on your device. Tempo runs in any modern browser, can be
installed like an app from the browser (it then works offline), and can be built as a real Android app.

## Features

- Library: import PDF, EPUB, MOBI/AZW3, Word (DOCX/DOC), ODT, RTF, FB2, HTML, Markdown and plain-text
  files (pick several at once, drag and drop on a computer, or paste text). Covers, search, sorting,
  favourites, shelves, reading progress. The library page lists the supported file types.
- Reader: 60–1500 words per minute, 1–3 words at a time, focus-letter highlight in your colour,
  smart pauses at punctuation and paragraph ends, soft start, speed training (gradual speed-up),
  chapters, bookmarks, context view when paused, keyboard shortcuts, keeps the screen on while playing.
- Page view: switch the reader (button at the top or P) between one word at a time and the whole current page as
  normal text, with the current word highlighted and moving as you read; tap any word to reread from there.
- Pages: the current page and page count in the reader and the library. PDFs show their real pages
  (page 50 in Tempo is page 50 of the PDF, with "go to page"); other formats an estimate of 275 words
  per page, marked "≈".
- Fonts: Inter, Literata (serif), JetBrains Mono and OpenDyslexic, built in (they work offline).
- Themes: dark, light, sepia and true black.
- Stats: reading time per day, speed over time, streaks, daily goal.
- Backup: export everything to one `.json` file and import it on another device.
- Works offline after the first visit; "Open with" / "Share to" Tempo on Android and in the installed app.

**Privacy:** everything stays on your device. Books, progress and statistics are stored in the browser's
(or the app's) local database. Tempo has no account, no server, no analytics and makes no network requests
besides loading the app itself. Nothing leaves the device unless you export a backup yourself.

---

## 1. Run it on your computer

You need [Node.js](https://nodejs.org) 22 or newer (24 recommended). In a terminal, in this folder:

```bash
npm install      # once: downloads the libraries
npm run dev      # starts Tempo at http://localhost:5173
```

Open the printed address in your browser. Stop it with Ctrl+C.

Other commands:

| Command                 | What it does                                                              |
| ----------------------- | ------------------------------------------------------------------------- |
| `npm run build`         | Type-checks and builds the finished web app into the `dist/` folder       |
| `npm run preview`       | Serves `dist/` locally (to try the offline/installable version)           |
| `npm test`              | Runs the automated tests                                                  |
| `npm run typecheck`     | Checks the TypeScript code                                                |
| `npm run icons`         | Re-creates all icons/splash screens from `resources/icon.svg`             |
| `npm run android:sync`  | Builds the web app and copies it into the Android project                 |
| `npm run android:open`  | Opens the Android project in Android Studio                               |

## 2. Put the web version online

`npm run build` creates a `dist/` folder containing plain static files. Upload that folder to **any**
static web host; no server-side code is needed and it works in a sub-folder too (all paths are relative).

- **Netlify:** log in at app.netlify.com → "Add new site" → "Deploy manually" → drag the `dist` folder onto the page.
- **GitHub Pages:** push this project to GitHub, then in the repository: Settings → Pages → Source:
  "GitHub Actions" (one-time setup). After that every push to `main` redeploys the site automatically
  once the checks pass. To deploy another branch by hand: Actions tab → **Web** → "Run workflow" →
  tick **deploy** → Run. The address is shown at the end of the run
  (e.g. `https://<you>.github.io/<repo>/`).

The site must be served over **https** (all the hosts above do this) for offline mode and installing to work.

## 3. Install it on an Android phone from the browser (no build needed)

1. Open your Tempo address (from step 2) in **Chrome** on the phone.
2. Tap the ⋮ menu → **Add to Home screen** → **Install**.
3. Tempo now has its own icon, opens full-screen, and works without internet.
   It also appears in Android's **Share** menu for supported files.

(On iPhone: open it in Safari → Share → "Add to Home Screen".)

When a new version is online, Tempo shows "A new version of Tempo is available" with a **Reload**
button. It never reloads on its own, and waits until you leave the reader.

## 4. Get a real Android app (APK)

The `android/` folder is a complete Android project (made with [Capacitor](https://capacitorjs.com) 8).
There are two ways to turn it into an installable APK.

### Option A: let GitHub build it (nothing to install)

1. Put this project in a GitHub repository and push it (the `main` or `master` branch).
2. Open the repository's **Actions** tab. The **Android APK** workflow starts by itself
   (or click it → "Run workflow"). It takes about 5–10 minutes.
3. Open the finished run and download **tempo-debug-apk** under "Artifacts". Unzip it to get `app-debug.apk`.
4. Copy the APK to your phone and open it. Android asks you to allow installing apps from that source
   (Files app or browser) the first time.

A *debug* APK is fine for personal use. To publish on Google Play you need a signed release build (below).

### Option B: build it yourself with Android Studio

Requirements:

| Tool            | Version                                                                         |
| --------------- | ------------------------------------------------------------------------------- |
| Android Studio  | a current version (2025.1 "Narwhal" or newer); it includes the right Java (JDK 21) |
| Android SDK     | Platform 36 (Android 16) and Build-Tools; Android Studio offers to install them |
| Java (JDK)      | **21** (bundled with Android Studio; Capacitor 8 compiles with Java 21)          |
| Node.js         | 22+ (24 recommended)                                                            |

The app runs on Android 7.0 (API 24) and newer and targets Android 16 (API 36).

Steps:

```bash
npm install
npm run build && npx cap sync      # or: npm run android:sync
npx cap open android               # or: npm run android:open
```

Android Studio opens the project. Wait until "Gradle sync" finishes (the first time it downloads a lot and
may ask you to install SDK components and accept their licence). Connect your phone with USB debugging enabled
(or start an emulator) and press the green **Run** ▶ button. To just get a file:
Build → Build App Bundle(s) / APK(s) → Build APK(s).

Every time you change the web code, run `npm run build && npx cap sync` again before building.

### Signing a release build (outline)

1. Create a signing key once (keep the file and passwords safe: you need the same key for every update):
   `keytool -genkeypair -v -keystore tempo-release.jks -alias tempo -keyalg RSA -keysize 2048 -validity 10000`
   (`keytool` comes with the JDK; in Android Studio you can also use Build → Generate Signed Bundle / APK.)
2. Either create `android/keystore.properties` (it is git-ignored, never commit it):
   ```properties
   storeFile=C:/path/to/tempo-release.jks
   storePassword=...
   keyAlias=tempo
   keyPassword=...
   ```
   and run `cd android && ./gradlew assembleRelease` (Windows: `gradlew assembleRelease`), or
3. for GitHub Actions, add repository secrets (Settings → Secrets and variables → Actions):
   `TEMPO_KEYSTORE_BASE64` (the .jks file, base64-encoded: `base64 -w0 tempo-release.jks`),
   `TEMPO_KEYSTORE_PASSWORD`, `TEMPO_KEY_ALIAS`, `TEMPO_KEY_PASSWORD`. The workflow then also uploads
   **tempo-release-apk**.
4. For Google Play, build an App Bundle instead (`./gradlew bundleRelease`) and raise `versionCode` /
   `versionName` in `android/app/build.gradle` for every update.

### What the Android app adds

- **Back button:** closes an open sheet/dialog first; in the reader it pauses, then goes back to the
  library; on the library it closes the app.
- **Open with / Share to Tempo:** open a book from Files, Downloads, Gmail, WhatsApp, Telegram… with
  "Read with Tempo", or share files (or text from a web page) to Tempo; they go straight into the library.
- **Backup export** opens the Android share sheet, so you can save the file to Google Drive, Files, etc.
- Edge-to-edge display, status/navigation bar icons follow the theme, keeps the screen on while reading,
  dark splash screen and adaptive/themed launcher icon.
- Android's automatic cloud backup is **off** for Tempo (it is limited to 25 MB and would silently skip
  bigger libraries); use Settings → Data → Export backup to move your library.

---

## Supported formats and known limits

| Format                         | Notes                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| PDF                            | Text PDFs only. **Scanned PDFs (pictures of pages) have no text: run them through OCR first** (e.g. a scanner app or Acrobat). Password-protected PDFs must be unlocked first. Complex layouts (columns, footnotes, tables) are reconstructed as well as possible. |
| EPUB                           | EPUB 2 and 3. **DRM-protected books cannot be opened** (e.g. bought from stores that lock them); use a DRM-free copy. Image-only EPUBs (comics) have no text. |
| MOBI / AZW / AZW3 / PRC        | The Kindle reader is hand-written and **has not been tested on many real Kindle files**; if one fails, convert it to EPUB with [Calibre](https://calibre-ebook.com). DRM-protected and KFX Kindle books cannot be opened. |
| DOCX / DOC / ODT / RTF         | Text only; old fast-saved Word 95 files and password-protected documents are not supported.             |
| FB2 / FB2.ZIP, HTML, Markdown, TXT | Most text encodings are detected automatically.                                                     |

Size limits: up to 512 MB per file (128 MB for plain-text-like formats). Very large books may still fail on
phones with little memory.

Picking files on Android: the file picker shows all supported types. Kindle and FB2 files have no standard
type on Android, so the picker may list them as generic files; that is expected.

---

## For developers

React 19 + TypeScript + Vite 8, HashRouter (needed for Capacitor) and relative `base: './'`; Dexie/IndexedDB for
storage, zustand for state. Everything runs in the browser. PWA via `vite-plugin-pwa` (Workbox, precaches the app
shell, every lazy chunk, the pdf.js worker and the fonts). Android via Capacitor 8.

```
src/core/       foundation: shared types, Dexie db, settings store, tokenizer, text helpers
src/styles/     design tokens (theme.css) and base styles
src/ui/         Button, Slider, Toggle, Modal, Toast/toast(), Icon, PageHeader
src/app/        App, routes (lazy reader/stats/settings), shell/nav, theme sync, fonts, PlatformBridge
src/platform/   web vs Android: saveFile, wakeLock, back button, incoming files, PWA registration, storage
src/parsers/    file format readers (loaded on demand)
src/library/    library screen and import queue
src/reader/     full-screen reader
src/stats/      statistics
src/settings/   settings
android/        Capacitor Android project (IncomingFilesPlugin.java = open with / share to Tempo)
resources/      icon.svg, the source of every icon (run `npm run icons` after editing it)
scripts/        icons.mjs
.github/        web.yml (typecheck, test, build, optional Pages deploy), android.yml (APK)
```

Conventions: style only with the CSS variables in `src/styles/theme.css`; wrap tab-page content in
`<div className="page">`; link with `ROUTES` from `src/app/routes.tsx`; show feedback with `toast()` from `src/ui`;
talk to IndexedDB only through `src/core/db.ts`; anything platform-specific goes through `src/platform/`
(`isNativePlatform()`, `saveFile()`, `keepScreenOn()`, `registerBackHandler()`), which loads Capacitor code only
inside the Android app. Tests live next to the code as `*.test.ts(x)`.

## Licences

Tempo's own code: see the repository owner's chosen licence. Bundled third-party software:

| Component                                      | Licence                     |
| ---------------------------------------------- | --------------------------- |
| Inter (font, via @fontsource-variable/inter)   | SIL Open Font License 1.1   |
| Literata (font, via @fontsource-variable/literata) | SIL Open Font License 1.1 |
| JetBrains Mono (font, via @fontsource-variable/jetbrains-mono) | SIL Open Font License 1.1 |
| OpenDyslexic (font, via @fontsource/opendyslexic) | SIL Open Font License 1.1 |
| React, React DOM, React Router, zustand        | MIT                         |
| Dexie, dexie-react-hooks                       | Apache-2.0                  |
| pdf.js (pdfjs-dist)                            | Apache-2.0                  |
| JSZip                                          | MIT (dual MIT / GPL-3.0; used under MIT) |
| mammoth                                        | BSD-2-Clause                |
| Workbox (service worker, via vite-plugin-pwa)  | MIT                         |
| Capacitor and its plugins (@capacitor/*, @capacitor-community/keep-awake) | MIT |

The OFL allows bundling the fonts in apps, including commercial ones; the fonts may not be sold on their own.
The Android SDK and Gradle downloaded when building the APK are covered by their own licences, which you accept
when installing them.
