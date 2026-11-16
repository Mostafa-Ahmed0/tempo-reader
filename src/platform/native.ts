/**
 * Everything that talks to Capacitor. Loaded only inside the Android app (dynamic import behind
 * isNativePlatform()), so none of it is part of the web build's main chunk.
 */
import { Capacitor, registerPlugin, SystemBars, SystemBarsStyle, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { SplashScreen } from '@capacitor/splash-screen';
import { handleBack } from './backButton';
import { pushIncomingFiles } from './incomingFiles';
import type { SaveResult } from './saveFile';

// ------------------------------------------------------------------ back button

export interface NativeRouter {
  pathname: () => string;
  navigateToLibrary: () => void;
  navigateHome: () => void;
}

export async function initBackButton(router: NativeRouter): Promise<PluginListenerHandle> {
  // Registering a listener replaces Capacitor's default (WebView history back / exit).
  return App.addListener('backButton', () => {
    handleBack({
      pathname: router.pathname(),
      navigateToLibrary: router.navigateToLibrary,
      navigateHome: router.navigateHome,
      exitApp: () => void App.exitApp(),
    });
  });
}

// ------------------------------------------------------------------ system bars

/** Status/navigation bar icon colour for the app theme (the bars themselves are transparent: edge-to-edge). */
export async function applySystemBars(dark: boolean): Promise<void> {
  try {
    await SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light });
  } catch {
    /* older bridge: ignore */
  }
}

export async function hideSplash(): Promise<void> {
  try {
    await SplashScreen.hide({ fadeOutDuration: 150 });
  } catch {
    /* already hidden */
  }
}

// ------------------------------------------------------------------ open with / share to Tempo

/** Custom plugin in android/app/src/main/java/app/tempo/reader/IncomingFilesPlugin.java */
interface IncomingFile {
  path: string; // file:// URI of a private copy in the app's cache
  name: string; // display name incl. extension
  mimeType: string;
  size: number;
}
interface IncomingFilesPlugin {
  takePending(): Promise<{ files: IncomingFile[] }>;
  release(options: { paths: string[] }): Promise<void>;
  addListener(event: 'filesReceived', cb: () => void): Promise<PluginListenerHandle>;
}
const IncomingFiles = registerPlugin<IncomingFilesPlugin>('IncomingFiles');

async function toFile(f: IncomingFile): Promise<File | null> {
  try {
    // The WebView's local server streams the cached copy; no base64 over the bridge.
    const res = await fetch(Capacitor.convertFileSrc(f.path));
    if (!res.ok) return null;
    const blob = await res.blob();
    return new File([blob], f.name, { type: f.mimeType || blob.type, lastModified: Date.now() });
  } catch {
    return null;
  }
}

let draining: Promise<void> | null = null;
async function drain(): Promise<void> {
  const { files } = await IncomingFiles.takePending();
  if (!files.length) return;
  const out = (await Promise.all(files.map(toFile))).filter((f): f is File => !!f);
  await IncomingFiles.release({ paths: files.map((f) => f.path) }).catch(() => {});
  pushIncomingFiles(out);
}
function drainSoon(): void {
  draining = (draining ?? Promise.resolve()).then(drain).catch(() => {});
}

export async function initIncomingFiles(): Promise<PluginListenerHandle | null> {
  try {
    const handle = await IncomingFiles.addListener('filesReceived', drainSoon);
    drainSoon(); // the intent that launched the app
    return handle;
  } catch {
    return null; // plugin missing (e.g. an old android/ folder): file picking still works
  }
}

// ------------------------------------------------------------------ save file

const CHUNK = 3 * 1024 * 1024; // bytes per bridge call (base64 grows it by 4/3)

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function saveFileNative(blob: Blob, fileName: string): Promise<SaveResult> {
  const path = `exports/${fileName}`;
  const total = blob.size;
  for (let offset = 0; offset < total || offset === 0; offset += CHUNK) {
    const bytes = new Uint8Array(await blob.slice(offset, offset + CHUNK).arrayBuffer());
    const data = toBase64(bytes);
    if (offset === 0) await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true });
    else await Filesystem.appendFile({ path, data, directory: Directory.Cache });
    if (total === 0) break;
  }
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  try {
    await Share.share({ title: fileName, files: [uri], dialogTitle: 'Save or send the backup' });
    return 'shared';
  } catch (e) {
    if (/cancel/i.test(e instanceof Error ? e.message : String(e))) return 'cancelled';
    throw e;
  }
}
