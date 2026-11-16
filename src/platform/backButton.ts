/**
 * Android hardware/gesture back button, in priority order:
 *  1. a handler registered with registerBackHandler() (newest first) that returns true;
 *  2. an open modal/sheet ([role="dialog"]) → closed via the Escape key the Modal already handles;
 *  3. reader route → pause if playing, else leave to the library (the reader's own Escape shortcut);
 *  4. another tab page (library, stats, settings) → Home;
 *  5. Home (the root) → exit the app.
 * Pure DOM/router logic, unit-tested in backButton.test.ts; native.ts connects it to @capacitor/app.
 */

export type BackHandler = () => boolean;
const handlers: BackHandler[] = [];

/**
 * Let a screen take the back button first (e.g. the reader: "if playing, pause and return true").
 * Returns an unregister function. Safe to call on the web (never invoked there).
 */
export function registerBackHandler(handler: BackHandler): () => void {
  handlers.push(handler);
  return () => {
    const i = handlers.lastIndexOf(handler);
    if (i >= 0) handlers.splice(i, 1);
  };
}

export interface BackContext {
  pathname: string;
  /** The reader's fallback exit (its own "Back to library"). */
  navigateToLibrary: () => void;
  /** Tab pages other than Home go back to Home. */
  navigateHome: () => void;
  exitApp: () => void;
  doc?: Document;
}

export type BackAction = 'handler' | 'dialog' | 'pause' | 'reader-exit' | 'home' | 'exit';

export function handleBack(ctx: BackContext): BackAction {
  const doc = ctx.doc ?? document;
  for (let i = handlers.length - 1; i >= 0; i--) {
    try {
      if (handlers[i]()) return 'handler';
    } catch {
      /* a broken handler must not trap the user */
    }
  }

  const dialogs = doc.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]');
  if (dialogs.length) {
    const target = (doc.activeElement as HTMLElement | null) ?? doc.body;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    return 'dialog';
  }

  if (ctx.pathname.startsWith('/read/')) {
    // Reader fallback until it registers its own handler: its play button is labelled "Pause" while playing.
    const play = doc.querySelector<HTMLButtonElement>('.rd-reader__play');
    if (play && play.getAttribute('aria-label') === 'Pause') {
      play.click();
      return 'pause';
    }
    // The reader's Escape shortcut saves progress and returns to the library (it calls preventDefault).
    const ev = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
    (doc.defaultView ?? window).dispatchEvent(ev);
    if (!ev.defaultPrevented) ctx.navigateToLibrary();
    return 'reader-exit';
  }

  if (ctx.pathname !== '/' && ctx.pathname !== '') {
    ctx.navigateHome();
    return 'home';
  }
  ctx.exitApp();
  return 'exit';
}

/** Test helper. */
export function __resetBackHandlersForTests(): void {
  handlers.length = 0;
}
