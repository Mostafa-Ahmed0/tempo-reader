import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ReadingSession } from '../core/types';
import {
  addDays,
  autoTrend,
  dayKey,
  daysBetween,
  minutesPerDay,
  msByDay,
  niceTicks,
  perBook,
  streaks,
  todayMs,
  totals,
  trendLine,
  weekStart,
  wpmTrend,
} from './aggregate';

// Pin a time zone with DST so the midnight/DST cases are deterministic (Node honours runtime TZ changes).
const prevTZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'Europe/Berlin';
});
afterAll(() => {
  process.env.TZ = prevTZ;
});

const MIN = 60_000;
const H = 60 * MIN;
/** Local time in the pinned zone. */
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();

let n = 0;
function s(startedAt: number, durationMs: number, wordsRead = Math.round((durationMs / MIN) * 300), bookId = 'a'): ReadingSession {
  return { id: `s${n++}`, bookId, startedAt, durationMs, wordsRead, avgWpm: durationMs ? (wordsRead / durationMs) * MIN : 0 };
}

describe('day keys', () => {
  it('uses local dates', () => {
    expect(process.env.TZ).toBe('Europe/Berlin');
    expect(dayKey(at(2026, 3, 1, 0, 5))).toBe('2026-03-01');
    expect(dayKey(at(2026, 2, 28, 23, 59))).toBe('2026-02-28');
  });
  it('adds days across month ends and DST changes', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29'); // spring forward night
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-10-25', -1)).toBe('2026-10-24'); // fall back day
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysBetween('2026-03-28', '2026-03-31')).toBe(3);
  });
  it('weeks start on Monday', () => {
    expect(weekStart('2026-11-15')).toBe('2026-11-09'); // Sunday -> Monday before
    expect(weekStart('2026-11-09')).toBe('2026-11-09');
  });
});

describe('msByDay', () => {
  it('splits a session across local midnight', () => {
    const m = msByDay([s(at(2026, 5, 10, 23, 50), 20 * MIN)]);
    expect(m.get('2026-05-10')).toBe(10 * MIN);
    expect(m.get('2026-05-11')).toBe(10 * MIN);
  });
  it('splits correctly on the 23-hour spring-forward day', () => {
    // 2026-03-29 has only 23 hours in Berlin; a session from 23:30 on the 28th to 00:30 on the 30th...
    const start = at(2026, 3, 28, 23, 30);
    const m = msByDay([s(start, 30 * MIN + 23 * H + 30 * MIN)]);
    expect(m.get('2026-03-28')).toBe(30 * MIN);
    expect(m.get('2026-03-29')).toBe(23 * H);
    expect(m.get('2026-03-30')).toBe(30 * MIN);
  });
  it('ignores zero, negative and non-finite durations', () => {
    expect(msByDay([s(at(2026, 1, 1), 0), s(at(2026, 1, 1), -5), s(Number.NaN, 5)]).size).toBe(0);
  });
});

describe('streaks', () => {
  const now = at(2026, 11, 15, 9);
  it('is zero for no data', () => {
    expect(streaks([], now)).toEqual({ current: 0, best: 0, readToday: false });
  });
  it('counts consecutive days ending today', () => {
    const r = streaks([s(at(2026, 11, 13), MIN), s(at(2026, 11, 14), MIN), s(at(2026, 11, 15, 8), MIN)], now);
    expect(r).toEqual({ current: 3, best: 3, readToday: true });
  });
  it('keeps the streak alive until the end of today if yesterday was read', () => {
    const r = streaks([s(at(2026, 11, 13), MIN), s(at(2026, 11, 14), MIN)], now);
    expect(r.current).toBe(2);
    expect(r.readToday).toBe(false);
  });
  it('breaks after a missed day', () => {
    expect(streaks([s(at(2026, 11, 12), MIN), s(at(2026, 11, 13), MIN)], now).current).toBe(0);
  });
  it('a late-night session counts for the day it continues into', () => {
    // 23:55 on the 14th for 10 minutes -> reading on the 14th and the 15th
    const r = streaks([s(at(2026, 11, 13), MIN), s(at(2026, 11, 14, 23, 55), 10 * MIN)], now);
    expect(r).toEqual({ current: 3, best: 3, readToday: true });
  });
  it('a session at 00:30 is the new day, not yesterday', () => {
    const r = streaks([s(at(2026, 11, 13), MIN), s(at(2026, 11, 15, 0, 30), MIN)], now);
    expect(r.current).toBe(1);
  });
  it('counts runs across DST changes', () => {
    const days = [27, 28, 29, 30, 31].map((d) => s(at(2026, 3, d, 1, 30), MIN)); // includes the 23h day
    const fall = [24, 25, 26].map((d) => s(at(2026, 10, d, 2, 30), MIN)); // includes the 25h day (02:30 occurs twice)
    const r = streaks([...days, ...fall], at(2026, 10, 26, 20));
    expect(r.current).toBe(3);
    expect(r.best).toBe(5);
  });
  it('several sessions on one day count once', () => {
    expect(streaks([s(at(2026, 11, 15, 7), MIN), s(at(2026, 11, 15, 8), MIN)], now).current).toBe(1);
  });
});

