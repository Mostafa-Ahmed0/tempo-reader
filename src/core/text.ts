import type { HighlightMode } from './settings';

/**
 * Small pacing-independent text helpers shared by the reader, the settings preview and the library.
 * All indexes are CODE-POINT indexes, i.e. into `Array.from(word)`, so emoji/astral characters count as one.
 */

const RE_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Range [start, end) of the word's core (letters/digits), ignoring surrounding punctuation like quotes. */
function coreRange(chars: string[]): [number, number] {
  let start = 0;
  let end = chars.length;
  while (start < end && !RE_LETTER_OR_DIGIT.test(chars[start])) start++;
  while (end > start && !RE_LETTER_OR_DIGIT.test(chars[end - 1])) end--;
  return start < end ? [start, end] : [0, chars.length];
}

/** Optimal recognition point offset for a core of `len` characters (classic Spritz-style table). */
function orpOffset(len: number): number {
  if (len <= 1) return 0;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  if (len <= 13) return 3;
  return 4;
}

/** Code-point indexes to highlight in `word` for the given mode (sorted, unique; empty for 'none' or ''). */
export function focusIndexes(word: string, mode: HighlightMode): number[] {
  const chars = Array.from(word);
  if (!chars.length || mode === 'none') return [];
  const [start, end] = coreRange(chars);
  const len = end - start;
  const middle = start + Math.floor((len - 1) / 2);
  switch (mode) {
    case 'orp':
      return [start + orpOffset(len)];
    case 'middle':
      return [middle];
    case 'first-middle':
      return start === middle ? [start] : [start, middle];
  }
}

/** Minutes needed to read `words` words at `wpm` (no pacing adjustments). */
export function estimateMinutes(words: number, wpm: number): number {
  return wpm > 0 ? words / wpm : 0;
}

/** "45 s", "12 min", "1 h 05 min" */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec} s`;
  const totalMin = Math.round(totalSec / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}
