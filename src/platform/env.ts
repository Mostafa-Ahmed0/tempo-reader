/**
 * Platform detection without importing @capacitor/core into the web bundle.
 *
 * Inside the Android app the native bridge injects `window.Capacitor` before any of our JS runs,
 * so this is equivalent to `Capacitor.isNativePlatform()`. Everything native is then loaded with a
 * dynamic import() (see native.ts), which keeps Capacitor code out of the web build's main chunk.
 */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

export function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  try {
    return !!cap?.isNativePlatform?.();
  } catch {
    return false;
  }
}

/** 'android' | 'ios' | 'web'. */
export function platformName(): string {
  if (!isNativePlatform()) return 'web';
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor?.getPlatform?.() ?? 'web';
}
