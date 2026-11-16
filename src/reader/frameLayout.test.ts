import { describe, expect, it } from 'vitest';
import { clusterRange, dominantDirection, frameFocus, frameFocusInWords, textDirection } from './frameLayout';

describe('frameFocus', () => {
  it('single words follow focusIndexes', () => {
    expect(frameFocus('reading', 'orp')).toEqual({ anchor: 2, highlight: [2] });
    expect(frameFocus('hello', 'middle')).toEqual({ anchor: 2, highlight: [2] });
    // first-middle anchors on the middle letter
    expect(frameFocus('hello', 'first-middle')).toEqual({ anchor: 2, highlight: [0, 2] });
  });

  it("'none' keeps an invisible ORP anchor so words do not jump", () => {
    expect(frameFocus('reading', 'none')).toEqual({ anchor: 2, highlight: [] });
  });

  it('chunks anchor on the longest word (ties → closest to centre), only that word highlighted', () => {
    // "clocks" (6) is longest; offset of "clocks" in "the clocks were" is 4; orp(6) = 2
    expect(frameFocus('the clocks were', 'orp')).toEqual({ anchor: 6, highlight: [6] });
    // tie between "cold" and "days"... "a bold cold": bold/cold tie, centre word wins
    expect(frameFocus('a bold cold', 'orp')).toEqual({ anchor: 3, highlight: [3] });
    // punctuation does not count towards length
    expect(frameFocus('Mr. Smith,', 'orp').anchor).toBe(4 + 1);
  });

  it('works on code points (emoji, astral)', () => {
    expect(frameFocus('😀😀 abcdefg', 'orp')).toEqual({ anchor: 5, highlight: [5] });
  });

  it('empty text', () => {
    expect(frameFocus('', 'orp')).toEqual({ anchor: -1, highlight: [] });
  });
});

describe('clusterRange', () => {
  it('keeps combining marks with their base letter', () => {
    const he = 'שָׁלוֹם'; // shin + qamats + shin dot
    expect(clusterRange(he, 0)).toEqual([0, 3]);
    const e = 'éte'; // decomposed é
    expect(clusterRange(e, 0)).toEqual([0, 2]);
  });
  it('maps code points to UTF-16 offsets', () => {
    expect(clusterRange('😀a', 1)).toEqual([2, 3]);
    expect(clusterRange('ab', 5)).toEqual([2, 2]);
  });
});

describe('direction', () => {
  it('detects RTL scripts from the first strong letter', () => {
    expect(textDirection('مرحبا')).toBe('rtl');
    expect(textDirection('«שלום»')).toBe('rtl');
    expect(textDirection('کتاب')).toBe('rtl');
    expect(textDirection('123 hello')).toBe('ltr');
    expect(textDirection('...')).toBe('ltr');
  });
  it('dominant direction by majority', () => {
    expect(dominantDirection(['كان', 'يوم', 'iPhone', 'بارد'])).toBe('rtl');
    expect(dominantDirection(['the', 'cat', 'قط'])).toBe('ltr');
    expect(dominantDirection([])).toBe('ltr');
  });
});

describe('frameFocusInWords (page view)', () => {
  const words = ['A', 'reading', 'test.'];
  it('maps the frame focus to the word that carries it', () => {
    expect(frameFocusInWords(words, 1, 1, 'orp')).toEqual({ word: 1, letters: [2] });
    // a group highlights the longest word only, like the word view
    expect(frameFocusInWords(words, 0, 3, 'orp')).toEqual({ word: 1, letters: [2] });
    expect(frameFocusInWords(words, 1, 1, 'first-middle')).toEqual({ word: 1, letters: [0, 3] });
  });
  it("is null for 'none' and outside the book", () => {
    expect(frameFocusInWords(words, 1, 1, 'none')).toBeNull();
    expect(frameFocusInWords(words, 3, 1, 'orp')).toBeNull();
  });
});
