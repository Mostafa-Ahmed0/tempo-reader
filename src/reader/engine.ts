import { WPM_MAX, WPM_MIN } from '../core/settings';
import type { TokenizedBook } from '../core/types';
import { analyzeTokens, computeWeights, floorValue, frameLength, nextValue, type TokenAnalysis } from './pacing';

/**
 * RSVP playback engine. Pure TypeScript: no React, no DOM.
 *
 * Timing: every frame has a deadline; the next deadline is `previous deadline + next frame duration`,
 * never "now + duration", so timer lateness does not accumulate and 600 WPM stays 600 WPM over a minute.
 * If a timer is very late (tab throttled, debugger, device sleep) the schedule re-bases on `now`
 * instead of flashing through the missed words.
 */

export interface EngineClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** Optional display-frame callback (requestAnimationFrame); frame swaps are then aligned to refreshes. */
  requestFrame?(fn: (timestamp: number) => void): unknown;
  cancelFrame?(handle: unknown): void;
  /** False while animation frames will not run (e.g. hidden tab); the timer path is used then. */
  frameAvailable?(): boolean;
}

const hasRaf = typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function';

export const defaultClock: EngineClock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  ...(hasRaf
    ? {
        requestFrame: (fn: (t: number) => void) => requestAnimationFrame(fn),
        cancelFrame: (h: unknown) => cancelAnimationFrame(h as number),
        frameAvailable: () => typeof document === 'undefined' || document.visibilityState === 'visible',
      }
    : {}),
};

export interface EngineOptions {
  wpm: number;
  chunkSize: 1 | 2 | 3;
  smartPacing: boolean;
  punctuationPause: number;
  softStart: boolean;
  rewindOnResume: number;
  rampEnabled: boolean;
  rampStartWpm: number;
  rampTargetWpm: number;
  rampStepWpm: number;
  rampIntervalSec: number;
}

export interface Frame {
  /** First word index of the frame. Equals `total` once the book is finished. */
  index: number;
  /** Words in the frame (0 when finished / empty book). */
  count: number;
  text: string;
}

export interface EngineState {
  playing: boolean;
  finished: boolean;
  /** Effective speed right now (the ramp's current value while training). */
  wpm: number;
  /** Speed training is driving the speed. */
  training: boolean;
  /** Training has reached its target. */
  trainingDone: boolean;
}

export interface SessionSummary {
  /** Epoch ms of the first play in this session. */
  startedAt: number;
  /** Real playing time, ms (paused time excluded). */
  durationMs: number;
  /**
   * Words actually shown by playback: every completed frame, plus the frame on screen at pause if it
   * was shown for at least half its time. Words re-shown after rewind-on-resume count (their time
   * counts too); words skipped by seeking do not.
   */
  wordsRead: number;
  avgWpm: number;
}

/** Duration factors for the first frames after pressing play. */
export const SOFT_START = [1.8, 1.55, 1.35, 1.2, 1.08];
/** Share of each later frame used to pay back the soft-start time (keeps the average exact). */
export const SOFT_START_PAYBACK = 0.15;
/** Assumed display refresh interval until measured, ms. */
export const DEFAULT_REFRESH_MS = 1000 / 60;
/** Lateness beyond which the schedule re-bases on "now". */
export const RESYNC_AFTER_MS = 250;

const clampWpm = (w: number) => Math.round(Math.min(WPM_MAX, Math.max(WPM_MIN, Number.isFinite(w) ? w : WPM_MIN)));

type Book = Pick<TokenizedBook, 'words' | 'paragraphStarts' | 'chapters'>;

export class ReaderEngine {
  readonly words: readonly string[];
  readonly total: number;
  readonly analysis: TokenAnalysis;

  private opts: EngineOptions;
  private clock: EngineClock;
  private weights: Float32Array;

  private index = 0;
  private count = 0;
  private playing = false;
  private finished = false;
  private wpm: number;
  private training = false;
  private rampMs = 0;
  private rampMark = 0;

  private timer: unknown = null;
  private safety: unknown = null;
  private rafHandle: unknown = null;
  private probe: unknown = null;
  private rafHealthy = true;
  private refresh = DEFAULT_REFRESH_MS;
  private lastFrameTs = -1;
  private deadline = 0;
  private frameStart = 0;
  private frameDur = 0;
  private softLeft = 0;
  private softDebt = 0;
  private seekedWhilePaused = false;
  private frameCache: Frame | null = null;

  // session accounting
  private sessionStart: number | null = null;
  private sessionMs = 0;
  private playMark = 0;
  private sessionWords = 0;
  /** Index of the frame whose words were already counted (pause credit), -1 if none. */
  private creditedIndex = -1;

  private frameListeners = new Set<(f: Frame) => void>();
  private stateListeners = new Set<(s: EngineState) => void>();
  private stateCache: EngineState | null = null;

