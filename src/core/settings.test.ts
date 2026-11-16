import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, USER_NAME_MAX, WPM_MAX, WPM_MIN, sanitizeSettings, useSettings } from './settings';

beforeEach(() => {
  useSettings.getState().reset();
});

describe('settings store', () => {
  it('starts with the defaults', () => {
    const s = useSettings.getState();
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) expect(s[k as keyof typeof s]).toEqual(v);
    expect(WPM_MIN).toBe(60);
    expect(WPM_MAX).toBe(1500);
  });

  it('set() merges a patch and clamps ranges', () => {
    useSettings.getState().set({ wpm: 5000, fontSize: 10, punctuationPause: 9, theme: 'light' });
    const s = useSettings.getState();
    expect(s.wpm).toBe(WPM_MAX);
    expect(s.fontSize).toBe(24);
    expect(s.punctuationPause).toBe(4);
    expect(s.theme).toBe('light');
    expect(s.chunkSize).toBe(1);
  });

  it('reset() restores defaults', () => {
    useSettings.getState().set({ wpm: 700, smartPacing: false });
    useSettings.getState().reset();
    expect(useSettings.getState().wpm).toBe(300);
    expect(useSettings.getState().smartPacing).toBe(true);
  });

  it('persists to localStorage under tempo-settings without the actions', () => {
    useSettings.getState().set({ wpm: 420 });
    const raw = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}');
    expect(raw.state.wpm).toBe(420);
    expect(raw.state.set).toBeUndefined();
  });

  it('sanitizeSettings drops unknown keys and wrong types', () => {
    expect(sanitizeSettings({ wpm: '400', bogus: 1, chunkSize: 5, theme: 'neon', keepAwake: false })).toEqual({ keepAwake: false });
    expect(sanitizeSettings(null)).toEqual({});
  });

  it('userName: optional, control characters removed, capped, spaces kept while typing', () => {
    expect(DEFAULT_SETTINGS.userName).toBe('');
    expect(sanitizeSettings({ userName: 'Anna ' })).toEqual({ userName: 'Anna ' });
    expect(sanitizeSettings({ userName: 'An\nna\u0007' })).toEqual({ userName: 'Anna' });
    expect(sanitizeSettings({ userName: 'x'.repeat(100) }).userName).toHaveLength(USER_NAME_MAX);
    expect(sanitizeSettings({ userName: 42 })).toEqual({});
  });
});