describe('today and daily bars', () => {
  const now = at(2026, 11, 15, 20);
  it('today includes only time after local midnight', () => {
    expect(todayMs([s(at(2026, 11, 14, 23, 50), 20 * MIN), s(at(2026, 11, 15, 12), 5 * MIN)], now)).toBe(15 * MIN);
    expect(todayMs([], now)).toBe(0);
  });
  it('last 30 days are zero-filled, oldest first, ending today', () => {
    const bars = minutesPerDay([s(at(2026, 11, 15, 10), 12 * MIN), s(at(2026, 10, 17, 10), 3 * MIN), s(at(2026, 10, 1), 99 * MIN)], now);
    expect(bars).toHaveLength(30);
    expect(bars[0].day).toBe('2026-10-17');
    expect(bars[0].minutes).toBe(3);
    expect(bars[29]).toEqual({ day: '2026-11-15', minutes: 12 });
    expect(bars.reduce((a, b) => a + b.minutes, 0)).toBe(15);
  });
  it('spans the fall-back day without duplicating or skipping', () => {
    const bars = minutesPerDay([], at(2026, 11, 5));
    const keys = bars.map((b) => b.day);
    expect(new Set(keys).size).toBe(30);
    expect(keys).toContain('2026-10-25');
  });
});

describe('totals and speed', () => {
  it('handles empty data', () => {
    expect(totals([], [])).toEqual({ words: 0, ms: 0, sessions: 0, booksFinished: 0, avgWpm: null });
    expect(wpmTrend([])).toEqual([]);
    expect(trendLine([])).toBeNull();
    expect(perBook([], [])).toEqual([]);
  });
  it('average WPM is time-weighted, not a mean of session averages', () => {
    // 10 min at 200 + 1 min at 800 -> (2000 + 800) / 11 min = 254.5, not 500
    const t = totals([s(at(2026, 1, 1), 10 * MIN, 2000), s(at(2026, 1, 2), MIN, 800)], [{ finishedAt: 1 }, { finishedAt: null }]);
    expect(t.avgWpm).toBeCloseTo(2800 / 11, 5);
    expect(t.booksFinished).toBe(1);
    expect(t.words).toBe(2800);
  });
  it('trend groups by start day and skips very short sessions', () => {
    const pts = wpmTrend([s(at(2026, 1, 1, 9), 2 * MIN, 500), s(at(2026, 1, 1, 18), 2 * MIN, 700), s(at(2026, 1, 2), 5_000, 9999), s(at(2026, 1, 3), MIN, 400)]);
    expect(pts.map((p) => p.day)).toEqual(['2026-01-01', '2026-01-03']);
    expect(pts[0].wpm).toBeCloseTo(300);
    expect(pts[1].wpm).toBeCloseTo(400);
  });
  it('switches to weekly buckets for long histories', () => {
    const sessions = [s(at(2026, 1, 5), 10 * MIN, 2500), s(at(2026, 1, 6), 10 * MIN, 3500), s(at(2026, 5, 5), 10 * MIN, 4000)];
    const r = autoTrend(sessions, 60);
    expect(r.bucket).toBe('week');
    expect(r.points.map((p) => p.day)).toEqual(['2026-01-05', '2026-05-04']);
    expect(r.points[0].wpm).toBeCloseTo(300);
    expect(autoTrend(sessions.slice(0, 2)).bucket).toBe('day');
  });
  it('trend line slope per week', () => {
    const pts = [
      { day: '2026-01-01', wpm: 300, minutes: 10, words: 3000 },
      { day: '2026-01-08', wpm: 320, minutes: 10, words: 3200 },
      { day: '2026-01-15', wpm: 340, minutes: 10, words: 3400 },
    ];
    const t = trendLine(pts)!;
    expect(t.perWeek).toBeCloseTo(20);
    expect(t.start).toBeCloseTo(300);
    expect(t.end).toBeCloseTo(340);
    expect(trendLine([pts[0], { ...pts[0] }])).toBeNull(); // zero span
  });
});

describe('perBook', () => {
  it('sums per book, labels removed books and sorts by time', () => {
    const rows = perBook(
      [s(at(2026, 1, 1), 5 * MIN, 1000, 'a'), s(at(2026, 1, 2), 20 * MIN, 6000, 'b'), s(at(2026, 1, 3), 5 * MIN, 2000, 'a'), s(at(2026, 1, 3), MIN, 100, 'gone')],
      [
        { id: 'a', title: 'Alpha', author: 'X' },
        { id: 'b', title: 'Beta', author: '' },
      ],
    );
    expect(rows.map((r) => r.title)).toEqual(['Beta', 'Alpha', 'Removed books']);
    expect(rows[1]).toMatchObject({ ms: 10 * MIN, words: 3000, sessions: 2, exists: true });
    expect(rows[1].avgWpm).toBeCloseTo(300);
    expect(rows[2].exists).toBe(false);
  });
});

describe('niceTicks', () => {
  it('produces round steps that cover the range', () => {
    expect(niceTicks(0, 47, 4).ticks).toEqual([0, 20, 40, 60]);
    expect(niceTicks(0, 38, 4).ticks).toEqual([0, 10, 20, 30, 40]);
    const r = niceTicks(243, 318, 4);
    expect(r.min).toBeLessThanOrEqual(243);
    expect(r.max).toBeGreaterThanOrEqual(318);
    expect(r.ticks).toEqual([240, 260, 280, 300, 320]);
  });
  it('handles flat and empty ranges', () => {
    expect(niceTicks(0, 0).ticks.length).toBeGreaterThanOrEqual(2);
    expect(niceTicks(300, 300).min).toBeLessThan(300);
    expect(niceTicks(NaN, 1).ticks).toEqual([0, 1]);
  });
});