  constructor(book: Book, options: EngineOptions, startIndex = 0, clock: EngineClock = defaultClock) {
    this.words = book.words;
    this.total = book.words.length;
    this.analysis = analyzeTokens(book);
    this.opts = { ...options };
    this.clock = clock;
    this.weights = computeWeights(this.analysis, options.smartPacing, options.punctuationPause);
    this.wpm = clampWpm(options.wpm);
    this.resetRamp();
    this.index = Math.max(0, Math.min(this.total, Math.floor(startIndex) || 0));
    if (this.index >= this.total) {
      this.index = this.total;
      this.finished = this.total > 0;
    }
    this.count = frameLength(this.analysis, this.index, this.opts.chunkSize);
  }

  // ------------------------------------------------------------------ subscriptions

  onFrame(fn: (f: Frame) => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }
  onState(fn: (s: EngineState) => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  getFrame(): Frame {
    if (!this.frameCache) {
      this.frameCache = {
        index: this.index,
        count: this.count,
        text: this.count > 0 ? this.words.slice(this.index, this.index + this.count).join(' ') : '',
      };
    }
    return this.frameCache;
  }

  /** Stable object between changes (safe for useSyncExternalStore). */
  getState(): EngineState {
    if (!this.stateCache) {
      this.stateCache = {
        playing: this.playing,
        finished: this.finished,
        wpm: this.wpm,
        training: this.training,
        trainingDone: this.training && this.wpm === clampWpm(this.opts.rampTargetWpm),
      };
    }
    return this.stateCache;
  }

  /** Index of the next word to show (what should be saved as the reading position). */
  get position(): number {
    return this.index;
  }

  private emitFrame() {
    this.frameCache = null;
    const f = this.getFrame();
    this.frameListeners.forEach((l) => l(f));
  }
  private emitState() {
    this.stateCache = null;
    const s = this.getState();
    this.stateListeners.forEach((l) => l(s));
  }

  // ------------------------------------------------------------------ timing

  /** Base duration of one word at the current speed, ms. */
  get msPerWord(): number {
    return 60000 / this.wpm;
  }

  /** Duration of the frame [i, i+count) at the current speed, without soft start. */
  frameDuration(i: number, count: number): number {
    let w = 0;
    for (let k = 0; k < count; k++) w += this.weights[i + k] ?? 1;
    return this.msPerWord * w;
  }

  /**
   * Duration of the frame about to be shown. Soft start stretches the first frames after play;
   * the extra time is a debt repaid by the following frames (at most SOFT_START_PAYBACK of each),
   * so after a few seconds the average speed is exactly the chosen WPM again.
   */
  private currentDuration(): number {
    let d = this.frameDuration(this.index, this.count);
    if (this.softLeft > 0) {
      const f = SOFT_START[SOFT_START.length - this.softLeft];
      this.softDebt += d * (f - 1);
      d *= f;
      this.softLeft--;
    } else if (this.softDebt > 0) {
      const repay = Math.min(this.softDebt, d * SOFT_START_PAYBACK);
      this.softDebt -= repay;
      d -= repay;
    }
    this.frameDur = d;
    return d;
  }

  /**
   * Arrange for `commit` at `this.deadline`.
   * With requestAnimationFrame available: a timer wakes us ~1.5 refreshes early, then we commit on the
   * animation frame closest to the deadline (error ≤ half a refresh) instead of whenever the timer
   * fires (error up to a whole refresh). A safety timer commits anyway if animation frames stop
   * (hidden tab). Without rAF (tests, hidden tab): plain timer at the deadline.
   */
  private schedule() {
    this.clearTimer();
    const now = this.clock.now();
    const wait = Math.max(0, this.deadline - now);
    const rafUsable = !!this.clock.requestFrame && (!this.clock.frameAvailable || this.clock.frameAvailable());
    if (!rafUsable || !this.rafHealthy) {
      this.timer = this.clock.setTimeout(() => this.commit(false), wait);
      // after a stall, one probe frame tells us when animation frames flow again
      if (rafUsable && this.probe === null) {
        this.probe = this.clock.requestFrame!(() => {
          this.probe = null;
          this.rafHealthy = true;
        });
      }
      return;
    }
    this.lastFrameTs = -1;
    this.timer = this.clock.setTimeout(this.waitForFrame, Math.max(0, wait - this.refresh * 1.5));
    this.safety = this.clock.setTimeout(this.onStall, wait + Math.max(50, this.refresh * 3));
  }

  /** Animation frames did not arrive (e.g. a WebView or pane that stopped compositing): use timers until they do. */
  private onStall = () => {
    this.safety = null;
    this.rafHealthy = false;
    this.commit(false);
  };

  private waitForFrame = () => {
    this.timer = null;
    this.rafHandle = this.clock.requestFrame!(this.onAnimationFrame);
  };

  private onAnimationFrame = (ts: number) => {
    this.rafHandle = null;
    if (!this.playing) return;
    if (this.lastFrameTs >= 0) {
      const gap = ts - this.lastFrameTs;
      if (gap > 4 && gap < 60) this.refresh = this.refresh * 0.8 + gap * 0.2; // learn the display's refresh interval
    }
    this.lastFrameTs = ts;
    if (this.deadline - this.clock.now() > this.refresh / 2) {
      this.rafHandle = this.clock.requestFrame!(this.onAnimationFrame); // a later frame is closer to the deadline
      return;
    }
    this.commit(true);
  };

  private clearTimer() {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    if (this.safety !== null) this.clock.clearTimeout(this.safety);
    if (this.rafHandle !== null) this.clock.cancelFrame?.(this.rafHandle);
    this.timer = null;
    this.safety = null;
    this.rafHandle = null;
  }

  /** Words of the current frame count as read (once). */
  private creditCurrentFrame() {
    if (this.creditedIndex === this.index || this.count <= 0) return;
    this.sessionWords += this.count;
    this.creditedIndex = this.index;
  }

  /** End the current frame and show the next one. `aligned`: called from an animation frame (may be up to half a refresh early). */
  private commit(aligned: boolean) {
    if (!this.playing) return;
    const now = this.clock.now();
    if (!aligned && now < this.deadline - 1) {
      // timer fired early (some implementations do): wait for the rest
      this.schedule();
      return;
    }
    this.clearTimer();
    const lateness = now - this.deadline;

    this.creditCurrentFrame();
    this.advanceRamp(now);

    this.index += this.count;
    if (this.index >= this.total) {
      this.index = this.total;
      this.count = 0;
      this.stopClock(now);
      this.playing = false;
      this.finished = true;
      this.emitFrame();
      this.emitState();
      return;
    }
    this.count = frameLength(this.analysis, this.index, this.opts.chunkSize);
    const dur = this.currentDuration();
    // drift correction: the next deadline derives from the previous deadline, not from "now"
    this.deadline = lateness > RESYNC_AFTER_MS ? now + dur : this.deadline + dur;
    this.frameStart = now;
    this.emitFrame();
    this.schedule();
  }

  // ------------------------------------------------------------------ speed training

  private resetRamp() {
    this.training = this.opts.rampEnabled;
    this.rampMs = 0;
    if (this.training) this.wpm = clampWpm(this.opts.rampStartWpm);
  }

  private advanceRamp(now: number) {
    if (!this.training) {
      this.rampMark = now;
      return;
    }
    this.rampMs += now - this.rampMark;
    this.rampMark = now;
    const interval = Math.max(1, this.opts.rampIntervalSec) * 1000;
    const target = clampWpm(this.opts.rampTargetWpm);
    let changed = false;
    while (this.rampMs >= interval && this.wpm !== target) {
      this.rampMs -= interval;
      const step = Math.max(1, Math.abs(this.opts.rampStepWpm));
      this.wpm = this.wpm < target ? Math.min(target, this.wpm + step) : Math.max(target, this.wpm - step);
      changed = true;
    }
    if (this.wpm === target) this.rampMs = 0;
    if (changed) this.emitState();
  }

  // ------------------------------------------------------------------ playback control

  play(): void {
    if (this.playing || this.total === 0) return;
    if (this.index >= this.total) {
      this.index = 0;
      this.creditedIndex = -1;
    } else if (!this.seekedWhilePaused && this.opts.rewindOnResume > 0 && this.index > 0) {
      const paraStart = floorValue(this.analysis.paragraphStarts, this.index, 0);
      const back = Math.max(paraStart, this.index - this.opts.rewindOnResume);
      if (back < this.index) {
        this.index = back;
        this.creditedIndex = -1;
      }
    }
    this.seekedWhilePaused = false;
    this.finished = false;
    this.playing = true;
    const now = this.clock.now();
    this.playMark = now;
    this.rampMark = now;
    if (this.sessionStart === null) this.sessionStart = Date.now();
    this.softLeft = this.opts.softStart ? SOFT_START.length : 0;
    this.softDebt = 0;
    this.count = frameLength(this.analysis, this.index, this.opts.chunkSize);
    this.deadline = now + this.currentDuration();
    this.frameStart = now;
    this.emitFrame();
    this.emitState();
    this.schedule();
  }

  pause(): void {
    if (!this.playing) return;
    this.clearTimer();
    const now = this.clock.now();
    // the frame on screen counts if it was shown for at least half its time
    if (now - this.frameStart >= this.frameDur / 2) this.creditCurrentFrame();
    this.stopClock(now);
    if (this.training) this.rampMs += now - this.rampMark;
    this.playing = false;
    this.seekedWhilePaused = false;
    this.emitState();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  private stopClock(now: number) {
    this.sessionMs += Math.max(0, now - this.playMark);
    this.playMark = now;
  }

  /** Jump to a word (clamped to the book). Not counted as reading. */
  seek(wordIndex: number): void {
    if (this.total === 0) return;
    const i = Math.max(0, Math.min(this.total - 1, Math.floor(Number.isFinite(wordIndex) ? wordIndex : 0)));
    this.index = i;
    this.creditedIndex = -1;
    this.finished = false;
    this.count = frameLength(this.analysis, i, this.opts.chunkSize);
    if (this.playing) {
      const now = this.clock.now();
      this.deadline = now + this.currentDuration();
      this.frameStart = now;
      this.schedule();
    } else {
      this.seekedWhilePaused = true;
    }
    this.emitFrame();
    this.emitState();
  }

  /** Start of the current sentence, or of the previous one when already at its start. */
  prevSentence(): void {
    this.seek(this.prevBoundary(this.analysis.sentenceStarts));
  }
  nextSentence(): void {
    this.seek(this.nextBoundary(this.analysis.sentenceStarts));
  }
  prevParagraph(): void {
    this.seek(this.prevBoundary(this.analysis.paragraphStarts));
  }
  nextParagraph(): void {
    this.seek(this.nextBoundary(this.analysis.paragraphStarts));
  }

  private prevBoundary(starts: Int32Array): number {
    const i = Math.min(this.index, this.total - 1);
    const s = floorValue(starts, i, 0);
    if (i === s && s > 0) return floorValue(starts, s - 1, 0);
    return s;
  }
  private nextBoundary(starts: Int32Array): number {
    const n = nextValue(starts, this.index);
    return n < 0 ? this.total - 1 : n;
  }

  /** Change speed. `manual` (default) means the user chose it: speed training stops driving the speed. */
  setWpm(wpm: number, manual = true): void {
    const w = clampWpm(wpm);
    const changed = w !== this.wpm || (manual && this.training);
    this.wpm = w;
    if (manual) {
      this.opts.wpm = w;
      this.training = false;
    }
    if (changed) this.emitState();
  }

  /** Update options while reading. Changing any ramp field restarts training from its start speed. */
  setOptions(patch: Partial<Omit<EngineOptions, 'wpm'>>): void {
    const prev = this.opts;
    this.opts = { ...prev, ...patch };
    const o = this.opts;
    if (o.smartPacing !== prev.smartPacing || o.punctuationPause !== prev.punctuationPause) {
      this.weights = computeWeights(this.analysis, o.smartPacing, o.punctuationPause);
    }
    if (
      o.rampEnabled !== prev.rampEnabled ||
      (o.rampEnabled &&
        (o.rampStartWpm !== prev.rampStartWpm ||
          o.rampTargetWpm !== prev.rampTargetWpm ||
          o.rampStepWpm !== prev.rampStepWpm ||
          o.rampIntervalSec !== prev.rampIntervalSec))
    ) {
      if (!o.rampEnabled) {
        this.training = false;
        this.wpm = clampWpm(o.wpm);
      } else this.resetRamp();
      this.rampMark = this.clock.now();
      this.emitState();
    }
    if (o.chunkSize !== prev.chunkSize && this.index < this.total) {
      this.count = frameLength(this.analysis, this.index, o.chunkSize);
      this.emitFrame();
    }
  }

  /**
   * Return the reading stretch accumulated since the last call (or creation) and start a new one.
   * Null if nothing was played. While playing, the running time up to now is included.
   */
  takeSession(): SessionSummary | null {
    if (this.playing) this.stopClock(this.clock.now());
    const start = this.sessionStart;
    const durationMs = Math.round(this.sessionMs);
    const wordsRead = this.sessionWords;
    this.sessionMs = 0;
    this.sessionWords = 0;
    this.sessionStart = this.playing ? Date.now() : null;
    if (start === null || durationMs <= 0) return null;
    return { startedAt: start, durationMs, wordsRead, avgWpm: Math.round(wordsRead / (durationMs / 60000)) };
  }

  /** Real playing time of the current (untaken) session so far, ms. */
  get sessionElapsedMs(): number {
    return this.sessionMs + (this.playing ? Math.max(0, this.clock.now() - this.playMark) : 0);
  }
  get sessionWordsRead(): number {
    return this.sessionWords;
  }

  destroy(): void {
    this.clearTimer();
    if (this.probe !== null) this.clock.cancelFrame?.(this.probe);
    this.probe = null;
    if (this.playing) this.stopClock(this.clock.now());
    this.playing = false;
    this.frameListeners.clear();
    this.stateListeners.clear();
  }
}
