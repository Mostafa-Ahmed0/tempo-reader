// Platform layer: web (PWA) vs Android (Capacitor). Nothing here imports Capacitor eagerly.
export { isNativePlatform, platformName } from './env';
export { saveFile, downloadBlob, type SaveResult } from './saveFile';
export { keepScreenOn } from './wakeLock';
export { registerBackHandler, type BackHandler } from './backButton';
export { onIncomingFiles, pushIncomingFiles } from './incomingFiles';
export { requestPersistentStorage } from './storage';
