import { useCallback, useEffect, useRef, useSyncExternalStore, type MouseEvent, type PointerEvent } from 'react';
import { keepScreenOn } from '../platform/wakeLock';
import type { EngineState, Frame, ReaderEngine } from './engine';

/** Engine play/pause/speed state. Re-renders only when that state changes (not per frame). */
export function useEngineState(engine: ReaderEngine): EngineState {
  const sub = useCallback((cb: () => void) => engine.onState(cb), [engine]);
  return useSyncExternalStore(sub, () => engine.getState());
}

/**
 * Derive a primitive from the current frame. The component re-renders only when the derived
 * value changes, e.g. `useFrameSelector(e, f => Math.floor(f.index / total * 1000))`.
 */
export function useFrameSelector<T extends string | number | boolean | null>(engine: ReaderEngine, select: (f: Frame) => T): T {
  const selectRef = useRef(select);
  selectRef.current = select;
  const sub = useCallback((cb: () => void) => engine.onFrame(cb), [engine]);
  return useSyncExternalStore(sub, () => selectRef.current(engine.getFrame()));
}

/**
 * Keep the screen on while `active`. Delegates to the platform helper: the Screen Wake Lock API on
 * the web (re-acquired when the page becomes visible again) and the keep-awake plugin in the Android
 * app, whose WebView has no navigator.wakeLock. Never throws; a no-op where unsupported.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => (active ? keepScreenOn() : undefined), [active]);
}

/** Press-and-hold repeat for a button: fires once on press, then repeatedly after a delay. */
export function useHoldRepeat(action: () => void, delay = 400, interval = 70) {
  const actionRef = useRef(action);
  actionRef.current = action;
  const timers = useRef<{ t?: ReturnType<typeof setTimeout>; i?: ReturnType<typeof setInterval> }>({});
  const stop = useCallback(() => {
    clearTimeout(timers.current.t);
    clearInterval(timers.current.i);
    timers.current = {};
  }, []);
  useEffect(() => stop, [stop]);
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault(); // keep focus where it is and avoid text selection on long press
      stop();
      actionRef.current();
      timers.current.t = setTimeout(() => {
        timers.current.i = setInterval(() => actionRef.current(), interval);
      }, delay);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
    // keyboard activation (Enter/Space) arrives as a click with detail 0
    onClick: (e: MouseEvent) => {
      if (e.detail === 0) actionRef.current();
    },
  };
}
