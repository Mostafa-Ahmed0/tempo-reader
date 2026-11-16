import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastOptions {
  kind?: ToastKind;
  /** ms before auto-dismiss; default 3500 (errors 6000). 0 = sticky. */
  duration?: number;
  /** Optional single action, e.g. Undo. */
  action?: { label: string; onClick: () => void };
}

export interface ToastItem extends Required<Pick<ToastOptions, 'kind' | 'duration'>> {
  id: number;
  message: string;
  action?: ToastOptions['action'];
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const emit = () => listeners.forEach((l) => l());

export function dismissToast(id: number): void {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  items = items.filter((i) => i.id !== id);
  emit();
}

/**
 * Show a toast from anywhere (no hook or context needed). Returns its id.
 * Requires <Toaster /> to be mounted once (App does this).
 */
export function toast(message: string, options: ToastOptions = {}): number {
  const kind = options.kind ?? 'info';
  const duration = options.duration ?? (kind === 'error' ? 6000 : 3500);
  const item: ToastItem = { id: nextId++, message, kind, duration, action: options.action };
  items = [...items.slice(-3), item]; // keep at most 4 on screen
  emit();
  if (duration > 0) timers.set(item.id, setTimeout(() => dismissToast(item.id), duration));
  return item.id;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => items;

/** Renders the toast stack. Mount once near the app root. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, snapshot, snapshot);
  return createPortal(
    <div className="toaster" role="region" aria-label="Notifications">
      {list.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'} aria-live={t.kind === 'error' ? 'assertive' : 'polite'}>
          <span className="toast__msg">{t.message}</span>
          {t.action ? (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                t.action!.onClick();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          ) : null}
          <button type="button" className="toast__close" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
