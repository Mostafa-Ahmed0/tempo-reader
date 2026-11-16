import { describe, expect, it } from 'vitest';
import { dayLine, greeting, timeOfDay } from './greeting';

describe('greeting', () => {
  it('follows the time of day', () => {
    expect([0, 4, 5, 11, 12, 17, 18, 23].map(timeOfDay)).toEqual([
      'evening',
      'evening',
      'morning',
      'morning',
      'afternoon',
      'afternoon',
      'evening',
      'evening',
    ]);
    expect(greeting(8)).toBe('Good morning');
    expect(greeting(14)).toBe('Good afternoon');
    expect(greeting(21)).toBe('Good evening');
  });

  it('adds the name when one is set (trimmed), and is just the time-of-day line without', () => {
    expect(greeting(8, 'Anna')).toBe('Good morning, Anna');
    expect(greeting(13, '  Anna Maria ')).toBe('Good afternoon, Anna Maria');
    expect(greeting(19, '')).toBe('Good evening');
    expect(greeting(19, '   ')).toBe('Good evening');
  });
});

describe('day line', () => {
  const base = { todayMinutes: 0, goal: 15, streak: 0, hasHistory: true };
  it('a brand-new reader gets an invitation', () => {
    expect(dayLine({ ...base, hasHistory: false })).toMatch(/press play/);
  });
  it('nothing read yet today, with and without a streak to keep', () => {
    expect(dayLine(base)).toBe('Nothing read yet today. A few minutes is all it takes.');
    expect(dayLine({ ...base, streak: 4 })).toBe('Nothing read yet today. Read a little to keep your 4-day streak going.');
  });
  it('minutes read today, minutes to go, goal reached, no goal', () => {
    expect(dayLine({ ...base, todayMinutes: 6 })).toBe('6 min read today, 9 min to go for your goal.');
    expect(dayLine({ ...base, todayMinutes: 15 })).toBe('Daily goal reached with 15 min today. Nicely done.');
    expect(dayLine({ ...base, todayMinutes: 40, goal: 0 })).toBe('40 min read today.');
  });
});
