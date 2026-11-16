import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetBackHandlersForTests, handleBack, registerBackHandler } from './backButton';
import { isNativePlatform } from './env';
import { __resetIncomingFilesForTests, onIncomingFiles, pushIncomingFiles } from './incomingFiles';
import { saveFile } from './saveFile';
import { __resetPersistForTests, requestPersistentStorage } from './storage';
import { keepScreenOn } from './wakeLock';

afterEach(() => {
  document.body.innerHTML = '';
  __resetBackHandlersForTests();
  __resetIncomingFilesForTests();
  vi.restoreAllMocks();
});

function ctx(pathname: string) {
  return { pathname, navigateToLibrary: vi.fn(), navigateHome: vi.fn(), exitApp: vi.fn() };
}

describe('back button', () => {
  it('exits on Home (the root) and goes to Home from the library and the other tabs', () => {
    const root = ctx('/');
    expect(handleBack(root)).toBe('exit');
    expect(root.exitApp).toHaveBeenCalledOnce();
    for (const path of ['/library', '/stats', '/settings']) {
      const c = ctx(path);
      expect(handleBack(c)).toBe('home');
      expect(c.navigateHome).toHaveBeenCalledOnce();
      expect(c.navigateToLibrary).not.toHaveBeenCalled();
      expect(c.exitApp).not.toHaveBeenCalled();
    }
  });

  it('closes an open dialog first (via Escape) instead of navigating', () => {
    document.body.innerHTML = '<div role="dialog"><button>x</button></div>';
    const onKey = vi.fn((e: KeyboardEvent) => e.key);
    document.addEventListener('keydown', onKey, true);
    const c = ctx('/read/1');
    expect(handleBack(c)).toBe('dialog');
    expect(onKey).toHaveBeenCalledOnce();
    expect(onKey.mock.calls[0][0].key).toBe('Escape');
    expect(c.navigateToLibrary).not.toHaveBeenCalled();
    document.removeEventListener('keydown', onKey, true);
  });

  it('in the reader: pauses while playing, otherwise leaves via the reader Escape shortcut', () => {
    document.body.innerHTML = '<button class="rd-reader__play" aria-label="Pause"></button>';
    const play = document.querySelector('button')!;
    const click = vi.fn();
    play.addEventListener('click', click);
    const c = ctx('/read/1');
    expect(handleBack(c)).toBe('pause');
    expect(click).toHaveBeenCalledOnce();

    play.setAttribute('aria-label', 'Play');
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && e.preventDefault();
    window.addEventListener('keydown', onKey);
    expect(handleBack(c)).toBe('reader-exit');
    expect(c.navigateToLibrary).not.toHaveBeenCalled(); // the reader handled it
    window.removeEventListener('keydown', onKey);
    expect(handleBack(c)).toBe('reader-exit');
    expect(c.navigateToLibrary).toHaveBeenCalledOnce(); // nobody handled Escape: fallback
  });

  it('registered handlers run first, newest first, and can be removed', () => {
    const a = vi.fn(() => true);
    const b = vi.fn(() => false);
    const offA = registerBackHandler(a);
    registerBackHandler(b);
    expect(handleBack(ctx('/'))).toBe('handler');
    expect(b).toHaveBeenCalledBefore(a);
    offA();
    expect(handleBack(ctx('/'))).toBe('exit');
  });
});

describe('incoming files', () => {
  it('holds files until a consumer subscribes, then delivers directly', () => {
    const f1 = new File(['a'], 'a.txt');
    pushIncomingFiles([f1]);
    const got: File[][] = [];
    const off = onIncomingFiles((files) => got.push(files));
    expect(got).toEqual([[f1]]);
    const f2 = new File(['b'], 'b.txt');
    pushIncomingFiles([f2]);
    expect(got).toEqual([[f1], [f2]]);
    off();
    pushIncomingFiles([]);
    expect(got.length).toBe(2);
  });
});

describe('web fallbacks', () => {
  beforeEach(() => __resetPersistForTests());

  it('is not native in a browser', () => {
    expect(isNativePlatform()).toBe(false);
  });

  it('saveFile downloads via <a download> on the web', async () => {
    const urls: string[] = [];
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn((u: string) => urls.push(u)) });
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
    await expect(saveFile(new Blob(['{}']), 'backup.json')).resolves.toBe('downloaded');
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('backup.json');
    expect(clicked[0].href).toBe('blob:x');
    expect(document.querySelector('a')).toBeNull();
  });

  it('keepScreenOn uses navigator.wakeLock and releases it', async () => {
    const release = vi.fn(() => Promise.resolve());
    const request = vi.fn(() => Promise.resolve({ release, released: false }));
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    const stop = keepScreenOn();
    await Promise.resolve();
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith('screen');
    stop();
    expect(release).toHaveBeenCalledOnce();
    delete (navigator as unknown as { wakeLock?: unknown }).wakeLock;
    expect(() => keepScreenOn()()).not.toThrow(); // unsupported: no-op
  });

  it('requests persistent storage once and never throws', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    Object.defineProperty(navigator, 'storage', { value: { persist, persisted: () => Promise.resolve(false) }, configurable: true });
    await expect(requestPersistentStorage()).resolves.toBe(true);
    await expect(requestPersistentStorage()).resolves.toBe(false);
    expect(persist).toHaveBeenCalledOnce();
    __resetPersistForTests();
    Object.defineProperty(navigator, 'storage', { value: { persist: () => Promise.reject(new Error('no')) }, configurable: true });
    await expect(requestPersistentStorage()).resolves.toBe(false);
  });
});
