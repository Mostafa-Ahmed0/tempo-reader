import { describe, expect, it } from 'vitest';
import {
  WORDS_PER_PAGE_ESTIMATE as WPP,
  formatPage,
  formatPageCount,
  formatPageOf,
  isValidPageStarts,
  pageAccessibleLabel,
  pageAt,
  pageMapOf,
  pageStartIndex,
} from './pages';

describe('pages: real page starts', () => {
  // 5 pages; page 3 is blank (same start as page 4)
  const book = { wordCount: 1000, pageStarts: [0, 300, 550, 550, 800] };
  const map = pageMapOf(book);

  it('is exact with one page per entry', () => {
    expect(map).toEqual({ exact: true, total: 5, starts: book.pageStarts });
  });
  it('maps word positions to 1-based pages', () => {
    expect(pageAt(map, 0)).toBe(1);
    expect(pageAt(map, 299)).toBe(1);
    expect(pageAt(map, 300)).toBe(2);
    expect(pageAt(map, 549)).toBe(2);
    // the blank page 3 holds no words: its next page (4) is shown
    expect(pageAt(map, 550)).toBe(4);
    expect(pageAt(map, 999)).toBe(5);
    expect(pageAt(map, 1000)).toBe(5); // finished = last page
    expect(pageAt(map, -5)).toBe(1);
    expect(pageAt(map, Number.NaN)).toBe(1);
  });
  it('page start lookups (go to page) are clamped', () => {
    expect(pageStartIndex(map, 2)).toBe(300);
    expect(pageStartIndex(map, 3)).toBe(550);
    expect(pageStartIndex(map, 0)).toBe(0);
    expect(pageStartIndex(map, 99)).toBe(800);
  });
  it('labels', () => {
    expect(formatPageOf(map, 300)).toBe('Page 2 of 5');
    expect(formatPageOf(map, 300, true)).toBe('p. 2 of 5');
    expect(formatPageCount(map)).toBe('5 pages');
    expect(formatPage(map, 999)).toBe('p. 5');
    expect(pageAccessibleLabel(map, 300)).toBe('page 2 of 5');
    expect(formatPageOf(pageMapOf({ wordCount: 10, pageStarts: Array.from({ length: 1312 }, () => 0) }), 0)).toBe('Page 1,312 of 1,312');
  });
});

describe('pages: estimate', () => {
  it('is used when there are no real pages (other formats, books imported before pages existed)', () => {
    const map = pageMapOf({ wordCount: WPP * 10 + 1 });
    expect(map).toEqual({ exact: false, total: 11, starts: null });
    expect(pageAt(map, 0)).toBe(1);
    expect(pageAt(map, WPP - 1)).toBe(1);
    expect(pageAt(map, WPP)).toBe(2);
    expect(pageAt(map, WPP * 10 + 1)).toBe(11);
    expect(pageStartIndex(map, 3)).toBe(WPP * 2);
    expect(formatPageOf(map, WPP * 13)).toBe('≈ page 11 of 11');
    expect(formatPageOf(map, 0, true)).toBe('≈ p. 1 of 11');
    expect(formatPageCount(map)).toBe('≈ 11 pages');
    expect(formatPage(map, WPP)).toBe('≈ p. 2');
    expect(pageAccessibleLabel(map, 0)).toBe('about page 1 of 11');
  });
  it('an empty or tiny book has one page', () => {
    expect(formatPageCount(pageMapOf({ wordCount: 0 }))).toBe('≈ 1 page');
    expect(pageMapOf({ wordCount: 5 }).total).toBe(1);
  });
  it('falls back when stored starts are damaged or do not fit the text', () => {
    for (const bad of [[], [1, 2], [0, 5, 3], [0, 2000], [0, 1.5], ['0'], null, 'x', {}]) {
      expect(isValidPageStarts(bad, 1000)).toBe(false);
      expect(pageMapOf({ wordCount: 1000, pageStarts: bad as number[] }).exact).toBe(false);
    }
    expect(isValidPageStarts([0], 0)).toBe(true);
    expect(isValidPageStarts([0, 0, 1000], 1000)).toBe(true);
  });
});
