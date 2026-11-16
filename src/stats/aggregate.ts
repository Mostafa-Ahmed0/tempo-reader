/**
 * Pure aggregation for the stats page. All "days" are LOCAL calendar days, identified by a
 * 'YYYY-MM-DD' key, and day arithmetic goes through the Date constructor (never +24h), so DST
 * changes (23h / 25h days) are handled correctly.
 */
import type { Book, ReadingSession } from '../core/types';

export type DayKey = string; // 'YYYY-MM-DD' local

const pad = (n: number) => String(n).padStart(2, '0');

export function dayKey(ms: number): DayKey {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight at the start of the day containing `ms`. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Local midnight of the day after the one containing `ms` (23, 24 or 25 h later). */
export function startOfNextDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

export function parseDayKey(key: DayKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: DayKey, n: number): DayKey {
  const d = parseDayKey(key);
  return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime());
}

/** Sessions with a usable duration (defensive against bad imported data). */
function valid(s: ReadingSession): boolean {
  return Number.isFinite(s.startedAt) && Number.isFinite(s.durationMs) && s.durationMs > 0;
}

/**
 * Reading time per local day. A session that runs past midnight is split between the days it
 * touches (so "today" and the daily bars are exact).
 */
export function msByDay(sessions: readonly ReadingSession[]): Map<DayKey, number> {
  const out = new Map<DayKey, number>();
  for (const s of sessions) {
    if (!valid(s)) continue;
    let t = s.startedAt;
    const end = s.startedAt + s.durationMs;
    while (t < end) {
      const next = Math.min(end, startOfNextDay(t));
      const k = dayKey(t);
      out.set(k, (out.get(k) ?? 0) + (next - t));
      t = next;
    }
  }
  return out;
}

/** "0 min", "<1 min", "25 min", "1 h 5 min", "2 h". */
export const formatMinutes = (m: number) => {
  if (m <= 0) return '0 min';
  if (m < 1) return '<1 min';
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return r ? `${h} h ${r} min` : `${h} h`;
};

export function todayMs(sessions: readonly ReadingSession[], now: number): number {
  return msByDay(sessions).get(dayKey(now)) ?? 0;
}

export interface Streaks {
  /** Consecutive days with reading ending today, or ending yesterday if today has none yet. */
  current: number;
  best: number;
  /** True when the current streak would continue if the user reads today. */
  readToday: boolean;
}

export function streaks(sessions: readonly ReadingSession[], now: number): Streaks {
  const days = new Set(msByDay(sessions).keys());
  const today = dayKey(now);
  const readToday = days.has(today);
  let current = 0;
  let cursor = readToday ? today : addDays(today, -1);
  while (days.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  let best = 0;
  for (const k of days) {
    if (days.has(addDays(k, -1))) continue; // not the start of a run
    let len = 0;
    let c = k;
    while (days.has(c)) {
      len++;
      c = addDays(c, 1);
    }
    best = Math.max(best, len);
  }
  return { current, best, readToday };
}

export interface Totals {
  words: number;
  ms: number;
  sessions: number;
  booksFinished: number;
  /** Time-weighted average (total words / total minutes); null without data. */
  avgWpm: number | null;
}

export function weightedWpm(words: number, ms: number): number | null {
  return ms > 0 && words > 0 ? (words / ms) * 60_000 : null;
}

export function totals(sessions: readonly ReadingSession[], books: readonly Pick<Book, 'finishedAt'>[]): Totals {
  let words = 0;
  let ms = 0;
  let count = 0;
  for (const s of sessions) {
    if (!valid(s)) continue;
    words += Math.max(0, s.wordsRead || 0);
    ms += s.durationMs;
    count++;
  }
  return {
    words,
    ms,
    sessions: count,
    booksFinished: books.filter((b) => b.finishedAt != null).length,
    avgWpm: weightedWpm(words, ms),
  };
}

export interface DayBar {
  day: DayKey;
  minutes: number;
}

/** `days` bars ending today (oldest first), zero-filled. */
export function minutesPerDay(sessions: readonly ReadingSession[], now: number, days = 30): DayBar[] {
  const byDay = msByDay(sessions);
  const today = dayKey(now);
  const out: DayBar[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const k = addDays(today, -i);
    out.push({ day: k, minutes: (byDay.get(k) ?? 0) / 60_000 });
  }
  return out;
}

export interface WpmPoint {
  /** Day key of the bucket start (the day, or the Monday of the week). */
  day: DayKey;
  wpm: number;
  minutes: number;
  words: number;
}

/** Sessions shorter than this are left out of the speed trend (a 3-second tap is not a measurement). */
export const MIN_TREND_SESSION_MS = 15_000;

/** Monday of the local week containing the day. */
export function weekStart(key: DayKey): DayKey {
  const d = parseDayKey(key);
  const offset = (d.getDay() + 6) % 7; // Mon = 0
  return addDays(key, -offset);
}

/**
 * Time-weighted average WPM per day (or per week when `bucket` is 'week'), oldest first.
 * Each session counts towards the day it started on. Only days with reading appear (no zero points).
 */
export function wpmTrend(sessions: readonly ReadingSession[], bucket: 'day' | 'week' = 'day'): WpmPoint[] {
  const acc = new Map<DayKey, { words: number; ms: number }>();
  for (const s of sessions) {
    if (!valid(s) || s.durationMs < MIN_TREND_SESSION_MS || !(s.wordsRead > 0)) continue;
    const d = dayKey(s.startedAt);
    const k = bucket === 'week' ? weekStart(d) : d;
    const a = acc.get(k) ?? { words: 0, ms: 0 };
    a.words += s.wordsRead;
    a.ms += s.durationMs;
    acc.set(k, a);
  }
  return [...acc.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, a]) => ({ day, wpm: (a.words / a.ms) * 60_000, minutes: a.ms / 60_000, words: a.words }));
}

