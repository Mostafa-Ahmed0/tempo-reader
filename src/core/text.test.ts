import { describe, expect, it } from 'vitest';
import { estimateMinutes, focusIndexes, formatDuration } from './text';

describe('focusIndexes', () => {
  it('orp sits slightly left of centre', () => {
    expect(focusIndexes('a', 'orp')).toEqual([0]);
    expect(focusIndexes('word', 'orp')).toEqual([1]);
    expect(focusIndexes('reading', 'orp')).toEqual([2]);
    expect(focusIndexes('extraordinary', 'orp')).toEqual([3]);
  });
  it('ignores surrounding punctuation', () => {
    expect(focusIndexes('"word,"', 'orp')).toEqual([2]);
    expect(focusIndexes('(hello)', 'middle')).toEqual([3]);
  });
  it('middle and first-middle', () => {
    expect(focusIndexes('hello', 'middle')).toEqual([2]);
    expect(focusIndexes('hello', 'first-middle')).toEqual([0, 2]);
    expect(focusIndexes('a', 'first-middle')).toEqual([0]);
  });
  it('none and empty', () => {
    expect(focusIndexes('hello', 'none')).toEqual([]);
    expect(focusIndexes('', 'orp')).toEqual([]);
  });
  it('counts code points', () => {
    expect(focusIndexes('😀😀😀😀', 'middle')).toEqual([1]);
  });
});

describe('durations', () => {
  it('estimateMinutes', () => {
    expect(estimateMinutes(600, 300)).toBe(2);
    expect(estimateMinutes(600, 0)).toBe(0);
  });
  it('formatDuration', () => {
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(12 * 60_000)).toBe('12 min');
    expect(formatDuration(65 * 60_000)).toBe('1 h 05 min');
  });
});
