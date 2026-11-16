import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type HighlightMode = 'orp' | 'middle' | 'first-middle' | 'none';
// 'orp' = optimal recognition point (slightly left of centre), 'middle' = centre letter, 'first-middle' = first letter and centre letter
export type ThemeName = 'dark' | 'light' | 'sepia' | 'black';
export type FontFamily = 'sans' | 'serif' | 'mono' | 'dyslexic';

export interface Settings {
  wpm: number; // default 300
  chunkSize: 1 | 2 | 3; // words shown at once, default 1
  highlightMode: HighlightMode; // default 'orp'
  highlightColor: string; // default '#ff4d4d'
  fontFamily: FontFamily; // default 'sans'
  fontSize: number; // px for the RSVP word, default 44, range 24–96
  theme: ThemeName; // default 'dark'
  smartPacing: boolean; // default true: longer display for punctuation, long words, paragraph ends
  punctuationPause: number; // multiplier for sentence-end tokens, default 2.0 (range 1–4)
  showFocusGuides: boolean; // default true: the tick marks above/below the focus letter
  showContextOnPause: boolean; // default true
  rewindOnResume: number; // words to step back when resuming after a pause, default 5
  rampEnabled: boolean; // speed training, default false
  rampStartWpm: number; // default 250
  rampTargetWpm: number; // default 450
  rampStepWpm: number; // default 10
  rampIntervalSec: number; // default 60
  softStart: boolean; // default true: ease up to full speed over the first few words after pressing play
  keepAwake: boolean; // default true (screen wake lock while playing)
  dailyGoalMinutes: number; // default 15
  userName: string; // default '': optional, only for the greeting on Home; stays on this device (and in backups)
  pageWordsPerLine: number; // page view line width as approximate words per line, default 12, range 6–40
}

export const WPM_MIN = 60;
export const WPM_MAX = 1500;
export const FONT_SIZE_MIN = 24;
export const FONT_SIZE_MAX = 96;
export const PUNCTUATION_PAUSE_MIN = 1;
export const PUNCTUATION_PAUSE_MAX = 4;
export const PAGE_WORDS_PER_LINE_MIN = 6;
export const PAGE_WORDS_PER_LINE_MAX = 40;
/**
 * Width of one average word in the page view, in em: about 6 characters including the following space,
 * at about 0.5 em per character of running text (`ch`, the width of "0", is wider than an average
 * letter in proportional fonts and would give noticeably more words per line than the setting says).
 */
export const PAGE_EM_PER_WORD = 3;
/** CSS max line width of the page view for `wordsPerLine` (the screen may be narrower: then it is the screen). */
export const pageMeasure = (wordsPerLine: number) => `${wordsPerLine * PAGE_EM_PER_WORD}em`;
export const SETTINGS_STORAGE_KEY = 'tempo-settings';

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  wpm: 300,
  chunkSize: 1,
  highlightMode: 'orp',
  highlightColor: '#ff4d4d',
  fontFamily: 'sans',
  fontSize: 44,
  theme: 'dark',
  smartPacing: true,
  punctuationPause: 2.0,
  showFocusGuides: true,
  showContextOnPause: true,
  rewindOnResume: 5,
  rampEnabled: false,
  rampStartWpm: 250,
  rampTargetWpm: 450,
  rampStepWpm: 10,
  rampIntervalSec: 60,
  softStart: true,
  keepAwake: true,
  dailyGoalMinutes: 15,
  userName: '',
  pageWordsPerLine: 12,
});

export const USER_NAME_MAX = 40;

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

export interface SettingsState extends Settings {
  /** Merge a patch into the settings (values are validated/clamped; unknown keys ignored). */
  set: (patch: Partial<Settings>) => void;
  /** Restore DEFAULT_SETTINGS. */
  reset: () => void;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Keep only known keys with the right primitive type and clamp numeric ranges.
 * Used for `set()`, for rehydration from localStorage and for backup import.
 */
export function sanitizeSettings(patch: unknown): Partial<Settings> {
  if (!patch || typeof patch !== 'object') return {};
  const src = patch as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const v = src[key];
    if (v === undefined || typeof v !== typeof DEFAULT_SETTINGS[key]) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    out[key] = v;
  }
  const s = out as Partial<Settings>;
  const intIn = (k: 'wpm' | 'rampStartWpm' | 'rampTargetWpm', v: number) => (s[k] = Math.round(clamp(v, WPM_MIN, WPM_MAX)));
  if (s.wpm !== undefined) intIn('wpm', s.wpm);
  if (s.rampStartWpm !== undefined) intIn('rampStartWpm', s.rampStartWpm);
  if (s.rampTargetWpm !== undefined) intIn('rampTargetWpm', s.rampTargetWpm);
  if (s.chunkSize !== undefined && ![1, 2, 3].includes(s.chunkSize)) delete s.chunkSize;
  if (s.highlightMode !== undefined && !['orp', 'middle', 'first-middle', 'none'].includes(s.highlightMode)) delete s.highlightMode;
  if (s.fontFamily !== undefined && !['sans', 'serif', 'mono', 'dyslexic'].includes(s.fontFamily)) delete s.fontFamily;
  if (s.theme !== undefined && !['dark', 'light', 'sepia', 'black'].includes(s.theme)) delete s.theme;
  if (s.fontSize !== undefined) s.fontSize = Math.round(clamp(s.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX));
  if (s.punctuationPause !== undefined) s.punctuationPause = clamp(s.punctuationPause, PUNCTUATION_PAUSE_MIN, PUNCTUATION_PAUSE_MAX);
  if (s.rewindOnResume !== undefined) s.rewindOnResume = Math.round(clamp(s.rewindOnResume, 0, 100));
  if (s.rampStepWpm !== undefined) s.rampStepWpm = Math.round(clamp(s.rampStepWpm, 1, 500));
  if (s.rampIntervalSec !== undefined) s.rampIntervalSec = Math.round(clamp(s.rampIntervalSec, 5, 3600));
  if (s.dailyGoalMinutes !== undefined) s.dailyGoalMinutes = Math.round(clamp(s.dailyGoalMinutes, 0, 600));
  if (s.pageWordsPerLine !== undefined) s.pageWordsPerLine = Math.round(clamp(s.pageWordsPerLine, PAGE_WORDS_PER_LINE_MIN, PAGE_WORDS_PER_LINE_MAX));
  // not trimmed here (that would eat the space while typing "Anna M"); the greeting trims
  if (s.userName !== undefined) s.userName = s.userName.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, USER_NAME_MAX);
  return s;
}

/** Plain Settings object (no actions) from the store state. */
export function pickSettings(state: Settings): Settings {
  const out = {} as Record<string, unknown>;
  for (const key of SETTING_KEYS) out[key] = state[key];
  return out as unknown as Settings;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (patch) => set(sanitizeSettings(patch)),
      reset: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => pickSettings(state),
      merge: (persisted, current) => ({ ...current, ...sanitizeSettings(persisted) }),
    },
  ),
);