/** Days between two day keys (b - a), DST-safe. */
export function daysBetween(a: DayKey, b: DayKey): number {
  const da = parseDayKey(a);
  const db = parseDayKey(b);
  return Math.round((Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()) - Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) / 86_400_000);
}

/** Daily points, switching to weekly buckets when the history spans more than `maxDays`. */
export function autoTrend(sessions: readonly ReadingSession[], maxDays = 60): { bucket: 'day' | 'week'; points: WpmPoint[] } {
  const daily = wpmTrend(sessions, 'day');
  if (daily.length >= 2 && daysBetween(daily[0].day, daily[daily.length - 1].day) > maxDays) {
    return { bucket: 'week', points: wpmTrend(sessions, 'week') };
  }
  return { bucket: 'day', points: daily };
}

/**
 * Least-squares line through (days since first point, wpm), weighted by minutes read, so a
 * one-minute day does not swing the trend as much as an hour-long one.
 * Returns wpm change per 7 days, and the fitted start/end values; null with < 2 points or a zero span.
 */
export function trendLine(points: readonly WpmPoint[]): { perWeek: number; start: number; end: number } | null {
  if (points.length < 2) return null;
  const x0 = points[0].day;
  const xs = points.map((p) => daysBetween(x0, p.day));
  const ws = points.map((p) => Math.max(p.minutes, 1e-6));
  const W = ws.reduce((a, b) => a + b, 0);
  const mx = xs.reduce((a, x, i) => a + x * ws[i], 0) / W;
  const my = points.reduce((a, p, i) => a + p.wpm * ws[i], 0) / W;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < points.length; i++) {
    sxx += ws[i] * (xs[i] - mx) ** 2;
    sxy += ws[i] * (xs[i] - mx) * (points[i].wpm - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const at = (x: number) => my + slope * (x - mx);
  return { perWeek: slope * 7, start: at(xs[0]), end: at(xs[xs.length - 1]) };
}

export interface BookBreakdown {
  bookId: string;
  title: string;
  author: string;
  ms: number;
  words: number;
  sessions: number;
  avgWpm: number | null;
  lastReadAt: number;
  exists: boolean;
}

/** Per-book totals, most time first. Sessions of books that no longer exist are grouped as "Removed book". */
export function perBook(sessions: readonly ReadingSession[], books: readonly Pick<Book, 'id' | 'title' | 'author'>[]): BookBreakdown[] {
  const byId = new Map(books.map((b) => [b.id, b]));
  const acc = new Map<string, BookBreakdown>();
  for (const s of sessions) {
    if (!valid(s)) continue;
    const b = byId.get(s.bookId);
    const key = b ? s.bookId : '__removed__';
    const row =
      acc.get(key) ??
      ({ bookId: key, title: b?.title ?? 'Removed books', author: b?.author ?? '', ms: 0, words: 0, sessions: 0, avgWpm: null, lastReadAt: 0, exists: !!b } as BookBreakdown);
    row.ms += s.durationMs;
    row.words += Math.max(0, s.wordsRead || 0);
    row.sessions++;
    row.lastReadAt = Math.max(row.lastReadAt, s.startedAt + s.durationMs);
    acc.set(key, row);
  }
  const rows = [...acc.values()];
  for (const r of rows) r.avgWpm = weightedWpm(r.words, r.ms);
  return rows.sort((a, b) => b.ms - a.ms || b.lastReadAt - a.lastReadAt);
}

// ---------------------------------------------------------------------------
// Chart helpers
// ---------------------------------------------------------------------------

/** "Nice" axis ticks (1, 2, 2.5, 5 × 10^n steps) covering [min, max]. */
export function niceTicks(min: number, max: number, target = 4): { ticks: number[]; min: number; max: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ticks: [0, 1], min: 0, max: 1 };
  if (max < min) [min, max] = [max, min];
  if (max === min) {
    const pad = max === 0 ? 1 : Math.abs(max) * 0.1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { ticks, min: lo, max: hi };
}

/** The written trend ("up N wpm per week") is only stated once the data spans at least this many days. */
export const MIN_TREND_SPAN_DAYS = 14;
