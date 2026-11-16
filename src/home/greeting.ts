/** Pure text helpers for the Home screen (unit-tested in greeting.test.ts). */
import { formatMinutes } from '../stats/aggregate';

/** "Good morning" 05:00–11:59, "Good afternoon" 12:00–17:59, "Good evening" otherwise (also late at night). */
export function timeOfDay(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}

/** "Good morning" or "Good morning, Anna". */
export function greeting(hour: number, name?: string): string {
  const base = `Good ${timeOfDay(hour)}`;
  const n = (name ?? '').trim();
  return n ? `${base}, ${n}` : base;
}

export interface DayState {
  /** Minutes read today. */
  todayMinutes: number;
  /** Daily goal in minutes; 0 = no goal. */
  goal: number;
  /** Current streak in days (may end yesterday). */
  streak: number;
  /** Any reading session ever recorded. */
  hasHistory: boolean;
}

/** The friendly second line under the greeting. */
export function dayLine({ todayMinutes, goal, streak, hasHistory }: DayState): string {
  if (!hasHistory) return 'Pick a book, press play, and let the words come to you.';
  if (todayMinutes <= 0) {
    if (streak > 0) return `Nothing read yet today. Read a little to keep your ${streak}-day streak going.`;
    return 'Nothing read yet today. A few minutes is all it takes.';
  }
  if (goal > 0 && todayMinutes >= goal) return `Daily goal reached with ${formatMinutes(todayMinutes)} today. Nicely done.`;
  if (goal > 0) return `${formatMinutes(todayMinutes)} read today, ${formatMinutes(goal - todayMinutes)} to go for your goal.`;
  return `${formatMinutes(todayMinutes)} read today.`;
}
